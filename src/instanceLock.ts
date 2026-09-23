import { existsSync, openSync, writeSync, closeSync, readFileSync, unlinkSync } from "fs";

/**
 * One MCP process per database (TODO-341).
 *
 * Every process opens the same `~/.todocko/todocko-<owner>.db`, which SQLite
 * keeps in rollback-journal mode with no busy timeout. A second process
 * therefore gets SQLITE_BUSY at once, Evolu escalates it to
 * `PanicAbortReason: database is locked`, and the FIRST process loses its
 * dbWorker: every query then hangs until the user reconnects the server.
 * Reproduced twice on 2026-09-16, each time seconds after a second instance
 * started.
 *
 * So the second instance refuses to start, with a message that says what to do,
 * rather than taking the running one down with it.
 */

export interface LockOwner {
  pid: number;
  startedAt: string;
  argv: string;
}

export type LockDecision =
  | { action: "take"; reason: "free" | "stale" }
  | { action: "refuse"; holder: LockOwner };

/** Malformed or truncated lock files are treated as stale, not as a holder. */
export function parseLockFile(content: string): LockOwner | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== "object") return null;
    const v = parsed as Partial<LockOwner>;
    if (typeof v.pid !== "number" || !Number.isInteger(v.pid) || v.pid <= 0) return null;
    return {
      pid: v.pid,
      startedAt: typeof v.startedAt === "string" ? v.startedAt : "",
      argv: typeof v.argv === "string" ? v.argv : "",
    };
  } catch {
    return null;
  }
}

/**
 * Whether this process may open the database.
 *
 * `isAlive` is injected so the decision can be tested without spawning
 * processes; in production it is `process.kill(pid, 0)`.
 */
export function decideLock(
  content: string | null,
  ownPid: number,
  isAlive: (pid: number) => boolean,
): LockDecision {
  if (content === null) return { action: "take", reason: "free" };
  const holder = parseLockFile(content);
  // A file we cannot read says nothing about a running process; a crashed
  // process leaves exactly this behind.
  if (!holder) return { action: "take", reason: "stale" };
  // Our own lock from an earlier boot of the same pid, or a pid nobody holds.
  if (holder.pid === ownPid) return { action: "take", reason: "stale" };
  if (!isAlive(holder.pid)) return { action: "take", reason: "stale" };
  return { action: "refuse", holder };
}

/** What the user sees instead of a dead worker in the other window. */
export function lockConflictMessage(holder: LockOwner, dbPath: string): string {
  const since = holder.startedAt ? ` (běží od ${holder.startedAt})` : "";
  return [
    `Todocko MCP už nad touto databází běží: PID ${holder.pid}${since}.`,
    `Databáze: ${dbPath}`,
    "Dvě instance nad jedním souborem si navzájem shodí SQLite, proto tahle končí.",
    "Buď nech běžet jen jednu, nebo spusť tuhle s TODOCKO_INSTANCE=cli:",
    "dostane vlastní kopii dat a synchronizuje se přes relay. (TODO-341)",
  ].join("\n");
}

export interface HeldLock {
  path: string;
  release: () => void;
}

/**
 * The process state character out of a `/proc/<pid>/stat` line.
 *
 * Parsed from the LAST `)`, not the first: the second field is the executable
 * name in parentheses and it may itself contain spaces and parentheses, so
 * splitting on whitespace or on the first bracket reads the wrong field for
 * anything called `(node) (x)`. The state is the first token after that field.
 *
 * Exported for tests; `null` means the line was not in the expected shape.
 */
export function parseProcState(stat: string): string | null {
  const close = stat.lastIndexOf(")");
  if (close === -1) return null;
  const state = stat.slice(close + 1).trim().charAt(0);
  return state === "" ? null : state;
}

/**
 * Whether a process that exists is actually still running (TODO-372).
 *
 * A zombie passes every liveness test the kernel offers through signals: it is
 * still in the process table, so `kill(pid, 0)` succeeds, and the old code
 * therefore reported it as the live holder of the lock. Nothing then ever
 * released that lock, because the process it named could not run again and its
 * parent was not reaping it, so every new instance refused to start until the
 * file was deleted by hand. Seen on 2026-09-22: holder in state `Z`, parent a
 * stopped `claude` in state `Tl`, and SIGCONT to the parent did not move it.
 *
 * `state` is null wherever `/proc` is not readable, which includes every
 * non-Linux host. There the answer stays what it always was, because guessing
 * would trade a rare stuck lock for a common wrong one.
 *
 * Exported for tests: pure, so the decision can be checked without a zombie.
 */
export function isRunning(exists: boolean, state: string | null): boolean {
  if (!exists) return false;
  return state !== "Z";
}

function procState(pid: number): string | null {
  try {
    return parseProcState(readFileSync(`/proc/${pid}/stat`, "utf-8"));
  } catch {
    return null;
  }
}

function processIsAlive(pid: number): boolean {
  let exists: boolean;
  try {
    process.kill(pid, 0);
    exists = true;
  } catch (e) {
    // EPERM means the process exists but belongs to someone else.
    exists = (e as NodeJS.ErrnoException).code === "EPERM";
  }
  return isRunning(exists, procState(pid));
}

/**
 * Take the lock, or return the holder to refuse over.
 *
 * Not atomic against a second process racing in the same millisecond: the O_EXCL
 * create is, but the stale takeover below is a read-then-unlink. That race is
 * the rarer failure by far, and losing it costs a refusal, not a corrupt file.
 */
export function acquireInstanceLock(
  lockPath: string,
  deps: { isAlive?: (pid: number) => boolean } = {},
): { ok: true; lock: HeldLock } | { ok: false; holder: LockOwner } {
  const isAlive = deps.isAlive ?? processIsAlive;
  const content = existsSync(lockPath) ? safeRead(lockPath) : null;
  const decision = decideLock(content, process.pid, isAlive);
  if (decision.action === "refuse") return { ok: false, holder: decision.holder };

  if (decision.reason === "stale") {
    try {
      unlinkSync(lockPath);
    } catch {
      // Gone already; the create below decides.
    }
  }

  const owner: LockOwner = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    argv: process.argv.slice(1).join(" ").slice(0, 200),
  };
  try {
    const fd = openSync(lockPath, "wx");
    writeSync(fd, JSON.stringify(owner));
    closeSync(fd);
  } catch {
    // Someone won the race between the check and the create.
    const now = safeRead(lockPath);
    const holder = now === null ? null : parseLockFile(now);
    return holder ? { ok: false, holder } : { ok: false, holder: owner };
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      const current = safeRead(lockPath);
      const holder = current === null ? null : parseLockFile(current);
      // Never remove a lock another process has taken over in the meantime.
      if (!holder || holder.pid === process.pid) unlinkSync(lockPath);
    } catch {
      // Nothing to do at shutdown.
    }
  };
  return { ok: true, lock: { path: lockPath, release } };
}

function safeRead(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}
