// Draft-ligaens server (api/mp.ts) mod en lille Redis-attrap i hukommelsen.
import { beforeAll, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();
const H = (k: string) => (store.get(k) as Record<string, unknown>) ?? (store.set(k, {}), store.get(k) as Record<string, unknown>);
const S = (k: string) => (store.get(k) as Set<string>) ?? (store.set(k, new Set()), store.get(k) as Set<string>);
const L = (k: string) => (store.get(k) as string[]) ?? (store.set(k, []), store.get(k) as string[]);
const sl = (arr: string[], a: number, b: number) => { const n = arr.length; const s = a < 0 ? Math.max(0, n + a) : a; const e = b < 0 ? n + b : b; return arr.slice(s, e + 1); };

const auto = (v: unknown) => { if (typeof v !== 'string' || !/^[[{]/.test(v)) return v; try { return JSON.parse(v); } catch { return v; } };
class FakeRedis {
  // som Upstash: JSON-tekst pakkes ud automatisk
  async hgetall(k: string) { const h = store.get(k) as Record<string, unknown> | undefined; return h && Object.keys(h).length ? Object.fromEntries(Object.entries(h).map(([f, v]) => [f, auto(v)])) : null; }
  async hset(k: string, v: Record<string, unknown>) { Object.assign(H(k), v); return 1; }
  async hsetnx(k: string, f: string, v: unknown) { const h = H(k); if (f in h) return 0; h[f] = v; return 1; }
  async hget(k: string, f: string) { return (store.get(k) as Record<string, unknown> | undefined)?.[f] ?? null; }
  async hdel(k: string, f: string) { delete H(k)[f]; return 1; }
  async incr(k: string) { const v = Number(store.get(k) ?? 0) + 1; store.set(k, v); return v; }
  async expire() { return 1; }
  async sadd(k: string, v: string) { S(k).add(String(v)); return 1; }
  async sismember(k: string, v: string) { return S(k).has(String(v)) ? 1 : 0; }
  async lrange(k: string, a: number, b: number) { return sl(L(k), a, b); }
  async llen(k: string) { return L(k).length; }
  async rpush(k: string, ...v: string[]) { L(k).push(...v); return L(k).length; }
  async ltrim() { return 'OK'; }
  async set(k: string, v: unknown, o?: { nx?: boolean; ex?: number; px?: number }) { if (o?.nx && store.has(k)) return null; store.set(k, v); return 'OK'; }
  async get(k: string) { return store.get(k) ?? null; }
  async del(...ks: string[]) { for (const k of ks) store.delete(k); return 1; }
}
vi.mock('@upstash/redis', () => ({ Redis: FakeRedis }));
vi.mock('@vercel/blob', () => ({ del: async () => {} }));
vi.mock('@vercel/blob/client', () => ({ handleUpload: async () => ({}) }));

let api: typeof import('../api/mp');
const post = async (op: string, body: Record<string, unknown>) => {
  const r = await api.POST(new Request(`http://x/api/mp?op=${op}`, { method: 'POST', body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
};
beforeAll(async () => { api = await import('../api/mp'); });

describe('draft-liga (server)', () => {
  it('lobby, draft med tur og tidsfrist, opbygning og ny sæson med keepers', async () => {
    const host = (await post('create', { name: 'Anna', settings: { mode: 'draft', seed: 1, draft: { rounds: 1, playoff: 'none', keepers: 1, injuries: true } }, team: { name: 'Anna FC', short: 'ann', colors: ['#ff0000', '#ffffff'], formation: '4-3-3' } })).body;
    const A = { code: host.code, pid: host.pid, token: host.token };
    const bo = (await post('join', { code: host.code, name: 'Bo', team: { name: 'Bo United', short: 'BOU' } })).body;
    const B = { code: host.code, pid: bo.pid, token: bo.token };
    expect((await post('dai', { ...B })).status).toBe(403); // kun værten
    let room = (await post('dai', { ...A, team: { name: 'Robots' } })).body;
    expect(room.draft.teams).toHaveLength(3);
    expect(room.draft.teams[0].short).toBe('ANN');
    // indstillinger kan ændres i lobbyen (rigtig Upstash leverer dem som objekt)
    room = (await post('dsettings', { ...A, draft: { rounds: 3, playoff: 'semis' } })).body;
    expect(room.settings.draft.rounds).toBe(3);
    room = (await post('dsettings', { ...A, draft: { rounds: 1, playoff: 'none' } })).body;
    expect(room.settings.draft).toMatchObject({ rounds: 1, playoff: 'none', keepers: 1 });
    expect((await post('dstart', { ...B })).status).toBe(403);
    room = (await post('dstart', { ...A })).body;
    expect(room.draft.phase).toBe('draft');
    const order: number[] = room.draft.order;
    const cred = (slot: number) => (slot === 1 ? A : slot === 2 ? B : A);
    // forkert manager må ikke vælge for en anden (før tiden er gået)
    const first = order[0];
    const wrong = first === 1 ? B : A;
    if (first !== 3) expect((await post('dpick', { ...wrong, n: 0, player: 1, place: 0 })).body.error).toBe('not-your-turn');
    let pid = 1000;
    for (let n = 0; n < 48; n++) {
      const slot = n % 6 < 3 ? order[n % 3] : order[2 - (n % 3)];
      const before = room.draft.pickStart;
      await new Promise((res) => setTimeout(res, 2));
      const r = await post('dpick', { ...cred(slot), n, player: pid++, place: n < 33 ? Math.floor(n / 3) : -1 });
      expect(r.status).toBe(200);
      // nedtællingen starter forfra efter hvert valg
      if (n < 47) expect(r.body.draft.pickStart).toBeGreaterThan(before);
      if (n === 0) {
        // samme valgnummer igen afvises, og samme spiller kan ikke tages to gange
        expect((await post('dpick', { ...A, n: 0, player: 5, place: 1 })).body.error).toBe('stale');
        expect((await post('dpick', { ...cred(order[1]), n: 1, player: 1000, place: 1 })).body.error).toBe('taken');
      }
      room = r.body;
    }
    expect(room.draft.phase).toBe('done');
    expect(room.draft.picks).toHaveLength(48);
    expect((await post('dbuildlock', { ...A })).body.ok).toBe(true);
    expect((await post('dbuildlock', { ...B })).body.ok).toBe(false);
    expect((await post('dbuilt', { ...B, url: 'https://x.blob.vercel-storage.com/a' })).body.error).toBe('no-lock');
    room = (await post('dbuilt', { ...A, url: 'https://x.blob.vercel-storage.com/a', date: '2025-08-02' })).body;
    expect(room.draft.phase).toBe('playing');
    expect(room.status).toBe('playing');
    expect(room.version).toBe(1);
    // sæsonen slut: ny draft med keepers-fase
    expect((await post('dseason', { ...B, season: 1, order: [1, 2] })).body.error).toBe('order');
    room = (await post('dseason', { ...B, season: 1, order: [3, 2, 1] })).body;
    // først sæsonafslutningen: næste fase starter, når alle har klikket videre
    expect(room.draft.phase).toBe('summary');
    room = (await post('dnext', { ...A })).body;
    expect(room.draft.phase).toBe('summary');
    room = (await post('dnext', { ...B })).body;
    expect(room.draft.phase).toBe('keepers');
    expect(room.draft.season).toBe(2);
    expect((await post('dseason', { ...A, season: 1, order: [3, 2, 1] })).status).toBe(409);
    await post('dteam', { ...A, team: { keep: [{ player: 1000, place: 0 }], keepReady: true } });
    expect((await post('dkeepdone', { ...A })).body.error).toBe('too-early');
    await post('dteam', { ...B, team: { keep: [{ player: 1001, place: 0 }], keepReady: true } });
    room = (await post('dkeepdone', { ...A, keeps: { 3: [{ player: 1002, place: 0 }] } })).body;
    expect(room.draft.phase).toBe('draft');
    expect(room.draft.teams.find((t: { slot: number }) => t.slot === 3).keep[0].player).toBe(1002);
    // en keeper kan ikke draftes af andre; 15 valg pr. hold
    expect((await post('dpick', { ...cred(3), n: 0, player: 1000, place: 1 })).body.error).toBe('taken');
    for (let n = 0; n < 45; n++) {
      const slot = [3, 2, 1, 1, 2, 3][n % 6];
      room = (await post('dpick', { ...cred(slot), n, player: 5000 + n, place: -1 })).body;
    }
    expect(room.draft.phase).toBe('done');
  });
});

describe('auktionsdraft (server)', () => {
  it('nominering, bud, forlængelse, vinder og budget', async () => {
    const host = (await post('create', { name: 'Ann', settings: { mode: 'draft', seed: 2, draft: { rounds: 1, playoff: 'none', keepers: 0, injuries: true, format: 'auction' } }, team: { name: 'Ann FC', short: 'ANF' } })).body;
    const A = { code: host.code, pid: host.pid, token: host.token };
    const bo = (await post('join', { code: host.code, name: 'Bo', team: { name: 'Bo FC', short: 'BOF' } })).body;
    const B = { code: host.code, pid: bo.pid, token: bo.token };
    let room = (await post('dstart', { ...A })).body;
    expect(room.draft.teams.every((t: { budget: number }) => t.budget === 200)).toBe(true);
    const first = room.draft.order[room.draft.nomIdx];
    const N = first === 1 ? A : B, O = first === 1 ? B : A;
    // kun nominatoren må nominere, og man kan ikke byde over sit budget (1 mio. pr. ledig plads)
    expect((await post('dnominate', { ...O, player: 7, bid: 5 })).body.error).toBe('not-your-turn');
    expect((await post('dnominate', { ...N, player: 7, bid: 190 })).body.error).toBe('bid');
    room = (await post('dnominate', { ...N, player: 7, bid: 10 })).body;
    expect(room.draft.auction).toMatchObject({ player: 7, bid: 10 });
    expect((await post('dbid', { ...N, id: 0, amount: 12 })).body.error).toBe('leading');
    expect((await post('dbid', { ...O, id: 0, amount: 10 })).body.error).toBe('bid');
    room = (await post('dbid', { ...O, id: 0, amount: 15 })).body;
    expect(room.draft.auction.bid).toBe(15);
    expect((await post('dresolve', { ...A, place: 0 })).body.error).toBe('too-early');
    // nominatoren melder pas: kan ikke byde mere, og da alle andre mennesker er ude, slutter auktionen om få sekunder
    expect((await post('dpass', { ...O, id: 0 })).body.error).toBe('leading');
    room = (await post('dpass', { ...N, id: 0 })).body;
    expect(room.draft.auction.passed).toContain(first);
    expect(room.draft.auction.endsAt - Date.now()).toBeLessThanOrEqual(3600);
    expect((await post('dbid', { ...N, id: 0, amount: 20 })).body.error).toBe('passed');
    // tiden løber ud
    const st = store.get(`room:${host.code}:dstate`) as Record<string, unknown>;
    const au = JSON.parse(String(st.auction)); au.endsAt = Date.now() - 1; st.auction = JSON.stringify(au);
    room = (await post('dresolve', { ...A, place: 0 })).body;
    expect(room.draft.picks[0]).toMatchObject({ player: 7, price: 15 });
    expect(room.draft.auction).toBeFalsy();
    const winner = room.draft.teams.find((t: { pid: string }) => t.pid === O.pid);
    expect(winner.budget).toBe(185);
    // næste nominator er den anden manager
    expect(room.draft.order[room.draft.nomIdx]).not.toBe(first);
    expect((await post('dpick', { ...A, n: 1, player: 9, place: 1 })).body.error).toBe('phase');
  });
});
