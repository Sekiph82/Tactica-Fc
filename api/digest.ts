// Ugentlig mail til udvikleren (Vercel Cron, mandag morgen): nye forslag, top 5, nye fejlrapporter og nye supportere.
// Kræver RESEND_API_KEY og NOTIFY_EMAIL. Vercel Cron sender "Authorization: Bearer $CRON_SECRET".
import { Redis } from '@upstash/redis';

const redis = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) return json({ error: 'auth' }, 401);
  const key = process.env.RESEND_API_KEY, to = process.env.NOTIFY_EMAIL;
  if (!key || !to) return json({ ok: false, disabled: true });
  const since = Date.now() - 7 * 86_400_000;
  const get = async (id: string) => redis.hgetall<Record<string, string>>(`sg:${id}`);
  // nye forslag og fejl den seneste uge
  const newIds = ((await redis.zrange<string[]>('sg:new', since, '+inf', { byScore: true })) ?? []).slice(-60);
  const fresh = (await Promise.all(newIds.map(get))).filter(Boolean) as Record<string, string>[];
  const bugs = fresh.filter((s) => s.cat === 'bug');
  const ideas = fresh.filter((s) => s.cat !== 'bug');
  const topIds = (await redis.zrange<string[]>('sg:top', 0, 4, { rev: true })) ?? [];
  const top = (await Promise.all(topIds.map(get))).filter(Boolean) as Record<string, string>[];
  // nye supportere (seneste uge)
  const supIds = (await redis.zrange<string[]>('supporters', 0, 499, { rev: true })) ?? [];
  const sups = (await Promise.all(supIds.map((pid) => redis.hgetall<Record<string, string>>(`prof:${pid}`)))).filter((p) => p?.lastDonation && Date.parse(p.lastDonation) >= since) as Record<string, string>[];
  const month = new Date().toISOString().slice(0, 7);
  const raised = Number((await redis.get(`support:month:${month}`)) ?? 0);
  const line = (s: Record<string, string>) => `  #${s.id} ▲${s.votes ?? 0} ${s.title} (${s.status})`;
  const text = [
    `CM Reborn – ugen der gik`,
    ``,
    `Nye forslag (${ideas.length}):`, ...(ideas.length ? ideas.map(line) : ['  –']),
    ``,
    `Nye fejlrapporter (${bugs.length}):`, ...(bugs.length ? bugs.map((s) => `${line(s)}\n     ${s.meta ?? ''}`) : ['  –']),
    ``,
    `Top 5 lige nu:`, ...(top.length ? top.map(line) : ['  –']),
    ``,
    `Nye bidrag (${sups.length}): ${sups.map((p) => `${p.name} (${p.supporter ?? '–'})`).join(', ') || '–'}`,
    `Indsamlet denne måned: ${(raised / 100).toFixed(2)}`,
    ``,
    `Admin: https://cm0102-reborn.vercel.app/?admin=1`,
  ].join('\n');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: process.env.NOTIFY_FROM ?? 'CM Reborn <onboarding@resend.dev>', to: [to], subject: `Ugens fællesskab: ${ideas.length} forslag, ${bugs.length} fejl, ${sups.length} bidrag`, text }),
  });
  return json({ ok: r.ok });
}
