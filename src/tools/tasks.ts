import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { NonEmptyString100, NonEmptyString1000, Int } from "@evolu/common";
import { SQLITE_TRUE, type TaskId, type ProjectId, type UserId, type DeploymentStageId, type EvoluInstance, getSyncHealth } from "../evolu.js";
import { createMutationWaiter, waitForSync, getSyncWarning, safeLoadQuery, assertMaxLength } from "./helpers.js";
import { logTaskCreate, logTaskDelete, logTaskUpdate, TRACKED_TASK_FIELDS } from "../utils/activityLog.js";

export const taskTools: Tool[] = [
  {
    name: "td_list_tasks",
    description: "List tasks with optional filters. Returns task id, title (code), name, status, priority, deadline, scheduledDate, and project info.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Filter by project ID",
        },
        projectCode: {
          type: "string",
          description: "Filter by project code (e.g., 'TODO')",
        },
        status: {
          type: "string",
          enum: ["backlog", "todo", "in_progress", "review", "done"],
          description: "Filter by status",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high", "urgent"],
          description: "Filter by priority",
        },
        assigneeId: {
          type: "string",
          description: "Filter by assignee user ID",
        },
        limit: {
          type: "number",
          description: "Maximum number of tasks to return (default: 50)",
        },
      },
    },
  },
  {
    name: "td_get_task",
    description: "Get a specific task by ID or code (e.g., 'PROJ-123')",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Task ID",
        },
        code: {
          type: "string",
          description: "Task code (e.g., 'PROJ-123')",
        },
      },
    },
  },
  {
    name: "td_create_task",
    description: "Create a new task in Todocko",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Project ID (required)",
        },
        name: {
          type: "string",
          description: "Human-readable task name/summary",
        },
        description: {
          type: "string",
          description: "Task description (HTML supported)",
        },
        status: {
          type: "string",
          enum: ["backlog", "todo", "in_progress", "review", "done"],
          description: "Task status (default: 'todo')",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high", "urgent"],
          description: "Task priority (default: 'medium')",
        },
        deadline: {
          type: "string",
          description: "Deadline in ISO format (e.g., '2024-12-31')",
        },
        scheduledDate: {
          type: "string",
          description: "Scheduled date for when to work on the task (YYYY-MM-DD)",
        },
        assigneeId: {
          type: "string",
          description: "User ID to assign the task to",
        },
        estimate: {
          type: "number",
          description: "Time estimate in minutes",
        },
        recurrenceType: {
          type: "string",
          enum: ["none", "daily", "weekly", "monthly", "yearly", "custom"],
          description: "Recurrence type (default: 'none')",
        },
        recurrenceInterval: {
          type: "number",
          description: "Recurrence interval (e.g., every 2 weeks)",
        },
        recurrenceEndDate: {
          type: "string",
          description: "Recurrence end date (ISO format)",
        },
        recurrenceDay: {
          type: "string",
          description: "Recurrence day: for weekly=1-7 (Mon-Sun ISO), for monthly=1-31 (day of month) or 0 (last day), or null to clear",
        },
        sprintNumber: {
          type: "number",
          description: "Sprint number for the task",
        },
        parentTaskId: {
          type: "string",
          description: "Parent task ID to create this as a sub-task",
        },
        code: {
          type: "string",
          description: "Override auto-generated task code (e.g., 'TODO-134'). Use only to restore deleted tasks.",
        },
        completedAt: {
          type: "string",
          description: "ISO timestamp for when the task was completed (only meaningful when status='done').",
        },
        isOnProduction: {
          type: "boolean",
          description: "Set production badge.",
        },
      },
      required: ["projectId"],
    },
  },
  {
    name: "td_update_task",
    description: "Update an existing task",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Task ID (required)",
        },
        name: {
          type: "string",
          description: "Human-readable task name/summary",
        },
        description: {
          type: "string",
          description: "Task description",
        },
        status: {
          type: "string",
          enum: ["backlog", "todo", "in_progress", "review", "done"],
          description: "Task status",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high", "urgent"],
          description: "Task priority",
        },
        deadline: {
          type: "string",
          description: "Deadline in ISO format, or null to clear",
        },
        scheduledDate: {
          type: "string",
          description: "Scheduled date for when to work on the task (YYYY-MM-DD), or null to clear",
        },
        assigneeId: {
          type: "string",
          description: "User ID to assign, or null to unassign",
        },
        isBlocked: {
          type: "boolean",
          description: "Set blocked status",
        },
        blockedReason: {
          type: "string",
          description: "Reason for being blocked",
        },
        estimate: {
          type: "number",
          description: "Time estimate in minutes",
        },
        isOnProduction: {
          type: "boolean",
          description: "Set production badge (simple flag when no custom deployment stages)",
        },
        deploymentStageId: {
          type: "string",
          description: "Deployment stage ID, or null to clear",
        },
        recurrenceType: {
          type: "string",
          enum: ["none", "daily", "weekly", "monthly", "yearly", "custom"],
          description: "Recurrence type",
        },
        recurrenceInterval: {
          type: "number",
          description: "Recurrence interval",
        },
        recurrenceEndDate: {
          type: "string",
          description: "Recurrence end date (ISO format), or null to clear",
        },
        recurrenceDay: {
          type: "string",
          description: "Recurrence day: for weekly=1-7 (Mon-Sun ISO), for monthly=1-31 (day of month) or 0 (last day), or null to clear",
        },
        sprintNumber: {
          type: "number",
          description: "Sprint number for the task, or null to clear",
        },
        parentTaskId: {
          type: "string",
          description: "Parent task ID, or null to detach from parent",
        },
        isDeleted: {
          type: "boolean",
          description: "Soft-delete flag. Pass false to restore a previously deleted task.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "td_search_tasks",
    description: "Search tasks by code, name, or description",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (required)",
        },
        limit: {
          type: "number",
          description: "Maximum results (default: 20)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "td_bulk_update_tasks",
    description: "Bulk update multiple tasks at once. Updates status, priority, assignee, or deployment stage for multiple task IDs.",
    inputSchema: {
      type: "object",
      properties: {
        taskIds: {
          type: "array",
          items: { type: "string" },
          description: "Array of task IDs to update (required)",
        },
        status: {
          type: "string",
          enum: ["backlog", "todo", "in_progress", "review", "done"],
          description: "New status for all tasks",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high", "urgent"],
          description: "New priority for all tasks",
        },
        assigneeId: {
          type: "string",
          description: "User ID to assign, or null to unassign",
        },
        deploymentStageId: {
          type: "string",
          description: "Deployment stage ID, or null to clear",
        },
        sprintNumber: {
          type: "number",
          description: "Sprint number for the tasks, or null to clear",
        },
      },
      required: ["taskIds"],
    },
  },
  {
    name: "td_bulk_delete_tasks",
    description: "Bulk delete multiple tasks at once. Marks tasks as deleted (soft delete).",
    inputSchema: {
      type: "object",
      properties: {
        taskIds: {
          type: "array",
          items: { type: "string" },
          description: "Array of task IDs to delete (required)",
        },
      },
      required: ["taskIds"],
    },
  },
  {
    name: "td_delete_task",
    description: "Soft-delete a single personal task (cascades to its worklogs and attachments). For shared-project tasks use td_delete_shared_task.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task ID (required)" },
      },
      required: ["id"],
    },
  },
];

