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

/**
 * Resolve a user-supplied `filePath` for an UPLOAD, confined the same way
 * downloads are.
 *
 * Downloads have been confined since TODO-184 so an agent acting on untrusted
 * content could not overwrite arbitrary files. Uploads were left open, which is
 * the same problem pointing the other way: a prompt injection in a task
 * description or an inbox email could ask for `~/.claude/settings.json` (which
 * holds the mnemonic), `~/.ssh/id_ed25519` or a project `.env`, and the file
 * would be attached - for shared projects, handed to every other member.
 * (TODO-286)
 *
 * Base is `TODOCKO_UPLOAD_DIR`, falling back to `TODOCKO_DOWNLOAD_DIR` and then
 * ~/Downloads: whoever configured a download directory almost certainly means
 * the same place for uploads, and a second variable nobody sets would leave the
 * default wide open.
 *
 * Dotfiles are refused even inside the base. The attacks worth caring about name
 * a dotfile (`.env`, `.npmrc`, `.git/config`), and a legitimate attachment
 * almost never does.
 */
export function resolveUploadPath(filePath: string): string {
  const base = resolve(
    process.env.TODOCKO_UPLOAD_DIR ||
      process.env.TODOCKO_DOWNLOAD_DIR ||
      join(homedir(), "Downloads"),
  );
  const target = resolve(base, filePath);

  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(
      `filePath "${filePath}" escapes the allowed upload directory (${base}). ` +
        `Use a relative path inside it, or set TODOCKO_UPLOAD_DIR.`,
    );
  }

  const relative = target.slice(base.length + 1);
  if (relative.split(sep).some((segment) => segment.startsWith("."))) {
    throw new Error(
      `filePath "${filePath}" points at a dotfile, which is refused: those are ` +
        `where credentials live, and an upload is how they would leave this machine.`,
    );
  }

  return target;
}

/**
 * Base URL for the relay's HTTP API, whatever form TODOCKO_RELAY_URL takes.
 *
 * `RELAY_SERVERS` in evolu.ts accepts `wss://` and `ws://` (TODO-266), but the
 * three HTTP tools built their URLs straight from the variable and would then
 * call `fetch("wss://…")` - which throws. Depending on the tool that surfaced as
 * "fetch failed" or, in the tier check, as a silently swallowed null that reads
 * as "not on the free plan".
 *
 * Container ports are stripped for the same reason they always were: the relay
 * sits behind a reverse proxy and 4000/4001 are not reachable from outside.
 * (TODO-288)
 */
export function relayHttpBase(raw: string | undefined): string {
  const value = (raw || "https://relay.todocko.cz").trim();
  const asHttp = value.startsWith("wss://")
    ? value.replace(/^wss:\/\//, "https://")
    : value.startsWith("ws://")
      ? value.replace(/^ws:\/\//, "http://")
      : value;
  return asHttp.replace(/:400[01]\/?$/, "").replace(/\/$/, "");
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
 * Throw when an Evolu mutation did not come back with a row id.
 *
 * Tools answer the caller with `success: true`, so a write nobody checked
 * would be reported as a success either way (TODO-206).
 *
 * What is checked changed with v8. v7 returned a `Result` and the original
 * version of this asserted `result.ok`. v8 returns the row as `{ id }` and
 * raises on an invalid change instead, so `ok` is simply absent — which made
 * this helper throw on every successful mutation, and the v8 port kept it.
 * A missing id is what is left to catch.
 */
export function assertMutation(label: string, result: { readonly id?: unknown }): void {
  if (!result || typeof result.id !== "string" || result.id.length === 0) {
    throw new Error(`${label} failed: mutation returned no row id (${JSON.stringify(result)})`);
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

/** Free-tier caps, mirroring FREE in the app's src/composables/useOwnerTier.ts. */
export const FREE_TIER_LIMITS = { maxProjects: 1, maxActiveTasks: 50 };

/**
 * Warning appended to a create response when the owner is on the free plan and
 * now sits above its cap.
 *
 * Tier limits are enforced in the browser only, and nothing checks them here, so
 * a free owner can create freely through this server and then discover the cap
 * later in the app. The point of this text is that they learn it at the moment it
 * happens, and that they learn nothing is lost. (TODO-243)
 *
 * Returns "" when there is nothing to say, so callers can append unconditionally.
 */
export function freeTierWarning(
  kind: "project" | "task",
  count: number,
  limit: number,
): string {
  if (count <= limit) return "";
  return kind === "project"
    ? ` NOTE: this owner is on the free plan, which allows ${limit} active project — there are now ${count}.` +
      ` The app will refuse to create further projects and show a limit message. Existing projects keep working and nothing is lost.`
    : ` NOTE: this owner is on the free plan, which allows ${limit} active tasks (completed ones do not count) — there are now ${count}.` +
      ` The app will refuse to create further tasks and show a limit message. Existing tasks keep working and nothing is lost.`;
}
