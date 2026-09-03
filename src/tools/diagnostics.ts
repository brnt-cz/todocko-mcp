import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getSyncHealth, testWebSocketConnectivity, forceSync as forceSyncImpl } from "../evolu.js";

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

  return {
    // Judged only on what can actually be observed. `lastError` used to decide
    // this, but Evolu v8 has no error hook on the instance, so it can never be
    // set and "ok" would mean nothing more than "we cannot tell". (TODO-265)
    status: !health.evoluReady ? 'not-ready' : anyRelayReachable ? 'ok' : 'no-relay',
    evoluReady: health.evoluReady,
    relayServers: health.relayServers,
    wsConnectivity: health.wsConnectivity,
    lastError: health.lastError,
    lastErrorAt: health.lastErrorAt,
    errorCount: health.errorCount,
    // v8 dropped `subscribeError`/`getError` and ships no replacement, so the
    // two fields above stay empty however badly sync is going. Say so rather
    // than let a zero read as good news. Capturing errors out of Evolu's
    // console store is TODO-266.
    errorTracking: 'unavailable on Evolu v8 — lastError and errorCount cannot be populated',
    onCompleteCount: health.onCompleteCount,
    tips: [
      "If all relays show 'untested', run with retest: true",
      "If relays show 'failed'/'timeout', check network/firewall",
      "errorCount is always 0 on v8; see errorTracking",
      "onCompleteCount tracks successfully applied local mutations",
    ],
  };
}
