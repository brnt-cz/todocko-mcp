import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * No write may have its result thrown away. (TODO-112)
 *
 * `evolu.update` and friends answer whether the row was written. Round XI
 * found 25 places that bound the answer to `result` and never looked at it,
 * 22 of them in the shared tools, including `updateSharedTask`,
 * `updateSharedProject` and `updateSharedMember`. Those three then logged the
 * change into the activity feed and returned `success: true` for a write that
 * might never have happened - the same shape the app fixed in its TODO-442.
 *
 * `assertMutation` and the convention already existed; these sites had simply
 * fallen out of it, quietly, one at a time. Hence a test rather than a
 * re-reading: a new one fails here instead of waiting for the next audit.
 *
 * Binding the result and using it afterwards is fine - an insert whose id the
 * caller needs is the usual case.
 */
const TOOLS_DIR = import.meta.dirname;
const MUTATION = /const\s+result\s*=\s*\w+\.(update|insert|upsert)\(/;

function sources(): { file: string; text: string }[] {
  return readdirSync(TOOLS_DIR)
    .filter((name) => name.endsWith(".ts") && !name.includes(".test."))
    .map((file) => ({ file, text: readFileSync(resolve(TOOLS_DIR, file), "utf-8") }));
}

/** Writes whose answer is bound to `result` and then never read. */
function dropped(): string[] {
  const out: string[] = [];
  for (const { file, text } of sources()) {
    const lines = text.split("\n");
    lines.forEach((line, index) => {
      if (!MUTATION.test(line)) return;
      // Everything up to the next write or the end of the function: a long
      // insert can be thirty lines of columns before its id is used.
      const rest = lines.slice(index + 1);
      const stop = rest.findIndex((l) => /const\s+result\s*=/.test(l) || l === "}");
      const after = (stop === -1 ? rest : rest.slice(0, stop)).join("\n");
      if (!/\bresult\b/.test(after)) out.push(`${file}:${index + 1}`);
    });
  }
  return out;
}

describe("every write checks whether it wrote", () => {
  it("reads the tool sources at all, so an empty sweep cannot pass", () => {
    const files = sources();
    expect(files.length).toBeGreaterThan(20);
    expect(files.some(({ text }) => text.includes("assertMutation("))).toBe(true);
  });

  it("leaves no mutation result unread", () => {
    expect(dropped()).toEqual([]);
  });
});
