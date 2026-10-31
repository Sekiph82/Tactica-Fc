// Klient til AI-teksterne (api/ai.ts). Alt er valgfrit: er AI slået fra, offline eller ikke
// tilgængelig (fx på GitHub Pages), returneres null, og spillet bruger sine faste skabeloner.
import { gs, hasGame, notify } from '../game/state';
import { getLang } from '../i18n';

export type AiKind = 'press' | 'pressAnswer' | 'pressReport' | 'talkIntent' | 'talkReply' | 'agent' | 'article' | 'fans';

let probe: Promise<boolean> | null = null;

/** Findes AI-endpointet (kun på Vercel-udrulningen)? */
export function aiAvailable(): Promise<boolean> {
  if (!probe) {
    // API'et findes kun på Vercel-udrulningen (base '/'); GitHub Pages og lokal udvikling har det ikke
    const onVercel = import.meta.env.BASE_URL === '/' || import.meta.env.VITE_AI === '1';
    probe = !onVercel ? Promise.resolve(false) : fetch('/api/ai', { method: 'GET' })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((j: { enabled?: boolean }) => !!j.enabled)
      .catch(() => false);
  }
  return probe;
}

/** Er AI slået til i indstillingerne? (standard: ja) */
export function aiWanted(): boolean {
  return hasGame() ? gs().options.ai !== false : true;
}

const inflight = new Map<string, Promise<unknown>>();

export async function aiCall<T>(kind: AiKind, ctx: unknown, timeoutMs = 15_000): Promise<T | null> {
  if (!aiWanted() || !(await aiAvailable())) return null;
  // teksterne skrives på det sprog, brugerfladen står på lige nu (ikke det sprog, spillet blev startet på)
  const lang = getLang();
  try {
    const r = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, lang, ctx }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

// ---------- kosmetisk tekstlager (gemmes med spillet, påvirker ikke spillets regler) ----------

const MAX_TEXTS = 250;

/** Teksterne gemmes pr. sprog (dansk er uden præfiks, så ældre gemte spil stadig virker) */
const langKey = (key: string) => (getLang() === 'da' ? key : `${getLang()}:${key}`);

export function aiText(key: string): string | undefined {
  return hasGame() ? gs().aiText?.[langKey(key)] : undefined;
}

export function setAiText(key: string, text: string) {
  if (!hasGame()) return;
  const g = gs();
  const store = (g.aiText ??= {});
  store[langKey(key)] = text;
  const keys = Object.keys(store);
  if (keys.length > MAX_TEXTS) for (const k of keys.slice(0, keys.length - MAX_TEXTS)) delete store[k];
  notify();
}

/** Hent en tekst én gang og gem den under key (samtidige kald deles) */
export function ensureAiText(key: string, make: () => Promise<string | null>): Promise<string | null> {
  const have = aiText(key);
  if (have) return Promise.resolve(have);
  const running = inflight.get(langKey(key)) as Promise<string | null> | undefined;
  if (running) return running;
  const p = make().then((txt) => {
    inflight.delete(langKey(key));
    if (txt) setAiText(key, txt);
    return txt;
  });
  inflight.set(langKey(key), p);
  return p;
}
