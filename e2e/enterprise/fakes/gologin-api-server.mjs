/**
 * Fake GoLogin cloud API — the subset the extension uses:
 *
 *   POST /browser/quick            → create profile, return { id, name }
 *   POST /browser/:id/cookies      → store cookies for profile
 *   GET  /browser/:id/cookies      → list cookies for profile
 *   GET  /__state                  → test-only inspection endpoint
 *
 * Accepts any Bearer token. Persists in memory — wiped on restart.
 * Started as a long-running webServer by the enterprise Playwright config
 * and pointed at via GOLOGIN_API_BASE in the backend env.
 */
import express from 'express';

const app = express();
app.use(express.json({ limit: '20mb' }));

const profiles = new Map();

app.post('/browser/quick', (req, res) => {
  const id = `mock-profile-${profiles.size + 1}`;
  const name = req.body?.name ?? '';
  profiles.set(id, { id, name, cookies: [] });
  res.json({ id, name });
});

app.post('/browser/:id/cookies', (req, res) => {
  const p = profiles.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'no such profile' });
  // Accepts either a raw array or { cookies: [...] }.
  p.cookies = Array.isArray(req.body) ? req.body : (req.body?.cookies ?? []);
  res.json({ ok: true, stored: p.cookies.length });
});

app.get('/browser/:id/cookies', (req, res) => {
  const p = profiles.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'no such profile' });
  res.json(p.cookies);
});

app.get('/__state', (_req, res) => {
  res.json({ profiles: Array.from(profiles.values()) });
});

// Tests clear state between runs via DELETE /__state.
app.delete('/__state', (_req, res) => {
  profiles.clear();
  res.json({ cleared: true });
});

app.get('/__healthz', (_req, res) => res.json({ ok: true }));

const PORT = Number(process.env.GOLOGIN_MOCK_PORT ?? 4567);
app.listen(PORT, () => {
  console.log(`[fake-gologin-api] listening on :${PORT}`);
});
