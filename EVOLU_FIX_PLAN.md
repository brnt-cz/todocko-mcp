# Plán opravy Evolu integrace pro Node.js MCP

## ✅ VYŘEŠENO (2026-02-02)

Oprava implementována v `src/evolu.ts`.

## Problém

MCP server selhával při startu s chybou:
```
Worker not supported in Node.js MCP context
```

Příčina: V `src/evolu.ts` byl placeholder pro `createDbWorker`, který házel error místo vytvoření funkčního workeru.

## Řešení

### 1. WebSocket polyfill pro Node.js

```typescript
import WebSocket from "ws";
globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;
```

### 2. Import potřebných funkcí z Evolu

```typescript
import { createEvolu } from "@evolu/common/local-first";
import {
  createDbWorkerForPlatform,
  type DbWorkerPlatformDeps,
} from "@evolu/common/local-first";
import { createBetterSqliteDriver } from "@evolu/nodejs";
import {
  createConsole,
  createRandomBytes,
  createRandom,
  createTime,
  createWebSocket,
  SimpleName,
  Mnemonic,
} from "@evolu/common";
```

### 3. Platform dependencies pro Node.js

```typescript
function createNodejsPlatformDeps(): DbWorkerPlatformDeps {
  return {
    console: createConsole({ enableLogging: true }),
    createSqliteDriver: createBetterSqliteDriver,
    createWebSocket: createWebSocket,
    randomBytes: createRandomBytes(),
    random: createRandom(),
    time: createTime(),
  };
}
```

### 4. Použití createDbWorkerForPlatform

```typescript
const platformDeps = createNodejsPlatformDeps();

const createDbWorker = (_name: SimpleName) => {
  return createDbWorkerForPlatform(platformDeps);
};

const evoluDeps = {
  console: platformDeps.console,
  createDbWorker,
  randomBytes: platformDeps.randomBytes,
  reloadApp: () => {
    console.log("reloadApp called (no-op in MCP)");
  },
  time: platformDeps.time,
};

evoluInstance = createEvolu(evoluDeps)(Schema, {
  name: SimpleName.orThrow("todocko"),
  transports: RELAY_SERVERS.map(url => ({ type: "WebSocket" as const, url })),
  enableLogging: true,
});
```

### 5. Restore owner z mnemonicu

```typescript
const mnemonicResult = Mnemonic.from(mnemonic.trim());
if (!mnemonicResult.ok) {
  throw new Error("Invalid BIP39 mnemonic phrase");
}
await evoluInstance.restoreAppOwner(mnemonicResult.value);
```

## Poznámky

- `@evolu/nodejs` vyžaduje Node.js >= 22.0.0 (viz package.json)
- `ws` knihovna je již v dependencies přes `@evolu/nodejs`
- ✅ Mnemonic je nyní použitý pro `restoreAppOwner`

## Testování

```bash
cd /www/brnt/todocko-mcp
npm run build
TODOCKO_MNEMONIC="your 24 word mnemonic phrase here" node dist/index.js
```

Server se připojí ke všem relay serverům a začne synchronizovat data.
