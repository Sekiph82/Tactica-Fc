// Revision af spillet: invariants (fejl) og realisme-statistik over flere sæsoner.
// Kør: npx tsx scripts/audit.ts [sæsoner]
import { readFileSync } from 'node:fs';
import { createGame, type WorldData } from '../src/game/newgame';
import { continueGame, quickPlayUserMatch } from '../src/game/sim';
import { fixturesOn, gs, squad } from '../src/game/state';
import { clubLevel } from '../src/game/scouting';
import { finalOrder } from '../src/game/competitions';
import { ageOn } from '../src/game/dates';
import { aiTactic, engineTeam } from '../src/game/sim';
import { quickMatch } from '../src/game/engine/match';
import { Rng } from '../src/game/rng';
import { applyActionAs } from '../src/game/actions';
import { A, naturalRole } from '../src/game/attributes';
import type { Fixture, MatchResultShort } from '../src/game/types';

const seasons = Number(process.argv[2] ?? 3);
const world = JSON.parse(readFileSync('public/data/world.json', 'utf8')) as WorldData;
const ni = (n: string) => world.nations.findIndex((x) => x.name === n);
createGame(world, { managerName: 'Audit', managerNation: ni('Denmark'), clubId: 190, activeNations: ['Denmark', 'England', 'Spain'].map(ni), lang: 'da', masking: true, seed: 77 });
const g = gs();
const issues: string[] = [];
const issue = (s: string) => { if (issues.length < 200) issues.push(`${g.date}: ${s}`); };

// ---------- invariants ----------
function checkInvariants(label: string) {
  const seen = new Set<number>();
  for (const c of Object.values(g.clubs)) {
    for (const p of squad(c.id)) {
      if (seen.has(p.id)) issue(`${label} spiller ${p.id} i to trupper`);
      seen.add(p.id);
      if (p.club !== c.id) issue(`${label} indeks: ${p.last} i ${c.short}s trup men club=${p.club}`);
      if (!p.contract && !p.loan) issue(`${label} ${p.last} (${c.short}) uden kontrakt`);
    }
    for (const k of ['balance', 'transferBudget', 'wageBudget', 'rep', 'seats'] as const) if (!Number.isFinite(c[k])) issue(`${label} ${c.short}.${k} = ${c[k]}`);
    if (c.seats <= 0) issue(`${label} ${c.short} har ${c.seats} pladser`);
  }
  for (const p of Object.values(g.players)) {
    if (p.club && !g.clubs[p.club]) issue(`${label} ${p.last} i ukendt klub ${p.club}`);
    if (p.attrs.some((v) => !Number.isFinite(v) || v < 1 || v > 20)) issue(`${label} ${p.last} har ugyldig attribut ${p.attrs.find((v) => !Number.isFinite(v) || v < 1 || v > 20)}`);
    if (!Number.isFinite(p.ca) || p.ca < 1 || p.ca > 200 || p.ca > p.pa + 0.5) issue(`${label} ${p.last} CA ${p.ca} PA ${p.pa}`);
    if (!Number.isFinite(p.value) || p.value < 0) issue(`${label} ${p.last} værdi ${p.value}`);
    if (p.condition < 0 || p.condition > 100 || p.morale < 1 || p.morale > 20) issue(`${label} ${p.last} kondi ${p.condition} moral ${p.morale}`);
    if (p.contract && (!Number.isFinite(p.contract.wage) || p.contract.wage < 0)) issue(`${label} ${p.last} løn ${p.contract.wage}`);
    if (p.injury && p.injury.days < 0) issue(`${label} ${p.last} skade ${p.injury.days}`);
    if (p.loan && !g.clubs[p.loan.from]) issue(`${label} ${p.last} lejet fra ukendt klub`);
    if (p.banned < 0) issue(`${label} ${p.last} karantæne ${p.banned}`);
  }
  for (const o of g.offers) if (!g.players[o.player] && ['pending', 'negotiating', 'countered'].includes(o.status)) issue(`${label} aktivt tilbud på forsvundet spiller ${o.player}`);
  for (const s of Object.values(g.staff)) if (s.club && !g.clubs[s.club]) issue(`${label} staff ${s.last} i ukendt klub`);
  const humanClubs = Object.values(g.clubs).filter((c) => c.manager === -1).length;
  if (humanClubs > 1) issue(`${label} ${humanClubs} klubber markeret som menneskestyrede`);
  for (const c of Object.values(g.clubs)) if (c.manager > 0 && g.staff[c.manager]?.club !== c.id) issue(`${label} ${c.short} manager ${c.manager} er ikke ansat i klubben`);
}

