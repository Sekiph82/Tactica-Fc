// Delbart draftkort (1080×1350): klubben, holdet i formationen, ekspertens karakter og kommentar.
import { crestSvg, BENCH_PLACE, teamPicks, type DraftPick, type DraftTeam, type TeamGrade, type TeamPreview } from '../game/draft';
import { formationSlots } from '../game/tactics';
import type { Player } from '../game/types';
import { t } from '../i18n';

const GRADE_COLOR: Record<string, string> = { 'A+': '#3ee08f', A: '#5fd38a', 'B+': '#a6d65a', B: '#ffcf3f', C: '#ffa94d', D: '#ff7a59', F: '#ff4d6d' };

export async function drawDraftCard(team: DraftTeam, picks: DraftPick[], byId: Record<number, Player>, grade: TeamGrade | undefined, season: number, preview?: TeamPreview): Promise<Blob | null> {
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  if (!x) return null;
  const bg = x.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0b1226'); bg.addColorStop(1, '#16285a');
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  x.fillStyle = `${team.colors[0]}33`; x.beginPath(); x.arc(W - 100, 120, 300, 0, Math.PI * 2); x.fill();
  const text = (s: string, px: number, y: number, size: number, color = '#fff', weight = 700, align: CanvasTextAlign = 'left') => { x.font = `${weight} ${size}px Inter, system-ui, sans-serif`; x.fillStyle = color; x.textAlign = align; x.fillText(s, px, y); };
  const wrap = (s: string, px: number, y: number, size: number, maxW: number, color = '#fff', weight = 600) => {
    x.font = `${weight} ${size}px Inter, system-ui, sans-serif`; x.fillStyle = color; x.textAlign = 'left';
    let line = '', yy = y;
    for (const w of s.split(' ')) { const test = line ? `${line} ${w}` : w; if (x.measureText(test).width > maxW && line) { x.fillText(line, px, yy); line = w; yy += size * 1.3; } else line = test; }
    if (line) x.fillText(line, px, yy);
    return yy + size * 1.3;
  };
  // logo
  const img = new Image();
  img.src = `data:image/svg+xml;utf8,${encodeURIComponent(crestSvg(team.crest, team.colors[0], team.colors[1], team.short))}`;
  await img.decode().catch(() => {});
  x.drawImage(img, 70, 60, 150, 150);
  text('CM REBORN · DRAFT LEAGUE', 250, 100, 26, '#ffcf3f', 800);
  text(team.name, 250, 160, 56, '#fff', 900);
  text(`${team.manager} · ${t('dr.seasonN', { n: season })} · ${team.formation}`, 250, 205, 30, '#c2cbe6', 600);
  // karakter
  if (grade) {
    x.fillStyle = 'rgba(255,255,255,0.06)'; x.beginPath(); x.roundRect(70, 245, W - 140, 170, 24); x.fill();
    text(grade.grade, 150, 370, 120, GRADE_COLOR[grade.grade] ?? '#fff', 900, 'center');
    text(t('dr.gradesTitle').toUpperCase(), 260, 290, 22, '#8a93b5', 800);
    wrap(t(grade.line), 260, 330, 30, W - 360, '#fff', 700);
  }
  // banen
  const px = 70, py = 445, pw = W - 140, ph = 640;
  const grass = x.createLinearGradient(0, py, 0, py + ph);
  grass.addColorStop(0, '#2e8b45'); grass.addColorStop(1, '#246f38');
  x.fillStyle = grass; x.beginPath(); x.roundRect(px, py, pw, ph, 22); x.fill();
  x.strokeStyle = 'rgba(255,255,255,0.45)'; x.lineWidth = 3;
  x.strokeRect(px + 20, py + 20, pw - 40, ph - 40);
  x.beginPath(); x.moveTo(px + 20, py + ph / 2); x.lineTo(px + pw - 20, py + ph / 2); x.stroke();
  x.beginPath(); x.arc(px + pw / 2, py + ph / 2, 70, 0, Math.PI * 2); x.stroke();
  const mine = teamPicks(team, picks);
  formationSlots(team.formation).forEach((slot, i) => {
    const pk = mine.find((p) => p.place === i);
    const p = pk ? byId[pk.player] : undefined;
    const cx = px + 50 + (slot.y / 100) * (pw - 100), cy = py + ph - 55 - (slot.x / 100) * (ph - 110);
    x.fillStyle = team.colors[0]; x.strokeStyle = team.colors[1]; x.lineWidth = 4;
    x.beginPath(); x.arc(cx, cy, 30, 0, Math.PI * 2); x.fill(); x.stroke();
    text(p ? String(Math.round(p.ca / 2)) : '–', cx, cy + 10, 26, team.colors[1], 900, 'center');
    x.shadowColor = 'rgba(0,0,0,0.8)'; x.shadowBlur = 6;
    text(p?.last ?? '', cx, cy + 58, 24, '#fff', 800, 'center');
    x.shadowBlur = 0;
  });
  // bænken
  const bench = mine.filter((p) => p.place === BENCH_PLACE).map((p) => byId[p.player]?.last).filter(Boolean);
  text(`${t('dr.bench').toUpperCase()}: ${bench.join(' · ')}`, 70, 1135, 26, '#c2cbe6', 700);
  if (preview) text(`🔮 ${t('dr.cardPreview', { pos: preview.expPos, pts: preview.expPts, pct: preview.title })}`, 70, 1230, 28, '#ffcf3f', 800);
  if (grade?.steal && byId[grade.steal.player]) text(`🔥 ${t('dr.cardSteal', { player: `${byId[grade.steal.player].first} ${byId[grade.steal.player].last}`.trim() })}`, 70, 1185, 28, '#9ff0bd', 800);
  text(t('dr.cardCta'), 70, H - 80, 30, '#fff', 800);
  text('cm0102-reborn.vercel.app/?draft=1', 70, H - 40, 26, '#8a93b5', 600);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}

export async function shareDraftCard(blob: Blob, name: string): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'draft'}.png`, { type: 'image/png' });
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: name }); return 'shared'; }
  } catch { /* afbrudt */ }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  return 'downloaded';
}
