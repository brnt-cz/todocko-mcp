import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { String as EvoluString } from "@evolu/common";
import { SQLITE_TRUE, type TaskId, type TaskLinkId, type EvoluInstance } from "../evolu.js";
import { createMutationWaiter , assertMutation} from "./helpers.js";

export const taskLinkTools: Tool[] = [
  {
    name: "td_list_task_links",
    description: "List dependency/blocking links for a task. Returns both outgoing (this task blocks) and incoming (blocked by) links.",
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
    name: "td_create_task_link",
    description: "Create a dependency link between two tasks (source blocks target)",
    inputSchema: {
      type: "object",
      properties: {
        sourceTaskId: {
          type: "string",
          description: "Source task ID — the blocker (required)",
        },
        targetTaskId: {
          type: "string",
          description: "Target task ID — the blocked task (required)",
        },
        linkType: {
          type: "string",
          // The app's TaskLinkType is 'explicit' | 'mention' | 'blocks'
          // (useDatabase.ts:29). This listed "related", which nothing in the
          // app understands, and omitted the two the app actually writes
          // (useDashboardTaskOperations.ts:620 and :641). Harmless while the
          // enum was only documentation; with the values now enforced it would
          // have refused legitimate links. (TODO-297)
          enum: ["blocks", "explicit", "mention"],
          description: "Link type: 'blocks' for a dependency, 'explicit' for a manual link, 'mention' for one detected in a description (default: 'blocks')",
        },
      },
      required: ["sourceTaskId", "targetTaskId"],
    },
  },
  {
    name: "td_delete_task_link",
    description: "Delete a task dependency link (soft delete)",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Task link ID (required)",
        },
      },
      required: ["id"],
    },
  },
];

export async function handleTaskLinkTool(
  name: string,
  args: Record<string, unknown>,
  evolu: EvoluInstance
): Promise<unknown> {
  switch (name) {
    case "td_list_task_links":
      return listTaskLinks(evolu, args as { taskId: string });
    case "td_create_task_link":
      return createTaskLink(evolu, args as { sourceTaskId: string; targetTaskId: string; linkType?: string });
    case "td_delete_task_link":
      return deleteTaskLink(evolu, args as { id: string });
    default:
      return undefined;
  }
}

async function listTaskLinks(evolu: EvoluInstance, args: { taskId: string }) {
  const query = evolu.createQuery((db: any) =>
    db
      .selectFrom("taskLink")
      .leftJoin("task as sourceTask", "taskLink.sourceTaskId", "sourceTask.id")
      .leftJoin("task as targetTask", "taskLink.targetTaskId", "targetTask.id")
      .select([
        "taskLink.id",
        "taskLink.sourceTaskId",
        "taskLink.targetTaskId",
        "taskLink.linkType",
        "sourceTask.title as sourceTaskCode",
        "sourceTask.name as sourceTaskName",
        "targetTask.title as targetTaskCode",
        "targetTask.name as targetTaskName",
      ])
      .where("taskLink.isDeleted", "is not", SQLITE_TRUE)
      .where((eb: any) =>
        eb.or([
          eb("taskLink.sourceTaskId", "=", args.taskId as TaskId),
          eb("taskLink.targetTaskId", "=", args.taskId as TaskId),
        ])
      )
  );

  const result = await evolu.loadQuery(query);

  const outgoing = result.filter((l: any) => l.sourceTaskId === args.taskId);
  const incoming = result.filter((l: any) => l.targetTaskId === args.taskId);

  return {
    count: result.length,
    outgoing: outgoing.map((l: any) => ({
      id: l.id,
      linkType: l.linkType,
      targetTaskId: l.targetTaskId,
      targetTaskCode: l.targetTaskCode,
      targetTaskName: l.targetTaskName,
    })),
    incoming: incoming.map((l: any) => ({
      id: l.id,
      linkType: l.linkType,
      sourceTaskId: l.sourceTaskId,
      sourceTaskCode: l.sourceTaskCode,
      sourceTaskName: l.sourceTaskName,
    })),
  };
}

async function createTaskLink(
  evolu: EvoluInstance,
  args: { sourceTaskId: string; targetTaskId: string; linkType?: string }
) {
  if (args.sourceTaskId === args.targetTaskId) {
    throw new Error("Cannot link a task to itself");
  }

  const waiter = createMutationWaiter();
  const result = evolu.insert("taskLink", {
    sourceTaskId: args.sourceTaskId as TaskId,
    targetTaskId: args.targetTaskId as TaskId,
    linkType: EvoluString.orThrow(args.linkType || "blocks"),
  }, { onComplete: waiter.onComplete });

  await waiter.waitForSync();

  return {
    success: true,
    linkId: result.id,
    message: `Task link created successfully`,
  };
}

async function deleteTaskLink(evolu: EvoluInstance, args: { id: string }) {
  const waiter = createMutationWaiter();
  assertMutation("deleteTaskLink",
    evolu.update("taskLink", {
      id: args.id as TaskLinkId,
      isDeleted: SQLITE_TRUE,
    } as any, { onComplete: waiter.onComplete })
  );

  await waiter.waitForSync();

  return {
    success: true,
    message: "Task link deleted successfully",
  };
}
