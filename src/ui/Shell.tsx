import { BoardScreen } from './screens/Board';
import { stopVoice } from '../online/voice';
import { RoomChat } from './RoomChat';
import { draftRoundLabel } from './Draft';
import { DraftLeagueScreen } from './Draft';
import { refreshSupport, syncSupporterRegens } from '../online/support';
import { SupportPage } from './Support';
import { Head } from './screens/common';
import { ProfileScreen } from './screens/Profile';
import { BugReportButton, CommunityBoard } from './Community';
import { APP_VERSION } from './changelogData';
import { askConfirm } from './confirm';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushAutosave, forgetLast, saveGame, scheduleAutosave } from '../game/save';
import { runUntil } from '../game/sim';
import { gs, hasGame, notify, setGame, subscribe } from '../game/state';
import { dateFmt, money, t } from '../i18n';
import { Crest } from './components';
import { Icon } from './icons';
import { Lobby, OnlineControls } from './Online';
import { closeSession, session } from '../online/client';
import { submitPending } from '../online/rank';
import { focusNews } from './inboxFocus';
import { act } from '../game/actions';
import { setScrollElement, useGame, useNav, type ScreenName } from './core';
import { Inbox } from './screens/Inbox';
import { Squad } from './screens/Squad';
import { PlayerScreen } from './screens/PlayerScreen';
import { Tactics } from './screens/Tactics';
import { Training } from './screens/Training';
import { Fixtures } from './screens/Fixtures';
import { Competitions } from './screens/Competitions';
import { Transfers } from './screens/Transfers';
import { Scouting } from './screens/Scouting';
import { StaffScreen } from './screens/Staff';
import { Finance } from './screens/Finance';
import { ClubScreen } from './screens/Club';
import { Assistant } from './screens/Assistant';
import { MatchScreen } from './screens/Match';
import { ReportScreen } from './screens/Report';
import { History } from './screens/History';
import { Awards } from './screens/Awards';
import { Jobs } from './screens/Jobs';
import { Options } from './screens/Options';
import { PressScreen } from './screens/Press';
import { RankingScreen } from './screens/Ranking';
import { ManagersScreen } from './screens/Managers';
import { unreadChat } from '../game/chat';
import { HelpScreen } from './help';
import { VersionButton } from './Changelog';
import { prefetchArticles } from './aiArticle';
import { applyTheme, setThemeClub } from './theme';
import { canInstall, installApp, notifyAskable, notifyEnabled, notifyUser, onInstallChange, setNotify } from './notify';
import { newsTitle } from './screens/common';

/** Nyheder der giver en browser-notifikation */
const NOTIFY_KEYS = ['window.opened', 'window.deadlineDay', 'window.closingTomorrow', 'transfer.incomingBid', 'transfer.bidAccepted', 'transfer.bidCountered', 'auction.', 'signing.', 'staff.bid', 'job.invite', 'news.jobOffer', 'board.sacked', 'board.warning', 'jab.received', 'bet.proposed', 'chat.news', 'trophy.board', 'will.complain'];

