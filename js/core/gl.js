'use strict';
// WebGL2 工具：shader / mesh (VAO) / texture / UBO / shadow FBO
(function () {
  const RM = window.RM;

  // 固定 attribute location
  const ATTR = { aPos: 0, aNormal: 1, aUV: 2, aColor: 3, aExtra: 4, iA: 5, iB: 6, iC: 7 };
  // 固定 sampler 單元
  const UNITS = { uAlbedo: 0, uTex1: 1, uTex2: 2, uTex3: 3, uNoise: 4, uAtlas: 5, uTex6: 6, uShadowMap: 7, uCarA: 8, uCarB: 9, uCarC: 10, uSurface: 11 };

  const GLU = {
    gl: null, aniso: null, maxAniso: 1,

    init(canvas) {
      // 畫布本身不做 MSAA、不需深度：場景畫在 Renderer 的離屏目標 (可選 MSAA / FXAA)，最後才複製到畫布
      const gl = canvas.getContext('webgl2', {
        antialias: false, alpha: true, depth: false, stencil: false,
        powerPreference: 'high-performance', premultipliedAlpha: true,
      });
      if (!gl) throw new Error('此瀏覽器不支援 WebGL2');
      this.gl = gl;
      this.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
      if (this.aniso) this.maxAniso = gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
      return gl;
    },

    compile(type, src, name) {
      const gl = this.gl;
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh);
        const lines = src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n');
        console.error('Shader compile error [' + name + ']\n' + log + '\n' + lines);
        throw new Error('Shader 編譯失敗: ' + name + '\n' + log);
      }
      return sh;
    },

    program(vs, fs, name) {
      const gl = this.gl;
      const p = gl.createProgram();
      gl.attachShader(p, this.compile(gl.VERTEX_SHADER, vs, name + '.vs'));
      gl.attachShader(p, this.compile(gl.FRAGMENT_SHADER, fs, name + '.fs'));
      for (const k in ATTR) gl.bindAttribLocation(p, ATTR[k], k);
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(p);
        console.error('Link error [' + name + ']', log);
        throw new Error('Shader 連結失敗: ' + name + '\n' + log);
      }
      const bi = gl.getUniformBlockIndex(p, 'Frame');
      if (bi !== gl.INVALID_INDEX) gl.uniformBlockBinding(p, bi, 0);
      gl.useProgram(p);
      for (const k in UNITS) {
        const l = gl.getUniformLocation(p, k);
        if (l) gl.uniform1i(l, UNITS[k]);
      }
      const prog = { p, name, locs: {} };
      prog.u = (n) => {
        let l = prog.locs[n];
        if (l === undefined) { l = gl.getUniformLocation(p, n); prog.locs[n] = l; }
        return l;
      };
      return prog;
    },

    // attrs: { aPos:Float32Array(3n), aNormal, aUV(2), aColor(4), aExtra(4) }, index: Uint16/32Array
    mesh(attrs, index, sizes) {
      const gl = this.gl;
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const bufs = [];
      const defSize = { aPos: 3, aNormal: 3, aUV: 2, aColor: 4, aExtra: 4 };
      let count = 0;
      for (const k in attrs) {
        const data = attrs[k];
        if (!data) continue;
        const size = (sizes && sizes[k]) || defSize[k];
        const b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(ATTR[k]);
        if (data instanceof Uint8Array) gl.vertexAttribPointer(ATTR[k], size, gl.UNSIGNED_BYTE, true, 0, 0);
        else gl.vertexAttribPointer(ATTR[k], size, gl.FLOAT, false, 0, 0);
        bufs.push(b);
        if (k === 'aPos') count = data.length / size;
      }
      let ib = null, itype = 0, icount = 0;
      if (index) {
        ib = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index, gl.STATIC_DRAW);
        itype = index instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
        icount = index.length;
      }
      gl.bindVertexArray(null);
      return { vao, bufs, ib, itype, icount, count, instBuf: null, instCount: 0 };
    },

    // 為 mesh 加上 instance buffer：每 instance 3 個 vec4 (iA,iB,iC)
    setInstances(mesh, data, n) {
      const gl = this.gl;
      gl.bindVertexArray(mesh.vao);
      if (!mesh.instBuf) mesh.instBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.instBuf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      for (let i = 0; i < 3; i++) {
        gl.enableVertexAttribArray(5 + i);
        gl.vertexAttribPointer(5 + i, 4, gl.FLOAT, false, 48, i * 16);
        gl.vertexAttribDivisor(5 + i, 1);
      }
      gl.bindVertexArray(null);
      mesh.instCount = n;
    },

    // 共用 geometry、各自 instance buffer 的 VAO
    // sharedBuf：沿用另一個 view 的 instance buffer (同一批樹的遠景簡化模型)；此時 data 可為 null，刪除時不刪 buffer
    instancedView(base, data, n, sharedBuf) {
      const gl = this.gl;
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      // 重新綁定 base 的頂點屬性
      const m = { vao, ib: base.ib, itype: base.itype, icount: base.icount, count: base.count, instCount: n, bufs: [] };
      base.attrBind(gl);
      if (base.ib) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, base.ib);
      const ib = sharedBuf || gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, ib);
      if (sharedBuf) m.sharedInst = true;
      else gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      for (let i = 0; i < 3; i++) {
        gl.enableVertexAttribArray(5 + i);
        gl.vertexAttribPointer(5 + i, 4, gl.FLOAT, false, 48, i * 16);
        gl.vertexAttribDivisor(5 + i, 1);
      }
      gl.bindVertexArray(null);
      m.instBuf = ib;
      return m;
    },

    // 建立可被多個 instancedView 共用的 geometry
    sharedGeometry(attrs, index) {
      const gl = this.gl;
      const defSize = { aPos: 3, aNormal: 3, aUV: 2, aColor: 4, aExtra: 4 };
      const list = [];
      let count = 0;
      for (const k in attrs) {
        if (!attrs[k]) continue;
        const b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, attrs[k], gl.STATIC_DRAW);
        list.push([ATTR[k], defSize[k], b]);
        if (k === 'aPos') count = attrs[k].length / 3;
      }
      let ib = null, itype = 0, icount = 0;
      if (index) {
        ib = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index, gl.STATIC_DRAW);
        itype = index instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
        icount = index.length;
      }
      return {
        ib, itype, icount, count,
        attrBind(g) {
          for (const [loc, size, b] of list) {
            g.bindBuffer(g.ARRAY_BUFFER, b);
            g.enableVertexAttribArray(loc);
            g.vertexAttribPointer(loc, size, g.FLOAT, false, 0, 0);
          }
        },
      };
    },

    draw(mesh, mode) {
      const gl = this.gl;
      gl.bindVertexArray(mesh.vao);
      const m = mode === undefined ? gl.TRIANGLES : mode;
      if (mesh.instCount) {
        if (mesh.ib) gl.drawElementsInstanced(m, mesh.icount, mesh.itype, 0, mesh.instCount);
        else gl.drawArraysInstanced(m, 0, mesh.count, mesh.instCount);
      } else if (mesh.ib) gl.drawElements(m, mesh.icount, mesh.itype, 0);
      else gl.drawArrays(m, 0, mesh.count);
    },

    deleteMesh(mesh) {
      const gl = this.gl;
      if (!mesh) return;
      gl.deleteVertexArray(mesh.vao);
      for (const b of mesh.bufs || []) gl.deleteBuffer(b);
      if (mesh.ib && !mesh.sharedIb) gl.deleteBuffer(mesh.ib);
      if (mesh.instBuf) gl.deleteBuffer(mesh.instBuf);
    },

    texture(src, opt = {}) {
      const gl = this.gl;
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      const internal = opt.linear ? gl.RGBA8 : gl.SRGB8_ALPHA8;
      if (src instanceof Uint8Array) {
        gl.texImage2D(gl.TEXTURE_2D, 0, internal, opt.w, opt.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, internal, gl.RGBA, gl.UNSIGNED_BYTE, src);
      }
      const wrap = opt.clamp ? gl.CLAMP_TO_EDGE : gl.REPEAT;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      if (opt.nearest) {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        return t;
      }
      if (opt.nomip) {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      } else {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      if (this.aniso && !opt.nomip) {
        gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(opt.aniso || 8, this.maxAniso));
      }
      return t;
    },

    // Linear packed material layers: R = shade, GB = normal slopes, A = roughness.
    // Array layers mip independently, so repeating materials cannot bleed into each other.
    surfaceTexture(layers, size) {
      const gl = this.gl, tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, Math.log2(size) + 1, gl.RGBA8, size, size, layers.length);
      layers.forEach((data, layer) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, data));
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
      if (this.aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(2, this.maxAniso));
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
      return tex;
    },

    bindTex(unit, tex) {
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
    },

    ubo(floatCount) {
      const gl = this.gl;
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.UNIFORM_BUFFER, buf);
      gl.bufferData(gl.UNIFORM_BUFFER, floatCount * 4, gl.DYNAMIC_DRAW);
      gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, buf);
      return { buf, data: new Float32Array(floatCount) };
    },
    uboUpload(u) {
      const gl = this.gl;
      gl.bindBuffer(gl.UNIFORM_BUFFER, u.buf);
      gl.bufferSubData(gl.UNIFORM_BUFFER, 0, u.data);
    },

    shadowTarget(size) {
      const gl = this.gl;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
      gl.drawBuffers([gl.NONE]);
      gl.readBuffer(gl.NONE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { tex, fbo, size };
    },
  };

  RM.GLU = GLU;
  RM.ATTR = ATTR;
})();
