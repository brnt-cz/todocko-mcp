import { getSyncHealth, trackOnComplete, type EvoluInstance } from "../evolu.js";
import { maxLength, NonEmptyTrimmedString } from "@evolu/common";
import { NETWORK_DELAY_MS, MAX_RICH_TEXT_LENGTH } from "./pure.js";

// Evolu-free helpers live in pure.ts so they can be tested without starting
// Evolu (TODO-229). Re-exported here, so every existing `from "./helpers.js"`
// import keeps working.
export {
  resolveDownloadPath,
  resolveUploadPath,
  MAX_ATTACHMENT_BYTES,
  assertAttachmentSize,
  MAX_RICH_TEXT_LENGTH,
  contentField,
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
  assertNotSharedProject,
  assertValidProjectCode,
  nextTaskCode,
  assertTaskCodeForProject,
  withTaskCodeLock,
  pickSharedProjectRow,
} from "./pure.js";

/**
 * Rich text going into one row: a task description, a note, a document.
 *
 * Stored in an unbounded `String` column, so the limit is not the column but
 * the mutation: Evolu raises synchronously above `maxMutationSize`. The
 * number comes from `MAX_RICH_TEXT_LENGTH`, which is the app's. It used to be
 * a flat 10 000 (TODO-181), which refused text the app accepts. (TODO-112)
 */
export const RichTextString = maxLength(MAX_RICH_TEXT_LENGTH)(NonEmptyTrimmedString);

/**
 * Wait for a mutation to complete locally (via onComplete), then wait for network sync.
 * Returns a promise that resolves after the mutation is locally applied + network delay.
 */
export function createMutationWaiter(): {
  onComplete: () => void;
  waitForSync: () => Promise<void>;
  waitForLocal: () => Promise<void>;
} {
  let resolveComplete: (() => void) | null = null;
  const completePromise = new Promise<void>((resolve) => {
    resolveComplete = resolve;
  });

  return {
    onComplete: () => {
      trackOnComplete();
      if (resolveComplete) resolveComplete();
    },
    /**
     * Only the local half: the mutation is applied and a following read sees
     * it. What a lock around read-then-insert has to wait for, without holding
     * every other caller through the network delay. (TODO-434)
     */
    waitForLocal: async () => {
      await Promise.race([
        completePromise,
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);
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



