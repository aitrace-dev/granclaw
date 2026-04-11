import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

/**
 * Integration tests for the agent export / import endpoints.
 *
 * These exercise the workspace.json contract + the actual zip create/extract
 * pipeline. They build a tiny fake workspace on disk, hit the staging logic
 * the way the route does (cp + zip), then unzip it back and verify the
 * round-trip.
 *
 * The HTTP routes themselves are tested manually via curl in the
 * end-to-end probe — the unit-testable surface here is the format and
 * file plumbing.
 */

const FORMAT = 'granclaw-agent-export-v1';

interface FakeAgent {
  id: string;
  name: string;
  model: string;
  provider: string;
  workspaceDir: string;
  allowedTools: string[];
}

interface Manifest {
  format: string;
  granclawVersion: string;
  exportedAt: number;
  agent: FakeAgent;
}

function makeFakeWorkspace(root: string): void {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'AGENT.md'), '# Test agent\n');
  fs.writeFileSync(path.join(root, 'SOUL.md'), '# Identity: test\n');
  fs.mkdirSync(path.join(root, 'vault', 'journal'), { recursive: true });
  fs.writeFileSync(path.join(root, 'vault', 'index.md'), '# vault index\n');
  fs.writeFileSync(path.join(root, 'vault', 'journal', '2026-04-11.md'), 'today\n');
  fs.mkdirSync(path.join(root, '.pi'), { recursive: true });
  fs.writeFileSync(path.join(root, 'agent.sqlite'), 'SQLITE FAKE BYTES');
  // Transient files that should be EXCLUDED from the export
  fs.writeFileSync(path.join(root, 'agent.sqlite-wal'), 'WAL TRANSIENT');
  fs.writeFileSync(path.join(root, 'agent.sqlite-shm'), 'SHM TRANSIENT');
  fs.mkdirSync(path.join(root, '.browser-sessions'), { recursive: true });
  fs.writeFileSync(path.join(root, '.browser-sessions', '.resolved-session'), 'sess-123');
}

