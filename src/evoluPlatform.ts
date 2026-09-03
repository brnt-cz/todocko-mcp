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
      });
      void run(startDbWorker(self));
    });

  const sharedWorker = createSharedWorker<SharedWorkerInput, SharedWorkerOutput>((self) => {
    const run = createRun({
      ...createWorkerDeps(),
      createWebSocket,
      lockManager: navigator.locks,
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
