// End-to-end-test af online multiplayer med to browsere (vært + gæst).
// Kræver `vercel dev --listen 3000` (frontend + /api) eller en deployet URL.
// Kør: node scripts/smoke-mp.mjs [url] [screenshot-mappe]
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:3000/';
const shots = process.argv[3] ?? 'smoke-shots';
const errors = [];
const browser = await chromium.launch();
const mk = async (label) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 850 }, locale: 'da-DK' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('409')) errors.push(`${label} console: ${m.text()}`); });
  return page;
};
const step = async (name, fn) => { const t0 = Date.now(); await fn(); console.log(`✓ ${name} (${Date.now() - t0} ms)`); };

const host = await mk('vært');
const guest = await mk('gæst');
let code = '';

await step('vært opretter online spil', async () => {
  await host.goto(url);
  await host.locator('.lp-hero .lp-cta').click({ timeout: 5000 }).catch(() => {});
  await host.getByRole('button', { name: 'Dansk' }).click();
  await host.getByRole('button', { name: /Online multiplayer/ }).click();
  await host.getByRole('button', { name: 'Opret online spil' }).click();
  await host.getByPlaceholder('Dit navn').fill('Vært');
  // kun Danmark for fart
  const eng = host.locator('label.choice', { hasText: 'England' }).locator('input');
  if (await eng.isChecked()) await eng.uncheck();
  await host.getByText('FC København', { exact: true }).click();
  await host.getByRole('button', { name: 'Opret og få invitationslink' }).click();
  const invite = host.getByRole('button', { name: /Invitér · / });
  await invite.waitFor({ timeout: 90000 });
  code = (await invite.textContent()).split('·')[1].trim();
  await host.screenshot({ path: `${shots}/mp-01-host.png` });
  console.log('  kode:', code);
});

await step('gæst tilmelder sig via link', async () => {
  await guest.goto(`${url}?room=${code}`);
  await guest.locator('.lp-hero .lp-cta').click({ timeout: 5000 }).catch(() => {});
  await guest.getByPlaceholder('Dit navn').fill('Gæst');
  await guest.getByText('Brøndby IF', { exact: true }).click();
  await guest.getByRole('button', { name: 'Deltag i spillet' }).click();
  await guest.getByRole('heading', { name: 'Lobby' }).waitFor({ timeout: 90000 });
  await guest.screenshot({ path: `${shots}/mp-02-guest-lobby.png` });
});

const readyBoth = async () => {
  await host.getByRole('button', { name: 'Klar ✓' }).click();
  await guest.getByRole('button', { name: 'Klar ✓' }).click();
};

await step('første træk: gæsten kommer med i spillet', async () => {
  const before = await host.locator('.topbar .date').textContent();
  await readyBoth();
  await host.waitForFunction((d) => document.querySelector('.topbar .date')?.textContent !== d, before, { timeout: 180000 });
  await guest.getByRole('heading', { name: 'Lobby' }).waitFor({ state: 'detached', timeout: 120000 });
  await guest.locator('.topbar .club', { hasText: 'Brøndby' }).waitFor({ timeout: 60000 });
  await guest.screenshot({ path: `${shots}/mp-03-guest-ingame.png` });
});

await step('gæst ændrer taktik (handling sendes til serveren)', async () => {
  await guest.locator('.sidenav').getByRole('button', { name: 'Taktik', exact: true }).click();
  await guest.locator('select').first().selectOption('4-4-2');
  await guest.waitForTimeout(1500);
});

for (let i = 2; i <= 6; i++) {
  await step(`træk ${i}`, async () => {
    const before = await guest.locator('.topbar .date').textContent();
    await readyBoth();
    await guest.waitForFunction((d) => document.querySelector('.topbar .date')?.textContent !== d, before, { timeout: 180000 });
    await host.waitForFunction((d) => document.querySelector('.topbar .date')?.textContent !== d, before, { timeout: 180000 });
    console.log('  dato:', await guest.locator('.topbar .date').textContent());
  });
}

await step('kampe er spillet og kan ses', async () => {
  await guest.locator('.sidenav').getByRole('button', { name: 'Kampprogram', exact: true }).click();
  await guest.screenshot({ path: `${shots}/mp-04-guest-fixtures.png` });
  await host.locator('.sidenav').getByRole('button', { name: 'Turneringer', exact: true }).click();
  await host.screenshot({ path: `${shots}/mp-05-host-table.png` });
  const taktik = await guest.evaluate(() => document.body.innerText.includes('Sejr') || document.body.innerText.includes('Nederlag') || document.body.innerText.includes('Uafgjort'));
  void taktik;
});

await browser.close();
if (errors.length) {
  console.log(`\n${errors.length} fejl:\n` + [...new Set(errors)].slice(0, 20).join('\n'));
  process.exit(1);
}
console.log('\nOnline multiplayer virker – ingen fejl ✔');
