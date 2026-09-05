import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { NonEmptyTrimmedString1000, Int, String as EvoluString } from "@evolu/common";
import { SQLITE_TRUE, type TaskId, type UserId, type WorklogId, type EvoluInstance } from "../evolu.js";
import { createMutationWaiter } from "./helpers.js";
import { logActivity } from "../utils/activityLog.js";

export const worklogTools: Tool[] = [
  {
    name: "td_list_worklogs",
    description: "List worklogs for a specific task",
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
    name: "td_add_worklog",
    description: "Add a worklog entry to a task",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Task ID (required)",
        },
        durationMinutes: {
          type: "number",
          description: "Duration in minutes (required)",
        },
        description: {
          type: "string",
          description: "Description of work done",
        },
        loggedAt: {
          type: "string",
          description: "Date when work was done (ISO format, default: today)",
        },
        userId: {
          type: "string",
          description: "User ID who did the work",
        },
      },
      required: ["taskId", "durationMinutes"],
    },
  },
  {
    name: "td_update_worklog",
    description: "Update a worklog entry",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Worklog ID (required)",
        },
        durationMinutes: {
          type: "number",
          description: "New duration in minutes",
        },
        description: {
          type: "string",
          description: "New description (or null to clear)",
        },
        loggedAt: {
          type: "string",
          description: "New date (ISO format)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "td_delete_worklog",
    description: "Delete a worklog entry (soft delete)",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Worklog ID (required)",
        },
      },
      required: ["id"],
    },
  },
];

export async function handleWorklogTool(
  name: string,
  args: Record<string, unknown>,
  evolu: EvoluInstance
): Promise<unknown> {
  switch (name) {
    case "td_list_worklogs":
      return listWorklogs(evolu, args as { taskId: string });
    case "td_add_worklog":
      return addWorklog(evolu, args as {
        taskId: string;
        durationMinutes: number;
        description?: string;
        loggedAt?: string;
        userId?: string;
      });
    case "td_update_worklog":
      return updateWorklog(evolu, args as { id: string; durationMinutes?: number; description?: string | null; loggedAt?: string });
    case "td_delete_worklog":
      return deleteWorklog(evolu, args as { id: string });
    default:
      return undefined;
  }
}

async function listWorklogs(evolu: EvoluInstance, args: { taskId: string }) {
  const query = evolu.createQuery((db: any) =>
    db
      .selectFrom("worklog")
      .leftJoin("user", "worklog.userId", "user.id")
      .select([
        "worklog.id",
        "worklog.durationMinutes",
        "worklog.description",
        "worklog.loggedAt",
        "user.id as userId",
        "user.name as userName",
      ])
      .where("worklog.taskId", "=", args.taskId as TaskId)
      .where("worklog.isDeleted", "is not", SQLITE_TRUE)
      .orderBy("worklog.loggedAt", "desc")
  );

  const result = await evolu.loadQuery(query);
  const totalMinutes = result.reduce((sum: number, w: any) => sum + (w.durationMinutes || 0), 0);

  return {
    count: result.length,
    totalMinutes,
    totalFormatted: `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`,
    worklogs: result.map((w: any) => ({
      id: w.id,
      durationMinutes: w.durationMinutes,
      description: w.description,
      loggedAt: w.loggedAt,
      user: w.userId
        ? {
            id: w.userId,
            name: w.userName,
          }
        : null,
    })),
  };
}

async function addWorklog(
  evolu: EvoluInstance,
  args: {
    taskId: string;
    durationMinutes: number;
    description?: string;
    loggedAt?: string;
    userId?: string;
  }
) {
  // TODO-90 M12: verify the task exists, otherwise a typo'd taskId logs time
  // into the void — the worklog never shows up (the UI filters by task) and the
  // logged effort is silently lost. Mirrors uploadAttachment's check.
  const taskQuery = evolu.createQuery((db: any) =>
    db
      .selectFrom("task")
      .select(["id"])
      .where("id", "=", args.taskId as TaskId)
      .where("isDeleted", "is not", SQLITE_TRUE)
      .limit(1)
  );
  const taskResult = await evolu.loadQuery(taskQuery);
  if (taskResult.length === 0) {
    throw new Error("Task not found");
  }

  const waiter = createMutationWaiter();
  const result = evolu.insert("worklog", {
    taskId: args.taskId as TaskId,
    durationMinutes: Int.orThrow(args.durationMinutes),
    description: args.description ? NonEmptyTrimmedString1000.orThrow(args.description) : null,
    loggedAt: args.loggedAt || new Date().toISOString().split("T")[0],
    userId: args.userId ? (args.userId as UserId) : null,
  }, { onComplete: waiter.onComplete });


  logActivity(evolu, {
    taskId: args.taskId,
    action: "added",
    entityType: "worklog",
    newValue: String(args.durationMinutes),
  });

  await waiter.waitForSync();

  return {
    success: true,
    worklogId: result.id,
    message: "Worklog added successfully",
  };
}

async function updateWorklog(
  evolu: EvoluInstance,
  args: { id: string; durationMinutes?: number; description?: string | null; loggedAt?: string }
) {
  const updates: Record<string, unknown> = {
    id: args.id as WorklogId,
  };

  if (args.durationMinutes !== undefined) {
    updates.durationMinutes = Int.orThrow(args.durationMinutes);
  }
  if (args.description !== undefined) {
    updates.description = args.description ? NonEmptyTrimmedString1000.orThrow(args.description) : null;
  }
  if (args.loggedAt !== undefined) {
    updates.loggedAt = EvoluString.orThrow(args.loggedAt);
  }

  const waiter = createMutationWaiter();
  const result = evolu.update("worklog", updates as any, { onComplete: waiter.onComplete });

  await waiter.waitForSync();

  return {
    success: true,
    message: `Worklog updated successfully`,
  };
}

async function deleteWorklog(evolu: EvoluInstance, args: { id: string }) {
  const waiter = createMutationWaiter();
  const result = evolu.update("worklog", {
    id: args.id as WorklogId,
    isDeleted: SQLITE_TRUE,
  } as any, { onComplete: waiter.onComplete });

  await waiter.waitForSync();

  return {
    success: true,
    message: "Worklog deleted successfully",
  };
}
