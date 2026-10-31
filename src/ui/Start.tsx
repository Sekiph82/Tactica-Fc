import { useEffect, useMemo, useState } from 'react';
import { DraftCreate } from './Draft';
import { askConfirm } from './confirm';
import { Select } from './select';
import { CHALLENGES } from '../game/challenges';
import { createGame, type WorldData } from '../game/newgame';
import { setupBots, type BotScope } from '../game/bots';
import { enableMultiplayer } from '../game/humans';
import { deleteSave, importSave, listSaves, loadGame, type SaveMeta } from '../game/save';
import { gs, notify } from '../game/state';
import type { Lang } from '../game/types';
import { CURRENCIES, dateFmt, getCurrency, getLang, getNumberLocale, setCurrency, setLang, t, type Currency, natName } from '../i18n';
import { Flag, Panel } from './components';
import { OnlineMenu } from './Online';
import { createOnlineGame } from '../online/client';
import { notifyNewCareer } from '../online/notify';
import { forgetCMWorld, importCMFiles, loadCMWorld, loadWorld } from './world';
import type { CMWorld } from '../game/data/cm0102';

type View = 'menu' | 'new' | 'load' | 'challenges' | 'online' | 'newOnline' | 'newDraft';

export function Start({ onLang, onHome }: { onLang: (l: Lang) => void; onHome?: () => void }) {
  const roomParam = new URLSearchParams(location.search).get('room') ?? undefined;
  const [view, setView] = useState<View>(roomParam ? 'online' : new URLSearchParams(location.search).get('newdraft') ? 'newDraft' : 'menu');
  const [challenge, setChallenge] = useState<string | undefined>();
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const lang = getLang();

  const doImport = async (file: File | undefined) => {
    if (!file) return;
    setBusy(t('start.loading'));
    const ok = await importSave(file);
    setBusy('');
    if (!ok) setErr(t('start.importFailed'));
  };

  return (
    <div className={`start ${view === 'menu' ? 'start-menu' : ''}`}>
      <div className="start-aurora" aria-hidden><i /><i /><i /></div>
      {onHome && view === 'menu' && <button className="small start-home" onClick={onHome}>{t('start.toLanding')}</button>}
      <div className="start-box">
        <div className="logo">
          {view === 'menu' && <div className="start-pill"><span className="start-live" />{t('start.pill')}</div>}
          <h1>TACTICA <span>FC</span></h1>
          <p>{t('start.subtitle')}</p>
        </div>
        {view === 'menu' && (
          <div className="menu-btns">
            <button className="start-cta" onClick={() => { setChallenge(undefined); setView('new'); }}>{t('start.new')} <span>→</span></button>
            <div className="start-cards">
              <button className="start-card" onClick={() => setView('load')}><b>💾 {t('start.load')}</b><span>{t('start.loadDesc')}</span></button>
              <button className="start-card" onClick={() => setView('online')}><b>🌐 {t('mp.title')}</b><span>{t('start.onlineDesc')}</span></button>
              <button className="start-card" onClick={() => setView('challenges')}><b>🏆 {t('start.challenges')}</b><span>{t('start.challengesDesc')}</span></button>
            </div>
            <div className="start-foot">
              <button className="start-ghost" onClick={() => document.getElementById('import-file')?.click()}>{t('start.import')}</button>
              <input id="import-file" type="file" accept=".cm0102,.json,.gz" style={{ display: 'none' }} onChange={(e) => doImport(e.target.files?.[0])} />
              <div className="start-lang">
                <button className={lang === 'da' ? 'on' : ''} onClick={() => { setLang('da'); onLang('da'); }}>DA</button>
                <button className={lang === 'en' ? 'on' : ''} onClick={() => { setLang('en'); onLang('en'); }}>EN</button>
                <button className={lang === 'tr' ? 'on' : ''} onClick={() => { setLang('tr'); onLang('tr'); }}>TR</button>
              </div>
              <select className="start-cur" aria-label={t('opt.currency')} defaultValue={getCurrency()} onChange={(e) => { setCurrency(e.target.value as Currency); onLang(getLang()); }}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{t(`cur.${c}`)}</option>)}
              </select>
            </div>
            {err && <div className="bad center">{err}</div>}
          </div>
        )}
        {view === 'load' && <LoadList onBack={() => setView('menu')} setBusy={setBusy} />}
        {view === 'challenges' && (
          <Panel title={t('start.challenges')} right={<button className="small" onClick={() => setView('menu')}>{t('common.back')}</button>}>
            <div className="col">
              {CHALLENGES.map((c) => (
                <div key={c.id} className="choice" onClick={() => { setChallenge(c.id); setView('new'); }}>
                  <div className="grow">
                    <b className="accent">{t(`challenge.${c.id}.title`)}</b>
                    <div className="muted">{t(`challenge.${c.id}.desc`)}</div>
                  </div>
                  <span className="tag">{t('start.seasons', { n: c.seasons })}</span>
                </div>
              ))}
            </div>
          </Panel>
        )}
        {view === 'new' && <NewGame challenge={challenge} onBack={() => setView('menu')} setBusy={setBusy} />}
        {view === 'online' && <OnlineMenu onBack={() => { history.replaceState(null, '', location.pathname); setView('menu'); }} onCreate={() => setView('newOnline')} onCreateDraft={() => setView('newDraft')} setBusy={setBusy} initialCode={roomParam} />}
        {view === 'newDraft' && <DraftCreate onBack={() => setView('online')} setBusy={setBusy} />}
        {view === 'newOnline' && <NewGame online onBack={() => setView('online')} setBusy={setBusy} />}
        <div className="footer-note">{t('start.footer')}</div>
      </div>
      {busy && <div className="progress"><div>{busy}</div></div>}
    </div>
  );
}

