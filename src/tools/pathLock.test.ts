import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resolveDownloadPath, resolveUploadPath } from "./pure.js";

/**
 * The path lock on real files, not on strings. (TODO-441)
 *
 * The confinement was lexical, so a symlink INSIDE the allowed directory walked
 * straight out of it: `~/Downloads/out -> /etc` made `out/cron.d/x` look like a
 * path inside the base while the write landed in /etc, and
 * `~/Downloads/key -> ~/.ssh/id_ed25519` was read and attached. Both ends
 * follow symlinks, so both had to be fixed, and only a test touching the
 * filesystem can prove it.
 *
 * Under /var/tmp rather than /tmp: a reboot clears /tmp and takes the fixtures
 * of a running test with it.
 */
const ROOT = mkdtempSync(join(process.env.TMPDIR || "/var/tmp", "todocko-pathlock-"));
const BASE = join(ROOT, "downloads");
const OUTSIDE = join(ROOT, "outside");

beforeEach(() => {
  rmSync(BASE, { recursive: true, force: true });
  rmSync(OUTSIDE, { recursive: true, force: true });
  mkdirSync(BASE, { recursive: true });
  mkdirSync(OUTSIDE, { recursive: true });
  process.env.TODOCKO_DOWNLOAD_DIR = BASE;
  process.env.TODOCKO_UPLOAD_DIR = BASE;
});

afterEach(() => {
  delete process.env.TODOCKO_DOWNLOAD_DIR;
  delete process.env.TODOCKO_UPLOAD_DIR;
});

describe("symlink escapes", () => {
  it("refuses a download through a symlinked directory inside the base", () => {
    symlinkSync(OUTSIDE, join(BASE, "out"));
    expect(() => resolveDownloadPath("out/payload.txt")).toThrow(/escapes/);
  });

  it("refuses an upload through a symlinked file inside the base", () => {
    const secret = join(OUTSIDE, "id_ed25519");
    writeFileSync(secret, "not a real key");
    symlinkSync(secret, join(BASE, "key.txt"));
    expect(() => resolveUploadPath("key.txt")).toThrow(/escapes/);
  });

  it("says that the escape was through a symlink, since the path looks fine", () => {
    symlinkSync(OUTSIDE, join(BASE, "out"));
    expect(() => resolveDownloadPath("out/payload.txt")).toThrow(/symlink/);
  });

  it("still allows a symlink that stays inside the base", () => {
    mkdirSync(join(BASE, "real"));
    symlinkSync(join(BASE, "real"), join(BASE, "link"));
    expect(resolveDownloadPath("link/file.pdf")).toBe(join(BASE, "link", "file.pdf"));
  });

  it("allows ordinary paths when the base itself is reached through a symlink", () => {
    // /tmp is a symlink on macOS, so a resolved target compared with an
    // unresolved base would refuse everything.
    const alias = join(ROOT, "alias");
    rmSync(alias, { force: true });
    symlinkSync(BASE, alias);
    process.env.TODOCKO_DOWNLOAD_DIR = alias;
    expect(resolveDownloadPath("file.pdf")).toBe(join(alias, "file.pdf"));
  });
});

describe("download rules that uploads already had", () => {
  it("refuses a dotfile, as the upload side has since TODO-286", () => {
    expect(() => resolveDownloadPath(".bashrc")).toThrow(/dotfile/);
    expect(() => resolveDownloadPath(".config/x/y.json")).toThrow(/dotfile/);
  });

  it("refuses to replace an existing file unless overwrite was asked for", () => {
    writeFileSync(join(BASE, "report.pdf"), "the only copy");
    expect(() => resolveDownloadPath("report.pdf")).toThrow(/already exists/);
    expect(resolveDownloadPath("report.pdf", { overwrite: true })).toBe(join(BASE, "report.pdf"));
  });

  it("writes a new file without asking for anything", () => {
    expect(resolveDownloadPath("fresh.pdf")).toBe(join(BASE, "fresh.pdf"));
  });

  it("does not mistake the base directory for a file about to be destroyed", () => {
    expect(resolveDownloadPath(".")).toBe(BASE);
  });
});

describe("the download tools pass the flag on", () => {
  it("every download tool declares overwrite", async () => {
    const { allTools } = await import("./index.js");
    const downloads = allTools.filter((t) => t.name.startsWith("td_download_"));
    expect(downloads.length).toBeGreaterThanOrEqual(4);
    for (const tool of downloads) {
      const props = (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
      expect(Object.keys(props)).toContain("overwrite");
    }
  });
});
