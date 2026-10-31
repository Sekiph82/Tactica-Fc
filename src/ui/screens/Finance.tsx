import { act } from '../../game/actions';
import { Info } from '../help';
import { currentWageBill, estimateGate, fairTicketPrice, nextBudgetInfo, seasonForecast, sponsorOffers, sponsorSeasonValue } from '../../game/finance';
import { SHIFT_WEEKS, boardMood, type BudgetKind } from '../../game/board';
import { useState } from 'react';
import { dateFmt, money, t } from '../../i18n';
import { Bar, Modal, MoneyInput, Panel, Tabs } from '../components';
import { useGame, useNav, useRouteState } from '../core';
import { AttendanceTab, FacilitiesTab, FinanceHistoryTab } from './Stadium';
import { Head } from './common';

export function Finance() {
  const g = useGame()!;
  const c = g.clubs[g.userClub];
  const bill = currentWageBill(c.id);
  const staffBill = Object.values(g.staff).filter((s) => s.club === c.id).reduce((s, x) => s + x.wage, 0);
  const f = c.finance;
  const income = f.gate + f.tv + f.prize + f.sponsor + f.merch + f.transfersIn;
  const expense = f.wages + f.transfersOut + f.other;
  const [talk, setTalk] = useState(false);
  const { route } = useNav();
  const [tab, setTab] = useRouteState('tab', route.tab ?? 'overview');
  return (
    <div>
      {talk && <BudgetModal onClose={() => setTalk(false)} />}
      <Head title={t('nav.finance')}>
        <Tabs tabs={[['overview', t('fin.tab.overview')], ['stadium', t('fin.tab.stadium')], ['facilities', t('fin.tab.facilities')], ['history', t('fin.tab.history')]]} value={tab} onChange={setTab} />
      </Head>
      {tab === 'stadium' && <AttendanceTab ticketPanel={<TicketPanel />} />}
      {tab === 'facilities' && <FacilitiesTab />}
      {tab === 'history' && <FinanceHistoryTab />}
      {tab === 'overview' && <>
      <div className="cols">
        <Panel title={t('fin.overview')}>
          <div className="kv">
            <span>{t('top.balance')}</span><span className={c.balance < 0 ? 'bad' : 'good'}><b>{money(c.balance)}</b></span>
            <span>{t('top.budget')}</span><span>{money(c.transferBudget)}{(() => { const n = nextBudgetInfo(c); return <div className="muted" style={{ fontSize: 12 }}>{t('budget.next', { date: dateFmt(n.date), amount: money(n.amount) })}</div>; })()}</span>
            <span>{t('fin.wageBudget')}</span><span>{money(c.wageBudget)} / {t('common.week')}</span>
            <span>{t('fin.wageBill')}</span><span><Bar value={bill} max={c.wageBudget} tone={bill > c.wageBudget ? 'bad' : 'good'} /> {money(bill)} + {money(staffBill)} {t('fin.staff')}</span>
            <span>{t('fin.ticket')}</span><span>{money(c.ticketPrice)}</span>
            <span>{t('club.stadium')}</span><span>{c.stadium} ({c.seats.toLocaleString()})</span>
          </div>
        </Panel>
        <Panel title={<>{t('fin.season')}<Info topic="finance" /></>}>
          <div className="kv">
            <span>{t('fin.gate')}</span><span>{money(f.gate)}</span>
            <span>{t('fin.tv')}</span><span>{money(f.tv)}</span>
            <span>{t('fin.prize')}</span><span>{money(f.prize)}</span>
            <span>{t('fin.sponsor')}</span><span>{money(f.sponsor)}</span>
            <span>{t('fin.merch')}</span><span>{money(f.merch)}</span>
            <span>{t('fin.sales')}</span><span>{money(f.transfersIn)}</span>
            <span><b>{t('fin.income')}</b></span><span><b className="good">{money(income)}</b></span>
            <span>{t('fin.wages')}</span><span>{money(f.wages)}</span>
            <span>{t('fin.purchases')}</span><span>{money(f.transfersOut)}</span>
            <span>{t('fin.other')}</span><span>{money(f.other)}</span>
            <span><b>{t('fin.expense')}</b></span><span><b className="bad">{money(expense)}</b></span>
          </div>
        </Panel>
        <Panel title={<>{t('fin.board')}<Info topic="board" /></>}>
          <div className="col">
            <div className="muted">{t('budget.hint')}</div>
            <div className="kv">
              <span>{t('budget.tab.wage')}</span><span className={`mood-${boardMood('wage')}`}>{t(`budget.mood.${boardMood('wage')}`)}</span>
              <span>{t('budget.tab.transfer')}</span><span className={`mood-${boardMood('transfer')}`}>{t(`budget.mood.${boardMood('transfer')}`)}</span>
            </div>
            <button className="primary" onClick={() => setTalk(true)}>{t('budget.open')}</button>
          </div>
        </Panel>
      </div>
      <div className="cols">
        <SponsorPanel />
        <ForecastPanel />
        <FfpPanel />
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => setTab('stadium')}>{t('fin.goStadium')}</button>
        <button onClick={() => setTab('facilities')}>{t('fin.goFacilities')}</button>
        <button onClick={() => setTab('history')}>{t('fin.goHistory')}</button>
      </div>
      </>}
    </div>
  );
}

