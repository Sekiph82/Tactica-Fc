import { useMemo, useState } from 'react';
import { Select } from '../select';
import { Info } from '../help';
import { ATTRS, naturalRole } from '../../game/attributes';
import { ageOn } from '../../game/dates';
import { attrRange, knowledgeOf, scoutRecommendation, scoutStars } from '../../game/scouting';
import { traits, type Trait } from '../../game/personality';
import { regionOf, type Region } from '../../game/leagues';
import { playerInterest, transferRealism } from '../../game/transfers';
import { act } from '../../game/actions';
import { gs } from '../../game/state';
import { session } from '../../online/client';
import { AcceptCounterButton } from '../counterAccept';
import type { Player, PlayerMove, Role, TransferOffer } from '../../game/types';
import { dateFmt, money, t, natName } from '../../i18n';
import { ClubLink, Modal, Nat, Panel, PlayerLink, Stars, Table, Tabs, posStr, type Col } from '../components';
import { useGame, useNav, useRouteState } from '../core';
import { Head } from './common';
import type { RejectReason } from '../../game/will';
import { NegotiationModal } from './Negotiation';

const ROLES: (Role | '')[] = ['', 'GK', 'CB', 'FB', 'DM', 'CM', 'WM', 'AM', 'W', 'ST'];

export function Transfers({ tab: initial }: { tab?: string }) {
  const [tab, setTab] = useRouteState('tab', initial ?? 'search');
  const g = useGame()!;
  const pending = g.offers.filter((o) => o.status === 'pending' && o.seller === g.userClub).length;
  return (
    <div>
      <Head title={<>{t('nav.transfers')}<Info topic="transfers" /></>}>
        <Tabs tabs={[['search', t('tr.search')], ['shortlist', `${t('tr.shortlist')} (${g.shortlist.length})`], ['offers', `${t('tr.offers')}${pending ? ` (${pending})` : ''}`], ['deals', t('tr.deals')]]} value={tab} onChange={setTab} />
      </Head>
      {tab === 'search' && <Search />}
      {tab === 'shortlist' && <PlayerList players={g.shortlist.map((id) => g.players[id]).filter(Boolean)} />}
      {tab === 'offers' && <Offers />}
      {(tab === 'deals' || tab === 'listed') && <Deals />}
    </div>
  );
}

function RealismTag({ p }: { p: Player }) {
  const r = transferRealism(p);
  const cls = r.level === 0 ? 'good' : r.level === 1 ? 'warn' : 'bad';
  return <span className={`tag ${cls}`} title={r.reasons.map((k) => t(k)).join('\n')}>{t(`real.level${r.level}`)}</span>;
}

function PlayerList({ players, initialSort = 'val' }: { players: Player[]; initialSort?: string }) {
  const g = useGame()!;
  const { nav } = useNav();
  const cols: Col<Player>[] = [
    ...(g.userClub ? [{ key: 'real', label: t('real.col'), render: (p: Player) => <RealismTag p={p} />, sort: (p: Player) => { const r = transferRealism(p); return -r.level * 100 + r.score; }, title: t('real.hint') }] : []),
    { key: 'name', label: t('col.name'), render: (p) => <PlayerLink p={p} />, sort: (p) => p.last },
    { key: 'pos', label: t('col.pos'), render: (p) => posStr(p) },
    { key: 'age', label: t('col.age'), render: (p) => ageOn(p.dob, g.date), sort: (p) => ageOn(p.dob, g.date), className: 'num' },
    { key: 'nat', label: t('col.nat'), render: (p) => <Nat n={p.nation} /> },
    { key: 'club', label: t('col.club'), render: (p) => (p.club ? <ClubLink id={p.club} /> : <span className="muted">{t('common.free')}</span>) },
    { key: 'ab', label: t('player.ability'), render: (p) => <Stars range={scoutStars(p).ability} />, sort: (p) => { const s = scoutStars(p).ability; return s[0] * 10 + s[1]; } },
    { key: 'pot', label: t('player.potential'), render: (p) => <Stars range={scoutStars(p).potential} />, sort: (p) => { const s = scoutStars(p).potential; return s[0] * 10 + s[1]; } },
    { key: 'val', label: t('col.value'), render: (p) => money(p.value), sort: (p) => p.value, className: 'num' },
    { key: 'exp', label: t('col.expires'), render: (p) => (p.contract ? p.contract.expires.slice(0, 4) : '-'), sort: (p) => p.contract?.expires ?? '' },
    { key: 'k', label: t('tr.known'), render: (p) => `${Math.round(knowledgeOf(p))}%`, sort: (p) => knowledgeOf(p), className: 'num' },
  ];
  return <Table rows={players} cols={cols} rowKey={(p) => p.id} onRow={(p) => nav({ name: 'player', id: p.id })} initialSort={initialSort} limit={250} />;
}

