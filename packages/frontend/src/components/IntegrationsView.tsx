import { useState } from 'react';
import { addSecret, deleteSecretApi } from '../lib/api.ts';

// ── Types ─────────────────────────────────────────────────────────────────────

interface IntegrationDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  secretKey: string;
  tokenLabel: string;
  tokenPlaceholder: string;
  helpText: string;
}

const INTEGRATIONS: IntegrationDef[] = [
  {
    id: 'telegram',
    name: 'Telegram',
    description: 'Receive and reply to messages via a Telegram bot.',
    icon: '✈️',
    secretKey: 'TELEGRAM_BOT_TOKEN',
    tokenLabel: 'Bot Token',
    tokenPlaceholder: '110201543:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
    helpText: 'Create a bot via @BotFather on Telegram, then paste the token here.',
  },
];

// ── Sub-components ────────────────────────────────────────────────────────────

const inputCls =
  'w-full rounded bg-surface-container px-3 py-2 text-[11px] text-on-surface placeholder:text-on-surface-variant/40 outline-none focus:ring-1 focus:ring-primary/25 font-mono transition-shadow';

function IntegrationCard({
  def,
  agentId,
  enabled,
  onEnable,
  onDisable,
}: {
  def: IntegrationDef;
  agentId: string;
  enabled: boolean;
  onEnable: (secretKey: string) => void;
  onDisable: (secretKey: string) => void;
}) {
  const [configuring, setConfiguring] = useState(false);
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    if (!token.trim()) { setError('Token is required'); return; }
    setSaving(true); setError(null);
    try {
      await addSecret(agentId, def.secretKey, token.trim());
      onEnable(def.secretKey);
      setConfiguring(false);
      setToken('');
    } catch {
      setError('Failed to save — check the console');
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm(`Disconnect ${def.name}? The agent will stop using it immediately.`)) return;
    await deleteSecretApi(agentId, def.secretKey);
    onDisable(def.secretKey);
  }

  return (
    <div className="rounded-lg bg-surface-container-lowest border border-outline-variant/40 p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-[20px] flex-shrink-0">{def.icon}</span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-on-surface">{def.name}</p>
            <p className="font-mono text-[10px] text-on-surface-variant/70 mt-0.5 leading-relaxed">
              {def.description}
            </p>
          </div>
        </div>

        <div className="flex-shrink-0 flex items-center gap-2">
          {enabled ? (
            <>
              <span className="font-mono text-[9px] text-secondary/80 flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-secondary/70" />
                Connected
              </span>
              <button
                onClick={handleDisconnect}
                className="rounded px-2 py-1 text-[10px] font-mono text-error/50 hover:text-error hover:bg-error/10 transition-colors"
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              onClick={() => { setConfiguring(true); setError(null); }}
              className="rounded bg-primary/10 border border-primary/20 px-3 py-1 text-[11px] font-medium text-primary hover:bg-primary/20 transition-colors"
            >
              Connect
            </button>
          )}
        </div>
      </div>

      {/* Config form — shown when not yet enabled and user clicked Connect */}
      {!enabled && configuring && (
        <div className="pt-2 border-t border-outline-variant/30 space-y-3">
          <div>
            <label className="block text-[10px] uppercase tracking-[0.14em] text-on-surface-variant font-medium mb-1.5">
              {def.tokenLabel}
            </label>
            <input
              type="password"
              className={inputCls}
              placeholder={def.tokenPlaceholder}
              value={token}
              onChange={e => { setToken(e.target.value); setError(null); }}
              autoComplete="off"
              autoFocus
            />
            <p className="font-mono text-[9px] text-on-surface-variant/50 mt-1.5 leading-relaxed">
              {def.helpText}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleConnect}
              disabled={saving || !token.trim()}
              className="rounded bg-primary px-3 py-1.5 text-[12px] font-medium text-on-primary transition-opacity disabled:opacity-40 hover:opacity-90"
            >
              {saving ? 'Saving…' : 'Save & Connect'}
            </button>
            <button
              onClick={() => { setConfiguring(false); setToken(''); setError(null); }}
              className="rounded px-3 py-1.5 text-[12px] font-mono text-on-surface-variant hover:text-on-surface transition-colors"
            >
              Cancel
            </button>
            {error && <span className="font-mono text-[10px] text-error">{error}</span>}
          </div>
        </div>
      )}

      {/* Update token form — shown when already enabled and user wants to rotate */}
      {enabled && configuring && (
        <div className="pt-2 border-t border-outline-variant/30 space-y-3">
          <div>
            <label className="block text-[10px] uppercase tracking-[0.14em] text-on-surface-variant font-medium mb-1.5">
              New {def.tokenLabel}
            </label>
            <input
              type="password"
              className={inputCls}
              placeholder="Paste new token"
              value={token}
              onChange={e => { setToken(e.target.value); setError(null); }}
              autoComplete="off"
              autoFocus
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleConnect}
              disabled={saving || !token.trim()}
              className="rounded bg-primary px-3 py-1.5 text-[12px] font-medium text-on-primary transition-opacity disabled:opacity-40 hover:opacity-90"
            >
              {saving ? 'Saving…' : 'Update Token'}
            </button>
            <button
              onClick={() => { setConfiguring(false); setToken(''); setError(null); }}
              className="rounded px-3 py-1.5 text-[12px] font-mono text-on-surface-variant hover:text-on-surface transition-colors"
            >
              Cancel
            </button>
            {error && <span className="font-mono text-[10px] text-error">{error}</span>}
          </div>
        </div>
      )}

      {/* Rotate token link — shown when enabled and not currently editing */}
      {enabled && !configuring && (
        <button
          onClick={() => { setConfiguring(true); setError(null); }}
          className="font-mono text-[10px] text-on-surface-variant/50 hover:text-on-surface-variant transition-colors"
        >
          Rotate token
        </button>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function IntegrationsView({
  agentId,
  secretNames,
  setSecretNames,
}: {
  agentId: string;
  secretNames: string[];
  setSecretNames: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  return (
    <div className="flex flex-col gap-4 max-w-xl">
      <div>
        <h2 className="font-headline text-[22px] font-bold text-on-surface">Integrations</h2>
        <p className="font-mono text-[11px] text-on-surface-variant/70 mt-1">
          Connect external services. Each integration stores a token as a secret and activates automatically.
        </p>
      </div>

      <div className="space-y-3">
        {INTEGRATIONS.map(def => (
          <IntegrationCard
            key={def.id}
            def={def}
            agentId={agentId}
            enabled={secretNames.includes(def.secretKey)}
            onEnable={key => setSecretNames(prev => prev.includes(key) ? prev : [...prev, key])}
            onDisable={key => setSecretNames(prev => prev.filter(n => n !== key))}
          />
        ))}
      </div>

      <p className="font-mono text-[10px] text-on-surface-variant/40 mt-2">
        More integrations coming soon. For other API keys and credentials, use the Secrets section in the sidebar.
      </p>
    </div>
  );
}
