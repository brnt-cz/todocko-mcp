import type { EvoluInstance } from '../../evolu.js';
import { handleToolCall } from '../../tools/index.js';
import { waitForSync } from '../bootstrap.js';
import { resolveTask } from '../resolve.js';
import { parseDuration, formatDuration } from '../duration.js';
import { ok, warn, fail, dim, renderTable } from '../format.js';

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/** `td log CODE <duration> [description]` */
export async function cmdLog(
  evolu: EvoluInstance,
  code: string,
  durationStr: string,
  description: string | undefined,
  json: boolean,
): Promise<number> {
  const task = await resolveTask(code, evolu);
  if (!task) {
    process.stderr.write(fail(`Úkol "${code}" nenalezen.`) + '\n');
    return 1;
  }
  const minutes = parseDuration(durationStr);
  if (minutes === null) {
    process.stderr.write(fail(`Neplatný čas "${durationStr}" (např. 1h30m, 45m, 90).`) + '\n');
    return 1;
  }

  const res = await handleToolCall(
    'td_add_worklog',
    { taskId: task.id, durationMinutes: minutes, ...(description ? { description } : {}) },
    evolu,
  );
  const synced = await waitForSync();

  const list = (await handleToolCall('td_list_worklogs', { taskId: task.id }, evolu)) as {
    totalFormatted?: string;
  };

  if (json) {
    process.stdout.write(JSON.stringify(res) + '\n');
    return 0;
  }
  process.stdout.write(
    ok(`zalogováno ${formatDuration(minutes)} k ${task.code}  (celkem ${list.totalFormatted ?? '?'})`) + '\n',
  );
  if (!synced) process.stdout.write(warn('uloženo lokálně, sync na relay se nepovedl (offline?)') + '\n');
  return 0;
}

/** `td worklogs CODE` — table of worklogs. */
export async function cmdWorklogs(evolu: EvoluInstance, code: string, json: boolean): Promise<number> {
  const task = await resolveTask(code, evolu);
  if (!task) {
    process.stderr.write(fail(`Úkol "${code}" nenalezen.`) + '\n');
    return 1;
  }
  const list = (await handleToolCall('td_list_worklogs', { taskId: task.id }, evolu)) as {
    worklogs?: { durationMinutes: number; description: string | null; loggedAt: string; user?: { name?: string } }[];
    totalFormatted?: string;
  };
  const worklogs = list.worklogs ?? [];

  if (json) {
    process.stdout.write(JSON.stringify(list) + '\n');
    return 0;
  }
  if (worklogs.length === 0) {
    process.stdout.write(dim(`Žádné worklogy k ${task.code}.`) + '\n');
    return 0;
  }
  const rows = worklogs.map((w) => [
    String(w.loggedAt).slice(0, 10),
    formatDuration(w.durationMinutes),
    w.user?.name ?? '',
    w.description ? stripHtml(w.description) : '',
  ]);
  process.stdout.write(renderTable(['Datum', 'Čas', 'Kdo', 'Popis'], rows) + '\n');
  process.stdout.write(dim(`Celkem: ${list.totalFormatted ?? formatDuration(0)}`) + '\n');
  return 0;
}
