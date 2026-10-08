import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { calculateNextDeadline, isRecurrenceExpired } from "./recurrence.js";

/**
 * MCP's copy of the recurrence rules must agree with the app's. (TODO-420)
 *
 * Two copies of the same logic drift apart; this repo has watched it happen.
 * So this runs the app's real function, not a description of it, against the
 * port over the cases each rule was written for. If the app repo is not next
 * door - in CI, for instance - it skips rather than fails on a layout guess.
 */
// TODOCKO_APP_DIR overrides the sibling-checkout guess, so this can run from a
// worktree outside the usual layout - where a skip would prove nothing.
const appRecurrence = process.env.TODOCKO_APP_DIR
  ? join(process.env.TODOCKO_APP_DIR, "src/utils/recurrence.ts")
  : join(dirname(fileURLToPath(import.meta.url)), "../../../todocko/src/utils/recurrence.ts");
const appPresent = existsSync(appRecurrence);

// The rules read "today", so freeze it: a deadline in the past advances from
// today, and that branch must be compared on the same today in both copies.
const TODAY = new Date(2026, 9, 8, 12, 0, 0);

afterEach(() => {
  vi.useRealTimers();
});

const CASES: { name: string; deadline: string | null; type: string; interval?: number; day?: number | null }[] = [
  { name: "daily", deadline: "2026-10-08", type: "daily" },
  { name: "daily x3", deadline: "2026-10-08", type: "daily", interval: 3 },
  { name: "weekly", deadline: "2026-10-08", type: "weekly" },
  { name: "weekly on Monday", deadline: "2026-10-08", type: "weekly", day: 1 },
  { name: "weekly on Sunday", deadline: "2026-10-08", type: "weekly", day: 7 },
  { name: "monthly", deadline: "2026-10-07", type: "monthly" },
  // TODO-250: Aug 31 + 1 month used to land on Oct 1, skipping September.
  { name: "monthly from the 31st", deadline: "2026-10-31", type: "monthly" },
  { name: "monthly last day", deadline: "2026-10-31", type: "monthly", day: 0 },
  { name: "monthly on the 15th", deadline: "2026-10-31", type: "monthly", day: 15 },
  { name: "monthly x13 rolls the year", deadline: "2026-10-15", type: "monthly", interval: 13 },
  // TODO-296: yearly once fell through the switch and never advanced.
  { name: "yearly", deadline: "2026-10-08", type: "yearly" },
  { name: "yearly from Feb 29", deadline: "2028-02-29", type: "yearly" },
  { name: "custom 10 days", deadline: "2026-10-08", type: "custom", interval: 10 },
  { name: "deadline in the past", deadline: "2026-01-01", type: "weekly" },
  { name: "no deadline", deadline: null, type: "daily" },
  { name: "unknown type", deadline: "2026-10-08", type: "fortnightly" },
];

describe.skipIf(!appPresent)("recurrence rules agree with the app (TODO-420)", () => {
  for (const c of CASES) {
    it(c.name, async () => {
      vi.useFakeTimers();
      vi.setSystemTime(TODAY);
      // Dynamic, so a missing app repo skips instead of failing to load.
      const app = await import(appRecurrence);
      const silence = vi.spyOn(console, "error").mockImplementation(() => {});
      const ours = calculateNextDeadline(c.deadline, c.type as never, c.interval ?? 1, c.day);
      const theirs = app.calculateNextDeadline(c.deadline, c.type, c.interval ?? 1, c.day);
      silence.mockRestore();
      expect(ours).toBe(theirs);
    });
  }

  it("expiry agrees too", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
    const app = await import(appRecurrence);
    for (const end of [null, "2026-10-07", "2026-10-08", "2026-10-09"]) {
      expect(isRecurrenceExpired(end)).toBe(app.isRecurrenceExpired(end));
    }
  });
});
