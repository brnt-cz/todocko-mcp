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
import { resolve, join, sep, dirname } from "path";
import { homedir } from "os";
import { existsSync, realpathSync, statSync } from "fs";

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The same path with every symlink along it resolved, as far as it exists.
 *
 * Confinement used to be decided on the lexical path alone, which a symlink
 * walks straight out of: `~/Downloads/out -> /etc` makes `out/cron.d/x` look
 * like a path inside the base while the write lands in /etc. Neither upload nor
 * download looked, and both follow the link. (TODO-441)
 *
 * Only the existing part can be resolved - a download names a file that is not
 * there yet - so this resolves the deepest existing ancestor and re-appends the
 * rest. That is enough: a symlink can only redirect through a component that
 * exists.
 */
function realPathOfExistingPart(target: string): string {
  let existing = target;
  const missing: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    // Root reached without finding anything that exists: nothing to resolve.
    if (parent === existing) return target;
    missing.unshift(existing.slice(parent.length + 1));
    existing = parent;
  }
  try {
    return join(realpathSync(existing), ...missing);
  } catch {
    // A path that cannot be resolved (permissions, a race) is judged lexically
    // rather than let through unchecked.
    return target;
  }
}

/** Is `target` the base directory itself or something underneath it? */
function isInside(base: string, target: string): boolean {
  return target === base || target.startsWith(base + sep);
}

/**
 * Confine a user-supplied path to `base`, lexically AND after resolving symlinks.
 *
 * Both ends are checked against the real base too, because the base itself may
 * be a symlink (/tmp on macOS is) and comparing a resolved target with an
 * unresolved base would then refuse every legitimate path.
 */
function confineToBase(base: string, input: string, label: string, hint: string): string {
  const target = resolve(base, input);
  const realBase = realPathOfExistingPart(base);
  const realTarget = realPathOfExistingPart(target);

  if (!isInside(base, target) || !isInside(realBase, realTarget)) {
    throw new Error(
      `${label} "${input}" escapes the allowed directory (${base}). ` +
        `Use a relative path inside it, or set ${hint}.` +
        (isInside(base, target) ? " It resolves out of it through a symlink." : ""),
    );
  }
  return target;
}

/** Refuse a dotfile anywhere below `base`: that is where credentials live. */
function assertNotDotfile(base: string, target: string, input: string, label: string): void {
  const relative = target === base ? "" : target.slice(base.length + 1);
  if (relative.split(sep).some((segment) => segment.startsWith("."))) {
    throw new Error(
      `${label} "${input}" points at a dotfile, which is refused: those are ` +
        `where credentials live.`,
    );
  }
}

/**
 * Resolve a user-supplied attachment `savePath` to an absolute path confined to
 * an allowed base directory (default ~/Downloads, override via
 * TODOCKO_DOWNLOAD_DIR). Rejects absolute/`..` escapes so a download can't
 * overwrite arbitrary files (e.g. ~/.ssh/authorized_keys, ~/.bashrc) when the
 * MCP/CLI is driven by an agent acting on untrusted content. (TODO-184)
 *
 * Two further rules came with TODO-441, both of which uploads already had or
 * implied:
 *
 * - dotfiles are refused here as well. A download writing `.bashrc` or
 *   `.config/...` is the same attack as an upload reading one, only pointing
 *   the other way, and the upload side has refused it since TODO-286.
 * - an existing file is never replaced unless the caller asked for it with
 *   `overwrite: true`. The previous behaviour was a silent overwrite, so one
 *   mistaken savePath destroyed a file with no way back and a `success` reply.
 */
