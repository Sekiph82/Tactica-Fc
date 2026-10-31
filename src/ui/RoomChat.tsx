// Chat og voice-chat i et online-rum (bruges under draften). Kan foldes sammen i hjørnet.
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { session } from '../online/client';
import { startVoice, stopVoice, voice } from '../online/voice';

export function RoomChat() {
  const s = session();
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('cm0102.roomChat') !== '0'; } catch { return true; } });
  const [text, setText] = useState('');
  const [, force] = useState(0);
  const [err, setErr] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const room = s?.room;
  const msgs = (room?.chat ?? []).filter((m) => m.to === 'all' || m.to === s?.creds.pid || m.from === s?.creds.pid);
  const last = msgs.at(-1)?.id ?? 0;
  useEffect(() => { if (open) { list.current?.scrollTo(0, 1e9); s?.markChatSeen(); } }, [open, last]); // eslint-disable-line react-hooks/exhaustive-deps
  // voice-chatten fortsætter, når panelet flyttes mellem draft-skærmen og spillet – kun opdateringen kobles til
  useEffect(() => { const v = voice(); if (v) v.onChange = () => force((x) => x + 1); }, []);
  if (!s || !room) return null;
  const setOpenP = (v: boolean) => { setOpen(v); try { localStorage.setItem('cm0102.roomChat', v ? '1' : '0'); } catch { /* ignorér */ } };
  const unread = open ? 0 : s.unreadChat();
  const v = voice();
  const nameOf = (pid: string) => room.players.find((p) => p.pid === pid)?.name ?? '?';
  const inVoice = room.voice ?? [];
  const send = async () => {
    const x = text.trim();
    if (!x) return;
    setText('');
    try { await s.sendChat('all', x); } catch (e) { setErr(String((e as Error).message)); }
  };
  if (!open) return <button className="room-chat-fab" onClick={() => setOpenP(true)}>💬 {t('rc.chat')}{unread > 0 && <i className="dot">{unread}</i>}{inVoice.length > 0 && <span className="muted"> · 🎙️ {inVoice.length}</span>}</button>;
  return (
    <div className="room-chat">
      <div className="rc-head">
        <b>💬 {t('rc.chat')}</b>
        <button className="small" onClick={() => setOpenP(false)} aria-label={t('common.close')}>–</button>
      </div>
      <div className="rc-voice">
        {!v?.active ? (
          <button className="small primary" onClick={async () => { setErr(''); try { await startVoice(s.creds, () => force((x) => x + 1)); force((x) => x + 1); } catch (e) { setErr(t('rc.micDenied') + ` (${(e as Error).message})`); } }}>🎙️ {t('rc.joinVoice')}</button>
        ) : (
          <>
            <button className={`small ${v.muted ? 'danger' : ''}`} onClick={() => v.toggleMute()}>{v.muted ? `🔇 ${t('rc.unmute')}` : `🎙️ ${t('rc.mute')}`}</button>
            <button className="small" onClick={async () => { await stopVoice(); force((x) => x + 1); }}>{t('rc.leaveVoice')}</button>
          </>
        )}
        <div className="rc-members">
          {(v?.active ? v.members : inVoice).map((pid) => (
            <span key={pid} className={`rc-member ${v?.speaking.has(pid) ? 'talking' : ''} ${v?.active && pid !== s.creds.pid && !v.connectedTo(pid) ? 'connecting' : ''}`} title={v?.active && pid !== s.creds.pid && !v.connectedTo(pid) ? t('rc.connecting') : ''}>
              {nameOf(pid)}{pid === s.creds.pid ? ` (${t('rc.you')})` : ''}
            </span>
          ))}
          {!inVoice.length && !v?.active && <span className="muted">{t('rc.voiceEmpty')}</span>}
        </div>
      </div>
      <div className="rc-list" ref={list}>
        {msgs.length === 0 && <div className="muted">{t('rc.empty')}</div>}
        {msgs.map((m) => (
          <div key={m.id} className={`rc-msg ${m.from === s.creds.pid ? 'me' : ''}`}>
            <b>{m.name}</b> <span className="muted">{new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <div>{m.text}</div>
          </div>
        ))}
      </div>
      {err && <div className="bad" style={{ fontSize: 12 }}>{err}</div>}
      <div className="rc-input">
        <input value={text} maxLength={500} placeholder={t('rc.placeholder')} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void send(); }} />
        <button className="small primary" disabled={!text.trim()} onClick={send}>{t('cm.send')}</button>
      </div>
    </div>
  );
}
