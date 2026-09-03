import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { SQLITE_TRUE, type EvoluInstance } from "../evolu.js";
import { queryRows } from "./pure.js";

/**
 * Rows from `loadQuery`, loosened at the boundary.
 *
 * v8 types every cell as a union, and this file reads columns dynamically. The
 * casts stay here in one place rather than spreading through the callers;
 * pinning the schema per query is the next step (TODO-265).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rowsOf = (result: unknown): Record<string, any>[] =>
  (result ?? []) as Record<string, any>[];

export const analyticsTools: Tool[] = [
  {
    name: "td_get_dashboard_summary",
    description:
      "Get a dashboard summary: tasks scheduled today, overdue tasks, this week's logged time, and upcoming deadlines. Useful for quick status reports.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "td_get_team_workload",
    description:
      "Get per-user workload metrics for a date range: logged time, estimated time, capacity, and utilization percentage. Useful for capacity planning and sprint review.",
    inputSchema: {
      type: "object",
      properties: {
        startDate: {
          type: "string",
          description: "Start date (YYYY-MM-DD). Defaults to start of current week (Monday).",
        },
        endDate: {
          type: "string",
          description: "End date (YYYY-MM-DD). Defaults to end of current week (Sunday).",
        },
        capacityHoursPerDay: {
          type: "number",
          description: "Working hours per day per user (default: 8)",
        },
      },
    },
  },
  {
    name: "td_list_recurring_tasks",
    description:
      "List all tasks with recurring schedule configured. Shows recurrence type, interval, day, and next scheduled date.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Filter by project ID (optional)",
        },
      },
    },
  },
  {
    name: "td_list_overdue_tasks",
    description:
      "List all tasks that are past their deadline and not yet completed. Sorted by deadline ascending (most overdue first).",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Filter by project ID (optional)",
        },
        assigneeId: {
          type: "string",
          description: "Filter by assignee user ID (optional)",
        },
      },
    },
  },
  {
    name: "td_list_tasks_by_date_range",
    description:
      "List tasks filtered by scheduledDate or deadline within a date range. Useful for calendar/planning queries.",
    inputSchema: {
      type: "object",
      properties: {
        startDate: {
          type: "string",
          description: "Start date (YYYY-MM-DD, required)",
        },
        endDate: {
          type: "string",
          description: "End date (YYYY-MM-DD, required)",
        },
        dateField: {
          type: "string",
          enum: ["scheduledDate", "deadline"],
          description: "Which date field to filter on (default: scheduledDate)",
        },
        status: {
          type: "string",
          enum: ["backlog", "todo", "in_progress", "review", "done"],
          description: "Filter by status (optional)",
        },
      },
      required: ["startDate", "endDate"],
    },
  },
  {
    name: "td_analyze_dependencies",
    description:
      "Analyze task dependencies for a project: find blocked tasks, blocking chains, tasks with no dependencies, and the critical path (longest chain of blocking tasks).",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Project ID (optional — analyzes all tasks if omitted)",
        },
      },
    },
  },
];

export async function handleAnalyticsTool(
  name: string,
  args: Record<string, unknown>,
  evolu: EvoluInstance
): Promise<unknown> {
  switch (name) {
    case "td_get_dashboard_summary":
      return getDashboardSummary(evolu);
    case "td_get_team_workload":
      return getTeamWorkload(evolu, args as {
        startDate?: string;
        endDate?: string;
        capacityHoursPerDay?: number;
      });
    case "td_list_recurring_tasks":
      return listRecurringTasks(evolu, args as { projectId?: string });
    case "td_list_overdue_tasks":
      return listOverdueTasks(evolu, args as {
        projectId?: string;
        assigneeId?: string;
      });
    case "td_list_tasks_by_date_range":
      return listTasksByDateRange(evolu, args as {
        startDate: string;
        endDate: string;
        dateField?: string;
        status?: string;
      });
    case "td_analyze_dependencies":
      return analyzeDependencies(evolu, args as { projectId?: string });
    default:
      return undefined;
  }
}

// --- Helper functions ---

function getToday(): string {
  return new Date().toISOString().split("T")[0]!;
}

function getWeekBounds(): { start: string; end: string } {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    start: monday.toISOString().split("T")[0]!,
    end: sunday.toISOString().split("T")[0]!,
  };
}

function countWorkingDays(startDate: string, endDate: string): number {
  let count = 0;
  const current = new Date(startDate);
  const end = new Date(endDate);
  current.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  while (current <= end) {
    const dow = current.getDay();
    if (dow !== 0 && dow !== 6) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// --- Tool implementations ---

async function getDashboardSummary(evolu: EvoluInstance) {
  const today = getToday();
  const week = getWeekBounds();

  // Tasks scheduled/due today
  const todayQuery = evolu.createQuery((db: any) =>
    db
      .selectFrom("task")
      .leftJoin("project", "task.projectId", "project.id")
      .select([
        "task.id",
        "task.title",
        "task.name",
        "task.status",
        "task.priority",
        "task.scheduledDate",
        "task.deadline",
        "project.name as projectName",
      ])
      .where("task.isDeleted", "is not", SQLITE_TRUE)
      .where("task.status", "!=", "done")
      .where((eb: any) =>
        eb.or([
          eb("task.scheduledDate", "=", today),
          eb("task.deadline", "=", today),
        ])
      )
      .orderBy("task.priority", "desc")
  );

  // Overdue tasks (deadline < today, not done)
  const overdueQuery = evolu.createQuery((db: any) =>
    db
      .selectFrom("task")
      .leftJoin("project", "task.projectId", "project.id")
      .select([
        "task.id",
        "task.title",
        "task.name",
        "task.status",
        "task.deadline",
        "project.name as projectName",
      ])
      .where("task.isDeleted", "is not", SQLITE_TRUE)
      .where("task.status", "!=", "done")
      .where("task.deadline", "is not", null)
      .where("task.deadline", "<", today)
      .orderBy("task.deadline", "asc")
  );

  // Week's worklogs
  const worklogQuery = evolu.createQuery((db: any) =>
    db
      .selectFrom("worklog")
      .select([
        "worklog.durationMinutes",
      ])
      .where("worklog.isDeleted", "is not", SQLITE_TRUE)
      .where("worklog.loggedAt", ">=", week.start)
      .where("worklog.loggedAt", "<=", week.end)
  );

  // Upcoming deadlines (next 5)
  const deadlineQuery = evolu.createQuery((db: any) =>
    db
      .selectFrom("task")
      .leftJoin("project", "task.projectId", "project.id")
      .select([
        "task.id",
        "task.title",
        "task.name",
        "task.deadline",
        "task.status",
        "project.name as projectName",
      ])
      .where("task.isDeleted", "is not", SQLITE_TRUE)
      .where("task.status", "!=", "done")
      .where("task.deadline", "is not", null)
      .where("task.deadline", ">=", today)
      .orderBy("task.deadline", "asc")
      .limit(5)
  );

  const [todayResult, overdueResult, worklogResult, deadlineResult] =
    await Promise.all([
      evolu.loadQuery(todayQuery),
      evolu.loadQuery(overdueQuery),
      evolu.loadQuery(worklogQuery),
      evolu.loadQuery(deadlineQuery),
    ]);

  // v8 `loadQuery` resolves to the rows themselves; v7 wrapped them in
  // `{ rows }`. Reading `.rows` therefore yielded undefined and the `?? []`
  // turned every analytics answer into an empty one — the dashboard reported
  // zero logged time for a week that had hours in it. (TODO-265)
  const todayTasks = rowsOf(todayResult).filter(
    (r: any) => r.id && r.title
  );
  const overdueTasks = rowsOf(overdueResult).filter(
    (r: any) => r.id && r.title
  );
  const worklogs = rowsOf(worklogResult).filter(
    (r: any) => r.durationMinutes
  );
  const upcomingDeadlines = rowsOf(deadlineResult).filter(
    (r: any) => r.id && r.title && r.deadline
  );

  const weekTotalMinutes = worklogs.reduce(
    (sum: number, w: any) => sum + (w.durationMinutes || 0),
    0
  );

  return {
    today: getToday(),
    tasksToday: todayTasks.length,
    tasksTodayList: todayTasks.map((t: any) => ({
      id: t.id,
      code: t.title,
      name: t.name,
      status: t.status,
      priority: t.priority,
      project: t.projectName,
    })),
    overdueCount: overdueTasks.length,
    overdueList: overdueTasks.map((t: any) => ({
      id: t.id,
      code: t.title,
      name: t.name,
      deadline: t.deadline,
      project: t.projectName,
    })),
    weekWorklog: {
      totalMinutes: weekTotalMinutes,
      formatted: formatMinutes(weekTotalMinutes),
      period: `${week.start} — ${week.end}`,
    },
    upcomingDeadlines: upcomingDeadlines.map((t: any) => ({
      id: t.id,
      code: t.title,
      name: t.name,
      deadline: t.deadline,
      status: t.status,
      project: t.projectName,
    })),
  };
}

async function getTeamWorkload(
  evolu: EvoluInstance,
  args: {
    startDate?: string;
    endDate?: string;
    capacityHoursPerDay?: number;
  }
) {
  const week = getWeekBounds();
  const startDate = args.startDate || week.start;
  const endDate = args.endDate || week.end;
  const capacityHoursPerDay = args.capacityHoursPerDay || 8;

  // Get all users
  const userQuery = evolu.createQuery((db: any) =>
    db
      .selectFrom("user")
      .select(["user.id", "user.name", "user.color"])
      .where("user.isDeleted", "is not", SQLITE_TRUE)
  );

  // Get worklogs in the date range
  const worklogQuery = evolu.createQuery((db: any) =>
    db
      .selectFrom("worklog")
      .select([
        "worklog.userId",
        "worklog.durationMinutes",
      ])
      .where("worklog.isDeleted", "is not", SQLITE_TRUE)
      .where("worklog.loggedAt", ">=", startDate)
      .where("worklog.loggedAt", "<=", endDate)
  );

  // Get tasks with estimates (all non-deleted, assigned tasks)
  const taskQuery = evolu.createQuery((db: any) =>
    db
      .selectFrom("task")
      .select([
        "task.assigneeId",
        "task.estimate",
      ])
      .where("task.isDeleted", "is not", SQLITE_TRUE)
      .where("task.status", "!=", "done")
      .where("task.assigneeId", "is not", null)
      .where("task.estimate", "is not", null)
  );

  const [userResult, worklogResult, taskResult] = await Promise.all([
    evolu.loadQuery(userQuery),
    evolu.loadQuery(worklogQuery),
    evolu.loadQuery(taskQuery),
  ]);

  const users = rowsOf(userResult).filter((r: any) => r.id && r.name);
  const worklogs = rowsOf(worklogResult).filter(
    (r: any) => r.durationMinutes
  );
  const tasks = rowsOf(taskResult).filter(
    (r: any) => r.assigneeId && r.estimate
  );

  const workingDays = countWorkingDays(startDate, endDate);
  const capacityMinutes = capacityHoursPerDay * 60 * workingDays;

  // Aggregate logged time per user
  const loggedByUser = new Map<string, number>();
  for (const w of worklogs) {
    const uid = w.userId || "unassigned";
    loggedByUser.set(uid, (loggedByUser.get(uid) ?? 0) + (w.durationMinutes || 0));
  }

  // Aggregate estimates per user
  const estimateByUser = new Map<string, number>();
  for (const t of tasks) {
    estimateByUser.set(
      t.assigneeId,
      (estimateByUser.get(t.assigneeId) ?? 0) + (t.estimate || 0)
    );
  }

  const userWorkloads = users.map((u: any) => {
    const logged = loggedByUser.get(u.id) ?? 0;
    const estimated = estimateByUser.get(u.id) ?? 0;
    const utilization =
      capacityMinutes > 0
        ? Math.round((logged / capacityMinutes) * 100)
        : 0;

    let status: string = "ok";
    if (utilization >= 100) status = "overloaded";
    else if (utilization >= 80) status = "warning";

    return {
      userId: u.id,
      userName: u.name,
      loggedMinutes: logged,
      loggedFormatted: formatMinutes(logged),
      estimateMinutes: estimated,
      estimateFormatted: formatMinutes(estimated),
      capacityMinutes,
      capacityFormatted: formatMinutes(capacityMinutes),
      utilizationPercent: utilization,
      status,
    };
  });

  // Sort by utilization descending
  userWorkloads.sort(
    (a: any, b: any) => b.utilizationPercent - a.utilizationPercent
  );

  const totalLogged = userWorkloads.reduce(
    (s: number, w: any) => s + w.loggedMinutes,
    0
  );
  const totalEstimate = userWorkloads.reduce(
    (s: number, w: any) => s + w.estimateMinutes,
    0
  );
  const totalCapacity = userWorkloads.length * capacityMinutes;

  return {
    period: { startDate, endDate },
    workingDays,
    capacityHoursPerDay,
    users: userWorkloads,
    totals: {
      loggedMinutes: totalLogged,
      loggedFormatted: formatMinutes(totalLogged),
      estimateMinutes: totalEstimate,
      estimateFormatted: formatMinutes(totalEstimate),
      capacityMinutes: totalCapacity,
      capacityFormatted: formatMinutes(totalCapacity),
    },
  };
}

async function listRecurringTasks(
  evolu: EvoluInstance,
  args: { projectId?: string }
) {
  const query = evolu.createQuery((db: any) => {
    let q = db
      .selectFrom("task")
      .leftJoin("project", "task.projectId", "project.id")
      .leftJoin("user", "task.assigneeId", "user.id")
      .select([
        "task.id",
        "task.title",
        "task.name",
        "task.status",
        "task.scheduledDate",
        "task.recurrenceType",
        "task.recurrenceInterval",
        "task.recurrenceDay",
        "task.recurrenceEndDate",
        "project.name as projectName",
        "user.name as assigneeName",
      ])
      .where("task.isDeleted", "is not", SQLITE_TRUE)
      .where("task.recurrenceType", "is not", null)
      .where("task.recurrenceType", "!=", "none");

    if (args.projectId) {
      q = q.where("task.projectId", "=", args.projectId);
    }

    return q.orderBy("task.scheduledDate", "asc");
  });

  const result = await evolu.loadQuery(query);
  const tasks = queryRows<any>(result).filter((r: any) => r.id && r.title);

  return {
    count: tasks.length,
    tasks: tasks.map((t: any) => ({
      id: t.id,
      code: t.title,
      name: t.name,
      status: t.status,
      scheduledDate: t.scheduledDate,
      recurrence: {
        type: t.recurrenceType,
        interval: t.recurrenceInterval,
        day: t.recurrenceDay,
        endDate: t.recurrenceEndDate,
      },
      project: t.projectName,
      assignee: t.assigneeName,
    })),
  };
}

async function listOverdueTasks(
  evolu: EvoluInstance,
  args: { projectId?: string; assigneeId?: string }
) {
  const today = getToday();

  const query = evolu.createQuery((db: any) => {
    let q = db
      .selectFrom("task")
      .leftJoin("project", "task.projectId", "project.id")
      .leftJoin("user", "task.assigneeId", "user.id")
      .select([
        "task.id",
        "task.title",
        "task.name",
        "task.status",
        "task.priority",
        "task.deadline",
        "task.estimate",
        "project.name as projectName",
        "user.name as assigneeName",
      ])
      .where("task.isDeleted", "is not", SQLITE_TRUE)
      .where("task.status", "!=", "done")
      .where("task.deadline", "is not", null)
      .where("task.deadline", "<", today);

    if (args.projectId) {
      q = q.where("task.projectId", "=", args.projectId);
    }
    if (args.assigneeId) {
      q = q.where("task.assigneeId", "=", args.assigneeId);
    }

    return q.orderBy("task.deadline", "asc");
  });

  const result = await evolu.loadQuery(query);
  const tasks = queryRows<any>(result).filter((r: any) => r.id && r.title);

  return {
    count: tasks.length,
    today,
    tasks: tasks.map((t: any) => {
      const deadlineDate = new Date(t.deadline);
      const todayDate = new Date(today);
      const daysOverdue = Math.floor(
        (todayDate.getTime() - deadlineDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      return {
        id: t.id,
        code: t.title,
        name: t.name,
        status: t.status,
        priority: t.priority,
        deadline: t.deadline,
        daysOverdue,
        estimate: t.estimate ? formatMinutes(t.estimate) : null,
        project: t.projectName,
        assignee: t.assigneeName,
      };
    }),
  };
}

async function listTasksByDateRange(
  evolu: EvoluInstance,
  args: {
    startDate: string;
    endDate: string;
    dateField?: string;
    status?: string;
  }
) {
  const field = args.dateField === "deadline" ? "task.deadline" : "task.scheduledDate";

  const query = evolu.createQuery((db: any) => {
    let q = db
      .selectFrom("task")
      .leftJoin("project", "task.projectId", "project.id")
      .leftJoin("user", "task.assigneeId", "user.id")
      .select([
        "task.id",
        "task.title",
        "task.name",
        "task.status",
        "task.priority",
        "task.scheduledDate",
        "task.deadline",
        "task.estimate",
        "project.name as projectName",
        "user.name as assigneeName",
      ])
      .where("task.isDeleted", "is not", SQLITE_TRUE)
      .where(field, "is not", null)
      .where(field, ">=", args.startDate)
      .where(field, "<=", args.endDate);

    if (args.status) {
      q = q.where("task.status", "=", args.status);
    }

    return q.orderBy(field, "asc");
  });

  const result = await evolu.loadQuery(query);
  const tasks = queryRows<any>(result).filter((r: any) => r.id && r.title);

  return {
    count: tasks.length,
    dateField: args.dateField || "scheduledDate",
    period: { startDate: args.startDate, endDate: args.endDate },
    tasks: tasks.map((t: any) => ({
      id: t.id,
      code: t.title,
      name: t.name,
      status: t.status,
      priority: t.priority,
      scheduledDate: t.scheduledDate,
      deadline: t.deadline,
      estimate: t.estimate ? formatMinutes(t.estimate) : null,
      project: t.projectName,
      assignee: t.assigneeName,
    })),
  };
}

async function analyzeDependencies(
  evolu: EvoluInstance,
  args: { projectId?: string }
) {
  // Get all active tasks
  const taskQuery = evolu.createQuery((db: any) => {
    let q = db
      .selectFrom("task")
      .leftJoin("project", "task.projectId", "project.id")
      .select([
        "task.id",
        "task.title",
        "task.name",
        "task.status",
        "task.priority",
        "task.isBlocked",
        "project.name as projectName",
      ])
      .where("task.isDeleted", "is not", SQLITE_TRUE)
      .where("task.status", "!=", "done");

    if (args.projectId) {
      q = q.where("task.projectId", "=", args.projectId);
    }

    return q;
  });

  // Get all task links (blocks type)
  const linkQuery = evolu.createQuery((db: any) =>
    db
      .selectFrom("taskLink")
      .select([
        "taskLink.id",
        "taskLink.sourceTaskId",
        "taskLink.targetTaskId",
        "taskLink.linkType",
      ])
      .where("taskLink.isDeleted", "is not", SQLITE_TRUE)
      .where("taskLink.linkType", "=", "blocks")
  );

  const [taskResult, linkResult] = await Promise.all([
    evolu.loadQuery(taskQuery),
    evolu.loadQuery(linkQuery),
  ]);

  const tasks = rowsOf(taskResult).filter((r: any) => r.id && r.title);
  const links = rowsOf(linkResult).filter(
    (r: any) => r.sourceTaskId && r.targetTaskId
  );

  const taskMap = new Map<string, any>();
  for (const t of tasks) {
    taskMap.set(t.id, t);
  }

  // Build adjacency lists
  const blocksMap = new Map<string, string[]>(); // source -> targets it blocks
  const blockedByMap = new Map<string, string[]>(); // target -> sources blocking it

  for (const link of links) {
    const src = link.sourceTaskId;
    const tgt = link.targetTaskId;
    if (!taskMap.has(src) || !taskMap.has(tgt)) continue;

    if (!blocksMap.has(src)) blocksMap.set(src, []);
    blocksMap.get(src)!.push(tgt);

    if (!blockedByMap.has(tgt)) blockedByMap.set(tgt, []);
    blockedByMap.get(tgt)!.push(src);
  }

  // Find blocked tasks
  const blockedTasks = tasks
    .filter((t: any) => blockedByMap.has(t.id))
    .map((t: any) => ({
      id: t.id,
      code: t.title,
      name: t.name,
      blockedBy: (blockedByMap.get(t.id) ?? []).map((bid: string) => {
        const bt = taskMap.get(bid);
        return bt ? { id: bt.id, code: bt.title, name: bt.name } : { id: bid };
      }),
    }));

  // Find tasks that block others
  const blockingTasks = tasks
    .filter((t: any) => blocksMap.has(t.id))
    .map((t: any) => ({
      id: t.id,
      code: t.title,
      name: t.name,
      blocks: (blocksMap.get(t.id) ?? []).map((bid: string) => {
        const bt = taskMap.get(bid);
        return bt ? { id: bt.id, code: bt.title, name: bt.name } : { id: bid };
      }),
    }));

  // Find independent tasks (no dependencies)
  const involvedIds = new Set([
    ...blocksMap.keys(),
    ...blockedByMap.keys(),
    ...[...blocksMap.values()].flat(),
    ...[...blockedByMap.values()].flat(),
  ]);
  const independentTasks = tasks
    .filter((t: any) => !involvedIds.has(t.id))
    .map((t: any) => ({
      id: t.id,
      code: t.title,
      name: t.name,
    }));

  // Find critical path (longest chain using DFS)
  function longestPath(taskId: string, visited: Set<string>): string[] {
    if (visited.has(taskId)) return [];
    visited.add(taskId);

    const targets = blocksMap.get(taskId) ?? [];
    let longest: string[] = [];

    for (const target of targets) {
      const path = longestPath(target, new Set(visited));
      if (path.length > longest.length) {
        longest = path;
      }
    }

    return [taskId, ...longest];
  }

  let criticalPath: string[] = [];
  // Start from root nodes (tasks that block others but aren't blocked)
  const rootNodes = [...blocksMap.keys()].filter(
    (id) => !blockedByMap.has(id)
  );

  for (const root of rootNodes) {
    const path = longestPath(root, new Set());
    if (path.length > criticalPath.length) {
      criticalPath = path;
    }
  }

  const criticalPathDetails = criticalPath.map((id) => {
    const t = taskMap.get(id);
    return t
      ? { id: t.id, code: t.title, name: t.name, status: t.status }
      : { id };
  });

  return {
    totalActiveTasks: tasks.length,
    totalBlockingLinks: links.length,
    blockedTasks: {
      count: blockedTasks.length,
      tasks: blockedTasks,
    },
    blockingTasks: {
      count: blockingTasks.length,
      tasks: blockingTasks,
    },
    independentTasks: {
      count: independentTasks.length,
      tasks: independentTasks,
    },
    criticalPath: {
      length: criticalPathDetails.length,
      tasks: criticalPathDetails,
    },
  };
}
