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

const execAsync = promisify(exec);

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
     * Refresh an expired token using the refresh token
     */
    async refreshToken(client: OAuthClient, refreshToken: string): Promise<OAuthToken | null> {
        const refreshBody = querystring.stringify({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: client.clientId,
            client_secret: client.clientSecret
        });

        try {
            const response = await fetch(client.tokenUri, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: refreshBody
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('Token refresh failed:', response.status, response.statusText, errorText);
                return null;
            }

            const tokenResponse = await response.json() as OAuthToken;
            return tokenResponse;

        } catch (error) {
            console.error('Error refreshing token:', error);
            return null;
        }
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
            
            // Try to refresh the token if we have a refresh token
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
export class OAuthGetToken {
    private credentials: OAuthCredentials;

    constructor(credentials: OAuthCredentials) {
        this.credentials = credentials;
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
            
            console.log(`Starting local OAuth server on ${redirectUri}`);
            
            server.listen(port, () => {
                console.log(`Started local OAuth server on port ${port}`);
                resolve(server);
            });
            
            server.on('error', (error) => {
                console.error(`Failed to start local server: ${error.message}`);
                reject(error);
            });
        });
    }

    /**
     * Wait for OAuth callback - Uses modern WHATWG URL API
     */
    private waitForOAuthCallback(server: http.Server, timeoutSeconds: number = 300, signal?: AbortSignal): Promise<string | null> {
        return new Promise((resolve) => {
            console.log(`Waiting for OAuth callback (timeout: ${timeoutSeconds} seconds)...`);
            
            const timeout = setTimeout(() => {
                console.error('Timeout waiting for OAuth callback');
                resolve(null);
            }, timeoutSeconds * 1000);

            // Handle abort signal
            if (signal) {
                signal.addEventListener('abort', () => {
                    console.log('OAuth callback cancelled by user');
                    clearTimeout(timeout);
                    resolve(null);
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
                    
                    // Send success response to browser
                    const responseString = `
<html>
<head><title>Authorization Successful</title></head>
<body>
<h1>Authorization Successful!</h1>
<p>You can close this browser window and return to the console.</p>
<script>setTimeout(function(){window.close();}, 3000);</script>
</body>
</html>`;
                    
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(responseString);
                    
                    console.log('Authorization code received successfully!');
                    clearTimeout(timeout);
                    resolve(authCode);
                } else if (query.error) {
                    const error = query.error as string;
                    console.error(`OAuth error: ${error}`);
                    
                    // Send error response to browser
                    const responseString = `
<html>
<head><title>Authorization Failed</title></head>
<body>
<h1>Authorization Failed</h1>
<p>Error: ${error}</p>
<p>You can close this browser window.</p>
</body>
</html>`;
                    
                    res.writeHead(400, { 'Content-Type': 'text/html' });
                    res.end(responseString);
                    
                    clearTimeout(timeout);
                    resolve(null);
                }
            });
        });
    }

    /**
     * Open browser to authorization URL
     */
    private async openBrowser(url: string): Promise<void> {
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
            console.log('Browser opened for authorization');
        } catch (error) {
            console.log('Could not automatically open browser. Please manually visit the URL above.');
        }
    }

    /**
     * Get an OAuth token through the authorization code flow
     */
    async getToken(options: OAuthGetTokenOptions): Promise<OAuthToken | null> {
        console.log('Initiating OAuth2 authentication...');
        
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
            
            console.log('Opening browser to authorize the application...');
            console.log(`Authorization URL: ${authUrl}`);
            
            // Try to open browser automatically
            await this.openBrowser(authUrl);
            
            // Wait for OAuth callback
            authCode = await this.waitForOAuthCallback(server, options.timeoutSeconds || 300, options.signal);
            
        } catch (error) {
            console.error(`Failed to start local OAuth server: ${error}`);
            return null;
        } finally {
            if (server!) {
                server.close();
                console.log('OAuth server stopped');
            }
        }
        
        if (!authCode) {
            console.error('Failed to get authorization code');
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
            console.log('Authentication successful!');
            return tokenResponse;
        } catch (error) {
            console.error(`Authentication failed: ${error}`);
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
    }
): Promise<OAuthToken | null> {
    let credentials: OAuthCredentials;
    
    // Handle credentials input - file path, nested object, or direct object
    if (typeof credentialsPathOrData === 'string') {
        // File path - try with credentialsKey first, then without
        const loadedCredentials = OAuthGetToken.loadCredentialsFromFile(
            credentialsPathOrData, 
            options.credentialsKey
        );
        if (!loadedCredentials) {
            console.error('Failed to load credentials from file');
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
        console.error('Invalid credentials format - missing required OAuth fields');
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
    const authenticator = new OAuthGetToken(credentials);

    // Check if we need to force consent to get a refresh token
    // This is needed when includeOfflineAccess is requested but stored token lacks refresh_token
    const wantOfflineAccess = options.includeOfflineAccess !== false;  // Default true
    const existingToken = tokenManager.getStoredToken();
    const needsRefreshToken = wantOfflineAccess && existingToken && !existingToken.refresh_token;

    if (needsRefreshToken) {
        console.log('Stored token lacks refresh_token - will request consent to obtain one');
    }

    // Get valid token (will authenticate if needed)
    const token = await tokenManager.getValidToken(oauthClient, async () => {
        console.log('No valid token found, starting OAuth authentication...');

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
                console.log('Forcing consent prompt to obtain refresh token for offline access');
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

    if (token) {
        console.log('✅ Authentication successful!');
    } else {
        console.error('❌ Authentication failed');
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