const MENU: [ScreenName, string][] = [
  ['inbox', 'nav.inbox'], ['squad', 'nav.squad'], ['tactics', 'nav.tactics'], ['training', 'nav.training'],
  ['fixtures', 'nav.fixtures'], ['competitions', 'nav.competitions'], ['transfers', 'nav.transfers'], ['scouting', 'nav.scouting'],
  ['assistant', 'nav.assistant'], ['staff', 'nav.staff'], ['finance', 'nav.finance'], ['club', 'nav.club'], ['board', 'nav.board'],
];
const MENU2: [ScreenName, string][] = [['community', 'nav.community'], ['support', 'nav.support'], ['profile', 'nav.profile'], ['ranking', 'nav.ranking'], ['awards', 'nav.awards'], ['history', 'nav.history'], ['jobs', 'nav.jobs'], ['help', 'nav.help'], ['options', 'nav.options']];
/** Menuen i grupper (indbakken står altid øverst, hjælp og indstillinger nederst) */
const GROUPS: { key: string; items: ScreenName[] }[] = [
  { key: 'team', items: ['squad', 'tactics', 'training', 'assistant'] },
  { key: 'matches', items: ['draft', 'fixtures', 'competitions'] },
  { key: 'market', items: ['transfers', 'scouting'] },
  { key: 'club', items: ['club', 'board', 'finance', 'staff'] },
  { key: 'manager', items: ['profile', 'ranking', 'awards', 'history', 'jobs'] },
  { key: 'community', items: ['community', 'support'] },
];
const ALL_ITEMS = { ...Object.fromEntries([...MENU, ...MENU2]), draft: 'nav.draft' } as Record<ScreenName, string>;
const DRAFT_SCREENS: ScreenName[] = ['inbox', 'squad', 'tactics', 'assistant', 'draft', 'fixtures', 'competitions', 'community', 'support', 'help', 'options', 'managers'];
const GROUP_KEY = 'cm-nav-closed';
const UNEMPLOYED: ScreenName[] = ['support', 'community', 'profile', 'inbox', 'competitions', 'jobs', 'history', 'options', 'transfers', 'awards', 'ranking', 'help', 'managers'];

