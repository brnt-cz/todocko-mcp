import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `todo list` and `todo today` at the seam that actually matters (TODO-473).
 *
 * The selection logic is pure and tested in `select.test.ts`. What is left
 * here is the part that cannot be seen by reading it: which tools get called,
 * with what limit, and whether shared projects make it into the result. All
 * three have a failure mode that looks like success, namely a shorter list.
 *
 * Mocked at `tools/index.js`, the boundary towards Evolu. Importing the real
 * one would initialise the database at module load.
 */
const calls: { name: string; args: Record<string, unknown> }[] = [];
let responses: Record<string, unknown> = {};
let failSharedTasks = false;

vi.mock("../../tools/index.js", () => ({
  handleToolCall: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === "td_list_shared_tasks" && failSharedTasks) {
      throw new Error("relay unreachable");
    }
    return responses[name] ?? {};
  },
}));

const { cmdList, cmdToday } = await import("./list.js");

const evolu = {} as never;

function out(): { stdout: string; stderr: string; restore: () => void } {
  let stdout = "";
  let stderr = "";
  const o = process.stdout.write.bind(process.stdout);
  const e = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((s: string) => { stdout += s; return true; }) as typeof process.stdout.write;
  process.stderr.write = ((s: string) => { stderr += s; return true; }) as typeof process.stderr.write;
  return {
    get stdout() { return stdout; },
    get stderr() { return stderr; },
    restore: () => { process.stdout.write = o; process.stderr.write = e; },
  } as { stdout: string; stderr: string; restore: () => void };
}

function task(code: string, extra: Record<string, unknown> = {}) {
  return { id: code, code, name: code, status: "todo", priority: "medium", deadline: null, scheduledDate: null, project: { code: code.split("-")[0] }, ...extra };
}

beforeEach(() => {
  calls.length = 0;
  failSharedTasks = false;
  responses = {
    td_list_tasks: { tasks: [task("TODO-1")] },
    td_list_shared_projects: { projects: [{ sharedOwnerId: "own-1", code: "SH" }] },
    td_list_shared_tasks: { tasks: [task("SH-1")] },
  };
});

describe("cmdList", () => {
  it("includes shared projects, not just the personal instance", async () => {
    const cap = out();
    try {
      expect(await cmdList(evolu, {}, true)).toBe(0);
    } finally {
      cap.restore();
    }
    const payload = JSON.parse(cap.stdout) as { tasks: { code: string; shared: boolean }[] };
    expect(payload.tasks.map((t) => t.code).sort()).toEqual(["SH-1", "TODO-1"]);
    expect(payload.tasks.find((t) => t.code === "SH-1")!.shared).toBe(true);
  });

  it("asks for far more rows than it shows, because the limit is applied in SQL", async () => {
    const cap = out();
    try {
      await cmdList(evolu, { limit: "1" }, true);
    } finally {
      cap.restore();
    }
    const personal = calls.find((c) => c.name === "td_list_tasks")!;
    expect(personal.args.limit).toBeGreaterThanOrEqual(500);
  });

  it("skips shared projects entirely with --no-shared", async () => {
    const cap = out();
    try {
      await cmdList(evolu, { shared: false }, true);
    } finally {
      cap.restore();
    }
    expect(calls.map((c) => c.name)).not.toContain("td_list_shared_projects");
  });

  it("reports an unreachable shared project instead of quietly shortening the list", async () => {
    failSharedTasks = true;
    const cap = out();
    try {
      expect(await cmdList(evolu, {}, false)).toBe(0);
    } finally {
      cap.restore();
    }
    expect(cap.stderr).toContain("SH");
    expect(cap.stdout).toContain("TODO-1");
  });

  it("passes an explicit status down to the query", async () => {
    const cap = out();
    try {
      await cmdList(evolu, { status: "done" }, true);
    } finally {
      cap.restore();
    }
    expect(calls.find((c) => c.name === "td_list_tasks")!.args.status).toBe("done");
  });

  it("refuses a limit that is not a positive number", async () => {
    const cap = out();
    try {
      expect(await cmdList(evolu, { limit: "abc" }, true)).toBe(1);
    } finally {
      cap.restore();
    }
  });
});

describe("cmdToday", () => {
  it("says why a task is on the list", async () => {
    responses.td_list_tasks = { tasks: [task("TODO-1", { deadline: "2020-01-01" })] };
    responses.td_list_shared_tasks = { tasks: [] };
    const cap = out();
    try {
      await cmdToday(evolu, {}, false);
    } finally {
      cap.restore();
    }
    expect(cap.stdout).toContain("po termínu");
  });

  it("prints a plain line rather than an empty table when there is nothing", async () => {
    responses.td_list_tasks = { tasks: [task("TODO-1", { deadline: "2099-01-01" })] };
    responses.td_list_shared_tasks = { tasks: [] };
    const cap = out();
    try {
      await cmdToday(evolu, {}, false);
    } finally {
      cap.restore();
    }
    expect(cap.stdout).toContain("Na dnešek nic.");
  });
});
