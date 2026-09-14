/**
 * Evolu platform layer for Node.js (TODO-88, Evolu v8).
 *
 * v7 shipped `createDbWorkerForPlatform`, which was all a headless Node client
 * needed. v8 dropped it: `@evolu/nodejs` v3 provides the relay and a few
 * primitives, and the only complete client platform upstream ships is
 * `@evolu/web`. So this file is the Node counterpart of
 * `@evolu/web`'s `createEvoluDeps`, assembled from the same building blocks.
 *
 * It turns out to be short, because Node 24 has the web APIs v8 relies on —
 * `navigator.locks`, `MessageChannel`, `BroadcastChannel` and `WebSocket` are
 * all global. That is the actual reason every v8 package declares
 * `engines.node >= 24.20`.
 *
 * The two workers run **in-process**: `createWorker` and `createSharedWorker`
 * are Evolu's own memory-only fallbacks "for platforms without native worker
 * support". A `worker_threads` version would buy isolation the MCP server does
 * not need — it is a single-process CLI serving one user.
 */
/**
 * Evolu v8 uses `Map.prototype.getOrInsertComputed`, which no released Node has
 * (checked on 24.20). Without this, the first task that reaches for a semaphore
 * dies with `getOrInsertComputed is not a function`, surfacing as an uncaught
 * `PanicAbortReason` while `td_sync_status` still cheerfully reports
 * `evoluReady: true`. Installing it here, in the platform layer, guarantees it
 * lands before any deps are constructed.
 */
import { installPolyfills } from "@evolu/common/polyfills";
installPolyfills();

import {
  createConsole,
  createConsoleStoreOutput,
  createMessageChannel,
  createMessagePort,
  createRandomBytes,
  createRun,
  createSharedWorker,
  createWebSocket,
  createWorker,
  waitForAbort,
} from "@evolu/common";
import {
  createEvoluDeps as createCommonEvoluDeps,
  initSharedWorker,
  startDbWorker,
  type DbWorkerInit,
  type EvoluDeps,
  type SharedWorkerInput,
  type SharedWorkerOutput,
} from "@evolu/common/local-first";
import { createBetterSqliteDriver, createBroadcastChannel } from "@evolu/nodejs";

import type { CreateWebSocket, ReportDefect } from "@evolu/common";
import { describeDefect } from "./tools/pure.js";

/**
 * Kdy naposledy něco skutečně odešlo a přišlo po drátě. (TODO-294)
 *
 * Proč zvlášť a proč tady: Evolu v8 klientovi o stavu syncu nic nehlásí — žádný
 * hook, nic v logu. `td_sync_status` proto měřil to jediné, co změřit umělo,
 * tedy že se dá otevřít WebSocket, a hlásil `ok`. To je ale odpověď na jinou
 * otázku: 7. 9. 2026 MCP hodinu neposlalo na relay ani zprávu a tenhle nástroj
 * po celou dobu tvrdil, že je vše v pořádku. Poznat se to dalo jedině zvenčí,
 * na relayi, podle `lastTimestamp` u ownera.
 *
 * `createWebSocket` je injektovatelná závislost (`CreateWebSocketDep`), kterou
 * Evolu konzumuje v `Shared.js` — takže obal kolem ní vidí každý rámec, který
 * opravdu proteče. Nic to nesimuluje a nic neodhaduje.
 *
 * Stav smí ležet v modulu, protože oba "workery" tady běží **in-process** (jsou
 * to Evoluovy memory-only fallbacky, viz hlavička souboru). Ve skutečném
 * `worker_threads` by se sem musela dostat zprávou.
 */
interface SocketTraffic {
  lastOutgoingAt: number | null;
  lastIncomingAt: number | null;
  outgoingCount: number;
  incomingCount: number;
  /**
   * Otevření a zavření spojení. Tohle rozliší dvě věci, které jinak vypadají
   * stejně a mají jinou příčinu: spojení spadlo a nepřipojilo se znovu, versus
   * spojení stojí otevřené a nic se po něm neposílá. Bez toho se TODO-295 nedá
   * vyšetřit, jen hádat.
   */
  openCount: number;
  closeCount: number;
  lastOpenAt: number | null;
  lastCloseAt: number | null;
  lastCloseCode: number | null;
}

