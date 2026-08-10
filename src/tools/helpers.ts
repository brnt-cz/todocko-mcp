import { getSyncHealth, trackOnComplete, type EvoluInstance } from "../evolu.js";
import { maxLength, NonEmptyString } from "@evolu/common";
import { resolve, join, sep } from "path";
import { homedir } from "os";

/**
 * Resolve a user-supplied attachment `savePath` to an absolute path confined to
 * an allowed base directory (default ~/Downloads, override via
 * TODOCKO_DOWNLOAD_DIR). Rejects absolute/`..` escapes so a download can't
 * overwrite arbitrary files (e.g. ~/.ssh/authorized_keys, ~/.bashrc) when the
 * MCP/CLI is driven by an agent acting on untrusted content. (TODO-184)
 */
export function resolveDownloadPath(savePath: string): string {
  const base = resolve(process.env.TODOCKO_DOWNLOAD_DIR || join(homedir(), "Downloads"));
  const target = resolve(base, savePath);
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(
      `savePath "${savePath}" escapes the allowed download directory (${base}). ` +
        `Use a relative path inside it, or set TODOCKO_DOWNLOAD_DIR.`,
    );
  }
  return target;
}

/** Max decoded attachment size accepted by upload tools (memory/DB DoS guard, TODO-190). */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Reject an attachment whose base64 `content` decodes to more than the allowed size. */
export function assertAttachmentSize(base64: string): void {
  // 4 base64 chars ≈ 3 bytes; ignore padding for the estimate.
  const approxBytes = Math.floor((base64.length * 3) / 4);
  if (approxBytes > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `Attachment too large: ~${Math.round(approxBytes / 1024 / 1024)} MB (max ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB).`,
    );
  }
}

/**
 * Description fields (task/shared task) are stored in an unbounded `String`
 * column, so the app UI imposes no limit. Evolu's built-in `NonEmptyString1000`
 * was far too tight for real descriptions; this raises the MCP guardrail to a
 * generous 10000 while still rejecting accidental megabyte payloads. (TODO-181)
 */
export const NonEmptyString10000 = maxLength(10000)(NonEmptyString);
export const MAX_DESCRIPTION_LENGTH = 10000;

/** Gap between neighbouring positions, matching the app's renumbering step. */
export const POSITION_STEP = 10;

/**
 * Position for a new task so it lands at the TOP of its column, mirroring the
 * app (TODO-217). Columns render by `position` ascending, so "top" is the
 * lowest number; MCP used to append with `max + 1`, which put tasks created by
 * an assistant at the very bottom while the app put its own at the top.
 *
 * `minPosition` is the lowest position currently in that column, or 0 when the
 * column is empty. Clamping at 0 guarantees the result is <= -STEP, so the new
 * task also sorts above rows whose position is 0.
 *
 * Negative positions are fine: the app renumbers a whole column to `index * 10`
 * on every drag-drop reorder.
 */
export function topPositionForNewTask(minPosition: number): number {
  return Math.min(0, minPosition) - POSITION_STEP;
}

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

/**
 * Throw when an Evolu mutation was rejected.
 *
 * Tools answer the caller with `success: true`, so discarding the Result means
 * reporting a write that Evolu refused — the update/delete tools did exactly
 * that. The create paths already checked theirs. (TODO-206)
 */
export function assertMutation(label: string, result: { readonly ok: boolean }): void {
  if (!result.ok) {
    throw new Error(`${label} failed: ${JSON.stringify((result as { readonly error?: unknown }).error)}`);
  }
}
