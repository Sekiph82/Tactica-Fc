// Hjælp: en guide med emner der forklarer spillets mekanikker, og små ⓘ-knapper ved de vigtige tal.
// Teksterne (help.<emne>.title/short/intro/tips) beskriver de faktiske regler i spilkoden.
import { useEffect, useRef, useState } from 'react';
import { has, t } from '../i18n';
import { Panel } from './components';
import { useNav, useRouteState } from './core';
import { Head } from './screens/common';

export const HELP_TOPICS = [
  'rep', 'managerRep', 'board', 'fans', 'morale', 'condition', 'chemistry', 'development',
  'youth', 'finance', 'tickets', 'transfers', 'scouting', 'press', 'score',
] as const;
export type HelpTopic = (typeof HELP_TOPICS)[number];

function TopicBody({ id }: { id: HelpTopic }) {
  const tips = has(`help.${id}.tips`) ? t(`help.${id}.tips`).split('|') : [];
  return (
    <div className="help-body">
      <p className="help-short">{t(`help.${id}.short`)}</p>
      {has(`help.${id}.intro`) && <p>{t(`help.${id}.intro`)}</p>}
      {tips.length > 0 && <ul>{tips.map((x, i) => <li key={i}>{x.trim()}</li>)}</ul>}
    </div>
  );
}

/** Lille ⓘ-knap med en kort forklaring og link til hele emnet */
export function Info({ topic }: { topic: HelpTopic }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const ref = useRef<HTMLSpanElement>(null);
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    // fast placering (paneler klipper indhold), holdt inden for skærmen
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const w = Math.min(300, window.innerWidth - 24);
    setPos({ top: Math.min(r.bottom + 8, window.innerHeight - 200), left: Math.max(12, Math.min(r.left - 10, window.innerWidth - w - 12)) });
    setOpen(!open);
  };
  const { nav } = useNav();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <span className="info" ref={ref}>
      <button className="info-btn" aria-label={t('help.what', { topic: t(`help.${topic}.title`) })} onClick={toggle}>i</button>
      {open && (
        <span className="info-pop" role="dialog" style={{ top: pos.top, left: pos.left }} onClick={(e) => e.stopPropagation()}>
          <b>{t(`help.${topic}.title`)}</b>
          <span>{t(`help.${topic}.short`)}</span>
          <a className="link" onClick={() => { setOpen(false); nav({ name: 'help', id: topic }); }}>{t('help.readMore')} →</a>
        </span>
      )}
    </span>
  );
}

export function HelpScreen({ id }: { id?: string }) {
  const [topic, setTopic] = useRouteState<HelpTopic>('topic', (HELP_TOPICS as readonly string[]).includes(id ?? '') ? (id as HelpTopic) : 'rep');
  return (
    <div>
      <Head title={t('nav.help')} />
      <div className="help-layout">
        <Panel className="flush help-nav">
          {HELP_TOPICS.map((k) => (
            <button key={k} className={`help-item ${topic === k ? 'on' : ''}`} onClick={() => setTopic(k)}>{t(`help.${k}.title`)}</button>
          ))}
        </Panel>
        <Panel title={t(`help.${topic}.title`)}>
          <TopicBody id={topic} />
        </Panel>
      </div>
    </div>
  );
}
