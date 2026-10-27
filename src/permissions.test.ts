import { describe, it, expect } from "vitest";
import {
  canWrite,
  canAdmin,
  isProjectAdmin,
  memberCanWrite,
  sharedAccessRefusal,
  pickProjectRef,
  memberChangeRefusal,
} from "./permissions.js";

/**
 * The MCP's port of the app's permissions.ts, plus the gate every shared write
 * goes through. (TODO-434)
 */

describe("the app's three questions", () => {
  it("canWrite: admin and write yes, read and anything unknown no", () => {
    expect(canWrite("admin")).toBe(true);
    expect(canWrite("write")).toBe(true);
    for (const p of ["read", "", "Write", "owner", null, undefined]) expect(canWrite(p)).toBe(false);
  });

  it("canAdmin: only admin", () => {
    expect(canAdmin("admin")).toBe(true);
    for (const p of ["write", "read", null, undefined, "ADMIN"]) expect(canAdmin(p)).toBe(false);
  });

  it("isProjectAdmin: owner or admin", () => {
    expect(isProjectAdmin({ isOwner: true, permission: "read" })).toBe(true);
    expect(isProjectAdmin({ isOwner: false, permission: "admin" })).toBe(true);
    expect(isProjectAdmin({ isOwner: false, permission: "write" })).toBe(false);
  });

  it("memberCanWrite: blocked, pending and kicked members do not write", () => {
    expect(memberCanWrite({ permission: "write" })).toBe(true);
    expect(memberCanWrite({ permission: "write", isBlocked: true })).toBe(false);
    expect(memberCanWrite({ permission: "admin", isPending: true })).toBe(false);
    expect(memberCanWrite({ permission: "admin", isKicked: true })).toBe(false);
    expect(memberCanWrite({ permission: "read" })).toBe(false);
  });
});

describe("sharedAccessRefusal, the gate", () => {
  const ref = (permission: string | null, isOwner = false) => ({ name: "Garden", permission, isOwner });

  it("never refuses a read, with or without a ref", () => {
    expect(sharedAccessRefusal(null, "read")).toBeNull();
    expect(sharedAccessRefusal(ref("read"), "read")).toBeNull();
  });

  it.each([
    ["admin", null, null],
    ["write", null, /Only the owner or an admin/],
    ["read", /No write permission/, /Only the owner or an admin/],
    [null, /No write permission/, /Only the owner or an admin/],
    ["bogus", /No write permission/, /Only the owner or an admin/],
  ])("permission %s: write -> %s, admin -> %s", (permission, write, admin) => {
    const r = ref(permission as string | null);
    if (write) expect(sharedAccessRefusal(r, "write")).toMatch(write);
    else expect(sharedAccessRefusal(r, "write")).toBeNull();
    if (admin) expect(sharedAccessRefusal(r, "admin")).toMatch(admin);
    else expect(sharedAccessRefusal(r, "admin")).toBeNull();
  });

  it("an owner whose ref carries admin passes both, as in the app", () => {
    expect(sharedAccessRefusal(ref("admin", true), "write")).toBeNull();
    expect(sharedAccessRefusal(ref("admin", true), "admin")).toBeNull();
  });

  it("an owner passes admin through isOwner even with an odd permission", () => {
    expect(sharedAccessRefusal(ref("read", true), "admin")).toBeNull();
    // ...but writing data still asks canWrite, like assertWritePermission.
    expect(sharedAccessRefusal(ref("read", true), "write")).toMatch(/No write permission/);
  });

  it("refuses both writes when there is no ref to check", () => {
    expect(sharedAccessRefusal(null, "write")).toMatch(/No project reference/);
    expect(sharedAccessRefusal(null, "admin")).toMatch(/No project reference/);
  });

  it("names the project and the permission in the message", () => {
    expect(sharedAccessRefusal(ref("read"), "write")).toContain('"Garden"');
    expect(sharedAccessRefusal(ref("read"), "write")).toContain("read");
  });
});

describe("pickProjectRef", () => {
  it("returns null for no refs", () => {
    expect(pickProjectRef([])).toBeNull();
  });

  it("prefers the owner ref, then the strongest permission", () => {
    const a = { permission: "read", isOwner: false, id: "a" };
    const b = { permission: "write", isOwner: false, id: "b" };
    const c = { permission: "admin", isOwner: true, id: "c" };
    expect(pickProjectRef([a, b])?.id).toBe("b");
    expect(pickProjectRef([a, c, b])?.id).toBe("c");
  });
});

describe("memberChangeRefusal", () => {
  const writer = { permission: "write", isBlocked: false, isPending: false, isKicked: false };
  const fresh = { actorIsOwner: true, hasRotatedWriteKey: false };
  const rotated = { actorIsOwner: true, hasRotatedWriteKey: true };

  it.each([
    ["block", { isBlocked: true }],
    ["kick", { isKicked: true }],
    ["downgrade to read", { permission: "read" }],
  ])("refuses %s, which needs a key rotation", (_label, change) => {
    expect(memberChangeRefusal(writer, change, fresh)).toMatch(/rotated/);
  });

  it("refuses rejecting a pending member, which the app also rotates on", () => {
    const pending = { ...writer, isPending: true };
    expect(memberChangeRefusal(pending, { isPending: false, isBlocked: true }, fresh)).toMatch(/rotated/);
  });

  it("refuses unblocking a read-only member, which the app rotates on", () => {
    const blockedReader = { permission: "read", isBlocked: true };
    expect(memberChangeRefusal(blockedReader, { isBlocked: false }, fresh)).toMatch(/rotated/);
  });

  it("allows approving and unblocking a writer while no key was rotated", () => {
    expect(memberChangeRefusal({ ...writer, isPending: true }, { isPending: false, isBlocked: false }, fresh)).toBeNull();
    expect(memberChangeRefusal({ ...writer, isBlocked: true }, { isBlocked: false }, fresh)).toBeNull();
    expect(memberChangeRefusal({ permission: "read" }, { permission: "write" }, fresh)).toBeNull();
  });

  it("refuses giving write once the key was rotated: the member would need it handed over", () => {
    expect(memberChangeRefusal({ ...writer, isPending: true }, { isPending: false, isBlocked: false }, rotated))
      .toMatch(/handed over/);
    expect(memberChangeRefusal({ permission: "read" }, { permission: "admin" }, rotated)).toMatch(/handed over/);
  });

  it("allows write <-> admin even after a rotation: the member already holds the key", () => {
    expect(memberChangeRefusal(writer, { permission: "admin" }, rotated)).toBeNull();
    expect(memberChangeRefusal({ ...writer, permission: "admin" }, { permission: "write" }, rotated)).toBeNull();
  });

  it("only the owner may block an admin", () => {
    const admin = { ...writer, permission: "admin" };
    expect(memberChangeRefusal(admin, { isBlocked: true }, { actorIsOwner: false, hasRotatedWriteKey: false }))
      .toMatch(/Only the project owner/);
  });

  it("rejects an unknown permission", () => {
    expect(memberChangeRefusal(writer, { permission: "superuser" }, fresh)).toMatch(/Unknown permission/);
  });
});
