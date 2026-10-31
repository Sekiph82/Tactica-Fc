import { del, get, set } from 'idb-keyval';
import type { WorldData } from '../game/newgame';
import { CM_REQUIRED, type CMWorld } from '../game/data/cm0102';

let cache: Promise<WorldData> | null = null;

export function loadWorld(): Promise<WorldData> {
  if (!cache) {
    cache = fetch(`${import.meta.env.BASE_URL}data/world.json`).then((r) => {
      if (!r.ok) throw new Error(`world.json: ${r.status}`);
      return r.json() as Promise<WorldData>;
    });
    cache.catch(() => { cache = null; });
  }
  return cache;
}

// ---------- CM 01/02-databasen (brugerens egen installation, gemt lokalt i browseren) ----------

const CM_KEY = 'cm0102-world';
let cmCache: CMWorld | null | undefined;

export async function loadCMWorld(): Promise<CMWorld | null> {
  if (cmCache !== undefined) return cmCache;
  try { cmCache = ((await get(CM_KEY)) as CMWorld | undefined) ?? null; } catch { cmCache = null; }
  return cmCache;
}

/** Læs Data-mappen fra en CM 01/02-installation og konverter den lokalt (intet sendes nogen steder hen) */
export async function importCMFiles(list: FileList | File[]): Promise<CMWorld> {
  const files: Record<string, ArrayBuffer> = {};
  const wanted = new Set([...CM_REQUIRED, 'colour.dat', 'stadium.dat']);
  for (const f of Array.from(list)) {
    const name = f.name.toLowerCase();
    if (wanted.has(name) && !files[name]) files[name] = await f.arrayBuffer();
  }
  const { parseCM0102 } = await import('../game/data/cm0102');
  const world = parseCM0102(files);
  try { await set(CM_KEY, world); } catch { /* kun i hukommelsen, hvis browseren ikke vil gemme */ }
  cmCache = world;
  return world;
}

export async function forgetCMWorld() {
  cmCache = null;
  try { await del(CM_KEY); } catch { /* ignorer */ }
}
