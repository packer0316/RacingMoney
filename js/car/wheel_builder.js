'use strict';
// 鋁圈 / 輪胎 / 煞車產生器 (proc_car.js 的 buildWheel 交給這裡)。參數與舊版相同，原廠輪圈的造型照舊，細節與材質全面升級：
//
//   輪胎：胎冠微拱、圓胎肩、鼓起的胎壁、護圈肋、胎唇；排水溝依胎種不同，胎肩有橫向溝；胎壁字樣是真的文字 (貼圖)
//   輪緣：J 型捲邊 (車削亮面)、可選階梯外唇，輪輞內側有中央凹槽 (從輻條縫看得到)
//   輻條：沿半徑的寬度曲線 (輪轂端、輪緣端都有圓角過渡)、凹度曲線、厚度從輪轂往外漸薄；
//         斷面分 round (鑄造：大圓角)、soft (旋壓：中圓角)、sharp (鍛造：小倒角 + 可選中央切削溝)；法線由實際曲面算
//   輪轂：凹進去的螺帽座、六角螺帽 (原廠鍍鉻 / 競技黑 / 燒鈦)、中心蓋徽章 (貼圖)、氣嘴
//   煞車：碟盤摩擦面有同心車削紋、通風碟的風道、打孔 / 劃線 / 兩片式浮動碟；卡鉗圓潤的鉗體、活塞座、字樣、放氣螺絲
//
// 材質 (shaders.js propFS 的鋁圈模式，參數放在 mat 的第 6 個值)：
//   40 車削鋁：圓周方向的車削紋 + 異向反光 (亮光沿半徑拉長，就是真的切削面那種放射狀反光)
//   41 烤漆：亮光透明漆 + 金屬亮片      42 陽極 / 霧面金屬：細微的不均勻      43 橡膠      44 半徑方向拉絲
//   貼圖 (字樣、徽章) 用 mode 2 (透明處捨棄)，貼圖由 texture() 產生、所有輪子共用一張
(function () {
  const RM = window.RM, PC = RM.ProcCar, MeshBuilder = RM.MeshBuilder;
  const mat = RM.mat, MAT = PC.MAT;
  const c01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const sst = (a, b, x) => { const t = c01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const sq = (x) => x * x;
  const TAU = Math.PI * 2;

  // ------------------------------------------------------------------ 材質
  const M = (hex, rough, metal, mode, prm) => mat(hex, rough, metal, mode || 0, 0, prm || 0);
  const W = {
    tire: M('#121212', 0.86, 0, 43), tireSemi: M('#1e1e1e', 0.93, 0, 43), wall: M('#171717', 0.72, 0, 43), groove: M('#060606', 0.98, 0, 43),
    pocket: M('#0d0d0e', 0.7, 0.4), hub: M('#2a2b2d', 0.55, 0.6, 42, 0.5), bore: M('#b9bcc0', 0.2, 1, 40, 0.8),
    chrome: M('#dfe2e6', 0.08, 1, 40, 0.35), lugBlack: M('#141416', 0.3, 0.7, 42, 0.3), lugTi: M('#8c8f96', 0.25, 1, 40, 0.6),
    valve: M('#cfd3d8', 0.15, 1), valveCap: M('#111', 0.5, 0.2),
    disc: M('#6f6f72', 0.34, 0.9, 40, 1), discEdge: M('#3a3a3c', 0.6, 0.7), vent: M('#0b0b0b', 0.9, 0), hatAlu: M('#b8bbbf', 0.3, 1, 40, 0.6),
    drill: M('#050505', 0.95, 0), bobbin: M('#cfd2d6', 0.2, 1, 40, 0.5), pad: M('#0c0c0c', 0.9, 0), bleed: M('#d4d7db', 0.15, 1),
    decal: M('#ffffff', 0.45, 0, 2), decalDark: M('#ffffff', 0.6, 0, 2),
  };
  // 車款 / 改裝傳進來的材質 (mode 0 的一般材質) → 換成對應的鋁圈材質；結果快取
  const up = new WeakMap();
  function metalize(m, role) {
    if (!m) return m;
    let byRole = up.get(m);
    if (!byRole) { byRole = {}; up.set(m, byRole); }
    if (byRole[role]) return byRole[role];
    let out = m;
    if (!m.mode) {
      const lum = 0.2126 * m.c[0] + 0.7152 * m.c[1] + 0.0722 * m.c[2];
      if (role === 'lip' && m.m >= 0.7 && m.r <= 0.32) out = Object.assign({}, m, { mode: 40, night: m.r <= 0.1 ? 0.45 : 0.9 });   // 亮面 → 車削 / 拋光
      else if (role === 'spoke' && m.m >= 0.75 && m.r <= 0.18) out = Object.assign({}, m, { mode: 40, night: 0.8 });                 // 切削面
      else if (m.m >= 0.7) out = Object.assign({}, m, { mode: 42, night: 0.6 });                                                      // 陽極 / 金屬漆霧面
      else out = Object.assign({}, m, { mode: 41, night: lum > 0.5 ? 0.15 : 0.35, r: Math.min(m.r, 0.38) });                         // 烤漆 (含亮光透明漆)
    }
    byRole[role] = out;
    return out;
  }

  // ------------------------------------------------------------------ 貼圖 (字樣、徽章)：1024 × 1024，所有輪子共用
  // 列：0 原廠胎壁 (深灰浮字)、1 運動胎白字、2 半熱熔胎白字、3 鍛造肋貼紙、4 旋壓肋貼紙、5 卡鉗字樣、6 六活塞卡鉗字樣；
  // 512～767：四個中心蓋徽章 (每個 256 × 256)
  const ROW = 64;
  let canvas = null, glTex = null;
  function drawTexture() {
    const cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 1024;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, 1024, 1024);
    const line = (row, text, fill, size, font, stroke) => {
      g.save();
      g.font = font || `900 ${size}px "Arial Black", "Segoe UI Black", Impact, sans-serif`;
      g.textBaseline = 'middle'; g.textAlign = 'center';
      if (stroke) { g.lineWidth = stroke[1]; g.strokeStyle = stroke[0]; g.lineJoin = 'round'; g.strokeText(text, 512, row * ROW + ROW / 2); }
      g.fillStyle = fill; g.fillText(text, 512, row * ROW + ROW / 2);
      // 量出字串實際寬度 → 貼紙用的 u 範圍與長寬比
      const half = g.measureText(text).width / 2 + (stroke ? stroke[1] / 2 : 0) + 6;
      TEXT_U[row] = [Math.max(0, 512 - half) / 1024, Math.min(1024, 512 + half) / 1024];
      TEXT_ASP[row] = (half * 2) / (ROW - 8);
      g.restore();
    };
    // 胎壁：繞一圈重複兩次 (u 0～2)，字串本身要剛好塞滿寬度
    const fitLine = (row, parts, fill, sizes) => {
      g.save(); g.textBaseline = 'middle'; g.fillStyle = fill;
      let x = 16;
      for (let i = 0; i < parts.length; i++) {
        g.font = `900 ${sizes[i]}px "Arial Black", "Segoe UI Black", Impact, sans-serif`;
        g.fillText(parts[i], x, row * ROW + ROW / 2 + 2);
        x += g.measureText(parts[i]).width + 34;
      }
      g.restore();
    };
    fitLine(0, ['MONKEY', 'TOURING ST-1', '205/50R16 87V', 'M+S'], '#ffffff', [40, 28, 26, 22]);
    fitLine(1, ['MONKEY GRIP', 'SPORT·R', '200', 'TW'], '#ffffff', [44, 40, 34, 22]);
    fitLine(2, ['SR-1', 'COMPETITION', 'SEMI-SLICK', 'R-COMPOUND'], '#ffffff', [46, 30, 34, 22]);
    // 輻條貼紙 (沿肋的長邊讀)：白字黑邊
    line(3, 'SHANDAO FORGED', '#ffffff', 46, null, ['#0a0a0a', 9]);
    line(4, 'MK·LIGHT FLOW', '#ffffff', 46, null, ['#0a0a0a', 9]);
    line(5, 'MK BRAKE', '#ffffff', 52, null, null);
    line(6, 'MK 6POT', '#ffffff', 52, null, null);
    // 中心蓋徽章：圓底 + 字
    const cap = (i, bg, ring, text, fg, size) => {
      const cx = i * 256 + 128, cy = 640;
      g.save();
      g.beginPath(); g.arc(cx, cy, 124, 0, TAU); g.fillStyle = bg; g.fill();
      g.lineWidth = 14; g.strokeStyle = ring; g.beginPath(); g.arc(cx, cy, 104, 0, TAU); g.stroke();
      g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `900 ${size}px "Arial Black", Impact, sans-serif`; g.fillText(text, cx, cy + 4);
      g.restore();
    };
    cap(0, '#121214', '#c9a13b', 'MK', '#ffffff', 92);      // 鍛造：黑底金環白字
    cap(1, '#c9a13b', '#121214', 'SD', '#121214', 96);      // 網狀：金底黑字
    cap(2, '#d9dce0', '#c8102e', 'MK', '#c8102e', 92);      // 三片式：銀底紅字
    cap(3, '#2b2d30', '#9aa0a6', '◆', '#cfd3d8', 110);       // 原廠 / 鑄造 / 旋壓：低調的菱形
    return cv;
  }
  function texture() {
    if (glTex) return glTex;
    if (!RM.GLU || !RM.GLU.gl) return null;
    canvas = canvas || drawTexture();
    glTex = RM.GLU.texture(canvas, { aniso: 8 });   // 重複 (repeat)：胎壁字樣繞一圈
    return glTex;
  }
  const rowV = (row) => [(row * ROW + 4) / 1024, (row * ROW + ROW - 4) / 1024];
  // 置中的字樣列：字串實際的寬度範圍 (u) 與長寬比；texture() 畫字的時候量出來 (先給估計值，貼紙網格在 texture() 之前就可能建好)
  const TEXT_U = { 3: [0.24, 0.76], 4: [0.25, 0.75], 5: [0.31, 0.69], 6: [0.32, 0.68] };
  const TEXT_ASP = { 3: 9.5, 4: 9.1, 5: 7.0, 6: 6.6 };

  // ------------------------------------------------------------------ 幾何小工具
  // 旋轉體 (軸 = x)：prof = [[x, r, 材質?]]，法線取輪廓走向的左側 (同 proc_car.js)
  function revolve(w, prof, Mt, seg, a0, a1) {
    const base = w.vcount, np = prof.length, A0 = a0 || 0, A1 = a1 === undefined ? TAU : a1;
    for (let k = 0; k <= seg; k++) {
      const a = A0 + (A1 - A0) * (k / seg), ca = Math.cos(a), sa = Math.sin(a);
      for (let j = 0; j < np; j++) {
        const [x, r, m] = prof[j];
        const p0 = prof[Math.max(j - 1, 0)], p1 = prof[Math.min(j + 1, np - 1)];
        const dx = p1[0] - p0[0], dr = p1[1] - p0[1], l = Math.hypot(dx, dr) || 1;
        w.v(x, r * ca, r * sa, -dr / l, (dx / l) * ca, (dx / l) * sa, k / seg, j / np, m || Mt);
      }
    }
    for (let k = 0; k < seg; k++) for (let j = 0; j < np - 1; j++) {
      const a = base + k * np + j, b = a + 1, c = a + np, d = c + 1;
      w.i.push(a, c, d, a, d, b);
    }
  }
  // 平行於輪軸、圓心在 (y, z) 的小旋轉體 (螺帽座、螺帽、螺絲)；sides = 邊數 (6 = 六角)
  function revolveAt(w, y, z, prof, Mt, sides, rot) {
    const base = w.vcount, np = prof.length, ro = rot || 0;
    for (let k = 0; k <= sides; k++) {
      const a = ro + (k / sides) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      for (let j = 0; j < np; j++) {
        const [x, r, m] = prof[j];
        const p0 = prof[Math.max(j - 1, 0)], p1 = prof[Math.min(j + 1, np - 1)];
        const dx = p1[0] - p0[0], dr = p1[1] - p0[1], l = Math.hypot(dx, dr) || 1;
        w.v(x, y + r * ca, z + r * sa, -dr / l, (dx / l) * ca, (dx / l) * sa, 0, 0, m || Mt);
      }
    }
    for (let k = 0; k < sides; k++) for (let j = 0; j < np - 1; j++) {
      const a = base + k * np + j, b = a + 1, c = a + np, d = c + 1;
      w.i.push(a, c, d, a, d, b);
    }
  }
  // 網格曲面：G[i][j] = 點，法線由曲面算 (中心差分)，用 hint(i, j, p) 回傳的「朝外」方向決定正反
  function sheet(w, G, Mt, hint, uv) {
    const ni = G.length, nj = G[0].length, base = w.vcount;
    const at = (i, j) => G[Math.max(0, Math.min(ni - 1, i))][Math.max(0, Math.min(nj - 1, j))];
    const N = [];
    for (let i = 0; i < ni; i++) {
      N.push([]);
      for (let j = 0; j < nj; j++) {
        const a = at(i + 1, j), b = at(i - 1, j), c = at(i, j + 1), d = at(i, j - 1);
        const u = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], v = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
        let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const l = Math.hypot(n[0], n[1], n[2]) || 1; n = [n[0] / l, n[1] / l, n[2] / l];
        const h = hint(i, j, G[i][j]);
        if (n[0] * h[0] + n[1] * h[1] + n[2] * h[2] < 0) n = [-n[0], -n[1], -n[2]];
        N[i].push(n);
        const p = G[i][j], t = uv ? uv(i, j) : [0, 0];
        w.v(p[0], p[1], p[2], n[0], n[1], n[2], t[0], t[1], Mt);
      }
    }
    for (let i = 0; i < ni - 1; i++) for (let j = 0; j < nj - 1; j++) {
      const a = base + i * nj + j, b = a + 1, c = a + nj, d = c + 1;
      // 繞向跟著法線
      const P = G[i][j], Q = G[i + 1][j], R = G[i][j + 1];
      const e1 = [Q[0] - P[0], Q[1] - P[1], Q[2] - P[2]], e2 = [R[0] - P[0], R[1] - P[1], R[2] - P[2]];
      const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], n = N[i][j];
      if (fn[0] * n[0] + fn[1] * n[1] + fn[2] * n[2] >= 0) w.i.push(a, c, d, a, d, b); else w.i.push(a, d, c, a, b, d);
    }
  }
  // 貼紙小方片 (mode 2 貼圖)：中心 c、沿 u 方向半長 au、沿 v 方向半長 av、法線 n (稍微浮在表面上)、貼圖範圍 [u0, v0, u1, v1]
  function decal(w, c, au, av, n, uvr, Mt) {
    const P = (su, sv) => [c[0] + au[0] * su + av[0] * sv + n[0] * 0.0006, c[1] + au[1] * su + av[1] * sv + n[1] * 0.0006, c[2] + au[2] * su + av[2] * sv + n[2] * 0.0006];
    const [u0, v0, u1, v1] = uvr, base = w.vcount;
    for (const [su, sv, u, v] of [[-1, -1, u0, v1], [1, -1, u1, v1], [1, 1, u1, v0], [-1, 1, u0, v0]]) { const p = P(su, sv); w.v(p[0], p[1], p[2], n[0], n[1], n[2], u, v, Mt); }
    // 正面朝 n
    const e1 = [au[0] * 2, au[1] * 2, au[2] * 2], e2 = [av[0] * 2, av[1] * 2, av[2] * 2];
    const fz = e1[1] * e2[2] - e1[2] * e2[1], fy = e1[2] * e2[0] - e1[0] * e2[2], fx = e1[0] * e2[1] - e1[1] * e2[0];
    if (fx * n[0] + fy * n[1] + fz * n[2] >= 0) w.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else w.i.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }

  // ------------------------------------------------------------------ 主程式
  function build(o) {
    if (!canvas && typeof document !== 'undefined') canvas = drawTexture();   // 先畫字樣 (量字寬給貼紙用)
    const w = new MeshBuilder(), cal = new MeshBuilder();
    const R = o.R, Wd = o.Wd, h = Wd / 2;
    const RW = o.RW, sh = R - RW;
    const rim = metalize(o.rim || MAT.rim, 'lip'), rimDark = metalize(o.rimDark || MAT.rimDark, 'barrel');
    const spokeM = metalize(o.spokeMat || o.rim || MAT.rim, 'spoke'), edgeM = metalize(o.edgeMat || o.spokeMat || o.rim || MAT.rim, 'spoke'), sideM = metalize(o.sideMat || o.rimDark || MAT.rimDark, 'barrel');
    const seg = 64;
    const semi = o.tread === 'semi', sport = o.tread === 'sport';

    // ================= 輪胎 =================
    // 斷面 (外側 x > 0 的一半；內側鏡射)：胎冠 → 胎肩圓角 → 胎壁 (鼓起) → 字樣帶 → 護圈肋 → 胎唇
    const crown = (x) => R - 0.0045 * sq(x / h);
    const shoulderR = semi ? 0.009 : 0.013;
    const half = [[0, crown(0)]];
    const grooves = sport ? [0, h * 0.5] : semi ? [h * 0.32] : [h * 0.22, h * 0.56];
    const gw = sport ? 0.0085 : 0.0065, gd = semi ? 0.004 : 0.0075;
    for (const g of grooves) {
      if (g === 0) { half[0] = [0, crown(0) - gd, W.groove]; half.push([gw - 0.0015, crown(0) - gd, W.groove], [gw, crown(gw)]); continue; }
      half.push([g - gw, crown(g - gw)], [g - gw + 0.0015, crown(g) - gd, W.groove], [g + gw - 0.0015, crown(g) - gd, W.groove], [g + gw, crown(g + gw)]);
    }
    const xs0 = h - shoulderR;
    half.push([xs0 - 0.004, crown(xs0 - 0.004)]);
    for (let k = 1; k <= 4; k++) { const a = (k / 4) * (Math.PI / 2); half.push([xs0 + Math.sin(a) * shoulderR, crown(xs0) - shoulderR + Math.cos(a) * shoulderR]); }
    // 胎壁：往外鼓 (最寬處在胎壁中段)，接著字樣帶、護圈肋、胎唇
    const bulge = Math.min(0.009, sh * 0.09), wallTop = crown(xs0) - shoulderR;
    const wallX = (r) => h + bulge * Math.sin(Math.PI * c01((wallTop - r) / Math.max(0.01, wallTop - RW - 0.012)));
    const wallPts = [];
    for (let k = 1; k <= 8; k++) { const r = wallTop - (wallTop - (RW + 0.02)) * (k / 8); wallPts.push([wallX(r), r, k >= 3 && k <= 6 ? W.wall : W.tire]); }
    half.push(...wallPts);
    half.push([h + 0.0035, RW + 0.016, W.wall], [h + 0.006, RW + 0.012, W.wall], [h + 0.004, RW + 0.007], [h - 0.006, RW + 0.004], [h - 0.014, RW + 0.002]);
    revolve(w, half.slice(1).reverse().map(([x, r, m]) => [-x, r, m]).concat(half), semi ? W.tireSemi : W.tire, seg);
    // 胎肩橫向溝 (運動胎 / 原廠；半熱熔胎幾乎沒有)
    const nLat = semi ? 0 : sport ? 48 : 64;
    for (let k = 0; k < nLat; k++) {
      const a = (k / nLat) * TAU, ca = Math.cos(a), sa = Math.sin(a), t = [0, -sa, ca], rr = [0, ca, sa];
      for (const sg of [-1, 1]) {
        const x0 = sg * (h - 0.04), x1 = sg * (xs0 + shoulderR * 0.55), xm = (x0 + x1) / 2, r = crown(Math.abs(xm)) + 0.0004;
        decal(w, [xm, ca * r, sa * r], [(x1 - x0) / 2, 0, 0], [0, t[1] * 0.0022, t[2] * 0.0022], rr, [0, 0, 0, 0], W.groove);
      }
    }
    // 胎壁字樣：外側胎壁的一圈環帶 (貼圖第 0 / 1 / 2 列，繞一圈重複兩次)
    {
      const row = semi ? 2 : sport ? 1 : 0, [v0, v1] = rowV(row);
      const r0 = RW + sh * 0.36, r1 = Math.min(RW + sh * 0.6, r0 + 0.026), mt = o.letters || semi || sport ? W.decal : M('#262626', 0.55, 0, 2);   // 原廠胎：黑底深灰模壓字
      const n = 96, base = w.vcount;
      for (let k = 0; k <= n; k++) {
        const a = -(k / n) * TAU, ca = Math.cos(a), sa = Math.sin(a), u = (k / n) * 2;
        for (const [r, v] of [[r0, v1], [r1, v0]]) w.v(wallX(r) + 0.0011, ca * r, sa * r, 1, 0, 0, u, v, mt);
      }
      for (let k = 0; k < n; k++) { const a = base + k * 2; w.i.push(a, a + 2, a + 3, a, a + 3, a + 1); }
    }

    // ================= 輪輞 =================
    // J 型捲邊：亮面車削；step = 階梯外唇 (多片式)；dish = 外唇到輻條面的深度
    const xl = h - 0.009, dish = o.dish !== undefined ? o.dish : 0.022, xs = xl - dish, rb = RW - 0.016;
    const lip = [[xl - 0.013, RW + 0.012], [xl - 0.007, RW + 0.0142], [xl - 0.002, RW + 0.0128], [xl + 0.0004, RW + 0.009], [xl, RW + 0.004], [xl - 0.0006, RW - 0.002]];
    if (o.step) lip.push([xl - 0.002, RW - 0.0085], [xl - 0.012, RW - 0.0095], [xl - 0.0135, RW - 0.012], [xl - 0.017, RW - 0.0145], [xs + 0.002, rb + 0.0005], [xs, rb]);
    else lip.push([xl - 0.0035, RW - 0.0105], [xl - 0.008, rb + 0.002], [xs, rb]);
    revolve(w, lip, rim, seg);
    // 輪輞內側：輻條後面先往內，再一道中央凹槽 (drop center)，到內側輪緣
    const dc = Math.max(0.01, Math.min(0.022, sh * 0.18));
    revolve(w, [[xs, rb], [xs - 0.012, rb - 0.003], [xs - 0.03, rb - 0.004], [Math.max(-h + 0.06, xs - 0.05), rb - 0.004], [Math.max(-h + 0.05, xs - 0.06), rb - dc], [-h + 0.035, rb - dc], [-h + 0.025, rb - 0.004], [-h + 0.012, RW - 0.006], [-h + 0.009, RW + 0.01]], rimDark, seg);
    // 多片式：外唇與中心盤之間的一圈固定螺絲 (墊片 + 六角頭 + 內六角孔)
    if (o.bolts) {
      const n = o.bolts.n || 36, rr = rb - 0.0085, bm = metalize(o.bolts.mat || MAT.bolt, 'lip');
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU, y = Math.cos(a) * rr, z = Math.sin(a) * rr;
        revolveAt(w, y, z, [[xs - 0.0015, 0.0058], [xs + 0.0012, 0.0058], [xs + 0.0012, 0.0045], [xs + 0.0052, 0.0045], [xs + 0.0058, 0.0036], [xs + 0.0058, 0.0019, W.vent], [xs + 0.0035, 0.0019, W.vent], [xs + 0.0035, 0, W.vent]], bm, 6, a);
      }
    }

    // ================= 輪轂 =================
    const lugs = o.lugs || 5, rl = RW > 0.2 ? 0.057 : 0.05;
    const rh = Math.max(RW * 0.34, rl + 0.03), xh = xs - (o.concave || 0), bevel = o.bevel || 0.004;
    const ts0 = 0.026;
    // 輪轂面：外緣一圈車削倒角 → 平面 → 微微隆起往中心蓋
    revolve(w, [[xh - ts0, rh + 0.002], [xh - 0.004, rh + 0.002], [xh, rh - 0.002, metalize(MAT.machined, 'lip')], [xh + 0.0005, rh - 0.006, spokeM], [xh + 0.0012, rl + 0.022], [xh + 0.0012, rl - 0.022], [xh + 0.002, 0.04]], spokeM, seg);
    // 螺帽座 (凹進去) + 六角螺帽
    const lugM = o.lugMat || W.chrome;
    for (let k = 0; k < lugs; k++) {
      const a = ((k + 0.5) / lugs) * TAU, y = Math.cos(a) * rl, z = Math.sin(a) * rl;
      revolveAt(w, y, z, [[xh + 0.0013, 0.0155], [xh - 0.0015, 0.0148], [xh - 0.0105, 0.0138], [xh - 0.0105, 0.0115]], W.pocket, 20);
      revolveAt(w, y, z, [[xh - 0.0105, 0.0102], [xh - 0.004, 0.0102], [xh + 0.0055, 0.0102], [xh + 0.0075, 0.0088], [xh + 0.0082, 0.006], [xh + 0.0082, 0]], lugM, 6, a);
    }
    // 中心蓋：小圓頂 + 徽章
    const capR = Math.min(0.036, rl - 0.016);
    revolve(w, [[xh + 0.002, 0.04], [xh + 0.0035, capR + 0.002], [xh + 0.007, capR], [xh + 0.0095, capR * 0.8], [xh + 0.0105, 0]], metalize(o.cap || (o.style === 'multi' ? o.rimDark || MAT.rimDark : MAT.chrome), 'spoke'), 32);
    {
      const ci = o.capLogo !== undefined ? o.capLogo : 3, u0 = (ci * 256 + 8) / 1024, u1 = (ci * 256 + 248) / 1024, v0 = (512 + 8) / 1024, v1 = (512 + 248) / 1024;
      const r = capR * 0.78;
      decal(w, [xh + 0.0106, 0, 0], [0, 0, -r], [0, r, 0], [1, 0, 0], [u0, v0, u1, v1], W.decal);   // 從外面看：u 往右 (-z)、v 往上 (+y)
    }
    // 氣嘴
    {
      const ns = o.spokes || 6, a = (0.5 / ns) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      w.cyl([xs + 0.001, ca * (rb - 0.003), sa * (rb - 0.003)], [xs + 0.014, ca * (rb - 0.012), sa * (rb - 0.012)], 0.004, 0.0034, 10, W.valve, true);
      w.cyl([xs + 0.014, ca * (rb - 0.012), sa * (rb - 0.012)], [xs + 0.021, ca * (rb - 0.016), sa * (rb - 0.016)], 0.0036, 0.0036, 10, W.valveCap, true);
    }

    // ================= 輻條 =================
    // 斷面：back 背面 → 側面 → 圓角 / 倒角 → 正面 (可微凸) → 另一側；section：round | soft | sharp
    const section = o.section || (o.style === 'multi' ? 'soft' : 'soft');
    const crownAmt = o.crown !== undefined ? o.crown : section === 'round' ? 0.0022 : 0;
    const cornerN = section === 'sharp' ? 1 : 3;
    const pw = o.profile || 1.7;                                    // 凹度曲線的次方 (越大 = 越靠外才翹起來)
    const fx = (r) => xh + (xs - xh) * Math.pow(c01((r - rh) / (rb - rh)), pw);
    const r0 = rh * 0.92, r1 = rb + 0.004;
    const fillet = o.fillet !== undefined ? o.fillet : 0.006;      // 兩端圓角過渡的加寬量
    const NS = 12;
    // cp：橫向偏移隨半徑變化的次方 (雙肋 0.85 = 一離開輪轂就分開；網狀 1 = 直線斜出去才會交叉成菱形)
    function spoke(ca, sa, c0, c1, w0, w1, rEnd, deco, cp) {
      const cb = -sa, sb = ca, re = rEnd || r1, cpw = cp || 0.85;
      const P = (r, s, x) => [x, ca * r + cb * s, sa * r + sb * s];
      const G = [], cen = [];
      for (let i = 0; i <= NS; i++) {
        const t = i / NS, r = r0 + (re - r0) * t;
        const c = c0 + (c1 - c0) * Math.pow(t, cpw);
        const hw = w0 + (w1 - w0) * t + fillet * (1 - sst(0, 0.2, t)) + fillet * 0.8 * sst(0.84, 1, t);
        const f = fx(r), ts = ts0 * (1.18 - 0.4 * t);
        const bv = Math.min(section === 'sharp' ? bevel * 0.6 : section === 'round' ? Math.max(bevel, hw * 0.42) : bevel, hw * 0.48);
        // 斷面點 (s, x)
        const sec = [[-hw, f - ts], [-hw, f - bv - ts * 0.35]];
        for (let k = 0; k <= cornerN; k++) { const a = (k / cornerN) * (Math.PI / 2); sec.push([-hw + bv * (1 - Math.cos(a)), f - bv + bv * Math.sin(a)]); }
        const nf = 5;
        for (let k = 1; k < nf; k++) { const s = -hw + bv + (2 * (hw - bv) * k) / nf; sec.push([s, f + crownAmt * (1 - sq(s / Math.max(hw, 1e-4)))]); }
        for (let k = cornerN; k >= 0; k--) { const a = (k / cornerN) * (Math.PI / 2); sec.push([hw - bv * (1 - Math.cos(a)), f - bv + bv * Math.sin(a)]); }
        sec.push([hw, f - bv - ts * 0.35], [hw, f - ts]);
        G.push(sec.map(([s, x]) => P(r, c + s, x)));
        cen.push(P(r, c, f - ts * 0.5));
      }
      sheet(w, G, spokeM, (i, j, p) => { const q = cen[i]; return [p[0] - q[0], p[1] - q[1], p[2] - q[2]]; });
      // 材質：正面 spokeM、圓角 / 倒角 edgeM、側面 sideM —— sheet 只給一種材質，這裡逐頂點覆寫
      const vEnd = w.vcount, nj = G[0].length, vStart = vEnd - (NS + 1) * nj;
      for (let i = 0; i <= NS; i++) for (let j = 0; j < nj; j++) {
        const m = j < 2 || j >= nj - 2 ? sideM : j < 2 + cornerN + 1 || j >= nj - 2 - cornerN - 1 ? edgeM : spokeM;
        const vi = vStart + i * nj + j;
        w.c[vi * 4] = m.c[0]; w.c[vi * 4 + 1] = m.c[1]; w.c[vi * 4 + 2] = m.c[2]; w.c[vi * 4 + 3] = m.r;
        w.x[vi * 4] = m.m; w.x[vi * 4 + 1] = m.e; w.x[vi * 4 + 2] = m.mode; w.x[vi * 4 + 3] = m.night;
      }
      // 肋中央的切削溝 (鍛造)：正面中間一條略低、顏色較深的帶
      if (deco && deco.channel) {
        const CG = [];
        for (let i = 2; i <= NS - 2; i++) {
          const t = i / NS, r = r0 + (re - r0) * t, c = c0 + (c1 - c0) * Math.pow(t, 0.85), hw = (w0 + (w1 - w0) * t) * 0.3, f = fx(r) + 0.0006;
          CG.push([P(r, c - hw, f), P(r, c - hw * 0.6, f - 0.0012), P(r, c + hw * 0.6, f - 0.0012), P(r, c + hw, f)]);
        }
        sheet(w, CG, deco.channel, () => [1, 0, 0]);
      }
      // 肋上的貼紙：細長條沿肋的長邊讀 (字從輪轂往外)，長寬比跟字串一樣才不會被壓扁；貼在正面最外段 (那段比較平)
      if (deco && deco.text) {
        const [v0, v1] = rowV(deco.text), t0 = 0.42, t1 = 0.9, asp = TEXT_ASP[deco.text] || 8;
        const ra = r0 + (re - r0) * t0, rbb = r0 + (re - r0) * t1, rm = (ra + rbb) / 2, cm = c0 + (c1 - c0) * Math.pow((t0 + t1) / 2, cpw);
        const L = (rbb - ra) / 2, f = (fx(ra) + fx(rbb)) / 2 + 0.0012;
        // 沿肋方向要跟著凹度往外翹：用兩端的深度差把貼紙斜著放
        const dz = (fx(rbb) - fx(ra)) / 2;
        decal(w, P(rm, cm, f), [dz, ca * L, sa * L], [0, cb * (L / asp), sb * (L / asp)], [1, 0, 0], [TEXT_U[deco.text][0], v0, TEXT_U[deco.text][1], v1], W.decal);
      }
    }
    const ns = o.spokes || 6, mesh = o.style === 'mesh', twin = o.style !== 'multi' && !mesh;
    const sws = o.sw || (mesh ? [0.0048, 0.0056] : twin ? [0.0095, 0.0115] : [0.012, 0.016]), split = o.split || [0.021, 0.035];
    for (let s = 0; s < ns; s++) {
      const a = (s / ns) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const deco = { channel: o.channel ? metalize(o.channel, 'spoke') : null, text: o.spokeText && s % 3 === 0 ? (o.spokeText === true ? 3 : o.spokeText) : 0 };
      if (mesh) {
        // 交叉網狀：每個方向往左右各斜出一支細肋，直線斜到隔壁方向的位置，在半徑中段和隔壁的肋交叉成菱形；交叉點有結點
        const da = TAU / ns, c1 = r1 * Math.sin(da), rEnd = r1 * Math.cos(da);
        for (const sg of [-1, 1]) spoke(ca, sa, 0, sg * c1, sws[0], sws[1], rEnd, null, 1);
        // 交叉點：這支往 + 斜的肋和下一個方向往 − 斜的肋，在兩個方向的角平分線上相遇
        const k = Math.tan(da / 2), t = (k * r0) / (c1 - k * (rEnd - r0));
        if (t > 0.05 && t < 0.95) {
          const r = r0 + (rEnd - r0) * t, c = c1 * t, cb = -sa, sb = ca, f = fx(r);
          const y = ca * r + cb * c, z = sa * r + sb * c, rn = sws[0] * 1.9;
          revolveAt(w, y, z, [[f - ts0 * 0.9, rn], [f - 0.002, rn], [f + 0.0012, rn * 0.82], [f + 0.0016, 0]], spokeM, 14);
        }
      } else if (twin) for (const sg of [-1, 1]) spoke(ca, sa, sg * split[0], sg * split[1], sws[0], sws[1], 0, sg > 0 ? deco : null);
      else spoke(ca, sa, 0, 0, sws[0], sws[1], 0, deco);
    }
    if (mesh) {
      // 網狀輪圈：外圈一道環把交叉肋的外端收起來 (接著拋光外唇)
      revolve(w, [[fx(rb) - 0.014, rb - 0.017], [fx(rb) - 0.002, rb - 0.017], [fx(rb) + 0.0005, rb - 0.013], [fx(rb), rb + 0.002]], spokeM, seg);
    }

    // ================= 碟盤 =================
    const big = (o.pistons || 1) >= 2;
    const calOut = big ? 0.03 : 0.024, td = 0.022;
    const xb = Math.min(xh, xs) - bevel - ts0 * 1.18 - 0.001;
    const rD = Math.min(o.disc || RW * 0.74, RW - 0.046), xd = xb - 0.004 - calOut;
    const rHat = Math.min(rD - 0.05, rl + 0.03);
    // 摩擦面 (同心車削紋) → 外緣 → 風道 (兩片摩擦盤中間) → 內側摩擦盤
    revolve(w, [[xd, rD - 0.002, W.discEdge], [xd, rD - 0.004, W.disc], [xd, rHat + 0.01], [xd, rHat + 0.003, W.discEdge]], W.disc, seg);
    revolve(w, [[xd - td, rHat * 0.8], [xd - td, rD]], W.disc, seg);
    revolve(w, [[xd - td, rD], [xd - td * 0.68, rD], [xd - td * 0.68, rD - 0.0012, W.vent], [xd - td * 0.32, rD - 0.0012, W.vent], [xd - td * 0.32, rD], [xd, rD]], W.discEdge, seg);
    // 風道的導流片 (從外緣看得到的小肋)
    for (let k = 0; k < 36; k++) {
      const a = (k / 36) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      w.boxAxes([xd - td * 0.5, ca * (rD - 0.0008), sa * (rD - 0.0008)], [td * 0.18, 0, 0], [0, ca * 0.0012, sa * 0.0012], [0, -sa * 0.0016, ca * 0.0016], W.discEdge);
    }
    const hatM = o.float ? metalize(o.float.hat, 'spoke') : W.hatAlu;
    revolve(w, [[xd, rHat], [xb + 0.004, rHat]], hatM, seg);
    revolve(w, [[xd + 0.0012, rHat + 0.004], [xd + 0.0012, rl + 0.02]], hatM, seg);
    if (o.float) for (let k = 0; k < 10; k++) {
      const a = ((k + 0.5) / 10) * TAU, y = Math.cos(a) * (rHat + 0.004), z = Math.sin(a) * (rHat + 0.004);
      revolveAt(w, y, z, [[xd - 0.002, 0.0055], [xd + 0.0035, 0.0055], [xd + 0.0042, 0.0045], [xd + 0.0042, 0]], W.bobbin, 10);
    }
    if (o.drilled) for (let k = 0; k < 24; k++) {
      for (let j = 0; j < 3; j++) {
        const r = rHat + 0.016 + (rD - rHat - 0.026) * (j / 2), a = (k / 24) * TAU + j * 0.07;
        revolveAt(w, Math.cos(a) * r, Math.sin(a) * r, [[xd + 0.0009, 0.0042, W.discEdge], [xd + 0.0002, 0.0036, W.drill], [xd - 0.004, 0.0036], [xd - 0.004, 0]], W.drill, 10);
      }
    }
    if (o.slots) for (let k = 0; k < o.slots; k++) {
      const a0 = (k / o.slots) * TAU, hw = 0.0017;
      const SG = [];
      for (let j = 0; j <= 6; j++) {
        const t = j / 6, r = rHat + 0.008 + (rD - rHat - 0.014) * t, a = a0 + t * 0.55, ca = Math.cos(a), sa = Math.sin(a);
        SG.push([[xd + 0.0008, ca * r + sa * hw, sa * r - ca * hw], [xd + 0.0008, ca * r - sa * hw, sa * r + ca * hw]]);
      }
      sheet(w, SG, W.drill, () => [1, 0, 0]);
    }

    // ================= 卡鉗 (不隨輪子轉，做在 12 點鐘方向) =================
    const calM = metalize(o.caliper || MAT.caliper, 'spoke'), cs = o.calScale || 1, phi = (big ? 0.5 : 0.36) * cs;
    const xo = xd + calOut, xi = xd - td - 0.034, rc0 = rD - (big ? 0.056 : 0.044) * cs, rc1 = Math.min(rD + 0.017, rb - 0.007);
    // 鉗體：沿碟盤外緣的弧形，斷面圓角 (sheet)，兩端收圓
    {
      const NA = 16, ch = 0.008, rr = (rc0 + rc1) / 2;
      const G = [], cen = [];
      for (let k = 0; k <= NA; k++) {
        const u = k / NA, th = -phi + 2 * phi * u, ct = Math.cos(th), st = Math.sin(th);
        const s = 0.012 * (1 - sst(0, 0.18, Math.min(u, 1 - u)));   // 兩端內縮 = 收圓
        const sec = [];
        // 斷面 (x, r)：內側 → 頂面 → 外側 → 底面，四角圓角
        const corners = [[xi + s, rc0 + s], [xi + s, rc1 - s], [xo - s, rc1 - s], [xo - s, rc0 + s]];
        const dirs = [[-1, -1], [-1, 1], [1, 1], [1, -1]];
        for (let c = 0; c < 4; c++) {
          const [cx0, cr0] = corners[c], [dx, dr] = dirs[c];
          const a0 = Math.atan2(dr, dx) - Math.PI / 4;
          for (let q = 0; q <= 2; q++) {
            const a = a0 + (q / 2) * (Math.PI / 2);
            sec.push([cx0 - dx * ch + Math.cos(a) * ch, cr0 - dr * ch + Math.sin(a) * ch]);
          }
        }
        sec.push(sec[0]);
        G.push(sec.map(([x, r]) => [x, r * ct, r * st]));
        cen.push([(xi + xo) / 2, rr * ct, rr * st]);
      }
      sheet(cal, G, calM, (i, j, p) => { const q = cen[i]; return [p[0] - q[0], p[1] - q[1], p[2] - q[2]]; });
      // 兩端封口
      for (const k of [0, NA]) {
        const th = -phi + 2 * phi * (k / NA), n = [0, -Math.sin(th) * (k ? -1 : 1), Math.cos(th) * (k ? -1 : 1)];
        const ring = G[k], base = cal.vcount, c = cen[k];
        cal.v(c[0], c[1], c[2], n[0], n[1], n[2], 0, 0, calM);
        for (const p of ring) cal.v(p[0], p[1], p[2], n[0], n[1], n[2], 0, 0, calM);
        for (let j = 1; j < ring.length; j++) {
          const A = ring[j - 1], B = ring[j];
          const e1 = [A[0] - c[0], A[1] - c[1], A[2] - c[2]], e2 = [B[0] - c[0], B[1] - c[1], B[2] - c[2]];
          const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
          if (f[0] * n[0] + f[1] * n[1] + f[2] * n[2] >= 0) cal.i.push(base, base + j, base + j + 1); else cal.i.push(base, base + j + 1, base + j);
        }
      }
    }
    // 活塞座 (外側凸起)、來令片開窗、字樣、放氣螺絲
    const rm = (rc0 + rc1) / 2 - 0.003;
    const pist = o.pistons >= 3 ? [-phi * 0.64, 0, phi * 0.64] : big ? [-phi * 0.58, phi * 0.58] : [0];
    for (const th of pist) {
      const y = rm * Math.cos(th), z = rm * Math.sin(th), pr = o.pistons >= 3 ? 0.0145 : big ? 0.016 : 0.019;
      revolveAt(cal, y, z, [[xo - 0.004, pr], [xo + 0.004, pr], [xo + 0.0068, pr * 0.9], [xo + 0.0072, 0]], calM, 20);
    }
    {
      const base = cal.vcount, x0 = xd - td - 0.007, x1 = xd + 0.007, r = rc1 + 0.0006, N = 8;
      for (let k = 0; k <= N; k++) {
        const th = -phi * 0.55 + (phi * 1.1 * k) / N, ct = Math.cos(th), st = Math.sin(th);
        cal.v(x0, r * ct, r * st, 0, ct, st, 0, 0, W.pad);
        cal.v(x1, r * ct, r * st, 0, ct, st, 0, 0, W.pad);
      }
      for (let k = 0; k < N; k++) { const a = base + k * 2; cal.i.push(a, a + 2, a + 3, a, a + 3, a + 1); }
    }
    if (big && o.logo !== false) {
      // 字樣：外側面、沿著弧的方向 (六活塞放在活塞上方那一帶)
      const row = o.pistons >= 3 ? 6 : 5, [v0, v1] = rowV(row), rr = o.pistons >= 3 ? rc1 - 0.0095 : rm, L = 0.024 * cs;
      decal(cal, [xo + 0.0004, rr, 0], [0, 0, -L], [0, L / TEXT_ASP[row], 0], [1, 0, 0], [TEXT_U[row][0], v0, TEXT_U[row][1], v1], W.decal);
    }
    cal.cyl([xi + 0.006, rc1 - 0.004, phi * rc1 * 0.75], [xi + 0.006, rc1 + 0.006, phi * rc1 * 0.75], 0.0032, 0.0028, 8, W.bleed, true);

    return { wheel: w, caliper: cal };
  }

  RM.WheelBuilder = { build, texture, metalize, MAT: W };
})();
