import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { NonEmptyString100, NonEmptyString1000, Int } from "@evolu/common";
import { Schema, SQLITE_TRUE, type TaskId, type ProjectId, type UserId, type DeploymentStageId, type EvoluInstance, getProjectEvolu, getSharedOwner, useSharedOwner, stopUsingSharedOwner } from "../evolu.js";

// Wait for Evolu to sync changes to relay servers
// Evolu doesn't have a public API to wait for sync, so we use a delay
const SYNC_DELAY_MS = 3000;

async function waitForSync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, SYNC_DELAY_MS));
}

// Tool definitions
export const tools: Tool[] = [
  {
    name: "td_list_projects",
    description: "List all projects in Todocko. Returns project id, name, code, color, and status.",
    inputSchema: {
      type: "object",
      properties: {
        includeArchived: {
          type: "boolean",
          description: "Include archived projects (default: false)",
        },
      },
    },
  },
  {
    name: "td_get_project",
    description: "Get a specific project by ID or code",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Project ID",
        },
        code: {
          type: "string",
          description: "Project code (e.g., 'TODO', 'PROJ')",
        },
      },
    },
  },
  {
    name: "td_list_tasks",
    description: "List tasks with optional filters. Returns task id, title (code), name, status, priority, deadline, and project info.",
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
        assigneeId: {
          type: "string",
          description: "User ID to assign the task to",
        },
        estimate: {
          type: "number",
          description: "Time estimate in minutes",
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
      },
      required: ["id"],
    },
  },
  {
    name: "td_list_deployment_stages",
    description: "List deployment stages for a project. Returns stage id, name, color, and position.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Project ID to get stages for (optional - returns all if not specified)",
        },
      },
    },
  },
  {
    name: "td_list_users",
    description: "List all users in Todocko",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "td_get_user",
    description: "Get a specific user by ID",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "User ID",
        },
      },
      required: ["id"],
    },
  },
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
  // Shared projects tools
  {
    name: "td_list_shared_projects",
    description: "List all shared projects the user has access to. Returns project references with owner info.",
    inputSchema: {
      type: "object",
      properties: {
        includeArchived: {
          type: "boolean",
          description: "Include archived projects (default: false)",
        },
      },
    },
  },
  {
    name: "td_list_shared_tasks",
    description: "List tasks from a shared project. Requires sharedOwnerId from td_list_shared_projects.",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: {
          type: "string",
          description: "SharedOwner ID from projectRef (required)",
        },
        ownerSecret: {
          type: "string",
          description: "Owner secret from projectRef (required)",
        },
        status: {
          type: "string",
          enum: ["backlog", "todo", "in_progress", "review", "done"],
          description: "Filter by status",
        },
        limit: {
          type: "number",
          description: "Maximum number of tasks to return (default: 50)",
        },
      },
      required: ["sharedOwnerId", "ownerSecret"],
    },
  },
  {
    name: "td_list_shared_deployment_stages",
    description: "List deployment stages for a shared project",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: {
          type: "string",
          description: "SharedOwner ID from projectRef (required)",
        },
        ownerSecret: {
          type: "string",
          description: "Owner secret from projectRef (required)",
        },
      },
      required: ["sharedOwnerId", "ownerSecret"],
    },
  },
  {
    name: "td_update_shared_task",
    description: "Update a task in a shared project",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: {
          type: "string",
          description: "SharedOwner ID from projectRef (required)",
        },
        ownerSecret: {
          type: "string",
          description: "Owner secret from projectRef (required)",
        },
        id: {
          type: "string",
          description: "Task ID (required)",
        },
        name: {
          type: "string",
          description: "Human-readable task name/summary",
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
        isOnProduction: {
          type: "boolean",
          description: "Set production badge",
        },
        deploymentStageId: {
          type: "string",
          description: "Deployment stage ID, or null to clear",
        },
      },
      required: ["sharedOwnerId", "ownerSecret", "id"],
    },
  },
  {
    name: "td_create_shared_deployment_stage",
    description: "Create a deployment stage in a shared project",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: {
          type: "string",
          description: "SharedOwner ID from projectRef (required)",
        },
        ownerSecret: {
          type: "string",
          description: "Owner secret from projectRef (required)",
        },
        projectId: {
          type: "string",
          description: "Project ID within the shared owner (required)",
        },
        name: {
          type: "string",
          description: "Stage name (e.g., 'Test', 'Stage', 'Prod') (required)",
        },
        color: {
          type: "string",
          description: "Hex color for badge (e.g., '#22c55e')",
        },
        position: {
          type: "number",
          description: "Order position (default: 0)",
        },
      },
      required: ["sharedOwnerId", "ownerSecret", "projectId", "name"],
    },
  },
];

