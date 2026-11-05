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
import { getAppOwnerEncryptionKey, getAppOwnerId, getEvolu, appSettingRowId, SQLITE_TRUE } from "./evolu.js";
import { relayHttpBase } from "./tools/pure.js";
import { signOwnerRequest, deriveOwnerPublicKeyBase64Url } from "./utils/ownerSignature.js";
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
 * Zapnul si to uživatel v aplikaci? Výchozí stav je vypnuto (TODO-451).
 *
 * Nastavení je účtové, takže ho vidí i tenhle proces. Kdyby se nečetlo,
 * posílalo by MCP stavy i tomu, kdo si je nikdy nezapnul, a relay by o nich
 * věděl zbytečně.
 *
 * Hodnota se drží v mezipaměti, protože se čte po každém volání nástroje,
 * zatímco se mění jednou za rok. Přepnutí se projeví nejpozději za
 * SETTING_TTL_MS, ne až po restartu serveru.
 */
const SETTING_TTL_MS = 30_000;
let settingValue = false;
let settingCheckedAt = 0;
let settingInFlight: Promise<void> | null = null;

function refreshSetting(): Promise<void> {
  if (settingInFlight) return settingInFlight;
  const evolu = getEvolu();
  if (!evolu) return Promise.resolve();
  const query = evolu.createQuery((db: any) =>
    db
      .selectFrom("appSetting")
      .select(["value"])
      .where("id", "=", appSettingRowId("todocko_agent_status"))
      .where("isDeleted", "is not", SQLITE_TRUE)
      .limit(1),
  );
  settingInFlight = evolu
    .loadQuery(query)
    .then((rows) => {
      settingValue = ((rows?.[0] as { value?: unknown } | undefined)?.value as string) === "true";
      settingCheckedAt = Date.now();
    })
    .catch(() => {
      settingValue = false;
      settingCheckedAt = Date.now();
    })
    .finally(() => {
      settingInFlight = null;
    });
  return settingInFlight;
}

/**
 * Zapnul si to uživatel? Čeká na načtení, když je hodnota stará.
 *
 * Čekat tady nic nestojí: celé hlášení běží mimo volání nástroje, které už
 * dávno vrátilo výsledek. Dřív se vracela hodnota z mezipaměti hned a načtení
 * se jen rozjelo na pozadí, takže první volání po startu vidělo výchozí
 * `false` a jeho řádka nevznikla. Na čerstvé databázi to bylo ještě horší:
 * než se nastavení stáhlo z relaye, bylo stejně nepravdivé i to, co přišlo
 * potom. (TODO-454)
 */
async function userWantsIt(): Promise<boolean> {
  if (Date.now() - settingCheckedAt > SETTING_TTL_MS) await refreshSetting();
  return settingValue;
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

/**
 * Zaregistruje podpisový klíč u relaye, pokud tam ještě není.
 *
 * Relay podepsané požadavky odmítá, dokud veřejný klíč ownera nezná, a zatím
 * ho registrovala jen aplikace. Na produkci to vycházelo, protože appka běží
 * dřív. U čerstvé relaye ale MCP dostávalo 401 `owner_not_registered`
 * a hlášení tiše mizelo, aniž by cokoliv řeklo. Registrace je idempotentní
 * a první zápis vyhrává, takže opakování ani souběh s appkou nevadí.
 * (TODO-451)
 */
async function ensureKeyRegistered(ownerId: string, mnemonic: string): Promise<void> {
  try {
    const publicKey = await deriveOwnerPublicKeyBase64Url(mnemonic);
    await fetch(`${relayHttpBase(process.env.TODOCKO_RELAY_URL)}/api/stripe/register-owner-key`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ownerId, publicKey }),
      signal: AbortSignal.timeout(POST_TIMEOUT_MS * 3),
    });
  } catch {
    // Nevadí: nejhorší následek je, že se stavy neukážou.
  }
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

  const ownerId = getAppOwnerId();
  const mnemonic = process.env.TODOCKO_MNEMONIC;
  if (ownerId && mnemonic) void ensureKeyRegistered(ownerId, mnemonic);

  // Načíst nastavení hned, ne až při prvním volání nástroje (TODO-454).
  //
  // `userWantsIt` vrací hodnotu z mezipaměti a tu první si bere asynchronně,
  // takže první volání po startu vidělo ještě výchozí false a jeho řádka
  // nevznikla. Na produkci to bylo vidět: hned po reconnectu měl relay nula
  // položek a jednu až po druhém volání.
  //
  // Schválně se na to NEČEKÁ. Evolu dotaz se umí zaseknout a blokovat tím
  // start serveru by bylo horší než ztracená jedna řádka; mezi startem
  // a prvním voláním je vždycky aspoň inicializace Evolu.
  refreshSetting();
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
  void (async () => {
    if (!(await userWantsIt())) return;
    const blob = await encryptStatusLine(keyBytes!, summarize(tool, args));
    reporter?.push(blob);
  })().catch(() => {});
}

/** Pro testy a pro ukončení procesu: pošle, co je ve frontě. */
export function flushStatusReporting(): void {
  reporter?.flushNow();
}
