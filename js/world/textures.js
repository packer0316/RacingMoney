'use strict';
// 程序化貼圖：柏油、草、樹冠、岩石、泥土、混凝土、雜訊、樹葉圖集、招牌/標誌圖集
(function () {
  const RM = window.RM;
  const FONT = '"Microsoft JhengHei","微軟正黑體","PingFang TC","Noto Sans TC","Heiti TC",sans-serif';

  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  // 週期性 value noise (u,v ∈ [0,1))
  function phash(ix, iy, f, seed) { return RM.hash2(((ix % f) + f) % f, ((iy % f) + f) % f, seed); }
  function pnoise(u, v, f, seed) {
    const x = u * f, y = v * f;
    const ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = phash(ix, iy, f, seed), b = phash(ix + 1, iy, f, seed), c = phash(ix, iy + 1, f, seed), d = phash(ix + 1, iy + 1, f, seed);
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  }
  function pfbm(u, v, f0, oct, seed) {
    let s = 0, a = 0.5, n = 0, f = f0;
    for (let o = 0; o < oct; o++) { s += pnoise(u, v, f, seed + o * 31) * a; n += a; a *= 0.5; f *= 2; }
    return s / n;
  }
  function pixels(size, fn) {
    const c = canvas(size, size), ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size), d = img.data;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      const r = fn(x / size, y / size, x, y);
      d[o] = r[0]; d[o + 1] = r[1]; d[o + 2] = r[2]; d[o + 3] = r[3] === undefined ? 255 : r[3];
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }
  // 在可平鋪畫布上繪製 (處理邊界環繞)
  function wrapDraw(ctx, size, x, y, r, fn) {
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      const cx = x + ox * size, cy = y + oy * size;
      if (cx + r < 0 || cx - r > size || cy + r < 0 || cy - r > size) continue;
      fn(cx, cy);
    }
  }

  const T = {};

  T.asphalt = () => {
    const S = 512, rnd = RM.rng(11);
    const c = pixels(S, (u, v) => {
      const n = pfbm(u, v, 8, 5, 3);
      const g = 52 + n * 30;
      return [g * 0.97, g * 0.98, g * 1.02];
    });
    const ctx = c.getContext('2d');
    // 骨材顆粒
    for (let i = 0; i < 26000; i++) {
      const x = rnd() * S, y = rnd() * S, r = 0.4 + rnd() * 1.4;
      const l = rnd();
      const g = l < 0.55 ? 95 + rnd() * 70 : 20 + rnd() * 25;
      ctx.fillStyle = `rgb(${g | 0},${(g * 0.98) | 0},${(g * 0.95) | 0})`;
      wrapDraw(ctx, S, x, y, r, (cx, cy) => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.283); ctx.fill(); });
    }
    // 油漬
    for (let i = 0; i < 30; i++) {
      const x = rnd() * S, y = rnd() * S, r = 10 + rnd() * 40;
      wrapDraw(ctx, S, x, y, r, (cx, cy) => {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, 'rgba(15,15,18,0.25)'); g.addColorStop(1, 'rgba(15,15,18,0)');
        ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
      });
    }
    return c;
  };

  T.cracks = () => {
    const S = 512, rnd = RM.rng(21);
    const c = canvas(S, S), ctx = c.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = '#fff'; ctx.lineCap = 'round';
    for (let k = 0; k < 9; k++) {
      let x = rnd() * S, y = rnd() * S, a = rnd() * 6.28;
      ctx.lineWidth = 1 + rnd() * 2.5;
      const len = 30 + rnd() * 120;
      for (let s = 0; s < len; s++) {
        const nx = x + Math.cos(a) * 2, ny = y + Math.sin(a) * 2;
        wrapDraw(ctx, S, x, y, 4, (cx, cy) => { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + nx - x, cy + ny - y); ctx.stroke(); });
        x = nx; y = ny; a += (rnd() - 0.5) * 0.6;
        if (rnd() < 0.02) a += (rnd() - 0.5) * 2;
      }
    }
    return c;
  };

  T.grass = () => {
    const S = 512, rnd = RM.rng(31);
    const c = pixels(S, (u, v) => {
      const n = pfbm(u, v, 6, 4, 9), m = pfbm(u, v, 24, 3, 19);
      return [44 + n * 40 + m * 20, 70 + n * 45 + m * 25, 24 + n * 15];
    });
    const ctx = c.getContext('2d');
    for (let i = 0; i < 9000; i++) {
      const x = rnd() * S, y = rnd() * S, l = 3 + rnd() * 9, a = -1.57 + (rnd() - 0.5) * 1.4;
      const g = rnd();
      ctx.strokeStyle = g < 0.15 ? `rgba(140,130,60,0.6)` : `rgba(${40 + rnd() * 50 | 0},${80 + rnd() * 70 | 0},${20 + rnd() * 30 | 0},0.7)`;
      ctx.lineWidth = 1 + rnd();
      wrapDraw(ctx, S, x, y, l, (cx, cy) => { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l); ctx.stroke(); });
    }
    return c;
  };

  T.canopy = () => {
    const S = 512, rnd = RM.rng(41);
    const c = canvas(S, S), ctx = c.getContext('2d');
    ctx.fillStyle = '#16260f'; ctx.fillRect(0, 0, S, S);
    const cols = ['#2c4f1f', '#355c22', '#3f6a26', '#2a4a1c', '#4b7a2e', '#58823a', '#3b5f2a', '#6b8a3c', '#4e6b30', '#5b7040', '#304d26'];
    for (let i = 0; i < 1400; i++) {
      const x = rnd() * S, y = rnd() * S, r = 6 + rnd() * 18;
      const col = cols[(rnd() * cols.length) | 0];
      wrapDraw(ctx, S, x, y, r, (cx, cy) => {
        const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
        g.addColorStop(0, col); g.addColorStop(0.7, col); g.addColorStop(1, 'rgba(10,20,8,0.0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.283); ctx.fill();
      });
    }
    return c;
  };

  T.rock = () => {
    const S = 512;
    return pixels(S, (u, v) => {
      const n = pfbm(u, v, 4, 6, 51), m = pfbm(u * 1.0, v * 3.0 % 1, 8, 4, 61);
      const cr = Math.abs(pnoise(u, v, 16, 71) - 0.5) < 0.02 ? 0.55 : 1;
      const g = (80 + n * 70 + m * 25) * cr;
      return [g * 1.02, g * 0.98, g * 0.9];
    });
  };

  T.dirt = () => {
    const S = 512, rnd = RM.rng(81);
    const c = pixels(S, (u, v) => {
      const n = pfbm(u, v, 6, 5, 91);
      return [98 + n * 50, 78 + n * 40, 52 + n * 28];
    });
    const ctx = c.getContext('2d');
    for (let i = 0; i < 3000; i++) {
      const x = rnd() * S, y = rnd() * S, r = 0.6 + rnd() * 2.2, g = 90 + rnd() * 90;
      ctx.fillStyle = `rgb(${g | 0},${g * 0.92 | 0},${g * 0.8 | 0})`;
      wrapDraw(ctx, S, x, y, r, (cx, cy) => { ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.283); ctx.fill(); });
    }
    return c;
  };

  T.concrete = () => {
    const S = 256;
    return pixels(S, (u, v) => {
      const n = pfbm(u, v, 4, 5, 101), m = pfbm(u, v, 32, 2, 111);
      const g = 150 + n * 50 + m * 20 - (pfbm(u, v, 3, 3, 121) > 0.62 ? 35 : 0);
      return [g, g * 0.99, g * 0.95];
    });
  };

  // Shared world materials, 12 x 256² (4 MiB including mipmaps).
  // Modes 20..31: sign, concrete, plaster, grass, sand, rock, bark,
  // palm leaf, timber, galvanized steel, fabric, glass. Generated once at load.
  T.surfaces = () => {
    const S = 256, layers = [], tau = Math.PI * 2;
    const wave = (x) => Math.cos(x * tau);
    for (let kind = 0; kind < 12; kind++) {
      const heights = new Float32Array(S * S), shades = new Float32Array(S * S);
      const data = new Uint8Array(S * S * 4);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S, k = y * S + x;
        const coarse = pfbm(u, v, 4, 3, 701 + kind * 23);
        const grain = RM.hash2(x, y, 991 + kind * 17);
        const fine = pnoise(u, v, 64, 401 + kind * 13);
        let h = coarse * .5 + fine * .24 + grain * .12, shade = .88 + (coarse - .5) * .3;
        if (kind === 0) { // Reflective sheeting: tiny glass beads and rolled paint.
          h = coarse * .22 + fine * .18 + grain * .03; shade = .96 + (grain - .5) * .04 + (coarse - .5) * .18;
        } else if (kind === 1 || kind === 2) { // Concrete pores / stucco aggregate.
          const pit = Math.max(0, (fine - .64) * 5) + (grain > .99 ? .16 : 0);
          h -= pit * .3; shade = .94 + (coarse - .5) * .24 + (grain - .5) * .1 - pit * .18;
        } else if (kind === 3) { // Grass clumps and fine blades, no extra meshes.
          const blades = Math.pow(.5 + .5 * wave(u * 47 + v * 9 + coarse), 7);
          h += blades * .25; shade = .76 + coarse * .36 + blades * .23 - fine * .2;
        } else if (kind === 4) { // Wind-rippled sand.
          const ripples = wave(v * 12 + wave(u * 2) * .24 + coarse * .6);
          h = ripples * .15 + grain * .1 + coarse * .2; shade = .91 + ripples * .055 + (grain - .5) * .15;
        } else if (kind === 5) { // Fractured stone with sediment layers.
          const crack = Math.pow(1 - Math.min(1, Math.abs(coarse - .5) * 18), 5);
          const strata = wave(v * 9 + coarse * .8);
          h = coarse + fine * .2 + strata * .1 - crack * .35; shade = .86 + (coarse - .5) * .55 + strata * .09 - crack * .28;
        } else if (kind === 6) { // Palm trunk growth rings and vertical fibres.
          const ring = Math.pow(.5 + .5 * wave(v * 13 + wave(u * 2) * .16), 10);
          h += ring * .34 + wave(u * 45 + coarse) * .07; shade = .93 - ring * .29 + (coarse - .5) * .24;
        } else if (kind === 7) { // Leaflets / central rib, follows leaf UVs.
          const vein = Math.pow(.5 + .5 * wave(u * 18 + v * 4), 10);
          h = vein * .25 + fine * .1; shade = .82 + vein * .28 + (coarse - .5) * .25;
        } else if (kind === 8) {
          const wood = wave(u * 18 + coarse * 2), joint = Math.pow(.5 + .5 * wave(u * 4), 40);
          h = wood * .13 - joint * .4 + fine * .14; shade = .9 + wood * .11 - joint * .28;
        } else if (kind === 9) { // Zinc spangle / brushed steel.
          h = fine * .12 + grain * .04; shade = .93 + (fine - .5) * .24 + (grain - .5) * .05;
        } else if (kind === 10) {
          const weave = wave(u * 64) * wave(v * 64);
          h = weave * .12 + coarse * .1; shade = .95 + weave * .07;
        } else { // Subtle glass streaks, no tiled fake reflections.
          h = 0; shade = .97 + (pnoise(u, v, 16, 741) - .5) * .05;
        }
        heights[k] = h; shades[k] = shade;
      }
      const roughness = [.42, .91, .88, .96, .89, .93, .94, .7, .86, .38, .92, .16][kind];
      const strength = [.65, .35, .25, .8, .8, 1.25, 1.0, .7, .9, .4, .4, 0][kind];
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const k = y * S + x, o = k * 4;
        const dx = (heights[y * S + (x + 1) % S] - heights[y * S + (x + S - 1) % S]) * strength;
        const dy = (heights[((y + 1) % S) * S + x] - heights[((y + S - 1) % S) * S + x]) * strength;
        data[o] = RM.clamp(shades[k] * 220, 0, 255);
        data[o + 1] = RM.clamp(128 - dx * 127, 0, 255);
        data[o + 2] = RM.clamp(128 - dy * 127, 0, 255);
        data[o + 3] = RM.clamp((roughness + (shades[k] - .9) * .15) * 255, 0, 255);
      }
      layers.push(data);
    }
    return layers;
  };

  // RGBA 四通道雜訊 (線性)
  T.noise = () => {
    const S = 256;
    return pixels(S, (u, v) => [
      pfbm(u, v, 4, 5, 201) * 255, pfbm(u, v, 8, 4, 211) * 255, pfbm(u, v, 16, 3, 221) * 255, RM.hash2(u * S, v * S, 231) * 255,
    ]);
  };

  // ---------------------------------------------------------------- 樹葉圖集 1024² (4x4 cells)
  T.foliage = () => {
    const S = 1024, C = 256;
    const c = canvas(S, S), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, S, S);
    const rnd = RM.rng(301);
    const cell = (cx, cy, fn) => { ctx.save(); ctx.translate(cx * C, cy * C); ctx.beginPath(); ctx.rect(2, 2, C - 4, C - 4); ctx.clip(); fn(); ctx.restore(); };
    const leafCluster = (palette, n, rmin, rmax) => {
      for (let i = 0; i < n; i++) {
        const a = rnd() * 6.283, rr = Math.pow(rnd(), 0.6) * 112;
        const x = 128 + Math.cos(a) * rr, y = 128 + Math.sin(a) * rr * 0.92;
        const r = rmin + rnd() * (rmax - rmin);
        ctx.fillStyle = palette[(rnd() * palette.length) | 0];
        ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.5, rnd() * 3.14, 0, 6.283); ctx.fill();
      }
    };
    // (0,0) 闊葉 (樟樹/楠木)
    cell(0, 0, () => leafCluster(['#2f5a20', '#3c6b26', '#4a7b2d', '#264a1a', '#56863a', '#1e3a15'], 1300, 4, 9));
    // (1,0) 闊葉淺色 (相思樹/新芽)
    cell(1, 0, () => leafCluster(['#5b7f2e', '#6f9236', '#88a548', '#4a6b26', '#a0ad4a'], 1300, 3, 7));
    // (2,0) 柳杉 枝層
    cell(2, 0, () => {
      for (let i = 0; i < 700; i++) {
        const y = 20 + rnd() * 220, half = (y / 240) * 115;
        const x = 128 + (rnd() - 0.5) * 2 * half;
        ctx.strokeStyle = ['#1d3a1c', '#24452a', '#2f5530', '#18301a'][(rnd() * 4) | 0];
        ctx.lineWidth = 2 + rnd() * 2;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rnd() - 0.5) * 14, y + 6 + rnd() * 10); ctx.stroke();
      }
    });
    // (3,0) 筆筒樹 蕨葉
    cell(3, 0, () => {
      ctx.strokeStyle = '#4a5a22'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(128, 250); ctx.quadraticCurveTo(128, 120, 128, 6); ctx.stroke();
      for (let y = 10; y < 245; y += 6) {
        const w = Math.sin((y / 250) * Math.PI) * 120;
        for (const sgn of [-1, 1]) {
          ctx.strokeStyle = ['#3c6b22', '#4f7f2a', '#5d8d33'][(rnd() * 3) | 0];
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(128, y); ctx.lineTo(128 + sgn * w, y + 10); ctx.stroke();
        }
      }
    });
    // (0,1) 檳榔葉
    cell(0, 1, () => {
      ctx.strokeStyle = '#6a7a30'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(128, 252); ctx.lineTo(128, 4); ctx.stroke();
      for (let y = 8; y < 248; y += 7) {
        for (const sgn of [-1, 1]) {
          ctx.strokeStyle = ['#4d6e24', '#5f8030', '#3f5e1e', '#7a8f38'][(rnd() * 4) | 0];
          ctx.lineWidth = 3.5;
          const l = 70 + Math.sin((y / 250) * Math.PI) * 50;
          ctx.beginPath(); ctx.moveTo(128, y); ctx.quadraticCurveTo(128 + sgn * l * 0.5, y + 8, 128 + sgn * l, y + 30); ctx.stroke();
        }
      }
    });
    // (1,1) 竹葉
    cell(1, 1, () => {
      for (let i = 0; i < 600; i++) {
        const x = 20 + rnd() * 216, y = 10 + rnd() * 236, a = rnd() * 6.28, l = 10 + rnd() * 16;
        ctx.strokeStyle = ['#5d8a2e', '#6f9a36', '#4a7424', '#8aa448'][(rnd() * 4) | 0];
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
      }
    });
    // (2,1) 樹皮
    cell(2, 1, () => {
      ctx.fillStyle = '#5a4c3e'; ctx.fillRect(0, 0, C, C);
      for (let i = 0; i < 260; i++) {
        const x = rnd() * C; ctx.strokeStyle = rnd() < 0.5 ? 'rgba(40,32,26,0.6)' : 'rgba(120,110,95,0.5)';
        ctx.lineWidth = 1 + rnd() * 3; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + (rnd() - 0.5) * 20, C); ctx.stroke();
      }
    });
    // (3,1) 竹竿
    cell(3, 1, () => {
      const g = ctx.createLinearGradient(0, 0, C, 0);
      g.addColorStop(0, '#4f6b28'); g.addColorStop(0.5, '#86a046'); g.addColorStop(1, '#4f6b28');
      ctx.fillStyle = g; ctx.fillRect(0, 0, C, C);
      ctx.fillStyle = 'rgba(60,70,30,0.9)';
      for (let y = 0; y < C; y += 64) ctx.fillRect(0, y, C, 5);
    });
    // (0,2) 茶樹
    cell(0, 2, () => {
      ctx.fillStyle = '#1d3a14'; ctx.fillRect(0, 0, C, C);
      for (let i = 0; i < 2500; i++) {
        ctx.fillStyle = ['#2f5a1e', '#3a6c22', '#4d8a2a', '#264c18', '#6aa236'][(rnd() * 5) | 0];
        const x = rnd() * C, y = rnd() * C;
        ctx.beginPath(); ctx.ellipse(x, y, 4, 2, rnd() * 3, 0, 6.283); ctx.fill();
      }
    });
    // (1,2) 草叢
    cell(1, 2, () => {
      for (let i = 0; i < 260; i++) {
        const x = 10 + rnd() * 236, h = 120 + rnd() * 130;
        ctx.strokeStyle = ['#4a6e25', '#5c8030', '#6d8a35', '#8a9a48', '#3c5a1e'][(rnd() * 5) | 0];
        ctx.lineWidth = 2 + rnd() * 2;
        ctx.beginPath(); ctx.moveTo(x, 254); ctx.quadraticCurveTo(x + (rnd() - 0.5) * 30, 254 - h * 0.5, x + (rnd() - 0.5) * 70, 254 - h); ctx.stroke();
      }
    });
    // (2,2) 檳榔樹幹
    cell(2, 2, () => {
      ctx.fillStyle = '#8b8a78'; ctx.fillRect(0, 0, C, C);
      for (let y = 0; y < C; y += 9) { ctx.fillStyle = 'rgba(70,70,60,0.6)'; ctx.fillRect(0, y, C, 2); }
    });
    // (3,2) 冥紙 / 買路錢 (2x2 子格)
    cell(3, 2, () => {
      // 金紙
      ctx.fillStyle = '#d8b25a'; ctx.fillRect(6, 6, 116, 116);
      ctx.fillStyle = '#e8d080'; ctx.fillRect(34, 34, 60, 60);
      ctx.strokeStyle = '#a0281e'; ctx.lineWidth = 4; ctx.strokeRect(14, 14, 100, 100);
      // 銀紙
      ctx.fillStyle = '#cbbd8e'; ctx.fillRect(134, 6, 116, 116);
      ctx.fillStyle = '#d6d6d0'; ctx.fillRect(160, 32, 64, 64);
      // 白色買路錢 (圓形方孔)
      for (const [x, y] of [[64, 192], [192, 192]]) {
        ctx.fillStyle = x < 100 ? '#efeae0' : '#e9d58a';
        ctx.beginPath(); ctx.arc(x, y, 54, 0, 6.283); ctx.fill();
        ctx.clearRect(x - 12, y - 12, 24, 24);
      }
    });
    return c;
  };
  // 樹葉圖集 cell uv
  T.fcell = (cx, cy, sub) => {
    const p = 4 / 1024;
    if (sub !== undefined) {
      const sx = sub % 2, sy = (sub / 2) | 0;
      return [(cx + sx * 0.5) / 4 + p, (cy + sy * 0.5) / 4 + p, (cx + sx * 0.5 + 0.5) / 4 - p, (cy + sy * 0.5 + 0.5) / 4 - p];
    }
    return [cx / 4 + p, cy / 4 + p, (cx + 1) / 4 - p, (cy + 1) / 4 - p];
  };

  // ---------------------------------------------------------------- 招牌/標誌圖集 2048²
  class Atlas {
    constructor(w, h) {
      this.size = w; this.H = h || w; this.c = canvas(w, this.H); this.ctx = this.c.getContext('2d');
      this.ctx.clearRect(0, 0, w, this.H);
      this.items = []; this.map = {};
      // 白色像素區 (純色物件用)
      this.add('white', 16, 16, (g) => { g.fillStyle = '#fff'; g.fillRect(0, 0, 16, 16); });
    }
    add(name, w, h, draw) { this.items.push({ name, w, h, draw }); }
    // 依高度排序後以 shelf 方式打包並繪製
    pack() {
      const items = this.items.slice().sort((a, b) => b.h - a.h || b.w - a.w);
      let x = 0, y = 0, rowH = 0;
      const g = this.ctx, S = this.size, SH = this.H, e = 0.5;
      for (const it of items) {
        if (x + it.w + 4 > S) { x = 0; y += rowH + 4; rowH = 0; }
        if (y + it.h > SH) { console.warn('atlas full', it.name); continue; }
        g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, it.w, it.h); g.clip();
        it.draw(g, it.w, it.h, x, y);
        g.restore();
        this.map[it.name] = [(x + e) / S, (y + e) / SH, (x + it.w - e) / S, (y + it.h - e) / SH];
        x += it.w + 4; rowH = Math.max(rowH, it.h);
      }
      this.used = y + rowH;
      this.items = [];
    }
    uv(name) { return this.map[name] || this.map.white; }
  }

  function text(g, s, x, y, size, color, opts = {}) {
    g.font = `${opts.weight || 'bold'} ${size}px ${FONT}`;
    g.fillStyle = color; g.textAlign = opts.align || 'center'; g.textBaseline = 'middle';
    if (opts.stroke) { g.strokeStyle = opts.stroke; g.lineWidth = opts.sw || 4; g.strokeText(s, x, y); }
    if (opts.maxW) {
      const m = g.measureText(s).width;
      if (m > opts.maxW) { g.save(); g.translate(x, y); g.scale(opts.maxW / m, 1); g.fillText(s, 0, 0); g.restore(); return; }
    }
    g.fillText(s, x, y);
  }
  function rrect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function warnTri(g, w, h, inner) {
    g.fillStyle = '#c8102e';
    g.beginPath(); g.moveTo(w / 2, 6); g.lineTo(w - 6, h - 10); g.lineTo(6, h - 10); g.closePath(); g.fill();
    g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(w / 2, 34); g.lineTo(w - 32, h - 24); g.lineTo(32, h - 24); g.closePath(); g.fill();
    g.save(); g.translate(w / 2, h * 0.62); inner(g); g.restore();
  }
  function blueSign(lines, bg = '#1a4f9c', fg = '#fff') {
    return (g, w, h) => {
      g.fillStyle = bg; rrect(g, 0, 0, w, h, 14); g.fill();
      g.strokeStyle = fg; g.lineWidth = 5; rrect(g, 7, 7, w - 14, h - 14, 10); g.stroke();
      const n = lines.length;
      lines.forEach((l, i) => text(g, l, w / 2, (h / (n + 1)) * (i + 1) + (n === 1 ? 0 : (i - (n - 1) / 2) * 6), l.length > 6 ? h / (n + 1.8) : h / (n + 1.2), fg, { maxW: w - 40 }));
    };
  }

  T.buildAtlas = (kmFrom, kmTo) => {
    const A = new Atlas(4096, 2048);
    // 台9 省道盾牌
    A.add('shield9', 128, 128, (g, w, h) => {
      g.fillStyle = '#fff';
      g.beginPath(); g.moveTo(8, 10); g.lineTo(w - 8, 10); g.lineTo(w - 8, 70); g.quadraticCurveTo(w - 10, 112, w / 2, 122); g.quadraticCurveTo(10, 112, 8, 70); g.closePath(); g.fill();
      g.strokeStyle = '#111'; g.lineWidth = 6; g.stroke();
      text(g, '台9', w / 2, 62, 50, '#111');
    });
    // 里程牌
    for (let k = kmFrom; k <= kmTo; k++) {
      A.add('km' + k, 64, 128, (g, w, h) => {
        g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#1a4f9c'; g.fillRect(0, 0, w, 36);
        text(g, '台9', w / 2, 19, 22, '#fff');
        text(g, String(k), w / 2, 74, k >= 100 ? 26 : 36, '#111');
        text(g, 'K', w / 2, 108, 22, '#111');
      });
    }
    const speed = (n) => (g, w, h) => {
      g.fillStyle = '#c8102e'; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 2, 0, 6.283); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 22, 0, 6.283); g.fill();
      text(g, String(n), w / 2, h / 2 + 4, 84, '#111');
    };
    A.add('speed50', 192, 192, speed(50));
    A.add('speed40', 192, 192, speed(40));
    A.add('speed30', 192, 192, speed(30));
    const curveArrow = (dir) => (g) => {
      g.strokeStyle = '#111'; g.lineWidth = 14; g.lineCap = 'butt';
      g.beginPath(); g.moveTo(-dir * 12, 40); g.lineTo(-dir * 12, 0); g.quadraticCurveTo(-dir * 12, -30, dir * 20, -30); g.stroke();
      g.fillStyle = '#111'; g.beginPath(); g.moveTo(dir * 46, -30); g.lineTo(dir * 16, -52); g.lineTo(dir * 16, -8); g.closePath(); g.fill();
    };
    A.add('warnR', 224, 200, (g, w, h) => warnTri(g, w, h, curveArrow(1)));
    A.add('warnL', 224, 200, (g, w, h) => warnTri(g, w, h, curveArrow(-1)));
    A.add('warnWind', 224, 200, (g, w, h) => warnTri(g, w, h, (g) => {
      g.strokeStyle = '#111'; g.lineWidth = 12;
      g.beginPath(); g.moveTo(-10, 42); g.bezierCurveTo(30, 20, -40, 0, 0, -20); g.bezierCurveTo(30, -34, 0, -44, 0, -46); g.stroke();
      g.fillStyle = '#111'; g.beginPath(); g.moveTo(0, -64); g.lineTo(-18, -38); g.lineTo(18, -38); g.closePath(); g.fill();
    }));
    A.add('warnRock', 224, 200, (g, w, h) => warnTri(g, w, h, (g) => {
      g.fillStyle = '#111';
      g.beginPath(); g.moveTo(-40, 40); g.lineTo(-40, -30); g.lineTo(-10, -50); g.lineTo(-10, 40); g.closePath(); g.fill();
      for (const [x, y, r] of [[8, -22, 9], [22, 0, 11], [12, 26, 13], [34, 30, 8]]) { g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill(); }
    }));
    A.add('chevron', 128, 160, (g, w, h) => {
      g.fillStyle = '#1a4f9c'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff';
      g.beginPath(); g.moveTo(30, 20); g.lineTo(70, 20); g.lineTo(108, 80); g.lineTo(70, 140); g.lineTo(30, 140); g.lineTo(68, 80); g.closePath(); g.fill();
    });
    A.add('noOvertake', 192, 192, (g, w, h) => {
      g.fillStyle = '#c8102e'; g.beginPath(); g.arc(96, 96, 94, 0, 6.283); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(96, 96, 74, 0, 6.283); g.fill();
      g.fillStyle = '#c8102e'; rrect(g, 44, 70, 44, 64, 10); g.fill();
      g.fillStyle = '#111'; rrect(g, 104, 70, 44, 64, 10); g.fill();
    });
    A.add('slogan1', 512, 192, blueSign(['北宜公路', '彎多路窄 小心駕駛']));
    A.add('slogan2', 512, 192, blueSign(['前有區間測速', '限速 50 公里']));
    A.add('slogan3', 512, 192, blueSign(['山區道路 起霧', '請開頭燈']));
    A.add('slogan4', 512, 192, blueSign(['連續彎路', '請勿超車']));
    A.add('intervalStart', 384, 192, blueSign(['區間測速', '起點']));
    A.add('intervalEnd', 384, 192, blueSign(['區間測速', '終點']));
    A.add('camera', 256, 256, (g, w, h) => {
      g.fillStyle = '#1a4f9c'; rrect(g, 0, 0, w, h, 14); g.fill();
      g.fillStyle = '#fff'; rrect(g, 50, 70, 156, 96, 14); g.fill();
      g.fillStyle = '#1a4f9c'; g.beginPath(); g.arc(128, 118, 32, 0, 6.283); g.fill();
      g.fillStyle = '#fff'; g.fillRect(70, 52, 40, 22);
      text(g, '照相執法', w / 2, 212, 44, '#fff');
    });
    const guide = (rows) => (g, w, h) => {
      g.fillStyle = '#0b6e3f'; rrect(g, 0, 0, w, h, 12); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 5; rrect(g, 7, 7, w - 14, h - 14, 9); g.stroke();
      rows.forEach((r, i) => {
        const y = (h / rows.length) * (i + 0.5);
        text(g, r[0], 40, y, 60, '#fff', { align: 'left' });
        text(g, r[1], w - 40, y, 56, '#fff', { align: 'right' });
      });
    };
    A.add('guideA', 512, 256, guide([['坪林', '14 km'], ['頭城', '45 km']]));
    A.add('guideB', 512, 256, guide([['頭城', '13 km'], ['宜蘭', '22 km']]));
    A.add('guideC', 512, 256, guide([['新店', '27 km'], ['台北', '38 km']]));
    A.add('guideD', 512, 256, guide([['坪林', '18 km'], ['新店', '45 km']]));
    A.add('welcomeYilan', 768, 256, (g, w, h) => {
      g.fillStyle = '#0b6e3f'; rrect(g, 0, 0, w, h, 16); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 6; rrect(g, 9, 9, w - 18, h - 18, 12); g.stroke();
      text(g, '歡迎蒞臨', w / 2, 80, 70, '#fff');
      text(g, '宜 蘭 縣', w / 2, 175, 92, '#fff');
    });
    A.add('ntpcPinglin', 512, 192, blueSign(['新北市', '坪林區']));
    A.add('touchengTown', 512, 192, blueSign(['宜蘭縣', '頭城鎮']));
    const brown = (t1, t2) => (g, w, h) => {
      g.fillStyle = '#6b3a1e'; rrect(g, 0, 0, w, h, 12); g.fill();
      g.strokeStyle = '#f2e6d0'; g.lineWidth = 5; rrect(g, 7, 7, w - 14, h - 14, 9); g.stroke();
      text(g, t1, w / 2, t2 ? h * 0.38 : h / 2, t2 ? 74 : 86, '#f7f0e0', { maxW: w - 40 });
      if (t2) text(g, t2, w / 2, h * 0.75, 40, '#f7f0e0', { maxW: w - 40 });
    };
    A.add('nineTurns', 512, 192, brown('九彎十八拐', '連續髮夾彎 13 公里'));
    A.add('xiaogetou', 384, 160, brown('小格頭'));
    A.add('pinglinTea', 512, 192, brown('坪林茶鄉', '文山包種茶'));
    A.add('shipai', 384, 160, brown('石牌'));
    A.add('slow', 256, 384, (g, w, h) => { text(g, '慢', w / 2, h / 2, 330, '#fff', { weight: '900' }); });
    A.add('banStart', 1024, 160, (g, w, h) => {
      g.fillStyle = '#b5121b'; g.fillRect(0, 0, w, h);
      text(g, '起 點 · 北 宜 公 路 · START', w / 2, h / 2, 82, '#fff', { maxW: w - 40 });
    });
    A.add('banFinish', 1024, 160, (g, w, h) => {
      for (let x = 0; x < w; x += 40) for (let y = 0; y < h; y += 40) { g.fillStyle = ((x + y) / 40) % 2 ? '#111' : '#eee'; g.fillRect(x, y, 40, 40); }
      g.fillStyle = 'rgba(181,18,27,0.92)'; g.fillRect(140, 20, w - 280, h - 40);
      text(g, '終 點 · FINISH', w / 2, h / 2, 80, '#fff');
    });
    A.add('plate', 256, 128, (g, w, h) => {
      g.fillStyle = '#f2f2ec'; rrect(g, 2, 2, w - 4, h - 4, 10); g.fill();
      g.strokeStyle = '#222'; g.lineWidth = 4; rrect(g, 6, 6, w - 12, h - 12, 8); g.stroke();
      text(g, '台灣省', w / 2, 26, 22, '#222');
      text(g, 'KE-1998', w / 2, 78, 70, '#111', { maxW: w - 30 });
    });
    A.add('mirror', 128, 128, (g, w, h) => {
      const gr = g.createRadialGradient(54, 50, 6, 64, 64, 60);
      gr.addColorStop(0, '#dfe8ee'); gr.addColorStop(0.5, '#8ea0a8'); gr.addColorStop(1, '#3b4648');
      g.fillStyle = '#e8721c'; g.beginPath(); g.arc(64, 64, 63, 0, 6.283); g.fill();
      g.fillStyle = gr; g.beginPath(); g.arc(64, 64, 55, 0, 6.283); g.fill();
    });
    // 檳榔攤霓虹
    A.add('betel', 512, 128, (g, w, h) => {
      g.fillStyle = '#1a0a1c'; g.fillRect(0, 0, w, h);
      g.shadowColor = '#ff3bd0'; g.shadowBlur = 18;
      text(g, '檳 榔', 150, h / 2, 86, '#ff7be6');
      g.shadowColor = '#3bff7a';
      text(g, '香菸 飲料', 375, h / 2, 54, '#9dffb8');
    });
    A.add('betelTube', 64, 64, (g) => { g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64); });
    // 店招
    const shops = [
      ['茶行', '#b5121b', '#fff'], ['包種茶', '#0b6e3f', '#fff'], ['土雞城', '#e8c01c', '#b5121b'], ['山產 野菜', '#1a4f9c', '#fff'],
      ['小吃部', '#b5121b', '#ffe066'], ['機車行', '#1a1a1a', '#ffcc00'], ['五金行', '#0b4f8c', '#fff'], ['雜貨店', '#d04a00', '#fff'],
      ['便利商店', '#f4f4f4', '#0b6e3f'], ['豆花', '#fff4dc', '#b5121b'], ['民宿', '#6b3a1e', '#fff'], ['檳榔', '#3a0a3a', '#ff7be6'],
      ['活魚 熱炒', '#b5121b', '#fff'], ['茶葉蛋', '#ffe066', '#7a1010'], ['輪胎行', '#1a4f9c', '#ffcc00'], ['藥局', '#0b6e3f', '#fff'],
    ];
    shops.forEach((s, i) => A.add('shop' + i, 256, 72, (g, w, h) => {
      g.fillStyle = s[1]; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
      text(g, s[0], w / 2, h / 2 + 2, 48, s[2], { maxW: w - 20 });
    }));
    A.nShops = shops.length;
    // 直式招牌
    ['旅社', '診所', '當舖', '中醫', '冰店', '早餐'].forEach((s, i) => A.add('vsign' + i, 64, 256, (g, w, h) => {
      g.fillStyle = ['#b5121b', '#fff', '#1a4f9c', '#0b6e3f', '#ffe066', '#e86a10'][i]; g.fillRect(0, 0, w, h);
      const fg = i === 1 || i === 4 ? '#b5121b' : '#fff';
      [...s].forEach((ch, k) => text(g, ch, w / 2, 64 + k * 110, 52, fg));
    }));
    // 透天厝立面 (alpha<1 = 夜間亮燈窗戶)
    const tiles = ['#d9d2c3', '#e6e1d6', '#c9b8a6', '#d6c7c0', '#bfc5c2', '#e3d3bd'];
    for (let v = 0; v < 6; v++) {
      A.add('facade' + v, 256, 512, (g, w, h) => {
        const rnd = RM.rng(700 + v);
        g.fillStyle = tiles[v]; g.fillRect(0, 0, w, h);
        // 二丁掛磁磚
        g.strokeStyle = 'rgba(0,0,0,0.07)'; g.lineWidth = 1;
        for (let y = 0; y < h; y += 6) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
        for (let y = 0; y < h; y += 6) for (let x = (y / 6) % 2 ? 0 : 11; x < w; x += 22) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 6); g.stroke(); }
        // 雨痕
        for (let i = 0; i < 12; i++) { const x = rnd() * w; g.fillStyle = 'rgba(40,40,40,0.08)'; g.fillRect(x, rnd() * h * 0.5, 3 + rnd() * 8, h * 0.5); }
        // 4 層樓，每層 128 px
        for (let f = 0; f < 3; f++) {
          const y = f * 128;
          const lit = rnd() < 0.55;
          // 窗戶 (含鐵窗)
          g.fillStyle = '#2e3a40'; g.fillRect(36, y + 26, 184, 70);
          // 玻璃反光
          const gr = g.createLinearGradient(0, y + 26, 0, y + 96);
          gr.addColorStop(0, '#6b8088'); gr.addColorStop(1, '#2c363a');
          g.fillStyle = gr; g.fillRect(40, y + 30, 176, 62);
          g.save(); g.globalCompositeOperation = 'destination-out';
          if (lit) { g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(42, y + 32, 172, 58); }
          g.restore();
          // 鐵窗
          g.strokeStyle = v % 2 ? '#e8e8e8' : '#5a5f60'; g.lineWidth = 3;
          g.strokeRect(30, y + 20, 196, 80);
          for (let x = 44; x < 220; x += 12) { g.beginPath(); g.moveTo(x, y + 20); g.lineTo(x, y + 100); g.stroke(); }
          g.beginPath(); g.moveTo(30, y + 60); g.lineTo(226, y + 60); g.stroke();
          // 冷氣機
          if (rnd() < 0.7) { g.fillStyle = '#eceae4'; g.fillRect(rnd() < 0.5 ? 180 : 40, y + 100, 46, 24); g.fillStyle = '#9a9a96'; g.fillRect(186, y + 106, 30, 12); }
          // 雨遮
          g.fillStyle = 'rgba(30,60,90,0.9)'; g.fillRect(24, y + 14, 208, 8);
        }
        // 一樓店面：鐵捲門
        const y = 384;
        g.fillStyle = '#8a8f90'; g.fillRect(0, y, w, 128);
        for (let yy = y; yy < y + 128; yy += 6) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, yy, w, 2); }
        if (rnd() < 0.6) {
          g.fillStyle = '#3a3a30'; g.fillRect(20, y + 30, w - 40, 98);
          g.save(); g.globalCompositeOperation = 'destination-out'; g.fillStyle = 'rgba(0,0,0,0.75)'; g.fillRect(24, y + 34, w - 48, 90); g.restore();
        }
      });
    }
    A.add('roofTin', 128, 128, (g, w, h) => {
      g.fillStyle = '#3f6f8a'; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 8) { g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(x, 0, 3, h); }
    });
    A.add('temple', 256, 192, (g, w, h) => {
      g.fillStyle = '#b8241c'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#e8c868'; g.fillRect(60, 18, 136, 48);
      text(g, '福德宮', w / 2, 43, 36, '#8a1010');
      g.fillStyle = '#2a1408'; g.fillRect(88, 82, 80, 110);
      g.fillStyle = '#ffb04a'; g.fillRect(118, 120, 20, 14);
      g.fillStyle = '#e8c868';
      g.fillRect(20, 60, 22, 132); g.fillRect(214, 60, 22, 132);
    });
    A.add('rescue', 384, 192, (g, w, h) => {
      g.fillStyle = '#f6f3ea'; g.fillRect(0, 0, w, h);
      text(g, '道路救援', w / 2, 58, 64, '#c8102e');
      text(g, '拖吊 24H', w / 2, 138, 58, '#1a1a1a');
    });
    A.add('teaAd', 512, 160, (g, w, h) => {
      g.fillStyle = '#f1e7c8'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#0b6e3f'; g.fillRect(0, 0, 90, h);
      text(g, '茶', 45, h / 2, 64, '#fff');
      text(g, '坪林 文山包種茶', 300, h / 2, 46, '#0b5e2f', { maxW: 400 });
    });
    A.add('stallSign', 512, 128, (g, w, h) => {
      g.fillStyle = '#e8c01c'; g.fillRect(0, 0, w, h);
      text(g, '冰涼飲料 · 香菸 · 檳榔', w / 2, h / 2, 50, '#b5121b', { maxW: w - 20 });
    });
    A.add('dash', 256, 128, (g, w, h) => {
      g.fillStyle = '#121212'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    });
    A.add('hondaH', 64, 48, (g, w, h) => {
      g.fillStyle = '#c8c8c8'; rrect(g, 2, 2, w - 4, h - 4, 10); g.fill();
      g.fillStyle = '#1a1a1a'; rrect(g, 6, 6, w - 12, h - 12, 8); g.fill();
      g.fillStyle = '#d8d8d8'; g.fillRect(18, 12, 7, 24); g.fillRect(39, 12, 7, 24); g.fillRect(18, 21, 28, 6);
    });
    // 尾燈貼圖：u 內側→外側，上排紅 (煞車/尾燈)，下排 內:倒車 外:方向燈；alpha 為分區
    A.add('tailLamp', 512, 160, (g, w, h, ax, ay) => {
      const rnd = RM.rng(55);
      const split = h * 0.56, mid = w * 0.45;
      // 紅色腔
      let gr = g.createLinearGradient(0, 0, 0, split);
      gr.addColorStop(0, '#8e1016'); gr.addColorStop(0.5, '#6a080c'); gr.addColorStop(1, '#4a0507');
      g.fillStyle = gr; g.fillRect(0, 0, w, split);
      for (const cx of [70, 200, 330, 445]) {
        const rg = g.createRadialGradient(cx, split * 0.5, 2, cx, split * 0.5, 46);
        rg.addColorStop(0, '#ff6a5a'); rg.addColorStop(0.25, '#d02022'); rg.addColorStop(0.6, '#7a0a0e'); rg.addColorStop(1, 'rgba(90,6,8,0)');
        g.fillStyle = rg; g.fillRect(cx - 50, 0, 100, split);
        g.strokeStyle = 'rgba(255,140,130,0.35)'; g.lineWidth = 1.5;
        for (const r of [12, 22, 32]) { g.beginPath(); g.arc(cx, split * 0.5, r, 0, 6.283); g.stroke(); }
      }
      // 下排：倒車 (白)
      gr = g.createLinearGradient(0, split, 0, h);
      gr.addColorStop(0, '#d8dadc'); gr.addColorStop(1, '#9ea2a6');
      g.fillStyle = gr; g.fillRect(0, split, mid, h - split);
      for (const cx of [60, 160]) {
        const rg = g.createRadialGradient(cx, (split + h) / 2, 2, cx, (split + h) / 2, 30);
        rg.addColorStop(0, '#ffffff'); rg.addColorStop(0.5, '#c8ccd0'); rg.addColorStop(1, 'rgba(160,164,168,0)');
        g.fillStyle = rg; g.fillRect(cx - 32, split, 64, h - split);
      }
      // 下排：方向燈 (琥珀)
      gr = g.createLinearGradient(0, split, 0, h);
      gr.addColorStop(0, '#e08a20'); gr.addColorStop(1, '#a85a0a');
      g.fillStyle = gr; g.fillRect(mid, split, w - mid, h - split);
      for (const cx of [300, 420]) {
        const rg = g.createRadialGradient(cx, (split + h) / 2, 2, cx, (split + h) / 2, 34);
        rg.addColorStop(0, '#ffd070'); rg.addColorStop(0.5, '#e09020'); rg.addColorStop(1, 'rgba(170,90,10,0)');
        g.fillStyle = rg; g.fillRect(cx - 36, split, 72, h - split);
      }
      // 透鏡細紋 (水平稜鏡) + 垂直切面
      for (let y = 2; y < h; y += 3) { g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(0, y, w, 1); }
      for (let x = 8; x < w; x += 16) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x, 0, 2, h); }
      // 分隔條、外框 (燈殼色)
      g.fillStyle = '#1a1a1a';
      g.fillRect(0, split - 3, w, 9); g.fillRect(mid - 3, split, 8, h - split);
      g.lineWidth = 8; g.strokeStyle = '#161616'; g.strokeRect(0, 0, w, h);
      g.fillStyle = 'rgba(220,220,220,0.5)'; g.fillRect(6, split - 1, w - 12, 1);
      // alpha 分區
      const img = g.getImageData(ax, ay, w, h), d = img.data;
      for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
        let a = 255;
        if (px < 5 || px > w - 6 || py < 5 || py > h - 6) a = 30;
        else if (py >= split - 3 && py <= split + 5) a = 30;
        else if (py > split) {
          if (px >= mid - 3 && px <= mid + 4) a = 30;
          else a = px < mid ? 77 : 140;
        }
        d[(py * w + px) * 4 + 3] = a;
      }
      g.putImageData(img, ax, ay);
    });
    A.add('garnish', 512, 64, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#5a0a0e'); gr.addColorStop(0.5, '#7c1016'); gr.addColorStop(1, '#3c0508');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 4) { g.fillStyle = x % 8 ? 'rgba(255,120,120,0.12)' : 'rgba(0,0,0,0.15)'; g.fillRect(x, 0, 2, h); }
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, 6, w, 2);
      g.strokeStyle = '#1a1a1a'; g.lineWidth = 6; g.strokeRect(0, 0, w, h);
    });
    A.add('vtecBadge', 128, 32, (g, w, h) => {
      g.font = `italic 900 26px ${FONT}`; g.textBaseline = 'middle';
      g.fillStyle = '#c8102e'; g.fillText('V', 10, h / 2 + 1);
      g.fillStyle = '#d8d8d8'; g.fillText('TEC', 30, h / 2 + 1);
    });
    A.add('civicBadge', 128, 32, (g, w, h) => { text(g, 'CIVIC', w / 2, h / 2, 26, '#d8d8d8', { weight: 'bold' }); });
    A.add('ferioBadge', 128, 32, (g, w, h) => { text(g, 'Ferio', w / 2, h / 2, 26, '#d8d8d8', { weight: 'bold' }); });
    A.add('tireSide', 128, 128, (g, w, h) => {
      g.fillStyle = '#1b1b1b'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#2a2a2a'; g.lineWidth = 3; g.beginPath(); g.arc(64, 64, 52, 0, 6.283); g.stroke();
    });
    A.pack();
    return A;
  };

  RM.Tex = T;
  RM.Atlas = Atlas;
  RM.FONT = FONT;
})();
