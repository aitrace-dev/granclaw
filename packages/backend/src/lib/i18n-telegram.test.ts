import { describe, it, expect } from 'vitest';
import {
  detectLanguage,
  ackText,
  doneText,
  toolLabel,
  moreStepsSuffix,
  type Lang,
} from './i18n-telegram.js';

/**
 * Unit tests for Telegram i18n helpers.
 *
 * These are pure string/regex functions — no network, no state. Tests pin
 * the wire format and language detection heuristics so a later translation
 * tweak can't silently break the live status message or the ack.
 */

describe('detectLanguage', () => {
  it('returns en for plain English', () => {
    expect(detectLanguage('Hello, can you help me with a task?')).toBe('en');
  });

  it('returns en for empty input', () => {
    expect(detectLanguage('')).toBe('en');
  });

  it('returns zh when any CJK ideograph is present', () => {
    expect(detectLanguage('请帮我查一下')).toBe('zh');
    // Single Chinese character mixed with English — Chinese still wins
    expect(detectLanguage('Can you search 网 for me?')).toBe('zh');
  });

  it('returns es for Spanish-only characters', () => {
    expect(detectLanguage('¿Puedes ayudarme?')).toBe('es');
    expect(detectLanguage('mañana por la tarde')).toBe('es');
  });

  it('returns es when a Spanish stopword is present', () => {
    expect(detectLanguage('hola amigo')).toBe('es');
    expect(detectLanguage('gracias por la ayuda')).toBe('es');
    expect(detectLanguage('necesito algo por favor')).toBe('es');
  });

  it('does not false-positive on English containing substrings of Spanish words', () => {
    // "para" is a Spanish stopword but must not match inside other words
    expect(detectLanguage('parachute rental')).toBe('en');
    // "este" appears inside "estate"
    expect(detectLanguage('the estate is large')).toBe('en');
  });

  it('uses the tinyld library for meaningful-length text (longer than the short-phrase set)', () => {
    // Sentences the old hand-rolled regex list never covered — tinyld
    // picks these up because they are statistically unambiguous.
    expect(detectLanguage('me gustaría reservar una cita para el viernes')).toBe('es');
    expect(detectLanguage('how are you doing today my friend')).toBe('en');
  });

  it('falls back to English for unsupported languages tinyld identifies', () => {
    // French and German are real languages tinyld detects but we do not
    // ship localized strings for — the ack path needs a clean fallback.
    expect(detectLanguage('bonjour comment allez-vous aujourd hui')).toBe('en');
    expect(detectLanguage('guten tag wie geht es dir heute')).toBe('en');
  });
});

describe('ackText', () => {
  const cases: [Lang, string][] = [
    ['en', "Got it — give me a moment, I'm working on this."],
    ['es', 'Entendido, dame un momento que estoy trabajando en esto.'],
    ['zh', '收到,请稍等,我正在处理。'],
  ];
  it.each(cases)('returns the fixed ack for %s', (lang, expected) => {
    expect(ackText(lang)).toBe(expected);
  });
});

describe('doneText', () => {
  it('formats an English single-step footer', () => {
    expect(doneText('en', 3.2, 1)).toBe('✓ Done in 3s · 1 step');
  });

  it('pluralizes steps correctly in English', () => {
    expect(doneText('en', 47.9, 5)).toBe('✓ Done in 48s · 5 steps');
  });

  it('pluralizes in Spanish', () => {
    expect(doneText('es', 10, 1)).toBe('✓ Hecho en 10s · 1 paso');
    expect(doneText('es', 10, 3)).toBe('✓ Hecho en 10s · 3 pasos');
  });

  it('formats Chinese without plural variants', () => {
    expect(doneText('zh', 15, 2)).toBe('✓ 完成,用时 15 秒 · 2 步');
  });

  it('clamps sub-second durations to at least 1s', () => {
    expect(doneText('en', 0.4, 1)).toBe('✓ Done in 1s · 1 step');
    expect(doneText('en', 0, 0)).toBe('✓ Done in 1s · 0 steps');
  });
});

describe('toolLabel', () => {
  it('returns the localized label for a known tool', () => {
    expect(toolLabel('en', 'web_search')).toBe('🔍 Searching the web');
    expect(toolLabel('es', 'web_search')).toBe('🔍 Buscando en la web');
    expect(toolLabel('zh', 'web_search')).toBe('🔍 网络搜索');
  });

  it('returns the localized fallback for an unknown tool', () => {
    expect(toolLabel('en', 'mystery_tool')).toBe('⚙️ Using mystery_tool');
    expect(toolLabel('es', 'mystery_tool')).toBe('⚙️ Usando mystery_tool');
    expect(toolLabel('zh', 'mystery_tool')).toBe('⚙️ 使用 mystery_tool');
  });
});

describe('moreStepsSuffix', () => {
  it('pluralizes correctly in each language', () => {
    expect(moreStepsSuffix('en', 1)).toBe('(1 more step)');
    expect(moreStepsSuffix('en', 4)).toBe('(4 more steps)');
    expect(moreStepsSuffix('es', 1)).toBe('(1 paso más)');
    expect(moreStepsSuffix('es', 4)).toBe('(4 pasos más)');
    expect(moreStepsSuffix('zh', 3)).toBe('(还有 3 步)');
  });
});
