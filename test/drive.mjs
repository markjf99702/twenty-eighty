// Google Drive saving, tested against a fake Google (test/fake-google.mjs): node test/drive.mjs
// Three browser contexts share one fake Drive, so they're three devices. Run `npm run build:site` first.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { fakeGoogle } from './fake-google.mjs';

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
const origin = base.slice(0, -1);

const g = fakeGoogle();
const browser = await pw.chromium.launch();
const problems = [];
const leagueFiles = () => g.files().filter((f) => f.appProperties?.twentyEighty === 'league');
const until = async (what, fn, ms = 20000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

/**
 * A device: its own browser storage, the shared fake Google, and the origin check opened up for localhost. `expected`
 * matches console errors it should see (the connections the fake breaks off).
 */
async function device(name, init, expected) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await g.install(ctx, { rewrite: { '**/assets/index.js': (s) => s.replace('`https://junkdrawer.works`]', `\`https://junkdrawer.works\`,\`${origin}\`]`) } });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/401/.test(m.text()) && !expected?.test(m.text())) problems.push(`${name}: ${m.text()}`); });
  return page;
}
const SHOTS = process.env.SHOTS; // a folder, to look at the Drive screens
const shot = async (page, name) => SHOTS && page.screenshot({ path: join(SHOTS, `drive-${name}.png`), fullPage: false });
const board = (page, label) => page.locator('.board .btn', { hasText: label });
const idle = (page) => page.waitForSelector('.board .progress', { state: 'detached', timeout: 120000 });
const cell = async (page) => (await page.textContent('.board-cells .cell:first-child .v')).trim();
const gisReady = (page) => page.waitForFunction(() => window.google?.accounts?.oauth2 && window.__cfg !== undefined || window.google?.accounts?.oauth2, null, { timeout: 10000 });

// ---- Device A starts a league and connects Drive -----------------------------------------
const a = await device('A');
await a.goto(base);
await a.waitForSelector('.club-pick');
assert.ok(await a.locator('text=Played on another device?').count(), 'the title screen should offer Drive at junkdrawer.works');
const club = (await a.locator('.club-pick .nm').nth(2).textContent()).trim();
await a.locator('.club-pick').nth(2).click();
await a.locator('.setup .check input').first().uncheck();
await a.click('.start-bar .btn.primary');
await a.waitForSelector('.club-hero', { timeout: 60000 });
await a.goto(base + '#office');
await a.locator('button', { hasText: 'Connect Google Drive' }).waitFor();
await gisReady(a);
await a.locator('button', { hasText: 'Connect Google Drive' }).click();
const first = await until('the first upload', () => leagueFiles()[0]);
const folder = g.files().find((f) => f.appProperties?.twentyEighty === 'folder');
assert.equal(folder?.name, 'Twenty-Eighty', 'a Twenty-Eighty folder');
assert.deepEqual(first.parents, [folder.id], 'the league goes in the folder');
assert.equal(first.appProperties.club, club);
assert.equal(first.name, `${club} (Linux PC).txt`);
assert.ok(first.body.startsWith('twenty-eighty league 1\n'), 'the file holds a league code');
await until('a green cloud', () => a.locator('.cloud.ok').count());
await a.locator('.copy').first().waitFor();
await a.locator('section.section', { hasText: 'Google Drive' }).last().scrollIntoViewIfNeeded();
await shot(a, 'office');

// A plays a week: its file is updated in place, not duplicated.
const openingDay = first.appProperties.when;
await board(a, 'Week').click();
await idle(a);
await until('the week to reach Drive', () => leagueFiles()[0].appProperties.when !== openingDay);
assert.equal(leagueFiles().length, 1, 'one file per league per device');
assert.ok(leagueFiles()[0].body.startsWith('twenty-eighty league 1\n'), 'the update holds a league code');
const aWeek = leagueFiles()[0].appProperties.when;
assert.ok(aWeek.startsWith(await cell(a)), `Drive has A's date (${aWeek})`);
// A league this size (every league for its first few seasons) goes up in one multipart request, new file and update.
const smallUploads = g.calls.filter((x) => x.includes('/upload/'));
assert.ok(smallUploads.some((x) => x.startsWith('POST /upload/drive/v3/files?uploadType=multipart')), `a new file went up as ${smallUploads.join(', ')}`);
assert.ok(smallUploads.some((x) => x.startsWith(`PATCH /upload/drive/v3/files/${first.id}?uploadType=multipart`)), `an update went up as ${smallUploads.join(', ')}`);
assert.deepEqual(smallUploads.filter((x) => !x.includes('uploadType=multipart')), [], 'a small league went up some other way than one multipart request');

