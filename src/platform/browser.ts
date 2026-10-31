import { del, get, keys, set } from 'idb-keyval';
import type { PlatformServices } from '../game/ports';
import type { SnapshotBinary } from '../game/snapshot';

async function snapshotBytes(binary: SnapshotBinary): Promise<Uint8Array> {
  return binary instanceof Uint8Array ? binary : new Uint8Array(await binary.arrayBuffer());
}

function snapshotBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

const browserSnapshots = {
  async encode(json: string): Promise<Uint8Array> {
    const bytes = new TextEncoder().encode(json);
    if (typeof CompressionStream === 'undefined' || typeof DecompressionStream === 'undefined') return bytes;
    const stream = new Blob([snapshotBuffer(bytes)]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  },
  async decode(binary: SnapshotBinary): Promise<string> {
    const bytes = await snapshotBytes(binary);
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return new TextDecoder().decode(bytes);
    if (typeof DecompressionStream === 'undefined') throw new Error('This platform cannot read gzip-compressed saves');
    const stream = new Blob([snapshotBuffer(bytes)]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  },
};

export const browserPlatform: PlatformServices = {
  saves: {
    get: <T>(key: string) => get<T>(key),
    set: <T>(key: string, value: T) => set(key, value),
    delete: (key) => del(key),
    keys,
  },
  preferences: {
    get: (key) => { try { return localStorage.getItem(key); } catch { return null; } },
    set: (key, value) => { try { localStorage.setItem(key, value); } catch { /* storage can be unavailable */ } },
    delete: (key) => { try { localStorage.removeItem(key); } catch { /* storage can be unavailable */ } },
  },
  files: {
    download: (bytes, filename) => {
      const blob = new Blob([snapshotBuffer(bytes)]);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    },
  },
  snapshots: browserSnapshots,
};
