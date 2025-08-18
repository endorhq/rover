# Endor Rover - Manage AI Agents

Launch and manage your AI Agents to complete tasks while you focus on the complex ones.

```sh
npm install -g @endorhq/rover@latest && rover init .
```

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

* [NodeJS +22](https://nodejs.org/en/download)
* [Git](https://git-scm.com/downloads)
* [Docker](https://docs.docker.com/engine/install/)

You need at least one support AI Agent in your system:

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
cd PROJECT && rover init .
```

## How it works

Rover relies on the local tools you already have like Git, Docker and AI Agents. When you initialize it in a project (using `rover init`), it identifies the project and the available tools in your environment. Then, you can start assigning tasks to your agents. 

Once you create a task, Rover creates a separate _git worktree_ (`workspace`) for that task, starts a container, mounts the required files, installs tools, configures them, and lets your AI agent complete the workflow.

Workflows provide a set of predefined steps to produce an output. Depending on the workflow, you might get a set of changes in the workspace or a document with research. We recommend you to explore the different workflows to get the maximum benefit from your AI Agents.

After an AI agent finishes the task, all the code changes and output documents are available in the task workspace. You can inspect those documents, check changes, iterate with an AI agent, or even take full control and start applying changes manually. Each of us has a different workflow, and Rover will honor all of them. 

Once you are ready, you can merge changes or push the branch. That's it! 🚀 

## Use cases

## Get in touch

## License


