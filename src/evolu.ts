/**
 * Evolu integration for Todocko MCP Server
 *
 * This creates a proper Node.js Evolu instance using createDbWorkerForPlatform
 * with all required platform dependencies.
 */

import WebSocket from "ws";
import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// WebSocket polyfill for Node.js - must be set before importing Evolu
globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;

import { createEvolu } from "@evolu/common/local-first";
import {
  createDbWorkerForPlatform,
  type DbWorkerPlatformDeps,
} from "@evolu/common/local-first";
import { createBetterSqliteDriver } from "@evolu/nodejs";
import {
  id,
  nullOr,
  NonEmptyString100,
  NonEmptyString1000,
  SqliteBoolean,
  Int,
  String,
  createConsole,
  createRandomBytes,
  createRandom,
  createTime,
  createWebSocket,
  SimpleName,
  Mnemonic,
} from "@evolu/common";

// Re-create schema for MCP server (mirrors main app)
export const ProjectId = id("Project");
export type ProjectId = typeof ProjectId.Type;

export const TaskId = id("Task");
export type TaskId = typeof TaskId.Type;

export const UserId = id("User");
export type UserId = typeof UserId.Type;

export const AttachmentId = id("Attachment");
export type AttachmentId = typeof AttachmentId.Type;

export const WorklogId = id("Worklog");
export type WorklogId = typeof WorklogId.Type;

export const TaskLinkId = id("TaskLink");
export type TaskLinkId = typeof TaskLinkId.Type;

export const DeploymentStageId = id("DeploymentStage");
export type DeploymentStageId = typeof DeploymentStageId.Type;

export const ProjectRefId = id("ProjectRef");
export type ProjectRefId = typeof ProjectRefId.Type;

export const ProjectMemberId = id("ProjectMember");
export type ProjectMemberId = typeof ProjectMemberId.Type;

export const RepositoryLinkId = id("RepositoryLink");
export type RepositoryLinkId = typeof RepositoryLinkId.Type;

export const TaskCommentId = id("TaskComment");
export type TaskCommentId = typeof TaskCommentId.Type;

export const MentionId = id("Mention");
export type MentionId = typeof MentionId.Type;

export const ChecklistItemId = id("ChecklistItem");
export type ChecklistItemId = typeof ChecklistItemId.Type;

export const TaskTemplateId = id("TaskTemplate");
export type TaskTemplateId = typeof TaskTemplateId.Type;

export const KanbanColumnId = id("KanbanColumn");
export type KanbanColumnId = typeof KanbanColumnId.Type;

export const SavedViewId = id("SavedView");
export type SavedViewId = typeof SavedViewId.Type;

export const ActivityLogId = id("ActivityLog");
export type ActivityLogId = typeof ActivityLogId.Type;

export const TagId = id("Tag");
export type TagId = typeof TagId.Type;

export const TaskTagId = id("TaskTag");
export type TaskTagId = typeof TaskTagId.Type;

export const LocalProjectNoteId = id("LocalProjectNote");
export type LocalProjectNoteId = typeof LocalProjectNoteId.Type;

export const ProjectNoteId = id("ProjectNote");
export type ProjectNoteId = typeof ProjectNoteId.Type;

