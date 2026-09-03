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
  const quarantined = (quarantine.app ?? 0) + (quarantine.project ?? 0);

  return {
    // Judged on what can be observed. Sync errors are observable again since
    // TODO-266, through Evolu's console rather than the instance hook v8
    // removed, so `lastError` counts towards this once more — but a missing
    // relay is reported as such rather than folded into "degraded", because
    // the two call for different answers. (TODO-265, TODO-266)
    // Judged on what can be observed. Sync errors are not: v8 removed the
    // instance hook and its console never reports one on the client
    // (TODO-265, TODO-266). Quarantined rows are the exception — data that
    // arrived and could not be applied — so they decide this.
    status: !health.evoluReady
      ? 'not-ready'
      : !anyRelayReachable
        ? 'no-relay'
        : quarantined > 0
          ? 'quarantined-data'
          : 'ok',
    evoluReady: health.evoluReady,
    relayServers: health.relayServers,
    wsConnectivity: health.wsConnectivity,
    lastError: health.lastError,
    lastErrorAt: health.lastErrorAt,
    errorCount: health.errorCount,
    // Messages Evolu received and could not apply, per instance. Nothing logs
    // these and no Evolu API reports them; the table has to be counted.
    quarantinedRows: quarantine,
    errorTracking:
      'lastError/errorCount cannot be populated on Evolu v8 — no instance hook and no console error on the client. Watch quarantinedRows instead (TODO-266)',
    onCompleteCount: health.onCompleteCount,
    tips: [
      "If all relays show 'untested', run with retest: true",
      "If relays show 'failed'/'timeout', check network/firewall",
      "quarantinedRows > 0 means data arrived that this schema cannot apply",
      "onCompleteCount tracks successfully applied local mutations",
    ],
  };
}
