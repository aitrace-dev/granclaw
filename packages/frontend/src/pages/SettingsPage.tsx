// packages/frontend/src/pages/SettingsPage.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  fetchProviderSettings,
  saveProviderSettings,
  removeProviderSettings,
  fetchSearchSettings,
  saveSearchSettings,
  clearSearchSettings,
  type ProviderEntry,
} from '../lib/api.ts';
import { PROVIDERS, getModelsForProvider, getDefaultModel } from '../lib/models.ts';

// ── Helpers ────────────────────────────────────────────────────────────────────

const inputCls = 'rounded bg-surface-container px-3 py-2 text-[12px] text-on-surface placeholder:text-on-surface-variant/60 outline-none focus:ring-1 focus:ring-primary/25 font-mono transition-shadow w-full';

const PROVIDER_LABELS: Record<string, string> = Object.fromEntries(
  PROVIDERS.map(p => [p.value, p.label])
);

// ── ManagedProviderRow ────────────────────────────────────────────────────────

function ManagedProviderRow({ entry }: { entry: ProviderEntry }) {
  return (
    <div className="rounded-lg bg-surface-container-lowest border border-outline-variant/40 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[13px] text-on-surface font-semibold">
            {entry.label ?? entry.provider}
          </span>
          <span className="font-mono text-[10px] text-on-surface-variant/70">
            {entry.model}
          </span>
          <span className="text-success text-[10px] font-mono">✓</span>
        </div>
        <span className="rounded px-2 py-0.5 text-[10px] font-mono bg-primary/10 text-primary">
          managed
        </span>
      </div>
      <p className="font-mono text-[10px] text-on-surface-variant/60 mt-2">
        Pre-configured · includes free credits · read-only
      </p>
    </div>
  );
}

// ── ConfiguredProviderRow ──────────────────────────────────────────────────────

