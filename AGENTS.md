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
pnpm dev              # Start all packages in development mode

# Building
pnpm build            # Build all packages

# Testing
pnpm test             # Run tests for all packages

# Formatting
pnpm format           # Format all files
```

### Package-Specific Commands

```bash
# CLI package (packages/cli/)
cd packages/cli
pnpm dev           # Development mode with watch
pnpm build         # Type-check and build
pnpm check         # TypeScript type checking
pnpm test          # Run tests with Vitest
pnpm test:watch    # Run tests in watch mode
pnpm test:ui       # Open Vitest UI
pnpm test:coverage # Run tests with coverage

# Extension package (packages/extension/)
cd packages/extension
pnpm compile       # Compile TypeScript
pnpm watch         # Watch mode for development
pnpm package       # Build for production
pnpm test          # Run VS Code extension tests

# Telemetry package (packages/telemetry/)
cd packages/telemetry
pnpm dev           # Development mode with watch
pnpm build         # Build for production
pnpm check         # TypeScript type checking
```

## Architecture

### CLI Package (`packages/cli/`)

- **Entry point**: `src/index.ts` - Sets up the CLI using Commander.js
- **Commands**: `src/commands/` - Each command is implemented as a separate module
- **Build output**: `dist/index.mjs` - Single bundled ES module file
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
- **Node version**: Requires Node.js 20+ and pnpm 10+ (see root package.json engines)
- **Monorepo**: Uses pnpm workspaces for package management

### Process Execution

**Always use `launch` (async) and `launchSync` from `packages/core/src/os.ts` to spawn processes. Do not use the Node.js `child_process` API directly.**

These functions are wrappers around [execa](https://github.com/sindresorhus/execa) that provide consistent behavior across the codebase:

- `launch(command, args?, options?)` - Async process execution. Returns an execa result object.
- `launchSync(command, args?, options?)` - Synchronous process execution. Returns an execa sync result object.

Key behaviors handled by these wrappers:
- Proper argument escaping via `parseCommandString` and execa template strings
- Detached process groups by default (prevents child termination on parent signals)
- Verbose logging when `VERBOSE` is enabled
- Consistent stdio option expansion

## Build Pipeline

The project uses tsdown for bundling with two distinct build modes controlled by the `TSUP_DEV` environment variable.

### Production Build (`pnpm build`)

- **Minified output** for smaller bundle size
- **No source maps** generated
- **Workspace packages kept external** (imported from their `dist/` folders)
- Used for releases and distribution

### Development Build (`pnpm build-dev` or `pnpm dev`)

- **No minification** for readable stack traces
- **Source maps enabled** pointing to original TypeScript files
- **Workspace packages bundled and aliased** to their TypeScript source (`src/index.ts`)
- Enables full debugging with accurate line numbers across all packages

Key differences in `packages/cli/tsdown.config.ts`:

| Feature     | Production | Development                    |
| ----------- | ---------- | ------------------------------ |
| `minify`    | `true`     | `false`                        |
| `sourcemap` | `false`    | `true`                         |
| `alias`     | `{}`       | Points to workspace `src/*.ts` |

### Running with Source-Mapped Stack Traces

After building in dev mode, use `pnpm start` in the CLI package to run with full source maps:

```bash
# Build all packages in dev mode
pnpm build-dev

# Run CLI with source-mapped backtraces (from packages/cli/)
cd packages/cli
pnpm start <command>

# Example: run the list command with full TypeScript backtraces
pnpm start list
```

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
# All tests
pnpm test

# Test per package
pnpm --filter @endorhq/rover test
pnpm --filter @endorhq/agent test
pnpm --filter rover-core test
pnpm --filter rover-schemas test
```

### Formatting

When you have finished implementing changes, run `pnpm format` to ensure all files follow the correct format. You can focus on files that you have changed by running `pnpm exec biome format --changed` to format only those files.

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
