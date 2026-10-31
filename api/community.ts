// Fællesskabet: forslag, kommentarer, stemmer (med budget), månedens afstemning, fejlrapporter og en roadmap.
// Identitet = ranglisteprofilen (prof:{pid} med hash af et hemmeligt token). Admin-handlinger kræver ADMIN_TOKEN.
import { Redis } from '@upstash/redis';

const redis = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const now = () => new Date().toISOString();
const day = (d = new Date()) => d.toISOString().slice(0, 10);
async function sha(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const STATUSES = ['new', 'considering', 'planned', 'progress', 'released', 'rejected'] as const;
type Status = (typeof STATUSES)[number];
const CATS = ['gameplay', 'match', 'transfers', 'ui', 'bug', 'other'];
/** Stemmebudget: højst så mange aktive stemmer pr. profil (stemmer på udgivne/afviste forslag tæller ikke) */
const VOTE_BUDGET = 10;
/** Skjules automatisk ved så mange rapporteringer */
const HIDE_AT = 5;

const BAD = /(fuck|cunt|nigg|hitler|nazi|fisse|kusse|luder|bøsse|neger|retard|whore|slut)/i;
const clean = (v: unknown, max: number) => String(v ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanBody = (v: unknown, max: number) => String(v ?? '').replace(/[<>]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);

interface Suggestion {
  id: number; title: string; body: string; cat: string; lang: string; pid: string; name: string; created: string;
  status: Status; votes: number; comments: number; reply?: string; releasedIn?: string; hidden?: boolean; reports?: number;
  meta?: string; hasImage?: boolean; mergedInto?: number; supporter?: string;
}

async function auth(pid: string, token: string) {
  if (!/^[a-f0-9]{8,32}$/.test(pid)) return null;
  const prof = await redis.hgetall<{ name: string; th: string; created: string }>(`prof:${pid}`);
  if (!prof?.th || prof.th !== (await sha(String(token)))) return null;
  return prof;
}
const isAdmin = (req: Request, body?: Record<string, unknown>) => {
  const tok = process.env.ADMIN_TOKEN;
  return !!tok && (req.headers.get('x-admin-token') === tok || body?.admin === tok);
};

/** Supporterniveau pr. profil (kort cache pr. kald) */
const tierCache = new Map<string, string | null>();
async function tierOf(pid: string): Promise<string | null> {
  if (!tierCache.has(pid)) tierCache.set(pid, (await redis.hget<string>(`prof:${pid}`, 'supporter')) ?? null);
  return tierCache.get(pid) ?? null;
}

async function getSug(id: number): Promise<Suggestion | null> {
  const s = await redis.hgetall<Record<string, unknown>>(`sg:${id}`);
  if (!s?.id) return null;
  return { ...(s as unknown as Suggestion), supporter: (await tierOf(String(s.pid))) ?? undefined, id: Number(s.id), votes: Number(s.votes ?? 0), comments: Number(s.comments ?? 0), reports: Number(s.reports ?? 0), hidden: s.hidden === true || s.hidden === 'true', hasImage: s.hasImage === true || s.hasImage === 'true', mergedInto: s.mergedInto ? Number(s.mergedInto) : undefined };
}

/** Hvor mange aktive stemmer har profilen brugt? */
async function activeVotes(pid: string): Promise<number> {
  const ids = (await redis.smembers(`prof:${pid}:sgvotes`)) as string[];
  if (!ids.length) return 0;
  const st = await Promise.all(ids.map((id) => redis.hget<string>(`sg:${id}`, 'status')));
  return st.filter((s) => s !== 'released' && s !== 'rejected').length;
}

/** Må profilen stemme? Kræver at man har spillet mindst én sæson (indsendt til ranglisterne) */
async function canVote(pid: string) {
  return (await redis.scard(`prof:${pid}:careers`)) > 0;
}

const words = (s: string) => new Set(s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]/gu, ' ').split(' ').filter((w) => w.length >= 3));
function similarity(a: Set<string>, b: Set<string>) {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / Math.max(1, Math.min(a.size, b.size));
}

async function rateLimit(req: Request, key: string, max: number, seconds: number) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const k = `cm:rl:${key}:${ip}:${Math.floor(Date.now() / 1000 / seconds)}`;
  const n = await redis.incr(k);
  if (n === 1) await redis.expire(k, seconds * 2);
  return { ok: n <= max, ip };
}

// ---------- GET ----------

