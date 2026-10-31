import { t } from '../../i18n';
import { ClubLink, Panel, PlayerLink } from '../components';
import { useGame } from '../core';
import { Head } from './common';
import { SeasonCard, StoryTimeline } from '../story';

export function History() {
  const g = useGame()!;
  const m = g.manager;
  return (
    <div>
      <Head title={t('nav.history')} />
      <div className="cols">
        <Panel title={t('hist.manager')}>
          <div className="kv">
            <span>{t('col.name')}</span><span>{m.name}</span>
            <span>{t('club.managerRep')}</span><span>{Math.round(m.rep)}</span>
            <span>{t('hist.trophies')}</span><span>{m.trophies.length}</span>
            <span>{t('hist.sacked')}</span><span>{m.sacked}</span>
            {g.challenge && <><span>{t('hist.challenge')}</span><span>{t(`challenge.${g.challenge.id}.title`)} {g.challenge.done ? `– ${t(`challenge.${g.challenge.done}`, { id: '' })}` : `(${t('hist.deadline')} ${g.challenge.deadlineSeason + 1})`}</span></>}
          </div>
        </Panel>
        <Panel title={t('hist.trophyCabinet')}>
          {m.trophies.length === 0 ? <div className="muted">{t('hist.noTrophies')}</div> : (
            <table className="grid"><tbody>{m.trophies.map((tr, i) => <tr key={i}><td>{tr.season}/{String(tr.season + 1).slice(2)}</td><td>{tr.comp}</td><td><ClubLink id={tr.club} /></td></tr>)}</tbody></table>
          )}
        </Panel>
        <Panel title={t('hist.career')}>
          {m.history.length === 0 ? <div className="muted">{t('hist.firstSeason')}</div> : (
            <table className="grid"><tbody>{m.history.map((h, i) => <tr key={i}><td>{h.season}/{String(h.season + 1).slice(2)}</td><td><ClubLink id={h.club} /></td><td>{g.leagues[h.league]?.name}</td><td className="num">{h.pos}.</td></tr>)}</tbody></table>
          )}
        </Panel>
      </div>
      <StoryTimeline />
      {(m.stories ?? []).length > 0 && (
        <Panel title={t('story.cards')}>
          <div className="season-cards">{m.stories!.slice().reverse().map((s) => <SeasonCard key={s.season} s={s} />)}</div>
        </Panel>
      )}
      {g.seasonHistory.slice().reverse().map((s) => (
        <Panel key={s.season} title={`${t('col.season')} ${s.season}/${String(s.season + 1).slice(2)}`} className="flush">
          <table className="grid">
            <thead><tr><th>{t('col.comp')}</th><th>{t('comp.winner')}</th><th>{t('comp.runnerUp')}</th><th>{t('comp.topScorer')}</th><th>{t('comp.best')}</th><th>{t('comp.young')}</th></tr></thead>
            <tbody>
              {s.comps.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td><ClubLink id={c.winner} /></td>
                  <td>{c.runnerUp ? <ClubLink id={c.runnerUp} /> : '-'}</td>
                  <td>{c.topScorer && g.players[c.topScorer[0]] ? <><PlayerLink p={g.players[c.topScorer[0]]} short /> ({c.topScorer[1]})</> : '-'}</td>
                  <td>{c.best && g.players[c.best] ? <PlayerLink p={g.players[c.best]} short /> : '-'}</td>
                  <td>{c.young && g.players[c.young] ? <PlayerLink p={g.players[c.young]} short /> : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ))}
    </div>
  );
}
