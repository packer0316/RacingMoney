'use strict';
// 改裝的外觀 (js/game/tuning.js 的零件 → 網格 / 貼圖)
//   輪圈 + 輪胎 + 卡鉗：依原廠輪子的尺寸 (wheelOpts) 重新產生整組輪子 (proc_car.js buildWheel)，輪圈加大 1～2 吋 (胎扁平)
//   排氣管：在原廠尾管的位置疊上新的尾管 (不鏽鋼捲邊、燒鈦漸層、碳纖維護套)
//   避震：車身降低 (main.js _carDraw 用 S.lower)、輪胎外傾 (S.camber)
//   彩繪：一張 2048×1024 的貼圖 (右側 / 左側 / 頂面 / 擋風玻璃上緣)，由車殼著色器疊在烤漆上 (shaders.js livery)
//     兩側各自一塊，文字兩邊都是正的；有方向性的圖案 (速度線、火焰) 在另一側鏡射，一樣朝車頭
(function () {
  const RM = window.RM, PC = RM.ProcCar, T = RM.Tuning;
  const MAT = PC.MAT;
  const mats = new Map();
  const mat = (hex, rough, metal) => { const k = hex + rough + ',' + metal; if (!mats.has(k)) mats.set(k, RM.mat(hex, rough, metal)); return mats.get(k); };
  const finOf = (key, i) => { const L = T.FIN[key] || []; return L[i] || L[0]; };
  const fmat = (f) => mat(f.hex, f.rough, f.metal);
  const darker = (hex, k) => '#' + hex.slice(1).match(/../g).map((v) => Math.round(parseInt(v, 16) * k).toString(16).padStart(2, '0')).join('');

  // ------------------------------------------------------------------ 輪子
  // base：原廠的 buildWheel 參數 (車款 build() 的 wheelSet)；fit：tuning.js fitOf
  // 鋁圈材質 (js/car/wheel_builder.js 的著色模式)：paint 烤漆 (亮片 = 金屬漆)、anod 陽極 / 霧面金屬、cut 鑽石切削 (車削紋 + 放射狀反光)
  const wmat = (f, kind) => {
    const k = kind || (f.metal >= 0.75 ? 'anod' : 'paint');
    const key = f.hex + f.rough + f.metal + k;
    if (!mats.has(key)) {
      // 鑽石切削面：鋁的亮色 + 部分漫射 (車庫 / 山路的環境偏暗，全金屬會反射成黑的)；拋光唇維持鏡面
      mats.set(key, k === 'cut' ? (f.rough <= 0.05 ? RM.mat(f.hex, 0.07, 1, 40, 0, 0.5) : RM.mat('#cfd2d6', 0.3, 0.55, 40, 0, 0.55))
        : k === 'anod' ? RM.mat(f.hex, f.rough, f.metal, 42, 0, 0.7)
          : RM.mat(f.hex, Math.min(f.rough, f.rough > 0.55 ? 0.62 : 0.32), f.metal, 41, 0, f.metal > 0.3 ? 0.75 : 0.12));
    }
    return mats.get(key);
  };
  const CUT = { hex: '#d9dcdf', rough: 0.1, metal: 1 }, POLISH = { hex: '#eceef0', rough: 0.04, metal: 1 }, BLACK = { hex: '#16171a', rough: 0.4, metal: 0.2 };
  function wheelOpts(base, fit) {
    const o = Object.assign({}, base);
    const wp = fit.wheel && T.part(fit.wheel);
    if (wp) {
      const f = finOf(wp.fin, fit.wheelC), M = wmat(f), st = wp.vis.style, WB = RM.WheelBuilder;
      for (const k of ['spokes', 'style', 'sw', 'split', 'bevel', 'dish', 'concave', 'spokeMat', 'rim', 'rimDark', 'edgeMat', 'sideMat', 'cap']) delete o[k];
      o.RW = Math.min(base.R - 0.062, base.RW + 0.0127 * wp.vis.upsize);   // 加大 1～2 吋，胎壁變薄
      const h = base.Wd / 2;
      const lugBlack = WB ? WB.MAT.lugBlack : MAT.rimBlack2, lugTi = WB ? WB.MAT.lugTi : MAT.nut;
      if (st === 'cast') {
        // 鑄造：五組粗雙肋、圓潤的大圓角、肋面微凸、幾乎是平的；切削雙色 = 鑽石切削肋面 + 黑色側面 / 窗口
        const two = fit.wheelC === 2;
        Object.assign(o, { spokes: 5, style: 'twin', sw: [0.0165, 0.0205], split: [0.0085, 0.0165], bevel: 0.008, dish: 0.012, concave: 0.004, section: 'round', profile: 1.15, fillet: 0.01, crown: 0.0032,
          spokeMat: two ? wmat(CUT, 'cut') : M, edgeMat: two ? wmat(BLACK) : M, sideMat: two ? wmat(BLACK) : wmat(f, 'anod'), rim: two ? wmat(CUT, 'cut') : M, cap: M, capLogo: 3 });
      } else if (st === 'flow') {
        // 旋壓：六組細雙肋一路延伸到輪緣、中度內凹、輪唇很薄；肋的圓角中等
        Object.assign(o, { spokes: 6, style: 'twin', sw: [0.0062, 0.0078], split: [0.011, 0.031], bevel: 0.004, dish: 0.006, concave: 0.018, section: 'soft', profile: 1.9, fillet: 0.004, spokeMat: M, rim: M, sideMat: wmat(f, 'anod'), capLogo: 3, lugMat: lugBlack });
      } else if (st === 'forged') {
        // 單片鍛造：六支寬平肋、銳利倒角 + 中央切削溝 + 肋上貼紙；靠輪緣才急遽翹起的深凹；鑽石切削輪緣；黑色競技螺帽
        Object.assign(o, { spokes: 6, style: 'multi', sw: [0.021, 0.038], bevel: 0.0045, dish: 0.014, concave: 0.036, section: 'sharp', profile: 2.5, fillet: 0.006,
          spokeMat: M, edgeMat: M, sideMat: wmat({ hex: darker(f.hex, 0.75), rough: f.rough + 0.1, metal: f.metal }), rim: wmat(CUT, 'cut'),
          channel: wmat({ hex: darker(f.hex, 0.6), rough: Math.min(1, f.rough + 0.15), metal: f.metal }), spokeText: 3, capLogo: 0, lugMat: lugBlack });
      } else if (st === 'mesh') {
        // 兩片式網狀：十個方向的交叉細肋 + 拋光外唇 + 一圈螺絲 + 金色徽章中心蓋
        Object.assign(o, { spokes: 10, style: 'mesh', dish: Math.min(0.03, h * 0.3), concave: 0.012, bevel: 0.003, section: 'soft', profile: 1.5, fillet: 0.002, spokeMat: M, rim: wmat(POLISH, 'cut'), bolts: { n: 30, mat: MAT.bolt }, capLogo: 1 });
      } else if (st === 'deep') {
        // 三片式深唇：鏡面拋光的階梯外唇很深、中心五肋退到後面、一圈螺絲 (金色款配鍍金螺絲)、燒鈦螺帽
        Object.assign(o, { spokes: 5, style: 'multi', sw: [0.02, 0.026], bevel: 0.007, dish: Math.min(0.07, h * 0.55), concave: 0.004, step: true, section: 'soft', profile: 1.3, fillet: 0.008,
          spokeMat: M, rim: wmat(POLISH, 'cut'), bolts: { n: 36, mat: fit.wheelC === 1 || fit.wheelC === 3 ? MAT.boltGold : MAT.bolt }, capLogo: 2, lugMat: lugTi });
      }
    }
    const tp = fit.tire && T.part(fit.tire);
    if (tp) { o.tread = tp.vis.tread; o.letters = !!tp.vis.letters; }
    const bp = fit.brake && T.part(fit.brake);
    if (bp) {
      const v = bp.vis, f = finOf('caliper', fit.brakeC);
      Object.assign(o, { pistons: v.pistons, disc: v.disc, calScale: v.size, caliper: fmat(f), logo: true, drilled: v.rotor === 'drilled', slots: v.rotor === 'float' ? 8 : v.rotor === 'drilled' ? 0 : base.slots });
      if (v.rotor === 'float') o.float = { hat: f.hex === '#111111' ? mat('#c9a13b', 0.3, 0.85) : mat('#1b1b1d', 0.35, 0.6) };
      else delete o.float;
    }
    return o;
  }

  // ------------------------------------------------------------------ 排氣尾管 (車身座標 = 以重心為原點；尾管朝 +z)
  // 繞 z 軸旋轉一條斷面 prof [[z, r, 材質?]]
  function revolveZ(mb, cx, cy, prof, M, seg) {
    const base = mb.vcount, np = prof.length;
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      for (let j = 0; j < np; j++) {
        const [z, r] = prof[j], p0 = prof[Math.max(0, j - 1)], p1 = prof[Math.min(np - 1, j + 1)];
        const dz = p1[0] - p0[0], dr = p1[1] - p0[1], l = Math.hypot(dz, dr) || 1;
        const nr = dz / l, nz = -dr / l;   // 斷面法線
        const m = prof[j][2] || (j > 0 && prof[j - 1][2]) || M;
        mb.v(cx + ca * r, cy + sa * r, z, ca * nr, sa * nr, nz, 0, 0, m);
      }
    }
    for (let k = 0; k < seg; k++) for (let j = 0; j < np - 1; j++) {
      const a = base + k * np + j, b = a + np;
      mb.i.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }
  const BURN = ['#c8a24f', '#a5693a', '#6a3d8f', '#2e4fa8'];   // 燒鈦：麥黃 → 古銅 → 紫 → 深藍 (越靠出口越藍)
  function exhaustMesh(S, ep) {
    const tips = S.exhausts || (S.exhaust ? [S.exhaust] : []);
    if (!tips.length || !ep) return null;
    const mb = new RM.MeshBuilder(), v = ep.vis, r = v.r, seg = 28;
    const raw = mat('#9ea0a2', 0.3, 1), steel = mat('#cfd2d4', 0.15, 1), inner = mat('#0a0a0a', 0.9, 0);
    const carbon = mat('#191a1c', 0.28, 0.25), burnt = BURN.map((c) => mat(c, 0.28, 1));
    for (const p of tips) {
      const x = p[0], y = p[1], z0 = p[2] - 0.07, z1 = p[2] + 0.05;
      let outer;
      if (v.tip === 'steel') {
        // 亮面不鏽鋼 + 捲邊
        outer = [[z0, r * 0.94, steel], [z1 - 0.012, r], [z1 - 0.004, r * 1.04], [z1, r * 1.0], [z1, r * 0.9, inner]];
      } else if (v.tip === 'ti') {
        // 鈦合金：靠出口那 8 cm 燒出漸層
        outer = [[z0, r * 0.95, raw], [z1 - 0.08, r, burnt[0]], [z1 - 0.055, r, burnt[1]], [z1 - 0.035, r, burnt[2]], [z1 - 0.015, r, burnt[3]], [z1, r * 1.02], [z1, r * 0.9, inner]];
      } else {
        // 碳纖維護套 + 斜切的燒鈦內唇 (用一圈燒藍內環表現)
        outer = [[z0, r * 0.98, carbon], [z1 - 0.006, r * 1.02], [z1, r * 0.98, burnt[3]], [z1 - 0.004, r * 0.86, burnt[2]], [z1 - 0.004, r * 0.82, inner]];
      }
      revolveZ(mb, x, y, outer, outer[0][2], seg);
      // 管內深色 (看進去是黑的)
      revolveZ(mb, x, y, [[z1 - 0.004, r * 0.86], [z1 - 0.12, r * 0.86], [z1 - 0.12, 0]], inner, 16);
    }
    return mb.build();
  }

  // ------------------------------------------------------------------ 彩繪貼圖
  // 版面 (2048 × 1024)：列 0～255 右側 (車頭在右)、256～511 左側 (車頭在左)、512～959 頂面 (車頭在左，上下 = 車寬)、960～1023 擋風玻璃上緣
  // 座標：側面 x 0 = 前保桿 … 1 = 後保桿、y 0 = 車門下緣 … 1 = 車頂線；頂面 x -1 = 左 … 1 = 右、y 0 = 車頭 … 1 = 車尾
  const LW = 2048, LH = 1024;
  const imgCache = new Map();
  function sticker(id, lightInk = false) {
    const D = RM.LiveryData, s = D && D.stickers[id];
    if (!s) return Promise.resolve(null);
    const key = id + (lightInk ? ':light' : ':dark');
    if (imgCache.has(key)) return imgCache.get(key);
    const p = new Promise((res) => {
      const im = new Image();
      im.onload = () => res(im); im.onerror = () => res(null);
      const art = lightInk ? s.svg.split(D.adaptiveInk).join(D.lightInk) : s.svg;
      im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(art);
    });
    imgCache.set(key, p);
    return p;
  }
  // 側面 y 的範圍 (車門下緣 → 車頂線) 換算到貼圖列 (0 = 車頂)；車款可在 build() 傳 livery: { y0, y1 } 調整 (單位：貼圖的 0～1 高度)
  function sideRows(geo) { return { top: geo.y1, bot: geo.y0 }; }
  async function buildLivery(id, geo) {
    const set = T.liveries().find((l) => l.id === id);
    if (!set) return null;
    const cv = document.createElement('canvas');
    cv.width = LW; cv.height = LH;
    const g = cv.getContext('2d');
    const sr = sideRows(geo);
    for (const it of set.items) {
      const s = RM.LiveryData.stickers[it.sticker], im = await sticker(it.sticker, geo.lightInk);
      if (!s || !im) continue;
      const asp = s.aspect || im.width / Math.max(1, im.height);
      if (it.zone === 'side') {
        // 側面：長度方向 = 車長 (x)，高度方向 = 車門下緣 → 車頂 (y)。貼紙寬 w (車長比例)，高依長寬比換算 (車長 / 車高 的像素比例不同)
        const wpx = it.w * LW, hpx = ((it.w * geo.len) / asp / geo.hgt) * 256;   // 高度：公尺 → 列 (256 列 = 整個帶狀範圍的高度)
        const rightImage = it.rightSticker ? await sticker(it.rightSticker, geo.lightInk) : im;
        for (const side of [0, 1]) {
          const cx = side === 0 ? (1 - it.x) * LW : it.x * LW;
          const cy = side * 256 + (sr.bot - (sr.bot - sr.top) * it.y) * 256;
          g.save(); g.beginPath(); g.rect(0, side * 256, LW, 256); g.clip(); g.translate(cx, cy);
          if (it.rot) g.rotate((it.rot * Math.PI) / 180 * (side === 0 ? -1 : 1));
          if (side === 1 && s.directional) g.scale(-1, 1);   // 左側：有方向的圖案鏡射 (仍然朝車頭)
          g.drawImage(side === 0 ? rightImage || im : im, -wpx / 2, -hpx / 2, wpx, hpx);
          g.restore();
        }
      } else if (it.zone === 'top') {
        // 頂面：貼圖的 x = 車長 (車頭在左)、y = 車寬 (上 = 車的右側，這樣從上往下看、車頭朝上時不會左右相反)；
        // 貼紙的「上」朝車頭 → 逆時針轉 90°
        const wm = it.w * geo.wid, hm = it.h ? it.h * geo.len : wm / asp; // Full wraps follow this model's length.
        const cx = it.y * LW, cy = 512 + ((1 - it.x) / 2) * 448;
        const pxPerM_x = LW / geo.len, pxPerM_y = 448 / geo.wid;
        g.save(); g.beginPath(); g.rect(0, 512, LW, 448); g.clip(); g.translate(cx, cy);
        g.rotate(-Math.PI / 2 + ((it.rot || 0) * Math.PI) / 180);
        // 轉了 90° 之後，貼紙的寬沿著貼圖 y (車寬)、高沿著貼圖 x (車長)
        g.drawImage(im, (-wm * pxPerM_y) / 2, (-hm * pxPerM_x) / 2, wm * pxPerM_y, hm * pxPerM_x);
        g.restore();
      } else if (it.zone === 'windshield') {
        const wpx = (it.w || 0.9) * LW;
        g.drawImage(im, (LW - wpx) / 2, 962, wpx, 60);
      }
    }
    return cv;
  }

  // ------------------------------------------------------------------ 組合 (快取)
  // get(model, spec, fit) → { wheel, caliper, exhaust, livery: { tex } | null, camber, key }；model = ProcCar 的車款 (wheelOpts)
  const cache = new Map();
  const MAX = 6;
  function dispose(v) {
    for (const k of ['wheel', 'caliper', 'exhaust']) if (v[k] && v.own[k]) RM.GLU.deleteMesh(v[k]);
    if (v.livery && v.livery.tex) RM.GLU.gl.deleteTexture(v.livery.tex);
  }
  // 車殼的投影範圍 (proc_car.js mapInfo：B = [Y0, Y1, Z0, Z1]、C[0] = XMAX)；
  // 側面貼紙的 y 0 = 車門下緣 (約在帶狀範圍由上往下 88% 處)、1 = 窗框下緣 (約 38%)，車款可用 build() 的 livery: { y0, y1 } 調整
  function geoOf(model) {
    const U = model.mapU || {}, B = U.B || [0.1, 1.4, -2.3, 2.3], C = U.C || [0.9];
    const lv = model.livery || {};
    // These cars have a factory black sill band. Keep low lettering above that
    // material mask instead of letting it disappear under the original trim.
    const trim = { ae86: [.70, .34], p911: [.76, .34] }[model.id] || [.88, .38];
    return { len: B[3] - B[2], hgt: B[1] - B[0], wid: C[0] * 2, y0: lv.y0 !== undefined ? lv.y0 : trim[0], y1: lv.y1 !== undefined ? lv.y1 : trim[1] };
  }
  function get(model, spec, fit, onReady, paintHex = '#ffffff') {
    if (!model || !fit) return null;
    const base = model.wheelOpts;
    const wkey = [fit.wheel, fit.wheelC, fit.tire, fit.brake, fit.brakeC].join('|');
    const rgb = paintHex.slice(1).match(/../g).map(c => parseInt(c, 16));
    const lightInk = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 < 115;
    const key = model.id + '#' + (model.tex && model.tex.A ? 'm' : '') + '|' + wkey + '|' + fit.exhaust + '|' + fit.livery + '|' + lightInk;
    let v = cache.get(key);
    if (v) {
      cache.delete(key);
      if (v.model === model) { cache.set(key, v); return v; }
      dispose(v);   // 同一台車換了一份模型 (車庫預覽 ↔ 比賽用)：舊的網格不要了
    }
    v = { key, model, own: {}, wheel: null, caliper: null, exhaust: null, livery: null };
    if (base && (fit.wheel || fit.tire || fit.brake)) {
      const W = PC.buildWheel(wheelOpts(base, fit));
      v.wheel = W.wheel.build(); v.caliper = W.caliper.build(); v.own.wheel = v.own.caliper = true;
    }
    if (fit.exhaust) { v.exhaust = exhaustMesh(spec, T.part(fit.exhaust)); v.own.exhaust = !!v.exhaust; }
    if (fit.livery) {
      v.livery = { tex: null };
      buildLivery(fit.livery, { ...geoOf(model), lightInk }).then((cv) => {
        if (!cv || cache.get(key) !== v) return;   // 這期間已經被換掉 / 清掉
        v.livery.tex = RM.GLU.texture(cv, { clamp: true, aniso: 8 });
        v.livery.canvas = cv;
        if (onReady) onReady();
      });
    }
    cache.set(key, v);
    while (cache.size > MAX) { const k0 = cache.keys().next().value; dispose(cache.get(k0)); cache.delete(k0); }
    return v;
  }

  RM.TuningVis = { get, wheelOpts, buildLivery, geoOf, sticker };
})();
