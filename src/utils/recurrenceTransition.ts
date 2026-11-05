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
 * It used to add `previousStatus: "done"` for personal tasks, said to match
 * the app. It did not: in the app `previousStatus` is an argument to its own
 * update helper, which reads it and drops it, while here `updates` goes
 * straight into `evolu.update`, where `task` has no such column. Measured in
 * round XI (TODO-112): the mutation is accepted and returns a row id, and
 * selecting the column afterwards fails because it was never created. The
 * value was thrown away on every recurring completion, in silence.
 *
 * MCP now has the same signal in the right place: `resolveCompletedAt` takes
 * `previousStatus` as an argument and it never reaches the database.
 */
export function applyDoneOutcome(
  updates: Record<string, unknown>,
  outcome: DoneOutcome,
): void {
  if (outcome.kind !== "reset") return;
  updates.status = "recurring";
  updates.deadline = outcome.nextDeadline;
  updates.scheduledDate = outcome.nextDeadline;
  updates.completedAt = null;
}
