import { useMemo, useState } from 'react';
import { MAX_TRIALS } from '../../game/trials';
import { transferRealism } from '../../game/transfers';
import { Info } from '../help';
import { Select } from '../select';
import { act } from '../../game/actions';
import { dateFmt, money, t, natName } from '../../i18n';
import { scoutRecommendation, scoutStars } from '../../game/scouting';
import { addDays, ageOn } from '../../game/dates';
import type { Role, ScoutAssignment, Staff } from '../../game/types';
import { ATTRS } from '../../game/attributes';
import { ClubLink, Panel, PlayerLink, RecTag, Stars, posStr } from '../components';
import { useGame, useRouteState } from '../core';
import { Head } from './common';

export function Scouting() {
  const g = useGame()!;
  const scouts = Object.values(g.staff).filter((s) => s.club === g.userClub && s.role === 'scout');
  const nations = useMemo(() => [...new Set(Object.values(g.clubs).map((c) => c.nation))].sort((a, b) => natName(g.nations[a].name).localeCompare(natName(g.nations[b].name))), [g]);
  const known = Object.values(g.knowledge).filter((k) => k >= 80).length;
  return (
    <div>
      <Head title={<>{t('nav.scouting')}<Info topic="scouting" /></>} />
      {!g.options.masking && <div className="insight">{t('scout.maskingOff')}</div>}
      <div className="cols">
        <Panel title={t('scout.overview')}>
          <div className="kv">
            <span>{t('scout.scouts')}</span><span>{scouts.length}</span>
            <span>{t('scout.wellKnown')}</span><span>{known}</span>
          </div>
          <p className="muted">{t('scout.explain')}</p>
        </Panel>
      </div>
      <TrialsPanel />
      <Panel title={t('scout.assignments')} className="flush">
        <table className="grid">
          <thead><tr><th>{t('col.name')}</th><th>{t('scout.assignment')}</th></tr></thead>
          <tbody>
            {scouts.map((s) => <ScoutRow key={s.id} s={s} nations={nations} />)}
            {scouts.length === 0 && <tr><td colSpan={2} className="muted">{t('scout.none')}</td></tr>}
          </tbody>
        </table>
      </Panel>
      <Panel title={t('scout.found')} right={<span className="muted">{t('scout.foundHint')}</span>} className="flush">
        <ScoutFinds />
      </Panel>
    </div>
  );
}

