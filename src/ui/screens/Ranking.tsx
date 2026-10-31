import { useEffect, useState } from 'react';
import { SupporterBadge } from '../Support';
import { askConfirm } from '../confirm';
import { careerPoints, computeSeasonScore, leagueWeight, type SeasonScore } from '../../game/rating';
import { enableMultiplayer, isMultiplayer, withHuman } from '../../game/humans';
import { session } from '../../online/client';
import { finalOrder } from '../../game/competitions';
import { h2hFor } from '../../game/h2h';
import { nextBot, pickBotClub, type BotScope } from '../../game/bots';
import { act } from '../../game/actions';
import { ClubLink } from '../components';
import { createProfile, fetchBoard, getProfile, profileUrl, rankingAvailable, submitPending, type Board, type RankRow } from '../../online/rank';
import { t } from '../../i18n';
import { Panel, Tabs } from '../components';
import { useGame, useNav, useRouteState } from '../core';
import { Head } from './common';

const lineText = (key: string, params?: Record<string, string | number>) => t(`score.${key}`, params?.stage ? { ...params, stage: t(`rank.stage.${params.stage}`) } : params);

function ScoreTable({ s }: { s: SeasonScore }) {
  return (
    <table className="grid">
      <tbody>
        {s.lines.map((l, i) => (
          <tr key={i}><td>{lineText(l.key, l.params)}</td><td className={`num ${l.pts > 0 ? 'good' : l.pts < 0 ? 'bad' : ''}`}>{l.pts > 0 ? '+' : ''}{l.pts}</td></tr>
        ))}
        <tr className="me"><td><b>{t('rank.total')}</b></td><td className="num"><b>{s.points}</b></td></tr>
      </tbody>
    </table>
  );
}

export function RankingScreen() {
  const g = useGame()!;
  const { route } = useNav();
  const [tab, setTab] = useRouteState('tab', route.tab ?? (isMultiplayer(g) ? 'managers' : 'mine'));
  return (
    <div>
      <Head title={t('nav.ranking')}>
        {!g.draft && <Tabs tabs={[['managers', t('bots.managers')], ['mine', t('rank.mine')], ['boards', t('rank.boards')], ['how', t('rank.how')]]} value={tab} onChange={setTab} />}
      </Head>
      {(tab === 'managers' || g.draft) && <Managers />}
      {!g.draft && tab === 'mine' && <Mine />}
      {!g.draft && tab === 'boards' && (isMultiplayer(g) ? <div className="empty">{t('rank.singleOnly')}</div> : <Boards />)}
      {!g.draft && tab === 'how' && <How />}
    </div>
  );
}

