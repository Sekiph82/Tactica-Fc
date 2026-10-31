import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { crestSvg } from '../game/draft';
import { positionString } from '../game/attributes';
import { flagUrl } from './flags';
import { ageOn } from '../game/dates';
import { gs, hasGame } from '../game/state';
import { humanManager } from '../game/humans';
import type { Player } from '../game/types';
import { currencySymbol, fromCurExact, getNumberLocale, natName, t, toCur } from '../i18n';
import { useNav, useRouteState } from './core';
import { logoUrl } from './logos';

export function PlayerLink({ p, short }: { p: Player | undefined; short?: boolean }) {
  const { nav } = useNav();
  if (!p) return <span className="muted">—</span>;
  return (
    <a className="link" onClick={(e) => { e.stopPropagation(); nav({ name: 'player', id: p.id }); }}>
      {short ? `${p.first ? p.first[0] + '. ' : ''}${p.last}` : `${p.first} ${p.last}`.trim()}
    </a>
  );
}

/** Klublogo – falder tilbage til et "trøje"-felt i klubfarverne */
export function Crest({ id, size = 14 }: { id: number; size?: number }) {
  const [failed, setFailed] = useState(false);
  const c = gs().clubs[id];
  // draft-liga: klubbens eget logo
  if (c?.crest !== undefined) return <img className="crest" src={`data:image/svg+xml;utf8,${encodeURIComponent(crestSvg(c.crest, c.colors[0], c.colors[1], c.short))}`} alt="" width={size} height={size} style={{ width: size, height: size }} />;
  const url = logoUrl(id);
  if (url && !failed) {
    return <img className="crest" src={url} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)} style={{ width: size, height: size }} />;
  }
  if (!c) return null;
  return <i className="kit" style={{ background: c.colors[0], borderColor: c.colors[1], width: size * 0.8, height: size * 0.8 }} />;
}

export function ClubLink({ id, long, noCrest }: { id: number; long?: boolean; noCrest?: boolean }) {
  const { nav } = useNav();
  const c = gs().clubs[id];
  if (!c) return <span className="muted">{t('common.free')}</span>;
  return (
    <a className="link club-link" onClick={(e) => { e.stopPropagation(); nav({ name: 'club', id }); }}>
      {!noCrest && <Crest id={id} />}
      {long ? c.name : c.short}
      {c.manager === -1 && id !== gs().userClub && <MgrChip clubId={id} />}
    </a>
  );
}

/** Farve pr. manager (så den samme manager altid har samme farve) */
export function mgrHue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/** Lille mærke på klubber der styres af en anden manager: initialer (menneske) eller AI */
export function MgrChip({ clubId }: { clubId: number }) {
  const m = humanManager(clubId);
  if (!m) return null;
  const initials = m.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <span className={`mgr-chip ${m.bot ? 'ai' : 'human'}`} style={{ ['--h' as string]: mgrHue(m.name) } as CSSProperties} title={t(m.bot ? 'chat.chipAi' : 'chat.chipHuman', { name: m.name })}>
      {m.bot ? 'AI' : initials}
    </span>
  );
}

/** Nationalitet: flag + landekode (koden alene, hvis flaget ikke kan hentes) */
export function Nat({ n, noCode }: { n: number; noCode?: boolean }) {
  const nat = gs().nations[n];
  return <span className="nat" title={natName(nat?.name)}><Flag name={nat?.name} />{noCode ? null : nat?.code ?? '?'}</span>;
}

export function Flag({ name }: { name: string | undefined }) {
  const [failed, setFailed] = useState(false);
  const url = flagUrl(name);
  if (!url || failed) return null;
  return <img className="flag" src={url} alt="" width={18} height={13} loading="lazy" onError={() => setFailed(true)} />;
}

export function AttrVal({ lo, hi }: { lo: number; hi: number }) {
  const v = Math.round((lo + hi) / 2);
  const cls = v >= 16 ? 'a-top' : v >= 13 ? 'a-good' : v >= 9 ? 'a-mid' : v >= 5 ? 'a-low' : 'a-bad';
  return <span className={`attr ${cls}`}>{lo === hi ? lo : `${lo}–${hi}`}</span>;
}

