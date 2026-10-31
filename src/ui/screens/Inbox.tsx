
import { FirstDay } from '../FirstDay';
import { useEffect, useRef, useState } from 'react';
import { onFocusNews, takeFocus } from '../inboxFocus';
import { act } from '../../game/actions';
import { useHotkeys } from '../hotkeys';
import { dateFmt, money, t } from '../../i18n';
import { Empty, Modal, Panel } from '../components';
import { notify } from '../../game/state';
import { useGame, useRouteState } from '../core';
import { Head, NewsBody, NewsDeals, NewsTitle, newsBody, newsTitle, useOpenLink } from './common';
import { AiArticle } from '../aiArticle';
import { NewsIcon } from '../icons';
import type { NewsCategory, NewsItem } from '../../game/types';

/** Kategorier, der kan dæmpes (bestyrelse, job, kontrakter og transfers kræver ofte svar – transfers styres af transferfilteret) */
const MUTABLE: NewsCategory[] = ['match', 'injury', 'scout', 'award', 'youth', 'finance', 'general'];

const CATS: (NewsCategory | 'all')[] = ['all', 'match', 'transfer', 'contract', 'injury', 'board', 'scout', 'award', 'youth', 'job', 'general'];

export function Inbox() {
  const g = useGame()!;
  const [cat, setCat] = useRouteState<NewsCategory | 'all'>('cat', 'all');
  // altid den ældste uåbnede besked først (listen er sorteret nyeste øverst)
  const oldestUnread = () => g.news.filter((n) => !n.read).pop()?.id;
  const [sel, setSel] = useRouteState<number | null>('sel', () => takeFocus() ?? oldestUnread() ?? g.news[0]?.id ?? null);
  const open = useOpenLink();
  const list = g.news.filter((n) => (cat === 'all' ? !n.muted : n.cat === cat));
  const [settings, setSettings] = useState(false);
  const item = g.news.find((n) => n.id === sel);
  if (item && !item.read) queueMicrotask(() => act({ t: 'read', ids: [item.id] }));
  const listRef = useRef<HTMLDivElement>(null);
  const shown = list.slice(0, 200);
  // Fortsæt-knappen: vis den næste ulæste besked
  useEffect(() => {
    const show = (id: number) => {
      setCat('all');
      setSel(id);
      requestAnimationFrame(() => listRef.current?.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' }));
    };
    const f = takeFocus() ?? oldestUnread();
    if (f !== undefined && f !== null) show(f);
    return onFocusNews((id) => { takeFocus(); show(id); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const move = (dir: number) => {
    if (!shown.length) return;
    const i = shown.findIndex((n) => n.id === sel);
    const next = shown[Math.max(0, Math.min(shown.length - 1, i < 0 ? 0 : i + dir))];
    setSel(next.id);
    requestAnimationFrame(() => listRef.current?.querySelector(`[data-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest' }));
  };
  useHotkeys((e) => {
    if (e.key === 'ArrowDown' || e.key === 'j') { move(1); return true; }
    if (e.key === 'ArrowUp' || e.key === 'k') { move(-1); return true; }
    if (e.key === 'Enter' && item?.link) { open(item); return true; }
    if (e.key === 'ArrowRight') {
      // næste ulæste
      const next = shown.filter((n) => !n.read && n.id !== sel).pop();
      if (next) { setSel(next.id); requestAnimationFrame(() => listRef.current?.querySelector(`[data-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest' })); }
      return true;
    }
  });

  return (
    <div>
      <Head title={t('nav.inbox')}>
        <select value={cat} onChange={(e) => setCat(e.target.value as NewsCategory | 'all')}>
          {CATS.map((c) => <option key={c} value={c}>{t(`cat.${c}`)}</option>)}
        </select>
        <span className="muted kbd-hint">{t('inbox.keys')}</span>
        <button className="small" onClick={() => act({ t: 'read', ids: 'all' })}>{t('inbox.markRead')}</button>
        <button className="small" onClick={() => setSettings(true)}>⚙ {t('inbox.settings')}</button>
      </Head>
      {settings && <NewsSettings onClose={() => setSettings(false)} />}
      <FirstDay />
      <div className="cols2">
        <Panel title={t('inbox.messages')} className="flush">
          {list.length === 0 && <Empty text={t('inbox.empty')} />}
          <div style={{ maxHeight: '70vh', overflowY: 'auto' }} ref={listRef}>
            {shown.map((n) => (
              <button type="button" key={n.id} data-id={n.id} aria-current={sel === n.id ? 'true' : undefined} className={`news-item ${n.read ? '' : 'unread'} ${sel === n.id ? 'selected' : ''} ${n.key.startsWith('window.') ? 'news-window' : ''}`} onClick={() => setSel(n.id)}>
                <NewsIcon newsKey={n.key} cat={n.cat} />
                <span className="date">{dateFmt(n.date)}</span>
                <span className="title">{newsTitle(n)}</span>
              </button>
            ))}
          </div>
        </Panel>
        <Panel title={item ? dateFmt(item.date, true) : ''}>
          {item ? (
            <div className="col">
              <h3 style={{ color: 'var(--accent)', display: 'flex', gap: 10, alignItems: 'center' }} className="news-head"><NewsIcon newsKey={item.key} cat={item.cat} /><span><NewsTitle n={item} /></span></h3>
              {newsBody(item) && <p style={{ lineHeight: 1.5, whiteSpace: 'pre-line' }}><NewsBody n={item} /></p>}
              <NewsDeals n={item} />
              <WarRaise item={item} />
              <AiArticle item={item} />
              {item.link && <div><button onClick={() => open(item)}>{t('inbox.open')}</button></div>}
            </div>
          ) : <Empty text={t('inbox.select')} />}
        </Panel>
      </div>
    </div>
  );
}

/** Budkrig: hæv dit bud én gang – blindt – før afsløringen */
function WarRaise({ item }: { item: NewsItem }) {
  const g = useGame()!;
  const [amount, setAmount] = useState(0);
  const [res, setRes] = useState('');
  let cur = 0, raised = false, wage = false, max = 0, send: ((v: number) => string) | null = null;
  if (item.key === 'war.started' || item.key === 'war.startedWage') {
    const o = g.offers.find((x) => x.id === Number(item.params.oid));
    if (!o || o.buyer !== g.userClub || o.status !== 'pending' || !(o.auction || o.war)) return null;
    wage = !!o.signing;
    cur = wage ? o.signing!.wage : o.fee;
    raised = !!o.raised;
    max = wage ? Math.round(cur * 1.6) : Math.min(g.clubs[g.userClub].transferBudget, Math.round(cur * 1.6));
    send = (v) => act<string>({ t: 'raiseBid', offer: o.id, amount: v });
  } else if (item.key === 'war.staffStarted') {
    const b = g.staffBids?.find((x) => x.staff === Number(item.params.sid) && x.club === g.userClub);
    if (!b || !b.war) return null;
    wage = true;
    cur = b.wage ?? 0;
    raised = !!b.raised;
    max = Math.round(cur * 1.6);
    send = (v) => act<string>({ t: 'raiseStaff', staff: b.staff, wage: v });
  } else return null;
  const step = wage ? 50 : 50_000;
  const v = Math.min(max, Math.max(amount || cur, cur));
  return (
    <div className="war-box">
      <div className="war-title">⚔️ {t('war.boxTitle')}</div>
      <div>{t(wage ? 'war.boxCurWage' : 'war.boxCur', { amount: money(cur) })}</div>
      {raised ? <div className="muted">{t('war.boxRaised')}</div> : max > cur ? (
        <>
          <label>{t('war.boxNew')}: <b className="accent">{money(v)}</b>{wage ? ` / ${t('common.week')}` : ''} (+{Math.round(((v - cur) / Math.max(1, cur)) * 100)}%)
            <input type="range" min={cur} max={max} step={step} value={v} onChange={(e) => setAmount(Number(e.target.value))} style={{ width: '100%' }} />
          </label>
          <div className="row">
            <button className="primary" disabled={v <= cur || !send} onClick={() => setRes(send!(v))}>{t('war.boxRaise')}</button>
            <span className="muted">{t('war.boxOnce')}</span>
          </div>
        </>
      ) : <div className="muted">{t('war.boxNoRoom')}</div>}
      {res && res !== 'ok' && <div className="bad">{t(`war.err.${res}`) !== `war.err.${res}` ? t(`war.err.${res}`) : t(res)}</div>}
    </div>
  );
}

/** Hvilke og hvor mange nyheder man får – direkte fra indbakken */
function NewsSettings({ onClose }: { onClose: () => void }) {
  const g = useGame()!;
  const muted = new Set(g.options.mutedNews ?? []);
  const toggle = (c: NewsCategory) => {
    const on = !muted.has(c);
    g.options.mutedNews = on ? [...muted, c] : [...muted].filter((x) => x !== c);
    // også de beskeder, der allerede ligger i indbakken
    for (const n of g.news) if (n.cat === c) { n.muted = on || undefined; if (on) n.read = true; }
    notify();
  };
  return (
    <Modal title={t('inbox.settings')} onClose={onClose}>
      <div className="col news-settings">
        <label className="row">{t('opt.news')}
          <select value={g.options.newsScope ?? 'league'} onChange={(e) => { g.options.newsScope = e.target.value as 'nation'; notify(); }}>
            {(['league', 'nation', 'world'] as const).map((m) => <option key={m} value={m}>{t(`opt.news.${m}`)}</option>)}
          </select>
        </label>
        <label className="row">{t('opt.transferNews')}
          <select value={g.options.transferNews ?? 'big'} onChange={(e) => { g.options.transferNews = e.target.value as 'big'; notify(); }}>
            {(['own', 'big', 'all'] as const).map((m) => <option key={m} value={m}>{t(`opt.transferNews.${m}`)}</option>)}
          </select>
        </label>
        <div>
          <b>{t('inbox.categories')}</b>
          <div className="muted" style={{ fontSize: 12.5, margin: '2px 0 8px' }}>{t('inbox.mutedHint')}</div>
          <div className="news-cats">
            {MUTABLE.map((c) => (
              <label key={c} className={`choice ${muted.has(c) ? '' : 'on'}`}>
                <input type="checkbox" checked={!muted.has(c)} onChange={() => toggle(c)} />{t(`cat.${c}`)}
              </label>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
