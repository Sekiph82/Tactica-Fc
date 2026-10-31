// Gem/indlæs i IndexedDB som gzip-komprimeret JSON (≈4-5 MB pr. save).
import { addMissingConference } from './competitions';
import { gs, setGame, addNews, notify } from './state';
import { deserializeSaveState, serializeSaveState, type SnapshotBinary } from './snapshot';
import type { GameState } from './types';
import { platformServices } from './ports';

export interface SaveMeta {
  id: string;
  manager: string;
  club: string;
  date: string;
  saved: string;
}

interface SaveRecord {
  format: 'tactica-fc-save-record';
  schemaVersion: 1;
  snapshot?: Uint8Array;
  /** Read-only bridge for records written before snapshots moved to portable bytes. */
  blob?: SnapshotBinary;
  meta: SaveMeta;
}

const RECORD_PREFIX = 'record:';

function recordKey(id: string) { return `${RECORD_PREFIX}${id}`; }

export async function serialize(g: GameState): Promise<Uint8Array> {
  return platformServices().snapshots.encode(serializeSaveState(g));
}

export async function saveGame(): Promise<SaveMeta> {
  const g = gs();
  // online-spil gemmes på serveren – en lokal kopi ville blive genoptaget i stedet for det rigtige spil
  if (g.humans?.length) throw new Error('online');
  const snapshot = await serialize(g);
  const meta: SaveMeta = {
    id: g.id,
    manager: g.manager.name,
    club: g.clubs[g.userClub]?.name ?? '—',
    date: g.date,
    saved: new Date().toISOString(),
  };
  // Store the payload and its index metadata in one IndexedDB value so an
  // interrupted save cannot leave a new payload paired with stale metadata.
  const storage = platformServices().saves;
  await storage.set(recordKey(g.id), { format: 'tactica-fc-save-record', schemaVersion: 1, snapshot, meta } satisfies SaveRecord);
  // Keep cleanup of pre-envelope keys best-effort: the committed record is already valid.
  await Promise.all([storage.delete(`save:${g.id}`), storage.delete(`meta:${g.id}`)]).catch(() => {});
  rememberLast({ kind: 'local', id: g.id });
  return meta;
}

// ---------- seneste spil (så en genindlæsning fortsætter hvor man slap) ----------

export type LastGame = { kind: 'local'; id: string } | { kind: 'online'; code: string };
const LAST_KEY = 'cm0102.last';

export function rememberLast(l: LastGame) {
  platformServices().preferences.set(LAST_KEY, JSON.stringify(l));
}

export function getLast(): LastGame | null {
  try { return JSON.parse(platformServices().preferences.get(LAST_KEY) ?? 'null') as LastGame | null; } catch { return null; }
}

export function forgetLast() {
  platformServices().preferences.delete(LAST_KEY);
}

// ---------- autogem ----------

let timer: ReturnType<typeof setTimeout> | null = null;
let saving = false;
let dirty = false;
let retryDelay = 1500;

/** Gem kort efter ændringer (debounced), så intet går tabt ved genindlæsning */
export function scheduleAutosave(delay = 2500) {
  dirty = true;
  retryDelay = 1500;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { void flushAutosave(); }, delay);
}

export async function flushAutosave() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!dirty || saving) return;
  saving = true;
  dirty = false;
  try {
    await saveGame();
    retryDelay = 1500;
  } catch {
    dirty = true;
    // A transient IndexedDB failure must not leave the last in-memory changes unsaved.
    // Back off while the app remains open; a later edit resets the delay.
    if (!timer) {
      timer = setTimeout(() => { void flushAutosave(); }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 60_000);
    }
  } finally { saving = false; }
}

export async function listSaves(): Promise<SaveMeta[]> {
  const storage = platformServices().saves;
  const all = await storage.keys();
  const recordKeys = all.filter((key): key is string => typeof key === 'string' && key.startsWith(RECORD_PREFIX));
  const records = await Promise.all(recordKeys.map((key) => storage.get<SaveRecord>(key)));
  const metas = records.flatMap((record) => record?.format === 'tactica-fc-save-record' && record.schemaVersion === 1 && record.meta ? [record.meta] : []);
  const recordIds = new Set(metas.map((meta) => meta.id));
  const legacyKeys = all.filter((key): key is string => typeof key === 'string' && key.startsWith('meta:') && !recordIds.has(key.slice('meta:'.length)));
  const legacy = await Promise.all(legacyKeys.map((key) => storage.get<SaveMeta>(key)));
  return [...metas, ...legacy.filter(Boolean) as SaveMeta[]].sort((a, b) => b.saved.localeCompare(a.saved));
}

/** Opgradér gemte spil fra ældre versioner (nye turneringer m.m.) */
function upgradeLoaded() {
  const g = gs();
  if (addMissingConference()) {
    const club = g.clubs[g.userClub];
    if (club && g.comps.UECL?.clubs.includes(club.id)) addNews({ cat: 'general', key: 'news.ueclQualified', params: { club: club.name } });
    notify();
  }
}

export async function loadGame(id: string): Promise<boolean> {
  const storage = platformServices().saves;
  const record = await storage.get<SaveRecord>(recordKey(id));
  const binary = record?.format === 'tactica-fc-save-record' && record.schemaVersion === 1
    ? record.snapshot ?? record.blob
    : undefined;
  const payload = binary ?? await storage.get<SnapshotBinary>(`save:${id}`);
  if (!payload) return false;
  let g: GameState;
  try { g = deserializeSaveState(await platformServices().snapshots.decode(payload)); } catch { return false; }
  // en gammel lokal kopi af et online-spil: åbn ikke den (det rigtige spil ligger på serveren)
  if (g.humans?.length) return false;
  setGame(g);
  upgradeLoaded();
  rememberLast({ kind: 'local', id });
  return true;
}

export async function deleteSave(id: string) {
  const storage = platformServices().saves;
  await Promise.all([storage.delete(recordKey(id)), storage.delete(`save:${id}`), storage.delete(`meta:${id}`)]);
}

export async function exportSave(): Promise<void> {
  const g = gs();
  const snapshot = await serialize(g);
  const club = (g.clubs[g.userClub]?.short ?? 'cm').replace(/[^\w]+/g, '-');
  platformServices().files.download(snapshot, `cm0102-${club}-${g.date}.cm0102`);
}

export async function importSave(file: SnapshotBinary): Promise<boolean> {
  try {
    const json = await platformServices().snapshots.decode(file);
    const g = deserializeSaveState(json);
    if (!g.players || !g.clubs) return false;
    g.id = `save-${Date.now().toString(36)}`;
    setGame(g);
    upgradeLoaded();
    await saveGame();
    return true;
  } catch {
    return false;
  }
}
