import type { EvoluInstance, TaskId } from "../evolu.js";

export const TRACKED_TASK_FIELDS = [
  "status", "priority", "assigneeId", "deadline", "scheduledDate",
  "name", "description", "estimate", "isBlocked", "blockedReason",
  "deploymentStageId", "recurrenceType", "completedAt", "isOnProduction",
] as const;

export function serializeValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === 1) return "true";
  return String(value);
}

export function diffTaskFields(
  oldData: Record<string, unknown>,
  newData: Record<string, unknown>,
): Array<{ field: string; oldValue: string | null; newValue: string | null }> {
  const changes: Array<{ field: string; oldValue: string | null; newValue: string | null }> = [];
  for (const field of TRACKED_TASK_FIELDS) {
    if (!(field in newData)) continue;
    const normOld = oldData[field] ?? null;
    const normNew = newData[field] ?? null;
    if (normOld === normNew) continue;
    if (normOld !== null && normNew !== null && String(normOld) === String(normNew)) continue;
    changes.push({
      field,
      oldValue: serializeValue(normOld),
      newValue: serializeValue(normNew),
    });
  }
  return changes;
}

/**
 * Project fields worth a history entry, as the app's TRACKED_PROJECT_FIELDS
 * (TODO-305). `position` is left out there too: reordering is a personal view
 * preference. (TODO-434)
 */
export const TRACKED_PROJECT_FIELDS = [
  "name", "code", "color", "isArchived", "isHiddenFromFilters", "autoApproveMembers", "isDeleted",
] as const;

/**
 * The app's diffProjectFields. The flags are stored as 1/null but may arrive
 * as booleans, so `1` against `true` is not a change: compared by truthiness
 * when either side is a boolean, by text otherwise.
 */
export function diffProjectFields(
  oldData: Record<string, unknown>,
  newData: Record<string, unknown>,
): Array<{ field: string; oldValue: string | null; newValue: string | null }> {
  const changes: Array<{ field: string; oldValue: string | null; newValue: string | null }> = [];
  for (const field of TRACKED_PROJECT_FIELDS) {
    if (!(field in newData)) continue;
    const normOld = oldData[field] ?? null;
    const normNew = newData[field] ?? null;
    if (normOld === normNew) continue;
    if (typeof normOld === "boolean" || typeof normNew === "boolean") {
      if (Boolean(normOld) === Boolean(normNew)) continue;
    } else if (normOld !== null && normNew !== null && String(normOld) === String(normNew)) {
      continue;
    }
    changes.push({ field, oldValue: serializeValue(normOld), newValue: serializeValue(normNew) });
  }
  return changes;
}

const MCP_METADATA = JSON.stringify({ source: "mcp" });

export function logTaskUpdate(
  evolu: EvoluInstance,
  taskId: string,
  oldData: Record<string, unknown>,
  newData: Record<string, unknown>,
): void {
  const changes = diffTaskFields(oldData, newData);
  for (const change of changes) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (evolu as any).insert("activityLog", {
        taskId: taskId as TaskId,
        actorId: null,
        action: "updated",
        entityType: "task",
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        metadata: MCP_METADATA,
      });
    } catch {
      // Swallow — activity log failure must not break the mutation
    }
  }
}

export function logTaskCreate(evolu: EvoluInstance, taskId: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (evolu as any).insert("activityLog", {
      taskId: taskId as TaskId,
      actorId: null,
      action: "created",
      entityType: "task",
      field: null,
      oldValue: null,
      newValue: null,
      metadata: MCP_METADATA,
    });
  } catch {
    // ignore
  }
}

export function logTaskDelete(evolu: EvoluInstance, taskId: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (evolu as any).insert("activityLog", {
      taskId: taskId as TaskId,
      actorId: null,
      action: "deleted",
      entityType: "task",
      field: null,
      oldValue: null,
      newValue: null,
      metadata: MCP_METADATA,
    });
  } catch {
    // ignore
  }
}

export function logActivity(
  evolu: EvoluInstance,
  params: {
    taskId: string | null;
    action: string;
    entityType: string;
    newValue?: string | null;
    oldValue?: string | null;
  },
): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (evolu as any).insert("activityLog", {
      taskId: params.taskId as TaskId | null,
      actorId: null,
      action: params.action,
      entityType: params.entityType,
      field: null,
      oldValue: params.oldValue ?? null,
      newValue: params.newValue ?? null,
      metadata: MCP_METADATA,
    });
  } catch {
    // ignore
  }
}
