/**
 * Generic OAuth Token Manager
 * Handles OAuth token storage, validation, and refresh for any OAuth provider
 */

import * as fs from 'fs';
import * as path from 'path';
import * as querystring from 'querystring';
import * as http from 'http';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as readline from 'readline';

const execAsync = promisify(exec);

/** Global serialization for OAuth flows — only one interactive consent at a time across all callers */
const pendingOAuth = new Map<string, Promise<OAuthToken | null>>();

/** Re-auth backoff per token location. When an interactive OAuth flow fails or
 *  times out (user didn't complete consent, callback never arrived, refresh
 *  token revoked on a multi-machine account), DON'T immediately reopen the
 *  browser on the next sync cycle — that's how a machine ends up with "a
 *  browser full of authentication requests" (Bob 2026-05-29). Back off for
 *  REAUTH_BACKOFF_MS; within the window, authenticateOAuth returns null
 *  without opening a tab so the caller can surface ONE re-auth banner instead
 *  of spawning a tab every cycle. Cleared on success. */
const failedOAuthBackoff = new Map<string, number>(); // lockKey → time of last failed flow
const REAUTH_BACKOFF_MS = 60 * 60 * 1000; // 1 hour

export interface OAuthToken {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
    scope?: string;
}

export interface StoredOAuthToken extends OAuthToken {
    expires_at?: number; // Timestamp when token expires
    created_at?: number; // Timestamp when token was created
}

export interface OAuthClient {
    clientId: string;
    clientSecret: string;
    tokenUri: string;
}

export interface TokenManagerOptions {
    tokenFileName?: string; // Default: 'token.json'
    tokenDirectory?: string; // Default: current directory
    expirationBufferMinutes?: number; // Default: 5 minutes
    maxTokenLifetimeHours?: number; // Maximum token lifetime in hours (overrides server expiration if shorter)
}

export class OAuthTokenManager {
    private tokenPath: string;
    private expirationBuffer: number;
    private maxTokenLifetime?: number; // Maximum token lifetime in milliseconds

    constructor(options: TokenManagerOptions = {}) {
        const tokenFileName = options.tokenFileName || 'token.json';
        const tokenDirectory = options.tokenDirectory;
        if (!tokenDirectory)
            throw new Error('tokenDirectory must be specified');
        this.tokenPath = path.join(tokenDirectory, tokenFileName);
        this.expirationBuffer = (options.expirationBufferMinutes || 5) * 60 * 1000; // Convert to milliseconds
        this.maxTokenLifetime = options.maxTokenLifetimeHours ? options.maxTokenLifetimeHours * 60 * 60 * 1000 : undefined; // Convert hours to milliseconds
    }

    /**
     * Check if a stored token exists
     */
    hasStoredToken(): boolean {
        return fs.existsSync(this.tokenPath);
    }

    /**
     * Get stored token if it exists
     */
    getStoredToken(): StoredOAuthToken | null {
        if (!this.hasStoredToken()) {
            return null;
        }

        try {
            const tokenContent = fs.readFileSync(this.tokenPath, 'utf8');
            const token = JSON.parse(tokenContent) as StoredOAuthToken;
            return token;
        } catch (error) {
            console.error('Error reading stored token:', error);
            return null;
        }
    }    /**
     * Check if a token is expired or will expire soon
     */
    isTokenExpired(token: StoredOAuthToken): boolean {
        if (!token.expires_at) {
            // If no expiration time stored, consider it expired for safety
            return true;
        }

        const now = Date.now();
        
        // Check if the token has exceeded our custom maximum lifetime
        if (this.maxTokenLifetime && token.created_at) {
            const customExpirationTime = token.created_at + this.maxTokenLifetime;
            if (now >= (customExpirationTime - this.expirationBuffer)) {
                return true;
            }
        }
        
        // Check standard OAuth expiration
        return now >= (token.expires_at - this.expirationBuffer);
    }

