/**
 * pi-resource-loader-bootstrap.test.ts
 *
 * End-to-end sanity check that the pi-coding-agent `DefaultResourceLoader`
 * actually constructs and can `reload()` with the exact option shapes
 * runner-pi passes it. Exists because 0.65 → 0.68 silently rewrote the
 * option types (agentDir required, appendSystemPrompt turned from string
 * into string[]) and we only discovered each break when real users hit
 * "path must be of type string" / "appendSources.map is not a function"
 * in production.
 *
 * Vitest's VM sandbox doesn't support the `new Function('s', 'return
 * import(s)')` trick our backend uses to dodge tsc's CommonJS require
 * rewrite, so we shell out to a real Node process (same pattern as
 * esm-import.test.ts).
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function runBootstrap(options: { includeAppend: boolean }): { ok: true } | { ok: false; error: string } {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-rl-bootstrap-'));
  try {
    const script = `
      const dynImport = new Function('s', 'return import(s)');
      dynImport('@mariozechner/pi-coding-agent')
        .then(async (pi) => {
          const opts = {
            cwd: ${JSON.stringify(workspaceDir)},
            agentDir: pi.getAgentDir(),
            extensionFactories: [],
          };
          ${options.includeAppend ? `opts.appendSystemPrompt = ['# test SYSTEM.md\\n\\nhello'];` : ''}
          const loader = new pi.DefaultResourceLoader(opts);
          await loader.reload();
          console.log('ok');
        })
        .catch((err) => {
          console.error(err && err.message ? err.message : String(err));
          process.exit(1);
        });
    `;
    try {
      const out = execFileSync(process.execPath, ['--input-type=commonjs', '-e', script], {
        cwd: path.resolve(__dirname, '..', '..'),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      return out === 'ok' ? { ok: true } : { ok: false, error: `unexpected stdout: ${out}` };
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr ?? String(err);
      return { ok: false, error: stderr };
    }
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
}

describe('pi DefaultResourceLoader bootstrap (runner-pi call shape)', () => {
  it('constructs + reloads with agentDir and appendSystemPrompt: string[]', () => {
    const result = runBootstrap({ includeAppend: true });
    if (!result.ok) throw new Error(`reload() failed:\n${result.error}`);
    expect(result.ok).toBe(true);
  });

  it('still works with appendSystemPrompt omitted (no SYSTEM.md case)', () => {
    const result = runBootstrap({ includeAppend: false });
    if (!result.ok) throw new Error(`reload() failed:\n${result.error}`);
    expect(result.ok).toBe(true);
  });
});
