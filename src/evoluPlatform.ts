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
 * When something last actually left and arrived on the wire. (TODO-294)
 *
 * Why separately, and why here: Evolu v8 tells the client nothing about sync
 * state, with no hook and nothing in the log. `td_sync_status` therefore
 * measured the one thing it could, that a WebSocket opens, and reported `ok`.
 * That answers a different question: on 2026-09-07 the MCP sent the relay
 * nothing for an hour while this tool insisted all was well. The only way to
 * tell was from outside, on the relay, by the owner's `lastTimestamp`.
 *
 * `createWebSocket` is an injectable dependency (`CreateWebSocketDep`) that
 * Evolu consumes in `Shared.js`, so a wrapper around it sees every frame that
 * really passes. It simulates nothing and estimates nothing.
 *
 * The state may live in the module because both "workers" here run
 * **in-process** (they are Evolu's memory-only fallbacks, see the file header).
 * In real `worker_threads` it would have to arrive by message.
 */
interface SocketTraffic {
  lastOutgoingAt: number | null;
  lastIncomingAt: number | null;
  outgoingCount: number;
  incomingCount: number;
  /**
   * Opens and closes. This separates two things that otherwise look alike and
   * have different causes: a connection that dropped and never reconnected,
   * versus one that stands open with nothing being sent on it. Without this,
   * TODO-295 cannot be investigated, only guessed at.
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

/** Wrapper that records every frame sent and received. */
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
  // Task<T, E> is (run) => Awaitable<Result<T, E>>, so the wrapper is a Task
  // too: it calls the original and, on success, swaps in its own `send`.
  const task = createWebSocket(url, wrappedOptions);
  return async (run) => {
    const result = await task(run);
    if (!result.ok) return result;
    const socket = result.value;
    const originalSend = socket.send.bind(socket);
    socket.send = (data) => {
      // Recorded only on success: `send` returns a Result and fails on a
      // closed socket. Counting the attempt would manufacture another
      // meaningless "ok", which is the very fault this tool exists to remove.
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
 * Panics ("defects") raised while the workers run. (TODO-317)
 *
 * Both workers run in-process and are started as `void run(...)`, so nobody
 * reads their result. When a Run panics, Evolu hands it to
 * `deps.reportDefect`, whose default implementation throws it from a
 * microtask, outside any `try` that could catch it. The process keeps running
 * but the dbWorker is dead: its SQLite closes and every later `loadQuery` on
 * that instance never settles.
 *
 * Exactly this state was measured on a live process on 2026-09-11: only the
 * shared database stayed open, not the personal one, which `td_sync_status`
 * showed as `quarantinedRows.app === null`. The cause of death could not be
 * recovered, because nothing kept the defect. This keeps it.
 */
export interface WorkerDefect {
  readonly worker: "dbWorker" | "sharedWorker";
  readonly at: number;
  readonly message: string;
  readonly stack: string | null;
}

const workerDefects: WorkerDefect[] = [];

/** What killed the workers, oldest first. Read by `td_sync_status`. */
export function getWorkerDefects(): WorkerDefect[] {
  return [...workerDefects];
}

/**
 * The reason asking is pointless, or `null`.
 *
 * `dbWorker` holds SQLite, so its death means no query will ever answer again.
 * Losing `sharedWorker` costs sync, but local reads still work, so queries are
 * not refused over it.
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

/** Measured traffic per URL. Read by `td_sync_status`. */
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