const traffic = new Map<string, SocketTraffic>();

function trafficFor(url: string): SocketTraffic {
  let t = traffic.get(url);
  if (!t) {
    t = {
      lastOutgoingAt: null, lastIncomingAt: null, outgoingCount: 0, incomingCount: 0,
      openCount: 0, closeCount: 0, lastOpenAt: null, lastCloseAt: null, lastCloseCode: null,
    };
    traffic.set(url, t);
  }
  return t;
}

/** Obal, který zaznamená každý odeslaný i přijatý rámec. */
const createInstrumentedWebSocket: CreateWebSocket = (url, options) => {
  const t = trafficFor(url);
  const wrappedOptions = {
    ...options,
    onMessage: (data: string | ArrayBuffer | Blob) => {
      t.lastIncomingAt = Date.now();
      t.incomingCount++;
      options?.onMessage?.(data);
    },
    onOpen: () => {
      t.lastOpenAt = Date.now();
      t.openCount++;
      options?.onOpen?.();
    },
    onClose: (event: CloseEvent) => {
      t.lastCloseAt = Date.now();
      t.lastCloseCode = event.code;
      t.closeCount++;
      options?.onClose?.(event);
    },
  };
  // Task<T, E> je (run) => Awaitable<Result<T, E>>, takže obal je taky Task:
  // zavolá původní, a když uspěje, podstrčí socketu vlastní `send`.
  const task = createWebSocket(url, wrappedOptions);
  return async (run) => {
    const result = await task(run);
    if (!result.ok) return result;
    const socket = result.value;
    const originalSend = socket.send.bind(socket);
    socket.send = (data) => {
      // Zaznamenat až po úspěchu: `send` vrací Result a na zavřeném socketu
      // selže. Počítat pokus by vyrobilo další "ok", které nic neznamená —
      // což je přesně vada, kterou tenhle nástroj má odstranit.
      const sendResult = originalSend(data);
      if (sendResult.ok) {
        t.lastOutgoingAt = Date.now();
        t.outgoingCount++;
      }
      return sendResult;
    };
    return result;
  };
};

/**
 * Paniky ("defekty") z běhu workerů. (TODO-317)
 *
 * Oba workery běží in-process a spouštějí se jako `void run(...)`, takže jejich
 * výsledek nikdo nečte. Když Run panikne, Evolu ho pošle do `deps.reportDefect`,
 * jehož výchozí implementace ho vyhodí v microtasku — tedy mimo jakýkoli `try`,
 * který by ho zachytil. Proces běží dál, ale dbWorker je mrtvý: jeho SQLite se
 * zavře a každý další `loadQuery` na té instanci se už nikdy nevyřídí.
 *
 * Přesně tenhle stav byl 11. 9. změřen na živém procesu: otevřená zůstala jen
 * sdílená databáze, osobní ne, a `td_sync_status` to ukázal jako
 * `quarantinedRows.app === null`. Příčina smrti se ale nedala zjistit, protože
 * defekt nikde nezůstal. Tohle ji uchová.
 */
export interface WorkerDefect {
  readonly worker: "dbWorker" | "sharedWorker";
  readonly at: number;
  readonly message: string;
  readonly stack: string | null;
}

const workerDefects: WorkerDefect[] = [];

/** Co zabilo workery, nejstarší první. Čte `td_sync_status`. */
export function getWorkerDefects(): WorkerDefect[] {
  return [...workerDefects];
}

/**
 * Důvod, proč nemá cenu se ptát, nebo `null`.
 *
 * `dbWorker` drží SQLite, takže jeho smrt znamená, že žádný dotaz už nikdy
 * neodpoví. Smrt `sharedWorker` bere sync, ale lokální čtení dál funguje, proto
 * se na ni dotazy neodmítají.
 */
