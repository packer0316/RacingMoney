'use strict';
// 喜美 K8 四門 (Civic 六代 EK / Ferio，1996-1998 前期) 程序化模型 —— 作法見 proc_car.js
// 車身座標：-z = 車頭，x = 右，y = 原廠車高時離地高度；全長 4450 / 寬 1705 / 軸距 2620 mm
// 繪製時整個車身再下降 DROP (低趴)，輪子位置不變。
// 造型重點 (對照實車照片)：90 年代圓潤的車頭 (俯視是大圓角)、低而斜的引擎蓋上有兩條往水箱罩收的 V 形稜線、
// 大片前擋、圓弧車頂、很斜的後擋接又短又高的行李廂、門把下緣一條貫穿前後的腰線、環繞車角的尾燈。
(function () {
  const RM = window.RM;
  const PC = RM.ProcCar;
  const { MeshBuilder } = RM;
  const { sq, sstep, pn, rmax, smin, softPos, spline, MAT } = PC;

  // 貼圖投影座標 (說明見 proc_car.js 的 mapInfo)。車頭角的圓弧取得比車尾大 (車頭俯視比較圓)；
  // UMAX 要蓋到車頭中心 (頭燈、水箱罩都畫在貼圖上)
  const MAP = {
    XC: 0.56, ZC: 1.86, RC: 0.31, XCF: 0.5, ZCF: -1.78, RCF: 0.38, UMAX: 5.86, Y0: 0.06, Y1: 1.42, Z0: -2.3, Z1: 2.3, XMAX: 0.92,
    AXF: -1.365, AXR: 1.255, ARF: 0.365, AYF: 0.325, ARR: 0.365, AYR: 0.325, ARCH_IN: 0.5,
  };
  const INFO = PC.mapInfo(MAP);
  const AXLE_F = MAP.AXF, AXLE_R = MAP.AXR;
  const DROP = 0.05;

  // ------------------------------------------------------------------ 車身外形 (隱式)
  // 下車身頂面中心線高度：引擎蓋前緣 → 引擎蓋 (一路斜上去) → 前擋下緣 → 腰線 → 又短又高的行李廂蓋
  const ylS = spline([[-2.26, 0.62], [-2.2, 0.7], [-2.14, 0.73], [-2.0, 0.75], [-1.8, 0.78], [-1.5, 0.83], [-1.2, 0.868], [-0.95, 0.893], [-0.7, 0.903],
    [-0.3, 0.91], [0.4, 0.92], [1.1, 0.94], [1.5, 0.962], [1.75, 0.983], [2.0, 0.99], [2.15, 0.985], [2.26, 0.965]]);
  // 底盤高度 (前後懸上收)
  const ybS = spline([[-2.26, 0.3], [-2.05, 0.215], [-1.8, 0.175], [-1.0, 0.17], [1.0, 0.17], [1.6, 0.185], [1.9, 0.25], [2.26, 0.35]]);
  // 車尾側面輪廓 z(y)：保桿下緣內收 → 保桿最凸 → 保桿上緣平台 → 尾板 (略前傾) 到行李廂蓋後緣
  const ZrS = spline([[0.14, 2.02], [0.2, 2.12], [0.26, 2.19], [0.32, 2.218], [0.4, 2.225], [0.6, 2.225], [0.655, 2.218], [0.685, 2.2], [0.705, 2.178], [0.8, 2.168], [0.93, 2.16], [1.0, 2.156], [1.1, 2.15]]);
  // 車頭側面輪廓：保桿最凸，頭燈 / 水箱罩那一面往後仰 (但不能仰太多：太平的面會改用俯視投影，頭燈貼圖就糊掉)
  const ZfS = spline([[0.12, -2.02], [0.2, -2.13], [0.26, -2.19], [0.33, -2.218], [0.42, -2.225], [0.5, -2.225], [0.56, -2.221], [0.62, -2.212], [0.68, -2.196], [0.72, -2.172], [0.76, -2.125], [0.82, -2.03], [1.0, -1.8]]);
  // 車頂中心線：最高點在 B 柱上方，前後都是圓弧
  const yrS = spline([[-0.6, 1.26], [-0.25, 1.325], [0.0, 1.36], [0.3, 1.381], [0.55, 1.386], [0.85, 1.376], [1.1, 1.35], [1.35, 1.305], [1.7, 1.22]]);
  // 俯視半寬：車門最寬，輪拱處略窄 (加上輪拱捲邊後剛好全寬)，頭尾收窄
  const WzS = spline([[-2.3, 0.79], [-1.9, 0.822], [-1.365, 0.838], [-0.7, 0.849], [0.1, 0.8525], [0.8, 0.8525], [1.255, 0.84], [1.8, 0.825], [2.3, 0.79]]);

  const YM = 0.55;                 // 下車身上下半部的分界
  const ZC_R = 1.45, ZC_F = -1.42; // 前後端俯視圓角開始的位置
  const YGB = 0.8;                 // 座艙 (玻璃罩) 的底

  const Wz = (z) => WzS(z);
  // 腰線稜線的高度：由頭燈上緣往後微微上揚到尾燈上緣 (門把就在它下面)
  const yCr = (z) => 0.772 + 0.05 * sstep(-1.7, 1.9, z);
  // 輪拱：原廠只有薄薄一圈捲邊 + 葉子板微微鼓出
  const flare = PC.archFlare(MAP, { lipF: 0.007, lipR: 0.007, lipW: 0.04, blF: 0.008, blR: 0.009, blW: 0.2 });
  // 下車身側面半寬：腰部 (防擦條高度) 最寬、往下收進門檻；稜線以上往內傾接到窗台 —— 斜率在稜線處轉折，反光才會斷出一條線
  function Ws(y, z) {
    const d = y - 0.58, k = y - yCr(z);
    return WzS(z) - (d < 0 ? 0.05 * sq(d / 0.42) : 0.012 * sq(d / 0.22)) - 0.055 * (k + Math.sqrt(k * k + 0.00012)) + (y < 0.95 ? flare(y, z) : 0);
  }
  // 引擎蓋中央隆起的範圍 (半寬)：前擋下緣最寬，往水箱罩收窄 —— 邊緣就是那兩條 V 形稜線
  const xV = (z) => 0.27 + 0.36 * sstep(-2.1, -0.95, z);
  function Tl(ax, z) {
    const hood = sstep(-0.82, -1.25, z);
    const c = 0.022 + 0.012 * hood + 0.014 * sstep(1.55, 1.85, z);
    const r = ax / 0.85;
    let y = ylS(z) - c * r * r;
    if (hood > 0) { const xv = xV(z); y += 0.008 * hood * sstep(xv + 0.022, xv - 0.022, ax); }
    if (z > 2.0) { const k = ax / 0.74, k4 = k * k * k * k; if (k4 < 1) y += 0.012 * sstep(2.02, 2.14, z) * (1 - k4); } // 行李廂蓋後緣微微上翹
    return y;
  }
  function sdLower(ax, y, z) {
    // 俯視輪廓：側面與車頭 / 車尾以 p-norm 連成圓角 (指數越小越圓：車頭 3.2 很圓、車尾 3.9)
    const a = ax / Ws(y, z);
    let b = 0, np = 4.6;
    if (z > ZC_R) { b = (z - ZC_R) / (ZrS(y) - 0.045 * sq(ax / 0.85) - ZC_R); np = 3.9; }
    else if (z < ZC_F) { b = (ZC_F - z) / (ZC_F - ZfS(y) - 0.065 * sq(ax / 0.85)); np = 3.2; }
    const dP = (pn(a, b, np) - 1) * 0.8;
    if (y > YM) {
      // 肩部圓角：葉子板 / 引擎蓋最圓，車門較俐落；正前、正後的上緣收小 (頭燈、尾燈那一面才不會被圓角吃掉)
      const R = 0.058 + 0.03 * sstep(-0.8, -1.25, z) + 0.012 * sstep(1.5, 1.8, z) - (z < 0 ? 0.045 : 0.03) * sstep(0.8, 0.98, b);
      return rmax(dP, y - Tl(ax, z), R);
    }
    return rmax(dP, ybS(z) - y, 0.075);
  }
  const ySill = (z) => 0.872 + 0.036 * sstep(-0.8, 1.5, z);   // 車窗下緣 (腰線往後微微上揚)
  // 座艙側面：窗台處比車身內縮一小階，往上內傾 (tumblehome) 越來越多；後柱在俯視往內收
  function Wg(y, z) {
    const dy = softPos(y - ySill(z));
    return WzS(z) - 0.046 - 0.03 * sstep(0.8, 1.7, z) - 0.016 * sstep(-0.2, -0.9, z) - 0.44 * dy - 0.5 * dy * dy;
  }
  const zWs = (y, ax) => -0.935 + (y - 0.895) * 1.95 + 0.25 * ax * ax;  // 前擋玻璃面 (很斜、下緣很前面)
  const zRg = (y, ax) => 1.77 - (y - 0.975) * 1.7 - 0.18 * ax * ax;    // 後擋玻璃面
  const yRoof = (ax, z) => yrS(z) - 0.045 * sq(ax / 0.6);
  function sdGreen(ax, y, z) {
    const dz = Math.max(zWs(y, ax) - z, z - zRg(y, ax));
    const dP = rmax(ax - Wg(y, z), dz, 0.08);           // A / C 柱圓角
    const d = rmax(dP, y - yRoof(ax, z), 0.07);         // 車頂邊緣圓角
    return Math.max(d, YGB - y);
  }
  // < 0 為車身內部 (近似公尺)
  function sdBody(x, y, z) {
    const ax = x < 0 ? -x : x;
    return smin(sdLower(ax, y, z), sdGreen(ax, y, z), 0.012);
  }
  const S = PC.surface(sdBody);
  const { rearP, frontP } = S;
  const patch = (mb, chart, us, vs, off, M, uv) => PC.patch(mb, S, chart, us, vs, off, M, uv);
  const ellipsoid = PC.ellipsoid;
  // 車殼取樣用的外盒 / 內骨架盒
  const SHELL_BOX = { XO: 0.9, YB: 0.06, YT: 1.42, ZO: 2.26, WI: 0.42, YI0: 0.42, YI1: 0.66, ZI: 1.72 };

  // 環繞帶座標 (u, y) ⇄ 車身表面 (貼圖用：把畫在環繞帶上的圖形換算到俯視投影、或由實際位置求 u)
  function wrapU(ax, z) {
    const dz = z - MAP.ZC;
    if (dz > 0) return Math.min(ax, MAP.XC) + MAP.RC * Math.atan2(Math.max(ax - MAP.XC, 0), dz);
    const df = MAP.ZCF - z;
    if (df <= 0) return MAP.XC + MAP.RC * 1.5707963 - dz;
    return INFO.UF0 + MAP.RCF * Math.atan2(df, Math.max(ax - MAP.XCF, 1e-4)) + Math.max(MAP.XCF - ax, 0);
  }
  function belt3(u, y) {
    if (u < MAP.XC) return rearP(Math.max(u, 0), y);
    if (u < MAP.XC + MAP.RC * 1.5707963) {
      const t = (u - MAP.XC) / MAP.RC, dx = Math.sin(t), dz = Math.cos(t);
      return S.rayIn([MAP.XC + dx * 1.3, y, MAP.ZC + dz * 1.3], [-dx, 0, -dz], 1.3);
    }
    if (u < INFO.UF0) return S.sideP(1)(INFO.KU - u, y);
    if (u < INFO.UF0 + MAP.RCF * 1.5707963) {
      const t = (u - INFO.UF0) / MAP.RCF, dx = Math.cos(t), dz = -Math.sin(t);
      return S.rayIn([MAP.XCF + dx * 1.3, y, MAP.ZCF + dz * 1.3], [-dx, 0, -dz], 1.3);
    }
    return frontP(Math.max(INFO.UFC - u, 0), y);
  }

  function buildParts(atlas) {
    const body = new MeshBuilder(), glass = new MeshBuilder(), decal = new MeshBuilder();

    // ============================ 車頭 ============================
    // 頭燈、水箱罩、下進氣口、霧燈都畫在貼圖上 (有透鏡視差)；這裡只有標誌與車牌
    patch(decal, (x, y) => frontP(x, y), [0.046, 0, -0.046], [0.69, 0.632], 0.01, MAT.chromeTex, atlas.uv('hondaH'));
    patch(decal, (x, y) => frontP(x, y), [0.16, 0, -0.16], [0.545, 0.395], 0.012, MAT.plate, atlas.uv('plate'));

    // ============================ 車尾 ============================
    // 車牌 (行李廂蓋凹槽內)、螺絲、H 標誌、CIVIC / VTEC 字樣
    const rear = (x, y) => rearP(x, y);
    patch(decal, rear, [-0.16, 0, 0.16], [0.866, 0.716], 0.005, MAT.plate, atlas.uv('plate'));
    for (const x of [-0.115, 0.115]) {
      const p = rearP(x, 0.844);
      if (p) decal.cyl([p[0], p[1], p[2]], [p[0], p[1], p[2] + 0.009], 0.007, 0.007, 6, MAT.chrome, true);
    }
    patch(decal, rear, [-0.036, 0, 0.036], [0.95, 0.904], 0.005, MAT.chromeTex, atlas.uv('hondaH'));
    patch(decal, rear, [-0.36, -0.295, -0.23], [0.94, 0.914], 0.004, MAT.chromeTex, atlas.uv('civicBadge'));
    patch(decal, rear, [0.235, 0.295, 0.355], [0.94, 0.914], 0.004, MAT.chromeTex, atlas.uv('vtecBadge'));
    // 消音器 + 排氣尾管 (實車在右後，尾管微微下彎)
    body.cyl([0.3, 0.3, 1.62], [0.3, 0.3, 1.98], 0.075, 0.075, 12, MAT.muffler, true);
    body.cyl([0.44, 0.292, 1.98], [0.44, 0.272, 2.165], 0.024, 0.027, 16, MAT.chrome, false);
    body.cyl([0.44, 0.2735, 2.15], [0.44, 0.273, 2.155], 0.0215, 0.0215, 16, MAT.under, true);
    // 輪拱內襯、底盤封板
    PC.wheelArches(body, S, MAP, 0.79, ybS);     // 內襯不要做到最外緣：車頭是圓角，太寬會從保桿下緣凸出來
    PC.underbody(body, S, MAP, ybS, -2.1, 2.1);
    // 後照鏡：車門前上角的黑色三角座 + 車色鏡殼 + 鏡片
    for (const sx of [-1, 1]) {
      ellipsoid(body, [sx * 0.93, 0.972, -0.64], [0.094, 0.06, 0.048], MAT.paint, 16, 10);
      body.quad([sx * 1.005, 0.932, -0.6], [sx * 0.862, 0.932, -0.6], [sx * 0.862, 1.012, -0.6], [sx * 1.005, 1.012, -0.6], MAT.mirror);
      body.box(sx * 0.826, 0.942, -0.66, 0.07, 0.05, 0.085, 0, MAT.black);
    }
    // 雨刷 (兩支同向，收在前擋下緣)：臂 + 刷片
    for (const [x0, x1] of [[-0.6, -0.1], [-0.05, 0.5]]) {
      const P = (x) => { const y = 0.912 + 0.012 * (x - x0) / (x1 - x0), z = zWs(y, Math.abs(x)); return [x, y + 0.03, z - 0.018]; };
      body.cyl(P(x0), P(x1), 0.006, 0.005, 5, MAT.black, false);
      const a = P(x0 + 0.08), b = P(x1);
      body.cyl([a[0], a[1] - 0.012, a[2] + 0.012], [b[0], b[1] - 0.012, b[2] + 0.012], 0.008, 0.008, 5, MAT.rubber, false);
    }
    // 車頂天線 (前緣中央偏右，往後傾)
    {
      const p = S.topP(0.32, -0.02);
      if (p) { body.cyl([0.32, p[1] - 0.005, -0.02], [0.32, p[1] + 0.018, -0.02], 0.012, 0.009, 8, MAT.black, true); body.cyl([0.32, p[1] + 0.015, -0.02], [0.32, p[1] + 0.17, 0.1], 0.0028, 0.0018, 5, MAT.black, false); }
    }
    // ============================ 車內 ============================
    for (const sx of [-1, 1]) {
      body.box(sx * 0.37, 0.55, 0.15, 0.5, 0.14, 0.5, 0, MAT.fabric);
      body.box(sx * 0.37, 0.9, 0.42, 0.48, 0.62, 0.12, 0, MAT.fabric);
      body.box(sx * 0.37, 1.235, 0.44, 0.24, 0.13, 0.09, 0, MAT.fabric);
      body.box(sx * 0.37, 1.1, 1.29, 0.22, 0.11, 0.08, 0, MAT.fabric);   // 後座頭枕
      body.box(sx * 0.73, 0.6, 0.35, 0.04, 0.36, 2.0, 0, MAT.dash);        // 門內板
    }
    body.box(0, 0.6, 1.05, 1.3, 0.16, 0.5, 0, MAT.fabric);
    body.box(0, 0.86, 1.27, 1.3, 0.42, 0.14, 0, MAT.fabric);
    body.box(0, 0.925, 1.52, 1.1, 0.03, 0.38, 0, MAT.dash);             // 後置物板
    body.box(0, 0.8, -0.47, 1.44, 0.24, 0.3, 0, MAT.dash);
    body.box(0, 0.855, -0.7, 1.36, 0.04, 0.36, 0, MAT.dash);            // 儀表台上緣 (伸到前擋下緣)
    body.box(0, 0.66, -0.4, 1.4, 0.12, 0.26, 0, MAT.dash);
    body.box(-0.37, 0.93, -0.42, 0.42, 0.06, 0.16, 0, MAT.dash);         // 儀表罩
    body.cyl([-0.37, 0.86, -0.36], [-0.37, 0.92, -0.27], 0.03, 0.03, 6, MAT.dash, false); // 轉向柱
    body.box(0, 0.62, -0.3, 0.22, 0.24, 0.6, 0, MAT.dash);              // 中控
    body.box(0, 0.32, 0.4, 1.4, 0.05, 2.2, 0, MAT.fabric);              // 地毯
    return { body, glass, decal };
  }

  RM.CivicModel = {
    AXLE_F, AXLE_R, DROP, MAP,
    // 尾燈中心 (車身座標)
    TAIL_LAMP: [0.62, 0.845, 2.13],
    surface: S,
    shape: { ySill, yrS, ylS, ybS, Wg, Wz, zWs, zRg, yCr, xV, wrapU, belt3 },
    // 車色：[名稱, 顏色, 金屬感] (所有程序化車款共用)
    COLORS: [
      ['銀色', '#b8bcbf', 0.6], ['白色', '#ecebe6', 0.05], ['墨綠', '#1d3a2c', 0.4], ['酒紅', '#5a1220', 0.4],
      ['黑色', '#0f1012', 0.25], ['寶藍', '#1d3a74', 0.45], ['香檳金', '#b9a27a', 0.6],
      // 亮色系 (接在後面：存檔與多人連線用的是車色的編號，前面的順序不能動)
      ['邁阿密藍', '#18a9d6', 0.35], ['霓虹粉', '#ff4fa3', 0.3], ['萊姆綠', '#9be22b', 0.3], ['落日橘', '#ff6b1a', 0.35],
      ['午夜紫', '#4b2a8c', 0.65], ['水泥灰', '#5f6469', 0.05], ['競速黃', '#ffcf1f', 0.25],
    ],
  };

  PC.register('k8', {
    build(atlas) {
      const { body, glass, decal } = buildParts(atlas);
      return {
        shell: PC.buildShell(S, SHELL_BOX).build(), body: body.build(), glass: glass.build(), decal: decal.build(),
        // 原廠 14 吋鋁圈：五支寬輻條
        ...PC.wheelSet({ R: 0.298, RW: 0.1778, Wd: 0.185, spokes: 5, style: 'multi', sw: [0.024, 0.046], bevel: 0.006, lugs: 4, dish: 0.016 }),
        steer: PC.buildSteering().build(),
        tex: PC.uploadTex(RM.CivicTex.build(PC.texSize())), decalTex: null,
        map: MAP, mapU: INFO.uniforms, DROP,
        steerPos: [-0.37, 0.92, -0.26],
        spec: () => RM.CIVIC_SPEC,
      };
    },
  });
})();
