import { useEffect, useRef, useState } from 'react';
import { benchSize } from '../../game/rules';
import { Info } from '../help';
import { roleScore, slotFit, slotRole, roleProfile } from '../../game/attributes';
import { gs, squad } from '../../game/state';
import { act } from '../../game/actions';
import { autoSelect, available, changeFormation, FORMATIONS, newTactic } from '../../game/tactics';
import type { Player, PlayerInstructions, PosKey, Side, Slot, Tactic, TeamInstructions } from '../../game/types';
import { t } from '../../i18n';
import { chemistry } from '../../game/personality';
import { Bar, Panel, PlayerLink, posStr } from '../components';
import { useGame } from '../core';
import { Head } from './common';

export function Tactics() {
  const g = useGame()!;
  if (!g.tactic) g.tactic = autoSelect(newTactic('4-4-2'), squad(g.userClub));
  const set = (tac: Tactic) => act({ t: 'tactic', tactic: tac });
  return (
    <div>
      <Head title={t('nav.tactics')}>
        <button onClick={() => set(autoSelect(g.tactic!, squad(g.userClub)))}>{t('tac.assistantPick')}</button>
        <button onClick={() => act({ t: 'savedTactics', list: [...g.savedTactics.filter((x) => x.formation !== g.tactic!.formation), structuredClone(g.tactic!)].slice(-6) })}>{t('tac.save')}</button>
        {g.savedTactics.length > 0 && (
          <select value="" onChange={(e) => { const s = g.savedTactics[Number(e.target.value)]; if (s) set({ ...structuredClone(s), lineup: g.tactic!.lineup.length === s.lineup.length ? g.tactic!.lineup : s.lineup }); }}>
            <option value="">{t('tac.load')}</option>
            {g.savedTactics.map((s, i) => <option key={i} value={i}>{s.formation} ({t(`ment.${s.team.mentality}`)})</option>)}
          </select>
        )}
      </Head>
      {!g.draft && <ChemistryPanel />}
      <TacticEditor tactic={g.tactic} players={squad(g.userClub)} onChange={set} />
    </div>
  );
}

/** Pladsens betegnelse ud fra hvor den står på banen (x: 0 eget mål → 100 modstanderens, y: 0 venstre → 100 højre) */
function slotAt(x: number, y: number): { pos: PosKey; side: Side } {
  const side: Side = y < 30 ? 'L' : y > 70 ? 'R' : 'C';
  const pos: PosKey = x < 15 && side === 'C' ? 'SW' : x < 27 ? 'D' : x < 36 ? (side === 'C' ? 'DM' : 'WB') : x < 56 ? 'M' : x < 70 ? 'AM' : 'ST';
  return { pos, side };
}

/** Navn til en egen formation ud fra pladserne, fx "4-1-2-3*" */
function shapeName(slots: Slot[]): string {
  const n = { d: 0, dm: 0, m: 0, am: 0, st: 0 };
  for (const s of slots) {
    if (s.pos === 'GK') continue;
    if (s.pos === 'D' || s.pos === 'SW' || (s.pos === 'WB' && s.x < 36)) n.d++;
    else if (s.pos === 'DM') n.dm++;
    else if (s.pos === 'M' || s.pos === 'WB') n.m++;
    else if (s.pos === 'AM') n.am++;
    else n.st++;
  }
  return `${[n.d, n.dm, n.m, n.am, n.st].filter((x) => x > 0).join('-')}*`;
}

/** Banens koordinater i procent af tavlen */
const slotLeft = (s: Slot) => s.y;
const slotTop = (s: Slot) => 97 - s.x * 0.92;