export async function GET(request: Request) {
  tierCache.clear();
  const url = new URL(request.url);
  const me = (url.searchParams.get('pid') ?? '').replace(/[^a-f0-9]/g, '');
  const admin = isAdmin(request);

  // ét forslag med kommentarer
  const one = Number(url.searchParams.get('id'));
  if (one) {
    const s = await getSug(one);
    if (!s || (s.hidden && !admin)) return json({ error: 'not-found' }, 404);
    const raw = (await redis.lrange<string | Record<string, unknown>>(`sg:${one}:comments`, 0, 199)) ?? [];
    const parsed = raw.map((c, i) => ({ i, ...(typeof c === 'string' ? JSON.parse(c) : c) })).filter((c) => admin || !c.hidden);
    const comments = await Promise.all(parsed.map(async (c) => ({ ...c, supporter: c.pid ? (await tierOf(String(c.pid))) ?? undefined : undefined })));
    const image = s.hasImage ? await redis.get<string>(`sg:${one}:img`) : null;
    const voted = me ? !!(await redis.sismember(`sg:${one}:voters`, me)) : false;
    return json({ suggestion: s, comments, image, voted });
  }

  // lignende forslag (dubletkontrol mens man skriver)
  const sim = url.searchParams.get('similar');
  if (sim) {
    const w = words(sim);
    if (w.size === 0) return json({ items: [] });
    const titles = (await redis.hgetall<Record<string, string>>('sg:titles')) ?? {};
    const scored = Object.entries(titles).map(([id, title]) => ({ id: Number(id), title, s: similarity(w, words(title)) })).filter((x) => x.s >= 0.5).sort((a, b) => b.s - a.s).slice(0, 5);
    const items = (await Promise.all(scored.map((x) => getSug(x.id)))).filter((x): x is Suggestion => !!x && !x.hidden);
    return json({ items });
  }

  // månedens afstemning
  if (url.searchParams.get('poll')) {
    const poll = await redis.hgetall<Record<string, string>>('poll:current');
    if (!poll?.id) return json({ poll: null });
    const ids = JSON.parse(poll.candidates ?? '[]') as number[];
    const counts = (await redis.hgetall<Record<string, string>>(`poll:${poll.id}:count`)) ?? {};
    const items = (await Promise.all(ids.map((id) => getSug(id)))).filter(Boolean) as Suggestion[];
    const mine = me ? await redis.hget<string>(`poll:${poll.id}:votes`, me) : null;
    return json({ poll: { id: poll.id, title: poll.title, ends: poll.ends, items: items.map((s) => ({ ...s, pollVotes: Number(counts[s.id] ?? 0) })), mine: mine ? Number(mine) : null } });
  }

  // min status: stemmer brugt og om man må stemme
  if (url.searchParams.get('me') && me) {
    return json({ used: await activeVotes(me), budget: VOTE_BUDGET, canVote: await canVote(me) });
  }

  // admin: mistænkelige stemmemønstre
  if (url.searchParams.get('suspicious') && admin) {
    const ids = (await redis.zrange<string[]>('sg:top', 0, 99, { rev: true })) ?? [];
    const out: { id: number; ip: string; n: number }[] = [];
    for (const id of ids) {
      const ips = (await redis.hgetall<Record<string, string>>(`sg:${id}:ips`)) ?? {};
      for (const [ip, n] of Object.entries(ips)) if (Number(n) >= 3) out.push({ id: Number(id), ip, n: Number(n) });
    }
    return json({ items: out });
  }

  // listen: nyeste, mest populære, trending (stemmer de seneste 7 dage) eller roadmap
  const sort = url.searchParams.get('list') ?? 'top';
  const cat = url.searchParams.get('cat') ?? '';
  let ids: string[];
  if (sort === 'trending') {
    const keys = Array.from({ length: 7 }, (_, i) => `sg:trend:${day(new Date(Date.now() - i * 86_400_000))}`);
    await redis.zunionstore('sg:trend:tmp', keys.length, keys);
    ids = (await redis.zrange<string[]>('sg:trend:tmp', 0, 149, { rev: true })) ?? [];
  } else {
    ids = (await redis.zrange<string[]>(sort === 'new' ? 'sg:new' : 'sg:top', 0, 299, { rev: true })) ?? [];
  }
  let items = (await Promise.all(ids.map((id) => getSug(Number(id))))).filter((s): s is Suggestion => !!s && (admin || !s.hidden) && !s.mergedInto);
  if (cat) items = items.filter((s) => s.cat === cat);
  if (sort === 'roadmap') items = items.filter((s) => s.status !== 'new');
  let voted: string[] = [];
  if (me) voted = (await redis.smembers(`prof:${me}:sgvotes`)) as string[];
  return json({ items: items.slice(0, 150), voted: voted.map(Number) });
}

