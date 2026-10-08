import { calculateNextDeadline, isRecurrenceExpired, isRecurring, type RecurrenceType } from "./recurrence.js";

/**
 * What closing a recurring task means. (TODO-420)
 *
 * In the app, marking a recurring task done shows "done" for 1.5 s and then
 * resets it to `recurring` with the next deadline. MCP wrote `status: "done"`
 * and stopped, so a recurring task closed here dropped out of its cycle for
 * good: no date moved, nothing came back, and nothing said so.
 *
 * MCP has no screen to show the intermediate "done" on, so it writes the
 * settled state straight away - the same fields the app writes 1.5 s later.
 */
export interface RecurrenceFields {
  recurrenceType: string | null;
  recurrenceInterval: number | null;
  recurrenceEndDate: string | null;
  recurrenceDay: number | null;
  deadline: string | null;
}

export type DoneOutcome =
  | { kind: "not-recurring" }
  | { kind: "expired" }
  | { kind: "reset"; nextDeadline: string };

/**
 * Decide what `status: "done"` should become for this task.
 *
 * Pure, so the decision can be tested without Evolu. An expired recurrence is
 * left done, exactly as the app does: its cycle has ended, so done is final.
 */
export function onMarkedDone(task: RecurrenceFields): DoneOutcome {
  if (!isRecurring(task.recurrenceType)) return { kind: "not-recurring" };
  if (isRecurrenceExpired(task.recurrenceEndDate)) return { kind: "expired" };
  const nextDeadline = calculateNextDeadline(
    task.deadline,
    task.recurrenceType as RecurrenceType,
    task.recurrenceInterval ?? 1,
    task.recurrenceDay,
  );
  return { kind: "reset", nextDeadline };
}

/**
 * Apply the outcome to an update being built, in place.
 *
 * `previousStatus` is written for personal tasks only, matching the app: the
 * shared reset path in `useRecurringTasks` does not set it either.
 */
export function applyDoneOutcome(
  updates: Record<string, unknown>,
  outcome: DoneOutcome,
  { personal }: { personal: boolean },
): void {
  if (outcome.kind !== "reset") return;
  updates.status = "recurring";
  updates.deadline = outcome.nextDeadline;
  updates.scheduledDate = outcome.nextDeadline;
  updates.completedAt = null;
  if (personal) updates.previousStatus = "done";
}
