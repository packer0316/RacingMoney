'use strict';
// 真實地形高程 (AWS Terrain Tiles / SRTM) 25 m 網格
(function () {
  const RM = window.RM;

  class Heightmap {
    static async load(d) {
      const bytes = RM.b64ToBytes(d.data);
      const ds = new DecompressionStream('deflate');
      const stream = new Blob([bytes]).stream().pipeThrough(ds);
      const buf = await new Response(stream).arrayBuffer();
      const dq = new Int16Array(buf);
      const h = new Float32Array(d.nx * d.nz);
      for (let j = 0; j < d.nz; j++) {
        let acc = 0;
        const o = j * d.nx;
        for (let i = 0; i < d.nx; i++) { acc += dq[o + i]; h[o + i] = acc * d.scale; }
      }
      return new Heightmap(d, h);
    }
    constructor(d, h) {
      this.x0 = d.x0; this.z0 = d.z0; this.sp = d.spacing; this.nx = d.nx; this.nz = d.nz; this.h = h;
      this.x1 = this.x0 + (this.nx - 1) * this.sp;
      this.z1 = this.z0 + (this.nz - 1) * this.sp;
    }
    at(i, j) {
      i = i < 0 ? 0 : i >= this.nx ? this.nx - 1 : i;
      j = j < 0 ? 0 : j >= this.nz ? this.nz - 1 : j;
      return this.h[j * this.nx + i];
    }
    // 雙線性
    sample(x, z) {
      const gx = (x - this.x0) / this.sp, gz = (z - this.z0) / this.sp;
      const i = Math.floor(gx), j = Math.floor(gz);
      const fx = gx - i, fz = gz - j;
      const a = this.at(i, j), b = this.at(i + 1, j), c = this.at(i, j + 1), d = this.at(i + 1, j + 1);
      return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
    }
    // Catmull-Rom 雙三次 (平滑，避免 25 m 網格折痕)
    sampleSmooth(x, z) {
      const gx = (x - this.x0) / this.sp, gz = (z - this.z0) / this.sp;
      const i = Math.floor(gx), j = Math.floor(gz);
      const fx = gx - i, fz = gz - j;
      const cr = (p0, p1, p2, p3, t) =>
        p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
      const r = [0, 0, 0, 0];
      for (let k = -1; k <= 2; k++) {
        r[k + 1] = cr(this.at(i - 1, j + k), this.at(i, j + k), this.at(i + 1, j + k), this.at(i + 2, j + k), fx);
      }
      return cr(r[0], r[1], r[2], r[3], fz);
    }
    // 自然地形 + 細部起伏
    natural(x, z) {
      let h = this.sampleSmooth(x, z);
      const amp = RM.smoothstep(4, 40, h);
      h += ((RM.fbm(x / 70, z / 70, 3, 7) - 0.5) * 5.0 + (RM.vnoise(x / 11, z / 11, 3) - 0.5) * 1.1) * amp;
      return h;
    }
  }
  RM.Heightmap = Heightmap;
})();
