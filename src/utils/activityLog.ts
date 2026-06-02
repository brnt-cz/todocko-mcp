import type { EvoluInstance, TaskId } from "../evolu.js";

export const TRACKED_TASK_FIELDS = [
  "status", "priority", "assigneeId", "deadline", "scheduledDate",
  "name", "description", "estimate", "isBlocked", "blockedReason",
  "deploymentStageId", "recurrenceType", "completedAt", "isOnProduction",
] as const;

function serializeValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === 1) return "true";
  return String(value);
}

function diffTaskFields(
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
