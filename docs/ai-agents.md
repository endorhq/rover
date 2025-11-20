# AI Agents in Rover

Rover provides a common interface across several AI coding agents that run in the terminal. It supports AI coding agents such as Codex, Claude Code, Gemini CLI, and Qwen. Rover interacts with multiple tools that exposes a different set of arguments, options, and features. Maintaining a stable interface across all of them is required.

Currently, Rover uses AI coding agents for:

- **Internal operations**:
  - Extract the required inputs for a workflow
  - Enrich user description with more details
  - Fix merge conflicts
  - Write commit messages
- **Complete user tasks**:
  - Run each step of a workflow to complete a user task in a sandbox

## AI Agent Definition

### Requirements

Rover integrates with AI coding agents that run in the terminal, such as Claude Code, Gemini CLI, Codex and Qwen CLI. While we want to support as many tools as possible, there are certain requirements to add an AI agent to Rover:

1. It's stable. It must be a widely adopted and supported tool
2. It must support "non-interactive" mode. Most tools use the `-p` option for this
3. It must support MCP server configuration

If the AI agent meets all these requirements, you can proceed with integration. To start with the integration, first solve these questions:

- How does the AI agent authenticate to the remote service?
- What are the configuration requirements? What files does it need to work?
- How can I run it in interactive mode?
- Does it support `json` output mode? (_it simplifies parsing the responses_)
- How can I configure a MCP server? Can I do it through the CLI or do I need to change some config files?

Once you have this information, you can continue with the implementation.

### New Agent Implementation

Each AI agent is currently defined in two locations:

- `packages/common/agent.ts`: common agent enumerations
- `packages/cli/src/lib/agents`: classes for internal operations
- `packages/agent/src/`: classes to complete user tasks

Having it in two locations is causing unnecessary duplication. In the future, **we will consolidate all AI agent logic into the `packages/agents` package**.

#### Required Files

**Main CLI files**

| File                                | Purpose                                                                                                                                                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/cli/src/commands/init.ts` | Check the available AI agents in the user environment                                                                                                                                                          |
| `packages/cli/src/commands/task.ts` | Validate that required authentication files are available before creating a task                                                                                                                               |
| `packages/cli/src/lib/agents/*`     | A file per agent that defines: supported env variables, required container mounts (for authentication), and logic to run internal operations using an agent. All of them implement the `AIAgentTool` interface |
| `packages/cli/src/utils/system.ts`  | Methods to check if the AI agent is available in the system                                                                                                                                                    |

**Agent CLI files**

| File                                     | Purpose                                                                                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agent/src/lib/runner.ts`       | Define commands to run AI agents                                                                                                  |
| `packages/agent/src/lib/agents/*`        | (_~Duplicated_) A class per agent that defines the configuration requirements and provides the methods to complete workflow steps |
| `packages/agent/src/lib/agents/index.ts` | (_~Duplicated_) Initialize an agent based on the name                                                                             |

**Other files**

| File                                      | Purpose                                                              |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `packages/common/src/agent.ts`            | List of available agents for the rover CLI and agent CLI             |
| `packages/schemas/src/workflow/schema.ts` | (_Duplicated_) Supported AI coding agents in the workflow definition |

#### Main Interfaces

When adding a new agent, you need to implement two different interfaces:

1. **`AIAgentTool` interface** (`packages/cli/src/lib/agents`): For internal operations like enriching descriptions, generating commit messages, and resolving merge conflicts.

   Required methods:
   - `invoke()`: Run the agent with a prompt
   - `checkAgent()`: Verify the agent is available in the system
   - `expandTask()`, `expandIterationInstructions()`: Enrich user descriptions
   - `generateCommitMessage()`: Create commit messages
   - `resolveMergeConflicts()`: Fix merge conflicts
   - `extractGithubInputs()`: Extract workflow inputs
   - `getContainerMounts()`, `getEnvironmentVariables()`: Define container configuration

2. **`Agent` interface** (`packages/agent/src/lib/agents`): For completing user tasks in workflows. New agents should extend the `BaseAgent` class.

   Required methods:
   - `getRequiredCredentials()`: List required authentication files
   - `validateCredentials()`: Check if credentials are valid
   - `getInstallCommand()`: Command to install the agent in the container
   - `install()`: Install the agent
   - `configureMCP()`: Configure MCP servers
   - `copyCredentials()`: Copy authentication files to the container
   - `isInstalled()`: Check if the agent is installed

### Testing the New Agent

A new agent touches different packages in the project. To test your changes, run all these commands **from the project root folder**:

- Install the project dependencies:

  ```bash
  npm install
  ```

- Build the different packages:

  ```bash
  npm run build
  ```

- Then, build a local sandbox image for testing. Currently, you need to match the value of the `AGENT_IMAGE` constant in the [`task.ts` file](../packages/cli/src/commands/task.ts).

  ```bash
  # Remember to change "VERSION" with the value from "AGENT_IMAGE"
  docker build -t ghcr.io/endorhq/rover/node:VERSION -f ./images/agent/Dockerfile .
  ```

  This image builds the new `agent` package and installs it in the image. We build the final image and publish it during the production release.

- Now, you need to use the latest CLI version. For that, add an alias to use the development version you just built for the CLI:

  ```bash
  # You can remove the alias with "unalias rover"
  alias rover="node $(pwd)/packages/cli/dist/index.js"
  ```

- Finally, you can create your task using your new agent.

  ```bash
  rover task --agent my-agent
  ```
