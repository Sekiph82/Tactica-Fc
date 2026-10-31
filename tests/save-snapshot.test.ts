import { describe, expect, it } from 'vitest';
import type { GameState } from '../src/game/types';
import { browserPlatform } from '../src/platform/browser';
import {
  deserializeSaveState,
  SAVE_FORMAT,
  SAVE_SCHEMA_VERSION,
  serializeSaveState,
  serializeState,
  UnsupportedSaveVersionError,
} from '../src/game/snapshot';

function sampleState(): GameState {
  return { id: 'save-test', players: { 7: { id: 7 } }, clubs: { 3: { id: 3 } }, rng: 17 } as unknown as GameState;
}

describe('versioned career save snapshots', () => {
  it('writes the TACTICA envelope and round-trips the state', async () => {
    const state = sampleState();
    const json = serializeSaveState(state);
    const snapshot = await browserPlatform.snapshots.encode(json);
    const envelope = JSON.parse(await browserPlatform.snapshots.decode(snapshot));

    expect(envelope).toMatchObject({ format: SAVE_FORMAT, schemaVersion: SAVE_SCHEMA_VERSION });
    expect(deserializeSaveState(await browserPlatform.snapshots.decode(snapshot))).toMatchObject({ id: state.id, players: state.players, clubs: state.clubs });
  });

  it('continues to read the previous unwrapped gzip save format', async () => {
    const legacy = await browserPlatform.snapshots.encode(serializeState(sampleState()));
    expect(deserializeSaveState(await browserPlatform.snapshots.decode(legacy))).toMatchObject({ id: 'save-test', players: { 7: { id: 7 } }, clubs: { 3: { id: 3 } } });
  });

  it('rejects a save created by a newer schema without returning partial state', async () => {
    const future = await browserPlatform.snapshots.encode(JSON.stringify({
      format: SAVE_FORMAT,
      schemaVersion: SAVE_SCHEMA_VERSION + 1,
      state: sampleState(),
    }));
    const futureJson = await browserPlatform.snapshots.decode(future);
    expect(() => deserializeSaveState(futureJson)).toThrow(UnsupportedSaveVersionError);
  });

  it('rejects malformed envelopes and non-career JSON', async () => {
    const malformedEnvelope = await browserPlatform.snapshots.encode(JSON.stringify({ format: SAVE_FORMAT, schemaVersion: 1 }));
    const unrelatedJson = await browserPlatform.snapshots.encode(JSON.stringify({ hello: 'world' }));
    const malformedJson = await browserPlatform.snapshots.decode(malformedEnvelope);
    const unrelatedText = await browserPlatform.snapshots.decode(unrelatedJson);
    expect(() => deserializeSaveState(malformedJson)).toThrow('Invalid career save envelope');
    expect(() => deserializeSaveState(unrelatedText)).toThrow('Invalid career save');
  });
});
