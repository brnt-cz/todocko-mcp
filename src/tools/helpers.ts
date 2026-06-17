import { getSyncHealth, trackOnComplete, type EvoluInstance } from "../evolu.js";
import { maxLength, NonEmptyString } from "@evolu/common";

/**
 * Description fields (task/shared task) are stored in an unbounded `String`
 * column, so the app UI imposes no limit. Evolu's built-in `NonEmptyString1000`
 * was far too tight for real descriptions; this raises the MCP guardrail to a
 * generous 10000 while still rejecting accidental megabyte payloads. (TODO-181)
 */
export const NonEmptyString10000 = maxLength(10000)(NonEmptyString);
export const MAX_DESCRIPTION_LENGTH = 10000;

// Network delay after onComplete - time for WebSocket to send data to relay
// onComplete means local DB is updated; this delay allows network round-trip
export const NETWORK_DELAY_MS = 500;

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
      // Wait for onComplete (max 3s safety net)
      await Promise.race([
        completePromise,
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
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
 * Validate that a string field does not exceed Evolu's max length.
 *
 * Evolu's `NonEmptyStringN.orThrow()` throws an opaque "getOrThrow" error on
 * overflow (the real reason is buried in `cause`). Calling this first yields a
 * clear, actionable message naming the field and the offending length.
 */
export function assertMaxLength(
  value: string | null | undefined,
  max: number,
  field: string
): void {
  if (value != null && value.length > max) {
    throw new Error(
      `Field "${field}" is too long: ${value.length} characters (max ${max}).`
    );
  }
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
