import { getSyncHealth, trackMutationError, trackMutationSuccess, type EvoluInstance } from "../evolu.js";
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
 * Wait for a mutation to be stored locally, then wait for network sync.
 *
 * Evolu 8.28 renamed `onComplete` to `onSuccess` and added `onError`. The old
 * name said the callback ran whenever the mutation ended, but it ran only when
 * the mutation was stored, so a write that could not be stored, such as one
 * refused because another context holds the database files, left this waiter
 * hanging until the three second safety net expired and the tool then reported
 * success. `onError` turns that silence into a thrown error: a write the
 * caller is told went through, and did not, is the worst answer this server
 * can give.
 */
export function createMutationWaiter(): {
  onSuccess: () => void;
  onError: (error: unknown) => void;
  waitForSync: () => Promise<void>;
  waitForLocal: () => Promise<void>;
} {
  let resolveSettled: (() => void) | null = null;
  const settledPromise = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });
  let failure: string | null = null;

  /**
   * Only the error's type, never the error itself. What Evolu hands over is
   * not ours and may carry row data; a type name is enough to act on.
   */
  const describe = (error: unknown): string => {
    if (typeof error === "object" && error !== null) {
      const type = (error as { type?: unknown }).type;
      if (typeof type === "string") return type;
    }
    return "UnknownMutationError";
  };

  /** Throws when the mutation was refused, which both waits have to do. */
  const assertStored = (): void => {
    if (failure !== null) {
      throw new Error(`mutation was not stored: ${failure}`);
    }
  };

  return {
    onSuccess: () => {
      trackMutationSuccess();
      if (resolveSettled) resolveSettled();
    },
    onError: (error: unknown) => {
      failure = describe(error);
      trackMutationError(failure);
      if (resolveSettled) resolveSettled();
    },
    /**
     * Only the local half: the mutation is applied and a following read sees
     * it. What a lock around read-then-insert has to wait for, without holding
     * every other caller through the network delay. (TODO-434)
     */
    waitForLocal: async () => {
      await Promise.race([
        settledPromise,
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);
      assertStored();
    },
    waitForSync: async () => {
      // Wait for onSuccess or onError (max 3s safety net)
      await Promise.race([
        settledPromise,
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);
      assertStored();
      // Then wait for network round-trip
      await new Promise((resolve) => setTimeout(resolve, NETWORK_DELAY_MS));
    },
  };
}



