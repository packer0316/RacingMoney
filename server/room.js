// 山道猴王 — 多人房間腳本 (金碟遊樂場 GoldSaucer)
// 每個房間最多 4 人。流程：大廳 lobby → 載入 loading → 倒數 countdown (3、2、1、START) → 比賽 race → 結算後回到大廳。
// 車輛物理由各玩家自己的電腦計算，伺服器負責：房間設定、準備狀態、同步起跑、轉送車輛位置、收集完賽成績與排名。
//
// 玩家 → 伺服器
//   hello { car, color }                          進房後回報自己的車款 / 車色
//   cfg { name, track, dir, env, collide }        房主修改房間設定 (只在大廳)
//   ready { on }                                  準備 / 取消準備
//   start                                         房主開始比賽 (其他人都要已準備)
//   loaded                                        賽道載入完成
//   s [t, x, y, z, qx, qy, qz, qw, vx, vy, vz, wy, steer, flags, progress]   車輛狀態 (每秒約 12 次)
//   fin { t, g, top, hits }                       完賽：t = START 到終點線的賽道時間 (ms，遊戲內累計)、g = START 之後經過的實際時間 (ms)
//   quit                                          比賽途中放棄 (回到房間等下一場)
//   kick { id }                                   房主踢人 (只在大廳)
// 伺服器 → 玩家
//   welcome { you, k, host, cfg, players, phase } 進房時給自己
//   players { host, list }                        成員 / 準備狀態 / 房主有變
//   cfg { ... }                                   房間設定有變
//   load { cfg, grid, seq }                       開始載入；grid = 起跑位置
//   wait { loaded, total }                        載入進度
//   countdown { ms }                              收到後倒數 ms 毫秒起跑
//   s [k, ...]                                    其他玩家的車輛狀態 (k = 玩家編號 0~3)
//   fin { id, k, t, g, place }                    有人完賽
//   results { list, cfg, seq }                    全部結束 (或逾時)，房間回到大廳
//   err { code }                                  操作被拒絕

var TRACKS = { sprint: 2080, nine: 13270, pl_tc: 31630, xd_pl: 26490, full: 58120 };   // 計時區間長度 (m)
var ENVS = { sunny: 1, fog: 1, dusk: 1, night: 1, rain: 1 };
var CARS = { k8: 1, gr86: 1, ae86: 1, r34: 1, r35: 1, p911: 1 };
var MAX_PLAYERS = 4;
var LOAD_TIMEOUT = 90000;    // 載入最多等這麼久，逾時就不等了
var COUNTDOWN = 4000;        // 倒數長度：預備 1 秒 + 3、2、1 各 1 秒
var RACE_MAX = 60 * 60000;   // 一場最長 60 分鐘

var REF = {};                // 玩家 id → 平台的 player 物件 (room.send 要用)

