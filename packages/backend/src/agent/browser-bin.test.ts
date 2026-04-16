import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { resolveBrowserBinary } from './browser-bin.js';

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

  it('returns local agent-browser when GoLogin inactive', () => {
    (getActiveProfile as any).mockReturnValue(null);
    const r = resolveBrowserBinary('agent1', ws);
    expect(r.bin).toBe('agent-browser');
    expect(r.launchArgs).toContain('--session');
    expect(r.launchArgs).toContain('agent1');
    expect(r.env).toEqual({});
    expect(r.isGoLogin).toBe(false);
    expect(r.recordingSupported).toBe(true);
  });

  it('returns gologin-agent-browser-cli when active', () => {
    (getActiveProfile as any).mockReturnValue({ profileId: 'prof_x', token: 'tok_y' });
    const r = resolveBrowserBinary('agent1', ws);
    expect(r.bin).toBe('gologin-agent-browser-cli');
    expect(r.launchArgs).toEqual(['--session', 'agent1', '--profile', 'prof_x']);
    expect(r.env).toEqual({ GOLOGIN_TOKEN: 'tok_y', GOLOGIN_PROFILE_ID: 'prof_x' });
    expect(r.isGoLogin).toBe(true);
    expect(r.recordingSupported).toBe(false);
  });

  it('never leaks token into launchArgs (no process-list leakage)', () => {
    (getActiveProfile as any).mockReturnValue({ profileId: 'p', token: 'SECRET_TOKEN_DO_NOT_LEAK' });
    const r = resolveBrowserBinary('agent1', ws);
    expect(r.launchArgs.join(' ')).not.toContain('SECRET_TOKEN_DO_NOT_LEAK');
  });

  it('includes --profile <path> when workspace has .browser-profile dir (local path)', () => {
    (getActiveProfile as any).mockReturnValue(null);
    const profileDir = path.join(ws, '.browser-profile');
    fs.mkdirSync(profileDir);
    const r = resolveBrowserBinary('agent1', ws);
    expect(r.launchArgs).toContain('--profile');
    expect(r.launchArgs).toContain(profileDir);
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
    expect(r.bin).toBe('gologin-agent-browser-cli');
  });
});
