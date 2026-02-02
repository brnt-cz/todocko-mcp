/**
 * Evolu integration for Todocko MCP Server
 *
 * This creates a proper Node.js Evolu instance using createDbWorkerForPlatform
 * with all required platform dependencies.
 */

import WebSocket from "ws";
import Database from "better-sqlite3";
import { existsSync } from "fs";
import { join } from "path";

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
    position: Int,
  },
  task: {
    id: TaskId,
    projectId: nullOr(ProjectId),
    assigneeId: nullOr(UserId),
    title: NonEmptyString100,
    name: nullOr(NonEmptyString100),
    description: nullOr(NonEmptyString1000),
    status: String,
    priority: String,
    deadline: nullOr(String),
    position: Int,
    completedAt: nullOr(String),
    isBlocked: nullOr(SqliteBoolean),
    blockedReason: nullOr(NonEmptyString1000),
    estimate: nullOr(Int),
  },
  tag: {
    id: id("Tag"),
    name: NonEmptyString100,
    color: String,
  },
  taskTag: {
    id: id("TaskTag"),
    taskId: TaskId,
    tagId: id("Tag"),
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
};

export type Schema = typeof Schema;

// Type for the Evolu instance - using any to avoid complex generic issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EvoluInstance = any;

let evoluInstance: EvoluInstance | null = null;

// Evolu relay servers (same as main app)
const RELAY_SERVERS = [
  "wss://free.evoluhq.com",
  "wss://relay-production-0afe.up.railway.app",
  "wss://relay.todocko.cz",
];

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
 * Get the database path for the Evolu database
 */
function getDbPath(): string {
  // Evolu uses the app name as the database file name
  return join(process.cwd(), "todocko.db");
}

/**
 * Check if the database already has the correct owner from the mnemonic
 * Returns true if owner matches, false otherwise
 */
function checkExistingOwner(mnemonic: string): boolean {
  const dbPath = getDbPath();

  if (!existsSync(dbPath)) {
    console.log("Database does not exist yet");
    return false;
  }

  try {
    const db = new Database(dbPath, { readonly: true });

    // Check if evolu_config table exists
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='evolu_config'"
    ).get();

    if (!tableExists) {
      console.log("evolu_config table does not exist");
      db.close();
      return false;
    }

    // Check if mnemonic matches
    const config = db.prepare(
      "SELECT appOwnerMnemonic FROM evolu_config LIMIT 1"
    ).get() as { appOwnerMnemonic: string | null } | undefined;

    db.close();

    if (!config || !config.appOwnerMnemonic) {
      console.log("No mnemonic stored in database");
      return false;
    }

    const matches = config.appOwnerMnemonic.trim() === mnemonic.trim();
    console.log(`Database mnemonic ${matches ? "matches" : "does not match"}`);
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
      console.log("reloadApp called");
      if (onReloadApp) onReloadApp();
    },
    time: platformDeps.time,
  };
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

  // Check if database already has the correct owner
  const ownerAlreadySet = checkExistingOwner(mnemonic);

  try {
    if (ownerAlreadySet) {
      // Owner already matches - just create Evolu with transports and let it sync
      console.log("Owner already set in database - creating Evolu with transports...");

      const evoluDeps = createEvoluDeps(platformDeps);
      evoluInstance = createEvolu(evoluDeps)(Schema, {
        name: SimpleName.orThrow("todocko"),
        transports: transports,
        enableLogging: false,
      });
    } else {
      // Need to restore owner first
      console.log("Owner not set - restoring from mnemonic...");

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
        name: SimpleName.orThrow("todocko"),
        transports: [], // No sync yet - will add after restore
        enableLogging: false,
      });

      // Restore owner from mnemonic
      console.log("Calling restoreAppOwner...");
      const restorePromise = evoluInstance.restoreAppOwner(mnemonicResult.value);

      // Wait for either restore to complete or reload to be triggered
      await Promise.race([
        restorePromise,
        reloadPromise,
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);

      // If reload was triggered, recreate with transports
      if (reloadTriggered) {
        console.log("Reload triggered - recreating Evolu instance with transports...");

        const newEvoluDeps = createEvoluDeps(platformDeps);
        evoluInstance = createEvolu(newEvoluDeps)(Schema, {
          name: SimpleName.orThrow("todocko"),
          transports: transports,
          enableLogging: false,
        });
      } else {
        // Just add transports
        console.log("Adding transports for sync...");
        evoluInstance.useOwner({ transports });
      }
    }

    // Wait for initial sync
    console.log("Waiting for initial sync...");
    await new Promise((resolve) => setTimeout(resolve, 5000));

    console.log("Evolu initialized successfully");
    return evoluInstance;
  } catch (error) {
    console.error("Failed to initialize Evolu:", error);
    throw error;
  }
}

export function getEvolu(): EvoluInstance | null {
  return evoluInstance;
}

// Helper to convert SQLite boolean
export const SQLITE_TRUE = 1 as unknown as SqliteBoolean;
export const SQLITE_FALSE = null;