// ---- Device B, on a fresh browser, continues A's league ---------------------------------
const b = await device('B');
await b.goto(base);
await b.locator('text=Played on another device?').click();
await b.locator('button', { hasText: 'Connect Google Drive' }).waitFor();
await gisReady(b);
await b.locator('button', { hasText: 'Connect Google Drive' }).click();
await b.locator('.copy', { hasText: club }).waitFor();
await b.locator('.drive-continue').scrollIntoViewIfNeeded();
await shot(b, 'title');
await b.locator('.copy button', { hasText: 'Continue from this' }).click();
await b.waitForSelector('.club-hero', { timeout: 30000 });
assert.ok(aWeek.startsWith(await cell(b)), 'B picks up at the same date');
await b.waitForTimeout(5500);
assert.equal(leagueFiles().length, 1, "opening a copy doesn't upload the same league again");

// B plays on: its own copy appears beside A's.
await board(b, 'Week').click();
await idle(b);
const bFile = await until("B's own copy", () => leagueFiles().find((f) => f.appProperties.device !== first.appProperties.device));
assert.equal(bFile.appProperties.league, first.appProperties.league, 'the same league');
assert.equal(leagueFiles().length, 2, 'B writes its own file');
assert.equal(g.files().find((f) => f.id === first.id)?.appProperties.device, first.appProperties.device, "A's file is still A's");
assert.notEqual(bFile.appProperties.when, aWeek, 'further along');
const bDate = await cell(b);

// ---- A sees the newer copy and carries on from it ----------------------------------------
await a.goto(base + '#home');
await a.reload();
const banner = a.locator('.drive-banner');
await banner.waitFor({ timeout: 15000 });
assert.match(await banner.textContent(), /newer copy of this league/);
await a.waitForSelector('.club-hero');
await shot(a, 'banner');
await banner.locator('button', { hasText: 'Continue from' }).click();
await until('A to move to B\'s date', async () => (await cell(a)) === bDate);

// ---- An expired sign-in: the cloud turns red, and one tap signs back in and uploads ------
await a.evaluate(() => {
  const k = 'twenty-eighty.drive';
  const st = JSON.parse(localStorage.getItem(k));
  st.token = 'tok-expired';
  st.exp = Date.now() + 3_000_000;
  localStorage.setItem(k, JSON.stringify(st));
  localStorage.removeItem('junkdrawer.google');
});
await a.reload();
await a.waitForSelector('.club-hero');
await board(a, 'Day').click();
await idle(a);
await until('a red cloud', () => a.locator('.cloud.act').count(), 15000);
await shot(a, 'red');
const before = leagueFiles().find((f) => f.appProperties.device === first.appProperties.device).version;
await gisReady(a);
await a.locator('.cloud').click();
await until('the upload after signing back in', () => leagueFiles().find((f) => f.appProperties.device === first.appProperties.device).version > before);
await until('a green cloud again', () => a.locator('.cloud.ok').count());

// ---- Device C reuses another project's sign-in: no Google window --------------------------
const c = await device('C', () => {
  localStorage.setItem('junkdrawer.google', JSON.stringify({ token: 'tok-mark', exp: Date.now() + 3_600_000, scope: 'https://www.googleapis.com/auth/drive.file' }));
});
await c.goto(base);
await c.locator('text=Played on another device?').click();
await c.locator('button', { hasText: 'Connect Google Drive' }).click();
await c.locator('.copy', { hasText: club }).waitFor();
assert.equal(await c.evaluate(() => window.__prompts), undefined, 'no Google window when another project already signed in');

// ---- Stopping on A: no more uploads, nothing revoked, the files stay ----------------------
await a.goto(base + '#office');
await a.locator('button', { hasText: 'Stop saving on this device' }).click();
await a.locator('button', { hasText: 'Connect Google Drive' }).waitFor();
const uploads = () => g.calls.filter((x) => x.includes('/upload/')).length;
const sent = uploads();
await board(a, 'Day').click();
await idle(a);
await a.waitForTimeout(5500);
assert.equal(uploads(), sent, 'no uploads after stopping');
assert.equal(await a.evaluate(() => window.__revoked), undefined, 'never revokes');
assert.equal(leagueFiles().length, 2, 'the files stay in Drive');

