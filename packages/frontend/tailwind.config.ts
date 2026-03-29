import type { Config } from 'tailwindcss';

// Design tokens from Stitch "The Panopticon Aesthetic"
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: '#111319',
        'surface-low': '#191b22',
        'surface-card': '#1e1f26',
        'surface-high': '#282a30',
        'surface-highest': '#33343b',
        'surface-lowest': '#0c0e14',
        'surface-bright': '#373940',
        primary: '#d0bcff',
        'primary-container': '#a078ff',
        secondary: '#4edea3',
        'secondary-container': '#00a572',
        error: '#ffb4ab',
        outline: '#958ea0',
        'outline-variant': '#494454',
        'on-surface': '#e2e2eb',
        'on-surface-variant': '#cbc3d7',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