export async function handleTaskTool(
  name: string,
  args: Record<string, unknown>,
  evolu: EvoluInstance
): Promise<unknown> {
  switch (name) {
    case "td_list_tasks":
      return listTasks(evolu, args as {
        projectId?: string;
        projectCode?: string;
        status?: string;
        priority?: string;
        assigneeId?: string;
        limit?: number;
      });
    case "td_get_task":
      return getTask(evolu, args as { id?: string; code?: string });
    case "td_create_task":
      return createTask(evolu, args as {
        projectId: string;
        name?: string;
        description?: string;
        status?: string;
        priority?: string;
        deadline?: string;
        scheduledDate?: string;
        assigneeId?: string;
        estimate?: number;
        recurrenceType?: string;
        recurrenceInterval?: number;
        recurrenceEndDate?: string;
        recurrenceDay?: string;
        sprintNumber?: number;
        parentTaskId?: string;
        code?: string;
        completedAt?: string;
        isOnProduction?: boolean;
      });
    case "td_update_task":
      return updateTask(evolu, args as {
        id: string;
        name?: string;
        description?: string;
        status?: string;
        priority?: string;
        deadline?: string | null;
        scheduledDate?: string | null;
        assigneeId?: string | null;
        isBlocked?: boolean;
        blockedReason?: string;
        estimate?: number;
        isOnProduction?: boolean;
        deploymentStageId?: string | null;
        recurrenceType?: string;
        recurrenceInterval?: number;
        recurrenceEndDate?: string | null;
        recurrenceDay?: string | null;
        sprintNumber?: number | null;
        parentTaskId?: string | null;
        isDeleted?: boolean;
      });
    case "td_search_tasks":
      return searchTasks(evolu, args as { query: string; limit?: number });
    case "td_bulk_update_tasks":
      return bulkUpdateTasks(evolu, args as {
        taskIds: string[];
        status?: string;
        priority?: string;
        assigneeId?: string | null;
        deploymentStageId?: string | null;
        sprintNumber?: number | null;
      });
    case "td_bulk_delete_tasks":
      return bulkDeleteTasks(evolu, args as { taskIds: string[] });
    case "td_delete_task":
      return deleteTask(evolu, args as { id: string });
    default:
      return undefined;
  }
}

