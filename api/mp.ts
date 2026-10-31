// Online multiplayer-server (Vercel Function).
//
// Redis (Upstash) holder rummets metadata, deltagere, "klar"-status, handlinger og en lås.
// Selve spillet (≈4-5 MB gzip) ligger som øjebliksbilleder i Vercel Blob.
// Klienterne simulerer selv: når alle er klar, tager én af dem låsen, afspiller alle handlinger,
// simulerer frem til næste kampdag og uploader et nyt øjebliksbillede (commit).
import { Redis } from '@upstash/redis';
import { del } from '@vercel/blob';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';

const redis = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });
const TTL = 60 * 60 * 24 * 60; // rum lever 60 dage efter sidste aktivitet
const LOCK_SECONDS = 240;
const MAX_PLAYERS = 8;

interface PlayerRec {
  pid: string;
  name: string;
  club: number;
  token: string;
  ready: boolean;
  joined: string;
  /** Gjort klar automatisk, fordi trækkets frist udløb (assistenten tager over) */
  auto?: boolean;
}

interface ChatRec {
  id: number;
  from: string;
  name: string;
  to: string;
  text: string;
  at: string;
}

interface RoomRec {
  code: string;
  host: string;
  status: 'setup' | 'playing';
  version: number;
  snapshot: string;
  prevSnapshot: string;
  lastApplied: number;
  date: string;
  settings: string;
  created: string;
  lastTurn: string;
}

const k = (code: string) => ({ room: `room:${code}`, players: `room:${code}:players`, actions: `room:${code}:actions`, lock: `room:${code}:lock`, chat: `room:${code}:chat` });
const CHAT_KEEP = 300;

// ---------- draft-liga ----------
const DRAFT_MAX = 16;
const SQUAD = 16;
const PICK_MS = 60_000;
const KEEP_MS = 120_000;
const CLUB_BASE = 900_000;
// auktionsdraft
const BUDGET = 200;
const NOM_MS = 30_000;
const AUCTION_MS = 20_000;
const BID_EXTEND_MS = 15_000;
/** når alle mennesker har meldt pas: kort frist, så AI-holdene kan nå et sidste bud */
const PASS_END_MS = 3_500;
const dk = (code: string) => ({ teams: `room:${code}:dteams`, state: `room:${code}:dstate`, picks: `room:${code}:dpicks`, taken: `room:${code}:dtaken` });

interface DraftTeamRec {
  slot: number; pid: string; ai: boolean; manager: string; name: string; short: string; colors: [string, string]; crest: number; formation: string;
  wish: number[]; keep: { slot: number; player: number; place: number }[]; keepReady?: boolean; summaryReady?: boolean;
  /** auktion: resterende budget (mio.) */
  budget?: number;
}
interface AuctionRec { id: number; player: number; bid: number; bidder: number; nominator: number; endsAt: number; lastBid: number; /** klubber der har meldt pas */ passed?: number[] }
interface DraftStateRec { phase: 'lobby' | 'summary' | 'keepers' | 'draft' | 'done' | 'playing'; season: number; order: number[]; pickStart: number; keepStart: number; nextPhase?: string; auction?: AuctionRec | null; nomIdx?: number }

async function draftTeams(code: string): Promise<DraftTeamRec[]> {
  const h = await redis.hgetall<Record<string, DraftTeamRec | string>>(dk(code).teams);
  return Object.values(h ?? {}).map((v) => (typeof v === 'string' ? (JSON.parse(v) as DraftTeamRec) : v)).sort((a, b) => a.slot - b.slot);
}
async function saveTeam(code: string, t: DraftTeamRec) { await redis.hset(dk(code).teams, { [String(t.slot)]: JSON.stringify(t) }); }
async function draftState(code: string): Promise<DraftStateRec | null> {
  const r = await redis.hgetall<Record<string, string | number>>(dk(code).state);
  if (!r || !r.phase) return null;
  const order = typeof r.order === 'string' ? JSON.parse(r.order || '[]') : (r.order ?? []);
  const auction = !r.auction ? null : typeof r.auction === 'string' ? (JSON.parse(r.auction) as AuctionRec) : (r.auction as unknown as AuctionRec);
  return { phase: r.phase as DraftStateRec['phase'], season: Number(r.season), order: order as number[], pickStart: Number(r.pickStart ?? 0), keepStart: Number(r.keepStart ?? 0), nextPhase: r.nextPhase ? String(r.nextPhase) : undefined, auction, nomIdx: Number(r.nomIdx ?? 0) };
}
async function setDraftState(code: string, st: Partial<DraftStateRec>) {
  const v: Record<string, string | number> = {};
  for (const [key, val] of Object.entries(st)) v[key] = Array.isArray(val) || (val && typeof val === 'object') ? JSON.stringify(val) : val === null ? '' : (val as string | number);
  await redis.hset(dk(code).state, v);
}
async function draftPicks(code: string) {
  const raw = await redis.lrange<string | Record<string, unknown>>(dk(code).picks, 0, -1);
  return raw.map((x) => (typeof x === 'string' ? JSON.parse(x) : x)) as { slot: number; player: number; place: number; auto?: boolean }[];
}
const slotForPick = (order: number[], n: number) => { const t = order.length, r = Math.floor(n / t), i = n % t; return r % 2 === 0 ? order[i] : order[t - 1 - i]; };
const cleanTeam = (b: Record<string, unknown>, t: DraftTeamRec): DraftTeamRec => {
  const col = (x: unknown, d: string) => (typeof x === 'string' && /^#[0-9a-fA-F]{6}$/.test(x) ? x : d);
  const out = { ...t };
  if (typeof b.name === 'string' && b.name.trim()) out.name = b.name.trim().slice(0, 28);
  if (typeof b.short === 'string' && b.short.trim()) out.short = b.short.trim().slice(0, 3).toUpperCase();
  if (Array.isArray(b.colors)) out.colors = [col(b.colors[0], t.colors[0]), col(b.colors[1], t.colors[1])];
  if (b.crest !== undefined) out.crest = Math.max(0, Math.min(9, Math.round(Number(b.crest) || 0)));
  if (typeof b.formation === 'string' && b.formation.length < 20) out.formation = b.formation;
  if (Array.isArray(b.wish)) out.wish = b.wish.map(Number).filter(Number.isFinite).slice(0, 100);
  return out;
};
/** Auktion: hvor mange spillere har holdet, og hvad må det højst byde (1 mio. tilbage pr. ledig plads) */
function teamCount(t: DraftTeamRec, picks: { slot: number }[]) { return t.keep.length + picks.filter((p) => p.slot === t.slot).length; }
function maxBid(t: DraftTeamRec, picks: { slot: number }[]) { return (t.budget ?? BUDGET) - Math.max(0, SQUAD - teamCount(t, picks) - 1); }
/** Er alle menneskelige klubber (undtagen den førende) ude af auktionen – meldt pas, fulde eller uden råd? */
function humansOut(teams: DraftTeamRec[], picks: { slot: number }[], a: AuctionRec) {
  return teams.filter((t) => !t.ai && t.slot !== a.bidder).every((t) => a.passed?.includes(t.slot) || teamCount(t, picks) >= SQUAD || maxBid(t, picks) <= a.bid);
}
/** Næste hold, der skal nominere (springer fulde hold over) */
function nominatorFrom(order: number[], idx: number, teams: DraftTeamRec[], picks: { slot: number }[]): { slot: number; idx: number } | null {
  for (let k = 0; k < order.length; k++) {
    const i = (idx + k) % order.length;
    const t = teams.find((x) => x.slot === order[i]);
    if (t && teamCount(t, picks) < SQUAD) return { slot: t.slot, idx: i };
  }
  return null;
}
/** Start en auktionsdraft: alle får fuldt budget */
async function startAuction(code: string, teams: DraftTeamRec[]) {
  for (const t of teams) { t.budget = BUDGET; await saveTeam(code, t); }
  await setDraftState(code, { auction: null, nomIdx: 0, pickStart: Date.now() });
}

/** Rummets indstillinger (Upstash pakker JSON ud af sig selv – derfor både tekst og objekt) */
function roomSettings(room: { settings: unknown }): Record<string, any> {
  const v = room.settings;
  if (!v) return {};
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return {}; } }
  return v as Record<string, any>;
}

