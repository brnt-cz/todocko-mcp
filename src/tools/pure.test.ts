import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { assertMutation, resolveUploadPath, relayHttpBase } from "./pure.js";

/**
 * These guard the v7 -> v8 change in what a mutation returns (TODO-88).
 *
 * v7 gave back a `Result`, so this helper asserted `result.ok`. v8 returns the
 * row as `{ id }` and raises on an invalid change, so `ok` is absent — the
 * assertion then failed on every successful write, and 40-odd call sites
 * across the tools reported "failed" for changes they had just applied.
 */
describe("assertMutation", () => {
  it("accepts what v8 actually returns", () => {
    expect(() => assertMutation("insert", { id: "ctl8XKoIV189fSIai4EjAQ" })).not.toThrow();
  });

  it("does not require an `ok` field, which v8 never sets", () => {
    // The exact shape that used to throw. If this test fails, every update and
    // delete tool is reporting failure for a write that went through.
    expect(() => assertMutation("update", { id: "abc" } as { id: string; ok?: boolean })).not.toThrow();
  });

  it("still catches a mutation that came back without a row id", () => {
    expect(() => assertMutation("update", {})).toThrow(/no row id/);
    expect(() => assertMutation("update", { id: "" })).toThrow(/no row id/);
    expect(() => assertMutation("update", { id: 42 })).toThrow(/no row id/);
  });

  it("names the operation in the message, so the caller knows which write", () => {
    expect(() => assertMutation("deleteChecklistItem", {})).toThrow(/deleteChecklistItem/);
  });
});

describe("resolveUploadPath (TODO-286)", () => {
  const base = "/tmp/todocko-upload-test";

  beforeEach(() => {
    process.env.TODOCKO_UPLOAD_DIR = base;
  });

  afterEach(() => {
    delete process.env.TODOCKO_UPLOAD_DIR;
    delete process.env.TODOCKO_DOWNLOAD_DIR;
  });

  it("accepts a relative path inside the base", () => {
    expect(resolveUploadPath("shot.png")).toBe(`${base}/shot.png`);
    expect(resolveUploadPath("sub/shot.png")).toBe(`${base}/sub/shot.png`);
  });

  it("refuses an absolute path outside the base", () => {
    expect(() => resolveUploadPath("/etc/passwd")).toThrow(/escapes/);
    expect(() => resolveUploadPath("/home/someone/.ssh/id_ed25519")).toThrow(/escapes/);
  });

  it("refuses a traversal escape", () => {
    expect(() => resolveUploadPath("../secrets.txt")).toThrow(/escapes/);
    expect(() => resolveUploadPath("sub/../../secrets.txt")).toThrow(/escapes/);
  });

  it("refuses a sibling directory that merely shares the prefix", () => {
    process.env.TODOCKO_UPLOAD_DIR = "/tmp/uploads";
    expect(() => resolveUploadPath("../uploads-evil/x.png")).toThrow(/escapes/);
  });

  it("refuses a dotfile even inside the base", () => {
    // The attacks worth caring about name a dotfile: .env, .npmrc, .git/config.
    expect(() => resolveUploadPath(".env")).toThrow(/dotfile/);
    expect(() => resolveUploadPath("sub/.npmrc")).toThrow(/dotfile/);
    expect(() => resolveUploadPath(".git/config")).toThrow(/dotfile/);
  });

  it("falls back to the download directory when no upload directory is set", () => {
    delete process.env.TODOCKO_UPLOAD_DIR;
    process.env.TODOCKO_DOWNLOAD_DIR = "/tmp/todocko-dl";
    expect(resolveUploadPath("a.png")).toBe("/tmp/todocko-dl/a.png");
  });
});

describe("relayHttpBase (TODO-288)", () => {
  it("keeps an https URL as it is", () => {
    expect(relayHttpBase("https://relay.todocko.cz")).toBe("https://relay.todocko.cz");
  });

  it("converts the websocket schemes the sync layer accepts", () => {
    // TODOCKO_RELAY_URL may hold wss:// (TODO-266). fetch() throws on it, which
    // surfaced as "fetch failed" in two tools and as a swallowed null in the
    // tier check - read as "not on the free plan".
    expect(relayHttpBase("wss://relay.todocko.cz")).toBe("https://relay.todocko.cz");
    expect(relayHttpBase("ws://localhost")).toBe("http://localhost");
  });

  it("strips the container ports, which are not reachable behind the proxy", () => {
    expect(relayHttpBase("https://relay.todocko.cz:4000")).toBe("https://relay.todocko.cz");
    expect(relayHttpBase("wss://relay.todocko.cz:4001/")).toBe("https://relay.todocko.cz");
  });

  it("strips a trailing slash so paths do not double up", () => {
    expect(relayHttpBase("https://relay.todocko.cz/")).toBe("https://relay.todocko.cz");
  });

  it("falls back to production when the variable is unset or blank", () => {
    expect(relayHttpBase(undefined)).toBe("https://relay.todocko.cz");
    expect(relayHttpBase("")).toBe("https://relay.todocko.cz");
  });

  it("leaves a port that is not a container port alone", () => {
    expect(relayHttpBase("http://localhost:5173")).toBe("http://localhost:5173");
  });
})