// Helper functions to load related data without LEFT JOINs
// Evolu's loadQuery hangs indefinitely with LEFT JOIN queries in Node.js

async function loadProjectsMap(evolu: EvoluInstance, ids: Set<string>): Promise<Map<string, any>> {
  if (ids.size === 0) return new Map();
  const query = evolu.createQuery((db: any) =>
    db.selectFrom("project").select(["id", "name", "code", "color"]).where("isDeleted", "is not", SQLITE_TRUE)
  );
  const rows = await safeLoadQuery(evolu,query);
  const map = new Map<string, any>();
  for (const r of rows as any[]) {
    if (ids.has(r.id)) map.set(r.id, r);
  }
  return map;
}

async function loadUsersMap(evolu: EvoluInstance, ids: Set<string>): Promise<Map<string, any>> {
  if (ids.size === 0) return new Map();
  const query = evolu.createQuery((db: any) =>
    db.selectFrom("user").select(["id", "name"]).where("isDeleted", "is not", SQLITE_TRUE)
  );
  const rows = await safeLoadQuery(evolu,query);
  const map = new Map<string, any>();
  for (const r of rows as any[]) {
    if (ids.has(r.id)) map.set(r.id, r);
  }
  return map;
}

async function loadDeploymentStagesMap(evolu: EvoluInstance, ids: Set<string>): Promise<Map<string, any>> {
  if (ids.size === 0) return new Map();
  const query = evolu.createQuery((db: any) =>
    db.selectFrom("deploymentStage").select(["id", "name", "color"]).where("isDeleted", "is not", SQLITE_TRUE)
  );
  const rows = await safeLoadQuery(evolu,query);
  const map = new Map<string, any>();
  for (const r of rows as any[]) {
    if (ids.has(r.id)) map.set(r.id, r);
  }
  return map;
}

async function listTasks(
  evolu: EvoluInstance,
  args: {
    projectId?: string;
    projectCode?: string;
    status?: string;
    priority?: string;
    assigneeId?: string;
    limit?: number;
  }
) {
  // If filtering by project code, first get the project ID
  let projectIdToFilter = args.projectId as ProjectId | undefined;
  if (args.projectCode && !projectIdToFilter) {
    const projectQuery = evolu.createQuery((db: any) =>
      db
        .selectFrom("project")
        .select(["id"])
        .where("code", "=", args.projectCode as unknown as typeof NonEmptyString100.Type)
        .where("isDeleted", "is not", SQLITE_TRUE)
        .limit(1)
    );
    const projectResult = await safeLoadQuery(evolu,projectQuery);
    if (projectResult.length > 0) {
      projectIdToFilter = (projectResult[0] as any).id;
    }
  }

  // Query tasks without LEFT JOINs (Evolu loadQuery hangs with joins)
  const query = evolu.createQuery((db: any) => {
    let q = db
      .selectFrom("task")
      .select([
        "id",
        "title",
        "name",
        "status",
        "priority",
        "deadline",
        "scheduledDate",
        "isBlocked",
        "estimate",
        "completedAt",
        "position",
        "isOnProduction",
        "deploymentStageId",
        "sprintNumber",
        "parentTaskId",
        "projectId",
        "assigneeId",
      ])
      .where("isDeleted", "is not", SQLITE_TRUE);

    if (projectIdToFilter) {
      q = q.where("projectId", "=", projectIdToFilter);
    }
    if (args.status) {
      q = q.where("status", "=", args.status);
    }
    if (args.priority) {
      q = q.where("priority", "=", args.priority);
    }
    if (args.assigneeId) {
      q = q.where("assigneeId", "=", args.assigneeId as UserId);
    }

    return q.orderBy("position", "asc").limit(args.limit || 50);
  });

  const result = await safeLoadQuery(evolu,query);

  // Collect unique IDs for enrichment
  const projectIds = new Set<string>();
  const userIds = new Set<string>();
  const stageIds = new Set<string>();
  for (const t of result as any[]) {
    if (t.projectId) projectIds.add(t.projectId);
    if (t.assigneeId) userIds.add(t.assigneeId);
    if (t.deploymentStageId) stageIds.add(t.deploymentStageId);
  }

  // Load related data in parallel (separate queries, no joins)
  const [projectsMap, usersMap, stagesMap] = await Promise.all([
    loadProjectsMap(evolu, projectIds),
    loadUsersMap(evolu, userIds),
    loadDeploymentStagesMap(evolu, stageIds),
  ]);

  return {
    count: result.length,
    tasks: result.map((t: any) => {
      const project = projectsMap.get(t.projectId);
      const assignee = usersMap.get(t.assigneeId);
      const stage = stagesMap.get(t.deploymentStageId);
      return {
        id: t.id,
        code: t.title,
        name: t.name,
        status: t.status,
        priority: t.priority,
        deadline: t.deadline,
        scheduledDate: t.scheduledDate,
        isBlocked: t.isBlocked === SQLITE_TRUE,
        estimate: t.estimate,
        completedAt: t.completedAt,
        isOnProduction: t.isOnProduction === SQLITE_TRUE,
        sprintNumber: t.sprintNumber ?? null,
        parentTaskId: t.parentTaskId ?? null,
        deploymentStage: stage
          ? { id: t.deploymentStageId, name: stage.name, color: stage.color }
          : null,
        project: project
          ? { id: t.projectId, name: project.name, code: project.code, color: project.color }
          : null,
        assignee: assignee
          ? { id: t.assigneeId, name: assignee.name }
          : null,
      };
    }),
  };
}

