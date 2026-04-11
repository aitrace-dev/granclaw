import type { Config } from 'tailwindcss';

// Design tokens migrated from the granclaw.com landing page.
//
// Strategy: every color token maps to a CSS custom property defined in
// src/index.css. The same class (e.g. `bg-background`) works in both
// light and dark themes — Tailwind just reads the current value of the
// variable. Chart.js and other code that needs runtime access to theme
// colors can call getComputedStyle(document.documentElement).getPropertyValue(--token).
//
// RGB triplets (no `rgb()` wrapper in the var itself) let us keep Tailwind
// alpha modifiers working — `bg-primary/40` expands to `rgb(var(--primary) / 0.4)`.
const cssVar = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Base surfaces
        background:                   cssVar('background'),
        'on-background':              cssVar('on-background'),
        'on-surface':                 cssVar('on-surface'),
        'on-surface-variant':         cssVar('on-surface-variant'),
        'surface-bright':             cssVar('surface-bright'),
        'surface-dim':                cssVar('surface-dim'),
        'surface-container-lowest':   cssVar('surface-container-lowest'),
        'surface-container-low':      cssVar('surface-container-low'),
        'surface-container':          cssVar('surface-container'),
        'surface-container-high':     cssVar('surface-container-high'),
        'surface-container-highest':  cssVar('surface-container-highest'),

        // Accents
        primary:                      cssVar('primary'),
        'on-primary':                 cssVar('on-primary'),
        'primary-fixed':              cssVar('primary-fixed'),
        'primary-fixed-dim':          cssVar('primary-fixed-dim'),
        'surface-tint':               cssVar('surface-tint'),

        secondary:                    cssVar('secondary'),
        'secondary-container':        cssVar('secondary-container'),

        'tertiary-fixed':             cssVar('tertiary-fixed'),

        // Outlines and status
        outline:                      cssVar('outline'),
        'outline-variant':            cssVar('outline-variant'),
        error:                        cssVar('error'),

        // Semantic status tokens used by task board / log viewer / charts.
        // Defined in index.css so they switch with the theme.
        success:                      cssVar('success'),
        warning:                      cssVar('warning'),
        info:                         cssVar('info'),
      },
      borderRadius: {
        DEFAULT: '0.125rem',
        lg:      '0.25rem',
        xl:      '0.5rem',
        full:    '0.75rem',
      },
      fontFamily: {
        // Landing-style serif for headings and narrative copy only.
        headline: ['"Noto Serif"', 'Georgia', 'serif'],
        // Inter sans for dense dashboard content (tool output, logs, chat).
        sans:     ['Inter', 'system-ui', 'sans-serif'],
        // Space Grotesk for uppercase labels and nav chrome.
        label:    ['"Space Grotesk"', 'sans-serif'],
        // JetBrains Mono for code, file paths, terminal output.
        mono:     ['"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        callout: '0 10px 40px rgba(29, 28, 22, 0.06)',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
} satisfies Config;
