import { createHash, webcrypto } from "crypto";

/**
 * Ed25519 request signing for the relay's owner-authenticated endpoints
 * (TODO-112).
 *
 * `/api/messages` GET and DELETE are admin-owner only and, since TODO-90 H2,
 * are not satisfied by knowing the ownerId: the relay requires an Ed25519
 * signature and derives the admin check from the verified signer. MCP had no
 * way to produce one, which is why the user-message endpoints had no tools at
 * all while the broadcast ones did.
 *
 * Derivation and payload format mirror the app's `src/utils/ownerCrypto.ts`
 * exactly. They have to: the relay stores one public key per owner
 * first-write-wins, so a different derivation would produce a key the relay
 * rejects. The private key is derived on demand and never leaves this process.
 */

const ED25519_INFO = new TextEncoder().encode("todocko/ed25519-owner-v1");
const HKDF_SALT = new TextEncoder().encode("todocko-owner-key-v1");

// Keyed by nothing the caller supplies, so a wrong mnemonic cannot poison it.
let cachedFor: string | null = null;
let cachedKey: webcrypto.CryptoKey | null = null;

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function deriveOwnerPrivateKey(mnemonic: string): Promise<webcrypto.CryptoKey> {
  if (cachedFor === mnemonic && cachedKey) return cachedKey;

  const seed = new TextEncoder().encode(mnemonic.normalize("NFKD"));
  const baseKey = await webcrypto.subtle.importKey("raw", seed, "HKDF", false, ["deriveBits"]);
  const bits = await webcrypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-512", salt: HKDF_SALT, info: ED25519_INFO },
    baseKey,
    32 * 8
  );

  // The app feeds these 32 bytes to @noble/ed25519 as the private scalar seed,
  // which is what PKCS#8 wraps, so the same bytes give the same public key.
  const pkcs8 = Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    Buffer.from(new Uint8Array(bits)),
  ]);
  const key = await webcrypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, false, ["sign"]);

  cachedFor = mnemonic;
  cachedKey = key;
  return key;
}

export interface SignedRequestHeaders {
  "X-Owner-Id": string;
  "X-Timestamp": string;
  "X-Signature": string;
}

/**
 * Sign one request. `path` must be exactly what the relay will receive,
 * including the query string, because it is part of the signed payload.
 */
export async function signOwnerRequest(
  ownerId: string,
  mnemonic: string,
  method: string,
  path: string,
  body = ""
): Promise<SignedRequestHeaders> {
  const privateKey = await deriveOwnerPrivateKey(mnemonic);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const bodyHash = createHash("sha256").update(body, "utf8").digest("hex");
  const payload = new TextEncoder().encode(
    `v1\n${ownerId}\n${timestamp}\n${method}\n${path}\n${bodyHash}`
  );
  const signature = await webcrypto.subtle.sign({ name: "Ed25519" }, privateKey, payload);
  return {
    "X-Owner-Id": ownerId,
    "X-Timestamp": timestamp,
    "X-Signature": base64Url(new Uint8Array(signature)),
  };
}

/** The public key for this mnemonic, base64url, as the relay stores it. */
export async function ownerPublicKeyBase64Url(mnemonic: string): Promise<string> {
  const seed = new TextEncoder().encode(mnemonic.normalize("NFKD"));
  const baseKey = await webcrypto.subtle.importKey("raw", seed, "HKDF", false, ["deriveBits"]);
  const bits = await webcrypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-512", salt: HKDF_SALT, info: ED25519_INFO },
    baseKey,
    32 * 8
  );
  const pkcs8 = Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    Buffer.from(new Uint8Array(bits)),
  ]);
  const key = await webcrypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, true, ["sign"]);
  const jwk = await webcrypto.subtle.exportKey("jwk", key);
  // The x member of an Ed25519 JWK is the public key, already base64url.
  return jwk.x as string;
}