async function getTask(
  evolu: EvoluInstance,
  args: { id?: string; code?: string }
) {
  if (!args.id && !args.code) {
    throw new Error("Either id or code is required");
  }

  // Query task without LEFT JOINs (Evolu loadQuery hangs with joins)
  const query = evolu.createQuery((db: any) => {
    let q = db
      .selectFrom("task")
      .select([
        "id",
        "title",
        "name",
        "description",
        "status",
        "priority",
        "deadline",
        "scheduledDate",
        "isBlocked",
        "blockedReason",
        "estimate",
        "completedAt",
        "position",
        "isOnProduction",
        "deploymentStageId",
        "sprintNumber",
        "parentTaskId",
        "projectId",
        "assigneeId",
      ])
      .where("isDeleted", "is not", SQLITE_TRUE);

    if (args.id) {
      q = q.where("id", "=", args.id as TaskId);
    } else if (args.code) {
      q = q.where("title", "=", args.code as unknown as typeof NonEmptyString100.Type);
    }

    return q.limit(1);
  });

  const result = await safeLoadQuery(evolu,query);
  if (result.length === 0) {
    return { error: "Task not found" };
  }

  const t = result[0] as any;

  // Load related data and worklogs in parallel (no joins)
  const [projectsMap, usersMap, stagesMap, worklogs] = await Promise.all([
    t.projectId ? loadProjectsMap(evolu, new Set([t.projectId])) : Promise.resolve(new Map()),
    t.assigneeId ? loadUsersMap(evolu, new Set([t.assigneeId])) : Promise.resolve(new Map()),
    t.deploymentStageId ? loadDeploymentStagesMap(evolu, new Set([t.deploymentStageId])) : Promise.resolve(new Map()),
    evolu.loadQuery(evolu.createQuery((db: any) =>
      db
        .selectFrom("worklog")
        .select(["durationMinutes"])
        .where("taskId", "=", t.id)
        .where("isDeleted", "is not", SQLITE_TRUE)
    )),
  ]);

  const totalLoggedMinutes = worklogs.reduce((sum: number, w: any) => sum + (w.durationMinutes || 0), 0);
  const project = projectsMap.get(t.projectId);
  const assignee = usersMap.get(t.assigneeId);
  const stage = stagesMap.get(t.deploymentStageId);

  return {
    id: t.id,
    code: t.title,
    name: t.name,
    description: t.description,
    status: t.status,
    priority: t.priority,
    deadline: t.deadline,
    scheduledDate: t.scheduledDate,
    isBlocked: t.isBlocked === SQLITE_TRUE,
    blockedReason: t.blockedReason,
    estimate: t.estimate,
    totalLoggedMinutes,
    completedAt: t.completedAt,
    isOnProduction: t.isOnProduction === SQLITE_TRUE,
    sprintNumber: t.sprintNumber ?? null,
    parentTaskId: t.parentTaskId ?? null,
    deploymentStage: stage
      ? { id: t.deploymentStageId, name: stage.name, color: stage.color }
      : null,
    project: project
      ? { id: t.projectId, name: project.name, code: project.code, color: project.color }
      : null,
    assignee: assignee
      ? { id: t.assigneeId, name: assignee.name }
      : null,
  };
}

