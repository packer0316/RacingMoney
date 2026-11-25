#!/usr/bin/env node
// 山道猴王 — 本機平台模擬器 (金碟遊樂場 GoldSaucer)
// 不必上傳就能在自己電腦上測試：伺服器函式 (紀錄 / 積分)、多人房間、排行榜。不需要安裝任何套件。
//
//   node tools/dev_platform.js                 → http://localhost:8765/?user=小明
//   另開一個分頁                               → http://localhost:8765/?user=阿華   (不同 user = 不同玩家)
//   訪客 (未登入)                              → http://localhost:8765/?guest=1
//   和平台一樣包在沙箱 iframe 裡               → http://localhost:8765/play?user=小明   (上架前請用這個網址測一輪)
//
//   --port 8765      連接埠
//   --latency 80     模擬網路延遲 (毫秒，來回各一半，另加少量抖動)
//   --no-date        伺服器函式沙箱裡不提供 Date (測試沒有時鐘時的退路)
//   --save           把玩家狀態 / 共用資料存到 tools/cache/dev_platform.json (重開模擬器後還在)
//   --root <資料夾>  改成提供別的資料夾 (例如解壓後的 dist/shandao-monkey-king.zip，確認上傳包本身能跑)
//
// 模擬的範圍：GoldSaucer.init / getUser / saves / scores / server.call / multiplayer.join (房間腳本 server/room.js)。
// 限制比照平台文件：函式輸入 8 KB、結果 16 KB、玩家狀態與共用資料各 64 KB、每位玩家 10 秒 30 次且一次只能一個呼叫；
// 房間訊息 8 KB、每位玩家每秒 20 則、腳本丟出例外就關房、空房 30 秒後回收。
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const argv = process.argv.slice(2);
const arg = (name, d) => { const i = argv.indexOf('--' + name); return i < 0 ? d : argv[i + 1]; };
const flag = (name) => argv.includes('--' + name);
const ROOT = path.resolve(arg('root', path.join(__dirname, '..')));   // --root：改成測試解壓後的上傳包
const PORT = +arg('port', 8765);
const LATENCY = +arg('latency', 0);
const NO_DATE = flag('no-date');
const SAVE = flag('save');
const SAVE_FILE = path.join(__dirname, 'cache', 'dev_platform.json');
// 平台遊戲 iframe 的 sandbox 屬性 (2026-11-23 從平台實際頁面讀到的)：沒有 allow-forms / allow-popups / allow-top-navigation，
// 也沒有 allow-same-origin → 遊戲是「不透明來源」：表單送不出去、localStorage 要靠 SDK 的相容層、載入 ES module 需要 CORS 標頭
const SANDBOX = arg('sandbox', 'allow-scripts allow-pointer-lock allow-orientation-lock allow-modals');

