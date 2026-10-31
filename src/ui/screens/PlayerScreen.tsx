import { useEffect, useState } from 'react';
import { trialOf } from '../../game/trials';
import { bidClauseWorth } from '../../game/clauses';
import { IncomingOffersFor } from './Transfers';
import { askConfirm } from '../confirm';
import { Info } from '../help';
import { A, GROUPS, POSITIONS_LABEL } from '../../game/attributes';
import { attrRange, knowledgeOf, scoutRecommendation, scoutStars } from '../../game/scouting';
import { avgRating } from '../../game/season';
import { gs } from '../../game/state';
import { SCHEDULES } from '../../game/training';
import { MAX_BID_ROUNDS, askingPrice, canPreContract, counterPackages, interestedClubs, knownEnquiry, loanSuitors, swapCandidates, swapWorth, nextWindow, preContractBlock, windowOpen } from '../../game/transfers';
import type { Contract, TransferOffer } from '../../game/types';
import { dateFmt, money, t, natName } from '../../i18n';
import { ageOn, daysBetween } from '../../game/dates';
import { AttrVal, Bar, ClubLink, FormList, Rating, Modal, MoneyInput, Nat, Panel, RecTag, Stars, age, posStr, AiSpinner } from '../components';
import { useGame, useNav } from '../core';
import { act as dispatch } from '../../game/actions';
import { compareIds, toggleCompare } from '../compare';
import { Head } from './common';
import { NegotiationModal } from './Negotiation';
import { AcceptCounterButton } from '../counterAccept';
import { Arrow, DevelopmentPanel, attrDelta } from '../dev';
import { trainingAdvice } from '../../game/training';
import { GOOD_TRAITS, reformFactors, traits, type TalkKind } from '../../game/personality';
import { aiCall } from '../../ai/client';
import { guessIntent } from '../../ai/fallback';
import { useAiAvailable } from '../ai';
import { statusTags } from './Squad';
import { agentOf } from '../../game/agents';
import { realCareer, realMoves, type RealMove, type RealSeason } from '../careers';

