import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('digest page', () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
    process.env.LANE_MARKER = 'TEST-MARKER';
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  it('renders all fields, raw offsets, warning marks, and the lane banner', async () => {
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), [
      JSON.stringify({ at: '2026-10-28T23:00:00+01:00', job: 'z-job', status: 'retry', owner: null }),
      JSON.stringify({ at: '2026-10-29T00:00:00+01:00', job: 'z-job', status: 'retry', owner: null }),
      JSON.stringify({ at: '2026-10-29T01:00:00+01:00', job: 'z-job', status: 'retry', owner: null, error: 'temporary' }),
      JSON.stringify({ at: '2026-10-29T02:00:00+01:00', job: 'z-job', status: 'ok', owner: null }),
      JSON.stringify({ at: '2026-10-28T22:00:00+01:00', job: 'a-job', status: 'fail', owner: 'lane-07', error: 'broken' }),
      'not json',
    ].join('\n'));

    const config = { adapter: 'shim', installed: 'now', beatEverySeconds: 60, runsDir };
    const res = await createApp(config).request('/digest/2026-10-28');
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('TEST-MARKER');
    expect(html.indexOf('a-job')).toBeLessThan(html.indexOf('z-job'));
    expect(html).toContain('2026-10-28T23:00:00+01:00');
    expect(html).toContain('2026-10-29T02:00:00+01:00');
    expect(html).toContain('ok 1 · retry 3 · fail 1 · bad lines 1');
    expect(html).toContain('—');
    expect(html).toContain('class="warn">3</td>');
    expect(html).toContain('class="warn">1</td>');
    expect(html).not.toContain('<script');
  });

  it('renders an empty night', async () => {
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), '');
    const config = { adapter: 'shim', installed: 'now', beatEverySeconds: 60, runsDir };
    const res = await createApp(config).request('/digest/2026-10-28');

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('returns a laid-out 404 for a missing night', async () => {
    mkdirSync(runsDir, { recursive: true });
    const config = { adapter: 'shim', installed: 'now', beatEverySeconds: 60, runsDir };
    const res = await createApp(config).request('/digest/2026-10-28');
    const html = await res.text();

    expect(res.status).toBe(404);
    expect(html).toContain('TEST-MARKER');
    expect(html).toContain('night not found');
  });
});
