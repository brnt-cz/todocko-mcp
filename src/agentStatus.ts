/**
 * Hlášení toho, co MCP právě dělá, pro mini obrazovku v aplikaci. (TODO-451)
 *
 * Po každém volání nástroje vznikne jedna krátká řádka, zašifruje se a pošle
 * na relay, kde žije dvě minuty v paměti. Aplikace si je tahá a ukazuje je
 * v plovoucí pilulce.
 *
 * Tři věci, které tenhle soubor drží, a všechny tři jsou podstatné:
 *
 * 1. **Shrnutí se skládá ze seznamu povolených polí**, ne z toho, co zrovna
 *    v argumentech je. Jinak by nový nástroj začal posílat cokoliv, co mu kdo
 *    předá, a nikdo by si toho nevšiml.
 * 2. **Obsah je zašifrovaný** klíčem odvozeným z AppOwnera. Relay o obsahu dat
 *    nic neví a tahle funkce na tom nesmí nic změnit.
 * 3. **Odeslání nesmí nikomu překážet.** Je to pošli a nečekej, se vteřinovým
 *    stropem a spolknutou chybou: když relay neodpovídá, volání nástroje se
 *    o to nesmí ani zpomalit, ani spadnout.
 */
import { createSlip21 } from "@evolu/common";
import { randomUUID, webcrypto } from "node:crypto";

/** Jak dlouho se sbírá, než se dávka pošle. Dvacet volání za vteřinu je jeden POST. */
export const FLUSH_DELAY_MS = 300;

/** Strop na jedno odeslání. Déle čekat nemá smysl, řádka je stejně za chvíli stará. */
export const POST_TIMEOUT_MS = 1000;

/** Kolik řádek si držíme ve frontě, než začneme zahazovat ty nejstarší. */
export const MAX_QUEUE = 20;

/** Nejdelší detail v řádce. Není to datový kanál. */
export const MAX_DETAIL_LENGTH = 60;

/**
 * Argumenty, které smí do shrnutí. Jsou to identifikátory a volby, ne obsah.
 *
 * Co v seznamu není, se do řádky nedostane, i kdyby to nástroj přijímal.
 */
const ALLOWED_ARG_KEYS = [
  "code", "id", "taskId", "projectId", "projectCode", "noteId", "tagId",
  "worklogId", "sharedOwnerId", "query", "status", "key", "type",
] as const;

/**
 * Co se do řádky nedostane nikdy, ani kdyby to někdo přidal do seznamu výš.
 *
 * Pojistka proti překlepu v budoucnu, hlídá ji test. `ownerSecret` je klíč
 * k celému sdílenému projektu, `content` a `description` jsou data uživatele.
 */
const NEVER_ARG_KEYS = new Set([
  "ownerSecret", "mnemonic", "content", "description", "data", "value",
  "filePath", "blockedReason", "blob", "token", "password",
]);

/** Sloveso podle předpony nástroje, aby řádka byla věta a ne identifikátor. */
const VERBS: ReadonlyArray<readonly [string, string]> = [
  ["td_list_", "vypisuje"],
  ["td_get_", "čte"],
  ["td_search_", "hledá"],
  ["td_create_", "zakládá"],
  ["td_add_", "přidává"],
  ["td_update_", "upravuje"],
  ["td_set_", "nastavuje"],
  ["td_delete_", "maže"],
  ["td_bulk_", "hromadně mění"],
  ["td_upload_", "nahrává"],
  ["td_download_", "stahuje"],
  ["td_mark_", "označuje"],
  ["td_analyze_", "analyzuje"],
  ["td_force_", "vynucuje"],
];

export interface StatusLine {
  /** Název nástroje, tak jak přišel. */
  tool: string;
  /** Sloveso pro člověka. */
  verb: string;
  /** Na čem, pokud to šlo zjistit z povolených argumentů. */
  detail: string | null;
}

/** Sloveso a předmět z názvu nástroje. Neznámý tvar dostane obecné sloveso. */
export function describeTool(tool: string): { verb: string; object: string } {
  for (const [prefix, verb] of VERBS) {
    if (tool.startsWith(prefix)) {
      return { verb, object: tool.slice(prefix.length) };
    }
  }
  return { verb: "volá", object: tool.replace(/^td_/, "") };
}

/**
 * Řádka z názvu nástroje a jeho argumentů.
 *
 * Detail je první povolený argument, který má smysl ukázat. `code` jde před
 * `id`, protože TODO-123 je pro člověka čitelnější než náhodné id.
 */
