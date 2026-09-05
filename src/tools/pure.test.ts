import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { assertMutation, resolveUploadPath, relayHttpBase, assertRequiredArgs, assertRowExists } from "./pure.js";

/**
 * These guard the v7 -> v8 change in what a mutation returns (TODO-88).
 *
 * v7 gave back a `Result`, so this helper asserted `result.ok`. v8 returns the
 * row as `{ id }` and raises on an invalid change, so `ok` is absent — the
 * assertion then failed on every successful write, and 40-odd call sites
 * across the tools reported "failed" for changes they had just applied.
 */
describe("assertMutation", () => {
  it("accepts what v8 actually returns", () => {
    expect(() => assertMutation("insert", { id: "ctl8XKoIV189fSIai4EjAQ" })).not.toThrow();
  });

  it("does not require an `ok` field, which v8 never sets", () => {
    // The exact shape that used to throw. If this test fails, every update and
    // delete tool is reporting failure for a write that went through.
    expect(() => assertMutation("update", { id: "abc" } as { id: string; ok?: boolean })).not.toThrow();
  });

  it("still catches a mutation that came back without a row id", () => {
    expect(() => assertMutation("update", {})).toThrow(/no row id/);
    expect(() => assertMutation("update", { id: "" })).toThrow(/no row id/);
    expect(() => assertMutation("update", { id: 42 })).toThrow(/no row id/);
  });

  it("names the operation in the message, so the caller knows which write", () => {
    expect(() => assertMutation("deleteChecklistItem", {})).toThrow(/deleteChecklistItem/);
  });
});

describe("resolveUploadPath (TODO-286)", () => {
  const base = "/tmp/todocko-upload-test";

  beforeEach(() => {
    process.env.TODOCKO_UPLOAD_DIR = base;
  });

  afterEach(() => {
    delete process.env.TODOCKO_UPLOAD_DIR;
    delete process.env.TODOCKO_DOWNLOAD_DIR;
  });

  it("accepts a relative path inside the base", () => {
    expect(resolveUploadPath("shot.png")).toBe(`${base}/shot.png`);
    expect(resolveUploadPath("sub/shot.png")).toBe(`${base}/sub/shot.png`);
  });

  it("refuses an absolute path outside the base", () => {
    expect(() => resolveUploadPath("/etc/passwd")).toThrow(/escapes/);
    expect(() => resolveUploadPath("/home/someone/.ssh/id_ed25519")).toThrow(/escapes/);
  });

  it("refuses a traversal escape", () => {
    expect(() => resolveUploadPath("../secrets.txt")).toThrow(/escapes/);
    expect(() => resolveUploadPath("sub/../../secrets.txt")).toThrow(/escapes/);
  });

  it("refuses a sibling directory that merely shares the prefix", () => {
    process.env.TODOCKO_UPLOAD_DIR = "/tmp/uploads";
    expect(() => resolveUploadPath("../uploads-evil/x.png")).toThrow(/escapes/);
  });

  it("refuses a dotfile even inside the base", () => {
    // The attacks worth caring about name a dotfile: .env, .npmrc, .git/config.
    expect(() => resolveUploadPath(".env")).toThrow(/dotfile/);
    expect(() => resolveUploadPath("sub/.npmrc")).toThrow(/dotfile/);
    expect(() => resolveUploadPath(".git/config")).toThrow(/dotfile/);
  });

  it("falls back to the download directory when no upload directory is set", () => {
    delete process.env.TODOCKO_UPLOAD_DIR;
    process.env.TODOCKO_DOWNLOAD_DIR = "/tmp/todocko-dl";
    expect(resolveUploadPath("a.png")).toBe("/tmp/todocko-dl/a.png");
  });
});

describe("relayHttpBase (TODO-288)", () => {
  it("keeps an https URL as it is", () => {
    expect(relayHttpBase("https://relay.todocko.cz")).toBe("https://relay.todocko.cz");
  });

  it("converts the websocket schemes the sync layer accepts", () => {
    // TODOCKO_RELAY_URL may hold wss:// (TODO-266). fetch() throws on it, which
    // surfaced as "fetch failed" in two tools and as a swallowed null in the
    // tier check - read as "not on the free plan".
    expect(relayHttpBase("wss://relay.todocko.cz")).toBe("https://relay.todocko.cz");
    expect(relayHttpBase("ws://localhost")).toBe("http://localhost");
  });

  it("strips the container ports, which are not reachable behind the proxy", () => {
    expect(relayHttpBase("https://relay.todocko.cz:4000")).toBe("https://relay.todocko.cz");
    expect(relayHttpBase("wss://relay.todocko.cz:4001/")).toBe("https://relay.todocko.cz");
  });

  it("strips a trailing slash so paths do not double up", () => {
    expect(relayHttpBase("https://relay.todocko.cz/")).toBe("https://relay.todocko.cz");
  });

  it("falls back to production when the variable is unset or blank", () => {
    expect(relayHttpBase(undefined)).toBe("https://relay.todocko.cz");
    expect(relayHttpBase("")).toBe("https://relay.todocko.cz");
  });

  it("leaves a port that is not a container port alone", () => {
    expect(relayHttpBase("http://localhost:5173")).toBe("http://localhost:5173");
  });
})