export function resolveDownloadPath(
  savePath: string,
  options: { overwrite?: boolean } = {},
): string {
  const base = resolve(process.env.TODOCKO_DOWNLOAD_DIR || join(homedir(), "Downloads"));
  const target = confineToBase(base, savePath, "savePath", "TODOCKO_DOWNLOAD_DIR");
  assertNotDotfile(base, target, savePath, "savePath");

  // Only an existing FILE is a loss. An existing directory makes the write fail
  // on its own, and `savePath: "."` resolving to the base must keep working.
  if (!options.overwrite && existsSync(target) && !isDirectory(target)) {
    throw new Error(
      `savePath "${savePath}" already exists and would be overwritten. ` +
        `Pass overwrite: true if replacing it is intended, or choose another name.`,
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
  // Symlinks are resolved since TODO-441: `~/Downloads/key -> ~/.ssh/id_ed25519`
  // passed both checks below and the file was read and attached anyway.
  const target = confineToBase(base, filePath, "filePath", "TODOCKO_UPLOAD_DIR");
  assertNotDotfile(base, target, filePath, "filePath");
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

/**
 * Check a call's arguments against the tool's own declared `required` list.
 *
 * The tool schemas already say which arguments are mandatory, but nothing
 * enforced it: the server passed `args` straight to the handler, and a call
 * that named a parameter wrongly - `taskId` where `td_update_task` wants `id`,
 * a confusion the toolset invites, since `td_add_worklog` really does take
 * `taskId` - arrived with the required field `undefined`.
 *
 * That is worse than it sounds, because of how Evolu writes. `update()` goes
 * through `on conflict ("ownerId","id") do update`, so an id that is not there
 * does not raise: it inserts. One mistyped parameter therefore created a new,
 * empty task row and reported `success: true`. Three of them accumulated in a
 * single session before one turned up in the app's "unknown statuses" drawer;
 * the changes they were supposed to make had never happened, and the caller was
 * told they had. (TODO-292)
 *
 * The message names the parameters the tool does accept, because the failure
 * this catches is almost always a near-miss on a name.
 */
export function assertRequiredArgs(
  toolName: string,
  args: Record<string, unknown>,
  schema: { required?: string[]; properties?: Record<string, unknown> } | undefined,
): void {
  const properties = (schema?.properties ?? {}) as Record<string, { enum?: unknown[] }>;
  const accepted = Object.keys(properties);
  const supplied = Object.keys(args);

  const required = schema?.required ?? [];
  const missing = required.filter((key) => {
    const value = args[key];
    return value === undefined || value === null || value === "";
  });

  // An argument the schema does not declare used to be mentioned only when
  // something required was ALSO missing, and otherwise dropped without a word.
  // That is how `isChecked` on td_create_shared_checklist_item, which the
  // shared tool never accepted, returned `success` and wrote an unticked item.
  // (TODO-297)
  const strays = supplied.filter((key) => !accepted.includes(key));

  // Values outside a declared enum were never looked at either, so the enums
  // were documentation rather than a contract. `recurring` reached the task
  // status this way: a value the app treats as real, that MCP does not list.
  // (TODO-296, TODO-297)
  const badEnums: string[] = [];
  for (const key of supplied) {
    const allowed = properties[key]?.enum;
    if (!Array.isArray(allowed) || allowed.length === 0) continue;
    const value = args[key];
    if (value === undefined || value === null) continue;
    if (!allowed.includes(value)) {
      badEnums.push(`${key}=${JSON.stringify(value)} (expected one of: ${allowed.join(", ")})`);
    }
  }

  if (missing.length === 0 && strays.length === 0 && badEnums.length === 0) return;

  const parts: string[] = [];
  if (missing.length > 0) parts.push(`missing required argument(s): ${missing.join(", ")}`);
  if (strays.length > 0) parts.push(`unrecognised argument(s): ${strays.join(", ")}`);
  if (badEnums.length > 0) parts.push(`invalid value(s): ${badEnums.join("; ")}`);

  throw new Error(
    `${toolName}: ${parts.join(". ")}.` +
      ` Accepted arguments: ${accepted.join(", ") || "(none)"}.`,
  );
}

/** One property as the tool schemas declare it. */
interface SchemaProperty {
  readonly type?: string | string[];
  readonly items?: { type?: string };
  readonly description?: string;
}

/**
 * Arguments that hold a date even though their name does not end in Date/At.
 *
 * Kept to the two the activity-log tools use. The description still has to say
 * so, so a future `to` meaning something else is not dragged in.
 */
const DATE_ARG_NAMES = new Set(["from", "to", "deadline"]);

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d{1,6})?(Z|[+-]\d{2}:?\d{2})?$/;

/** Does the schema declare this argument as a date? */
function dateKind(key: string, property: SchemaProperty): "date" | "datetime" | null {
  const types = Array.isArray(property.type) ? property.type : [property.type];
  if (!types.includes("string")) return null;
  if (!DATE_ARG_NAMES.has(key) && !/(Date|At)$/.test(key)) return null;
  const description = property.description ?? "";
  if (!/ISO|YYYY-MM-DD|date/i.test(description)) return null;
  // "ISO timestamp", "ISO datetime" and "ISO date/datetime" all take a time.
  return /datetime|timestamp/i.test(description) ? "datetime" : "date";
}

/** Is `value` a real calendar date, not just the right shape? (2026-02-31 is not.) */
function isRealDate(ymd: string): boolean {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return (
    parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d
  );
}

function typeMatches(declared: string, value: unknown): boolean {
  switch (declared) {
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "null":
      return value === null;
    default:
      // An unknown declaration is not something to fail a call over.
      return true;
  }
}

function describeValue(value: unknown): string {
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Check argument VALUES against the types the tool's own schema declares.
 *
 * `assertRequiredArgs` checked that an argument was there, that it was declared
 * and that an enum value was listed, and nothing else - so the declared type
 * was documentation. JSON-RPC carries real JSON types, but a caller that builds
 * the call from text sends `isBlocked: "false"`, which is a non-empty string and
 * therefore stored as TRUE: the task came back blocked by the attempt to
 * unblock it. Dates had the same hole, with `deadline: "zítra"` written to the
 * column verbatim, where no view can read it and nothing ever reports it.
 * (TODO-441)
 *
 * `null` is accepted for every argument regardless of type: that is how most of
 * the update tools clear a field, and refusing it here would break them.
 */
export function assertArgTypes(
  toolName: string,
  args: Record<string, unknown>,
  schema: { properties?: Record<string, unknown> } | undefined,
): void {
  const properties = (schema?.properties ?? {}) as Record<string, SchemaProperty>;
  const problems: string[] = [];

  for (const [key, value] of Object.entries(args)) {
    const property = properties[key];
    // Undeclared arguments are assertRequiredArgs' business, not this one's.
    if (!property || value === undefined || value === null) continue;

    const declared = (Array.isArray(property.type) ? property.type : [property.type]).filter(
      (t): t is string => typeof t === "string",
    );
    if (declared.length > 0 && !declared.some((t) => typeMatches(t, value))) {
      problems.push(
        `${key} must be ${declared.join(" or ")}, got ${describeValue(value)} (${JSON.stringify(value)})`,
      );
      continue;
    }

    if (Array.isArray(value) && typeof property.items?.type === "string") {
      const itemType = property.items.type;
      const bad = value.findIndex((item) => !typeMatches(itemType, item));
      if (bad >= 0) {
        problems.push(
          `${key}[${bad}] must be ${itemType}, got ${describeValue(value[bad])} (${JSON.stringify(value[bad])})`,
        );
        continue;
      }
    }

    const kind = dateKind(key, property);
    if (kind && typeof value === "string") {
      const ok =
        kind === "datetime"
          ? (DATE_ONLY.test(value) || DATETIME.test(value)) && isRealDate(value.slice(0, 10))
          : DATE_ONLY.test(value) && isRealDate(value);
      if (!ok) {
        problems.push(
          `${key}=${JSON.stringify(value)} is not a valid date` +
            (kind === "datetime"
              ? ` (expected YYYY-MM-DD or an ISO datetime)`
              : ` (expected YYYY-MM-DD)`),
        );
      }
    }
  }

  if (problems.length === 0) return;
  throw new Error(`${toolName}: invalid argument(s): ${problems.join("; ")}.`);
}

/**
 * The shape these helpers need from an Evolu instance.
 *
 * Structural, not the real `EvoluInstance`: importing that type would pull
 * ../evolu.js into this module and undo the reason pure.ts exists.
 */
export interface QueryableEvolu {
  createQuery: (build: any) => any;
  loadQuery: (query: any) => Promise<unknown>;
}

/**
 * A shared project, as far as the guard needs to know it.
 *
 * Deliberately carries no `ownerSecret`: deciding whether a project is shared
 * must not require handling the secret that decrypts it.
 */
export interface SharedProjectRefLite {
  readonly projectId: string;
  readonly code: string | null;
  readonly name: string | null;
}

const SHARED_TOOL_BY_PERSONAL: Record<string, string> = {
  td_create_task: "td_create_shared_task",
  td_update_task: "td_update_shared_task",
  td_delete_task: "td_delete_shared_task",
  td_bulk_update_tasks: "td_bulk_update_shared_tasks",
  td_bulk_delete_tasks: "td_bulk_delete_shared_tasks",
  td_add_worklog: "td_add_shared_worklog",
  td_create_task_comment: "td_create_shared_task_comment",
  td_create_checklist_item: "td_create_shared_checklist_item",
};

/** The shared tool that should have been called instead. */
export function sharedCounterpartTool(personalTool: string): string {
  return SHARED_TOOL_BY_PERSONAL[personalTool] ?? "the matching td_*_shared_* tool";
}

/**
 * Refuse a personal write aimed at a project that is shared.
 *
 * If a project is shared, its data belongs in the shared instance. Routing used
 * to be decided by which tool the caller picked rather than by the project, so
 * a personal write against a shared project was accepted and stored beside the
 * real row - same task, two instances, free to drift. The app reads the shared
 * side, so the two then disagreed with nothing reporting it. (TODO-318)
 *
 * A missing projectId is not a failure here: the caller may simply not be
 * changing the project, and inventing an error for that would block ordinary
 * edits.
 */
export function assertNotSharedProject(
  projectId: unknown,
  sharedRefs: readonly SharedProjectRefLite[],
  personalTool: string,
): void {
  if (projectId == null || projectId === "") return;
  const match = sharedRefs.find((r) => r.projectId === projectId);
  if (!match) return;
  const label = match.code ? `${match.code} (${match.name ?? "?"})` : (match.name ?? globalThis.String(projectId));
  throw new Error(
    `${personalTool}: project ${label} is a shared project, so its tasks live in the shared instance. ` +
      `Writing here would create a second copy that the app never shows and that silently drifts from the real one. ` +
      `Use ${sharedCounterpartTool(personalTool)} instead. (TODO-318)`,
  );
}

/**
 * Turn whatever Evolu reported as a panic into one readable line.
 *
 * `reportDefect` does not receive an Error. On 8.9.0 it receives a panic
 * envelope, measured as `{ type, reason }`, and the reason can wrap the real
 * cause again under `reason`, `defect`, `error` or `cause`. `String()` on that
 * gives "[object Object]", so the message explaining a dead worker would have
 * explained nothing.
 *
 * Walks down to the innermost thing that carries a message, keeping the outer
 * `type` as context because "AbortError" and "SqliteError: ..." answer
 * different halves of the question. (TODO-317)
 */
export function describeDefect(reported: unknown, depth = 0): string {
  if (depth > 6) return "(defect nested too deep to describe)";
  if (reported == null) return `(no defect detail: ${globalThis.String(reported)})`;
  if (typeof reported === "string") return reported;
  if (reported instanceof Error) return reported.message || reported.name;
  if (typeof reported !== "object") return globalThis.String(reported);

  const record = reported as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : null;

  for (const key of ["reason", "defect", "error", "cause"] as const) {
    const inner = record[key];
    // Guard against a cycle: an envelope pointing at itself would otherwise
    // recurse until the depth cap and report nothing useful.
    if (inner != null && inner !== reported) {
      const described = describeDefect(inner, depth + 1);
      return type ? `${type}: ${described}` : described;
    }
  }

  if (typeof record.message === "string" && record.message) {
    return type ? `${type}: ${record.message}` : record.message;
  }

  let json: string;
  try {
    json = JSON.stringify(reported);
  } catch {
    json = "(unserialisable defect)";
  }
  if (!json || json === "{}") json = "(defect carried no detail)";
  return type ? `${type}: ${json}` : json;
}

/**
 * How long to wait for the dbWorker before giving up on a query.
 *
 * A stalled worker never answers at all, so without a bound the promise never
 * settles and the MCP client waits until *it* gives up, which is 1800s.
 */
export const LOAD_QUERY_TIMEOUT_MS = 15000;

/**
 * Race one `loadQuery` against the clock.
 *
 * Takes the load function rather than the instance so the instance wrapper
 * below can pass the *original* method in without recursing into itself.
 *
 * The timer is cleared in `finally`. The previous version never cleared it, so
 * every answered query still held a 15s timer and its reject closure alive.
 */
export async function loadQueryWithTimeout(
  load: (query: any) => Promise<unknown>,
  query: any,
  timeoutMs = LOAD_QUERY_TIMEOUT_MS,
): Promise<any> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      load(query),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`loadQuery timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Put the bound on the instance itself, so every call site gets it.
 *
 * Wrapping call by call was the old approach and it only ever covered 20 of
 * the 121: the other 101 went straight at `evolu.loadQuery` and hung forever
 * when the worker stalled. One fault showed up as two different symptoms
 * depending on which helper the tool happened to use. (TODO-316)
 */
export function withLoadQueryTimeout<T extends { loadQuery: (query: any) => Promise<unknown> }>(
  instance: T,
  timeoutMs = LOAD_QUERY_TIMEOUT_MS,
  getFatalReason?: () => string | null,
): T {
  const original = instance.loadQuery.bind(instance);
  return Object.assign(instance, {
    loadQuery: (query: any) => {
      // Checked per call, not once at wrap time: the worker is alive when the
      // instance is built and dies later, which is the whole of TODO-317.
      const fatal = getFatalReason?.();
      if (fatal != null) return Promise.reject(new Error(fatal));
      return loadQueryWithTimeout(original, query, timeoutMs);
    },
  });
}

/**
 * Wrapper around evolu.loadQuery with a timeout to prevent infinite hangs.
 *
 * Kept for the call sites that already use it. Now that `withLoadQueryTimeout`
 * bounds the instance, this is belt and braces rather than the only guard.
 */
export async function safeLoadQuery(evolu: QueryableEvolu, query: any, timeoutMs = LOAD_QUERY_TIMEOUT_MS): Promise<any[]> {
  return (await loadQueryWithTimeout((q) => evolu.loadQuery(q), query, timeoutMs)) as any[];
}

/**
 * Refuse to write to a row that is not there.
 *
 * Evolu's `update()` compiles to `on conflict ("ownerId","id") do update`, so an
 * id nobody has ever seen is not an error - it inserts. An update aimed at a
 * mistyped or stale id therefore creates a fresh row holding only the fields
 * that were being changed, and reports success. (TODO-292, and the same
 * reasoning as the bulk guards in TODO-285.)
 *
 * Deliberately does **not** filter on `isDeleted`: `td_update_task` with
 * `isDeleted: false` is how a task is restored from the trash, and a check that
 * skipped deleted rows would refuse exactly that.
 */
export async function assertRowExists(
  evolu: QueryableEvolu,
  table: string,
  id: string,
  label = table,
  ownerId?: string,
  /**
   * Treat a soft-deleted row as absent.
   *
   * Off by default, because the callers that came first use this to guard an
   * update, where refusing to touch a trashed row would be a behaviour change.
   * The child-entity tools want it on: attaching a comment to a task in the
   * bin is the same mistake as attaching one to a task that never existed.
   * (TODO-300)
   */
  excludeDeleted = false,
): Promise<void> {
  const query = evolu.createQuery((db: any) => {
    let q = db.selectFrom(table).select(["id"]).where("id", "=", id as never);
    // Shared-project data is partitioned by owner in one instance, so an id
    // alone would also match a row in somebody else's project.
    if (ownerId) q = q.where("ownerId", "=", ownerId as never);
    // The literal, not the SQLITE_TRUE constant: pure.ts stays free of
    // ../evolu.js imports, which is the whole reason this module exists.
    if (excludeDeleted) q = q.where("isDeleted", "is not", 1 as never);
    return q.limit(1);
  });
  const found = await safeLoadQuery(evolu, query);
  if (!found || found.length === 0) {
    throw new Error(`${label} not found: ${id}`);
  }
}

/**
 * What measured traffic says about whether sync is alive. (TODO-294)
 *
 * `td_sync_status` used to report `ok` whenever a WebSocket could be opened,
 * which answers a different question: on 2026-09-07 the MCP sent the relay
 * nothing for an hour while that tool insisted all was well. The only way to
 * tell was from outside, on the relay, by the owner's `lastTimestamp`.
 *
 * The verdict therefore rests on the only things that say anything about sync:
 * when a frame last left and arrived, and whether a local write has happened
 * since.
 *
 * Silence on its own is not a fault: with nothing written, there is nothing to
 * send. The fault is a **local write newer than the last outgoing frame**,
 * because that means something is waiting and not leaving. Which is what
 * happened.
 */
export interface SyncFreshnessInput {
  /** When a frame last actually left, across all relays. */
  readonly lastOutgoingAt: number | null;
  /** When one last arrived. */
  readonly lastIncomingAt: number | null;
  /** When a local mutation last happened. */
  readonly lastLocalMutationAt: number | null;
  readonly now: number;
  /** How long a write may wait before it counts as a fault. Defaults to 60s. */
  readonly staleAfterMs?: number;
}

export type SyncVerdict = "ok" | "stale" | "idle" | "never-synced";

export interface SyncFreshness {
  readonly verdict: SyncVerdict;
  readonly reason: string;
  /** How long the oldest unsent write has been waiting, or null. */
  readonly pendingForMs: number | null;
  readonly quietForMs: number | null;
}

export const SYNC_STALE_AFTER_MS = 60_000;

export function judgeSyncFreshness(input: SyncFreshnessInput): SyncFreshness {
  const { lastOutgoingAt, lastIncomingAt, lastLocalMutationAt, now } = input;
  const staleAfterMs = input.staleAfterMs ?? SYNC_STALE_AFTER_MS;

  const lastTraffic = Math.max(lastOutgoingAt ?? 0, lastIncomingAt ?? 0) || null;
  const quietForMs = lastTraffic === null ? null : now - lastTraffic;

  // A local write that never left. This is the fault.
  const pending =
    lastLocalMutationAt !== null &&
    (lastOutgoingAt === null || lastLocalMutationAt > lastOutgoingAt);
  const pendingForMs = pending ? now - lastLocalMutationAt : null;

  if (pending && pendingForMs !== null && pendingForMs > staleAfterMs) {
    return {
      verdict: "stale",
      reason:
        `lokalni zapis ceka ${Math.round(pendingForMs / 1000)} s a nic neodeslo` +
        (lastOutgoingAt === null ? " (od startu neodesel zadny ramec)" : ""),
      pendingForMs,
      quietForMs,
    };
  }

  if (lastTraffic === null) {
    return {
      verdict: lastLocalMutationAt === null ? "never-synced" : "ok",
      reason:
        lastLocalMutationAt === null
          ? "od startu neproteklo nic a nic se nezapsalo"
          : "zapis je novy, jeste nemusel odejit",
      pendingForMs,
      quietForMs,
    };
  }

  if (!pending && quietForMs !== null && quietForMs > staleAfterMs) {
    // Ticho bez cekajiciho zapisu je normalni stav necinnosti, ne vada.
    return { verdict: "idle", reason: `nic se nedeje ${Math.round(quietForMs / 1000)} s`, pendingForMs, quietForMs };
  }

  return { verdict: "ok", reason: "provoz je aktualni", pendingForMs, quietForMs };
}

/**
 * Has this socket stopped answering long enough to be considered dead?
 * (TODO-295)
 *
 * Pulled out of the WebSocket subclass so the decision can be tested. The
 * teardown around it cannot: a genuinely half-open socket is what this
 * detects, and `ws` answers pings below the application layer, so a local
 * server cannot pretend to be one.
 *
 * `lastPongAt` is set when the socket opens as well as on every pong, so a
 * connection that has never been answered is judged from when it opened rather
 * than from the epoch.
 */
export function isSocketUnanswered(
  lastPongAt: number,
  now: number,
  timeoutMs: number,
): boolean {
  // A clock that jumped backwards must not read as a timeout.
  if (now < lastPongAt) return false;
  return now - lastPongAt > timeoutMs;
}

// --- Project and task codes (TODO-434) ---

/**
 * The app's rule for a project code (`Modal.vue`): upper-case letters and
 * digits, nothing else. The MCP stored whatever it was given, and a code is
 * the prefix of every task code in the project, so a space or a dot there
 * produced task codes the app's own `^([A-Z0-9]+)-\d+$` never recognises.
 */
export const PROJECT_CODE_PATTERN = /^[A-Z0-9]+$/;

/** Refuse a project code the app would not accept. Null/undefined pass: no code. */
export function assertValidProjectCode(code: string | null | undefined): void {
  if (code === null || code === undefined || code === "") return;
  if (!PROJECT_CODE_PATTERN.test(code)) {
    throw new Error(
      `Invalid project code "${code}": use only upper-case letters A-Z and digits 0-9 (e.g. "${
        code.toUpperCase().replace(/[^A-Z0-9]/g, "") || "PROJ"
      }").`,
    );
  }
}

