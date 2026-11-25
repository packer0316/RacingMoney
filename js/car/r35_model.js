'use strict';
// Nissan GT-R (R35，2017 年後小改款：V 形大水箱罩) 程序化模型 —— 作法見 proc_car.js
// 車身座標：-z = 車頭，x = 右，y = 離地高度；全長 4710 / 寬 1895 / 高 1370 / 軸距 2780 mm，20 吋 (模型前後同尺寸)
// 造型重點：又寬又低的楔形車身、高出引擎蓋的前葉子板 (內緣有一道銳利的稜線)、往後收窄的罩艙式車室、
//           寬大的後葉子板肩部、短而高的車尾與四圓尾燈。
(function () {
  const RM = window.RM;
  const PC = RM.ProcCar;
  const { MeshBuilder } = RM;
  const { sq, sstep, pn, rmax, smin, softPos, spline, MAT } = PC;

  // 貼圖投影：車尾角 (XC, ZC, RC) 取小圓角 —— 外側尾燈才落在接近平面的區域；車頭角 (XCF, ZCF, RCF) 取大圓角配合圓弧鼻頭
  const MAP = {
    XC: 0.7, ZC: 2.09, RC: 0.24, XCF: 0.56, ZCF: -1.97, RCF: 0.36, UMAX: 6.3, Y0: 0.05, Y1: 1.42, Z0: -2.45, Z1: 2.45, XMAX: 1.0,
    AXF: -1.41, AXR: 1.37, ARF: 0.4, AYF: 0.365, ARR: 0.4, AYR: 0.365, ARCH_IN: 0.56,
    frontChart: { endZ: -1.60, maxX: 0.89, bumperTop: 0.70 },
    rearChart: { startZ: 1.85, maxX: 0.87, bumperTop: 0.99 },
  };
  const INFO = PC.mapInfo(MAP);
  const DROP = 0.02;
  const TIRE_R = 0.355;

  // ------------------------------------------------------------------ 車身外形 (隱式)
  // 下車身頂面中心線：低鼻頭 → 長而平緩上升的引擎蓋 → 高腰線往後上揚 → 短行李廂蓋
  const ylS = spline([[-2.355, 0.62], [-2.30, 0.688], [-2.20, 0.744], [-2.02, 0.793],
    [-1.72, 0.852], [-1.41, 0.905], [-1.10, 0.949], [-0.84, 0.978],
    [-0.75, 0.985], [-0.3, 0.995], [0.5, 1.01], [1.0, 1.03], [1.4, 1.045],
    [1.75, 1.052], [2.1, 1.05], [2.355, 1.035]]);
  const ybS = spline([[-2.355, 0.156], [-2.2, 0.143], [-1.9, 0.135], [1.7, 0.135], [2.05, 0.152], [2.355, 0.184]]);
  // 車尾側面輪廓 z(y)：擴散器內收 → 保桿最凸 → 保桿上緣往內收約 4 cm 的台階 → 尾燈面略前傾 → 行李廂蓋後緣
  const ZrS = spline([[0.14, 2.2], [0.22, 2.29], [0.3, 2.335], [0.4, 2.355], [0.62, 2.355], [0.68, 2.351], [0.72, 2.34], [0.75, 2.322], [0.8, 2.314], [0.95, 2.305], [1.05, 2.297], [1.15, 2.287]]);
  // 車尾的凹槽 (幾何)：四個尾燈碗 + 車牌凹槽。以「正後方看的 (|x|, y)」定義 —— 和貼圖畫燈的方式 (RP：正後方投影) 一致，
  // 碗口就是畫上去的黑色燈座外緣 (1.14 r)，碗壁是燈座的黑圈，透鏡在碗底
  const LAMPS = [[0.672, 0.868, 0.106], [0.432, 0.853, 0.086]];      // [x, y, 透鏡半徑]：外側大燈、內側小燈
  const CUP_D = 0.034;
  const PLATE = { hx: 0.236, y0: 0.51, y1: 0.7, rc: 0.018, d: 0.02 };
  function rearCut(ax, y) {
    if (y > 0.183 && y < 0.38 && ax > 0.38 && ax < 0.76) {
      const lipDistance = Math.hypot(ax - RM.clamp(ax, 0.48, 0.66), y - 0.282);
      return 0.052 * (1 - sstep(0.067, 0.096, lipDistance));
    }
    if (y < 0.5 || y > 1.0) return 0;
    if (y > 0.74) {
      let d = 0;
      for (const [cx, cy, r] of LAMPS) {
        const rho = Math.hypot(ax - cx, y - cy);
        // 碗壁是 S 形的圓唇 (透鏡外緣 → 燈座外緣 1.14 r)
        if (rho < r * 1.14) d = Math.max(d, CUP_D * (1 - sstep(r * 0.98, r * 1.14, rho)) * (0.74 + 0.26 * Math.min(1, sq(rho / r))));
      }
      return d;
    }
    if (ax > PLATE.hx + 0.01 || y > PLATE.y1 + 0.01) return 0;
    const qx = ax - PLATE.hx + PLATE.rc, qy = Math.abs(y - (PLATE.y0 + PLATE.y1) / 2) - (PLATE.y1 - PLATE.y0) / 2 + PLATE.rc;
    const dist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - PLATE.rc;
    return PLATE.d * (1 - sstep(-0.007, 0, dist));
  }
  // 車頭側面輪廓：下擾流唇 → 直立的保桿面 → 頭燈所在的斜面 (要夠陡，環繞帶貼圖才貼得上去) → 引擎蓋前緣
  //   (頭燈那一段比較陡：頭燈是嵌在葉子板前端的立面上，不是躺在引擎蓋上)
  const ZfS = spline([[0.12, -2.2], [0.17, -2.31], [0.22, -2.345], [0.3, -2.355], [0.52, -2.355], [0.6, -2.348], [0.66, -2.334], [0.74, -2.302], [0.82, -2.248], [0.88, -2.17], [0.95, -2.05], [1.0, -1.9]]);
  // 俯視半寬 (不含輪拱外擴)：前後輪拱處最寬、車門處收腰、頭尾收窄
  const WzS = spline([[-2.4, 0.84], [-2.1, 0.895], [-1.75, 0.914], [-1.41, 0.912], [-0.9, 0.899], [-0.2, 0.886], [0.5, 0.893], [1.0, 0.906], [1.37, 0.906], [1.8, 0.913], [2.1, 0.90], [2.4, 0.85]]);
  // 車頂中心線：最高點在駕駛頭頂，往後一路降到行李廂蓋
  const yrS = spline([[-0.4, 1.235], [-0.08, 1.318], [0.18, 1.358], [0.42, 1.37], [0.7, 1.356], [1.0, 1.312], [1.3, 1.236], [1.6, 1.14], [1.85, 1.06]]);
  // 前葉子板高出引擎蓋的量 (到 A 柱根部歸零)
  const fendS = spline([[-2.355, 0.040], [-2.05, 0.041], [-1.72, 0.031],
    [-1.41, 0.021], [-1.10, 0.012], [-0.84, 0.005], [-0.72, 0]]);

  // ---- 車頭 (正前方看的 |x|, y)：2017 年後的造型 —— 保桿中央一整片深色大嘴，上半部是蜂巢網水箱罩，
  //      下緣由一條粗的 V 形鍍鉻飾條 (V-motion) 托住；中段是車牌飾板，最下方是下進氣口；
  //      大嘴兩側隔一道車色的直立「牙」，外側是直立進氣口 (上緣一條 LED 日行燈)
  //      幾何凹槽 (frontCut) 與貼圖用同一組形狀，槽口與畫上去的邊緣一定對齊
  const FR = {
    // Premium 保桿：上肩斜切，腰部以下接近直立，底緣折回烤漆下巴。
    mouth: [[-0.06, 0.693], [0.409, 0.693], [0.525, 0.59], [0.554, 0.548], [0.589, 0.292], [0.586, 0.249], [0.56, 0.222], [-0.06, 0.222]],
    grille: [[-0.06, 0.681], [0.393, 0.681], [0.365, 0.637], [0.307, 0.599], [0.281, 0.593], [-0.06, 0.591]],
    chrome: [[-0.06, 0.591], [0.281, 0.593], [0.307, 0.599], [0.365, 0.637], [0.393, 0.681],
      [0.399, 0.677], [0.374, 0.628], [0.31, 0.556], [0.286, 0.549], [-0.06, 0.548]],
    lower: [[-0.06, 0.418], [0.547, 0.418], [0.563, 0.276], [0.55, 0.244], [-0.06, 0.244]],
    side: [[0.717, 0.514], [0.847, 0.544], [0.856, 0.529], [0.86, 0.25], [0.801, 0.26], [0.78, 0.279], [0.715, 0.49]],
  };
  // 多邊形的帶號距離 (內部為負)、折線距離
  function polySD(P, x, y) {
    let d = Infinity, s = 1;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const ax = P[j][0], ay = P[j][1], ex = P[i][0] - ax, ey = P[i][1] - ay, wx = x - ax, wy = y - ay;
      const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
      const dx = wx - ex * t, dy = wy - ey * t;
      d = Math.min(d, dx * dx + dy * dy);
      if ((ay > y) !== (P[i][1] > y) && x < ax + ((y - ay) * ex) / ey) s = -s;
    }
    return s * Math.sqrt(d);
  }
  // 形狀內 1、外 0，邊緣往內 w 漸變 (槽壁)。w 要比取樣間距 (6 ~ 7 mm) 寬兩三倍：太陡的壁在規則網格上會變成鋸齒
  const inside = (d, w) => 1 - sstep(-w, 0, d);
  // 以公尺計算中央保桿橫樑、網面和飾條的前後落差。
  function frontCut(ax, y) {
    if (y < 0.22 || y > 0.693 || ax > 0.861) return 0;
    let c = 0;
    if (ax < 0.67) {
      const m = inside(polySD(FR.mouth, ax, y), 0.018);
      if (m > 0) {
        let d = 0.018;
        if (y > 0.59) d += 0.052 * inside(polySD(FR.grille, ax, y), 0.024);
        if (y < 0.42) d += 0.068 * inside(polySD(FR.lower, ax, y), 0.026);
        if (y > 0.54) d += 0.024 * sstep(0.548, 0.60, y) * inside(polySD(FR.chrome, ax, y), 0.013);
        c = m * d;
      }
    }
    if (ax > 0.71 && y < 0.545) c = Math.max(c, 0.048 * inside(polySD(FR.side, ax, y), 0.022));
    if (ax > 0.53 && y > 0.54) {
      const creaseY = 0.562 + (ax - 0.53) * 0.16;
      c -= 0.019 * sstep(0.53, 0.63, ax) * sstep(0.861, 0.82, ax) * Math.exp(-sq((y - creaseY) / 0.024));
    }
    return c;
  }

  const YM = 0.55, ZC_R = 1.55, ZC_F = -1.5, YGB = 0.88;
  const flare = PC.archFlare(MAP, { lipF: 0.009, lipR: 0.010, lipW: 0.038, blF: 0.0245, blR: 0.026, blW: 0.40 });
  const beltY = z => 0.795 + 0.126 * sstep(-0.92, 1.52, z);
  // 下車身側面半寬：輪拱高度最寬，往上收成肩部、往下收向門檻；車門下半部內凹 (R35 招牌的腰身)
  function Ws(y, z) {
    const d = y - 0.62;
    let w = WzS(z) - (d < 0 ? 0.055 * sq(d / 0.48) : 0.04 * sq(d / 0.4));
    const door = sstep(-1.16, -0.68, z) * sstep(1.43, 0.64, z);
    // 車門上緣反折出肩線，下面是寬而緩的凹面，接回門檻上方的折面。
    w += door * (0.026 * Math.exp(-sq((y - beltY(z)) / 0.065)) - 0.034 * Math.exp(-sq((y - 0.47) / 0.175))
      + 0.017 * Math.exp(-sq((y - 0.285) / 0.046)));
    return w + flare(y, z);
  }
  function Tl(ax, z) {
    const hood = sstep(-0.7, -1.0, z);
    let y = ylS(z) - (0.02 + 0.012 * hood) * sq(ax / 0.95);
    if (z < -0.72) {
      y += fendS(z) * sstep(0.55, 0.69, ax);                                      // 前葉子板：內緣陡升形成稜線
      const rib = 0.405 + 0.14 * sstep(-2.32, -0.92, z);
      y += 0.009 * Math.exp(-sq((ax - rib) / 0.080)) * sstep(-2.35, -2.15, z) * hood;
    }
    const sill = sstep(-0.72, -0.45, z) * sstep(1.1, 0.47, z);
    y -= 0.047 * sill * sstep(0.57, 0.83, ax);
    if (z > 0.60) y += 0.062 * sstep(0.60, 1.32, z) * sstep(2.29, 1.67, z) * Math.exp(-sq((ax - 0.79) / 0.19));
    if (z > 2.05) y += 0.02 * sstep(2.1, 2.3, z) * sstep(0.9, 0.6, ax);            // 行李廂蓋後緣微翹
    return y;
  }
  function sdLower(ax, y, z) {
    const a = ax / Ws(y, z);
    let b = 0, np = 4.2;
    // 車尾凹槽：把車尾面在 (|x|, y) 處往前推 (沿 z)。燈是「從正後方投影」畫上去的 (RP)，碗底的點和碗口同一個 (x, y)，
    // 投影到的貼圖位置就是畫燈的位置 —— 碗口、碗底與畫上去的燈完全對齊 (外燈繞過車角也一樣)
    if (z > ZC_R) b = (z - ZC_R) / (ZrS(y) - 0.035 * sq(ax / 0.95) - rearCut(ax, y) - ZC_R);
    // 鼻頭俯視是圓弧：兩角往後收。車頭的大嘴 / 進氣口在 (|x|, y) 處往後推 (frontCut)，和「從正前方投影」畫上去的貼圖對齊
    else if (z < ZC_F) { b = (ZC_F - z) / (ZC_F - ZfS(y) - 0.077 * sq(ax / 0.95) - frontCut(ax, y)); np = 4.5; }
    const dP = (pn(a, b, np) - 1) * 0.8;
    if (y > YM) {
      // 肩線圓角：引擎蓋 / 葉子板較圓，車門腰線俐落，車尾後緣最銳
      const R = 0.053 + 0.075 * Math.exp(-sq((z - MAP.AXF) / 0.56))
        + 0.109 * Math.exp(-sq((z - MAP.AXR) / 0.71)) - 0.016 * sstep(0.8, 0.97, b);
      return rmax(dP, y - Tl(ax, z), R);
    }
    return rmax(dP, ybS(z) - y, 0.085 - 0.058 * sstep(-1.64, -2.15, z));
  }
  const ySill = (z) => 0.937 + 0.068 * sstep(-0.55, 1.28, z);
  // 車室側面：往後明顯收窄 (留出寬大的後葉子板肩部)，側窗內傾
  function Wg(y, z) {
    const dy = softPos(y - ySill(z));
    return WzS(z) - 0.044 - 0.133 * sstep(0.1, 1.55, z) - 0.024 * sstep(-0.1, -0.7, z) - 0.34 * dy - 0.78 * dy * dy;
  }
  const zWs = (y, ax) => -0.78 + (y - 0.985) * 1.95 + 0.28 * ax * ax;    // 前擋玻璃面
  const zRg = (y, ax) => 1.8 - (y - 1.05) * 2.9 - 0.32 * ax * ax;       // 後擋玻璃面 (斜背)
  const yRoof = (ax, z) => yrS(z) - 0.060 * sq(ax / 0.63);
  function sdGreen(ax, y, z) {
    const dz = Math.max(zWs(y, ax) - z, z - zRg(y, ax));
    const dP = rmax(ax - Wg(y, z), dz, 0.06);
    const d = rmax(dP, y - yRoof(ax, z), 0.055);
    return Math.max(d, YGB - y);
  }
  function sdBody(x, y, z) {
    const ax = x < 0 ? -x : x;
    return smin(sdLower(ax, y, z), sdGreen(ax, y, z), 0.012);
  }

  const S = PC.surface(sdBody);
  const { rearP, frontP } = S;
  const sideR = S.sideP(1);
  const patch = (mb, chart, us, vs, off, M, uv) => PC.patch(mb, S, chart, us, vs, off, M, uv);
  // 車尾面：尾燈 / 車牌區的射線水平往後打 (順著燈碗的軸)，並局部加密 —— 碗口才是俐落的圓 (見 proc_car.js buildShell)
  const SHELL_BOX = {
    XO: 1.0, YB: 0.05, YT: 1.42, ZO: 2.39, WI: 0.44, YI0: 0.42, YI1: 0.62, ZI: 1.8,
    rearRays: { WR: 0.72, YR: 1.0 },
    frontRays: { WR: 0.66, YR: 0.69, YL: 0.20 },    // 水平取樣範圍止於水箱罩，使上方網格貼順引擎蓋。
    refine: {
      x: [[0.32, 0.82, 0.006], [0.82, 1.0, 0.009]], y: [[0.73, 1.1, 0.006]], z: [[2.16, 2.39, 0.008]],
      xAt: [0.224, 0.23, 0.236, 0.242, 0.248], yAt: [0.504, 0.51, 0.516, 0.522, 0.688, 0.694, 0.7, 0.706],
      // 車頭：大嘴、進氣口的邊緣多是橫線 (y 要密)；兩側的直邊在 x 0.38 ~ 0.78
      xf: [[0.30, 0.87, 0.007]], yf: [[0.22, 0.70, 0.006]],
    },
  };

  // ------------------------------------------------------------------ 貼圖
  function buildTex(W) {
    const M = MAP;
    const K = PC.texKit(W, M);
    const { X, fill, stroke, poly, line, rect, rpoly, clipTo, lgrad, rgrad, region, end, gap } = K;
    const uz = INFO.uSide, uf = INFO.uFront;
    const BLK = { c: '#0b0b0d', r: 0.55, m: 0 };
    const CHR = { c: '#c9ccd0', r: 0.16, m: 1 };
    // 與著色器相同的環繞帶 u (車身上的點 → 貼圖座標)
    const wrapU = (ax, z) => {
      const dz = z - M.ZC;
      if (dz > 0) return Math.min(ax, M.XC) + M.RC * Math.atan2(Math.max(ax - M.XC, 0), dz);
      const df = M.ZCF - z;
      if (df <= 0) return M.XC + M.RC * 1.5707963 - dz;
      return INFO.UF0 + M.RCF * Math.atan2(df, Math.max(ax - M.XCF, 1e-4)) + Math.max(M.XCF - ax, 0);
    };
    // 車頭與車尾採正視投影，車側沿輪廓換算環繞座標。
    const FP = (x, y) => [uf(x), y];
    const RP = (x, y) => [x, y];
    // 俯視投影用：正前方看的 (x, y) → 車身上的點 → (z, |x|)。頭燈上半部落在朝上的斜面 (俯視投影)，兩個投影都要畫
    const TP = (x, y) => { const p = frontP(Math.abs(x), y); return p ? [p[2], Math.abs(p[0])] : [-2.3, Math.abs(x)]; };
    const SP = (z, y) => { const p = sideR(z, y); return [p ? wrapU(p[0], p[2]) : uz(z), y]; };
    const mapPoly = (f, pts, n = 5) => {
      const o = [], m = pts.length;
      for (let i = 0; i < m; i++) { const a = pts[i], b = pts[(i + 1) % m]; for (let k = 0; k < n; k++) o.push(f(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n)); }
      return o;
    };
    const mapLine = (f, pts, n = 5) => {
      const o = [];
      for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; for (let k = 0; k < n; k++) o.push(f(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n)); }
      o.push(f(pts[pts.length - 1][0], pts[pts.length - 1][1]));
      return o;
    };
    const mapCirc = (f, cx, cy, r, n = 44) => { const o = []; for (let k = 0; k < n; k++) { const a = (k / n) * 6.2832; o.push(f(cx + Math.cos(a) * r, cy + Math.sin(a) * r)); } return o; };
    // 蜂巢 / 菱格網 (畫在目前的裁切範圍內)
    const mesh = (u0, u1, y0, y1, step, col) => {
      const g = X.A;
      g.strokeStyle = col || 'rgba(74,76,82,0.6)'; g.lineWidth = step * 0.14;
      for (let k = -Math.ceil((y1 - y0) / step) - 2; k < (u1 - u0) / step + 2; k++) {
        g.beginPath(); g.moveTo(u0 + k * step, y0); g.lineTo(u0 + k * step + (y1 - y0), y1); g.stroke();
        g.beginPath(); g.moveTo(u0 + k * step, y1); g.lineTo(u0 + k * step + (y1 - y0), y0); g.stroke();
      }
    };

    // 燈殼內端朝下，外上角沿葉子板往後掠。兩個投影共用同一套光學零件。
    const lampOutline = [[0.62, 0.686], [0.628, 0.661], [0.65, 0.649], [0.849, 0.674],
      [0.865, 0.686], [0.867, 0.757], [0.878, 0.803], [0.882, 0.823], [0.844, 0.814], [0.775, 0.801],
      [0.731, 0.787], [0.655, 0.738]];
    function drawHeadlight(F) {
      const panel = pts => poly(mapPoly(F, pts));
      const disc = (x, y, r) => poly(mapCirc(F, x, y, r, 32));
      const housing = panel(lampOutline);
      const base = F(0.79, 0.68), top = F(0.79, 0.83);
      fill(housing, { c: lgrad(...base, ...top, [[0, '#272c32'], [0.36, '#414c58'], [0.65, '#121821'], [1, '#242c34']]), r: 0.27, m: 0.28, mask: '#000008', lens: 0.012 });
      clipTo(housing, () => {
        // 鍍鋁反射罩下緣及透鏡之間的折面。
        fill(panel([[0.635, 0.668], [0.675, 0.659], [0.848, 0.682], [0.85, 0.695], [0.705, 0.678]]),
          { c: '#818b92', r: 0.23, m: 0.58 });
        for (const x of [0.687, 0.75, 0.815]) {
          const y = 0.685 + (x - 0.687) * 0.14;
          fill(panel([[x, y], [x + 0.008, y + 0.042], [x + 0.02, y + 0.045], [x + 0.011, y + 0.005]]),
            { c: '#626e78', r: 0.25, m: 0.55 });
        }
        // 三顆主透鏡和上層獨立反射碗。
        for (const [x, y, r] of [[0.661, 0.686, 0.028], [0.723, 0.702, 0.022], [0.783, 0.713, 0.022], [0.789, 0.780, 0.014]]) {
          fill(disc(x, y, r * 1.28), { c: '#080b10', r: 0.38, m: 0 });
          stroke(disc(x, y, r * 1.09), 0.004, { c: '#a5aeb5', r: 0.25, m: 0.68 });
          fill(disc(x, y, r * 0.91), { c: '#1c252e', r: 0.18, m: 0.16, mask: '#bd0000' });
          fill(disc(x - r * 0.21, y + r * 0.32, r * 0.36), { c: '#c9d7df', r: 0.13, m: 0.25, mask: '#ff0000' });
        }
        // 閃電光導跨過投射燈，再往葉子板方向勾起。
        const blade = [[0.628, 0.679], [0.646, 0.713], [0.683, 0.745], [0.811, 0.760],
          [0.824, 0.765], [0.825, 0.785], [0.814, 0.801], [0.826, 0.803], [0.845, 0.782],
          [0.853, 0.755], [0.84, 0.749], [0.687, 0.731], [0.653, 0.705]];
        fill(panel(blade), { c: '#d9e5ee', r: 0.22, m: 0.1, mask: '#0000a0', lens: 0.006 });
        fill(panel([[0.845, 0.764], [0.859, 0.772], [0.848, 0.792], [0.837, 0.794]]),
          { c: '#8f652c', r: 0.24, m: 0, mask: '#00b000' });
      });
      stroke(housing, 0.006, { c: '#16191e', r: 0.46, m: 0, mask: '#000000' });
    }

    region('belt');
    const uAR = uz(M.AXR), uAF = uz(M.AXF), AR = M.ARR, AY = M.AYR;

    // ================= 車尾 =================
    // 下半部黑色擴散器 (兩側留排氣管開口)、上緣銀灰飾條、鰭片、中央後霧燈與倒車燈
    {
      const D = mapPoly(RP, [[-0.05, 0.05], [0.86, 0.05], [0.86, 0.3], [0.8, 0.385], [0.36, 0.4], [0.3, 0.44], [-0.05, 0.44]]);
      fill(poly(D), Object.assign({ h: -1.5 }, BLK));
      stroke(line(mapLine(RP, [[0.84, 0.31], [0.79, 0.385], [0.36, 0.4], [0.3, 0.44], [-0.05, 0.44]])), 0.016, { c: '#8a8d92', r: 0.3, m: 0.8, h: 1.2 });
      for (const x of [0.07, 0.2]) fill(poly(mapPoly(RP, [[x - 0.008, 0.12], [x + 0.008, 0.12], [x + 0.008, 0.33], [x - 0.008, 0.33]], 2)), { c: '#17171a', h: 2.5, r: 0.5 });
      // 排氣管開口 (左右各一個長圓形凹槽，尾管是獨立零件)
      const E = mapPoly(RP, [[0.37, 0.19], [0.75, 0.19], [0.78, 0.27], [0.75, 0.35], [0.37, 0.35], [0.34, 0.27]], 4);
      fill(poly(E), { c: '#030304', r: 0.8, m: 0, h: -7 });
      clipTo(poly(E), () => mesh(0.3, 0.85, 0.17, 0.37, 0.022, 'rgba(60,62,68,0.5)'));
      stroke(poly(E), 0.008, { c: '#1c1c1f', r: 0.4, h: 1 });
      fill(rpoly([[-0.2, 0.2], [0.07, 0.2], [0.07, 0.245], [-0.2, 0.245]], [0, 0.008, 0.008, 0]), { c: '#5a080c', r: 0.15, m: 0, mask: '#300000', lens: 0.012 });   // 後霧燈
      fill(rpoly([[0.09, 0.2], [0.15, 0.2], [0.15, 0.245], [0.09, 0.245]], 0.008), { c: '#c8ccd0', r: 0.15, m: 0, mask: '#000090', lens: 0.012 });               // 倒車燈
    }
    // 保桿兩側的直立出風口 (黑色格柵)
    {
      const V = mapPoly(RP, [[0.8, 0.42], [0.875, 0.42], [0.885, 0.6], [0.83, 0.6]], 3);
      fill(poly(V), { c: '#050506', r: 0.7, m: 0, h: -5 });
      clipTo(poly(V), () => { for (let y = 0.44; y < 0.6; y += 0.03) stroke(line([[0.6, y], [1.2, y]]), 0.009, { c: '#1b1b1e', h: 1.5 }); });
    }
    // 車牌凹槽 (保桿中央)
    // 凹槽是幾何 (rearCut)；這裡只補凹槽上半部的陰影 (陰影貼圖照不出 2 cm 深的自遮蔽)
    fill(rpoly([[-0.2, PLATE.y0], [PLATE.hx, PLATE.y0], [PLATE.hx, PLATE.y1], [-0.2, PLATE.y1]], [0, PLATE.rc, PLATE.rc, 0]), { c: lgrad(0, PLATE.y1, 0, PLATE.y1 - 0.07, [[0, 'rgba(0,0,0,0.5)'], [1, 'rgba(0,0,0,0)']]) });
    // 保桿上緣接縫 (尾燈下方 → 車角 → 輪拱)，行李廂蓋接縫 (下緣 → 兩燈之間往上 → 鴨尾)
    gap(mapLine(RP, [[-0.05, 0.735], [0.52, 0.735], [0.78, 0.75], [0.9, 0.74]]).concat([[uAR - AR + 0.012, 0.72]]));
    gap(mapLine(RP, [[-0.05, 0.762], [0.5, 0.762], [0.535, 0.8], [0.548, 0.93], [0.56, 1.04]], 6));
    stroke(line(mapLine(RP, [[-0.05, 0.925], [0.33, 0.925]])), 0.02, { h: 1.0 });       // 行李廂蓋上的橫向折線 (微凸)
    // ---- 四圓尾燈：外側大、內側小；黑色燈座 → 紅色 LED 光環 → 鍍鉻內環 → 中心 (外側 = 煞車、內側 = 方向燈)
    //      燈碗由 rearCut 塑形，黑色燈座覆蓋到碗口的圓唇。
    for (const [[cx, cy, r], inner] of [[LAMPS[0], 0], [LAMPS[1], 1]]) {
      const C = (k) => poly(mapCirc(RP, cx, cy, r * k));
      const cu = RP(cx, cy)[0];
      fill(C(1.15), { c: '#1c1c1f', r: 0.5, m: 0 });
      fill(C(1.08), { c: '#060607', r: 0.6, m: 0 });
      fill(C(1.0), { c: rgrad(cu, cy, r, [[0, '#2c0508'], [0.6, '#3c070b'], [1, '#1e0305']]), r: 0.10, m: 0, h: 0.8, mask: '#1c0000', lens: 0.013 });
      clipTo(C(1.0), () => {
        stroke(C(0.8), r * 0.21, { c: '#c2161f', mask: '#990000', r: 0.08 });
        stroke(C(0.8), r * 0.05, { c: '#ff6a5c' });
        stroke(C(0.57), r * 0.05, { c: '#b9bdc2', r: 0.15, m: 1 });
        if (inner) fill(C(0.42), { c: rgrad(cu, cy, r * 0.42, [[0, '#ebe4d4'], [1, '#8f8c82']]), r: 0.1, m: 0, mask: '#008c00' });
        else fill(C(0.42), { c: rgrad(cu, cy, r * 0.42, [[0, '#d8262e'], [1, '#6c0a10']]), r: 0.08, m: 0, mask: '#990000' });
        const g = X.A;
        g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 0.002;
        for (const k of [0.22, 0.32]) { C(k)(g); g.stroke(); }
        stroke(C(1.0), 0.012, { c: 'rgba(0,0,0,0.45)' });
      });
    }
    // 後葉子板後端的直立銀色飾條 (輪拱後方)
    fill(poly(mapPoly(SP, [[2.02, 0.56], [2.05, 0.56], [2.07, 0.8], [2.04, 0.8]], 3)), Object.assign({ h: 1.2 }, CHR));

    // ================= 車側 =================
    {
      // 車門 (長門)：前緣在葉子板出風口後方、後緣沿後輪拱前方
      const zD0 = 0.6, zD1 = -0.7;
      gap(mapLine(SP, [[zD0 + 0.05, ySill(zD0)], [zD0, 0.77], [zD0 - 0.09, 0.4], [zD0 - 0.12, 0.2]], 6));
      gap(mapLine(SP, [[zD1, ySill(zD1)], [zD1 - 0.015, 0.78], [zD1 + 0.16, 0.30], [zD1 + 0.17, 0.2]], 6));
      gap([[uz(zD0 - 0.12), 0.2], [uz(zD1 + 0.17), 0.2]]);
      K.handle(0.33, 0.47, 0.888, 0.918, true);                                    // 平貼式鍍鉻門把
      // 側裙 (黑) + 上緣一道稜線
      fill(rect(uAR + AR + 0.02, 0.05, uAF - AR - 0.02, 0.172), Object.assign({ h: 1.2 }, BLK));
      stroke(line([[uAR + AR + 0.03, 0.24], [uAF - AR - 0.03, 0.24]]), 0.05, { h: 1.6 });
      // 前葉子板出風口：斜向的黑色開口 + 銀色刀片飾條，往後拉出一條上揚的腰線
      const VT = mapPoly(SP, [[-0.938, 0.807], [-0.758, 0.792], [-0.62, 0.328], [-0.655, 0.305], [-0.838, 0.734]], 5);
      fill(poly(VT), { c: '#050506', r: 0.6, m: 0, h: -6 });
      stroke(poly(VT), 0.008, { c: '#101012', h: -2, r: 0.6 });
      fill(poly(mapPoly(SP, [[-0.941, 0.809], [-0.754, 0.795], [-0.773, 0.758], [-0.851, 0.742]], 3)), Object.assign({ h: 1.5 }, CHR));
      stroke(line(mapLine(SP, [[-0.77, 0.746], [-0.641, 0.326]], 8)), 0.008, { c: '#5c6265', r: 0.35, m: 0.62 });
      gap(mapLine(SP, [[-1.86, 0.64], [-1.86, 0.3]], 3));                                                       // 前保桿接縫
      // 輪拱捲邊 (微凸一圈)
      for (const [zc, R] of [[M.AXF, M.ARF], [M.AXR, M.ARR]]) {
        const p = [];
        for (let a = 0; a <= 180; a += 6) { const t = (a * Math.PI) / 180; p.push([uz(zc - Math.cos(t) * (R + 0.022)), AY + Math.sin(t) * (R + 0.022)]); }
        stroke(line(p), 0.03, { h: 1.6 });
      }
    }
    // 側窗：無框車門玻璃 + 後三角窗。上緣跟著車頂，過了 B 柱之後急轉直下 —— R35 招牌的 C 柱折角
    {
      const ySl = (z) => ySill(z) + 0.012;
      const yTop = (z) => Math.min(yrS(z) - 0.076, 1.30 - Math.max(z - 0.72, 0) * 0.44);
      const yA = (z, ins) => 0.95 + (z + 0.63 - ins * 2.2) / 1.95;
      // A 柱塗黑 (懸浮車頂)：側窗前緣到前擋玻璃邊緣之間
      const ap = [];
      for (let y = 0.95; y <= 1.3; y += 0.02) ap.push([uz(-0.63 + (y - 0.95) * 1.95 + 0.03), y]);
      for (let y = 1.3; y >= 0.95; y -= 0.02) ap.push([uz(-0.63 + (y - 0.95) * 1.95 - 0.17), y]);
      fill(poly(ap), { c: '#070708', r: 0.3, m: 0 });
      K.sideWindows({ z0: -0.66, z1: 1.34, ySl, yTop, yA, panes: [[-0.64, 0.51], [0.545, 1.30]] });
    }

    // ================= 車頭 =================
    {
      const FPP = pts => poly(pts.map(([x, y]) => FP(x, y)));
      // 六角網的中心對準車身中線。每格只畫三條共用邊。
      const honeycomb = (u0, u1, y0, y1, radius, height) => {
        const g = X.A, pitch = radius * 1.5;
        g.beginPath();
        for (let i = Math.floor((u0 - INFO.UFC) / pitch) - 1; INFO.UFC + i * pitch < u1 + radius; i++) {
          const u = INFO.UFC + i * pitch;
          for (let y = y0 - height + (i & 1) * height / 2; y <= y1 + height; y += height) {
            g.moveTo(u - radius, y);
            g.lineTo(u - radius / 2, y + height / 2);
            g.lineTo(u + radius / 2, y + height / 2);
            g.lineTo(u + radius, y);
          }
        }
        g.strokeStyle = '#30353a'; g.lineWidth = radius * 0.11; g.stroke();
      };
      fill(FPP(FR.mouth), { c: lgrad(0, 0.56, 0, 0.38, [[0, '#383b40'], [0.19, '#2a2c30'], [0.77, '#202124'], [1, '#101114']]), r: 0.39, m: 0.12 });
      fill(FPP(FR.grille), { c: '#090b0d', r: 0.78, m: 0 });
      clipTo(FPP(FR.grille), () => honeycomb(uf(0.42), INFO.UFC + 0.06, 0.584, 0.686, 0.024, 0.021));
      fill(FPP(FR.lower), { c: '#090b0d', r: 0.79, m: 0 });
      clipTo(FPP(FR.lower), () => {
        clipTo(rect(uf(0.416), 0.267, INFO.UFC + 0.06, 0.408),
          () => honeycomb(uf(0.416), INFO.UFC + 0.06, 0.267, 0.408, 0.023, 0.020));
        fill(FPP([[0.413, 0.239], [0.426, 0.239], [0.426, 0.421], [0.413, 0.421]]), { c: '#272a2c', r: 0.49 });
      });
      fill(FPP(FR.chrome), { c: lgrad(0, 0.61, 0, 0.548, [[0, '#878c90'], [0.52, '#737a80'], [0.83, '#b6bcc2'], [1, '#929a9e']]), r: 0.3, m: 0.75 });
      fill(FPP(FR.side), { c: '#0a0c0f', r: 0.68, m: 0 });
      clipTo(FPP(FR.side), () => {
        honeycomb(FP(0.865, 0.25)[0] - 0.10, FP(0.71, 0.50)[0] + 0.04, 0.24, 0.54, 0.013, 0.016);
        stroke(FPP(FR.side), 0.014, { c: '#101215', r: 0.52 });
      });
      // 每側四格日行燈，共用一條向外上揚的透明燈罩。
      const lightY = x => 0.476 + (x - 0.728) * 0.23;
      const lightStrip = (a, b, bottom, top) => FPP([[a, lightY(a) + bottom], [b, lightY(b) + bottom],
        [b, lightY(b) + top], [a, lightY(a) + top]]);
      fill(lightStrip(0.726, 0.844, 0, 0.030), { c: '#545e65', r: 0.21, m: 0.32 });
      for (let i = 0; i < 4; i++) {
        const x = 0.73 + i * 0.028;
        fill(lightStrip(x, x + 0.025, 0.003, 0.027), { c: '#e1e8ea', r: 0.16, m: 0, mask: '#0000a8', lens: 0.006 });
      }
      drawHeadlight(FP);
    }
    end();

    // ================= 俯視 (z, |x|) =================
    region('top');
    const qcurve = K.qcurve;
    // 頭燈落在朝上斜面的那一部分
    drawHeadlight(TP);
    // 引擎蓋接縫：前緣 (水箱罩上方) → 沿頭燈上緣的內段 → 沿葉子板內緣稜線 → 前擋下方、NACA 導風口、雨刷蓋板
    gap(qcurve(-2.247, 0.155, -0.04, 0.53).concat([TP(0.622, 0.709), TP(0.731, 0.792), [-1.65, 0.733], [-0.84, 0.715]]), 0.004);
    const duct = poly([[-1.504, 0.365], [-1.473, 0.355], [-1.40, 0.346], [-1.303, 0.305],
      [-1.244, 0.307], [-1.228, 0.319], [-1.228, 0.422], [-1.255, 0.431], [-1.365, 0.395]]);
    fill(duct, { c: lgrad(-1.25, 0, -1.5, 0, [[0, '#16191c'], [0.24, '#393e42'], [1, '#252a2e']]), r: 0.47, h: -4 });
    clipTo(duct, () => fill(rect(-1.259, 0.30, -1.22, 0.44), { c: '#080a0b', h: -7, r: 0.78 }));
    fill(poly(qcurve(-0.865, 0.28, -0.05, 0.75).concat(qcurve(-0.775, 0.28, -0.05, 0.75).reverse())), { c: '#0b0b0c', r: 0.7, m: 0, h: -3 });
    // 前擋：A 柱塗黑 (玻璃兩側的黑邊加寬) + 玻璃
    {
      const zb = -0.76, zt = -0.105, kq = 0.28;
      fill(poly(qcurve(zb - 0.02, kq, 0.6, 0.83, 6).concat(qcurve(zt + 0.03, kq, 0.45, 0.68, 6).reverse())), { c: '#070708', r: 0.3, m: 0 });
      K.topGlass({ zb, zt, k: kq, wb: 0.745, wt: 0.565 });
    }
    // 後擋 (斜背)：除霧線、頂端第三煞車燈
    K.topGlass({ zt: 1.035, zb: 1.735, k: -0.32, wt: 0.44, wb: 0.555, defrost: { z0: 1.14, dz: 0.046, n: 12 }, brake: { z0: 1.07, z1: 1.096, w: 0.13 } });
    // 行李廂蓋接縫 (玻璃下緣 → 兩側往後)
    {
      const p = qcurve(1.79, -0.32, -0.05, 0.5, 12);
      p.push([1.74, 0.545], [1.78, 0.56], [2.45, 0.56]);
      gap(p);
    }
    // 窗下飾條在俯視的對應 (肩線圓角處兩個投影都看得到)
    {
      const p = [];
      for (let z = -0.56; z <= 1.24; z += 0.04) p.push([z, Wg(ySill(z) + 0.012, z) + 0.008]);
      stroke(line(p), 0.026, { c: '#0c0c0e', r: 0.3, m: 0, cap: 'butt' });
    }
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
    g.fillText('GTR-0035', 128, 68, 226);
    // GT-R 徽章 (262,8)-(412,104)：鍍鉻外框的黑色圓角牌，上排銀色 GT、下排紅色 R (R35 的疊字徽章)
    rr(264, 10, 146, 92, 16); g.fillStyle = '#d8dbdf'; g.fill();
    rr(271, 17, 132, 78, 11); g.fillStyle = '#141517'; g.fill();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'italic 900 40px Arial, sans-serif'; g.fillStyle = '#dfe2e6'; g.fillText('GT', 337, 39);
    g.font = 'italic 900 46px Arial, sans-serif'; g.fillStyle = '#c8102e'; g.fillText('R', 340, 75);
    g.lineWidth = 2; g.strokeStyle = '#e6e8eb'; g.strokeText('R', 340, 75);
    // 水箱罩上的徽章直接固定於網格，字樣之間能看見後面的孔。
    g.font = 'italic 900 52px Arial, sans-serif';
    g.lineWidth = 3; g.strokeStyle = '#33383d'; g.strokeText('GT', 322, 166, 91);
    g.fillStyle = '#d8dce1'; g.fillText('GT', 322, 166, 91);
    g.font = 'italic 900 77px Georgia, serif';
    g.strokeStyle = '#dee1e4'; g.lineWidth = 6; g.strokeText('R', 328, 205);
    g.fillStyle = '#b71022'; g.fillText('R', 328, 205);
    g.textBaseline = 'alphabetic';
    // NISSAN 圓形廠徽 (8,136)-(120,248)
    g.strokeStyle = '#d4d6da'; g.lineWidth = 9;
    g.beginPath(); g.arc(64, 192, 48, 0, 6.2832); g.stroke();
    g.fillStyle = '#d4d6da'; g.fillRect(6, 178, 116, 28);
    g.fillStyle = '#1a1b1d'; g.font = '900 22px sans-serif'; g.textAlign = 'center'; g.fillText('NISSAN', 64, 193, 104);
    return { canvas: c, uv: { plate: [0.5 / 512, 0.5 / 256, 255.5 / 512, 127.5 / 256], gtr: [262 / 512, 8 / 256, 412 / 512, 104 / 256],
      frontGtr: [273 / 512, 139 / 256, 372 / 512, 244 / 256], nissan: [6 / 512, 134 / 256, 122 / 512, 250 / 256] } };
  }

  // ------------------------------------------------------------------ 零件
  const GUN = RM.mat('#4a4d51', 0.32, 0.85);        // 槍灰色鍛造輪圈
  const CAL = RM.mat('#c7961c', 0.4, 0.3);          // 金橘色卡鉗
  function buildFrontLip(body) {
    // 沿保桿下緣繞回前輪，斷面前端較薄，後端嵌入車身。
    const half = [[0, -2.318], [0.28, -2.31], [0.49, -2.29], [0.62, -2.255],
      [0.724, -2.195], [0.796, -2.126], [0.849, -2.043], [0.868, -1.969], [0.879, -1.89], [0.88, -1.825]];
    const outline = half.slice().reverse().concat(half.slice(1).map(([x, z]) => [-x, z]));
    const path = outline.map(([x, z], i) => {
      const prev = outline[Math.max(0, i - 1)], next = outline[Math.min(i + 1, outline.length - 1)];
      const dx = next[0] - prev[0], dz = next[1] - prev[1], length = Math.hypot(dx, dz);
      return { p: [x, 0.134 + 0.009 * sstep(0.7, 0.88, Math.abs(x)), z], r: [-dz / length, 0, dx / length] };
    });
    body.extrude(path, [[-0.12, -0.012], [0.028, -0.009], [0.031, 0.005], [0.016, 0.015], [-0.12, 0.025]], MAT.trim);
  }
  function buildRearSpoiler(body) {
    // 原廠尾翼中央較薄，兩側往前彎、加厚，直接落在行李廂蓋上。
    // 每個斷面由半寬位置、前緣 z、弦長、翼頂與翼底高度定義。
    const half = [[0, 2.072, 0.212, 1.174, 1.137], [0.30, 2.063, 0.213, 1.173, 1.135],
      [0.54, 2.027, 0.232, 1.169, 1.128], [0.65, 1.995, 0.247, 1.159, 1.109],
      [0.716, 1.975, 0.248, 1.143, 1.043], [0.752, 1.979, 0.233, 1.122, 1.017],
      [0.792, 1.985, 0.152, 1.036, 0.963]];
    const stations = half.slice(1).reverse().map(([x, ...section]) => [-x, ...section]).concat(half);
    const section = [[0, 0.53], [0.055, 0.84], [0.20, 1], [0.58, 0.97], [0.92, 0.78],
      [1, 0.61], [0.96, 0.44], [0.57, 0.20], [0.24, 0], [0.05, 0.21]];
    const rings = stations.map(([x, z, chord, top, bottom]) =>
      section.map(([along, height]) => [x, bottom + height * (top - bottom), z + chord * along]));
    // 以相鄰斷面求平滑法線，車漆反光會沿翼面一路延伸到翼腳。
    const ringSize = section.length, base = body.vcount;
    for (let i = 0; i < rings.length; i++) {
      const ring = rings[i], prev = rings[Math.max(0, i - 1)], next = rings[Math.min(rings.length - 1, i + 1)];
      for (let j = 0; j < ringSize; j++) {
        const chordwise = RM.v3.sub([], ring[(j + 1) % ringSize], ring[(j + ringSize - 1) % ringSize]);
        const spanwise = RM.v3.sub([], next[j], prev[j]);
        const n = RM.v3.norm([], RM.v3.cross([], chordwise, spanwise));
        body.v(...ring[j], ...n, 0, 0, MAT.paint);
        if (!i) continue;
        const a = base + (i - 1) * ringSize + j, b = base + (i - 1) * ringSize + (j + 1) % ringSize;
        body.tri(a, b, b + ringSize); body.tri(a, b + ringSize, a + ringSize);
      }
    }
    for (const i of [0, rings.length - 1]) {
      const sign = i === 0 ? -1 : 1;
      const rim = rings[i].map(p => body.v(...p, sign, 0, 0, 0, 0, MAT.paint));
      for (let j = 1; j < ringSize - 1; j++) {
        if (sign > 0) body.tri(rim[0], rim[j], rim[j + 1]);
        else body.tri(rim[0], rim[j + 1], rim[j]);
      }
    }
    const deck = S.topP(0, 2.15)[1];
    body.box(0, (deck + 1.15) * 0.5, 2.15, 0.055, 1.15 - deck, 0.10, 0, MAT.trim);
  }
  function buildParts(D) {
    const body = new MeshBuilder(), decal = new MeshBuilder();
    const rear = (x, y) => rearP(x, y), front = (x, y) => frontP(x, y);
    // 車牌 (後保桿凹槽 / 前保桿飾板)、GT-R 徽章 (水箱罩中央 / 行李廂蓋右側)、NISSAN 廠徽 (行李廂蓋中央)
    patch(decal, rear, [-0.17, 0, 0.17], [0.688, 0.522], 0.005, MAT.plate, D.uv.plate);
    patch(decal, front, [0.17, 0, -0.17], [0.528, 0.426], 0.008, MAT.plate, D.uv.plate);
    patch(decal, front, [0.051, 0, -0.051], [0.679, 0.597], 0.012, MAT.chromeTex, D.uv.frontGtr);
    patch(decal, rear, [0.235, 0.285, 0.335], [0.84, 0.77], 0.004, MAT.chromeTex, D.uv.gtr);      // 內側尾燈左下
    patch(decal, rear, [-0.05, 0, 0.05], [1.0, 0.9], 0.004, MAT.chromeTex, D.uv.nissan);
    // 四支大口徑排氣尾管 (左右各兩支) + 消音器
    for (const x of [-0.66, -0.48, 0.48, 0.66]) {
      const end = rearP(x, 0.282)[2] + 0.060;
      body.cyl([x, 0.282, end - 0.15], [x, 0.282, end], 0.061, 0.064, 24, MAT.chrome, false);
      body.cyl([x, 0.282, end - 0.019], [x, 0.282, end - 0.013], 0.06, 0.06, 24, MAT.under, true);
    }
    body.cyl([-0.4, 0.26, 1.6], [0.4, 0.26, 1.6], 0.11, 0.11, 12, MAT.muffler, true);
    PC.wheelArches(body, S, MAP, 0.905, ybS);
    PC.underbody(body, S, MAP, ybS, -2.25, 2.22);
    buildFrontLip(body);
    // 行李廂蓋上的車色尾翼，兩端下收至後車肩。
    buildRearSpoiler(body);
    // 後照鏡 (車門上的流線鏡殼 + 黑色鏡座)、車頂後端的鯊魚鰭
    for (const sx of [-1, 1]) {
      PC.ellipsoid(body, [sx * 1.03, 1.04, -0.44], [0.105, 0.058, 0.05], MAT.paint, 16, 10);
      body.quad([sx * 1.115, 1.0, -0.398], [sx * 0.955, 1.0, -0.398], [sx * 0.955, 1.078, -0.398], [sx * 1.115, 1.078, -0.398], MAT.mirror);
      body.box(sx * 0.915, 1.0, -0.44, 0.08, 0.03, 0.065, 0, MAT.black);
    }
    {
      const p = S.topP(0, 0.92);
      if (p) PC.ellipsoid(body, [0, p[1] + 0.012, 0.92], [0.02, 0.032, 0.07], MAT.paint, 10, 8);
    }
    // 內裝：桶椅、後座、儀表台、中控
    for (const sx of [-1, 1]) {
      body.box(sx * 0.38, 0.44, 0.22, 0.48, 0.13, 0.5, 0, MAT.fabric);
      body.box(sx * 0.38, 0.78, 0.52, 0.48, 0.62, 0.12, 0, MAT.fabric);
      body.box(sx * 0.38, 1.12, 0.55, 0.22, 0.13, 0.09, 0, MAT.fabric);
      body.box(sx * 0.78, 0.6, 0.1, 0.04, 0.42, 1.6, 0, MAT.dash);
    }
    body.box(0, 0.56, 1.02, 1.2, 0.32, 0.4, 0, MAT.fabric);
    body.box(0, 0.95, 1.45, 0.9, 0.03, 0.5, 0, MAT.dash);
    body.box(0, 0.82, -0.52, 1.5, 0.28, 0.36, 0, MAT.dash);
    body.box(-0.38, 0.985, -0.44, 0.4, 0.05, 0.16, 0, MAT.dash);
    body.cyl([-0.38, 0.87, -0.36], [-0.38, 0.92, -0.26], 0.03, 0.03, 6, MAT.dash, false);
    body.box(0, 0.54, 0.05, 0.24, 0.3, 1.0, 0, MAT.dash);
    body.box(0, 0.25, 0.3, 1.5, 0.05, 2.3, 0, MAT.fabric);
    return { body, decal };
  }

  // ------------------------------------------------------------------ 規格：VR38DETT 3.8 V6 雙渦輪 570 PS、六速雙離合、四驅
  const SPEC_OVER = {
    mass: 1752 + 75, cgH: 0.48, frontW: 0.54, drive: 'AWD', cyl: 6, idle: 850, redline: 7000, cut: 7300, engI: 0.2, dct: true,
    torque: [[0, 220], [1000, 330], [2000, 480], [3000, 615], [3300, 637], [5800, 637], [6400, 612], [6800, 588], [7100, 540], [7600, 380]],
    ratios: [4.056, 2.301, 1.595, 1.248, 1.001, 0.796], final: 3.7, rev: 3.383, tireRRef: TIRE_R, speedoMax: 340,
    mu: 1.34, muRear: 1.13, cd: 0.27, area: 2.25, lift: -0.2, brakeF: 3300, brakeR: 2100, steerMax: 35 * Math.PI / 180, stiff: 1.5,
    // 性能調校：寫法照 R34 (同樣是四驅重車)。引擎扭力大所以起步輔助給得比 R34 少；
    //   甩尾角全車款最小、弧線最大 (車最寬最重)，氮氣推力最大
    launch: [3200, 10, 65],
    drift: { angle: 0.31, angleIn: 0.15, turn: 0.94, charge: 0.95, boost: 4700, nitro: 6500 },
  };
  function spec() {
    const Sp = RM.makeSpec(SPEC_OVER, { L: 4.71, W: 1.895, H: 1.37 - DROP, minZ: -2.355, maxZ: 2.355, clear: 0.11, zF: MAP.AXF, zR: MAP.AXR, trackF: 1.59, trackR: 1.6, tireR: TIRE_R });
    // 相機 / 燈位：車身座標 → 相對重心
    const rel = (x, y, z) => [x, y - DROP - Sp.cgH, z - Sp.cgZ];
    Sp.eye = rel(-0.38, 1.13, 0.28); Sp.hood = rel(0, 1.07, -0.9); Sp.bumper = rel(0, 0.45, -2.42);
    Sp.lampF = rel(...frontP(0.661, 0.686)); Sp.lampR = rel(0.67, 0.868, 2.3); Sp.exhaust = rel(-0.57, 0.27, 2.36);
    // 四支尾管 (左右各兩支，位置同上面畫尾管的迴圈)：氮氣火焰每支都噴
    Sp.exhausts = [-0.66, -0.48, 0.48, 0.66].map((x) => rel(x, 0.282, rearP(x, 0.282)[2] + 0.085));
    Sp.exhaust = Sp.exhausts[0];
    return Sp;
  }

  RM.R35Tex = { build: buildTex };
  PC.register('r35', {
    build() {
      const D = buildDecalTex();
      const { body, decal } = buildParts(D);
      return {
        shell: PC.buildShell(S, SHELL_BOX).build(), body: body.build(), glass: null, decal: decal.build(),
        ...PC.wheelSet({ R: TIRE_R, RW: 0.254, Wd: 0.27, spokes: 7, style: 'twin', sw: [0.0075, 0.0105], split: [0.02, 0.052], dish: 0.022, concave: 0.022, spokeMat: GUN, rim: GUN, rimDark: MAT.rimBlack2, cap: MAT.rimBlack, caliper: CAL, pistons: 2, disc: 0.2 }),
        steer: PC.buildSteering().build(),
        tex: PC.uploadTex(buildTex(PC.texSize())), decalTex: RM.GLU.texture(D.canvas, { aniso: 8, clamp: true }),
        map: MAP, mapU: INFO.uniforms, DROP,
        steerPos: [-0.38, 0.93, -0.22], tailLamp: [0.67, 0.868, 2.3],
        spec,
      };
    },
  });
})();
