import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  fetchAgents, createAgent, deleteAgent, fetchProviderSettings, importAgent,
  type Agent, type ProviderSettings,
} from '../lib/api.ts';
import { getModelsForProvider, getDefaultModel } from '../lib/models.ts';
import {
  buttonPrimary, buttonSecondary, buttonDanger,
  inputCls as baseInputCls, inputMono,
  cardCls, badgeSuccess, badgeNeutral,
} from '../ui/primitives';

function AgentRow({ agent, onDelete }: { agent: Agent; onDelete: () => void }) {
  const navigate = useNavigate();
  const isActive = agent.status === 'active';

  return (
    <div
      onClick={() => navigate(`/agents/${agent.id}/chat`)}
      className="group flex items-center gap-4 rounded-xl bg-surface-container-lowest border border-outline-variant/40 p-4 cursor-pointer transition-all hover:border-primary/40 hover:shadow-callout"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-headline text-lg font-bold text-on-surface">{agent.name}</span>
          <span className={isActive ? badgeSuccess : badgeNeutral}>
            {agent.status}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-1">
          <span className="font-mono text-[10px] text-primary/70">{agent.model}</span>
          <span className="font-mono text-[10px] text-on-surface-variant/60">id: {agent.id}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex flex-wrap gap-1">
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
          className={`${buttonDanger} opacity-0 group-hover:opacity-100`}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [providerSettings, setProviderSettings] = useState<ProviderSettings | null>(null);
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
        // If the agent id collides, prompt for a new one and retry
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('already exists')) {
          const newId = prompt(
            `${msg}\n\nEnter a new id for the imported agent:`,
            ''
          )?.trim();
          if (!newId) { setImporting(false); return; }
          result = await importAgent(file, { id: newId });
        } else {
          throw err;
        }
      }
      await loadAll();
      navigate(`/agents/${result.id}/chat`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  }

  const loadAll = () => {
    Promise.all([fetchAgents(), fetchProviderSettings()])
      .then(([agentList, ps]) => {
        setAgents(agentList);
        setProviderSettings(ps);
        const firstProvider = ps.providers?.[0];
        if (firstProvider) {
          setNewProvider(firstProvider.provider);
          setNewModel(firstProvider.model);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadAll(); }, []);

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
      setError(err instanceof Error ? err.message : 'Failed to create');
      setCreating(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete agent "${name}" (${id})?\n\nThis will stop the agent and permanently delete its workspace, including all files, vault data, and conversation history.\n\nThis cannot be undone.`)) return;
    await deleteAgent(id);
    loadAll();
  }

  if (loading) {
    return (
      <div className="font-mono text-xs text-on-surface-variant p-8">
        loading agents…
      </div>
    );
  }

  // Full-screen CTA only for truly fresh installs: no provider AND no agents
  if (!loading && providerSettings && !providerSettings.configured && agents.length === 0) {
    return (
      <div className="max-w-3xl mx-auto py-16 px-4">
        <div className="text-center">
          <h1 className="font-headline text-4xl font-bold text-on-surface mb-4">
            Get started with <span className="highlight-marker">GranClaw</span>
          </h1>
          <p className="font-mono text-xs text-on-surface-variant mb-8">
            Configure a provider and API key before creating agents.
          </p>
          <Link to="/settings" className={buttonPrimary}>
            Configure provider
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      {/* Provider warning banner (shown when agents exist but provider not configured) */}
      {providerSettings && !providerSettings.configured && (
        <div className="rounded-xl bg-warning/10 border border-warning/30 px-4 py-3 mb-6 flex items-center justify-between">
          <p className="font-mono text-[11px] text-warning">
            No provider configured — agents cannot run until you set one up.
          </p>
          <Link to="/settings" className="font-label text-[11px] font-semibold uppercase tracking-widest text-primary hover:text-surface-tint">
            Configure →
          </Link>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-headline text-4xl font-bold text-on-surface">Agents</h1>
          <p className="font-mono text-[11px] text-on-surface-variant mt-1">
            {agents.length} agent{agents.length !== 1 ? 's' : ''} configured
          </p>
        </div>
        <div className="flex items-center gap-2">
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
            title="Import an agent from a granclaw export zip"
          >
            {importing ? 'Importing…' : '↥ Import'}
          </button>
          <button
            onClick={() => setShowCreate(s => !s)}
            disabled={!providerSettings?.configured}
            className={buttonPrimary}
          >
            {showCreate ? 'Cancel' : '+ New Agent'}
          </button>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className={`${cardCls} p-5 mb-6 space-y-3`}>
          <p className="font-label text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant">
            Create new agent
          </p>
          <div className="grid grid-cols-2 gap-2">
            <input
              className={inputMono}
              placeholder="agent-id (lowercase, no spaces)"
              value={newId}
              onChange={e => setNewId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            />
            <input
              className={baseInputCls}
              placeholder="Display name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select
              className={`${baseInputCls} appearance-none`}
              value={newProvider}
              onChange={e => handleProviderChange(e.target.value)}
            >
              {configuredProviders.map(p => (
                <option key={p.provider} value={p.provider}>{p.provider}</option>
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
          <input
            className={inputMono}
            placeholder={`Workspace path (optional, defaults to ./workspaces/${newId || 'agent-id'})`}
            value={newWorkspace}
            onChange={e => setNewWorkspace(e.target.value)}
          />
          <div className="flex items-center gap-3">
            <button
              onClick={handleCreate}
              disabled={creating || !newId.trim() || !newName.trim() || !newModel}
              className={buttonPrimary}
            >
              {creating ? 'Creating…' : 'Create'}
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
              No agents yet. Create one to get started.
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
