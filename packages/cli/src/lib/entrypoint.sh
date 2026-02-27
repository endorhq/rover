#!/bin/bash

# Template file for the entrypoint to run the agents and the workflow.
# The purpose of this file is to install all required elements and
# prepare the agent to run.
#
# @see https://github.com/sindresorhus/pupa

# Define the agent user home
if [[ -z "$\{HOME\}" ]]; then
  export HOME=/home/$(id -u)
fi
sudo mkdir -p $HOME
sudo chown -R $(id -u):$(id -g) $HOME

# Some tools might be installed under /root/local/.bin conditionally
# depending on the chosen agent and requirements, make this directory
# available in the $PATH.
export PATH=/root/local/.bin:$PATH

{aptGetUpdate}
{homeSetup}

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
{agentInstallSection}
{mcpConfigSection}
{exportTaskVariables}
{networkConfigSection}
{sudoersRemoval}
{initScriptExecution}
{workflowExecutionSection}
# Capture the CMD exit and ensure we recover the result!
trap 'safe_exit $?' EXIT HUP INT QUIT TERM

"$@"