function ScoutFinds() {
  const g = useGame()!;
  const finds = g.scoutFinds ?? {};
  const [onlyFinds, setOnlyFinds] = useRouteState('onlyFinds', true);
  const [showUnreal, setShowUnreal] = useRouteState('showUnreal', false);
  const rows = Object.entries(g.knowledge)
    .filter(([id, k]) => k >= 60 && g.players[Number(id)] && g.players[Number(id)].club !== g.userClub && (!onlyFinds || finds[Number(id)]))
    // urealistiske fund skjules som standard (fx gamle fund fra før, eller spillere der er blevet for dyre)
    .filter(([id]) => showUnreal || transferRealism(g.players[Number(id)]).level < 2)
    .map(([id]) => g.players[Number(id)])
    .map((p) => ({ p, st: scoutStars(p), found: finds[p.id] ?? '' }))
    .sort((a, b) => b.found.localeCompare(a.found) || b.st.potential[0] + b.st.ability[0] - (a.st.potential[0] + a.st.ability[0]))
    .slice(0, 80);
  const recent = addDays(g.date, -14);
  const toggle = (
    <div className="row" style={{ padding: '10px 14px', gap: 18, flexWrap: 'wrap' }}>
      <label className="row"><input type="checkbox" checked={onlyFinds} onChange={(e) => setOnlyFinds(e.target.checked)} />{t('scout.onlyFinds')}</label>
      <label className="row"><input type="checkbox" checked={showUnreal} onChange={(e) => setShowUnreal(e.target.checked)} />{t('scout.showUnreal')}</label>
    </div>
  );
  if (!rows.length) return <>{toggle}<div className="empty">{t('scout.noFinds')}</div></>;
  return (
    <>
    {toggle}
    <table className="grid">
      <thead><tr><th>{t('scout.foundDate')}</th><th>{t('col.name')}</th><th>{t('col.pos')}</th><th className="num">{t('col.age')}</th><th>{t('col.club')}</th><th>{t('player.ability')}</th><th>{t('player.potential')}</th><th>{t('rec.col')}</th><th className="num">{t('col.value')}</th></tr></thead>
      <tbody>
        {rows.map(({ p, st, found }) => (
          <tr key={p.id}>
            <td className="muted">{found ? dateFmt(found) : '–'}{found >= recent && <span className="tag good">{t('scout.new')}</span>}</td>
            <td><PlayerLink p={p} /></td>
            <td>{posStr(p)}</td>
            <td className="num">{ageOn(p.dob, g.date)}</td>
            <td>{p.club ? <ClubLink id={p.club} /> : t('common.free')}</td>
            <td><Stars range={st.ability} /></td>
            <td><Stars range={st.potential} /></td>
            <td>{(() => { const r = scoutRecommendation(p); return <span title={r.reasons.map((x) => t(x.key, x.params)).join(' ')}><RecTag level={r.level} /></span>; })()}</td>
            <td className="num">{money(p.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </>
  );
}

/** Én scout: send ud med mål, varighed og fokus – eller kald hjem */
function ScoutRow({ s, nations }: { s: Staff; nations: number[] }) {
  const g = useGame()!;
  const a = s.assignment;
  const [target, setTarget] = useState(`l:${g.clubs[g.userClub]?.league ?? ''}`);
  const [months, setMonths] = useState(3);
  const [focus, setFocus] = useState<'any' | 'young' | 'prime'>('any');
  const [role, setRole] = useState<Role | ''>('');
  const [attr, setAttr] = useState(-1);
  const [attrMin, setAttrMin] = useState(15);
  const [maxValue, setMaxValue] = useState(0);
  const [crit, setCrit] = useState(false);
  const attrOptions = ATTRS.slice(0, 36).map((k, i) => ({ value: i, label: t(`attr.${k}`), group: t(i <= 13 ? 'group.technical' : i <= 24 ? 'group.mental' : i <= 32 ? 'group.physical' : 'group.goalkeeping') }));
  const targetName = (x: ScoutAssignment) => x.kind === 'nation' ? natName(g.nations[x.target as number]?.name) : x.kind === 'league' ? `${g.nations[g.leagues[x.target as string]?.nation]?.name ?? ''} – ${g.leagues[x.target as string]?.name ?? x.target}` : '';
  const send = () => {
    const kind = target.startsWith('n:') ? 'nation' : 'league';
    const tgt = kind === 'nation' ? Number(target.slice(2)) : target.slice(2);
    const until = months ? (() => { const d = new Date(g.date + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + months); return d.toISOString().slice(0, 10); })() : undefined;
    act({ t: 'scout', staffId: s.id, assignment: {
      kind, target: tgt, since: g.date, until, focus, found: [],
      ...(role ? { role } : {}), ...(attr >= 0 ? { attr, attrMin } : {}), ...(maxValue ? { maxValue } : {}),
    } });
  };
  const recall = () => act({ t: 'scout', staffId: s.id, assignment: null });
  return (
    <tr>
      <td className="scout-who">
        <b>{s.first} {s.last}</b>
        <span className="muted" title={`${t('staff.judgingAbility')} / ${t('staff.judgingPotential')}`}>{t('scout.short.ab')} {s.attrs.judgingAbility} · {t('scout.short.pot')} {s.attrs.judgingPotential}</span>
      </td>
      <td>
        {a?.kind === 'player' ? (
          <div className="row">{t('scout.watching')} <PlayerLink p={g.players[a.target as number]} /> <button className="small" onClick={recall}>{t('scout.recall')}</button></div>
        ) : a ? (
          <div className="col" style={{ gap: 4 }}>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}><b>{targetName(a)}</b>
              {a.focus && a.focus !== 'any' && <span className="tag">{t(`scout.focus.${a.focus}`)}</span>}
              {a.role && <span className="tag">{t(`role.${a.role}`)}</span>}
              {a.attr !== undefined && a.attr >= 0 && <span className="tag">{t(`attr.${ATTRS[a.attr]}`)} ≥ {a.attrMin}</span>}
              {a.maxValue ? <span className="tag">≤ {money(a.maxValue)}</span> : null}
              <button className="small danger" onClick={recall}>{t('scout.recall')}</button></div>
            <span className="muted" style={{ fontSize: 12 }}>{t('scout.status', { since: a.since ? dateFmt(a.since) : '–', n: a.found?.length ?? 0, until: a.until ? t('scout.until', { date: dateFmt(a.until) }) : '' })}</span>
          </div>
        ) : (
          <div className="scout-form">
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              <span className="tag" title={t('scout.home')}>🏠</span>
              <Select value={target} onChange={setTarget} width={200} options={[
                ...g.leagueOrder.filter((l) => g.leagues[l]).map((l) => ({ value: `l:${l}`, label: `${g.leagues[l].name}`, hint: g.nations[g.leagues[l].nation]?.code, group: t('scout.leagues') })),
                ...nations.map((n) => ({ value: `n:${n}`, label: natName(g.nations[n].name), flag: g.nations[n].name, hint: g.nations[n].code, group: t('scout.nations') })),
              ]} />
              <select value={months} onChange={(e) => setMonths(Number(e.target.value))} title={t('scout.duration')}>
                {[1, 3, 6, 0].map((m) => <option key={m} value={m}>{t(`scout.dur.${m}`)}</option>)}
              </select>
              <select value={focus} onChange={(e) => setFocus(e.target.value as 'any')} title={t('scout.focus')}>
                {(['any', 'young', 'prime'] as const).map((f) => <option key={f} value={f}>{t(`scout.focus.${f}`)}</option>)}
              </select>
              {!crit && <button className="small" onClick={() => setCrit(true)}>+ {t('scout.criteriaBtn')}</button>}
              <button className="small primary" onClick={send}>{t('scout.send')}</button>
            </div>
            {crit && (
              <div className="row scout-criteria">
                <select value={role} onChange={(e) => setRole(e.target.value as Role | '')}>
                  <option value="">{t('tr.anyPos')}</option>
                  {(['GK', 'CB', 'FB', 'DM', 'CM', 'WM', 'AM', 'W', 'ST'] as Role[]).map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
                </select>
                <Select value={attr} onChange={setAttr} width={160} options={[{ value: -1, label: t('tr.f.attr') }, ...attrOptions]} />
                {attr >= 0 && <label className="row">≥ <input type="number" min={1} max={20} value={attrMin} onChange={(e) => setAttrMin(Math.max(1, Math.min(20, Number(e.target.value))))} style={{ width: 54 }} /></label>}
                <select value={maxValue} onChange={(e) => setMaxValue(Number(e.target.value))}>
                  <option value={0}>{t('tr.anyValue')}</option>
                  {[500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000, 25_000_000].map((v) => <option key={v} value={v}>≤ {money(v)}</option>)}
                </select>
              </div>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

/** Prøvespillere lige nu: hvor langt trænerne er med at lære dem at kende */
function TrialsPanel() {
  const g = useGame()!;
  const list = g.manager.trials ?? [];
  return (
    <Panel title={t('trial.title', { n: list.length, max: MAX_TRIALS })} className="flush">
      {!list.length ? <div className="muted" style={{ padding: '10px 14px' }}>{t('trial.empty')}</div> : (
        <table className="grid">
          <tbody>
            {list.map((tr) => {
              const p = g.players[tr.pid];
              if (!p) return null;
              const st = scoutStars(p);
              return (
                <tr key={tr.pid}>
                  <td>{posStr(p)}</td>
                  <td><PlayerLink p={p} /></td>
                  <td><Stars range={st.ability} /></td>
                  <td><Stars range={st.potential} /></td>
                  <td className="muted">{t('trial.known', { pct: Math.round(g.knowledge[p.id] ?? 0) })} · {t('trial.ends', { date: dateFmt(tr.end) })}</td>
                  <td><button className="small" onClick={() => act({ t: 'trial', pid: p.id, end: true })}>{t('trial.send')}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
