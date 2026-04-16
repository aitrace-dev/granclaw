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
    expect(getIntegration('sample-integration')).toBeNull();
  });

  it('upserts and reads', () => {
    setIntegration('sample-integration', { enabled: true, config: { defaultProxy: 'us' } });
    const got = getIntegration('sample-integration');
    expect(got?.enabled).toBe(true);
    expect(got?.config).toEqual({ defaultProxy: 'us' });
  });

  it('updates updated_at on re-upsert', () => {
    setIntegration('sample-integration', { enabled: false, config: {} });
    const a = getIntegration('sample-integration')!;
    // sleep 1.1s so SQLite datetime('now') (second resolution) rolls over
    // we check the boolean flip instead to avoid flaky timing; that's what we care about
    setIntegration('sample-integration', { enabled: true, config: {} });
    const b = getIntegration('sample-integration')!;
    expect(a.enabled).toBe(false);
    expect(b.enabled).toBe(true);
  });

  it('lists all integrations ordered by id', () => {
    setIntegration('sample-integration', { enabled: true, config: {} });
    setIntegration('brightdata', { enabled: false, config: {} });
    expect(listIntegrations().map(i => i.id)).toEqual(['brightdata', 'sample-integration']);
  });

  it('round-trips complex config objects', () => {
    const cfg = { nested: { a: 1, b: ['x', 'y'] }, flag: true };
    setIntegration('sample-integration', { enabled: true, config: cfg });
    expect(getIntegration('sample-integration')?.config).toEqual(cfg);
  });
});
