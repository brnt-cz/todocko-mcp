import { describe, it, expect } from "vitest";
import { createRun } from "@evolu/common";
import { describeDefect } from "./tools/pure.js";

/**
 * TODO-317 hangs its whole diagnosis on one assumption: that Evolu routes a
 * Run panic to `deps.reportDefect`, so overriding it captures the thing that
 * used to vanish. Everything else in that change is wiring, and wiring on top
 * of a wrong assumption is worth nothing.
 *
 * This pins the assumption against the real library, not a mock. If Evolu ever
 * stops reporting defects this way, the capture in evoluPlatform.ts goes quiet
 * and the fault it exists to explain becomes invisible again - so this test
 * failing is a real signal, not noise to be updated away.
 */
describe("Evolu Run defect reporting", () => {
  it("hands a panic inside a Run to the injected reportDefect", async () => {
    const defects: unknown[] = [];
    const run = createRun({
      reportDefect: (reported: unknown) => {
        defects.push(reported);
      },
    });

    // A Task that throws rather than returning a Result is a defect, which is
    // exactly the shape a dying dbWorker produces.
    await run(async () => {
      throw new Error("boom from a task");
    }).catch(() => undefined);

    // The default reporter defers to a microtask, so give any deferral a turn.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(defects.length).toBeGreaterThan(0);
    // Measured, not assumed: what arrives is a `{ type, reason }` envelope,
    // never an Error, which is why describeDefect exists at all.
    const first = defects[0];
    expect(first).not.toBeInstanceOf(Error);
    expect(Object.keys(first as object)).toContain("reason");
    expect(describeDefect(first)).toMatch(/boom from a task/);
  });

  it("leaves reportDefect alone when the Run completes normally", async () => {
    const defects: unknown[] = [];
    const run = createRun({
      reportDefect: (reported: unknown) => {
        defects.push(reported);
      },
    });
    await run(async () => ({ ok: true, value: 1 }) as never).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(defects).toEqual([]);
  });
});
