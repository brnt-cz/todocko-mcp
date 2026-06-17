import type { EvoluInstance } from '../../evolu.js';
import { handleToolCall } from '../../tools/index.js';
import { waitForSync } from '../bootstrap.js';
import { ok, warn, fail } from '../format.js';
import { resolveDate } from '../dates.js';

export interface AddOptions {
  project?: string;
  priority?: string;
  deadline?: string;
  scheduled?: string;
}

const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

/** `td add "name" [-p CODE] [--priority p] [--deadline d] [--scheduled d]` */
export async function cmdAdd(
  evolu: EvoluInstance,
  name: string,
  opts: AddOptions,
  json: boolean,
): Promise<number> {
  const list = (await handleToolCall('td_list_projects', {}, evolu)) as {
    projects?: { id: string; code: string | null; name: string }[];
  };
  const projects = list.projects ?? [];
  if (projects.length === 0) {
    process.stderr.write(fail('Žádný projekt neexistuje — vytvoř ho nejdřív v aplikaci.\n'));
    return 1;
  }

  let project = projects[0]!;
  if (opts.project) {
    const found = projects.find((p) => (p.code ?? '').toLowerCase() === opts.project!.toLowerCase());
    if (!found) {
      process.stderr.write(fail(`Projekt "${opts.project}" nenalezen.\n`));
      return 1;
    }
    project = found;
  }

  if (opts.priority && !PRIORITIES.includes(opts.priority)) {
    process.stderr.write(fail(`Neplatná priorita "${opts.priority}" (low|medium|high|urgent).\n`));
    return 1;
  }

  let deadline: string | undefined;
  if (opts.deadline) {
    const d = resolveDate(opts.deadline);
    if (!d) {
      process.stderr.write(fail(`Neplatný deadline "${opts.deadline}" (YYYY-MM-DD).\n`));
      return 1;
    }
    deadline = d;
  }

  let scheduledDate: string | undefined;
  if (opts.scheduled) {
    const d = resolveDate(opts.scheduled);
    if (!d) {
      process.stderr.write(fail(`Neplatné datum "${opts.scheduled}" (today|tomorrow|YYYY-MM-DD).\n`));
      return 1;
    }
    scheduledDate = d;
  }

  const res = (await handleToolCall(
    'td_create_task',
    {
      projectId: project.id,
      name,
      ...(opts.priority ? { priority: opts.priority } : {}),
      ...(deadline ? { deadline } : {}),
      ...(scheduledDate ? { scheduledDate } : {}),
    },
    evolu,
  )) as { success?: boolean; taskCode?: string; message?: string };

  const synced = await waitForSync();

  if (json) {
    process.stdout.write(JSON.stringify(res) + '\n');
    return res.success ? 0 : 1;
  }
  if (!res.success) {
    process.stderr.write(fail(res.message ?? 'Vytvoření úkolu selhalo.') + '\n');
    return 1;
  }
  process.stdout.write(ok(`vytvořeno ${res.taskCode}  "${name}"`) + '\n');
  if (!synced) process.stdout.write(warn('uloženo lokálně, sync na relay se nepovedl (offline?)') + '\n');
  return 0;
}
