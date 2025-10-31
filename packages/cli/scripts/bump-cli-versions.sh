#!/bin/bash

set -e

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

CLIS_JSON_PATH="$SCRIPT_DIR/../src/clis.json"

echo "Fetching latest versions for CLIs..."

# Create a temporary file to store the updated JSON
TEMP_FILE=$(mktemp)

# Read the current clis.json and update each package with latest version
jq -r 'keys[]' "$CLIS_JSON_PATH" | while read -r package; do
    echo "Fetching latest version for $package..."
    latest_version=$(npm view "$package" version 2>/dev/null || echo "unknown")

    if [ "$latest_version" != "unknown" ]; then
        echo "  $package: $latest_version"
        # Update the JSON file with the new version
        jq --arg pkg "$package" --arg ver "$latest_version" '.[$pkg] = $ver' "$CLIS_JSON_PATH" > "$TEMP_FILE" && mv "$TEMP_FILE" "$CLIS_JSON_PATH"
    else
        echo "  $package: Could not fetch version, skipping"
    fi
done

echo ""
echo "Updated clis.json:"
cat "$CLIS_JSON_PATH"