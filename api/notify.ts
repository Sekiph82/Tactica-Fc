// Mail til udvikleren, når en ny singleplayer-karriere startes (Vercel Function + Resend).
// Modtageren står i NOTIFY_EMAIL; mangler den eller RESEND_API_KEY, gør endpointet ingenting.
// Begrænset pr. IP, så ingen kan bruge det til at oversvømme indbakken.
import { Redis } from '@upstash/redis';

const redis = process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
  ? new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN })
  : null;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const clip = (v: unknown, n = 60) => String(v ?? '').replace(/[\r\n<>]/g, ' ').trim().slice(0, n);

export async function POST(request: Request) {
  const key = process.env.RESEND_API_KEY, to = process.env.NOTIFY_EMAIL;
  if (!key || !to) return json({ ok: false, disabled: true });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: 'json' }, 400); }

  if (redis) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
    const hour = Math.floor(Date.now() / 3_600_000);
    const [ipHits, allHits] = await Promise.all([redis.incr(`nt:ip:${ip}:${hour}`), redis.incr(`nt:all:${hour}`)]);
    if (ipHits === 1) await redis.expire(`nt:ip:${ip}:${hour}`, 7200);
    if (allHits === 1) await redis.expire(`nt:all:${hour}`, 7200);
    if (ipHits > 5 || allHits > 60) return json({ error: 'limit' }, 429);
  }

  const manager = clip(body.manager, 30), club = clip(body.club), league = clip(body.league), nation = clip(body.nation, 40);
  if (!manager || !club) return json({ error: 'missing' }, 400);
  const lines = [
    `Manager: ${manager}`,
    `Klub: ${club}`,
    league && `Liga: ${league}${nation ? ` (${nation})` : ''}`,
    body.challenge && `Udfordring: ${clip(body.challenge, 40)}`,
    Number(body.bots) > 0 && `AI-managere: ${Number(body.bots)}`,
    `Database: ${clip(body.db, 20) || 'standard'}`,
    `Sprog: ${clip(body.lang, 5)}`,
    `Tid: ${new Date().toLocaleString('da-DK', { timeZone: 'Europe/Copenhagen' })}`,
  ].filter(Boolean);

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: process.env.NOTIFY_FROM ?? 'CM Reborn <onboarding@resend.dev>',
      to: [to],
      subject: `Ny karriere: ${manager} – ${club}`,
      text: lines.join('\n'),
    }),
  });
  if (!r.ok) return json({ error: 'send', status: r.status }, 502);
  return json({ ok: true });
}
