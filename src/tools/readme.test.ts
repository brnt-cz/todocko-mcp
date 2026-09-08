import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tools } from "./index.js";

/**
 * Both README tool tables must list every tool, and only real tools (TODO-303).
 *
 * The README has a Czech table and an English one. Nothing checked either, and
 * the English one drifted 48 tools behind across several releases: at v3.0.0 it
 * listed 104 of 152, including almost the whole shared section. It was found by
 * counting rows by hand before tagging, which is not a method.
 *
 * The heading count is checked too, since that is the part a reader believes
 * without scrolling. It said 143 while the table held 141.
 */

const README = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "README.md"),
  "utf8",
);

const ROW = /^\| `(td_[a-z_]+)`/gm;

/**
 * The English half starts at its own heading; everything above it is Czech.
 * Splitting on the heading rather than on a line number keeps this working
 * when either table grows.
 */
function halves(): { czech: string; english: string; heading: string } {
  const marker = README.indexOf("## Available Tools");
  expect(marker).toBeGreaterThan(-1);
  const after = README.slice(marker);
  const next = after.indexOf("\n## ", 1);
  return {
    czech: README.slice(0, marker),
    english: next === -1 ? after : after.slice(0, next),
    heading: after.slice(0, after.indexOf("\n")),
  };
}

function listed(section: string): Set<string> {
  return new Set([...section.matchAll(ROW)].map((m) => m[1]!));
}

describe("README tool tables", () => {
  const names = new Set(tools.map((t) => t.name));
  const { czech, english, heading } = halves();

  it("finds both tables, so an empty comparison cannot pass", () => {
    expect(listed(czech).size).toBeGreaterThan(100);
    expect(listed(english).size).toBeGreaterThan(100);
  });

  for (const [label, section] of [["Czech", czech], ["English", english]] as const) {
    it(`the ${label} table lists every tool`, () => {
      const rows = listed(section);
      expect([...names].filter((n) => !rows.has(n)).sort()).toEqual([]);
    });

    it(`the ${label} table lists nothing that is not a tool`, () => {
      const rows = listed(section);
      expect([...rows].filter((n) => !names.has(n)).sort()).toEqual([]);
    });
  }

  it("the English heading states the real number", () => {
    const stated = /## Available Tools \((\d+)\)/.exec(heading)?.[1];
    expect(stated).toBe(String(names.size));
  });

  it("the Czech heading states the real number", () => {
    const stated = /## Dostupné nástroje \((\d+)\)/.exec(czech)?.[1];
    expect(stated).toBe(String(names.size));
  });
});
