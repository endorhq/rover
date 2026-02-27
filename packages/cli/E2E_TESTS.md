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

### Feature: Prerequisite detection

Rover must verify that required system tools are available before
proceeding with initialization. Docker (or Podman) is mandatory. At
least one supported AI agent (Claude, Codex, Gemini, or Qwen) must be
installed. If Docker is missing, initialization must fail with an error
indicating that Docker is required. If no AI agent is found,
initialization must fail with an error indicating that at least one AI
agent is needed. When multiple AI agents are available, all of them must
be detected and recorded. The first available agent is selected as the
default when running non-interactively with the `--yes` flag.

### Feature: Project environment detection

Rover must inspect the repository to identify the programming languages,
package managers, and task managers in use. For languages, it must
detect TypeScript, JavaScript, Rust, Python, Go, PHP, Dart, and others
based on the presence of characteristic files (e.g., `tsconfig.json` for
TypeScript, `Cargo.toml` for Rust, `pyproject.toml` for Python,
`go.mod` for Go, `composer.json` for PHP, `pubspec.yaml` for Dart). For
package managers, it must detect npm, pnpm, yarn, cargo, uv, pip,
poetry, gomod, composer, pub, and others based on lock files and
configuration files. For task managers, it
must detect Make, Just, and Task based on the presence of `Makefile`,
`Justfile`, and `Taskfile.yml` respectively. Polyglot projects with
multiple languages, package managers, and task managers must be detected
correctly.

### Feature: Configuration file creation

On successful initialization, Rover must create `rover.json` at the
project root containing detected languages, package managers, task
managers, and other project settings. It must also create
`.rover/settings.json` containing the list of detected AI agents and the
selected default agent. Both files must be valid JSON and reflect the
actual project environment accurately.

### Feature: Gitignore management

Rover must ensure that `.rover/` is listed in `.gitignore`. If no
`.gitignore` exists, one must be created containing `.rover/`. If a
`.gitignore` already exists, `.rover/` must be appended to it without
disturbing existing entries. If `.rover/` is already present in
`.gitignore`, it must not be duplicated.

### Feature: Re-initialization prevention

If Rover is already initialized in the project (both `rover.json` and
`.rover/settings.json` exist), running `rover init` again must detect
this and report that the project is already initialized. The existing
configuration must not be overwritten.

### Feature: Cloned repository initialization

When a repository that was previously initialized with Rover is cloned,
running `rover init` in the clone must succeed. The existing
`rover.json` that was committed must be respected, and
`.rover/settings.json` must be created with the locally detected AI
agents.

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

### Feature: Worktree detection and notification

When a user runs a Rover command from inside a git worktree and has not
specified a `--project` option, Rover must detect that the current
directory is a worktree, display a notification indicating the main
project root being used, and resolve all operations against the main
repository instead of the worktree. The notification must not appear when
running in `--json` mode or when `--project` is explicitly set.

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

### Feature: Basic task creation

Running `rover task` with a description (either as an argument or via
interactive prompt) must create a new task with an incrementing numeric
ID. The task must receive a title derived from the description. A git
worktree must be created for the task, providing an isolated copy of the
project code. The task must be launched in a Docker container with the
configured AI agent. On successful launch, the command must output the
task ID, title, and workspace information. The task must initially be in
`IN_PROGRESS` status.

### Feature: Task isolation via git worktrees

Each task must operate in its own git worktree with a dedicated branch.
Changes made by the AI agent in the task worktree must not affect the
main branch or any other task's worktree. The task branch name must be
deterministic and identifiable. After task completion, the main branch
must have the same commit history it had before the task was created.

### Feature: Multi-agent task creation

When multiple `--agent` flags are provided (e.g.,
`--agent claude --agent gemini`), Rover must create separate tasks for
each agent, each with its own task ID, worktree, branch, and container.
All tasks must work on the same description but independently. The
resulting task IDs must be sequential.

### Feature: Non-interactive mode

The `--yes` flag must allow task creation without any interactive
prompts. The `--json` flag must produce structured JSON output containing
the task metadata. When both flags are used together, the command must be
fully automatable without any user interaction.

### Feature: Source and target branch control

The `--source-branch` flag must allow specifying which branch the
worktree is based on, instead of defaulting to the current branch. The
`--target-branch` flag must allow specifying a custom name for the task's
branch.

### Feature: Container failure handling

If the Docker container fails to start or the AI agent cannot be
launched, the task must be reset to `NEW` status. The error must be
reported clearly to the user. A suggestion to use `rover restart` must
be provided.

