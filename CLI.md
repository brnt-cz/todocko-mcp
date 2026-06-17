# `todo` — Todocko CLI

Linuxové CLI pro rychlé osobní ovládání Todocko z terminálu — přidat úkol,
změnit stav, zalogovat čas — bez otevírání webové appky kvůli drobnostem.

Je součástí balíčku `todocko-mcp` a **sdílí stejnou databázi i `TODOCKO_MNEMONIC`
jako MCP server** — žádná samostatná konfigurace.

## Instalace

```bash
cd todocko-mcp
npm install        # jednou
npm run build      # zkompiluje dist/

# Globální příkaz `todo` (symlink na dist/cli.js):
npm link
```

Mnemonic se bere z prostředí (stejná 24slovná fráze jako MCP):

```bash
export TODOCKO_MNEMONIC="slovo slovo … (24 slov)"
```

Tip: přidej `export TODOCKO_MNEMONIC=…` do `~/.bashrc`/`~/.zshrc` (soubor jen pro
tebe, `chmod 600`), ať ho nemusíš zadávat pokaždé.

Bez `npm link` lze volat přímo: `node dist/cli.js <příkaz>`.

## Příkazy

### `todo add <název> [volby]`
Přidá úkol. Bez `-p` použije první projekt.

| Volba | Popis |
|-------|-------|
| `-p, --project <kód>` | projekt podle kódu (např. `TODO`) |
| `--priority <p>` | `low` \| `medium` \| `high` \| `urgent` |
| `--deadline <datum>` | `YYYY-MM-DD` |
| `--scheduled <datum>` | `today` \| `tomorrow` \| `YYYY-MM-DD` |

```bash
todo add "Opravit login"
todo add "Opravit login" -p TODO --priority high
todo add "Zavolat účetní" --scheduled tomorrow
#  → ✓ vytvořeno TODO-184  "Opravit login"
```

### Změna stavu
```bash
todo done TODO-184      # → status=done
todo start TODO-184     # → status=in_progress
todo mv TODO-184 review # backlog | todo | in_progress | review | done
#  → ✓ TODO-184  todo → done
```
Úkol se identifikuje **kódem** (`TODO-184`); CLI si ho přeloží na ID.
`mv` bere i přátelské aliasy: `in-progress`, `inprogress`, `wip` → `in_progress`.

### Worklog
```bash
todo log TODO-184 1h30m "ladění OAuth"
todo log TODO-184 45m
todo log TODO-184 90            # bez jednotky = minuty
#  → ✓ zalogováno 1h 30m k TODO-184  (celkem 4h 0m)

todo worklogs TODO-184          # zarovnaná tabulka worklogů
```

### Globální volby
- `--json` — strojový JSON výstup (na všech příkazech).
- `--version`, `--help` (a `todo help <příkaz>`).

```bash
todo add "X" -p TODO --json
todo worklogs TODO-184 --json
```

## Chování

**Sync.** Po každé změně CLI počká ~3 s na sync s relay serverem. Když je relay
nedostupný (offline), vypíše `⚠ uloženo lokálně, sync na relay se nepovedl
(offline?)` a skončí úspěšně — data jsou lokálně bezpečně uložená a dosyncují se
při příštím připojení.

**Exit kódy.**
| Kód | Význam |
|-----|--------|
| `0` | úspěch |
| `1` | uživatelská/business chyba (neznámý kód úkolu, špatný stav, neplatný čas) |
| `2` | konfigurační chyba (chybí `TODOCKO_MNEMONIC`) |

Chyby jdou na `stderr`, data na `stdout` — lze bezpečně pipovat (`todo … --json | jq`).

**Barvy.** Jen v interaktivním terminálu (TTY) a při nenastaveném `NO_COLOR`.

## Omezení (v1)

- Sdílí SQLite soubor s běžícím MCP serverem. Při souběžném zápisu může (vzácně)
  nastat `SQLITE_BUSY` — v takovém případě příkaz zopakuj.
- Mimo rozsah: `list`/`today`, editace popisu úkolu, projekty/tagy/checklist,
  sdílené projekty, daemon režim. Přidá se, až bude potřeba.

## Architektura

`src/cli.ts` (commander) → mapuje argumenty na **existující MCP tool handlery**
(`handleToolCall`), žádná duplicitní business logika. Generování kódu úkolu i
podpora sdílených úkolů tak fungují stejně jako přes MCP.

```
src/
  cli.ts                  entrypoint (commander)
  cli/
    bootstrap.ts          initEvolu + waitForEvolu + waitForSync
    resolve.ts            kód úkolu → ID (přes td_get_task)
    duration.ts           "1h30m" → minuty
    dates.ts              today/tomorrow/YYYY-MM-DD → YYYY-MM-DD
    status.ts             validace/normalizace stavu
    format.ts             tabulky / barvy / ✓⚠✗
    commands/
      add.ts  status.ts  worklog.ts
```

Testy: `npm test` (vitest) — unit testy čistých helperů (duration, datum, stav,
tabulka).
