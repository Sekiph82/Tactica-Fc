import { useEffect, useState } from 'react';
import { askConfirm } from '../confirm';
import { aiCall } from '../../ai/client';
import { agentOf } from '../../game/agents';
import { gs } from '../../game/state';
import { act } from '../../game/actions';
import { clausesWorthFor, preferredYears, renewalDemand, wageDemand } from '../../game/transfers';
import { clauseCost } from '../../game/clauses';
import { SHIFT_WEEKS } from '../../game/board';
import type { ContractClauses, TransferOffer } from '../../game/types';
import { MoneyInput, AiSpinner } from '../components';
import { money, t } from '../../i18n';
import { Modal } from '../components';


/** Kontraktforhandling – både nye spillere (via tilbud) og forlængelser */
export function NegotiationModal({ offer, renewPid, onClose }: { offer?: TransferOffer; renewPid?: number; onClose: () => void }) {
  const g = gs();
  const pid = offer?.player ?? renewPid!;
  const p = g.players[pid];
  const club = g.clubs[g.userClub];
  const demand = offer?.demand?.wage ?? (offer ? wageDemand(p, club) : renewalDemand(p, club));
  const [wage, setWage] = useState(Math.round(demand / 50) * 50);
  const [years, setYears] = useState(offer?.demand?.years ?? preferredYears(p));
  const [msg, setMsg] = useState<{ text: string; tone: string; budget?: boolean } | null>(null);
  const [cl, setCl] = useState<ContractClauses>({});
  const worth = clausesWorthFor(p, club.id, wage, years, cl);
  const rank = 1 + Object.values(g.players).filter((x) => x.club === club.id && x.id !== p.id && x.ca > p.ca + 1).length;
  const cost = clauseCost(p, wage, years, cl, rank);
  const bill = Object.values(g.players).filter((x) => x.club === club.id).reduce((s, x) => s + (x.contract?.wage ?? 0), 0);
  // spilleragenten: fast persona pr. spiller, replikker skrevet af AI (tallene kommer fra spillet)
  const { name: agentName, style: persona } = agentOf(p);
  const [agentLine, setAgentLine] = useState<string | null>(null);
  const [agentTyping, setAgentTyping] = useState(false);
  const otherClubs = [...new Set([
    ...g.offers.filter((o) => o.player === pid && o.buyer !== g.userClub && ['pending', 'negotiating', 'countered'].includes(o.status)).map((o) => o.buyer),
    ...(g.pursuits ?? []).filter((x) => x.player === pid && x.club !== g.userClub).map((x) => x.club),
    ...(offer?.rival ? [offer.rival.club] : []),
  ])].map((c) => g.clubs[c]?.name).filter(Boolean);
  const speak = (outcome: string, offered?: { wage: number; years: number }) => {
    const demandW = money(offer?.demand?.wage ?? (offer ? wageDemand(p, club) : renewalDemand(p, club)));
    const demandY = offer?.demand?.years ?? preferredYears(p);
    const situation = {
      opening: `Forhandlingen begynder. Du fremlægger din klients krav: ${demandW} om ugen i ${demandY} år.`,
      counter: `Manageren tilbød ${money(offered?.wage ?? 0)} om ugen i ${offered?.years} år. Det er for lidt – du afviser og står fast på ${demandW} i ${demandY} år.`,
      accepted: `Manageren tilbød ${money(offered?.wage ?? 0)} om ugen i ${offered?.years} år, og din klient accepterer. I er enige.`,
      refused: 'Forhandlingerne er brudt sammen – din klient vil ikke skrive under.',
      budget: 'Klubben har ikke plads i lønbudgettet til tilbuddet. Du reagerer på det.',
      pending: `Manageren tilbød ${money(offered?.wage ?? 0)} om ugen i ${offered?.years} år. Din klient kan lide tilbuddet, men der er andre klubber med i billedet – han giver svar i morgen.`,
    }[outcome] ?? outcome;
    setAgentTyping(true);
    aiCall<{ line: string }>('agent', {
      persona, youAre: `${agentName}, agent for ${p.first} ${p.last}`, talkingTo: `manageren for ${club.name}`,
      contract: offer ? 'ny spiller til klubben' : 'kontraktforlængelse', situation, otherInterestedClubs: otherClubs,
    }).then((r) => { setAgentTyping(false); if (r?.line) setAgentLine(r.line); });
  };
  useEffect(() => { speak('opening'); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    const res = offer ? act<string>({ t: 'negotiate', pid, wage, years, clauses: cl }) : act<string>({ t: 'renew', pid, wage, years, clauses: cl });
    // spillets eget svar vises med det samme; agentens AI-replik erstatter det, når den kommer
    setAgentLine(null);
    speak(res, { wage, years });
    if (res === 'accepted') { setMsg({ text: t('neg.accepted'), tone: 'good' }); setTimeout(onClose, 2200); }
    else if (res === 'pending') { setMsg({ text: t('neg.pendingMp'), tone: 'warn' }); setTimeout(onClose, 3200); }
    else if (res === 'counter') {
      const d = offer?.demand?.wage ?? (offer ? wageDemand(p, club) : renewalDemand(p, club));
      setWage(Math.round(d / 50) * 50);
      setYears(offer?.demand?.years ?? preferredYears(p));
      setMsg({ text: t('neg.counter', { wage: money(d), years: offer?.demand?.years ?? preferredYears(p) }), tone: 'warn' });
    } else if (res === 'budget') setMsg({ text: t('neg.overWageBudget', { budget: money(club.wageBudget), bill: money(bill) }), tone: 'bad', budget: true });
    else { setMsg({ text: t('neg.refused'), tone: 'bad' }); setTimeout(onClose, 2600); }
  };

  return (
    <Modal title={t('neg.title', { player: `${p.first} ${p.last}` })} onClose={onClose}>
      <div className="col">
        <div className="kv">
          <span>{t('neg.currentWage')}</span><span>{money(p.contract?.wage ?? 0)} / {t('common.week')}</span>
          <span>{t('neg.agentHint')}</span><span>≈ {money(demand)} / {t('common.week')}, {preferredYears(p)} {t('common.years')}</span>
          <span>{t('neg.wageBill')}</span><span>{money(bill)} / {money(club.wageBudget)}</span>
          {offer && !offer.preContract && offer.fee > 0 && <><span>{t('neg.fee')}</span><span>{money(offer.fee)}</span></>}
          {offer?.preContract && <><span>{t('neg.type')}</span><span>{t('neg.bosman')}</span></>}
        </div>
        <label>{t('neg.wage')}: <b className="accent">{money(wage)}</b> / {t('common.week')}
          <input type="range" min={Math.round(demand * 0.5)} max={Math.round(demand * 1.6)} step={50} value={wage} onChange={(e) => setWage(Number(e.target.value))} style={{ width: '100%' }} />
        </label>
        <label>{t('neg.years')}:
          <select value={years} onChange={(e) => setYears(Number(e.target.value))} style={{ marginLeft: 8 }}>
            {[1, 2, 3, 4, 5].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <Clauses p={p} c={cl} onChange={setCl} />
        {(worth !== 0 || cost > 0) && (
          <div className="kv">
            <span>{t('clause.worth')}</span><span className={worth >= 0 ? 'good' : 'bad'}>{worth >= 0 ? '+' : '−'}{money(Math.abs(worth))} / {t('common.week')}</span>
            {cost > 0 && <><span>{t('clause.cost')}</span><span>≈ {money(cost)} / {t('common.week')}</span></>}
            <span>{t('clause.total')}</span><span><b className={wage + worth >= demand * 0.97 ? 'good' : 'warn'}>{money(wage + worth)}</b> / {money(demand)}</span>
          </div>
        )}
        <div className="chat">
          <div className={`chat-them insight ${msg?.tone ?? ''}`}><b title={t(`agent.${persona}.hint`)}>{agentName} ({t(`agent.${persona}`)}):</b> {agentLine ?? msg?.text ?? t('neg.agentOpening', { wage: money(demand), years: offer?.demand?.years ?? preferredYears(p) })}</div>
          {agentTyping && <AiSpinner text={t('ai.agentTyping', { name: agentName })} />}
          {msg && agentLine && <div className="muted" style={{ fontSize: 12 }}>{msg.text}</div>}
        </div>
        {msg?.budget && (() => {
          // manglende ugeløn → flyt fra transferbudgettet (samme kurs som på økonomisiden)
          const prevWage = offer ? 0 : p.contract?.wage ?? 0;
          const missing = Math.max(0, bill - prevWage + wage - club.wageBudget);
          const cost = Math.ceil(missing * SHIFT_WEEKS / 10_000) * 10_000;
          return missing > 0 && cost <= club.transferBudget ? (
            <div className="insight warn row">
              <span className="grow">{t('neg.shiftHint', { cost: money(cost), wage: money(missing) })}</span>
              <button className="small primary" onClick={() => { act({ t: 'budgetShift', toWage: true, amount: cost }); setMsg(null); submit(); }}>{t('neg.shiftAndOffer')}</button>
            </div>
          ) : <div className="muted" style={{ fontSize: 12 }}>{t('neg.shiftImpossible')}</div>;
        })()}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {offer && <button className="danger" onClick={async () => { if (await askConfirm(t('neg.cancelConfirm'))) { act({ t: 'withdraw', pid }); onClose(); } }}>{t('neg.cancel')}</button>}
          <div className="grow" />
          <button onClick={onClose}>{t('common.close')}</button>
          <button className="primary" onClick={submit}>{t('neg.offer')}</button>
        </div>
      </div>
    </Modal>
  );
}

const RISES = [0, 5, 10, 15];
const CUTS = [0, 10, 25, 50];
const PROMOS = [0, 10, 25, 50];

/** Klausuler i en kontrakt: frikøbsklausul, lønstigning, bonusser og lønnedgang ved nedrykning */
function Clauses({ p, c, onChange }: { p: { value: number; contract: { wage: number } | null }; c: ContractClauses; onChange: (c: ContractClauses) => void }) {
  const [open, setOpen] = useState(false);
  const set = (k: keyof ContractClauses, v: number | undefined) => onChange({ ...c, [k]: v || undefined });
  const n = Object.values(c).filter(Boolean).length;
  if (!open) return <button className="small" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>+ {t('clause.add')}{n ? ` (${n})` : ''}</button>;
  const relDefault = Math.round((p.value * 2.5) / 100_000) * 100_000;
  return (
    <div className="clauses">
      <div className="muted" style={{ fontSize: 12 }}>{t('clause.intro')}</div>
      <label className="row"><input type="checkbox" checked={!!c.release} onChange={(e) => set('release', e.target.checked ? relDefault : undefined)} /> {t('clause.release')}</label>
      {c.release ? <div className="row" style={{ paddingLeft: 24 }}><MoneyInput value={c.release} onChange={(v) => set('release', v)} width={140} /><span className="muted">{t('clause.releaseHint')}</span></div> : null}
      <div className="row">{t('clause.wageRise')}: {RISES.map((v) => <button key={v} className={`small ${(c.wageRise ?? 0) === v ? 'primary' : ''}`} onClick={() => set('wageRise', v)}>{v ? `+${v}%` : t('common.none')}</button>)}</div>
      <div className="row">{t('clause.appBonus')}: <MoneyInput value={c.appBonus ?? 0} onChange={(v) => set('appBonus', v)} width={110} /></div>
      <div className="row">{t('clause.goalBonus')}: <MoneyInput value={c.goalBonus ?? 0} onChange={(v) => set('goalBonus', v)} width={110} /></div>
      <div className="row">{t('clause.relegationCut')}: {CUTS.map((v) => <button key={v} className={`small ${(c.relegationCut ?? 0) === v ? 'primary' : ''}`} onClick={() => set('relegationCut', v)}>{v ? `−${v}%` : t('common.none')}</button>)}</div>
      <div className="row">{t('clause.promotionRise')}: {PROMOS.map((v) => <button key={v} className={`small ${(c.promotionRise ?? 0) === v ? 'primary' : ''}`} onClick={() => set('promotionRise', v)}>{v ? `+${v}%` : t('common.none')}</button>)}</div>
      <div className="row">{t('clause.cleanSheetBonus')}: <MoneyInput value={c.cleanSheetBonus ?? 0} onChange={(v) => set('cleanSheetBonus', v)} width={110} /></div>
    </div>
  );
}
