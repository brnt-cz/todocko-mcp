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

# Ask which Claude client to configure
Write-Host ""
Write-Host "=========================================="
Write-Host "  Configuration"
Write-Host "=========================================="
Write-Host ""
Write-Host "Which Claude client do you want to configure?"
Write-Host "1) Claude Desktop"
Write-Host "2) Claude Code (CLI)"
Write-Host "3) Both"
$ClientChoice = Read-Host "Enter choice (1-3)"

# Config locations
$DesktopConfigDir = "$env:APPDATA\Claude"
$CodeConfigDir = "$env:USERPROFILE\.claude"

$ConfigFiles = @()

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
                TODOCKO_MNEMONIC = "YOUR_24_WORD_MNEMONIC_HERE"
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
                        TODOCKO_MNEMONIC = "YOUR_24_WORD_MNEMONIC_HERE"
                    }
                }
            }
        }

        $config | ConvertTo-Json -Depth 10 | Set-Content $ConfigFile
    }

    Write-Host "Config created: $ConfigFile" -ForegroundColor Green
    return $ConfigFile
}

# Configure based on choice
switch ($ClientChoice) {
    "1" {
        $ConfigFiles += Update-Config -ConfigFile "$DesktopConfigDir\claude_desktop_config.json"
    }
    "2" {
        $ConfigFiles += Update-Config -ConfigFile "$CodeConfigDir\settings.json"
    }
    "3" {
        $ConfigFiles += Update-Config -ConfigFile "$DesktopConfigDir\claude_desktop_config.json"
        $ConfigFiles += Update-Config -ConfigFile "$CodeConfigDir\settings.json"
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
Write-Host "Todocko MCP Server has been installed." -ForegroundColor Green
Write-Host ""
Write-Host "IMPORTANT: You need to add your mnemonic!" -ForegroundColor Yellow
Write-Host ""
Write-Host "1. Open the config file:"
foreach ($cfg in $ConfigFiles) {
    Write-Host "   $cfg"
}
Write-Host ""
Write-Host "2. Replace YOUR_24_WORD_MNEMONIC_HERE with your actual 24-word"
Write-Host "   backup phrase from Todocko (Settings -> Synchronization)"
Write-Host ""
Write-Host "3. Restart Claude Desktop / Claude Code"
Write-Host ""
Write-Host "Available tools after setup:"
Write-Host "  td_list_tasks, td_create_task, td_update_task, td_search_tasks,"
Write-Host "  td_list_projects, td_list_users, td_list_worklogs, td_add_worklog"
