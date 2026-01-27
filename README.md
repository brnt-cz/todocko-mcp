# Todocko MCP Server

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
4. **Ručně doplňte** svou 24-slovnou zálohovací frázi do konfiguračního souboru
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
        "TODOCKO_MNEMONIC": "vaše 24 slov zálohovací fráze"
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
        "TODOCKO_MNEMONIC": "vaše 24 slov zálohovací fráze"
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
| `td_list_users` | Seznam všech uživatelů |
| `td_get_user` | Detail uživatele |
| `td_list_worklogs` | Seznam worklogů pro úkol |
| `td_add_worklog` | Přidání worklogu k úkolu |

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

## Bezpečnost

**Důležité:** Vaše zálohovací fráze (mnemonic) je citlivý údaj!

- Nikdy ji nesdílejte v přímé konverzaci s AI
- V konfiguraci MCP serveru je fráze bezpečná (AI k ní nemá přístup)
- Kdokoli s vaší frází má plný přístup k vašim datům

## Troubleshooting

### Server se nespustí
- Zkontrolujte, že máte Node.js 18+
- Zkontrolujte, že jste spustili `npm run build`
- Zkontrolujte logy v Claude Desktop

### Data se nesynchronizují
- Ověřte, že je zálohovací fráze správná (24 slov)
- Zkontrolujte internetové připojení
- Počkejte pár sekund na synchronizaci

### Nástroje nejsou viditelné
- Restartujte Claude Desktop
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
