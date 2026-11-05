import { describe, it, expect } from "vitest";
import { createIdFromString } from "@evolu/common";
import {
  computeInviteProof,
  resolveVerifiedPermission,
  effectivePermission,
  type OwnerSideRecords,
} from "./memberVerification.js";
import { memberGrantRowId } from "./evolu.js";

/**
 * The port has to agree with the app bit for bit (TODO-112).
 *
 * The proof a member stores was computed by the app's
 * `src/db/memberVerification.ts`. A port that hashes the same inputs any other
 * way does not fail: it simply never matches, so every member comes out
 * unverified and the owner is told nobody has a confirmed permission.
 *
 * These three values were produced by running the app's own function, not this
 * one, so they are a control and not a restatement of what the code does.
 */
const APP_VECTORS: [inviteId: string, sharedOwnerId: string, memberAppOwnerId: string, proof: string][] = [
  ["invite-1", "owner-A", "member-x", "AA-y-B05rtOOmYztZ7Qp20B9iZZZ7a2FSHDeCff0Bfs"],
  ["invite-1", "owner-B", "member-x", "nKDDOS4eOipivPrah33TI8lqTEfhwNzwNihpYRWWB4A"],
  ["invite-2", "owner-A", "member-x", "ytnMdHVxRjSrRf_uwCz8c0pxnIhACoHS92h_ncTa3R4"],
];

describe("computeInviteProof", () => {
  it("reproduces the proofs the app computes", async () => {
    for (const [inviteId, sharedOwnerId, memberAppOwnerId, expected] of APP_VECTORS) {
      expect(await computeInviteProof(inviteId, sharedOwnerId, memberAppOwnerId)).toBe(expected);
    }
  });

  it("binds the project, so a proof cannot be carried to another one", async () => {
    const [, , , first] = APP_VECTORS[0];
    const [, , , second] = APP_VECTORS[1];
    expect(first).not.toBe(second);
  });

  it("is base64url, with no padding and nothing to escape in a URL", async () => {
    for (const [, , , proof] of APP_VECTORS) expect(proof).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

function records(over: Partial<OwnerSideRecords> = {}): OwnerSideRecords {
  return {
    selfAppOwnerId: "owner-self",
    sharedOwnerId: "owner-A",
    grants: new Map(),
    invites: [],
    ...over,
  };
}

describe("resolveVerifiedPermission", () => {
  it("takes the owner's own row at its word", async () => {
    expect(
      await resolveVerifiedPermission({ userAppOwnerId: "owner-self", permission: "admin" }, records()),
    ).toBe("admin");
  });

  it("prefers an explicit grant over the invite", async () => {
    const proof = await computeInviteProof("invite-1", "owner-A", "member-x");
    const result = await resolveVerifiedPermission(
      { userAppOwnerId: "member-x", permission: "admin", inviteProof: proof },
      records({
        grants: new Map([["member-x", "read"]]),
        invites: [{ id: "invite-1", permission: "write" }],
      }),
    );
    expect(result).toBe("read");
  });

  it("falls back to the invite the member proves they came through", async () => {
    const proof = await computeInviteProof("invite-1", "owner-A", "member-x");
    const result = await resolveVerifiedPermission(
      { userAppOwnerId: "member-x", permission: "admin", inviteProof: proof },
      records({ invites: [{ id: "invite-1", permission: "write" }] }),
    );
    expect(result).toBe("write");
  });

  it("refuses a proof made for another project", async () => {
    const otherProject = await computeInviteProof("invite-1", "owner-B", "member-x");
    const result = await resolveVerifiedPermission(
      { userAppOwnerId: "member-x", permission: "write", inviteProof: otherProject },
      records({ invites: [{ id: "invite-1", permission: "write" }] }),
    );
    expect(result).toBeNull();
  });

  it("refuses a proof copied from another member", async () => {
    const someoneElse = await computeInviteProof("invite-1", "owner-A", "member-y");
    const result = await resolveVerifiedPermission(
      { userAppOwnerId: "member-x", permission: "write", inviteProof: someoneElse },
      records({ invites: [{ id: "invite-1", permission: "write" }] }),
    );
    expect(result).toBeNull();
  });

  it("has no record of a member who carries no proof", async () => {
    expect(
      await resolveVerifiedPermission(
        { userAppOwnerId: "member-x", permission: "write", inviteProof: null },
        records({ invites: [{ id: "invite-1", permission: "write" }] }),
      ),
    ).toBeNull();
  });
});

describe("effectivePermission", () => {
  it("never returns more than either side", () => {
    expect(effectivePermission("admin", "write")).toBe("write");
    expect(effectivePermission("write", "admin")).toBe("write");
    expect(effectivePermission("write", "write")).toBe("write");
  });

  it("reads anything unrecorded or unrecognised as read", () => {
    expect(effectivePermission("write", null)).toBe("read");
    expect(effectivePermission("write", undefined)).toBe("read");
    expect(effectivePermission(null, "admin")).toBe("read");
    expect(effectivePermission("write", "owner")).toBe("read");
  });
});

describe("memberGrantRowId", () => {
  it("is stable, so the owner's second device lands on one row", () => {
    expect(memberGrantRowId("owner-A", "member-x")).toBe(memberGrantRowId("owner-A", "member-x"));
  });

  it("separates members and projects", () => {
    expect(memberGrantRowId("owner-A", "member-x")).not.toBe(memberGrantRowId("owner-A", "member-y"));
    expect(memberGrantRowId("owner-A", "member-x")).not.toBe(memberGrantRowId("owner-B", "member-x"));
  });

  it("uses the app's formula, not just some stable one", () => {
    expect(memberGrantRowId("owner-A", "member-x")).toBe(
      createIdFromString("memberGrant:owner-A:member-x"),
    );
  });
});
