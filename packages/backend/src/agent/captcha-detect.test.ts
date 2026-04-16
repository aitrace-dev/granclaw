/**
 * captcha-detect.test.ts — unit coverage for the browser-eval CAPTCHA detector.
 *
 * CAPTCHA_DETECT_JS is a stringified IIFE that runs inside agent-browser via
 * `agent-browser eval`. We test it here by injecting a fake `document` into
 * a `new Function` sandbox so we can assert the matcher's behaviour against
 * the concrete real-world pages that caused regressions in production.
 */

import { describe, it, expect } from 'vitest';
import { CAPTCHA_DETECT_JS } from './captcha-detect.js';

type FakeDoc = {
  title: string;
  querySelector: (selector: string) => unknown;
};

function detect(doc: FakeDoc): 'captcha' | 'interstitial' | 'clear' {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const fn = new Function('document', 'return ' + CAPTCHA_DETECT_JS);
  return fn(doc) as 'captcha' | 'interstitial' | 'clear';
}

const noMatch = (_: string) => null;
const matchOn = (needles: string[]) => (selector: string) =>
  needles.some((n) => selector.includes(n)) ? {} : null;

describe('CAPTCHA_DETECT_JS', () => {
  it('flags Cloudflare "Just a moment..." interstitial by title', () => {
    expect(detect({ title: 'Just a moment...', querySelector: noMatch })).toBe('interstitial');
  });

  it('flags localised Cloudflare interstitials', () => {
    expect(detect({ title: 'Un momento...', querySelector: noMatch })).toBe('interstitial');
    expect(detect({ title: 'Checking your browser before accessing', querySelector: noMatch })).toBe('interstitial');
  });

  it('flags "Attention Required" as captcha (WAF block, needs human)', () => {
    expect(detect({ title: 'Attention Required! | Cloudflare', querySelector: noMatch })).toBe('captcha');
  });

  it('flags Cloudflare managed-challenge DOM markers as interstitial', () => {
    expect(detect({ title: '', querySelector: matchOn(['#challenge-stage']) })).toBe('interstitial');
    expect(detect({ title: '', querySelector: matchOn(['#challenge-running']) })).toBe('interstitial');
    expect(detect({ title: '', querySelector: matchOn(['.cf-browser-verification']) })).toBe('interstitial');
  });

  it('flags actual captcha widget families', () => {
    expect(detect({ title: '', querySelector: matchOn(['iframe[src*="recaptcha"]']) })).toBe('captcha');
    expect(detect({ title: '', querySelector: matchOn(['iframe[src*="hcaptcha"]']) })).toBe('captcha');
    expect(detect({ title: '', querySelector: matchOn(['iframe[src*="challenges.cloudflare"]']) })).toBe('captcha');
    expect(detect({ title: '', querySelector: matchOn(['iframe[src*="captcha-delivery"]']) })).toBe('captcha');
    expect(detect({ title: '', querySelector: matchOn(['.g-recaptcha']) })).toBe('captcha');
    expect(detect({ title: '', querySelector: matchOn(['.h-captcha']) })).toBe('captcha');
  });

  it('flags PerimeterX / HUMAN bot check widgets', () => {
    expect(detect({ title: '', querySelector: matchOn(['#px-captcha']) })).toBe('captcha');
  });

  it('flags Arkose / FunCaptcha iframes', () => {
    expect(detect({ title: '', querySelector: matchOn(['iframe[src*="arkoselabs"]']) })).toBe('captcha');
    expect(detect({ title: '', querySelector: matchOn(['iframe[src*="funcaptcha"]']) })).toBe('captcha');
  });

  it('returns "clear" for an unchallenged page', () => {
    expect(detect({ title: 'IP Tracker & Tracer', querySelector: noMatch })).toBe('clear');
  });

  it('is case-insensitive on title matches', () => {
    expect(detect({ title: 'JUST A MOMENT...', querySelector: noMatch })).toBe('interstitial');
    expect(detect({ title: 'just a moment...', querySelector: noMatch })).toBe('interstitial');
  });
});
