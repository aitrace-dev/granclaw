import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  fetchAgents, createAgent, deleteAgent, fetchProviderSettings, fetchAppConfig, importAgent,
  type Agent, type ProviderSettings, type AppConfig,
} from '../lib/api.ts';
import { getModelsForProvider, getDefaultModel } from '../lib/models.ts';
import { useT } from '../lib/i18n.tsx';
import {
  buttonPrimary, buttonSecondary, buttonDanger,
  inputCls as baseInputCls, inputMono,
  cardCls, badgeSuccess, badgeNeutral,
} from '../ui/primitives';

function AgentRow({ agent, onDelete }: { agent: Agent; onDelete: () => void }) {
  const navigate = useNavigate();
  const { t } = useT();
  const isActive = agent.status === 'active';
  const isBusy = agent.busy === true;

  return (
    <div
      onClick={() => navigate(`/agents/${agent.id}/chat`)}
      className="group flex items-center gap-4 rounded-xl bg-surface-container-lowest border border-outline-variant/40 p-4 cursor-pointer transition-all hover:border-primary/40 hover:shadow-callout"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-headline text-lg font-bold text-on-surface">{agent.name}</span>
          {isBusy ? (
            <span
              data-testid="busy-badge"
              className="inline-flex items-center gap-1 rounded-full bg-secondary/15 border border-secondary/30 px-2 py-0.5 text-[10px] font-label font-semibold uppercase tracking-wider text-secondary"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-secondary animate-pulse" />
              busy
            </span>
          ) : (
            <span className={isActive ? badgeSuccess : badgeNeutral}>
              {agent.status}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1">
          <span className="font-mono text-[10px] text-primary/70">{agent.model}</span>
          <span className="font-mono text-[10px] text-on-surface-variant/60 hidden sm:inline">id: {agent.id}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="hidden sm:flex flex-wrap gap-1">
          {agent.allowedTools.slice(0, 3).map(t => (
            <span
              key={t}
              className="font-mono text-[9px] text-on-surface-variant bg-surface-container rounded px-1.5 py-0.5"
            >
              {t}
            </span>
          ))}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className={`${buttonDanger} sm:opacity-0 sm:group-hover:opacity-100`}
        >
          {t('dashboard.delete')}
        </button>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { t } = useT();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [providerSettings, setProviderSettings] = useState<ProviderSettings | null>(null);
  const [appConfig, setAppConfig] = useState<AppConfig>({ showWorkspaceDirConfig: true, showBraveSearchConfig: true });
  const [showCreate, setShowCreate] = useState(false);
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [newProvider, setNewProvider] = useState('');
  const [newModel, setNewModel] = useState('');
  const [newWorkspace, setNewWorkspace] = useState('');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      let result;
      try {
        result = await importAgent(file);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('already exists')) {
          const newAgentId = prompt(
            `${msg}\n\nEnter a new id for the imported agent:`,
            ''
          )?.trim();
          if (!newAgentId) { setImporting(false); return; }
          result = await importAgent(file, { id: newAgentId });
        } else {
          throw err;
        }
      }
      await loadAll();
      navigate(`/agents/${result.id}/chat`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dashboard.importFailed'));
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  }

  const loadAll = () => {
    Promise.all([fetchAgents(), fetchProviderSettings(), fetchAppConfig()])
      .then(([agentList, ps, ac]) => {
        setAgents(agentList);
        setProviderSettings(ps);
        setAppConfig(ac);
        if (!newProvider) {
          const firstProvider = ps.providers?.[0];
          if (firstProvider) {
            setNewProvider(firstProvider.provider);
            setNewModel(firstProvider.model);
          }
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadAll();
    const interval = setInterval(() => {
      fetchAgents().then(setAgents).catch(() => {});
    }, 2_000);
    return () => clearInterval(interval);
  }, []);

  const navigate = useNavigate();
  const configuredProviders = providerSettings?.providers ?? [];
  const providerModels = newProvider ? getModelsForProvider(newProvider) : [];

  function handleProviderChange(p: string) {
    setNewProvider(p);
    setNewModel(getDefaultModel(p));
  }

  async function handleCreate() {
    if (!newId.trim() || !newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const id = newId.trim();
      await createAgent(id, newName.trim(), newModel, newProvider || undefined, newWorkspace.trim() || undefined);
      navigate(`/agents/${id}/chat`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.errorCreate'));
      setCreating(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(t('dashboard.deleteConfirm', { name, id }))) return;
    await deleteAgent(id);
    loadAll();
  }

  if (loading) {
    return (
      <div className="font-mono text-xs text-on-surface-variant p-8">{t('dashboard.loadingAgents')}</div>
    );
  }

  // Fresh install: no provider AND no agents — show full-screen CTA
  if (providerSettings && !providerSettings.configured && agents.length === 0) {
    return (
      <div className="max-w-3xl mx-auto py-16 px-4">
        <div className="text-center">
          <h1 className="font-headline text-4xl font-bold text-on-surface mb-4">
            {t('dashboard.getStartedWith')} <span className="highlight-marker">GranClaw</span>
          </h1>
          <p className="font-mono text-xs text-on-surface-variant mb-8">
            {t('dashboard.configureProviderBlurb')}
          </p>
          <Link to="/settings" className={buttonPrimary}>
            {t('dashboard.configureProvider')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-6 sm:py-8 px-4">
      {/* Provider warning banner */}
      {providerSettings && !providerSettings.configured && (
        <div className="rounded-xl bg-warning/10 border border-warning/30 px-4 py-3 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <p className="font-mono text-[11px] text-warning">
            {t('dashboard.noProviderWarning')}
          </p>
          <Link to="/settings" className="font-label text-[11px] font-semibold uppercase tracking-widest text-primary hover:text-surface-tint flex-shrink-0">
            {t('dashboard.configureArrow')}
          </Link>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6 sm:mb-8">
        <div>
          <h1 className="font-headline text-3xl sm:text-4xl font-bold text-on-surface">{t('dashboard.title')}</h1>
          <p className="font-mono text-[11px] text-on-surface-variant mt-1">
            {t(agents.length === 1 ? 'dashboard.agentsCountOne' : 'dashboard.agentsCountOther', { count: agents.length })}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <input
            ref={importInputRef}
            type="file"
            accept=".zip,application/zip"
            onChange={handleImport}
            className="hidden"
          />
          <button
            onClick={() => importInputRef.current?.click()}
            disabled={importing || !providerSettings?.configured}
            className={buttonSecondary}
            title={t('dashboard.importTitle')}
          >
            {importing ? t('dashboard.importing') : t('dashboard.import')}
          </button>
          <button
            onClick={() => setShowCreate(s => !s)}
            disabled={!providerSettings?.configured}
            className={buttonPrimary}
          >
            {showCreate ? t('dashboard.cancel') : t('dashboard.newAgent')}
          </button>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className={`${cardCls} p-5 mb-6 space-y-3`}>
          <p className="font-label text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant">
            {t('dashboard.createNewAgent')}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              className={inputMono}
              placeholder={t('dashboard.agentIdPlaceholder')}
              value={newId}
              onChange={e => setNewId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            />
            <input
              className={baseInputCls}
              placeholder={t('dashboard.displayNamePlaceholder')}
              value={newName}
              onChange={e => setNewName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <select
              className={`${baseInputCls} appearance-none`}
              value={newProvider}
              onChange={e => handleProviderChange(e.target.value)}
            >
              {configuredProviders.map(p => (
                <option key={p.provider} value={p.provider}>{p.label ?? p.provider}</option>
              ))}
            </select>
            <select
              className={`${baseInputCls} appearance-none`}
              value={newModel}
              onChange={e => setNewModel(e.target.value)}
            >
              {providerModels.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          {appConfig.showWorkspaceDirConfig && (
            <input
              className={inputMono}
              placeholder={t('dashboard.workspacePlaceholder', { id: newId || t('dashboard.workspacePlaceholderDefault') })}
              value={newWorkspace}
              onChange={e => setNewWorkspace(e.target.value)}
            />
          )}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleCreate}
              disabled={creating || !newId.trim() || !newName.trim() || !newModel}
              className={buttonPrimary}
            >
              {creating ? t('dashboard.creating') : t('dashboard.create')}
            </button>
            {error && <span className="font-mono text-[10px] text-error">{error}</span>}
          </div>
        </div>
      )}

      {/* Agent list */}
      <div className="space-y-3">
        {agents.length === 0 ? (
          <div className="text-center py-16">
            <span className="text-3xl opacity-30">🤖</span>
            <p className="font-mono text-[11px] text-on-surface-variant mt-3">
              {t('dashboard.noAgents')}
            </p>
          </div>
        ) : (
          agents.map(a => (
            <AgentRow key={a.id} agent={a} onDelete={() => handleDelete(a.id, a.name)} />
          ))
        )}
      </div>
    </div>
  );
}