// Tool handler
export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  evolu: EvoluInstance
): Promise<unknown> {
  switch (name) {
    case "td_list_projects":
      return listProjects(evolu, args as { includeArchived?: boolean });

    case "td_get_project":
      return getProject(evolu, args as { id?: string; code?: string });

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
        assigneeId?: string;
        estimate?: number;
      });

    case "td_update_task":
      return updateTask(evolu, args as {
        id: string;
        name?: string;
        description?: string;
        status?: string;
        priority?: string;
        deadline?: string | null;
        assigneeId?: string | null;
        isBlocked?: boolean;
        blockedReason?: string;
        estimate?: number;
        isOnProduction?: boolean;
        deploymentStageId?: string | null;
      });

    case "td_list_deployment_stages":
      return listDeploymentStages(evolu, args as { projectId?: string });

    case "td_list_users":
      return listUsers(evolu);

    case "td_get_user":
      return getUser(evolu, args as { id: string });

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

    case "td_search_tasks":
      return searchTasks(evolu, args as { query: string; limit?: number });

    case "td_list_shared_projects":
      return listSharedProjects(evolu, args as { includeArchived?: boolean });

    case "td_list_shared_tasks":
      return listSharedTasks(args as {
        sharedOwnerId: string;
        ownerSecret: string;
        status?: string;
        limit?: number;
      });

    case "td_list_shared_deployment_stages":
      return listSharedDeploymentStages(args as {
        sharedOwnerId: string;
        ownerSecret: string;
      });

    case "td_update_shared_task":
      return updateSharedTask(args as {
        sharedOwnerId: string;
        ownerSecret: string;
        id: string;
        name?: string;
        status?: string;
        priority?: string;
        isOnProduction?: boolean;
        deploymentStageId?: string | null;
      });

    case "td_create_shared_deployment_stage":
      return createSharedDeploymentStage(args as {
        sharedOwnerId: string;
        ownerSecret: string;
        projectId: string;
        name: string;
        color?: string;
        position?: number;
      });

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Implementation functions

async function listProjects(
  evolu: EvoluInstance,
  args: { includeArchived?: boolean }
) {
  const query = evolu.createQuery((db) => {
    let q = db
      .selectFrom("project")
      .select(["id", "name", "code", "color", "isArchived", "isHiddenFromFilters", "position"])
      .where("isDeleted", "is not", SQLITE_TRUE)
      .orderBy("position", "asc");

    if (!args.includeArchived) {
      q = q.where("isArchived", "is not", SQLITE_TRUE);
    }

    return q;
  });

  const result = await evolu.loadQuery(query);
  return {
    count: result.length,
    projects: result.map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      color: p.color,
      isArchived: p.isArchived === SQLITE_TRUE,
      isHiddenFromFilters: p.isHiddenFromFilters === SQLITE_TRUE,
    })),
  };
}

