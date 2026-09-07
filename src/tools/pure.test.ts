import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { assertMutation, resolveUploadPath, relayHttpBase, assertRequiredArgs, assertRowExists, judgeSyncFreshness } from "./pure.js";

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
    // Wording changed in TODO-297, when the stray became a rejection in its own
    // right rather than a hint appended to a missing-argument error. The point
    // of the test is unchanged: the near-miss has to be named.
    expect(message).toContain("unrecognised argument(s): taskId");
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

describe("judgeSyncFreshness (TODO-294)", () => {
  const T = 1_700_000_000_000;

  it("calls it stale when a local write has been waiting with nothing sent", () => {
    // The incident: MCP wrote locally, nothing left the process for an hour,
    // and the old status still said ok.
    const f = judgeSyncFreshness({
      lastOutgoingAt: T - 60 * 60 * 1000,
      lastIncomingAt: T - 60 * 60 * 1000,
      lastLocalMutationAt: T - 55 * 60 * 1000,
      now: T,
    });
    expect(f.verdict).toBe("stale");
    expect(f.pendingForMs).toBe(55 * 60 * 1000);
    expect(f.reason).toContain("ceka");
  });

  it("is stale when nothing has ever been sent but something was written", () => {
    const f = judgeSyncFreshness({
      lastOutgoingAt: null,
      lastIncomingAt: null,
      lastLocalMutationAt: T - 5 * 60 * 1000,
      now: T,
    });
    expect(f.verdict).toBe("stale");
    expect(f.reason).toContain("zadny ramec");
  });

  it("does not blame silence when nothing is waiting - that is idleness", () => {
    // Quiet with no pending write is the normal state of a tool nobody is
    // using. Reporting that as a fault would make the status unreadable.
    const f = judgeSyncFreshness({
      lastOutgoingAt: T - 3 * 60 * 60 * 1000,
      lastIncomingAt: T - 3 * 60 * 60 * 1000,
      lastLocalMutationAt: T - 4 * 60 * 60 * 1000,
      now: T,
    });
    expect(f.verdict).toBe("idle");
  });

  it("accepts a write that is younger than the threshold", () => {
    const f = judgeSyncFreshness({
      lastOutgoingAt: T - 90_000,
      lastIncomingAt: null,
      lastLocalMutationAt: T - 5_000,
      now: T,
    });
    expect(f.verdict).toBe("ok");
  });

  it("is ok when the write went out after it happened", () => {
    const f = judgeSyncFreshness({
      lastOutgoingAt: T - 1_000,
      lastIncomingAt: T - 900,
      lastLocalMutationAt: T - 2_000,
      now: T,
    });
    expect(f.verdict).toBe("ok");
    expect(f.pendingForMs).toBeNull();
  });

  it("reports never-synced on a fresh process that has done nothing", () => {
    const f = judgeSyncFreshness({
      lastOutgoingAt: null, lastIncomingAt: null, lastLocalMutationAt: null, now: T,
    });
    expect(f.verdict).toBe("never-synced");
  });

  it("counts an incoming frame as traffic, not just outgoing", () => {
    const f = judgeSyncFreshness({
      lastOutgoingAt: T - 3 * 60 * 60 * 1000,
      lastIncomingAt: T - 1_000,
      lastLocalMutationAt: null,
      now: T,
    });
    expect(f.verdict).toBe("ok");
    expect(f.quietForMs).toBe(1_000);
  });

  it("honours a caller-supplied threshold", () => {
    const input = {
      lastOutgoingAt: T - 30_000, lastIncomingAt: null,
      lastLocalMutationAt: T - 20_000, now: T,
    };
    expect(judgeSyncFreshness(input).verdict).toBe("ok");
    expect(judgeSyncFreshness({ ...input, staleAfterMs: 10_000 }).verdict).toBe("stale");
  });
});

describe("assertRequiredArgs rejects more than a missing id (TODO-297)", () => {
  const schema = {
    properties: {
      projectId: { type: "string" },
      name: { type: "string" },
      status: { type: "string", enum: ["backlog", "todo", "done", "recurring"] },
    },
    required: ["projectId"],
  };

  // An undeclared argument used to be mentioned only when something required
  // was ALSO missing, and otherwise dropped without a word. That is how
  // `isChecked` on the shared checklist tool returned success and wrote an
  // unticked item.
  it("refuses an argument the schema does not declare", () => {
    expect(() => assertRequiredArgs("td_demo", { projectId: "p", isChecked: true }, schema))
      .toThrow(/unrecognised argument\(s\): isChecked/);
  });

  it("refuses a value outside a declared enum, and says what was expected", () => {
    expect(() => assertRequiredArgs("td_demo", { projectId: "p", status: "quarterly" }, schema))
      .toThrow(/invalid value\(s\): status="quarterly".*backlog, todo, done, recurring/);
  });

  it("accepts recurring, which the app treats as a real status", () => {
    expect(() => assertRequiredArgs("td_demo", { projectId: "p", status: "recurring" }, schema))
      .not.toThrow();
  });

  it("leaves an omitted or null optional alone", () => {
    expect(() => assertRequiredArgs("td_demo", { projectId: "p" }, schema)).not.toThrow();
    expect(() => assertRequiredArgs("td_demo", { projectId: "p", status: null }, schema)).not.toThrow();
  });

  it("reports every problem at once rather than one per round trip", () => {
    let message = "";
    try {
      assertRequiredArgs("td_demo", { status: "nope", stray: 1 }, schema);
    } catch (e) {
      message = String((e as Error).message);
    }
    expect(message).toContain("missing required argument(s): projectId");
    expect(message).toContain("unrecognised argument(s): stray");
    expect(message).toContain('invalid value(s): status="nope"');
  });

  it("says nothing when the call is clean", () => {
    expect(() => assertRequiredArgs("td_demo", { projectId: "p", name: "x", status: "done" }, schema))
      .not.toThrow();
  });
});