// ---- A long league: past 4 MB it goes up in a resumable upload, picks up where Google's copy ends after a dropped ---
// ---- connection or a 308, says so when it can't, and opens on another device -------------------------------------
// Five seasons make a code of about 5.3 MB, too long to play here, so this league carries 3 MB of noise that the game
// keeps and never reads. Its own Google account keeps its files apart from the ones above.
const long = () => g.files().filter((f) => f.owner === 'long' && f.appProperties?.twentyEighty === 'league');
const decode = (code) => JSON.parse(gunzipSync(Buffer.from(code.slice(code.indexOf('\n') + 1), 'base64')).toString('utf8'));
const NOISE = 4 * 1024 * 1024; // 3 MB of random bytes, in base64
const putsSince = (n) => g.calls.slice(n).filter((x) => x.startsWith('PUT ')).map((x) => /\[(.*)\]$/.exec(x)[1]);
// Asked where it stands, Google says how much it has; the page sends the rest from there.
const resumedAt = (puts) => {
  const total = Number(/\/(\d+)$/.exec(puts[0])[1]);
  return [`bytes 0-${total - 1}/${total}`, `bytes */${total}`, `bytes ${Math.floor(total / 2)}-${total - 1}/${total}`];
};
const savedNoise = (page) => page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('twenty-eighty', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const stored = await new Promise((res, rej) => { const r = db.transaction('saves').objectStore('saves').get('current'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  db.close();
  const save = JSON.parse(typeof stored === 'string' ? stored : await new Response(stored.stream().pipeThrough(new DecompressionStream('gzip'))).text());
  return save.league.padding?.length ?? 0;
});
const d = await device('D', () => localStorage.setItem('__who', 'long'), /ERR_CONNECTION_RESET/);
await d.goto(base);
await d.waitForSelector('.club-pick');
const longClub = (await d.locator('.club-pick .nm').nth(5).textContent()).trim();
await d.locator('.club-pick').nth(5).click();
await d.locator('.setup .check input').first().uncheck();
await d.click('.start-bar .btn.primary');
await d.waitForSelector('.club-hero', { timeout: 60000 });
await d.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('twenty-eighty', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const stored = await new Promise((res, rej) => { const r = db.transaction('saves').objectStore('saves').get('current'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const save = JSON.parse(typeof stored === 'string' ? stored : await new Response(stored.stream().pipeThrough(new DecompressionStream('gzip'))).text());
  const noise = new Uint8Array(3 * 1024 * 1024);
  for (let i = 0; i < noise.length; i += 65536) crypto.getRandomValues(noise.subarray(i, i + 65536));
  let bin = '';
  for (let i = 0; i < noise.length; i += 0x8000) bin += String.fromCharCode(...noise.subarray(i, i + 0x8000));
  save.league.padding = btoa(bin);
  await new Promise((res, rej) => { const t = db.transaction('saves', 'readwrite'); t.objectStore('saves').put(JSON.stringify(save), 'current'); t.oncomplete = res; t.onerror = () => rej(t.error); });
  db.close();
});
await d.reload();
await d.waitForSelector('.club-hero', { timeout: 60000 });
assert.equal(await savedNoise(d), NOISE, 'the long league did not load with its noise');

// Connecting sends it as a new file: a resumable session opens, and the whole code goes in one PUT.
let mark = g.calls.length;
await d.goto(base + '#office');
await d.locator('button', { hasText: 'Connect Google Drive' }).waitFor();
await gisReady(d);
await d.locator('button', { hasText: 'Connect Google Drive' }).click();
const big = await until('the long league in Drive', () => long()[0], 60000);
assert.ok(big.body.length > 4 * 1024 * 1024, `the long league's code is only ${big.body.length} bytes`);
const opened = g.calls.slice(mark).filter((x) => x.includes('/upload/'));
assert.ok(opened.some((x) => x.startsWith('POST /upload/drive/v3/files?uploadType=resumable')), `the long league went up as ${opened.join(', ')}`);
assert.deepEqual(opened.filter((x) => x.includes('uploadType=multipart')), [], 'the long league went up in a multipart request');
assert.deepEqual(putsSince(mark), [`bytes 0-${big.body.length - 1}/${big.body.length}`], 'the whole code in one PUT');
assert.equal(big.name, `${longClub} (Linux PC).txt`);
assert.equal(big.mimeType, 'text/plain');
assert.deepEqual(big.parents, [g.files().find((f) => f.owner === 'long' && f.appProperties?.twentyEighty === 'folder')?.id], 'in its Twenty-Eighty folder');
assert.equal(decode(big.body).league.padding.length, NOISE, 'Drive has the whole league');
assert.equal(decode(big.body).league.id, big.appProperties.league);
await until('a green cloud for the long league', () => d.locator('.cloud.ok').count());

// The connection drops halfway through the next update: the page asks how much Google has and sends the rest.
await d.goto(base + '#home');
await d.waitForSelector('.club-hero');
g.cut('drop');
mark = g.calls.length;
let prior = long()[0];
await board(d, 'Day').click();
await idle(d);
await until('the next day in Drive after a dropped connection', () => long()[0].version > prior.version, 60000);
let puts = putsSince(mark);
assert.deepEqual(puts.slice(0, 3), resumedAt(puts), 'the update after a dropped connection did not pick up where Google\'s copy ended');
assert.ok(g.calls.slice(mark).some((x) => x.startsWith(`PATCH /upload/drive/v3/files/${big.id}?uploadType=resumable`)), 'the update did not open a resumable session on its own file');
assert.equal(long().length, 1, 'one file per league per device');
assert.notEqual(long()[0].appProperties.when, prior.appProperties.when, 'Drive has the new day');
assert.equal(decode(long()[0].body).league.padding.length, NOISE, 'the resumed upload is whole');

// Google keeps half and answers 308: the same.
g.cut('308');
mark = g.calls.length;
prior = long()[0];
await board(d, 'Day').click();
await idle(d);
await until('the next day in Drive after a 308', () => long()[0].version > prior.version, 60000);
puts = putsSince(mark);
assert.deepEqual(puts.slice(0, 3), resumedAt(puts), 'the update after a 308 did not pick up where Google\'s copy ended');
assert.equal(decode(long()[0].body).league.padding.length, NOISE, 'the upload after a 308 is whole');

// A connection that keeps dropping: after asking three times the cloud turns red and says why, and the league waits
// for the next save. Once the connection is back, a tap on the cloud sends it.
g.down(true);
mark = g.calls.length;
prior = long()[0];
await board(d, 'Day').click();
await idle(d);
await until('a red cloud', () => d.locator('.cloud.act').count(), 60000);
assert.match(await d.locator('.cloud').getAttribute('title'), /The upload to Google Drive kept breaking off/, 'the cloud does not say the upload failed');
const tries = putsSince(mark);
const size = Number(/\/(\d+)$/.exec(tries[0])[1]);
assert.deepEqual(tries.slice(0, 4), [`bytes 0-${size - 1}/${size}`, ...Array(3).fill(`bytes */${size}`)], `the upload gave up after ${tries.join(', ')}`);
assert.equal(long()[0].version, prior.version, 'Drive changed though every upload broke off');
await shot(d, 'long-failed');
g.down(false);
await d.locator('.cloud').click();
await until('the upload once the connection is back', () => long()[0].version > prior.version, 60000);
await until('a green cloud again', () => d.locator('.cloud.ok').count());
const dDate = await cell(d);

// ---- Device E, a fresh browser on the same account, carries on from the long league ------------------------------
const e = await device('E', () => localStorage.setItem('__who', 'long'));
await e.goto(base);
await e.locator('text=Played on another device?').click();
await e.locator('button', { hasText: 'Connect Google Drive' }).waitFor();
await gisReady(e);
await e.locator('button', { hasText: 'Connect Google Drive' }).click();
await e.locator('.copy', { hasText: longClub }).waitFor();
await e.locator('.copy button', { hasText: 'Continue from this' }).click();
await e.waitForSelector('.club-hero', { timeout: 60000 });
assert.equal(await cell(e), dDate, 'E picks up the long league at D\'s date');
assert.equal(await savedNoise(e), NOISE, 'E has the whole long league');

assert.deepEqual(problems, [], 'problems while using it');
await browser.close();
server.close();
console.log('drive: all good');
