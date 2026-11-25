'use strict';
// 計時賽重播：在「紀錄與排行」點賽道前 15 名旁邊的 ▶，就能看那位玩家那一趟是怎麼跑的 (畫面上只有他的車)。
//
// 不是錄影，也不是記按鍵：
//   - 車輛物理依每台電腦的幀率切子步驟，同一串按鍵在別台電腦上會跑出不同的路線，所以記的是車子的軌跡。
//   - 每秒取樣 HZ 次，記「沿道路的距離 s、橫向位置 d、車頭相對道路的角度、離路面的高度」，加上煞車 / 氮氣的開關。
//     車子幾乎都貼著路跑，這四個量很平順：用前兩筆預測下一筆、只存預測誤差 (指數哥倫布碼)，一分鐘不到 1 KB。
//   - 播放時兩筆之間沿著道路內插 (過彎也是彎的)；車身俯仰 / 側傾、輪子、方向盤、胎痕、引擎聲都從軌跡推回來。
// 伺服器 (server/functions.js) 只替還在前 15 名裡的紀錄保留重播；平台給全部玩家共用的資料只有 64 KB，
// 所以只有短賽道 (TRACKS) 有重播。
(function () {
  const RM = window.RM;
  const { quat, clamp } = RM;
  const $ = (id) => document.getElementById(id);

  const TRACKS = { sprint: true, [RM.DriftTrack.id]: true };   // 有重播的賽道：彎道衝刺 (雙向)、熱浪夏威夷
  const HZ = 5;                                                 // 每秒取樣數
  const QS = 0.1, QD = 0.05, QY = (2 * Math.PI) / 512, QH = 0.05;   // 量化單位：沿路距離 / 橫向 / 車頭角 / 離路面高度
  const VER = 2;               // 重播資料格式版本 (decode 也認得第 1 版)
  const MAX_LEN = 7000;        // 重播資料 (base64) 上限：伺服器函式每次呼叫的輸入上限是 8 KB (server/functions.js 的 RP_MAX)
  const MAX_SAMPLES = 15 * 60 * HZ;
  const PRED = [0, 2, 3, 4];   // 預測器：下一筆 = 前一筆 + 斜率 × PRED/4 (0 = 不變，4 = 等速)
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const wrap = (a) => a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI;

  // ------------------------------------------------------------------ 位元串流
  function writer() {
    const out = [];
    let acc = 0, nb = 0;
    const w = {
      bit(b) { acc = (acc << 1) | b; if (++nb === 8) { out.push(acc); acc = 0; nb = 0; } },
      put(v, n) { for (let i = n - 1; i >= 0; i--) w.bit((v >>> i) & 1); },
      // 指數哥倫布碼 (order k)：u >= 0；小的數字位數少
      eg(u, k) {
        const x = u + (1 << k);
        let n = 0;
        while (x >>> (n + 1)) n++;
        for (let i = k; i < n; i++) w.bit(0);
        w.put(x, n + 1);
      },
      bytes() { const o = out.slice(); if (nb) o.push(acc << (8 - nb)); return o; },
    };
    return w;
  }
  function reader(bytes) {
    let p = 0;
    const N = bytes.length * 8;
    const r = {
      bit() { if (p >= N) throw new Error('replay: truncated'); const b = (bytes[p >> 3] >> (7 - (p & 7))) & 1; p++; return b; },
      get(n) { let v = 0; for (let i = 0; i < n; i++) v = v * 2 + r.bit(); return v; },
      eg(k) {
        let z = 0;
        while (r.bit() === 0) if (++z > 28) throw new Error('replay: bad code');
        let x = 1;
        for (let i = 0; i < z + k; i++) x = x * 2 + r.bit();
        return x - (1 << k);
      },
    };
    return r;
  }
  const egBits = (u, k) => { const x = u + (1 << k); let n = 0; while (x >>> (n + 1)) n++; return 2 * n - k + 1; };
  const zig = (v) => (v >= 0 ? 2 * v : -2 * v - 1);
  const unzig = (u) => (u & 1 ? -(u + 1) / 2 : u / 2);
  // 自我調整的碼長：M ≈ 最近誤差平均 × 16 (整數運算，編碼端與解碼端算出來一模一樣)
  const kOf = (M) => { let k = 0; while (k < 20 && (24 << k) <= M) k++; return k; };
  const upd = (M, u) => M - (M >> 3) + 2 * Math.min(u, 1 << 22);
  const predict = (q, i, key, a) => {
    const x1 = q[i - 1];
    return key[i - 1] ? x1 : x1 + Math.floor((a * (x1 - q[i - 2]) + 2) / 4);
  };
  function toB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
      const m = Math.min(4, Math.ceil(((bytes.length - i) * 4) / 3));
      for (let k = 0; k < m; k++) s += B64[(n >> (18 - 6 * k)) & 63];
    }
    return s;
  }
  function fromB64(s) {
    const out = [];
    let acc = 0, nb = 0;
    for (let i = 0; i < s.length; i++) {
      const v = B64.indexOf(s[i]);
      if (v < 0) throw new Error('replay: bad data');
      acc = ((acc << 6) | v) & 0xffffff; nb += 6;
      if (nb >= 8) { nb -= 8; out.push((acc >> nb) & 255); }
    }
    return new Uint8Array(out);
  }

  // ------------------------------------------------------------------ 編碼 / 解碼
  // 格式版本 2 (2026-11-25)：多記 HUD 的氮氣瓶數 (事件 3) 與集氣條 (折線：只記轉折點，播放時連起來，誤差 2% 以內)。
  // 集氣條大部分時間不動或等速增加，逐筆記一個通道要多 3 倍空間。第 1 版 (沒有這兩項) 照樣能解。
  // 關鍵影格的絕對值：位數與偏移 (車頭角取 512 的餘數)
  const ABS = [21, 12, 9, 11], OFF = [0, 2048, 0, 1024];
  // 集氣條的折線：從頭開始，每段盡量拉長，直到中間有一筆偏離超過 tol
  function gaugeKeys(g, tol) {
    const n = g.length, kp = [0];
    const qv = (v) => Math.round(clamp(v, 0, 1) * 100) / 100;
    let a = 0;
    while (a < n - 1) {
      let b = a + 1;
      const qa = qv(g[a]);
      for (let c = a + 2; c < n && c - a <= 300; c++) {
        const qc = qv(g[c]);
        let fits = true;
        for (let j = a + 1; j < c; j++) if (Math.abs(qa + ((qc - qa) * (j - a)) / (c - a) - g[j]) > tol) { fits = false; break; }
        if (!fits) break;
        b = c;
      }
      kp.push(b); a = b;
    }
    return kp.map((i) => [i, Math.round(qv(g[i]) * 100)]);
  }
  // raw = { S, D, Y (已展開、不跳 ±π 的弧度), H, G (集氣條 0～1), F (bit0 煞車、bit1 氮氣), N (氮氣瓶數 0～2), K (1 = 關鍵影格：開頭與重置之後) }
  function encode(raw) {
    const n = raw.S.length;
    const key = Uint8Array.from(raw.K, (k, i) => (i === 0 || k ? 1 : 0));
    const q = [
      raw.S.map((v) => clamp(Math.round(v / QS), 0, (1 << 21) - 1)),
      raw.D.map((v) => clamp(Math.round(v / QD), -2048, 2047)),
      raw.Y.map((v) => Math.round(v / QY)),
      raw.H.map((v) => clamp(Math.round(v / QH), -1024, 1023)),
    ];
    // 每個通道挑位數最少的預測器
    const pick = q.map((arr) => {
      let best = 0, bits = Infinity;
      for (let a = 0; a < PRED.length; a++) {
        let M = 32, b = 0;
        for (let i = 1; i < n; i++) {
          if (key[i]) continue;
          const u = zig(arr[i] - predict(arr, i, key, PRED[a]));
          b += egBits(u, kOf(M)); M = upd(M, u);
        }
        if (b < bits) { bits = b; best = a; }
      }
      return best;
    });
    // 事件：0 = 煞車燈切換、1 = 氮氣切換、2 = 關鍵影格、3 = 氮氣瓶數 (後面 2 位元是新的瓶數)
    const ev = [];
    let fl = 0, nb = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0 && key[i]) ev.push([i, 2]);
      const f = raw.F[i] & 3;
      if ((f ^ fl) & 1) ev.push([i, 0]);
      if ((f ^ fl) & 2) ev.push([i, 1]);
      fl = f;
      const b = clamp(raw.N[i] | 0, 0, 3);
      if (b !== nb) { ev.push([i, 3, b]); nb = b; }
    }
    const w = writer();
    w.put(VER, 4); w.put(HZ, 5); w.put(n, 16);
    for (const a of pick) w.put(a, 2);
    w.eg(ev.length, 4);
    let last = 0;
    for (const [i, type, val] of ev) { w.eg(i - last, 3); w.put(type, 2); if (type === 3) w.put(val, 2); last = i; }
    // 集氣條轉折點：[第幾筆的間隔, 數值 (0～100)]
    const kp = gaugeKeys(raw.G, 0.02);
    w.eg(kp.length, 4);
    last = 0;
    for (const [i, v] of kp) { w.eg(i - last, 3); w.put(v, 7); last = i; }
    const M = q.map(() => 32);
    for (let i = 0; i < n; i++) {
      if (key[i]) {
        for (let c = 0; c < q.length; c++) w.put(c === 2 ? ((q[c][i] % 512) + 512) % 512 : q[c][i] + OFF[c], ABS[c]);
        continue;
      }
      for (let c = 0; c < q.length; c++) {
        const u = zig(q[c][i] - predict(q[c], i, key, PRED[pick[c]]));
        w.eg(u, kOf(M[c])); M[c] = upd(M[c], u);
      }
    }
    return toB64(w.bytes());
  }

  function decode(str) {
    const r = reader(fromB64(str));
    const ver = r.get(4);
    if (ver !== 1 && ver !== 2) throw new Error('replay: version');
    const nch = 4;
    const hz = r.get(5), n = r.get(16);
    if (!(hz > 0) || n < 2) throw new Error('replay: empty');
    const pick = [];
    for (let c = 0; c < nch; c++) pick.push(PRED[r.get(2)]);
    const ne = r.eg(4), ev = [];
    let last = 0;
    for (let k = 0; k < ne; k++) { last += r.eg(3); const type = r.get(2); ev.push([last, type, type === 3 && ver >= 2 ? r.get(2) : 0]); }
    const key = new Uint8Array(n), fl = new Uint8Array(n), NB = new Uint8Array(n);
    key[0] = 1;
    for (const [i, type] of ev) if (type === 2 && i < n) key[i] = 1;
    let f = 0, b = 0, e = 0;
    for (let i = 0; i < n; i++) {
      for (; e < ev.length && ev[e][0] === i; e++) { const ty = ev[e][1]; if (ty === 0) f ^= 1; else if (ty === 1) f ^= 2; else if (ty === 3) b = ev[e][2]; }
      fl[i] = f; NB[i] = b;
    }
    // 集氣條 (第 2 版起)：轉折點之間線性內插
    let G = null;
    if (ver >= 2) {
      G = new Float64Array(n);
      const nk = r.eg(4);
      let pi = 0, pv = 0;
      for (let k = 0; k < nk; k++) {
        const i = Math.min(n - 1, pi + r.eg(3)), v = r.get(7) / 100;
        if (k === 0) { for (let j = 0; j <= i; j++) G[j] = v; }
        else for (let j = pi + 1; j <= i; j++) G[j] = pv + ((v - pv) * (j - pi)) / (i - pi);
        pi = i; pv = v;
      }
      for (let j = pi + 1; j < n; j++) G[j] = pv;
    }
    const q = [];
    for (let c = 0; c < nch; c++) q.push(new Int32Array(n));
    const M = q.map(() => 32);
    for (let i = 0; i < n; i++) {
      if (key[i]) { for (let c = 0; c < nch; c++) q[c][i] = r.get(ABS[c]) - OFF[c]; continue; }
      for (let c = 0; c < nch; c++) {
        const k = kOf(M[c]), u = r.eg(k);
        q[c][i] = predict(q[c], i, key, pick[c]) + unzig(u);
        M[c] = upd(M[c], u);
      }
    }
    const seg = new Int32Array(n);
    for (let i = 1; i < n; i++) seg[i] = seg[i - 1] + key[i];
    return {
      hz, n, key, fl, seg, NB,
      S: Float64Array.from(q[0], (v) => v * QS), D: Float64Array.from(q[1], (v) => v * QD),
      Y: Float64Array.from(q[2], (v) => v * QY), H: Float64Array.from(q[3], (v) => v * QH),
      G,   // 第 1 版沒有集氣條 (null)
    };
  }

  // ------------------------------------------------------------------ 錄製 (main.js 每幀呼叫)
  const rec = {
    armed: false, live: false, t: 0, next: 0, last: null, prev: null, cutting: true,
    raw: null, track: '', dir: 1, car: 'k8', color: 0, env: 'sunny',

    // 每場開始 (startRace 結束)：只有 TRACKS 裡的賽道才記
    arm(g) {
      this.armed = !!TRACKS[g.opts.section] && !g.replay;
      this.live = false; this.t = 0; this.next = 0; this.last = this.prev = null; this.cutting = true;
      this.raw = { S: [], D: [], Y: [], H: [], G: [], F: [], N: [], K: [] };
      this.track = g.opts.section; this.dir = g.race.dir;
      this.car = g.opts.car; this.color = g.opts.color; this.env = g.opts.env;
    },
    // 車子被重置 / 瞬移 (按 R、掉下斷崖)：下一筆從新位置重新開始，不要內插過去
    cut() { this.cutting = true; },

    // 進度 s 算好之後、計時之前呼叫 (同一幀先記下車子的位置，抵達終點時 take() 才拿得到最後這一段)
    frame(g, dt, s) {
      if (!this.armed) return;
      if (!this.live) {
        if (g.state !== 'drive' || (RM.Start && RM.Start.on)) return;
        this.live = true; this.t = 0; this.next = 0;            // START：從這一刻開始記
      } else this.t += dt;
      if (g.race.finished || this.raw.S.length >= MAX_SAMPLES) return;
      const c = this._state(g, s);
      if (this.last && Math.abs(c.s - this.last.s) > 40) this.cutting = true;   // 一幀跳太遠：當作瞬移
      if (this.cutting) { this.last = this.prev = null; this.keyNext = true; }  // 下一筆是關鍵影格 (這一幀不一定剛好有取樣時間)
      else c.y = this.last.y + wrap(c.yr - this.last.yr);         // 車頭角展開成連續的值
      const R = this.raw;
      while (this.next / HZ <= this.t + 1e-9) {
        const tg = this.next / HZ, L = this.last;
        const u = L && c.t > L.t ? (tg - L.t) / (c.t - L.t) : 1;
        const m = (a, b) => (L ? a + (b - a) * u : b);
        R.S.push(m(L && L.s, c.s)); R.D.push(m(L && L.d, c.d)); R.Y.push(m(L && L.y, c.y)); R.H.push(m(L && L.h, c.h));
        // 集氣條滿了會換成一瓶、從頭開始 (數值往下掉)：這種時候不內插，取比較近的那一幀
        R.G.push(L && c.gg >= L.gg - 0.3 ? m(L.gg, c.gg) : u < 0.5 && L ? L.gg : c.gg);
        R.F.push((u < 0.5 && L ? L.f : c.f)); R.N.push(u < 0.5 && L ? L.nb : c.nb); R.K.push(this.keyNext ? 1 : 0);
        this.keyNext = false;
        if (!L) this.last = c;   // 關鍵影格之後同一幀的下一筆從這裡內插
        this.next++;
      }
      this.cutting = false;
      this.prev = this.last !== c ? this.last : this.prev;
      this.last = c;
    },
    _state(g, s) {
      const car = g.car, road = g.road, f = road.frameAt(s, this._f || (this._f = {}));
      const d = (car.pos[0] - f.x) * f.rx + (car.pos[2] - f.z) * f.rz;
      // 用 q 現算方向 (car.R 要到下一次物理更新才會跟上；剛被重置的這一幀還是舊的)
      const R = quat.toMat3(this._R || (this._R = new Float32Array(9)), car.q), dir = this.dir;
      const yr = wrap(Math.atan2(-R[6], -R[8]) - Math.atan2(f.tx * dir, f.tz * dir));
      const h = car.pos[1] - (f.y + road.surfOff(f.i, f.t, d) + car.S.cgH);
      const fl = (car.brake > 0.05 ? 1 : 0) | (car.nitroT > 0 ? 2 : 0);
      return { t: this.t, s, d, yr, y: yr, h, f: fl, gg: clamp(car.gauge || 0, 0, 1), nb: car.nitro | 0 };
    },

    // 抵達終點 (online.js onFinish)：結束錄製，編碼成 { v, d, c, env, ts, t }；不是這條賽道 / 太長就回傳 null
    take(run, race) {
      const R = this.raw, L = this.last;
      const ok = this.armed && this.live && L && R && R.S.length >= 2 && run.track === this.track && run.dir === this.dir;
      this.armed = false; this.live = false;
      if (!ok) return null;
      // 最後補一筆 (終點之後的下一個取樣時間，依最後兩幀的速度外插)，播放到終點時兩邊都有資料可以內插
      const P = this.prev, tg = this.next / HZ;
      const k = P && L.t > P.t ? (tg - L.t) / (L.t - P.t) : 0;
      const ex = (a, b) => b + (b - a) * k;
      R.S.push(P ? ex(P.s, L.s) : L.s); R.D.push(P ? ex(P.d, L.d) : L.d); R.Y.push(P ? ex(P.y, L.y) : L.y); R.H.push(P ? ex(P.h, L.h) : L.h);
      R.G.push(L.gg); R.F.push(L.f); R.N.push(L.nb); R.K.push(0);
      let d;
      try { d = encode(R); } catch (e) { console.warn('重播編碼失敗', e); return null; }
      if (d.length > MAX_LEN) return null;
      return { v: 1, d, c: this.color | 0, env: this.env, ts: Math.max(0, Math.round((this.t - race.t) * 1000)), t: Math.round(this.t * 1000) };
    },
  };

  // ------------------------------------------------------------------ 播放
  const CAMS = [
    { mode: 0, label: '追焦視角' }, { mode: 1, label: '遠景追焦' }, { tv: true, mode: 0, label: '轉播鏡頭' },
    { mode: 2, label: '引擎蓋視角' }, { mode: 3, label: '駕駛座視角' }, { mode: 4, label: '保桿視角' },
  ];
  const cr = (A, p0, p1, p2, p3, u) => {
    const a = A[p0], b = A[p1], c = A[p2], d = A[p3];
    return b + 0.5 * u * (c - a + u * (2 * a - 5 * b + 4 * c - d + u * (3 * (b - c) + d - a)));
  };

  class Player {
    // rp：伺服器存的重播 { v, d, c, env, ts, t }；info：{ track, dir, id, name, car, t (毫秒), rank }
    constructor(rp, info) {
      Object.assign(this, decode(rp.d));
      this.rp = rp; this.info = info;
      this.total = Math.min(rp.t / 1000, (this.n - 1) / this.hz);
      this.ts = clamp(rp.ts / 1000, 0, this.total);
      if (!(this.total > 1)) throw new Error('replay: too short');
      this.t = 0; this.speed = 1; this.paused = false; this.ended = false; this.cam = 0;
      this._a = {}; this._b = {}; this._c = {}; this._F = {}; this._G = {};
      this.tv = { ok: false, side: 1, hint: { i: 0 }, tg: [0, 0, 0] };
      this.hints = [{ i: 0 }, { i: 0 }, { i: 0 }, { i: 0 }];
      this.sm = null; this.gear = 1; this.shiftCool = 0;
    }

    // startRace 結束時呼叫：車子放到第 0 秒、顯示控制列
    begin(g) {
      this.g = g; this.road = g.road; this.dir = g.race.dir; this.S0 = g.car.S;
      const car = g.car;
      car.nitro = 0; car.gauge = 0; car.boostT = 0; car.hand = 0; car.shiftT = 0; car.sel = 3; car.engineOn = true;
      g.best = this.info.t > 0 ? this.info.t / 1000 : this.total - this.ts;
      this._ui(true);
      this.seek(0);
    }
    close() { this._ui(false); this.g = null; }

    // ---- 路面座標 → 世界座標
    at(t, o) {
      const n = this.n, K = this.key;
      const x = clamp(t * this.hz, 0, n - 1);
      let i = Math.min(Math.floor(x), n - 2), u = x - i;
      const same = (j) => j >= 0 && j + 1 < n && !K[j + 1];
      if (!same(i)) { if (u >= 1) i++; u = 0; }   // 下一筆是重置後的關鍵影格：停在這一筆，時間到了再跳過去
      const p1 = i, p2 = same(i) ? i + 1 : i;
      const p0 = same(i - 1) ? i - 1 : p1, p3 = p2 === i + 1 && same(i + 1) ? i + 2 : p2;
      o.s = cr(this.S, p0, p1, p2, p3, u); o.d = cr(this.D, p0, p1, p2, p3, u);
      o.y = cr(this.Y, p0, p1, p2, p3, u); o.h = cr(this.H, p0, p1, p2, p3, u);
      o.seg = this.seg[p1]; o.fl = this.fl[u < 0.5 ? p1 : p2];
      // 集氣條 (第 2 版起才有)：線性內插；滿格換瓶往下掉的那一段不內插
      const G = this.G;
      o.g = !G ? 0 : G[p2] >= G[p1] - 0.3 ? G[p1] + (G[p2] - G[p1]) * u : G[u < 0.5 ? p1 : p2];
      o.nb = this.NB[u < 0.5 ? p1 : p2];
      return o;
    }
    world(o) {
      const road = this.road, f = road.frameAt(o.s, this._F);
      o.x = f.x + f.rx * o.d; o.z = f.z + f.rz * o.d;
      o.wy = f.y + road.surfOff(f.i, f.t, o.d) + this.S0.cgH + o.h;
      o.th = Math.atan2(f.tx * this.dir, f.tz * this.dir) + o.y;   // 車頭方位角 (atan2(x, z))
      o.fi = f.i;
      return o;
    }
    // 時間 t 的位置、速度、偏航角速度、加速度
    kin(t) {
      const A = this.world(this.at(t, this._a));
      const dt = 0.05, T = this.total;
      let B = this.world(this.at(Math.min(T, t + dt), this._b)), C = this.world(this.at(Math.max(0, t - dt), this._c));
      let tb = Math.min(T, t + dt), tc = Math.max(0, t - dt);
      if (B.seg !== A.seg) { B = A; tb = t; }
      if (C.seg !== A.seg) { C = A; tc = t; }
      const span = tb - tc;
      const k = {
        A, vx: 0, vy: 0, vz: 0, yawRate: 0, aLong: 0,
      };
      if (span > 1e-4) {
        k.vx = (B.x - C.x) / span; k.vy = (B.wy - C.wy) / span; k.vz = (B.z - C.z) / span;
        k.yawRate = wrap(B.th - C.th) / span;
      }
      // 沿路加速度 (只用 s，不必換算世界座標)
      const sv = (tt) => { const p = this.at(Math.min(T, tt + 0.05), this._G).s, q = this.at(Math.max(0, tt - 0.05), this._G).s; return (p - q) / 0.1; };
      if (t > 0.2 && t < T - 0.2 && this.at(t + 0.15, this._G).seg === A.seg && this.at(t - 0.15, this._G).seg === A.seg) k.aLong = ((sv(t + 0.1) - sv(t - 0.1)) / 0.2) * this.dir;
      return k;
    }

    // ---- 每幀 (main.js frame 在重播時改呼叫這裡)
    frame(g, dt) {
      for (const k of g.input.takeEdges()) {
        if (k === 'Escape') { g.stopReplay(true); return; }
        if (k === 'Space') this.toggle();
        else if (k === 'ArrowLeft') this.seek(this.t - 5);
        else if (k === 'ArrowRight') this.seek(this.t + 5);
        else if (k === 'KeyC') this.nextCam();
      }
      const step = this.paused || this.ended ? 0 : dt * this.speed;
      this.t = Math.min(this.total, this.t + step);
      if (this.t >= this.total && !this.ended) { this.ended = true; this._end(true); g.audio.suspend(); this._uiState(); }
      const st = this.apply(g, step);
      // HUD 的計時、進度條、分段點跟著重播時間走
      const race = g.race, rt = this.t - this.ts;
      race.started = rt > 0; race.t = clamp(rt, 0, this.total - this.ts); race.finished = this.ended;
      for (const cp of race.checkpoints) cp.done = (st.s - cp.s) * race.dir > 0;
      const car = g.car, cam = g.cam, C = CAMS[this.cam];
      cam.mode = C.mode;
      cam.update(dt, car);
      if (C.tv) this._tv(g, dt, st);
      if (step > 0) {
        g.audio.update(car, dt, { inside: cam.inside, horn: false, wet: g.renderer.env.wet });
        g.skid.update(car, step, g.renderer.env.wet);
        g._particles(step);
      }
      g._stream();
      g._render(dt);
      const f = g.road.frameAt(st.s, {});
      g._drawHud(dt, st.s, f, car.speed * 3.6);
      this._uiFrame();
    }

    // 把車子擺到目前時間的狀態 (位置、姿態、速度、輪子、燈號)，回傳路面座標
    // car：要擺的車 (預設是玩家的車；挑戰的幽靈車傳自己的)；quiet：不放音效、不出提示 (幽靈車)
    apply(g, step, car, quiet) {
      car = car || g.car;
      const S = car.S, road = this.road, K = this.kin(this.t), A = K.A;
      const snap = !this.sm || step === 0 && this._snap;
      this._snap = false;
      // 車頭方向與水平的右方
      const fx = Math.sin(A.th), fz = Math.cos(A.th);
      const rx = -fz, rz = fx;
      const vh = Math.hypot(K.vx, K.vz), speed = Math.hypot(K.vx, K.vy, K.vz);
      const vLong = K.vx * fx + K.vz * fz, vLat = K.vx * rx + K.vz * rz;
      // 四個方向的地面高度 → 車身俯仰 / 側傾 (跟著路面)，再加上加減速與過彎的車身晃動
      const gy = (x, z, h) => road.ground(x, z, h, A.wy).y;
      const half = ((S.trackF + S.trackR) / 2) / 2;
      const yF = gy(A.x + fx * S.a, A.z + fz * S.a, this.hints[0]), yB = gy(A.x - fx * S.b, A.z - fz * S.b, this.hints[1]);
      const yL = gy(A.x - rx * half, A.z - rz * half, this.hints[2]), yR = gy(A.x + rx * half, A.z + rz * half, this.hints[3]);
      let pitch = clamp((yF - yB) / (S.a + S.b), -0.6, 0.6) + clamp(K.aLong * 0.0035, -0.04, 0.03);
      let roll = clamp((yR - yL) / (2 * half), -0.5, 0.5) + clamp(vLong * K.yawRate * -0.005, -0.05, 0.05);
      // 離地 (飛越斷崖、駝峰)：車頭對著行進方向，不再跟著地面
      const air = RM.smoothstep(0.25, 0.8, A.h);
      if (air > 0) { pitch += (clamp(K.vy / Math.max(vh, 1), -0.6, 0.6) - pitch) * air; roll *= 1 - air; }
      if (snap) this.sm = { pitch, roll, steer: 0 };
      else { const e = 1 - Math.exp(-step * 12); this.sm.pitch += (pitch - this.sm.pitch) * e; this.sm.roll += (roll - this.sm.roll) * e; }
      const f3 = norm([fx, this.sm.pitch, fz]), r3 = norm([rx, this.sm.roll, rz]);
      const up = norm(cross(r3, f3)), right = norm(cross(f3, up));
      quat.fromBasis(car.q, right, up, [-f3[0], -f3[1], -f3[2]]);
      quat.toMat3(car.R, car.q);
      car.pos[0] = A.x; car.pos[1] = A.wy; car.pos[2] = A.z;
      car.vel[0] = K.vx; car.vel[1] = K.vy; car.vel[2] = K.vz;
      car.w[0] = 0; car.w[1] = K.yawRate; car.w[2] = 0;
      car.speed = speed; car.vLong = vLong; car.hint.i = A.fi;
      // 側滑角 (甩尾) 與前輪角度：前輪對準前軸實際的行進方向 (甩尾時自然反打)
      const beta = vh > 3 ? Math.atan2(vLat, Math.abs(vLong)) : 0;
      car.beta = beta;
      car.drifting = vh > 7 && Math.abs(beta) > 0.14;
      let steer = 0;
      if (vh > 2.5 && vLong > 0) {
        const vfx = K.vx + K.yawRate * fz * S.a, vfz = K.vz - K.yawRate * fx * S.a;
        steer = -wrap(Math.atan2(vfx, vfz) - A.th);
      }
      steer = clamp(steer, -S.steerMax, S.steerMax);
      if (snap) this.sm.steer = steer; else this.sm.steer += (steer - this.sm.steer) * (1 - Math.exp(-step * 10));
      car.steer = this.sm.steer;
      // 煞車燈、氮氣火焰、倒車燈
      car.brake = A.fl & 1 ? 1 : 0;
      car.nitroT = A.fl & 2 && !this.ended ? 1 : 0;   // 播完停在終點時不再噴火
      car.gauge = A.g; car.nitro = A.nb;               // HUD 的氮氣瓶與集氣條
      // 開始噴氮氣：和比賽中一樣的音效與提示 (拖時間軸 / 暫停時不放)
      if (car.nitroT > 0 && !this._nz && step > 0 && !snap && !quiet) { g.audio.whoosh(0.5, 1.4); g.hud.message('氮氣加速！', 1.2, '#7fd8ff', true); }
      this._nz = car.nitroT > 0;
      car.sel = vLong < -0.5 ? 1 : 3;
      car.throttle = car.load = car.brake ? 0 : car.nitroT ? 1 : clamp((K.aLong + 1.2) / 1.5, 0.05, 1);
      // 檔位：直接跑車子本身的自排換檔邏輯 (vehicle.js _tcu，依輪速與油門)；轉速 = 輪速 × 齒比
      const wv = Math.abs(vLong) / S.tireR, rpmG = (gg) => (wv * S.ratios[gg - 1] * S.final * 30) / Math.PI;
      for (const w of car.wheels) w.w = vLong / S.tireR;
      if (snap) { car.shiftT = 0; car.gear = 1; while (car.gear < S.ratios.length && rpmG(car.gear) > S.redline * 0.8) car.gear++; }
      else if (step > 0 && car.sel === 3) {
        car._tcu(step);
        if (!quiet) for (const e of car.events) if (e === 'upshift' || e === 'downshift') g.audio.shift();
      }
      car.events.length = 0;
      const rpm = Math.max(S.idle, rpmG(car.gear), vh < 9 ? S.idle + car.load * 2600 : 0);
      car.rpm = snap ? rpm : car.rpm + (Math.min(rpm, S.redline) - car.rpm) * (1 - Math.exp(-step * 14));
      // 輪子：懸吊長度跟著地面、轉速跟著車速；打滑程度 = 接地點的橫向速度 (胎痕、輪胎煙、胎聲都看這個)
      const R = car.R, U = [R[3], R[4], R[5]];
      for (const w of car.wheels) {
        const an = w.anchor;
        const ax = car.pos[0] + R[0] * an[0] + R[3] * an[1] + R[6] * an[2];
        const ay = car.pos[1] + R[1] * an[0] + R[4] * an[1] + R[7] * an[2];
        const az = car.pos[2] + R[2] * an[0] + R[5] * an[1] + R[8] * an[2];
        const gr = road.ground(ax, az, w.hint, ay);
        w.gn[0] = gr.nx; w.gn[1] = gr.ny; w.gn[2] = gr.nz; w.surf = gr.surf;
        let len = (ay - gr.y) / Math.max(U[1], 0.3) - S.tireR;
        w.contact = len <= w.lenMax + 0.03;
        len = clamp(len, w.lenMin, w.lenMax);
        w.len = snap ? len : w.len + (len - w.len) * (1 - Math.exp(-step * 25));
        w.wpos[0] = ax - U[0] * w.len; w.wpos[1] = ay - U[1] * w.len; w.wpos[2] = az - U[2] * w.len;
        w.Fz = w.contact ? (S.mass * 9.81) / 4 : 0;
        if (w.front) w.steer = car.steer;
        w.angle += w.w * step;
        // 接地點速度 (車身速度 + 偏航造成的速度) 在輪胎橫向的分量
        const px = w.wpos[0] - car.pos[0], pz = w.wpos[2] - car.pos[2];
        const cvx = K.vx + K.yawRate * pz, cvz = K.vz - K.yawRate * px;
        const sa = w.front ? car.steer : 0, hx = Math.sin(A.th - sa), hz = Math.cos(A.th - sa);
        w.slipVel = Math.abs(cvx * -hz + cvz * hx);
      }
      return A;
    }

    // 轉播鏡頭：架在前方路邊，車子經過後換到下一個機位
    _tv(g, dt, A) {
      const cam = g.cam, road = this.road, T = this.tv, car = g.car;
      const ahead = (T.s - A.s) * this.dir;
      if (!T.ok || ahead < -24 || ahead > 200) {
        T.s = A.s + this.dir * clamp(car.speed * 2.6, 55, 140);
        T.side = -T.side;
        const f = road.frameAt(T.s, {});
        const off = f.W + 4.5;
        T.x = f.x + f.rx * T.side * off; T.z = f.z + f.rz * T.side * off;
        T.hint.i = f.i;
        T.y = Math.max(road.ground(T.x, T.z, T.hint, f.y).y, f.y) + 2.6;
        T.tg = [car.pos[0], car.pos[1] + 0.5, car.pos[2]];
        T.ok = true;
      }
      const e = 1 - Math.exp(-dt * 14);
      for (let i = 0; i < 3; i++) T.tg[i] += (car.pos[i] + (i === 1 ? 0.5 : 0) - T.tg[i]) * e;
      cam.eye = [T.x, T.y, T.z]; cam.target = T.tg.slice(); cam.up = [0, 1, 0];
      const dist = Math.hypot(T.tg[0] - T.x, T.tg[1] - T.y, T.tg[2] - T.z);
      cam.fov = clamp((2 * Math.atan(6 / Math.max(dist, 1)) * 180) / Math.PI, 7, 60);
    }

    // ---- 操作
    toggle() {
      if (this.ended) { this.seek(0); this.paused = false; }
      else this.paused = !this.paused;
      const g = this.g;
      if (g) { if (this.paused) g.audio.suspend(); else g.audio.resume(); }
      this._uiState();
    }
    setSpeed(v) { this.speed = v; this._uiState(); }
    nextCam() {
      this.cam = (this.cam + 1) % CAMS.length;
      this.tv.ok = false;
      if (this.g) { this.g.cam.mode = CAMS[this.cam].mode; this.g.cam.snap(); this.g.hud.message(CAMS[this.cam].label, 1.2); }
      this._uiState();
    }
    camLabel() { return CAMS[this.cam].label; }
    seek(t) {
      this.t = clamp(t, 0, this.total);
      this.ended = this.t >= this.total;
      this._end(this.ended);
      this._snap = true; this.sm = null; this.tv.ok = false;
      const g = this.g;
      if (g) {
        g.skid.clear();
        if (g.partList) g.partList.length = 0;
        this.apply(g, 0);
        g.cam.snap();
        if (this.ended || this.paused) g.audio.suspend(); else g.audio.resume();
      }
      this._uiState();
    }

    // ---- 介面 (index.html 的 #replayUi)
    _ui(on) {
      const box = $('replayUi');
      if (!box) return;
      box.classList.toggle('hidden', !on);
      if (!on) return;
      if (!this.constructor._bound) {
        this.constructor._bound = true;
        const P = () => RM.Game && RM.Game.replay;
        const btn = (id, fn) => $(id).addEventListener('click', (e) => { e.currentTarget.blur(); const p = P(); if (p) fn(p); });
        btn('rvPlay', (p) => p.toggle());
        btn('rvCam', (p) => p.nextCam());
        btn('rvExit', () => RM.Game.stopReplay(true));
        btn('rvAgain', (p) => { p.seek(0); p.paused = false; p._uiState(); if (p.g) p.g.audio.resume(); });
        btn('rvBack', () => RM.Game.stopReplay(true));
        $('rvSpeed').addEventListener('click', (e) => { const b = e.target.closest('button[data-rspeed]'); if (!b) return; b.blur(); const p = P(); if (p) p.setSpeed(+b.dataset.rspeed); });
        const seek = $('rvSeek');
        seek.addEventListener('input', () => { const p = P(); if (p) p.seek((+seek.value / 1000) * p.total); });
        seek.addEventListener('pointerdown', () => { const p = P(); if (p) p.dragging = true; });
        for (const ev of ['pointerup', 'pointercancel', 'change']) seek.addEventListener(ev, () => { const p = P(); if (p) p.dragging = false; seek.blur(); });
      }
      const I = this.info, CARS = { k8: 'Civic K8', gr86: 'GR86', ae86: 'AE86', r34: 'GT-R R34', r35: 'GT-R R35', p911: '911 RS 2.7' };
      const track = I.track === RM.DriftTrack.id ? RM.DriftTrack.section.name : '北宜彎道衝刺' + (I.dir < 0 ? '（往台北）' : '（往宜蘭）');
      $('rvWho').textContent = I.name || '玩家';
      $('rvWhat').textContent = [I.rank ? `第 ${I.rank} 名` : '', CARS[I.car] || '', track].filter(Boolean).join(' · ');
      $('rvTotal').textContent = RM.fmtTime(this.total - this.ts);
      this._uiState();
    }
    _uiState() {
      if (!$('replayUi')) return;
      const play = $('rvPlay');
      play.textContent = this.paused || this.ended ? '▶' : '❚❚';
      play.setAttribute('aria-label', this.paused || this.ended ? '播放' : '暫停');
      $('rvSpeed').querySelectorAll('[data-rspeed]').forEach((b) => b.classList.toggle('on', +b.dataset.rspeed === this.speed));
      $('rvCam').textContent = '視角：' + CAMS[this.cam].label;
      this._uiFrame(true);
    }
    _uiFrame(force) {
      const box = $('replayUi');
      if (!box) return;
      const hs = this.g && this.g.hud ? this.g.hud.scale : 1;   // 控制列避開右下的儀表板 (HUD 依畫面大小縮放)
      if (hs !== this._hs) { this._hs = hs; box.style.setProperty('--hs', String(hs)); }
      const rt = clamp(this.t - this.ts, 0, this.total - this.ts);
      const txt = RM.fmtTime(rt);
      if (force || txt !== this._txt) { this._txt = txt; $('rvTime').textContent = txt; }
      if (!this.dragging) { const v = String(Math.round((this.t / this.total) * 1000)); if ($('rvSeek').value !== v) $('rvSeek').value = v; }
    }
    _end(on) {
      const el = $('rvEnd');
      if (!el) return;
      el.classList.toggle('hidden', !on);
      if (on) $('rvEndTime').textContent = RM.fmtTime(this.total - this.ts);
    }
  }

  // ------------------------------------------------------------------ 挑戰：幽靈車
  // 紀錄視窗按「挑戰」：用自己的車跑那條賽道，那筆紀錄的重播變成半透明的幽靈車一起跑 (不碰撞，自己的成績照常計算)。
  // 幽靈車的時間跟著自己的碼錶 (兩邊都從 START 起算)；位置 / 姿態沿用重播播放器 (Player.apply 擺到另一台車上)。
  // 畫法見 renderer.js 的「幽靈車」階段：先只寫深度、再用固定透明度疊上顏色 (車身不會自己透自己)。
  const GHOST_A = 0.5;   // 幽靈車的不透明度 (和自己的車疊在一起時再淡一點)
  const CAR_NAMES = { k8: 'Civic K8', gr86: 'GR86', ae86: 'AE86', r34: 'GT-R R34', r35: 'GT-R R35', p911: '911 RS 2.7' };
  class Ghost {
    // rp / info 同 Player：info = { track, dir, id, name, car, t (毫秒), rank }
    constructor(rp, info) {
      this.p = new Player(rp, info);
      this.info = info;
      // 重播的時間 = 碼錶 + off：重播從 START 那一幀之後才開始記，比碼錶晚一幀左右 (用全長和成績的差推回來)
      this.off = clamp((rp.t - (info.t > 0 ? info.t : rp.t)) / 1000, -0.2, 0.2);
      this.on = false; this.t = 0; this.fade = 1; this.alpha = 0; this.veh = null;
    }

    // startRace 結束時呼叫 (每一場，含「再跑一次」)：建立幽靈車。賽道 / 方向不對、多人比賽就不出現
    begin(g) {
      const I = this.info, p = this.p, race = g.race;
      this.on = !g.replay && g.opts.section === I.track && race.dir === (I.dir < 0 ? -1 : 1) && !(RM.Net && RM.Net.racing);
      this._ui(this.on);
      if (!this.on) return;
      const COL = RM.CivicModel.COLORS, color = clamp(p.rp.c | 0, 0, COL.length - 1);
      // 和自己同款的車共用同一份模型；其他車款另外建一份 (同多人連線其他玩家的車)
      const model = !g.carAsset && g.carModel && g.carModel.id === I.car ? g.carModel : RM.ProcCar.getExtra(I.car, g.atlas);
      this.veh = new RM.Vehicle(g.road, model.spec());
      this.veh.reset(race.startS, race.dir);
      p.g = null; p.road = g.road; p.dir = race.dir; p.S0 = this.veh.S;
      p.t = 0; p.sm = null; p.ended = false; p._nz = false; p.hints = [{ i: 0 }, { i: 0 }, { i: 0 }, { i: 0 }];
      this.ctx = { car: this.veh, carModel: model, carAsset: null, opts: { color }, paint: RM.srgb(COL[color][1]), headOn: g.headOn, blink: { l: false, r: false, on: false, t: 0 }, cam: { name: 'chase' } };
      this._draw = { list: [], glass: [], shells: [], alpha: 0 }; this._ns = [];
      this.t = 0; this.fade = 1; this.alpha = 0; this._gapAt = 0; this._txt = null;
      // 每一筆取樣「到那時為止跑最遠的進度」(公尺，單調遞增)：算自己和幽靈車差幾秒用
      const P = (this.P = new Float32Array(p.n));
      let m = -Infinity;
      for (let i = 0; i < p.n; i++) { m = Math.max(m, (p.S[i] - race.startS) * race.dir); P[i] = m; }
      p.apply(g, 0, this.veh, true);
    }
    close() { this.on = false; this._ui(false); }

    // 每幀 (main.js frame，計時之後)：幽靈車跟著自己的碼錶走；自己到終點後繼續跑，幽靈車跑完就淡出
    frame(g, dt) {
      if (!this.on) return;
      const race = g.race, p = this.p, prev = this.t;
      this.t = !race.started ? 0 : race.finished ? this.t + dt : race.t;
      const T = this.t + (race.started ? this.off : 0);
      this.fade = T > p.total ? Math.max(0, this.fade - dt / 0.8) : 1;
      p.t = clamp(T, 0, p.total);
      p.ended = T >= p.total;   // 停在終點時不噴氮氣火焰
      p.apply(g, Math.max(0, this.t - prev), this.veh, true);
    }

    // 繪製清單 (main.js _render)：{ list, shells, alpha }；看不到 / 太淡就回傳 null
    draw(g) {
      this.alpha = 0;
      if (!this.on || !(this.fade > 0)) return null;
      const v = this.veh.pos, eye = g.cam.eye, me = g.car.pos;
      const dc = Math.hypot(v[0] - eye[0], v[1] - eye[1], v[2] - eye[2]);
      if (dc > 700 || !RM.sphereVisible(g.renderer.planes, v[0], v[1] + 0.4, v[2], 3.4)) return null;
      const dm = Math.hypot(v[0] - me[0], v[1] - me[1], v[2] - me[2]);
      // 和自己的車疊在一起 (起跑時) 淡一點；相機在幽靈車裡面 (車內視角) 就不畫
      const a = GHOST_A * this.fade * (0.35 + 0.65 * RM.smoothstep(2.5, 9, dm)) * RM.smoothstep(1.5, 4, dc);
      if (a < 0.02) return null;
      const D = this._draw;
      D.list.length = 0; D.glass.length = 0; D.shells.length = 0; this._ns.length = 0;
      this.ctx.headOn = g.headOn;
      g._carDraw.call(this.ctx, D.list, D.glass, this._ns);   // 車窗 (D.glass) 與陰影不畫
      if (this.ctx._carShell) D.shells.push(this.ctx._carShell);
      this.alpha = D.alpha = a;
      this.dm = dm; this.dc = dc;
      return D;
    }
    // 幽靈車正在噴氮氣 (main.js 畫火焰光暈)
    flaming() { return this.on && this.alpha > 0.05 && this.veh.nitroT > 0; }

    // 和幽靈車差幾秒 (正 = 自己落後)：自己現在的進度，幽靈車是在什麼時候跑到的
    gap(race, s) {
      const prog = (s - race.startS) * race.dir, P = this.P, n = P ? P.length : 0;
      if (!race.started || !n || prog < 3 || prog > P[n - 1]) return null;
      let lo = 0, hi = n - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (P[mid] >= prog) hi = mid; else lo = mid + 1; }
      const fr = lo > 0 && P[lo] > P[lo - 1] ? (prog - P[lo - 1]) / (P[lo] - P[lo - 1]) : 1;
      const tg = lo > 0 ? (lo - 1 + fr) / this.p.hz : 0;
      return race.t - (tg - this.off);
    }

    // ---- 畫面上的資訊 (index.html 的 #ghostUi)：上方「挑戰 誰 紀錄 · 領先 / 落後幾秒」、幽靈車頭上的名牌
    _ui(on) {
      const box = $('ghostUi');
      if (!box) return;
      box.classList.toggle('hidden', !on);
      if (!on) return;
      const I = this.info;
      $('ghWho').textContent = I.name || '玩家';
      $('ghWhat').textContent = [I.rank ? `第 ${I.rank} 名` : '', CAR_NAMES[I.car] || '', I.t > 0 ? RM.fmtTime(I.t / 1000) : ''].filter(Boolean).join(' · ');
      $('ghGap').textContent = ''; $('ghGap').className = 'gh-gap';
      const tag = $('ghTag');
      tag.textContent = I.name || '玩家'; tag.style.display = 'none';
    }
    // 每幀 (main.js frame，畫完之後)
    ui(g, s) {
      if (!this.on) return;
      const box = $('ghostUi');
      if (!box) return;
      const hs = g.hud ? g.hud.scale : 1;   // 跟著 HUD 縮放，放在計時框下方
      if (hs !== this._hs) { this._hs = hs; box.style.setProperty('--hs', String(hs)); }
      const now = performance.now();
      if (now >= this._gapAt) {
        this._gapAt = now + 100;
        const race = g.race, I = this.info;
        let txt = '', cls = '';
        if (race.finished && I.t > 0) {
          const d = race.t - I.t / 1000;
          txt = Math.abs(d) < 0.005 ? '平手' : (d < 0 ? '勝 ' : '敗 ') + Math.abs(d).toFixed(2) + ' 秒'; cls = d < 0 ? 'ahead' : 'behind';
        } else {
          const d = this.gap(race, s);
          if (d !== null) { txt = (d > 0 ? '落後 +' : '領先 −') + Math.abs(d).toFixed(2); cls = d > 0 ? 'behind' : 'ahead'; }
        }
        if (txt !== this._txt) { this._txt = txt; const el = $('ghGap'); el.textContent = txt; el.className = 'gh-gap ' + cls; }
      }
      // 名牌：把幽靈車頂上方的點投影到螢幕 (和自己的車疊在一起時不顯示)
      const tag = $('ghTag'), v = this.veh.pos, m = g.renderer.vp;
      const x = v[0], y = v[1] + 1.35, z = v[2];
      const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
      const show = this.alpha > 0.08 && this.dm > 5 && this.dc < 250 && cw > 1;
      if (show !== (tag.style.display !== 'none')) tag.style.display = show ? '' : 'none';
      if (!show) return;
      const W = window.innerWidth, H = window.innerHeight;
      const sx = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / cw * 0.5 + 0.5) * W, sy = (0.5 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / cw * 0.5) * H;
      tag.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }

  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

  RM.Replay = {
    TRACKS, HZ, MAX_LEN, encode, decode, rec, Player, Ghost,
    // startRace 結束時呼叫：重播模式就開始播放，否則開始錄這一場 (挑戰模式另外放出幽靈車)
    start(g) {
      if (g.replay) { g.replay.begin(g); return; }
      rec.arm(g);
      if (g.ghost) g.ghost.begin(g);
    },
    has(track) { return !!TRACKS[track]; },
  };
})();
