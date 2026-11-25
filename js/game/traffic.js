'use strict';
// 車流：轎車、白色小貨車、遊覽車、機車、重機 (沿車道行駛，曲率限速 + IDM 跟車)
(function () {
  const RM = window.RM;
  const { mat, MeshBuilder, clamp } = RM;

  const MT = {
    paint: mat('#ffffff', 0.35, 0.2, 3), glass: mat('#1a2228', 0.08, 0.3), black: mat('#141414', 0.7),
    tire: mat('#151515', 0.9), head: mat('#ffffff', 0.1, 0.5, 5), tail: mat('#ffffff', 0.2, 0, 6),
    chrome: mat('#c8c8c8', 0.2, 1), white: mat('#e8e8e4', 0.6), cargo: mat('#9a9890', 0.7, 0.4),
    skin: mat('#c9956e', 0.8), shirt: mat('#2c4a7a', 0.9), jacket: mat('#1d1d1d', 0.7), helmet: mat('#d8d8d8', 0.25, 0.2),
    helmetR: mat('#b5121b', 0.25, 0.2), stripe: mat('#c8102e', 0.4), stripeB: mat('#1a4f9c', 0.4), seat: mat('#222', 0.8),
  };

  function wheels(mb, xs, zs, r, w) {
    for (const x of xs) for (const z of zs) mb.cyl([x - w / 2, r, z], [x + w / 2, r, z], r, r, 10, MT.tire, true);
  }
  // 模型 -z = 車頭, y=0 地面
  function sedan() {
    const mb = new MeshBuilder();
    mb.box(0, 0.55, 0, 1.7, 0.6, 4.4, 0, MT.paint);
    mb.box(0, 0.95, 0.15, 1.62, 0.3, 4.2, 0, MT.paint);
    // 車廂
    const q = (a, b, c, d, M) => mb.quad(a, b, c, d, M);
    const y0 = 1.1, y1 = 1.45;
    q([-0.78, y0, -0.7], [0.78, y0, -0.7], [0.62, y1, 0.0], [-0.62, y1, 0.0], MT.glass);
    q([0.78, y0, 1.4], [-0.78, y0, 1.4], [-0.62, y1, 0.95], [0.62, y1, 0.95], MT.glass);
    q([-0.62, y1, 0.0], [0.62, y1, 0.0], [0.62, y1, 0.95], [-0.62, y1, 0.95], MT.paint);
    for (const s of [-1, 1]) {
      const p = (x, y, z) => [s * x, y, z];
      if (s > 0) q(p(0.78, y0, -0.7), p(0.78, y0, 1.4), p(0.62, y1, 0.95), p(0.62, y1, 0.0), MT.glass);
      else q(p(0.78, y0, 1.4), p(0.78, y0, -0.7), p(0.62, y1, 0.0), p(0.62, y1, 0.95), MT.glass);
    }
    wheels(mb, [-0.72, 0.72], [-1.35, 1.3], 0.31, 0.2);
    for (const s of [-1, 1]) {
      mb.box(s * 0.58, 0.68, -2.205, 0.36, 0.12, 0.02, 0, MT.head);
      mb.box(s * 0.62, 0.78, 2.205, 0.34, 0.12, 0.02, 0, MT.tail);
    }
    mb.box(0, 0.38, -2.2, 1.6, 0.16, 0.06, 0, MT.black);
    return mb.build();
  }
  function lightTruck() {
    const mb = new MeshBuilder();
    mb.box(0, 1.05, -1.75, 1.66, 1.5, 1.4, 0, MT.white);
    mb.quad([-0.8, 1.35, -2.46], [0.8, 1.35, -2.46], [0.78, 1.75, -2.4], [-0.78, 1.75, -2.4], MT.glass);
    mb.box(0, 0.6, 0.6, 1.7, 0.12, 3.2, 0, MT.cargo);
    for (const s of [-1, 1]) mb.box(s * 0.84, 0.88, 0.6, 0.04, 0.45, 3.2, 0, MT.cargo);
    mb.box(0, 0.88, 2.18, 1.7, 0.45, 0.04, 0, MT.cargo);
    mb.box(0, 0.42, 0.2, 1.2, 0.3, 4.4, 0, MT.black);
    wheels(mb, [-0.72, 0.72], [-1.7, 1.2], 0.3, 0.2);
    for (const s of [-1, 1]) { mb.box(s * 0.62, 0.75, -2.46, 0.3, 0.16, 0.02, 0, MT.head); mb.box(s * 0.72, 0.8, 2.21, 0.18, 0.18, 0.02, 0, MT.tail); }
    return mb.build();
  }
  function bus() {
    const mb = new MeshBuilder();
    mb.box(0, 1.9, 0, 2.5, 3.0, 11.8, 0, MT.paint);
    for (const s of [-1, 1]) {
      mb.box(s * 1.255, 2.45, 0.3, 0.02, 1.0, 10.4, 0, MT.glass);
      mb.box(s * 1.256, 1.3, 0, 0.02, 0.25, 11.6, 0, MT.stripe);
      mb.box(s * 1.256, 1.05, 0, 0.02, 0.14, 11.6, 0, MT.stripeB);
    }
    mb.quad([-1.2, 1.6, -5.92], [1.2, 1.6, -5.92], [1.2, 3.1, -5.92], [-1.2, 3.1, -5.92], MT.glass);
    mb.box(0, 3.45, 0, 2.4, 0.12, 11.6, 0, MT.white);
    wheels(mb, [-1.05, 1.05], [-3.9, 3.0, 4.3], 0.5, 0.3);
    for (const s of [-1, 1]) { mb.box(s * 0.95, 0.85, -5.91, 0.4, 0.2, 0.02, 0, MT.head); mb.box(s * 1.0, 1.1, 5.91, 0.25, 0.4, 0.02, 0, MT.tail); }
    return mb.build();
  }
  function rider(mb, lean, helmet) {
    mb.box(0, 1.05 + lean * 0, 0.05, 0.38, 0.55, 0.26, 0, helmet === MT.helmetR ? MT.jacket : MT.shirt);
    mb.cyl([0, 1.42, -0.02], [0, 1.62, -0.02], 0.14, 0.13, 8, helmet, true);
    for (const s of [-1, 1]) {
      mb.box(s * 0.16, 0.68, 0.0, 0.12, 0.12, 0.5, 0, MT.jacket);
      mb.box(s * 0.22, 1.08, -0.3, 0.08, 0.08, 0.42, -0.0, MT.skin);
    }
  }
  function scooter() {
    const mb = new MeshBuilder();
    mb.box(0, 0.42, 0.05, 0.36, 0.3, 1.25, 0, MT.paint);
    mb.box(0, 0.65, 0.3, 0.32, 0.12, 0.6, 0, MT.seat);
    mb.box(0, 0.75, -0.55, 0.36, 0.5, 0.14, 0, MT.paint);
    mb.cyl([0, 0.95, -0.55], [0, 1.0, -0.62], 0.04, 0.04, 6, MT.black);
    mb.box(0, 1.0, -0.62, 0.62, 0.04, 0.04, 0, MT.black);
    for (const z of [-0.62, 0.58]) mb.cyl([-0.05, 0.25, z], [0.05, 0.25, z], 0.25, 0.25, 10, MT.tire, true);
    mb.box(0, 0.9, -0.63, 0.14, 0.1, 0.03, 0, MT.head);
    mb.box(0, 0.6, 0.69, 0.18, 0.08, 0.02, 0, MT.tail);
    rider(mb, 0, MT.helmet);
    return mb.build();
  }
  function heavyBike() {
    const mb = new MeshBuilder();
    mb.box(0, 0.62, 0.0, 0.42, 0.42, 1.2, 0, MT.paint);
    mb.box(0, 0.86, -0.4, 0.46, 0.3, 0.5, 0, MT.paint);
    mb.box(0, 0.82, 0.38, 0.3, 0.12, 0.55, 0, MT.seat);
    mb.box(0, 0.5, 0.0, 0.34, 0.3, 0.5, 0, MT.chrome);
    for (const z of [-0.75, 0.72]) mb.cyl([-0.08, 0.32, z], [0.08, 0.32, z], 0.32, 0.32, 12, MT.tire, true);
    mb.box(0, 0.95, -0.66, 0.16, 0.12, 0.04, 0, MT.head);
    mb.box(0, 0.8, 0.97, 0.16, 0.06, 0.02, 0, MT.tail);
    // 前傾騎士
    mb.box(0, 1.15, 0.12, 0.38, 0.5, 0.3, 0, MT.jacket);
    mb.cyl([0, 1.42, -0.18], [0, 1.6, -0.25], 0.15, 0.14, 8, MT.helmetR, true);
    for (const s of [-1, 1]) { mb.box(s * 0.18, 0.82, 0.25, 0.13, 0.13, 0.55, 0, MT.jacket); mb.box(s * 0.22, 1.08, -0.3, 0.08, 0.08, 0.5, 0, MT.jacket); }
    return mb.build();
  }

  const TYPES = {
    sedan: { len: 4.4, wid: 1.7, vmax: [52, 72], alat: 2.6, acc: 1.8, colors: ['#e8e8e8', '#1a1a1a', '#8a8f94', '#7a1a1a', '#1c2e55', '#c8c8c4', '#3a4a3a'], rad: 1.0 },
    truck: { len: 4.9, wid: 1.7, vmax: [45, 62], alat: 2.0, acc: 1.3, colors: ['#ececec'], rad: 1.05 },
    bus: { len: 11.8, wid: 2.5, vmax: [38, 52], alat: 1.5, acc: 0.8, colors: ['#e9e4d8', '#f2f2f2', '#d8c070'], rad: 1.4 },
    scooter: { len: 1.8, wid: 0.7, vmax: [40, 55], alat: 2.8, acc: 1.6, colors: ['#e8e8e8', '#b5121b', '#2a5a9a', '#1a1a1a', '#e8c020'], rad: 0.5, bike: true },
    heavy: { len: 2.2, wid: 0.8, vmax: [62, 85], alat: 4.2, acc: 3.0, colors: ['#1a1a1a', '#c81010', '#f0f0f0', '#1a3f8a', '#e86a10'], rad: 0.55, bike: true },
  };
  // 碰撞質量 (含乘員)；大車視為不可推動
  const MASS = { scooter: 230, heavy: 320, sedan: 1250, truck: 1700, bus: Infinity };
  let MIX = [['sedan', 0.48], ['truck', 0.14], ['bus', 0.05], ['scooter', 0.17], ['heavy', 0.16]];

  class Traffic {
    constructor(road) {
      this.road = road;
      this.models = { sedan: sedan(), truck: lightTruck(), bus: bus(), scooter: scooter(), heavy: heavyBike() };
      this.list = [];
      this.rnd = RM.rng(1234);
      this.enabled = true;
      this.density = 1;
      this._f = {};
      this.m = RM.m4.c();
    }
    pickType() {
      let r = this.rnd(), acc = 0;
      for (const [t, p] of MIX) { acc += p; if (r < acc) return t; }
      return 'sedan';
    }
    spawn(s, dir, v) {
      const type = this.pickType(), T = TYPES[type];
      const vmax = (T.vmax[0] + this.rnd() * (T.vmax[1] - T.vmax[0])) / 3.6;
      const color = RM.srgb(T.colors[Math.floor(this.rnd() * T.colors.length)]);
      const r = this.road;
      const laneAbs = T.bike && type === 'scooter' ? (r.laneOut || 1.75) + 1.1 : (T.big || type === 'bus' || /truck|delivery|van/.test(type) || this.rnd() < 0.6) ? (r.laneOut || 1.75) : (r.laneIn || 1.75);
      this.list.push({ type, T, s, dir, v: v === undefined ? vmax * 0.8 : v, vmax, color, lane: dir * laneAbs, wob: this.rnd() * 10, pos: [0, 0, 0], yaw: 0, pitch: 0, roll: 0, lean: 0, brake: 0, hit: 0 });
    }
    clear() { this.list.length = 0; }
    // 載入 three.js 模型後：加入 Kenney 車款，保留遊覽車與機車
    setModels(CM) {
      const mix = [];
      for (const t of CM.TRAFFIC) {
        const asset = CM.assets['traffic:' + t.key];
        if (!asset) continue;
        const key = 'm:' + t.key;
        TYPES[key] = { len: t.dims[0], wid: t.dims[1], vmax: t.vmax, alat: t.alat, acc: t.acc, colors: ['#ffffff'], rad: t.dims[1] * 0.55, big: !!t.big };
        MASS[key] = t.mass;
        this.models[key] = asset;
        mix.push([key, t.w]);
      }
      if (!mix.length) return;
      mix.push(['bus', 3], ['scooter', 11], ['heavy', 9]);
      const tot = mix.reduce((a, m) => a + m[1], 0);
      MIX = mix.map(([k, w]) => [k, w / tot]);
      this.clear();
    }

    update(dt, car, pdir, ps) {
      if (!this.enabled) { this.list.length = 0; return; }
      const road = this.road, L = road.length;
      // 維持數量：前方對向車、同向車
      const wantOn = Math.round(9 * this.density), wantSame = Math.round(4 * this.density);
      let on = 0, same = 0;
      for (let i = this.list.length - 1; i >= 0; i--) {
        const a = this.list[i];
        const rel = (a.s - ps) * pdir;
        if (rel < -500 || rel > 2200 || a.s < 5 || a.s > L - 5 || (a.free && a.freeT > 45 && Math.abs(rel) > 150)) { this.list.splice(i, 1); continue; }
        if (a.dir === pdir) same++; else on++;
      }
      let guard = 0;
      while (on < wantOn && guard++ < 20) {
        const rel = 400 + this.rnd() * 1700;
        const s = ps + pdir * rel;
        if (s > 10 && s < L - 10 && this._free(s, -pdir)) { this.spawn(s, -pdir); on++; } else break;
      }
      guard = 0;
      while (same < wantSame && guard++ < 20) {
        const rel = this.rnd() < 0.7 ? 250 + this.rnd() * 1500 : -(200 + this.rnd() * 250);
        const s = ps + pdir * rel;
        if (s > 10 && s < L - 10 && this._free(s, pdir)) { this.spawn(s, pdir); same++; } else break;
      }
      // 依車道排序找前車
      const f = this._f;
      for (const a of this.list) {
        if (a.free) { this._freeStep(a, dt); continue; }
        // 曲率前瞻
        let vc = a.vmax;
        for (let k = 0; k <= 80; k += 10) {
          road.frameAt(clamp(a.s + a.dir * k, 0, L), f);
          const kk = Math.abs(f.k);
          if (kk > 1e-4) vc = Math.min(vc, Math.sqrt(a.T.alat / kk) * (1 + k / 160));
        }
        // 前車 (同向)
        let gap = 1e9, vLead = 0;
        for (const b of this.list) {
          if (b === a || b.dir !== a.dir || Math.abs(b.lane - a.lane) > 1.6) continue;
          const d = (b.s - a.s) * a.dir;
          if (d > 0 && d < gap) { gap = d - (a.T.len + b.T.len) / 2; vLead = b.v; }
        }
        // 玩家
        if (car) {
          const pd = (ps - a.s) * a.dir;
          const lat = car.lat;
          if (pd > 0 && pd < gap + 10 && Math.abs(lat - a.lane) < 1.9) { gap = pd - (a.T.len + 4.4) / 2; vLead = Math.max(0, car.vAlong * a.dir); }
        }
        // IDM
        const v0 = Math.min(vc, a.vmax) * (a.hit > 0 ? 0 : 1);
        const s0 = 4, Tg = 1.4, am = a.T.acc, bc = 3.0;
        const ss = s0 + Math.max(0, a.v * Tg + (a.v * (a.v - vLead)) / (2 * Math.sqrt(am * bc)));
        let acc = am * (1 - Math.pow(a.v / Math.max(v0, 0.5), 4) - Math.pow(ss / Math.max(gap, 0.5), 2));
        acc = clamp(acc, -8, am);
        a.brake = acc < -0.8 ? 1 : 0;
        a.v = Math.max(0, a.v + acc * dt);
        a.hit = Math.max(0, a.hit - dt);
        a.s += a.v * a.dir * dt;
        a.wob += dt;
        // 位置/姿態
        road.frameAt(a.s, f);
        const lane = a.lane + Math.sin(a.wob * 0.3) * (a.T.bike ? 0.35 : 0.12) - a.dir * Math.min(0.6, Math.abs(f.k) * 10) * Math.sign(f.k) * a.dir * 0;
        a.pos[0] = f.x + f.rx * lane; a.pos[2] = f.z + f.rz * lane;
        a.pos[1] = f.y + road.surfOff(f.i, f.t, lane);
        a.yaw = Math.atan2(-f.tx * a.dir, -f.tz * a.dir);
        a.pitch = Math.atan(f.grade * a.dir);
        const b = road.bank[f.i];
        a.roll = Math.atan(b) * (lane > 0 ? 1 : 1);
        if (a.T.bike) a.lean += (Math.atan((a.v * a.v * f.k * a.dir) / 9.81) - a.lean) * Math.min(1, dt * 4);
      }
      // 與玩家碰撞
      if (car) this._collide(car);
    }
    _free(s, dir) {
      for (const a of this.list) if (a.dir === dir && Math.abs(a.s - s) < 40) return false;
      return true;
    }
    _makeFree(a) {
      const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
      a.free = true; a.freeT = 0;
      a.fv = [fx * a.v, 0, fz * a.v];
      const Q = RM.quat;
      const qy = Q.axisAngle([0, 0, 0, 1], [0, 1, 0], a.yaw);
      const qp = Q.axisAngle([0, 0, 0, 1], [1, 0, 0], a.pitch);
      const qr = Q.axisAngle([0, 0, 0, 1], [0, 0, 1], -(a.lean || 0));
      a.q = Q.mul([0, 0, 0, 1], Q.mul([0, 0, 0, 1], qy, qp), qr);
      a.w = [0, 0, 0];
      a.hint = { i: Math.round(a.s / this.road.sp) };
      a.lieSide = Math.random() < 0.5 ? 1 : -1;
    }

    // 被撞後：重力、翻滾、彈跳、滑行摩擦
    _freeStep(a, dt) {
      const road = this.road, Q = RM.quat;
      a.freeT += dt;
      a.fv[1] -= 9.81 * dt;
      for (let k = 0; k < 3; k++) a.pos[k] += a.fv[k] * dt;
      Q.integrate(a.q, a.w, dt);
      const gr = road.ground(a.pos[0], a.pos[2], a.hint);
      const floor = a.T.bike ? 0.12 : 0;
      a.brake = 1;
      if (a.pos[1] <= gr.y + floor) {
        a.pos[1] = gr.y + floor;
        if (a.fv[1] < 0) a.fv[1] = a.fv[1] < -2 ? -a.fv[1] * 0.25 : 0;
        const sp = Math.hypot(a.fv[0], a.fv[2]);
        const dec = (a.T.bike ? 5.5 : 7.0) * dt;
        const fr = sp > dec ? (sp - dec) / sp : 0;
        a.fv[0] *= fr; a.fv[2] *= fr;
        const damp = Math.exp(-dt * (a.T.bike ? 2.5 : 2.0));
        for (let k = 0; k < 3; k++) a.w[k] *= damp;
        // 姿態回穩：機車倒向一側，汽車保持輪子著地
        const R = Q.toMat3(new Float32Array(9), a.q);
        const fl = Math.hypot(R[6], R[8]) || 1;
        const yaw = Math.atan2(R[6] / fl, R[8] / fl);
        const qy = Q.axisAngle([0, 0, 0, 1], [0, 1, 0], yaw);
        const target = a.T.bike ? Q.mul([0, 0, 0, 1], qy, Q.axisAngle([0, 0, 0, 1], [0, 0, 1], a.lieSide * 1.45)) : qy;
        const tt = Math.min(1, dt * (sp < 3 ? 4 : 1.2));
        const dot = a.q[0] * target[0] + a.q[1] * target[1] + a.q[2] * target[2] + a.q[3] * target[3];
        const sg = dot < 0 ? -1 : 1;
        for (let k = 0; k < 4; k++) a.q[k] += (target[k] * sg - a.q[k]) * tt;
        Q.norm(a.q, a.q);
      }
      // 護欄/山壁
      const pr = road.project(a.pos[0], a.pos[2], a.hint.i, {});
      a.hint.i = pr.i;
      const side = pr.d >= 0 ? 1 : 0;
      const wall = road.wall[side][pr.i] - a.T.wid * 0.4;
      if (Math.abs(pr.d) > wall) {
        const sg = pr.d >= 0 ? 1 : -1;
        const nx = -road.rx[pr.i] * sg, nz = -road.rz[pr.i] * sg;
        const pen = Math.abs(pr.d) - wall;
        a.pos[0] += nx * pen; a.pos[2] += nz * pen;
        const vn = a.fv[0] * nx + a.fv[2] * nz;
        if (vn < 0) { a.fv[0] -= nx * vn * 1.3; a.fv[2] -= nz * vn * 1.3; a.w[1] += vn * 0.3; }
      }
      a.s = pr.fi * road.sp;
      a.v = Math.hypot(a.fv[0], a.fv[2]);
      const R2 = Q.toMat3(new Float32Array(9), a.q);
      a.yaw = Math.atan2(R2[6], R2[8]);
    }

    // 與玩家碰撞：依質量交換動量 (機車被撞飛、汽車互撞、大車不動)
    _collide(car) {
      const R = car.R;
      const back = [R[6], R[7], R[8]];
      const pc = [-1.2, 0.35, 1.9].map((z) => [car.pos[0] + back[0] * z, car.pos[2] + back[2] * z]);
      for (const a of this.list) {
        const dx0 = a.pos[0] - car.pos[0], dz0 = a.pos[2] - car.pos[2];
        if (dx0 * dx0 + dz0 * dz0 > 120) continue;
        if (Math.abs(a.pos[1] - car.pos[1]) > 3) continue;
        const n = Math.max(1, Math.round(a.T.len / 2));
        const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
        const mA = MASS[a.type] || 1250;
        for (let k = 0; k < n; k++) {
          const off = (k / Math.max(n - 1, 1) - 0.5) * (a.T.len - a.T.wid);
          const ax = a.pos[0] + fx * off, az = a.pos[2] + fz * off;
          for (const p of pc) {
            const dx = p[0] - ax, dz = p[1] - az;
            const d = Math.hypot(dx, dz), rr = 0.88 + a.T.rad;
            if (!(d < rr && d > 1e-4)) continue;
            const nrm = [dx / d, 0, dz / d];
            const P = [ax + nrm[0] * a.T.rad, car.pos[1], az + nrm[2] * a.T.rad];
            const vA = a.free ? a.fv : [fx * a.v, 0, fz * a.v];
            const r = [P[0] - car.pos[0], P[1] - car.pos[1], P[2] - car.pos[2]];
            const vpx = car.vel[0] + car.w[1] * r[2] - car.w[2] * r[1];
            const vpz = car.vel[2] + car.w[0] * r[1] - car.w[1] * r[0];
            const vn = (vpx - vA[0]) * nrm[0] + (vpz - vA[2]) * nrm[2];
            const invP = car._invMassAlong(r, nrm), invA = isFinite(mA) ? 1 / mA : 0;
            // 位置分離 (依質量比)
            const pen = rr - d, share = invP / (invP + invA);
            car.pos[0] += nrm[0] * pen * share; car.pos[2] += nrm[2] * pen * share;
            if (invA > 0) { a.pos[0] -= nrm[0] * pen * (1 - share); a.pos[2] -= nrm[2] * pen * (1 - share); }
            if (vn >= 0) continue;
            const e = a.T.bike ? 0.15 : 0.25;
            const j = (-(1 + e) * vn) / (invP + invA);
            car._impulse(P, [nrm[0] * j, 0, nrm[2] * j]);
            const kind = !isFinite(mA) ? 'bus' : a.T.bike ? 'bike' : 'car';
            car.events.push({ type: kind, v: -vn });
            if (!isFinite(mA)) { a.hit = 3; continue; } // 大車：不會被推動
            if (!a.free) this._makeFree(a);
            a.fv[0] -= (nrm[0] * j) / mA; a.fv[2] -= (nrm[2] * j) / mA;
            if (a.T.bike) {
              // 機車：被撞飛、翻滾
              a.fv[1] += 2.2 + Math.min(6, -vn * 0.45);
              const spin = 2.5 + Math.min(9, -vn * 0.5);
              a.w = [(Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin * 0.6, (Math.random() < 0.5 ? -1 : 1) * spin];
            } else {
              // 汽車：依力臂產生旋轉
              const rx = P[0] - a.pos[0], rz = P[2] - a.pos[2];
              const I = (mA * (a.T.len * a.T.len + a.T.wid * a.T.wid)) / 12;
              const ty = rz * (-nrm[0] * j) - rx * (-nrm[2] * j);
              a.w[1] += ty / I;
              a.fv[1] += Math.min(0.6, -vn * 0.04);
            }
          }
        }
      }
    }

    // 收集夜間車燈
    glows(out, night) {
      for (const a of this.list) {
        const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
        const rx = -fz, rz = fx;
        const half = a.T.len / 2;
        const lights = a.T.bike ? [[0, 0.95]] : [[-0.6, 0.7], [0.6, 0.7]];
        for (const [x, y] of lights) {
          out.push(a.pos[0] + fx * (half + 0.1) + rx * x, a.pos[1] + y, a.pos[2] + fz * (half + 0.1) + rz * x, a.T.bike ? 1.2 : 1.5, 1.0, 0.92, 0.75, 1.8 * night + 0.0);
          out.push(a.pos[0] - fx * (half + 0.05) + rx * x, a.pos[1] + y + 0.08, a.pos[2] - fz * (half + 0.05) + rz * x, 0.7, 1.0, 0.05, 0.02, (0.9 + a.brake * 2.2) * Math.max(night, a.brake * 0.6));
        }
      }
    }
  }

  RM.Traffic = Traffic;
})();
