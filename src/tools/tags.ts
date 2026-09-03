import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { NonEmptyTrimmedString100, String as EvoluString } from "@evolu/common";
import { SQLITE_TRUE, type TaskId, type TagId, type TaskTagId, type ProjectId, type EvoluInstance } from "../evolu.js";
import { createMutationWaiter, getSyncWarning , assertMutation} from "./helpers.js";

export const tagTools: Tool[] = [
  {
    name: "td_list_tags",
    description:
      "List tags. Returns projectId — tags created before TODO-227 (or via td_create_tag without one) have none and the app never offers them until they are assigned to a project. Also returns isDefault: those tags are applied to every task newly created in the project.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Only tags of this project. Omit for all tags.",
        },
        unassignedOnly: {
          type: "boolean",
          description: "Only tags with no project — the ones the app will not offer.",
        },
      },
    },
  },
  {
    name: "td_create_tag",
    description:
      "Create a tag. Pass projectId — without it the tag is created unassigned and the app will not offer it anywhere until you assign it (Project settings -> Štítky -> Nezařazené).",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Tag name (required)",
        },
        color: {
          type: "string",
          description: "Hex color (e.g., '#ef4444', default: '#6b7280')",
        },
        projectId: {
          type: "string",
          description: "Project the tag belongs to. Strongly recommended; see the tool description.",
        },
        isDefault: {
          type: "boolean",
          description: "Apply this tag to every task newly created in the project (TODO-239). Existing tasks are untouched.",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "td_update_tag",
    description: "Rename a tag, change its color, assign it to a project, or mark it default for new tasks",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Tag ID (required)" },
        name: { type: "string", description: "New name" },
        color: { type: "string", description: "New hex color" },
        projectId: {
          type: "string",
          description: "Assign to this project. Use to adopt a previously unassigned tag.",
        },
        isDefault: {
          type: "boolean",
          description: "Apply this tag to every task newly created in the project (TODO-239). Existing tasks are untouched.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "td_delete_tag",
    description: "Delete a tag and remove it from all tasks (soft delete)",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Tag ID (required)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "td_list_task_tags",
    description: "List tags assigned to a specific task",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Task ID (required)",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "td_add_tag_to_task",
    description: "Assign a tag to a task",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Task ID (required)",
        },
        tagId: {
          type: "string",
          description: "Tag ID (required)",
        },
      },
      required: ["taskId", "tagId"],
    },
  },
  {
    name: "td_remove_tag_from_task",
    description: "Remove a tag from a task (soft delete the taskTag link)",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Task ID (required)",
        },
        tagId: {
          type: "string",
          description: "Tag ID (required)",
        },
      },
      required: ["taskId", "tagId"],
    },
  },
];

export async function handleTagTool(
  name: string,
  args: Record<string, unknown>,
  evolu: EvoluInstance
): Promise<unknown> {
  switch (name) {
    case "td_list_tags":
      return listTags(evolu, args as { projectId?: string; unassignedOnly?: boolean });
    case "td_create_tag":
      return createTag(evolu, args as { name: string; color?: string; projectId?: string; isDefault?: boolean });
    case "td_update_tag":
      return updateTag(evolu, args as { id: string; name?: string; color?: string; projectId?: string; isDefault?: boolean });
    case "td_delete_tag":
      return deleteTag(evolu, args as { id: string });
    case "td_list_task_tags":
      return listTaskTags(evolu, args as { taskId: string });
    case "td_add_tag_to_task":
      return addTagToTask(evolu, args as { taskId: string; tagId: string });
    case "td_remove_tag_from_task":
      return removeTagFromTask(evolu, args as { taskId: string; tagId: string });
    default:
      return undefined;
  }
}

async function listTags(
  evolu: EvoluInstance,
  args: { projectId?: string; unassignedOnly?: boolean } = {}
) {
  const query = evolu.createQuery((db: any) =>
    db
      .selectFrom("tag")
      .select(["id", "name", "color", "projectId", "isDefault"])
      .where("isDeleted", "is not", SQLITE_TRUE)
      .orderBy("name", "asc")
  );

  const result = await evolu.loadQuery(query);
  // Filtered here rather than in SQL: every selected column comes back nullable,
  // so "has no project" has to be checked on the row anyway.
  const filtered = result.filter((t: any) => {
    if (args.unassignedOnly) return !t.projectId;
    if (args.projectId) return t.projectId === args.projectId;
    return true;
  });

  return {
    count: filtered.length,
    tags: filtered.map((t: any) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      projectId: t.projectId ?? null,
      isDefault: !!t.isDefault,
    })),
  };
}

async function createTag(
  evolu: EvoluInstance,
  args: { name: string; color?: string; projectId?: string; isDefault?: boolean }
) {
  const waiter = createMutationWaiter();
  const result = evolu.insert("tag", {
    name: NonEmptyTrimmedString100.orThrow(args.name),
    color: EvoluString.orThrow(args.color || "#6b7280"),
    projectId: (args.projectId ?? null) as ProjectId,
    isDefault: args.isDefault ? SQLITE_TRUE : null,
  }, { onComplete: waiter.onComplete });

  await waiter.waitForSync();

  // Say it out loud when the tag will not appear anywhere: an unassigned tag is
  // silently invisible in the app, which is a confusing way to learn about it.
  const unassignedNote = args.projectId
    ? ""
    : " — WITHOUT a project, so the app will not offer it until you assign one (Project settings -> Štítky -> Nezařazené, or td_update_tag with projectId)";

  return {
    success: true,
    tagId: result.id,
    message: `Tag "${args.name}" created successfully${unassignedNote}${getSyncWarning()}`,
  };
}

