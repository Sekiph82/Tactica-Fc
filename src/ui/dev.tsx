import { useEffect, useRef, useState } from 'react';
import { ATTRS } from '../game/attributes';
import { RADAR_AXES } from '../game/analysis';
import type { Player } from '../game/types';
import { dateFmt, t } from '../i18n';

/** Snapshot ca. `months` måneder tilbage (eller det ældste) */
export function snapshotAgo(p: Player, months: number) {
  const dev = p.dev ?? [];
  if (!dev.length) return null;
  return dev[Math.max(0, dev.length - 1 - months)];
}

/** Ændring i en attribut siden snapshot */
export function attrDelta(p: Player, idx: number, months: number): number {
  const s = snapshotAgo(p, months);
  if (!s) return 0;
  return Math.round((p.attrs[idx] - s.a[idx]) * 10) / 10;
}

/** Samlet udvikling (sum af ændringer i de 36 synlige attributter) */
export function totalDelta(p: Player, months: number): number {
  const s = snapshotAgo(p, months);
  if (!s) return 0;
  let d = 0;
  for (let i = 0; i < 36; i++) d += p.attrs[i] - s.a[i];
  return Math.round(d * 10) / 10;
}

export function Arrow({ d, small }: { d: number; small?: boolean }) {
  if (Math.abs(d) < (small ? 0.5 : 0.1)) return null;
  return <span className={`dev-arrow ${d > 0 ? 'up' : 'down'}`} title={`${d > 0 ? '+' : ''}${d.toFixed(1)}`}>{d > 0 ? '▲' : '▼'}{small ? '' : ` ${Math.abs(d).toFixed(1)}`}</span>;
}

/** Kurvefarver (valideret kategorisk palet, lys/mørk i styles.css) – fast rækkefølge pr. akse */
const SERIES = ['var(--dv-1)', 'var(--dv-2)', 'var(--dv-3)', 'var(--dv-4)', 'var(--dv-5)', 'var(--dv-6)'];

/** Monoton kubisk kurve gennem punkterne (bløde linjer uden at skyde over, Fritsch–Carlson) */
function smoothPath(pts: [number, number][]): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0][0]},${pts[0][1]}`;
  const dx = pts.slice(1).map((q, i) => q[0] - pts[i][0]);
  const sl = pts.slice(1).map((q, i) => (q[1] - pts[i][1]) / (dx[i] || 1));
  const m = pts.map((_, i) => (i === 0 ? sl[0] : i === n - 1 ? sl[n - 2] : sl[i - 1] * sl[i] <= 0 ? 0 : (sl[i - 1] + sl[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (sl[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / sl[i], b = m[i + 1] / sl[i], h = Math.hypot(a, b);
    if (h > 3) { m[i] = (3 * a * sl[i]) / h; m[i + 1] = (3 * b * sl[i]) / h; }
  }
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${pts[i][0] + h},${pts[i][1] + m[i] * h} ${pts[i + 1][0] - h},${pts[i + 1][1] - m[i + 1] * h} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
}

/** Spred etiketter lodret, så de ikke overlapper (min. afstand gap) inden for [lo, hi] */
function spread(ys: number[], gap: number, lo: number, hi: number): number[] {
  const order = ys.map((y, i) => [y, i] as const).sort((a, b) => a[0] - b[0]);
  const out = order.map(([y]) => Math.max(lo, y));
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1] + gap);
  // skub tilbage op, hvis de nederste er røget under bunden
  if (out.length && out[out.length - 1] > hi) {
    out[out.length - 1] = hi;
    for (let i = out.length - 2; i >= 0; i--) out[i] = Math.min(out[i], out[i + 1] - gap);
  }
  const res = new Array<number>(ys.length);
  order.forEach(([, idx], k) => { res[idx] = out[k]; });
  return res;
}

const narrowQuery = '(max-width: 600px)';
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(narrowQuery).matches);
  useEffect(() => {
    const m = matchMedia(narrowQuery);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

const fmtD = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`;

