'use strict';
// 基礎數學：vec3 (Array), quat [x,y,z,w], mat4 (Float32Array, column-major), 雜訊與亂數
(function () {
  const RM = (window.RM = window.RM || {});

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const smoothstep = (a, b, x) => smooth((x - a) / (b - a));
  const expDecay = (rate, dt) => 1 - Math.exp(-rate * dt);

  // ---------------------------------------------------------------- vec3
  const v3 = {
    c: (x = 0, y = 0, z = 0) => [x, y, z],
    set(o, x, y, z) { o[0] = x; o[1] = y; o[2] = z; return o; },
    copy(o, a) { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; },
    add(o, a, b) { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o; },
    sub(o, a, b) { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o; },
    scale(o, a, s) { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; },
    madd(o, a, b, s) { o[0] = a[0] + b[0] * s; o[1] = a[1] + b[1] * s; o[2] = a[2] + b[2] * s; return o; },
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross(o, a, b) {
      const x = a[1] * b[2] - a[2] * b[1], y = a[2] * b[0] - a[0] * b[2], z = a[0] * b[1] - a[1] * b[0];
      o[0] = x; o[1] = y; o[2] = z; return o;
    },
    len: (a) => Math.hypot(a[0], a[1], a[2]),
    dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
    norm(o, a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; o[0] = a[0] / l; o[1] = a[1] / l; o[2] = a[2] / l; return o; },
    lerp(o, a, b, t) { o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; return o; },
  };

  // ---------------------------------------------------------------- quat
  const quat = {
    c: () => [0, 0, 0, 1],
    axisAngle(o, ax, ang) {
      const s = Math.sin(ang / 2);
      o[0] = ax[0] * s; o[1] = ax[1] * s; o[2] = ax[2] * s; o[3] = Math.cos(ang / 2); return o;
    },
    mul(o, a, b) {
      const ax = a[0], ay = a[1], az = a[2], aw = a[3], bx = b[0], by = b[1], bz = b[2], bw = b[3];
      o[0] = aw * bx + ax * bw + ay * bz - az * by;
      o[1] = aw * by - ax * bz + ay * bw + az * bx;
      o[2] = aw * bz + ax * by - ay * bx + az * bw;
      o[3] = aw * bw - ax * bx - ay * by - az * bz;
      return o;
    },
    norm(o, a) { const l = Math.hypot(a[0], a[1], a[2], a[3]) || 1; o[0] = a[0] / l; o[1] = a[1] / l; o[2] = a[2] / l; o[3] = a[3] / l; return o; },
    // 旋轉向量 v
    rot(o, q, v) {
      const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
      const tx = 2 * (qy * v[2] - qz * v[1]), ty = 2 * (qz * v[0] - qx * v[2]), tz = 2 * (qx * v[1] - qy * v[0]);
      o[0] = v[0] + qw * tx + (qy * tz - qz * ty);
      o[1] = v[1] + qw * ty + (qz * tx - qx * tz);
      o[2] = v[2] + qw * tz + (qx * ty - qy * tx);
      return o;
    },
    // 以世界角速度 w 積分
    integrate(q, w, dt) {
      const hx = w[0] * dt * 0.5, hy = w[1] * dt * 0.5, hz = w[2] * dt * 0.5;
      const x = q[0], y = q[1], z = q[2], ww = q[3];
      q[0] = x + hx * ww + hy * z - hz * y;
      q[1] = y + hy * ww + hz * x - hx * z;
      q[2] = z + hz * ww + hx * y - hy * x;
      q[3] = ww - hx * x - hy * y - hz * z;
      return quat.norm(q, q);
    },
    // 3x3 旋轉矩陣 (column-major, m[c*3+r])
    toMat3(m, q) {
      const x = q[0], y = q[1], z = q[2], w = q[3];
      const x2 = x + x, y2 = y + y, z2 = z + z;
      const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
      m[0] = 1 - (yy + zz); m[1] = xy + wz; m[2] = xz - wy;
      m[3] = xy - wz; m[4] = 1 - (xx + zz); m[5] = yz + wx;
      m[6] = xz + wy; m[7] = yz - wx; m[8] = 1 - (xx + yy);
      return m;
    },
    // 由基底 (right, up, back) 建立
    fromBasis(o, r, u, b) {
      const m00 = r[0], m10 = r[1], m20 = r[2], m01 = u[0], m11 = u[1], m21 = u[2], m02 = b[0], m12 = b[1], m22 = b[2];
      const tr = m00 + m11 + m22;
      if (tr > 0) {
        const s = 0.5 / Math.sqrt(tr + 1);
        o[3] = 0.25 / s; o[0] = (m21 - m12) * s; o[1] = (m02 - m20) * s; o[2] = (m10 - m01) * s;
      } else if (m00 > m11 && m00 > m22) {
        const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
        o[3] = (m21 - m12) / s; o[0] = 0.25 * s; o[1] = (m01 + m10) / s; o[2] = (m02 + m20) / s;
      } else if (m11 > m22) {
        const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
        o[3] = (m02 - m20) / s; o[0] = (m01 + m10) / s; o[1] = 0.25 * s; o[2] = (m12 + m21) / s;
      } else {
        const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
        o[3] = (m10 - m01) / s; o[0] = (m02 + m20) / s; o[1] = (m12 + m21) / s; o[2] = 0.25 * s;
      }
      return quat.norm(o, o);
    },
  };

  // ---------------------------------------------------------------- mat4
  const m4 = {
    c: () => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
    ident(o) { o.fill(0); o[0] = o[5] = o[10] = o[15] = 1; return o; },
    mul(o, a, b) {
      const r = m4._t;
      for (let c = 0; c < 4; c++) {
        const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
        r[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
        r[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
        r[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
        r[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
      }
      o.set(r); return o;
    },
    _t: new Float32Array(16),
    persp(o, fovy, aspect, near, far) {
      const f = 1 / Math.tan(fovy / 2);
      o.fill(0);
      o[0] = f / aspect; o[5] = f; o[10] = (far + near) / (near - far); o[11] = -1; o[14] = (2 * far * near) / (near - far);
      return o;
    },
    ortho(o, l, r, b, t, n, f) {
      o.fill(0);
      o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n);
      o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1;
      return o;
    },
    lookAt(o, eye, at, up) {
      let zx = eye[0] - at[0], zy = eye[1] - at[1], zz = eye[2] - at[2];
      let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
      let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
      l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
      const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
      o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
      o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
      o[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
      o[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
      o[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
      o[15] = 1;
      return o;
    },
    invert(o, a) {
      const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
      const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
      const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
      const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
      const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
      const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
      let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
      if (!det) return null;
      det = 1 / det;
      o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
      o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
      o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
      o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
      o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
      o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
      o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
      o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
      return o;
    },
    // 旋轉 + 平移 (+ 均勻/非均勻縮放)
    fromQP(o, q, p, sx = 1, sy = sx, sz = sx) {
      const x = q[0], y = q[1], z = q[2], w = q[3];
      const x2 = x + x, y2 = y + y, z2 = z + z;
      const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
      o[0] = (1 - (yy + zz)) * sx; o[1] = (xy + wz) * sx; o[2] = (xz - wy) * sx; o[3] = 0;
      o[4] = (xy - wz) * sy; o[5] = (1 - (xx + zz)) * sy; o[6] = (yz + wx) * sy; o[7] = 0;
      o[8] = (xz + wy) * sz; o[9] = (yz - wx) * sz; o[10] = (1 - (xx + yy)) * sz; o[11] = 0;
      o[12] = p[0]; o[13] = p[1]; o[14] = p[2]; o[15] = 1;
      return o;
    },
    xformPoint(o, m, p) {
      const x = p[0], y = p[1], z = p[2];
      const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
      o[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
      o[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
      o[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
      return o;
    },
  };

  // 視錐裁切：由 viewProj 取 6 平面
  function frustumPlanes(vp, out) {
    const p = out || new Float32Array(24);
    const r = (i, a, b, c, d) => {
      const l = Math.hypot(a, b, c);
      p[i] = a / l; p[i + 1] = b / l; p[i + 2] = c / l; p[i + 3] = d / l;
    };
    r(0, vp[3] + vp[0], vp[7] + vp[4], vp[11] + vp[8], vp[15] + vp[12]);
    r(4, vp[3] - vp[0], vp[7] - vp[4], vp[11] - vp[8], vp[15] - vp[12]);
    r(8, vp[3] + vp[1], vp[7] + vp[5], vp[11] + vp[9], vp[15] + vp[13]);
    r(12, vp[3] - vp[1], vp[7] - vp[5], vp[11] - vp[9], vp[15] - vp[13]);
    r(16, vp[3] + vp[2], vp[7] + vp[6], vp[11] + vp[10], vp[15] + vp[14]);
    r(20, vp[3] - vp[2], vp[7] - vp[6], vp[11] - vp[10], vp[15] - vp[14]);
    return p;
  }
  function sphereVisible(pl, x, y, z, r) {
    for (let i = 0; i < 24; i += 4) if (pl[i] * x + pl[i + 1] * y + pl[i + 2] * z + pl[i + 3] < -r) return false;
    return true;
  }
  function aabbVisible(pl, x0, y0, z0, x1, y1, z1) {
    for (let i = 0; i < 24; i += 4) {
      const a = pl[i], b = pl[i + 1], c = pl[i + 2];
      const x = a > 0 ? x1 : x0, y = b > 0 ? y1 : y0, z = c > 0 ? z1 : z0;
      if (a * x + b * y + c * z + pl[i + 3] < 0) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- noise / rng
  function hash2(ix, iy, seed) {
    let h = Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263) + Math.imul(seed | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function vnoise(x, y, seed = 0) {
    const ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
  }
  function fbm(x, y, oct = 4, seed = 0) {
    let s = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, seed + i * 17); n += a; a *= 0.5; f *= 2.03; }
    return s / n;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // sRGB hex -> linear [r,g,b]
  function srgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
  }

  Object.assign(RM, {
    clamp, lerp, smooth, smoothstep, expDecay, v3, quat, m4,
    frustumPlanes, sphereVisible, aabbVisible, hash2, vnoise, fbm, rng, b64ToBytes, srgb,
  });
})();
