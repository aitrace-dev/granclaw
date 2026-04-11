import { useEffect, useState, useCallback } from 'react';

/**
 * Theme hook — reads and writes the GranClaw dashboard theme preference.
 *
 * Single source of truth is the `dark` class on the <html> element. The
 * pre-paint script in index.html has already set it once before React
 * mounted (so there's no flash), and this hook syncs React state with
 * whatever the pre-paint picked.
 *
 * Persisted in localStorage['granclaw-theme'] as either 'light' or 'dark'.
 * Falls back to prefers-color-scheme when no preference has been saved.
 */

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'granclaw-theme';

function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void; toggleTheme: () => void } {
  const [theme, setThemeState] = useState<Theme>(currentTheme);

  const apply = useCallback((next: Theme) => {
    const root = document.documentElement;
    if (next === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* blocked — ignore */ }
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    apply(currentTheme() === 'dark' ? 'light' : 'dark');
  }, [apply]);

  // Listen to OS-level changes only when the user hasn't pinned a preference.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
      if (localStorage.getItem(STORAGE_KEY)) return; // user pinned — don't override
      apply(e.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [apply]);

  return { theme, setTheme: apply, toggleTheme };
}
