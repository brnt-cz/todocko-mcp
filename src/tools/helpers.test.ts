import { describe, it, expect, beforeAll } from "vitest";
import { resolveDownloadPath, assertAttachmentSize, MAX_ATTACHMENT_BYTES, topPositionForNewTask, POSITION_STEP } from "./helpers.js";
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

describe("topPositionForNewTask", () => {
  it("puts a task above an empty column", () => {
    expect(topPositionForNewTask(0)).toBe(-POSITION_STEP);
  });

  it("puts a task above a column whose lowest position is 0", () => {
    expect(topPositionForNewTask(0)).toBeLessThan(0);
  });

  it("clamps a positive minimum so the result stays above position 0", () => {
    // A column numbered 10,20,30 has min 10 — the new task must still be <= -10,
    // otherwise it would land under a row sitting at 0.
    expect(topPositionForNewTask(10)).toBe(-POSITION_STEP);
  });

  it("goes below an already negative minimum", () => {
    expect(topPositionForNewTask(-30)).toBe(-40);
  });

  it("stacks repeated creations newest-first", () => {
    const first = topPositionForNewTask(0);
    const second = topPositionForNewTask(first);
    const third = topPositionForNewTask(second);
    expect([first, second, third]).toEqual([-10, -20, -30]);
  });
});
