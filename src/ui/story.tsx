// Sæsonfortællingen: tidslinjen for den igangværende sæson og et delbart sæsonkort for afsluttede sæsoner.
import { useState } from 'react';
import type { SeasonStory, StoryItem } from '../game/types';
import { dateFmt, t } from '../i18n';
import { getAvatar } from './avatar';
import { Panel } from './components';
import { useGame, useNav } from './core';

const ICON: Record<string, string> = { trophy: '🏆', promotion: '⬆️', relegation: '⬇️', comeback: '🔄', lostLead: '💔', bigWin: '💥', heavyLoss: '😣', derbyWin: '⚔️', derbyLoss: '⚔️', derbyDraw: '⚔️', breakthrough: '🌟', signing: '✍️', fansUp: '📣', fansDown: '📉' };

export const storyText = (it: StoryItem) => t(`story.k.${it.k}`, it.p);

/** Årets vendepunkter indtil nu (nyeste først) */
export function StoryTimeline() {
  const g = useGame()!;
  const { nav } = useNav();
  const items = g.manager.story?.season === g.season ? g.manager.story.items.slice().sort((a, b) => b.d.localeCompare(a.d)) : [];
  return (
    <Panel title={t('story.now', { season: `${g.season}/${String(g.season + 1).slice(2)}` })}>
      {!items.length ? <div className="muted">{t('story.empty')}</div> : (
        <ol className="story-line">
          {items.slice(0, 20).map((it, i) => (
            <li key={i} className={it.w >= 5 ? 'big' : ''} onClick={() => (it.fixture && g.reports[it.fixture] ? nav({ name: 'report', id: it.fixture }) : it.pid ? nav({ name: 'player', id: it.pid }) : undefined)}>
              <span className="story-ic">{ICON[it.k] ?? '•'}</span><span className="muted">{dateFmt(it.d)}</span><span>{storyText(it)}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

/** Afsluttet sæson som kort – kan deles som billede */
export function SeasonCard({ s }: { s: SeasonStory }) {
  const g = useGame()!;
  const [msg, setMsg] = useState('');
  const best = s.items[0];
  const season = `${s.season}/${String(s.season + 1).slice(2)}`;
  const share = async () => {
    const blob = await drawCard(s, g.manager.name, season);
    if (!blob) return;
    const file = new File([blob], `saeson-${s.season}.png`, { type: 'image/png' });
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: t('story.cardTitle', { season }) }); return; }
    } catch { /* afbrudt */ }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    a.click();
    setMsg(t('story.downloaded'));
  };
  return (
    <div className="season-card">
      <div className="sc-head">
        <div><b>{s.clubName}</b><span>{season} · {s.league}</span></div>
        <div className="sc-pos">{s.pos ? `${s.pos}.` : '–'}</div>
      </div>
      <div className="sc-stats">
        <span>{t('story.record', { w: s.record[0], d: s.record[1], l: s.record[2] })}</span>
        <span>{t('story.goals', { gf: s.gf, ga: s.ga })}</span>
        {s.top && <span>{t('story.top', { name: s.top.name, n: s.top.goals })}</span>}
      </div>
      {best && <div className="sc-best"><em>{t('story.bestMoment')}</em>{ICON[best.k] ?? ''} {storyText(best)}</div>}
      <ul className="sc-list">{s.items.slice(1, 6).map((it, i) => <li key={i}>{ICON[it.k] ?? '•'} {storyText(it)}</li>)}</ul>
      <div className="row"><button className="small primary" onClick={share}>{t('story.share')}</button>{msg && <span className="muted">{msg}</span>}</div>
    </div>
  );
}

/** Tegn sæsonkortet som et billede (1080×1350) til deling */
async function drawCard(s: SeasonStory, manager: string, season: string): Promise<Blob | null> {
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  if (!x) return null;
  const grad = x.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#0b1226'); grad.addColorStop(1, '#22184a');
  x.fillStyle = grad; x.fillRect(0, 0, W, H);
  x.fillStyle = 'rgba(255, 207, 63, 0.15)'; x.beginPath(); x.arc(W - 120, 140, 320, 0, Math.PI * 2); x.fill();
  const text = (str: string, px: number, y: number, size: number, color = '#fff', weight = 700) => { x.font = `${weight} ${size}px Inter, system-ui, sans-serif`; x.fillStyle = color; x.fillText(str, px, y); };
  const wrap = (str: string, px: number, y: number, size: number, maxW: number, color = '#fff', weight = 600) => {
    x.font = `${weight} ${size}px Inter, system-ui, sans-serif`; x.fillStyle = color;
    let line = '', yy = y;
    for (const w of str.split(' ')) { const test = line ? `${line} ${w}` : w; if (x.measureText(test).width > maxW && line) { x.fillText(line, px, yy); line = w; yy += size * 1.3; } else line = test; }
    if (line) x.fillText(line, px, yy);
    return yy + size * 1.3;
  };
  const av = getAvatar();
  if (av) { const img = new Image(); img.src = av; await img.decode().catch(() => {}); x.save(); x.beginPath(); x.arc(150, 170, 80, 0, Math.PI * 2); x.clip(); x.drawImage(img, 70, 90, 160, 160); x.restore(); }
  text('CM REBORN', av ? 260 : 80, 120, 30, '#ffcf3f', 800);
  text(manager, av ? 260 : 80, 180, 56, '#fff', 900);
  text(`${s.clubName} · ${season}`, av ? 260 : 80, 232, 34, '#c2cbe6', 600);
  text(s.pos ? `${s.pos}.` : '–', 80, 420, 150, '#ffcf3f', 900);
  text(s.league, 80, 480, 36, '#c2cbe6', 600);
  text(t('story.record', { w: s.record[0], d: s.record[1], l: s.record[2] }), 80, 560, 36);
  text(t('story.goals', { gf: s.gf, ga: s.ga }), 80, 610, 36);
  if (s.top) text(t('story.top', { name: s.top.name, n: s.top.goals }), 80, 660, 36);
  let y = 760;
  if (s.items[0]) { text(t('story.bestMoment').toUpperCase(), 80, y, 26, '#ffcf3f', 800); y = wrap(storyText(s.items[0]), 80, y + 56, 46, W - 160, '#fff', 800) + 20; }
  for (const it of s.items.slice(1, 5)) y = wrap(`• ${storyText(it)}`, 80, y, 30, W - 160, '#c2cbe6', 500);
  text('cm0102-reborn.vercel.app', 80, H - 70, 26, '#8a93b5', 600);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}
