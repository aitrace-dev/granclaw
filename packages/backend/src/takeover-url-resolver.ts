/**
 * takeover-url-resolver.ts
 *
 * Decide whether the browser is sitting on a URL worth opening a takeover
 * session for. Used by the request_human_browser_takeover tool to refuse
 * creating a link when the only thing the user would see is `about:blank`
 * — the complaint that triggered this module's existence.
 */

/**
 * Non-renderable "inert" URLs that have no useful content for a human
 * takeover. Includes the empty string, about:*, and Chrome-internal schemes.
 */
export function isRealHttpUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (!/^https?:\/\//i.test(trimmed)) return false;
  if (trimmed === 'about:blank') return false;
  return true;
}

export interface ResolveTakeoverUrlOpts {
  /** URL the agent passed via the `url` parameter. Treated as the source of truth when it's http(s). */
  explicitUrl?: string | null;
  /** Best-effort reader of the browser's current URL (agent-browser `get url`). May return null. */
  getBrowserUrl: () => Promise<string | null | undefined>;
}

/**
 * Resolve the URL the takeover session should display.
 *
 * Precedence:
 *   1. `explicitUrl` if it's a real http(s) URL — the agent has stated where to go.
 *   2. Whatever `getBrowserUrl()` returns, if that's a real http(s) URL.
 *   3. null — caller MUST refuse to create the takeover link, to avoid
 *      landing the user on an about:blank page.
 *
 * The reader is wrapped in try/catch; any error from agent-browser is treated
 * as "no URL available" (return null), not a crash.
 */
export async function resolveTakeoverUrl(opts: ResolveTakeoverUrlOpts): Promise<string | null> {
  const { explicitUrl, getBrowserUrl } = opts;

  if (isRealHttpUrl(explicitUrl)) return explicitUrl as string;

  try {
    const browserUrl = await getBrowserUrl();
    if (isRealHttpUrl(browserUrl)) return browserUrl as string;
  } catch {
    /* best effort — fall through to null */
  }
  return null;
}