async function getProject(
  evolu: EvoluInstance,
  args: { id?: string; code?: string }
) {
  if (!args.id && !args.code) {
    throw new Error("Either id or code is required");
  }

  const query = evolu.createQuery((db) => {
    let q = db
      .selectFrom("project")
      .select(["id", "name", "code", "color", "isArchived", "isHiddenFromFilters", "position"])
      .where("isDeleted", "is not", SQLITE_TRUE);

    if (args.id) {
      q = q.where("id", "=", args.id as ProjectId);
    } else if (args.code) {
      q = q.where("code", "=", args.code as unknown as typeof NonEmptyString100.Type);
    }

    return q.limit(1);
  });

  const result = await evolu.loadQuery(query);
  if (result.length === 0) {
    return { error: "Project not found" };
  }

  const p = result[0];
  return {
    id: p.id,
    name: p.name,
    code: p.code,
    color: p.color,
    isArchived: p.isArchived === SQLITE_TRUE,
    isHiddenFromFilters: p.isHiddenFromFilters === SQLITE_TRUE,
  };
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
    const projectQuery = evolu.createQuery((db) =>
      db
        .selectFrom("project")
        .select(["id"])
        .where("code", "=", args.projectCode as unknown as typeof NonEmptyString100.Type)
        .where("isDeleted", "is not", SQLITE_TRUE)
        .limit(1)
    );
    const projectResult = await evolu.loadQuery(projectQuery);
    if (projectResult.length > 0) {
      projectIdToFilter = projectResult[0].id;
    }
  }

  const query = evolu.createQuery((db) => {
    let q = db
      .selectFrom("task")
      .leftJoin("project", "task.projectId", "project.id")
      .leftJoin("user", "task.assigneeId", "user.id")
      .leftJoin("deploymentStage", "task.deploymentStageId", "deploymentStage.id")
      .select([
        "task.id",
        "task.title",
        "task.name",
        "task.status",
        "task.priority",
        "task.deadline",
        "task.isBlocked",
        "task.estimate",
        "task.completedAt",
        "task.position",
        "task.isOnProduction",
        "task.deploymentStageId",
        "project.id as projectId",
        "project.name as projectName",
        "project.code as projectCode",
        "project.color as projectColor",
        "user.id as assigneeId",
        "user.name as assigneeName",
        "deploymentStage.name as deploymentStageName",
        "deploymentStage.color as deploymentStageColor",
      ])
      .where("task.isDeleted", "is not", SQLITE_TRUE);

    if (projectIdToFilter) {
      q = q.where("task.projectId", "=", projectIdToFilter);
    }
    if (args.status) {
      q = q.where("task.status", "=", args.status);
    }
    if (args.priority) {
      q = q.where("task.priority", "=", args.priority);
    }
    if (args.assigneeId) {
      q = q.where("task.assigneeId", "=", args.assigneeId as UserId);
    }

    return q.orderBy("task.position", "asc").limit(args.limit || 50);
  });

  const result = await evolu.loadQuery(query);
  return {
    count: result.length,
    tasks: result.map((t) => ({
      id: t.id,
      code: t.title,
      name: t.name,
      status: t.status,
      priority: t.priority,
      deadline: t.deadline,
      isBlocked: t.isBlocked === SQLITE_TRUE,
      estimate: t.estimate,
      completedAt: t.completedAt,
      isOnProduction: t.isOnProduction === SQLITE_TRUE,
      deploymentStage: t.deploymentStageId
        ? {
            id: t.deploymentStageId,
            name: t.deploymentStageName,
            color: t.deploymentStageColor,
          }
        : null,
      project: t.projectId
        ? {
            id: t.projectId,
            name: t.projectName,
            code: t.projectCode,
            color: t.projectColor,
          }
        : null,
      assignee: t.assigneeId
        ? {
            id: t.assigneeId,
            name: t.assigneeName,
          }
        : null,
    })),
  };
}