    /**
     * Check if a token is valid (exists and not expired)
     */
    isTokenValid(): boolean {
        const token = this.getStoredToken();
        if (!token) {
            return false;
        }
        return !this.isTokenExpired(token);
    }    /**
     * Save token with expiration information
     */
    saveToken(token: OAuthToken): void {
        const now = Date.now();
        
        // Calculate expiration time - use the shorter of server expiration or custom max lifetime
        let expiresAt = now + (token.expires_in * 1000); // Convert seconds to milliseconds
        
        if (this.maxTokenLifetime) {
            const customExpiresAt = now + this.maxTokenLifetime;
            expiresAt = Math.min(expiresAt, customExpiresAt);
        }
        
        const storedToken: StoredOAuthToken = {
            ...token,
            created_at: now,
            expires_at: expiresAt
        };

        // Ensure directory exists
        const tokenDir = path.dirname(this.tokenPath);
        if (!fs.existsSync(tokenDir)) {
            fs.mkdirSync(tokenDir, { recursive: true });
        }

        fs.writeFileSync(this.tokenPath, JSON.stringify(storedToken, null, 2), 'utf8');
    }

    /**
     * Delete stored token
     */
    deleteStoredToken(): void {
        if (this.hasStoredToken()) {
            fs.unlinkSync(this.tokenPath);
        }
    }

    /**
     * Refresh an expired token using the refresh token.
     *
     * Returns:
     *   - OAuthToken on success
     *   - null on a HARD failure (4xx from the token endpoint — refresh
     *     token revoked / invalid / consent withdrawn). Caller should fall
     *     back to full re-auth.
     *
     * Throws on transient network failures (`fetch failed`, DNS, 5xx) so
     * the caller can retry without nuking the refresh-token credential
     * and dragging the user through a browser prompt for a network blip.
     * A single `TypeError: fetch failed` used to cascade into a full
     * OAuth flow — that was the recurring "I got an auth message" bug.
     */
    async refreshToken(client: OAuthClient, refreshToken: string): Promise<OAuthToken | null> {
        const refreshBody = querystring.stringify({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: client.clientId,
            client_secret: client.clientSecret
        });

        // Retry transient network errors (fetch failed, DNS, 5xx) up to 3
        // attempts with exponential backoff: 1s, 3s, 9s.
        const MAX_ATTEMPTS = 3;
        let lastErr: unknown = null;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                const response = await fetch(client.tokenUri, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: refreshBody
                });

                if (response.ok) {
                    return await response.json() as OAuthToken;
                }

                // 4xx — token is genuinely invalid (revoked, etc). Hard
                // failure; caller falls back to re-auth.
                if (response.status >= 400 && response.status < 500) {
                    const errorText = await response.text();
                    console.error('Token refresh failed (hard):', response.status, response.statusText, errorText);
                    return null;
                }

