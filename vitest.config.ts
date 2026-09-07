import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Source only. Without this vitest also picks up the compiled copies under
    // dist/, so every test ran twice and the reported count was double the real
    // one: 160 for 80 tests. It also broke the source-level check in
    // sharedWrites.test.ts, which found dist/tools/*.d.ts, no call sites in
    // them, and failed for a reason that had nothing to do with the code.
    // (TODO-299)
    include: ["src/**/*.test.ts"],
  },
});