/** Escape a string for literal use inside a RegExp. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The next task code for `projectCode`: one past the highest number in use.
 *
 * The code goes into a regular expression, so it is escaped first, as the
 * app's `getNextTaskNumber` does. Codes stored before validation existed can
 * still hold metacharacters, and `A.B` unescaped matches `AXB-7` and hands out
 * a number belonging to another prefix.
 */
export function nextTaskCode(projectCode: string, titles: readonly (string | null | undefined)[]): string {
  const regex = new RegExp(`^${escapeRegExp(projectCode)}-(\\d+)$`);
  let max = 0;
  for (const title of titles) {
    const match = title?.match(regex);
    if (match) max = Math.max(max, parseInt(match[1]!, 10));
  }
  return `${projectCode}-${max + 1}`;
}

/** Refuse an explicit task code that does not fit the project or is taken. */
export function assertTaskCodeForProject(
  code: string,
  projectCode: string,
  titles: readonly (string | null | undefined)[],
): void {
  if (!new RegExp(`^${escapeRegExp(projectCode)}-\\d+$`).test(code)) {
    throw new Error(`Code "${code}" does not match project format "${projectCode}-NNN"`);
  }
  if (titles.includes(code)) {
    throw new Error(`Code "${code}" is already used by another task`);
  }
}