async function getTask(
  evolu: EvoluInstance,
  args: { id?: string; code?: string }
) {
  if (!args.id && !args.code) {
    throw new Error("Either id or code is required");
  }

  const query = evolu.createQuery((db) => {
    let q = db
      .selectFrom("task")
      .leftJoin("project", "task.projectId", "project.id")
      .leftJoin("user", "task.assigneeId", "user.id")
      .leftJoin("deploymentStage", "task.deploymentStageId", "deploymentStage.id")
      .select([
        "task.id",
        "task.title",
        "task.name",
        "task.description",
        "task.status",
        "task.priority",
        "task.deadline",
        "task.isBlocked",
        "task.blockedReason",
        "task.estimate",
        "task.completedAt",
        "task.position",
        "task.isOnProduction",
        "task.deploymentStageId",
        "project.id as projectId",
        "project.name as projectName",
        "project.code as projectCode",
        "project.color as projectColor",
        "user.id as assigneeId",
        "user.name as assigneeName",
        "deploymentStage.name as deploymentStageName",
        "deploymentStage.color as deploymentStageColor",
      ])
      .where("task.isDeleted", "is not", SQLITE_TRUE);

    if (args.id) {
      q = q.where("task.id", "=", args.id as TaskId);
    } else if (args.code) {
      q = q.where("task.title", "=", args.code as unknown as typeof NonEmptyString100.Type);
    }

    return q.limit(1);
  });

  const result = await evolu.loadQuery(query);
  if (result.length === 0) {
    return { error: "Task not found" };
  }

  const t = result[0];

  // Get worklogs for total logged time
  const worklogsQuery = evolu.createQuery((db) =>
    db
      .selectFrom("worklog")
      .select(["durationMinutes"])
      .where("taskId", "=", t.id)
      .where("isDeleted", "is not", SQLITE_TRUE)
  );
  const worklogs = await evolu.loadQuery(worklogsQuery);
  const totalLoggedMinutes = worklogs.reduce((sum, w) => sum + (w.durationMinutes || 0), 0);

  return {
    id: t.id,
    code: t.title,
    name: t.name,
    description: t.description,
    status: t.status,
    priority: t.priority,
    deadline: t.deadline,
    isBlocked: t.isBlocked === SQLITE_TRUE,
    blockedReason: t.blockedReason,
    estimate: t.estimate,
    totalLoggedMinutes,
    completedAt: t.completedAt,
    isOnProduction: t.isOnProduction === SQLITE_TRUE,
    deploymentStage: t.deploymentStageId
      ? {
          id: t.deploymentStageId,
          name: t.deploymentStageName,
          color: t.deploymentStageColor,
        }
      : null,
    project: t.projectId
      ? {
          id: t.projectId,
          name: t.projectName,
          code: t.projectCode,
          color: t.projectColor,
        }
      : null,
    assignee: t.assigneeId
      ? {
          id: t.assigneeId,
          name: t.assigneeName,
        }
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
    assigneeId?: string;
    estimate?: number;
  }
) {
  // Get project to generate task code
  const projectQuery = evolu.createQuery((db) =>
    db
      .selectFrom("project")
      .select(["id", "code"])
      .where("id", "=", args.projectId as ProjectId)
      .where("isDeleted", "is not", SQLITE_TRUE)
      .limit(1)
  );
  const projectResult = await evolu.loadQuery(projectQuery);
  if (projectResult.length === 0) {
    throw new Error("Project not found");
  }
  const project = projectResult[0];

  // Get next task number for this project
  const tasksQuery = evolu.createQuery((db) =>
    db
      .selectFrom("task")
      .select(["title"])
      .where("projectId", "=", project.id)
  );
  const existingTasks = await evolu.loadQuery(tasksQuery);

  const projectCode = project.code || "TASK";
  let maxNum = 0;
  const codeRegex = new RegExp(`^${projectCode}-(\\d+)$`);
  for (const t of existingTasks) {
    const match = t.title?.match(codeRegex);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }
  const taskCode = `${projectCode}-${maxNum + 1}`;

  // Get max position
  const posQuery = evolu.createQuery((db) =>
    db.selectFrom("task").select(["position"]).orderBy("position", "desc").limit(1)
  );
  const posResult = await evolu.loadQuery(posQuery);
  const maxPosition = posResult.length > 0 ? (posResult[0].position || 0) : 0;

  // Create task
  const result = evolu.insert("task", {
    projectId: args.projectId as ProjectId,
    title: NonEmptyString100.orThrow(taskCode),
    name: args.name ? NonEmptyString100.orThrow(args.name) : null,
    description: args.description ? NonEmptyString1000.orThrow(args.description) : null,
    status: args.status || "todo",
    priority: args.priority || "medium",
    deadline: args.deadline || null,
    assigneeId: args.assigneeId ? (args.assigneeId as UserId) : null,
    estimate: args.estimate ? Int.orThrow(args.estimate) : null,
    position: Int.orThrow(maxPosition + 1),
    completedAt: null,
    isBlocked: null,
    blockedReason: null,
  });

  if (!result.ok) {
    throw new Error(`Failed to create task: ${JSON.stringify(result.error)}`);
  }

  // Wait for sync to relay servers
  await waitForSync();

  return {
    success: true,
    taskId: result.value.id,
    taskCode,
    message: `Task ${taskCode} created successfully`,
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
    assigneeId?: string | null;
    isBlocked?: boolean;
    blockedReason?: string;
    estimate?: number;
    isOnProduction?: boolean;
    deploymentStageId?: string | null;
  }
) {
  const updates: Record<string, unknown> = {
    id: args.id as TaskId,
  };

  if (args.name !== undefined) {
    updates.name = args.name ? NonEmptyString100.orThrow(args.name) : null;
  }
  if (args.description !== undefined) {
    updates.description = args.description ? NonEmptyString1000.orThrow(args.description) : null;
  }
  if (args.status !== undefined) {
    updates.status = args.status;
    // Set completedAt when status changes to done
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

  evolu.update("task", updates as any);

  // Wait for sync to relay servers
  await waitForSync();

  return {
    success: true,
    message: "Task updated successfully",
  };
}

async function listUsers(evolu: EvoluInstance) {
  const query = evolu.createQuery((db) =>
    db
      .selectFrom("user")
      .select(["id", "name", "email", "color", "role", "avatarUrl"])
      .where("isDeleted", "is not", SQLITE_TRUE)
  );

  const result = await evolu.loadQuery(query);
  return {
    count: result.length,
    users: result.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      color: u.color,
      role: u.role,
      avatarUrl: u.avatarUrl,
    })),
  };
}

