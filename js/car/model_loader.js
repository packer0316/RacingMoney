'use strict';
// 以 three.js (GLTFLoader / DRACOLoader) 載入公開的 glTF 汽車模型，轉換成本引擎的網格 (共用陰影/霧/光照)
(function () {
  const RM = window.RM;
  // three.js r160 隨遊戲附帶在 vendor/three/ (上架平台不能依賴外部 CDN)。
  // 只有直接開 index.html (file://) 時，瀏覽器不允許載入本機的 ES module，才改從 CDN 載入。
  const LOCAL_THREE = 'vendor/three/three.module.min.js', LOCAL_GLTF = 'vendor/three/GLTFLoader.js';
  const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
  const GLTF_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js/+esm';
  const DRACO_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/DRACOLoader.js/+esm';
  const DRACO_DECODER = 'https://www.gstatic.com/draco/versioned/decoders/1.5.6/';

  // ---------------------------------------------------------------- 車款目錄
  // 玩家車款全部是程序化模型 (js/car/proc_car.js + 各車款檔)，不需要 three.js
  const PLAYER_CARS = [
    { id: 'k8', name: '喜美 K8 1.6 自排', sub: 'Honda Civic 6 代・D16 VTEC 125 PS・4AT・前驅', model: null, paintable: true, credit: '本作程序化模型' },
    { id: 'gr86', name: 'Toyota GR86', sub: '2.4 水平對臥 235 PS・6AT・後驅', model: null, paintable: true, credit: '本作程序化模型' },
    { id: 'ae86', name: 'Toyota Sprinter Trueno AE86', sub: '4A-GE 1.6 雙凸輪 130 PS・5 速・後驅', model: null, paintable: true, credit: '本作程序化模型' },
    { id: 'r34', name: 'Nissan Skyline GT-R R34', sub: 'RB26DETT 2.6 雙渦輪 280 PS・6 速・四驅', model: null, paintable: true, credit: '本作程序化模型' },
    { id: 'r35', name: 'Nissan GT-R R35', sub: 'VR38DETT 3.8 V6 雙渦輪 570 PS・6 速雙離合・四驅', model: null, paintable: true, credit: '本作程序化模型' },
    { id: 'p911', name: 'Porsche 911 Carrera RS 2.7', sub: '2.7 水平對臥六缸 210 PS・5 速・後置後驅', model: null, paintable: true, credit: '本作程序化模型' },
  ];

  // 路上車流 (Kenney)
  const TRAFFIC = [
    { key: 'sedan', model: 'kenney/sedan', dims: [4.5, 1.78, 1.45], mass: 1250, vmax: [52, 72], alat: 2.6, acc: 1.8, w: 14 },
    { key: 'sedan-sports', model: 'kenney/sedan-sports', dims: [4.65, 1.82, 1.42], mass: 1450, vmax: [58, 78], alat: 3.0, acc: 2.2, w: 4 },
    { key: 'hatchback', model: 'kenney/hatchback-sports', dims: [4.1, 1.78, 1.45], mass: 1250, vmax: [55, 75], alat: 2.8, acc: 2.0, w: 5 },
    { key: 'suv', model: 'kenney/suv', dims: [4.6, 1.85, 1.75], mass: 1700, vmax: [50, 68], alat: 2.3, acc: 1.6, w: 8 },
    { key: 'suv-luxury', model: 'kenney/suv-luxury', dims: [4.9, 1.95, 1.72], mass: 2100, vmax: [52, 70], alat: 2.4, acc: 1.8, w: 3 },
    { key: 'taxi', model: 'kenney/taxi', dims: [4.6, 1.78, 1.52], mass: 1350, vmax: [55, 75], alat: 2.8, acc: 1.9, w: 7 },
    { key: 'van', model: 'kenney/van', dims: [4.8, 1.8, 1.95], mass: 1800, vmax: [48, 62], alat: 2.0, acc: 1.4, w: 6 },
    { key: 'police', model: 'kenney/police', dims: [4.85, 1.85, 1.5], mass: 1700, vmax: [55, 75], alat: 2.8, acc: 2.0, w: 2 },
    { key: 'truck', model: 'kenney/truck', dims: [5.2, 1.9, 2.1], mass: 2300, vmax: [45, 60], alat: 1.9, acc: 1.2, w: 5 },
    { key: 'truck-flat', model: 'kenney/truck-flat', dims: [5.2, 1.9, 2.0], mass: 2200, vmax: [45, 60], alat: 1.9, acc: 1.2, w: 3 },
    { key: 'delivery', model: 'kenney/delivery', dims: [5.6, 2.0, 2.6], mass: 3200, vmax: [42, 56], alat: 1.7, acc: 1.0, w: 3 },
    { key: 'ambulance', model: 'kenney/ambulance', dims: [5.6, 2.0, 2.6], mass: 3200, vmax: [55, 75], alat: 2.0, acc: 1.4, w: 1 },
    { key: 'garbage-truck', model: 'kenney/garbage-truck', dims: [7.2, 2.4, 3.1], mass: Infinity, vmax: [35, 48], alat: 1.4, acc: 0.7, w: 2, big: true },
    { key: 'firetruck', model: 'kenney/firetruck', dims: [8.0, 2.45, 3.1], mass: Infinity, vmax: [40, 55], alat: 1.4, acc: 0.8, w: 1, big: true },
  ];

  const CM = {
    ready: false, failed: false, assets: {}, PLAYER_CARS, TRAFFIC, error: null,

    async init(progress) {
      try {
        let T, G, D = null;
        if (location.protocol !== 'file:') {
          const at = (f) => new URL(f, document.baseURI).href;
          [T, G] = await Promise.all([import(at(LOCAL_THREE)), import(at(LOCAL_GLTF))]);
        } else [T, G, D] = await Promise.all([import(THREE_URL), import(GLTF_URL), import(DRACO_URL)]);
        this.T = T;
        const manager = new T.LoadingManager();
        const cmURL = 'data:image/png;base64,' + RM_DATA.cars['kenney/colormap.png'];
        manager.setURLModifier((url) => (/colormap\.png$/i.test(url) ? cmURL : url));
        const loader = new G.GLTFLoader(manager);
        // 內建的 Kenney 模型沒有用 Draco 壓縮；有載到 DRACOLoader 才掛上
        const draco = D ? new D.DRACOLoader() : null;
        if (draco) { draco.setDecoderPath(DRACO_DECODER); loader.setDRACOLoader(draco); }
        const jobs = [];
        for (const c of PLAYER_CARS) if (c.model) jobs.push({ key: c.model, cfg: c });
        for (const t of TRAFFIC) jobs.push({ key: t.model, cfg: Object.assign({ forward: '+z' }, t), traffic: true });
        const parsed = {};
        let done = 0;
        for (const j of jobs) {
          const cacheKey = j.key + '|' + (j.cfg.dims ? j.cfg.dims.join(',') : '') + (j.traffic ? '|t' : '');
          if (this.assets[cacheKey]) continue;
          if (!parsed[j.key]) parsed[j.key] = await this._parse(loader, RM_DATA.cars[j.key]);
          const asset = this._extract(parsed[j.key].scene, j.cfg, j.traffic);
          asset.cfg = j.cfg;
          this.assets[cacheKey] = asset;
          if (j.traffic) this.assets['traffic:' + j.cfg.key] = asset; else this.assets['player:' + j.cfg.id] = asset;
          done++;
          if (progress) progress(done / jobs.length);
        }
        if (draco) draco.dispose();
        this.ready = true;
      } catch (e) {
        console.warn('three.js 車輛模型載入失敗：', e);
        this.failed = true; this.error = e;
      }
      return this.ready;
    },

    _parse(loader, b64) {
      const bytes = RM.b64ToBytes(b64);
      return new Promise((res, rej) => loader.parse(bytes.buffer, '', res, rej));
    },

    // 轉換：統一為 x 右 / y 上 / -z 車頭，地面 y = 0，並縮放到真實尺寸
    _extract(root, cfg, traffic) {
      const T = this.T;
      root.updateMatrixWorld(true);
      const R = new T.Matrix4();
      if (cfg.forward === '+z') R.makeRotationY(Math.PI);
      // 收集 mesh 與所屬車輪節點
      const items = [];
      root.traverse((o) => {
        if (!o.isMesh) return;
        let wheel = null;
        for (let p = o; p; p = p.parent) if (/wheel/i.test(p.name || '') && p !== root) wheel = p;
        items.push({ o, wheel });
      });
      // 整車外框 (旋轉後)
      const box = new T.Box3(), tmpBox = new T.Box3();
      const Mw = new T.Matrix4();
      for (const it of items) {
        it.o.geometry.computeBoundingBox();
        tmpBox.copy(it.o.geometry.boundingBox).applyMatrix4(Mw.multiplyMatrices(R, it.o.matrixWorld));
        box.union(tmpBox);
      }
      const size = new T.Vector3(), ctr = new T.Vector3();
      box.getSize(size); box.getCenter(ctr);
      let sx = 1, sy = 1, sz = 1;
      if (cfg.dims) {
        if (cfg.uniform) { const s = cfg.dims[0] / size.z; sx = sy = sz = s; }
        else { sz = cfg.dims[0] / size.z; sx = cfg.dims[1] / size.x; sy = cfg.dims[2] / size.y; }
      }
      const N = new T.Matrix4().makeScale(sx, sy, sz).multiply(new T.Matrix4().makeTranslation(-ctr.x, -box.min.y, -ctr.z)).multiply(R);
      // 車輪群組
      const wheelGroups = new Map();
      for (const it of items) if (it.wheel) {
        if (!wheelGroups.has(it.wheel)) wheelGroups.set(it.wheel, { node: it.wheel, items: [], box: new T.Box3() });
        const g = wheelGroups.get(it.wheel);
        g.items.push(it);
        tmpBox.copy(it.o.geometry.boundingBox).applyMatrix4(Mw.multiplyMatrices(R, it.o.matrixWorld));
        g.box.union(tmpBox);
      }
      const sw = cfg.uniform || !cfg.dims ? sx : Math.sqrt(sy * sz) * 0.88;
      const wheels = [];
      for (const g of wheelGroups.values()) {
        const c = new T.Vector3(), sz3 = new T.Vector3();
        g.box.getCenter(c); g.box.getSize(sz3);
        const r = (sz3.y / 2) * sw;
        const pos = [(c.x - ctr.x) * sx, r, (c.z - ctr.z) * sz];
        const W = new T.Matrix4().makeScale(sw, sw, sw).multiply(new T.Matrix4().makeTranslation(-c.x, -c.y, -c.z)).multiply(R);
        wheels.push({ pos, r, M: W, items: g.items });
      }
      const bodyItems = items.filter((it) => !it.wheel);
      const out = { parts: [], glass: [], wheels: [], merged: null, dims: null };
      if (traffic || wheels.length < 4) {
        // 車流：整車合併為單一網格 (車輪不轉)
        const all = bodyItems.map((it) => ({ o: it.o, M: N }));
        for (const w of wheels) for (const it of w.items) {
          const off = new T.Matrix4().makeTranslation(w.pos[0], w.pos[1], w.pos[2]).multiply(w.M);
          all.push({ o: it.o, M: off });
        }
        const g = this._build(all, cfg, false);
        out.parts = g.parts; out.glass = g.glass;
      } else {
        const g = this._build(bodyItems.map((it) => ({ o: it.o, M: N })), cfg, false);
        out.parts = g.parts; out.glass = g.glass;
        // 依位置排序：FL, FR, RL, RR (前 = z 小、左 = x 小)
        wheels.sort((a, b) => a.pos[2] - b.pos[2]);
        const front = wheels.slice(0, 2).sort((a, b) => a.pos[0] - b.pos[0]);
        const rear = wheels.slice(2, 4).sort((a, b) => a.pos[0] - b.pos[0]);
        for (const w of [front[0], front[1], rear[0], rear[1]]) {
          const g2 = this._build(w.items.map((it) => ({ o: it.o, M: w.M })), cfg, true);
          out.wheels.push({ pos: w.pos, r: w.r, parts: g2.parts });
        }
      }
      // 尺寸 (供物理使用)
      const L = size.z * sz, Wd = size.x * sx, H = size.y * sy;
      if (out.wheels.length === 4) {
        const ws = out.wheels;
        out.dims = {
          L, W: Wd, H, minZ: -L / 2, maxZ: L / 2, clear: 0.15,
          zF: (ws[0].pos[2] + ws[1].pos[2]) / 2, zR: (ws[2].pos[2] + ws[3].pos[2]) / 2,
          trackF: Math.abs(ws[1].pos[0] - ws[0].pos[0]), trackR: Math.abs(ws[3].pos[0] - ws[2].pos[0]),
          tireR: (ws[0].r + ws[1].r + ws[2].r + ws[3].r) / 4,
        };
      } else out.dims = { L, W: Wd, H, minZ: -L / 2, maxZ: L / 2 };
      return out;
    },

    // 由 three.js mesh 建立本引擎的網格 (依材質分組：一般/貼圖/玻璃)
    _build(list, cfg, isWheel) {
      const T = this.T;
      const groups = new Map();
      const nm = new T.Matrix3(), v = new T.Vector3(), n = new T.Vector3();
      for (const { o, M } of list) {
        const geo = o.geometry;
        const W = new T.Matrix4().multiplyMatrices(M, o.matrixWorld);
        nm.getNormalMatrix(W);
        const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
        const idx = geo.index;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const ranges = geo.groups && geo.groups.length ? geo.groups : [{ start: 0, count: idx ? idx.count : pos.count, materialIndex: 0 }];
        for (const rg of ranges) {
          const mat = mats[rg.materialIndex || 0] || mats[0];
          const name = (mat.name || '') + ' ' + (o.name || '');
          let kind = 'opaque';
          if (/glass/i.test(name) && !/taillight/i.test(name)) kind = 'glass';
          const tex = mat.map && mat.map.image ? mat.map : null;
          const key = kind + '|' + (tex ? tex.uuid : 'none');
          let G = groups.get(key);
          if (!G) { G = { kind, tex, p: [], n: [], u: [], c: [], x: [], i: [] }; groups.set(key, G); }
          if (tex) tex.updateMatrix();
          const col = mat.color || new T.Color(1, 1, 1);
          let mode = tex ? 1 : 0, metal = mat.metalness !== undefined ? mat.metalness : 0, rough = mat.roughness !== undefined ? mat.roughness : 0.6;
          let emis = 0;
          if (cfg.paint && cfg.paint.test(name)) { mode = 3; rough = 0.32; metal = 0.45; }
          if (/taillight/i.test(name)) mode = 6;
          if (/projector|headlight/i.test(name)) mode = 5;
          if (/chrome/i.test(name)) { metal = 1; rough = 0.12; }
          if (/tire|tyre/i.test(name)) { rough = 0.9; metal = 0; }
          if (mat.emissive && (mat.emissive.r + mat.emissive.g + mat.emissive.b) > 0.05) emis = 1;
          const turn = /turn_signal|indicator/i.test(name);
          const base = G.p.length / 3;
          const count = idx ? rg.count : rg.count;
          const used = new Map();
          const getV = (vi) => {
            let k = used.get(vi);
            if (k !== undefined) return k;
            v.fromBufferAttribute(pos, vi).applyMatrix4(W);
            if (nor) n.fromBufferAttribute(nor, vi).applyMatrix3(nm).normalize(); else n.set(0, 1, 0);
            G.p.push(v.x, v.y, v.z); G.n.push(n.x, n.y, n.z);
            let uu = 0, vv = 0;
            if (uv) {
              uu = uv.getX(vi); vv = uv.getY(vi);
              if (tex) { const e = tex.matrix.elements; const u2 = e[0] * uu + e[3] * vv + e[6], v2 = e[1] * uu + e[4] * vv + e[7]; uu = u2; vv = v2; }
            }
            G.u.push(uu, vv);
            G.c.push(col.r, col.g, col.b, Math.max(0.05, rough));
            const md = turn ? (v.x < 0 ? 7 : 8) : mode;
            G.x.push(metal, emis, md, 0);
            k = G.p.length / 3 - 1;
            used.set(vi, k);
            return k;
          };
          for (let t = rg.start; t < rg.start + count; t += 3) {
            const a = getV(idx ? idx.getX(t) : t), b = getV(idx ? idx.getX(t + 1) : t + 1), c = getV(idx ? idx.getX(t + 2) : t + 2);
            G.i.push(a, b, c);
          }
          void base;
        }
      }
      const parts = [], glass = [];
      for (const G of groups.values()) {
        if (!G.i.length) continue;
        const vc = G.p.length / 3;
        const mesh = RM.GLU.mesh({ aPos: new Float32Array(G.p), aNormal: new Float32Array(G.n), aUV: new Float32Array(G.u), aColor: new Float32Array(G.c), aExtra: new Float32Array(G.x) },
          vc > 65535 ? new Uint32Array(G.i) : new Uint16Array(G.i));
        let glTex = null;
        if (G.tex) {
          const key = G.tex.source ? G.tex.source.uuid : G.tex.uuid;
          if (!this._texCache) this._texCache = {};
          glTex = this._texCache[key] || (this._texCache[key] = RM.GLU.texture(G.tex.image, { aniso: 8, clamp: false, nearest: /colormap/.test(G.tex.name || '') }));
        }
        (G.kind === 'glass' ? glass : parts).push({ mesh, tex: glTex });
      }
      return { parts, glass };
    },
  };

  RM.CarModels = CM;
})();
