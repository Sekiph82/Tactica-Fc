// Farvetema: mørkt (standard), lyst eller i klubbens farver. Klubfarverne aflæses fra klubbens
// logo (de to mest dominerende farver), så Brøndby bliver gul/blå, FCK hvid/blå osv.
// Valget er personligt og gemmes i browseren – ikke i spillet.
import { loadLogos, logoUrl } from './logos';
import { gs, hasGame } from '../game/state';

export type Theme = 'club' | 'clubDark' | 'light' | 'dark' | 'gold' | 'retro';
const KEY = 'cm-theme';
const VARS = ['--accent', '--accent-ink', '--accent2', '--tint1', '--tint2', '--nav-bg', '--nav-fg', '--nav-muted', '--nav-hover', '--nav-active', '--top-bg', '--top-fg', '--top-muted', '--top-chip'];

export function getTheme(): Theme {
  // New installations start with the navy TACTICA FC theme; explicit saved preferences remain unchanged.
  try { const v = localStorage.getItem(KEY); return v === 'dark' || v === 'light' || v === 'clubDark' || v === 'gold' || v === 'retro' || v === 'club' ? v : 'dark'; } catch { return 'dark'; }
}

export function setTheme(t: Theme) {
  try { localStorage.setItem(KEY, t); } catch { /* privat vindue */ }
  applyTheme();
}

type RGB = [number, number, number];
const cache = new Map<number, Promise<RGB[] | null>>();

function hsl([r, g, b]: RGB): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function rgbFromHsl(h: number, s: number, l: number): RGB {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** De (op til) to mest dominerende farver i klubbens logo */
function logoColors(clubId: number): Promise<RGB[] | null> {
  const hit = cache.get(clubId);
  if (hit) return hit;
  // vent på logolisten – ellers ender vi med de tilfældige farver fra datasættet
  const p = loadLogos().then(() => logoUrl(clubId)).then((url) => !url ? null : new Promise<RGB[] | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 48;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, 48, 48);
        const d = ctx.getImageData(0, 0, 48, 48).data;
        const buckets = new Map<number, { n: number; sum: RGB }>();
        let whites = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 200) continue;
          const rgb: RGB = [d[i], d[i + 1], d[i + 2]];
          const [, s, l] = hsl(rgb);
          if (l > 0.9) { whites++; continue; }
          if (l < 0.1 || s < 0.22) continue; // sort, grå
          const k = (rgb[0] >> 5) * 64 + (rgb[1] >> 5) * 8 + (rgb[2] >> 5);
          const b = buckets.get(k) ?? { n: 0, sum: [0, 0, 0] };
          b.n++; b.sum[0] += rgb[0]; b.sum[1] += rgb[1]; b.sum[2] += rgb[2];
          buckets.set(k, b);
        }
        const cols = [...buckets.values()].sort((a, b) => b.n - a.n).map((b) => b.sum.map((v) => Math.round(v / b.n)) as RGB);
        const out: RGB[] = [];
        for (const col of cols) {
          if (out.length >= 4) break;
          // hver farve skal have en tydeligt anden tone end de foregående
          if (out.some((o) => { const dh = Math.abs(hsl(o)[0] - hsl(col)[0]); return Math.min(dh, 360 - dh) < 35; })) continue;
          out.push(col);
        }
        if (out.length === 1 && whites > 40) out.push([240, 244, 255]);
        resolve(out.length ? out : null);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  }));
  cache.set(clubId, p);
  // et mislykket opslag (netværk, logo ikke klar) huskes ikke – så prøver vi igen næste gang
  void p.then((r) => { if (!r) cache.delete(clubId); });
  return p;
}

// Superligaen mangler farver i Wikidata – de er sat i hånden (klub-id → farver)
const MANUAL_COLORS: Record<string, string[]> = {
  190: ['ffffff', '0a2d6e'], // FC København
  1177: ['d0021b', 'ffffff'], // Silkeborg IF
  2778: ['d41a1f', 'ffffff'], // FC Nordsjælland
  5724: ['0039a6', 'ffffff'], // Randers FC
  5776: ['d0021b', 'ffffff'], // FC Fredericia
  5817: ['3a9bd9', 'ffffff'], // Sønderjyske Fodbold
  1063: ['00843d', 'ffffff'], // Viborg FF
  443: ['d1001c', 'ffffff'], // Vejle Boldklub
  865: ['c8102e', '111111'], // FC Midtjylland
};
// officielle klubfarver fra Wikidata (public/data/clubcolors.json)
let official: Promise<Record<string, string[]>> | null = null;
function officialColors(): Promise<Record<string, string[]>> {
  if (!official) {
    official = fetch(`${import.meta.env.BASE_URL}data/clubcolors.json`)
      .then((r) => (r.ok ? r.json() : { colors: {} }))
      .then((d: { colors: Record<string, string[]> }) => ({ ...MANUAL_COLORS, ...(d.colors ?? {}) }))
      .catch(() => { official = null; return {}; });
  }
  return official;
}

