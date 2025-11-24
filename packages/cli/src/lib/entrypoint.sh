#!/bin/bash

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
sudo mkdir -p $HOME/.local/bin
echo 'export PATH="$HOME/.local/bin:$PATH"' >> $HOME/.profile
sudo chown -R $(id -u):$(id -g) $HOME
sudo chown -R $(id -u):$(id -g) /workspace
sudo chown -R $(id -u):$(id -g) /output

source $HOME/.profile

# Fail if node is not available
check_command "node" || safe_exit 1

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

if [ "$AGENT" = "cursor" ]; then
  echo -e "\n======================================="
  echo "📦 Running nix daemon"
  echo "======================================="
  sudo nix-daemon &> /dev/null &
fi

echo -e "\n======================================="
echo "📦 Starting the package manager MCP server"
echo "======================================="
export PACKAGE_MANAGER_MCP_PORT=8090
RUST_LOG=info package-manager-mcp-server $PACKAGE_MANAGER_MCP_PORT &

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

{installAllPackages}

# Agent-specific CLI installation and credential setup
echo -e "\n📦 Installing Agent CLI and setting up credentials"
# Pass the environment variables to ensure it loads the right credentials
sudo -E rover-agent install $AGENT --user-dir $HOME
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
# Configure built-in MCPs
rover-agent config mcp $AGENT package-manager --transport "http" http://127.0.0.1:8090/mcp

# Configure MCPs from rover.json if mcps array exists
#
# TODO(ereslibre): replace with `rover-agent config mcps` that by
# default will read /workspace/rover.json.
configure_all_mcps() {
  # Fail as soon as the configuration of one of the provided MCP's
  # fail. This is because results might not be close to what the user
  # expects without the required MCP's.

  set -e
  trap 'warn_mcp_configuration_failed; return 1' ERR

  {configureAllMCPCommands}

  trap - ERR
  set +e
}

warn_mcp_configuration_failed() {
  echo "❌ Failed to configure MCP servers"
  safe_exit 1
}

configure_all_mcps

echo -e "\n📦 Done installing MCP servers"

# Export variables for agent execution
export TASK_ID TASK_TITLE TASK_DESCRIPTION

# Remove ourselves from sudoers
echo -e "\n👤 Removing privileges after completing the setup!"
sudo rm /etc/sudoers.d/1-agent-setup

{initScriptExecution}

# Execute the complete task workflow
echo -e "\n======================================="
echo "🚀 Running Workflow"
echo "======================================="

# Capture the CMD exit and ensure we recover the result!
trap 'safe_exit $?' EXIT

"$@"
