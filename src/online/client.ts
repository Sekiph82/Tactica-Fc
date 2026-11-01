// Online multiplayer – klientsiden.
//
// Flow pr. træk:
//  1. Alle managere laver ændringer. Hver ændring er en Action, der anvendes lokalt og sendes til serveren.
//  2. Man trykker "Klar". Når alle er klar, tager én klient låsen.
//  3. Den klient tager det uberørte øjebliksbillede, afspiller alle handlinger i rækkefølge,
//     simulerer frem til efter næste kampdag (mpAdvance) og uploader et nyt øjebliksbillede.
//  4. De andre opdager den nye version, henter den og genanvender egne handlinger der ikke nåede med.
import { upload } from '@vercel/blob/client';
import { applyActionAs, setActionSink, type Action } from '../game/actions';
import { activate, enableMultiplayer, withHuman } from '../game/humans';
import { setupBots, type BotScope } from '../game/bots';
import { createGame, type NewGameOptions, type WorldData } from '../game/newgame';
import { rng } from '../game/rng';
import { mpAdvance } from '../game/sim';
import { deserializeState, serializeState } from '../game/snapshot';
import { addNews, gs, notify, setGame } from '../game/state';
import { rememberLast } from '../game/save';
import { browserPlatform } from '../platform/browser';
import type { Tactic } from '../game/types';
import type { DraftSettings, GameState } from '../game/types';
import { BENCH_PLACE, KEEPER_SECONDS, NOM_SECONDS, PICK_SECONDS, aiBidLimit, allKeepers, autoKeepers, autoPick, buildDraftGame, clubIdOf, draftPool, nextDraftOrder, nominatorSlot, openPlaces, placesFor, slotForPick, type DraftPick, type DraftTeam } from '../game/draft';
import { getLang } from '../i18n';
import { loadWorld } from '../ui/world';

export interface RoomInfo {
  code: string;
  host: string;
  status: 'setup' | 'playing';
  version: number;
  snapshot: string;
  date: string;
  lastApplied: number;
  actionCount: number;
  settings: { nations?: number[]; leagues?: string[]; seed?: number; masking?: boolean; deadlineHours?: number; mode?: 'draft'; draft?: DraftSettings };
  processing: string | null;
  lastTurn: string;
  players: { pid: string; name: string; club: number; ready: boolean; joined: string; auto?: boolean }[];
  chat?: RoomChat[];
  /** Draft-liga: fase, rækkefølge, hold og valg */
  draft?: DraftRoomInfo;
  /** Hvem er med i voice-chatten */
  voice?: string[];
}

export interface DraftRoomInfo {
  phase: 'lobby' | 'summary' | 'keepers' | 'draft' | 'done' | 'playing';
  season: number;
  order: number[];
  pickStart: number;
  keepStart: number;
  teams: DraftTeam[];
  picks: DraftPick[];
  /** Serverens ur (til nedtællingen) */
  now: number;
  /** Auktion: den igangværende auktion og hvem der nominerer */
  auction?: { id: number; player: number; bid: number; bidder: number; nominator: number; endsAt: number; lastBid: number; passed?: number[] } | null;
  nomIdx?: number;
}

/** Udeholdets ændringer under en kamp mellem to managere */
export type LiveCmd = { k: 'sub'; out: number; inn: number } | { k: 'ment'; v: number } | { k: 'ready' } | { k: 'ping' } | { k: 'talk'; boosts: Record<number, number> } | { k: 'tactic'; tac: Tactic } | { k: 'speed'; v: number };
/** Kampe udeholdet har valgt at lade assistenten tage (hjemmeholdet dukkede ikke op) */
export const skippedMatches = new Set<number>();

export interface RoomChat {
  id: number;
  from: string;
  name: string;
  to: string;
  text: string;
  at: string;
}

export interface Credentials {
  code: string;
  pid: string;
  token: string;
  name: string;
}

const API = '/api/mp';
const STORE = 'cm0102.online';

// ---------- gemte rum ----------

export function savedRooms(): Credentials[] {
  try { return JSON.parse(localStorage.getItem(STORE) ?? '[]') as Credentials[]; } catch { return []; }
}

function rememberRoom(c: Credentials) {
  const list = savedRooms().filter((x) => x.code !== c.code);
  list.unshift(c);
  try { localStorage.setItem(STORE, JSON.stringify(list.slice(0, 10))); } catch { /* ignore */ }
}

