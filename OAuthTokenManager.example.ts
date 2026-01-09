/**
 * Example usage of the generic OAuthTokenManager
 * This demonstrates how the token manager can be used for any OAuth provider
 */

import OAuthTokenManager, { OAuthClient, OAuthToken } from './OAuthTokenManager.ts';

// Example: Using with Google OAuth
const googleClient: OAuthClient = {
    clientId: 'your-google-client-id',
    clientSecret: 'your-google-client-secret',
    tokenUri: 'https://oauth2.googleapis.com/token'
};

// Example: Using with GitHub OAuth
const githubClient: OAuthClient = {
    clientId: 'your-github-client-id',
    clientSecret: 'your-github-client-secret',
    tokenUri: 'https://github.com/login/oauth/access_token'
};

// Example: Using with Microsoft OAuth
const microsoftClient: OAuthClient = {
    clientId: 'your-microsoft-client-id',
    clientSecret: 'your-microsoft-client-secret',
    tokenUri: 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
};

async function exampleUsage() {
    // Create token managers for different services
    const googleTokenManager = new OAuthTokenManager({
        tokenFileName: 'google-token.json',
        expirationBufferMinutes: 5
    });

    const githubTokenManager = new OAuthTokenManager({
        tokenFileName: 'github-token.json',
        expirationBufferMinutes: 10
    });

    // Example: Get valid token with custom authentication flow
    const googleToken = await googleTokenManager.getValidToken(googleClient, async () => {
        // Your custom authentication logic here
        console.log('Need to authenticate with Google...');
        // This would implement your OAuth flow (web server, device flow, etc.)
        return await performGoogleAuth();
    });

    if (googleToken) {
        console.log('Google token is ready to use!');
        
        // Get token info
        const tokenInfo = googleTokenManager.getTokenInfo();
        console.log('Token info:', tokenInfo);
    }

    // Example: Check if token is valid without getting it
    if (githubTokenManager.isTokenValid()) {
        console.log('GitHub token is valid');
    } else {
        console.log('GitHub token needs refresh or authentication');
    }

    // Example: Manually refresh a token
    const existingToken = githubTokenManager.getStoredToken();
    if (existingToken?.refresh_token) {
        const refreshedToken = await githubTokenManager.refreshToken(githubClient, existingToken.refresh_token);
        if (refreshedToken) {
            githubTokenManager.saveToken(refreshedToken);
            console.log('GitHub token refreshed successfully');
        }
    }
}

// Mock authentication function for demonstration
async function performGoogleAuth(): Promise<OAuthToken | null> {
    // This is where you would implement your OAuth flow
    // For example: device flow, authorization code flow, etc.
    return {
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'https://www.googleapis.com/auth/contacts.readonly'
    };
}

// Uncomment to run the example
// exampleUsage().catch(console.error);
