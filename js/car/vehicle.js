'use strict';
// 喜美 K8 1.6 自排 車輛動力學
// 剛體 6 自由度 + 四輪獨立懸吊 (雙A臂) + 防傾桿 + Pacejka 綜合滑移輪胎 + 扭力轉換器 + 4AT
(function () {
  const RM = window.RM;
  const { v3, quat, clamp, lerp } = RM;

  // ------------------------------------------------------------------ 規格
  const SPEC = {
    mass: 1150 + 75,                    // 自排車重 ~1150 kg + 駕駛
    inertia: [1950, 2150, 480],          // 俯仰(x) / 偏航(y) / 側傾(z)  kg·m²
    cgH: 0.53,
    a: 1.022, b: 1.598,                  // 重心到前/後軸 (前軸重 61%)
    trackF: 1.475, trackR: 1.465,
    tireR: 0.298,                        // 185/65 R14
    wheelI: [1.05, 0.85],
    kSpring: [33000, 25000], cBump: [2300, 1700], cReb: [3600, 2700],
    arb: [15000, 3800],
    travelUp: 0.085, travelDown: 0.13,
    mu: 1.18, muRear: 1.06, crr: 0.012,
    cd: 0.33, area: 1.95, lift: 0.08,
    brakeF: 1450, brakeR: 620, handbrake: 1300,
    steerMax: 38 * Math.PI / 180,
    // D16 SOHC VTEC 1590cc：125 PS / 6600 rpm、14.8 kgm / 5500 rpm
    idle: 750, redline: 6800, cut: 7100, engI: 0.14,
    torque: [[0, 70], [800, 92], [1000, 100], [1500, 110], [2000, 118], [2500, 124], [3000, 129], [3500, 133], [4000, 136], [4500, 138], [5000, 141], [5500, 145], [6000, 141], [6500, 136], [6800, 130], [7200, 118], [8000, 80]],
    vtec: 5500,
    // Honda 4 速自排
    ratios: [2.722, 1.469, 0.975, 0.674], rev: 1.955, final: 4.357, eff: 0.9,
    // 扭力轉換器 K 因子 (rpm/√Nm) 與扭力倍增比
    tcSR: [0, 0.2, 0.4, 0.6, 0.75, 0.85, 0.9, 0.95, 0.98, 1.0],
    tcK: [200, 202, 205, 213, 232, 262, 300, 420, 800, 3000],
    tcTR: [2.05, 1.85, 1.62, 1.4, 1.2, 1.0, 1.0, 1.0, 1.0, 1.0],
    tank: 45,
    // 起步輔助：低速時依油門給的額外推力 [牛頓, 開始遞減的車速, 歸零的車速 (km/h)]，引擎還在拉轉速時就有推力
    launch: [4900, 10, 65],
    // 甩尾 / 氮氣的車款差異 (各車款檔可只覆寫其中幾項)：
    //   angle 甩尾角 (弧度)、angleIn 按住內側鍵多甩的角度、turn 行進方向的轉彎速度倍率、drag 甩尾中的減速上限 (m/s²)、
    //   charge 集氣速度倍率、boost 甩尾結束的小加速推力 (牛頓)、nitro 氮氣推力 (牛頓)、start 彈射起步在氮氣之外多給的推力 (牛頓)
    drift: { angle: 0.36, angleIn: 0.18, turn: 1, drag: 1.3, charge: 1, boost: 3400, nitro: 4200, start: 8000 },
    // 底盤配重 (重底盤、低重心的效果)：只在超出正常行駛範圍時介入，平常的速度、過彎、甩尾都不受影響
    //   tilt 車身相對路面傾斜超過幾度才開始壓回來、roll / pitch 壓回來的力道 (車重 × 幾公尺，每弧度)、damp 傾斜時的搖晃阻尼 (1/秒)、
    //   air 四輪離地時多加幾倍重力把車拉回地面、fz 離開柏油的輪子的懸吊力上限 (幾倍車重；壓到水溝 / 路緣不會整台被彈起來)
    plant: { tilt: 7, roll: 8, pitch: 16, damp: 18, air: 1, fz: 1.5 },
    drive: 'FF', cyl: 4, dct: false, cgZ: -0.343, speedoMax: 180,
    shiftTable: { up: [[15, 60], [32, 112], [50, 166]], dn: [[9, 48], [21, 96], [36, 146]] },
    box: { hw: 0.85, front: 1.88, rear: 2.55, bottom: -0.36, top: 0.84 },
    eye: [-0.37, 0.6, 0.643], hood: [0, 0.53, -0.607], bumper: [0, -0.05, -1.977],
    // exhaust：排氣尾管口 (相對重心，氮氣火焰從這裡噴)。K8 是右後單出 (civic_model.js 的尾管)；
    // 多支尾管的車款在車款檔另外給 exhausts: [[x, y, z], ...]，每一支都噴 (main.js)
    lampF: [0.49, 0.03, -1.83], lampR: [0.6, 0.2, 2.48], exhaust: [0.44, -0.31, 2.53],
  };
  const SELECTOR = ['P', 'R', 'N', 'D4', 'D3', '2', '1'];

  function interp(tab, x) {
    if (x <= tab[0][0]) return tab[0][1];
    for (let i = 0; i < tab.length - 1; i++) {
      if (x <= tab[i + 1][0]) { const t = (x - tab[i][0]) / (tab[i + 1][0] - tab[i][0]); return tab[i][1] + (tab[i + 1][1] - tab[i][1]) * t; }
    }
    return tab[tab.length - 1][1];
  }
  function interpArr(xs, ys, x) {
    if (x <= xs[0]) return ys[0];
    for (let i = 0; i < xs.length - 1; i++) if (x <= xs[i + 1]) { const t = (x - xs[i]) / (xs[i + 1] - xs[i]); return ys[i] + (ys[i + 1] - ys[i]) * t; }
    return ys[ys.length - 1];
  }

  // 綜合滑移 (similarity) magic formula
  function tire(Fz, kappa, alpha, mu, out) {
    const kp = 0.11, ap = 0.135;
    const sx = kappa / kp, sy = alpha / ap;
    const s = Math.hypot(sx, sy);
    if (s < 1e-7 || Fz <= 0) { out[0] = 0; out[1] = 0; return out; }
    const F = mu * Fz * Math.sin(1.32 * Math.atan(2.42 * s));
    out[0] = (F * sx) / s;
    out[1] = (-F * sy) / s * 0.97;
    return out;
  }

  class Vehicle {
    constructor(road, spec = SPEC) {
      this.road = road; this.S = spec;
      this.pos = [0, 0, 0]; this.q = [0, 0, 0, 1]; this.vel = [0, 0, 0]; this.w = [0, 0, 0];
      this.R = new Float32Array(9);
      const S = spec;
      this.wheels = [];
      for (let k = 0; k < 4; k++) {
        const front = k < 2, left = k % 2 === 0;
        const x = (left ? -1 : 1) * (front ? S.trackF : S.trackR) / 2;
        const z = front ? -S.a : S.b;
        const ax = front ? 0 : 1;
        const lenStatic = S.cgH - S.tireR;
        const load = (S.mass * 9.81 * (front ? S.b : S.a)) / (S.a + S.b) / 2;
        const L0 = lenStatic + load / S.kSpring[ax];
        this.wheels.push({
          k, front, left, ax, anchor: [x, 0, z], L0, lenStatic,
          lenMin: lenStatic - S.travelUp, lenMax: lenStatic + S.travelDown,
          len: lenStatic, lenPrev: lenStatic, comp: 0, w: 0, angle: 0, steer: 0,
          Fz: 0, Fx: 0, Fy: 0, kappa: 0, alpha: 0, contact: false, surf: 0, hint: { i: 0 },
          absScale: 1, slipVel: 0, wpos: [0, 0, 0], gn: [0, 1, 0], mu: 1,
        });
      }
      // 傳動
      this.rpm = S.idle; this.we = (S.idle * Math.PI) / 30;
      this.sel = 3; this.gear = 1; this.shiftT = 0; this.shiftDur = 0; this.shiftFrom = 1; this.shiftTo = 1;
      this.locked = false; this.fuelCut = false; this.engineOn = true;
      this.throttle = 0; this.brake = 0; this.hand = 0; this.steerIn = 0; this.steer = 0;
      this.abs = true;
      this.fuel = 38; this.odo = 0; this.trip = 0;
      this.hint = { i: 0 };
      this.events = [];
      this.tcTurbineTq = 0; this.engTq = 0; this.load = 0;
      this.speed = 0; this.vLong = 0;
      this.dirtiness = 0;
      this._f = [0, 0, 0]; this._t = [0, 0, 0]; this._tmp = [0, 0, 0]; this._tf = [0, 0];
      this.msg = null;
      // 跑跑卡丁車式甩尾 / 氮氣
      this.drifting = false; this.driftDir = 0; this.driftT = 0; this.steerIn = 0;
      this.gauge = 0; this.nitro = 0; this.nitroT = 0; this.boostT = 0; this.boostF = 0; this.beta = 0;
    }
    useNitro() {
      if (this.nitro > 0 && this.nitroT <= 0) { this.nitro--; this.nitroT = 3.0; this.events.push('nitro'); this.addGauge(0); }
    }
    // 彈射起步 (起跑倒數按得準的獎勵，見 js/game/start.js)：不消耗氮氣瓶的短噴射，推力 = 氮氣 + drift.start
    startBoost(sec = 1.8) {
      this.nitroT = Math.max(this.nitroT, sec);
      this.boostT = Math.max(this.boostT, sec); this.boostF = this.S.drift.start;
    }
    // 集氣：滿格換一瓶氮氣 (最多 2 瓶)；瓶子滿了就停在滿格，用掉一瓶時立刻補上
    addGauge(x) {
      this.gauge += x;
      while (this.gauge >= 1) {
        if (this.nitro >= 2) { this.gauge = 1; break; }
        this.gauge -= 1; this.nitro++; this.events.push('nitroGet');
      }
    }

    get selName() { return SELECTOR[this.sel]; }
    _finite() {
      const a = this.pos, b = this.vel, c = this.w, q = this.q;
      return isFinite(a[0] + a[1] + a[2] + b[0] + b[1] + b[2] + c[0] + c[1] + c[2] + q[0] + q[1] + q[2] + q[3] + this.we);
    }

    reset(s, dir) {
      const road = this.road;
      const f = road.frameAt(s, {});
      const lane = dir * (road.laneOut || 1.75);
      const x = f.x + f.rx * lane, z = f.z + f.rz * lane;
      const y = f.y + road.surfOff(f.i, f.t, lane) + this.S.cgH + 0.02;
      this.pos = [x, y, z];
      // 車頭 = -z_local；面向 dir*t
      const fwd = [f.tx * dir, f.grade * dir, f.tz * dir];
      v3.norm(fwd, fwd);
      const right = v3.norm([0, 0, 0], v3.cross([0, 0, 0], fwd, [0, 1, 0]));
      const up = v3.cross([0, 0, 0], right, fwd);
      const back = [-fwd[0], -fwd[1], -fwd[2]];
      quat.fromBasis(this.q, right, up, back);
      this.vel = [0, 0, 0]; this.w = [0, 0, 0];
      this.hint.i = f.i;
      for (const w of this.wheels) { w.w = 0; w.hint.i = f.i; w.len = w.lenPrev = w.lenStatic; w.absScale = 1; }
      this.we = (this.S.idle * Math.PI) / 30; this.rpm = this.S.idle;
      this.locked = false; this.shiftT = 0;
    }

    // 簡易排檔：D (前進，自動 1~4 檔) / R (倒車)
    setDrive(mode) {
      if (mode === 'R') {
        if (this.sel === 1) return;
        if (this.vLong > 1.5) { this.msg = '請先停車，再排 R 檔'; return; }
        this.sel = 1; this.gear = 1; this.shiftT = 0; this.locked = false;
      } else {
        if (this.sel === 3) return;
        if (this.vLong < -1.5) { this.msg = '請先停車，再排 D 檔'; return; }
        this.sel = 3; this.gear = 1; this.shiftT = 0; this.locked = false;
      }
      this.events.push('selector');
    }
    get driveName() { return this.sel === 1 ? 'R' : 'D'; }

    // 換檔桿 (完整 P R N D4 D3 2 1，保留給進階使用)
    shiftSelector(delta) {
      const v = Math.abs(this.vLong) * 3.6;
      const ns = clamp(this.sel + delta, 0, SELECTOR.length - 1);
      if (ns === this.sel) return;
      const from = SELECTOR[this.sel], to = SELECTOR[ns];
      if (from === 'P' && this.brake < 0.25) { this.msg = '排出 P 檔需踩住煞車 (Shift Lock)'; return; }
      if (to === 'R' && this.vLong > 2) { this.msg = '車子仍在前進，無法排入 R 檔'; return; }
      if (to === 'P' && v > 4) { this.msg = '車速過高，P 檔無法咬合'; return; }
      this.sel = ns;
      this.events.push('selector');
      if (to === 'D4' || to === 'D3') this._startShift(Math.max(1, Math.min(this.gear, to === 'D3' ? 3 : 4)), true);
      if (to === '2') this._startShift(2);
      if (to === '1') this._startShift(this._safeGear(1));
    }
    _safeGear(g) {
      // 避免降檔超轉
      const wOut = this._outW();
      while (g < this.S.ratios.length && Math.abs(wOut * this.S.ratios[g - 1] * this.S.final) * 30 / Math.PI > this.S.redline - 500) g++;
      return g;
    }
    _outW() {
      const W = this.wheels, d = this.S.drive;
      if (d === 'FR') return (W[2].w + W[3].w) / 2;
      if (d === 'AWD') return (W[0].w + W[1].w + W[2].w + W[3].w) / 4;
      return (W[0].w + W[1].w) / 2;
    }
    _driveShare(w) {
      const d = this.S.drive;
      if (d === 'FR') return w.front ? 0 : 0.5;
      if (d === 'AWD') return w.front ? 0.2 : 0.3;
      return w.front ? 0.5 : 0;
    }
    _startShift(to, silent) {
      if (to === this.gear && !this.shiftT) return;
      this.shiftFrom = this.gear; this.shiftTo = to;
      this.shiftDur = this.S.dct ? (to > this.gear ? 0.14 : 0.12) : (to > this.gear ? 0.48 : 0.36);
      this.shiftT = this.shiftDur;
      this.locked = false;
      if (!silent) this.events.push(to > this.gear ? 'upshift' : 'downshift');
    }

    // 自動變速箱換檔邏輯 (TCU)
    _tcu(dt) {
      const sel = SELECTOR[this.sel];
      if (this.shiftT > 0) {
        this.shiftT -= dt;
        if (this.shiftT <= this.shiftDur * 0.6 && this.gear !== this.shiftTo) this.gear = this.shiftTo;
        if (this.shiftT <= 0) { this.shiftT = 0; this.gear = this.shiftTo; }
        return;
      }
      // 換檔依據的轉速：取驅動輪與車身兩者較快的。氮氣 / 起步輔助把車推得比驅動輪快時，才不會卡在低檔撞紅線
      const wOut = Math.max(this._outW(), this.vLong / this.S.tireR);
      const kmh = wOut * this.S.tireR * 3.6;
      const thr = this.throttle;
      const S = this.S, nG = S.ratios.length;
      let maxG = nG, minG = 1;
      if (sel === 'D3') maxG = Math.min(3, nG);
      else if (sel === '2') { maxG = 2; minG = 2; }
      else if (sel === '1') { maxG = this._safeGear(1); minG = 1; }
      else if (sel !== 'D4') return;
      const tp = Math.pow(thr, 1.3);
      const g = this.gear;
      if (S.shiftTable) {
        const UP = S.shiftTable.up, DN = S.shiftTable.dn;
        if (g < maxG) {
          const [lo, hi] = UP[g - 1];
          if (kmh > lo + (hi - lo) * tp) { this._startShift(g + 1); return; }
        }
        if (g > minG) {
          const [lo, hi] = DN[g - 2];
          const kd = thr > 0.88 ? hi : lo + (hi - lo) * Math.pow(thr, 1.6) * 0.75;
          if (kmh < kd) { this._startShift(g - 1); return; }
        }
      } else {
        const wo = Math.abs(wOut) * S.final * 30 / Math.PI;
        const rpmG = (gg) => wo * S.ratios[gg - 1];
        const upR = S.idle + 1100 + (S.redline - 250 - S.idle - 1100) * tp;
        const dnR = thr > 0.88 ? S.redline * 0.62 : S.idle + 450 + (S.redline * 0.5 - S.idle - 450) * Math.pow(thr, 1.5);
        // 引擎快撞斷油也要升檔：扭力轉換器有滑差，引擎會比車輪先到轉速上限，光看輪速的話上坡會卡在斷油轉速加不上去
        if (g < maxG && (rpmG(g) > upR || this.rpm > (S.redline + S.cut) / 2)) { this._startShift(g + 1); return; }
        if (g > minG && rpmG(g) < dnR && rpmG(g - 1) < S.redline - 700) { this._startShift(g - 1); return; }
      }
      if (g > maxG) this._startShift(maxG);
      if (g < minG) this._startShift(minG);
      if (S.dct) { this.locked = sel === 'D4' && kmh > 12; return; }
      // 鎖定離合器 (D4 四檔)
      this.locked = sel === 'D4' && g === nG && kmh > 68 && thr < 0.7;
    }

    // 扭力轉換器
    _converter(we, wt) {
      const S = this.S;
      const rpmE = (we * 30) / Math.PI, rpmT = (wt * 30) / Math.PI;
      if (rpmE < 1) return [0, 0];
      if (wt <= we) {
        const sr = Math.max(0, wt / we);
        const K = interpArr(S.tcSR, S.tcK, sr);
        const Ti = Math.min((rpmE / K) ** 2, S.tcMaxT || 1500);
        return [Ti, Ti * interpArr(S.tcSR, S.tcTR, sr)];
      }
      // 反驅動 (引擎煞車經轉換器，較弱)
      const sr = we / Math.max(wt, 1e-3);
      const K = interpArr(S.tcSR, S.tcK, sr) * 1.25;
      const T = -Math.min((rpmT / K) ** 2, S.tcMaxT || 1500);
      return [T, T];
    }

    // 引擎扭力
    _engine(rpm, thrPedal) {
      const S = this.S;
      let thr = Math.pow(thrPedal, 1.25);
      // 怠速控制
      const idleThr = clamp(0.035 + (S.idle - rpm) * 0.0016, 0, 0.3);
      thr = Math.max(thr, idleThr);
      if (rpm > S.cut) this.fuelCut = true;
      if (this.fuelCut && rpm < S.cut - 180) this.fuelCut = false;
      if (this.fuelCut) thr = 0;
      if (!this.engineOn) thr = 0;
      const fric = (9 + rpm * 0.0042) * (S.fricScale || 1);
      const tq = interp(S.torque, rpm) * thr - fric * (1 - thr) * 1.0;
      this.load = thr;
      return { tq, fric };
    }

    // ------------------------------------------------------------------ 主更新
    update(dt, input) {
      if (this._broke) this._broke.clear(); // 本幀已撞斷的物件 (避免子步驟重複觸發)
      // 輸入平滑 (腳踩踏板也有速度)
      this.throttle = lerp(this.throttle, input.throttle, 1 - Math.exp(-dt * 12));
      this.brake = lerp(this.brake, input.brake, 1 - Math.exp(-dt * (input.brake > this.brake ? 9 : 14)));
      this.hand = input.hand ? Math.min(1, this.hand + dt * 6) : Math.max(0, this.hand - dt * 5);
      const v = Math.hypot(this.vel[0], this.vel[2]);
      // 依抓地力限制轉向角：低速可全打 (38°)，高速只給輪胎能承受的角度，避免推頭或甩尾
      const L = this.S.a + this.S.b;
      const gripLim = Math.atan((L * 10.5) / Math.max(v * v, 1)) + 6.5 * Math.PI / 180;
      let lim = Math.min(this.S.steerMax, Math.max(gripLim, 6 * Math.PI / 180));
      // 飛越路段 (斷崖前的長陡坡到落地後的緩衝坡，road.js 的 jump)：時速 130 以上方向鍵的舵角漸漸收小 (到 180 以上只給約 3°)。
      // 平常的上限在高速時還有 6～7°，鍵盤每點一下都是輪胎極限，時速 200 以上一修正方向就甩出去
      const zone = this.road.jump && this.road.jump[this.hint.i];
      if (zone) lim = lerp(lim, Math.min(lim, gripLim - 4 * Math.PI / 180), RM.smoothstep(36, 50, v));
      let target = input.steer * lim;
      this.steerIn = input.steer;
      // 飛越區 (斷崖)：空中方向盤自動回正，落地後 0.4 秒內慢慢交還。落地瞬間輪胎負載是平常的好幾倍，帶著舵角落地會直接甩出去
      this.landHold = this._jumpAir ? 1 : Math.max(0, (this.landHold || 0) - dt / 0.4);
      target *= 1 - this.landHold;
      // 甩尾狀態機：按住 Shift + 轉向 + 車速 > 25 km/h
      if (input.drift && !this.drifting && Math.abs(input.steer) > 0.2 && v > 7 && this.sel === 3 && !this._jumpAir) {
        this.drifting = true; this.driftDir = Math.sign(input.steer); this.driftT = 0; this.events.push('driftStart');
        this._dLine = undefined; // 長按輔助的基準路線 (輔助開始時的橫向位置)
      }
      if (this.drifting) {
        this.driftT += dt;
        if (!input.drift || v < 4.5 || this._jumpAir) {
          if (this.driftT > 0.7) { this.boostT = 0.9; this.boostF = this.S.drift.boost; this.events.push('miniBoost'); this.addGauge(0.08); }
          this.drifting = false;
        }
      }
      // 甩尾集氣 (約 1.5~2 秒的甩尾就有一瓶)；一般高速行駛也會慢慢累積
      if (this.drifting) this.addGauge(dt * Math.min(1, v / 14) * (0.45 + Math.min(0.6, Math.abs(this.beta)) * 1.5) * 0.65 * this.S.drift.charge);
      else if (v > 11 && this.nitroT <= 0) this.addGauge(dt * 0.012);
      this.nitroT = Math.max(0, this.nitroT - dt);
      this.boostT = Math.max(0, this.boostT - dt);
      // 甩尾中：前輪自動反打對準行進方向 (卡丁車手感)，方向鍵只微調
      if (this.drifting) target = Math.max(-this.S.steerMax, Math.min(this.S.steerMax, this.beta * 0.9 + input.steer * 0.14));
      const rate = this.drifting ? 7 : (Math.abs(target) > Math.abs(this.steer) && Math.sign(target) === Math.sign(this.steer || target) ? 2.2 : 5.0) * (input.analog ? 3 : 1);
      this.steer += clamp(target - this.steer, -rate * dt, rate * dt);

      if (!(dt > 0)) return;
      const sub = Math.max(1, Math.ceil(dt / (1 / 480)));
      const h = dt / sub;
      // NaN 防護：保存上一個有效狀態
      const good = this._good || (this._good = { pos: [0, 0, 0], vel: [0, 0, 0], w: [0, 0, 0], q: [0, 0, 0, 1], we: 0, ww: [0, 0, 0, 0], len: [0, 0, 0, 0] });
      v3.copy(good.pos, this.pos); v3.copy(good.vel, this.vel); v3.copy(good.w, this.w);
      good.q[0] = this.q[0]; good.q[1] = this.q[1]; good.q[2] = this.q[2]; good.q[3] = this.q[3]; good.we = this.we;
      for (let k = 0; k < 4; k++) { good.ww[k] = this.wheels[k].w; good.len[k] = this.wheels[k].len; }
      const sp0 = Math.hypot(this.vel[0], this.vel[2]);
      const vx0 = this.vel[0], vz0 = this.vel[2];
      for (let s = 0; s < sub; s++) this._step(h);
      if (this.drifting && this._finite()) {
        const R = quat.toMat3(this.R, this.q);
        const fx = -R[6], fz = -R[8];
        const fl = Math.hypot(fx, fz) || 1;
        const vx = this.vel[0], vz = this.vel[2];
        const sp = Math.hypot(vx, vz);
        if (sp > 1) {
          const ang = Math.atan2(fx / fl * vz - fz / fl * vx, fx / fl * vx + fz / fl * vz); // 速度→車頭的夾角
          const into = Math.max(0, this.steerIn * this.driftDir);
          const rate = (0.6 + 0.7 * into) * this.S.drift.turn * Math.min(1, 16 / sp) * dt;
          const turn = Math.max(-rate, Math.min(rate, -ang * 0.6));
          const c = Math.cos(turn), sn = Math.sin(turn);
          // 甩尾減速上限 (預設 1.3 m/s²，保留速度感)
          const k = Math.max(1 - 0.1 * dt, (sp0 - this.S.drift.drag * dt) / sp);
          this.vel[0] = (vx * c - vz * sn) * k;
          this.vel[2] = (vx * sn + vz * c) * k;
        }
        // 長按甩尾輔助：按住 Shift 超過約 0.35 秒才漸漸生效 (輕點的托飄完全不受影響)
        const A = 0.85 * RM.smoothstep(0.3, 0.6, this.driftT);
        if (A > 0) this._driftAssist(dt, A, vx0, vz0);
      }
      if (!this._finite()) {
        if (!this._nanWarned) { console.warn('vehicle: non-finite state, restoring', JSON.stringify({ dt, steer: this.steer, thr: this.throttle })); this._nanWarned = true; }
        v3.copy(this.pos, good.pos); v3.set(this.vel, 0, 0, 0); v3.set(this.w, 0, 0, 0);
        this.q[0] = good.q[0]; this.q[1] = good.q[1]; this.q[2] = good.q[2]; this.q[3] = good.q[3];
        this.we = isFinite(good.we) ? good.we : (this.S.idle * Math.PI) / 30;
        for (let k = 0; k < 4; k++) { const w = this.wheels[k]; w.w = 0; w.len = w.lenPrev = good.len[k]; w.absScale = 1; }
      }
      this._tcu(dt);

      // 資訊
      quat.toMat3(this.R, this.q);
      const R = this.R;
      const fwd = [-R[6], -R[7], -R[8]];
      this.vLong = v3.dot(this.vel, fwd);
      this.speed = v3.len(this.vel);
      this.rpm = (this.we * 30) / Math.PI;
      this.odo += this.speed * dt; this.trip += this.speed * dt;
      // 油耗 (BSFC ~ 270 g/kWh)
      const pInd = Math.max(0, (this.engTq + 9 + this.rpm * 0.0042) * this.we) / 1000;
      this.fuel = Math.max(0, this.fuel - (pInd * 270 / 3600 / 745) * dt);
    }

    _step(dt) {
      const S = this.S, road = this.road;
      const R = quat.toMat3(this.R, this.q);
      const right = [R[0], R[1], R[2]], up = [R[3], R[4], R[5]], back = [R[6], R[7], R[8]];
      const fwd = [-back[0], -back[1], -back[2]];
      const F = this._f, T = this._t;
      F[0] = 0; F[1] = -S.mass * 9.81; F[2] = 0;
      T[0] = 0; T[1] = 0; T[2] = 0;

      // 轉向 (Ackermann)
      const st = this.steer;
      let dl = st, dr = st;
      if (Math.abs(st) > 1e-4) {
        const L = S.a + S.b, Rt = L / Math.tan(Math.abs(st));
        const din = Math.atan(L / (Rt - S.trackF / 2)), dout = Math.atan(L / (Rt + S.trackF / 2));
        if (st > 0) { dr = din; dl = dout; } else { dl = -din; dr = -dout; }
      }
      this.wheels[0].steer = dl; this.wheels[1].steer = dr;

      // ---- 傳動系
      const sel = SELECTOR[this.sel];
      let G = 0;
      if (sel === 'R') G = -S.rev * S.final;
      else if (sel !== 'P' && sel !== 'N') G = S.ratios[this.gear - 1] * S.final;
      let shiftF = 1;
      if (this.shiftT > 0) {
        const p = 1 - this.shiftT / this.shiftDur;
        shiftF = 1 - 0.6 * Math.sin(Math.PI * p);
      }
      const wOut = this._outW();
      const wt = wOut * G;
      const rpm = (this.we * 30) / Math.PI;
      const eng = this._engine(rpm, this.throttle);
      this.engTq = eng.tq;
      let driveTq = 0; // 前輪總扭力
      // 循跡控制：前輪打滑時降低驅動扭力
      let kf = -1;
      for (const w of this.wheels) if (this._driveShare(w) > 0) kf = Math.max(kf, w.kappa * Math.sign(G || 1));
      const tcsT = Math.min(1, Math.max(0.3, 1 - (kf - 0.16) * 3));
      this.tcs = this.tcs === undefined ? 1 : this.tcs + (tcsT - this.tcs) * Math.min(1, dt * 40);
      let extraI = 0;
      if (G !== 0 && this.locked) {
        this.we = Math.max(wt, 0);
        driveTq = eng.tq * G * S.eff * (eng.tq > 0 ? this.tcs : 1);
        extraI = S.engI * G * G * 0.5;
      } else if (G !== 0) {
        // 渦輪轉速 = 輪速 x 總齒比 (倒檔時兩者皆為負 → 正值)
        const [Ti2, Tt2] = this._converter(this.we, wt);
        driveTq = Tt2 * G * S.eff * shiftF * (Tt2 > 0 ? this.tcs : 1);
        this.we += ((eng.tq - Ti2 * (0.4 + 0.6 * shiftF)) / S.engI) * dt;
        this.tcTurbineTq = Tt2;
      } else {
        this.we += ((eng.tq - 2.5) / S.engI) * dt;
      }
      this.we = clamp(this.we, 0, ((this.S.cut || 7100) + 600) * Math.PI / 30);

      // ---- 輪胎/懸吊
      const g = this._tmp;
      const vt = [0, 0, 0];
      let total = 0;
      const PL = S.plant, fsMax = PL.fz * S.mass * 9.81, W4 = this.wheels;
      for (const w of this.wheels) {
        const S2 = S;
        // 懸吊錨點世界座標
        const ax = w.anchor;
        const A = [this.pos[0] + right[0] * ax[0] + up[0] * ax[1] + back[0] * ax[2],
          this.pos[1] + right[1] * ax[0] + up[1] * ax[1] + back[1] * ax[2],
          this.pos[2] + right[2] * ax[0] + up[2] * ax[1] + back[2] * ax[2]];
        const gr = road.ground(A[0], A[2], w.hint, A[1]);
        const n = w.gn; n[0] = gr.nx; n[1] = gr.ny; n[2] = gr.nz;
        w.surf = gr.surf;
        // 錨點沿 -up 到地面平面的距離
        const denom = Math.max(v3.dot(n, up), 0.3);
        const dist = ((A[1] - gr.y) * n[1]) / denom;
        let len = dist - S2.tireR;
        w.lenPrev = w.len;
        if (len > w.lenMax) { w.contact = false; len = w.lenMax; }
        else w.contact = true;
        let bump = 0;
        if (len < w.lenMin) { bump = (w.lenMin - len) * 180000; len = w.lenMin; }
        w.len = len;
        const comp = w.L0 - len;
        w.comp = comp;
        const cv = (w.lenPrev - w.len) / dt; // 壓縮速度
        let Fs = 0;
        if (w.contact) {
          Fs = S2.kSpring[w.ax] * comp + (cv > 0 ? S2.cBump[w.ax] : S2.cReb[w.ax]) * cv + bump;
        }
        w._Fs = Fs;
        w.wpos[0] = A[0] - up[0] * (len); w.wpos[1] = A[1] - up[1] * (len); w.wpos[2] = A[2] - up[2] * (len);
      }
      // 防傾桿
      for (let axl = 0; axl < 2; axl++) {
        const l = this.wheels[axl * 2], r = this.wheels[axl * 2 + 1];
        const d = (l.comp - r.comp) * S.arb[axl];
        if (l.contact) l._Fs += d;
        if (r.contact) r._Fs -= d;
        // 單輪懸吊力上限 (只管離開柏油的輪子)：壓到水溝、路緣時，觸底的彈力不會把整台車彈起來
        if (l.surf !== 0 && l._Fs > fsMax) l._Fs = fsMax;
        if (r.surf !== 0 && r._Fs > fsMax) r._Fs = fsMax;
      }
      const tf = this._tf;
      const muSurf = [S.mu, S.mu * 0.88, S.mu * 0.62, S.mu * 0.55];
      const wet = this.wet || 0;
      for (const w of this.wheels) {
        const Fz = w.contact ? Math.max(0, w._Fs) : 0;
        w.Fz = Fz;
        // 輪胎接地點
        const cp = [w.wpos[0] - up[0] * S.tireR, w.wpos[1] - up[1] * S.tireR, w.wpos[2] - up[2] * S.tireR];
        const rx = cp[0] - this.pos[0], ry = cp[1] - this.pos[1], rz = cp[2] - this.pos[2];
        // 接地點速度 v + w x r
        vt[0] = this.vel[0] + this.w[1] * rz - this.w[2] * ry;
        vt[1] = this.vel[1] + this.w[2] * rx - this.w[0] * rz;
        vt[2] = this.vel[2] + this.w[0] * ry - this.w[1] * rx;
        // 車輪方向
        const cs = Math.cos(-w.steer), sn = Math.sin(-w.steer);
        // 繞 up 旋轉 fwd
        const cr = v3.cross(g, up, fwd);
        let wf = [fwd[0] * cs + cr[0] * sn + up[0] * v3.dot(up, fwd) * (1 - cs), fwd[1] * cs + cr[1] * sn + up[1] * v3.dot(up, fwd) * (1 - cs), fwd[2] * cs + cr[2] * sn + up[2] * v3.dot(up, fwd) * (1 - cs)];
        const n = w.gn;
        const dn = v3.dot(wf, n);
        wf = v3.norm(wf, [wf[0] - n[0] * dn, wf[1] - n[1] * dn, wf[2] - n[2] * dn]);
        const wr = v3.cross([0, 0, 0], wf, n);
        const vLong = v3.dot(vt, wf), vLat = v3.dot(vt, wr);
        const share = this._driveShare(w);
        const Iw = S.wheelI[w.ax] + (share > 0 ? extraI * share * 2 : 0);
        // 驅動/煞車扭力
        let Td = driveTq * share;
        let Tb = this.brake * (w.front ? S.brakeF : S.brakeR) * w.absScale;
        if (!w.front) Tb += this.hand * S.handbrake;
        if (sel === 'P' && w.front) Tb += 6000;
        // 滑移
        const denomV = Math.max(Math.abs(vLong), 2.5);
        const kappa = (w.w * S.tireR - vLong) / denomV;
        const alpha = Math.atan2(vLat, Math.max(Math.abs(vLong), 1.2));
        w.kappa = kappa; w.alpha = alpha;
        let mu = muSurf[w.surf] * (w.front ? (this.drifting ? 1.08 : 1) : S.muRear * (this.drifting ? 0.36 : 1)) * (1 - 0.07 * (Fz / 3500 - 1)) * (1 - wet * 0.28);
        w.mu = mu;
        tire(Fz, kappa, alpha, mu, tf);
        let Fx = tf[0], Fy = tf[1];
        // 數值穩定：滑移速度鉗制
        const slipV = w.w * S.tireR - vLong;
        const mc = S.mass / 4;
        const maxFx = (Math.abs(slipV) / (dt * (S.tireR * S.tireR / Iw + 1 / mc))) * 0.9;
        if (Math.abs(Fx) > maxFx) Fx = Math.sign(Fx) * maxFx;
        const maxFy = (Math.abs(vLat) * mc / dt) * 0.9;
        if (Math.abs(Fy) > maxFy) Fy = Math.sign(Fy) * maxFy;
        // 滾動阻力
        const rr = (w.surf >= 2 ? 4 : 1) * S.crr * Fz * S.tireR * Math.tanh(w.w * 4);
        // 車輪角速度
        let wn = w.w + ((Td - Fx * S.tireR - rr) / Iw) * dt;
        const bstep = (Tb / Iw) * dt;
        if (Math.abs(wn) <= bstep) wn = 0; else wn -= Math.sign(wn) * bstep;
        w.w = wn;
        w.angle += w.w * dt;
        // ABS
        if (this.abs && this.brake > 0.05 && Math.abs(vLong) > 2.5 && kappa < -0.14) w.absScale = Math.max(0.15, w.absScale - dt * 22);
        else w.absScale = Math.min(1, w.absScale + dt * 9);
        w.Fx = Fx; w.Fy = Fy;
        w.slipVel = Math.hypot(slipV, vLat);
        total += Fz;
        // 合力：懸吊力沿 up (施於錨點)，輪胎力施於接地點
        const fs = w._Fs > 0 && w.contact ? w._Fs : 0;
        const fx = up[0] * fs + wf[0] * Fx + wr[0] * Fy;
        const fy = up[1] * fs + wf[1] * Fx + wr[1] * Fy;
        const fz = up[2] * fs + wf[2] * Fx + wr[2] * Fy;
        F[0] += fx; F[1] += fy; F[2] += fz;
        // 力矩 (接地點略上移以降低側傾力矩過大)
        const ry2 = ry + S.tireR * 0.35;
        T[0] += ry2 * fz - rz * fy; T[1] += rz * fx - rx * fz; T[2] += rx * fy - ry2 * fx;
      }
      this.totalFz = total;
      {
        const vL = v3.dot(this.vel, fwd), vLat = v3.dot(this.vel, right);
        const yaw = v3.dot(this.w, up);
        this.beta = Math.atan2(vLat, Math.max(Math.abs(vL), 0.5));
        if (this.drifting && total > 1000) {
          const into = this.steerIn * this.driftDir;
          const bt = -this.driftDir * (S.drift.angle + S.drift.angleIn * into);
          const db = (this.beta - (this._bPrev === undefined ? this.beta : this._bPrev)) / dt;
          this._bPrev = this.beta;
          const ty = -(this.beta - bt) * 15000 - db * 6000;
          T[0] += up[0] * ty; T[1] += up[1] * ty; T[2] += up[2] * ty;
        } else this._bPrev = undefined;
        let push = (this.nitroT > 0 ? S.drift.nitro : 0) + (this.boostT > 0 ? this.boostF : 0);
        // 起步輔助：前進檔、沒在甩尾時，低速依油門多給一股推力 (隨車速遞減到 0)
        if (S.launch[0] > 0 && G > 0 && !this.drifting && vL > -1) push += S.launch[0] * this.throttle * (1 - RM.smoothstep(S.launch[1], S.launch[2], vL * 3.6));
        if (push > 0 && total > 1000) {
          const hx = fwd[0], hz = fwd[2], hl = Math.hypot(hx, hz) || 1;
          F[0] += (hx / hl) * push; F[2] += (hz / hl) * push;
        }
        if (!this.drifting && Math.abs(vL) > 4 && total > 1000) {
          const L = S.a + S.b;
          const rRef = (vL * Math.tan(this.steer)) / L;
          const lim = Math.abs(rRef) + 0.03;
          const beta = Math.atan2(vLat, Math.abs(vL));
          // 偏航方向向右為負 (繞 up)，只處理「轉過頭」
          let excess = 0;
          if (Math.abs(yaw) > lim) excess = yaw - Math.sign(yaw) * lim;
          const k = 4500 + Math.min(1, Math.abs(beta) / 0.12) * 5000;
          // 車身側滑角過大時，額外把車頭導回行進方向
          const bEx = Math.abs(beta) > 0.07 ? (Math.abs(beta) - 0.07) * Math.sign(beta) : 0;
          const ty = -excess * k + (vL > 0 ? -1 : 1) * bEx * 9000;
          T[0] += up[0] * ty; T[1] += up[1] * ty; T[2] += up[2] * ty;
        }
      }
      // 空氣阻力/升力
      const sp = v3.len(this.vel);
      if (sp > 0.1) {
        const k = 0.5 * 1.225 * S.cd * S.area * sp;
        F[0] -= k * this.vel[0]; F[1] -= k * this.vel[1]; F[2] -= k * this.vel[2];
        F[1] += 0.5 * 1.225 * S.lift * S.area * sp * sp * 0.2;
      }
      // 底盤配重：車身相對路面 (坡度 + 超高) 傾斜超過 tilt 度，就像底盤很重一樣被壓回去；正常行駛的側傾 / 俯仰都小於這個角度
      {
        let nx = 0, ny = 1, nz = 0;
        if (road.bank) {
          const i = this.hint.i;
          const ax = road.rx[i], ay = road.bank[i], az = road.rz[i], bx = road.tx[i], by = road.grade[i], bz = road.tz[i];
          nx = ay * bz - az * by; ny = az * bx - ax * bz; nz = ax * by - ay * bx;
          const nl = Math.hypot(nx, ny, nz) * (ny < 0 ? -1 : 1) || 1;
          nx /= nl; ny /= nl; nz /= nl;
        }
        // 轉軸 = up × n (把 up 轉向 n)，角度 = 兩者夾角
        let ex = up[1] * nz - up[2] * ny, ey = up[2] * nx - up[0] * nz, ez = up[0] * ny - up[1] * nx;
        const sn = Math.hypot(ex, ey, ez), cs = up[0] * nx + up[1] * ny + up[2] * nz;
        const over = Math.atan2(sn, cs) - PL.tilt * Math.PI / 180;
        this.planted = over > 0;
        if (over > 0) {
          if (sn > 1e-4) { ex /= sn; ey /= sn; ez /= sn; } else { ex = back[0]; ey = back[1]; ez = back[2]; } // 完全倒過來：沿車身縱軸翻回來
          const mg = S.mass * 9.81, a = Math.min(over, 0.6), act = RM.smoothstep(0, 0.07, over);
          const wr = v3.dot(this.w, right), wb = v3.dot(this.w, back);
          const tp = (ex * right[0] + ey * right[1] + ez * right[2]) * a * PL.pitch * mg - PL.damp * act * S.inertia[0] * wr;
          const tr = (ex * back[0] + ey * back[1] + ez * back[2]) * a * PL.roll * mg - PL.damp * act * S.inertia[2] * wb;
          T[0] += right[0] * tp + back[0] * tr; T[1] += right[1] * tp + back[1] * tr; T[2] += right[2] * tp + back[2] * tr;
        }
        // 四輪全部離地：多加重力把車拉回地面，飛不高也飛不遠 (道路標成飛越區的地方除外：斷崖要飛得過去，見 road.js 的 jump)
        const airborne = !(W4[0].contact || W4[1].contact || W4[2].contact || W4[3].contact);
        const jumping = !!(road.jump && road.jump[this.hint.i]);
        if (PL.air > 0 && !jumping && airborne) F[1] -= PL.air * S.mass * 9.81;
        // 飛越路段的穩定輔助 (只在道路標成飛越區的地方)：
        //   空中：行進方向慢慢帶回順著道路，車頭對準行進方向、偏航停下來。起跳前只要輕點過方向，車子就帶著偏航、斜斜地離地，
        //         在空中沒有任何東西讓它停，落地時是一大截側滑角 (像被甩尾)；就算沒打轉，行進方向也是歪的，落地還得修正
        //   地面：時速 130 以上，車頭跟著行進方向、偏航跟著方向盤，不會自己甩 (高速落地、重煞車時後輪抓不住，一歪就打轉)
        this._jumpAir = jumping && airborne;
        if (jumping) {
          const vx = this.vel[0], vz = this.vel[2], vh = Math.hypot(vx, vz);
          const fx = -back[0], fz = -back[2], fl = Math.hypot(fx, fz) || 1;
          const yaw = v3.dot(this.w, up);
          let ty = 0;
          if (airborne && vh > 8) {
            const i = this.hint.i, sg = vx * road.tx[i] + vz * road.tz[i] >= 0 ? 1 : -1;
            const off = Math.asin(clamp((vx * road.tz[i] - vz * road.tx[i]) * sg / vh, -1, 1));   // 行進方向 → 道路方向
            const a = clamp(4 * off, -0.3, 0.3) * dt, c = Math.cos(a), sn = Math.sin(a);
            this.vel[0] = vx * c - vz * sn; this.vel[2] = vx * sn + vz * c;
            const err = Math.asin(clamp((fz * this.vel[0] - fx * this.vel[2]) / (fl * vh), -1, 1));   // 車頭 → 行進方向 (左轉為正)
            ty = S.inertia[1] * (60 * err - 15 * yaw);
          } else if (!airborne && !this.drifting && total > 1000 && vh > 36) {
            const err = Math.asin(clamp((fz * vx - fx * vz) / (fl * vh), -1, 1));
            const ref = -clamp(vh * Math.tan(this.steer) / (S.a + S.b), -10.5 / vh, 10.5 / vh);   // 方向盤要的偏航 (不超過輪胎極限)
            ty = S.inertia[1] * RM.smoothstep(36, 50, vh) * (25 * err - 8 * (yaw - ref));
          }
          T[0] += up[0] * ty; T[1] += up[1] * ty; T[2] += up[2] * ty;
        }
      }
      // 積分 (半隱式 Euler)
      const im = 1 / S.mass;
      this.vel[0] += F[0] * im * dt; this.vel[1] += F[1] * im * dt; this.vel[2] += F[2] * im * dt;
      // 角加速度：world → local
      const lx = v3.dot(T, right), ly = v3.dot(T, up), lz = v3.dot(T, back);
      const wl = [v3.dot(this.w, right), v3.dot(this.w, up), v3.dot(this.w, back)];
      const I = S.inertia;
      // 陀螺項 w x Iw
      const gx = wl[1] * I[2] * wl[2] - wl[2] * I[1] * wl[1];
      const gy = wl[2] * I[0] * wl[0] - wl[0] * I[2] * wl[2];
      const gz = wl[0] * I[1] * wl[1] - wl[1] * I[0] * wl[0];
      wl[0] += ((lx - gx) / I[0]) * dt; wl[1] += ((ly - gy) / I[1]) * dt; wl[2] += ((lz - gz) / I[2]) * dt;
      // 微量阻尼
      const damp = 1 - 0.02 * dt;
      for (let i = 0; i < 3; i++) this.w[i] = (right[i] * wl[0] + up[i] * wl[1] + back[i] * wl[2]) * damp;
      this.pos[0] += this.vel[0] * dt; this.pos[1] += this.vel[1] * dt; this.pos[2] += this.vel[2] * dt;
      quat.integrate(this.q, this.w, dt);
      this._collide(dt, right, up, back);
    }

    // 長按甩尾輔助 (過髮夾彎用)：
    //   原本按住內側鍵時行進方向轉得太快 (R25 髮夾、60 km/h 需要約 40°/s，實際約 85°/s)，放開又太慢 (約 32°/s)，
    //   鍵盤只有開 / 關，長甩過髮夾彎很容易切進內側撞護欄、撞到就打轉。
    //   路線：瞄準前方道路上一點 (pure pursuit)，同時修正轉彎速度、方向偏差與橫向位置；
    //         內側鍵讓路線比輔助開始時往彎內 2 m (收緊)、反打往外 2 m (放寬)；瞄準點永遠離兩側護欄 / 山壁保持安全距離。
    //   車身：車頭跟著路線轉，維持與輕點甩尾相同的甩尾角 (約 10～31°)，不會一直轉進內側。
    //   A = 輔助強度 (最高 0.85，保留滑動感)
    _driftAssist(dt, A, vx0, vz0) {
      const road = this.road, D = this.driftDir;
      const vx = this.vel[0], vz = this.vel[2], v = Math.hypot(vx, vz);
      if (v < 4 || !D) return;
      const ux = vx / v, uz = vz / v;
      const pr = road.project(this.pos[0], this.pos[2], this.hint.i, this._apr || (this._apr = {}), this.pos[1]);
      const i = pr.i;
      const dirT = ux * road.tx[i] + uz * road.tz[i] >= 0 ? 1 : -1; // 行進方向相對道路方向
      const into = clamp(this.steerIn * D, -1, 1);
      // 瞄準點：前方 L 公尺，橫向 = 基準路線 (輔助開始時的位置) + 方向鍵的收放 (±2 m)，夾在安全範圍內 (車身斜滑時佔的寬度較大)
      if (this._dLine === undefined) this._dLine = pr.d;
      const L = clamp(v * 0.75, 9, 22);
      const fa = road.frameAt(pr.fi * road.sp + dirT * L, this._afr || (this._afr = {}));
      const ext = this.S.box.hw + 0.3 * (this.S.box.front + this.S.box.rear) * Math.min(0.6, Math.abs(Math.sin(this.beta)));
      const ia = fa.i;
      const lo = -(road.wall[0][ia] - ext - 1.8), hi = road.wall[1][ia] - ext - 1.8;
      const dT = clamp(this._dLine + D * dirT * into * 2, Math.min(lo, hi), Math.max(lo, hi));
      const ax = fa.x + fa.rx * dT - this.pos[0], az = fa.z + fa.rz * dT - this.pos[2];
      const al = Math.hypot(ax, az) || 1;
      const alpha = Math.atan2(ax * -uz + az * ux, ax * ux + az * uz); // 右偏為正
      const target = clamp(v * 2 * Math.sin(alpha) / al * D, -0.4, 2.2);  // 需要的行進方向轉速 (甩尾方向為正)
      // 路線：把這一幀實際的轉速往目標拉
      let dphi = Math.atan2(vz, vx) - Math.atan2(vz0, vx0);
      while (dphi > Math.PI) dphi -= 2 * Math.PI;
      while (dphi < -Math.PI) dphi += 2 * Math.PI;
      const cur = (dphi / dt) * D;
      const applied = cur + (target - cur) * A;
      const a = clamp((applied - cur) * dt, -2 * dt, 2 * dt) * D;
      const c = Math.cos(a), s = Math.sin(a);
      this.vel[0] = vx * c - vz * s;
      this.vel[2] = vx * s + vz * c;
      // 車身：偏航速度 = 路線轉速 + 甩尾角修正 (目標角與輕點甩尾相同)
      const R = this.R, up = [R[3], R[4], R[5]];
      const sigma = -this.beta * D, sigT = this.S.drift.angle + this.S.drift.angleIn * into;
      const yawDes = -D * applied - D * 4 * (sigT - sigma);           // 偏航以左轉為正
      const yawNow = v3.dot(this.w, up);
      const k = Math.min(1, A * 10 * dt) * (yawDes - yawNow);
      this.w[0] += up[0] * k; this.w[1] += up[1] * k; this.w[2] += up[2] * k;
    }

    // 施加衝量 J 於世界點 p
    _impulse(p, J) {
      const S = this.S;
      this.vel[0] += J[0] / S.mass; this.vel[1] += J[1] / S.mass; this.vel[2] += J[2] / S.mass;
      const r = [p[0] - this.pos[0], p[1] - this.pos[1], p[2] - this.pos[2]];
      const tq = v3.cross([0, 0, 0], r, J);
      this._applyAngImpulse(tq);
    }
    _applyAngImpulse(tq) {
      const R = this.R, I = this.S.inertia;
      const right = [R[0], R[1], R[2]], up = [R[3], R[4], R[5]], back = [R[6], R[7], R[8]];
      const a = v3.dot(tq, right) / I[0], b = v3.dot(tq, up) / I[1], c = v3.dot(tq, back) / I[2];
      for (let i = 0; i < 3; i++) this.w[i] += right[i] * a + up[i] * b + back[i] * c;
    }
    _invMassAlong(r, n) {
      // 1/m + n·((I^-1 (r×n)) × r)
      const R = this.R, I = this.S.inertia;
      const right = [R[0], R[1], R[2]], up = [R[3], R[4], R[5]], back = [R[6], R[7], R[8]];
      const rn = v3.cross([0, 0, 0], r, n);
      const a = v3.dot(rn, right) / I[0], b = v3.dot(rn, up) / I[1], c = v3.dot(rn, back) / I[2];
      const iw = [right[0] * a + up[0] * b + back[0] * c, right[1] * a + up[1] * b + back[1] * c, right[2] * a + up[2] * b + back[2] * c];
      return 1 / this.S.mass + v3.dot(n, v3.cross([0, 0, 0], iw, r));
    }
    contactAt(p, n, depth, rest, fric, kind) {
      const r = [p[0] - this.pos[0], p[1] - this.pos[1], p[2] - this.pos[2]];
      const vp = [this.vel[0] + this.w[1] * r[2] - this.w[2] * r[1], this.vel[1] + this.w[2] * r[0] - this.w[0] * r[2], this.vel[2] + this.w[0] * r[1] - this.w[1] * r[0]];
      const vn = v3.dot(vp, n);
      // 位置修正
      const corr = Math.min(depth, 0.2) * 0.9;
      this.pos[0] += n[0] * corr; this.pos[1] += n[1] * corr; this.pos[2] += n[2] * corr;
      if (vn >= 0) return 0;
      const im = this._invMassAlong(r, n);
      if (!(im > 1e-9) || !isFinite(vn)) return 0;
      const j = (-(1 + rest) * vn) / im;
      const J = [n[0] * j, n[1] * j, n[2] * j];
      // 摩擦
      const vtg = [vp[0] - n[0] * vn, vp[1] - n[1] * vn, vp[2] - n[2] * vn];
      const vtl = v3.len(vtg);
      if (vtl > 1e-3) {
        const t = [vtg[0] / vtl, vtg[1] / vtl, vtg[2] / vtl];
        const jt = Math.min(fric * j, vtl / this._invMassAlong(r, t));
        J[0] -= t[0] * jt; J[1] -= t[1] * jt; J[2] -= t[2] * jt;
      }
      this._impulse(p, J);
      if (-vn > 1.2) this.events.push({ type: kind || 'hit', v: -vn });
      else if (vtl > 3) this.scrape = Math.max(this.scrape || 0, Math.min(1, vtl / 15));
      return -vn;
    }

    _collide(dt, right, up, back) {
      const road = this.road;
      // 車身外角點 (相對重心)
      const B = this.S.box;
      const pts = this._pts || (this._pts = [
        [-B.hw, 0.0, -B.front], [B.hw, 0.0, -B.front], [-B.hw, 0.0, B.rear], [B.hw, 0.0, B.rear],
        [-B.hw, 0.05, 0], [B.hw, 0.05, 0], [-B.hw, 0.05, -B.front * 0.55], [B.hw, 0.05, -B.front * 0.55], [-B.hw, 0.05, B.rear * 0.6], [B.hw, 0.05, B.rear * 0.6],
      ]);
      const W = [0, 0, 0];
      for (const p of pts) {
        W[0] = this.pos[0] + right[0] * p[0] + up[0] * p[1] + back[0] * p[2];
        W[1] = this.pos[1] + right[1] * p[0] + up[1] * p[1] + back[1] * p[2];
        W[2] = this.pos[2] + right[2] * p[0] + up[2] * p[1] + back[2] * p[2];
        const pr = road.project(W[0], W[2], this.hint.i, road._pr, W[1]);
        const i = pr.i;
        const side = pr.d >= 0 ? 1 : 0;
        const wall = road.wall[side][i];
        const pen = Math.abs(pr.d) - wall;
        if (pen > 0) {
          const sg = pr.d >= 0 ? 1 : -1;
          const n = [-road.rx[i] * sg, 0, -road.rz[i] * sg];
          const st = road.side[side][i];
          // 反作用力一律作用在重心高度：車身傾斜時，牆不會把車越撬越高 (貼著護欄甩尾時最容易翻)
          W[1] = this.pos[1];
          this.contactAt(W, n, pen, st === 1 ? 0.15 : 0.08, 0.35, st === 1 ? 'rail' : 'wall');
        }
      }
      this.hint.i = road.project(this.pos[0], this.pos[2], this.hint.i, road._pr, this.pos[1]).i;
      // 車身觸地 (翻滾)
      const body = this._bpts || (this._bpts = [
        [-B.hw * 0.94, B.bottom, -B.front * 0.95], [B.hw * 0.94, B.bottom, -B.front * 0.95], [-B.hw * 0.94, B.bottom, B.rear * 0.95], [B.hw * 0.94, B.bottom, B.rear * 0.95],
        [-B.hw * 0.72, B.top, -B.front * 0.1], [B.hw * 0.72, B.top, -B.front * 0.1], [-B.hw * 0.72, B.top, B.rear * 0.5], [B.hw * 0.72, B.top, B.rear * 0.5],
        [-B.hw, B.top * 0.4, 0.2], [B.hw, B.top * 0.4, 0.2],
      ]);
      const hint = this._bh || (this._bh = { i: 0 });
      hint.i = this.hint.i;
      for (const p of body) {
        W[0] = this.pos[0] + right[0] * p[0] + up[0] * p[1] + back[0] * p[2];
        W[1] = this.pos[1] + right[1] * p[0] + up[1] * p[1] + back[1] * p[2];
        W[2] = this.pos[2] + right[2] * p[0] + up[2] * p[1] + back[2] * p[2];
        const g = road.ground(W[0], W[2], hint, this.pos[1]);   // 高度給重心的：斷崖的橋面要分辨整台車在橋上還是橋下 (road.js 的 _pit)
        const depth = (g.y - W[1]) * g.ny;
        if (depth > 0) this.contactAt(W, [g.nx, g.ny, g.nz], depth, 0.1, 0.5, 'body');
      }
      // 電線桿、路燈：一撞就斷，不擋車 (只損失少許車速)
      if (this.obstacles) {
        const hit = this._broke || (this._broke = new Set());
        for (const o of this.obstacles) {
          if (hit.has(o)) continue;
          const dx = o.x - this.pos[0], dz = o.z - this.pos[2];
          if (dx * dx + dz * dz > 16) continue;
          // 轉入車身座標
          const lx = dx * right[0] + dz * right[2], lz = dx * back[0] + dz * back[2];
          const cx = clamp(lx, -B.hw, B.hw), cz = clamp(lz, -B.front, B.rear);
          if (Math.hypot(lx - cx, lz - cz) < o.r) {
            hit.add(o);
            const v = Math.hypot(this.vel[0], this.vel[2]);
            this.events.push({ type: 'break', obj: o, v, dir: [this.vel[0], this.vel[2]] });
            this.vel[0] *= 0.94; this.vel[2] *= 0.94;
          }
        }
      }
    }

    // 顯示用：輪胎在車身座標的位置/轉角
    wheelLocal(k) {
      const w = this.wheels[k];
      return { x: w.anchor[0], y: w.anchor[1] - w.len, z: w.anchor[2], steer: w.steer, angle: w.angle };
    }
  }

  // 由基底規格 + 模型尺寸 (輪位、輪徑、外框) 推導完整規格
  function makeSpec(over, dims) {
    const S = Object.assign({}, SPEC, over || {});
    S.drift = Object.assign({}, SPEC.drift, over && over.drift);
    S.plant = Object.assign({}, SPEC.plant, over && over.plant);
    if (dims) {
      const wb = dims.zR - dims.zF;
      const fw = S.frontW || 0.6;
      const a = wb * (1 - fw);
      const cgZ = dims.zF + a;
      const tireR = dims.tireR;
      const cgH = Math.max(S.cgH, tireR + 0.14);
      S.final = (S.final || SPEC.final) * tireR / (over && over.tireRRef ? over.tireRRef : tireR);
      S.a = a; S.b = wb - a; S.trackF = dims.trackF; S.trackR = dims.trackR; S.tireR = tireR; S.cgH = cgH;
      S.cgZ = cgZ;
      S.box = { hw: dims.W / 2, front: cgZ - dims.minZ, rear: dims.maxZ - cgZ, bottom: dims.clear - cgH + 0.02, top: dims.H - cgH - 0.05 };
      S.eye = [-dims.W * 0.2, dims.H * 0.82 - cgH, (dims.minZ + dims.maxZ) / 2 + (dims.maxZ - dims.minZ) * 0.04 - cgZ];
      S.hood = [0, dims.H * 0.72 - cgH, dims.minZ + (dims.maxZ - dims.minZ) * 0.3 - cgZ];
      S.bumper = [0, 0.45 - cgH, dims.minZ - 0.08 - cgZ];
      S.lampF = [dims.W * 0.33, 0.62 - cgH, dims.minZ + 0.03 - cgZ];
      S.lampR = [dims.W * 0.35, Math.min(0.9, dims.H * 0.6) - cgH, dims.maxZ - 0.03 - cgZ];
      S.exhaust = [-dims.W * 0.28, 0.28 - cgH, dims.maxZ + 0.05 - cgZ];
      const m = S.mass;
      // 懸吊、慣量隨車重縮放
      const k = m / SPEC.mass;
      S.kSpring = SPEC.kSpring.map((v) => v * k * (S.stiff || 1));
      S.cBump = SPEC.cBump.map((v) => v * Math.sqrt(k) * (S.stiff || 1));
      S.cReb = SPEC.cReb.map((v) => v * Math.sqrt(k) * (S.stiff || 1));
      S.arb = SPEC.arb.map((v) => v * k * (S.stiff || 1));
      const L = dims.maxZ - dims.minZ, W = dims.W, H = dims.H;
      S.inertia = [m * (L * L + H * H) / 16, m * (L * L + W * W) / 16, m * (W * W + H * H) / 14];
      S.wheelI = [Math.max(0.3, tireR * tireR * 12), Math.max(0.3, tireR * tireR * 10)];
    }
    if (!S.shiftTableKeep) delete S.shiftTable;
    return S;
  }

  RM.makeSpec = makeSpec;
  RM.Vehicle = Vehicle;
  RM.CIVIC_SPEC = SPEC;
  RM.SELECTOR = SELECTOR;
})();
