import { positionString } from '../../game/attributes';
import type { MonthAward, SeasonSummary } from '../../game/types';
import { t } from '../../i18n';
import { ClubLink, Panel, PlayerLink, Tabs } from '../components';
import { useGame, useRouteState } from '../core';
import { Head } from './common';

const XI_LABELS = ['GK', 'RB', 'CB', 'CB', 'LB', 'RM', 'CM', 'CM', 'LM', 'ST', 'ST'];

export function Awards() {
  const g = useGame()!;
  const [tab, setTab] = useRouteState('tab', 'month');
  const seasons = g.seasonHistory.slice().reverse();
  const [season, setSeason] = useRouteState<number>('season', seasons[0]?.season ?? g.season);
  const myLeague = g.clubs[g.userClub]?.league ?? '';
  const [comp, setComp] = useRouteState('comp', myLeague);
  return (
    <div>
      <Head title={t('nav.awards')}>
        <Tabs tabs={[['month', t('aw.month')], ['gala', t('aw.gala')]]} value={tab} onChange={setTab} />
      </Head>
      {tab === 'month' && <MonthList awards={g.monthAwards ?? []} comp={comp} setComp={setComp} />}
      {tab === 'gala' && (seasons.length === 0
        ? <div className="empty">{t('aw.noGala')}</div>
        : (
          <>
            <div className="row" style={{ marginBottom: 12 }}>
              <select value={season} onChange={(e) => setSeason(Number(e.target.value))}>
                {seasons.map((s) => <option key={s.season} value={s.season}>{s.season}/{String(s.season + 1).slice(2)}</option>)}
              </select>
            </div>
            <Gala s={seasons.find((x) => x.season === season) ?? seasons[0]} comp={comp} setComp={setComp} />
          </>
        ))}
    </div>
  );
}

function MonthList({ awards, comp, setComp }: { awards: MonthAward[]; comp: string; setComp: (c: string) => void }) {
  const g = useGame()!;
  const comps = [...new Set(awards.map((a) => a.comp))];
  const shown = awards.filter((a) => !comp || a.comp === comp).slice().reverse();
  return (
    <Panel title={t('aw.month')} right={
      <select value={comp} onChange={(e) => setComp(e.target.value)}>
        <option value="">{t('aw.allLeagues')}</option>
        {comps.map((c) => <option key={c} value={c}>{g.comps[c]?.name ?? g.leagues[c]?.name ?? c}</option>)}
      </select>
    } className="flush">
      {shown.length === 0 ? <div className="empty">{t('aw.noMonth')}</div> : (
        <table className="grid">
          <thead><tr><th>{t('aw.monthCol')}</th><th>{t('col.comp')}</th><th>{t('aw.player')}</th><th>{t('aw.manager')}</th></tr></thead>
          <tbody>
            {shown.map((a, i) => (
              <tr key={i} className={a.manager === g.userClub ? 'me' : ''}>
                <td>{new Date(a.month + '-01T00:00:00Z').toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}</td>
                <td>{g.comps[a.comp]?.name ?? g.leagues[a.comp]?.name ?? a.comp}</td>
                <td>{g.players[a.player] ? <><PlayerLink p={g.players[a.player]} /> <span className="muted">({g.clubs[g.players[a.player].club]?.short ?? '-'})</span></> : '?'}</td>
                <td>{a.managerName} <ClubLink id={a.manager} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function Gala({ s, comp, setComp }: { s: SeasonSummary; comp: string; setComp: (c: string) => void }) {
  const g = useGame()!;
  const leagues = s.comps.filter((c) => c.teamOfYear);
  const lg = leagues.find((c) => c.id === comp) ?? leagues[0];
  return (
    <div>
      <div className="cols">
        <Panel title={t('aw.ballonDor')} className="flush">
          <table className="grid">
            <tbody>
              {(s.ballonDor ?? []).map((id, i) => {
                const p = g.players[id];
                const saved = s.ballonDorNames?.[i];
                return (
                  <tr key={id} className={i === 0 ? 'me' : ''}>
                    <td className="num">{i === 0 ? '🏆' : `${i + 1}.`}</td>
                    <td>{p ? <PlayerLink p={p} /> : <>{saved?.[0] ?? '?'} <span className="muted">{t('aw.retired')}</span></>}</td>
                    <td>{saved ? <ClubLink id={saved[1]} /> : p ? <ClubLink id={p.club} /> : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
        <Panel title={t('aw.season')}>
          <div className="kv">
            {s.managerOfYear && <><span>{t('aw.managerOfYear')}</span><span><b>{s.managerOfYear.name}</b> (<ClubLink id={s.managerOfYear.club} />, {s.managerOfYear.comp})</span></>}
            {s.comps.filter((c) => c.id === 'CL' || c.id === 'UEFA' || c.id === 'UECL').map((c) => [<span key={c.id + 'l'}>{c.name}</span>, <span key={c.id + 'v'}><ClubLink id={c.winner} long /></span>])}
          </div>
        </Panel>
      </div>
      {lg && (
        <Panel title={`${t('aw.league')}: ${lg.name}`} right={
          <select value={lg.id} onChange={(e) => setComp(e.target.value)}>
            {leagues.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        }>
          <div className="cols">
            <div className="kv">
              <span>{t('comp.winner')}</span><span><ClubLink id={lg.winner} long /></span>
              {lg.runnerUp && <><span>{t('comp.runnerUp')}</span><span><ClubLink id={lg.runnerUp} /></span></>}
              {lg.best && g.players[lg.best] && <><span>{t('comp.best')}</span><span><PlayerLink p={g.players[lg.best]} /></span></>}
              {lg.young && g.players[lg.young] && <><span>{t('comp.young')}</span><span><PlayerLink p={g.players[lg.young]} /></span></>}
              {lg.topScorer && g.players[lg.topScorer[0]] && <><span>{t('comp.topScorer')}</span><span><PlayerLink p={g.players[lg.topScorer[0]]} /> ({lg.topScorer[1]})</span></>}
              {lg.surprise && <><span>{t('aw.surprise')}</span><span><ClubLink id={lg.surprise.club} /> {t('aw.surpriseText', { expected: lg.surprise.expected, actual: lg.surprise.actual })}</span></>}
            </div>
            <div>
              <h4 className="accent" style={{ marginBottom: 8 }}>{t('aw.teamOfYear')}</h4>
              <table className="grid">
                <tbody>
                  {(lg.teamOfYear ?? []).map((id, i) => {
                    const p = g.players[id];
                    return (
                      <tr key={i}>
                        <td className="muted">{XI_LABELS[i]}</td>
                        <td>{p ? <PlayerLink p={p} /> : '–'}</td>
                        <td className="muted">{p ? positionString(p) : ''}</td>
                        <td>{p ? <ClubLink id={p.club} /> : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </Panel>
      )}
      {(s.monthAwards ?? []).length > 0 && <MonthList awards={s.monthAwards!} comp={lg?.id ?? ''} setComp={setComp} />}
    </div>
  );
}
