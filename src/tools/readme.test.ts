import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { allTools } from "./index.js";

/**
 * Both README tool tables must list every tool, and only real tools (TODO-303).
 *
 * The README has an English table and a Czech one. Nothing checked either, and
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

/** The one heading that opens the Czech half. English is everything before it. */
const CZECH_HEADING = "\n# Česky";

/**
 * Split on the language heading, not on the tool table (TODO-471).
 *
 * This used to look for `## Available Tools` and call everything above it
 * Czech, which silently encoded that Czech came first. npm shows the README as
 * the whole package page, so English moved to the top and the old split started
 * comparing the English preamble against the English table: a pass that proved
 * nothing. The language heading is the thing actually being asked about.
 */
function halves(): { czech: string; english: string } {
  const marker = README.indexOf(CZECH_HEADING);
  expect(marker).toBeGreaterThan(-1);
  return { english: README.slice(0, marker), czech: README.slice(marker) };
}

function listed(section: string): Set<string> {
  return new Set([...section.matchAll(ROW)].map((m) => m[1]!));
}

describe("README tool tables", () => {
  // The catalogue, not this machine's registration: the admin notification
  // tools are documented but only offered with TODOCKO_RELAY_ADMIN_KEY.
  // (TODO-441)
  const names = new Set(allTools.map((t) => t.name));
  const { czech, english } = halves();

  it("finds both tables, so an empty comparison cannot pass", () => {
    expect(listed(english).size).toBeGreaterThan(100);
    expect(listed(czech).size).toBeGreaterThan(100);
  });

  // The package page on npm opens with whatever comes first, and its readers
  // are not Czech speakers. Nothing but this test holds that order.
  it("opens in English", () => {
    const first = README.indexOf("## Available Tools");
    const second = README.indexOf("## Dostupné nástroje");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(-1);
    expect(first).toBeLessThan(second);
  });

  for (const [label, section] of [["English", english], ["Czech", czech]] as const) {
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
    const stated = /## Available Tools \((\d+)\)/.exec(english)?.[1];
    expect(stated).toBe(String(names.size));
  });

  it("the Czech heading states the real number", () => {
    const stated = /## Dostupné nástroje \((\d+)\)/.exec(czech)?.[1];
    expect(stated).toBe(String(names.size));
  });
});
