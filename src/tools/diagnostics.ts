import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getQuarantineCounts, getSyncHealth, testWebSocketConnectivity, forceSync as forceSyncImpl } from "../evolu.js";
import { getSocketTraffic, getWorkerDefects } from "../evoluPlatform.js";
import { judgeSyncFreshness } from "./pure.js";
import { classifyFreshness, localMessageCount, fetchRelayMessageCount, missingMessages } from "../utils/syncFreshness.js";
import { getEvolu, getAppOwnerId } from "../evolu.js";

export const diagnosticTools: Tool[] = [
  {
    name: "td_sync_status",
    description: "Check sync health: WebSocket connectivity to relay servers, Evolu errors, and sync state. Use this to diagnose sync issues.",
    inputSchema: {
      type: "object",
      properties: {
        retest: {
          type: "boolean",
          description: "Re-test WebSocket connectivity (default: false)",
        },
      },
    },
  },
  {
    name: "td_force_sync",
    description: "Force a sync round-trip with the relay. Re-attaches transports to make sure the WebSocket is live, then waits for incoming sync messages to settle and returns a snapshot of how many table changes arrived. Use this before reading data when you suspect another device just wrote something.",
    inputSchema: {
      type: "object",
      properties: {
        waitMs: {
          type: "number",
          description: "How long to wait for incoming sync activity, in ms (default: 3000, min: 200, max: 30000)",
        },
        reconnect: {
          type: "boolean",
          description: "If true, detach and re-attach transports before waiting (forces a fresh WebSocket round-trip). Default: true.",
        },
      },
    },
  },
];

export async function handleDiagnosticTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "td_sync_status":
      return syncStatus(args as { retest?: boolean });
    case "td_force_sync":
      return forceSyncImpl(args as { waitMs?: number; reconnect?: boolean });
    default:
      return undefined;
  }
}

