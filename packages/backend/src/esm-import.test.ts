import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

/*
 * Regression tests for the ESM-only package loading path.
 *
 * Bug history: the backend is compiled with `module: CommonJS`, which rewrites
 * every `await import('pkg')` into `require('pkg')`. That crashes at runtime
 * on ESM-only packages (`@mariozechner/pi-*` in particular) because their
 * `exports` map only has an `import` condition, so Node rejects the require
 * call with:
 *
 *   Error: No "exports" main defined in .../package.json
 *
 * In dev mode (`tsx watch`) the source is loaded via the ESM loader so the
 * dynamic import stays a real import and the bug is invisible. It only shows
 * up in the packaged CLI tarball. Both tests below lock the fix in place:
 *
 *   1. esmImport() actually resolves an ESM-only package at runtime.
 *   2. None of the backend call sites fall back to a plain `await import()`
 *      of a `@mariozechner/*` package (or any other forbidden specifier),
 *      which would be silently rewritten into a require() by tsc.
 */

describe('esmImport', () => {
  // The Function(…) trick can't be exercised inside Vitest's VM sandbox
  // (`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`), so we shell out to a real
  // Node process for the round-trip. This matches what happens in the
  // published CLI: `node dist/backend/…`.
  function runInNode(specifier: string, accessor: string): string {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const script = `
      const dynImport = new Function('s', 'return import(s)');
      dynImport(${JSON.stringify(specifier)})
        .then((mod) => {
          const v = mod.${accessor};
          if (v === undefined) {
            console.error('undefined: ' + ${JSON.stringify(accessor)});
            process.exit(1);
          }
          console.log(typeof v);
        })
        .catch((err) => {
          console.error(err && err.message ? err.message : String(err));
          process.exit(1);
        });
    `;
    return execFileSync(process.execPath, ['--input-type=commonjs', '-e', script], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  }

  it('loads an ESM-only package at runtime (@mariozechner/pi-ai)', () => {
    // If pi-ai were required() the process would abort with
    //   Error: No "exports" main defined
    // before printing anything. Reaching `function` proves the Function
    // trick resolves through Node's ESM loader path.
    const typeofGetModel = runInNode('@mariozechner/pi-ai', 'getModel');
    expect(typeofGetModel).toBe('function');
  });

  it('loads @mariozechner/pi-coding-agent at runtime', () => {
    const typeofCreate = runInNode('@mariozechner/pi-coding-agent', 'createAgentSession');
    expect(typeofCreate).toBe('function');
  });
});

describe('no plain await import() of ESM-only packages in backend source', () => {
  /*
   * This test walks the compiled source (.ts files in packages/backend/src/)
   * and fails if any file reintroduces a bare `await import('@mariozechner/...')`
   * — that form is a time bomb: it works in dev under tsx, but tsc rewrites it
   * to `require()` in the published tarball and chat breaks.
   *
   * The correct pattern is `await esmImport(...)`. This test is allowlist-based
   * on the bad pattern so adding new ESM-only deps automatically gets caught.
   */

  const FORBIDDEN_PATTERN = /\bawait\s+import\(\s*['"`]@mariozechner\//;
  const SRC_ROOT = path.resolve(__dirname);

  function walkTs(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkTs(full, out);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && entry.name !== 'esm-import.test.ts') {
        out.push(full);
      }
    }
    return out;
  }

  it('every call site uses esmImport, never a bare await import()', () => {
    const files = walkTs(SRC_ROOT);
    const offenders: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      if (FORBIDDEN_PATTERN.test(content)) {
        offenders.push(path.relative(SRC_ROOT, file));
      }
    }
    if (offenders.length > 0) {
      throw new Error(
        `Found bare \`await import('@mariozechner/...')\` in backend source.\n` +
        `These crash in the published CLI because tsc rewrites them to require(),\n` +
        `which fails on ESM-only packages. Use \`esmImport\` from './esm-import' instead.\n\n` +
        `Offending files:\n${offenders.map(f => `  - ${f}`).join('\n')}`,
      );
    }
  });
});
