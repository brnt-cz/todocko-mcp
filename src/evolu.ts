/**
 * Evolu integration for Todocko MCP Server
 *
 * This creates a proper Node.js Evolu instance using createDbWorkerForPlatform
 * with all required platform dependencies.
 */

import WebSocket from "ws";
import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";
import { homedir } from "os";

// WebSocket polyfill for Node.js — Evolu calls `new WebSocket(url)` without
// options, so the Node `ws` library doesn't send an Origin header by default.
// We advertise a fixed Origin so the relay can whitelist this MCP specifically
// instead of having to allow all originless clients (`no-origin`). See TODO-169.
const TODOCKO_MCP_ORIGIN = "https://todocko-mcp";

class TodockoMcpWebSocket extends WebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols, { origin: TODOCKO_MCP_ORIGIN });
  }
}

globalThis.WebSocket = TodockoMcpWebSocket as unknown as typeof globalThis.WebSocket;

import {
  createEvolu,
  createOwnerWebSocketTransport,
  createQueryBuilder,
  type Evolu,
  type EvoluSchema,
  type OwnerWebSocketTransport,
} from "@evolu/common/local-first";
import { createNodeEvoluDeps } from "./evoluPlatform.js";
import {
  id,
  nullOr,
  NonEmptyTrimmedString100,
  NonEmptyTrimmedString1000,
  SqliteBoolean,
  Int,
  String,
  createRun,
  AppName,
  Mnemonic,
} from "@evolu/common";
import { createAppOwner, mnemonicToOwnerSecret, OwnerSecret as OwnerSecretType, type AppOwner } from "@evolu/common/local-first";
import { createIdFromString } from "@evolu/common";

// Re-create schema for MCP server (mirrors main app)
export const ProjectId = id("Project");
export type ProjectId = typeof ProjectId.Output;

export const TaskId = id("Task");
export type TaskId = typeof TaskId.Output;

export const UserId = id("User");
export type UserId = typeof UserId.Output;

export const AttachmentId = id("Attachment");
export type AttachmentId = typeof AttachmentId.Output;

export const WorklogId = id("Worklog");
export type WorklogId = typeof WorklogId.Output;

export const TaskLinkId = id("TaskLink");
export type TaskLinkId = typeof TaskLinkId.Output;

export const DeploymentStageId = id("DeploymentStage");
export type DeploymentStageId = typeof DeploymentStageId.Output;

export const ProjectRefId = id("ProjectRef");
export type ProjectRefId = typeof ProjectRefId.Output;

export const ProjectMemberId = id("ProjectMember");
export type ProjectMemberId = typeof ProjectMemberId.Output;

export const NotificationReadId = id("NotificationRead");
export type NotificationReadId = typeof NotificationReadId.Output;

export const RepositoryLinkId = id("RepositoryLink");
export type RepositoryLinkId = typeof RepositoryLinkId.Output;

export const TaskCommentId = id("TaskComment");
export type TaskCommentId = typeof TaskCommentId.Output;

export const MentionId = id("Mention");
export type MentionId = typeof MentionId.Output;

export const ChecklistItemId = id("ChecklistItem");
export type ChecklistItemId = typeof ChecklistItemId.Output;

export const TaskTemplateId = id("TaskTemplate");
export type TaskTemplateId = typeof TaskTemplateId.Output;

export const KanbanColumnId = id("KanbanColumn");
export type KanbanColumnId = typeof KanbanColumnId.Output;

export const SavedViewId = id("SavedView");
export type SavedViewId = typeof SavedViewId.Output;

export const ActivityLogId = id("ActivityLog");
export type ActivityLogId = typeof ActivityLogId.Output;

export const TagId = id("Tag");
export type TagId = typeof TagId.Output;

export const TaskTagId = id("TaskTag");
export type TaskTagId = typeof TaskTagId.Output;

export const LocalProjectNoteId = id("LocalProjectNote");
export type LocalProjectNoteId = typeof LocalProjectNoteId.Output;

export const ProjectNoteId = id("ProjectNote");
export type ProjectNoteId = typeof ProjectNoteId.Output;

export const NoteAttachmentId = id("NoteAttachment");
export type NoteAttachmentId = typeof NoteAttachmentId.Output;

export const LocalNoteAttachmentId = id("LocalNoteAttachment");
export type LocalNoteAttachmentId = typeof LocalNoteAttachmentId.Output;

