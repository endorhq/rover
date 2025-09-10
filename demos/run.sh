#!/usr/bin/env bash

set -e

# Color codes for better output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if argument is provided
if [ $# -ne 1 ]; then
    echo -e "${RED}Error: Please provide a tape file as argument${NC}"
    echo "Usage: $0 <tape-file>"
    exit 1
fi

TAPE_FILE="$1"

# Check if tape file exists
if [ ! -f "$TAPE_FILE" ]; then
    echo -e "${RED}Error: Tape file '$TAPE_FILE' not found${NC}"
    exit 1
fi

# Function to clean up /tmp/rover-demo
cleanup_demo_folder() {
    if [ -d "/tmp/rover-demo" ]; then
        echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${YELLOW}Found existing /tmp/rover-demo directory${NC}"
        echo -e "This directory is used by Rover demos to store temporary task data."
        echo -e "It needs to be removed to ensure a clean demo environment."
        echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${BLUE}Removing /tmp/rover-demo...${NC}"
        sudo rm -rf /tmp/rover-demo
        echo -e "${GREEN}✓ Cleaned up /tmp/rover-demo${NC}"
    fi
}

# Function to check and stop rover containers
check_and_stop_containers() {
    local containers=$(docker ps --format "{{.Names}}" | grep -E "^rover-task-[^-]+-[^-]+$" || true)
    
    if [ ! -z "$containers" ]; then
        echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${YELLOW}Found running Rover task containers:${NC}"
        echo "$containers" | while read container; do
            echo -e "  • $container"
        done
        echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        
        read -p "Do you want to stop these containers? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            echo -e "${BLUE}Stopping Rover task containers...${NC}"
            echo "$containers" | while read container; do
                docker stop "$container" > /dev/null 2>&1
                echo -e "${GREEN}✓ Stopped $container${NC}"
            done
        else
            echo -e "${YELLOW}⚠ Keeping containers running. This may affect the demo.${NC}"
        fi
    fi
}

# Main execution
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}                         Rover Demo Runner                                 ${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo

# Pre-run cleanup
echo -e "${GREEN}Step 1: Pre-run cleanup${NC}"
cleanup_demo_folder
check_and_stop_containers
echo

# Run VHS
echo -e "${GREEN}Step 2: Running VHS demo${NC}"
echo -e "${BLUE}Executing: vhs $TAPE_FILE${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

vhs "$TAPE_FILE"

echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✓ VHS demo completed${NC}"
echo

# Post-run cleanup
echo -e "${GREEN}Step 3: Post-run cleanup${NC}"
cleanup_demo_folder
check_and_stop_containers

echo
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✓ Demo completed and cleaned up successfully!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"