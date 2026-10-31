import { gs } from '../../game/state';
import { useState } from 'react';
import { MAX_FRIENDLIES, friendlyDates, friendlyGate, friendlyOpponents, type FriendlyKind } from '../../game/friendlies';
import { act } from '../../game/actions';
import type { Fixture } from '../../game/types';
import { dateFmt, money, t } from '../../i18n';
import { ClubLink, Crest, Panel } from '../components';
import { useGame, useNav } from '../core';
import { Head } from './common';

export function stageLabel(f: Fixture): string {
  if (!f.stage) return `${t('fix.round')} ${f.round}`;
  if (f.stage.startsWith('G')) return `${t('fix.group')} ${f.stage.slice(1)}`;
  if (f.stage === 'champ' || f.stage === 'releg') return t(`fix.${f.stage}`);
  return t(`stage.${f.stage}`) + (f.leg === 2 ? ` (${t('fix.leg2')})` : f.tieId && gs().comps[f.comp]?.ties.find((x) => x.id === f.tieId)?.legs === 2 ? ` (${t('fix.leg1')})` : '');
}

export function resultStr(f: Fixture) {
  if (!f.result) return '-';
  const r = f.result;
  let s = `${r.hg} - ${r.ag}`;
  if (r.pens) s += ` (${r.pens[0]}-${r.pens[1]} ${t('fix.pens')})`;
  else if (r.et) s += ` ${t('fix.aet')}`;
  return s;
}

export function Fixtures() {
  const g = useGame()!;
  const { nav } = useNav();
  const list = Object.values(g.fixtures).filter((f) => f.home === g.userClub || f.away === g.userClub).sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div>
      <Head title={t('nav.fixtures')} />
      {!g.draft && <FriendliesPanel />}
      <Panel className="flush">
        <table className="grid">
          <thead><tr><th>{t('col.date')}</th><th>{t('col.comp')}</th><th>{t('fix.stage')}</th><th>{t('fix.venue')}</th><th>{t('fix.opponent')}</th><th className="center">{t('fix.result')}</th><th></th></tr></thead>
          <tbody>
            {list.map((f) => {
              const home = f.home === g.userClub;
              const opp = home ? f.away : f.home;
              const r = f.result;
              const my = r ? (home ? r.hg : r.ag) : 0, their = r ? (home ? r.ag : r.hg) : 0;
              const cls = !r ? '' : my > their || (r.pens && (home ? r.pens[0] > r.pens[1] : r.pens[1] > r.pens[0])) ? 'good' : my === their ? '' : 'bad';
              return (
                <tr key={f.id} className={g.reports[f.id] ? 'clickable' : ''} onClick={() => g.reports[f.id] && nav({ name: 'report', id: f.id })}>
                  <td>{g.draft ? t('dr.roundN', { n: f.round }) : dateFmt(f.date)}</td>
                  <td>{g.comps[f.comp]?.name}</td>
                  <td className="muted">{stageLabel(f)}</td>
                  <td>{f.stage === 'F' ? t('fix.neutral') : home ? t('fix.home') : t('fix.away')}</td>
                  <td><ClubLink id={opp} /></td>
                  <td className={`center ${cls}`}><b>{r ? `${home ? r.hg : r.ag} - ${home ? r.ag : r.hg}` : '-'}</b>{r?.pens ? ` (${t('fix.pens')})` : r?.et ? ` ${t('fix.aet')}` : ''}</td>
                  <td>{g.reports[f.id] && <span className="muted">{t('fix.report')} ›</span>}{f.id === g.pendingFixture && <button className="small primary" onClick={() => nav({ name: 'match', id: f.id })}>{t('top.toTheMatch')}</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

/** Venskabskampe: vælg dato og en nem modstander eller en storklub */
function FriendliesPanel() {
  const g = useGame()!;
  const [kind, setKind] = useState<FriendlyKind>('easy');
  const [date, setDate] = useState('');
  const [opps, setOpps] = useState<number[]>([]);
  const [picked, setPicked] = useState(false);
  const [msg, setMsg] = useState('');
  const dates = friendlyDates();
  const list = (g.manager.friendlies ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = list.filter((x) => !x.done), played = list.filter((x) => x.done).slice(-3).reverse();
  const pick = (k: FriendlyKind) => { setKind(k); setPicked(true); setOpps(friendlyOpponents(k).map((c) => c.id)); };
  if (!g.userClub) return null;
  return (
    <Panel title={t('fr.title')}>
      <p className="muted" style={{ marginTop: 0 }}>{t('fr.intro')}</p>
      {upcoming.map((fr) => (
        <div key={fr.date} className="row fr-row">
          <b>{dateFmt(fr.date)}</b><span>{t('fr.vs')} <ClubLink id={fr.opp} /></span><span className={`tag ${fr.kind === 'big' ? 'warn' : 'good'}`}>{t(`fr.kind.${fr.kind}`)}</span>
          <button className="small" onClick={() => act({ t: 'friendlyCancel', date: fr.date })}>{t('fr.cancel')}</button>
        </div>
      ))}
      {played.map((fr) => <div key={fr.date} className="row fr-row muted"><span>{dateFmt(fr.date)}</span><span>{t('fr.vs')} {g.clubs[fr.opp]?.name}</span><b>{fr.result?.join('-')}</b></div>)}
      {upcoming.length < MAX_FRIENDLIES && (dates.length === 0 ? <div className="insight warn">{t('fr.noDates')}</div> : (
        <div className="col" style={{ marginTop: 8, gap: 8 }}>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div className="seg">
              <button className={kind === 'easy' && opps.length ? 'on' : ''} onClick={() => pick('easy')}>{t('fr.kind.easy')}</button>
              <button className={kind === 'big' && opps.length ? 'on' : ''} onClick={() => pick('big')}>{t('fr.kind.big')}</button>
            </div>
            <select value={date} onChange={(e) => setDate(e.target.value)}>
              <option value="">{t('fr.pickDate')}</option>
              {dates.map((d) => <option key={d} value={d}>{dateFmt(d)}</option>)}
            </select>
          </div>
          {opps.length > 0 && <div className="muted" style={{ fontSize: 12.5 }}>{t(`fr.kind.${kind}.desc`)}</div>}
          {picked && opps.length === 0 && <div className="insight warn">{t('fr.noOpps')}</div>}
          <div className="fr-opps">
            {opps.map((id) => {
              const c = g.clubs[id];
              return (
                <button key={id} className="fr-opp" disabled={!date} onClick={() => { const r = act<string>({ t: 'friendly', opp: id, date, kind }); setMsg(r === 'ok' ? '' : t(`fr.err.${r}`)); setOpps([]); setDate(''); }}>
                  <Crest id={id} size={26} /><b>{c.name}</b><span className="muted">{t('fr.gate', { fee: money(friendlyGate(c)) })}</span>
                </button>
              );
            })}
          </div>
          {opps.length > 0 && !date && <div className="muted" style={{ fontSize: 12 }}>{t('fr.pickDateFirst')}</div>}
        </div>
      ))}
      {msg && <div className="insight bad">{msg}</div>}
    </Panel>
  );
}
