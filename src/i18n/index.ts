import { da } from './da';
import { en } from './en';
import { tr } from './tr';
import type { Lang } from '../game/types';
import { nationLabel } from './nations';

const dicts: Record<Lang, Record<string, string>> = { da, en, tr };
const NUMBER_LOCALE: Record<Lang, string> = { en: 'en-GB', da: 'da-DK', tr: 'tr-TR' };
let lang: Lang = (() => {
  try {
    const v = localStorage.getItem('cm0102.lang');
    if (v === 'da' || v === 'en' || v === 'tr') return v;
  } catch { /* ingen storage */ }
  // Türkçe yeni kurulumlar için varsayılan dildir; kayıtlı dil tercihi korunur.
  return 'tr';
})();
try { document.documentElement.lang = lang; } catch { /* ingen DOM */ }

/** Landenavn på det valgte sprog (databasens navne er engelske) */
export function natName(name: string | undefined): string {
  return nationLabel(name, lang);
}

export function getLang(): Lang {
  return lang;
}

export function setLang(l: Lang) {
  lang = l;
  try { document.documentElement.lang = l; } catch { /* ingen DOM */ }
  try { localStorage.setItem('cm0102.lang', l); } catch { /* ignore */ }
}

/** Oversæt nøgle med {param}-erstatning. Ukendte nøgler vises som nøglen selv. */
export function t(key: string, params?: Record<string, string | number | undefined>): string {
  let s = dicts[lang][key] ?? dicts.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.split(`{${k}}`).join(v === undefined ? '' : typeof v === 'number' && (k === 'fee' || k === 'wage' || k === 'balance') ? money(v) : String(v));
    }
  }
  return s;
}

export function has(key: string): boolean {
  return key in dicts[lang] || key in dicts.en;
}

export type Currency = 'EUR' | 'DKK' | 'GBP';
export const CURRENCIES: Currency[] = ['EUR', 'DKK', 'GBP'];
// Faste kurser (spillets interne beløb er i euro)
const RATE: Record<Currency, number> = { EUR: 1, DKK: 7.46, GBP: 0.86 };
let currency: Currency = (() => {
  try {
    const v = localStorage.getItem('cm0102.currency');
    if (v === 'EUR' || v === 'DKK' || v === 'GBP') return v;
  } catch { /* ingen storage */ }
  return lang === 'da' ? 'DKK' : 'EUR';
})();

export function getCurrency(): Currency {
  return currency;
}

/** Locale used for numbers and dates shown in the interface. */
export function getNumberLocale(): string {
  return NUMBER_LOCALE[lang];
}

export function setCurrency(c: Currency) {
  currency = c;
  try { localStorage.setItem('cm0102.currency', c); } catch { /* ignore */ }
}

/** Euro → valgt valuta (til inputfelter) */
export function toCur(eur: number): number {
  return Math.round(eur * RATE[currency]);
}

/** Valgt valuta → euro (med decimaler) */
export function fromCurExact(v: number): number {
  return Math.round((v / RATE[currency]) * 100) / 100;
}

/** Valgt valuta → euro */
export function fromCur(v: number): number {
  return Math.round(v / RATE[currency]);
}

export function currencySymbol(): string {
  return currency === 'DKK' ? 'kr.' : currency === 'GBP' ? '£' : '€';
}

export function money(eur: number): string {
  const v = eur * RATE[currency];
  const neg = v < 0;
  const a = Math.abs(v);
  const da = lang === 'da';
  const loc = getNumberLocale();
  const dec = (n: number, d: number) => n.toLocaleString(loc, { minimumFractionDigits: d, maximumFractionDigits: d });
  let num: string;
  let unit = '';
  if (a >= 1_000_000_000) { num = dec(a / 1_000_000_000, 2); unit = da ? ' mia.' : lang === 'tr' ? ' mlr' : 'bn'; }
  else if (a >= 1_000_000) { num = dec(a / 1_000_000, a >= 10_000_000 ? 1 : 2); unit = da ? ' mio.' : lang === 'tr' ? ' mn' : 'M'; }
  else if (a >= 100_000) { num = dec(Math.round(a / 1000), 0); unit = da ? ' t.' : lang === 'tr' ? ' bin' : 'K'; }
  else num = dec(currency === 'EUR' ? Math.round(a) : Math.round(a / 10) * 10, 0);
  let s: string;
  if (currency === 'DKK') s = `${num}${unit} kr.`;
  else s = `${currencySymbol()}${num}${unit}`;
  return (neg ? '-' : '') + s;
}

export function dateFmt(iso: string, long = false): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString(getNumberLocale(), { day: 'numeric', month: long ? 'long' : 'short', year: 'numeric', weekday: long ? 'short' : undefined, timeZone: 'UTC' });
}
