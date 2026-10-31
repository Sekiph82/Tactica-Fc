// AI-skrevne artikler i indbakken: kamprapporter, rygter, klummer og bestyrelsesmøder.
// Teksten hentes første gang beskeden åbnes og gemmes med spillet; uden AI vises intet ekstra.
import { AiSpinner } from './components';
import { useEffect, useState } from 'react';
import { aiCall, aiText, ensureAiText } from '../ai/client';
import { leagueRows } from '../game/competitions';
import { addDays } from '../game/dates';
import { gs, squad } from '../game/state';
import type { NewsItem, Player } from '../game/types';
import { money, t } from '../i18n';
import { useAiAvailable } from './ai';

const pname = (p?: Player) => (p ? `${p.first} ${p.last}`.trim() : '?');
const avg = (p: Player) => (p.stats.ratingCount ? Math.round((p.stats.ratingSum / p.stats.ratingCount) * 100) / 100 : undefined);

const ARTICLE_KEYS: Record<string, string> = {
  'match.won': 'match', 'match.drew': 'match', 'match.lost': 'match',
  'rumour.interest': 'rumour', 'column.month': 'column', 'board.meeting': 'boardMeeting', 'will.leak': 'leak',
};

export function hasArticle(n: NewsItem): boolean {
  return n.key in ARTICLE_KEYS;
}

/** Fakta til artiklen – kun ting spillet ved er sande */
function facts(n: NewsItem): Record<string, unknown> | null {
  const g = gs();
  const type = ARTICLE_KEYS[n.key];
  const me = g.clubs[g.userClub];
  if (type === 'match') {
    const rep = n.link?.kind === 'fixture' ? g.reports[Number(n.link.id)] : undefined;
    const f = n.link?.kind === 'fixture' ? g.fixtures[Number(n.link.id)] : undefined;
    if (!rep || !f) return null;
    const team = (i: number) => g.clubs[i === 0 ? rep.home : rep.away]?.name;
    const goals = rep.events.filter((e) => e.k === 'goal').map((e) => ({ minute: e.m, team: team(e.t), scorer: pname(g.players[e.p!]) }));
    const reds = rep.events.filter((e) => e.k === 'red').map((e) => ({ minute: e.m, team: team(e.t), player: pname(g.players[e.p!]) }));
    const best = rep.players.slice().sort((a, b) => b.rating - a.rating).slice(0, 3).map((l) => ({ player: pname(g.players[l.id]), team: team(l.team), rating: l.rating }));
    return {
      type: 'kamprapport', competition: g.comps[f.comp]?.name, home: team(0), away: team(1), score: `${rep.stats[0].goals}-${rep.stats[1].goals}`,
      goals, redCards: reds, shots: [rep.stats[0].shots, rep.stats[1].shots], xG: [rep.stats[0].xg.toFixed(2), rep.stats[1].xg.toFixed(2)],
      possession: [Math.round(rep.stats[0].possession), 100 - Math.round(rep.stats[0].possession)], manOfTheMatch: pname(g.players[rep.mom]), bestRated: best,
      attendance: f.result?.att, penalties: rep.pens,
    };
  }
  if (type === 'rumour') {
    const p = n.link?.kind === 'player' ? g.players[Number(n.link.id)] : undefined;
    if (!p) return null;
    return { type: 'transferrygte (ubekræftet)', source: n.params.outlet, player: pname(p), currentClub: g.clubs[p.club]?.name, interestedClub: n.params.club, seasonApps: p.stats.apps + p.stats.subs, seasonGoals: p.stats.goals, avgRating: avg(p), value: money(p.value) };
  }
  if (type === 'column') {
    const comp = me ? g.comps[me.league] : undefined;
    if (!comp) return null;
    const table = leagueRows(comp).map((r, i) => ({ pos: i + 1, club: g.clubs[r.club]?.name, pts: r.pts, played: r.p, form: r.form }));
    const scorers = comp.clubs.flatMap((c) => squad(c)).sort((a, b) => b.stats.lgGoals - a.stats.lgGoals).slice(0, 3).map((p) => ({ player: pname(p), club: g.clubs[p.club]?.name, goals: p.stats.lgGoals }));
    return { type: 'månedens klumme om ligaen', league: comp.name, top: table.slice(0, 5), bottom: table.slice(-3), readersClub: me?.name, readersClubPos: table.findIndex((r) => r.club === me?.name) + 1, topScorers: scorers };
  }
  if (type === 'boardMeeting') {
    return {
      type: 'referat fra bestyrelsesmøde (bestyrelsesformanden taler til manageren)', club: me?.name, manager: g.manager.name, boardConfidence: n.params.conf,
      leaguePosition: n.params.pos, expectedPosition: n.params.expected, expectation: t(`board.exp.${g.board.expectation}`), fanMood: n.params.fans, balance: money(Number(n.params.balance)),
      transferBudget: me ? money(me.transferBudget) : undefined, warnings: g.board.warnings,
    };
  }
  if (type === 'leak') {
    const p = n.link?.kind === 'player' ? g.players[Number(n.link.id)] : undefined;
    if (!p) return null;
    return { type: 'avisartikel: spiller utilfreds med sin kontrakt (kilder tæt på spilleren)', player: pname(p), club: me?.name, currentWeeklyWage: money(p.contract?.wage ?? 0), wantedWeeklyWage: p.demand ? money(p.demand.wage) : undefined, avgRating: avg(p) };
  }
  return null;
}

/** Skriv artiklerne til de nyeste ulæste beskeder i baggrunden, så de er klar når beskeden åbnes */
const prefetched = new Set<number>();
export function prefetchArticles() {
  const g = gs();
  // kun helt nye beskeder – efter mange dage i træk skal der ikke skrives artikler til alt det, man sprang over
  const since = addDays(g.date, -3);
  const items = g.news.filter((n) => !n.read && n.date >= since && hasArticle(n) && !prefetched.has(n.id) && !aiText(`news:${n.id}`)).slice(0, 3);
  for (const n of items) {
    prefetched.add(n.id);
    const f = facts(n);
    if (!f) continue;
    void ensureAiText(`news:${n.id}`, async () => {
      const r = await aiCall<{ headline: string; body: string }>('article', f);
      return r ? JSON.stringify(r) : null;
    });
  }
}

export function AiArticle({ item }: { item: NewsItem }) {
  const ai = useAiAvailable();
  const key = `news:${item.id}`;
  const [text, setText] = useState<string | undefined>(() => aiText(key));
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setText(aiText(key));
    if (!ai || !hasArticle(item) || aiText(key)) return;
    const f = facts(item);
    if (!f) return;
    let alive = true;
    setLoading(true);
    ensureAiText(key, async () => {
      const r = await aiCall<{ headline: string; body: string }>('article', f);
      return r ? JSON.stringify(r) : null;
    }).then((v) => { if (alive) { setText(v ?? undefined); setLoading(false); } });
    return () => { alive = false; };
  }, [ai, key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!hasArticle(item)) return null;
  if (loading && !text) return <div><AiSpinner text={t('ai.writing')} /></div>;
  if (!text) return null;
  let art: { headline?: string; body?: string } = {};
  try { art = JSON.parse(text); } catch { art = { body: text }; }
  return (
    <div className="article">
      {art.headline && <h4>{art.headline}</h4>}
      {art.body && <p>{art.body}</p>}
    </div>
  );
}
