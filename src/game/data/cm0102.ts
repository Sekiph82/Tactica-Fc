// Import af den originale Championship Manager 01/02-database fra spillerens EGEN installation.
//
// Databasen er ophavsretligt beskyttet og følger derfor ikke med spillet: brugeren vælger sin
// "Data"-mappe fra den gratis udgave (2008), og filerne læses og konverteres lokalt i browseren.
// Filformatet (index.dat + faste poststørrelser) er beskrevet af fællesskabets værktøjer
// (TransferTool, CM0102Patcher); omregningen af "intrinsiske" evner følger CM0102Patcher.
import type { WorldData } from '../newgame';

export const CM_REQUIRED = ['index.dat', 'staff.dat', 'club.dat', 'nation.dat', 'club_comp.dat', 'first_names.dat', 'second_names.dat', 'common_names.dat'];

/** Spillerevner fra CM-databasen (overskriver de afledte evner ved spilstart) */
export interface CMRatings { ca: number; pa: number; attrs: number[]; pos: number[]; side: number[] }

export interface CMWorld extends WorldData {
  kind: 'cm0102';
  ratings: Record<number, CMRatings>;
  clubRep: Record<number, number>;
  clubColors: Record<number, [string, string]>;
  rules: Record<string, { rounds: number; relegated?: number; below?: string; promoted?: number; above?: string; cup?: string; wealth: number }>;
}

const dec = new TextDecoder('windows-1252');
/** Antal rækker pr. land der importeres (flere gør simulationen langsom) */
const MAX_TIERS = 2;

class Reader {
  v: DataView;
  buf: ArrayBuffer;
  constructor(buf: ArrayBuffer) { this.buf = buf; this.v = new DataView(buf); }
  i32(o: number) { return this.v.getInt32(o, true); }
  i16(o: number) { return this.v.getInt16(o, true); }
  u8(o: number) { return this.v.getUint8(o); }
  i8(o: number) { return this.v.getInt8(o); }
  str(o: number, len: number) {
    const bytes = new Uint8Array(this.buf, o, len);
    const end = bytes.indexOf(0);
    return dec.decode(bytes.subarray(0, end < 0 ? len : end)).trim();
  }
  /** CM-dato: dag i året (0-baseret) + år */
  date(o: number): string | null {
    const day = this.i16(o), year = this.i16(o + 2);
    if (year <= 1900 || year > 2100) return null;
    const d = new Date(Date.UTC(year, 0, 1 + Math.max(0, day)));
    return d.toISOString().slice(0, 10);
  }
}

/** Omregning af intrinsiske evner til 1-20 (som spillet selv viser dem) */
function convert(raw: number, ca: number, high: boolean): number {
  const t = raw / 10 + (high ? ca / 20 : ca / 200) + 10;
  const v = Math.floor((t * t) / 30 + t / 3 + 0.5);
  return Math.max(1, Math.min(20, v));
}

// Player-postens felter fra offset 15 (efter ID, trøjenummer, CA, PA og tre omdømmer)
const PF = ['Goalkeeper', 'Sweeper', 'Defender', 'DefensiveMidfielder', 'Midfielder', 'AttackingMidfielder', 'Attacker', 'WingBack',
  'RightSide', 'LeftSide', 'Central', 'FreeRole', 'Acceleration', 'Aggression', 'Agility', 'Anticipation', 'Balance', 'Bravery',
  'Consistency', 'Corners', 'Crossing', 'Decisions', 'Dirtiness', 'Dribbling', 'Finishing', 'Flair', 'FreeKicks', 'Handling', 'Heading',
  'ImportantMatches', 'InjuryProneness', 'Jumping', 'Leadership', 'LeftFoot', 'LongShots', 'Marking', 'Movement', 'NaturalFitness',
  'OneOnOnes', 'Pace', 'Passing', 'Penalties', 'Positioning', 'Reflexes', 'RightFoot', 'Stamina', 'Strength', 'Tackling', 'Teamwork',
  'Technique', 'ThrowIns', 'Versatility', 'Vision', 'WorkRate'] as const;
type PField = (typeof PF)[number];

// Evner der gemmes intrinsisk (omregnes med CA); målmandsevner er "høje" for målmænd, de øvrige for markspillere
const INTRINSIC_ALWAYS_HIGH: PField[] = ['Anticipation', 'Decisions', 'Heading', 'LongShots', 'Passing', 'Penalties', 'Positioning', 'Tackling'];
const INTRINSIC_GK: PField[] = ['Handling', 'Reflexes', 'OneOnOnes'];
const INTRINSIC_OUTFIELD: PField[] = ['Crossing', 'Dribbling', 'Finishing', 'Marking', 'Movement', 'ThrowIns', 'Vision'];