function LoadList({ onBack, setBusy }: { onBack: () => void; setBusy: (s: string) => void }) {
  const [saves, setSaves] = useState<SaveMeta[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { listSaves().then(setSaves); }, []);
  return (
    <Panel title={t('start.load')} right={<button className="small" onClick={onBack}>{t('common.back')}</button>}>
      {!saves && <div className="muted">{t('start.loading')}</div>}
      {saves && saves.length === 0 && <div className="muted">{t('start.noSaves')}</div>}
      {err && <div className="bad">{err}</div>}
      <div className="col">
        {saves?.map((s) => (
          <div key={s.id} className="choice">
            <div className="grow" onClick={async () => { setErr(''); setBusy(t('start.loading')); const ok = await loadGame(s.id); setBusy(''); if (!ok) setErr(t('start.importFailed')); }}>
              <b>{s.club}</b> <span className="muted">— {s.manager}</span>
              <div className="muted">{dateFmt(s.date)} · {t('start.savedAt')} {new Date(s.saved).toLocaleString(getNumberLocale())}</div>
            </div>
            <button className="small danger" onClick={async () => { if (await askConfirm(t('start.confirmDelete'), { danger: true })) { await deleteSave(s.id); setSaves(await listSaves()); } }}>{t('common.delete')}</button>
          </div>
        ))}
      </div>
    </Panel>
  );
}

const DEFAULT_NATIONS = ['England', 'Denmark'];

