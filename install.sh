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

# Ask which Claude client to configure
echo ""
echo "=========================================="
echo "  Configuration"
echo "=========================================="
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
        TODOCKO_MNEMONIC: 'YOUR_24_WORD_MNEMONIC_HERE'
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
        "TODOCKO_MNEMONIC": "YOUR_24_WORD_MNEMONIC_HERE"
      }
    }
  }
}
EOF
    fi
    echo -e "${GREEN}✓ Config created: $config_file${NC}"
}

# Configure based on choice
CONFIG_FILES=()
case $CLIENT_CHOICE in
    1)
        if [ -n "$DESKTOP_CONFIG_DIR" ]; then
            update_config "$DESKTOP_CONFIG_DIR/claude_desktop_config.json"
            CONFIG_FILES+=("$DESKTOP_CONFIG_DIR/claude_desktop_config.json")
        else
            echo -e "${YELLOW}Claude Desktop config location unknown for this OS${NC}"
        fi
        ;;
    2)
        update_config "$CODE_CONFIG_DIR/settings.json"
        CONFIG_FILES+=("$CODE_CONFIG_DIR/settings.json")
        ;;
    3)
        if [ -n "$DESKTOP_CONFIG_DIR" ]; then
            update_config "$DESKTOP_CONFIG_DIR/claude_desktop_config.json"
            CONFIG_FILES+=("$DESKTOP_CONFIG_DIR/claude_desktop_config.json")
        fi
        update_config "$CODE_CONFIG_DIR/settings.json"
        CONFIG_FILES+=("$CODE_CONFIG_DIR/settings.json")
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
echo -e "${GREEN}Todocko MCP Server has been installed.${NC}"
echo ""
echo -e "${YELLOW}⚠️  IMPORTANT: You need to add your mnemonic!${NC}"
echo ""
echo "1. Open the config file:"
for cfg in "${CONFIG_FILES[@]}"; do
    echo "   $cfg"
done
echo ""
echo "2. Replace YOUR_24_WORD_MNEMONIC_HERE with your actual 24-word"
echo "   backup phrase from Todocko (Settings → Synchronization)"
echo ""
echo "3. Restart Claude Desktop / Claude Code"
echo ""
echo "Available tools after setup:"
echo "  td_list_tasks, td_create_task, td_update_task, td_search_tasks,"
echo "  td_list_projects, td_list_users, td_list_worklogs, td_add_worklog"
