// Donationer via Stripe Checkout (engangsbeløb eller månedligt) + supporterstatus på managerprofilen.
// Kræver STRIPE_SECRET_KEY og STRIPE_WEBHOOK_SECRET. Uden dem svarer endpointet { enabled: false }.
// Stripe kaldes direkte via REST (ingen SDK). Webhooken bekræftes med HMAC-SHA256 som i Stripes dokumentation.
import { Redis } from '@upstash/redis';

const redis = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const enabled = () => !!process.env.STRIPE_SECRET_KEY;
const CURRENCY = (process.env.SUPPORT_CURRENCY ?? 'eur').toLowerCase();

/** Niveauer efter samlet bidrag (i mindste enhed, fx cent) */
export const TIERS: [string, number][] = [['gold', 6000], ['silver', 2500], ['bronze', 500]];
const tierFor = (total: number) => TIERS.find(([, min]) => total >= min)?.[0] ?? null;

async function sha(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function auth(pid: string, token: string) {
  if (!/^[a-f0-9]{8,32}$/.test(pid)) return null;
  const prof = await redis.hgetall<{ name: string; th: string }>(`prof:${pid}`);
  return prof?.th && prof.th === (await sha(String(token))) ? prof : null;
}

async function stripe(path: string, form: Record<string, string>) {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  return { ok: r.ok, body: await r.json() };
}

/** Bekræft at webhooken kommer fra Stripe (Stripe-Signature: t=…,v1=…) */
async function verify(payload: string, header: string | null): Promise<boolean> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(',').map((x) => x.split('=') as [string, string]));
  const t = parts.t, sig = header.split(',').filter((x) => x.startsWith('v1=')).map((x) => x.slice(3));
  if (!t || !sig.length || Math.abs(Date.now() / 1000 - Number(t)) > 600) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return sig.includes(hex);
}

/** Registrér et bidrag på profilen og opdater niveau og bidragslisten */
async function credit(pid: string, amount: number, monthly: boolean) {
  const total = await redis.hincrby(`prof:${pid}`, 'donated', amount);
  const tier = tierFor(total);
  const fields: Record<string, string | number> = { lastDonation: new Date().toISOString() };
  if (tier) fields.supporter = tier;
  if (monthly) fields.monthly = 1;
  await redis.hset(`prof:${pid}`, fields);
  await redis.zadd('supporters', { score: total, member: pid });
  // månedens bidrag (til gennemsigtighedsmålet)
  const month = new Date().toISOString().slice(0, 7);
  await redis.incrby(`support:month:${month}`, amount);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get('supporters')) {
    // offentlig liste (navne og niveau – aldrig beløb)
    const ids = (await redis.zrange<string[]>('supporters', 0, 499, { rev: true })) ?? [];
    const rows = await Promise.all(ids.map(async (pid) => {
      const p = await redis.hgetall<Record<string, string>>(`prof:${pid}`);
      return p?.name ? { pid, name: p.name, tier: p.supporter ?? null, monthly: !!p.monthly, regen: p.regenName ?? null } : null;
    }));
    const month = new Date().toISOString().slice(0, 7);
    const raised = Number((await redis.get(`support:month:${month}`)) ?? 0);
    const goal = Number(process.env.SUPPORT_MONTHLY_GOAL ?? 5000);
    return json({ enabled: enabled(), currency: CURRENCY, supporters: rows.filter(Boolean), month: { raised, goal } });
  }
  if (url.searchParams.get('regens')) {
    const all = (await redis.hgetall<Record<string, string | { first: string; last: string; tier: string }>>('regens')) ?? {};
    const list = Object.entries(all).map(([pid, v]) => ({ by: pid, ...(typeof v === 'string' ? JSON.parse(v) : v) }));
    const names = await Promise.all(list.map(async (x) => ({ first: x.first, last: x.last, by: (await redis.hget<string>(`prof:${x.by}`, 'name')) ?? '' })));
    return json({ regens: names });
  }
  const pid = (url.searchParams.get('pid') ?? '').replace(/[^a-f0-9]/g, '');
  if (pid) {
    const p = await redis.hgetall<Record<string, string>>(`prof:${pid}`);
    return json({ enabled: enabled(), tier: p?.supporter ?? null, donated: Number(p?.donated ?? 0), monthly: !!p?.monthly, regen: p?.regenName ?? null, beta: p?.beta === '1' });
  }
  return json({ enabled: enabled(), currency: CURRENCY });
}

