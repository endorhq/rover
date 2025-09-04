# Rover

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Version](https://img.shields.io/npm/v/@endorhq/rover.svg)](https://www.npmjs.com/package/@endorhq/rover)
[![GitHub Actions](https://img.shields.io/github/actions/workflow/status/endorhq/rover/ci.yml?branch=main)](https://github.com/endorhq/rover/actions)
[![Discord](https://img.shields.io/discord/1404714845995139192?color=7289da&label=Discord&logo=discord&logoColor=white)](https://discord.gg/EndorHQ)

Rover is a **manager for AI coding agents that works with Claude Code, Gemini, Codex, and Qwen**. It helps you get more done, faster, by allowing multiple agents to work on your codebase in the background without interfering with you or each other.

Everything runs locally, under your control, and using your already installed tools.

## Getting Started

First, install Rover and initialize your project:

```sh
npm install -g @endorhq/rover@latest && rover init .
```

Then, create a task describing what you want to accomplish in your existing project and hand it to Rover. It will:

- Prepare a local isolated environment (using containers) with a copy of your code
- Configure the AI Condig Agent and provide a worflow
- Run everything in the background until the agent finishes

While this happens, you can create new tasks to also run in parallel to the existing one or simply relax, step back and do some other work, either in the computer or real life!

[PLACEHOLDER FOR A GIF / VIDEO]

## What is Rover?

Managing multiple AI Coding Agents at the same time might be overwhelming. You need to run then in isolated environments or different folders so they don't overlap with the changes; and they constantly ask for attention.

The context switch is a nightmare.

On the other side, **you don't get all the potential from coding agents until you start running them in parallel**. You can focus on a task while coding agents complete small issues, analyze required changes for another task, or just write some new documentation.

**Rover manages AI coding agents for you**. It integrates with both your terminal and VSCode (as an extension). Create a new task with `rover task` and it will copy your repository using git, start a container with the required configuration and services, and provide the AI agent with a workflow to follow.

[PLACEHOLDER FOR A GIF / VIDEO]

You can now focus on your work or just relax. AI agents will implement the required changes and produce a set of documents you can review later. Then, you can decide the next steps:

- Ask for more changes by adding new instructions (iterate)
- Take control and continue the implemention on your own
- Merge the changes in your current branch
- Push the changes to a new remote branch

Rover uses your local AI agents, like Claude Code and Gemini CLI, so you do not need to pay any extra subscription. It integrates with both your terminal and VSCode (as an extension).

### Why Rover?

- 🚀 **Easy to use**: Manage multiple AI coding agents working on different tasks with a single command
- 🔒 **Isolated**: Prevent AI Agents from overriding your changes, accessing private information or deleting system files
- 🤖 **Bring your AI Agents**: Use your existing AI agents like Claude Code, Gemini, and Qwen. No new subscriptions needed
- ⚙️ **Predefined workflows**: Use different agents and get consistent results
- 💻 **Local**: Everything runs on your computer. No new apps and permissions in your repositories

## Quickstart

### Prerequisites

- [Node.js 22+](https://nodejs.org/en/download)
- [Git](https://git-scm.com/downloads)
- [Docker](https://docs.docker.com/engine/install/)

You need at least one supported AI Agent in your system:

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code/setup)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli?tab=readme-ov-file#-installation)
- [Qwen Code](https://github.com/QwenLM/qwen-code?tab=readme-ov-file#installation)

### Installation

Install it using `npm`:

```sh
npm install -g @endorhq/rover@latest
```

### First steps

1. Initialize Rover in your project:

   ```sh
   cd your-project && rover init
   ```

2. Create your first task with Rover:

   ```sh
   rover task
   ```

3. Check the status of your task:

   ```sh
   rover ls -w
   ```

4. Keep working on your own tasks 🤓

5. After finishing, check the task result:

   ```sh
   rover inspect 1
   rover inspect 1 --file changes.md
   rover diff 1
   ```

6. If you want to apply more changes, create a second iteration with new instructions:

   ```sh
   rover iterate 1
   ```

7. If changes are fine, you can:
   - Merge them:

   ```sh
   rover merge 1
   ```

   - Push the branch to the remote using your git configuration:

   ```sh
   rover push 1
   ```

   - Take manual control:

   ```sh
   rover shell 1
   git status
   ```

> 💡 TIP: You can run multiple tasks in parallel. Just take into account your AI agents' limits.

## How it works

Rover relies on the local tools you already have like Git, Docker/Podman and AI Coding Agents. When you initialize it in a project (using `rover init`), it identifies the project and the available tools in your environment. Then, you can start assigning tasks to your agents.

Once you create a task, Rover creates a separate _git worktree_ (`workspace`) and branch for that task, starts a container, mounts the required files, installs tools, configures them, and lets your AI agent complete a workflow.

Rover workflows provide a set of predefined steps to a AI coding agent. Depending on the workflow, you might get a set of changes in the workspace or a document with research. We recommend exploring the different workflows to get the maximum benefit from your AI Agents.

After an AI agent finishes the task, all code changes and output documents are available in the task workspace. You can inspect those documents, check changes, iterate with an AI agent, or even take full control and start applying changes manually.

Every developer has a different workflow, and Rover will not get in between.

Once you are ready, you can merge changes or push the branch. That's it! 🚀

### Report Issues

Found a bug or have a feature request? Please [open an issue on GitHub](https://github.com/endorhq/rover/issues). We appreciate detailed bug reports and thoughtful feature suggestions.

### Join the Community

We'd love to hear from you! Whether you have questions, feedback, or want to share what you're building with Rover, there are multiple ways to connect.

- **Discord**: [Join our Discord spaceship](https://discord.gg/VGzGVWxrXz) for real-time discussions and help
- **Twitter/X**: Follow us [@EndorHQ](https://twitter.com/EndorHQ) for updates and announcements
- **Mastodon**: Find us at [@EndorHQ@mastodon.social](https://mastodon.social/@EndorHQ)
- **Bluesky**: Follow [@endorhq.bsky.social](https://bsky.app/profile/endorhq.bsky.social)

## License

Rover is open source software licensed under the Apache 2.0 License.

---

<div align="center">

**Built with ❤️ by the Endor team**
_We build tools to make AI coding agents better_

</div>
