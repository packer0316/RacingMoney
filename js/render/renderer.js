'use strict';
// 繪製管線：陰影 → 地形/道路/物件/植生/車輛 → 海 → 天空 → 玻璃/粒子/光暈
(function () {
  const RM = window.RM;
  const { m4 } = RM;

  const ENV = {
    sunny: { name: '晴天午後', az: 235, el: 50, sun: [1.0, 0.95, 0.86], sunI: 3.1, sky: [0.3, 0.4, 0.58], skyI: 0.95, ground: [0.17, 0.16, 0.13], fog: [0.6, 0.7, 0.82], dens: 0.00007, falloff: 0.0016, base: 0, ins: 0.35, skyFog: 0, zen: [0.15, 0.33, 0.72], hor: [0.62, 0.74, 0.88], exp: 1.0, cloud: 0.42, wet: 0, night: 0, head: 0, shadow: 1 },
    fog: { name: '山區起霧', az: 200, el: 42, sun: [0.92, 0.94, 0.97], sunI: 0.85, sky: [0.55, 0.58, 0.62], skyI: 1.15, ground: [0.22, 0.23, 0.22], fog: [0.67, 0.7, 0.73], dens: 0.0085, falloff: -0.0024, base: 230, ins: 0.08, skyFog: 0.88, zen: [0.56, 0.59, 0.63], hor: [0.67, 0.7, 0.73], exp: 1.05, cloud: 0.95, wet: 0.55, night: 0.05, head: 1, shadow: 0 },
    dusk: { name: '黃昏', az: 288, el: 7, sun: [1.0, 0.56, 0.28], sunI: 2.5, sky: [0.27, 0.27, 0.4], skyI: 0.8, ground: [0.14, 0.1, 0.08], fog: [0.8, 0.58, 0.45], dens: 0.0001, falloff: 0.0016, base: 0, ins: 0.9, skyFog: 0, zen: [0.12, 0.18, 0.42], hor: [0.98, 0.6, 0.36], exp: 1.25, cloud: 0.5, wet: 0, night: 0.3, head: 1, shadow: 1 },
    night: { name: '夜晚', az: 140, el: 38, sun: [0.5, 0.6, 0.9], sunI: 0.07, sky: [0.03, 0.04, 0.07], skyI: 1.0, ground: [0.012, 0.014, 0.018], fog: [0.025, 0.03, 0.045], dens: 0.0007, falloff: 0.001, base: 0, ins: 0.1, skyFog: 0, zen: [0.006, 0.012, 0.035], hor: [0.035, 0.045, 0.08], exp: 2.6, cloud: 0.35, wet: 0, night: 1, head: 1, shadow: 0 },
    // 熱浪夏威夷固定用的夏威夷夕陽：太陽壓在東南方 7° 的海平線上，天頂深紫、地平線粉橘 (main.js 依 RM.DriftTrack.env 選用)
    miami: { name: '夏威夷夕陽', az: 140, el: 7, sun: [1.0, 0.5, 0.28], sunI: 2.8, sky: [0.3, 0.25, 0.48], skyI: 0.85, ground: [0.16, 0.1, 0.1], fog: [0.78, 0.42, 0.5], dens: 0.00006, falloff: 0.0016, base: 0, ins: 0.55, skyFog: 0, zen: [0.035, 0.05, 0.24], hor: [0.9, 0.32, 0.42], skyCurve: 0.24, disk: 2.2, exp: 1.15, cloud: 0.28, wet: 0, night: 0.2, head: 1, shadow: 1 },
    rain: { name: '陰雨', az: 210, el: 35, sun: [0.85, 0.88, 0.95], sunI: 0.55, sky: [0.45, 0.48, 0.52], skyI: 1.05, ground: [0.15, 0.16, 0.15], fog: [0.5, 0.53, 0.56], dens: 0.0032, falloff: 0.0005, base: 0, ins: 0.05, skyFog: 0.65, zen: [0.42, 0.45, 0.5], hor: [0.52, 0.55, 0.58], exp: 1.15, cloud: 1.0, wet: 1, night: 0.15, head: 1, shadow: 0, rain: 1 },
  };

  class Renderer {
    constructor(gl, tex) {
      this.gl = gl; this.tex = tex;
      const S = RM.SHADERS, P = (k) => RM.GLU.program(S[k][0], S[k][1], k);
      this.p = {};
      for (const k of ['terrain', 'road', 'prop', 'inst', 'sky', 'water', 'shadow', 'shadowInst', 'part', 'glow', 'car', 'skid', 'copy', 'fxaa', 'studioGround']) this.p[k] = P(k);
      this.rt = null;
      this.dyn = 1; // 動態解析度：只畫離屏目標左下角 dyn x dyn 的區域，最後一道放大；改變時不必重新配置任何緩衝區
      this.ubo = RM.GLU.ubo(132);
      this.shadow = RM.GLU.shadowTarget(2048);
      this.view = m4.c(); this.proj = m4.c(); this.vp = m4.c(); this.ivp = m4.c(); this.lvp = m4.c(); this.lv = m4.c(); this.lp = m4.c();
      this.ident = m4.c();
      this.planes = new Float32Array(24);
      // 粒子/光暈用四邊形
      const quv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
      const qp = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
      const qi = new Uint16Array([0, 1, 2, 0, 2, 3]);
      this.partMesh = RM.GLU.mesh({ aPos: qp, aUV: quv }, qi);
      this.glowMesh = RM.GLU.mesh({ aPos: qp, aUV: quv }, qi);
      this.env = ENV.sunny;
      this.time = 0;
    }

    makeWater(hm) {
      const y = 0.35, x0 = hm.x0 - 20000, x1 = hm.x1 + 20000, z0 = hm.z0 - 20000, z1 = hm.z1 + 20000;
      this.water = RM.GLU.mesh({ aPos: new Float32Array([x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1]) }, new Uint16Array([0, 2, 1, 0, 3, 2]));
    }

    // 離屏渲染目標：場景先畫到這裡 (可選 MSAA 取樣數、可與畫布不同解析度)，最後一道再畫到畫布 (無 MSAA 時做 FXAA)
    // 這樣切換畫質 / 動態解析度不必重建 WebGL context
    setTarget(w, h, samples) {
      const gl = this.gl;
      w = Math.max(16, Math.round(w)); h = Math.max(16, Math.round(h));
      samples = Math.min(samples || 0, gl.getParameter(gl.MAX_SAMPLES) || 0);
      const o = this.rt;
      if (o && o.w === w && o.h === h && o.samples === samples) return;
      if (o) {
        for (const f of [o.fbo, o.msFbo]) if (f) gl.deleteFramebuffer(f);
        for (const r of [o.depth, o.msColor, o.msDepth]) if (r) gl.deleteRenderbuffer(r);
        gl.deleteTexture(o.tex);
      }
      const rt = { w, h, samples };
      const rb = (fmt, ms) => {
        const r = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, r);
        if (ms) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, ms, fmt, w, h);
        else gl.renderbufferStorage(gl.RENDERBUFFER, fmt, w, h);
        return r;
      };
      rt.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, rt.tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      rt.fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rt.tex, 0);
      if (samples > 0) {
        rt.msFbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, rt.msFbo);
        rt.msColor = rb(gl.RGBA8, samples); rt.msDepth = rb(gl.DEPTH_COMPONENT24, samples);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rt.msColor);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rt.msDepth);
      } else {
        rt.depth = rb(gl.DEPTH_COMPONENT24, 0);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rt.depth);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      this.rt = rt;
    }

    // 離屏畫面 → 畫布
    _present() {
      const gl = this.gl, rt = this.rt, vw = this.vw, vh = this.vh;
      if (rt.msFbo) {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, rt.msFbo);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, rt.fbo);
        gl.blitFramebuffer(0, 0, vw, vh, 0, 0, vw, vh, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
      const p = rt.samples > 0 ? this.p.copy : this.p.fxaa;
      gl.useProgram(p.p);
      RM.GLU.bindTex(0, rt.tex);
      gl.uniform2f(p.u('uTexel'), 1 / rt.w, 1 / rt.h);
      gl.uniform2f(p.u('uUVScale'), vw / rt.w, vh / rt.h);
      gl.uniform2f(p.u('uUVMax'), (vw - 0.5) / rt.w, (vh - 0.5) / rt.h);
      gl.bindVertexArray(this._emptyVao || (this._emptyVao = gl.createVertexArray()));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      gl.enable(gl.DEPTH_TEST);
    }

    setEnv(key) { this.env = ENV[key] || ENV.sunny; this.envKey = key; }
    // 陰影貼圖大小 / 涵蓋半徑 (依畫質)
    setShadow(size, radius) {
      const gl = this.gl;
      this.shadowRadius = radius || 70;
      if (this.shadow && this.shadow.size === size) return;
      if (this.shadow) { gl.deleteFramebuffer(this.shadow.fbo); gl.deleteTexture(this.shadow.tex); }
      this.shadow = RM.GLU.shadowTarget(size);
    }
    // 這個 AABB ([x0, y0, z0, x1, y1, z1]) 會不會落進陰影貼圖的範圍 (光源空間的方框)：分塊的大型靜態場景只把這些塊畫進陰影貼圖
    shadowSees(b) {
      const M = this.lvp;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let k = 0; k < 8; k++) {
        const x = k & 1 ? b[3] : b[0], y = k & 2 ? b[4] : b[1], z = k & 4 ? b[5] : b[2];
        const cx = M[0] * x + M[4] * y + M[8] * z + M[12], cy = M[1] * x + M[5] * y + M[9] * z + M[13], cz = M[2] * x + M[6] * y + M[10] * z + M[14];
        if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy; if (cz < z0) z0 = cz; if (cz > z1) z1 = cz;
      }
      return x1 > -1 && x0 < 1 && y1 > -1 && y0 < 1 && z1 > -1 && z0 < 1;
    }
    sunDir() {
      const e = this.env, az = (e.az * Math.PI) / 180, el = (e.el * Math.PI) / 180;
      return [Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)];
    }

    // 計算矩陣、更新 UBO
    // extra (可省略)：{ tailL, tailR, tailInt, carP:[x,y,z], carF:[fx,fz], carShade } 玩家車尾燈照明與車底陰影
    begin(cam, w, h, time, carPos, head, extra) {
      const e = this.env, U = this.ubo.data;
      this.w = w; this.h = h;
      m4.persp(this.proj, (cam.fov * Math.PI) / 180, w / h, 0.12, 36000);
      m4.lookAt(this.view, cam.eye, cam.target, cam.up);
      m4.mul(this.vp, this.proj, this.view);
      m4.invert(this.ivp, this.vp);
      RM.frustumPlanes(this.vp, this.planes);
      // 陰影矩陣 (以車為中心，貼齊 texel)
      const sd = this.sunDir();
      this.shadowOn = e.shadow && sd[1] > 0.05;
      if (this.shadowOn) {
        // 陰影範圍：半徑 shadowRadius 的方框。extra.shadowShift > 0 時，中心由車子往鏡頭前方 (水平) 推出去 ——
        // 鏡頭背後看不到的地方不必算陰影，同樣的清晰度可以用較小的陰影貼圖 (填充成本大幅降低)，前方涵蓋得也更遠
        const r = this.shadowRadius || 70, c = carPos.slice();
        const shift = (extra && extra.shadowShift) || 0;
        if (shift > 0) {
          const fx = cam.target[0] - cam.eye[0], fz = cam.target[2] - cam.eye[2], fl = Math.hypot(fx, fz);
          if (fl > 1e-3) { c[0] += (fx / fl) * shift; c[2] += (fz / fl) * shift; }
        }
        const up = Math.abs(sd[1]) > 0.98 ? [0, 0, 1] : [0, 1, 0];
        const right = RM.v3.norm([0, 0, 0], RM.v3.cross([0, 0, 0], up, sd));
        const lup = RM.v3.cross([0, 0, 0], sd, right);
        const texel = (2 * r) / this.shadow.size;
        const cr = RM.v3.dot(c, right), cu = RM.v3.dot(c, lup);
        const dr = Math.round(cr / texel) * texel - cr, du = Math.round(cu / texel) * texel - cu;
        for (let i = 0; i < 3; i++) c[i] += right[i] * dr + lup[i] * du;
        m4.lookAt(this.lv, [c[0] + sd[0] * 220, c[1] + sd[1] * 220, c[2] + sd[2] * 220], c, up);
        m4.ortho(this.lp, -r, r, -r, r, 1, 450);
        m4.mul(this.lvp, this.lp, this.lv);
        // 陰影貼圖在光源空間的範圍 (給主程式挑選會投影到畫面內的樹)
        this.shR = right; this.shU = lup; this.shC = c; this.shRad = r;
      }
      U.set(this.vp, 0); U.set(this.view, 16); U.set(this.lvp, 32);
      U[48] = cam.eye[0]; U[49] = cam.eye[1]; U[50] = cam.eye[2]; U[51] = time;
      U[52] = sd[0]; U[53] = sd[1]; U[54] = sd[2]; U[55] = e.night;
      U[56] = e.sun[0] * e.sunI; U[57] = e.sun[1] * e.sunI; U[58] = e.sun[2] * e.sunI; U[59] = e.exp;
      U[60] = e.sky[0] * e.skyI; U[61] = e.sky[1] * e.skyI; U[62] = e.sky[2] * e.skyI; U[63] = e.wet;
      // 天空的兩個可選參數 (沒給 = 0，著色器沿用原本的值)：disk 太陽圓盤亮度 (原本 30)、skyCurve 地平線色往天頂過渡的指數 (原本 0.42，越小地平線色帶越窄)
      U[64] = e.ground[0]; U[65] = e.ground[1]; U[66] = e.ground[2]; U[67] = e.disk || 0;
      U[68] = e.fog[0]; U[69] = e.fog[1]; U[70] = e.fog[2]; U[71] = e.dens;
      U[72] = e.falloff; U[73] = e.base; U[74] = e.ins; U[75] = e.skyFog;
      if (head && head.on) {
        U.set(head.l, 76); U[79] = head.int; U.set(head.r, 80); U[83] = head.int;
        U.set(head.dir, 84); U[87] = Math.cos((26 * Math.PI) / 180);
      } else { U[79] = 0; U[83] = 0; }
      // U[90] (uMisc.z)：車庫 —— 車漆 / 玻璃的反射環境改用攝影棚 (shaders.js 的 studioEnv)
      U[88] = this.shadowOn ? 1 : 0; U[89] = 1 / this.shadow.size; U[90] = extra && extra.studio ? 1 : 0; U[91] = 0;
      U[92] = e.zen[0]; U[93] = e.zen[1]; U[94] = e.zen[2]; U[95] = e.skyCurve || 0;
      U[96] = e.hor[0]; U[97] = e.hor[1]; U[98] = e.hor[2]; U[99] = 0;
      for (let i = 100; i < 116; i++) U[i] = 0;
      // 以相機為原點的 view-proj (著色器的 projWorld 使用)；相機位置取 float32 後的值，與 uCamPos 一致
      {
        const ex = Math.fround(cam.eye[0]), ey = Math.fround(cam.eye[1]), ez = Math.fround(cam.eye[2]);
        const vr = (this._vr = this._vr || m4.c()), vpr = (this._vpr = this._vpr || m4.c());
        m4.lookAt(vr, [cam.eye[0] - ex, cam.eye[1] - ey, cam.eye[2] - ez], [cam.target[0] - ex, cam.target[1] - ey, cam.target[2] - ez], cam.up);
        m4.mul(vpr, this.proj, vr);
        U.set(vpr, 116);
      }
      if (extra) {
        if (extra.tailInt > 0) { U.set(extra.tailL, 100); U[103] = extra.tailInt; U.set(extra.tailR, 104); U[107] = extra.tailInt; }
        if (extra.carP) {
          U.set(extra.carP, 108); U[111] = extra.carShade === undefined ? (this.shadowOn ? 0.3 : 0.55) : extra.carShade;
          U[112] = extra.carF[0]; U[113] = extra.carF[1];
          U[114] = extra.carHalf ? extra.carHalf[0] : 0.78; U[115] = extra.carHalf ? extra.carHalf[1] : 2.12;
        }
      }
      RM.GLU.uboUpload(this.ubo);
    }

    // GPU 計時 (EXT_disjoint_timer_query_webgl2)：每幀一個查詢包住整個繪製，幾幀後讀回 → gpuMs (平滑後的毫秒數)
    // 給動態解析度判斷用；不支援時 gpuMs 維持 undefined
    _gpuBegin() {
      const gl = this.gl;
      if (this._tq === undefined) this._tq = gl.getExtension('EXT_disjoint_timer_query_webgl2') || null;
      const ext = this._tq;
      if (!ext) return;
      const P = (this._qs = this._qs || []), free = (this._qfree = this._qfree || []);
      while (P.length && gl.getQueryParameter(P[0], gl.QUERY_RESULT_AVAILABLE)) {
        const q = P.shift();
        const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT) && ms > 0 && ms < 200) this.gpuMs = this.gpuMs === undefined ? ms : this.gpuMs + (ms - this.gpuMs) * 0.1;
        free.push(q);
      }
      if (P.length > 5) return;
      this._qcur = free.pop() || gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, this._qcur);
    }
    _gpuEnd() {
      if (!this._qcur) return;
      this.gl.endQuery(this._tq.TIME_ELAPSED_EXT);
      this._qs.push(this._qcur);
      this._qcur = null;
    }

    // f: 每幀內容
    draw(f) {
      const gl = this.gl, T = this.tex, G = RM.GLU;
      this._gpuBegin();
      // ---------------- 陰影
      if (this.shadowOn) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadow.fbo);
        gl.viewport(0, 0, this.shadow.size, this.shadow.size);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
        gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2.0, 4.0);
        let p = this.p.shadow;
        gl.useProgram(p.p);
        gl.uniformMatrix4fv(p.u('uLightVP'), false, this.lvp);
        gl.uniformMatrix4fv(p.u('uModel'), false, this.ident);
        for (const m of f.shadowProps) G.draw(m);
        for (const d of (f.shadowDynamic || f.dynamic)) { gl.uniformMatrix4fv(p.u('uModel'), false, d.model); G.draw(d.mesh); }
        p = this.p.shadowInst;
        gl.useProgram(p.p);
        gl.uniformMatrix4fv(p.u('uLightVP'), false, this.lvp);
        gl.uniform1f(p.u('uUseAlpha'), 1);
        G.bindTex(6, T.foliage);
        const sl = f.shLod || [0, 0, 0, 1e9];
        gl.uniform4f(p.u('uShLod'), sl[0], sl[1], sl[2], sl[3]);
        let sm = -1;
        for (const v of f.shadowInst) {
          const m = v.shMode || 0;
          if (m !== sm) { gl.uniform1f(p.u('uLodMode'), m); sm = m; }
          G.draw(v);
        }
        gl.disable(gl.POLYGON_OFFSET_FILL);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
      // ---------------- 主畫面 (畫到離屏目標)
      const rt = this.rt || (this.setTarget(gl.drawingBufferWidth, gl.drawingBufferHeight, 0), this.rt);
      const vw = (this.vw = Math.max(16, Math.round(rt.w * this.dyn))), vh = (this.vh = Math.max(16, Math.round(rt.h * this.dyn)));
      gl.bindFramebuffer(gl.FRAMEBUFFER, rt.msFbo || rt.fbo);
      gl.viewport(0, 0, vw, vh);
      const background = f.background || [0, 0, 0];
      gl.clearColor(background[0], background[1], background[2], f.studio ? 0 : 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
      gl.disable(gl.BLEND);
      G.bindTex(7, this.shadow.tex);
      G.bindTex(4, T.noise);
      // ---- 不透明物件分成幾個階段，由近到遠畫：近處的車、道路、近景樹先寫入深度，
      //      之後才畫鋪滿畫面的地形與遠景樹 —— 被擋住的像素在跑 (昂貴的) 像素著色器之前就被深度測試剔除
      let p;
      const propSetup = () => {
        p = this.p.prop;
        gl.useProgram(p.p);
        G.bindTex(5, T.atlas);
        gl.activeTexture(gl.TEXTURE0 + 11); gl.bindTexture(gl.TEXTURE_2D_ARRAY, T.surface);
        gl.uniform1f(p.u('uSurfaceRange'), this.surfaceRange || 180);
        gl.uniformMatrix4fv(p.u('uModel'), false, this.ident);
        gl.uniform4f(p.u('uLights'), 0, 0, 0, 0); gl.uniform4f(p.u('uLights2'), 0, 0, 0, 0);
        gl.uniform1f(p.u('uGlass'), 0); gl.uniform1f(p.u('uDirt'), 0);
        gl.uniform1f(p.u('uShadowBias'), 0);
        gl.uniform3f(p.u('uPaint'), 0.7, 0.7, 0.7);
        gl.uniform1f(p.u('uPaintMetal'), 0.45);
      };
      // 車輛 (玩家 + 車流) 與玩家車殼
      const shells = (this._shells = this._shells || []);
      shells.length = 0;
      if (f.car && f.car.tex) shells.push(f.car);
      if (f.cars) for (const d of f.cars) if (d && d.tex) shells.push(d);
      // 車輛零件 (list) 與車殼 (shellList)；不透明階段畫全部的車，幽靈車階段另外再用一次
      const drawCars = (list, shellList) => {
        propSetup();
        for (const d of list) {
          gl.uniformMatrix4fv(p.u('uModel'), false, d.model);
          if (d.paint) gl.uniform3fv(p.u('uPaint'), d.paint);
          gl.uniform1f(p.u('uPaintMetal'), d.paintMetal === undefined ? 0.45 : d.paintMetal);   // 車色零件的金屬感要和車殼一致
          const L = d.lights || [0, 0, 0, 0], L2 = d.lights2 || [0, 0, 0, 0];
          gl.uniform4f(p.u('uLights'), L[0], L[1], L[2], L[3]);
          gl.uniform4f(p.u('uLights2'), L2[0], L2[1], L2[2], L2[3]);
          gl.uniform1f(p.u('uDirt'), d.dirt || 0);
          gl.uniform1f(p.u('uShadowBias'), d.shadowBias || 0);
          G.bindTex(5, d.tex || T.atlas);
          // depthBias：貼在車殼上的貼片 (車牌 / 標誌 / 燈) 往相機方向偏移深度，避免與車殼互相穿插
          if (d.depthBias) { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-1, -d.depthBias); }
          G.draw(d.mesh);
          if (d.depthBias) gl.disable(gl.POLYGON_OFFSET_FILL);
        }
        G.bindTex(5, T.atlas);
        gl.uniform1f(p.u('uShadowBias'), 0);
        // 玩家車殼 (貼圖投影 + 烤漆)；f.cars = 多人連線時其他玩家的車殼
        for (const d of shellList) {
          const pc = this.p.car;
          gl.useProgram(pc.p);
          G.bindTex(8, d.tex.A); G.bindTex(9, d.tex.B); G.bindTex(10, d.tex.C);
          for (const k of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) gl.uniform4fv(pc.u('uMap' + k), d.map[k]);
          gl.uniformMatrix4fv(pc.u('uModel'), false, d.model);
          gl.uniform3fv(pc.u('uPaint'), d.paint);
          gl.uniform4fv(pc.u('uLights'), d.lights); gl.uniform4fv(pc.u('uLights2'), d.lights2);
          gl.uniform1f(pc.u('uDirt'), d.dirt || 0);
          gl.uniform1f(pc.u('uPaintMetal'), d.paintMetal === undefined ? 0.45 : d.paintMetal);
          gl.uniform1f(pc.u('uShadowBias'), 0.12);
          gl.uniform1f(pc.u('uGlass'), 0);
          G.draw(d.mesh);
        }
      };
      const sDynamic = () => drawCars(f.dynamic, shells);
      // 靜態物件 + 路面標字 / 貼花
      const sProps = () => {
        propSetup();
        for (const m of f.props) G.draw(m);
        gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -4);
        for (const m of f.decals) G.draw(m);
        gl.disable(gl.POLYGON_OFFSET_FILL);
      };
      const sRoad = () => {
        gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
        p = this.p.road;
        gl.useProgram(p.p);
        G.bindTex(0, T.asphalt); G.bindTex(1, T.concrete); G.bindTex(2, T.cracks); G.bindTex(3, T.dirt);
        gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-1, -2);
        for (const m of f.road) G.draw(m);
        gl.disable(gl.POLYGON_OFFSET_FILL);
        gl.disable(gl.CULL_FACE);
      };
      const sTerrain = () => {
        gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
        p = this.p.terrain;
        gl.useProgram(p.p);
        G.bindTex(0, T.grass); G.bindTex(1, T.canopy); G.bindTex(2, T.rock); G.bindTex(3, T.dirt);
        for (const m of f.terrain) G.draw(m);
        gl.disable(gl.CULL_FACE);
      };
      // 胎痕：半透明疊在路面 / 地面上 (不寫入深度；先畫的車輛、景物靠深度測試正常遮住它)
      const sSkid = () => {
        if (!(f.skid && f.skid.icount > 0)) return;
        const ps = this.p.skid;
        gl.useProgram(ps.p);
        gl.uniform1f(ps.u('uShadowBias'), 0);
        gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-4, -8);
        gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        G.draw(f.skid);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
        gl.disable(gl.POLYGON_OFFSET_FILL);
      };
      // 植生 (instanced)：near = true 只畫近景完整模型 (lodMode 1)，false 畫其餘 (遠景簡化模型、草、遠方建物)
      const sVeg = (near) => {
        p = this.p.inst;
        gl.useProgram(p.p);
        G.bindTex(6, T.foliage);
        gl.uniform1f(p.u('uWind'), f.wind || 1);
        const lr = f.lodRange || [90, 130];
        gl.uniform2f(p.u('uLodRange'), lr[0], lr[1]);
        let lm = -1;
        for (const v of f.inst) {
          const m = v.lodMode || 0;
          if ((m === 1) !== near) continue;
          if (m !== lm) { gl.uniform1f(p.u('uLodMode'), m); lm = m; }
          G.draw(v);
        }
        if (lm !== 0) gl.uniform1f(p.u('uLodMode'), 0);
        if (!near && f.far) G.draw(f.far);
      };
      // 實測 (Intel 內顯 1080p)：比「地形 → 道路 → 物件 → 車 → 樹」的順序快 10 ~ 20%
      sDynamic(); sProps(); sRoad(); sVeg(true); sTerrain(); sSkid(); sVeg(false);
      // 海 (f.water：虛構賽道自己的海網格，可以有好幾塊；沒給就畫北宜的海)
      const seas = f.water || (this.water ? (this._seas = this._seas || [this.water]) : null);
      if (seas && !f.studio && !f.noWater) {
        p = this.p.water; gl.useProgram(p.p);
        for (const m of seas) G.draw(m);
      }
      // 天空
      gl.depthMask(false);
      if (!f.studio) {
        p = this.p.sky;
        gl.useProgram(p.p);
        gl.uniformMatrix4fv(p.u('uInvVP'), false, this.ivp);
        gl.uniform1f(p.u('uCloud'), this.env.cloud);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      // ---------------- 透明
      // Keep the studio framebuffer premultiplied for compositing over the menu artwork.
      gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      if (f.studio && f.studioGround) {
        gl.useProgram(this.p.studioGround.p);
        G.draw(f.studioGround);
      }
      // 玩家車窗：先畫背面 (遠側)，再畫正面
      for (const d of shells) {
        const pc = this.p.car;
        gl.useProgram(pc.p);
        // 多台車時每台的貼圖 / 姿態不同，要重設 (只有一台時沿用不透明階段設好的值)
        if (shells.length > 1) {
          G.bindTex(8, d.tex.A); G.bindTex(9, d.tex.B); G.bindTex(10, d.tex.C);
          for (const k of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) gl.uniform4fv(pc.u('uMap' + k), d.map[k]);
          gl.uniformMatrix4fv(pc.u('uModel'), false, d.model);
          gl.uniform3fv(pc.u('uPaint'), d.paint);
          gl.uniform4fv(pc.u('uLights'), d.lights); gl.uniform4fv(pc.u('uLights2'), d.lights2);
          gl.uniform1f(pc.u('uDirt'), d.dirt || 0);
          gl.uniform1f(pc.u('uPaintMetal'), d.paintMetal === undefined ? 0.45 : d.paintMetal);
          gl.uniform1f(pc.u('uShadowBias'), 0.12);
        }
        gl.uniform1f(pc.u('uGlass'), 1);
        gl.enable(gl.CULL_FACE);
        const gm = d.glassMesh || d.mesh;
        gl.cullFace(gl.FRONT); G.draw(gm);
        gl.cullFace(gl.BACK); G.draw(gm);
        gl.disable(gl.CULL_FACE);
      }
      p = this.p.prop;
      gl.useProgram(p.p);
      gl.uniform1f(p.u('uGlass'), 1);
      gl.uniform1f(p.u('uShadowBias'), 0.12);
      for (const d of f.glass) {
        gl.uniformMatrix4fv(p.u('uModel'), false, d.model);
        const L = d.lights || [0, 0, 0, 0], L2 = d.lights2 || [0, 0, 0, 0];
        gl.uniform4f(p.u('uLights'), L[0], L[1], L[2], L[3]);
        gl.uniform4f(p.u('uLights2'), L2[0], L2[1], L2[2], L2[3]);
        G.bindTex(5, d.tex || T.atlas);
        if (d.depthBias) { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-1, -d.depthBias); }
        G.draw(d.mesh);
        if (d.depthBias) gl.disable(gl.POLYGON_OFFSET_FILL);
      }
      G.bindTex(5, T.atlas);
      gl.uniform1f(p.u('uGlass'), 0);
      gl.uniform1f(p.u('uShadowBias'), 0);
      // 粒子
      if (f.partCount > 0) {
        p = this.p.part; gl.useProgram(p.p);
        G.setInstances(this.partMesh, f.partData.subarray(0, f.partCount * 12), f.partCount);
        G.draw(this.partMesh);
      }
      // 光暈
      if (f.glowCount > 0) {
        gl.blendFunc(gl.ONE, gl.ONE);
        p = this.p.glow; gl.useProgram(p.p);
        G.setInstances(this.glowMesh, f.glowData.subarray(0, f.glowCount * 12), f.glowCount);
        G.draw(this.glowMesh);
      }
      // 幽靈車 (挑戰紀錄，js/game/replay.js Ghost)：半透明，放在最後畫。
      // 先只寫深度 (每個像素只留幽靈車最前面那一層)，再用固定透明度把顏色疊上去 —— 車身不會透出自己背面、輪子、內裝
      const gh = f.ghost;
      if (gh && (gh.list.length || gh.shells.length) && gh.alpha > 0.01) {
        gl.disable(gl.BLEND);
        gl.depthMask(true); gl.colorMask(false, false, false, false);
        drawCars(gh.list, gh.shells);
        gl.colorMask(true, true, true, true);
        gl.depthMask(false);
        gl.enable(gl.BLEND); gl.blendColor(0, 0, 0, gh.alpha); gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
        drawCars(gh.list, gh.shells);
        G.bindTex(5, T.atlas);
      }
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      this._present();
      this._gpuEnd();
    }
  }

  RM.Renderer = Renderer;
  RM.ENV = ENV;
})();
