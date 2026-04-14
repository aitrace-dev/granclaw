// packages/backend/src/telemetry.ts
//
// Fire-and-forget telemetry for the GranClaw backend.
// The PostHog project key is bundled so no env-var setup is required.
// Set POSTHOG_DISABLED=true to opt out entirely.

import { PostHog } from 'posthog-node';

const POSTHOG_KEY = 'phc_wfkHziMastzp8Ca8aAN8am5P7Xp6iWf5oRyZzwrZiY4h';

let client: PostHog | null = null;

export function initTelemetry(): void {
  if (process.env.POSTHOG_DISABLED === 'true') return;
  const apiKey = process.env.POSTHOG_API_KEY ?? POSTHOG_KEY;
  client = new PostHog(apiKey, {
    host: process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com',
    flushAt: 20,
    flushInterval: 10_000,
  });
}

export function capture(event: string, properties?: Record<string, unknown>): void {
  if (!client) return;
  const distinctId = process.env.GRANCLAW_INSTALL_ID ?? 'unknown';
  try {
    client.capture({ distinctId, event, properties });
  } catch { /* never throw on telemetry */ }
}

export async function shutdownTelemetry(): Promise<void> {
  await client?.shutdown();
}
