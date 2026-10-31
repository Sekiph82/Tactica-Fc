import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configurePlatformServices, type PlatformServices, type SaveStorageAdapter } from '../src/game/ports';
import { browserPlatform } from '../src/platform/browser';
import { saveGame, listSaves, scheduleAutosave, flushAutosave, loadGame } from '../src/game/save';
import { gs, setGame } from '../src/game/state';
import { serializeSaveState } from '../src/game/snapshot';
import type { GameState } from '../src/game/types';

class MemorySaveStorage implements SaveStorageAdapter {
  values = new Map<string, unknown>();
  failNextWrite = false;
  writeAttempts = 0;

  async get<T>(key: string) { return this.values.get(key) as T | undefined; }
  async set<T>(key: string, value: T) {
    this.writeAttempts += 1;
    if (this.failNextWrite) { this.failNextWrite = false; throw new Error('simulated interrupted write'); }
    this.values.set(key, value);
  }
  async delete(key: string) { this.values.delete(key); }
  async keys() { return [...this.values.keys()]; }
}

let storage: MemorySaveStorage;

function sampleGame(date = '2025-08-09'): GameState {
  return {
    id: 'save-recovery-test',
    manager: { name: 'QA Manager' },
    userClub: 1,
    clubs: { 1: { name: 'QA FC' } },
    players: {},
    fixtures: {},
    date,
    rng: 17,
    comps: { UECL: {} },
  } as unknown as GameState;
}

beforeEach(() => {
  storage = new MemorySaveStorage();
  const platform: PlatformServices = {
    saves: storage,
    preferences: { get: () => null, set: () => {}, delete: () => {} },
    files: { download: () => {} },
    snapshots: browserPlatform.snapshots,
  };
  configurePlatformServices(platform);
});

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); setGame(null); });

describe('career save storage recovery', () => {
  it('keeps the previously committed record when the replacement write fails', async () => {
    const game = sampleGame();
    setGame(game);
    const first = await saveGame();
    const key = 'record:save-recovery-test';
    const previous = await storage.get<{ meta: { date: string } }>(key);
    expect(first.date).toBe('2025-08-09');
    expect(previous?.meta.date).toBe('2025-08-09');

    game.date = '2025-08-16';
    storage.failNextWrite = true;
    await expect(saveGame()).rejects.toThrow('simulated interrupted write');
    await expect(storage.get<{ meta: { date: string } }>(key)).resolves.toEqual(previous);
    await expect(listSaves()).resolves.toMatchObject([{ id: game.id, date: '2025-08-09' }]);
  });

  it('continues listing legacy metadata when only the prior key layout exists', async () => {
    storage.values.set('meta:legacy-career', {
      id: 'legacy-career', manager: 'Legacy Manager', club: 'Legacy FC', date: '2002-01-01', saved: '2026-10-30T00:00:00.000Z',
    });
    await expect(listSaves()).resolves.toMatchObject([{ id: 'legacy-career', club: 'Legacy FC' }]);
  });

  it('loads new portable-byte records and existing Blob-backed records', async () => {
    const current = sampleGame();
    setGame(current);
    await saveGame();
    const stored = await storage.get<{ snapshot?: Uint8Array }>('record:save-recovery-test');
    expect(stored?.snapshot).toBeInstanceOf(Uint8Array);
    setGame(null);
    await expect(loadGame(current.id)).resolves.toBe(true);
    expect(gs()).toMatchObject({ id: current.id, date: current.date });

    const legacy = sampleGame('2024-08-10');
    const encoded = await browserPlatform.snapshots.encode(serializeSaveState(legacy));
    const buffer = new ArrayBuffer(encoded.byteLength);
    new Uint8Array(buffer).set(encoded);
    storage.values.set('record:save-recovery-test', {
      format: 'tactica-fc-save-record', schemaVersion: 1, blob: new Blob([buffer]),
      meta: { id: legacy.id, manager: legacy.manager.name, club: 'QA FC', date: legacy.date, saved: new Date().toISOString() },
    });
    setGame(null);
    await expect(loadGame(legacy.id)).resolves.toBe(true);
    expect(gs()).toMatchObject({ id: legacy.id, date: legacy.date });
  });

  it('retries a failed autosave with backoff until the platform store accepts it', async () => {
    setGame(sampleGame());
    storage.failNextWrite = true;
    vi.useFakeTimers();
    // Keep this test focused on the retry timer; gzip streaming is covered by the snapshot tests.
    vi.stubGlobal('CompressionStream', undefined);

    scheduleAutosave(60_000);
    await flushAutosave();
    await expect(listSaves()).resolves.toEqual([]);

    const retries = [1_500, 3_000, 6_000, 12_000, 24_000, 48_000, 60_000, 60_000];
    for (let i = 0; i < retries.length; i += 1) {
      const previousAttempts = storage.writeAttempts;
      const delay = retries[i];
      if (i < retries.length - 1) storage.failNextWrite = true;

      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(storage.writeAttempts).toBe(previousAttempts);
      await vi.advanceTimersByTimeAsync(1);
      for (let tick = 0; tick < 12 && storage.writeAttempts === previousAttempts; tick += 1) await Promise.resolve();
      expect(storage.writeAttempts).toBe(previousAttempts + 1);

      if (i < retries.length - 1) await expect(listSaves()).resolves.toEqual([]);
    }
    await expect(listSaves()).resolves.toMatchObject([{ id: 'save-recovery-test', date: '2025-08-09' }]);
  });
});
