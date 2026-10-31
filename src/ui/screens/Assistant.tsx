import { useMemo, useRef, useState } from 'react';
import { ATTRS } from '../../game/attributes';
import { opponentReport, radar, RADAR_AXES } from '../../game/analysis';
import { attrRange } from '../../game/scouting';
import { gs, squad } from '../../game/state';
import { act } from '../../game/actions';
import { autoSelect, FORMATIONS } from '../../game/tactics';
import { userTactic } from '../../game/sim';
import { t } from '../../i18n';
import type { BenchRow } from '../../worker/bench.worker';
import { AttrVal, Panel, Pct, PlayerLink, Radar, Tabs } from '../components';
import { compareIds, toggleCompare } from '../compare';
import { useGame, useNav, useRouteState } from '../core';
import { Head } from './common';

export function Assistant({ tab: initial }: { tab?: string }) {
  const [tab, setTab] = useRouteState('tab', initial ?? 'opponent');
  return (
    <div>
      <Head title={t('nav.assistant')}>
        <Tabs tabs={[['opponent', t('as.opponent')], ['suggest', t('as.suggest')], ['compare', t('as.compare')], ['bench', t('as.bench')]]} value={tab} onChange={setTab} />
      </Head>
      {tab === 'opponent' && <Opponent />}
      {tab === 'suggest' && <Suggest />}
      {tab === 'compare' && <Compare />}
      {tab === 'bench' && <Benchmark />}
    </div>
  );
}

