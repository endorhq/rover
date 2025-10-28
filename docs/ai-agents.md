# AI Agents in Rover

Rover provides a common interface across several AI coding agents that run in the terminal. It supports AI coding agents such as Codex, Claude Code, Gemini CLI, and Qwen. Rover interacts with multiple tools that exposes a different set of arguments, options, and features. Maintaining a stable interface across all of them is required.

Currently, Rover uses the user AI coding agents for:

- **Internal operations**: 
  - Extract the required inputs for a workflow
  - Enrich user description with more details
  - Fix merge conflicts
  - Write commit messages
- **Complete user tasks**: 
  - Run each step of a workflow to complete a user task in a sandbox

## AI Agent Definition

Each AI agent is currently defined in two locations:

- `packages/cli/src/lib/agents`: classes for internal operations
- `packages/agents/src/`: classes to complete user tasks

Having it in two locations is causing unncessary duplication. In the future, **we will consolidate all AI agents' logic into the `packages/agents` package**.

Key files to consider:

**Main CLI files**

| File | Purpose |
| --- | --- |
| `packages/cli/src/program.ts` | List of available agents for the CLI |
| `packages/cli/src/commands/init.ts` | Check the available AI agents in the user environment |
| `packages/cli/src/commands/mcp.ts` | (_Duplicated_) List of available agents for the CLI |
| `packages/cli/src/commands/task.ts` | Validate that required authentication files are available before creating a task |
| `packages/cli/src/lib/config.ts` | (_Duplicated_) `AI_AGENT` enum with the supported agents | 
| `packages/cli/src/lib/agents/*` | A file per agent that defines: supported env variables, required container mounts, and logic to run internal operations using an agent. All of them implement the `AIAgentTool` interface |
| `packages/cli/src/utils/system.ts` | Methods to check if the AI agent is available in the system |

**Agent CLI files**

| File | Purpose |
| --- | --- |
| `packages/agent/src/cli.ts` | (_Duplicated_) Define the list of supported agents to complete a workflow | 
| `packages/agent/src/commands/config/index.ts` | (_Duplicated_) Define the list of supported agents to configure MCP servers |
| `packages/agent/src/lib/runner.ts` | Define commands to run AI agents |
| `packages/agent/src/lib/agents/*` | (_~Duplicated_) A class per agent that defines the configuration requirements and provides the methods to complete workflow steps |
| `packages/agent/src/lib/agents/index.ts` | (_~Duplicated_) Initialize an agent based on the name | 

**Other files**

| File | Purpose |
| --- | --- |
| `packages/schemas/src/workflow/schema.ts` | (_Duplicated_) Supported AI coding agents in the workflow definition |