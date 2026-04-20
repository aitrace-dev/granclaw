/**
 * takeover-listeners.ts
 *
 * Pluggable listener registry for the takeover-resolved lifecycle event.
 *
 * Why this exists: when an enterprise build needs to run something after
 * the user clicks "Completed" on the takeover page — e.g. upload the
 * Orbita profile's fresh cookies to the GoLogin cloud so the session
 * persists across machines — it should hook in via the extension
 * surface, not patch base routes.
 *
 * Listeners are called fire-and-forget AFTER the takeover row has been
 * cleared and the resume message has been enqueued, so a listener
 * that throws or hangs cannot block the user-facing 200 response.
 */

export type TakeoverResolvedListener = (agentId: string) => void | Promise<void>;

const listeners: TakeoverResolvedListener[] = [];

export function registerTakeoverResolvedListener(fn: TakeoverResolvedListener): void {
  listeners.push(fn);
}

export function clearTakeoverResolvedListeners(): void {
  listeners.length = 0;
}

/**
 * Invoke every registered listener with the resolved agentId.
 * Errors in listeners are logged but never thrown — a flaky listener
 * must not break the resolve response.
 */
export function fireTakeoverResolved(agentId: string): void {
  for (const fn of listeners) {
    try {
      const ret = fn(agentId);
      if (ret && typeof (ret as Promise<void>).then === 'function') {
        (ret as Promise<void>).catch((err) => {
          console.error(`[takeover-listeners] async listener failed for ${agentId}:`, err);
        });
      }
    } catch (err) {
      console.error(`[takeover-listeners] sync listener failed for ${agentId}:`, err);
    }
  }
}
