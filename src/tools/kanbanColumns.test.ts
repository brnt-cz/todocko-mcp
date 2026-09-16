import { describe, expect, it } from "vitest";
import { parseWipLimit } from "./kanbanColumns.js";

describe("parseWipLimit (TODO-338)", () => {
  it("keeps a positive integer", () => {
    expect(parseWipLimit(3)).toBe(3);
  });

  it("treats null, undefined and non-positive numbers as no limit", () => {
    expect(parseWipLimit(null)).toBeNull();
    expect(parseWipLimit(undefined)).toBeNull();
    expect(parseWipLimit(0)).toBeNull();
    expect(parseWipLimit(-2)).toBeNull();
  });

  it("rejects strings and fractions instead of storing garbage", () => {
    expect(() => parseWipLimit("3")).toThrow(/wipLimit/);
    expect(() => parseWipLimit(2.5)).toThrow(/wipLimit/);
  });
});