async function getUser(evolu: EvoluInstance, args: { id: string }) {
  const query = evolu.createQuery((db) =>
    db
      .selectFrom("user")
      .select(["id", "name", "email", "color", "role", "avatarUrl", "theme"])
      .where("id", "=", args.id as UserId)
      .where("isDeleted", "is not", SQLITE_TRUE)
      .limit(1)
  );

  const result = await evolu.loadQuery(query);
  if (result.length === 0) {
    return { error: "User not found" };
  }

  const u = result[0];
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    color: u.color,
    role: u.role,
    avatarUrl: u.avatarUrl,
    theme: u.theme,
  };
}

async function listDeploymentStages(
  evolu: EvoluInstance,
  args: { projectId?: string }
) {
  const query = evolu.createQuery((db) => {
    let q = db
      .selectFrom("deploymentStage")
      .leftJoin("project", "deploymentStage.projectId", "project.id")
      .select([
        "deploymentStage.id",
        "deploymentStage.name",
        "deploymentStage.color",
        "deploymentStage.position",
        "project.id as projectId",
        "project.name as projectName",
        "project.code as projectCode",
      ])
      .where("deploymentStage.isDeleted", "is not", SQLITE_TRUE)
      .orderBy("deploymentStage.position", "asc");

    if (args.projectId) {
      q = q.where("deploymentStage.projectId", "=", args.projectId as ProjectId);
    }

    return q;
  });

  const result = await evolu.loadQuery(query);
  return {
    count: result.length,
    stages: result.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      position: s.position,
      project: s.projectId
        ? {
            id: s.projectId,
            name: s.projectName,
            code: s.projectCode,
          }
        : null,
    })),
  };
}