                // 5xx — Google's side, transient. Retry.
                const errorText = await response.text();
                lastErr = new Error(`token endpoint ${response.status}: ${errorText}`);
                console.error(`Token refresh attempt ${attempt}/${MAX_ATTEMPTS} got ${response.status}: ${response.statusText}`);
            } catch (error) {
                // Network-level failure — TypeError: fetch failed, ENOTFOUND, etc.
                lastErr = error;
                console.error(`Token refresh attempt ${attempt}/${MAX_ATTEMPTS} network error:`, error);
            }

            if (attempt < MAX_ATTEMPTS) {
                const delayMs = 1000 * Math.pow(3, attempt - 1);
                await new Promise(r => setTimeout(r, delayMs));
            }
        }

        // All retries exhausted on transient errors — throw so the caller
        // doesn't mistake this for a hard token-invalid case and trigger
        // re-auth. Caller decides whether to retry later or surface the
        // failure to the user without nuking the refresh token.
        throw lastErr instanceof Error ? lastErr : new Error('Token refresh failed after retries');
    }

    /**
     * Get a valid token (existing, refreshed, or null if authentication needed)
     * This method does not perform initial authentication - that's left to the caller
     */
    async getValidToken(client: OAuthClient, onAuthenticationNeeded?: () => Promise<OAuthToken | null>): Promise<OAuthToken | null> {
        // Check for existing token
        const existingToken = this.getStoredToken();
        
        if (existingToken) {
            // Check if token is still valid
            if (!this.isTokenExpired(existingToken)) {
                return existingToken;
            }
            
            // Try to refresh the token if we have a refresh token.
            // refreshToken() distinguishes:
            //   - hard failure (4xx) → returns null → fall through to re-auth
            //   - transient failure (network, 5xx) → throws → propagate so
            //     the caller can retry later. CRUCIAL: do NOT fall through
            //     to the browser-prompt re-auth path on a network blip.
            if (existingToken.refresh_token) {
                const refreshedToken = await this.refreshToken(client, existingToken.refresh_token);
                if (refreshedToken) {
                    // Preserve the refresh token if not provided in the response
                    if (!refreshedToken.refresh_token && existingToken.refresh_token) {
                        refreshedToken.refresh_token = existingToken.refresh_token;
                    }
                    this.saveToken(refreshedToken);
                    return refreshedToken;
                }
            }
        }
        
        // No valid token available, call authentication callback if provided
        if (onAuthenticationNeeded) {
            const newToken = await onAuthenticationNeeded();
            if (newToken) {
                this.saveToken(newToken);
                return newToken;
            }
        }
        
        return null;
    }

    /**
     * Get token information for debugging
     */
    getTokenInfo(): {
        exists: boolean;
        valid: boolean;
        expiresAt?: Date;
        createdAt?: Date;
        hasRefreshToken?: boolean;
    } {
        const token = this.getStoredToken();
        
        if (!token) {
            return { exists: false, valid: false };
        }

        return {
            exists: true,
            valid: !this.isTokenExpired(token),
            expiresAt: token.expires_at ? new Date(token.expires_at) : undefined,
            createdAt: token.created_at ? new Date(token.created_at) : undefined,
            hasRefreshToken: !!token.refresh_token
        };
    }
}

export default OAuthTokenManager;

/**
 * Generic OAuth Token Getter
 * Handles the OAuth flow to get tokens for any provider
 */

export interface OAuthCredentials {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
    auth_uri: string;
    token_uri: string;
}

export interface OAuthGetTokenOptions {
    scope: string;
    timeoutSeconds?: number;
    includeOfflineAccess?: boolean;
    loginHint?: string;  /** Pre-select this email in Google account picker */
    prompt?: 'none' | 'consent' | 'select_account';  /** Force account selection or consent */
    signal?: AbortSignal;  // Allow cancellation of OAuth flow
}

/**
 * Generic OAuth token acquisition class
 * Handles the OAuth flow for any OAuth provider
 */
/** Callback for OAuth progress/error messages. Default: errors to console.error, info silent. */
export type OAuthLogFn = (type: 'info' | 'error', message: string) => void;

const defaultLogFn: OAuthLogFn = (type, msg) => { if (type === 'error') console.error(msg); };

export class OAuthGetToken {
    private credentials: OAuthCredentials;
    private successHtmlPath: string;
    private errorHtmlPath: string;
    private log: OAuthLogFn;

    constructor(credentials: OAuthCredentials, logFn?: OAuthLogFn) {
        this.credentials = credentials;
        this.log = logFn || defaultLogFn;
        this.successHtmlPath = path.join(import.meta.dirname, 'oauth-success.html');
        this.errorHtmlPath = path.join(import.meta.dirname, 'oauth-error.html');
    }

