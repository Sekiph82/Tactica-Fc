import { afterEach, describe, expect, it } from 'vitest';
import { dateFmt, getLang, getNumberLocale, money, natName, setLang, t } from '../src/i18n';
import { en } from '../src/i18n/en';
import { tr } from '../src/i18n/tr';

afterEach(() => setLang('en'));

describe('Turkish locale foundation', () => {
  it('uses Turkish by default while keeping English available', () => {
    expect(getLang()).toBe('tr');
    setLang('tr');
    expect(getLang()).toBe('tr');
    expect(t('nav.squad')).toBe('Kadro');
    expect(t('match.camera.focus')).toBe('Topa odaklan');
    setLang('en');
    expect(t('nav.squad')).toBe(en['nav.squad']);
    setLang('tr');
    expect(getNumberLocale()).toBe('tr-TR');
    expect(natName('Türkiye')).toBe('Türkiye');
    expect(dateFmt('2025-01-05')).toContain('5');
    expect(money(1_500_000)).toContain(',');
  });

  it('keeps placeholders aligned with English for every translated key', () => {
    const placeholders = (value: string) => [...value.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort();
    for (const [key, value] of Object.entries(tr)) {
      expect(en[key], `English source key ${key}`).toBeDefined();
      expect(placeholders(value), `placeholder mismatch for ${key}`).toEqual(placeholders(en[key]));
    }
  });

  it('translates every English UI key into Turkish', () => {
    const missing = Object.keys(en).filter((key) => !(key in tr));
    expect(missing).toEqual([]);
  });
});
