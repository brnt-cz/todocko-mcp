import { describe, it, expect, vi, beforeEach } from "vitest";
import { createOwnerSecret, createRandomBytes, createSharedOwner } from "@evolu/common";

/**
 * resolveSharedOwner against a faked app instance: the projectRef rows are the
 * only input, and the real getSharedOwner does the secret check. (TODO-434)
 */

let refRows: Record<string, unknown>[] = [];
const wheres: [string, string, unknown][] = [];

vi.mock("../evolu.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../evolu.js")>();
  const db: any = {
    selectFrom: () => db,
    select: () => db,
    where: (column: string, op: string, value: unknown) => {
      wheres.push([column, op, value]);
      return db;
    },
  };
  return {
    ...actual,
    getEvolu: () => ({
      createQuery: (build: (d: unknown) => unknown) => build(db),
      // Filters like the real query would, so a ref for another owner is not seen.
      loadQuery: async () => {
        const owner = wheres.find((w) => w[0] === "sharedOwnerId")?.[2];
        return refRows.filter((r) => r.sharedOwnerId === owner);
      },
    }),
  };
});

const { resolveSharedOwner } = await import("./sharedAccess.js");

function makeOwner() {
  const secret = createOwnerSecret({ randomBytes: createRandomBytes() });
  const owner = createSharedOwner(secret);
  return { id: owner.id as unknown as string, secret: Buffer.from(secret).toString("base64") };
}

function ref(owner: { id: string; secret: string }, permission: string, isOwner = false) {
  return { sharedOwnerId: owner.id, ownerSecret: owner.secret, permission, isOwner: isOwner ? 1 : null, name: "P" };
}

describe("resolveSharedOwner", () => {
  beforeEach(() => {
    refRows = [];
    wheres.length = 0;
  });

  it("finds the secret in projectRef when the caller leaves it out", async () => {
    const o = makeOwner();
    refRows = [ref(o, "write")];
    const owner = await resolveSharedOwner({ sharedOwnerId: o.id }, "write");
    expect(owner.id as unknown as string).toBe(o.id);
    // Looked up by the id the caller named, not by scanning every ref.
    expect(wheres).toContainEqual(["sharedOwnerId", "=", o.id]);
  });

  it("still accepts a provided secret, and still checks it against the id", async () => {
    const o = makeOwner();
    const other = makeOwner();
    refRows = [ref(o, "write")];
    await expect(resolveSharedOwner({ sharedOwnerId: o.id, ownerSecret: o.secret }, "write")).resolves.toBeDefined();
    await expect(resolveSharedOwner({ sharedOwnerId: o.id, ownerSecret: other.secret }, "write"))
      .rejects.toThrow(/does not match/);
  });

  it("refuses a write from a read-only member before anything else happens", async () => {
    const o = makeOwner();
    refRows = [ref(o, "read")];
    await expect(resolveSharedOwner({ sharedOwnerId: o.id }, "write")).rejects.toThrow(/No write permission/);
    // Reading is still fine.
    await expect(resolveSharedOwner({ sharedOwnerId: o.id }, "read")).resolves.toBeDefined();
  });

  it("refuses admin work from a writer and allows it for an admin or the owner", async () => {
    const o = makeOwner();
    refRows = [ref(o, "write")];
    await expect(resolveSharedOwner({ sharedOwnerId: o.id }, "admin")).rejects.toThrow(/owner or an admin/);
    refRows = [ref(o, "admin")];
    await expect(resolveSharedOwner({ sharedOwnerId: o.id }, "admin")).resolves.toBeDefined();
    refRows = [ref(o, "admin", true)];
    await expect(resolveSharedOwner({ sharedOwnerId: o.id }, "admin")).resolves.toBeDefined();
  });

  it("refuses writes with no projectRef even when the secret is passed", async () => {
    const o = makeOwner();
    await expect(resolveSharedOwner({ sharedOwnerId: o.id, ownerSecret: o.secret }, "write"))
      .rejects.toThrow(/No project reference/);
    // A read with the secret in hand keeps working as before.
    await expect(resolveSharedOwner({ sharedOwnerId: o.id, ownerSecret: o.secret }, "read")).resolves.toBeDefined();
  });

  it("explains a read with neither a ref nor a secret", async () => {
    const o = makeOwner();
    await expect(resolveSharedOwner({ sharedOwnerId: o.id }, "read")).rejects.toThrow(/td_list_shared_projects/);
  });

  it("requires sharedOwnerId", async () => {
    await expect(resolveSharedOwner({ sharedOwnerId: "" }, "read")).rejects.toThrow(/sharedOwnerId is required/);
  });
});