export const Schema = {
  user: {
    id: UserId,
    name: NonEmptyString100,
    email: nullOr(String),
    avatarUrl: nullOr(String),
    color: String,
    passwordHash: nullOr(String),
    role: nullOr(String),
    theme: nullOr(String),
  },
  project: {
    id: ProjectId,
    name: NonEmptyString100,
    code: nullOr(NonEmptyString100),
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
    title: NonEmptyString100,
    name: nullOr(NonEmptyString100),
    description: nullOr(String),
    status: String,
    priority: String,
    deadline: nullOr(String),
    scheduledDate: nullOr(String),
    position: Int,
    completedAt: nullOr(String),
    isBlocked: nullOr(SqliteBoolean),
    blockedReason: nullOr(NonEmptyString1000),
    estimate: nullOr(Int),
    isOnProduction: nullOr(SqliteBoolean),
    deploymentStageId: nullOr(DeploymentStageId),
    recurrenceType: nullOr(String),
    recurrenceInterval: nullOr(Int),
    recurrenceEndDate: nullOr(String),
    recurrenceDay: nullOr(Int),
    sprintNumber: nullOr(Int),
  },
  tag: {
    id: TagId,
    name: NonEmptyString100,
    color: String,
  },
  taskTag: {
    id: TaskTagId,
    taskId: TaskId,
    tagId: TagId,
  },
  attachment: {
    id: AttachmentId,
    taskId: TaskId,
    filename: NonEmptyString100,
    mimeType: String,
    data: nullOr(String),
    size: Int,
  },
  worklog: {
    id: WorklogId,
    taskId: TaskId,
    userId: nullOr(UserId),
    durationMinutes: Int,
    description: nullOr(NonEmptyString1000),
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
    name: NonEmptyString100,
    color: String,
    position: Int,
  },
  // Project references for shared projects
  projectRef: {
    id: ProjectRefId,
    projectId: String,
    ownerSecret: String,
    sharedOwnerId: String,
    name: NonEmptyString100,
    code: nullOr(NonEmptyString100),
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
    title: NonEmptyString1000,
    isChecked: nullOr(SqliteBoolean),
    position: Int,
  },
  // Task templates
  taskTemplate: {
    id: TaskTemplateId,
    name: NonEmptyString100,
    taskName: nullOr(NonEmptyString100),
    description: nullOr(String),
    priority: String,
    estimate: nullOr(Int),
    projectId: nullOr(ProjectId),
    position: Int,
  },
  // Kanban columns
  kanbanColumn: {
    id: KanbanColumnId,
    slug: NonEmptyString100,
    name: NonEmptyString100,
    color: String,
    icon: String,
    position: Int,
    isDefault: nullOr(SqliteBoolean),
    showInKanban: nullOr(SqliteBoolean),
  },
  // Saved views
  savedView: {
    id: SavedViewId,
    name: NonEmptyString100,
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
    title: NonEmptyString100,
    content: nullOr(String),
    position: Int,
    isDoc: nullOr(SqliteBoolean),
    parentDocId: nullOr(String),
  },
};

// Schema for shared projects (todocko-shared database)
export const ProjectSchema = {
  project: {
    id: ProjectId,
    name: NonEmptyString100,
    code: nullOr(NonEmptyString100),
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
    userName: NonEmptyString100,
    userColor: String,
    userAvatarUrl: nullOr(String),
    permission: String,
    joinedAt: String,
  },
  task: {
    id: TaskId,
    projectId: nullOr(ProjectId),
    assigneeId: nullOr(String), // AppOwner OwnerId of assignee
    title: NonEmptyString100,
    name: nullOr(NonEmptyString100),
    description: nullOr(String),
    status: String,
    priority: String,
    deadline: nullOr(String),
    scheduledDate: nullOr(String),
    position: Int,
    completedAt: nullOr(String),
    isBlocked: nullOr(SqliteBoolean),
    blockedReason: nullOr(NonEmptyString1000),
    estimate: nullOr(Int),
    isOnProduction: nullOr(SqliteBoolean),
    deploymentStageId: nullOr(DeploymentStageId),
    recurrenceType: nullOr(String),
    recurrenceInterval: nullOr(Int),
    recurrenceEndDate: nullOr(String),
    recurrenceDay: nullOr(Int),
    sprintNumber: nullOr(Int),
  },
  tag: {
    id: TagId,
    name: NonEmptyString100,
    color: String,
  },
  taskTag: {
    id: TaskTagId,
    taskId: TaskId,
    tagId: TagId,
  },
  attachment: {
    id: AttachmentId,
    taskId: TaskId,
    filename: NonEmptyString100,
    mimeType: String,
    data: nullOr(String),
    size: Int,
  },
  worklog: {
    id: WorklogId,
    taskId: TaskId,
    userId: nullOr(String),
    durationMinutes: Int,
    description: nullOr(NonEmptyString1000),
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
    name: NonEmptyString100,
    color: String,
    position: Int,
  },
  // Repository links (GitHub, GitLab, etc.)
  repositoryLink: {
    id: RepositoryLinkId,
    projectId: ProjectId,
    type: String, // 'github' | 'gitlab' | 'bitbucket' | 'azure' | 'custom'
    url: NonEmptyString1000,
    label: nullOr(NonEmptyString100),
    position: Int,
  },
  // Project notes (shared, synced)
  projectNote: {
    id: ProjectNoteId,
    projectId: ProjectId,
    title: NonEmptyString100,
    content: nullOr(String),
    createdBy: nullOr(String),
    position: Int,
    isDoc: nullOr(SqliteBoolean),
    parentDocId: nullOr(String),
  },
};

export type Schema = typeof Schema;

