# Publishing the VS Code Extension

This guide explains how to publish the Endor Rover VS Code extension to the marketplace.

## Prerequisites

1. **Publisher Account**: Create or verify access to the "endor" publisher account at https://marketplace.visualstudio.com/manage
2. **Personal Access Token (PAT)**: Create a PAT with "Marketplace (Manage)" scope
3. **vsce CLI**: Install globally with `npm install -g @vscode/vsce`

## Manual Publishing

### 1. Build and Package

```bash
cd extension
pnpm run package        # Build the extension
pnpm run package-vsix   # Create .vsix file
```

### 2. Publish to Marketplace

#### Beta Release
```bash
vsce publish --pre-release --no-dependencies
```

#### Production Release
```bash
vsce publish patch --no-dependencies  # Bump patch version and publish
# or
vsce publish minor --no-dependencies  # Bump minor version and publish
# or
vsce publish major --no-dependencies  # Bump major version and publish
```

## Automated Publishing (GitHub Actions)

### Setup

1. Add your VS Code Marketplace PAT as a GitHub secret:
   - Go to Settings > Secrets and variables > Actions
   - Add new secret named `VSCE_PAT` with your PAT value

### Triggering Releases

#### Option 1: Manual Workflow Dispatch
1. Go to Actions tab
2. Select "Publish VS Code Extension" workflow
3. Click "Run workflow"
4. Select release type (beta, patch, minor, major)

#### Option 2: Git Tags
```bash
# Beta release
git tag vscode-v0.1.0-beta.2
git push origin vscode-v0.1.0-beta.2

# Production release
git tag vscode-v1.0.0
git push origin vscode-v1.0.0
```

## Version Management

### Package.json Version Format
- Beta: `0.1.0-beta.1`, `0.1.0-beta.2`, etc.
- Production: `1.0.0`, `1.0.1`, `1.1.0`, etc.

### Bumping Versions
```bash
# Manual version update
npm version prerelease --preid=beta  # 0.1.0 -> 0.1.1-beta.0
npm version patch                     # 0.1.0 -> 0.1.1
npm version minor                     # 0.1.0 -> 0.2.0
npm version major                     # 0.1.0 -> 1.0.0
```

## Publishing Checklist

- [ ] Update CHANGELOG.md with release notes
- [ ] Run tests: `npm test`
- [ ] Run linting: `npm run lint`
- [ ] Build extension: `npm run package`
- [ ] Test locally: Install .vsix file and verify functionality
- [ ] Commit all changes
- [ ] Create git tag (if using automated publishing)
- [ ] Verify successful publication on marketplace

## Troubleshooting

### Common Issues

1. **Authentication Failed**
   - Verify PAT is valid and has correct scope
   - Check publisher name matches package.json

2. **Version Already Exists**
   - Bump version in package.json
   - Use `vsce publish patch/minor/major` to auto-increment

3. **Missing Icon**
   - Ensure icon path in package.json is correct
   - Icon file must be included in the package

4. **Build Failures**
   - Run `npm run package` locally first
   - Check all dependencies are installed

## Marketplace Management

- View extension: https://marketplace.visualstudio.com/items?itemName=endor.endor-rover
- Manage extension: https://marketplace.visualstudio.com/manage/publishers/endor
- Analytics: Available in the publisher management portal