// Shared game state serialization stays platform-neutral. Binary compression and
// file/container handling are supplied by the selected platform adapter.
import { stash } from './humans';
import { rng } from './rng';
import type { GameState } from './types';

const round = (_k: string, v: unknown) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v);

/** A portable byte array or a platform file object such as File/Blob for legacy imports. */
export interface SnapshotBinaryFile {
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type SnapshotBinary = Uint8Array | SnapshotBinaryFile;

export interface SnapshotCodec {
  encode(json: string): Promise<Uint8Array>;
  decode(binary: SnapshotBinary): Promise<string>;
}

export const SAVE_FORMAT = 'tactica-fc-save';
export const SAVE_SCHEMA_VERSION = 1;

export class UnsupportedSaveVersionError extends Error {
  constructor(version: number) {
    super(`Save schema ${version} is newer than supported schema ${SAVE_SCHEMA_VERSION}`);
    this.name = 'UnsupportedSaveVersionError';
  }
}

function stringifyState(g: GameState): string {
  g.rng = rng.state;
  stash(g);
  return JSON.stringify(g, round);
}

/** Shared multiplayer serialization preserves the existing unwrapped JSON wire format. */
export function serializeState(g: GameState): string {
  return stringifyState(g);
}

export function deserializeState(json: string): GameState {
  return JSON.parse(json) as GameState;
}

/** Local/exported careers are versioned; online snapshots keep their unwrapped format. */
export function serializeSaveState(g: GameState): string {
  const state = JSON.parse(stringifyState(g)) as GameState;
  return JSON.stringify({ format: SAVE_FORMAT, schemaVersion: SAVE_SCHEMA_VERSION, state });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validateSaveState(value: unknown): GameState {
  if (!isRecord(value) || !isRecord(value.players) || !isRecord(value.clubs)) throw new Error('Invalid career save');
  return value as unknown as GameState;
}

/** Reads the unversioned CM Reborn save format and the versioned TACTICA FC format. */
export function deserializeSaveState(json: string): GameState {
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed) || parsed.format === undefined) return validateSaveState(parsed);
  if (parsed.format !== SAVE_FORMAT || !Number.isInteger(parsed.schemaVersion) || !('state' in parsed)) throw new Error('Invalid career save envelope');

  let version = parsed.schemaVersion as number;
  if (version < 0) throw new Error(`Invalid save schema ${version}`);
  if (version > SAVE_SCHEMA_VERSION) throw new UnsupportedSaveVersionError(version);
  let state: unknown = parsed.state;
  while (version < SAVE_SCHEMA_VERSION) {
    // Version 0 is the prior unwrapped GameState representation. Its domain upgrade
    // (including additive competition repair) runs after loading in save.ts.
    if (version === 0) { state = validateSaveState(state); version = 1; }
    else throw new UnsupportedSaveVersionError(version);
  }
  return validateSaveState(state);
}