export const Schema = {
  user: {
    id: UserId,
    name: NonEmptyTrimmedString100,
    email: nullOr(String),
    avatarUrl: nullOr(String),
    color: String,
    passwordHash: nullOr(String),
    role: nullOr(String),
    theme: nullOr(String),
  },
  project: {
    id: ProjectId,
    name: NonEmptyTrimmedString100,
    code: nullOr(NonEmptyTrimmedString100),
    color: String,
    isArchived: nullOr(SqliteBoolean),
    isHiddenFromFilters: nullOr(SqliteBoolean),
    autoApproveMembers: nullOr(SqliteBoolean),
    position: Int,
  },
  task: {
    id: TaskId,
    projectId: nullOr(ProjectId),
    assigneeId: nullOr(UserId),
    title: NonEmptyTrimmedString100,
    name: nullOr(NonEmptyTrimmedString100),
    description: nullOr(String),
    status: String,
    priority: String,
    deadline: nullOr(String),
    scheduledDate: nullOr(String),
    position: Int,
    completedAt: nullOr(String),
    isBlocked: nullOr(SqliteBoolean),
    blockedReason: nullOr(NonEmptyTrimmedString1000),
    estimate: nullOr(Int),
    isOnProduction: nullOr(SqliteBoolean),
    deploymentStageId: nullOr(DeploymentStageId),
    recurrenceType: nullOr(String),
    recurrenceInterval: nullOr(Int),
    recurrenceEndDate: nullOr(String),
    recurrenceDay: nullOr(Int),
    sprintNumber: nullOr(Int),
    parentTaskId: nullOr(TaskId),
    deletedAt: nullOr(String), // trash timestamp, mirrors app (TODO-179/182)
  },
  tag: {
    id: TagId,
    name: NonEmptyTrimmedString100,
    color: String,
    // Mirrors the app (TODO-227). Nullable: rows created before it — including
    // ones this server created — have none, and the app never offers those.
    projectId: nullOr(ProjectId),
    // Mirrors the app (TODO-239): tasks created in the project start with every
    // default tag applied. Nullable — absent means not default.
    isDefault: nullOr(SqliteBoolean),
  },
  taskTag: {
    id: TaskTagId,
    taskId: TaskId,
    tagId: TagId,
  },
  attachment: {
    id: AttachmentId,
    taskId: TaskId,
    filename: NonEmptyTrimmedString100,
    mimeType: String,
    data: nullOr(String),
    size: Int,
  },
  worklog: {
    id: WorklogId,
    taskId: TaskId,
    userId: nullOr(UserId),
    durationMinutes: Int,
    description: nullOr(NonEmptyTrimmedString1000),
    loggedAt: String,
  },
  taskLink: {
    id: TaskLinkId,
    sourceTaskId: TaskId,
    targetTaskId: TaskId,
    linkType: String,
  },
  deploymentStage: {
    id: DeploymentStageId,
    projectId: ProjectId,
    name: NonEmptyTrimmedString100,
    color: String,
    position: Int,
  },
  // Project references for shared projects
  projectRef: {
    id: ProjectRefId,
    projectId: String,
    ownerSecret: String,
    sharedOwnerId: String,
    name: NonEmptyTrimmedString100,
    code: nullOr(NonEmptyTrimmedString100),
    color: String,
    isOwner: nullOr(SqliteBoolean),
    permission: String,
    joinedAt: String,
    isArchived: nullOr(SqliteBoolean),
    isHiddenFromFilters: nullOr(SqliteBoolean),
    autoApproveMembers: nullOr(SqliteBoolean),
  },
  // Task comments
  taskComment: {
    id: TaskCommentId,
    taskId: TaskId,
    userId: nullOr(UserId),
    content: String,
  },
  // @mentions
  mention: {
    id: MentionId,
    mentionedUserId: String,
    mentionedByUserId: nullOr(String),
    taskId: nullOr(TaskId),
    sourceType: String, // 'description' | 'comment'
    sourceId: nullOr(String),
    isRead: nullOr(SqliteBoolean),
  },
  // Checklist items
  checklistItem: {
    id: ChecklistItemId,
    taskId: TaskId,
    title: NonEmptyTrimmedString1000,
    isChecked: nullOr(SqliteBoolean),
    position: Int,
  },
  // Task templates
  taskTemplate: {
    id: TaskTemplateId,
    name: NonEmptyTrimmedString100,
    taskName: nullOr(NonEmptyTrimmedString100),
    description: nullOr(String),
    priority: String,
    estimate: nullOr(Int),
    projectId: nullOr(ProjectId),
    position: Int,
  },
  // Kanban columns
  kanbanColumn: {
    id: KanbanColumnId,
    slug: NonEmptyTrimmedString100,
    name: NonEmptyTrimmedString100,
    color: String,
    icon: String,
    position: Int,
    isDefault: nullOr(SqliteBoolean),
    showInKanban: nullOr(SqliteBoolean),
  },
  // Saved views
  savedView: {
    id: SavedViewId,
    name: NonEmptyTrimmedString100,
    icon: nullOr(String),
    filters: String,
    isBuiltIn: nullOr(SqliteBoolean),
    position: Int,
  },
  // Activity log
  activityLog: {
    id: ActivityLogId,
    taskId: nullOr(TaskId),
    actorId: nullOr(String),
    action: String,
    entityType: String,
    field: nullOr(String),
    oldValue: nullOr(String),
    newValue: nullOr(String),
    metadata: nullOr(String),
  },
  // Local project notes (not synced)
  localProjectNote: {
    id: LocalProjectNoteId,
    projectId: ProjectId,
    title: NonEmptyTrimmedString100,
    content: nullOr(String),
    position: Int,
    isDoc: nullOr(SqliteBoolean),
    parentDocId: nullOr(String),
  },
  localNoteAttachment: {
    id: LocalNoteAttachmentId,
    noteId: LocalProjectNoteId,
    filename: NonEmptyTrimmedString100,
    mimeType: String,
    data: nullOr(String), // Base64 encoded content
    size: Int,
  },
  // Two tables the app has had for a while and this schema did not, so every
  // message about them was quarantined unread: 11 repository links and 26
  // notification read-states, invisible because nothing reports a quarantine.
  // Declaring them lets `tryApplyQuarantinedMessages` apply what was kept.
  // (TODO-267)
  repositoryLink: {
    id: RepositoryLinkId,
    projectId: ProjectId,
    type: String,
    url: NonEmptyTrimmedString1000,
    label: nullOr(NonEmptyTrimmedString100),
    position: Int,
  },
  notificationRead: {
    id: NotificationReadId,
    notificationId: String,
    kind: String, // 'system' | 'message'
  },
};