async function updateTag(
  evolu: EvoluInstance,
  args: { id: string; name?: string; color?: string; projectId?: string; isDefault?: boolean }
) {
  const waiter = createMutationWaiter();
  const result = evolu.update("tag", {
    id: args.id as TagId,
    ...(args.name !== undefined ? { name: NonEmptyTrimmedString100.orThrow(args.name) } : {}),
    ...(args.color !== undefined ? { color: EvoluString.orThrow(args.color) } : {}),
    ...(args.projectId !== undefined ? { projectId: args.projectId as ProjectId } : {}),
    ...(args.isDefault !== undefined ? { isDefault: args.isDefault ? SQLITE_TRUE : null } : {}),
  }, { onComplete: waiter.onComplete });

  assertMutation("td_update_tag", result);
  await waiter.waitForSync();

  return {
    success: true,
    message: `Tag updated successfully${getSyncWarning()}`,
  };
}

async function deleteTag(evolu: EvoluInstance, args: { id: string }) {
  // Also delete all taskTag links for this tag
  const linksQuery = evolu.createQuery((db: any) =>
    db
      .selectFrom("taskTag")
      .select(["id"])
      .where("tagId", "=", args.id as TagId)
      .where("isDeleted", "is not", SQLITE_TRUE)
  );
  const links = await evolu.loadQuery(linksQuery);
  for (const link of links) {
    assertMutation("deleteTag",
      evolu.update("taskTag", {
        id: (link as any).id as TaskTagId,
        isDeleted: SQLITE_TRUE,
      } as any)
    );
  }

  const waiter = createMutationWaiter();
  assertMutation("deleteTag",
    evolu.update("tag", {
      id: args.id as TagId,
      isDeleted: SQLITE_TRUE,
    } as any, { onComplete: waiter.onComplete })
  );

  await waiter.waitForSync();

  return {
    success: true,
    message: "Tag deleted successfully",
  };
}

async function listTaskTags(evolu: EvoluInstance, args: { taskId: string }) {
  const query = evolu.createQuery((db: any) =>
    db
      .selectFrom("taskTag")
      .innerJoin("tag", "taskTag.tagId", "tag.id")
      .select([
        "taskTag.id as taskTagId",
        "tag.id as tagId",
        "tag.name",
        "tag.color",
      ])
      .where("taskTag.taskId", "=", args.taskId as TaskId)
      .where("taskTag.isDeleted", "is not", SQLITE_TRUE)
      .where("tag.isDeleted", "is not", SQLITE_TRUE)
  );

  const result = await evolu.loadQuery(query);
  return {
    count: result.length,
    tags: result.map((t: any) => ({
      taskTagId: t.taskTagId,
      tagId: t.tagId,
      name: t.name,
      color: t.color,
    })),
  };
}

async function addTagToTask(evolu: EvoluInstance, args: { taskId: string; tagId: string }) {
  // Check if already linked
  const existingQuery = evolu.createQuery((db: any) =>
    db
      .selectFrom("taskTag")
      .select(["id"])
      .where("taskId", "=", args.taskId as TaskId)
      .where("tagId", "=", args.tagId as TagId)
      .where("isDeleted", "is not", SQLITE_TRUE)
      .limit(1)
  );
  const existing = await evolu.loadQuery(existingQuery);
  if (existing.length > 0) {
    return {
      success: true,
      message: "Tag is already assigned to this task",
    };
  }

  const waiter = createMutationWaiter();
  const result = evolu.insert("taskTag", {
    taskId: args.taskId as TaskId,
    tagId: args.tagId as TagId,
  }, { onComplete: waiter.onComplete });

  await waiter.waitForSync();

  return {
    success: true,
    taskTagId: result.id,
    message: `Tag added to task successfully${getSyncWarning()}`,
  };
}

async function removeTagFromTask(evolu: EvoluInstance, args: { taskId: string; tagId: string }) {
  const query = evolu.createQuery((db: any) =>
    db
      .selectFrom("taskTag")
      .select(["id"])
      .where("taskId", "=", args.taskId as TaskId)
      .where("tagId", "=", args.tagId as TagId)
      .where("isDeleted", "is not", SQLITE_TRUE)
      .limit(1)
  );

  const result = await evolu.loadQuery(query);
  if (result.length === 0) {
    return {
      success: true,
      message: "Tag was not assigned to this task",
    };
  }

  const waiter = createMutationWaiter();
  assertMutation("removeTagFromTask",
    evolu.update("taskTag", {
      id: (result[0] as any).id as TaskTagId,
      isDeleted: SQLITE_TRUE,
    } as any, { onComplete: waiter.onComplete })
  );

  await waiter.waitForSync();

  return {
    success: true,
    message: "Tag removed from task successfully",
  };
}
