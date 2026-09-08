import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

/**
 * Every write to the shared instance must name the owner (TODO-299).
 *
 * `projectEvolu.insert/update` without `{ ownerId }` does not fail. The row
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

interface Site { line: number; text: string; hasOwnerId: boolean }

/**
 * Read to the end of the call by balancing parentheses rather than scanning a
 * fixed number of lines. A window is what made the first version of this test
 * flag createSharedTask, whose `ownerId` sits 26 lines below the call.
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
      hasOwnerId: /ownerId:\s*(shared)?[Oo]wner\.id/.test(body),
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
        if (!s.hasOwnerId) missing.push(`${file}:${s.line} ${s.text}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("the detector itself", () => {
  it("flags a write with no ownerId", () => {
    const bad = `projectEvolu.insert("projectNote", {\n  title: "x",\n}, { onComplete: waiter.onComplete });`;
    expect(sharedWriteSites(bad)[0]!.hasOwnerId).toBe(false);
  });

  it("accepts a write that has one", () => {
    const good = `projectEvolu.insert("projectNote", {\n  title: "x",\n}, { ownerId: owner.id, onComplete: waiter.onComplete });`;
    expect(sharedWriteSites(good)[0]!.hasOwnerId).toBe(true);
  });

  it("reads past a long argument list, which a fixed window cannot", () => {
    const long = `projectEvolu.insert(\n  "task",\n  {\n${"    f: 1,\n".repeat(40)}  },\n  { ownerId: sharedOwner.id }\n);`;
    expect(sharedWriteSites(long)[0]!.hasOwnerId).toBe(true);
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
