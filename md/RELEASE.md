# Release Process

## OAuth Support Package Release

### Prerequisites
1. Ensure you're logged into npm: `npm whoami`
2. Make sure all changes are committed
3. Run tests/checks to ensure everything works

### Release Command
```bash
npm run release
```

This will:
1. Check that you're logged into npm
2. Add and commit all changes (pre-release commit)
3. Run TypeScript type checking (`npm run check`)
4. Build the package (`npm run build` - generates .js and .d.ts files)
5. Bump the version (patch)
6. Create a git tag
7. Push commits and tags to GitHub
8. Publish to npm with public access

### Manual Steps

If you need more control:

```bash
# Check TypeScript without building
npm run check

# Build the package
npm run build

# See what will be published
npm pack --dry-run

# Manually bump version (patch/minor/major)
npm version patch
npm version minor
npm version major

# Publish
npm publish --access public
```

### Security Notes

The following files are **NEVER** included in git or npm packages:
- `credentials.json` - OAuth credentials
- `*token*.json` - Access/refresh tokens
- `*credentials*.json` - Any credentials files

These are protected by:
- `.gitignore` - Prevents committing to git
- `.npmignore` - Prevents publishing to npm

### Package Contents

Published package includes:
- `index.js` + `index.d.ts` - Main entry point
- `OAuthTokenManager.js` + `OAuthTokenManager.d.ts` - Core module
- `README*.md` - Documentation
- `package.json` - Package manifest

Source TypeScript files, examples, and credentials are **excluded**.