export function TacticEditor({ tactic, players, onChange, matchMode, onSub, cond }: {
  tactic: Tactic; players: Player[]; onChange: (t: Tactic) => void; matchMode?: boolean; onSub?: (outId: number, inId: number) => void;
  /** under kampen: den aktuelle kondition pr. spiller (samme tal som i udskiftningsmenuen) */
  cond?: Record<number, number>;
}) {
  const condOf = (p: Player) => cond?.[p.id] ?? p.condition;
  const [sel, setSel] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  // fortryd: de seneste ændringer gemmes, så man kan klikke sig tilbage
  const [hist, setHist] = useState<Tactic[]>([]);
  const change = (next: Tactic) => { setHist((h) => [...h.slice(-39), tactic]); onChange(next); };
  const undo = () => { const prev = hist.at(-1); if (!prev) return; setHist(hist.slice(0, -1)); onChange(prev); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && el?.tagName !== 'INPUT' && el?.tagName !== 'TEXTAREA') { e.preventDefault(); undo(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  // flyt pladser (egen formation) og højrekliksmenu med spillerinstruktioner
  const [editPos, setEditPos] = useState(false);
  const [moving, setMoving] = useState<{ i: number; x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<{ i: number; left: number; top: number } | null>(null);
  const pitchRef = useRef<HTMLDivElement>(null);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => { if (e instanceof KeyboardEvent && e.key !== 'Escape') return; setMenu(null); };
    window.addEventListener('click', close);
    window.addEventListener('keydown', close);
    return () => { window.removeEventListener('click', close); window.removeEventListener('keydown', close); };
  }, [menu]);
  const toPitch = (cx: number, cy: number) => {
    const r = pitchRef.current!.getBoundingClientRect();
    const left = ((cx - r.left) / r.width) * 100, top = ((cy - r.top) / r.height) * 100;
    return { x: Math.max(10, Math.min(90, (97 - top) / 0.92)), y: Math.max(4, Math.min(96, left)) };
  };
  const finishMove = () => {
    if (!moving) return;
    const slots = tactic.slots.slice();
    const { pos, side } = slotAt(moving.x, moving.y);
    slots[moving.i] = { pos, side, x: Math.round(moving.x), y: Math.round(moving.y) };
    setMoving(null);
    change({ ...tactic, slots, formation: shapeName(slots) });
  };
  const setIndFor = (i: number, patch: Partial<PlayerInstructions>) => {
    const individual = tactic.individual.slice();
    individual[i] = { ...individual[i], ...patch };
    change({ ...tactic, individual });
  };
  const byId = new Map(players.map((p) => [p.id, p]));
  const inXI = new Set(tactic.lineup);
  const selSlot = sel !== null ? tactic.slots[sel] : null;

  const assign = (slot: number, pid: number) => {
    const lineup = tactic.lineup.slice();
    let bench = tactic.bench.slice();
    const prev = lineup[slot];
    const from = lineup.indexOf(pid);
    if (matchMode) {
      if (from >= 0) { lineup[from] = prev; lineup[slot] = pid; change({ ...tactic, lineup }); }
      else if (onSub && prev) onSub(prev, pid);
      return;
    }
    if (from >= 0) {
      lineup[from] = prev;
      lineup[slot] = pid;
    } else {
      lineup[slot] = pid;
      bench = bench.filter((x) => x !== pid);
      if (prev && bench.length < benchSize()) bench.push(prev);
    }
    change({ ...tactic, lineup, bench });
  };

  const toggleBench = (pid: number) => {
    if (matchMode) return;
    if (tactic.bench.includes(pid)) change({ ...tactic, bench: tactic.bench.filter((x) => x !== pid) });
    else if (tactic.bench.length < benchSize() && !inXI.has(pid)) change({ ...tactic, bench: [...tactic.bench, pid] });
  };

  const setTeam = (patch: Partial<TeamInstructions>) => change({ ...tactic, team: { ...tactic.team, ...patch } });
  const setInd = (patch: Partial<PlayerInstructions>) => {
    if (sel === null) return;
    const individual = tactic.individual.slice();
    individual[sel] = { ...individual[sel], ...patch };
    change({ ...tactic, individual });
  };

  const listed = players.slice().sort((a, b) => {
    if (selSlot) return (available(b) ? 1 : 0) - (available(a) ? 1 : 0) || roleScore(b, slotRole(selSlot)) * slotFit(b, selSlot) - roleScore(a, slotRole(selSlot)) * slotFit(a, selSlot);
    return Number(inXI.has(b.id)) - Number(inXI.has(a.id)) || Number(tactic.bench.includes(b.id)) - Number(tactic.bench.includes(a.id)) || b.ca - a.ca;
  });
  const ind = sel !== null ? tactic.individual[sel] : null;
  const tm = tactic.team;
  const iopt = (k: keyof NonNullable<typeof ind>, vals: [number | boolean, string][]) => ind && (
    <div className="ti-row">
      <div className="ti-label"><b>{t(`pi.${k}`)}</b><span className="muted">{t(`pih.${k}`)}</span></div>
      <div className="seg" role="radiogroup">
        {vals.map(([v, l]) => (
          <button key={String(v)} type="button" role="radio" aria-checked={ind[k] === v} className={ind[k] === v ? 'on' : ''}
            onClick={() => setInd({ [k]: v } as Partial<NonNullable<typeof ind>>)}>{l}</button>
        ))}
      </div>
    </div>
  );
  const opt = (k: keyof TeamInstructions, vals: [number | string | boolean, string][]) => (
    <div className="ti-row">
      <div className="ti-label"><b>{t(`ti.${k}`)}</b><span className="muted">{t(`tih.${k}`)}</span></div>
      <div className="seg" role="radiogroup">
        {vals.map(([v, l]) => (
          <button key={String(v)} type="button" role="radio" aria-checked={tm[k] === v} className={tm[k] === v ? 'on' : ''}
            onClick={() => setTeam({ [k]: v } as Partial<TeamInstructions>)}>{l}</button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="cols" style={{ gridTemplateColumns: 'minmax(280px, 420px) 1fr' }}>
      <div className="col">
        <div className="row">
          <select value={tactic.formation} disabled={matchMode && false} onChange={(e) => change(changeFormation(tactic, e.target.value))}>
            {!FORMATIONS.includes(tactic.formation) && <option value={tactic.formation}>{t('tac.customFormation', { name: tactic.formation })}</option>}
            {FORMATIONS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <button className="small" disabled={!hist.length} onClick={undo} title={t('tac.undoHint')}>↶ {t('tac.undo')}{hist.length ? ` (${hist.length})` : ''}</button>
          {!gs().draft && <button className={`small ${editPos ? 'primary' : ''}`} onClick={() => { setEditPos(!editPos); setSel(null); }} title={t('tac.movePosHint')}>✥ {t(editPos ? 'tac.movePosDone' : 'tac.movePos')}</button>}
          <span className="muted">{t(editPos ? 'tac.movePosHint' : 'tac.hint2')}</span>
        </div>
        <div className={`pitch ${editPos ? 'editing' : ''}`} ref={pitchRef}
          onDragOver={(e) => { if (drag !== null && tactic.lineup.includes(drag)) e.preventDefault(); }}
          onDrop={(e) => {
            // sluppet på en tom plet: flyt spillerens plads dertil (egen formation)
            if (drag === null) return;
            // draft-liga: formationen er den, der blev draftet – pladser flyttes ikke ved et uheld
            if (gs().draft) { setDrag(null); return; }
            const i = tactic.lineup.indexOf(drag);
            setDrag(null);
            if (i < 0 || tactic.slots[i].pos === 'GK') return;
            const { x, y } = toPitch(e.clientX, e.clientY);
            const slots = tactic.slots.slice();
            slots[i] = { ...slotAt(x, y), x: Math.round(x), y: Math.round(y) };
            change({ ...tactic, slots, formation: shapeName(slots) });
          }}
          onPointerMove={(e) => { if (moving) setMoving({ i: moving.i, ...toPitch(e.clientX, e.clientY) }); }}
          onPointerUp={finishMove} onPointerLeave={finishMove}>
          <svg className="lines" viewBox="0 0 68 100" preserveAspectRatio="none">
            <g stroke="#ffffffaa" strokeWidth="0.4" fill="none">
              <rect x="1" y="1" width="66" height="98" />
              <line x1="1" y1="50" x2="67" y2="50" />
              <circle cx="34" cy="50" r="9" />
              <rect x="14" y="1" width="40" height="16" />
              <rect x="14" y="83" width="40" height="16" />
              <rect x="25" y="1" width="18" height="6" />
              <rect x="25" y="93" width="18" height="6" />
            </g>
          </svg>
          {/* pile: hvor meget spilleren går med frem (løb) */}
          <svg className="run-arrows" viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs><marker id="arrowhead" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#fff" /></marker></defs>
            {tactic.slots.map((s0, i) => {
              const sl = moving?.i === i ? { ...s0, x: moving.x, y: moving.y } : s0;
              const runs = tactic.individual[i]?.runs ?? 1;
              // offensiv: pil frem · balanceret: ingen pil · defensiv: pil tilbage (står dybere)
              if (sl.pos === 'GK' || runs === 1 || !tactic.lineup[i]) return null;
              const forward = runs === 2;
              const inward = sl.side === 'L' ? 5 : sl.side === 'R' ? -5 : 0;
              const x1 = slotLeft(sl), y1 = slotTop(sl) + (forward ? -4 : 4);
              return <line key={i} x1={x1} y1={y1} x2={x1 + (forward ? inward : 0)} y2={y1 + (forward ? -15 : 9)} stroke={forward ? '#fff' : '#ffd166'} strokeWidth="1.6" strokeDasharray="3 2.4" vectorEffect="non-scaling-stroke" markerEnd="url(#arrowhead)" opacity="0.9" />;
            })}
          </svg>
          {tactic.slots.map((s0, i) => {
            const s = moving?.i === i ? { ...s0, ...slotAt(moving.x, moving.y), x: moving.x, y: moving.y } : s0;
            const p = byId.get(tactic.lineup[i]);
            const fit = p ? slotFit(p, s) : 0;
            const club = gs().clubs[gs().userClub];
            return (
              <div key={i} className={`slot ${sel === i ? 'picked' : ''} ${p ? '' : 'empty'} ${drag !== null ? 'drop' : ''} ${moving?.i === i ? 'moving' : ''}`}
                style={{ left: `${slotLeft(s)}%`, top: `${slotTop(s)}%` }}
                onClick={() => { if (!editPos) setSel(sel === i ? null : i); }}
                onContextMenu={(e) => { if (!p || s.pos === 'GK' && false) return; e.preventDefault(); setSel(i); setMenu({ i, left: e.clientX, top: e.clientY }); }}
                onPointerDown={(e) => {
                  if (editPos && s.pos !== 'GK') { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); setMoving({ i, x: s.x, y: s.y }); return; }
                  // langt tryk (mobil) åbner menuen
                  if (e.pointerType === 'touch' && p) { const { clientX, clientY } = e; press.current = setTimeout(() => { setSel(i); setMenu({ i, left: clientX, top: clientY }); }, 550); }
                }}
                onPointerUp={() => { if (press.current) { clearTimeout(press.current); press.current = null; } }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.stopPropagation(); if (drag !== null) assign(i, drag); setDrag(null); }}
                draggable={!!p && !editPos}
                onDragStart={(e) => {
                  if (!p) return;
                  setDrag(p.id);
                  // et lille rent trækbillede i stedet for browserens "spøgelse"
                  const ghost = document.createElement('div');
                  ghost.className = 'drag-ghost';
                  ghost.textContent = p.last;
                  document.body.appendChild(ghost);
                  e.dataTransfer.setDragImage(ghost, 20, 14);
                  setTimeout(() => ghost.remove(), 0);
                }}
                onDragEnd={() => setDrag(null)}>
                <div className="shirt" style={{ background: club?.colors[0] ?? '#c00', color: club?.colors[1] ?? '#fff' }}>{s.pos}{s.side !== 'C' ? s.side : ''}</div>
                <div className="nm">{p ? p.last : t('tac.empty')}</div>
                {p && <div className="fit" style={{ color: fit > 0.85 ? '#9f9' : fit > 0.6 ? '#ff9' : '#f99' }}>{fit > 0.85 ? '●' : fit > 0.6 ? '◐' : '○'} {Math.round(condOf(p))}%</div>}
              </div>
            );
          })}
        </div>
        {menu && (() => {
          const i = menu.i;
          const ins = tactic.individual[i];
          const p = byId.get(tactic.lineup[i]);
          if (!ins || !p) return null;
          const sl = tactic.slots[i];
          const tri = (k: 'longShots' | 'crossing', label: string) => (
            <div className="ctx-row"><span>{label}</span>{[0, 1, 2].map((v) => <button key={v} className={`small ${ins[k] === v ? 'primary' : ''}`} onClick={(e) => { e.stopPropagation(); setIndFor(i, { [k]: v } as Partial<PlayerInstructions>); }}>{t(['ti.rarely', 'ti.sometimes', 'ti.often'][v])}</button>)}</div>
          );
          const tog = (k: 'runWithBall' | 'throughBalls' | 'freeRole' | 'tightMarking', label: string) => (
            <button className={`ctx-toggle ${ins[k] ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); setIndFor(i, { [k]: !ins[k] } as Partial<PlayerInstructions>); }}>{ins[k] ? '✓' : '○'} {label}</button>
          );
          return (
            <div className="ctx-menu" style={{ left: Math.min(menu.left, window.innerWidth - 340), top: Math.min(menu.top, window.innerHeight - 300) }} onClick={(e) => e.stopPropagation()}>
              <div className="ctx-title">{p.last} · {sl.pos}{sl.side !== 'C' ? ' ' + sl.side : ''}</div>
              <div className="ctx-row role">
                {([[0, '⬇', 'tac.roleDef'], [1, '●', 'tac.roleBal'], [2, '⬆', 'tac.roleAtt']] as const).map(([v, ic, k]) => (
                  <button key={v} className={`small ${ins.runs === v ? 'primary' : ''}`} onClick={(e) => { e.stopPropagation(); setIndFor(i, { runs: v }); }}>{ic} {t(k)}</button>
                ))}
              </div>
              {tri('longShots', t('pi.longShots'))}
              {tri('crossing', t('pi.crossing'))}
              <div className="ctx-toggles">
                {tog('runWithBall', t('pi.runWithBall'))}
                {tog('throughBalls', t('pi.throughBalls'))}
                {tog('tightMarking', t('pi.tightMarking'))}
                {tog('freeRole', t('pi.freeRole'))}
              </div>
            </div>
          );
        })()}
        <Panel title={t('tac.setPieces')}>
          <div className="col">
            {(['captain', 'penalties', 'freeKicks', 'corners'] as const).map((k) => (
              <label key={k} className="row setpiece-row"><span>{t(`tac.${k}`)}</span>
                <select value={tactic[k]} onChange={(e) => change({ ...tactic, [k]: Number(e.target.value) })}>
                  <option value={0}>—</option>
                  {tactic.lineup.map((id) => byId.get(id)).filter(Boolean).map((p) => <option key={p!.id} value={p!.id}>{p!.last}</option>)}
                </select>
              </label>
            ))}
          </div>
        </Panel>
      </div>
      <div className="col">
        <Panel title={t('tac.team')}>
          <div className="ti-groups">
            <div className="ti-group">
              <div className="ti-head">⚽ {t('tac.withBall')}</div>
              {opt('mentality', [0, 1, 2, 3, 4].map((v) => [v, t(`ment.short.${v}`)]))}
              {opt('passing', [[0, t('ti.short')], [1, t('ti.mixed')], [2, t('ti.long')]])}
              {opt('tempo', [[0, t('ti.slow')], [1, t('ti.normal')], [2, t('ti.fast')]])}
              {opt('width', [[0, t('ti.narrow')], [1, t('ti.normal')], [2, t('ti.wide')]])}
              {opt('counter', [[false, t('common.no')], [true, t('common.yes')]])}
            </div>
            <div className="ti-group">
              <div className="ti-head">🛡 {t('tac.withoutBall')}</div>
              {opt('closingDown', [[0, t('ti.rarely')], [1, t('ti.sometimes')], [2, t('ti.often')]])}
              {opt('tackling', [[0, t('ti.easy')], [1, t('ti.normal')], [2, t('ti.hard')]])}
              {opt('marking', [['zonal', t('ti.zonal')], ['man', t('ti.man')]])}
              {opt('offside', [[false, t('common.no')], [true, t('common.yes')]])}
            </div>
          </div>
        </Panel>
        {ind && selSlot && (
          <Panel title={`${t('tac.individual')}: ${selSlot.pos}${selSlot.side !== 'C' ? ' ' + selSlot.side : ''} – ${byId.get(tactic.lineup[sel!])?.last ?? ''}`}>
            <div className="ti-groups">
              <div className="ti-group">
                <div className="ti-head">⚽ {t('tac.withBall')}</div>
                {iopt('runs', [[0, t('tac.roleDef')], [1, t('tac.roleBal')], [2, t('tac.roleAtt')]])}
                {iopt('longShots', [[0, t('ti.rarely')], [1, t('ti.mixed')], [2, t('ti.often')]])}
                {iopt('crossing', [[0, t('ti.rarely')], [1, t('ti.mixed')], [2, t('ti.often')]])}
                {iopt('runWithBall', [[false, t('common.no')], [true, t('common.yes')]])}
                {iopt('throughBalls', [[false, t('common.no')], [true, t('common.yes')]])}
              </div>
              <div className="ti-group">
                <div className="ti-head">🛡 {t('tac.withoutBall')}</div>
                {iopt('tightMarking', [[false, t('common.no')], [true, t('common.yes')]])}
                <div className="ti-head" style={{ marginTop: 6 }}>✦ {t('tac.roleHead')}</div>
                {iopt('freeRole', [[false, t('common.no')], [true, t('common.yes')]])}
              </div>
            </div>
          </Panel>
        )}
        <Panel title={selSlot ? t('tac.bestFor', { slot: `${selSlot.pos}${selSlot.side !== 'C' ? ' ' + selSlot.side : ''}` }) : t('tac.players')} className="flush">
          <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table className="grid tac-players">
              <thead><tr><th></th><th>{t('col.pos')}</th><th>{t('col.name')}</th><th>{t('col.cond')}</th>{selSlot && <th>{t('tac.suit')}</th>}<th></th></tr></thead>
              <tbody>
                {listed.map((p) => {
                  const xi = tactic.lineup.indexOf(p.id);
                  const onBench = tactic.bench.includes(p.id);
                  const suit = selSlot ? Math.round(roleScore(p, slotRole(selSlot)) * slotFit(p, selSlot) * 10) / 10 : 0;
                  return (
                    <tr key={p.id} className={`clickable ${!available(p) ? 'injured' : ''}`} draggable onDragStart={() => setDrag(p.id)} onDragEnd={() => setDrag(null)}
                      onClick={() => { if (sel !== null && available(p)) assign(sel, p.id); }}>
                      <td>{xi >= 0 ? <span className="tag good">{tactic.slots[xi].pos}</span> : onBench ? <span className="tag">{t('tac.sub')}</span> : ''}</td>
                      <td>{posStr(p)}</td>
                      <td><PlayerLink p={p} short />{p.injury && <span className="tag bad">{t('tag.inj')}</span>}{p.banned > 0 && <span className="tag bad">{t('tag.ban')}</span>}
                        {selSlot && <RoleNote p={p} slot={selSlot} />}</td>
                      <td><Bar value={condOf(p)} /></td>
                      {selSlot && <td className="num">{suit.toFixed(1)}</td>}
                      <td>{!matchMode && xi < 0 && available(p) && <button className="small" onClick={(e) => { e.stopPropagation(); toggleBench(p.id); }}>{onBench ? '−' : '+'} {t('tac.sub')}</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}

/** Kort beskrivelse af, hvorfor spilleren passer til pladsen: styrker, svagheder og om det er et kompromis */
function RoleNote({ p, slot }: { p: Player; slot: Slot }) {
  const rp = roleProfile(p, slotRole(slot), slot);
  const parts = [...rp.strengths.map((k) => t(`rp.s.${k}`)), ...rp.weaknesses.map((k) => t(`rp.w.${k}`))];
  if (!parts.length && !rp.compromise) return null;
  return (
    <div className="role-note">
      {rp.strengths.map((k) => <span key={k} className="good">{t(`rp.s.${k}`)}</span>)}
      {rp.weaknesses.map((k) => <span key={k} className="bad">{t(`rp.w.${k}`)}</span>)}
      {rp.compromise && <span className="warn">{t('rp.compromise')}</span>}
    </div>
  );
}

/** Kemiens faktorer (se chemistry() i personality.ts) */
const CHEM_ROWS = ['chem.nation', 'chem.tenure', 'chem.newcomers', 'chem.leaders', 'chem.captain', 'chem.pros', 'chem.trouble', 'chem.wantsAway', 'chem.camp'];

function ChemistryPanel() {
  const g = useGame()!;
  const tac = g.tactic!;
  const ch = chemistry(tac.lineup.map((id) => g.players[id]).filter(Boolean), tac.captain);
  const tone = ch.score >= 60 ? 'good' : ch.score < 45 ? 'bad' : 'warn';
  return (
    <div className={`insight ${tone}`}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>{t('chem.title')}: {ch.score}/100 <Bar value={ch.score} /></b><Info topic="chemistry" />
        <span className="muted">{t('chem.effect', { pct: ((ch.score - 50) * 0.06).toFixed(1) })}</span>
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        {ch.parts.filter((p) => p.value !== 0).map((p) => <span key={p.key} className={`tag ${p.value > 0 ? 'good' : 'bad'}`}>{t(p.key, p.params)} {p.value > 0 ? '+' : ''}{p.value}</span>)}
      </div>
      <details className="chem-how">
        <summary>{t('chem.how')}</summary>
        <p>{t('chem.howEffect', { score: ch.score, pct: ((ch.score - 50) * 0.06).toFixed(1) })}</p>
        <table className="grid">
          <thead><tr><th>{t('chem.howFactor')}</th><th className="num">{t('chem.howNow')}</th><th className="num">{t('chem.howRange')}</th><th>{t('chem.howImprove')}</th></tr></thead>
          <tbody>
            {CHEM_ROWS.map((key) => {
              const v = ch.parts.find((x) => x.key === key)?.value ?? 0;
              return <tr key={key}><td>{t(`${key}.name`)}</td><td className={`num ${v > 0 ? 'good' : v < 0 ? 'bad' : 'muted'}`}>{v > 0 ? '+' : ''}{v}</td><td className="num muted">{t(`${key}.range`)}</td><td className="muted">{t(`${key}.how`)}</td></tr>;
            })}
          </tbody>
        </table>
      </details>
    </div>
  );
}