export function Stars({ range }: { range: [number, number] }) {
  const [lo, hi] = range;
  const out: ReactNode[] = [];
  for (let i = 1; i <= 5; i++) {
    const cls = lo >= i ? 's-full' : lo >= i - 0.5 ? 's-half' : hi >= i - 0.5 ? 's-maybe' : 's-empty';
    out.push(<i key={i} className={`star ${cls}`} />);
  }
  // stjernerne er relative til ens eget hold – forklar det, så de ikke forveksles med attributternes absolutte tal
  const g = hasGame() ? gs() : null;
  const club = g ? g.clubs[g.userClub]?.name : undefined;
  const value = lo === hi ? `${lo} ★` : `${lo}–${hi} ★`;
  const tip = `${value}\n${club ? t('stars.tip', { club }) : t('stars.tipNoClub')}${lo !== hi ? `\n${t('stars.tipUnsure')}` : ''}`;
  return <span className="stars" title={tip}>{out}</span>;
}

export function Bar({ value, max = 100, tone }: { value: number; max?: number; tone?: 'good' | 'bad' | 'auto' }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const cls = tone === 'auto' || !tone ? (pct > 75 ? 'good' : pct > 45 ? 'mid' : 'bad') : tone;
  return <span className="bar"><i className={cls} style={{ width: `${pct}%` }} /></span>;
}

