import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { NonEmptyTrimmedString100, String as EvoluString, Int } from "@evolu/common";
import { SQLITE_TRUE, type SavedViewId, type EvoluInstance } from "../evolu.js";
import { createMutationWaiter, getSyncWarning , assertMutation} from "./helpers.js";

export const savedViewTools: Tool[] = [
  {
    name: "td_list_saved_views",
    description: "List all saved views (custom filters/sort presets)",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "td_create_saved_view",
    description: "Create a saved view with filter/sort configuration",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "View name (required)" },
        icon: { type: "string", description: "Icon identifier" },
        filters: { type: "string", description: "JSON string of filter configuration (required)" },
      },
      required: ["name", "filters"],
    },
  },
  {
    name: "td_update_saved_view",
    description: "Update a saved view",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "View ID (required)" },
        name: { type: "string" },
        icon: { type: "string" },
        filters: { type: "string", description: "JSON string of filter configuration" },
        position: { type: "number" },
      },
      required: ["id"],
    },
  },
  {
    name: "td_delete_saved_view",
    description: "Delete a saved view (soft delete)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "View ID (required)" },
      },
      required: ["id"],
    },
  },
];

export async function handleSavedViewTool(
  name: string,
  args: Record<string, unknown>,
  evolu: EvoluInstance
): Promise<unknown> {
  switch (name) {
    case "td_list_saved_views":
      return listSavedViews(evolu);
    case "td_create_saved_view":
      return createSavedView(evolu, args as { name: string; icon?: string; filters: string });
    case "td_update_saved_view":
      return updateSavedView(evolu, args as { id: string; name?: string; icon?: string; filters?: string; position?: number });
    case "td_delete_saved_view":
      return deleteSavedView(evolu, args as { id: string });
    default:
      return undefined;
  }
}

async function listSavedViews(evolu: EvoluInstance) {
  const query = evolu.createQuery((db: any) =>
    db.selectFrom("savedView")
      .select(["id", "name", "icon", "filters", "isBuiltIn", "position"])
      .where("isDeleted", "is not", SQLITE_TRUE)
      .orderBy("position", "asc")
  );
  const result = await evolu.loadQuery(query);
  return {
    count: result.length,
    views: result.map((v: any) => ({
      id: v.id, name: v.name, icon: v.icon, filters: v.filters,
      isBuiltIn: v.isBuiltIn === SQLITE_TRUE, position: v.position,
    })),
  };
}

async function createSavedView(
  evolu: EvoluInstance,
  args: { name: string; icon?: string; filters: string }
) {
  const posQuery = evolu.createQuery((db: any) =>
    db.selectFrom("savedView").select(["position"]).where("isDeleted", "is not", SQLITE_TRUE).orderBy("position", "desc").limit(1)
  );
  const posResult = await evolu.loadQuery(posQuery);
  const maxPos = posResult.length > 0 ? ((posResult[0] as any).position || 0) : 0;

  const waiter = createMutationWaiter();
  const result = evolu.insert("savedView", {
    name: NonEmptyTrimmedString100.orThrow(args.name),
    icon: args.icon ? EvoluString.orThrow(args.icon) : null,
    filters: EvoluString.orThrow(args.filters),
    isBuiltIn: null,
    position: Int.orThrow(maxPos + 1),
  }, { onComplete: waiter.onComplete });

  if (!result.ok) throw new Error(`Failed to create view: ${JSON.stringify(result.error)}`);
  await waiter.waitForSync();

  return { success: true, viewId: result.value.id, message: `View "${args.name}" created${getSyncWarning()}` };
}

async function updateSavedView(
  evolu: EvoluInstance,
  args: { id: string; name?: string; icon?: string; filters?: string; position?: number }
) {
  const updates: Record<string, unknown> = { id: args.id as SavedViewId };
  if (args.name !== undefined) updates.name = NonEmptyTrimmedString100.orThrow(args.name);
  if (args.icon !== undefined) updates.icon = args.icon ? EvoluString.orThrow(args.icon) : null;
  if (args.filters !== undefined) updates.filters = EvoluString.orThrow(args.filters);
  if (args.position !== undefined) updates.position = Int.orThrow(args.position);

  const waiter = createMutationWaiter();
  assertMutation("updateSavedView", evolu.update("savedView", updates as any, { onComplete: waiter.onComplete }));
  await waiter.waitForSync();

  return { success: true, message: `View updated${getSyncWarning()}` };
}

async function deleteSavedView(evolu: EvoluInstance, args: { id: string }) {
  const waiter = createMutationWaiter();
  assertMutation("deleteSavedView", evolu.update("savedView", { id: args.id as SavedViewId, isDeleted: SQLITE_TRUE } as any, { onComplete: waiter.onComplete }));
  await waiter.waitForSync();
  return { success: true, message: "View deleted" };
}
