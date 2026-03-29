import { useEffect, useState } from 'react';
import { fetchAgents, type Agent } from '../lib/api.ts';
import { AgentCard } from '../components/AgentCard.tsx';

export function DashboardPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAgents()
      .then(setAgents)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-on-surface-variant font-mono text-sm">loading agents…</div>;
  if (error) return <div className="text-error font-mono text-sm">{error}</div>;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-semibold text-on-surface">Agents</h1>

      {agents.length === 0 ? (
        <p className="font-mono text-sm text-on-surface-variant">
          No agents configured. Add one to <code>agents.config.json</code>.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((a) => (
            <AgentCard key={a.id} agent={a} />
          ))}
        </div>
      )}
    </div>
  );
}
