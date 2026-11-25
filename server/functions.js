// 山道猴王 — 伺服器函式 (金碟遊樂場 GoldSaucer)
// 由平台在沙箱裡執行，玩家端只能透過 GoldSaucer.server.call(name, input) 呼叫。
//
//   每位玩家的 state ：{ v, rv, total 累計積分, runs 完賽次數, best { 賽道代碼: 最佳毫秒 } }
//   全遊戲共用 shared：{ v, rv, records { 賽道代碼: [前 15 名] }, rooms { 房號: 多人房間登記 }, replays { 賽道代碼: { 玩家 id: 重播 } } }
//
// rv = 計時規則版本 (REC_V)。規則改了，舊的紀錄就不能比：rv 不是 REC_V 的賽道前 15 名、重播、個人最佳一律當作沒有 (下次寫入時清掉)，
// 累計積分與完賽次數照舊保留。
//
// 重播 (js/game/replay.js)：只有 REPLAY 裡的短賽道有。紀錄不在前 15 名裡了 (被擠出去、或自己跑出更好的成績蓋掉) 重播就刪掉；
// 平台給 shared 的上限是 64 KB，所以每次寫入都經過 fit()，太大就從名次最後面的重播開始刪 (紀錄與房間登記不動)。
//
// 賽道代碼 = 路段 + ':' + 方向，例如 "sprint:1" (彎道衝刺 往宜蘭)、"nine:-1" (九彎十八拐 往台北)。
// 個人計時賽與多人房間共用同一份紀錄與積分。

var TRACKS = {
  // len：計時區間長度 (公尺)，需與 js/main.js 的 SECTIONS 一致
  sprint: { len: 2080 },
  nine: { len: 13270 },
  pl_tc: { len: 31630 },
  xd_pl: { len: 26490 },
  full: { len: 58120 },
  // 熱浪夏威夷：虛構賽道，只有個人計時賽、單向 (solo：不能拿來開多人房)。len = js/world/drift_track.js 的 section.s1 - s0。
  // 路形若再改、長度變了，舊紀錄就不能比 → 改用新的賽道代碼 (例如 drift2) 讓紀錄重新開始
  drift: { len: 3360, solo: true }
};
var ENVS = { sunny: 1, fog: 1, dusk: 1, night: 1, rain: 1 };
var CARS = { k8: 1, gr86: 1, ae86: 1, r34: 1, r35: 1, p911: 1 };
var TOP_N = 15;           // 每條賽道 × 方向保留的名次數 (2026-11-25 由 5 名改成 15 名)
var BONUS_N = 5;          // 「進入賽道前 5 名」的積分加成仍只給前 5 名 (積分規則不變)
var ROOM_TTL = 45000;      // 房主每 12 秒回報一次；超過這麼久沒回報的房間視為已關閉
var ROOM_MAX = 60;
var REPLAY = { sprint: 1, drift: 1 };   // 有重播的賽道 (要和 js/game/replay.js 的 TRACKS 一致)
var RP_MAX = 7000;         // 一筆重播資料 (base64) 的上限：每次呼叫的輸入上限是 8 KB
var SHARED_MAX = 61000;    // shared 的安全上限 (平台 65536 bytes)
// 計時規則版本：1 = 過起點線才開始計時；2 = 倒數 START 就開始計時 (2026-11-25)。玩家端送成績時帶 rv (js/ui/online.js)
var REC_V = 2;

function int(v, lo, hi, d) {
  v = Math.round(Number(v));
  if (!(v === v)) return d;
  return v < lo ? lo : v > hi ? hi : v;
}
function text(v, max, d) {
  if (typeof v !== 'string') return d;
  var out = '', n = 0;
  for (var i = 0; i < v.length && n < max; i++) {
    var c = v.charCodeAt(i);
    if (c < 32 || c === 127) continue;
    out += v.charAt(i); n++;
  }
  out = out.replace(/^\s+|\s+$/g, '');
  return out || d;
}
// 沙箱裡 Date 不一定可用：可用時以伺服器時間為準，否則用玩家端送來的時間 (只用於房間列表的新鮮度與紀錄日期)
function nowOf(input) {
  var t = 0;
  try { t = Date.now(); } catch (e) { t = 0; }
  if (!(t > 1600000000000)) t = Number(input && input.now) || 0;
  return t;
}
function nameOf(ctx) {
  var p = ctx.player || {};
  return text(p.displayName, 24, '') || text(p.username, 24, '玩家');
}
function fresh(state) {
  var s = state || {};
  var best = {};
  // 個人最佳是舊計時規則的就不沿用 (積分、完賽次數保留)
  if (s.best && s.rv === REC_V) for (var k in s.best) best[k] = s.best[k];
  return { v: 1, rv: REC_V, total: Number(s.total) || 0, runs: Number(s.runs) || 0, best: best };
}
// 目前計時規則的賽道紀錄 / 重播 (舊規則的當作沒有)
function recsOf(sh) { return sh && sh.rv === REC_V && sh.records ? sh.records : {}; }
function repsOf(sh) { return sh && sh.rv === REC_V && sh.replays ? sh.replays : {}; }
function copyRooms(rooms, now) {
  var out = {};
  if (rooms) for (var id in rooms) {
    var r = rooms[id];
    if (now && Math.abs(now - r.t) > ROOM_TTL) continue;
    out[id] = r;
  }
  return out;
}

