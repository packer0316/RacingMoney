'use strict';
// Porsche 911 Carrera RS 2.7 (1973) 程序化模型 —— 作法見 proc_car.js
// 車身座標：-z = 車頭，x = 右，y = 離地高度；全長 4163 / 寬 1652 / 高 1320 / 軸距 2271 mm，15 吋 Fuchs 輪圈
// 後置引擎：前廂蓋低、兩側葉子板像圓管隆起並以圓燈收尾；車頂一筆弧線 (flyline) 溜到引擎蓋，尾端是鴨尾 (Bürzel)；
// 後葉子板寬而圓、頂面遠低於引擎蓋中脊。外形對照 1973 年實車照片 (F 型車身：獨立的保桿圈 + 黑色膠條、
// 橫向環繞尾燈、頭燈下方的方向燈 / 喇叭格柵、Carrera 側飾帶與車尾 PORSCHE 字樣)。
(function () {
  const RM = window.RM;
  const PC = RM.ProcCar;
  const { MeshBuilder } = RM;
  const V = RM.v3;
  const { sq, sstep, pn, rmax, smin, softPos, spline, lin, MAT } = PC;

  const MAP = {
    XC: 0.52, ZC: 1.72, RC: 0.3, XCF: 0.5, ZCF: -1.7, RCF: 0.3, UMAX: 5.45, Y0: 0.05, Y1: 1.36, Z0: -2.2, Z1: 2.2, XMAX: 0.9,
    AXF: -1.2515, AXR: 1.0195, ARF: 0.36, AYF: 0.33, ARR: 0.36, AYR: 0.33, ARCH_IN: 0.46,
  };
  const INFO = PC.mapInfo(MAP);
  const DROP = 0.02;
  const TIRE_R = 0.32;

  // ------------------------------------------------------------------ 車身外形
  // 911 的側影是一筆水滴線 (flyline)：最高點在駕駛頭頂，之後一路溜到車尾，後擋直接接引擎蓋。
  // 後葉子板的頂面比這條線低得多，從車門腰線往尾燈一路下降 —— 兩條線分開描述，
  // 側面看才是 911 的水滴形，而不是葉子板把中脊遮住、變成平背的三廂車。
  // ylS：前廂蓋中線 → 腰線 → 後葉子板頂；yrS：flyline (車頂 → 後擋 → 引擎蓋中脊，不含鴨尾)
  const ylS = spline([[-2.11, 0.64], [-2.03, 0.646], [-1.93, 0.656], [-1.8, 0.672], [-1.6, 0.702], [-1.25, 0.752], [-0.95, 0.805], [-0.72, 0.868], [-0.6, 0.898], [-0.2, 0.905], [0.35, 0.905], [0.7, 0.875], [1.02, 0.84], [1.4, 0.8], [1.75, 0.762], [2.0, 0.737], [2.11, 0.725]]);
  const yrS = spline([[-0.5, 1.235], [-0.2, 1.292], [0.05, 1.318], [0.3, 1.31], [0.55, 1.272], [0.8, 1.205], [1.05, 1.11], [1.3, 1.005], [1.6, 0.905], [1.85, 0.84], [2.05, 0.8], [2.11, 0.79]]);
  const ybS = spline([[-2.11, 0.26], [-1.9, 0.2], [-1.65, 0.175], [1.4, 0.175], [1.7, 0.235], [1.95, 0.29], [2.11, 0.31]]);
  // 車尾輪廓 z(y)：下擺內收 → 保桿 (獨立凸出的一圈，0.40～0.555) → 尾燈 / 車牌立面 → 鴨尾下方微微內凹 → 鴨尾後緣
  const ZrS = spline([[0.14, 1.86], [0.24, 1.96], [0.33, 2.02], [0.385, 2.047], [0.415, 2.0815], [0.545, 2.0815], [0.58, 2.047], [0.64, 2.038], [0.72, 2.034], [0.78, 2.018], [0.84, 2.012], [0.9, 2.03], [0.95, 2.04], [1.1, 2.04]]);
  // 車頭輪廓：ZfS = 中央 (保桿之上前廂蓋往後斜)，ZfF = 葉子板前端 (較直立、後傾約 30° 的圓燈座)
  const ZfS = spline([[0.14, -1.9], [0.22, -1.99], [0.3, -2.03], [0.37, -2.047], [0.4, -2.0815], [0.53, -2.0815], [0.56, -2.047], [0.6, -2.042], [0.635, -2.03], [0.67, -1.97], [0.72, -1.86], [0.9, -1.5]]);
  const ZfF = spline([[0.14, -1.9], [0.22, -1.99], [0.3, -2.03], [0.37, -2.047], [0.4, -2.0815], [0.53, -2.0815], [0.56, -2.047], [0.62, -2.03], [0.7, -1.985], [0.78, -1.932], [0.86, -1.86], [1.05, -1.7]]);
  // 前葉子板高出前廂蓋的量 (圓管)：頭燈處最高，往後漸漸併入 A 柱根部
  const fendS = spline([[-2.11, 0.15], [-1.93, 0.145], [-1.6, 0.123], [-1.25, 0.09], [-0.95, 0.058], [-0.72, 0.02], [-0.6, 0.0], [0, 0]]);
  // 俯視半寬：車頭窄、車門處收腰、後葉子板最寬 (RS 的寬體後葉子板另外由 flare 鼓出)、車尾收圓
  const WzS = spline([[-2.2, 0.7], [-2.0, 0.755], [-1.8, 0.79], [-1.5, 0.803], [-1.25, 0.806], [-0.9, 0.798], [-0.5, 0.786], [0.0, 0.78], [0.35, 0.784], [0.7, 0.798], [1.02, 0.806], [1.4, 0.8], [1.7, 0.772], [1.95, 0.73], [2.2, 0.66]]);
  const flare = PC.archFlare(MAP, { lipF: 0.006, lipR: 0.008, lipW: 0.05, blF: 0.006, blR: 0.022, blW: 0.24 });

  const YM = 0.52, ZC_R = 1.35, ZC_F = -1.4, YGB = 0.72;
  const gauss = (d, w) => Math.exp(-sq(d / w));
  const bumpY = (y) => sstep(0.385, 0.415, y) * sstep(0.585, 0.55, y);   // 保桿那一圈的高度範圍
  function Ws(y, z) {
    const d = y - 0.52;
    let w = WzS(z) - 0.05 * sq(d / 0.36) + flare(y, z);
    // 保桿繞過車角延伸到輪拱：車側在保桿高度多凸一圈
    if (z > 1.4) w += 0.014 * bumpY(y) * sstep(1.4, 1.52, z);
    else if (z < -1.63) w += 0.014 * bumpY(y) * sstep(-1.63, -1.75, z);
    return w;
  }
  function Tl(ax, z) {
    let y = ylS(z) - 0.012 * sq(ax / 0.8);
    // 前葉子板：兩條高出前廂蓋的圓管，前端收在圓頭燈，往後併入 A 柱根部
    if (z < -0.6) {
      y += fendS(z) * (ax < 0.615 ? gauss(ax - 0.615, 0.118) : 1);
      // 前廂蓋中央微拱：和葉子板之間才有一道凹谷 (實車正面最大的特徵)，不是一片平板
      y += 0.024 * gauss(ax, 0.27) * sstep(-0.6, -0.95, z) * sstep(-2.08, -1.75, z);
    }
    if (z > 1.0) {
      // 溜背中脊：後擋下緣之後由引擎蓋延續車頂線，兩側以圓肩落到後葉子板
      y += Math.max(0, yrS(z) - ylS(z)) * sstep(1.0, 1.4, z) * sstep(0.7, 0.38, ax);
      // 鴨尾 (Bürzel)：引擎蓋後緣往上翹，越往後越陡；兩端收進葉子板
      if (z > 1.66) { const t = Math.min((z - 1.66) / 0.38, 1.05); y += 0.14 * t * Math.sqrt(t) * sstep(0.74, 0.57, ax); }
    }
    return y;
  }
  function sdLower(ax, y, z) {
    const a = ax / Ws(y, z);
    let b = 0, np = 3.6;
    if (z > ZC_R) b = (z - ZC_R) / (ZrS(y) - 0.03 * sq(ax / 0.8) - ZC_R);
    else if (z < ZC_F) {
      const zf = ZfS(y), w = sstep(0.36, 0.56, ax);
      b = (ZC_F - z) / (ZC_F - (zf + (ZfF(y) - zf) * w) - 0.05 * sq(ax / 0.8));
      // 頭燈高度的車角收緊：燈座是一片較平的面，圓燈才不會被車角拉成水滴形
      np = 4.6 + 1.6 * sstep(0.58, 0.68, y);
    }
    const dP = (pn(a, b, np) - 1) * 0.8;
    if (y > YM) {
      // 肩部圓角：前葉子板是圓管、車門較俐落、後葉子板最圓潤；鴨尾後緣 (車尾中段) 要銳利
      let R = 0.085 - 0.022 * sstep(-0.9, -0.5, z) + 0.04 * sstep(0.45, 0.95, z);
      if (b > 0.8) R -= z > 0 ? 0.09 * sstep(0.8, 0.97, b) * sstep(0.78, 0.64, ax) : 0.05 * sstep(0.8, 0.97, b) * sstep(0.6, 0.44, ax);   // 前廂蓋前緣也收緊，底下才留得住那條直立面
      return rmax(dP, y - Tl(ax, z), R);
    }
    return rmax(dP, ybS(z) - y, 0.09);
  }
  const ySill = (z) => 0.895 + 0.045 * sstep(-0.5, 1.0, z);
  function Wg(y, z) {
    const dy = softPos(y - ySill(z));
    return WzS(z) - 0.07 - 0.07 * sstep(0.3, 1.3, z) - 0.02 * sstep(0.0, -0.6, z) - 0.4 * dy - 0.4 * dy * dy;
  }
  const zWs = (y, ax) => -0.72 + (y - 0.895) * 1.4 + 0.3 * ax * ax;
  // 車室頂面沿 flyline；過了後擋下緣就沉入引擎蓋 (由下車身的中脊接手)
  const yRoof = (ax, z) => yrS(z) - 0.04 * sq(ax / 0.52) - 0.14 * sstep(1.38, 1.7, z);
  function sdGreen(ax, y, z) {
    const dP = rmax(ax - Wg(y, z), zWs(y, ax) - z, 0.07);
    // 底面 YGB 要低於後葉子板頂 (0.76～0.84)，不然車室會懸在葉子板上方留下一道縫
    return Math.max(rmax(dP, y - yRoof(ax, z), 0.06), YGB - y);
  }
  function sdBody(x, y, z) {
    const ax = x < 0 ? -x : x;
    return smin(sdLower(ax, y, z), sdGreen(ax, y, z), 0.02 + 0.05 * sstep(0.35, 1.0, z));
  }
  const S = PC.surface(sdBody);
  const { rearP, frontP } = S;
  const patch = (mb, chart, us, vs, off, M, uv) => PC.patch(mb, S, chart, us, vs, off, M, uv);
  const SHELL_BOX = { XO: 0.88, YB: 0.05, YT: 1.36, ZO: 2.12, WI: 0.36, YI0: 0.4, YI1: 0.56, ZI: 1.5 };

  // ------------------------------------------------------------------ 貼圖
  function buildTex(W) {
    const M = MAP, K = PC.texKit(W, M);
    const { X, fill, stroke, poly, line, rect, circ, rpoly, clipTo, lgrad, rgrad, region, end, gap, uz, uf, qcurve } = K;
    const CHROME = { c: '#c9ccd0', r: 0.14, m: 1 }, RUB = { c: '#0b0b0d', r: 0.6, m: 0 };
    region('belt');
    const uAR = uz(M.AXR), uAF = uz(M.AXF), AR = M.ARR, AY = M.AYR;
    const UR = uAR - AR, UFr = uAF + AR;       // 後輪拱後緣 / 前輪拱前緣的 u (保桿繞到這裡為止)
    // ---- 底盤下緣 (黑)、Carrera 側飾帶 (黑底，字樣是白色貼片)
    fill(rect(-0.2, 0.0, M.UMAX + 0.2, 0.2), { c: '#0b0b0d', r: 0.5, m: 0 });
    fill(rect(uAR + AR + 0.04, 0.292, uAF - AR - 0.04, 0.366), { c: '#0a0a0c', r: 0.28, m: 0 });
    // ---- 保桿：上下緣接縫 (保桿是獨立的一圈) + 中間的黑色防撞膠條 (微凸)
    gap([[-0.2, 0.572], [UR - 0.004, 0.572]]);
    gap([[-0.2, 0.396], [UR - 0.004, 0.396]]);
    stroke(line([[-0.2, 0.482], [UR - 0.03, 0.482]]), 0.036, Object.assign({ h: 2.6, cap: 'butt' }, RUB));
    gap([[UFr + 0.004, 0.556], [M.UMAX + 0.2, 0.556]]);
    gap([[UFr + 0.004, 0.392], [M.UMAX + 0.2, 0.392]]);
    stroke(line([[UFr + 0.03, 0.468], [M.UMAX + 0.2, 0.468]]), 0.036, Object.assign({ h: 2.6, cap: 'butt' }, RUB));
    // ---- 輪拱捲邊：沿開口一圈微凸的唇 (車身的外擴由 sdBody 的 flare 做，這裡只補那道俐落的邊)
    for (const [ua, R] of [[uAR, M.ARR], [uAF, M.ARF]]) {
      const p = [[ua + R + 0.011, 0.2]];
      for (let a = 0; a <= 180; a += 6) { const r = (a * Math.PI) / 180; p.push([ua + (R + 0.011) * Math.cos(r), AY + (R + 0.011) * Math.sin(r)]); }
      p.push([ua - R - 0.011, 0.2]);
      stroke(line(p), 0.022, { h: 1.6, cap: 'butt' });
    }
    // ---- 車尾：引擎蓋下緣接縫、PORSCHE 飾帶、車牌凹槽與牌照燈、橫向環繞尾燈
    {
      // (PORSCHE 字樣是貼片零件，直接貼在車漆上；實車沒有黑底飾帶)
      gap([[-0.2, 0.728], [0.525, 0.728], [0.56, 0.765], [0.56, 1.0]]);
      fill(rpoly([[-0.2, 0.55], [0.19, 0.55], [0.19, 0.718], [-0.2, 0.718]], [0, 0.012, 0.012, 0]), { h: -2.5 });
      // 尾燈：內側白色倒車燈 | 紅色尾燈 / 煞車燈 | 外側琥珀方向燈 (繞過車角到車側)；鍍鉻細框、水平稜紋透鏡
      const y0 = 0.606, y1 = 0.714, uA = 0.498, uB = 0.7;
      const P = [[0.395, y0], [0.9, y0], [0.932, y0 + 0.024], [0.932, y1 - 0.024], [0.9, y1], [0.395, y1]];
      const R = [0.012, 0.02, 0.02, 0.02, 0.02, 0.012];
      stroke(rpoly(P, R), 0.013, Object.assign({ h: 1.6 }, CHROME));
      // 整個燈區都要有非零的 mask：著色器靠它判斷燈區，才會把內層往透鏡後面推 (視差)；老式燈殼很淺
      fill(rpoly(P, R), { c: lgrad(0, y1, 0, y0, [[0, '#7a0c12'], [0.5, '#9c1219'], [1, '#62090e']]), r: 0.07, m: 0, h: 1.0, mask: '#380000', lens: 0.012 });
      clipTo(rpoly(P, R), () => {
        const g = X.A;
        fill(rect(0.38, y0 - 0.01, uA - 0.003, y1 + 0.01), { c: lgrad(0, y1, 0, y0, [[0, '#dcdfe0'], [1, '#a4a9ac']]), mask: '#000038' });
        fill(rect(uB + 0.003, y0 - 0.01, 0.95, y1 + 0.01), { c: lgrad(0, y1, 0, y0, [[0, '#c26a0c'], [1, '#844405']]), mask: '#003800' });
        // 燈泡附近最亮：亮度分布 (mask) 與反射罩的亮斑 (顏色)
        const ym = (y0 + y1) / 2;
        for (const [bu, br, mc, col] of [[0.6, 0.085, '#c80000', '255,110,100'], [0.445, 0.05, '#0000c8', '255,255,255'], [0.8, 0.09, '#00c800', '255,214,130']]) {
          fill(circ(bu, ym, br, 0.05), { mask: rgrad(bu, ym, br, [[0, mc], [1, '#000000']]), add: true });
          g.fillStyle = rgrad(bu, ym, br, [[0, `rgba(${col},0.45)`], [0.4, `rgba(${col},0.16)`], [1, `rgba(${col},0)`]])(g);
          g.fillRect(bu - br, ym - br, br * 2, br * 2);
        }
        for (let y = y0 + 0.006; y < y1; y += 0.0085) { g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(0.38, y, 0.6, 0.002); g.fillStyle = 'rgba(255,255,255,0.09)'; g.fillRect(0.38, y + 0.0026, 0.6, 0.0016); }
        for (let u = 0.4; u < 0.94; u += 0.011) { g.fillStyle = 'rgba(0,0,0,0.1)'; g.fillRect(u, y0, 0.0018, 0.12); }
        for (const u of [uA, uB]) stroke(line([[u, y0 - 0.01], [u, y1 + 0.01]]), 0.005, { c: '#161214', h: -0.8 });
        stroke(rpoly(P, R), 0.012, { c: 'rgba(0,0,0,0.32)' });
      });
    }
    // ---- 車側：車門、門檻、鍍鉻門把
    gap([[uz(0.4), 0.94], [uz(0.4) + 0.01, 0.6], [uz(0.4) + 0.05, 0.3], [uz(0.4) + 0.055, 0.235]]);
    gap([[uz(-0.62), 0.905], [uz(-0.62), 0.235]]);
    gap([[uz(0.4) + 0.055, 0.235], [uz(-0.62), 0.235]]);
    K.handle(0.2, 0.33, 0.795, 0.827, true);
    // ---- 側窗：鍍鉻窗框 → 黑色膠條 → 玻璃。後三角窗尾端以圓弧收尾 (911 招牌的水滴形窗)，門窗前端有一支鍍鉻三角窗框
    {
      const ySl = (z) => ySill(z) + 0.012, Z0 = -0.66, Z1 = 0.97, RE = 0.2;
      const win = (z0, z1, ins) => {
        const lo = [], hi = [], ze = Z1 - ins - RE, he = yrS(ze) - 0.085 - ins - (ySl(ze) + ins);
        for (let k = 0; k <= 64; k++) {
          const z = z0 + ((z1 - z0) * k) / 64, b = ySl(z) + ins;
          let t = Math.min(yrS(z) - 0.085 - ins, 0.895 + (z + 0.62 - ins * 2.2) / 1.4);     // 車頂弧線、A 柱斜線
          if (z > ze) { const d = (z - ze) / RE; t = Math.min(t, b + he * Math.sqrt(Math.max(0, 1 - d * d))); }
          if (t > b + 0.004) { lo.push([uz(z), b]); hi.push([uz(z), t]); }
        }
        return lo.concat(hi.reverse());
      };
      fill(poly(win(Z0, Z1, 0)), Object.assign({ h: 1.0 }, CHROME));
      fill(poly(win(Z0 + 0.012, Z1 - 0.008, 0.009)), { c: '#070708', r: 0.42, m: 0, h: -1.2 });
      for (const [a, b] of [[-0.6, 0.37], [0.44, 0.955]]) {
        const p = win(a, b, 0.022);
        if (p.length > 4) { fill(poly(p), { erase: true, glass: 1, h: -2.5 }); stroke(poly(p), 0.014, { glass: 1 }); }
      }
      stroke(line([[uz(-0.3), ySl(-0.3) + 0.012], [uz(-0.3), 0.895 + (-0.3 + 0.62) / 1.4 - 0.028]]), 0.012, Object.assign({ h: 0.8, glass: 0, cap: 'butt' }, CHROME));
    }
    // ---- 車頭：頭燈下方、保桿上緣的方向燈組 (外側琥珀繞到車角、內側白色小燈) + 喇叭格柵；下方是機油冷卻器開口
    {
      const u0 = INFO.UF0 + 0.14, u1 = uf(0.5), u2 = uf(0.4), u3 = uf(0.275), y0 = 0.566, y1 = 0.624;
      fill(rpoly([[u0, y0], [u2, y0], [u2, y1], [u0, y1]], 0.014), Object.assign({ h: 1.4 }, CHROME));
      const L = rpoly([[u0 + 0.007, y0 + 0.007], [u2 - 0.007, y0 + 0.007], [u2 - 0.007, y1 - 0.007], [u0 + 0.007, y1 - 0.007]], 0.008);
      fill(L, { c: lgrad(0, y1, 0, y0, [[0, '#c26a0c'], [1, '#844405']]), r: 0.08, m: 0, h: 0.8, mask: '#003000', lens: 0.012 });
      clipTo(L, () => {
        // 內側白色小燈走頭燈通道 (開大燈才亮；b 通道是日行燈，白天也會亮，老車沒有)
        fill(rect(u1 + 0.003, y0, u2, y1), { c: lgrad(0, y1, 0, y0, [[0, '#e8ebec'], [1, '#aeb3b6']]), mask: '#300000' });
        const uc = (u0 + u1) / 2;
        fill(circ(uc, (y0 + y1) / 2, 0.07, 0.03), { mask: rgrad(uc, (y0 + y1) / 2, 0.07, [[0, '#00c800'], [1, '#000000']]), add: true });
        for (let u = u0; u < u2; u += 0.009) { X.A.fillStyle = 'rgba(0,0,0,0.16)'; X.A.fillRect(u, y0, 0.002, 0.07); }
        stroke(line([[u1, y0], [u1, y1]]), 0.004, { c: '#161214', h: -0.8 });
        stroke(L, 0.008, { c: 'rgba(0,0,0,0.3)' });
      });
      fill(rpoly([[u2 + 0.014, y0 + 0.004], [u3, y0 + 0.004], [u3, y1 - 0.006], [u2 + 0.014, y1 - 0.006]], 0.008), { c: '#050506', r: 0.5, m: 0, h: -3 });
      for (let u = u2 + 0.026; u < u3 - 0.008; u += 0.013) { X.A.fillStyle = 'rgba(70,72,78,0.85)'; X.A.fillRect(u, y0 + 0.008, 0.004, y1 - y0 - 0.018); }
      fill(rpoly([[uf(0.31), 0.262], [uf(-0.1), 0.262], [uf(-0.1), 0.352], [uf(0.31), 0.352]], [0.018, 0, 0, 0.018]), { c: '#040405', r: 0.7, m: 0, h: -6 });
      stroke(rpoly([[uf(0.31), 0.262], [uf(-0.1), 0.262], [uf(-0.1), 0.352], [uf(0.31), 0.352]], [0.018, 0, 0, 0.018]), 0.01, { h: 1.2 });
    }
    end();

    region('top');
    const CHR = Object.assign({ h: 1.2 }, CHROME);
    // 玻璃的鍍鉻飾條：比 K.topGlass 的黑邊再大一圈，先畫在底下
    const trim = (o, e) => {
      const f = o.zt > o.zb ? 1 : -1;
      fill(poly(qcurve(o.zt + f * e, o.k, -0.05, o.wt + e).concat(qcurve(o.zb - f * e, o.k, -0.05, o.wb + e).reverse())), CHR);
    };
    // 前廂蓋接縫 (U 形)、前擋下方的進氣格柵、盾徽
    gap([[-0.79, 0.475], [-1.9, 0.475]].concat(qcurve(-1.985, 0.3, 0.44, -0.05, 10)));
    fill(rpoly(qcurve(-0.79, 0.3, -0.05, 0.2, 6).concat(qcurve(-0.752, 0.3, -0.05, 0.2, 6).reverse()), 0.008), { c: '#0b0b0c', r: 0.85, m: 0, h: -3 });
    fill(rpoly([[-1.955, -0.05], [-1.955, 0.022], [-1.93, 0.03], [-1.895, 0.012], [-1.88, -0.05]], 0.008), { c: '#b08a2a', r: 0.25, m: 0.8, h: 1.5 });
    const WS = { zb: -0.7, zt: -0.19, k: 0.3, wb: 0.66, wt: 0.47 };
    trim(WS, 0.026); K.topGlass(WS);
    for (const [w, c] of [[0.016, '#0a0a0b'], [0.005, '#2a2b2e']]) stroke(line(qcurve(-0.648, 0.3, 0.1, 0.5, 10)), w, { c, r: 0.6, m: 0 });
    fill(circ(-0.655, 0.1, 0.018, 0.018), { c: '#111113', r: 0.5, m: 0 });
    // 後擋 (很斜、直接接引擎蓋)：鍍鉻飾條 + 除霧線
    const RG = { zt: 0.74, zb: 1.33, k: -0.3, wt: 0.44, wb: 0.53, defrost: { z0: 0.82, dz: 0.042, n: 12 } };
    trim(RG, 0.026); K.topGlass(RG);
    // 引擎蓋：前緣沿後擋下緣、兩側往後接到車尾立面的接縫；後擋正下方是黑色進氣格柵 (橫向格條)
    gap(qcurve(1.378, -0.3, -0.05, 0.5, 12).concat([[1.33, 0.545], [1.42, 0.56], [2.2, 0.56]]));
    fill(rpoly([[1.41, -0.05], [1.41, 0.34], [1.63, 0.34], [1.63, -0.05]], [0, 0.03, 0.03, 0]), { c: '#060607', r: 0.95, m: 0, h: -4 });
    for (let z = 1.424; z < 1.62; z += 0.02) { X.A.fillStyle = 'rgba(30,31,34,0.95)'; X.A.fillRect(z, 0, 0.006, 0.33); }
    stroke(rpoly([[1.41, -0.05], [1.41, 0.34], [1.63, 0.34], [1.63, -0.05]], [0, 0.03, 0.03, 0]), 0.008, { c: '#111113', r: 0.4, m: 0, h: 1.2 });
    {
      // 窗下鍍鉻飾條在俯視的對應 (肩線圓角處兩個投影都看得到)
      const p = [];
      for (let z = -0.58; z <= 0.93; z += 0.04) p.push([z, Wg(ySill(z) + 0.012, z) + 0.008]);
      stroke(line(p), 0.026, { c: '#c9ccd0', r: 0.14, m: 1, cap: 'butt' });
    }
    end();
    return K.finish();
  }

  // 車尾的小字 (車身座標 x 範圍、y / z 範圍)：
  //   PORSCHE：RS 招牌的鏤空字型 (細的方塊字、筆畫在轉角斷開)，直接貼在引擎蓋下緣的車漆上，不加黑底
  //   Carrera RS：鴨尾後面偏右的一行小草寫字；2.7：引擎蓋格柵右上角的鍍鉻小牌
  const REAR_TXT = {
    porsche: { x0: -0.2, x1: 0.2, y0: 0.744, y1: 0.768 },
    carrera: { x0: 0.07, x1: 0.235, y0: 0.882, y1: 0.902 },
    badge27: { x0: 0.235, x1: 0.285, z0: 1.462, z1: 1.488 },
  };
  function buildDecalTex() {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 256;
    const g = c.getContext('2d');
    const CW = c.width, CH = c.height;
    const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
    g.fillStyle = '#f2f2ec'; rr(2, 2, 252, 124, 10); g.fill();
    g.strokeStyle = '#222'; g.lineWidth = 4; rr(6, 6, 244, 116, 8); g.stroke();
    g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 64px ' + (RM.FONT || 'sans-serif');
    g.fillText('RS-2711', 128, 68, 226);
    // Carrera 字樣 (車側黑色飾帶上的白色斜體)
    g.fillStyle = '#f4f4f0'; g.font = 'italic 900 78px Georgia, "Times New Roman", serif';
    g.fillText('Carrera', 256, 196, 480);
    // 小字用白色畫 (貼片材質再上深色 / 鍍鉻)。貼片的長寬比和貼圖區塊不同：先換算「每公分幾像素」，照實際尺寸畫
    const region = (px0, py0, px1, py1, w, h) => ({ px0, py0, sx: (px1 - px0) / w, sy: (py1 - py0) / h, uv: [px0 / CW, py0 / CH, px1 / CW, py1 / CH] });
    const T = REAR_TXT;
    // ---- PORSCHE 鏤空字：每個字 6 x 3 單位，筆畫 0.62、轉角斷開 0.42 —— 寬扁、細筆畫、筆畫間有縫
    const P = region(520, 8, 1016, 72, (T.porsche.x1 - T.porsche.x0) * 100, (T.porsche.y1 - T.porsche.y0) * 100);
    {
      const U = ((T.porsche.x1 - T.porsche.x0) * 100) / (7 * 6 + 6 * 1.2), t = 0.62, gp = 0.42, W = 6, H = 3, M = H / 2;
      const L = 0, R = W, TP = 0, B = H;
      const GLYPH = {
        P: [[L, TP, L + t, B], [L + t + gp, TP, R, TP + t], [R - t, TP + t + gp, R, M + t / 2], [L + t + gp, M - t / 2, R - t - gp, M + t / 2]],
        O: [[L, TP, L + t, B], [R - t, TP, R, B], [L + t + gp, TP, R - t - gp, TP + t], [L + t + gp, B - t, R - t - gp, B]],
        R: [[L, TP, L + t, B], [L + t + gp, TP, R, TP + t], [R - t, TP + t + gp, R, M + t / 2], [L + t + gp, M - t / 2, R - t - gp, M + t / 2], [R - t, M + t / 2 + gp, R, B]],
        S: [[L, TP, R, TP + t], [L, TP + t + gp, L + t, M + t / 2], [L + t + gp, M - t / 2, R, M + t / 2], [R - t, M + t / 2 + gp, R, B - t - gp], [L, B - t, R, B]],
        C: [[L, TP, L + t, B], [L + t + gp, TP, R, TP + t], [L + t + gp, B - t, R, B]],
        H: [[L, TP, L + t, B], [R - t, TP, R, B], [L + t + gp, M - t / 2, R - t - gp, M + t / 2]],
        E: [[L, TP, L + t, B], [L + t + gp, TP, R, TP + t], [L + t + gp, M - t / 2, R - gp * 1.5, M + t / 2], [L + t + gp, B - t, R, B]],
      };
      g.fillStyle = '#ffffff';
      'PORSCHE'.split('').forEach((ch, i) => {
        const ox = i * (W + 1.2);
        for (const [a, b2, cc, d] of GLYPH[ch]) g.fillRect(P.px0 + (ox + a) * U * P.sx, P.py0 + b2 * U * P.sy, (cc - a) * U * P.sx, (d - b2) * U * P.sy);
      });
    }
    // ---- Carrera RS：草寫斜體 + 小一號的 RS
    const C = region(520, 96, 1016, 176, (T.carrera.x1 - T.carrera.x0) * 100, (T.carrera.y1 - T.carrera.y0) * 100);
    {
      g.save();
      g.translate(C.px0, C.py0 + 1.5 * C.sy); g.scale(C.sx, C.sy);          // 之後以公分為單位畫
      g.fillStyle = '#ffffff'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      const F1 = 'italic 700 1.8px "Brush Script MT", "Segoe Script", Georgia, serif', F2 = 'italic 900 1.1px Arial, sans-serif';
      g.font = F1; const w1 = g.measureText('Carrera').width;
      g.font = F2; const w2 = g.measureText('RS').width;
      const x0 = Math.max(0, ((T.carrera.x1 - T.carrera.x0) * 100 - (w1 + 0.35 + w2)) / 2);   // 置中
      g.font = F1; g.fillText('Carrera', x0, 0);
      g.font = F2; g.fillText('RS', x0 + w1 + 0.35, 0);
      g.restore();
    }
    // ---- 2.7 鍍鉻小牌
    const B7 = region(520, 192, 640, 252, (T.badge27.x1 - T.badge27.x0) * 100, (T.badge27.z1 - T.badge27.z0) * 100);
    {
      g.save();
      g.translate(B7.px0, B7.py0); g.scale(B7.sx, B7.sy);
      g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '700 2.4px Arial, sans-serif';
      g.fillText('2.7', 2.5, 1.35);
      g.restore();
    }
    return {
      canvas: c,
      uv: { plate: [0.5 / CW, 0.5 / CH, 255.5 / CW, 127.5 / CH], script: [10 / CW, 146 / CH, 502 / CW, 246 / CH], porsche: P.uv, carrera: C.uv, badge27: B7.uv },
    };
  }

  // 貼紙材質 (貼圖去背、不反金屬光)：白色字樣、深色字樣
  const VINYL = RM.mat('#ffffff', 0.5, 0, 2), VINYL_DK = RM.mat('#0b0b0d', 0.4, 0, 2);
  // 繞任意軸的旋轉體：O 原點、ax 軸向 (單位向量)、prof = [[沿軸距離, 半徑]…]。
  // 法線取輪廓走向的左側；三角形繞向依法線決定 (著色器會把背面的法線翻過來，繞向錯了受光就是反的)
  function lathe(mb, O, ax, prof, M, seg) {
    const u = V.norm([0, 0, 0], V.cross([0, 0, 0], ax, [0, 1, 0])), w = V.cross([0, 0, 0], ax, u);
    const np = prof.length, base = mb.vcount, P = [], N = [];
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const r = [u[0] * ca + w[0] * sa, u[1] * ca + w[1] * sa, u[2] * ca + w[2] * sa];
      for (let j = 0; j < np; j++) {
        const p0 = prof[Math.max(j - 1, 0)], p1 = prof[Math.min(j + 1, np - 1)];
        const dt = p1[0] - p0[0], dr = p1[1] - p0[1], l = Math.hypot(dt, dr) || 1;
        const p = [O[0] + ax[0] * prof[j][0] + r[0] * prof[j][1], O[1] + ax[1] * prof[j][0] + r[1] * prof[j][1], O[2] + ax[2] * prof[j][0] + r[2] * prof[j][1]];
        const n = [(-dr * ax[0] + dt * r[0]) / l, (-dr * ax[1] + dt * r[1]) / l, (-dr * ax[2] + dt * r[2]) / l];
        P.push(p); N.push(n);
        mb.v(p[0], p[1], p[2], n[0], n[1], n[2], 0, 0, M);
      }
    }
    for (let k = 0; k < seg; k++) for (let j = 0; j < np - 1; j++) {
      const a = k * np + j, b = a + 1, c = a + np, d = c + 1;
      const e1 = V.sub([0, 0, 0], P[c], P[a]), e2 = V.sub([0, 0, 0], P[b], P[a]);
      if (V.dot(V.cross([0, 0, 0], e1, e2), N[a]) > 0) mb.i.push(base + a, base + c, base + d, base + a, base + d, base + b);
      else mb.i.push(base + a, base + d, base + c, base + a, base + b, base + d);
    }
  }
  function buildParts(D) {
    const body = new MeshBuilder(), decal = new MeshBuilder(), glass = new MeshBuilder();
    const rear = (x, y) => rearP(x, y);
    patch(decal, rear, [-0.16, 0, 0.16], [0.708, 0.56], 0.005, MAT.plate, D.uv.plate);
    patch(decal, (x, y) => frontP(x, y), [0.15, 0, -0.15], [0.536, 0.406], 0.008, MAT.plate, D.uv.plate);
    // 車尾小字：引擎蓋下緣的 PORSCHE 鏤空字、鴨尾後面偏右的 Carrera RS、格柵上的 2.7
    const T = REAR_TXT;
    patch(decal, rear, lin(T.porsche.x0, T.porsche.x1, 10), [T.porsche.y1, T.porsche.y0], 0.003, VINYL_DK, D.uv.porsche);
    patch(decal, rear, lin(T.carrera.x0, T.carrera.x1, 4), [T.carrera.y1, T.carrera.y0], 0.003, VINYL_DK, D.uv.carrera);
    patch(decal, (x, z) => S.topP(x, z), lin(T.badge27.x0, T.badge27.x1, 2), [T.badge27.z0, T.badge27.z1], 0.004, MAT.chromeTex, D.uv.badge27);
    // 車側 Carrera 字樣 (左右各一，文字皆由左讀到右)
    for (const sx of [-1, 1]) {
      const sp = S.sideP(sx), zs = sx > 0 ? [0.35, 0.1, -0.15] : [-0.15, 0.1, 0.35];
      patch(decal, (z, y) => sp(z, y), zs, [0.366, 0.296], 0.004, VINYL, D.uv.script);
    }
    // 圓形頭燈：獨立的立體零件 (不貼合車殼曲面) —— 鍍鉻燈框是一個從葉子板前端探出來的圓筒，
    // 裡面是內凹的反射碗與燈泡遮罩，外面罩一片凸透鏡 (半透明，開燈時發光)。貼合曲面的做法會被葉子板的弧度拉成水滴形。
    for (const sx of [-1, 1]) {
      const ax = V.norm([0, 0, 0], [sx * 0.1, 0.46, -0.88]);            // 燈軸：朝前、後仰約 28°
      const hit = S.rayIn([sx * 0.595 + ax[0] * 0.4, 0.695 + ax[1] * 0.4, -1.92 + ax[2] * 0.4], [-ax[0], -ax[1], -ax[2]], 1.2) || [sx * 0.595, 0.695, -1.94];
      const O = [hit[0] - ax[0] * 0.008, hit[1] - ax[1] * 0.008, hit[2] - ax[2] * 0.008];
      lathe(body, O, ax, [[-0.07, 0.099], [0.004, 0.103], [0.013, 0.101], [0.017, 0.094], [0.012, 0.086]], MAT.chrome, 28);
      lathe(body, O, ax, [[0.012, 0.086], [-0.004, 0.066], [-0.016, 0.036], [-0.02, 0.0]], MAT.reflector, 28);
      lathe(body, O, ax, [[-0.02, 0.022], [0.0, 0.02], [0.005, 0.012], [0.006, 0.0]], MAT.chrome, 14);
      lathe(glass, O, ax, [[0.013, 0.0865], [0.022, 0.072], [0.03, 0.046], [0.0345, 0.0]], MAT.head, 28);
    }
    // 單出排氣尾管 (左後) + 橫置消音器 (911 的消音器橫在引擎後方，從車尾下方看得到)
    body.cyl([-0.44, 0.262, 1.78], [-0.44, 0.258, 2.035], 0.036, 0.04, 18, MAT.chrome, false);
    body.cyl([-0.44, 0.2586, 2.0], [-0.44, 0.2585, 2.005], 0.033, 0.033, 18, MAT.under, true);
    body.cyl([-0.5, 0.27, 1.72], [0.5, 0.27, 1.72], 0.085, 0.085, 12, MAT.muffler, true);
    PC.wheelArches(body, S, MAP, 0.745, ybS);   // 內襯前後壁下緣跟著車底，不會垂到車底下面
    PC.underbody(body, S, MAP, ybS, -2.0, 1.98);
    // 門上的小圓鏡 (鍍鉻殼、鏡面朝後)：用一支細桿從窗台下緣伸出去
    for (const sx of [-1, 1]) {
      PC.ellipsoid(body, [sx * 0.805, 0.958, -0.47], [0.056, 0.054, 0.03], MAT.chrome, 14, 8);
      const mz = -0.4395, mp = [];
      for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; mp.push([sx * 0.805 + Math.cos(a) * 0.046, 0.958 + Math.sin(a) * 0.044, mz]); }
      for (let k = 1; k < 11; k += 2) body.quad(mp[0], mp[k], mp[k + 1], mp[Math.min(k + 2, 11)], MAT.mirror);
      body.box(sx * 0.73, 0.925, -0.47, 0.11, 0.016, 0.024, 0, MAT.chrome);
    }
    for (const sx of [-1, 1]) {
      body.box(sx * 0.33, 0.44, 0.1, 0.42, 0.12, 0.48, 0, MAT.fabric);
      body.box(sx * 0.33, 0.76, 0.36, 0.42, 0.6, 0.12, 0, MAT.fabric);
      body.box(sx * 0.33, 1.08, 0.39, 0.2, 0.12, 0.08, 0, MAT.fabric);
      body.box(sx * 0.66, 0.58, 0.0, 0.04, 0.4, 1.3, 0, MAT.dash);
    }
    body.box(0, 0.6, 0.78, 1.0, 0.36, 0.3, 0, MAT.fabric);
    body.box(0, 0.78, -0.4, 1.22, 0.24, 0.3, 0, MAT.dash);
    body.box(-0.33, 0.925, -0.33, 0.44, 0.05, 0.16, 0, MAT.dash);
    body.cyl([-0.33, 0.82, -0.26], [-0.33, 0.87, -0.16], 0.03, 0.03, 6, MAT.dash, false);
    body.box(0, 0.27, 0.2, 1.24, 0.05, 1.8, 0, MAT.fabric);
    return { body, decal, glass };
  }

  // ------------------------------------------------------------------ 規格：2.7 水平對臥六缸 210 PS、5 速、後置引擎後驅
  const SPEC_OVER = {
    mass: 1075 + 75, cgH: 0.48, frontW: 0.41, drive: 'FR', cyl: 6, idle: 900, redline: 7200, cut: 7600, engI: 0.14,
    torque: [[0, 120], [1000, 160], [2000, 195], [3000, 220], [4000, 240], [5100, 255], [6300, 234], [7200, 200], [7800, 130]],
    ratios: [3.182, 1.833, 1.261, 0.926, 0.724], final: 4.429, rev: 3.325, tireRRef: TIRE_R, speedoMax: 280,
    mu: 1.2, muRear: 1.12, cd: 0.345, area: 1.75, lift: 0.05, brakeF: 1700, brakeR: 1300, steerMax: 36 * Math.PI / 180, stiff: 1.25,
    // 性能調校：launch 起步輔助 [推力 N, 開始遞減, 歸零 (km/h)]；drift 甩尾 / 氮氣 (沒列的項目用 vehicle.js 的預設值，也就是 K8 的手感)
    //   強項是加速 (後置引擎牽引力好)：0～100 全車款最快 (約 4.4 秒)、彈射起步最猛；甩尾中掉速稍多、弧線略大，極速約 255 km/h
    // 2026-11-25 車款平衡 (使用者要求：速度可以有快慢但不能差太多，各車有各自的強項)：power 動力倍率 (扭力表維持原廠數字)、
    //   起步輔助、風阻、甩尾 / 氮氣一起調。Node 物理模擬：彎道衝刺單圈六台車差 1 秒內，0～100 km/h 4.4～6.0 秒，極速 242～267 km/h (使用者要求極速差距再縮小，原本 221～299)
    power: 1.12, launch: [9500, 10, 70],
    drift: { angle: 0.35, turn: 0.96, drag: 1.4, boost: 3800, nitro: 4300 },
  };
  function spec() {
    const Sp = RM.makeSpec(SPEC_OVER, { L: 4.163, W: 1.652, H: 1.32 - DROP, minZ: -2.0815, maxZ: 2.0815, clear: 0.14, zF: MAP.AXF, zR: MAP.AXR, trackF: 1.372, trackR: 1.394, tireR: TIRE_R });
    const rel = (x, y, z) => [x, y - DROP - Sp.cgH, z - Sp.cgZ];
    Sp.eye = rel(-0.33, 1.08, 0.12); Sp.hood = rel(0, 1.0, -0.66); Sp.bumper = rel(0, 0.42, -2.14);
    Sp.lampF = rel(0.595, 0.69, -1.93); Sp.lampR = rel(0.6, 0.66, 2.0); Sp.exhaust = rel(-0.44, 0.258, 2.05);
    return Sp;
  }

  RM.P911Tex = { build: buildTex };
  PC.register('p911', {
    build() {
      const D = buildDecalTex();
      const { body, decal, glass } = buildParts(D);
      return {
        shell: PC.buildShell(S, SHELL_BOX).build(), body: body.build(), glass: glass.build(), decal: decal.build(),
        ...PC.wheelSet({ R: TIRE_R, RW: 0.1905, Wd: 0.205, spokes: 5, style: 'multi', sw: [0.036, 0.06], bevel: 0.006, dish: 0.04, spokeMat: MAT.rimBlack, edgeMat: MAT.rim, rim: MAT.rim, rimDark: MAT.rimBlack2, cap: MAT.rimBlack }),
        steer: PC.buildSteering().build(),
        tex: PC.uploadTex(buildTex(PC.texSize())), decalTex: RM.GLU.texture(D.canvas, { aniso: 8, clamp: true }),
        map: MAP, mapU: INFO.uniforms, DROP,
        steerPos: [-0.33, 0.88, -0.14], tailLamp: [0.6, 0.66, 2.0],
        spec,
      };
    },
  });
})();
