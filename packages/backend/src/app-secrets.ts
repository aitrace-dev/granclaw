/**
 * app-secrets.ts
 *
 * Granclaw-wide encrypted secrets store. Lives at <GRANCLAW_HOME>/data/app-secrets.sqlite.
 *
 * Scope distinction:
 *   - secrets-vault.ts  — per-agent workspace secrets (agent-facing, e.g. skill API keys)
 *   - app-secrets.ts    — per-install platform secrets (operator-facing, e.g. GoLogin API token)
 *
 * Secrets are encrypted with AES-256-GCM when GRANCLAW_SECRET_KEY (64 hex chars = 32 bytes)
 * is set. Missing key → plaintext fallback with a loud one-shot warning; we never crash
 * on boot because that would break local dev where a key isn't configured.
 *
 * Storage format per row: "aes:<ivHex>:<tagHex>:<encHex>" or "plain:<value>".
 */

import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { resolveGranclawHome } from './config.js';

let db: Database.Database | null = null;
let warned = false;

function deriveKey(): Buffer | null {
  const hex = process.env.GRANCLAW_SECRET_KEY?.trim();
  if (!hex) {
    if (!warned) {
      console.warn(
        '[app-secrets] GRANCLAW_SECRET_KEY not set — storing secrets in plaintext. ' +
        'Set a 64-char hex key (32 bytes) in production.'
      );
      warned = true;
    }
    return null;
  }
  if (hex.length !== 64) {
    throw new Error('GRANCLAW_SECRET_KEY must be 64 hex chars (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

function encrypt(plain: string): string {
  const key = deriveKey();
  if (!key) return 'plain:' + plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `aes:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decrypt(stored: string): string {
  if (stored.startsWith('plain:')) return stored.slice(6);
  if (!stored.startsWith('aes:')) throw new Error('app-secrets: unknown stored format');
  const [, ivHex, tagHex, encHex] = stored.split(':');
  const key = deriveKey();
  if (!key) throw new Error('GRANCLAW_SECRET_KEY required to decrypt stored secret');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const dec = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]);
  return dec.toString('utf8');
}

function getDb(): Database.Database {
  if (db) return db;
  const dir = path.join(resolveGranclawHome(), 'data');
  fs.mkdirSync(dir, { recursive: true });
  db = new Database(path.join(dir, 'app-secrets.sqlite'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_secrets (
      name       TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  return db;
}

export function getAppSecret(name: string): string | null {
  const row = getDb()
    .prepare('SELECT value FROM app_secrets WHERE name = ?')
    .get(name) as { value: string } | undefined;
  return row ? decrypt(row.value) : null;
}

export function setAppSecret(name: string, value: string): void {
  const stored = encrypt(value);
  getDb().prepare(`
    INSERT INTO app_secrets (name, value) VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(name, stored);
}

export function hasAppSecret(name: string): boolean {
  return getAppSecret(name) !== null;
}

export function deleteAppSecret(name: string): void {
  getDb().prepare('DELETE FROM app_secrets WHERE name = ?').run(name);
}

/**
 * Test-only: close and null the DB handle so a fresh GRANCLAW_HOME env var
 * takes effect on next call. Also resets the one-shot warning flag.
 */
export function _resetForTests(): void {
  if (db) {
    db.close();
    db = null;
  }
  warned = false;
}
