import { getSyncHealth, trackOnComplete, type EvoluInstance } from "../evolu.js";
import { maxLength, NonEmptyTrimmedString } from "@evolu/common";
import { NETWORK_DELAY_MS } from "./pure.js";

// Evolu-free helpers live in pure.ts so they can be tested without starting
// Evolu (TODO-229). Re-exported here, so every existing `from "./helpers.js"`
// import keeps working.
export {
  resolveDownloadPath,
  resolveUploadPath,
  MAX_ATTACHMENT_BYTES,
  assertAttachmentSize,
  MAX_DESCRIPTION_LENGTH,
  POSITION_STEP,
  topPositionForNewTask,
  NETWORK_DELAY_MS,
  waitForSync,
  assertMaxLength,
  assertMutation,
  defaultTagIdsForProject,
  queryRows,
  FREE_TIER_LIMITS,
  freeTierWarning,
  safeLoadQuery,
  assertRowExists,
} from "./pure.js";

/**
 * Description fields (task/shared task) are stored in an unbounded `String`
 * column, so the app UI imposes no limit. Evolu's built-in `NonEmptyTrimmedString1000`
 * was far too tight for real descriptions; this raises the MCP guardrail to a
 * generous 10000 while still rejecting accidental megabyte payloads. (TODO-181)
 */
export const NonEmptyString10000 = maxLength(10000)(NonEmptyTrimmedString);

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