// ---- 重播
// 玩家送來的重播：{ v, d (base64url), c 車色, env 天氣, ts 起跑到開始計時 (毫秒), t 全長 (毫秒) }；長度要和成績對得上
function cleanReplay(rp, ms) {
  if (!rp || typeof rp !== 'object' || typeof rp.d !== 'string') return null;
  var d = rp.d;
  if (d.length < 16 || d.length > RP_MAX || !/^[A-Za-z0-9_-]+$/.test(d)) return null;
  var t = int(rp.t, 0, 3 * 3600 * 1000, 0), ts = int(rp.ts, 0, 60000, 0);
  if (Math.abs(t - ts - ms) > 1500) return null;
  return { v: 1, d: d, c: int(rp.c, 0, 63, 0), env: ENVS[rp.env] ? rp.env : 'sunny', ts: ts, t: t };
}
// UTF-8 位元組數 (平台用位元組算上限；中文名字一個字 3 bytes)
function byteLen(s) {
  var n = s.length;
  for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); if (c > 0x7f) n += c > 0x7ff ? 2 : 1; }
  return n;
}
// 紀錄上的 r 標記 (= 有重播) 要和 replays 一致；沒變就回傳原本的陣列
function flagged(list, reps) {
  var i, bad = false;
  for (i = 0; i < list.length; i++) if (!list[i].r !== !(reps && reps[list[i].id])) { bad = true; break; }
  if (!bad) return list;
  var out = [];
  for (i = 0; i < list.length; i++) {
    var e = list[i], has = !!(reps && reps[e.id]);
    if (!e.r === !has) { out.push(e); continue; }
    var c = {};
    for (var f in e) if (f !== 'r') c[f] = e[f];
    if (has) c.r = 1;
    out.push(c);
  }
  return out;
}
// 寫回 shared 之前一律經過這裡：只留還在前 15 名裡的重播、更新 r 標記，太大就從名次最後面的重播開始刪
function fit(sh) {
  var recs = sh.records || {}, reps = sh.replays || {}, keep = {}, k, i;
  for (k in reps) {
    if (!REPLAY[k.split(':')[0]]) continue;
    var list = recs[k] || [], m = null;
    for (i = 0; i < list.length; i++) { var d = reps[k][list[i].id]; if (d) { if (!m) m = {}; m[list[i].id] = d; } }
    if (m) keep[k] = m;
  }
  var build = function () {
    var rr = {};
    for (var kk in recs) rr[kk] = flagged(recs[kk], keep[kk]);
    return { v: 1, rv: REC_V, records: rr, rooms: sh.rooms || {}, replays: keep };
  };
  var out = build();
  for (var guard = 0; guard < 100 && byteLen(JSON.stringify(out)) > SHARED_MAX; guard++) {
    var wk = null, wi = -1, wid = null;
    for (k in keep) {
      var L = recs[k] || [];
      for (i = L.length - 1; i >= 0; i--) if (keep[k][L[i].id]) { if (i > wi) { wi = i; wk = k; wid = L[i].id; } break; }
    }
    if (!wk) break;
    delete keep[wk][wid];
    out = build();
  }
  return out;
}

