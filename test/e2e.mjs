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
// A new GM is welcomed, and told when free agents and draft picks come, and that the department budgets are set before the first pitch.
const welcome = await page.locator('.note', { hasText: 'Welcome to the job' }).textContent({ timeout: 10000 });
assert.match(welcome, /Free agency, the draft and international signings come in the winter/, 'no welcome for a new GM');
assert.match(welcome, /Before the first pitch you can also set your scouting and analytics budgets/, 'the welcome does not mention the department budgets');
await page.goto(base + '#scouting');
assert.match(await page.locator('.note.warn').textContent({ timeout: 10000 }), /^Before the first game: set this season's scouting and analytics budgets now/, 'the scouting page does not say the budgets lock at the first game');
await page.goto(base + '#home');
await page.waitForSelector('.club-hero', { timeout: 60000 });

// A week of games: scores go up and the standings move.
await board('Week').click();
// The progress line knows the week's length from the start, so Stop is there at once.
const starting = await page.locator('.board .progress').textContent({ timeout: 2000 }).catch(() => null);
if (starting !== null) assert.match(starting, /of 7.*Stop/, `the sim started as "${starting.replace(/\s+/g, ' ')}"`);
await idle();
const record = (await page.textContent('.board-cells')).replace(/\s+/g, ' ');
assert.match(record, /\d+[–-]\d+/, 'no record after a week');
await fits('the front office');
// Once a game is played the budgets wait for the winter, and the scouting page says when they open again.
await page.goto(base + '#scouting');
assert.match(await page.locator('.note').first().textContent({ timeout: 10000 }), /set in the offseason and on Opening Day, before the first game/, 'the scouting page does not say when budgets can change');

// A short page starts right under the section strip (which once stretched into a blank band on phones).
await page.goto(base + '#history');
await page.waitForSelector('main h1');
const shell = await page.evaluate(() => ({ strip: document.querySelector('.rail').getBoundingClientRect().height, heading: document.querySelector('main h1').getBoundingClientRect().top }));
assert.ok(shell.strip < 80 && shell.heading < 500, `League history sits under a blank band (strip ${Math.round(shell.strip)}px tall, heading ${Math.round(shell.heading)}px down)`);
// The strip scrolls sideways on a phone and shows the page you're on.
const here = await page.evaluate(() => { const r = document.querySelector('.rail a.on').getBoundingClientRect(); return { left: r.left, right: r.right }; });
assert.ok(here.left >= 0 && here.right <= 390, `the section strip hides the page you're on (History at ${Math.round(here.left)} to ${Math.round(here.right)}px)`);
await fits('league history');

// The roster, a player's page and the trade desk.
await page.goto(base + '#standings');
await page.waitForSelector('.tbl tbody tr');
assert.ok((await page.locator('.tbl tbody tr').count()) >= 15, 'the standings are short');
await fits('the standings');
// The leaderboards rank by WAR, and on a phone WAR is in view beside the names.
await page.goto(base + '#stats-mlb-hitters');
await page.waitForSelector('main .tbl th.sorted');
const ranked = await page.evaluate(() => {
  const th = document.querySelector('main .tbl th.sorted');
  return { label: th.textContent, right: th.getBoundingClientRect().right, edge: th.closest('.tbl-wrap').getBoundingClientRect().right };
});
assert.ok(ranked.right <= ranked.edge, `the leaderboard is ranked by ${ranked.label}, off the edge of the table on a phone`);
await fits('the stats leaderboard');
const mine = await page.evaluate(() => document.querySelector("a[href^='#team-']")?.getAttribute('href'));
await page.goto(base + mine);
await page.waitForSelector('.tbl tbody tr');
await fits('the roster');
// A new league has no season before this one, so the tables offer this season's stats and not last season's.
const statViews = await page.locator('.seg[aria-label="Show"] button').allTextContents();
assert.deepEqual(statViews.filter((t) => / stats$/.test(t)).length, 1, `the roster offers ${statViews.join(', ')}`);
// A player's roster moves open on screen (the table scrolls sideways to reach them), and designating him asks first.
await page.locator('.tbl tbody tr').first().locator('button', { hasText: 'Moves' }).click();
const moves = await page.locator('tr.expand .actions').boundingBox();
assert.ok(moves && moves.x >= 0 && moves.x + moves.width <= 390, `the roster moves open off screen (${JSON.stringify(moves)})`);
await page.locator('tr.expand button', { hasText: 'Designate for assignment' }).click();
const asked = await page.locator('tr.expand').textContent({ timeout: 5000 }).catch(() => '');
assert.match(asked, /Designate .+ for assignment\?/, 'designating a player did not ask first');
await page.locator('tr.expand button', { hasText: 'Not yet' }).click();
await page.waitForSelector('tr.expand .actions');
await fits('the roster with a player\'s moves open');
// A change to the bullpen makes the pitching staff yours and leaves the lineup to the manager, and one tap hands it back.
await page.goto(base + mine + '-depth');
await page.locator('.depth button[aria-label="Move down"]').first().click();
const handBack = page.locator('.note button', { hasText: 'Let the manager set it' });
await handBack.waitFor({ timeout: 10000 });
assert.match(await page.locator('.note', { has: page.locator('button', { hasText: 'Let the manager set it' }) }).textContent(), /You're setting the pitching staff; the manager sets the lineup\./, 'a bullpen change took over the whole depth chart');
await fits('the depth chart');
await handBack.click();
await page.locator('.note', { hasText: 'The manager is setting the depth chart' }).waitFor({ timeout: 10000 });
await page.goto(base + mine);
await page.waitForSelector('.tbl tbody tr');
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

// The owner's office says when a new GM can be let go (Normal: only below 10 in the first season).
await page.goto(base + '#owner');
await page.waitForSelector('.meter-wrap');
assert.match(await page.textContent('main'), /below 10 in your first season/, 'the owner\'s office misstates when a new GM can be fired');
await fits('the owner\'s office');

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

// A stop is in view when the sim stops, though you scrolled down to read while it ran (on a phone the scoreboard
// scrolls away once the sim is over). Scrolled first, so a stop on the first day finds the page scrolled too.
await page.evaluate(() => localStorage.setItem('twenty-eighty.stops', JSON.stringify({ streak: 2, injury: false, offer: 'off', deadline: false, staff: false, allStar: false, moments: false })));
await page.goto(base + '#home');
await page.reload();
await page.waitForSelector('.club-hero');
await page.evaluate(() => {
  window.scrollTo(0, document.documentElement.scrollHeight);
  [...document.querySelectorAll('.board .btn')].find((b) => b.textContent.trim() === 'Month').click();
});
await page.locator('.board .progress').waitFor({ timeout: 3000 }).catch(() => {});
await idle();
if (await page.locator('.stop-note').count()) {
  const seen = await page
    .waitForFunction(() => { const r = document.querySelector('.stop-note').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }, null, { timeout: 5000 })
    .then(() => true, () => false);
  assert.ok(seen, `the sim stopped ("${await page.locator('.stop-note').textContent()}") with the note out of sight`);
}
await page.evaluate(() => localStorage.removeItem('twenty-eighty.stops'));
await page.reload();
await page.waitForSelector('.board-cells');

// The trade desk once there's something on it: an offer's players by their full names, and the block's Fit and
// Trade for in view (Trade for is under the name, since the table scrolls sideways on a phone).
let offerSeen = false;
let blockSeen = false;
const checkDesk = async () => {
  if (!offerSeen) {
    await page.goto(base + '#trades');
    await page.waitForSelector('.trade-bar');
    if (await page.locator('.trade-offer').count()) {
      const cut = await page.evaluate(() => [...document.querySelectorAll('.offer-player a')].filter((a) => a.scrollWidth > a.clientWidth + 1).map((a) => a.textContent));
      assert.deepEqual(cut, [], 'an offer cuts its players\' names short on a phone');
      await fits('the trade desk with an offer');
      offerSeen = true;
    }
  }
  if (!blockSeen) {
    await page.goto(base + '#trades-block');
    await page.waitForSelector('.block-about');
    if (await page.locator('main .tbl tbody tr').count()) {
      const at = await page.evaluate(() => {
        const box = (el) => { const r = el.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right) }; };
        const wrap = box(document.querySelector('main .tbl-wrap'));
        const fit = box([...document.querySelectorAll('main .tbl th')].find((th) => th.textContent.startsWith('Fit')));
        const button = box(document.querySelector('main .tbl tbody tr button[aria-label^="Trade for"]'));
        return { wrap, fit, button };
      });
      const inside = (b) => b.left >= at.wrap.left && b.right <= at.wrap.right;
      assert.ok(inside(at.fit) && inside(at.button), `On the block, Fit or Trade for is off the edge of the table (${JSON.stringify(at)})`);
      await fits('the players on the block');
      blockSeen = true;
    }
  }
};

