import type { EvoluInstance } from '../evolu.js';
import { handleToolCall } from '../tools/index.js';

export interface ResolvedTask {
  id: string;
  code: string;
  name: string | null;
  status: string;
}

/**
 * Resolve a task code (e.g. "TODO-160") to its task record via the existing
 * td_get_task code lookup. Returns null when no task matches. (TODO-160)
 */
export async function resolveTask(code: string, evolu: EvoluInstance): Promise<ResolvedTask | null> {
  const res = (await handleToolCall('td_get_task', { code }, evolu)) as {
    id?: string;
    code?: string;
    name?: string | null;
    status?: string;
    error?: string;
  } | null;
  if (!res || res.error || !res.id) return null;
  return { id: res.id, code: res.code ?? code, name: res.name ?? null, status: res.status ?? '' };
}
