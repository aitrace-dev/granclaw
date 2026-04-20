import { describe, it, expect, vi } from 'vitest';
import { isRealHttpUrl, resolveTakeoverUrl } from './takeover-url-resolver.js';

/**
 * Tests for the takeover-URL resolver.
 *
 * Context: the `request_human_browser_takeover` tool used to return a link
 * unconditionally. If the browser happened to be at `about:blank` the user
 * would land on a takeover page showing a blank viewport with no way to
 * do anything useful. This resolver is the gate that refuses link creation
 * until a real http(s) page is loaded.
 */

describe('isRealHttpUrl', () => {
  it.each([
    ['https://www.reddit.com/', true],
    ['http://example.com', true],
    ['https://sub.example.co.uk/path?q=1', true],
    ['HTTPS://www.example.com', true], // case-insensitive scheme
  ])('treats %s as real', (url, expected) => {
    expect(isRealHttpUrl(url)).toBe(expected);
  });

  it.each([
    ['about:blank', false],
    ['chrome://newtab/', false],
    ['chrome-extension://abc/popup.html', false],
    ['devtools://devtools/bundled/inspector.html', false],
    ['file:///etc/passwd', false],
    ['javascript:alert(1)', false],
    ['', false],
    ['   ', false],
    [null, false],
    [undefined, false],
  ])('rejects %s as not-real', (url, expected) => {
    expect(isRealHttpUrl(url as string | null | undefined)).toBe(expected);
  });
});

describe('resolveTakeoverUrl', () => {
  it('prefers the agent-supplied explicitUrl when it is real', async () => {
    const getBrowserUrl = vi.fn().mockResolvedValue('https://other.example.com');
    const url = await resolveTakeoverUrl({
      explicitUrl: 'https://www.reddit.com/r/programming',
      getBrowserUrl,
    });
    expect(url).toBe('https://www.reddit.com/r/programming');
    // When the explicit URL is usable the reader must not be invoked —
    // avoids a wasted subprocess call to agent-browser.
    expect(getBrowserUrl).not.toHaveBeenCalled();
  });

  it('falls back to the browser URL when explicitUrl is missing', async () => {
    const getBrowserUrl = vi.fn().mockResolvedValue('https://www.reddit.com/');
    const url = await resolveTakeoverUrl({ getBrowserUrl });
    expect(url).toBe('https://www.reddit.com/');
    expect(getBrowserUrl).toHaveBeenCalledOnce();
  });

  it('falls back to the browser URL when explicitUrl is about:blank', async () => {
    const getBrowserUrl = vi.fn().mockResolvedValue('https://www.reddit.com/');
    const url = await resolveTakeoverUrl({
      explicitUrl: 'about:blank',
      getBrowserUrl,
    });
    expect(url).toBe('https://www.reddit.com/');
  });

  it('returns null when both explicit and browser URL are about:blank', async () => {
    const getBrowserUrl = vi.fn().mockResolvedValue('about:blank');
    const url = await resolveTakeoverUrl({ getBrowserUrl });
    expect(url).toBeNull();
  });

  it('returns null when both explicit and browser URL are missing', async () => {
    const getBrowserUrl = vi.fn().mockResolvedValue(null);
    const url = await resolveTakeoverUrl({ getBrowserUrl });
    expect(url).toBeNull();
  });

  it('returns null when the browser reader throws', async () => {
    const getBrowserUrl = vi.fn().mockRejectedValue(new Error('agent-browser timeout'));
    const url = await resolveTakeoverUrl({ getBrowserUrl });
    expect(url).toBeNull();
  });

  it('rejects a chrome:// scheme from both sources', async () => {
    const getBrowserUrl = vi.fn().mockResolvedValue('chrome://newtab/');
    const url = await resolveTakeoverUrl({
      explicitUrl: 'chrome-extension://abc/popup.html',
      getBrowserUrl,
    });
    expect(url).toBeNull();
  });

  it('rejects a javascript: URL from the agent (XSS guard)', async () => {
    // Even if the agent tries to pass javascript:alert(1) it must never
    // reach the takeover page or the frontend as a "real" URL.
    const getBrowserUrl = vi.fn().mockResolvedValue(null);
    const url = await resolveTakeoverUrl({
      explicitUrl: 'javascript:alert(1)',
      getBrowserUrl,
    });
    expect(url).toBeNull();
  });
});
