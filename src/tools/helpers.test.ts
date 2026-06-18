import { describe, it, expect, beforeAll } from "vitest";
import { resolveDownloadPath, assertAttachmentSize, MAX_ATTACHMENT_BYTES } from "./helpers.js";
import { resolve } from "path";

const BASE = "/tmp/todocko-dl-test";

describe("resolveDownloadPath", () => {
  beforeAll(() => {
    process.env.TODOCKO_DOWNLOAD_DIR = BASE;
  });

  it("resolves a relative filename inside the base dir", () => {
    expect(resolveDownloadPath("file.pdf")).toBe(resolve(BASE, "file.pdf"));
    expect(resolveDownloadPath("sub/file.pdf")).toBe(resolve(BASE, "sub/file.pdf"));
  });

  it("allows the base dir itself", () => {
    expect(resolveDownloadPath(".")).toBe(BASE);
  });

  it("rejects absolute paths that escape the base", () => {
    expect(() => resolveDownloadPath("/etc/passwd")).toThrow(/escapes/);
    expect(() => resolveDownloadPath("/home/user/.ssh/authorized_keys")).toThrow(/escapes/);
  });

  it("rejects ../ traversal", () => {
    expect(() => resolveDownloadPath("../../etc/cron.d/x")).toThrow(/escapes/);
    expect(() => resolveDownloadPath("../bashrc")).toThrow(/escapes/);
  });

  it("does not treat a sibling dir with the same prefix as inside", () => {
    // /tmp/todocko-dl-test-evil must NOT pass as inside /tmp/todocko-dl-test
    expect(() => resolveDownloadPath("../todocko-dl-test-evil/x")).toThrow(/escapes/);
  });
});

describe("assertAttachmentSize", () => {
  it("accepts small payloads", () => {
    expect(() => assertAttachmentSize("AAAA".repeat(10))).not.toThrow();
  });

  it("rejects payloads over the limit", () => {
    const tooBig = "A".repeat(Math.ceil((MAX_ATTACHMENT_BYTES + 1) * 4 / 3) + 8);
    expect(() => assertAttachmentSize(tooBig)).toThrow(/too large/);
  });
});
