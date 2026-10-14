import { describe, it, expect } from "vitest";
import { describeRefusal } from "./evoluPlatform.js";

/**
 * Since Evolu 8.20.3 a database whose worker fails is refused through
 * `evoluError`, and its queries hang instead of failing (TODO-427). Tools
 * refuse to wait on such an instance; this pins which errors count.
 */
describe("describeRefusal", () => {
  it("is quiet while Evolu reports nothing", () => {
    expect(describeRefusal(null)).toBeNull();
  });

  it("treats a refused database as fatal", () => {
    expect(describeRefusal({ type: "UnknownError" })).toMatch(/UnknownError.*Reconnect/);
    expect(describeRefusal({ type: "UnsupportedDbVersionError" })).toMatch(/UnsupportedDbVersionError/);
  });

  it("does not treat a wait for another build as fatal", () => {
    expect(describeRefusal({ type: "OtherBuildRunningError" })).toBeNull();
  });
});
