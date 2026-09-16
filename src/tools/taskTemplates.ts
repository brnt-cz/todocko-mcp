import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { NonEmptyTrimmedString100, String as EvoluString, Int } from "@evolu/common";
import { SQLITE_TRUE, type ProjectId, type TaskTemplateId, type EvoluInstance } from "../evolu.js";
import { createMutationWaiter , assertMutation, assertRowExists } from "./helpers.js";

export const taskTemplateTools: Tool[] = [
  {
    name: "td_list_task_templates",
    description: "List all task templates",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Filter by project ID",
        },
      },
    },
  },
  {
    name: "td_create_task_template",
    description: "Create a task template for quick task creation",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Template name (required)",
        },
        taskName: {
          type: "string",
          description: "Default task name when using template",
        },
        description: {
          type: "string",
          description: "Default task description (HTML)",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high", "urgent"],
          description: "Default priority (default: 'medium')",
        },
        estimate: {
          type: "number",
          description: "Default estimate in minutes",
        },
        projectId: {
          type: "string",
          description: "Default project ID",
        },
        checklistItems: {
          type: "array",
          items: { type: "string" },
          description: "Checklist item titles created on every task made from this template (TODO-329)",
        },
        tagIds: {
          type: "array",
          items: { type: "string" },
          description: "Tag IDs applied to tasks made from this template; tags of another project are skipped by the app (TODO-329)",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "td_update_task_template",
    description: "Update a task template",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Template ID (required)",
        },
        name: { type: "string" },
        taskName: { type: "string" },
        description: { type: "string" },
        priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
        estimate: { type: "number" },
        projectId: { type: "string" },
        checklistItems: { type: "array", items: { type: "string" }, description: "Replaces the checklist; empty array clears it" },
        tagIds: { type: "array", items: { type: "string" }, description: "Replaces the tag set; empty array clears it" },
      },
      required: ["id"],
    },
  },
  {
    name: "td_delete_task_template",
    description: "Delete a task template (soft delete)",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Template ID (required)",
        },
      },
      required: ["id"],
    },
  },
];

export async function handleTaskTemplateTool(
  name: string,
  args: Record<string, unknown>,
  evolu: EvoluInstance
): Promise<unknown> {
  switch (name) {
    case "td_list_task_templates":
      return listTaskTemplates(evolu, args as { projectId?: string });
    case "td_create_task_template":
      return createTaskTemplate(evolu, args as {
        name: string; taskName?: string; description?: string;
        priority?: string; estimate?: number; projectId?: string;
      });
    case "td_update_task_template":
      return updateTaskTemplate(evolu, args as {
        id: string; name?: string; taskName?: string; description?: string;
        priority?: string; estimate?: number; projectId?: string;
      });
    case "td_delete_task_template":
      return deleteTaskTemplate(evolu, args as { id: string });
    default:
      return undefined;
  }
}

/** JSON text column to string list; malformed values degrade to an empty list. (TODO-329) */
export function parseTemplateList(json: unknown): string[] {
  if (typeof json !== "string" || json.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
  } catch {
    return [];
  }
}

/** String list to JSON text column; rejects non-string entries, empty list becomes null. (TODO-329) */
export function serializeTemplateList(items: unknown, field: string): string | null {
  if (items === null || items === undefined) return null;
  if (!Array.isArray(items) || items.some((x) => typeof x !== "string")) {
    throw new Error(`${field} must be an array of strings`);
  }
  const cleaned = items.map((x: string) => x.trim()).filter((x) => x.length > 0);
  return cleaned.length > 0 ? JSON.stringify(cleaned) : null;
}

