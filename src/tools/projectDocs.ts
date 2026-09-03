import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { NonEmptyTrimmedString100, String as EvoluString, Int } from "@evolu/common";
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
import { createMutationWaiter, getSyncWarning , assertMutation} from "./helpers.js";

export const projectDocTools: Tool[] = [
  // Local project docs (not synced)
  {
    name: "td_list_project_docs",
    description: "List local project document pages (not synced to shared projects)",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Filter by project ID" },
      },
    },
  },
  {
    name: "td_create_project_doc",
    description: "Create a local project document page",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project ID (required)" },
        title: { type: "string", description: "Document page title (required)" },
        content: { type: "string", description: "Document content (HTML)" },
        parentDocId: { type: "string", description: "Parent document ID for hierarchy (null for root pages)" },
      },
      required: ["projectId", "title"],
    },
  },
  {
    name: "td_update_project_doc",
    description: "Update a local project document page",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Document page ID (required)" },
        title: { type: "string" },
        content: { type: "string" },
        position: { type: "number" },
        parentDocId: { type: "string", description: "Parent document ID (null to make root page)" },
      },
      required: ["id"],
    },
  },
  {
    name: "td_delete_project_doc",
    description: "Delete a local project document page (soft delete)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Document page ID (required)" },
      },
      required: ["id"],
    },
  },
  // Shared project docs
  {
    name: "td_list_shared_project_docs",
    description: "List document pages from a shared project",
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
    name: "td_create_shared_project_doc",
    description: "Create a document page in a shared project",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID (required)" },
        ownerSecret: { type: "string", description: "Owner secret (required)" },
        projectId: { type: "string", description: "Project ID (required)" },
        title: { type: "string", description: "Document page title (required)" },
        content: { type: "string", description: "Document content (HTML)" },
        parentDocId: { type: "string", description: "Parent document ID for hierarchy (null for root pages)" },
      },
      required: ["sharedOwnerId", "ownerSecret", "projectId", "title"],
    },
  },
  {
    name: "td_update_shared_project_doc",
    description: "Update a document page in a shared project",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID (required)" },
        ownerSecret: { type: "string", description: "Owner secret (required)" },
        id: { type: "string", description: "Document page ID (required)" },
        title: { type: "string" },
        content: { type: "string" },
        position: { type: "number" },
        parentDocId: { type: "string", description: "Parent document ID (null to make root page)" },
      },
      required: ["sharedOwnerId", "ownerSecret", "id"],
    },
  },
  {
    name: "td_delete_shared_project_doc",
    description: "Delete a document page in a shared project (soft delete)",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID (required)" },
        ownerSecret: { type: "string", description: "Owner secret (required)" },
        id: { type: "string", description: "Document page ID (required)" },
      },
      required: ["sharedOwnerId", "ownerSecret", "id"],
    },
  },
];

export async function handleProjectDocTool(
  name: string,
  args: Record<string, unknown>,
  evolu: EvoluInstance
): Promise<unknown> {
  switch (name) {
    case "td_list_project_docs":
      return listProjectDocs(evolu, args as { projectId?: string });
    case "td_create_project_doc":
      return createProjectDoc(evolu, args as { projectId: string; title: string; content?: string; parentDocId?: string });
    case "td_update_project_doc":
      return updateProjectDoc(evolu, args as { id: string; title?: string; content?: string; position?: number; parentDocId?: string });
    case "td_delete_project_doc":
      return deleteProjectDoc(evolu, args as { id: string });
    case "td_list_shared_project_docs":
      return listSharedProjectDocs(args as { sharedOwnerId: string; ownerSecret: string; projectId?: string });
    case "td_create_shared_project_doc":
      return createSharedProjectDoc(args as { sharedOwnerId: string; ownerSecret: string; projectId: string; title: string; content?: string; parentDocId?: string });
    case "td_update_shared_project_doc":
      return updateSharedProjectDoc(args as { sharedOwnerId: string; ownerSecret: string; id: string; title?: string; content?: string; position?: number; parentDocId?: string });
    case "td_delete_shared_project_doc":
      return deleteSharedProjectDoc(args as { sharedOwnerId: string; ownerSecret: string; id: string });
    default:
      return undefined;
  }
}