export function forgetRoom(code: string) {
  try { localStorage.setItem(STORE, JSON.stringify(savedRooms().filter((x) => x.code !== code))); } catch { /* ignore */ }
}

// ---------- HTTP ----------

export async function mpPost<T>(op: string, body: Record<string, unknown>): Promise<T> { return post<T>(op, body); }

async function post<T>(op: string, body: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${API}?op=${op}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? `http ${r.status}`);
  return data as T;
}

export async function fetchRoom(code: string): Promise<RoomInfo> {
  const r = await fetch(`${API}?code=${encodeURIComponent(code.toUpperCase())}`, { cache: 'no-store' });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? `http ${r.status}`);
  return data as RoomInfo;
}

async function encodeSnapshot(state: GameState): Promise<Uint8Array> {
  return browserPlatform.snapshots.encode(serializeState(state));
}

async function decodeSnapshot(snapshot: Uint8Array): Promise<GameState> {
  return deserializeState(await browserPlatform.snapshots.decode(snapshot));
}

export async function downloadSnapshot(url: string): Promise<{ snapshot: Uint8Array; state: GameState }> {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`snapshot ${r.status}`);
  const snapshot = new Uint8Array(await r.arrayBuffer());
  return { snapshot, state: await decodeSnapshot(snapshot) };
}

async function uploadSnapshot(c: Credentials, version: number, snapshot: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(snapshot.byteLength);
  new Uint8Array(buffer).set(snapshot);
  const blob = new Blob([buffer]);
  const res = await upload(`rooms/${c.code}/v${version}.json.gz`, blob, {
    access: 'public',
    handleUploadUrl: `${API}?op=upload`,
    clientPayload: JSON.stringify({ code: c.code, pid: c.pid, token: c.token }),
    contentType: 'application/gzip',
    multipart: snapshot.byteLength > 4 * 1024 * 1024,
  });
  return res.url;
}

// ---------- session ----------

type Listener = () => void;

export class OnlineSession {
  creds: Credentials;
  room: RoomInfo | null = null;
  version = 0;
  /** Uberørt kopi af det seneste øjebliksbillede (bruges når vi selv skal simulere) */
  private pristine: Uint8Array | null = null;
  /** Egne handlinger der endnu ikke er sendt */
  private outbox: Action[] = [];
  /** Egne handlinger sendt til serveren, men ikke indarbejdet i et øjebliksbillede: [serverIdx, action] */
  private sent: [number, Action][] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  status: 'idle' | 'loading' | 'processing' | 'error' = 'idle';
  error = '';
  lastTurn: { days: number; reason: string } | null = null;
  private listeners = new Set<Listener>();

  constructor(creds: Credentials) {
    this.creds = creds;
  }

  on(l: Listener) {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  }

  private emit() {
    for (const l of this.listeners) l();
    notify();
  }

  get me() {
    return this.room?.players.find((p) => p.pid === this.creds.pid);
  }

  /** Er jeg med i spillets øjebliksbillede endnu? (nye spillere kommer med ved næste træk) */
  get inGame(): boolean {
    try { return !!gs().humans?.some((h) => h.pid === this.creds.pid); } catch { return false; }
  }

  async start() {
    setActionSink((a) => this.enqueue(a));
    await this.refresh(true);
    // under en draft opdateres der hyppigt (live), ellers hvert 3,5 sekund
    this.pollTimer = setInterval(() => {
      const live = this.draftLive();
      if (live || Date.now() - this.lastRefresh >= 3400) void this.refresh(false);
    }, 1200);
  }

  private lastRefresh = 0;
  /** Forskel mellem serverens og vores ur (ms) */
  clockSkew = 0;

  /** Er rummet en draft-liga, der ikke er i gang med at spille kampe? */
  draftLive(): boolean {
    const d = this.room?.draft;
    return !!d && d.phase !== 'playing';
  }

  serverNow() { return Date.now() + this.clockSkew; }

