# OAuth Token Manager - Universal Authentication

This project provides a **universal OAuth authentication system** that works with **any OAuth provider**. Simply pass credentials and get tokens back!

## 🚀 Quick Start

```bash
node index.ts
```

The main `index.ts` shows universal OAuth:

```typescript
import { authenticateOAuth } from "./OAuthTokenManager.ts";

// Universal OAuth - works with any provider
const token = await authenticateOAuth('credentials.json', {
    scope: 'https://www.googleapis.com/auth/contacts.readonly'
});
```

## 🎯 One Function for All Providers

```typescript
// Google (auto-detects "installed" structure)
const googleToken = await authenticateOAuth('google-creds.json', {
    scope: 'https://www.googleapis.com/auth/contacts.readonly'
});

// Microsoft
const microsoftToken = await authenticateOAuth('microsoft-creds.json', {
    scope: 'https://graph.microsoft.com/contacts.read'
});

// GitHub  
const githubToken = await authenticateOAuth('github-creds.json', {
    scope: 'repo user'
});
```

## 🔧 Auto-Detection

- ✅ Google's "installed" structure
- ✅ Google's "web" structure  
- ✅ Direct credentials objects
- ✅ File paths or JSON strings

## 🌟 Features

- ✅ **One function for all providers**
- ✅ **Auto-detection** of credential formats
- ✅ **Modern & secure** - No deprecated APIs
- ✅ **Token management** - Automatic refresh & storage
- ✅ **Cross-platform** - Windows, macOS, Linux

## 🚀 Usage

1. Get OAuth credentials from your provider
2. Save as `credentials.json` 
3. Run `node index.ts`

**Universal OAuth made simple!** 🎯

## 🚀 Quick Start

Just run the main example:

```bash
node index.ts
```

The main `index.ts` shows the simplest possible usage:

```typescript
// Universal OAuth - works with any provider
const token = await authenticateOAuth('credentials.json', {
    scope: 'https://www.googleapis.com/auth/contacts.readonly'
});

if (token) {
    console.log('✅ Authenticated successfully!');
    // Token is automatically saved for reuse
}
```

## 📁 Project Structure

```
📁 GoogleContactHelper/
├── 📄 index.ts                    ✨ Main example (START HERE)
├── 📄 OAuthTokenManager.ts        🔧 Core OAuth functionality  
├── 📄 GoogleContactsHelper.ts     📱 Google Contacts specific features
├── 📄 credentials.json            🔐 Your OAuth credentials
└── 📁 legacy/                     📚 Advanced examples & old code
    ├── examples.ts                🎯 Advanced usage patterns
    ├── index-simple.ts            📝 Multiple authentication methods
    └── GoogleContactsHelper*.ts   📜 Legacy implementations
```

## 🎯 Core Function

### `authenticateOAuth(credentials, options)`
Universal OAuth for any provider:
```typescript
const token = await authenticateOAuth(credentials, {
    scope: 'your_required_scope'
});
```

### `parseCredentialsFromString(jsonString)`
Parse credentials from JSON string:
```typescript
const credentials = parseCredentialsFromString(credentialsJson, 'installed');
```

## � Features

- ✅ **Super simple** - One function call to get tokens
- ✅ **No deprecated code** - Uses modern WHATWG URL API
- ✅ **Automatic token management** - Handles refresh & expiration
- ✅ **Cross-platform** - Auto browser opening
- ✅ **Provider agnostic** - Works with any OAuth provider

## 🚀 Usage

1. **Get OAuth credentials** from your provider (Google, Microsoft, etc.)
2. **Save as `credentials.json`** in the project directory
3. **Run `node index.ts`** - that's it!

## 📋 Requirements

- OAuth credentials file (`credentials.json`)
- Node.js with ES modules support
- Internet connection for OAuth flow

## 🎉 That's it!

No complex setup, no studying OAuth flows - just run `index.ts` and you're authenticated! 🎯

For advanced usage patterns, see the files in the `legacy/` directory.
