import { describe, it, expect } from "vitest";
import { createOwnerSecret, createRandomBytes, createSharedOwner } from "@evolu/common";

import { getSharedOwner } from "./evolu.js";

/**
 * getSharedOwner is the one place that checks a caller paired the right secret
 * with the right sharedOwnerId. The check existed (TODO-206) but sat inside the
 * cache-miss branch, so it stopped looking after the first call. (TODO-285)
 */

function makeOwner() {
  const secret = createOwnerSecret({ randomBytes: createRandomBytes() });
  const owner = createSharedOwner(secret);
  return {
    id: owner.id as unknown as string,
    secretBase64: Buffer.from(secret).toString("base64"),
  };
}

describe("getSharedOwner", () => {
  it("returns the owner when the secret matches", () => {
    const a = makeOwner();
    expect(getSharedOwner(a.id, a.secretBase64).id as unknown as string).toBe(a.id);
  });

  it("returns the same object on repeat calls, which Evolu's useOwner relies on", () => {
    const a = makeOwner();
    expect(getSharedOwner(a.id, a.secretBase64)).toBe(getSharedOwner(a.id, a.secretBase64));
  });

  it("rejects a secret belonging to another owner", () => {
    const a = makeOwner();
    const b = makeOwner();
    expect(() => getSharedOwner(a.id, b.secretBase64)).toThrow(/does not match/);
  });

  it("keeps rejecting a wrong secret after a successful call - the cache bug", () => {
    // Before this change the first call cached the owner and every later call
    // returned it without reading the secret at all, so any string passed.
    const a = makeOwner();
    const b = makeOwner();

    expect(getSharedOwner(a.id, a.secretBase64).id as unknown as string).toBe(a.id);
    expect(() => getSharedOwner(a.id, b.secretBase64)).toThrow(/does not match/);
    expect(() => getSharedOwner(a.id, "not-even-a-secret")).toThrow();
  });

  it("rejects a missing secret with a message naming the argument", () => {
    const a = makeOwner();
    expect(() => getSharedOwner(a.id, "")).toThrow(/ownerSecret is required/);
  });
});
