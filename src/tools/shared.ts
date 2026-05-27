import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { NonEmptyString100, NonEmptyString1000, Int } from "@evolu/common";
import {
  SQLITE_TRUE,
  type TaskId,
  type ProjectId,
  type UserId,
  type DeploymentStageId,
  type RepositoryLinkId,
  type ProjectMemberId,
  type EvoluInstance,
  getProjectEvolu,
  getSharedOwner,
  useSharedOwner,
  stopUsingSharedOwner,
} from "../evolu.js";
import { createMutationWaiter } from "./helpers.js";

export const sharedTools: Tool[] = [
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
        description: {
          type: "string",
          description: "Task description (HTML supported)",
        },
        deadline: {
          type: "string",
          description: "Deadline in ISO format, or null to clear",
        },
        scheduledDate: {
          type: "string",
          description: "Scheduled date (YYYY-MM-DD), or null to clear",
        },
        assigneeId: {
          type: "string",
          description: "User ID to assign, or null to unassign",
        },
        estimate: {
          type: "number",
          description: "Time estimate in minutes",
        },
        isBlocked: {
          type: "boolean",
          description: "Set blocked status",
        },
        blockedReason: {
          type: "string",
          description: "Reason for being blocked",
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
          description: "Recurrence interval (e.g., every 2 weeks)",
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
  {
    name: "td_list_shared_repository_links",
    description: "List repository links for a shared project",
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
    name: "td_create_shared_repository_link",
    description: "Create a repository link in a shared project",
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
        type: {
          type: "string",
          enum: ["github", "gitlab", "bitbucket", "azure", "custom"],
          description: "Repository type (default: 'github')",
        },
        url: {
          type: "string",
          description: "Repository URL (required)",
        },
        label: {
          type: "string",
          description: "Optional label (e.g., 'Frontend', 'API')",
        },
      },
      required: ["sharedOwnerId", "ownerSecret", "projectId", "url"],
    },
  },
  {
    name: "td_list_shared_members",
    description: "List members of a shared project (name, permission, kicked/blocked state)",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        projectId: { type: "string", description: "Filter by project ID within the shared owner (optional)" },
        includeKicked: { type: "boolean", description: "Include kicked members (default: false)" },
      },
      required: ["sharedOwnerId", "ownerSecret"],
    },
  },
  {
    name: "td_update_shared_member",
    description: "Update a shared project member: change permission, block/unblock or kick.",
    inputSchema: {
      type: "object",
      properties: {
        sharedOwnerId: { type: "string", description: "SharedOwner ID from projectRef (required)" },
        ownerSecret: { type: "string", description: "Owner secret from projectRef (required)" },
        id: { type: "string", description: "ProjectMember ID (required)" },
        permission: { type: "string", enum: ["admin", "write", "read"], description: "New permission level" },
        isBlocked: { type: "boolean", description: "Block (true) or unblock (false) the member's access" },
        isKicked: { type: "boolean", description: "Kick (true) the member from the project" },
      },
      required: ["sharedOwnerId", "ownerSecret", "id"],
    },
  },
];

export async function handleSharedTool(
  name: string,
  args: Record<string, unknown>,
  evolu: EvoluInstance
): Promise<unknown> {
  switch (name) {
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
        description?: string;
        status?: string;
        priority?: string;
        deadline?: string | null;
        scheduledDate?: string | null;
        assigneeId?: string | null;
        estimate?: number;
        isBlocked?: boolean;
        blockedReason?: string;
        isOnProduction?: boolean;
        deploymentStageId?: string | null;
        recurrenceType?: string;
        recurrenceInterval?: number;
        recurrenceEndDate?: string | null;
        recurrenceDay?: string | null;
        sprintNumber?: number | null;
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
    case "td_list_shared_repository_links":
      return listSharedRepositoryLinks(args as {
        sharedOwnerId: string;
        ownerSecret: string;
      });
    case "td_create_shared_repository_link":
      return createSharedRepositoryLink(args as {
        sharedOwnerId: string;
        ownerSecret: string;
        projectId: string;
        type?: string;
        url: string;
        label?: string;
      });
    case "td_list_shared_members":
      return listSharedMembers(args as {
        sharedOwnerId: string;
        ownerSecret: string;
        projectId?: string;
        includeKicked?: boolean;
      });
    case "td_update_shared_member":
      return updateSharedMember(args as {
        sharedOwnerId: string;
        ownerSecret: string;
        id: string;
        permission?: string;
        isBlocked?: boolean;
        isKicked?: boolean;
      });
    default:
      return undefined;
  }
}

