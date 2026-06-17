/** Resolve a CLI date token to YYYY-MM-DD. Accepts today/tomorrow/YYYY-MM-DD. (TODO-160) */
export function resolveDate(input: string, now: Date = new Date()): string | null {
  const s = input.trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(now);
  if (s === 'today') return iso(d);
  if (s === 'tomorrow') {
    d.setDate(d.getDate() + 1);
    return iso(d);
  }
  return null;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