### Feature: Task creation without prior initialization

Running `rover task` in a project that has not been initialized with
`rover init` must succeed. Rover configuration is optional and the
task command must work in any git repository without requiring prior
initialization.

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

### Feature: Project-scoped task listing

When run inside an initialized project, `rover list` must display only
the tasks belonging to that project. Each task entry must show the task
ID, title, agent, workflow, status, progress indicator, current step,
and duration. Completed tasks must be visually distinguished from
in-progress and failed tasks.

### Feature: Global task listing

When run outside any project, or with the `--project` flag,
`rover list` must display tasks from all registered projects, grouped by
project name. This provides a unified view across all Rover-managed
work.

### Feature: Watch mode

The `--watch` flag must enable continuous refresh of the task list. The
default refresh interval must be 3 seconds. A custom interval (1-60
seconds) can be specified as an argument to `--watch`. The display must
update in place without scrolling. Watch mode must be exitable with
Ctrl+C.

### Feature: JSON output

The `--json` flag must produce a JSON array of task objects, each
containing the full task metadata including ID, title, status,
timestamps, agent, workflow, and workspace information.

### Feature: Hook triggering on status change

When `rover list` detects that a task has transitioned to a terminal
status (COMPLETED or FAILED), it must trigger the `onComplete` hook if
one is configured in `rover.json`. This applies in both single-run and
watch modes.

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

### Feature: Task metadata display

`rover inspect <taskId>` must display the task ID, title, status,
creation and completion timestamps, agent, workflow, source branch,
worktree path, and branch name. If the task originated from a GitHub
issue, the source must be shown.

### Feature: Iteration output file listing

The inspect output must list all files produced by the task's iterations
(e.g., `summary.md`, `changes.md`, `plan.md`). By default, the content
of `summary.md` (or the last file if no summary exists) must be
displayed.

### Feature: Specific file display

The `--file` flag must allow displaying the formatted content of one or
more specific iteration output files. The `--raw-file` flag must display
the raw, unformatted content of the specified files. These two flags
must be mutually exclusive.

### Feature: Iteration selection

An optional second argument must allow inspecting a specific iteration
number instead of the latest one. This enables reviewing the output of
earlier iterations.

### Feature: File change statistics

For completed tasks, the inspect output must include file change
statistics showing the number of insertions and deletions per changed
file.

### Feature: JSON output

The `--json` flag must produce a complete JSON representation of the
task including all metadata, iteration data, and file information.

---

## Task Logs

The `rover logs` command displays the execution logs from a task's
Docker container. This is essential for debugging task failures and
monitoring agent behavior.

### Preconditions

The specified task ID must exist. The task must have been launched at
least once (a container ID must be associated with it).

### Feature: Log retrieval

`rover logs <taskId>` must display the Docker container logs for the
specified task. If no iteration number is specified, the latest
iteration's logs must be shown.

### Feature: Iteration-specific logs

An optional iteration number argument must allow viewing logs from a
specific iteration instead of the latest one.

### Feature: Log following

The `--follow` flag must stream logs in real-time, similar to
`tail -f`. New log output must appear as it is generated. The stream
must be interruptible with Ctrl+C.

### Feature: Missing container handling

If the container no longer exists (e.g., it was removed), the command
must display a clear message indicating that logs are not available
rather than failing with an obscure error.

---

## Task Diff

The `rover diff` command shows the git differences between a task's
worktree and a reference point (source branch or base commit). This
allows reviewing the changes an AI agent has made.

### Preconditions

The specified task ID must exist and have a valid worktree.

### Feature: Default diff

`rover diff <taskId>` without additional flags must show all uncommitted
and committed changes in the task worktree relative to the source
branch.

### Feature: Base commit comparison

The `--base` flag must compare the current worktree state against the
base commit captured when the task was created. This shows the full set
of changes made during the task's lifetime.

### Feature: Branch comparison

The `--branch` flag must compare the task worktree against a specified
branch. The `--base` and `--branch` flags must be mutually exclusive;
using both must result in an error.

### Feature: File-specific diff

An optional file path argument must restrict the diff output to a
single file.

### Feature: File list mode

The `--only-files` flag must display only the list of changed files with
insertion and deletion counts, without showing the actual diff content.

---

## Task Iteration

The `rover iterate` (alias `rover iter`) command adds a new iteration to
an existing task with additional refinement instructions. This enables
incremental improvements to the AI agent's work without starting from
scratch.

