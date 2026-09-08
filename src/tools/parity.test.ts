import { describe, it, expect } from "vitest";
import { tools } from "./index.js";

/**
 * Personal and shared tools must accept the same arguments (TODO-297).
 *
 * The MCP IX audit compared tool NAMES: for every personal tool it looked for a
 * shared counterpart. That is not enough. td_create_checklist_item and
 * td_create_shared_checklist_item both existed, and only the personal one took
 * `isChecked`; the shared one hardcoded null and did not declare the argument,
 * so passing it was dropped in silence and the item came back unticked.
 *
 * Comparing the argument sets is the check that would have found it.
 */

type Props = Record<string, unknown>;

const byName = new Map(tools.map((t) => [t.name, t]));

function propsOf(name: string): Set<string> {
  const schema = byName.get(name)?.inputSchema as { properties?: Props } | undefined;
  return new Set(Object.keys(schema?.properties ?? {}));
}

/** Arguments that exist only because a shared tool has to name its owner. */
const SHARED_ONLY = new Set(["sharedOwnerId", "ownerSecret"]);

/**
 * Divergences that are correct, with the reason.
 *
 * A shared owner holds exactly one project, so anything that exists to pick a
 * project among many has nothing to do on the shared side.
 */
const BY_DESIGN: Record<string, string[]> = {
  "td_list_deployment_stages": ["projectId"],
  "td_list_tags": ["projectId"],
  "td_update_tag": ["projectId"],
  "td_list_repository_links": ["projectId"],
  "td_create_task": ["code"],
  "td_list_tasks": ["projectCode", "projectId", "assigneeId", "priority", "includeShared"],
  // td_update_shared_project resolves the project from the owner rather than
  // taking its id, so there is nothing to identify. Recorded as debt at first
  // and reclassified when the tool was read properly. (TODO-302)
  "td_update_project": ["id"],
};

/**
 * Divergences that are debt, not design.
 *
 * Nine were recorded here when this test was written (TODO-297) and all nine
 * are closed (TODO-302), so the list is empty and asserted as an EXACT set:
 * a new gap fails, and so does closing one without removing its entry.
 */
const KNOWN_GAPS: string[] = [];

/** The reverse direction, same rules. */
const KNOWN_EXTRAS: string[] = [];

/** Every tool whose name has a `_shared_` twin on the personal side. */
function pairs(): { personal: string; shared: string }[] {
  const out: { personal: string; shared: string }[] = [];
  for (const t of tools) {
    if (!t.name.includes("_shared_")) continue;
    const personal = t.name.replace("_shared_", "_");
    if (byName.has(personal)) out.push({ personal, shared: t.name });
  }
  return out;
}

describe("personal and shared tools accept the same arguments", () => {
  it("finds pairs at all, so an empty sweep cannot pass", () => {
    expect(pairs().length).toBeGreaterThan(15);
  });

  it("has exactly the recorded set of missing arguments, no more and no fewer", () => {
    const gaps: string[] = [];
    for (const { personal, shared } of pairs()) {
      const byDesign = new Set(BY_DESIGN[personal] ?? []);
      for (const arg of propsOf(personal)) {
        if (byDesign.has(arg)) continue;
        if (!propsOf(shared).has(arg)) gaps.push(`${shared} is missing "${arg}", which ${personal} accepts`);
      }
    }
    expect(gaps.sort()).toEqual([...KNOWN_GAPS].sort());
  });

  it("has exactly the recorded set of extra arguments", () => {
    const extras: string[] = [];
    for (const { personal, shared } of pairs()) {
      for (const arg of propsOf(shared)) {
        if (SHARED_ONLY.has(arg)) continue;
        if (!propsOf(personal).has(arg)) extras.push(`${shared} takes "${arg}", which ${personal} does not`);
      }
    }
    expect(extras.sort()).toEqual([...KNOWN_EXTRAS].sort());
  });

  it("isChecked is no longer one of them, which is what started this", () => {
    expect(propsOf("td_create_shared_checklist_item").has("isChecked")).toBe(true);
    expect(propsOf("td_create_checklist_item").has("isChecked")).toBe(true);
  });

  it("every by-design entry still refers to a real pair", () => {
    const known = new Set(pairs().map((p) => p.personal));
    for (const name of Object.keys(BY_DESIGN)) expect(known.has(name)).toBe(true);
  });
});

describe("task status enums", () => {
  // The app treats `recurring` as a real status: RecurringDrawer filters on it
  // and useRecurringTasks sets it on every reset. MCP listed five values and
  // not that one. (TODO-296)
  it("every status enum offers recurring", () => {
    const missing: string[] = [];
    for (const t of tools) {
      const props = (t.inputSchema as { properties?: Record<string, { enum?: unknown[] }> })?.properties ?? {};
      for (const [arg, spec] of Object.entries(props)) {
        const values = spec?.enum;
        if (!Array.isArray(values) || !values.includes("backlog")) continue;
        if (!values.includes("recurring")) missing.push(`${t.name}.${arg}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
