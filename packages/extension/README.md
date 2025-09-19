# Rover VSCode Extension

**Rover** is a manager for AI coding agents that works with Claude Code, Codex, Gemini, and Qwen. It helps you get more done, faster, by allowing multiple agents to work on your codebase simultaneously.

This VSCode extension brings Rover's power directly to your editor. Run multiple coding agents in parallel on different tasks while you keep working. Everything runs locally in isolated environments, giving you full control over your development workflow.

## Features

- **Task Management**: Create and monitor AI agent tasks from the sidebar
- **Parallel Execution**: Run multiple agents simultaneously in isolated environments
- **Real-time Updates**: Track task progress and status in real-time
- **Quick Actions**: Merge changes, push branches, or inspect results with one click
- **Integrated Terminal**: Jump into task workspaces directly from VSCode

## Requirements

- [Rover CLI](https://www.npmjs.com/package/@endorhq/rover) installed globally
- [Docker](https://docs.docker.com/engine/install/) running on your system
- At least one supported AI agent ([Claude Code](https://docs.anthropic.com/en/docs/claude-code/setup), [Codex](https://github.com/openai/codex), [Gemini CLI](https://github.com/google-gemini/gemini-cli), or [Qwen Code](https://github.com/QwenLM/qwen-code))

## Getting Started

1. Install the extension from VSCode Marketplace
2. Open a project folder in VSCode
3. Initialize Rover: Command Palette → `Rover: Initialize Project`
4. Create your first task: Click the Rover icon in the Activity Bar → `Create Task`

## Extension Settings

- `rover.cliPath`: Custom path to Rover CLI (auto-detected by default)
- `rover.autoRefresh`: Enable automatic task list refresh (default: true)
- `rover.refreshInterval`: Task list refresh interval in seconds (default: 5)

## Commands

### Setup & Configuration

- `Rover: Initialize Project` - Set up Rover in your project
- `Rover: Install Rover CLI` - Install the Rover CLI globally
- `Rover: Show Setup Guide` - Open the setup guide for getting started

### Task Management

- `Rover: Create Task` - Start a new AI agent task
- `Rover: Create Task from GitHub` - Create a task from a GitHub issue
- `Rover: Iterate Task` - Add new instructions to an existing task
- `Rover: Delete Task` - Remove a completed or unwanted task
- `Rover: Refresh Tasks` - Update the task list

### Task Actions

- `Rover: Inspect Task` - View detailed task information and outputs
- `Rover: Open Task Terminal` - Jump into a task's workspace shell
- `Rover: Open Task Workspace` - Open task workspace in a new VSCode window
- `Rover: View Task Logs` - Display task execution logs
- `Rover: Compare Changes` - View git diff for task changes
- `Rover: Merge Task` - Merge task changes into main branch
- `Rover: Push Branch` - Push task branch to remote repository

## Learn More

- [Documentation](https://docs.endor.dev/rover/)
- [GitHub](https://github.com/endorhq/rover)
- [Discord Community](https://discord.gg/ruMJaQqVKa)

---

Built with ❤️ by [Endor](https://endor.dev)