export function getFatalWorkerReason(): string | null {
  const fatal = workerDefects.find((d) => d.worker === "dbWorker");
  if (!fatal) return null;
  return (
    `Evolu dbWorker died at ${new Date(fatal.at).toISOString()} and every query would hang: ` +
    `${fatal.message}. Reconnect the MCP server to get a working one. (TODO-317)`
  );
}

/**
 * `RunCustomDeps` only accepts an override that matches the default's type
 * exactly, so these are typed rather than inlined as arrow literals.
 */
const reportDbWorkerDefect: ReportDefect = (reported) => {
  recordWorkerDefect("dbWorker", reported);
};

const reportSharedWorkerDefect: ReportDefect = (reported) => {
  recordWorkerDefect("sharedWorker", reported);
};

function recordWorkerDefect(worker: WorkerDefect["worker"], error: unknown): void {
  // Not `String(error)`: Evolu reports a `{ type, reason }` envelope, not an
  // Error, and stringifying that gives "[object Object]". (TODO-317)
  const message = describeDefect(error);
  const stack = error instanceof Error ? (error.stack ?? null) : null;
  workerDefects.push({ worker, at: Date.now(), message, stack });
  // Not rethrown: the default reporter throws in a microtask, which is how this
  // fault stayed invisible. Recorded and logged is strictly more than before.
  console.error(`[todocko-mcp] FATAL: Evolu ${worker} defect: ${message}${stack ? `\n${stack}` : ""}`);
}

/** Naměřený provoz po URL. Čte to `td_sync_status`. */
export function getSocketTraffic(): Record<string, SocketTraffic> {
  return Object.fromEntries([...traffic.entries()].map(([url, t]) => [url, { ...t }]));
}

/**
 * Console, message-port and channel plumbing shared by both workers.
 *
 * Mirrors `createWorkerDeps` in `@evolu/web`.
 */
function createWorkerDeps() {
  const consoleStoreOutput = createConsoleStoreOutput();
  return {
    console: createConsole({ output: consoleStoreOutput, level: "warn" as const }),
    consoleStoreOutputEntry: consoleStoreOutput.entry,
    createBroadcastChannel,
    createMessageChannel,
    createMessagePort,
  };
}

/**
 * Evolu dependencies for a headless Node client.
 *
 * Built once per process and reused. The name is the reason: a *shared* worker
 * is meant to be shared, and it keeps a single `tabLeaderPortStore` that every
 * tenant's `initDbWorker` asserts is already populated. Handing each instance
 * its own deps gave us a second shared worker whose store no client had
 * announced a leader to, so creating the shared-project instance died with
 * `initDbWorker: Expected value to be non-nullable`. `@evolu/web` builds its
 * deps once per page for the same reason; one worker then serves both
 * instances as two tenants keyed by `appName`.
 */
let cachedDeps: EvoluDeps | null = null;

export function createNodeEvoluDeps(): EvoluDeps {
  return (cachedDeps ??= buildNodeEvoluDeps());
}

function buildNodeEvoluDeps(): EvoluDeps {
  const createDbWorker = () =>
    createWorker<DbWorkerInit>((self) => {
      const run = createRun({
        ...createWorkerDeps(),
        createSqliteDriver: createBetterSqliteDriver,
        lockManager: navigator.locks,
        randomBytes: createRandomBytes(),
        reportDefect: reportDbWorkerDefect,
      });
      void run(startDbWorker(self));
    });

  const sharedWorker = createSharedWorker<SharedWorkerInput, SharedWorkerOutput>((self) => {
    const run = createRun({
      ...createWorkerDeps(),
      createWebSocket: createInstrumentedWebSocket,
      lockManager: navigator.locks,
      reportDefect: reportSharedWorkerDefect,
    });
    void run(async (run) => {
      // The shared worker owns sync for the whole process; keep it alive until
      // the Run is aborted rather than letting the Task settle immediately.
      await using _ = await run.ok(initSharedWorker(self));
      return await run(waitForAbort);
    });
  });

  return createCommonEvoluDeps({
    createDbWorker,
    createBroadcastChannel,
    createMessageChannel,
    lockManager: navigator.locks,
    // Nothing to reload in a CLI process — the MCP host restarts us.
    reloadApp: () => {},
    sharedWorker,
  });
}
