import { useState } from 'react';
import { askConfirm } from '../confirm';
import { act } from '../../game/actions';
import { jobTerms, managerRegion } from '../../game/board';
import { regionOf } from '../../game/leagues';
import { dateFmt, money, t } from '../../i18n';
import { ClubLink, Panel } from '../components';
import { useGame, useNav, useRouteState } from '../core';
import { Head } from './common';

export function Jobs() {
  const g = useGame()!;
  const [scope, setScope] = useRouteState<'region' | 'world'>('scope', 'region');
  const region = managerRegion();
  const vac = g.vacancies.map((id) => g.clubs[id]).filter((c) => c && c.manager === 0)
    .filter((c) => scope === 'world' || regionOf(g.nations[c.nation]?.name) === region)
    .sort((a, b) => b.rep - a.rep);
  const pending = Object.entries(g.manager.jobTalks ?? {}).filter(([, tk]) => tk.stage === 'applied').map(([id, tk]) => [Number(id), tk] as const);
  return (
    <div>
      <Head title={t('nav.jobs')}>
        {g.userClub > 0 && <button className="small danger" onClick={async () => { if (await askConfirm(t('jobs.resignConfirm', { club: g.clubs[g.userClub]?.name ?? '' }))) act({ t: 'resign' }); }}>{t('jobs.resign')}</button>}
      </Head>
      <div className="cols2">
        <Panel title={t('jobs.offers')}>
          <div className="col">
            {g.jobOffers.length === 0 && pending.length === 0 && <div className="muted">{t('common.none')}</div>}
            {g.jobOffers.map((id) => <JobOffer key={id} cid={id} />)}
            {pending.map(([id, tk]) => (
              <div key={id} className="row"><ClubLink id={id} long /><span className="muted">{t('jobs.awaiting', { date: dateFmt(tk.answerOn ?? g.date) })}</span></div>
            ))}
          </div>
        </Panel>
        <Panel title={t('jobs.vacancies')} className="flush" right={
          <select value={scope} onChange={(e) => setScope(e.target.value as 'region')}>
            <option value="region">{t('jobs.myRegion', { region: t(`region.${region}`) })}</option>
            <option value="world">{t('jobs.world')}</option>
          </select>
        }>
          <table className="grid">
            <tbody>
              {vac.length === 0 && <tr><td className="muted">{t('common.none')}</td></tr>}
              {vac.map((c) => (
                <tr key={c.id}>
                  <td><ClubLink id={c.id} long /></td>
                  <td>{g.leagues[c.league]?.name}</td>
                  <td className="num">{c.rep}</td>
                  <td>{g.jobOffers.includes(c.id) ? <span className="tag good">{t('jobs.offered')}</span>
                    : g.manager.jobTalks?.[c.id] ? <span className="tag">{t('jobs.applied')}</span>
                    : <button className="small" onClick={() => act({ t: 'applyJob', club: c.id })}>{t('jobs.apply')}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
      <p className="muted">{t('jobs.explain', { rep: Math.round(g.manager.rep) })}</p>
    </div>
  );
}

/** Et jobtilbud med klubbens vilkår – man kan forhandle én gang om budget og forventninger */
function JobOffer({ cid }: { cid: number }) {
  const { nav } = useNav();
  const g = useGame()!;
  const [msg, setMsg] = useState<{ text: string; tone: string } | null>(null);
  const c = g.clubs[cid];
  if (!c) return null;
  const terms = jobTerms(cid);
  const ask = (what: 'budget' | 'exp') => {
    const r = act<string>({ t: 'negotiateJob', club: cid, ask: what });
    setMsg({ text: t(`jobs.neg.${what}.${r}`, { club: c.name }), tone: r === 'yes' ? 'good' : r === 'withdrawn' ? 'bad' : 'warn' });
  };
  const me = g.clubs[g.userClub];
  return (
    <div className="insight">
      <div className="row"><b className="grow"><ClubLink id={cid} long /></b><span className="muted">{g.leagues[c.league]?.name}</span></div>
      <div className="kv" style={{ margin: '8px 0' }}>
        <span>{t('club.expectation')}</span><span>{t(`exp.${terms.exp}`)} ({t('jobs.pos', { pos: terms.expectedPos })})</span>
        <span>{t('top.budget')}</span><span>{money(terms.budget)}</span>
        <span>{t('jobs.wageBudget')}</span><span>{money(terms.wageBudget)} / {t('common.week')}</span>
        <span>{t('top.balance')}</span><span className={c.balance < 0 ? 'bad' : ''}>{money(c.balance)}</span>
        <span>{t('jobs.rep')}</span><span>{c.rep}</span>
      </div>
      <div className="row">
        <button className="small" disabled={terms.asked.includes('budget')} onClick={() => ask('budget')}>{t('jobs.askBudget')}</button>
        <button className="small" disabled={terms.asked.includes('exp') || terms.exp === 'survive'} onClick={() => ask('exp')}>{t('jobs.askExp')}</button>
      </div>
      {msg && <div className={`insight ${msg.tone}`} style={{ marginTop: 8 }}>{msg.text}</div>}
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
        <button className="small" onClick={() => act({ t: 'declineJob', club: cid })}>{t('jobs.decline')}</button>
        <button className="small primary" onClick={async () => { if (!me || await askConfirm(t('jobs.acceptConfirm', { club: c.name }))) { act({ t: 'acceptJob', club: cid }); nav({ name: 'inbox' }); } }}>{t('jobs.accept')}</button>
      </div>
    </div>
  );
}
