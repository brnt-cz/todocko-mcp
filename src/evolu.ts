/**
 * Evolu integration for Todocko MCP Server
 *
 * This creates a proper Node.js Evolu instance using createDbWorkerForPlatform
 * with all required platform dependencies.
 */

import WebSocket from "ws";

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
    console: createConsole({ enableLogging: true }),
    createSqliteDriver: createBetterSqliteDriver,
    createWebSocket: createWebSocket,
    randomBytes: createRandomBytes(),
    random: createRandom(),
    time: createTime(),
  };
}

/**
 * Initialize Evolu with the given mnemonic.
 *
 * This creates an Evolu instance that syncs with the Todocko relay servers.
 * Data is decrypted locally using keys derived from the mnemonic.
 */
export async function initEvolu(mnemonic: string): Promise<EvoluInstance | null> {
  const platformDeps = createNodejsPlatformDeps();

  // Create the DbWorker using platform-specific implementation
  const createDbWorker = (_name: SimpleName) => {
    return createDbWorkerForPlatform(platformDeps);
  };

  // Build complete Evolu dependencies for Node.js
  const evoluDeps = {
    console: platformDeps.console,
    createDbWorker,
    randomBytes: platformDeps.randomBytes,
    reloadApp: () => {
      // Not needed in MCP context - just log
      console.log("reloadApp called (no-op in MCP)");
    },
    time: platformDeps.time,
  };

  try {
    // Create the Evolu instance
    evoluInstance = createEvolu(evoluDeps)(Schema, {
      name: SimpleName.orThrow("todocko"),
      transports: RELAY_SERVERS.map(url => ({ type: "WebSocket" as const, url })),
      enableLogging: true,
    });

    // Parse and validate the mnemonic
    const mnemonicResult = Mnemonic.from(mnemonic.trim());
    if (!mnemonicResult.ok) {
      console.error("Invalid mnemonic:", mnemonicResult.error);
      throw new Error("Invalid BIP39 mnemonic phrase");
    }

    // Restore the owner using the mnemonic
    console.log("Restoring app owner from mnemonic...");
    await evoluInstance.restoreAppOwner(mnemonicResult.value);

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