function ConfiguredProviderRow({
  entry,
  onRemove,
  onReplaceKey,
}: {
  entry: ProviderEntry;
  onRemove: () => void;
  onReplaceKey: (provider: string, model: string, apiKey: string) => Promise<void>;
}) {
  const [replacing, setReplacing] = useState(false);
  const [model, setModel] = useState(entry.model);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSave() {
    if (!apiKey.trim()) { setError('API key is required'); return; }
    setSaving(true); setError(null); setSuccess(false);
    try {
      await onReplaceKey(entry.provider, model, apiKey.trim());
      setSuccess(true);
      setApiKey('');
      setReplacing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg bg-surface-container-lowest border border-outline-variant/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-mono text-[13px] text-on-surface font-semibold">
            {PROVIDER_LABELS[entry.provider] ?? entry.provider}
          </span>
          <span className="font-mono text-[10px] text-on-surface-variant/70 ml-2">
            {entry.model}
          </span>
          <span className="ml-2 text-success text-[10px] font-mono">✓</span>
        </div>
        <div className="flex items-center gap-2">
          {!replacing && (
            <button
              onClick={() => { setReplacing(true); setSuccess(false); }}
              className="rounded px-2 py-1 text-[11px] font-mono text-on-surface-variant hover:text-on-surface bg-surface-container transition-colors"
            >
              Replace key
            </button>
          )}
          <button
            onClick={onRemove}
            className="rounded px-2 py-1 text-[11px] font-mono text-error/60 hover:text-error hover:bg-error/10 transition-colors"
          >
            Remove
          </button>
        </div>
      </div>

      {replacing && (
        <div className="space-y-2 pt-1 border-t border-outline-variant/40">
          <div>
            <label className="block text-[10px] uppercase tracking-[0.14em] text-on-surface-variant font-medium mb-1">
              Model
            </label>
            <select
              className={`${inputCls} appearance-none`}
              value={model}
              onChange={e => setModel(e.target.value)}
            >
              {getModelsForProvider(entry.provider).map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-[0.14em] text-on-surface-variant font-medium mb-1">
              New API Key
            </label>
            <input
              type="password"
              className={inputCls}
              placeholder="Paste new API key"
              value={apiKey}
              onChange={e => { setApiKey(e.target.value); setError(null); }}
              autoComplete="off"
              autoFocus
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded bg-primary px-3 py-1.5 text-[12px] font-medium text-on-primary transition-opacity disabled:opacity-40 hover:opacity-90"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => { setReplacing(false); setApiKey(''); setError(null); }}
              className="rounded px-3 py-1.5 text-[12px] font-mono text-on-surface-variant hover:text-on-surface transition-colors"
            >
              Cancel
            </button>
            {success && <span className="font-mono text-[11px] text-success">Saved</span>}
            {error && <span className="font-mono text-[10px] text-error">{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── SettingsPage ───────────────────────────────────────────────────────────────

export function SettingsPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [configuredProviders, setConfiguredProviders] = useState<ProviderEntry[]>([]);

  // Add-provider form
  const [addProvider, setAddProvider] = useState('');
  const [addModel, setAddModel] = useState('');
  const [addApiKey, setAddApiKey] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState(false);

  // Brave Search
  const [braveApiKey, setBraveApiKey] = useState('');
  const [searchSaving, setSearchSaving] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchSuccess, setSearchSuccess] = useState(false);
  const [searchConfigured, setSearchConfigured] = useState(false);
  const [replacingSearch, setReplacingSearch] = useState(false);

  useEffect(() => {
    Promise.all([fetchProviderSettings(), fetchSearchSettings()])
      .then(([ps, ss]) => {
        setConfiguredProviders(ps.providers ?? []);
        setSearchConfigured(ss.configured);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Split into managed (read-only) and user (editable) providers
  const managedProviders = configuredProviders.filter(p => p.managed);
  const userProviders = configuredProviders.filter(p => !p.managed);

  // Only user-configured providers occupy a "slot" that blocks the Add form
  const configuredIds = new Set(userProviders.map(p => p.provider));
  const managedIds = new Set(managedProviders.map(p => p.provider));
  const availableToAdd = PROVIDERS.filter(
    p => !configuredIds.has(p.value) && !managedIds.has(p.value)
  );

  // Reset add-form provider/model when available list changes
  useEffect(() => {
    if (availableToAdd.length > 0 && !availableToAdd.find(p => p.value === addProvider)) {
      const first = availableToAdd[0].value;
      setAddProvider(first);
      setAddModel(getDefaultModel(first));
    }
  }, [configuredProviders.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleAddProviderChange(p: string) {
    setAddProvider(p);
    setAddModel(getDefaultModel(p));
  }

  async function handleAdd() {
    if (!addProvider || !addModel || !addApiKey.trim()) { setAddError('All fields required'); return; }
    setAdding(true); setAddError(null); setAddSuccess(false);
    try {
      await saveProviderSettings(addProvider, addModel, addApiKey.trim());
      setConfiguredProviders(prev => {
        const without = prev.filter(p => p.provider !== addProvider);
        return [...without, { provider: addProvider, model: addModel }];
      });
      setAddSuccess(true);
      setAddApiKey('');
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setAdding(false);
    }
  }

  async function handleReplaceKey(provider: string, model: string, apiKey: string) {
    await saveProviderSettings(provider, model, apiKey);
    setConfiguredProviders(prev =>
      prev.map(p => p.provider === provider && !p.managed ? { provider, model } : p)
    );
  }

  async function handleRemove(provider: string) {
    if (!confirm(`Remove ${PROVIDER_LABELS[provider] ?? provider}? Agents using this provider will stop responding.`)) return;
    await removeProviderSettings(provider);
    setConfiguredProviders(prev => prev.filter(p => p.provider !== provider));
  }

  async function handleSearchSave() {
    if (!braveApiKey.trim()) { setSearchError('API key is required'); return; }
    setSearchSaving(true); setSearchError(null); setSearchSuccess(false);
    try {
      await saveSearchSettings('brave', braveApiKey.trim());
      setSearchSuccess(true);
      setSearchConfigured(true);
      setBraveApiKey('');
      setReplacingSearch(false);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSearchSaving(false);
    }
  }

  async function handleSearchReset() {
    setSearchSaving(true); setSearchError(null);
    try {
      await clearSearchSettings();
      setSearchConfigured(false);
      setBraveApiKey('');
      setSearchSuccess(false);
      setReplacingSearch(false);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Failed to reset');
    } finally {
      setSearchSaving(false);
    }
  }

  if (loading) return <div className="text-on-surface-variant/70 font-mono text-xs p-8">loading…</div>;

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">

      {/* ── Back button ── */}
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 mb-6 font-mono text-[12px] text-on-surface-variant hover:text-on-surface transition-colors"
      >
        <span className="material-symbols-outlined text-[16px]">arrow_back</span>
        Go back to agent
      </button>

      {/* ── Provider Settings ── */}
      <div className="mb-8">
        <h1 className="font-headline text-4xl font-bold text-on-surface">
          <span className="highlight-marker">Provider</span> Settings
        </h1>
        <p className="font-mono text-[11px] text-on-surface-variant mt-2">
          Configure AI providers. Each agent can use a different provider.
        </p>
      </div>

      {/* Managed providers (read-only, always shown first) */}
      {managedProviders.length > 0 && (
        <div className="space-y-2 mb-4">
          {managedProviders.map(entry => (
            <ManagedProviderRow key={`managed-${entry.provider}`} entry={entry} />
          ))}
        </div>
      )}

      {/* User-configured providers */}
      {userProviders.length === 0 && managedProviders.length === 0 ? (
        <p className="font-mono text-[11px] text-warning/80 mb-4">
          No providers configured — agents will not respond until you add one.
        </p>
      ) : userProviders.length > 0 ? (
        <div className="space-y-2 mb-6">
          {userProviders.map(entry => (
            <ConfiguredProviderRow
              key={entry.provider}
              entry={entry}
              onRemove={() => handleRemove(entry.provider)}
              onReplaceKey={handleReplaceKey}
            />
          ))}
        </div>
      ) : null}

      {/* Add provider form */}
      {availableToAdd.length > 0 && (
        <div className="rounded-lg bg-surface-container-lowest border border-outline-variant/40 p-5 space-y-4">
          <p className="text-[10px] uppercase tracking-[0.14em] text-on-surface-variant font-medium">
            Add provider
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-[0.14em] text-on-surface-variant font-medium mb-1.5">
                Provider
              </label>
              <select
                className={`${inputCls} appearance-none`}
                value={addProvider}
                onChange={e => handleAddProviderChange(e.target.value)}
              >
                {availableToAdd.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-[0.14em] text-on-surface-variant font-medium mb-1.5">
                Model
              </label>
              <select
                className={`${inputCls} appearance-none`}
                value={addModel}
                onChange={e => setAddModel(e.target.value)}
              >
                {getModelsForProvider(addProvider).map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-[0.14em] text-on-surface-variant font-medium mb-1.5">
              API Key
            </label>
            <input
              type="password"
              className={inputCls}
              placeholder="Paste your API key"
              value={addApiKey}
              onChange={e => { setAddApiKey(e.target.value); setAddError(null); setAddSuccess(false); }}
              autoComplete="off"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleAdd}
              disabled={adding || !addApiKey.trim()}
              className="rounded bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity disabled:opacity-40 hover:opacity-90"
            >
              {adding ? 'Adding…' : 'Add'}
            </button>
            {addSuccess && <span className="font-mono text-[11px] text-success">Added ✓</span>}
            {addError && <span className="font-mono text-[10px] text-error">{addError}</span>}
          </div>
        </div>
      )}

      {/* ── Web Search ── */}
      <div className="mt-8 pt-8 border-t border-outline-variant/40">
        <h2 className="font-headline text-2xl font-bold text-on-surface mb-1">Web Search</h2>
        <p className="font-mono text-[11px] text-on-surface-variant/70 mb-6">
          Brave Search gives agents real web search capability.{' '}
          {searchConfigured
            ? <span className="text-success">Configured ✓</span>
            : <span className="text-warning">Not configured — agents cannot search the web.</span>}
        </p>

        <div className="space-y-4">
          <div>
            <label className="block font-mono text-[11px] text-on-surface-variant mb-1">
              Brave Search API key
            </label>
            {searchConfigured && !replacingSearch ? (
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  className={inputCls}
                  value="••••••••••••••••••••"
                  readOnly
                />
                <button
                  type="button"
                  onClick={() => { setReplacingSearch(true); setSearchSuccess(false); }}
                  className="shrink-0 rounded px-3 py-2 text-[11px] font-mono text-on-surface-variant hover:text-on-surface bg-surface-container transition-colors"
                >
                  Replace
                </button>
              </div>
            ) : (
              <input
                type="password"
                className={inputCls}
                placeholder="Enter Brave Search API key"
                value={braveApiKey}
                onChange={e => { setBraveApiKey(e.target.value); setSearchSuccess(false); }}
                autoComplete="off"
                autoFocus={replacingSearch}
              />
            )}
          </div>

          <div className="flex items-center gap-3">
            {(!searchConfigured || replacingSearch) && (
              <button
                onClick={handleSearchSave}
                disabled={searchSaving || !braveApiKey.trim()}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {searchSaving ? 'Saving…' : 'Save'}
              </button>
            )}
            {replacingSearch && (
              <button
                onClick={() => { setReplacingSearch(false); setBraveApiKey(''); setSearchError(null); }}
                className="rounded px-3 py-1.5 text-[12px] font-mono text-on-surface-variant hover:text-on-surface transition-colors"
              >
                Cancel
              </button>
            )}
            {searchConfigured && (
              <button
                onClick={handleSearchReset}
                disabled={searchSaving}
                className="rounded px-3 py-2 text-[12px] font-mono text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors disabled:opacity-40"
              >
                Remove
              </button>
            )}
            {searchSuccess && <span className="font-mono text-[11px] text-success">Saved</span>}
            {searchError && <span className="font-mono text-[10px] text-error">{searchError}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
