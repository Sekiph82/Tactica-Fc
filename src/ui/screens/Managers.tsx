// Managere: dem man spiller med (mennesker og AI-managere) – stilling og beskeder.
import { useEffect, useRef, useState } from 'react';
import { act } from '../../game/actions';
import { clubOf, managerName } from '../../game/chat';
import { h2hFor } from '../../game/h2h';
import { finalOrder } from '../../game/competitions';
import { squad } from '../../game/state';
import type { ChatMsg } from '../../game/types';
import { dateFmt, has, t } from '../../i18n';
import { session } from '../../online/client';
import { ClubLink, Crest, Panel, mgrHue } from '../components';
import { useGame, useNav } from '../core';
import { Select } from '../select';
import { Head, LinkedText } from './common';
import { JAB_LINES, nextMeeting } from '../../game/rivalry';
import { money } from '../../i18n';

interface Line { id: string; mine: boolean; who: string; text: string; when: string }

/** Tekst for en besked: menneskers egen tekst eller AI-managerens tekstnøgle på læserens sprog */
export function chatText(m: ChatMsg): string {
  if (m.text) return m.text;
  const v = m.params?.v;
  const key = v && has(`${m.key}.${v}`) ? `${m.key}.${v}` : m.key ?? '';
  return t(key, m.params);
}

