#!/bin/bash

# Todocko MCP Server Installer for Unix/Linux/macOS
# Supports both Claude Desktop and Claude Code (CLI)

set -e

echo "=========================================="
echo "  Todocko MCP Server Installer"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed.${NC}"
    echo "Please install Node.js 18+ from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}Error: Node.js 18+ is required. Current version: $(node -v)${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Node.js $(node -v) detected${NC}"

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Install dependencies
echo ""
echo "Installing dependencies..."
cd "$SCRIPT_DIR"
npm install

# Build TypeScript
echo ""
echo "Building TypeScript..."
npm run build

echo -e "${GREEN}✓ Build complete${NC}"

# Get mnemonic from user
echo ""
echo "=========================================="
echo "  Configuration"
echo "=========================================="
echo ""
echo "To sync with your Todocko data, you need your 24-word backup phrase."
echo "You can find it in Todocko: Settings → Synchronization → Show backup phrase"
echo ""
echo -e "${YELLOW}Warning: Keep your mnemonic secret! Anyone with it can access your data.${NC}"
echo ""
read -p "Enter your Todocko mnemonic (24 words): " MNEMONIC

if [ -z "$MNEMONIC" ]; then
    echo -e "${RED}Error: Mnemonic is required${NC}"
    exit 1
fi

# Ask which Claude client to configure
echo ""
echo "Which Claude client do you want to configure?"
echo "1) Claude Desktop"
echo "2) Claude Code (CLI)"
echo "3) Both"
read -p "Enter choice (1-3): " CLIENT_CHOICE

# Determine config locations
DESKTOP_CONFIG_DIR=""
CODE_CONFIG_DIR="$HOME/.claude"

if [[ "$OSTYPE" == "darwin"* ]]; then
    DESKTOP_CONFIG_DIR="$HOME/Library/Application Support/Claude"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    DESKTOP_CONFIG_DIR="$HOME/.config/Claude"
fi

# Function to update config
update_config() {
    local config_file=$1
    local config_dir=$(dirname "$config_file")

    mkdir -p "$config_dir"

    if [ -f "$config_file" ]; then
        echo "Updating existing config: $config_file"
        node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('$config_file', 'utf8'));
config.mcpServers = config.mcpServers || {};
config.mcpServers.todocko = {
    command: 'node',
    args: ['$SCRIPT_DIR/dist/index.js'],
    env: {
        TODOCKO_MNEMONIC: '$MNEMONIC'
    }
};
fs.writeFileSync('$config_file', JSON.stringify(config, null, 2));
"
    else
        cat > "$config_file" << EOF
{
  "mcpServers": {
    "todocko": {
      "command": "node",
      "args": ["$SCRIPT_DIR/dist/index.js"],
      "env": {
        "TODOCKO_MNEMONIC": "$MNEMONIC"
      }
    }
  }
}
EOF
    fi
    echo -e "${GREEN}✓ Config updated: $config_file${NC}"
}

# Configure based on choice
case $CLIENT_CHOICE in
    1)
        if [ -n "$DESKTOP_CONFIG_DIR" ]; then
            update_config "$DESKTOP_CONFIG_DIR/claude_desktop_config.json"
        else
            echo -e "${YELLOW}Claude Desktop config location unknown for this OS${NC}"
        fi
        ;;
    2)
        update_config "$CODE_CONFIG_DIR/settings.json"
        ;;
    3)
        if [ -n "$DESKTOP_CONFIG_DIR" ]; then
            update_config "$DESKTOP_CONFIG_DIR/claude_desktop_config.json"
        fi
        update_config "$CODE_CONFIG_DIR/settings.json"
        ;;
    *)
        echo -e "${YELLOW}Invalid choice. Skipping config.${NC}"
        ;;
esac

echo ""
echo "=========================================="
echo "  Installation Complete!"
echo "=========================================="
echo ""
echo -e "${GREEN}Todocko MCP Server has been installed successfully.${NC}"
echo ""
echo "Next steps:"
echo "1. Restart Claude Desktop / Claude Code"
echo "2. Look for the MCP tools icon"
echo "3. You should see tools like: td_list_tasks, td_create_task, etc."
echo ""
echo "Available tools:"
echo "  - td_list_projects   List all projects"
echo "  - td_get_project     Get project details"
echo "  - td_list_tasks      List tasks with filters"
echo "  - td_get_task        Get task by ID or code"
echo "  - td_create_task     Create a new task"
echo "  - td_update_task     Update an existing task"
echo "  - td_search_tasks    Search tasks"
echo "  - td_list_users      List all users"
echo "  - td_get_user        Get user details"
echo "  - td_list_worklogs   List worklogs for a task"
echo "  - td_add_worklog     Add worklog to a task"
