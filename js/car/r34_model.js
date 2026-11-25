'use strict';
// Nissan Skyline GT-R (BNR34, 1999-) 程序化模型 —— 作法見 proc_car.js
// 車身座標：-z = 車頭，x = 右，y = 離地高度；全長 4600 / 寬 1785 / 高 1360 / 軸距 2665 mm，245/40R18
// 造型重點 (對照實車照片)：厚實但圓順的雙門三廂 ——
//   引擎蓋往前往下斜、前緣收圓，俯視下車頭兩角明顯後掠 (頭燈斜著繞過車角)，保桿比頭燈面更往前鼓出；
//   前後葉子板是由窗台往下漸漸鼓出來的圓肩 (肌肉感)，車門較平，兩者圓順地融合，上面壓一條硬朗的肩線；
//   車頂是柔和的弧線，C 柱流進高而短的行李廂蓋；車尾四圓燈 + 大尾翼。
(function () {
  const RM = window.RM;
  const PC = RM.ProcCar;
  const { MeshBuilder } = RM;
  const V = RM.v3;
  const { sq, sstep, pn, rmax, smin, softPos, spline, MAT } = PC;

  // 貼圖投影：樞紐與半徑配合車角實際的圓弧 (車尾角半徑約 0.2、車頭角約 0.3)，環繞帶的 u 才接近真實弧長，
  // 繞過車角的尾燈 / 頭燈不會被拉長或壓扁
  const MAP = {
    XC: 0.66, ZC: 2.065, RC: 0.15, XCF: 0.54, ZCF: -1.9, RCF: 0.29, UMAX: 6.3, Y0: 0.05, Y1: 1.4, Z0: -2.4, Z1: 2.4, XMAX: 0.96,
    AXF: -1.425, AXR: 1.24, ARF: 0.375, AYF: 0.335, ARR: 0.375, AYR: 0.335, ARCH_IN: 0.54,
  };
  const INFO = PC.mapInfo(MAP);
  const DROP = 0.02;
  const TIRE_R = 0.3266;

  // ------------------------------------------------------------------ 車身外形
  // 下車身頂面中心線：鼻頭低 (0.69) → 引擎蓋一路往後上升、微微拱起 → 腰線 → 高而短的行李廂蓋
  const ylS = spline([[-2.33, 0.682], [-2.25, 0.712], [-2.1, 0.752], [-1.95, 0.782], [-1.8, 0.806], [-1.4, 0.866], [-1.0, 0.918], [-0.8, 0.94], [-0.3, 0.953], [0.5, 0.963], [1.2, 0.986], [1.55, 1.008], [1.9, 1.016], [2.2, 1.01], [2.33, 1.0]]);
  const ybS = spline([[-2.33, 0.2], [-2.15, 0.15], [-1.85, 0.145], [1.6, 0.15], [1.95, 0.2], [2.33, 0.3]]);
  // 車尾側面輪廓 z(y)：下緣內收 → 保桿 (最凸) → 保桿上緣圓滑地往內收成約 6 cm 的台階 → 略前傾的尾燈面板。
  // 保桿明顯比尾燈面板凸出，車尾才有前後層次 (原本只差 3 cm，看起來是一整片平板)
  const ZrS = spline([[0.12, 2.1], [0.2, 2.2], [0.27, 2.27], [0.34, 2.3], [0.6, 2.3], [0.645, 2.296], [0.68, 2.282], [0.7, 2.262], [0.716, 2.245], [0.76, 2.238], [0.88, 2.234], [1.0, 2.224], [1.1, 2.212]]);
  // 車頭側面輪廓：前唇 → 往前鼓出的保桿 (最凸在 0.3 ~ 0.48) → 頭燈 / 水箱罩面往後傾 → 引擎蓋前緣
  const ZfS = spline([[0.1, -2.16], [0.16, -2.26], [0.22, -2.295], [0.3, -2.3], [0.48, -2.3], [0.56, -2.288], [0.61, -2.262], [0.66, -2.234], [0.72, -2.2], [0.78, -2.12], [0.9, -1.8]]);
  // 俯視半寬 (車側最寬處)：前後輪拱最寬，車門處收腰 (可樂瓶)，頭尾收窄
  const WzS = spline([[-2.4, 0.8], [-2.1, 0.85], [-1.75, 0.885], [-1.425, 0.8925], [-1.1, 0.886], [-0.7, 0.862], [-0.2, 0.85], [0.3, 0.851], [0.7, 0.868], [1.0, 0.888], [1.24, 0.8925], [1.6, 0.888], [1.95, 0.87], [2.2, 0.845], [2.4, 0.81]]);
  // 窗台高度處比最寬處內縮的量：座艙段 (車門、後葉子板前半) 內縮多 —— 葉子板由窗台往下漸漸鼓出來，是有肌肉感的圓肩；
  // 引擎蓋與行李廂兩側的葉子板頂則幾乎與車側同寬 (那裡的圓肩靠頂面的大圓角)
  const insetS = spline([[-2.4, 0.03], [-1.1, 0.026], [-0.7, 0.06], [-0.2, 0.07], [0.6, 0.074], [1.1, 0.07], [1.5, 0.045], [1.8, 0.03], [2.4, 0.03]]);
  const WbS = (z) => WzS(z) - insetS(z);
  // 車頂中心線：柔和的弧線，最高點在前座上方
  const yrS = spline([[-0.5, 1.285], [-0.2, 1.33], [0.1, 1.353], [0.45, 1.36], [0.8, 1.35], [1.1, 1.318], [1.4, 1.255], [1.6, 1.19]]);

  // 尾燈 (車身座標)：外側大燈、內側小燈的圓心 u (≈ |x|，外燈已繞上車角) 與透鏡半徑
  const LAMP_Y = 0.845, LAMP_O = [0.705, 0.1], LAMP_I = [0.487, 0.08];
  // 車尾的凹槽 (做在幾何上，不是貼圖)：四個尾燈碗、車牌凹槽。
  //   燈碗：透鏡外緣往內 CUP_D 深，中央的透鏡微微凸起 (淺一點)；碗壁在透鏡外緣 ~ 外緣 + RIM 之間 (RIM 也是燈殼一圈深色內壁的寬度)
  //   以 (環繞帶 u, 高度 y) 定義 —— 和貼圖用同一組座標，燈碗的邊緣與畫上去的燈一定對齊 (外燈繞過車角也一樣)
  const CUP_D = 0.042, RIM = 0.017;
  const PLATE = { hx: 0.188, y0: 0.382, y1: 0.564, rc: 0.014, d: 0.018 };
  function rearCut(ax, y, z) {
    if (y < 0.37 || y > 0.97) return 0;
    const dz = z - MAP.ZC;
    const u = dz > 0 ? Math.min(ax, MAP.XC) + MAP.RC * Math.atan2(Math.max(ax - MAP.XC, 0), dz) : MAP.XC + MAP.RC * 1.5707963 - dz;
    if (y > 0.72) {
      let d = 0;
      for (const L of [LAMP_O, LAMP_I]) {
        const rho = Math.hypot(u - L[0], y - LAMP_Y), r = L[1];
        // 碗壁是 S 形的圓唇 (不是直角)：網格再密也只有幾毫米，直角的壁會變成鋸齒狀的一圈
        if (rho < r + RIM) d = Math.max(d, CUP_D * (1 - sstep(r - 0.003, r + RIM, rho)) * (0.72 + 0.28 * Math.min(1, sq(rho / r))));
      }
      return d;
    }
    if (y > 0.58 || u > 0.21) return 0;
    // 車牌凹槽：圓角矩形
    const qx = u - PLATE.hx + PLATE.rc, qy = Math.abs(y - (PLATE.y0 + PLATE.y1) / 2) - (PLATE.y1 - PLATE.y0) / 2 + PLATE.rc;
    const dist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - PLATE.rc;
    return PLATE.d * (1 - sstep(-0.006, 0, dist));
  }

  const YM = 0.55, ZC_R = 1.72, ZC_F = -1.55, YGB = 0.84;
  const YW = 0.58;      // 車側最寬處的高度 (輪軸上方)
  const YSH = 0.835;    // 肩線：貫穿車側的那條硬朗稜線
  const ySill = (z) => 0.945 + 0.03 * sstep(-0.6, 1.2, z);
  const flare = PC.archFlare(MAP, { lipF: 0.006, lipR: 0.006, lipW: 0.045 });   // 輪拱捲邊
  function Ws(y, z) {
    const wz = WzS(z);
    if (y > YW) {
      // 腰部最寬，往上以拋物線收向窗台 (圓肩)；肩線以上再多傾一點 —— 斜率在肩線轉折，反射在那裡斷開成一條稜線
      const t = (y - YW) / (ySill(z) - YW);
      return wz - (wz - WbS(z)) * t * t - 0.11 * softPos(y - YSH) + flare(y, z);
    }
    // 往下內收到門檻；前後輪之間的側裙再往外凸一點
    let w = wz - 0.05 * sq((YW - y) / 0.43);
    if (y < 0.36) w += 0.014 * sstep(0.35, 0.25, y) * sstep(-1.0, -0.9, z) * sstep(0.84, 0.74, z);
    return w + flare(y, z);
  }
  function Tl(ax, z) {
    const hood = sstep(-0.78, -1.05, z), deck = sstep(1.5, 1.8, z);
    let y = ylS(z) - (0.014 + 0.02 * hood * sstep(-2.15, -1.7, z) + 0.016 * deck) * sq(ax / 0.89);   // 橫向拱度：引擎蓋、行李廂蓋中間高兩側低 (鼻頭處較平，頭燈上緣才夠高)
    if (hood > 0) {
      // 引擎蓋中央微微隆起的平台，兩側各一道稜線，由 A 柱根部往水箱罩兩角收窄
      const e = 0.35 + (z + 2.2) * 0.125;
      y += 0.011 * sstep(e + 0.05, e - 0.02, ax) * hood * sstep(-2.3, -2.05, z);
    }
    if (z > 2.0) y += 0.012 * sstep(2.08, 2.25, z) * sstep(0.8, 0.55, ax);   // 行李廂蓋後緣微微上翹
    return y;
  }
  function sdLower(ax, y, z) {
    const a = ax / Ws(y, z);
    // 俯視輪廓：側面與車頭 / 車尾以 p-norm 連成圓角。車頭次方低 + 中央比兩角凸 7 cm → 兩角明顯後掠；車尾收圓但較方
    let b = 0, np = 5;
    if (z > ZC_R) { b = (z - ZC_R) / (ZrS(y) - 0.035 * sq(ax / 0.89) - rearCut(ax, y, z) - ZC_R); np = 5.8; }
    else if (z < ZC_F) { b = (ZC_F - z) / (ZC_F - ZfS(y) - 0.07 * sq(ax / 0.89)); np = 4.4; }
    const dP = (pn(a, b, np) - 1) * 0.8;
    if (y > YM) {
      // 頂面與側面的圓角：葉子板頂 (引擎蓋兩側) 最圓，車門腰線俐落，行李廂兩側再圓一點，頭尾的上緣收小
      // 車尾上緣收得比較俐落 (行李廂蓋 / 葉子板與尾燈面板之間是一條清楚的稜，車尾才有立體感)
      const R = 0.08 - 0.035 * sstep(-1.0, -0.62, z) + 0.05 * sstep(1.4, 1.75, z) - 0.048 * sstep(0.8, 0.97, b);
      return rmax(dP, y - Tl(ax, z), R);
    }
    return rmax(dP, ybS(z) - y, 0.06);
  }
  function Wg(y, z) {
    const dy = softPos(y - ySill(z));
    // 座艙：窗台處只比車身腰線內縮一點 (C 柱處多一些，讓後葉子板的肩露出來)，側窗往上內傾 (tumblehome)
    return 0.772 - 0.03 * sstep(0.6, 1.5, z) - 0.012 * sstep(-0.1, -0.8, z) - 0.36 * dy - 0.3 * dy * dy;
  }
  const zWs = (y, ax) => -0.8 + (y - 0.945) * 1.85 + 0.24 * ax * ax;       // 前擋
  const zRg = (y, ax) => 1.64 - (y - 1.02) * 1.65 - 0.2 * ax * ax;         // 後擋
  const yRoof = (ax, z) => yrS(z) - 0.035 * sq(ax / 0.6);
  function sdGreen(ax, y, z) {
    const dz = Math.max(zWs(y, ax) - z, z - zRg(y, ax));
    const dP = rmax(ax - Wg(y, z), dz, 0.07);            // A / C 柱圓角
    return Math.max(rmax(dP, y - yRoof(ax, z), 0.07), YGB - y);
  }
  function sdBody(x, y, z) {
    const ax = x < 0 ? -x : x;
    // 座艙與下車身的交界：C 柱根部用較大的融合半徑，順順地流進行李廂蓋與後葉子板
    return smin(sdLower(ax, y, z), sdGreen(ax, y, z), 0.012 + 0.022 * sstep(0.9, 1.4, z));
  }
  const S = PC.surface(sdBody);
  const { rearP, frontP } = S;
  const patch = (mb, chart, us, vs, off, M, uv) => PC.patch(mb, S, chart, us, vs, off, M, uv);
  // 車尾面局部加密 (proc_car.js buildShell 的 refine)：尾燈碗與車牌凹槽的壁要有足夠的取樣點才俐落
  const SHELL_BOX = {
    XO: 0.94, YB: 0.05, YT: 1.4, ZO: 2.34, WI: 0.42, YI0: 0.42, YI1: 0.62, ZI: 1.7,
    rearRays: { WR: 0.62, YR: 0.96 },      // 尾燈 / 車牌區的射線水平往後打 (順著燈碗的軸)
    refine: {
      // y 加密到 1.06：射線往後上方斜，打在燈碗上緣 (y ≈ 0.95) 的射線，目標點其實在更高的地方
      x: [[0.37, 0.94, 0.006]], y: [[0.73, 1.06, 0.006]], z: [[2.12, 2.34, 0.008]], sideY: true,   // 外燈繞過車角，接縫附近的車側面也要密
      xAt: [0.176, 0.182, 0.188, 0.194, 0.2], yAt: [0.376, 0.382, 0.388, 0.394, 0.552, 0.558, 0.564, 0.57],
    },
  };

  // ------------------------------------------------------------------ 貼圖
  function buildTex(W) {
    const M = MAP, K = PC.texKit(W, M);
    const { X, fill, stroke, poly, line, rect, circ, rpoly, clipTo, lgrad, rgrad, region, end, gap, uz, uf, qcurve } = K;
    const BLK = { c: '#0b0b0d', r: 0.6, m: 0 }, CHROME = { c: '#c9ccd0', r: 0.15, m: 1 };
    const UF0 = INFO.UF0;
    const uc = (deg) => UF0 + (M.RCF * deg * Math.PI) / 180;      // 車頭角上的 u：0° = 車側起點，90° = 車頭面起點
    region('belt');
    const uAR = uz(M.AXR), uAF = uz(M.AXF), AR = M.ARR, AY = M.AYR;

    // ================= 車尾 =================
    // 保桿下緣：黑色底板 + 中段的黑色缺口與擴散器鰭片
    fill(rect(-0.2, 0.0, uAR - AR, 0.185), Object.assign({ h: -1 }, BLK));
    fill(rpoly([[-0.2, 0.18], [0.66, 0.18], [0.6, 0.315], [-0.2, 0.315]], [0, 0, 0.04, 0]), Object.assign({ h: -3 }, BLK));
    for (const u of [0.1, 0.22, 0.34, 0.46]) fill(rpoly([[u - 0.007, 0.1], [u + 0.007, 0.1], [u + 0.007, 0.3], [u - 0.007, 0.3]], 0.005), { c: '#17171a', h: 2.5, r: 0.5 });
    // 車牌凹槽 (保桿中央)，兩側緊鄰的方形燈 (實車左 = 倒車燈、右 = 後霧燈；貼圖左右對稱，兩邊都當倒車燈)
    // 車牌凹槽是幾何 (rearCut)：這裡只補凹槽上半部的陰影 (陰影貼圖解析度不夠，照不出 2 cm 深的自遮蔽)
    fill(rpoly([[-0.2, PLATE.y0], [PLATE.hx, PLATE.y0], [PLATE.hx, PLATE.y1], [-0.2, PLATE.y1]], [0, PLATE.rc, PLATE.rc, 0]), { c: lgrad(0, PLATE.y1, 0, PLATE.y1 - 0.07, [[0, 'rgba(0,0,0,0.5)'], [1, 'rgba(0,0,0,0)']]) });
    fill(rpoly([[0.205, 0.492], [0.362, 0.492], [0.362, 0.562], [0.205, 0.562]], 0.01), { c: '#060607', r: 0.5, m: 0, h: -2.5 });
    fill(rpoly([[0.212, 0.499], [0.355, 0.499], [0.355, 0.555], [0.212, 0.555]], 0.007), { c: lgrad(0, 0.555, 0, 0.499, [[0, '#d2d5d6'], [1, '#8f9497']]), r: 0.1, m: 0, h: 0.5, mask: '#0000c0', lens: 0.02 });
    for (let u = 0.218; u < 0.352; u += 0.009) { X.A.fillStyle = 'rgba(0,0,0,0.2)'; X.A.fillRect(u, 0.499, 0.002, 0.056); }
    gap([[-0.2, 0.716], [0.82, 0.716], [uAR - AR + 0.012, 0.7]]);                      // 保桿上緣接縫：在保桿台階的內角 (繞過車角到輪拱)
    // 行李廂蓋的輪廓：由保桿上緣往上，貼著內側尾燈繞一個大弧，越過兩顆燈的上方到後葉子板頂 (接俯視的側邊接縫)
    gap([[0.36, 0.712], [0.368, 0.78], [0.386, 0.855], [0.417, 0.915], [0.477, 0.953], [0.57, 0.974], [0.69, 0.986], [0.77, 1.0], [0.81, 1.07]]);
    // 廠徽 (圓環 + 橫條)、高位煞車燈 (行李廂蓋後緣中央)
    stroke(circ(0, 0.88, 0.033), 0.007, Object.assign({ h: 1.5 }, CHROME));
    fill(rect(-0.2, 0.872, 0.046, 0.888), Object.assign({ h: 1.5 }, CHROME));
    fill(rpoly([[-0.2, 0.94], [0.1, 0.94], [0.1, 0.968], [-0.2, 0.968]], [0, 0.006, 0.006, 0]), { c: '#050506', r: 0.5, m: 0, h: -2 });
    fill(rpoly([[-0.2, 0.945], [0.094, 0.945], [0.094, 0.963], [-0.2, 0.963]], [0, 0.004, 0.004, 0]), { c: '#5a080c', r: 0.12, m: 0, mask: '#ff0000', lens: 0.012 });

    // ---- 四圓尾燈：外側大 (尾燈環 + 中央煞車燈)、內側小 (尾燈環 + 中央琥珀方向燈)。
    //      燈碗是幾何 (rearCut，約 4 cm 深)：碗壁 (透鏡外緣 ~ 外緣 + RIM) 畫成深色的燈殼內壁，往碗口漸亮 (受光的唇邊)；
    //      透鏡後面的反射罩再用 lens 5 cm 做視差 —— 兩層深度疊起來，燈才是「凹進去」的。整個燈面的 mask 都不是 0，著色器才會當成燈區
    for (const [cu, r, inner] of [[LAMP_O[0], LAMP_O[1], 0], [LAMP_I[0], LAMP_I[1], 1]]) {
      const cy = LAMP_Y;
      // 碗壁：深處是消光的深色燈殼，往碗口漸漸淡回車漆 (唇邊是車身鈑件捲進去的，網格的細小起伏也不會被深色描出來)
      const RW = r + RIM;
      fill(circ(cu, cy, RW), { c: rgrad(cu, cy, RW, [[0, '#060607'], [r / RW, '#060607'], [(r + RIM * 0.45) / RW, 'rgba(12,12,14,0.92)'], [1, 'rgba(12,12,14,0)']]), r: 0.6, m: 0 });
      fill(circ(cu, cy, r), { c: rgrad(cu, cy, r, [[0, '#4c060a'], [0.5, '#7a0d13'], [0.82, '#5a080d'], [1, '#2c0406']]), r: 0.06, m: 0, mask: '#280000', lens: 0.05 });
      clipTo(circ(cu, cy, r), () => {
        const g = X.A;
        // 外圈：尾燈環 (亮) —— 靠燈殼邊緣的一圈，反射罩的同心稜紋
        stroke(circ(cu, cy, r * 0.8), r * 0.3, { c: '#b3161e', mask: '#d80000', r: 0.08 });
        g.lineWidth = 0.0022;
        for (let k = 0.56; k < 0.98; k += 0.07) { g.strokeStyle = 'rgba(0,0,0,0.26)'; g.beginPath(); g.arc(cu, cy, r * k, 0, 6.2832); g.stroke(); g.strokeStyle = 'rgba(255,150,140,0.2)'; g.beginPath(); g.arc(cu, cy, r * (k + 0.03), 0, 6.2832); g.stroke(); }
        // 放射狀稜紋 (反射罩切面)
        g.strokeStyle = 'rgba(0,0,0,0.16)'; g.lineWidth = 0.0018;
        for (let k = 0; k < 40; k++) { const a = (k / 40) * 6.2832; g.beginPath(); g.moveTo(cu + Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.5); g.lineTo(cu + Math.cos(a) * r, cy + Math.sin(a) * r); g.stroke(); }
        // 中央：凸起的燈泡罩 —— 外燈是煞車燈 (紅)，內燈是方向燈 (琥珀)
        fill(circ(cu, cy, r * 0.5), { c: '#12090a', mask: '#180000' });
        if (inner) fill(circ(cu, cy, r * 0.43), { c: rgrad(cu, cy, r * 0.43, [[0, '#f6b040'], [0.6, '#d07a12'], [1, '#8a4a06']]), mask: rgrad(cu, cy, r * 0.43, [[0, '#08ff00'], [0.7, '#08a000'], [1, '#083000']]), r: 0.08, h: 1.5 });
        else fill(circ(cu, cy, r * 0.43), { c: rgrad(cu, cy, r * 0.43, [[0, '#e0303a'], [0.6, '#a8131b'], [1, '#5c080d']]), mask: rgrad(cu, cy, r * 0.43, [[0, '#ff0000'], [0.7, '#c00000'], [1, '#500000']]), r: 0.08, h: 1.5 });
        g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 0.002;
        for (const k of [0.16, 0.29]) { g.beginPath(); g.arc(cu, cy, r * k, 0, 6.2832); g.stroke(); }
        stroke(circ(cu, cy, r), 0.014, { c: 'rgba(0,0,0,0.45)' });                             // 燈殼邊緣暗角
      });
    }

    // ================= 車側 =================
    gap([[uz(0.42), 0.975], [uz(0.42) + 0.008, 0.6], [uz(0.42) + 0.045, 0.3], [uz(0.42) + 0.055, 0.215]]);   // 車門後緣 (下段沿後輪拱前傾)
    gap([[uz(-0.74), 0.955], [uz(-0.74), 0.215]]);                                                              // 車門前緣
    gap([[uz(0.42) + 0.055, 0.215], [uz(-0.74), 0.215]]);                                                       // 門檻
    K.handle(0.2, 0.34, 0.848, 0.88);
    // 側裙：車色，下緣一條黑；車門下段一道微微上揚的折線 (實車車側下半部的那條線)
    fill(rect(uAR + AR + 0.02, 0.0, uAF - AR - 0.02, 0.125), Object.assign({ h: 1 }, BLK));
    stroke(line([[uAR + AR + 0.04, 0.4], [uAF - AR - 0.04, 0.37]]), 0.03, { h: 1.1 });
    gap([[uz(-1.82), 0.6], [uz(-1.82), 0.3]]);                                                                  // 前保桿與葉子板的接縫
    // 葉子板側方向燈 (前輪拱後方的小燈)
    fill(rpoly([[uz(-0.9), 0.668], [uz(-0.97), 0.668], [uz(-0.97), 0.692], [uz(-0.9), 0.692]], 0.008), { c: '#d98414', r: 0.1, m: 0, h: 1, mask: '#00a000' });
    // 輪拱捲邊：沿開口一圈微凸 (與 Ws 裡的捲邊疊起來，邊緣才俐落)
    for (const ua of [uAR, uAF]) {
      const p = [];
      for (let a = -6; a <= 186; a += 6) { const t = (a * Math.PI) / 180; p.push([ua + Math.cos(t) * (AR + 0.014), AY + Math.sin(t) * (AR + 0.014)]); }
      stroke(line(p), 0.024, { h: 1.6 });
    }
    K.sideWindows({
      z0: -0.72, z1: 1.38, ySl: (z) => ySill(z) + 0.012,
      yTop: (z) => Math.min(yrS(z) - 0.095, 1.262 - (z - 0.95) * 0.62),
      yA: (z, ins) => 0.945 + (z + 0.68 - ins * 2.2) / 1.85,
      panes: [[-0.64, 0.39], [0.47, 1.32]],
    });

    // ================= 車頭 =================
    {
      // 前唇 (黑)
      fill(rect(uAF + AR, 0.0, M.UMAX + 0.2, 0.2), Object.assign({ h: 1 }, BLK));
      stroke(line([[uAF + AR + 0.02, 0.232], [M.UMAX + 0.2, 0.232]]), 0.016, { h: -1.8 });      // 前唇上緣的溝
      // 保桿與頭燈 / 水箱罩之間的分界 (保桿上緣那條縫，由車頭中央繞到輪拱)
      gap([[M.UMAX + 0.2, 0.61], [uf(0.355), 0.61]]);
      gap([[uc(0), 0.598], [uAF + AR - 0.01, 0.585]]);
      // 中央大進氣口：後方看得到中冷器 (鋁色散熱片 + 側水室)，四周一圈凸框
      const G1 = [[uf(-0.1), 0.262], [uf(0.4), 0.262], [uf(0.43), 0.3], [uf(0.4), 0.528], [uf(-0.1), 0.528]];
      const GR = [0, 0.02, 0.025, 0.03, 0];
      fill(rpoly(G1, GR), { c: '#050506', r: 0.7, m: 0, h: -9 });
      clipTo(rpoly(G1, GR), () => {
        fill(rect(uf(0.37), 0.285, uf(-0.1), 0.475), { c: '#5d6269', r: 0.34, m: 0.7 });
        const g = X.A;
        for (let u = uf(0.37); u < uf(-0.1); u += 0.0055) { g.fillStyle = 'rgba(0,0,0,0.34)'; g.fillRect(u, 0.285, 0.0022, 0.19); }
        for (let y = 0.3; y < 0.47; y += 0.0165) { g.fillStyle = 'rgba(20,22,25,0.75)'; g.fillRect(uf(0.37), y, 0.6, 0.004); }
        fill(rect(uf(0.41), 0.278, uf(0.355), 0.482), { c: '#2c2f33', r: 0.4, m: 0.6 });       // 側水室
        stroke(rpoly(G1, GR), 0.034, { c: 'rgba(0,0,0,0.62)' });                                // 開口內緣的陰影
      });
      stroke(rpoly(G1, GR), 0.014, { h: 1.8 });
      // 兩側：方形的保桿燈 (方向燈 / 位置燈，透明燈殼)、下方網狀進氣口
      const L1 = [[uf(0.5), 0.432], [uc(58), 0.432], [uc(58), 0.498], [uf(0.5), 0.498]];
      fill(rpoly(L1, 0.012), { c: '#050506', r: 0.5, m: 0, h: -3 });
      fill(rpoly([[uf(0.5) - 0.007, 0.439], [uc(58) + 0.007, 0.439], [uc(58) + 0.007, 0.491], [uf(0.5) - 0.007, 0.491]], 0.008), { c: lgrad(0, 0.491, 0, 0.439, [[0, '#dfe3e6'], [1, '#9aa0a5']]), r: 0.08, m: 0, h: 0.5, mask: '#00b000', lens: 0.025 });
      for (let u = uc(58) + 0.012; u < uf(0.5) - 0.01; u += 0.01) { X.A.fillStyle = 'rgba(0,0,0,0.16)'; X.A.fillRect(u, 0.439, 0.002, 0.052); }
      const I1 = [[uf(0.48), 0.292], [uc(48), 0.3], [uc(50), 0.388], [uf(0.48), 0.395]];
      fill(rpoly(I1, 0.014), { c: '#040405', r: 0.7, m: 0, h: -7 });
      clipTo(rpoly(I1, 0.014), () => {
        const g = X.A; g.strokeStyle = 'rgba(64,66,72,0.6)'; g.lineWidth = 0.003;
        for (let k = -30; k < 30; k++) { g.beginPath(); g.moveTo(uc(48) - 0.1 + k * 0.022, 0.28); g.lineTo(uc(48) - 0.1 + k * 0.022 + 0.13, 0.41); g.stroke(); g.beginPath(); g.moveTo(uc(48) - 0.1 + k * 0.022, 0.41); g.lineTo(uc(48) - 0.1 + k * 0.022 + 0.13, 0.28); g.stroke(); }
        stroke(rpoly(I1, 0.014), 0.018, { c: 'rgba(0,0,0,0.6)' });
      });
      stroke(rpoly(I1, 0.014), 0.012, { h: 1.4 });
      // 車角的直立導風縫 (前輪拱前方)
      fill(rpoly([[uc(24), 0.33], [uc(19), 0.33], [uc(16), 0.52], [uc(21), 0.52]], 0.008), { c: '#030304', r: 0.8, m: 0, h: -6 });
      // 水箱罩：兩燈之間一條細長的開口 (網格)，緊貼在引擎蓋前緣下方
      const G2 = [[uf(0.34), 0.63], [uf(-0.1), 0.63], [uf(-0.1), 0.7], [uf(0.33), 0.7]];
      fill(rpoly(G2, [0.012, 0, 0, 0.012]), { c: '#050506', r: 0.6, m: 0, h: -6 });
      clipTo(rpoly(G2, [0.012, 0, 0, 0.012]), () => {
        const g = X.A; g.strokeStyle = 'rgba(66,68,74,0.62)'; g.lineWidth = 0.003;
        for (let k = -8; k < 40; k++) { g.beginPath(); g.moveTo(uf(0.36) + k * 0.02, 0.625); g.lineTo(uf(0.36) + k * 0.02 + 0.09, 0.705); g.stroke(); g.beginPath(); g.moveTo(uf(0.36) + k * 0.02, 0.705); g.lineTo(uf(0.36) + k * 0.02 + 0.09, 0.625); g.stroke(); }
        stroke(rpoly(G2, [0.012, 0, 0, 0.012]), 0.016, { c: 'rgba(0,0,0,0.6)' });
      });
      // 頭燈：大面積的斜梯形 —— 內端窄、往外漸高，上緣貼著引擎蓋 / 葉子板線，外端繞過車角到葉子板側面
      const P = [[uf(0.365), 0.612], [uf(0.52), 0.598], [uc(45), 0.594], [UF0 - 0.02, 0.606], [UF0 - 0.075, 0.756], [uc(48), 0.752], [uf(0.54), 0.726], [uf(0.39), 0.702]];
      const R = [0.014, 0.02, 0.03, 0.04, 0.035, 0.04, 0.03, 0.014];
      stroke(rpoly(P, R), 0.009, { c: '#040405', h: -3, r: 0.8, m: 0 });
      // 底色的 mask 只是讓著色器把整個燈面當成燈區 (做視差)：值分給 r / g 各一點，開大燈時燈殼只有微光
      fill(rpoly(P, R), { c: lgrad(0, 0.758, 0, 0.594, [[0, '#6a7078'], [0.5, '#474c53'], [1, '#24272b']]), r: 0.05, m: 0, h: 1.0, mask: '#081800', lens: 0.06 });
      clipTo(rpoly(P, R), () => {
        const g = X.A;
        // 鍍鉻內框 (反射罩的底)
        fill(rpoly([[uf(0.395), 0.624], [uf(0.52), 0.611], [uc(45), 0.607], [UF0 - 0.012, 0.62], [UF0 - 0.055, 0.742], [uc(48), 0.738], [uf(0.54), 0.713], [uf(0.41), 0.691]], 0.02), { c: lgrad(0, 0.744, 0, 0.607, [[0, '#e6eaee'], [0.5, '#b9bfc6'], [1, '#757b82']]), r: 0.22, m: 0.5, mask: '#0c1800' });
        // 內側投射燈 (近光)、中間多重反射罩 (遠光)
        for (const [pu, py, pr, proj] of [[uf(0.475), 0.66, 0.042, 1], [uc(70), 0.668, 0.052, 0]]) {
          fill(circ(pu, py, pr + 0.007), { c: '#16181b', mask: '#081800' });
          fill(circ(pu, py, pr), { c: rgrad(pu, py, pr, proj ? [[0, '#eef3f8'], [0.45, '#a9b1ba'], [0.8, '#40454b'], [1, '#15171a']] : [[0, '#f2f5f8'], [0.3, '#c9ced4'], [1, '#6c7178']]), mask: rgrad(pu, py, pr * 1.5, [[0, '#ff1000'], [0.5, '#a01000'], [1, '#201000']]), r: 0.1, m: proj ? 0 : 0.8 });
          stroke(circ(pu, py, pr), 0.0045, { c: '#d0d4d9' });
          if (!proj) { g.strokeStyle = 'rgba(0,0,0,0.2)'; g.lineWidth = 0.002; for (let k = 0; k < 16; k++) { const a = (k / 16) * 6.2832; g.beginPath(); g.moveTo(pu, py); g.lineTo(pu + Math.cos(a) * pr, py + Math.sin(a) * pr); g.stroke(); } }
        }
        // 外端 (車角到葉子板)：位置燈 / 方向燈的反射罩，裡面一顆琥珀燈泡
        fill(rpoly([[uc(40), 0.616], [UF0 - 0.008, 0.626], [UF0 - 0.048, 0.736], [uc(40), 0.734]], 0.02), { c: lgrad(uc(40), 0, UF0 - 0.04, 0, [[0, '#d4d9de'], [1, '#8d939a']]), r: 0.2, m: 0.5, mask: '#081800' });
        fill(circ(uc(18), 0.682, 0.032, 0.029), { c: rgrad(uc(18), 0.682, 0.032, [[0, '#f0a030'], [1, '#a05808']]), mask: '#00c800' });
        stroke(rpoly(P, R), 0.016, { c: 'rgba(0,0,0,0.42)' });
      });
    }
    end();

    // ================= 俯視 (z, |x|) =================
    region('top');
    // 引擎蓋接縫：前緣 (貼著頭燈 / 水箱罩上緣) → 兩側沿葉子板到雨刷蓋板
    gap(qcurve(-2.16, 0.3, -0.05, 0.6).concat([[-1.96, 0.69], [-1.5, 0.735], [-0.85, 0.752]]));
    fill(poly(qcurve(-0.875, 0.24, -0.05, 0.76).concat(qcurve(-0.795, 0.24, -0.05, 0.76).reverse())), { c: '#0b0b0c', r: 0.7, m: 0, h: -3 });
    K.topGlass({ zb: -0.775, zt: -0.11, k: 0.24, wb: 0.72, wt: 0.545 });
    // 車頂兩側的排水膠條
    {
      const p = [];
      for (let z = -0.02, k = 0; k <= 14; k++, z += 0.08) p.push([z, Wg(yrS(z) - 0.035, z) - 0.006]);
      stroke(line(p), 0.011, { c: '#09090a', r: 0.6, m: 0, h: -1.6, cap: 'butt' });
    }
    K.topGlass({ zt: 1.16, zb: 1.615, k: -0.2, wt: 0.5, wb: 0.62, defrost: { z0: 1.245, dz: 0.035, n: 10 } });
    {
      // 行李廂蓋：前緣沿後擋下緣，兩側一路到車尾 (在車尾環繞帶接上繞過尾燈上方的那條縫)
      const p = qcurve(1.675, -0.2, -0.05, 0.62, 14);
      p.push([1.62, 0.665], [1.67, 0.7], [2.4, 0.715]);
      gap(p);
      const q = [];
      for (let z = -0.64; z <= 1.32; z += 0.04) q.push([z, Wg(ySill(z) + 0.012, z) + 0.008]);
      stroke(line(q), 0.026, { c: '#0c0c0e', r: 0.3, m: 0, cap: 'butt' });
    }
    end();
    return K.finish();
  }

  function buildDecalTex() {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    const g = c.getContext('2d');
    const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
    g.fillStyle = '#f2f2ec'; rr(2, 2, 252, 124, 10); g.fill();
    g.strokeStyle = '#222'; g.lineWidth = 4; rr(6, 6, 244, 116, 8); g.stroke();
    g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 64px ' + (RM.FONT || 'sans-serif');
    g.fillText('GTR-0034', 128, 68, 226);
    // GT-R 徽章：GT 在上、紅色的 R 在下 (實車行李廂蓋 / 水箱罩 / 葉子板上的疊字徽章)
    g.textAlign = 'center';
    g.font = 'italic 900 58px sans-serif'; g.fillStyle = '#d8dadc'; g.fillText('GT', 324, 36);
    g.font = 'italic 900 84px sans-serif'; g.fillStyle = '#c8102e'; g.fillText('R', 330, 96);
    g.lineWidth = 2.5; g.strokeStyle = '#d8dadc'; g.strokeText('R', 330, 96);
    // SKYLINE：後保桿上緣的大字 (實車是壓在保桿上的同色凹字；這裡用深灰字代表凹下去的陰影)
    g.font = '700 56px sans-serif'; g.fillStyle = '#4a4d52';
    try { g.letterSpacing = '22px'; } catch (e) { /* 舊瀏覽器沒有字距屬性，字擠一點而已 */ }
    g.fillText('SKYLINE', 256, 196, 480);
    try { g.letterSpacing = '0px'; } catch (e) { /* 同上 */ }
    return { canvas: c, uv: { plate: [0.5 / 512, 0.5 / 256, 255.5 / 512, 127.5 / 256], gtr: [270 / 512, 2 / 256, 386 / 512, 138 / 256], name: [10 / 512, 164 / 256, 502 / 512, 228 / 256] } };
  }

  // ------------------------------------------------------------------ 零件
  const GOLD = RM.mat('#b08a2a', 0.4, 0.5);
  const GUN = RM.mat('#7d8186', 0.3, 0.9);       // 原廠鍛造圈的槍灰色
  const EMBOSS = RM.mat('#ffffff', 0.5, 0, 2);   // 壓字：貼圖顏色直接當底色 (不金屬)
  // 把一串斷面環連成平滑曲面 (尾翼翼片 / 腳架 / 後照鏡座)。各環點數相同、繞向一致；法線由相鄰點估算，朝內就整片翻面
  // (三角形繞向要和法線一致：著色器會把背面的法線翻過來，繞向錯了受光就是反的)
  function loft(mb, rings, M) {
    const m = rings.length, n = rings[0].length, base = mb.vcount, N = [];
    let out = 0;
    for (let i = 0; i < m; i++) {
      const c = [0, 0, 0];
      for (const p of rings[i]) { c[0] += p[0] / n; c[1] += p[1] / n; c[2] += p[2] / n; }
      for (let j = 0; j < n; j++) {
        const p = rings[i][j], a = rings[i][(j + n - 1) % n], b = rings[i][(j + 1) % n];
        const lo = rings[Math.max(i - 1, 0)][j], hi = rings[Math.min(i + 1, m - 1)][j];
        const nn = V.norm([0, 0, 0], V.cross([0, 0, 0], V.sub([0, 0, 0], b, a), V.sub([0, 0, 0], hi, lo)));
        out += nn[0] * (p[0] - c[0]) + nn[1] * (p[1] - c[1]) + nn[2] * (p[2] - c[2]);
        N.push(nn);
      }
    }
    const s = out < 0 ? -1 : 1;
    for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) { const p = rings[i][j], q = N[i * n + j]; mb.v(p[0], p[1], p[2], q[0] * s, q[1] * s, q[2] * s, 0, 0, M); }
    for (let i = 0; i < m - 1; i++) for (let j = 0; j < n; j++) {
      const a = base + i * n + j, b = base + i * n + ((j + 1) % n), c = a + n, d = b + n;
      if (s > 0) mb.i.push(a, b, d, a, d, c); else mb.i.push(a, d, b, a, c, d);
    }
  }
  // 翼型斷面環 (前緣圓、後緣尖)：位於 x，中心 (y, z)，弦長 c、厚 t、後緣上仰 tilt
  function foil(x, y, z, c, t, tilt) {
    const r = [], ct = Math.cos(tilt), st = Math.sin(tilt);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, f = 0.5 - 0.5 * Math.cos(a);
      const pz = f * c - c / 2, py = Math.sin(a) * t * 0.5 * (1 - 0.55 * f);
      r.push([x, y + py * ct - pz * st, z + pz * ct + py * st]);
    }
    return r;
  }
  // GT-R 的大尾翼：主翼片 (兩端下彎收圓) + 後上方的可調副翼 + 兩支往後斜的細腳架 (實車腳架細而後傾，不是厚重的三角板)
  function rearWing(mb) {
    const M = MAT.paint, HS = 0.83, Y = 1.258, Z = 2.115;
    const blade = (hs, y, z, c, t, tilt, droop) => {
      const rings = [];
      for (const f of [-1, -0.988, -0.955, -0.86, -0.6, -0.3, 0, 0.3, 0.6, 0.86, 0.955, 0.988, 1]) {
        const e = Math.abs(f), s = e > 0.999 ? 0.05 : e > 0.98 ? 0.62 : e > 0.95 ? 0.9 : 1;      // 翼端收圓
        rings.push(foil(f * hs, y - droop * Math.pow(e, 6), z, c * s, t * s, tilt));
      }
      loft(mb, rings, M);
    };
    blade(HS, Y, Z, 0.205, 0.038, 0.1, 0.04);
    blade(HS - 0.07, Y + 0.036, Z + 0.1, 0.082, 0.013, 0.3, 0.02);
    for (const sx of [-0.41, 0.41]) {
      const rings = [];
      // [高度, 長, 厚, 中心 z]：底座略寬 (埋進行李廂蓋一點)，往上收窄並明顯後移接到翼片下緣
      for (const [y, L, T, zc] of [[0.99, 0.25, 0.062, 1.97], [1.03, 0.2, 0.042, 1.985], [1.08, 0.16, 0.032, 2.015], [1.15, 0.14, 0.028, 2.06], [1.21, 0.13, 0.026, 2.095], [1.248, 0.13, 0.026, 2.115]]) {
        const r = [];
        for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; r.push([sx + Math.sin(a) * T / 2, y, zc + Math.cos(a) * L / 2]); }
        rings.push(r);
      }
      loft(mb, rings, M);
    }
  }
  function buildParts(D) {
    const body = new MeshBuilder(), decal = new MeshBuilder();
    // 車牌 (後保桿凹槽 / 前保桿進氣口中央)、徽章
    patch(decal, (x, y) => rearP(x, y), [-0.165, 0, 0.165], [0.556, 0.391], 0.005, MAT.plate, D.uv.plate);
    patch(decal, (x, y) => frontP(x, y), [0.165, 0, -0.165], [0.512, 0.347], 0.014, MAT.plate, D.uv.plate);
    patch(decal, (x, y) => rearP(x, y), [0.25, 0.288, 0.326], [0.832, 0.742], 0.004, MAT.chromeTex, D.uv.gtr);       // 行李廂蓋右下 (緊鄰尾燈)
    patch(decal, (x, y) => rearP(x, y), [-0.27, -0.135, 0, 0.135, 0.27], [0.655, 0.598], 0.003, EMBOSS, D.uv.name);   // 保桿上緣 (台階下方) 的 SKYLINE 大字
    patch(decal, (x, y) => frontP(x, y), [0.165, 0.133, 0.101], [0.702, 0.628], 0.008, MAT.chromeTex, D.uv.gtr);       // 水箱罩 (實車偏在車的右側)
    for (const sx of [-1, 1]) {
      // 前葉子板的 GT-R 徽章 (左右各一，字都由左讀到右)
      const sp = S.sideP(sx), zs = sx > 0 ? [-0.875, -0.91, -0.945] : [-0.945, -0.91, -0.875];
      patch(decal, (z, y) => sp(z, y), zs, [0.632, 0.55], 0.004, MAT.chromeTex, D.uv.gtr);
    }
    // 大口徑單出排氣管 (左後，實車照片也在左側)
    body.cyl([-0.5, 0.262, 1.95], [-0.5, 0.256, 2.285], 0.055, 0.06, 20, MAT.chrome, false);
    body.cyl([-0.5, 0.2565, 2.24], [-0.5, 0.2564, 2.245], 0.052, 0.052, 20, MAT.under, true);
    body.cyl([0, 0.26, 1.6], [0, 0.26, 2.0], 0.1, 0.1, 12, MAT.muffler, true);
    PC.wheelArches(body, S, MAP, 0.86, ybS);
    PC.underbody(body, S, MAP, ybS, -2.2, 2.18);
    rearWing(body);
    // 後照鏡：車色鏡殼 + 鏡片，立在車門前角的鏡座上 (鏡座由車門面往外上方伸出)
    for (const sx of [-1, 1]) {
      PC.ellipsoid(body, [sx * 0.925, 1.03, -0.6], [0.102, 0.062, 0.054], MAT.paint, 16, 10);
      body.quad([sx * 1.008, 0.99, -0.554], [sx * 0.848, 0.99, -0.554], [sx * 0.848, 1.072, -0.554], [sx * 1.008, 1.072, -0.554], MAT.mirror);
      const rings = [];
      for (const [x, y, L, T] of [[0.75, 0.948, 0.17, 0.075], [0.81, 0.968, 0.14, 0.066], [0.87, 0.992, 0.12, 0.058]]) {
        const r = [];
        for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; r.push([sx * x, y + Math.sin(a) * T / 2, -0.605 + Math.cos(a) * L / 2]); }
        rings.push(r);
      }
      loft(body, rings, MAT.paint);
    }
    // 內裝
    for (const sx of [-1, 1]) {
      body.box(sx * 0.37, 0.46, 0.12, 0.46, 0.13, 0.5, 0, MAT.fabric);
      body.box(sx * 0.37, 0.8, 0.42, 0.46, 0.62, 0.12, 0, MAT.fabric);
      body.box(sx * 0.37, 1.14, 0.45, 0.22, 0.13, 0.09, 0, MAT.fabric);
      body.box(sx * 0.7, 0.6, 0.1, 0.04, 0.42, 1.7, 0, MAT.dash);
    }
    body.box(0, 0.56, 0.95, 1.24, 0.32, 0.42, 0, MAT.fabric);
    body.box(0, 0.955, 1.34, 1.1, 0.03, 0.42, 0, MAT.dash);
    body.box(0, 0.8, -0.56, 1.4, 0.28, 0.34, 0, MAT.dash);
    body.box(-0.37, 0.965, -0.48, 0.38, 0.05, 0.16, 0, MAT.dash);
    body.cyl([-0.37, 0.86, -0.4], [-0.37, 0.91, -0.3], 0.03, 0.03, 6, MAT.dash, false);
    body.box(0, 0.5, 0.0, 0.22, 0.26, 0.9, 0, MAT.dash);
    body.box(0, 0.25, 0.3, 1.4, 0.05, 2.2, 0, MAT.fabric);
    return { body, decal };
  }

  // ------------------------------------------------------------------ 規格：RB26DETT 2.6 雙渦輪 280 PS、6 速、四驅
  const SPEC_OVER = {
    mass: 1560 + 75, cgH: 0.5, frontW: 0.555, drive: 'AWD', cyl: 6, idle: 950, redline: 8000, cut: 8400, engI: 0.18,
    torque: [[0, 150], [1000, 220], [2000, 300], [3000, 360], [4400, 392], [5500, 380], [6800, 290], [7500, 255], [8000, 225], [8600, 150]],
    ratios: [3.827, 2.36, 1.685, 1.312, 1.0, 0.793], final: 3.545, rev: 3.28, tireRRef: TIRE_R, speedoMax: 300,
    mu: 1.3, muRear: 1.1, cd: 0.315, area: 2.1, lift: -0.15, brakeF: 2800, brakeR: 1800, steerMax: 35 * Math.PI / 180, stiff: 1.4,
    // 性能調校：launch 起步輔助 [推力 N, 開始遞減, 歸零 (km/h)]；drift 甩尾 / 氮氣 (沒列的項目用 vehicle.js 的預設值，也就是 K8 的手感)
    //   四驅重車：加速 (0～100 約 4.8 秒) 與極速 (約 261 km/h) 都是第二快、抓地穩，車重所以氮氣推力給大；甩尾角小、弧線大、集氣稍慢
    // 2026-11-25 車款平衡 (使用者要求：速度可以有快慢但不能差太多，各車有各自的強項)：power 動力倍率 (扭力表維持原廠數字)、
    //   起步輔助、風阻、甩尾 / 氮氣一起調。Node 物理模擬：彎道衝刺單圈六台車差 1 秒內，0～100 km/h 4.4～6.0 秒，極速 242～267 km/h (使用者要求極速差距再縮小，原本 221～299)
    power: 1.05, launch: [6000, 10, 65],
    drift: { angle: 0.32, angleIn: 0.15, turn: 0.95, charge: 0.95, boost: 4400, nitro: 6000 },
  };
  function spec() {
    const Sp = RM.makeSpec(SPEC_OVER, { L: 4.6, W: 1.785, H: 1.36 - DROP, minZ: -2.3, maxZ: 2.3, clear: 0.14, zF: MAP.AXF, zR: MAP.AXR, trackF: 1.48, trackR: 1.49, tireR: TIRE_R });
    const rel = (x, y, z) => [x, y - DROP - Sp.cgH, z - Sp.cgZ];
    Sp.eye = rel(-0.37, 1.13, 0.22); Sp.hood = rel(0, 1.07, -0.85); Sp.bumper = rel(0, 0.45, -2.36);
    Sp.lampF = rel(0.56, 0.665, -2.17); Sp.lampR = rel(0.58, LAMP_Y, 2.23); Sp.exhaust = rel(-0.5, 0.26, 2.32);
    return Sp;
  }

  RM.R34Tex = { build: buildTex };
  PC.register('r34', {
    build() {
      const D = buildDecalTex();
      const { body, decal } = buildParts(D);
      return {
        shell: PC.buildShell(S, SHELL_BOX).build(), body: body.build(), glass: null, decal: decal.build(),
        // 原廠 18 吋鍛造圈：六支粗壯的單肋輻條、槍灰色；金色 Brembo 卡鉗
        ...PC.wheelSet({ R: TIRE_R, RW: 0.2286, Wd: 0.245, spokes: 6, style: 'multi', sw: [0.022, 0.031], bevel: 0.006, dish: 0.03, concave: 0.016, spokeMat: GUN, rim: GUN, rimDark: MAT.rimDark, caliper: GOLD, pistons: 2, disc: 0.17, slots: 6 }),
        steer: PC.buildSteering().build(),
        tex: PC.uploadTex(buildTex(PC.texSize())), decalTex: RM.GLU.texture(D.canvas, { aniso: 8, clamp: true }),
        map: MAP, mapU: INFO.uniforms, DROP,
        steerPos: [-0.37, 0.92, -0.26], tailLamp: [0.58, LAMP_Y, 2.23],
        spec,
      };
    },
  });
})();