// Vores ATTRS-rækkefølge → kilde (P = player-post, S = staff-post)
const MAP: [string, 'P' | 'S', string][] = [
  ['crossing', 'P', 'Crossing'], ['dribbling', 'P', 'Dribbling'], ['finishing', 'P', 'Finishing'], ['heading', 'P', 'Heading'],
  ['longShots', 'P', 'LongShots'], ['marking', 'P', 'Marking'], ['offTheBall', 'P', 'Movement'], ['passing', 'P', 'Passing'],
  ['penalties', 'P', 'Penalties'], ['tackling', 'P', 'Tackling'], ['freeKicks', 'P', 'FreeKicks'], ['corners', 'P', 'Corners'],
  ['technique', 'P', 'Technique'], ['throwIns', 'P', 'ThrowIns'],
  ['aggression', 'P', 'Aggression'], ['anticipation', 'P', 'Anticipation'], ['bravery', 'P', 'Bravery'], ['creativity', 'P', 'Vision'],
  ['decisions', 'P', 'Decisions'], ['determination', 'S', 'Determination'], ['flair', 'P', 'Flair'], ['influence', 'P', 'Leadership'],
  ['positioning', 'P', 'Positioning'], ['teamwork', 'P', 'Teamwork'], ['workRate', 'P', 'WorkRate'],
  ['acceleration', 'P', 'Acceleration'], ['agility', 'P', 'Agility'], ['balance', 'P', 'Balance'], ['jumping', 'P', 'Jumping'],
  ['naturalFitness', 'P', 'NaturalFitness'], ['pace', 'P', 'Pace'], ['stamina', 'P', 'Stamina'], ['strength', 'P', 'Strength'],
  ['handling', 'P', 'Handling'], ['oneOnOnes', 'P', 'OneOnOnes'], ['reflexes', 'P', 'Reflexes'],
  ['consistency', 'P', 'Consistency'], ['importantMatches', 'P', 'ImportantMatches'], ['injuryProneness', 'P', 'InjuryProneness'],
  ['dirtiness', 'P', 'Dirtiness'], ['versatility', 'P', 'Versatility'], ['adaptability', 'S', 'Adaptability'], ['ambition', 'S', 'Ambition'],
  ['loyalty', 'S', 'Loyalty'], ['pressure', 'S', 'Pressure'], ['professionalism', 'S', 'Professionalism'], ['sportsmanship', 'S', 'Sportsmanship'],
  ['temperament', 'S', 'Temperament'],
];
const STAFF_ATTR_OFS: Record<string, number> = { Adaptability: 86, Ambition: 87, Determination: 88, Loyalty: 89, Pressure: 90, Professionalism: 91, Sportsmanship: 92, Temperament: 93 };

interface IndexRec { name: string; fileId: number; count: number; offset: number }

function readIndex(buf: ArrayBuffer): IndexRec[] {
  const r = new Reader(buf);
  const out: IndexRec[] = [];
  for (let o = 8; o + 67 <= buf.byteLength; o += 67) out.push({ name: r.str(o, 51), fileId: r.i32(o + 51), count: r.i32(o + 55), offset: r.i32(o + 59) });
  return out;
}

function hashStr(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }

