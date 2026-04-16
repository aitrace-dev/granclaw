/**
 * components/GoLoginCard.tsx
 *
 * Per-agent GoLogin activation card, rendered inside IntegrationsView
 * (the "Social Logins" tab on the agent navbar).
 *
 * Purely a REST client — the backend owns profile creation + reuse. First
 * activation creates a GoLogin profile named "granclaw-<agentId>-<name>";
 * subsequent activations after a deactivation reuse the stored profile ID
 * without a new GoLogin API call.
 */

import { useEffect, useState } from 'react';
import { useT } from '../lib/i18n.tsx';

interface Status {
  active: boolean;
  profileId: string | null;
  enabled: boolean;
}

async function fetchStatus(agentId: string): Promise<Status> {
  const res = await fetch(`/integrations/gologin/agents/${encodeURIComponent(agentId)}/status`);
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
  return res.json();
}

async function postAction(agentId: string, action: 'activate' | 'deactivate'): Promise<{ active: boolean; profileId: string | null }> {
  const res = await fetch(`/integrations/gologin/agents/${encodeURIComponent(agentId)}/${action}`, { method: 'POST' });
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
  return res.json();
}

export function GoLoginCard({ agentId }: { agentId: string }) {
  const { t } = useT();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStatus(agentId)
      .then(setStatus)
      .catch(err => setError(err instanceof Error ? err.message : String(err)));
  }, [agentId]);

  async function toggle() {
    if (!status) return;
    setBusy(true);
    setError(null);
    try {
      const action = status.active ? 'deactivate' : 'activate';
      const result = await postAction(agentId, action);
      setStatus({ ...status, active: result.active, profileId: result.profileId });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // Hide the card entirely when the integration isn't configured server-side.
  // The "not configured" state is a GranClaw-instance concern, not an agent one —
  // showing it per-agent would be noise.
  if (status && !status.enabled) {
    return (
      <div className="rounded-lg bg-surface-container-lowest border border-outline-variant/40 p-4">
        <div className="flex items-start gap-3">
          <span className="text-[20px] flex-shrink-0">🛰️</span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-on-surface">{t('integrations.gologin.name')}</p>
            <p className="font-mono text-[10px] text-on-surface-variant/70 mt-0.5 leading-relaxed">
              {t('integrations.gologin.notConfigured')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-surface-container-lowest border border-outline-variant/40 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="text-[20px] flex-shrink-0">🛰️</span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-on-surface">{t('integrations.gologin.name')}</p>
            <p className="font-mono text-[10px] text-on-surface-variant/70 mt-0.5 leading-relaxed">
              {t('integrations.gologin.description')}
            </p>
          </div>
        </div>

        <div className="flex-shrink-0 flex items-center gap-2">
          {status?.active ? (
            <>
              <span className="font-mono text-[9px] text-secondary/80 flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-secondary/70" />
                {t('integrations.gologin.active')}
              </span>
              <button
                onClick={toggle}
                disabled={busy}
                className="rounded px-2 py-1 text-[10px] font-mono text-error/50 hover:text-error hover:bg-error/10 transition-colors disabled:opacity-50"
              >
                {t('integrations.gologin.deactivate')}
              </button>
            </>
          ) : (
            <button
              onClick={toggle}
              disabled={busy || !status}
              className="rounded bg-primary/10 border border-primary/20 px-3 py-1 text-[11px] font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
            >
              {busy ? t('integrations.gologin.activating') : t('integrations.gologin.activate')}
            </button>
          )}
        </div>
      </div>

      {status?.profileId && (
        <div className="pt-2 border-t border-outline-variant/30">
          <p className="font-mono text-[10px] text-on-surface-variant/60">
            {t('integrations.gologin.profileLabel')}{' '}
            <span className="text-on-surface-variant">{status.profileId}</span>
          </p>
          <p className="font-mono text-[9px] text-on-surface-variant/40 mt-1">
            {t('integrations.gologin.reuseHint')}
          </p>
        </div>
      )}

      {error && (
        <div className="pt-2 border-t border-outline-variant/30">
          <p className="font-mono text-[10px] text-error break-all">{error}</p>
        </div>
      )}
    </div>
  );
}
