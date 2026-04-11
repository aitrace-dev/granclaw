/**
 * LLM provider setup/teardown for E2E tests.
 *
 * Tests that require a real LLM call should use setupTestProvider() in
 * beforeAll and teardownTestProvider() in afterAll.
 *
 * Reads OPENROUTER_API_KEY from the environment (loaded from .env by
 * Playwright automatically). Throws immediately if the key is missing
 * so the failure is fast and obvious rather than a 2-minute timeout.
 *
 * If the provider was already configured before the test ran, teardown
 * leaves it in place (non-destructive).
 */

const API = 'http://localhost:3001';
const PROVIDER = 'openrouter';
const MODEL = 'deepseek/deepseek-v3.2';

/**
 * Ensures openrouter is configured. Returns true if this call added it
 * (so teardown knows whether to remove it).
 */
export async function setupTestProvider(): Promise<boolean> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY is not set.\n' +
      'Add it to .env at the repo root before running LLM-dependent tests.'
    );
  }

  const res = await fetch(`${API}/settings/provider`);
  const cfg = await res.json() as { providers: Array<{ provider: string }> };
  const alreadyConfigured = cfg.providers.some(p => p.provider === PROVIDER);

  if (!alreadyConfigured) {
    await fetch(`${API}/settings/provider`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: PROVIDER, model: MODEL, apiKey }),
    });
    return true; // we added it — teardown should remove it
  }

  return false; // already there — leave it alone
}

/**
 * Removes the openrouter provider only if setupTestProvider() added it.
 * Pass the return value of setupTestProvider() as `weAdded`.
 */
export async function teardownTestProvider(weAdded: boolean): Promise<void> {
  if (weAdded) {
    await fetch(`${API}/settings/providers/${PROVIDER}`, { method: 'DELETE' });
  }
}
