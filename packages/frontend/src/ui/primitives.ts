/**
 * primitives.ts
 *
 * Re-usable Tailwind class strings for the dashboard. The existing
 * frontend had every component inventing its own button / input / card
 * classes; centralising them here means the migration doesn't repeat the
 * same chain 20 times and future theme tweaks touch one file.
 *
 * Design philosophy:
 *  - Small radii (default 0.125rem) — matches the landing's tight corners.
 *  - Space Grotesk uppercase labels for buttons and nav, Inter sans for
 *    body controls, Noto Serif only for page titles (handled in h1/h2/h3
 *    via index.css — primitives don't touch typography for text content).
 *  - Subtle borders (outline-variant), warm surfaces, no heavy shadows
 *    outside of the `.shadow-callout` utility class.
 *
 * Usage:
 *   import { buttonPrimary, inputCls } from '@/ui/primitives';
 *   <button className={buttonPrimary}>…</button>
 */

// ── Buttons ──────────────────────────────────────────────────────────────

/** The tall CTA button — filled purple, uppercase label. Use for "primary"
 *  actions like Create agent / Import / Save. One per view. */
export const buttonPrimary =
  'inline-flex items-center justify-center gap-2 ' +
  'bg-primary text-on-primary ' +
  'px-5 py-2.5 text-sm font-label font-semibold uppercase tracking-widest ' +
  'rounded shadow-sm transition-all ' +
  'hover:bg-surface-tint hover:shadow-md ' +
  'active:scale-[0.98] ' +
  'disabled:opacity-40 disabled:pointer-events-none';

/** Quieter companion to the primary button — outlined, same uppercase label. */
export const buttonSecondary =
  'inline-flex items-center justify-center gap-2 ' +
  'border border-outline-variant text-on-surface ' +
  'px-5 py-2.5 text-sm font-label font-semibold uppercase tracking-widest ' +
  'rounded transition-all ' +
  'hover:bg-surface-container hover:border-outline ' +
  'active:scale-[0.98] ' +
  'disabled:opacity-40 disabled:pointer-events-none';

/** Small ghost button for toolbar icons / inline actions. */
export const buttonGhost =
  'inline-flex items-center justify-center gap-1.5 ' +
  'text-on-surface-variant ' +
  'px-2.5 py-1.5 text-xs font-label font-medium uppercase tracking-wider ' +
  'rounded transition-colors ' +
  'hover:bg-surface-container hover:text-on-surface ' +
  'disabled:opacity-40 disabled:pointer-events-none';

/** Destructive variant — same chrome as ghost but red text. */
export const buttonDanger =
  'inline-flex items-center justify-center gap-1.5 ' +
  'text-error ' +
  'px-2.5 py-1.5 text-xs font-label font-medium uppercase tracking-wider ' +
  'rounded transition-colors ' +
  'hover:bg-error/10 ' +
  'disabled:opacity-40 disabled:pointer-events-none';

// ── Form controls ────────────────────────────────────────────────────────

/** Text input / textarea / select — warm surface, quiet border, focus ring. */
export const inputCls =
  'w-full bg-surface-container-lowest text-on-surface placeholder:text-on-surface-variant/50 ' +
  'border border-outline-variant rounded-lg px-3 py-2 text-sm ' +
  'focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 ' +
  'transition-colors';

/** Monospace variant for things that are obviously code / IDs / paths. */
export const inputMono =
  inputCls.replace('text-sm', 'text-sm font-mono');

// ── Surfaces ─────────────────────────────────────────────────────────────

/** The default card — cream-on-cream with a soft ambient shadow and a
 *  subtle border so it still reads on the warm background. */
export const cardCls =
  'bg-surface-container-lowest border border-outline-variant/40 ' +
  'rounded-xl shadow-callout';

/** Slightly lower-emphasis card for nested groups. */
export const cardMuted =
  'bg-surface-container-low border border-outline-variant/30 rounded-xl';

// ── Badges / chips ───────────────────────────────────────────────────────

/** Generic badge — override `bg-*` / `text-*` per semantic at the call site. */
export const badgeBase =
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 ' +
  'text-[10px] font-label font-medium uppercase tracking-wider';

export const badgeNeutral =
  `${badgeBase} bg-surface-container border border-outline-variant/40 text-on-surface-variant`;

export const badgePrimary =
  `${badgeBase} bg-primary/10 border border-primary/20 text-primary`;

export const badgeSuccess =
  `${badgeBase} bg-success/10 border border-success/20 text-success`;

export const badgeWarning =
  `${badgeBase} bg-warning/10 border border-warning/20 text-warning`;

export const badgeError =
  `${badgeBase} bg-error/10 border border-error/20 text-error`;

// ── Navigation ──────────────────────────────────────────────────────────

/** Top-bar / sidebar link — lowercase in code, uppercase via tracking. */
export const navLink =
  'font-label text-xs font-medium uppercase tracking-widest ' +
  'text-on-surface-variant hover:text-primary transition-colors';

export const navLinkActive =
  'font-label text-xs font-semibold uppercase tracking-widest ' +
  'text-primary';