function TicketPanel() {
  const g = useGame()!;
  const c = g.clubs[g.userClub];
  const fair = fairTicketPrice(c.rep, c.league);
  const now = estimateGate(c, c.ticketPrice);
  const options = [0.6, 0.8, 1, 1.15, 1.3, 1.6].map((f) => Math.max(1, Math.round(fair * f)));
  if (!options.includes(c.ticketPrice)) options.push(c.ticketPrice);
  options.sort((a, b) => a - b);
  const rows = options.map((price) => ({ price, ...estimateGate(c, price) }));
  const best = rows.reduce((a, b) => (b.income > a.income ? b : a));
  return (
    <Panel title={<>{t('ticket.title')}<Info topic="tickets" /></>}>
      <div className="col">
        <label className="row">{t('fin.ticket')}:
          <MoneyInput value={c.ticketPrice} min={1} width={90} onChange={(v) => act({ t: 'ticket', price: v })} />
        </label>
        <div className="kv">
          <span>{t('ticket.fair')}</span><span>{money(fair)}</span>
          <span>{t('ticket.expected')}</span><span>{now.attendance.toLocaleString()} / {c.seats.toLocaleString()} ({Math.round(now.fill * 100)}%)</span>
          <span>{t('ticket.incomeMatch')}</span><span><b>{money(now.income)}</b></span>
          <span>{t('ticket.incomeSeason')}</span><span>{money(now.income * 19)}</span>
        </div>
        <table className="grid">
          <thead><tr><th>{t('fin.ticket')}</th><th className="num">{t('ticket.att')}</th><th className="num">{t('ticket.fill')}</th><th className="num">{t('ticket.incomeMatch')}</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.price} className={`clickable ${r.price === c.ticketPrice ? 'me' : ''}`} onClick={() => act({ t: 'ticket', price: r.price })}>
                <td>{money(r.price)}</td>
                <td className="num">{r.attendance.toLocaleString()}</td>
                <td className="num">{Math.round(r.fill * 100)}%</td>
                <td className="num">{money(r.income)}</td>
                <td>{r === best && <span className="tag good">{t('ticket.best')}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="insight">{t('ticket.help')}</div>
      </div>
    </Panel>
  );
}

function SponsorPanel() {
  const g = useGame()!;
  const c = g.clubs[g.userClub];
  const current = c.sponsor && c.sponsor.season === g.season ? c.sponsor : null;
  const offers = sponsorOffers(c);
  return (
    <Panel title={t('sponsor.title')}>
      {current ? (
        <div className="col">
          <div className="insight good"><b>{t(`sponsor.kind.${current.kind}`)}</b> – {t(`sponsor.desc.${current.kind}`)}</div>
          <div className="kv">
            <span>{t('sponsor.base')}</span><span>{money(current.base)} / {t('sponsor.month')}</span>
            {current.winBonus > 0 && <><span>{t('sponsor.win')}</span><span>{money(current.winBonus)}</span></>}
            {current.trophyBonus > 0 && <><span>{t('sponsor.goal')}</span><span>{money(current.trophyBonus)}</span></>}
          </div>
          <div className="muted">{t('sponsor.lockedHint')}</div>
        </div>
      ) : (
        <div className="col">
          <div className="muted">{t('sponsor.choose')}</div>
          {offers.map((o) => (
            <div key={o.kind} className="choice" onClick={() => act({ t: 'sponsor', kind: o.kind })}>
              <div className="grow">
                <b>{t(`sponsor.kind.${o.kind}`)}</b>
                <div className="muted">{t(`sponsor.desc.${o.kind}`)}</div>
                <div>{money(o.base)} / {t('sponsor.month')}{o.winBonus ? ` · +${money(o.winBonus)} ${t('sponsor.perWin')}` : ''}{o.trophyBonus ? ` · +${money(o.trophyBonus)} ${t('sponsor.ifGoal')}` : ''}</div>
              </div>
              <button className="small primary">{t('sponsor.sign')}</button>
            </div>
          ))}
        </div>
      )}
      <div className="fc-sponsor">
        <div className="fc-sp-head"><span>{t('fc.sponsorSeason')}</span>{[10, 15, 20].map((w) => <span key={w}>{t('fc.wins', { n: w })}</span>)}</div>
        {(current ? [current] : offers).map((o) => (
          <div key={o.kind} className="fc-sp-row">
            <span>{t(`sponsor.kind.${o.kind}`)}{o.trophyBonus ? <em>{t('fc.goalBonus', { fee: money(o.trophyBonus) })}</em> : null}</span>
            {[10, 15, 20].map((w) => <b key={w}>{money(sponsorSeasonValue(o, w).plain)}</b>)}
          </div>
        ))}
      </div>
      {c.merchBoost && c.merchBoost.until >= g.date && <div className="insight good" style={{ marginTop: 8 }}>{t('merch.boost', { pct: Math.round(c.merchBoost.factor * 100), date: dateFmt(c.merchBoost.until) })}</div>}
    </Panel>
  );
}

