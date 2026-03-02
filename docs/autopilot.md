# Autopilot

Autopilot mode allows Rover to monitor events from external sources and react to them autonomously. Each event triggers a chain of processing steps that can range from a simple "no action needed" to planning, executing, and pushing complete features.

The process is adaptive: AI coding agents participate in decision-making steps, analyzing context and determining the next action. This creates flexibility while maintaining a structured pipeline that mirrors common software development workflows.

## Core Concepts

### Events

Events are the inputs to the autopilot pipeline. They originate from external sources — currently GitHub repository events (issues, pull requests, pushes, comments, reviews). Events are polled periodically and deduplicated to avoid reprocessing.

Each event enters the pipeline as the root of a new **trace**.

### Spans

A span records the execution of a single step. It captures what the step did, when it happened, and any relevant metadata. Spans are linked in three ways:

- **`parentId`** — the parent span, forming a chain back to the root event.
- **`originAction`** — the action that was processed to create this span. `null` for the root event span (which has no origin action). This links a span back to its trigger.
- **`newActions`** — the action IDs generated during this span's execution. This links a span forward to the work it produced. Populated automatically when `ActionWriter` creates an action — it registers itself on its parent span.

Together, these fields make the full graph traversable in both directions: from any span you can walk up to the root (`parentId`), back to the action that triggered it (`originAction`), and forward to the actions it produced (`newActions`).

Spans are **mutable during processing**: created at the start of a step with initial metadata, then updated with results (`status`, `summary`, `completed` timestamp, additional `meta`) when the step finishes. After completion, spans are immutable.

Each span carries a `status` that distinguishes between different outcomes:

| Status | Meaning |
|---|---|
| `running` | Step is in progress. Initial status when the span is created. |
| `completed` | Step finished successfully. |
| `failed` | Step ran to completion, but the outcome was negative. The step did its job — the result just wasn't successful (e.g., a workflow task couldn't solve the problem, a code review found issues). This is an expected negative outcome the pipeline knows how to handle. |
| `error` | Step couldn't finish due to an environmental or unexpected issue (missing tool, signing failure, crash, pre-hook error). The step didn't complete its job. |

This distinction drives the resolver's behavior: `failed` steps suggest the approach was wrong (→ `iterate` with new instructions), while `error` steps suggest the environment is broken (→ `retry` after fixing it).

### Actions

An action is an **intent** for a next step. When a step completes, it may produce 0-N actions describing what should happen next and including all metadata needed to execute.

Actions are **immutable** after creation. They represent a decision that was made — not an ongoing process. Each action references its parent span via `spanId` (the span that created it). The parent span's `newActions` array automatically includes the action's ID, making the relationship traversable from both sides.

### Traces

A trace is the complete execution history for a single event. It is a **tree of spans** rooted at the event span (`parentId: null`). The tree fans out when a step produces multiple actions (e.g., the planner creating N parallel workflow tasks) and each branch proceeds independently.

```plain
event (root)
  └── coordinate
        └── plan
              ├── workflow/swe (task 1) → commit → resolve ─┐
              ├── workflow/swe (task 2) → commit → resolve ─┤→ push → noop
              └── workflow/code-review (task 3) → commit → resolve ─┘
```

A trace is identified by the root event span's ID (`traceId`). Any span in the trace can reconstruct the full chain back to the root by walking `parentId` references.

**The event is a real trace step.** When a new trace is created, the event is recorded as step `[0]` with `action: "event"`, `originAction: null`, and `status: "completed"`. The event step's `spanId` points to the root event span, and its `newActions` lists the coordinate action it produced. Subsequent steps use `originAction` to reference the action that triggered them.

### Pending Actions

The **pending queue** is the work queue that drives the pipeline. Each entry references an action and specifies which step should process it. Steps poll for their pending actions periodically.

When a step creates an action, it also enqueues a corresponding pending entry. The target step picks it up on its next processing cycle, creates a span, does the work, and removes the pending entry.

## Pipeline

### Step Chain

The pipeline consists of ten steps, each responsible for a specific concern:

```plain
Event → Coordinate → Plan → Workflow → Commit → Resolve → Push → Notify
                ↘ Noop
                ↘ Cleanup
```

Not every event traverses all steps. The coordinator may decide no action is needed and produce a `noop` action, ending the trace after three spans (`event → coordinate → noop`). When a Rover-created PR is merged, the coordinator produces a `cleanup` action to tear down the workspace (`event → coordinate → cleanup`). The resolver may loop back to retry a failed workflow. Multiple steps can branch into Notify as a terminal step — the coordinator, planner, resolver, and pusher can all produce `notify` actions.

### Processing Model

A single `StepOrchestrator` manages all steps using a hybrid event-driven + fallback interval model:

- **Eager drain**: When new actions are enqueued (e.g. coordinator produces a `plan` action), the orchestrator immediately re-drains the pending queue. This creates natural cascading — event → coordinate → plan → workflow flows without waiting between steps. The drain loop continues as long as there are processable actions (respecting per-step `maxParallel`). Each drain iteration runs `monitor()` calls first, so external state changes (like a workflow task completing in its sandbox) are detected immediately before reading the pending queue.
- **Fallback interval**: A single background timer (30s) acts as a safety net — it triggers a drain cycle in case an eager drain was missed (e.g. startup recovery, edge cases). It is not the primary mechanism for detecting state changes; the drain loop handles that.

Each step defines a `maxParallel` limit — the maximum concurrent actions being processed for that step type. Steps communicate exclusively through the store: one step writes an action and enqueues a pending entry; another step reads and processes it. There is no direct coupling between steps.