function num(v, lo, hi, d) {
  v = Number(v);
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
function cleanCfg(input, cur, hostName) {
  input = input || {};
  return {
    name: text(input.name, 20, cur.name || (hostName + ' 的房間')),
    track: TRACKS[input.track] ? input.track : cur.track,
    dir: input.dir === -1 ? -1 : input.dir === 1 ? 1 : cur.dir,
    env: ENVS[input.env] ? input.env : cur.env,
    collide: typeof input.collide === 'boolean' ? input.collide : cur.collide
  };
}
function list(room) {
  var st = room.state, out = [];
  for (var i = 0; i < st.order.length; i++) {
    var p = st.ps[st.order[i]];
    if (p) out.push({ id: p.id, k: p.k, name: p.name, avatar: p.avatar, car: p.car, color: p.color, ready: p.ready, racing: p.racing });
  }
  return out;
}
function sendPlayers(room) { room.broadcast('players', { host: room.state.host, list: list(room) }); }
function count(room) { return room.state.order.length; }

function toLobby(room) {
  var st = room.state;
  st.phase = 'lobby'; st.race = null;
  for (var id in st.ps) { st.ps[id].ready = false; st.ps[id].racing = false; st.ps[id].loaded = false; }
  room.unlock();
}

// 比賽結束：依 START 之後經過的時間排名，沒跑完的排在後面
function endRace(room) {
  var st = room.state, r = st.race;
  if (!r) return;
  var rows = [];
  for (var id in r.who) {
    var w = r.who[id];
    rows.push({ id: id, k: w.k, name: w.name, car: w.car, t: w.t || 0, g: w.g || 0, top: w.top || 0, dnf: !w.done, left: !st.ps[id] });
  }
  rows.sort(function (a, b) { return a.dnf !== b.dnf ? (a.dnf ? 1 : -1) : a.g - b.g; });
  for (var i = 0; i < rows.length; i++) rows[i].place = rows[i].dnf ? 0 : i + 1;
  var cfg = r.cfg, seq = r.seq;
  toLobby(room);
  room.broadcast('results', { list: rows, cfg: cfg, seq: seq });
  sendPlayers(room);
}

function checkRaceOver(room) {
  var st = room.state, r = st.race;
  if (!r) return;
  var left = 0;
  for (var id in r.who) if (!r.who[id].done && !r.who[id].out && st.ps[id]) left++;
  if (left === 0) endRace(room);
}

function startCountdown(room) {
  var st = room.state;
  st.phase = 'countdown';
  st.race.cdAt = st.clock;
  room.broadcast('countdown', { ms: COUNTDOWN });
}

function checkLoaded(room) {
  var st = room.state, r = st.race;
  if (!r || st.phase !== 'loading') return;
  var total = 0, ok = 0;
  for (var id in r.who) if (st.ps[id]) { total++; if (st.ps[id].loaded) ok++; }
  if (total === 0) { toLobby(room); return; }
  room.broadcast('wait', { loaded: ok, total: total });
  if (ok >= total) startCountdown(room);
}

defineRoom({
  maxPlayers: MAX_PLAYERS,
  tickRate: 10,

  onCreate: function (room) {
    var st = room.state;
    st.phase = 'lobby';
    st.clock = 0;                 // 房間開啟後經過的毫秒數 (由 onTick 累加)
    st.cfg = { name: '', track: 'sprint', dir: 1, env: 'sunny', collide: true };
    st.host = null;
    st.ps = {};                   // id → { id, k, name, avatar, car, color, ready, racing, loaded }
    st.order = [];                // 進房順序
    st.seq = 0;                   // 第幾場比賽
    st.race = null;
  },

  onJoin: function (room, player) {
    var st = room.state;
    // 比賽中不收人 (正常情況下房間已上鎖)；超過 4 人也不收
    if (st.phase !== 'lobby' || count(room) >= MAX_PLAYERS) {
      room.send(player, 'err', { code: st.phase !== 'lobby' ? 'racing' : 'full' });
      room.kick(player);
      return;
    }
    var used = {}, k = 0, id;
    for (id in st.ps) used[st.ps[id].k] = 1;
    while (used[k]) k++;
    REF[player.id] = player;
    st.ps[player.id] = { id: player.id, k: k, name: text(player.name, 24, '玩家'), avatar: player.avatarUrl || null, car: 'k8', color: 0, ready: false, racing: false, loaded: false };
    st.order.push(player.id);
    if (!st.host || !st.ps[st.host]) st.host = player.id;
    if (!st.cfg.name) st.cfg.name = st.ps[st.host].name + ' 的房間';
    room.send(player, 'welcome', { you: player.id, k: k, host: st.host, cfg: st.cfg, players: list(room), phase: st.phase });
    sendPlayers(room);
  },

  onLeave: function (room, player) {
    var st = room.state, id = player.id;
    if (!st.ps[id]) return;
    delete st.ps[id];
    delete REF[id];
    var order = [];
    for (var i = 0; i < st.order.length; i++) if (st.order[i] !== id) order.push(st.order[i]);
    st.order = order;
    if (order.length === 0) {
      // 沒人了：回到初始狀態 (空房 30 秒後由平台回收)
      st.host = null;
      st.cfg.name = '';
      toLobby(room);
      return;
    }
    if (st.host === id) st.host = order[0];   // 房主離開：最早進房的人接手
    sendPlayers(room);
    if (st.phase === 'loading') checkLoaded(room);
    else if (st.phase === 'race' || st.phase === 'countdown') checkRaceOver(room);
  },

  onMessage: function (room, player, type, data) {
    var st = room.state, me = st.ps[player.id];
    if (!me) return;

    // ---- 車輛狀態：直接轉送給其他人 (最頻繁，放最前面)
    if (type === 's') {
      if (st.phase !== 'race' && st.phase !== 'countdown') return;
      if (!me.racing || !data || typeof data.length !== 'number' || data.length < 8 || data.length > 20) return;
      var out = [me.k];
      for (var i = 0; i < data.length; i++) { var v = Number(data[i]); out.push(v === v ? v : 0); }
      room.broadcast('s', out, { except: player });
      return;
    }

    if (type === 'hello') {
      data = data || {};
      if (CARS[data.car]) me.car = data.car;
      me.color = Math.round(num(data.color, 0, 31, 0));
      sendPlayers(room);
      return;
    }

    if (type === 'cfg') {
      if (player.id !== st.host || st.phase !== 'lobby') return;
      st.cfg = cleanCfg(data, st.cfg, me.name);
      room.broadcast('cfg', st.cfg);
      return;
    }

    if (type === 'ready') {
      if (st.phase !== 'lobby') return;
      me.ready = !!(data && data.on);
      sendPlayers(room);
      return;
    }

    if (type === 'kick') {
      if (player.id !== st.host || st.phase !== 'lobby' || !data || data.id === st.host) return;
      var target = REF[data.id];
      if (target && st.ps[data.id]) { room.send(target, 'err', { code: 'kicked' }); room.kick(target); }
      return;
    }

    if (type === 'start') {
      if (player.id !== st.host || st.phase !== 'lobby') return;
      var id;
      for (id in st.ps) if (id !== st.host && !st.ps[id].ready) { room.send(player, 'err', { code: 'notReady' }); return; }
      room.lock();
      st.seq++;
      st.phase = 'loading';
      // 起跑位置：一排並排，房主在最外側，其餘依進房順序往內排
      var grid = [], who = {}, slot = 0;
      for (var j = 0; j < st.order.length; j++) {
        var p = st.ps[st.order[j]];
        p.racing = true; p.loaded = false;
        grid.push({ id: p.id, k: p.k, slot: slot, name: p.name, car: p.car, color: p.color });
        who[p.id] = { k: p.k, name: p.name, car: p.car, done: false };
        slot++;
      }
      var c = st.cfg;
      st.race = { seq: st.seq, cfg: { name: c.name, track: c.track, dir: c.dir, env: c.env, collide: c.collide }, who: who, loadAt: st.clock, cdAt: 0, goAt: 0, endAt: 0, fins: 0 };
      room.broadcast('load', { cfg: st.race.cfg, grid: grid, seq: st.seq, n: grid.length });
      sendPlayers(room);
      return;
    }

    if (type === 'loaded') {
      if (st.phase !== 'loading' || !me.racing) return;
      me.loaded = true;
      checkLoaded(room);
      return;
    }

    if (type === 'quit') {
      var rq = st.race;
      if (!rq || !rq.who[player.id] || rq.who[player.id].done) return;
      rq.who[player.id].out = true;
      me.racing = false;
      if (st.phase === 'loading') { me.loaded = true; checkLoaded(room); }
      else checkRaceOver(room);
      return;
    }

    if (type === 'fin') {
      var r = st.race;
      if (st.phase !== 'race' || !r || !r.who[player.id] || r.who[player.id].done || r.who[player.id].out) return;
      data = data || {};
      var elapsed = st.clock - r.goAt;
      var minMs = (TRACKS[r.cfg.track] / 84) * 1000;      // 平均時速不可能超過約 300 km/h
      var t = Math.round(num(data.t, 0, RACE_MAX, 0));
      if (t < minMs || t > elapsed + 5000) { room.send(player, 'err', { code: 'badTime' }); return; }
      var g = Math.round(num(data.g, t, elapsed + 5000, elapsed));
      var w = r.who[player.id];
      w.done = true; w.t = t; w.g = g; w.top = Math.round(num(data.top, 0, 999, 0));
      var place = 1;
      for (var id2 in r.who) if (id2 !== player.id && r.who[id2].done && r.who[id2].g <= g) place++;
      w.place = place;
      r.fins++;
      room.broadcast('fin', { id: player.id, k: w.k, t: t, g: g, place: place });
      if (r.fins === 1) {
        // 第一個人到終點後，其他人還有一段時間可以跑完 (逾時算未完賽)
        var grace = g * 0.5;
        if (grace < 30000) grace = 30000;
        if (grace > 180000) grace = 180000;
        r.endAt = st.clock + grace;
        room.broadcast('grace', { ms: Math.round(grace) });
      }
      checkRaceOver(room);
      return;
    }
  },

  onTick: function (room, dtMs) {
    var st = room.state;
    st.clock += dtMs;
    var r = st.race;
    if (!r) return;
    if (st.phase === 'loading') {
      if (st.clock - r.loadAt > LOAD_TIMEOUT) startCountdown(room);
    } else if (st.phase === 'countdown') {
      if (st.clock - r.cdAt >= COUNTDOWN) { st.phase = 'race'; r.goAt = st.clock; }
    } else if (st.phase === 'race') {
      if ((r.endAt && st.clock >= r.endAt) || st.clock - r.goAt > RACE_MAX) endRace(room);
    }
  }
});
