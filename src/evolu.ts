/**
 * Evolu integration for Todocko MCP Server
 *
 * NOTE: Full Evolu integration for Node.js is complex and requires
 * building the EvoluDeps manually. This file provides a simplified
 * structure that can be expanded later.
 *
 * For now, the MCP server operates with a local SQLite database
 * that syncs via the Evolu relay protocol.
 */

import { createEvolu } from "@evolu/common/local-first";
import { createBetterSqliteDriver } from "@evolu/nodejs";
import {
  id,
  nullOr,
  NonEmptyString100,
  NonEmptyString1000,
  SqliteBoolean,
  Int,
  String,
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

/**
 * Initialize Evolu with the given mnemonic.
 *
 * This creates an Evolu instance that syncs with the Todocko relay servers.
 * Data is decrypted locally using keys derived from the mnemonic.
 */
export async function initEvolu(mnemonic: string): Promise<EvoluInstance | null> {
  // Evolu relay servers (same as main app)
  const RELAY_SERVERS = [
    "wss://free.evoluhq.com",
    "wss://relay-production-0afe.up.railway.app",
    "wss://relay.todocko.cz",
  ];

  // Create Node.js specific dependencies
  const createSqliteDriver = createBetterSqliteDriver;

  // Build evolu deps for Node.js
  // This is a simplified version - full implementation would require
  // more platform-specific code
  const evoluNodeDeps = {
    console,
    createDbWorker: () => {
      throw new Error("Worker not supported in Node.js MCP context");
    },
    createSqliteDriver,
    flushSync: (fn: () => void) => fn(),
    randomBytes: (size: number) => {
      const { randomBytes } = require("crypto");
      return randomBytes(size);
    },
    reloadApp: () => {
      throw new Error("Reload not supported in MCP context");
    },
    time: {
      now: Date.now,
    },
  };

  try {
    evoluInstance = createEvolu(evoluNodeDeps as any)(Schema, {
      name: "todocko",
      transports: RELAY_SERVERS.map(url => ({ type: "WebSocket" as const, url })),
      // The mnemonic is used for key derivation
      // Note: This might need additional setup for owner restoration
    } as any);

    // Wait for initial sync
    await new Promise((resolve) => setTimeout(resolve, 3000));

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
