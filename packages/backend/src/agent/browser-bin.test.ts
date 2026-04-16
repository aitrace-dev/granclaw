import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  resolveBrowserBinary,
  buildArgv,
  registerBrowserProvider,
  _resetBrowserProvidersForTests,
  type BrowserBinaryResolution,
} from './browser-bin.js';

describe('resolveBrowserBinary', () => {
  let ws: string;
  beforeEach(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'granclaw-bb-'));
    _resetBrowserProvidersForTests();
    delete process.env.AGENT_BROWSER_BIN;
  });

  it('returns default agent-browser when no providers registered', () => {
    const r = resolveBrowserBinary('agent1', ws);
    expect(r.bin).toBe('agent-browser');
    expect(r.preCommandArgs).toContain('--session');
    expect(r.preCommandArgs).toContain('agent1');
    expect(r.postCommandArgs).toEqual([]);
    expect(r.isRemote).toBe(false);
    expect(r.recordingSupported).toBe(true);
  });

  it('uses the first registered provider that returns non-null', () => {
    const fakeResolution: BrowserBinaryResolution = {
      bin: 'fake-browser',
      preCommandArgs: [],
      postCommandArgs: ['--profile', 'prof_x'],
      env: { FAKE_TOKEN: 't' },
      isRemote: true,
      recordingSupported: false,
    };
    registerBrowserProvider(() => fakeResolution);
    const r = resolveBrowserBinary('agent1', ws);
    expect(r.bin).toBe('fake-browser');
    expect(r.postCommandArgs).toEqual(['--profile', 'prof_x']);
    expect(r.isRemote).toBe(true);
  });

  it('falls through providers that return null', () => {
    registerBrowserProvider(() => null);
    registerBrowserProvider(() => null);
    const r = resolveBrowserBinary('agent1', ws);
    expect(r.bin).toBe('agent-browser');
  });

  it('provider order matters — first non-null wins', () => {
    registerBrowserProvider(() => ({
      bin: 'first', preCommandArgs: [], postCommandArgs: [], env: {},
      isRemote: true, recordingSupported: false,
    }));
    registerBrowserProvider(() => ({
      bin: 'second', preCommandArgs: [], postCommandArgs: [], env: {},
      isRemote: true, recordingSupported: false,
    }));
    expect(resolveBrowserBinary('agent1', ws).bin).toBe('first');
  });

  it('local path includes --profile <path> when workspace has .browser-profile dir', () => {
    fs.mkdirSync(path.join(ws, '.browser-profile'));
    const r = resolveBrowserBinary('agent1', ws);
    expect(r.preCommandArgs).toContain('--profile');
    expect(r.preCommandArgs).toContain(path.join(ws, '.browser-profile'));
  });

  it('respects AGENT_BROWSER_BIN env override on local path', () => {
    process.env.AGENT_BROWSER_BIN = '/custom/path/agent-browser';
    const r = resolveBrowserBinary('agent1', ws);
    expect(r.bin).toBe('/custom/path/agent-browser');
    delete process.env.AGENT_BROWSER_BIN;
  });

  it('AGENT_BROWSER_BIN env does NOT override when a provider matches', () => {
    registerBrowserProvider(() => ({
      bin: 'plugin-browser', preCommandArgs: [], postCommandArgs: [], env: {},
      isRemote: true, recordingSupported: false,
    }));
    process.env.AGENT_BROWSER_BIN = '/custom/agent-browser';
    expect(resolveBrowserBinary('agent1', ws).bin).toBe('plugin-browser');
    delete process.env.AGENT_BROWSER_BIN;
  });
});

describe('buildArgv', () => {
  it('local: flags before command — matches agent-browser CLI', () => {
    const argv = buildArgv(
      {
        bin: 'agent-browser', env: {}, isRemote: false, recordingSupported: true,
        preCommandArgs: ['--session', 'a1'],
        postCommandArgs: [],
      },
      'open',
      ['https://example.com'],
    );
    expect(argv).toEqual(['--session', 'a1', 'open', 'https://example.com']);
  });

  it('remote: flags after command — matches remote-browser-cli CLI', () => {
    const argv = buildArgv(
      {
        bin: 'remote-browser-cli', env: {}, isRemote: true, recordingSupported: false,
        preCommandArgs: [],
        postCommandArgs: ['--session', 'a1', '--profile', 'prof_x'],
      },
      'open',
      ['https://example.com'],
    );
    expect(argv).toEqual(['open', 'https://example.com', '--session', 'a1', '--profile', 'prof_x']);
  });
});