function Opponent() {
  const g = useGame()!;
  const next = Object.values(g.fixtures).filter((f) => !f.result && (f.home === g.userClub || f.away === g.userClub)).sort((a, b) => a.date.localeCompare(b.date))[0];
  const rep = useMemo(() => (next ? opponentReport(next) : null), [next?.id]);
  if (!next || !rep) return <div className="empty">{t('as.noMatch')}</div>;
  const zoneCell = (v: number, max: number) => `rgba(255, 212, 71, ${Math.min(0.85, v / max)})`;
  const maxAtt = Math.max(...rep.zones.theirs.att, 1);
  return (
    <div className="cols">
      <Panel title={t('an.opponent', { club: rep.opp.name })}>
        <div className="kv">
          <span>{t('an.formation')}</span><span>{rep.oppTactic.formation} ({t(`ment.${rep.oppTactic.team.mentality}`)})</span>
          <span>{t('col.form')}</span><span>{rep.form || '-'}</span>
          <span>{t('an.keyPlayers')}</span><span>{rep.keyPlayers.map((pid) => <div key={pid}><PlayerLink p={g.players[pid]} /></div>)}</span>
          <span>{t('an.odds')}</span><span><b className="good">{t('an.win')} <Pct v={rep.probs[0]} /></b> · {t('an.draw')} <Pct v={rep.probs[1]} /> · <b className="bad">{t('an.loss')} <Pct v={rep.probs[2]} /></b></span>
        </div>
        <div className="muted" style={{ marginTop: 6 }}>{t('an.oddsHint')}</div>
      </Panel>
      <Panel title={t('an.insights')}>
        {rep.insights.map((i, k) => <div key={k} className={`insight ${i.tone}`}>{t(i.key, { ...i.params, lane: i.params?.lane ? t(`lane.${i.params.lane}`) : undefined })}</div>)}
      </Panel>
      <Panel title={t('an.zones')}>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          {(['mine', 'theirs'] as const).map((side) => (
            <div key={side} style={{ flex: 1 }}>
              <div className="center muted">{side === 'mine' ? g.clubs[g.userClub].short : rep.opp.short} ↑</div>
              <div className="pitch" style={{ maxWidth: 170 }}>
                <div className="zone-grid">
                  {[4, 3, 2, 1, 0].flatMap((b) => [0, 1, 2].map((l) => {
                    const z = b * 3 + l;
                    const v = rep.zones[side].att[z] + rep.zones[side].def[z];
                    return <div key={z} style={{ background: zoneCell(v, maxAtt * 1.6) }}>{v.toFixed(1)}</div>;
                  }))}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="muted">{t('an.zonesHint')}</div>
      </Panel>
    </div>
  );
}

function Suggest() {
  const g = useGame()!;
  const cur = userTactic(false);
  const players = squad(g.userClub);
  const sugg = autoSelect(cur, players);
  const changed = sugg.lineup.some((id, i) => id !== cur.lineup[i]);
  return (
    <div className="cols2">
      <Panel title={t('as.current')}>
        <ol>{cur.lineup.map((id, i) => <li key={i}><span className="muted">{cur.slots[i].pos}{cur.slots[i].side !== 'C' ? cur.slots[i].side : ''}</span> <PlayerLink p={g.players[id]} /></li>)}</ol>
      </Panel>
      <Panel title={t('as.suggested')} right={changed ? <button className="small primary" onClick={() => act({ t: 'tactic', tactic: sugg })}>{t('as.use')}</button> : undefined}>
        <ol>{sugg.lineup.map((id, i) => <li key={i} className={id !== cur.lineup[i] ? 'accent' : ''}><span className="muted">{sugg.slots[i].pos}{sugg.slots[i].side !== 'C' ? sugg.slots[i].side : ''}</span> <PlayerLink p={g.players[id]} /></li>)}</ol>
        {!changed && <div className="muted">{t('as.agrees')}</div>}
        <div className="muted">{t('as.suggestHint')}</div>
      </Panel>
    </div>
  );
}

const COLORS = ['#ffd447', '#7fd1ff', '#ff8fd0'];

function Compare() {
  const g = useGame()!;
  const { nav } = useNav();
  const ps = compareIds.map((id) => g.players[id]).filter(Boolean);
  if (ps.length < 2) {
    return (
      <div className="empty">
        {t('as.compareHint')}
        <div className="gap" />
        <button onClick={() => nav({ name: 'squad' })}>{t('nav.squad')}</button>
      </div>
    );
  }
  const labels = RADAR_AXES.map((a) => t(`radar.${a.key}`));
  return (
    <div className="cols">
      <Panel title={t('as.radar')}>
        <Radar labels={labels} series={ps.map((p, i) => ({ name: p.last, values: radar(p), color: COLORS[i] }))} />
        <div className="legend">{ps.map((p, i) => <span key={p.id}><i style={{ background: COLORS[i] }} />{p.last} <button className="small" onClick={() => toggleCompare(p.id)}>×</button></span>)}</div>
      </Panel>
      <Panel title={t('as.attributes')} className="flush">
        <table className="grid">
          <thead><tr><th></th>{ps.map((p) => <th key={p.id}><PlayerLink p={p} short /></th>)}</tr></thead>
          <tbody>
            {ATTRS.slice(0, 36).map((a, i) => {
              const vals = ps.map((p) => attrRange(p, i));
              const mids = vals.map(([lo, hi]) => (lo + hi) / 2);
              const best = Math.max(...mids);
              return (
                <tr key={a}>
                  <td className="muted">{t(`attr.${a}`)}</td>
                  {vals.map(([lo, hi], j) => <td key={j} style={mids[j] === best && mids.filter((m) => m === best).length === 1 ? { background: '#1f5a33' } : undefined}><AttrVal lo={lo} hi={hi} /></td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function Benchmark() {
  const g = useGame()!;
  const [rows, setRows] = useState<BenchRow[] | null>(null);
  const [progress, setProgress] = useState(0);
  const [matches, setMatches] = useRouteState('matches', 100);
  const worker = useRef<Worker | null>(null);
  const run = () => {
    worker.current?.terminate();
    const w = new Worker(new URL('../../worker/bench.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    setRows([]);
    setProgress(0);
    w.onmessage = (e) => {
      setRows(e.data.rows);
      if (e.data.progress !== undefined) setProgress(e.data.progress);
      if (e.data.done) { setProgress(1); w.terminate(); }
    };
    const tactic = userTactic(false);
    const players = squad(gs().userClub);
    w.postMessage({ players, tactic, opponents: FORMATIONS, matches, seed: Date.now() & 0xffff });
  };
  return (
    <div>
      <Panel title={t('as.bench')}>
        <p className="muted">{t('as.benchHint')}</p>
        <div className="row">
          <label>{t('as.matchesPer')} <select value={matches} onChange={(e) => setMatches(Number(e.target.value))}>{[50, 100, 250, 500].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          <button className="primary" onClick={run}>{t('as.runBench')} ({g.tactic?.formation})</button>
          {rows && progress < 1 && <span className="muted">{Math.round(progress * 100)}%</span>}
        </div>
      </Panel>
      {rows && rows.length > 0 && (
        <Panel className="flush">
          <table className="grid">
            <thead><tr><th>{t('as.vs')}</th><th className="num">{t('tbl.w')}</th><th className="num">{t('tbl.d')}</th><th className="num">{t('tbl.l')}</th><th className="num">{t('as.ppg')}</th><th className="num">{t('tbl.gf')}</th><th className="num">{t('tbl.ga')}</th><th className="num">xG</th><th className="num">xGA</th><th className="num">{t('stat.possession')}</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const n = r.w + r.d + r.l || 1;
                const ppg = (r.w * 3 + r.d) / n;
                return (
                  <tr key={r.formation}>
                    <td>{r.formation}</td>
                    <td className="num">{r.w}</td><td className="num">{r.d}</td><td className="num">{r.l}</td>
                    <td className={`num ${ppg >= 1.6 ? 'good' : ppg < 1.2 ? 'bad' : ''}`}><b>{ppg.toFixed(2)}</b></td>
                    <td className="num">{(r.gf / n).toFixed(2)}</td><td className="num">{(r.ga / n).toFixed(2)}</td>
                    <td className="num">{(r.xg / n).toFixed(2)}</td><td className="num">{(r.xga / n).toFixed(2)}</td>
                    <td className="num">{Math.round(r.poss / n)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