  stop() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    setActionSink(null);
  }

  // ----- handlinger -----

  private enqueue(a: Action) {
    // samlede taktikændringer: kun den sidste behøver at blive sendt
    if (a.t === 'tactic') this.outbox = this.outbox.filter((x) => x.t !== 'tactic');
    this.outbox.push(a);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => { void this.flush(); }, 700);
  }

  async flush() {
    if (!this.outbox.length) return;
    const batch = this.outbox;
    this.outbox = [];
    try {
      const { last } = await post<{ last: number }>('actions', { ...this.creds, actions: batch });
      batch.forEach((a, i) => this.sent.push([last - batch.length + i + 1, a]));
      if (this.room) {
        const me = this.room.players.find((p) => p.pid === this.creds.pid);
        if (me) me.ready = false;
      }
      this.emit();
    } catch (e) {
      this.outbox = [...batch, ...this.outbox];
      this.error = String((e as Error).message);
      this.emit();
    }
  }

  // ----- beskeder til andre mennesker -----

  // ----- live-kamp mellem to managere -----
  async livePush(fixture: number, data: unknown): Promise<LiveCmd[]> {
    const r = await post<{ cmds: LiveCmd[] }>('livepush', { ...this.creds, fixture, data });
    return r.cmds ?? [];
  }

  async liveGet<T>(fixture: number): Promise<T | null> {
    const r = await post<{ data: T | null }>('liveget', { ...this.creds, fixture });
    return r.data;
  }

  async liveCmd(fixture: number, cmd: LiveCmd) {
    await post('livecmd', { ...this.creds, fixture, cmd });
  }

  async sendChat(to: string, text: string) {
    const rec = await post<RoomChat>('chat', { ...this.creds, to, text });
    if (this.room) this.room.chat = [...(this.room.chat ?? []), rec];
    this.emit();
  }

  /** Ulæste beskeder fra andre mennesker (husket pr. rum i denne browser) */
  chatSeen(): number {
    try { return Number(localStorage.getItem(`cm0102.chatSeen.${this.creds.code}`) ?? 0); } catch { return 0; }
  }

  markChatSeen() {
    const last = this.room?.chat?.at(-1)?.id ?? 0;
    try { localStorage.setItem(`cm0102.chatSeen.${this.creds.code}`, String(last)); } catch { /* ignorer */ }
    this.emit();
  }

  unreadChat(): number {
    const seen = this.chatSeen();
    return (this.room?.chat ?? []).filter((m) => m.id > seen && m.from !== this.creds.pid && (m.to === 'all' || m.to === this.creds.pid)).length;
  }

  // ----- draft-liga -----

  private async dpost(op: string, body: Record<string, unknown> = {}) {
    this.room = await post<RoomInfo>(op, { ...this.creds, ...body });
    this.emit();
    if (this.draftLive()) void this.draftDuty();
  }

  get myDraftTeam(): DraftTeam | undefined {
    return this.room?.draft?.teams.find((t) => t.pid === this.creds.pid);
  }

  draftPick(player: number, place: number) { return this.dpost('dpick', { n: this.room?.draft?.picks.length ?? 0, player, place }); }
  draftTeam(team: Partial<DraftTeam>, slot?: number) { return this.dpost('dteam', { team, slot }); }
  draftAddAI(team: Partial<DraftTeam>) { return this.dpost('dai', { team }); }
  draftRemoveAI(slot: number) { return this.dpost('dai', { remove: slot }); }
  draftSettings(draft: Partial<DraftSettings>, deadlineHours?: number) { return this.dpost('dsettings', { draft, deadlineHours }); }
  draftStart() { return this.dpost('dstart'); }
  draftNext(force = false) { return this.dpost('dnext', { force }); }
  draftNominate(player: number, bid: number) { return this.dpost('dnominate', { player, bid }); }
  draftBid(amount: number) { return this.dpost('dbid', { amount, id: this.room?.draft?.auction?.id }); }
  draftPass() { return this.dpost('dpass', { id: this.room?.draft?.auction?.id }); }

  private duty = false;
  /**
   * Draftens automatik, som klienterne skiftes til at udføre (serveren kan ikke regne på spillerne):
   * AI-holdenes valg, valg når tiden er løbet ud, manglende keepers og opbygning af sæsonen.
   * Værten gør det straks; de andre kun hvis værten ikke er online (efter en forsinkelse).
   */
  private async draftDuty() {
    const room = this.room;
    const d = room?.draft;
    if (!room || !d || this.duty) return;
    const others = room.players.map((p) => p.pid).filter((p) => p !== room.host).sort();
    const backup = (base: number) => (this.isHost ? 0 : base + Math.max(0, others.indexOf(this.creds.pid)) * 2500);
    const now = this.serverNow();
    this.duty = true;
    try {
      if (d.phase === 'draft' && room.settings.draft?.format === 'auction') {
        await this.auctionDuty(room, now, backup);
      } else if (d.phase === 'draft') {
        const n = d.picks.length;
        const team = d.teams.find((t) => t.slot === slotForPick(d.order, n));
        if (!team) return;
        const timedOut = now >= d.pickStart + PICK_SECONDS * 1000 + 1200;
        if (!team.ai && !timedOut) return;
        // AI-hold tænker lidt, så draften kan følges
        const wait = (team.ai ? Math.max(0, d.pickStart + 1500 - now) : 0) + backup(team.ai ? 4000 : 3000);
        if (wait) await new Promise((r) => setTimeout(r, wait));
        const fresh = await fetchRoom(this.creds.code);
        this.room = fresh;
        if (fresh.draft?.phase !== 'draft' || fresh.draft.picks.length !== n) return;
        const world = await loadWorld();
        const pool = draftPool(world, room.settings.seed ?? 1, world.season, room.settings.draft?.pool ?? '');
        const pk = autoPick(team, fresh.draft.picks, pool, allKeepers(fresh.draft.teams), room.settings.draft?.injuries ?? true);
        if (!pk) return;
        try { this.room = await post<RoomInfo>('dpick', { ...this.creds, n, player: pk.player, place: pk.place }); } catch { /* en anden nåede det */ }
      } else if (d.phase === 'keepers') {
        const allReady = d.teams.every((t) => t.ai || t.keepReady);
        if (!allReady && now < d.keepStart + KEEPER_SECONDS * 1000 + 1000) return;
        const wait = backup(4000);
        if (wait) await new Promise((r) => setTimeout(r, wait));
        const state = gs();
        const k = state.draft?.settings.keepers ?? 0;
        const keeps = Object.fromEntries(d.teams.map((t) => [t.slot, autoKeepers(clubIdOf(t.slot), k, state).map((x) => ({ player: x.player, place: x.place }))]));
        try { this.room = await post<RoomInfo>('dkeepdone', { ...this.creds, keeps }); } catch { /* allerede gjort */ }
      } else if (d.phase === 'done') {
        const wait = backup(15000);
        if (wait) await new Promise((r) => setTimeout(r, wait));
        const lock = await post<{ ok: boolean }>('dbuildlock', { ...this.creds });
        if (!lock.ok) return;
        this.status = 'processing';
        this.emit();
        const world = await loadWorld();
        const fresh = await fetchRoom(this.creds.code);
        const fd = fresh.draft!;
        let prev: GameState['draft'];
        try { prev = gs().draft; } catch { prev = undefined; }
        const state = buildDraftGame({
          world, seed: room.settings.seed ?? 1, season: fd.season, lang: getLang(),
          settings: room.settings.draft ?? { rounds: 2, playoff: 'none', keepers: 0, injuries: true },
          teams: fd.teams, picks: fd.picks, hostPid: this.creds.pid, prev,
        });
        state.lastActionIdx = fresh.actionCount;
        const snapshot = await encodeSnapshot(state);
        const url = await uploadSnapshot(this.creds, fresh.version + 1, snapshot);
        this.room = await post<RoomInfo>('dbuilt', { ...this.creds, url, date: state.date });
        this.status = 'idle';
        await this.loadVersion(this.room);
      }
    } catch (e) {
      this.status = 'idle';
      // kapløb mellem klienterne (en anden nåede det først) er ikke fejl
      const m = String((e as Error).message);
      if (!['phase', 'stale', 'locked', 'too-early', 'no-lock', 'taken'].includes(m)) this.error = m;
    } finally {
      this.duty = false;
      this.emit();
    }
  }

  /** Auktionens automatik: AI nominerer og byder, tiden løber ud, vinderen findes */
  private async auctionDuty(room: RoomInfo, now: number, backup: (base: number) => number) {
    const d = room.draft!;
    const gk = room.settings.draft?.injuries ?? true;
    const world = await loadWorld();
    const pool = draftPool(world, room.settings.seed ?? 1, world.season, room.settings.draft?.pool ?? '');
    const byId = Object.fromEntries(pool.map((p) => [p.id, p]));
    const a = d.auction;
    const post2 = async (op: string, body: Record<string, unknown>) => { try { this.room = await post<RoomInfo>(op, { ...this.creds, ...body }); } catch { /* en anden nåede det */ } };
    if (a) {
      if (now >= a.endsAt + 300) {
        // tiden er gået: vinderen får spilleren på den bedste ledige plads
        const wait = backup(2500);
        if (wait) await new Promise((r) => setTimeout(r, wait));
        const fresh = await fetchRoom(this.creds.code);
        const fa = fresh.draft?.auction;
        if (!fa || fa.id !== a.id) return;
        const winner = fresh.draft!.teams.find((t) => t.slot === fa.bidder);
        const p = byId[fa.player];
        if (!winner || !p) return;
        const places = placesFor(winner, fresh.draft!.picks, p, byId, gk);
        const open = openPlaces(winner, fresh.draft!.picks);
        const place = places[0] ?? (open.bench > 0 ? BENCH_PLACE : open.starters[0] ?? BENCH_PLACE);
        await post2('dresolve', { place });
        return;
      }
      // AI-holdene byder (værten; de andre kun hvis værten er væk)
      if (!this.isHost && now - a.lastBid < 6000) return;
      if (now - a.lastBid < 1200 + (a.id % 5) * 250) return;
      const p = byId[a.player];
      if (!p) return;
      const bidders = d.teams.filter((t) => t.ai && t.slot !== a.bidder)
        .map((t) => ({ t, limit: aiBidLimit(t, d.picks, p, byId, gk) }))
        .filter((x) => x.limit > a.bid)
        .sort((x, y) => y.limit - x.limit);
      const best = bidders[0];
      if (!best) return;
      const step = a.bid < 20 ? 1 : a.bid < 60 ? 2 : 5;
      // to AI-hold, der vil have samme spiller: den ivrigste byder lige over den næstivrigste
      const amount = Math.min(best.limit, Math.max(a.bid + step, bidders[1] ? Math.min(best.limit, bidders[1].limit + 1) : a.bid + step));
      await post2('dbid', { slot: best.t.slot, id: a.id, amount });
      return;
    }
    // ingen auktion: den næste nominerer (AI straks, mennesker inden for tidsfristen)
    const slot = nominatorSlot(d.order, d.nomIdx ?? 0, d.teams, d.picks);
    const team = d.teams.find((t) => t.slot === slot);
    if (!team) return;
    const timedOut = now >= d.pickStart + NOM_SECONDS * 1000 + 1200;
    if (!team.ai && !timedOut) return;
    const wait = (team.ai ? Math.max(0, d.pickStart + 1800 - now) : 0) + backup(team.ai ? 4000 : 3000);
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const fresh = await fetchRoom(this.creds.code);
    if (fresh.draft?.auction || fresh.draft?.picks.length !== d.picks.length) return;
    const pk = autoPick(team, fresh.draft.picks, pool, allKeepers(fresh.draft.teams), gk);
    if (!pk) return;
    const bid = team.ai ? Math.max(1, Math.round(aiBidLimit(team, fresh.draft.picks, byId[pk.player], byId, gk) * 0.4)) : 1;
    await post2('dnominate', { player: pk.player, bid });
  }

  // ----- klar / synkronisering -----

  /** Er jeg værten (den der startede spillet)? */
  get isHost(): boolean {
    return !!this.room && this.room.host === this.creds.pid;
  }

  /** Værten: tving trækket igennem uden at vente på de andre */
  async forceContinue() {
    await this.flush();
    this.room = await post<RoomInfo>('force', { ...this.creds });
    this.emit();
    await this.maybeProcess();
  }

  /** Værten: fjern en spiller fra spillet – klubben får en AI-manager */
  async kick(target: string) {
    await this.flush();
    this.room = await post<RoomInfo>('kick', { ...this.creds, target });
    this.emit();
    await this.maybeProcess();
  }

  async setReady(ready: boolean) {
    await this.flush();
    this.room = await post<RoomInfo>('ready', { ...this.creds, ready });
    this.emit();
    if (ready) await this.maybeProcess();
  }

  async refresh(force: boolean) {
    if (this.busy) return;
    this.lastRefresh = Date.now();
    try {
      const t0 = Date.now();
      const room = await fetchRoom(this.creds.code);
      if (room.draft) this.clockSkew = room.draft.now - (t0 + Date.now()) / 2;
      this.room = room;
      if (room.version > this.version || (force && room.snapshot)) {
        await this.loadVersion(room);
      }
      this.emit();
      if (this.draftLive()) { await this.draftDuty(); return; }
      await this.maybeProcess();
    } catch (e) {
      this.error = String((e as Error).message);
      this.emit();
    }
  }

  private async loadVersion(room: RoomInfo) {
    if (!room.snapshot) return;
    this.status = 'loading';
    this.emit();
    const { snapshot, state } = await downloadSnapshot(room.snapshot);
    this.pristine = snapshot;
    this.version = room.version;
    setGame(state);
    if (state.humans?.some((h) => h.pid === this.creds.pid)) activate(this.creds.pid, state);
    // genanvend egne handlinger der ikke nåede med i dette træk
    const applied = state.lastActionIdx ?? 0;
    this.sent = this.sent.filter(([idx]) => idx > applied);
    if (state.humans?.some((h) => h.pid === this.creds.pid)) {
      for (const [, a] of this.sent) applyActionAs(this.creds.pid, a);
      for (const a of this.outbox) applyActionAs(this.creds.pid, a);
    }
    this.status = 'idle';
    this.emit();
  }

  /** Hvornår udløber trækkets frist (ms siden epoch), eller null hvis rummet ikke har en frist */
  deadline(): number | null {
    const h = this.room?.settings?.deadlineHours;
    if (!h || !this.room?.lastTurn) return null;
    return Date.parse(this.room.lastTurn) + h * 3_600_000;
  }

  private async maybeProcess() {
    const room = this.room;
    if (!room || this.busy || room.processing) return;
    if (room.draft && room.draft.phase !== 'playing') return;
    // fristen er udløbet: gør de manglende klar (deres assistent tager over i trækket)
    const dl = this.deadline();
    if (dl && Date.now() >= dl && room.players.some((p) => !p.ready)) {
      try { this.room = await post<RoomInfo>('autoready', { ...this.creds }); this.emit(); } catch { return; }
    }
    if (!room.players.length || !room.players.every((p) => p.ready)) return;
    if (room.version !== this.version) return;
    // Værten simulerer trækket. De andre tager kun over, hvis værten ikke er online (efter 45 sek.),
    // og så i fast rækkefølge, så ikke alle forsøger samtidig
    const order = room.players.map((p) => p.pid).filter((pid) => pid !== room.host).sort();
    const delay = this.isHost ? 0 : 45_000 + Math.max(0, order.indexOf(this.creds.pid)) * 4000;
    if (delay) {
      await new Promise((r) => setTimeout(r, delay));
      try { this.room = await fetchRoom(this.creds.code); } catch { return; }
      if (this.room.processing || this.room.version !== this.version || !this.room.players.every((p) => p.ready)) return;
    }
    await this.process();
  }

  /** Tag låsen og simulér næste træk */
  private async process() {
    if (this.busy || !this.pristine) return;
    this.busy = true;
    let locked = false;
    try {
      const res = await post<{ ok: boolean; actions: { idx: number; pid: string; a: Action }[] }>('lock', { ...this.creds, version: this.version });
      locked = res.ok;
      this.status = 'processing';
      this.emit();
      await new Promise((r) => setTimeout(r, 30));
      const state = await decodeSnapshot(this.pristine);
      setGame(state);
      let last = state.lastActionIdx ?? 0;
      for (const { idx, pid, a } of res.actions) {
        if (idx <= last) continue;
        applyActionAs(pid, a);
        last = idx;
      }
      state.lastActionIdx = last;
      // spillere der ikke nåede at trykke Klar: deres assistent styrer trækket
      const auto = new Set((this.room?.players ?? []).filter((p) => p.auto).map((p) => p.pid));
      for (const h of state.humans ?? []) if (auto.has(h.pid)) h.autopilot = true;
      // hvis nogen stadig ikke er med i spillet (fx deres join fejlede), springes de over
      this.lastTurn = mpAdvance();
      for (const h of state.humans ?? []) if (h.autopilot) { h.autopilot = false; withHuman(h.pid, () => addNews({ cat: 'general', key: 'mp.autopilot', params: { days: this.lastTurn?.days ?? 0 } })); }
      state.rng = rng.state;
      const snapshot = await encodeSnapshot(state);
      const url = await uploadSnapshot(this.creds, this.version + 1, snapshot);
      this.room = await post<RoomInfo>('commit', { ...this.creds, version: this.version + 1, url, lastApplied: last, date: state.date });
      locked = false;
      // draft-liga: sæsonen er slut – næste draft begynder (sidst placerede vælger først)
      if (state.draft?.seasonOver) {
        try { this.room = await post<RoomInfo>('dseason', { ...this.creds, season: state.draft.season, order: nextDraftOrder() }); } catch { /* en anden nåede det */ }
      }
      this.pristine = snapshot;
      this.version += 1;
      if (state.humans?.some((h) => h.pid === this.creds.pid)) activate(this.creds.pid, state);
      this.sent = this.sent.filter(([idx]) => idx > last);
      for (const [, a] of this.sent) applyActionAs(this.creds.pid, a);
      this.status = 'idle';
    } catch (e) {
      const msg = String((e as Error).message);
      if (msg !== 'locked' && msg !== 'not-ready' && msg !== 'version') { this.status = 'error'; this.error = msg; }
      else this.status = 'idle';
      if (locked) { try { await post('unlock', { ...this.creds }); } catch { /* ignore */ } }
      // gendan vores egen visning
      if (this.pristine) await this.loadVersion({ ...(this.room as RoomInfo), version: this.version });
    } finally {
      this.busy = false;
      this.emit();
    }
  }
}