export function PlayerScreen({ id }: { id: number }) {
  const g = useGame()!;
  const { nav } = useNav();
  const p = g.players[id];
  const [bid, setBid] = useState<boolean | number>(false);
  const [neg, setNeg] = useState<{ offer?: TransferOffer; renew?: number } | null>(null);
  const [msg, setMsg] = useState('');
  const [loanOutOpen, setLoanOut] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  if (!p) return <div><Head title={t('player.gone')} /></div>;
  const mine = p.club === g.userClub && !!g.userClub;
  const k = knowledgeOf(p);
  const stars = scoutStars(p);
  const club = g.clubs[p.club];
  const shortlisted = g.shortlist.includes(p.id);
  const scouts = Object.values(g.staff).filter((s) => s.club === g.userClub && s.role === 'scout');

  const act = (r: TransferOffer | string) => {
    if (typeof r === 'string') {
      if (r.startsWith('enquiry.') && r !== 'enquiry.human') setMsg(''); // svaret står under knapperne
      else if (r !== 'ok') setMsg(t(r)); else setMsg(t('player.done'));
    }
    else if (r.status === 'negotiating') setNeg({ offer: r });
    else setMsg(t('player.bidSent'));
  };

  return (
    <div>
      <Head title={<>{p.first} {p.last} {p.supporterNamed && <span className="tag sup-gold" title={t('sup.namedBy', { name: p.supporterNamed })}>⭐</span>} {statusTags(p, g.userClub)}</>}>
        <button className={compareIds.includes(p.id) ? 'primary' : ''} onClick={() => toggleCompare(p.id)}>{t('player.compare')} ({compareIds.length})</button>
        {compareIds.length >= 2 && <button onClick={() => nav({ name: 'compare' })}>{t('player.showCompare')}</button>}
      </Head>
      {msg && <div className="insight">{msg}</div>}
      {!mine && <MyOffer pid={p.id} onNegotiate={(o) => setNeg({ offer: o })} onOpen={(o) => setBid(o.id)} />}
      {mine && p.complaint && <Complaint pid={p.id} onMsg={setMsg} />}
      {mine && p.renewal && !p.complaint && <div className={`insight ${p.renewal.convinced ? '' : 'warn'}`} style={{ marginBottom: 12 }}>{t(p.renewal.convinced ? 'renewal.status.convinced' : `renewal.status.${p.renewal.stance}`, { player: p.last })}</div>}
      {mine && p.playPromise && <div className="insight warn" style={{ marginBottom: 12 }}>{t('complaint.promised', { date: dateFmt(p.playPromise.until) })}</div>}
      <div className="cols">
        <Panel title={t('player.info')}>
          <div className="kv">
            <span>{t('col.club')}</span><span>{p.club ? <ClubLink id={p.club} long /> : t('common.free')}{p.loan && <> ({t('tag.loan')} {t('common.from')} <ClubLink id={p.loan.from} />)</>}</span>
            <span>{t('col.age')}</span><span>{age(p)} ({dateFmt(p.dob)})</span>
            <span>{t('col.nat')}</span><span><Nat n={p.nation} /> {natName(g.nations[p.nation]?.name)}</span>
            <span>{t('col.pos')}</span><span>{posStr(p)}</span>
            <span>{t('player.foot')}</span><span>{t(`foot.${p.foot || 'R'}`)}</span>
            <span>{t('player.height')}</span><span>{p.height} cm</span>
            {!g.draft && <><span>{t('col.value')}</span><span>{money(p.value)}</span></>}
            {p.contract && <><span>{t('col.wage')}</span><span>{money(p.contract.wage)} / {t('common.week')}</span>
              <span>{t('col.expires')}</span><span>{dateFmt(p.contract.expires)}</span></>}
            {p.contract?.release && (mine || k >= 40) ? <><span>{t('clause.release')}</span><span>{money(p.contract.release)}</span></> : null}
            {mine && p.contract && clauseText(p.contract) && <><span>{t('clause.title')}</span><span>{clauseText(p.contract)}</span></>}
            {mine && p.sellOn && <><span>{t('clause.sellOn')}</span><span>{t('clause.sellOnTo', { pct: p.sellOn.pct, club: g.clubs[p.sellOn.club]?.name ?? '?' })}</span></>}
            {p.addOn && (mine || p.addOn.club === g.userClub) && <><span>{t('clause.addOnShort')}</span><span>{t('clause.addOnLeft', { fee: money(p.addOn.fee), club: g.clubs[p.addOn.club]?.name ?? '?', n: p.addOn.left })}</span></>}
            {p.contract?.futureClub && <><span>{t('player.nextClub')}</span><span><ClubLink id={p.contract.futureClub} /></span></>}
            <span>{t('player.caps')}</span><span>{p.caps} / {p.intGoals}</span>
            {!g.draft && (() => { const a = agentOf(p); return <><span>{t('player.agent')}</span><span title={t(`agent.${a.style}.hint`)}>{a.name} <span className="tag">{t(`agent.${a.style}`)}</span></span></>; })()}
            {!mine && !g.draft && p.club > 0 && <><span>{t('player.asking')}</span><span>{k >= 40 ? `≈ ${money(askingPrice(p))}` : t('player.unknown')}</span></>}
          </div>
        </Panel>
        <Panel title={t('player.status')}>
          <div className="kv">
            <span>{t('col.cond')}<Info topic="condition" /></span><span><Bar value={p.condition} /> {Math.round(p.condition)}%</span>
            {!g.draft && <><span>{t('col.morale')}<Info topic="morale" /></span><span>{t(`morale.${p.morale >= 16 ? 'superb' : p.morale >= 13 ? 'good' : p.morale >= 9 ? 'okay' : 'poor'}`)}</span></>}
            <span>{t('col.form')}</span><span><FormList form={p.form} /></span>
            {p.injury && <><span>{t('player.injury')}</span><span className="bad">{t(`injury.${p.injury.key}`)} ({p.injury.days} {t('common.days')})</span></>}
            {p.banned > 0 && <><span>{t('tag.ban')}</span><span className="bad">{p.banned}</span></>}
            {!g.draft && (mine || k >= 60) && traits(p).length > 0 && <><span>{t('pers.title')}</span><span>{traits(p).map((x) => <span key={x} className={`tag ${GOOD_TRAITS.has(x) ? 'good' : x === 'troublemaker' || x === 'lazy' || x === 'mercenary' ? 'bad' : 'warn'}`} title={t(`trait.${x}.desc`)}>{t(`trait.${x}`)}</span>)}</span></>}
            {p.promiseUntil && <><span>{t('pers.promise')}</span><span className="muted">{t('pers.promiseUntil', { date: dateFmt(p.promiseUntil) })}</span></>}
            <span>{t('player.ability')}</span><span><Stars range={stars.ability} /></span>
            {!g.draft && <><span>{t('player.potential')}</span><span><Stars range={stars.potential} /></span></>}
            {g.options.masking && !mine && <><span>{t('player.knowledge')}</span><span><Bar value={k} /> {Math.round(k)}%</span></>}
          </div>
        </Panel>
        {/* draft-liga: ingen transfers, kontrakter eller træning */}
        {!g.draft && (
        <Panel title={t('player.actions')}>
          <div className="col">
            {mine && (
              <>
                <div className="row">
                  <label>{t('nav.training')}</label>
                  <select value={p.training} onChange={(e) => dispatch({ t: 'training', pid: p.id, key: e.target.value })}>
                    {SCHEDULES.map((s) => <option key={s.key} value={s.key}>{t(`train.${s.key}`)}</option>)}
                  </select>
                </div>
                <AdviceLine pid={p.id} />
                <div className="row">
                  {p.listed
                    ? <><button onClick={() => setListOpen(true)}>{t('list.changePrice')}</button><button onClick={() => dispatch({ t: 'listed', pid: p.id, price: null })}>{t('player.unlist')}</button></>
                    : <button onClick={() => setListOpen(true)}>{t('player.list')}</button>}
                  <button onClick={() => setNeg({ renew: p.id })}>{t('player.renew')}</button>
                  <button onClick={() => setLoanOut(true)} disabled={!!p.loan || !windowOpen()}>{t('player.loanOut')}</button>
                  <button className="danger" onClick={async () => { if (await askConfirm(t('player.releaseConfirm'), { danger: true })) { dispatch({ t: 'release', pid: p.id }); nav({ name: 'squad' }); } }}>{t('player.release')}</button>
                </div>
              </>
            )}
            {!mine && g.userClub > 0 && (
              <>
                <div className="row">
                  {p.club > 0 && <button className="primary" disabled={!windowOpen()} title={windowOpen() ? undefined : t('transfer.windowOpens', { date: dateFmt(nextWindow()) })} onClick={() => setBid(true)}>{t('player.bid')}</button>}
                  {p.club > 0 && <button onClick={() => act(dispatch<string>({ t: 'enquire', pid: p.id }))}>{t('player.enquire')}</button>}
                  {p.club > 0 && !windowOpen() && <span className="muted" style={{ fontSize: 12 }}>{t('transfer.windowOpens', { date: dateFmt(nextWindow()) })}</span>}
                  {!p.club && <button className="primary" disabled={!windowOpen()} title={windowOpen() ? undefined : t('transfer.windowOpens', { date: dateFmt(nextWindow()) })} onClick={() => act(dispatch<TransferOffer | string>({ t: 'bid', pid: p.id, fee: 0, loan: false }))}>{t('player.offerContract')}</button>}
                  {!p.club && (trialOf(p.id)
                    ? <span className="tag good" title={t('trial.until', { date: dateFmt(trialOf(p.id)!.end) })}>🧪 {t('trial.onTrial', { date: dateFmt(trialOf(p.id)!.end) })}</span>
                    : <button onClick={() => { const r = dispatch<string>({ t: 'trial', pid: p.id }); setMsg(r === 'ok' ? t('trial.invited') : t(`trial.err.${r}`)); }}>🧪 {t('trial.invite')}</button>)}
                  {canPreContract(p) && <button onClick={() => act(dispatch<TransferOffer | string>({ t: 'preContract', pid: p.id }))}>{t('player.preContract')}</button>}
                  {(preContractBlock(p) === 'fromJanuary' || preContractBlock(p) === 'taken') && (
                    <div className="muted" style={{ fontSize: 12, flexBasis: '100%' }}>
                      {preContractBlock(p) === 'taken'
                        ? t('player.bosmanTaken', { club: g.clubs[p.contract!.futureClub!]?.name ?? '' })
                        : t('player.bosmanFromJan', { year: Number(p.contract!.expires.slice(0, 4)) })}
                    </div>
                  )}
                  <button onClick={() => dispatch({ t: 'shortlist', pid: p.id, on: !shortlisted })}>{shortlisted ? t('player.unshortlist') : t('player.shortlist')}</button>
                </div>
                <EnquiryLine pid={p.id} />
                {!windowOpen() && <div className="muted">{t('transfer.windowClosed')}</div>}
                {scouts.length > 0 && g.options.masking && k < 100 && (
                  <div className="row">
                    <select defaultValue="" onChange={(e) => {
                      const s = g.staff[Number(e.target.value)];
                      if (s) { dispatch({ t: 'scout', staffId: s.id, assignment: { kind: 'player', target: p.id } }); setMsg(t('player.scoutSent', { scout: `${s.first} ${s.last}` })); }
                    }}>
                      <option value="" disabled>{t('player.sendScout')}</option>
                      {scouts.map((s) => <option key={s.id} value={s.id}>{s.first} {s.last}</option>)}
                    </select>
                  </div>
                )}
              </>
            )}
            <label className="col">{t('player.notes')}
              <textarea rows={2} defaultValue={p.notes ?? ''} onBlur={(e) => { if (e.target.value !== (p.notes ?? '')) dispatch({ t: 'notes', pid: p.id, text: e.target.value }); }} />
            </label>
          </div>
        </Panel>
        )}
      </div>
      {mine && <IncomingOffersFor pid={p.id} />}
      {mine && p.wantsAway && <WantsAway pid={p.id} onMsg={setMsg} />}
      {mine && (traits(p).includes('troublemaker') || traits(p).includes('temperamental')) && <ReformPanel pid={p.id} />}
      {mine && !g.draft && <TalkPanel pid={p.id} />}
      {!mine && !g.draft && g.userClub > 0 && <ScoutReport pid={p.id} />}
      {!g.draft && <InterestPanel pid={p.id} mine={mine} />}
      <Panel title={t('player.attributes')} right={g.options.masking && k < 100 ? <span className="muted">{t('player.rangeHint')}</span> : undefined}>
        <div className="attr-groups">
          {(['technical', 'mental', 'physical', ...(p.pos[0] >= 15 ? ['goalkeeping'] : [])] as (keyof typeof GROUPS)[]).map((grp) => (
            <div key={grp}>
              <h4>{t(`group.${grp}`)}</h4>
              <div className="attr-list">
                {GROUPS[grp].filter((a) => p.pos[0] >= 15 || !['handling', 'oneOnOnes', 'reflexes'].includes(a)).map((a) => {
                  const [lo, hi] = attrRange(p, A[a], k);
                  return [<span key={a + 'l'}>{t(`attr.${a}`)}</span>, <span key={a + 'v'}>{mine && <Arrow d={attrDelta(p, A[a], 3)} small />}<AttrVal lo={lo} hi={hi} /></span>];
                })}
              </div>
            </div>
          ))}
          <div>
            <h4>{t('player.positions')}</h4>
            <div className="attr-list">
              {POSITIONS_LABEL.map(([lbl, i]) => [<span key={lbl + 'l'}>{lbl}</span>, <AttrVal key={lbl + 'v'} lo={p.pos[i]} hi={p.pos[i]} />])}
              {(['L', 'C', 'R'] as const).map((s, i) => [<span key={s + 'l'}>{t(`side.${s}`)}</span>, <AttrVal key={s + 'v'} lo={p.side[i]} hi={p.side[i]} />])}
            </div>
          </div>
        </div>
      </Panel>
      {p.dev && p.dev.length > 0 && (
        <Panel title={t('dev.title')} right={<span className="muted">{t('dev.since', { date: dateFmt(p.dev[0].d) })}</span>}>
          <DevelopmentPanel p={p} date={g.date} />
        </Panel>
      )}
      <div className="cols">
        <Panel title={t('player.thisSeason')}>
          <div className="kv">
            <span>{t('col.apps')}</span><span>{p.stats.apps} ({p.stats.subs})</span>
            <span>{t('col.goals')}</span><span>{p.stats.goals}</span>
            <span>{t('col.assists')}</span><span>{p.stats.assists}</span>
            <span>{t('player.mom')}</span><span>{p.stats.mom}</span>
            <span>{t('player.cards')}</span><span>{p.stats.yellows} / {p.stats.reds}</span>
            <span>{t('col.avr')}</span><span>{p.stats.ratingCount ? <Rating r={avgRating(p)} digits={2} /> : '-'}</span>
          </div>
        </Panel>
      </div>
      <div style={{ marginTop: 14 }}><CareerPanel pid={p.id} /></div>
      {bid !== false && <BidModal pid={p.id} offerId={typeof bid === 'number' ? bid : undefined} onClose={() => setBid(false)} onDone={(r) => { setBid(false); act(r); }} />}
      {listOpen && <ListModal pid={p.id} onClose={() => setListOpen(false)} />}
      {loanOutOpen && <LoanOutModal pid={p.id} onClose={() => setLoanOut(false)} onDone={(r) => { setLoanOut(false); act(r); }} />}
      {neg && <NegotiationModal offer={neg.offer} renewPid={neg.renew} onClose={() => setNeg(null)} />}
      {club && <div className="muted">{t('player.clubRep')}: {club.rep}</div>}
    </div>
  );
}

