// End-to-end røgtest i en rigtig browser (Playwright).
// Kør: npm run dev  (i en anden terminal)  og derefter: node scripts/smoke.mjs [url] [screenshot-mappe]
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5184/en';
const shots = process.argv[3] ?? 'smoke-shots';
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const shot = async (name) => page.screenshot({ path: `${shots}/${name}.png` });
const step = async (name, fn) => {
  const t0 = Date.now();
  await fn();
  console.log(`✓ ${name} (${Date.now() - t0} ms)`);
};

await step('startskærm', async () => {
  await page.goto(url);
  await page.locator('.lp-hero .lp-cta').click({ timeout: 5000 }).catch(() => {});
  await page.getByRole('button', { name: 'Dansk' }).click();
  await shot('01-start');
});
await step('nyt spil', async () => {
  await page.getByRole('button', { name: 'Nyt spil' }).click();
  await page.getByPlaceholder('Dit navn').fill('Smoke Tester');
  await page.locator('.sel, select').first().waitFor();
  await page.getByText('FC København', { exact: true }).click();
  await shot('02-newgame');
  await page.getByRole('button', { name: 'Start karrieren' }).click();
  await page.getByText('Indbakke').first().waitFor({ timeout: 30000 });
  await shot('03-inbox');
});
for (const [nav, file] of [['Trup', '04-squad'], ['Taktik', '05-tactics'], ['Træning', '06-training'], ['Turneringer', '07-comps'], ['Transfers', '08-transfers'], ['Scouting', '09-scouting'], ['Staff', '10-staff'], ['Økonomi', '11-finance'], ['Klub', '12-club'], ['Assistent', '13-assistant']]) {
  await step(`skærm: ${nav}`, async () => {
    await page.locator('.sidenav').getByRole('button', { name: nav, exact: true }).click();
    await page.waitForTimeout(250);
    await shot(file);
  });
}
await step('spillerprofil', async () => {
  await page.locator('.sidenav').getByRole('button', { name: 'Trup', exact: true }).click();
  await page.locator('table.grid tbody tr').first().click();
  await page.waitForTimeout(200);
  await shot('14-player');
});
await step('frem til første kamp', async () => {
  for (let i = 0; i < 80; i++) {
    const btn = page.locator('.topbar .continue');
    const label = await btn.textContent();
    if (label?.includes('Til kampen')) break;
    await btn.click();
    if (await page.getByRole('button', { name: /Kick-off/ }).count()) break;
  }
  await page.locator('.topbar .continue').click();
  await page.getByRole('button', { name: /Kick-off/ }).waitFor({ timeout: 15000 });
  await shot('15-prematch');
});
await step('live kamp', async () => {
  await page.getByRole('button', { name: /Kick-off/ }).click();
  await page.waitForTimeout(2500);
  await shot('16-live');
  await page.getByRole('button', { name: '8×' }).click();
  await page.getByRole('button', { name: 'Statistik' }).click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Spring til slut' }).click();
  await page.getByRole('button', { name: 'Fortsæt ›' }).click();
  await page.getByText('Kamprapport').waitFor();
  await shot('17-report');
});
await step('benchmark (web worker)', async () => {
  await page.locator('.sidenav').getByRole('button', { name: 'Assistent', exact: true }).click();
  await page.getByRole('button', { name: 'Taktik-benchmark' }).click();
  await page.getByRole('button', { name: /Kør benchmark/ }).click();
  await page.getByText('4-2-4', { exact: true }).waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  await shot('18-benchmark');
});
await step('næste kamp + simulér', async () => {
  // spillet stopper ved vigtige nyheder (fx bud på spillere) – tryk igen indtil kampen er klar
  for (let i = 0; i < 6; i++) {
    await page.getByRole('button', { name: 'Næste kamp »' }).click();
    if (await page.getByRole('button', { name: 'Simulér resultat' }).waitFor({ timeout: 20000 }).then(() => true, () => false)) break;
  }
  await page.getByRole('button', { name: 'Simulér resultat' }).click();
  await page.getByText('Kamprapport').waitFor();
});
await step('spol 60 dage frem', async () => {
  await page.evaluate(() => window.__cm.advance(60));
  await page.locator('.sidenav').getByRole('button', { name: 'Turneringer', exact: true }).click();
  await shot('19-after-holiday');
});
await step('gem spil', async () => {
  await page.locator('.sidenav').getByRole('button', { name: 'Gem spil' }).click();
  await page.getByText('Spillet er gemt').waitFor({ timeout: 20000 });
});
await step('afslut og indlæs', async () => {
  page.once('dialog', (d) => d.accept());
  await page.locator('.sidenav').getByRole('button', { name: 'Afslut' }).click();
  await page.getByRole('button', { name: 'Indlæs spil' }).click();
  await page.getByText('Smoke Tester').first().click();
  await page.getByText('Indbakke').first().waitFor({ timeout: 30000 });
  await shot('20-loaded');
});
await step('mobil-visning', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await shot('21-mobile');
});

await browser.close();
if (errors.length) {
  console.log(`\n${errors.length} fejl:\n` + [...new Set(errors)].slice(0, 20).join('\n'));
  process.exit(1);
}
console.log('\nIngen fejl i konsollen ✔');
