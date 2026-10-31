
import { leadLoss, matchVerdict } from '../../game/analysis';
import { hash01 } from '../../game/rng';
import { gs } from '../../game/state';
import { useState } from 'react';
import type { MatchReport } from '../../game/types';
import { t } from '../../i18n';
import { ClubLink, Crest, Panel, PlayerLink, Rating, Tabs } from '../components';
import { useGame, useRouteState } from '../core';
import { commentaryText } from '../commentary';
import { Head } from './common';
import { StatsPanel, statColors } from './Match';
import { WEATHER_ICON, type Weather } from '../../game/weather';
import { TeamTalk } from '../teamtalk';

export function ReportScreen({ id }: { id: number }) {
  const g = useGame()!;
  const rep = g.reports[id];
  const [tab, setTab] = useRouteState('tab', 'analysis');
  if (!rep) return <Head title={t('report.missing')} />;
  const side: 0 | 1 = rep.away === g.userClub ? 1 : 0;
  const home = g.clubs[rep.home]?.short ?? '?', away = g.clubs[rep.away]?.short ?? '?';
  const verdict = matchVerdict(rep, side);
  const mom = g.players[rep.mom];
  const mine = rep.home === g.userClub || rep.away === g.userClub;
  // samme dag som kampen: holdsnak efter kampen (komponenten viser intet, når den er holdt)
  const talking = mine && !g.draft && g.fixtures[id]?.date === g.date;
  const myLines = rep.players.filter((l) => l.team === side);
  const diff = rep.stats[side].goals - rep.stats[1 - side].goals + (rep.pens ? Math.sign(rep.pens[side] - rep.pens[1 - side]) : 0);
  return (
    <div>
      <Head title={t('report.title')} />
      <div className="scoreboard">
        <div className="team"><Crest id={rep.home} size={34} /><ClubLink id={rep.home} noCrest /></div>
        <div>
          <div className="score">{rep.stats[0].goals} - {rep.stats[1].goals}</div>
          {rep.weather && <div className="minute">{WEATHER_ICON[rep.weather as Weather]} {t(`wx.${rep.weather}`)}</div>}
          <div className="minute">{rep.pens ? `${t('fix.pens')} ${rep.pens[0]}-${rep.pens[1]}` : rep.et ? t('fix.aet') : t('match.ft')} · xG {rep.stats[0].xg.toFixed(2)} - {rep.stats[1].xg.toFixed(2)}</div>
        </div>
        <div className="team away"><Crest id={rep.away} size={34} /><ClubLink id={rep.away} noCrest /></div>
      </div>
      <Goals rep={rep} />
      {rep.shootout && (
        <Panel title={`${t('report.shootout')} ${rep.pens?.[0]}-${rep.pens?.[1]}`}>
          <div className="so-list">
            {[0, 1].map((tm) => (
              <div key={tm}>
                <b>{tm === 0 ? home : away}</b>
                {rep.shootout!.filter((k) => k.t === tm).map((k, i) => (
                  <div key={i} className={k.outcome === 'goal' ? 'good' : 'bad'}>{k.outcome === 'goal' ? '✓' : '✕'} {g.players[k.p]?.last ?? '?'}{k.outcome === 'saved' ? ` (${t('report.soSaved')})` : k.outcome === 'off' ? ` (${t('report.soWide')})` : ''}</div>
                ))}
              </div>
            ))}
          </div>
        </Panel>
      )}
      {talking && <TeamTalk fixture={id} stage="post" pids={myLines.map((l) => l.id)} diff={diff} ratings={Object.fromEntries(myLines.map((l) => [l.id, l.rating]))} />}
      <Tabs tabs={[['analysis', t('report.analysis')], ['stats', t('match.stats')], ['players', t('report.players')], ['commentary', t('match.commentary')]]} value={tab} onChange={setTab} />
      {tab === 'analysis' && mine && <LeadLossPanel rep={rep} side={side} />}
      {tab === 'analysis' && (
        <>
          {/* kampens forløb i fuld bredde: momentum, markører og (for egne kampe) taktiske ændringer før/efter */}
          <Panel title={t('report.momentum')} className="flow-panel">
            <Momentum rep={rep} home={home} away={away} colors={mine ? statColors(rep.home, rep.away, side) : ['var(--accent)', 'var(--accent2)']} />
            {mine && <TacticImpact rep={rep} side={side} />}
          </Panel>
          <div className="cols">
            <Panel title={t('report.verdict')}>
              {verdict.map((v, i) => <div key={i} className={`insight ${v.tone}`}>{t(v.key, { ...v.params, lane: v.params?.lane ? t(`lane.${v.params.lane}`) : undefined })}</div>)}
              {mom && <div className="insight good">{t('report.mom')}: <PlayerLink p={mom} /> (<Rating r={rep.players.find((p) => p.id === mom.id)?.rating ?? 0} />)</div>}
            </Panel>
            <Panel title={t('report.heatmap')}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <Heat rep={rep} team={0} label={home} />
                <Heat rep={rep} team={1} label={away} />
              </div>
              <div className="muted">{t('report.heatHint')}</div>
            </Panel>
            <Panel title={t('report.shotmap')}><ShotMap rep={rep} home={home} away={away} /></Panel>
          </div>
        </>
      )}
      {tab === 'stats' && <StatsPanel stats={rep.stats} home={home} away={away} colors={mine ? statColors(rep.home, rep.away, side) : undefined} />}
      {tab === 'players' && (
        <div className="cols2">
          {[0, 1].map((tm) => (
            <Panel key={tm} title={tm === 0 ? home : away} className="flush">
              <table className="grid">
                <thead><tr><th>{t('col.name')}</th><th className="num">{t('report.min')}</th><th className="num">{t('col.goals')}</th><th className="num">{t('col.assists')}</th><th className="num">{t('stat.shots')}</th><th className="num">{t('report.passes')}</th><th className="num">{t('match.rating')}</th></tr></thead>
                <tbody>
                  {rep.players.filter((p) => p.team === tm).map((l) => (
                    <tr key={l.id} className={l.id === rep.mom ? 'me' : ''}>
                      <td><PlayerLink p={g.players[l.id]} short />{l.sub ? <span className="tag">{t('tac.sub')}</span> : null}{l.yellow ? ' 🟨' : ''}{l.red ? ' 🟥' : ''}{l.injured ? ' ✚' : ''}</td>
                      <td className="num">{l.minutes}</td>
                      <td className="num">{l.goals || ''}</td>
                      <td className="num">{l.assists || ''}</td>
                      <td className="num">{l.shots || ''}</td>
                      <td className="num">{l.passesOk}/{l.passes}</td>
                      <td className="num"><Rating r={l.rating} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          ))}
        </div>
      )}
      {tab === 'commentary' && (
        <div className="commentary" style={{ height: '60vh' }}>
          {rep.commentary.length === 0 && <div className="muted">{t('report.noCommentary')}</div>}
          {(() => {
            let h = 0, a = 0;
            return rep.commentary.map((l, i) => {
              if (l.k.startsWith('goal')) { if (l.t === 0) h++; else a++; }
              const text = commentaryText(l, { home, away, score: `${home} ${h}-${a} ${away}` }, i);
              return <div key={i} className={`ln ${l.hi ? 'hi' : ''}`}><span className="m">{l.m}'</span>{text}</div>;
            });
          })()}
        </div>
      )}
    </div>
  );
}

function Goals({ rep }: { rep: MatchReport }) {
  const g = useGame()!;
  const ev = rep.events.filter((e) => e.k === 'goal' || e.k === 'red').sort((a, b) => a.m - b.m);
  if (!ev.length) return null;
  // samme opdeling som resultattavlen: hjemmeholdets mål højrestillet til venstre, udeholdets venstrestillet til højre
  return (
    <div className="goals-row">
      {[0, 1].map((tm) => (
        <div key={tm} className={tm === 0 ? 'g-home' : 'g-away'}>
          {ev.filter((e) => e.t === tm).map((e, i) => (
            <div key={i}>
              {e.k === 'goal' ? '⚽' : '🟥'} <PlayerLink p={g.players[e.p!]} short /> <span className="muted">{e.m}'</span>
              {e.k === 'goal' && e.p2 && g.players[e.p2] ? <span className="muted"> ({g.players[e.p2].last})</span> : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Momentum({ rep, home, away, colors }: { rep: MatchReport; home: string; away: string; colors: [string, string] }) {
  const vals = rep.momentum;
  const W = 1000, H = 140, mid = H / 2;
  const max = Math.max(1, ...vals.map((v) => Math.abs(v)));
  const bw = W / Math.max(18, vals.length);
  // målene står over/under grafen; holdnavnene i en forklaring nederst, så intet overlapper
  return (
    <div className="momentum">
    <svg viewBox={`0 -12 ${W} ${H + 36}`} className="chart" role="img" aria-label="momentum">
      <line x1={0} x2={W} y1={mid} y2={mid} stroke="#ffffff33" />
      <line x1={W * 0.5} x2={W * 0.5} y1={0} y2={H} stroke="#ffffff22" strokeDasharray="2 2" />
      {vals.map((v, i) => {
        const h = (Math.abs(v) / max) * (mid - 4);
        return <rect key={i} x={i * bw + 1} width={bw - 2} y={v >= 0 ? mid - h : mid} height={h} rx={1} fill={v >= 0 ? colors[0] : colors[1]} />;
      })}
      {markers(rep).map((mk, i) => {
        const x = Math.min(W - 2, ((mk.m - 1) / 5) * bw + bw / 2);
        return (
          <g key={`mk${i}`}>
            <title>{`${mk.m}' ${mk.label}`}</title>
            <line x1={x} x2={x} y1={4} y2={H - 4} stroke={mk.t === 0 ? colors[0] : colors[1]} strokeWidth={0.8} strokeDasharray="2 2" opacity={0.8} />
            <text x={x} y={mk.t === 0 ? 10 : H - 6} textAnchor="middle" fontSize="7" className="mk-glyph">{mk.glyph}</text>
          </g>
        );
      })}
      {rep.events.filter((e) => e.k === 'goal').map((e, i) => (
        <text key={i} x={Math.min(W - 6, ((e.m - 1) / 5) * bw + bw / 2)} y={e.t === 0 ? -2 : H + 8} textAnchor="middle" fontSize="9">⚽</text>
      ))}
      <text x={2} y={H + 20}>0'</text><text x={W / 2} y={H + 20} textAnchor="middle">45'</text><text x={W - 2} y={H + 20} textAnchor="end">90'</text>
    </svg>
    <div className="mom-legend">
      <span><i style={{ background: colors[0] }} />{home} ↑</span>
      <span><i style={{ background: colors[1] }} />{away} ↓</span>
      {markers(rep).length > 0 && <span className="muted">{t('mom.markers')}</span>}
    </div>
    </div>
  );
}

function Heat({ rep, team, label }: { rep: MatchReport; team: number; label: string }) {
  const heat = rep.heat[team];
  const max = Math.max(1, ...heat);
  const total = heat.reduce((s, v) => s + v, 0) || 1;
  // vis altid holdet angribende opad
  const cells: number[] = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      const rb = 4 - row;
      const b = team === 0 ? rb : 4 - rb;
      const l = team === 0 ? col : 2 - col;
      cells.push(heat[b * 3 + l]);
    }
  }
  return (
    <div style={{ flex: 1, minWidth: 120 }}>
      <div className="center muted">{label} →</div>
      <div className="pitch" style={{ maxWidth: 170 }}>
        <div className="zone-grid">
          {cells.map((v, i) => <div key={i} style={{ background: `rgba(255, ${Math.round(200 - (v / max) * 170)}, 40, ${0.15 + (v / max) * 0.7})` }}>{Math.round((v / total) * 100)}%</div>)}
        </div>
      </div>
    </div>
  );
}

function ShotMap({ rep, home, away }: { rep: MatchReport; home: string; away: string }) {
  const W = 300, H = 190;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="shots" style={{ background: '#2b7a3b', borderRadius: 4 }}>
        <g stroke="#ffffffaa" fill="none" strokeWidth={1}>
          <rect x={2} y={2} width={W - 4} height={H - 4} />
          <line x1={W / 2} y1={2} x2={W / 2} y2={H - 2} />
          <rect x={2} y={H / 2 - 45} width={44} height={90} />
          <rect x={W - 46} y={H / 2 - 45} width={44} height={90} />
        </g>
        {rep.shots.map((s, i) => {
          const b = Math.floor(s.zone / 3), l = s.zone % 3;
          const jx = hash01(i, s.m, 1) * 0.8 + 0.1, jy = hash01(i, s.m, 2) * 0.8 + 0.1;
          // zoner: bånd i længderetning (x), baner i bredden (y)
          const x = ((b + (s.kind === 'pen' ? 0.6 : jx)) / 5) * W;
          const y = ((l + jy) / 3) * H;
          const r = 3 + s.xg * 16;
          const fill = s.outcome === 'goal' ? '#ffd447' : s.outcome === 'saved' ? '#7fd1ff' : s.outcome === 'blocked' ? '#999' : '#ff6b6b';
          return <circle key={i} cx={x} cy={y} r={r} fill={fill} fillOpacity={0.75} stroke={s.t === 0 ? '#fff' : '#000'} strokeWidth={1}><title>{`${s.m}' xG ${s.xg}`}</title></circle>;
        })}
      </svg>
      <div className="legend">
        <span><i style={{ background: '#ffd447' }} />{t('shot.goal')}</span><span><i style={{ background: '#7fd1ff' }} />{t('shot.saved')}</span>
        <span><i style={{ background: '#ff6b6b' }} />{t('shot.off')}</span><span><i style={{ background: '#999' }} />{t('shot.blocked')}</span>
        <span className="muted">{home} → · ← {away}</span>
      </div>
    </div>
  );
}

/** Markører på momentumgrafen: formation (F), mentalitet (M), instruktioner (I) og udskiftninger (⇄) */
function markers(rep: MatchReport): { m: number; t: number; glyph: string; label: string }[] {
  const g = gs();
  const out = (rep.changes ?? []).map((c) => ({ m: c.m, t: c.t, glyph: c.kind === 'formation' ? 'F' : c.kind === 'mentality' ? 'M' : 'I',
    label: c.kind === 'formation' ? t('ll.c.formation', { f: c.to ?? '' }) : c.kind === 'mentality' ? t('ll.c.mentality', { m: t(MENT[Number(c.to)] ?? 'ment.2') }) : t('ll.c.instr') }));
  for (const e of rep.events) if (e.k === 'sub') out.push({ m: e.m, t: e.t, glyph: '⇄', label: `${g.players[e.p ?? 0]?.last ?? ''} ↔ ${g.players[e.p2 ?? 0]?.last ?? ''}` });
  return out.sort((a, b) => a.m - b.m);
}

/** Før og efter vores egne ændringer: chancer og pres pr. 10 minutter (sammenfald – ikke nødvendigvis årsag) */
function TacticImpact({ rep, side }: { rep: MatchReport; side: 0 | 1 }) {
  const mine = markers(rep).filter((m) => m.t === side && m.m < 88);
  const [sel, setSel] = useState(0);
  if (!mine.length) return null;
  const mk = mine[Math.min(sel, mine.length - 1)];
  const end = rep.et ? 120 : 90;
  const per10 = (v: number, mins: number) => (mins > 0 ? (v / mins) * 10 : 0);
  const span = (after: boolean) => (after ? end - mk.m : mk.m);
  const inSpan = (m: number, after: boolean) => (after ? m > mk.m : m <= mk.m);
  const xg = (tm: number, after: boolean) => per10(rep.shots.filter((x) => x.t === tm && inSpan(x.m, after)).reduce((a, x) => a + x.xg, 0), span(after));
  const shots = (tm: number, after: boolean) => per10(rep.shots.filter((x) => x.t === tm && inSpan(x.m, after)).length, span(after));
  const goals = (tm: number, after: boolean) => rep.events.filter((e) => e.k === 'goal' && e.t === tm && inSpan(e.m, after)).length;
  const sign = side === 0 ? 1 : -1;
  const mom = (after: boolean) => { const b = rep.momentum.filter((_, i) => inSpan(i * 5 + 5, after)); return b.length ? (b.reduce((a, v) => a + v, 0) / b.length) * sign : 0; };
  const row = (label: string, a: number, b: number, dec = 2, goodUp = true) => {
    const better = goodUp ? b > a + 0.01 : b < a - 0.01, worse = goodUp ? b < a - 0.01 : b > a + 0.01;
    return <tr key={label}><td>{label}</td><td className="num">{a.toFixed(dec)}</td><td className={`num ${better ? 'good' : worse ? 'bad' : ''}`}>{b.toFixed(dec)}</td></tr>;
  };
  return (
    <div className="ti-wrap">
      <h4 className="ti-h">{t('ti.title')}</h4>
      <div className="ti-cols">
      <div className="ti-list">
        <div className="ti-list-h">{t('ti.change')}</div>
        {mine.map((m, i) => <button key={i} className={`ti-pick ${i === sel ? 'on' : ''}`} onClick={() => setSel(i)}><b>{m.m}'</b> <span className="ti-glyph">{m.glyph}</span> {m.label}</button>)}
      </div>
      <table className="grid ti-table">
        <thead><tr><th></th><th className="num">{t('ti.before', { m: mk.m })}</th><th className="num">{t('ti.after', { m: mk.m })}</th></tr></thead>
        <tbody>
          {row(t('ti.xgFor'), xg(side, false), xg(side, true))}
          {row(t('ti.xgAgainst'), xg(1 - side, false), xg(1 - side, true), 2, false)}
          {row(t('ti.shotsFor'), shots(side, false), shots(side, true), 1)}
          {row(t('ti.shotsAgainst'), shots(1 - side, false), shots(1 - side, true), 1, false)}
          {row(t('ti.momentum'), mom(false), mom(true), 2)}
          {row(t('ti.goals'), goals(side, false) - goals(1 - side, false), goals(side, true) - goals(1 - side, true), 0)}
        </tbody>
      </table>
      </div>
      <p className="muted" style={{ marginBottom: 0, fontSize: 12.5 }}>{t('ti.caveat')}</p>
    </div>
  );
}

const MENT = ['ment.0', 'ment.1', 'ment.2', 'ment.3', 'ment.4'];

/** Føringen glippede: hvad ændrede sig efter føringen? (sammenfald – ikke bevis for årsag) */
function LeadLossPanel({ rep, side }: { rep: MatchReport; side: 0 | 1 }) {
  const g = useGame()!;
  const a = leadLoss(rep, side);
  if (!a) return null;
  const opp = g.clubs[side === 0 ? rep.away : rep.home]?.short ?? '';
  const swing = a.xgAfter[1] - a.xgAfter[0] - (a.xgBefore[1] - a.xgBefore[0]);
  const change = (c: { kind: string; to?: string }) => c.kind === 'formation' ? t('ll.c.formation', { f: c.to ?? '' }) : c.kind === 'mentality' ? t('ll.c.mentality', { m: t(MENT[Number(c.to)] ?? 'ment.2') }) : t('ll.c.instr');
  return (
    <Panel title={t('ll.title')} className="ll-panel">
      <div className="insight bad">{t('ll.intro', { lead: a.lead, min: a.leadMin, lost: a.lostMin })}</div>
      <div className="ll-grid">
        <div><b>xG</b><span>{t('ll.xg', { a: a.xgBefore[0].toFixed(2), b: a.xgBefore[1].toFixed(2), c: a.xgAfter[0].toFixed(2), d: a.xgAfter[1].toFixed(2) })}</span>
          <em className={swing > 0.3 ? 'bad' : 'muted'}>{swing > 0.3 ? t('ll.xgSwing', { opp }) : t('ll.xgEven')}</em></div>
        <div><b>{t('ll.shots')}</b><span>{t('ll.shotsAfter', { a: a.shotsAfter[0], b: a.shotsAfter[1], opp })}</span></div>
        <div><b>{t('ll.oppChanges', { opp })}</b>
          <span>{a.oppSubs || a.oppChanges.length ? [a.oppSubs ? t('ll.subs', { n: a.oppSubs }) : '', ...a.oppChanges.map((c) => `${c.m}': ${change(c)}`)].filter(Boolean).join(' · ') : t('ll.none')}</span></div>
        <div><b>{t('ll.ourChanges')}</b><span>{a.ourSubs || a.ourChanges ? t('ll.ours', { subs: a.ourSubs, n: a.ourChanges }) : t('ll.noneOurs')}</span></div>
        <div><b>{t('ll.fatigue')}</b><span>{a.tired.length ? a.tired.map((x) => `${g.players[x.id]?.last ?? '?'} (${x.cond}%)`).join(', ') : t('ll.fresh')}</span></div>
        <div><b>{t('ll.zone')}</b><span>{a.weakLane ? t('ll.weakLane', { lane: t(`lane.${a.weakLane}`) }) : t('ll.noPattern')}</span></div>
      </div>
      <p className="muted" style={{ marginBottom: 0, fontSize: 12.5 }}>{t('ll.caveat')}</p>
    </Panel>
  );
}
