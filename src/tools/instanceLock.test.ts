import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { acquireInstanceLock, decideLock, parseLockFile, lockConflictMessage, parseProcState, isRunning } from "../instanceLock.js";

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

/**
 * A zombie is not a holder (TODO-372).
 *
 * `kill(pid, 0)` succeeds for a process that has exited but has not been reaped
 * by its parent, so the lock named a process that could never run again and
 * never released it. Every new instance then refused to start until the file
 * was removed by hand. Seen on 2026-09-22: holder in state `Z`, its parent a
 * stopped `claude` in state `Tl`, and SIGCONT to the parent did not move it.
 */
describe("parseProcState", () => {
  it("reads the state of an ordinary process", () => {
    expect(parseProcState("1234 (node) S 1200 1234 1234 0 -1 4194304 1 0")).toBe("S");
  });

  it("reads a zombie", () => {
    expect(parseProcState("2718604 (node) Z 884087 2718604 0 0 -1 4194368 0 0")).toBe("Z");
  });

  it("is not fooled by a command name containing spaces and brackets", () => {
    // The second field is the executable name in parentheses and the kernel
    // does not escape it, so anything that splits on whitespace or on the first
    // bracket reads the wrong field here.
    expect(parseProcState("77 (my (weird) proc) R 1 77 77 0 -1 0 0 0")).toBe("R");
  });

  it("answers null for a line it does not recognise", () => {
    expect(parseProcState("")).toBeNull();
    expect(parseProcState("no brackets here")).toBeNull();
    expect(parseProcState("1234 (node)")).toBeNull();
  });
});

describe("isRunning", () => {
  it("is false for a process that is not there at all", () => {
    expect(isRunning(false, null)).toBe(false);
    expect(isRunning(false, "S")).toBe(false);
  });

  it("is false for a zombie, which is the whole point", () => {
    expect(isRunning(true, "Z")).toBe(false);
  });

  it("is true for every state a process can still be scheduled from", () => {
    // Including `T` and `t`: a stopped process is not gone, and resuming it
    // must find its lock where it left it.
    for (const state of ["R", "S", "D", "T", "t", "I"]) {
      expect(isRunning(true, state)).toBe(true);
    }
  });

  it("keeps the old answer where the state cannot be read", () => {
    // No /proc: every non-Linux host. Guessing there would trade a rare stuck
    // lock for a common wrong one.
    expect(isRunning(true, null)).toBe(true);
  });
});

describe("decideLock with a zombie holder", () => {
  it("takes the lock over, instead of refusing forever", () => {
    const file = JSON.stringify({ pid: 2718604, startedAt: "2026-09-22T06:05:45.197Z", argv: "" });
    const isAlive = (pid: number) => isRunning(true, pid === 2718604 ? "Z" : "S");
    expect(decideLock(file, 999, isAlive)).toEqual({ action: "take", reason: "stale" });
  });

  it("still refuses to a holder that is merely stopped", () => {
    const file = JSON.stringify({ pid: 4242, startedAt: "t", argv: "" });
    const isAlive = (pid: number) => isRunning(true, pid === 4242 ? "T" : "S");
    expect(decideLock(file, 999, isAlive)).toEqual({
      action: "refuse",
      holder: { pid: 4242, startedAt: "t", argv: "" },
    });
  });
});

/**
 * The same thing against a real zombie, not a hand-written state letter.
 *
 * The pure tests above pin the decision; this one pins that the decision is
 * actually reached, because `processIsAlive` is what production calls and no
 * unit test touches it. A green suite over pure helpers would say nothing about
 * whether `/proc` is read at all.
 */
describe("a real zombie process", () => {
  /**
   * A real zombie: a detached parent forks a child, the child exits, the parent
   * sleeps without ever calling wait. The pid pair goes through a file, because
   * reading the child's stdout would need the event loop and this has to be
   * synchronous to be worth asserting on.
   */
  function makeZombie(): { pid: number; stop: () => void } | null {
    if (process.platform !== "linux") return null;
    const out = join(dir, `zombie-${Date.now()}.pid`);
    const script = [
      "import os,sys,time",
      "if os.fork() == 0:",
      "    os.setsid()",
      "    c = os.fork()",
      "    if c == 0: os._exit(0)",
      `    open(${JSON.stringify(out)},'w').write(str(os.getpid())+' '+str(c))`,
      "    time.sleep(10)",
      "    os._exit(0)",
      "os._exit(0)",
    ].join("\n");
    try {
      // stdio ignored: the detached grandchild inherits these pipes, and
      // execFileSync would otherwise wait for them to close, i.e. the full sleep.
      execFileSync("python3", ["-c", script], { stdio: "ignore" });
    } catch {
      return null;
    }

    // Wait for the CONTENT, not for the file. `open(..., 'w')` creates it before
    // anything is written, so checking existsSync read an empty file and the
    // helper bailed out. It then returned null, the test skipped itself, and it
    // passed against the unfixed code. Hence the loud skip in the test below.
    let pids: number[] = [];
    for (let i = 0; i < 200; i++) {
      if (existsSync(out)) {
        const parts = readFileSync(out, "utf-8").trim().split(/\s+/).map(Number);
        if (parts.length === 2 && parts.every((n) => Number.isInteger(n) && n > 0)) {
          pids = parts;
          break;
        }
      }
      execFileSync("sleep", ["0.05"], { stdio: "ignore" });
    }
    if (pids.length !== 2) return null;
    const [parentPid, zombiePid] = pids;

    // Wait for the child to actually be reaped-pending rather than still running.
    for (let i = 0; i < 100; i++) {
      try {
        if (parseProcState(readFileSync(`/proc/${zombiePid}/stat`, "utf-8")) === "Z") break;
      } catch {
        break;
      }
      execFileSync("sleep", ["0.05"], { stdio: "ignore" });
    }
    return {
      pid: zombiePid,
      stop: () => {
        try {
          process.kill(parentPid);
        } catch {
          // already gone
        }
      },
    };
  }

  it("does not hold the lock, however alive the kernel says it is", () => {
    const zombie = makeZombie();
    // Skipping is only honest where a zombie cannot exist. On Linux a null here
    // would mean the test quietly stopped asserting anything, which is how it
    // passed against the unfixed code while it was being written.
    if (!zombie) {
      expect(process.platform).not.toBe("linux");
      return;
    }
    try {
      const state = parseProcState(readFileSync(`/proc/${zombie.pid}/stat`, "utf-8"));
      expect(state).toBe("Z");

      // The test the old code used, for the record: a zombie passes it.
      let signalSaysAlive = true
      try {
        process.kill(zombie.pid, 0);
      } catch {
        signalSaysAlive = false;
      }
      expect(signalSaysAlive).toBe(true);

      // And yet the lock is taken over, using the real liveness check.
      const path = join(dir, "zombie.lock");
      writeFileSync(path, JSON.stringify({ pid: zombie.pid, startedAt: "t", argv: "" }));
      const result = acquireInstanceLock(path);
      expect(result.ok).toBe(true);
      if (result.ok) result.lock.release();
    } finally {
      zombie.stop();
    }
  });
});
