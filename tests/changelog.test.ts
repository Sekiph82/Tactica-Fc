import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_VERSION, CHANGELOG } from '../src/ui/changelogData';

describe('changelog', () => {
  it('nyeste version matcher package.json', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
  });
  it('versioner er sorteret nyeste først og har tekst på begge sprog', () => {
    const num = (v: string) => v.split('.').map(Number).reduce((s, x) => s * 1000 + x, 0);
    for (let i = 1; i < CHANGELOG.length; i++) expect(num(CHANGELOG[i - 1].version)).toBeGreaterThan(num(CHANGELOG[i].version));
    for (const e of CHANGELOG) for (const it2 of [e.title, ...e.items]) { expect(it2.da.length).toBeGreaterThan(0); expect(it2.en.length).toBeGreaterThan(0); }
  });
});
