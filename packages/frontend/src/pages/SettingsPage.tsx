// packages/frontend/src/pages/SettingsPage.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchProviderSettings,
  saveProviderSettings,
  clearProviderSettings,
} from '../lib/api.ts';
import { PROVIDERS, getModelsForProvider, getDefaultModel } from '../lib/models.ts';

export function SettingsPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [provider, setProvider] = useState('google');
  const [model, setModel] = useState(getDefaultModel('google'));
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProviderSettings()
      .then(s => {
        setConfigured(s.configured);
        if (s.provider) setProvider(s.provider);
        if (s.model) setModel(s.model);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  function handleProviderChange(p: string) {
    setProvider(p);
    setModel(getDefaultModel(p));
  }

  async function handleSave() {
    if (!apiKey.trim()) { setError('API key is required'); return; }
    setSaving(true);
    setError(null);
    try {
      await saveProviderSettings(provider, model, apiKey.trim());
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!confirm('Remove provider configuration? Agents will stop responding until you reconfigure.')) return;
    await clearProviderSettings();
    navigate('/');
  }

  const inputCls = 'rounded bg-[#33343b] px-3 py-2 text-[12px] text-on-surface placeholder:text-on-surface-variant/30 outline-none focus:ring-1 focus:ring-primary/25 font-mono transition-shadow w-full';

  if (loading) return <div className="text-on-surface-variant/40 font-mono text-xs p-8">loading…</div>;

  return (
    <div className="max-w-lg mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-semibold text-on-surface">Provider Settings</h1>
        <p className="font-mono text-[11px] text-on-surface-variant/40 mt-1">
          Configure the AI provider and API key used by all agents.
        </p>
      </div>

      <div className="rounded-lg bg-[#1e1f26] p-5 space-y-4">
        <div>
          <label className="block text-[10px] uppercase tracking-[0.14em] text-on-surface-variant/50 font-medium mb-1.5">
            Provider
          </label>
          <select
            className={`${inputCls} appearance-none`}
            value={provider}
            onChange={e => handleProviderChange(e.target.value)}
          >
            {PROVIDERS.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-[0.14em] text-on-surface-variant/50 font-medium mb-1.5">
            Model
          </label>
          <select
            className={`${inputCls} appearance-none`}
            value={model}
            onChange={e => setModel(e.target.value)}
          >
            {getModelsForProvider(provider).map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-[0.14em] text-on-surface-variant/50 font-medium mb-1.5">
            API Key
          </label>
          <input
            type="password"
            className={inputCls}
            placeholder="Paste your API key here — never stored in plaintext on client"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            autoComplete="off"
          />
          <p className="font-mono text-[9px] text-on-surface-variant/30 mt-1">
            The key is stored server-side only and never returned to the browser.
          </p>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded bg-primary-container px-4 py-2 text-sm font-medium text-[#3c0091] transition-opacity disabled:opacity-40 hover:opacity-90"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {configured && (
            <button
              onClick={handleRemove}
              className="rounded px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-950/20 transition-colors"
            >
              Remove configuration
            </button>
          )}
          {error && <span className="font-mono text-[10px] text-red-400">{error}</span>}
        </div>
      </div>
    </div>
  );
}