async function createTask(
  evolu: EvoluInstance,
  args: {
    projectId: string;
    name?: string;
    description?: string;
    status?: string;
    priority?: string;
    deadline?: string;
    scheduledDate?: string;
    assigneeId?: string;
    estimate?: number;
    recurrenceType?: string;
    recurrenceInterval?: number;
    recurrenceEndDate?: string;
    recurrenceDay?: string;
    sprintNumber?: number;
    parentTaskId?: string;
    code?: string;
    completedAt?: string;
    isOnProduction?: boolean;
  }
) {
  // Validate field lengths up-front for clear errors (Evolu caps these).
  assertMaxLength(args.name, 100, "name");
  assertMaxLength(args.description, 1000, "description");

  // Get project to generate task code
  const projectQuery = evolu.createQuery((db: any) =>
    db
      .selectFrom("project")
      .select(["id", "code"])
      .where("id", "=", args.projectId as ProjectId)
      .where("isDeleted", "is not", SQLITE_TRUE)
      .limit(1)
  );
  const projectResult = await safeLoadQuery(evolu,projectQuery);
  if (projectResult.length === 0) {
    throw new Error("Project not found");
  }
  const project = projectResult[0] as any;

  // Get next task number for this project
  const tasksQuery = evolu.createQuery((db: any) =>
    db
      .selectFrom("task")
      .select(["title"])
      .where("projectId", "=", project.id)
  );
  const existingTasks = await safeLoadQuery(evolu,tasksQuery);

  const projectCode = project.code || "TASK";
  let taskCode: string;
  if (args.code) {
    // Validate format and uniqueness
    const codeRegex = new RegExp(`^${projectCode}-\\d+$`);
    if (!codeRegex.test(args.code)) {
      throw new Error(`Code "${args.code}" does not match project format "${projectCode}-NNN"`);
    }
    const conflict = existingTasks.some((t: any) => t.title === args.code);
    if (conflict) {
      throw new Error(`Code "${args.code}" is already used by another task`);
    }
    taskCode = args.code;
  } else {
    let maxNum = 0;
    const codeRegex = new RegExp(`^${projectCode}-(\\d+)$`);
    for (const t of existingTasks) {
      const match = (t as any).title?.match(codeRegex);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }
    taskCode = `${projectCode}-${maxNum + 1}`;
  }

  // Get max position
  const posQuery = evolu.createQuery((db: any) =>
    db.selectFrom("task").select(["position"]).orderBy("position", "desc").limit(1)
  );
  const posResult = await safeLoadQuery(evolu,posQuery);
  const maxPosition = posResult.length > 0 ? ((posResult[0] as any).position || 0) : 0;

  // Create task with onComplete tracking
  const waiter = createMutationWaiter();
  const result = evolu.insert("task", {
    projectId: args.projectId as ProjectId,
    title: NonEmptyString100.orThrow(taskCode),
    name: args.name ? NonEmptyString100.orThrow(args.name) : null,
    description: args.description ? NonEmptyString1000.orThrow(args.description) : null,
    status: args.status || "todo",
    priority: args.priority || "medium",
    deadline: args.deadline || null,
    scheduledDate: args.scheduledDate || null,
    assigneeId: args.assigneeId ? (args.assigneeId as UserId) : null,
    estimate: args.estimate ? Int.orThrow(args.estimate) : null,
    position: Int.orThrow(maxPosition + 1),
    completedAt: args.completedAt || null,
    isOnProduction: args.isOnProduction ? SQLITE_TRUE : null,
    isBlocked: null,
    blockedReason: null,
    recurrenceType: args.recurrenceType || null,
    recurrenceInterval: args.recurrenceInterval ? Int.orThrow(args.recurrenceInterval) : null,
    recurrenceEndDate: args.recurrenceEndDate || null,
    recurrenceDay: args.recurrenceDay || null,
    sprintNumber: args.sprintNumber ? Int.orThrow(args.sprintNumber) : null,
    ...(args.parentTaskId ? { parentTaskId: args.parentTaskId as TaskId } : {}),
  } as any, { onComplete: waiter.onComplete });

  if (!result.ok) {
    throw new Error(`Failed to create task: ${JSON.stringify(result.error)}`);
  }

  // Touch the task with update to set updatedAt (Evolu only sets it on update, not insert)
  evolu.update("task", { id: result.value.id, status: args.status || "todo" } as any);

  logTaskCreate(evolu, result.value.id);

  // Wait for onComplete + network sync
  await waiter.waitForSync();

  const syncWarning = getSyncWarning();

  return {
    success: true,
    taskId: result.value.id,
    taskCode,
    message: `Task ${taskCode} created successfully${syncWarning}`,
  };
}

