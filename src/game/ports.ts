import type { SnapshotCodec } from './snapshot';

/** Capabilities required by shared game services. Concrete adapters live outside src/game. */
export interface SaveStorageAdapter {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<readonly unknown[]>;
}

export interface PreferenceAdapter {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
}

export interface FileExportAdapter {
  download(bytes: Uint8Array, filename: string): void;
}

export interface PlatformServices {
  saves: SaveStorageAdapter;
  preferences: PreferenceAdapter;
  files: FileExportAdapter;
  snapshots: SnapshotCodec;
}

let services: PlatformServices | null = null;

export function configurePlatformServices(value: PlatformServices) {
  services = value;
}

export function platformServices(): PlatformServices {
  if (!services) throw new Error('Platform services have not been configured');
  return services;
}
