# Todocko MCP Server Installer for Windows
# Supports both Claude Desktop and Claude Code (CLI)

$ErrorActionPreference = "Stop"

Write-Host "=========================================="
Write-Host "  Todocko MCP Server Installer"
Write-Host "=========================================="
Write-Host ""

# Check Node.js
try {
    $nodeVersion = node -v
    $versionNumber = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
    if ($versionNumber -lt 18) {
        Write-Host "Error: Node.js 18+ is required. Current version: $nodeVersion" -ForegroundColor Red
        exit 1
    }
    Write-Host "Node.js $nodeVersion detected" -ForegroundColor Green
}
catch {
    Write-Host "Error: Node.js is not installed." -ForegroundColor Red
    Write-Host "Please install Node.js 18+ from https://nodejs.org/"
    exit 1
}

# Get script directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Install dependencies
Write-Host ""
Write-Host "Installing dependencies..."
Set-Location $ScriptDir
npm install

# Build TypeScript
Write-Host ""
Write-Host "Building TypeScript..."
npm run build

Write-Host "Build complete" -ForegroundColor Green

# Get mnemonic from user
Write-Host ""
Write-Host "=========================================="
Write-Host "  Configuration"
Write-Host "=========================================="
Write-Host ""
Write-Host "To sync with your Todocko data, you need your 24-word backup phrase."
Write-Host "You can find it in Todocko: Settings -> Synchronization -> Show backup phrase"
Write-Host ""
Write-Host "Warning: Keep your mnemonic secret! Anyone with it can access your data." -ForegroundColor Yellow
Write-Host ""
$Mnemonic = Read-Host "Enter your Todocko mnemonic (24 words)"

if ([string]::IsNullOrWhiteSpace($Mnemonic)) {
    Write-Host "Error: Mnemonic is required" -ForegroundColor Red
    exit 1
}

# Ask which Claude client to configure
Write-Host ""
Write-Host "Which Claude client do you want to configure?"
Write-Host "1) Claude Desktop"
Write-Host "2) Claude Code (CLI)"
Write-Host "3) Both"
$ClientChoice = Read-Host "Enter choice (1-3)"

# Config locations
$DesktopConfigDir = "$env:APPDATA\Claude"
$CodeConfigDir = "$env:USERPROFILE\.claude"

# Function to update config
function Update-Config {
    param (
        [string]$ConfigFile
    )

    $ConfigDir = Split-Path -Parent $ConfigFile

    if (!(Test-Path $ConfigDir)) {
        New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null
    }

    if (Test-Path $ConfigFile) {
        Write-Host "Updating existing config: $ConfigFile"
        $config = Get-Content $ConfigFile | ConvertFrom-Json

        if ($null -eq $config.mcpServers) {
            $config | Add-Member -NotePropertyName "mcpServers" -NotePropertyValue @{} -Force
        }

        $config.mcpServers | Add-Member -NotePropertyName "todocko" -NotePropertyValue @{
            command = "node"
            args = @("$ScriptDir\dist\index.js")
            env = @{
                TODOCKO_MNEMONIC = $Mnemonic
            }
        } -Force

        $config | ConvertTo-Json -Depth 10 | Set-Content $ConfigFile
    }
    else {
        $config = @{
            mcpServers = @{
                todocko = @{
                    command = "node"
                    args = @("$ScriptDir\dist\index.js")
                    env = @{
                        TODOCKO_MNEMONIC = $Mnemonic
                    }
                }
            }
        }

        $config | ConvertTo-Json -Depth 10 | Set-Content $ConfigFile
    }

    Write-Host "Config updated: $ConfigFile" -ForegroundColor Green
}

# Configure based on choice
switch ($ClientChoice) {
    "1" {
        Update-Config -ConfigFile "$DesktopConfigDir\claude_desktop_config.json"
    }
    "2" {
        Update-Config -ConfigFile "$CodeConfigDir\settings.json"
    }
    "3" {
        Update-Config -ConfigFile "$DesktopConfigDir\claude_desktop_config.json"
        Update-Config -ConfigFile "$CodeConfigDir\settings.json"
    }
    default {
        Write-Host "Invalid choice. Skipping config." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "=========================================="
Write-Host "  Installation Complete!"
Write-Host "=========================================="
Write-Host ""
Write-Host "Todocko MCP Server has been installed successfully." -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "1. Restart Claude Desktop / Claude Code"
Write-Host "2. Look for the MCP tools icon"
Write-Host "3. You should see tools like: td_list_tasks, td_create_task, etc."
Write-Host ""
Write-Host "Available tools:"
Write-Host "  - td_list_projects   List all projects"
Write-Host "  - td_get_project     Get project details"
Write-Host "  - td_list_tasks      List tasks with filters"
Write-Host "  - td_get_task        Get task by ID or code"
Write-Host "  - td_create_task     Create a new task"
Write-Host "  - td_update_task     Update an existing task"
Write-Host "  - td_search_tasks    Search tasks"
Write-Host "  - td_list_users      List all users"
Write-Host "  - td_get_user        Get user details"
Write-Host "  - td_list_worklogs   List worklogs for a task"
Write-Host "  - td_add_worklog     Add worklog to a task"
