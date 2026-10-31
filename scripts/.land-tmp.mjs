import { chromium } from 'playwright';
const out = process.argv[2];
const browser = await chromium.launch();
for (const [w, h, name] of [[1440, 900, 'desk'], [390, 844, 'mob']]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('http://localhost:5173/cm0102-reborn/');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/land-${name}-hero.png` });
  // scroll gennem siden, så alle reveal-elementer aktiveres
  const H = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < H; y += 500) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(120); }
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/land-${name}-full.png`, fullPage: true });
  console.log(name, 'højde', H, 'fejl', errs);
  await ctx.close();
}
await browser.close();
