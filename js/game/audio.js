'use strict';
// WebAudio 合成音效：D16 四缸引擎、VTEC、輪胎尖叫、胎噪、風切、碎石、自排齒輪聲、喇叭、方向燈
(function () {
  const RM = window.RM;

  class CarAudio {
    constructor() { this.ctx = null; this.on = false; this.vol = 0.4; }

    start() {
      if (this.ctx) { this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      comp.connect(ctx.destination);
      const master = (this.master = ctx.createGain());
      master.gain.value = this.vol;
      master.connect(comp);

      const noiseBuf = (len, pink) => {
        const b = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate);
        const d = b.getChannelData(0);
        let b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < d.length; i++) {
          const w = Math.random() * 2 - 1;
          if (pink) { b0 = 0.997 * b0 + w * 0.029; b1 = 0.985 * b1 + w * 0.032; b2 = 0.95 * b2 + w * 0.048; d[i] = (b0 + b1 + b2) * 2.2; }
          else d[i] = w;
        }
        return b;
      };
      const white = noiseBuf(2.5, false), pink = noiseBuf(3, true);
      const loop = (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };

      // ---- 引擎：以「燃燒脈衝循環」取樣，依轉速改變播放速率，再經固定的排氣共鳴濾波
      this.REF = 1000;
      const mkEngine = (amp, decay, noise, ring, seed) => {
        const sr = ctx.sampleRate, ref = this.REF;
        const cyc = 120 / ref, fire = cyc / 4, N = 24;
        const len = Math.round(sr * cyc * N);
        const buf = ctx.createBuffer(1, len, sr);
        const d = buf.getChannelData(0);
        const rnd = RM.rng(seed);
        const cylAmp = [1.0, 0.84, 0.95, 0.88];
        const fp = 1 / (fire * 0.85);
        for (let c = 0; c < N; c++) for (let k = 0; k < 4; k++) {
          const t0 = (c * 4 + k) * fire + (rnd() - 0.5) * fire * 0.05;
          const A = cylAmp[k] * (0.88 + rnd() * 0.24) * amp;
          const i0 = Math.round(t0 * sr), n = Math.round(fire * 1.6 * sr);
          const ph = rnd() * 6.28;
          for (let i = 0; i < n; i++) {
            const t = i / sr;
            const env = Math.exp(-t / (fire * decay)) * (1 - Math.exp(-t / 0.0006));
            const nz = (rnd() * 2 - 1) * noise * Math.exp(-t / (fire * 0.18));
            const v = Math.sin(6.2832 * fp * t) * 0.7 + Math.sin(6.2832 * fp * 2.7 * t + ph) * ring * Math.exp(-t / (fire * 0.35)) + nz;
            d[(i0 + i) % len] += v * env * A;
          }
        }
        let pk = 0; for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(d[i]));
        for (let i = 0; i < len; i++) d[i] *= 0.9 / pk;
        return buf;
      };
      const eng = (this.engGain = ctx.createGain()); eng.gain.value = 0;
      const shelf = ctx.createBiquadFilter(); shelf.type = 'lowshelf'; shelf.frequency.value = 140; shelf.gain.value = 5;
      const pk1 = ctx.createBiquadFilter(); pk1.type = 'peaking'; pk1.frequency.value = 95; pk1.Q.value = 1.4; pk1.gain.value = 5;
      const pk2 = ctx.createBiquadFilter(); pk2.type = 'peaking'; pk2.frequency.value = 340; pk2.Q.value = 1.2; pk2.gain.value = 2.5;
      const lp = (this.engLP = ctx.createBiquadFilter()); lp.type = 'lowpass'; lp.Q.value = 0.6; lp.frequency.value = 900;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 32;
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(2048);
      for (let i = 0; i < 2048; i++) { const x = (i / 2047) * 2 - 1; curve[i] = Math.tanh(x * 1.4) / Math.tanh(1.4); }
      shaper.curve = curve;
      shelf.connect(pk1); pk1.connect(pk2); pk2.connect(lp); lp.connect(hp); hp.connect(shaper); shaper.connect(eng); eng.connect(master);
      const layer = (buf) => {
        const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        const g = ctx.createGain(); g.gain.value = 0;
        src.connect(g); g.connect(shelf); src.start();
        return [src, g];
      };
      [this.srcOn, this.gOn] = layer(mkEngine(1.0, 0.42, 0.35, 0.35, 11));      // 加油
      [this.srcOff, this.gOff] = layer(mkEngine(0.7, 0.25, 0.55, 0.15, 29));    // 收油 (引擎煞車)
      // 進氣吸氣聲 (VTEC 時更明顯)
      const inN = loop(pink);
      const inBP = (this.inBP = ctx.createBiquadFilter()); inBP.type = 'bandpass'; inBP.Q.value = 0.9; inBP.frequency.value = 600;
      const inG = (this.inG = ctx.createGain()); inG.gain.value = 0;
      inN.connect(inBP); inBP.connect(inG); inG.connect(master);
      this.idleJit = 0;

      // ---- 輪胎尖叫
      const sq = loop(white);
      const sqBP = (this.sqBP = ctx.createBiquadFilter()); sqBP.type = 'bandpass'; sqBP.Q.value = 3.5; sqBP.frequency.value = 1050;
      const sqBP2 = ctx.createBiquadFilter(); sqBP2.type = 'bandpass'; sqBP2.Q.value = 2.5; sqBP2.frequency.value = 1900;
      const sqG = (this.sqG = ctx.createGain()); sqG.gain.value = 0;
      sq.connect(sqBP); sqBP.connect(sqG); sq.connect(sqBP2); sqBP2.connect(sqG); sqG.connect(master);
      // ---- 胎噪 / 路噪
      const rd = loop(pink);
      const rdLP = (this.rdLP = ctx.createBiquadFilter()); rdLP.type = 'lowpass'; rdLP.frequency.value = 400;
      const rdG = (this.rdG = ctx.createGain()); rdG.gain.value = 0;
      rd.connect(rdLP); rdLP.connect(rdG); rdG.connect(master);
      // ---- 風切
      const wn = loop(pink);
      const wnBP = ctx.createBiquadFilter(); wnBP.type = 'bandpass'; wnBP.frequency.value = 700; wnBP.Q.value = 0.4;
      const wnG = (this.wnG = ctx.createGain()); wnG.gain.value = 0;
      wn.connect(wnBP); wnBP.connect(wnG); wnG.connect(master);
      // ---- 碎石/草地
      const gv = loop(white);
      const gvBP = ctx.createBiquadFilter(); gvBP.type = 'bandpass'; gvBP.frequency.value = 2600; gvBP.Q.value = 0.7;
      const gvG = (this.gvG = ctx.createGain()); gvG.gain.value = 0;
      gv.connect(gvBP); gvBP.connect(gvG); gvG.connect(master);
      // ---- 摩擦護欄
      const sc = loop(white);
      const scBP = ctx.createBiquadFilter(); scBP.type = 'bandpass'; scBP.frequency.value = 3200; scBP.Q.value = 3;
      const scG = (this.scG = ctx.createGain()); scG.gain.value = 0;
      sc.connect(scBP); scBP.connect(scG); scG.connect(master);
      // ---- 自排齒輪聲
      const wh = (this.oWhine = ctx.createOscillator()); wh.type = 'sine';
      const whG = (this.whG = ctx.createGain()); whG.gain.value = 0;
      wh.connect(whG); whG.connect(master); wh.start();
      // ---- 喇叭 (雙音)
      const hornG = (this.hornG = ctx.createGain()); hornG.gain.value = 0;
      const hornBP = ctx.createBiquadFilter(); hornBP.type = 'bandpass'; hornBP.frequency.value = 800; hornBP.Q.value = 1.2;
      for (const f of [415, 498]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(hornBP); o.start(); }
      hornBP.connect(hornG); hornG.connect(master);
      this.white = white;
      this.on = true;
    }

    setVolume(v) { this.vol = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
    suspend() { if (this.ctx) this.ctx.suspend(); }
    resume() { if (this.ctx) this.ctx.resume(); }

    update(car, dt, opt) {
      if (!this.on) return;
      if (!isFinite(car.rpm) || !isFinite(car.speed) || !isFinite(car.load)) return;
      const ctx = this.ctx, t = ctx.currentTime, k = 0.035;
      const rpm = Math.max(car.rpm, 300);
      const load = car.load;
      const vtec = rpm > (car.S.vtec || 1e9) && load > 0.45 ? 1 : 0;
      const inside = opt.inside ? 1 : 0;
      // 怠速微幅不穩
      this.idleJit += (Math.random() - 0.5) * dt * 60;
      this.idleJit *= Math.exp(-dt * 4);
      const rate = ((rpm + this.idleJit * Math.max(0, 1 - rpm / 1500)) / this.REF) * ((car.S.cyl || 4) / 4);
      this.srcOn.playbackRate.setTargetAtTime(rate, t, 0.02);
      this.srcOff.playbackRate.setTargetAtTime(rate, t, 0.02);
      const on = car.engineOn ? 1 : 0;
      const thr = Math.min(1, Math.max(0, (load - 0.04) / 0.5));
      const base = on * (0.32 + (rpm / 7000) * 0.35);
      this.gOn.gain.setTargetAtTime(base * (0.35 + thr * 0.85), t, 0.05);
      this.gOff.gain.setTargetAtTime(base * (1 - thr) * 0.6, t, 0.06);
      // loud：改裝排氣管 (js/game/tuning.js)，聲音更大、高頻更多 (更沙啞)
      const loud = car.S.loud || 1;
      this.engGain.gain.setTargetAtTime((inside ? 0.75 : 0.95) * Math.min(1.45, Math.sqrt(loud)), t, 0.05);
      const cut = (420 + rpm * (0.18 + thr * 0.22) + vtec * 900) * (1 + (loud - 1) * 0.55);
      this.engLP.frequency.setTargetAtTime(inside ? cut * 0.7 : cut, t, 0.04);
      this.inBP.frequency.setTargetAtTime(350 + rpm * 0.16 + vtec * 500, t, 0.05);
      this.inG.gain.setTargetAtTime(on * (thr * (rpm / 7000) * 0.06 + vtec * 0.07) * (inside ? 1.3 : 0.7), t, 0.05);
      // 輪胎
      let slip = 0, gravel = 0;
      for (const w of car.wheels) {
        if (!w.contact) continue;
        if (w.surf <= 1) slip = Math.max(slip, Math.max(0, w.slipVel - 1.2) * Math.min(1, w.Fz / 3000));
        else gravel = Math.max(gravel, Math.min(1, car.speed / 15));
      }
      // 甩尾時胎聲加大：音量上限提高，且甩尾中至少維持一定音量 (dk 平滑過渡，避免音量突跳)
      this._dk = (this._dk || 0) + ((car.drifting ? 1 : 0) - (this._dk || 0)) * Math.min(1, dt * 6);
      const lvl = Math.max(Math.min(1, slip / 7), 0.7 * this._dk * Math.min(1, car.speed / 10));
      const sqv = lvl * (0.22 + 0.18 * this._dk);
      this.sqG.gain.setTargetAtTime(sqv, t, 0.04);
      this.sqBP.frequency.setTargetAtTime(950 + Math.min(slip, 8) * 60, t, 0.05);
      const v = car.speed;
      const wet = opt.wet || 0;
      this.rdG.gain.setTargetAtTime(Math.min(0.32, v * 0.009) * (1 + wet * 0.8), t, 0.1);
      this.rdLP.frequency.setTargetAtTime(250 + v * 12 + wet * 900, t, 0.1);
      this.wnG.gain.setTargetAtTime(Math.min(0.4, v * v * 0.00012) * (inside ? 0.6 : 1), t, 0.1);
      this.gvG.gain.setTargetAtTime(gravel * 0.28, t, 0.05);
      this.scG.gain.setTargetAtTime((car.scrape || 0) * 0.17, t, 0.05);
      car.scrape = Math.max(0, (car.scrape || 0) - dt * 4);
      const outW = Math.abs(car._outW()) * car.S.final;
      this.oWhine.frequency.setTargetAtTime(Math.max(20, outW * 23 / (2 * Math.PI) * 2), t, 0.05);
      this.whG.gain.setTargetAtTime(Math.min(0.025, outW * 0.0002) * (inside ? 1.5 : 0.6), t, 0.1);
      this.hornG.gain.setTargetAtTime(opt.horn ? 0.22 : 0, t, 0.015);
    }

    burst(gain, freq, dur, q = 1) {
      if (!this.on) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const s = ctx.createBufferSource(); s.buffer = this.white;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
      const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      s.connect(bp); bp.connect(g); g.connect(this.master);
      s.start(t, Math.random()); s.stop(t + dur + 0.05);
    }
    thump(gain, freq, dur) {
      if (!this.on) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.4, t + dur);
      const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
    }
    impact(v, kind) {
      const s = Math.min(1, v / 12);
      // 撞護欄整體小聲一半；'lamp' (撞斷路燈) 沿用金屬聲但維持原音量
      const k = kind === 'rail' ? 0.5 : 1, metal = kind === 'rail' || kind === 'lamp';
      this.thump((0.5 * s + 0.1) * k, 70, 0.35);
      this.burst((0.6 * s + 0.1) * k, metal ? 1800 : 900, 0.25 + s * 0.3, 0.8);
      if (metal) this.burst(0.3 * s * k, 4200, 0.6, 6);
    }
    shift() { this.thump(0.12, 55, 0.12); }
    whoosh(gain, dur) { this.burst(gain, 700, dur, 0.6); this.burst(gain * 0.6, 2200, dur * 0.7, 1.2); }
    tick(on) { this.burst(on ? 0.12 : 0.08, on ? 3400 : 2600, 0.03, 4); }
  }

  RM.CarAudio = CarAudio;
})();
