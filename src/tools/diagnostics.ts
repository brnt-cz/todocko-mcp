import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getQuarantineCounts, getSyncHealth, testWebSocketConnectivity, forceSync as forceSyncImpl } from "../evolu.js";

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
    status: !health.evoluReady ? 'not-ready' : anyRelayReachable ? 'ok' : 'no-relay',
    evoluReady: health.evoluReady,
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
    ],
  };
}
