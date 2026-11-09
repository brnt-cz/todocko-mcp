/**
 * Which tasks a listing shows, and in what order (TODO-473).
 *
 * Deliberately free of any Evolu import so it can be tested without a running
 * database, the same reason `src/tools/pure.ts` exists: anything that reaches
 * `src/evolu.ts` initialises Evolu at module load and dies on
 * `crypto.getRandomValues must be defined`.
 */

export interface ListedTask {
  id: string;
  code: string;
  name: string | null;
  status: string;
  priority: string | null;
  deadline: string | null;
  scheduledDate: string | null;
  projectCode: string | null;
  shared: boolean;
}

/** Why a task turned up in `todo today`. The user should not have to guess. */
export type TodayReason = "overdue" | "deadline" | "scheduled" | "in_progress";

export interface TodayTask extends ListedTask {
  reason: TodayReason;
}

/** Statuses `todo list` hides unless asked for all of them. */
const CLOSED = new Set(["done", "recurring"]);

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

/** A date-only string, so comparisons stay lexicographic and timezone-free. */
export function today(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Dates arrive as timestamps or as YYYY-MM-DD; only the day part matters. */
function day(value: string | null): string | null {
  if (!value) return null;
  const d = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function rank(task: ListedTask): number {
  return PRIORITY_RANK[task.priority ?? "medium"] ?? 2;
}

/**
 * Order: nearest deadline first, then priority, then code. Tasks with no
 * deadline sort after those with one, because a date is a commitment and a
 * priority is an opinion.
 */
export function orderTasks<T extends ListedTask>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    const da = day(a.deadline);
    const db = day(b.deadline);
    if (da !== db) {
      if (!da) return 1;
      if (!db) return -1;
      return da < db ? -1 : 1;
    }
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return a.code.localeCompare(b.code, "cs");
  });
}

export interface ListFilter {
  /** Include done and recurring tasks as well. */
  all?: boolean;
  status?: string;
  projectCode?: string;
  limit?: number;
}

export function selectList<T extends ListedTask>(tasks: T[], filter: ListFilter = {}): T[] {
  const wanted = tasks.filter((t) => {
    if (filter.status) return t.status === filter.status;
    if (!filter.all && CLOSED.has(t.status)) return false;
    return true;
  });
  const scoped = filter.projectCode
    ? wanted.filter((t) => t.projectCode === filter.projectCode)
    : wanted;
  const ordered = orderTasks(scoped);
  return filter.limit && filter.limit > 0 ? ordered.slice(0, filter.limit) : ordered;
}

/**
 * `todo today`: everything that is due, planned for today, or already being
 * worked on. The reason is kept per task, since the three overlap and a bare
 * list would not say why anything is in it.
 *
 * Note that a closed task never qualifies, however old its deadline. An
 * overdue done task is not work.
 */
export function selectToday<T extends ListedTask>(tasks: T[], now: string = today()): (T & { reason: TodayReason })[] {
  const out: (T & { reason: TodayReason })[] = [];
  for (const task of tasks) {
    if (CLOSED.has(task.status)) continue;
    const deadline = day(task.deadline);
    const scheduled = day(task.scheduledDate);
    let reason: TodayReason | null = null;
    if (deadline && deadline < now) reason = "overdue";
    else if (deadline === now) reason = "deadline";
    else if (scheduled && scheduled <= now) reason = "scheduled";
    else if (task.status === "in_progress") reason = "in_progress";
    if (reason) out.push({ ...task, reason });
  }
  // Overdue first: it is the only group where waiting has already cost
  // something. Within a group the usual order applies.
  const group = (r: TodayReason) => (r === "overdue" ? 0 : 1);
  return orderTasks(out).sort((a, b) => group(a.reason) - group(b.reason));
}
