import { useState } from 'react';
import { buttonPrimary, buttonGhost, inputCls } from '../ui/primitives';
import { useT } from '../lib/i18n.tsx';

interface Props {
  title: string;
  initial?: { name: string; cron: string; timezone: string };
  onSave: (data: { name: string; cron: string; timezone: string }) => Promise<void>;
  onCancel: () => void;
}

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Madrid',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

export function WorkflowScheduleModal({ title, initial, onSave, onCancel }: Props) {
  const { t } = useT();
  const [name, setName] = useState(initial?.name ?? '');
  const [cron, setCron] = useState(initial?.cron ?? '0 9 * * *');
  const [timezone, setTimezone] = useState(initial?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !cron.trim() || saving) return;
    setSaving(true);
    try {
      await onSave({ name: name.trim(), cron: cron.trim(), timezone });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.4)' }}
        onClick={onCancel}
      />
      <form
        onSubmit={handleSubmit}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
      >
        <div className="bg-surface-container-lowest border border-outline-variant/40 rounded-xl shadow-callout p-5 w-full max-w-md pointer-events-auto">
          <h3 className="font-headline text-lg font-bold text-on-surface mb-4">{title}</h3>

          <div className="flex flex-col gap-3 mb-5">
            <div>
              <label className="font-label text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant block mb-1">
                {t('workflows.formName')}
              </label>
              <input
                autoFocus
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('workflows.scheduleNamePlaceholder')}
              />
            </div>

            <div>
              <label className="font-label text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant block mb-1">
                {t('workflows.cronLabel')}
              </label>
              <input
                className={`${inputCls} font-mono`}
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                placeholder={t('workflows.cronPlaceholder')}
              />
              <p className="text-[10px] text-on-surface-variant/60 mt-1">
                minute hour day-of-month month day-of-week
              </p>
            </div>

            <div>
              <label className="font-label text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant block mb-1">
                {t('workflows.timezoneLabel')}
              </label>
              <select
                className={inputCls}
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              >
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
                {!COMMON_TIMEZONES.includes(timezone) && (
                  <option value={timezone}>{timezone}</option>
                )}
              </select>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={onCancel} className={buttonGhost}>
              {t('workflows.cancel')}
            </button>
            <button type="submit" disabled={!name.trim() || !cron.trim() || saving} className={buttonPrimary}>
              {saving ? t('workflows.saving') : t('workflows.save')}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}