function NewGame({ challenge, onBack, setBusy, online }: { challenge?: string; onBack: () => void; setBusy: (s: string) => void; online?: boolean }) {
  const [world, setWorld] = useState<WorldData | null>(null);
  const [err, setErr] = useState('');
  const ch = CHALLENGES.find((c) => c.id === challenge);
  const [name, setName] = useState('');
  const [active, setActive] = useState<Set<number>>(new Set());
  const [league, setLeague] = useState('');
  const [club, setClub] = useState<number>(ch?.club ?? 0);
  const [masking, setMasking] = useState(true);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const [bots, setBots] = useState(0);
  const [deadline, setDeadline] = useState(24);
  const [botScope, setBotScope] = useState<BotScope>('league');
  // database: den moderne (2025/26) eller originalen fra spillerens egen CM 01/02-installation
  const [db, setDbState] = useState<'modern' | 'cm0102'>(() => { try { return !challenge && localStorage.getItem('cm0102.db') === 'cm0102' ? 'cm0102' : 'modern'; } catch { return 'modern'; } });
  const [needImport, setNeedImport] = useState(false);
  const setDb = (d: 'modern' | 'cm0102') => { setDbState(d); setWorld(null); setClub(0); try { localStorage.setItem('cm0102.db', d); } catch { /* ignorer */ } };

  useEffect(() => {
    setNeedImport(false);
    (db === 'cm0102' ? loadCMWorld() : loadWorld()).then((w) => {
      if (!w) { setNeedImport(true); return; }
      setWorld(w);
      const names = ch ? ch.nations : DEFAULT_NATIONS;
      const ids = names.map((n) => w.nations.findIndex((x) => x.name === n)).filter((i) => i >= 0);
      setActive(new Set(ids));
      const first = w.leagues.find((l) => l.nation === ids[0]);
      if (first) setLeague(first.id);
    }).catch((e) => setErr(String(e)));
  }, [ch, db]);

  const leagueNations = useMemo(() => {
    if (!world) return [];
    const ns = [...new Set(world.leagues.map((l) => l.nation))];
    return ns.sort((a, b) => natName(world.nations[a].name).localeCompare(natName(world.nations[b].name)));
  }, [world]);

  const dbPicker = !ch && (
    <Panel title={t('db.title')}>
      <div className="db-choice">
        <button className={`db-opt ${db === 'modern' ? 'on' : ''}`} onClick={() => setDb('modern')}>
          <b>{t('db.modern')}</b><span>{t('db.modernHint')}</span>
        </button>
        <button className={`db-opt ${db === 'cm0102' ? 'on' : ''}`} onClick={() => setDb('cm0102')}>
          <b>{t('db.cm')}</b><span>{t('db.cmHint')}</span>
        </button>
      </div>
      {db === 'cm0102' && world && <CMImportInfo world={world as CMWorld} onRemove={async () => { await forgetCMWorld(); setWorld(null); setNeedImport(true); }} onReimport={() => setNeedImport(true)} />}
    </Panel>
  );
  if (err) return <Panel title={t('start.new')}><div className="bad">{err}</div></Panel>;
  if (needImport) return <div>{dbPicker}<CMImport onDone={(w) => { setNeedImport(false); setWorld(w); const ids = DEFAULT_NATIONS.map((n) => w.nations.findIndex((x) => x.name === n)).filter((i) => i >= 0); setActive(new Set(ids)); const f = w.leagues.find((l) => l.nation === ids[0]); if (f) setLeague(f.id); }} onBack={onBack} /></div>;
  if (!world) return <div>{dbPicker}<Panel title={t('start.new')}><div className="muted">{t('start.loadingDb')}</div></Panel></div>;

  const leagues = world.leagues.filter((l) => active.has(l.nation));
  const clubs = world.clubs.filter((c) => c[4] === league).sort((a, b) => a[2].localeCompare(b[2]));
  const clubNation = world.clubs.find((c) => c[0] === club)?.[3];
  const canStart = name.trim().length > 0 && club > 0 && clubNation !== undefined && active.has(clubNation);

  const start = () => {
    setBusy(online ? t('mp.creating') : t('start.creating'));
    const opts = {
      managerName: name.trim(), managerNation: clubNation ?? 0, clubId: club, activeNations: [...active],
      lang: getLang(), masking, seed, challenge,
    };
    setTimeout(async () => {
      if (online) {
        try { await createOnlineGame(world, { ...opts, deadlineHours: deadline }, { count: bots, scope: botScope }); } catch (e) { setErr(String((e as Error).message)); }
      } else {
        createGame(world, opts);
        if (bots > 0) {
          // lokalt spil mod AI-managere: samme multiplayer-regler, men du spiller dine kampe live
          enableMultiplayer('host', opts.managerName);
          gs().localMp = true;
          setupBots(bots, botScope);
        }
        notify();
        const c = world.clubs.find((x) => x[0] === club), lg = world.leagues.find((l) => l.id === c?.[4]);
        notifyNewCareer({
          manager: opts.managerName, club: c?.[2] ?? String(club), league: lg?.name, nation: natName(world.nations[clubNation ?? -1]?.name),
          challenge, bots, db, lang: opts.lang,
        });
      }
      setBusy('');
    }, 30);
  };

  return (
    <div>
      {dbPicker}
      <Panel title={ch ? t(`challenge.${ch.id}.title`) : online ? t('mp.create') : t('start.new')} right={<button className="small" onClick={onBack}>{t('common.back')}</button>}>
        <div className="col">
          {ch && <div className="insight good">{t(`challenge.${ch.id}.desc`)}</div>}
          <label>{t('start.managerName')}
            <input style={{ marginLeft: 8, width: 220 }} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('start.managerPlaceholder')} autoFocus />
          </label>
        </div>
      </Panel>
      {!ch && (
        <Panel title={t('start.nations')} right={<span className="muted">{t('start.nationsHint')}</span>}>
          <div className="grid-choices">
            {leagueNations.map((n) => (
              <label key={n} className={`choice ${active.has(n) ? 'on' : ''}`}>
                <input type="checkbox" checked={active.has(n)} onChange={() => {
                  const s = new Set(active);
                  if (s.has(n)) s.delete(n); else s.add(n);
                  setActive(s);
                }} />
                <Flag name={world.nations[n].name} />{natName(world.nations[n].name)}
                <span className="muted" style={{ marginLeft: 'auto' }}>{world.leagues.filter((l) => l.nation === n).length}</span>
              </label>
            ))}
          </div>
          <div className="muted" style={{ marginTop: 6 }}>{t('start.perfHint')}</div>
        </Panel>
      )}
      {!ch && (
        <Panel title={t('start.pickClub')}>
          <div className="row" style={{ marginBottom: 8 }}>
            <Select value={league} onChange={(v) => { setLeague(v); setClub(0); }} width={300}
              options={leagues.map((l) => ({ value: l.id, label: l.name, group: natName(world.nations[l.nation].name) }))} />
          </div>
          <div className="grid-choices">
            {clubs.map((c) => (
              <div key={c[0]} className={`choice ${club === c[0] ? 'on' : ''}`} onClick={() => setClub(c[0])}>{c[2]}</div>
            ))}
          </div>
        </Panel>
      )}
      {!ch && (
        <Panel title={t('bots.title')}>
          <div className="col">
            <div className="muted">{t(online ? 'bots.hintOnline' : 'bots.hint')}</div>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {[0, 1, 2, 3, 5, 7].map((n) => <button key={n} className={`small ${bots === n ? 'primary' : ''}`} onClick={() => setBots(n)}>{n === 0 ? t('bots.none') : n}</button>)}
            </div>
            {bots > 0 && (
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {t('bots.where')}: {(['league', 'nation', 'world'] as const).map((s) => <button key={s} className={`small ${botScope === s ? 'primary' : ''}`} onClick={() => setBotScope(s)}>{t(`bots.scope.${s}`)}</button>)}
              </div>
            )}
          </div>
        </Panel>
      )}
      {online && (
        <Panel title={t('mp.deadlineTitle')}>
          <div className="col">
            <div className="muted">{t('mp.deadlineHint')}</div>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {[0, 6, 12, 24, 48].map((h) => <button key={h} className={`small ${deadline === h ? 'primary' : ''}`} onClick={() => setDeadline(h)}>{h ? t('mp.hours', { n: h }) : t('mp.noDeadline')}</button>)}
            </div>
          </div>
        </Panel>
      )}
      <Panel title={t('start.options')}>
        <div className="col">
          <label className="row"><input type="checkbox" checked={masking} onChange={(e) => setMasking(e.target.checked)} /> {t('start.masking')}</label>
          <div className="muted">{t('start.maskingHint')}</div>
          <label className="row">{t('start.seed')} <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} style={{ width: 140 }} /></label>
          <div className="muted">{t('start.seedHint')}</div>
        </div>
      </Panel>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {!canStart && <span className="muted">{t('start.needNameClub')}</span>}
        <button className="primary" disabled={!canStart} onClick={start}>{online ? t('mp.createBtn') : t('start.begin')}</button>
      </div>
      <div className="muted" style={{ marginTop: 8 }}>{t('start.dataNote', { src: world.source })}</div>
    </div>
  );
}

