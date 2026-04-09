import { getSyncHealth, trackOnComplete, type EvoluInstance } from "../evolu.js";

// Network delay after onComplete - time for WebSocket to send data to relay
// onComplete means local DB is updated; this delay allows network round-trip
export const NETWORK_DELAY_MS = 3000;

/**
 * Wait for a mutation to complete locally (via onComplete), then wait for network sync.
 * Returns a promise that resolves after the mutation is locally applied + network delay.
 */
export function createMutationWaiter(): { onComplete: () => void; waitForSync: () => Promise<void> } {
  let resolveComplete: (() => void) | null = null;
  const completePromise = new Promise<void>((resolve) => {
    resolveComplete = resolve;
  });

  return {
    onComplete: () => {
      trackOnComplete();
      if (resolveComplete) resolveComplete();
    },
    waitForSync: async () => {
      // Wait for onComplete (max 5s safety net)
      await Promise.race([
        completePromise,
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ]);
      // Then wait for network round-trip
      await new Promise((resolve) => setTimeout(resolve, NETWORK_DELAY_MS));
    },
  };
}

/**
 * Simple wait for sync (used where onComplete isn't available)
 */
export async function waitForSync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, NETWORK_DELAY_MS));
}

/**
 * Get sync warning string if there are errors
 */
export function getSyncWarning(): string {
  const health = getSyncHealth();
  return health.lastError ? ` (sync warning: ${health.lastError})` : '';
}

/**
 * Wrapper around evolu.loadQuery with a timeout to prevent infinite hangs.
 * If the query doesn't resolve within the timeout, throws an error.
 */
export async function safeLoadQuery(evolu: EvoluInstance, query: any, timeoutMs = 15000): Promise<any[]> {
  const result = await Promise.race([
    evolu.loadQuery(query),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`loadQuery timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
  return result as any[];
}
