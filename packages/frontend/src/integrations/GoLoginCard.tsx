/**
 * integrations/GoLoginCard.tsx
 *
 * Per-agent GoLogin activation UI. Registered into the 'integrations.cards'
 * slot when enableIntegrations=true (see integrations/register.ts). The
 * backend handles profile creation + reuse — this component only shows
 * state and triggers activate/deactivate.
 */

import { useEffect, useState } from 'react';
import type { Agent } from '../lib/api.ts';
import {
  fetchGoLoginStatus,
  activateGoLogin,
  deactivateGoLogin,
  type GoLoginStatus,
} from './api.ts';

interface RowState extends GoLoginStatus {
  busy: boolean;
  error: string | null;
}

const INITIAL: RowState = { active: false, profileId: null, enabled: true, busy: false, error: null };

export function GoLoginCard({ agents }: { agents: Agent[] }) {
  const [states, setStates] = useState<Record<string, RowState>>({});
  const [globalEnabled, setGlobalEnabled] = useState<boolean>(true);

  // Load per-agent status on mount and whenever the agent list changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const a of agents) {
        try {
          const s = await fetchGoLoginStatus(a.id);
          if (cancelled) return;
          setGlobalEnabled(s.enabled);
          setStates(prev => ({
            ...prev,
            [a.id]: { ...INITIAL, active: s.active, profileId: s.profileId, enabled: s.enabled },
          }));
        } catch (err) {
          if (cancelled) return;
          setStates(prev => ({
            ...prev,
            [a.id]: { ...INITIAL, error: err instanceof Error ? err.message : String(err) },
          }));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [agents]);

  async function toggle(agentId: string, currentlyActive: boolean) {
    setStates(prev => ({
      ...prev,
      [agentId]: { ...(prev[agentId] ?? INITIAL), busy: true, error: null },
    }));
    try {
      const result = currentlyActive
        ? await deactivateGoLogin(agentId)
        : await activateGoLogin(agentId);
      setStates(prev => ({
        ...prev,
        [agentId]: {
          ...(prev[agentId] ?? INITIAL),
          active: result.active,
          profileId: result.profileId,
          busy: false,
          error: null,
        },
      }));
    } catch (err) {
      setStates(prev => ({
        ...prev,
        [agentId]: {
          ...(prev[agentId] ?? INITIAL),
          busy: false,
          error: err instanceof Error ? err.message : String(err),
        },
      }));
    }
  }

  return (
    <section className="rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-5">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold">GoLogin</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            Anti-detect browser profiles. Each agent gets its own fingerprint and persistent login
            sessions. First activation creates the profile; deactivating keeps it so the next
            activation is instant.
          </p>
        </div>
        <span
          className={`flex-shrink-0 rounded px-2 py-1 text-[10px] font-mono ${
            globalEnabled
              ? 'bg-success-container text-on-success-container'
              : 'bg-error-container text-on-error-container'
          }`}
        >
          {globalEnabled ? 'connected' : 'not configured'}
        </span>
      </header>

      {!globalEnabled && (
        <div className="mb-3 rounded bg-error-container/20 p-3 text-sm text-on-surface-variant">
          GoLogin token is not set. In enterprise deployments this is seeded via the
          <code className="mx-1 rounded bg-surface-container px-1 font-mono text-xs">
            GOLOGIN_API_TOKEN
          </code>
          env var. For local dev:
          <code className="mx-1 break-all rounded bg-surface-container px-1 font-mono text-xs">
            PUT /integrations/gologin/secret/api_token
          </code>
        </div>
      )}

      <ul className="divide-y divide-outline-variant/20">
        {agents.length === 0 ? (
          <li className="py-3 text-sm text-on-surface-variant">No agents configured yet.</li>
        ) : (
          agents.map((a) => {
            const s = states[a.id] ?? INITIAL;
            return (
              <li key={a.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">{a.name}</div>
                  {s.profileId && (
                    <div className="truncate font-mono text-xs text-on-surface-variant">
                      profile: {s.profileId}
                    </div>
                  )}
                  {s.error && (
                    <div className="mt-1 break-all text-xs text-error">
                      {s.error}
                    </div>
                  )}
                </div>
                <button
                  disabled={s.busy || !globalEnabled}
                  onClick={() => toggle(a.id, s.active)}
                  className={`flex-shrink-0 rounded px-3 py-1 text-sm font-mono transition ${
                    s.active
                      ? 'bg-primary text-on-primary hover:bg-primary/90'
                      : 'bg-surface-container text-on-surface hover:bg-surface-container-high'
                  } disabled:opacity-50`}
                >
                  {s.busy ? '…' : s.active ? 'Active' : 'Activate'}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}