// --- Local project docs ---

async function listProjectDocs(evolu: EvoluInstance, args: { projectId?: string }) {
  const query = evolu.createQuery((db: any) => {
    let q = db
      .selectFrom("localProjectNote")
      .select(["id", "projectId", "title", "content", "position", "parentDocId"])
      .where("isDeleted", "is not", SQLITE_TRUE)
      .where("isDoc", "=", SQLITE_TRUE)
      .orderBy("position", "asc");
    if (args.projectId) {
      q = q.where("projectId", "=", args.projectId as ProjectId);
    }
    return q;
  });
  const result = await evolu.loadQuery(query);
  return {
    count: result.length,
    docs: result.map((n: any) => ({
      id: n.id, projectId: n.projectId, title: n.title, content: n.content,
      position: n.position, parentDocId: n.parentDocId,
    })),
  };
}

async function createProjectDoc(
  evolu: EvoluInstance,
  args: { projectId: string; title: string; content?: string; parentDocId?: string }
) {
  const posQuery = evolu.createQuery((db: any) =>
    db.selectFrom("localProjectNote").select(["position"])
      .where("projectId", "=", args.projectId as ProjectId)
      .where("isDeleted", "is not", SQLITE_TRUE)
      .where("isDoc", "=", SQLITE_TRUE)
      .orderBy("position", "desc").limit(1)
  );
  const posResult = await evolu.loadQuery(posQuery);
  const maxPos = posResult.length > 0 ? ((posResult[0] as any).position || 0) : 0;

  const waiter = createMutationWaiter();
  const result = evolu.insert("localProjectNote", {
    projectId: args.projectId as ProjectId,
    title: NonEmptyTrimmedString100.orThrow(args.title),
    content: args.content ? EvoluString.orThrow(args.content) : null,
    position: Int.orThrow(maxPos + 1),
    isDoc: SQLITE_TRUE,
    parentDocId: args.parentDocId ? EvoluString.orThrow(args.parentDocId) : null,
  }, { onComplete: waiter.onComplete });

  await waiter.waitForSync();

  return { success: true, docId: result.id, message: `Document page created${getSyncWarning()}` };
}

async function updateProjectDoc(
  evolu: EvoluInstance,
  args: { id: string; title?: string; content?: string; position?: number; parentDocId?: string }
) {
  const updates: Record<string, unknown> = { id: args.id as LocalProjectNoteId };
  if (args.title !== undefined) updates.title = NonEmptyTrimmedString100.orThrow(args.title);
  if (args.content !== undefined) updates.content = args.content ? EvoluString.orThrow(args.content) : null;
  if (args.position !== undefined) updates.position = Int.orThrow(args.position);
  if (args.parentDocId !== undefined) updates.parentDocId = args.parentDocId ? EvoluString.orThrow(args.parentDocId) : null;

  const waiter = createMutationWaiter();
  assertMutation("updateProjectDoc", evolu.update("localProjectNote", updates as any, { onComplete: waiter.onComplete }));
  await waiter.waitForSync();

  return { success: true, message: `Document page updated${getSyncWarning()}` };
}

async function deleteProjectDoc(evolu: EvoluInstance, args: { id: string }) {
  const waiter = createMutationWaiter();
  assertMutation("deleteProjectDoc", evolu.update("localProjectNote", { id: args.id as LocalProjectNoteId, isDeleted: SQLITE_TRUE } as any, { onComplete: waiter.onComplete }));
  await waiter.waitForSync();
  return { success: true, message: "Document page deleted" };
}

// --- Shared project docs ---

