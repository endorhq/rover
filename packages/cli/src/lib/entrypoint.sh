#!/bin/sh

# Template file for the entrypoint to run the agents and the workflow.
# The purpose of this file is to install all required elements and 
# prepare the agent to run.
#
# @see https://github.com/sindresorhus/pupa

# Define the agent user home
if [[ -z "$\\{HOME\\}" ]]; then
  export HOME=/home/$(id -u)
fi

# Some tools might be installed under /root/local/.bin conditionally
# depending on the chosen agent and requirements, make this directory
# available in the $PATH
export PATH=/root/local/.bin:$PATH

# Initially, use sudo to ensure even users without permissions can
# create this. Once we finish the setup, we will reduce the sudo
# permissions to the minimal.
sudo mkdir -p $HOME
sudo mkdir -p $HOME/.config
sudo chown -R $(id -u):$(id -g) $HOME
sudo chown -R $(id -u):$(id -g) /workspace
sudo chown -R $(id -u):$(id -g) /output

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
    echo -e "\n======================================="
    echo "🔧 Recovering permissions..."
    echo "======================================="

    {recoverPermissions}
    echo "✅ Permissions recovered"
}

# Function to handle script exit
safe_exit() {
    local exit_code="$1"

    shred_secrets
    recover_permissions

    exit $exit_code
}

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
      echo "✅ Installed mcp-remote"
    else
      echo "❌ Failed to install mcp-remote"
      safe_exit 1
    fi
  fi
}

# Function to validate task description file
validate_task_file() {
    if [ ! -f "/task/description.json" ]; then
        echo "❌ Task description file not found at /task/description.json"
        safe_exit 1
    fi
}

# Set start time
START_TIME=$(date -u +%Y-%m-%dT%H:%M:%S%z)

# Validate task description file
validate_task_file

# Setup the agent
AGENT={agent}

echo -e "\n======================================="
echo "📦 Starting the package manager MCP server"
echo "======================================="
export PACKAGE_MANAGER_MCP_PORT=8090
package-manager-mcp-server $PACKAGE_MANAGER_MCP_PORT &

while ! nc -w 0 127.0.0.1 "$PACKAGE_MANAGER_MCP_PORT" < /dev/null; do
  echo "Waiting for package manager MCP to be ready at $PACKAGE_MANAGER_MCP_PORT..."
  sleep 1
done

echo "✅ Package manager MCP is ready"

# Read task data from mounted JSON file
TASK_ID=$(jq -r '.id' /task/description.json)
TASK_ITERATION=$(jq -r '.iteration' /task/description.json)
TASK_TITLE=$(jq -r '.title' /task/description.json)
TASK_DESCRIPTION=$(jq -r '.description' /task/description.json)

echo -e "\n======================================="
echo "🚀 Rover Task Execution Setup"
echo "======================================="
echo "Task Title: $TASK_TITLE"
echo "Task ID: $TASK_ID"
echo "Task Iteration: $TASK_ITERATION"
echo "======================================="

# Agent-specific CLI installation and credential setup
echo -e "\n📦 Installing Agent CLI and setting up credentials"
sudo rover-agent install $AGENT --user-dir $HOME
# Set the right permissions after installing and moving credentials
sudo chown -R $(id -u):$(id -g) $HOME

if [ $? -eq 0 ]; then
    echo "✅ $AGENT was installed successfully."
else
    echo "❌ $AGENT could not be installed"
    safe_exit 1
fi

echo -e "\n📦 Done installing agent"

echo -e "\n📦 Installing MCP servers"
# For now, we only configure the package manager!
rover-agent config mcp $AGENT package-manager --transport "http" http://127.0.0.1:8090/mcp

echo -e "\n📦 Done installing MCP servers"

# Export variables for agent execution
export TASK_ID TASK_TITLE TASK_DESCRIPTION

# Remove ourselves from sudoers
echo -e "\n👤 Removing privileges after completing the setup!"
sudo rm /etc/sudoers.d/1-agent-setup

# Execute the complete task workflow
echo -e "\n======================================="
echo "🚀 Running Workflow"
echo "======================================="

# Capture the CMD exit and ensure we recover the result!
trap 'safe_exit $?' EXIT

"$@"
