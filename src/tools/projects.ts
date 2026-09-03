import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { NonEmptyTrimmedString100, String as EvoluString, Int } from "@evolu/common";
import { SQLITE_TRUE, type ProjectId, type EvoluInstance } from "../evolu.js";
import { createMutationWaiter, getSyncWarning , assertMutation} from "./helpers.js";
import { freeTierNote } from "./tierWarning.js";

export const projectTools: Tool[] = [
  {
    name: "td_list_projects",
    description: "List all projects in Todocko. Returns project id, name, code, color, and status.",
    inputSchema: {
      type: "object",
      properties: {
        includeArchived: {
          type: "boolean",
          description: "Include archived projects (default: false)",
        },
      },
    },
  },
  {
    name: "td_get_project",
    description: "Get a specific project by ID or code",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Project ID",
        },
        code: {
          type: "string",
          description: "Project code (e.g., 'TODO', 'PROJ')",
        },
      },
    },
  },
  {
    name: "td_create_project",
    description: "Create a new project",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Project name (required)",
        },
        code: {
          type: "string",
          description: "Project code (e.g., 'TODO', 'PROJ') — used in task codes like TODO-1",
        },
        color: {
          type: "string",
          description: "Hex color (e.g., '#3b82f6', default: '#6b7280')",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "td_update_project",
    description: "Update an existing project",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Project ID (required)",
        },
        name: {
          type: "string",
          description: "New project name",
        },
        code: {
          type: "string",
          description: "New project code",
        },
        color: {
          type: "string",
          description: "New hex color",
        },
        isArchived: {
          type: "boolean",
          description: "Archive or unarchive the project",
        },
        isHiddenFromFilters: {
          type: "boolean",
          description: "Hide project from dashboard filters",
        },
        autoApproveMembers: {
          type: "boolean",
          description: "Auto-approve new members joining the project",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "td_delete_project",
    description: "Delete a project (soft delete). Tasks are NOT deleted — reassign them first.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Project ID (required)",
        },
      },
      required: ["id"],
    },
  },
];

export async function handleProjectTool(
  name: string,
  args: Record<string, unknown>,
  evolu: EvoluInstance
): Promise<unknown> {
  switch (name) {
    case "td_list_projects":
      return listProjects(evolu, args as { includeArchived?: boolean });
    case "td_get_project":
      return getProject(evolu, args as { id?: string; code?: string });
    case "td_create_project":
      return createProject(evolu, args as { name: string; code?: string; color?: string });
    case "td_update_project":
      return updateProject(evolu, args as { id: string; name?: string; code?: string; color?: string; isArchived?: boolean; isHiddenFromFilters?: boolean; autoApproveMembers?: boolean });
    case "td_delete_project":
      return deleteProject(evolu, args as { id: string });
    default:
      return undefined;
  }
}

async function listProjects(
  evolu: EvoluInstance,
  args: { includeArchived?: boolean }
) {
  const query = evolu.createQuery((db: any) => {
    let q = db
      .selectFrom("project")
      .select(["id", "name", "code", "color", "isArchived", "isHiddenFromFilters", "position"])
      .where("isDeleted", "is not", SQLITE_TRUE)
      .orderBy("position", "asc");

    if (!args.includeArchived) {
      q = q.where("isArchived", "is not", SQLITE_TRUE);
    }

    return q;
  });

  const result = await evolu.loadQuery(query);
  return {
    count: result.length,
    projects: result.map((p: any) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      color: p.color,
      isArchived: p.isArchived === SQLITE_TRUE,
      isHiddenFromFilters: p.isHiddenFromFilters === SQLITE_TRUE,
    })),
  };
}

async function getProject(
  evolu: EvoluInstance,
  args: { id?: string; code?: string }
) {
  if (!args.id && !args.code) {
    throw new Error("Either id or code is required");
  }

  const query = evolu.createQuery((db: any) => {
    let q = db
      .selectFrom("project")
      .select(["id", "name", "code", "color", "isArchived", "isHiddenFromFilters", "position"])
      .where("isDeleted", "is not", SQLITE_TRUE);

    if (args.id) {
      q = q.where("id", "=", args.id as ProjectId);
    } else if (args.code) {
      q = q.where("code", "=", args.code as unknown as typeof NonEmptyTrimmedString100.Output);
    }

    return q.limit(1);
  });

  const result = await evolu.loadQuery(query);
  if (result.length === 0) {
    return { error: "Project not found" };
  }

  const p = result[0] as any;
  return {
    id: p.id,
    name: p.name,
    code: p.code,
    color: p.color,
    isArchived: p.isArchived === SQLITE_TRUE,
    isHiddenFromFilters: p.isHiddenFromFilters === SQLITE_TRUE,
  };
}

async function createProject(
  evolu: EvoluInstance,
  args: { name: string; code?: string; color?: string }
) {
  // Get max position
  const posQuery = evolu.createQuery((db: any) =>
    db.selectFrom("project").select(["position"]).orderBy("position", "desc").limit(1)
  );
  const posResult = await evolu.loadQuery(posQuery);
  const maxPosition = posResult.length > 0 ? ((posResult[0] as any).position || 0) : 0;

  const waiter = createMutationWaiter();
  const result = evolu.insert("project", {
    name: NonEmptyTrimmedString100.orThrow(args.name),
    code: args.code ? NonEmptyTrimmedString100.orThrow(args.code) : null,
    color: EvoluString.orThrow(args.color || "#6b7280"),
    isArchived: null,
    isHiddenFromFilters: null,
    position: Int.orThrow(maxPosition + 1),
  }, { onComplete: waiter.onComplete });

  await waiter.waitForSync();

  return {
    success: true,
    projectId: result.id,
    message: `Project "${args.name}" created successfully${getSyncWarning()}${await freeTierNote(evolu, "project")}`,
  };
}

async function updateProject(
  evolu: EvoluInstance,
  args: { id: string; name?: string; code?: string; color?: string; isArchived?: boolean; isHiddenFromFilters?: boolean; autoApproveMembers?: boolean }
) {
  const updates: Record<string, unknown> = {
    id: args.id as ProjectId,
  };

  if (args.name !== undefined) {
    updates.name = NonEmptyTrimmedString100.orThrow(args.name);
  }
  if (args.code !== undefined) {
    updates.code = args.code ? NonEmptyTrimmedString100.orThrow(args.code) : null;
  }
  if (args.color !== undefined) {
    updates.color = EvoluString.orThrow(args.color);
  }
  if (args.isArchived !== undefined) {
    updates.isArchived = args.isArchived ? SQLITE_TRUE : null;
  }
  if (args.isHiddenFromFilters !== undefined) {
    updates.isHiddenFromFilters = args.isHiddenFromFilters ? SQLITE_TRUE : null;
  }
  if (args.autoApproveMembers !== undefined) {
    updates.autoApproveMembers = args.autoApproveMembers ? SQLITE_TRUE : null;
  }

  const waiter = createMutationWaiter();
  assertMutation("updateProject", evolu.update("project", updates as any, { onComplete: waiter.onComplete }));

  await waiter.waitForSync();

  return {
    success: true,
    message: `Project updated successfully${getSyncWarning()}`,
  };
}

async function deleteProject(evolu: EvoluInstance, args: { id: string }) {
  const waiter = createMutationWaiter();
  assertMutation("deleteProject",
    evolu.update("project", {
      id: args.id as ProjectId,
      isDeleted: SQLITE_TRUE,
    } as any, { onComplete: waiter.onComplete })
  );

  await waiter.waitForSync();

  return {
    success: true,
    message: "Project deleted successfully",
  };
}