let current: OnlineSession | null = null;

export function session(): OnlineSession | null {
  return current;
}

export async function openSession(c: Credentials): Promise<OnlineSession> {
  current?.stop();
  rememberRoom(c);
  rememberLast({ kind: 'online', code: c.code });
  current = new OnlineSession(c);
  await current.start();
  return current;
}

export function closeSession() {
  current?.stop();
  current = null;
}

// ---------- opret / deltag ----------

/** Opret et nyt online spil: værten opretter verden lokalt og uploader første version */
export async function createOnlineGame(world: WorldData, o: NewGameOptions, bots?: { count: number; scope: BotScope }): Promise<OnlineSession> {
  const created = await post<{ code: string; pid: string; token: string }>('create', {
    name: o.managerName, club: o.clubId, settings: { nations: o.activeNations, leagues: o.activeLeagues, seed: o.seed, masking: o.masking, deadlineHours: o.deadlineHours ?? 0 },
  });
  const creds: Credentials = { code: created.code, pid: created.pid, token: created.token, name: o.managerName };
  createGame(world, o);
  enableMultiplayer(creds.pid, o.managerName);
  if (bots?.count) setupBots(bots.count, bots.scope);
  const state = gs();
  state.lastActionIdx = 0;
  const snapshot = await encodeSnapshot(state);
  const url = await uploadSnapshot(creds, 1, snapshot);
  await post('commit', { ...creds, version: 1, url, lastApplied: 0, date: state.date });
  return openSession(creds);
}

export async function joinOnlineGame(code: string, name: string, club: number, nation: number): Promise<OnlineSession> {
  const j = await post<{ code: string; pid: string; token: string }>('join', { code, name, club, nation });
  return openSession({ code: j.code, pid: j.pid, token: j.token, name });
}

// ---------- draft-liga ----------

/** Opret en draft-liga: værten opretter sin klub; spillet bygges først, når draften er færdig */
export async function createDraftLeague(name: string, team: Partial<DraftTeam>, draft: DraftSettings, deadlineHours: number): Promise<OnlineSession> {
  const seed = (Math.random() * 2 ** 31) >>> 0;
  const created = await post<{ code: string; pid: string; token: string }>('create', { name, team, settings: { mode: 'draft', seed, draft, deadlineHours } });
  return openSession({ code: created.code, pid: created.pid, token: created.token, name });
}

export async function joinDraftLeague(code: string, name: string, team: Partial<DraftTeam>): Promise<OnlineSession> {
  const j = await post<{ code: string; pid: string; token: string }>('join', { code, name, team });
  return openSession({ code: j.code, pid: j.pid, token: j.token, name });
}
