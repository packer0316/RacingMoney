'use strict';
// 鍵盤 + 搖桿輸入
(function () {
  const RM = window.RM;

  class Input {
    constructor() {
      this.keys = new Set();
      this.edges = [];
      this.thr = 0; this.brk = 0; this.steer = 0;
      this.padPrev = [];
      window.addEventListener('keydown', (e) => {
        // Let dialogs, buttons and volume sliders retain native keyboard behavior.
        if (RM.Game && !['drive', 'finished'].includes(RM.Game.state)) return;
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Backspace', 'ControlLeft', 'ControlRight'].includes(e.code)) e.preventDefault();
        if (!this.keys.has(e.code)) this.edges.push(e.code);
        this.keys.add(e.code);
      });
      window.addEventListener('keyup', (e) => this.keys.delete(e.code));
      window.addEventListener('blur', () => this.keys.clear());
    }
    down(...codes) { return codes.some((c) => this.keys.has(c)); }
    takeEdges() { const e = this.edges; this.edges = []; return e; }

    poll(dt) {
      const k = this;
      const fwKey = k.down('ArrowUp', 'KeyW');
      const bkKey = k.down('ArrowDown', 'KeyS');
      const spKey = k.down('Space');
      const mx = 1;
      // 鍵盤踏板：漸進踩踏
      this.fw = fwKey ? Math.min(mx, (this.fw || 0) + dt * 2.6) : Math.max(0, (this.fw || 0) - dt * 6);
      this.bk = bkKey ? Math.min(mx, (this.bk || 0) + dt * 2.6) : Math.max(0, (this.bk || 0) - dt * 8);
      this.sp = spKey ? Math.min(1, (this.sp || 0) + dt * 3.5) : Math.max(0, (this.sp || 0) - dt * 9);
      let st = 0;
      if (k.down('ArrowLeft', 'KeyA')) st -= 1;
      if (k.down('ArrowRight', 'KeyD')) st += 1;
      const out = { fwd: this.fw, back: this.bk, brakeKey: this.sp, steer: st, analog: false, hand: false, horn: k.down('KeyH'), drift: k.down('ShiftLeft', 'ShiftRight') };
      // 搖桿
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of pads) {
        if (!p || !p.connected) continue;
        const ax = p.axes[0] || 0;
        const dz = Math.abs(ax) < 0.06 ? 0 : (ax - Math.sign(ax) * 0.06) / 0.94;
        const rt = p.buttons[7] ? p.buttons[7].value : 0, lt = p.buttons[6] ? p.buttons[6].value : 0;
        if (Math.abs(dz) > 0.001 || rt > 0.02 || lt > 0.02) {
          out.steer = Math.sign(dz) * Math.pow(Math.abs(dz), 1.4);
          out.analog = true;
          out.fwd = Math.max(out.fwd, rt);
          out.back = Math.max(out.back, lt);
        }
        if (p.buttons[0] && p.buttons[0].pressed) out.brakeKey = 1;
        if (p.buttons[5] && p.buttons[5].pressed) out.drift = true;
        if (p.buttons[1] && p.buttons[1].pressed) out.horn = true;
        const map = { 3: 'KeyC', 9: 'Escape', 2: 'KeyL', 14: 'KeyZ', 15: 'KeyX', 8: 'KeyR', 4: 'ControlLeft' };
        for (const b in map) {
          const pr = p.buttons[b] && p.buttons[b].pressed;
          if (pr && !this.padPrev[b]) this.edges.push(map[b]);
          this.padPrev[b] = pr;
        }
        break;
      }
      return out;
    }
  }

  // ------------------------------------------------------------------ 相機
  const MODES = ['chase', 'far', 'hood', 'cockpit', 'bumper'];
  const MODE_NAME = { chase: '追焦視角', far: '遠景追焦', hood: '引擎蓋視角', cockpit: '駕駛座視角', bumper: '保桿視角' };

  class CameraRig {
    constructor(road) {
      this.road = road; this.mode = 0;
      this.eye = [0, 0, 0]; this.target = [0, 0, 0]; this.up = [0, 1, 0]; this.fov = 60;
      this.yaw = 0; this.init = false; this.hint = { i: 0 };
      this.lookBack = false; this.shake = 0;
    }
    get name() { return MODES[this.mode]; }
    get label() { return MODE_NAME[MODES[this.mode]]; }
    next() { this.mode = (this.mode + 1) % MODES.length; }
    get inside() { return MODES[this.mode] === 'cockpit'; }

    update(dt, car) {
      const R = car.R;
      const right = [R[0], R[1], R[2]], up = [R[3], R[4], R[5]], back = [R[6], R[7], R[8]];
      const fwd = [-back[0], -back[1], -back[2]];
      const P = car.pos;
      const L = (x, y, z) => [P[0] + right[0] * x + up[0] * y + back[0] * z, P[1] + right[1] * x + up[1] * y + back[1] * z, P[2] + right[2] * x + up[2] * y + back[2] * z];
      const mode = MODES[this.mode];
      const hy = Math.atan2(fwd[0], fwd[2]);
      if (!this.init) { this.yaw = hy; this.init = true; }
      // 追焦相機：偏航以彈簧追隨
      let dy = hy - this.yaw;
      while (dy > Math.PI) dy -= 2 * Math.PI;
      while (dy < -Math.PI) dy += 2 * Math.PI;
      this.yaw += dy * (1 - Math.exp(-dt * 5.5));
      const back2 = this.lookBack ? -1 : 1;
      if (mode === 'chase' || mode === 'far') {
        const sz = Math.pow(Math.max(0.5, (car.S.box.front + car.S.box.rear) / 4.43), 0.75);
        const dist = (mode === 'far' ? 9.5 : 5.6) * sz, hgt = (mode === 'far' ? 3.2 : 1.75) * Math.max(0.6, sz);
        const dir = [Math.sin(this.yaw), 0, Math.cos(this.yaw)];
        const e = [P[0] - dir[0] * dist * back2, P[1] + hgt, P[2] - dir[2] * dist * back2];
        if (this._snap && this.road.data.spiral) this.hint.i = car.hint.i;
        const g = this.road.ground(e[0], e[2], this.hint, e[1]);
        if (e[1] < g.y + 0.6) e[1] = g.y + 0.6;
        const k = 1 - Math.exp(-dt * 14);
        for (let i = 0; i < 3; i++) this.eye[i] += (e[i] - this.eye[i]) * (this._snap ? 1 : k);
        this._snap = false;
        this.target = [P[0] + dir[0] * 2.5 * back2, P[1] + 0.75, P[2] + dir[2] * 2.5 * back2];
        this.up = [0, 1, 0];
        this.fovKick = (this.fovKick || 0) + ((car.nitroT > 0 ? 9 : car.boostT > 0 ? 4 : 0) - (this.fovKick || 0)) * Math.min(1, dt * 4);
        this.fov = (mode === 'far' ? 55 : 62) + Math.min(10, car.speed * 0.12) + this.fovKick;
      } else {
        let lp;
        if (mode === 'cockpit') lp = car.S.eye.slice();
        else if (mode === 'hood') lp = car.S.hood.slice();
        else lp = car.S.bumper.slice();
        this.eye = L(lp[0], lp[1], lp[2]);
        const look = mode === 'cockpit' ? [lp[0] + 0.0, lp[1] - 0.55, lp[2] - 10 * back2] : [lp[0], lp[1] - 0.35, lp[2] - 10 * back2];
        this.target = L(look[0], look[1], look[2]);
        this.up = up.slice();
        this.fov = mode === 'cockpit' ? 70 : 66;
      }
      // 震動
      const sh = this.shake;
      this.shake *= Math.exp(-dt * 6);
      if (sh > 0.0005) {
        const t = performance.now() * 0.001;
        this.eye[1] += Math.sin(t * 41) * sh * 0.5 + Math.sin(t * 67) * sh * 0.3;
      }
    }
    snap() { this._snap = true; this.init = false; }
  }

  RM.Input = Input;
  RM.CameraRig = CameraRig;
})();
