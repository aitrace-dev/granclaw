import { useState, useSyncExternalStore } from 'react';
import type { Agent } from '../lib/api.ts';
import { addSecret, deleteSecretApi, exportAgentUrl } from '../lib/api.ts';
import { useT } from '../lib/i18n.tsx';
import { getRegisteredViews, subscribeViews } from '../lib/extensions.ts';

/* ═══════════════════════════════════════════════════════════════════════════
 *  AgentSettingsPanel
 *  ──────────────────
 *  Panopticon Aesthetic: tonal surface layering, no borders, monospace
 *  for machine data, Space Grotesk for identity, Inter for controls.
 *  "Stacked glass" depth via bg shifts + subtle primary glow on hover.
 * ═══════════════════════════════════════════════════════════════════════════ */

// ── Accordion primitive ──────────────────────────────────────────────────

function Section({
  title,
  icon,
  count,
  defaultOpen = false,
  children,
  accentClass,
}: {
  title: string;
  icon: React.ReactNode;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
  accentClass?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      className={`rounded-md overflow-hidden transition-colors ${open ? 'bg-surface-container-high' : 'bg-surface-container'}`}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 group transition-colors hover:brightness-110"
      >
        <span className="text-[13px] opacity-60 group-hover:opacity-100 transition-opacity">
          {icon}
        </span>
        <span
          className={`text-[11px] uppercase tracking-[0.14em] font-medium flex-1 text-left ${accentClass ?? 'text-on-surface-variant'}`}
        >
          {title}
        </span>
        {count !== undefined && count > 0 && (
          <span className="font-mono text-[9px] text-on-surface-variant/70 tabular-nums">
            {count}
          </span>
        )}
        <svg
          className="w-3 h-3 text-on-surface-variant/70 transition-transform duration-200"
          style={{ transform: open ? 'rotate(90deg)' : 'none' }}
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path d="M6 3l5 5-5 5V3z" />
        </svg>
      </button>

      <div
        className="grid transition-[grid-template-rows] duration-200"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-4 pt-0.5">{children}</div>
        </div>
      </div>
    </div>
  );
}

// ── View selector button (same shape as accordion, but not collapsible) ──

function ViewButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-md flex items-center gap-3 px-4 py-3 transition-colors ${
        active
          ? 'bg-surface-container-high border border-outline-variant/40 text-on-surface'
          : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
      }`}
    >
      <span className="text-[13px]">{icon}</span>
      <span className="text-[11px] uppercase tracking-[0.14em] font-medium">
        {label}
      </span>
      {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-secondary" />}
    </button>
  );
}

// ── Inline form input ────────────────────────────────────────────────────

const inputCls =
  'rounded bg-surface-container px-2.5 py-[7px] text-[11px] text-on-surface placeholder:text-on-surface-variant/60 outline-none focus:ring-1 focus:ring-primary/25 font-mono transition-shadow';

// ── Main component ───────────────────────────────────────────────────────

export function AgentSettingsPanel({
  agentId,
  agent,
  agentDisplayName,
  connected,
  secretNames,
  setSecretNames,
  isWiping,
  isSending,
  onWipe,
  mainView,
  onViewChange,
}: {
  agentId: string;
  agent: Agent;
  agentDisplayName: string | null;
  connected: boolean;
  secretNames: string[];
  setSecretNames: React.Dispatch<React.SetStateAction<string[]>>;
  isWiping: boolean;
  isSending: boolean;
  onWipe: () => void;
  mainView: string;
  onViewChange: (view: string) => void;
}) {
  const { t } = useT();
  const [secretForm, setSecretForm] = useState({ name: '', value: '' });
  const extViews = useSyncExternalStore(subscribeViews, getRegisteredViews);

  const isEditing = secretNames.includes(secretForm.name);

  return (
    <aside className="w-72 flex-shrink-0 flex flex-col gap-1 overflow-y-auto pr-1 pb-4 scrollbar-thin">

      {/* ═════════════════════  IDENTITY CARD  ═══════════════════════════ */}
      <div className="rounded-md bg-surface-container-lowest border border-outline-variant/40 px-3 py-2.5 relative overflow-hidden">
        <div className="flex items-center justify-between relative">
          <div className="min-w-0">
            <p className="font-headline text-[15px] font-semibold text-on-surface tracking-[-0.01em] truncate">
              {agentDisplayName ?? agent.name}
            </p>
            <p className="font-mono text-[9px] text-primary/50 mt-0.5 truncate">{agent.model}</p>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0 ml-3">
            <span
              className={`font-mono text-[9px] ${connected ? 'text-secondary/80' : 'text-on-surface-variant/70'}`}
              title={connected ? 'WS connected' : 'WS disconnected'}
            >
              {connected ? '●' : '○'}
            </span>
            <span
              className={`rounded-full px-1.5 py-[2px] text-[8px] font-semibold uppercase tracking-[0.1em]
                ${agent.status === 'active'
                  ? 'bg-secondary-container text-on-primary'
                  : 'bg-surface-container text-on-surface-variant/60'
                }`}
            >
              {agent.status}
            </span>
          </div>
        </div>
      </div>

      {/* ═════════════════════  VIEW SELECTORS  ═══════════════════════════ */}
      <ViewButton
        icon="💬"
        label={t('agentSettings.views.chat')}
        active={mainView === 'chat'}
        onClick={() => onViewChange('chat')}
      />
      <ViewButton
        icon="▦"
        label={t('agentSettings.views.tasks')}
        active={mainView === 'tasks'}
        onClick={() => onViewChange('tasks')}
      />
      <ViewButton
        icon="🧩"
        label={t('agentSettings.views.skills')}
        active={mainView === 'skills'}
        onClick={() => onViewChange('skills')}
      />
      <ViewButton
        icon="🌐"
        label={t('agentSettings.views.browser')}
        active={mainView === 'browser'}
        onClick={() => onViewChange('browser')}
      />
      <ViewButton
        icon="📂"
        label={t('agentSettings.views.files')}
        active={mainView === 'files'}
        onClick={() => onViewChange('files')}
      />
      <ViewButton
        icon="⚡"
        label={t('agentSettings.views.workflows')}
        active={mainView === 'workflows'}
        onClick={() => onViewChange('workflows')}
      />
      <ViewButton
        icon="⏰"
        label={t('agentSettings.views.schedules')}
        active={mainView === 'schedules'}
        onClick={() => onViewChange('schedules')}
      />
      <ViewButton
        icon="📡"
        label={t('agentSettings.views.monitor')}
        active={mainView === 'monitor'}
        onClick={() => onViewChange('monitor')}
      />
      <ViewButton
        icon="📊"
        label={t('agentSettings.views.usage')}
        active={mainView === 'usage'}
        onClick={() => onViewChange('usage')}
      />
      <ViewButton
        icon="📋"
        label={t('agentSettings.views.logs')}
        active={mainView === 'logs'}
        onClick={() => onViewChange('logs')}
      />
      <ViewButton
        icon="🔌"
        label={t('agentSettings.views.integrations')}
        active={mainView === 'integrations'}
        onClick={() => onViewChange('integrations')}
      />
      {extViews.map(v => (
        <ViewButton
          key={v.id}
          icon={v.icon}
          label={v.label}
          active={mainView === v.id}
          onClick={() => onViewChange(v.id)}
        />
      ))}
      {/* Guardian — Coming Soon (disabled) */}
      <div
        data-testid="guardian-coming-soon"
        className="w-full rounded-md flex items-center gap-3 px-4 py-3 bg-surface-container-lowest cursor-default opacity-50 relative"
      >
        <span className="text-[13px]">🛡</span>
        <span className="text-[11px] uppercase tracking-[0.14em] font-medium text-on-surface-variant/70">
          {t('agentSettings.views.guardian')}
        </span>
        <span className="ml-auto rounded-full bg-amber-400/10 border border-amber-400/20 px-1.5 py-[1px] font-mono text-[7px] text-warning uppercase tracking-widest">
          {t('agentSettings.comingSoon')}
        </span>
      </div>

      {/* ── Divider ── */}
      <div className="h-px bg-surface-container mx-2 my-1" />

      {/* Tools and Environment sections removed — tools are configured via agents.config.json */}

      {/* ═════════════════════  SECRETS  ═════════════════════════════════ */}
      <Section title={t('agentSettings.secrets')} icon={<span>🔐</span>} count={secretNames.length}>
        <div className="space-y-2.5">
          {/* Secret list — same style as environment */}
          {secretNames.length > 0 && (
            <div className="flex flex-col">
              {secretNames.map((name) => (
                <div
                  key={name}
                  className="group flex items-center justify-between py-[5px] px-2 -mx-2 rounded transition-colors hover:bg-surface-container/50"
                >
                  <span
                    className={`font-mono text-[11px] cursor-pointer transition-colors ${
                      secretForm.name === name
                        ? 'text-primary'
                        : 'text-on-surface/70 hover:text-primary/80'
                    }`}
                    onClick={() => setSecretForm({ name, value: '' })}
                    title="Click to update value"
                  >
                    <span className="text-on-surface-variant/60">🔒 </span>
                    {name}
                  </span>
                  <button
                    onClick={async () => {
                      await deleteSecretApi(agentId, name);
                      setSecretNames((prev) => prev.filter((n) => n !== name));
                      if (secretForm.name === name) setSecretForm({ name: '', value: '' });
                    }}
                    className="text-[9px] text-transparent group-hover:text-on-surface-variant/70 hover:!text-error transition-colors flex-shrink-0 ml-2"
                    title={`Remove ${name}`}
                  >×</button>
                </div>
              ))}
            </div>
          )}

          {secretNames.length === 0 && (
            <p className="font-mono text-[10px] text-on-surface-variant italic">{t('agentSettings.noSecrets')}</p>
          )}

          {/* Edit mode: update an existing secret */}
          {isEditing ? (
            <div className="flex flex-col gap-1.5">
              <p className="font-mono text-[9px] text-primary/50">{t('agentSettings.updating', { name: secretForm.name })}</p>
              <div className="flex gap-1.5">
                <input
                  type="password"
                  className={`${inputCls} flex-1 min-w-0`}
                  placeholder={t('agentSettings.newValue')}
                  value={secretForm.value}
                  onChange={(e) => setSecretForm((f) => ({ ...f, value: e.target.value }))}
                />
                <button
                  onClick={async () => {
                    if (!secretForm.value.trim()) return;
                    await addSecret(agentId, secretForm.name.trim(), secretForm.value.trim());
                    setSecretForm({ name: '', value: '' });
                  }}
                  disabled={!secretForm.value.trim()}
                  className="rounded bg-surface-container px-2.5 py-[7px] text-[11px] text-on-surface-variant transition-all disabled:opacity-20 hover:bg-surface-container hover:text-on-surface flex-shrink-0"
                >{t('agentSettings.save')}</button>
                <button
                  onClick={() => setSecretForm({ name: '', value: '' })}
                  className="rounded bg-surface-container px-2.5 py-[7px] text-[11px] text-on-surface-variant/60 hover:text-on-surface-variant/70 transition-colors flex-shrink-0"
                >×</button>
              </div>
            </div>
          ) : (
            /* Add mode: same inline style as environment */
            <div className="flex gap-1.5">
              <input
                className={`${inputCls} flex-1 min-w-0`}
                placeholder={t('agentSettings.secretNamePlaceholder')}
                value={secretForm.name}
                onChange={(e) => setSecretForm((f) => ({ ...f, name: e.target.value }))}
              />
              <input
                type="password"
                className={`${inputCls} flex-1 min-w-0`}
                placeholder={t('agentSettings.secretValuePlaceholder')}
                value={secretForm.value}
                onChange={(e) => setSecretForm((f) => ({ ...f, value: e.target.value }))}
              />
              <button
                onClick={async () => {
                  if (!secretForm.name.trim() || !secretForm.value.trim()) return;
                  await addSecret(agentId, secretForm.name.trim(), secretForm.value.trim());
                  setSecretNames((prev) => [...prev.filter((n) => n !== secretForm.name.trim()), secretForm.name.trim()]);
                  setSecretForm({ name: '', value: '' });
                }}
                disabled={!secretForm.name.trim() || !secretForm.value.trim()}
                className="rounded bg-surface-container px-2.5 py-[7px] text-[11px] text-on-surface-variant transition-all disabled:opacity-20 hover:bg-surface-container hover:text-on-surface flex-shrink-0"
              >+</button>
            </div>
          )}
        </div>
      </Section>

      {/* ═════════════════════  GUARDRAILS  ══════════════════════════════ */}
      {agent.guardrails && agent.guardrails.length > 0 && (
        <Section
          title={t('agentSettings.guardrails')}
          icon={<span>🛡</span>}
          count={agent.guardrails.length}
          accentClass="text-warning/60"
        >
          <div className="space-y-2.5">
            <div className="flex flex-col gap-2">
              {agent.guardrails.map((rule, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className="text-amber-500/30 text-[8px] mt-[3px] select-none">
                    ●
                  </span>
                  <span className="font-mono text-[11px] text-warning/50 leading-relaxed">
                    {rule}
                  </span>
                </div>
              ))}
            </div>
            <p className="font-mono text-[8px] text-on-surface-variant/20 uppercase tracking-[0.15em]">
              {t('agentSettings.guardrailsBlurb')}
            </p>
          </div>
        </Section>
      )}

      {/* ═════════════════════  BRAIN + DANGER  ══════════════════════════ */}
      <div className="mt-auto pt-1 space-y-1">
        <a
          href={exportAgentUrl(agentId)}
          download
          className="block w-full rounded-md bg-surface-container-lowest px-3 py-2 font-mono text-[10px] text-on-surface-variant/70 transition-all hover:bg-surface-container-lowest border border-outline-variant/40 hover:text-on-surface-variant/70"
          title={t('agentSettings.exportTitle')}
        >
          {t('agentSettings.exportAgent')}
        </a>
        <button
          onClick={onWipe}
          disabled={isWiping || isSending}
          className="w-full rounded-md bg-surface-container-lowest px-3 py-2 text-left font-mono text-[10px] text-error/40 transition-all hover:bg-error/10 hover:text-error disabled:opacity-20"
        >
          {isWiping ? t('agentSettings.wiping') : t('agentSettings.wipeAgent')}
        </button>
      </div>
    </aside>
  );
}
