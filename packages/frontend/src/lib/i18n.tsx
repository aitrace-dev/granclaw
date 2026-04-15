import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import en from '../locales/en.json';
import es from '../locales/es.json';

export type Lang = 'en' | 'es';

const BUNDLES: Record<Lang, Record<string, unknown>> = { en, es };

const STORAGE_KEY = 'granclaw:lang';

function detectInitialLang(): Lang {
  if (typeof window === 'undefined') return 'en';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'es') return stored;
  } catch { /* localStorage can throw in private mode */ }
  const nav = typeof navigator !== 'undefined' ? navigator.language : '';
  return nav.toLowerCase().startsWith('es') ? 'es' : 'en';
}

function lookup(bundle: Record<string, unknown>, key: string): string | undefined {
  const parts = key.split('.');
  let cur: unknown = bundle;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return typeof cur === 'string' ? cur : undefined;
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) => {
    const v = params[name];
    return v === undefined || v === null ? `{${name}}` : String(v);
  });
}

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => detectInitialLang());

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try { document.documentElement.lang = lang; } catch { /* ignore */ }
  }, [lang]);

  const t = useCallback((key: string, params?: Record<string, string | number>): string => {
    const bundle = BUNDLES[lang];
    const str = lookup(bundle, key) ?? lookup(BUNDLES.en, key) ?? key;
    return interpolate(str, params);
  }, [lang]);

  const value = useMemo<I18nContextValue>(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useT must be used inside <LanguageProvider>');
  return ctx;
}

export function LanguageSwitcher({ className }: { className?: string }) {
  const { lang, setLang } = useT();
  return (
    <div className={`flex items-center gap-0.5 rounded-full bg-surface-container/40 p-[2px] ${className ?? ''}`}>
      {(['en', 'es'] as const).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          className={`px-2 py-[2px] rounded-full text-[10px] font-mono uppercase tracking-wider transition-colors ${
            lang === l
              ? 'bg-primary/30 text-primary'
              : 'text-on-surface-variant/70 hover:text-on-surface'
          }`}
          aria-pressed={lang === l}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
