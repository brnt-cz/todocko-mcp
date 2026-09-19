import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { acquireInstanceLock, decideLock, parseLockFile, lockConflictMessage } from "../instanceLock.js";

/**
 * A second MCP process used to take the first one's dbWorker down with it
 * (TODO-341). The decision to refuse has to be right in both directions:
 * refusing while a process really holds the database, and taking over after a
 * crash, or the user is locked out by a file nobody owns.
 */
const dir = mkdtempSync(join(tmpdir(), "todocko-lock-"));
const alive = () => true;
const dead = () => false;

describe("parseLockFile", () => {
  it("reads a well formed lock", () => {
    expect(parseLockFile('{"pid":42,"startedAt":"2026-09-19T06:00:00.000Z","argv":"x"}')).toEqual({
      pid: 42,
      startedAt: "2026-09-19T06:00:00.000Z",
      argv: "x",
    });
  });

  it("treats anything unreadable as no holder", () => {
    expect(parseLockFile("")).toBeNull();
    expect(parseLockFile("{half written")).toBeNull();
    expect(parseLockFile('{"pid":"42"}')).toBeNull();
    expect(parseLockFile('{"pid":0}')).toBeNull();
  });
});

describe("decideLock", () => {
  it("takes a free lock", () => {
    expect(decideLock(null, 100, alive)).toEqual({ action: "take", reason: "free" });
  });

  it("refuses while another live process holds it", () => {
    const d = decideLock('{"pid":200,"startedAt":"t","argv":""}', 100, alive);
    expect(d.action).toBe("refuse");
    expect(d.action === "refuse" && d.holder.pid).toBe(200);
  });

  it("takes over after a crash, from a dead pid or a torn file", () => {
    expect(decideLock('{"pid":200,"startedAt":"t","argv":""}', 100, dead)).toEqual({ action: "take", reason: "stale" });
    expect(decideLock("{half", 100, alive)).toEqual({ action: "take", reason: "stale" });
  });

  it("never refuses over its own pid", () => {
    expect(decideLock('{"pid":100,"startedAt":"t","argv":""}', 100, alive)).toEqual({ action: "take", reason: "stale" });
  });
});

describe("acquireInstanceLock", () => {
  it("writes its own pid and removes the file on release", () => {
    const path = join(dir, "own.lock");
    const result = acquireInstanceLock(path);
    expect(result.ok).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf-8")).pid).toBe(process.pid);
    if (result.ok) result.lock.release();
    expect(existsSync(path)).toBe(false);
  });

  it("refuses when a live foreign process holds it and leaves that file alone", () => {
    const path = join(dir, "held.lock");
    writeFileSync(path, JSON.stringify({ pid: 999999, startedAt: "t", argv: "" }));
    const result = acquireInstanceLock(path, { isAlive: () => true });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.holder.pid).toBe(999999);
    expect(JSON.parse(readFileSync(path, "utf-8")).pid).toBe(999999);
  });

  it("takes over a lock left by a process that is gone", () => {
    const path = join(dir, "stale.lock");
    writeFileSync(path, JSON.stringify({ pid: 999998, startedAt: "t", argv: "" }));
    const result = acquireInstanceLock(path, { isAlive: () => false });
    expect(result.ok).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf-8")).pid).toBe(process.pid);
    if (result.ok) result.lock.release();
  });

  it("releasing does not delete a lock another process has since taken", () => {
    const path = join(dir, "handover.lock");
    const result = acquireInstanceLock(path);
    expect(result.ok).toBe(true);
    writeFileSync(path, JSON.stringify({ pid: 999997, startedAt: "t", argv: "" }));
    if (result.ok) result.lock.release();
    expect(JSON.parse(readFileSync(path, "utf-8")).pid).toBe(999997);
  });
});

describe("lockConflictMessage", () => {
  it("names the holder, the file and the way out", () => {
    const msg = lockConflictMessage({ pid: 4321, startedAt: "2026-09-19T06:00:00.000Z", argv: "" }, "/home/x/.todocko/todocko-abc.db");
    expect(msg).toContain("PID 4321");
    expect(msg).toContain("/home/x/.todocko/todocko-abc.db");
    expect(msg).toContain("TODOCKO_INSTANCE=cli");
  });
});