export function Shell() {
  const g = useGame()!;
  const { route, nav, back, canBack } = useNav();
  const showBack = canBack || route.name !== 'inbox';
  // på selve kampskærmen styres kampen derinde – "Til kampen"/"Næste kamp" giver ingen mening dér
  const inMatch = route.name === 'match' && !!g.pendingFixture && (route as { id?: number }).id === g.pendingFixture;
  const [menuOpen, setMenuOpen] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const stopRef = useRef(false);
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => { setScrollElement(mainRef.current); return () => setScrollElement(null); }, []);
  useLayoutEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = route.scroll ?? 0;
  }, [route]);
  const club = session() && !session()!.inGame ? undefined : g.clubs[g.userClub];
  const unread = g.news.filter((n) => !n.read).length;
  const chatUnread = (g.humans ? unreadChat() : 0) + (session()?.unreadChat() ?? 0);
  const unreadImportant = g.news.filter((n) => !n.read).length;

  // klubtema følger den klub, man styrer
  useEffect(() => { applyTheme(); }, [g.userClub]);
  // online-lobbyen: ens egen valgte klub, indtil man er med i spillet
  const lobbySess = session();
  const lobbyClub = lobbySess && !lobbySess.inGame ? lobbySess.me?.club : undefined;
  useEffect(() => { setThemeClub(lobbyClub); }, [lobbyClub]);
  // AI-artikler (kamprapporter m.m.) skrives i baggrunden, så de er klar når beskeden åbnes
  const newestNews = g.news[0]?.id;
  useEffect(() => { if (newestNews !== undefined) prefetchArticles(); }, [newestNews, g.userClub]);
  // supportere: status, præstationen "Patron of the game" og supporternes regen-navne
  useEffect(() => {
    refreshSupport().then((m) => { if (m?.tier && !gs().manager.ach?.patron) { act({ t: 'patron' }); } });
    void syncSupporterRegens();
  }, [g.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // browser-notifikationer om vigtige nyheder, når fanen ikke er i fokus
  const notifiedUpTo = useRef(g.news[0]?.id ?? 0);
  useEffect(() => {
    const fresh = g.news.filter((n) => n.id > notifiedUpTo.current && !n.read);
    notifiedUpTo.current = Math.max(notifiedUpTo.current, g.news[0]?.id ?? 0);
    const imp = fresh.filter((n) => NOTIFY_KEYS.some((k) => n.key.startsWith(k)));
    if (imp.length) notifyUser(g.clubs[g.userClub]?.name ?? 'TACTICA FC', imp.slice(0, 3).map((n) => newsTitle(n)).join('\n'), 'news');
    else if (fresh.length && session()) notifyUser(g.clubs[g.userClub]?.name ?? 'TACTICA FC', t('mp.newTurn', { date: dateFmt(g.date) }), 'news');
  }, [newestNews]); // eslint-disable-line react-hooks/exhaustive-deps

  // kampdag: besked når ens kamp er klar, mens fanen ligger i baggrunden (især online, hvor dagene kører uden én)
  const pending = g.pendingFixture;
  useEffect(() => {
    if (!pending) return;
    const f = g.fixtures[pending];
    if (!f) return;
    const opp = g.clubs[f.home === g.userClub ? f.away : f.home]?.name ?? '';
    notifyUser(g.clubs[g.userClub]?.name ?? 'TACTICA FC', t('notify.matchReady', { opp }), 'match');
  }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 2500);
    return () => clearTimeout(id);
  }, [toast]);

  // Mellemrum = Fortsæt, uanset hvor fokus er (undtagen når man skriver tekst).
  // Fanges før alt andet, så en fokuseret knap eller skærmens egne genveje ikke reagerer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const typing = el?.isContentEditable || el?.tagName === 'TEXTAREA' || (el?.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button', 'submit'].includes((el as HTMLInputElement).type));
      if (typing) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      // skærmens egen Fortsæt (fx Kick-off eller Fortsæt efter kampen) går forud for topbjælkens
      // under en kamp: mellemrum starter og pauser kampen
      const btn = document.querySelector<HTMLButtonElement>('.main [data-space]:not(:disabled)') ?? document.querySelector<HTMLButtonElement>('.main .continue:not(:disabled)') ?? document.querySelector<HTMLButtonElement>('.topbar .continue:not(:disabled)');
      btn?.click();
    };
    // en fokuseret knap aktiveres af mellemrum ved keyup – det skal også stoppes
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== ' ' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const typing = el?.isContentEditable || el?.tagName === 'TEXTAREA' || (el?.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button', 'submit'].includes((el as HTMLInputElement).type));
      if (typing) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onKeyUp, true); };
  }, []);

  const online = session();
  // Autogem: kort efter enhver ændring (kun singleplayer – online gemmes på serveren)
  useEffect(() => {
    if (online) return;
    let lastSavedDate = hasGame() ? gs().date : '';
    const unsub = subscribe(() => {
      if (!hasGame()) return;
      const g2 = gs();
      const mode = g2.options.autosaveMode ?? (g2.options.autosave === false ? 'off' : 'changes');
      if (mode === 'off') return;
      if (mode === 'changes') { scheduleAutosave(); return; }
      const days = mode === 'daily' ? 1 : mode === 'weekly' ? 7 : 30;
      const since = lastSavedDate ? (Date.parse(g2.date) - Date.parse(lastSavedDate)) / 86400000 : days;
      if (since >= days) { lastSavedDate = g2.date; scheduleAutosave(800); }
    });
    const onHide = () => { if (document.visibilityState === 'hidden') void flushAutosave(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => { unsub(); document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', onHide); };
  }, [online]);
  // Ranglister: send nye sæsonscorer, når sæsonen skifter (og ved start)
  useEffect(() => {
    if (online) return;
    let season = hasGame() ? gs().season : 0;
    void submitPending();
    const unsub = subscribe(() => {
      if (!hasGame() || gs().season === season) return;
      season = gs().season;
      void submitPending();
    });
    return () => { unsub(); };
  }, [online]);
  const handle = (r: { match?: number; stop?: string }) => {
    notify();
    if (r.match !== undefined) nav({ name: 'match', id: r.match });
    else if (r.stop) {
      nav({ name: 'inbox' });
      // vis den ældste uåbnede besked
      const next = gs().news.filter((n) => !n.read).pop();
      if (next) focusNews(next.id);
    }
  };

  // Fortsæt: læs først de ulæste beskeder én ad gangen (ældste først), derefter næste dag
  const showOldestUnread = (news: typeof g.news) => {
    const next = news.filter((n) => !n.read).pop();
    if (!next) return false;
    act({ t: 'read', ids: [next.id] });
    focusNews(next.id);
    if (route.name !== 'inbox') nav({ name: 'inbox' });
    return true;
  };
  const onContinue = () => {
    if (g.pendingFixture) {
      const pf = g.fixtures[g.pendingFixture];
      // gammel kamp fra en klub, man ikke længere styrer (efter jobskifte): spil den automatisk
      if (!pf || pf.result || (pf.home !== g.userClub && pf.away !== g.userClub)) act({ t: 'fixPending' });
      else { nav({ name: 'match', id: g.pendingFixture }); return; }
    }
    if (showOldestUnread(g.news)) return;
    // ingen ulæste: kør dage frem, indtil der sker noget (kamp, bud, ny besked …) – højst 60 dage
    void run({ untilMatch: true, untilNews: true, maxDays: 60 }).then((r) => {
      if (r.match === undefined) showOldestUnread(gs().news);
    });
  };

  const run = async (opts: Parameters<typeof runUntil>[0]) => {
    stopRef.current = false;
    // fremdriften vises først, hvis kørslen tager mere end et øjeblik (ingen blink ved 1-2 dage)
    const t0 = Date.now();
    const r = await runUntil({ ...opts, shouldStop: () => stopRef.current, onProgress: (d) => { if (Date.now() - t0 > 300) setRunning(dateFmt(d)); } });
    setRunning(null);
    if (r.stop === 'news') { notify(); return r; }
    handle(r);
    return r;
  };

  const [closed, setClosed] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(GROUP_KEY) ?? '["matches","market","club","manager","community"]'); } catch { return ['matches', 'market', 'club', 'manager', 'community']; } });
  const toggleGroup = (k: string) => { const n = closed.includes(k) ? closed.filter((x) => x !== k) : [...closed, k]; setClosed(n); try { localStorage.setItem(GROUP_KEY, JSON.stringify(n)); } catch { /* ignorer */ } };
  const nextMatch = club ? Object.values(g.fixtures).filter((f) => !f.result && (f.home === g.userClub || f.away === g.userClub)).sort((a, b) => a.date.localeCompare(b.date))[0] : undefined;

  return (
    <div className="shell">
      <div className="topbar">
        {showBack && <button className="nav-back small" onClick={() => canBack ? back() : nav({ name: 'inbox' })} aria-label={t('common.back')} title={t('common.back')}>‹ {t('common.back')}</button>}
        <button className="menu-toggle small" onClick={() => setMenuOpen(!menuOpen)}>☰</button>
        <div className="club">
          {club ? <><Crest id={club.id} size={34} /><span className="club-name">{club.name}</span></> : <span className="muted">{online && !online.inGame ? t('mp.lobby') : t('top.unemployed')}</span>}
        </div>
        {g.draft ? <div className="date">{draftRoundLabel()}</div> : <div className="date"><span className="date-long">{dateFmt(g.date, true)}</span><span className="date-short">{dateFmt(g.date)}</span></div>}
        {club && !g.draft && (
          <div className="money top-stats">
            <span className="top-stat"><small>{t('top.balance')}</small><b className={club.balance < 0 ? 'neg' : ''}>{money(club.balance)}</b></span>
            <span className="top-stat"><small>{t('top.budget')}</small><b>{money(club.transferBudget)}</b></span>
          </div>
        )}
        <div className="spacer" />
        <AppButtons onMsg={setToast} />
        <FullscreenButton />
        {nextMatch && !inMatch && (
          <span className="nowrap top-next top-stat">
            <small>{t('top.next')} · {g.draft ? t('dr.roundN', { n: nextMatch.round }) : dateFmt(nextMatch.date)}</small>
            <b><Crest id={nextMatch.home === g.userClub ? nextMatch.away : nextMatch.home} size={16} /> {g.clubs[nextMatch.home === g.userClub ? nextMatch.away : nextMatch.home]?.short}{nextMatch.home === g.userClub ? '' : ` (${t('week.away')})`}</b>
          </span>
        )}
        {online ? <OnlineControls /> : inMatch ? null : (
          <>
            <button onClick={() => run({ untilMatch: true })} title={t('top.toMatchHint')}>{t('top.toMatch')}</button>
            <button className="primary continue" onClick={onContinue} title={unreadImportant ? t('top.continueUnread', { n: unreadImportant }) : t('top.continueHint')}>{g.pendingFixture ? t('top.toTheMatch') : t('top.continue')}{!g.pendingFixture && unreadImportant > 0 && <span className="cont-badge">{unreadImportant}</span>}</button>
          </>
        )}
      </div>
      <nav className={`sidenav ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)}>
        {(() => {
          // draft-liga: kun holdet, kampene og ligaen (ingen økonomi, transfers, staff, bestyrelse eller jobs)
          const allowed = (k: ScreenName) => (g.draft ? DRAFT_SCREENS.includes(k) : k !== 'draft' && (!!g.userClub || UNEMPLOYED.includes(k)));
          const badge = (k: ScreenName) => (k === 'inbox' && unread > 0 ? <span className="badge">{unread}</span>
            : k === 'transfers' && g.offers.some((o) => o.status === 'pending' && o.seller === g.userClub) ? <span className="badge">!</span>
            : k === 'jobs' && g.jobOffers.length > 0 ? <span className="badge">{g.jobOffers.length}</span> : null);
          const item = (k: ScreenName) => (
            <button key={k} className={route.name === k ? 'on' : ''} onClick={() => nav({ name: k })}>
              <Icon name={k} />{t(ALL_ITEMS[k])}{badge(k)}
            </button>
          );
          return (
            <>
              {item('inbox')}
              {g.humans && g.humans.length > 1 && (
                <button className={route.name === 'managers' ? 'on' : ''} onClick={() => nav({ name: 'managers' })}>
                  <Icon name="managers" />{t('nav.managers')}
                  {chatUnread > 0 && <span className="badge">{chatUnread}</span>}
                </button>
              )}
              {GROUPS.map((gr) => {
                const ks = gr.items.filter(allowed);
                if (!ks.length) return null;
                // menuen viser præcis det, manageren har foldet ud (huskes) – står man på en side i en lukket gruppe, fremhæves overskriften
                const active = ks.includes(route.name);
                const open = !closed.includes(gr.key);
                const hasBadge = !open && ks.some((k) => badge(k));
                return (
                  <div key={gr.key} className="nav-group">
                    <button className={`nav-head ${active && !open ? 'here' : ''}`} onClick={(e) => { e.stopPropagation(); toggleGroup(gr.key); }} aria-expanded={open}>
                      <span>{t(`navg.${gr.key}`)}</span>{hasBadge && <i className="nav-dot" />}<span className="nav-chev">{open ? '▾' : '▸'}</span>
                    </button>
                    {open && ks.map(item)}
                  </div>
                );
              })}
              <div className="sep" />
              {item('help')}
              {item('options')}
            </>
          );
        })()}
        <div className="sep" />
        {!online && <button onClick={async () => { await saveGame(); setToast(t('top.saved')); }}><Icon name="save" />{t('nav.save')}</button>}
        {online && <div className="muted nav-note" title={t('mp.autosaveHint')}><Icon name="save" />{t('mp.autosave')}</div>}
        <button onClick={async () => {
          if (online) { if (await askConfirm(t('mp.leaveConfirm'))) { void stopVoice(); closeSession(); forgetLast(); setGame(null); } return; }
          if (await askConfirm(t('top.quitConfirm'))) { await saveGame().catch(() => {}); forgetLast(); setGame(null); }
        }}><Icon name="quit" />{t('nav.quit')}</button>
        <BugReportButton screen={route.name} version={APP_VERSION} date={g.date} />
        <VersionButton />
      </nav>
      {club && (
        <nav className="mobile-tabs">
          {(['inbox', 'squad', 'tactics', 'transfers'] as ScreenName[]).map((k) => (
            <button key={k} className={route.name === k ? 'on' : ''} onClick={() => nav({ name: k })}>
              <Icon name={k} /><span>{t(MENU.find(([x]) => x === k)?.[1] ?? k)}</span>
              {k === 'inbox' && unread > 0 && <i className="dot">{unread > 99 ? '99+' : unread}</i>}
            </button>
          ))}
          <button onClick={() => setMenuOpen(true)}><span className="burger">☰</span><span>{t('top.more')}</span></button>
        </nav>
      )}
      {menuOpen && <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />}
      <main className="main" ref={mainRef}>
        {online && !online.inGame ? <Lobby /> : <Screen />}
        {online?.status === 'error' && <div className="toast">{online.error}</div>}
      </main>
      {/* med flere spillere viser simuleringsvisningen (Online.tsx) trækket – her kun ved indlæsning og alene-spil */}
      {online && (online.status === 'loading' || (online.status === 'processing' && (online.room?.players.length ?? 1) <= 1)) && (
        <div className="progress"><div>{online.status === 'processing' ? t('mp.processing') : t('mp.loading')}</div></div>
      )}
      {running && (
        <div className="progress">
          <div>{t('top.running')} {running}</div>
          <button onClick={() => { stopRef.current = true; }}>{t('common.stop')}</button>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
      {g.draft && online && <RoomChat />}
    </div>
  );
}

function Screen() {
  const { route } = useNav();
  switch (route.name) {
    case 'inbox': return <Inbox />;
    case 'squad': return <Squad />;
    case 'player': return <PlayerScreen id={Number(route.id)} />;
    case 'tactics': return <Tactics />;
    case 'training': return <Training />;
    case 'fixtures': return <Fixtures />;
    case 'competitions': return <Competitions id={route.id as string | undefined} />;
    case 'transfers': return <Transfers tab={route.tab} />;
    case 'scouting': return <Scouting />;
    case 'staff': return <StaffScreen />;
    case 'finance': return <Finance />;
    case 'club': return <ClubScreen id={route.id as number | undefined} />;
    case 'board': return <BoardScreen />;
    case 'profile': return <ProfileScreen />;
    case 'draft': return <DraftLeagueScreen />;
    case 'support': return <div><Head title={t('sup.title')} /><SupportPage /></div>;
    case 'community': return <div><Head title={t('cm.title')} /><p className="muted" style={{ marginTop: 0 }}>{t('cm.intro')}</p><CommunityBoard defaultName={gs().manager.name} /></div>;
    case 'assistant': return <Assistant tab={route.tab} />;
    case 'compare': return <Assistant tab="compare" />;
    case 'benchmark': return <Assistant tab="bench" />;
    case 'match': return <MatchScreen id={Number(route.id)} />;
    case 'report': return <ReportScreen id={Number(route.id)} />;
    case 'history': return <History />;
    case 'awards': return <Awards />;
    case 'jobs': return <Jobs />;
    case 'options': return <Options />;
    case 'press': return <PressScreen />;
    case 'ranking': return <RankingScreen />;
    case 'managers': return <ManagersScreen />;
    case 'help': return <HelpScreen id={route.id as string | undefined} />;
  }
}

/** Klokken (slå notifikationer til) og "Installér app", kun når de er relevante */
function AppButtons({ onMsg }: { onMsg: (m: string) => void }) {
  const [notif, setNotif] = useState(notifyEnabled());
  const [inst, setInst] = useState(canInstall());
  useEffect(() => onInstallChange(() => setInst(canInstall())), []);
  return (
    <>
      {!notif && notifyAskable() && (
        <button className="small app-btn" title={t('top.notifyHint')} onClick={async () => {
          const ok = await setNotify(true);
          setNotif(ok);
          onMsg(t(ok ? 'top.notifyOn' : 'top.notifyDenied'));
        }}>🔔 <span className="app-btn-label">{t('top.notify')}</span></button>
      )}
      {inst && <button className="small app-btn" title={t('top.installHint')} onClick={async () => { if (await installApp()) onMsg(t('top.installed')); }}>⬇ <span className="app-btn-label">{t('top.install')}</span></button>}
    </>
  );
}

function FullscreenButton() {
  const [on, setOn] = useState(!!document.fullscreenElement);
  useEffect(() => {
    const h = () => setOn(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);
  if (!document.fullscreenEnabled) return null;
  return (
    <button className="small fullscreen-btn" title={on ? t('top.exitFullscreen') : t('top.fullscreen')} aria-label={on ? t('top.exitFullscreen') : t('top.fullscreen')}
      onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen(); }}>
      {on ? '⤡' : '⛶'}
    </button>
  );
}
