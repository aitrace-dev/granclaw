import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { _resetForTests, getAppSecret, setAppSecret, hasAppSecret, deleteAppSecret } from './app-secrets.js';

function freshHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'granclaw-app-secrets-'));
}

describe('app-secrets', () => {
  beforeEach(() => {
    process.env.GRANCLAW_HOME = freshHome();
    process.env.GRANCLAW_SECRET_KEY = '0'.repeat(64);
    _resetForTests();
  });

  it('round-trips a secret', () => {
    setAppSecret('gologin_token', 'abc123');
    expect(getAppSecret('gologin_token')).toBe('abc123');
    expect(hasAppSecret('gologin_token')).toBe(true);
  });

  it('returns null for missing secret', () => {
    expect(getAppSecret('nope')).toBeNull();
    expect(hasAppSecret('nope')).toBe(false);
  });

  it('overwrites an existing secret', () => {
    setAppSecret('k', 'v1');
    setAppSecret('k', 'v2');
    expect(getAppSecret('k')).toBe('v2');
  });

  it('deletes a secret', () => {
    setAppSecret('k', 'v');
    deleteAppSecret('k');
    expect(getAppSecret('k')).toBeNull();
  });

  it('encrypts the value on disk', () => {
    setAppSecret('gologin_token', 'plaintext-value-xyz');
    const dbPath = path.join(process.env.GRANCLAW_HOME!, 'data', 'app-secrets.sqlite');
    const raw = fs.readFileSync(dbPath);
    // Raw file must not contain plaintext value anywhere
    expect(raw.toString('binary')).not.toContain('plaintext-value-xyz');
  });

  it('falls back to plaintext storage and warns when GRANCLAW_SECRET_KEY missing', () => {
    delete process.env.GRANCLAW_SECRET_KEY;
    _resetForTests();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setAppSecret('k', 'v');
    expect(getAppSecret('k')).toBe('v');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('GRANCLAW_SECRET_KEY'));
    warn.mockRestore();
  });

  it('rejects a key of wrong length', () => {
    process.env.GRANCLAW_SECRET_KEY = 'deadbeef';  // 8 chars, not 64
    _resetForTests();
    expect(() => setAppSecret('k', 'v')).toThrow(/64 hex chars/);
  });

  it('decrypts values written with the same key across fresh DB handle opens', () => {
    setAppSecret('k', 'secret-value');
    _resetForTests();  // close handle, force re-open
    expect(getAppSecret('k')).toBe('secret-value');
  });
});