const manifest = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'goldsaucer.json'), 'utf8')); } catch (e) { return {}; } })();
const ENTRY = manifest.entry || 'index.html';
const size = (v) => Buffer.byteLength(JSON.stringify(v === undefined ? null : v), 'utf8');
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const deepFreeze = (o) => { if (o && typeof o === 'object') { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; };
const err = (code, message) => Object.assign(new Error(message || code), { code });

// ---------------------------------------------------------------- 資料 (記憶體，可選擇存檔)
const DB = { states: {}, shared: null, scores: {}, saves: {} };
if (SAVE) { try { Object.assign(DB, JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'))); console.log('已載入', SAVE_FILE); } catch (e) { /* 第一次 */ } }
let saveT = null;
function persist() {
  if (!SAVE || saveT) return;
  saveT = setTimeout(() => { saveT = null; fs.mkdirSync(path.dirname(SAVE_FILE), { recursive: true }); fs.writeFileSync(SAVE_FILE, JSON.stringify(DB)); }, 300);
}
const userOf = (name) => ({ id: 'u_' + crypto.createHash('md5').update(name).digest('hex').slice(0, 10), username: name, displayName: name, avatarUrl: null });

// ---------------------------------------------------------------- 伺服器函式
const busy = new Set(), calls = {};
function runFunction(user, name, input) {
  if (!manifest.functions) throw err('notFound', '這個遊戲沒有伺服器函式');
  if (typeof name !== 'string' || name === 'init' || name[0] === '_') throw err('notFound', '不能呼叫 ' + name);
  if (size(input) > 8 * 1024) throw err('tooLarge', 'input 超過 8 KB');
  const now = Date.now();
  const log = (calls[user.id] = (calls[user.id] || []).filter((t) => now - t < 10000));
  if (log.length >= 30) throw err('rateLimited', '每位玩家 10 秒最多 30 次');
  log.push(now);
  if (busy.has(user.id)) throw err('conflict', '同一位玩家同時只能有一個呼叫');
  busy.add(user.id);
  try {
    // 每次呼叫都是全新的沙箱 (每次重新讀檔：改了 functions.js 不必重開模擬器)
    const code = fs.readFileSync(path.join(ROOT, manifest.functions), 'utf8');
    let defs = null;
    const sandbox = vm.createContext({ console: { log: (...a) => console.log('[functions]', ...a) }, defineFunctions: (o) => { defs = o; } });
    vm.runInContext('Math.random = function () { throw new Error("沙箱裡沒有 Math.random，請用 ctx.random()"); };' + (NO_DATE ? 'Date = undefined;' : ''), sandbox);
    vm.runInContext(code, sandbox, { filename: manifest.functions, timeout: 1000 });
    if (!defs || typeof defs[name] !== 'function') throw err('notFound', '沒有這個函式：' + name);
    let n = 0;
    const rnd = () => { if (++n > 256) throw new Error('每次呼叫最多 256 個亂數'); return crypto.randomInt(0, 2 ** 32) / 2 ** 32; };
    const ctx = {
      player: { id: user.id, username: user.username, displayName: user.displayName }, chips: 0, currency: null,
      shared: deepFreeze(clone(DB.shared)), random: rnd, randomInt: (a, b) => a + Math.floor(rnd() * (b - a + 1)),
    };
    let state = clone(DB.states[user.id]);
    if (state === undefined || state === null) state = clone(defs.init ? defs.init(ctx) : {});
    let out;
    try { out = defs[name](state, clone(input), ctx); } catch (e) { throw err('functionFailed', e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e)); }
    out = out || {};
    const result = clone(out.result === undefined ? null : out.result);
    if (size(result) > 16 * 1024) throw err('functionFailed', 'result 超過 16 KB');
    if (out.state !== undefined) { if (size(out.state) > 64 * 1024) throw err('functionFailed', '玩家狀態超過 64 KB'); DB.states[user.id] = clone(out.state); } else if (DB.states[user.id] === undefined) DB.states[user.id] = state;
    if (out.shared !== undefined) { if (size(out.shared) > 64 * 1024) throw err('functionFailed', '共用資料超過 64 KB'); DB.shared = clone(out.shared); }
    persist();
    return { result, chips: 0 };
  } finally { busy.delete(user.id); }
}

// ---------------------------------------------------------------- 多人房間
const rooms = new Map();
let roomSeq = 0;
function makeRoom() {
  if (!manifest.server) throw err('unsupported', '這個遊戲沒有房間腳本');
  const code = fs.readFileSync(path.join(ROOT, manifest.server), 'utf8');
  let def = null;
  const id = 'dev0-' + crypto.randomBytes(6).toString('hex');
  const R = { id, conns: new Map(), locked: false, createdAt: Date.now(), closed: false, emptyT: null, tickT: null, n: ++roomSeq };
  const tag = '[room ' + R.n + ']';
  const sandbox = vm.createContext({ console: { log: (...a) => console.log(tag, ...a) }, defineRoom: (o) => { def = o; } });
  vm.runInContext(code, sandbox, { filename: manifest.server, timeout: 1000 });
  if (!def) throw err('scriptInvalid', '房間腳本沒有呼叫 defineRoom');
  R.def = def;
  R.max = Math.max(1, Math.min(64, def.maxPlayers || 8));
  const sendTo = (player, type, data) => { const c = R.conns.get(player && player.id); if (c) c.out({ t: 'msg', type, data: data === undefined ? null : clone(data) }); };
  R.api = {
    id, state: {},
    get players() { return [...R.conns.values()].map((c) => c.player); },
    broadcast(type, data, opts) { for (const c of R.conns.values()) if (!(opts && opts.except && opts.except.id === c.player.id)) sendTo(c.player, type, data); },
    send: sendTo,
    kick(player) { const c = R.conns.get(player && player.id); if (c) setImmediate(() => c.drop('kicked')); },
    lock() { R.locked = true; }, unlock() { R.locked = false; },
    submitScore(player, score) { const c = R.conns.get(player && player.id); if (c) submitScore(c.user, score); },
  };
  R.call = (name, ...a) => {
    if (R.closed || typeof def[name] !== 'function') return;
    const t0 = process.hrtime.bigint();
    try { def[name](R.api, ...a); } catch (e) {
      console.error('\x1b[31m' + tag + ' 腳本在 ' + name + ' 丟出例外，房間關閉：\x1b[0m\n', e);
      closeRoom(R, 'scriptError');
      return;
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (ms > 50) { console.error(tag, name, '執行 ' + ms.toFixed(1) + ' ms，超過 50 ms 上限，房間關閉'); closeRoom(R, 'timeout'); }
  };
  R.call('onCreate');
  const rate = Math.max(0, Math.min(30, def.tickRate || 0));
  if (rate > 0) { let last = Date.now(); R.tickT = setInterval(() => { const now = Date.now(); R.call('onTick', now - last); last = now; }, 1000 / rate); }
  rooms.set(id, R);
  console.log(tag, '開房', id);
  return R;
}
function closeRoom(R, reason) {
  if (R.closed) return;
  R.closed = true;
  clearInterval(R.tickT); clearTimeout(R.emptyT);
  for (const c of [...R.conns.values()]) c.drop(reason || 'closed', true);
  rooms.delete(R.id);
  console.log('[room ' + R.n + '] 關閉 (' + (reason || 'closed') + ')');
}
function directory() {
  return [...rooms.values()].filter((r) => !r.closed).map((r) => ({ roomId: r.id, players: r.conns.size, maxPlayers: r.max, locked: r.locked, createdAt: r.createdAt }));
}

function joinRoom(ws, user, want) {
  let R = null;
  if (want && want !== 'new') {
    R = rooms.get(want);
    if (!R) return ws.fail('roomNotFound', '房間不存在或已關閉');
    if (R.locked || R.conns.size >= R.max) return ws.fail('roomFull', '房間已滿或已上鎖');
  } else if (!want) {
    R = [...rooms.values()].find((r) => !r.locked && r.conns.size < r.max) || null;   // 快速配對
  }
  if (!R) { try { R = makeRoom(); } catch (e) { return ws.fail(e.code || 'scriptInvalid', e.message); } }
  clearTimeout(R.emptyT);
  const player = { id: 'p_' + crypto.randomBytes(5).toString('hex'), name: user.displayName, avatarUrl: user.avatarUrl };
  // 延遲模擬下仍要維持訊息順序 (TCP 是有序的)
  // 每則訊息各自延遲 (來回各一半 + 少量抖動)，但送達時間不早於前一則
  const outQ = { t: 0 }, inQ = { t: 0 };
  const ordered = (q, fn) => {
    if (!(LATENCY > 0)) return fn();
    const now = Date.now();
    q.t = Math.max(q.t, now + LATENCY / 2 + Math.random() * LATENCY * 0.15);
    setTimeout(fn, q.t - now);
  };
  const conn = {
    user, player, gone: false, sec: 0, cnt: 0,
    out(msg) { if (!conn.gone) ordered(outQ, () => { if (!ws.closed) ws.send(JSON.stringify(msg)); }); },
    drop(reason, silent) {
      if (conn.gone) return;
      conn.gone = true;
      R.conns.delete(player.id);
      if (!ws.closed) { ws.send(JSON.stringify({ t: 'closed', reason })); ws.close(); }
      if (!silent) left();
    },
  };
  const left = () => {
    R.call('onLeave', player);
    console.log('[room ' + R.n + ']', user.displayName, '離開 (' + R.conns.size + '/' + R.max + ')');
    if (R.conns.size === 0 && !R.closed) R.emptyT = setTimeout(() => closeRoom(R, 'empty'), 30000);
  };
  R.conns.set(player.id, conn);
  ws.send(JSON.stringify({ t: 'joined', roomId: R.id, you: { id: player.id, userId: user.id, name: player.name, avatarUrl: player.avatarUrl }, capabilities: { directory: true, transportClock: true } }));
  console.log('[room ' + R.n + ']', user.displayName, '加入 (' + R.conns.size + '/' + R.max + ')');
  R.call('onJoin', player);
  ws.onText = (text) => {
    if (conn.gone) return;
    if (Buffer.byteLength(text, 'utf8') > 8 * 1024) return conn.out({ t: 'error', code: 'tooLarge', message: '訊息超過 8 KB' });
    let m;
    try { m = JSON.parse(text); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'clock') return ws.send(JSON.stringify({ t: 'clock', requestId: m.requestId, serverTime: Date.now() }));
    if (m.t === 'directory') return ws.send(JSON.stringify({ t: 'directory', rooms: directory(), status: 'ready', complete: true }));
    if (m.t === 'leave') return conn.drop('left');
    if (m.t !== 'msg' || typeof m.type !== 'string' || !m.type || m.type.length > 64) return;
    const sec = Math.floor(Date.now() / 1000);
    if (sec !== conn.sec) { conn.sec = sec; conn.cnt = 0; }
    if (++conn.cnt > 20) { console.warn('[room ' + R.n + ']', user.displayName, '超過每秒 20 則，訊息被丟棄：', m.type); return conn.out({ t: 'error', code: 'rateLimited', message: '每秒最多 20 則訊息' }); }
    ordered(inQ, () => { if (!conn.gone) R.call('onMessage', player, m.type, m.data === undefined ? null : m.data); });
  };
  ws.onClose = () => { if (!conn.gone) { conn.gone = true; R.conns.delete(player.id); left(); } };
}

// ---------------------------------------------------------------- 排行榜
function submitScore(user, score) {
  score = Math.round(Number(score));
  if (!(score >= 0)) throw err('badScore', '分數必須是 0 以上的數字');
  const cur = DB.scores[user.id];
  if (!cur || score > cur.score) DB.scores[user.id] = { username: user.username, displayName: user.displayName, score, avatarUrl: user.avatarUrl };   // 保留每位玩家的最高分
  persist();
}
function topScores(limit) {
  return Object.values(DB.scores).sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.min(100, limit || 10))).map((s, i) => Object.assign({ rank: i + 1 }, s));
}

// ---------------------------------------------------------------- WebSocket (自己實作，免裝套件)
function acceptWs(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return null; }
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
    crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64') + '\r\n\r\n');
  socket.setNoDelay(true);
  const frame = (op, payload) => {
    const n = payload.length;
    const head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | op; b[1] = 127; b.writeBigUInt64BE(BigInt(n), 2); return b; })();
    return Buffer.concat([head, payload]);
  };
  const ws = {
    closed: false, onText: null, onClose: null,
    send(text) { if (!ws.closed) socket.write(frame(1, Buffer.from(text, 'utf8'))); },
    close() { if (ws.closed) return; ws.closed = true; try { socket.write(frame(8, Buffer.alloc(0))); socket.end(); } catch (e) { /* ignore */ } },
    fail(code, message) { ws.send(JSON.stringify({ t: 'error', code, message })); ws.close(); },
  };
  let buf = Buffer.alloc(0), parts = [];
  socket.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80, op = buf[0] & 15, masked = buf[1] & 0x80;
      let len = buf[1] & 127, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const need = off + (masked ? 4 : 0) + len;
      if (buf.length < need) return;
      let payload = buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) { const mk = buf.subarray(off, off + 4); payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= mk[i & 3]; }
      buf = buf.subarray(need);
      if (op === 8) { ws.closed = true; socket.end(); return; }
      if (op === 9) { socket.write(frame(10, payload)); continue; }
      if (op === 10) continue;
      parts.push(payload);
      if (fin) { const text = Buffer.concat(parts).toString('utf8'); parts = []; if (ws.onText) ws.onText(text); }
    }
  });
  const end = () => { ws.closed = true; if (ws.onClose) { const f = ws.onClose; ws.onClose = null; f(); } };
  socket.on('close', end); socket.on('error', end);
  return ws;
}

