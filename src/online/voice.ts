// Voice-chat i et online-rum (WebRTC, alle forbundet med alle). Serveren formidler kun forbindelsesbeskederne
// (tilbud, svar og netværksadresser); lyden går direkte mellem browserne.
import { mpPost, type Credentials } from './client';

type Sig = { kind: 'offer' | 'answer'; sdp: string } | { kind: 'ice'; c: RTCIceCandidateInit } | { kind: 'bye' };
const ICE: RTCConfiguration = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };

export class VoiceChat {
  private pcs = new Map<string, RTCPeerConnection>();
  private audio = new Map<string, HTMLAudioElement>();
  private stream: MediaStream | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private levels: ReturnType<typeof setInterval> | null = null;
  private beat = 0;
  members: string[] = [];
  muted = false;
  /** Hvem taler lige nu (lydniveau over en tærskel) */
  speaking = new Set<string>();
  private meters = new Map<string, () => number>();
  private ctx: AudioContext | null = null;
  onChange: () => void = () => {};

  private creds: Credentials;
  constructor(creds: Credentials) { this.creds = creds; }

  get active() { return !!this.stream; }

  async join() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.ctx = new AudioContext();
    this.meter(this.creds.pid, this.stream);
    const r = await mpPost<{ voice: string[] }>('voice', { ...this.creds, on: true });
    this.members = r.voice;
    this.timer = setInterval(() => { void this.tick(); }, 1000);
    this.levels = setInterval(() => this.measure(), 200);
    await this.tick();
  }

  async leave() {
    if (this.timer) clearInterval(this.timer);
    if (this.levels) clearInterval(this.levels);
    this.timer = null;
    this.levels = null;
    for (const pid of [...this.pcs.keys()]) { void this.send(pid, { kind: 'bye' }); this.drop(pid); }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close();
    this.ctx = null;
    this.meters.clear();
    this.speaking.clear();
    this.members = [];
    try { await mpPost('voice', { ...this.creds, on: false }); } catch { /* offline */ }
    this.onChange();
  }

  toggleMute() {
    this.muted = !this.muted;
    this.stream?.getAudioTracks().forEach((t) => { t.enabled = !this.muted; });
    this.onChange();
  }

  private async send(to: string, data: Sig) {
    try { await mpPost('sig', { ...this.creds, to, data }); } catch { /* prøver igen ved næste tilbud */ }
  }

  private peer(pid: string): RTCPeerConnection {
    let pc = this.pcs.get(pid);
    if (pc) return pc;
    pc = new RTCPeerConnection(ICE);
    for (const t of this.stream?.getTracks() ?? []) pc.addTrack(t, this.stream!);
    pc.onicecandidate = (e) => { if (e.candidate) void this.send(pid, { kind: 'ice', c: e.candidate.toJSON() }); };
    pc.ontrack = (e) => {
      let el = this.audio.get(pid);
      if (!el) { el = new Audio(); el.autoplay = true; this.audio.set(pid, el); }
      el.srcObject = e.streams[0];
      void el.play().catch(() => {});
      this.meter(pid, e.streams[0]);
    };
    pc.onconnectionstatechange = () => { if (pc!.connectionState === 'failed' || pc!.connectionState === 'closed') { this.drop(pid); this.onChange(); } else this.onChange(); };
    this.pcs.set(pid, pc);
    return pc;
  }

  private drop(pid: string) {
    this.pcs.get(pid)?.close();
    this.pcs.delete(pid);
    const el = this.audio.get(pid);
    if (el) { el.srcObject = null; this.audio.delete(pid); }
    this.meters.delete(pid);
    this.speaking.delete(pid);
  }

  /** Lydniveau pr. deltager (til "taler nu"-markeringen) */
  private meter(pid: string, stream: MediaStream) {
    if (!this.ctx) return;
    const an = this.ctx.createAnalyser();
    an.fftSize = 512;
    this.ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    this.meters.set(pid, () => {
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += (v - 128) ** 2;
      return Math.sqrt(sum / buf.length);
    });
  }

  connectedTo(pid: string) { return this.pcs.get(pid)?.connectionState === 'connected'; }

  private async tick() {
    if (!this.stream) return;
    // hjerteslag, så de andre kan se, at vi er med
    if (++this.beat % 8 === 0) { try { await mpPost('voice', { ...this.creds, on: true }); } catch { /* offline */ } }
    let r: { msgs: { from: string; data: Sig }[]; voice: string[] };
    try { r = await mpPost('sigpull', { ...this.creds }); } catch { return; }
    this.members = r.voice;
    for (const { from, data } of r.msgs) {
      try {
        if (data.kind === 'bye') { this.drop(from); continue; }
        const pc = this.peer(from);
        if (data.kind === 'offer') {
          await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
          const ans = await pc.createAnswer();
          await pc.setLocalDescription(ans);
          await this.send(from, { kind: 'answer', sdp: ans.sdp ?? '' });
        } else if (data.kind === 'answer') {
          if (pc.signalingState === 'have-local-offer') await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        } else if (data.kind === 'ice') {
          if (pc.remoteDescription) await pc.addIceCandidate(data.c).catch(() => {});
          else setTimeout(() => { void pc.addIceCandidate(data.c).catch(() => {}); }, 1500);
        }
      } catch { /* næste forsøg */ }
    }
    // nye deltagere: den med det "laveste" id ringer op (så kun én af de to starter forbindelsen)
    for (const pid of this.members) {
      if (pid === this.creds.pid || this.pcs.has(pid) || this.creds.pid > pid) continue;
      const pc = this.peer(pid);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this.send(pid, { kind: 'offer', sdp: offer.sdp ?? '' });
    }
    // deltagere der har forladt chatten
    for (const pid of [...this.pcs.keys()]) if (!this.members.includes(pid)) this.drop(pid);
    this.onChange();
  }

  /** Hvem taler (måles fem gange i sekundet) */
  private measure() {
    const sp = new Set<string>();
    for (const [pid, m] of this.meters) if (!(pid === this.creds.pid && this.muted) && m() > 6) sp.add(pid);
    const changed = sp.size !== this.speaking.size || [...sp].some((x) => !this.speaking.has(x));
    this.speaking = sp;
    if (changed) this.onChange();
  }
}

let current: VoiceChat | null = null;
export const voice = () => current;
export async function startVoice(creds: Credentials, onChange: () => void): Promise<VoiceChat> {
  if (current) await current.leave();
  current = new VoiceChat(creds);
  current.onChange = onChange;
  await current.join();
  return current;
}
export async function stopVoice() { await current?.leave(); current = null; }
