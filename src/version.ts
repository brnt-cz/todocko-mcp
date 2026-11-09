import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

/**
 * The package version, read from package.json (TODO-473).
 *
 * It was written out by hand in two places and said `1.0.0` in both from the
 * day each was added: the MCP server introduced itself to clients as 1.0.0 at
 * package version 3.10.3, and so did `todo --version`. A number nothing checks
 * goes stale the first time it is not updated, and nobody notices, because
 * being wrong looks exactly like being right.
 *
 * Resolved against this module's own path, never the working directory:
 * `src/index.ts` does `process.chdir(~/.todocko)` before anything else, so a
 * relative read would look for package.json in the user's data directory.
 */
function read(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as {
      version?: unknown;
    };
    if (typeof pkg.version === "string" && pkg.version.length > 0) return pkg.version;
  } catch {
    // Falls through: a missing or unreadable package.json must not stop the
    // server from starting. Knowing the version is not worth a dead process.
  }
  return "0.0.0-unknown";
}

export const VERSION: string = read();
