import { gs, hasGame } from '../game/state';
// Spillernes virkelige karriere før spilstart (public/data/careers.json) – hentes først når en
// spillerprofil åbnes og caches i hukommelsen.
export interface RealSeason { season: number; club: number; clubName?: string; apps: number; goals: number; assists: number; minutes: number }

interface CareersFile { first: number; clubs: Record<string, string>; players: Record<string, number[]>; moves?: Record<string, number[]> }

/** Klubskifte før spilstart (fee = -1: ukendt beløb) */
export interface RealMove { season: number; from: number; to: number; fromName?: string; toName?: string; fee: number }

let file: Promise<CareersFile | null> | null = null;

function load(): Promise<CareersFile | null> {
  if (!file) {
    file = fetch(`${import.meta.env.BASE_URL}data/careers.json`)
      .then((r) => (r.ok ? (r.json() as Promise<CareersFile>) : null))
      .catch(() => { file = null; return null; });
  }
  return file;
}

export async function realCareer(pid: number): Promise<RealSeason[]> {
  // karrierefilen hører til den moderne database
  if (hasGame() && gs().dbKind === 'cm0102') return [];
  const f = await load();
  const flat = f?.players[String(pid)];
  if (!f || !flat) return [];
  const out: RealSeason[] = [];
  for (let i = 0; i + 5 < flat.length; i += 6) {
    const club = flat[i + 1];
    out.push({ season: f.first + flat[i], club, clubName: f.clubs[String(club)], apps: flat[i + 2], goals: flat[i + 3], assists: flat[i + 4], minutes: flat[i + 5] });
  }
  return out;
}

export async function realMoves(pid: number): Promise<RealMove[]> {
  if (hasGame() && gs().dbKind === 'cm0102') return [];
  const f = await load();
  const flat = f?.moves?.[String(pid)];
  if (!f || !flat) return [];
  const out: RealMove[] = [];
  for (let i = 0; i + 3 < flat.length; i += 4) {
    const fee = flat[i + 3];
    out.push({ season: f.first + flat[i], from: flat[i + 1], to: flat[i + 2], fromName: f.clubs[String(flat[i + 1])], toName: f.clubs[String(flat[i + 2])], fee: fee < 0 ? -1 : fee * 1000 });
  }
  return out;
}
