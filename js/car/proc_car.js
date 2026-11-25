'use strict';
// 程序化車款工具組 (喜美 K8、GR86 … 共用)
//
// 每台車由三部分組成：
//   1. 車殼：解析式隱式曲面 sdBody(x,y,z) (< 0 為車內)，以「圓角盒」射線取樣成平滑四邊形網格。
//   2. 貼圖：鈑件縫、車燈、車窗、飾條等細節畫成貼圖，在車殼著色器以「環繞帶 / 俯視」兩個投影貼上。
//            環繞帶 u = 由車尾中心沿水平輪廓繞過車角 → 車側 → 繞過車頭角 → 車頭中心 的弧長，v = 高度。
//   3. 零件：輪拱內襯、底盤、後照鏡、車牌 / 標誌貼片、內裝、輪圈、方向盤。
// 車身座標：-z = 車頭，x = 右，y = 離地高度 (公尺)。
(function () {
  const RM = window.RM;
  const { mat, MeshBuilder } = RM;
  const V = RM.v3;

  // ------------------------------------------------------------------ 數學工具
  const c01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
  const sq = (v) => v * v;
  const sstep = (a, b, x) => { const t = c01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  // p-norm：兩個正規化約束的平滑聯集邊界 (n 越大角越銳)
  const pn = (a, b, n) => {
    if (a < 0) a = 0; if (b < 0) b = 0;
    if (b < 1e-5) return a;
    if (a < 1e-5) return b;
    return Math.pow(Math.pow(a, n) + Math.pow(b, n), 1 / n);
  };
  // 4-norm 圓角聯集：da、db 為超出各面的距離 (公尺，內部為負)，R 為近似圓角半徑
  const pn4 = (a, b) => {
    if (a <= 0) return b > 0 ? b : 0;
    if (b <= 0) return a;
    const a2 = a * a, b2 = b * b;
    return Math.sqrt(Math.sqrt(a2 * a2 + b2 * b2));
  };
  const rmax = (da, db, R) => { const L = R / 0.54; return (pn4(1 + da / L, 1 + db / L) - 1) * L; };
  const smin = (a, b, k) => { const h = c01(0.5 + (0.5 * (b - a)) / k); return b + (a - b) * h - k * h * (1 - h); };
  const softPos = (d) => 0.5 * (d + Math.sqrt(d * d + 0.0004));
  // 單調三次 Hermite 曲線 (Fritsch–Carlson)，兩端夾住
  function spline(P) {
    const n = P.length, xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
    const d = [], m = new Array(n);
    for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    return (x) => {
      if (x <= xs[0]) return ys[0];
      if (x >= xs[n - 1]) return ys[n - 1];
      let i = 0;
      while (x > xs[i + 1]) i++;
      const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
    };
  }
  const lin = (a, b, n) => { const o = []; for (let i = 0; i <= n; i++) o.push(a + ((b - a) * i) / n); return o; };
  // 輪拱外擴：車側在輪拱開口周圍向外鼓出的量 (公尺)，加在車款的側面半寬 Ws(y, z) 上。
  //   lip = 緊貼開口邊緣的捲邊 (窄而明顯)，bl = 整片葉子板的鼓出 (寬體 / blister，範圍大)
  //   M：貼圖投影座標 (輪拱位置)；o：{ lipF, lipR 捲邊高度, lipW 寬度, blF, blR 鼓出高度, blW 範圍 }
  function archFlare(M, o) {
    const lipW = o.lipW || 0.05, blW = o.blW || 0.22;
    return (y, z) => {
      let s = 0;
      for (let k = 0; k < 2; k++) {
        const dz = z - (k ? M.AXR : M.AXF), R = k ? M.ARR : M.ARF;
        if (dz > R + 0.8 || dz < -R - 0.8) continue;
        const dy = Math.max(y - (k ? M.AYR : M.AYF), 0);
        const e = Math.max(Math.hypot(dz, dy) - R, 0);      // 到開口邊緣的距離 (開口內為 0)
        s += ((k ? o.lipR : o.lipF) || 0) * Math.exp(-sq(e / lipW)) + ((k ? o.blR : o.blF) || 0) * Math.exp(-sq(e / blW));
      }
      return s;
    };
  }

  const MAT = {
    shell: mat('#ffffff', 0.36, 0.45, 3),
    paint: mat('#ffffff', 0.36, 0.45, 3),
    black: mat('#141414', 0.55),
    trim: mat('#1d1d1f', 0.45, 0.1),
    chrome: mat('#d8dadc', 0.12, 1),
    rubber: mat('#151515', 0.92),
    rim: mat('#c4c8cc', 0.28, 0.9),
    rimDark: mat('#3a3d40', 0.5, 0.6),
    rimBlack: mat('#18191b', 0.34, 0.75),
    rimBlack2: mat('#0c0c0d', 0.5, 0.6),
    disc: mat('#55565a', 0.36, 0.9),
    discLip: mat('#2c2a28', 0.6, 0.6),
    tire: mat('#0e0e0e', 0.9),
    tireWall: mat('#161617', 0.55),      // 胎壁字樣環帶 / 護緣：比胎面亮一點的橡膠
    caliper: mat('#3c3c3c', 0.6, 0.3),
    caliperRed: mat('#a01216', 0.4, 0.2),
    fabric: mat('#17181c', 0.95),
    dash: mat('#0e0e10', 0.8),
    head: mat('#ffffff', 0.05, 1, 5),
    bulb: mat('#ffffff', 0.1, 0, 13),
    reflector: mat('#e8eaec', 0.22, 0.6, 0),
    chromeTex: mat('#ffffff', 0.15, 0.9, 2),
    blinkL: mat('#ffffff', 0.1, 0, 7),
    blinkR: mat('#ffffff', 0.1, 0, 8),
    atlas: mat('#ffffff', 0.5, 0, 1),
    plate: mat('#ffffff', 0.45, 0, 1, 0.16, 1),
    under: mat('#0b0b0c', 0.95),
    liner: mat('#101011', 0.9),
    muffler: mat('#3c3a37', 0.55, 0.7),
    mirror: mat('#5a6268', 0.06, 1),
    groove: mat('#050505', 0.98),
    discHat: mat('#2b2b2d', 0.6, 0.5),
    nut: mat('#aeb2b6', 0.25, 1),
    calLogo: mat('#e9e9e6', 0.5),
    pad: mat('#0c0c0c', 0.9),
    // 改裝 (js/car/tuning_vis.js)
    letter: mat('#f2f2f2', 0.6, 0),          // 胎壁白字、輪圈肋上的字樣
    tireSemi: mat('#262626', 0.95),         // 半熱熔胎：磨過的灰黑胎面
    bolt: mat('#dadde0', 0.2, 1),           // 多片式輪圈的固定螺絲
    boltGold: mat('#c8a24a', 0.25, 1),
    polish: mat('#e8eaec', 0.06, 1),        // 鏡面拋光外唇
    machined: mat('#d9dcdf', 0.1, 1),       // 鑽石切削輪緣
    bobbin: mat('#c9ccd0', 0.25, 1),        // 浮動碟的浮動銷
  };

  // ------------------------------------------------------------------ 表面探測
  function surface(sdBody) {
    const normalAt = (p) => {
      const h = 5e-4, x = Math.abs(p[0]);
      const f0 = sdBody(x, p[1], p[2]);
      const n = [sdBody(x + h, p[1], p[2]) - f0, sdBody(x, p[1] + h, p[2]) - f0, sdBody(x, p[1], p[2] + h) - f0];
      if (x < 1e-6) n[0] = 0;
      V.norm(n, n);
      if (p[0] < 0) n[0] = -n[0];
      return n;
    };
    // 由車外沿射線找表面
    const rayIn = (o, d, maxT) => {
      const step = 0.012;
      for (let t = step; t <= maxT; t += step) {
        if (sdBody(o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t) < 0) {
          let a = t - step, b = t;
          for (let k = 0; k < 16; k++) {
            const m = (a + b) / 2;
            if (sdBody(o[0] + d[0] * m, o[1] + d[1] * m, o[2] + d[2] * m) < 0) b = m; else a = m;
          }
          return [o[0] + d[0] * a, o[1] + d[1] * a, o[2] + d[2] * a];
        }
      }
      return null;
    };
    return {
      sdBody, normalAt, rayIn,
      rearP: (x, y) => rayIn([x, y, 2.5], [0, 0, -1], 1.2),
      frontP: (x, y) => rayIn([x, y, -2.5], [0, 0, 1], 1.2),
      sideP: (sx) => (z, y) => rayIn([sx * 1.2, y, z], [-sx, 0, 0], 0.9),
      topP: (x, z) => rayIn([x, 1.6, z], [0, -1, 0], 1.3),
    };
  }

  // ------------------------------------------------------------------ 車殼網格
  // 外盒上的格點 q → 內骨架盒上最近點 o，沿 o→q 射線與車身的交點。
  // 面內為平行射線 (規則網格)，邊角為扇形射線 (自然環繞)，相鄰面共用邊線所以沒有縫。
  // B：{ XO, YB, YT, ZO } 外盒、{ WI, YI0, YI1, ZI } 內骨架盒 (必須完全在車身內)
  function buildShell(S, B) {
    const sdBody = S.sdBody, { XO, YB, YT, ZO, WI, YI0, YI1, ZI } = B;
    // B.rearRays / B.frontRays (可省) { WR, YR, YL }：車尾 / 車頭面 |x| ≤ WR、YL ≤ y ≤ YR 的射線改成「水平往正後 / 正前方」
    // (起點與目標同 x、同 y) —— 預設起點在內骨架盒 (偏低、偏內)，射線斜斜地打出去，凹槽 (尾燈碗、進氣口) 靠邊的槽底
    // 會被槽壁擋住取樣不到，槽口就成了鋸齒。超出範圍的部分線性過渡回預設起點，在該面的頂邊、底邊、側邊
    // (與車頂面 / 車側面共用的接縫) 剛好等於預設，接縫不會裂開。起點 (±WR, YL ~ YR, ±ZI) 必須都還在車身裡面
    const straight = (R, q, w, xy) => {
      const ax = Math.abs(q[0]), YL = R.YL === undefined ? YI0 : R.YL;
      const oxR = ax <= R.WR ? ax : R.WR + ((WI - R.WR) * (ax - R.WR)) / (XO - R.WR);
      const oyR = q[1] > R.YR ? R.YR + ((YI1 - R.YR) * (q[1] - R.YR)) / (YT - R.YR)
        : q[1] >= YL ? q[1] : YL + ((YI0 - YL) * (YL - q[1])) / (YL - YB);
      xy[0] += ((q[0] < 0 ? -oxR : oxR) - xy[0]) * w;
      xy[1] += (oyR - xy[1]) * w;
    };
    const shellPoint = (q) => {
      const xy = [q[0] > WI ? WI : q[0] < -WI ? -WI : q[0], q[1] > YI1 ? YI1 : q[1] < YI0 ? YI0 : q[1]];
      const oz = q[2] > ZI ? ZI : q[2] < -ZI ? -ZI : q[2];
      if (B.rearRays && q[2] > ZI) straight(B.rearRays, q, Math.min(1, (q[2] - ZI) / (ZO - ZI)), xy);
      if (B.frontRays && q[2] < -ZI) straight(B.frontRays, q, Math.min(1, (-ZI - q[2]) / (ZO - ZI)), xy);
      const ox = xy[0], oy = xy[1];
      const dx = q[0] - ox, dy = q[1] - oy, dz = q[2] - oz;
      const f = (t) => sdBody(ox + dx * t, oy + dy * t, oz + dz * t);
      let a = 0, fa = f(0), b = 0, fb = fa;
      if (fa > 0) return [ox, oy, oz];
      // 由內往外保守步進 (步長 = |f| / 2.5，最少 2.5 mm)，找「第一個」穿出車身的位置 ——
      // 車身有凹槽 (尾燈碗、車牌凹槽) 時，斜射線會穿出碗底、越過碗內的空氣、再穿進碗壁：
      // 直接拿兩端點做割線法會隨機收斂到其中一個交點，凹槽邊緣就成了鋸齒
      const len = Math.hypot(dx, dy, dz) || 1;
      for (let k = 0; k < 240; k++) {
        b = a + Math.max(-fa / (2.5 * len), 0.0025 / len);
        fb = f(b);
        if (fb >= 0 || b > 9) break;
        a = b; fa = fb;
      }
      if (fb < 0) return [ox + dx * a, oy + dy * a, oz + dz * a];
      // Illinois 割線法
      let side = 0, t = b;
      for (let k = 0; k < 40; k++) {
        t = (a * fb - b * fa) / (fb - fa);
        const ft = f(t);
        if (Math.abs(ft) < 2e-6 || b - a < 2e-6) break;
        if (ft < 0) { a = t; fa = ft; if (side === -1) fb *= 0.5; side = -1; }
        else { b = t; fb = ft; if (side === 1) fa *= 0.5; side = 1; }
      }
      return [ox + dx * t, oy + dy * t, oz + dz * t];
    };
    const mb = new MeshBuilder();
    const Xs = [], Ys = [], Zs = [];
    for (let i = 0; i <= 36; i++) Xs.push((XO * i) / 36);
    for (let y = YB; y < YT - 1e-6; y += 0.02) Ys.push(y);
    Ys.push(YT);
    for (let z = -ZO; z < ZO - 1e-6; z += z < -1.0 ? 0.03 : z < 1.0 ? 0.03 : 0.02) Zs.push(z);
    Zs.push(ZO);
    // B.refine (可省)：局部加密 { x / y：車尾面, xf / yf：車頭面, z：車側與車頂面 ([[起, 迄, 間距]…])，
    //   xAt / yAt / xfAt / yfAt / zAt：一定要取樣的位置 (凹槽邊緣)，sideY：車側面也用車尾面的 y (預設用粗格) }。
    // 預設 2～3 cm 的格子做不出幾公分深的凹槽 (尾燈碗、車牌凹槽、進氣口)：槽壁會被拉成一大片斜面、邊緣鋸齒。
    // 在那一段加密、再把凹槽邊緣的位置直接放進取樣點，壁就是俐落的一圈。只加密需要的面，三角形才不會暴增。
    // 相鄰兩面的接縫若取樣點不同，取樣多的那一面多出來的點直接放在另一面的邊上 (snap)，接縫不會裂開。
    const refine = (L, R, at) => {
      const add = [];
      for (const [a, b, s] of R || []) for (let v = a; v <= b + 1e-9; v += s) add.push(v);
      for (const v of at || []) add.push(v);
      // 粗格的點一定要保留 (接縫靠它對齊)：新加的點離粗格點太近、或超出範圍就不要
      const lo = L[0], hi = L[L.length - 1];
      const all = L.concat(add.filter((v) => v > lo && v < hi && L.every((c) => Math.abs(c - v) > 0.0015))).sort((p, q) => p - q);
      const r = [];
      for (const v of all) { if (r.length && v - r[r.length - 1] <= 0.0015 && !L.includes(v)) continue; r.push(v); }
      return r;
    };
    const RF = B.refine || {}, rf = (L, R, at) => (R || at ? refine(L, R, at) : L);
    const XsR = rf(Xs, RF.x, RF.xAt), YsR = rf(Ys, RF.y, RF.yAt), XsF = rf(Xs, RF.xf, RF.xfAt), YsF = rf(Ys, RF.yf, RF.yfAt), ZsR = rf(Zs, RF.z, RF.zAt);
    const YsS = RF.sideY ? YsR : Ys;                       // 車側面的 y
    // [A 取樣, B 取樣, 外盒上的點, 接縫：{ rowLast / colFirst / colLast: 相鄰那一面在這條邊上的取樣點 }]
    //   車尾 / 車頭的頂邊接車頂面 (粗格 x)、側邊接車側面；車側的前後緣接車頭 / 車尾面
    const faces = [
      [XsR, YsR, (x, y) => [x, y, ZO], { rowLast: Xs, colLast: YsS }],      // 車尾
      [XsF, YsF, (x, y) => [x, y, -ZO], { rowLast: Xs, colLast: YsS }],     // 車頭
      [ZsR, YsS, (z, y) => [XO, y, z], { colFirst: YsF, colLast: YsR }],     // 右側 (左側鏡射)
      [Xs, ZsR, (x, z) => [x, YT, z]],                                       // 頂
    ];
    const grids = [];
    // 接縫上多出來的點：放在前後兩個粗格點連成的線段上 (只在這一面的取樣比相鄰那一面多時才需要)
    const snapLine = (pts, vals, coarse) => {
      if (coarse.length >= vals.length) return;
      const keep = vals.map((v) => coarse.includes(v));
      for (let k = 0; k < vals.length; k++) {
        if (keep[k]) continue;
        let a = k - 1, b = k + 1;
        while (a > 0 && !keep[a]) a--;
        while (b < vals.length - 1 && !keep[b]) b++;
        const t = (vals[k] - vals[a]) / (vals[b] - vals[a]), P = pts[a][0], Qp = pts[b][0], Na = pts[a][1], Nb = pts[b][1];
        pts[k] = [[P[0] + (Qp[0] - P[0]) * t, P[1] + (Qp[1] - P[1]) * t, P[2] + (Qp[2] - P[2]) * t],
          V.norm([0, 0, 0], [Na[0] + (Nb[0] - Na[0]) * t, Na[1] + (Nb[1] - Na[1]) * t, Na[2] + (Nb[2] - Na[2]) * t])];
      }
    };
    for (const [A, Bv, Q, snap] of faces) {
      const G = A.map((a) => Bv.map((b) => { const p = shellPoint(Q(a, b)); return [p, S.normalAt(p)]; }));
      if (snap && snap.rowLast) {
        const row = G.map((col) => col[Bv.length - 1]);
        snapLine(row, A, snap.rowLast);
        row.forEach((v, i) => { G[i][Bv.length - 1] = v; });
      }
      if (snap && snap.colFirst) snapLine(G[0], Bv, snap.colFirst);
      if (snap && snap.colLast) snapLine(G[A.length - 1], Bv, snap.colLast);
      const nb = Bv.length;
      for (const sx of [1, -1]) {
        const base = mb.vcount;
        grids.push({ base, na: A.length, nb });
        for (let i = 0; i < A.length; i++) for (let j = 0; j < nb; j++) {
          const p = G[i][j][0], n = G[i][j][1];
          mb.v(sx * p[0], p[1], p[2], sx * n[0], n[1], n[2], 0, 0, MAT.shell);
        }
        for (let i = 0; i < A.length - 1; i++) for (let j = 0; j < nb - 1; j++) {
          const pa = G[i][j][0], pb = G[i + 1][j][0], pd = G[i][j + 1][0], n = G[i][j][1];
          const ux = pb[0] - pa[0], uy = pb[1] - pa[1], uz = pb[2] - pa[2];
          const vx = pd[0] - pa[0], vy = pd[1] - pa[1], vz = pd[2] - pa[2];
          const dot = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
          const a = base + i * nb + j, b = a + nb, c = b + 1, d = a + 1;
          if ((dot > 0) === (sx > 0)) mb.i.push(a, b, c, a, c, d); else mb.i.push(a, c, b, a, d, c);
        }
      }
    }
    const build0 = mb.build.bind(mb);
    mb.build = () => {
      const m = build0();
      if (m) m.cpu = { p: new Float32Array(mb.p), n: new Float32Array(mb.n), i: Uint32Array.from(mb.i), grids };
      return m;
    };
    return mb;
  }

  // ------------------------------------------------------------------ 貼合曲面的小零件
  // 貼在曲面上的網格片 (車牌 / 標誌 / 燈殼)；us、vs 為 chart 參數，uv 由左上到右下
  function patch(mb, S, chart, us, vs, off, M, uv) {
    const G = us.map((u) => vs.map((v) => {
      const p = chart(u, v);
      if (!p) return null;
      const n = S.normalAt(p);
      return { p: [p[0] + n[0] * off, p[1] + n[1] * off, p[2] + n[2] * off], n };
    }));
    const idx = G.map((col, i) => col.map((q, j) => {
      if (!q) return -1;
      const uu = i / (us.length - 1), vv = j / (vs.length - 1);
      const t = uv ? [uv[0] + (uv[2] - uv[0]) * uu, uv[1] + (uv[3] - uv[1]) * vv] : [0, 0];
      return mb.v(q.p[0], q.p[1], q.p[2], q.n[0], q.n[1], q.n[2], t[0], t[1], M);
    }));
    for (let i = 0; i < us.length - 1; i++) for (let j = 0; j < vs.length - 1; j++) {
      const a = idx[i][j], b = idx[i + 1][j], c = idx[i + 1][j + 1], d = idx[i][j + 1];
      if (a < 0 || b < 0 || c < 0 || d < 0) continue;
      const pa = G[i][j].p, pb = G[i + 1][j].p, pd = G[i][j + 1].p, n = G[i][j].n;
      const e1 = V.sub([0, 0, 0], pb, pa), e2 = V.sub([0, 0, 0], pd, pa);
      if (V.dot(V.cross([0, 0, 0], e1, e2), n) > 0) mb.i.push(a, b, c, a, c, d); else mb.i.push(a, c, b, a, d, c);
    }
  }
  // 沿曲線的帶狀網格 (輪拱唇)
  function band(mb, pts, l0, l1, off, M, tilt0, tilt1) {
    let prev = null;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(i - 1, 0)].p, b = pts[Math.min(i + 1, pts.length - 1)].p;
      const t = V.norm([0, 0, 0], V.sub([0, 0, 0], b, a));
      const n = pts[i].n, p = pts[i].p;
      const sv = V.norm([0, 0, 0], V.cross([0, 0, 0], n, t));
      const q0 = [p[0] + sv[0] * l0 + n[0] * off, p[1] + sv[1] * l0 + n[1] * off, p[2] + sv[2] * l0 + n[2] * off];
      const q1 = [p[0] + sv[0] * l1 + n[0] * off, p[1] + sv[1] * l1 + n[1] * off, p[2] + sv[2] * l1 + n[2] * off];
      const n0 = V.norm([0, 0, 0], [n[0] + sv[0] * tilt0, n[1] + sv[1] * tilt0, n[2] + sv[2] * tilt0]);
      const n1 = V.norm([0, 0, 0], [n[0] + sv[0] * tilt1, n[1] + sv[1] * tilt1, n[2] + sv[2] * tilt1]);
      const i0 = mb.v(q0[0], q0[1], q0[2], n0[0], n0[1], n0[2], 0, 0, M);
      const i1 = mb.v(q1[0], q1[1], q1[2], n1[0], n1[1], n1[2], 0, 0, M);
      if (prev) {
        const e1 = V.sub([0, 0, 0], q1, q0), e2 = V.sub([0, 0, 0], pts[i - 1].p, p);
        if (V.dot(V.cross([0, 0, 0], e1, e2), n) < 0) mb.i.push(prev[0], i0, i1, prev[0], i1, prev[1]); else mb.i.push(prev[0], i1, i0, prev[0], prev[1], i1);
      }
      prev = [i0, i1];
    }
  }
  // 橢球 (後照鏡殼)
  function ellipsoid(mb, c, r, M, seg = 12, rings = 8) {
    const base = mb.vcount;
    for (let i = 0; i <= rings; i++) {
      const th = (i / rings) * Math.PI, st = Math.sin(th), ct = Math.cos(th);
      for (let k = 0; k <= seg; k++) {
        const ph = (k / seg) * Math.PI * 2, nx = st * Math.cos(ph), ny = ct, nz = st * Math.sin(ph);
        const n = V.norm([0, 0, 0], [nx / r[0], ny / r[1], nz / r[2]]);
        mb.v(c[0] + nx * r[0], c[1] + ny * r[1], c[2] + nz * r[2], n[0], n[1], n[2], 0, 0, M);
      }
    }
    for (let i = 0; i < rings; i++) for (let k = 0; k < seg; k++) {
      const a = base + i * (seg + 1) + k, b = a + seg + 1;
      mb.i.push(a, a + 1, b + 1, a, b + 1, b);
    }
  }

  // 貼合曲面的圓片 (圓形頭燈 / 飾環)：沿 dir 方向往車身投影，c = 圓心附近的車外一點
  // r0 > 0 時為圓環 (剖面微凸的飾環)；dome > 0 時法線由中心向外傾，反光像凸透鏡。
  function roundPatch(mb, S, c, dir, r, off, M, seg = 20, r0 = 0, dome = 0) {
    const d = V.norm([0, 0, 0], dir);
    const e1 = V.norm([0, 0, 0], V.cross([0, 0, 0], Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], d));
    const e2 = V.cross([0, 0, 0], d, e1);
    // tilt：法線沿徑向外傾的量；lift：額外浮起的高度
    const hit = (ca, sa, rr, tilt, lift) => {
      const a = ca * rr, b = sa * rr;
      const o = [c[0] + e1[0] * a + e2[0] * b - d[0] * 0.4, c[1] + e1[1] * a + e2[1] * b - d[1] * 0.4, c[2] + e1[2] * a + e2[2] * b - d[2] * 0.4];
      const p = S.rayIn(o, d, 1.2);
      if (!p) return null;
      const n = S.normalAt(p), f = off + lift;
      const q = [p[0] + n[0] * f, p[1] + n[1] * f, p[2] + n[2] * f];
      if (!tilt) return [q, n];
      const rx = e1[0] * ca + e2[0] * sa, ry = e1[1] * ca + e2[1] * sa, rz = e1[2] * ca + e2[2] * sa;
      return [q, V.norm([0, 0, 0], [n[0] + rx * tilt, n[1] + ry * tilt, n[2] + rz * tilt])];
    };
    const rings = r0 > 0 ? [[r0, -0.9, 0], [(r0 + r) / 2, 0, (r - r0) * 0.35], [r, 0.9, 0]]
      : [[0, 0, 0], [r * 0.4, dome * 0.4, 0], [r * 0.75, dome * 0.75, 0], [r, dome, 0]];
    let prev = null;
    for (const [rr, tilt, lift] of rings) {
      const cur = [];
      for (let k = 0; k <= seg; k++) {
        const a = (k / seg) * Math.PI * 2, h = hit(Math.cos(a), Math.sin(a), rr, tilt, lift);
        cur.push(h ? { i: mb.v(h[0][0], h[0][1], h[0][2], h[1][0], h[1][1], h[1][2], 0, 0, M), p: h[0], n: h[1] } : null);
      }
      if (prev) for (let k = 0; k < seg; k++) {
        const a = prev[k], b = prev[k + 1], c2 = cur[k + 1], e = cur[k];
        if (!a || !b || !c2 || !e) continue;
        const nn = V.cross([0, 0, 0], V.sub([0, 0, 0], e.p, a.p), V.sub([0, 0, 0], c2.p, a.p));
        if (V.dot(nn, e.n) > 0) mb.i.push(a.i, e.i, c2.i, a.i, c2.i, b.i); else mb.i.push(a.i, c2.i, e.i, a.i, b.i, c2.i);
      }
      prev = cur;
    }
  }
  // 尾翼：翼片 (翼型斷面沿 x 擠出) + 兩支腳架。o：{ y, z, span, chord, thick, tilt, stands: [x…], standH, M }
  function wing(mb, o) {
    const M = o.M || MAT.paint, hs = o.span / 2, c = o.chord, t = o.thick || 0.03, tilt = o.tilt || 0;
    const prof = [];
    for (let k = 0; k <= 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      // 前緣圓、後緣尖的翼型 (z 向後)
      const pz = (0.5 - 0.5 * Math.cos(a)) * c - c / 2, py = Math.sin(a) * t * 0.5 * (1 - 0.55 * (0.5 - 0.5 * Math.cos(a)));
      prof.push([pz * Math.cos(tilt) + py * Math.sin(tilt), py * Math.cos(tilt) - pz * Math.sin(tilt)]);
    }
    const base = mb.vcount, np = prof.length, xs = [-hs, -hs * 0.5, 0, hs * 0.5, hs];
    for (const x of xs) for (let j = 0; j < np; j++) {
      const a = prof[(j + np - 1) % np], b = prof[(j + 1) % np];
      let ez = b[0] - a[0], ey = b[1] - a[1]; const el = Math.hypot(ez, ey) || 1; ez /= el; ey /= el;
      mb.v(x, o.y + prof[j][1], o.z + prof[j][0], 0, ez, -ey, 0, 0, M);
    }
    for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < np - 1; j++) {
      const a = base + i * np + j, b = a + 1, c2 = a + np, d = c2 + 1;
      mb.i.push(a, b, d, a, d, c2);
    }
    // 端板
    for (const x of [-hs, hs]) mb.box(x, o.y + (o.endDrop || 0) * -0.5, o.z, 0.012, t * 1.6 + (o.endDrop || 0), c * 1.02, 0, o.endM || M);
    // 腳架
    for (const x of o.stands || []) mb.box(x, o.y - o.standH / 2, o.z + (o.standZ || 0), 0.03, o.standH, c * 0.55, 0, M);
  }

  // ------------------------------------------------------------------ 共用零件
  // 輪拱內襯 (黑：半圓筒 + 前後壁 + 內壁)
  // ybS (可省)：車款的底盤高度曲線。有給的話前後壁的下緣跟著車底走 ——
  // 否則固定做到離地 0.14 m，底盤較高的車從側面會看到輪子前後各垂下一片像擋泥板的東西
  function wheelArches(body, S, M, xo, ybS) {
    const yb = (z) => (ybS ? Math.max(0.14, ybS(z) + 0.012) : 0.14);
    for (const sx of [-1, 1]) for (const [ax, R, cy] of [[M.AXF, M.ARF, M.AYF], [M.AXR, M.ARR, M.AYR]]) {
      const Rl = R + 0.012, x1 = sx * xo, x0 = sx * M.ARCH_IN, seg = 14;
      const P = (a, x) => [x, cy + Math.sin(a) * Rl, ax - Math.cos(a) * Rl];
      for (let k = 0; k < seg; k++) {
        const a0 = Math.PI * (k / seg), a1 = Math.PI * ((k + 1) / seg);
        body.quad(P(a0, x1), P(a1, x1), P(a1, x0), P(a0, x0), MAT.liner);
      }
      for (const dz of [-Rl, Rl]) { const y0 = yb(ax + dz); body.quad([x1, y0, ax + dz], [x1, cy, ax + dz], [x0, cy, ax + dz], [x0, y0, ax + dz], MAT.liner); }
      body.quad([x0, yb(ax - Rl), ax - Rl], [x0, yb(ax + Rl), ax + Rl], [x0, cy + Rl, ax + Rl], [x0, cy + Rl, ax - Rl], MAT.liner);
    }
  }
  // 底盤封板 (寬度不超出車身下緣)
  function underbody(body, S, M, ybS, z0, z1) {
    const zs = lin(z0, z1, 28);
    const wAt = (z, y) => { const p = S.sideP(1)(z, y + 0.03); return p ? Math.max(p[0] - 0.035, 0.1) : 0.1; };
    for (let k = 0; k < zs.length - 1; k++) {
      const za = zs[k], zb = zs[k + 1], ya = ybS(za) + 0.018, yb = ybS(zb) + 0.018, zc = (za + zb) / 2;
      const arch = Math.abs(zc - M.AXF) < M.ARF + 0.08 || Math.abs(zc - M.AXR) < M.ARR + 0.08;
      const wa = arch ? M.ARCH_IN : Math.min(wAt(za, ya), 0.8), wb = arch ? M.ARCH_IN : Math.min(wAt(zb, yb), 0.8);
      body.quad([-wa, ya, za], [wa, ya, za], [wb, yb, zb], [-wb, yb, zb], MAT.under);
    }
  }

  // ------------------------------------------------------------------ 輪胎 / 鋁圈 / 煞車
  // 旋轉體 (軸 = x)：prof = [[x, r, M?]…]，法線取輪廓走向的左側 (-dr, dx) ——
  // 由車內側走到車外側的面朝外圈、由外圈往軸心走的面朝 +x (車外)、由車外側往車內側走的面朝軸心。
  // 三角形繞向與法線一致 (著色器會把背面的法線翻過來，繞向錯了受光就是反的)。
  function revolve(w, prof, M, seg) {
    const base = w.vcount, np = prof.length;
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      for (let j = 0; j < np; j++) {
        const [x, r, m] = prof[j];
        const p0 = prof[Math.max(j - 1, 0)], p1 = prof[Math.min(j + 1, np - 1)];
        const dx = p1[0] - p0[0], dr = p1[1] - p0[1], l = Math.hypot(dx, dr) || 1;
        w.v(x, r * ca, r * sa, -dr / l, (dx / l) * ca, (dx / l) * sa, k / seg, j / np, m || M);
      }
    }
    for (let k = 0; k < seg; k++) for (let j = 0; j < np - 1; j++) {
      const a = base + k * np + j, b = a + 1, c = a + np, d = c + 1;
      w.i.push(a, c, d, a, d, b);
    }
  }
  // 四邊形，正面朝 dir 那一側；ns = 四個頂點各自的法線 (省略 = 平面法線)
  function facing(w, a, b, c, d, M, dir, ns) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    const flip = (uy * vz - uz * vy) * dir[0] + (uz * vx - ux * vz) * dir[1] + (ux * vy - uy * vx) * dir[2] < 0;
    if (!ns) { if (flip) w.quad(a, d, c, b, M); else w.quad(a, b, c, d, M); return; }
    const i = [a, b, c, d].map((p, k) => w.v(p[0], p[1], p[2], ns[k][0], ns[k][1], ns[k][2], 0, 0, M));
    if (flip) w.i.push(i[0], i[3], i[2], i[0], i[2], i[1]); else w.i.push(i[0], i[1], i[2], i[0], i[2], i[3]);
  }

  // 輪胎 + 鋁圈 + 碟盤 (wheel：隨輪轉動) 與卡鉗 (caliper：不轉，做在 12 點鐘方向，畫的時候再繞輪軸轉到定位)。
  // o：{ R 胎半徑, RW 圈半徑, Wd 胎寬, spokes 輻條數, style: 'twin' 雙肋 | 'multi' 單肋,
  //      sw: [輪轂端, 輪輞端] 肋半寬, split: 雙肋 [輪轂端, 輪輞端] 的分開量, bevel 肋邊倒角,
  //      dish 輪唇深度, concave 輪轂比輻條外端內縮的量 (負值 = 輪轂凸出), lugs 螺帽數,
  //      rim 輪唇材質, rimDark 輪輞內壁 / 肋側面, spokeMat 肋正面, edgeMat 肋倒角 (省略 = 同正面), cap 中心蓋,
  //      disc 碟盤半徑, slots 碟盤劃線數, caliper 卡鉗材質, pistons 外側活塞數 (1 = 小型浮動卡鉗, 2 = 對向多活塞, 3 = 六活塞) }
  //   改裝用的選項 (js/car/tuning_vis.js；不給就和原廠一樣)：
  //      style 'mesh' 交叉網狀輻條, tread 'sport' | 'semi' 胎紋, letters 胎壁白字, bolts { n, mat } 輪唇固定螺絲,
  //      step 階梯外唇, channel 肋中央的凹槽材質, spokeText 肋上的白色字樣, drilled 碟盤打孔, float { hat } 兩片式浮動碟,
  //      calScale 卡鉗大小倍率
  function buildWheel(o) {
    // 新版產生器 (js/car/wheel_builder.js：細緻的斷面、曲線、材質與字樣)；沒載入時用下面的舊版
    if (RM.WheelBuilder) return RM.WheelBuilder.build(o);
    const w = new MeshBuilder(), cal = new MeshBuilder();
    const R = o.R, RW = o.RW, Wd = o.Wd, h = Wd / 2, sh = R - RW;
    const rim = o.rim || MAT.rim, rimDark = o.rimDark || MAT.rimDark;
    const seg = 40, X1 = [1, 0, 0];

    // ---- 輪胎：微拱的胎面 (排水溝) → 圓肩 → 鼓起的胎壁 → 護圈唇
    //      原廠：四道溝；運動胎：中央一道 + 兩側各一道寬溝；半熱熔胎：只有兩道內側溝、胎面幾乎是光的
    const rT = (x) => R - 0.004 * sq(x / h);
    const half = [[0, R]];
    const gw = o.tread === 'sport' ? 0.0085 : 0.0065, gi = gw - 0.002;
    if (o.tread === 'sport') { half[0] = [0, rT(0) - 0.0065, MAT.groove]; half.push([gi, rT(0) - 0.0065, MAT.groove], [gw, rT(gw)]); }
    for (const g of (o.tread === 'sport' ? [h * 0.52] : o.tread === 'semi' ? [h * 0.3] : [h * 0.22, h * 0.56])) {
      half.push([g - gw, rT(g)], [g - gi, rT(g) - 0.0065, MAT.groove], [g + gi, rT(g) - 0.0065, MAT.groove], [g + gw, rT(g)]);
    }
    // 胎壁：胎肩下方一道細溝 → 微凸、較亮的字樣環帶 (上下各一道溝界定) → 輪圈護緣；
    // 整圈都是同一個斷面，靠材質的亮 / 霧差別讓胎壁有層次，不再是一整片死黑
    const sT = MAT.tireWall, sG = MAT.groove;
    half.push([h - 0.03, rT(h - 0.03)], [h - 0.017, R - 0.008], [h - 0.007, R - Math.min(0.019, sh * 0.2)], [h - 0.001, R - Math.min(0.035, sh * 0.34)],
      [h + 0.0025, RW + sh * 0.6], [h + 0.0015, RW + sh * 0.575, sG], [h + 0.0045, RW + sh * 0.55, sT], [h + 0.0052, RW + sh * 0.46, sT], [h + 0.0042, RW + sh * 0.37, sT],
      [h + 0.001, RW + sh * 0.345, sG], [h + 0.002, RW + sh * 0.3], [h + 0.0035, RW + sh * 0.22, sT], [h + 0.001, RW + sh * 0.15], [h - 0.006, RW + sh * 0.09], [h - 0.013, RW + 0.006]);
    revolve(w, half.slice(1).reverse().map(([x, r, m]) => [-x, r, m]).concat(half), o.tread === 'semi' ? MAT.tireSemi : MAT.tire, seg);
    // 胎壁白字：上下兩段弧，每個字是一塊微凸的白色小塊 (遠看就是一圈字樣)
    if (o.letters) {
      const rr = RW + sh * 0.5, lh = Math.min(0.019, sh * 0.3), xw = h + 0.0062;
      const word = [1, 0.8, 1, 0.9, 1, 0.7, 0, 1, 0.9, 1, 0.8, 0, 0.7, 1, 0.8, 1, 0.9, 0.8];   // 0 = 字間空白
      const unit = (lh * 0.95) / rr;   // 每個字的角寬
      for (const a0 of [0, Math.PI]) {
        const span = word.length * unit;
        word.forEach((ww, i) => {
          if (!ww) return;
          const a = a0 - span / 2 + (i + 0.5) * unit, ca = Math.cos(a), sa = Math.sin(a);
          w.boxAxes([xw, ca * rr, sa * rr], [0.0009, 0, 0], [0, (ca * lh) / 2, (sa * lh) / 2], [0, (-sa * unit * rr * ww * 0.8) / 2, (ca * unit * rr * ww * 0.8) / 2], MAT.letter);
        });
      }
    }

    // ---- 輪輞：輪緣 + 外側唇壁 (亮面)，輻條之後是深色內壁 (step：多片式的階梯外唇)
    const xl = h - 0.009, xs = xl - (o.dish !== undefined ? o.dish : 0.022), rb = RW - 0.016;
    const lip = o.step ? [[xl - 0.004, RW - 0.011], [xl - 0.013, RW - 0.012], [xl - 0.016, RW - 0.021], [xs, rb]] : [[xl - 0.004, RW - 0.011], [xs, rb]];
    revolve(w, [[xl - 0.011, RW + 0.012], [xl - 0.003, RW + 0.0115], [xl, RW + 0.008], [xl, RW - 0.006]].concat(lip), rim, seg);
    revolve(w, [[xs, rb], [xs - 0.03, rb - 0.004], [-h + 0.022, rb - 0.004], [-h + 0.012, RW - 0.006], [-h + 0.009, RW + 0.01]], rimDark, seg);
    // 多片式：外唇與中心盤之間的一圈固定螺絲
    if (o.bolts) {
      const n = o.bolts.n || 36, rr = rb - 0.0085;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2, y = Math.cos(a) * rr, z = Math.sin(a) * rr;
        w.cyl([xs - 0.001, y, z], [xs + 0.0045, y, z], 0.0046, 0.004, 6, o.bolts.mat || MAT.bolt, true);
      }
    }

    // ---- 輪轂：側壁 + 倒角 + 正面，中心蓋、螺帽
    const lugs = o.lugs || 5, rl = RW > 0.2 ? 0.057 : 0.05;
    const rh = Math.max(RW * 0.34, rl + 0.026), xh = xs - (o.concave || 0), ts = 0.024;
    const spokeM = o.spokeMat || rim, edgeM = o.edgeMat || spokeM, sideM = o.sideMat || rimDark;
    const bevel = o.bevel || 0.004;
    const xb = Math.min(xh, xs) - bevel - ts - 0.001;               // 輻條背面
    revolve(w, [[xb, rh], [xh - 0.004, rh], [xh, rh - 0.004], [xh, rh - 0.011]], spokeM, seg);
    revolve(w, [[xh, rh - 0.011], [xh, 0.03]], spokeM, seg);
    revolve(w, [[xh, 0.031], [xh + 0.005, 0.029], [xh + 0.008, 0.02], [xh + 0.009, 0]], o.cap || (o.style === 'multi' ? rimDark : MAT.chrome), 24);
    for (let k = 0; k < lugs; k++) {
      const a = ((k + 0.5) / lugs) * Math.PI * 2, y = Math.cos(a) * rl, z = Math.sin(a) * rl;
      w.cyl([xh + 0.0004, y, z], [xh + 0.0012, y, z], 0.0135, 0.0135, 12, MAT.groove, true);      // 螺帽座
      w.cyl([xh, y, z], [xh + 0.009, y, z], 0.0092, 0.008, 6, MAT.nut, true);
    }

    // ---- 輻條：正面沿半徑微彎 (concave)，兩側倒角 + 側壁，有厚度
    const fx = (r) => xh + (xs - xh) * Math.pow(c01((r - rh) / (rb - rh)), 1.7);
    const dfx = (r) => ((xs - xh) * 1.7 * Math.pow(c01((r - rh) / (rb - rh)), 0.7)) / (rb - rh);
    const r0 = rh * 0.9, r1 = rb + 0.004, NS = 6;
    // rEnd：輻條外端半徑 (網狀輻條斜著走，外端要收進來才不會穿出輪輞)；deco：肋上的凹槽 / 字樣
    const blade = (ca, sa, c0, c1, w0, w1, rEnd, deco) => {
      const cb = -sa, sb = ca, re = rEnd || r1;
      const P = (r, s, x) => [x, ca * r + cb * s, sa * r + sb * s];
      let prev = null, pn = null, prevC = null;
      for (let k = 0; k <= NS; k++) {
        const t = k / NS, r = r0 + (re - r0) * t, c = c0 + (c1 - c0) * t, hw = w0 + (w1 - w0) * t, f = fx(r), bv = Math.min(bevel, hw * 0.45);
        const cur = [P(r, c - hw, f - bv - ts), P(r, c - hw, f - bv), P(r, c - hw + bv, f), P(r, c + hw - bv, f), P(r, c + hw, f - bv), P(r, c + hw, f - bv - ts)];
        const d = dfx(r), nl = Math.hypot(1, d), nf = [1 / nl, (-d * ca) / nl, (-d * sa) / nl];
        if (prev) {
          facing(w, prev[2], prev[3], cur[3], cur[2], spokeM, X1, [pn, pn, nf, nf]);
          facing(w, prev[1], prev[2], cur[2], cur[1], edgeM, [1, -cb, -sb]);
          facing(w, prev[3], prev[4], cur[4], cur[3], edgeM, [1, cb, sb]);
          facing(w, prev[0], prev[1], cur[1], cur[0], sideM, [0, -cb, -sb]);
          facing(w, prev[4], prev[5], cur[5], cur[4], sideM, [0, cb, sb]);
        }
        // 肋中央的凹槽 (鍛造圈的切削溝)：比正面略突出的一條深色細帶
        if (deco && deco.channel && t >= 0.17 && t <= 0.83) {
          const cw = hw * 0.28, cc = [P(r, c - cw, f + 0.0007), P(r, c + cw, f + 0.0007)];
          if (prevC) facing(w, prevC[0], prevC[1], cc[1], cc[0], deco.channel, X1);
          prevC = cc;
        }
        prev = cur; pn = nf;
      }
      // 肋上的白色字樣 (外端那一段)
      if (deco && deco.text) {
        const rr = r0 + (re - r0) * 0.7, f = fx(rr) + 0.0012, c = c0 + (c1 - c0) * 0.7, hw = (w0 + (w1 - w0) * 0.7) * 0.62;
        w.boxAxes(P(rr, c, f), [0.0007, 0, 0], [0, ca * 0.022, sa * 0.022], [0, cb * hw, sb * hw], MAT.letter);
      }
    };
    const ns = o.spokes || 6, mesh = o.style === 'mesh', twin = o.style !== 'multi' && !mesh;
    const sws = o.sw || (mesh ? [0.0048, 0.0056] : twin ? [0.0095, 0.0115] : [0.012, 0.016]), split = o.split || [0.021, 0.035];
    for (let s = 0; s < ns; s++) {
      const a = (s / ns) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const deco = { channel: o.channel, text: o.spokeText && s % 3 === 0 };
      if (mesh) {
        // 交叉網狀：每個方向兩支往左右斜出去的細肋，和隔壁方向的肋交叉成菱形格
        const c1 = rb * 0.5, rEnd = Math.sqrt(Math.max(0.01, r1 * r1 - c1 * c1));
        for (const sg of [-1, 1]) blade(ca, sa, 0, sg * c1, sws[0], sws[1], rEnd);
      } else if (twin) for (const sg of [-1, 1]) blade(ca, sa, sg * split[0], sg * split[1], sws[0], sws[1], 0, sg > 0 ? deco : null);
      else blade(ca, sa, 0, 0, sws[0], sws[1], 0, deco);
    }
    // 網狀輪圈的外環 (交叉肋的外端接在這一圈上)
    if (mesh) revolve(w, [[fx(rb) - 0.012, rb - 0.016], [fx(rb) - 0.002, rb - 0.016], [fx(rb), rb - 0.012], [fx(rb), rb + 0.002]], spokeM, seg);
    // 氣嘴
    {
      const a = (0.5 / ns) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      w.cyl([xs + 0.001, ca * (rb - 0.003), sa * (rb - 0.003)], [xs + 0.017, ca * (rb - 0.014), sa * (rb - 0.014)], 0.0042, 0.0032, 8, MAT.rubber, true);
    }

    // ---- 碟盤 (通風碟：兩片摩擦面夾一圈風道) + 碟盤座
    const big = (o.pistons || 1) >= 2;
    const calOut = big ? 0.03 : 0.024, td = 0.022;
    const rD = Math.min(o.disc || RW * 0.74, RW - 0.046), xd = xb - 0.004 - calOut;
    const rHat = Math.min(rD - 0.05, rl + 0.03);
    revolve(w, [[xd, rD, MAT.discLip], [xd, rD - 0.004], [xd, rHat + 0.009], [xd, rHat + 0.002, MAT.discLip]], MAT.disc, seg);
    revolve(w, [[xd - td, rHat * 0.8], [xd - td, rD]], MAT.disc, seg);
    revolve(w, [[xd - td, rD], [xd - td * 0.7, rD]], MAT.disc, seg);
    revolve(w, [[xd - td * 0.7, rD - 0.001], [xd - td * 0.3, rD - 0.001]], MAT.groove, seg);
    revolve(w, [[xd - td * 0.3, rD], [xd, rD]], MAT.disc, seg);
    revolve(w, [[xd, rHat], [xb + 0.004, rHat]], o.float ? o.float.hat : MAT.discHat, seg);
    // 兩片式浮動碟：鋁合金碟盤座 (上色) 的正面 + 一圈浮動銷
    if (o.float) {
      revolve(w, [[xd + 0.0012, rHat + 0.004], [xd + 0.0012, rl + 0.02]], o.float.hat, seg);
      for (let k = 0; k < 10; k++) {
        const a = ((k + 0.5) / 10) * Math.PI * 2, y = Math.cos(a) * (rHat + 0.004), z = Math.sin(a) * (rHat + 0.004);
        w.cyl([xd - 0.002, y, z], [xd + 0.004, y, z], 0.0052, 0.0052, 8, MAT.bobbin, true);
      }
    }
    // 打孔碟：一圈圈略帶弧度的小孔
    if (o.drilled) for (let k = 0; k < 24; k++) {
      for (let j = 0; j < 3; j++) {
        const r = rHat + 0.016 + (rD - rHat - 0.026) * (j / 2), a = (k / 24) * Math.PI * 2 + j * 0.07;
        const y = Math.cos(a) * r, z = Math.sin(a) * r;
        w.cyl([xd - 0.0004, y, z], [xd + 0.0009, y, z], 0.0036, 0.0036, 8, MAT.groove, true);
      }
    }
    if (o.slots) for (let k = 0; k < o.slots; k++) {
      const a0 = (k / o.slots) * Math.PI * 2, hw = 0.0016;
      let prev = null;
      for (let j = 0; j <= 5; j++) {
        const t = j / 5, r = rHat + 0.008 + (rD - rHat - 0.014) * t, a = a0 + t * 0.55, ca = Math.cos(a), sa = Math.sin(a);
        const cur = [[xd + 0.0008, ca * r + sa * hw, sa * r - ca * hw], [xd + 0.0008, ca * r - sa * hw, sa * r + ca * hw]];
        if (prev) facing(w, prev[0], prev[1], cur[1], cur[0], MAT.groove, X1);
        prev = cur;
      }
    }

    // ---- 卡鉗：沿碟盤外緣的弧形鉗體，跨過碟盤；兩端收圓，外側有活塞座，頂面開窗看得到來令片
    const calM = o.caliper || MAT.caliper, cs = o.calScale || 1, phi = (big ? 0.5 : 0.36) * cs;
    const xo = xd + calOut, xi = xd - td - 0.034, rc0 = rD - (big ? 0.056 : 0.044) * cs, rc1 = Math.min(rD + 0.017, rb - 0.007), ch = 0.007;
    const NA = 10, TH = (k) => -phi + (2 * phi * k) / NA;
    const rows = [];
    for (let k = 0; k <= NA; k++) {
      const u = k / NA, s = 0.008 * (1 - sstep(0, 0.16, Math.min(u, 1 - u)));
      rows.push([[xi + s, rc0], [xi + s, rc1 - ch - s], [xi + s + ch, rc1 - s], [xo - s - ch, rc1 - s], [xo - s, rc1 - ch - s], [xo - s, rc0]]);
    }
    for (let j = 0; j < 6; j++) {
      const j1 = (j + 1) % 6, base = cal.vcount;
      for (let k = 0; k <= NA; k++) {
        const a = rows[k][j], b = rows[k][j1], th = TH(k), ct = Math.cos(th), st = Math.sin(th);
        const dx = b[0] - a[0], dr = b[1] - a[1], l = Math.hypot(dx, dr) || 1, nx = -dr / l, nr = dx / l;
        cal.v(a[0], a[1] * ct, a[1] * st, nx, nr * ct, nr * st, 0, 0, calM);
        cal.v(b[0], b[1] * ct, b[1] * st, nx, nr * ct, nr * st, 0, 0, calM);
      }
      for (let k = 0; k < NA; k++) { const a = base + k * 2; cal.i.push(a, a + 2, a + 3, a, a + 3, a + 1); }
    }
    for (const [k, sg] of [[0, -1], [NA, 1]]) {
      const th = TH(k), ct = Math.cos(th), st = Math.sin(th), n = [0, -st * sg, ct * sg];
      const pts = rows[k].map((p) => [p[0], p[1] * ct, p[1] * st]), base = cal.vcount;
      for (const p of pts) cal.v(p[0], p[1], p[2], n[0], n[1], n[2], 0, 0, calM);
      const e1 = V.sub([0, 0, 0], pts[1], pts[0]), e2 = V.sub([0, 0, 0], pts[2], pts[0]);
      const flip = V.dot(V.cross([0, 0, 0], e1, e2), n) < 0;
      for (let j = 1; j < 5; j++) { if (flip) cal.i.push(base, base + j + 1, base + j); else cal.i.push(base, base + j, base + j + 1); }
    }
    const rm = (rc0 + rc1) / 2 - 0.003;
    for (const th of (o.pistons >= 3 ? [-phi * 0.64, 0, phi * 0.64] : big ? [-phi * 0.58, phi * 0.58] : [0])) {
      const y = rm * Math.cos(th), z = rm * Math.sin(th), pr = o.pistons >= 3 ? 0.0145 : big ? 0.016 : 0.019;
      cal.cyl([xo - 0.004, y, z], [xo + 0.006, y, z], pr, pr * 0.88, 16, calM, true);
    }
    if (big && o.logo !== false) cal.box(xo + 0.0012, o.pistons >= 3 ? rc1 - 0.0075 : rm, 0, 0.0024, 0.012, 0.03, 0, MAT.calLogo);   // 六活塞：字樣移到活塞上方
    {
      // 頂面開窗 (來令片背板)
      const base = cal.vcount, x0 = xd - td - 0.007, x1 = xd + 0.007, r = rc1 + 0.0006, N = 6;
      for (let k = 0; k <= N; k++) {
        const th = -phi * 0.55 + (phi * 1.1 * k) / N, ct = Math.cos(th), st = Math.sin(th);
        cal.v(x0, r * ct, r * st, 0, ct, st, 0, 0, MAT.pad);
        cal.v(x1, r * ct, r * st, 0, ct, st, 0, 0, MAT.pad);
      }
      for (let k = 0; k < N; k++) { const a = base + k * 2; cal.i.push(a, a + 2, a + 3, a, a + 3, a + 1); }
    }
    return { wheel: w, caliper: cal };
  }
  // 車款用：建好的 GL 網格 { wheel, caliper }；wheelOpts 留著給改裝 (js/car/tuning_vis.js) 依原廠尺寸做新輪圈
  const wheelSet = (o) => {
    const W = buildWheel(o);
    const sh = new MeshBuilder();
    sh.cyl([-o.Wd / 2, 0, 0], [o.Wd / 2, 0, 0], o.R, o.R, 16, MAT.shell, true);
    return { wheel: W.wheel.build(), caliper: W.caliper.build(), wheelShadow: sh.build(), wheelOpts: o };
  };

  // ------------------------------------------------------------------ 車殼的精簡網格 (效能)
  // 車殼約 9 萬個三角形，原本每幀畫 4 次 (車身、車窗背面、車窗正面、陰影)。這裡另外做兩個只含必要三角形的網格：
  //   shellShadow：每 4 格取 1 格的低模，只給陰影用 (陰影貼圖一格約 7 cm)
  //   shellGlass ：只含可能有玻璃的三角形 (依玻璃遮罩貼圖判斷，外擴兩圈)，給兩道車窗繪製用
  function shellExtras(m) {
    const cpu = m.shell && m.shell.cpu;
    if (!cpu) return;
    const P = cpu.p, N = cpu.n, I = cpu.i, nv = P.length / 3;
    const compact = (idx, withN) => {
      const map = new Int32Array(nv).fill(-1), pos = [], nrm = [], out = new Uint32Array(idx.length);
      for (let k = 0; k < idx.length; k++) {
        const v = idx[k];
        if (map[v] < 0) { map[v] = pos.length / 3; pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); if (withN) nrm.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]); }
        out[k] = map[v];
      }
      const n2 = pos.length / 3, attrs = { aPos: new Float32Array(pos) };
      if (withN) attrs.aNormal = new Float32Array(nrm);
      return RM.GLU.mesh(attrs, n2 > 65535 ? out : Uint16Array.from(out));
    };
    // ---- 陰影低模
    {
      const STEP = 4, idx = [];
      const sub = (n) => { const a = []; for (let k = 0; k < n - 1; k += STEP) a.push(k); a.push(n - 1); return a; };
      for (const g of cpu.grids) {
        const ia = sub(g.na), ib = sub(g.nb);
        for (let a = 0; a < ia.length - 1; a++) for (let b = 0; b < ib.length - 1; b++) {
          const v00 = g.base + ia[a] * g.nb + ib[b], v10 = g.base + ia[a + 1] * g.nb + ib[b];
          const v01 = g.base + ia[a] * g.nb + ib[b + 1], v11 = g.base + ia[a + 1] * g.nb + ib[b + 1];
          idx.push(v00, v10, v11, v00, v11, v01);
        }
      }
      m.shellShadow = compact(idx, false);
    }
    // ---- 車窗網格：把著色器的貼圖投影 (carFS) 搬到 CPU，逐頂點查玻璃遮罩
    const mask = m.tex && m.tex.mask, U = m.mapU;
    if (mask && U) {
      const A = U.A, B = U.B, C = U.C, E = U.E, F = U.F, G = U.G, MW = mask.w, MH = mask.h, MA = mask.a;
      const wrapU = (ax, z) => {
        const dz = z - A[1];
        if (dz > 0) return Math.min(ax, A[0]) + A[2] * Math.atan2(Math.max(ax - A[0], 0), dz);
        const df = E[1] - z;
        if (df <= 0) return A[0] + A[2] * 1.5707963 - dz;
        return E[3] + E[2] * Math.atan2(df, Math.max(ax - E[0], 1e-4)) + Math.max(E[0] - ax, 0);
      };
      // 取樣點周圍 (約 ±3 cm) 的最大值：保守判斷
      const RX = Math.max(2, Math.ceil((0.03 / A[3]) * MW)), RY = Math.max(2, Math.ceil(0.03 / ((B[1] - B[0]) / (MH * 0.49))));
      const near = (u, v) => {
        const cx = Math.round(u * MW), cy = Math.round(v * MH);
        let mx = 0;
        for (let y = Math.max(0, cy - RY); y <= Math.min(MH - 1, cy + RY); y++) {
          const o = y * MW;
          for (let x = Math.max(0, cx - RX); x <= Math.min(MW - 1, cx + RX); x++) if (MA[o + x] > mx) mx = MA[o + x];
        }
        return mx;
      };
      const flag = new Uint8Array(nv);
      for (let v = 0; v < nv; v++) {
        const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2], ax = Math.abs(x);
        const nl = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]) || 1, ny = N[v * 3 + 1] / nl;
        const front = F[0] > 0 && z < F[1] && ax < F[2];
        const rear = G[0] > 0 && z > G[1] && ax < G[2];
        const chart = front ? F : rear ? G : null;
        const wT = sstep(0.60, 0.74, ny) * (chart ? sstep(chart[3], chart[3] + 0.045, y) : 1);
        let g = 0;
        if (wT < 1) {
          const u = front ? F[0] - ax : rear ? ax : wrapU(ax, z);
          g = near(u / A[3], ((B[1] - y) / (B[1] - B[0])) * 0.49);
        }
        if (wT > 0) g = Math.max(g, near((z - B[2]) / (B[3] - B[2]), 1 - (ax / C[0]) * 0.49));
        if (g > 140) flag[v] = 1;       // 0.5 以上才是玻璃 (以下是車燈的 lens 深度)
      }
      // 外擴兩圈 (含到與玻璃相鄰的三角形)
      for (let ring = 0; ring < 2; ring++) {
        const add = [];
        for (let k = 0; k < I.length; k += 3) if (flag[I[k]] || flag[I[k + 1]] || flag[I[k + 2]]) add.push(I[k], I[k + 1], I[k + 2]);
        for (const v of add) flag[v] = 1;
      }
      const idx = [];
      for (let k = 0; k < I.length; k += 3) if (flag[I[k]] || flag[I[k + 1]] || flag[I[k + 2]]) idx.push(I[k], I[k + 1], I[k + 2]);
      if (idx.length && idx.length < I.length * 0.9) m.shellGlass = compact(idx, true);
    }
    delete m.shell.cpu;
    if (m.tex) delete m.tex.mask;
  }

  function buildSteering() {
    const s = new MeshBuilder();
    const R = 0.19, r = 0.016, seg = 24, tseg = 6;
    const base = s.vcount;
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      for (let j = 0; j <= tseg; j++) {
        const b = (j / tseg) * Math.PI * 2, cb = Math.cos(b), sb = Math.sin(b);
        const nx = ca * cb, ny = sa * cb, nz = sb;
        s.v((R + r * cb) * ca, (R + r * cb) * sa, r * sb, nx, ny, nz, 0, 0, MAT.dash);
      }
    }
    for (let k = 0; k < seg; k++) for (let j = 0; j < tseg; j++) {
      const a = base + k * (tseg + 1) + j, b = a + tseg + 1;
      s.i.push(a, b, b + 1, a, b + 1, a + 1);
    }
    s.box(0, 0, -0.01, 0.13, 0.11, 0.05, 0, MAT.dash);
    s.box(0, 0, 0.018, 0.045, 0.032, 0.006, 0, MAT.trim);
    for (const a of [Math.PI, 0, -Math.PI / 2]) {
      s.box(Math.cos(a) * 0.12, Math.sin(a) * 0.12, -0.005, Math.abs(Math.cos(a)) * 0.1 + 0.03, Math.abs(Math.sin(a)) * 0.1 + 0.03, 0.02, 0, MAT.dash);
    }
    return s;
  }

  // ------------------------------------------------------------------ 貼圖投影座標
  // M：{ XC, ZC, RC (車尾角), XCF, ZCF, RCF (車頭角), UMAX, Y0, Y1, Z0, Z1, XMAX,
  //      AXF, AXR (前後軸 z), ARF, AYF, ARR, AYR (輪拱半徑 / 圓心高), ARCH_IN (輪拱內側 |x|) }
  function mapInfo(M) {
    const KU = M.XC + (M.RC * Math.PI) / 2 + M.ZC;          // 車側：u = KU - z
    const UF0 = KU - M.ZCF;                                   // 車頭角起點
    const UFC = UF0 + (M.RCF * Math.PI) / 2 + M.XCF;          // 車頭中心：u = UFC - |x|
    return {
      KU, UF0, UFC,
      uSide: (z) => KU - z, uFront: (x) => UFC - x,
      uniforms: {
        A: new Float32Array([M.XC, M.ZC, M.RC, M.UMAX]),
        B: new Float32Array([M.Y0, M.Y1, M.Z0, M.Z1]),
        C: new Float32Array([M.XMAX, M.AXF, M.AXR, M.ARCH_IN]),
        D: new Float32Array([M.ARF, M.AYF, M.ARR, M.AYR]),
        E: new Float32Array([M.XCF, M.ZCF, M.RCF, UF0]),
        F: new Float32Array(M.frontChart ? [UFC, M.frontChart.endZ, M.frontChart.maxX, M.frontChart.bumperTop] : 4),
        G: new Float32Array(M.rearChart ? [1, M.rearChart.startZ, M.rearChart.maxX, M.rearChart.bumperTop] : 4),
      },
    };
  }

  // ------------------------------------------------------------------ 貼圖繪製工具
  // 上半張 = 環繞帶 (u, y)，下半張 = 俯視 (z, |x|)。輸出：
  //   A (sRGB)  : rgb = 非烤漆部位顏色，a = 覆蓋率 (0 = 車身烤漆)
  //   B (linear): rg = 表面斜率 (凹凸 → 法線)，b = 粗糙度，a = 金屬度
  //   C (linear): 車尾區 r = 尾燈/煞車燈、g = 方向燈、b = 倒車燈；車頭區 r = 頭燈、g = 方向燈、b = 日行燈；
  //               俯視區 r = 第三煞車燈；a = 玻璃
  function texKit(W, M) {
    const H = W / 2, HB = Math.round(0.49 * H);
    const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    const cv = { A: mk(W, H), H: mk(W, H), M: mk(W, H), C: mk(W, H), G: mk(W, H) };
    const X = {};
    for (const k in cv) X[k] = cv[k].getContext('2d', { willReadFrequently: true });
    X.H.fillStyle = '#808080'; X.H.fillRect(0, 0, W, H);
    X.M.fillStyle = 'rgb(90,0,0)'; X.M.fillRect(0, 0, W, H);
    X.C.fillStyle = '#000'; X.C.fillRect(0, 0, W, H);
    X.G.fillStyle = '#000'; X.G.fillRect(0, 0, W, H);
    const each = (fn) => { for (const k in X) fn(X[k]); };
    const gray = (mm) => { const g = Math.max(0, Math.min(255, Math.round(128 + mm * 12.7))); return `rgb(${g},${g},${g})`; };
    // spec：c 顏色 (或 g=>漸層)、a 透明度、erase 還原成烤漆、h 高度(mm)、r 粗糙度、m 金屬度、mask 燈區 (C 的 rgb)、glass 玻璃
    function apply(s, path, w) {
      const isStroke = w !== undefined;
      const run = (g, style) => {
        path(g);
        if (isStroke) { g.strokeStyle = style; g.lineWidth = w; g.lineJoin = 'round'; g.lineCap = s.cap || 'round'; g.stroke(); }
        else { g.fillStyle = style; g.fill(); }
      };
      if (s.erase) { X.A.globalCompositeOperation = 'destination-out'; run(X.A, '#000'); X.A.globalCompositeOperation = 'source-over'; }
      if (s.c !== undefined) { X.A.globalAlpha = s.a === undefined ? 1 : s.a; run(X.A, typeof s.c === 'function' ? s.c(X.A) : s.c); X.A.globalAlpha = 1; }
      if (s.h !== undefined) run(X.H, gray(s.h));
      if (s.r !== undefined) run(X.M, `rgb(${Math.round(s.r * 255)},${Math.round((s.m || 0) * 255)},0)`);
      if (s.mask !== undefined) {
        if (s.add) X.C.globalCompositeOperation = 'lighter';
        run(X.C, typeof s.mask === 'function' ? s.mask(X.C) : s.mask);
        X.C.globalCompositeOperation = 'source-over';
      }
      if (s.glass !== undefined) run(X.G, s.glass ? '#fff' : '#000');
      // lens：車燈內層 (反射罩 / 燈珠 / 光條) 在透鏡後方的深度 (公尺，0.006 ~ 0.09)。寫在玻璃遮罩的 0 ~ 0.5 區間，
      // 著色器只在燈區 (mask 的 rgb 有值) 讀它來做視差；燈區沒畫 lens 時深度是 3 cm
      if (s.lens !== undefined) { const v = Math.max(6, Math.min(118, Math.round((s.lens / 0.2) * 255))); run(X.G, `rgb(${v},${v},${v})`); }
    }
    const fill = (path, s) => apply(s, path);
    const stroke = (path, w, s) => apply(s, path, w);
    const poly = (pts, close = true) => (g) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); if (close) g.closePath(); };
    const line = (pts) => poly(pts, false);
    const rect = (x0, y0, x1, y1) => poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
    const circ = (x, y, rx, ry) => (g) => { g.beginPath(); g.ellipse(x, y, rx, ry || rx, 0, 0, 6.2832); };
    // 圓角多邊形 (r 可為每個頂點的半徑)
    const rpoly = (pts, r) => (g) => {
      const n = pts.length, mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const s0 = mid(pts[n - 1], pts[0]);
      g.beginPath(); g.moveTo(s0[0], s0[1]);
      for (let i = 0; i < n; i++) {
        const p = pts[i], m = mid(p, pts[(i + 1) % n]), rr = Array.isArray(r) ? r[i] : r;
        if (rr > 0) g.arcTo(p[0], p[1], m[0], m[1], rr); else g.lineTo(p[0], p[1]);
        g.lineTo(m[0], m[1]);
      }
      g.closePath();
    };
    const clipTo = (path, fn) => { each((g) => { g.save(); path(g); g.clip(); }); fn(); each((g) => g.restore()); };
    const lgrad = (x0, y0, x1, y1, stops) => (g) => { const gr = g.createLinearGradient(x0, y0, x1, y1); stops.forEach((s) => gr.addColorStop(s[0], s[1])); return gr; };
    const rgrad = (x, y, r, stops) => (g) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); stops.forEach((s) => gr.addColorStop(s[0], s[1])); return gr; };
    function region(kind) {
      each((g) => {
        g.save(); g.beginPath();
        if (kind === 'belt') { g.rect(0, 0, W, HB); g.clip(); g.setTransform(W / M.UMAX, 0, 0, -HB / (M.Y1 - M.Y0), 0, (HB * M.Y1) / (M.Y1 - M.Y0)); }
        else { g.rect(0, H - HB, W, HB); g.clip(); g.setTransform(W / (M.Z1 - M.Z0), 0, 0, -HB / M.XMAX, (-M.Z0 * W) / (M.Z1 - M.Z0), H); }
      });
    }
    const end = () => each((g) => g.restore());
    // 鈑件縫：淺斜面 + 深色窄溝
    const gap = (pts, w) => { w = w || 0.006; stroke(line(pts), w + 0.008, { h: -0.8 }); stroke(line(pts), w, { c: '#040405', h: -3, r: 0.85, m: 0 }); };
    const info = mapInfo(M), uz = info.uSide, uf = info.uFront;
    const qcurve = (zc, k, x0, x1, n = 24) => { const p = []; for (let i = 0; i <= n; i++) { const x = x0 + ((x1 - x0) * i) / n; p.push([zc + k * x * x, x]); } return p; };
    // 側窗 (環繞帶)：黑色窗框 + 玻璃片 + 窗下飾條。
    //   o：{ z0, z1 開口範圍, ySl(z) 下緣, yTop(z) 上緣, yA(z, ins) A 柱斜線 (可省), panes: [[z0, z1]…], sill: 飾條顏色 spec (可省) }
    function sideWindows(o) {
      const win = (z0, z1, ins) => {
        const lo = [], hi = [];
        for (let k = 0; k <= 56; k++) {
          const z = z0 + ((z1 - z0) * k) / 56, b = o.ySl(z) + ins;
          const t = Math.min(o.yTop(z) - ins, o.yA ? o.yA(z, ins) : 9);
          if (t > b + 0.004) { lo.push([uz(z), b]); hi.push([uz(z), t]); }
        }
        return lo.concat(hi.reverse());
      };
      fill(poly(win(o.z0, o.z1, 0)), { c: '#070708', r: 0.42, m: 0, h: -1.2 });
      for (const [a, b] of o.panes) {
        const p = win(a, b, 0.02);
        if (p.length > 4) { fill(poly(p), { erase: true, glass: 1, h: -2.5 }); stroke(poly(p), 0.014, { glass: 1 }); }
      }
      const sill = [];
      for (let z = o.z0 + 0.05; z <= o.z1 - 0.03; z += 0.04) sill.push([uz(z), o.ySl(z) - 0.004]);
      stroke(line(sill), 0.014, Object.assign({ h: 1.0, cap: 'butt' }, o.sill || { c: '#0c0c0e', r: 0.3, m: 0 }));
    }
    // 前 / 後擋玻璃 (俯視)：黑邊 + 玻璃片。上下緣為拋物線 z = zc + k x²，兩側由 (wT @ 上緣) 到 (wB @ 下緣)。
    //   o：{ zt, zb 上/下緣中心 z, k, wt, wb, defrost: { z0, dz, n } (可省), brake: { z0, z1, w } 第三煞車燈 (可省) }
    function topGlass(o) {
      const front = o.zt > o.zb;                       // 前擋：上緣在後 (z 較大)
      const zt = (d) => o.zt + (front ? -d : d), zb = (d) => o.zb + (front ? d : -d);
      const shape = (d) => qcurve(zt(d), o.k, -0.05, o.wt - d).concat(qcurve(zb(d), o.k, -0.05, o.wb - d).reverse());
      fill(poly(shape(-0.013)), { c: '#060607', r: 0.5, m: 0, h: -1.5 });
      fill(rpoly(shape(0.03), 0.02), { erase: true, glass: 1, h: -2 });
      stroke(rpoly(shape(0.03), 0.02), 0.014, { glass: 1 });
      if (o.defrost || o.brake) clipTo(rpoly(shape(0.03), 0.02), () => {
        if (o.defrost) for (let i = 0; i < o.defrost.n; i++) {
          const zc = o.defrost.z0 + i * o.defrost.dz, f = i / Math.max(1, o.defrost.n - 1);
          stroke(line(qcurve(zc, o.k, -0.05, o.wt + (o.wb - o.wt) * f - 0.05)), 0.0024, { c: '#4a2c1c', a: 0.85, r: 0.5, m: 0 });
        }
        if (o.brake) fill(rpoly([[o.brake.z0, -0.05], [o.brake.z0, o.brake.w], [o.brake.z1, o.brake.w], [o.brake.z1, -0.05]], [0, 0.006, 0.006, 0]), { c: '#4a070b', r: 0.2, m: 0, mask: '#ff0000' });
      });
    }
    // 門把：黑色凹槽 + 車色掀板 (chrome = true 時為鍍鉻把手)
    function handle(za, zb, y0, y1, chrome) {
      const u0 = uz(Math.max(za, zb)), u1 = uz(Math.min(za, zb));
      fill(rpoly([[u0, y0], [u1, y0], [u1, y1], [u0, y1]], 0.009), { c: '#08080a', r: 0.5, m: 0, h: -5 });
      const fl = rpoly([[u0 + 0.006, y0 + 0.012], [u1 - 0.006, y0 + 0.012], [u1 - 0.006, y1 - 0.004], [u0 + 0.006, y1 - 0.004]], 0.005);
      if (chrome) fill(fl, { c: '#c9ccd0', r: 0.16, m: 1, h: 1 }); else fill(fl, { erase: true, h: -0.5 });
    }

    // 組成三張貼圖
    function finish() {
      const N = W * H;
      const dA = X.A.getImageData(0, 0, W, H).data;
      const dH = X.H.getImageData(0, 0, W, H).data;
      const dM = X.M.getImageData(0, 0, W, H).data;
      let hf = new Float32Array(N), tmp = new Float32Array(N);
      for (let i = 0; i < N; i++) hf[i] = ((dH[i * 4] - 128) / 12.7) * 0.001;
      // 兩次 3x3 盒狀模糊 → 接縫與邊緣有柔和斜面
      const rowLim = (y) => (y < HB ? [0, HB - 1] : y >= H - HB ? [H - HB, H - 1] : [y, y]);
      for (let pass = 0; pass < 2; pass++) {
        for (let y = 0; y < H; y++) {
          const o = y * W;
          tmp[o] = hf[o]; tmp[o + W - 1] = hf[o + W - 1];
          for (let x = 1; x < W - 1; x++) tmp[o + x] = (hf[o + x - 1] + hf[o + x] + hf[o + x + 1]) / 3;
        }
        for (let y = 0; y < H; y++) {
          const [y0, y1] = rowLim(y), a = Math.max(y - 1, y0) * W, b = y * W, c = Math.min(y + 1, y1) * W;
          for (let x = 0; x < W; x++) hf[b + x] = (tmp[a + x] + tmp[b + x] + tmp[c + x]) / 3;
        }
      }
      tmp = null;
      const B = new Uint8Array(N * 4);
      const duB = M.UMAX / W, dyB = (M.Y1 - M.Y0) / HB, dzT = (M.Z1 - M.Z0) / W, dxT = M.XMAX / HB;
      const q8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
      for (let y = 0; y < H; y++) {
        const [y0, y1] = rowLim(y), ym = Math.max(y - 1, y0), yp = Math.min(y + 1, y1);
        const du = y < HB ? duB : dzT, dv = y < HB ? dyB : dxT;
        for (let x = 0; x < W; x++) {
          const xm = x > 0 ? x - 1 : 0, xp = x < W - 1 ? x + 1 : W - 1, o = (y * W + x) * 4;
          const sx = (hf[y * W + xp] - hf[y * W + xm]) / ((xp - xm) * du);
          const sy = yp > ym ? -(hf[yp * W + x] - hf[ym * W + x]) / ((yp - ym) * dv) : 0;
          B[o] = q8(128 + sx * 64); B[o + 1] = q8(128 + sy * 64); B[o + 2] = dM[o]; B[o + 3] = dM[o + 1];
        }
      }
      hf = null;
      // C：半解析度
      const CW = W / 2, CH = H / 2;
      const c2 = mk(CW, CH), g2 = c2.getContext('2d', { willReadFrequently: true });
      g2.drawImage(cv.C, 0, 0, CW, CH);
      const dC = g2.getImageData(0, 0, CW, CH).data;
      g2.drawImage(cv.G, 0, 0, CW, CH);
      const dG = g2.getImageData(0, 0, CW, CH).data;
      const C = new Uint8Array(CW * CH * 4);
      for (let i = 0; i < CW * CH; i++) { C[i * 4] = dC[i * 4]; C[i * 4 + 1] = dC[i * 4 + 1]; C[i * 4 + 2] = dC[i * 4 + 2]; C[i * 4 + 3] = dG[i * 4]; }
      const A = new Uint8Array(dA.buffer);
      for (const k in cv) { cv[k].width = 1; cv[k].height = 1; }
      return { A, B, C, W, H, CW, CH };
    }
    return { X, W, H, HB, fill, stroke, poly, line, rect, circ, rpoly, clipTo, lgrad, rgrad, region, end, gap, finish,
      info, uz, uf, qcurve, sideWindows, topGlass, handle };
  }
  // 把 texKit.finish() 的結果上傳成 GL 貼圖
  function uploadTex(ct) {
    const G = RM.GLU;
    return {
      A: G.texture(ct.A, { w: ct.W, h: ct.H, clamp: true, aniso: 8 }),
      B: G.texture(ct.B, { w: ct.W, h: ct.H, linear: true, clamp: true, aniso: 8 }),
      C: G.texture(ct.C, { w: ct.CW, h: ct.CH, linear: true, clamp: true, aniso: 4 }),
      mask: (() => { const n = ct.CW * ct.CH, a = new Uint8Array(n); for (let i = 0; i < n; i++) a[i] = ct.C[i * 4 + 3]; return { w: ct.CW, h: ct.CH, a }; })(),
    };
  }
  let texOverride = 0;   // 車庫預覽 / 多人連線其他玩家使用較小的貼圖
  const texSize = () => texOverride || (RM.GLU.gl.getParameter(RM.GLU.gl.MAX_TEXTURE_SIZE) >= 4096 ? 4096 : 2048);

  // ------------------------------------------------------------------ 車款登錄
  // def.build(atlas) → { shell, body, glass, decal, wheel, caliper, steer (GL 網格), tex {A,B,C}, decalTex?, map, mapU,
  //                      DROP 車身下降量, steerPos 方向盤位置 (車身座標), spec() 車輛規格 }
  const defs = {}, built = {}, extra = {}, previews = new Map();
  function dispose(m) {
    const gl = RM.GLU.gl;
    for (const k of ['shell', 'body', 'glass', 'decal', 'wheel', 'caliper', 'steer', 'shellShadow', 'shellGlass', 'wheelShadow']) if (m[k]) RM.GLU.deleteMesh(m[k]);
    if (m.tex) for (const k of ['A', 'B', 'C']) gl.deleteTexture(m.tex[k]);
    if (m.decalTex) gl.deleteTexture(m.decalTex);
  }

  RM.ProcCar = {
    c01, sq, sstep, pn, pn4, rmax, smin, softPos, spline, lin, archFlare, MAT,
    surface, buildShell, patch, band, ellipsoid, roundPatch, wing, wheelArches, underbody, buildWheel, wheelSet, buildSteering,
    mapInfo, texKit, uploadTex, texSize,
    register(id, def) { defs[id] = def; },
    has: (id) => !!defs[id],
    // The garage displays a ~500 px car: 2K textures avoid rebuilding 4K maps on every click.
    // Keep only three recent previews; full-resolution race models have their own lifetime.
    getPreview(id, atlas) {
      if (!defs[id]) id = 'k8';
      let m = previews.get(id);
      if (m) { previews.delete(id); previews.set(id, m); return m; }
      if (previews.size >= 3) {
        const oldest = previews.keys().next().value;
        dispose(previews.get(oldest)); previews.delete(oldest);
      }
      texOverride = Math.min(2048, RM.GLU.gl.getParameter(RM.GLU.gl.MAX_TEXTURE_SIZE));
      try { m = defs[id].build(atlas); } finally { texOverride = 0; }
      try { shellExtras(m); } catch (e) { console.warn('shellExtras', e); }
      m.id = id; previews.set(id, m);
      return m;
    },
    clearPreviews() { for (const m of previews.values()) dispose(m); previews.clear(); },
    // 取得 (必要時建立) 一台車；同時只保留一台的 GPU 資源 (每台車的貼圖約 100 MB)
    get(id, atlas) {
      if (!defs[id]) id = 'k8';
      if (built[id]) return built[id];
      for (const k in built) { dispose(built[k]); delete built[k]; }
      const m = defs[id].build(atlas);
      try { shellExtras(m); } catch (e) { console.warn('shellExtras', e); }
      m.id = id;
      built[id] = m;
      return m;
    },
    // 多人連線：其他玩家的車。和玩家自己的車分開保存 (get() 換車時不會被釋放)，貼圖用 1024 (每台約 15 MB)
    getExtra(id, atlas) {
      if (!defs[id]) id = 'k8';
      if (extra[id]) return extra[id];
      texOverride = 1024;
      let m;
      try { m = defs[id].build(atlas); } finally { texOverride = 0; }
      try { shellExtras(m); } catch (e) { console.warn('shellExtras', e); }
      m.id = id;
      extra[id] = m;
      return m;
    },
  };
})();
