// Klient til fællesskabet (api/community.ts): forslag, stemmer, kommentarer, afstemning og fejlrapporter.
import { getProfile, rankingAvailable } from './rank';

export type SgStatus = 'new' | 'considering' | 'planned' | 'progress' | 'released' | 'rejected';
export const SG_CATS = ['gameplay', 'match', 'transfers', 'ui', 'bug', 'other'] as const;
export interface Suggestion {
  id: number; title: string; body: string; cat: string; lang: string; pid: string; name: string; created: string;
  status: SgStatus; votes: number; comments: number; reply?: string; releasedIn?: string; hidden?: boolean; hasImage?: boolean; meta?: string;
  supporter?: string;
}
export interface SgComment { i: number; pid: string; name: string; text: string; at: string; dev?: boolean; supporter?: string }

export const communityAvailable = rankingAvailable;

async function get<T>(q: string): Promise<T | null> {
  try { const r = await fetch(`/api/community?${q}`); return r.ok ? await r.json() : null; } catch { return null; }
}
async function post<T>(op: string, data: Record<string, unknown>): Promise<T | { error: string }> {
  const prof = getProfile();
  if (!prof) return { error: 'noProfile' };
  try {
    const r = await fetch('/api/community', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op, pid: prof.pid, token: prof.token, ...data }) });
    const j = await r.json();
    return r.ok ? j : { error: String(j.error ?? 'error') };
  } catch { return { error: 'network' }; }
}
const me = () => { const p = getProfile(); return p ? `&pid=${p.pid}` : ''; };

export const listSuggestions = (list: string, cat = '') => get<{ items: Suggestion[]; voted: number[] }>(`list=${list}&cat=${cat}${me()}`);
export const getSuggestion = (id: number) => get<{ suggestion: Suggestion; comments: SgComment[]; image: string | null; voted: boolean }>(`id=${id}${me()}`);
export const similar = (title: string) => get<{ items: Suggestion[] }>(`similar=${encodeURIComponent(title)}`);
export const getPoll = () => get<{ poll: { id: string; title: string; ends: string; items: (Suggestion & { pollVotes: number })[]; mine: number | null } | null }>(`poll=1${me()}`);
export const myVotes = () => (getProfile() ? get<{ used: number; budget: number; canVote: boolean }>(`me=1${me()}`) : Promise.resolve(null));

export const suggest = (d: { title: string; body: string; cat: string; lang: string; image?: string }) => post<{ ok: true; id: number }>('suggest', d);
export const reportBug = (d: { title: string; body: string; lang: string; meta: string; image?: string }) => post<{ ok: true; id: number }>('bug', d);
export const vote = (id: number, on: boolean) => post<{ ok: true; used: number; budget: number }>('vote', { id, on });
export const comment = (id: number, text: string) => post<{ ok: true }>('comment', { id, text });
export const reportContent = (id: number) => post<{ ok: true }>('report', { id });
export const pollVote = (sid: number) => post<{ ok: true }>('pollVote', { sid });

export const suggestionUrl = (id: number) => `${location.origin}${import.meta.env.BASE_URL}?suggestion=${id}`;
export const communityUrl = () => `${location.origin}${import.meta.env.BASE_URL}?community=1`;

/** Skærmbillede: skaleres ned til højst 1000 px bredde (JPEG) */
export function shrinkImage(file: File, max = 1000): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.78));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
    img.src = url;
  });
}
