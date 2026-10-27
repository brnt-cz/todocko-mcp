import { describe, it, expect } from "vitest";
import {
  assertValidProjectCode,
  escapeRegExp,
  nextTaskCode,
  assertTaskCodeForProject,
  createKeyedMutex,
  pickSharedProjectRow,
} from "./pure.js";
import { diffProjectFields } from "../utils/activityLog.js";

/** Project codes, task codes, the per-project lock and the shared project row. (TODO-434) */

describe("assertValidProjectCode", () => {
  it("accepts what the app accepts", () => {
    for (const code of ["TODO", "A1", "2026", "X"]) expect(() => assertValidProjectCode(code)).not.toThrow();
  });

  it("lets an absent code through: clearing a code is allowed", () => {
    for (const code of [null, undefined, ""]) expect(() => assertValidProjectCode(code)).not.toThrow();
  });

  it("refuses lower case, spaces, dashes and regex metacharacters, with a suggestion", () => {
    for (const code of ["todo", "MY PROJ", "A-B", "A.B", "A+", "(X)"]) {
      expect(() => assertValidProjectCode(code)).toThrow(/Invalid project code/);
    }
    expect(() => assertValidProjectCode("my-proj")).toThrow(/"MYPROJ"/);
  });
});

describe("task codes", () => {
  it("escapes every metacharacter", () => {
    expect(new RegExp(`^${escapeRegExp("a.b*c+?^${}()|[]\\")}$`).test("a.b*c+?^${}()|[]\\")).toBe(true);
  });

  it("numbers one past the highest code of the project", () => {
    expect(nextTaskCode("TODO", ["TODO-1", "TODO-7", "TODO-3", null, "OTHER-99"])).toBe("TODO-8");
    expect(nextTaskCode("TODO", [])).toBe("TODO-1");
  });

  it("does not let a dot in a legacy code match another prefix", () => {
    // Unescaped, `A.B` matches `AXB-50` and the next code would be A.B-51.
    expect(nextTaskCode("A.B", ["AXB-50", "A.B-2"])).toBe("A.B-3");
  });

  it("checks an explicit code against the escaped prefix and for reuse", () => {
    expect(() => assertTaskCodeForProject("A.B-4", "A.B", [])).not.toThrow();
    expect(() => assertTaskCodeForProject("AXB-4", "A.B", [])).toThrow(/does not match/);
    expect(() => assertTaskCodeForProject("A+-1", "A+", [])).not.toThrow();
    expect(() => assertTaskCodeForProject("TODO-2", "TODO", ["TODO-2"])).toThrow(/already used/);
  });
});

describe("createKeyedMutex", () => {
  const tick = () => new Promise((r) => setTimeout(r, 5));

  it("runs calls for one key one after another, so both see the other's code", async () => {
    const withLock = createKeyedMutex();
    const taken: string[] = [];
    // Read, wait, write: without the lock both calls read an empty list.
    const allocate = () =>
      withLock("p1", async () => {
        const code = nextTaskCode("P", taken);
        await tick();
        taken.push(code);
        return code;
      });
    const codes = await Promise.all([allocate(), allocate(), allocate()]);
    expect(codes).toEqual(["P-1", "P-2", "P-3"]);
  });

  it("does not make different keys wait for each other", async () => {
    const withLock = createKeyedMutex();
    const order: string[] = [];
    let release!: () => void;
    const blocker = new Promise<void>((r) => (release = r));
    const a = withLock("a", async () => {
      await blocker;
      order.push("a");
    });
    await withLock("b", async () => {
      order.push("b");
    });
    release();
    await a;
    expect(order).toEqual(["b", "a"]);
  });

  it("passes a failure to its own caller and keeps the queue moving", async () => {
    const withLock = createKeyedMutex();
    const failed = withLock("k", async () => {
      throw new Error("boom");
    });
    const next = withLock("k", async () => "ok");
    await expect(failed).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ok");
  });
});

describe("pickSharedProjectRow (the app's TODO-401 rule)", () => {
  const rows = [
    { id: "p-new", ownerId: "o1", createdAt: "2026-08-25T10:00:00Z", isDeleted: null },
    { id: "p-old", ownerId: "o1", createdAt: "2026-01-01T10:00:00Z", isDeleted: null },
    { id: "p-other", ownerId: "o2", createdAt: "2025-01-01T10:00:00Z", isDeleted: null },
  ];

  it("takes the oldest live row of this owner, whatever the input order", () => {
    expect(pickSharedProjectRow(rows, "o1")?.id).toBe("p-old");
    expect(pickSharedProjectRow([...rows].reverse(), "o1")?.id).toBe("p-old");
  });

  it("skips a deleted duplicate", () => {
    const withDeleted = [{ ...rows[1]!, isDeleted: 1 }, rows[0]!];
    expect(pickSharedProjectRow(withDeleted, "o1")?.id).toBe("p-new");
  });

  it("finds nothing when every row is deleted, unless restoring", () => {
    const allDeleted = rows.map((r) => ({ ...r, isDeleted: 1 }));
    expect(pickSharedProjectRow(allDeleted, "o1")).toBeNull();
    expect(pickSharedProjectRow(allDeleted, "o1", { includeDeleted: true })?.id).toBe("p-old");
  });

  it("breaks a createdAt tie by id, so every client picks the same row", () => {
    const tie = [
      { id: "b", ownerId: "o1", createdAt: "2026-01-01T00:00:00Z" },
      { id: "a", ownerId: "o1", createdAt: "2026-01-01T00:00:00Z" },
    ];
    expect(pickSharedProjectRow(tie, "o1")?.id).toBe("a");
  });
});

describe("diffProjectFields (the app's logProjectChanges diff)", () => {
  it("reports real changes and ignores 1 against true", () => {
    const changes = diffProjectFields(
      { name: "Old", code: "OLD", isArchived: 1, color: "#fff" },
      { id: "x", name: "New", code: "OLD", isArchived: true, isDeleted: 1 },
    );
    expect(changes).toEqual([
      { field: "name", oldValue: "Old", newValue: "New" },
      { field: "isDeleted", oldValue: null, newValue: "true" },
    ]);
  });
});
