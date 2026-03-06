import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { NonEmptyString100, String as EvoluString, Int } from "@evolu/common";
import {
  SQLITE_TRUE,
  type ProjectId,
  type LocalProjectNoteId,
  type ProjectNoteId,
  type EvoluInstance,
  getProjectEvolu,
  getSharedOwner,
  useSharedOwner,
  stopUsingSharedOwner,
} from "../evolu.js";
import { createMutationWaiter, getSyncWarning } from "./helpers.js";

export const projectNoteTools: Tool[] = [
  // Local project notes (not synced)
  {
    name: "td_list_project_notes",
    description: "List local project notes (not synced to shared projects)",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Filter by project ID" },
      },
    },
  },
  {
    name: "td_create_project_note",
    description: "Create a local project note",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID (required)" },
        title: { type: "string", description: "Note title (required)" },
        content: { type: "string", description: "Note content (HTML)" },
      },
      required: ["projectId", "title"],
    },
  },
  {
    name: "td_update_project_note",
    description: "Update a local project note",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Note ID (required)" },
        title: { type: "string" },
        content: { type: "string" },
        position: { type: "number" },
      },
      required: ["id"],
    },
  },
  {
    name: "td_delete_project_note",
    description: "Delete a local project note (soft delete)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Note ID (required)" },
      },
      required: ["id"],
    },
  },
  // Shared project notes
  {
    name: "td_list_shared_project_notes",
    description: "List project notes from a shared project",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID (required)" },
        ownerSecret: { type: "string", description: "Owner secret (required)" },
        projectId: { type: "string", description: "Filter by project ID" },
      },
      required: ["sharedOwnerId", "ownerSecret"],
    },
  },
  {
    name: "td_create_shared_project_note",
    description: "Create a project note in a shared project",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID (required)" },
        ownerSecret: { type: "string", description: "Owner secret (required)" },
        projectId: { type: "string", description: "Project ID (required)" },
        title: { type: "string", description: "Note title (required)" },
        content: { type: "string", description: "Note content (HTML)" },
      },
      required: ["sharedOwnerId", "ownerSecret", "projectId", "title"],
    },
  },
  {
    name: "td_update_shared_project_note",
    description: "Update a project note in a shared project",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID (required)" },
        ownerSecret: { type: "string", description: "Owner secret (required)" },
        id: { type: "string", description: "Note ID (required)" },
        title: { type: "string" },
        content: { type: "string" },
        position: { type: "number" },
      },
      required: ["sharedOwnerId", "ownerSecret", "id"],
    },
  },
  {
    name: "td_delete_shared_project_note",
    description: "Delete a project note in a shared project (soft delete)",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID (required)" },
        ownerSecret: { type: "string", description: "Owner secret (required)" },
        id: { type: "string", description: "Note ID (required)" },
      },
      required: ["sharedOwnerId", "ownerSecret", "id"],
    },
  },
];

export async function handleProjectNoteTool(
  name: string,
  args: Record<string, unknown>,
  evolu: EvoluInstance
): Promise<unknown> {
  switch (name) {
    case "td_list_project_notes":
      return listProjectNotes(evolu, args as { projectId?: string });
    case "td_create_project_note":
      return createProjectNote(evolu, args as { projectId: string; title: string; content?: string });
    case "td_update_project_note":
      return updateProjectNote(evolu, args as { id: string; title?: string; content?: string; position?: number });
    case "td_delete_project_note":
      return deleteProjectNote(evolu, args as { id: string });
    case "td_list_shared_project_notes":
      return listSharedProjectNotes(args as { sharedOwnerId: string; ownerSecret: string; projectId?: string });
    case "td_create_shared_project_note":
      return createSharedProjectNote(args as { sharedOwnerId: string; ownerSecret: string; projectId: string; title: string; content?: string });
    case "td_update_shared_project_note":
      return updateSharedProjectNote(args as { sharedOwnerId: string; ownerSecret: string; id: string; title?: string; content?: string; position?: number });
    case "td_delete_shared_project_note":
      return deleteSharedProjectNote(args as { sharedOwnerId: string; ownerSecret: string; id: string });
    default:
      return undefined;
  }
}

// --- Local project notes ---

async function listProjectNotes(evolu: EvoluInstance, args: { projectId?: string }) {
  const query = evolu.createQuery((db: any) => {
    let q = db
      .selectFrom("localProjectNote")
      .select(["id", "projectId", "title", "content", "position"])
      .where("isDeleted", "is not", SQLITE_TRUE)
      .orderBy("position", "asc");
    if (args.projectId) {
      q = q.where("projectId", "=", args.projectId as ProjectId);
    }
    return q;
  });
  const result = await evolu.loadQuery(query);
  return {
    count: result.length,
    notes: result.map((n: any) => ({
      id: n.id, projectId: n.projectId, title: n.title, content: n.content, position: n.position,
    })),
  };
}

