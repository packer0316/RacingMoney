'use strict';
// 沿路景物：護欄、橋、電線桿、標誌、里程牌、反光鏡、土地公廟、檳榔攤、透天厝、路燈、冥紙、植生
(function () {
  const RM = window.RM;
  const { mat, MeshBuilder } = RM;
  const CH = 125; // 每 chunk 125 個取樣 = 250 m

  const M = {
    steel: mat('#a9afb2', 0.38, 0.85),
    post: mat('#8f9599', 0.5, 0.7),
    reflY: mat('#ffcc22', 0.3, 0, 0, 0.0),
    conc: mat('#9b9a94', 0.9),
    concD: mat('#77756f', 0.9),
    poleC: mat('#a4a29a', 0.85),
    wire: mat('#1c1c1c', 0.5, 0.2),
    signBack: mat('#8a8d90', 0.6, 0.6),
    signPost: mat('#9ea4a8', 0.45, 0.7),
    signFace: mat('#ffffff', 0.45, 0, 1),
    signFaceA: mat('#ffffff', 0.45, 0, 2),
    mirrorPole: mat('#e8721c', 0.6),
    redWall: mat('#b8241c', 0.7),
    roofTile: mat('#8c2a18', 0.6),
    gold: mat('#d8a838', 0.4, 0.6),
    glassBooth: mat('#9fb8c0', 0.08, 0.2),
    neonPink: mat('#ff4fd8', 0.3, 0, 11),
    neonGreen: mat('#40ff80', 0.3, 0, 11),
    boothFrame: mat('#d8d8d8', 0.4, 0.6),
    roofConc: mat('#8e8c86', 0.95),
    tank: mat('#c8ccd0', 0.25, 0.9),
    lampHead: mat('#ffd28a', 0.4, 0, 0, 6, 1),
    lampDead: mat('#8a8578', 0.5),
    lampPole: mat('#7d8488', 0.5, 0.6),
    tranf: mat('#6c7376', 0.5, 0.5),
    furnace: mat('#5a3a28', 0.8),
    paintW: mat('#e8e8e4', 0.6, 0, 2),
  };
  const facadeTint = ['#d9d2c3', '#e6e1d6', '#c9b8a6', '#d6c7c0', '#bfc5c2', '#e3d3bd'];

  class Scenery {
    constructor(road, atlas, trees, hm, origin) {
      this.road = road; this.atlas = atlas; this.trees = trees; this.hm = hm; this.origin = origin;
      const N = road.N;
      this.chunks = [];
      for (let i0 = 0; i0 < N - 1; i0 += CH) {
        const i1 = Math.min(i0 + CH, N - 1);
        const im = (i0 + i1) >> 1;
        let r = 0;
        for (let i = i0; i <= i1; i += 5) r = Math.max(r, Math.hypot(road.px[i] - road.px[im], road.pz[i] - road.pz[im]));
        this.chunks.push({ i0, i1, cx: road.px[im], cy: road.py[im], cz: road.pz[im], r: r + 130, built: false, gen: null });
      }
      this._planSigns();
      this._planPoles();
      this._planSpecial();
      this.broken = new Set(); // 已撞斷的電線桿 / 路燈 id
    }

    // ------------------------------------------------------------ 可撞斷物件 (電線桿、路燈)
    // 撞斷：從 chunk 的可撞斷網格移除 (連同接到它的電線)
    breakItem(id) {
      if (this.broken.has(id)) return;
      this.broken.add(id);
      for (const c of this.chunks) {
        if (c.built && (c.breakables.some((b) => b.id === id) || c.wires.some((w) => w.a.id === id || w.b.id === id))) this._buildBreakMesh(c);
      }
    }
    resetBreaks() {
      if (!this.broken.size) return;
      this.broken.clear();
      for (const c of this.chunks) if (c.built) this._buildBreakMesh(c);
    }
    // 倒下中的殘骸 (世界座標網格，由呼叫端以支點旋轉)
    debrisMesh(b) {
      const mb = new MeshBuilder();
      this._breakGeom(mb, b, true);
      return mb.build();
    }
    _breakGeom(mb, b, dead) {
      const { x, y, z } = b;
      if (b.kind === 'pole') {
        const H = b.H;
        mb.cyl([x, y - 0.5, z], [x, y + H, z], 0.17, 0.12, 8, M.poleC, true);
        mb.box(x, y + H - 0.5, z, 0.1, 0.1, 2.0, Math.atan2(b.rx, b.rz), M.steel); // 橫擔 (垂直道路)
        if (b.tranf) mb.cyl([x + b.tx * 0.45, y + H - 2.2, z + b.tz * 0.45], [x + b.tx * 0.45, y + H - 1.1, z + b.tz * 0.45], 0.32, 0.32, 10, M.tranf);
      } else {
        mb.cyl([x, y, z], [x, y + 7.8, z], 0.09, 0.07, 6, M.lampPole);
        mb.cyl([x, y + 7.8, z], [b.ax, y + 8.0, b.az], 0.05, 0.05, 5, M.lampPole, false);
        mb.box(b.ax, y + 7.92, b.az, 0.32, 0.12, 0.6, b.yaw, dead ? M.lampDead : M.lampHead);
      }
    }
    _wireGeom(mb, a, b) {
      for (const off of [-0.9, 0, 0.9]) {
        const ax = a.x + a.rx * off, az = a.z + a.rz * off, ay = a.y + a.H - 0.45 + (off === 0 ? 0.4 : 0);
        const bx = b.x + b.rx * off, bz = b.z + b.rz * off, by = b.y + b.H - 0.45 + (off === 0 ? 0.4 : 0);
        const seg = 8;
        let prev = [ax, ay, az];
        for (let s = 1; s <= seg; s++) {
          const t = s / seg;
          const sag = 4 * 0.9 * t * (1 - t);
          const cur = [ax + (bx - ax) * t, ay + (by - ay) * t - sag, az + (bz - az) * t];
          const dx = cur[0] - prev[0], dz = cur[2] - prev[2];
          const l = Math.hypot(dx, dz) || 1;
          const wx = (-dz / l) * 0.012, wz = (dx / l) * 0.012;
          mb.quad([prev[0] - wx, prev[1], prev[2] - wz], [prev[0] + wx, prev[1], prev[2] + wz], [cur[0] + wx, cur[1], cur[2] + wz], [cur[0] - wx, cur[1], cur[2] - wz], M.wire);
          mb.quad([prev[0], prev[1] - 0.012, prev[2]], [prev[0], prev[1] + 0.012, prev[2]], [cur[0], cur[1] + 0.012, cur[2]], [cur[0], cur[1] - 0.012, cur[2]], M.wire);
          prev = cur;
        }
      }
    }
    _buildBreakMesh(c) {
      if (c.breakMesh) RM.GLU.deleteMesh(c.breakMesh);
      const mb = new MeshBuilder(), br = this.broken;
      c.breakGlows = [];
      for (const b of c.breakables) {
        if (br.has(b.id)) continue;
        this._breakGeom(mb, b, false);
        if (b.glow) for (const v of b.glow) c.breakGlows.push(v);
      }
      for (const w of c.wires) if (!br.has(w.a.id) && !br.has(w.b.id)) this._wireGeom(mb, w.a, w.b);
      c.breakMesh = mb.build();
    }

    // ------------------------------------------------------------ 規劃
    _addSign(list, s, dir, type, opt = {}) { list.push(Object.assign({ s, dir, type }, opt)); }

    _planSigns() {
      const road = this.road, N = road.N, sp = road.sp, k = road.curv;
      const L = road.length;
      const S = (this.signs = []);
      // 彎道
      const curves = [];
      let i = 0;
      while (i < N) {
        if (Math.abs(k[i]) > 1 / 120) {
          let j = i; const sg = Math.sign(k[i]); let peak = 0, pi = i;
          while (j < N && Math.abs(k[j]) > 1 / 160 && Math.sign(k[j]) === sg) { if (Math.abs(k[j]) > peak) { peak = Math.abs(k[j]); pi = j; } j++; }
          if ((j - i) * sp > 14) curves.push({ a: i, b: j, sg, peak, pi });
          i = j + 1;
        } else i++;
      }
      this.curves = curves;
      let lastF = -1e9, lastB = 1e9;
      for (let c = 0; c < curves.length; c++) {
        const cv = curves[c];
        if (cv.peak < 1 / 90) continue;
        const next = curves[c + 1], prev = curves[c - 1];
        const winding = (next && (next.a - cv.b) * sp < 120 && next.sg !== cv.sg) || (prev && (cv.a - prev.b) * sp < 120 && prev.sg !== cv.sg);
        const sF = cv.a * sp - 75;
        if (sF - lastF > 140 && sF > 20) {
          this._addSign(S, sF, 1, winding ? 'warnWind' : cv.sg > 0 ? 'warnR' : 'warnL', { shape: 1 });
          lastF = sF;
        }
        const sB = cv.b * sp + 75;
        if (lastB - sB > 140 || c === 0) {
          // 反向：右彎變左彎
          this._addSign(S, sB, -1, winding ? 'warnWind' : cv.sg > 0 ? 'warnL' : 'warnR', { shape: 1 });
          lastB = sB;
        }
      }
      // 固定標誌 (s 公尺, 方向 +1 往宜蘭 / -1 往台北)
      const fixed = [
        [160, 1, 'slogan1', 2.6, 1.0], [300, 1, 'speed50', 0.75, 0.75], [9400, 1, 'warnRock'],
        [12880, 1, 'xiaogetou', 2.0, 0.85], [12880, -1, 'xiaogetou', 2.0, 0.85], [12950, 1, 'guideA', 2.6, 1.3],
        [14200, 1, 'slogan3', 2.6, 1.0], [15800, -1, 'slogan3', 2.6, 1.0], [16500, 1, 'warnRock'],
        [19300, 1, 'ntpcPinglin', 2.4, 0.9], [21300, 1, 'slogan2', 2.6, 1.0], [21565, 1, 'intervalStart', 2.0, 1.0],
        [21600, 1, 'speed40', 0.75, 0.75], [25465, 1, 'intervalEnd', 2.0, 1.0], [25465, -1, 'intervalStart', 2.0, 1.0],
        [25500, -1, 'speed40', 0.75, 0.75], [25700, -1, 'slogan2', 2.6, 1.0], [21565, -1, 'intervalEnd', 2.0, 1.0],
        [25800, 1, 'pinglinTea', 2.6, 1.0], [27200, -1, 'pinglinTea', 2.6, 1.0], [27000, -1, 'guideC', 2.6, 1.3],
        [27300, 1, 'speed50', 0.75, 0.75], [29500, 1, 'teaAd', 2.4, 0.75], [31000, 1, 'camera', 1.0, 1.0],
        [36000, 1, 'warnRock'], [40000, -1, 'warnRock'], [42000, 1, 'camera', 1.0, 1.0],
        [44930, 1, 'welcomeYilan', 3.4, 1.15], [44930, -1, 'ntpcPinglin', 2.4, 0.9], [44980, 1, 'shipai', 2.0, 0.85],
        [44700, -1, 'guideD', 2.6, 1.3], [45280, 1, 'guideB', 2.6, 1.3], [45350, 1, 'nineTurns', 2.6, 1.0],
        [45420, 1, 'speed40', 0.75, 0.75], [45500, 1, 'slogan4', 2.6, 1.0], [46500, 1, 'noOvertake', 0.75, 0.75],
        [50000, 1, 'camera', 1.0, 1.0], [57000, 1, 'touchengTown', 2.4, 0.9], [58000, -1, 'nineTurns', 2.6, 1.0],
        [57600, -1, 'slogan4', 2.6, 1.0], [57800, -1, 'speed40', 0.75, 0.75], [52000, -1, 'camera', 1.0, 1.0],
        [6000, 1, 'rescue', 1.8, 0.9], [33500, -1, 'rescue', 1.8, 0.9], [47800, 1, 'rescue', 1.8, 0.9],
        [3500, -1, 'slogan1', 2.6, 1.0], [56000, -1, 'slogan1', 2.6, 1.0], [8000, 1, 'speed50', 0.75, 0.75],
        [38000, -1, 'speed50', 0.75, 0.75], [33000, 1, 'speed50', 0.75, 0.75],
      ];
      for (const [s, dir, type, w, h] of fixed) if (s < L) this._addSign(S, s, dir, type, { w, h, shape: /^(speed|noOvertake|warn)/.test(type) ? 1 : 0 });
      // 里程牌
      const k0 = Math.ceil(road.kmOffset), k1 = Math.floor(L / 1000 + road.kmOffset);
      this.kmRange = [k0, k1];
      for (let km = k0; km <= k1; km++) {
        const s = (km - road.kmOffset) * 1000;
        this._addSign(S, s, 1, 'km' + km, { w: 0.32, h: 0.64, post: 0.55, km: true });
        this._addSign(S, s, -1, 'km' + km, { w: 0.32, h: 0.64, post: 0.55, km: true });
      }
      // 速限 (反方向 9 彎入口)
      S.sort((a, b) => a.s - b.s);
    }

    _planPoles() {
      const road = this.road, sp = road.sp, L = road.length;
      const P = (this.poles = []);
      let side = 1;
      for (let k = 0; ; k++) {
        const s = k * 42 + (RM.hash2(k, 3, 9) - 0.5) * 8;
        if (s > L - 5) break;
        if (s < 0) continue;
        const i = Math.floor(s / sp);
        if (road.bridge[i]) continue;
        const ok = [road.side[0][i] !== 1, road.side[1][i] !== 1];
        if (!ok[side]) side = 1 - side;
        if (!ok[side]) continue;
        P.push({ s, side, k });
      }
      // 電線桿避免與標誌重疊
    }

    _planSpecial() {
      const road = this.road, sp = road.sp;
      const pickSide = (s) => {
        const i = Math.floor(s / sp);
        for (const sd of [1, 0]) if (road.side[sd][i] !== 1 && !road.bridge[i]) return sd;
        return -1;
      };
      this.special = [];
      for (const s of [5200, 13300, 21700, 30400, 38900, 47600, 52300]) { const sd = pickSide(s); if (sd >= 0 && s < road.length) this.special.push({ s, side: sd, type: 'shrine' }); }
      for (const s of [1400, 11600, 25700, 33100, 44600, 57400]) { const sd = pickSide(s); if (sd >= 0 && s < road.length) this.special.push({ s, side: sd, type: 'stall' }); }
      // 冥紙地點
      this.paperSites = [];
      const rnd = RM.rng(4242);
      for (let s = 2500; s < road.length - 200; s += 350 + rnd() * 700) {
        const i = Math.floor(s / sp);
        if (road.zone[i]) continue;
        // 縣界~九彎、坪林~石牌最多
        const n = Math.floor((s > 40000 ? 30 : 14) + rnd() * 30);
        this.paperSites.push({ s, n, seed: (rnd() * 1e9) | 0 });
      }
    }

    // ------------------------------------------------------------ 建置 chunk
    buildChunk(c) {
      const road = this.road;
      c.roadMesh = road.buildChunkMesh(c.i0, c.i1);
      const mb = new MeshBuilder(), dec = new MeshBuilder();
      c.glows = [];
      c.breakables = []; // 可撞斷：{ id, kind, x, y, z, r, H, ... }
      c.wires = [];      // 電線：{ a, b } (電線桿)
      const inst = {};
      const push = (key, x, y, z, yaw, sx, sy, sz, r, g, b, fade) => {
        let a = inst[key]; if (!a) a = inst[key] = [];
        a.push(x, y, z, yaw, sx, sy, sz, 0, r, g, b, fade);
      };
      this._rails(c, mb);
      this._bridges(c, mb);
      this._polesBuild(c);
      this._signsBuild(c, mb);
      this._curveFurniture(c, mb, dec);
      this._specialBuild(c, mb);
      this._town(c, mb);
      this._papers(c, push);
      this._vegetation(c, push);
      c.props = mb.build();
      c.decals = dec.build();
      this._buildBreakMesh(c);
      c.inst = [];
      for (const key in inst) {
        const arr = new Float32Array(inst[key]);
        const [kind, vi] = key.split(':');
        let geom = this.trees[kind];
        if (Array.isArray(geom)) geom = geom[+vi || 0];
        const view = RM.GLU.instancedView(geom, arr, arr.length / 12);
        view.kind = kind; view.vkey = key;
        view.data = arr; // 留一份在 CPU：每幀挑出近景樹 (main.js) 用
        // 遠景簡化模型：共用同一個 instance buffer，繪製時依距離交叉淡入
        let lg = this.trees.lod && this.trees.lod[kind];
        if (Array.isArray(lg)) lg = lg[+vi || 0];
        if (lg) { view.lod = RM.GLU.instancedView(lg, null, arr.length / 12, view.instBuf); view.lod.kind = kind; }
        c.inst.push(view);
      }
      c.built = true;
    }

    disposeChunk(c) {
      for (const m of [c.roadMesh, c.props, c.decals, c.breakMesh]) if (m) RM.GLU.deleteMesh(m);
      for (const v of c.inst || []) { const gl = RM.GLU.gl; gl.deleteVertexArray(v.vao); gl.deleteBuffer(v.instBuf); if (v.lod) gl.deleteVertexArray(v.lod.vao); }
      c.roadMesh = c.props = c.decals = c.breakMesh = null; c.inst = []; c.built = false;
    }

    _edge(i, sg) {
      const r = this.road, W = r.halfW[i];
      const ii = Math.min(i, r.N - 2), tt = i >= r.N - 1 ? 1 : 0;
      return { W, y: r.py[i] + r.surfOff(ii, tt, sg * W) };
    }

    _rails(c, mb) {
      const road = this.road;
      for (let sd = 0; sd < 2; sd++) {
        const sg = sd ? 1 : -1;
        let run = null;
        const flush = () => {
          if (run && run.length > 1) {
            mb.extrude(run, [[0.03, 0.42], [-0.05, 0.47], [0.0, 0.53], [0.0, 0.58], [-0.05, 0.64], [0.03, 0.69]], M.steel);
          }
          run = null;
        };
        for (let i = c.i0; i <= c.i1; i++) {
          if (road.side[sd][i] === 1) {
            const e = this._edge(i, sg);
            const d = sg * (e.W + 0.62);
            if (!run) run = [];
            run.push({ p: [road.px[i] + road.rx[i] * d, e.y, road.pz[i] + road.rz[i] * d], r: [road.rx[i] * sg, 0, road.rz[i] * sg] });
            if (i % 2 === 0) {
              const dp = sg * (e.W + 0.74);
              const yaw = Math.atan2(road.tx[i], road.tz[i]);
              mb.box(road.px[i] + road.rx[i] * dp, e.y + 0.18, road.pz[i] + road.rz[i] * dp, 0.15, 1.0, 0.09, yaw, M.post);
              if (i % 6 === 0) {
                const dr = sg * (e.W + 0.56);
                mb.box(road.px[i] + road.rx[i] * dr, e.y + 0.76, road.pz[i] + road.rz[i] * dr, 0.09, 0.07, 0.02, yaw, M.reflY);
              }
            }
          } else flush();
        }
        flush();
      }
    }

    _bridges(c, mb) {
      const road = this.road;
      let run = null;
      const flush = () => {
        if (run && run.length > 1) {
          for (const sg of [-1, 1]) {
            const path = run.map((q) => ({ p: [q.x + q.rx * sg * (q.W + 0.45), q.ye[sg > 0 ? 1 : 0], q.z + q.rz * sg * (q.W + 0.45)], r: [q.rx * sg, 0, q.rz * sg] }));
            mb.extrude(path, [[0, -0.05], [0, 0.95], [0.3, 0.95], [0.3, -1.3]], M.conc);
          }
          const path = run.map((q) => ({ p: [q.x, q.y, q.z], r: [q.rx, 0, q.rz] }));
          const w = run[0].W + 0.8;
          mb.extrude(path, [[w, -0.1], [w, -1.4], [-w, -1.4], [-w, -0.1]], M.concD);
        }
        run = null;
      };
      for (let i = c.i0; i <= c.i1; i++) {
        if (road.bridge[i]) {
          if (!run) run = [];
          const W = road.halfW[i];
          run.push({ x: road.px[i], y: road.py[i], z: road.pz[i], rx: road.rx[i], rz: road.rz[i], W, ye: [this._edge(i, -1).y, this._edge(i, 1).y] });
          if (i % 12 === 0) {
            const g = this.hm.sample(road.px[i], road.pz[i]);
            const top = road.py[i] - 1.4;
            if (top - g > 1) {
              const yaw = Math.atan2(road.tx[i], road.tz[i]);
              mb.box(road.px[i], (top + g - 2) / 2, road.pz[i], W * 1.2, top - g + 2, 1.6, yaw, M.concD);
            }
          }
        } else flush();
      }
      flush();
    }

    // 電線桿 (可撞斷，網格在 _buildBreakMesh 產生)
    _poleItem(k) {
      const road = this.road, p = this.poles[k];
      const f = road.frameAt(p.s, {});
      const sg = p.side ? 1 : -1;
      const W = f.W;
      const d = sg * (W + (road.zone[f.i] ? 1.0 : 1.7));
      const y = f.y + road.surfOff(f.i, f.t, sg * W) + (road.zone[f.i] ? 0.15 : -0.12);
      return { id: 'p' + k, kind: 'pole', x: f.x + f.rx * d, y, z: f.z + f.rz * d, rx: f.rx, rz: f.rz, tx: f.tx, tz: f.tz, H: 10.5, r: 0.2, tranf: p.k % 7 === 3 };
    }

    _polesBuild(c) {
      const road = this.road, s0 = c.i0 * road.sp, s1 = c.i1 * road.sp;
      const P = this.poles;
      for (let k = 0; k < P.length; k++) {
        const p = P[k];
        if (p.s < s0 || p.s >= s1) continue;
        const a = this._poleItem(k);
        c.breakables.push(a);
        // 電線 → 下一根
        const q = P[k + 1];
        if (!q || q.s - p.s > 60) continue;
        c.wires.push({ a, b: this._poleItem(k + 1) });
      }
    }

    // 立牌：在 (x,y,z) 底部，正面法線 (nx,nz)
    _board(mb, x, y, z, nx, nz, uvName, w, h, postH, alpha, twoPosts) {
      const uv = this.atlas.uv(uvName);
      const rx = nz, rz = -nx; // 觀看者的右方 = cross(-n, up)
      const cy = y + postH + h / 2;
      const off = 0.03;
      const P = (sx, sy, o) => [x + rx * sx * w / 2 + nx * o, cy + sy * h / 2, z + rz * sx * w / 2 + nz * o];
      mb.quad(P(-1, -1, off), P(1, -1, off), P(1, 1, off), P(-1, 1, off), alpha ? M.signFaceA : M.signFace, uv);
      if (!alpha) mb.quad(P(1, -1, -off), P(-1, -1, -off), P(-1, 1, -off), P(1, 1, -off), M.signBack);
      else mb.quad(P(1, -1, 0), P(-1, -1, 0), P(-1, 1, 0), P(1, 1, 0), Object.assign({}, M.signBack, { mode: 12 }), [uv[2], uv[1], uv[0], uv[3]]);
      const top = cy + h / 2 - 0.05;
      if (twoPosts) {
        for (const sx of [-0.35, 0.35]) mb.cyl([x + rx * sx * w - nx * 0.05, y - 0.3, z + rz * sx * w - nz * 0.05], [x + rx * sx * w - nx * 0.05, top, z + rz * sx * w - nz * 0.05], 0.05, 0.05, 6, M.signPost, true);
      } else {
        mb.cyl([x - nx * 0.05, y - 0.3, z - nz * 0.05], [x - nx * 0.05, top, z - nz * 0.05], 0.04, 0.04, 6, M.signPost, true);
      }
    }

    _signsBuild(c, mb) {
      const road = this.road, s0 = c.i0 * road.sp, s1 = c.i1 * road.sp;
      for (const sg of this.signs) {
        if (sg.s < s0 || sg.s >= s1) continue;
        const f = road.frameAt(sg.s, {});
        const side = sg.dir > 0 ? 1 : -1;            // 行車方向右側
        const sd = side > 0 ? 1 : 0;
        const st = road.side[sd][f.i];
        const W = f.W;
        const dist = W + (st === 1 ? 1.25 : st === 3 ? 1.6 : 1.9) + (sg.km ? 0 : 0.2);
        const d = side * dist;
        const x = f.x + f.rx * d, z = f.z + f.rz * d;
        const y = f.y + road.surfOff(f.i, f.t, side * W) - (st === 3 ? -0.15 : 0.1);
        // 面向來車：法線 = -dir * t
        const nx = -sg.dir * f.tx, nz = -sg.dir * f.tz;
        const w = sg.w || 0.9, h = sg.h || 0.8;
        const big = w > 1.5;
        this._board(mb, x, y, z, nx, nz, sg.type, w, h, sg.post || (big ? 2.1 : 1.9), !!sg.shape, big);
      }
    }

    _curveFurniture(c, mb, dec) {
      const road = this.road, sp = road.sp;
      for (const cv of this.curves) {
        if (cv.b < c.i0 || cv.a > c.i1) continue;
        const R = 1 / cv.peak;
        const outer = cv.sg > 0 ? -1 : 1;
        // 線形導引標誌
        if (R < 70) {
          for (let i = cv.a + 3; i < cv.b - 2; i += 6) {
            if (i < c.i0 || i >= c.i1) continue;
            const sd = outer > 0 ? 1 : 0;
            const e = this._edge(i, outer);
            const off = road.side[sd][i] === 1 ? 1.05 : 1.5;
            const d = outer * (e.W + off);
            const x = road.px[i] + road.rx[i] * d, z = road.pz[i] + road.rz[i] * d;
            const uv = this.atlas.uv('chevron');
            const uvR = uv, uvL = [uv[2], uv[1], uv[0], uv[3]];
            // 往宜蘭 (+s) 的駕駛：看到的面法線 = -t，箭頭指向內側 (右彎→右)
            const tx = road.tx[i], tz = road.tz[i];
            const w = 0.55, h = 0.7, cy = e.y + 1.25;
            const quadFace = (nx, nz, uvx) => {
              const rx = nz, rz = -nx;
              const P = (sx, sy) => [x + rx * sx * w / 2 + nx * 0.02, cy + sy * h / 2, z + rz * sx * w / 2 + nz * 0.02];
              mb.quad(P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), M.signFace, uvx);
            };
            quadFace(-tx, -tz, cv.sg > 0 ? uvR : uvL);
            quadFace(tx, tz, cv.sg > 0 ? uvL : uvR);
            mb.cyl([x, e.y - 0.3, z], [x, cy + h / 2, z], 0.035, 0.035, 5, M.signPost, false);
          }
        }
        // 髮夾彎反光鏡
        if (R < 30 && cv.pi >= c.i0 && cv.pi < c.i1) {
          const i = cv.pi;
          const e = this._edge(i, outer);
          const d = outer * (e.W + 1.4);
          const x = road.px[i] + road.rx[i] * d, z = road.pz[i] + road.rz[i] * d;
          mb.cyl([x, e.y - 0.3, z], [x, e.y + 2.9, z], 0.05, 0.05, 6, M.mirrorPole, true);
          const nx = -road.rx[i] * outer, nz = -road.rz[i] * outer;
          const uv = this.atlas.uv('mirror');
          const rx = nz, rz = -nx, cy = e.y + 2.9, w = 0.85;
          const P = (sx, sy, o) => [x + rx * sx * w / 2 + nx * o, cy + sy * w / 2, z + rz * sx * w / 2 + nz * o];
          mb.quad(P(-1, -1, 0.06), P(1, -1, 0.06), P(1, 1, 0.06), P(-1, 1, 0.06), Object.assign({}, M.signFaceA, { r: 0.15, m: 0.3 }), uv);
          mb.quad(P(1, -1, 0.04), P(-1, -1, 0.04), P(-1, 1, 0.04), P(1, 1, 0.04), Object.assign({}, M.mirrorPole, { mode: 12 }), [uv[2], uv[1], uv[0], uv[3]]);
        }
        // 路面「慢」字 (急彎前)
        if (R < 45) {
          const place = (i, dir) => {
            if (i < c.i0 || i >= c.i1 || i < 0 || i >= road.N - 1) return;
            for (const laneAbs of [road.laneIn || 1.75, road.laneOut || 1.75]) {
              if (laneAbs > road.halfW[i] - 1.2) continue;
              const lane = dir * laneAbs;
              const tx = road.tx[i] * dir, tz = road.tz[i] * dir, rx = road.rx[i] * dir, rz = road.rz[i] * dir;
              const cx = road.px[i] + road.rx[i] * lane, cz = road.pz[i] + road.rz[i] * lane;
              const y = road.py[i] + road.surfOff(i, 0, lane) + 0.012;
              const w = 1.3, h = 2.6;
              const P = (sx, sy) => [cx + rx * sx * w / 2 + tx * sy * h / 2, y, cz + rz * sx * w / 2 + tz * sy * h / 2];
              dec.quad(P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), M.paintW, this.atlas.uv('slow'));
            }
          };
          place(cv.a - 18, 1);
          place(cv.b + 18, -1);
        }
      }
    }

    _specialBuild(c, mb) {
      const road = this.road, s0 = c.i0 * road.sp, s1 = c.i1 * road.sp;
      for (const sp of this.special) {
        if (sp.s < s0 || sp.s >= s1) continue;
        const f = road.frameAt(sp.s, {});
        const sg = sp.side ? 1 : -1;
        const e = { W: f.W, y: f.y + road.surfOff(f.i, f.t, sg * f.W) };
        const nx = -f.rx * sg, nz = -f.rz * sg; // 面向道路
        const yaw = Math.atan2(nx, nz);
        if (sp.type === 'shrine') {
          const d = sg * (e.W + 4.2);
          const x = f.x + f.rx * d, z = f.z + f.rz * d, y = e.y;
          mb.box(x, y - 2, z, 4.0, 4.4, 4.0, yaw, M.concD);                                   // 基座
          mb.box(x, y + 1.3, z, 2.4, 2.6, 2.2, yaw, M.redWall, this.atlas.uv('temple'));       // 廟身
          // 屋頂 (燕尾)
          const rx = Math.cos(yaw), rz = -Math.sin(yaw);
          const ry = y + 2.6;
          for (const s of [-1, 1]) {
            const a = [x + rx * 1.6 + nx * s * 0.0, ry, z + rz * 1.6], b = [x - rx * 1.6, ry, z - rz * 1.6];
            const front = (p, o, h) => [p[0] + nx * o, p[1] + h, p[2] + nz * o];
            mb.quad(front(b, s * 1.5, 0), front(a, s * 1.5, 0), front(a, 0, 0.9), front(b, 0, 0.9), M.roofTile);
          }
          mb.box(x, ry + 0.95, z, 3.4, 0.14, 0.18, yaw, M.roofTile);
          for (const s of [-1, 1]) mb.box(x + rx * s * 1.75, ry + 1.12, z + rz * s * 1.75, 0.4, 0.12, 0.14, yaw + s * 0.5, M.gold);
          // 金爐
          const fx = x + rx * 2.4 * sg, fz = z + rz * 2.4 * sg;
          mb.box(fx, y + 0.7, fz, 0.8, 1.4, 0.8, yaw, M.furnace);
          mb.cyl([fx, y + 1.4, fz], [fx, y + 2.6, fz], 0.18, 0.12, 6, M.furnace);
          c.glows.push(x + nx * 1.15, y + 2.2, z + nz * 1.15, 0.6, 1.0, 0.25, 0.1, 2.0);
        } else {
          const d = sg * (e.W + 3.0);
          const x = f.x + f.rx * d, z = f.z + f.rz * d, y = e.y;
          mb.box(x, y - 1.5, z, 3.4, 3.2, 3.2, yaw, M.concD);
          mb.box(x, y + 1.2, z, 2.6, 2.4, 2.2, yaw, M.glassBooth);
          mb.box(x, y + 2.5, z, 2.9, 0.2, 2.5, yaw, M.boothFrame);
          // 霓虹燈管 (外框)
          const rx = Math.cos(yaw), rz = -Math.sin(yaw);
          const fxp = x + nx * 1.12, fzp = z + nz * 1.12;
          for (const [ox, oy, w, h, m] of [[0, 2.35, 2.6, 0.06, M.neonPink], [0, 0.05, 2.6, 0.06, M.neonGreen], [-1.3, 1.2, 0.06, 2.3, M.neonPink], [1.3, 1.2, 0.06, 2.3, M.neonGreen]]) {
            mb.box(fxp + rx * ox, y + oy, fzp + rz * ox, w, h, 0.06, yaw, m);
          }
          // 招牌
          this._board(mb, x + nx * 1.3, y + 2.6, z + nz * 1.3, nx, nz, 'betel', 2.6, 0.65, 0.0, false, false);
          mb.box(x - nx * 0.2, y + 0.5, z - nz * 0.2, 1.6, 1.0, 0.5, yaw, mat('#c8a050', 0.6));
          c.glows.push(fxp, y + 2.35, fzp, 2.2, 1.0, 0.3, 0.85, 1.6, fxp + rx * 1.3, y + 1.2, fzp + rz * 1.3, 1.6, 0.25, 1.0, 0.5, 1.3);
          c.glows.push(fxp - rx * 1.3, y + 1.2, fzp - rz * 1.3, 1.6, 1.0, 0.3, 0.85, 1.3);
        }
      }
    }

    _town(c, mb) {
      const road = this.road, sp = road.sp;
      const rnd = RM.rng(c.i0 * 7 + 13);
      for (let sd = 0; sd < 2; sd++) {
        const sg = sd ? 1 : -1;
        let i = c.i0;
        while (i < c.i1) {
          if (road.side[sd][i] !== 3) { i++; continue; }
          const wid = 4.2 + rnd() * 2.6;
          const steps = Math.max(2, Math.round(wid / sp));
          if (i + steps > c.i1) break;
          const im = i + (steps >> 1);
          if (road.side[sd][i + steps] !== 3) { i += steps; continue; }
          const zoneIdx0 = road.zones.findIndex((zz) => im * sp >= zz[0] && im * sp <= zz[1]);
          const village = zoneIdx0 === 1 || zoneIdx0 === 3;
          if (rnd() < (village ? 0.55 : 0.15)) { i += steps + (village ? 3 : 0); continue; } // 巷口 / 空地
          const e = this._edge(im, sg);
          const depth = 10 + rnd() * 5;
          const d = sg * (e.W + 2.75 + depth / 2);
          const x = road.px[im] + road.rx[im] * d, z = road.pz[im] + road.rz[im] * d;
          const nx = -road.rx[im] * sg, nz = -road.rz[im] * sg;
          const yaw = Math.atan2(nx, nz);
          const zoneIdx = road.zones.findIndex((zz) => im * sp >= zz[0] && im * sp <= zz[1]);
          const tall = zoneIdx === 0 || zoneIdx === 4;
          const floors = tall ? 3 + Math.floor(rnd() * 3) : village ? 1 + Math.floor(rnd() * 2) : 2 + Math.floor(rnd() * 2);
          const fh = 3.2;
          const H = floors * fh;
          const y0 = e.y + 0.15;
          const fv = Math.floor(rnd() * 6);
          const wall = mat(facadeTint[fv], 0.85);
          // 主體 (含往下延伸的地基)
          mb.box(x, y0 + H / 2 - 4, z, wid - 0.15, H + 8, depth, yaw, wall);
          // 立面 (一樓 + 各樓層)
          const uv = this.atlas.uv('facade' + fv);
          const rx = Math.cos(yaw), rz = -Math.sin(yaw);
          const fx = x + nx * (depth / 2 + 0.02), fz = z + nz * (depth / 2 + 0.02);
          const hw = (wid - 0.15) / 2;
          const facadeM = mat('#ffffff', 0.7, 0, 10);
          for (let f = 0; f < floors; f++) {
            const v0 = f === 0 ? 0.75 : ((f - 1) % 3) * 0.25;
            const uvf = [uv[0], uv[1] + (uv[3] - uv[1]) * v0, uv[2], uv[1] + (uv[3] - uv[1]) * (v0 + 0.25)];
            const yb = y0 + f * fh, yt = yb + fh;
            // 觀看者右方 = -n x up
            const vx = nz, vz = -nx;
            mb.quad([fx - vx * hw, yb, fz - vz * hw], [fx + vx * hw, yb, fz + vz * hw], [fx + vx * hw, yt, fz + vz * hw], [fx - vx * hw, yt, fz - vz * hw], facadeM, uvf);
          }
          // 店招
          const shop = 'shop' + Math.floor(rnd() * this.atlas.nShops);
          this._board(mb, fx + nx * 0.25, y0 + 2.8, fz + nz * 0.25, nx, nz, shop, wid * 0.88, 0.85, 0, false, false);
          mb.box(fx + nx * 0.6, y0 + 2.75, fz + nz * 0.6, wid - 0.2, 0.1, 1.2, yaw, M.roofConc); // 雨遮
          if (rnd() < 0.3 && floors > 2) {
            const k = Math.floor(rnd() * 6);
            const vx = nz, vz = -nx;
            const px = fx + vx * hw * 0.8 + nx * 0.5, pz = fz + vz * hw * 0.8 + nz * 0.5;
            this._board(mb, px, y0 + 4.0, pz, vx, vz, 'vsign' + k, 0.55, 2.4, 0, false, false);
          }
          // 屋頂：水塔、鐵皮
          const top = y0 + H;
          if (rnd() < 0.7) mb.cyl([x - nx * 2, top, z - nz * 2], [x - nx * 2, top + 1.3, z - nz * 2], 0.6, 0.6, 10, M.tank);
          if (rnd() < 0.45) {
            mb.box(x - nx * depth * 0.2, top + 1.3, z - nz * depth * 0.2, wid - 0.4, 0.15, depth * 0.55, yaw, mat('#3f6f8a', 0.45, 0.5));
            for (const s of [-1, 1]) mb.box(x + rx * s * (hw - 0.3) - nx * depth * 0.2, top + 0.65, z + rz * s * (hw - 0.3) - nz * depth * 0.2, 0.1, 1.3, 0.1, yaw, M.steel);
          }
          i += steps;
        }
        // 路燈
        for (let j = c.i0 + ((c.i0 / 17) | 0) % 2; j < c.i1; j += 17) {
          if (road.side[sd][j] !== 3 || (sd + Math.floor(j / 17)) % 2) continue;
          const e = this._edge(j, sg);
          const d = sg * (e.W + 1.0);
          const x = road.px[j] + road.rx[j] * d, z = road.pz[j] + road.rz[j] * d, y = e.y + 0.15;
          const ax = x - road.rx[j] * sg * 1.6, az = z - road.rz[j] * sg * 1.6;
          const yaw = Math.atan2(road.rx[j], road.rz[j]);
          // 可撞斷 (網格在 _buildBreakMesh 產生)
          c.breakables.push({ id: 'l' + j + '_' + sd, kind: 'lamp', x, y, z, ax, az, yaw, H: 8, r: 0.14, glow: [ax, y + 7.8, az, 3.0, 1.0, 0.62, 0.25, 2.2] });
        }
      }
    }

    _papers(c, push) {
      const road = this.road, sp = road.sp, s0 = c.i0 * sp, s1 = c.i1 * sp;
      for (const site of this.paperSites) {
        if (site.s < s0 - 30 || site.s >= s1) continue;
        const rnd = RM.rng(site.seed);
        for (let k = 0; k < site.n; k++) {
          const s = site.s + rnd() * 40;
          if (s < s0 || s >= s1) continue;
          const f = road.frameAt(s, {});
          const lat = (rnd() < 0.5 ? -1 : 1) * Math.pow(rnd(), 0.6) * (f.W - 0.3);
          const x = f.x + f.rx * lat, z = f.z + f.rz * lat;
          const y = f.y + road.surfOff(f.i, f.t, lat) + 0.018;
          const sc = 0.11 + rnd() * 0.08;
          const v = Math.floor(rnd() * 4);
          push('paper:' + v, x, y, z, rnd() * 6.28, sc, 1, sc, 0.9 + rnd() * 0.1, 0.9 + rnd() * 0.1, 0.85, 90);
        }
      }
    }

    _vegetation(c, push) {
      const road = this.road, hm = this.hm, sp = road.sp;
      const rnd = RM.rng(c.i0 * 31 + 7);
      for (let i = c.i0; i < c.i1; i += 3) {
        const s = i * sp;
        const W = road.halfW[i];
        const town = road.zone[i];
        for (const sg of [-1, 1]) {
          const sd = sg > 0 ? 1 : 0;
          const st = road.side[sd][i];
          // 路邊草叢
          if (!town && st !== 2 && rnd() < 0.8) {
            const lat = W + (st === 1 ? 1.1 : 1.0) + rnd() * 2.2;
            const x = road.px[i] + road.rx[i] * sg * lat + road.tx[i] * rnd() * 4, z = road.pz[i] + road.rz[i] * sg * lat + road.tz[i] * rnd() * 4;
            const y = road.carved(x, z, 6.25);
            const sc = 0.8 + rnd() * 0.8;
            push('grass', x, y, z, rnd() * 6.28, sc, sc * (0.8 + rnd() * 0.5), sc, 0.8 + rnd() * 0.3, 0.85 + rnd() * 0.25, 0.7 + rnd() * 0.2, 140);
          }
          for (let q = 0; q < 17; q++) {
            const lat = W + 3.5 + q * 6.5 + rnd() * 4.5;
            const jit = (rnd() - 0.5) * 5;
            const x = road.px[i] + road.rx[i] * sg * lat + road.tx[i] * jit;
            const z = road.pz[i] + road.rz[i] * sg * lat + road.tz[i] * jit;
            if (town && lat < 30) continue;
            if (road.nearRoad(x, z)) {
              const n = road.nearestBranches(x, z, 14);
              if (n > 0) {
                const bi = Math.min(Math.floor(road.brFi[0]), road.N - 1);
                if (Math.abs(road.brD[0]) < road.halfW[bi] + 2.6) continue;
              }
            }
            const y = road.carved(x, z, 6.25);
            if (y < 2.5) continue;
            const dens = RM.fbm(x / 95, z / 95, 2, 5);
            if (dens < 0.36) continue;
            if (lat > 40 && rnd() < 0.25) continue;
            // 坡度
            const gx = hm.sample(x + 8, z) - hm.sample(x - 8, z), gz = hm.sample(x, z + 8) - hm.sample(x, z - 8);
            const slope = Math.hypot(gx, gz) / 16;
            if (y < 30 && slope < 0.06) {
              // 平原：零星檳榔樹
              if (rnd() < 0.12) push('betel', x, y, z, rnd() * 6.28, 0.9 + rnd() * 0.3, 0.85 + rnd() * 0.3, 0.9, 1, 1, 1, 650);
              continue;
            }
            if (slope > 1.4 && rnd() < 0.5) continue;
            // 坪林茶園
            if (s > 21500 && s < 30500 && lat > 10 && lat < 75 && slope < 0.45 && RM.fbm(x / 60, z / 60, 2, 77) > 0.58) {
              const cx = -gz, cz = gx, cl = Math.hypot(cx, cz) || 1;
              for (let b = -3; b <= 3; b++) {
                const bx = x + (cx / cl) * b * 1.25, bz = z + (cz / cl) * b * 1.25;
                push('tea', bx, road.carved(bx, bz, 6.25), bz, rnd() * 6.28, 1.0 + rnd() * 0.2, 0.9 + rnd() * 0.2, 1.0, 0.9 + rnd() * 0.2, 1, 0.9, 420);
              }
              continue;
            }
            const r = rnd();
            const tint = () => [0.8 + rnd() * 0.35, 0.82 + rnd() * 0.3, 0.75 + rnd() * 0.3];
            let kind;
            if (y > 330 && r < 0.32) kind = 'conifer';
            else if (r < 0.42 && lat < 45 && st !== 1) kind = 'fern';
            else if (RM.fbm(x / 40, z / 40, 2, 99) > 0.68) kind = 'bamboo';
            else if (y < 260 && (town || RM.fbm(x / 120, z / 120, 2, 55) > 0.64) && r < 0.6) kind = 'betel';
            else kind = 'broad:' + Math.floor(rnd() * 3);
            const tt = tint();
            const sc = kind === 'conifer' ? 0.75 + rnd() * 0.5 : kind === 'fern' ? 0.8 + rnd() * 0.5 : kind === 'bamboo' ? 0.8 + rnd() * 0.4 : 0.85 + rnd() * 0.65;
            push(kind, x, y, z, rnd() * 6.28, sc, sc * (0.85 + rnd() * 0.3), sc, tt[0], tt[1], tt[2], kind === 'fern' ? 380 : 750);
          }
        }
      }
    }

    // ------------------------------------------------------------ 平原遠方建物 (全域)
    buildFar() {
      const hm = this.hm, o = this.origin, road = this.road;
      const toLocal = (lon, lat) => [(lon - o.lon) * o.kx, -(lat - o.lat) * o.ky];
      const towns = [toLocal(121.8233, 24.8592), toLocal(121.7705, 24.8270), toLocal(121.7530, 24.7570), toLocal(121.7950, 24.8170)];
      const rnd = RM.rng(999);
      const arr = [];
      let n = 0, tries = 0;
      while (n < 3200 && tries < 60000) {
        tries++;
        let x, z;
        if (rnd() < 0.7) {
          const t = towns[Math.floor(rnd() * towns.length)];
          const a = rnd() * 6.28, r = Math.pow(rnd(), 1.6) * 1400;
          x = t[0] + Math.cos(a) * r; z = t[1] + Math.sin(a) * r;
        } else {
          x = hm.x0 + rnd() * (hm.x1 - hm.x0); z = hm.z0 + rnd() * (hm.z1 - hm.z0);
        }
        const h = hm.sample(x, z);
        if (h < 2 || h > 40) continue;
        const sl = Math.abs(hm.sample(x + 20, z) - hm.sample(x - 20, z)) + Math.abs(hm.sample(x, z + 20) - hm.sample(x, z - 20));
        if (sl > 3) continue;
        if (road.nearRoad(x, z)) continue;
        const w = 6 + rnd() * 8, dd = 8 + rnd() * 10, hh = 5 + rnd() * rnd() * 22;
        const g = 0.5 + rnd() * 0.3;
        arr.push(x, h - 1, z, rnd() * 6.28, w, hh, dd, 0, g, g * (0.94 + rnd() * 0.06), g * (0.86 + rnd() * 0.1), 14000);
        n++;
      }
      this.far = RM.GLU.instancedView(this.trees.house, new Float32Array(arr), n);
    }
  }

  RM.Scenery = Scenery;
  RM.SCENERY_CH = CH;
})();
