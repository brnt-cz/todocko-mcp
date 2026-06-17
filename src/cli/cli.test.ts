import { describe, it, expect } from 'vitest';
import { parseDuration, formatDuration } from './duration.js';
import { normalizeStatus } from './status.js';
import { renderTable } from './format.js';
import { resolveDate } from './dates.js';

describe('parseDuration', () => {
  it('parses combined hours and minutes', () => {
    expect(parseDuration('1h30m')).toBe(90);
    expect(parseDuration('2h')).toBe(120);
    expect(parseDuration('45m')).toBe(45);
  });

  it('treats a bare number as minutes', () => {
    expect(parseDuration('90')).toBe(90);
  });

  it('is forgiving about spacing and case', () => {
    expect(parseDuration(' 1H 30M ')).toBe(90);
  });

  it('rejects invalid or empty/zero input', () => {
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('abc')).toBeNull();
    expect(parseDuration('0')).toBeNull();
    expect(parseDuration('1d')).toBeNull();
    expect(parseDuration('0h0m')).toBeNull();
  });
});

describe('formatDuration', () => {
  it('renders compact durations', () => {
    expect(formatDuration(90)).toBe('1h 30m');
    expect(formatDuration(120)).toBe('2h');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(0)).toBe('0m');
  });
});

describe('normalizeStatus', () => {
  it('accepts canonical statuses', () => {
    expect(normalizeStatus('done')).toBe('done');
    expect(normalizeStatus('in_progress')).toBe('in_progress');
  });

  it('accepts friendly aliases and spacing', () => {
    expect(normalizeStatus('in-progress')).toBe('in_progress');
    expect(normalizeStatus('inprogress')).toBe('in_progress');
    expect(normalizeStatus('WIP')).toBe('in_progress');
    expect(normalizeStatus(' Review ')).toBe('review');
  });

  it('rejects unknown statuses', () => {
    expect(normalizeStatus('nope')).toBeNull();
    expect(normalizeStatus('')).toBeNull();
  });
});

describe('resolveDate', () => {
  const now = new Date('2026-05-27T10:00:00Z');

  it('passes through ISO dates', () => {
    expect(resolveDate('2026-06-01', now)).toBe('2026-06-01');
  });

  it('resolves today and tomorrow relative to now', () => {
    expect(resolveDate('today', now)).toBe('2026-05-27');
    expect(resolveDate('tomorrow', now)).toBe('2026-05-28');
  });

  it('rejects garbage', () => {
    expect(resolveDate('someday', now)).toBeNull();
    expect(resolveDate('2026/06/01', now)).toBeNull();
  });
});

describe('renderTable', () => {
  it('aligns columns by widest cell', () => {
    const out = renderTable(['Datum', 'Čas'], [['2026-05-27', '1h 30m'], ['2026-05-28', '45m']]);
    const lines = out.split('\n');
    expect(lines).toHaveLength(3); // header + 2 rows
    // every data row starts with the date padded to the column width
    expect(lines[1]).toContain('2026-05-27');
    expect(lines[1]).toContain('1h 30m');
  });
});