/** Klubbens svar på seneste forespørgsel */
function EnquiryLine({ pid }: { pid: number }) {
  const g = gs();
  const e = knownEnquiry(pid);
  if (!e) return null;
  const club = g.clubs[e.club]?.name ?? '';
  return <div className={`insight ${e.nfs ? 'warn' : ''}`}>{t(e.nfs ? 'enquiry.answerNfs' : 'enquiry.answer', { club, fee: money(e.fee), date: dateFmt(e.date) })}</div>;
}

/** Pæne trin til budslideren */
function feeStep(max: number) {
  const raw = max / 200;
  const mag = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  const n = raw / mag;
  return Math.max(5_000, (n <= 1 ? 1 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag);
}

function BidModal({ pid, onClose, onDone, offerId: initialOffer }: { pid: number; onClose: () => void; onDone: (r: TransferOffer | string) => void; offerId?: number }) {
  const g = useGame()!;
  const p = g.players[pid];
  const budget = g.clubs[g.userClub].transferBudget;
  const known = knownEnquiry(pid);
  const [fee, setFee] = useState(Math.min(budget, known?.fee ?? Math.round(p.value / 50_000) * 50_000));
  const [loan, setLoan] = useState(false);
  const [sellOn, setSellOn] = useState(0);
  const [addOn, setAddOn] = useState(0);
  const [swap, setSwap] = useState<number[]>([]);
  // live-forhandling: buddet sendes, klubben svarer med det samme her i vinduet
  const [offerId, setOfferId] = useState<number | null>(initialOffer ?? null);
  const [stage, setStage] = useState<'form' | 'answer'>(initialOffer ? 'answer' : 'form');
  const [err, setErr] = useState('');
  const live = offerId !== null ? g.offers.find((x) => x.id === offerId) : undefined;
  const submit = () => {
    setErr('');
    if (live && (live.status === 'countered' || live.status === 'rejected')) {
      const r = dispatch<string>({ t: 'rebid', offer: live.id, fee });
      if (['pending', 'countered', 'rejected', 'negotiating', 'withdrawn'].includes(r) || r === 'transfer.talksOver') setStage('answer'); else setErr(t(r));
      return;
    }
    const r = dispatch<TransferOffer | string>({ t: 'bid', pid, fee: loan ? 0 : fee, loan, sellOn: loan ? 0 : sellOn, addOn: loan ? 0 : addOn, swap: loan ? [] : swap });
    if (typeof r === 'string') { setErr(t(r)); return; }
    if (r.status === 'negotiating') { onDone(r); return; } // klubløs: direkte til kontrakten
    dispatch({ t: 'bidNow', offer: r.id });
    setOfferId(r.id);
    setStage('answer');
  };
  const cands = p.club ? swapCandidates(p.club, pid) : [];
  const swapVal = swap.reduce((s, id) => s + swapWorth(id, p.club), 0);
  const release = p.contract?.release;
  // slideren går op til budgettet, men ikke meget længere end spilleren er værd (ellers kan den ikke styres)
  const ref = Math.max(p.value, known?.fee ?? 0, release && release <= budget ? release : 0);
  const max = Math.max(fee, Math.min(budget, ref * 2));
  const step = feeStep(max);
  const pct = Math.round((fee / Math.max(1, p.value)) * 100);
  // byttespillere tæller med i buddets værdi
  const total = fee + swapVal;
  const hint = !known ? 'bid.hintUnknown'
    : known.nfs ? (total >= known.fee ? 'bid.hintNfsMet' : 'bid.hintNfs')
    : total > known.fee * 1.15 ? 'bid.hintOver' : total >= known.fee ? 'bid.hintAtAsk' : total >= known.fee * 0.75 ? 'bid.hintClose' : 'bid.hintLow';
  const tone = !known ? '' : total >= known.fee ? 'good' : known.nfs || total < known.fee * 0.75 ? 'bad' : 'warn';
  if (stage === 'answer' && live) {
    const seller = gs().clubs[live.seller]?.name ?? '';
    const left = MAX_BID_ROUNDS - (live.bidRounds ?? 1);
    return (
      <Modal title={t('bid.title', { player: `${p.first} ${p.last}` })} onClose={onClose}>
        <div className="col">
          <div className="kv">
            <span>{t('bid.yourBid')}</span><span><b>{live.loan ? t('tr.loan') : money(live.fee)}</b></span>
            <span>{t('col.value')}</span><span>{money(p.value)}</span>
          </div>
          {live.status === 'negotiating' && (
            <>
              <div className="insight good">{t('bid.live.accepted', { club: seller, fee: money(live.fee) })}</div>
              <div className="muted" style={{ fontSize: 12.5 }}>{t('bid.live.deadline', { date: dateFmt(live.respondBy) })}</div>
              <div className="row" style={{ justifyContent: 'flex-end' }}><button className="primary" onClick={() => onDone(live)}>{t('offer.negotiate')}</button></div>
            </>
          )}
          {live.status === 'countered' && (
            <>
              <div className="insight warn">{t('bid.live.counter', { club: seller, fee: money(live.counter ?? 0) })}{live.rival ? ` ${t('bid.live.rival', { club: gs().clubs[live.rival.club]?.name ?? '' })}` : ''}</div>
              {live.rival && <div className="insight warn">{t('bid.live.rivalBid', { club: gs().clubs[live.rival.club]?.name ?? '', fee: money(live.rival.fee) })}</div>}
              {left > 0 && (
                <div className="pkg-grid">
                  {counterPackages(live).filter((x) => x.kind !== 'cash').map((x) => (
                    <button key={x.kind} className="pkg" disabled={x.fee > budget} onClick={() => { const r = dispatch<string>({ t: 'rebid', offer: live.id, fee: x.fee, sellOn: x.sellOn ?? 0, addOn: x.addOn ?? 0 }); if (!['pending', 'countered', 'rejected', 'negotiating'].includes(r) && r !== 'transfer.talksOver') setErr(t(r)); }}>
                      <b>{t(`pkg.${x.kind}`)}</b>
                      <span>{money(x.fee)}{x.addOn ? ` + ${money(x.addOn)} ${t('pkg.after25')}` : ''}{x.sellOn ? ` + ${x.sellOn}% ${t('pkg.ofResale')}` : ''}</span>
                      <em>{t('pkg.max', { fee: money(x.maxCost) })} · {t(`pkg.risk.${x.kind}`)}</em>
                    </button>
                  ))}
                </div>
              )}
              <div className="muted" style={{ fontSize: 12.5 }}>{left > 0 ? t('bid.live.roundsLeft', { n: left }) : t('bid.live.lastRound')}</div>
              <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button className="danger" onClick={() => { dispatch({ t: 'withdraw', pid }); onClose(); }}>{t('offer.withdraw')}</button>
                {left > 0 && <button onClick={() => { setFee(Math.round(((live.fee + (live.counter ?? live.fee)) / 2) / 10_000) * 10_000); setStage('form'); }}>{t('bid.live.again')}</button>}
                <button className="primary" disabled={(live.counter ?? 0) > budget} onClick={() => { const r = dispatch<string>({ t: 'acceptCounter', pid }); if (r !== 'ok') setErr(t(r)); }}>{t('bid.live.acceptCounter', { fee: money(live.counter ?? 0) })}</button>
              </div>
            </>
          )}
          {live.status === 'rejected' && (
            <>
              <div className="insight bad">{t(live.nfs ? 'bid.live.nfs' : 'bid.live.rejected', { club: seller })}</div>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button onClick={onClose}>{t('common.close')}</button>
                {!live.nfs && left > 0 && <button className="primary" onClick={() => { setFee(Math.round((live.fee * 1.15) / 10_000) * 10_000); setStage('form'); }}>{t('bid.live.again')}</button>}
              </div>
            </>
          )}
          {(live.status === 'pending' || live.status === 'withdrawn' || live.status === 'collapsed') && (
            <>
              <div className="insight">{live.status === 'pending' ? t('bid.live.pending', { club: seller, date: dateFmt(live.respondBy) }) : t(`offer.${live.status}`)}</div>
              <div className="row" style={{ justifyContent: 'flex-end' }}><button onClick={onClose}>{t('common.close')}</button></div>
            </>
          )}
          {err && <div className="insight bad">{err}</div>}
        </div>
      </Modal>
    );
  }
  return (
    <Modal title={t('bid.title', { player: `${p.first} ${p.last}` })} onClose={onClose}>
      <div className="col">
        <div className="kv">
          <span>{t('col.value')}</span><span>{money(p.value)}</span>
          <span>{t('top.budget')}</span><span>{money(budget)}</span>
          {known && <><span>{t('bid.theirPrice')}</span><span>{money(known.fee)}{known.nfs ? ` (${t('bid.nfsShort')})` : ''}</span></>}
        </div>
        <label className="row"><input type="checkbox" checked={loan} onChange={(e) => setLoan(e.target.checked)} /> {t('bid.loan')}</label>
        {!loan && (
          <>
            <label>{t('bid.fee')}: <b className="accent">{money(fee)}</b> ({pct}% {t('list.ofValue')})
              <input type="range" min={0} max={max} step={step} value={fee} onChange={(e) => setFee(Number(e.target.value))} style={{ width: '100%' }} />
            </label>
            <div className="row">
              <button onClick={() => setFee(Math.max(0, fee - step))}>−</button>
              <MoneyInput value={fee} onChange={setFee} width={140} />
              <button onClick={() => setFee(Math.min(budget, fee + step))}>+</button>
              {known && known.fee <= budget && <button className="small" onClick={() => setFee(known.fee)}>{t('bid.matchPrice')}</button>}
            </div>
            <div className={`insight row ${tone}`}>
              <span className="grow">{t(hint, { fee: money(known?.fee ?? 0) })}</span>
              {!known && <button className="small" onClick={() => dispatch({ t: 'enquire', pid })}>{t('player.enquire')}</button>}
            </div>
            {fee > budget && <div className="insight bad">{t('transfer.overBudget')}</div>}
            {release ? (
              <div className="insight row">
                <span className="grow">{t('clause.releaseKnown', { fee: money(release) })}</span>
                <button className="small" disabled={release > budget} onClick={() => { setFee(release); setSellOn(0); setAddOn(0); }}>{t('clause.payRelease')}</button>
              </div>
            ) : null}
            {cands.length > 0 && (
              <div className="col" style={{ gap: 4 }}>
                <div>{t('swap.title')} <span className="muted" style={{ fontSize: 12 }}>{t('swap.hint', { club: gs().clubs[p.club]?.short ?? '' })}</span></div>
                <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                  {cands.map((x) => {
                    const on = swap.includes(x.id);
                    return <button key={x.id} className={`small ${on ? 'primary' : ''}`} disabled={!on && swap.length >= 3} title={t('swap.worth', { fee: money(swapWorth(x.id, p.club)) })} onClick={() => setSwap(on ? swap.filter((i) => i !== x.id) : [...swap, x.id])}>{x.last} · {posStr(x)} · {money(swapWorth(x.id, p.club))}</button>;
                  })}
                </div>
                {swap.length > 0 && <div className="muted" style={{ fontSize: 12 }}>{t('swap.total', { cash: money(fee), swap: money(swapVal), total: money(total) })}</div>}
              </div>
            )}
            <PriceRisk p={p} fee={fee} sellOn={sellOn} addOn={addOn} swapVal={swapVal} />
            <div className="row">{t('clause.sellOn')}: {[0, 10, 15, 20, 30].map((v) => <button key={v} className={`small ${sellOn === v ? 'primary' : ''}`} onClick={() => setSellOn(v)}>{v ? `${v}%` : t('common.none')}</button>)}</div>
            <div className="row">{t('clause.addOn', { n: 25 })}: <MoneyInput value={addOn} onChange={setAddOn} width={130} /></div>
            {(sellOn > 0 || addOn > 0) && <div className="muted" style={{ fontSize: 12 }}>{t('clause.bidHint')}</div>}
          </>
        )}
        {err && <div className="insight bad">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={onClose}>{t('common.cancel')}</button>
          <button className="primary" disabled={!loan && fee > budget} onClick={submit}>{live ? t('bid.live.send') : t('bid.submit')}</button>
        </div>
      </div>
    </Modal>
  );
}

function LoanOutModal({ pid, onClose, onDone }: { pid: number; onClose: () => void; onDone: (r: string) => void }) {
  const g = gs();
  const p = g.players[pid];
  const wage = p.contract?.wage ?? 0;
  const suitors = loanSuitors(pid);
  const [share, setShare] = useState(100);
  const [fee, setFee] = useState(0);
  const [club, setClub] = useState(0);
  const willing = suitors.filter((s) => s.maxShare * 100 >= share - 0.01 && s.maxFee >= fee);
  return (
    <Modal title={t('loan.title', { player: `${p.first} ${p.last}` })} onClose={onClose} wide>
      <div className="col">
        <div className="muted">{t('loan.explain')}</div>
        <label>{t('loan.share')}: <b className="accent">{share}%</b> ({money(wage * share / 100)} / {t('common.week')} {t('loan.theyPay')}, {money(wage * (100 - share) / 100)} {t('loan.youPay')})
          <input type="range" min={0} max={100} step={5} value={share} onChange={(e) => { setShare(Number(e.target.value)); setClub(0); }} style={{ width: '100%' }} />
        </label>
        <label className="row">{t('loan.fee')}: <MoneyInput value={fee} onChange={(v) => { setFee(v); setClub(0); }} /></label>
        <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
          <table className="grid">
            <thead><tr><th>{t('col.club')}</th><th>{t('col.comp')}</th><th className="num">{t('loan.maxShare')}</th><th className="num">{t('loan.maxFee')}</th><th></th></tr></thead>
            <tbody>
              {suitors.length === 0 && <tr><td colSpan={5} className="muted">{t('transfer.noLoanClub')}</td></tr>}
              {suitors.map((s) => {
                const ok = willing.includes(s);
                return (
                  <tr key={s.club} className={`${ok ? 'clickable' : 'injured'} ${club === s.club ? 'me' : ''}`} onClick={() => ok && setClub(s.club)}>
                    <td><ClubLink id={s.club} /></td>
                    <td>{g.leagues[g.clubs[s.club]?.league]?.name}</td>
                    <td className="num">{Math.round(s.maxShare * 100)}%</td>
                    <td className="num">{money(s.maxFee)}</td>
                    <td>{ok ? <span className="tag good">{t('loan.accepts')}</span> : <span className="tag bad">{t('loan.declines')}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <span className="muted">{willing.length} {t('loan.interested')}</span>
          <button onClick={onClose}>{t('common.cancel')}</button>
          <button className="primary" disabled={!club} onClick={() => onDone(dispatch<string>({ t: 'loanOut', pid, club, share: share / 100, fee }))}>{t('loan.agree')}</button>
        </div>
      </div>
    </Modal>
  );
}

function ListModal({ pid, onClose }: { pid: number; onClose: () => void }) {
  const g = gs();
  const p = g.players[pid];
  const [pct, setPct] = useState(p.listPrice ? Math.round((p.listPrice / Math.max(1, p.value)) * 100) : 100);
  const price = Math.max(10_000, Math.round((p.value * pct) / 100 / 10_000) * 10_000);
  const hint = pct <= 60 ? 'list.hintBargain' : pct <= 90 ? 'list.hintCheap' : pct <= 115 ? 'list.hintFair' : pct <= 150 ? 'list.hintHigh' : 'list.hintTooHigh';
  return (
    <Modal title={t('list.title', { player: `${p.first} ${p.last}` })} onClose={onClose}>
      <div className="col">
        <div className="kv">
          <span>{t('col.value')}</span><span>{money(p.value)}</span>
          {p.contract && <><span>{t('col.expires')}</span><span>{dateFmt(p.contract.expires)}</span></>}
        </div>
        <label>{t('list.price')}: <b className="accent">{money(price)}</b> ({pct}% {t('list.ofValue')})
          <input type="range" min={30} max={200} step={5} value={pct} onChange={(e) => setPct(Number(e.target.value))} style={{ width: '100%' }} />
        </label>
        <div className="row">
          {[50, 75, 100, 125, 150].map((v) => <button key={v} className={`small ${pct === v ? 'primary' : ''}`} onClick={() => setPct(v)}>{v}%</button>)}
        </div>
        <div className={`insight ${pct <= 90 ? 'good' : pct > 150 ? 'bad' : ''}`}>{t(hint)}</div>
        <div className="muted">{t('list.explain')}</div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={onClose}>{t('common.cancel')}</button>
          <button className="primary" onClick={() => { dispatch({ t: 'listed', pid, price }); onClose(); }}>{p.listed ? t('list.update') : t('player.list')}</button>
        </div>
      </div>
    </Modal>
  );
}

function AdviceLine({ pid }: { pid: number }) {
  const g = gs();
  const p = g.players[pid];
  const adv = trainingAdvice(p);
  const asst = Object.values(g.staff).find((s) => s.club === g.userClub && s.role === 'assistant');
  if (adv.key === p.training) return <div className="muted">✓ {t('adv.agrees', { coach: asst ? asst.last : t('role.staff.assistant') })}</div>;
  return (
    <div className="insight">
      {t('adv.suggest', { coach: asst ? `${asst.first} ${asst.last}` : t('role.staff.assistant'), schedule: t(`train.${adv.key}`) })}{' '}
      <span className="muted">{t(adv.reason, { attrs: adv.attrs.map((a) => t(`attr.${a}`)).join(` ${t('common.and')} `) })}</span>{' '}
      <button className="small primary" onClick={() => dispatch({ t: 'training', pid, key: adv.key })}>{t('adv.use')}</button>
    </div>
  );
}

function ScoutReport({ pid }: { pid: number }) {
  const g = gs();
  const p = g.players[pid];
  const rec = scoutRecommendation(p);
  const scouts = Object.values(g.staff).filter((s) => s.club === g.userClub && s.role === 'scout').sort((a, b) => b.attrs.judgingAbility - a.attrs.judgingAbility);
  const scout = scouts[0];
  return (
    <div className={`insight ${rec.level < 0 ? '' : rec.level <= 1 ? 'good' : rec.level >= 3 ? 'bad' : 'warn'}`}>
      <div className="row"><b>{t('rec.title', { scout: scout ? `${scout.first} ${scout.last}` : t('role.staff.scout') })}</b> <RecTag level={rec.level} /></div>
      <div style={{ marginTop: 4 }}>{t(rec.key)}{rec.reasons.length > 0 && ' '}{rec.reasons.map((r) => t(r.key, r.params)).join(' ')}</div>
    </div>
  );
}

function WantsAway({ pid, onMsg }: { pid: number; onMsg: (m: string) => void }) {
  const g = gs();
  const p = g.players[pid];
  return (
    <div className="insight bad">
      <b>{t('pers.wantsAwayTitle', { player: p.last })}</b>
      <div className="muted" style={{ margin: '4px 0 8px' }}>{t('pers.wantsAwayText')}</div>
      <div className="row">
        <button className="small primary" disabled={!!p.promiseUntil} onClick={() => onMsg(t(dispatch<string>({ t: 'talk', pid, choice: 'promise' })))}>{t('pers.talk.promise')}</button>
        <button className="small" onClick={() => onMsg(t(dispatch<string>({ t: 'talk', pid, choice: 'list' })))}>{t('pers.talk.list')}</button>
        <button className="small danger" onClick={() => onMsg(t(dispatch<string>({ t: 'talk', pid, choice: 'refuse' })))}>{t('pers.talk.refuse')}</button>
      </div>
    </div>
  );
}

/** Dit aktive bud på spilleren – med mulighed for at trække det tilbage */
function MyOffer({ pid, onNegotiate, onOpen }: { pid: number; onNegotiate: (o: TransferOffer) => void; onOpen: (o: TransferOffer) => void }) {
  const g = gs();
  const o = g.offers.slice().reverse().find((x) => x.player === pid && x.buyer === g.userClub && ['pending', 'countered', 'negotiating'].includes(x.status));
  if (!o) return null;
  return (
    <div className="insight warn row">
      <span className="grow">
        <b>{t('myoffer.title')}</b> {o.loan ? t('tr.loan') : o.preContract ? t('neg.bosman') : money(o.fee)}{o.swap?.length ? ` ${t('swap.plus', { names: o.swap.map((id) => g.players[id]?.last ?? '?').join(', ') })}` : ''} · <span className="tag warn">{t(`offer.${o.status}`)}</span>
        {o.status === 'countered' && o.counter ? <> · {t('myoffer.theyWant', { fee: money(o.counter) })}</> : null}
      </span>
      {o.status === 'negotiating' && <button className="small primary" onClick={() => onNegotiate(o)}>{t('offer.negotiate')}</button>}
      {o.status === 'countered' && <AcceptCounterButton o={o} onOk={() => onNegotiate(o)} />}
      {o.status === 'countered' && <button className="small" onClick={() => onOpen(o)}>{t('bid.live.again')}</button>}
      <button className="small danger" onClick={async () => { if (await askConfirm(t('neg.cancelConfirm'))) dispatch({ t: 'withdraw', pid }); }}>{t('offer.withdraw')}</button>
    </div>
  );
}

function TalkPanel({ pid }: { pid: number }) {
  const g = useGame()!;
  const p = g.players[pid];
  const [res, setRes] = useState<{ key: string; mood: string } | null>(null);
  const cooldown = p.lastTalk ? 10 - daysBetween(p.lastTalk, g.date) : 0;
  const form = p.form.slice(-3);
  const avgForm = form.length ? form.reduce((s, x) => s + x, 0) / form.length : null;
  const reason = p.lastRed && daysBetween(p.lastRed, g.date) <= 30 ? t('talk.reasonRed', { date: dateFmt(p.lastRed) })
    : p.lastIncident && daysBetween(p.lastIncident, g.date) <= 45 ? t('talk.reasonIncident', { date: dateFmt(p.lastIncident) }) : null;
  const ai = useAiAvailable();
  const [msgText, setMsgText] = useState('');
  const [convo, setConvo] = useState<{ me: string; reply: string; mood: string } | null>(null);
  const [thinking, setThinking] = useState(false);
  const doTalk = async (kind: TalkKind): Promise<{ key: string; mood: string } | null> => {
    if ((kind === 'fine' || kind === 'fineHeavy' || kind === 'drop') && !reason && !(await askConfirm(t('talk.noReasonConfirm')))) return null;
    const r = dispatch<{ key: string; mood: string }>({ t: 'interact', pid, kind });
    setRes(r);
    setConvo(null);
    return r;
  };
  // fritekst: AI tolker hensigten, spillets regler afgør reaktionen, AI skriver spillerens svar
  const sendMessage = async () => {
    const text = msgText.trim().slice(0, 400);
    if (!text || thinking) return;
    setThinking(true);
    const allowed: TalkKind[] = ['praise', 'encourage', 'criticise', 'demand', 'fine', 'chat', ...(ageOn(p.dob, g.date) <= 23 ? ['future' as TalkKind] : [])];
    const r = await aiCall<{ intent: string }>('talkIntent', { message: text, allowed });
    const intent = (allowed.includes(r?.intent as TalkKind) ? r!.intent : guessIntent(text)) as TalkKind;
    const out = await doTalk(intent);
    if (!out) { setThinking(false); return; }
    const outcome = t(out.key, { player: p.last });
    setConvo({ me: text, reply: outcome, mood: out.mood });
    setMsgText('');
    const reply = await aiCall<{ reply: string }>('talkReply', {
      player: `${p.first} ${p.last}`, age: ageOn(p.dob, g.date), traits: traits(p), morale: Math.round(p.morale), recentRatings: p.form,
      managerMessage: text, interpretedAs: intent, outcome, mood: out.mood,
    });
    if (reply?.reply) setConvo({ me: text, reply: reply.reply, mood: out.mood });
    setThinking(false);
  };
  const wage = p.contract?.wage ?? 0;
  return (
    <Panel title={t('talk.title', { player: p.last })}>
      <div className="col">
        <div className="kv">
          <span>{t('talk.form')}</span><span>{avgForm !== null ? <><Rating r={avgForm} /> (<FormList form={form} />)</> : t('talk.noGames')}</span>
          <span>{t('col.morale')}</span><span><Bar value={p.morale} max={20} /></span>
          <span>{t('talk.discipline')}</span><span className={reason ? 'bad' : 'muted'}>{reason ?? t('talk.noReason')}</span>
        </div>
        <div className="row">
          <button disabled={cooldown > 0} onClick={() => doTalk('praise')}>👏 {t('talk.praise')}</button>
          <button disabled={cooldown > 0} onClick={() => doTalk('encourage')}>🤝 {t('talk.encourage')}</button>
          {ageOn(p.dob, g.date) <= 23 && <button disabled={cooldown > 0} onClick={() => doTalk('future')} title={t('talk.futureHint')}>🌱 {t('talk.future')}</button>}
          <button disabled={cooldown > 0} onClick={() => doTalk('criticise')}>☝️ {t('talk.criticise')}</button>
          <button className="danger" disabled={cooldown > 0} onClick={() => doTalk('fine')}>{t('talk.fine', { fee: money(wage) })}</button>
          <button className="danger" disabled={cooldown > 0} onClick={() => doTalk('fineHeavy')}>{t('talk.fineHeavy', { fee: money(wage * 2) })}</button>
          <button className="danger" disabled={cooldown > 0} onClick={() => doTalk('drop')}>{t('talk.drop')}</button>
        </div>
        <div className="row">
          <input style={{ flex: 1 }} maxLength={400} disabled={cooldown > 0 || thinking} placeholder={t('talk.freePlaceholder', { player: p.first || p.last })} value={msgText} onChange={(e) => setMsgText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') sendMessage(); }} />
          <button disabled={cooldown > 0 || thinking || !msgText.trim()} onClick={sendMessage}>{thinking ? <AiSpinner /> : t('talk.send')}</button>
        </div>
        {!ai && <div className="muted" style={{ fontSize: 12 }}>{t('talk.noAi')}</div>}
        {cooldown > 0 && !res && !convo && <div className="muted">{t('talk.cooldown', { n: cooldown })}</div>}
        {convo ? (
          <div className="chat">
            <div className="chat-me">{convo.me}</div>
            <div className={`chat-them insight ${convo.mood}`}><b>{p.last}:</b> {convo.reply}</div>
          </div>
        ) : res && <div className={`insight ${res.mood}`}>{t(res.key, { player: p.last })}</div>}
      </div>
    </Panel>
  );
}

/** Karriere: virkelige sæsoner før spilstart + sæsoner i spillet + den igangværende sæson */
function CareerPanel({ pid }: { pid: number }) {
  const g = useGame()!;
  const p = g.players[pid];
  const [real, setReal] = useState<RealSeason[] | null>(null);
  const [realMv, setRealMv] = useState<RealMove[]>([]);
  useEffect(() => {
    let alive = true;
    realCareer(pid).then((r) => { if (alive) setReal(r); });
    realMoves(pid).then((m) => { if (alive) setRealMv(m); });
    return () => { alive = false; };
  }, [pid]);
  if (!p) return null;
  type Row = { key: string; season: number; club: number; clubName?: string; apps: number; goals: number; assists: number; minutes?: number; avg?: number; loan?: boolean; real?: boolean; live?: boolean; move?: { fee: number; loan?: boolean; from: number; fromName?: string; swap?: boolean } };
  const rows: Row[] = [
    // draft-liga: kun denne sæson
    ...(g.draft ? [] : (real ?? []).map((r, i) => ({ key: `r${i}`, ...r, real: true }))),
    ...(g.draft ? [] : p.history.map((h, i) => ({ key: `h${i}`, ...h }))),
  ];
  // den igangværende sæson (minus det der allerede er bogført på en tidligere klub)
  const b = p.split ?? { apps: 0, goals: 0, assists: 0, minutes: 0, ratingSum: 0, ratingCount: 0 };
  const liveApps = p.stats.apps + p.stats.subs - b.apps;
  if (liveApps > 0 && p.club) {
    const rc = p.stats.ratingCount - b.ratingCount;
    rows.push({ key: 'live', season: g.season, club: p.club, apps: liveApps, goals: p.stats.goals - b.goals, assists: p.stats.assists - b.assists, minutes: p.stats.minutes - b.minutes, avg: rc > 0 ? (p.stats.ratingSum - b.ratingSum) / rc : undefined, loan: !!p.loan, live: true });
  }
  // den nuværende klub vises altid – også uden kampe endnu
  if (p.club && !rows.some((r) => r.live) && !p.history.some((h) => h.season === g.season && h.club === p.club)) {
    rows.push({ key: 'live', season: g.season, club: p.club, apps: 0, goals: 0, assists: 0, loan: !!p.loan, live: true });
  }
  // klubskifter: transfersummen på sæsonen i den nye klub (og en linje, hvis han ikke nåede at spille)
  for (const [i, m] of (p.moves ?? []).entries()) {
    const row = rows.find((r) => !r.real && r.season === m.season && r.club === m.to && !r.move);
    if (row) row.move = m;
    else rows.push({ key: `m${i}`, season: m.season, club: m.to, apps: 0, goals: 0, assists: 0, loan: m.loan, move: m });
  }
  // virkelige klubskifter før spilstart (transfersum fra datasættet, hvis kendt)
  for (const [i, m] of realMv.entries()) {
    const row = rows.find((r) => r.season === m.season && r.club === m.to && !r.move);
    const mv = { fee: m.fee, from: m.from, fromName: m.fromName };
    if (row) row.move = mv;
    else rows.push({ key: `rm${i}`, season: m.season, club: m.to, clubName: m.toName, apps: 0, goals: 0, assists: 0, real: true, move: mv });
  }
  rows.sort((x, y) => y.season - x.season || (x.live ? -1 : y.live ? 1 : 0) || (x.move && !y.move ? -1 : y.move && !x.move ? 1 : 0));
  const tot = rows.reduce((s, r) => ({ apps: s.apps + r.apps, goals: s.goals + r.goals, assists: s.assists + r.assists, minutes: s.minutes + (r.minutes ?? 0) }), { apps: 0, goals: 0, assists: 0, minutes: 0 });
  const seasonLabel = (s: number) => `${s}/${String(s + 1).slice(2)}`;
  return (
    <Panel title={t('player.career')} className="flush">
      {real === null && rows.length === 0 ? <div className="empty">{t('common.loading')}</div> : rows.length === 0 ? <div className="empty">{t('player.noHistory')}</div> : (
        <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
          <table className="grid">
            <thead><tr><th>{t('col.season')}</th><th>{t('col.club')}</th><th className="num">{t('col.apps')}</th><th className="num">{t('col.goals')}</th><th className="num">{t('col.assists')}</th><th className="num">{t('career.minutes')}</th><th className="num">{t('col.avr')}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={r.live ? 'me' : ''}>
                  <td className="nowrap">{seasonLabel(r.season)}{r.live && <span className="muted"> · {t('career.now')}</span>}</td>
                  <td className="nowrap">{gs().clubs[r.club] ? <ClubLink id={r.club} long /> : <span>{r.clubName ?? '?'}</span>}{r.loan && <span className="muted"> ({t('career.loan')})</span>}
                    {r.move && <span className="muted" style={{ fontSize: 12 }} title={t('career.from', { club: gs().clubs[r.move.from]?.name ?? r.move.fromName ?? '?' }) + (r.move.fee < 0 ? ` · ${t('career.unknownFee')}` : '')}> · ↘ {r.move.swap ? t('career.swap') : r.move.loan ? t('career.loanFee', { fee: r.move.fee > 0 ? money(r.move.fee) : '' }).trim() : r.move.fee < 0 ? '?' : r.move.fee ? money(r.move.fee) : t('career.free')}</span>}</td>
                  <td className="num">{r.apps}</td>
                  <td className="num">{r.goals}</td>
                  <td className="num">{r.assists}</td>
                  <td className="num">{r.minutes ? r.minutes.toLocaleString() : '–'}</td>
                  <td className="num">{r.avg ? <Rating r={r.avg} digits={2} /> : '–'}</td>

                </tr>
              ))}
              <tr className="career-total"><td colSpan={2}><b>{t('career.total')}</b></td><td className="num"><b>{tot.apps}</b></td><td className="num"><b>{tot.goals}</b></td><td className="num"><b>{tot.assists}</b></td><td className="num"><b>{tot.minutes ? tot.minutes.toLocaleString() : '–'}</b></td><td /></tr>
            </tbody>
          </table>
        </div>
      )}
      {!g.draft && real && real.length > 0 && <div className="muted" style={{ fontSize: 11.5, padding: '6px 12px 10px' }}>{t('career.source')}</div>}
    </Panel>
  );
}

/** Spilleren har bedt om en samtale – manageren svarer */
function Complaint({ pid, onMsg }: { pid: number; onMsg: (m: string) => void }) {
  const g = useGame()!;
  const p = g.players[pid];
  if (!p) return null;
  const kind = p.complaint?.kind ?? 'time';
  const reason = p.renewal?.reason ?? 'ambition';
  const choices: ('promise' | 'fight' | 'list' | 'listen')[] = kind === 'time' || kind === 'blocked' || kind === 'renewal' ? ['promise', 'listen', 'fight', 'list'] : ['listen', 'fight', 'list'];
  const label = (c: string, part: 'opt' | 'hint') => (kind === 'blocked' ? t(`complaint.${part}.blocked.${c}`)
    : kind === 'renewal' ? t(c === 'promise' ? `complaint.${part}.renewal.promise.${reason}` : `complaint.${part}.renewal.${c}`)
    : t(`complaint.${part}.${c}`));
  const suitor = p.complaint?.club ? g.clubs[p.complaint.club]?.name ?? '' : '';
  return (
    <Panel title={t('complaint.title', { player: `${p.first} ${p.last}` })}>
      <p style={{ marginTop: 0, lineHeight: 1.5 }}>“{t(kind === 'renewal' ? `complaint.says.renewal.${reason}.${p.renewal?.stance ?? 'hesitant'}` : `complaint.says.${kind}`, { club: suitor })}”</p>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {choices.map((c) => <button key={c} className={c === 'promise' ? 'primary' : ''} title={label(c, 'hint')} onClick={() => onMsg(`${p.last}: ${t(dispatch<string>({ t: 'complaint', pid, choice: c }), { player: p.last, club: suitor })}`)}>{label(c, 'opt')}</button>)}
      </div>
    </Panel>
  );
}

/** Kort tekst med kontraktens klausuler (uden frikøbsklausul) */
function clauseText(c: Contract): string {
  const parts: string[] = [];
  if (c.wageRise) parts.push(t('clause.sumRise', { n: c.wageRise }));
  if (c.appBonus) parts.push(t('clause.sumApp', { fee: money(c.appBonus) }));
  if (c.goalBonus) parts.push(t('clause.sumGoal', { fee: money(c.goalBonus) }));
  if (c.relegationCut) parts.push(t('clause.sumCut', { n: c.relegationCut }));
  if (c.promotionRise) parts.push(t('clause.sumPromo', { n: c.promotionRise }));
  if (c.cleanSheetBonus) parts.push(t('clause.sumClean', { fee: money(c.cleanSheetBonus) }));
  return parts.join(' · ');
}

/** Hvilke klubber holder øje med spilleren (klubbernes shortlister) */
function InterestPanel({ pid, mine }: { pid: number; mine: boolean }) {
  const g = useGame()!;
  const p = g.players[pid];
  const [all, setAll] = useState(false);
  if (!p) return null;
  const list = interestedClubs(p);
  const onMine = !mine && g.shortlist.includes(p.id);
  const shown = all ? list : list.slice(0, 8);
  return (
    <Panel title={t('interest.title')} right={list.length ? <span className="muted">{t('interest.count', { n: list.length })}</span> : undefined}>
      {mine && list.length > 0 && <div className="insight warn" style={{ marginBottom: 8 }}>{t('interest.mine', { n: list.length })}</div>}
      {onMine && <div className="muted" style={{ marginBottom: 6 }}>{t('interest.onYourList')}</div>}
      {list.length === 0 ? <div className="muted">{t('interest.none')}</div> : (
        <div className="interest-list">
          {shown.map((x) => (
            <span key={x.club} className="interest-club">
              <ClubLink id={x.club} />
              {x.human && <span className="muted"> · {t('interest.humanList', { name: x.human })}</span>}
            </span>
          ))}
          {!all && list.length > 8 && <button className="small" onClick={() => setAll(true)}>{t('interest.more', { n: list.length - 8 })}</button>}
        </div>
      )}
    </Panel>
  );
}

/** Problembarn/hidsig spiller: hvor langt rehabiliteringen er, og hvad der hjælper */
function ReformPanel({ pid }: { pid: number }) {
  const g = useGame()!;
  const p = g.players[pid];
  const fs = reformFactors(p, g.userClub);
  const sum = fs.reduce((s, f) => s + f.value, 0);
  const months = sum > 0 ? Math.ceil((100 - (p.reform ?? 0)) / sum) : null;
  return (
    <Panel title={t('reform.title')} right={<Info topic="chemistry" />}>
      <div className="row"><Bar value={p.reform ?? 0} max={100} /> <b>{Math.round(p.reform ?? 0)}%</b>
        <span className="muted">{months !== null ? t('reform.eta', { n: months }) : t('reform.stalled')}</span></div>
      <div className="row" style={{ marginTop: 8 }}>
        {fs.map((f) => <span key={f.key} className={`tag ${f.value > 0 ? 'good' : 'bad'}`}>{t(f.key)} {f.value > 0 ? '+' : ''}{f.value}</span>)}
        <span className="muted">{t('reform.perMonth', { n: sum })}</span>
      </div>
      <p className="muted" style={{ marginBottom: 0 }}>{t('reform.explain')}</p>
    </Panel>
  );
}

/** Samlet pris og risiko for et bud: hvad det højst kan koste, hvad sælgeren ser, og hvad der kan udløses senere */
function PriceRisk({ p, fee, sellOn, addOn, swapVal }: { p: { id: number }; fee: number; sellOn: number; addOn: number; swapVal: number }) {
  const g = useGame()!;
  const pl = g.players[p.id];
  const worth = fee + swapVal + bidClauseWorth(pl, fee, sellOn, addOn);
  const max = fee + addOn + swapVal;
  const risk = (addOn ? addOn / Math.max(1, fee) : 0) + sellOn / 100;
  const level = risk >= 0.45 ? 'high' : risk >= 0.15 ? 'mid' : 'low';
  return (
    <div className="price-risk">
      <div><span>{t('pr.max')}</span><b>{money(max)}</b></div>
      <div><span>{t('pr.sellerSees')}</span><b>{money(worth)}</b></div>
      <div><span>{t('pr.risk')}</span><b className={level === 'high' ? 'bad' : level === 'mid' ? 'warn' : 'good'}>{t(`pr.risk.${level}`)}</b></div>
      {(addOn > 0 || sellOn > 0) && <p className="muted">{[addOn ? t('pr.addOnNote', { fee: money(addOn) }) : '', sellOn ? t('pr.sellOnNote', { pct: sellOn }) : ''].filter(Boolean).join(' ')}</p>}
    </div>
  );
}
