// Fællesskabet: forslag og fejlrapporter, stemmer (med budget), kommentarer, månedens afstemning og en roadmap.
// Bruges både i spillet (Community-siden) og som offentlig side (?community=1 og ?suggestion=ID).
import { SupporterBadge } from './Support';
import { useEffect, useState } from 'react';
import { SG_CATS, comment, communityAvailable, communityUrl, getPoll, getSuggestion, listSuggestions, myVotes, pollVote, reportBug, reportContent, shrinkImage, similar, suggest, suggestionUrl, vote, type SgComment, type SgStatus, type Suggestion } from '../online/community';
import { createProfile, getProfile } from '../online/rank';
import { dateFmt, getLang, t } from '../i18n';
import { Modal, Panel, Tabs } from './components';
import { APP_VERSION } from './changelogData';

const ROADMAP: SgStatus[] = ['considering', 'planned', 'progress', 'released'];
type List = 'trending' | 'top' | 'new' | 'roadmap';

/** Fejl fra serveren → tekst */
const errText = (e: string) => t(`cm.err.${e}`) === `cm.err.${e}` ? t('cm.err.error') : t(`cm.err.${e}`);

export function CommunityBoard({ initialId, defaultName }: { initialId?: number; defaultName?: string }) {
  const [list, setList] = useState<List>('trending');
  const [cat, setCat] = useState('');
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [voted, setVoted] = useState<number[]>([]);
  const [budget, setBudget] = useState<{ used: number; budget: number; canVote: boolean } | null>(null);
  const [open, setOpen] = useState<number | null>(initialId ?? null);
  const [writing, setWriting] = useState<'suggest' | 'bug' | null>(null);
  const [msg, setMsg] = useState('');
  const [tick, setTick] = useState(0);
  const prof = getProfile();
  const reload = () => setTick((x) => x + 1);
  useEffect(() => {
    let alive = true;
    setItems(null);
    listSuggestions(list === 'roadmap' ? 'top' : list, cat).then((r) => {
      if (!alive) return;
      setItems(r ? (list === 'roadmap' ? r.items.filter((s) => s.status !== 'new' && s.status !== 'rejected') : r.items) : []);
      setVoted(r?.voted ?? []);
    });
    myVotes().then((r) => alive && setBudget(r));
    return () => { alive = false; };
  }, [list, cat, tick]);

  if (!communityAvailable()) return <div className="empty">{t('rank.offline')}</div>;

  const toggleVote = async (s: Suggestion) => {
    setMsg('');
    const on = !voted.includes(s.id);
    const r = await vote(s.id, on);
    if ('error' in r) { setMsg(errText(r.error)); return; }
    setVoted(on ? [...voted, s.id] : voted.filter((x) => x !== s.id));
    setItems((cur) => cur?.map((x) => (x.id === s.id ? { ...x, votes: x.votes + (on ? 1 : -1) } : x)) ?? cur);
    setBudget((b) => (b ? { ...b, used: r.used } : b));
  };

  return (
    <div className="community">
      {!prof && <ProfileGate defaultName={defaultName} onDone={reload} />}
      <Poll />
      <div className="cm-bar">
        <Tabs tabs={[['trending', t('cm.trending')], ['top', t('cm.top')], ['new', t('cm.new')], ['roadmap', t('cm.roadmap')]]} value={list} onChange={(v) => setList(v as List)} />
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">{t('cm.allCats')}</option>
          {SG_CATS.map((c) => <option key={c} value={c}>{t(`cm.cat.${c}`)}</option>)}
        </select>
        <span className="grow" />
        {budget && <span className={`tag ${budget.used >= budget.budget ? 'warn' : ''}`} title={t('cm.budgetHint')}>{t('cm.votesUsed', { n: budget.used, max: budget.budget })}</span>}
        <button disabled={!prof} onClick={() => setWriting('bug')}>🐞 {t('cm.reportBug')}</button>
        <button className="primary" disabled={!prof} onClick={() => setWriting('suggest')}>＋ {t('cm.suggest')}</button>
      </div>
      {budget && !budget.canVote && <div className="insight warn">{t('cm.err.newProfile')}</div>}
      {msg && <div className="insight bad">{msg}</div>}
      {items === null ? <div className="empty">{t('rank.loading')}</div> : list === 'roadmap' ? (
        <div className="roadmap">
          {ROADMAP.map((st) => (
            <div key={st} className="rm-col">
              <h4><span className={`sg-status s-${st}`}>{t(`cm.st.${st}`)}</span> <span className="muted">{items.filter((s) => s.status === st).length}</span></h4>
              {items.filter((s) => s.status === st).map((s) => (
                <button key={s.id} className="rm-card" onClick={() => setOpen(s.id)}>
                  <b>{s.title}</b>
                  <span className="muted">▲ {s.votes} · {t(`cm.cat.${s.cat}`)}{s.releasedIn ? ` · ${t('cm.releasedIn', { v: s.releasedIn })}` : ''}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : items.length === 0 ? <div className="empty">{t('cm.none')}</div> : (
        <div className="sg-list">
          {items.map((s) => (
            <div key={s.id} className="sg-row">
              <button className={`sg-vote ${voted.includes(s.id) ? 'on' : ''}`} disabled={!prof || s.status === 'released' || s.status === 'rejected'} onClick={() => toggleVote(s)} title={t('cm.vote')}>
                <span>▲</span><b>{s.votes}</b>
              </button>
              <button className="sg-main" onClick={() => setOpen(s.id)}>
                <b>{s.title}</b>
                <span className="sg-meta">
                  <span className={`sg-status s-${s.status}`}>{t(`cm.st.${s.status}`)}</span>
                  <span className="tag">{t(`cm.cat.${s.cat}`)}</span>
                  {s.lang === 'da' && <span className="tag" title={t('cm.danish')}>DA</span>}
                  {s.lang === 'tr' && <span className="tag" title={t('cm.turkish')}>TR</span>}
                  <SupporterBadge tier={s.supporter} />
                  {s.reply && <span className="tag good">💬 {t('cm.devReplied')}</span>}
                  <span className="muted">{s.name} · {dateFmt(s.created.slice(0, 10))} · 💬 {s.comments}</span>
                </span>
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="muted" style={{ fontSize: 12.5 }}>{t('cm.footer')} <a className="link" onClick={() => navigator.clipboard?.writeText(communityUrl())}>{t('cm.copyLink')}</a></p>
      {open !== null && <SuggestionModal id={open} onClose={() => { setOpen(null); reload(); }} />}
      {writing && <WriteModal kind={writing} onClose={(id) => { setWriting(null); reload(); if (id) setOpen(id); }} />}
    </div>
  );
}

/** Uden profil: opret en (samme som ranglisterne) for at kunne foreslå og stemme */
function ProfileGate({ defaultName, onDone }: { defaultName?: string; onDone: () => void }) {
  const [name, setName] = useState(defaultName ?? '');
  const [err, setErr] = useState('');
  return (
    <div className="insight row" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
      <span className="grow">{t('cm.needProfile')}</span>
      <input value={name} maxLength={24} placeholder={t('rank.namePlaceholder')} onChange={(e) => setName(e.target.value)} />
      <button className="primary" onClick={async () => { const r = await createProfile(name); if (typeof r === 'string') setErr(t(`rank.err.${r}`)); else onDone(); }}>{t('rank.create')}</button>
      {err && <span className="bad">{err}</span>}
    </div>
  );
}

/** Månedens afstemning: vinderen bygges som det næste */
function Poll() {
  const [poll, setPoll] = useState<Awaited<ReturnType<typeof getPoll>>>(null);
  const [msg, setMsg] = useState('');
  const load = () => getPoll().then(setPoll);
  useEffect(() => { void load(); }, []);
  const p = poll?.poll;
  if (!p) return null;
  const total = p.items.reduce((a, s) => a + s.pollVotes, 0) || 1;
  return (
    <Panel title={`🗳️ ${p.title}`} right={p.ends ? <span className="muted">{t('cm.pollEnds', { date: dateFmt(p.ends) })}</span> : undefined} className="poll">
      <p className="muted" style={{ marginTop: 0 }}>{t('cm.pollHint')}</p>
      {p.items.map((s) => (
        <button key={s.id} className={`poll-row ${p.mine === s.id ? 'on' : ''}`} onClick={async () => { const r = await pollVote(s.id); if ('error' in r) setMsg(errText(r.error)); else void load(); }}>
          <span className="poll-bar" style={{ width: `${(s.pollVotes / total) * 100}%` }} />
          <b>{s.title}</b><span>{s.pollVotes}{p.mine === s.id ? ' ✓' : ''}</span>
        </button>
      ))}
      {msg && <div className="insight bad">{msg}</div>}
    </Panel>
  );
}

/** Ét forslag: tekst, billede, svar fra udvikleren, kommentarer, deling og rapportering */
function SuggestionModal({ id, onClose }: { id: number; onClose: () => void }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof getSuggestion>> | 'loading'>('loading');
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const load = () => getSuggestion(id).then(setD);
  useEffect(() => { void load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const prof = getProfile();
  if (d === 'loading') return <Modal title="…" onClose={onClose}><div className="muted">{t('rank.loading')}</div></Modal>;
  if (!d) return <Modal title={t('cm.notFound')} onClose={onClose}><div className="muted">{t('cm.notFound')}</div></Modal>;
  const s = d.suggestion;
  return (
    <Modal title={s.title} onClose={onClose} wide>
      <div className="col">
        <div className="sg-meta">
          <span className={`sg-status s-${s.status}`}>{t(`cm.st.${s.status}`)}</span>
          <span className="tag">{t(`cm.cat.${s.cat}`)}</span>
          {s.releasedIn && <span className="tag good">{t('cm.releasedIn', { v: s.releasedIn })}</span>}
          <span className="muted">{s.name} · {dateFmt(s.created.slice(0, 10))} · ▲ {s.votes}</span>
        </div>
        <p className="sg-body">{s.body}</p>
        {s.meta && <div className="muted" style={{ fontSize: 12 }}>{s.meta}</div>}
        {d.image && <img className="sg-img" src={d.image} alt="" />}
        {s.reply && <div className="insight good"><b>💬 {t('cm.devReply')}</b><p style={{ margin: '4px 0 0', whiteSpace: 'pre-line' }}>{s.reply}</p></div>}
        <h4 style={{ margin: '6px 0 0' }}>{t('cm.comments', { n: d.comments.length })}</h4>
        <div className="sg-comments">
          {d.comments.map((c: SgComment) => (
            <div key={c.i} className={`sg-comment ${c.dev ? 'dev' : ''}`}><b>{c.dev ? '🛠️ ' : ''}{c.name} <SupporterBadge tier={c.supporter} /></b> <span className="muted">{dateFmt(c.at.slice(0, 10))}</span><p>{c.text}</p></div>
          ))}
          {!d.comments.length && <div className="muted">{t('cm.noComments')}</div>}
        </div>
        {prof && (
          <div className="row">
            <input style={{ flex: 1 }} maxLength={1000} value={text} placeholder={t('cm.writeComment')} onChange={(e) => setText(e.target.value)} />
            <button className="primary" disabled={text.trim().length < 2} onClick={async () => { const r = await comment(id, text); if ('error' in r) setMsg(errText(r.error)); else { setText(''); void load(); } }}>{t('cm.send')}</button>
          </div>
        )}
        {msg && <div className="insight bad">{msg}</div>}
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button className="small" onClick={async () => { try { if (navigator.share) await navigator.share({ title: s.title, url: suggestionUrl(id) }); else { await navigator.clipboard.writeText(suggestionUrl(id)); setMsg(t('rank.copied')); } } catch { /* afbrudt */ } }}>{t('cm.share')}</button>
          {prof && <button className="small danger" onClick={async () => { await reportContent(id); setMsg(t('cm.reported')); }}>{t('cm.report')}</button>}
        </div>
      </div>
    </Modal>
  );
}

/** Skriv et nyt forslag eller en fejlrapport – med dubletkontrol og evt. skærmbillede */
function WriteModal({ kind, onClose, meta }: { kind: 'suggest' | 'bug'; onClose: (id?: number) => void; meta?: string }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [cat, setCat] = useState('gameplay');
  const [image, setImage] = useState('');
  const [dupes, setDupes] = useState<Suggestion[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (title.trim().length < 6) { setDupes([]); return; }
    const h = setTimeout(() => { similar(title).then((r) => setDupes(r?.items ?? [])); }, 400);
    return () => clearTimeout(h);
  }, [title]);
  const send = async () => {
    setBusy(true); setErr('');
    const r = kind === 'bug'
      ? await reportBug({ title, body, lang: getLang(), meta: meta ?? autoMeta(), image: image || undefined })
      : await suggest({ title, body, cat, lang: getLang(), image: image || undefined });
    setBusy(false);
    if ('error' in r) setErr(errText(r.error)); else onClose(r.id);
  };
  return (
    <Modal title={kind === 'bug' ? `🐞 ${t('cm.reportBug')}` : t('cm.suggest')} onClose={() => onClose()} wide>
      <div className="col">
        <div className="muted" style={{ fontSize: 12.5 }}>{t(kind === 'bug' ? 'cm.bugHint' : 'cm.writeHint')}</div>
        <label className="prof-field">{t('cm.titleLabel')}<input value={title} maxLength={90} onChange={(e) => setTitle(e.target.value)} placeholder={t(kind === 'bug' ? 'cm.bugTitlePh' : 'cm.titlePh')} /></label>
        {dupes.length > 0 && (
          <div className="insight warn">
            <b>{t('cm.similar')}</b>
            {dupes.map((d) => <div key={d.id}>▲ {d.votes} · {d.title} <span className="muted">({t(`cm.st.${d.status}`)})</span></div>)}
            <div className="muted" style={{ fontSize: 12 }}>{t('cm.similarHint')}</div>
          </div>
        )}
        {kind === 'suggest' && (
          <label className="prof-field">{t('cm.category')}
            <select value={cat} onChange={(e) => setCat(e.target.value)}>{SG_CATS.filter((c) => c !== 'bug').map((c) => <option key={c} value={c}>{t(`cm.cat.${c}`)}</option>)}</select>
          </label>
        )}
        <label className="prof-field">{t('cm.description')}<textarea rows={6} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t(kind === 'bug' ? 'cm.bugBodyPh' : 'cm.bodyPh')} /></label>
        <label className="prof-field">{t('cm.screenshot')}
          <input type="file" accept="image/*" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setImage(await shrinkImage(f).catch(() => '')); }} />
        </label>
        {image && <img className="sg-img" src={image} alt="" />}
        {kind === 'bug' && <div className="muted" style={{ fontSize: 12 }}>{t('cm.autoMeta')}: {meta ?? autoMeta()}</div>}
        {err && <div className="insight bad">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button onClick={() => onClose()}>{t('common.cancel')}</button>
          <button className="primary" disabled={busy || title.trim().length < 6 || body.trim().length < 10} onClick={send}>{t('cm.submit')}</button>
        </div>
      </div>
    </Modal>
  );
}

/** Fejlrapport: version, skærm og browser sendes med automatisk */
function autoMeta(): string {
  const v = APP_VERSION;
  const ua = navigator.userAgent.replace(/\(([^)]*)\)/, '').slice(0, 80);
  return [v && `v${v}`, `${window.innerWidth}×${window.innerHeight}`, location.search || '', ua].filter(Boolean).join(' · ');
}

/** Fejlrapport med ét klik (fra menuen i spillet) – sender den aktuelle skærm med */
export function BugReportButton({ screen, version, date }: { screen: string; version: string; date: string }) {
  const [open, setOpen] = useState(false);
  const prof = getProfile();
  if (!communityAvailable()) return null;
  return (
    <>
      <button className="small bug-btn" onClick={() => setOpen(true)} title={t('cm.reportBug')}>🐞 {t('cm.reportBug')}</button>
      {open && (prof ? <WriteModal kind="bug" meta={`v${version} · ${screen} · ${date} · ${window.innerWidth}×${window.innerHeight}`} onClose={() => setOpen(false)} /> : (
        <Modal title={t('cm.reportBug')} onClose={() => setOpen(false)}><ProfileGate onDone={() => setOpen(false)} /></Modal>
      ))}
    </>
  );
}

/** Den offentlige side (uden spil): ?community=1 eller ?suggestion=ID */
export function PublicCommunityPage({ id, onClose }: { id?: number; onClose: () => void }) {
  return (
    <div className="pub">
      <div className="start-aurora" aria-hidden><i /><i /><i /></div>
      <div className="pub-box" style={{ width: 'min(1100px, 100%)' }}>
        <button className="small start-ghost" onClick={onClose}>← TACTICA FC</button>
        <h1 style={{ margin: '24px 0 4px' }}>{t('cm.title')}</h1>
        <p className="muted" style={{ marginTop: 0 }}>{t('cm.intro')}</p>
        <CommunityBoard initialId={id} />
      </div>
    </div>
  );
}
