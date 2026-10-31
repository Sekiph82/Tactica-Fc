// Fællesskabets server (api/community.ts) mod en lille Redis-attrap i hukommelsen.
import { beforeAll, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();
const H = (k: string) => (store.get(k) as Record<string, unknown>) ?? (store.set(k, {}), store.get(k) as Record<string, unknown>);
const S = (k: string) => (store.get(k) as Set<string>) ?? (store.set(k, new Set()), store.get(k) as Set<string>);
const Z = (k: string) => (store.get(k) as Map<string, number>) ?? (store.set(k, new Map()), store.get(k) as Map<string, number>);
const L = (k: string) => (store.get(k) as string[]) ?? (store.set(k, []), store.get(k) as string[]);

class FakeRedis {
  async hgetall(k: string) { const h = store.get(k) as Record<string, unknown> | undefined; return h && Object.keys(h).length ? { ...h } : null; }
  async hset(k: string, v: Record<string, unknown>) { Object.assign(H(k), v); return 1; }
  async hget(k: string, f: string) { return (store.get(k) as Record<string, unknown> | undefined)?.[f] ?? null; }
  async hincrby(k: string, f: string, n: number) { const h = H(k); h[f] = Number(h[f] ?? 0) + n; return h[f]; }
  async incr(k: string) { const v = Number(store.get(k) ?? 0) + 1; store.set(k, v); return v; }
  async incrby(k: string, n: number) { const v = Number(store.get(k) ?? 0) + n; store.set(k, v); return v; }
  async expire() { return 1; }
  async smembers(k: string) { return [...S(k)]; }
  async sadd(k: string, v: string | number) { const s = S(k); const had = s.has(String(v)); s.add(String(v)); return had ? 0 : 1; }
  async srem(k: string, v: string | number) { return S(k).delete(String(v)) ? 1 : 0; }
  async sismember(k: string, v: string) { return S(k).has(String(v)) ? 1 : 0; }
  async scard(k: string) { return S(k).size; }
  async zadd(k: string, o: { score: number; member: string }) { Z(k).set(o.member, o.score); return 1; }
  async zincrby(k: string, n: number, m: string) { const z = Z(k); z.set(m, (z.get(m) ?? 0) + n); return z.get(m); }
  async zrem(k: string, m: string) { Z(k).delete(m); return 1; }
  async zrange(k: string, a: number, b: number, o?: { rev?: boolean }) { const arr = [...Z(k).entries()].sort((x, y) => (o?.rev ? y[1] - x[1] : x[1] - y[1])).map((x) => x[0]); return arr.slice(a, b + 1); }
  async zunionstore(dest: string, _n: number, keys: string[]) { const out = new Map<string, number>(); for (const k of keys) for (const [m, s] of Z(k)) out.set(m, (out.get(m) ?? 0) + s); store.set(dest, out); return out.size; }
  async lrange(k: string, a: number, b: number) { return L(k).slice(a, b + 1); }
  async rpush(k: string, ...v: string[]) { L(k).push(...v); return L(k).length; }
  async ltrim() { return 'OK'; }
  async lindex(k: string, i: number) { return L(k)[i] ?? null; }
  async lset(k: string, i: number, v: string) { L(k)[i] = v; return 'OK'; }
  async set(k: string, v: unknown, o?: { nx?: boolean }) { if (o?.nx && store.has(k)) return null; store.set(k, v); return 'OK'; }
  async get(k: string) { return store.get(k) ?? null; }
  async del(k: string) { store.delete(k); return 1; }
}
vi.mock('@upstash/redis', () => ({ Redis: FakeRedis }));

const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
let api: typeof import('../api/community');
const post = async (body: Record<string, unknown>, headers: Record<string, string> = {}) => {
  const r = await api.POST(new Request('http://x/api/community', { method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-for': '1.2.3.4', ...headers } }));
  return { status: r.status, body: await r.json() };
};
const get = async (q: string) => (await api.GET(new Request(`http://x/api/community?${q}`))).json();
const me = { pid: 'aaaa1111', token: 'secret-a' }, other = { pid: 'bbbb2222', token: 'secret-b' };

beforeAll(async () => {
  process.env.ADMIN_TOKEN = 'admin-x';
  api = await import('../api/community');
  for (const p of [me, other]) store.set(`prof:${p.pid}`, { name: p.pid.slice(0, 4), th: await sha(p.token), created: '2026-01-01' });
  S(`prof:${me.pid}:careers`).add('career1'); // har spillet en sæson – må stemme
});

describe('fællesskab', () => {
  it('opretter forslag, finder dubletter og kræver en rigtig profil', async () => {
    expect((await post({ op: 'suggest', ...me, token: 'forkert', title: 'Train set pieces', body: 'Let me train set pieces with the squad.' })).status).toBe(401);
    const a = await post({ op: 'suggest', ...me, title: 'Let me train set pieces', body: 'Corners and free kicks training please.', cat: 'gameplay', lang: 'en' });
    expect(a.body.id).toBe(1);
    const sim = await get('similar=' + encodeURIComponent('train set pieces drills'));
    expect(sim.items.map((x: { id: number }) => x.id)).toContain(1);
    expect((await post({ op: 'suggest', ...me, title: 'fuck this game ok', body: 'not nice words at all here' })).body.error).toBe('language');
  });

  it('stemmer kræver en spillet sæson og har et budget på 10', async () => {
    expect((await post({ op: 'vote', ...other, id: 1 })).body.error).toBe('newProfile');
    expect((await post({ op: 'vote', ...me, id: 1 })).body.used).toBe(1);
    expect((await get('list=top')).items[0].votes).toBe(1);
    // (højst 6 forslag i timen pr. IP – derfor skiftende IP-adresser her)
    for (let i = 0; i < 10; i++) await post({ op: 'suggest', ...me, title: `Idea number ${i} for the game`, body: 'A longer description of the idea.' }, { 'x-forwarded-for': `10.0.0.${i}` });
    for (let id = 2; id <= 10; id++) await post({ op: 'vote', ...me, id });
    expect((await post({ op: 'vote', ...me, id: 11 })).body.error).toBe('budget');
    // et udgivet forslag giver stemmen tilbage
    await post({ op: 'admin:status', admin: 'admin-x', id: 2, status: 'released', releasedIn: '0.8.0' });
    expect((await post({ op: 'vote', ...me, id: 11 })).status).toBe(200);
  });

  it('kommentarer, rapportering, roadmap og månedens afstemning', async () => {
    await post({ op: 'comment', ...other, id: 1, text: 'Great idea!' });
    const one = await get('id=1');
    expect(one.comments[0].text).toBe('Great idea!');
    await post({ op: 'admin:status', admin: 'admin-x', id: 3, status: 'planned' });
    expect((await post({ op: 'admin:status', id: 3, status: 'planned' })).status).toBe(401); // ikke admin
    expect((await post({ op: 'admin:poll', admin: 'admin-x', candidates: [1, 3], title: 'Next feature' })).body.ok).toBe(true);
    expect((await post({ op: 'pollVote', ...me, sid: 3 })).body.ok).toBe(true);
    const poll = await get('poll=1&pid=' + me.pid);
    expect(poll.poll.mine).toBe(3);
    expect(poll.poll.items.find((x: { id: number }) => x.id === 3).pollVotes).toBe(1);
    // fem rapporteringer skjuler forslaget
    for (let i = 0; i < 5; i++) { store.set(`prof:ccc${i}cccc`, { name: 'r', th: await sha('t'), created: '' }); await post({ op: 'report', pid: `ccc${i}cccc`, token: 't', id: 4 }); }
    expect((await get('list=new')).items.some((x: { id: number }) => x.id === 4)).toBe(false);
  });
});

describe('donationer', () => {
  let sup: typeof import('../api/support');
  const sign = async (payload: string, secret: string) => {
    const t = Math.floor(Date.now() / 1000);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`));
    return `t=${t},v1=${[...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  };
  const hook = async (ev: unknown, secret = 'whsec_test') => {
    const payload = JSON.stringify(ev);
    const r = await sup.POST(new Request('http://x/api/support?webhook=1', { method: 'POST', body: payload, headers: { 'stripe-signature': await sign(payload, secret) } }));
    return r.status;
  };
  beforeAll(async () => { process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'; sup = await import('../api/support'); });

  it('krediterer kun ægte, betalte betalinger – og kun én gang', async () => {
    const ev = { id: 'evt_1', type: 'checkout.session.completed', data: { object: { payment_status: 'paid', mode: 'payment', amount_total: 3000, metadata: { pid: me.pid } } } };
    expect(await hook(ev, 'forkert-hemmelighed')).toBe(400);
    expect(await hook(ev)).toBe(200);
    expect(await hook(ev)).toBe(200); // samme hændelse igen
    const p = store.get(`prof:${me.pid}`) as Record<string, unknown>;
    expect(p.donated).toBe(3000);
    expect(p.supporter).toBe('silver');
    await hook({ ...ev, id: 'evt_2', data: { object: { ...ev.data.object, amount_total: 3500 } } });
    expect((store.get(`prof:${me.pid}`) as Record<string, unknown>).supporter).toBe('gold');
  });

  it('kun Sølv og Guld kan navngive en regen', async () => {
    const call = (pid: string, token: string) => sup.POST(new Request('http://x/api/support', { method: 'POST', body: JSON.stringify({ op: 'regen', pid, token, first: 'Martin', last: 'Skallerup' }) }));
    expect((await call(other.pid, other.token)).status).toBe(403);
    expect((await call(me.pid, me.token)).status).toBe(200);
    const list = await (await sup.GET(new Request('http://x/api/support?regens=1'))).json();
    expect(list.regens[0].first).toBe('Martin');
  });
});