/** Søgefelter: alle gemmes på ruten, så de huskes når man går tilbage */
const DEFAULTS = {
  name: '', role: '' as Role | '', minAge: 15, maxAge: 40, minValue: 0, maxValue: 0, maxWage: 0, nation: -1, league: '', tier: 0, region: '',
  onlyFree: false, onlyListed: false, expiring: false, onlyKnown: false, realism: 0, minAbility: 0, minPotential: 0,
  attr1: -1, attr1Min: 12, attr2: -1, attr2Min: 12, attr3: -1, attr3Min: 12, foot: '', minHeight: 0, contractBy: 0,
  trait: '', noTrouble: false, rec: -1, interested: false, noInjured: false, notLoaned: false, shortlist: false,
};
type Filters = typeof DEFAULTS;
const FILTER_KEY = 'cm0102.transferFilters';
/** Filtrene huskes pr. karriere – en ny karriere starter med rene filtre (man kan hente dem fra den forrige) */
const filterKey = () => `${FILTER_KEY}:${gs().id}`;
function loadFilters(): Partial<Filters> & { __more?: boolean } {
  try { return JSON.parse(localStorage.getItem(filterKey()) ?? '{}'); } catch { return {}; }
}
function saveFilters(v: Filters & { __more?: boolean }) {
  try { localStorage.setItem(filterKey(), JSON.stringify(v)); localStorage.setItem(FILTER_KEY, JSON.stringify(v)); } catch { /* ignorer */ }
}
/** Filtrene fra den senest brugte karriere (til knappen "Brug filtre fra sidste karriere") */
function lastCareerFilters(): (Partial<Filters> & { __more?: boolean }) | null {
  try {
    if (localStorage.getItem(filterKey())) return null;
    const v = JSON.parse(localStorage.getItem(FILTER_KEY) ?? 'null');
    return v && Object.keys(v).some((k) => k !== '__more' && (v as Record<string, unknown>)[k] !== (DEFAULTS as Record<string, unknown>)[k]) ? v : null;
  } catch { return null; }
}

