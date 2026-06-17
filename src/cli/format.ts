/** Output formatting for the CLI: colors, success/error lines, tables. (TODO-160) */

const useColor = !!process.stdout.isTTY && !process.env.NO_COLOR;

function paint(code: string, text: string): string {
  return useColor ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export const green = (t: string) => paint('32', t);
export const red = (t: string) => paint('31', t);
export const yellow = (t: string) => paint('33', t);
export const dim = (t: string) => paint('2', t);

export const ok = (msg: string) => `${green('✓')} ${msg}`;
export const warn = (msg: string) => `${yellow('⚠')} ${msg}`;
export const fail = (msg: string) => `${red('✗')} ${msg}`;

/**
 * Render a left-aligned text table. Column widths come from the widest cell in
 * each column (header included). Pure string output — no terminal control. The
 * displayed width strips ANSI codes so colored cells still align.
 */
export function renderTable(headers: string[], rows: string[][]): string {
  const visibleLen = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '').length;
  const widths = headers.map((h, i) =>
    Math.max(visibleLen(h), ...rows.map((r) => visibleLen(r[i] ?? ''))),
  );
  const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - visibleLen(s)));
  const line = (cells: string[]) => cells.map((c, i) => pad(c ?? '', widths[i]!)).join('  ').trimEnd();
  return [line(headers.map(dim)), ...rows.map(line)].join('\n');
}
