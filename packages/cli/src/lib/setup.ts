import { writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { TaskDescription } from './description.js';
import { findProjectRoot, launchSync, VERBOSE } from 'rover-common';

/**
 * SetupBuilder class - Consolidates Docker setup script generation
 * Replaces the existing docker-setup.sh and docker-setup-gemini.sh files
 */
export class SetupBuilder {
  private taskDescription: TaskDescription;
  private agent: string;
  private taskId: number;
  private isDockerRootless: boolean;

  constructor(taskDescription: TaskDescription, agent: string = 'claude') {
    this.taskDescription = taskDescription;
    this.agent = agent;
    this.taskId = taskDescription.id;

    let isDockerRootless = false;

    const dockerInfo = launchSync('docker', ['info', '-f', 'json']).stdout;
    if (dockerInfo) {
      const info = JSON.parse(dockerInfo.toString());
      isDockerRootless = (info?.SecurityOptions || []).some((value: string) =>
        value.includes('rootless')
      );
    }

    this.isDockerRootless = isDockerRootless;
  }

  private configureMcpServersFunction(): string {
    switch (this.agent) {
      case 'claude':
        return `# Function to configure MCP servers for claude
configure-mcp-servers() {
  # Ensure configuration file exists
  if [ ! -f $HOME/.claude.json ]; then
    echo '{}' | tee $HOME/.claude.json
  fi

  jq '.mcpServers //= {}' $HOME/.claude.json | \
    jq '.mcpServers += { "package-manager": { "type": "http", "url": "http://127.0.0.1:8090/mcp" } }' \
      | tee /tmp/agent-settings.json
  mv /tmp/agent-settings.json $HOME/.claude.json
}
`;
      case 'codex':
        return `# Function to configure MCP servers for codex
configure-mcp-servers() {
  # Ensure configuration file exists
  if [ ! -f $HOME/.codex/config.toml ]; then
    echo '' | tee $HOME/.codex/config.toml
  fi

  cat <<'EOF' | tee -a $HOME/.codex/config.toml
[mcp_servers.package-manager]
command = "mcp-remote"
args = ["http://127.0.0.1:8090/mcp"]
EOF
}
`;
      case 'gemini':
        return `# Function to configure MCP servers for gemini
configure-mcp-servers() {
  # Ensure configuration file exists
  if [ ! -f $HOME/.gemini/settings.json ]; then
    mkdir -p $HOME/.gemini
    echo '{}' | tee $HOME/.gemini/settings.json
  fi

  jq '.mcpServers //= {}' $HOME/.gemini/settings.json | \
    jq '.mcpServers += { "package-manager": { "httpUrl": "http://127.0.0.1:8090/mcp", "oauth": { "enabled": false } } }' \
    | tee /tmp/agent-settings.json
  mv /tmp/agent-settings.json $HOME/.gemini/settings.json
}
`;
      case 'qwen':
        return `# Function to configure MCP servers for qwen
configure-mcp-servers() {
  # Ensure configuration file exists
  if [ ! -f $HOME/.qwen/settings.json ]; then
    mkdir -p $HOME/.qwen
    echo '{}' | tee $HOME/.qwen/settings.json
  fi

  jq '.mcpServers //= {}' $HOME/.qwen/settings.json | \
    jq '.mcpServers += { "package-manager": { "httpUrl": "http://127.0.0.1:8090/mcp", "oauth": { "enabled": false } } }' \
    | tee /tmp/agent-settings.json
  mv /tmp/agent-settings.json $HOME/.qwen/settings.json
}
`;
      default:
        return `configure-mcp-servers() {
  echo "Unknown agent: '${this.agent}'"
  exit 1;
}`;
    }
  }

  private buildSetupMcpScript(): string {
    return `#!/bin/sh

# Docker container setup script for Rover MCP servers integration
# Generated for agent: ${this.agent}
# Task ID: ${this.taskId}
# Task description is mounted at /task/description.json

echo "======================================="
echo "📦 Starting the package manager MCP server"
echo "======================================="
export PACKAGE_MANAGER_MCP_PORT=8090
package-manager-mcp-server $PACKAGE_MANAGER_MCP_PORT &

while ! nc -w 0 127.0.0.1 "$PACKAGE_MANAGER_MCP_PORT" < /dev/null; do
  echo "Waiting for package manager MCP to be ready at $PACKAGE_MANAGER_MCP_PORT..."
  sleep 1
done

echo "Package manager MCP is ready"

${this.configureMcpServersFunction()}

configure-mcp-servers
`;
  }

  generateSetupMcpScript(): string {
    // Ensure task directory exists
    const taskDir = join(
      findProjectRoot(),
      '.rover',
      'tasks',
      this.taskId.toString()
    );
    mkdirSync(taskDir, { recursive: true });

    // Generate script content
    const scriptContent = this.buildSetupMcpScript();

    // Write script to file
    const scriptPath = join(taskDir, 'setup-mcp.sh');
    writeFileSync(scriptPath, scriptContent, 'utf8');

    // Make script executable
    chmodSync(scriptPath, 0o755);

    return scriptPath;
  }

  /**
   * Generate write_status function for the shell script
   */
  private generateWriteStatusFunction(): string {
    return `# Function to write status updates using jq
write_status() {
    local status="$1"
    local step="$2"
    local progress="$3"
    local error="$4"

    echo "[STATUS]: $status $step ($progress%) - $(date -u +%Y-%m-%dT%H:%M:%S%z)"

    # Create base JSON object using jq
    jq -n \\
        --arg taskId "$TASK_ID" \\
        --arg status "$status" \\
        --arg step "$step" \\
        --argjson progress "$progress" \\
        --arg startTime "$START_TIME" \\
        --arg updatedAt "$(date -u +%Y-%m-%dT%H:%M:%S%z)" \\
        --arg error "$error" \\
        --arg completedAt "$(date -u +%Y-%m-%dT%H:%M:%S%z)" \\
        '{
            taskId: $taskId,
            status: $status,
            currentStep: $step,
            progress: $progress,
            startedAt: $startTime,
            updatedAt: $updatedAt
        }
        | if ($error != "") then . + {error: $error} else . end
        | if ($status == "completed" or $status == "failed") then . + {completedAt: $completedAt} else . end' \\
      | tee /output/status.json
}`;
  }

  /**
   * Generate cleanup functions
   */
  private generateCleanupFunctions(): string {
    let recoverPermissions = '';
    if (this.isDockerRootless) {
      recoverPermissions = `
sudo chown -R root:root /workspace || true
sudo chown -R root:root /output || true
`;
    }

    return `
# Function to shred secrets before exit
shred_secrets() {
    # Remove credentials: on certain environments such as Darwin,
    # credentials are stored in the Mac OS X Keychain and mounted from a
    # temporary file for this execution. Shred its content and unlink if
    # the file is mounted as RW. If it's not mounted as RW, this command
    # will fail, but the failure is ignored.

    shred -u /.credentials.json &> /dev/null
}

# Function to recover permissions before exit
recover_permissions() {
    echo "🔧 Recovering permissions..."

    ${recoverPermissions}

    echo "✅ Permissions recovered"
}

# Function to handle script exit
safe_exit() {
    local exit_code="$1"
    local error_message="$2"

    sudo mv /workspace/context.md /output
    sudo mv /workspace/plan.md /output
    sudo mv /workspace/changes.md /output
    sudo mv /workspace/summary.md /output
    sudo mv /workspace/review.md /output

    if [ -n "$error_message" ]; then
        write_status "failed" "Script failed" 100 "$error_message"
        echo "❌ $error_message"
    fi

    shred_secrets
    recover_permissions

    exit $exit_code
}`;
  }

  /**
   * Generate prompt execution functions
   */
  private generatePromptExecutionFunctions(): string {
    return `# Function to prepare source permissions on rootless mode
execute_prompt_phase() {
    local phase_name="$1"
    local progress="$2"
    local next_progress="$3"

    echo "======================================="
    echo "🔄 Starting $phase_name phase"
    echo "======================================="
    write_status "running" "$phase_name phase" $progress

    # Check if prompt file exists
    if [ ! -f "/prompts/$phase_name.txt" ]; then
        echo "❌ Prompt file not found: /prompts/$phase_name.txt"
        safe_exit 1 "Prompt file /prompts/$phase_name.txt not found"
    fi

    # Execute the AI agent with the prompt
    cd /workspace
    cat /prompts/$phase_name.txt | ${this.getAgentCommand()}

    # Check execution result
    if [ $? -eq 0 ]; then
        echo "✅ $phase_name phase completed successfully"
        write_status "running" "$phase_name completed" $next_progress
    else
        echo "❌ $phase_name phase failed"
        safe_exit 1 "$phase_name phase execution failed"
    fi
}

# Function to check if generated file exists
check_generated_file() {
    local file_path="$1"
    local phase_name="$2"

    if [ ! -f "$file_path" ]; then
        echo "❌ Expected file not generated: $file_path"
        safe_exit 1 "$phase_name phase did not generate expected file: $file_path"
    fi

    echo "✅ Generated file found: $file_path"
}`;
  }

  /**
   * Get the agent command for the specific AI agent
   */
  private getAgentCommand(): string {
    switch (this.agent) {
      case 'claude':
        return `claude --dangerously-skip-permissions -p${VERBOSE ? ' --debug' : ''}`;
      case 'codex':
        return `${VERBOSE ? 'RUST_LOG=info ' : ''}codex exec --model gpt-5-codex --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check`;
      case 'gemini':
        return `gemini --yolo -p${VERBOSE ? ' --debug' : ''}`;
      case 'qwen':
        return `qwen --yolo -p${VERBOSE ? ' --debug' : ''}`;
      default:
        return `claude --dangerously-skip-permissions -p${VERBOSE ? ' --debug' : ''}`;
    }
  }

  /**
   * Generate the task execution workflow
   */
  private generateTaskExecutionWorkflow(): string {
    return `# Execute the complete task workflow
echo "======================================="
echo "🚀 Starting Task Execution Workflow"
echo "======================================="

# Phase 1: Context Analysis (20% -> 30%)
execute_prompt_phase "context" 20 30
check_generated_file "context.md" "context"

# Phase 2: Planning (30% -> 40%)
execute_prompt_phase "plan" 30 40
check_generated_file "plan.md" "plan"

# Phase 3: Implementation (40% -> 60%)
execute_prompt_phase "implement" 40 60
check_generated_file "changes.md" "implement"

# Phase 4: Review (60% -> 70%)
execute_prompt_phase "review" 60 70
# Note: review.md is only created if issues are found

# Phase 5: Apply Review Fixes (if review.md exists) (70% -> 80%)
if [ -f "review.md" ]; then
    echo "📋 Review issues found, applying fixes..."
    execute_prompt_phase "apply_review" 70 80
else
    echo "✅ No review issues found, skipping apply_review phase"
    write_status "running" "Review fixes skipped - no issues found" 80
fi

# Phase 6: Summary (80% -> 90%)
execute_prompt_phase "summary" 80 90
check_generated_file "summary.md" "summary"

echo "======================================="
echo "✅ Task execution workflow completed"
echo "======================================="`;
  }

  /**
   * Generate the task execution workflow
   */
  private generateInstallAgent(): string {
    if (this.agent == 'claude') {
      return `sudo npm install -g @anthropic-ai/claude-code

mkdir -p $HOME/.claude

# Process and copy Claude credentials
if [ -f "/.claude.json" ]; then
    echo "📝 Processing Claude configuration..."
    write_status "installing" "Claude configuration" 20
    # Copy .claude.json but clear the projects object
    jq '.projects = {} | .bypassPermissionsModeAccepted = true' /.claude.json | sudo tee $HOME/.claude.json
    echo "✅ Claude configuration processed and copied to claude user"
else
    echo "⚠️  No Claude config found at /.claude.json, continuing..."
fi

if [ -f "/.credentials.json" ]; then
    echo "📝 Processing Claude credentials..."
    write_status "installing" "Claude credentials" 20
    sudo cp /.credentials.json $HOME/.claude/
    sudo chown $(id -u):$(id -g) $HOME/.claude/.credentials.json
    echo "✅ Claude credentials processed and copied to claude user"
else
    echo "⚠️  No Claude credentials found, continuing..."
fi
`;
    } else if (this.agent == 'codex') {
      return `sudo npm install -g @openai/codex

# Codex does not support Streamable HTTP server yet, only stdio; use
# mcp-remote for proxying.
ensure_mcp_remote

# Configure the CLI
# Process and copy Gemini credentials
if [ -d "/.codex" ]; then
    echo "📝 Processing Codex credentials..."
    write_status "installing" "Process Codex credentials" 20

    mkdir -p $HOME/.codex
    sudo cp /.codex/auth.json $HOME/.codex/
    sudo cp /.codex/config.json $HOME/.codex/
    sudo chown -R $(id -u):$(id -g) $HOME/.codex

    echo "✅ Codex credentials processed and copied to agent user"
else
    echo "❌  No Codex configuration found at /.codex"
    safe_exit 1 "Missing codex credentials"
fi
`;
    } else if (this.agent == 'gemini') {
      return `sudo npm install -g @google/gemini-cli

# Configure the CLI
# Process and copy Gemini credentials
if [ -d "/.gemini" ]; then
    echo "📝 Processing Gemini credentials..."
    write_status "installing" "Process Gemini credentials" 20

    mkdir -p $HOME/.gemini
    sudo cp /.gemini/oauth_creds.json $HOME/.gemini/
    sudo cp /.gemini/settings.json $HOME/.gemini/
    sudo cp /.gemini/user_id $HOME/.gemini/
    sudo chown -R $(id -u):$(id -g) $HOME/.gemini

    echo "✅ Gemini credentials processed and copied to agent user"
else
    echo "❌  No Gemini configuration found at /.gemini"
    safe_exit 1 "Missing gemini credentials"
fi
`;
    } else if (this.agent == 'qwen') {
      return `sudo npm install -g @qwen-code/qwen-code@latest

# Configure the CLI
# Process and copy Qwen credentials
if [ -d "/.qwen" ]; then
    echo "📝 Processing Qwen credentials..."
    write_status "installing" "Process Qwen credentials" 20

    mkdir -p $HOME/.qwen
    sudo cp /.qwen/installation_id $HOME/.qwen/
    sudo cp /.qwen/oauth_creds.json $HOME/.qwen/
    sudo cp /.qwen/settings.json $HOME/.qwen/
    sudo chown -R $(id -u):$(id -g) $HOME/.qwen

    echo "✅ Qwen credentials processed and copied to agent user"
else
    echo "❌  No Qwen configuration found at /.qwen"
    safe_exit 1 "Missing qwen credentials"
fi
`;
    } else {
      // Unknown agent
      return '';
    }
  }

  /**
   * Generate common setup functions
   */
  private generateCommonFunctions(): string {
    return `${this.generateWriteStatusFunction()}

${this.generateCleanupFunctions()}

${this.generatePromptExecutionFunctions()}

# Function to check command availability
check_command() {
    local cmd="$1"
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "❌ Command '$cmd' not found"
        return 1
    fi
    return 0
}

# Function to install mcp-remote if not available
ensure_mcp_remote() {
  if ! check_command mcp-remote; then
    COMMAND="sudo npm install -g mcp-remote@0.1.29"
    if $COMMAND; then
      write_status "initializing" "Installed mcp-remote for MCP proxying" 5
    else
      echo "❌ Failed to install mcp-remote"
      safe_exit 1 "$COMMAND failed"
    fi
  fi
}

# Function to validate task description file
validate_task_file() {
    if [ ! -f "/task/description.json" ]; then
        echo "❌ Task description file not found at /task/description.json"
        safe_exit 1 "Task description file not found at /task/description.json"
    fi
}`;
  }

  /**
   * Build the complete setup script content
   */
  buildScript(): string {
    return `#!/bin/sh

# Docker container setup script for Rover task execution
# Generated for agent: ${this.agent}
# Task ID: ${this.taskId}
# Task description is mounted at /task/description.json

if [[ -z "\${HOME}" ]]; then
  export HOME=/home/agent
fi

# Some tools might be installed under /root/local/.bin conditionally
# depending on the chosen agent and requirements, make this directory
# available in the $PATH
export PATH=/root/local/.bin:$PATH

sudo mkdir -p $HOME
sudo chown $(id -u):$(id -g) $HOME

${this.isDockerRootless ? 'sudo chown -R $(id -u):$(id -g) /workspace' : ''}
${this.isDockerRootless ? 'sudo chown -R $(id -u):$(id -g) /output' : ''}

${this.generateCommonFunctions()}

# Set start time
START_TIME=$(date -u +%Y-%m-%dT%H:%M:%S%z)

# Validate task description file
validate_task_file

# Initialize status
write_status "initializing" "Starting task" 5

# Read task data from mounted JSON file
TASK_ID=$(jq -r '.id' /task/description.json)
TASK_ITERATION=$(jq -r '.iteration' /task/description.json)
TASK_TITLE=$(jq -r '.title' /task/description.json)
TASK_DESCRIPTION=$(jq -r '.description' /task/description.json)

echo "======================================="
echo "🚀 Rover Task Execution Setup (${this.agent})"
echo "======================================="
echo "Task Title: $TASK_TITLE"
echo "Task ID: $TASK_ID"
echo "Task Iteration: $TASK_ITERATION"
echo "======================================="

write_status "initializing" "Load metadata" 5

# Agent-specific CLI installation and credential setup
echo "📦 Installing ${this.agent} CLI and setting up credentials..."
write_status "installing" "Installing ${this.agent} CLI" 15

${this.generateInstallAgent()}

write_status "installing" "Installing ${this.agent} CLI" 20

# Export variables for agent execution
export TASK_ID TASK_TITLE TASK_DESCRIPTION

# Run setup MCP script
/setup-mcp.sh

# Remove ourselves from sudoers
sudo rm /etc/sudoers.d/1-agent-setup

${this.generateTaskExecutionWorkflow()}

# Move all outputs to the right location
sudo mv /workspace/context.md /output
sudo mv /workspace/plan.md /output
sudo mv /workspace/changes.md /output
sudo mv /workspace/summary.md /output
sudo mv /workspace/review.md /output

# Mark as done!
write_status "completed" "Task completed" 100

# Shred secrets after task completion
shred_secrets
recover_permissions

echo "======================================="
echo "✅ Task execution completed successfully"
echo "======================================="
exit 0
`;
  }

  /**
   * Generate and save the setup script to the appropriate task directory
   */
  generateSetupScript(): string {
    // Ensure task directory exists
    const taskDir = join(
      findProjectRoot(),
      '.rover',
      'tasks',
      this.taskId.toString()
    );
    mkdirSync(taskDir, { recursive: true });

    // Generate script content
    const scriptContent = this.buildScript();

    // Write script to file
    const scriptPath = join(taskDir, 'setup.sh');
    writeFileSync(scriptPath, scriptContent, 'utf8');

    // Make script executable
    chmodSync(scriptPath, 0o755);

    return scriptPath;
  }

  /**
   * Get the path where the setup script will be saved
   */
  getScriptPath(script: string): string {
    return join(
      findProjectRoot(),
      '.rover',
      'tasks',
      this.taskId.toString(),
      script
    );
  }

  /**
   * Static factory method to create and generate setup script
   */
  static generate(
    taskDescription: TaskDescription,
    agent: string = 'claude'
  ): string {
    const builder = new SetupBuilder(taskDescription, agent);
    return builder.generateSetupScript();
  }
}
