#!/bin/bash

# Build and package VS Code extension for beta release

echo "Building VS Code Extension for Beta Release..."

# Navigate to extension directory
cd "$(dirname "$0")"

# Install dependencies if not present
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    pnpm install
fi

# Build the extension
echo "Building extension..."
pnpm package

# Install vsce globally if not present
if ! command -v vsce &> /dev/null; then
    echo "Installing vsce..."
    npm install -g @vscode/vsce
fi

# Package the extension
echo "Packaging extension..."
vsce package --no-dependencies

# Check if .vsix file was created
VSIX_FILE=$(ls *.vsix 2>/dev/null | head -n 1)
if [ -z "$VSIX_FILE" ]; then
    echo "Error: Failed to create .vsix file"
    exit 1
fi

echo "✅ Extension packaged successfully: $VSIX_FILE"
echo ""
echo "To test the extension:"
echo "1. Open VS Code"
echo "2. Go to Extensions view (Ctrl+Shift+X)"
echo "3. Click '...' menu > 'Install from VSIX...'"
echo "4. Select $VSIX_FILE"
echo ""
echo "To publish to marketplace:"
echo "1. Ensure you have a publisher account at https://marketplace.visualstudio.com/manage"
echo "2. Run: vsce publish"