### Preconditions

The specified task ID must exist. The task must not be currently running
(its status must be NEW, COMPLETED, or FAILED).

### Feature: Instruction-based iteration

`rover iterate <taskId> [instructions]` must create a new iteration with
the provided refinement instructions. The instructions can be passed as
an argument, via stdin, or through an interactive prompt. The AI agent
receives context from previous iterations (plan and changes) along with
the new instructions. The task must transition to `ITERATING` status and
a new container must be launched.

### Feature: Interactive iteration

The `--interactive` flag must open a shell session inside the sandbox
container, allowing real-time collaboration with the AI agent rather
than providing instructions upfront.

### Feature: Iteration numbering

Each iteration must have an incrementing iteration number. The iteration
directory structure must be preserved, and all previous iteration
outputs must remain accessible.

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

### Feature: Container stop

`rover stop <taskId>` must stop the Docker container running the task.
The task status must be reset to `NEW`. The container information must be
cleared from the task metadata.

### Feature: Full cleanup

The `--remove-all` flag must remove the Docker container, the git
worktree, and the task branch. Iteration directories must also be
removed.

### Feature: Selective cleanup

The `--remove-container` flag must remove only the Docker container. The
`--remove-git-worktree-and-branch` flag must remove only the git
worktree and branch. These allow partial cleanup when needed.

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

### Feature: Task restart

`rover restart <taskId>` must reset the task, ensure the git worktree
exists (creating it if missing), copy environment files, and launch a
new container. On success, the task must transition to `IN_PROGRESS`
status.

### Feature: Status validation

Attempting to restart a task that is in any status other than `NEW` or
`FAILED` must result in an error.

### Feature: Container failure on restart

If the new container fails to start, the task must be reset back to
`NEW` status and the error must be reported.

---

## Task Deletion

The `rover delete` (alias `rover del`) command permanently removes one
or more tasks, including all associated metadata.

### Preconditions

All specified task IDs must exist in the project.

### Feature: Single task deletion

`rover delete <taskId>` must remove the task metadata from the store and
prune the associated git worktree. A confirmation prompt must be shown
before deletion unless the `--yes` flag is used.

### Feature: Bulk deletion

Multiple task IDs can be specified (e.g., `rover delete 1 2 3`). All
specified tasks must be validated before any deletion begins. If some
deletions fail, the command must report partial failures while still
deleting the tasks that can be deleted.

### Feature: Deletion confirmation

Before deleting, the command must display a summary of the tasks to be
deleted (ID, title, status) and prompt for confirmation. The `--yes`
flag or `--json` mode must skip the confirmation prompt.

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

### Feature: Successful merge

`rover merge <taskId>` must merge the task branch into the current
branch. A commit message must be generated (using AI or falling back to
the task title). If commit attribution is enabled in `rover.json`, the
commit must include a `Co-Authored-By` trailer. After successful merge,
the task status must transition to `MERGED`.

### Feature: Conflict resolution

If the merge produces conflicts, Rover must detect the conflicted files
and attempt AI-powered resolution. The user must be prompted to review
the proposed resolutions before they are applied. After conflicts are
resolved, the merge must continue to completion.

### Feature: Uncommitted changes detection

If the task worktree has uncommitted changes at the time of merge, Rover
must detect and handle them appropriately (either by committing them
first or warning the user).

### Feature: Hook execution

After a successful merge, the `onMerge` hook must be executed if
configured in `rover.json`.

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

### Feature: Push with pending changes

If the task worktree has uncommitted changes, `rover push` must prompt
for a commit message (or accept one via `--message`), stage all changes,
create a commit with optional `Co-Authored-By` attribution, and push
the branch to the remote.

### Feature: Push without pending changes

If the task worktree has no uncommitted changes, `rover push` must push
the existing branch to the remote without creating a new commit.

### Feature: Upstream branch creation

If the branch does not exist on the remote, `rover push` must
automatically create the upstream tracking branch.

### Feature: GitHub PR link

If the remote is a GitHub repository, after a successful push Rover must
provide a link for creating a pull request.

### Feature: Hook execution

After a successful push, the `onPush` hook must be executed if
configured in `rover.json`.

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

### Feature: Local shell

`rover shell <taskId>` without additional flags must open a shell in the
local worktree directory. The shell must be the user's default shell
(from the `SHELL` environment variable) or fall back to `/bin/sh`. The
working directory must be set to the task's worktree path.

### Feature: Container shell

