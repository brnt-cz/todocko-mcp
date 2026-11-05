import { createOwnerWebSocketTransport, deriveShardOwner } from "@evolu/common";
import type { OwnerWebSocketTransport, ShardOwner } from "@evolu/common";
import { syncStateToOwnerSyncStatus } from "@evolu/common/local-first";
import { getAppOwner, getAppOwnerId, getAppSyncState, getEvolu, getRelayServers } from "./evolu.js";
import { relayHttpBase } from "./tools/pure.js";
import { signOwnerRequest } from "./utils/ownerSignature.js";

/**
 * Obsah přílohy ve vlastním shardu, strana MCP. (TODO-450)
 *
 * Musí to dělat totéž co aplikace, jinak se obě poloviny rozejdou tiše:
 * příloha nahraná v aplikaci by se v MCP stáhla prázdná a obráceně. Proto je
 * tenhle modul zrcadlem `src/db/attachmentShards.ts` v aplikaci, včetně
 * pořadí při mazání a včetně přihlášky do skupiny účtu.
 *
 * Odvození je deterministické, tedy stejná cesta dá na obou stranách i na
 * všech zařízeních téhož ownera. Ukládat tedy není co; v řádku přílohy je jen
 * značka `contentShard`, podle které se pozná, že obsah není u AppOwnera.
 *
 * Shardy se neregistrují natrvalo ze stejného důvodu jako v aplikaci: adresa
 * transportu nese owner id, takže každý registrovaný shard je vlastní
 * WebSocket, a účet jich má tolik, kolik má příloh.
 */

/** Jak dlouho se čeká, než se shard prohlásí za nahraný nebo stažený. */
const SYNC_TIMEOUT_MS = 30_000;

/** Cesta k shardu s obsahem jedné přílohy. */
export function attachmentShardPath(attachmentId: string): string {
  return `attachment/${attachmentId}`;
}

/** Owner shardu z jeho cesty, odvozený z tajemství účtu. */
export function shardOwnerOf(contentShard: string): ShardOwner {
  const appOwner = getAppOwner();
  if (!appOwner) throw new Error("Evolu is not initialized yet, so no shard owner can be derived");
  const [, attachmentId = ""] = contentShard.split("/");
  return deriveShardOwner(appOwner as never, ["attachment", attachmentId]) as ShardOwner;
}

/** Registrace, které právě držíme, s počítadlem: dva čtenáři se nesmí odhlásit navzájem. */
const registrations = new Map<string, { unuse: () => void; count: number }>();

function acquire(owner: ShardOwner): void {
  const key = owner.id as string;
  const existing = registrations.get(key);
  if (existing) {
    existing.count += 1;
    return;
  }
  const evolu = getEvolu();
  if (!evolu) throw new Error("Evolu is not initialized yet");
  const transports = getRelayServers().map((url) =>
    createOwnerWebSocketTransport({ url, ownerId: owner.id }),
  ) as unknown as readonly [OwnerWebSocketTransport, ...OwnerWebSocketTransport[]];
  registrations.set(key, { unuse: (evolu as any).useOwner(owner, transports), count: 1 });
}

function release(owner: ShardOwner): void {
  const key = owner.id as string;
  const existing = registrations.get(key);
  if (!existing) return;
  existing.count -= 1;
  if (existing.count > 0) return;
  registrations.delete(key);
  try {
    existing.unuse();
  } catch {
    // Po `deleteOwner` ruší registrace Evolu samo a `unuse` pak nedělá nic.
  }
}

/**
 * Počká, až je owner u relaye vyrovnaný.
 *
 * `false` znamená „ještě ne", ne chybu. U nahrávání je ten rozdíl podstatný:
 * nedokončené nahrání se musí ohlásit volajícímu, aby obsah nevypadal uložený.
 */
