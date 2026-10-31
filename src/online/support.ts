// Klient til donationer og supporterbelønninger (api/support.ts).
import { gs, hasGame } from '../game/state';
import { getProfile, rankingAvailable } from './rank';

export type Tier = 'bronze' | 'silver' | 'gold';
export interface MySupport { enabled: boolean; tier: Tier | null; donated: number; monthly: boolean; regen: string | null; beta: boolean }
export interface SupporterList { enabled: boolean; currency: string; supporters: { pid: string; name: string; tier: Tier | null; monthly: boolean; regen: string | null }[]; month: { raised: number; goal: number } }

const KEY = 'cm0102.support';
let cache: MySupport | null = null;
try { cache = JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { /* ignorer */ }

/** Senest kendte supporterstatus (fra cache – opdateres med refreshSupport) */
export const mySupport = () => cache;
export const isSupporter = () => !!cache?.tier;
export const betaOn = () => !!cache?.tier && !!cache?.beta;

export async function refreshSupport(): Promise<MySupport | null> {
  const prof = getProfile();
  if (!prof || !rankingAvailable()) return null;
  try {
    const r = await fetch(`/api/support?pid=${prof.pid}`);
    if (!r.ok) return cache;
    cache = await r.json();
    try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* ignorer */ }
    return cache;
  } catch { return cache; }
}

export async function supporters(): Promise<SupporterList | null> {
  if (!rankingAvailable()) return null;
  try { const r = await fetch('/api/support?supporters=1'); return r.ok ? await r.json() : null; } catch { return null; }
}

async function post(op: string, data: Record<string, unknown>) {
  const prof = getProfile();
  if (!prof) return { error: 'noProfile' };
  try {
    const r = await fetch('/api/support', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op, pid: prof.pid, token: prof.token, ...data }) });
    const j = await r.json();
    return r.ok ? j : { error: String(j.error ?? 'error') };
  } catch { return { error: 'network' }; }
}

/** Start en betaling hos Stripe (beløb i mindste enhed, fx cent) */
export async function checkout(amount: number, monthly: boolean): Promise<string | null> {
  const r = await post('checkout', { amount, monthly, returnUrl: `${location.origin}${location.pathname}` });
  if (r.url) { location.href = r.url; return null; }
  return r.error ?? 'error';
}
export const nameRegen = (first: string, last: string) => post('regen', { first, last });
export const setBeta = (on: boolean) => post('beta', { on });

/** Hent supporternes regen-navne ind i spillet (bruges ved ungdomsdagen) */
export async function syncSupporterRegens() {
  if (!hasGame() || !rankingAvailable()) return;
  try {
    const r = await fetch('/api/support?regens=1');
    if (!r.ok) return;
    const { regens } = (await r.json()) as { regens: { first: string; last: string; by: string }[] };
    const g = gs();
    const have = new Set((g.supporterRegens ?? []).map((x) => `${x.first} ${x.last}`));
    g.supporterRegens = [...(g.supporterRegens ?? []), ...regens.filter((x) => !have.has(`${x.first} ${x.last}`))];
  } catch { /* offline */ }
}
