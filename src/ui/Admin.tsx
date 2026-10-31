// Adminside (kun for udvikleren): ?admin=1. Kræver ADMIN_TOKEN (sat på serveren), gemt i browseren.
import { useEffect, useState } from 'react';
import type { SgStatus, Suggestion } from '../online/community';
import { supporters, type SupporterList } from '../online/support';
import { dateFmt } from '../i18n';
import { Panel } from './components';

const KEY = 'cm0102.admin';
const STATUSES: SgStatus[] = ['new', 'considering', 'planned', 'progress', 'released', 'rejected'];

async function call(op: string, data: Record<string, unknown>) {
  const admin = localStorage.getItem(KEY) ?? '';
  const r = await fetch('/api/community', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': admin }, body: JSON.stringify({ op: `admin:${op}`, admin, ...data }) });
  return r.ok ? r.json() : { error: (await r.json()).error ?? r.status };
}
async function get<T>(q: string): Promise<T | null> {
  const r = await fetch(`/api/community?${q}`, { headers: { 'x-admin-token': localStorage.getItem(KEY) ?? '' } });
  return r.ok ? r.json() : null;
}

export function AdminPage({ onClose }: { onClose: () => void }) {
  const [token, setToken] = useState(() => localStorage.getItem(KEY) ?? '');
  const [items, setItems] = useState<Suggestion[]>([]);
  const [sel, setSel] = useState<Suggestion | null>(null);
  const [reply, setReply] = useState('');
  const [mergeInto, setMergeInto] = useState('');
  const [released, setReleased] = useState('');
  const [poll, setPoll] = useState<number[]>([]);
  const [pollTitle, setPollTitle] = useState('What should we build next?');
  const [pollEnds, setPollEnds] = useState('');
  const [sus, setSus] = useState<{ id: number; ip: string; n: number }[]>([]);
  const [sup, setSup] = useState<SupporterList | null>(null);
  const [msg, setMsg] = useState('');
  const load = async () => {
    const r = await get<{ items: Suggestion[] }>('list=new');
    setItems(r?.items ?? []);
    setSus((await get<{ items: { id: number; ip: string; n: number }[] }>('suspicious=1'))?.items ?? []);
    setSup(await supporters());
  };
  useEffect(() => { if (token) void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const done = (r: { error?: unknown }) => { setMsg(r.error ? `Fejl: ${String(r.error)}` : 'Gemt ✓'); void load(); };
  if (!token || !localStorage.getItem(KEY)) {
    return (
      <div className="pub"><div className="pub-box">
        <h1>Admin</h1>
        <div className="row"><input type="password" placeholder="ADMIN_TOKEN" value={token} onChange={(e) => setToken(e.target.value)} /><button className="primary" onClick={() => { localStorage.setItem(KEY, token); void load(); setToken(token + ''); }}>Log ind</button></div>
        <button className="small" style={{ marginTop: 12 }} onClick={onClose}>← Tilbage</button>
      </div></div>
    );
  }
  return (
    <div className="pub"><div className="pub-box" style={{ width: 'min(1200px, 100%)' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>Admin – fællesskab</h1>
        <div className="row"><button className="small" onClick={() => { localStorage.removeItem(KEY); setToken(''); }}>Log ud</button><button className="small" onClick={onClose}>← Spillet</button></div>
      </div>
      {msg && <div className="insight">{msg}</div>}
      <div className="cols" style={{ marginTop: 12 }}>
        <Panel title={`Forslag (${items.length})`} className="flush">
          <div className="table-wrap" style={{ maxHeight: 520, overflowY: 'auto' }}>
            <table className="grid">
              <tbody>
                {items.map((s) => (
                  <tr key={s.id} className={`clickable ${sel?.id === s.id ? 'me' : ''}`} onClick={() => { setSel(s); setReply(s.reply ?? ''); setReleased(s.releasedIn ?? ''); }}>
                    <td><input type="checkbox" checked={poll.includes(s.id)} onClick={(e) => e.stopPropagation()} onChange={() => setPoll(poll.includes(s.id) ? poll.filter((x) => x !== s.id) : [...poll, s.id].slice(0, 5))} /></td>
                    <td>#{s.id}</td><td>{s.hidden ? '🙈 ' : ''}{s.title}</td><td className="num">▲ {s.votes}</td><td>{s.status}</td><td className="muted">{s.cat}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title={sel ? `#${sel.id} ${sel.title}` : 'Vælg et forslag'}>
          {sel && (
            <div className="col">
              <p style={{ whiteSpace: 'pre-line', margin: 0 }}>{sel.body}</p>
              <div className="muted" style={{ fontSize: 12 }}>{sel.name} · {dateFmt(sel.created.slice(0, 10))} · {sel.lang}{sel.meta ? ` · ${sel.meta}` : ''}</div>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                {STATUSES.map((st) => <button key={st} className={`small ${sel.status === st ? 'primary' : ''}`} onClick={async () => done(await call('status', { id: sel.id, status: st, releasedIn: st === 'released' ? released : undefined }))}>{st}</button>)}
              </div>
              <label className="row">Udgivet i version <input value={released} onChange={(e) => setReleased(e.target.value)} placeholder="0.7.84" style={{ width: 100 }} /></label>
              <textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Officielt svar (vises øverst på forslaget)" />
              <div className="row">
                <button className="primary small" onClick={async () => done(await call('reply', { id: sel.id, text: reply }))}>Gem svar</button>
                <button className="small" onClick={async () => done(await call('comment', { id: sel.id, text: reply }))}>Send som kommentar</button>
                <button className="small danger" onClick={async () => done(await call('hide', { id: sel.id, hidden: !sel.hidden }))}>{sel.hidden ? 'Vis igen' : 'Skjul'}</button>
              </div>
              <div className="row">Slå sammen med #<input value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} style={{ width: 70 }} /><button className="small" onClick={async () => done(await call('merge', { id: sel.id, into: Number(mergeInto) }))}>Slå sammen</button></div>
            </div>
          )}
        </Panel>
      </div>
      <div className="cols">
        <Panel title="Månedens afstemning">
          <div className="muted">Markér 2–5 forslag i listen ({poll.map((x) => `#${x}`).join(', ') || 'ingen valgt'}).</div>
          <div className="row" style={{ marginTop: 8 }}>
            <input value={pollTitle} onChange={(e) => setPollTitle(e.target.value)} />
            <input type="date" value={pollEnds} onChange={(e) => setPollEnds(e.target.value)} />
            <button className="primary small" disabled={poll.length < 2} onClick={async () => done(await call('poll', { candidates: poll, title: pollTitle, ends: pollEnds }))}>Start afstemning</button>
          </div>
        </Panel>
        <Panel title={`Mistænkelige stemmer (${sus.length})`}>
          {sus.length === 0 ? <div className="muted">Intet mistænkeligt.</div> : <table className="grid"><tbody>{sus.map((x, i) => <tr key={i}><td>#{x.id}</td><td>{x.ip}</td><td className="num">{x.n} stemmer</td></tr>)}</tbody></table>}
        </Panel>
      </div>
      <Panel title={`Supportere (${sup?.supporters.length ?? 0})`}>
        {sup && <div className="muted">Denne måned: {(sup.month.raised / 100).toFixed(0)} af {(sup.month.goal / 100).toFixed(0)} {sup.currency.toUpperCase()}{sup.enabled ? '' : ' · Stripe er ikke sat op endnu'}</div>}
        <div className="sup-wall" style={{ marginTop: 8 }}>{sup?.supporters.map((s) => <span key={s.pid}>{s.tier} · {s.name}{s.monthly ? ' ♥' : ''}{s.regen ? ` (regen: ${s.regen})` : ''}</span>)}</div>
      </Panel>
    </div></div>
  );
}
