// packages/cli/src/telemetry.ts
//
// Fire-and-forget telemetry for the GranClaw CLI.
// The PostHog project key is bundled so no env-var setup is required.
// Set POSTHOG_DISABLED=true to opt out entirely.

// posthog-node v4 ships a CJS bundle; require() works in our CJS CLI build.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PostHog } = require('posthog-node') as typeof import('posthog-node');

const POSTHOG_KEY = 'phc_wfkHziMastzp8Ca8aAN8am5P7Xp6iWf5oRyZzwrZiY4h';

let client: InstanceType<typeof PostHog> | null = null;
let _installId = 'unknown';

export function initCliTelemetry(installId: string): void {
  _installId = installId;
  if (process.env.POSTHOG_DISABLED === 'true') return;
  const apiKey = process.env.POSTHOG_API_KEY ?? POSTHOG_KEY;
  client = new PostHog(apiKey, {
    host: process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com',
    flushAt: 1,
    flushInterval: 0,
  });
}

export function captureCliEvent(event: string, properties?: Record<string, unknown>): void {
  if (!client) return;
  client.capture({ distinctId: _installId, event, properties });
  // Flush immediately — the CLI process is short-lived.
  void client.shutdown();
}

export function getInstallId(): string {
  return _installId;
}
