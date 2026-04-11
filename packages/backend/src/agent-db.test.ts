/**
 * agent-db.test.ts
 *
 * Unit tests for the job queue — focusing on schedule channel behaviour:
 * enqueue with channelId='schedule', dequeueNext returns it, and busy-lane
 * skipping works correctly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { enqueue, dequeueNext, markDone, saveSession, getSession, getSessionFile } from './agent-db.js';
import { closeWorkspaceDb } from './workspace-pool.js';

const AGENT = 'test-agent';
let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-agentdb-test-'));
});

afterEach(() => {
  closeWorkspaceDb(tmp);
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('enqueue / dequeueNext — schedule channel', () => {
  it('enqueues with channelId=schedule and dequeues with the correct channelId', () => {
    enqueue(tmp, AGENT, 'Run the daily health check', 'schedule');
    const job = dequeueNext(tmp, AGENT);
    expect(job).not.toBeNull();
    expect(job!.channelId).toBe('schedule');
    expect(job!.message).toBe('Run the daily health check');
  });

  it('dequeues in FIFO order across mixed channels', () => {
    enqueue(tmp, AGENT, 'ui msg', 'ui');
    enqueue(tmp, AGENT, 'schedule msg', 'schedule');

    const first = dequeueNext(tmp, AGENT);
    expect(first!.channelId).toBe('ui');
    expect(first!.message).toBe('ui msg');

    markDone(tmp, first!.id);

    const second = dequeueNext(tmp, AGENT);
    expect(second!.channelId).toBe('schedule');
    expect(second!.message).toBe('schedule msg');
  });

  it('skips the schedule lane when schedule is busy', () => {
    enqueue(tmp, AGENT, 'ui msg', 'ui');
    enqueue(tmp, AGENT, 'schedule msg', 'schedule');

    const busyChannels = new Set(['schedule']);
    const job = dequeueNext(tmp, AGENT, busyChannels);
    // schedule lane is busy — should return the ui job
    expect(job!.channelId).toBe('ui');
    expect(job!.message).toBe('ui msg');
  });

  it('returns null when the only pending job is in a busy lane', () => {
    enqueue(tmp, AGENT, 'schedule msg', 'schedule');
    const busyChannels = new Set(['schedule']);
    const job = dequeueNext(tmp, AGENT, busyChannels);
    expect(job).toBeNull();
  });

  it('returns null when queue is empty', () => {
    expect(dequeueNext(tmp, AGENT)).toBeNull();
  });
});

describe('saveSession / getSession / getSessionFile — per-channel isolation', () => {
  it('stores distinct session files per channel and reads them back independently', () => {
    saveSession(tmp, AGENT, 'ui-session-id',  'ui',       '/tmp/pi-sessions/ui.jsonl');
    saveSession(tmp, AGENT, 'sch-session-id', 'schedule', '/tmp/pi-sessions/schedule.jsonl');

    expect(getSession(tmp, AGENT, 'ui')).toBe('ui-session-id');
    expect(getSession(tmp, AGENT, 'schedule')).toBe('sch-session-id');

    expect(getSessionFile(tmp, AGENT, 'ui')).toBe('/tmp/pi-sessions/ui.jsonl');
    expect(getSessionFile(tmp, AGENT, 'schedule')).toBe('/tmp/pi-sessions/schedule.jsonl');
  });

  it('returns null for unknown channels', () => {
    saveSession(tmp, AGENT, 'ui-session-id', 'ui', '/tmp/pi-sessions/ui.jsonl');
    expect(getSession(tmp, AGENT, 'telegram')).toBeNull();
    expect(getSessionFile(tmp, AGENT, 'telegram')).toBeNull();
  });

  it('upserts on conflict (agent_id, channel_id)', () => {
    saveSession(tmp, AGENT, 'first',  'ui', '/tmp/first.jsonl');
    saveSession(tmp, AGENT, 'second', 'ui', '/tmp/second.jsonl');
    expect(getSession(tmp, AGENT, 'ui')).toBe('second');
    expect(getSessionFile(tmp, AGENT, 'ui')).toBe('/tmp/second.jsonl');
  });

  it('supports per-cron channel ids so parallel crons never collide', () => {
    saveSession(tmp, AGENT, 'id-a', 'sch-cron-a', '/tmp/a.jsonl');
    saveSession(tmp, AGENT, 'id-b', 'sch-cron-b', '/tmp/b.jsonl');
    expect(getSessionFile(tmp, AGENT, 'sch-cron-a')).toBe('/tmp/a.jsonl');
    expect(getSessionFile(tmp, AGENT, 'sch-cron-b')).toBe('/tmp/b.jsonl');
  });

  it('returns null when saveSession omitted sessionFile', () => {
    saveSession(tmp, AGENT, 'no-file', 'ui');
    expect(getSession(tmp, AGENT, 'ui')).toBe('no-file');
    expect(getSessionFile(tmp, AGENT, 'ui')).toBeNull();
  });
});
