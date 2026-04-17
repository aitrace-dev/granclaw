import { Link } from 'react-router-dom';
import type { Agent } from '../lib/api.ts';

interface Props {
  agent: Agent;
}

export function AgentCard({ agent }: Props) {
  const isActive = agent.status === 'active';

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-surface-container-lowest p-4 sm:p-5 transition-colors hover:bg-surface-container group min-w-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-2xl flex-shrink-0">🤖</span>
          <span className="font-headline font-semibold text-on-surface truncate">{agent.name}</span>
        </div>
        <span
          className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium uppercase tracking-wide
            ${isActive
              ? 'bg-secondary-container text-on-primary'
              : 'bg-surface-container-high text-on-surface-variant'
            }`}
        >
          {agent.status}
        </span>
      </div>

      {/* Model */}
      <span className="font-mono text-xs text-secondary">{agent.model}</span>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <Link
          to={`/agents/${agent.id}/chat`}
          className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-on-primary transition-opacity hover:opacity-90"
        >
          Chat
        </Link>
        <Link
          to={`/logs?agentId=${agent.id}`}
          className="rounded bg-surface-container-high px-3 py-1.5 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container-lowest"
        >
          Registros
        </Link>
      </div>
    </div>
  );
}
