/**
 * secrets-vault.test.ts
 *
 * Verifies that secrets are stored in and read from the per-agent
 * agent.sqlite (workspace-pool), NOT the global system.sqlite.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listSecretNames, getSecrets, setSecret, deleteSecret, deleteAllSecrets } from './secrets-vault.js';
import { closeWorkspaceDb } from './workspace-pool.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'granclaw-secrets-test-'));
}

describe('secrets-vault', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      closeWorkspaceDb(dir);
      fs.rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it('stores and retrieves a secret from agent.sqlite in the workspace dir', () => {
    const dir = tmpDir(); dirs.push(dir);

    setSecret(dir, 'TELEGRAM_BOT_TOKEN', 'abc123');

    const secrets = getSecrets(dir);
    expect(secrets['TELEGRAM_BOT_TOKEN']).toBe('abc123');

    // Verify it's in agent.sqlite, not some global DB
    expect(fs.existsSync(path.join(dir, 'agent.sqlite'))).toBe(true);
  });

  it('two agents have isolated secret stores', () => {
    const dir1 = tmpDir(); dirs.push(dir1);
    const dir2 = tmpDir(); dirs.push(dir2);

    setSecret(dir1, 'MY_KEY', 'agent-one-value');
    setSecret(dir2, 'MY_KEY', 'agent-two-value');

    expect(getSecrets(dir1)['MY_KEY']).toBe('agent-one-value');
    expect(getSecrets(dir2)['MY_KEY']).toBe('agent-two-value');
  });

  it('listSecretNames returns only names, not values', () => {
    const dir = tmpDir(); dirs.push(dir);

    setSecret(dir, 'FOO', 'bar');
    setSecret(dir, 'BAZ', 'qux');

    const names = listSecretNames(dir);
    expect(names).toContain('FOO');
    expect(names).toContain('BAZ');
    expect(names).toHaveLength(2);
  });

  it('overwriting a secret updates the value', () => {
    const dir = tmpDir(); dirs.push(dir);

    setSecret(dir, 'TOKEN', 'old');
    setSecret(dir, 'TOKEN', 'new');

    expect(getSecrets(dir)['TOKEN']).toBe('new');
    expect(listSecretNames(dir)).toHaveLength(1);
  });

  it('deleteSecret removes a single secret', () => {
    const dir = tmpDir(); dirs.push(dir);

    setSecret(dir, 'A', '1');
    setSecret(dir, 'B', '2');
    deleteSecret(dir, 'A');

    const secrets = getSecrets(dir);
    expect(secrets['A']).toBeUndefined();
    expect(secrets['B']).toBe('2');
  });

  it('deleteAllSecrets clears everything', () => {
    const dir = tmpDir(); dirs.push(dir);

    setSecret(dir, 'X', '1');
    setSecret(dir, 'Y', '2');
    deleteAllSecrets(dir);

    expect(getSecrets(dir)).toEqual({});
  });

  it('getSecrets returns all secrets as a flat env-var map', () => {
    const dir = tmpDir(); dirs.push(dir);

    setSecret(dir, 'TELEGRAM_BOT_TOKEN', 'tg-token');
    setSecret(dir, 'OPENROUTER_API_KEY', 'or-key');

    const env = getSecrets(dir);
    expect(env).toEqual({
      TELEGRAM_BOT_TOKEN: 'tg-token',
      OPENROUTER_API_KEY: 'or-key',
    });
  });
});
