/**
 * Real ESM dynamic import that survives tsc's CommonJS transpilation.
 *
 * The backend compiles with `module: CommonJS`, which rewrites every
 * `await import('pkg')` into `require('pkg')`. That crashes on ESM-only
 * packages (e.g. `@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`)
 * whose `exports` map only exposes an `import` condition — Node refuses
 * to satisfy a `require()` call and throws:
 *
 *   Error: No "exports" main defined in .../package.json
 *
 * Hiding the `import()` call inside a `new Function(...)` body keeps it
 * out of tsc's AST, so the runtime actually executes a real ESM dynamic
 * import and Node's module loader does the right thing.
 *
 * Use this helper for every ESM-only bare specifier. For CommonJS deps
 * and built-ins, the ordinary `await import(...)` is fine.
 */
const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<unknown>;

export function esmImport<T = unknown>(specifier: string): Promise<T> {
  return dynamicImport(specifier) as Promise<T>;
}