async function listWorklogs(evolu: EvoluInstance, args: { taskId: string }) {
  const query = evolu.createQuery((db) =>
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
  const totalMinutes = result.reduce((sum, w) => sum + (w.durationMinutes || 0), 0);

  return {
    count: result.length,
    totalMinutes,
    totalFormatted: `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`,
    worklogs: result.map((w) => ({
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
  const result = evolu.insert("worklog", {
    taskId: args.taskId as TaskId,
    durationMinutes: Int.orThrow(args.durationMinutes),
    description: args.description ? NonEmptyString1000.orThrow(args.description) : null,
    loggedAt: args.loggedAt || new Date().toISOString().split("T")[0],
    userId: args.userId ? (args.userId as UserId) : null,
  });

  if (!result.ok) {
    throw new Error(`Failed to add worklog: ${JSON.stringify(result.error)}`);
  }

  // Wait for sync to relay servers
  await waitForSync();

  return {
    success: true,
    worklogId: result.value.id,
    message: "Worklog added successfully",
  };
}

async function searchTasks(
  evolu: EvoluInstance,
  args: { query: string; limit?: number }
) {
  const searchQuery = args.query.toLowerCase();
  const limit = args.limit || 20;

  const query = evolu.createQuery((db) =>
    db
      .selectFrom("task")
      .leftJoin("project", "task.projectId", "project.id")
      .select([
        "task.id",
        "task.title",
        "task.name",
        "task.description",
        "task.status",
        "task.priority",
        "project.id as projectId",
        "project.name as projectName",
        "project.code as projectCode",
        "project.color as projectColor",
      ])
      .where("task.isDeleted", "is not", SQLITE_TRUE)
  );

  const allTasks = await evolu.loadQuery(query);

  // Filter in memory (Evolu doesn't support LIKE queries well)
  const filtered = allTasks.filter((t) => {
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

  return {
    count: limited.length,
    totalMatches: filtered.length,
    tasks: limited.map((t) => ({
      id: t.id,
      code: t.title,
      name: t.name,
      status: t.status,
      priority: t.priority,
      project: t.projectId
        ? {
            id: t.projectId,
            name: t.projectName,
            code: t.projectCode,
            color: t.projectColor,
          }
        : null,
    })),
  };
}

// --- Shared Projects Functions ---

async function listSharedProjects(
  evolu: EvoluInstance,
  args: { includeArchived?: boolean }
) {
  const query = evolu.createQuery((db) => {
    let q = db
      .selectFrom("projectRef")
      .select([
        "id",
        "projectId",
        "ownerSecret",
        "sharedOwnerId",
        "name",
        "code",
        "color",
        "isOwner",
        "permission",
        "joinedAt",
        "isArchived",
        "isHiddenFromFilters",
      ])
      .where("isDeleted", "is not", SQLITE_TRUE);

    if (!args.includeArchived) {
      q = q.where("isArchived", "is not", SQLITE_TRUE);
    }

    return q;
  });

  const result = await evolu.loadQuery(query);
  return {
    count: result.length,
    projects: result.map((p) => ({
      id: p.id,
      projectId: p.projectId,
      sharedOwnerId: p.sharedOwnerId,
      ownerSecret: p.ownerSecret, // Needed to access the project's data
      name: p.name,
      code: p.code,
      color: p.color,
      isOwner: p.isOwner === SQLITE_TRUE,
      permission: p.permission,
      joinedAt: p.joinedAt,
      isArchived: p.isArchived === SQLITE_TRUE,
    })),
  };
}

async function listSharedTasks(
  args: {
    sharedOwnerId: string;
    ownerSecret: string;
    status?: string;
    limit?: number;
  }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) {
    throw new Error("Project Evolu not initialized");
  }

  // Get or create SharedOwner
  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);

  // Use the SharedOwner to access this project's data
  useSharedOwner(sharedOwner);

  // Wait a bit for sync
  await new Promise((resolve) => setTimeout(resolve, 2000));

  try {
    const query = projectEvolu.createQuery((db: any) => {
      let q = db
        .selectFrom("task")
        .leftJoin("project", "task.projectId", "project.id")
        .leftJoin("deploymentStage", "task.deploymentStageId", "deploymentStage.id")
        .select([
          "task.id",
          "task.title",
          "task.name",
          "task.status",
          "task.priority",
          "task.deadline",
          "task.isBlocked",
          "task.estimate",
          "task.completedAt",
          "task.position",
          "task.isOnProduction",
          "task.deploymentStageId",
          "task.assigneeId",
          "project.id as projectId",
          "project.name as projectName",
          "project.code as projectCode",
          "project.color as projectColor",
          "deploymentStage.name as deploymentStageName",
          "deploymentStage.color as deploymentStageColor",
        ])
        .where("task.isDeleted", "is not", SQLITE_TRUE);

      if (args.status) {
        q = q.where("task.status", "=", args.status);
      }

      return q.orderBy("task.position", "asc").limit(args.limit || 50);
    });

    const result = await projectEvolu.loadQuery(query);

    // Filter by ownerId - Evolu returns ownerId automatically on each record
    const actualOwnerId = sharedOwner.id as string;
    const filtered = result.filter((t: any) => {
      const taskOwnerId = t.ownerId as string | undefined;
      return taskOwnerId === actualOwnerId;
    });

    return {
      count: filtered.length,
      sharedOwnerId: actualOwnerId,
      tasks: filtered.map((t: any) => ({
        id: t.id,
        code: t.title,
        name: t.name,
        status: t.status,
        priority: t.priority,
        deadline: t.deadline,
        isBlocked: t.isBlocked === SQLITE_TRUE,
        estimate: t.estimate,
        completedAt: t.completedAt,
        isOnProduction: t.isOnProduction === SQLITE_TRUE,
        assigneeId: t.assigneeId,
        deploymentStage: t.deploymentStageId
          ? {
              id: t.deploymentStageId,
              name: t.deploymentStageName,
              color: t.deploymentStageColor,
            }
          : null,
        project: t.projectId
          ? {
              id: t.projectId,
              name: t.projectName,
              code: t.projectCode,
              color: t.projectColor,
            }
          : null,
      })),
    };
  } finally {
    // Stop using the SharedOwner to free resources
    stopUsingSharedOwner(sharedOwner);
  }
}

async function listSharedDeploymentStages(
  args: {
    sharedOwnerId: string;
    ownerSecret: string;
  }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) {
    throw new Error("Project Evolu not initialized");
  }

  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 2000));

  try {
    const query = projectEvolu.createQuery((db: any) =>
      db
        .selectFrom("deploymentStage")
        .leftJoin("project", "deploymentStage.projectId", "project.id")
        .select([
          "deploymentStage.id",
          "deploymentStage.name",
          "deploymentStage.color",
          "deploymentStage.position",
          "project.id as projectId",
          "project.name as projectName",
          "project.code as projectCode",
        ])
        .where("deploymentStage.isDeleted", "is not", SQLITE_TRUE)
        .orderBy("deploymentStage.position", "asc")
    );

    const result = await projectEvolu.loadQuery(query);

    // Filter by ownerId
    const actualOwnerId = sharedOwner.id as string;
    const filtered = result.filter((s: any) => {
      const stageOwnerId = s.ownerId as string | undefined;
      return stageOwnerId === actualOwnerId;
    });

    return {
      count: filtered.length,
      stages: filtered.map((s: any) => ({
        id: s.id,
        name: s.name,
        color: s.color,
        position: s.position,
        project: s.projectId
          ? {
              id: s.projectId,
              name: s.projectName,
              code: s.projectCode,
            }
          : null,
      })),
    };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function updateSharedTask(
  args: {
    sharedOwnerId: string;
    ownerSecret: string;
    id: string;
    name?: string;
    status?: string;
    priority?: string;
    isOnProduction?: boolean;
    deploymentStageId?: string | null;
  }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) {
    throw new Error("Project Evolu not initialized");
  }

  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 2000));

  try {
    const updates: Record<string, unknown> = {
      id: args.id as TaskId,
    };

    if (args.name !== undefined) {
      updates.name = args.name ? NonEmptyString100.orThrow(args.name) : null;
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
    if (args.isOnProduction !== undefined) {
      updates.isOnProduction = args.isOnProduction ? SQLITE_TRUE : null;
    }
    if (args.deploymentStageId !== undefined) {
      updates.deploymentStageId = args.deploymentStageId ? (args.deploymentStageId as DeploymentStageId) : null;
    }

    projectEvolu.update("task", updates as any, { ownerId: sharedOwner.id });
    await waitForSync();

    return {
      success: true,
      message: "Shared task updated successfully",
    };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function createSharedDeploymentStage(
  args: {
    sharedOwnerId: string;
    ownerSecret: string;
    projectId: string;
    name: string;
    color?: string;
    position?: number;
  }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) {
    throw new Error("Project Evolu not initialized");
  }

  // Get or create SharedOwner
  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);

  // Use the SharedOwner to access this project's data
  useSharedOwner(sharedOwner);

  // Wait a bit for sync
  await new Promise((resolve) => setTimeout(resolve, 2000));

  try {
    const result = projectEvolu.insert("deploymentStage", {
      projectId: args.projectId as ProjectId,
      name: NonEmptyString100.orThrow(args.name),
      color: args.color || "#22c55e",
      position: Int.orThrow(args.position ?? 0),
    }, { ownerId: sharedOwner.id });

    if (!result.ok) {
      throw new Error(`Failed to create deployment stage: ${JSON.stringify(result.error)}`);
    }

    // Wait for sync to relay servers
    await waitForSync();

    return {
      success: true,
      stageId: result.value.id,
      message: `Deployment stage "${args.name}" created successfully`,
    };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}
