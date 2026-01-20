# OAuthTokenManager

A generic OAuth token management module that handles token storage, validation, and refresh for any OAuth 2.0 provider.

## Features

- **Generic OAuth Support**: Works with any OAuth 2.0 provider (Google, GitHub, Microsoft, etc.)
- **Automatic Token Refresh**: Automatically refreshes expired tokens using refresh tokens
- **Token Validation**: Checks token expiration with configurable buffer time
- **Secure Storage**: Stores tokens in JSON files with expiration metadata
- **No Provider Dependencies**: No hardcoded knowledge of specific OAuth providers
- **TypeScript Support**: Full TypeScript definitions and type safety

## Installation

The module is self-contained and only depends on Node.js built-in modules.

## Usage

### Basic Setup

```typescript
import OAuthTokenManager, { OAuthClient } from './OAuthTokenManager.ts';

// Define your OAuth client configuration
const client: OAuthClient = {
    clientId: 'your-client-id',
    clientSecret: 'your-client-secret',
    tokenUri: 'https://oauth2.provider.com/token'
};

// Create token manager
const tokenManager = new OAuthTokenManager({
    tokenFileName: 'my-service-token.json',
    tokenDirectory: './tokens',
    expirationBufferMinutes: 5 // Refresh tokens 5 minutes before expiry
});
```

### Getting a Valid Token

```typescript
const token = await tokenManager.getValidToken(client, async () => {
    // Your authentication logic here
    // This callback is only called if no valid token exists
    return await performOAuthFlow();
});

if (token) {
    // Use the token for API calls
    console.log('Access token:', token.access_token);
}
```

### Manual Token Operations

```typescript
// Check if a valid token exists
if (tokenManager.isTokenValid()) {
    console.log('Token is valid');
}

// Get stored token
const storedToken = tokenManager.getStoredToken();

// Save a new token
tokenManager.saveToken({
    access_token: 'new-token',
    refresh_token: 'refresh-token',
    expires_in: 3600,
    token_type: 'Bearer'
});

// Get token information
const info = tokenManager.getTokenInfo();
console.log('Token expires at:', info.expiresAt);

// Delete stored token
tokenManager.deleteStoredToken();
```

### Manual Token Refresh

```typescript
const existingToken = tokenManager.getStoredToken();
if (existingToken?.refresh_token) {
    const refreshedToken = await tokenManager.refreshToken(client, existingToken.refresh_token);
    if (refreshedToken) {
        tokenManager.saveToken(refreshedToken);
    }
}
```

## Configuration Options

```typescript
interface TokenManagerOptions {
    tokenFileName?: string;           // Default: 'token.json'
    tokenDirectory?: string;          // Default: current directory
    expirationBufferMinutes?: number; // Default: 5 minutes
    maxTokenLifetimeHours?: number;   // Maximum token lifetime in hours (optional)
}
```

### Custom Token Lifetime

You can set a maximum lifetime for tokens to control how often users need to re-authenticate, regardless of the OAuth server's expiration time:

```typescript
const tokenManager = new OAuthTokenManager({
    tokenFileName: 'my-token.json',
    tokenDirectory: './tokens',
    maxTokenLifetimeHours: 720  // 30 days - user authenticates once per month
});
```

Common lifetime examples:
- `1` - 1 hour (high security, frequent re-auth)
- `24` - 1 day (daily authentication)
- `168` - 1 week (weekly authentication)  
- `720` - 30 days (monthly authentication)
- `undefined` - Use OAuth server's default expiration

The actual token lifetime will be the **minimum** of:
1. Your custom `maxTokenLifetimeHours` setting
2. The OAuth server's `expires_in` value

This gives you control over the user experience while respecting server-imposed limits.

### Simple Authentication with `authenticateOAuth`

For quick setup, use the `authenticateOAuth` function:

```typescript
import { authenticateOAuth } from './OAuthTokenManager.ts';

const token = await authenticateOAuth('path/to/credentials.json', {
    scope: 'https://www.googleapis.com/auth/contacts.readonly',
    tokenFileName: 'google-contacts-token.json',
    credentialsKey: 'installed',           // For Google's credentials format
    maxTokenLifetimeHours: 720,            // 30 days
    includeOfflineAccess: true
});
```
```

## Provider Examples

### Google OAuth

```typescript
const googleClient: OAuthClient = {
    clientId: 'your-google-client-id',
    clientSecret: 'your-google-client-secret',
    tokenUri: 'https://oauth2.googleapis.com/token'
};
```

### GitHub OAuth

```typescript
const githubClient: OAuthClient = {
    clientId: 'your-github-client-id',
    clientSecret: 'your-github-client-secret',
    tokenUri: 'https://github.com/login/oauth/access_token'
};
```

### Microsoft OAuth

```typescript
const microsoftClient: OAuthClient = {
    clientId: 'your-microsoft-client-id',
    clientSecret: 'your-microsoft-client-secret',
    tokenUri: 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
};
```

## Token Storage Format

Tokens are stored with additional metadata:

```json
{
    "access_token": "ya29.a0AfH6SMC...",
    "refresh_token": "1//04...",
    "expires_in": 3599,
    "token_type": "Bearer",
    "scope": "https://www.googleapis.com/auth/contacts.readonly",
    "created_at": 1640995200000,
    "expires_at": 1640998799000
}
```

## Error Handling

The token manager handles errors gracefully:

- Invalid token files are ignored and treated as no token
- Failed refresh attempts return `null`
- Network errors during refresh are logged and return `null`
- Missing directories are created automatically

## Security Considerations

- Token files are stored with sensitive information - ensure proper file permissions
- Consider encrypting token files for production use
- Use HTTPS for all OAuth communications
- Regularly rotate client secrets according to provider recommendations

## Integration with GoogleContactsHelper

The `GoogleContactsHelper` class has been updated to use this token manager:

```typescript
// The helper automatically manages tokens
const helper = new GoogleContactsHelper('credentials.json', 'json');
await helper.run(); // Will reuse existing valid tokens or refresh as needed
```