// ---------- statistik ----------
type LStat = { games: number; goals: number; home: number; draws: number; cards: number; att: number; attN: number };
const lstat: Record<string, LStat> = {};
let injuries = 0, injuryDays = 0, reds = 0, allGames = 0;
const fees: { fee: number; value: number; who: string }[] = [];
let lastSeason = g.season;
const seasonReports: string[] = [];


function recordDay() {
  for (const id of fixturesOn(g.date)) {
    const f = g.fixtures[id] as Fixture | undefined;
    if (!f?.result) continue;
    const comp = g.comps[f.comp];
    const r = f.result as MatchResultShort;
    allGames++;
    if (comp?.type !== 'league') continue;
    const s = (lstat[f.comp] ??= { games: 0, goals: 0, home: 0, draws: 0, cards: 0, att: 0, attN: 0 });
    s.games++;
    s.goals += r.hg + r.ag;
    if (r.hg > r.ag) s.home++; else if (r.hg === r.ag) s.draws++;
    if (r.att) { s.att += r.att; s.attN++; }
  }
}

function seasonReport(season: number) {
  const lines: string[] = [`\n=== Sæson ${season}/${String(season + 1).slice(2)} ===`];
  for (const comp of Object.values(g.comps).filter((c) => c.type === 'league')) {
    const s = lstat[comp.id];
    const order = finalOrder(comp);
    const tbl = comp.table;
    const pts = (cid: number) => tbl.find((r) => r.club === cid)?.pts ?? 0;
    const games = tbl[0]?.p ?? 0;
    const players = comp.clubs.flatMap((c) => squad(c));
    const top = players.sort((a, b) => b.stats.lgGoals - a.stats.lgGoals)[0];
    const avgAtt = s?.attN ? Math.round(s.att / s.attN) : 0;
    const yel = players.reduce((a, p) => a + p.stats.yellows, 0), red = players.reduce((a, p) => a + p.stats.reds, 0);
    lines.push(`${comp.name.padEnd(22)} ${games} kampe | mester ${g.clubs[order[0]]?.short} ${pts(order[0])}p (${(pts(order[0]) / games).toFixed(2)}/k) | sidst ${g.clubs[order[order.length - 1]]?.short} ${pts(order[order.length - 1])}p | mål/k ${s ? (s.goals / s.games).toFixed(2) : '-'} | hjemme ${s ? Math.round((s.home / s.games) * 100) : '-'}% uafgj ${s ? Math.round((s.draws / s.games) * 100) : '-'}% | topscorer ${top?.last} ${top?.stats.lgGoals} | tilskuere ${avgAtt} | gule/k ${s ? (yel / s.games).toFixed(1) : '-'} røde/k ${s ? (red / s.games).toFixed(2) : '-'}`);
    const champRow = tbl.find((r) => r.club === order[0]);
    if (champRow) {
      const cs = squad(order[0]).sort((a, b) => b.stats.lgGoals - a.stats.lgGoals);
      const lastRow = tbl.find((r) => r.club === order[order.length - 1])!;
      lines.push(`   mester ${champRow.gf}-${champRow.ga} (top3 ${cs.slice(0, 3).map((p) => `${p.last} ${p.stats.lgGoals}`).join(', ')}) | sidst ${lastRow.gf}-${lastRow.ga} | spredning p: ${tbl.map((r) => r.pts).sort((a, b) => b - a).join(' ')}`);
    }
    {
      const str = comp.clubs.map((c) => { const xs = squad(c).map((p) => p.ca).sort((a, b) => b - a).slice(0, 14); return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length); }).sort((a, b) => b - a);
      const fin = comp.clubs.flatMap((c) => squad(c)).map((p) => p.attrs[0]);
      lines.push(`   styrke (top-14 CA) max ${str[0].toFixed(0)} snit ${(str.reduce((a, b) => a + b, 0) / str.length).toFixed(0)} min ${str[str.length - 1].toFixed(0)}`);
      void fin;
      const xi = comp.clubs.flatMap((c) => squad(c).sort((a, b) => b.ca - a.ca).slice(0, 14));
      const by = (role: string, keys: string[]) => { const ps = xi.filter((p) => naturalRole(p) === role); return ps.length ? (ps.reduce((a, p) => a + keys.reduce((x, k) => x + p.attrs[A[k as keyof typeof A]], 0) / keys.length, 0) / ps.length).toFixed(1) : '-'; };
      lines.push(`   ST fin/ant ${by('ST', ['finishing', 'anticipation', 'offTheBall'])} | GK ${by('GK', ['reflexes', 'handling', 'oneOnOnes'])} | CB ${by('CB', ['tackling', 'marking', 'positioning'])} | CB-pace ${by('CB', ['pace'])} ST-pace ${by('ST', ['pace', 'acceleration'])} | snit CA ST ${xi.filter((p) => naturalRole(p) === 'ST').reduce((a, p, _, arr) => a + p.ca / arr.length, 0).toFixed(0)} GK ${xi.filter((p) => naturalRole(p) === 'GK').reduce((a, p, _, arr) => a + p.ca / arr.length, 0).toFixed(0)} CB ${xi.filter((p) => naturalRole(p) === 'CB').reduce((a, p, _, arr) => a + p.ca / arr.length, 0).toFixed(0)}`);
    }
    if (!comp.finished) issue(`${comp.id} ikke færdig ved sæsonslut (pending ${comp.pending})`);
  }
  for (const id of ['CL', 'UEFA']) { const c = g.comps[id]; lines.push(`${id}: vinder ${c?.winner ? g.clubs[c.winner].short : 'INGEN'} (færdig=${c?.finished})`); if (!c?.finished) issue(`${id} ikke færdig`); }
  for (const c of Object.values(g.comps).filter((x) => x.type === 'cup' || x.type === 'playoff')) { if (!c.finished) issue(`${c.name} ikke færdig`); else lines.push(`${c.name}: ${g.clubs[c.winner!]?.short}`); }
  lines.push(`skader: ${injuries} (snit ${(injuryDays / Math.max(1, injuries)).toFixed(0)} dage) | røde kort ${reds} | kampe ${allGames}`);
  const top = fees.sort((a, b) => b.fee - a.fee).slice(0, 8).map((x) => `${x.who} ${(x.fee / 1e6).toFixed(1)}m (v ${(x.value / 1e6).toFixed(1)}m)`);
  lines.push(`dyreste transfers: ${top.join(' | ')}`);
  const ratio = fees.length ? fees.reduce((s, x) => s + x.fee / Math.max(1, x.value), 0) / fees.length : 0;
  lines.push(`transfers med sum: ${fees.length}, snit sum/værdi ${ratio.toFixed(2)}`);
  const wages = Object.values(g.players).filter((p) => p.contract).map((p) => p.contract!.wage).sort((a, b) => b - a);
  lines.push(`højeste ugeløn ${(wages[0] / 1000).toFixed(0)}k €, median ${(wages[Math.floor(wages.length / 2)] / 1000).toFixed(1)}k €`);
  const ages = Object.values(g.players).filter((p) => p.club).map((p) => ageOn(p.dob, g.date));
  lines.push(`snitalder i klubber ${(ages.reduce((s, a) => s + a, 0) / ages.length).toFixed(1)}`);
  seasonReports.push(lines.join('\n'));
  for (const k of Object.keys(lstat)) delete lstat[k];
  injuries = 0; injuryDays = 0; reds = 0; allGames = 0; fees.length = 0;
}

