import { describe, it, expect } from "vitest";
import { assertMutation } from "./pure.js";

/**
 * These guard the v7 -> v8 change in what a mutation returns (TODO-88).
 *
 * v7 gave back a `Result`, so this helper asserted `result.ok`. v8 returns the
 * row as `{ id }` and raises on an invalid change, so `ok` is absent — the
 * assertion then failed on every successful write, and 40-odd call sites
 * across the tools reported "failed" for changes they had just applied.
 */
describe("assertMutation", () => {
  it("accepts what v8 actually returns", () => {
    expect(() => assertMutation("insert", { id: "ctl8XKoIV189fSIai4EjAQ" })).not.toThrow();
  });

  it("does not require an `ok` field, which v8 never sets", () => {
    // The exact shape that used to throw. If this test fails, every update and
    // delete tool is reporting failure for a write that went through.
    expect(() => assertMutation("update", { id: "abc" } as { id: string; ok?: boolean })).not.toThrow();
  });

  it("still catches a mutation that came back without a row id", () => {
    expect(() => assertMutation("update", {})).toThrow(/no row id/);
    expect(() => assertMutation("update", { id: "" })).toThrow(/no row id/);
    expect(() => assertMutation("update", { id: 42 })).toThrow(/no row id/);
  });

  it("names the operation in the message, so the caller knows which write", () => {
    expect(() => assertMutation("deleteChecklistItem", {})).toThrow(/deleteChecklistItem/);
  });
});
