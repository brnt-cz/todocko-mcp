import type { EvoluInstance } from '../../evolu.js';
import { handleToolCall } from '../../tools/index.js';
import { dim, red, yellow, renderTable } from '../format.js';
import { selectList, selectToday, today, type ListedTask, type TodayReason } from '../select.js';

/**
 * How many rows to pull before filtering in JS.
 *
 * The tool applies its limit in SQL, so it runs before anything here. Asking
 * for 50 and then dropping the closed ones would show an empty list to anyone
 * whose 50 most recent tasks are done. The same trap already bit
 * `td_list_shared_tasks`, which reported zero tasks for a project holding 167.
 */
const FETCH_LIMIT = 500;

interface RawTask {
  id?: string;
  code?: string;
  name?: string | null;
  status?: string;
  priority?: string | null;
  deadline?: string | null;
  scheduledDate?: string | null;
  project?: { code?: string | null } | null;
}

function normalise(t: RawTask, shared: boolean): ListedTask {
  return {
    id: t.id ?? '',
    code: t.code ?? '',
    name: t.name ?? null,
    status: t.status ?? '',
    priority: t.priority ?? null,
    deadline: t.deadline ?? null,
    scheduledDate: t.scheduledDate ?? null,
    projectCode: t.project?.code ?? null,
    shared,
  };
}

/**
 * Personal tasks plus the tasks of every joined shared project.
 *
 * `td_list_tasks` only ever sees the personal instance, so a listing built on
 * it alone silently omits shared work. Each shared owner has to be asked
 * separately, which is why this can be skipped with `--no-shared`.
 */
async function collect(
  evolu: EvoluInstance,
  opts: { status?: string; shared: boolean },
): Promise<{ tasks: ListedTask[]; sharedFailures: string[] }> {
  const personal = (await handleToolCall(
    'td_list_tasks',
    { limit: FETCH_LIMIT, ...(opts.status ? { status: opts.status } : {}) },
    evolu,
  )) as { tasks?: RawTask[] };
  const tasks: ListedTask[] = (personal.tasks ?? []).map((t) => normalise(t, false));
  const sharedFailures: string[] = [];

  if (!opts.shared) return { tasks, sharedFailures };

  const projects = (await handleToolCall('td_list_shared_projects', {}, evolu)) as {
    projects?: { sharedOwnerId?: string; code?: string | null; name?: string | null }[];
  };
  for (const p of projects.projects ?? []) {
    if (!p.sharedOwnerId) continue;
    try {
      const res = (await handleToolCall(
        'td_list_shared_tasks',
        { sharedOwnerId: p.sharedOwnerId, limit: FETCH_LIMIT, ...(opts.status ? { status: opts.status } : {}) },
        evolu,
      )) as { tasks?: RawTask[] };
      for (const t of res.tasks ?? []) tasks.push(normalise(t, true));
    } catch (e) {
      // One unreachable shared project must not blank the whole listing, but
      // it must not pass unmentioned either: a short list looks the same as a
      // short to-do list.
      sharedFailures.push(`${p.code ?? p.name ?? p.sharedOwnerId}: ${(e as Error).message}`);
    }
  }
  return { tasks, sharedFailures };
}

const STATUS_LABEL: Record<string, string> = {
  backlog: 'backlog',
  todo: 'todo',
  in_progress: 'dělá se',
  review: 'review',
  done: 'hotovo',
  recurring: 'opakuje se',
};

const REASON_LABEL: Record<TodayReason, string> = {
  overdue: 'po termínu',
  deadline: 'termín dnes',
  scheduled: 'naplánováno',
  in_progress: 'dělá se',
};

function priorityCell(priority: string | null): string {
  if (priority === 'urgent') return red('urgent');
  if (priority === 'high') return yellow('high');
  return priority ?? '';
}

function deadlineCell(deadline: string | null, now: string): string {
  if (!deadline) return '';
  const d = deadline.slice(0, 10);
  return d < now ? red(d) : d;
}

function write(
  tasks: ListedTask[],
  failures: string[],
  json: boolean,
  empty: string,
  reasonOf?: (t: ListedTask) => string,
): number {
  if (json) {
    process.stdout.write(JSON.stringify({ count: tasks.length, tasks, sharedFailures: failures }) + '\n');
    return 0;
  }
  for (const f of failures) process.stderr.write(dim(`⚠ sdílený projekt ${f}`) + '\n');
  if (tasks.length === 0) {
    process.stdout.write(dim(empty) + '\n');
    return 0;
  }
  const now = today();
  const headers = ['Kód', 'Stav', 'Priorita', 'Termín', 'Projekt', 'Název'];
  const rows = tasks.map((t) => [
    t.code,
    reasonOf ? reasonOf(t) : (STATUS_LABEL[t.status] ?? t.status),
    priorityCell(t.priority),
    deadlineCell(t.deadline, now),
    (t.projectCode ?? '') + (t.shared ? dim('*') : ''),
    t.name ?? '',
  ]);
  process.stdout.write(renderTable(headers, rows) + '\n');
  if (tasks.some((t) => t.shared)) {
    process.stdout.write(dim('* sdílený projekt') + '\n');
  }
  return 0;
}

export interface ListOptions {
  project?: string;
  status?: string;
  all?: boolean;
  limit?: string;
  shared?: boolean;
}

/** `todo list` */
export async function cmdList(evolu: EvoluInstance, opts: ListOptions, json: boolean): Promise<number> {
  const { tasks, sharedFailures } = await collect(evolu, {
    status: opts.status,
    shared: opts.shared !== false,
  });
  const limit = opts.limit ? Number(opts.limit) : undefined;
  if (opts.limit && (!Number.isFinite(limit) || (limit as number) <= 0)) {
    process.stderr.write(red(`✗ Neplatný limit "${opts.limit}".`) + '\n');
    return 1;
  }
  const selected = selectList(tasks, {
    all: opts.all,
    status: opts.status,
    projectCode: opts.project,
    limit,
  });
  return write(selected, sharedFailures, json, 'Žádné úkoly.');
}

/** `todo today` */
export async function cmdToday(evolu: EvoluInstance, opts: ListOptions, json: boolean): Promise<number> {
  const { tasks, sharedFailures } = await collect(evolu, { shared: opts.shared !== false });
  const scoped = opts.project ? tasks.filter((t) => t.projectCode === opts.project) : tasks;
  const selected = selectToday(scoped);
  return write(selected, sharedFailures, json, 'Na dnešek nic.', (t) =>
    REASON_LABEL[(t as ListedTask & { reason: TodayReason }).reason],
  );
}