/** Import af den originale CM 01/02-database fra spillerens egen installation */
function CMImport({ onDone, onBack }: { onDone: (w: CMWorld) => void; onBack: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const read = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true); setErr('');
    try { onDone(await importCMFiles(files)); }
    catch (e) {
      const m = String((e as Error).message);
      setErr(m.startsWith('missing:') ? t('db.missing', { files: m.slice(8) }) : t('db.failed'));
    }
    setBusy(false);
  };
  return (
    <Panel title={t('db.importTitle')} right={<button className="small" onClick={onBack}>{t('common.back')}</button>}>
      <div className="col">
        <p style={{ margin: 0, lineHeight: 1.55 }}>{t('db.importIntro')}</p>
        <ol className="db-steps">
          <li>{t('db.step1')}</li>
          <li>{t('db.step2')}</li>
          <li>{t('db.step3')}</li>
        </ol>
        <div className="row">
          <label className="button primary file-btn">
            {busy ? t('db.reading') : t('db.pickFolder')}
            <input type="file" multiple {...{ webkitdirectory: '', directory: '' }} disabled={busy} onChange={(e) => read(e.target.files)} />
          </label>
          <label className="button file-btn">
            {t('db.pickFiles')}
            <input type="file" multiple accept=".dat" disabled={busy} onChange={(e) => read(e.target.files)} />
          </label>
        </div>
        {err && <div className="insight bad">{err}</div>}
        <div className="muted" style={{ fontSize: 12 }}>{t('db.privacy')}</div>
      </div>
    </Panel>
  );
}

function CMImportInfo({ world, onRemove, onReimport }: { world: CMWorld; onRemove: () => void; onReimport: () => void }) {
  return (
    <div className="row" style={{ marginTop: 10, flexWrap: 'wrap', gap: 8 }}>
      <span className="tag good">{t('db.imported', { leagues: world.leagues.length, clubs: world.clubs.length.toLocaleString(getNumberLocale()), players: world.players.length.toLocaleString(getNumberLocale()) })}</span>
      <button className="small" onClick={onReimport}>{t('db.reimport')}</button>
      <button className="small danger" onClick={onRemove}>{t('db.remove')}</button>
    </div>
  );
}
