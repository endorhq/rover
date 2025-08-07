import { writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { TaskDescription } from './description.js';

/**
 * SetupBuilder class - Consolidates Docker setup script generation
 * Replaces the existing docker-setup.sh and docker-setup-gemini.sh files
 */
export class SetupBuilder {
    private taskDescription: TaskDescription;
    private agent: string;
    private taskId: number;

    constructor(taskDescription: TaskDescription, agent: string = 'claude') {
        this.taskDescription = taskDescription;
        this.agent = agent;
        this.taskId = taskDescription.id;
    }

    private configureMcpServersFunction(): string {
        switch (this.agent) {
            case 'claude':
                return `# Function to configure MCP servers for claude
configure-mcp-servers() {
  # Ensure configuration file exists
  if [ ! -f /home/agent/.claude.json ]; then
    echo '{}' > /home/agent/.claude.json
    chown agent:agent /home/agent/.claude.json
  fi

  jq '.mcpServers //= {}' /home/agent/.claude.json | \
    jq '.mcpServers += { "package-manager": { "type": "http", "url": "http://127.0.0.1:8090/mcp" } }' \
    > /tmp/agent-settings.json
  mv /tmp/agent-settings.json /home/agent/.claude.json
}
`
            case 'gemini':
                return `# Function to configure MCP servers for gemini
configure-mcp-servers() {
  # Ensure configuration file exists
  if [ ! -f /home/agent/.gemini/settings.json ]; then
    mkdir -p /home/agent/.gemini
    echo '{}' > /home/agent/.gemini/settings.json
    chown -R agent:agent /home/agent/.gemini
  fi

  jq '.mcpServers //= {}' /home/agent/.gemini/settings.json | \
    jq '.mcpServers += { "package-manager": { "httpUrl": "http://127.0.0.1:8090/mcp", "oauth": { "enabled": false } } }' \
    > /tmp/agent-settings.json
  mv /tmp/agent-settings.json /home/agent/.gemini/settings.json
}
`
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

# Download and install the MCP server
wget -O /usr/local/bin/package-manager-mcp-server https://images.endor.dev/rover/assets/package-manager-mcp-x86_64-unknown-linux-musl
chmod +x /usr/local/bin/package-manager-mcp-server

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
`
    }

    generateSetupMcpScript(): string {
        // Ensure task directory exists
        const taskDir = join(process.cwd(), '.rover', 'tasks', this.taskId.toString());
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
        > /output/status.json
}`;
    }

    /**
     * Generate permission recovery function
     */
    private generatePermissionRecoveryFunction(): string {
        return `# Function to recover permissions before exit
recover_permissions() {
    echo "🔧 Recovering permissions..."

    # This works in a rootless docker installation
    chown -R root:root /workspace || true
    chown -R root:root /output || true

    echo "✅ Permissions recovered"
}

# Function to handle script exit with permission recovery
safe_exit() {
    local exit_code="$1"
    local error_message="$2"

    mv /workspace/context.md /output
    mv /workspace/plan.md /output
    mv /workspace/changes.md /output
    mv /workspace/summary.md /output
    mv /workspace/review.md /output

    recover_permissions

    if [ -n "$error_message" ]; then
        write_status "failed" "Script failed" 100 "$error_message"
        echo "❌ $error_message"
    fi

    exit $exit_code
}`;
    }

    /**
     * Generate prompt execution functions
     */
    private generatePromptExecutionFunctions(): string {
        return `# Function to execute a prompt phase
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

    # Switch to agent user and execute the prompt
    su agent << EOF
# Change to workspace directory
cd /workspace

# Execute the AI agent with the prompt
if cat /prompts/$phase_name.txt | ${this.getAgentCommand()}; then
    exit 0
else
    exit 1
fi
EOF

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
     * Generate user creation and setup functions
     */
    private generateUserSetupFunctions(): string {
        return `# Function to create agent user
create_agent_user() {
    echo "👤 Creating agent user..."
    write_status "installing" "Creating agent user" 10

    adduser -D -s /bin/sh agent
    if [ $? -ne 0 ]; then
        echo "❌ Failed to create user 'agent'"
        safe_exit 1 "adduser command failed"
    fi

    echo "✅ User 'agent' created successfully"
    write_status "installing" "Agent user created" 10
}

# Function to setup agent user environment
setup_agent_environment() {
    echo "🏠 Setting up agent user environment..."
    write_status "installing" "Setting up agent user environment" 10

    # Create agent home directory
    mkdir -p /home/agent

    # Set ownership of key directories
    chown -R agent:agent /home/agent
    chown -R agent:agent /workspace
    chown -R agent:agent /output

    echo "✅ Agent user environment configured"
    write_status "installing" "Agent environment setup" 15
}`;
    }

    /**
     * Get the agent command for the specific AI agent
     */
    private getAgentCommand(): string {
        switch (this.agent) {
            case 'claude':
                return 'claude --dangerously-skip-permissions -p --debug';
            case 'gemini':
                return 'gemini --yolo -p --debug';
            default:
                return 'claude --dangerously-skip-permissions -p --debug';
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
            return `npm install -g @anthropic-ai/claude-code

mkdir -p /home/agent/.claude

# Process and copy Claude credentials
if [ -f "/.claude.json" ]; then
    echo "📝 Processing Claude configuration..."
    write_status "installing" "Claude configuration" 20
    # Copy .claude.json but clear the projects object
    jq '.projects = {}' /.claude.json > /home/agent/.claude.json
    echo "✅ Claude configuration processed and copied to claude user"
else
    echo "⚠️  No Claude config found at /.claude.json, continuing..."
fi

if [ -f "/.credentials.json" ]; then
    echo "📝 Processing Claude credentials..."
    write_status "installing" "Claude credentials" 20
    cp /.credentials.json /home/agent/.claude/
    echo "✅ Claude credentials processed and copied to claude user"
else
    echo "⚠️  No Claude credentials found, continuing..."
fi

# Update permissions
chown -R agent:agent /home/agent/.claude
`;
        } else if (this.agent == 'gemini') {
            return `npm install -g @google/gemini-cli

# Configure the CLI
# Process and copy Gemini credentials
if [ -d "/.gemini" ]; then
    echo "📝 Processing Gemini credentials..."
    write_status "installing" "Process Gemini credentials" 20

    mkdir -p /home/gemini/.gemini
    cp /.gemini/oauth_creds.json /home/gemini/.gemini/
    cp /.gemini/settings.json /home/gemini/.gemini/
    cp /.gemini/user_id /home/gemini/.gemini/
    chown -R gemini:gemini /home/gemini/.gemini
    echo "✅ Gemini credentials processed and copied to gemini user"
else
    echo "❌  No Gemini configuration found at /.gemini"
    safe_exit 1 "Missing gemini credentials"
fi
`;
        } else {
            // Unknown agent
            return ''
        }
    }

    /**
     * Generate common setup functions
     */
    private generateCommonFunctions(): string {
        return `${this.generateWriteStatusFunction()}

${this.generatePermissionRecoveryFunction()}

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

# Function to install jq if not available
ensure_jq() {
    if ! check_command jq; then
        echo "📦 Installing jq for JSON parsing..."
        write_status "initializing" "Installing jq for JSON parsing" 5
        apk add --no-cache jq
        if [ $? -ne 0 ]; then
            echo "❌ Failed to install jq"
            safe_exit 1 "apk add jq failed"
        fi
    fi
}

# Function to validate task description file
validate_task_file() {
    if [ ! -f "/task/description.json" ]; then
        echo "❌ Task description file not found at /task/description.json"
        safe_exit 1 "Task description file not found at /task/description.json"
    fi
}

${this.generateUserSetupFunctions()}`;
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

${this.generateCommonFunctions()}

# Set start time
START_TIME=$(date -u +%Y-%m-%dT%H:%M:%S%z)

# Install jq for JSON parsing
ensure_jq

# Validate task description file
validate_task_file

# Initialize status
write_status "initializing" "Starting task" 5

# Read task data from mounted JSON file
TASK_ID=$(jq -r '.id' /task/description.json)
TASK_TITLE=$(jq -r '.title' /task/description.json)
TASK_DESCRIPTION=$(jq -r '.description' /task/description.json)

echo "======================================="
echo "🚀 Rover Task Execution Setup (${this.agent})"
echo "======================================="
echo "Task ID: $TASK_ID"
echo "Task Title: $TASK_TITLE"
echo "======================================="

write_status "initializing" "Load metadata" 5

# Create agent user
create_agent_user

# Setup agent user environment
setup_agent_environment

# Agent-specific CLI installation and credential setup
echo "📦 Installing ${this.agent} CLI and setting up credentials..."
write_status "installing" "Installing ${this.agent} CLI" 15

${this.generateInstallAgent()}

write_status "installing" "Installing ${this.agent} CLI" 20

# Export variables for agent execution
export TASK_ID TASK_TITLE TASK_DESCRIPTION

# Run setup MCP script
/setup-mcp.sh

${this.generateTaskExecutionWorkflow()}

# Move all outputs to the right location
mv /workspace/context.md /output
mv /workspace/plan.md /output
mv /workspace/changes.md /output
mv /workspace/summary.md /output
mv /workspace/review.md /output

# Recover permissions after task completion
recover_permissions

write_status "completed" "Task completed" 100
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
        const taskDir = join(process.cwd(), '.rover', 'tasks', this.taskId.toString());
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
        return join(process.cwd(), '.rover', 'tasks', this.taskId.toString(), script);
    }

    /**
     * Static factory method to create and generate setup script
     */
    static generate(taskDescription: TaskDescription, agent: string = 'claude'): string {
        const builder = new SetupBuilder(taskDescription, agent);
        return builder.generateSetupScript();
    }
}
