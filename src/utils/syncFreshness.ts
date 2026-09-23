import { kyselySql } from "@evolu/common/local-first";
import { relayHttpBase } from "../tools/pure.js";
import { signOwnerRequest } from "./ownerSignature.js";

/**
 * Is this process's copy of the data complete enough to assign a task code?
 * (TODO-373)
 *
 * `td_create_task` derives the next code from the highest one it can see
 * locally. That is a write nobody can undo and nothing else checks, so when
 * part of the account has not arrived yet the maximum is too low and the code
 * it hands out is one the relay already uses.
 *
 * It happened on 2026-09-23. At 07:01 the copy did not hold TODO-360 to
 * TODO-367 and the server produced TODO-353, then 354 up to 359. At 09:33 the
 * same database file had them and carried on correctly from 368. Nothing broke
 * only because 353 to 359 happened to be free; a different missing range would
 * have produced two tasks with one code.
 *
 * The relay reports how many messages it holds for the owner, and Evolu keeps
 * one row per applied message in `evolu_timestamp`. Comparing the two answers
 * the question directly rather than by waiting a fixed number of milliseconds
 * and hoping.
 */

export type Freshness = "caught-up" | "behind" | "unknown";

export interface MessageCounts {
  /** Applied locally, null when it cannot be read. */
  local: number | null;
  /** Held by the relay for this owner, null when it could not be asked. */
  remote: number | null;
}

/**
 * Whether the local copy has everything the relay reported.
 *
 * Local above remote is still caught up, not an error: the relay count is a
 * snapshot, and this process writing meanwhile puts it ahead.
 */
export function classifyFreshness({ local, remote }: MessageCounts): Freshness {
  if (local === null || remote === null) return "unknown";
  if (!Number.isFinite(local) || !Number.isFinite(remote)) return "unknown";
  return local >= remote ? "caught-up" : "behind";
}

/** How many messages are still missing, or null when that is not known. */
export function missingMessages({ local, remote }: MessageCounts): number | null {
  if (classifyFreshness({ local, remote }) !== "behind") return null;
  return (remote as number) - (local as number);
}

const USAGE_PATH = "/api/owner-usage";

/**
 * Messages the relay holds for this owner, or null when it cannot be asked.
 *
 * Null is "unknown", never "none". A caller that treats it as zero would
 * conclude the copy is complete on every network hiccup, which is the failure
 * this exists to prevent.
 */
export async function fetchRelayMessageCount(
  ownerId: string,
  mnemonic: string,
  deps: { fetch?: typeof globalThis.fetch; baseUrl?: string } = {},
): Promise<number | null> {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const base = deps.baseUrl ?? relayHttpBase(process.env.TODOCKO_RELAY_URL);
  try {
    const headers = await signOwnerRequest(ownerId, mnemonic, "GET", USAGE_PATH);
    const response = await doFetch(`${base}${USAGE_PATH}`, { method: "GET", headers: { ...headers } });
    if (!response.ok) return null;
    const raw: unknown = await response.json();
    if (!raw || typeof raw !== "object") return null;
    const count = (raw as { messageCount?: unknown }).messageCount;
    return typeof count === "number" && Number.isFinite(count) && count >= 0 ? count : null;
  } catch {
    return null;
  }
}

/** What a refusal says, so the user knows it is a wait and not a defect. */
export function incompleteCopyMessage(missing: number | null): string {
  const gap = missing === null ? "" : ` Chybí ${missing} zpráv.`;
  return [
    "Kód úkolu se teď přidělit nedá: tenhle proces ještě nemá celý účet.",
    `Kód se odvozuje z nejvyššího, který je vidět, takže z neúplné kopie by vznikl kód, který na serveru už existuje.${gap}`,
    "Počkej, až se synchronizace dotáhne, a zkus to znovu. (TODO-373)",
  ].join("\n");
}

/**
 * Messages applied in this process's database, or null when it cannot be read.
 *
 * `evolu_timestamp` is Evolu's own table and the query builder is typed to our
 * schema, so the cast asks for it anyway and the catch covers a rename. Mirrors
 * the app's `fetchLocalMessageCount`, and the two counts were measured to match
 * the relay exactly on real data (TODO-343).
 */
export async function localMessageCount(
  evolu: { createQuery: (cb: (db: unknown) => unknown) => unknown; loadQuery: (q: unknown) => Promise<unknown> },
): Promise<number | null> {
  try {
    const query = evolu.createQuery((db: unknown) =>
      (db as { selectFrom: (t: string) => { select: (e: unknown) => unknown } })
        .selectFrom("evolu_timestamp")
        .select(kyselySql<number>`count(*)`.as("count")),
    );
    const rows = (await evolu.loadQuery(query)) as ReadonlyArray<{ count?: unknown }>;
    const count = rows[0]?.count;
    return typeof count === "number" && Number.isFinite(count) ? count : null;
  } catch {
    return null;
  }
}

/**
 * Refuse to derive a task code from a copy that is demonstrably incomplete.
 *
 * Memoised on the first "caught up": from then on this process is connected and
 * streaming, so re-asking the relay before every task would be a round trip to
 * learn what it already knows.
 *
 * `unknown` lets the write through. It would be easy to refuse there too and
 * call it safe, but the relay is unreachable in exactly the situations where a
 * local-first tool has to keep working, and refusing would turn a rare wrong
 * code into a routine dead end. The gap this closes is the one that actually
 * happened: a reachable relay and a copy that had not caught up with it.
 */
let copyKnownComplete = false;

export function __resetCopyFreshnessForTests(): void {
  copyKnownComplete = false;
}

export async function assertCopyCanNumberTasks(deps: {
  evolu: Parameters<typeof localMessageCount>[0];
  ownerId: string | null;
  mnemonic: string | undefined;
  fetchRemote?: (ownerId: string, mnemonic: string) => Promise<number | null>;
}): Promise<void> {
  if (copyKnownComplete) return;
  if (!deps.ownerId || !deps.mnemonic) return;

  const fetchRemote = deps.fetchRemote ?? ((id: string, m: string) => fetchRelayMessageCount(id, m));
  const [local, remote] = await Promise.all([
    localMessageCount(deps.evolu),
    fetchRemote(deps.ownerId, deps.mnemonic),
  ]);

  const freshness = classifyFreshness({ local, remote });
  if (freshness === "caught-up") {
    copyKnownComplete = true;
    return;
  }
  if (freshness === "behind") {
    throw new Error(incompleteCopyMessage(missingMessages({ local, remote })));
  }
}
