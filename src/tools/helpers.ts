import { getSyncHealth, trackOnComplete } from "../evolu.js";

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
