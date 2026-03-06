import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { NonEmptyString1000, Int } from "@evolu/common";
import { SQLITE_TRUE, type TaskId, type ChecklistItemId, type EvoluInstance } from "../evolu.js";
import { createMutationWaiter, getSyncWarning } from "./helpers.js";

export const checklistItemTools: Tool[] = [
  {
    name: "td_list_checklist_items",
    description: "List checklist items for a specific task",
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
    name: "td_create_checklist_item",
    description: "Add a checklist item to a task",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "Task ID (required)",
        },
        title: {
          type: "string",
          description: "Checklist item text (required)",
        },
        isChecked: {
          type: "boolean",
          description: "Whether the item is checked (default: false)",
        },
      },
      required: ["taskId", "title"],
    },
  },
  {
    name: "td_update_checklist_item",
    description: "Update a checklist item (toggle check, rename, reorder)",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Checklist item ID (required)",
        },
        title: {
          type: "string",
          description: "New title",
        },
        isChecked: {
          type: "boolean",
          description: "Check/uncheck the item",
        },
        position: {
          type: "number",
          description: "New position for reordering",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "td_delete_checklist_item",
    description: "Delete a checklist item (soft delete)",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Checklist item ID (required)",
        },
      },
      required: ["id"],
    },
  },
];

export async function handleChecklistItemTool(
  name: string,
  args: Record<string, unknown>,
  evolu: EvoluInstance
): Promise<unknown> {
  switch (name) {
    case "td_list_checklist_items":
      return listChecklistItems(evolu, args as { taskId: string });
    case "td_create_checklist_item":
      return createChecklistItem(evolu, args as { taskId: string; title: string; isChecked?: boolean });
    case "td_update_checklist_item":
      return updateChecklistItem(evolu, args as { id: string; title?: string; isChecked?: boolean; position?: number });
    case "td_delete_checklist_item":
      return deleteChecklistItem(evolu, args as { id: string });
    default:
      return undefined;
  }
}

async function listChecklistItems(evolu: EvoluInstance, args: { taskId: string }) {
  const query = evolu.createQuery((db: any) =>
    db
      .selectFrom("checklistItem")
      .select(["id", "title", "isChecked", "position"])
      .where("taskId", "=", args.taskId as TaskId)
      .where("isDeleted", "is not", SQLITE_TRUE)
      .orderBy("position", "asc")
  );

  const result = await evolu.loadQuery(query);
  const total = result.length;
  const checked = result.filter((i: any) => i.isChecked === SQLITE_TRUE).length;

  return {
    count: total,
    checked,
    unchecked: total - checked,
    items: result.map((i: any) => ({
      id: i.id,
      title: i.title,
      isChecked: i.isChecked === SQLITE_TRUE,
      position: i.position,
    })),
  };
}

async function createChecklistItem(
  evolu: EvoluInstance,
  args: { taskId: string; title: string; isChecked?: boolean }
) {
  // Get max position for this task
  const posQuery = evolu.createQuery((db: any) =>
    db
      .selectFrom("checklistItem")
      .select(["position"])
      .where("taskId", "=", args.taskId as TaskId)
      .where("isDeleted", "is not", SQLITE_TRUE)
      .orderBy("position", "desc")
      .limit(1)
  );
  const posResult = await evolu.loadQuery(posQuery);
  const maxPosition = posResult.length > 0 ? ((posResult[0] as any).position || 0) : 0;

  const waiter = createMutationWaiter();
  const result = evolu.insert("checklistItem", {
    taskId: args.taskId as TaskId,
    title: NonEmptyString1000.orThrow(args.title),
    isChecked: args.isChecked ? SQLITE_TRUE : null,
    position: Int.orThrow(maxPosition + 1),
  }, { onComplete: waiter.onComplete });

  if (!result.ok) {
    throw new Error(`Failed to create checklist item: ${JSON.stringify(result.error)}`);
  }

  await waiter.waitForSync();

  return {
    success: true,
    itemId: result.value.id,
    message: `Checklist item created successfully${getSyncWarning()}`,
  };
}

async function updateChecklistItem(
  evolu: EvoluInstance,
  args: { id: string; title?: string; isChecked?: boolean; position?: number }
) {
  const updates: Record<string, unknown> = {
    id: args.id as ChecklistItemId,
  };

  if (args.title !== undefined) {
    updates.title = NonEmptyString1000.orThrow(args.title);
  }
  if (args.isChecked !== undefined) {
    updates.isChecked = args.isChecked ? SQLITE_TRUE : null;
  }
  if (args.position !== undefined) {
    updates.position = Int.orThrow(args.position);
  }

  const waiter = createMutationWaiter();
  evolu.update("checklistItem", updates as any, { onComplete: waiter.onComplete });

  await waiter.waitForSync();

  return {
    success: true,
    message: `Checklist item updated successfully${getSyncWarning()}`,
  };
}

async function deleteChecklistItem(evolu: EvoluInstance, args: { id: string }) {
  const waiter = createMutationWaiter();
  evolu.update("checklistItem", {
    id: args.id as ChecklistItemId,
    isDeleted: SQLITE_TRUE,
  } as any, { onComplete: waiter.onComplete });

  await waiter.waitForSync();

  return {
    success: true,
    message: "Checklist item deleted successfully",
  };
}
