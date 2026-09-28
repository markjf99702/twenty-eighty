// Plays the built site in Chromium through the real page:  npm run test:e2e  (needs Playwright)
// It serves the repo root, the copy GitHub Pages publishes, so run `npm run build:site` first.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let body;
  try { body = await readFile(join(root, path === '/' ? 'index.html' : path)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
  res.end(body);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', e => problems.push(e.message));
page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
page.on('requestfailed', r => problems.push('failed: ' + r.url()));
page.on('request', r => { if (!r.url().startsWith(base)) problems.push('left the site: ' + r.url()); });

const fits = async (where) =>
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${where} scrolls sideways on a phone`);
const board = (label) => page.locator('.board .btn', { hasText: label });
const idle = () => page.waitForSelector('.board .progress', { state: 'detached', timeout: 120000 });

await page.goto(base);
await page.evaluate(() => document.fonts.ready);

// The title screen: pick a club and take the job (big-league games only, to keep it quick).
await page.waitForSelector('.club-pick', { timeout: 30000 });
assert.ok(await page.locator('.jd-foot a[href="https://junkdrawer.works/"]').count(), 'no link back to the drawer');
assert.equal(await page.evaluate(() => getComputedStyle(document.body).fontFamily.includes('Source Sans 3') && document.fonts.check('16px "Source Sans 3"')), true, 'the fonts did not load');
await fits('the title screen');
const club = (await page.locator('.club-pick .nm').nth(3).textContent()).trim();
await page.locator('.club-pick').nth(3).click();
await page.locator('.setup .check input').first().uncheck();
await page.click('.start-bar .btn.primary');
await page.waitForSelector('.club-hero', { timeout: 60000 });

// A week of games: scores go up and the standings move.
await board('Week').click();
await idle();
const record = (await page.textContent('.board-cells')).replace(/\s+/g, ' ');
assert.match(record, /\d+[–-]\d+/, 'no record after a week');
await fits('the front office');

// The roster, a player's page and the trade desk.
await page.goto(base + '#standings');
await page.waitForSelector('.tbl tbody tr');
assert.ok((await page.locator('.tbl tbody tr').count()) >= 15, 'the standings are short');
await fits('the standings');
const mine = await page.evaluate(() => document.querySelector("a[href^='#team-']")?.getAttribute('href'));
await page.goto(base + mine);
await page.waitForSelector('.tbl tbody tr');
await fits('the roster');
await page.locator('.tbl td.name a').first().click();
await page.waitForSelector('.player-head h1');
await fits('a player page');
await page.goto(base + '#trades');
await page.waitForSelector('.trade-bar');
await fits('the trade desk');
await page.locator('.desk-switch button', { hasText: 'On the block' }).click();
await page.waitForSelector('.block-about');
assert.equal(await page.evaluate(() => location.hash), '#trades-block', 'the block has its own link');
await fits('the players on the block');
await page.locator('.desk-switch button', { hasText: 'Make a deal' }).click();
await page.waitForSelector('.trade-bar');

// The league saves itself: a reload comes back to the same club.
await page.reload();
const nickname = club.split(' ').at(-1);
const back = await page
  .waitForFunction((name) => document.querySelector('#app')?.textContent.includes(name), nickname, { timeout: 20000 })
  .then(() => true, () => false);
assert.ok(back, 'the saved league did not come back');


// Works offline once it has been opened.
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 }).catch(() => {});
await ctx.setOffline(true);
await page.reload();
await page.waitForSelector('.board', { timeout: 20000 });
assert.ok(await page.title(), 'the page did not load offline');
await ctx.setOffline(false);

assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], 'problems while using it');
await browser.close();
server.close();
console.log('all good');
