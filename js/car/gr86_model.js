'use strict';
// Toyota GR86 (ZN8, 2021-) 程序化模型 —— 作法見 proc_car.js
// 車身座標：-z = 車頭，x = 右，y = 離地高度；全長 4265 / 寬 1775 / 高 1310 / 軸距 2575 mm，215/40R18
(function () {
  const RM = window.RM;
  const PC = RM.ProcCar;
  const { MeshBuilder } = RM;
  const { c01, sq, sstep, pn, rmax, smin, softPos, spline, lin, MAT } = PC;

  const MAP = {
    XC: 0.6, ZC: 1.8, RC: 0.28, XCF: 0.55, ZCF: -1.75, RCF: 0.32, UMAX: 5.7, Y0: 0.05, Y1: 1.36, Z0: -2.2, Z1: 2.2, XMAX: 0.95,
    AXF: -1.2775, AXR: 1.2975, ARF: 0.355, AYF: 0.32, ARR: 0.355, AYR: 0.32, ARCH_IN: 0.52,
  };
  const INFO = PC.mapInfo(MAP);
  const DROP = 0.02;
  const TIRE_R = 0.3146;

  // ------------------------------------------------------------------ 車身外形 (隱式)
  // 對照實車的重點：
  //   · 座艙往車尾收窄很多 (俯視像水滴)，所以後輪上方露出又寬又圓的葉子板肩膀 —— GR86 車尾的肌肉感主要來自這裡
  //   · 車頂弧線一路溜到很短的行李廂蓋，尾端整條上翹成一體式鴨尾；車尾立面上緣前傾 (鴨尾後緣比保桿最凸處靠前約 10 cm)
  //   · 前後輪拱外擴、車門處收腰；前葉子板出風口往後有一道漸淡的凹面
  // 下車身頂面中心線：低車頭 → 長引擎蓋 → 腰線往後上揚 → 短行李廂蓋 (鴨尾另外加)
  const ylS = spline([[-2.16, 0.6], [-2.07, 0.66], [-1.85, 0.724], [-1.4, 0.808], [-1.0, 0.868], [-0.68, 0.908], [-0.2, 0.922], [0.5, 0.95], [1.0, 0.985], [1.35, 1.0], [1.7, 0.996], [1.86, 0.993], [2.16, 0.993]]);
  const ybS = spline([[-2.16, 0.2], [-1.95, 0.165], [-1.7, 0.15], [1.45, 0.15], [1.75, 0.18], [1.95, 0.215], [2.16, 0.27]]);
  // 車尾側面輪廓 z(y)：擴散器內收 → 保桿最凸 → 行李廂蓋立面 (往上前傾) → 黑色飾條處微凹 → 鴨尾後緣
  const ZrS = spline([[0.14, 1.93], [0.24, 2.03], [0.31, 2.09], [0.39, 2.122], [0.47, 2.1325], [0.6, 2.1325], [0.67, 2.124], [0.72, 2.11], [0.8, 2.084], [0.9, 2.05], [0.955, 2.032], [0.99, 2.034], [1.03, 2.04], [1.1, 2.038]]);
  // 車頭側面輪廓：低而尖的鼻頭
  const ZfS = spline([[0.12, -1.95], [0.2, -2.06], [0.27, -2.115], [0.36, -2.1325], [0.46, -2.1325], [0.52, -2.126], [0.58, -2.112], [0.64, -2.088], [0.69, -2.04], [0.75, -1.94], [0.9, -1.7]]);
  // 俯視半寬 (不含輪拱外擴)：前後輪拱處寬、車門處收腰、頭尾收窄。加上 flare 後輪拱最寬處 = 全寬的一半 0.8875
  const WzS = spline([[-2.2, 0.77], [-1.95, 0.836], [-1.6, 0.862], [-1.28, 0.866], [-0.9, 0.858], [-0.2, 0.848], [0.4, 0.85], [0.9, 0.86], [1.3, 0.864], [1.65, 0.858], [1.9, 0.836], [2.2, 0.78]]);
  // 車頂中心線：最高點在駕駛頭頂，之後一路溜下去 (fastback)
  const yrS = spline([[-0.35, 1.26], [-0.05, 1.291], [0.2, 1.307], [0.45, 1.31], [0.75, 1.296], [1.0, 1.264], [1.25, 1.205], [1.5, 1.122], [1.8, 1.005]]);

  const YM = 0.55, ZC_R = 1.45, ZC_F = -1.45, YGB = 0.82;
  const gauss = (d, w) => Math.exp(-sq(d / w));
  // 輪拱外擴：開口邊緣的捲邊 + 整片葉子板的鼓出 (後輪較明顯)
  const flare = PC.archFlare(MAP, { lipF: 0.007, lipR: 0.008, lipW: 0.05, blF: 0.014, blR: 0.018, blW: 0.26 });

  const Wz = (z) => WzS(z);
  function Ws(y, z) {
    const d = y - 0.58;
    let w = WzS(z) + flare(y, z) - (d < 0 ? 0.045 * sq(d / 0.4) : 0.04 * sq(d / 0.38));
    // 肩線：由前葉子板經門把上方到尾燈翼尖的一道稜線，以上的鈑件往內倒得比較快
    const sh = sstep(-1.7, -1.0, z) * sstep(1.95, 1.5, z);
    if (sh > 0) w -= 0.075 * sh * softPos(y - (0.815 + 0.06 * sstep(-0.6, 1.4, z)));
    // 車門下半的凹面：由前葉子板出風口往後延伸、逐漸變淺。上緣是一道往後下斜的稜線 (坡度轉折 → 反射在這裡斷開)
    const sc = sstep(-0.98, -0.72, z) * sstep(0.8, 0.1, z);
    if (sc > 0) { const yc = 0.63 - 0.16 * c01((z + 0.8) / 1.5); w -= 0.016 * sc * sstep(yc + 0.025, yc - 0.05, y) * sstep(0.19, 0.3, y); }
    return w;
  }
  const haunch = (z) => sstep(0.55, 1.0, z) * sstep(2.05, 1.65, z);
  function Tl(ax, z) {
    const hood = sstep(-0.62, -0.95, z), deck = sstep(1.5, 1.75, z);
    let y = ylS(z) - (0.022 + 0.012 * hood + 0.008 * deck) * sq(ax / 0.88);
    if (hood > 0) {
      const fade = hood * sstep(-2.13, -1.8, z);
      y += 0.03 * gauss(ax - 0.74, 0.11) * fade * (0.6 + 0.4 * gauss(z + 1.28, 0.5));   // 葉子板稜線 (輪拱正上方最高)
      // 引擎蓋中央隆起：兩條往車頭收攏的稜線之間整片墊高
      const xc = 0.24 + 0.2 * c01((z + 2.05) / 1.35);
      y += 0.012 * fade * sstep(xc + 0.035, xc - 0.035, ax);
    }
    y += 0.028 * gauss(ax - 0.79, 0.12) * haunch(z);                       // 後葉子板隆起
    if (z > 1.75) y += 0.05 * sstep(1.8, 2.0, z) * sstep(0.9, 0.7, ax);    // 一體式鴨尾：後緣整條上翹，近車角才收平
    return y;
  }
  function sdLower(ax, y, z) {
    const a = ax / Ws(y, z);
    let b = 0, np = 5;      // 車尾角比車頭方 (車頭 3.6)
    if (z > ZC_R) b = (z - ZC_R) / (ZrS(y) - 0.05 * sq(ax / 0.88) - ZC_R);
    else if (z < ZC_F) { b = (ZC_F - z) / (ZC_F - ZfS(y) - 0.07 * sq(ax / 0.88)); np = 3.6; }
    const dP = (pn(a, b, np) - 1) * 0.8;
    if (y > YM) {
      // 肩線圓角：引擎蓋較圓、車門俐落、後葉子板的肩膀最圓，鴨尾後緣最銳
      const R = 0.07 - 0.018 * sstep(-1.0, -0.6, z) + 0.025 * haunch(z) - 0.05 * sstep(0.8, 0.97, b);
      return rmax(dP, y - Tl(ax, z), R);
    }
    return rmax(dP, ybS(z) - y, 0.085);
  }
  const ySill = (z) => 0.905 + 0.075 * sstep(-0.5, 1.3, z);   // 車窗下緣 (往後上揚)
  // 座艙相對車身側面內縮的量：往車尾越縮越多 (俯視水滴形)
  const gIn = (z) => 0.07 + 0.115 * sstep(0.3, 1.6, z) + 0.02 * sstep(0.0, -0.7, z);
  function Wg(y, z) {
    const dy = softPos(y - ySill(z));
    return WzS(z) - gIn(z) - 0.42 * dy - 0.36 * dy * dy;
  }
  const zWs = (y, ax) => -0.66 + (y - 0.905) * 1.95 + 0.26 * ax * ax;    // 前擋玻璃面
  const zRg = (y, ax) => 1.71 - (y - 0.995) * 2.85 - 0.25 * ax * ax;     // 後擋玻璃面 (很斜)
  const yRoof = (ax, z) => yrS(z) - 0.03 * sq(ax / 0.6);
  function sdGreen(ax, y, z) {
    const dz = Math.max(zWs(y, ax) - z, z - zRg(y, ax));
    const dP = rmax(ax - Wg(y, z), dz, 0.06 + 0.06 * sstep(0.7, 1.2, z));   // C 柱比 A 柱圓得多 (流進後葉子板)
    const d = rmax(dP, y - yRoof(ax, z), 0.055);
    return Math.max(d, YGB - y);
  }
  function sdBody(x, y, z) {
    const ax = x < 0 ? -x : x;
    // 座艙與下車身的接合處：後段用較大的圓弧，C 柱才會順順地流進葉子板
    return smin(sdLower(ax, y, z), sdGreen(ax, y, z), 0.012 + 0.03 * sstep(0.9, 1.5, z));
  }

  const S = PC.surface(sdBody);
  const { normalAt, rearP, frontP } = S;
  const patch = (mb, chart, us, vs, off, M, uv) => PC.patch(mb, S, chart, us, vs, off, M, uv);
  const SHELL_BOX = { XO: 0.93, YB: 0.05, YT: 1.36, ZO: 2.17, WI: 0.42, YI0: 0.4, YI1: 0.6, ZI: 1.62 };

  // ------------------------------------------------------------------ 在曲面上定位燈具
  const V = RM.v3;
  const side1 = S.sideP(1);
  // 環繞帶 u (與著色器 carFS 的 wrapU 相同)
  const wrapU = (ax, z) => {
    const dz = z - MAP.ZC;
    if (dz > 0) return Math.min(ax, MAP.XC) + MAP.RC * Math.atan2(Math.max(ax - MAP.XC, 0), dz);
    const df = MAP.ZCF - z;
    if (df <= 0) return MAP.XC + MAP.RC * 1.5707963 - dz;
    return INFO.UF0 + MAP.RCF * Math.atan2(df, Math.max(ax - MAP.XCF, 1e-4)) + Math.max(MAP.XCF - ax, 0);
  };
  // 表面上的 3D 點 → 兩個投影的貼圖座標。車角、車鼻斜面兩個投影都看得到，燈具要兩邊各畫一次才接得起來
  const toBelt = (p) => [wrapU(Math.abs(p[0]), p[2]), p[1]];
  const toTop = (p) => [p[2], Math.abs(p[0])];
  // 在曲面上由 p0 沿 d0 方向「走」dist 公尺 (每一小步都投影回曲面)。
  // 車鼻是斜面接立面再繞過車角，燈的厚度要沿曲面量，只在單一投影上畫會被拉長或壓扁
  function walk(p0, d0, dist) {
    let p = p0.slice(), t = d0.slice(), n = normalAt(p);
    const N = Math.max(1, Math.ceil(dist / 0.008)), ds = dist / N;
    for (let i = 0; i < N; i++) {
      const dn = V.dot(t, n);
      t = V.norm([0, 0, 0], [t[0] - n[0] * dn, t[1] - n[1] * dn, t[2] - n[2] * dn]);
      p = [p[0] + t[0] * ds, p[1] + t[1] * ds, p[2] + t[2] * ds];
      for (let k = 0; k < 2; k++) { n = normalAt(p); const f = sdBody(p[0], p[1], p[2]); p = [p[0] - n[0] * f, p[1] - n[1] * f, p[2] - n[2] * f]; }
    }
    return p;
  }

  // 引擎蓋前緣接縫 (俯視的 z)：弧線橫過車鼻、在廠徽上方，往兩側退到葉子板稜線
  const zHood = (x) => -2.05 + 0.2155 * x * x + 0.738 * x * x * x * x;
  // 頭燈 (右側；左側鏡射)：上緣貼著引擎蓋接縫，內側收尖、外側繞上葉子板；下緣由上緣沿曲面往外走出厚度
  let HEAD = null;
  function headGeom() {
    if (HEAD) return HEAD;
    const C = [];
    for (let k = 0; k <= 10; k++) { const x = 0.35 + (0.365 * k) / 10; C.push([x, zHood(x)]); }
    for (const z of [-1.7, -1.655, -1.61, -1.585]) C.push([0.716 + (z + 1.747) * 0.06, z]);
    const n = C.length, top = [], bot = [], drl = [], dirs = [], hs = [];
    for (let k = 0; k < n; k++) {
      const a = C[Math.max(k - 1, 0)], b = C[Math.min(k + 1, n - 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1]; const tl = Math.hypot(tx, tz); tx /= tl; tz /= tl;
      const d = [tz, 0, -tx];                           // 接縫的外側 (車鼻段朝前、葉子板段朝外)
      const t = k / (n - 1);
      const h = 0.138 * sstep(0, 0.42, t) * (1 - 0.22 * sstep(0.7, 1, t)) + 0.004;
      const e = S.topP(C[k][0] + d[0] * 0.022, C[k][1] + d[2] * 0.022) || [C[k][0], 0.7, C[k][1]];
      top.push(e); dirs.push(d); hs.push(h);
      bot.push(walk(e, d, h));
    }
    // L 形日行燈：沿下緣由內往外，到外端往上勾
    const m = n - 2;
    for (let k = 1; k <= m; k++) drl.push(walk(top[k], dirs[k], Math.max(hs[k] - 0.015, 0.004)));
    for (const f of [0.62, 0.36, 0.14]) drl.push(walk(top[m], dirs[m], hs[m] * f));
    // 兩顆投射燈 (圓心, 半徑)
    const proj = [[walk(top[5], dirs[5], hs[5] * 0.47), 0.034], [walk(top[8], dirs[8], hs[8] * 0.47), 0.031]];
    // 方向燈：外端上半的一小條
    const turn = [walk(top[9], dirs[9], 0.022), walk(top[10], dirs[10], 0.022), walk(top[11], dirs[11], 0.022), walk(top[12], dirs[12], 0.022)];
    return (HEAD = { top, bot, drl, proj, turn });
  }
  // 尾燈 (右側)：內側收成刀尖、外側繞過車角，上緣外端往前伸成一道翼尖。r = 車尾立面上的點、s = 車側 (含車角) 的點
  let TAIL = null;
  function tailGeom() {
    if (TAIL) return TAIL;
    const r = (x, y) => rearP(x, y) || [x, y, 2.04], s = (z, y) => side1(z, y) || [0.84, y, z];
    return (TAIL = {
      out: [r(0.3, 0.927), r(0.44, 0.902), r(0.56, 0.852), r(0.65, 0.814), s(1.9, 0.806), s(1.83, 0.816), s(1.78, 0.85), s(1.73, 0.905), s(1.64, 0.95), s(1.76, 0.958), s(1.9, 0.958), r(0.65, 0.957), r(0.3, 0.956)],
      rad: [0.004, 0.03, 0.03, 0.03, 0.02, 0.03, 0.03, 0.02, 0.004, 0.02, 0.01, 0.01, 0.004],
      // 紅色導光條：沿燈殼外緣繞一圈
      guide: [r(0.345, 0.9405), r(0.56, 0.943), r(0.65, 0.944), s(1.9, 0.944), s(1.83, 0.942), s(1.795, 0.925), s(1.8, 0.87), s(1.83, 0.834), s(1.9, 0.822), r(0.65, 0.828), r(0.575, 0.86), r(0.45, 0.91)],
      tip: [r(0.33, 0.932), r(0.46, 0.906), r(0.5, 0.941)],
      // 導光條裡面的透明燈組 (方向燈光條 + 倒車燈)
      ins: [r(0.6, 0.928), r(0.66, 0.93), s(1.9, 0.93), s(1.845, 0.926), s(1.815, 0.905), s(1.818, 0.872), s(1.85, 0.848), s(1.9, 0.838), r(0.66, 0.842), r(0.612, 0.872)],
      turn: [r(0.62, 0.905), r(0.66, 0.905), s(1.9, 0.905), s(1.84, 0.905), s(1.84, 0.919), s(1.9, 0.919), r(0.66, 0.919), r(0.62, 0.919)],
      rev: [r(0.63, 0.858), s(1.9, 0.853), s(1.85, 0.86), s(1.85, 0.888), s(1.9, 0.888), r(0.63, 0.888)],
    });
  }

  // ------------------------------------------------------------------ 貼圖
  function buildTex(W) {
    const M = MAP;
    const K = PC.texKit(W, M);
    const { X, fill, stroke, poly, line, rect, circ, rpoly, clipTo, lgrad, rgrad, region, end, gap, qcurve } = K;
    const uz = INFO.uSide, uf = INFO.uFront;
    const HG = headGeom(), TG = tailGeom();
    const uF = (x, y) => toBelt(frontP(x, y) || [x, y, -2.05])[0], uS = (z, y) => toBelt(side1(z, y) || [0.84, y, z])[0];

    // ---- 尾燈 (兩個投影共用；俯視只需要燈殼，讓肩膀圓角上的翼尖接得起來)
    const drawTail = (pj, isTop) => {
      const P = TG.out.map(pj);
      // 俯視只畫繞到車側的那一段 (車尾立面在俯視是一條線，畫了會染到鴨尾上緣)
      if (isTop) { fill(poly(P.slice(4, 11)), { c: '#150809', r: 0.08, m: 0 }); return; }
      stroke(rpoly(P, TG.rad), 0.008, { c: '#040405', h: -3, r: 0.8, m: 0 });
      fill(rpoly(P, TG.rad), { c: lgrad(0, 0.958, 0, 0.806, [[0, '#1d0a0c'], [0.5, '#26090c'], [1, '#160607']]), r: 0.05, m: 0, h: 0.8, mask: '#100000', lens: 0.028 });
      clipTo(rpoly(P, TG.rad), () => {
        const g = X.A;
        // 透明燈組：位置最深，裡面是方向燈光條與倒車燈
        const I = TG.ins.map(pj);
        fill(rpoly(I, 0.012), { c: lgrad(0, 0.93, 0, 0.838, [[0, '#33363b'], [1, '#17181b']]), r: 0.12, m: 0.5, mask: '#0c0000', lens: 0.05 });
        clipTo(rpoly(I, 0.012), () => {
          fill(poly(TG.turn.map(pj)), { c: lgrad(0, 0.919, 0, 0.905, [[0, '#f0ead8'], [1, '#bdb7a4']]), r: 0.08, m: 0, mask: '#00d800' });
          fill(poly(TG.rev.map(pj)), { c: lgrad(0, 0.888, 0, 0.855, [[0, '#e4e8ec'], [1, '#a9afb5']]), r: 0.08, m: 0, mask: '#0000d8' });
          for (let u = 0.6; u < 1.02; u += 0.016) { g.fillStyle = 'rgba(0,0,0,0.32)'; g.fillRect(u, 0.83, 0.0028, 0.11); }
          stroke(rpoly(I, 0.012), 0.012, { c: 'rgba(0,0,0,0.55)' });
        });
        // 紅色導光條 (尾燈 / 煞車燈)：貼近透鏡表面；內側刀尖整個是紅的
        const Gd = TG.guide.map(pj);
        fill(poly(TG.tip.map(pj)), { c: '#a8121c', r: 0.08, m: 0, mask: '#e00000', lens: 0.008 });
        stroke(poly(Gd), 0.0175, { c: '#b0141e', r: 0.08, m: 0, mask: '#ff0000', lens: 0.008 });
        stroke(poly(Gd), 0.006, { c: '#ff5a50' });
        // 行李廂蓋與葉子板之間的燈殼分割線、邊緣暗角、上緣高光
        stroke(line([[0.6, 0.8], [0.6, 0.96]]), 0.0045, { c: '#040404', h: -1.5, mask: '#000000' });
        stroke(rpoly(P, TG.rad), 0.014, { c: 'rgba(0,0,0,0.4)' });
        g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(0.3, 0.95, 0.95, 0.003);
      });
    };
    // ---- 頭燈燈殼 (兩個投影共用)：投射燈與日行燈是另外的零件 (車鼻斜面在俯視投影，貼圖的燈光只對環繞帶有效)
    const drawHead = (pj, isTop) => {
      const P = HG.top.map(pj).concat(HG.bot.map(pj).reverse());
      stroke(rpoly(P, 0.01), 0.008, { c: '#040405', h: -3, r: 0.8, m: 0 });
      fill(rpoly(P, 0.01), isTop ? { c: '#0b0c0e', r: 0.07, m: 0, h: 0.8 } : { c: '#0b0c0e', r: 0.07, m: 0, h: 0.8, mask: '#0e0000', lens: 0.03 });
      clipTo(rpoly(P, 0.01), () => {
        // 燈內的鍍鉻反射碗 (投射燈周圍較亮)
        for (const [c, r] of HG.proj) {
          const q = pj(c);
          fill(circ(q[0], q[1], r * 1.9, r * 1.6), { c: rgrad(q[0], q[1], r * 1.9, [[0, 'rgba(150,156,164,0.9)'], [0.6, 'rgba(60,64,70,0.6)'], [1, 'rgba(20,22,25,0)']]) });
        }
        stroke(rpoly(P, 0.01), 0.014, { c: 'rgba(0,0,0,0.5)' });
      });
    };

    region('belt');
    const uAR = uz(M.AXR), uAF = uz(M.AXF), AR = M.ARR, AY = M.AYR;

    // ================= 車尾 =================
    {
      // 下擾流 (黑色塑膠)：兩側低、排氣管處往上包、中段平；擴散器鰭片、排氣尾管開口
      const D = [[-0.2, 0.05], [uAR - AR, 0.05], [uAR - AR, 0.17], [1.0, 0.22], [0.9, 0.32], [0.78, 0.41], [0.36, 0.41], [0.3, 0.375], [-0.2, 0.375]];
      fill(rpoly(D, [0, 0, 0, 0.05, 0.05, 0.04, 0.04, 0.03, 0]), { c: '#0d0d0f', r: 0.62, m: 0, h: -1.2 });
      for (const u of [0.13, 0.26]) fill(rpoly([[u - 0.007, 0.2], [u + 0.007, 0.2], [u + 0.007, 0.36], [u - 0.007, 0.36]], 0.005), { c: '#17171a', h: 2.5, r: 0.5 });
      fill(circ(0.5, 0.292, 0.084, 0.072), { c: '#030304', r: 0.8, m: 0, h: -7 });
      // 中央下方燈組：紅色後霧燈 + 兩側倒車燈
      fill(rpoly([[-0.2, 0.283], [0.262, 0.283], [0.252, 0.326], [-0.2, 0.326]], [0, 0.006, 0.006, 0]), { c: '#060607', r: 0.4, m: 0, h: -2 });
      fill(rect(-0.2, 0.29, 0.07, 0.32), { c: lgrad(0, 0.32, 0, 0.29, [[0, '#9a1218'], [1, '#5c070b']]), r: 0.14, m: 0, mask: '#240000', lens: 0.012 });
      fill(rect(0.078, 0.29, 0.247, 0.32), { c: lgrad(0, 0.32, 0, 0.29, [[0, '#d5d8dc'], [1, '#9aa0a5']]), r: 0.12, m: 0, mask: '#0000c8', lens: 0.012 });
      for (let u = -0.2; u < 0.25; u += 0.011) { X.A.fillStyle = 'rgba(0,0,0,0.2)'; X.A.fillRect(u, 0.29, 0.002, 0.03); }
    }
    // 車牌凹槽 (在保桿上)
    fill(rpoly([[-0.2, 0.425], [0.225, 0.425], [0.212, 0.625], [-0.2, 0.625]], [0, 0.016, 0.022, 0]), { h: -3.5 });
    fill(rpoly([[-0.2, 0.433], [0.213, 0.433], [0.202, 0.616], [-0.2, 0.616]], [0, 0.012, 0.018, 0]), { h: -8 });
    fill(rect(-0.2, 0.545, 0.21, 0.625), { c: lgrad(0, 0.625, 0, 0.545, [[0, 'rgba(0,0,0,0.45)'], [1, 'rgba(0,0,0,0)']]) });
    stroke(line([[-0.2, 0.655], [0.5, 0.655], [0.8, 0.68], [uAR - AR, 0.655]]), 0.03, { h: 1.0 });     // 保桿腰線
    // 行李廂蓋下緣 (U 形，由尾燈下緣往中間收)、保桿與葉子板接縫 (尾燈外側下緣 → 輪拱)
    gap([[0.6, 0.83], [0.53, 0.762], [0.4, 0.697], [0.24, 0.672], [-0.2, 0.668]]);
    gap([[0.985, 0.812], [1.07, 0.745], [uAR - AR + 0.012, 0.7]]);
    // 鴨尾立面：第三煞車燈 (中央一條)；其下是連接兩顆尾燈的亮黑飾條
    fill(rpoly([[-0.2, 0.976], [0.105, 0.976], [0.105, 0.991], [-0.2, 0.991]], [0, 0.005, 0.005, 0]), { c: '#3a060a', r: 0.15, m: 0, h: -0.5, mask: '#600000', lens: 0.008 });
    fill(rect(-0.2, 0.927, 0.32, 0.956), { c: '#070708', r: 0.2, m: 0, h: 0.5 });
    X.A.fillStyle = 'rgba(255,255,255,0.07)'; X.A.fillRect(-0.2, 0.948, 0.52, 0.004);
    drawTail(toBelt, false);

    // ================= 車側 =================
    {
      // 車門 (長門)、門把
      const uD0 = uz(0.52), uD1 = uz(-0.6);
      gap([[uD0, 0.975], [uD0 + 0.01, 0.6], [uD0 + 0.06, 0.3], [uD0 + 0.07, 0.2]]);
      gap([[uD1, 0.92], [uD1, 0.2]]);
      gap([[uD0 + 0.07, 0.2], [uD1, 0.2]]);
      K.handle(0.3, 0.44, 0.8, 0.834);
      // 側裙 (黑)、前葉子板出風口 (直立的黑色開口，下端接側裙)
      fill(rect(uAR + AR + 0.02, 0.05, uAF - AR - 0.02, 0.19), { c: '#0c0c0e', r: 0.55, m: 0, h: 1.2 });
      const v0 = uz(-0.79), v1 = uz(-0.875);
      fill(rpoly([[v0 - 0.012, 0.3], [v0 + 0.01, 0.6], [v1 + 0.006, 0.628], [v1 - 0.008, 0.3]], 0.014), { c: '#070708', r: 0.45, m: 0, h: -5 });
      for (const k of [0.36, 0.7]) stroke(line([[v0 + (v1 - v0) * k - 0.008, 0.33], [v0 + (v1 - v0) * k + 0.006, 0.59]]), 0.008, { c: '#1b1b1e', h: 1.5 });
      // 輪拱捲邊 (微凸的一圈)
      for (const [uc, R] of [[uAR, M.ARR], [uAF, M.ARF]]) {
        const pts = [];
        for (let a = 0; a <= 36; a++) { const t = (Math.PI * a) / 36; pts.push([uc + Math.cos(t) * (R + 0.014), AY + Math.sin(t) * (R + 0.014)]); }
        stroke(line(pts), 0.03, { h: 1.3 });
      }
      // 前保桿接縫 (頭燈後下緣 → 輪拱)
      const hb = toBelt(HG.bot[HG.bot.length - 3]);
      gap([[hb[0], hb[1] - 0.004], [uAF + (AR + 0.012) * 0.79, AY + (AR + 0.012) * 0.616]]);
    }
    // 側窗：無框車門玻璃 + 後三角窗 (尾端往上收尖)
    K.sideWindows({
      z0: -0.56, z1: 1.3, ySl: (z) => ySill(z) + 0.012,
      yTop: (z) => Math.min(yrS(z) - 0.095, 1.21 - (z - 0.75) * 0.5),
      yA: (z, ins) => 0.905 + (z + 0.5 - ins * 2.2) / 1.95,
      panes: [[-0.5, 0.47], [0.535, 1.28]],
    });

    // ================= 車頭 =================
    {
      // 大型水箱罩：下寬上窄、上角大圓弧；蜂巢網
      const G1 = [[uf(-0.1), 0.228], [uf(0.44), 0.228], [uf(0.515), 0.3], [uf(0.47), 0.41], [uf(0.33), 0.512], [uf(-0.1), 0.512]];
      const GR = [0, 0.04, 0.04, 0.06, 0.06, 0];
      fill(rpoly(G1, GR), { c: '#050506', r: 0.7, m: 0, h: -7 });
      clipTo(rpoly(G1, GR), () => {
        const g = X.A, w = 0.04, hh = 0.0215;
        g.strokeStyle = 'rgba(64,66,72,0.8)'; g.lineWidth = 0.0042; g.lineJoin = 'round';
        for (let i = 0; i < 24; i++) for (let j = 0; j < 16; j++) {
          const cx = uf(0.56) + i * w * 0.75, cy = 0.21 + j * hh + (i & 1 ? hh / 2 : 0);
          g.beginPath();
          for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3, px = cx + (Math.cos(a) * w) / 2, py = cy + (Math.sin(a) * hh) / 1.732; if (k) g.lineTo(px, py); else g.moveTo(px, py); }
          g.closePath(); g.stroke();
        }
        stroke(rpoly(G1, GR), 0.024, { c: 'rgba(0,0,0,0.55)' });
      });
      stroke(rpoly(G1, GR), 0.012, { c: '#111113', r: 0.35, m: 0, h: 1.5 });
      // 保桿兩角的導流片 (「7」字形：水平刀片 + 外側直立段) 與其下方的進氣開口
      const b0 = uF(0.56, 0.44), b1 = uF(0.7, 0.445), b2 = uS(-1.93, 0.45), b3 = uS(-1.85, 0.45);
      fill(rpoly([[b0 - 0.07, 0.415], [b2 + 0.01, 0.415], [b2, 0.25], [b1 + 0.02, 0.27], [b0 - 0.1, 0.34]], 0.015), { c: '#020203', r: 0.8, m: 0, h: -8 });
      fill(rpoly([[b0, 0.44], [b1, 0.449], [b2, 0.458], [b3, 0.452], [b3, 0.21], [b2 - 0.012, 0.21], [b2 + 0.006, 0.42], [b1, 0.422], [b0, 0.432]], [0.002, 0, 0.01, 0.012, 0.01, 0.01, 0.012, 0, 0.002]), { c: '#0b0b0d', r: 0.3, m: 0, h: 2.2 });
      // 前下擾流 (黑)
      fill(rect(INFO.UF0 - 0.25, 0.05, M.UMAX + 0.1, 0.165), { c: '#0b0b0d', r: 0.55, m: 0, h: 1 });
      // 引擎蓋前緣接縫在車鼻立面看到的部分
      const hl = [];
      for (let k = 0; k <= 22; k++) { const x = (0.715 * k) / 22, p = S.topP(x, zHood(x)); if (p) hl.push(toBelt(p)); }
      hl.unshift([hl[0][0] + 0.08, hl[0][1]]);
      gap(hl);
      drawHead(toBelt, false);
    }
    end();

    // ================= 俯視 (z, |x|) =================
    region('top');
    // 引擎蓋接縫：前緣弧線 → 沿葉子板稜線往後 → 前擋下方；雨刷蓋板
    {
      const p = [];
      for (let k = 0; k <= 24; k++) { const x = -0.05 + (0.765 * k) / 24; p.push([zHood(Math.max(x, 0)), x]); }
      p.push([-1.5, 0.731], [-0.78, 0.737]);
      gap(p);
    }
    fill(poly(qcurve(-0.745, 0.26, -0.05, 0.73).concat(qcurve(-0.66, 0.26, -0.05, 0.73).reverse())), { c: '#0b0b0c', r: 0.7, m: 0, h: -3 });
    K.topGlass({ zb: -0.64, zt: 0.035, k: 0.26, wb: 0.7, wt: 0.52 });
    // 車頂兩側的黑色飾條
    {
      const p = [];
      for (let z = 0.06; z <= 0.9; z += 0.07) p.push([z, Wg(yrS(z) - 0.035, z) - 0.012]);
      stroke(line(p), 0.011, { c: '#09090a', r: 0.6, m: 0, h: -1.6, cap: 'butt' });
    }
    // 後擋 (長而斜)：黑邊、除霧線。第三煞車燈在鴨尾立面上 (環繞帶)，不在玻璃裡
    K.topGlass({ zt: 0.965, zb: 1.675, k: -0.25, wt: 0.44, wb: 0.56, defrost: { z0: 1.065, dz: 0.046, n: 13 } });
    // 行李廂蓋接縫 (前緣 → 兩側往後接到尾燈的分割線)
    {
      const p = qcurve(1.722, -0.25, -0.05, 0.54, 14);
      p.push([1.66, 0.585], [1.692, 0.6], [2.2, 0.6]);
      gap(p);
    }
    // 窗下飾條在俯視的對應
    {
      const p = [];
      for (let z = -0.5; z <= 1.26; z += 0.04) p.push([z, Wg(ySill(z) + 0.012, z) + 0.008]);
      stroke(line(p), 0.026, { c: '#0c0c0e', r: 0.3, m: 0, cap: 'butt' });
    }
    drawTail(toTop, true);
    drawHead(toTop, true);
    end();
    return K.finish();
  }

  // 車牌 / 廠徽 / 車型字樣用的小貼圖
  function buildDecalTex() {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 512, 256);
    const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
    // 車牌 (0,0)-(256,128)
    g.fillStyle = '#f2f2ec'; rr(2, 2, 252, 124, 10); g.fill();
    g.strokeStyle = '#222'; g.lineWidth = 4; rr(6, 6, 244, 116, 8); g.stroke();
    g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 64px ' + (RM.FONT || 'sans-serif');
    g.fillText('RGR-0086', 128, 68, 226);
    // 廠徽 (橢圓環) (256,0)-(384,96)
    g.fillStyle = '#15161a'; g.beginPath(); g.ellipse(320, 48, 56, 36, 0, 0, 6.2832); g.fill();
    g.strokeStyle = '#d4d6da'; g.lineWidth = 7;
    g.beginPath(); g.ellipse(320, 48, 56, 36, 0, 0, 6.2832); g.stroke();
    g.lineWidth = 5;
    g.beginPath(); g.ellipse(320, 54, 19, 29, 0, 0, 6.2832); g.stroke();
    g.beginPath(); g.ellipse(320, 62, 39, 13, 0, 0, 6.2832); g.stroke();
    // GR86 字樣 (0,144)-(256,208)；前水箱罩上只用左半的 GR
    g.fillStyle = '#16161a'; rr(4, 148, 96, 56, 6); g.fill();
    g.fillStyle = '#c8102e'; g.fillRect(4, 196, 96, 8);
    g.fillStyle = '#f4f4f4'; g.font = 'italic 900 44px sans-serif'; g.fillText('GR', 52, 174);
    g.fillStyle = '#d4d6da'; g.font = 'italic 900 52px sans-serif'; g.fillText('86', 172, 178);
    return { canvas: c, uv: { plate: [0.5 / 512, 0.5 / 256, 255.5 / 512, 127.5 / 256], emblem: [256 / 512, 0, 384 / 512, 96 / 256], badge: [0, 144 / 256, 232 / 512, 208 / 256], gr: [2 / 512, 146 / 256, 102 / 512, 206 / 256] } };
  }

  // ------------------------------------------------------------------ 零件
  const GLOSS = RM.mat('#0a0a0b', 0.18, 0);          // 亮黑 (後照鏡殼)
  const DRL = RM.mat('#f2f6ff', 0.2, 0, 0, 2.4);     // 日行燈：白天也亮的白色導光條
  function buildParts(D) {
    const body = new MeshBuilder(), glass = new MeshBuilder(), decal = new MeshBuilder();
    const rear = (x, y) => rearP(x, y), front = (x, y) => frontP(x, y);
    // 車牌 (後保桿凹槽 / 前水箱罩中央)、廠徽 (行李廂蓋 / 車鼻)、車型字樣
    patch(decal, rear, [-0.16, 0, 0.16], [0.606, 0.45], 0.005, MAT.plate, D.uv.plate);
    patch(decal, front, [0.16, 0, -0.16], [0.47, 0.314], 0.012, MAT.plate, D.uv.plate);
    patch(decal, rear, [-0.062, 0, 0.062], [0.862, 0.79], 0.005, MAT.chromeTex, D.uv.emblem);
    patch(decal, rear, [0.27, 0.35, 0.43], [0.752, 0.71], 0.004, MAT.chromeTex, D.uv.badge);
    patch(decal, front, [0.056, 0, -0.056], lin(0.624, 0.558, 2), 0.006, MAT.chromeTex, D.uv.emblem);
    patch(decal, front, [-0.25, -0.3, -0.35], [0.362, 0.322], 0.012, MAT.chromeTex, D.uv.gr);
    // 頭燈裡的發光零件：L 形日行燈、兩顆投射燈 (深色燈圈 + 透鏡)、方向燈
    const HG = headGeom();
    for (const sx of [-1, 1]) {
      const mir = (p) => { const q = [sx * p[0], p[1], p[2]]; return { p: q, n: normalAt(q) }; };
      PC.band(decal, HG.drl.map(mir), -0.0055, 0.0055, 0.004, DRL, 0, 0);
      PC.band(decal, HG.turn.map(mir), -0.006, 0.006, 0.004, sx < 0 ? MAT.blinkL : MAT.blinkR, 0, 0);
      for (const [c, r] of HG.proj) {
        const q = mir(c), o = [q.p[0] + q.n[0] * 0.05, q.p[1] + q.n[1] * 0.05, q.p[2] + q.n[2] * 0.05], d = [-q.n[0], -q.n[1], -q.n[2]];
        PC.roundPatch(decal, S, o, d, r + 0.008, 0.003, MAT.trim, 20, r - 0.001);
        PC.roundPatch(decal, S, o, d, r, 0.004, MAT.head, 20, 0, 0.6);
      }
    }
    // 雙邊大口徑排氣尾管 + 消音器
    for (const sx of [-1, 1]) {
      body.cyl([sx * 0.5, 0.296, 1.84], [sx * 0.5, 0.292, 2.09], 0.048, 0.054, 20, MAT.chrome, false);
      body.cyl([sx * 0.5, 0.2925, 2.05], [sx * 0.5, 0.2924, 2.055], 0.048, 0.048, 20, MAT.under, true);
    }
    body.cyl([0, 0.26, 1.5], [0, 0.26, 1.9], 0.09, 0.09, 12, MAT.muffler, true);
    PC.wheelArches(body, S, MAP, 0.86, ybS);
    PC.underbody(body, S, MAP, ybS, -2.05, 2.02);
    // 後照鏡：亮黑鏡殼，以斜支臂立在車門腰線上；鯊魚鰭天線 (車色)
    for (const sx of [-1, 1]) {
      PC.ellipsoid(body, [sx * 0.95, 0.962, -0.43], [0.1, 0.047, 0.056], GLOSS, 16, 10);
      body.quad([sx * 1.03, 0.931, -0.384], [sx * 0.885, 0.931, -0.384], [sx * 0.885, 0.992, -0.384], [sx * 1.03, 0.992, -0.384], MAT.mirror);
      body.box(sx * 0.83, 0.93, -0.44, 0.1, 0.04, 0.085, 0, GLOSS);
    }
    {
      const p = S.topP(0, 0.93);
      if (p) PC.ellipsoid(body, [0, p[1] + 0.014, 0.93], [0.022, 0.036, 0.08], MAT.paint, 10, 8);
    }
    // 內裝：桶椅、後座、儀表台、中控
    for (const sx of [-1, 1]) {
      body.box(sx * 0.36, 0.42, 0.2, 0.46, 0.13, 0.5, 0, MAT.fabric);
      body.box(sx * 0.36, 0.76, 0.5, 0.46, 0.62, 0.12, 0, MAT.fabric);
      body.box(sx * 0.36, 1.1, 0.53, 0.22, 0.13, 0.09, 0, MAT.fabric);
      body.box(sx * 0.735, 0.56, 0.1, 0.04, 0.4, 1.5, 0, MAT.dash);
    }
    body.box(0, 0.52, 1.0, 1.1, 0.3, 0.4, 0, MAT.fabric);
    body.box(0, 0.86, 1.36, 0.9, 0.03, 0.44, 0, MAT.dash);
    body.box(0, 0.76, -0.42, 1.44, 0.26, 0.34, 0, MAT.dash);
    body.box(-0.36, 0.905, -0.34, 0.38, 0.05, 0.16, 0, MAT.dash);
    body.cyl([-0.36, 0.8, -0.26], [-0.36, 0.85, -0.16], 0.03, 0.03, 6, MAT.dash, false);
    body.box(0, 0.5, 0.05, 0.22, 0.26, 0.9, 0, MAT.dash);
    body.box(0, 0.24, 0.3, 1.44, 0.05, 2.1, 0, MAT.fabric);
    void glass;
    return { body, glass, decal };
  }

  // ------------------------------------------------------------------ 規格 (FA24 2.4 水平對臥、6 速自排、後驅)
  const SPEC_OVER = {
    mass: 1290 + 75, cgH: 0.46, frontW: 0.555, drive: 'FR', cyl: 4, idle: 700, redline: 7400, cut: 7800, engI: 0.13,
    torque: [[0, 120], [1000, 172], [2000, 216], [3000, 240], [3700, 250], [4500, 247], [5500, 243], [6500, 239], [7000, 236], [7500, 216], [8000, 150]],
    ratios: [3.538, 2.06, 1.404, 1.0, 0.713, 0.582], final: 3.909, rev: 3.168, tireRRef: TIRE_R, speedoMax: 260,
    mu: 1.28, muRear: 1.08, cd: 0.33, area: 2.0, lift: 0.0, brakeF: 2300, brakeR: 1450, steerMax: 36 * Math.PI / 180, stiff: 1.35,
    // 性能調校：launch 起步輔助 [推力 N, 開始遞減, 歸零 (km/h)]；drift 甩尾 / 氮氣 (沒列的項目用 vehicle.js 的預設值，也就是 K8 的手感)
    //   均衡的後驅：甩尾角略小、弧線略大 (車身寬，比較不會擦到內側)；氮氣偏強，極速約 234 km/h
    launch: [4900, 10, 65],
    drift: { angle: 0.34, turn: 0.97, boost: 4100, nitro: 5200 },
  };
  function spec() {
    const dims = {
      L: 4.265, W: 1.775, H: 1.31 - DROP, minZ: -2.1325, maxZ: 2.1325, clear: 0.13,
      zF: MAP.AXF, zR: MAP.AXR, trackF: 1.52, trackR: 1.55, tireR: TIRE_R,
    };
    const Sp = RM.makeSpec(SPEC_OVER, dims);
    // 相機 / 燈位：車身座標 → 相對重心
    const rel = (x, y, z) => [x, y - DROP - Sp.cgH, z - Sp.cgZ];
    Sp.eye = rel(-0.36, 1.085, 0.3);
    Sp.hood = rel(0, 1.0, -0.72);
    Sp.bumper = rel(0, 0.45, -2.2);
    Sp.lampF = rel(0.6, 0.66, -1.98);
    Sp.lampR = rel(0.7, 0.88, 1.96);
    Sp.exhausts = [-1, 1].map((sx) => rel(sx * 0.5, 0.292, 2.13));   // 雙邊尾管：氮氣火焰兩支都噴
    Sp.exhaust = Sp.exhausts[0];
    return Sp;
  }

  RM.GR86Tex = { build: buildTex };
  PC.register('gr86', {
    build() {
      const D = buildDecalTex();
      const { body, glass, decal } = buildParts(D);
      return {
        shell: PC.buildShell(S, SHELL_BOX).build(), body: body.build(), glass: glass.build(), decal: decal.build(),
        // 18 吋消光黑 10 輻 (五組成對的細輻條，往輪輞張開)
        ...PC.wheelSet({ R: TIRE_R, RW: 0.2286, Wd: 0.215, spokes: 5, style: 'twin', sw: [0.0085, 0.0105], split: [0.015, 0.043], dish: 0.012, concave: 0.02, rim: MAT.rimBlack, rimDark: MAT.rimBlack2, cap: MAT.rimBlack, caliper: MAT.caliperRed, pistons: 2 }),
        steer: PC.buildSteering().build(),
        tex: PC.uploadTex(buildTex(PC.texSize())), decalTex: RM.GLU.texture(D.canvas, { aniso: 8, clamp: true }),
        map: MAP, mapU: INFO.uniforms, DROP,
        steerPos: [-0.36, 0.86, -0.13], tailLamp: [0.7, 0.88, 1.96],
        spec,
      };
    },
  });
})();