// Schema for shared projects (todocko-shared database)
export const ProjectSchema = {
  project: {
    id: ProjectId,
    name: NonEmptyTrimmedString100,
    code: nullOr(NonEmptyTrimmedString100),
    color: String,
    isArchived: nullOr(SqliteBoolean),
    isHiddenFromFilters: nullOr(SqliteBoolean),
    autoApproveMembers: nullOr(SqliteBoolean),
    position: Int,
  },
  projectMember: {
    id: ProjectMemberId,
    projectId: ProjectId,
    userAppOwnerId: String,
    userName: NonEmptyTrimmedString100,
    userColor: String,
    userAvatarUrl: nullOr(String),
    permission: String,
    joinedAt: String,
    isKicked: nullOr(SqliteBoolean),
    isBlocked: nullOr(SqliteBoolean),
  },
  task: {
    id: TaskId,
    projectId: nullOr(ProjectId),
    assigneeId: nullOr(String), // AppOwner OwnerId of assignee
    title: NonEmptyTrimmedString100,
    name: nullOr(NonEmptyTrimmedString100),
    description: nullOr(String),
    status: String,
    priority: String,
    deadline: nullOr(String),
    scheduledDate: nullOr(String),
    position: Int,
    completedAt: nullOr(String),
    isBlocked: nullOr(SqliteBoolean),
    blockedReason: nullOr(NonEmptyTrimmedString1000),
    estimate: nullOr(Int),
    isOnProduction: nullOr(SqliteBoolean),
    deploymentStageId: nullOr(DeploymentStageId),
    recurrenceType: nullOr(String),
    recurrenceInterval: nullOr(Int),
    recurrenceEndDate: nullOr(String),
    recurrenceDay: nullOr(Int),
    sprintNumber: nullOr(Int),
    parentTaskId: nullOr(TaskId),
    deletedAt: nullOr(String), // trash timestamp, mirrors app (TODO-179/182)
  },
  tag: {
    id: TagId,
    name: NonEmptyTrimmedString100,
    color: String,
    // Mirrors the app (TODO-227). Nullable: rows created before it — including
    // ones this server created — have none, and the app never offers those.
    projectId: nullOr(ProjectId),
    // Mirrors the app (TODO-239): tasks created in the project start with every
    // default tag applied. Nullable — absent means not default.
    isDefault: nullOr(SqliteBoolean),
  },
  taskTag: {
    id: TaskTagId,
    taskId: TaskId,
    tagId: TagId,
  },
  attachment: {
    id: AttachmentId,
    taskId: TaskId,
    filename: NonEmptyTrimmedString100,
    mimeType: String,
    data: nullOr(String),
    size: Int,
  },
  worklog: {
    id: WorklogId,
    taskId: TaskId,
    userId: nullOr(String),
    durationMinutes: Int,
    description: nullOr(NonEmptyTrimmedString1000),
    loggedAt: String,
  },
  taskLink: {
    id: TaskLinkId,
    sourceTaskId: TaskId,
    targetTaskId: TaskId,
    linkType: String,
  },
  deploymentStage: {
    id: DeploymentStageId,
    projectId: ProjectId,
    name: NonEmptyTrimmedString100,
    color: String,
    position: Int,
  },
  // Repository links (GitHub, GitLab, etc.)
  repositoryLink: {
    id: RepositoryLinkId,
    projectId: ProjectId,
    type: String, // 'github' | 'gitlab' | 'bitbucket' | 'azure' | 'custom'
    url: NonEmptyTrimmedString1000,
    label: nullOr(NonEmptyTrimmedString100),
    position: Int,
  },
  // Project notes (shared, synced)
  projectNote: {
    id: ProjectNoteId,
    projectId: ProjectId,
    title: NonEmptyTrimmedString100,
    content: nullOr(String),
    createdBy: nullOr(String),
    position: Int,
    isDoc: nullOr(SqliteBoolean),
    parentDocId: nullOr(String),
  },
  noteAttachment: {
    id: NoteAttachmentId,
    noteId: ProjectNoteId,
    filename: NonEmptyTrimmedString100,
    mimeType: String,
    data: nullOr(String), // Base64 encoded content
    size: Int,
  },
  // Task comments (rich text discussion, per shared task)
  taskComment: {
    id: TaskCommentId,
    taskId: TaskId,
    userId: nullOr(String), // AppOwner OwnerId of author
    content: String,
  },
  // The app writes activity into shared projects and this schema did not
  // declare the table, so every such message went into quarantine instead:
  // 117 messages, 1053 column rows, and nothing said so. Evolu keeps them
  // precisely for this — `tryApplyQuarantinedMessages` applies them once the
  // schema catches up — so adding the table both empties the quarantine and
  // recovers the history. Shape copied from the app's projectSchema.ts.
  // (TODO-267)
  activityLog: {
    id: ActivityLogId,
    taskId: nullOr(TaskId),
    actorId: nullOr(String),
    action: String,
    entityType: String,
    field: nullOr(String),
    oldValue: nullOr(String),
    newValue: nullOr(String),
    metadata: nullOr(String),
  },
};

export type Schema = typeof Schema;

/**
 * An Evolu instance plus the `createQuery` this file puts back on it.
 *
 * Was `any` "to avoid complex generic issues", and that is exactly why the v8
 * port compiled clean and could not serve a query: 102 calls to a
 * `createQuery` v8 had removed, plus the wrong argument shape for `useOwner`,
 * were all invisible to `tsc`. (TODO-265)
 */