/** Forventet saldo ved sæsonslut – med det, der allerede er sat i gang */
function ForecastPanel() {
  const g = useGame()!;
  const f = seasonForecast(g.userClub);
  const row = (k: string, v: number, sign = 1) => <><span>{t(k)}</span><span className={v === 0 ? 'muted' : sign > 0 ? 'good' : 'bad'}>{sign > 0 ? '+' : '−'}{money(Math.abs(v))}</span></>;
  return (
    <Panel title={t('fc.title', { date: `30/6 ${g.season + 1}` })}>
      <div className="kv fc-kv">
        <span>{t('fc.now')}</span><span>{money(f.now)}</span>
        {row('fc.fixed', f.fixed, f.fixed >= 0 ? 1 : -1)}
        {row('fc.gate', f.gate)}
        {row('fc.wages', f.wages, -1)}
        {f.bids > 0 && row('fc.bids', f.bids, -1)}
        {f.camp > 0 && row('fc.camp', f.camp, -1)}
        <span><b>{t('fc.end')}</b></span><span><b className={f.balance >= 0 ? 'good' : 'bad'}>{money(f.balance)}</b></span>
      </div>
      <p className="muted" style={{ marginBottom: 0, fontSize: 12.5 }}>{t('fc.hint', { months: f.months, games: f.homeLeft })}</p>
    </Panel>
  );
}

function FfpPanel() {
  const g = useGame()!;
  const c = g.clubs[g.userClub];
  const f = c.finance;
  const income = f.gate + f.tv + f.prize + f.sponsor + f.merch + f.transfersIn;
  const expense = f.wages + f.transfersOut + f.other;
  const results = c.ffp?.results ?? [];
  return (
    <Panel title={t('ffp.title')}>
      <div className="col">
        <div className="kv">
          <span>{t('ffp.thisSeason')}</span><span className={income - expense >= 0 ? 'good' : 'bad'}>{money(income - expense)}</span>
          {results.map((r, i) => [<span key={`l${i}`}>{t('ffp.season', { n: results.length - i })}</span>, <span key={`v${i}`} className={r >= 0 ? 'good' : 'bad'}>{money(r)}</span>])}
          <span>{t('ffp.status')}</span><span>{c.ffp?.sanction ? <span className="tag bad">{t('ffp.restricted')}</span> : <span className="tag good">{t('ffp.ok')}</span>}</span>
        </div>
        <div className="muted">{t('ffp.explain')}</div>
      </div>
    </Panel>
  );
}