async function syncStatus(args: { retest?: boolean }) {
  const health = getSyncHealth();

  // Optionally re-test WebSocket connectivity
  if (args.retest) {
    const wsResults = await testWebSocketConnectivity();
    health.wsConnectivity = wsResults;
  }

  const anyRelayReachable = Object.values(health.wsConnectivity).some((s) => s === 'ok');
  const quarantine = await getQuarantineCounts();

  // Real traffic on the wire, measured by the wrapper around createWebSocket.
  // Before TODO-294 nothing here measured that, and `status` went by whether a
  // socket could be opened, which reported `ok` for an hour while not one
  // message left.
  const traffic = getSocketTraffic();
  // A worker that panicked takes its instance with it, silently. Reported
  // first because it outranks every other reading here: a dead dbWorker means
  // the numbers below describe a process that cannot answer a query. (TODO-317)
  const workerDefects = getWorkerDefects();
  const lastOutgoingAt = Math.max(0, ...Object.values(traffic).map((t) => t.lastOutgoingAt ?? 0)) || null;
  const lastIncomingAt = Math.max(0, ...Object.values(traffic).map((t) => t.lastIncomingAt ?? 0)) || null;
  const freshness = judgeSyncFreshness({
    lastOutgoingAt,
    lastIncomingAt,
    lastLocalMutationAt: health.lastLocalMutationAt,
    now: Date.now(),
  });
  const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());

  return {
    // Judged on what can be observed. Sync errors are observable again since
    // TODO-266, through Evolu's console rather than the instance hook v8
    // removed, so `lastError` counts towards this once more — but a missing
    // relay is reported as such rather than folded into "degraded", because
    // the two call for different answers. (TODO-265, TODO-266)
    // Judged on readiness and reachability only. Sync errors cannot be judged:
    // v8 removed the instance hook and its console never reports one on the
    // client (TODO-265, TODO-266). Quarantined rows are reported as a number
    // rather than folded in here, because a quarantine is Evolu's forward
    // compatibility working as designed — a client whose schema is behind
    // keeps what it cannot apply — and this installation holds one row that
    // can never resolve, a `user.enableDependencyGraph` from an app version
    // that no longer declares it. A status permanently stuck on "degraded"
    // over that is a status nobody reads. (TODO-267)
    // The order is deliberate: the first duty is not to lie about sync being
    // stuck. `stale` means a local write is waiting and nothing is leaving,
    // which is a fault even with an open socket and a reachable relay.
    // (TODO-294)
    status: workerDefects.some((d) => d.worker === 'dbWorker')
      ? 'worker-dead'
      : !health.evoluReady
      ? 'not-ready'
      : !anyRelayReachable
        ? 'no-relay'
        : freshness.verdict === 'stale'
          ? 'stale'
          : 'ok',
    /**
     * Whether this process holds the whole account (TODO-373).
     *
     * `behind` is not cosmetic: a task code is derived from the highest one
     * visible here, so numbering while behind hands out a code the relay
     * already uses. `unknown` means the relay could not be asked, which is a
     * different thing from being complete.
     */
    copy: await copyFreshness(),
    /** What measured traffic says about sync, rather than the socket's state. */
    sync: {
      verdict: freshness.verdict,
      reason: freshness.reason,
      lastOutgoingAt: iso(lastOutgoingAt),
      lastIncomingAt: iso(lastIncomingAt),
      lastLocalMutationAt: iso(health.lastLocalMutationAt),
      pendingForSeconds: freshness.pendingForMs === null ? null : Math.round(freshness.pendingForMs / 1000),
      quietForSeconds: freshness.quietForMs === null ? null : Math.round(freshness.quietForMs / 1000),
      framesPerRelay: traffic,
    },
    evoluReady: health.evoluReady,
    /**
     * Panics from the in-process workers. Empty is the healthy answer. A
     * `dbWorker` entry means every query on that instance would hang, and only
     * a reconnect fixes it; a `sharedWorker` entry means sync is gone but
     * local reads still work. (TODO-317)
     */
    workerDefects: workerDefects.map((d) => ({
      worker: d.worker,
      at: new Date(d.at).toISOString(),
      message: d.message,
    })),
    relayServers: health.relayServers,
    wsConnectivity: health.wsConnectivity,
    // Messages Evolu received and could not apply, per instance. Nothing logs
    // these and no Evolu API reports them; the table has to be counted.
    quarantinedRows: quarantine,
    errorTracking:
      'Evolu v8 reports no sync errors to the client - there is no instance hook and nothing is logged. lastError/errorCount used to be reported here and were never populated by anything, so they are gone; quarantinedRows is the real signal (TODO-266, TODO-288)',
    onCompleteCount: health.onCompleteCount,
    tips: [
      "If all relays show 'untested', run with retest: true",
      "If relays show 'failed'/'timeout', check network/firewall",
      "quarantinedRows counts data this schema cannot apply — growth means the schema is behind the app",
      "onCompleteCount tracks successfully applied local mutations",
      "sync.verdict is the one to read: 'stale' means a local write is waiting and nothing is leaving, which an open socket does not tell you",
      "'idle' is not a fault — nothing was written, so nothing had to go out",
    ],
  };
}

/**
 * Local versus relay message counts.
 *
 * Evolu keeps one row per applied message in `evolu_timestamp` and the relay
 * reports the same figure for the owner, so the pair answers "do I have
 * everything" directly instead of by waiting a fixed number of milliseconds.
 * Measured on real data the two matched exactly (TODO-343).
 */
async function copyFreshness(): Promise<{
  state: string;
  localMessages: number | null;
  relayMessages: number | null;
  missing: number | null;
}> {
  const evolu = getEvolu();
  const ownerId = getAppOwnerId();
  const mnemonic = process.env.TODOCKO_MNEMONIC;
  const local = evolu
    ? await localMessageCount(evolu as unknown as Parameters<typeof localMessageCount>[0])
    : null;
  const remote = ownerId && mnemonic ? await fetchRelayMessageCount(ownerId, mnemonic) : null;
  return {
    state: classifyFreshness({ local, remote }),
    localMessages: local,
    relayMessages: remote,
    missing: missingMessages({ local, remote }),
  };
}
