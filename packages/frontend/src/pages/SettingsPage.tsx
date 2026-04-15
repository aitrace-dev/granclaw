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
  fetchAppConfig,
  type ProviderEntry,
  type AppConfig,
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
        Preconfigurado · incluye créditos gratuitos · solo lectura
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
    if (!apiKey.trim()) { setError('La clave API es requerida'); return; }
    setSaving(true); setError(null); setSuccess(false);
    try {
      await onReplaceKey(entry.provider, model, apiKey.trim());
      setSuccess(true);
      setApiKey('');
      setReplacing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg bg-surface-container-lowest border border-outline-variant/40 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="font-mono text-[13px] text-on-surface font-semibold">
            {PROVIDER_LABELS[entry.provider] ?? entry.provider}
          </span>
          <span className="font-mono text-[10px] text-on-surface-variant/70 ml-2">
            {entry.model}
          </span>
          <span className="ml-2 text-success text-[10px] font-mono">✓</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!replacing && (
            <button
              onClick={() => { setReplacing(true); setSuccess(false); }}
              className="rounded px-2 py-1 text-[11px] font-mono text-on-surface-variant hover:text-on-surface bg-surface-container transition-colors"
            >
              Reemplazar clave
            </button>
          )}
          <button
            onClick={onRemove}
            className="rounded px-2 py-1 text-[11px] font-mono text-error/60 hover:text-error hover:bg-error/10 transition-colors"
          >
            Eliminar
          </button>
        </div>
      </div>

      {replacing && (
        <div className="space-y-2 pt-1 border-t border-outline-variant/40">
          <div>
            <label className="block text-[10px] uppercase tracking-[0.14em] text-on-surface-variant font-medium mb-1">
              Modelo
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
              Nueva clave API
            </label>
            <input
              type="password"
              className={inputCls}
              placeholder="Pega la nueva clave API"
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
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button
              onClick={() => { setReplacing(false); setApiKey(''); setError(null); }}
              className="rounded px-3 py-1.5 text-[12px] font-mono text-on-surface-variant hover:text-on-surface transition-colors"
            >
              Cancelar
            </button>
            {success && <span className="font-mono text-[11px] text-success">Guardado</span>}
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
  const [appConfig, setAppConfig] = useState<AppConfig>({ showWorkspaceDirConfig: true, showBraveSearchConfig: true });

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
    Promise.all([fetchProviderSettings(), fetchSearchSettings(), fetchAppConfig()])
      .then(([ps, ss, ac]) => {
        setConfiguredProviders(ps.providers ?? []);
        setSearchConfigured(ss.configured);
        setAppConfig(ac);
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
    if (!addProvider || !addModel || !addApiKey.trim()) { setAddError('Todos los campos son requeridos'); return; }
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
      setAddError(err instanceof Error ? err.message : 'Error al guardar');
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
    if (!confirm(`¿Eliminar ${PROVIDER_LABELS[provider] ?? provider}? Los agentes que usan este proveedor dejarán de responder.`)) return;
    await removeProviderSettings(provider);
    setConfiguredProviders(prev => prev.filter(p => p.provider !== provider));
  }

  async function handleSearchSave() {
    if (!braveApiKey.trim()) { setSearchError('La clave API es requerida'); return; }
    setSearchSaving(true); setSearchError(null); setSearchSuccess(false);
    try {
      await saveSearchSettings('brave', braveApiKey.trim());
      setSearchSuccess(true);
      setSearchConfigured(true);
      setBraveApiKey('');
      setReplacingSearch(false);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Error al guardar');
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
      setSearchError(err instanceof Error ? err.message : 'Error al restablecer');
    } finally {
      setSearchSaving(false);
    }
  }

  if (loading) return <div className="text-on-surface-variant/70 font-mono text-xs p-8">cargando…</div>;

  return (
    <div className="max-w-2xl mx-auto py-6 sm:py-8 px-4">

      {/* ── Back button ── */}
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 mb-6 font-mono text-[12px] text-on-surface-variant hover:text-on-surface transition-colors"
      >
        <span className="material-symbols-outlined text-[16px]">arrow_back</span>
        Volver al agente
      </button>

      {/* ── Provider Settings ── */}
      <div className="mb-8">
        <h1 className="font-headline text-4xl font-bold text-on-surface">
          <span className="highlight-marker">Configuración</span> de proveedor
        </h1>
        <p className="font-mono text-[11px] text-on-surface-variant mt-2">
          Configura proveedores de IA. Cada agente puede usar un proveedor diferente.
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
          Sin proveedores configurados — los agentes no responderán hasta que agregues uno.
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
            Agregar proveedor
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-[0.14em] text-on-surface-variant font-medium mb-1.5">
                Proveedor
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
                Modelo
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
              Clave API
            </label>
            <input
              type="password"
              className={inputCls}
              placeholder="Pega tu clave API"
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
              {adding ? 'Agregando…' : 'Agregar'}
            </button>
            {addSuccess && <span className="font-mono text-[11px] text-success">Agregado ✓</span>}
            {addError && <span className="font-mono text-[10px] text-error">{addError}</span>}
          </div>
        </div>
      )}

      {/* ── Web Search ── */}
      <div className="mt-8 pt-8 border-t border-outline-variant/40">
        <h2 className="font-headline text-2xl font-bold text-on-surface mb-1">Búsqueda Web</h2>

        {appConfig.showBraveSearchConfig ? (
          <>
            <p className="font-mono text-[11px] text-on-surface-variant/70 mb-6">
              Brave Search otorga a los agentes capacidad de búsqueda web real.{' '}
              {searchConfigured
                ? <span className="text-success">Configurado ✓</span>
                : <span className="text-warning">Sin configurar — los agentes no pueden buscar en la web.</span>}
            </p>

            <div className="space-y-4">
              <div>
                <label className="block font-mono text-[11px] text-on-surface-variant mb-1">
                  Clave API de Brave Search
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
                      Reemplazar
                    </button>
                  </div>
                ) : (
                  <input
                    type="password"
                    className={inputCls}
                    placeholder="Ingresa la clave API de Brave Search"
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
                    {searchSaving ? 'Guardando…' : 'Guardar'}
                  </button>
                )}
                {replacingSearch && (
                  <button
                    onClick={() => { setReplacingSearch(false); setBraveApiKey(''); setSearchError(null); }}
                    className="rounded px-3 py-1.5 text-[12px] font-mono text-on-surface-variant hover:text-on-surface transition-colors"
                  >
                    Cancelar
                  </button>
                )}
                {searchConfigured && (
                  <button
                    onClick={handleSearchReset}
                    disabled={searchSaving}
                    className="rounded px-3 py-2 text-[12px] font-mono text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors disabled:opacity-40"
                  >
                    Eliminar
                  </button>
                )}
                {searchSuccess && <span className="font-mono text-[11px] text-success">Guardado</span>}
                {searchError && <span className="font-mono text-[10px] text-error">{searchError}</span>}
              </div>
            </div>
          </>
        ) : (
          <p className="font-mono text-[11px] text-on-surface-variant/70 mt-2">
            La búsqueda web está preconfigurada para este espacio de trabajo.{' '}
            <span className="text-success">Activo ✓</span>
          </p>
        )}
      </div>
    </div>
  );
}
