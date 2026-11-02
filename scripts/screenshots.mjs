// Laver screenshots til forsiden (public/landing/*.webp) fra en rigtig spilsession.
// Kør: npm run dev (i en anden terminal) og derefter: node scripts/screenshots.mjs [url]
// Klublogoerne vises (og klubtemaet farves efter dem), som i spillet.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5184/en';
const out = 'public/landing';
const tmp = '/tmp/cm-shots';
mkdirSync(out, { recursive: true });
mkdirSync(tmp, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
const page = await ctx.newPage();
const shots = [];
const shot = async (name, opts = {}) => {
  await page.waitForTimeout(900);
  const png = `${tmp}/${name}.png`;
  await page.screenshot({ path: png, ...opts });
  const webp = `${out}/${name}.webp`;
  execFileSync('cwebp', ['-quiet', '-q', '80', '-resize', opts.mobile ? '585' : '1600', '0', png, '-o', webp]);
  shots.push(webp);
};
// menupunkter i lukkede grupper: fold den rigtige gruppe ud først (som en manager ville gøre)
const GROUP_OF = { Competitions: 'Matches', Fixtures: 'Matches', Transfers: 'Transfer market', Scouting: 'Transfer market', Club: 'Club', Board: 'Club', Finances: 'Club', Staff: 'Club', Rankings: 'Manager', Awards: 'Manager', History: 'Manager' };
const nav = async (name) => {
  const btn = page.locator('.sidenav').getByRole('button', { name: new RegExp(`^${name}`) });
  if (!(await btn.count()) && GROUP_OF[name]) await page.locator('.sidenav .nav-head', { hasText: GROUP_OF[name] }).first().click();
  await btn.first().click();
};

await page.goto(url);
  await page.locator('.lp-hero .lp-cta').click({ timeout: 5000 }).catch(() => {});
await page.getByRole('button', { name: 'EN', exact: true }).click().catch(() => {});
await page.getByRole('button', { name: /New game/ }).click();
await page.getByPlaceholder('Your name').fill('Alex Morgan');
await page.getByText('Aston Villa', { exact: true }).click();
await page.getByRole('button', { name: 'Start career' }).click();
await page.getByText('Inbox').first().waitFor({ timeout: 30000 });

// spol et stykke ind i sæsonen, så tabeller og statistik er fyldt
await page.evaluate(() => window.__cm.advance(60));
await page.evaluate(() => { const { gs, notify } = window.__cm; for (const n of gs().news) n.read = true; notify(); });

await nav('Tactics');
await shot('tactics');
await nav('Competitions');
await shot('table');
await nav('Squad');
await page.locator('table.grid tbody tr').nth(1).click();
await shot('player');
await nav('Club');
await shot('club');
await nav('Rankings');
await shot('ranking');

// frem til næste kamp og se den live
for (let i = 0; i < 80; i++) {
  if (await page.getByRole('button', { name: /Kick off/ }).count()) break;
  const go = page.getByRole('button', { name: /To the match|Go to match/ }).first();
  if (await go.isVisible().catch(() => false)) { await go.click(); await page.waitForTimeout(600); continue; }
  await page.getByRole('button', { name: /Next match/ }).first().click().catch(() => {});
  await page.waitForTimeout(600);
}
await page.getByRole('button', { name: /Kick off/ }).waitFor({ timeout: 15000 });
await page.getByRole('button', { name: /Kick off/ }).click();
await page.getByRole('button', { name: '4×' }).click().catch(() => {});
await page.waitForTimeout(3200);
await shot('match');
await page.getByRole('button', { name: 'Statistics' }).click();
await shot('match-stats');
const skip = page.getByRole('button', { name: 'Skip to end' });
if (await skip.isVisible().catch(() => false)) await skip.click();
await page.getByRole('button', { name: 'Continue ›' }).click();
await page.getByText('Match report').first().waitFor();
await shot('report');

// pressemøde (efter kampen hvis inviteret, ellers et nyt)
const hasPress = await page.evaluate(() => !!window.__cm.gs().press);
if (hasPress) {
  await nav('Inbox');
  const item = page.getByText(/Press conference|The press/).first();
  if (await item.isVisible().catch(() => false)) {
    await item.click();
    await page.getByRole('button', { name: 'Open' }).first().click();
    await page.locator('.panel button').first().click();
    await shot('press');
  }
}

// mobil
await page.setViewportSize({ width: 390, height: 844 });
await nav('Inbox').catch(() => {});
await shot('mobile', { mobile: true });

await browser.close();
rmSync(tmp, { recursive: true, force: true });
console.log(shots.join('\n'));