// ---------------------------------------------------------------- HTTP
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8' };
const readBody = (req) => new Promise((res, rej) => { const a = []; let n = 0; req.on('data', (d) => { n += d.length; if (n > 1e6) { rej(err('tooLarge')); req.destroy(); } else a.push(d); }); req.on('end', () => { try { res(JSON.parse(Buffer.concat(a).toString('utf8') || '{}')); } catch (e) { rej(err('badRequest')); } }); });
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };   // 沙箱 iframe (不透明來源) 也要能呼叫
const json = (res, code, body) => { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, CORS)); res.end(JSON.stringify(body)); };
const userFrom = (name) => { if (!name) throw err('unauthorized', '訪客不能使用這個功能，請先登入'); return userOf(String(name).slice(0, 30)); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    if (p === '/__gs/sdk.js') { res.writeHead(200, Object.assign({ 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' }, CORS)); return res.end(fs.readFileSync(path.join(__dirname, 'dev_sdk.js'))); }
    if (p === '/__gs/call' && req.method === 'POST') {
      const b = await readBody(req);
      const run = () => { try { json(res, 200, { ok: true, value: runFunction(userFrom(b.user), b.name, b.input) }); } catch (e) { json(res, 200, { ok: false, code: e.code || 'functionFailed', message: e.message }); } };
      return LATENCY > 0 ? setTimeout(run, LATENCY) : run();
    }
    if (p === '/__gs/score' && req.method === 'POST') { const b = await readBody(req); try { submitScore(userFrom(b.user), b.score); return json(res, 200, { ok: true }); } catch (e) { return json(res, 200, { ok: false, code: e.code, message: e.message }); } }
    if (p === '/__gs/top') return json(res, 200, { ok: true, value: topScores(+url.searchParams.get('limit')) });
    if (p === '/__gs/save' && req.method === 'POST') {
      const b = await readBody(req), u = userFrom(b.user);
      const box = (DB.saves[u.id] = DB.saves[u.id] || {});
      if (b.value !== undefined) { if (Buffer.byteLength(String(b.value)) > 64 * 1024) return json(res, 200, { ok: false, code: 'tooLarge' }); box[b.key] = String(b.value); persist(); }
      return json(res, 200, { ok: true, value: box[b.key] === undefined ? null : box[b.key] });
    }
    if (p === '/play') {
      // 比照平台：遊戲放在沙箱 iframe 裡 (不能送出表單、不能 alert / 開新視窗、不能導走整個頁面)。
      // 直接開 / 不會有這些限制，所以表單之類的問題要用 /play 才測得出來。
      const src = '/' + (url.search || '');
      res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' });
      return res.end('<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><title>本機平台模擬器 (沙箱)</title>'
        + '<style>html,body{margin:0;height:100%;background:#0b0e10;display:grid;place-items:center}iframe{border:0;width:min(100vw,177.78vh);height:min(100vh,56.25vw);background:#000}</style></head>'
        + '<body><iframe id="game" src="' + src.replace(/"/g, '&quot;') + '" sandbox="' + SANDBOX + '" allow="autoplay; fullscreen; gamepad"></iframe></body></html>');
    }
    if (p === '/__gs/state') return json(res, 200, { shared: DB.shared, states: DB.states, scores: topScores(100), rooms: [...rooms.values()].map((r) => ({ id: r.id, players: [...r.conns.values()].map((c) => c.user.displayName), locked: r.locked, state: r.api.state })) });
    if (p === '/__gs/reset' && req.method === 'POST') { DB.states = {}; DB.shared = null; DB.scores = {}; DB.saves = {}; persist(); return json(res, 200, { ok: true }); }
    // 靜態檔案
    let file = path.join(ROOT, p === '/' ? ENTRY : p);
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(file).toLowerCase();
    const head = { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
    if (path.resolve(file) === path.join(ROOT, ENTRY) && (!manifest.sdk || manifest.sdk.inject !== false)) {
      // 比照平台：自動把 SDK 注入入口 html
      let html = fs.readFileSync(file, 'utf8');
      html = html.replace(/<head[^>]*>/i, (m) => m + '\n<script src="/__gs/sdk.js"></script>');
      res.writeHead(200, head); return res.end(html);
    }
    const stat = fs.statSync(file), range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const a = m && m[1] ? +m[1] : 0, b = m && m[2] ? Math.min(+m[2], stat.size - 1) : stat.size - 1;
      res.writeHead(206, Object.assign(head, { 'Content-Range': `bytes ${a}-${b}/${stat.size}`, 'Content-Length': b - a + 1, 'Accept-Ranges': 'bytes' }));
      return fs.createReadStream(file, { start: a, end: b }).pipe(res);
    }
    res.writeHead(200, Object.assign(head, { 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' }));
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    json(res, e.code === 'unauthorized' ? 200 : 500, { ok: false, code: e.code || 'error', message: e.message });
  }
});
server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/__gs/room') return socket.destroy();
  const ws = acceptWs(req, socket);
  if (!ws) return;
  const name = url.searchParams.get('user');
  if (!name) return ws.fail('unauthorized', '訪客不能加入多人房間');
  joinRoom(ws, userOf(name.slice(0, 30)), url.searchParams.get('room') || '');
});
server.listen(PORT, () => {
  console.log('山道猴王 本機平台模擬器');
  console.log('  玩家 1：http://localhost:' + PORT + '/?user=' + encodeURIComponent('小明'));
  console.log('  玩家 2：http://localhost:' + PORT + '/?user=' + encodeURIComponent('阿華') + '   (另開分頁，user 不同就是不同玩家)');
  console.log('  訪客  ：http://localhost:' + PORT + '/?guest=1');
  console.log('  沙箱  ：http://localhost:' + PORT + '/play?user=' + encodeURIComponent('小明') + '   (和平台一樣包在沙箱 iframe 裡)');
  console.log('  目前資料：http://localhost:' + PORT + '/__gs/state' + (LATENCY ? '   模擬延遲 ' + LATENCY + ' ms' : '') + (NO_DATE ? '   (函式沙箱無 Date)' : ''));
});
