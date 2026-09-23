import { describe, expect, it, beforeEach } from "vitest";
import {
  classifyFreshness,
  missingMessages,
  incompleteCopyMessage,
  assertCopyCanNumberTasks,
  __resetCopyFreshnessForTests,
} from "./syncFreshness.js";

/**
 * Numbering a task from an incomplete copy (TODO-373).
 *
 * `td_create_task` derives the next code from the highest one it can see, which
 * is a write nobody can undo. On 2026-09-23 the copy did not hold TODO-360 to
 * TODO-367 and the server produced TODO-353 through 359; two hours later the
 * same file had them and carried on from 368. Nothing broke only because those
 * numbers happened to be free.
 *
 * Measured against the live relay while this was written: 81 130 messages
 * locally, 81 130 on the relay, so the two counts really are comparable.
 */

describe("classifyFreshness", () => {
  it("is caught up when everything the relay reported is here", () => {
    expect(classifyFreshness({ local: 100, remote: 100 })).toBe("caught-up");
  });

  it("is caught up when the local side is ahead, which this process causes", () => {
    // The relay figure is a snapshot; writing here puts us past it.
    expect(classifyFreshness({ local: 101, remote: 100 })).toBe("caught-up");
  });

  it("is behind while messages are missing", () => {
    expect(classifyFreshness({ local: 40, remote: 100 })).toBe("behind");
    expect(missingMessages({ local: 40, remote: 100 })).toBe(60);
  });

  it("reports no gap unless it is actually behind", () => {
    expect(missingMessages({ local: 100, remote: 100 })).toBeNull();
    expect(missingMessages({ local: 5, remote: null })).toBeNull();
  });

  it("is unknown when either side could not be read", () => {
    // Never "caught up": treating an unanswered relay as zero would declare
    // every network hiccup complete, which is the failure being prevented.
    expect(classifyFreshness({ local: 100, remote: null })).toBe("unknown");
    expect(classifyFreshness({ local: null, remote: 100 })).toBe("unknown");
    expect(classifyFreshness({ local: null, remote: null })).toBe("unknown");
    expect(classifyFreshness({ local: Number.NaN, remote: 10 })).toBe("unknown");
  });
});

describe("incompleteCopyMessage", () => {
  it("says it is a wait, not a defect, and names the gap", () => {
    const msg = incompleteCopyMessage(14);
    expect(msg).toContain("Chybí 14 zpráv");
    expect(msg).toContain("TODO-373");
  });

  it("leaves the gap out when it is not known", () => {
    expect(incompleteCopyMessage(null)).not.toContain("Chybí");
  });
});

describe("assertCopyCanNumberTasks", () => {
  const evolu = {
    createQuery: () => ({}),
    loadQuery: async () => [{ count: 40 }],
  } as never;

  beforeEach(() => __resetCopyFreshnessForTests());

  it("refuses while the copy is behind", async () => {
    await expect(
      assertCopyCanNumberTasks({
        evolu,
        ownerId: "owner-1",
        mnemonic: "x",
        fetchRemote: async () => 100,
      }),
    ).rejects.toThrow(/Chybí 60 zpráv/);
  });

  it("allows numbering once the copy has caught up", async () => {
    await expect(
      assertCopyCanNumberTasks({ evolu, ownerId: "owner-1", mnemonic: "x", fetchRemote: async () => 40 }),
    ).resolves.toBeUndefined();
  });

  it("does not ask the relay again once it has seen a complete copy", async () => {
    let asked = 0;
    const fetchRemote = async () => {
      asked++;
      return 40;
    };
    await assertCopyCanNumberTasks({ evolu, ownerId: "o", mnemonic: "x", fetchRemote });
    await assertCopyCanNumberTasks({ evolu, ownerId: "o", mnemonic: "x", fetchRemote });
    expect(asked).toBe(1);
  });

  it("lets the write through when the relay cannot be asked", async () => {
    // Deliberate. Refusing here would be easy to call safe, but the relay is
    // unreachable in exactly the situations a local-first tool has to keep
    // working. The gap being closed is a reachable relay and a copy behind it.
    await expect(
      assertCopyCanNumberTasks({ evolu, ownerId: "o", mnemonic: "x", fetchRemote: async () => null }),
    ).resolves.toBeUndefined();
  });

  it("does nothing without an owner or a mnemonic, rather than blocking", async () => {
    await expect(
      assertCopyCanNumberTasks({ evolu, ownerId: null, mnemonic: "x", fetchRemote: async () => 100 }),
    ).resolves.toBeUndefined();
  });
});