const fromHex = (h: string): RGB => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
const hueDist = (x: RGB, y: RGB) => { const d = Math.abs(hsl(x)[0] - hsl(y)[0]); return Math.min(d, 360 - d); };

/**
 * Klubbens to farver: de officielle (Wikidata) bestemmer HVILKE farver, logoet giver den præcise nuance.
 * Uden officielle farver bruges logoets to mest dominerende farver.
 */
async function clubPalette(clubId: number, fallback: RGB[]): Promise<[RGB, RGB | undefined, boolean]> {
  const [logo, off] = await Promise.all([logoColors(clubId), officialColors()]);
  const wd = (off[String(clubId)] ?? []).map(fromHex);
  const lg = logo ?? [];
  if (!wd.length) return [lg[0] ?? fallback[0], lg[1] ?? fallback[1], lg.length > 0];
  // (fallback er tilfældige farver fra datasættet – applyTheme maler dem aldrig)
  const isWhite = (c: RGB) => hsl(c)[2] >= 0.9;
  const isBlack = (c: RGB) => hsl(c)[2] <= 0.12;
  // logoets nuance, hvis det har en farve i samme tone – ellers en dæmpet udgave af den rene farve
  const refine = (c: RGB): RGB => {
    const m = lg.find((x) => hueDist(x, c) < 35 && hsl(x)[1] >= 0.3);
    if (m) return m;
    const [h, sat, l] = hsl(c);
    return sat > 0.9 && Math.abs(l - 0.5) < 0.06 ? rgbFromHsl(h, 0.78, 0.44) : c;
  };
  const rank = (c: RGB) => { const i = lg.findIndex((x) => hueDist(x, c) < 35); return i < 0 ? 99 : i; };
  const black = wd.find(isBlack), white = wd.find(isWhite);
  // sort/hvid-klubber (fx Juventus): en farve, der ikke er i logoet, er typisk en gammel trøje – spring den over
  const colours = wd.filter((c) => !isWhite(c) && !isBlack(c) && !(lg.length && black && white && rank(c) === 99)).sort((x, y) => rank(x) - rank(y)).map(refine);
  const a = colours[0] ?? (black ? [24, 24, 28] as RGB : lg[0] ?? fallback[0]);
  const b = colours[1] ?? (white ? WHITE : black && colours.length ? [24, 24, 28] as RGB : lg.find((x) => hueDist(x, a) >= 35) ?? fallback[1]);
  return [a, b, lg.length > 0];
}

/** Gør en farve læsbar på mørk baggrund (lys nok, ikke for grå) */
function forDark(c: RGB, minL = 0.58): RGB {
  const [h, s, l] = hsl(c);
  return rgbFromHsl(h, Math.max(s, 0.55), Math.max(l, minL));
}


/** Er farven så lys/grå, at den ikke duer som accent (fx hvid)? */
const washed = (c: RGB) => { const [, s, l] = hsl(c); return l > 0.85 || s < 0.15; };

const css = (c: RGB) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
const rgba = (c: RGB, a: number) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;

