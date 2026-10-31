// Første arbejdsdag: tre korte opgaver øverst i indbakken – og til sidst et konkret oplæg fra assistenten.
import { useState } from 'react';
import { act } from '../game/actions';
import { NEED_GROUPS, STYLES, squadNeeds, styleFit, type StyleKey } from '../game/onboarding';
import { money, t } from '../i18n';
import { askingPrice } from '../game/transfers';
import { Panel, PlayerLink } from './components';
import { useGame } from './core';

export function FirstDay() {
  const g = useGame()!;
  const ob = g.manager.onboard;
  const needs = squadNeeds(g.userClub);
  const [picked, setPicked] = useState<string[]>(() => ob?.needs ?? needs.slice(0, 2).map((n) => n.key));
  if (!ob) return null;
  const c = g.clubs[g.userClub];
  if (ob.briefed && ob.plan) return <Briefing />;
  if (ob.briefed) return null;
  const done = [!!ob.weak, !!ob.style, !!ob.needs];
  const weak = needs[0];
  return (
    <Panel title={t('onb.title')} right={<button className="small" onClick={() => act({ t: 'onboard', step: 'skip' })}>{t('onb.skip')}</button>} className="onb">
      <p className="muted" style={{ marginTop: 0 }}>{t('onb.intro', { club: c.name })}</p>
      <div className="onb-steps">
        <div className={`onb-step ${done[0] ? 'done' : ''}`}>
          <b>{done[0] ? '✓' : '1'} {t('onb.weak')}</b>
          <span>{t('onb.weakText', { pos: t(`onb.need.${weak.key}`), score: weak.score, gap: Math.abs(weak.gap) })}</span>
          <span className="muted">{weak.players.length ? weak.players.map((id) => <PlayerLink key={id} p={g.players[id]} short />).reduce((a: React.ReactNode[], x, i) => (i ? [...a, ', ', x] : [x]), []) : t('onb.nobody')} · {t('onb.depth', { n: weak.depth })}</span>
          {!done[0] && <button className="small primary" onClick={() => act({ t: 'onboard', step: 'weak' })}>{t('onb.seen')}</button>}
        </div>
        <div className={`onb-step ${done[1] ? 'done' : ''}`}>
          <b>{done[1] ? '✓' : '2'} {t('onb.style')}</b>
          <div className="onb-styles">
            {(Object.keys(STYLES) as StyleKey[]).map((k) => (
              <button key={k} className={`small ${ob.style === k ? 'primary' : ''}`} onClick={() => act({ t: 'onboard', step: 'style', style: k })} title={t(`onb.style.${k}.desc`)}>
                {t(`onb.style.${k}`)} <span className="muted">· {STYLES[k].formation} · {t('onb.fit', { n: styleFit(g.userClub, k) })}</span>
              </button>
            ))}
          </div>
          <span className="muted">{ob.style ? t(`onb.style.${ob.style}.desc`) : t('onb.styleHint')}</span>
        </div>
        <div className={`onb-step ${done[2] ? 'done' : ''}`}>
          <b>{done[2] ? '✓' : '3'} {t('onb.needs')}</b>
          <div className="onb-styles">
            {NEED_GROUPS.map((n) => (
              <label key={n.key} className={`choice ${picked.includes(n.key) ? 'on' : ''}`}>
                <input type="checkbox" checked={picked.includes(n.key)} onChange={() => setPicked(picked.includes(n.key) ? picked.filter((x) => x !== n.key) : [...picked, n.key].slice(-4))} />
                {t(`onb.need.${n.key}`)}
              </label>
            ))}
          </div>
          <span className="muted">{t('onb.budget', { fee: money(c.transferBudget) })}</span>
          <button className="small primary" disabled={!picked.length} onClick={() => act({ t: 'onboard', step: 'needs', needs: picked })}>{t('onb.saveNeeds')}</button>
        </div>
      </div>
      {done.every(Boolean) && <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><button className="primary" onClick={() => act({ t: 'onboard', step: 'brief' })}>{t('onb.getBrief')}</button></div>}
    </Panel>
  );
}

/** Assistentens oplæg – kan lukkes, når man har læst det */
function Briefing() {
  const g = useGame()!;
  const [open, setOpen] = useState(true);
  const plan = g.manager.onboard!.plan!;
  const asst = Object.values(g.staff).find((s) => s.club === g.userClub && s.role === 'assistant');
  if (!open) return null;
  return (
    <Panel title={t('onb.briefTitle', { name: asst ? `${asst.first} ${asst.last}` : t('onb.assistant') })} right={<button className="small" onClick={() => setOpen(false)}>{t('common.close')}</button>} className="onb">
      <ol className="onb-brief">
        <li>{t('onb.b.weak', { pos: t(`onb.need.${plan.weakest}`) })}</li>
        <li>{t('onb.b.style', { style: t(`onb.style.${plan.style}`), fit: plan.fit })}{plan.bestStyle !== plan.style ? ` ${t('onb.b.alt', { style: t(`onb.style.${plan.bestStyle}`) })}` : ` ${t('onb.b.good')}`}</li>
        {Object.entries(plan.targets).map(([k, ids]) => (
          <li key={k}>{t('onb.b.need', { pos: t(`onb.need.${k}`) })} {ids.length ? ids.map((id) => <span key={id}><PlayerLink p={g.players[id]} /> ({g.players[id]?.club ? money(askingPrice(g.players[id])) : t('common.free')}) </span>) : t('onb.b.noTargets')}</li>
        ))}
      </ol>
      <p className="muted" style={{ marginBottom: 0 }}>{t('onb.b.end')}</p>
    </Panel>
  );
}
