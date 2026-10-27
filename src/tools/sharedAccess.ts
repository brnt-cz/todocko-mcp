/**
 * The one way into a shared project. (TODO-434)
 *
 * Every shared tool used to call `getSharedOwner(sharedOwnerId, ownerSecret)`
 * itself, which answered only "does this secret open this owner". Two things
 * were missing, both now decided here so no tool can skip them:
 *
 * - **Permission.** The user's own `projectRef` says what they may do in the
 *   project. Writes need `canWrite`, project management needs owner or admin,
 *   exactly as the app's `permissions.ts` decides (ported to ../permissions.ts).
 * - **The secret.** It is in that same `projectRef`, so callers no longer have
 *   to pass it. Every shared call used to carry the key to the whole project
 *   through the LLM context and its transcripts; now it can stay in the
 *   database. A secret that is passed is still checked against the id by
 *   getSharedOwner, so the old calling convention keeps working.
 *
 * Activity logging for shared writes lives here too, because it needs the
 * same owner and must go to the shared instance, never the personal one.
 */
import {
  SQLITE_TRUE,
  type TaskId,
  getEvolu,
  getProjectEvolu,
  getSharedOwner,
  getAppOwnerId,
} from "../evolu.js";
import { pickProjectRef, sharedAccessRefusal, type SharedAccess } from "../permissions.js";
import { diffTaskFields, diffProjectFields } from "../utils/activityLog.js";

type SharedOwner = ReturnType<typeof getSharedOwner>;

/**
 * How every shared tool describes `ownerSecret` since it became optional.
 * Telling the model to leave it out is the point: a secret that is never sent
 * never lands in a transcript. (TODO-434)
 */
export const OWNER_SECRET_DESCRIPTION =
  "Optional, leave it out: the secret is looked up from your projectRef by sharedOwnerId. " +
  "Accepted for backwards compatibility and then checked against sharedOwnerId.";

/** The arguments every shared tool takes to name its project. */
export interface SharedOwnerArgs {
  sharedOwnerId: string;
  /** Optional since TODO-434: looked up from projectRef when omitted. */
  ownerSecret?: string;
}

/** The user's own reference to a shared project, as the gate reads it. */
export interface SharedProjectRefRow {
  name: string | null;
  permission: string | null;
  isOwner: boolean;
  ownerSecret: string | null;
  writeKey: string | null;
}

/** The user's reference to this shared project, or null when they have none. */
export async function loadSharedProjectRef(sharedOwnerId: string): Promise<SharedProjectRefRow | null> {
  const evolu = getEvolu();
  if (!evolu) throw new Error("Evolu not initialized");
  const query = evolu.createQuery((db: any) =>
    db
      .selectFrom("projectRef")
      .select(["name", "permission", "isOwner", "ownerSecret", "writeKey"])
      .where("sharedOwnerId", "=", sharedOwnerId)
      .where("isDeleted", "is not", SQLITE_TRUE),
  );
  const rows = ((await evolu.loadQuery(query)) as any[]).map((r) => ({
    name: (r.name as string) ?? null,
    permission: (r.permission as string) ?? null,
    isOwner: r.isOwner === SQLITE_TRUE,
    ownerSecret: (r.ownerSecret as string) ?? null,
    writeKey: (r.writeKey as string) ?? null,
  }));
  return pickProjectRef(rows);
}

/**
 * Check the user may do `access` in this shared project, and open its owner.
 *
 * Throws before anything is written when the permission is missing, so a
 * refused call leaves no trace. `read` is not gated (holding the secret is
 * already holding the data), but it still finds the secret for the caller.
 */
export async function resolveSharedOwner(args: SharedOwnerArgs, access: SharedAccess): Promise<SharedOwner> {
  if (typeof args.sharedOwnerId !== "string" || args.sharedOwnerId.length === 0) {
    throw new Error("sharedOwnerId is required (from td_list_shared_projects)");
  }
  const ref = await loadSharedProjectRef(args.sharedOwnerId);
  const refusal = sharedAccessRefusal(ref, access);
  if (refusal) throw new Error(refusal);
  const secret = args.ownerSecret || ref?.ownerSecret;
  if (!secret) {
    throw new Error(
      `No shared project ${args.sharedOwnerId} among your project references. ` +
        "Use a sharedOwnerId from td_list_shared_projects.",
    );
  }
  return getSharedOwner(args.sharedOwnerId, secret);
}

// --- Activity in shared projects ---

type ActivityAction = "created" | "updated" | "deleted" | "added" | "removed" | "checked" | "unchecked";
type ActivityEntityType =
  | "task" | "project" | "attachment" | "worklog" | "tag" | "link" | "member"
  | "deploymentStage" | "repositoryLink" | "comment" | "checklistItem";

export interface SharedActivity {
  taskId?: string | null;
  action: ActivityAction;
  entityType: ActivityEntityType;
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Write one activity row into the shared project, the app's `logActivity`
 * routed to the shared instance.
 *
 * Shared writes from the MCP left no history at all, so the project feed every
 * member reads showed nothing for them. `actorId` is the user's app owner id,
 * which is what the app puts there, so the entry is attributed to the person
 * and not to an anonymous "MCP". `source: "mcp"` in metadata says how it was
 * made, as the personal log already does.
 *
 * Never throws: the change itself has been made by now, and losing a history
 * row is the lesser harm than reporting a successful write as failed.
 */
export function logSharedActivity(sharedOwner: SharedOwner, params: SharedActivity): void {
  try {
    const projectEvolu = getProjectEvolu();
    if (!projectEvolu) return;
    projectEvolu.insert(
      "activityLog",
      {
        taskId: (params.taskId ?? null) as TaskId | null,
        actorId: getAppOwnerId(),
        action: params.action,
        entityType: params.entityType,
        field: params.field ?? null,
        oldValue: params.oldValue ?? null,
        newValue: params.newValue ?? null,
        metadata: JSON.stringify({ ...(params.metadata ?? {}), source: "mcp" }),
      } as any,
      { owner: sharedOwner },
    );
  } catch {
    // See above: history is best effort.
  }
}

/** One `updated` row per tracked task field that changed, as the app's logSharedTaskChanges. */
export function logSharedTaskChanges(
  sharedOwner: SharedOwner,
  taskId: string,
  oldData: Record<string, unknown>,
  newData: Record<string, unknown>,
): void {
  for (const change of diffTaskFields(oldData, newData)) {
    logSharedActivity(sharedOwner, { taskId, action: "updated", entityType: "task", ...change });
  }
}

/** One `updated` row per tracked project field that changed, as the app's logProjectChanges. */
export function logSharedProjectChanges(
  sharedOwner: SharedOwner,
  oldData: Record<string, unknown>,
  newData: Record<string, unknown>,
): void {
  for (const change of diffProjectFields(oldData, newData)) {
    logSharedActivity(sharedOwner, { taskId: null, action: "updated", entityType: "project", ...change });
  }
}
