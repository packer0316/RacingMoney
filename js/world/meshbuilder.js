'use strict';
// 合併靜態網格建構器 (pos / normal / uv / color(rgb+roughness) / extra(metal, emissive, mode, nightOnly))
(function () {
  const RM = window.RM;

  // 材質：{ c:[r,g,b] (linear), r: roughness, m: metal, e: emissive, mode, night }
  function mat(hexOrRgb, r = 0.8, m = 0, mode = 0, e = 0, night = 0) {
    const c = typeof hexOrRgb === 'string' ? RM.srgb(hexOrRgb) : hexOrRgb;
    return { c, r, m, mode, e, night };
  }

  class MeshBuilder {
    constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.x = []; this.i = []; }
    get vcount() { return this.p.length / 3; }
    v(px, py, pz, nx, ny, nz, u, w, M) {
      this.p.push(px, py, pz); this.n.push(nx, ny, nz); this.u.push(u, w);
      this.c.push(M.c[0], M.c[1], M.c[2], M.r); this.x.push(M.m, M.e, M.mode, M.night);
      return this.p.length / 3 - 1;
    }
    tri(a, b, c) { this.i.push(a, b, c); }
    // 四點 (逆時針為正面)，平面法線
    quad(a, b, c, d, M, uv) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      const r = uv || [0, 0, 1, 1];
      // uv: a=左下 (u0,v1)  b=右下 (u1,v1)  c=右上 (u1,v0)  d=左上 (u0,v0)
      const i0 = this.v(a[0], a[1], a[2], nx, ny, nz, r[0], r[3], M);
      const i1 = this.v(b[0], b[1], b[2], nx, ny, nz, r[2], r[3], M);
      const i2 = this.v(c[0], c[1], c[2], nx, ny, nz, r[2], r[1], M);
      const i3 = this.v(d[0], d[1], d[2], nx, ny, nz, r[0], r[1], M);
      this.i.push(i0, i1, i2, i0, i2, i3);
    }
    // 有向方塊：中心 o, 三個半軸向量 ax, ay, az
    boxAxes(o, ax, ay, az, M, uvFront, uvAll) {
      const P = (sx, sy, sz) => [o[0] + ax[0] * sx + ay[0] * sy + az[0] * sz, o[1] + ax[1] * sx + ay[1] * sy + az[1] * sz, o[2] + ax[2] * sx + ay[2] * sy + az[2] * sz];
      const uv = uvAll || null;
      // +z 面 (front)
      this.quad(P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), M, uvFront || uv);
      this.quad(P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), M, uv);
      this.quad(P(1, -1, 1), P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), M, uv);
      this.quad(P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1), M, uv);
      this.quad(P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), P(-1, 1, -1), M, uv);
      this.quad(P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1), M, uv);
    }
    // 方塊：中心、尺寸 (w,h,d)、繞 y 旋轉 yaw
    box(cx, cy, cz, w, h, d, yaw, M, uvFront, uvAll) {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      this.boxAxes([cx, cy, cz], [c * w / 2, 0, -s * w / 2], [0, h / 2, 0], [s * d / 2, 0, c * d / 2], M, uvFront, uvAll);
    }
    // 圓柱/圓錐 (p0 -> p1)
    cyl(p0, p1, r0, r1, seg, M, caps = true, uv) {
      const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
      const L = Math.hypot(dx, dy, dz) || 1;
      const ax = [dx / L, dy / L, dz / L];
      let tmp = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const u = RM.v3.norm([0, 0, 0], RM.v3.cross([0, 0, 0], ax, tmp));
      const w = RM.v3.cross([0, 0, 0], ax, u);
      const base = this.vcount;
      const slope = (r0 - r1) / L;
      const r = uv || [0, 0, 1, 1];
      for (let k = 0; k <= seg; k++) {
        const a = (k / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const nx = u[0] * ca + w[0] * sa, ny = u[1] * ca + w[1] * sa, nz = u[2] * ca + w[2] * sa;
        const nl = Math.hypot(1, slope);
        const NX = (nx + ax[0] * slope) / nl, NY = (ny + ax[1] * slope) / nl, NZ = (nz + ax[2] * slope) / nl;
        const uu = r[0] + (r[2] - r[0]) * (k / seg);
        this.v(p0[0] + nx * r0, p0[1] + ny * r0, p0[2] + nz * r0, NX, NY, NZ, uu, r[3], M);
        this.v(p1[0] + nx * r1, p1[1] + ny * r1, p1[2] + nz * r1, NX, NY, NZ, uu, r[1], M);
      }
      for (let k = 0; k < seg; k++) {
        const a = base + k * 2;
        this.i.push(a, a + 2, a + 3, a, a + 3, a + 1);
      }
      if (caps) {
        for (const [p, rr, sg] of [[p1, r1, 1], [p0, r0, -1]]) {
          if (rr <= 0) continue;
          const c = this.v(p[0], p[1], p[2], ax[0] * sg, ax[1] * sg, ax[2] * sg, 0.5, 0.5, M);
          const b = this.vcount;
          for (let k = 0; k <= seg; k++) {
            const a = (k / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
            this.v(p[0] + (u[0] * ca + w[0] * sa) * rr, p[1] + (u[1] * ca + w[1] * sa) * rr, p[2] + (u[2] * ca + w[2] * sa) * rr, ax[0] * sg, ax[1] * sg, ax[2] * sg, 0.5, 0.5, M);
          }
          for (let k = 0; k < seg; k++) sg > 0 ? this.i.push(c, b + k, b + k + 1) : this.i.push(c, b + k + 1, b + k);
        }
      }
    }
    // 以路徑擠出斷面 (profile: [[x,y],...] 在 (right, up) 平面；path: [{p, r(右向量)}])
    extrude(path, profile, M, closed = false) {
      const base = this.vcount, np = profile.length;
      for (let k = 0; k < path.length; k++) {
        const { p, r } = path[k];
        for (let j = 0; j < np; j++) {
          const [x, y] = profile[j];
          // 斷面法線：相鄰點差的垂直
          const a = profile[Math.max(j - 1, 0)], b = profile[Math.min(j + 1, np - 1)];
          let ex = b[0] - a[0], ey = b[1] - a[1];
          const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;
          const nxl = ey, nyl = -ex; // (right,up) 平面中的法線
          this.v(p[0] + r[0] * x, p[1] + y, p[2] + r[2] * x, r[0] * nxl, nyl, r[2] * nxl, k * 0.5, j / (np - 1), M);
        }
      }
      for (let k = 0; k < path.length - 1; k++) for (let j = 0; j < np - 1; j++) {
        const a = base + k * np + j, b = a + 1, c = a + np, d = c + 1;
        this.i.push(a, c, d, a, d, b);
      }
    }
    merge(o) {
      const off = this.vcount;
      this.p.push(...o.p); this.n.push(...o.n); this.u.push(...o.u); this.c.push(...o.c); this.x.push(...o.x);
      for (const k of o.i) this.i.push(k + off);
    }
    // 套用變換 (只影響目前已加入的頂點中 from 之後的)
    transform(from, fn) {
      const p = this.p, n = this.n;
      for (let k = from; k < this.vcount; k++) {
        const r = fn([p[k * 3], p[k * 3 + 1], p[k * 3 + 2]], [n[k * 3], n[k * 3 + 1], n[k * 3 + 2]]);
        p[k * 3] = r[0][0]; p[k * 3 + 1] = r[0][1]; p[k * 3 + 2] = r[0][2];
        n[k * 3] = r[1][0]; n[k * 3 + 1] = r[1][1]; n[k * 3 + 2] = r[1][2];
      }
    }
    empty() { return this.i.length === 0; }
    arrays() {
      const vc = this.vcount;
      return {
        aPos: new Float32Array(this.p), aNormal: new Float32Array(this.n), aUV: new Float32Array(this.u),
        aColor: new Float32Array(this.c), aExtra: new Float32Array(this.x),
        index: vc > 65535 ? new Uint32Array(this.i) : new Uint16Array(this.i),
      };
    }
    // 依三角形重心落在哪個 size x size 公尺的方格，切成好幾個網格 (各自有 bounds)。
    // 很大的靜態場景 (熱浪夏威夷整座島) 分塊後，看不到的塊不必畫、也不必畫進陰影貼圖
    buildTiles(size) {
      const tiles = new Map(), P = this.p, N = this.n, U = this.u, C = this.c, X = this.x, I = this.i;
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t], b = I[t + 1], c = I[t + 2];
        const cx = (P[a * 3] + P[b * 3] + P[c * 3]) / 3, cz = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3;
        const key = (Math.floor(cx / size) + 4096) * 8192 + Math.floor(cz / size) + 4096;
        let T = tiles.get(key);
        if (!T) tiles.set(key, (T = { map: new Map(), mb: new MeshBuilder() }));
        const m = T.mb;
        for (const v of [a, b, c]) {
          let k = T.map.get(v);
          if (k === undefined) {
            k = m.p.length / 3;
            T.map.set(v, k);
            m.p.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); m.n.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
            m.u.push(U[v * 2], U[v * 2 + 1]);
            m.c.push(C[v * 4], C[v * 4 + 1], C[v * 4 + 2], C[v * 4 + 3]); m.x.push(X[v * 4], X[v * 4 + 1], X[v * 4 + 2], X[v * 4 + 3]);
          }
          m.i.push(k);
        }
      }
      return [...tiles.values()].map((T) => T.mb.build());
    }
    build() {
      if (this.empty()) return null;
      const a = this.arrays();
      const idx = a.index; delete a.index;
      const m = RM.GLU.mesh(a, idx);
      // bounding sphere
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let k = 0; k < this.p.length; k += 3) {
        const x = this.p[k], y = this.p[k + 1], z = this.p[k + 2];
        if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z; if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
      }
      m.bounds = [x0, y0, z0, x1, y1, z1];
      return m;
    }
  }

  RM.MeshBuilder = MeshBuilder;
  RM.mat = mat;
})();