async function createProjectNote(
  evolu: EvoluInstance,
  args: { projectId: string; title: string; content?: string }
) {
  const posQuery = evolu.createQuery((db: any) =>
    db.selectFrom("localProjectNote").select(["position"])
      .where("projectId", "=", args.projectId as ProjectId)
      .where("isDeleted", "is not", SQLITE_TRUE)
      .orderBy("position", "desc").limit(1)
  );
  const posResult = await evolu.loadQuery(posQuery);
  const maxPos = posResult.length > 0 ? ((posResult[0] as any).position || 0) : 0;

  const waiter = createMutationWaiter();
  const result = evolu.insert("localProjectNote", {
    projectId: args.projectId as ProjectId,
    title: NonEmptyString100.orThrow(args.title),
    content: args.content ? EvoluString.orThrow(args.content) : null,
    position: Int.orThrow(maxPos + 1),
  }, { onComplete: waiter.onComplete });

  if (!result.ok) throw new Error(`Failed to create note: ${JSON.stringify(result.error)}`);
  await waiter.waitForSync();

  return { success: true, noteId: result.value.id, message: `Note created${getSyncWarning()}` };
}

async function updateProjectNote(
  evolu: EvoluInstance,
  args: { id: string; title?: string; content?: string; position?: number }
) {
  const updates: Record<string, unknown> = { id: args.id as LocalProjectNoteId };
  if (args.title !== undefined) updates.title = NonEmptyString100.orThrow(args.title);
  if (args.content !== undefined) updates.content = args.content ? EvoluString.orThrow(args.content) : null;
  if (args.position !== undefined) updates.position = Int.orThrow(args.position);

  const waiter = createMutationWaiter();
  evolu.update("localProjectNote", updates as any, { onComplete: waiter.onComplete });
  await waiter.waitForSync();

  return { success: true, message: `Note updated${getSyncWarning()}` };
}

async function deleteProjectNote(evolu: EvoluInstance, args: { id: string }) {
  const waiter = createMutationWaiter();
  evolu.update("localProjectNote", { id: args.id as LocalProjectNoteId, isDeleted: SQLITE_TRUE } as any, { onComplete: waiter.onComplete });
  await waiter.waitForSync();
  return { success: true, message: "Note deleted" };
}

// --- Shared project notes ---

async function listSharedProjectNotes(args: { sharedOwnerId: string; ownerSecret: string; projectId?: string }) {
  const projectEvolu = getProjectEvolu();
  const owner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(owner);
  try {
    const query = projectEvolu.createQuery((db: any) => {
      let q = db
        .selectFrom("projectNote")
        .select(["id", "projectId", "title", "content", "createdBy", "position"])
        .where("isDeleted", "is not", SQLITE_TRUE)
        .orderBy("position", "asc");
      if (args.projectId) {
        q = q.where("projectId", "=", args.projectId as ProjectId);
      }
      return q;
    });
    const result = await projectEvolu.loadQuery(query);
    return {
      count: result.length,
      notes: result.map((n: any) => ({
        id: n.id, projectId: n.projectId, title: n.title, content: n.content,
        createdBy: n.createdBy, position: n.position,
      })),
    };
  } finally {
    stopUsingSharedOwner(owner);
  }
}

async function createSharedProjectNote(
  args: { sharedOwnerId: string; ownerSecret: string; projectId: string; title: string; content?: string }
) {
  const projectEvolu = getProjectEvolu();
  const owner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(owner);
  try {
    const posQuery = projectEvolu.createQuery((db: any) =>
      db.selectFrom("projectNote").select(["position"])
        .where("projectId", "=", args.projectId as ProjectId)
        .where("isDeleted", "is not", SQLITE_TRUE)
        .orderBy("position", "desc").limit(1)
    );
    const posResult = await projectEvolu.loadQuery(posQuery);
    const maxPos = posResult.length > 0 ? ((posResult[0] as any).position || 0) : 0;

    const waiter = createMutationWaiter();
    const result = projectEvolu.insert("projectNote", {
      projectId: args.projectId as ProjectId,
      title: NonEmptyString100.orThrow(args.title),
      content: args.content ? EvoluString.orThrow(args.content) : null,
      createdBy: null,
      position: Int.orThrow(maxPos + 1),
    }, { onComplete: waiter.onComplete });

    if (!result.ok) throw new Error(`Failed to create shared note: ${JSON.stringify(result.error)}`);
    await waiter.waitForSync();

    return { success: true, noteId: result.value.id, message: "Shared note created" };
  } finally {
    stopUsingSharedOwner(owner);
  }
}

async function updateSharedProjectNote(
  args: { sharedOwnerId: string; ownerSecret: string; id: string; title?: string; content?: string; position?: number }
) {
  const projectEvolu = getProjectEvolu();
  const owner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(owner);
  try {
    const updates: Record<string, unknown> = { id: args.id as ProjectNoteId };
    if (args.title !== undefined) updates.title = NonEmptyString100.orThrow(args.title);
    if (args.content !== undefined) updates.content = args.content ? EvoluString.orThrow(args.content) : null;
    if (args.position !== undefined) updates.position = Int.orThrow(args.position);

    const waiter = createMutationWaiter();
    projectEvolu.update("projectNote", updates as any, { onComplete: waiter.onComplete });
    await waiter.waitForSync();

    return { success: true, message: "Shared note updated" };
  } finally {
    stopUsingSharedOwner(owner);
  }
}

async function deleteSharedProjectNote(
  args: { sharedOwnerId: string; ownerSecret: string; id: string }
) {
  const projectEvolu = getProjectEvolu();
  const owner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(owner);
  try {
    const waiter = createMutationWaiter();
    projectEvolu.update("projectNote", { id: args.id as ProjectNoteId, isDeleted: SQLITE_TRUE } as any, { onComplete: waiter.onComplete });
    await waiter.waitForSync();
    return { success: true, message: "Shared note deleted" };
  } finally {
    stopUsingSharedOwner(owner);
  }
}
