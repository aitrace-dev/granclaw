import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  fetchAgents, createAgent, deleteAgent, fetchProviderSettings,
  type Agent, type ProviderSettings,
} from '../lib/api.ts';
import { getModelsForProvider } from '../lib/models.ts';

function AgentRow({ agent, onDelete }: { agent: Agent; onDelete: () => void }) {
  const navigate = useNavigate();
  const isActive = agent.status === 'active';

  return (
    <div
      onClick={() => navigate(`/agents/${agent.id}/chat`)}
      className="flex items-center gap-4 rounded-lg bg-[#1e1f26] p-4 cursor-pointer transition-all hover:bg-[#252630] group"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-display text-[15px] font-semibold text-on-surface">{agent.name}</span>
          <span
            className={`rounded-full px-1.5 py-[2px] text-[8px] font-semibold uppercase tracking-[0.1em] ${
              isActive ? 'bg-secondary-container text-[#002113]' : 'bg-[#33343b] text-on-surface-variant/60'
            }`}
          >
            {agent.status}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-1">
          <span className="font-mono text-[10px] text-primary/50">{agent.model}</span>
          <span className="font-mono text-[10px] text-on-surface-variant/30">id: {agent.id}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {agent.allowedTools.slice(0, 3).map(t => (
            <span key={t} className="font-mono text-[9px] text-on-surface-variant/30 bg-[#33343b] rounded px-1.5 py-0.5">{t}</span>
          ))}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="text-[10px] px-2 py-1 rounded text-transparent group-hover:text-on-surface-variant/30 hover:!text-red-400 hover:!bg-red-950/20 transition-colors"
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
  const [newModel, setNewModel] = useState('');
  const [newWorkspace, setNewWorkspace] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAll = () => {
    Promise.all([fetchAgents(), fetchProviderSettings()])
      .then(([agentList, ps]) => {
        setAgents(agentList);
        setProviderSettings(ps);
        const models = ps.provider ? getModelsForProvider(ps.provider) : [];
        if (models.length > 0) setNewModel(models[0].value);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadAll(); }, []);

  const navigate = useNavigate();
  const providerModels = providerSettings?.provider
    ? getModelsForProvider(providerSettings.provider)
    : [];

  async function handleCreate() {
    if (!newId.trim() || !newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const id = newId.trim();
      await createAgent(id, newName.trim(), newModel, newWorkspace.trim() || undefined);
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

  const inputCls = 'rounded bg-[#33343b] px-3 py-2 text-[12px] text-on-surface placeholder:text-on-surface-variant/30 outline-none focus:ring-1 focus:ring-primary/25 font-mono transition-shadow';

  if (loading) return <div className="text-on-surface-variant/40 font-mono text-xs p-8">loading agents…</div>;

  if (!loading && providerSettings && !providerSettings.configured) {
    return (
      <div className="max-w-3xl mx-auto py-8 px-4">
        <div className="text-center py-24">
          <p className="font-display text-2xl font-semibold text-on-surface mb-3">
            Get started with GranClaw
          </p>
          <p className="font-mono text-[12px] text-on-surface-variant/50 mb-8">
            Configure a provider and API key before creating agents.
          </p>
          <Link
            to="/settings"
            className="rounded-lg bg-primary-container px-6 py-3 text-sm font-medium text-[#3c0091] transition-opacity hover:opacity-90"
          >
            Configure provider
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-semibold text-on-surface">Agents</h1>
          <p className="font-mono text-[11px] text-on-surface-variant/40 mt-1">{agents.length} agent{agents.length !== 1 ? 's' : ''} configured</p>
        </div>
        <button
          onClick={() => setShowCreate(s => !s)}
          className="rounded-lg bg-primary-container px-4 py-2 text-sm font-medium text-[#3c0091] transition-opacity hover:opacity-90"
        >
          {showCreate ? 'Cancel' : '+ New Agent'}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="rounded-lg bg-[#1e1f26] p-4 mb-4 space-y-3">
          <p className="text-[10px] uppercase tracking-[0.14em] text-on-surface-variant/50 font-medium">Create new agent</p>
          <div className="grid grid-cols-3 gap-2">
            <input
              className={inputCls}
              placeholder="agent-id (lowercase, no spaces)"
              value={newId}
              onChange={e => setNewId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
            />
            <input
              className={inputCls}
              placeholder="Display name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
            />
            <select
              className={`${inputCls} appearance-none`}
              value={newModel}
              onChange={e => setNewModel(e.target.value)}
            >
              {providerModels.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <input
            className={inputCls + ' w-full'}
            placeholder={`Workspace path (optional, defaults to ./workspaces/${newId || 'agent-id'})`}
            value={newWorkspace}
            onChange={e => setNewWorkspace(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleCreate}
              disabled={creating || !newId.trim() || !newName.trim()}
              className="rounded bg-primary-container px-4 py-2 text-sm font-medium text-[#3c0091] transition-opacity disabled:opacity-40 hover:opacity-90"
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
            {error && <span className="font-mono text-[10px] text-red-400">{error}</span>}
          </div>
        </div>
      )}

      {/* Agent list */}
      <div className="space-y-2">
        {agents.length === 0 ? (
          <div className="text-center py-16">
            <span className="text-3xl opacity-20">🤖</span>
            <p className="font-mono text-[11px] text-on-surface-variant/40 mt-3">No agents yet. Create one to get started.</p>
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