/** WCAG: relativ luminans og kontrast mellem to farver */
function relLum([r, g, b]: RGB): number {
  const f = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a: RGB, b: RGB): number {
  const [x, y] = [relLum(a), relLum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
const WHITE: RGB = [255, 255, 255];
const INK: RGB = [17, 22, 36];
/** Tekstfarve med skarpest kontrast mod en baggrund */
// hvid tekst ser bedst ud på farvede flader – mørk tekst kun på rigtig lyse farver (fx gul eller hvid)
const textOn = (bg: RGB): RGB => (contrast(bg, WHITE) >= 2.6 ? WHITE : INK);
/** Gør en farve mørkere (samme nuance), indtil den har kontrast nok mod hvid */
function onWhite(c: RGB, min: number): RGB {
  let [h, s, l] = hsl(c);
  let out = c;
  while (contrast(out, WHITE) < min && l > 0.05) { l -= 0.03; out = rgbFromHsl(h, s, l); }
  return out;
}
const lum = ([r, g, b]: RGB) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

let applied = 0;
/** I online-lobbyen (før man er kommet med i spillet) gælder ens egen valgte klub – ikke værtens */
let themeClub: number | undefined;
export function setThemeClub(id: number | undefined) {
  if (id === themeClub) return;
  themeClub = id;
  applyTheme();
}
const retries = new Map<number, number>();
/** Draft-skærmen er designet mørk – også når sæsonens spil er indlæst bagved */
let holdDark = false;
export function holdDarkTheme(on: boolean) {
  if (holdDark === on) return;
  holdDark = on;
  applyTheme();
}

export function applyTheme() {
  const root = document.documentElement;
  const theme = getTheme();
  const token = ++applied;
  if (holdDark) {
    root.dataset.theme = 'dark';
    delete root.dataset.club;
    delete root.dataset.skin;
    for (const v of VARS) root.style.removeProperty(v);
    return;
  }
  // forsiden og startmenuen er designet mørke – temaet gælder inde i spillet
  const dark = theme === 'dark' || theme === 'clubDark' || theme === 'gold' || theme === 'retro' || !hasGame();
  root.dataset.theme = dark ? 'dark' : 'light';
  delete root.dataset.club;
  delete root.dataset.skin;
  for (const v of VARS) root.style.removeProperty(v);
  // supportertemaer: guld og retro-CM
  if ((theme === 'gold' || theme === 'retro') && hasGame()) { root.dataset.skin = theme; return; }
  if ((theme !== 'club' && theme !== 'clubDark') || !hasGame()) return;
  const club = gs().clubs[themeClub ?? gs().userClub];
  if (!club) return;
  const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const palKey = `cm-pal-${club.id}`;
  const paint = ([a0, b0]: [RGB, RGB | undefined]) => {
    // en hvid/grå farve i logoet duer ikke som hovedfarve – brug den anden
    const [a, b] = washed(a0) && b0 && !washed(b0) ? [b0, a0] : [a0, b0];
    const second = b && !washed(b) ? b : undefined;
    if (dark) {
      const accent = forDark(a);
      root.style.setProperty('--accent', css(accent));
      root.style.setProperty('--accent-ink', lum(accent) > 0.55 ? '#141008' : '#ffffff');
      root.style.setProperty('--accent2', css(forDark(second ?? a, 0.66)));
    } else {
      root.dataset.club = '1';
      // lyst klubtema: menuen i den ene klubfarve, topbjælken i den anden (hvid, hvis klubben er fx rød/hvid)
      // meget mættede logofarver (fx ren gul) dæmpes en anelse på store flader
      const soften = (c: RGB): RGB => { const [h, sat, l] = hsl(c); return sat > 0.9 && l > 0.35 && l < 0.65 ? rgbFromHsl(h, 0.82, l) : c; };
      const navBg = soften(a);
      const topBg: RGB = b ? soften(b) : WHITE;
      const navFg = textOn(navBg), topFg = textOn(topBg);
      root.style.setProperty('--nav-bg', css(navBg));
      root.style.setProperty('--nav-fg', css(navFg));
      root.style.setProperty('--nav-muted', rgba(navFg, 0.72));
      root.style.setProperty('--nav-hover', rgba(navFg, 0.1));
      root.style.setProperty('--nav-active', rgba(navFg, 0.18));
      root.style.setProperty('--top-bg', css(topBg));
      root.style.setProperty('--top-fg', css(topFg));
      root.style.setProperty('--top-muted', rgba(topFg, 0.72));
      root.style.setProperty('--top-chip', rgba(topFg, 0.1));
      // knapper og fremhævninger på den hvide flade: den klubfarve med bedst kontrast mod hvid
      const pick = second && contrast(second, WHITE) > contrast(a, WHITE) ? second : a;
      const accent = onWhite(pick, 3);
      root.style.setProperty('--accent', css(accent));
      root.style.setProperty('--accent-ink', css(textOn(accent)));
      root.style.setProperty('--accent2', css(onWhite(pick, 4.5)));
    }
    const ta = dark ? 0.22 : 0.10, tb = dark ? 0.14 : 0.06;
    root.style.setProperty('--tint1', `rgba(${a[0]}, ${a[1]}, ${a[2]}, ${ta})`);
    root.style.setProperty('--tint2', `rgba(${(second ?? a)[0]}, ${(second ?? a)[1]}, ${(second ?? a)[2]}, ${tb})`);
  };
  // sidst kendte farver med det samme (ingen blink), derefter de friske
  try { const saved = JSON.parse(localStorage.getItem(palKey) ?? 'null') as [RGB, RGB | null] | null; if (saved) paint([saved[0], saved[1] ?? undefined]); } catch { /* ignorér */ }
  let hadSaved = false;
  try { hadSaved = !!localStorage.getItem(palKey); } catch { /* ignorér */ }
  // draft-liga: klubbens egne farver (der er intet logo at aflæse)
  // draft-liga: spillets eget mærkeblå tema (blå menu, hvid topbjælke) – ikke klubbens farver
  if (gs().draft || club.crest !== undefined) { paint([hex('#1f3a9e'), undefined]); return; }
  void Promise.all([clubPalette(club.id, club.colors.map(hex)), officialColors()]).then(([[a, b, fromLogo], off]) => {
    if (token !== applied) return;
    // uden logo er beregningen usikker – behold de gemte farver, hvis vi har nogen
    if (!fromLogo && hadSaved) return;
    // hverken logo eller officielle farver (fx logoet er ikke hentet endnu): mal ikke datasættets tilfældige farver – prøv igen lidt senere
    if (!fromLogo && !off[String(club.id)]?.length) {
      const n = retries.get(club.id) ?? 0;
      if (n < 4) { retries.set(club.id, n + 1); setTimeout(() => { if (token === applied) applyTheme(); }, 1500 * (n + 1)); }
      return;
    }
    paint([a, b]);
    if (fromLogo) { try { localStorage.setItem(palKey, JSON.stringify([a, b ?? null])); } catch { /* ignorér */ } }
  });
}