export function waitForOwnerSynced(ownerId: string, timeoutMs = SYNC_TIMEOUT_MS): Promise<boolean> {
  const state = getAppSyncState();
  // Bez stavu se čekat nedá; tvrdit „nahráno" by bylo horší než přiznat „nevím".
  if (!state) return Promise.resolve(false);
  const isSynced = () => syncStateToOwnerSyncStatus(state.get(), state.name as never, ownerId as never).type === "Synced";
  if (isSynced()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    const unsubscribe = state.subscribe(() => {
      if (isSynced()) finish(true);
    });
    if (isSynced()) finish(true);
  });
}

async function signedRelayCall(method: "POST" | "DELETE", path: string, payload: unknown): Promise<{ status: number; body: any }> {
  const ownerId = getAppOwnerId();
  if (!ownerId) throw new Error("Evolu is not initialized yet, so there is no owner to sign as");
  const mnemonic = process.env.TODOCKO_MNEMONIC;
  if (!mnemonic) throw new Error("TODOCKO_MNEMONIC is required to sign an owner-authenticated request");
  const body = JSON.stringify(payload);
  const headers = await signOwnerRequest(ownerId, mnemonic, method, path, body);
  const response = await fetch(`${relayHttpBase(process.env.TODOCKO_RELAY_URL)}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

/**
 * Nahlásí shard relayi a počká, až je nahraný.
 *
 * Přihláška do skupiny účtu je o kvótě (TODO-457): bez ní má shard vlastní
 * plný limit a účet by si ho rozdělením dat obešel. Nepovedená přihláška
 * nahrávání neshazuje, obsah se musí uložit tak jako tak.
 */
export async function publishShard(contentShard: string): Promise<boolean> {
  const owner = shardOwnerOf(contentShard);
  const accountOwnerId = getAppOwnerId();
  if (accountOwnerId) {
    try {
      await signedRelayCall("POST", "/api/owner-group", { ownerId: accountOwnerId, members: [owner.id as string] });
    } catch (e) {
      console.error(`[attachmentShards] group registration failed: ${String(e)}`);
    }
  }
  acquire(owner);
  try {
    return await waitForOwnerSynced(owner.id as string);
  } finally {
    release(owner);
  }
}

/** Zpřístupní obsah shardu lokálně na dobu čtení a registraci po sobě zruší. */
export async function withShardContent<T>(contentShard: string, read: () => Promise<T>): Promise<T> {
  const owner = shardOwnerOf(contentShard);
  acquire(owner);
  try {
    await waitForOwnerSynced(owner.id as string);
    return await read();
  } finally {
    release(owner);
  }
}

/**
 * Smaže shard na relayi a potom lokálně.
 *
 * Pořadí je dané: opačně by lokální kopie zmizela, na relayi by data zůstala
 * a nikdo by se k nim už nevrátil, protože cesta k shardu odchází s řádkem
 * přílohy. Relay žádá k cizímu ownerovi ve skupině jeho zapisovací klíč.
 */
export async function deleteShard(contentShard: string): Promise<boolean> {
  const owner = shardOwnerOf(contentShard);
  const accountOwnerId = getAppOwnerId();
  if (!accountOwnerId) return false;
  try {
    const result = await signedRelayCall("DELETE", "/api/owner-data", {
      ownerId: owner.id as string,
      writeKey: Buffer.from(owner.writeKey).toString("base64url"),
    });
    // 404 je „relay o ownerovi nic neví", tedy nebylo co mazat.
    if (result.status !== 200 && result.status !== 404) {
      console.error(`[attachmentShards] relay refused to delete the shard: ${result.status} ${result.body?.error ?? ""}`);
      return false;
    }
  } catch (e) {
    console.error(`[attachmentShards] relay delete failed: ${String(e)}`);
    return false;
  }

  const evolu = getEvolu();
  if (!evolu) return false;
  const deleted = await (evolu as any).deleteOwner(owner);
  registrations.delete(owner.id as string);
  return deleted?.ok === true;
}
