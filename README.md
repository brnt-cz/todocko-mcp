# Todocko MCP Server

> **English version below** / [Jump to English](#english)

MCP (Model Context Protocol) server pro práci s daty [Todocko](https://app.todocko.cz) aplikace z AI asistentů.

## Podpora

- **Claude Desktop** - plná podpora
- **Claude Code (CLI)** - plná podpora (stejná konfigurace)

## Požadavky

- **Node.js 22+** (Evolu používá `Set.prototype.difference`, který je dostupný od Node 22)
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

## Dostupné nástroje (136)

### Projekty

| Nástroj | Popis |
|---------|-------|
| `td_list_projects` | Seznam všech projektů |
| `td_get_project` | Detail projektu podle ID nebo kódu |
| `td_create_project` | Vytvoření nového projektu |
| `td_update_project` | Aktualizace projektu (name, code, color, isArchived, autoApproveMembers, isHiddenFromFilters) |
| `td_delete_project` | Smazání projektu (soft delete) |

### Úkoly

| Nástroj | Popis |
|---------|-------|
| `td_list_tasks` | Seznam úkolů s filtry (projekt, status, priorita, assignee) |
| `td_get_task` | Detail úkolu podle ID nebo kódu (např. `PROJ-123`) |
| `td_create_task` | Vytvoření nového úkolu (včetně recurrence, sprintNumber, parentTaskId) |
| `td_update_task` | Aktualizace existujícího úkolu (včetně recurrence, sprintNumber, parentTaskId) |
| `td_search_tasks` | Vyhledávání úkolů podle textu |
| `td_bulk_update_tasks` | Hromadná aktualizace více úkolů (včetně sprintNumber) |
| `td_bulk_delete_tasks` | Hromadné smazání více úkolů |
| `td_delete_task` | Smazání jednoho úkolu (soft delete, kaskáda na worklogy a přílohy) |
| `td_list_git_events` | Git aktivita pro úkol (commits, PR) z relay serveru |

### Uživatelé

| Nástroj | Popis |
|---------|-------|
| `td_list_users` | Seznam všech uživatelů |
| `td_get_user` | Detail uživatele |
| `td_create_user` | Vytvoření nového uživatele |
| `td_update_user` | Aktualizace uživatele |
| `td_delete_user` | Smazání uživatele (soft delete) |

### Worklogy

| Nástroj | Popis |
|---------|-------|
| `td_list_worklogs` | Seznam worklogů pro úkol |
| `td_add_worklog` | Přidání worklogu k úkolu |
| `td_update_worklog` | Aktualizace worklogu |
| `td_delete_worklog` | Smazání worklogu (soft delete) |

### Přílohy

| Nástroj | Popis |
|---------|-------|
| `td_upload_attachment` | Nahrání přílohy k úkolu (ze souboru nebo base64) |
| `td_list_attachments` | Seznam příloh úkolu |
| `td_download_attachment` | Stažení přílohy |
| `td_delete_attachment` | Smazání přílohy |
| `td_upload_note_attachment` | Nahrání přílohy k lokální poznámce projektu |
| `td_list_note_attachments` | Seznam příloh lokální poznámky |
| `td_download_note_attachment` | Stažení přílohy poznámky |
| `td_delete_note_attachment` | Smazání přílohy poznámky |

### Komentáře

| Nástroj | Popis |
|---------|-------|
| `td_list_task_comments` | Seznam komentářů k úkolu |
| `td_create_task_comment` | Přidání komentáře k úkolu |
| `td_update_task_comment` | Úprava komentáře |
| `td_delete_task_comment` | Smazání komentáře (soft delete) |

### Checklist

| Nástroj | Popis |
|---------|-------|
| `td_list_checklist_items` | Seznam položek checklistu úkolu |
| `td_create_checklist_item` | Přidání položky checklistu |
| `td_update_checklist_item` | Aktualizace položky (zaškrtnutí, pozice) |
| `td_delete_checklist_item` | Smazání položky (soft delete) |

### Zmínky (mentions)

| Nástroj | Popis |
|---------|-------|
| `td_list_mentions` | Seznam zmínek uživatele |
| `td_create_mention` | Vytvoření zmínky |
| `td_mark_mention_read` | Označení zmínky jako přečtené |
| `td_mark_all_mentions_read` | Označení všech zmínek jako přečtených |
| `td_delete_mention` | Smazání zmínky (soft delete) |

### Linky mezi úkoly

| Nástroj | Popis |
|---------|-------|
| `td_list_task_links` | Seznam linků úkolu |
| `td_create_task_link` | Vytvoření linku mezi úkoly |
| `td_delete_task_link` | Smazání linku (soft delete) |

### Tagy

| Nástroj | Popis |
|---------|-------|
| `td_list_tags` | Seznam štítků; vrací `projectId`, umí filtrovat podle projektu i na nezařazené |
| `td_create_tag` | Vytvoření štítku — **předej `projectId`**, viz poznámku níž |
| `td_update_tag` | Přejmenování, změna barvy, přiřazení projektu, nebo příznak výchozího štítku |
| `td_delete_tag` | Smazání štítku (soft delete) |
| `td_list_task_tags` | Seznam štítků přiřazených k úkolu |
| `td_add_tag_to_task` | Přiřazení štítku k úkolu |
| `td_remove_tag_from_task` | Odebrání štítku z úkolu |

Sdílené projekty (TODO-235):

| Nástroj | Popis |
|---------|-------|
| `td_list_shared_tags` | Štítky ve sdíleném projektu |
| `td_create_shared_tag` | Vytvoření štítku ve sdíleném projektu |
| `td_update_shared_tag` | Přejmenování / změna barvy / příznak výchozího štítku |
| `td_delete_shared_tag` | Smazání (soft delete) |
| `td_add_shared_tag_to_task` | Přiřazení k úkolu ve sdíleném projektu |
| `td_remove_shared_tag_from_task` | Odebrání z úkolu |

> **Štítek bez projektu appka nikde nenabídne.** Od TODO-227 jsou štítky vázané
> na projekt; `td_create_tag` bez `projectId` vyrobí **nezařazený** štítek, který
> se v appce objeví jen v nastavení projektu v sekci „Nezařazené" s tlačítkem na
> přiřazení. Odpověď nástroje na to upozorní. Dodatečně to spraví
> `td_update_tag` s `projectId`.
>
> **Výchozí štítky (TODO-239).** `isDefault` u `td_create_tag` / `td_update_tag`
> (a sdílených variant) znamená, že štítek dostane **každý nově zakládaný úkol**
> projektu. `td_create_task` i `td_create_shared_task` je přidávají samy a vrátí
> je v `appliedTags` — appka je předzaškrtává v modalu, takže bez toho by výsledek
> závisel na tom, odkud úkol vznikne. Existujících úkolů se to nedotkne.
>
> Ve sdílených projektech se zapisuje do **jiné Evolu instance**, proto samostatná
> sada nástrojů — `td_add_tag_to_task` na sdílený úkol nefunguje.

### Šablony úkolů

| Nástroj | Popis |
|---------|-------|
| `td_list_task_templates` | Seznam šablon úkolů |
| `td_create_task_template` | Vytvoření šablony |
| `td_update_task_template` | Aktualizace šablony |
| `td_delete_task_template` | Smazání šablony (soft delete) |

### Kanban sloupce

| Nástroj | Popis |
|---------|-------|
| `td_list_kanban_columns` | Seznam kanban sloupců |
| `td_create_kanban_column` | Vytvoření sloupce |
| `td_update_kanban_column` | Aktualizace sloupce |
| `td_delete_kanban_column` | Smazání sloupce (soft delete) |

### Uložená zobrazení

| Nástroj | Popis |
|---------|-------|
| `td_list_saved_views` | Seznam uložených zobrazení |
| `td_create_saved_view` | Vytvoření zobrazení |
| `td_update_saved_view` | Aktualizace zobrazení |
| `td_delete_saved_view` | Smazání zobrazení (soft delete) |

### Aktivita

| Nástroj | Popis |
|---------|-------|
| `td_list_activity_log` | Seznam zápisů aktivity s filtry (úkol, aktor, akce, typ entity, datum od/do) — read-only |

### Poznámky k projektu

| Nástroj | Popis |
|---------|-------|
| `td_list_project_notes` | Seznam lokálních poznámek projektu |
| `td_create_project_note` | Vytvoření lokální poznámky |
| `td_update_project_note` | Aktualizace lokální poznámky |
| `td_delete_project_note` | Smazání lokální poznámky (soft delete) |

### Deployment stages

| Nástroj | Popis |
|---------|-------|
| `td_list_deployment_stages` | Seznam deployment stages pro projekt |
| `td_create_deployment_stage` | Vytvoření deployment stage |
| `td_update_deployment_stage` | Aktualizace deployment stage |
| `td_delete_deployment_stage` | Smazání deployment stage (soft delete) |

### Repository linky

| Nástroj | Popis |
|---------|-------|
| `td_list_repository_links` | Seznam repozitářových linků |
| `td_create_repository_link` | Vytvoření repozitářového linku |
| `td_update_repository_link` | Aktualizace repozitářového linku |
| `td_delete_repository_link` | Smazání repozitářového linku |

### Sdílené projekty

| Nástroj | Popis |
|---------|-------|
| `td_list_shared_projects` | Seznam sdílených projektů |
| `td_list_shared_tasks` | Seznam úkolů ze sdíleného projektu |
| `td_create_shared_task` | Vytvoření úkolu ve sdíleném projektu (auto-generovaný kód) |
| `td_update_shared_task` | Aktualizace úkolu ve sdíleném projektu (všechna pole včetně recurrence, estimate, blocking) |
| `td_delete_shared_task` | Smazání úkolu ve sdíleném projektu (soft delete, kaskáda na checklist) |
| `td_update_shared_project` | Aktualizace metadat sdíleného projektu (archivace / skrytí z filtrů) |
| `td_list_shared_worklogs` | Seznam worklogů úkolu ve sdíleném projektu |
| `td_add_shared_worklog` | Přidání worklogu k úkolu ve sdíleném projektu |
| `td_delete_shared_worklog` | Smazání worklogu ve sdíleném projektu |
| `td_list_shared_checklist_items` | Seznam položek checklistu úkolu ve sdíleném projektu |
| `td_create_shared_checklist_item` | Přidání položky checklistu ve sdíleném projektu |
| `td_update_shared_checklist_item` | Aktualizace položky checklistu ve sdíleném projektu |
| `td_delete_shared_checklist_item` | Smazání položky checklistu ve sdíleném projektu |
| `td_list_shared_task_comments` | Seznam komentářů úkolu ve sdíleném projektu |
| `td_create_shared_task_comment` | Přidání komentáře k úkolu ve sdíleném projektu |
| `td_update_shared_task_comment` | Aktualizace komentáře ve sdíleném projektu |
| `td_delete_shared_task_comment` | Smazání komentáře ve sdíleném projektu |
| `td_upload_shared_attachment` | Nahrání přílohy k úkolu ve sdíleném projektu |
| `td_list_shared_attachments` | Seznam příloh úkolu ve sdíleném projektu |
| `td_download_shared_attachment` | Stažení přílohy úkolu sdíleného projektu |
| `td_delete_shared_attachment` | Smazání přílohy úkolu sdíleného projektu |
| `td_list_shared_deployment_stages` | Seznam deployment stages pro sdílený projekt |
| `td_create_shared_deployment_stage` | Vytvoření deployment stage ve sdíleném projektu |
| `td_update_shared_deployment_stage` | Aktualizace deployment stage ve sdíleném projektu |
| `td_delete_shared_deployment_stage` | Smazání deployment stage ve sdíleném projektu |
| `td_list_shared_repository_links` | Seznam repozitářových linků sdíleného projektu |
| `td_create_shared_repository_link` | Vytvoření repozitářového linku ve sdíleném projektu |
| `td_update_shared_repository_link` | Aktualizace repozitářového linku ve sdíleném projektu |
| `td_delete_shared_repository_link` | Smazání repozitářového linku ve sdíleném projektu |
| `td_list_shared_project_notes` | Seznam poznámek sdíleného projektu |
| `td_create_shared_project_note` | Vytvoření poznámky ve sdíleném projektu |
| `td_update_shared_project_note` | Aktualizace poznámky ve sdíleném projektu |
| `td_delete_shared_project_note` | Smazání poznámky ve sdíleném projektu |
| `td_list_shared_members` | Seznam členů sdíleného projektu (jméno, oprávnění, kicked/blocked stav) |
| `td_update_shared_member` | Změna oprávnění / block / kick člena sdíleného projektu |
| `td_upload_shared_note_attachment` | Nahrání přílohy k poznámce sdíleného projektu |
| `td_list_shared_note_attachments` | Seznam příloh poznámky sdíleného projektu |
| `td_download_shared_note_attachment` | Stažení přílohy poznámky sdíleného projektu |
| `td_delete_shared_note_attachment` | Smazání přílohy poznámky sdíleného projektu |

### Analytika a přehledy

| Nástroj | Popis |
|---------|-------|
| `td_get_dashboard_summary` | Přehled: úkoly dnes, po termínu, odpracováno tento týden, nadcházející deadline |
| `td_get_team_workload` | Vytížení týmu: odpracováno vs odhad vs kapacita per uživatel za období |
| `td_list_recurring_tasks` | Seznam opakujících se úkolů s konfigurací opakování |
| `td_list_overdue_tasks` | Úkoly po termínu (seřazené od nejstaršího) |
| `td_list_tasks_by_date_range` | Úkoly filtrované podle scheduledDate nebo deadline v daném rozmezí |
| `td_analyze_dependencies` | Analýza závislostí: blokované úkoly, blokující řetězce, kritická cesta |

### Diagnostika

| Nástroj | Popis |
|---------|-------|
| `td_sync_status` | Stav synchronizace |
| `td_force_sync` | Vynutí sync round-trip s relayem (užitečné, když chceš mít jistotu, že vidíš nejnovější data z jiného zařízení) |

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
Vytvoř úkol s deadline na 2026-03-15 a scheduledDate na 2026-03-10
```

### Aktualizace úkolu
```
Označ úkol PROJ-5 jako dokončený
Přiřaď úkol TODO-10 uživateli s ID xyz
Nastav scheduledDate úkolu TODO-10 na zítra
```

### Logování času
```
Zaloguj 2 hodiny práce na úkol TODO-15 s popisem "Implementace feature"
```

### Práce s přílohami
```
Nahraj soubor /home/user/report.pdf jako přílohu k úkolu TODO-15
Jaké přílohy má úkol TODO-15?
Smaž přílohu s ID xyz
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

### Sub-úkoly
```
Vytvoř sub-úkol k úkolu TODO-15 v projektu TODO
Odpoj úkol TODO-20 od rodičovského úkolu (parentTaskId: null)
```

### Přehledy a analytika
```
Jaký mám dnes přehled? (dashboard summary)
Jak je vytížený tým tento týden?
Jaké úkoly jsou po termínu?
Zobraz úkoly naplánované na příští týden
Analyzuj závislosti v projektu TODO
Jaké mám opakující se úkoly?
```

## Linux CLI (`todo`) (TODO-160)

Vedle MCP serveru je v balíčku i CLI `todo` pro rychlé osobní ovládání z terminálu — sdílí stejnou databázi i `TODOCKO_MNEMONIC` jako MCP. Po `npm link` (nebo globální instalaci) je dostupné jako `todo`.

📖 **Podrobný návod: [CLI.md](CLI.md)**

```bash
# Přidání úkolu (bez -p použije první projekt)
todo add "Opravit login"
todo add "Opravit login" -p TODO --priority high --scheduled today

# Změna stavu (identifikace kódem úkolu)
todo done TODO-160          # status=done
todo start TODO-160         # status=in_progress
todo mv TODO-160 review     # backlog|todo|in_progress|review|done

# Worklog
todo log TODO-160 1h30m "ladění OAuth"
todo worklogs TODO-160      # tabulka worklogů

# Strojový výstup na všech příkazech
todo add "X" --json
```

- **Architektura:** `src/cli.ts` (commander) → mapuje argumenty na existující tool handlery (`handleToolCall`), žádná duplicitní business logika. Kód úkolu se překládá na ID přes `td_get_task`.
- **Sync:** po mutaci čeká ~3 s na relay; když je offline, vypíše `⚠ uloženo lokálně` a skončí s kódem 0 (data jsou lokálně bezpečně).
- **Exit kódy:** `0` úspěch, `1` user/business chyba (neznámý kód, špatný stav/čas), `2` config (chybí mnemonic).
- **Barvy** jen v TTY a při nenastaveném `NO_COLOR`.
- **Pozn.:** běží jako samostatný proces nad stejnou SQLite DB jako MCP; při souběžném zápisu s MCP může (vzácně) nastat `SQLITE_BUSY` — v takovém případě příkaz zopakuj. Mimo rozsah v1: `list`/`today`, editace popisu, projekty/tagy/checklist, sdílené projekty.

## Bezpečnost

**Důležité:** Vaše zálohovací fráze (mnemonic) je citlivý údaj!

- Nikdy ji nesdílejte v přímé konverzaci s AI
- V konfiguraci MCP serveru je fráze bezpečná (AI k ní nemá přístup)
- Kdokoli s vaší frází má plný přístup k vašim datům

### WebSocket Origin (TODO-169)

MCP server při WebSocket připojení k relay posílá hlavičku `Origin: https://todocko-mcp`. Sdílený relay (`relay.todocko.cz`) má tuto hodnotu povolenou ve whitelistu Access Control. Pokud používáš vlastní relay, musíš ji přidat do `tiers.json.allowedDomains`, jinak relay odmítne připojení s `403 Forbidden` na WS upgrade.

## Umístění dat

Databáze jsou uloženy v adresáři `~/.todocko/`:

| Platforma | Cesta |
|-----------|-------|
| Linux | `~/.todocko/` |
| macOS | `~/.todocko/` |
| Windows | `C:\Users\<user>\.todocko\` |

Soubory:
- `todocko.db` - vaše osobní data (úkoly, projekty)
- `todocko-shared.db` - sdílené projekty

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
# Linux/macOS
rm ~/.todocko/todocko.db

# Windows
del %USERPROFILE%\.todocko\todocko.db
```

Databáze obsahuje ID vlastníka z předchozího mnemonicu. Po smazání se při dalším spuštění vytvoří nová databáze a stáhnou se data nového účtu.

## Troubleshooting

### Server se nespustí
- Zkontrolujte, že máte Node.js 22+
- Zkontrolujte, že jste spustili `npm run build`
- Zkontrolujte logy v Claude Desktop

### Data se nesynchronizují
- Ověřte, že je zálohovací fráze správná (24 slov)
- Zkontrolujte internetové připojení
- Počkejte pár sekund na synchronizaci
- Zkuste smazat `~/.todocko/todocko.db` a restartovat

### Nástroje nejsou viditelné
- Restartujte Claude Desktop
- V Claude Code použijte `/mcp` pro reload
- Zkontrolujte konfigurační soubor
- Zkontrolujte cestu k dist/index.js

### Každý `loadQuery` skončí timeoutem (`loadQuery timed out after 15000ms`)
Příčina: `better-sqlite3` native binding byl zkompilován proti jiné Node.js ABI verzi, než pod kterou MCP server běží. `new Database()` selže s `ERR_DLOPEN_FAILED`, Evolu dbWorker init nikdy nedoběhne a všechny `loadQuery` volání visí navždy. Mutace (insert/update) reportují success, ale ve skutečnosti se nezapíšou.

Symptom v praxi: `td_sync_status` hlásí `ok`, `errorCount: 0`, ale `td_get_task`, `td_list_*` apod. timeoutují.

Fix — přebuildit native binding proti aktuálnímu Node:
```bash
cd ~/.todocko-mcp # případně cesta, kde máš nainstalované todocko-mcp
cd node_modules/better-sqlite3
npx node-gyp rebuild --release
```
Pak `/mcp` reconnect v Claude Code.

Mismatch je typický, pokud upgradneš Node.js (např. z v22 na v25) nebo přepneš mezi nvm a linuxbrew/brew Node. Při instalaci installer použije `node` z `PATH` — pokud `claude` později spouští MCP přes jiný node binary, binding nesedí.

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

- **Node.js 22+** (Evolu uses `Set.prototype.difference`, available from Node 22)
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

## Available Tools (109)

### Projects

| Tool | Description |
|------|-------------|
| `td_list_projects` | List all projects |
| `td_get_project` | Get project details by ID or code |
| `td_create_project` | Create a new project |
| `td_update_project` | Update a project (name, code, color, isArchived, autoApproveMembers, isHiddenFromFilters) |
| `td_delete_project` | Delete a project (soft delete) |

### Tasks

| Tool | Description |
|------|-------------|
| `td_list_tasks` | List tasks with filters (project, status, priority, assignee) |
| `td_get_task` | Get task details by ID or code (e.g., `PROJ-123`) |
| `td_create_task` | Create a new task (with recurrence, sprint, parentTaskId support) |
| `td_update_task` | Update an existing task (with recurrence, sprint, parentTaskId support) |
| `td_search_tasks` | Search tasks by text |
| `td_bulk_update_tasks` | Bulk update multiple tasks |
| `td_bulk_delete_tasks` | Bulk delete multiple tasks |

### Users

| Tool | Description |
|------|-------------|
| `td_list_users` | List all users |
| `td_get_user` | Get user details |
| `td_create_user` | Create a new user |
| `td_update_user` | Update a user |
| `td_delete_user` | Delete a user (soft delete) |

### Worklogs

| Tool | Description |
|------|-------------|
| `td_list_worklogs` | List worklogs for a task |
| `td_add_worklog` | Add a worklog to a task |
| `td_update_worklog` | Update a worklog |
| `td_delete_worklog` | Delete a worklog (soft delete) |

### Attachments

| Tool | Description |
|------|-------------|
| `td_upload_attachment` | Upload an attachment to a task (from file or base64) |
| `td_list_attachments` | List attachments for a task |
| `td_download_attachment` | Download an attachment |
| `td_delete_attachment` | Delete an attachment |
| `td_upload_note_attachment` | Upload an attachment to a local project note |
| `td_list_note_attachments` | List attachments of a local note |
| `td_download_note_attachment` | Download a note attachment |
| `td_delete_note_attachment` | Delete a note attachment |

### Comments

| Tool | Description |
|------|-------------|
| `td_list_task_comments` | List comments for a task |
| `td_create_task_comment` | Add a comment to a task |
| `td_update_task_comment` | Update a comment |
| `td_delete_task_comment` | Delete a comment (soft delete) |

### Checklist

| Tool | Description |
|------|-------------|
| `td_list_checklist_items` | List checklist items for a task |
| `td_create_checklist_item` | Add a checklist item |
| `td_update_checklist_item` | Update a checklist item (check, reposition) |
| `td_delete_checklist_item` | Delete a checklist item (soft delete) |

### Mentions

| Tool | Description |
|------|-------------|
| `td_list_mentions` | List mentions for a user |
| `td_create_mention` | Create a mention |
| `td_mark_mention_read` | Mark a mention as read |
| `td_mark_all_mentions_read` | Mark all mentions as read |
| `td_delete_mention` | Delete a mention (soft delete) |

### Task Links

| Tool | Description |
|------|-------------|
| `td_list_task_links` | List links for a task |
| `td_create_task_link` | Create a link between tasks |
| `td_delete_task_link` | Delete a task link (soft delete) |

### Tags

| Tool | Description |
|------|-------------|
| `td_list_tags` | List tags; returns `projectId`, filters by project or unassigned |
| `td_create_tag` | Create a tag — **pass `projectId`**, see the note below |
| `td_update_tag` | Rename, recolour, assign to a project, or mark default |
| `td_delete_tag` | Delete a tag (soft delete) |
| `td_list_task_tags` | List tags assigned to a task |
| `td_add_tag_to_task` | Assign a tag to a task |
| `td_remove_tag_from_task` | Remove a tag from a task |

Shared projects (TODO-235):

| Tool | Description |
|------|-------------|
| `td_list_shared_tags` | Tags in a shared project |
| `td_create_shared_tag` | Create a tag in a shared project |
| `td_update_shared_tag` | Rename / recolour |
| `td_delete_shared_tag` | Delete (soft delete) |
| `td_add_shared_tag_to_task` | Assign to a task in a shared project |
| `td_remove_shared_tag_from_task` | Remove from a task |

> **A tag without a project is never offered by the app.** Since TODO-227 tags
> belong to a project; `td_create_tag` without `projectId` makes an **unassigned**
> tag, which shows up only under "Nezařazené" in project settings with a button to
> adopt it. The tool response says so. Fix it afterwards with `td_update_tag` and
> a `projectId`.
>
> **Default tags (TODO-239).** `isDefault` on `td_create_tag` / `td_update_tag`
> (and the shared variants) means every task newly created in the project gets the
> tag. Both `td_create_task` and `td_create_shared_task` apply them and report them
> back in `appliedTags` — the app pre-ticks them in its form, so without this the
> result would depend on where the task was created. Existing tasks are untouched.
>
> Shared projects write to a **different Evolu instance**, hence the separate set
> — `td_add_tag_to_task` does not work on a shared task.

### Task Templates

| Tool | Description |
|------|-------------|
| `td_list_task_templates` | List task templates |
| `td_create_task_template` | Create a task template |
| `td_update_task_template` | Update a task template |
| `td_delete_task_template` | Delete a task template (soft delete) |

### Kanban Columns

| Tool | Description |
|------|-------------|
| `td_list_kanban_columns` | List kanban columns |
| `td_create_kanban_column` | Create a kanban column |
| `td_update_kanban_column` | Update a kanban column |
| `td_delete_kanban_column` | Delete a kanban column (soft delete) |

### Saved Views

| Tool | Description |
|------|-------------|
| `td_list_saved_views` | List saved views |
| `td_create_saved_view` | Create a saved view |
| `td_update_saved_view` | Update a saved view |
| `td_delete_saved_view` | Delete a saved view (soft delete) |

### Activity Log

| Tool | Description |
|------|-------------|
| `td_list_activity_log` | List activity log entries with filters (task, actor, action, entityType, date from/to) — read-only |

### Project Notes

| Tool | Description |
|------|-------------|
| `td_list_project_notes` | List local project notes |
| `td_create_project_note` | Create a local project note |
| `td_update_project_note` | Update a local project note |
| `td_delete_project_note` | Delete a local project note (soft delete) |

### Deployment Stages

| Tool | Description |
|------|-------------|
| `td_list_deployment_stages` | List deployment stages for a project |

### Repository Links

| Tool | Description |
|------|-------------|
| `td_list_repository_links` | List repository links |
| `td_create_repository_link` | Create a repository link |
| `td_delete_repository_link` | Delete a repository link |

### Shared Projects

| Tool | Description |
|------|-------------|
| `td_list_shared_projects` | List shared projects |
| `td_list_shared_tasks` | List tasks from a shared project |
| `td_update_shared_task` | Update a task in a shared project |
| `td_list_shared_deployment_stages` | List deployment stages for a shared project |
| `td_create_shared_deployment_stage` | Create a deployment stage in a shared project |
| `td_list_shared_repository_links` | List repository links for a shared project |
| `td_create_shared_repository_link` | Create a repository link in a shared project |
| `td_list_shared_project_notes` | List notes for a shared project |
| `td_create_shared_project_note` | Create a note in a shared project |
| `td_update_shared_project_note` | Update a note in a shared project |
| `td_delete_shared_project_note` | Delete a note in a shared project |
| `td_list_shared_members` | List members of a shared project (name, permission, kicked/blocked state) |
| `td_update_shared_member` | Change permission / block / kick a shared project member |
| `td_upload_shared_note_attachment` | Upload an attachment to a shared project note |
| `td_list_shared_note_attachments` | List attachments of a shared project note |
| `td_download_shared_note_attachment` | Download a shared note attachment |
| `td_delete_shared_note_attachment` | Delete a shared note attachment |

### Analytics & Reports

| Tool | Description |
|------|-------------|
| `td_get_dashboard_summary` | Overview: tasks today, overdue, this week's worklog, upcoming deadlines |
| `td_get_team_workload` | Team workload: logged vs estimate vs capacity per user for a period |
| `td_list_recurring_tasks` | List recurring tasks with recurrence configuration |
| `td_list_overdue_tasks` | Overdue tasks (sorted oldest first) |
| `td_list_tasks_by_date_range` | Tasks filtered by scheduledDate or deadline within a date range |
| `td_analyze_dependencies` | Dependency analysis: blocked tasks, blocking chains, critical path |

### Diagnostics

| Tool | Description |
|------|-------------|
| `td_sync_status` | Sync status |
| `td_force_sync` | Force a sync round-trip with the relay (useful when you want to make sure you're reading the latest data from another device) |

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
Create a task with deadline 2026-03-15 and scheduledDate 2026-03-10
```

### Update task
```
Mark task PROJ-5 as completed
Assign task TODO-10 to user with ID xyz
Set scheduledDate of task TODO-10 to tomorrow
```

### Log time
```
Log 2 hours of work on task TODO-15 with description "Feature implementation"
```

### Working with attachments
```
Upload file /home/user/report.pdf as attachment to task TODO-15
What attachments does task TODO-15 have?
Delete attachment with ID xyz
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

### Sub-tasks
```
Create a sub-task for task TODO-15 in project TODO
Detach task TODO-20 from its parent (parentTaskId: null)
```

### Analytics & Reports
```
What's my dashboard summary for today?
How is the team's workload this week?
What tasks are overdue?
Show tasks scheduled for next week
Analyze dependencies in project TODO
What recurring tasks do I have?
```

## Security

**Important:** Your backup phrase (mnemonic) is sensitive data!

- Never share it directly in conversation with AI
- In the MCP server configuration, the phrase is safe (AI has no access to it)
- Anyone with your phrase has full access to your data

## Data Location

Databases are stored in the `~/.todocko/` directory:

| Platform | Path |
|----------|------|
| Linux | `~/.todocko/` |
| macOS | `~/.todocko/` |
| Windows | `C:\Users\<user>\.todocko\` |

Files:
- `todocko.db` - your personal data (tasks, projects)
- `todocko-shared.db` - shared projects

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
# Linux/macOS
rm ~/.todocko/todocko.db

# Windows
del %USERPROFILE%\.todocko\todocko.db
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
- Try deleting `~/.todocko/todocko.db` and restart

### Tools not visible
- Restart Claude Desktop
- In Claude Code, use `/mcp` for reload
- Check the configuration file
- Check the path to dist/index.js

### Every `loadQuery` ends with a timeout (`loadQuery timed out after 15000ms`)
Cause: the `better-sqlite3` native binding was compiled against a different Node.js ABI than the one running the MCP server. `new Database()` fails with `ERR_DLOPEN_FAILED`, the Evolu dbWorker init never completes, and every `loadQuery` hangs forever. Mutations (insert/update) report success but are silently lost.

Typical symptoms: `td_sync_status` reports `ok` with `errorCount: 0`, but `td_get_task`, `td_list_*`, etc. all time out.

Fix — rebuild the native binding against the current Node:
```bash
cd ~/.todocko-mcp # or wherever todocko-mcp is installed
cd node_modules/better-sqlite3
npx node-gyp rebuild --release
```
Then `/mcp` reconnect in Claude Code.

This mismatch typically appears after upgrading Node.js (e.g. v22 → v25) or switching between nvm and linuxbrew/brew Node, because the installer builds the binding against the `node` from `PATH`, but `claude` may later spawn the MCP with a different node binary.

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode for development
npm run dev

# Tests
npm test

# Manual run
TODOCKO_MNEMONIC="your phrase" npm start
```

### Testy

Vitest, 24 testů ve dvou souborech. **Běží v CI** (`ci.yml`, push i PR na `main`)
od TODO-229 — do té doby CI spouštěla jen build, takže se nikdo nedozvěděl, že
`helpers.test.ts` na Node 18/20 **ani neprojde importem**: přes `helpers.ts`
tahal `../evolu.js`, jehož inicializace při načtení modulu spadne na
`crypto.getRandomValues must be defined`.

Proto jsou funkce bez závislosti na Evolu v **`src/tools/pure.ts`** a testují se
odtud. `helpers.ts` je re-exportuje, takže volající se nemění. Když píšeš helper,
který Evolu nepotřebuje, patří do `pure.ts` — jinak ho nejde testovat bez
nastartované databáze.

Testy tak procházejí na Node 18, 20 i 22. Závazná verze pro MCP je **22** (na té
jede `ci.yml` i `release.yml`).
