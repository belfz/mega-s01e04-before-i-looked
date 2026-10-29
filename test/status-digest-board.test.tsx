import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';

describe('status digest board', () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-status-digest-'));
    vi.stubEnv('LANE_MARKER', 'TEST-MARKER');
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  function app() {
    return createApp({ adapter: 'shim', installed: 'now', beatEverySeconds: 60, runsDir });
  }

  it('links a temporary night and shows reader counts', async () => {
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), [
      JSON.stringify({ at: '2026-10-28T22:00:00+01:00', job: 'job-a', status: 'ok', owner: null }),
      JSON.stringify({ at: '2026-10-28T22:01:00+01:00', job: 'job-b', status: 'retry', owner: null }),
      JSON.stringify({ at: '2026-10-28T22:02:00+01:00', job: 'job-c', status: 'fail', owner: null }),
      'not json',
    ].join('\n'));

    const response = await app().request('/');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a>');
    expect(html).toContain('ok 1 · retry 1 · fail 1');
  });

  it('links both fixture nights to digest pages that render', async () => {
    const fixtureApp = createApp({
      adapter: 'shim',
      installed: 'now',
      beatEverySeconds: 60,
      runsDir: 'runs',
    });
    const response = await fixtureApp.request('/');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('<a href="/digest/2026-10-27">2026-10-27</a>');
    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a>');
    expect(html).toContain('ok 7 · retry 0 · fail 0');
    expect(html).toContain('ok 10 · retry 4 · fail 1');

    for (const night of ['2026-10-27', '2026-10-28']) {
      const digestResponse = await fixtureApp.request(`/digest/${night}`);
      expect(digestResponse.status).toBe(200);
    }
  });
});
