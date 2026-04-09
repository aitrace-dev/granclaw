import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveHome, seedHomeIfNeeded } from './home.js';

describe('resolveHome', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.GRANCLAW_HOME;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('prefers --home flag over env and default', () => {
    process.env.GRANCLAW_HOME = '/env/path';
    expect(resolveHome('/flag/path')).toBe(path.resolve('/flag/path'));
  });

  it('uses GRANCLAW_HOME when flag is absent', () => {
    process.env.GRANCLAW_HOME = '/env/path';
    expect(resolveHome()).toBe(path.resolve('/env/path'));
  });

  it('defaults to ~/.granclaw', () => {
    expect(resolveHome()).toBe(path.join(os.homedir(), '.granclaw'));
  });

  it('treats whitespace-only flag as unset', () => {
    process.env.GRANCLAW_HOME = '/env/path';
    expect(resolveHome('   ')).toBe(path.resolve('/env/path'));
  });

  it('treats whitespace-only GRANCLAW_HOME as unset', () => {
    process.env.GRANCLAW_HOME = '   ';
    expect(resolveHome()).toBe(path.join(os.homedir(), '.granclaw'));
  });
});

describe('seedHomeIfNeeded', () => {
  let tmpHome: string;
  let tmpTemplates: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-home-'));
    tmpTemplates = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-tpl-'));
    fs.writeFileSync(path.join(tmpTemplates, 'agents.config.json'), '{"agents":[]}\n');
    // Delete home so seeding actually runs from a clean slate
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpTemplates, { recursive: true, force: true });
  });

  it('creates home directory and copies agents.config.json on first run', () => {
    seedHomeIfNeeded(tmpHome, tmpTemplates);
    expect(fs.existsSync(path.join(tmpHome, 'agents.config.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpHome, 'data'))).toBe(true);
    expect(fs.existsSync(path.join(tmpHome, 'workspaces'))).toBe(true);
    expect(fs.existsSync(path.join(tmpHome, 'logs'))).toBe(true);
    const content = fs.readFileSync(path.join(tmpHome, 'agents.config.json'), 'utf-8');
    expect(JSON.parse(content)).toEqual({ agents: [] });
  });

  it('does not overwrite existing agents.config.json', () => {
    fs.mkdirSync(tmpHome, { recursive: true });
    fs.writeFileSync(path.join(tmpHome, 'agents.config.json'), '{"agents":[{"id":"existing","name":"existing","model":"x","workspaceDir":"./x","allowedTools":[]}]}\n');
    seedHomeIfNeeded(tmpHome, tmpTemplates);
    const content = fs.readFileSync(path.join(tmpHome, 'agents.config.json'), 'utf-8');
    expect(JSON.parse(content).agents[0].id).toBe('existing');
  });

  it('is idempotent when called twice', () => {
    seedHomeIfNeeded(tmpHome, tmpTemplates);
    // Mutate the file to prove the second call does not overwrite
    fs.writeFileSync(path.join(tmpHome, 'agents.config.json'), '{"agents":[{"id":"mutated","name":"mutated","model":"x","workspaceDir":"./x","allowedTools":[]}]}\n');
    seedHomeIfNeeded(tmpHome, tmpTemplates);
    const content = fs.readFileSync(path.join(tmpHome, 'agents.config.json'), 'utf-8');
    expect(JSON.parse(content).agents[0].id).toBe('mutated');
  });
});
