'use strict';
// 植生模型 (instanced 共用幾何)：闊葉樹、柳杉、筆筒樹、檳榔樹、竹叢、草叢、茶樹、冥紙
(function () {
  const RM = window.RM;
  const F = () => RM.Tex.fcell;

  // 植生用 builder：aExtra = (sway, leaf(1)/bark(-1)/plain(0), emissive, 0)
  class VB {
    constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.x = []; this.i = []; }
    get vc() { return this.p.length / 3; }
    v(p, n, uv, col, rough, sway, kind) {
      this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.u.push(uv[0], uv[1]);
      this.c.push(col[0], col[1], col[2], rough); this.x.push(sway, kind, 0, 0);
      return this.vc - 1;
    }
    // 卡片：中心 c，寬軸 a，高軸 b (半長)，cell uv，法線 n (或自訂)
    card(c, a, b, uv, col, sway, nfn) {
      const P = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      const UV = [[uv[0], uv[3]], [uv[2], uv[3]], [uv[2], uv[1]], [uv[0], uv[1]]];
      const idx = P.map(([sx, sy], k) => {
        const p = [c[0] + a[0] * sx + b[0] * sy, c[1] + a[1] * sx + b[1] * sy, c[2] + a[2] * sx + b[2] * sy];
        return this.v(p, nfn(p), UV[k], col, 0.75, sway * Math.max(p[1], 0) / 10, 1);
      });
      this.i.push(idx[0], idx[1], idx[2], idx[0], idx[2], idx[3]);
    }
    trunk(p0, p1, r0, r1, seg, uv, col, kind = -1) {
      const base = this.vc;
      const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
      const L = Math.hypot(dx, dy, dz);
      const ax = [dx / L, dy / L, dz / L];
      const u = RM.v3.norm([0, 0, 0], RM.v3.cross([0, 0, 0], ax, Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
      const w = RM.v3.cross([0, 0, 0], ax, u);
      for (let k = 0; k <= seg; k++) {
        const a = (k / seg) * 6.2832, ca = Math.cos(a), sa = Math.sin(a);
        const n = [u[0] * ca + w[0] * sa, u[1] * ca + w[1] * sa, u[2] * ca + w[2] * sa];
        const uu = uv[0] + (uv[2] - uv[0]) * (k / seg);
        this.v([p0[0] + n[0] * r0, p0[1] + n[1] * r0, p0[2] + n[2] * r0], n, [uu, uv[3]], col, 0.9, 0, kind);
        this.v([p1[0] + n[0] * r1, p1[1] + n[1] * r1, p1[2] + n[2] * r1], n, [uu, uv[1]], col, 0.9, 0.3 * p1[1] / 10, kind);
      }
      for (let k = 0; k < seg; k++) { const a = base + k * 2; this.i.push(a, a + 2, a + 3, a, a + 3, a + 1); }
    }
    geom() {
      return RM.GLU.sharedGeometry({
        aPos: new Float32Array(this.p), aNormal: new Float32Array(this.n), aUV: new Float32Array(this.u),
        aColor: new Float32Array(this.c), aExtra: new Float32Array(this.x),
      }, this.vc > 65535 ? new Uint32Array(this.i) : new Uint16Array(this.i));
    }
  }

  const sph = (cx, cy, cz) => (p) => RM.v3.norm([0, 0, 0], [p[0] - cx, (p[1] - cy) * 0.8 + 0.3, p[2] - cz]);
  const WHITE = [1, 1, 1];

  // lod = true：遠景簡化版 (同樣的外形與配色，葉片卡片與枝幹大幅減少，降低 GPU 負擔)
  function broadleaf(seed, cellX, lod) {
    const b = new VB(), rnd = RM.rng(seed), fc = F();
    const bark = fc(2, 1);
    b.trunk([0, -0.5, 0], [0.1, 4.2, 0.05], 0.26, 0.16, lod ? 4 : 7, bark, [0.85, 0.8, 0.75]);
    for (let k = 0; k < 4; k++) {
      const a = rnd() * 6.28, h = rnd();
      if (!lod) b.trunk([0.08, 3.0 + k * 0.5, 0], [Math.cos(a) * 2.2, 5.2 + h, Math.sin(a) * 2.2], 0.1, 0.04, 5, bark, [0.85, 0.8, 0.75]);
    }
    const cy = 6.2, leaf = fc(cellX, 0);
    const blobs = [[0, cy, 0, 2.8], [1.4, cy - 0.6, 0.6, 2.0], [-1.3, cy - 0.4, -0.7, 2.1], [0.3, cy + 1.3, -0.4, 1.9], [-0.4, cy - 0.9, 1.4, 1.8]];
    for (const [x, y, z, r] of blobs) {
      let th0 = 0;
      for (let k = 0; k < 5; k++) {
        let th = rnd() * 6.28;
        const ph = (rnd() - 0.3) * 1.2;
        if (k === 0) th0 = th;
        // 簡化版：每團只留兩張互相垂直、放大的卡片
        if (lod) { if (k >= 2) { rnd(); rnd(); continue; } th = th0 + k * 1.5708; }
        const nrm = [Math.cos(th) * Math.cos(ph), Math.sin(ph), Math.sin(th) * Math.cos(ph)];
        const c = [x + nrm[0] * r * 0.45, y + nrm[1] * r * 0.45, z + nrm[2] * r * 0.45];
        const a0 = RM.v3.norm([0, 0, 0], RM.v3.cross([0, 0, 0], nrm, [0, 1, 0.01]));
        const b0 = RM.v3.cross([0, 0, 0], a0, nrm);
        const s = r * (0.9 + rnd() * 0.4) * (lod ? 1.22 : 1);
        const rot = rnd() * 6.28, cr = Math.cos(rot), sr = Math.sin(rot);
        const A = [a0[0] * cr + b0[0] * sr, a0[1] * cr + b0[1] * sr, a0[2] * cr + b0[2] * sr].map((q) => q * s);
        const B = [b0[0] * cr - a0[0] * sr, b0[1] * cr - a0[1] * sr, b0[2] * cr - a0[2] * sr].map((q) => q * s);
        b.card(c, A, B, leaf, WHITE, 1, sph(0, cy, 0));
      }
    }
    return b.geom();
  }

  function conifer(seed, lod) {
    const b = new VB(), rnd = RM.rng(seed), fc = F();
    b.trunk([0, -0.5, 0], [0, 15, 0], 0.3, 0.06, lod ? 4 : 7, fc(2, 1), [0.7, 0.55, 0.45]);
    const leaf = fc(2, 0);
    // 圓錐層：交叉卡片 + 斜卡 (簡化版：3 張交叉卡 + 每層 1 張放大的斜卡)
    const nv = lod ? 3 : 4;
    for (let k = 0; k < nv; k++) {
      const a = (k / nv) * Math.PI + rnd() * 0.2;
      const ax = [Math.cos(a) * 2.6, 0, Math.sin(a) * 2.6];
      b.card([0, 8.6, 0], ax, [0, 6.6, 0], leaf, WHITE, 0.4, (p) => RM.v3.norm([0, 0, 0], [p[0], 0.35, p[2]]));
    }
    for (let y = 4; y < 14; y += 1.6) {
      const r = (15 - y) * 0.26 + 0.3;
      for (let k = 0; k < 3; k++) {
        const a = rnd() * 6.28;
        if (lod && k > 0) continue;
        const rs = lod ? r * 1.35 : r;
        const c = [Math.cos(a) * r * 0.5, y, Math.sin(a) * r * 0.5];
        b.card(c, [Math.cos(a + 1.57) * rs * 0.6, 0, Math.sin(a + 1.57) * rs * 0.6], [Math.cos(a) * rs * 0.5, -0.5, Math.sin(a) * rs * 0.5], leaf, WHITE, 0.4,
          (p) => RM.v3.norm([0, 0, 0], [p[0], 0.6, p[2]]));
      }
    }
    return b.geom();
  }

  function treeFern(seed, lod) {
    const b = new VB(), rnd = RM.rng(seed), fc = F();
    b.trunk([0, -0.3, 0], [0.15, 4.2, 0], 0.16, 0.13, lod ? 4 : 6, fc(2, 1), [0.45, 0.35, 0.28]);
    const leaf = fc(3, 0);
    for (let k = 0; k < 11; k++) {
      const a = (k / 11) * 6.28 + rnd() * 0.3;
      const dir = [Math.cos(a), 0, Math.sin(a)];
      const L = 2.4 + rnd() * 0.6;
      const droop = 0.35 + rnd() * 0.5;
      if (lod && k % 2) continue;   // 簡化版：隔一片留一片，葉片加寬
      const tip = [0.15 + dir[0] * L, 4.2 + 0.6 - droop * L * 0.6, dir[2] * L];
      const mid = [(0.15 + tip[0]) / 2, (4.4 + tip[1]) / 2 + 0.35, tip[2] / 2];
      const wd = lod ? 0.85 : 0.55;
      const side = [-dir[2] * wd, 0, dir[0] * wd];
      const half = [(tip[0] - 0.15) / 2, (tip[1] - 4.4) / 2, tip[2] / 2];
      b.card(mid, side, half, leaf, WHITE, 0.8, () => RM.v3.norm([0, 0, 0], [dir[0] * 0.4, 1, dir[2] * 0.4]));
    }
    return b.geom();
  }

  function betelPalm(seed, lod) {
    const b = new VB(), rnd = RM.rng(seed), fc = F();
    const sg = lod ? 4 : 6;
    b.trunk([0, -0.3, 0], [0, 10.5, 0.05], 0.13, 0.1, sg, fc(2, 2), [1, 1, 1]);
    b.trunk([0, 10.5, 0.05], [0, 11.6, 0.05], 0.12, 0.11, sg, [0.3, 0.3, 0.3, 0.3], [0.35, 0.5, 0.18], 0);
    const leaf = fc(0, 1);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * 6.28 + rnd() * 0.3;
      const dir = [Math.cos(a), 0, Math.sin(a)];
      const L = 2.4 + rnd() * 0.5;
      const up = k < 2 ? 0.9 : 0.2 - rnd() * 0.5;
      if (lod && k >= 2 && k % 2) continue;
      const tip = [dir[0] * L, 11.6 + up * L * 0.6, dir[2] * L + 0.05];
      const mid = [tip[0] / 2, (11.6 + tip[1]) / 2 + 0.3, (0.05 + tip[2]) / 2];
      const wd = lod && k >= 2 ? 1.2 : 0.85;
      const side = [-dir[2] * wd, 0.05, dir[0] * wd];
      const half = [tip[0] / 2, (tip[1] - 11.6) / 2, (tip[2] - 0.05) / 2];
      b.card(mid, side, half, leaf, WHITE, 0.9, () => RM.v3.norm([0, 0, 0], [dir[0] * 0.3, 1, dir[2] * 0.3]));
    }
    return b.geom();
  }

  function bamboo(seed, lod) {
    const b = new VB(), rnd = RM.rng(seed), fc = F();
    const culm = fc(3, 1), leaf = fc(1, 1);
    for (let k = 0; k < 14; k++) {
      const a = rnd() * 6.28, r = rnd() * 0.8;
      const lean = 0.15 + rnd() * 0.35;
      const p0 = [Math.cos(a) * r, -0.3, Math.sin(a) * r];
      const H = 8 + rnd() * 5;
      const p1 = [p0[0] + Math.cos(a) * H * lean, H, p0[2] + Math.sin(a) * H * lean];
      // 簡化版：竹稈只留 5 根 (遠處細到看不見)，每根一張放大的葉卡
      if (!lod || k % 3 === 0) b.trunk(p0, p1, 0.05, 0.025, lod ? 3 : 5, culm, [1, 1, 1]);
      for (let q = 0; q < 3; q++) {
        const t = 0.55 + q * 0.17;
        const c = [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, p0[2] + (p1[2] - p0[2]) * t];
        const ang = rnd() * 6.28;
        if (lod && q !== 1) continue;
        const sc = lod ? 1.55 : 1;
        b.card(c, [Math.cos(ang) * 1.3 * sc, 0, Math.sin(ang) * 1.3 * sc], [Math.cos(a) * 0.4 * sc, 1.1 * sc, Math.sin(a) * 0.4 * sc], leaf, WHITE, 1.2,
          (p) => RM.v3.norm([0, 0, 0], [p[0], 0.8, p[2]]));
      }
    }
    return b.geom();
  }

  function grassTuft(seed) {
    const b = new VB(), rnd = RM.rng(seed), fc = F();
    const leaf = fc(1, 2);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI + rnd() * 0.3;
      b.card([0, 0.55, 0], [Math.cos(a) * 0.7, 0, Math.sin(a) * 0.7], [0, 0.6, 0], leaf, WHITE, 2, () => [0, 1, 0]);
    }
    return b.geom();
  }

  function teaBush(lod) {
    const b = new VB(), fc = F();
    const uv = fc(0, 2);
    // 低多邊形橢球 (半球)
    const seg = lod ? 6 : 10, ring = lod ? 2 : 4;
    const base = b.vc;
    for (let r = 0; r <= ring; r++) {
      const ph = (r / ring) * Math.PI * 0.5;
      for (let k = 0; k <= seg; k++) {
        const th = (k / seg) * 6.2832;
        const n = [Math.cos(th) * Math.cos(ph), Math.sin(ph), Math.sin(th) * Math.cos(ph)];
        b.v([n[0] * 0.7, n[1] * 0.85 - 0.1, n[2] * 0.7], n, [uv[0] + (uv[2] - uv[0]) * (k / seg), uv[1] + (uv[3] - uv[1]) * (r / ring)], [1, 1, 1], 0.8, 0.1, -1);
      }
    }
    for (let r = 0; r < ring; r++) for (let k = 0; k < seg; k++) {
      const a = base + r * (seg + 1) + k, c = a + seg + 1;
      b.i.push(a, c, a + 1, a + 1, c, c + 1);
    }
    return b.geom();
  }

  function paper(sub) {
    const b = new VB(), fc = F();
    const uv = fc(3, 2, sub);
    const base = b.vc;
    const P = [[-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 0, -0.5], [-0.5, 0, -0.5]];
    const UV = [[uv[0], uv[3]], [uv[2], uv[3]], [uv[2], uv[1]], [uv[0], uv[1]]];
    P.forEach((p, k) => b.v(p, [0, 1, 0], UV[k], [1, 1, 1], 0.7, 0, 1));
    b.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return b.geom();
  }

  // 遠方平原建物 (單位方塊 + 斜屋頂)
  function farHouse() {
    const b = new VB();
    const col = [1, 1, 1];
    const faces = [
      [[-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 1, 0.5], [-0.5, 1, 0.5], [0, 0, 1]],
      [[0.5, 0, -0.5], [-0.5, 0, -0.5], [-0.5, 1, -0.5], [0.5, 1, -0.5], [0, 0, -1]],
      [[0.5, 0, 0.5], [0.5, 0, -0.5], [0.5, 1, -0.5], [0.5, 1, 0.5], [1, 0, 0]],
      [[-0.5, 0, -0.5], [-0.5, 0, 0.5], [-0.5, 1, 0.5], [-0.5, 1, -0.5], [-1, 0, 0]],
      [[-0.5, 1, 0.5], [0.5, 1, 0.5], [0.5, 1, -0.5], [-0.5, 1, -0.5], [0, 1, 0]],
    ];
    for (const f of faces) {
      const base = b.vc;
      for (let k = 0; k < 4; k++) b.v(f[k], f[4], [0, 0], col, 0.85, 0, 0);
      b.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    // 屋頂水塔 (小方塊)
    const t = [[0.15, 1, 0.1], [0.35, 1, 0.1], [0.35, 1.12, 0.1], [0.15, 1.12, 0.1]];
    const base = b.vc;
    t.forEach((p) => b.v(p, [0, 0, 1], [0, 0], [0.85, 0.85, 0.9], 0.4, 0, 0));
    b.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return b.geom();
  }

  RM.Trees = {
    build() {
      return {
        broad: [broadleaf(11, 0), broadleaf(12, 1), broadleaf(13, 0)],
        conifer: conifer(21), fern: treeFern(31), betel: betelPalm(41), bamboo: bamboo(51),
        grass: grassTuft(61), tea: teaBush(), paper: [paper(0), paper(1), paper(2), paper(3)], house: farHouse(),
        // 遠景簡化版 (與上面同名同索引；沒有的種類不做 LOD)
        lod: {
          broad: [broadleaf(11, 0, true), broadleaf(12, 1, true), broadleaf(13, 0, true)],
          conifer: conifer(21, true), fern: treeFern(31, true), betel: betelPalm(41, true), bamboo: bamboo(51, true), tea: teaBush(true),
        },
      };
    },
  };
})();
