import { describe, it, expect } from "vitest";
import { selectList, selectToday, orderTasks, today, type ListedTask } from "./select.js";

function task(partial: Partial<ListedTask> & { code: string }): ListedTask {
  return {
    id: partial.code,
    name: partial.code,
    status: "todo",
    priority: "medium",
    deadline: null,
    scheduledDate: null,
    projectCode: "TODO",
    shared: false,
    ...partial,
  };
}

describe("today()", () => {
  it("formats the local day, not a UTC timestamp", () => {
    // 00:30 in Prague is still the previous day in UTC. Taking the ISO string
    // would have put a task due today under yesterday for half an hour each
    // night.
    expect(today(new Date(2026, 10, 9, 0, 30))).toBe("2026-11-09");
    expect(today(new Date(2026, 0, 1, 23, 59))).toBe("2026-01-01");
  });
});

describe("orderTasks", () => {
  it("puts a deadline before no deadline", () => {
    const out = orderTasks([task({ code: "A-2" }), task({ code: "A-1", deadline: "2026-12-01" })]);
    expect(out.map((t) => t.code)).toEqual(["A-1", "A-2"]);
  });

  it("sorts by date before priority", () => {
    const out = orderTasks([
      task({ code: "A-1", deadline: "2026-12-05", priority: "urgent" }),
      task({ code: "A-2", deadline: "2026-12-01", priority: "low" }),
    ]);
    expect(out.map((t) => t.code)).toEqual(["A-2", "A-1"]);
  });

  it("falls back to priority, then to the code", () => {
    const out = orderTasks([
      task({ code: "A-3", priority: "low" }),
      task({ code: "A-2", priority: "urgent" }),
      task({ code: "A-1", priority: "urgent" }),
    ]);
    expect(out.map((t) => t.code)).toEqual(["A-1", "A-2", "A-3"]);
  });

  it("treats a timestamp and a plain date as the same day", () => {
    const out = orderTasks([
      task({ code: "A-2", deadline: "2026-12-01T22:00:00.000Z", priority: "low" }),
      task({ code: "A-1", deadline: "2026-12-01", priority: "urgent" }),
    ]);
    expect(out.map((t) => t.code)).toEqual(["A-1", "A-2"]);
  });
});

describe("selectList", () => {
  const tasks = [
    task({ code: "A-1", status: "done" }),
    task({ code: "A-2", status: "recurring" }),
    task({ code: "A-3", status: "in_progress" }),
    task({ code: "B-1", status: "todo", projectCode: "OTHER" }),
  ];

  it("hides done and recurring by default", () => {
    expect(selectList(tasks).map((t) => t.code)).toEqual(["A-3", "B-1"]);
  });

  it("shows everything with all", () => {
    expect(selectList(tasks, { all: true })).toHaveLength(4);
  });

  it("an explicit status wins over the default hiding", () => {
    expect(selectList(tasks, { status: "done" }).map((t) => t.code)).toEqual(["A-1"]);
  });

  it("filters by project code", () => {
    expect(selectList(tasks, { projectCode: "OTHER" }).map((t) => t.code)).toEqual(["B-1"]);
  });

  it("applies the limit after filtering, not before", () => {
    // The whole point: limiting first would return the done task and then drop
    // it, leaving an empty list for someone who has work to do.
    expect(selectList(tasks, { limit: 1 }).map((t) => t.code)).toEqual(["A-3"]);
  });
});

describe("selectToday", () => {
  const now = "2026-11-09";

  it("reports why each task is listed", () => {
    const out = selectToday(
      [
        task({ code: "A-1", deadline: "2026-11-01" }),
        task({ code: "A-2", deadline: now }),
        task({ code: "A-3", scheduledDate: now }),
        task({ code: "A-4", status: "in_progress" }),
      ],
      now,
    );
    expect(Object.fromEntries(out.map((t) => [t.code, t.reason]))).toEqual({
      "A-1": "overdue",
      "A-2": "deadline",
      "A-3": "scheduled",
      "A-4": "in_progress",
    });
  });

  it("puts overdue first", () => {
    const out = selectToday(
      [task({ code: "A-2", deadline: now }), task({ code: "A-1", deadline: "2026-10-01" })],
      now,
    );
    expect(out[0]!.code).toBe("A-1");
  });

  it("leaves out a closed task however old its deadline", () => {
    const out = selectToday([task({ code: "A-1", status: "done", deadline: "2020-01-01" })], now);
    expect(out).toEqual([]);
  });

  it("leaves out work that is neither due nor started", () => {
    const out = selectToday(
      [task({ code: "A-1", deadline: "2027-01-01", scheduledDate: "2027-01-01" })],
      now,
    );
    expect(out).toEqual([]);
  });

  it("includes anything scheduled for an earlier day, not only exactly today", () => {
    // A task planned for yesterday and not done is still today's problem.
    const out = selectToday([task({ code: "A-1", scheduledDate: "2026-11-08" })], now);
    expect(out.map((t) => t.reason)).toEqual(["scheduled"]);
  });
});
