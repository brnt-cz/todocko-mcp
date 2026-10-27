import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { existsSync, writeFileSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { calculateNextDeadline, isRecurrenceExpired } from "./recurrence.js";

/**
 * MCP's copy of the recurrence rules must agree with the app's. (TODO-420)
 *
 * Two copies of the same logic drift apart; this repo has watched it happen.
 * So this runs the app's real function, not a description of it, against the
 * port over the cases each rule was written for.
 *
 * It used to skip entirely when the app repo was not next door, which is always
 * the case in CI - so the one check guarding the copy never ran where it
 * mattered. The app's answers are now recorded in `recurrence.appSnapshot.json`
 * and the comparison runs against that file everywhere. When the app IS next
 * door the live comparison still happens, and the app is compared with the
 * snapshot too, so a change on the app side fails here instead of being
 * silently outvoted by a stale file. (TODO-441)
 *
 * Regenerate after an intended change in the app:
 *   TODOCKO_APP_DIR=/path/to/todocko UPDATE_RECURRENCE_SNAPSHOT=1 npx vitest run src/utils/recurrence.parity.test.ts
 */
// TODOCKO_APP_DIR overrides the sibling-checkout guess, so this can run from a
// worktree outside the usual layout - where a skip would prove nothing.
const here = dirname(fileURLToPath(import.meta.url));
const appRecurrence = process.env.TODOCKO_APP_DIR
  ? join(process.env.TODOCKO_APP_DIR, "src/utils/recurrence.ts")
  : join(here, "../../../todocko/src/utils/recurrence.ts");
const appPresent = existsSync(appRecurrence);
const snapshotPath = join(here, "recurrence.appSnapshot.json");

// The rules read "today", so freeze it: a deadline in the past advances from
// today, and that branch must be compared on the same today in both copies.
// The snapshot records the same instant, or the recorded answers would be
// answers to a different question.
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

const EXPIRY_CASES: (string | null)[] = [null, "2026-10-07", "2026-10-08", "2026-10-09"];

interface Snapshot {
  readonly today: string;
  readonly nextDeadline: Record<string, string>;
  readonly expired: Record<string, boolean>;
}

const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as Snapshot;

/** The app module, loaded lazily so a missing repo cannot break the file. */
async function appModule(): Promise<{
  calculateNextDeadline: (d: string | null, t: string, i: number, day?: number | null) => string;
  isRecurrenceExpired: (end: string | null) => boolean;
}> {
  return (await import(appRecurrence)) as never;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(TODAY);
});

describe("recurrence rules agree with the recorded app behaviour (TODO-420, TODO-441)", () => {
  it("records the same today the cases were computed on", () => {
    // Local components, not an instant: the rules work on local calendar days,
    // and the recorded instant would differ between a CI runner on UTC and a
    // machine in Prague while meaning the same day.
    expect(snapshot.today).toBe("2026-10-08T12:00:00 local");
  });

  it("covers every case, so a missing entry cannot pass as agreement", () => {
    expect(Object.keys(snapshot.nextDeadline).sort()).toEqual(CASES.map((c) => c.name).sort());
    expect(Object.keys(snapshot.expired).sort()).toEqual(EXPIRY_CASES.map(String).sort());
  });

  for (const c of CASES) {
    it(c.name, () => {
      const silence = vi.spyOn(console, "error").mockImplementation(() => {});
      const ours = calculateNextDeadline(c.deadline, c.type as never, c.interval ?? 1, c.day);
      silence.mockRestore();
      expect(ours).toBe(snapshot.nextDeadline[c.name]);
    });
  }

  it("expiry agrees too", () => {
    for (const end of EXPIRY_CASES) {
      expect(isRecurrenceExpired(end)).toBe(snapshot.expired[String(end)]);
    }
  });
});

describe.skipIf(!appPresent)("the snapshot still matches the app itself", () => {
  it("regenerates the snapshot when asked, otherwise compares against it", async () => {
    const app = await appModule();
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    const nextDeadline: Record<string, string> = {};
    for (const c of CASES) {
      nextDeadline[c.name] = app.calculateNextDeadline(c.deadline, c.type, c.interval ?? 1, c.day);
    }
    silence.mockRestore();
    const expired: Record<string, boolean> = {};
    for (const end of EXPIRY_CASES) expired[String(end)] = app.isRecurrenceExpired(end);

    if (process.env.UPDATE_RECURRENCE_SNAPSHOT === "1") {
      const fresh: Snapshot & { note: string } = {
        note:
          "Generated from the app's src/utils/recurrence.ts. Regenerate with " +
          "UPDATE_RECURRENCE_SNAPSHOT=1 (see recurrence.parity.test.ts). (TODO-441)",
        today: "2026-10-08T12:00:00 local",
        nextDeadline,
        expired,
      };
      writeFileSync(snapshotPath, JSON.stringify(fresh, null, 2) + "\n");
      return;
    }

    expect(nextDeadline).toEqual(snapshot.nextDeadline);
    expect(expired).toEqual(snapshot.expired);
  });
});
