import { gs } from '../../game/state';

/** Colours used by the match screen and its report statistics. */
export function statColors(home: number, away: number, me: number): [string, string] {
  const g = gs();
  const own = teamColors(home, away, me)[me === 0 ? 0 : 2];
  const ownRgb = rgbOf(own);
  const opp = g.clubs[me === 0 ? away : home];
  const lum = ([r, gg, b]: [number, number, number]) => (0.2126 * r + 0.7152 * gg + 0.0722 * b) / 255;
  const pick = (opp?.colors ?? []).map((c) => (c.startsWith('#') || c.startsWith('rgb') ? c : `#${c}`)).find((c) => {
    const rgb = rgbOf(c);
    if (!rgb || lum(rgb) > 0.88 || lum(rgb) < 0.06) return false;
    return !ownRgb || Math.hypot(rgb[0] - ownRgb[0], rgb[1] - ownRgb[1], rgb[2] - ownRgb[2]) > 110;
  }) ?? (ownRgb && lum(ownRgb) < 0.3 && ownRgb[2] > ownRgb[0] ? '#9aa4b2' : '#1d2b53');
  return me === 0 ? [own, pick] : [pick, own];
}

/** Team colours for the 2D pitch: own club colours and a contrasting opponent. */
export function teamColors(home: number, away: number, me: number): [string, string, string, string] {
  const g = gs();
  const css = getComputedStyle(document.documentElement);
  const navBg = css.getPropertyValue('--nav-bg').trim(), navFg = css.getPropertyValue('--nav-fg').trim();
  const own: [string, string] = navBg ? [navBg, navFg || '#fff'] : [g.clubs[me === 0 ? home : away]?.colors[0] ?? '#d7263d', g.clubs[me === 0 ? home : away]?.colors[1] ?? '#fff'];
  const lum = (c: string) => { const m = c.match(/\d+/g); if (!m) return c.toLowerCase().startsWith('#f') ? 1 : 0.4; const [r, gg, b] = m.map(Number); return (0.2126 * r + 0.7152 * gg + 0.0722 * b) / 255; };
  const opp: [string, string] = lum(own[0]) > 0.7 ? ['#1d2b53', '#ffffff'] : ['#f4f4f4', '#1b2233'];
  return me === 0 ? [own[0], own[1], opp[0], opp[1]] : [opp[0], opp[1], own[0], own[1]];
}

/** Parse '#rrggbb', 'rrggbb', '#rgb', or 'rgb(r, g, b)'. */
function rgbOf(c: string): [number, number, number] | null {
  const m = c.match(/\d+/g);
  if (c.startsWith('rgb') && m && m.length >= 3) return [Number(m[0]), Number(m[1]), Number(m[2])];
  let h = c.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
