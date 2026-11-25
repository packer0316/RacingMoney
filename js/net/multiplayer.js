'use strict';
// 多人連線：開房 / 進房、同步起跑 (3、2、1、START)、車輛狀態同步、其他玩家的車輛繪製與碰撞
//
// 每位玩家的車都由自己的電腦計算物理，每秒送 12 次狀態 (位置、姿態、速度) 給其他人；
// 收到的狀態依延遲往前推算 (dead reckoning) 再平滑追上，所以高速並排時彼此看到的位置是「現在」的位置。
// 房間腳本見 server/room.js。
(function () {
  const RM = window.RM;
  const { quat, clamp } = RM;
  const $ = (id) => document.getElementById(id);
  const SEND_DT = 1 / 12;
  // 狀態旗標
  const F = { BRAKE: 1, REV: 2, NITRO: 4, DRIFT: 8, HEAD: 16, BL: 32, BR: 64, FIN: 128, SRV: 256 };
  const r2 = (v) => Math.round(v * 100) / 100, r4 = (v) => Math.round(v * 10000) / 10000;

  const Net = {
    room: null, me: null, k: 0, host: null, cfg: null, players: [], phase: 'none',
    racing: false,      // 正在多人比賽中 (從開始載入到回到房間)
    cdAt: 0,            // 伺服器宣布的起跑時刻 (performance.now)；倒數、鎖車、放行由 RM.Start 處理
    wait: null, graceAt: 0,
    cars: [], dots: [], byK: {}, grid: null, raceCfg: null, seq: 0, fins: [], results: null, myFin: null, dnf: false,
    _ls: [], _offs: [], _pending: [], _sec: 0, _cnt: 0, _acc: 0, _regSig: '', _regT: -1e9, _timer: null, _shells: [], _noShadow: [], _saved: null,

    on(fn) { this._ls.push(fn); },
    emit(type, data) { for (const fn of this._ls.slice()) { try { fn(type, data); } catch (e) { console.error(e); } } },
    get inRoom() { return !!this.room; },
    get isHost() { return !!this.room && this.host === this.me; },
    player(id) { return this.players.find((p) => p.id === id) || null; },

    // ------------------------------------------------------------------ 進出房間
    async create(cfg) {
      const room = await RM.Platform.join('new');
      this._attach(room);
      this._hello();
      this._send('cfg', cfg);
    },
    async join(id, signal) {
      const room = await RM.Platform.join(id, signal);
      this._attach(room);
      this._hello();
    },
    leave() {
      const room = this.room;
      if (!room) return;
      if (this.isHost) RM.Platform.roomDel(room.id);
      this._detach();
      try { room.leave(); } catch (e) { /* 已斷線 */ }
      if (this.racing) this.endRace();
      this.emit('room');
    },
    _attach(room) {
      this.room = room; this.me = room.you.id; this.phase = 'lobby';
      this.players = []; this.cfg = null; this.host = null; this._pending = []; this._regSig = ''; this._regT = -1e9; this._car = '';
      const on = (type, fn) => this._offs.push(room.on(type, (d) => { if (this.room === room) fn(d || {}); }));
      on('welcome', (d) => { this.k = d.k; this.host = d.host; this.cfg = d.cfg; this.players = d.players || []; this.emit('room'); });
      on('players', (d) => {
        const was = this.isHost;
        this.host = d.host; this.players = d.list || [];
        for (const c of this.cars) if (!this.player(c.id)) c.gone = true;
        if (!was && this.isHost) this._regSig = '';
        this.emit('players');
      });
      on('cfg', (d) => { this.cfg = d; this.emit('cfg'); });
      on('load', (d) => this._onLoad(d));
      on('wait', (d) => { this.wait = d; this.emit('wait', d); });
      on('countdown', (d) => { this.cdAt = performance.now() + (d.ms || 4000); this.phase = 'countdown'; RM.Start.beginAt(this.cdAt); this.emit('countdown', d); });
      on('s', (d) => this._onState(d));
      on('fin', (d) => {
        this.fins.push(d);
        const c = this.byK[d.k];
        if (c) { c.fin = true; c.place = d.place; c.time = d.t; }
        if (d.id === this.me && this.myFin) { this.myFin.place = d.place; this.myFin.acked = true; }
        this.emit('fin', d);
      });
      on('grace', (d) => { this.graceAt = performance.now() + (d.ms || 30000); this.emit('grace', d); });
      on('results', (d) => { if (d.seq === this.seq || !this.racing) this._onResults(d); });
      on('err', (d) => this.emit('err', d.code));
      this._offs.push(room.onClose((reason) => { if (this.room === room) this._closed(reason); }));
      // 房主：定期把房間登記到列表 (也是心跳)；所有人：在車庫換車 / 換色時通知房間
      this._timer = setInterval(() => { this._flush(); this._reg(); this._hello(true); }, 1000);
    },
    _detach() {
      clearInterval(this._timer); this._timer = null;
      for (const off of this._offs) { try { if (typeof off === 'function') off(); } catch (e) { /* ignore */ } }
      this._offs = [];
      this.room = null; this.phase = 'none'; this.players = []; this.host = null; this.cfg = null;
    },
    _closed(reason) {
      this._detach();
      if (this.racing) this.endRace();
      this.emit('closed', reason);
      this.emit('room');
    },

    // 平台限制每位玩家每秒 20 則訊息：車輛狀態 (low) 最多用 15 則，其餘留給其他訊息；送不出去的重要訊息排隊稍後補送
    _send(type, data, low) {
      const room = this.room;
      if (!room) return false;
      const sec = Math.floor(performance.now() / 1000);
      if (sec !== this._sec) { this._sec = sec; this._cnt = 0; }
      if (this._cnt >= (low ? 15 : 18)) { if (!low) this._pending.push([type, data]); return false; }
      try { room.send(type, data); this._cnt++; return true; } catch (e) { if (!low) this._pending.push([type, data]); return false; }
    },
    _flush() {
      while (this._pending.length) {
        const m = this._pending.shift();
        if (!this._send(m[0], m[1])) break;   // 還是送不出去：_send 已把它放回佇列
      }
    },
    _hello(onlyIfChanged) {
      // m：這台車的改裝代碼 (js/game/tuning.js code)，其他玩家照這個畫我的輪圈 / 彩繪 / 車高；在車庫換零件也會重送
      const o = RM.Game.opts, m = RM.Tuning ? RM.Tuning.code(RM.Tuning.fitOf(o.car, RM.Platform && RM.Platform.mods)) : '';
      const sig = o.car + ':' + o.color + ':' + m;
      if (onlyIfChanged && (sig === this._car || this.phase !== 'lobby')) return;
      this._car = sig;
      this._send('hello', { car: o.car, color: o.color, m });
    },
    // 房主把房名、賽道、人數登記到伺服器函式的共用資料，其他玩家的房間列表才看得到 (有變動就更新，否則每 12 秒一次)
    _reg() {
      if (!this.isHost || !this.cfg) return;
      const c = this.cfg, now = performance.now();
      const info = { id: this.room.id, name: c.name, track: c.track, dir: c.dir, env: c.env, collide: c.collide, n: this.players.length, phase: this.phase === 'lobby' ? 'lobby' : 'race' };
      const sig = JSON.stringify(info);
      if (now - this._regT < (sig === this._regSig ? 12000 : 1500)) return;
      this._regSig = sig; this._regT = now;
      RM.Platform.roomSet(info);
    },
    setCfg(cfg) { if (this.isHost) this._send('cfg', cfg); },
    setReady(on) { this._send('ready', { on: !!on }); },
    start() { if (this.isHost) this._send('start'); },
    kick(id) { if (this.isHost) this._send('kick', { id }); },

    // ------------------------------------------------------------------ 比賽流程
    _onLoad(d) {
      const g = RM.Game;
      this.grid = d.grid || []; this.raceCfg = d.cfg; this.seq = d.seq;
      this.phase = 'loading'; this.racing = true;
      this.cdAt = 0; this.wait = null; this.graceAt = 0;
      this.fins = []; this.results = null; this.myFin = null; this.dnf = false;
      this.cars = []; this.byK = {};
      // 套用房間的賽道 / 方向 / 天氣 (比賽結束後還原玩家自己的選項)
      if (!this._saved) this._saved = { section: g.opts.section, dir: g.opts.dir, env: g.opts.env };
      g.opts.section = d.cfg.track; g.opts.dir = d.cfg.dir; g.opts.env = d.cfg.env;
      this.emit('load', d);
      if (g.menu.cancelTransition) g.menu.cancelTransition();
      $('results').classList.add('hidden'); $('pause').classList.add('hidden');
      if (g.state === 'paused') g.state = 'finished';
      g.startRace();
    },

    // 起跑位置：同一排並排 (每台間隔一個車道)，第 0 格在最外側
    place(veh, s, dir, slot) {
      const road = veh.road, f = road.frameAt(s, {});
      const lane0 = dir * (road.laneOut || 1.75);
      let lat = dir * ((road.laneOut || 5.4) - slot * (road.laneW || 3.6));
      const i = f.i;
      if (road.wall) lat = clamp(lat, -(road.wall[0][i] - 1.4), road.wall[1][i] - 1.4);
      veh.pos[0] += f.rx * (lat - lane0); veh.pos[2] += f.rz * (lat - lane0);
      veh.pos[1] = f.y + road.surfOff(f.i, f.t, lat) + veh.S.cgH + 0.02;
    },

    // startRace 裡，玩家的車放到起點之後呼叫：把自己移到起跑格、建立其他玩家的車
    onRaceLoad(g, sStart, dir) {
      const COL = RM.CivicModel.COLORS;
      const env = RM.ENV[g.opts.env] || {};
      this.cars = []; this.byK = {};
      for (const e of this.grid) {
        if (e.id === this.me) { this.place(g.car, sStart, dir, e.slot); continue; }
        // 和自己同款的車共用同一份模型；其他車款另外建一份 (貼圖較小)
        const model = g.carModel && g.carModel.id === e.car ? g.carModel : RM.ProcCar.getExtra(e.car, g.atlas);
        // 對方的改裝 (grid 的 m)：規格 (車高、外傾) 與外觀都照他的；沒有就是原廠
        const spec = model.spec(), fit = RM.Tuning ? RM.Tuning.fromCode(e.m) : null;
        if (fit) RM.Tuning.applySpec(spec, fit);
        const veh = new RM.Vehicle(g.road, spec);
        veh.reset(sStart, dir);
        this.place(veh, sStart, dir, e.slot);
        quat.toMat3(veh.R, veh.q);
        const color = clamp(e.color | 0, 0, COL.length - 1);
        const tuneVis = fit && RM.TuningVis ? RM.TuningVis.get(model, spec, fit, null, COL[color][1]) : null;
        const c = {
          id: e.id, k: e.k, name: e.name, carId: e.car, model, veh, slot: e.slot,
          ctx: { car: veh, carModel: model, carAsset: null, tuneVis, opts: { color }, paint: RM.srgb(COL[color][1]), headOn: !!env.head, blink: { l: false, r: false, on: false, t: 0 }, cam: { name: 'chase' } },
          has: false, t0: 0, offMin: Infinity, sp: veh.pos.slice(), sq: veh.q.slice(), sv: [0, 0, 0], swy: 0, steer: 0, flags: 0,
          prog: sStart, fin: false, place: 0, time: 0, gone: false, lastRecv: 0,
        };
        this.cars.push(c); this.byK[c.k] = c;
      }
      this.dots = this.cars.map((c) => c.veh);   // 小地圖上的點
    },
    // startRace 結束 (可以開車了)：告訴伺服器載入完成，等全員到齊後倒數
    onRaceReady() {
      this._acc = 0;
      this._send('loaded');
      if (this.phase === 'loading') this.phase = 'wait';
      if (this.cdAt) RM.Start.beginAt(this.cdAt);   // 自己載入太慢，其他人已經開始倒數
      this.emit('wait', this.wait);
    },

    // 每幀：送出自己的狀態、更新其他玩家的車、碰撞
    update(dt, car, s) {
      if (!this.racing) return;
      const now = performance.now(), g = RM.Game;
      if (this.phase === 'countdown' && !RM.Start.on) { this.phase = 'race'; this.emit('go'); }   // START
      this._flush();
      // 送出狀態
      this._acc += dt;
      if (this.room && this._acc >= SEND_DT && (this.phase === 'countdown' || this.phase === 'race' || this.phase === 'wait')) {
        this._acc = Math.min(this._acc - SEND_DT, SEND_DT);
        const sn = this.room.serverNow ? this.room.serverNow() : null;
        const b = g.blink || {};
        let fl = (car.brake > 0.05 ? F.BRAKE : 0) | (car.selName === 'R' ? F.REV : 0) | (car.nitroT > 0 ? F.NITRO : 0) | (car.drifting ? F.DRIFT : 0)
          | (g.headOn ? F.HEAD : 0) | (b.l ? F.BL : 0) | (b.r ? F.BR : 0) | (g.race.finished ? F.FIN : 0) | (sn !== null ? F.SRV : 0);
        const p = car.pos, q = car.q, v = car.vel;
        this._send('s', [Math.round(sn !== null ? sn : now), r2(p[0]), r2(p[1]), r2(p[2]), r4(q[0]), r4(q[1]), r4(q[2]), r4(q[3]),
          r2(v[0]), r2(v[1]), r2(v[2]), r2(car.w[1]), r4(car.steer), fl, Math.round(s * 10) / 10], true);
      }
      for (const c of this.cars) this._stepCar(c, dt, now);
      if (this.raceCfg && this.raceCfg.collide && this.phase === 'race' && !g.race.finished) this._collide(car);
    },

    // 收到其他玩家的狀態：[k, t, x, y, z, qx, qy, qz, qw, vx, vy, vz, wy, steer, flags, progress]
    _onState(d) {
      const c = this.byK[d[0]];
      if (!c || !(d.length >= 16)) return;
      for (let i = 1; i < 16; i++) if (!isFinite(d[i])) return;
      const now = performance.now(), stamp = d[1], flags = d[14] | 0;
      // 這筆狀態是多久以前的：雙方都有伺服器時鐘就直接相減；否則以「最短的傳輸時間」當基準估計
      const sn = this.room && this.room.serverNow ? this.room.serverNow() : null;
      let age;
      if ((flags & F.SRV) && sn !== null) age = (sn - stamp) / 1000;
      else { const off = now - stamp; c.offMin = Math.min(c.offMin + 0.02, off); age = (off - c.offMin) / 1000 + 0.05; }
      c.t0 = now - clamp(age, 0, 1) * 1000;
      c.sp[0] = d[2]; c.sp[1] = d[3]; c.sp[2] = d[4];
      quat.norm(c.sq, [d[5], d[6], d[7], d[8]]);
      c.sv[0] = d[9]; c.sv[1] = d[10]; c.sv[2] = d[11];
      c.swy = d[12]; c.steer = d[13]; c.flags = flags; c.prog = d[15];
      c.lastRecv = now;
      if (!c.has) { c.has = true; c.veh.pos[0] = c.sp[0]; c.veh.pos[1] = c.sp[1]; c.veh.pos[2] = c.sp[2]; c.veh.q = c.sq.slice(); }
    },

    _stepCar(c, dt, now) {
      const veh = c.veh, S = veh.S;
      if (c.has) {
        const age = (now - c.t0) / 1000;
        const stale = age > 1.2;                       // 太久沒收到：停在原地，不再往前推
        const a = clamp(age, 0, 0.45);
        const tx = c.sp[0] + c.sv[0] * a, ty = c.sp[1] + c.sv[1] * a, tz = c.sp[2] + c.sv[2] * a;
        const qy = quat.axisAngle(this._qy || (this._qy = [0, 0, 0, 1]), [0, 1, 0], c.swy * a);
        const qt = quat.mul(this._qt || (this._qt = [0, 0, 0, 1]), qy, c.sq);
        const p = veh.pos;
        if (!stale) { p[0] += c.sv[0] * dt; p[1] += c.sv[1] * dt; p[2] += c.sv[2] * dt; }
        const dx = tx - p[0], dy = ty - p[1], dz = tz - p[2];
        if (dx * dx + dy * dy + dz * dz > 64) { p[0] = tx; p[1] = ty; p[2] = tz; veh.q = qt.slice(); }
        else {
          const e = 1 - Math.exp(-dt * 10);
          p[0] += dx * e; p[1] += dy * e; p[2] += dz * e;
          const q = veh.q, e2 = 1 - Math.exp(-dt * 14);
          const sg = q[0] * qt[0] + q[1] * qt[1] + q[2] * qt[2] + q[3] * qt[3] < 0 ? -1 : 1;
          for (let i = 0; i < 4; i++) q[i] += (qt[i] * sg - q[i]) * e2;
          quat.norm(q, q);
        }
        veh.vel[0] = stale ? 0 : c.sv[0]; veh.vel[1] = stale ? 0 : c.sv[1]; veh.vel[2] = stale ? 0 : c.sv[2];
        veh.w[0] = 0; veh.w[1] = stale ? 0 : c.swy; veh.w[2] = 0;
      }
      const R = quat.toMat3(veh.R, veh.q);
      const vL = -(veh.vel[0] * R[6] + veh.vel[1] * R[7] + veh.vel[2] * R[8]);
      veh.vLong = vL; veh.speed = Math.hypot(veh.vel[0], veh.vel[1], veh.vel[2]);
      veh.brake = c.flags & F.BRAKE ? 1 : 0;
      veh.sel = c.flags & F.REV ? 1 : 3;
      veh.steer += (c.steer - veh.steer) * (1 - Math.exp(-dt * 16));
      veh.nitroT = c.flags & F.NITRO ? 1 : 0;
      for (const w of veh.wheels) {
        if (w.front) w.steer = veh.steer;
        w.angle += (vL / S.tireR) * dt;
        w.len = w.lenStatic;
      }
      const cx = c.ctx, b = cx.blink;
      cx.headOn = !!(c.flags & F.HEAD);
      b.l = !!(c.flags & F.BL); b.r = !!(c.flags & F.BR);
      if (b.l || b.r) { b.t += dt; b.on = b.t % 0.75 < 0.4; } else { b.on = false; b.t = 0; }
    },

    // 與其他玩家的車碰撞 (房間開啟碰撞時)：雙方各自算自己被推開的部分。
    // 每台車用 3 個圓 (沿車身前中後) 近似；對方視為同等質量的車。
    _collide(car) {
      const B = car.S.box;
      if (!B) return;
      const hw = B.hw, R = car.R;
      const zs = [-(B.front - hw), (B.rear - B.front) / 2, B.rear - hw];
      for (const c of this.cars) {
        if (!c.has || c.gone || (c.flags & F.FIN)) continue;
        const o = c.veh, OB = o.S.box;
        if (!OB) continue;
        const dx0 = o.pos[0] - car.pos[0], dz0 = o.pos[2] - car.pos[2];
        if (dx0 * dx0 + dz0 * dz0 > 100 || Math.abs(o.pos[1] - car.pos[1]) > 2.5) continue;
        const oR = o.R, ohw = OB.hw, rr = hw + ohw - 0.06;
        const ozs = [-(OB.front - ohw), (OB.rear - OB.front) / 2, OB.rear - ohw];
        for (const oz of ozs) {
          const ax = o.pos[0] + oR[6] * oz, az = o.pos[2] + oR[8] * oz;
          for (const z of zs) {
            const dx = car.pos[0] + R[6] * z - ax, dz = car.pos[2] + R[8] * z - az;
            const d = Math.hypot(dx, dz);
            if (!(d < rr && d > 1e-4)) continue;
            const n = [dx / d, 0, dz / d];
            const Pt = [ax + n[0] * ohw, car.pos[1], az + n[2] * ohw];
            const r = [Pt[0] - car.pos[0], 0, Pt[2] - car.pos[2]];
            const vpx = car.vel[0] + car.w[1] * r[2] - car.w[2] * r[1], vpz = car.vel[2] + car.w[0] * r[1] - car.w[1] * r[0];
            const ovx = o.vel[0] + o.w[1] * (Pt[2] - o.pos[2]), ovz = o.vel[2] - o.w[1] * (Pt[0] - o.pos[0]);
            const vn = (vpx - ovx) * n[0] + (vpz - ovz) * n[2];
            const invP = car._invMassAlong(r, n), invA = 1 / o.S.mass;
            if (!(invP > 1e-9)) continue;
            const pen = rr - d, share = invP / (invP + invA);
            car.pos[0] += n[0] * pen * share; car.pos[2] += n[2] * pen * share;
            if (vn >= 0) continue;
            const j = (-1.2 * vn) / (invP + invA);
            car._impulse(Pt, [n[0] * j, 0, n[2] * j]);
            if (-vn > 1.2) car.events.push({ type: 'player', v: -vn, name: c.name });
          }
        }
      }
    },

    // 自己抵達終點 (main.js _finish 呼叫)
    finish(race) {
      const now = performance.now();
      this.myFin = { t: Math.round(race.t * 1000), g: Math.round(RM.Start.goAt ? now - RM.Start.goAt : race.t * 1000), top: Math.round(race.top), hits: race.hits, place: 0, acked: false, at: now };
      this._send('fin', { t: this.myFin.t, g: this.myFin.g, top: this.myFin.top, hits: this.myFin.hits });
      return this.myFin;
    },
    // 等伺服器回覆自己的名次 (最多等 2 秒)
    async myPlace() {
      for (let i = 0; i < 20; i++) {
        if (!this.myFin || this.myFin.acked || !this.room) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      return this.myFin ? this.myFin.place : 0;
    },
    _onResults(d) {
      this.results = d.list || [];
      this.phase = 'lobby';
      this.graceAt = 0;
      const g = RM.Game;
      // 還沒跑完就結束了 (逾時)：算未完賽
      if (this.racing && !this.myFin && g.race && !g.race.finished && (g.state === 'drive' || g.state === 'finished')) {
        this.dnf = true;
        g.race.finished = true; g.state = 'finished';
      }
      this._regSig = '';
      this.emit('results', d);
    },
    // 回到房間 / 離開比賽：清掉其他玩家的車、還原自己的賽道選項
    endRace() {
      const g = RM.Game;
      // 這一場伺服器還沒結束、自己也沒有完賽紀錄：告訴伺服器不用等我
      if (this.room && this.racing && this.phase !== 'lobby' && !(this.myFin && this.myFin.acked)) this._send('quit');
      this.racing = false; this.cdAt = 0; this.graceAt = 0;
      if (RM.Start.on) RM.Start.cancel();   // 還在倒數就離開：別讓車子一直鎖著
      this.cars = []; this.dots = []; this.byK = {};
      if (this._saved) { Object.assign(g.opts, this._saved); this._saved = null; }
      this._car = '';
    },

    // 目前名次：依賽道進度排序 (已完賽的依名次排在最前面)
    standings(myS) {
      const g = RM.Game, race = g.race, dir = race.dir;
      const rows = [{ me: true, name: RM.Platform.name, prog: (myS - race.startS) * dir, fin: !!this.myFin, place: this.myFin ? this.myFin.place : 0 }];
      for (const c of this.cars) if (!c.gone) rows.push({ me: false, name: c.name, prog: (c.prog - race.startS) * dir, fin: c.fin, place: c.place });
      rows.sort((a, b) => (a.fin !== b.fin ? (a.fin ? -1 : 1) : a.fin ? (a.place || 9) - (b.place || 9) : b.prog - a.prog));
      return rows;
    },

    // ------------------------------------------------------------------ 繪製
    // 把其他玩家的車放進這一幀的繪製清單；回傳車殼清單 (交給 Renderer 用車殼著色器畫)
    draw(g, f, shadowDyn) {
      const out = this._shells;
      out.length = 0;
      if (!this.racing) return out;
      const pl = g.renderer.planes, eye = g.cam.eye;
      for (const c of this.cars) {
        if (c.gone) continue;
        const p = c.veh.pos;
        const dd = Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]);
        c.dist = dd;
        c.visible = dd < 700 && RM.sphereVisible(pl, p[0], p[1] + 0.4, p[2], 3.4);
        if (!c.visible) continue;
        this._noShadow.length = 0;
        g._carDraw.call(c.ctx, f.dynamic, f.glass, dd < 90 ? shadowDyn : this._noShadow);
        if (c.ctx._carShell) out.push(c.ctx._carShell);
      }
      return out;
    },
    // 夜間車燈光暈
    glows(push, night) {
      if (!this.racing || !(night > 0.2)) return;
      for (const c of this.cars) {
        if (c.gone || !c.visible) continue;
        const v = c.veh, R = v.R, S = v.S, LF = S.lampF, LR = S.lampR;
        if (!LF || !LR) continue;
        const P = (x, y, z) => [v.pos[0] + R[0] * x + R[3] * y + R[6] * z, v.pos[1] + R[1] * x + R[4] * y + R[7] * z, v.pos[2] + R[2] * x + R[5] * y + R[8] * z];
        const brk = v.brake > 0.05, head = c.ctx.headOn;
        if (head) for (const x of [-LF[0], LF[0]]) { const p = P(x, LF[1], LF[2] - 0.04); push(p[0], p[1], p[2], 0.55, 1, 0.92, 0.75, 0.7 * night); }
        if (head || brk) for (const x of [-LR[0], LR[0]]) { const p = P(x, LR[1], LR[2] + 0.06); push(p[0], p[1], p[2], brk ? 0.4 : 0.25, 1, 0.05, 0.02, (brk ? 0.62 : 0.15) * night); }
      }
    },
  };

  RM.Net = Net;
})();