async function listSharedProjects(
  evolu: EvoluInstance,
  args: { includeArchived?: boolean }
) {
  const query = evolu.createQuery((db: any) => {
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
    projects: result.map((p: any) => ({
      id: p.id,
      projectId: p.projectId,
      sharedOwnerId: p.sharedOwnerId,
      ownerSecret: p.ownerSecret,
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

  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));

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
          "task.scheduledDate",
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
        scheduledDate: t.scheduledDate,
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
  await new Promise((resolve) => setTimeout(resolve, 1000));

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
    description?: string;
    status?: string;
    priority?: string;
    deadline?: string | null;
    scheduledDate?: string | null;
    assigneeId?: string | null;
    estimate?: number;
    isBlocked?: boolean;
    blockedReason?: string;
    isOnProduction?: boolean;
    deploymentStageId?: string | null;
    recurrenceType?: string;
    recurrenceInterval?: number;
    recurrenceEndDate?: string | null;
    recurrenceDay?: string | null;
    sprintNumber?: number | null;
  }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) {
    throw new Error("Project Evolu not initialized");
  }

  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
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
    if (args.estimate !== undefined) {
      updates.estimate = args.estimate ? Int.orThrow(args.estimate) : null;
    }
    if (args.isBlocked !== undefined) {
      updates.isBlocked = args.isBlocked ? SQLITE_TRUE : null;
    }
    if (args.blockedReason !== undefined) {
      updates.blockedReason = args.blockedReason ? NonEmptyString1000.orThrow(args.blockedReason) : null;
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

    const waiter = createMutationWaiter();
    projectEvolu.update("task", updates as any, { ownerId: sharedOwner.id, onComplete: waiter.onComplete });
    await waiter.waitForSync();

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

  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    const waiter = createMutationWaiter();
    const result = projectEvolu.insert("deploymentStage", {
      projectId: args.projectId as ProjectId,
      name: NonEmptyString100.orThrow(args.name),
      color: args.color || "#22c55e",
      position: Int.orThrow(args.position ?? 0),
    }, { ownerId: sharedOwner.id, onComplete: waiter.onComplete });

    if (!result.ok) {
      throw new Error(`Failed to create deployment stage: ${JSON.stringify(result.error)}`);
    }

    await waiter.waitForSync();

    return {
      success: true,
      stageId: result.value.id,
      message: `Deployment stage "${args.name}" created successfully`,
    };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function listSharedRepositoryLinks(
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
  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    const query = projectEvolu.createQuery((db: any) =>
      db
        .selectFrom("repositoryLink")
        .leftJoin("project", "repositoryLink.projectId", "project.id")
        .select([
          "repositoryLink.id",
          "repositoryLink.type",
          "repositoryLink.url",
          "repositoryLink.label",
          "repositoryLink.position",
          "project.id as projectId",
          "project.name as projectName",
          "project.code as projectCode",
        ])
        .where("repositoryLink.isDeleted", "is not", SQLITE_TRUE)
        .orderBy("repositoryLink.position", "asc")
    );

    const result = await projectEvolu.loadQuery(query);

    const actualOwnerId = sharedOwner.id as string;
    const filtered = result.filter((l: any) => {
      const linkOwnerId = l.ownerId as string | undefined;
      return linkOwnerId === actualOwnerId;
    });

    return {
      count: filtered.length,
      links: filtered.map((l: any) => ({
        id: l.id,
        type: l.type,
        url: l.url,
        label: l.label,
        position: l.position,
        project: l.projectId
          ? {
              id: l.projectId,
              name: l.projectName,
              code: l.projectCode,
            }
          : null,
      })),
    };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function createSharedRepositoryLink(
  args: {
    sharedOwnerId: string;
    ownerSecret: string;
    projectId: string;
    type?: string;
    url: string;
    label?: string;
  }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) {
    throw new Error("Project Evolu not initialized");
  }

  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    const posQuery = projectEvolu.createQuery((db: any) =>
      db
        .selectFrom("repositoryLink")
        .select(["position", "ownerId"])
        .where("isDeleted", "is not", SQLITE_TRUE)
        .orderBy("position", "desc")
    );
    const posResults = await projectEvolu.loadQuery(posQuery);
    const filteredPos = posResults.filter((r: any) => r.ownerId === (sharedOwner.id as string));
    const maxPosition = filteredPos.length > 0 ? ((filteredPos[0] as any).position || 0) : 0;

    const waiter = createMutationWaiter();
    const result = projectEvolu.insert("repositoryLink", {
      projectId: args.projectId as ProjectId,
      type: args.type || "github",
      url: NonEmptyString1000.orThrow(args.url),
      label: args.label ? NonEmptyString100.orThrow(args.label) : null,
      position: Int.orThrow(maxPosition + 1),
    }, { ownerId: sharedOwner.id, onComplete: waiter.onComplete });

    if (!result.ok) {
      throw new Error(`Failed to create repository link: ${JSON.stringify(result.error)}`);
    }

    await waiter.waitForSync();

    return {
      success: true,
      linkId: result.value.id,
      message: "Repository link created successfully",
    };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function listSharedMembers(
  args: {
    sharedOwnerId: string;
    ownerSecret: string;
    projectId?: string;
    includeKicked?: boolean;
  }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) {
    throw new Error("Project Evolu not initialized");
  }

  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    const query = projectEvolu.createQuery((db: any) => {
      let q = db
        .selectFrom("projectMember")
        .select([
          "id",
          "projectId",
          "userAppOwnerId",
          "userName",
          "userColor",
          "userAvatarUrl",
          "permission",
          "joinedAt",
          "isKicked",
          "isBlocked",
        ])
        .where("isDeleted", "is not", SQLITE_TRUE);

      if (args.projectId) {
        q = q.where("projectId", "=", args.projectId as ProjectId);
      }
      if (!args.includeKicked) {
        q = q.where("isKicked", "is not", SQLITE_TRUE);
      }

      return q.orderBy("joinedAt", "asc");
    });

    const result = await projectEvolu.loadQuery(query);

    const actualOwnerId = sharedOwner.id as string;
    const filtered = result.filter((m: any) => (m.ownerId as string | undefined) === actualOwnerId);

    return {
      count: filtered.length,
      sharedOwnerId: actualOwnerId,
      members: filtered.map((m: any) => ({
        id: m.id,
        projectId: m.projectId,
        userAppOwnerId: m.userAppOwnerId,
        userName: m.userName,
        userColor: m.userColor,
        userAvatarUrl: m.userAvatarUrl,
        permission: m.permission,
        joinedAt: m.joinedAt,
        isKicked: m.isKicked === SQLITE_TRUE,
        isBlocked: m.isBlocked === SQLITE_TRUE,
      })),
    };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}

async function updateSharedMember(
  args: {
    sharedOwnerId: string;
    ownerSecret: string;
    id: string;
    permission?: string;
    isBlocked?: boolean;
    isKicked?: boolean;
  }
) {
  const projectEvolu = getProjectEvolu();
  if (!projectEvolu) {
    throw new Error("Project Evolu not initialized");
  }

  const sharedOwner = getSharedOwner(args.sharedOwnerId, args.ownerSecret);
  useSharedOwner(sharedOwner);
  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    const updates: Record<string, unknown> = {
      id: args.id as ProjectMemberId,
    };

    if (args.permission !== undefined) {
      updates.permission = args.permission;
    }
    if (args.isBlocked !== undefined) {
      updates.isBlocked = args.isBlocked ? SQLITE_TRUE : null;
    }
    if (args.isKicked !== undefined) {
      updates.isKicked = args.isKicked ? SQLITE_TRUE : null;
    }

    const waiter = createMutationWaiter();
    projectEvolu.update("projectMember", updates as any, { ownerId: sharedOwner.id, onComplete: waiter.onComplete });
    await waiter.waitForSync();

    return {
      success: true,
      message: "Shared project member updated successfully",
    };
  } finally {
    stopUsingSharedOwner(sharedOwner);
  }
}
