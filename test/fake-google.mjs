// A stand-in for Google sign-in and the Drive API, for testing Drive saving in Playwright without Google.
// From the junkdrawer kit, plus what Twenty-Eighty needs: multipart PATCH (new metadata and content in one update),
// queries with more than one appProperties condition (all of them must match), and resumable uploads.
// Every browser context given the same fake shares one Drive, so two contexts are two devices.
//
//   import { fakeGoogle } from './fake-google.mjs';
//   const g = fakeGoogle();
//   await g.install(ctx, { rewrite: { '**/sync.js': s => s.replace("['https://junkdrawer.works']", "['https://junkdrawer.works', 'http://localhost:8080']") } });
//   … g.files() lists what's in the fake Drive; g.calls records every request.
//
// Resumable uploads go as Google documents them (developers.google.com/workspace/drive/api/guides/manage-uploads):
// a POST (a new file) or PATCH (an update) with uploadType=resumable, the metadata as JSON and X-Upload-Content-Length,
// opens a session and answers 200 with the session's address in Location, which the page may read (Google exposes
// it to browsers: its own browser sample reads it). PUTs to that address need no token: one with bytes
// (Content-Range: bytes FROM-LAST/TOTAL) adds them, and the answer is 200 with the file once all are there, or 308
// with Range: bytes=0-N for what has arrived so far; an empty one with Content-Range: bytes */TOTAL asks where the
// upload stands and gets the same answers. g.cut('drop') breaks the next upload PUT off halfway, half its bytes kept
// and the connection reset; g.cut('308') keeps half and answers 308. g.down(true) resets every PUT to a session.
//
// Sign-in: the fake google.accounts.oauth2 answers every requestAccessToken() with the token 'tok-' + the
// localStorage '__who' value (default 'mark'), so different accounts are different Drives. A token of
// 'tok-expired' gets 401s. window.__prompts records each request's options and window.__cfg the client config.
const GIS = `window.google={accounts:{oauth2:{
  initTokenClient:function(cfg){window.__cfg=cfg;return{requestAccessToken:function(o){window.__prompts=(window.__prompts||[]).concat([o||{}]);setTimeout(function(){cfg.callback({access_token:'tok-'+(localStorage.getItem('__who')||'mark'),expires_in:3599,scope:cfg.scope,token_type:'Bearer'});},20);}};},
  hasGrantedAllScopes:function(r,s){return (r.scope||'').indexOf(s)>=0;},
  revoke:function(t,cb){window.__revoked=(window.__revoked||0)+1;cb&&cb();}}}};`;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Content-Range, X-Upload-Content-Type, X-Upload-Content-Length',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'Location, Range',
};
const reply = (route, o, status = 200) => route.fulfill({ status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(o) });