// Type for the Evolu instance - using any to avoid complex generic issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EvoluInstance = any;

let evoluInstance: EvoluInstance | null = null;

// Database name - must match main app (src/db/appEvolu.ts)
const DB_NAME = "todocko";

// Evolu relay servers (same as main app)
const RELAY_SERVERS = [
  "wss://relay.todocko.cz",
];

// --- Sync Health Tracking ---

interface SyncHealth {
  lastError: string | null;
  lastErrorAt: Date | null;
  errorCount: number;
  wsConnectivity: Map<string, 'untested' | 'ok' | 'failed'>;
  evoluReady: boolean;
  onCompleteCount: number;
}

const syncHealth: SyncHealth = {
  lastError: null,
  lastErrorAt: null,
  errorCount: 0,
  wsConnectivity: new Map(RELAY_SERVERS.map(url => [url, 'untested' as const])),
  evoluReady: false,
  onCompleteCount: 0,
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

/** Track onComplete calls from mutations */
export function trackOnComplete(): void {
  syncHealth.onCompleteCount++;
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
 * Create platform dependencies for Node.js
 */
function createNodejsPlatformDeps(): DbWorkerPlatformDeps {
  return {
    console: createConsole({ enableLogging: false }),
    createSqliteDriver: createBetterSqliteDriver,
    createWebSocket: createWebSocket,
    randomBytes: createRandomBytes(),
    random: createRandom(),
    time: createTime(),
  };
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
function getDbPath(): string {
  // Evolu uses the app name as the database file name
  return join(getTodockoDir(), `${DB_NAME}.db`);
}

/**
 * Check if the database already has the correct owner from the mnemonic
 * Returns true if owner matches, false otherwise
 */
function checkExistingOwner(mnemonic: string): boolean {
  const dbPath = getDbPath();

  if (!existsSync(dbPath)) {
    console.error("Database does not exist yet");
    return false;
  }

  try {
    const db = new Database(dbPath, { readonly: true });

    // Check if evolu_config table exists
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='evolu_config'"
    ).get();

    if (!tableExists) {
      console.error("evolu_config table does not exist");
      db.close();
      return false;
    }

    // Check if mnemonic matches
    const config = db.prepare(
      "SELECT appOwnerMnemonic FROM evolu_config LIMIT 1"
    ).get() as { appOwnerMnemonic: string | null } | undefined;

    db.close();

    if (!config || !config.appOwnerMnemonic) {
      console.error("No mnemonic stored in database");
      return false;
    }

    const matches = config.appOwnerMnemonic.trim() === mnemonic.trim();
    console.error(`Database mnemonic ${matches ? "matches" : "does not match"}`);
    return matches;
  } catch (error) {
    console.error("Error checking database:", error);
    return false;
  }
}

/**
 * Create Evolu dependencies for Node.js
 */
function createEvoluDeps(platformDeps: DbWorkerPlatformDeps, onReloadApp?: () => void) {
  const createDbWorker = (_name: SimpleName) => {
    return createDbWorkerForPlatform(platformDeps);
  };

  return {
    console: platformDeps.console,
    createDbWorker,
    randomBytes: platformDeps.randomBytes,
    reloadApp: () => {
      console.error("reloadApp called");
      if (onReloadApp) onReloadApp();
    },
    time: platformDeps.time,
  };
}

/**
 * Ensure columns declared in Schema exist in the SQLite database.
 * Evolu's ensureSchema doesn't always add new columns to existing tables,
 * which causes loadQuery to hang silently when SELECTing missing columns.
 */
function ensureMissingColumns(): void {
  const dbPath = getDbPath();
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
  const mnemonicResult = Mnemonic.from(mnemonic.trim());
  if (!mnemonicResult.ok) {
    console.error("Invalid mnemonic:", mnemonicResult.error);
    throw new Error("Invalid BIP39 mnemonic phrase");
  }

  const platformDeps = createNodejsPlatformDeps();
  const transports = RELAY_SERVERS.map(url => ({ type: "WebSocket" as const, url }));

  // Ensure missing columns exist in DB before Evolu starts
  // Evolu's ensureSchema doesn't always add new columns to existing tables
  ensureMissingColumns();

  // Check if database already has the correct owner
  const ownerAlreadySet = checkExistingOwner(mnemonic);

  try {
    if (ownerAlreadySet) {
      // Owner already matches - just create Evolu with transports and let it sync
      console.error("Owner already set in database - creating Evolu with transports...");

      const evoluDeps = createEvoluDeps(platformDeps);
      evoluInstance = createEvolu(evoluDeps)(Schema, {
        name: SimpleName.orThrow(DB_NAME),
        transports: transports,
        enableLogging: false,
      });
    } else {
      // Need to restore owner first
      console.error("Owner not set - restoring from mnemonic...");

      // Flag to track if restoreAppOwner triggered a reload
      let reloadTriggered = false;
      let reloadResolve: (() => void) | null = null;
      const reloadPromise = new Promise<void>((resolve) => {
        reloadResolve = resolve;
      });

      // Create initial Evolu instance WITHOUT transports
      const evoluDeps = createEvoluDeps(platformDeps, () => {
        reloadTriggered = true;
        if (reloadResolve) reloadResolve();
      });

      evoluInstance = createEvolu(evoluDeps)(Schema, {
        name: SimpleName.orThrow(DB_NAME),
        transports: [], // No sync yet - will add after restore
        enableLogging: false,
      });

      // Restore owner from mnemonic
      console.error("Calling restoreAppOwner...");
      const restorePromise = evoluInstance.restoreAppOwner(mnemonicResult.value);

      // Wait for either restore to complete or reload to be triggered
      await Promise.race([
        restorePromise,
        reloadPromise,
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);

      // If reload was triggered, recreate with transports
      if (reloadTriggered) {
        console.error("Reload triggered - recreating Evolu instance with transports...");

        const newEvoluDeps = createEvoluDeps(platformDeps);
        evoluInstance = createEvolu(newEvoluDeps)(Schema, {
          name: SimpleName.orThrow(DB_NAME),
          transports: transports,
          enableLogging: false,
        });
      } else {
        // Just add transports
        console.error("Adding transports for sync...");
        evoluInstance.useOwner({ transports });
      }
    }

    // Subscribe to sync errors for health tracking
    if (evoluInstance.subscribeError) {
      evoluInstance.subscribeError(() => {
        const error = evoluInstance!.getError();
        if (error) {
          try {
            syncHealth.lastError = JSON.stringify(error);
          } catch {
            syncHealth.lastError = error instanceof Error ? error.message : globalThis.String(error);
          }
          syncHealth.lastErrorAt = new Date();
          syncHealth.errorCount++;
          console.error("[sync-health] Evolu error:", JSON.stringify(error, null, 2));
        }
      });
    }

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

import { createSharedOwner, createOwnerSecret, type SharedOwner, type OwnerSecret, type OwnerId } from "@evolu/common";

let projectEvoluInstance: EvoluInstance | null = null;
const PROJECT_DB_NAME = "todocko-shared";

// Cache for SharedOwners
const sharedOwnersCache = new Map<string, SharedOwner>();

/**
 * Initialize the project Evolu instance for shared projects
 */
export async function initProjectEvolu(): Promise<EvoluInstance | null> {
  if (projectEvoluInstance) return projectEvoluInstance;

  const platformDeps = createNodejsPlatformDeps();
  const transports = RELAY_SERVERS.map(url => ({ type: "WebSocket" as const, url }));

  console.error("Initializing project Evolu for shared projects...");

  const evoluDeps = createEvoluDeps(platformDeps);
  projectEvoluInstance = createEvolu(evoluDeps)(ProjectSchema, {
    name: SimpleName.orThrow(PROJECT_DB_NAME),
    transports: transports,
    enableLogging: true,
  });

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
  let sharedOwner = sharedOwnersCache.get(ownerId);

  if (!sharedOwner) {
    const ownerSecret = decodeOwnerSecret(ownerSecretBase64);
    sharedOwner = createSharedOwner(ownerSecret);
    sharedOwnersCache.set(sharedOwner.id as string, sharedOwner);
  }

  return sharedOwner;
}

/**
 * Use a SharedOwner to access a project's data
 */
export function useSharedOwner(sharedOwner: SharedOwner): void {
  const evolu = getProjectEvolu();
  if (!evolu) {
    throw new Error("Project Evolu not initialized");
  }

  const transports = RELAY_SERVERS.map(url => ({ type: "WebSocket" as const, url }));
  evolu.useOwner(sharedOwner, { transports });
}

/**
 * Stop using a SharedOwner
 */
export function stopUsingSharedOwner(sharedOwner: SharedOwner): void {
  const evolu = getProjectEvolu();
  if (!evolu) return;

  evolu.useOwner(sharedOwner, { transports: [] });
}
