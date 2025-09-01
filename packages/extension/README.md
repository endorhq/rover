# Rover - AI-Powered Task Management Extension

Rover is a powerful VS Code extension that brings AI-powered task management and automation directly into your development environment. It seamlessly integrates with the Rover CLI tool to help you collaborate with AI agents to complete any development task.

## Features

### 🚀 AI-Powered Task Creation and Management

- **Create tasks with natural language**: Describe what you want to accomplish in plain English
- **AI agent execution**: Tasks are executed by intelligent AI agents that understand your codebase
- **Real-time status updates**: Monitor task progress with live status indicators
- **GitHub integration**: Create tasks directly from GitHub issues with one click

### 📋 Comprehensive Task Overview

- **Task list view**: See all your tasks at a glance in the VS Code activity bar
- **Rich task details**: View detailed information about each task including status, description, and iterations
- **Interactive webview panel**: Manage tasks through a beautiful, responsive interface
- **Auto-refresh**: Task status updates automatically every 5 seconds (configurable)

### 🔧 Development Workflow Integration

- **Git worktree support**: Each task gets its own isolated workspace
- **Branch management**: Automatic branch creation and management per task
- **Merge capabilities**: AI-powered merge conflict resolution
- **Push to remote**: Direct integration with GitHub for PR creation

### 💻 Developer Tools

- **Terminal integration**: Open interactive shells for any task workspace
- **Log viewing**: Real-time access to task execution logs
- **File comparison**: Built-in diff viewing between task and main branches
- **Workspace switching**: Quickly jump between task workspaces

### 🤖 AI Features

- **Smart commit messages**: AI-generated commit messages based on changes
- **Conflict resolution**: Automatic merge conflict resolution using AI
- **Code understanding**: AI agents understand your project structure and requirements
- **Iterative refinement**: Add refinements to running tasks for better results

## Requirements

### Prerequisites

- **Rover CLI**: The extension requires the Rover CLI tool to be installed on your system
- **Git**: Git must be available for repository and branch management
- **Node.js**: Required for running AI agents (Node.js 20+)

### Installation Steps

1. Install the Rover CLI:
   ```bash
   npm install -g @endor/rover
   ```
2. Install this VS Code extension from the marketplace
3. Configure the CLI path in settings if needed (see Extension Settings)

### Optional Requirements

- **GitHub CLI (gh)**: For enhanced GitHub integration and PR creation
- **AI Provider API Keys**: Configure Claude or Gemini API keys for AI functionality

## Extension Settings

This extension contributes the following settings:

- `rover.cliPath`: Path to the Rover CLI executable
  - **Default**: `"rover"`
  - **Description**: Specify the path to the Rover CLI if it's not in your system PATH
  - **Example**: `"/usr/local/bin/rover"` or `"C:\\tools\\rover.exe"`

- `rover.autoRefreshInterval`: Auto-refresh interval in milliseconds
  - **Default**: `5000` (5 seconds)
  - **Description**: How often the task list refreshes automatically. Set to 0 to disable auto-refresh
  - **Range**: 0 (disabled) to 60000ms (1 minute)

## Commands

The extension provides the following commands accessible via the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

### Task Management

- **Rover: Create Task** - Create a new AI-powered task
- **Rover: Create Task from GitHub Issue** - Import a GitHub issue as a task
- **Rover: Refresh Tasks** - Manually refresh the task list
- **Rover: Delete Task** - Remove a task and clean up its resources

### Task Operations

- **Rover: Inspect Task** - Open detailed task information panel
- **Rover: View Task Logs** - Show execution logs for a task
- **Rover: Open Task Shell** - Launch interactive terminal in task workspace
- **Rover: Open Task Workspace** - Switch to task workspace folder
- **Rover: Git Compare Task Workspace** - Compare task changes with main branch

### Git Operations

- **Rover: Push Task Branch** - Push task changes and optionally create PR
- **Rover: Merge Task** - Merge task into current branch with AI assistance

## Getting Started

### 1. Initialize Rover in Your Project

```bash
rover init
```

### 2. Create Your First Task

1. Click the Rover icon in the Activity Bar
2. Click the "+" button or use "Rover: Create Task" command
3. Describe your task in natural language
4. Watch as the AI agent completes your task!

### 3. Monitor Progress

- Task status updates automatically in the tree view
- Click on any task to see detailed information
- Use the logs view to see real-time execution details

### 4. Review and Merge

- Use the diff view to review changes
- Merge completed tasks with AI-powered conflict resolution
- Push changes and create PRs directly from VS Code

## Usage Tips

### Best Practices

- **Be specific in task descriptions**: The more detail you provide, the better the AI agent can understand your requirements
- **Use iterations**: Add refinements to running tasks if the initial results need adjustment
- **Review before merging**: Always check the diff and test changes before merging tasks
- **Clean up completed tasks**: Delete finished tasks to keep your workspace organized

### Troubleshooting

- **CLI not found**: Check the `rover.cliPath` setting if the extension can't find the Rover CLI
- **Tasks not updating**: Verify the auto-refresh interval setting or manually refresh
- **Permission issues**: Ensure the Rover CLI has proper permissions and Git is configured
- **AI API errors**: Check your API key configuration in the Rover CLI

## Known Issues

- **Large repositories**: Initial task creation may be slower on very large codebases
- **Windows paths**: Use double backslashes or forward slashes in `rover.cliPath` on Windows
- **Terminal integration**: Some terminals may not properly inherit environment variables

## Release Notes

### 0.0.1 - Initial Release

**Features:**

- Complete VS Code integration for Rover CLI
- Task management with real-time status updates
- Rich webview panel for task details and interactions
- GitHub integration for issue-based task creation
- Git workflow support with branch and merge management
- Terminal and log viewing capabilities
- AI-powered commit message generation
- Configurable auto-refresh and CLI path settings

**What's New:**

- 🎉 First public release of the Rover VS Code extension
- 🚀 Full-featured task management directly in your editor
- 🤖 AI-powered development workflow automation
- 🔧 Seamless integration with existing Git workflows

---

## Support and Feedback

- **Documentation**: [Rover CLI Documentation](https://github.com/endorhq/rover)
- **Issues**: Report bugs and request features on [GitHub Issues](https://github.com/endorhq/rover/issues)
- **Discussions**: Join the community discussions for tips and best practices

## Contributing

This extension is part of the open-source Rover project. Contributions are welcome!

**Enjoy collaborating with AI agents using Rover! 🚀**
