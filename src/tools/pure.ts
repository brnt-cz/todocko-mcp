/**
 * Helpers with no Evolu dependency.
 *
 * Split out of helpers.ts so they can be tested without starting Evolu
 * (TODO-229). helpers.ts imports ../evolu.js, whose module-level init reaches
 * @evolu/common/local-first, and that crashes on Node 18 and 20 with
 * "crypto.getRandomValues must be defined". The functions below never needed any
 * of it — the test file just could not reach them without dragging it along.
 *
 * helpers.ts re-exports everything here, so existing imports keep working.
 */
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
 * Simple wait for sync (used where onComplete isn't available)
 */
export async function waitForSync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, NETWORK_DELAY_MS));
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

/**
 * Ids of the tags a task newly created in `projectId` should start with.
 *
 * Mirrors `defaultTagIdsForProject` in the app (src/utils/defaultTags.ts): the
 * flag has to behave the same wherever a task is created, or which tags a task
 * ends up with depends on whether it was created in the app or through this
 * server. (TODO-239)
 *
 * `isDefault` arrives as the raw SQLite value (1 or null), hence the truthiness
 * test rather than a comparison with SQLITE_TRUE.
 */
export function defaultTagIdsForProject(
  tags: readonly { id: string; projectId?: string | null; isDefault?: unknown }[],
  projectId: string | null,
): string[] {
  if (!projectId) return [];
  return tags.filter((tag) => tag.projectId === projectId && !!tag.isDefault).map((tag) => tag.id);
}

/**
 * Rows out of an `evolu.loadQuery` result.
 *
 * `loadQuery` resolves to the rows array itself. Three analytics tools read
 * `result.rows` instead, which is always undefined — so td_list_recurring_tasks,
 * td_list_overdue_tasks and td_list_tasks_by_date_range reported an empty list
 * for every input since they were written, with no error to notice. Going through
 * one helper keeps the mistake from being made a fourth time. (TODO-242)
 *
 * The `.rows` shape is still accepted, so a future Evolu that wraps its result
 * does not silently empty these tools out again.
 */
export function queryRows<T = unknown>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const wrapped = (result as { rows?: unknown } | null | undefined)?.rows;
  return Array.isArray(wrapped) ? (wrapped as T[]) : [];
}
