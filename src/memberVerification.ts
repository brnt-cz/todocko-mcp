/**
 * The owner's own record of what each member was granted. (app TODO-440)
 *
 * Ported from the app's `src/db/memberVerification.ts` for MCP round XI
 * (TODO-112). Same algorithm on purpose: the proof a member stores was
 * computed by the app, so anything that computes it differently here would
 * simply never match and every member would come out unverified.
 *
 * A member's `projectMember.permission` is written by the member, so it cannot
 * decide who receives the project's write key. The owner keeps two things in
 * their personal instance instead, where no member can write:
 *
 * - a `shareInvite` per generated link, whose id travels in the token, and
 * - a `memberGrant` per member whose permission the owner set by hand.
 *
 * The invite id is a secret only the link holders know. A member does not
 * store it in the shared row, because every other member reads that row and
 * could copy a write invite's id into their own. They store a proof instead:
 * an HMAC of their own identity keyed by the invite id.
 *
 * Kept free of Evolu instances on purpose, so it can be tested without a
 * database.
 */

export interface ShareInviteRecord {
  id: string;
  permission: string;
}

export interface OwnerSideRecords {
  /** The owner's own app owner id: their own row needs no confirmation. */
  selfAppOwnerId: string;
  sharedOwnerId: string;
  /** memberAppOwnerId -> permission the owner set explicitly. */
  grants: ReadonlyMap<string, string>;
  /** Invites the owner issued for this project. */
  invites: readonly ShareInviteRecord[];
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/**
 * Proof that the member holding `memberAppOwnerId` joined through the invite.
 *
 * Binds the project as well, so a proof cannot be carried over to another
 * project that happens to share an invite id.
 */
export async function computeInviteProof(
  inviteId: string,
  sharedOwnerId: string,
  memberAppOwnerId: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(inviteId),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${sharedOwnerId}:${memberAppOwnerId}`),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

/**
 * The permission the owner granted this member, or `null` if the owner has no
 * record of them. A grant beats an invite: it is the later, explicit decision.
 */
export async function resolveVerifiedPermission(
  member: { userAppOwnerId: string; permission: string; inviteProof?: string | null },
  records: OwnerSideRecords,
): Promise<string | null> {
  if (member.userAppOwnerId === records.selfAppOwnerId) return member.permission;
  const grant = records.grants.get(member.userAppOwnerId);
  if (grant) return grant;
  if (!member.inviteProof) return null;
  for (const invite of records.invites) {
    const expected = await computeInviteProof(invite.id, records.sharedOwnerId, member.userAppOwnerId);
    if (expected === member.inviteProof) return invite.permission;
  }
  return null;
}

const PERMISSION_RANK: Record<string, number> = { read: 0, write: 1, admin: 2 };

/**
 * What a member really has: the lower of what they claim and what the owner
 * recorded. Never more than either.
 *
 * The claim still caps it because an owner can grant write to somebody who
 * then joins as a reader, and handing them the key would be a surprise in the
 * other direction. No record, or anything unrecognised, means read.
 */
export function effectivePermission(
  claimed: string | null | undefined,
  verified: string | null | undefined,
): "admin" | "write" | "read" {
  const claimedRank = claimed ? PERMISSION_RANK[claimed] : undefined;
  const verifiedRank = verified ? PERMISSION_RANK[verified] : undefined;
  if (claimedRank === undefined || verifiedRank === undefined) return "read";
  return claimedRank <= verifiedRank
    ? (claimed as "admin" | "write" | "read")
    : (verified as "admin" | "write" | "read");
}
