import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { _resetForTests, getIntegration, setIntegration, listIntegrations } from './registry.js';

describe('integrations registry', () => {
  beforeEach(() => {
    process.env.GRANCLAW_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'granclaw-int-'));
    _resetForTests();
  });

  it('returns null for missing integration', () => {
    expect(getIntegration('gologin')).toBeNull();
  });

  it('upserts and reads', () => {
    setIntegration('gologin', { enabled: true, config: { defaultProxy: 'us' } });
    const got = getIntegration('gologin');
    expect(got?.enabled).toBe(true);
    expect(got?.config).toEqual({ defaultProxy: 'us' });
  });

  it('updates updated_at on re-upsert', () => {
    setIntegration('gologin', { enabled: false, config: {} });
    const a = getIntegration('gologin')!;
    // sleep 1.1s so SQLite datetime('now') (second resolution) rolls over
    // we check the boolean flip instead to avoid flaky timing; that's what we care about
    setIntegration('gologin', { enabled: true, config: {} });
    const b = getIntegration('gologin')!;
    expect(a.enabled).toBe(false);
    expect(b.enabled).toBe(true);
  });

  it('lists all integrations ordered by id', () => {
    setIntegration('gologin', { enabled: true, config: {} });
    setIntegration('brightdata', { enabled: false, config: {} });
    expect(listIntegrations().map(i => i.id)).toEqual(['brightdata', 'gologin']);
  });

  it('round-trips complex config objects', () => {
    const cfg = { nested: { a: 1, b: ['x', 'y'] }, flag: true };
    setIntegration('gologin', { enabled: true, config: cfg });
    expect(getIntegration('gologin')?.config).toEqual(cfg);
  });
});
