import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { Schema, ProjectSchema } from "./evolu.js";

/**
 * MCP's schema against the app's, read from the app's own source. (TODO-112)
 *
 * Every round of the MCP audit so far has compared these two by hand, and
 * every round found something: a table the app had added, a column a tool
 * wrote into nowhere. The comparison is mechanical, so it belongs in a test.
 *
 * Round XI found three gaps this way — `shareInvite`, `memberGrant` and
 * `projectMember.inviteProof`, all from the app's TODO-440 — and each of them
 * made a write succeed and then do nothing, which is the failure mode the
 * whole audit exists to catch.
 *
 * The app is a sibling checkout, not a dependency, so this skips where it is
 * absent (CI) and runs where the audit is actually done (a dev machine with
 * both repos). A skipped test says so; it does not pass quietly.
 */
/**
 * Where the app's checkout is, as a sibling of this repository.
 *
 * In a git worktree the sibling of the *worktree* is somewhere under
 * /var/tmp, so the lookup follows `.git` back to the main checkout first.
 * Without that this test would skip in exactly the place the audit is done.
 * `TODOCKO_APP_DIR` overrides both.
 */
function findAppDb(): string {
  const fromEnv = process.env.TODOCKO_APP_DIR;
  if (fromEnv) return resolve(fromEnv, "src/db");
  const repo = resolve(import.meta.dirname, "..");
  const dotGit = resolve(repo, ".git");
  let main = repo;
  if (existsSync(dotGit) && statSync(dotGit).isFile()) {
    const gitdir = readFileSync(dotGit, "utf-8").replace(/^gitdir:\s*/, "").trim();
    const marker = gitdir.lastIndexOf("/.git/");
    if (marker > 0) main = gitdir.slice(0, marker);
  }
  return resolve(main, "../todocko/src/db");
}

const APP_DB = findAppDb();
const haveApp = existsSync(resolve(APP_DB, "appSchema.ts"));

/** The body of the first `{...}` block after `marker`, comments stripped. */
function objectBody(src: string, marker: string): string {
  const open = src.indexOf("{", src.indexOf(marker));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) {
      return src
        .slice(open + 1, i)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
    }
  }
  throw new Error(`Unbalanced braces after ${marker}`);
}

/** Column names of every table in one of the app's schema objects. */
function parseAppSchema(file: string, exportName: string): Record<string, Set<string>> {
  const body = objectBody(readFileSync(resolve(APP_DB, file), "utf-8"), exportName);
  const tables: Record<string, Set<string>> = {};
  for (const match of body.matchAll(/(\w+)\s*:\s*\{/g)) {
    const start = (match.index ?? 0) + match[0].length - 1;
    let depth = 0;
    for (let i = start; i < body.length; i++) {
      if (body[i] === "{") depth++;
      else if (body[i] === "}" && --depth === 0) {
        // Only top-level tables: a nested block is inside one already counted.
        if (!(match[1] in tables) || start > 0) {
          tables[match[1]] = new Set(
            [...body.slice(start + 1, i).matchAll(/(\w+)\s*:/g)].map((m) => m[1]),
          );
        }
        break;
      }
    }
  }
  return tables;
}

function mcpTables(schema: Record<string, unknown>): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  for (const [table, columns] of Object.entries(schema)) {
    out[table] = new Set(Object.keys(columns as Record<string, unknown>));
  }
  return out;
}

/**
 * Columns MCP declares that the app does not, with the reason.
 *
 * `autoApproveMembers` on the personal `project` and `projectRef` is a mistake
 * MCP made and cannot take back: the schema is append-only, so the columns
 * stay. `td_update_project` refuses to write them instead, and the setting is
 * read and written where the app keeps it, on the shared project. (TODO-112)
 */
const MCP_ONLY: Record<string, string[]> = {
  "AppOwner.project": ["autoApproveMembers"],
  "AppOwner.projectRef": ["autoApproveMembers"],
};

describe.skipIf(!haveApp)("MCP schema covers the app's", () => {
  const cases = [
    ["AppOwner", () => parseAppSchema("appSchema.ts", "export const AppOwnerSchema"), mcpTables(Schema)],
    ["Project", () => parseAppSchema("projectSchema.ts", "export const ProjectSchema"), mcpTables(ProjectSchema)],
  ] as const;

  it("parses the app's schema at all, so an empty sweep cannot pass", () => {
    for (const [, parse] of cases) {
      const tables = parse();
      expect(Object.keys(tables).length).toBeGreaterThan(5);
      expect(tables.task?.has("title")).toBe(true);
    }
  });

  for (const [label, parse, mcp] of cases) {
    it(`${label}: has every table the app has`, () => {
      const missing = Object.keys(parse()).filter((table) => !(table in mcp));
      expect(missing).toEqual([]);
    });

    it(`${label}: has every column the app has`, () => {
      const app = parse();
      const missing: string[] = [];
      for (const [table, columns] of Object.entries(app)) {
        if (!(table in mcp)) continue;
        for (const column of columns) if (!mcp[table].has(column)) missing.push(`${table}.${column}`);
      }
      expect(missing.sort()).toEqual([]);
    });

    it(`${label}: declares nothing beyond the app except the recorded mistakes`, () => {
      const app = parse();
      const extra: string[] = [];
      for (const [table, columns] of Object.entries(mcp)) {
        if (!(table in app)) continue;
        const allowed = new Set(MCP_ONLY[`${label}.${table}`] ?? []);
        for (const column of columns) {
          if (!app[table].has(column) && !allowed.has(column)) extra.push(`${table}.${column}`);
        }
      }
      expect(extra.sort()).toEqual([]);
    });
  }
});
