import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { VERSION } from "./version.js";

/**
 * The version must come from package.json, not from a literal (TODO-473).
 *
 * It was written out by hand in `src/index.ts` and `src/cli.ts` and said
 * `1.0.0` in both at package version 3.10.3. Nothing failed, nothing warned:
 * a stale version number looks exactly like a correct one.
 */
describe("VERSION", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  };

  it("matches package.json", () => {
    expect(VERSION).toBe(pkg.version);
  });

  it("is a real version, not the fallback", () => {
    expect(VERSION).not.toBe("0.0.0-unknown");
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("is not announced as a literal anywhere", () => {
    for (const file of ["src/index.ts", "src/cli.ts"]) {
      const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      expect(src).not.toMatch(/version:\s*["']\d+\.\d+\.\d+["']/);
      expect(src).not.toMatch(/\.version\(\s*["']\d+\.\d+\.\d+["']\s*\)/);
    }
  });
});
