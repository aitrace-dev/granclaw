import { useState } from 'react';
import { addSecret, deleteSecretApi } from '../lib/api.ts';
import { useT } from '../lib/i18n.tsx';
import { GoLoginCard } from './GoLoginCard.tsx';

// ── Types ─────────────────────────────────────────────────────────────────────

interface IntegrationDef {
  id: string;
  name: string;
  descriptionKey: string;
  icon: string;
  secretKey: string;
  tokenLabelKey: string;
  tokenPlaceholder: string;
  helpTextKey: string;
}

const INTEGRATIONS: IntegrationDef[] = [
  {
    id: 'telegram',
    name: 'Telegram',
    descriptionKey: 'integrations.telegramDescription',
    icon: '✈️',
    secretKey: 'TELEGRAM_BOT_TOKEN',
    tokenLabelKey: 'integrations.telegramTokenLabel',
    tokenPlaceholder: '110201543:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
    helpTextKey: 'integrations.telegramHelp',
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
  const { t } = useT();
  const [configuring, setConfiguring] = useState(false);
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    if (!token.trim()) { setError(t('common.tokenRequired')); return; }
    setSaving(true); setError(null);
    try {
      await addSecret(agentId, def.secretKey, token.trim());
      onEnable(def.secretKey);
      setConfiguring(false);
      setToken('');
    } catch {
      setError(t('integrations.errorSave'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm(t('integrations.disconnectConfirm', { name: def.name }))) return;
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
              {t(def.descriptionKey)}
            </p>
          </div>
        </div>

        <div className="flex-shrink-0 flex items-center gap-2">
          {enabled ? (
            <>
              <span className="font-mono text-[9px] text-secondary/80 flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-secondary/70" />
                {t('integrations.connected')}
              </span>
              <button
                onClick={handleDisconnect}
                className="rounded px-2 py-1 text-[10px] font-mono text-error/50 hover:text-error hover:bg-error/10 transition-colors"
              >
                {t('integrations.disconnect')}
              </button>
            </>
          ) : (
            <button
              onClick={() => { setConfiguring(true); setError(null); }}
              className="rounded bg-primary/10 border border-primary/20 px-3 py-1 text-[11px] font-medium text-primary hover:bg-primary/20 transition-colors"
            >
              {t('integrations.connect')}
            </button>
          )}
        </div>
      </div>

      {/* Config form — shown when not yet enabled and user clicked Connect */}
      {!enabled && configuring && (
        <div className="pt-2 border-t border-outline-variant/30 space-y-3">
          <div>
            <label className="block text-[10px] uppercase tracking-[0.14em] text-on-surface-variant font-medium mb-1.5">
              {t(def.tokenLabelKey)}
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
              {t(def.helpTextKey)}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleConnect}
              disabled={saving || !token.trim()}
              className="rounded bg-primary px-3 py-1.5 text-[12px] font-medium text-on-primary transition-opacity disabled:opacity-40 hover:opacity-90"
            >
              {saving ? t('integrations.saving') : t('integrations.saveAndConnect')}
            </button>
            <button
              onClick={() => { setConfiguring(false); setToken(''); setError(null); }}
              className="rounded px-3 py-1.5 text-[12px] font-mono text-on-surface-variant hover:text-on-surface transition-colors"
            >
              {t('integrations.cancel')}
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
              {t('integrations.newPrefix', { label: t(def.tokenLabelKey) })}
            </label>
            <input
              type="password"
              className={inputCls}
              placeholder={t('integrations.pasteNewToken')}
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
              {saving ? t('integrations.saving') : t('integrations.updateToken')}
            </button>
            <button
              onClick={() => { setConfiguring(false); setToken(''); setError(null); }}
              className="rounded px-3 py-1.5 text-[12px] font-mono text-on-surface-variant hover:text-on-surface transition-colors"
            >
              {t('integrations.cancel')}
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
          {t('integrations.rotateToken')}
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
  const { t } = useT();
  return (
    <div className="flex flex-col gap-4 max-w-xl">
      <div>
        <h2 className="font-headline text-[22px] font-bold text-on-surface">{t('integrations.title')}</h2>
        <p className="font-mono text-[11px] text-on-surface-variant/70 mt-1">
          {t('integrations.blurb')}
        </p>
      </div>

      <div className="space-y-3">
        <GoLoginCard agentId={agentId} />
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
        {t('integrations.moreSoon')}
      </p>
    </div>
  );
}
