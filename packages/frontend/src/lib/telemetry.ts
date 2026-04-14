/// <reference types="vite/client" />
// packages/frontend/src/lib/telemetry.ts
//
// Fire-and-forget PostHog telemetry for the GranClaw frontend.
// The project key is bundled — set VITE_POSTHOG_DISABLED=true to opt out.

import posthog from 'posthog-js';

const POSTHOG_KEY = 'phc_wfkHziMastzp8Ca8aAN8am5P7Xp6iWf5oRyZzwrZiY4h';

let initialised = false;

export function initPostHog(): void {
  if (import.meta.env.VITE_POSTHOG_DISABLED === 'true') return;
  const apiKey = (import.meta.env.VITE_POSTHOG_API_KEY as string | undefined) ?? POSTHOG_KEY;
  posthog.init(apiKey, {
    api_host: (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://us.i.posthog.com',
    capture_pageview: false, // fired manually on route changes
    persistence: 'localStorage',
  });
  initialised = true;
}

export function capture(event: string, properties?: Record<string, unknown>): void {
  if (!initialised) return;
  try {
    posthog.capture(event, properties);
  } catch { /* never throw on telemetry */ }
}
