'use strict';
// 分塊 LOD 地形：500 m 方塊 (6.25 / 12.5 / 25 / 50 m 網格) + 2 km 遠景方塊 (100 / 200 m 網格)
// 方塊小、分級多 → 高解析度網格只鋪在相機周圍，遠處三角形數大幅減少 (內顯的瓶頸是三角形數與細長三角形的重複著色)
(function () {
  const RM = window.RM;
  const T = 500;
  const LOD_SP = [6.25, 12.5, 25, 50];
  const NL = LOD_SP.length;
  const SUPER = 4;                    // 遠景方塊 = 4 x 4 個方塊 (2 km)
  const SUPER_SP = [100, 200];
  // 各級網格使用到的距離 (公尺，相機到方塊邊界)；最後一級固定 (道路網格畫到 2.6 km，這個範圍內的地形都要挖好路基)
  const BASE_DIST = [400, 900, 1700, 2800];
  const PRELOAD = 350;                // 提前建置的緩衝距離
  const SUPER_FAR = 7000;             // 超過這個距離的遠景方塊改用 200 m 網格

  class Terrain {
    constructor(hm, road) {
      this.hm = hm; this.road = road;
      this.ox = Math.floor(hm.x0 / T) * T; this.oz = Math.floor(hm.z0 / T) * T;
      this.nx = Math.ceil((hm.x1 - this.ox) / T); this.nz = Math.ceil((hm.z1 - this.oz) / T);
      this.snx = Math.ceil(this.nx / SUPER); this.snz = Math.ceil(this.nz / SUPER);
      this.lodDist = BASE_DIST.slice();
      this.supers = [];
      for (let sj = 0; sj < this.snz; sj++) for (let si = 0; si < this.snx; si++) {
        const s = { si, sj, x0: this.ox + si * SUPER * T, z0: this.oz + sj * SUPER * T, meshes: [null, null], ymin: 0, ymax: 0, tiles: [], live: 0, near: false, dist: 0 };
        for (let j = sj * SUPER; j < Math.min((sj + 1) * SUPER, this.nz); j++) for (let i = si * SUPER; i < Math.min((si + 1) * SUPER, this.nx); i++) {
          s.tiles.push({ i, j, x0: this.ox + i * T, z0: this.oz + j * T, meshes: new Array(NL).fill(null), want: NL, building: -1, gen: null, ymin: 0, ymax: 0, dist: 0, sup: s });
        }
        this.supers.push(s);
      }
      this.cur = null;
      this.cx = 0; this.cz = 0;
      this._co = {};
    }

    // 細緻度：scale 乘在近處各級的切換距離上 (畫質越高，高解析度網格鋪得越遠)
    setDetail(scale) {
      for (let l = 0; l < NL - 1; l++) this.lodDist[l] = Math.min(BASE_DIST[l] * scale, BASE_DIST[NL - 1] - (NL - 1 - l) * 150);
      this.lodDist[NL - 1] = BASE_DIST[NL - 1];
    }

    // 遠景方塊 (載入時建立，不挖路基)
    buildSupers(progress) {
      const hf = (x, z) => this.hm.sampleSmooth(x, z);
      for (let k = 0; k < this.supers.length; k++) {
        const s = this.supers[k];
        for (let l = 0; l < SUPER_SP.length; l++) {
          const sp = SUPER_SP[l], n = (SUPER * T) / sp + 1;
          const m = this._gridMesh(s.x0, s.z0, sp, n, hf, sp * 0.35);
          s.meshes[l] = m.mesh;
          if (l === 0) { s.ymin = m.ymin - 40; s.ymax = m.ymax; }
        }
        if (progress) progress(k / this.supers.length);
      }
    }

    _gridMesh(x0, z0, sp, n, hfn, skirt) {
      const H = new Float32Array((n + 2) * (n + 2));
      for (let j = -1; j <= n; j++) for (let i = -1; i <= n; i++) H[(j + 1) * (n + 2) + (i + 1)] = hfn(x0 + i * sp, z0 + j * sp);
      return this._finish(x0, z0, sp, n, H, null, skirt);
    }

    _finish(x0, z0, sp, n, H, E, skirt) {
      const nv = n * n + 4 * n;
      const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), ext = new Float32Array(nv * 4);
      let ymin = Infinity, ymax = -Infinity;
      const W = n + 2;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const v = j * n + i;
        const h = H[(j + 1) * W + (i + 1)];
        pos[v * 3] = x0 + i * sp; pos[v * 3 + 1] = h; pos[v * 3 + 2] = z0 + j * sp;
        const hl = H[(j + 1) * W + i], hr = H[(j + 1) * W + i + 2], hu = H[j * W + i + 1], hd = H[(j + 2) * W + i + 1];
        const nx = (hl - hr) / (2 * sp), nz = (hu - hd) / (2 * sp);
        const l = Math.hypot(nx, 1, nz);
        nrm[v * 3] = nx / l; nrm[v * 3 + 1] = 1 / l; nrm[v * 3 + 2] = nz / l;
        if (E) { ext[v * 4] = E[v * 2]; ext[v * 4 + 1] = E[v * 2 + 1]; }
        if (h < ymin) ymin = h; if (h > ymax) ymax = h;
      }
      const ni = (n - 1) * (n - 1) * 6 + 4 * (n - 1) * 6;
      const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
      let q = 0;
      for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
      }
      // 裙邊：遮住不同解析度方塊交界的縫，只需朝外的一面 (地形開背面剔除)
      // 四邊依序：北 (j=0)、南、西 (i=0)、東；flip = 三角形繞序是否反轉
      let sv = n * n;
      for (let e = 0; e < 4; e++) {
        const start = sv, flip = e === 1 || e === 2;
        for (let k = 0; k < n; k++) {
          const v = e === 0 ? k : e === 1 ? (n - 1) * n + k : e === 2 ? k * n : k * n + n - 1;
          pos[sv * 3] = pos[v * 3]; pos[sv * 3 + 1] = pos[v * 3 + 1] - skirt; pos[sv * 3 + 2] = pos[v * 3 + 2];
          nrm[sv * 3] = nrm[v * 3]; nrm[sv * 3 + 1] = nrm[v * 3 + 1]; nrm[sv * 3 + 2] = nrm[v * 3 + 2];
          ext[sv * 4] = ext[v * 4]; ext[sv * 4 + 1] = ext[v * 4 + 1];
          sv++;
        }
        for (let k = 0; k < n - 1; k++) {
          const a = e === 0 ? k : e === 1 ? (n - 1) * n + k : e === 2 ? k * n : k * n + n - 1;
          const b = e === 0 ? k + 1 : e === 1 ? (n - 1) * n + k + 1 : e === 2 ? (k + 1) * n : (k + 1) * n + n - 1;
          const c = start + k, d = start + k + 1;
          if (flip) { idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d; }
          else { idx[q++] = a; idx[q++] = b; idx[q++] = c; idx[q++] = b; idx[q++] = d; idx[q++] = c; }
        }
      }
      const mesh = RM.GLU.mesh({ aPos: pos, aNormal: nrm, aExtra: ext }, idx);
      return { mesh, ymin: ymin - skirt, ymax };
    }

    // 近景方塊產生器 (分幀執行；挖填道路路基)
    *_tileGen(t, lod) {
      const sp = LOD_SP[lod], n = Math.round(T / sp) + 1;
      const W = n + 2;
      const H = new Float32Array(W * W), E = new Float32Array(n * n * 2);
      const co = this._co, road = this.road;
      let cnt = 0;
      for (let j = -1; j <= n; j++) {
        for (let i = -1; i <= n; i++) {
          const x = t.x0 + i * sp, z = t.z0 + j * sp;
          road.carved(x, z, sp, co);
          H[(j + 1) * W + (i + 1)] = co.h;
          if (i >= 0 && j >= 0 && i < n && j < n) {
            const v = j * n + i;
            E[v * 2] = co.prox; E[v * 2 + 1] = co.nat - co.h;
          }
        }
        cnt += n;
        if (cnt > 1500) { cnt = 0; yield 0; }
      }
      const r = this._finish(t.x0, t.z0, sp, n, H, E, sp * 0.6 + 2);
      if (!t.meshes[lod]) t.sup.live++;
      t.meshes[lod] = r.mesh;
      if (!(t.ymax > t.ymin) || lod === 0) { t.ymin = r.ymin; t.ymax = r.ymax; }
      else { t.ymin = Math.min(t.ymin, r.ymin); t.ymax = Math.max(t.ymax, r.ymax); }
    }

    _dist(x0, z0, size, cx, cz) {
      const dx = Math.max(x0 - cx, 0, cx - (x0 + size)), dz = Math.max(z0 - cz, 0, cz - (z0 + size));
      return Math.hypot(dx, dz);
    }

    // 這個方塊現在該建哪一級 (-1 = 不需要)
    _need(t) {
      if (t.want < NL) return t.meshes[t.want] ? -1 : t.want;
      if (t.sup.near) { for (let l = 0; l < NL; l++) if (t.meshes[l]) return -1; return NL - 1; }
      return -1;
    }

    _pick() {
      let best = null, bl = -1, bp = Infinity;
      for (const s of this.supers) {
        if (!s.near) continue;
        for (const t of s.tiles) {
          const lod = this._need(t);
          if (lod < 0) continue;
          // 近的先建；同距離先建粗的 (快，先有東西可畫)
          const pr = t.dist - lod * 60;
          if (pr < bp) { bp = pr; best = t; bl = lod; }
        }
      }
      if (best) { this.cur = [best, bl]; best.building = bl; best.gen = this._tileGen(best, bl); }
      return !!best;
    }

    // 每幀：決定各方塊的 LOD、釋放用不到的網格、在時間預算內建置
    update(cx, cz, budgetMs, force) {
      const t0 = performance.now();
      this.cx = cx; this.cz = cz;
      const LD = this.lodDist, far = LD[NL - 1], ST = SUPER * T;
      for (const s of this.supers) {
        s.dist = this._dist(s.x0, s.z0, ST, cx, cz);
        const near = s.dist < far + PRELOAD;
        if (!near && !s.near && !s.live) continue; // 遠處且沒有任何網格：整塊跳過
        s.near = near;
        for (const t of s.tiles) {
          const d = this._dist(t.x0, t.z0, T, cx, cz);
          t.dist = d;
          let want = NL;
          for (let l = 0; l < NL; l++) if (d < LD[l]) { want = l; break; }
          t.want = want;
          // 釋放：比需要的細兩級以上的網格；整個遠景方塊都離開範圍時全部釋放
          for (let l = 0; l < NL; l++) {
            if (t.meshes[l] && t.building !== l && (l < want - 1 || !near)) { RM.GLU.deleteMesh(t.meshes[l]); t.meshes[l] = null; s.live--; }
          }
        }
      }
      if (!this.cur) this._pick();
      while (this.cur && (force || performance.now() - t0 < budgetMs)) {
        const t = this.cur[0];
        const r = t.gen.next();
        if (r.done) {
          t.building = -1; t.gen = null; this.cur = null;
          if (force) return false;
          this._pick();
        }
      }
      return !!this.cur;
    }

    // 是否還有待建 (載入時使用)
    pending() {
      if (this.cur) return true;
      for (const s of this.supers) {
        if (!s.near) continue;
        for (const t of s.tiles) if (this._need(t) >= 0) return true;
      }
      return false;
    }

    // 收集可繪製 mesh (由近到遠排序，讓近處地形先寫入深度、遠處被擋住的像素提早剔除)
    collect(planes, out) {
      out.length = 0;
      const ST = SUPER * T;
      const list = (this._list = this._list || []);
      list.length = 0;
      for (const s of this.supers) {
        let useTiles = s.near;
        if (useTiles) {
          for (const t of s.tiles) {
            let any = false;
            for (let l = 0; l < NL; l++) if (t.meshes[l]) { any = true; break; }
            if (!any) { useTiles = false; break; }
          }
        }
        if (!useTiles) {
          if (RM.aabbVisible(planes, s.x0, s.ymin, s.z0, s.x0 + ST, s.ymax, s.z0 + ST)) {
            const m = s.meshes[s.dist > SUPER_FAR ? 1 : 0];
            m._d = s.dist + 1e5; list.push(m);
          }
          continue;
        }
        for (const t of s.tiles) {
          // 優先用想要的那一級，沒有就用較粗的，再沒有才用較細的
          const w = Math.min(t.want, NL - 1);
          let m = null;
          for (let l = w; l < NL && !m; l++) m = t.meshes[l];
          for (let l = w - 1; l >= 0 && !m; l--) m = t.meshes[l];
          if (!m) continue;
          if (RM.aabbVisible(planes, t.x0, t.ymin - 5, t.z0, t.x0 + T, t.ymax + 5, t.z0 + T)) { m._d = t.dist; list.push(m); }
        }
      }
      list.sort((a, b) => a._d - b._d);
      for (const m of list) out.push(m);
      return out;
    }
  }

  RM.Terrain = Terrain;
})();
