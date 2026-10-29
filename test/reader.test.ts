import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

describe('readNight', () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-reader-'));
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true });
  });

  it('reads five fixture jobs, counts one bad line, and retains a null owner', () => {
    const digest = readNight('runs', '2026-10-28');
    expect(digest?.rows.map(row => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest?.badLines).toBe(1);
    expect(digest?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest?.rows[0].owner).toBeNull();
    expect(digest?.rows[1]).toMatchObject({ runs: 4, retries: 3, failures: 0,
      lastStatus: 'ok', lastError: 'upstream 503' });
    expect(digest?.rows[2]).toMatchObject({ runs: 8, retries: 1, lastError: 'lock held' });
    expect(digest?.rows[3]).toMatchObject({ failures: 1, lastStatus: 'fail',
      lastError: 'quota exceeded' });
  });

  it('returns null for missing files and invalid night identifiers', () => {
    for (const night of ['2026-10-28', '../2026-10-28', '2026-02-30', '2026-13-01', 'x']) {
      expect(readNight(runsDir, night)).toBeNull();
    }
  });

  it('returns an empty digest for an empty file', () => {
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), '\n\r\n');
    expect(readNight(runsDir, '2026-10-28')).toEqual({ night: '2026-10-28',
      rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('counts malformed JSON and schema-invalid events without dropping valid jobs', () => {
    const event = { at: '2026-10-28T23:00:00+01:00', job: 'job', status: 'ok', owner: null };
    const lines = [JSON.stringify(event), '{bad', 'null', '[]', '42',
      JSON.stringify({ ...event, at: 'yesterday' }),
      JSON.stringify({ ...event, status: 'unknown' }),
      JSON.stringify({ ...event, owner: 42 }),
      JSON.stringify({ ...event, error: false }),
      JSON.stringify({ ...event, job: '' })];
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), lines.join('\r\n'));
    expect(readNight(runsDir, '2026-10-28')).toMatchObject({ badLines: 9,
      counts: { ok: 1, retry: 0, fail: 0 }, rows: [{ job: 'job', owner: null }] });
  });

  it('orders unsorted events chronologically and preserves their original offsets', () => {
    const lines = [
      { at: '2026-10-29T03:00:00+02:00', job: 'job', status: 'ok', owner: null },
      { at: '2026-10-28T23:00:00+01:00', job: 'job', status: 'retry', owner: 'old', error: 'old error' },
      { at: '2026-10-29T00:30:00+00:00', job: 'job', status: 'fail', owner: 'new', error: 'new error' },
    ];
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), lines.map(event => JSON.stringify(event)).join('\n'));
    expect(readNight(runsDir, '2026-10-28')?.rows).toEqual([{
      job: 'job', owner: null, runs: 3, retries: 1, failures: 1, lastStatus: 'ok',
      lastError: 'new error', firstAt: '2026-10-28T23:00:00+01:00', lastAt: '2026-10-29T03:00:00+02:00',
    }]);
  });

  it('does not hide filesystem errors other than missing files', () => {
    mkdirSync(join(runsDir, '2026-10-28.jsonl'));
    expect(() => readNight(runsDir, '2026-10-28')).toThrow();
  });
});
