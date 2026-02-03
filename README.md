# Todocko MCP Server

> **English version below** / [Jump to English](#english)

MCP (Model Context Protocol) server pro práci s daty [Todocko](https://app.todocko.cz) aplikace z AI asistentů.

## Podpora

- **Claude Desktop** - plná podpora
- **Claude Code (CLI)** - plná podpora (stejná konfigurace)

## Požadavky

- Node.js 18+
- Todocko účet s daty synchronizovanými přes Evolu

## Instalace

### 1. Stažení

**Pomocí git:**
```bash
git clone https://github.com/brnt-cz/todocko-mcp.git
cd todocko-mcp
```

**Nebo stáhněte ZIP** z [Releases](https://github.com/brnt-cz/todocko-mcp/releases) a rozbalte.

### 2. Spuštění instalátoru

**Linux/macOS:**
```bash
chmod +x install.sh
./install.sh
```

**Windows (PowerShell):**
```powershell
.\install.ps1
```

Instalátor:
1. Nainstaluje závislosti a sestaví projekt
2. Zeptá se, zda chcete nakonfigurovat Claude Desktop, Claude Code nebo obojí
3. Vytvoří konfigurační soubor s placeholderem
4. **Ručně doplňte** svou 24slovnou zálohovací frázi do konfiguračního souboru
5. Restartujte Claude

### Manuální instalace

1. Nainstalujte závislosti:
   ```bash
   npm install
   npm run build
   ```

2. Přidejte do konfigurace:

**Claude Desktop** (`~/.config/Claude/claude_desktop_config.json` na Linuxu nebo `~/Library/Application Support/Claude/claude_desktop_config.json` na macOS):

```json
{
  "mcpServers": {
    "todocko": {
      "command": "node",
      "args": ["/cesta/k/mcp-server/dist/index.js"],
      "env": {
        "TODOCKO_MNEMONIC": "vaše 24slovná zálohovací fráze"
      }
    }
  }
}
```

**Claude Code (CLI)** - přidejte do `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "todocko": {
      "command": "node",
      "args": ["/cesta/k/mcp-server/dist/index.js"],
      "env": {
        "TODOCKO_MNEMONIC": "vaše 24slovná zálohovací fráze"
      }
    }
  }
}
```

3. Restartujte Claude Desktop / Claude Code

## Dostupné nástroje

| Nástroj | Popis |
|---------|-------|
| `td_list_projects` | Seznam všech projektů |
| `td_get_project` | Detail projektu podle ID nebo kódu |
| `td_list_tasks` | Seznam úkolů s filtry (projekt, status, priorita, assignee) |
| `td_get_task` | Detail úkolu podle ID nebo kódu (např. `PROJ-123`) |
| `td_create_task` | Vytvoření nového úkolu |
| `td_update_task` | Aktualizace existujícího úkolu |
| `td_search_tasks` | Vyhledávání úkolů podle textu |
| `td_list_deployment_stages` | Seznam deployment stages pro projekt |
| `td_list_users` | Seznam všech uživatelů |
| `td_get_user` | Detail uživatele |
| `td_list_worklogs` | Seznam worklogů pro úkol |
| `td_add_worklog` | Přidání worklogu k úkolu |

### Sdílené projekty

| Nástroj | Popis |
|---------|-------|
| `td_list_shared_projects` | Seznam sdílených projektů, ke kterým má uživatel přístup |
| `td_list_shared_tasks` | Seznam úkolů ze sdíleného projektu |
| `td_update_shared_task` | Aktualizace úkolu ve sdíleném projektu |
| `td_list_shared_deployment_stages` | Seznam deployment stages pro sdílený projekt |
| `td_create_shared_deployment_stage` | Vytvoření deployment stage ve sdíleném projektu |

## Příklady použití

### Seznam projektů
```
Zobraz mi seznam všech projektů v Todocko
```

### Seznam úkolů
```
Jaké mám úkoly ve stavu "todo"?
Zobraz úkoly projektu TODO
```

### Detail úkolu
```
Jaké jsou detaily úkolu TODO-15?
```

### Vytvoření úkolu
```
Vytvoř nový úkol v projektu PROJ s názvem "Opravit bug v přihlášení" a prioritou high
```

### Aktualizace úkolu
```
Označ úkol PROJ-5 jako dokončený
Přiřaď úkol TODO-10 uživateli s ID xyz
```

### Logování času
```
Zaloguj 2 hodiny práce na úkol TODO-15 s popisem "Implementace feature"
```

### Sdílené projekty
```
Zobraz sdílené projekty
Jaké úkoly jsou ve sdíleném projektu?
Označ úkol jako nasazený na produkci
```

### Deployment stages
```
Jaké deployment stages má projekt?
Vytvoř novou deployment stage "Staging" pro sdílený projekt
```

## Bezpečnost

**Důležité:** Vaše zálohovací fráze (mnemonic) je citlivý údaj!

- Nikdy ji nesdílejte v přímé konverzaci s AI
- V konfiguraci MCP serveru je fráze bezpečná (AI k ní nemá přístup)
- Kdokoli s vaší frází má plný přístup k vašim datům

## Změna konfigurace

### Claude Code (CLI)

Po změně konfigurace v `~/.claude/settings.json` (např. změna mnemonicu) spusťte příkaz:
```
/mcp
```
Tím se MCP server restartuje s novou konfigurací.

### Přepnutí na jiný účet

Při změně mnemonicu na **jiný Todocko účet** je potřeba smazat lokální databázi:

```bash
rm /cesta/k/mcp-server/todocko.db
```

Databáze obsahuje ID vlastníka z předchozího mnemonicu. Po smazání se při dalším spuštění vytvoří nová databáze a stáhnou se data nového účtu.

## Troubleshooting

### Server se nespustí
- Zkontrolujte, že máte Node.js 18+
- Zkontrolujte, že jste spustili `npm run build`
- Zkontrolujte logy v Claude Desktop

### Data se nesynchronizují
- Ověřte, že je zálohovací fráze správná (24 slov)
- Zkontrolujte internetové připojení
- Počkejte pár sekund na synchronizaci
- Zkuste smazat `todocko.db` a restartovat

### Nástroje nejsou viditelné
- Restartujte Claude Desktop
- V Claude Code použijte `/mcp` pro reload
- Zkontrolujte konfigurační soubor
- Zkontrolujte cestu k dist/index.js

## Vývoj

```bash
# Instalace závislostí
npm install

# Build
npm run build

# Watch mode pro vývoj
npm run dev

# Ruční spuštění
TODOCKO_MNEMONIC="vaše fráze" npm start
```

---

# English

MCP (Model Context Protocol) server for working with [Todocko](https://app.todocko.cz) app data from AI assistants.

## Support

- **Claude Desktop** - full support
- **Claude Code (CLI)** - full support (same configuration)

## Requirements

- Node.js 18+
- Todocko account with data synchronized via Evolu

## Installation

### 1. Download

**Using git:**
```bash
git clone https://github.com/brnt-cz/todocko-mcp.git
cd todocko-mcp
```

**Or download ZIP** from [Releases](https://github.com/brnt-cz/todocko-mcp/releases) and extract.

### 2. Run the installer

**Linux/macOS:**
```bash
chmod +x install.sh
./install.sh
```

**Windows (PowerShell):**
```powershell
.\install.ps1
```

The installer will:
1. Install dependencies and build the project
2. Ask whether to configure Claude Desktop, Claude Code, or both
3. Create a configuration file with a placeholder
4. **Manually add** your 24-word backup phrase to the configuration file
5. Restart Claude

### Manual installation

1. Install dependencies:
   ```bash
   npm install
   npm run build
   ```

2. Add to configuration:

**Claude Desktop** (`~/.config/Claude/claude_desktop_config.json` on Linux or `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "todocko": {
      "command": "node",
      "args": ["/path/to/mcp-server/dist/index.js"],
      "env": {
        "TODOCKO_MNEMONIC": "your 24 word backup phrase"
      }
    }
  }
}
```

**Claude Code (CLI)** - add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "todocko": {
      "command": "node",
      "args": ["/path/to/mcp-server/dist/index.js"],
      "env": {
        "TODOCKO_MNEMONIC": "your 24 word backup phrase"
      }
    }
  }
}
```

3. Restart Claude Desktop / Claude Code

## Available Tools

| Tool | Description |
|------|-------------|
| `td_list_projects` | List all projects |
| `td_get_project` | Get project details by ID or code |
| `td_list_tasks` | List tasks with filters (project, status, priority, assignee) |
| `td_get_task` | Get task details by ID or code (e.g., `PROJ-123`) |
| `td_create_task` | Create a new task |
| `td_update_task` | Update an existing task |
| `td_search_tasks` | Search tasks by text |
| `td_list_deployment_stages` | List deployment stages for a project |
| `td_list_users` | List all users |
| `td_get_user` | Get user details |
| `td_list_worklogs` | List worklogs for a task |
| `td_add_worklog` | Add a worklog to a task |

### Shared Projects

| Tool | Description |
|------|-------------|
| `td_list_shared_projects` | List shared projects the user has access to |
| `td_list_shared_tasks` | List tasks from a shared project |
| `td_update_shared_task` | Update a task in a shared project |
| `td_list_shared_deployment_stages` | List deployment stages for a shared project |
| `td_create_shared_deployment_stage` | Create a deployment stage in a shared project |

## Usage Examples

### List projects
```
Show me all projects in Todocko
```

### List tasks
```
What tasks do I have with status "todo"?
Show tasks for project TODO
```

### Task details
```
What are the details of task TODO-15?
```

### Create task
```
Create a new task in project PROJ with title "Fix login bug" and priority high
```

### Update task
```
Mark task PROJ-5 as completed
Assign task TODO-10 to user with ID xyz
```

### Log time
```
Log 2 hours of work on task TODO-15 with description "Feature implementation"
```

### Shared projects
```
Show shared projects
What tasks are in the shared project?
Mark task as deployed to production
```

### Deployment stages
```
What deployment stages does the project have?
Create a new deployment stage "Staging" for the shared project
```

## Security

**Important:** Your backup phrase (mnemonic) is sensitive data!

- Never share it directly in conversation with AI
- In the MCP server configuration, the phrase is safe (AI has no access to it)
- Anyone with your phrase has full access to your data

## Configuration Changes

### Claude Code (CLI)

After changing configuration in `~/.claude/settings.json` (e.g., changing mnemonic), run the command:
```
/mcp
```
This will restart the MCP server with the new configuration.

### Switching to a Different Account

When changing the mnemonic to a **different Todocko account**, you need to delete the local database:

```bash
rm /path/to/mcp-server/todocko.db
```

The database contains the owner ID from the previous mnemonic. After deletion, a new database will be created on the next startup and data from the new account will be downloaded.

## Troubleshooting

### Server won't start
- Check that you have Node.js 18+
- Check that you ran `npm run build`
- Check logs in Claude Desktop

### Data not syncing
- Verify the backup phrase is correct (24 words)
- Check internet connection
- Wait a few seconds for synchronization
- Try deleting `todocko.db` and restart

### Tools not visible
- Restart Claude Desktop
- In Claude Code, use `/mcp` for reload
- Check the configuration file
- Check the path to dist/index.js

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode for development
npm run dev

# Manual run
TODOCKO_MNEMONIC="your phrase" npm start
```