export type EvoluWithQuery<S extends EvoluSchema> = Evolu<S> & {
  readonly createQuery: ReturnType<typeof createQueryBuilder<S>>;
};

export type AppEvolu = EvoluWithQuery<typeof Schema>;
export type ProjectEvoluInstance = EvoluWithQuery<typeof ProjectSchema>;

/**
 * What the tools accept: a real Evolu instance, without pinning which schema.
 *
 * A union of the two concrete instances would be more precise but is not
 * callable — TypeScript will not call a method whose signature differs between
 * union members, and that alone produced 100 errors. Leaving the schema
 * unpinned keeps table and column names unchecked, which is the next step, but
 * the instance API itself is now typed, and that is where every v8 defect
 * sat: a `createQuery` that no longer existed, the wrong argument shape for
 * `useOwner`, and mutations returning `{ id }` rather than a Result.
 */
export type EvoluInstance = EvoluWithQuery<EvoluSchema>;

/**
 * Give an instance its `createQuery` method back, bound to its own schema.
 *
 * v8 moved query building out of the instance into a standalone
 * `createQueryBuilder(schema)`. All 102 call sites in the tools read
 * `evolu.createQuery(...)`, and since `EvoluInstance` is `any`, `tsc` had
 * nothing to object to — the port compiled clean and then failed at runtime
 * with "evolu.createQuery is not a function" on the first query.
 *
 * Restoring the method is a smaller change than rewriting every call site, and
 * binding it per instance is stricter than exporting one builder per schema:
 * an instance cannot be paired with the wrong schema's builder.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function withQueryBuilder(instance: any, schema: any): any {
  return Object.assign(instance, { createQuery: createQueryBuilder(schema) });
}

let evoluInstance: EvoluInstance | null = null;

/**
 * The AppOwner derived from TODOCKO_MNEMONIC.
 *
 * v8 needs it as configuration for every instance, so it is kept here once
 * initEvolu has derived it and reused for the shared-project instance.
 * Never log this — it carries the mnemonic.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let appOwnerForProcess: any = null;

/** The throwaway owner of the shared instance. See deriveProjectInstanceOwner. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let projectAppOwnerForProcess: any = null;

/** The AppOwner for this process, or null before initEvolu has run. */
function getAppOwnerForProjectInstance() {
  return appOwnerForProcess;
}

/**
 * A throwaway identity for the shared-project instance — deliberately not the
 * user's.
 *
 * v8 makes `appOwner` mandatory, and two instances declaring the same owner
 * both subscribe to that owner's message stream. The one whose schema does not
 * match quarantines every message it receives, and nothing says a word about
 * it: measured here at 24 404 rows in the shared instance, all of them
 * AppOwnerSchema tables (activityLog, kanbanColumn, localProjectNote…) that
 * ProjectSchema has never heard of, and still growing by hundreds a day. The
 * app hit the same thing during the v8 port and solved it the same way
 * (`loadOrCreateAppOwner('shared')` in ownerManager.ts). (TODO-267, TODO-88)
 *
 * Derived rather than random, because the database is named after the owner id
 * — a fresh identity each start would mean a fresh empty database each start.
 * Derived from the mnemonic rather than stored in a file, because there is
 * then nothing to keep in sync, back up, or lose. The label makes it a
 * different owner from the user's while staying stable for this machine.
 */
function deriveProjectInstanceOwner(mnemonic: typeof Mnemonic.Output) {
  const digest = createHash("sha256")
    .update(`todocko-mcp/shared-instance/v1\n${mnemonic as unknown as string}`)
    .digest();
  return createAppOwner(OwnerSecretType.orThrow(new Uint8Array(digest)));
}

// Database name - must match main app (src/db/appEvolu.ts)
const DB_NAME = "todocko";

// Evolu relay servers (same as main app)
/**
 * Where sync goes. `TODOCKO_RELAY_URL` used to reach only the HTTP tools
 * (tier warnings, system notifications) while this list stayed hard-wired to
 * production, so there was no way to run this server against a local relay —
 * and no way to give the error tracking below a positive control, which needs
 * a relay that cannot be reached. The scheme is swapped the way the app does
 * it: https to wss, http to ws. A bare host falls back to production rather
 * than guessing at TLS. (TODO-266)
 */