    /**
     * Load credentials from a JSON file
     */
    static loadCredentialsFromFile(filePath: string, credentialsKey?: string): OAuthCredentials | null {
        if (!fs.existsSync(filePath)) {
            console.error(`Credentials file not found: ${filePath}`);
            return null;
        }

        try {
            const credentialsContent = fs.readFileSync(filePath, 'utf8');
            const credentialsJson = JSON.parse(credentialsContent);
            
            // Support different credential structures (e.g., Google's "installed" key)
            const credentials = credentialsKey ? credentialsJson[credentialsKey] : credentialsJson;
            
            if (!credentials.client_id || !credentials.client_secret || !credentials.auth_uri || !credentials.token_uri) {
                throw new Error('Invalid credentials format - missing required fields');
            }
            
            return credentials as OAuthCredentials;
        } catch (error) {
            console.error(`Error loading credentials: ${error}`);
            return null;
        }
    }

    /**
     * Start local HTTP server for OAuth redirect
     */
    private startLocalOAuthServer(redirectUri: string): Promise<http.Server> {
        return new Promise((resolve, reject) => {
            const server = http.createServer();
            const urlParts = new URL(redirectUri);
            const port = parseInt(urlParts.port) || 8080;
            
            this.log('info', `Starting local OAuth server on ${redirectUri}`);

            // Bind explicitly to 127.0.0.1, NOT the default (::) — on Linux the
            // browser resolves "localhost" to 127.0.0.1 (IPv4) while Node's
            // default IPv6 socket has IPV6_V6ONLY set, so the GET never reaches
            // us and the auth page hangs at "Waiting for localhost".
            server.listen(port, '127.0.0.1', () => {
                this.log('info', `Started local OAuth server on 127.0.0.1:${port}`);
                resolve(server);
            });
            
            server.on('error', (error) => {
                this.log('error', `Failed to start local server: ${error.message}`);
                reject(error);
            });
        });
    }

