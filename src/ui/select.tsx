// Pæn og søgbar vælger til lange lister (lande, ligaer, attributter, scoutmål).
// Tastatur: ↑↓ flytter, Enter vælger, Esc lukker, og man kan skrive for at søge.
import { Flag } from './components';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n';

export interface Opt<V extends string | number> {
  value: V;
  label: string;
  group?: string;
  /** lille tekst til højre (fx landekode) */
  hint?: string;
  /** landets navn (databasen) – viser flaget foran teksten */
  flag?: string;
}

export function Select<V extends string | number>({ value, onChange, options, placeholder, width, title, icon }: {
  value: V;
  onChange: (v: V) => void;
  options: Opt<V>[];
  placeholder?: string;
  width?: number | string;
  title?: string;
  icon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; up: boolean }>({ top: 0, left: 0, width: 240, up: false });
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);
  const searchable = options.length > 10;
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter((o) => o.label.toLowerCase().includes(s) || o.group?.toLowerCase().includes(s) || o.hint?.toLowerCase().includes(s)) : options;
  }, [q, options]);

  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const w = Math.max(r.width, 240);
    const below = window.innerHeight - r.bottom;
    const up = below < 280 && r.top > below;
    setPos({ top: up ? r.top - 6 : r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), width: w, up });
  };
  const openIt = () => { place(); setQ(''); setHi(Math.max(0, options.findIndex((o) => o.value === value))); setOpen(true); };
  const choose = (o: Opt<V>) => { onChange(o.value); setOpen(false); btn.current?.focus(); };

  useLayoutEffect(() => {
    if (!open) return;
    list.current?.querySelector('.sel-opt.hi')?.scrollIntoView({ block: 'nearest' });
  }, [open, hi]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    const re = () => place();
    document.addEventListener('mousedown', close);
    window.addEventListener('resize', re);
    window.addEventListener('scroll', re, true);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('resize', re); window.removeEventListener('scroll', re, true); };
  }, [open]);

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openIt(); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); btn.current?.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(shown.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const o = shown[hi]; if (o) choose(o); }
    else if (!searchable && e.key.length === 1 && /\S/.test(e.key)) {
      // korte lister: hop til næste valg der starter med bogstavet
      const k = e.key.toLowerCase();
      const n = shown.length;
      for (let i = 1; i <= n; i++) { const j = (hi + i) % n; if (shown[j].label.toLowerCase().startsWith(k)) { setHi(j); break; } }
    }
  };

  let lastGroup: string | undefined;
  return (
    <>
      <button ref={btn} type="button" className={`sel ${open ? 'open' : ''}`} style={{ width }} title={title} onClick={() => (open ? setOpen(false) : openIt())} onKeyDown={onKey} aria-haspopup="listbox" aria-expanded={open}>
        {icon}<span className="sel-label">{current?.label ?? placeholder ?? ''}</span>
        <svg viewBox="0 0 20 20" className="sel-chev" aria-hidden="true"><path d="M5 7.5l5 5 5-5" /></svg>
      </button>
      {open && (
        <div ref={pop} className={`sel-pop ${pos.up ? 'up' : ''}`} style={{ top: pos.top, left: pos.left, width: pos.width }} onKeyDown={onKey}>
          {searchable && (
            <input autoFocus className="sel-search" placeholder={t('select.search')} value={q} onChange={(e) => { setQ(e.target.value); setHi(0); }} />
          )}
          <div className="sel-list" role="listbox" ref={list} tabIndex={-1} autoFocus={!searchable}>
            {shown.length === 0 && <div className="sel-empty">{t('select.none')}</div>}
            {shown.map((o, i) => {
              const head = o.group && o.group !== lastGroup ? o.group : null;
              lastGroup = o.group;
              return (
                <div key={`${o.group ?? ''}${o.value}`}>
                  {head && <div className="sel-group">{head}</div>}
                  <div role="option" aria-selected={o.value === value} className={`sel-opt ${i === hi ? 'hi' : ''} ${o.value === value ? 'on' : ''}`}
                    onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); choose(o); }}>
                    <span>{o.flag && <Flag name={o.flag} />}{o.label}</span>
                    {o.hint && <span className="sel-hint">{o.hint}</span>}
                    {o.value === value && <span className="sel-check">✓</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
