# Setting Up Google OAuth for Applications

This guide explains how to create Google Cloud projects, register OAuth credentials, and configure applications to use the oauthsupport library.

## Overview

Google OAuth requires:
1. A Google Cloud Project
2. OAuth consent screen configuration
3. OAuth 2.0 Client credentials (client_id, client_secret)
4. Registered redirect URIs for your application

## Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click the project dropdown (top-left) > **New Project**
3. Enter a project name (e.g., `pssyncer`, `myapp-oauth`)
4. Click **Create**

**Example:** The `pssyncer` project is used for Google Contacts synchronization tools.

## Step 2: Enable Required APIs

1. Go to **APIs & Services** > **Library**
2. Search for and enable the APIs your app needs:
   - **People API** - for Google Contacts access
   - **Gmail API** - for email access
   - **Google Drive API** - for Drive access
   - etc.

## Step 3: Configure OAuth Consent Screen

1. Go to **APIs & Services** > **OAuth consent screen**
2. Choose user type:
   - **Internal** - only for Google Workspace users in your org
   - **External** - for any Google account (requires verification for sensitive scopes)
3. Fill in required fields:
   - App name
   - User support email
   - Developer contact email
4. Add scopes your app needs (can be modified later)
5. Add test users if in testing mode

## Step 4: Create OAuth Credentials

1. Go to **APIs & Services** > **Credentials**
2. Click **+ CREATE CREDENTIALS** > **OAuth client ID**
3. Choose application type:
   - **Web application** - for apps with a callback server (recommended for oauthsupport)
   - **Desktop app** - for installed applications
4. Configure:
   - **Name**: Descriptive name (e.g., "gcards CLI")
   - **Authorized redirect URIs**: Add your callback URLs

### Redirect URI Configuration

For oauthsupport, add localhost callbacks:

```
http://localhost:9326/oauth2callback
```

You can add multiple ports for different apps or fallback:
```
http://localhost:9326/oauth2callback
http://localhost:9327/oauth2callback
http://localhost:9328/oauth2callback
```

**Example from pssyncer project:**
```json
"redirect_uris": [
    "http://localhost:9326/oauth2callback",
    "https://rmf39.aaz.lt/oauth2callback",
    "https://rmf39.aaz.lt:9326/oauth2callback"
]
```

5. Click **Create**
6. Download the JSON credentials file

## Step 5: Create credentials.json

The downloaded file will look like:

```json
{
    "web": {
        "client_id": "429727675531-xxxxx.apps.googleusercontent.com",
        "project_id": "pssyncer",
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
        "client_secret": "GOCSPX-xxxxxxxxxx",
        "redirect_uris": [
            "http://localhost:9326/oauth2callback"
        ]
    }
}
```

Place this file in your application directory (ensure it's in `.gitignore`!).

## Step 6: Use with oauthsupport

```typescript
import { authenticateOAuth } from '@bobfrankston/oauthsupport';

const token = await authenticateOAuth('credentials.json', {
    scope: 'https://www.googleapis.com/auth/contacts.readonly',
    tokenDirectory: './tokens',
    tokenFileName: 'google-token.json',
    credentialsKey: 'web'  // or 'installed' for desktop apps
});
```

## Common Scopes

| Scope | Description |
|-------|-------------|
| `https://www.googleapis.com/auth/contacts.readonly` | Read contacts |
| `https://www.googleapis.com/auth/contacts` | Read/write contacts |
| `https://www.googleapis.com/auth/gmail.readonly` | Read Gmail |
| `https://www.googleapis.com/auth/drive.readonly` | Read Drive files |
| `https://www.googleapis.com/auth/calendar.readonly` | Read Calendar |

## Security Notes

1. **Never commit credentials.json** - add to `.gitignore`
2. **Never commit token files** - they contain access tokens
3. **Rotate secrets** if exposed - regenerate in Cloud Console
4. **Use minimal scopes** - request only what you need

## Troubleshooting

### "Access blocked: This app's request is invalid"
- Redirect URI mismatch - ensure the URI in credentials.json exactly matches what's registered

### "This app isn't verified"
- Normal for external apps in testing mode
- Click "Advanced" > "Go to [app] (unsafe)" for testing
- Submit for verification for production use

### No refresh token received
- oauthsupport handles this automatically by forcing consent when needed
- If issues persist, revoke access at https://myaccount.google.com/permissions and re-authorize

## Future: Dynamic Port Range

**TODO:** Implement dynamic port selection in oauthsupport to avoid port conflicts when multiple OAuth apps run simultaneously.

Proposed approach:
1. Register a range of ports with Google (e.g., 9326-9335)
2. oauthsupport tries ports in order until one is available
3. Uses the available port for the callback server
4. Requires all ports to be in redirect_uris in credentials.json

This would allow multiple OAuth-enabled apps to run without manual port coordination.

## Reference

- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [Google Cloud Console](https://console.cloud.google.com/)
- [OAuth Playground](https://developers.google.com/oauthplayground/) - for testing scopes
