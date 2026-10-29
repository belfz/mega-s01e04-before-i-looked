import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';

describe('digest JSON route', () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-json-'));
    vi.stubEnv('LANE_MARKER', 'TEST-MARKER');
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  function app() {
    return createApp({ adapter: 'shim', installed: 'now', beatEverySeconds: 60, runsDir });
  }

  it('returns the shared digest with sorted rows and null owners', async () => {
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), [
      JSON.stringify({ at: '2026-10-28T23:00:00+01:00', job: 'z-job', status: 'ok', owner: null }),
      JSON.stringify({ at: '2026-10-28T22:00:00+01:00', job: 'a-job', status: 'fail', owner: 'lane-07', error: 'broken' }),
      JSON.stringify({ at: '2026-10-28T23:30:00+01:00', job: 'z-job', status: 'retry', owner: null }),
      'not json',
    ].join('\n'));

    const response = await app().request('/api/digest/2026-10-28');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toEqual({
      night: '2026-10-28',
      rows: [
        {
          job: 'a-job',
          owner: 'lane-07',
          runs: 1,
          retries: 0,
          failures: 1,
          lastStatus: 'fail',
          lastError: 'broken',
          firstAt: '2026-10-28T22:00:00+01:00',
          lastAt: '2026-10-28T22:00:00+01:00',
        },
        {
          job: 'z-job',
          owner: null,
          runs: 2,
          retries: 1,
          failures: 0,
          lastStatus: 'retry',
          lastError: null,
          firstAt: '2026-10-28T23:00:00+01:00',
          lastAt: '2026-10-28T23:30:00+01:00',
        },
      ],
      badLines: 1,
      counts: { ok: 1, retry: 1, fail: 1 },
    });
  });

  it.each(['/api/digest/2026-10-29', '/api/digest/not-a-night', '/api/digest/..%2Fsecret'])
    ('returns structured JSON 404 for %s', async (path) => {
      const response = await app().request(path);

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({
        error: 'night not found',
        night: expect.any(String),
      });
    });

  it('returns an empty digest for an empty file', async () => {
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), '');

    const response = await app().request('/api/digest/2026-10-28');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      night: '2026-10-28',
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('includes malformed-line metadata in the successful digest', async () => {
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), [
      'not json',
      JSON.stringify({ at: '2026-10-28T23:00:00+01:00', job: 'job', status: 'ok', owner: null }),
      '{"job":"missing required fields"}',
    ].join('\n'));

    const digest = await (await app().request('/api/digest/2026-10-28')).json();

    expect(digest.badLines).toBe(2);
    expect(digest.rows).toHaveLength(1);
  });

  it('keeps HTML and JSON job order aligned', async () => {
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), [
      JSON.stringify({ at: '2026-10-28T23:00:00+01:00', job: 'z-job', status: 'ok', owner: null }),
      JSON.stringify({ at: '2026-10-28T22:00:00+01:00', job: 'a-job', status: 'ok', owner: null }),
      JSON.stringify({ at: '2026-10-28T21:00:00+01:00', job: 'm-job', status: 'ok', owner: null }),
    ].join('\n'));

    const json = await (await app().request('/api/digest/2026-10-28')).json();
    const html = await (await app().request('/digest/2026-10-28')).text();
    const htmlOrder = (json.rows as Array<{ job: string }>).map(({ job }) => html.indexOf(job));

    expect(htmlOrder).toEqual([...htmlOrder].sort((left, right) => left - right));
  });
});