async function listSharedProjectDocs(args: { sharedOwnerId: string; ownerSecret: string; projectId?: string }) {
  const projectEvolu = getProjectEvolu();
  const owner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(owner);
  try {
    const query = projectEvolu.createQuery((db: any) => {
      let q = db
        .selectFrom("projectNote")
        .select(["id", "ownerId", "projectId", "title", "content", "createdBy", "position", "parentDocId"])
        .where("isDeleted", "is not", SQLITE_TRUE)
        .where("isDoc", "=", SQLITE_TRUE)
        .orderBy("position", "asc");
      if (args.projectId) {
        q = q.where("projectId", "=", args.projectId as ProjectId);
      }
      return q;
    });
    const result = await projectEvolu.loadQuery(query);
    const actualOwnerId = owner.id as string;
    const filtered = result.filter((n: any) => (n.ownerId as string | undefined) === actualOwnerId);
    return {
      count: filtered.length,
      docs: filtered.map((n: any) => ({
        id: n.id, projectId: n.projectId, title: n.title, content: n.content,
        createdBy: n.createdBy, position: n.position, parentDocId: n.parentDocId,
      })),
    };
  } finally {
    stopUsingSharedOwner(owner);
  }
}

async function createSharedProjectDoc(
  args: { sharedOwnerId: string; ownerSecret: string; projectId: string; title: string; content?: string; parentDocId?: string }
) {
  const projectEvolu = getProjectEvolu();
  const owner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(owner);
  try {
    const posQuery = projectEvolu.createQuery((db: any) =>
      db.selectFrom("projectNote").select(["position"])
        .where("projectId", "=", args.projectId as ProjectId)
        .where("isDeleted", "is not", SQLITE_TRUE)
        .where("isDoc", "=", SQLITE_TRUE)
        // Same trap as the shared task listing: `limit(1)` runs in SQLite, so
        // without this the next position is derived from some other owner's
        // highest one and shared positions collide or jump.
        .where("ownerId", "=", owner.id as string)
        .orderBy("position", "desc").limit(1)
    );
    const posResult = await projectEvolu.loadQuery(posQuery);
    const maxPos = posResult.length > 0 ? ((posResult[0] as any).position || 0) : 0;

    const waiter = createMutationWaiter();
    const result = projectEvolu.insert("projectNote", {
      projectId: args.projectId as ProjectId,
      title: NonEmptyTrimmedString100.orThrow(args.title),
      content: args.content ? EvoluString.orThrow(args.content) : null,
      createdBy: null,
      position: Int.orThrow(maxPos + 1),
      isDoc: SQLITE_TRUE,
      parentDocId: args.parentDocId ? EvoluString.orThrow(args.parentDocId) : null,
    }, { onComplete: waiter.onComplete });

    await waiter.waitForSync();

    return { success: true, docId: result.id, message: "Shared document page created" };
  } finally {
    stopUsingSharedOwner(owner);
  }
}

async function updateSharedProjectDoc(
  args: { sharedOwnerId: string; ownerSecret: string; id: string; title?: string; content?: string; position?: number; parentDocId?: string }
) {
  const projectEvolu = getProjectEvolu();
  const owner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(owner);
  try {
    const updates: Record<string, unknown> = { id: args.id as ProjectNoteId };
    if (args.title !== undefined) updates.title = NonEmptyTrimmedString100.orThrow(args.title);
    if (args.content !== undefined) updates.content = args.content ? EvoluString.orThrow(args.content) : null;
    if (args.position !== undefined) updates.position = Int.orThrow(args.position);
    if (args.parentDocId !== undefined) updates.parentDocId = args.parentDocId ? EvoluString.orThrow(args.parentDocId) : null;

    const waiter = createMutationWaiter();
    projectEvolu.update("projectNote", updates as any, { onComplete: waiter.onComplete });
    await waiter.waitForSync();

    return { success: true, message: "Shared document page updated" };
  } finally {
    stopUsingSharedOwner(owner);
  }
}

async function deleteSharedProjectDoc(
  args: { sharedOwnerId: string; ownerSecret: string; id: string }
) {
  const projectEvolu = getProjectEvolu();
  const owner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(owner);
  try {
    const waiter = createMutationWaiter();
    projectEvolu.update("projectNote", { id: args.id as ProjectNoteId, isDeleted: SQLITE_TRUE } as any, { onComplete: waiter.onComplete });
    await waiter.waitForSync();
    return { success: true, message: "Shared document page deleted" };
  } finally {
    stopUsingSharedOwner(owner);
  }
}