async function updateTask(
  evolu: EvoluInstance,
  args: {
    id: string;
    name?: string;
    description?: string;
    status?: string;
    priority?: string;
    deadline?: string | null;
    scheduledDate?: string | null;
    assigneeId?: string | null;
    isBlocked?: boolean;
    blockedReason?: string;
    estimate?: number;
    isOnProduction?: boolean;
    deploymentStageId?: string | null;
    recurrenceType?: string;
    recurrenceInterval?: number;
    recurrenceEndDate?: string | null;
    recurrenceDay?: string | null;
    sprintNumber?: number | null;
    parentTaskId?: string | null;
    isDeleted?: boolean;
  }
) {
  // Validate field lengths up-front for clear errors (Evolu caps these).
  assertMaxLength(args.name, 100, "name");
  assertMaxLength(args.description, 1000, "description");
  assertMaxLength(args.blockedReason, 1000, "blockedReason");

  const updates: Record<string, unknown> = {
    id: args.id as TaskId,
  };

  if (args.isDeleted !== undefined) {
    // Restore (false) must write 0, not null: the task.isDeleted column is a
    // non-nullable SqliteBoolean (0|1), so Evolu's update validator rejects
    // null. Read queries filter `isDeleted is not 1`, so 0 == visible again.
    updates.isDeleted = (args.isDeleted ? SQLITE_TRUE : (0 as unknown as typeof SQLITE_TRUE));
  }

  if (args.name !== undefined) {
    updates.name = args.name ? NonEmptyString100.orThrow(args.name) : null;
  }
  if (args.description !== undefined) {
    updates.description = args.description ? NonEmptyString1000.orThrow(args.description) : null;
  }
  if (args.status !== undefined) {
    updates.status = args.status;
    if (args.status === "done") {
      updates.completedAt = new Date().toISOString();
    } else {
      updates.completedAt = null;
    }
  }
  if (args.priority !== undefined) {
    updates.priority = args.priority;
  }
  if (args.deadline !== undefined) {
    updates.deadline = args.deadline;
  }
  if (args.scheduledDate !== undefined) {
    updates.scheduledDate = args.scheduledDate;
  }
  if (args.assigneeId !== undefined) {
    updates.assigneeId = args.assigneeId ? (args.assigneeId as UserId) : null;
  }
  if (args.isBlocked !== undefined) {
    updates.isBlocked = args.isBlocked ? SQLITE_TRUE : null;
  }
  if (args.blockedReason !== undefined) {
    updates.blockedReason = args.blockedReason ? NonEmptyString1000.orThrow(args.blockedReason) : null;
  }
  if (args.estimate !== undefined) {
    updates.estimate = args.estimate ? Int.orThrow(args.estimate) : null;
  }
  if (args.isOnProduction !== undefined) {
    updates.isOnProduction = args.isOnProduction ? SQLITE_TRUE : null;
  }
  if (args.deploymentStageId !== undefined) {
    updates.deploymentStageId = args.deploymentStageId ? (args.deploymentStageId as DeploymentStageId) : null;
  }
  if (args.recurrenceType !== undefined) {
    updates.recurrenceType = args.recurrenceType || null;
  }
  if (args.recurrenceInterval !== undefined) {
    updates.recurrenceInterval = args.recurrenceInterval ? Int.orThrow(args.recurrenceInterval) : null;
  }
  if (args.recurrenceEndDate !== undefined) {
    updates.recurrenceEndDate = args.recurrenceEndDate || null;
  }
  if (args.recurrenceDay !== undefined) {
    updates.recurrenceDay = args.recurrenceDay || null;
  }
  if (args.sprintNumber !== undefined) {
    updates.sprintNumber = args.sprintNumber ? Int.orThrow(args.sprintNumber) : null;
  }
  if (args.parentTaskId !== undefined) {
    updates.parentTaskId = args.parentTaskId ? (args.parentTaskId as TaskId) : null;
  }

  // Load existing task to diff for activity log (best-effort — never fail update on this)
  let oldTask: Record<string, unknown> = {};
  try {
    const oldQuery = evolu.createQuery((db: any) =>
      db.selectFrom("task")
        .select([...TRACKED_TASK_FIELDS])
        .where("id", "=", args.id as TaskId)
        .limit(1)
    );
    const rows = await safeLoadQuery(evolu, oldQuery);
    if (rows && rows.length > 0) oldTask = rows[0] as Record<string, unknown>;
  } catch {
    // ignore — activity log just won't have diff
  }

  const waiter = createMutationWaiter();
  const updateResult = evolu.update("task", updates as any, { onComplete: waiter.onComplete });
  if (!updateResult.ok) {
    throw new Error(`Failed to update task: ${JSON.stringify(updateResult.error)}`);
  }

  logTaskUpdate(evolu, args.id, oldTask, updates);

  await waiter.waitForSync();

  const syncWarning = getSyncWarning();

  return {
    success: true,
    message: `Task updated successfully${syncWarning}`,
  };
}

