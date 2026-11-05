/**
 * Reading and writing the owner's record of member permissions. (app TODO-440)
 *
 * Ported for MCP round XI (TODO-112). What the record means and how it is
 * checked is in ../memberVerification.ts; this module is only the part that
 * needs the personal Evolu instance, which is where the record lives so that
 * no member of the shared project can reach it.
 */
import { String as EvoluString } from "@evolu/common";
import {
  SQLITE_TRUE,
  getEvolu,
  getAppOwnerId,
  memberGrantRowId,
  type EvoluInstance,
} from "../evolu.js";
import type { OwnerSideRecords } from "../memberVerification.js";
import { createMutationWaiter } from "./helpers.js";

function requireEvolu(): EvoluInstance {
  const evolu = getEvolu();
  if (!evolu) throw new Error("Evolu not initialized");
  return evolu;
}

/** Everything the owner recorded for one shared project. */
export async function loadOwnerSideRecords(sharedOwnerId: string): Promise<OwnerSideRecords> {
  const evolu = requireEvolu();
  const invitesQuery = evolu.createQuery((db: any) =>
    db
      .selectFrom("shareInvite")
      .select(["id", "sharedOwnerId", "permission"])
      .where("isDeleted", "is not", SQLITE_TRUE),
  );
  const grantsQuery = evolu.createQuery((db: any) =>
    db
      .selectFrom("memberGrant")
      .select(["id", "sharedOwnerId", "memberAppOwnerId", "permission"])
      .where("isDeleted", "is not", SQLITE_TRUE),
  );
  const [invites, grants] = await Promise.all([
    evolu.loadQuery(invitesQuery) as Promise<any[]>,
    evolu.loadQuery(grantsQuery) as Promise<any[]>,
  ]);

  const grantMap = new Map<string, string>();
  for (const grant of grants ?? []) {
    if (grant.sharedOwnerId !== sharedOwnerId) continue;
    if (!grant.memberAppOwnerId || !grant.permission) continue;
    grantMap.set(grant.memberAppOwnerId as string, grant.permission as string);
  }

  return {
    selfAppOwnerId: getAppOwnerId() ?? "",
    sharedOwnerId,
    grants: grantMap,
    invites: (invites ?? []).flatMap((invite) =>
      invite.sharedOwnerId === sharedOwnerId && invite.id && invite.permission
        ? [{ id: invite.id as string, permission: invite.permission as string }]
        : [],
    ),
  };
}

/**
 * Record what the owner just decided for a member. One row per member.
 *
 * Goes to the personal instance, never the shared one: this is the record the
 * member must not be able to write. The id is derived from the pair, so the
 * owner's second device lands on the same row.
 */
export async function recordMemberGrant(
  sharedOwnerId: string,
  memberAppOwnerId: string,
  permission: string,
): Promise<void> {
  const evolu = requireEvolu();
  const waiter = createMutationWaiter();
  evolu.upsert(
    "memberGrant",
    {
      id: memberGrantRowId(sharedOwnerId, memberAppOwnerId),
      sharedOwnerId: EvoluString.orThrow(sharedOwnerId),
      memberAppOwnerId: EvoluString.orThrow(memberAppOwnerId),
      permission: EvoluString.orThrow(permission),
    },
    { onComplete: waiter.onComplete },
  );
  await waiter.waitForSync();
}
