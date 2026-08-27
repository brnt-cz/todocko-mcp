import { SQLITE_TRUE, type EvoluInstance } from "../evolu.js";
import { queryRows, FREE_TIER_LIMITS, freeTierWarning } from "./pure.js";

const RELAY_URL = process.env.TODOCKO_RELAY_URL || "https://relay.todocko.cz";

/** Same reverse-proxy rule as systemNotifications.ts: no container ports. */
function baseUrl(): string {
  return RELAY_URL.replace(/:400[01]\/?$/, "").replace(/\/$/, "");
}

/**
 * Is this owner on the free plan?
 *
 * `null` means "do not know" and callers must then stay silent. That is the whole
 * contract: a warning that fires because the relay was unreachable is worse than
 * no warning, and reading an absent tier as free is exactly the bug that once
 * capped paying users at free limits in the app (TODO-193).
 *
 * A successful response with `tier: null` DOES mean free — that is how a genuinely
 * free owner is reported, matching getTierLimits() in the app.
 */
async function isFreeOwner(evolu: EvoluInstance): Promise<boolean | null> {
  try {
    const owner = await Promise.race([
      Promise.resolve(evolu.appOwner),
      new Promise<null>((res) => setTimeout(() => res(null), 2000)),
    ]);
    const ownerId = (owner as { id?: string } | null)?.id;
    if (!ownerId) return null;

    const response = await fetch(`${baseUrl()}/api/owner-tier/${ownerId}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { tier?: string | null };
    return body.tier == null || body.tier === "free";
  } catch {
    return null;
  }
}

/**
 * Warning text for a create response, or "" when there is nothing to say.
 *
 * Never throws: the record is already written by the time this runs, so a failure
 * here must not turn a successful create into an error.
 */
export async function freeTierNote(
  evolu: EvoluInstance,
  kind: "project" | "task",
): Promise<string> {
  try {
    if ((await isFreeOwner(evolu)) !== true) return "";

    if (kind === "project") {
      // Non-archived, like activeOwnProjectsCount in the app's ProjectsView.
      const rows = queryRows<{ isArchived?: unknown }>(
        await evolu.loadQuery(
          evolu.createQuery((db: any) =>
            db.selectFrom("project").select(["id", "isArchived"]).where("isDeleted", "is not", SQLITE_TRUE),
          ),
        ),
      );
      const count = rows.filter((r) => !r.isArchived).length;
      return freeTierWarning("project", count, FREE_TIER_LIMITS.maxProjects);
    }

    // Active tasks only — status !== 'done', same as the app's cap.
    const rows = queryRows<{ status?: string }>(
      await evolu.loadQuery(
        evolu.createQuery((db: any) =>
          db.selectFrom("task").select(["id", "status"]).where("isDeleted", "is not", SQLITE_TRUE),
        ),
      ),
    );
    const count = rows.filter((r) => r.status !== "done").length;
    return freeTierWarning("task", count, FREE_TIER_LIMITS.maxActiveTasks);
  } catch {
    return "";
  }
}
