// Renders the README screenshots (docs/*.png) and the link preview (og.png):  npm run screenshots
// It plays the built site (run `npm run build:site` first) in a league with a fixed seed,
// so the same pictures come out every time.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const SEED = 'junk-drawer'; // the league; change it until the pictures look good
const CLUB = 9; // which club on the list to run
const browser = await pw.chromium.launch();
await mkdir(join(root, 'docs'), { recursive: true });

/** A new league with the fixed seed, played into late May, in one browser context (the save lives there). */
async function league(viewport, deviceScaleFactor) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor, hasTouch: true, serviceWorkers: 'block', colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.goto(base);
  await page.waitForSelector('.club-pick');
  await page.fill('#seed', SEED);
  await page.locator('button', { hasText: 'Generate' }).click();
  await page.waitForFunction(() => document.querySelector('.club-pick'));
  await page.waitForTimeout(800);
  await page.evaluate(() => document.fonts.ready);
  return page;
}
const idle = (page) => page.waitForSelector('.board .progress', { state: 'detached', timeout: 300000 });
async function start(page) {
  await page.locator('.club-pick').nth(CLUB).click();
  await page.locator('.setup .check input').first().uncheck();
  await page.click('.start-bar .btn.primary');
  await page.waitForSelector('.club-hero', { timeout: 60000 });
  // Sim to late May; stops (trade offers, the staff) may pause it on the way.
  for (let i = 0; i < 12; i++) {
    const date = await page.textContent('.board-cells');
    if (/May (2[0-9]|3[01])|Jun/.test(date)) break;
    await page.locator('.board .btn', { hasText: 'Week' }).click();
    await idle(page);
  }
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('.stop-note button')) b.click();
  });
}
/** The club's best prospect by Future Value: his page shows grades now and where the scouts think they'll go. */
async function bestProspect(page) {
  const team = await page.evaluate(() => document.querySelector("a[href^='#team-']")?.getAttribute('href'));
  await page.goto(base + team + '-farm');
  await page.waitForSelector('.tbl tbody tr');
  return page.evaluate(() => {
    let best = null;
    for (const table of document.querySelectorAll('.tbl')) {
      const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.replace(/[▲▼\s]/g, ''));
      const fv = heads.indexOf('FV');
      if (fv < 0) continue;
      for (const row of table.querySelectorAll('tbody tr')) {
        const grade = Number(row.children[fv]?.textContent);
        const link = row.querySelector('td.name a');
        if (link && (!best || grade > best.grade)) best = { grade, href: link.getAttribute('href') };
      }
    }
    return best.href;
  });
}

// Phone screenshots for the README.
{
  const page = await league({ width: 390, height: 844 }, 2);
  await page.screenshot({ path: join(root, 'docs/phone-new-league.png') });
  await start(page);
  await page.goto(base + '#home');
  await page.waitForSelector('.club-hero');
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(root, 'docs/phone-front-office.png') });
  const player = await bestProspect(page);
  await page.goto(base + player);
  await page.waitForSelector('.player-head h1');
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(root, 'docs/phone-player.png') });
  await page.context().close();
}

// Link preview, 1200 x 630: the name and a line on the left, a real player page on the right.
{
  const page = await league({ width: 1180, height: 900 }, 2);
  await start(page);
  const player = await bestProspect(page);
  await page.goto(base + player);
  await page.waitForSelector('.player-head h1');
  await page.waitForTimeout(600);
  // The page from the top, right of the menu: the scoreboard, the player and his scouting report.
  const left = await page.evaluate(() => Math.round(document.querySelector('main')?.getBoundingClientRect().left ?? 0));
  const shot = await page.screenshot({ clip: { x: left + 18, y: 0, width: 1180 - left - 18, height: 900 } });
  await page.context().close();

  const font = async (f) => (await readFile(join(root, 'web/src/ui/fonts', f))).toString('base64');
  const card = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await card.setContent(`<!doctype html><html><head><style>
    @font-face { font-family: "Barlow Condensed"; font-weight: 700; src: url(data:font/woff2;base64,${await font('barlow-condensed-700.woff2')}) format("woff2"); }
    @font-face { font-family: "Source Sans 3"; font-weight: 400 700; src: url(data:font/woff2;base64,${await font('source-sans-3.woff2')}) format("woff2"); }
    @font-face { font-family: "IBM Plex Mono"; font-weight: 600; src: url(data:font/woff2;base64,${await font('ibm-plex-mono-600.woff2')}) format("woff2"); }
    html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
    body { background: #16372b; color: #eef6f1; font-family: "Source Sans 3", sans-serif; position: relative; }
    .words { position: absolute; left: 72px; top: 0; bottom: 0; width: 470px; display: flex; flex-direction: column; justify-content: center; gap: 22px; }
    .scale { align-self: flex-start; font-family: "IBM Plex Mono", monospace; font-weight: 600; font-size: 26px; background: #f4d35e; color: #16372b; padding: 4px 12px; border-radius: 6px; }
    h1 { margin: 0; font-family: "Barlow Condensed", sans-serif; font-weight: 700; font-size: 116px; line-height: 0.9; letter-spacing: -0.01em; text-transform: uppercase; }
    p { margin: 0; font-size: 31px; line-height: 1.3; color: #cfe2d7; max-width: 440px; }
    .shot { position: absolute; left: 590px; top: 52px; width: 700px; height: 600px; border-radius: 16px 0 0 0; overflow: hidden;
            box-shadow: 0 18px 50px rgba(0,0,0,.45); background: #f4f7f4; }
    .shot img { width: 700px; display: block; }
    .stripe { position: absolute; left: 0; right: 0; bottom: 0; height: 10px; background: #b8322a; }
  </style></head><body>
    <div class="words"><span class="scale">20–80</span><h1>Twenty-<br>Eighty</h1><p>Run a ball club on the scouts’ <span style="white-space: nowrap">20–80 scale.</span></p></div>
    <div class="shot"><img src="data:image/png;base64,${shot.toString('base64')}"></div>
    <div class="stripe"></div>
  </body></html>`);
  await card.evaluate(() => document.fonts.ready);
  await card.waitForTimeout(300);
  await card.screenshot({ path: join(root, 'og.png') });
  await card.close();
}

await browser.close();
server.close();
console.log('screenshots written');