const RELAY_SERVERS = ((raw: string): string[] => {
  if (raw.startsWith("wss://") || raw.startsWith("ws://")) return [raw.replace(/\/$/, "")];
  if (raw.startsWith("https://")) return [raw.replace(/^https:\/\//, "wss://").replace(/\/$/, "")];
  if (raw.startsWith("http://")) return [raw.replace(/^http:\/\//, "ws://").replace(/\/$/, "")];
  return ["wss://relay.todocko.cz"];
})(process.env.TODOCKO_RELAY_URL || "wss://relay.todocko.cz");

// --- Sync Health Tracking ---

interface SyncHealth {
  lastError: string | null;
  lastErrorAt: Date | null;
  errorCount: number;
  wsConnectivity: Map<string, 'untested' | 'ok' | 'failed'>;
  evoluReady: boolean;
  onCompleteCount: number;
  /** Per-table count of incoming change events observed via subscribeQuery. */
  incomingChangesByTable: Map<string, number>;
}

const syncHealth: SyncHealth = {
  lastError: null,
  lastErrorAt: null,
  errorCount: 0,
  wsConnectivity: new Map(RELAY_SERVERS.map(url => [url, 'untested' as const])),
  evoluReady: false,
  onCompleteCount: 0,
  incomingChangesByTable: new Map(),
};

/**
 * Get current sync health status for diagnostics
 */
export function getSyncHealth(): {
  lastError: string | null;
  lastErrorAt: string | null;
  errorCount: number;
  wsConnectivity: Record<string, string>;
  evoluReady: boolean;
  onCompleteCount: number;
  relayServers: string[];
} {
  return {
    lastError: syncHealth.lastError,
    lastErrorAt: syncHealth.lastErrorAt?.toISOString() ?? null,
    errorCount: syncHealth.errorCount,
    wsConnectivity: Object.fromEntries(syncHealth.wsConnectivity),
    evoluReady: syncHealth.evoluReady,
    onCompleteCount: syncHealth.onCompleteCount,
    relayServers: RELAY_SERVERS,
  };
}

/**
 * Rows sitting in each instance's quarantine.
 *
 * This is the sync failure Evolu actually surfaces. A message it receives but
 * cannot apply — a table or column this schema does not know — goes into
 * `evolu_message_quarantine` and nothing is logged, so the only way to see it
 * is to count the table. Measured on this machine while writing it: 151 rows
 * in the app instance and 24 368 in the shared one, still growing daily, which
 * no diagnostic tool could have told you. (TODO-266)
 *
 * Counted in SQL rather than fetched: 24 000 rows is not something to
 * materialise for a health check.
 */
export async function getQuarantineCounts(): Promise<{ app: number | null; project: number | null }> {
  const count = async (evolu: EvoluInstance | null): Promise<number | null> => {
    if (!evolu) return null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table is not in the schema
      const query = evolu.createQuery((db: any) =>
        db.selectFrom("evolu_message_quarantine").select((eb: any) => eb.fn.countAll().as("n")),
      );
      const rows = (await evolu.loadQuery(query)) as { n?: number }[];
      return Number(rows[0]?.n ?? 0);
    } catch {
      // The table only exists once Evolu has created it; absence is not a fault.
      return null;
    }
  };
  const [app, project] = await Promise.all([count(evoluInstance), count(projectEvoluInstance)]);
  return { app, project };
}

/** Track onComplete calls from mutations */
export function trackOnComplete(): void {
  syncHealth.onCompleteCount++;
}

/**
 * Subscribe to a small per-table count() query and increment the per-table
 * change counter every time Evolu signals the result changed.
 *
 * subscribeQuery only fires when a query's result differs from the previous
 * value, so a `select count(*) from <table>` query gives us a cheap proxy for
 * "something in this table was inserted or deleted via local mutation or
 * incoming sync". It misses pure updates that don't change the row count,
 * which is acceptable for a force-sync probe — those will still be visible to
 * the next read after the wait elapses.
 */
function attachChangeTrackers(evolu: EvoluInstance, tableNames: readonly string[]): void {
  for (const table of tableNames) {
    try {
      // Subscribe to `count(*)` of the table. Evolu's makePatches compares
      // row values with eqSqliteValue, so when the count changes a patch is
      // emitted, the row store gets a new reference and the listener fires.
      // (We initially tried `select id order by id desc limit 1`, but Evolu's
      // generated ids are not monotonic in lexicographic order, so the result
      // often didn't change on insert.)
      const query = evolu.createQuery((db: any) =>
        db.selectFrom(table).select((eb: any) => eb.fn.countAll().as("cnt")),
      );
      evolu.loadQuery(query).catch(() => {});
      evolu.subscribeQuery(query)(() => {
        const next = (syncHealth.incomingChangesByTable.get(table) ?? 0) + 1;
        syncHealth.incomingChangesByTable.set(table, next);
      });
    } catch (err) {
      console.error(`[force-sync] could not attach tracker for ${table}:`, err);
    }
  }
}

/**
 * Force a sync round-trip with the relay.
 *
 * Strategy:
 * 1. Optionally re-test WebSocket connectivity so the caller knows the relay
 *    is reachable at this exact moment.
 * 2. Snapshot the per-table change counters.
 * 3. Wait `waitMs` for incoming sync messages to settle.
 * 4. Return the diff so the caller knows which tables saw activity.
 */
export async function forceSync(args: { waitMs?: number; reconnect?: boolean }): Promise<unknown> {
  const evolu = getEvolu();
  if (!evolu) {
    return { error: "Evolu not initialized" };
  }

  const waitMs = Math.max(200, Math.min(args.waitMs ?? 3000, 30000));
  const reconnect = args.reconnect ?? true;

  const snapshot = (): Record<string, number> =>
    Object.fromEntries(syncHealth.incomingChangesByTable);

  const before = snapshot();
  const beforeErrors = syncHealth.errorCount;
  const startedAt = Date.now();

  if (reconnect) {
    await testWebSocketConnectivity();
  }

  await new Promise((resolve) => setTimeout(resolve, waitMs));

  const after = snapshot();
  const changedTables: Record<string, number> = {};
  const allTables = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const table of allTables) {
    const delta = (after[table] ?? 0) - (before[table] ?? 0);
    if (delta > 0) changedTables[table] = delta;
  }

  return {
    waitedMs: Date.now() - startedAt,
    reconnected: reconnect,
    wsConnectivity: Object.fromEntries(syncHealth.wsConnectivity),
    changedTables,
    newErrors: syncHealth.errorCount - beforeErrors,
    lastError: syncHealth.lastError,
    hint:
      Object.keys(changedTables).length > 0
        ? "Incoming changes detected — query the affected tables to read the fresh data."
        : "No change events observed during the wait. Either nothing changed, or changes were updates that don't move row counts — querying tables you suspect of having edits will still return the latest state.",
  };
}

/**
 * Test WebSocket connectivity to relay servers.
 * Opens a WebSocket to each server and checks if the connection is established.
 */
export async function testWebSocketConnectivity(): Promise<Record<string, string>> {
  const results: Record<string, string> = {};

  const tests = RELAY_SERVERS.map(async (url) => {
    try {
      const ws = new WebSocket(url);
      const result = await new Promise<string>((resolve) => {
        const timeout = setTimeout(() => {
          try { ws.close(); } catch {}
          resolve('timeout (5s)');
        }, 5000);

        ws.onopen = () => {
          clearTimeout(timeout);
          ws.close();
          resolve('ok');
        };

        ws.onerror = (err: any) => {
          clearTimeout(timeout);
          try { ws.close(); } catch {}
          resolve(`error: ${err.message || 'unknown'}`);
        };
      });

      results[url] = result;
      syncHealth.wsConnectivity.set(url, result === 'ok' ? 'ok' : 'failed');
    } catch (err) {
      results[url] = `exception: ${err instanceof Error ? err.message : globalThis.String(err)}`;
      syncHealth.wsConnectivity.set(url, 'failed');
    }
  });

  await Promise.all(tests);
  return results;
}

/**
 * Get the Todocko data directory (~/.todocko)
 */
function getTodockoDir(): string {
  const dir = join(homedir(), ".todocko");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Get the database path for the Evolu database
 */
function getDbPath(appOwner: AppOwner): string {
  // v8 names the file after the owner, not after the app alone. Pointing at
  // `${DB_NAME}.db` meant every raw-SQLite helper below operated on the v7
  // database, which is still on disk and no longer read by anything: the
  // mnemonic guard silently answered "no mismatch" for years' worth of boots,
  // and ensureMissingColumns ALTERed a file nobody opens. (TODO-285)
  return join(getTodockoDir(), `${DB_NAME}-${createIdFromString(appOwner.id as string)}.db`);
}


/**
 * Ensure columns declared in Schema exist in the SQLite database.
 * Evolu's ensureSchema doesn't always add new columns to existing tables,
 * which causes loadQuery to hang silently when SELECTing missing columns.
 */
function ensureMissingColumns(appOwner: AppOwner): void {
  const dbPath = getDbPath(appOwner);
  if (!existsSync(dbPath)) return;

  try {
    const db = new Database(dbPath);

    // Map of table -> expected columns (from Schema) with their SQLite types
    const expectedColumns: Record<string, string[]> = {};
    for (const [tableName, tableSchema] of Object.entries(Schema)) {
      expectedColumns[tableName] = Object.keys(tableSchema).filter(k => k !== "id");
    }

    for (const [tableName, columns] of Object.entries(expectedColumns)) {
      // Check if table exists
      const tableExists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
      ).get(tableName);
      if (!tableExists) continue;

      // Get existing columns
      const existingCols = db.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[];
      const existingColNames = new Set(existingCols.map(c => c.name));

      // Add missing columns
      for (const col of columns) {
        if (!existingColNames.has(col)) {
          console.error(`Adding missing column ${tableName}.${col}`);
          db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${col} ANY`).run();
        }
      }
    }

    db.close();
  } catch (error) {
    console.error("Error ensuring missing columns:", error);
  }
}

/**
 * Initialize Evolu with the given mnemonic.
 *
 * This creates an Evolu instance that syncs with the Todocko relay servers.
 * Data is decrypted locally using keys derived from the mnemonic.
 *
 * Note: restoreAppOwner() in Evolu is designed for browsers where it calls
 * reloadApp() to restart. In Node.js, we check if the database already has
 * the correct owner and skip restore if it matches.
 */
export async function initEvolu(mnemonic: string): Promise<EvoluInstance | null> {
  // Parse and validate the mnemonic FIRST
  const mnemonicResult = Mnemonic.fromUnknown(mnemonic.trim());
  if (!mnemonicResult.ok) {
    // TODO-90 M7: never log mnemonicResult.error — the Evolu error object carries
    // the rejected value (often a typo of the real phrase). Log only that it failed.
    console.error("Invalid BIP39 mnemonic phrase (validation failed)");
    throw new Error("Invalid BIP39 mnemonic phrase");
  }

  const transports = RELAY_SERVERS.map(url => ({ type: "WebSocket" as const, url }));

  // The owner comes first now: both helpers below need it to know which file
  // v8 will actually open. (TODO-285)
  const appOwnerForChecks = createAppOwner(mnemonicToOwnerSecret(mnemonicResult.value));

  // Ensure missing columns exist in DB before Evolu starts
  // Evolu's ensureSchema doesn't always add new columns to existing tables
  ensureMissingColumns(appOwnerForChecks);

  // There used to be a belongsToDifferentMnemonic() guard here. It was written
  // for v7, where every mnemonic shared one database file and a switch would
  // have left the previous owner's rows in place. v8 names the file after the
  // owner, so a different mnemonic simply opens a different file and there is
  // nothing to collide with - the check could only ever answer "no". It read
  // `evolu_config.appOwnerMnemonic`, a column v8 does not create, so in
  // practice it threw and its catch returned false on every boot. Removed
  // rather than repaired: a guard that cannot fire is worse than none, because
  // it reads like protection. (TODO-285)

  try {
    // v8 takes the AppOwner as configuration, so the mnemonic is turned into an
    // owner up front. That removes the whole v7 dance below this line:
    // restoreAppOwner triggered a reloadApp, which meant creating the instance
    // without transports, racing the restore against a reload callback and a
    // 3s timeout, and then rebuilding it. None of that is needed now.
    const appOwner = appOwnerForChecks;
    appOwnerForProcess = appOwner;
    projectAppOwnerForProcess = deriveProjectInstanceOwner(mnemonicResult.value);

    const run = createRun(createNodeEvoluDeps());
    const created = await run(createEvolu(Schema, {
      appName: AppName.orThrow(DB_NAME),
      appOwner,
      transports,
    }));

    if (!created.ok) {
      return failInit("Failed to create Evolu instance");
    }
    // Local, non-null reference for the rest of setup. The module-level slot
    // is typed nullable, and every use below would otherwise need a `!`.
    const instance = withQueryBuilder(created.value, Schema);
    evoluInstance = instance;

    // No error subscription. v8 dropped `subscribeError`/`getError` from the
    // instance (TODO-265) and the obvious replacement does not work: Evolu's
    // console never emits an error-level entry on the client. Measured, not
    // assumed — an unreachable relay produced 67 console entries and not one
    // error, and a relay answering with malformed bytes produced none either.
    // The `deps.console.error` calls in Protocol.js are on the relay side of
    // the protocol, and a client message that cannot be applied goes quietly
    // into `evolu_message_quarantine`. So the quarantine is what gets
    // reported instead; see getQuarantineCounts. (TODO-266)
    // Attach change trackers so td_force_sync can report per-table activity.
    attachChangeTrackers(instance, Object.keys(Schema));

    // Test WebSocket connectivity to relay servers
    console.error("Testing WebSocket connectivity to relay servers...");
    const wsResults = await testWebSocketConnectivity();
    for (const [url, status] of Object.entries(wsResults)) {
      console.error(`  ${url}: ${status}`);
    }

    const anyConnected = Object.values(wsResults).some(s => s === 'ok');
    if (!anyConnected) {
      console.error("WARNING: Cannot connect to any relay server! Sync will not work.");
    }

    // Fail fast if the SQLite native binding can't be loaded.
    // Without this check the dbWorker init silently hangs forever and
    // every loadQuery times out — see README "Troubleshooting".
    //
    // The probe used to await `appOwner`, which was a Promise in v7 and is a
    // plain value in v8, so `appOwner?.then` was undefined and this warning
    // could never fire. A trivial query is the v8 way to learn the same thing:
    // it only resolves once the dbWorker is running. (TODO-265)
    {
      const probeStarted = Date.now();
      const probe = instance.createQuery((db) => db.selectFrom("user").select(["id"]).limit(1));
      Promise.race([
        instance.loadQuery(probe).then(() => true, () => false),
        new Promise<boolean>((res) => setTimeout(() => res(false), 8000)),
      ]).then((ok) => {
        if (!ok) {
          console.error(
            `[todocko-mcp] FATAL: Evolu dbWorker init did not complete within ${Date.now()-probeStarted}ms. ` +
            `Most likely cause: better-sqlite3 native binding was built against a different Node.js ABI. ` +
            `Fix: cd ${process.cwd()} && cd node_modules/better-sqlite3 && npx node-gyp rebuild --release`,
          );
        }
      });
    }

    // Wait for initial sync - use shorter timeout if WS is connected
    const syncWaitMs = anyConnected ? 3000 : 1000;
    console.error(`Evolu created, waiting ${syncWaitMs}ms for initial sync...`);
    setTimeout(() => {
      syncHealth.evoluReady = true;
      console.error("Evolu sync period complete, ready for queries");
      if (evoluReadyResolve) evoluReadyResolve();
    }, syncWaitMs);

    return evoluInstance;
  } catch (error) {
    console.error("Failed to initialize Evolu:", error);
    if (evoluReadyReject) evoluReadyReject(error instanceof Error ? error : new Error(globalThis.String(error)));
    throw error;
  }
}

export function getEvolu(): EvoluInstance | null {
  return evoluInstance;
}

// --- Readiness tracking ---

/**
 * Fail initialisation loudly.
 *
 * Every `return null` here used to leave `evoluReadyPromise` pending forever:
 * nothing rejected it, `main()` did not check the return value and printed
 * "Evolu instance created", and the first tool call then awaited a promise that
 * would never settle. The MCP client saw a server that had started and then
 * answered nothing at all, with no error anywhere. (TODO-285)
 */
function failInit(message: string): null {
  console.error(message);
  if (evoluReadyReject) evoluReadyReject(new Error(message));
  return null;
}

let evoluReadyResolve: (() => void) | null = null;
let evoluReadyReject: ((err: Error) => void) | null = null;
const evoluReadyPromise = new Promise<void>((resolve, reject) => {
  evoluReadyResolve = resolve;
  evoluReadyReject = reject;
});

/**
 * Wait for Evolu to be fully initialized and synced.
 * Tool calls should await this before accessing data.
 */
export function waitForEvolu(): Promise<void> {
  return evoluReadyPromise;
}

// Helper to convert SQLite boolean
export const SQLITE_TRUE = 1 as unknown as SqliteBoolean;
export const SQLITE_FALSE = null;

// --- Shared Projects Support ---

import { createSharedOwner, type SharedOwner, type OwnerSecret, type OwnerId } from "@evolu/common";

let projectEvoluInstance: EvoluInstance | null = null;
const PROJECT_DB_NAME = "todocko-shared";

// Cache for SharedOwners
const sharedOwnersCache = new Map<string, SharedOwner>();

/**
 * Initialize the project Evolu instance for shared projects
 */
export async function initProjectEvolu(): Promise<EvoluInstance | null> {
  if (projectEvoluInstance) return projectEvoluInstance;

  console.error("Initializing project Evolu for shared projects...");

  const appOwner = projectAppOwnerForProcess;
  if (!appOwner) {
    console.error("Cannot init project Evolu before the app owner is known");
    return null;
  }

  const run = createRun(createNodeEvoluDeps());
  const created = await run(createEvolu(ProjectSchema, {
    appName: AppName.orThrow(PROJECT_DB_NAME),
    appOwner,
    // No transports at instance level: this owner has nothing of its own to
    // sync. Every shared project brings its own through useSharedOwner(), and
    // subscribing this owner to the relay is what pulled the user's
    // AppOwnerSchema messages in to be quarantined. (TODO-267)
    transports: [],
  }));
  if (!created.ok) {
    console.error("Failed to create the shared-project Evolu instance");
    return null;
  }
  projectEvoluInstance = withQueryBuilder(created.value, ProjectSchema);

  console.error("Project Evolu created, syncing in background...");
  return projectEvoluInstance;
}

export function getProjectEvolu(): EvoluInstance | null {
  return projectEvoluInstance;
}

/**
 * Decode OwnerSecret from base64 string
 */
export function decodeOwnerSecret(encoded: string): OwnerSecret {
  // Called with whatever the MCP client sent. A missing `ownerSecret` used to
  // reach `Buffer.from` and surface as "The first argument must be of type
  // string or an instance of Buffer...", which says nothing about the argument
  // the caller actually forgot.
  if (typeof encoded !== "string" || encoded.length === 0) {
    throw new Error("ownerSecret is required (base64 string from projectRef)");
  }
  const binary = Buffer.from(encoded, "base64");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary[i]!;
  }
  return bytes as unknown as OwnerSecret;
}

/**
 * Get or create a SharedOwner for a project
 */
export function getSharedOwner(ownerId: string, ownerSecretBase64: string): SharedOwner {
  // Derived every time, not only on a cache miss.
  //
  // The mismatch check below existed since TODO-206, but it sat inside the miss
  // branch: after one successful call for an ownerId, any string at all passed
  // as the secret, because the cached owner was returned without the argument
  // being read. The check that exists to catch a wrong secret stopped looking
  // at the secret. Deriving is cheap next to the query that follows.
  // (TODO-285)
  const ownerSecret = decodeOwnerSecret(ownerSecretBase64);
  const sharedOwner = createSharedOwner(ownerSecret);

  // The owner id is derived from the secret, so a mismatch means the caller
  // paired the wrong secret with this ownerId. Without this check the write
  // silently lands in whichever partition the SECRET points at — either
  // another project, or a phantom owner nobody can ever read back. Reads look
  // equally plausible, so the caller never learns. (TODO-206)
  if ((sharedOwner.id as string) !== ownerId) {
    throw new Error(
      `ownerSecret does not match sharedOwnerId (derived ${sharedOwner.id as string}, expected ${ownerId})`,
    );
  }

  // Kept so useOwner()/stopUsingSharedOwner() still see one object per owner:
  // the reference identity matters to Evolu, the derivation does not.
  const cached = sharedOwnersCache.get(ownerId);
  if (cached) return cached;
  sharedOwnersCache.set(ownerId, sharedOwner);
  return sharedOwner;
}

/**
 * Handles returned by `useOwner`, one per shared owner currently in use.
 *
 * v8 changed both halves of this API. `useOwner` takes the transports array
 * itself, not `{ transports }` — an object passed there is truthy but not an
 * array, so it fails `assertNonEmptyReadonlyArray` with the confusing
 * "requires explicit non-empty transports" — and unsubscribing is done by
 * calling the returned `UnuseOwner`, not by re-registering with an empty
 * array, which now trips the same assert.
 */
const unuseByOwnerId = new Map<string, () => void>();

/**
 * Use a SharedOwner to access a project's data.
 *
 * Idempotent per owner: the tools call this on every request, and v8 keeps a
 * separate registration per call, so re-registering would leak handles and
 * transport references for the life of the process.
 */
export function useSharedOwner(sharedOwner: SharedOwner): void {
  const evolu = getProjectEvolu();
  if (!evolu) {
    throw new Error("Project Evolu not initialized");
  }

  const ownerId = sharedOwner.id as string;
  if (unuseByOwnerId.has(ownerId)) return;

  // `useOwner` wants owner-scoped transports, which is also what the relay
  // authenticates on. The plain `{ type, url }` shape only type-checked while
  // the instance was `any`. (TODO-265)
  const transports = RELAY_SERVERS.map((url) =>
    createOwnerWebSocketTransport({ url, ownerId: sharedOwner.id }),
  ) as unknown as readonly [OwnerWebSocketTransport, ...OwnerWebSocketTransport[]];
  unuseByOwnerId.set(ownerId, evolu.useOwner(sharedOwner, transports));
}

/**
 * Stop using a SharedOwner.
 *
 * The handle is dropped before it is called, because v8 asserts an
 * `UnuseOwner` runs at most once and the tools call this from `finally`
 * blocks that can run more than once for the same owner.
 */
export function stopUsingSharedOwner(sharedOwner: SharedOwner): void {
  const ownerId = sharedOwner.id as string;
  const unuse = unuseByOwnerId.get(ownerId);
  if (!unuse) return;
  unuseByOwnerId.delete(ownerId);
  unuse();
}
