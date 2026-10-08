import { describe, it, expect, vi, afterEach } from "vitest";
import { onMarkedDone, applyDoneOutcome, type RecurrenceFields } from "./recurrenceTransition.js";

/**
 * Closing a recurring task brings it back (TODO-420).
 *
 * MCP used to write `status: "done"` and stop, so a recurring task closed
 * through it never came back: no date moved, nothing returned, nothing said.
 */
const TODAY = new Date(2026, 9, 8, 12, 0, 0);
afterEach(() => vi.useRealTimers());

function task(over: Partial<RecurrenceFields> = {}): RecurrenceFields {
  return {
    recurrenceType: "monthly",
    recurrenceInterval: 1,
    recurrenceEndDate: null,
    recurrenceDay: 7,
    deadline: "2026-10-07",
    ...over,
  };
}

describe("what done means for a recurring task", () => {
  it("a monthly task closed on its date comes back next month", () => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
    // This is the audit task itself: closed on 7 October, due again 7 November.
    expect(onMarkedDone(task())).toEqual({ kind: "reset", nextDeadline: "2026-11-07" });
  });

  it("a task without recurrence just stays done", () => {
    expect(onMarkedDone(task({ recurrenceType: null }))).toEqual({ kind: "not-recurring" });
  });

  it("an empty recurrence type is no recurrence", () => {
    expect(onMarkedDone(task({ recurrenceType: "" }))).toEqual({ kind: "not-recurring" });
  });

  it("an ended recurrence stays done, as in the app", () => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
    expect(onMarkedDone(task({ recurrenceEndDate: "2026-10-01" }))).toEqual({ kind: "expired" });
  });
});

describe("what gets written", () => {
  it("a reset writes the settled state the app writes after its 1.5 s", () => {
    const updates: Record<string, unknown> = { id: "t", status: "done", completedAt: "x" };
    applyDoneOutcome(updates, { kind: "reset", nextDeadline: "2026-11-07" }, { personal: true });

    expect(updates).toEqual({
      id: "t",
      status: "recurring",
      deadline: "2026-11-07",
      scheduledDate: "2026-11-07",
      completedAt: null,
      previousStatus: "done",
    });
  });

  it("shared tasks get no previousStatus, matching the app's shared path", () => {
    const updates: Record<string, unknown> = { status: "done" };
    applyDoneOutcome(updates, { kind: "reset", nextDeadline: "2026-11-07" }, { personal: false });

    expect(updates.previousStatus).toBeUndefined();
    expect(updates.status).toBe("recurring");
  });

  it("anything but a reset leaves the update untouched", () => {
    for (const outcome of [{ kind: "not-recurring" as const }, { kind: "expired" as const }]) {
      const updates: Record<string, unknown> = { status: "done", completedAt: "x" };
      applyDoneOutcome(updates, outcome, { personal: true });
      expect(updates).toEqual({ status: "done", completedAt: "x" });
    }
  });
});