/**
 * Run `fn` with no other call for the same key in flight. (TODO-434)
 *
 * td_create_task derives the code from the highest one it can see, then
 * inserts. Two calls for one project arriving together both read the same
 * maximum and both hand out `PROJ-12`. Each call waits for the previous one
 * for its key; different keys do not wait for each other. A rejection is
 * passed to its own caller and does not stall the queue.
 */
export function createKeyedMutex() {
  const tails = new Map<string, Promise<unknown>>();
  return async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(fn);
    const tail = run.catch(() => undefined);
    tails.set(key, tail);
    try {
      return await run;
    } finally {
      // Only the last caller in line clears the entry, so the map does not grow.
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
}

/** One lock for every task-code allocation in this process. */
export const withTaskCodeLock = createKeyedMutex();

// --- Picking a shared owner's project row (TODO-434) ---

/** The columns pickSharedProjectRow reads. */
export interface SharedProjectRowLike {
  readonly id?: unknown;
  readonly ownerId?: unknown;
  readonly isDeleted?: unknown;
  readonly createdAt?: unknown;
}

function rowIsDeleted(row: SharedProjectRowLike): boolean {
  // Evolu spells true as 1 and false as null, and an un-delete writes 0.
  return row.isDeleted === 1 || row.isDeleted === true;
}

function olderFirst(a: SharedProjectRowLike, b: SharedProjectRowLike): number {
  const aAt = typeof a.createdAt === "string" ? a.createdAt : "";
  const bAt = typeof b.createdAt === "string" ? b.createdAt : "";
  if (aAt !== bAt) {
    // A row without createdAt sorts last rather than winning by accident.
    if (!aAt) return 1;
    if (!bAt) return -1;
    return aAt < bAt ? -1 : 1;
  }
  return String(a.id) < String(b.id) ? -1 : 1;
}

/**
 * The one `project` row to use for a shared owner, ported from the app's
 * `src/db/sharedProjectRow.ts` (TODO-401).
 *
 * A restore can leave a shared owner with two project rows. td_update_shared_project
 * took `projects[0]`, whatever order SQLite returned, so the MCP could edit one
 * row while the app read the other. The app's rule: the oldest live row by
 * `createdAt`, ties broken by id, so every client picks the same one.
 *
 * `includeDeleted` is for restoring from the Trash, where every row is
 * deleted and the one to bring back is chosen by the same order.
 */
export function pickSharedProjectRow<T extends SharedProjectRowLike>(
  rows: readonly T[] | null | undefined,
  sharedOwnerId: string,
  options: { includeDeleted?: boolean } = {},
): T | null {
  const owned = (rows ?? []).filter((row) => (row.ownerId as string | undefined) === sharedOwnerId);
  const alive = owned.filter((row) => !rowIsDeleted(row));
  const pool = alive.length > 0 ? alive : options.includeDeleted ? owned : [];
  return [...pool].sort(olderFirst)[0] ?? null;
}