function Search() {
  const g = useGame()!;
  // filtrene huskes på tværs af besøg (gemt i browseren), indtil man trykker Nulstil
  const [f, setFRoute] = useRouteState<Filters>('filters', () => ({ ...DEFAULTS, ...loadFilters() }));
  const [more, setMoreRoute] = useRouteState('more', () => loadFilters().__more === true);
  const setF = (v: Filters) => { setFRoute(v); saveFilters({ ...v, __more: more }); };
  const setMore = (v: boolean) => { setMoreRoute(v); saveFilters({ ...f, __more: v }); };
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF({ ...f, [k]: v });
  const nations = useMemo(() => [...new Set(Object.values(g.players).map((p) => p.nation))].sort((a, b) => natName(g.nations[a].name).localeCompare(natName(g.nations[b].name))), [g]);
  const seasonEnd = `${Number(g.date.slice(0, 4)) + (Number(g.date.slice(5, 7)) >= 7 ? 1 : 0)}-06-30`;
  const me = g.clubs[g.userClub];
  const [prevFilters, setPrevFilters] = useState(lastCareerFilters);
  const active = (Object.keys(DEFAULTS) as (keyof Filters)[]).filter((k) => k !== 'attr1Min' && k !== 'attr2Min' && k !== 'attr3Min' && f[k] !== DEFAULTS[k]).length;
  const results = useMemo(() => {
    const q = f.name.trim().toLowerCase();
    const attrs = ([[f.attr1, f.attr1Min], [f.attr2, f.attr2Min], [f.attr3, f.attr3Min]] as [number, number][]).filter(([a]) => a >= 0);
    const out: Player[] = [];
    for (const p of Object.values(g.players)) {
      if (p.club === g.userClub) continue;
      if (q && !`${p.first} ${p.last}`.toLowerCase().includes(q)) continue;
      const a = ageOn(p.dob, g.date);
      if (a < f.minAge || a > f.maxAge) continue;
      if (f.maxValue && p.value > f.maxValue) continue;
      if (f.minValue && p.value < f.minValue) continue;
      if (f.maxWage && (p.contract?.wage ?? 0) > f.maxWage) continue;
      if (f.nation >= 0 && p.nation !== f.nation) continue;
      const club = g.clubs[p.club];
      if (f.league && club?.league !== f.league) continue;
      if (f.tier && (g.leagues[club?.league ?? '']?.tier ?? 0) !== f.tier) continue;
      if (f.region && (!club || regionOf(g.nations[club.nation]?.name) !== f.region)) continue;
      // tilgængelighed (klubløs / til salg / udløbende kontrakt) lægges sammen: mindst én af de valgte
      if (f.onlyFree || f.onlyListed || f.expiring) {
        const free = !p.club, listed = !!p.listed, exp = !!p.contract && p.contract.expires <= seasonEnd;
        if (!((f.onlyFree && free) || (f.onlyListed && listed) || (f.expiring && exp))) continue;
      }
      if (f.contractBy && (!p.contract || Number(p.contract.expires.slice(0, 4)) > f.contractBy)) continue;
      if (f.onlyKnown && knowledgeOf(p) < 50) continue;
      if (f.role && naturalRole(p) !== f.role) continue;
      if (f.foot && p.foot !== f.foot && p.foot !== 'B') continue;
      if (f.minHeight && p.height < f.minHeight) continue;
      if (f.noInjured && p.injury) continue;
      if (f.notLoaned && p.loan) continue;
      if (f.shortlist && !g.shortlist.includes(p.id)) continue;
      if (f.minAbility || f.minPotential) {
        const st = scoutStars(p);
        if (f.minAbility && (st.ability[0] + st.ability[1]) / 2 < f.minAbility) continue;
        if (f.minPotential && (st.potential[0] + st.potential[1]) / 2 < f.minPotential) continue;
      }
      // attributkrav – med skjulte evner bruges scoutens skøn (midten af intervallet)
      if (attrs.some(([idx, min]) => { const [lo, hi] = attrRange(p, idx); return (lo + hi) / 2 < min; })) continue;
      if (f.trait || f.noTrouble) {
        if (knowledgeOf(p) < 50) continue; // personligheden kendes kun for afdækkede spillere
        const tr = traits(p);
        if (f.trait && !tr.includes(f.trait as Trait)) continue;
        if (f.noTrouble && (tr.includes('troublemaker') || tr.includes('lazy'))) continue;
      }
      if (f.rec >= 0) { const r = scoutRecommendation(p); if (r.level < 0 || r.level > f.rec) continue; }
      if (f.interested && me && playerInterest(p, me) !== 'yes') continue;
      if (f.realism) {
        const r = transferRealism(p);
        if (r.level > (f.realism === 1 ? 0 : 1)) continue;
      }
      // ingen grænse her: alle matchende spillere sorteres, før listen vises (ellers manglede de bedste)
      out.push(p);
    }
    return out;
  }, [g, f, seasonEnd, me]);
  const groupOf = (i: number) => t(i <= 13 ? 'group.technical' : i <= 24 ? 'group.mental' : i <= 32 ? 'group.physical' : 'group.goalkeeping');
  const attrOptions = ATTRS.slice(0, 36).map((k, i) => ({ value: i, label: t(`attr.${k}`), group: groupOf(i) }))
    .sort((a, b) => a.value - b.value).sort((a, b) => (a.group === b.group ? a.label.localeCompare(b.label) : 0));
  const attrRow = (n: 1 | 2 | 3) => {
    const ak = `attr${n}` as 'attr1', mk = `attr${n}Min` as 'attr1Min';
    return (
      <label className="row" key={n}>
        <Select value={f[ak]} onChange={(v) => set(ak, v)} width={170} options={[{ value: -1, label: t('tr.f.attr') }, ...attrOptions]} />
        {f[ak] >= 0 && <>≥ <input type="number" min={1} max={20} value={f[mk]} onChange={(e) => set(mk, Number(e.target.value))} style={{ width: 52 }} /></>}
      </label>
    );
  };
  const stars = [0, 1, 2, 3, 4, 5];
  return (
    <div>
      <Panel title={t('tr.filters')} right={<div className="row">
        {active > 0 && <span className="tag">{t('tr.f.active', { n: active })}</span>}
        <button className="small" onClick={() => setMore(!more)}>{more ? t('tr.f.less') : t('tr.f.more')}</button>
        {active > 0 && <button className="small" onClick={() => setF({ ...DEFAULTS })}>{t('tr.f.reset')}</button>}
      </div>}>
        <div className="row filter-row">
          <input placeholder={t('tr.name')} value={f.name} onChange={(e) => set('name', e.target.value)} />
          <select value={f.role} onChange={(e) => set('role', e.target.value as Role | '')}>{ROLES.map((r) => <option key={r} value={r}>{r ? t(`role.${r}`) : t('tr.anyPos')}</option>)}</select>
          <label>{t('col.age')} <input type="number" value={f.minAge} onChange={(e) => set('minAge', Number(e.target.value))} style={{ width: 50 }} />–<input type="number" value={f.maxAge} onChange={(e) => set('maxAge', Number(e.target.value))} style={{ width: 50 }} /></label>
          <select value={f.maxValue} onChange={(e) => set('maxValue', Number(e.target.value))}>
            <option value={0}>{t('tr.anyValue')}</option>
            {[250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000].map((v) => <option key={v} value={v}>≤ {money(v)}</option>)}
          </select>
          <Select value={f.nation} onChange={(v) => set('nation', v)} width={190}
            options={[{ value: -1, label: t('tr.anyNation') }, ...nations.map((n) => ({ value: n, label: natName(g.nations[n].name), flag: g.nations[n].name, hint: g.nations[n].code }))]} />
          <Select value={f.league} onChange={(v) => set('league', v)} width={230}
            options={[{ value: '', label: t('tr.anyLeague') }, ...g.leagueOrder.filter((l) => g.leagues[l]).map((l) => ({ value: l, label: g.leagues[l].name, group: g.nations[g.leagues[l].nation]?.name }))]} />
        </div>
        <div className="row filter-row" style={{ marginTop: 6 }}>
          {g.userClub > 0 && (
            <select value={f.realism} onChange={(e) => set('realism', Number(e.target.value))} title={t('real.hint')}>
              <option value={0}>{t('real.all')}</option>
              <option value={1}>{t('real.only')}</option>
              <option value={2}>{t('real.maybe')}</option>
            </select>
          )}
          <label className="row"><input type="checkbox" checked={f.onlyFree} onChange={(e) => set('onlyFree', e.target.checked)} />{t('tr.free')}</label>
          <label className="row"><input type="checkbox" checked={f.onlyListed} onChange={(e) => set('onlyListed', e.target.checked)} />{t('tr.listedOnly')}</label>
          <label className="row"><input type="checkbox" checked={f.expiring} onChange={(e) => set('expiring', e.target.checked)} />{t('tr.expiring')}</label>
          {g.options.masking && <label className="row"><input type="checkbox" checked={f.onlyKnown} onChange={(e) => set('onlyKnown', e.target.checked)} />{t('tr.knownOnly')}</label>}
          <span className="muted">{results.length.toLocaleString()} {t('tr.results')}</span>
        </div>
        {more && (
          <div className="filter-more">
            <div className="filter-group">
              <h4>{t('tr.f.ability')}</h4>
              <label className="row">{t('player.ability')} ≥ <select value={f.minAbility} onChange={(e) => set('minAbility', Number(e.target.value))}>{stars.map((n) => <option key={n} value={n}>{n ? '★'.repeat(n) : t('tr.f.any')}</option>)}</select></label>
              <label className="row">{t('player.potential')} ≥ <select value={f.minPotential} onChange={(e) => set('minPotential', Number(e.target.value))}>{stars.map((n) => <option key={n} value={n}>{n ? '★'.repeat(n) : t('tr.f.any')}</option>)}</select></label>
              {attrRow(1)}{attrRow(2)}{attrRow(3)}
              {g.options.masking && <div className="muted" style={{ fontSize: 11.5 }}>{t('tr.f.attrHint')}</div>}
            </div>
            <div className="filter-group">
              <h4>{t('tr.f.money')}</h4>
              <label className="row">{t('tr.f.minValue')} <select value={f.minValue} onChange={(e) => set('minValue', Number(e.target.value))}>
                <option value={0}>{t('tr.f.any')}</option>
                {[250_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000, 25_000_000].map((v) => <option key={v} value={v}>≥ {money(v)}</option>)}
              </select></label>
              <label className="row">{t('tr.f.maxWage')} <select value={f.maxWage} onChange={(e) => set('maxWage', Number(e.target.value))}>
                <option value={0}>{t('tr.f.any')}</option>
                {[2_000, 5_000, 10_000, 25_000, 50_000, 100_000, 200_000].map((v) => <option key={v} value={v}>≤ {money(v)} / {t('common.week')}</option>)}
              </select></label>
              <label className="row">{t('tr.f.contractBy')} <select value={f.contractBy} onChange={(e) => set('contractBy', Number(e.target.value))}>
                <option value={0}>{t('tr.f.any')}</option>
                {[0, 1, 2].map((d) => { const y = Number(seasonEnd.slice(0, 4)) + d; return <option key={y} value={y}>≤ {y}</option>; })}
              </select></label>
              <label className="row"><input type="checkbox" checked={f.interested} onChange={(e) => set('interested', e.target.checked)} />{t('tr.f.interested')}</label>
              <label className="row"><input type="checkbox" checked={f.notLoaned} onChange={(e) => set('notLoaned', e.target.checked)} />{t('tr.f.notLoaned')}</label>
            </div>
            <div className="filter-group">
              <h4>{t('tr.f.player')}</h4>
              <label className="row">{t('tr.f.foot')} <select value={f.foot} onChange={(e) => set('foot', e.target.value)}>
                <option value="">{t('tr.f.any')}</option><option value="L">{t('tr.f.left')}</option><option value="R">{t('tr.f.right')}</option>
              </select></label>
              <label className="row">{t('tr.f.height')} ≥ <select value={f.minHeight} onChange={(e) => set('minHeight', Number(e.target.value))}>
                <option value={0}>{t('tr.f.any')}</option>{[175, 180, 185, 190].map((h) => <option key={h} value={h}>{h} cm</option>)}
              </select></label>
              <label className="row">{t('tr.f.trait')} <select value={f.trait} onChange={(e) => set('trait', e.target.value)}>
                <option value="">{t('tr.f.any')}</option>{(['leader', 'professional', 'bigGame', 'loyal', 'ambitious'] as Trait[]).map((x) => <option key={x} value={x}>{t(`trait.${x}`)}</option>)}
              </select></label>
              <label className="row"><input type="checkbox" checked={f.noTrouble} onChange={(e) => set('noTrouble', e.target.checked)} />{t('tr.f.noTrouble')}</label>
              <label className="row"><input type="checkbox" checked={f.noInjured} onChange={(e) => set('noInjured', e.target.checked)} />{t('tr.f.noInjured')}</label>
            </div>
            <div className="filter-group">
              <h4>{t('tr.f.where')}</h4>
              <label className="row">{t('tr.f.tier')} <select value={f.tier} onChange={(e) => set('tier', Number(e.target.value))}>
                <option value={0}>{t('tr.f.any')}</option><option value={1}>{t('tr.f.tier1')}</option><option value={2}>{t('tr.f.tier2')}</option>
              </select></label>
              <label className="row">{t('tr.f.region')} <select value={f.region} onChange={(e) => set('region', e.target.value)}>
                <option value="">{t('tr.f.any')}</option>{(['europe', 'northAmerica', 'southAmerica', 'asia', 'africa'] as Region[]).map((r) => <option key={r} value={r}>{t(`region.${r}`)}</option>)}
              </select></label>
              <label className="row">{t('rec.col')} <select value={f.rec} onChange={(e) => set('rec', Number(e.target.value))}>
                <option value={-1}>{t('tr.f.any')}</option>{[0, 1, 2].map((l) => <option key={l} value={l}>≥ {t(`rec.short.l${l}`)}</option>)}
              </select></label>
              <label className="row"><input type="checkbox" checked={f.shortlist} onChange={(e) => set('shortlist', e.target.checked)} />{t('tr.f.shortlist')}</label>
            </div>
          </div>
        )}
      </Panel>
      {prevFilters && (
        <div className="insight row" style={{ flexWrap: 'wrap' }}>
          <span className="grow">{t('tr.prevFilters')}</span>
          <button className="small" onClick={() => { setF({ ...DEFAULTS, ...prevFilters }); setPrevFilters(null); }}>{t('tr.usePrev')}</button>
          <button className="small" onClick={() => setPrevFilters(null)}>{t('common.close')}</button>
        </div>
      )}
      {results.length === 0 && f.realism > 0 ? (
        <div className="insight warn row" style={{ flexWrap: 'wrap' }}>
          <span className="grow">{t(f.realism === 1 ? 'tr.noRealistic' : 'tr.noRealisticMaybe', { fee: money(me?.transferBudget ?? 0) })}</span>
          {f.realism === 1 && <button className="small" onClick={() => set('realism', 2)}>{t('tr.showMaybe')}</button>}
          <button className="small" onClick={() => set('realism', 0)}>{t('tr.showAll')}</button>
        </div>
      ) : (
      <PlayerList players={results} initialSort={f.realism ? 'real' : 'val'} />
      )}
    </div>
  );
}

