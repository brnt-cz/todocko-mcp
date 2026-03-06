import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { SQLITE_TRUE, type TaskId, type EvoluInstance } from "../evolu.js";

export const activityLogTools: Tool[] = [
  {
    name: "td_list_activity_log",
    description: "List activity log entries. Read-only — shows task changes, status updates, etc.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Filter by task ID",
        },
        actorId: {
          type: "string",
          description: "Filter by actor (user who made the change)",
        },
        action: {
          type: "string",
          description: "Filter by action type (e.g., 'created', 'updated', 'deleted')",
        },
        limit: {
          type: "number",
          description: "Maximum results (default: 50)",
        },
      },
    },
  },
];

export async function handleActivityLogTool(
  name: string,
  args: Record<string, unknown>,
  evolu: EvoluInstance
): Promise<unknown> {
  switch (name) {
    case "td_list_activity_log":
      return listActivityLog(evolu, args as { taskId?: string; actorId?: string; action?: string; limit?: number });
    default:
      return undefined;
  }
}

async function listActivityLog(
  evolu: EvoluInstance,
  args: { taskId?: string; actorId?: string; action?: string; limit?: number }
) {
  const query = evolu.createQuery((db: any) => {
    let q = db
      .selectFrom("activityLog")
      .leftJoin("task", "activityLog.taskId", "task.id")
      .select([
        "activityLog.id",
        "activityLog.taskId",
        "activityLog.actorId",
        "activityLog.action",
        "activityLog.entityType",
        "activityLog.field",
        "activityLog.oldValue",
        "activityLog.newValue",
        "activityLog.metadata",
        "activityLog.createdAt",
        "task.title as taskCode",
        "task.name as taskName",
      ])
      .where("activityLog.isDeleted", "is not", SQLITE_TRUE)
      .orderBy("activityLog.createdAt", "desc");

    if (args.taskId) {
      q = q.where("activityLog.taskId", "=", args.taskId as TaskId);
    }
    if (args.actorId) {
      q = q.where("activityLog.actorId", "=", args.actorId);
    }
    if (args.action) {
      q = q.where("activityLog.action", "=", args.action);
    }

    return q.limit(args.limit || 50);
  });

  const result = await evolu.loadQuery(query);
  return {
    count: result.length,
    entries: result.map((e: any) => ({
      id: e.id,
      taskId: e.taskId,
      taskCode: e.taskCode,
      taskName: e.taskName,
      actorId: e.actorId,
      action: e.action,
      entityType: e.entityType,
      field: e.field,
      oldValue: e.oldValue,
      newValue: e.newValue,
      metadata: e.metadata,
      createdAt: e.createdAt,
    })),
  };
}
