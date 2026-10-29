import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';

const configFor = (runsDir: string) => ({
  adapter: 'shim',
  installed: 'now',
  beatEverySeconds: 60,
  runsDir,
});

describe('digest route acceptance', () => {
  let temporaryRoot: string;
  let runsDir: string;

  beforeEach(() => {
    temporaryRoot = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
    runsDir = join(temporaryRoot, 'runs');
    mkdirSync(runsDir);
    vi.stubEnv('LANE_MARKER', 'ACCEPTANCE-MARKER');
  });

  afterEach(() => {
    rmSync(temporaryRoot, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('serves equivalent sorted HTML and JSON rows with safe rendering', async () => {
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), [
      JSON.stringify({
        at: '2026-10-28T23:00:00+01:00',
        job: 'z<& job',
        status: 'retry',
        owner: null,
      }),
      JSON.stringify({
        at: '2026-10-29T00:00:00+01:00',
        job: 'z<& job',
        status: 'retry',
        owner: null,
      }),
      JSON.stringify({
        at: '2026-10-29T01:00:00+01:00',
        job: 'z<& job',
        status: 'retry',
        owner: null,
        error: 'temporary <error> & details',
      }),
      JSON.stringify({
        at: '2026-10-29T02:00:00+01:00',
        job: 'z<& job',
        status: 'ok',
        owner: null,
      }),
      JSON.stringify({
        at: '2026-10-28T22:00:00+01:00',
        job: 'a<& job',
        status: 'fail',
        owner: '<owner> & team',
        error: 'failed <now> & later',
      }),
      JSON.stringify({
        at: '2026-10-29T03:00:00+01:00',
        job: 'a<& job',
        status: 'ok',
        owner: '<owner> & team',
      }),
      'not json',
      '{"at":"2026-10-29T04:00:00+01:00","job":"invalid","status":"ok","owner":7}',
    ].join('\n'));

    const app = createApp(configFor(runsDir));
    const htmlResponse = await app.request('/digest/2026-10-28');
    const jsonResponse = await app.request('/api/digest/2026-10-28');
    const html = await htmlResponse.text();
    const digest = await jsonResponse.json();

    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    expect(html).toContain('ACCEPTANCE-MARKER');
    expect(html).not.toMatch(/<script\b/i);
    expect(html).toContain('z&lt;&amp; job');
    expect(html).toContain('&lt;owner&gt; &amp; team');
    expect(html).toContain('failed &lt;now&gt; &amp; later');
    expect(html).toContain('—');
    expect(html).toContain('2026-10-28T23:00:00+01:00');
    expect(html).toContain('2026-10-29T03:00:00+01:00');
    expect(html).toContain('class="warn">3</td>');
    expect(html).toContain('class="warn">1</td>');
    expect(html).not.toContain('failed <now> & later');

    expect(digest.rows.map(({ job }: { job: string }) => job)).toEqual(['a<& job', 'z<& job']);
    const htmlOrder = digest.rows.map(({ job }: { job: string }) => html.indexOf(job.replaceAll('&', '&amp;').replaceAll('<', '&lt;')));
    expect(htmlOrder).toEqual([...htmlOrder].sort((left, right) => left - right));
    expect(digest.rows[0]).toMatchObject({
      owner: '<owner> & team',
      failures: 1,
      lastStatus: 'ok',
      firstAt: '2026-10-28T22:00:00+01:00',
      lastAt: '2026-10-29T03:00:00+01:00',
    });
    expect(digest.rows[1]).toMatchObject({
      owner: null,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'temporary <error> & details',
      firstAt: '2026-10-28T23:00:00+01:00',
      lastAt: '2026-10-29T02:00:00+01:00',
    });
    expect(digest.badLines).toBe(2);
  });

  it('returns 200 for an empty night and 404 for a missing night', async () => {
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), '');
    const app = createApp(configFor(runsDir));

    const emptyHtml = await app.request('/digest/2026-10-28');
    const emptyJson = await app.request('/api/digest/2026-10-28');
    const missingHtml = await app.request('/digest/2026-10-29');
    const missingJson = await app.request('/api/digest/2026-10-29');

    expect(emptyHtml.status).toBe(200);
    expect(await emptyHtml.text()).toContain('nothing ran');
    expect(emptyJson.status).toBe(200);
    await expect(emptyJson.json()).resolves.toMatchObject({ rows: [], badLines: 0 });
    expect(missingHtml.status).toBe(404);
    expect(missingHtml.headers.get('content-type')).toContain('text/html');
    expect(missingJson.status).toBe(404);
    await expect(missingJson.json()).resolves.toMatchObject({ error: 'night not found' });
  });

  it('rejects invalid and path-traversal-shaped night identifiers', async () => {
    writeFileSync(join(temporaryRoot, 'secret.jsonl'), 'outside-secret');
    const app = createApp(configFor(runsDir));

    for (const path of [
      '/digest/not-a-night',
      '/digest/2026-02-30',
      '/digest/..%2Fsecret',
      '/api/digest/not-a-night',
      '/api/digest/2026-02-30',
      '/api/digest/..%2Fsecret',
    ]) {
      const response = await app.request(path);
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain('outside-secret');
    }
  });
});
