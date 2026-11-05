/**
 * Zapojení hlášení stavů do běžícího serveru. (TODO-451)
 *
 * Samotná pravidla jsou v `agentStatus.ts`, tenhle soubor je jen drát mezi
 * nimi, Evolu instancí a relayí. Drží se stranou, aby `agentStatus.ts` šel
 * testovat bez sítě i bez databáze.
 *
 * Vypnutelné přes `TODOCKO_AGENT_STATUS=off`. Když klíč ještě není k dispozici
 * nebo se nepovede zašifrovat, řádka se prostě zahodí: je to ambientní
 * informace, ne data.
 */
import { getAppOwnerEncryptionKey, getAppOwnerId } from "./evolu.js";
import { relayHttpBase } from "./tools/pure.js";
import { signOwnerRequest } from "./utils/ownerSignature.js";
import {
  createStatusReporter,
  deriveStatusKeyBytes,
  encryptStatusLine,
  summarize,
  POST_TIMEOUT_MS,
} from "./agentStatus.js";

const PATH = "/api/agent-status";

let reporter: ReturnType<typeof createStatusReporter> | null = null;
let keyBytes: Uint8Array | null = null;

function isEnabled(): boolean {
  return (process.env.TODOCKO_AGENT_STATUS || "").toLowerCase() !== "off";
}

/**
 * Odešle dávku na relay. Chyby se polykají o patro výš, v reportéru.
 *
 * Podpis je tentýž Ed25519 jako u ostatních endpointů, takže psát může jen
 * držitel ownera.
 */
async function send(items: { at: number; sessionId: string; blob: string }[]): Promise<void> {
  const ownerId = getAppOwnerId();
  const mnemonic = process.env.TODOCKO_MNEMONIC;
  if (!ownerId || !mnemonic) return;
  const body = JSON.stringify({ items });
  const headers = await signOwnerRequest(ownerId, mnemonic, "POST", PATH, body);
  await fetch(`${relayHttpBase(process.env.TODOCKO_RELAY_URL)}${PATH}`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body,
    signal: AbortSignal.timeout(POST_TIMEOUT_MS),
  });
}

/** Připraví reportér. Volá se po initEvolu, kdy už je owner k dispozici. */
export function startStatusReporting(): void {
  if (!isEnabled()) return;
  keyBytes = (() => {
    const encryptionKey = getAppOwnerEncryptionKey();
    return encryptionKey ? deriveStatusKeyBytes(encryptionKey) : null;
  })();
  if (!keyBytes) return;
  reporter = createStatusReporter({ send });
}

/**
 * Ohlásí jedno volání nástroje. Nikdy nevyhodí výjimku a na nic nečeká.
 *
 * Šifrování je asynchronní, proto to končí `void` promisou se spolknutou
 * chybou. Volající se o výsledek nezajímá a nesmí se o něj zajímat: tohle
 * běží až po tom, co nástroj doběhl.
 */
export function reportToolCall(tool: string, args: unknown): void {
  if (!reporter || !keyBytes) return;
  const line = summarize(tool, args);
  void encryptStatusLine(keyBytes, line)
    .then((blob) => reporter?.push(blob))
    .catch(() => {});
}

/** Pro testy a pro ukončení procesu: pošle, co je ve frontě. */
export function flushStatusReporting(): void {
  reporter?.flushNow();
}