async function searchTasks(
  evolu: EvoluInstance,
  args: { query: string; limit?: number }
) {
  const searchQuery = args.query.toLowerCase();
  const limit = args.limit || 20;

  // Query tasks without LEFT JOINs (Evolu loadQuery hangs with joins)
  const query = evolu.createQuery((db: any) =>
    db
      .selectFrom("task")
      .select([
        "id",
        "title",
        "name",
        "description",
        "status",
        "priority",
        "projectId",
      ])
      .where("isDeleted", "is not", SQLITE_TRUE)
  );

  const allTasks = await safeLoadQuery(evolu,query);

  const filtered = allTasks.filter((t: any) => {
    const title = (t.title || "").toLowerCase();
    const name = (t.name || "").toLowerCase();
    const description = (t.description || "").toLowerCase();
    return (
      title.includes(searchQuery) ||
      name.includes(searchQuery) ||
      description.includes(searchQuery)
    );
  });

  const limited = filtered.slice(0, limit);

  // Enrich with project data
  const projectIds = new Set<string>();
  for (const t of limited as any[]) {
    if (t.projectId) projectIds.add(t.projectId);
  }
  const projectsMap = await loadProjectsMap(evolu, projectIds);

  return {
    count: limited.length,
    totalMatches: filtered.length,
    tasks: limited.map((t: any) => {
      const project = projectsMap.get(t.projectId);
      return {
        id: t.id,
        code: t.title,
        name: t.name,
        status: t.status,
        priority: t.priority,
        project: project
          ? { id: t.projectId, name: project.name, code: project.code, color: project.color }
          : null,
      };
    }),
  };
}

async function bulkUpdateTasks(
  evolu: EvoluInstance,
  args: {
    taskIds: string[];
    status?: string;
    priority?: string;
    assigneeId?: string | null;
    deploymentStageId?: string | null;
    sprintNumber?: number | null;
  }
) {
  if (!args.taskIds || args.taskIds.length === 0) {
    throw new Error("taskIds array is required and must not be empty");
  }

  let successCount = 0;
  let skippedCount = 0;

  for (const taskId of args.taskIds) {
    try {
      const updates: Record<string, unknown> = {
        id: taskId as TaskId,
      };

      if (args.status !== undefined) {
        updates.status = args.status;
        if (args.status === "done") {
          updates.completedAt = new Date().toISOString();
        } else {
          updates.completedAt = null;
        }
      }
      if (args.priority !== undefined) {
        updates.priority = args.priority;
      }
      if (args.assigneeId !== undefined) {
        updates.assigneeId = args.assigneeId ? (args.assigneeId as UserId) : null;
      }
      if (args.deploymentStageId !== undefined) {
        updates.deploymentStageId = args.deploymentStageId ? (args.deploymentStageId as DeploymentStageId) : null;
      }
      if (args.sprintNumber !== undefined) {
        updates.sprintNumber = args.sprintNumber ? Int.orThrow(args.sprintNumber) : null;
      }

      let oldTask: Record<string, unknown> = {};
      try {
        const oldQuery = evolu.createQuery((db: any) =>
          db.selectFrom("task")
            .select([...TRACKED_TASK_FIELDS])
            .where("id", "=", taskId as TaskId)
            .limit(1)
        );
        const rows = await safeLoadQuery(evolu, oldQuery);
        if (rows && rows.length > 0) oldTask = rows[0] as Record<string, unknown>;
      } catch {
        // ignore — no old-state diff is fine
      }

      // TODO-90 M11: check the Result — update() doesn't throw, so without this
      // a failed mutation would still be counted as a success.
      const r = evolu.update("task", updates as any);
      if (!r.ok) throw new Error(`update failed: ${JSON.stringify(r.error)}`);
      logTaskUpdate(evolu, taskId, oldTask, updates);
      successCount++;
    } catch {
      skippedCount++;
    }
  }

  await waitForSync();

  return {
    success: true,
    successCount,
    skippedCount,
    message: `Bulk update complete: ${successCount} updated, ${skippedCount} skipped`,
  };
}

