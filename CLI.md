# `todo` – Todocko CLI

Linuxové CLI pro rychlé osobní ovládání Todocko z terminálu – přidat úkol,
změnit stav, zalogovat čas – bez otevírání webové appky kvůli drobnostem.

Je součástí balíčku `todocko-mcp` a **sdílí stejnou databázi i `TODOCKO_MNEMONIC`
jako MCP server** – žádná samostatná konfigurace.

## Instalace

```bash
npm install -g todocko-mcp
```

Tím je `todo` v `PATH`. Ze zdrojových kódů to jde pořád taky:

```bash
cd todocko-mcp
npm install        # jednou
npm run build      # zkompiluje dist/
npm link           # globální příkaz todo (symlink na dist/cli.js)
```

Mnemonic se bere z prostředí (stejná 24slovná fráze jako MCP):

```bash
export TODOCKO_MNEMONIC="slovo slovo … (24 slov)"
```

Tip: přidej `export TODOCKO_MNEMONIC=…` do `~/.bashrc`/`~/.zshrc` (soubor jen pro
tebe, `chmod 600`), ať ho nemusíš zadávat pokaždé.

Bez `npm link` lze volat přímo: `node dist/cli.js <příkaz>`.

## Příkazy

### `todo list [volby]`

Výpis úkolů. Bez voleb skryje hotové a opakované, protože to není práce, která
tě čeká.

```bash
todo list
todo list -p TODO                 # jen jeden projekt
todo list --status review
todo list --all --limit 20        # včetně hotových
todo list --no-shared             # vynechat sdílené projekty (rychlejší)
```

Řadí se podle termínu, pak podle priority, pak podle kódu. Úkol bez termínu jde
až za ty s termínem: datum je závazek, priorita názor. Termín v minulosti je
červeně, sdílený projekt má u kódu hvězdičku.

### `todo today`

Co je na dnešek. Spojuje čtyři věci a u každého úkolu říká, proč tam je:

| důvod | znamená |
| --- | --- |
| `po termínu` | termín už uplynul a úkol není hotový |
| `termín dnes` | termín je dnes |
| `naplánováno` | `scheduledDate` je dnes nebo dřív |
| `dělá se` | stav `in_progress`, bez ohledu na data |

```bash
todo today
todo today -p TODO
```

Po termínu je vždycky nahoře, protože je to jediná skupina, kde čekání už něco
stálo. Hotový úkol se neobjeví, ať je jeho termín jakkoliv starý.

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
todo mv TODO-184 review # backlog | todo | in_progress | review | done | recurring
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
- `--json` – strojový JSON výstup (na všech příkazech).
- `--version`, `--help` (a `todo help <příkaz>`).

```bash
todo add "X" -p TODO --json
todo worklogs TODO-184 --json
```

## Chování

**Sync.** Po každé změně CLI počká ~3 s na sync s relay serverem. Když je relay
nedostupný (offline), vypíše `⚠ uloženo lokálně, sync na relay se nepovedl
(offline?)` a skončí úspěšně – data jsou lokálně bezpečně uložená a dosyncují se
při příštím připojení.

**Exit kódy.**
| Kód | Význam |
|-----|--------|
| `0` | úspěch |
| `1` | uživatelská/business chyba (neznámý kód úkolu, špatný stav, neplatný čas) |
| `2` | konfigurační chyba (chybí `TODOCKO_MNEMONIC`) |

Chyby jdou na `stderr`, data na `stdout` – lze bezpečně pipovat (`todo … --json | jq`).

**Barvy.** Jen v interaktivním terminálu (TTY) a při nenastaveném `NO_COLOR`.

## Omezení (v1)

- Sdílí SQLite soubor s běžícím MCP serverem. Při souběžném zápisu může (vzácně)
  nastat `SQLITE_BUSY` – v takovém případě příkaz zopakuj.
- Mimo rozsah: editace popisu úkolu, projekty, štítky, checklist, komentáře,
  přílohy, dokumentace a daemon režim. Zápis do sdílených projektů taky ne,
  `list` a `today` je jen čtou.
- Parita s MCP (161 nástrojů) se nechystá. Většina z nich dává smysl jen jako
  nástroj pro AI a 161 příkazů v terminálu nikdo nechce.

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
    select.ts             co se vypíše a v jakém pořadí (bez Evolu, testovatelné)
    commands/
      add.ts  status.ts  worklog.ts  list.ts
```

Testy: `npm test` (vitest). Čisté helpery (duration, datum, stav, tabulka,
výběr úkolů) se testují přímo, `list.ts` proti zamockovanému `handleToolCall`,
protože ten skutečný by při načtení modulu nastartoval databázi.
