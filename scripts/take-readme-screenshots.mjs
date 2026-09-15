// Regenerates the README screenshots in docs/screenshots/ by driving a real
// browser through a sample round. Run with: node scripts/take-readme-screenshots.mjs
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const outDir = path.join(root, 'docs', 'screenshots');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png' };

function startServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const urlPath = req.url.split('?')[0];
      const filePath = path.join(root, urlPath === '/' ? '/index.html' : urlPath);
      if (!filePath.startsWith(root) || !existsSync(filePath) || !statSync(filePath).isFile()) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      createReadStream(filePath).pipe(res);
    });
    server.listen(0, () => resolve(server));
  });
}

const server = await startServer();
const baseUrl = `http://localhost:${server.address().port}`;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 430, height: 860 }, deviceScaleFactor: 2 });
const page = await context.newPage();

async function shot(name) {
  await page.locator('#saveToast.show').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log('saved', name);
}

await page.goto(`${baseUrl}/index.html`);
await page.evaluate(() => localStorage.clear());
await page.reload();

// Dismiss first-run guide if present
const readyBtn = page.locator('button', { hasText: 'Jag är redo' });
if (await readyBtn.count()) await readyBtn.click();

await shot('01-home');

// Pick a preinstalled course
await page.locator('#courseSearchInput').fill('Nybro GK');
await page.locator('.course-group').filter({ hasText: 'Nybro GK' }).locator('.cg-tee-btn').filter({ hasText: 'Gul' }).click();
await page.locator('#step2 button', { hasText: 'Nästa' }).click();

// Two players
await page.locator('#btnP2').click();
await page.locator('#pname_0').fill('Henrik');
await page.locator('#phi_0').fill('14.5');
await page.locator('#pname_1').fill('Anna');
await page.locator('#phi_1').fill('18.2');
await shot('02-players');

await page.locator('#step3 button', { hasText: 'Nästa' }).click();

// Fill some holes then screenshot mid-round
const scoresA = [5,6,4,7,5,4,6,5,4,5,7,4,6,5,3,6,4,5];
const scoresB = [6,7,5,7,6,4,7,6,5,6,8,5,7,6,4,7,5,6];
for (let hole = 0; hole < 6; hole++) {
  await page.locator(`#score_0_${hole}`).fill(String(scoresA[hole]));
  await page.locator(`#score_1_${hole}`).fill(String(scoresB[hole]));
}
await page.locator('#step4').scrollIntoViewIfNeeded();
await shot('03-scoring');

for (let hole = 6; hole < 18; hole++) {
  await page.locator(`#score_0_${hole}`).fill(String(scoresA[hole]));
  await page.locator(`#score_1_${hole}`).fill(String(scoresB[hole]));
}
const filled = await page.evaluate(() =>
  [...document.querySelectorAll('input[id^="score_"]')].filter(i => i.value !== '').length);
if (filled !== 36) throw new Error(`expected 36 filled score inputs, got ${filled}`);
await page.locator('#step4 button', { hasText: 'Beräkna' }).click();
await page.locator('#step5').scrollIntoViewIfNeeded();
await shot('04-results');

// Dark mode showcase (cycle theme via the UI toggle, no reload, so step5 stays visible)
for (let i = 0; i < 3 && (await page.evaluate(() => localStorage.getItem('golf_theme'))) !== 'dark'; i++) {
  await page.locator('#themeToggle').click();
}
await page.locator('#step5').scrollIntoViewIfNeeded();
await shot('05-results-dark');

await browser.close();
server.close();
console.log('done');
