import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, RunStatus, readNight as ReadNight } from './types.js';

type RunEvent = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

function parseEvent(line: string): RunEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (
    typeof event.at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(event.at) ||
    !Number.isFinite(Date.parse(event.at)) ||
    typeof event.job !== 'string' || event.job.trim() === '' ||
    (event.status !== 'ok' && event.status !== 'retry' && event.status !== 'fail') ||
    (event.owner !== null && typeof event.owner !== 'string') ||
    (event.error !== undefined && typeof event.error !== 'string')
  ) return null;
  return {
    at: event.at,
    job: event.job,
    status: event.status,
    owner: event.owner,
    ...(event.error === undefined ? {} : { error: event.error }),
  };
}

export const readNight: typeof ReadNight = (runsDir, night) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;
  const date = new Date(`${night}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== night) return null;

  let source: string;
  try {
    source = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null;
    throw error;
  }

  const rows = new Map<string, DigestRow>();
  const errorTimes = new Map<string, number>();
  const counts = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;

  for (const line of source.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const event = parseEvent(line);
    if (!event) {
      badLines += 1;
      continue;
    }
    counts[event.status] += 1;
    let row = rows.get(event.job);
    if (!row) {
      row = {
        job: event.job,
        owner: event.owner,
        runs: 0,
        retries: 0,
        failures: 0,
        lastStatus: event.status,
        lastError: null,
        firstAt: event.at,
        lastAt: event.at,
      };
      rows.set(event.job, row);
    }
    row.runs += 1;
    if (event.status === 'retry') row.retries += 1;
    if (event.status === 'fail') row.failures += 1;
    const eventTime = Date.parse(event.at);
    if (eventTime < Date.parse(row.firstAt)) row.firstAt = event.at;
    if (eventTime >= Date.parse(row.lastAt)) {
      row.lastAt = event.at;
      row.lastStatus = event.status;
      row.owner = event.owner;
    }
    if (event.error && eventTime >= (errorTimes.get(event.job) ?? -Infinity)) {
      row.lastError = event.error;
      errorTimes.set(event.job, eventTime);
    }
  }

  return {
    night,
    rows: [...rows.values()].sort((left, right) =>
      left.job < right.job ? -1 : left.job > right.job ? 1 : 0),
    badLines,
    counts,
  };
};
