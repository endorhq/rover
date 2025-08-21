# AGENTS.md

This file provides guidance to AI agents (Claude Code, Cursor, etc.) when working with code in this repository.

## Project Overview

Rover is a TypeScript-based workspace that helps developers and AI agents spin up services instantly. The project is organized as a **monorepo** with multiple packages, each serving different purposes in the Rover ecosystem.

### Repository Structure

```
rover/
├── packages/
│   ├── cli/          # Main CLI tool (TypeScript)
│   ├── extension/    # VS Code extension (TypeScript)
│   └── telemetry/    # Telemetry library (TypeScript)
├── package.json      # Root workspace configuration
└── AGENTS.md        # This file
```

## Essential Development Commands

### Workspace Commands (run from root)
```bash
# Development workflow
npm run dev           # Start all packages in development mode
npm run dev:cli       # Start CLI package in development mode only
npm run dev:telemetry # Start telemetry package in development mode only

# Building
npm run build         # Build all packages
npm run build:cli     # Build CLI package only
npm run build:extension # Build extension package only
npm run build:telemetry # Build telemetry package only

# Testing
npm test              # Run tests for all packages
npm run test:cli      # Run CLI tests only
npm run test:extension # Run extension tests only
```

### Package-Specific Commands
```bash
# CLI package (packages/cli/)
cd packages/cli
npm run dev    # Development mode with watch
npm run build  # Type-check and build
npm run check  # TypeScript type checking
npm run test   # Run tests with Vitest
npm run test:watch   # Run tests in watch mode
npm run test:ui      # Open Vitest UI
npm run test:coverage # Run tests with coverage

# Extension package (packages/extension/)
cd packages/extension
npm run compile      # Compile TypeScript
npm run watch       # Watch mode for development
npm run package     # Build for production
npm test            # Run VS Code extension tests

# Telemetry package (packages/telemetry/)
cd packages/telemetry
npm run dev    # Development mode with watch
npm run build  # Build for production
npm run check  # TypeScript type checking
```

## Architecture

### CLI Package (`packages/cli/`)
- **Entry point**: `src/index.ts` - Sets up the CLI using Commander.js
- **Commands**: `src/commands/` - Each command is implemented as a separate module
- **Build output**: `dist/index.js` - Single bundled ES module file
- **Libraries**: `src/lib/` - Core functionality (Git, Docker, AI agents, configs)
- **Utilities**: `src/utils/` - Helper functions and utilities
- **Testing**: Uses Vitest with real Git operations and mocked external dependencies

Key architectural decisions:
- Uses tsdown for bundling
- AI providers implement a common interface for easy switching between Claude and Gemini
- Commands interact with Git worktrees for isolated task execution
- Docker containers execute AI agent tasks

### Extension Package (`packages/extension/`)
- **Entry point**: `src/extension.mts` - VS Code extension activation
- **Providers**: Tree data providers for Rover tasks
- **Panels**: Webview panels for detailed task information
- **Views**: Lit-based webview components
- **CLI Integration**: Communicates with Rover CLI via child processes

### Telemetry Package (`packages/telemetry/`)
- **Shared telemetry library** used by CLI and extension
- **Event tracking** for usage analytics
- **Privacy-focused** implementation

## Technical Details

- **TypeScript**: Strict mode enabled, targeting ES2022
- **Module system**: ES modules with Node.js compatibility
- **Node version**: Requires Node.js 22.17.0 and npm 10.9.2 (see root package.json engines)
- **Monorepo**: Uses npm workspaces for package management

## Testing Philosophy & Guidelines

### Critical Testing Principles

**🚨 NEVER make tests pass by changing the test to ignore real bugs. Always fix the underlying code issue.**

1. **Fix Code, Not Tests**: If a test fails due to an implementation bug:
   - ✅ **DO**: Fix the bug in the implementation code
   - ❌ **DON'T**: Modify the test to ignore the bug
   - ❌ **DON'T**: Add `.skip()` or change assertions to make tests green

2. **Mock Strategy**: 
   - **Mock only external dependencies** (APIs, CLI tools like Docker/Claude/Gemini)
   - **Use real implementations** for core logic (Git operations, file system, environment detection)
   - **Create real test environments** (temporary Git repos, actual project files)

3. **Test Environment**:
   - Tests create real temporary directories with actual Git repositories
   - Project files (package.json, tsconfig.json, etc.) are created to test environment detection
   - File system operations use real files, not mocks

### Running Tests

```bash
# CLI package tests
cd packages/cli
npm test              # Run all tests once
npm run test:watch    # Run tests in watch mode
npm run test:ui       # Open Vitest UI for debugging
npm run test:coverage # Generate coverage report
```

## AI Agent Guidelines

### When Working on Commands
1. **Read existing command structure** in `packages/cli/src/commands/`
2. **Follow established patterns** for error handling, validation, and user interaction
3. **Add comprehensive tests** for new functionality
4. **Mock external dependencies** but test core logic with real operations

### When Adding Features
1. **Check if the feature belongs in CLI, extension, or telemetry package**
2. **Update package.json scripts** if new build/dev commands are needed
3. **Consider cross-package dependencies** and update imports accordingly
4. **Test integration** between packages when applicable

### When Debugging Failed Tests
1. **Examine the actual failure** - understand what the code is doing wrong
2. **Fix the implementation** - never change tests to mask bugs  
3. **Verify the fix** - ensure the corrected code passes existing and new tests
4. **Consider edge cases** - add additional tests if the bug reveals gaps

## Important File Patterns

### CLI Package
- Commands: `src/commands/*.ts`
- Tests: `src/commands/__tests__/*.test.ts` 
- Library code: `src/lib/*.ts`
- Utilities: `src/utils/*.ts`

### Extension Package  
- Main entry: `src/extension.mts`
- Providers: `src/providers/*.mts`
- Views: `src/views/*.mts`
- Tests: `src/test/*.test.ts`

### Configuration Files
- Root: `package.json`, `tsconfig.json` (workspace config)
- CLI: `packages/cli/package.json`, `vitest.config.ts`
- Extension: `packages/extension/package.json`
- Telemetry: `packages/telemetry/package.json`

Remember: This is a development tool that interacts with Git repositories and executes containerized AI agents. Reliability and correctness are critical - never compromise test integrity for convenience.