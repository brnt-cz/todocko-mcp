import type { EvoluInstance } from '../../evolu.js';
import { handleToolCall } from '../../tools/index.js';
import { waitForSync } from '../bootstrap.js';
import { resolveTask } from '../resolve.js';
import { ok, warn, fail } from '../format.js';
import { normalizeStatus, type TaskStatus, TASK_STATUSES } from '../status.js';

/** Set a task's status (used by `done`, `start`, and `mv`). */
export async function cmdSetStatus(
  evolu: EvoluInstance,
  code: string,
  status: TaskStatus,
  json: boolean,
): Promise<number> {
  const task = await resolveTask(code, evolu);
  if (!task) {
    process.stderr.write(fail(`Úkol "${code}" nenalezen.`) + '\n');
    return 1;
  }

  const res = await handleToolCall('td_update_task', { id: task.id, status }, evolu);
  const synced = await waitForSync();

  if (json) {
    process.stdout.write(JSON.stringify(res) + '\n');
    return 0;
  }
  process.stdout.write(ok(`${task.code}  ${task.status} → ${status}`) + '\n');
  if (!synced) process.stdout.write(warn('uloženo lokálně, sync na relay se nepovedl (offline?)') + '\n');
  return 0;
}

/** `td mv CODE <status>` — validates the free-form status argument. */
export async function cmdMv(evolu: EvoluInstance, code: string, statusArg: string, json: boolean): Promise<number> {
  const status = normalizeStatus(statusArg);
  if (!status) {
    process.stderr.write(fail(`Neplatný stav "${statusArg}" (${TASK_STATUSES.join('|')}).`) + '\n');
    return 1;
  }
  return cmdSetStatus(evolu, code, status, json);
}
