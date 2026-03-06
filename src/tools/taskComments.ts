import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { String as EvoluString } from "@evolu/common";
import { SQLITE_TRUE, type TaskId, type UserId, type TaskCommentId, type EvoluInstance } from "../evolu.js";
import { createMutationWaiter, getSyncWarning } from "./helpers.js";

export const taskCommentTools: Tool[] = [
  {
    name: "td_list_task_comments",
    description: "List comments for a specific task",
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
    name: "td_create_task_comment",
    description: "Add a comment to a task",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Task ID (required)",
        },
        content: {
          type: "string",
          description: "Comment content (HTML supported, required)",
        },
        userId: {
          type: "string",
          description: "User ID of the commenter",
        },
      },
      required: ["taskId", "content"],
    },
  },
  {
    name: "td_update_task_comment",
    description: "Update a task comment",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Comment ID (required)",
        },
        content: {
          type: "string",
          description: "New comment content (required)",
        },
      },
      required: ["id", "content"],
    },
  },
  {
    name: "td_delete_task_comment",
    description: "Delete a task comment (soft delete)",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Comment ID (required)",
        },
      },
      required: ["id"],
    },
  },
];

export async function handleTaskCommentTool(
  name: string,
  args: Record<string, unknown>,
  evolu: EvoluInstance
): Promise<unknown> {
  switch (name) {
    case "td_list_task_comments":
      return listTaskComments(evolu, args as { taskId: string });
    case "td_create_task_comment":
      return createTaskComment(evolu, args as { taskId: string; content: string; userId?: string });
    case "td_update_task_comment":
      return updateTaskComment(evolu, args as { id: string; content: string });
    case "td_delete_task_comment":
      return deleteTaskComment(evolu, args as { id: string });
    default:
      return undefined;
  }
}

async function listTaskComments(evolu: EvoluInstance, args: { taskId: string }) {
  const query = evolu.createQuery((db: any) =>
    db
      .selectFrom("taskComment")
      .leftJoin("user", "taskComment.userId", "user.id")
      .select([
        "taskComment.id",
        "taskComment.content",
        "taskComment.createdAt",
        "taskComment.updatedAt",
        "user.id as userId",
        "user.name as userName",
        "user.color as userColor",
      ])
      .where("taskComment.taskId", "=", args.taskId as TaskId)
      .where("taskComment.isDeleted", "is not", SQLITE_TRUE)
      .orderBy("taskComment.createdAt", "asc")
  );

  const result = await evolu.loadQuery(query);
  return {
    count: result.length,
    comments: result.map((c: any) => ({
      id: c.id,
      content: c.content,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      user: c.userId
        ? { id: c.userId, name: c.userName, color: c.userColor }
        : null,
    })),
  };
}

async function createTaskComment(
  evolu: EvoluInstance,
  args: { taskId: string; content: string; userId?: string }
) {
  const waiter = createMutationWaiter();
  const result = evolu.insert("taskComment", {
    taskId: args.taskId as TaskId,
    content: EvoluString.orThrow(args.content),
    userId: args.userId ? (args.userId as UserId) : null,
  }, { onComplete: waiter.onComplete });

  if (!result.ok) {
    throw new Error(`Failed to create comment: ${JSON.stringify(result.error)}`);
  }

  await waiter.waitForSync();

  return {
    success: true,
    commentId: result.value.id,
    message: `Comment created successfully${getSyncWarning()}`,
  };
}

async function updateTaskComment(
  evolu: EvoluInstance,
  args: { id: string; content: string }
) {
  const waiter = createMutationWaiter();
  evolu.update("taskComment", {
    id: args.id as TaskCommentId,
    content: EvoluString.orThrow(args.content),
  } as any, { onComplete: waiter.onComplete });

  await waiter.waitForSync();

  return {
    success: true,
    message: `Comment updated successfully${getSyncWarning()}`,
  };
}

async function deleteTaskComment(evolu: EvoluInstance, args: { id: string }) {
  const waiter = createMutationWaiter();
  evolu.update("taskComment", {
    id: args.id as TaskCommentId,
    isDeleted: SQLITE_TRUE,
  } as any, { onComplete: waiter.onComplete });

  await waiter.waitForSync();

  return {
    success: true,
    message: "Comment deleted successfully",
  };
}
