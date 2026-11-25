'use strict';
// 熱浪夏威夷的場景主題：夏威夷夕陽海灘。
// 這裡只管外觀 —— 路形、路面、碰撞、物理都在 drift_track.js / road.js / vehicle.js，這個檔完全不碰：
//   天空：renderer.js 的 ENV.miami，太陽壓在東南方約 7° 的海平線上；長陡坡、斷崖、終點直線都正對著夕陽
//   地形：整張圖是一座島。終點直線的左手邊 (東北) 是一長條沙灘與大海，地圖外緣也都沉進海裡
//   海：岸邊碧綠色的淺灘與浪花 (shaders.js 的 water：頂點的 aUV.x = 淺水程度)
//   景物：棕櫚樹、粉彩色的裝飾藝術 (Art Deco) 旅館與霓虹、海景公寓、救生員小屋、陽傘、路燈、帆船、海對岸的天際線
// 景物全部合進 drift_track.js 的同一個靜態網格 (stage)；海是另外的網格 (main.js 的 f.water)。
(function () {
  const RM = window.RM;
  const { clamp, lerp, smoothstep } = RM;
  const lin = (h) => RM.srgb(h);
  const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

  // 地面顏色 (線性色彩)
  const GROUND = {
    sand: lin('#ecd6a6'), sand2: lin('#e0c28d'), wet: lin('#b39667'),
    grassA: lin('#2f6527'), grassB: lin('#3f7a30'), grassC: lin('#55893b'), lawn: lin('#4a8a3a'),
    rock: lin('#9a8466'), gorge: lin('#7b6650'),
    lot: lin('#b5a995'), street: lin('#57524f'),
  };
  const PASTEL = ['#f7a8c4', '#a9e8d2', '#93dbe4', '#f8e5a0', '#f9c9a5', '#cfbaf3', '#f4efe4', '#ffb3a7'];
  const NEON = ['#ff3cb6', '#36f0ff', '#b35cff', '#ffe04a', '#5cff9d'];
  const BRIGHT = ['#ff6fa8', '#ffd447', '#3fd1c3', '#ff8a3d', '#7f6bff', '#ffffff'];

  function materials() {
    const m = (hex, r = .8, metal = 0, e = 0, mode = 0) => RM.mat(hex, r, metal, mode, e);
    const pick = (list) => (rnd) => list[Math.floor(rnd() * list.length)];
    const pastel = PASTEL.map((c) => m(c, .86, 0, 0, 22)), neon = NEON.map((c) => m(c, .35, 0, 2.4));
    const bright = BRIGHT.map((c) => m(c, .7, 0, 0, 30));
    return {
      pastel: pick(pastel), neon: pick(neon), bright: pick(bright),
      white: m('#f6f2e8', .82, 0, 0, 22), glass: m('#264a5c', .16, .25, 0, 31), deck: m('#c9b48f', .9, 0, 0, 28),
      condo: m('#eef0ec', .7, 0, 0, 22), condoGlass: m('#3f6f8f', .12, .3, 0, 31), tower: m('#2b4760', .2, .35, 0, 31),
      towerLit: m('#ffc271', .5, 0, .9), slab: m('#dfe3e1', .8, 0, 0, 22),
      trunkA: m('#8b7a62', .95, 0, 0, 26), trunkB: m('#94816a', .95, 0, 0, 26), crown: m('#6d6a3a', .9, 0, 0, 26),
      leafA: m('#3c7a2d', .75, 0, 0, 27), leafB: m('#579238', .75, 0, 0, 27), nut: m('#6b4a22', .7, 0, 0, 28),
      pole: m('#3b4047', .6, .4, 0, 29), lampGlow: m('#ffd9a0', .4, 0, 3.0),
      hull: m('#f8f6f0', .5, 0, 0, 20), sail: m('#fbf7ee', .9, 0, .15, 30), mast: m('#c9c2b4', .5, .3, 0, 29),
      islet: m('#d8c39a', .95, 0, 0, 25), aviation: m('#ff2a2a', .4, 0, 4.0),
    };
  }

  // ---------------------------------------------------------------- 單棵棕櫚樹
  // 微彎的分節樹幹 + 8～10 片往外拱再下垂的羽狀葉 (V 形斷面) + 椰子
  function palm(stage, x, y, z, h, rnd, mt) {
    const la = rnd() * Math.PI * 2, lean = .4 + rnd() * 1.8;
    const lx = Math.cos(la) * lean, lz = Math.sin(la) * lean;
    const segs = 5;
    let prev = [x, y - .4, z];
    for (let k = 1; k <= segs; k++) {
      const t = k / segs;
      const p = [x + lx * t * t, y + h * t, z + lz * t * t];
      stage.cyl(prev, p, lerp(.36, .2, (k - 1) / segs), lerp(.36, .2, t), 6, k % 2 ? mt.trunkA : mt.trunkB, false);
      prev = p;
    }
    const top = prev, fronds = 8 + Math.floor(rnd() * 3);
    stage.cyl([top[0], top[1] - .5, top[2]], [top[0], top[1] + .3, top[2]], .45, .12, 6, mt.crown, true);
    for (let f = 0; f < fronds; f++) {
      const a = (f / fronds) * Math.PI * 2 + rnd() * .5;
      const dx = Math.cos(a), dz = Math.sin(a), sx = -dz, sz = dx;
      const L = 3.6 + rnd() * 1.8, rise = .4 + rnd() * 1.0, droop = 1.5 + rnd() * 1.7;
      const leaf = rnd() < .5 ? mt.leafA : mt.leafB;
      let p0 = top, w0 = .1;
      for (let s = 1; s <= 4; s++) {
        const u = s / 4;
        const p1 = [top[0] + dx * L * u, top[1] + rise * Math.sin(u * 1.9) - droop * u * u, top[2] + dz * L * u];
        const w1 = s === 4 ? 0 : .95 * Math.pow(Math.sin(Math.PI * u), .7);
        const e0 = w0 * .45, e1 = w1 * .45;   // 葉緣比葉軸低：V 形斷面
        const L0 = [p0[0] + sx * w0, p0[1] - e0, p0[2] + sz * w0], R0 = [p0[0] - sx * w0, p0[1] - e0, p0[2] - sz * w0];
        const L1 = [p1[0] + sx * w1, p1[1] - e1, p1[2] + sz * w1], R1 = [p1[0] - sx * w1, p1[1] - e1, p1[2] - sz * w1];
        stage.quad(p0, p1, L1, L0, leaf, [(s - 1) / 4, 0, u, 1]);
        stage.quad(R0, R1, p1, p0, leaf, [(s - 1) / 4, 1, u, 0]);
        p0 = p1; w0 = w1;
      }
    }
    for (let k = 0; k < 3; k++) {
      const a = rnd() * 6.28;
      stage.box(top[0] + Math.cos(a) * .32, top[1] - .5, top[2] + Math.sin(a) * .32, .3, .3, .3, a, mt.nut);
    }
  }

  // ---------------------------------------------------------------- 建築
  // (x, z) 中心、(fx, fz) 正面朝向 (單位向量，通常朝著道路)、w 寬、d 深。ground(x, z) = 地面高度
  function frame(x, z, fx, fz) {
    const sx = fz, sz = -fx, yaw = Math.atan2(fx, fz);
    return { yaw, P: (u, t) => [x + sx * u + fx * t, z + sz * u + fz * t] };
  }
  function footprintFloor(F, w, d, ground) {
    let floor = Infinity;
    for (const [u, t] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, 0]]) {
      const p = F.P(u, t); floor = Math.min(floor, ground(p[0], p[1]));
    }
    return floor;
  }

  // 裝飾藝術旅館：粉彩外牆、整圈的遮陽簷 (eyebrow) 與橫向長窗、正面中央的垂直鰭片、圓角塔、霓虹燈條
  function hotel(stage, x, z, fx, fz, w, d, floors, rnd, ground, mt) {
    const F = frame(x, z, fx, fz), floor = footprintFloor(F, w, d, ground);
    const box = (u, v, t, bw, bh, bd, M) => { const p = F.P(u, t); stage.box(p[0], v, p[1], bw, bh, bd, F.yaw, M); };
    const story = 3.3, H = 1.4 + floors * story, top = floor + H;
    const body = mt.pastel(rnd), neon = mt.neon(rnd);
    box(0, floor - 1 + (H + 1) / 2, 0, w, H + 1, d, body);          // 主體 (往地下多埋 1 m：坡地也不會懸空)
    box(0, floor + .5, 0, w + .5, 1, d + .5, mt.white);             // 基座
    for (let k = 0; k < floors; k++) {
      const y0 = floor + 1.4 + k * story;
      box(0, y0 + 1.05, 0, w + .06, 1.3, d + .06, mt.glass);        // 橫向長窗
      box(0, y0 + 2.0, 0, w + .9, .18, d + .9, mt.white);           // 遮陽簷
    }
    box(0, top + .6, 0, w + .3, 1.2, d + .3, mt.white);             // 女兒牆
    box(0, top + 1.9, -d * .1, w * .55, 1.6, d * .5, body);          // 階梯狀屋頂
    const finH = H + 5 + rnd() * 5;                                  // 正面中央的鰭片 + 直立霓虹
    box(0, floor + finH / 2, d / 2 + .5, 1.7, finH, 1.2, mt.white);
    box(0, floor + 1.5 + (finH - 2) / 2, d / 2 + 1.16, .32, finH - 2, .14, neon);
    box(0, top + 1.25, d / 2 + .2, w + .32, .2, .16, neon);         // 屋頂前緣的霓虹燈條
    box(0, floor + 3.0, d / 2 + .9, w * .5, .16, 1.8, mt.bright(rnd));   // 一樓遮雨棚
    if (rnd() < .7) {                                                // 圓角塔
      const c = F.P((rnd() < .5 ? -1 : 1) * w / 2, d / 2);
      stage.cyl([c[0], floor - 1, c[1]], [c[0], top + 2.4, c[1]], 2.5, 2.5, 12, rnd() < .5 ? mt.white : mt.pastel(rnd), true);
      stage.cyl([c[0], top + 2.4, c[1]], [c[0], top + 2.7, c[1]], 2.75, 2.75, 12, neon, true);
    }
    return top;
  }

  // 海景公寓：白色高樓、每層一圈陽台、藍色玻璃；有些頂上一圈霓虹
  function condo(stage, x, z, fx, fz, w, d, floors, rnd, ground, mt) {
    const F = frame(x, z, fx, fz), floor = footprintFloor(F, w, d, ground);
    const box = (u, v, t, bw, bh, bd, M) => { const p = F.P(u, t); stage.box(p[0], v, p[1], bw, bh, bd, F.yaw, M); };
    const story = 3.1, H = 3 + floors * story, top = floor + H;
    box(0, floor - 1 + (H + 1) / 2, 0, w, H + 1, d, mt.condo);
    for (let k = 1; k < floors; k++) {
      const y0 = floor + 3 + k * story;
      box(0, y0 - 1.4, 0, w + .08, 2.2, d + .08, mt.condoGlass);
      box(0, y0 - .1, 0, w + 1.8, .22, d + 1.8, mt.slab);
    }
    box(0, top + 1.5, 0, w * .7, 3, d * .7, mt.condo);
    if (rnd() < .6) box(0, top + 3.1, 0, w * .7 + .3, .35, d * .7 + .3, mt.neon(rnd));
    return top;
  }

  // 內陸的低樓層街區：粉彩色的二～四層樓、橫向長窗、屋頂女兒牆
  function lowrise(stage, x, z, fx, fz, w, d, floors, rnd, ground, mt) {
    const F = frame(x, z, fx, fz), floor = footprintFloor(F, w, d, ground);
    const box = (u, v, t, bw, bh, bd, M) => { const p = F.P(u, t); stage.box(p[0], v, p[1], bw, bh, bd, F.yaw, M); };
    const H = 1 + floors * 3.2;
    box(0, floor - 1 + (H + 1) / 2, 0, w, H + 1, d, mt.pastel(rnd));
    box(0, floor + H + .4, 0, w + .25, .8, d + .25, mt.white);
    for (let k = 0; k < Math.min(floors, 3); k++) box(0, floor + 1.9 + k * 3.2, 0, w + .05, 1.2, d + .05, mt.glass);
  }

  // 海對岸的天際線：一座低平的小島，上面一排玻璃高樓 (遠景剪影，傍晚有幾層樓亮燈)
  function skyline(stage, cx, cz, tx, tz, sea, rnd, mt) {
    const yaw = Math.atan2(tx, tz);
    stage.box(cx, sea - 2, cz, 260, 6.5, 640, yaw, mt.islet);
    for (let k = 0; k < 16; k++) {
      const along = (k / 15 - .5) * 560 + (rnd() - .5) * 20, across = (rnd() - .5) * 140;
      const x = cx + tx * along - tz * across, z = cz + tz * along + tx * across;
      const w = 20 + rnd() * 16, d = 18 + rnd() * 14, h = 55 + Math.pow(rnd(), 1.5) * 130;
      const y0 = sea + 1.2;
      stage.box(x, y0 + h / 2, z, w, h, d, yaw, mt.tower);
      for (let y = y0 + 8; y < y0 + h - 4; y += 12) stage.box(x, y, z, w + .3, .6, d + .3, yaw, mt.slab);
      for (let y = y0 + 4 + Math.floor(rnd() * 3) * 12; y < y0 + h - 8; y += 12 * (2 + Math.floor(rnd() * 3))) stage.box(x, y, z, w + .2, 1.6, d + .2, yaw, mt.towerLit);
      if (rnd() < .4) {
        stage.cyl([x, y0 + h, z], [x, y0 + h + 14 + rnd() * 16, z], 1.6, .2, 6, mt.slab, false);
        stage.box(x, y0 + h + 2, z, 1.2, 1.2, 1.2, 0, mt.aviation);
      }
    }
  }

  // 救生員小屋：高腳、彩色小屋、四角錐屋頂、斜坡 (正面 fx, fz 朝向海)
  function lifeguard(stage, x, y, z, fx, fz, rnd, mt) {
    const F = frame(x, z, fx, fz);
    const box = (u, v, t, bw, bh, bd, M) => { const p = F.P(u, t); stage.box(p[0], v, p[1], bw, bh, bd, F.yaw, M); };
    for (const [u, t] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) box(u, y + .7, t, .18, 2.8, .18, mt.white);
    box(0, y + 2.15, 0, 3.4, .2, 3.6, mt.deck);
    box(0, y + 2.95, -.1, 2.5, 1.4, 2.3, mt.bright(rnd));
    box(0, y + 4.0, -.1, 2.52, .7, 2.32, mt.bright(rnd));
    box(0, y + 3.35, 1.06, 1.7, .62, .06, mt.glass);
    stage.cyl([x, y + 4.35, z], [x, y + 5.4, z], 2.15, 0, 4, mt.bright(rnd), true);
    const a = F.P(0, -1.8), b = F.P(0, -5.6), M = mt.deck;
    const o = [(a[0] + b[0]) / 2, y + 1.1, (a[1] + b[1]) / 2];
    stage.boxAxes(o, [fz * .55, 0, -fx * .55], [0, .08, 0], [(a[0] - b[0]) / 2, 1.05, (a[1] - b[1]) / 2], M);
  }

  function umbrella(stage, x, y, z, rnd, mt) {
    stage.cyl([x, y - .3, z], [x, y + 2.3, z], .04, .04, 5, mt.white, false);
    stage.cyl([x, y + 1.85, z], [x, y + 2.45, z], 1.35, .05, 8, mt.bright(rnd), false);
    const a = rnd() * 6.28, c = Math.cos(a), s = Math.sin(a), ox = x + c * 1.6, oz = z + s * 1.6;
    const P = (u, t) => [ox + c * t - s * u, y + .05, oz + s * t + c * u];
    stage.quad(P(-.45, -.9), P(.45, -.9), P(.45, .9), P(-.45, .9), mt.bright(rnd));
  }

  // 路燈：細桿 + 伸向路面的燈臂 + 暖色燈 (常亮)；(fx, fz) = 朝向路面
  function lamp(stage, x, y, z, fx, fz, mt) {
    const yaw = Math.atan2(fx, fz);
    stage.box(x, y + 3.2, z, .2, 6.8, .2, yaw, mt.pole);
    stage.box(x + fx * .8, y + 6.5, z + fz * .8, .14, .14, 1.8, yaw, mt.pole);
    stage.box(x + fx * 1.6, y + 6.35, z + fz * 1.6, .45, .2, .7, yaw, mt.lampGlow);
  }

  function sailboat(stage, x, z, sea, rnd, mt) {
    const a = rnd() * 6.28, fx = Math.sin(a), fz = Math.cos(a), yaw = a, L = 7 + rnd() * 4, H = L * 1.35;
    stage.box(x, sea + .3, z, 2.1, 1.0, L, yaw, mt.hull);
    stage.cyl([x, sea + .8, z], [x, sea + H, z], .09, .06, 5, mt.mast, false);
    const at = (t, y) => [x + fx * t, sea + y, z + fz * t];
    stage.quad(at(.1, 1.3), at(-L * .42, 1.3), at(.1, H - .3), at(.1, H - .3), mt.sail);
    stage.quad(at(.25, H * .8), at(L * .45, 1.1), at(.25, 1.1), at(.25, 1.1), mt.sail);
  }

  const Theme = {
    env: 'miami',

    // track: { points, spacing, finish }；回傳自己 (之後的函式都要用到海平面與海岸線)
    setup(track) {
      const { points, spacing } = track;
      const n = points.length / 3;
      let ymin = Infinity;
      for (let i = 0; i < n; i++) ymin = Math.min(ymin, points[i * 3 + 1]);
      this.sea = ymin - 6;   // 終點直線離海平面約 6 m
      // 海岸線：與終點直線平行，在它的左手邊 (道路右向量的反方向)，離所有路段至少 58 m
      const iF = Math.min(n - 1, Math.round(track.finish / spacing)), a = Math.max(0, iF - 40), b = Math.min(n - 1, iF + 40);
      let tx = points[b * 3] - points[a * 3], tz = points[b * 3 + 2] - points[a * 3 + 2];
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const nx = tz, nz = -tx, px = points[iF * 3], pz = points[iF * 3 + 2];
      let reach = -Infinity;
      for (let i = 0; i < n; i++) reach = Math.max(reach, (points[i * 3] - px) * nx + (points[i * 3 + 2] - pz) * nz);
      this.coast = { x: px + nx * (reach + 58), z: pz + nz * (reach + 58), nx, nz, tx, tz };
      this.finishPoint = [px, points[iF * 3 + 1], pz];
      // 內陸街區的棋盤格 (沿海岸 t、離海岸 d 的座標)：每格中心放建築，格線是街道 (地面顏色畫出來)
      const tFin = this.coastAlong(px, pz);
      this.city = { t0: tFin - 2300, t1: tFin + 500, pt: 54, d0: -150, d1: -1900, pd: 46 };
      return this;
    },
    // 到海岸線的距離 (正 = 海那一側)、沿海岸的座標
    coastDist(x, z) { const c = this.coast; return (x - c.x) * c.nx + (z - c.z) * c.nz; },
    coastAlong(x, z) { const c = this.coast; return (x - c.x) * c.tx + (z - c.z) * c.tz; },
    coastPoint(t, d) { const c = this.coast; return [c.x + c.tx * t + c.nx * d, c.z + c.tz * t + c.nz * d]; },

    // 地圖範圍 (地面網格的外框)：外緣一圈沉進海裡
    bounds(x0, z0, x1, z1) { this.box = { x0, z0, x1, z1 }; },

    // 沒有道路時的地形：內陸緩緩升高 (外加起伏) → 沙灘 → 海床。海岸線上 (coastDist = 0) 剛好是海平面
    natural(x, z) {
      const sea = this.sea, sd = this.coastDist(x, z);
      if (sd > -20) return sd < 12 ? sea - sd * .05 : sea - .6 - Math.min(13, (sd - 12) * .04);
      const inland = -sd - 20;
      return sea + 1 + Math.min(inland, 90) * .018 + Math.max(0, inland - 90) * .008
        + (RM.fbm(x * .0045, z * .0045, 3, 11) - .5) * 10 * smoothstep(80, 320, inland);
    },
    // 島的外緣：離地圖邊框 170 m 內漸漸沉到海平面下 10 m (邊緣加一點雜訊，海岸線才不會是直的)
    island(x, z, h) {
      const b = this.box;
      const e = Math.min(x - b.x0, b.x1 - x, z - b.z0, b.z1 - z) + (RM.fbm(x * .004, z * .004, 3, 5) - .5) * 140;
      return lerp(this.sea - 10, h, smoothstep(0, 170, e));
    },

    // 街區的範圍：平地、離路 42 m 以上、不在島的外緣 (建築的擺放與地面的街道顏色共用)
    cityZone(x, z, h, near) {
      const C = this.city, b = this.box, sd = this.coastDist(x, z), t = this.coastAlong(x, z);
      if (sd > C.d0 + C.pd / 2 || sd < C.d1 || t < C.t0 - C.pt / 2 || t > C.t1) return false;
      if (x < b.x0 + 200 || x > b.x1 - 200 || z < b.z0 + 200 || z > b.z1 - 200) return false;
      return h > this.sea + 1.2 && h < this.sea + 26 && near > 42;
    },
    // 離最近街道中心線的距離 (公尺)
    streetDist(x, z) {
      const C = this.city, t = this.coastAlong(x, z), d = this.coastDist(x, z);
      const ft = ((((t - C.t0) / C.pt) % 1) + 1) % 1, fd = ((((d - C.d0) / C.pd) % 1) + 1) % 1;
      return Math.min(Math.abs(ft - .5) * C.pt, Math.abs(fd - .5) * C.pd);
    },

    // 地面頂點的材質：草地 (深淺不一)、陡坡露出土石、溪谷、街區 (鋪面 + 街道 + 零星公園)、沙灘、濕沙
    groundMaterial(x, z, h, ny, ravine, near) {
      const sea = this.sea, sd = this.coastDist(x, z);
      const n1 = RM.vnoise(x * .05, z * .05, 3), n2 = RM.vnoise(x * .012, z * .012, 5);
      let c = mix3(mix3(GROUND.grassA, GROUND.grassC, n2), GROUND.grassB, n1 * .5);
      let paved = 0;
      if (ny > .965 && this.cityZone(x, z, h, near)) {
        const lot = smoothstep(.35, .55, RM.vnoise(x * .02, z * .02, 9)) * .85;
        const street = 1 - smoothstep(4, 7, this.streetDist(x, z));
        c = mix3(c, GROUND.lot, lot);
        c = mix3(c, GROUND.street, street);
        paved = Math.max(lot, street);
      }
      c = mix3(c, GROUND.rock, smoothstep(.86, .7, ny));
      if (ravine) c = GROUND.gorge;
      const beach = Math.max(smoothstep(-100, -70, sd) * smoothstep(sea + 5.2, sea + 3.6, h), smoothstep(sea + 2.6, sea + 1.3, h));
      c = mix3(c, mix3(GROUND.sand, GROUND.sand2, n1 * .6), beach);
      c = mix3(c, GROUND.wet, smoothstep(sea + .9, sea + .15, h));
      return { c, r: .94, m: 0, mode: 32, e: 0, night: 0,
        uv: [beach, ravine ? 1 : lerp(smoothstep(.9, .72, ny), -1, paved)] };
    },

    // 海：地圖範圍內是 16 m 的格子 (頂點帶淺水程度)，外圍四塊大平面延伸到 9 km 外
    water(g) {
      const sea = this.sea, step = 16;
      const nx = Math.ceil((g.x1 - g.x0) / step) + 1, nz = Math.ceil((g.z1 - g.z0) / step) + 1;
      const gx1 = g.x0 + (nx - 1) * step, gz1 = g.z0 + (nz - 1) * step;
      const pos = [], uv = [], idx = [], id = new Int32Array(nx * nz).fill(-1), depth = new Float32Array(nx * nz);
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) depth[j * nx + i] = sea - g.sample(g.x0 + i * step, g.z0 + j * step);
      const vert = (i, j) => {
        const k = j * nx + i;
        if (id[k] < 0) {
          id[k] = pos.length / 3;
          pos.push(g.x0 + i * step, sea, g.z0 + j * step);
          uv.push(1 - smoothstep(0, 5, depth[k]), 0);   // 水深 0 → 1 (浪花)、5 m 以上 → 0
        }
        return id[k];
      };
      for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
        // 四個角都在陸地上 1.5 m 以上的格子整格省略 (看不到)
        if (Math.max(depth[j * nx + i], depth[j * nx + i + 1], depth[(j + 1) * nx + i], depth[(j + 1) * nx + i + 1]) < -1.5) continue;
        const a = vert(i, j), b = vert(i + 1, j), c = vert(i + 1, j + 1), d = vert(i, j + 1);
        idx.push(a, b, c, a, c, d);
      }
      const R = 9000, X0 = g.x0 - R, X1 = gx1 + R, Z0 = g.z0 - R, Z1 = gz1 + R;
      for (const [ax, az, bx, bz] of [[X0, Z0, X1, g.z0], [X0, gz1, X1, Z1], [X0, g.z0, g.x0, gz1], [gx1, g.z0, X1, gz1]]) {
        const o = pos.length / 3;
        pos.push(ax, sea, az, bx, sea, az, bx, sea, bz, ax, sea, bz);
        uv.push(0, 0, 0, 0, 0, 0, 0, 0);
        idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
      }
      const index = pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
      return [RM.GLU.mesh({ aPos: new Float32Array(pos), aUV: new Float32Array(uv) }, index)];
    },

    // 所有景物。info：{ cliff, finish, humpStart, townStart, townEnd }
    decorate(stage, road, g, info) {
      const rnd = RM.rng(1985), mt = materials(), sea = this.sea, stats = { palms: 0, hotels: 0, condos: 0, lamps: 0, beach: 0 };
      // 道路的空間索引：查詢某點離最近一段路的護牆有多遠 (超過 48 m 回傳 Infinity)
      const cell = 24, grid = new Map(), key = (a, b) => a * 65536 + b;
      for (let i = 0; i < road.N; i += 2) {
        const k = key(Math.floor(road.px[i] / cell), Math.floor(road.pz[i] / cell));
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
      const roadGap = (x, z) => {
        let best = Infinity;
        const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
        for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
          const l = grid.get(key(cx + a, cz + b));
          if (!l) continue;
          for (const i of l) {
            const d = Math.hypot(road.px[i] - x, road.pz[i] - z) - Math.max(road.wall[0][i], road.wall[1][i]);
            if (d < best) best = d;
          }
        }
        return best;
      };
      const taken = [];   // 已經放了東西的圓 [x, z, 半徑]
      const free = (x, z, r) => taken.every(([a, b, q]) => Math.hypot(a - x, b - z) > q + r);
      const ground = (x, z) => g.sample(x, z);
      const cliffMid = (info.cliff.start + info.cliff.end) / 2;
      const nearCliff = (s) => Math.abs(s - cliffMid) < 90;
      // 某里程、某側 (+1 = 道路右側) 離中心線 off 公尺的點
      const side = (s, sgn, off) => { const f = road.frameAt(s, {}); return [f.x + f.rx * off * sgn, f.z + f.rz * off * sgn, f]; };
      const landSide = (s) => { const [ax, az] = side(s, 1, 30), [bx, bz] = side(s, -1, 30); return this.coastDist(ax, az) < this.coastDist(bx, bz) ? 1 : -1; };
      const addPalm = (x, z, h) => {
        const y = ground(x, z);
        if (y < sea + .7 || !free(x, z, 1.6)) return false;
        palm(stage, x, y, z, h, rnd, mt);
        taken.push([x, z, 1.2]);
        stats.palms++;
        return true;
      };

      // ---- 1. 建築 (先放，棕櫚樹再避開)
      const town = [info.townStart + 20, info.townEnd + 40], strip = [info.humpStart - 60, info.finish + 150];
      // 建築的四個角 (含屋簷外伸 1 m) 與中心都要離每一段路的護牆 gap 公尺以上：城鎮的 S 彎會從建築背後繞回來
      const fits = (x, z, fx, fz, w, d, gap) => {
        const F = frame(x, z, fx, fz);
        for (const [u, t] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 1], [0, -1], [0, 0]]) {
          const p = F.P(u * (w / 2 + 1), t * (d / 2 + 1));
          if (roadGap(p[0], p[1]) < gap) return false;
        }
        return true;
      };
      const placeHotel = (s, sgn, setback) => {
        const w = 15 + rnd() * 9, d = 12 + rnd() * 6, floors = 3 + Math.floor(rnd() * 5);
        const f = road.frameAt(s, {}), off = setback + d / 2;
        const x = f.x + f.rx * off * sgn, z = f.z + f.rz * off * sgn, r = Math.hypot(w, d) / 2 + 2;
        const fx = -f.rx * sgn, fz = -f.rz * sgn;
        if (!fits(x, z, fx, fz, w, d, 5) || !free(x, z, r) || ground(x, z) < sea + 1) return;
        hotel(stage, x, z, fx, fz, w, d, floors, rnd, ground, mt);
        taken.push([x, z, r]);
        stats.hotels++;
      };
      for (let s = town[0]; s < town[1]; s += 30 + rnd() * 10) for (const sgn of [-1, 1]) placeHotel(s, sgn, 22 + rnd() * 8);
      for (let s = strip[0]; s < strip[1]; s += 28 + rnd() * 8) placeHotel(s, landSide(s), 21 + rnd() * 5);
      // 海景公寓：終點直線後排，以及沿著海岸往北一整排 (長陡坡左手邊遠方看得到)
      const placeCondo = (x, z, fx, fz) => {
        const w = 18 + rnd() * 10, d = 14 + rnd() * 8, r = Math.hypot(w, d) / 2 + 3;
        if (!fits(x, z, fx, fz, w, d, 8) || !free(x, z, r) || ground(x, z) < sea + 1) return;
        condo(stage, x, z, fx, fz, w, d, 12 + Math.floor(rnd() * 15), rnd, ground, mt);
        taken.push([x, z, r]);
        stats.condos++;
      };
      for (let s = strip[0]; s < strip[1] + 40; s += 46 + rnd() * 16) {
        const sgn = landSide(s), f = road.frameAt(s, {}), off = 70 + rnd() * 40;
        placeCondo(f.x + f.rx * off * sgn, f.z + f.rz * off * sgn, -f.rx * sgn, -f.rz * sgn);
      }
      const tFin = this.coastAlong(this.finishPoint[0], this.finishPoint[2]);
      for (let t = tFin - 520; t > tFin - 2000; t -= 55 + rnd() * 30) {
        const [x, z] = this.coastPoint(t, -(85 + rnd() * 50));
        placeCondo(x, z, this.coast.nx, this.coast.nz);
      }
      // 內陸平地的街區：棋盤格跟海岸平行 (邁阿密的街道與海灘平行)，避開道路、路堤、山坡與島的外緣。
      // 每格兩棟低樓層，偶爾一棟裝飾藝術旅館或高樓；街角種棕櫚樹
      const C = this.city;
      const lowAt = (x, z) => {
        const y = ground(x, z);
        if (Math.abs(ground(x + 10, z) - y) + Math.abs(ground(x, z + 10) - y) > 2.2) return false;
        return this.cityZone(x, z, y, g.near(x, z));
      };
      for (let t = C.t0; t < C.t1; t += C.pt) for (let d = C.d0; d > C.d1; d -= C.pd) {
        const [cx, cz] = this.coastPoint(t, d);
        if (!lowAt(cx, cz)) continue;
        const roll = rnd();
        if (roll < .1) {
          const tall = roll < .04, w = tall ? 20 + rnd() * 8 : 30 + rnd() * 10, dd = tall ? 16 + rnd() * 6 : 14 + rnd() * 6;
          const fx = this.coast.nx, fz = this.coast.nz;
          if (fits(cx, cz, fx, fz, w, dd, 6) && free(cx, cz, Math.hypot(w, dd) / 2)) {
            if (tall) condo(stage, cx, cz, fx, fz, w, dd, 10 + Math.floor(rnd() * 12), rnd, ground, mt);
            else hotel(stage, cx, cz, fx, fz, w, dd, 3 + Math.floor(rnd() * 4), rnd, ground, mt);
            taken.push([cx, cz, Math.hypot(w, dd) / 2]);
            stats[tall ? 'condos' : 'hotels']++;
          }
        } else {
          for (const half of [-1, 1]) {
            if (rnd() < .15) continue;   // 空地 / 停車場
            const w = 15 + rnd() * 8, dd = 14 + rnd() * 12;
            const [x, z] = this.coastPoint(t + half * 13 + (rnd() - .5) * 2, d + (rnd() - .5) * 4);
            if (!lowAt(x, z) || !fits(x, z, this.coast.tx, this.coast.tz, w, dd, 6) || !free(x, z, Math.hypot(w, dd) / 2)) continue;
            lowrise(stage, x, z, this.coast.tx, this.coast.tz, w, dd, 2 + Math.floor(rnd() * rnd() * 4), rnd, ground, mt);
            taken.push([x, z, Math.hypot(w, dd) / 2]);
            stats.lowrise = (stats.lowrise || 0) + 1;
          }
        }
        if (rnd() < .45) { const [px, pz] = this.coastPoint(t + C.pt / 2 - 3, d + C.pd / 2 - 3); if (lowAt(px, pz)) addPalm(px, pz, 8 + rnd() * 6); }
      }

      // ---- 2. 沙灘：救生員小屋、陽傘、棕櫚樹 (沿海岸，道路與海之間)
      for (let t = tFin - 2000; t < tFin + 260; t += 9 + rnd() * 10) {
        const d = -(16 + rnd() * 20), [x, z] = this.coastPoint(t, d), y = ground(x, z);
        if (y < sea + .3 || y > sea + 3 || roadGap(x, z) < 4 || !free(x, z, 2.5)) continue;
        const roll = rnd();
        if (roll < .12) {
          const [lx, lz] = this.coastPoint(t, -11), ly = ground(lx, lz);
          if (ly > sea + .2 && free(lx, lz, 4)) { lifeguard(stage, lx, ly, lz, this.coast.nx, this.coast.nz, rnd, mt); taken.push([lx, lz, 4]); stats.beach++; }
        } else if (roll < .55) { umbrella(stage, x, y, z, rnd, mt); taken.push([x, z, 1.6]); stats.beach++; }
        else if (roll < .8) addPalm(x, z, 8 + rnd() * 6);
      }

      // ---- 3. 路邊的棕櫚樹與路燈：城鎮與海濱大道每 20 幾公尺一棵，其他路段疏一點
      for (let s = 30; s < road.length - 10; ) {
        const boulevard = (s > town[0] && s < town[1]) || s > strip[0];
        const f = road.frameAt(s, {});
        if (!road.bridge[f.i] && !nearCliff(s)) {
          for (const sgn of [-1, 1]) {
            if (!boulevard && rnd() < .35) continue;
            const off = road.wall[sgn > 0 ? 1 : 0][f.i] + 3 + rnd() * 2.5;
            const x = f.x + f.rx * off * sgn, z = f.z + f.rz * off * sgn;
            if (roadGap(x, z) < 1.5 || ground(x, z) < f.y - 12) continue;
            addPalm(x, z, 9 + rnd() * 5);
          }
        }
        s += boulevard ? 20 + rnd() * 8 : 38 + rnd() * 20;
      }
      for (let s = strip[0]; s < road.length - 20; s += 38) {
        const f = road.frameAt(s, {});
        if (road.bridge[f.i]) continue;
        for (const sgn of [-1, 1]) {
          const off = road.wall[sgn > 0 ? 1 : 0][f.i] + 1.1, x = f.x + f.rx * off * sgn, z = f.z + f.rz * off * sgn;
          if (roadGap(x, z) < .5 || !free(x, z, .8)) continue;
          lamp(stage, x, Math.max(ground(x, z), f.y - .4), z, -f.rx * sgn, -f.rz * sgn, mt);
          stats.lamps++;
        }
      }

      // ---- 4. 其他地方零星的棕櫚樹 (離路 25～220 m、地面不太陡)
      for (let k = 0, tries = 0; k < 170 && tries < 3000; tries++) {
        const x = lerp(g.x0 + 150, g.x1 - 150, rnd()), z = lerp(g.z0 + 150, g.z1 - 150, rnd());
        const near = g.near(x, z);
        if (near < 25 || near > 220 || roadGap(x, z) < 6) continue;
        const y = ground(x, z), slope = Math.abs(ground(x + 4, z) - y) + Math.abs(ground(x, z + 4) - y);
        if (slope > 2.2) continue;
        // 成群：一次種 1～3 棵
        const n = 1 + Math.floor(rnd() * 3);
        for (let q = 0; q < n; q++) if (addPalm(x + (rnd() - .5) * 12, z + (rnd() - .5) * 12, 8 + rnd() * 7)) k++;
      }

      // ---- 5. 海上的帆船、海對岸的天際線
      for (let k = 0; k < 12; k++) {
        const [x, z] = this.coastPoint(tFin - 1600 + rnd() * 2200, 140 + rnd() * 1200);
        sailboat(stage, x, z, sea, rnd, mt);
      }
      const az = 168 * Math.PI / 180, sx = Math.sin(az), sz = -Math.cos(az);
      skyline(stage, this.finishPoint[0] + sx * 2300, this.finishPoint[2] + sz * 2300, -sz, sx, sea, rnd, mt);
      this.stats = stats;
      return stats;
    },
  };

  RM.DriftTheme = Theme;
})();
