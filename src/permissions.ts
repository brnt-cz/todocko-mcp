/**
 * Shared-project permissions, ported from the app's `src/db/permissions.ts`.
 * (TODO-434)
 *
 * The MCP wrote into any shared project it had the secret for, whatever the
 * user's role there: a member with read-only access could edit tasks, delete
 * the project or change other members' permissions through this server, while
 * the app refused all of it. The rules below are the app's, unchanged, so the
 * two cannot disagree about who may do what. Like the app's module this one
 * has no runtime imports, so it can be tested without starting Evolu.
 *
 * Every function takes a plain string, not a union: the value comes from an
 * Evolu `String` column and is not guaranteed to be one of the three levels.
 * An unrecognised value answers "no", the only safe default for a permission.
 */

/** May a member with this permission change anything? */
export function canWrite(permission: string | null | undefined): boolean {
  return permission === "admin" || permission === "write";
}

/** Does this permission carry admin rights? Says nothing about ownership. */
export function canAdmin(permission: string | null | undefined): boolean {
  return permission === "admin";
}

/**
 * May this member write, all things considered?
 *
 * A blocked or pending member does not write whatever their row says, and here
 * neither does a kicked one, which the app expresses by dropping the row from
 * the member list before asking.
 */
export function memberCanWrite(member: {
  isBlocked?: boolean | null;
  isPending?: boolean | null;
  isKicked?: boolean | null;
  permission?: string | null;
}): boolean {
  return !member.isBlocked && !member.isPending && !member.isKicked && canWrite(member.permission);
}

/**
 * Owner or admin.
 *
 * The same answer as {@link canAdmin} in practice, because an owner's own
 * projectRef is created with `permission: 'admin'`. Kept as the app spells it.
 */
export function isProjectAdmin(ref: { isOwner?: boolean | null; permission?: string | null }): boolean {
  return ref.isOwner === true || canAdmin(ref.permission);
}

/** What a shared tool needs: reading, writing data, or managing the project. */
export type SharedAccess = "read" | "write" | "admin";

/** The columns of the user's own projectRef that the gate reads. */
export interface SharedRefAccess {
  name?: string | null;
  permission?: string | null;
  isOwner?: boolean | null;
}

/**
 * Why this access is refused, or null when it is allowed.
 *
 * - `read` is never refused here. Holding the secret already means holding the
 *   data, so a check would protect nothing.
 * - `write` needs {@link canWrite}, as the app's `assertWritePermission`.
 * - `admin` needs {@link isProjectAdmin}, as the app gates project settings,
 *   deployment stages, repository links, tags and members.
 *
 * A missing ref is a refusal for both writes: without it there is no
 * permission to check, and an unknown permission must not read as allowed.
 */
export function sharedAccessRefusal(ref: SharedRefAccess | null, access: SharedAccess): string | null {
  if (access === "read") return null;
  if (!ref) {
    return (
      "No project reference for this sharedOwnerId in your account, so your permission in it " +
      "cannot be checked. Writes are refused; join the project in the app first."
    );
  }
  const name = ref.name ? `"${ref.name}"` : "this shared project";
  if (access === "write" && !canWrite(ref.permission)) {
    return `No write permission for ${name} (your permission: ${ref.permission ?? "none"}).`;
  }
  if (access === "admin" && !isProjectAdmin(ref)) {
    return `Only the owner or an admin can do this in ${name} (your permission: ${ref.permission ?? "none"}).`;
  }
  return null;
}

const RANK: Record<string, number> = { admin: 3, write: 2, read: 1 };

/**
 * The one ref to judge by when an account holds several for the same owner.
 *
 * Duplicate refs are a data fault in the user's own instance, which only the
 * user can write, so preferring the strongest one cannot escalate anybody; it
 * only avoids refusing a write the app would allow. Ties keep input order.
 */
export function pickProjectRef<T extends SharedRefAccess>(refs: readonly T[]): T | null {
  let best: T | null = null;
  for (const ref of refs) {
    const score = (ref.isOwner ? 10 : 0) + (RANK[ref.permission ?? ""] ?? 0);
    const bestScore = best ? (best.isOwner ? 10 : 0) + (RANK[best.permission ?? ""] ?? 0) : -1;
    if (score > bestScore) best = ref;
  }
  return best;
}

/** A member row as td_update_shared_member sees it. */
export interface MemberState {
  permission?: string | null;
  isBlocked?: boolean | null;
  isPending?: boolean | null;
  isKicked?: boolean | null;
}

/**
 * Why td_update_shared_member must not make this change, or null when it may.
 *
 * The app follows every member change with `syncWriteKeyAfterMemberChange`
 * (TODO-268, TODO-410): when the member ends up unable to write, the project's
 * write key is rotated away from them; when they end up able to, they are
 * handed the current key. Without the rotation a blocked member keeps writing,
 * because the key they derive from `ownerSecret` still works at the relay, and
 * that holds for a read-only or pending member too, which is why the app
 * rotates on rejecting one or on blocking a reader. Porting the rotation means
 * the relay handshake and handing keys to every remaining writer, so this
 * server refuses the changes that need it instead of making a block that only
 * looks like one:
 *
 * - ending without write (block, kick, reject, any change leaving `read`)
 *   always needs a rotation;
 * - ending with write (approve, unblock, upgrade) needs the current key handed
 *   over, which is a no-op until the first rotation. With `projectRef.writeKey`
 *   still null the member derives the right key themselves, so it is allowed.
 *
 * Also the app's rule that only the owner may block another admin.
 */
export function memberChangeRefusal(
  before: MemberState,
  change: MemberState,
  context: { actorIsOwner: boolean; hasRotatedWriteKey: boolean },
): string | null {
  if (change.permission !== undefined && !(String(change.permission) in RANK)) {
    return `Unknown permission "${change.permission}"; use admin, write or read.`;
  }
  if (!context.actorIsOwner && canAdmin(before.permission) && change.isBlocked === true) {
    return "Only the project owner can block an admin.";
  }
  const after: MemberState = {
    permission: change.permission !== undefined ? change.permission : before.permission,
    isBlocked: change.isBlocked !== undefined ? change.isBlocked : before.isBlocked,
    isPending: change.isPending !== undefined ? change.isPending : before.isPending,
    isKicked: change.isKicked !== undefined ? change.isKicked : before.isKicked,
  };
  if (!memberCanWrite(after)) {
    return (
      "After this change the member cannot write, which needs the project's write key rotated so " +
      "the key they already hold stops working. The MCP cannot rotate keys; block, remove, reject " +
      "or downgrade the member in the Todocko app."
    );
  }
  // A member who could already write holds the current key, so moving them
  // between write and admin hands nothing over.
  if (context.hasRotatedWriteKey && !memberCanWrite(before)) {
    return (
      "This change gives the member write access, and the project's write key has been rotated, " +
      "so they need the current key handed over. The MCP cannot do that; approve, unblock or " +
      "upgrade the member in the Todocko app."
    );
  }
  return null;
}