export function ManagersScreen() {
  const g = useGame()!;
  const { nav, route } = useNav();
  const s = session();
  const me = g.active ?? '';
  const others = (g.humans ?? []).filter((h) => h.pid !== me);
  const humansOnline = others.filter((h) => !h.bot).length > 0 && !!s;
  const [sel, setSel] = useState<string>(() => String(route.id ?? others[0]?.pid ?? ''));
  useEffect(() => { if (route.id) setSel(String(route.id)); }, [route.id]);
  const target = others.find((h) => h.pid === sel);
  const isAll = sel === 'all';

  // samtalen: spiltilstanden (AI-managere/lokalt) eller serveren (mennesker online)
  // (spiltilstanden ændres på stedet, så samtalen beregnes ved hver visning)
  const lines: Line[] = (() => {
    if (isAll) return (s?.room?.chat ?? []).filter((m) => m.to === 'all').map((m) => ({ id: `s${m.id}`, mine: m.from === me, who: m.name, text: m.text, when: new Date(m.at).toLocaleString() }));
    if (!target) return [];
    if (!target.bot && s) {
      return (s.room?.chat ?? []).filter((m) => (m.from === me && m.to === target.pid) || (m.from === target.pid && m.to === me))
        .map((m) => ({ id: `s${m.id}`, mine: m.from === me, who: m.name, text: m.text, when: new Date(m.at).toLocaleString() }));
    }
    return (g.chat ?? []).filter((m) => (m.from === me && m.to === target.pid) || (m.from === target.pid && m.to === me))
      .map((m) => ({ id: `g${m.id}`, mine: m.from === me, who: managerName(m.from), text: chatText(m), when: dateFmt(m.date) }));
  })();

  // markér som læst, når samtalen vises
  useEffect(() => {
    const last = g.chat?.at(-1)?.id ?? 0;
    if (last > (g.chatRead ?? 0) && g.chat?.some((m) => m.to === me && m.id > (g.chatRead ?? 0))) act({ t: 'chatRead' });
    if (s && s.unreadChat() > 0) s.markChatSeen();
  });

  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [lines.length, sel]);

  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const send = async (msg = text) => {
    const m = msg.trim();
    if (!m) return;
    setErr('');
    try {
      if (isAll || (target && !target.bot && s)) await s!.sendChat(isAll ? 'all' : target!.pid, m);
      else if (target) act({ t: 'chat', to: target.pid, text: m });
      setText('');
    } catch (e) { setErr(String((e as Error).message)); }
  };

  if (!g.humans || others.length === 0) {
    return (
      <div>
        <Head title={t('nav.managers')} />
        <div className="empty">{t('chat.nobody')}</div>
        <button onClick={() => nav({ name: 'ranking', tab: 'managers' })}>{t('bots.add')}</button>
      </div>
    );
  }

  const tclub = target ? clubOf(target.pid) : 0;
  const myClub = g.userClub;
  const comp = tclub ? g.comps[g.clubs[tclub]?.league] : undefined;
  const pos = comp ? finalOrder(comp).indexOf(tclub) + 1 : 0;
  const theirPlayers = tclub ? squad(tclub).slice().sort((a, b) => b.ca - a.ca) : [];
  const myPlayers = myClub ? squad(myClub).slice().sort((a, b) => b.ca - a.ca) : [];
  const unreadFrom = (pid: string) => (g.chat ?? []).filter((m) => m.from === pid && m.to === me && m.id > (g.chatRead ?? 0)).length
    + (s ? (s.room?.chat ?? []).filter((m) => m.from === pid && m.to === me && m.id > s.chatSeen()).length : 0);

  return (
    <div>
      <Head title={t('nav.managers')}>
        <button className="small" onClick={() => nav({ name: 'ranking', tab: 'managers' })}>{t('chat.standings')}</button>
      </Head>
      <div className="chat-layout">
        <div className="chat-people">
          {humansOnline && (
            <button className={`chat-person ${isAll ? 'on' : ''}`} onClick={() => setSel('all')}>
              <span className="chat-avatar all">★</span>
              <span className="grow"><b>{t('chat.everyone')}</b><span className="muted">{t('chat.everyoneHint')}</span></span>
            </button>
          )}
          {others.map((h) => {
            const c = clubOf(h.pid);
            const n = unreadFrom(h.pid);
            return (
              <button key={h.pid} className={`chat-person ${sel === h.pid ? 'on' : ''}`} onClick={() => setSel(h.pid)}>
                <span className={`chat-avatar ${h.bot ? 'ai' : ''}`} style={{ ['--h' as string]: mgrHue(h.name) } as React.CSSProperties}>{h.bot ? 'AI' : h.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</span>
                <span className="grow">
                  <b>{h.name}</b>
                  <span className="muted">{c ? g.clubs[c]?.name : t('bots.unemployed')}{h.bot ? ` · ${t(`bots.style.${h.bot.style}`)}` : ''}</span>
                </span>
                {n > 0 && <span className="badge">{n}</span>}
              </button>
            );
          })}
        </div>

        <Panel title={isAll ? t('chat.everyone') : target ? t('chat.with', { name: target.name }) : ''} className="chat-panel">
          {target && (
            <div className="chat-head">
              {tclub ? <><Crest id={tclub} size={28} /><ClubLink id={tclub} long /></> : <span className="muted">{t('bots.unemployed')}</span>}
              {pos > 0 && <span className="muted">{t('chat.pos', { pos, league: comp?.name ?? '' })}</span>}
              {target.bot && <span className="muted">{t(`bots.style.${target.bot.style}.hint`)}</span>}
            </div>
          )}
          {target && (() => {
            const h = h2hFor(me, target.pid);
            return (
              <div className="h2h">
                <span className="h2h-label">{t('h2h.title')}</span>
                {!h ? <span className="muted">{t('h2h.none')}</span> : (
                  <>
                    <span className="h2h-score"><b className="good">{h.w}</b> {t('h2h.w')} · <b>{h.d}</b> {t('h2h.d')} · <b className="bad">{h.l}</b> {t('h2h.l')}</span>
                    <span className="muted">{t('h2h.goals', { gf: h.gf, ga: h.ga })}</span>
                    {h.best && <span className="muted">{t('h2h.best', { score: `${h.best[0]}-${h.best[1]}`, date: dateFmt(h.best[2]) })}</span>}
                    {h.worst && <span className="muted">{t('h2h.worst', { score: `${h.worst[1]}-${h.worst[0]}`, date: dateFmt(h.worst[2]) })}</span>}
                    {h.last && <span className="muted">{t('h2h.last', { score: `${h.last.gf}-${h.last.ga}`, comp: h.last.comp, date: dateFmt(h.last.date) })}</span>}
                  </>
                )}
              </div>
            );
          })()}
          {target && tclub > 0 && myClub > 0 && !g.draft && <Rivalry pid={target.pid} tclub={tclub} />}
          <div className="chat-thread" ref={box}>
            {lines.length === 0 && <div className="muted" style={{ textAlign: 'center', padding: 20 }}>{t(target?.bot ? 'chat.emptyAi' : 'chat.empty')}</div>}
            {lines.map((l) => (
              <div key={l.id} className={`chat-msg ${l.mine ? 'mine' : ''}`}>
                {!l.mine && <div className="chat-who">{l.who}</div>}
                <div className="chat-bubble"><LinkedText text={l.text} clubs={[myClub, tclub].filter(Boolean)} /></div>
                <div className="chat-when">{l.when}</div>
              </div>
            ))}
          </div>
          {target && !isAll && (
            <div className="chat-quick">
              <button className="small" onClick={() => send(t('chat.q.hello'))}>{t('chat.q.hello')}</button>
              <button className="small" onClick={() => send(t('chat.q.luck'))}>{t('chat.q.luck')}</button>
              {theirPlayers.length > 0 && !g.draft && (
                <Select<number> value={0} width={230} placeholder={t('chat.q.askPlayer')}
                  options={theirPlayers.map((p) => ({ value: p.id, label: `${p.first} ${p.last}` }))}
                  onChange={(id) => { const p = g.players[id]; if (p) setText(t('chat.q.askPrice', { player: `${p.first} ${p.last}` })); }} />
              )}
              {myPlayers.length > 0 && !g.draft && (
                <Select<number> value={0} width={230} placeholder={t('chat.q.offerPlayer')}
                  options={myPlayers.map((p) => ({ value: p.id, label: `${p.first} ${p.last}` }))}
                  onChange={(id) => { const p = g.players[id]; if (p) setText(t('chat.q.offer', { player: `${p.first} ${p.last}` })); }} />
              )}
            </div>
          )}
          <form className="chat-input" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder={t(target?.bot ? 'chat.placeholderAi' : 'chat.placeholder')} />
            <button type="submit" className="primary" disabled={!text.trim()}>{t('chat.send')}</button>
          </form>
          {err && <div className="insight bad">{err}</div>}
        </Panel>
      </div>
    </div>
  );
}