async function listTaskTemplates(evolu: EvoluInstance, args: { projectId?: string }) {
  const query = evolu.createQuery((db: any) => {
    let q = db
      .selectFrom("taskTemplate")
      .select(["id", "name", "taskName", "description", "priority", "estimate", "projectId", "position", "checklistItems", "tagIds"])
      .where("isDeleted", "is not", SQLITE_TRUE)
      .orderBy("position", "asc");
    if (args.projectId) {
      q = q.where("projectId", "=", args.projectId as ProjectId);
    }
    return q;
  });

  const result = await evolu.loadQuery(query);
  return {
    count: result.length,
    templates: result.map((t: any) => ({
      id: t.id, name: t.name, taskName: t.taskName, description: t.description,
      priority: t.priority, estimate: t.estimate, projectId: t.projectId, position: t.position,
      checklistItems: parseTemplateList(t.checklistItems), tagIds: parseTemplateList(t.tagIds),
    })),
  };
}

async function createTaskTemplate(
  evolu: EvoluInstance,
  args: { name: string; taskName?: string; description?: string; priority?: string; estimate?: number; projectId?: string; checklistItems?: string[]; tagIds?: string[] }
) {
  const posQuery = evolu.createQuery((db: any) =>
    db.selectFrom("taskTemplate").select(["position"]).where("isDeleted", "is not", SQLITE_TRUE).orderBy("position", "desc").limit(1)
  );
  const posResult = await evolu.loadQuery(posQuery);
  const maxPos = posResult.length > 0 ? ((posResult[0] as any).position || 0) : 0;

  const waiter = createMutationWaiter();
  const result = evolu.insert("taskTemplate", {
    name: NonEmptyTrimmedString100.orThrow(args.name),
    taskName: args.taskName ? NonEmptyTrimmedString100.orThrow(args.taskName) : null,
    description: args.description ? EvoluString.orThrow(args.description) : null,
    priority: EvoluString.orThrow(args.priority || "medium"),
    estimate: args.estimate ? Int.orThrow(args.estimate) : null,
    projectId: args.projectId ? (args.projectId as ProjectId) : null,
    position: Int.orThrow(maxPos + 1),
    checklistItems: serializeTemplateList(args.checklistItems, "checklistItems"),
    tagIds: serializeTemplateList(args.tagIds, "tagIds"),
  }, { onComplete: waiter.onComplete });

  await waiter.waitForSync();

  return { success: true, templateId: result.id, message: `Template "${args.name}" created` };
}

async function updateTaskTemplate(
  evolu: EvoluInstance,
  args: { id: string; name?: string; taskName?: string; description?: string; priority?: string; estimate?: number; projectId?: string; checklistItems?: string[]; tagIds?: string[] }
) {
  // An id nobody has is not an error for Evolu, it is an insert. (TODO-292)
  await assertRowExists(evolu, "taskTemplate", args.id, "Task template");

  const updates: Record<string, unknown> = { id: args.id as TaskTemplateId };
  if (args.name !== undefined) updates.name = NonEmptyTrimmedString100.orThrow(args.name);
  if (args.taskName !== undefined) updates.taskName = args.taskName ? NonEmptyTrimmedString100.orThrow(args.taskName) : null;
  if (args.description !== undefined) updates.description = args.description ? EvoluString.orThrow(args.description) : null;
  if (args.priority !== undefined) updates.priority = EvoluString.orThrow(args.priority);
  if (args.estimate !== undefined) updates.estimate = args.estimate ? Int.orThrow(args.estimate) : null;
  if (args.projectId !== undefined) updates.projectId = args.projectId ? (args.projectId as ProjectId) : null;
  if (args.checklistItems !== undefined) updates.checklistItems = serializeTemplateList(args.checklistItems, "checklistItems");
  if (args.tagIds !== undefined) updates.tagIds = serializeTemplateList(args.tagIds, "tagIds");

  const waiter = createMutationWaiter();
  assertMutation("updateTaskTemplate", evolu.update("taskTemplate", updates as any, { onComplete: waiter.onComplete }));
  await waiter.waitForSync();

  return { success: true, message: `Template updated` };
}

async function deleteTaskTemplate(evolu: EvoluInstance, args: { id: string }) {
  const waiter = createMutationWaiter();
  assertMutation("deleteTaskTemplate", evolu.update("taskTemplate", { id: args.id as TaskTemplateId, isDeleted: SQLITE_TRUE } as any, { onComplete: waiter.onComplete }));
  await waiter.waitForSync();
  return { success: true, message: "Template deleted" };
}
