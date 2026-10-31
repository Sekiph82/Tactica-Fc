// Globale ranglister for singleplayer-managere (Vercel Function + Upstash Redis).
//
// Profil: serveren udsteder et hemmeligt token pr. profil (gemmes i browseren). Kun profilens
// ejer kan indsende sæsoner. Hver karriere (spil-id) tilhører én profil, og kun den FØRSTE
// indsendelse af en sæson tæller – genindlæsning af gemte spil kan ikke forbedre en score.
// Scoren valideres (linjenøgler, grænser, sum); selve spillet kører i browseren, så ranglisten
// er tillidsbaseret ud over disse kontroller.
import { Redis } from '@upstash/redis';

const redis = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });

// samme grænser som src/game/rating.ts (SCORE_LIMITS)
const LIMITS: Record<string, [number, number]> = {
  position: [0, 100], expectation: [-90, 90], title: [0, 190], promotion: [0, 55], relegation: [-55, 0],
  cup: [0, 40], cupFinal: [0, 16], cl: [0, 100], uefa: [0, 60], board: [-30, 10], sacked: [-80, 0], finance: [-8, 8], youth: [0, 15],
};

// samme id'er som src/game/achievements.ts (ACHIEVEMENTS)
const ACH_IDS = new Set(['firstWin', 'bigWin', 'hattrick', 'fullHouse', 'shootout', 'europe', 'giantKiller', 'comeback', 'winStreak5', 'unbeaten10', 'kidsWin', 'survivor', 'promotion', 'cup', 'bigSale', 'loyal', 'legend', 'century', 'title', 'doublePromotion', 'clWin', 'patron']);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const month = () => new Date().toISOString().slice(0, 7);
const rid = (n = 16) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
async function sha(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const BAD = /(fuck|cunt|nigg|hitler|nazi|fisse|kusse|luder|bøsse|neger)/i;
function cleanName(raw: unknown): string | null {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < 3 || name.length > 24) return null;
  if (!/^[\p{L}\p{N} ._'-]+$/u.test(name) || BAD.test(name)) return null;
  return name;
}

interface Line { key: string; pts: number }
interface Submission {
  pid: string; token: string; career: string; season: number;
  points: number; lines: Line[]; club: string; league: string; leagueName: string; nation?: string;
}

function validScore(s: Submission): string | null {
  if (!/^[a-zA-Z0-9-]{6,64}$/.test(s.career)) return 'career';
  if (!Number.isInteger(s.season) || s.season < 2025 || s.season > 2200) return 'season';
  if (!Array.isArray(s.lines) || s.lines.length > 20) return 'lines';
  let sum = 0;
  for (const l of s.lines) {
    const lim = LIMITS[l.key];
    if (!lim || !Number.isFinite(l.pts) || l.pts < lim[0] || l.pts > lim[1]) return `line:${l.key}`;
    sum += l.pts;
  }
  if (sum !== s.points) return 'sum';
  if (typeof s.club !== 'string' || s.club.length > 60 || typeof s.leagueName !== 'string' || s.leagueName.length > 60 || !/^[A-Z0-9-]{1,8}$/.test(s.league)) return 'meta';
  return null;
}

async function auth(pid: string, token: string) {
  const prof = await redis.hgetall<{ name: string; th: string }>(`prof:${pid}`);
  if (!prof?.th || prof.th !== (await sha(String(token)))) return null;
  return prof;
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: 'json' }, 400); }
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const minute = Math.floor(Date.now() / 60_000);
  const hits = await redis.incr(`rk:ip:${ip}:${minute}`);
  if (hits === 1) await redis.expire(`rk:ip:${ip}:${minute}`, 120);
  if (hits > 30) return json({ error: 'limit' }, 429);

  if (body.op === 'profile') {
    const name = cleanName(body.name);
    if (!name) return json({ error: 'name' }, 400);
    const pid = rid(8), token = rid(24);
    // navne er unikke (ingen kan udgive sig for en anden manager på listen)
    const ok = await redis.set(`name:${name.toLowerCase()}`, pid, { nx: true });
    if (!ok) return json({ error: 'taken' }, 409);
    await redis.hset(`prof:${pid}`, { name, th: await sha(token), created: new Date().toISOString() });
    return json({ pid, token, name });
  }

  // managerprofil: præstationer og en kort oversigt over karrieren (vises på den offentlige profil)
  if (body.op === 'sync') {
    const pid = String(body.pid ?? '');
    if (!(await auth(pid, String(body.token)))) return json({ error: 'auth' }, 401);
    const ach = Array.isArray(body.ach) ? [...new Set(body.ach.map(String).filter((x) => ACH_IDS.has(x)))] : [];
    const sm = (body.summary ?? {}) as Record<string, unknown>;
    const str = (v: unknown, n = 60) => String(v ?? '').replace(/[<>]/g, '').slice(0, n);
    const num = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
    const summary = {
      club: str(sm.club), league: str(sm.league), nation: str(sm.nation, 40), seasons: num(sm.seasons, 200), wins: num(sm.wins, 10000),
      trophies: num(sm.trophies, 500), titles: num(sm.titles, 200), rep: num(sm.rep, 100),
      trophyList: Array.isArray(sm.trophyList) ? sm.trophyList.slice(0, 30).map((x) => str(x, 80)) : [],
    };
    // profilbillede (lille data-URL) og motto
    const fields: Record<string, string> = { ach: JSON.stringify(ach), summary: JSON.stringify(summary), updated: new Date().toISOString() };
    if (typeof body.avatar === 'string') {
      const a = body.avatar;
      if (a === '' || (/^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/.test(a) && a.length <= 80_000)) fields.avatar = a;
    }
    if (typeof body.motto === 'string') fields.motto = str(body.motto.replace(/\s+/g, ' ').trim(), 140);
    await redis.hset(`prof:${pid}`, fields);
    return json({ ok: true });
  }

  // nyt navn på ranglisterne (stadig unikt)
  if (body.op === 'rename') {
    const pid = String(body.pid ?? '');
    const prof = await auth(pid, String(body.token));
    if (!prof) return json({ error: 'auth' }, 401);
    const name = cleanName(body.name);
    if (!name) return json({ error: 'name' }, 400);
    if (name.toLowerCase() !== prof.name.toLowerCase()) {
      const ok = await redis.set(`name:${name.toLowerCase()}`, pid, { nx: true });
      if (!ok) return json({ error: 'taken' }, 409);
      await redis.del(`name:${prof.name.toLowerCase()}`);
    }
    await redis.hset(`prof:${pid}`, { name });
    const careers = (await redis.smembers(`prof:${pid}:careers`)) as string[];
    await Promise.all(careers.map((c) => redis.hset(`career:${c}`, { name })));
    return json({ ok: true, name });
  }

  if (body.op === 'submit') {
    const s = body as unknown as Submission;
    const prof = await auth(String(s.pid), String(s.token));
    if (!prof) return json({ error: 'auth' }, 401);
    const bad = validScore(s);
    if (bad) return json({ error: 'invalid', detail: bad }, 400);
    const owner = await redis.hget<string>(`career:${s.career}`, 'pid');
    if (owner && owner !== s.pid) return json({ error: 'career' }, 403);
    // kun første indsendelse af en sæson tæller
    const first = await redis.set(`sub:${s.career}:${s.season}`, '1', { nx: true });
    if (!first) return json({ ok: true, duplicate: true });
    const member = `${s.career}:${s.season}`;
    const total = await redis.hincrby(`career:${s.career}`, 'total', s.points);
    const seasons = await redis.hincrby(`career:${s.career}`, 'seasons', 1);
    await redis.sadd(`prof:${s.pid}:careers`, s.career);
    await redis.hset(`career:${s.career}`, { pid: s.pid, name: prof.name, club: s.club, league: s.leagueName, updated: new Date().toISOString() });
    await redis.hset(`entry:${member}`, { name: prof.name, club: s.club, league: s.leagueName, season: s.season, points: s.points, lines: JSON.stringify(s.lines) });
    await Promise.all([
      redis.zadd('lb:career', { score: total, member: s.career }),
      redis.zadd('lb:season', { score: s.points, member }),
      redis.zadd(`lb:month:${month()}`, { score: s.points, member }),
      redis.zadd(`lb:league:${s.league}`, { score: s.points, member }),
    ]);
    return json({ ok: true, total, seasons });
  }
  return json({ error: 'op' }, 400);
}

