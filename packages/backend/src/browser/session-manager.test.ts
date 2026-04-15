/**
 * session-manager.test.ts
 *
 * Regression tests for browser session lifecycle.
 *
 * The killer bug these guard against: agent-browser's `record start`
 * exits with code 0 and prints "✓ Recording started" even when ffmpeg
 * is missing from the host — the ffmpeg failure only surfaces on
 * `record stop`. Pre-fix, this caused every browser session on the
 * production Docker image to end up with `video: "recording.webm"` in
 * meta.json, no actual .webm file on disk, and `videoValid: false`
 * forever in the frontend replay view.
 *
 * After the fix, startRecording() polls for the WebM file to appear
 * within ~1.5s and returns false if it never materializes, leaving
 * meta.video as null so the frontend has an honest signal.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Mock execFile so we can simulate the "ffmpeg missing" agent-browser
// behaviour without needing a real binary.
type ExecFileHandler = (bin: string, args: string[], opts: unknown) => Promise<{ stdout: string; stderr: string }> | { stdout: string; stderr: string };
let execFileHandler: ExecFileHandler;

vi.mock('child_process', () => ({
  execFile: (bin: string, args: string[], opts: unknown, cb: (err: Error | null, r?: { stdout: string; stderr: string }) => void) => {
    Promise.resolve()
      .then(() => execFileHandler(bin, args, opts))
      .then((r) => cb(null, r))
      .catch((err) => cb(err as Error));
  },
}));

// Import AFTER the mock is set up so session-manager picks up the mocked execFile.
import { createSession, startRecording } from './session-manager.js';

describe('startRecording', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'granclaw-sm-'));
    // Ensure no stray AGENT_BROWSER_BIN override contaminates the test
    delete process.env.AGENT_BROWSER_BIN;
  });

  afterEach(() => {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('returns false and leaves meta.video null when agent-browser exits 0 but no WebM file is produced (ffmpeg missing)', async () => {
    // Simulate the real agent-browser-without-ffmpeg behaviour:
    // `record start` succeeds, but no file is ever written.
    execFileHandler = (_bin, args) => {
      if (args.includes('start')) return { stdout: '✓ Recording started: /tmp/x.webm\n', stderr: '' };
      if (args.includes('stop')) return { stdout: '', stderr: '' };
      return { stdout: '', stderr: '' };
    };

    const handle = createSession('agent-x', tmp);
    const ok = await startRecording(handle);

    expect(ok, 'startRecording should report failure when no .webm lands on disk').toBe(false);
    expect(handle.recordingStarted).toBe(false);

    const meta = JSON.parse(fs.readFileSync(handle.metaPath, 'utf-8'));
    expect(meta.video, 'meta.video must stay null so the frontend does not falsely advertise a recording').toBeNull();
  });

  it('returns true and sets meta.video="recording.webm" when the WebM file actually materializes', async () => {
    execFileHandler = (_bin, args) => {
      if (args.includes('start')) {
        // Simulate ffmpeg dropping the EBML header on disk ~immediately.
        // The `start` arg is the last positional — the path to the file.
        const outPath = args[args.length - 1];
        fs.writeFileSync(outPath, Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00]));
        return { stdout: '✓ Recording started\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    };

    const handle = createSession('agent-y', tmp);
    const ok = await startRecording(handle);

    expect(ok).toBe(true);
    expect(handle.recordingStarted).toBe(true);

    const meta = JSON.parse(fs.readFileSync(handle.metaPath, 'utf-8'));
    expect(meta.video).toBe('recording.webm');
    expect(fs.existsSync(path.join(handle.sessionDir, 'recording.webm'))).toBe(true);
  });

  it('returns false when agent-browser itself errors out', async () => {
    execFileHandler = () => {
      throw new Error('spawn ENOENT');
    };

    const handle = createSession('agent-z', tmp);
    const ok = await startRecording(handle);

    expect(ok).toBe(false);
    expect(handle.recordingStarted).toBe(false);
    const meta = JSON.parse(fs.readFileSync(handle.metaPath, 'utf-8'));
    expect(meta.video).toBeNull();
  });
});
