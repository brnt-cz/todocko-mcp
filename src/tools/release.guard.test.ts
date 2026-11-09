import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

/**
 * The release workflow must stay credential-free and must keep the human gate
 * (TODO-472).
 *
 * Publishing moved from a token to trusted publishing (OIDC) because the
 * account requires 2FA for writes and npm removes token publishing in January
 * 2027. Two parts of that are easy to undo by accident and nothing else would
 * notice until a release either fails or, worse, succeeds too easily:
 *
 *  - Putting `NODE_AUTH_TOKEN` back would reintroduce a long-lived secret.
 *  - Swapping `npm stage publish` for `npm publish` would push straight to
 *    every user, removing the approval step that stands between a hijacked
 *    workflow run and the registry.
 */

const WORKFLOW = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".github", "workflows", "release.yml"),
  "utf8",
);

/** Comments explain why the token is gone, so only real YAML counts. */
const CODE = WORKFLOW.split("\n")
  .filter((l) => !l.trim().startsWith("#"))
  .join("\n");

describe("release workflow", () => {
  it("reads the file it is supposed to, so a typo cannot pass it", () => {
    expect(CODE).toContain("name: Release");
    expect(CODE).toContain("tags: ['v*']");
  });

  it("carries no npm credentials", () => {
    expect(CODE).not.toContain("NODE_AUTH_TOKEN");
    expect(CODE).not.toContain("NPM_TOKEN");
  });

  it("requests the OIDC token trusted publishing needs", () => {
    expect(CODE).toContain("id-token: write");
  });

  it("stages the release instead of publishing it", () => {
    expect(CODE).toContain("npm stage publish");
    expect(CODE).not.toMatch(/run: npm publish/);
  });

  it("keeps the provenance signature", () => {
    expect(CODE).toMatch(/npm stage publish[^\n]*--provenance/);
  });

  it("pins the npm it installs, since npm 12 disables install scripts", () => {
    expect(CODE).toMatch(/npm install -g npm@\d+\.\d+\.\d+/);
    expect(CODE).not.toContain("npm install -g npm@latest");
  });

  it("still refuses a tag that disagrees with package.json", () => {
    expect(CODE).toContain("Tag $tag != package.json $pkg");
  });
});