// ---------- POST ----------

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: 'json' }, 400); }
  const op = String(body.op ?? '');
  const admin = isAdmin(request, body);

  // admin-handlinger
  if (op.startsWith('admin:')) {
    if (!admin) return json({ error: 'auth' }, 401);
    const id = Number(body.id);
    if (op === 'admin:status') {
      const status = String(body.status) as Status;
      if (!STATUSES.includes(status)) return json({ error: 'status' }, 400);
      await redis.hset(`sg:${id}`, { status, ...(body.releasedIn ? { releasedIn: clean(body.releasedIn, 20) } : {}) });
      return json({ ok: true });
    }
    if (op === 'admin:reply') { await redis.hset(`sg:${id}`, { reply: cleanBody(body.text, 1000) }); return json({ ok: true }); }
    if (op === 'admin:comment') {
      await redis.rpush(`sg:${id}:comments`, JSON.stringify({ pid: '', name: 'Developer', text: cleanBody(body.text, 1000), at: now(), dev: true }));
      await redis.hincrby(`sg:${id}`, 'comments', 1);
      return json({ ok: true });
    }
    if (op === 'admin:hide') { await redis.hset(`sg:${id}`, { hidden: !!body.hidden }); return json({ ok: true }); }
    if (op === 'admin:merge') {
      const into = Number(body.into);
      const s = await getSug(id), t = await getSug(into);
      if (!s || !t) return json({ error: 'not-found' }, 404);
      // stemmerne flyttes over (uden dobbeltstemmer)
      const voters = (await redis.smembers(`sg:${id}:voters`)) as string[];
      let added = 0;
      for (const v of voters) if (await redis.sadd(`sg:${into}:voters`, v)) { added++; await redis.sadd(`prof:${v}:sgvotes`, into); }
      await redis.hincrby(`sg:${into}`, 'votes', added);
      await redis.zincrby('sg:top', added, String(into));
      await redis.hset(`sg:${id}`, { mergedInto: into, status: 'rejected' });
      await redis.zrem('sg:top', String(id));
      return json({ ok: true, added });
    }
    if (op === 'admin:poll') {
      const cand = (Array.isArray(body.candidates) ? body.candidates : []).map(Number).filter(Boolean).slice(0, 5);
      if (cand.length < 2) return json({ error: 'candidates' }, 400);
      const pollId = String(Date.now());
      await redis.del('poll:current');
      await redis.hset('poll:current', { id: pollId, title: clean(body.title, 80) || 'Next feature', ends: clean(body.ends, 10), candidates: JSON.stringify(cand) });
      return json({ ok: true, id: pollId });
    }
    if (op === 'admin:commentHide') {
      const raw = (await redis.lindex(`sg:${id}:comments`, Number(body.index))) as string | Record<string, unknown> | null;
      if (!raw) return json({ error: 'not-found' }, 404);
      const c = typeof raw === 'string' ? JSON.parse(raw) : raw;
      await redis.lset(`sg:${id}:comments`, Number(body.index), JSON.stringify({ ...c, hidden: !!body.hidden }));
      return json({ ok: true });
    }
    return json({ error: 'op' }, 400);
  }

  const pid = String(body.pid ?? '');
  const prof = await auth(pid, String(body.token ?? ''));
  if (!prof) return json({ error: 'auth' }, 401);

  // nyt forslag (eller fejlrapport)
  if (op === 'suggest' || op === 'bug') {
    const rl = await rateLimit(request, 'sg', 6, 3600);
    if (!rl.ok) return json({ error: 'limit' }, 429);
    const title = clean(body.title, 90);
    const text = cleanBody(body.body, 2000);
    if (title.length < 6 || text.length < 10) return json({ error: 'short' }, 400);
    if (BAD.test(title) || BAD.test(text)) return json({ error: 'language' }, 400);
    const cat = op === 'bug' ? 'bug' : CATS.includes(String(body.cat)) ? String(body.cat) : 'other';
    const id = await redis.incr('sg:seq');
    const image = typeof body.image === 'string' && /^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/.test(body.image) && body.image.length <= 300_000 ? body.image : '';
    const s: Record<string, unknown> = {
      id, title, body: text, cat, lang: body.lang === 'da' ? 'da' : body.lang === 'tr' ? 'tr' : 'en', pid, name: prof.name, created: now(), status: 'new', votes: 0, comments: 0,
      hasImage: !!image, ...(op === 'bug' ? { meta: clean(body.meta, 300) } : {}),
    };
    await redis.hset(`sg:${id}`, s);
    if (image) await redis.set(`sg:${id}:img`, image);
    await redis.hset('sg:titles', { [id]: title });
    await redis.zadd('sg:new', { score: Date.now(), member: String(id) });
    await redis.zadd('sg:top', { score: 0, member: String(id) });
    await redis.rpush('sg:feed', JSON.stringify({ id, title, name: prof.name, cat, at: now() }));
    await redis.ltrim('sg:feed', -200, -1);
    return json({ ok: true, id });
  }

  // stem / fjern stemme
  if (op === 'vote') {
    const id = Number(body.id);
    const s = await getSug(id);
    if (!s || s.hidden) return json({ error: 'not-found' }, 404);
    const on = body.on !== false;
    if (on) {
      if (!(await canVote(pid))) return json({ error: 'newProfile' }, 403);
      if (s.status === 'released' || s.status === 'rejected') return json({ error: 'closed' }, 409);
      if (await redis.sismember(`sg:${id}:voters`, pid)) return json({ ok: true });
      if ((await activeVotes(pid)) >= VOTE_BUDGET) return json({ error: 'budget' }, 409);
      const rl = await rateLimit(request, 'vote', 40, 3600);
      if (!rl.ok) return json({ error: 'limit' }, 429);
      await redis.sadd(`sg:${id}:voters`, pid);
      await redis.sadd(`prof:${pid}:sgvotes`, id);
      await redis.hincrby(`sg:${id}`, 'votes', 1);
      await redis.zincrby('sg:top', 1, String(id));
      await redis.zincrby(`sg:trend:${day()}`, 1, String(id));
      await redis.expire(`sg:trend:${day()}`, 10 * 86_400);
      // mistænkelige mønstre: mange stemmer fra samme IP på samme forslag
      await redis.hincrby(`sg:${id}:ips`, rl.ip, 1);
    } else {
      if (!(await redis.srem(`sg:${id}:voters`, pid))) return json({ ok: true });
      await redis.srem(`prof:${pid}:sgvotes`, id);
      await redis.hincrby(`sg:${id}`, 'votes', -1);
      await redis.zincrby('sg:top', -1, String(id));
    }
    return json({ ok: true, used: await activeVotes(pid), budget: VOTE_BUDGET });
  }

  // kommentar
  if (op === 'comment') {
    const id = Number(body.id);
    const s = await getSug(id);
    if (!s || s.hidden) return json({ error: 'not-found' }, 404);
    const rl = await rateLimit(request, 'cm', 20, 3600);
    if (!rl.ok) return json({ error: 'limit' }, 429);
    const text = cleanBody(body.text, 1000);
    if (text.length < 2) return json({ error: 'short' }, 400);
    if (BAD.test(text)) return json({ error: 'language' }, 400);
    await redis.rpush(`sg:${id}:comments`, JSON.stringify({ pid, name: prof.name, text, at: now() }));
    await redis.hincrby(`sg:${id}`, 'comments', 1);
    return json({ ok: true });
  }

  // rapportér upassende indhold – skjules automatisk ved mange rapporter
  if (op === 'report') {
    const id = Number(body.id);
    const first = await redis.sadd(`sg:${id}:reporters`, pid);
    if (!first) return json({ ok: true });
    const n = await redis.hincrby(`sg:${id}`, 'reports', 1);
    if (n >= HIDE_AT) await redis.hset(`sg:${id}`, { hidden: true });
    return json({ ok: true });
  }

  // månedens afstemning: én stemme pr. profil (kan flyttes)
  if (op === 'pollVote') {
    if (!(await canVote(pid))) return json({ error: 'newProfile' }, 403);
    const poll = await redis.hgetall<Record<string, string>>('poll:current');
    if (!poll?.id) return json({ error: 'nopoll' }, 404);
    const sid = Number(body.sid);
    if (!(JSON.parse(poll.candidates ?? '[]') as number[]).includes(sid)) return json({ error: 'candidate' }, 400);
    const prev = await redis.hget<string>(`poll:${poll.id}:votes`, pid);
    if (prev) await redis.hincrby(`poll:${poll.id}:count`, String(prev), -1);
    await redis.hset(`poll:${poll.id}:votes`, { [pid]: sid });
    await redis.hincrby(`poll:${poll.id}:count`, String(sid), 1);
    return json({ ok: true });
  }

  return json({ error: 'op' }, 400);
}
