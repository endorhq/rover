# CLI End to end testing (e2e testing)

This end to end testing description focuses on the `rover` CLI.

## Suite

- [Initialization](#initialization)
- [Worktree Context Detection](#worktree-context-detection)
- [Task Creation](#task-creation)
- [Task Listing](#task-listing)
- [Task Inspection](#task-inspection)
- [Task Logs](#task-logs)
- [Task Diff](#task-diff)
- [Task Iteration](#task-iteration)
- [Task Stop](#task-stop)
- [Task Restart](#task-restart)
- [Task Deletion](#task-deletion)
- [Task Merge](#task-merge)
- [Task Push](#task-push)
- [Shell Access](#shell-access)
- [Workflows](#workflows)
- [Global Information](#global-information)
- [Hooks](#hooks)
- [Cost Control](#cost-control)

---

## Initialization

The `rover init` command sets up Rover in a git repository. It detects
available system tools (Docker, AI agents), identifies the project
environment (languages, package managers, task managers), and creates the
necessary configuration files. This is the entry point for any Rover
usage and must work reliably across different project types and tool
configurations.

### Preconditions

The current directory must be a git repository with at least one
commit. No prior Rover configuration should exist unless testing
re-initialization behavior.

### Features

#### Prerequisite detection

<!-- category: core -->

- Verifies that Docker (or Podman) is available before proceeding
- Fails with an error indicating Docker is required when Docker is missing
- Verifies that at least one supported AI agent (Claude, Codex, Gemini, or Qwen) is installed
- Fails with an error indicating an AI agent is needed when no agent is found
- Detects and records all available AI agents when multiple are present
- Selects the first available agent as default when running non-interactively with `--yes`

#### Project environment detection

<!-- category: core -->

- Inspects the repository to identify programming languages in use
- Detects TypeScript via `tsconfig.json`, Rust via `Cargo.toml`, Python via `pyproject.toml`, Go via `go.mod`, PHP via `composer.json`, Dart via `pubspec.yaml`
- Detects package managers (npm, pnpm, yarn, cargo, uv, pip, poetry, gomod, composer, pub) based on lock files and configuration files
- Detects task managers (Make, Just, Task) based on `Makefile`, `Justfile`, and `Taskfile.yml`
- Detects polyglot projects with multiple languages, package managers, and task managers correctly

#### Configuration file creation

<!-- category: core -->

- Creates `rover.json` at the project root containing detected languages, package managers, task managers, and other project settings
- Creates `.rover/settings.json` containing the list of detected AI agents and the selected default agent
- Produces valid JSON in both files
- Reflects the actual project environment accurately in both files

#### Gitignore management

<!-- category: side-effect -->

- Creates `.gitignore` containing `.rover/` if no `.gitignore` exists
- Appends `.rover/` to an existing `.gitignore` without disturbing existing entries
- Does not duplicate `.rover/` if it is already present in `.gitignore`

#### Re-initialization prevention

<!-- category: idempotency -->

- Detects that the project is already initialized when both `rover.json` and `.rover/settings.json` exist
- Reports that the project is already initialized
- Does not overwrite the existing configuration

#### Cloned repository initialization

<!-- category: edge -->

- Succeeds when running `rover init` in a cloned repository that was previously initialized
- Respects the existing committed `rover.json`
- Creates `.rover/settings.json` with the locally detected AI agents

### Postconditions

After successful initialization, the project must have a valid
`rover.json`, a valid `.rover/settings.json`, and `.rover/` must be
listed in `.gitignore`. The project must be registered in the global
Rover store. Running any subsequent Rover command in this directory must
recognize the project as initialized.

---

## Worktree Context Detection

When Rover commands are run from inside a git worktree (as opposed to
the main checkout), Rover must detect this context and redirect
operations to the main repository root. This ensures tasks, configs, and
state are resolved consistently regardless of which worktree the user is
in.

### Preconditions

The current directory must be inside a git worktree (not the main
checkout). Rover must be initialized in the main repository.

### Features

#### Worktree detection and notification

<!-- category: core -->

- Detects that the current directory is a worktree when `--project` is not specified
- Displays a notification indicating the main project root being used
- Resolves all operations against the main repository instead of the worktree
- Does not display the notification when running in `--json` mode
- Does not display the notification when `--project` is explicitly set

#### Non-worktree directory handling

<!-- category: error -->

- Does not display any worktree notification when the current directory is the main checkout
- Resolves operations against the current directory normally

### Postconditions

All Rover operations must have been resolved against the main repository
root, not the worktree directory. No state must be stored in or read
from the worktree itself.

---

## Task Creation

The `rover task` command creates a new task, assigns it to an AI agent,
and launches it in an isolated environment. Tasks are the core unit of
work in Rover: each task gets its own git worktree and runs inside a
sandboxed container where the AI agent performs the requested work.

### Preconditions

The current directory must be a git repository with at least one
commit. The configured AI agent must be available on the system.
Docker must be running and accessible. Rover does **not** need to be
initialized with `rover init` before running `rover task`.

### Features

#### Basic task creation

<!-- category: core -->

- Creates a new task with an incrementing numeric ID when given a description
- Assigns a title derived from the description
- Creates a git worktree for the task providing an isolated copy of the project code
- Launches the task in a Docker container with the configured AI agent
- Outputs the task ID, title, and workspace information on successful launch
- Sets the task to `IN_PROGRESS` status initially

#### Task isolation via git worktrees

<!-- category: core -->

- Operates each task in its own git worktree with a dedicated branch
- Prevents changes in the task worktree from affecting the main branch or other task worktrees
- Uses a deterministic and identifiable branch name for the task
- Preserves the main branch commit history unchanged after task completion

#### Multi-agent task creation

<!-- category: core -->

- Creates separate tasks for each agent when multiple `--agent` flags are provided
- Assigns each task its own task ID, worktree, branch, and container
- Has all tasks work on the same description but independently
- Produces sequential task IDs

#### Non-interactive mode

<!-- category: core -->

- Allows task creation without interactive prompts when `--yes` is used
- Produces structured JSON output containing task metadata when `--json` is used
- Is fully automatable without user interaction when both flags are combined

#### Source and target branch control

<!-- category: edge -->

- Bases the worktree on the branch specified by `--source-branch` instead of the current branch
- Names the task branch according to `--target-branch` when specified

#### Container failure handling

<!-- category: error -->

- Resets the task to `NEW` status if the Docker container fails to start
- Reports the error clearly to the user
- Suggests using `rover restart` to retry

#### Task creation without prior initialization

<!-- category: edge -->

- Succeeds when running `rover task` in a project not initialized with `rover init`
- Works in any git repository without requiring prior initialization

### Postconditions

After successful task creation, a new git worktree and branch must
exist. A Docker container must be running with the AI agent working on
the task. The task must be visible in `rover list` output. Task metadata
must be persisted in the Rover store.

---

## Task Listing

The `rover list` (alias `rover ls`) command displays all tasks for the
current project or, when run outside a project, tasks from all
registered projects. It provides a real-time view of task progress and
triggers lifecycle hooks when tasks reach terminal states.

### Preconditions

At least one project must be registered in the global Rover store. For
project-scoped listing, Rover must be initialized in the current
project.

### Features

#### Project-scoped task listing

<!-- category: core -->

- Displays only the tasks belonging to the current project when run inside an initialized project
- Shows the task ID, title, agent, workflow, status, progress indicator, current step, and duration for each entry
- Visually distinguishes completed tasks from in-progress and failed tasks

#### Global task listing

<!-- category: core -->

- Displays tasks from all registered projects when run outside any project
- Groups tasks by project name
- Supports the `--project` flag to show tasks from a specific project

#### Watch mode

<!-- category: core -->

- Enables continuous refresh of the task list with `--watch`
- Uses a default refresh interval of 3 seconds
- Accepts a custom interval (1-60 seconds) as an argument to `--watch`
- Updates the display in place without scrolling
- Is exitable with Ctrl+C

#### JSON output

<!-- category: core -->

- Produces a JSON array of task objects with `--json`
- Includes the full task metadata: ID, title, status, timestamps, agent, workflow, and workspace information

#### Hook triggering on status change

<!-- category: side-effect -->

- Triggers the `onComplete` hook when a task transitions to COMPLETED or FAILED status
- Only triggers hooks when one is configured in `rover.json`
- Triggers hooks in both single-run and watch modes

### Postconditions

The task list output must accurately reflect the current state of all
tasks. No task state must be modified by the listing operation itself,
except for updating cached status from running containers.

---

## Task Inspection

The `rover inspect` command displays detailed information about a
specific task, including its metadata, workspace paths, iteration output
files, and file change statistics. It is the primary way to review the
results of a completed task.

### Preconditions

The specified task ID must exist in the current project's task store.

### Features

#### Task metadata display

<!-- category: core -->

- Displays the task ID, title, status, creation and completion timestamps, agent, workflow, source branch, worktree path, and branch name
- Shows the GitHub issue source if the task originated from one

#### Iteration output file listing

<!-- category: core -->

- Lists all files produced by the task's iterations (e.g., `summary.md`, `changes.md`, `plan.md`)
- Displays the content of `summary.md` by default
- Falls back to the last file if no `summary.md` exists

#### Specific file display

<!-- category: core -->

- Displays formatted content of specified iteration output files with `--file`
- Displays raw, unformatted content of specified files with `--raw-file`
- Treats `--file` and `--raw-file` as mutually exclusive

#### Iteration selection

<!-- category: core -->

- Accepts an optional second argument to inspect a specific iteration number
- Defaults to the latest iteration when no iteration number is provided

#### File change statistics

<!-- category: core -->

- Includes file change statistics for completed tasks
- Shows the number of insertions and deletions per changed file

#### JSON output

<!-- category: core -->

- Produces a complete JSON representation of the task with `--json`
- Includes all metadata, iteration data, and file information

#### Invalid task ID handling

<!-- category: error -->

- Produces a clear error message when the specified task ID does not exist
- Exits with a non-zero status code

#### Missing iteration directory

<!-- category: error -->

- Handles gracefully when the requested iteration number does not exist
- Produces a clear error message indicating the iteration was not found

### Postconditions

The inspect output must accurately reflect the task's current state and
all associated iteration data. No task state must be modified by the
inspection operation.

---

## Task Logs

The `rover logs` command displays the execution logs from a task's
Docker container. This is essential for debugging task failures and
monitoring agent behavior.

### Preconditions

The specified task ID must exist. The task must have been launched at
least once (a container ID must be associated with it).

### Features

#### Log retrieval

<!-- category: core -->

- Displays the Docker container logs for the specified task
- Shows the latest iteration's logs when no iteration number is specified

#### Iteration-specific logs

<!-- category: core -->

- Accepts an optional iteration number argument to view logs from a specific iteration
- Defaults to the latest iteration when not specified

#### Log following

<!-- category: core -->

- Streams logs in real-time with `--follow`, similar to `tail -f`
- Displays new log output as it is generated
- Is interruptible with Ctrl+C

#### Missing container handling

<!-- category: error -->

- Displays a clear message indicating logs are not available when the container no longer exists
- Does not fail with an obscure error

### Postconditions

The logs output must reflect the actual container logs for the specified
task and iteration. No task state must be modified by the logs operation.

---

## Task Diff

The `rover diff` command shows the git differences between a task's
worktree and a reference point (source branch or base commit). This
allows reviewing the changes an AI agent has made.

### Preconditions

The specified task ID must exist and have a valid worktree.

### Features

#### Default diff

<!-- category: core -->

- Shows all uncommitted and committed changes in the task worktree relative to the source branch
- Requires no additional flags for default behavior

#### Base commit comparison

<!-- category: core -->

- Compares the current worktree state against the base commit captured at task creation with `--base`
- Shows the full set of changes made during the task's lifetime

#### Branch comparison

<!-- category: core -->

- Compares the task worktree against a specified branch with `--branch`
- Treats `--base` and `--branch` as mutually exclusive
- Produces an error when both flags are used together

#### File-specific diff

<!-- category: edge -->

- Restricts the diff output to a single file when a file path argument is provided

#### File list mode

<!-- category: core -->

- Displays only the list of changed files with insertion and deletion counts when `--only-files` is used
- Does not show the actual diff content in this mode

### Postconditions

The diff output must accurately reflect the differences between the task
worktree and the chosen reference point. No task state or worktree
content must be modified by the diff operation.

---

## Task Iteration

The `rover iterate` (alias `rover iter`) command adds a new iteration to
an existing task with additional refinement instructions. This enables
incremental improvements to the AI agent's work without starting from
scratch.

### Preconditions

The specified task ID must exist. The task must not be currently running
(its status must be NEW, COMPLETED, or FAILED).

### Features

#### Instruction-based iteration

<!-- category: core -->

- Creates a new iteration with the provided refinement instructions
- Accepts instructions as an argument, via stdin, or through an interactive prompt
- Provides the AI agent with context from previous iterations (plan and changes) along with new instructions
- Transitions the task to `ITERATING` status
- Launches a new container for the iteration

#### Interactive iteration

<!-- category: core -->

- Opens a shell session inside the sandbox container with `--interactive`
- Allows real-time collaboration with the AI agent

#### Iteration numbering

<!-- category: core -->

- Assigns an incrementing iteration number to each iteration
- Preserves the iteration directory structure
- Keeps all previous iteration outputs accessible

#### Iterating a running task

<!-- category: error -->

- Produces a clear error message when attempting to iterate a task that is currently in `IN_PROGRESS` or `ITERATING` status
- Does not create a new iteration or launch a container

#### Invalid task ID for iteration

<!-- category: error -->

- Produces a clear error message when the specified task ID does not exist
- Exits with a non-zero status code

### Postconditions

After a successful iteration, the task must have a new iteration
directory containing the iteration configuration. The task status must
be `ITERATING` while the agent is working.

---

## Task Stop

The `rover stop` command stops a running task by terminating its Docker
container. It optionally cleans up associated resources.

### Preconditions

The specified task ID must exist.

### Features

#### Container stop

<!-- category: core -->

- Stops the Docker container running the task
- Resets the task status to `NEW`
- Clears the container information from the task metadata

#### Full cleanup

<!-- category: core -->

- Removes the Docker container, the git worktree, and the task branch with `--remove-all`
- Removes iteration directories as well

#### Selective cleanup

<!-- category: edge -->

- Removes only the Docker container with `--remove-container`
- Removes only the git worktree and branch with `--remove-git-worktree-and-branch`

### Postconditions

After stopping without cleanup flags, the task must be in `NEW` status
and eligible for restart. After stopping with cleanup flags, the
specified resources must no longer exist.

---

## Task Restart

The `rover restart` command restarts a task that is in `NEW` or `FAILED`
status. This allows retrying tasks that failed due to transient issues
without creating a new task.

### Preconditions

The specified task ID must exist. The task must be in `NEW` or `FAILED`
status.

### Features

#### Task restart

<!-- category: core -->

- Resets the task state
- Ensures the git worktree exists, creating it if missing
- Copies environment files into the worktree
- Launches a new container
- Transitions the task to `IN_PROGRESS` status on success

#### Status validation

<!-- category: error -->

- Produces an error when attempting to restart a task in any status other than `NEW` or `FAILED`

#### Container failure on restart

<!-- category: error -->

- Resets the task back to `NEW` status if the new container fails to start
- Reports the error to the user

### Postconditions

After a successful restart, the task must be in `IN_PROGRESS` status
with a running Docker container. The git worktree must exist and contain
the project code.

---

## Task Deletion

The `rover delete` (alias `rover del`) command permanently removes one
or more tasks, including all associated metadata.

### Preconditions

All specified task IDs must exist in the project.

### Features

#### Single task deletion

<!-- category: core -->

- Removes the task metadata from the store
- Prunes the associated git worktree
- Shows a confirmation prompt before deletion unless `--yes` is used

#### Bulk deletion

<!-- category: core -->

- Accepts multiple task IDs (e.g., `rover delete 1 2 3`)
- Validates all specified tasks before any deletion begins
- Reports partial failures while still deleting the tasks that can be deleted

#### Deletion confirmation

<!-- category: core -->

- Displays a summary of the tasks to be deleted (ID, title, status) before proceeding
- Prompts for confirmation
- Skips the confirmation prompt when `--yes` or `--json` mode is used

#### Invalid task ID for deletion

<!-- category: error -->

- Produces a clear error message when a specified task ID does not exist
- Does not delete any tasks when validation fails for any of the specified IDs

### Postconditions

After deletion, the task IDs must no longer appear in `rover list`
output. The associated git worktrees must be pruned.

---

## Task Merge

The `rover merge` command merges the changes from a completed task into
the current branch. It handles commit creation, attribution, and
conflict resolution.

### Preconditions

The specified task ID must exist and be in `COMPLETED` status. The main
repository must have a clean working tree (no uncommitted changes).

### Features

#### Successful merge

<!-- category: core -->

- Merges the task branch into the current branch
- Generates a commit message using AI, falling back to the task title
- Includes a `Co-Authored-By` trailer when commit attribution is enabled in `rover.json`
- Transitions the task status to `MERGED` after successful merge

#### Conflict resolution

<!-- category: edge -->

- Detects conflicted files when the merge produces conflicts
- Attempts AI-powered resolution of conflicts
- Prompts the user to review proposed resolutions before applying them
- Continues the merge to completion after conflicts are resolved

#### Uncommitted changes detection

<!-- category: edge -->

- Detects uncommitted changes in the task worktree at the time of merge
- Handles uncommitted changes appropriately (committing them first or warning the user)

#### Hook execution

<!-- category: side-effect -->

- Executes the `onMerge` hook after a successful merge when configured in `rover.json`

### Postconditions

After a successful merge, the changes from the task branch must be
present on the current branch. The task status must be `MERGED`.

---

## Task Push

The `rover push` command commits any pending changes in the task
worktree and pushes the task branch to the remote repository.

### Preconditions

The specified task ID must exist. The task must have a valid worktree
with a branch. A git remote must be configured.

### Features

#### Push with pending changes

<!-- category: core -->

- Prompts for a commit message when the task worktree has uncommitted changes
- Accepts a commit message via `--message`
- Stages all changes and creates a commit with optional `Co-Authored-By` attribution
- Pushes the branch to the remote

#### Push without pending changes

<!-- category: core -->

- Pushes the existing branch to the remote without creating a new commit when no uncommitted changes exist

#### Upstream branch creation

<!-- category: core -->

- Automatically creates the upstream tracking branch if the branch does not exist on the remote

#### GitHub PR link

<!-- category: side-effect -->

- Provides a link for creating a pull request after a successful push when the remote is a GitHub repository

#### Hook execution

<!-- category: side-effect -->

- Executes the `onPush` hook after a successful push when configured in `rover.json`

### Postconditions

After a successful push, the task branch must exist on the remote
repository with all commits. The task status must be updated to reflect
the push.

---

## Shell Access

The `rover shell` command opens an interactive shell session in a task's
workspace, allowing manual inspection and modification of the task
environment.

### Preconditions

The specified task ID must exist and have a valid worktree.

### Features

#### Local shell

<!-- category: core -->

- Opens a shell in the local worktree directory
- Uses the user's default shell from the `SHELL` environment variable
- Falls back to `/bin/sh` when `SHELL` is not set
- Sets the working directory to the task's worktree path

#### Container shell

<!-- category: core -->

- Starts a sandbox container and opens a shell inside it with `--container`
- Matches the task's execution environment

#### Invalid task ID for shell

<!-- category: error -->

- Produces a clear error message when the specified task ID does not exist
- Exits with a non-zero status code

#### Missing worktree for shell

<!-- category: error -->

- Produces a clear error message when the task's worktree directory no longer exists
- Does not open a shell session

### Postconditions

The shell session must have operated in the correct directory (local
worktree or container). No task metadata must be modified by the shell
access operation.

---

## Workflows

The `rover workflows` command group manages workflows, which are
predefined step sequences that AI agents follow when completing tasks.
Workflows can be stored at the project level or globally.

### Preconditions

For adding workflows, a valid workflow definition must be provided. For
listing and inspecting, at least one workflow must exist in the project
or global store.

### Features

#### Add workflow from URL

<!-- category: core -->

- Fetches a workflow definition from an HTTP/HTTPS URL and saves it
- Validates the workflow as proper YAML
- Allows setting a custom workflow name with `--name`
- Saves to the global store instead of the project store with `--global`

#### Add workflow from file

<!-- category: core -->

- Reads a workflow definition from a local file path and saves it
- Applies the same validation and naming options as URL sources

#### Add workflow from stdin

<!-- category: core -->

- Reads a workflow definition from standard input with `rover workflows add -`

#### List workflows

<!-- category: core -->

- Displays all available workflows from both project and global stores
- Shows the workflow name, description, number of steps, inputs, and source for each entry
- Produces a JSON array with full workflow details with `--json`

#### Inspect workflow

<!-- category: core -->

- Displays detailed information about a specific workflow including name, description, inputs, and step-by-step diagram
- Shows the raw YAML content of the workflow definition with `--raw`

#### Workflow with command step execution

<!-- category: core -->

- Executes command steps by running the specified shell command directly
- Captures stdout and stderr as step outputs
- Marks the step as successful and makes outputs available to subsequent steps when the command exits with code 0
- Marks the step as failed and stops the workflow when the command fails and `allow_failure` is not set
- Marks the step as successful and continues when the command fails and `allow_failure` is true
- Executes mixed workflows (both `agent` and `command` steps) according to each step's type
- Respects the step ordering defined in the workflow

#### Invalid workflow YAML

<!-- category: error -->

- Produces a clear error message when the workflow definition is not valid YAML
- Does not save the invalid workflow to the store

#### Unreachable workflow URL

<!-- category: error -->

- Produces a clear error message when the URL cannot be reached or returns an error
- Does not save any workflow to the store

#### Missing workflow file

<!-- category: error -->

- Produces a clear error message when the specified local file path does not exist
- Does not save any workflow to the store

### Postconditions

After adding a workflow, the workflow definition must be persisted in
the project or global store. After listing or inspecting, no workflow
state must be modified.

---

## Global Information

The `rover info` command displays information about the global Rover
store, providing an overview of all registered projects and their task
counts.

### Preconditions

The global Rover store must exist. At least one project must be
registered for meaningful output.

### Features

#### Store information display

<!-- category: core -->

- Displays the Rover data directory path
- Lists all registered projects
- Shows the project ID, name, path, and total task count for each project
- Produces a JSON representation of the same information with `--json`

#### Empty store handling

<!-- category: error -->

- Handles gracefully when no projects are registered in the global store
- Displays the data directory path and an empty project list without errors

### Postconditions

The info output must accurately reflect the current state of the global
Rover store. No store state must be modified by the info operation.

---

## Hooks

Rover supports lifecycle hooks that execute shell commands when specific
task events occur. Hooks are configured in `rover.json` and receive
context about the task through environment variables.

### Preconditions

The project must be initialized and have hooks configured in
`rover.json`. At least one task must exist.

### Features

#### onComplete hook

<!-- category: core -->

- Executes the `onComplete` hook commands when a task transitions to COMPLETED or FAILED status
- Triggers when the transition is detected by `rover list`
- Provides `ROVER_TASK_ID`, `ROVER_TASK_BRANCH`, `ROVER_TASK_TITLE`, and `ROVER_TASK_STATUS` environment variables
- Sets `ROVER_TASK_STATUS` to `completed` or `failed`

#### onMerge hook

<!-- category: core -->

- Executes the `onMerge` hook commands after a successful `rover merge`
- Provides `ROVER_TASK_ID`, `ROVER_TASK_BRANCH`, and `ROVER_TASK_TITLE` environment variables

#### onPush hook

<!-- category: core -->

- Executes the `onPush` hook commands after a successful `rover push`
- Provides `ROVER_TASK_ID`, `ROVER_TASK_BRANCH`, and `ROVER_TASK_TITLE` environment variables

#### Hook failure isolation

<!-- category: error -->

- Logs a warning when a hook command fails with a non-zero exit status
- Does not block or roll back the operation that triggered the hook

#### Multiple hook commands

<!-- category: edge -->

- Accepts an array of commands for each hook type
- Executes all commands in the array when the hook is triggered

### Postconditions

After hook execution, all configured hook commands must have been
invoked with the correct environment variables. Hook failures must not
have affected the triggering operation's success state.

---

## Cost Control

Rover reports workflows sessions token usage and cost control, if the
agent supports reporting that information.

### Preconditions

The agent that runs the task supports reporting token usage and/or
cost control.

### Features

#### Step token and/or cost usage

<!-- category: core -->

- Reports the token consumption after executing a step of type agent within a workflow
- Reports the cost of that step if available

#### Workflow token and/or cost usage

<!-- category: core -->

- Reports the total token usage after executing a workflow
- Sums all token usage and cost across all steps within the workflow

#### Agent without cost reporting

<!-- category: edge -->

- Handles gracefully when the agent does not report token usage or cost information
- Does not fail the workflow or step execution
- Omits cost fields from the output rather than showing zeros or errors
