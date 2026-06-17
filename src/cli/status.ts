/** Task status handling for the CLI (TODO-160). */

export const TASK_STATUSES = ['backlog', 'todo', 'in_progress', 'review', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/**
 * Normalise a user-supplied status. Accepts the canonical values plus a few
 * friendly aliases (e.g. "inprogress", "in-progress", "progress"). Returns null
 * for anything unrecognised.
 */
export function normalizeStatus(input: string): TaskStatus | null {
  const s = input.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if ((TASK_STATUSES as readonly string[]).includes(s)) return s as TaskStatus;
  const aliases: Record<string, TaskStatus> = {
    inprogress: 'in_progress',
    progress: 'in_progress',
    wip: 'in_progress',
    todo_: 'todo',
    review_: 'review',
  };
  return aliases[s] ?? null;
}