### Concurrency

A single `AutopilotStore` instance manages all persistence. All steps share this instance. The store serializes read-modify-write operations on the state file to prevent race conditions.

### AI Agents

AI coding agents are involved in specific steps as a critical piece. Based on the context and trace, they analyze the situation and define the next natural step. Not all steps use AI — some perform well-defined deterministic actions (like committing with `git`). AI agents are useful when there are multiple possible next steps or when recovering from unexpected errors.

Each AI-backed step includes a system prompt that defines how the agent should behave. The agent output is parsed into a structured result that determines the actions produced.

**Rule of thumb**: If a step has 1-2 simple branches, hardcode it. If the decision space is broader or errors can be unpredictable, use an AI agent. For example, the committer has a clear fork: task succeeded → commit, task failed → skip. That's hardcoded. The resolver, on the other hand, faces a wide range of failure modes — a missing pre-commit hook tool, a GPG signing error, a merge conflict, a flaky test — each requiring different corrective action. These are better handled by an AI agent that can read error output, diagnose the cause, and decide on a fix.

AI-backed steps that need to diagnose or fix issues (like the resolver) should have access to tools — reading logs, running commands, inspecting the environment. They don't just decide the next action; they can take corrective action before deciding.

**No AI-generated attribution**: AI agents running inside the pipeline must not add their own attribution lines to commit messages, PR titles, or PR bodies — things like "Generated by Claude Code", "Generated with Codex", "Co-Authored-By: Claude", etc. The only attribution allowed is the Rover trailer (`Co-Authored-By: Rover <noreply@endor.dev>`) when the project has attribution enabled. This is enforced via the agent system prompts for steps that produce git artifacts (committer, pusher).

### Examples

```plain
# Push to main, CI passes
event (push) → coordinate (CI green, all OK) → noop ("CI passed, no issues found")

# Push to main, CI fails
event (push) → coordinate (CI failed) → plan (fix CI) → workflow/swe → commit → resolve → push → notify (comment on commit)

# New issue filed
event (issue opened) → coordinate (implement) → plan (2 tasks)
  ├── workflow/swe (implement) → commit → resolve (wait...)
  └── workflow/swe (tests)     → commit → resolve (push) → push → notify (comment on issue: "Fixed in PR #N")

# PR review requested
event (review requested) → coordinate (review) → plan → workflow/code-review → commit → resolve → notify (post review on PR)

# Coordinator decides to respond directly
event (issue comment) → coordinate (already fixed) → notify (reply on issue: "This was resolved in v2.1")

# Planner needs clarification
event (issue opened, vague) → coordinate → plan → notify (comment on issue: "Can you clarify X?")
  ... later, user replies ...
event (issue comment, with answer) → coordinate (has context now) → plan → workflow/swe → commit → resolve → push → notify

# Workflow fails (status: failed), retry with new approach succeeds
→ workflow/swe [failed] → commit (no changes) → resolve (iterate) → workflow/swe (retry) [completed] → commit → resolve → push → notify

# Commit errors (status: error), resolver fixes environment and retries
→ workflow/swe [completed] → commit [error: missing pre-hook tool] → resolve (install tool, retry) → commit [completed] → resolve → push → notify

# Workflow fails, max retries exceeded
→ workflow/swe [failed] → commit → resolve (iterate) → workflow/swe [failed] → commit → resolve (fail)

# Rover-created PR is merged, workspace cleaned up
event (PR merged) → coordinate (Rover PR, cleanup) → cleanup (remove worktree, branch, task)

# Reviewer requests changes on a Rover-created PR
event (PR review: "changes requested") → coordinate (Rover PR, feedback) → plan (iterate with feedback) → workflow/swe (existing task/branch) → commit → resolve → push → notify
```

## Steps

Each step defines a contract: what it consumes, what it produces, and its behavior.

### Event

Polls GitHub for repository events, filters relevant ones, and creates the root span for each new trace.

| | |
|---|---|
| **Trigger** | Periodic polling |
| **Input** | GitHub API events |
| **Span** | `step: "event"`, `parentId: null`, meta contains structured event data |
| **Actions** | One `coordinate` action per relevant event |
| **Dedup** | Cursor of processed event IDs (capped, FIFO) |

**Supported event types**: `IssuesEvent`, `PullRequestEvent`, `IssueCommentEvent`, `PullRequestReviewEvent`, `PullRequestReviewCommentEvent`, `PushEvent`.

Each event type defines a set of relevant actions (e.g., `opened`, `closed` for issues). Events with non-matching actions are dropped.

