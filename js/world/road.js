'use strict';
// 台9線 北宜公路：中心線、路面幾何、超高、加寬、護欄判斷、地形挖填、物理查詢
(function () {
  const RM = window.RM;
  const { clamp, lerp, smoothstep } = RM;

  function gaussSmooth(a, sigma) {
    const n = a.length, r = Math.ceil(sigma * 3);
    const k = new Float32Array(2 * r + 1);
    let ks = 0;
    for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-0.5 * (i / sigma) ** 2); ks += k[i + r]; }
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = -r; j <= r; j++) {
        const idx = i + j < 0 ? 0 : i + j >= n ? n - 1 : i + j;
        s += a[idx] * k[j + r];
      }
      out[i] = s / ks;
    }
    return out;
  }

  // 側邊斷面 (距柏油邊緣 e 公尺處的相對高度)
  const SIDE_E = [0, 0.35, 0.55, 0.8, 2.6];
  const SIDE_Y = [
    [0, 0, -0.28, 0.05, -2.2],    // 0 山側水溝
    [0, -0.04, -0.07, -0.1, -2.8], // 1 護欄側 (邊坡往下)
    [0, 0, 0, 0, -1.0],           // 2 橋面
    [0, 0.15, 0.15, 0.15, 0.15],  // 3 市區人行道
  ];
  function sideProfile(st, e) {
    const Y = SIDE_Y[st];
    if (e <= 0) return 0;
    for (let k = 1; k < SIDE_E.length; k++) {
      if (e <= SIDE_E[k]) {
        const t = (e - SIDE_E[k - 1]) / (SIDE_E[k] - SIDE_E[k - 1]);
        return Y[k - 1] + (Y[k] - Y[k - 1]) * t;
      }
    }
    return Y[Y.length - 1];
  }

  const ZONES = [
    [0, 1500, '新店'], [12600, 13150, '小格頭'], [25950, 26950, '坪林'],
    [44700, 45100, '石牌'], [57250, 58400, '頭城'],
  ];

  // ------------------------------------------------------------ 遊戲性路線修整 (彎道衝刺)
  // 原始 OSM 路形在 30.6K～32.7K 有 22 個大小相近的彎 (多為 40～60°、R30～40)，彎間直線只有 4～78 m：
  // 跑起來一直在轉、沒有地方用氮氣，也沒有能長時間甩尾集氣的彎。
  // 這裡把 s0～s1 重新設計為「直線 + 緩和曲線 + 圓弧」：高速右掃、大左 U、連續 S、兩個髮夾、假動作接髮夾等 13 個特色彎，
  // 彎間直線 15～140 m。設計時以最佳化讓兩端與原路的位置與方向完全接合、總長不變 (下游里程、區間測速等都不受影響)，
  // 平均偏離原路約 15 m；路面高程依新位置的地形調整 (坡度上限 10%)。改成 false 即還原真實路形。
  const TRACK_EDIT = true;
  const EDITS = [{
    s0: 18460, s1: 21040,
    // 數字 = 直線長 (m)；[角度° (+右 / -左), 半徑 m] = 彎 (前後各接一段緩和曲線，曲率由 0 漸增，入彎不會突兀)
    elems: [149.2438, [-43.2013, 55.8162], 22.4282, [87.444, 46.6247], 41.9672, [-114.1958, 32.6111],
      138.9857,                 // 起跑直線
      [90.0864, 56.7523],       // ① 高速右掃彎
      50.4208, [-194.2063, 49.3642], // ② 大左 U (最長的甩尾集氣彎)
      91.5005, [100.3856, 25.605], 80.5464, [-140.627, 30.0678], 30.6468, [91.3625, 26.2984], 49.6007, [-134.1742, 37.0742], // ③～⑥ 連續 S
      42.9083, [155.1074, 25.315], // ⑦ 髮夾
      60.0546, [-53.1659, 38.0272], 15.1175, [164.8735, 25.0586], // ⑧ 假動作 → ⑨ 髮夾
      51.5303, [-33.8182, 79.1189], 95.5741, // 緩彎 + 直線
      [-86.2422, 26.3819], 12, [147.2506, 24.9744], // ⑩ → ⑪ 左右連彎
      69.1105, [-35.7419, 49.0335], 130.5326, [-51.0671, 40.2567], // ⑫、長直線、⑬
      81.2582],                 // 終點直線
  }];
  const spiralLen = (deg, R) => Math.max(6, Math.min(0.55 * R, 0.42 * Math.abs(deg) / 57.2958 * R, 24));

  // 直線、緩和曲線與圓弧，以 0.5 m 步長積分。tail 為指定總長度時用末段直線補足。
  function traceLayout(elems, x = 0, z = 0, phi = 0, tail = 0) {
    let s = 0;
    const xs = [x], zs = [z], ss = [0];
    const seg = (len, k0, k1) => {
      const m = Math.max(1, Math.round(len / 0.5)), h = len / m;
      for (let q = 0; q < m; q++) {
        const km = k0 + (k1 - k0) * ((q + 0.5) / m), pm = phi + km * h / 2;
        x += Math.cos(pm) * h; z += Math.sin(pm) * h; phi += km * h; s += h;
        xs.push(x); zs.push(z); ss.push(s);
      }
    };
    for (const e of elems) {
      if (typeof e === 'number') { seg(e, 0, 0); continue; }
      if (e.arcs) {
        // 複合彎的各段共用緩和曲線，彎中直接由一個曲率過渡到下一個。
        const arcs = e.arcs, n = arcs.length;
        const curvatures = arcs.map(([angle, radius]) => Math.sign(angle) / radius);
        const lengths = arcs.map(([angle, radius]) => Math.abs(angle) / 57.2958 * radius);
        const ramps = [Math.min(spiralLen(...arcs[0]), lengths[0])];
        for (let i = 1; i < n; i++) ramps.push(Math.min(16, lengths[i - 1] * .6, lengths[i] * .6));
        ramps.push(Math.min(spiralLen(...arcs[n - 1]), lengths[n - 1]));
        seg(ramps[0], 0, curvatures[0]);
        for (let i = 0; i < n; i++) {
          // 把內外兩段緩和曲線各分一半給這段圓弧，總轉角維持設定值。
          seg(lengths[i] - (ramps[i] + ramps[i + 1]) * .5, curvatures[i], curvatures[i]);
          seg(ramps[i + 1], curvatures[i], curvatures[i + 1] ?? 0);
        }
        continue;
      }
      const k = Math.sign(e[0]) / e[1], Ls = spiralLen(e[0], e[1]);
      seg(Ls, 0, k); seg(Math.max(0, Math.abs(e[0]) / 57.2958 * e[1] - Ls), k, k); seg(Ls, k, 0);
    }
    if (tail > s) seg(tail - s, 0, 0);
    return { xs, zs, ss };
  }

  function applyEdit(px, py, pz, sp, hm, E) {
    const i0 = Math.round(E.s0 / sp), i1 = Math.round(E.s1 / sp), n = i1 - i0 + 1;
    const phi = Math.atan2(pz[i0 + 1] - pz[i0 - 1], px[i0 + 1] - px[i0 - 1]);
    const { xs, zs, ss } = traceLayout(E.elems, px[i0], pz[i0], phi);
    // 2. 每 sp 公尺重新取樣；終點的微小誤差 (幾公分) 平滑分攤到全段
    const nx = new Float32Array(n), nz = new Float32Array(n);
    for (let q = 0, c = 0; q < n; q++) {
      const t = q * sp;
      while (c < ss.length - 2 && ss[c + 1] < t) c++;
      const f = clamp((t - ss[c]) / (ss[c + 1] - ss[c] || 1), 0, 1);
      nx[q] = xs[c] + (xs[c + 1] - xs[c]) * f; nz[q] = zs[c] + (zs[c + 1] - zs[c]) * f;
    }
    const ex = px[i1] - nx[n - 1], ez = pz[i1] - nz[n - 1];
    for (let q = 0; q < n; q++) { const w = smoothstep(0, 1, q / (n - 1)); nx[q] += ex * w; nz[q] += ez * w; }
    // 3. 高程：原高程 + (新位置地形 - 原位置地形)，平滑約 40 m、兩端 90 m 內淡出，再把坡度限制在 10%
    const fade = (q) => smoothstep(0, 1, Math.min(q, n - 1 - q) / 45);
    const dl = new Float32Array(n);
    for (let q = 0; q < n; q++) dl[q] = hm.natural(nx[q], nz[q]) - hm.natural(px[i0 + q], pz[i0 + q]);
    const dls = gaussSmooth(dl, 20);
    const t = new Float32Array(n);
    for (let q = 0; q < n; q++) t[q] = py[i0 + q] + dls[q] * fade(q);
    const g = 0.1 * sp, f = new Float32Array(n), b = new Float32Array(n);
    const limit = (y) => {
      f[0] = y[0]; for (let q = 1; q < n; q++) f[q] = clamp(y[q], f[q - 1] - g, f[q - 1] + g);
      b[n - 1] = y[n - 1]; for (let q = n - 2; q >= 0; q--) b[q] = clamp(y[q], b[q + 1] - g, b[q + 1] + g);
      for (let q = 0; q < n; q++) y[q] = (f[q] + b[q]) / 2;
    };
    let y = Float32Array.from(t);
    for (let k = 0; k < 40; k++) {
      limit(y);
      y = gaussSmooth(y, 4);
      for (let q = 0; q < n; q++) y[q] += (t[q] - y[q]) * 0.15 * fade(q);
      y[0] = t[0]; y[n - 1] = t[n - 1];
    }
    for (let k = 0; k < 6; k++) limit(y);
    const e0 = py[i0] - y[0], e1 = py[i1] - y[n - 1];
    for (let q = 0; q < n; q++) { const w = q / (n - 1); y[q] += e0 * (1 - w) * (1 - fade(q)) + e1 * w * (1 - fade(q)); }
    for (let q = 0; q < n; q++) { px[i0 + q] = nx[q]; pz[i0 + q] = nz[q]; py[i0 + q] = y[q]; }
  }

  class Road {
    constructor(data, hm) {
      this.data = data;
      this.hm = hm;
      const N = (this.N = data.count);
      const sp = (this.sp = data.spacing);
      this.length = (N - 1) * sp;
      const xyz = data.points || new Float32Array(RM.b64ToBytes(data.xyz).buffer);
      const px = (this.px = new Float32Array(N)), py = (this.py = new Float32Array(N)), pz = (this.pz = new Float32Array(N));
      for (let i = 0; i < N; i++) { px[i] = xyz[i * 3]; py[i] = xyz[i * 3 + 1]; pz[i] = xyz[i * 3 + 2]; }
      if (TRACK_EDIT && !data.closedCourse) for (const E of EDITS) applyEdit(px, py, pz, sp, hm, E);

      const tx = (this.tx = new Float32Array(N)), tz = (this.tz = new Float32Array(N));
      const rx = (this.rx = new Float32Array(N)), rz = (this.rz = new Float32Array(N));
      const grade = (this.grade = new Float32Array(N));
      for (let i = 0; i < N; i++) {
        const a = Math.max(i - 1, 0), b = Math.min(i + 1, N - 1);
        const dx = px[b] - px[a], dz = pz[b] - pz[a];
        const l = Math.hypot(dx, dz) || 1;
        tx[i] = dx / l; tz[i] = dz / l;
        rx[i] = -tz[i]; rz[i] = tx[i];
        grade[i] = (py[b] - py[a]) / l;
      }
      // 曲率 (+ = 右彎)
      let k = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const a = Math.max(i - 1, 0), b = Math.min(i + 1, N - 1);
        k[i] = ((tx[b] - tx[a]) * rx[i] + (tz[b] - tz[a]) * rz[i]) / ((b - a) * sp);
      }
      k = this.curv = gaussSmooth(k, 3);

      // 超高 (彎道外側抬高, 最大 8%)
      const es = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const e = clamp(12.3 * Math.abs(k[i]) - 0.06, 0, 0.08);
        es[i] = Math.sign(k[i]) * e;
      }
      const esm = gaussSmooth(es, 10);
      this.bank = new Float32Array(N);
      for (let i = 0; i < N; i++) this.bank[i] = -esm[i];

      // 分區
      this.zone = new Uint8Array(N);
      this.zones = data.closedCourse ? [] : ZONES;
      for (const [s0, s1] of this.zones) {
        for (let i = Math.max(0, Math.floor(s0 / sp)); i <= Math.min(N - 1, Math.floor(s1 / sp)); i++) this.zone[i] = 1;
      }
      // 路寬 (半寬)：雙向四車道 (每車道 3.6 m) + 路肩 1.2 m = 半寬 8.4 m (原本 4.1 m 的兩倍)，彎道加寬
      // 髮夾彎半徑僅約 10 m：內側半寬限制在 0.78 R，避免路面向內摺疊
      this.laneIn = 1.8; this.laneOut = 5.4; this.laneW = 3.6;
      let hw = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const base = data.halfWidth ? data.halfWidth(i * sp) : this.zone[i] ? 9.2 : 8.4;
        hw[i] = base + Math.min(1.2, 10 * Math.abs(k[i]));
      }
      const cap = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        let c = 99;
        for (let j = Math.max(0, i - 12); j <= Math.min(N - 1, i + 12); j++) c = Math.min(c, 0.78 / Math.max(Math.abs(k[j]), 1e-4));
        cap[i] = c;
        hw[i] = Math.min(hw[i], c);
      }
      hw = gaussSmooth(hw, 6);
      for (let i = 0; i < N; i++) hw[i] = Math.min(hw[i], cap[i]);
      this.halfW = hw;

      // 路面扭曲度 (路面高度場二階導數的上界，1/m)：地形網格是三角形線性內插，而「坡度 × 彎度」大的路面是扭曲面，
      // 內插誤差 ≈ 扭曲度 × 網格邊長² / 4。carved() 依此把路基多挖深一點，地形 (尤其遠處的粗網格) 才不會凸出路面
      const warp = (this.warp = new Float32Array(N));
      for (let i = 1; i < N - 1; i++) {
        const ak = Math.abs(k[i]), q = 1 / Math.max(1 - ak * hw[i], 0.22); // 彎道內側邊緣半徑小 → 扭曲放大
        const sag = Math.max(0, (py[i + 1] - 2 * py[i] + py[i - 1]) / (sp * sp)); // 凹形豎曲線
        warp[i] = Math.abs(grade[i]) * ak * q * q + Math.abs(this.bank[i]) * ak * q + Math.abs(this.bank[i + 1] - this.bank[i - 1]) / (2 * sp) + sag;
      }
      this._warpWin = new Map();

      // 橋樑
      this.bridge = new Uint8Array(N);
      for (const [a, b] of data.bridges) for (let i = Math.max(0, a); i <= Math.min(N - 1, b); i++) this.bridge[i] = 1;

      // 斷崖 (data.gaps：[[起點, 終點, 深度, 前, 後]]，公尺)：這一段沒有路面，物理地面比中心線低「深度」公尺，車子要飛過去。
      //   hole[i]  第 i～i+1 個取樣點之間是缺口：地面在下方 hole 公尺
      //   under[i] 缺口前 40 m、後 100 m 內的路面是懸空的橋面 (薄板)：沒飛過去的車會從橋下掉下去，見 _pit()
      //   jump[i]  飛越路段 (缺口「前」公尺到「後」公尺，預設 60 / 120)：四輪離地時不額外加重力 (vehicle.js 的 plant.air)，
      //            飛得遠、落地也比較輕；高速時另有穩定輔助 (空中擺正、方向鍵舵角收小、車頭不亂甩)，見 vehicle.js
      this.gaps = []; this.hole = null; this.under = null; this.jump = null;
      for (const [a, b, depth, before = 60, after = 120] of data.gaps || []) {
        if (!this.hole) { this.hole = new Float32Array(N); this.under = new Float32Array(N); this.jump = new Uint8Array(N); }
        const i0 = Math.round(a / sp), i1 = Math.round(b / sp);
        for (let i = i0; i < i1; i++) this.hole[i] = depth;
        for (let i = Math.max(0, i0 - 20); i <= Math.min(N - 1, i1 + 50); i++) this.under[i] = depth;
        for (let i = Math.max(0, i0 - Math.round(before / sp)); i <= Math.min(N - 1, i1 + Math.round(after / sp)); i++) this.jump[i] = 1;
        this.gaps.push({ s0: i0 * sp, s1: i1 * sp, depth });
      }

      this._classifySides();
      this._buildHash();
      this._buildMask();

      this.names = data.names;
      this.landmarks = data.landmarks;
      this.kmOffset = data.kmOffset;
      this._pr = { i: 0, t: 0, fi: 0, d: 0, cy: 0 };
      this._g = { y: 0, nx: 0, ny: 1, nz: 0, surf: 0, d: 0, fi: 0, W: 4 };
      this.brFi = new Float64Array(8); this.brD = new Float64Array(8); this.brN = 0;
      this._cand = new Int32Array(8192);
      this._cd = new Float64Array(8192);
    }

    _classifySides() {
      const N = this.N, hm = this.hm;
      const rail = [new Uint8Array(N), new Uint8Array(N)]; // [左, 右]
      this.drop = [new Float32Array(N), new Float32Array(N)];
      for (let i = 0; i < N; i++) {
        const W = this.halfW[i];
        for (let s = 0; s < 2; s++) {
          const sg = s === 0 ? -1 : 1;
          let mn = Infinity;
          for (const off of [5, 10, 17]) {
            const h = hm.sample(this.px[i] + this.rx[i] * sg * (W + off), this.pz[i] + this.rz[i] * sg * (W + off));
            mn = Math.min(mn, h + off * 0.08);
          }
          const drop = this.py[i] - mn;
          this.drop[s][i] = drop;
          rail[s][i] = this.data.closedCourse || drop > (this.zone[i] ? 6 : 2.5) ? 1 : 0;
        }
      }
      // 髮夾彎外側一定有護欄
      for (let i = 0; i < N; i++) {
        if (Math.abs(this.curv[i]) > 1 / 45) {
          const outer = this.curv[i] > 0 ? 0 : 1;
          for (let j = Math.max(0, i - 12); j <= Math.min(N - 1, i + 12); j++) rail[outer][j] = 1;
        }
      }
      // 形態學：補小缺口、去短段
      for (let s = 0; s < 2; s++) {
        const r = rail[s];
        let last = -1;
        for (let i = 0; i < N; i++) {
          if (r[i]) { if (last >= 0 && i - last > 1 && i - last <= 20) for (let j = last; j < i; j++) r[j] = 1; last = i; }
        }
        let i = 0;
        while (i < N) {
          if (r[i]) { let j = i; while (j < N && r[j]) j++; if (j - i < 8) for (let q = i; q < j; q++) r[q] = 0; i = j; } else i++;
        }
      }
      this.side = [new Uint8Array(N), new Uint8Array(N)];
      this.wall = [new Float32Array(N), new Float32Array(N)];
      for (let i = 0; i < N; i++) {
        const W = this.halfW[i];
        for (let s = 0; s < 2; s++) {
          let st = rail[s][i] ? 1 : 0;
          if (this.zone[i] && !rail[s][i]) st = 3;
          if (this.bridge[i]) st = 2;
          this.side[s][i] = st;
          this.wall[s][i] = W + (st === 1 ? 0.62 : st === 2 ? 0.5 : st === 3 ? 2.7 : 3.2);
        }
      }
    }

    _buildHash() {
      this.cs = 32;
      this.hash = new Map();
      for (let i = 0; i < this.N; i += 4) {
        const key = this._key(Math.floor(this.px[i] / this.cs), Math.floor(this.pz[i] / this.cs));
        let l = this.hash.get(key);
        if (!l) { l = []; this.hash.set(key, l); }
        l.push(i);
      }
      if ((this.N - 1) % 4) {
        const i = this.N - 1;
        const key = this._key(Math.floor(this.px[i] / this.cs), Math.floor(this.pz[i] / this.cs));
        let l = this.hash.get(key); if (!l) { l = []; this.hash.set(key, l); } l.push(i);
      }
    }
    _key(cx, cz) { return (cx + 30000) * 65536 + (cz + 30000); }

    // 粗網格標記：道路 ~100 m 內的格子 (遠離道路的地形直接跳過挖填計算)
    _buildMask() {
      const hm = this.hm, cs = (this.mcs = 32);
      this.mx0 = hm.x0; this.mz0 = hm.z0;
      this.mnx = Math.ceil((hm.x1 - hm.x0) / cs) + 1; this.mnz = Math.ceil((hm.z1 - hm.z0) / cs) + 1;
      this.mask = new Uint8Array(this.mnx * this.mnz);
      const rc = 3;
      for (let i = 0; i < this.N; i += 4) {
        const cx = Math.floor((this.px[i] - this.mx0) / cs), cz = Math.floor((this.pz[i] - this.mz0) / cs);
        for (let a = -rc; a <= rc; a++) for (let b = -rc; b <= rc; b++) {
          const x = cx + a, z = cz + b;
          if (x >= 0 && z >= 0 && x < this.mnx && z < this.mnz) this.mask[z * this.mnx + x] = 1;
        }
      }
    }
    nearRoad(x, z) {
      const cx = Math.floor((x - this.mx0) / this.mcs), cz = Math.floor((z - this.mz0) / this.mcs);
      if (cx < 0 || cz < 0 || cx >= this.mnx || cz >= this.mnz) return 0;
      return this.mask[cz * this.mnx + cx];
    }

    // 找出 (x,z) 附近所有路段分支 (髮夾彎上下兩段會分別回傳)
    nearestBranches(x, z, radius, maxBranches = 4) {
      const cs = this.cs, r = radius + 8, r2 = r * r;
      const cx0 = Math.floor((x - r) / cs), cx1 = Math.floor((x + r) / cs);
      const cz0 = Math.floor((z - r) / cs), cz1 = Math.floor((z + r) / cs);
      const cand = this._cand, cd = this._cd, px = this.px, pz = this.pz;
      let nc = 0;
      for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
        const l = this.hash.get(this._key(cx, cz));
        if (!l) continue;
        for (let q = 0; q < l.length; q++) {
          const idx = l[q];
          const dx = px[idx] - x, dz = pz[idx] - z;
          if (dx * dx + dz * dz <= r2 && nc < cand.length) cand[nc++] = idx;
        }
      }
      this.brN = 0;
      if (!nc) return 0;
      // insertion sort
      for (let a = 1; a < nc; a++) {
        const v = cand[a]; let b = a - 1;
        while (b >= 0 && cand[b] > v) { cand[b + 1] = cand[b]; b--; }
        cand[b + 1] = v;
      }
      for (let a = 0; a < nc; a++) { const dx = px[cand[a]] - x, dz = pz[cand[a]] - z; cd[a] = dx * dx + dz * dz; }
      let nb = 0;
      for (let a = 0; a < nc; a++) {
        const prevSame = a > 0 && cand[a] - cand[a - 1] <= 8;
        const nextSame = a < nc - 1 && cand[a + 1] - cand[a] <= 8;
        const isMin = (!prevSame || cd[a] <= cd[a - 1]) && (!nextSame || cd[a] < cd[a + 1]);
        if (!isMin) continue;
        // 細部搜尋
        let best = cand[a], bd = cd[a];
        for (let j = Math.max(0, cand[a] - 4); j <= Math.min(this.N - 1, cand[a] + 4); j++) {
          const dx = px[j] - x, dz = pz[j] - z, dd = dx * dx + dz * dz;
          if (dd < bd) { bd = dd; best = j; }
        }
        const pr = this._projectAt(x, z, best);
        if (Math.abs(pr.d) > radius) continue;
        let dup = false;
        for (let q = 0; q < nb; q++) if (Math.abs(this.brFi[q] - pr.fi) < 6) { dup = true; if (Math.abs(pr.d) < Math.abs(this.brD[q])) { this.brFi[q] = pr.fi; this.brD[q] = pr.d; } }
        if (dup) continue;
        if (nb < 8) { this.brFi[nb] = pr.fi; this.brD[nb] = pr.d; nb++; }
      }
      // 依 |d| 由小到大
      for (let a = 1; a < nb; a++) {
        const f = this.brFi[a], d = this.brD[a]; let b = a - 1;
        while (b >= 0 && Math.abs(this.brD[b]) > Math.abs(d)) { this.brFi[b + 1] = this.brFi[b]; this.brD[b + 1] = this.brD[b]; b--; }
        this.brFi[b + 1] = f; this.brD[b + 1] = d;
      }
      this.brN = Math.min(nb, maxBranches);
      return this.brN;
    }

    _projectAt(x, z, i, out) {
      const o = out || this._pr;
      const N = this.N, px = this.px, pz = this.pz;
      let along = (x - px[i]) * this.tx[i] + (z - pz[i]) * this.tz[i];
      if (along < 0 && i > 0) { i--; along = (x - px[i]) * this.tx[i] + (z - pz[i]) * this.tz[i]; }
      if (i >= N - 1) { i = N - 2; along = (x - px[i]) * this.tx[i] + (z - pz[i]) * this.tz[i]; }
      const t = clamp(along / this.sp, 0, 1);
      const cx = px[i] + (px[i + 1] - px[i]) * t, cz = pz[i] + (pz[i + 1] - pz[i]) * t;
      let rxi = this.rx[i] + (this.rx[i + 1] - this.rx[i]) * t, rzi = this.rz[i] + (this.rz[i + 1] - this.rz[i]) * t;
      const l = Math.hypot(rxi, rzi) || 1; rxi /= l; rzi /= l;
      o.i = i; o.t = t; o.fi = i + t;
      o.d = (x - cx) * rxi + (z - cz) * rzi;
      o.cy = this.py[i] + (this.py[i + 1] - this.py[i]) * t;
      return o;
    }

    // 以 hint 起爬山法投影 (物理/AI 用, 不會跳到髮夾彎另一段)
    project(x, z, hint, out, y) {
      const N = this.N, px = this.px, pz = this.pz;
      let i = clamp(hint | 0, 0, N - 1);
      let d0 = (px[i] - x) ** 2 + (pz[i] - z) ** 2;
      const stacked = this.data.spiral && Number.isFinite(y);
      if (d0 > 60 * 60 || (stacked && Math.abs(this.py[i] - y) > 9)) {
        const n = this.nearestBranches(x, z, 120, stacked ? this.brFi.length : 4);
        if (stacked) {
          // 只在提示位置失效時比較高程；連續行駛仍在目前的匝道上搜尋。
          let best = Infinity;
          for (let b = 0; b < n; b++) {
            const j = Math.round(this.brFi[b]);
            const score = (px[j] - x) ** 2 + (pz[j] - z) ** 2 + 4 * (this.py[j] - y) ** 2;
            if (score < best) { best = score; i = j; }
          }
        } else if (n > 0) i = Math.round(this.brFi[0]);
        d0 = (px[i] - x) ** 2 + (pz[i] - z) ** 2;
      }
      for (;;) {
        if (i < N - 1) { const d1 = (px[i + 1] - x) ** 2 + (pz[i + 1] - z) ** 2; if (d1 < d0) { i++; d0 = d1; continue; } }
        if (i > 0) { const d1 = (px[i - 1] - x) ** 2 + (pz[i - 1] - z) ** 2; if (d1 < d0) { i--; d0 = d1; continue; } }
        break;
      }
      return this._projectAt(x, z, i, out);
    }

    // 路面相對中心線的高度偏移 (路拱 2% / 超高)
    surfOff(i, t, d) {
      const b = this.bank[i] + (this.bank[i + 1] - this.bank[i]) * t;
      const wb = smoothstep(0.015, 0.035, Math.abs(b));
      return wb * b * d + (1 - wb) * (-0.02 * Math.abs(d));
    }
    surfSlope(i, t, d) {
      const b = this.bank[i] + (this.bank[i + 1] - this.bank[i]) * t;
      const wb = smoothstep(0.015, 0.035, Math.abs(b));
      return wb * b + (1 - wb) * (-0.02 * Math.sign(d));
    }
    hwAt(i, t) { return this.halfW[i] + (this.halfW[Math.min(i + 1, this.N - 1)] - this.halfW[i]) * t; }

    // 取樣：以公尺 s 取得中心點/切線/右向量
    frameAt(s, o) {
      const fi = clamp(s / this.sp, 0, this.N - 1.0001);
      const i = Math.floor(fi), t = fi - i;
      o.i = i; o.t = t;
      o.x = lerp(this.px[i], this.px[i + 1], t); o.y = lerp(this.py[i], this.py[i + 1], t); o.z = lerp(this.pz[i], this.pz[i + 1], t);
      o.tx = lerp(this.tx[i], this.tx[i + 1], t); o.tz = lerp(this.tz[i], this.tz[i + 1], t);
      const l = Math.hypot(o.tx, o.tz) || 1; o.tx /= l; o.tz /= l;
      o.rx = -o.tz; o.rz = o.tx;
      o.grade = lerp(this.grade[i], this.grade[i + 1], t);
      o.k = lerp(this.curv[i], this.curv[i + 1], t);
      o.W = this.hwAt(i, t);
      return o;
    }
    // 某 s、橫向 d 的路面點
    pointAt(s, d, o) {
      const f = this.frameAt(s, o);
      o.px = f.x + f.rx * d; o.pz = f.z + f.rz * d;
      o.py = f.y + this.surfOff(f.i, f.t, d);
      return o;
    }

    // 網格間距 margin 時，沿線 ±1.5 格內的最大路面扭曲度 (一個地形三角形會跨到這麼遠的路面)
    _warpFor(margin) {
      let a = this._warpWin.get(margin);
      if (!a) {
        const N = this.N, w = Math.ceil((1.5 * margin) / this.sp), src = this.warp;
        a = new Float32Array(N);
        for (let i = 0; i < N; i++) {
          let m = 0;
          for (let j = Math.max(0, i - w), e = Math.min(N - 1, i + w); j <= e; j++) if (src[j] > m) m = src[j];
          a[i] = m;
        }
        this._warpWin.set(margin, a);
      }
      return a;
    }

    // 挖填後的地形高度 (地形網格與物理共用)
    carved(x, z, margin, out) {
      const hm = this.hm;
      const nat = hm.natural(x, z);
      let h = nat, prox = 0;
      const n = this.nearRoad(x, z) ? this.nearestBranches(x, z, 70) : 0;
      // 內插誤差補償：扭曲度 × 間距² / 4，上限隨間距放寬 (6.25 m 網格最多 0.25 m；直線、緩坡處幾乎是 0)
      const wm = n ? this._warpFor(margin) : null;
      const exK = margin * margin * 0.25, exCap = 0.25 * Math.pow(margin / 6.25, 1.5);
      for (let b = n - 1; b >= 0; b--) {
        const fi = this.brFi[b], d = this.brD[b];
        const i = Math.min(Math.floor(fi), this.N - 2), t = fi - i;
        const ad = Math.abs(d);
        const W = this.hwAt(i, t);
        const cy = this.py[i] + (this.py[i + 1] - this.py[i]) * t;
        const sgn = d >= 0 ? 1 : -1;
        const hr = cy + this.surfOff(i, t, sgn * W);
        prox = Math.max(prox, 1 - smoothstep(0, 40, ad - W));
        const s = this.side[d >= 0 ? 1 : 0][i];
        if (this.bridge[i]) {
          if (ad < W + 10) h = Math.min(h, hr - 4.5 - (ad > W + 3 ? 0 : 0));
          continue;
        }
        const rising = h > hr;
        const inner = W + (s === 3 ? 2.6 : 0.85);
        const flatEnd = inner + (rising ? margin : 0.4);
        const ex = Math.min(wm[i] * exK, exCap);
        // 柏油範圍內：路基跟著路面的橫坡走 (路面下 0.35 m)。
        // 不能整片用邊緣高度 hr：超高 8% 的彎道，高側邊緣比中線高 0.7 m，靠中線處的地形會凸出路面 (草地穿模)
        if (ad < W) { h = cy + this.surfOff(i, t, d) - 0.35 - ex; continue; }
        if (ad < inner) { h = hr - 0.35 - ex; continue; }
        if (ad < flatEnd) { h = hr - 0.12 - ex; continue; }
        const base = hr - 0.12 - ex;
        const bw = rising ? clamp((h - base) * 0.8, 2, 30) : clamp((base - h) * 1.3, 2, 40);
        const tt = smoothstep(0, 1, (ad - flatEnd) / bw);
        h = base + (h - base) * tt;
      }
      if (out) { out.h = h; out.nat = nat; out.prox = prox; }
      return h;
    }

    // 物理：地面高度、法線、材質
    ground(x, z, hint, y) {
      const pr = this.project(x, z, hint.i, this._pr, y);
      hint.i = pr.i;
      const i = pr.i, t = pr.t, d = pr.d, ad = Math.abs(d);
      const g = this._g;
      const W = this.hwAt(i, t);
      const tx = this.tx[i], tz = this.tz[i], rx = this.rx[i], rz = this.rz[i];
      const grade = this.grade[i] + (this.grade[i + 1] - this.grade[i]) * t;
      g.d = d; g.fi = pr.fi; g.W = W;
      const sgn = d >= 0 ? 1 : -1;
      const s = this.side[d >= 0 ? 1 : 0][i];
      const e = ad - W;
      let slopeD;
      if (e <= 0) {
        g.y = pr.cy + this.surfOff(i, t, d);
        slopeD = this.surfSlope(i, t, d);
        g.surf = 0;
      } else if (e <= 0.8 || (s === 3 && e <= 2.6) || (s === 2 && e <= 1.0)) {
        const yEdge = pr.cy + this.surfOff(i, t, sgn * W);
        g.y = yEdge + sideProfile(s, e);
        slopeD = sgn * (sideProfile(s, e + 0.05) - sideProfile(s, e - 0.05)) / 0.1;
        g.surf = s === 1 ? 2 : 1;
      } else {
        const h0 = this.carved(x, z, 6.25);
        const hx = this.carved(x + 0.6, z, 6.25), hz = this.carved(x, z + 0.6, 6.25);
        g.y = h0;
        const nx = -(hx - h0) / 0.6, nz = -(hz - h0) / 0.6;
        const l = Math.hypot(nx, 1, nz);
        g.nx = nx / l; g.ny = 1 / l; g.nz = nz / l;
        g.surf = 3;
        if (this.hole) g.y -= this._pit(i, y, pr.cy, hint);
        return g;
      }
      if (this.hole) g.y -= this._pit(i, y, pr.cy, hint);
      // n = normalize(cross(r3, t3))
      const r3x = rx, r3y = slopeD, r3z = rz;
      const t3x = tx, t3y = grade, t3z = tz;
      let nx = r3y * t3z - r3z * t3y, ny = r3z * t3x - r3x * t3z, nz = r3x * t3y - r3y * t3x;
      const l = Math.hypot(nx, ny, nz) || 1;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      g.nx = nx / l; g.ny = ny / l; g.nz = nz / l;
      return g;
    }

    // 斷崖：缺口處的地面在下方 hole 公尺。兩岸的橋面是薄板：在缺口上方就已經掉到橋面高度以下的車 (沒飛過去)
    // 不會被對岸的橋面頂上來，而是從橋下掉進溪谷。hint.low 記住這件事，回到橋面上方 (重生) 或離開斷崖區才解除。
    // y = 車身重心的高度 (沒給就當作在橋面上)，cy = 該處中心線的高度
    _pit(i, y, cy, hint) {
      if (this.hole[i]) { if (y < cy + 0.2) hint.low = true; return this.hole[i]; }
      if (hint.low && (!this.under[i] || y > cy + 0.35)) hint.low = false;
      return hint.low ? this.under[i] : 0;
    }

    nameAt(s) {
      const i = s / this.sp;
      let n = this.names[0];
      for (const q of this.names) if (q[0] <= i) n = q;
      return n;
    }
    kmAt(s) { return s / 1000 + this.kmOffset; }

    // ------------------------------------------------ 路面網格 (每 chunk)
    buildChunkMesh(i0, i1) {
      const rows = i1 - i0 + 1;
      const strips = [
        { kind: 0, cols: 5 },  // 柏油 -W..W
        { kind: 1, cols: 5, sg: -1 }, // 左側
        { kind: 1, cols: 5, sg: 1 },  // 右側
      ];
      let nv = 0; for (const st of strips) nv += st.cols * rows;
      const pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), ext = new Float32Array(nv * 4), nrm = new Float32Array(nv * 3);
      const idx = [];
      let base = 0;
      for (const st of strips) {
        for (let r = 0; r < rows; r++) {
          const i = i0 + r;
          const ii = Math.min(i, this.N - 2);
          const tt = i >= this.N - 1 ? 1 : 0;
          const W = this.halfW[i];
          const cx = this.px[i], cy = this.py[i], cz = this.pz[i], rx = this.rx[i], rz = this.rz[i];
          const s = i * this.sp;
          for (let c = 0; c < st.cols; c++) {
            let d, y, sideT = 0;
            if (st.kind === 0) {
              d = -W + (2 * W * c) / (st.cols - 1);
              y = cy + this.surfOff(ii, tt, d);
            } else {
              const sg = st.sg;
              // 左側：由外往內 (d 遞增)；右側：由內往外
              const k = sg < 0 ? st.cols - 1 - c : c;
              const e = SIDE_E[k];
              d = sg * (W + e);
              sideT = this.side[sg < 0 ? 0 : 1][i];
              y = cy + this.surfOff(ii, tt, sg * W) + SIDE_Y[sideT][k];
            }
            const v = base + r * st.cols + c;
            pos[v * 3] = cx + rx * d; pos[v * 3 + 1] = y; pos[v * 3 + 2] = cz + rz * d;
            uv[v * 2] = d; uv[v * 2 + 1] = s;
            ext[v * 4] = W; ext[v * 4 + 1] = this.data.closedCourse ? -1 : this.zone[i]; ext[v * 4 + 2] = st.kind; ext[v * 4 + 3] = sideT;
          }
        }
        // 法線
        for (let r = 0; r < rows; r++) for (let c = 0; c < st.cols; c++) {
          const v = base + r * st.cols + c;
          const c0 = base + r * st.cols + Math.max(c - 1, 0), c1 = base + r * st.cols + Math.min(c + 1, st.cols - 1);
          const r0 = base + Math.max(r - 1, 0) * st.cols + c, r1 = base + Math.min(r + 1, rows - 1) * st.cols + c;
          const ax = pos[c1 * 3] - pos[c0 * 3], ay = pos[c1 * 3 + 1] - pos[c0 * 3 + 1], az = pos[c1 * 3 + 2] - pos[c0 * 3 + 2];
          const bx = pos[r1 * 3] - pos[r0 * 3], by = pos[r1 * 3 + 1] - pos[r0 * 3 + 1], bz = pos[r1 * 3 + 2] - pos[r0 * 3 + 2];
          let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
          const l = Math.hypot(nx, ny, nz) || 1;
          if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
          nrm[v * 3] = nx / l; nrm[v * 3 + 1] = ny / l; nrm[v * 3 + 2] = nz / l;
        }
        for (let r = 0; r < rows - 1; r++) for (let c = 0; c < st.cols - 1; c++) {
          if (this.hole && this.hole[i0 + r]) continue;   // 斷崖的缺口不鋪路面
          const a = base + r * st.cols + c, b = a + 1, cc = a + st.cols, d = cc + 1;
          idx.push(a, b, d, a, d, cc);
        }
        base += st.cols * rows;
      }
      return RM.GLU.mesh({ aPos: pos, aNormal: nrm, aUV: uv, aExtra: ext }, new Uint16Array(idx));
    }
  }

  Road.sideProfile = sideProfile;
  Road.traceLayout = traceLayout;
  RM.Road = Road;
})();
