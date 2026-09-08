/** Task status handling for the CLI (TODO-160). */

// `recurring` belongs here for the same reason it belongs in the MCP enums: the
// app treats it as a real status, not a decoration. Without it the CLI refuses
// to move a task to the column the app puts recurring tasks in. (TODO-296)
export const TASK_STATUSES = ['backlog', 'todo', 'in_progress', 'review', 'done', 'recurring'] as const;
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