export function summarize(tool: string, args: unknown): StatusLine {
  const { verb, object } = describeTool(tool);
  const record = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;

  let detail: string | null = null;
  for (const key of ALLOWED_ARG_KEYS) {
    if (NEVER_ARG_KEYS.has(key)) continue;
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      detail = value.slice(0, MAX_DETAIL_LENGTH);
      break;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      detail = String(value);
      break;
    }
  }

  return { tool, verb, detail: detail ?? object.replace(/_/g, " ") };
}

/**
 * Symetrický klíč pro stavy, odvozený z AppOwnera stejně jako shard.
 *
 * `createSlip21` chce značku `Entropy`, která říká, odkud bajty pocházejí.
 * Volající je bere z owner objektu, takže podmínka platí, jen se typ cestou
 * přes náš přístupový bod ztratí.
 */
export function deriveStatusKeyBytes(encryptionKey: Uint8Array): Uint8Array {
  return createSlip21(encryptionKey as Parameters<typeof createSlip21>[0], ["todocko", "agent-status"]);
}

const subtle = webcrypto.subtle;

function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/**
 * Zašifruje řádku. Výstup je `base64url(iv ‖ ciphertext)`.
 *
 * AES-GCM s náhodným dvanáctibajtovým IV, tedy totéž, co umí prohlížeč.
 * Aplikace to dešifruje stejným postupem; drží je kontrolní vektor v testech
 * na obou stranách.
 */
export async function encryptStatusLine(keyBytes: Uint8Array, line: StatusLine): Promise<string> {
  const key = await subtle.importKey("raw", keyBytes as unknown as ArrayBuffer, "AES-GCM", false, ["encrypt"]);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(line));
  const cipher = new Uint8Array(
    await subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext as unknown as ArrayBuffer),
  );
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv, 0);
  out.set(cipher, iv.length);
  return bytesToBase64Url(out);
}

/** Dešifrování, jen pro testy a sondy. V provozu to dělá aplikace. */
export async function decryptStatusLine(keyBytes: Uint8Array, blob: string): Promise<StatusLine> {
  const raw = new Uint8Array(Buffer.from(blob, "base64url"));
  const key = await subtle.importKey("raw", keyBytes as unknown as ArrayBuffer, "AES-GCM", false, ["decrypt"]);
  const plain = await subtle.decrypt(
    { name: "AES-GCM", iv: raw.slice(0, 12) },
    key,
    raw.slice(12) as unknown as ArrayBuffer,
  );
  return JSON.parse(new TextDecoder().decode(plain)) as StatusLine;
}

interface QueuedItem {
  at: number;
  sessionId: string;
  blob: string;
}

export interface StatusReporterDeps {
  /** Odešle dávku. Oddělené kvůli testům a kvůli tomu, že selhání se polyká. */
  send: (items: QueuedItem[]) => Promise<void>;
  now?: () => number;
  setTimeoutFn?: typeof setTimeout;
}

/**
 * Fronta s odkladem. Sbírá řádky a jednou za `FLUSH_DELAY_MS` je pošle.
 *
 * Záměrně nemá žádnou obsluhu chyb navenek: když `send` selže, dávka se zahodí
 * a nikdo se to nedozví. Stav je ambientní informace, ne data; opakovat zápis
 * nebo hlásit chybu by stálo víc, než co je ta informace hodná.
 */
export function createStatusReporter(deps: StatusReporterDeps) {
  const now = deps.now ?? (() => Date.now());
  const schedule = deps.setTimeoutFn ?? setTimeout;
  const sessionId = randomUUID().slice(0, 8);
  let queue: QueuedItem[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    timer = null;
    if (queue.length === 0) return;
    const batch = queue;
    queue = [];
    void deps.send(batch).catch(() => {});
  };

  return {
    sessionId,
    /** Zařadí hotovou zašifrovanou řádku. Nikdy nevyhodí výjimku. */
    push(blob: string): void {
      queue.push({ at: now(), sessionId, blob });
      if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
      if (timer === null) timer = schedule(flush, FLUSH_DELAY_MS);
    },
    /** Pošle hned, co je ve frontě. Pro testy a pro ukončení procesu. */
    flushNow(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      flush();
    },
    pendingForTests(): number {
      return queue.length;
    },
  };
}
