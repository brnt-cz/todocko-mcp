import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getSyncHealth, testWebSocketConnectivity } from "../evolu.js";

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
];

export async function handleDiagnosticTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "td_sync_status":
      return syncStatus(args as { retest?: boolean });
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

  return {
    status: health.lastError ? 'degraded' : 'ok',
    evoluReady: health.evoluReady,
    relayServers: health.relayServers,
    wsConnectivity: health.wsConnectivity,
    lastError: health.lastError,
    lastErrorAt: health.lastErrorAt,
    errorCount: health.errorCount,
    onCompleteCount: health.onCompleteCount,
    tips: [
      "If all relays show 'untested', run with retest: true",
      "If relays show 'failed'/'timeout', check network/firewall",
      "errorCount > 0 indicates Evolu sync issues",
      "onCompleteCount tracks successfully applied local mutations",
    ],
  };
}
