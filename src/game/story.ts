// Sæsonfortælling: årets vendepunkter (tabte føringer, comebacks, rivalopgør, gennembrud, store køb, fansenes
// reaktioner, trofæer) samles undervejs og bliver til et sæsonkort ved sæsonslut.
import { leadLoss } from './analysis';
import { ageOn } from './dates';
import { asOwner, isHumanClub } from './humans';
import { addNews, gs, squad } from './state';
import type { Fixture, MatchReport, SeasonStory, StoryItem } from './types';

const pname = (id: number) => { const p = gs().players[id]; return p ? `${p.first} ${p.last}`.trim() : ''; };

/** Tilføj et vendepunkt for den aktive manager */
export function storyAdd(item: Omit<StoryItem, 'd'>) {
  const g = gs();
  const s = (g.manager.story ??= { season: g.season, items: [] });
  if (s.season !== g.season) { s.season = g.season; s.items = []; }
  s.items.push({ d: g.date, ...item });
  if (s.items.length > 60) s.items.sort((a, b) => b.w - a.w).splice(60);
}

/** Efter hver kamp for menneskestyrede klubber */
export function storyAfterMatch(f: Fixture, rep: MatchReport, big: boolean) {
  const g = gs();
  for (const side of [0, 1] as const) {
    const cid = side === 0 ? f.home : f.away;
    if (!isHumanClub(cid)) continue;
    asOwner(cid, () => {
      const opp = g.clubs[side === 0 ? f.away : f.home]?.name ?? '';
      const gf = rep.stats[side].goals, ga = rep.stats[1 - side].goals;
      const score = `${gf}-${ga}`;
      const base = { fixture: f.id, p: { opp, score } };
      const lost = leadLoss(rep, side);
      // comeback: bagud og vandt
      let diff = 0, worst = 0;
      for (const e of rep.events.filter((x) => x.k === 'goal').sort((a, b) => a.m - b.m)) { diff += e.t === side ? 1 : -1; worst = Math.min(worst, diff); }
      const rivalry = big || isHumanClub(side === 0 ? f.away : f.home);
      if (rivalry) storyAdd({ k: gf > ga ? 'derbyWin' : gf < ga ? 'derbyLoss' : 'derbyDraw', w: gf > ga ? 5 : gf < ga ? 3 : 2, ...base });
      else if (gf > ga && worst <= -1) storyAdd({ k: 'comeback', w: worst <= -2 ? 6 : 4, ...base });
      else if (lost) storyAdd({ k: 'lostLead', w: lost.lead >= 2 ? 4 : 3, ...base, p: { ...base.p, lead: lost.lead } });
      else if (gf - ga >= 3) storyAdd({ k: 'bigWin', w: 3 + Math.min(3, gf - ga - 3), ...base });
      else if (ga - gf >= 3) storyAdd({ k: 'heavyLoss', w: 3, ...base });
      // gennembrud: en ung spiller, der leverer stort (én gang pr. spiller pr. sæson)
      for (const l of rep.players) {
        if (l.team !== side) continue;
        const p = g.players[l.id];
        if (!p || ageOn(p.dob, g.date) > 21 || (l.rating < 8 && l.goals < 2)) continue;
        if (g.manager.story?.items.some((x) => x.k === 'breakthrough' && x.pid === p.id)) continue;
        storyAdd({ k: 'breakthrough', w: 4, pid: p.id, fixture: f.id, p: { player: pname(p.id), opp, rating: l.rating } });
      }
    });
  }
}

/** Ved sæsonslut: oprykning/nedrykning, sæsonkortet og en besked – derefter starter en ny fortælling */
export function storySeasonEnd(tierBefore: Map<number, number>) {
  const g = gs();
  for (const c of Object.values(g.clubs)) {
    if (!isHumanClub(c.id)) continue;
    asOwner(c.id, () => {
      const before = tierBefore.get(c.id) ?? 9, after = g.leagues[c.league]?.tier ?? 9;
      if (after < before) storyAdd({ k: 'promotion', w: 9, p: {} });
      if (after > before) storyAdd({ k: 'relegation', w: 7, p: {} });
      const comp = Object.values(g.comps).find((x) => x.type === 'league' && x.clubs.includes(c.id));
      const row = comp?.table.find((r) => r.club === c.id);
      const hist = g.manager.history.at(-1);
      const top = squad(c.id).sort((a, b) => b.stats.goals - a.stats.goals)[0];
      const items = (g.manager.story?.season === g.season ? g.manager.story.items : []).slice().sort((a, b) => b.w - a.w || a.d.localeCompare(b.d));
      const story: SeasonStory = {
        season: g.season, club: c.id, clubName: c.name, league: comp?.name ?? '', pos: hist?.season === g.season ? hist.pos : 0,
        record: row ? [row.w, row.d, row.l] : [0, 0, 0], gf: row?.gf ?? 0, ga: row?.ga ?? 0,
        top: top && top.stats.goals ? { name: pname(top.id), goals: top.stats.goals } : undefined,
        items: items.slice(0, 8), fanMood: Math.round(c.fanMood ?? 60),
      };
      (g.manager.stories ??= []).push(story);
      if (g.manager.stories.length > 30) g.manager.stories.shift();
      g.manager.story = { season: g.season + 1, items: [] };
      addNews({ cat: 'general', key: 'story.ready', params: { season: `${g.season}/${String(g.season + 1).slice(2)}` } });
    });
  }
}