/** "+ Navn, Navn" for byttespillere i et bud */
function swapLabel(o: TransferOffer) {
  if (!o.swap?.length) return null;
  const g = gs();
  return <div className="muted" style={{ fontSize: 12 }}>{t('swap.plus', { names: o.swap.map((id) => g.players[id]?.last ?? '?').join(', ') })}</div>;
}

function Offers() {
  const g = useGame()!;
  const [neg, setNeg] = useState<TransferOffer | null>(null);
  const [counterFor, setCounterFor] = useState<TransferOffer | null>(null);
  const [rejectFor, setRejectFor] = useState<TransferOffer | null>(null);
  const [reply, setReply] = useState<{ key: string; tone: string; player: string; club: string } | null>(null);
  // aktive bud (som kræver handling) øverst, derefter historik – nyeste først
  const active = (o: TransferOffer) => (['pending', 'countered', 'negotiating'].includes(o.status) ? 0 : 1);
  const order = (list: TransferOffer[]) => list.slice().reverse().sort((a, b) => active(a) - active(b));
  const incoming = order(g.offers.filter((o) => o.seller === g.userClub && o.buyer !== g.userClub));
  const outgoing = order(g.offers.filter((o) => o.buyer === g.userClub));
  const status = (o: TransferOffer) => <><span className={`tag ${o.status === 'completed' ? 'good' : ['rejected', 'collapsed', 'withdrawn'].includes(o.status) ? 'bad' : 'warn'}`}>{t(o.outbid ? 'offer.outbid' : `offer.${o.status}`)}</span>{o.auction && o.status === 'pending' && <span className="tag" title={t('auction.hint')}>{t('auction.tag')}</span>}</>;
  return (
    <div className="cols-wide">
      {reply && <div className={`insight ${reply.tone}`} style={{ gridColumn: '1 / -1' }}>{t(reply.key, { player: reply.player, club: reply.club })}</div>}
      <Panel title={t('tr.incoming')} className="flush">
        <div className="table-wrap">
        <table className="grid">
          <tbody>
            {incoming.length === 0 && <tr><td className="muted">{t('common.none')}</td></tr>}
            {incoming.map((o) => (
              <tr key={o.id}>
                <td><PlayerLink p={g.players[o.player]} /></td>
                <td><ClubLink id={o.buyer} /></td>
                <td className="num">{o.loan ? (o.option ? t('tr.loanOption', { fee: money(o.option) }) : `${t('tr.loan')}${g.players[o.player]?.loan?.share !== undefined ? ` (${Math.round((g.players[o.player].loan!.share ?? 1) * 100)}%)` : ''}`) : money(o.fee)}{swapLabel(o)}</td>
                <td>{status(o)}{o.priceRounds ? <span className="tag">{t('offer.round', { n: o.priceRounds })}</span> : null}{g.players[o.player]?.listPrice ? <div className="muted">{t('list.price')}: {money(g.players[o.player].listPrice!)}</div> : null}</td>
                <td className="actions">
                  {o.status === 'pending' && (
                    <div className="row">
                      <button className="small primary" onClick={() => act({ t: 'respond', pid: o.player, buyer: o.buyer, action: 'accept' })}>{t('offer.accept')}</button>
                      <button className="small" onClick={() => setRejectFor(o)}>{t('offer.reject')}</button>
                      <button className="small" onClick={() => setCounterFor(o)}>{t('offer.counter')}…</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Panel>
      <Panel title={t('tr.outgoing')} className="flush" style={outgoing.some((o) => !active(o)) && !incoming.some((o) => !active(o)) ? { order: -1 } : undefined}>
        <div className="table-wrap">
        <table className="grid">
          <tbody>
            {outgoing.length === 0 && <tr><td className="muted">{t('common.none')}</td></tr>}
            {outgoing.map((o) => (
              <tr key={o.id}>
                <td><PlayerLink p={g.players[o.player]} /></td>
                <td>{o.seller ? <ClubLink id={o.seller} /> : t('common.free')}</td>
                <td className="num">{o.loan ? t('tr.loan') : o.preContract ? t('neg.bosman') : money(o.fee)}{swapLabel(o)}{o.counter && o.status === 'countered' ? ` → ${money(o.counter)}` : ''}</td>
                <td className="nowrap">{status(o)} <span className="muted">{dateFmt(o.created)}</span>
                  {o.status === 'pending' && <div className="muted" style={{ fontSize: 12 }}>{t(session() ? 'offer.answerByOnline' : 'offer.answerBy', { date: dateFmt(o.respondBy) })}</div>}{o.rival && active(o) === 0 && <div className="bad" style={{ fontSize: 12 }}>{t('tr.rival', { club: g.clubs[o.rival.club]?.name ?? '?', fee: money(o.rival.fee) })}</div>}</td>
                <td className="actions">
                  {o.status === 'negotiating' && <button className="small primary" onClick={() => setNeg(o)}>{t('offer.negotiate')}</button>}
                  {o.status === 'countered' && <AcceptCounterButton o={o} onOk={() => setNeg(o)} />}
                  {['pending', 'countered', 'negotiating'].includes(o.status) && <button className="small" onClick={() => act({ t: 'withdraw', pid: o.player })}>{t('offer.withdraw')}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Panel>
      {neg && <NegotiationModal offer={neg} onClose={() => setNeg(null)} />}
      {counterFor && <CounterModal offer={counterFor} onClose={() => setCounterFor(null)} />}
      {rejectFor && <RejectModal offer={rejectFor} onClose={() => setRejectFor(null)} onReply={(key) => {
        const p = g.players[rejectFor.player];
        setReply(key ? { key, tone: key.endsWith('.2') ? 'good' : key.endsWith('.0') ? 'bad' : '', player: p ? `${p.first} ${p.last}` : '', club: g.clubs[rejectFor.buyer]?.name ?? '' } : null);
        setRejectFor(null);
      }} />}
    </div>
  );
}

/** Aktive bud på én af mine spillere – samme svarmuligheder som under Transfers → Bud (bruges på spillersiden) */
export function IncomingOffersFor({ pid }: { pid: number }) {
  const g = useGame()!;
  const [counterFor, setCounterFor] = useState<TransferOffer | null>(null);
  const [rejectFor, setRejectFor] = useState<TransferOffer | null>(null);
  const [reply, setReply] = useState<{ key: string; tone: string } | null>(null);
  const offers = g.offers.filter((o) => o.player === pid && o.seller === g.userClub && o.buyer !== g.userClub && o.status === 'pending');
  const p = g.players[pid];
  if (!offers.length && !reply) return null;
  return (
    <Panel title={t('tr.bidsOnPlayer', { n: offers.length })} className="flush offers-on-player">
      {reply && <div className={`insight ${reply.tone}`} style={{ margin: 10 }}>{t(reply.key, { player: p ? `${p.first} ${p.last}` : '', club: '' })}</div>}
      <div className="table-wrap">
        <table className="grid">
          <tbody>
            {offers.map((o) => (
              <tr key={o.id}>
                <td><ClubLink id={o.buyer} /></td>
                <td className="num"><b>{o.loan ? (o.option ? t('tr.loanOption', { fee: money(o.option) }) : t('tr.loan')) : money(o.fee)}</b>{swapLabel(o)}</td>
                <td className="muted">{p?.listPrice ? `${t('list.price')}: ${money(p.listPrice)}` : t('tr.value', { fee: money(p?.value ?? 0) })}</td>
                <td className="actions">
                  <div className="row">
                    <button className="small primary" onClick={() => act({ t: 'respond', pid: o.player, buyer: o.buyer, action: 'accept' })}>{t('offer.accept')}</button>
                    <button className="small" onClick={() => setRejectFor(o)}>{t('offer.reject')}</button>
                    <button className="small" onClick={() => setCounterFor(o)}>{t('offer.counter')}…</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {counterFor && <CounterModal offer={counterFor} onClose={() => setCounterFor(null)} />}
      {rejectFor && <RejectModal offer={rejectFor} onClose={() => setRejectFor(null)} onReply={(key) => {
        setReply(key ? { key, tone: key.endsWith('.2') ? 'good' : key.endsWith('.0') ? 'bad' : '' } : null);
        setRejectFor(null);
      }} />}
    </Panel>
  );
}

/** Afvis et bud – evt. med en begrundelse til spilleren */
function RejectModal({ offer, onClose, onReply }: { offer: TransferOffer; onClose: () => void; onReply: (key: string | null) => void }) {
  const g = useGame()!;
  const p = g.players[offer.player];
  const [reason, setReason] = useState<RejectReason>(p && ageOn(p.dob, g.date) <= 23 ? 'future' : 'key');
  const name = p ? `${p.first} ${p.last}` : '';
  return (
    <Modal title={t('reject.title', { player: name })} onClose={onClose}>
      <div className="col">
        <div className="muted">{t('reject.ask', { player: name })}</div>
        {([...(p && ageOn(p.dob, g.date) <= 23 ? ['future'] : []), 'key', 'low', 'contract', 'none'] as RejectReason[]).map((r) => (
          <label key={r} className="row"><input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} /> {t(`reject.reason.${r}`)}</label>
        ))}
        {reason === 'contract' && <div className="muted" style={{ fontSize: 12 }}>{t('reject.contractHint')}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={onClose}>{t('common.cancel')}</button>
          <button className="primary" onClick={() => {
            const r = act<string>({ t: 'respond', pid: offer.player, buyer: offer.buyer, action: 'reject', reason });
            onReply(r && r.startsWith('reject.r.') ? r : null);
          }}>{t('reject.submit')}</button>
        </div>
      </div>
    </Modal>
  );
}

/** Modbud med skyder – samme princip som udbudsprisen */
function CounterModal({ offer, onClose }: { offer: TransferOffer; onClose: () => void }) {
  const g = useGame()!;
  const p = g.players[offer.player];
  const buyer = g.clubs[offer.buyer];
  const [pct, setPct] = useState(130);
  const [sellOn, setSellOn] = useState(0);
  const amount = Math.max(offer.fee + 10_000, Math.round((offer.fee * pct) / 100 / 10_000) * 10_000);
  const vsValue = amount / Math.max(1, p.value);
  const hint = pct <= 115 ? 'counter.hintSmall' : pct <= 150 ? 'counter.hintFair' : pct <= 200 ? 'counter.hintBold' : 'counter.hintRisky';
  return (
    <Modal title={t('counter.title', { player: `${p.first} ${p.last}`, club: buyer.name })} onClose={onClose}>
      <div className="col">
        <div className="kv">
          <span>{t('counter.theirBid')}</span><span>{money(offer.fee)}</span>
          <span>{t('col.value')}</span><span>{money(p.value)}</span>
          {p.listPrice && <><span>{t('list.price')}</span><span>{money(p.listPrice)}</span></>}
          {offer.priceRounds ? <><span>{t('counter.rounds')}</span><span>{offer.priceRounds} / 3</span></> : null}
        </div>
        <label>{t('counter.yourDemand')}: <b className="accent">{money(amount)}</b> ({pct}% {t('counter.ofBid')}, {Math.round(vsValue * 100)}% {t('list.ofValue')})
          <input type="range" min={105} max={300} step={5} value={pct} onChange={(e) => setPct(Number(e.target.value))} style={{ width: '100%' }} />
        </label>
        <div className="row">{[110, 125, 150, 200].map((v) => <button key={v} className={`small ${pct === v ? 'primary' : ''}`} onClick={() => setPct(v)}>+{v - 100}%</button>)}</div>
        <div className={`insight ${pct > 200 ? 'bad' : pct <= 150 ? 'good' : 'warn'}`}>{t(hint)}</div>
        <div className="row">{t('clause.sellOnAsk')}: {[0, 10, 15, 20, 30].map((v) => <button key={v} className={`small ${sellOn === v ? 'primary' : ''}`} onClick={() => setSellOn(v)}>{v ? `${v}%` : t('common.none')}</button>)}</div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={onClose}>{t('common.cancel')}</button>
          <button className="primary" onClick={() => { act({ t: 'respond', pid: offer.player, buyer: offer.buyer, action: 'counter', counter: amount, sellOn: sellOn || undefined }); onClose(); }}>{t('counter.send')}</button>
        </div>
      </div>
    </Modal>
  );
}

/** Alle gennemførte handler: hvem skiftede hvorhen og for hvor meget (nyeste først) */
function Deals() {
  const g = useGame()!;
  const me = g.clubs[g.userClub];
  const [scope, setScope] = useRouteState<'league' | 'nation' | 'world' | 'mine'>('dealScope', 'league');
  const [kind, setKind] = useRouteState<'all' | 'buy' | 'loan' | 'free'>('dealKind', 'all');
  const [season, setSeason] = useRouteState<number>('dealSeason', g.season);
  const rows = useMemo(() => {
    const out: { p: Player; m: PlayerMove }[] = [];
    for (const p of Object.values(g.players)) {
      for (const m of p.moves ?? []) {
        if (m.season !== season) continue;
        const from = g.clubs[m.from], to = g.clubs[m.to];
        if (scope === 'mine' && m.from !== g.userClub && m.to !== g.userClub) continue;
        if (scope === 'league' && me && from?.league !== me.league && to?.league !== me.league) continue;
        if (scope === 'nation' && me && from?.nation !== me.nation && to?.nation !== me.nation) continue;
        if (kind === 'loan' && !m.loan) continue;
        if (kind === 'buy' && (m.loan || !m.fee)) continue;
        if (kind === 'free' && (m.loan || m.fee)) continue;
        out.push({ p, m });
      }
    }
    return out.sort((a, b) => b.m.date.localeCompare(a.m.date) || b.m.fee - a.m.fee);
  }, [g, scope, kind, season]);
  const total = rows.filter((r) => !r.m.loan).reduce((s, r) => s + r.m.fee, 0);
  const cols: Col<{ p: Player; m: PlayerMove }>[] = [
    { key: 'date', label: t('deal.date'), render: (r) => dateFmt(r.m.date), sort: (r) => r.m.date },
    { key: 'name', label: t('col.name'), render: (r) => <PlayerLink p={r.p} />, sort: (r) => r.p.last },
    { key: 'pos', label: t('col.pos'), render: (r) => posStr(r.p) },
    { key: 'nat', label: t('col.nat'), render: (r) => <Nat n={r.p.nation} /> },
    { key: 'from', label: t('deal.from'), render: (r) => (r.m.from ? <ClubLink id={r.m.from} /> : <span className="muted">{t('common.free')}</span>) },
    { key: 'to', label: t('deal.to'), render: (r) => <ClubLink id={r.m.to} /> },
    { key: 'fee', label: t('deal.fee'), className: 'num', render: (r) => (r.m.loan ? <span className="tag">{t('tr.loan')}</span> : r.m.fee ? <b>{money(r.m.fee)}</b> : <span className="muted">{t('transfer.digestFree')}</span>), sort: (r) => (r.m.loan ? -1 : r.m.fee) },
  ];
  return (
    <div>
      <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div className="seg">{(['mine', 'league', 'nation', 'world'] as const).map((k) => <button key={k} className={scope === k ? 'on' : ''} onClick={() => setScope(k)}>{t(`deal.scope.${k}`)}</button>)}</div>
        <div className="seg">{(['all', 'buy', 'free', 'loan'] as const).map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{t(`deal.kind.${k}`)}</button>)}</div>
        <select value={season} onChange={(e) => setSeason(Number(e.target.value))}>
          {[g.season, g.season - 1, g.season - 2].map((y) => <option key={y} value={y}>{y}/{String(y + 1).slice(2)}</option>)}
        </select>
        <span className="muted">{t('deal.count', { n: rows.length, fee: money(total) })}</span>
      </div>
      <Panel className="flush">
        <Table rows={rows} cols={cols} rowKey={(r) => `${r.p.id}-${r.m.date}-${r.m.to}`} initialSort="date" limit={400} />
      </Panel>
    </div>
  );
}
