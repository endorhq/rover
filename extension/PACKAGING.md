# Quick Start: Package VS Code Extension

## Prerequisites Check
```bash
# Ensure you're in the extension directory
cd extension

# Install dependencies
pnpm install

# Install vsce globally (if not already installed)
npm install -g @vscode/vsce
```

## Build and Package
```bash
# 1. Build the extension
pnpm run package

# 2. Create VSIX package
pnpm run package-vsix

# Or use the convenience script
chmod +x package.sh
./package.sh
```

## Expected Output
- File created: `endor-rover-0.1.0-beta.1.vsix`
- Location: `/workspace/extension/`

## Test Installation
1. Open VS Code
2. Press Ctrl+Shift+P (Cmd+Shift+P on Mac)
3. Type "Install from VSIX"
4. Select the generated .vsix file
5. Reload VS Code

## Verify Installation
- Check Extensions view for "Endor Rover"
- Open Rover sidebar (activity bar icon)
- Run "Rover: Create Task" command

## Next Steps
- Share .vsix file with beta testers
- Follow BETA_TESTING.md guide for testers
- Collect feedback before marketplace publication