export function fakeGoogle() {
  const drive = { files: {}, next: 1, sessions: {}, nextSession: 1 }, calls = [], cuts = [];
  let down = false;
  // A PUT to a resumable session: bytes, or a question about where the upload stands.
  function session(route, req, url) {
    const s = drive.sessions[url.searchParams.get('upload_id')], range = req.headers()['content-range'] || '';
    calls.push(`PUT ${url.pathname}${url.search} [${range}]`);
    if (!s) return reply(route, { error: { code: 404, message: 'Upload session not found' } }, 404);
    if (down) return route.abort('connectionreset');
    const incomplete = () => route.fulfill({ status: 308, headers: { ...CORS, ...(s.have ? { Range: `bytes=0-${s.have - 1}` } : {}) }, body: '' });
    if (/^bytes \*\/\d+$/.test(range)) return s.done ? reply(route, s.done) : incomplete();
    const r = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range), body = req.postDataBuffer() || Buffer.alloc(0);
    const [from, last, total] = r ? r.slice(1).map(Number) : [];
    if (!r || s.done || total !== s.total || from !== s.have || last - from + 1 !== body.length) {
      return reply(route, { error: { code: 400, message: `Content-Range ${range} (${body.length} bytes) doesn't follow the ${s.have} of ${s.total} received` } }, 400);
    }
    const cut = cuts.shift(), kept = cut ? Math.floor(body.length / 2) : body.length;
    s.parts.push(body.subarray(0, kept));
    s.have += kept;
    if (cut === 'drop') return route.abort('connectionreset');
    if (s.have < s.total) return incomplete();
    // Everything's here: the file is made, or updated in place.
    const content = Buffer.concat(s.parts).toString('utf8');
    let id = s.fileId;
    if (id) {
      const f = drive.files[id];
      Object.assign(f, s.meta, { appProperties: { ...(f.appProperties || {}), ...(s.meta.appProperties || {}) } });
      f.body = content; f.version++; f.modified = Date.now();
    } else {
      id = 'f' + drive.next++;
      drive.files[id] = { owner: s.owner, ...s.meta, version: 1, modified: Date.now(), body: content };
    }
    s.done = { id, version: String(drive.files[id].version) };
    return reply(route, s.done);
  }
  async function handle(route) {
    const req = route.request(), url = new URL(req.url()), m = req.method(), p = url.pathname;
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    // The session's address is its key: no token, as Google's examples send these.
    if (m === 'PUT' && url.searchParams.get('upload_id')) return session(route, req, url);
    calls.push(m + ' ' + p + url.search);
    const json = (o, status = 200) => reply(route, o, status);
    const auth = (req.headers()['authorization'] || '').replace('Bearer ', '');
    if (!auth.startsWith('tok-') || auth === 'tok-expired') return json({ error: { code: 401 } }, 401);
    const owner = auth.slice(4), mine = id => drive.files[id] && drive.files[id].owner === owner ? drive.files[id] : null;
    let mm;
    // A resumable upload opens: a new file (POST) or an update (PATCH), its metadata in JSON.
    if (url.searchParams.get('uploadType') === 'resumable' && ((m === 'POST' && p === '/upload/drive/v3/files') || (m === 'PATCH' && (mm = /^\/upload\/drive\/v3\/files\/([\w-]+)$/.exec(p))))) {
      const meta = JSON.parse(req.postData() || '{}'), fileId = m === 'PATCH' ? mm[1] : null, parent = meta.parents && meta.parents[0];
      if (fileId && !mine(fileId)) return json({ error: { code: 404, message: 'File not found: ' + fileId } }, 404);
      if (parent && !mine(parent)) return json({ error: { code: 404, message: 'File not found: ' + parent } }, 404);
      const total = Number(req.headers()['x-upload-content-length']);
      if (!(total > 0)) return json({ error: { code: 400, message: 'X-Upload-Content-Length is missing' } }, 400);
      const sid = 'u' + drive.nextSession++;
      drive.sessions[sid] = { owner, fileId, meta, total, type: req.headers()['x-upload-content-type'], parts: [], have: 0, done: null };
      return route.fulfill({ status: 200, headers: { ...CORS, Location: `${url.href}&upload_id=${sid}` }, body: '' });
    }
    if (m === 'GET' && p === '/drive/v3/files') {
      const q = url.searchParams.get('q') || '', aps = [...q.matchAll(/appProperties has \{ key='([^']+)' and value='([^']+)' \}/g)], name = /name\s*=\s*'([^']+)'/.exec(q);
      const hit = Object.entries(drive.files).filter(([, f]) => f.owner === owner && !f.trashed && aps.every((ap) => (f.appProperties || {})[ap[1]] === ap[2]) && (!name || f.name === name[1]));
      return json({ files: hit.map(([id, f]) => ({ id, name: f.name, version: String(f.version), modifiedTime: new Date(f.modified).toISOString(), appProperties: f.appProperties })) });
    }
    if (m === 'GET' && p === '/drive/v3/about') return json({ user: { displayName: owner, emailAddress: owner + '@gmail.com' } });
    if (m === 'POST' && p === '/drive/v3/files') { // metadata only, e.g. a folder
      const id = 'f' + drive.next++; drive.files[id] = { owner, ...JSON.parse(req.postData() || '{}'), version: 1, modified: Date.now(), body: null };
      return json({ id, version: '1' });
    }
    if (m === 'POST' && p === '/upload/drive/v3/files') { // uploadType=multipart
      const raw = req.postData() || '', boundary = /boundary=([^;]+)/.exec(req.headers()['content-type'] || '')[1];
      const parts = raw.split('--' + boundary).map(x => x.replace(/^\r\n/, '')).filter(x => x && !x.startsWith('--'));
      const bodyOf = x => x.slice(x.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, '');
      const meta = JSON.parse(bodyOf(parts[0])), parent = meta.parents && meta.parents[0];
      if (parent && !mine(parent)) return json({ error: 'parent not found' }, 404);
      const id = 'f' + drive.next++; drive.files[id] = { owner, ...meta, version: 1, modified: Date.now(), body: bodyOf(parts[1]) };
      return json({ id, version: '1' });
    }
    if ((mm = /^\/drive\/v3\/files\/([\w-]+)$/.exec(p))) {
      const f = mine(mm[1]); if (!f) return json({ error: 'not found' }, 404);
      if (m === 'GET') return url.searchParams.get('alt') === 'media' ? route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: f.body || '' }) : json({ id: mm[1], name: f.name, version: String(f.version), appProperties: f.appProperties });
      if (m === 'PATCH') { Object.assign(f, JSON.parse(req.postData() || '{}')); f.version++; return json({ id: mm[1], version: String(f.version) }); }
      if (m === 'DELETE') { delete drive.files[mm[1]]; return route.fulfill({ status: 204, headers: CORS }); }
    }
    if (m === 'PATCH' && (mm = /^\/upload\/drive\/v3\/files\/([\w-]+)$/.exec(p))) { // uploadType=media, or multipart (metadata and content)
      const f = mine(mm[1]); if (!f) return json({ error: 'not found' }, 404);
      if (url.searchParams.get('uploadType') === 'multipart') {
        const raw = req.postData() || '', boundary = /boundary=([^;]+)/.exec(req.headers()['content-type'] || '')[1];
        const parts = raw.split('--' + boundary).map(x => x.replace(/^\r\n/, '')).filter(x => x && !x.startsWith('--'));
        const bodyOf = x => x.slice(x.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, '');
        const meta = JSON.parse(bodyOf(parts[0]));
        Object.assign(f, meta, { appProperties: { ...(f.appProperties || {}), ...(meta.appProperties || {}) } });
        f.body = bodyOf(parts[1]);
      } else f.body = req.postData();
      f.version++; f.modified = Date.now(); return json({ id: mm[1], version: String(f.version) });
    }
    return json({ error: 'the fake Drive has no ' + m + ' ' + p }, 400);
  }
  return {
    drive, calls,
    cut: (...how) => cuts.push(...how),
    down: (on) => { down = on; },
    files: () => Object.entries(drive.files).map(([id, f]) => ({ id, ...f })),
    async install(ctx, { rewrite = {} } = {}) {
      for (const [glob, fn] of Object.entries(rewrite)) {
        await ctx.route(glob, async route => { const r = await route.fetch(); route.fulfill({ response: r, body: fn(await r.text()) }); });
      }
      await ctx.route('https://accounts.google.com/gsi/client', r => r.fulfill({ contentType: 'application/javascript', body: GIS }));
      await ctx.route('https://www.googleapis.com/**', handle);
    }
  };
}
