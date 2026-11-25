'use strict';
// 線上功能的介面：玩家積分、賽道紀錄 / 排行榜、多人房間 (列表、開房、房間面板)、比賽中的倒數 / 名次 / 名牌、結算
(function () {
  const RM = window.RM, $ = (id) => document.getElementById(id);
  const P = RM.Platform, Net = RM.Net;
  const G = () => RM.Game;
  // 多人房間能選的賽道 (北宜的路)；紀錄與排行多一條熱浪夏威夷 (只有個人計時賽、單向下坡)
  const ROOM_TRACKS = { sprint: '彎道衝刺', nine: '九彎十八拐', pl_tc: '坪林・頭城', xd_pl: '新店・坪林', full: '北宜全線' };
  const DRIFT = RM.DriftTrack.id;
  const TRACKS = { sprint: ROOM_TRACKS.sprint, [DRIFT]: RM.DriftTrack.section.name, nine: ROOM_TRACKS.nine, pl_tc: ROOM_TRACKS.pl_tc, xd_pl: ROOM_TRACKS.xd_pl, full: ROOM_TRACKS.full };
  const KM = { sprint: 2.1, nine: 13.3, pl_tc: 31.6, xd_pl: 26.5, full: 58.1 };
  const WEATHER = { sunny: '晴天', fog: '山霧', dusk: '黃昏', night: '夜晚', rain: '雨天' };
  const CARS = { k8: 'Civic K8', gr86: 'GR86', ae86: 'AE86', r34: 'GT-R R34', r35: 'GT-R R35', p911: '911 RS 2.7' };
  const ERR = {
    roomFull: '房間已滿，或比賽已經開始', roomNotFound: '房間已經關閉', connectionTimeout: '連線逾時，請再試一次', connectionFailed: '連不上遊戲伺服器',
    timeout: '連線逾時，請再試一次', unauthorized: '請先登入金碟遊樂場帳號', offline: '單機模式無法使用多人連線',
    notReady: '還有玩家沒按「準備」', kicked: '你被房主請出房間', racing: '比賽進行中，無法加入', full: '房間已滿',
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (ms) => RM.fmtTime(ms / 1000);
  const dirName = (d) => (d < 0 ? '往台北' : '往宜蘭');
  const dirOf = (track, d) => (track === DRIFT ? '單向下坡' : dirName(d));
  const oneWay = (track, d) => (track === DRIFT ? 1 : d);   // 熱浪夏威夷只有一個方向 (紀錄的 key 是 drift:1)
  const num = (n) => Math.round(n || 0).toLocaleString('en-US');
  const TOP_N = 15;   // 賽道紀錄的名次數，要和 server/functions.js 的 TOP_N 一致
  const setOn = (box, attr, val) => box.querySelectorAll('[' + attr + ']').forEach((b) => b.classList.toggle('on', b.getAttribute(attr) === String(val)));

  const O = {
    form: { track: 'sprint', dir: 1, env: 'sunny', collide: true }, formMode: 'create',
    board: { tab: 'rec', track: 'sprint', dir: 1 }, top: undefined,
    mpResults: false, _recKey: '', _toastT: 0, _rankT: 0, _tags: {}, _listT: null, _busy: false, _run: null, _invited: false,

    init() {
      // ---- 車庫上的入口
      $('profileBtn').addEventListener('click', () => this.openBoard('top'));
      $('recordsBtn').addEventListener('click', () => this.openBoard('rec', G().opts.section, G().opts.dir));
      $('mpBtn').addEventListener('click', () => this.openRooms());
      // ---- 紀錄與排行
      for (const id in TRACKS) { const b = document.createElement('button'); b.dataset.btrack = id; b.textContent = TRACKS[id]; $('boardTracks').append(b); }
      $('boardDialog').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.rid) { this.watch(this.board.track, this.board.dir, b.dataset.rid, b); return; }
        if (b.dataset.gid) { this.challenge(this.board.track, this.board.dir, b.dataset.gid, b); return; }
        if (b.dataset.tab) { this.board.tab = b.dataset.tab; if (b.dataset.tab === 'top') this.loadTop(); }
        else if (b.dataset.btrack) { this.board.track = b.dataset.btrack; this.board.dir = oneWay(this.board.track, this.board.dir); }
        else if (b.dataset.bdir) this.board.dir = +b.dataset.bdir;
        else return;
        this.renderBoard();
      });
      // ---- 多人連線：房間列表 + 開房 / 房間設定表單
      for (const id in ROOM_TRACKS) { const b = document.createElement('button'); b.type = 'button'; b.dataset.v = id; b.textContent = `${ROOM_TRACKS[id]} ${KM[id]} km`; $('roomTracks').append(b); }
      for (const [box, key, conv] of [['roomTracks', 'track', String], ['roomDirs', 'dir', Number], ['roomEnvs', 'env', String], ['roomCollide', 'collide', (v) => v === 'true']]) {
        $(box).addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (!b) return; this.form[key] = conv(b.dataset.v); this.renderForm(); });
      }
      $('roomsRefresh').addEventListener('click', () => this.loadRooms());
      $('roomList').addEventListener('click', (e) => { const b = e.target.closest('button.join'); if (b && !b.disabled) this.joinRoom(b.dataset.id, b); });
      // 注意：平台把遊戲放在沙箱 iframe 裡，表單送不出去 (submit 事件不會觸發)，所以不用 <form>，直接處理按鈕與 Enter
      $('roomCreate').addEventListener('click', () => this.submitForm());
      $('roomName').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); this.submitForm(); } });
      $('roomsDialog').addEventListener('close', () => { clearInterval(this._listT); this._listT = null; });
      // ---- 房間面板
      $('rpReady').addEventListener('click', () => {
        if (Net.isHost) Net.start();
        else { const me = Net.player(Net.me); Net.setReady(!(me && me.ready)); }
      });
      $('rpCfg').addEventListener('click', () => this.openRooms('edit'));
      $('rpLeave').addEventListener('click', () => Net.leave());
      $('rpPlayers').addEventListener('click', (e) => { const b = e.target.closest('button.kick'); if (b) Net.kick(b.dataset.id); });
      // ---- 比賽中 / 結算
      $('mpResume').addEventListener('click', () => $('mpMenu').classList.add('hidden'));
      $('mpQuit').addEventListener('click', () => this.quitRoom());
      // 多人比賽的結算畫面：「再跑一次 / 回到車庫」改成「回到房間 / 離開房間」(搶在 main.js 的處理之前)
      $('againBtn').addEventListener('click', (e) => { if (!this.mpResults) return; e.stopImmediatePropagation(); this.backToRoom(); }, true);
      $('resMenuBtn').addEventListener('click', (e) => { if (!this.mpResults) return; e.stopImmediatePropagation(); this.quitRoom(); }, true);
      $('resBody').addEventListener('click', (e) => { if (e.target.closest('.retry')) this.submit(); });

      P.on((type) => {
        if (type === 'profile' || type === 'ready') { this.renderProfile(); this.renderRecordLine(true); if ($('boardDialog').open) this.renderBoard(); }
        if (type === 'board' && $('boardDialog').open && this.board.tab === 'top') this.loadTop();
      });
      Net.on((type, data) => this.onNet(type, data));
      this.renderProfile();
      P.init();
      setInterval(() => this.tick(), 400);
    },

    toast(msg, ms) {
      const t = $('toast');
      t.textContent = msg; t.classList.remove('hidden');
      clearTimeout(this._toastT);
      this._toastT = setTimeout(() => t.classList.add('hidden'), ms || 3200);
    },

    // 每 0.4 秒：按鈕狀態、車庫上的賽道紀錄、從聊天室邀請進來時自動進房
    tick() {
      const g = G();
      if (!g) return;
      const menu = g.state === 'menu';
      $('mpBtn').disabled = !(menu && !$('startBtn').disabled) || Net.inRoom;
      if (menu) {
        this.renderRecordLine();
        if (!Net.racing) { $('mpHud').classList.add('hidden'); $('mpMenu').classList.add('hidden'); }
        if (!this._invited && P.invite && P.invite.room && P.canMulti && !$('startBtn').disabled) {
          this._invited = true;
          Net.join(P.invite.room).catch((e) => this.toast(ERR[e && e.code] || '無法加入受邀的房間'));
        }
      }
    },

    // ------------------------------------------------------------------ 車庫：玩家資訊、賽道紀錄
    renderProfile() {
      $('profileName').textContent = P.name;
      $('profileScore').textContent = P.canScore ? num(P.profile.total) + ' 分' : P.mode === 'guest' ? '未登入' : '';
    },
    renderRecordLine(force) {
      const g = G();
      if (!g) return;
      const o = g.opts, dir = oneWay(o.section, o.dir), key = P.key(o.section, dir);
      const recs = P.records(o.section, dir);
      const sig = key + '|' + (recs[0] ? recs[0].t + recs[0].name : '');
      if (!force && sig === this._recKey) return;
      this._recKey = sig;
      $('recordsBtn').classList.toggle('none', !recs.length);
      $('recordName').textContent = recs.length ? recs[0].name : P.mode === 'guest' ? '登入後顯示紀錄' : '虛位以待，來當第一位！';
      $('recordTime').textContent = recs.length ? fmt(recs[0].t) : '';
    },

    // ------------------------------------------------------------------ 紀錄與排行
    openBoard(tab, track, dir) {
      this.board.tab = tab || 'rec';
      if (track) { this.board.track = TRACKS[track] ? track : 'sprint'; this.board.dir = dir; }
      else { this.board.track = TRACKS[G().opts.section] ? G().opts.section : 'sprint'; this.board.dir = G().opts.dir; }
      this.board.dir = oneWay(this.board.track, this.board.dir);
      this.renderBoard();
      if (!$('boardDialog').open) $('boardDialog').showModal();
      P.refresh();
      if (this.board.tab === 'top') this.loadTop();
    },
    async loadTop() {
      this.top = undefined; this.renderBoard();
      this.top = await P.top(20);
      this.renderBoard();
    },
    // 賽道紀錄的列：有紀錄的依序列出 (最多 max 名)，名額沒滿就在後面留一列「虛位以待」。
    // withMe：只列前 max 名時，自己排在後面 (前 15 名內) 就再補一列自己的名次 (結算畫面用，避免清單太長)
    // watch：有重播的賽道 (js/game/replay.js) 在時間右邊加 ▶ 看重播 (紀錄視窗用)
    recRows(track, dir, max, withMe, watch) {
      const recs = P.records(track, dir).slice(0, TOP_N), rows = [], me = P.profile.id;
      const rv = watch && RM.Replay && RM.Replay.has(track);
      // ▶ 看重播、「挑戰」= 和這筆紀錄的幽靈車一起跑 (都要有重播)
      const btn = (r) => (!rv ? '' : r.r
        ? `<button class="rv-watch" data-rid="${esc(r.id)}" title="看重播" aria-label="看 ${esc(r.name)} 的重播">▶</button><button class="rv-watch rv-ghost" data-gid="${esc(r.id)}" title="和這筆紀錄的幽靈車一起跑" aria-label="挑戰 ${esc(r.name)} 的紀錄">挑戰</button>`
        : '<span class="rv-watch none" title="這筆紀錄沒有重播"></span><span class="rv-watch rv-ghost none"></span>');
      const row = (r, i) => `<li class="${r.id === me ? 'me' : ''}"><span class="no">${i + 1}</span><span class="nm">${esc(r.name)}<small>${esc(CARS[r.car] || '')}</small></span><span class="val">${fmt(r.t)}</span>${btn(r)}</li>`;
      const n = Math.min(max, recs.length);
      for (let i = 0; i < n; i++) rows.push(row(recs[i], i));
      const mine = withMe ? recs.findIndex((r) => r.id === me) : -1;
      if (mine >= n) rows.push('<li class="empty gap"><span class="nm">⋯</span></li>', row(recs[mine], mine));
      else if (n < max && recs.length < TOP_N) rows.push(`<li class="empty"><span class="no">${n + 1}</span><span class="nm">${recs.length ? '虛位以待' : '還沒有人留下紀錄，來當第一位！'}</span></li>`);
      return rows.join('');
    },
    // ▶ 看重播：向伺服器拿這筆紀錄的重播，關掉對話框，換成那筆紀錄的賽道 / 車款 / 車色載入播放 (main.js startReplay)
    async watch(track, dir, id, btn) {
      const r = await this._loadReplay(track, dir, id, btn, '看重播');
      if (!r) return;
      $('boardDialog').close();
      const ok = await G().startReplay(r.rp, r.info);
      if (!ok) this.toast('這筆重播無法播放');
    },
    // 挑戰：和這筆紀錄的幽靈車一起跑 (main.js startChallenge)；用自己的車，成績照常計算
    async challenge(track, dir, id, btn) {
      const r = await this._loadReplay(track, dir, id, btn, '挑戰');
      if (!r) return;
      $('boardDialog').close();
      const ok = await G().startChallenge(r.rp, r.info);
      if (!ok) this.toast('這筆紀錄無法挑戰');
    },
    // 向伺服器拿一筆紀錄的重播：{ rp, info { track, dir, id, name, car, t, rank } }；不能用就提示並回傳 null
    async _loadReplay(track, dir, id, btn, what) {
      const g = G();
      if (Net.inRoom) { this.toast(`在多人房間裡不能${what}，請先離開房間`); return null; }
      if (!g || g.state !== 'menu' || this._busy) return null;
      if ($('startBtn').disabled) { this.toast('車庫還在準備中，請稍候再按'); return null; }
      this._busy = true;
      const label = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = '…'; }
      const res = await P.replay(track, dir, id);
      this._busy = false;
      if (btn) { btn.disabled = false; btn.textContent = label; }
      if (!res || !res.ok || !res.rp) {
        this.toast(res && res.error === 'noReplay' ? '這筆紀錄的重播已經不在了（名次可能剛被刷新）' : '重播讀取失敗，請再試一次');
        if (res && res.error === 'noReplay') P.refresh();
        return null;
      }
      if (G().state !== 'menu') return null;
      const e = res.entry || {};
      return { rp: res.rp, info: { track, dir, id, name: e.name, car: e.car, t: e.t, rank: e.rank } };
    },
    renderBoard() {
      const b = this.board;
      setOn($('boardDialog').querySelector('.tabs'), 'data-tab', b.tab);
      $('boardRec').hidden = b.tab !== 'rec'; $('boardTop').hidden = b.tab !== 'top';
      if (b.tab === 'rec') {
        setOn($('boardTracks'), 'data-btrack', b.track); setOn($('boardDialog').querySelector('.board-dirs'), 'data-bdir', b.dir);
        $('boardDialog').querySelector('.board-dirs').style.display = b.track === DRIFT ? 'none' : '';   // 單向賽道不用選方向 (.opts 的 display 會蓋掉 hidden 屬性)
        $('boardRecList').innerHTML = this.recRows(b.track, b.dir, TOP_N, false, true);
        const pb = P.best(b.track, b.dir);
        $('boardMine').textContent = !P.canScore ? (P.mode === 'guest' ? '登入金碟遊樂場帳號後，成績才會列入紀錄。' : '')
          : pb > 0 ? `我的最佳：${RM.fmtTime(pb)}（${TRACKS[b.track]}・${dirOf(b.track, b.dir)}）` : '我還沒跑過這條賽道。';
      } else {
        const rows = this.top;
        $('boardTopList').innerHTML = rows === undefined ? '<li class="empty"><span class="nm">讀取中…</span></li>'
          : rows === null ? '<li class="empty"><span class="nm">排行榜讀取失敗，請稍後再試。</span></li>'
            : rows.length ? rows.map((r) => `<li class="${r.me ? 'me' : ''}"><span class="no">${r.rank}</span><span class="nm">${esc(r.name)}</span><span class="val">${num(r.score)} 分</span></li>`).join('')
              : '<li class="empty"><span class="nm">還沒有人上榜，跑一趟就有分數！</span></li>';
        $('boardTotal').textContent = P.canScore ? `我的累計積分：${num(P.profile.total)} 分（完賽 ${P.profile.runs} 趟）` : P.mode === 'guest' ? '登入後才會累積積分。' : '';
      }
    },

    // ------------------------------------------------------------------ 多人連線：房間列表、開房
    openRooms(mode) {
      const g = G();
      this.formMode = mode === 'edit' ? 'edit' : 'create';
      const edit = this.formMode === 'edit';
      if (!edit && Net.inRoom) return;
      const gate = !edit && !P.canMulti;
      $('roomsGate').hidden = !gate; $('roomsBody').style.display = gate ? 'none' : '';
      $('roomsBody').classList.toggle('edit', edit);
      $('roomsTitle').textContent = edit ? '房間設定' : '多人連線';
      $('roomFormTitle').textContent = edit ? '修改設定（所有人會立即看到）' : '開新房間';
      $('roomCreate').textContent = edit ? '套用設定' : '建立房間';
      if (gate) {
        $('roomsGate').textContent = P.mode === 'guest' ? '請先登入金碟遊樂場帳號，才能開房、加入房間，並記錄成績與累積積分。'
          : '多人連線要在「金碟遊樂場」平台上才能使用。想在自己電腦上測試：執行 node tools/dev_platform.js，再用它顯示的網址開兩個分頁。';
      } else if (edit) {
        const c = Net.cfg || {};
        this.form = { track: c.track || 'sprint', dir: c.dir || 1, env: c.env || 'sunny', collide: c.collide !== false };
        $('roomName').value = c.name || '';
      } else {
        this.form = { track: ROOM_TRACKS[g.opts.section] ? g.opts.section : 'sprint', dir: g.opts.dir, env: g.opts.env, collide: true };
        $('roomName').value = (P.name + ' 的房間').slice(0, 20);
        this.loadRooms();
        clearInterval(this._listT);
        this._listT = setInterval(() => { if ($('roomsDialog').open && !this._busy) this.loadRooms(true); }, 5000);
      }
      this.renderForm();
      if (!$('roomsDialog').open) $('roomsDialog').showModal();
    },
    renderForm() {
      const f = this.form;
      setOn($('roomTracks'), 'data-v', f.track); setOn($('roomDirs'), 'data-v', f.dir); setOn($('roomEnvs'), 'data-v', f.env); setOn($('roomCollide'), 'data-v', f.collide);
      $('roomCollideNote').textContent = f.collide ? '玩家的車會互相碰撞、卡位。' : '玩家的車互相穿透，各跑各的。';
    },
    async loadRooms(quiet) {
      const box = $('roomList');
      if (!quiet) box.innerHTML = '<div class="none">讀取房間列表…</div>';
      let rooms;
      try { rooms = await P.roomList(); } catch (e) { if (!quiet) box.innerHTML = '<div class="none">房間列表讀取失敗，請按「重新整理」。</div>'; return; }
      if (!rooms.length) { box.innerHTML = '<div class="none">目前沒有房間。<br>在右邊開一間，等朋友進來！</div>'; return; }
      box.innerHTML = rooms.map((r) => {
        const full = r.n >= (r.max || 4), racing = r.phase === 'race';
        return `<div class="room-row"><div class="inf"><b>${esc(r.name)}</b><small>房主 ${esc(r.host)} · ${esc(TRACKS[r.track] || r.track)} · ${dirName(r.dir)} · ${esc(WEATHER[r.env] || '')} · 碰撞${r.collide ? '開' : '關'}</small></div>`
          + `<span class="cnt">${r.n} / ${r.max || 4}</span><button class="join" data-id="${esc(r.id)}"${full || racing ? ' disabled' : ''}>${racing ? '比賽中' : full ? '已滿' : '加入'}</button></div>`;
      }).join('');
    },
    async joinRoom(id, btn) {
      if (this._busy) return;
      this._busy = true;
      if (btn) { btn.disabled = true; btn.textContent = '連線中…'; }
      try {
        await Net.join(id);
        $('roomsDialog').close();
      } catch (e) {
        const code = e && e.code;
        this.toast(ERR[code] || '加入失敗，請再試一次');
        if (code === 'roomNotFound') await P.roomDel(id, true);   // 清掉已經不存在的房間
        this.loadRooms();
      }
      this._busy = false;
    },
    async submitForm() {
      const f = this.form;
      const cfg = { name: $('roomName').value.trim().slice(0, 20) || (P.name + ' 的房間').slice(0, 20), track: f.track, dir: f.dir, env: f.env, collide: !!f.collide };
      if (this.formMode === 'edit') { Net.setCfg(cfg); $('roomsDialog').close(); return; }
      if (this._busy) return;
      this._busy = true;
      const b = $('roomCreate');
      b.disabled = true; b.textContent = '建立中…';
      try {
        await Net.create(cfg);
        $('roomsDialog').close();
      } catch (e) { this.toast(ERR[e && e.code] || '開房失敗，請再試一次'); }
      b.disabled = false; b.textContent = '建立房間';
      this._busy = false;
    },

    // ------------------------------------------------------------------ 房間面板
    renderRoom() {
      const show = Net.inRoom && !Net.racing;
      $('menu').classList.toggle('in-room', show);
      $('roomPanel').classList.toggle('hidden', !show);
      if (!show) return;
      const c = Net.cfg || {}, host = Net.isHost, lobby = Net.phase === 'lobby';
      $('rpName').textContent = c.name || '房間';
      $('rpInfo').textContent = c.track ? `${TRACKS[c.track]} ${KM[c.track]} km · ${dirName(c.dir)} · ${WEATHER[c.env]} · 玩家碰撞 ${c.collide ? '開啟' : '關閉'}` : '連線中…';
      const COL = RM.CivicModel.COLORS, rows = [];
      for (let i = 0; i < 4; i++) {
        const p = Net.players[i];
        if (!p) { rows.push('<li class="empty">等待玩家加入…</li>'); continue; }
        const isHost = p.id === Net.host, me = p.id === Net.me;
        const st = p.racing && !lobby ? '<span class="st">比賽中</span>' : isHost ? '<span class="st host">房主</span>' : p.ready ? '<span class="st ok">已準備</span>' : '<span class="st">未準備</span>';
        const col = (COL[p.color] || COL[0])[1];
        rows.push(`<li class="${me ? 'me' : ''}"><span class="dot" style="background:${col}"></span><span class="who"><b>${esc(p.name)}${me ? '（你）' : ''}</b><small>${esc(CARS[p.car] || '')}</small></span>${st}`
          + (host && !me && lobby ? `<button class="kick" data-id="${esc(p.id)}" title="請出房間" aria-label="請出房間">✕</button>` : '') + '</li>');
      }
      $('rpPlayers').innerHTML = rows.join('');
      const others = Net.players.filter((p) => p.id !== Net.host), allReady = others.every((p) => p.ready);
      const me = Net.player(Net.me);
      const btn = $('rpReady');
      $('rpCfg').classList.toggle('hidden', !host);
      $('rpCfg').disabled = !lobby;
      if (!lobby) { btn.textContent = '比賽進行中…'; btn.disabled = true; $('rpHint').textContent = '這一場還有玩家在跑，結束後就能再開始。'; }
      else if (host) {
        btn.textContent = '開始比賽'; btn.disabled = !allReady;
        $('rpHint').textContent = !others.length ? '可以先自己跑，或等朋友加入（房間會出現在大家的列表上）。' : allReady ? '全員準備完成，可以開始了！' : '等所有玩家按下「準備」…';
      } else {
        btn.textContent = me && me.ready ? '取消準備' : '準備'; btn.disabled = false;
        $('rpHint').textContent = me && me.ready ? '已準備，等房主開始比賽。' : '左邊可以換車、換顏色，選好就按「準備」。';
      }
    },

    onNet(type, data) {
      const g = G();
      if (type === 'room' || type === 'players' || type === 'cfg') this.renderRoom();
      else if (type === 'load') { this.mpResults = false; this.renderRoom(); $('mpMenu').classList.add('hidden'); }
      else if (type === 'err') { if (ERR[data]) this.toast(ERR[data]); }
      else if (type === 'fin') {
        if (data.id !== Net.me && Net.racing && g.hud) { const c = Net.byK[data.k]; g.hud.message(`${c ? c.name : '玩家'} 抵達終點（第 ${data.place} 名）`, 2.5, '#7dffa0'); }
        this.renderMulti();
      } else if (type === 'results') {
        if (Net.racing) { if (Net.dnf) this.showDnf(); else this.renderMulti(); }
        else { this.renderRoom(); }
      } else if (type === 'closed') {
        this.toast(data === 'kicked' ? ERR.kicked : '與房間的連線中斷了', 4500);
        // 比賽途中斷線：回車庫 (正在載入的話，startRace 結束時會自己回去)
        if (g.state === 'drive' || g.state === 'finished') this.toGarage();
        this.renderRoom();
      }
    },

    // ------------------------------------------------------------------ 比賽中
    onRaceStart(mp) {
      $('mpHud').classList.toggle('hidden', !mp);
      $('mpMenu').classList.add('hidden');
      if (!mp) { this.mpResults = false; this.setButtons(false); return; }
      this._rankT = 0;
      $('mpTags').innerHTML = ''; this._tags = {};
      $('mpNote').textContent = '';
    },
    raceMenu() { $('mpMenu').classList.toggle('hidden'); },
    // 每幀 (main.js frame)：名次、其他玩家的名牌
    frame(dt, s) {
      if (!Net.racing) return;
      const g = G(), now = performance.now(), St = RM.Start;
      // ---- 還沒開始倒數時畫面中央的文字 (倒數 3、2、1、START 由 js/game/start.js 顯示)
      St.wait = Net.cdAt ? '' : '等待其他玩家載入…' + (Net.wait ? `<small>${Net.wait.loaded} / ${Net.wait.total} 人完成</small>` : '');
      // ---- 名次 (每 0.2 秒更新；起跑前大家都在同一排，先不顯示)
      const rk = $('mpRank'), hideRank = St.on ? 'hidden' : '';
      if (rk.style.visibility !== hideRank) rk.style.visibility = hideRank;
      this._rankT -= dt;
      if (this._rankT <= 0) {
        this._rankT = 0.2;
        const rows = Net.standings(s);
        $('mpPos').textContent = rows.findIndex((r) => r.me) + 1;
        $('mpOf').textContent = '/ ' + rows.length;
        $('mpOrder').innerHTML = rows.map((r, i) => `<li class="${r.me ? 'me' : ''}"><i>${i + 1}</i>${esc(r.name)}${r.fin ? '<em>完賽</em>' : ''}</li>`).join('');
        let note = '';
        if (Net.graceAt && !Net.myFin) note = `已有人抵達終點，剩 ${Math.max(0, Math.ceil((Net.graceAt - now) / 1000))} 秒`;
        else if (St.goAt && now - St.goAt < 6000 && Net.raceCfg) note = Net.raceCfg.collide ? '玩家碰撞：開啟' : '玩家碰撞：關閉（互相穿透）';
        if ($('mpNote').textContent !== note) $('mpNote').textContent = note;
      }
      // ---- 名牌：把車頂上方的點投影到螢幕
      const m = g.renderer.vp, W = window.innerWidth, H = window.innerHeight, box = $('mpTags');
      for (const c of Net.cars) {
        let el = this._tags[c.k];
        if (!el) { el = this._tags[c.k] = document.createElement('div'); el.className = 'mp-tag'; el.textContent = c.name; box.append(el); }
        const p = c.veh.pos, x = p[0], y = p[1] + 1.35, z = p[2];
        const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
        const show = !c.gone && c.visible && c.dist < 260 && cw > 1;
        if (show !== (el.style.display !== 'none')) el.style.display = show ? '' : 'none';
        if (!show) continue;
        const sx = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / cw * 0.5 + 0.5) * W, sy = (0.5 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / cw * 0.5) * H;
        el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
        el.style.opacity = c.dist > 180 ? '0.55' : '1';
      }
    },

    // ------------------------------------------------------------------ 結算
    setButtons(mp) {
      $('againBtn').textContent = mp ? '回到房間' : '再跑一次';
      $('resMenuBtn').textContent = mp ? '離開房間' : '回到車庫';
    },
    // 抵達終點 (main.js _finish 呼叫)：送出成績 → 顯示積分、賽道紀錄 (前 5 名 + 自己的名次)、多人名次
    async onFinish(r) {
      const g = G(), mp = Net.racing;
      const box = document.createElement('div');
      box.id = 'resOnline';
      box.innerHTML = (mp ? '<div id="resMulti"></div>' : '') + '<div id="resScore" class="res-score">計算積分中…</div><div id="resRecords"></div>';
      $('resBody').append(box);
      this.mpResults = mp; this.setButtons(mp);
      // rv：計時規則版本 (2 = 倒數 START 就開始計時)，要和 server/functions.js 的 REC_V 一致；舊版遊戲送的成績伺服器不收
      const run = { track: g.opts.section, dir: r.dir, time: Math.round(r.t * 1000), car: g.opts.car, hits: r.hits, top: Math.round(r.top), mode: mp ? 'multi' : 'solo', place: 0, players: 1, rv: 2 };
      // 有重播的賽道：這一趟的軌跡一起送出，進入前 15 名就存起來 (js/game/replay.js；一定要在這裡同步拿，之後就停止錄製了)
      const rp = RM.Replay ? RM.Replay.rec.take(run, r) : null;
      if (rp) run.rp = rp;
      if (mp) {
        Net.finish(r);
        this.renderMulti();
        run.players = Net.grid.length;
        run.place = await Net.myPlace();
      }
      this._run = run;
      this.submit();
    },
    async submit() {
      const run = this._run;
      if (!run) return;
      const put = (html) => { const el = $('resScore'); if (el && this._run === run) el.innerHTML = html; };
      put('計算積分中…');
      const res = await P.submitRun(run);
      if (this._run !== run) return;
      if (res && res.ok) {
        const parts = [`<span>基本 ${num(res.base)}</span>`, `<span>平均 ${res.avg} km/h ×${res.speedF}</span>`]
          .concat((res.parts || []).map(([name, pct]) => `<span class="${pct < 0 ? 'neg' : ''}">${esc(name)} ${pct > 0 ? '+' : '−'}${Math.abs(pct)}%</span>`));
        const tags = [];
        if (res.rank === 1) tags.push('🏆 賽道紀錄保持人！'); else if (res.rank > 0) tags.push(`🏆 進入賽道第 ${res.rank} 名`);
        if (res.isPB && res.rank === 0) tags.push('刷新個人最佳');
        if (res.replay) tags.push('▶ 重播已存到紀錄');
        put(`<div class="gain"><span>本次積分</span><b>+${num(res.score)}</b></div><div class="parts">${parts.join('')}</div>`
          + `<div>累計積分 <b class="badge">${num(res.total)}</b>${tags.length ? '　' + tags.map((t) => `<span class="badge">${t}</span>`).join('　') : ''}</div>`);
        G().best = Math.min(isFinite(G().best) ? G().best : Infinity, res.pb / 1000);
      } else {
        const code = res && res.error;
        put(code === 'guest' ? '登入金碟遊樂場帳號後，成績才會列入賽道紀錄並累積積分。'
          : code === 'offline' ? '單機模式：成績只存在這個瀏覽器，不列入線上紀錄。'
            : code === 'badTime' || code === 'badTrack' ? '這次的成績沒有被伺服器接受。'
              : code === 'oldVersion' ? '遊戲已經更新，請重新整理頁面後再跑一次。'
              : '成績送出失敗（網路不穩？） <button class="link-button retry">重試</button>');
      }
      const el = $('resRecords');
      if (el && P.canScore) el.innerHTML = `<div class="res-sub">賽道紀錄 · ${TRACKS[run.track]}（${dirOf(run.track, run.dir)}）</div><ol class="rank-list">${this.recRows(run.track, run.dir, 5, true)}</ol>`;
    },
    // 多人：本場名次 (有人完賽就更新；全部結束後是最終名次)
    renderMulti() {
      const el = $('resMulti');
      if (!el || !Net.grid) return;
      let rows;
      if (Net.results) rows = Net.results.map((x) => ({ id: x.id, name: x.name, place: x.place, t: x.t, text: x.dnf ? (x.left ? '已離開' : '未完賽') : fmt(x.t) }));
      else {
        rows = Net.grid.map((e) => { const f = Net.fins.find((x) => x.id === e.id); return { id: e.id, name: e.name, place: f ? f.place : 0, t: f ? f.t : 0, text: f ? fmt(f.t) : '行駛中…' }; });
        rows.sort((a, b) => (a.place || 9) - (b.place || 9));
      }
      el.innerHTML = `<div class="res-sub">本場名次${Net.results ? '' : '（比賽進行中）'}</div><ol class="rank-list">`
        + rows.map((x) => `<li class="${x.id === Net.me ? 'me' : ''}"><span class="no">${x.place || '–'}</span><span class="nm">${esc(x.name)}</span><span class="val">${x.text}</span></li>`).join('') + '</ol>';
    },
    // 多人：時間到了還沒跑完
    showDnf() {
      const c = Net.raceCfg || {};
      $('resTitle').textContent = `${TRACKS[c.track] || ''}（${dirName(c.dir)}）`;
      $('resBody').innerHTML = '<div class="big">未完賽</div><div id="resOnline"><div id="resMulti"></div><div class="res-score">時間到了還沒抵達終點，這一場沒有積分。</div></div>';
      this._run = null;
      this.mpResults = true; this.setButtons(true);
      this.renderMulti();
      $('results').classList.remove('hidden');
    },
    toGarage() {
      $('results').classList.add('hidden'); $('mpMenu').classList.add('hidden'); $('mpHud').classList.add('hidden');
      this.mpResults = false; this.setButtons(false);
      const g = G();
      if (g.state !== 'menu' && g.state !== 'loading' && g.state !== 'warmup') g.toMenu();
      this.renderRoom();
    },
    backToRoom() {
      Net.endRace();
      this.toGarage();
      if (!Net.inRoom) this.toast('房間已經關閉');
    },
    quitRoom() {
      Net.leave();
      if (Net.racing) Net.endRace();
      this.toGarage();
    },
  };

  RM.Online = O;
  window.addEventListener('load', () => O.init());
})();