/**
 * Udvikling samlet i ét panel: samlet tal øverst, bløde kurver for profilens akser med
 * direkte etiketter (navn, niveau, ændring) og hover-tooltip – og de største ændringer som bjælker.
 */
export function DevelopmentPanel({ p, date }: { p: Player; date: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dev = [...(p.dev ?? []), { d: date, a: p.attrs.slice(0, 36) }];
  const isGK = p.pos[0] >= 15;
  const axes = RADAR_AXES.filter((a) => (isGK ? true : a.key !== 'goalkeeping'));
  const series = axes.map((ax) => dev.map((s) => ax.attrs.reduce((sum, i) => sum + s.a[i], 0) / ax.attrs.length));
  const all = series.flat();
  let lo = Math.floor(Math.min(...all) - 0.4), hi = Math.ceil(Math.max(...all) + 0.4);
  if (hi - lo < 2) { lo -= 1; hi += 1; }
  lo = Math.max(1, lo); hi = Math.min(20, hi);
  // smal skærm: et smallere koordinatsystem, så tekst og kurver bliver større
  const narrow = useNarrow();
  const W = narrow ? 400 : 640, H = narrow ? 260 : 250, L = 28, R = narrow ? 112 : 140, T = 12, B = 24;
  const x = (i: number) => L + (dev.length <= 1 ? (W - L - R) / 2 : (i / (dev.length - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const step = Math.max(1, Math.ceil((hi - lo) / 4));
  const ticks: number[] = [];
  for (let v = lo; v <= hi; v += step) ticks.push(v);
  const last = series.map((s) => s[s.length - 1]);
  const delta = series.map((s) => s[s.length - 1] - s[0]);
  const labelY = spread(last.map(y), narrow ? 30 : 25, T + 8, H - B - 4);
  const total = totalDelta(p, 999);
  const months = Math.max(0, dev.length - 1);

  const first = p.dev?.[0];
  const changes = first ? ATTRS.slice(0, 36)
    .map((k, i) => [k, Math.round((p.attrs[i] - first.a[i]) * 10) / 10] as const)
    .filter(([, d]) => Math.abs(d) >= 0.3)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 10) : [];
  const maxAbs = Math.max(0.5, ...changes.map(([, d]) => Math.abs(d)));
  // kun fremgang (eller kun tilbagegang): bjælkerne bruger hele bredden; blandet: fra en midterlinje
  const mixed = changes.some(([, d]) => d > 0) && changes.some(([, d]) => d < 0);

  const onMove = (e: React.PointerEvent) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || dev.length < 2) return;
    const vx = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((vx - L) / (W - L - R)) * (dev.length - 1));
    setHover(Math.max(0, Math.min(dev.length - 1, i)));
  };
  const dim = (si: number) => (focus !== null && focus !== si ? 0.22 : 1);
  const tipLeft = hover !== null ? (x(hover) / W) * 100 : 0;

  return (
    <div className="devp">
      <div className="devp-head">
        <div className="devp-hero">
          <span className={`devp-total ${total > 0 ? 'good' : total < 0 ? 'bad' : ''}`}>{total > 0 ? '▲' : total < 0 ? '▼' : ''} {Math.abs(total).toFixed(1)}</span>
          <span className="devp-sub">{t('dev.total')} · {t('dev.months', { n: months })}</span>
        </div>
        <div className="devp-legend" role="list">
          {axes.map((a, i) => (
            <button key={a.key} role="listitem" className={focus === i ? 'on' : ''} onMouseEnter={() => setFocus(i)} onMouseLeave={() => setFocus(null)} onClick={() => setFocus(focus === i ? null : i)}>
              <i style={{ background: SERIES[i] }} />{t(`radar.${a.key}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="devp-body">
        <div className="devp-chart">
          <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="devp-svg" role="img" aria-label={t('dev.chart')}
            onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
            <defs>
              {axes.map((a, i) => (
                <linearGradient key={a.key} id={`devp-g${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES[i]} stopOpacity={0.28} /><stop offset="100%" stopColor={SERIES[i]} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            {ticks.map((v) => (
              <g key={v}><line x1={L} x2={W - R + 8} y1={y(v)} y2={y(v)} className="devp-grid" /><text x={L - 8} y={y(v) + 4} textAnchor="end" className="devp-axis">{v}</text></g>
            ))}
            {focus !== null && (
              <path d={`${smoothPath(series[focus].map((v, i) => [x(i), y(v)]))} L${x(dev.length - 1)},${H - B} L${x(0)},${H - B} Z`} fill={`url(#devp-g${focus})`} />
            )}
            {series.map((ser, si) => (
              <path key={si} d={smoothPath(ser.map((v, i) => [x(i), y(v)]))} fill="none" stroke={SERIES[si]} strokeWidth={focus === si ? 3 : 2} strokeLinecap="round" opacity={dim(si)} style={{ transition: 'opacity .15s' }} />
            ))}
            {series.map((ser, si) => (
              <g key={si} opacity={dim(si)} onMouseEnter={() => setFocus(si)} onMouseLeave={() => setFocus(null)}>
                <circle cx={x(dev.length - 1)} cy={y(ser[ser.length - 1])} r={4.5} fill={SERIES[si]} className="devp-dot" />
                <path d={`M${x(dev.length - 1) + 6},${y(ser[ser.length - 1])} L${W - R + 14},${labelY[si]}`} className="devp-leader" />
                <text x={W - R + 18} y={labelY[si] - 2} className="devp-lbl">{t(`radar.${axes[si].key}`)}</text>
                <text x={W - R + 18} y={labelY[si] + (narrow ? 12 : 10)} className="devp-val">
                  {last[si].toFixed(1)} <tspan className={delta[si] > 0.05 ? 'devp-up' : delta[si] < -0.05 ? 'devp-down' : ''}>{delta[si] > 0.05 ? '▲' : delta[si] < -0.05 ? '▼' : '•'} {fmtD(delta[si])}</tspan>
                </text>
              </g>
            ))}
            {hover !== null && (
              <g pointerEvents="none">
                <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="devp-cross" />
                {series.map((ser, si) => <circle key={si} cx={x(hover)} cy={y(ser[hover])} r={4} fill={SERIES[si]} className="devp-dot" opacity={dim(si)} />)}
              </g>
            )}
            <text x={L} y={H - 6} className="devp-axis">{dateFmt(dev[0].d)}</text>
            <text x={W - R} y={H - 6} textAnchor="end" className="devp-axis">{t('dev.now')}</text>
          </svg>
          {hover !== null && (
            <div className="devp-tip" style={{ left: `${tipLeft}%`, transform: `translateX(${tipLeft > 55 ? 'calc(-100% - 12px)' : '12px'})` }}>
              <b>{hover === dev.length - 1 ? t('dev.now') : dateFmt(dev[hover].d)}</b>
              {series.map((ser, si) => [si, ser[hover]] as const).sort((a, b) => b[1] - a[1]).map(([si, v]) => (
                <div key={si}><i style={{ background: SERIES[si] }} />{t(`radar.${axes[si].key}`)}<span>{v.toFixed(1)}</span></div>
              ))}
            </div>
          )}
        </div>
        <div className="devp-changes">
          <div className="devp-ctitle">{t('dev.changes')}</div>
          {changes.length === 0 && <div className="muted">{t('dev.noChange')}</div>}
          {changes.map(([k, d]) => (
            <div key={k} className="devp-row" title={`${t(`attr.${k}`)} ${fmtD(d)}`}>
              <span className="devp-name">{t(`attr.${k}`)}</span>
              <span className={`devp-track ${mixed ? 'mixed' : ''}`}>
                <i className={d > 0 ? 'up' : 'down'} style={{ width: `${(Math.abs(d) / maxAbs) * (mixed ? 50 : 100)}%` }} />
              </span>
              <span className={`devp-num ${d > 0 ? 'good' : 'bad'}`}>{fmtD(d)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
