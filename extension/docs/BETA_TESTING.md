# Endor Rover VS Code Extension - Beta Testing Guide

Welcome to the Endor Rover VS Code Extension beta testing program! This guide will help you install and test the extension.

## Beta Version

Current version: **0.1.0-beta.1**

## Prerequisites

Before installing the beta extension:

1. **VS Code**: Ensure you have Visual Studio Code version 1.102.0 or higher
2. **Rover CLI**: The extension requires the Rover CLI to be installed on your system
   - Installation instructions: [Rover CLI Documentation](https://github.com/endor/rover)
   - Verify installation: `rover --version`

## Installation Methods

### Method 1: Install from VSIX File (Recommended for Beta)

1. Download the latest beta VSIX file: `endor-rover-0.1.0-beta.1.vsix`
2. Open VS Code
3. Open the Extensions view (Ctrl+Shift+X / Cmd+Shift+X)
4. Click the "..." menu at the top of the Extensions view
5. Select "Install from VSIX..."
6. Browse to and select the downloaded VSIX file
7. Click "Install"
8. Reload VS Code when prompted

### Method 2: Command Line Installation

```bash
code --install-extension endor-rover-0.1.0-beta.1.vsix
```

## Configuration

After installation, configure the extension:

1. Open VS Code Settings (Ctrl+, / Cmd+,)
2. Search for "Rover"
3. Configure the following settings:
   - **Rover: CLI Path**: Path to the Rover CLI executable (default: `rover`)
   - **Rover: Auto Refresh Interval**: Auto-refresh interval in milliseconds (default: 5000)

## Features to Test

### 1. Task Management
- **Create Task**: Click the "+" icon in the Rover Tasks view
- **Create from GitHub**: Click the GitHub icon to create tasks from issues
- **View Tasks**: Tasks should appear in the Rover sidebar
- **Inspect Task**: Click the info icon on any task
- **Delete Task**: Right-click a task and select "Delete Task"

### 2. Task Operations
- **Open Task Shell**: Click the terminal icon on running tasks
- **View Logs**: Click the output icon to see task logs
- **Open Workspace**: Click the folder icon to open task workspace
- **Git Compare**: Compare task workspace with git repository

### 3. Auto-refresh
- Tasks should automatically refresh based on the configured interval
- Manual refresh available via the refresh icon

## Reporting Issues

Please report any issues or feedback:

1. **GitHub Issues**: [Create an issue](https://github.com/endor/rover/issues)
2. **Include Details**:
   - VS Code version: Help > About
   - Extension version: 0.1.0-beta.1
   - Rover CLI version: `rover --version`
   - Operating System
   - Steps to reproduce
   - Error messages (check Output > Rover)

## Known Limitations

- Beta version may have stability issues
- Some features may be incomplete
- Performance optimizations are ongoing

## Uninstalling

To uninstall the beta version:

1. Open Extensions view (Ctrl+Shift+X / Cmd+Shift+X)
2. Find "Endor Rover" in the installed extensions
3. Click the gear icon and select "Uninstall"

## Next Steps

After testing, please provide feedback on:
- Installation process
- Feature functionality
- Performance
- UI/UX improvements
- Any bugs or issues

Thank you for participating in the beta testing program!