function buildExportZip(workspaceDir: string, manifest: Manifest, outZip: string): void {
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-stage-'));
  try {
    fs.writeFileSync(path.join(stagingDir, 'workspace.json'), JSON.stringify(manifest, null, 2));
    execFileSync('cp', ['-R', workspaceDir, path.join(stagingDir, 'workspace')]);
    execFileSync('bash', ['-c',
      `cd "${stagingDir}" && zip -q -r "${outZip}" workspace.json workspace ` +
      `-x "workspace/*.sqlite-wal" "workspace/*.sqlite-shm" ` +
      `"workspace/.browser-sessions/.lock*" "workspace/.browser-sessions/.lock.d/*" ` +
      `"workspace/.browser-sessions/.resolved-session"`,
    ]);
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

function extractAndValidate(zipPath: string): {
  manifest: Manifest;
  workspaceFiles: string[];
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-'));
  try {
    execFileSync('unzip', ['-q', zipPath, '-d', dir]);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'workspace.json'), 'utf8')) as Manifest;
    const workspaceRoot = path.join(dir, 'workspace');
    const workspaceFiles: string[] = [];
    function walk(p: string, prefix = ''): void {
      for (const entry of fs.readdirSync(p)) {
        const full = path.join(p, entry);
        const rel = path.join(prefix, entry);
        if (fs.statSync(full).isDirectory()) walk(full, rel);
        else workspaceFiles.push(rel);
      }
    }
    if (fs.existsSync(workspaceRoot)) walk(workspaceRoot);
    return { manifest, workspaceFiles };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('agent export — workspace.json manifest', () => {
  it('manifest has the v1 format string and required fields', () => {
    const m: Manifest = {
      format: FORMAT,
      granclawVersion: '0.1.0',
      exportedAt: Date.now(),
      agent: {
        id: 'lucia',
        name: 'Lucia',
        model: 'deepseek/deepseek-v3.2',
        provider: 'openrouter',
        workspaceDir: './workspaces/lucia',
        allowedTools: ['filesystem', 'browser', 'task-manager'],
      },
    };
    expect(m.format).toBe('granclaw-agent-export-v1');
    expect(m.granclawVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(m.agent.id).toBe('lucia');
    expect(m.agent.allowedTools).toContain('browser');
  });
});

describe('agent export — zip pipeline', () => {
  let tmp: string;
  let workspaceDir: string;
  let zipPath: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-export-test-'));
    workspaceDir = path.join(tmp, 'src-workspace');
    zipPath = path.join(tmp, 'export.zip');
    makeFakeWorkspace(workspaceDir);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('produces a zip containing workspace.json + workspace/ entries', () => {
    const manifest: Manifest = {
      format: FORMAT,
      granclawVersion: '0.1.0',
      exportedAt: 1_000_000,
      agent: {
        id: 'tester',
        name: 'Tester',
        model: 'test-model',
        provider: 'test-provider',
        workspaceDir: './workspaces/tester',
        allowedTools: ['filesystem'],
      },
    };
    buildExportZip(workspaceDir, manifest, zipPath);

    const { manifest: roundTripped, workspaceFiles } = extractAndValidate(zipPath);
    expect(roundTripped.format).toBe(FORMAT);
    expect(roundTripped.agent.id).toBe('tester');
    expect(workspaceFiles).toContain('AGENT.md');
    expect(workspaceFiles).toContain('SOUL.md');
    expect(workspaceFiles).toContain(path.join('vault', 'index.md'));
    expect(workspaceFiles).toContain(path.join('vault', 'journal', '2026-04-11.md'));
    expect(workspaceFiles).toContain('agent.sqlite');
  });

  it('excludes transient SQLite WAL/SHM files', () => {
    const manifest: Manifest = {
      format: FORMAT, granclawVersion: '0.1.0', exportedAt: 1, agent: {
        id: 'tester', name: 'T', model: 'm', provider: 'p',
        workspaceDir: './workspaces/tester', allowedTools: [],
      },
    };
    buildExportZip(workspaceDir, manifest, zipPath);

    const { workspaceFiles } = extractAndValidate(zipPath);
    expect(workspaceFiles).not.toContain('agent.sqlite-wal');
    expect(workspaceFiles).not.toContain('agent.sqlite-shm');
  });

  it('excludes wrapper lock + resolved-session marker files', () => {
    const manifest: Manifest = {
      format: FORMAT, granclawVersion: '0.1.0', exportedAt: 1, agent: {
        id: 'tester', name: 'T', model: 'm', provider: 'p',
        workspaceDir: './workspaces/tester', allowedTools: [],
      },
    };
    buildExportZip(workspaceDir, manifest, zipPath);

    const { workspaceFiles } = extractAndValidate(zipPath);
    expect(workspaceFiles.some((f) => f.includes('.resolved-session'))).toBe(false);
  });

  it('round-trip: export → unzip → validate the SQLite blob is bit-perfect', () => {
    const original = fs.readFileSync(path.join(workspaceDir, 'agent.sqlite'));
    const manifest: Manifest = {
      format: FORMAT, granclawVersion: '0.1.0', exportedAt: 1, agent: {
        id: 'tester', name: 'T', model: 'm', provider: 'p',
        workspaceDir: './workspaces/tester', allowedTools: [],
      },
    };
    buildExportZip(workspaceDir, manifest, zipPath);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roundtrip-'));
    try {
      execFileSync('unzip', ['-q', zipPath, '-d', dir]);
      const roundTripped = fs.readFileSync(path.join(dir, 'workspace', 'agent.sqlite'));
      expect(roundTripped.equals(original)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('agent import — manifest validation', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-import-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // Replicates the validation block in the POST /agents/import handler
  function validateManifest(rawJson: string): { ok: true; manifest: Manifest } | { ok: false; error: string } {
    let manifest: Partial<Manifest>;
    try { manifest = JSON.parse(rawJson) as Partial<Manifest>; }
    catch { return { ok: false, error: 'workspace.json is not valid JSON' }; }

    if (manifest.format !== FORMAT) {
      return { ok: false, error: `unsupported export format: ${manifest.format ?? 'missing'}` };
    }
    if (!manifest.agent || !manifest.agent.id || !manifest.agent.name) {
      return { ok: false, error: 'workspace.json missing required agent fields' };
    }
    return { ok: true, manifest: manifest as Manifest };
  }

  it('accepts a valid v1 manifest', () => {
    const result = validateManifest(JSON.stringify({
      format: FORMAT,
      granclawVersion: '0.1.0',
      exportedAt: 1,
      agent: { id: 'a', name: 'A', model: 'm', provider: 'p', workspaceDir: 'w', allowedTools: [] },
    }));
    expect(result.ok).toBe(true);
  });

  it('rejects malformed JSON', () => {
    const result = validateManifest('{"format": "granclaw');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('not valid JSON');
  });

  it('rejects unknown format strings', () => {
    const result = validateManifest(JSON.stringify({ format: 'something-else' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('unsupported export format');
  });

  it('rejects manifests without an agent block', () => {
    const result = validateManifest(JSON.stringify({ format: FORMAT, granclawVersion: '0.1.0', exportedAt: 1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('missing required agent fields');
  });

  it('rejects manifests with an agent missing id', () => {
    const result = validateManifest(JSON.stringify({
      format: FORMAT, granclawVersion: '0.1.0', exportedAt: 1,
      agent: { name: 'A' },
    }));
    expect(result.ok).toBe(false);
  });
});

describe('agent export → import round-trip on disk', () => {
  let tmp: string;

  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roundtrip-test-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('a workspace round-trips through export + import file plumbing', () => {
    // Build the source workspace
    const sourceWorkspace = path.join(tmp, 'source');
    makeFakeWorkspace(sourceWorkspace);
    fs.writeFileSync(path.join(sourceWorkspace, 'extra.txt'), 'custom content');

    // Export
    const zipPath = path.join(tmp, 'export.zip');
    const manifest: Manifest = {
      format: FORMAT, granclawVersion: '0.1.0', exportedAt: Date.now(),
      agent: {
        id: 'roundtrip', name: 'Round Trip', model: 'm', provider: 'p',
        workspaceDir: './workspaces/roundtrip', allowedTools: ['filesystem'],
      },
    };
    buildExportZip(sourceWorkspace, manifest, zipPath);

    // Simulate the import handler: unzip → validate → cp into workspaces/<id>
    const extractDir = path.join(tmp, 'extracted');
    fs.mkdirSync(extractDir);
    execFileSync('unzip', ['-q', zipPath, '-d', extractDir]);

    const importedManifest = JSON.parse(fs.readFileSync(path.join(extractDir, 'workspace.json'), 'utf8')) as Manifest;
    expect(importedManifest.format).toBe(FORMAT);

    const targetWorkspace = path.join(tmp, 'workspaces', 'roundtrip');
    fs.mkdirSync(path.dirname(targetWorkspace), { recursive: true });
    execFileSync('cp', ['-R', path.join(extractDir, 'workspace'), targetWorkspace]);

    // Verify the imported workspace has the same content as the source
    expect(fs.readFileSync(path.join(targetWorkspace, 'AGENT.md'), 'utf8')).toBe('# Test agent\n');
    expect(fs.readFileSync(path.join(targetWorkspace, 'SOUL.md'), 'utf8')).toBe('# Identity: test\n');
    expect(fs.readFileSync(path.join(targetWorkspace, 'vault', 'journal', '2026-04-11.md'), 'utf8')).toBe('today\n');
    expect(fs.readFileSync(path.join(targetWorkspace, 'extra.txt'), 'utf8')).toBe('custom content');
    // And NOT the transient files
    expect(fs.existsSync(path.join(targetWorkspace, 'agent.sqlite-wal'))).toBe(false);
    expect(fs.existsSync(path.join(targetWorkspace, 'agent.sqlite-shm'))).toBe(false);
  });
});
