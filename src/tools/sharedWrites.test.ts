import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

/**
 * Every write to the shared instance must name the owner (TODO-299).
 *
 * Since Evolu 8.20.3 the option is `{ owner }`, the whole SharedOwner with its
 * write key (TODO-427). A leftover `{ ownerId }` is ignored the same way a
 * missing one is, so the old shape counts as missing here.
 *
 * `projectEvolu.insert/update` without `{ owner }` does not fail. The row
 * lands under the shared instance's own throwaway owner, where no relay
 * subscription reaches it and every list query filters it out, and the tool
 * still answers `success`. That is how shared project notes and documents were
 * silently discarded across six call sites while tsc stayed green.
 *
 * A source-level check because there is no way to unit test this: the failure
 * only shows up against a live Evolu instance, and the wrong calls looked
 * exactly like the right ones.
 */

const toolsDir = dirname(fileURLToPath(import.meta.url));

interface Site { line: number; text: string; hasOwner: boolean }

/**
 * Read to the end of the call by balancing parentheses rather than scanning a
 * fixed number of lines. A window is what made the first version of this test
 * flag createSharedTask, whose `owner` sits 26 lines below the call.
 */
function sharedWriteSites(source: string): Site[] {
  const lines = source.split("\n");
  const sites: Site[] = [];
  for (let i = 0; i < lines.length; i++) {
    const start = lines[i]!.search(/projectEvolu\.(insert|update)\(/);
    if (start < 0) continue;
    let depth = 0, started = false, body = "";
    for (let j = i; j < lines.length && j < i + 80; j++) {
      const line = lines[j]!;
      for (const ch of j === i ? line.slice(start) : line) {
        if (ch === "(") { depth++; started = true; }
        else if (ch === ")") depth--;
        body += ch;
        if (started && depth === 0) break;
      }
      body += "\n";
      if (started && depth === 0) break;
    }
    sites.push({
      line: i + 1,
      text: lines[i]!.trim(),
      hasOwner: /\bowner:\s*(shared)?[Oo]wner\b(?!\.)/.test(body),
    });
  }
  return sites;
}

const sourceFiles = readdirSync(toolsDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

// The compiled copy under dist/ is picked up by vitest too and holds .js, not
// .ts. Skipping there keeps this from failing for the wrong reason.
describe.skipIf(sourceFiles.length === 0)("writes to the shared instance", () => {
  it("finds the call sites at all, so a silent zero cannot pass", () => {
    const total = sourceFiles.reduce(
      (n, f) => n + sharedWriteSites(readFileSync(join(toolsDir, f), "utf8")).length,
      0,
    );
    expect(total).toBeGreaterThan(30);
  });

  it("every projectEvolu write names the owner", () => {
    const missing: string[] = [];
    for (const file of sourceFiles) {
      for (const s of sharedWriteSites(readFileSync(join(toolsDir, file), "utf8"))) {
        if (!s.hasOwner) missing.push(`${file}:${s.line} ${s.text}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("the detector itself", () => {
  it("flags a write with no owner", () => {
    const bad = `projectEvolu.insert("projectNote", {\n  title: "x",\n}, { onComplete: waiter.onComplete });`;
    expect(sharedWriteSites(bad)[0]!.hasOwner).toBe(false);
  });

  it("flags the pre-8.20.3 ownerId, which Evolu now ignores", () => {
    const old = `projectEvolu.insert("projectNote", {\n  title: "x",\n}, { ownerId: owner.id, onComplete: waiter.onComplete });`;
    expect(sharedWriteSites(old)[0]!.hasOwner).toBe(false);
  });

  it("accepts a write that has one", () => {
    const good = `projectEvolu.insert("projectNote", {\n  title: "x",\n}, { owner: owner, onComplete: waiter.onComplete });`;
    expect(sharedWriteSites(good)[0]!.hasOwner).toBe(true);
  });

  it("reads past a long argument list, which a fixed window cannot", () => {
    const long = `projectEvolu.insert(\n  "task",\n  {\n${"    f: 1,\n".repeat(40)}  },\n  { owner: sharedOwner }\n);`;
    expect(sharedWriteSites(long)[0]!.hasOwner).toBe(true);
  });
});

/**
 * Every tool that writes a child of a task must check the task first (TODO-300).
 *
 * Without it the row is written against an id nothing resolves. Every listing
 * goes through taskId, so it is never read back, and the tool answers
 * `success` with an id. Measured before the fix: one orphan row in taskComment
 * and one in checklistItem from two calls with a made-up task id, while
 * td_add_worklog refused the same call with "Task not found".
 *
 * Source-level for the same reason as the owner check above: three tools
 * behaved three different ways and all of them compiled.
 */
describe("tools that write a child of a task", () => {
  const CHILD_WRITERS = [
    ["checklistItems.ts", "createChecklistItem"],
    ["taskComments.ts", "createTaskComment"],
    ["worklogs.ts", "addWorklog"],
    ["attachments.ts", "uploadAttachment"],
    ["shared.ts", "createSharedChecklistItem"],
    ["shared.ts", "createSharedTaskComment"],
    ["shared.ts", "addSharedWorklog"],
    ["shared.ts", "uploadSharedAttachment"],
  ] as const;

  /** The body of one top-level `async function name(` declaration. */
  function bodyOf(file: string, fn: string): string {
    const source = readFileSync(join(toolsDir, file), "utf8");
    const start = source.indexOf(`async function ${fn}(`);
    expect(start, `${file} declares ${fn}`).toBeGreaterThan(-1);
    const end = source.indexOf("\n}\n", start);
    return source.slice(start, end === -1 ? undefined : end);
  }

  for (const [file, fn] of CHILD_WRITERS) {
    it(`${fn} refuses a task that is not there`, () => {
      const body = bodyOf(file, fn);
      // Either the shared helper, or the hand-rolled query the older tools use.
      const guarded =
        /assertRowExists\([^)]*"task"/.test(body) ||
        /selectFrom\("task"\)[\s\S]{0,400}?(Task not found|not found)/.test(body);
      expect(guarded, `${file}:${fn} writes a child without checking the task`).toBe(true);
    });
  }

  it("the detector notices an unguarded body", () => {
    const unguarded = `async function createThing(args) {\n  evolu.insert("taskComment", { taskId: args.taskId });\n}`;
    expect(/assertRowExists\([^)]*"task"/.test(unguarded)).toBe(false);
  });
});

/**
 * Every shared write goes through the permission gate (TODO-434).
 *
 * The shared tools used to open the owner with `getSharedOwner` directly, which
 * checks only that the secret fits the id. A member with read-only access
 * could then edit tasks, delete the project or change members through this
 * server while the app refused the same. `resolveSharedOwner(args, access)`
 * reads the user's projectRef and applies the app's rules; this keeps a new
 * tool from going round it, the same way the owner check above keeps a new
 * write from forgetting `{ owner }`.
 */
describe("shared writes pass the permission gate", () => {
  const GATED_FILES = ["shared.ts", "projectNotes.ts", "projectDocs.ts"];

  /** Every top-level `async function`, with its body. */
  function functionsOf(file: string): { name: string; body: string }[] {
    const source = readFileSync(join(toolsDir, file), "utf8");
    const found: { name: string; body: string }[] = [];
    const re = /^(?:export )?async function (\w+)\(/gm;
    for (let m = re.exec(source); m; m = re.exec(source)) {
      const end = source.indexOf("\n}\n", m.index);
      found.push({ name: m[1]!, body: source.slice(m.index, end === -1 ? undefined : end) });
    }
    return found;
  }

  const WRITES = /projectEvolu\.(insert|update)\(/;
  // bulkDeleteSharedTasks writes through deleteSharedTask.
  const DELEGATES = /\bdeleteSharedTask\(\{/;
  const GATE = /resolveSharedOwner\(args, "(read|write|admin)"\)/;

  const writers = GATED_FILES.flatMap((file) =>
    functionsOf(file)
      .filter((f) => WRITES.test(f.body) || DELEGATES.test(f.body))
      .map((f) => ({ file, ...f })),
  );

  it("finds the write functions at all", () => {
    // 39 when this was written: 32 in shared.ts, three each for notes and docs.
    expect(writers.length).toBeGreaterThanOrEqual(39);
  });

  it("every one of them asks for write or admin access", () => {
    const ungated = writers
      .filter((w) => {
        const access = GATE.exec(w.body)?.[1];
        return access !== "write" && access !== "admin";
      })
      .map((w) => `${w.file}:${w.name}`);
    expect(ungated).toEqual([]);
  });

  /**
   * What the app reserves for the owner or an admin: project settings and its
   * deletion, the deployment tab (stages and repository links), tag
   * management and members (Modal.vue's tab gates, ProjectsView's handlers).
   * Assigning a tag to a task only needs write, as in the app's context menu.
   */
  const ADMIN_ONLY = [
    "updateSharedProject",
    "updateSharedMember",
    "createSharedDeploymentStage",
    "updateSharedDeploymentStage",
    "deleteSharedDeploymentStage",
    "createSharedRepositoryLink",
    "updateSharedRepositoryLink",
    "deleteSharedRepositoryLink",
    "createSharedTag",
    "updateSharedTag",
    "deleteSharedTag",
  ];

  for (const name of ADMIN_ONLY) {
    it(`${name} requires admin`, () => {
      const w = writers.find((x) => x.name === name);
      expect(w, `${name} is a shared write`).toBeDefined();
      expect(GATE.exec(w!.body)?.[1]).toBe("admin");
    });
  }

  it("no tool opens a shared owner without the gate", () => {
    // withAllSharedOwners opens every joined project for the read-only
    // analytics; it never writes, so it may derive owners itself.
    const allowed = new Set(["shared.ts:withAllSharedOwners"]);
    const direct: string[] = [];
    for (const file of sourceFiles.filter((f) => f !== "sharedAccess.ts")) {
      for (const f of functionsOf(file)) {
        if (/\bgetSharedOwner\(/.test(f.body) && !allowed.has(`${file}:${f.name}`)) direct.push(`${file}:${f.name}`);
      }
    }
    expect(direct).toEqual([]);
  });

  it("every shared delete checks the row exists first (S18)", () => {
    const deletes = writers.filter((w) => /^deleteShared/.test(w.name));
    expect(deletes.length).toBeGreaterThanOrEqual(11);
    const unchecked = deletes.filter((w) => !/assertRowExists\(/.test(w.body)).map((w) => `${w.file}:${w.name}`);
    expect(unchecked).toEqual([]);
  });

  it("the detector notices a write that skips the gate", () => {
    const bad = `async function sneaky(args) {\n  const o = getSharedOwner(args.sharedOwnerId, args.ownerSecret);\n  projectEvolu.update("task", {}, { owner: o });\n}`;
    expect(WRITES.test(bad)).toBe(true);
    expect(GATE.test(bad)).toBe(false);
  });
});
