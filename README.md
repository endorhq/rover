# Endor Rover - Manage AI Agents

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Version](https://img.shields.io/npm/v/@endorhq/rover.svg)](https://www.npmjs.com/package/@endorhq/rover)
[![GitHub Actions](https://img.shields.io/github/actions/workflow/status/endorhq/rover/ci.yml?branch=main)](https://github.com/endorhq/rover/actions)
[![Discord](https://img.shields.io/discord/1404714845995139192?color=7289da&label=Discord&logo=discord&logoColor=white)](https://discord.gg/EndorHQ)

Launch and manage your AI Agents to complete tasks while you focus on the complex ones.

```sh
npm install -g @endorhq/rover@latest && rover init .
```

[PLACEHOLDER FOR A GIF / VIDEO]

## What is Rover?

Rover is a CLI tool and VSCode extension that isolates AI Agents like Claude Code, Gemini, and Qwen Coder, and provides them with an environment to complete a task. It gives you the control to spawn them, inspect, iterate and parallelize AI agents using the tools you already have. No new subscriptions. Everything runs locally, under your control. 

### Why Rover?

* 🚀 **Easy to use**: Create your first AI agent task in 5 minutes. No AI agent experience required
* 🔒 **Isolated**: Prevent AI Agents from overriding your changes or deleting files
* 🤖 **Bring your AI Agents**: Use your existing AI agents like Claude Code or Gemini. No new subscriptions
* ⚙️ **Predefined workflows**: Use different agents, get consistent results. Use existing workflows to complete any task
* 💻 **Local**: Everything runs on your computer. No new apps and permissions in your repositories

## Quickstart

### Prerequisites

* [Node.js 22+](https://nodejs.org/en/download)
* [Git](https://git-scm.com/downloads)
* [Docker](https://docs.docker.com/engine/install/)

You need at least one supported AI Agent in your system:

* [Claude Code](https://docs.anthropic.com/en/docs/claude-code/setup)
* [Gemini CLI](https://github.com/google-gemini/gemini-cli?tab=readme-ov-file#-installation)

### Installation

Install it using `npm`:

```sh
npm install -g @endorhq/rover@latest
```

### First steps

1. Initialize Rover in your project:

    ```sh
    cd your-project && rover init .
    ```

2. Create your first task with Rover:

    ```sh
    rover task
    ```

3. Check the status of your task:

    ```sh
    rover ls --watch
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
    cd .rover/tasks/1/workspace
    git status
    ```

> 💡 TIP: You can run multiple tasks in parallel. Just take into account your AI agents' limits.

## How it works

Rover relies on the local tools you already have like Git, Docker and AI Agents. When you initialize it in a project (using `rover init`), it identifies the project and the available tools in your environment. Then, you can start assigning tasks to your agents. 

Once you create a task, Rover creates a separate _git worktree_ (`workspace`) for that task, starts a container, mounts the required files, installs tools, configures them, and lets your AI agent complete the workflow.

Workflows provide a set of predefined steps to produce an output. Depending on the workflow, you might get a set of changes in the workspace or a document with research. We recommend exploring the different workflows to get the maximum benefit from your AI Agents.

After an AI agent finishes the task, all the code changes and output documents are available in the task workspace. You can inspect those documents, check changes, iterate with an AI agent, or even take full control and start applying changes manually. Each of us has a different workflow, and Rover will honor all of them. 

Once you are ready, you can merge changes or push the branch. That's it! 🚀 

## Use cases

1. 🔄 **Handle routine development tasks**

    Let AI agents tackle repetitive work like writing tests, updating documentation, or refactoring code. You describe what needs to be done, and Rover ensures the agent works in isolation without affecting your current work.

2. 🔀 **Explore multiple solutions in parallel**

    Working on a performance issue? Spin up different agents to try various approaches simultaneously. Compare results, pick the best solution, or combine insights from multiple attempts.

3. ⚡ **Maintain momentum during context switches**

    When urgent bugs interrupt your feature work, delegate the investigation to an agent while you handle the critical issue. Return to a complete analysis and proposed fixes when you're ready.

4. 🤝 **Get consistent results across your team and contributors**

    Whether your team uses Claude, Gemini, or other AI agents, Rover's workflows ensure everyone produces the same quality output. External contributors can use their preferred AI tools while still getting valid results. No need to enforce specific subscriptions or tools.

## Get in touch

We'd love to hear from you! Whether you have questions, feedback, or want to share what you're building with Rover, there are several ways to connect:

### Report Issues

Found a bug or have a feature request? Please [open an issue on GitHub](https://github.com/endorhq/rover/issues). We appreciate detailed bug reports and thoughtful feature suggestions.

### Join the Community

Connect with other Rover users and the development team:

- **Discord**: [Join our Discord spaceship](https://discord.gg/EndorHQ) for real-time discussions and help
- **Twitter/X**: Follow us [@EndorHQ](https://twitter.com/EndorHQ) for updates and announcements
- **Mastodon**: Find us at [@EndorHQ@mastodon.social](https://mastodon.social/@EndorHQ)
- **Bluesky**: Follow [@endorhq.bsky.social](https://bsky.app/profile/endorhq.bsky.social)

## License

Rover is open source software licensed under the Apache 2.0 License.
