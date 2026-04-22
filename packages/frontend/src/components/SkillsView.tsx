import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { fetchSkills, fetchSkillDetail, type Skill, type SkillDetail } from '../lib/api.ts';
import { useT } from '../lib/i18n.tsx';

export function SkillsView({ agentId }: { agentId: string }) {
  const { t } = useT();
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSkills(agentId)
      .then(list => { if (!cancelled) setSkills(list); })
      .catch(() => { if (!cancelled) setSkills([]); });
    return () => { cancelled = true; };
  }, [agentId]);

  useEffect(() => {
    if (!selected) { setDetail(null); setDetailError(null); return; }
    let cancelled = false;
    setDetail(null); setDetailError(null);
    fetchSkillDetail(agentId, selected)
      .then(d => { if (!cancelled) setDetail(d); })
      .catch(err => { if (!cancelled) setDetailError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [agentId, selected]);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* List */}
      <div className="w-72 border-r border-outline/20 overflow-y-auto bg-surface-container-lowest">
        <div className="p-4 border-b border-outline/20">
          <h2 className="text-[13px] font-semibold text-on-surface">{t('skillsView.title')}</h2>
          <p className="text-[10px] text-on-surface-variant mt-1 leading-relaxed">{t('skillsView.subtitle')}</p>
        </div>
        {skills === null ? (
          <div className="p-4 text-[11px] text-on-surface-variant font-mono">{t('skillsView.loading')}</div>
        ) : skills.length === 0 ? (
          <div className="p-4 text-[11px] text-on-surface-variant leading-relaxed">{t('skillsView.empty')}</div>
        ) : (
          <ul className="divide-y divide-outline/10">
            {skills.map(s => (
              <li key={s.name}>
                <button
                  type="button"
                  onClick={() => setSelected(s.name)}
                  className={`w-full text-left px-4 py-3 hover:bg-surface-container transition-colors ${selected === s.name ? 'bg-surface-container' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-mono text-on-surface truncate">{s.name}</span>
                    {s.userInvocable && (
                      <span className="text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">
                        {t('skillsView.userInvocable')}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-on-surface-variant mt-1 line-clamp-2 leading-snug">
                    {s.description}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Detail */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selected ? (
          <div className="text-[11px] text-on-surface-variant font-mono">{t('skillsView.selectSkill')}</div>
        ) : detailError ? (
          <div className="text-[11px] text-error font-mono">{t('skillsView.loadError', { error: detailError })}</div>
        ) : !detail ? (
          <div className="text-[11px] text-on-surface-variant font-mono">{t('skillsView.loading')}</div>
        ) : (
          <>
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-[16px] font-semibold text-on-surface font-mono">{detail.name}</h2>
                {detail.userInvocable && (
                  <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">
                    {t('skillsView.userInvocable')}
                  </span>
                )}
              </div>
              <p className="text-[12px] text-on-surface-variant">{detail.description}</p>
              {detail.allowedTools && (
                <p className="text-[10px] text-on-surface-variant mt-2 font-mono">
                  <span className="opacity-60">{t('skillsView.allowedTools')}:</span> {detail.allowedTools}
                </p>
              )}
            </div>
            <div className="text-[12px] text-on-surface/85 leading-relaxed prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{stripFrontmatter(detail.content)}</ReactMarkdown>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function stripFrontmatter(md: string): string {
  if (!md.startsWith('---')) return md;
  const end = md.indexOf('\n---', 3);
  if (end === -1) return md;
  return md.slice(end + 4).replace(/^\n+/, '');
}
