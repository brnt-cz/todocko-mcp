import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { NonEmptyString100, String as EvoluString, Int } from "@evolu/common";
import { SQLITE_TRUE, type KanbanColumnId, type EvoluInstance } from "../evolu.js";
import { createMutationWaiter, getSyncWarning } from "./helpers.js";

export const kanbanColumnTools: Tool[] = [
  {
    name: "td_list_kanban_columns",
    description: "List kanban board columns with their settings",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "td_create_kanban_column",
    description: "Create a new kanban column",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Unique slug (e.g., 'in_progress') (required)" },
        name: { type: "string", description: "Display name (required)" },
        color: { type: "string", description: "Hex color (default: '#6b7280')" },
        icon: { type: "string", description: "Icon identifier (default: 'circle')" },
        isDefault: { type: "boolean", description: "Is this the default column for new tasks" },
        showInKanban: { type: "boolean", description: "Show in kanban board (default: true)" },
      },
      required: ["slug", "name"],
    },
  },
  {
    name: "td_update_kanban_column",
    description: "Update a kanban column",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Column ID (required)" },
        name: { type: "string" },
        color: { type: "string" },
        icon: { type: "string" },
        position: { type: "number" },
        isDefault: { type: "boolean" },
        showInKanban: { type: "boolean" },
      },
      required: ["id"],
    },
  },
  {
    name: "td_delete_kanban_column",
    description: "Delete a kanban column (soft delete)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Column ID (required)" },
      },
      required: ["id"],
    },
  },
];

export async function handleKanbanColumnTool(
  name: string,
  args: Record<string, unknown>,
  evolu: EvoluInstance
): Promise<unknown> {
  switch (name) {
    case "td_list_kanban_columns":
      return listKanbanColumns(evolu);
    case "td_create_kanban_column":
      return createKanbanColumn(evolu, args as { slug: string; name: string; color?: string; icon?: string; isDefault?: boolean; showInKanban?: boolean });
    case "td_update_kanban_column":
      return updateKanbanColumn(evolu, args as { id: string; name?: string; color?: string; icon?: string; position?: number; isDefault?: boolean; showInKanban?: boolean });
    case "td_delete_kanban_column":
      return deleteKanbanColumn(evolu, args as { id: string });
    default:
      return undefined;
  }
}

async function listKanbanColumns(evolu: EvoluInstance) {
  const query = evolu.createQuery((db: any) =>
    db.selectFrom("kanbanColumn")
      .select(["id", "slug", "name", "color", "icon", "position", "isDefault", "showInKanban"])
      .where("isDeleted", "is not", SQLITE_TRUE)
      .orderBy("position", "asc")
  );
  const result = await evolu.loadQuery(query);
  return {
    count: result.length,
    columns: result.map((c: any) => ({
      id: c.id, slug: c.slug, name: c.name, color: c.color, icon: c.icon,
      position: c.position, isDefault: c.isDefault === SQLITE_TRUE, showInKanban: c.showInKanban === SQLITE_TRUE,
    })),
  };
}

async function createKanbanColumn(
  evolu: EvoluInstance,
  args: { slug: string; name: string; color?: string; icon?: string; isDefault?: boolean; showInKanban?: boolean }
) {
  const posQuery = evolu.createQuery((db: any) =>
    db.selectFrom("kanbanColumn").select(["position"]).where("isDeleted", "is not", SQLITE_TRUE).orderBy("position", "desc").limit(1)
  );
  const posResult = await evolu.loadQuery(posQuery);
  const maxPos = posResult.length > 0 ? ((posResult[0] as any).position || 0) : 0;

  const waiter = createMutationWaiter();
  const result = evolu.insert("kanbanColumn", {
    slug: NonEmptyString100.orThrow(args.slug),
    name: NonEmptyString100.orThrow(args.name),
    color: EvoluString.orThrow(args.color || "#6b7280"),
    icon: EvoluString.orThrow(args.icon || "circle"),
    position: Int.orThrow(maxPos + 1),
    isDefault: args.isDefault ? SQLITE_TRUE : null,
    showInKanban: args.showInKanban !== false ? SQLITE_TRUE : null,
  }, { onComplete: waiter.onComplete });

  if (!result.ok) throw new Error(`Failed to create column: ${JSON.stringify(result.error)}`);
  await waiter.waitForSync();

  return { success: true, columnId: result.value.id, message: `Column "${args.name}" created${getSyncWarning()}` };
}

async function updateKanbanColumn(
  evolu: EvoluInstance,
  args: { id: string; name?: string; color?: string; icon?: string; position?: number; isDefault?: boolean; showInKanban?: boolean }
) {
  const updates: Record<string, unknown> = { id: args.id as KanbanColumnId };
  if (args.name !== undefined) updates.name = NonEmptyString100.orThrow(args.name);
  if (args.color !== undefined) updates.color = EvoluString.orThrow(args.color);
  if (args.icon !== undefined) updates.icon = EvoluString.orThrow(args.icon);
  if (args.position !== undefined) updates.position = Int.orThrow(args.position);
  if (args.isDefault !== undefined) updates.isDefault = args.isDefault ? SQLITE_TRUE : null;
  if (args.showInKanban !== undefined) updates.showInKanban = args.showInKanban ? SQLITE_TRUE : null;

  const waiter = createMutationWaiter();
  evolu.update("kanbanColumn", updates as any, { onComplete: waiter.onComplete });
  await waiter.waitForSync();

  return { success: true, message: `Column updated${getSyncWarning()}` };
}

async function deleteKanbanColumn(evolu: EvoluInstance, args: { id: string }) {
  const waiter = createMutationWaiter();
  evolu.update("kanbanColumn", { id: args.id as KanbanColumnId, isDeleted: SQLITE_TRUE } as any, { onComplete: waiter.onComplete });
  await waiter.waitForSync();
  return { success: true, message: "Column deleted" };
}
