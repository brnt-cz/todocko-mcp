/**
 * Parse a human duration into minutes. Accepts "1h30m", "2h", "45m", or a bare
 * number of minutes ("90"). Returns null for anything invalid or non-positive.
 * (TODO-160)
 */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const m = parseInt(s, 10);
    return m > 0 ? m : null;
  }
  const match = s.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$/);
  if (!match || (!match[1] && !match[2])) return null;
  const total = (match[1] ? parseInt(match[1], 10) : 0) * 60 + (match[2] ? parseInt(match[2], 10) : 0);
  return total > 0 ? total : null;
}

/** Render minutes as a compact "1h 30m" / "45m" / "2h" string. */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}