/** Rivalisering: stikpiller i pressen og prestige-væddemål om næste indbyrdes kamp */
function Rivalry({ pid, tclub }: { pid: string; tclub: number }) {
  const g = useGame()!;
  const me = g.active ?? '';
  const [msg, setMsg] = useState<{ text: string; tone: string } | null>(null);
  const myClub = g.userClub;
  const f = nextMeeting(myClub, tclub);
  const theirName = managerName(pid);
  const club = g.clubs[tclub];
  const bets = (g.bets ?? []).filter((b) => ((b.from === me && b.to === pid) || (b.from === pid && b.to === me)) && ['proposed', 'accepted'].includes(b.status));
  const bal = g.clubs[myClub]?.balance ?? 0;
  const amounts = [100_000, 500_000, 1_000_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000].filter((a) => a <= bal * 0.25);
  const say = (r0: string, params: Record<string, string | number> = {}) => { const r = r0 === 'error' ? 'riv.error' : r0; setMsg({ text: t(r, { name: theirName, ...params }), tone: /ok|accepted|sent/i.test(r) ? 'good' : /declined|tooSoon|noMoney|noMatch|exists|error/.test(r) ? 'warn' : '' }); };
  return (
    <div className="rivalry">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className="h2h-label">{t('riv.title')}</span>
        <span className="muted">{f ? t('riv.next', { date: dateFmt(f.date), comp: g.comps[f.comp]?.name ?? '' }) : t('riv.noMatch')}</span>
        <Select<number> value={-1} width={260} placeholder={t('riv.jab')}
          options={Array.from({ length: JAB_LINES }, (_, i) => ({ value: i, label: t(`jab.line.${i}`, { club: club?.short ?? '', name: theirName }) }))}
          onChange={(i) => { const text = t(`jab.line.${i}`, { club: club?.short ?? '', name: theirName }); say(act<string>({ t: 'jab', to: pid, line: i, text })); }} />
        {f && amounts.length > 0 && (
          <Select<number> value={0} width={220} placeholder={t('riv.bet')}
            options={amounts.map((a) => ({ value: a, label: t('riv.betAmount', { fee: money(a) }) }))}
            onChange={(a) => say(act<string>({ t: 'bet', to: pid, amount: a }), { fee: money(a) })} />
        )}
      </div>
      {bets.map((b) => (
        <div key={b.id} className="row" style={{ gap: 8, marginTop: 6 }}>
          <span>🎲 {t(b.status === 'accepted' ? 'riv.betOn' : b.from === me ? 'riv.betWaiting' : 'riv.betOffered', { fee: money(b.amount), name: theirName, date: dateFmt(g.fixtures[b.fixture]?.date ?? g.date) })}</span>
          {b.status === 'proposed' && b.to === me && <>
            <button className="small primary" onClick={() => say(act<string>({ t: 'betAnswer', id: b.id, accept: true }))}>{t('riv.accept')}</button>
            <button className="small" onClick={() => say(act<string>({ t: 'betAnswer', id: b.id, accept: false }))}>{t('riv.decline')}</button>
          </>}
        </div>
      ))}
      {msg && <div className={`insight ${msg.tone}`} style={{ marginTop: 6 }}>{msg.text}</div>}
    </div>
  );
}