defineFunctions({
  init: function (ctx) { return { v: 1, rv: REC_V, total: 0, runs: 0, best: {} }; },

  // 我的資料 + 所有賽道的前 15 名 (唯讀)
  // 紀錄用陣列回傳 [id, 名字, 毫秒, 車款, 有重播 1/0]：11 個榜 × 15 名都填滿時，物件格式會超過平台每次回傳 16 KB 的上限
  profile: function (state, input, ctx) {
    var st = fresh(state), sh = ctx.shared || {}, all = recsOf(sh), rows = {};
    for (var k in all) {
      var L = all[k] || [], a = [];
      for (var i = 0; i < L.length; i++) a.push([L[i].id, L[i].name, L[i].t, L[i].car, L[i].r ? 1 : 0]);
      rows[k] = a;
    }
    // dataV：共用資料目前的計時規則版本 (確認舊紀錄真的刪掉了用)
    var out = { result: { ok: true, id: ctx.player.id, name: nameOf(ctx), total: st.total, runs: st.runs, best: st.best, records: rows, dataV: sh.rv || 1 } };
    // 計時規則改版後第一次有人讀：舊規則的賽道紀錄與重播直接從共用資料刪掉 (房間登記保留)
    if (sh.rv !== REC_V && (sh.records || sh.replays)) out.shared = fit({ records: {}, rooms: copyRooms(sh.rooms, nowOf(input)), replays: {} });
    // 自己的舊個人最佳也刪掉 (累計積分、完賽次數保留)
    if (state && state.rv !== REC_V) out.state = st;
    return out;
  },

  // 讀一筆重播 (紀錄視窗按 ▶)：input { key: 賽道代碼, id: 玩家 id }
  replay: function (state, input, ctx) {
    input = input || {};
    var key = text(input.key, 24, ''), id = text(input.id, 80, '');
    var sh = ctx.shared || {}, reps = repsOf(sh)[key], rp = reps && reps[id];
    var list = recsOf(sh)[key] || [], e = null, rank = 0;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) { e = list[i]; rank = i + 1; }
    if (!rp || !e) return { result: { ok: false, error: 'noReplay' } };
    return { result: { ok: true, key: key, rp: rp, entry: { id: e.id, name: e.name, t: e.t, car: e.car, rank: rank } } };
  },

  // 跑完一趟：伺服器依賽道長度與完成時間算分，累加到積分，並更新個人最佳與賽道前 15 名
  // input：{ track, dir, time (毫秒), car, hits, top, mode: 'solo' | 'multi', place, players, now }
  submitRun: function (state, input, ctx) {
    var st = fresh(state);
    input = input || {};
    // 舊版遊戲 (過起點線才計時) 的成績不收，免得和新規則的紀錄混在一起
    if (Number(input.rv) !== REC_V) return { result: { ok: false, error: 'oldVersion' } };
    var tr = TRACKS[input.track];
    if (!tr) return { result: { ok: false, error: 'badTrack' } };
    var dir = input.dir === -1 || input.dir === '-1' ? -1 : 1;
    var ms = Math.round(Number(input.time));
    // 平均時速不可能高於約 300 km/h，也不收超過 3 小時的成績
    if (!(ms >= (tr.len / 84) * 1000) || ms > 3 * 3600 * 1000) return { result: { ok: false, error: 'badTime' } };
    var key = input.track + ':' + dir;
    var now = nowOf(input);
    var avg = (tr.len / (ms / 1000)) * 3.6;
    var hits = int(input.hits, 0, 999, 0);
    var players = int(input.players, 1, 4, 1), place = int(input.place, 0, 4, 0);
    var multi = input.mode === 'multi' && players >= 2;
    var car = CARS[input.car] ? input.car : 'k8';

    // ---- 個人最佳
    var prev = st.best[key];
    var isPB = !(prev <= ms);
    if (isPB) st.best[key] = ms;

    // ---- 賽道前 15 名 (每位玩家只留最佳一筆)
    var sh = ctx.shared || {}, all = recsOf(sh), old = all[key] || [];
    var mine = null, i;
    for (i = 0; i < old.length; i++) if (old[i].id === ctx.player.id) mine = old[i];
    var list = old, rank = 0, changed = false;
    if (!mine || ms < mine.t) {
      list = [];
      for (i = 0; i < old.length; i++) if (old[i].id !== ctx.player.id) list.push(old[i]);
      list.push({ id: ctx.player.id, name: nameOf(ctx), t: ms, car: car, at: now });
      list.sort(function (a, b) { return a.t - b.t; });
      if (list.length > TOP_N) list = list.slice(0, TOP_N);
      for (i = 0; i < list.length; i++) if (list[i].id === ctx.player.id) rank = i + 1;
      changed = rank > 0;
      if (!changed) list = old;
    }

    // ---- 積分：完成距離 x 速度倍率 x (1 + 加成)
    var base = (tr.len / 1000) * 100;
    var speedF = Math.max(0.3, Math.min(2.2, avg / 80));
    var parts = [];
    var bonus = 0;
    if (hits === 0) { bonus += 0.15; parts.push(['零碰撞', 15]); }
    else { var pen = Math.min(30, hits * 3); bonus -= pen / 100; parts.push(['碰撞 ' + hits + ' 次', -pen]); }
    if (multi && place === 1) { bonus += 0.3; parts.push(['多人第 1 名', 30]); }
    else if (multi && place === 2) { bonus += 0.15; parts.push(['多人第 2 名', 15]); }
    else if (multi && place === 3) { bonus += 0.05; parts.push(['多人第 3 名', 5]); }
    if (isPB && prev) { bonus += 0.1; parts.push(['刷新個人最佳', 10]); }
    if (changed && rank === 1) { bonus += 0.5; parts.push(['賽道紀錄保持人', 50]); }
    else if (changed && rank <= BONUS_N) { bonus += 0.2; parts.push(['進入賽道前 5 名', 20]); }
    var score = Math.max(1, Math.round(base * speedF * (1 + bonus)));

    st.total += score;
    st.runs += 1;
    var out = {
      state: st,
      result: {
        ok: true, key: key, time: ms, score: score, total: st.total, runs: st.runs, avg: Math.round(avg * 10) / 10,
        base: Math.round(base), speedF: Math.round(speedF * 100) / 100, parts: parts,
        isPB: isPB, pb: st.best[key], rank: rank, records: list
      }
    };
    if (changed) {
      var rec = {};
      for (var k in all) rec[k] = all[k];
      rec[key] = list;
      // 重播：自己這一筆換成這次跑的 (這次沒有就刪掉舊的，舊的已經不是這個成績了)；
      // 其他人的照舊，被擠出前 15 名的由 fit() 清掉
      var oldReps = repsOf(sh), reps = {}, cur = oldReps[key] || {}, mineReps = {};
      for (var rk in oldReps) reps[rk] = oldReps[rk];
      for (var pid in cur) if (pid !== ctx.player.id) mineReps[pid] = cur[pid];
      var rp = REPLAY[input.track] ? cleanReplay(input.rp, ms) : null;
      if (rp) mineReps[ctx.player.id] = rp;
      reps[key] = mineReps;
      out.shared = fit({ records: rec, rooms: sh.rooms || {}, replays: reps });
      out.result.records = out.shared.records[key];
      out.result.replay = !!(out.shared.replays[key] && out.shared.replays[key][ctx.player.id]);
    }
    return out;
  },

  // ---- 多人房間登記簿 (房名、賽道、碰撞設定等；實際連線由房間腳本 server/room.js 處理)
  rooms: function (state, input, ctx) {
    var now = nowOf(input), sh = ctx.shared || {}, list = [];
    var rooms = copyRooms(sh.rooms, now);
    for (var id in rooms) list.push(rooms[id]);
    list.sort(function (a, b) { return b.t - a.t; });
    return { result: { ok: true, now: now, rooms: list } };
  },

  // 房主建立 / 更新自己房間的登記 (同時也是心跳)
  roomSet: function (state, input, ctx) {
    input = input || {};
    var id = text(input.id, 64, '');
    if (!id) return { result: { ok: false, error: 'badRoom' } };
    var now = nowOf(input), sh = ctx.shared || {};
    var rooms = copyRooms(sh.rooms, now);
    var cur = rooms[id];
    // 別人的房間不能改 (房主換人時，舊登記過期或由新房主接手)
    if (cur && cur.hostId !== ctx.player.id && Math.abs(now - cur.t) < 20000) return { result: { ok: false, error: 'notHost' } };
    rooms[id] = {
      id: id,
      name: text(input.name, 20, nameOf(ctx) + ' 的房間'),
      host: nameOf(ctx), hostId: ctx.player.id,
      track: TRACKS[input.track] && !TRACKS[input.track].solo ? input.track : 'sprint',
      dir: input.dir === -1 ? -1 : 1,
      env: ENVS[input.env] ? input.env : 'sunny',
      collide: input.collide !== false,
      n: int(input.n, 1, 4, 1), max: 4,
      phase: input.phase === 'race' ? 'race' : 'lobby',
      t: now
    };
    // 上限：留最新的 ROOM_MAX 間
    var ids = [];
    for (var k in rooms) ids.push(k);
    if (ids.length > ROOM_MAX) {
      ids.sort(function (a, b) { return rooms[b].t - rooms[a].t; });
      var keep = {};
      for (var i = 0; i < ROOM_MAX; i++) keep[ids[i]] = rooms[ids[i]];
      rooms = keep;
    }
    return { shared: fit({ records: recsOf(sh), rooms: rooms, replays: repsOf(sh) }), result: { ok: true, room: rooms[id] } };
  },

  // 移除房間登記：房主離開時，或其他玩家加入時發現房間已不存在 (gone)
  roomDel: function (state, input, ctx) {
    input = input || {};
    var id = text(input.id, 64, '');
    var sh = ctx.shared || {};
    if (!id || !sh.rooms || !sh.rooms[id]) return { result: { ok: true, removed: false } };
    var cur = sh.rooms[id];
    if (cur.hostId !== ctx.player.id && !input.gone) return { result: { ok: false, error: 'notHost' } };
    var rooms = {};
    for (var k in sh.rooms) if (k !== id) rooms[k] = sh.rooms[k];
    return { shared: fit({ records: recsOf(sh), rooms: rooms, replays: repsOf(sh) }), result: { ok: true, removed: true } };
  }
});
