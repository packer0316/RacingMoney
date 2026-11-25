// 山道猴王 — 本機模擬用的 GoldSaucer SDK (由 tools/dev_platform.js 注入，介面比照平台 SDK 1.18)
// 只給本機測試用，不會打包上傳；上架後由平台注入真正的 SDK。
(function () {
  'use strict';
  // 平台的相容層：沙箱 iframe (不透明來源) 裡瀏覽器不給用 localStorage / sessionStorage，平台會換成代管的版本。
  // 這裡用記憶體版代替 (重新整理就清空)。
  ['localStorage', 'sessionStorage'].forEach(function (name) {
    try { window[name].getItem('x'); return; } catch (e) { /* 被沙箱擋下 */ }
    var data = {};
    var shim = {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { data[k] = String(v); }, removeItem: function (k) { delete data[k]; },
      clear: function () { data = {}; }, key: function (i) { return Object.keys(data)[i] || null; },
    };
    Object.defineProperty(shim, 'length', { get: function () { return Object.keys(data).length; } });
    try { Object.defineProperty(window, name, { value: shim, configurable: true }); } catch (e) { /* ignore */ }
  });
  var q = new URLSearchParams(location.search);
  var guest = q.has('guest');
  var name = guest ? null : (q.get('user') || '測試玩家');
  var listeners = {};
  function GsError(code, message) { var e = new Error(message || code); e.code = code; return e; }
  function post(path, body) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (r) { if (!r.ok) throw GsError(r.code || 'error', r.message); return r.value; });
  }
  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h.toString(16); }
  var user = name ? { id: 'u_' + hash(name), username: name, displayName: name, avatarUrl: null } : null;

  function join(opts) {
    opts = opts || {};
    if (!name) return Promise.reject(GsError('unauthorized', '訪客不能加入多人房間'));
    return new Promise(function (resolve, reject) {
      var ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/__gs/room?user=' + encodeURIComponent(name) + '&room=' + encodeURIComponent(opts.room || ''));
      var room = null, closed = false, handlers = {}, closeCbs = [], errCbs = [], backlog = [], dirCbs = [];
      var sec = 0, cnt = 0, offset = null, clockT = null, clockSent = {}, clockId = 0;
      var timer = setTimeout(function () { if (!room) { fail(GsError('connectionTimeout', '連線逾時')); try { ws.close(); } catch (e) { /* ignore */ } } }, 10000);
      var settled = false;
      function fail(e) { if (settled) return; settled = true; clearTimeout(timer); reject(e); }
      function fire(type, data) {
        var hit = false;
        (handlers[type] || []).slice().forEach(function (cb) { hit = true; try { cb(data); } catch (e) { console.error(e); } });
        (handlers['*'] || []).slice().forEach(function (cb) { hit = true; try { cb(type, data); } catch (e) { console.error(e); } });
        return hit;
      }
      function end(reason) {
        if (closed) return;
        closed = true;
        clearInterval(clockT);
        closeCbs.slice().forEach(function (cb) { try { cb(reason); } catch (e) { console.error(e); } });
      }
      if (opts.signal) opts.signal.addEventListener('abort', function () { if (!room) { fail(GsError('aborted', '已取消')); try { ws.close(); } catch (e) { /* ignore */ } } });
      ws.onerror = function () { if (!room) fail(GsError('connectionFailed', '無法連線')); };
      ws.onclose = function () { if (!room) fail(GsError('connectionFailed', '無法連線')); else end('disconnected'); };
      ws.onmessage = function (ev) {
        var m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === 'error') {
          if (!room) { fail(GsError(m.code, m.message)); return; }
          errCbs.slice().forEach(function (cb) { try { cb(GsError(m.code, m.message)); } catch (e) { console.error(e); } });
          return;
        }
        if (m.t === 'joined') {
          room = {
            id: m.roomId, you: m.you, realtime: null,
            send: function (type, data) {
              if (closed || ws.readyState !== WebSocket.OPEN) return;
              if (typeof type !== 'string' || !type || type.length > 64) throw GsError('badMessage', 'Message type must contain 1–64 characters');
              var raw = JSON.stringify({ t: 'msg', type: type, data: data === undefined ? null : data });
              if (raw.length > 8 * 1024) throw GsError('tooLarge', 'Message exceeds 8 KB');
              var s = Math.floor(performance.now() / 1000);
              if (s !== sec) { sec = s; cnt = 0; }
              if (cnt >= 20) throw GsError('rateLimited', 'Ordinary messages are limited to 20 per second');
              ws.send(raw); cnt++;
            },
            on: function (type, cb) {
              (handlers[type] = handlers[type] || []).push(cb);
              // 註冊前就收到的訊息：補送
              for (var i = 0; i < backlog.length;) {
                var b = backlog[i];
                if (type === '*' || b.type === type) { backlog.splice(i, 1); try { type === '*' ? cb(b.type, b.data) : cb(b.data); } catch (e) { console.error(e); } } else i++;
              }
              return function () { var a = handlers[type] || [], k = a.indexOf(cb); if (k >= 0) a.splice(k, 1); };
            },
            onClose: function (cb) { closeCbs.push(cb); return function () { var k = closeCbs.indexOf(cb); if (k >= 0) closeCbs.splice(k, 1); }; },
            onError: function (cb) { errCbs.push(cb); return function () { var k = errCbs.indexOf(cb); if (k >= 0) errCbs.splice(k, 1); }; },
            leave: function () { if (closed) return; try { ws.send(JSON.stringify({ t: 'leave' })); } catch (e) { /* ignore */ } end('left'); try { ws.close(); } catch (e) { /* ignore */ } },
            watchDirectory: function (cb) {
              dirCbs.push(cb);
              var ask = function () { if (!closed && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'directory', op: 'watch' })); };
              ask();
              var t = setInterval(ask, 2000);
              return function () { clearInterval(t); var k = dirCbs.indexOf(cb); if (k >= 0) dirCbs.splice(k, 1); };
            },
            invite: function () { return Promise.resolve({ ok: false }); },
            getNetworkStats: function () { return { rttMs: null, jitterMs: null, bufferedBytes: ws.bufferedAmount }; },
            serverNow: function () { return offset === null ? null : performance.now() + offset; },
          };
          var ping = function () { if (closed || ws.readyState !== WebSocket.OPEN) return; var id = ++clockId; clockSent[id] = performance.now(); ws.send(JSON.stringify({ t: 'clock', requestId: id })); };
          ping(); clockT = setInterval(ping, 1000);
          settled = true; clearTimeout(timer);
          resolve(room);
          return;
        }
        if (!room) return;
        if (m.t === 'clock') {
          var t0 = clockSent[m.requestId];
          delete clockSent[m.requestId];
          if (t0 !== undefined) { var now = performance.now(); offset = m.serverTime + (now - t0) / 2 - now; }
          return;
        }
        if (m.t === 'directory') { dirCbs.slice().forEach(function (cb) { try { cb(m); } catch (e) { console.error(e); } }); return; }
        if (m.t === 'closed') { end(m.reason || 'closed'); return; }
        if (m.t === 'msg') { if (!fire(m.type, m.data)) { backlog.push({ type: m.type, data: m.data }); if (backlog.length > 500) backlog.shift(); } }
      };
    });
  }

  window.GoldSaucer = {
    version: 'dev-1.18.0', __dev: true,
    init: function () {
      return Promise.resolve({ user: user, game: { id: 'dev', title: '山道猴王' }, balance: 0, multiplayer: true, trial: !user, preview: false, audio: { music: 1, sfx: 1, muted: false }, invite: null });
    },
    getUser: function () { return Promise.resolve(user); },
    saves: {
      get: function (key) { return post('/__gs/save', { user: name, key: key }); },
      getJSON: function (key) { return post('/__gs/save', { user: name, key: key }).then(function (v) { try { return v === null ? null : JSON.parse(v); } catch (e) { return null; } }); },
      set: function (key, value) { return post('/__gs/save', { user: name, key: key, value: typeof value === 'string' ? value : JSON.stringify(value) }).then(function () { return true; }); },
    },
    scores: {
      submit: function (score) { return post('/__gs/score', { user: name, score: score }); },
      top: function (limit) { return fetch('/__gs/top?limit=' + (limit || 10)).then(function (r) { return r.json(); }).then(function (r) { return r.value; }); },
    },
    server: { call: function (fn, input) { return post('/__gs/call', { user: name, name: fn, input: input === undefined ? null : input }); } },
    multiplayer: { join: join },
    ui: {
      alert: function (o) { window.alert((o && (o.message || o.title)) || ''); return Promise.resolve(); },
      confirm: function (o) { return Promise.resolve(window.confirm((o && (o.message || o.title)) || '')); },
      prompt: function (o) { return Promise.resolve(window.prompt((o && (o.message || o.title)) || '', (o && o.defaultValue) || '')); },
      setLeaveMessage: function () { return Promise.resolve(); },
    },
    audio: { getSettings: function () { return Promise.resolve({ music: 1, sfx: 1, muted: false }); } },
    analytics: { track: function () { return Promise.resolve(); } },
    on: function (type, cb) { (listeners[type] = listeners[type] || []).push(cb); return function () { var a = listeners[type], k = a.indexOf(cb); if (k >= 0) a.splice(k, 1); }; },
  };
})();
