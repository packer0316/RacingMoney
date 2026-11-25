'use strict';
// Toyota Sprinter Trueno (AE86 三門掀背，後期型 GT-APEX) 程序化模型 —— 作法見 proc_car.js
// 車身座標：-z = 車頭，x = 右，y = 離地高度；全長 4205 / 寬 1625 / 高 1335 / 軸距 2400 mm，185/60R14
// 熊貓配色：上半身為所選車色；防擦條以下 (中間留一條車色細線)、前保桿與輪拱飾條固定為黑色。
// 造型重點 (對照實車照片)：80 年代的折紙造型 —— 楔形低車頭 (掀燈收起)、平直的引擎蓋與腰線、
// 車側一條貫穿前後的肩線折線、方圓形輪拱捲邊、大片斜背尾門玻璃接短尾板、橫長的分格尾燈。
(function () {
  const RM = window.RM;
  const PC = RM.ProcCar;
  const { MeshBuilder } = RM;
  const { sq, sstep, pn, rmax, smin, softPos, spline, MAT } = PC;

  // 貼圖投影：車尾 / 車頭角的圓弧取實際車角的大小 (半徑約 12 cm)，環繞帶 u 才會接近等距，
  // 跨過車角的尾燈、角燈不會被拉長
  const MAP = {
    XC: 0.68, ZC: 1.94, RC: 0.12, XCF: 0.64, ZCF: -1.96, RCF: 0.13, UMAX: 5.7, Y0: 0.05, Y1: 1.38, Z0: -2.2, Z1: 2.2, XMAX: 0.9,
    AXF: -1.3025, AXR: 1.0975, ARF: 0.335, AYF: 0.305, ARR: 0.335, AYR: 0.305, ARCH_IN: 0.48,
  };
  const INFO = PC.mapInfo(MAP);
  const DROP = 0.03;
  const TIRE_R = 0.289;

  // ------------------------------------------------------------------ 車身外形：方正的楔形車頭 + 大斜背尾門
  // 下車身頂面中心線：鼻頭 → 平直上升的引擎蓋 → 前擋下緣 → 腰線 (微微往後上揚) → 短尾板
  const ylS = spline([[-2.13, 0.64], [-2.05, 0.68], [-1.8, 0.722], [-1.4, 0.788], [-1.0, 0.853], [-0.76, 0.893], [-0.5, 0.902], [0.0, 0.908], [0.6, 0.918], [1.2, 0.935], [1.6, 0.95], [1.8, 0.957], [2.0, 0.958], [2.13, 0.95]]);
  // 底盤高度：前下擾流壓到最低，車尾上收
  const ybS = spline([[-2.13, 0.2], [-1.9, 0.19], [-1.6, 0.2], [1.5, 0.2], [1.8, 0.24], [2.13, 0.3]]);
  // 車尾側面輪廓 z(y)：下擺內收 → 保桿凸出 (方正) → 保桿上緣退一階 → 直立的尾板
  const ZrS = spline([[0.14, 1.96], [0.24, 2.0], [0.3, 2.035], [0.365, 2.045], [0.385, 2.095], [0.41, 2.1025], [0.545, 2.1025], [0.57, 2.095], [0.585, 2.062], [0.7, 2.058], [0.85, 2.052], [0.93, 2.046], [1.1, 2.03]]);
  // 車頭側面輪廓：下擾流 (整片往前下方斜出去，最下緣最凸；做成斜面而不是一階唇邊，2 cm 的網格才取樣得到) →
  // 保桿凸出 → 鼻頭面板退一階 (掀燈蓋 / 上水箱罩細縫) → 引擎蓋前緣
  const ZfS = spline([[0.14, -2.094], [0.21, -2.092], [0.345, -2.06], [0.365, -2.095], [0.39, -2.1025], [0.57, -2.1025], [0.595, -2.095], [0.612, -2.055], [0.66, -2.038], [0.7, -2.0], [0.76, -1.9], [0.9, -1.6]]);
  // 俯視半寬：兩輪之間幾乎平行，車頭收窄較多。輪拱捲邊另外加在 Ws，最寬處合計約 0.8125 (全寬 1625)
  const WzS = spline([[-2.2, 0.7], [-2.1, 0.735], [-1.9, 0.766], [-1.5, 0.788], [-1.0, 0.795], [0.8, 0.796], [1.5, 0.792], [1.9, 0.778], [2.1, 0.762], [2.2, 0.75]]);
  // 車頂中心線：平頂，最高點在 B 柱附近
  const yrS = spline([[-0.5, 1.285], [-0.15, 1.318], [0.15, 1.333], [0.45, 1.335], [0.75, 1.328], [0.95, 1.31], [1.3, 1.25]]);
  // 肩線 (車側上方那條折線)：由前葉子板貼著引擎蓋下方一路往後、微微上揚，到尾燈上緣
  const yCrS = spline([[-2.13, 0.61], [-1.8, 0.66], [-1.4, 0.725], [-1.0, 0.782], [-0.7, 0.8], [0.0, 0.806], [1.0, 0.82], [1.8, 0.834], [2.13, 0.836]]);

  const YM = 0.55, ZC_R = 1.5, ZC_F = -1.5, YGB = 0.8;
  // 軟化的 max(d, 0)：e 越小轉折越銳。折紙造型的稜線要銳利，反射才會在線上斷開
  const kink = (d, e) => 0.5 * (d + Math.sqrt(d * d + e));
  // 輪拱：薄薄的方圓形捲邊 + 一點點葉子板鼓出 (原廠窄體，不做寬體)
  const flare = PC.archFlare(MAP, { lipF: 0.014, lipR: 0.014, lipW: 0.04, blF: 0.006, blR: 0.008, blW: 0.2 });
  // 車側斷面：肩線以上往內倒一個斜面接窗台；肩線到防擦條之間是直立的平面；防擦條以下微微內收到門檻
  function Ws(y, z) {
    return WzS(z) - 0.4 * kink(y - yCrS(z), 6e-5) - 0.1 * kink(0.47 - y, 6e-5) + flare(y, z);
  }
  function Tl(ax, z) {
    let y = ylS(z) - 0.012 * sq(ax / 0.8);
    // 引擎蓋中央微微隆起的平台 (兩側各一條淡淡的稜線)
    if (z < -0.78) y += 0.007 * sstep(0.52, 0.4, ax) * sstep(-0.78, -0.95, z) * sstep(-2.06, -1.9, z);
    return y;
  }
  function sdLower(ax, y, z) {
    const a = ax / Ws(y, z);
    let b = 0, np = 9;          // p-norm 指數高 → 俯視的車角方正
    if (z > ZC_R) b = (z - ZC_R) / (ZrS(y) - 0.012 * sq(ax / 0.8) - ZC_R);
    else if (z < ZC_F) { b = (ZC_F - z) / (ZC_F - ZfS(y) - 0.03 * sq(ax / 0.8)); np = 8; }
    const dP = (pn(a, b, np) - 1) * 0.8;
    // 頂面與側面的交角半徑很小 (葉子板上緣、尾板上緣都是折出來的)
    if (y > YM) return rmax(dP, y - Tl(ax, z), 0.032 - 0.008 * sstep(-1.0, -0.6, z));
    return rmax(dP, ybS(z) - y, 0.05);
  }
  const ySill = (z) => 0.895 + 0.03 * sstep(-0.6, 1.4, z);
  function Wg(y, z) {
    const dy = softPos(y - ySill(z));
    return WzS(z) - 0.042 - 0.025 * sstep(0.9, 1.8, z) - 0.012 * sstep(-0.1, -0.8, z) - 0.33 * dy - 0.26 * dy * dy;
  }
  const zWs = (y, ax) => -0.745 + (y - 0.895) * 1.5 + 0.2 * ax * ax;     // 前擋 (A 柱比現代車挺)
  // 尾門玻璃 (大斜背)。斜面只到尾板頂面為止：再往下延伸會從直立的尾板後面穿出去，變成尾燈上方一片翹出來的破面
  const zRg = (y, ax) => 1.79 - ((y > 0.93 ? y : 0.93) - 0.957) * 2.6 - 0.1 * ax * ax;
  const yRoof = (ax, z) => yrS(z) - 0.022 * sq(ax / 0.58);
  function sdGreen(ax, y, z) {
    const dz = Math.max(zWs(y, ax) - z, z - zRg(y, ax));
    const dP = rmax(ax - Wg(y, z), dz, 0.04);
    return Math.max(rmax(dP, y - yRoof(ax, z), 0.04), YGB - y);
  }
  function sdBody(x, y, z) {
    const ax = x < 0 ? -x : x;
    return smin(sdLower(ax, y, z), sdGreen(ax, y, z), 0.008);
  }
  const S = PC.surface(sdBody);
  const { rearP, frontP } = S;
  const patch = (mb, chart, us, vs, off, M, uv) => PC.patch(mb, S, chart, us, vs, off, M, uv);
  const SHELL_BOX = { XO: 0.86, YB: 0.05, YT: 1.38, ZO: 2.14, WI: 0.4, YI0: 0.42, YI1: 0.62, ZI: 1.6 };

  // 與著色器相同的環繞帶 u (車身座標 → 貼圖 u)：把跨過車角的圖案放到正確位置用
  function wrapU(ax, z) {
    const dz = z - MAP.ZC;
    if (dz > 0) return Math.min(ax, MAP.XC) + MAP.RC * Math.atan2(Math.max(ax - MAP.XC, 0), dz);
    const df = MAP.ZCF - z;
    if (df <= 0) return MAP.XC + (MAP.RC * Math.PI) / 2 - dz;
    return INFO.UF0 + MAP.RCF * Math.atan2(df, Math.max(ax - MAP.XCF, 1e-4)) + Math.max(MAP.XCF - ax, 0);
  }

  // ------------------------------------------------------------------ 貼圖
  function buildTex(W) {
    const M = MAP, K = PC.texKit(W, M);
    const { X, fill, stroke, poly, line, rect, circ, rpoly, clipTo, lgrad, rgrad, region, end, gap, uz, uf, qcurve } = K;
    const PLAS = { c: '#0e0e10', r: 0.55, m: 0 }, GLOSS = { c: '#08080a', r: 0.2, m: 0 };
    const UE = M.UMAX + 0.2;
    region('belt');
    const uAR = uz(M.AXR), uAF = uz(M.AXF), AR = M.ARR, AY = M.AYR;
    const uRB = uAR - AR, uFB = uAF + AR;       // 後 / 前保桿在車側的末端 (接輪拱)

    // ================= 熊貓配色與飾條 =================
    // 下半身亮黑；分界線上方留一條車色細線，再上去是黑色防擦條
    fill(rect(-0.2, 0.0, UE, 0.44), GLOSS);
    {
      const u0 = uAR + AR + 0.03, u1 = uAF - AR - 0.03;
      fill(rpoly([[u0, 0.468], [u1, 0.468], [u1, 0.505], [u0, 0.505]], 0.008), { c: '#0c0c0e', r: 0.5, m: 0, h: 2.5 });
      X.A.fillStyle = 'rgba(255,255,255,0.06)'; X.A.fillRect(u0 + 0.01, 0.494, u1 - u0 - 0.02, 0.004);
    }
    // 輪拱飾條 (黑色，沿捲邊一圈)
    for (const ua of [uAR, uAF]) {
      const pts = [];
      for (let a = -6; a <= 186; a += 4) { const r = (a * Math.PI) / 180; pts.push([ua + (AR + 0.013) * Math.cos(r), AY + (AR + 0.013) * Math.sin(r)]); }
      stroke(line(pts), 0.03, { c: '#0c0c0e', r: 0.5, m: 0, h: 1.5, cap: 'butt' });
    }

    // ================= 車尾 =================
    // 後保桿：上半車色、下半黑色塑膠；保桿上緣與尾板之間一條黑色填縫
    fill(rect(-0.2, 0.05, uRB, 0.44), Object.assign({ h: 0 }, PLAS));
    fill(rect(-0.2, 0.568, uRB, 0.602), { c: '#0a0a0c', r: 0.6, m: 0, h: -1.5 });
    {
      // 尾燈組 (後期型)：整條橫長燈殼繞過車角。上排內側 = 煙燻深紅 (煞車燈)、外側 = 琥珀方向燈；
      // 下排 = 一整條亮紅 (尾燈)，內端一小格倒車燈。水平稜紋透鏡。
      const L0 = 0.335, L1 = 0.94, B = 0.705, T = 0.835, yM = 0.76, uA = 0.755, uRv = L0 + 0.075;
      const P = rpoly([[L0, B], [L1, B], [L1, T], [L0, T]], [0.006, 0.014, 0.014, 0.006]);
      // 兩燈之間：上半是亮黑飾板，下半是車牌凹槽 (黑框)
      fill(rect(-0.2, yM - 0.004, L0 + 0.01, T), { c: '#060608', r: 0.16, m: 0, h: 0.6 });
      X.A.fillStyle = 'rgba(255,255,255,0.07)'; X.A.fillRect(-0.2, T - 0.012, L0 + 0.2, 0.004);
      fill(rpoly([[-0.2, 0.604], [0.215, 0.604], [0.215, yM - 0.004], [-0.2, yM - 0.004]], [0, 0.012, 0.004, 0]), { c: '#0b0b0d', r: 0.5, m: 0, h: -4 });
      fill(rect(-0.2, 0.7, 0.215, yM - 0.004), { c: lgrad(0, yM, 0, 0.7, [[0, 'rgba(0,0,0,0.5)'], [1, 'rgba(0,0,0,0)']]) });   // 凹槽上緣陰影
      stroke(P, 0.011, { c: '#040405', h: -3, r: 0.8, m: 0 });        // 燈殼黑框
      fill(P, { c: lgrad(0, T, 0, B, [[0, '#3a070a'], [1, '#54090d']]), r: 0.07, m: 0, h: 1.0, mask: '#240000', lens: 0.014 });
      clipTo(P, () => {
        const g = X.A;
        fill(rect(L0, B, 1.0, yM - 0.003), { c: lgrad(0, yM, 0, B, [[0, '#b4161d'], [1, '#7e0c12']]), mask: '#3c0000' });
        fill(rect(L0, yM + 0.003, uA - 0.003, T + 0.01), { c: lgrad(0, T, 0, yM, [[0, '#36070a'], [1, '#560a0e']]), mask: '#480000' });
        for (const bu of [0.44, 0.62]) fill(circ(bu, 0.798, 0.1, 0.034), { mask: rgrad(bu, 0.798, 0.1, [[0, '#4a0000'], [1, '#000000']]), add: true });
        fill(rect(uA + 0.003, yM + 0.003, 1.0, T + 0.01), { c: lgrad(0, T, 0, yM, [[0, '#dc8814'], [1, '#a65c08']]), mask: '#00a800' });
        fill(rect(L0, B, uRv - 0.003, yM - 0.003), { c: lgrad(0, yM, 0, B, [[0, '#b8bcbe'], [1, '#7f8386']]), mask: '#00009a' });
        // 反射罩在燈泡處較亮
        for (const [bu, by, br, col] of [[0.44, 0.798, 0.08, '255,90,80'], [0.62, 0.798, 0.08, '255,90,80'], [0.85, 0.798, 0.07, '255,214,130']]) {
          g.fillStyle = rgrad(bu, by, br, [[0, `rgba(${col},0.32)`], [1, `rgba(${col},0)`]])(g);
          g.fillRect(bu - br, by - br * 0.4, br * 2, br * 0.8);
        }
        // 水平稜紋
        for (let y = B + 0.006; y < T; y += 0.0105) { g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(L0, y, 0.7, 0.0024); g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(L0, y + 0.003, 0.7, 0.0018); }
        // 分格條 (在透鏡表面，不做視差)
        stroke(line([[L0, yM], [1.0, yM]]), 0.005, { c: '#12090a', h: -0.8, mask: '#000000' });
        stroke(line([[uA, yM], [uA, T + 0.01]]), 0.005, { c: '#141012', h: -0.8, mask: '#000000' });
        stroke(line([[uRv, B], [uRv, yM]]), 0.005, { c: '#141012', h: -0.8, mask: '#000000' });
        stroke(P, 0.014, { c: 'rgba(0,0,0,0.35)' });
        g.fillStyle = 'rgba(255,255,255,0.09)'; g.fillRect(L0, T - 0.008, 0.7, 0.003);
      });
      // 尾門接縫：下緣在尾燈上方橫過，兩側往上接到尾板上緣 (俯視再接到玻璃兩側)
      gap([[-0.2, 0.848], [0.7, 0.848], [0.722, 0.87], [0.722, 1.0]]);
      // 尾門鎖孔
      fill(circ(0, 0.905, 0.011), { c: '#1a1a1c', r: 0.3, m: 0.8, h: 1 });
    }

    // ================= 車側 =================
    gap([[uz(-0.72), 0.9], [uz(-0.72), 0.2]]);                     // 車門前緣
    gap([[uz(0.34), 0.915], [uz(0.34), 0.2]]);                     // 車門後緣
    gap([[uz(0.34), 0.2], [uz(-0.72), 0.2]]);                      // 門檻
    gap([[uFB, 0.604], [wrapU(0.78, -2.0), 0.604]]);               // 前保桿上緣與葉子板的接縫
    gap([[uz(-1.72), 0.604], [uz(-1.72), 0.9]], 0.004);            // 前葉子板與鼻頭面板的接縫
    {
      // 門把 (黑色掀板式，在肩線下方)：凹槽 + 掀板
      const u0 = uz(0.27), u1 = uz(0.12);
      fill(rpoly([[u0, 0.738], [u1, 0.738], [u1, 0.78], [u0, 0.78]], 0.008), { c: '#060607', r: 0.5, m: 0, h: -4 });
      fill(rpoly([[u0 + 0.006, 0.752], [u1 - 0.006, 0.752], [u1 - 0.006, 0.776], [u0 + 0.006, 0.776]], 0.005), { c: '#111113', r: 0.4, m: 0, h: 0 });
      fill(circ(uz(0.305), 0.758, 0.009), { c: '#1c1c1e', r: 0.3, m: 0.8, h: 0.6 });   // 鑰匙孔
    }
    // 側窗：車門玻璃 + B 柱 (黑) + 大片後三角窗；後緣與尾門玻璃平行，留出一條車色 C 柱
    K.sideWindows({
      z0: -0.66, z1: 1.6, ySl: (z) => ySill(z) + 0.012,
      yTop: (z) => Math.min(yrS(z) - 0.08, 0.842 + (1.79 - z) / 2.6),
      yA: (z, ins) => 0.895 + (z + 0.585 - ins * 2.2) / 1.5,
      panes: [[-0.6, 0.285], [0.365, 1.56]],
    });

    // ================= 車頭 =================
    {
      const xI0 = 0.3, xI1 = 0.465;                   // 保桿上的方形燈組 (內側清光位置燈、外側琥珀方向燈)
      // 前保桿：整圈黑色塑膠，兩側到正面外段有一條車色飾線 (接車側那條細線)
      fill(rect(uFB, 0.05, UE, 0.6), Object.assign({ h: 0.4 }, PLAS));
      fill(rect(uFB, 0.44, uf(xI1 + 0.012), 0.498), { erase: true });
      // 角燈 (琥珀，繞過車角到葉子板前緣)
      {
        const u0 = uz(-1.85), u1 = uf(0.585);
        const cl = rpoly([[u0, 0.517], [u1, 0.517], [u1, 0.588], [u0, 0.588]], 0.008);
        stroke(cl, 0.009, { c: '#040405', h: -2.5, r: 0.8, m: 0 });
        fill(cl, { c: lgrad(0, 0.588, 0, 0.517, [[0, '#e28c18'], [1, '#aa5e08']]), r: 0.08, m: 0, h: 0.8, mask: '#00a000', lens: 0.012 });
        clipTo(cl, () => {
          for (let u = u0; u < u1; u += 0.011) { X.A.fillStyle = 'rgba(0,0,0,0.17)'; X.A.fillRect(u, 0.51, 0.002, 0.09); }
          fill(circ((u0 + u1) / 2, 0.552, 0.07, 0.03), { mask: rgrad((u0 + u1) / 2, 0.552, 0.07, [[0, '#005000'], [1, '#000000']]), add: true });
          stroke(cl, 0.012, { c: 'rgba(0,0,0,0.3)' });
        });
      }
      // 保桿正面的燈組
      {
        const u0 = uf(xI1), um = uf((xI0 + xI1) / 2), u1 = uf(xI0);
        fill(rpoly([[u0 - 0.006, 0.446], [u1 + 0.006, 0.446], [u1 + 0.006, 0.508], [u0 - 0.006, 0.508]], 0.008), { c: '#050506', r: 0.5, m: 0, h: -2.5 });
        fill(rpoly([[u0, 0.452], [um - 0.003, 0.452], [um - 0.003, 0.502], [u0, 0.502]], 0.005), { c: lgrad(0, 0.502, 0, 0.452, [[0, '#e08a16'], [1, '#a65c08']]), r: 0.08, m: 0, mask: '#00b000', lens: 0.012 });
        fill(rpoly([[um + 0.003, 0.452], [u1, 0.452], [u1, 0.502], [um + 0.003, 0.502]], 0.005), { c: lgrad(0, 0.502, 0, 0.452, [[0, '#e8ebec'], [1, '#aab0b3']]), r: 0.06, m: 0, mask: '#c80000', lens: 0.012 });
        for (let u = u0; u < u1; u += 0.011) { X.A.fillStyle = 'rgba(0,0,0,0.16)'; X.A.fillRect(u, 0.452, 0.002, 0.05); }
      }
      // 保桿中央的水箱罩 (黑色橫柵；TRUENO 銘牌另外貼)、下方進氣口
      {
        const G1 = rpoly([[uf(xI0 - 0.02), 0.446], [UE, 0.446], [UE, 0.522], [uf(xI0 - 0.02), 0.522]], [0.008, 0, 0, 0.008]);
        fill(G1, { c: '#050506', r: 0.7, m: 0, h: -5 });
        clipTo(G1, () => { for (let y = 0.458; y < 0.52; y += 0.0125) { X.A.fillStyle = 'rgba(58,60,66,0.85)'; X.A.fillRect(uf(xI0), y, 0.6, 0.004); } stroke(G1, 0.014, { c: 'rgba(0,0,0,0.5)' }); });
        const G2 = rpoly([[uf(0.5), 0.235], [UE, 0.235], [UE, 0.335], [uf(0.5), 0.335]], [0.012, 0, 0, 0.012]);
        fill(G2, { c: '#040405', r: 0.75, m: 0, h: -5 });
        for (const y of [0.262, 0.297]) { X.A.fillStyle = 'rgba(40,42,46,0.9)'; X.A.fillRect(uf(0.49), y, 0.7, 0.008); }
        gap([[uFB, 0.36], [UE, 0.36]], 0.004);                          // 保桿與下擾流的分界
      }
      // 鼻頭面板：兩個掀燈蓋之間的上水箱罩細縫 (黑色橫柵)
      {
        const G3 = rpoly([[uf(0.415), 0.614], [UE, 0.614], [UE, 0.662], [uf(0.415), 0.662]], [0.006, 0, 0, 0.006]);
        fill(G3, { c: '#050506', r: 0.65, m: 0, h: -4 });
        clipTo(G3, () => { for (let y = 0.622; y < 0.66; y += 0.011) { X.A.fillStyle = 'rgba(56,58,64,0.8)'; X.A.fillRect(uf(0.41), y, 0.6, 0.0035); } });
        // 掀燈蓋 (收起) 正面的接縫：內側、下緣、外側 (在車角上)
        gap([[uf(0.44), 0.7], [uf(0.44), 0.608], [wrapU(0.725, -2.0), 0.608], [wrapU(0.725, -2.0), 0.7]], 0.005);
      }
    }
    end();

    region('top');
    // 引擎蓋接縫：後緣 (前擋下方) → 兩側；掀燈蓋 (後緣、內側、外側)；鼻頭前緣
    gap(qcurve(-0.835, 0.2, -0.05, 0.7).concat([[-1.8, 0.7]]), 0.005);
    gap([[-1.8, 0.74], [-1.8, 0.44], [-2.06, 0.44]], 0.005);
    gap([[-1.8, 0.74], [-2.06, 0.73]], 0.005);
    gap([[-2.034, -0.05], [-2.034, 0.44]], 0.005);
    // 雨刷蓋板 (黑)
    fill(poly(qcurve(-0.82, 0.2, -0.05, 0.725).concat(qcurve(-0.745, 0.2, -0.05, 0.725).reverse())), { c: '#0b0b0c', r: 0.7, m: 0, h: -3 });
    for (const x of [0.22]) fill(circ(-1.05, x, 0.012, 0.009), { c: '#0a0a0a', r: 0.6, h: 1.5 });      // 噴水頭
    K.topGlass({ zb: -0.725, zt: -0.165, k: 0.2, wb: 0.7, wt: 0.53 });
    K.topGlass({ zt: 0.905, zb: 1.725, k: -0.1, wt: 0.475, wb: 0.635, defrost: { z0: 1.0, dz: 0.053, n: 13 } });
    // 車頂兩側的排水膠條
    {
      const p = [];
      for (let z = -0.1; z <= 0.8; z += 0.1) p.push([z, Wg(yrS(z) - 0.03, z) - 0.004]);
      stroke(line(p), 0.012, { c: '#0a0a0b', r: 0.55, m: 0, h: 1.2, cap: 'butt' });
    }
    // 尾門接縫：車頂後緣 → 玻璃兩側 → 尾板上緣
    gap([[0.845, -0.05], [0.845, 0.5], [0.875, 0.55], [1.78, 0.705], [2.2, 0.722]], 0.005);
    // 窗下飾條在俯視的對應 (肩線圓角處兩個投影都看得到)
    {
      const p = [];
      for (let z = -0.6; z <= 1.56; z += 0.04) p.push([z, Wg(ySill(z) + 0.012, z) + 0.008]);
      stroke(line(p), 0.026, { c: '#0c0c0e', r: 0.3, m: 0, cap: 'butt' });
    }
    end();
    return K.finish();
  }

  // 車牌、車頭 TRUENO 銘牌、尾門上的車型字樣
  function buildDecalTex() {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    const g = c.getContext('2d');
    const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
    g.fillStyle = '#f2f2ec'; rr(2, 2, 252, 124, 10); g.fill();
    g.strokeStyle = '#222'; g.lineWidth = 4; rr(6, 6, 244, 116, 8); g.stroke();
    g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 64px ' + (RM.FONT || 'sans-serif');
    g.fillText('AEA-8686', 128, 68, 226);
    // 車頭銘牌：黑底白字
    g.fillStyle = '#0b0b0c'; rr(262, 6, 244, 60, 6); g.fill();
    g.fillStyle = '#ececec'; g.font = '900 44px sans-serif'; g.fillText('TRUENO', 384, 38, 220);
    // 尾門字樣：透明底黑字
    g.fillStyle = '#5c6066'; g.textAlign = 'left';    // 中灰：淺色車、深色車上都讀得出來 (貼片不知道車色)
    g.font = '900 40px sans-serif'; g.fillText('APEX', 8, 160);
    g.font = '700 24px sans-serif'; g.fillText('TWIN CAM 16', 138, 164);
    g.font = '700 20px sans-serif'; g.fillText('TOYOTA', 8, 204); g.fillText('SPRINTER', 8, 228);
    g.font = '900 40px sans-serif'; g.fillText('TRUENO', 118, 216, 200);
    return {
      canvas: c,
      uv: { plate: [0.5 / 512, 0.5 / 256, 255.5 / 512, 127.5 / 256], badge: [262 / 512, 6 / 256, 506 / 512, 66 / 256], apex: [4 / 512, 136 / 256, 316 / 512, 184 / 256], name: [4 / 512, 190 / 256, 322 / 512, 240 / 256] },
    };
  }

  // ------------------------------------------------------------------ 零件
  // 四邊形，正面朝 dir 那一側
  function quadTo(mb, a, b, c, d, M, dir) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    if ((uy * vz - uz * vy) * dir[0] + (uz * vx - ux * vz) * dir[1] + (ux * vy - uy * vx) * dir[2] < 0) mb.quad(a, d, c, b, M); else mb.quad(a, b, c, d, M);
  }
  // 六面體：p = [一端的四個角, 另一端對應的四個角]；各面朝外。ends = false 時不封兩端 (接續的段落用)
  function hexa(mb, p, M, ends = true) {
    const c = [0, 0, 0];
    for (const q of p) { c[0] += q[0] / 8; c[1] += q[1] / 8; c[2] += q[2] / 8; }
    const faces = [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
    if (ends) faces.push([0, 1, 2, 3], [4, 5, 6, 7]);
    for (const f of faces) {
      const q = f.map((k) => p[k]);
      quadTo(mb, q[0], q[1], q[2], q[3], M, [(q[0][0] + q[2][0]) / 2 - c[0], (q[0][1] + q[2][1]) / 2 - c[1], (q[0][2] + q[2][2]) / 2 - c[2]]);
    }
  }
  const TXT = RM.mat('#ffffff', 0.45, 0, 2);          // 透明底的字樣貼片 (非金屬)
  // 輪拱內襯 (黑)：半圓筒 + 前後壁 + 內壁。和共用的 PC.wheelArches 差在前後壁只做到底盤高度、外緣收在門檻以內 ——
  // 這台車的下車身往內收，照共用版做的話側面會看到輪子前後各垂下一片像擋泥板的東西
  function archLiners(body) {
    for (const sx of [-1, 1]) for (const [ax, R, cy] of [[MAP.AXF, MAP.ARF, MAP.AYF], [MAP.AXR, MAP.ARR, MAP.AYR]]) {
      const Rl = R + 0.012, x1 = sx * 0.8, x0 = sx * MAP.ARCH_IN, xw = sx * 0.762, yb = 0.2, seg = 14;
      const P = (a, x) => [x, cy + Math.sin(a) * Rl, ax - Math.cos(a) * Rl];
      for (let k = 0; k < seg; k++) {
        const a0 = Math.PI * (k / seg), a1 = Math.PI * ((k + 1) / seg);
        body.quad(P(a0, x1), P(a1, x1), P(a1, x0), P(a0, x0), MAT.liner);
      }
      for (const dz of [-Rl, Rl]) body.quad([xw, yb, ax + dz], [xw, cy, ax + dz], [x0, cy, ax + dz], [x0, yb, ax + dz], MAT.liner);
      body.quad([x0, yb, ax - Rl], [x0, yb, ax + Rl], [x0, cy + Rl, ax + Rl], [x0, cy + Rl, ax - Rl], MAT.liner);
    }
  }

  function buildParts(D) {
    const body = new MeshBuilder(), decal = new MeshBuilder();
    const rear = (x, y) => rearP(x, y), front = (x, y) => frontP(x, y);
    // 車牌 (後：兩燈之間的凹槽；前：掛在保桿下方)、銘牌、尾門字樣
    patch(decal, rear, [-0.165, 0, 0.165], [0.75, 0.612], 0.005, MAT.plate, D.uv.plate);
    patch(decal, front, [0.165, 0, -0.165], [0.352, 0.214], 0.014, MAT.plate, D.uv.plate);
    patch(decal, front, [0.1, 0, -0.1], [0.508, 0.46], 0.008, MAT.atlas, D.uv.badge);
    patch(decal, rear, [-0.61, -0.44, -0.27], [0.918, 0.866], 0.004, TXT, D.uv.apex);
    patch(decal, rear, [0.3, 0.46, 0.62], [0.918, 0.866], 0.004, TXT, D.uv.name);
    // 排氣尾管 (左後) + 消音器
    body.cyl([-0.42, 0.262, 1.78], [-0.42, 0.256, 2.095], 0.03, 0.033, 16, MAT.chrome, false);
    body.cyl([-0.42, 0.2565, 2.07], [-0.42, 0.2564, 2.075], 0.027, 0.027, 16, MAT.under, true);
    body.cyl([-0.2, 0.27, 1.45], [-0.2, 0.27, 1.8], 0.075, 0.075, 12, MAT.muffler, true);
    archLiners(body);
    PC.underbody(body, S, MAP, ybS, -2.03, 2.0);
    // 門上的旗型後照鏡 (黑色)：前小後大的楔形鏡殼 + 鏡片 + 接在門板前上角的腳座
    for (const sx of [-1, 1]) {
      const P = (x, y, z) => [sx * x, y, z];
      hexa(body, [P(0.8, 0.955, -0.608), P(0.912, 0.958, -0.598), P(0.912, 1.014, -0.598), P(0.8, 1.018, -0.608),
        P(0.778, 0.936, -0.532), P(0.934, 0.938, -0.526), P(0.934, 1.03, -0.526), P(0.778, 1.03, -0.532)], MAT.black);
      quadTo(body, P(0.789, 0.945, -0.5245), P(0.925, 0.947, -0.5205), P(0.925, 1.022, -0.5205), P(0.789, 1.022, -0.5245), MAT.mirror, [0, 0, 1]);
      hexa(body, [P(0.72, 0.925, -0.62), P(0.8, 0.94, -0.6), P(0.8, 0.99, -0.6), P(0.72, 0.985, -0.62),
        P(0.72, 0.925, -0.535), P(0.79, 0.938, -0.535), P(0.79, 0.985, -0.535), P(0.72, 0.985, -0.535)], MAT.black);
    }
    // 尾門後緣的黑色擾流板 (GT-APEX)：薄楔形翼片，兩端往下收進尾板；中段以底座墊高，下方看得到一道陰影縫
    {
      const st = [[-0.67, 0.034, 1.955], [-0.63, 0.018, 1.93], [-0.54, 0.004, 1.918], [-0.3, 0, 1.915], [0, 0, 1.915], [0.3, 0, 1.915], [0.54, 0.004, 1.918], [0.63, 0.018, 1.93], [0.67, 0.034, 1.955]];
      const ring = ([x, drop, zf]) => [[x, 0.972 - drop, zf], [x, 0.984 - drop, zf], [x, 1.006 - drop, 2.052], [x, 0.984 - drop, 2.052]];
      for (let k = 0; k < st.length - 1; k++) hexa(body, ring(st[k]).concat(ring(st[k + 1])), MAT.black, false);
      for (const k of [0, st.length - 1]) { const r = ring(st[k]); quadTo(body, r[0], r[1], r[2], r[3], MAT.black, [st[k][0], 0, 0]); }
      hexa(body, [[-0.52, 0.93, 1.955], [0.52, 0.93, 1.955], [0.52, 0.976, 1.955], [-0.52, 0.976, 1.955], [-0.52, 0.93, 2.035], [0.52, 0.93, 2.035], [0.52, 0.988, 2.035], [-0.52, 0.988, 2.035]], MAT.black);
    }
    // 雨刷 (停在前擋下緣)：沿玻璃面的兩支黑色刷片 + 刷臂
    {
      const gp = (x, y) => { const ax = Math.abs(x), n = [0.4 * x, 1.5, -1], l = Math.hypot(n[0], n[1], n[2]); return [x + (n[0] / l) * 0.014, y + (n[1] / l) * 0.014, zWs(y, ax) - (1 / l) * 0.014]; };
      for (const [xa, xb, xp] of [[-0.5, -0.06, -0.52], [0.0, 0.44, -0.02]]) {
        const N = 4;
        for (let k = 0; k < N; k++) {
          const x0 = xa + ((xb - xa) * k) / N, x1 = xa + ((xb - xa) * (k + 1)) / N;
          const a = gp(x0, 0.93), b = gp(x1, 0.93), a2 = gp(x0, 0.943), b2 = gp(x1, 0.943);
          hexa(body, [a, [a[0], a[1] + 0.012, a[2] + 0.004], [a2[0], a2[1] + 0.012, a2[2] + 0.004], a2, b, [b[0], b[1] + 0.012, b[2] + 0.004], [b2[0], b2[1] + 0.012, b2[2] + 0.004], b2], MAT.black, k === 0 || k === N - 1);
        }
        const p0 = gp(xp, 0.905), p1 = gp((xa + xb) / 2, 0.94);
        body.cyl([p0[0], p0[1] - 0.004, p0[2]], [p1[0], p1[1] + 0.012, p1[2]], 0.006, 0.005, 6, MAT.black, true);
      }
    }
    // 內裝
    for (const sx of [-1, 1]) {
      body.box(sx * 0.34, 0.47, 0.1, 0.44, 0.13, 0.5, 0, MAT.fabric);
      body.box(sx * 0.34, 0.8, 0.38, 0.44, 0.6, 0.12, 0, MAT.fabric);
      body.box(sx * 0.34, 1.12, 0.4, 0.22, 0.12, 0.09, 0, MAT.fabric);
      body.box(sx * 0.69, 0.6, 0.1, 0.04, 0.4, 1.7, 0, MAT.dash);
    }
    body.box(0, 0.56, 0.95, 1.2, 0.3, 0.45, 0, MAT.fabric);
    body.box(0, 0.86, 1.45, 1.1, 0.03, 0.6, 0, MAT.dash);
    body.box(0, 0.78, -0.5, 1.34, 0.26, 0.32, 0, MAT.dash);
    body.box(-0.34, 0.93, -0.42, 0.38, 0.05, 0.16, 0, MAT.dash);
    body.cyl([-0.34, 0.83, -0.34], [-0.34, 0.88, -0.24], 0.03, 0.03, 6, MAT.dash, false);
    body.box(0, 0.5, 0.0, 0.2, 0.24, 0.8, 0, MAT.dash);
    body.box(0, 0.28, 0.3, 1.34, 0.05, 2.1, 0, MAT.fabric);
    return { body, decal };
  }

  // ------------------------------------------------------------------ 規格：4A-GE 1.6 DOHC 130 PS、5 速、後驅
  const SPEC_OVER = {
    mass: 950 + 75, cgH: 0.5, frontW: 0.535, drive: 'FR', cyl: 4, idle: 850, redline: 7600, cut: 8000, engI: 0.11,
    torque: [[0, 70], [1000, 100], [2000, 118], [3000, 130], [4000, 140], [5200, 149], [6000, 146], [6600, 138], [7600, 118], [8200, 80]],
    ratios: [3.587, 2.022, 1.384, 1.0, 0.861], final: 3.8, rev: 3.484, tireRRef: TIRE_R, speedoMax: 280,
    mu: 1.15, muRear: 1.04, cd: 0.25, area: 1.8, brakeF: 1500, brakeR: 800, steerMax: 37 * Math.PI / 180, stiff: 1.1,
    // 性能調校：launch 起步輔助 [推力 N, 開始遞減, 歸零 (km/h)]；drift 甩尾 / 氮氣 (沒列的項目用 vehicle.js 的預設值，也就是 K8 的手感)
    //   強項是甩尾 (彎道衝刺單圈最快)：甩尾角最大、集氣最快；直線最弱 (0～100 約 6.0 秒、極速約 242 km/h)
    //   原廠尾牙 4.3 在五檔紅線只有 224 km/h (極速被紅線卡住)，平衡時改成 3.8、風阻調小
    // 2026-11-25 車款平衡 (使用者要求：速度可以有快慢但不能差太多，各車有各自的強項)：power 動力倍率 (扭力表維持原廠數字)、
    //   起步輔助、風阻、甩尾 / 氮氣一起調。Node 物理模擬：彎道衝刺單圈六台車差 1 秒內，0～100 km/h 4.4～6.0 秒，極速 242～267 km/h (使用者要求極速差距再縮小，原本 221～299)
    power: 1.18, launch: [5600, 10, 65],
    drift: { angle: 0.38, drag: 1.18, charge: 1.2, boost: 3500 },
  };
  function spec() {
    const Sp = RM.makeSpec(SPEC_OVER, { L: 4.205, W: 1.625, H: 1.335 - DROP, minZ: -2.1025, maxZ: 2.1025, clear: 0.15, zF: MAP.AXF, zR: MAP.AXR, trackF: 1.355, trackR: 1.345, tireR: TIRE_R });
    const rel = (x, y, z) => [x, y - DROP - Sp.cgH, z - Sp.cgZ];
    Sp.eye = rel(-0.34, 1.1, 0.18); Sp.hood = rel(0, 1.03, -0.78); Sp.bumper = rel(0, 0.45, -2.16);
    // 燈位：保桿上的燈組 / 尾燈中心 / 左後排氣尾管
    Sp.lampF = rel(0.38, 0.478, -2.07); Sp.lampR = rel(0.56, 0.77, 2.04); Sp.exhaust = rel(-0.42, 0.257, 2.12);
    return Sp;
  }

  RM.AE86Tex = { build: buildTex };
  PC.register('ae86', {
    build() {
      const D = buildDecalTex();
      const { body, decal } = buildParts(D);
      return {
        shell: PC.buildShell(S, SHELL_BOX).build(), body: body.build(), glass: null, decal: decal.build(),
        // RS Watanabe 風八輻：粗輻條 (往輪輞漸寬)、深唇、輪轂略凸
        ...PC.wheelSet({ R: TIRE_R, RW: 0.1778, Wd: 0.185, spokes: 8, style: 'multi', sw: [0.015, 0.022], lugs: 4, dish: 0.045, concave: -0.005, spokeMat: MAT.rimBlack, rim: MAT.rim, rimDark: MAT.rimBlack2 }),
        steer: PC.buildSteering().build(),
        tex: PC.uploadTex(buildTex(PC.texSize())), decalTex: RM.GLU.texture(D.canvas, { aniso: 8, clamp: true }),
        map: MAP, mapU: INFO.uniforms, DROP,
        steerPos: [-0.34, 0.9, -0.2], tailLamp: [0.56, 0.77, 2.04],
        spec,
      };
    },
  });
})();