    /**
     * Wait for OAuth callback - Uses modern WHATWG URL API
     */
    private waitForOAuthCallback(server: http.Server, timeoutSeconds: number = 300, signal?: AbortSignal, acceptStdin = false): Promise<string | null> {
        return new Promise((resolve) => {
            this.log('info', `Waiting for OAuth callback (timeout: ${timeoutSeconds} seconds)...`);
            let resolved = false;

            const done = (code: string | null): void => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timeout);
                rl?.close();
                resolve(code);
            };

            const timeout = setTimeout(() => {
                this.log('error', 'Timeout waiting for OAuth callback');
                done(null);
            }, timeoutSeconds * 1000);

            // Handle abort signal
            if (signal) {
                signal.addEventListener('abort', () => {
                    this.log('info', 'OAuth callback cancelled by user');
                    done(null);
                });
            }

            // Accept auth code pasted to stdin (for headless systems)
            let rl: readline.Interface | null = null;
            if (acceptStdin && process.stdin.isTTY) {
                rl = readline.createInterface({ input: process.stdin });
                this.log('info', 'Or paste the authorization code here:');
                rl.on('line', (line: string) => {
                    const input = line.trim();
                    if (!input) return;
                    // Input could be the full redirect URL or just the code
                    let code = input;
                    try {
                        const url = new URL(input);
                        code = url.searchParams.get('code') || input;
                    } catch {
                        // Not a URL — treat as raw code
                    }
                    this.log('info', 'Authorization code received from stdin');
                    done(code);
                });
            }

            server.on('request', (req, res) => {
                if (!req.url) return;

                // Use modern WHATWG URL API instead of deprecated url.parse()
                const address = server.address();
                const port = typeof address === 'object' && address ? address.port : 3000;
                const parsedUrl = new URL(req.url, `http://localhost:${port}`);
                const query = Object.fromEntries(parsedUrl.searchParams.entries());

                if (query.code) {
                    const authCode = query.code as string;

                    // Send success response to browser with aggressive auto-close
                    const responseString = fs.readFileSync(this.successHtmlPath, 'utf8');

                    res.writeHead(200, { 'Content-Type': 'text/html', 'Connection': 'close' });
                    res.end(responseString, () => {
                        done(authCode);
                    });
                } else if (query.error) {
                    const error = query.error as string;
                    this.log('error', `OAuth error: ${error}`);

                    // Send error response to browser
                    const responseString = fs.readFileSync(this.errorHtmlPath, 'utf8')
                        .replace('{{ERROR}}', error);

                    res.writeHead(400, { 'Content-Type': 'text/html', 'Connection': 'close' });
                    res.end(responseString, () => {
                        done(null);
                    });
                }
            });
        });
    }

    /**
     * Open browser to authorization URL
     */
    private async openBrowser(url: string): Promise<boolean> {
        try {
            let command: string;
            if (process.platform === 'win32') {
                command = `start "" "${url}"`;
            } else if (process.platform === 'darwin') {
                command = `open "${url}"`;
            } else {
                command = `xdg-open "${url}"`;
            }

            await execAsync(command);
            this.log('info', 'Browser opened for authorization');
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Get an OAuth token through the authorization code flow
     */
    async getToken(options: OAuthGetTokenOptions): Promise<OAuthToken | null> {
        this.log('info', 'Initiating OAuth2 authentication...');
        
        const redirectUri = this.credentials.redirect_uris[0];
        let server: http.Server;
        let authCode: string | null = null;
        
        try {
            server = await this.startLocalOAuthServer(redirectUri);
            
            // Create OAuth2 authorization URL
            const authParams = new URLSearchParams({
                client_id: this.credentials.client_id,
                redirect_uri: redirectUri,
                scope: options.scope,
                response_type: 'code'
            });

            if (options.includeOfflineAccess) {
                authParams.set('access_type', 'offline');
            }
            if (options.loginHint) {
                authParams.set('login_hint', options.loginHint);
            }
            if (options.prompt) {
                authParams.set('prompt', options.prompt);
            }

            const authUrl = `${this.credentials.auth_uri}?${authParams.toString()}`;
            
            this.log('info', 'Opening browser to authorize the application...');
            this.log('info', `Authorization URL: ${authUrl}`);
            
            // Try to open browser automatically
            const browserOpened = await this.openBrowser(authUrl);
            if (!browserOpened) {
                this.log('info', '\nNo browser available. To authorize:');
                this.log('info', '  1. Open the Authorization URL above in any browser');
                this.log('info', '  2. Complete the consent flow');
                this.log('info', '  3. Paste the redirect URL or authorization code below\n');
            }

            // Wait for OAuth callback (accept stdin paste when no browser)
            authCode = await this.waitForOAuthCallback(server, options.timeoutSeconds || 300, options.signal, !browserOpened);
            
        } catch (error) {
            this.log('error', `Failed to start local OAuth server: ${error}`);
            return null;
        } finally {
            if (server!) {
                server.close();
                this.log('info', 'OAuth server stopped');
            }
        }
        
        if (!authCode) {
            this.log('error', 'Failed to get authorization code');
            return null;
        }
        
        // Exchange authorization code for access token
        const tokenBody = querystring.stringify({
            client_id: this.credentials.client_id,
            client_secret: this.credentials.client_secret,
            code: authCode,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri
        });
        
        try {
            const response = await fetch(this.credentials.token_uri, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: tokenBody
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
            }
            
            const tokenResponse = await response.json() as OAuthToken;
            return tokenResponse;
        } catch (error) {
            this.log('error', `Authentication failed: ${error}`);
            return null;
        }
    }
}

/**
 * Universal OAuth authenticator - works with any OAuth provider
 * Handles provider-specific credential formats automatically
 *
 * Smart defaults for long-lived access:
 * - includeOfflineAccess defaults to true (requests refresh token)
 * - When refresh token is needed but not stored, auto-forces consent prompt
 * - Access tokens auto-refresh in background using refresh token
 * - Users only re-authenticate when refresh token is revoked or maxTokenLifetimeHours exceeded
 */
export async function authenticateOAuth(
    credentialsPathOrData: string | OAuthCredentials | object,
    options: {
        scope: string;
        tokenDirectory?: string;
        tokenFileName?: string;
        credentialsKey?: string;  /** For nested credentials like Google's "installed" or "web" */
        timeoutSeconds?: number;  /** Timeout for OAuth flow (default: 300 seconds) */
        includeOfflineAccess?: boolean;  /** Request refresh token for long-lived access (default: true) */
        maxTokenLifetimeHours?: number;  /** Max lifetime before re-auth required (default: unlimited, uses refresh token) */
        loginHint?: string;  /** Pre-select this email in account picker */
        prompt?: 'none' | 'consent' | 'select_account';  /** Force specific prompt; auto-detects 'consent' when refresh token needed */
        signal?: AbortSignal;  /** Allow cancellation of OAuth flow */
        logFn?: OAuthLogFn;  /** Message callback; default: errors to stderr, info silent */
    }
): Promise<OAuthToken | null> {
    // Serialize by tokenDirectory — only one OAuth flow at a time per token location
    const lockKey = options.tokenDirectory || "default";
    const log = options.logFn || defaultLogFn;
    const pending = pendingOAuth.get(lockKey);
    if (pending) {
        log('info', `  [oauth] Waiting for existing auth flow (${lockKey})`);
        return pending;
    }

    // Re-auth backoff: a recent flow failed/timed out — don't reopen the
    // browser. Returning null lets the caller show a single "re-authenticate"
    // banner instead of spawning a consent tab on every sync cycle.
    const lastFail = failedOAuthBackoff.get(lockKey) || 0;
    const sinceFail = Date.now() - lastFail;
    if (sinceFail < REAUTH_BACKOFF_MS) {
        const mins = Math.ceil((REAUTH_BACKOFF_MS - sinceFail) / 60000);
        log('info', `  [oauth] Skipping browser — re-auth backoff (${mins}m left for ${lockKey}). Use the re-authenticate banner to retry now.`);
        return null;
    }

    const result = _authenticateOAuth(credentialsPathOrData, options);
    pendingOAuth.set(lockKey, result);
    try {
        const token = await result;
        if (token) {
            failedOAuthBackoff.delete(lockKey);          // success — clear backoff
        } else {
            failedOAuthBackoff.set(lockKey, Date.now()); // failed/timed out — back off
        }
        return token;
    } catch (e) {
        failedOAuthBackoff.set(lockKey, Date.now());     // threw — back off too
        throw e;
    } finally {
        pendingOAuth.delete(lockKey);
    }
}

/** Clear the re-auth backoff for a token location so the next call opens the
 *  browser immediately. Wired to the "Re-authenticate" banner button — the
 *  user explicitly asking to re-auth should bypass the backoff. */
export function clearReauthBackoff(tokenDirectory?: string): void {
    failedOAuthBackoff.delete(tokenDirectory || "default");
}

async function _authenticateOAuth(
    credentialsPathOrData: string | OAuthCredentials | object,
    options: {
        scope: string;
        tokenDirectory?: string;
        tokenFileName?: string;
        credentialsKey?: string;
        timeoutSeconds?: number;
        includeOfflineAccess?: boolean;
        maxTokenLifetimeHours?: number;
        loginHint?: string;
        prompt?: 'none' | 'consent' | 'select_account';
        signal?: AbortSignal;
        logFn?: OAuthLogFn;
    }
): Promise<OAuthToken | null> {
    const log = options.logFn || defaultLogFn;
    let credentials: OAuthCredentials;
    
    // Handle credentials input - file path, nested object, or direct object
    if (typeof credentialsPathOrData === 'string') {
        // File path - try with credentialsKey first, then without
        const loadedCredentials = OAuthGetToken.loadCredentialsFromFile(
            credentialsPathOrData, 
            options.credentialsKey
        );
        if (!loadedCredentials) {
            log('error', 'Failed to load credentials from file');
            return null;
        }
        credentials = loadedCredentials;
    } else if (options.credentialsKey && options.credentialsKey in credentialsPathOrData) {
        // Nested credentials (e.g., Google's "installed" key)
        credentials = (credentialsPathOrData as any)[options.credentialsKey];
    } else if ('installed' in credentialsPathOrData) {
        // Auto-detect Google's "installed" structure
        credentials = (credentialsPathOrData as any).installed;
    } else if ('web' in credentialsPathOrData) {
        // Auto-detect Google's "web" structure  
        credentials = (credentialsPathOrData as any).web;
    } else {
        // Direct credentials object
        credentials = credentialsPathOrData as OAuthCredentials;
    }

    // Validate credentials
    if (!credentials.client_id || !credentials.client_secret || !credentials.auth_uri || !credentials.token_uri) {
        log('error', 'Invalid credentials format - missing required OAuth fields');
        return null;
    }

    // Set up token manager
    const tokenManager = new OAuthTokenManager({
        tokenDirectory: options.tokenDirectory || process.cwd(),
        tokenFileName: options.tokenFileName || 'oauth-token.json',
        maxTokenLifetimeHours: options.maxTokenLifetimeHours
    });

    // Create OAuth client for token management
    const oauthClient = {
        clientId: credentials.client_id,
        clientSecret: credentials.client_secret,
        tokenUri: credentials.token_uri
    };

    // Create OAuth authenticator
    const authenticator = new OAuthGetToken(credentials, log);

    // Check if we need to force consent to get a refresh token
    // This is needed when includeOfflineAccess is requested but stored token lacks refresh_token
    const wantOfflineAccess = options.includeOfflineAccess !== false;  // Default true
    const existingToken = tokenManager.getStoredToken();
    const needsRefreshToken = wantOfflineAccess && existingToken && !existingToken.refresh_token;

    if (needsRefreshToken) {
        log('info', 'Stored token lacks refresh_token - will request consent to obtain one');
    }

    // Get valid token (will authenticate if needed)
    const token = await tokenManager.getValidToken(oauthClient, async () => {
        log('info', 'No valid token found, starting OAuth authentication...');

        // Determine prompt strategy:
        // - If caller specified a prompt, use it
        // - If we need a refresh token (offline access requested but none stored), force consent
        // - Otherwise, let the OAuth server decide
        let effectivePrompt = options.prompt;
        if (!effectivePrompt && wantOfflineAccess) {
            // Force consent if no stored token OR stored token lacks refresh_token
            const storedToken = tokenManager.getStoredToken();
            if (!storedToken || !storedToken.refresh_token) {
                effectivePrompt = 'consent';
                log('info', 'Forcing consent prompt to obtain refresh token for offline access');
            }
        }

        const authOptions: OAuthGetTokenOptions = {
            scope: options.scope,
            timeoutSeconds: options.timeoutSeconds || 300,
            includeOfflineAccess: wantOfflineAccess,
            loginHint: options.loginHint,
            prompt: effectivePrompt,
            signal: options.signal
        };

        return await authenticator.getToken(authOptions);
    });

    if (!token) {
        log('error', 'Authentication failed');
    }

    return token;
}

/**
 * Utility function to create credentials from a JSON string
 */
export function parseCredentialsFromString(jsonString: string, credentialsKey?: string): OAuthCredentials | null {
    try {
        const parsed = JSON.parse(jsonString);
        const credentials = credentialsKey ? parsed[credentialsKey] : parsed;
        
        if (!credentials.client_id || !credentials.client_secret || !credentials.auth_uri || !credentials.token_uri) {
            throw new Error('Invalid credentials format - missing required fields');
        }
        
        return credentials as OAuthCredentials;
    } catch (error) {
        console.error('Error parsing credentials string:', error);
        return null;
    }
}


