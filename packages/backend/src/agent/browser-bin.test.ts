import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { resolveBrowserBinary, buildArgv } from './browser-bin.js';

vi.mock('../integrations/gologin/service.js', () => ({
  getActiveProfile: vi.fn(),
}));
import { getActiveProfile } from '../integrations/gologin/service.js';

describe('resolveBrowserBinary', () => {
  let ws: string;
  beforeEach(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'granclaw-bb-'));
    (getActiveProfile as any).mockReset();
    delete process.env.AGENT_BROWSER_BIN;
  });

  it('returns local agent-browser when GoLogin inactive — flags go before the subcommand', () => {
    (getActiveProfile as any).mockReturnValue(null);
    const r = resolveBrowserBinary('agent1', ws);
    expect(r.bin).toBe('agent-browser');
    expect(r.preCommandArgs).toContain('--session');
    expect(r.preCommandArgs).toContain('agent1');
    expect(r.postCommandArgs).toEqual([]);
    expect(r.env).toEqual({});
    expect(r.isGoLogin).toBe(false);
    expect(r.recordingSupported).toBe(true);
  });

  it('returns gologin-agent-browser when active — flags go AFTER the subcommand', () => {
    (getActiveProfile as any).mockReturnValue({ profileId: 'prof_x', token: 'tok_y' });
    const r = resolveBrowserBinary('agent1', ws);
    expect(r.bin).toBe('gologin-agent-browser');
    expect(r.preCommandArgs).toEqual([]);
    expect(r.postCommandArgs).toEqual(['--session', 'agent1', '--profile', 'prof_x']);
    expect(r.env).toEqual({ GOLOGIN_TOKEN: 'tok_y', GOLOGIN_PROFILE_ID: 'prof_x' });
    expect(r.isGoLogin).toBe(true);
    expect(r.recordingSupported).toBe(false);
  });

  it('never leaks token into argv (no process-list leakage)', () => {
    (getActiveProfile as any).mockReturnValue({ profileId: 'p', token: 'SECRET_TOKEN_DO_NOT_LEAK' });
    const r = resolveBrowserBinary('agent1', ws);
    const fullArgv = [...r.preCommandArgs, 'open', 'https://x', ...r.postCommandArgs].join(' ');
    expect(fullArgv).not.toContain('SECRET_TOKEN_DO_NOT_LEAK');
  });

  it('local path includes --profile <path> when workspace has .browser-profile dir', () => {
    (getActiveProfile as any).mockReturnValue(null);
    const profileDir = path.join(ws, '.browser-profile');
    fs.mkdirSync(profileDir);
    const r = resolveBrowserBinary('agent1', ws);
    expect(r.preCommandArgs).toContain('--profile');
    expect(r.preCommandArgs).toContain(profileDir);
  });

  it('respects AGENT_BROWSER_BIN env override on local path', () => {
    (getActiveProfile as any).mockReturnValue(null);
    process.env.AGENT_BROWSER_BIN = '/custom/path/agent-browser';
    const r = resolveBrowserBinary('agent1', ws);
    expect(r.bin).toBe('/custom/path/agent-browser');
  });

  it('AGENT_BROWSER_BIN env does NOT override the GoLogin path', () => {
    (getActiveProfile as any).mockReturnValue({ profileId: 'p', token: 't' });
    process.env.AGENT_BROWSER_BIN = '/custom/agent-browser';
    const r = resolveBrowserBinary('agent1', ws);
    expect(r.bin).toBe('gologin-agent-browser');
  });
});

describe('buildArgv', () => {
  it('local: flags before command — matches agent-browser CLI', () => {
    const argv = buildArgv(
      {
        bin: 'agent-browser', env: {}, isGoLogin: false, recordingSupported: true,
        preCommandArgs: ['--session', 'a1'],
        postCommandArgs: [],
      },
      'open',
      ['https://example.com'],
    );
    expect(argv).toEqual(['--session', 'a1', 'open', 'https://example.com']);
  });

  it('gologin: flags after command — matches gologin-agent-browser CLI', () => {
    const argv = buildArgv(
      {
        bin: 'gologin-agent-browser', env: {}, isGoLogin: true, recordingSupported: false,
        preCommandArgs: [],
        postCommandArgs: ['--session', 'a1', '--profile', 'prof_x'],
      },
      'open',
      ['https://example.com'],
    );
    expect(argv).toEqual(['open', 'https://example.com', '--session', 'a1', '--profile', 'prof_x']);
  });
});