function goalProbe(label: string) {
  const r = new Rng(5);
  const clubs = g.comps.GB1?.clubs ?? [];
  const run = (tweak?: () => void) => {
    const saved = Object.values(g.players).map((p) => [p, p.condition, p.morale, p.injury] as const);
    tweak?.();
    let goals = 0, sh = 0; const N = 600;
    for (let i = 0; i < N; i++) {
      const h = r.pick(clubs), a = r.pick(clubs.filter((c) => c !== h));
      const rep = quickMatch(engineTeam(h, aiTactic(h, a, true)), engineTeam(a, aiTactic(a, h, false)), { date: g.date }, r);
      goals += rep.stats[0].goals + rep.stats[1].goals; sh += rep.stats[0].shots + rep.stats[1].shots;
    }
    for (const [p, c, m, inj] of saved) { p.condition = c; p.morale = m; p.injury = inj; }
    return `${(goals / N).toFixed(2)} (skud ${(sh / N).toFixed(1)})`;
  };
  const chem = clubs.reduce((s, c) => s + (engineTeam(c, aiTactic(c)).morale ?? 0), 0) / clubs.length;
  const xi = clubs.flatMap((c) => squad(c).sort((a, b) => b.ca - a.ca).slice(0, 14));
  const roles = ['GK', 'CB', 'FB', 'DM', 'CM', 'AM', 'WM', 'W', 'ST'];
  console.error('   ' + roles.map((ro) => { const ps = xi.filter((p) => naturalRole(p) === ro); const m = (k: string) => (ps.reduce((a, p) => a + p.attrs[A[k as keyof typeof A]], 0) / Math.max(1, ps.length)).toFixed(1); return `${ro}(${ps.length}) fin ${m('finishing')} lsh ${m('longShots')} hea ${m('heading')}${ro === 'GK' ? ` ref ${m('reflexes')} 1v1 ${m('oneOnOnes')}` : ''}`; }).join(' | '));
  {
    const gkCa = clubs.map((c) => Math.max(0, ...squad(c).filter((p) => naturalRole(p) === 'GK').map((p) => p.ca)));
    const teamCa = clubs.map((c) => clubLevel(c));
    const nGk = clubs.map((c) => squad(c).filter((p) => naturalRole(p) === 'GK').length);
    const allGk = Object.values(g.players).filter((p) => naturalRole(p) === 'GK');
    console.error(`   bedste GK CA snit ${(gkCa.reduce((a, b) => a + b, 0) / clubs.length).toFixed(0)} vs hold ${(teamCa.reduce((a, b) => a + b, 0) / clubs.length).toFixed(0)} | GK pr. klub ${nGk.join(',')} | GK i verden ${allGk.length}/${Object.keys(g.players).length} (fri ${allGk.filter((p) => !p.club).length})`);
  }
  console.error(`${label}: PL-probe som nu ${run()} | frisk kondi+moral ${run(() => { for (const p of Object.values(g.players)) { p.condition = 100; p.morale = 13; } })} | uden skader ${run(() => { for (const p of Object.values(g.players)) p.injury = null; })} | snit kemi-moral ${chem.toFixed(2)}`);
}
checkInvariants('start');
goalProbe('start');
const t0 = performance.now();
let prevClub = new Map<number, number>();
let prevOut = new Map<number, number>();
let prevInj = new Set<number>();
const snap = () => {
  prevClub = new Map(Object.values(g.players).map((p) => [p.id, p.club]));
  prevOut = new Map(Object.values(g.clubs).map((c) => [c.id, c.finance.transfersOut]));
  prevInj = new Set(Object.values(g.players).filter((p) => p.injury).map((p) => p.id));
};
snap();
let moves = 0;
let mgrSnap = new Map(Object.values(g.clubs).map((c) => [c.id, c.manager]));
while (g.season < 2025 + seasons) {
  // brugeren forlænger udløbende kontrakter, så klubben ikke smuldrer
  if (g.date.endsWith('-01-15')) for (const p of squad(g.userClub)) if (p.contract && p.contract.expires <= `${g.season + 1}-06-30`) applyActionAs('x', { t: 'renew', pid: p.id, wage: Math.round(p.contract.wage * 1.3), years: 2 });
  const r = continueGame();
  if (r.match !== undefined) quickPlayUserMatch();
  if (!g.dayDone) continue;
  recordDay();
  for (const p of Object.values(g.players)) {
    if (p.injury && !prevInj.has(p.id)) { injuries++; injuryDays += p.injury.days; }
    const before = prevClub.get(p.id);
    if (before && p.club && before !== p.club && !p.loan) {
      moves++;
      const delta = g.clubs[p.club].finance.transfersOut - (prevOut.get(p.club) ?? 0);
      if (delta > 0) fees.push({ fee: delta, value: p.value, who: `${p.last} ${g.clubs[before]?.short}→${g.clubs[p.club].short}` });
    }
  }
  snap();
  if (g.date.endsWith('-06-30')) {
    seasonReport(g.season);
    console.error(`sæson ${g.season} færdig efter ${((performance.now() - t0) / 1000).toFixed(0)} s, skifter ${moves}`);
    moves = 0;
    {
      const active = new Set(Object.values(g.comps).filter((c) => c.type === 'league').flatMap((c) => c.clubs));
      const changed = Object.values(g.clubs).filter((c) => active.has(c.id) && mgrSnap.get(c.id) !== c.manager).length;
      const bal = Object.values(g.clubs).filter((c) => active.has(c.id)).map((c) => c.balance).sort((a, b) => a - b);
      console.error(`   managerskift i simulerede ligaer: ${changed}/${active.size} | saldo min ${(bal[0] / 1e6).toFixed(0)}m median ${(bal[Math.floor(bal.length / 2)] / 1e6).toFixed(1)}m max ${(bal[bal.length - 1] / 1e6).toFixed(0)}m, i minus ${bal.filter((b) => b < 0).length}`);
      mgrSnap = new Map(Object.values(g.clubs).map((c) => [c.id, c.manager]));
    }
    checkInvariants(`slut ${g.season}`);
    goalProbe(`slut ${g.season}`);
  }
}
console.log(seasonReports.join('\n'));
console.log(`\nTid ${((performance.now() - t0) / 1000).toFixed(0)} s`);
console.log(`\n${issues.length} problemer${issues.length ? ':' : ''}\n${issues.slice(0, 80).join('\n')}`);