async function bulkDeleteTasks(
  evolu: EvoluInstance,
  args: { taskIds: string[] }
) {
  if (!args.taskIds || args.taskIds.length === 0) {
    throw new Error("taskIds array is required and must not be empty");
  }

  let successCount = 0;
  let skippedCount = 0;

  for (const taskId of args.taskIds) {
    try {
      // Delete worklogs for this task
      const worklogsQuery = evolu.createQuery((db: any) =>
        db
          .selectFrom("worklog")
          .select(["id"])
          .where("taskId", "=", taskId as TaskId)
          .where("isDeleted", "is not", SQLITE_TRUE)
      );
      const worklogs = await safeLoadQuery(evolu,worklogsQuery);
      for (const w of worklogs) {
        evolu.update("worklog", { id: (w as any).id, isDeleted: SQLITE_TRUE } as any);
      }

      // Delete attachments for this task
      const attachmentsQuery = evolu.createQuery((db: any) =>
        db
          .selectFrom("attachment")
          .select(["id"])
          .where("taskId", "=", taskId as TaskId)
          .where("isDeleted", "is not", SQLITE_TRUE)
      );
      const attachments = await safeLoadQuery(evolu,attachmentsQuery);
      for (const a of attachments) {
        evolu.update("attachment", { id: (a as any).id, data: null, isDeleted: SQLITE_TRUE } as any);
      }

      // Delete the task itself. TODO-90 M11: check the Result so a failed
      // delete is reported as skipped, not silently counted as success.
      const r = evolu.update("task", { id: taskId as TaskId, isDeleted: SQLITE_TRUE } as any);
      if (!r.ok) throw new Error(`delete failed: ${JSON.stringify(r.error)}`);
      logTaskDelete(evolu, taskId);
      successCount++;
    } catch {
      skippedCount++;
    }
  }

  await waitForSync();

  return {
    success: true,
    successCount,
    skippedCount,
    message: `Bulk delete complete: ${successCount} deleted, ${skippedCount} skipped`,
  };
}

async function deleteTask(evolu: EvoluInstance, args: { id: string }) {
  if (!args.id) {
    throw new Error("id is required");
  }

  // Verify the task exists (and grab its code for the message).
  const taskQuery = evolu.createQuery((db: any) =>
    db
      .selectFrom("task")
      .select(["id", "title"])
      .where("id", "=", args.id as TaskId)
      .where("isDeleted", "is not", SQLITE_TRUE)
      .limit(1)
  );
  const found = await safeLoadQuery(evolu, taskQuery);
  if (found.length === 0) {
    throw new Error("Task not found");
  }
  const code = (found[0] as any).title as string;

  // Cascade soft-delete worklogs + attachments (matches td_bulk_delete_tasks).
  const worklogs = await safeLoadQuery(
    evolu,
    evolu.createQuery((db: any) =>
      db.selectFrom("worklog").select(["id"]).where("taskId", "=", args.id as TaskId).where("isDeleted", "is not", SQLITE_TRUE)
    )
  );
  for (const w of worklogs) {
    evolu.update("worklog", { id: (w as any).id, isDeleted: SQLITE_TRUE } as any);
  }
  const attachments = await safeLoadQuery(
    evolu,
    evolu.createQuery((db: any) =>
      db.selectFrom("attachment").select(["id"]).where("taskId", "=", args.id as TaskId).where("isDeleted", "is not", SQLITE_TRUE)
    )
  );
  for (const a of attachments) {
    evolu.update("attachment", { id: (a as any).id, data: null, isDeleted: SQLITE_TRUE } as any);
  }

  const waiter = createMutationWaiter();
  const result = evolu.update("task", { id: args.id as TaskId, isDeleted: SQLITE_TRUE } as any, { onComplete: waiter.onComplete });
  if (!result.ok) {
    throw new Error(`Failed to delete task: ${JSON.stringify(result.error)}`);
  }
  logTaskDelete(evolu, args.id);

  await waiter.waitForSync();

  return {
    success: true,
    message: `Task ${code} deleted successfully${getSyncWarning()}`,
  };
}