export function Tabs({ tabs, value, onChange }: { tabs: [string, string][]; value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // på mobil er fanerne én række, der kan rulles – hold den valgte fane synlig
  useEffect(() => {
    const box = ref.current, on = box?.querySelector<HTMLElement>('button.on');
    if (box && on && box.scrollWidth > box.clientWidth) box.scrollTo({ left: on.offsetLeft - (box.clientWidth - on.offsetWidth) / 2, behavior: 'smooth' });
  }, [value]);
  return (
    <div className="tabs" ref={ref}>
      {tabs.map(([k, label]) => (
        <button key={k} className={k === value ? 'on' : ''} onClick={() => onChange(k)}>{label}</button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className={`modal ${wide ? 'wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>{title}</span>
          <button className="x" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export interface Col<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  sort?: (row: T) => number | string;
  className?: string;
  title?: string;
}

export function Table<T>({ rows, cols, rowKey, onRow, initialSort, initialDir = -1, rowClass, limit }: {
  rows: T[]; cols: Col<T>[]; rowKey: (r: T) => string | number; onRow?: (r: T) => void; initialSort?: string; initialDir?: 1 | -1; rowClass?: (r: T) => string; limit?: number;
}) {
  const sk = `sort:${cols.map((c) => c.key).join(',')}`;
  const [sortState, setSortState] = useRouteState<{ key?: string; dir: 1 | -1 }>(sk, { key: initialSort, dir: initialDir });
  const sortKey = sortState.key;
  const dir = sortState.dir;
  const setSortKey = (k: string) => setSortState({ key: k, dir: -1 });
  const setDir = (f: (d: 1 | -1) => 1 | -1) => setSortState({ key: sortKey, dir: f(dir) });
  const sorted = useMemo(() => {
    const col = cols.find((c) => c.key === sortKey);
    if (!col?.sort) return rows;
    // værdien beregnes én gang pr. række (store lister, fx transfersøgningen over hele databasen)
    const keyed = rows.map((r) => [col.sort!(r), r] as const);
    keyed.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0) * dir);
    return keyed.map((x) => x[1]);
  }, [rows, cols, sortKey, dir]);
  const shown = limit ? sorted.slice(0, limit) : sorted;
  return (
    <div className="table-wrap">
      <table className="grid">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} className={`${c.className ?? ''} ${c.sort ? 'sortable' : ''} ${sortKey === c.key ? 'sorted' : ''}`} title={c.title}
                onClick={() => { if (!c.sort) return; if (sortKey === c.key) setDir((d) => (d === 1 ? -1 : 1)); else setSortKey(c.key); }}>
                {c.label}{sortKey === c.key ? (dir === 1 ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={rowKey(r)} onClick={onRow ? () => onRow(r) : undefined} className={`${onRow ? 'clickable' : ''} ${rowClass?.(r) ?? ''}`}>
              {cols.map((c) => <td key={c.key} className={c.className}>{c.render(r)}</td>)}
            </tr>
          ))}
          {shown.length === 0 && <tr><td colSpan={cols.length} className="muted center">{t('common.none')}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function Panel({ title, children, right, className, style }: { title?: ReactNode; children: ReactNode; right?: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <section className={`panel ${className ?? ''}`} style={style}>
      {title && <header><h3>{title}</h3>{right && <div className="right">{right}</div>}</header>}
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function age(p: Player) {
  return ageOn(p.dob, gs().date);
}

export function posStr(p: Player) {
  return positionString(p);
}

/** Radar-diagram (SVG) – sammenlign op til 3 spillere */
export function Radar({ series, labels }: { series: { name: string; values: number[]; color: string }[]; labels: string[] }) {
  const size = 260, c = size / 2, r = 95;
  const n = labels.length;
  const pt = (i: number, v: number) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [c + Math.cos(a) * r * (v / 20), c + Math.sin(a) * r * (v / 20)];
  };
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="radar" role="img" aria-label="radar">
      {[5, 10, 15, 20].map((lv) => (
        <polygon key={lv} points={labels.map((_, i) => pt(i, lv).join(',')).join(' ')} className="radar-grid" />
      ))}
      {labels.map((l, i) => {
        const [x, y] = pt(i, 23.5);
        const [x2, y2] = pt(i, 20);
        return (
          <g key={l}>
            <line x1={c} y1={c} x2={x2} y2={y2} className="radar-grid" />
            <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="radar-label">{l}</text>
          </g>
        );
      })}
      {series.map((s) => (
        <polygon key={s.name} points={s.values.map((v, i) => pt(i, v).join(',')).join(' ')} style={{ fill: s.color, stroke: s.color }} className="radar-series" />
      ))}
    </svg>
  );
}

export function Pct({ v }: { v: number }) {
  return <>{Math.round(v * 100)}%</>;
}

export function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

/**
 * Beløbsfelt i den valgte valuta. Teksten redigeres frit og omregnes først til euro,
 * når man forlader feltet eller trykker Enter (så små tal i kroner ikke rundes til 0 undervejs).
 */
export function MoneyInput({ value, onChange, min = 0, width = 130 }: { value: number; onChange: (eur: number) => void; min?: number; width?: number }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    const n = Number(text.replace(/[^0-9.,]/g, '').replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(n)) onChange(Math.max(min, fromCurExact(n)));
    setText(null);
  };
  return (
    <span className="row" style={{ gap: 4, display: 'inline-flex' }}>
      <input inputMode="numeric" value={text ?? toCur(value).toLocaleString(getNumberLocale())} style={{ width }}
        onFocus={(e) => { setText(String(toCur(value))); requestAnimationFrame(() => e.target.select()); }}
        onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      <span className="muted">{currencySymbol()}</span>
    </span>
  );
}

export function RecTag({ level }: { level: number }) {
  if (level < 0) return <span className="tag">{t('rec.short.unknown')}</span>;
  const cls = level <= 1 ? 'good' : level === 2 ? '' : level === 3 ? 'warn' : 'bad';
  return <span className={`tag ${cls}`}>{t(`rec.short.l${level}`)}</span>;
}

/** Farve for en kampkarakter: grøn = god, rød = dårlig */
export function ratingClass(r: number): string {
  return r >= 7.5 ? 'r-top' : r >= 7 ? 'r-good' : r >= 6.5 ? 'r-ok' : r >= 6 ? 'r-meh' : 'r-bad';
}

export function Rating({ r, digits = 1 }: { r: number; digits?: number }) {
  return <span className={`rating ${ratingClass(r)}`}>{r.toFixed(digits)}</span>;
}

/** Seneste karakterer, farvet */
export function FormList({ form, sep = ' · ' }: { form: number[]; sep?: string }) {
  if (!form.length) return <>-</>;
  return <>{form.map((r, i) => <span key={i}>{i > 0 && sep}<Rating r={r} /></span>)}</>;
}

/** Lille indlæsningsikon, mens AI'en skriver (tre prikker der pulserer) */
export function AiSpinner({ text }: { text?: string }) {
  return <span className="ai-spin" role="status" aria-live="polite"><i /><i /><i />{text && <span>{text}</span>}</span>;
}
