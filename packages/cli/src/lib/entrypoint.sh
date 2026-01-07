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
# available in the $PATH.
export PATH=/root/local/.bin:$PATH

# Initially, use sudo to ensure even users without permissions can
# create this. Once we finish the setup, we will reduce the sudo
# permissions to the minimal.
sudo mkdir -p $HOME
sudo mkdir -p $HOME/.config
sudo mkdir -p $HOME/.local/bin
echo 'export PATH="$HOME/.local/bin:$HOME/.local/npm/bin:$PATH"' >> $HOME/.profile
sudo chown -R $(id -u):$(id -g) $HOME
sudo chown -R $(id -u):$(id -g) /workspace
sudo chown -R $(id -u):$(id -g) /output

source $HOME/.profile

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

# Guard to prevent double cleanup when signals trigger EXIT trap
_EXITING=0

# Function to handle script exit
safe_exit() {
    # Prevent re-entry (signals like INT/TERM will trigger EXIT on exit)
    if [[ $_EXITING -eq 1 ]]; then
        return
    fi
    _EXITING=1

    local exit_code="$1"

    # Clean up any pre-context file
    if [[ -d "/workspace/.rover-context" ]]; then
        rm -r /workspace/.rover-context &> /dev/null
    fi

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
{validateTaskFileFunction}
# Fail if node is not available
check_command "node" || safe_exit 1

# Set start time
START_TIME=$(date -u +%Y-%m-%dT%H:%M:%S%z)
{validateTaskFileCall}

# Setup the agents (may be multiple if per-step agents are configured)
AGENTS=({agents})
PRIMARY_AGENT={primaryAgent}

# Start nix-daemon if cursor is in the agents list
for AGENT in "${AGENTS[@]}"; do
  if [ "$AGENT" = "cursor" ]; then
    echo -e "\n======================================="
    echo "📦 Running nix daemon for cursor"
    echo "======================================="
    sudo nix-daemon &> /dev/null &
    break
  fi
done

echo -e "\n======================================="
echo "📦 Starting the package manager MCP server"
echo "======================================="
export PACKAGE_MANAGER_MCP_PORT=8090
RUST_LOG=info package-manager-mcp-server $PACKAGE_MANAGER_MCP_PORT &

PACKAGE_MANAGER_MCP_INIT_PAYLOAD='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{"tools":{},"resources":{},"prompts":{}},"clientInfo":{"name":"test-client","version":"1.0.0"}}}'

while true; do
  PACKAGE_MANAGER_MCP_RESPONSE=$(curl -s --connect-timeout 1 --max-time 1 \
    -X POST \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d "$PACKAGE_MANAGER_MCP_INIT_PAYLOAD" \
    http://127.0.0.1:$PACKAGE_MANAGER_MCP_PORT/mcp 2>/dev/null)

  if [[ $? -ne 0 ]]; then
    echo "Waiting for package manager MCP to be ready at $PACKAGE_MANAGER_MCP_PORT..."
    sleep 1
    continue
  fi

  if echo "$PACKAGE_MANAGER_MCP_RESPONSE" | grep 'serverInfo'; then
    break
  fi

  sleep 1
done

echo "✅ Package manager MCP is ready"
{taskDataSection}
{installAllPackages}

# Agent-specific CLI installation and credential setup
echo -e "\n📦 Installing Agent CLI(s) and setting up credentials"

# Install all agents that will be used in the workflow
for AGENT in "${AGENTS[@]}"; do
  echo "Installing $AGENT..."
  # Pass the environment variables to ensure it loads the right credentials
  sudo -E rover-agent install $AGENT --user-dir $HOME
  if [ $? -eq 0 ]; then
    echo "✅ $AGENT was installed successfully."
  else
    echo "❌ $AGENT could not be installed"
    safe_exit 1
  fi
done

# Set the right permissions after installing and moving credentials
sudo chown -R $(id -u):$(id -g) $HOME

echo -e "\n📦 Done installing agent(s)"

echo -e "\n📦 Installing MCP servers"
# Configure built-in MCPs for all agents
for AGENT in "${AGENTS[@]}"; do
  rover-agent config mcp $AGENT package-manager --transport "http" http://127.0.0.1:8090/mcp
done

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
{exportTaskVariables}
# Remove ourselves from sudoers
echo -e "\n👤 Removing privileges after completing the setup!"
sudo rm /etc/sudoers.d/1-agent-setup

{initScriptExecution}
{workflowExecutionSection}
# Capture the CMD exit and ensure we recover the result!
trap 'safe_exit $?' EXIT HUP INT QUIT TERM

"$@"