// The rest of the season (the stops pause it now and then), October, and the winter up to the draft.
for (let i = 0; i < 40 && !(await board('Start the postseason').count()); i++) {
  await board('To end').click();
  await idle();
  if (!(offerSeen && blockSeen)) await checkDesk();
}
assert.ok(blockSeen, 'nobody was on the block all season');
await board('Start the postseason').click();
await board('To the end').click({ timeout: 60000 });
await board('Start the offseason').click({ timeout: 120000 });
await page.waitForSelector('.winter-steps', { timeout: 120000 });
await board('Go to the tender deadline').click({ timeout: 60000 });
await board('Tender contracts').click({ timeout: 60000 });
// A winter step says what it's doing, and with no day count to fill, its bar moves.
const step = await page.locator('.board .progress')
  .evaluate((el) => ({ text: el.textContent, motion: getComputedStyle(el.querySelector('.bar span')).animationName }), null, { timeout: 2000 })
  .catch(() => null);
if (step !== null) assert.deepEqual(step, { text: 'Running the tender deadline…', motion: 'bar-stripes' }, 'a winter step did not say what it was doing over a moving bar');
await board('Finish the draft').waitFor({ timeout: 120000 });
// On the clock, the Draft button is in view: under the name, which stays put while the board scrolls sideways.
// The scoreboard can show the draft before the page does, so wait for the page's note either way.
const toMyPick = page.locator('.note button', { hasText: 'Sim to my pick' });
const onTheClock = page.locator('.note', { hasText: "You're on the clock" });
await toMyPick.or(onTheClock).first().waitFor({ timeout: 60000 });
if (await toMyPick.count()) await toMyPick.click();
await onTheClock.waitFor({ timeout: 60000 });
const pick = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.tbl button')].find((b) => b.textContent.trim() === 'Draft' && !b.disabled);
  const box = (el) => el && el.getBoundingClientRect();
  const b = box(btn);
  const w = box(btn?.closest('.tbl-wrap'));
  return b && w ? { left: b.left, right: b.right, wrapLeft: w.left, wrapRight: w.right } : null;
});
assert.ok(pick && pick.left >= pick.wrapLeft && pick.right <= pick.wrapRight, `the Draft button is off the edge of the board (${JSON.stringify(pick)})`);
await fits('the draft board');
// With picks still to make, Finish the draft asks before the scouting director makes them, on the scoreboard and at
// the foot of the page.
await board('Finish the draft').click();
const askDraft = page.locator('.board .winter-confirm');
await askDraft.waitFor({ timeout: 10000 });
assert.match(await askDraft.textContent(), /Let your scouting director make your (\d+ remaining picks|last pick)\?/, 'Finish the draft did not ask first');
await fits('the draft question on the scoreboard');
await askDraft.locator('button', { hasText: 'Not yet' }).click();
await askDraft.waitFor({ state: 'detached', timeout: 10000 });
await page.locator('.winter-next .btn.primary', { hasText: 'Finish the draft' }).click();
await page.locator('.winter-next .winter-confirm', { hasText: 'Let your scouting director make' }).waitFor({ timeout: 10000 });
await page.locator('.winter-next .winter-confirm button', { hasText: 'Not yet' }).click();
await onTheClock.waitFor({ timeout: 10000 });

assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], 'problems while using it');
await browser.close();
server.close();
console.log('all good');
