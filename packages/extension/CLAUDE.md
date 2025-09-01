# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the VSCode extension for Rover - a TypeScript-based extension that provides VS Code integration for the Rover CLI tool. The extension displays Rover tasks in a tree view and provides a detailed webview panel for task inspection and management.

## Essential Development Commands

```bash
# Development workflow
npm run compile          # Compile TypeScript and run linting
npm run watch           # Watch mode for development (runs both TypeScript watch and esbuild watch)
npm run watch:esbuild   # Watch mode for esbuild bundling only
npm run watch:tsc       # Watch mode for TypeScript compilation only
npm run package         # Build for production (used by vscode:prepublish)

# Quality assurance
npm run check-types     # Run TypeScript type checking without emit
npm run lint           # Run ESLint on source files
npm test               # Run VS Code extension tests
npm run pretest        # Prepare for testing (compile + lint)

# Testing
npm run compile-tests   # Compile test files
npm run watch-tests    # Watch mode for test compilation
```

## Architecture

The extension follows VS Code extension patterns with these key components:

### Core Structure

- **Entry Point**: `src/extension.ts` - Extension activation and command registration
- **Tree Provider**: `src/providers/TaskTreeProvider.ts` - Implements VS Code tree data provider for Rover tasks
- **Task Items**: `src/providers/TaskItem.ts` - Tree view item representation
- **Webview Panel**: `src/panels/TaskDetailsPanel.ts` - Rich task details view with HTML interface
- **CLI Integration**: `src/rover/cli.ts` - Wrapper for Rover CLI commands
- **Type Definitions**: `src/rover/types.ts` - TypeScript interfaces for Rover data structures

### Key Architectural Decisions

- **Build System**: Uses esbuild for fast bundling, outputs to `dist/extension.js`
- **CLI Integration**: Communicates with Rover CLI via child process execution
- **Auto-refresh**: Tree view automatically refreshes every 5 seconds (configurable)
- **Webview**: Task details use inline HTML template to avoid bundling issues
- **Error Handling**: Comprehensive error handling with VS Code notifications

### VS Code Integration Points

- **Activity Bar**: Custom "Rover" view container with rocket icon
- **Tree View**: "Tasks" view showing all Rover tasks with status indicators
- **Commands**: Registered commands for task creation, inspection, deletion, logs, shell access
- **Context Menus**: Right-click actions on task items
- **Configuration**: Settings for CLI path and auto-refresh interval
- **Status Bar**: Progress indicators during task creation
- **Terminal Integration**: Opens Rover shell sessions in VS Code terminal
- **Output Channels**: Displays task logs in VS Code output panel

### Data Flow

1. Extension loads and creates `TaskTreeProvider` instance
2. Tree provider calls `RoverCLI.getTasks()` to fetch task list
3. Tasks display in tree view with real-time status updates
4. User actions trigger CLI commands through `RoverCLI` wrapper
5. Task details panel uses webview messaging for rich interactions

## Technical Details

- **TypeScript**: Strict mode enabled, targeting ES2022 with Node16 modules
- **VS Code API**: Uses latest vscode engine (^1.102.0)
- **Build Target**: Single bundled JavaScript file for distribution
- **Dependencies**: Minimal runtime dependencies, development tools only
- **Testing**: VS Code extension test framework with Mocha

### File Structure Patterns

- Commands are registered in `extension.ts` activation function
- Each provider implements appropriate VS Code interface (`TreeDataProvider`)
- Webview panels manage their own HTML content and messaging
- CLI wrapper provides typed interfaces for all Rover operations
- Types mirror the JSON responses from Rover CLI commands

### Extension Configuration

- `rover.cliPath`: Path to Rover CLI executable (default: "rover")
- `rover.autoRefreshInterval`: Tree refresh interval in ms (default: 5000, 0 to disable)
