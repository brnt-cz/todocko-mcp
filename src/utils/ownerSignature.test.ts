import { describe, it, expect } from "vitest";
import { createHash, webcrypto } from "crypto";
import { signOwnerRequest, ownerPublicKeyBase64Url } from "./ownerSignature.js";

// A throwaway BIP39-shaped phrase. Never a real mnemonic in a test file.
const MNEMONIC = "test test test test test test test test test test test junk";

describe("ownerSignature", () => {
  // The relay stores one public key per owner, first-write-wins, and the app
  // registered it from its own derivation in ownerCrypto.ts. If this value
  // changes, MCP signs with a key the relay does not have and every
  // owner-authenticated call returns 401 with nothing to point at the cause.
  // Cross-checked against the app's @noble/ed25519 for this phrase.
  it("derives the same public key the app registers", async () => {
    expect(await ownerPublicKeyBase64Url(MNEMONIC)).toBe(
      "ZLKWM7CY5DM_EWowGrO8tF8eITVBTQxqZ3pfd1d4t98"
    );
  });

  it("signs the payload the relay reconstructs", async () => {
    const ownerId = "owner-under-test";
    const method = "GET";
    const path = "/api/messages?ownerId=owner-under-test";

    const headers = await signOwnerRequest(ownerId, MNEMONIC, method, path);
    expect(headers["X-Owner-Id"]).toBe(ownerId);

    // The relay builds `v1\n<owner>\n<ts>\n<method>\n<url>\n<sha256(body)>`
    // and verifies against the stored key, so verifying here the same way is
    // what proves the two agree.
    const bodyHash = createHash("sha256").update("", "utf8").digest("hex");
    const payload = new TextEncoder().encode(
      `v1\n${ownerId}\n${headers["X-Timestamp"]}\n${method}\n${path}\n${bodyHash}`
    );

    const rawPub = Buffer.from(
      (await ownerPublicKeyBase64Url(MNEMONIC)).replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    );
    const pub = await webcrypto.subtle.importKey(
      "raw",
      rawPub,
      { name: "Ed25519" },
      false,
      ["verify"]
    );
    const sig = Buffer.from(
      headers["X-Signature"].replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    );

    expect(sig.length).toBe(64);
    expect(await webcrypto.subtle.verify({ name: "Ed25519" }, pub, sig, payload)).toBe(true);
  });

  it("does not verify against a payload for a different path", async () => {
    const ownerId = "owner-under-test";
    const headers = await signOwnerRequest(ownerId, MNEMONIC, "GET", "/api/messages?ownerId=a");

    const bodyHash = createHash("sha256").update("", "utf8").digest("hex");
    const wrong = new TextEncoder().encode(
      `v1\n${ownerId}\n${headers["X-Timestamp"]}\nGET\n/api/messages?ownerId=b\n${bodyHash}`
    );
    const rawPub = Buffer.from(
      (await ownerPublicKeyBase64Url(MNEMONIC)).replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    );
    const pub = await webcrypto.subtle.importKey("raw", rawPub, { name: "Ed25519" }, false, ["verify"]);
    const sig = Buffer.from(headers["X-Signature"].replace(/-/g, "+").replace(/_/g, "/"), "base64");

    expect(await webcrypto.subtle.verify({ name: "Ed25519" }, pub, sig, wrong)).toBe(false);
  });

  it("uses a timestamp the relay will accept as current", async () => {
    const headers = await signOwnerRequest("owner-under-test", MNEMONIC, "GET", "/api/messages");
    const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(headers["X-Timestamp"]));
    expect(skew).toBeLessThan(5);
  });
});