async function touchDraft(code: string) {
  const d = dk(code);
  await Promise.all([redis.expire(d.teams, TTL), redis.expire(d.state, TTL), redis.expire(d.picks, TTL), redis.expire(d.taken, TTL)]);
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

function rid(len: number, alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789') {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

async function touch(code: string) {
  const keys = k(code);
  await Promise.all([redis.expire(keys.room, TTL), redis.expire(keys.players, TTL), redis.expire(keys.actions, TTL), redis.expire(keys.chat, TTL)]);
}

async function getRoom(code: string): Promise<RoomRec | null> {
  const r = await redis.hgetall<Record<string, string | number>>(k(code).room);
  if (!r || !r.code) return null;
  return { ...r, version: Number(r.version), lastApplied: Number(r.lastApplied) } as unknown as RoomRec;
}

async function getPlayers(code: string): Promise<PlayerRec[]> {
  const h = await redis.hgetall<Record<string, PlayerRec | string>>(k(code).players);
  if (!h) return [];
  return Object.values(h).map((v) => (typeof v === 'string' ? (JSON.parse(v) as PlayerRec) : v));
}

async function auth(code: string, pid: string, token: string): Promise<PlayerRec | null> {
  const raw = await redis.hget<PlayerRec | string>(k(code).players, pid);
  if (!raw) return null;
  const p = typeof raw === 'string' ? (JSON.parse(raw) as PlayerRec) : raw;
  return p.token === token ? p : null;
}

async function savePlayer(code: string, p: PlayerRec) {
  await redis.hset(k(code).players, { [p.pid]: JSON.stringify(p) });
}

async function publicRoom(code: string) {
  const room = await getRoom(code);
  if (!room) return null;
  const players = await getPlayers(code);
  const lock = await redis.get<string>(k(code).lock);
  const actionCount = await redis.llen(k(code).actions);
  const chatRaw = await redis.lrange<string | ChatRec>(k(code).chat, -100, -1);
  const chat = chatRaw.map((c) => (typeof c === 'string' ? (JSON.parse(c) as ChatRec) : c));
  return {
    code: room.code, host: room.host, status: room.status, version: room.version, snapshot: room.snapshot, date: room.date,
    lastApplied: room.lastApplied, actionCount, settings: typeof room.settings === 'string' ? JSON.parse(room.settings || '{}') : (room.settings ?? {}), lastTurn: room.lastTurn,
    processing: lock ?? null,
    players: players.map((p) => ({ pid: p.pid, name: p.name, club: p.club, ready: p.ready, joined: p.joined, auto: !!p.auto })),
    chat,
    draft: await publicDraft(code),
    voice: await voiceMembers(code),
  };
}

/** Hvem er med i voice-chatten lige nu (hjerteslag inden for 25 sekunder) */
async function voiceMembers(code: string): Promise<string[]> {
  const h = (await redis.hgetall<Record<string, number | string>>(`room:${code}:voice`)) ?? {};
  const now = Date.now();
  return Object.entries(h).filter(([, ts]) => now - Number(ts) < 25_000).map(([pid]) => pid);
}

async function publicDraft(code: string) {
  let st = await draftState(code);
  if (!st) return undefined;
  // selvhelende: alle valg er registreret, men draften blev ikke markeret som færdig
  if (st.phase === 'draft') {
    const room = await getRoom(code);
    const keepers = Number(room ? roomSettings(room).draft?.keepers ?? 0 : 0);
    const total = st.order.length * (SQUAD - (st.season > 1 ? keepers : 0));
    if (total > 0 && (await redis.llen(dk(code).picks)) >= total) { await setDraftState(code, { phase: 'done' }); st = { ...st, phase: 'done' }; }
  }
  const teams = await draftTeams(code);
  return { ...st, teams, picks: await draftPicks(code), now: Date.now() };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = (url.searchParams.get('code') ?? '').toUpperCase();
  if (!code) return json({ error: 'code' }, 400);
  const room = await publicRoom(code);
  return room ? json(room) : json({ error: 'not-found' }, 404);
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const op = url.searchParams.get('op');
  if (op === 'upload') return upload(request);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: 'bad-json' }, 400); }
  const code = String(body.code ?? '').toUpperCase();
  const keys = k(code);

  switch (op) {
    case 'create': {
      const name = String(body.name ?? '').slice(0, 30).trim();
      const club = (body.settings as Record<string, unknown> | undefined)?.mode === 'draft' ? CLUB_BASE + 1 : Number(body.club);
      if (!name || (!club && (body.settings as Record<string, unknown> | undefined)?.mode !== 'draft')) return json({ error: 'missing' }, 400);
      let newCode = '';
      for (let i = 0; i < 5; i++) {
        const c = rid(5);
        if (await redis.hsetnx(`room:${c}`, 'code', c)) { newCode = c; break; }
      }
      if (!newCode) return json({ error: 'busy' }, 503);
      const pid = rid(10, 'abcdefghijkmnpqrstuvwxyz23456789');
      const token = rid(24, 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789');
      const now = new Date().toISOString();
      await redis.hset(`room:${newCode}`, {
        code: newCode, host: pid, status: 'setup', version: 0, snapshot: '', prevSnapshot: '', lastApplied: 0, date: '',
        settings: JSON.stringify(body.settings ?? {}), created: now, lastTurn: now,
      });
      await savePlayer(newCode, { pid, name, club, token, ready: false, joined: now });
      if ((body.settings as Record<string, unknown> | undefined)?.mode === 'draft') {
        const team = cleanTeam((body.team ?? {}) as Record<string, unknown>, { slot: 1, pid, ai: false, manager: name, name: `${name} FC`, short: name.slice(0, 3).toUpperCase(), colors: ['#c8102e', '#ffffff'], crest: 0, formation: '4-4-2', wish: [], keep: [] });
        await saveTeam(newCode, team);
        await setDraftState(newCode, { phase: 'lobby', season: 1, order: [], pickStart: 0, keepStart: 0 });
        await touchDraft(newCode);
      }
      await touch(newCode);
      return json({ code: newCode, pid, token });
    }
    case 'join': {
      const room = await getRoom(code);
      if (!room) return json({ error: 'not-found' }, 404);
      const dst = await draftState(code);
      if (dst) {
        // draft-liga: man får den første ledige plads og opretter sin egen klub
        if (dst.phase !== 'lobby') return json({ error: 'started' }, 409);
        const name = String(body.name ?? '').slice(0, 30).trim();
        if (!name) return json({ error: 'missing' }, 400);
        const teams = await draftTeams(code);
        if (teams.length >= DRAFT_MAX) return json({ error: 'full' }, 409);
        let slot = 1;
        while (teams.some((t) => t.slot === slot)) slot++;
        const pid = rid(10, 'abcdefghijkmnpqrstuvwxyz23456789');
        const token = rid(24, 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789');
        await savePlayer(code, { pid, name, club: CLUB_BASE + slot, token, ready: false, joined: new Date().toISOString() });
        await saveTeam(code, cleanTeam((body.team ?? {}) as Record<string, unknown>, { slot, pid, ai: false, manager: name, name: `${name} FC`, short: name.slice(0, 3).toUpperCase(), colors: ['#003399', '#ffffff'], crest: slot % 6, formation: '4-4-2', wish: [], keep: [] }));
        await touch(code); await touchDraft(code);
        return json({ code, pid, token });
      }
      const name = String(body.name ?? '').slice(0, 30).trim();
      const club = Number(body.club);
      const nation = Number(body.nation ?? 0);
      const players = await getPlayers(code);
      if (!name || !club) return json({ error: 'missing' }, 400);
      if (players.length >= MAX_PLAYERS) return json({ error: 'full' }, 409);
      if (players.some((p) => p.club === club)) return json({ error: 'club-taken' }, 409);
      const pid = rid(10, 'abcdefghijkmnpqrstuvwxyz23456789');
      const token = rid(24, 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789');
      await savePlayer(code, { pid, name, club, token, ready: false, joined: new Date().toISOString() });
      await redis.rpush(keys.actions, JSON.stringify({ pid, a: { t: 'join', name, club, nation } }));
      await touch(code);
      return json({ code, pid, token });
    }
    case 'actions': {
      const me = await auth(code, String(body.pid), String(body.token));
      if (!me) return json({ error: 'auth' }, 403);
      const actions = Array.isArray(body.actions) ? body.actions.slice(0, 200) : [];
      let last = await redis.llen(keys.actions);
      if (actions.length) last = await redis.rpush(keys.actions, ...actions.map((a) => JSON.stringify({ pid: me.pid, a })));
      if (me.ready && actions.length) { me.ready = false; await savePlayer(code, me); }
      await touch(code);
      return json({ last });
    }
    // ----- kamp mellem to managere: hjemmeholdet kører kampen og sender en live-visning; udeholdet følger med og sender ændringer -----
    case 'livepush': {
      const me = await auth(code, String(body.pid), String(body.token));
      if (!me) return json({ error: 'auth' }, 403);
      const fx = Number(body.fixture);
      await redis.set(`room:${code}:live:${fx}`, JSON.stringify(body.data ?? null), { ex: 3600 });
      const ck = `room:${code}:livecmd:${fx}`;
      const raw = await redis.lrange<string | Record<string, unknown>>(ck, 0, -1);
      if (raw.length) await redis.del(ck);
      return json({ cmds: raw.map((x) => (typeof x === 'string' ? JSON.parse(x) : x)) });
    }
    case 'liveget': {
      const me = await auth(code, String(body.pid), String(body.token));
      if (!me) return json({ error: 'auth' }, 403);
      const raw = await redis.get<string | Record<string, unknown>>(`room:${code}:live:${Number(body.fixture)}`);
      return json({ data: raw == null ? null : typeof raw === 'string' ? JSON.parse(raw) : raw });
    }
    case 'livecmd': {
      const me = await auth(code, String(body.pid), String(body.token));
      if (!me) return json({ error: 'auth' }, 403);
      const ck = `room:${code}:livecmd:${Number(body.fixture)}`;
      await redis.rpush(ck, JSON.stringify(body.cmd ?? null));
      await redis.expire(ck, 3600);
      return json({ ok: true });
    }
    case 'chat': {
      // beskeder mellem menneskelige managere (leveres med det samme, uafhængigt af trækkene)
      const me = await auth(code, String(body.pid), String(body.token));
      if (!me) return json({ error: 'auth' }, 403);
      const text = String(body.text ?? '').trim().slice(0, 500);
      const to = String(body.to ?? 'all').slice(0, 40);
      if (!text) return json({ error: 'empty' }, 400);
      const n = await redis.incr(`${keys.chat}:seq`);
      const rec: ChatRec = { id: n, from: me.pid, name: me.name, to, text, at: new Date().toISOString() };
      await redis.rpush(keys.chat, JSON.stringify(rec));
      await redis.ltrim(keys.chat, -CHAT_KEEP, -1);
      await Promise.all([touch(code), redis.expire(`${keys.chat}:seq`, TTL)]);
      return json(rec);
    }
    case 'autoready': {
      // trækkets frist er udløbet: alle der ikke er klar, gøres klar – deres assistent tager over
      const me = await auth(code, String(body.pid), String(body.token));
      if (!me) return json({ error: 'auth' }, 403);
      const room = await getRoom(code);
      if (!room) return json({ error: 'not-found' }, 404);
      const settings = typeof room.settings === 'string' ? JSON.parse(room.settings || '{}') : (room.settings ?? {});
      const hours = Number(settings.deadlineHours ?? 0);
      if (!hours) return json({ error: 'no-deadline' }, 400);
      if (Date.now() - Date.parse(room.lastTurn) < hours * 3_600_000) return json({ error: 'too-early' }, 409);
      for (const p of await getPlayers(code)) if (!p.ready) { p.ready = true; p.auto = true; await savePlayer(code, p); }
      return json(await publicRoom(code));
    }
    case 'force': {
      // værten tvinger trækket igennem: alle der ikke er klar, gøres klar (assistenten tager over)
      const me = await auth(code, String(body.pid), String(body.token));
      if (!me) return json({ error: 'auth' }, 403);
      const room = await getRoom(code);
      if (!room) return json({ error: 'not-found' }, 404);
      if (room.host !== me.pid) return json({ error: 'not-host' }, 403);
      for (const p of await getPlayers(code)) if (!p.ready) { p.ready = true; p.auto = true; await savePlayer(code, p); }
      await touch(code);
      return json(await publicRoom(code));
    }
    case 'kick': {
      // værten fjerner en spiller (fx gået offline) – klubben overtages af en AI-manager i næste træk
      const me = await auth(code, String(body.pid), String(body.token));
      if (!me) return json({ error: 'auth' }, 403);
      const room = await getRoom(code);
      if (!room) return json({ error: 'not-found' }, 404);
      if (room.host !== me.pid) return json({ error: 'not-host' }, 403);
      const target = String(body.target ?? '');
      if (!target || target === room.host) return json({ error: 'target' }, 400);
      await redis.hdel(keys.players, target);
      await redis.rpush(keys.actions, JSON.stringify({ pid: me.pid, a: { t: 'removeHuman', pid: target } }));
      // draft-liga: holdet bliver et AI-hold (også i de kommende drafte)
      for (const t of await draftTeams(code)) if (t.pid === target) { t.pid = ''; t.ai = true; t.manager = 'AI'; await saveTeam(code, t); }
      await touch(code);
      return json(await publicRoom(code));
    }
    case 'ready': {
      const me = await auth(code, String(body.pid), String(body.token));
      if (!me) return json({ error: 'auth' }, 403);
      me.ready = !!body.ready;
      me.auto = false;
      await savePlayer(code, me);
      return json(await publicRoom(code));
    }
    case 'lock': {
      const me = await auth(code, String(body.pid), String(body.token));
      if (!me) return json({ error: 'auth' }, 403);
      const room = await getRoom(code);
      if (!room || room.version !== Number(body.version)) return json({ error: 'version' }, 409);
      const players = await getPlayers(code);
      if (!players.every((p) => p.ready)) return json({ error: 'not-ready' }, 409);
      const ok = await redis.set(keys.lock, me.pid, { nx: true, ex: LOCK_SECONDS });
      if (!ok) return json({ error: 'locked' }, 409);
      const raw = await redis.lrange<string | { pid: string; a: unknown }>(keys.actions, room.lastApplied, -1);
      const actions = raw.map((x, i) => ({ idx: room.lastApplied + i + 1, ...(typeof x === 'string' ? JSON.parse(x) : x) }));
      return json({ ok: true, actions });
    }
    case 'unlock': {
      const me = await auth(code, String(body.pid), String(body.token));
      if (!me) return json({ error: 'auth' }, 403);
      const holder = await redis.get<string>(keys.lock);
      if (holder === me.pid) await redis.del(keys.lock);
      return json({ ok: true });
    }
    case 'commit': {
      const me = await auth(code, String(body.pid), String(body.token));
      if (!me) return json({ error: 'auth' }, 403);
      const room = await getRoom(code);
      if (!room) return json({ error: 'not-found' }, 404);
      const version = Number(body.version);
      const snapshot = String(body.url ?? '');
      if (!snapshot.includes('.blob.vercel-storage.com/')) return json({ error: 'url' }, 400);
      const init = room.version === 0 && room.host === me.pid && version === 1;
      if (!init) {
        const holder = await redis.get<string>(keys.lock);
        if (holder !== me.pid) return json({ error: 'no-lock' }, 409);
        if (version !== room.version + 1) return json({ error: 'version' }, 409);
      }
      // ryd op i gamle øjebliksbilleder (behold forrige, så klienter midt i en download ikke fejler)
      if (room.prevSnapshot) { try { await del(room.prevSnapshot); } catch { /* ignorér */ } }
      await redis.hset(keys.room, {
        version, snapshot, prevSnapshot: room.snapshot || '', lastApplied: Number(body.lastApplied ?? room.lastApplied),
        date: String(body.date ?? ''), status: 'playing', lastTurn: new Date().toISOString(),
      });
      const players = await getPlayers(code);
      for (const p of players) if (p.ready || p.auto) { p.ready = false; p.auto = false; await savePlayer(code, p); }
      await redis.del(keys.lock);
      await touch(code);
      return json(await publicRoom(code));
    }
    // ----- voice-chat: serveren formidler kun forbindelsen (WebRTC), lyden går direkte mellem browserne -----
    case 'voice': {
      const me = await auth(code, String(body.pid), String(body.token));
      if (!me) return json({ error: 'auth' }, 403);
      if (body.on) await redis.hset(`room:${code}:voice`, { [me.pid]: Date.now() });
      else await redis.hdel(`room:${code}:voice`, me.pid);
      await redis.expire(`room:${code}:voice`, 3600);
      return json({ voice: await voiceMembers(code) });
    }
    case 'sig': {
      const me = await auth(code, String(body.pid), String(body.token));
      if (!me) return json({ error: 'auth' }, 403);
      const to = String(body.to ?? '').replace(/[^a-z0-9]/g, '');
      if (!to) return json({ error: 'to' }, 400);
      const key = `room:${code}:sig:${to}`;
      await redis.rpush(key, JSON.stringify({ from: me.pid, data: body.data ?? null }));
      await redis.expire(key, 120);
      return json({ ok: true });
    }
    case 'sigpull': {
      const me = await auth(code, String(body.pid), String(body.token));
      if (!me) return json({ error: 'auth' }, 403);
      const key = `room:${code}:sig:${me.pid}`;
      const raw = await redis.lrange<string | Record<string, unknown>>(key, 0, -1);
      if (raw.length) await redis.del(key);
      return json({ msgs: raw.map((x) => (typeof x === 'string' ? JSON.parse(x) : x)), voice: await voiceMembers(code) });
    }
    // ----- draft-liga -----
    case 'dteam': {
      const me = await auth(code, String(body.pid), String(body.token));
      if (!me) return json({ error: 'auth' }, 403);
      const room = await getRoom(code);
      const st = await draftState(code);
      if (!room || !st) return json({ error: 'not-found' }, 404);
      const teams = await draftTeams(code);
      const slot = Number(body.slot ?? me.club - CLUB_BASE);
      const t = teams.find((x) => x.slot === slot);
      if (!t) return json({ error: 'slot' }, 404);
      if (t.pid !== me.pid && !(t.ai && room.host === me.pid)) return json({ error: 'not-yours' }, 403);
      const b = (body.team ?? {}) as Record<string, unknown>;
      let next = { ...t, wish: Array.isArray(b.wish) ? cleanTeam({ wish: b.wish }, t).wish : t.wish };
      // navn, farver og formation kan kun ændres før draften (formationen bestemmer pladserne)
      if (st.phase === 'lobby' || st.phase === 'keepers') next = cleanTeam(b, next);
      if (st.phase === 'keepers' && Array.isArray(b.keep)) {
        const n = Number(roomSettings(room).draft?.keepers ?? 0);
        next.keep = (b.keep as { player: number; place: number }[]).slice(0, n).map((k) => ({ slot, player: Number(k.player), place: Number(k.place) }));
        next.keepReady = !!b.keepReady;
      }
      await saveTeam(code, next);
      await touchDraft(code);
      return json(await publicRoom(code));
    }
    case 'dai': {
      // værten tilføjer/fjerner AI-hold i lobbyen
      const me = await auth(code, String(body.pid), String(body.token));
      if (!me) return json({ error: 'auth' }, 403);
      const room = await getRoom(code);
      const st = await draftState(code);
      if (!room || !st) return json({ error: 'not-found' }, 404);
      if (room.host !== me.pid) return json({ error: 'not-host' }, 403);
      if (st.phase !== 'lobby') return json({ error: 'started' }, 409);
      const teams = await draftTeams(code);
      if (body.remove) {
        const t = teams.find((x) => x.slot === Number(body.remove));
        if (t?.ai) await redis.hdel(dk(code).teams, String(t.slot));
      } else {
        if (teams.length >= DRAFT_MAX) return json({ error: 'full' }, 409);
        let slot = 1;
        while (teams.some((t) => t.slot === slot)) slot++;
        const t = cleanTeam((body.team ?? {}) as Record<string, unknown>, { slot, pid: '', ai: true, manager: 'AI', name: `AI ${slot}`, short: `AI${slot}`.slice(0, 3), colors: ['#555555', '#ffffff'], crest: slot % 6, formation: '4-3-3', wish: [], keep: [] });
        await saveTeam(code, t);
      }
      await touchDraft(code);
      return json(await publicRoom(code));
    }
    case 'dsettings': {
      const me = await auth(code, String(body.pid), String(body.token));
      if (!me) return json({ error: 'auth' }, 403);
      const room = await getRoom(code);
      const st = await draftState(code);
      if (!room || !st) return json({ error: 'not-found' }, 404);
      if (room.host !== me.pid) return json({ error: 'not-host' }, 403);
      if (st.phase !== 'lobby') return json({ error: 'started' }, 409);
      const cur = roomSettings(room);
      const d = (body.draft ?? {}) as Record<string, unknown>;
      cur.draft = {
        rounds: Math.max(1, Math.min(4, Math.round(Number(d.rounds ?? cur.draft?.rounds ?? 2)))),
        playoff: ['none', 'final', 'semis'].includes(String(d.playoff)) ? String(d.playoff) : (cur.draft?.playoff ?? 'none'),
        keepers: Math.max(0, Math.min(3, Math.round(Number(d.keepers ?? cur.draft?.keepers ?? 0)))),
        injuries: d.injuries === undefined ? (cur.draft?.injuries ?? true) : !!d.injuries,
        format: d.format === 'auction' ? 'auction' : d.format === 'snake' ? 'snake' : (cur.draft?.format ?? 'snake'),
        pool: d.pool === undefined ? (cur.draft?.pool ?? '') : /^(n:)?[A-Za-z0-9]{1,10}$/.test(String(d.pool)) ? String(d.pool) : '',
      };
      if (body.deadlineHours !== undefined) cur.deadlineHours = Math.max(0, Math.min(168, Number(body.deadlineHours) || 0));
      await redis.hset(keys.room, { settings: JSON.stringify(cur) });
      return json(await publicRoom(code));
    }
    case 'dstart': {
      const me = await auth(code, String(body.pid), String(body.token));
      if (!me) return json({ error: 'auth' }, 403);
      const room = await getRoom(code);
      const st = await draftState(code);
      if (!room || !st) return json({ error: 'not-found' }, 404);
      if (room.host !== me.pid) return json({ error: 'not-host' }, 403);
      if (st.phase !== 'lobby') return json({ error: 'started' }, 409);
      const teams = await draftTeams(code);
      if (teams.length < 2) return json({ error: 'too-few' }, 409);
      const order = teams.map((t) => t.slot);
      for (let i = order.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
      await redis.del(dk(code).picks, dk(code).taken);
      await setDraftState(code, { phase: 'draft', season: 1, order, pickStart: Date.now() });
      if (roomSettings(room).draft?.format === 'auction') await startAuction(code, teams);
      await touch(code); await touchDraft(code);
      return json(await publicRoom(code));
    }
    case 'dpick': {
      const me = await auth(code, String(body.pid), String(body.token));
      if (!me) return json({ error: 'auth' }, 403);
      const room = await getRoom(code);
      const st = await draftState(code);
      if (!room || !st) return json({ error: 'not-found' }, 404);
      if (st.phase !== 'draft') return json({ error: 'phase' }, 409);
      if (roomSettings(room).draft?.format === 'auction') return json({ error: 'phase' }, 409);
      const n = Number(body.n);
      const len = await redis.llen(dk(code).picks);
      if (n !== len) return json({ error: 'stale' }, 409);
      const slot = slotForPick(st.order, n);
      const teams = await draftTeams(code);
      const team = teams.find((t) => t.slot === slot);
      if (!team) return json({ error: 'slot' }, 404);
      const mine = team.pid === me.pid;
      const timedOut = Date.now() >= st.pickStart + PICK_MS + 1000;
      if (!mine && !team.ai && !timedOut) return json({ error: 'not-your-turn' }, 403);
      const player = Number(body.player);
      const place = Number(body.place);
      if (!Number.isFinite(player) || !Number.isFinite(place) || place < -1 || place > 10) return json({ error: 'bad' }, 400);
      if (await redis.sismember(dk(code).taken, String(player))) return json({ error: 'taken' }, 409);
      // kun ét valg pr. nummer, uanset hvor mange der prøver samtidig
      if (!(await redis.set(`room:${code}:dpick:${st.season}:${n}`, me.pid, { nx: true, ex: 86_400 }))) return json({ error: 'stale' }, 409);
      await redis.rpush(dk(code).picks, JSON.stringify({ slot, player, place, auto: !mine || undefined }));
      await redis.sadd(dk(code).taken, String(player));
      const keepers = Number(roomSettings(room).draft?.keepers ?? 0);
      const total = st.order.length * (SQUAD - (st.season > 1 ? keepers : 0));
      await setDraftState(code, n + 1 >= total ? { phase: 'done', pickStart: Date.now() } : { pickStart: Date.now() });
      await touch(code); await touchDraft(code);
      return json(await publicRoom(code));
    }
    case 'dnext': {
      // sæsonafslutningen: manageren klikker videre (værten kan starte uden at vente)
      const me = await auth(code, String(body.pid), String(body.token));
      if (!me) return json({ error: 'auth' }, 403);
      const room = await getRoom(code);
      const st = await draftState(code);
      if (!room || !st || st.phase !== 'summary') return json(await publicRoom(code));
      const teams = await draftTeams(code);
      const mine = teams.find((t) => t.pid === me.pid);
      if (mine) { mine.summaryReady = true; await saveTeam(code, mine); }
      const all = teams.every((t) => t.ai || t.summaryReady || t.pid === me.pid);
      if (all || (body.force && room.host === me.pid)) {
        // picks fra sidste sæson ryddes først nu (afslutningen viser dem)
        await redis.del(dk(code).picks, dk(code).taken);
        await setDraftState(code, { phase: (st.nextPhase as DraftStateRec['phase']) ?? 'draft', pickStart: Date.now(), keepStart: Date.now() });
        if ((st.nextPhase ?? 'draft') === 'draft' && roomSettings(room).draft?.format === 'auction') await startAuction(code, await draftTeams(code));
      }
      await touchDraft(code);
      return json(await publicRoom(code));
    }
    case 'dkeepdone': {
      // keepers er valgt (eller tiden er gået): manglende hold får deres bedste spillere (beregnet af klienten)
      const me = await auth(code, String(body.pid), String(body.token));
      if (!me) return json({ error: 'auth' }, 403);
      const st = await draftState(code);
      if (!st || st.phase !== 'keepers') return json({ error: 'phase' }, 409);
      const teams = await draftTeams(code);
      const allReady = teams.every((t) => t.ai || t.keepReady);
      if (!allReady && Date.now() < st.keepStart + KEEP_MS) return json({ error: 'too-early' }, 409);
      if (!(await redis.set(`room:${code}:dkeep:${st.season}`, me.pid, { nx: true, ex: 86_400 }))) return json(await publicRoom(code));
      const auto = (body.keeps ?? {}) as Record<string, { player: number; place: number }[]>;
      for (const t of teams) {
        if (!(t.keepReady && !t.ai) || !t.keep.length) {
          const k = auto[String(t.slot)];
          if (Array.isArray(k)) t.keep = k.map((x) => ({ slot: t.slot, player: Number(x.player), place: Number(x.place) }));
        }
        await saveTeam(code, t);
        for (const k of t.keep) await redis.sadd(dk(code).taken, String(k.player));
      }
      await setDraftState(code, { phase: 'draft', pickStart: Date.now() });
      { const room = await getRoom(code); if (room && roomSettings(room).draft?.format === 'auction') await startAuction(code, await draftTeams(code)); }
      await touchDraft(code);
      return json(await publicRoom(code));
    }
    // ----- auktionsdraft -----
    case 'dnominate': {
      const me = await auth(code, String(body.pid), String(body.token));
      if (!me) return json({ error: 'auth' }, 403);
      const st = await draftState(code);
      if (!st || st.phase !== 'draft') return json({ error: 'phase' }, 409);
      if (st.auction) return json({ error: 'stale' }, 409);
      const teams = await draftTeams(code);
      const picks = await draftPicks(code);
      const nom = nominatorFrom(st.order, st.nomIdx ?? 0, teams, picks);
      if (!nom) return json({ error: 'phase' }, 409);
      const team = teams.find((t) => t.slot === nom.slot)!;
      const timedOut = Date.now() >= st.pickStart + NOM_MS + 1000;
      if (team.pid !== me.pid && !team.ai && !timedOut) return json({ error: 'not-your-turn' }, 403);
      const player = Number(body.player);
      const bid = Math.round(Number(body.bid));
      if (!Number.isFinite(player) || !(bid >= 1) || bid > maxBid(team, picks)) return json({ error: 'bid' }, 400);
      if (await redis.sismember(dk(code).taken, String(player))) return json({ error: 'taken' }, 409);
      if (!(await redis.set(`room:${code}:dnom:${st.season}:${picks.length}`, me.pid, { nx: true, ex: 86_400 }))) return json({ error: 'stale' }, 409);
      const now = Date.now();
      const auction: AuctionRec = { id: picks.length, player, bid, bidder: team.slot, nominator: team.slot, endsAt: now + AUCTION_MS, lastBid: now, passed: [] };
      // ingen andre mennesker kan byde (fx alene mod AI-hold): kort auktion – AI-holdene byder hurtigt
      if (humansOut(teams, picks, auction)) auction.endsAt = now + 5_000;
      await setDraftState(code, { auction, nomIdx: nom.idx });
      await touchDraft(code);
      return json(await publicRoom(code));
    }
    case 'dbid': {
      const me = await auth(code, String(body.pid), String(body.token));
      if (!me) return json({ error: 'auth' }, 403);
      const st = await draftState(code);
      const a = st?.auction;
      if (!st || st.phase !== 'draft' || !a) return json({ error: 'phase' }, 409);
      if (Date.now() >= a.endsAt) return json({ error: 'closed' }, 409);
      const teams = await draftTeams(code);
      const picks = await draftPicks(code);
      const team = body.slot !== undefined ? teams.find((t) => t.slot === Number(body.slot)) : teams.find((t) => t.pid === me.pid);
      if (!team || (team.pid !== me.pid && !team.ai)) return json({ error: 'not-yours' }, 403);
      if (team.slot === a.bidder) return json({ error: 'leading' }, 409);
      if (a.passed?.includes(team.slot)) return json({ error: 'passed' }, 409);
      if (teamCount(team, picks) >= SQUAD) return json({ error: 'full' }, 409);
      const amount = Math.round(Number(body.amount));
      if (!(amount > a.bid) || amount > maxBid(team, picks)) return json({ error: 'bid' }, 400);
      if (Number(body.id) !== a.id) return json({ error: 'stale' }, 409);
      // kort lås: kun ét bud ad gangen, og kun hvis ingen andre har budt imellem
      const lk = `room:${code}:dbidlock`;
      if (!(await redis.set(lk, me.pid, { nx: true, px: 3000 }))) return json({ error: 'stale' }, 409);
      try {
        const fresh = (await draftState(code))?.auction;
        if (!fresh || fresh.bid !== a.bid || fresh.bidder !== a.bidder || Date.now() >= fresh.endsAt) return json({ error: 'stale' }, 409);
        const now = Date.now();
        const next = { ...fresh, bid: amount, bidder: team.slot, endsAt: Math.max(fresh.endsAt, now + BID_EXTEND_MS), lastBid: now };
        if (humansOut(teams, picks, next)) next.endsAt = Math.min(next.endsAt, now + PASS_END_MS);
        await setDraftState(code, { auction: next });
      } finally { await redis.del(lk); }
      await touchDraft(code);
      return json(await publicRoom(code));
    }
    case 'dpass': {
      // "jeg melder pas": klubben byder ikke mere på denne spiller
      const me = await auth(code, String(body.pid), String(body.token));
      if (!me) return json({ error: 'auth' }, 403);
      const st = await draftState(code);
      const a = st?.auction;
      if (!st || st.phase !== 'draft' || !a || Number(body.id) !== a.id) return json({ error: 'stale' }, 409);
      const teams = await draftTeams(code);
      const picks = await draftPicks(code);
      const team = teams.find((t) => t.pid === me.pid);
      if (!team || team.slot === a.bidder) return json({ error: 'leading' }, 409);
      const lk = `room:${code}:dbidlock`;
      if (!(await redis.set(lk, me.pid, { nx: true, px: 3000 }))) return json({ error: 'stale' }, 409);
      try {
        const fresh = (await draftState(code))?.auction;
        if (!fresh || fresh.id !== a.id) return json({ error: 'stale' }, 409);
        const next = { ...fresh, passed: [...new Set([...(fresh.passed ?? []), team.slot])] };
        if (humansOut(teams, picks, next)) next.endsAt = Math.min(next.endsAt, Date.now() + PASS_END_MS);
        await setDraftState(code, { auction: next });
      } finally { await redis.del(lk); }
      await touchDraft(code);
      return json(await publicRoom(code));
    }
    case 'dresolve': {
      // auktionen er slut: højeste bud vinder (klienten angiver pladsen, den regner ud fra puljen)
      const me = await auth(code, String(body.pid), String(body.token));
      if (!me) return json({ error: 'auth' }, 403);
      const room = await getRoom(code);
      const st = await draftState(code);
      const a = st?.auction;
      if (!room || !st || st.phase !== 'draft' || !a) return json({ error: 'phase' }, 409);
      if (Date.now() < a.endsAt) return json({ error: 'too-early' }, 409);
      if (!(await redis.set(`room:${code}:dres:${st.season}:${a.id}`, me.pid, { nx: true, ex: 86_400 }))) return json({ error: 'stale' }, 409);
      const place = Number(body.place);
      if (!Number.isFinite(place) || place < -1 || place > 10) return json({ error: 'bad' }, 400);
      const teams = await draftTeams(code);
      const winner = teams.find((t) => t.slot === a.bidder)!;
      await redis.rpush(dk(code).picks, JSON.stringify({ slot: winner.slot, player: a.player, place, price: a.bid }));
      await redis.sadd(dk(code).taken, String(a.player));
      winner.budget = (winner.budget ?? BUDGET) - a.bid;
      await saveTeam(code, winner);
      const picks = await draftPicks(code);
      const keepers = Number(roomSettings(room).draft?.keepers ?? 0);
      const total = st.order.length * (SQUAD - (st.season > 1 ? keepers : 0));
      const next = nominatorFrom(st.order, (st.nomIdx ?? 0) + 1, teams.map((t) => (t.slot === winner.slot ? winner : t)), picks);
      await setDraftState(code, picks.length >= total || !next ? { phase: 'done', auction: null, pickStart: Date.now() } : { auction: null, nomIdx: next.idx, pickStart: Date.now() });
      await touch(code); await touchDraft(code);
      return json(await publicRoom(code));
    }
    case 'dbuildlock': {
      // draften er færdig: én klient bygger sæsonens spil
      const me = await auth(code, String(body.pid), String(body.token));
      if (!me) return json({ error: 'auth' }, 403);
      const st = await draftState(code);
      if (!st || st.phase !== 'done') return json({ error: 'phase' }, 409);
      const ok = await redis.set(`room:${code}:dbuild:${st.season}`, me.pid, { nx: true, ex: 120 });
      return json({ ok: !!ok });
    }
    case 'dbuilt': {
      const me = await auth(code, String(body.pid), String(body.token));
      if (!me) return json({ error: 'auth' }, 403);
      const room = await getRoom(code);
      const st = await draftState(code);
      if (!room || !st || st.phase !== 'done') return json({ error: 'phase' }, 409);
      if ((await redis.get<string>(`room:${code}:dbuild:${st.season}`)) !== me.pid) return json({ error: 'no-lock' }, 409);
      const snapshot = String(body.url ?? '');
      if (!snapshot.includes('.blob.vercel-storage.com/')) return json({ error: 'url' }, 400);
      if (room.prevSnapshot) { try { await del(room.prevSnapshot); } catch { /* ignorér */ } }
      const actions = await redis.llen(keys.actions);
      await redis.hset(keys.room, {
        version: room.version + 1, snapshot, prevSnapshot: room.snapshot || '', lastApplied: actions,
        date: String(body.date ?? ''), status: 'playing', lastTurn: new Date().toISOString(),
      });
      for (const p of await getPlayers(code)) if (p.ready || p.auto) { p.ready = false; p.auto = false; await savePlayer(code, p); }
      await redis.del(keys.lock);
      await setDraftState(code, { phase: 'playing' });
      await touch(code); await touchDraft(code);
      return json(await publicRoom(code));
    }
    case 'dseason': {
      // sæsonen er slut: næste draft (sidst placerede vælger først)
      const me = await auth(code, String(body.pid), String(body.token));
      if (!me) return json({ error: 'auth' }, 403);
      const room = await getRoom(code);
      const st = await draftState(code);
      if (!room || !st || st.phase !== 'playing') return json({ error: 'phase' }, 409);
      if (Number(body.season) !== st.season) return json({ error: 'stale' }, 409);
      const teams = await draftTeams(code);
      const order = (Array.isArray(body.order) ? body.order.map(Number) : []).filter((x: number) => teams.some((t) => t.slot === x));
      if (order.length !== teams.length || new Set(order).size !== order.length) return json({ error: 'order' }, 400);
      const keepers = Number(roomSettings(room).draft?.keepers ?? 0);
      for (const t of teams) { t.keep = []; t.keepReady = false; t.summaryReady = false; await saveTeam(code, t); }
      // først en afslutning med tabel og statistik – næste fase starter, når alle har klikket videre
      await setDraftState(code, { phase: 'summary', nextPhase: keepers > 0 ? 'keepers' : 'draft', season: st.season + 1, order });
      await touch(code); await touchDraft(code);
      return json(await publicRoom(code));
    }
    default:
      return json({ error: 'op' }, 400);
  }
}

async function upload(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const p = JSON.parse(clientPayload ?? '{}') as { code?: string; pid?: string; token?: string };
        const code = String(p.code ?? '').toUpperCase();
        const me = await auth(code, String(p.pid), String(p.token));
        if (!me || !pathname.startsWith(`rooms/${code}/`)) throw new Error('auth');
        return {
          allowedContentTypes: ['application/gzip', 'application/octet-stream'],
          maximumSizeInBytes: 60 * 1024 * 1024,
          addRandomSuffix: true,
        };
      },
    });
    return json(result);
  } catch (e) {
    return json({ error: String((e as Error).message) }, 400);
  }
}
