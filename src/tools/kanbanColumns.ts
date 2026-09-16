import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { NonEmptyTrimmedString100, String as EvoluString, Int } from "@evolu/common";
import { SQLITE_TRUE, type KanbanColumnId, type EvoluInstance } from "../evolu.js";
import { createMutationWaiter , assertMutation, assertRowExists } from "./helpers.js";

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
        wipLimit: { type: "number", description: "WIP limit: max tasks in the column before the board header warns (positive integer, omit for no limit)" },
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
        wipLimit: { type: ["number", "null"], description: "WIP limit (positive integer); null removes the limit" },
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
      return createKanbanColumn(evolu, args as { slug: string; name: string; color?: string; icon?: string; isDefault?: boolean; showInKanban?: boolean; wipLimit?: number | null });
    case "td_update_kanban_column":
      return updateKanbanColumn(evolu, args as { id: string; name?: string; color?: string; icon?: string; position?: number; isDefault?: boolean; showInKanban?: boolean; wipLimit?: number | null });
    case "td_delete_kanban_column":
      return deleteKanbanColumn(evolu, args as { id: string });
    default:
      return undefined;
  }
}

async function listKanbanColumns(evolu: EvoluInstance) {
  const query = evolu.createQuery((db: any) =>
    db.selectFrom("kanbanColumn")
      .select(["id", "slug", "name", "color", "icon", "position", "isDefault", "showInKanban", "wipLimit"])
      .where("isDeleted", "is not", SQLITE_TRUE)
      .orderBy("position", "asc")
  );
  const result = await evolu.loadQuery(query);
  return {
    count: result.length,
    columns: result.map((c: any) => ({
      id: c.id, slug: c.slug, name: c.name, color: c.color, icon: c.icon,
      position: c.position, isDefault: c.isDefault === SQLITE_TRUE, showInKanban: c.showInKanban === SQLITE_TRUE,
      wipLimit: typeof c.wipLimit === "number" && c.wipLimit > 0 ? c.wipLimit : null,
    })),
  };
}

/** A WIP limit is a positive integer; null or anything else means "no limit". (TODO-338) */
export function parseWipLimit(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`wipLimit must be a positive integer or null, got ${JSON.stringify(value)}`);
  }
  if (value <= 0) return null;
  return Int.orThrow(value);
}

async function createKanbanColumn(
  evolu: EvoluInstance,
  args: { slug: string; name: string; color?: string; icon?: string; isDefault?: boolean; showInKanban?: boolean; wipLimit?: number | null }
) {
  const posQuery = evolu.createQuery((db: any) =>
    db.selectFrom("kanbanColumn").select(["position"]).where("isDeleted", "is not", SQLITE_TRUE).orderBy("position", "desc").limit(1)
  );
  const posResult = await evolu.loadQuery(posQuery);
  const maxPos = posResult.length > 0 ? ((posResult[0] as any).position || 0) : 0;

  const waiter = createMutationWaiter();
  const result = evolu.insert("kanbanColumn", {
    slug: NonEmptyTrimmedString100.orThrow(args.slug),
    name: NonEmptyTrimmedString100.orThrow(args.name),
    color: EvoluString.orThrow(args.color || "#6b7280"),
    icon: EvoluString.orThrow(args.icon || "circle"),
    position: Int.orThrow(maxPos + 1),
    isDefault: args.isDefault ? SQLITE_TRUE : null,
    showInKanban: args.showInKanban !== false ? SQLITE_TRUE : null,
    wipLimit: parseWipLimit(args.wipLimit),
  }, { onComplete: waiter.onComplete });

  await waiter.waitForSync();

  return { success: true, columnId: result.id, message: `Column "${args.name}" created` };
}

async function updateKanbanColumn(
  evolu: EvoluInstance,
  args: { id: string; name?: string; color?: string; icon?: string; position?: number; isDefault?: boolean; showInKanban?: boolean; wipLimit?: number | null }
) {
  // An id nobody has is not an error for Evolu, it is an insert. (TODO-292)
  await assertRowExists(evolu, "kanbanColumn", args.id, "Column");

  const updates: Record<string, unknown> = { id: args.id as KanbanColumnId };
  if (args.name !== undefined) updates.name = NonEmptyTrimmedString100.orThrow(args.name);
  if (args.color !== undefined) updates.color = EvoluString.orThrow(args.color);
  if (args.icon !== undefined) updates.icon = EvoluString.orThrow(args.icon);
  if (args.position !== undefined) updates.position = Int.orThrow(args.position);
  if (args.isDefault !== undefined) updates.isDefault = args.isDefault ? SQLITE_TRUE : null;
  if (args.showInKanban !== undefined) updates.showInKanban = args.showInKanban ? SQLITE_TRUE : null;
  if (args.wipLimit !== undefined) updates.wipLimit = parseWipLimit(args.wipLimit);

  const waiter = createMutationWaiter();
  assertMutation("updateKanbanColumn", evolu.update("kanbanColumn", updates as any, { onComplete: waiter.onComplete }));
  await waiter.waitForSync();

  return { success: true, message: `Column updated` };
}

async function deleteKanbanColumn(evolu: EvoluInstance, args: { id: string }) {
  const waiter = createMutationWaiter();
  assertMutation("deleteKanbanColumn", evolu.update("kanbanColumn", { id: args.id as KanbanColumnId, isDeleted: SQLITE_TRUE } as any, { onComplete: waiter.onComplete }));
  await waiter.waitForSync();
  return { success: true, message: "Column deleted" };
}
