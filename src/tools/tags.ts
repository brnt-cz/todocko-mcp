import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { NonEmptyString100, String as EvoluString } from "@evolu/common";
import { SQLITE_TRUE, type TaskId, type TagId, type TaskTagId, type EvoluInstance } from "../evolu.js";
import { createMutationWaiter, getSyncWarning , assertMutation} from "./helpers.js";

export const tagTools: Tool[] = [
  {
    name: "td_list_tags",
    description: "List all tags",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "td_create_tag",
    description: "Create a new tag",
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
      },
      required: ["name"],
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
      return listTags(evolu);
    case "td_create_tag":
      return createTag(evolu, args as { name: string; color?: string });
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

async function listTags(evolu: EvoluInstance) {
  const query = evolu.createQuery((db: any) =>
    db
      .selectFrom("tag")
      .select(["id", "name", "color"])
      .where("isDeleted", "is not", SQLITE_TRUE)
      .orderBy("name", "asc")
  );

  const result = await evolu.loadQuery(query);
  return {
    count: result.length,
    tags: result.map((t: any) => ({
      id: t.id,
      name: t.name,
      color: t.color,
    })),
  };
}

async function createTag(evolu: EvoluInstance, args: { name: string; color?: string }) {
  const waiter = createMutationWaiter();
  const result = evolu.insert("tag", {
    name: NonEmptyString100.orThrow(args.name),
    color: EvoluString.orThrow(args.color || "#6b7280"),
  }, { onComplete: waiter.onComplete });

  if (!result.ok) {
    throw new Error(`Failed to create tag: ${JSON.stringify(result.error)}`);
  }

  await waiter.waitForSync();

  return {
    success: true,
    tagId: result.value.id,
    message: `Tag "${args.name}" created successfully${getSyncWarning()}`,
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

  if (!result.ok) {
    throw new Error(`Failed to add tag to task: ${JSON.stringify(result.error)}`);
  }

  await waiter.waitForSync();

  return {
    success: true,
    taskTagId: result.value.id,
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