/** Konverter CM 01/02's Data-mappe til spillets verdensformat */
export function parseCM0102(files: Record<string, ArrayBuffer>): CMWorld {
  const missing = CM_REQUIRED.filter((f) => !files[f]);
  if (missing.length) throw new Error(`missing:${missing.join(',')}`);
  const index = readIndex(files['index.dat']);
  // staff.dat rummer fire tabeller: personer, ikke-spillere, spillere og præferencer (i den rækkefølge)
  // Postens størrelse findes ud fra afstanden til næste tabel (originaludgaven: 157 bytes pr. person med
  // præferencerne indbygget; senere udgaver: 110 bytes + en separat præferencetabel)
  const staffTables = index.filter((x) => x.name.toLowerCase() === 'staff.dat' && x.count > 0).sort((a, b) => a.offset - b.offset);
  if (staffTables.length < 2) throw new Error('index');
  const sizes = staffTables.map((tb, i) => Math.round(((staffTables[i + 1]?.offset ?? files['staff.dat'].byteLength) - tb.offset) / tb.count));
  const tStaff = staffTables[0];
  const staffSize = sizes[0];
  const pi = sizes.findIndex((sz, i) => i > 0 && sz === 70);
  if (pi < 0) throw new Error('index');
  const tPlayer = staffTables[pi];
  const playerSize = 70;
  const S = new Reader(files['staff.dat']);
  // spillerdata findes via spillerpostens eget ID
  const playerAt = new Map<number, number>();
  for (let k = 0; k < tPlayer.count; k++) playerAt.set(S.i32(tPlayer.offset + k * playerSize), tPlayer.offset + k * playerSize);
  // referencen til spillerdata ligger i postens sidste 12-13 bytes (afhænger af versionen) – find den der passer
  const probe = Math.min(tStaff.count, 3000);
  const PLAYER_REF = [staffSize - 13, staffSize - 12, staffSize - 9, 97].map((off) => {
    let hits = 0;
    for (let k = 0; k < probe; k++) if (playerAt.has(S.i32(tStaff.offset + k * staffSize + off))) hits++;
    return [off, hits] as const;
  }).sort((x, y) => y[1] - x[1])[0][0];

  // navne
  const names = (file: string) => {
    const r = new Reader(files[file]);
    const out: string[] = [];
    for (let o = 0; o + 60 <= files[file].byteLength; o += 60) out[r.i32(o + 51)] = r.str(o, 51);
    return out;
  };
  const first = names('first_names.dat'), second = names('second_names.dat'), common = names('common_names.dat');

  // nationer
  const N = new Reader(files['nation.dat']);
  const nationIdx = new Map<number, number>();
  const nations: { name: string; code: string }[] = [];
  for (let o = 0; o + 290 <= files['nation.dat'].byteLength; o += 290) {
    const id = N.i32(o);
    nationIdx.set(id, nations.length);
    nations.push({ name: N.str(o + 4, 51), code: N.str(o + 83, 4) || N.str(o + 56, 3).toUpperCase() });
  }

  // turneringer (ligaer findes som de divisioner klubberne spiller i)
  const CC = new Reader(files['club_comp.dat']);
  const comps = new Map<number, { name: string; short: string; nation: number; rep: number }>();
  for (let o = 0; o + 107 <= files['club_comp.dat'].byteLength; o += 107) {
    comps.set(CC.i32(o), { name: CC.str(o + 4, 51), short: CC.str(o + 56, 26), nation: CC.i32(o + 93), rep: CC.i16(o + 105) });
  }

  // farver
  const colours = new Map<number, string>();
  if (files['colour.dat']) {
    const C = new Reader(files['colour.dat']);
    for (let o = 0; o + 58 <= files['colour.dat'].byteLength; o += 58) {
      const hex = (n: number) => n.toString(16).padStart(2, '0');
      colours.set(C.i32(o), `#${hex(C.u8(o + 55))}${hex(C.u8(o + 56))}${hex(C.u8(o + 57))}`);
    }
  }

  // stadioner (kapacitet)
  const seatsOf = new Map<number, number>();
  if (files['stadium.dat']) {
    const St = new Reader(files['stadium.dat']);
    for (let o = 0; o + 78 <= files['stadium.dat'].byteLength; o += 78) seatsOf.set(St.i32(o), Math.max(0, St.i32(o + 59)));
  }

  // klubber
  const CL = new Reader(files['club.dat']);
  type RawClub = { id: number; name: string; short: string; nation: number; division: number; rep: number; stadium: number; maxAtt: number; fg: number; bg: number };
  const rawClubs: RawClub[] = [];
  for (let o = 0; o + 581 <= files['club.dat'].byteLength; o += 581) {
    rawClubs.push({
      id: CL.i32(o), name: CL.str(o + 4, 51), short: CL.str(o + 56, 26), nation: CL.i32(o + 83), division: CL.i32(o + 87),
      stadium: CL.i32(o + 105), maxAtt: CL.i32(o + 123), rep: CL.i16(o + 128), fg: CL.i32(o + 131), bg: CL.i32(o + 135),
    });
  }
  // ligaer: divisioner med mindst 8 klubber; niveau efter omdømme inden for landet
  const divClubs = new Map<number, RawClub[]>();
  for (const c of rawClubs) if (comps.has(c.division) && nationIdx.has(c.nation)) divClubs.set(c.division, [...(divClubs.get(c.division) ?? []), c]);
  // rigtige ligaer: 8-30 klubber i et land (store samlepuljer for amatørklubber springes over)
  const allLeagues = [...divClubs.entries()].filter(([id, cs]) => cs.length >= 8 && cs.length <= 30 && nationIdx.has(comps.get(id)!.nation)).map(([id]) => id);
  const nationLeagues = new Map<number, number[]>();
  for (const id of allLeagues) { const n = comps.get(id)!.nation; nationLeagues.set(n, [...(nationLeagues.get(n) ?? []), id]); }
  const leagueComps = [...nationLeagues.values()].flatMap((ids) => ids.sort((a, b) => comps.get(b)!.rep - comps.get(a)!.rep || divClubs.get(b)!.length - divClubs.get(a)!.length).slice(0, MAX_TIERS));
  const byNation = new Map<number, number[]>();
  for (const id of leagueComps) {
    const n = comps.get(id)!.nation;
    byNation.set(n, [...(byNation.get(n) ?? []), id]);
  }
  const leagues: WorldData['leagues'] = [];
  const rules: CMWorld['rules'] = {};
  const lid = (compId: number) => `CM${compId}`;
  const maxCompRep = Math.max(1, ...leagueComps.map((id) => comps.get(id)!.rep));
  for (const [nation, ids] of byNation) {
    if (!nationIdx.has(nation)) continue;
    const sorted = ids.sort((a, b) => comps.get(b)!.rep - comps.get(a)!.rep || divClubs.get(b)!.length - divClubs.get(a)!.length);
    // pokalturnering: landets mest prestigefyldte nationale turnering der ikke er en liga
    const cup = [...comps.entries()].filter(([id, c]) => c.nation === nation && !leagueComps.includes(id) && /cup|pokal|copa|coppa|coupe|pokaal|taça|beker/i.test(c.name)).sort((a, b) => b[1].rep - a[1].rep)[0];
    sorted.forEach((id, i) => {
      const c = comps.get(id)!;
      const tier = i + 1;
      leagues.push({ id: lid(id), name: c.name, nation: nationIdx.get(nation)!, tier });
      const wealth = Math.max(0.25, Math.min(2, (c.rep / maxCompRep) * 2.1)) * (tier === 1 ? 1 : 0.6);
      const n = divClubs.get(id)!.length;
      rules[lid(id)] = {
        rounds: n > 24 ? 1 : n <= 10 ? 4 : 2,
        wealth: Math.round(wealth * 100) / 100,
        ...(i + 1 < sorted.length ? { relegated: 3, below: lid(sorted[i + 1]) } : {}),
        ...(i > 0 ? { promoted: 3, above: lid(sorted[i - 1]) } : {}),
        ...(tier === 1 && cup ? { cup: cup[1].name } : {}),
      };
    });
  }
  const leagueSet = new Set(leagueComps);
  const maxClubRep = Math.max(1, ...rawClubs.map((c) => c.rep));
  const clubs: WorldData['clubs'] = [];
  const clubRep: Record<number, number> = {};
  const clubColors: Record<number, [string, string]> = {};
  for (const c of rawClubs) {
    if (!leagueSet.has(c.division)) continue;
    const seats = seatsOf.get(c.stadium) || c.maxAtt || 0;
    clubs.push([c.id, c.name, c.short || c.name, nationIdx.get(c.nation)!, lid(c.division), '', Math.min(120_000, seats), '']);
    clubRep[c.id] = Math.max(3, Math.min(98, Math.round(Math.pow(c.rep / maxClubRep, 0.7) * 98)));
    const fg = colours.get(c.fg), bg = colours.get(c.bg);
    if (fg && bg) clubColors[c.id] = [bg, fg];
  }
  const inGame = new Set(clubs.map((c) => c[0]));

  // spillere
  const fields = ['id', 'first', 'last', 'dob', 'nation', 'club', 'pos', 'foot', 'height', 'value', 'maxValue', 'caps', 'intGoals', 'contract', 'apps', 'minutes', 'goals', 'assists', 'yellows', 'reds'];
  const players: WorldData['players'] = [];
  const ratings: Record<number, CMRatings> = {};
  const pName = names; void pName;
  for (let i = 0; i < tStaff.count; i++) {
    const o = tStaff.offset + i * staffSize;
    if (o + staffSize > files['staff.dat'].byteLength) break;
    const pRef = S.i32(o + PLAYER_REF);
    const po = playerAt.get(pRef);
    if (pRef < 0 || po === undefined) continue;
    const id = S.i32(o);
    const dob = S.date(o + 16);
    const nation = nationIdx.get(S.i32(o + 26));
    if (!dob || nation === undefined) continue;
    let club = S.i32(o + 57);
    if (!inGame.has(club)) club = 0;
    const get = (f: PField) => S.i8(po + 15 + PF.indexOf(f));
    const ca = Math.max(1, S.i16(po + 5));
    // spillere uden for de importerede ligaer kommer kun med som fri agenter, hvis de er gode nok
    if (!club && ca < 120) continue;
    let pa = S.i16(po + 7);
    const age = 2001 - Number(dob.slice(0, 4));
    // negativ PA = tilfældig potentiale i originalen: et deterministisk skøn ud fra alder
    if (pa <= 0 || pa < ca) pa = Math.min(200, ca + Math.round(((hashStr(String(id)) % 1000) / 1000) * Math.max(5, (24 - age) * 6)));
    const isGK = get('Goalkeeper') >= 15;
    // 0 betyder "ikke sat" i originaldatabasen (spillet finder selv på en værdi) – markeres med 0,
    // så spillet ved start bruger en rolleprofil ud fra position og CA i stedet
    const attrs = MAP.map(([, src, f]) => {
      if (src === 'S') { const v = S.i8(o + STAFF_ATTR_OFS[f]); return v > 0 ? Math.min(20, v) : 0; }
      const raw = get(f as PField);
      if (raw === 0) return 0;
      if (INTRINSIC_ALWAYS_HIGH.includes(f as PField)) return convert(raw, ca, true);
      if (INTRINSIC_GK.includes(f as PField)) return convert(raw, ca, isGK);
      if (INTRINSIC_OUTFIELD.includes(f as PField)) return convert(raw, ca, !isGK);
      return raw < 0 ? 0 : Math.min(20, raw);
    });
    const pos = ['Goalkeeper', 'Sweeper', 'Defender', 'DefensiveMidfielder', 'Midfielder', 'AttackingMidfielder', 'Attacker', 'WingBack'].map((f) => Math.max(1, Math.min(20, get(f as PField))));
    const side = [get('LeftSide'), get('Central'), get('RightSide')].map((v) => Math.max(1, Math.min(20, v)));
    const lf = get('LeftFoot'), rf = get('RightFoot');
    const foot = lf >= 15 && rf >= 15 ? 'B' : lf > rf ? 'L' : 'R';
    const firstName = first[S.i32(o + 4)] ?? '', lastName = second[S.i32(o + 8)] ?? '', commonName = S.i32(o + 12) >= 0 ? common[S.i32(o + 12)] ?? '' : '';
    const contract = S.date(o + 70);
    // 2001-værdier i pund → euro i nutidens prisniveau (×1,6 for valuta, ×2 for fodboldinflation)
    const value = Math.max(0, S.i32(o + 82)) * 3.2;
    players.push([
      id, commonName ? '' : firstName, commonName || lastName || firstName, dob, nation, club, subPos(pos, side), foot, 0,
      Math.round(value), Math.round(value), S.u8(o + 34), S.u8(o + 35), contract ? `${contract.slice(0, 4)}-06-30` : '', 0, 0, 0, 0, 0, 0,
    ]);
    ratings[id] = { ca, pa, attrs, pos, side };
  }

  // navnepuljer til regens (pr. nation)
  const pool: Record<string, [string[], string[]]> = {};
  const fi = fields.indexOf('first'), la = fields.indexOf('last'), na = fields.indexOf('nation');
  const counts = new Map<number, [Map<string, number>, Map<string, number>]>();
  for (const r of players) {
    const n = r[na] as number;
    if (!counts.has(n)) counts.set(n, [new Map(), new Map()]);
    const [fc, lc] = counts.get(n)!;
    if (r[fi]) fc.set(r[fi] as string, (fc.get(r[fi] as string) ?? 0) + 1);
    lc.set(r[la] as string, (lc.get(r[la] as string) ?? 0) + 1);
  }
  for (const [n, [fc, lc]] of counts) {
    if (lc.size < 15) continue;
    const top = (m: Map<string, number>, k: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([s]) => s);
    pool[String(n)] = [top(fc, 250), top(lc, 400)];
  }

  return {
    kind: 'cm0102', version: 1, source: 'Championship Manager 01/02 (brugerens egen installation)', season: 2001,
    nations, leagues, clubs, playerFields: fields, players, names: pool, ratings, clubRep, clubColors, rules,
  };
}

function subPos(pos: number[], side: number[]): string {
  if (pos[0] >= 15) return 'GK';
  const [L, C, R] = side;
  const wide = Math.max(L, R) >= 15 && C < 15 ? (L >= R ? 'L' : 'R') : '';
  const best = [2, 3, 4, 5, 6, 7].sort((a, b) => pos[b] - pos[a])[0];
  switch (best) {
    case 2: return wide ? `${wide}B` : 'CB';
    case 7: return wide === 'L' ? 'LB' : 'RB';
    case 3: return 'DM';
    case 4: return wide ? `${wide}M` : 'CM';
    case 5: return wide ? `${wide}W` : 'AM';
    default: return pos[5] >= 15 ? 'SS' : 'CF';
  }
}