The `--container` flag must start a sandbox container and open a shell
inside it, matching the task's execution environment. This allows
debugging in the same environment the AI agent used.

---

## Workflows

The `rover workflows` command group manages workflows, which are
predefined step sequences that AI agents follow when completing tasks.
Workflows can be stored at the project level or globally.

### Feature: Add workflow from URL

`rover workflows add <url>` must fetch a workflow definition from an
HTTP/HTTPS URL and save it. The workflow must be validated as proper
YAML. An optional `--name` flag must allow setting a custom workflow
name. The `--global` flag must save the workflow to the global store
instead of the project store.

### Feature: Add workflow from file

`rover workflows add <path>` must read a workflow definition from a
local file path and save it with the same validation and naming options
as URL sources.

### Feature: Add workflow from stdin

`rover workflows add -` must read a workflow definition from standard
input.

### Feature: List workflows

`rover workflows list` must display all available workflows from both
project and global stores. Each entry must show the workflow name,
description, number of steps, inputs, and source. The `--json` flag must
produce a JSON array with full workflow details.

### Feature: Inspect workflow

`rover workflows inspect <workflow>` must display detailed information
about a specific workflow, including its name, description, inputs, and
a step-by-step diagram of the workflow flow. The `--raw` flag must show
the raw YAML content of the workflow definition.

### Feature: Workflow with command step execution

Workflows can contain steps of type `command` in addition to the usual
`agent` steps. A command step runs a shell command directly (without
invoking an AI agent) and captures its stdout and stderr as step
outputs.

When a workflow is run and encounters a command step, Rover must execute
the specified `command` (with optional `args`) synchronously and capture
its output. If the command succeeds (exit code 0), the step must be
marked as successful and its stdout and stderr must be available as step
outputs for subsequent steps. If the command fails (non-zero exit code)
and `allow_failure` is not set or is false, the step must be marked as
failed and the workflow must stop (unless `continueOnError` is enabled
at the workflow level). If the command fails and `allow_failure` is
true, the step must be marked as successful and the workflow must
continue to the next step.

A workflow with mixed step types (both `agent` and `command` steps) must
execute each step according to its type: command steps run the command
directly, while agent steps are dispatched to the configured AI agent.
The step ordering defined in the workflow must be respected.

---

## Global Information

The `rover info` command displays information about the global Rover
store, providing an overview of all registered projects and their task
counts.

### Feature: Store information display

`rover info` must display the Rover data directory path and list all
registered projects. Each project entry must show the project ID, name,
path, and total task count. The `--json` flag must produce a JSON
representation of the same information.

---

## Hooks

Rover supports lifecycle hooks that execute shell commands when specific
task events occur. Hooks are configured in `rover.json` and receive
context about the task through environment variables.

### Preconditions

The project must be initialized and have hooks configured in
`rover.json`. At least one task must exist.

### Feature: onComplete hook

When a task transitions to `COMPLETED` or `FAILED` status and this
transition is detected by `rover list`, the `onComplete` hook commands
must be executed. The hook must receive the environment variables
`ROVER_TASK_ID`, `ROVER_TASK_BRANCH`, `ROVER_TASK_TITLE`, and
`ROVER_TASK_STATUS` (set to `completed` or `failed`).

### Feature: onMerge hook

After a successful `rover merge`, the `onMerge` hook commands must be
executed. The hook must receive `ROVER_TASK_ID`, `ROVER_TASK_BRANCH`,
and `ROVER_TASK_TITLE` as environment variables.

### Feature: onPush hook

After a successful `rover push`, the `onPush` hook commands must be
executed. The hook must receive `ROVER_TASK_ID`, `ROVER_TASK_BRANCH`,
and `ROVER_TASK_TITLE` as environment variables.

### Feature: Hook failure isolation

If a hook command fails (exits with a non-zero status), the failure must
be logged as a warning but must not block or roll back the operation that
triggered the hook.

### Feature: Multiple hook commands

Each hook type accepts an array of commands. All commands in the array
must be executed when the hook is triggered.

---

## Cost Control

Rover reports workflows sessions token usage and cost control, if the
agent supports reporting that information.

### Preconditions

The agent that runs the task supports reporting token usage and/or
cost control.

### Feature: Step token and/or cost usage

After executing a step of type agent within a workflow, Rover should
report the token consumption on that step, as well as the cost of that
step (if available).

### Feature: Workflow token and/or cost usage

After executing a workflow, Rover should report the total usage of
that workflow (sum of all token usage/cost of all steps within that
workflow).
