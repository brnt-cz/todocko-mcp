import { describe, expect, it } from "vitest";
import { parseTemplateList, serializeTemplateList } from "./taskTemplates.js";

describe("template list columns (TODO-329)", () => {
  it("round-trips and drops blanks", () => {
    expect(serializeTemplateList([" a ", "", "b"], "checklistItems")).toBe('["a","b"]');
    expect(parseTemplateList('["a","b"]')).toEqual(["a", "b"]);
    expect(serializeTemplateList([], "tagIds")).toBeNull();
    expect(serializeTemplateList(undefined, "tagIds")).toBeNull();
  });

  it("rejects non-string entries instead of storing garbage", () => {
    expect(() => serializeTemplateList([1, "x"], "tagIds")).toThrow(/tagIds/);
    expect(() => serializeTemplateList("a,b", "checklistItems")).toThrow(/checklistItems/);
  });

  it("degrades malformed stored JSON to an empty list", () => {
    expect(parseTemplateList("nope")).toEqual([]);
    expect(parseTemplateList(null)).toEqual([]);
    expect(parseTemplateList('{"a":1}')).toEqual([]);
  });
});