function Mine() {
  const g = useGame()!;
  const live = computeSeasonScore(true);
  const past = (g.manager.scores ?? []).slice().reverse();
  return (
    <div className="cols">
      <Panel title={t('rank.liveTitle', { season: `${g.season}/${String(g.season + 1).slice(2)}` })}>
        {live ? <ScoreTable s={live} /> : <div className="muted">{t('rank.noLive')}</div>}
        <p className="muted" style={{ fontSize: 12 }}>{t('rank.liveHint')}</p>
      </Panel>
      <Panel title={t('rank.career', { pts: careerPoints() })} className="flush">
        {past.length === 0 ? <div className="empty">{t('rank.noSeasons')}</div> : (
          <table className="grid">
            <tbody>
              {past.map((s) => (
                <tr key={s.season}>
                  <td>{s.season}/{String(s.season + 1).slice(2)}</td>
                  <td>{s.clubName}</td>
                  <td className="muted">{s.leagueName}</td>
                  <td className="num"><b>{s.points}</b></td>
                  <td className="muted">{s.submitted ? '✓' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      {past[0] && (
        <Panel title={t('rank.lastSeason', { season: `${past[0].season}/${String(past[0].season + 1).slice(2)}` })}>
          <ScoreTable s={past[0]} />
        </Panel>
      )}
    </div>
  );
}

function Boards() {
  const g = useGame()!;
  const [profile, setProfile] = useState(getProfile());
  const [board, setBoard] = useRouteState<Board>('board', 'career');
  const [data, setData] = useState<{ rows: RankRow[]; me: { rank: number; points: number } | null; total: number } | null | 'loading'>('loading');
  const [name, setName] = useState(g.manager.name);
  const [err, setErr] = useState('');
  const myLeague = g.clubs[g.userClub]?.league ?? '';
  useEffect(() => {
    if (!rankingAvailable()) { setData(null); return; }
    let alive = true;
    setData('loading');
    submitPending().then(() => fetchBoard(board, myLeague)).then((d) => { if (alive) setData(d); });
    return () => { alive = false; };
  }, [board, profile]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!rankingAvailable()) return <div className="empty">{t('rank.offline')}</div>;

  const create = async () => {
    setErr('');
    const r = await createProfile(name);
    if (typeof r === 'string') setErr(t(`rank.err.${r}`));
    else setProfile(r);
  };
  const share = async () => {
    const me = data && data !== 'loading' ? data.me : null;
    const text = me ? t('rank.shareText', { rank: me.rank, pts: me.points, board: t(`rank.board.${board}`) }) : t('rank.shareInvite');
    const url = location.origin;
    try {
      if (navigator.share) await navigator.share({ title: 'TACTICA FC', text, url });
      else { await navigator.clipboard.writeText(`${text} ${url}`); setErr(t('rank.copied')); }
    } catch { /* afbrudt */ }
  };

  return (
    <div>
      {!profile ? (
        <Panel title={t('rank.createTitle')}>
          <p className="muted" style={{ marginTop: 0 }}>{t('rank.createHint')}</p>
          <div className="row">
            <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder={t('rank.namePlaceholder')} />
            <button className="primary" onClick={create}>{t('rank.create')}</button>
          </div>
          {err && <div className="bad" style={{ marginTop: 6 }}>{err}</div>}
        </Panel>
      ) : (
        <div className="row" style={{ marginBottom: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <span>{t('rank.youAre', { name: profile.name })}{data && data !== 'loading' && data.me ? <> · <b className="accent">{t('rank.position', { rank: data.me.rank, total: data.total })}</b></> : null}</span>
          <button onClick={share}>{t('rank.share')}</button>
        </div>
      )}
      {err && profile && <div className="muted">{err}</div>}
      <Tabs tabs={[['career', t('rank.board.career')], ['season', t('rank.board.season')], ['month', t('rank.board.month')], ...(myLeague ? [['league', t('rank.board.league', { league: g.leagues[myLeague]?.name ?? myLeague })] as [string, string]] : [])]} value={board} onChange={(v) => setBoard(v as Board)} />
      <Panel className="flush" style={{ marginTop: 12 }}>
        {data === 'loading' ? <div className="empty">{t('rank.loading')}</div> : !data ? <div className="empty">{t('rank.error')}</div> : data.rows.length === 0 ? <div className="empty">{t('rank.empty')}</div> : (
          <div className="table-wrap">
            <table className="grid">
              <thead><tr><th className="num">#</th><th>{t('rank.manager')}</th><th>{t('rank.club')}</th><th>{t('col.comp')}</th>{board === 'career' ? <th className="num">{t('rank.seasons')}</th> : <th>{t('rank.season')}</th>}<th className="num">{t('rank.points')}</th></tr></thead>
              <tbody>
                {data.rows.map((r, i) => {
                  const mine = board === 'career' ? r.id === g.id : r.id.startsWith(`${g.id}:`);
                  return (
                    <tr key={r.id} className={mine ? 'me' : ''}>
                      <td className="num">{i + 1}</td>
                      <td>{r.pid ? <a className="link" onClick={() => window.open(profileUrl(r.pid!), '_blank')}>{r.name}</a> : r.name} <SupporterBadge tier={r.supporter} /></td>
                      <td>{r.club}</td>
                      <td className="muted">{r.league}</td>
                      {board === 'career' ? <td className="num">{r.seasons ?? ''}</td> : <td>{r.season ? `${r.season}/${String(r.season + 1).slice(2)}` : ''}</td>}
                      <td className="num"><b>{r.points}</b></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <p className="muted" style={{ fontSize: 12 }}>{t('rank.fairness')}</p>
    </div>
  );
}

function How() {
  const g = useGame()!;
  const lw = g.clubs[g.userClub] ? leagueWeight(g.clubs[g.userClub].league) : 1;
  return (
    <Panel title={t('rank.how')}>
      <p style={{ marginTop: 0, lineHeight: 1.55 }}>{t('rank.howIntro')}</p>
      <ul style={{ lineHeight: 1.7 }}>
        {['position', 'expectation', 'title', 'promotion', 'relegation', 'cup', 'cl', 'uefa', 'board', 'sacked', 'finance', 'youth'].map((k) => <li key={k}>{t(`rank.howLine.${k}`)}</li>)}
      </ul>
      <p className="muted">{t('rank.howWeight', { w: lw.toFixed(2) })}</p>
    </Panel>
  );
}

/** Alle managere i spillet (mennesker og AI-managere) – stilling, point og karriere */
function Managers() {
  const g = useGame()!;
  const [scope, setScope] = useState<BotScope>('league');
  const [msg, setMsg] = useState('');
  const slots = g.humans ?? [{ pid: '', name: g.manager.name, bot: undefined }];
  const rows = slots.map((h) => withHuman(h.pid, () => {
    const c = g.clubs[g.userClub];
    const comp = c ? g.comps[c.league] : undefined;
    const pos = comp ? finalOrder(comp).indexOf(c.id) + 1 : 0;
    const live = computeSeasonScore(true);
    return { pid: h.pid, name: h.name, bot: h.bot?.style, h2h: h.pid && g.active && h.pid !== g.active ? h2hFor(g.active, h.pid) : null, club: g.userClub, league: comp?.name ?? '', pos, live: live?.points ?? 0, career: careerPoints(), trophies: g.manager.trophies.length, conf: Math.round(g.board.confidence) };
  })).sort((a, b) => b.career + b.live - (a.career + a.live));
  const add = async () => {
    if (!isMultiplayer(g)) {
      // solospil → lokalt spil mod AI-managere (den globale rangliste gælder ikke længere)
      if (!(await askConfirm(t('bots.convertConfirm')))) return;
      enableMultiplayer('host', g.manager.name);
      g.localMp = true;
    }
    const c = pickBotClub(scope, (g.humans?.length ?? 0) * 7 + 3);
    if (!c) { setMsg(t('bots.noClub')); return; }
    const b = nextBot();
    const r = act<string>({ t: 'addBot', name: b.name, club: c.id, nation: c.nation, style: b.style });
    setMsg(r === 'ok' ? t('bots.added', { name: b.name, club: c.name }) : t('bots.noClub'));
  };
  return (
    <div className="col">
      <Panel title={t('bots.managers')} className="flush">
        <table className="grid">
          <thead><tr><th>#</th><th>{t('col.name')}</th><th>{t('col.club')}</th><th className="num">{t('bots.pos')}</th>{!g.draft && <><th className="num">{t('bots.season')}</th><th className="num">{t('bots.career')}</th><th className="num">{t('bots.trophies')}</th><th className="num">{t('bots.board')}</th></>}<th className="num">{t('h2h.vsYou')}</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.pid || 'me'} className={!r.pid || r.pid === g.active ? 'me' : ''}>
                <td>{i + 1}</td>
                <td>{r.name} {r.bot ? <span className="tag" title={t(`bots.style.${r.bot}.hint`)}>AI · {t(`bots.style.${r.bot}`)}</span> : null}</td>
                <td>{r.club ? <><ClubLink id={r.club} /> <span className="muted">{r.league}</span></> : <span className="muted">{t('bots.unemployed')}</span>}</td>
                <td className="num">{r.pos || '–'}</td>
                {!g.draft && <>
                  <td className="num">{r.live}</td>
                  <td className="num"><b>{r.career + r.live}</b></td>
                  <td className="num">{r.trophies}</td>
                  <td className="num">{r.conf}%</td>
                </>}
                <td className="num" title={r.h2h ? t('h2h.goals', { gf: r.h2h.gf, ga: r.h2h.ga }) : undefined}>{r.h2h ? <><b className="good">{r.h2h.w}</b>-{r.h2h.d}-<b className="bad">{r.h2h.l}</b></> : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      {!g.draft && <Panel title={t('bots.addTitle')}>
        <div className="col">
          <div className="muted">{t(session() ? 'bots.addHintOnline' : isMultiplayer(g) ? 'bots.addHint' : 'bots.addHintSolo')}</div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {t('bots.where')}: {(['league', 'nation', 'world'] as const).map((s) => <button key={s} className={`small ${scope === s ? 'primary' : ''}`} onClick={() => setScope(s)}>{t(`bots.scope.${s}`)}</button>)}
            <button className="primary small" disabled={(g.humans?.length ?? 0) >= 12} onClick={add}>+ {t('bots.add')}</button>
          </div>
          {msg && <div className="insight">{msg}</div>}
        </div>
      </Panel>}
    </div>
  );
}
