'use strict';
// 胎痕：輪胎打滑 (甩尾、鎖死煞車、原地燒胎起步) 時，沿接地點軌跡在路面留下深色帶狀痕跡。
// 以環狀緩衝區的動態四邊形實作，寫滿後從最舊的開始覆蓋；每幀只上傳新增的那幾格。
(function () {
  const RM = window.RM;
  const V = RM.v3;
  const FPV = 8;            // 每頂點：pos(3) normal(3) uv(2)；uv = (橫向 0..1, 濃度)
  const QF = FPV * 4;       // 每格 4 頂點
  const LIFT = 0.03;        // 浮在路面上方，避免與路面深度打架
  const STEP = 0.14;        // 每前進這麼遠加一段

  class SkidMarks {
    constructor(maxQuads = 8192) {
      const gl = RM.GLU.gl, A = RM.ATTR;
      this.gl = gl;
      this.max = Math.min(maxQuads, 16384);
      this.data = new Float32Array(this.max * QF);
      this.head = 0; this.used = 0;
      this.trail = [null, null, null, null];
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      this.vb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vb);
      gl.bufferData(gl.ARRAY_BUFFER, this.data, gl.DYNAMIC_DRAW);
      const st = FPV * 4;
      gl.enableVertexAttribArray(A.aPos); gl.vertexAttribPointer(A.aPos, 3, gl.FLOAT, false, st, 0);
      gl.enableVertexAttribArray(A.aNormal); gl.vertexAttribPointer(A.aNormal, 3, gl.FLOAT, false, st, 12);
      gl.enableVertexAttribArray(A.aUV); gl.vertexAttribPointer(A.aUV, 2, gl.FLOAT, false, st, 24);
      const idx = new Uint16Array(this.max * 6);
      for (let q = 0; q < this.max; q++) { const b = q * 4, o = q * 6; idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2; idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3; }
      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      // 與 RM.GLU.draw 相容的 mesh 物件
      this.mesh = { vao, ib, itype: gl.UNSIGNED_SHORT, icount: 0, count: this.max * 4, instCount: 0 };
      this._dirty = [];
    }

    // 清除所有胎痕 (重新開始)
    clear() {
      this.data.fill(0);
      this.head = 0; this.used = 0; this.mesh.icount = 0;
      this.trail = [null, null, null, null];
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vb);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data);
    }
    // 中斷目前的軌跡 (車輛被重置 / 瞬移)，已留下的胎痕保留
    cut() { this.trail = [null, null, null, null]; }

    _quad(a, b, n) {
      // a、b：{ l, r, i }；頂點順序 a.l, a.r, b.r, b.l
      const d = this.data, o = this.head * QF;
      const put = (k, p, u, i) => { const q = o + k * FPV; d[q] = p[0]; d[q + 1] = p[1]; d[q + 2] = p[2]; d[q + 3] = n[0]; d[q + 4] = n[1]; d[q + 5] = n[2]; d[q + 6] = u; d[q + 7] = i; };
      put(0, a.l, 0, a.i); put(1, a.r, 1, a.i); put(2, b.r, 1, b.i); put(3, b.l, 0, b.i);
      this._dirty.push(this.head);
      this.head = (this.head + 1) % this.max;
      if (this.used < this.max) this.used++;
    }

    // 每幀呼叫：依四輪打滑程度延伸胎痕
    update(car, dt, wet) {
      const R = car.R, S = car.S;
      const up = [R[3], R[4], R[5]], fwd = [-R[6], -R[7], -R[8]], right = [R[0], R[1], R[2]];
      const hw0 = Math.max(0.06, Math.min(0.15, S.tireR * 0.38));
      const wetK = 1 - 0.55 * (wet || 0);
      for (let k = 0; k < car.wheels.length && k < 4; k++) {
        const w = car.wheels[k];
        let tr = this.trail[k];
        // ---- 這顆輪胎現在該留多濃的痕跡
        let inten = 0;
        if (w.contact && w.surf <= 1 && w.Fz > 250) {
          inten = RM.clamp((w.slipVel - 2.6) / 4.0, 0, 1);
          if (car.drifting) inten = Math.max(inten, w.front ? 0.4 : 1.0);    // 甩尾：後輪濃、前輪淡
          inten *= RM.clamp(w.Fz / 2000, 0.6, 1) * wetK;
        }
        const n = w.gn || up;
        const cp = [w.wpos[0] - up[0] * S.tireR + n[0] * LIFT, w.wpos[1] - up[1] * S.tireR + n[1] * LIFT, w.wpos[2] - up[2] * S.tireR + n[2] * LIFT];
        if (!tr) {
          if (inten > 0.04) this.trail[k] = { p: cp, l: null, r: null, i: 0, a: inten };
          continue;
        }
        const dx = cp[0] - tr.p[0], dy = cp[1] - tr.p[1], dz = cp[2] - tr.p[2];
        const dist = Math.hypot(dx, dy, dz);
        if (dist > 2.5) { this.trail[k] = null; continue; }      // 瞬移：中斷
        tr.a += (inten - tr.a) * Math.min(1, dt * 14);            // 濃度平滑
        if (dist < STEP) {
          if (inten <= 0.04 && tr.a < 0.03 && !tr.l) this.trail[k] = null;
          continue;
        }
        // ---- 沿行進方向加一段；寬度方向 = 地面法線 x 行進方向
        const dir = [dx / dist, dy / dist, dz / dist];
        const side = V.norm([0, 0, 0], V.cross([0, 0, 0], n, dir));
        // 橫滑時接地痕較寬 (胎面寬 → 接地長度)
        const cs = Math.cos(w.steer || 0), sn = Math.sin(w.steer || 0);
        const wf = [fwd[0] * cs + right[0] * sn, fwd[1] * cs + right[1] * sn, fwd[2] * cs + right[2] * sn];
        const sinA = Math.min(1, Math.hypot(wf[1] * dir[2] - wf[2] * dir[1], wf[2] * dir[0] - wf[0] * dir[2], wf[0] * dir[1] - wf[1] * dir[0]));
        const hw = hw0 * (1 + 0.4 * sinA);
        const cur = {
          l: [cp[0] + side[0] * hw, cp[1] + side[1] * hw, cp[2] + side[2] * hw],
          r: [cp[0] - side[0] * hw, cp[1] - side[1] * hw, cp[2] - side[2] * hw],
          i: inten > 0.04 ? tr.a : 0,
        };
        if (!tr.l) {
          // 起點：由 0 淡入
          const b = tr.p;
          tr.l = [b[0] + side[0] * hw, b[1] + side[1] * hw, b[2] + side[2] * hw];
          tr.r = [b[0] - side[0] * hw, b[1] - side[1] * hw, b[2] - side[2] * hw];
          tr.i = 0;
        }
        if (tr.i > 0.004 || cur.i > 0.004) this._quad(tr, cur, n);
        if (cur.i <= 0.004 && inten <= 0.04) { this.trail[k] = null; continue; }   // 已淡出：結束這條
        tr.p = cp; tr.l = cur.l; tr.r = cur.r; tr.i = cur.i;
      }
      this._flush();
    }

    _flush() {
      const D = this._dirty;
      if (!D.length) return;
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vb);
      for (const q of D) gl.bufferSubData(gl.ARRAY_BUFFER, q * QF * 4, this.data, q * QF, QF);
      D.length = 0;
      this.mesh.icount = this.used * 6;
    }
  }

  RM.SkidMarks = SkidMarks;
})();
