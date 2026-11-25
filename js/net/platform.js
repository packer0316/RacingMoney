'use strict';
// 平台串接 (金碟遊樂場 GoldSaucer)：玩家身分、伺服器函式 (賽道紀錄 / 積分 / 多人房間登記)、平台排行榜
//
//   mode = 'platform'：在平台上且已登入 — 紀錄、積分、多人連線都走平台
//          'guest'   ：在平台上但未登入 — 可以試玩，成績不會記錄
//          'local'   ：直接開 index.html (沒有平台 SDK) — 同一套計分規則在本機執行，資料存在瀏覽器裡，沒有多人連線
(function () {
  const RM = (window.RM = window.RM || {});
  const LS_STATE = 'rm_fn_state', LS_SHARED = 'rm_fn_shared';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'timeout' })), ms))]);
  const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 儲存空間不可用 */ } };

  const P = {
    mode: 'local', sdk: null, user: null, invite: null, canScore: false,
    profile: { id: null, total: 0, runs: 0, best: {}, records: {} },
    _ls: [], _q: Promise.resolve(), _defs: null, ready: null,

    on(fn) { this._ls.push(fn); return () => { const k = this._ls.indexOf(fn); if (k >= 0) this._ls.splice(k, 1); }; },
    emit(type, data) { for (const fn of this._ls.slice()) { try { fn(type, data); } catch (e) { console.error(e); } } },
    get name() { const u = this.user; return u ? u.displayName || u.username || '玩家' : this.mode === 'local' ? '我' : '訪客'; },
    get canMulti() { return this.mode === 'platform' && !!(this.sdk && this.sdk.multiplayer); },
    key(section, dir) { return section + ':' + (dir < 0 ? -1 : 1); },
    // 個人最佳 (秒)；沒有紀錄回傳 NaN
    best(section, dir) { const ms = this.profile.best[this.key(section, dir)]; return ms > 0 ? ms / 1000 : NaN; },
    // 賽道前 15 名 (伺服器 server/functions.js 的 TOP_N)：[{ id, name, t (毫秒), car, r (1 = 有重播) }]
    records(section, dir) { return this.profile.records[this.key(section, dir)] || []; },
    // profile 回傳的紀錄是陣列 [id, 名字, 毫秒, 車款, 有重播] (省空間)；舊格式 (物件) 照用
    _rows(all) {
      const out = {};
      for (const k in all || {}) out[k] = (all[k] || []).map((x) => (Array.isArray(x) ? { id: x[0], name: x[1], t: x[2], car: x[3], r: x[4] ? 1 : 0 } : x));
      return out;
    },

    init() {
      if (!this.ready) this.ready = this._init();
      return this.ready;
    },
    async _init() {
      const gs = window.GoldSaucer;
      if (gs && typeof gs.init === 'function') {
        try {
          const info = await timeout(gs.init(), 10000);
          this.sdk = gs;
          this.user = (info && info.user) || null;
          this.invite = (info && info.invite) || null;
          this.mode = this.user ? 'platform' : 'guest';
          if (gs.on) gs.on('userChanged', (u) => { this.user = u || null; this.mode = this.user ? 'platform' : 'guest'; this.canScore = !!this.user; this.refresh(); });
        } catch (e) { console.warn('GoldSaucer.init 失敗，改用單機模式', e); }
      }
      if (this.mode === 'platform') this.canScore = true;
      else if (this.mode === 'local') this.canScore = await this._loadLocal();
      await this.refresh();
      this.emit('ready');
    },

    // 單機模式：直接在瀏覽器裡執行 server/functions.js (和平台上同一份計分規則)
    _loadLocal() {
      return new Promise((resolve) => {
        const prev = window.defineFunctions;
        window.defineFunctions = (defs) => { this._defs = defs; };
        const s = document.createElement('script');
        s.src = 'server/functions.js';
        s.onload = () => { window.defineFunctions = prev; resolve(!!this._defs); };
        s.onerror = () => { window.defineFunctions = prev; resolve(false); };
        document.head.appendChild(s);
      });
    },
    _localCall(name, input) {
      const defs = this._defs;
      if (!defs || typeof defs[name] !== 'function') throw Object.assign(new Error('notFound'), { code: 'notFound' });
      const ctx = { player: { id: 'local', username: 'me', displayName: '我' }, chips: 0, currency: null, shared: lsGet(LS_SHARED), random: Math.random, randomInt: (a, b) => a + Math.floor(Math.random() * (b - a + 1)) };
      let state = lsGet(LS_STATE);
      if (state === null) state = defs.init ? defs.init(ctx) : {};
      const out = defs[name](state, input, ctx) || {};
      if (out.state !== undefined) lsSet(LS_STATE, out.state);
      if (out.shared !== undefined) lsSet(LS_SHARED, out.shared);
      return { result: out.result === undefined ? null : JSON.parse(JSON.stringify(out.result)) };
    },

    // 呼叫伺服器函式。平台規定同一位玩家同時只能有一個呼叫，所以這裡排隊依序送出；共用資料寫入衝突 (conflict) 時自動重試
    call(name, input) {
      const run = async () => {
        const body = Object.assign({ now: Date.now() }, input || {});
        if (this.mode !== 'platform') {
          if (this.mode === 'local' && this._defs) return this._localCall(name, body).result;
          throw Object.assign(new Error('unauthorized'), { code: 'unauthorized' });
        }
        let wait = 150;
        for (let i = 0; ; i++) {
          try {
            const r = await timeout(this.sdk.server.call(name, body), 15000);
            return r && r.result !== undefined ? r.result : r;
          } catch (e) {
            const code = e && e.code;
            if (i >= 5 || (code !== 'conflict' && code !== 'rateLimited')) throw e;
            await sleep(code === 'rateLimited' ? 2500 : wait + Math.random() * 120);
            wait *= 2;
          }
        }
      };
      const p = this._q.then(run, run);
      this._q = p.catch(() => {});
      return p;
    },

    // 讀取我的積分、個人最佳與所有賽道的前 15 名
    async refresh() {
      if (!this.canScore) { this.emit('profile'); return this.profile; }
      try {
        const r = await this.call('profile');
        if (r && r.ok) this.profile = { id: r.id, total: r.total || 0, runs: r.runs || 0, best: r.best || {}, records: this._rows(r.records) };
      } catch (e) { console.warn('讀取紀錄失敗', e); }
      this.emit('profile');
      return this.profile;
    },

    // 跑完一趟：送出成績 → 伺服器算分、累加積分、更新紀錄 → 把累計積分送到平台排行榜
    // run = { track, dir, time (毫秒), car, hits, top, mode: 'solo' | 'multi', place, players }
    async submitRun(run) {
      if (!this.canScore) return { ok: false, error: this.mode === 'guest' ? 'guest' : 'offline' };
      let r;
      try { r = await this.call('submitRun', run); } catch (e) { console.warn('送出成績失敗', e); return { ok: false, error: (e && e.code) || 'network' }; }
      if (!r || !r.ok) return r || { ok: false, error: 'network' };
      const pf = this.profile;
      pf.total = r.total; pf.runs = r.runs; pf.best[r.key] = r.pb; pf.records[r.key] = r.records;
      this.emit('profile');
      if (this.mode === 'platform' && this.sdk.scores) {
        // 平台排行榜保留每位玩家的最高分；積分只增不減，所以送累計值即可
        this.sdk.scores.submit(r.total).then(() => this.emit('board'), (e) => console.warn('排行榜送出失敗', e));
      }
      return r;
    },

    // 讀一筆重播 (js/game/replay.js)：{ ok, rp, entry { id, name, t, car, rank } } 或 { ok: false, error }
    async replay(section, dir, id) {
      if (!this.canScore) return { ok: false, error: this.mode === 'guest' ? 'guest' : 'offline' };
      try { return (await this.call('replay', { key: this.key(section, dir), id })) || { ok: false, error: 'network' }; }
      catch (e) { console.warn('讀取重播失敗', e); return { ok: false, error: (e && e.code) || 'network' }; }
    },

    // 平台排行榜 (累計積分)：[{ rank, displayName, score, me }]
    async top(limit) {
      if (this.sdk && this.sdk.scores) {
        try {
          const rows = (await timeout(this.sdk.scores.top(limit || 20), 10000)) || [];
          const me = this.user && this.user.username;
          return rows.map((x) => ({ rank: x.rank, name: x.displayName || x.username || '玩家', score: x.score, me: !!me && x.username === me }));
        } catch (e) { console.warn('讀取排行榜失敗', e); return null; }
      }
      return this.profile.total > 0 ? [{ rank: 1, name: '我', score: this.profile.total, me: true }] : [];
    },

    // ---- 多人房間登記簿 (房名、賽道、碰撞設定；讓其他玩家在列表上看得到)
    async roomList() { const r = await this.call('rooms'); return (r && r.rooms) || []; },
    roomSet(info) { return this.call('roomSet', info).catch((e) => { console.warn('房間登記失敗', e); return null; }); },
    roomDel(id, gone) { return this.call('roomDel', { id, gone: !!gone }).catch(() => null); },
    // 連進房間：room = 'new' (開新房) 或房號
    join(room, signal) {
      if (!this.canMulti) return Promise.reject(Object.assign(new Error('unauthorized'), { code: this.mode === 'local' ? 'offline' : 'unauthorized' }));
      return this.sdk.multiplayer.join({ room, signal });
    },
  };

  RM.Platform = P;
})();