**Self-comment filtering**: Before an event is accepted, the event step checks whether the comment or review body contains the Rover footer marker (`<summary>Generated by Rover</summary>`). If present, the event is dropped — it was posted by the pipeline itself and must not re-enter it. This applies to `IssueCommentEvent`, `PullRequestReviewEvent`, and `PullRequestReviewCommentEvent`. The check uses the full payload body (before any truncation), so it catches the marker even in long messages. See [Rover Footer](#rover-footer) for how the marker is injected.

### Coordinator

The decision-making entry point. Receives events and decides what the autopilot should do about them. Uses an AI agent to analyze the event in context.

| | |
|---|---|
| **Trigger** | Pending `coordinate` action |
| **Input** | Event span meta + additional GitHub context (fetched via API) |
| **Span** | `step: "coordinate"`, meta contains the decision |
| **Actions** | 0-1 actions depending on the decision |
| **AI** | Yes |
| **Max parallel** | 3 |

**Context enrichment**: Before invoking the AI, the coordinator fetches additional context from GitHub based on event type — full issue/PR bodies, recent comments, CI status, labels, and `headRefName` for PR-related events. This gives the AI enough information to make a good decision without over-fetching. The `headRefName` field is used for Rover-created PR detection (see below).

**Decisions**:

| Decision | Description | Produces Action |
|---|---|---|
| `noop` | No action needed — reason is recorded in the action | `noop` action |
| `plan` | Needs task decomposition | `plan` action |
| `workflow` | Single well-defined task, skip planning | `workflow` action |
| `notify` | Respond to the source — answer a question, acknowledge, clarify | `notify` action |
| `wait` | Wait for external conditions | `wait` action |
| `flag` | Flag for human review | `flag` action |
| `cleanup` | A Rover-created PR was merged — tear down the associated workspace | `cleanup` action |

The coordinator cannot produce a `coordinate` action (no recursive self-dispatch). When the coordinator needs clarification before proceeding, it uses `notify` to post the question back to the source channel (see [Clarification Pattern](#clarification-pattern)).

**Rover-created PR detection**: After fetching context, the coordinator checks whether the PR was created by Rover. It reads `headRefName` from the enriched context and iterates `store.getAllTaskMappings()`, matching against `mapping.branchName`. If a match is found, the coordinator injects an **Automation Context** section into the pilot prompt. This section tells the AI that the PR was created by the automation system and provides the task ID, branch name, and original trace ID. It also biases the AI's decision: actionable feedback should route to `plan` (not `clarify`), approval/positive acknowledgement should route to `noop`, and `clarify` should only be used when intent is genuinely ambiguous. This prevents the feedback loop where the bot asks clarification questions on its own PRs and then re-triggers on its own comments.

**Rover-created PR handling**: The coordinator has two additional responsibilities for events that target pull requests created by Rover:

1. **Merged PR → cleanup.** When a `PullRequestEvent` with action `closed` (merged) arrives, the coordinator checks `taskMappings` in the state to determine if the PR belongs to a Rover task. If a match is found, it produces a `cleanup` action referencing the associated task. The cleanup step then tears down the workspace. Chain: `event → coordinate → cleanup`.

2. **PR feedback → iterate via planner.** When review comments, PR comments, or review requests arrive on a Rover-created PR, the coordinator recognizes the PR as its own via the `headRefName` → `taskMappings` lookup described above. Instead of treating the feedback as an unrelated event, it routes to `plan`. This is a separate, independent trace — there is no cross-trace linking. The planner receives the full feedback context along with the existing task reference, understands the situation, and produces a `workflow` action that iterates on the existing task and branch with updated instructions. Chain: `event → coordinate → plan → workflow (iterate existing task) → commit → resolve → push → notify`.

### Noop

An explicit "no operation" terminal step. Records why the pipeline decided not to act and ends the trace. Without this step, a trace that stops at the coordinator would be indistinguishable from one that errored — `event → coordinate` looks incomplete. With noop, the trace reads `event → coordinate → noop` and the noop action's `reason` field explains the decision.

| | |
|---|---|
| **Trigger** | Pending `noop` action |
| **Input** | Noop action meta (contains the reason from the producing step) + full span chain |
| **Span** | `step: "noop"`, `status: "completed"`, `meta.summary` contains AI-generated trace summary |
| **Actions** | None (trace ends) |
| **AI** | Yes — lightweight (haiku) for trace summarization, with fallback |
| **Max parallel** | 5 |

The noop step creates a span and generates a concise summary of the entire trace chain using a lightweight AI agent (haiku). The summary is stored in `meta.summary` and describes what the pipeline evaluated and why no action was taken. If the AI call fails, it falls back to a simple concatenation of span summaries. This summary is useful for dashboards and trace inspection — it turns a raw chain of spans into a human-readable sentence.

### Planner

Decomposes a high-level directive into concrete, parallelizable workflow tasks. Uses an AI agent with read-only codebase access and limited GitHub CLI access to understand the project and referenced issues/PRs before planning.

| | |
|---|---|
| **Trigger** | Pending `plan` action |
| **Input** | Plan action meta + full span trace from root |
| **Span** | `step: "plan"`, meta contains the full plan (analysis, tasks, execution order) |
| **Actions** | 1-N `workflow` actions, or 1 `notify` action if clarification is needed |
| **AI** | Yes — has read-only codebase tools (`Read`, `Glob`, `Grep`) and restricted shell access (`Bash(gh:*)`) for fetching GitHub issues and PRs |
| **Max parallel** | 2 |

**GitHub context fetching**: When a directive references external issues or PRs — by number (`#12`), URL (`https://github.com/org/repo/issues/12`), or cross-repo reference (`owner/repo#N`) — the planner can fetch their content using `gh issue view <number>` or `gh pr view <number>`. Shell access is restricted to `gh` commands only via the `Bash(gh:*)` tool constraint; no other shell commands are permitted. This eliminates the need for bespoke reference-parsing code in `context.ts` — the AI agent naturally handles all reference formats.

**Clarification**: While exploring the codebase and analyzing the directive, the planner may determine it cannot proceed without more information. In this case, it produces a single `notify` action instead of workflow actions. The notify step posts the question to the source channel, and the trace ends. A future event (e.g., a reply comment) will start a new trace with the answer available in context (see [Clarification Pattern](#clarification-pattern)).

**Task dependencies**: The planner can specify that one task depends on another (e.g., "add tests" depends on "implement feature"). Dependencies are expressed via `depends_on` in the action meta, referencing another action's ID within the same plan. The workflow runner resolves these before launching.

**Available workflow types**: `swe`, `code-review`, `bug-finder`, `security-analyst`.

### Workflow Runner

Launches coding agents in isolated Docker sandbox environments and monitors their execution. This is the step where actual code changes happen.

| | |
|---|---|
| **Trigger** | Pending `workflow` action |
| **Input** | Workflow action meta (title, description, acceptance criteria, workflow type) |
| **Span** | `step: "workflow"`, meta contains task ID, branch, status |
| **Actions** | One `commit` action when the task completes or fails |
| **Max running tasks** | 3 |

**Lifecycle**:

1. Resolve dependencies — wait if a dependent task hasn't completed yet.
2. Create a Rover task and git worktree on a new branch.
3. Launch a Docker sandbox with the configured AI agent.
4. Monitor task status periodically.
5. On completion or failure: write a `commit` action.

**Branch management**: Each workflow task gets its own branch, forked from either the main branch or the dependency's branch (if the task depends on another).

### Committer

Handles git operations after a workflow task completes. Stages, commits, and records the result.

| | |
|---|---|
| **Trigger** | Pending `commit` action |
| **Input** | Commit action meta (references the source workflow) |
| **Span** | `step: "commit"`, meta contains commit hash, message, or error details |
| **Actions** | One `resolve` action |
| **AI** | Yes — has `Bash` tool access for git operations and pre-hook recovery |
| **Max parallel** | 3 |

**Behavior**:

- If the task **failed**: skip commit, record failure in span meta, produce a `resolve` action.
- If the task **completed**: check for uncommitted changes in the worktree. If present, generate an AI commit message, stage, and commit. If no changes, record that.
- If the **commit itself fails** (pre-hook error, signing failure, etc.): capture the full error details — stderr output, exit code, the command that failed — in the span meta. Do not discard error context. The resolver depends on rich error information to diagnose and fix issues.
- Always produces a `resolve` action regardless of outcome. The resolver decides what to do next.
- The committer must not add AI-generated attribution (e.g., "Generated by Claude Code"). Only the Rover trailer is allowed when attribution is enabled.

### Resolver

Evaluates the state of an entire trace and decides the next course of action. The resolver is an AI-driven step with access to tools — it can read error logs, run diagnostic commands, and take corrective action before deciding. Real-world failures are messy (missing tools, pre-hook errors, signing failures, merge conflicts) and a rigid set of conditionals cannot capture them. The resolver must fully understand the problem and act on it.

| | |
|---|---|
| **Trigger** | Pending `resolve` action |
| **Input** | Full trace state — all spans and their statuses, error output from failed steps |
| **Span** | `step: "resolve"`, meta contains the decision, reasoning, and any corrective actions taken |
| **Actions** | 0-N actions depending on the decision |
| **AI** | Yes — has access to tools (read files, run commands, inspect environment) |
| **Dedup** | One active resolve per trace |

**Quick exits**: Before invoking the AI, two trivial cases are checked:

1. Any running or pending workflow/commit steps → `wait` (nothing to decide yet).
2. Max retries exceeded → `fail` (hard limit, no AI judgment needed).

Everything else goes to the AI agent, which has the full trace context and error details.

**Decisions**:

| Decision | Behavior |
|---|---|
| `wait` | Retain pending action, re-evaluate on next cycle |
| `push` | All work completed with code changes — produce `push` action |
| `notify` | All work completed, no code to push (e.g., code review) — produce `notify` action |
| `iterate` | Retry a failed workflow with new instructions — produce new `workflow` action |
| `retry` | Re-enqueue a failed step after fixing the environment (e.g., install a missing tool via `pnpm`, then re-enqueue `commit`) |
| `fail` | Unrecoverable — terminate trace, mark all pending steps failed |

**Corrective action**: The resolver doesn't just classify failures — it can fix them. For example, if a commit step failed because a git pre-commit hook requires a tool that isn't installed, the resolver can:

1. Read the stderr output from the commit span.
2. Identify the missing tool (e.g., a linter required by a pre-hook).
3. Install it safely (e.g., `pnpm install`).
4. Re-enqueue the `commit` action via the `retry` decision.

This is why the resolver has tool access. The distinction between `iterate` and `retry`:

- **`iterate`**: The workflow's approach was wrong. Re-run it with new instructions.
- **`retry`**: The step itself failed due to an environmental issue. Fix the environment, re-enqueue the same step.

**Wait behavior**: The resolver retains the pending action in the queue when it decides `wait`. On the next processing cycle, it re-evaluates the trace state. This avoids depending on other steps to re-create resolve actions and ensures no trace is accidentally abandoned.

### Pusher

Pushes completed work to the remote repository and creates pull requests. The pusher is an agentic step — an AI agent with `Bash` tool access that can run `git push`, check for existing PRs, create new PRs, and handle errors adaptively. The agent prompt is platform-aware (mentions `gh` CLI for GitHub) but the TypeScript step code is platform-agnostic.

| | |
|---|---|
| **Trigger** | Pending `push` action |
| **Input** | Push action meta (branch names, trace context) + pre-gathered intelligence |
| **Span** | `step: "push"`, meta contains PR URL, branches pushed, push status |
| **Actions** | One `noop` action (will become `notify` when that step is implemented) |
| **AI** | Yes — has `Bash` tool access for git and CLI operations |
| **Max parallel** | 2 |
| **Dedup** | One active push per trace |
| **Dependencies** | Requires `ProjectManager` and owner/repo info |

**Context gathering** (before AI invocation): The step gathers intelligence to reduce unnecessary agent tool calls:

1. **Branch collection**: Iterates all workflow/commit steps in the trace, looks up `store.getTaskMapping()` for each, and collects branch names and task IDs.
2. **Existing PR check**: Queries `gh pr list --head <branch>` for the primary branch to determine if a PR already exists. Passes the result to the agent so it knows whether to create or skip.
3. **Root event metadata**: Walks the span trace back to the root event span and extracts event type, issue number, and PR number. This gives the agent context for PR title/description and issue linking.
4. **Main branch name**: Reads from `Git.getMainBranch()` to determine the base branch for the PR.

**Agent phases**:

1. **Reconnaissance**: `git log` and `git diff --stat` to understand what will be pushed.
2. **Branch consolidation** (multi-branch traces): Merge parallel branches into a target. Attempt conflict resolution; abort if unresolvable.
3. **Push**: `git push origin <branch>`. Handle upstream-not-set and non-fast-forward rejection with safe retries. Never force push.
4. **Pull request**: Create via `gh pr create` if no PR exists. Reference source issues ("Closes #N"). Skip gracefully if `gh` is unavailable.

**Rover footer in PR bodies**: The pusher's user message includes a "Required Footer" section with a `<details>` block containing the Rover footer marker, trace ID, and action ID. The agent is instructed to append this block verbatim to the PR body when creating a new PR. This enables the event step's self-comment filter to recognize PR bodies created by Rover and is exempt from the AI attribution ban (it is a system tracking footer, not AI branding).

**Safety constraints**: The agent may run `git push`, `git merge`, `git pull --rebase`, `git log`, `git diff`, `gh pr create/list/view`. It must not run `git push --force`, `git reset`, delete branches, modify git config, or change source code. The agent must not add AI-generated attribution to commit messages or PR bodies — only the Rover trailer is allowed when present in existing commits. The Rover footer (see [Rover Footer](#rover-footer)) is the sole exception: it must be included when creating PRs.

**Output**: The agent returns a structured JSON result with `status` (`pushed` | `failed`), `branches_pushed`, `pull_request` (url, created/existing), `error`, and `summary`. The step creates a span, enqueues a terminal action, and records the PR URL in span metadata.

### Notify

Delivers a response to the channel where the original event originated. This is the terminal step for most traces — it closes the communication loop between the autopilot and the external source.

| | |
|---|---|
| **Trigger** | Pending `notify` action |
| **Input** | Notify action meta + full span trace from root |
| **Span** | `step: "notify"`, meta contains delivery channel, message posted, response URL |
| **Actions** | None (trace ends) |

**Channel resolution**: The notify step walks the trace back to the root event span and reads its meta to determine **where** to respond. The event span records the source type and identifier (issue number, PR number, comment thread, etc.). This is the primary routing mechanism — all notification delivery depends on the source event metadata.

| Source Event | Delivery Channel |
|---|---|
| `IssuesEvent` | Comment on the issue |
| `PullRequestEvent` | Comment on the PR |
| `IssueCommentEvent` | Reply on the issue/PR thread |
| `PullRequestReviewEvent` | Post review or comment on the PR |
| `PullRequestReviewCommentEvent` | Reply on the review thread |
| `PushEvent` | Comment on the commit (if applicable) |

**Message composition**: The notify step reads the full trace to understand what happened and composes an appropriate response. The content depends on the trace outcome:

- **After push**: Reference the PR URL, summarize the changes.
- **After code review**: Post the review findings as a PR review or comment.
- **Clarification request**: Post the question from the coordinator or planner.
- **Direct acknowledgement**: Post a brief response (e.g., "This is already fixed in v2.1").
- **Failure report**: Summarize why the trace failed, adapted to the channel's visibility.

**Rover footer**: After composing the message (and truncating if needed), the notify step appends a Rover footer to every posted comment and PR review body. See [Rover Footer](#rover-footer) for details.

**Channel visibility**: The event span metadata must indicate whether the delivery channel is **public** or **private**. This controls what information the notify step is allowed to include in the message.

| Visibility | What to include | What to omit |
|---|---|---|
| **Public** | High-level outcome, PR links, user-facing summaries | System paths, internal errors, environment details, secrets, key fingerprints |
| **Private** | Everything from public, plus diagnostic details, error output, environment context | Secrets, credentials |

For example, if a commit step fails because of a GPG signing error:

- **Public channel** (GitHub issue): "I couldn't sign the commit using your GPG key ending in `XXXX`. Please check the signing configuration."
- **Private channel** (DM): "Commit signing failed. GPG key `ABC123DEF456` not found in the keyring. stderr: `gpg: skipped "user@example.com": No secret key`."

The visibility level is determined by the event source. GitHub issues and PRs on public repositories are public channels. Chat app DMs are private. The event step must record this in the event span meta so the notify step can apply the appropriate filter. When in doubt, default to public (disclose less).

**Extensibility**: The channel resolution is based on the source event type, not hardcoded to GitHub. When new event sources are added (chat apps, other platforms), the notify step routes to the appropriate channel based on the event metadata. The event span must always contain enough information for the notify step to resolve the delivery target and its visibility.

### Cleanup

Tears down the workspace associated with a completed Rover task. This is a terminal step — it removes the git worktree, branch, and Rover task resources, then ends the trace.

| | |
|---|---|
| **Trigger** | Pending `cleanup` action |
| **Input** | Cleanup action meta (references the task ID, branch name, worktree path from `taskMappings`) |
| **Span** | `step: "cleanup"`, `status: "completed"`, meta contains the resources removed |
| **Actions** | None (trace ends) |

**Behavior**:

1. Look up the task mapping from the action meta (task ID, branch name).
2. Remove the git worktree for the task branch.
3. Delete the local branch.
4. Clean up the Rover task resources.
5. Remove the entry from `taskMappings` in the state.
6. Record what was cleaned up in the span meta.

The cleanup step is deterministic — no AI, no tools beyond git and filesystem operations. If cleanup fails (e.g., worktree already removed, branch doesn't exist), it records the issue in span meta but still completes successfully. Cleanup is best-effort; a partial cleanup is acceptable and should not block the trace.

## Clarification Pattern

Clarification is not a dedicated step — it is a pattern that emerges from the combination of Notify (to post the question) and the event loop (to pick up the response).

### How it works

1. **A step needs more information.** The coordinator or planner determines it cannot proceed without clarification from the user or external context.
2. **It produces a `notify` action.** The action meta contains the question and the context that led to it. The trace records why clarification was needed.
3. **Notify posts the question.** The notify step resolves the source channel from the root event span and posts the question there (e.g., a comment on the issue asking "Should this be async or sync?").
4. **The trace ends.** There is no suspended or paused state. The trace completed its purpose: it asked the question.
5. **The response arrives as a new event.** When the user replies (e.g., a new `IssueCommentEvent`), it enters the pipeline as a fresh trace.
6. **The coordinator connects the dots.** The coordinator's context enrichment fetches the full conversation thread — including the bot's question and the user's answer. The AI sees the complete exchange and decides the next step (typically `plan`), now with sufficient information.

```plain
# Trace 1: Ask
event (issue opened, vague) → coordinate → plan (insufficient info) → notify ("Can you clarify X?")

# Trace 2: Resume (independent trace, triggered by user reply)
event (comment: "X should be async") → coordinate (sees Q&A in thread) → plan → workflow/swe → ...
```

### Why this works

- **No special machinery.** No suspended traces, no event matching, no paused state. The pipeline's existing primitives handle it.
- **Self-comments don't re-enter the pipeline.** The bot's own clarification comment contains the Rover footer marker. When the event poller picks it up, the self-comment filter (see [Event step](#event)) drops it before it reaches the coordinator. This prevents feedback loops where the bot's question triggers another trace.
- **Unrelated comments are filtered naturally.** If someone else comments something irrelevant, the coordinator evaluates it independently and decides `noop`. Only when the actual answer arrives does it proceed.
- **Trace continuity is external, not internal.** The two traces are operationally independent but logically connected through the conversation thread. The second trace has all the context it needs because the coordinator fetches the full conversation.
- **Multiple steps can trigger it.** Both the coordinator and the planner can produce `notify` actions with question semantics. The mechanism is identical.

## Rover Footer

Every message posted by the autopilot pipeline — issue comments, PR comments, PR review bodies, and PR bodies created by the pusher — includes a `<details>` block at the end:

```html
<details>
<summary>Generated by Rover</summary>

Trace: `<traceId>` | Action: `<actionId>`

</details>
```

This footer serves two purposes:

1. **Self-comment detection.** The event step checks incoming `IssueCommentEvent`, `PullRequestReviewEvent`, and `PullRequestReviewCommentEvent` payloads for the marker string `<summary>Generated by Rover</summary>`. If found, the event is dropped before entering the pipeline. This prevents feedback loops where the bot's own comments trigger new traces.

2. **Traceability.** The trace ID and action ID embedded in the footer link the GitHub comment back to the internal pipeline execution. This is useful for debugging — given a comment on GitHub, you can find the corresponding trace and span chain in the autopilot store.

The marker constant is defined in `constants.ts` and shared between the notify step (which appends it), the event step (which filters on it), and the pusher step (which includes it in PR body templates). The footer is appended after message truncation, so `TRUNCATION_LIMIT` is set ~150 characters below `GITHUB_COMMENT_LIMIT` to leave room.

The footer is **not** AI-generated attribution — it is a system tracking mechanism. It is explicitly exempt from the "no AI-generated attribution" rule in the pusher prompt.

## Memory

The autopilot maintains a per-project memory layer that gives AI-backed steps context about past activity. Without memory, each trace is stateless — the coordinator may re-plan issues already addressed, the planner may propose approaches that failed before, and the resolver may try the same fix repeatedly. Memory solves this by recording trace outcomes and making them searchable.

### Architecture

Memory is stored as daily markdown files indexed by [QMD](https://github.com/qmdnotes/qmd), a local markdown search engine. QMD provides hybrid search (BM25 keyword + semantic vector matching) so steps can find relevant past activity even when the wording differs from the current event.

**Two layers**:

| Layer | Storage | Purpose |
|---|---|---|
| **Daily activity log** | `memory/daily/YYYY-MM-DD.md` | One file per day. Appended to when each trace reaches a terminal step. Contains trace summaries, decisions, outcomes, files changed, PR URLs. This is the primary searchable corpus. ~365 files/year. |
| **Long-term patterns** *(future)* | `memory/long-term/YYYY-WNN.md` | Weekly AI-generated distillation of daily logs into recurring patterns and lessons. ~52 files/year. |

Per-trace files are **not** created — trace summaries are appended as sections within daily logs. This keeps the total file count well under 500 per year.

### Which Steps Use Memory

Memory is read by the three AI decision-making steps where historical context changes outcomes. Memory is written by the two terminal steps where traces complete.

| Step | Reads | Writes | Value |
|---|---|---|---|
| **Coordinator** | Yes (up to 5 results) | — | Avoids re-processing handled events, recognizes patterns |
| **Planner** | Yes (up to 5 results) | — | Knows what was changed before, what approaches worked/failed |
| **Resolver** | Yes (up to 3 results) | — | Finds past fixes for similar failures |
| **Noop** | — | Yes | Records trace completion (terminal step) |
| **Notify** | — | Yes | Records trace completion (terminal step) |
| **Committer / Pusher** | — | — | Execution steps — memory doesn't change their behavior |

### Daily Log Format

Each daily log file contains timestamped sections, one per completed trace:

```markdown
# Daily Activity Log — 2026-02-23

## [14:32] opened #42 "Add retry logic" → plan

- **Trace**: abc-123-def
- **Event**: IssuesEvent
- **Decision**: plan
- **Outcome**: 2 step(s) completed, committed on branch rover/task-15
- **Files changed**: src/lib/autopilot/steps/resolver.ts, src/lib/autopilot/steps/__tests__/resolver.test.ts
- **PR**: https://github.com/org/repo/pull/99

---

## [15:10] created #42 "LGTM, looks good" → noop

- **Trace**: def-456-ghi
- **Event**: IssueCommentEvent
- **Decision**: noop
- **Outcome**: 1 step(s) completed

---
```

This format is optimized for QMD indexing — each section has clear headings with event type, issue/PR numbers, and file paths as searchable text.

### QMD Integration

**Setup** (on autopilot start): `MemoryStore.ensureSetup()` creates the `memory/daily/` directory, registers it as a QMD collection (`qmd collection add rover-<projectId> <path>`), and sets collection context so QMD understands the content.

**Search** (before AI decisions): Steps call `MemoryStore.search(query, limit)`, which runs `qmd query "<query>" --collection rover-<projectId> --json --limit N`. All steps use hybrid search (keyword + semantic). Results are formatted into a `## Memory (Past Activity)` section and injected into the AI prompt. Content is capped at 4,000 characters to respect token budgets.

**Embedding** (after trace completion): After writing a daily log entry, `MemoryStore.triggerEmbed()` fires a non-blocking `qmd embed --collection rover-<projectId>`. QMD only re-embeds changed files, so this is fast. This keeps the vector index fresh for the next search.

**Graceful degradation**: If QMD is not installed, all memory operations return empty results silently. The autopilot functions normally without QMD — memory is an enhancement, not a requirement. QMD availability is checked once at startup and cached.

### How Memory Is Injected

Each reading step builds a search query tailored to its context:

- **Coordinator**: Queries by event type, action, issue/PR number, and title. Example: `"IssuesEvent opened #42 Add retry logic"`. Finds past decisions about the same or similar events.
- **Planner**: Queries by plan scope, event title, and coordinator scope. Example: `"implement retry logic for task pipeline"`. Finds prior changes and failed approaches in the same area.
- **Resolver**: Queries by trace summary and failure details (first line of error, task title). Example: `"failure: test timeout in resolver task-15"`. Finds past resolutions for similar failures.

The formatted results are injected into the AI prompt as a `## Memory (Past Activity)` section. Each AI prompt template (pilot, plan, resolve) includes instructions on how to interpret memory — as advisory context, not binding instruction.

### How Memory Is Written

Terminal steps (`noop`, `notify`) call `recordTraceCompletion()` after finalizing their span. This function:

1. Walks the trace's spans to extract event type, coordinator decision, outcome, files changed, PR URL, and branch name.
2. Formats the data as a markdown section.
3. Appends it to today's daily log file via `MemoryStore.appendDailyEntry()`.
4. Triggers a non-blocking QMD embed to update the vector index.

Both the "notification sent" and "notification skipped" paths in the notify step record memory, ensuring all traces are captured regardless of whether a GitHub comment was posted.

## Storage

### File Layout

```plain
~/.rover/data/projects/<projectId>/
├── spans/
│   └── <spanId>.json          # Individual span files
├── actions/
│   └── <actionId>.json        # Individual action files
└── autopilot/
    ├── cursor.json            # Processed event IDs (deduplication)
    ├── state.json             # Pending action queue + task mappings
    ├── traces.json            # Trace state for UI and restart recovery
    ├── log.jsonl              # Structured log (rotated at 5MB, 3 backups)
    └── memory/
        └── daily/
            └── YYYY-MM-DD.md  # Daily activity log (one per day)
```

Spans and actions are stored as individual JSON files at the **project level**, not inside `autopilot/`. This keeps them accessible to other Rover features and easy to inspect individually. The `autopilot/` subdirectory contains only operational state specific to the autopilot pipeline. Memory files live under `autopilot/memory/` and are indexed by QMD for search.

### Span Format

```jsonc
{
  "id": "UUID",
  "version": "1.0",
  "timestamp": "ISO 8601",       // When the span was created
  "step": "step name",           // event | coordinate | plan | workflow | commit | resolve | push | notify | noop | cleanup
  "parentId": "UUID | null",     // Parent span. Null for event spans (root)
  "originAction": "UUID | null", // Action that was processed to create this span. Null for the root event span
  "newActions": ["UUID"],         // Action IDs generated during this span's execution

  "status": "running",           // running | completed | failed | error
  "completed": "ISO 8601 | null", // When the step finished. Null while running
  "summary": "string | null",     // 1-2 line summary. Null until finished

  "meta": {}                      // Step-specific context and results
}
```

### Action Format

```jsonc
{
  "id": "UUID",
  "version": "1.0",
  "timestamp": "ISO 8601",       // When the action was created
  "action": "step name",         // coordinate | plan | workflow | commit | resolve | push | notify | noop | cleanup
  "spanId": "UUID",              // The span that created this action
  "reason": "string",            // Why this action was created
  "meta": {}                     // Data needed by the target step
}
```

### State Format

```jsonc
{
  "version": "1.0",
  "updatedAt": "ISO 8601",
  "pending": [
    {
      "traceId": "UUID",         // Root event span ID
      "actionId": "UUID",        // Reference to the action file
      "spanId": "UUID",          // Span that produced this action
      "action": "step name",     // Which step should process this
      "summary": "string",
      "createdAt": "ISO 8601"
    }
  ],
  "taskMappings": {
    "<actionId>": {
      "taskId": "string",
      "branchName": "string",
      "traceId": "UUID",
      "workflowSpanId": "UUID"
    }
  }
}
```

### Trace Format

The `traces.json` file caches trace state for the UI and restart recovery. Each trace contains an ordered list of steps:

```jsonc
{
  "<traceId>": {
    "traceId": "UUID",
    "summary": "string",
    "createdAt": "ISO 8601",
    "retryCount": 0,
    "steps": [
      {
        "originAction": "UUID | null", // Action that originated this step. Null for the event step
        "action": "step name",         // event | coordinate | plan | workflow | commit | resolve | push | notify | noop | cleanup
        "status": "completed",         // pending | running | completed | failed | error
        "timestamp": "ISO 8601",
        "reasoning": "string",         // Human-readable summary of what happened
        "spanId": "UUID",              // Span created by this step's execution (set after processing)
        "terminal": true,              // Present and true when this step ends the trace
        "newActions": ["UUID"]          // Action IDs generated by this step (set after processing)
      }
    ]
  }
}
```

The `originAction` field links each step to the action file that triggered it. For the event step (always `steps[0]`), `originAction` is `null` — the event has no origin action, it is the root trigger. For all other steps, `originAction` is the UUID of the action that was processed. This field is used for dedup (finding existing steps) and for task mapping lookups (e.g., `store.getTaskMapping(step.originAction)`).

### Cursor Format

```jsonc
{
  "version": "1.0",
  "updatedAt": "ISO 8601",
  "processedEventIds": []        // Capped at 200 entries, FIFO eviction
}
```

## Design Principles

1. **Steps communicate only through the store.** No direct function calls between steps. One step writes an action and enqueues a pending entry; another reads it. This keeps steps independent and testable.

2. **Spans record, actions direct.** A span captures what happened. An action describes what should happen next. Not every span produces an action — `noop`, `notify`, and `cleanup` are terminal steps that create a span but no further actions. A `fail` decision terminates the trace at the resolver. Every trace must end with an explicit terminal step so the outcome is unambiguous.

3. **Actions are immutable, spans are mutable during processing.** Once created, an action never changes. Spans are updated as the step executes (adding results, summary, completion timestamp), then become immutable.

4. **Traces are reconstructable from spans.** Walking the `parentId` chain from any span back to the root rebuilds the full decision history. The `traces.json` file is a performance cache for the UI, not the source of truth.

5. **The pending queue is the only driver.** Steps only execute work when they find pending actions of their type. No step implicitly triggers another. If a pending action is lost, that work doesn't happen.

6. **Fail forward.** Steps handle errors gracefully and record them in span metadata. A failed workflow still produces `commit` → `resolve` actions so the resolver can decide on retry or termination. The pipeline should never silently stall.

7. **Single store, shared state.** All steps share one `AutopilotStore` instance. The store serializes concurrent access to prevent race conditions on the state file.

8. **Hardcode simple forks, use AI for complex decisions.** If a step has 1-2 clear branches (e.g., commit: succeeded → stage and commit, failed → skip), hardcode it. If the decision space is broad or failures are unpredictable, use an AI agent with tool access. Steps that diagnose problems (resolver) or make routing decisions (coordinator) should never rely on rigid conditionals — real-world errors are too varied.

9. **Preserve error context for downstream steps.** When a step fails, it must capture the full error details (stderr, exit codes, command) in the span meta. Downstream steps — especially the resolver — depend on rich error information to diagnose issues and take corrective action. Swallowing errors silently breaks the pipeline's ability to self-heal.

10. **Respect channel visibility.** Notifications adapt to the audience. Public channels (GitHub issues, PR comments) get sanitized messages with no system internals, paths, or key material. Private channels can include diagnostic details. When in doubt, default to public.

11. **No AI-generated attribution.** AI agents must not inject their own branding into git artifacts — no "Generated by Claude Code", "Generated with Codex", "Co-Authored-By: Claude", or similar lines in commit messages, PR titles, or PR bodies. The only allowed attribution is the Rover trailer (`Co-Authored-By: Rover <noreply@endor.dev>`) when the project has attribution enabled. This is enforced via agent system prompts for steps that produce git artifacts.

12. **Never re-process your own output.** Every message the pipeline posts to GitHub carries a Rover footer marker. The event step filters out any incoming event whose body contains this marker. This is the primary defense against feedback loops — without it, a clarification comment posted by the bot would re-enter the pipeline as a new event, potentially triggering another clarification, ad infinitum. The marker is a simple string match, not dependent on usernames or API tokens, so it works regardless of which GitHub account the bot uses.

13. **Memory is context, not instruction.** AI-backed steps receive past activity summaries via the memory layer, but memory does not override current analysis. An agent should use memory to avoid redundant work, learn from past failures, and recognize patterns — but always evaluate the current event on its own merits. Memory degrades gracefully: if QMD is unavailable, steps function without it.