export async function POST(request: Request) {
  // Stripe-webhook (rå tekst – signaturen gælder de præcise bytes)
  if (new URL(request.url).searchParams.get('webhook')) {
    const payload = await request.text();
    if (!(await verify(payload, request.headers.get('stripe-signature')))) return json({ error: 'signature' }, 400);
    const ev = JSON.parse(payload) as { id: string; type: string; data: { object: Record<string, unknown> } };
    // hver hændelse tælles kun én gang
    if (!(await redis.set(`stripe:ev:${ev.id}`, '1', { nx: true, ex: 60 * 60 * 24 * 30 }))) return json({ ok: true, duplicate: true });
    const o = ev.data.object;
    if (ev.type === 'checkout.session.completed' && o.payment_status === 'paid') {
      const pid = String((o.metadata as Record<string, string> | undefined)?.pid ?? o.client_reference_id ?? '');
      if (pid) await credit(pid, Number(o.amount_total ?? 0), o.mode === 'subscription');
    } else if (ev.type === 'invoice.paid' && o.billing_reason === 'subscription_cycle') {
      // månedligt bidrag: hver ny måned tæller med
      const sub = String(o.subscription ?? '');
      const pid = sub ? await redis.get<string>(`stripe:sub:${sub}`) : null;
      if (pid) await credit(pid, Number(o.amount_paid ?? 0), true);
    } else if (ev.type === 'customer.subscription.deleted') {
      const pid = await redis.get<string>(`stripe:sub:${String(o.id)}`);
      if (pid) await redis.hset(`prof:${pid}`, { monthly: 0 });
    }
    if (ev.type === 'checkout.session.completed' && o.mode === 'subscription' && o.subscription) {
      const pid = String((o.metadata as Record<string, string> | undefined)?.pid ?? o.client_reference_id ?? '');
      if (pid) await redis.set(`stripe:sub:${String(o.subscription)}`, pid);
    }
    return json({ ok: true });
  }

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: 'json' }, 400); }
  const pid = String(body.pid ?? '');
  const prof = await auth(pid, String(body.token ?? ''));
  if (!prof) return json({ error: 'auth' }, 401);

  // start en betaling
  if (body.op === 'checkout') {
    if (!enabled()) return json({ error: 'disabled' }, 503);
    const amount = Math.round(Number(body.amount));
    if (!Number.isFinite(amount) || amount < 300 || amount > 50_000) return json({ error: 'amount' }, 400);
    const monthly = !!body.monthly;
    const back = String(body.returnUrl ?? '').startsWith('http') ? String(body.returnUrl) : 'https://cm0102-reborn.vercel.app/';
    const form: Record<string, string> = {
      mode: monthly ? 'subscription' : 'payment',
      success_url: `${back}${back.includes('?') ? '&' : '?'}support=thanks`,
      cancel_url: back,
      client_reference_id: pid,
      'metadata[pid]': pid,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': CURRENCY,
      'line_items[0][price_data][unit_amount]': String(amount),
      'line_items[0][price_data][product_data][name]': monthly ? 'CM Reborn – monthly support' : 'CM Reborn – support',
    };
    if (monthly) { form['line_items[0][price_data][recurring][interval]'] = 'month'; form['subscription_data[metadata][pid]'] = pid; }
    else form['payment_intent_data[metadata][pid]'] = pid;
    const r = await stripe('checkout/sessions', form);
    if (!r.ok) return json({ error: 'stripe', detail: r.body?.error?.message }, 502);
    return json({ url: r.body.url });
  }

  // supporterens belønninger: navngiv en regen (Silver og Gold) og tidlig adgang (alle supportere)
  const p = await redis.hgetall<Record<string, string>>(`prof:${pid}`);
  const tier = p?.supporter ?? null;
  if (body.op === 'regen') {
    if (tier !== 'silver' && tier !== 'gold') return json({ error: 'tier' }, 403);
    const first = String(body.first ?? '').replace(/[^\p{L}' -]/gu, '').trim().slice(0, 18);
    const last = String(body.last ?? '').replace(/[^\p{L}' -]/gu, '').trim().slice(0, 22);
    if (first.length < 2 || last.length < 2) return json({ error: 'name' }, 400);
    if (/(fuck|cunt|nigg|hitler|nazi|fisse|kusse|luder|neger)/i.test(first + last)) return json({ error: 'language' }, 400);
    await redis.hset(`prof:${pid}`, { regenName: `${first} ${last}` });
    await redis.hset('regens', { [pid]: JSON.stringify({ first, last, tier }) });
    return json({ ok: true });
  }
  if (body.op === 'beta') {
    if (!tier) return json({ error: 'tier' }, 403);
    await redis.hset(`prof:${pid}`, { beta: body.on ? '1' : '0' });
    return json({ ok: true });
  }
  return json({ error: 'op' }, 400);
}