describe("assertRequiredArgs (TODO-292)", () => {
  const schema = {
    required: ["id"],
    properties: { id: {}, name: {}, status: {} },
  };

  it("passes a call that supplies the required argument", () => {
    expect(() => assertRequiredArgs("td_update_task", { id: "abc", status: "done" }, schema)).not.toThrow();
  });

  it("rejects the mistake that started this: taskId where id was wanted", () => {
    // The real call. It used to return success and create an empty task row,
    // because Evolu turns an unknown id into an insert.
    expect(() => assertRequiredArgs("td_update_task", { taskId: "abc", status: "done" }, schema))
      .toThrow(/missing required argument\(s\): id/);
  });

  it("names the stray argument, since the failure is usually a near-miss", () => {
    let message = "";
    try {
      assertRequiredArgs("td_update_task", { taskId: "abc" }, schema);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("Unrecognised argument(s): taskId");
    expect(message).toContain("Accepted arguments: id, name, status");
  });

  it("treats undefined, null and empty string as absent", () => {
    for (const value of [undefined, null, ""]) {
      expect(() => assertRequiredArgs("t", { id: value }, schema)).toThrow(/missing required/);
    }
  });

  it("accepts 0 and false, which are present values", () => {
    const numeric = { required: ["durationMinutes"], properties: { durationMinutes: {} } };
    expect(() => assertRequiredArgs("td_add_worklog", { durationMinutes: 0 }, numeric)).not.toThrow();
    const flag = { required: ["isDeleted"], properties: { isDeleted: {} } };
    expect(() => assertRequiredArgs("t", { isDeleted: false }, flag)).not.toThrow();
  });

  it("does nothing for a tool that requires nothing", () => {
    expect(() => assertRequiredArgs("td_list_projects", {}, { properties: {} })).not.toThrow();
    expect(() => assertRequiredArgs("td_list_projects", {}, undefined)).not.toThrow();
  });

  it("reports every missing argument at once, not just the first", () => {
    const multi = { required: ["sharedOwnerId", "ownerSecret", "id"], properties: { sharedOwnerId: {}, ownerSecret: {}, id: {} } };
    expect(() => assertRequiredArgs("td_update_shared_task", { id: "x" }, multi))
      .toThrow(/sharedOwnerId, ownerSecret/);
  });
});

describe("assertRowExists (TODO-292)", () => {
  /** Records the query the guard built, and answers with the given rows. */
  function fakeEvolu(rows: unknown[]) {
    const built: { table?: string; wheres: [string, string, unknown][] } = { wheres: [] };
    const db = {
      selectFrom(table: string) {
        built.table = table;
        return db;
      },
      select() {
        return db;
      },
      where(column: string, op: string, value: unknown) {
        built.wheres.push([column, op, value]);
        return db;
      },
      limit() {
        return db;
      },
    };
    return {
      built,
      evolu: {
        createQuery: (build: (d: unknown) => unknown) => build(db),
        loadQuery: async () => rows,
      },
    };
  }

  it("passes when the row is there", async () => {
    const { evolu } = fakeEvolu([{ id: "t1" }]);
    await expect(assertRowExists(evolu, "task", "t1", "Task")).resolves.toBeUndefined();
  });

  it("throws instead of letting Evolu insert a new row", async () => {
    const { evolu } = fakeEvolu([]);
    await expect(assertRowExists(evolu, "task", "ghost", "Task")).rejects.toThrow("Task not found: ghost");
  });

  it("does not filter on isDeleted, or restoring from the trash would fail", async () => {
    // td_update_task(isDeleted: false) is how a task comes back; a guard that
    // skipped deleted rows would refuse exactly that call.
    const { built, evolu } = fakeEvolu([{ id: "t1" }]);
    await assertRowExists(evolu, "task", "t1", "Task");
    expect(built.wheres.map((w) => w[0])).toEqual(["id"]);
  });

  it("scopes by owner for shared data, where one instance holds every project", async () => {
    const { built, evolu } = fakeEvolu([{ id: "t1" }]);
    await assertRowExists(evolu, "task", "t1", "Task", "owner-9");
    expect(built.table).toBe("task");
    expect(built.wheres).toEqual([
      ["id", "=", "t1"],
      ["ownerId", "=", "owner-9"],
    ]);
  });
});