/** GET ?board=career|season|month|league&league=GB1&career=<id> → top 50 + egen placering */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const profile = (url.searchParams.get('profile') ?? '').replace(/[^a-f0-9]/g, '');
  if (profile) {
    const h = await redis.hgetall<Record<string, unknown>>(`prof:${profile}`);
    if (!h?.name) return json({ error: 'not-found' }, 404);
    const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v ?? null);
    const ids = (await redis.smembers(`prof:${profile}:careers`)) as string[];
    const careers = (await Promise.all(ids.slice(0, 20).map(async (id) => {
      const c = await redis.hgetall<Record<string, string>>(`career:${id}`);
      const rank = await redis.zrevrank('lb:career', id);
      return c ? { id, club: c.club, league: c.league, total: Number(c.total ?? 0), seasons: Number(c.seasons ?? 0), rank: rank === null ? null : rank + 1 } : null;
    }))).filter(Boolean).sort((a, b) => b!.total - a!.total);
    return json({ name: h.name, created: h.created, ach: parse(h.ach) ?? [], summary: parse(h.summary), careers, avatar: h.avatar || null, motto: h.motto || '', supporter: h.supporter || null, regen: h.regenName || null });
  }
  const board = url.searchParams.get('board') ?? 'career';
  const league = (url.searchParams.get('league') ?? '').replace(/[^A-Z0-9-]/g, '');
  const career = (url.searchParams.get('career') ?? '').replace(/[^a-zA-Z0-9-]/g, '');
  const key = board === 'season' ? 'lb:season' : board === 'month' ? `lb:month:${month()}` : board === 'league' && league ? `lb:league:${league}` : 'lb:career';
  const raw = await redis.zrange<string[]>(key, 0, 49, { rev: true, withScores: true });
  const ids: { member: string; score: number }[] = [];
  for (let i = 0; i < raw.length; i += 2) ids.push({ member: String(raw[i]), score: Number(raw[i + 1]) });
  const isCareer = key === 'lb:career';
  const rows = await Promise.all(ids.map(async ({ member, score }) => {
    const h = isCareer ? await redis.hgetall<Record<string, string>>(`career:${member}`) : await redis.hgetall<Record<string, string>>(`entry:${member}`);
    const tier = h?.pid ? await redis.hget<string>(`prof:${h.pid}`, 'supporter') : null;
    return { id: member, pid: isCareer ? h?.pid : undefined, supporter: tier ?? undefined, points: score, name: h?.name ?? '?', club: h?.club ?? '', league: h?.league ?? '', season: h?.season ? Number(h.season) : undefined, seasons: h?.seasons ? Number(h.seasons) : undefined };
  }));
  // egen placering (bedste række for karrieren)
  let me: { rank: number; points: number } | null = null;
  if (career) {
    if (isCareer) {
      const r = await redis.zrevrank(key, career);
      const sc = await redis.zscore(key, career);
      if (r !== null && sc !== null) me = { rank: r + 1, points: Number(sc) };
    } else {
      const seasons = Number((await redis.hget<number>(`career:${career}`, 'seasons')) ?? 0);
      for (let s = 2025; s < 2025 + 40 && seasons; s++) {
        const m = `${career}:${s}`;
        const sc = await redis.zscore(key, m);
        if (sc === null) continue;
        const r = await redis.zrevrank(key, m);
        if (r !== null && (!me || r + 1 < me.rank)) me = { rank: r + 1, points: Number(sc) };
      }
    }
  }
  const total = await redis.zcard(key);
  return json({ board, rows, me, total });
}