/** Forhandling med bestyrelsen om løn- og transferbudget, samt omfordeling mellem dem */
function BudgetModal({ onClose }: { onClose: () => void }) {
  const g = useGame()!;
  const c = g.clubs[g.userClub];
  const [tab, setTab] = useState<BudgetKind | 'shift'>('wage');
  const [pct, setPct] = useState(10);
  const [res, setRes] = useState<{ result: string; pct?: number; reasons?: string[] } | null>(null);
  const [toWage, setToWage] = useState(true);
  const [amount, setAmount] = useState(0);
  const [shifted, setShifted] = useState<string | null>(null);
  const kind = tab === 'shift' ? 'wage' : tab;
  const base = kind === 'wage' ? c.wageBudget : c.transferBudget;
  const maxPct = kind === 'wage' ? 30 : 80;
  const ask = () => setRes(act({ t: 'budget', kind, pct: pct / 100 }));
  const counter = g.board.budgetCounter;
  const shiftMax = toWage ? c.transferBudget : c.wageBudget;
  const shiftStep = toWage ? 50_000 : 100;
  const after = toWage ? { tr: c.transferBudget - amount, wg: c.wageBudget + Math.round(amount / SHIFT_WEEKS) } : { tr: c.transferBudget + amount * SHIFT_WEEKS, wg: c.wageBudget - amount };
  return (
    <Modal title={t('budget.title')} onClose={onClose}>
      <div className="col">
        <Tabs tabs={[['wage', t('budget.tab.wage')], ['transfer', t('budget.tab.transfer')], ['shift', t('budget.tab.shift')]]} value={tab} onChange={(v) => { if (v === tab) return; setTab(v as BudgetKind | 'shift'); setRes(null); setAmount(0); setShifted(null); }} />
        {tab !== 'shift' ? (
          <>
            <div className="kv">
              <span>{t('budget.current')}</span><span>{money(base)}{kind === 'wage' ? ` / ${t('common.week')}` : ''}</span>
              <span>{t('budget.mood')}</span><span className={`mood-${boardMood(kind)}`}>{t(`budget.mood.${boardMood(kind)}`)}</span>
            </div>
            <label>{t('budget.ask', { pct })}: <b className="accent">{money(Math.round(base * (1 + pct / 100)))}{kind === 'wage' ? ` / ${t('common.week')}` : ''}</b>
              <input type="range" min={1} max={maxPct} value={pct} onChange={(e) => { setPct(Number(e.target.value)); setRes(null); }} style={{ width: '100%' }} />
            </label>
            {!res && <button className="primary" onClick={ask}>{t('budget.send')}</button>}
            {res?.result === 'tooSoon' && <div className="insight bad">{t('budget.tooSoon')}</div>}
            {res?.result === 'ok' && <div className="insight good">{t('budget.ok', { pct: Math.round((res.pct ?? 0) * 100) })}</div>}
            {res?.result === 'no' && <div className="insight bad">{t('budget.no')}</div>}
            {res?.result === 'counter' && counter && (
              <div className="insight warn">
                {t('budget.counter', { pct: Math.round(counter.pct * 100), amount: money(Math.round(base * (1 + counter.pct))) })}
                <div className="row" style={{ marginTop: 8 }}>
                  <button className="primary" onClick={() => { act({ t: 'budgetCounter', accept: true }); setRes({ result: 'ok', pct: counter.pct, reasons: res.reasons }); }}>{t('budget.accept')}</button>
                  <button onClick={() => { act({ t: 'budgetCounter', accept: false }); setRes({ result: 'declined', reasons: res.reasons }); }}>{t('budget.decline')}</button>
                </div>
              </div>
            )}
            {res?.result === 'declined' && <div className="insight">{t('budget.declined')}</div>}
            {res?.reasons && res.reasons.length > 0 && (
              <ul className="muted" style={{ margin: 0, paddingLeft: 18 }}>{res.reasons.map((r) => <li key={r}>{t(r)}</li>)}</ul>
            )}
          </>
        ) : (
          <>
            <div className="muted">{t('budget.shiftHint', { weeks: SHIFT_WEEKS })}</div>
            <div className="row">
              <button className={toWage ? 'primary' : ''} onClick={() => { setToWage(true); setAmount(0); }}>{t('budget.toWage')}</button>
              <button className={!toWage ? 'primary' : ''} onClick={() => { setToWage(false); setAmount(0); }}>{t('budget.toTransfer')}</button>
            </div>
            <label>{toWage ? t('budget.moveTransfer') : t('budget.moveWage')}: <b className="accent">{money(amount)}{toWage ? '' : ` / ${t('common.week')}`}</b>
              <input type="range" min={0} max={Math.max(0, Math.floor(shiftMax / shiftStep) * shiftStep)} step={shiftStep} value={amount} onChange={(e) => { setAmount(Number(e.target.value)); setShifted(null); }} style={{ width: '100%' }} />
            </label>
            <div className="row">
              {[10, 25, 50].map((q) => <button key={q} className="small" onClick={() => { setAmount(Math.floor((shiftMax * q) / 100 / shiftStep) * shiftStep); setShifted(null); }}>{q} %</button>)}
            </div>
            <div className="kv">
              <span>{t('budget.tab.transfer')}</span><span>{money(c.transferBudget)} → <b>{money(after.tr)}</b></span>
              <span>{t('budget.tab.wage')}</span><span>{money(c.wageBudget)} → <b>{money(after.wg)}</b> / {t('common.week')}</span>
            </div>
            <button className="primary" disabled={amount <= 0} onClick={() => {
              act({ t: 'budgetShift', toWage, amount });
              setShifted(t('budget.shifted', { tr: money(after.tr), wg: money(after.wg) }));
              setAmount(0);
            }}>{amount > 0 ? t('budget.doShiftAmount', { amount: money(amount) }) : t('budget.pickAmount')}</button>
            {shifted && <div className="insight good">{shifted}</div>}
          </>
        )}
      </div>
    </Modal>
  );
}
