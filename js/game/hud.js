'use strict';
// 2D 抬頭顯示：K8 儀表、檔位指示、路名/里程、小地圖、高度剖面、計時
(function () {
  const RM = window.RM;
  const F = RM.FONT;

  function fmtTime(t) {
    if (!isFinite(t) || t < 0) return '--:--.--';
    const m = Math.floor(t / 60), s = t - m * 60;
    return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
  }

  // HUD 分區小畫布：每個區塊一張，內容 key 沒變就不重畫。
  // (整張全螢幕 2D 畫布每幀重畫時，光是畫布更新與合成就吃掉內顯好幾 ms 的 GPU 時間)
  class Layer {
    constructor(parent, after) {
      const c = (this.c = document.createElement('canvas'));
      c.style.cssText = 'position:fixed;inset:auto;pointer-events:none;z-index:2;';
      parent.insertBefore(c, after.nextSibling);
      this.g = c.getContext('2d');
      this.x = this.y = this.w = this.h = -1; this.d = 1; this.key = undefined;
    }
    // 版面位置 (CSS px)；尺寸改變才重設畫布
    place(x, y, w, h, d) {
      x = Math.floor(x); y = Math.floor(y); w = Math.max(1, Math.ceil(w)); h = Math.max(1, Math.ceil(h));
      if (x === this.x && y === this.y && w === this.w && h === this.h && d === this.d) return;
      const s = this.c.style;
      if (w !== this.w || h !== this.h || d !== this.d) {
        this.c.width = Math.round(w * d); this.c.height = Math.round(h * d);
        s.width = w + 'px'; s.height = h + 'px';
      }
      s.left = x + 'px'; s.top = y + 'px';
      this.x = x; this.y = y; this.w = w; this.h = h; this.d = d; this.key = undefined;
    }
    // key 與上次相同 → 回傳 null (不重畫)；否則清空並設成「螢幕座標」，繪製程式可直接用整個畫面的座標
    begin(key) {
      if (key === this.key) return null;
      this.key = key;
      const g = this.g, d = this.d;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, this.c.width, this.c.height);
      g.setTransform(d, 0, 0, d, -this.x * d, -this.y * d);
      g.globalAlpha = 1; g.shadowBlur = 0; g.textBaseline = 'middle'; g.textAlign = 'left'; g.lineCap = 'butt'; g.lineJoin = 'miter';
      return g;
    }
  }

  class HUD {
    constructor(canvas, road) {
      this.c = canvas; this.road = road;
      canvas.style.display = 'none'; // 改用分區小畫布
      this.msgs = [];
      this.profile = null;
      const mk = () => new Layer(canvas.parentNode, canvas);
      this.lay = { dash: mk(), nitro: mk(), info: mk(), timer: mk(), map: mk(), msg: mk(), hint: mk(), keys: mk(), fps: mk() };
      this._faces = {};
      this._fpsT = 0; this._fpsTxt = '';
    }
    resize(w, h, dpr) {
      this.w = w; this.h = h; this.dpr = dpr;
      this.scale = Math.min(1.25, Math.max(0.62, Math.min(w / 1500, h / 860)));
      this._faces = {};
      for (const k in this.lay) this.lay[k].key = undefined;
    }
    message(text, dur = 3, color = '#fff', big = false) { this.msgs.push({ text, t: dur, dur, color, big }); }

    setSection(s0, s1, dir) {
      const road = this.road;
      const a = Math.min(s0, s1), b = Math.max(s0, s1);
      const n = 220, pts = [];
      let lo = Infinity, hi = -Infinity;
      for (let k = 0; k <= n; k++) {
        const s = a + ((b - a) * k) / n;
        const y = road.py[Math.min(road.N - 1, Math.round(s / road.sp))];
        pts.push(y); lo = Math.min(lo, y); hi = Math.max(hi, y);
      }
      this.profile = { a, b, pts, lo, hi, dir };
      if (this.lay) this.lay.map.key = undefined;
    }

    // 儀表：錶面 (外框、刻度、數字) 只畫一次存成小畫布，每幀只畫指針
    gauge(g, cx, cy, R, v, vmax, step, minor, label, red, unit, fmt) {
      const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
      const fk = [R, vmax, step, minor, label, red, unit].join(',');
      const face = this._faces[fk] || (this._faces[fk] = this._gaugeFace(R, vmax, step, minor, label, red, unit, fmt));
      g.drawImage(face.c, cx - face.o, cy - face.o, face.s, face.s);
      // 指針 (Honda 橘紅)；光暈用兩道半透明粗線代替 shadowBlur (模糊在 GPU 上很貴)
      const a = a0 + (a1 - a0) * Math.min(1.02, Math.max(0, v / vmax));
      const ca = Math.cos(a), sa = Math.sin(a);
      g.save();
      g.lineCap = 'round';
      const line = (col, w) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(cx - ca * R * 0.12, cy - sa * R * 0.12); g.lineTo(cx + ca * R * 0.86, cy + sa * R * 0.86); g.stroke(); };
      line('rgba(255,90,30,0.13)', R * 0.045 + 7);
      line('rgba(255,90,30,0.26)', R * 0.045 + 3.5);
      line('#ff5a1e', R * 0.045);
      g.fillStyle = '#222'; g.beginPath(); g.arc(cx, cy, R * 0.09, 0, 6.283); g.fill();
      g.restore();
    }
    _gaugeFace(R, vmax, step, minor, label, red, unit, fmt) {
      const d = this.dpr, o = R * 1.08 + 3, s = o * 2;
      const c = document.createElement('canvas');
      c.width = Math.ceil(s * d); c.height = Math.ceil(s * d);
      const g = c.getContext('2d');
      g.setTransform(d, 0, 0, d, 0, 0);
      const cx = o, cy = o;
      const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
      // 外框
      const grd = g.createRadialGradient(cx, cy - R * 0.3, R * 0.2, cx, cy, R * 1.08);
      grd.addColorStop(0, '#1b1c1e'); grd.addColorStop(1, '#050505');
      g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, R * 1.06, 0, 6.283); g.fill();
      g.strokeStyle = 'rgba(200,200,200,0.35)'; g.lineWidth = 2; g.stroke();
      if (red) {
        g.strokeStyle = '#d0202a'; g.lineWidth = R * 0.07;
        g.beginPath(); g.arc(cx, cy, R * 0.9, a0 + (a1 - a0) * (red / vmax), a1); g.stroke();
      }
      for (let x = 0; x <= vmax + 1e-6; x += minor) {
        const a = a0 + (a1 - a0) * (x / vmax);
        const major = Math.abs(x / step - Math.round(x / step)) < 1e-6;
        const r0 = major ? R * 0.78 : R * 0.85;
        g.strokeStyle = red && x >= red ? '#ff4a4a' : '#e8e8e8';
        g.lineWidth = major ? 2.4 : 1.2;
        g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * R * 0.94, cy + Math.sin(a) * R * 0.94); g.stroke();
        if (major) {
          g.fillStyle = red && x >= red ? '#ff5a5a' : '#f0f0f0';
          g.font = `600 ${Math.round(R * 0.15)}px ${F}`; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(fmt ? fmt(x) : String(x), cx + Math.cos(a) * R * 0.62, cy + Math.sin(a) * R * 0.62);
        }
      }
      g.fillStyle = '#bbb'; g.font = `${Math.round(R * 0.11)}px ${F}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(label, cx, cy - R * 0.3);
      if (unit) g.fillText(unit, cx, cy + R * 0.32);
      return { c, o, s: c.width / d };
    }

    draw(st) {
      if (!st) return;
      for (let i = this.msgs.length - 1; i >= 0; i--) {
        const m = this.msgs[i];
        m.t -= st.dt;
        if (m.t <= 0) this.msgs.splice(i, 1);
      }
      this._dash(st);
      this._nitroLayer(st);
      this._info(st);
      this._timer(st);
      this._mapLayer(st);
      this._msgLayer(st);
      this._hintLayer(st);
      this._keysLayer(st);
      this._fpsLayer(st);
    }

    // ---------------- 儀表板 (右下)
    _dashGeom() {
      const S = this.scale, W = this.w, H = this.h;
      const R = 92 * S;
      const cy = H - R - 34 * S;
      return { R, cy, cxT: W - R * 3.35, cxS: W - R * 1.2 };
    }
    _dash(st) {
      const S = this.scale, car = st.car;
      const { R, cy, cxT, cxS } = this._dashGeom();
      const L = this.lay.dash, pad = 4 * S;
      L.place(cxT - R * 1.25 - pad, cy - R * 1.2 - pad, R * 4.55 + pad * 2, R * 2.55 + pad * 2, this.dpr);
      const key = [Math.round(car.rpm / 15), Math.round(st.kmh * 4), car.sel, car.gear, car.shiftT > 0, Math.round(car.fuel * 10),
        st.blinkL && st.blinkOn, st.blinkR && st.blinkOn, st.headOn, car.hand > 0.1, car.abs, Math.floor(car.odo / 1000), Math.floor(car.trip / 100)].join(',');
      const g = L.begin(key);
      if (!g) return;
      // 底板
      g.fillStyle = 'rgba(8,8,10,0.55)';
      this._rr(g, cxT - R * 1.25, cy - R * 1.2, R * 4.55, R * 2.55, 18 * S); g.fill();
      const tmax = Math.ceil((car.S.redline + 1000) / 1000), vmax = car.S.speedoMax || 180;
      this.gauge(g, cxT, cy, R, car.rpm / 1000, tmax, 1, 0.5, 'x1000r/min', Math.round(car.S.redline / 500) / 2, '', null);
      this.gauge(g, cxS, cy, R * 1.08, st.kmh, vmax, vmax > 200 ? 40 : 20, vmax > 200 ? 20 : 10, 'km/h', 0, '', null);
      // 數位速度
      g.fillStyle = '#fff'; g.textAlign = 'center';
      g.font = `700 ${Math.round(30 * S)}px ${F}`;
      g.fillText(String(Math.round(st.kmh)), cxS, cy + R * 0.62);
      // 檔位：R / D
      {
        const by = cy + R * 0.66;
        const items = [['R', car.sel === 1, '#ff6a4a'], ['D', car.sel === 3, '#ffb020']];
        items.forEach(([t, on, col], i) => {
          const x = cxT + (i === 0 ? -22 : 22) * S;
          g.fillStyle = on ? col : 'rgba(255,255,255,0.2)';
          g.font = `${on ? 900 : 600} ${Math.round((on ? 26 : 18) * S)}px ${F}`;
          g.fillText(t, x, by);
        });
        g.fillStyle = 'rgba(255,255,255,0.75)'; g.font = `600 ${Math.round(11 * S)}px ${F}`;
        g.fillText(car.sel === 1 ? '倒車' : `${car.gear} 檔${car.shiftT > 0 ? ' · 換檔中' : ''}`, cxT, cy + R * 0.9);
      }
      // 小儀表：油量、水溫
      const mx = cxT - R * 1.05, my = cy - R * 0.95;
      g.font = `600 ${Math.round(11 * S)}px ${F}`; g.textAlign = 'left';
      g.fillStyle = '#ddd'; g.fillText('E', mx, my); g.fillText('F', mx + 64 * S, my);
      g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(mx + 10 * S, my - 3 * S, 50 * S, 6 * S);
      g.fillStyle = car.fuel < 6 ? '#ff4040' : '#f0f0f0'; g.fillRect(mx + 10 * S, my - 3 * S, (50 * S * car.fuel) / (car.S.tank || 45), 6 * S);
      g.fillStyle = '#ddd'; g.fillText('⛽', mx + 70 * S, my);
      // 指示燈
      const lamps = [];
      if (st.blinkL && st.blinkOn) lamps.push(['◀', '#20e060', mx, my + 22 * S]);
      if (st.blinkR && st.blinkOn) lamps.push(['▶', '#20e060', mx + 26 * S, my + 22 * S]);
      if (st.headOn) lamps.push(['≡D', '#40a0ff', mx + 52 * S, my + 22 * S]);
      if (car.hand > 0.1) lamps.push(['BRAKE', '#ff3030', mx + 86 * S, my + 22 * S]);
      if (!car.abs) lamps.push(['ABS', '#ffb020', mx + 140 * S, my + 22 * S]);
      for (const [t, c, x, y] of lamps) { g.fillStyle = c; g.font = `800 ${Math.round(13 * S)}px ${F}`; g.fillText(t, x, y); }
      // 里程
      g.fillStyle = 'rgba(255,255,255,0.75)'; g.font = `600 ${Math.round(11 * S)}px ${F}`; g.textAlign = 'center';
      g.fillText(`ODO ${String(Math.floor(186420 + car.odo / 1000)).padStart(6, '0')}  TRIP ${(car.trip / 1000).toFixed(1)}`, cxS, cy + R * 1.0);
    }

    // ---------------- 左上：路名、里程、高度、速限
    _info(st) {
      const S = this.scale;
      const px = 18 * S, py = 18 * S;
      const L = this.lay.info;
      L.place(px - 10 * S, py - 10 * S, 344 * S, 176 * S, this.dpr);
      const closed = st.limit === null;
      const warn = !closed && st.kmh > st.limit + 10;
      const key = [st.roadName, st.district, st.km.toFixed(1), Math.round(st.elev), (st.grade * 100).toFixed(1), st.weather, st.camLabel, st.limit, warn].join('|');
      const g = L.begin(key);
      if (!g) return;
      g.fillStyle = 'rgba(8,8,10,0.5)'; this._rr(g, px - 8 * S, py - 8 * S, 330 * S, 112 * S, 12 * S); g.fill();
      if (!closed) this._shield(g, px, py, 44 * S);
      const titleX = closed ? px : px + 54 * S;
      g.fillStyle = '#fff'; g.font = `800 ${Math.round(22 * S)}px ${F}`;
      g.fillText(st.roadName, titleX, py + 14 * S);
      g.font = `500 ${Math.round(14 * S)}px ${F}`; g.fillStyle = '#cfd6dc';
      g.fillText(st.district, titleX, py + 38 * S);
      g.font = `700 ${Math.round(15 * S)}px ${F}`; g.fillStyle = '#ffd34a';
      g.fillText(closed ? `${Math.max(0, st.km).toFixed(1)} km` : `台9線 ${st.km.toFixed(1)}K`, px, py + 66 * S);
      g.fillStyle = '#cfd6dc'; g.font = `500 ${Math.round(14 * S)}px ${F}`;
      g.fillText(`海拔 ${Math.round(st.elev)} m   坡度 ${st.grade >= 0 ? '+' : ''}${(st.grade * 100).toFixed(1)}%`, px + 118 * S, py + 66 * S);
      g.fillText(`${st.weather}  ·  ${st.camLabel}`, px, py + 90 * S);
      // 速限標誌
      if (!closed) this._limit(g, px + 300 * S, py + 132 * S, 26 * S, st.limit, warn);
    }

    // ---------------- 上方中間：計時
    _timer(st) {
      const S = this.scale, W = this.w;
      const L = this.lay.timer;
      L.place(W / 2 - 230 * S, 8 * S, 460 * S, 116 * S, this.dpr);
      const bx0 = W / 2 - 150 * S, bwid = 300 * S;
      const iv = st.interval ? `區間測速中　平均 ${st.interval.avg.toFixed(0)} km/h（限速 ${st.interval.limit}）|${st.interval.over}` : '';
      const key = [fmtTime(st.time), st.section, fmtTime(st.best), Math.round(bwid * Math.max(0, Math.min(1, st.progress)) * 2), st.checkpoints.map((c) => (c.done ? 1 : 0) + ':' + c.p.toFixed(4)).join(','), iv].join('|');
      const g = L.begin(key);
      if (!g) return;
      g.textAlign = 'center';
      g.fillStyle = 'rgba(8,8,10,0.5)'; this._rr(g, W / 2 - 170 * S, 10 * S, 340 * S, 86 * S, 12 * S); g.fill();
      g.fillStyle = '#fff'; g.font = `800 ${Math.round(34 * S)}px ${F}`;
      g.fillText(fmtTime(st.time), W / 2, 40 * S);
      g.font = `500 ${Math.round(13 * S)}px ${F}`; g.fillStyle = '#cfd6dc';
      g.fillText(`${st.section}　最佳 ${fmtTime(st.best)}`, W / 2, 68 * S);
      // 進度條
      g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(bx0, 82 * S, bwid, 5 * S);
      g.fillStyle = '#ffb020'; g.fillRect(bx0, 82 * S, bwid * Math.max(0, Math.min(1, st.progress)), 5 * S);
      for (const cp of st.checkpoints) {
        const x = bx0 + bwid * cp.p;
        g.fillStyle = cp.done ? '#ffb020' : '#888'; g.fillRect(x - 1, 79 * S, 2, 11 * S);
      }
      if (st.interval) {
        g.fillStyle = st.interval.over ? '#ff5050' : '#7dffa0'; g.font = `700 ${Math.round(14 * S)}px ${F}`;
        g.fillText(`區間測速中　平均 ${st.interval.avg.toFixed(0)} km/h（限速 ${st.interval.limit}）`, W / 2, 112 * S);
      }
    }

    // ---------------- 右上：小地圖 + 剖面
    _mapLayer(st) {
      const S = this.scale, W = this.w, car = st.car;
      const L = this.lay.map;
      L.place(W - 244 * S, 12 * S, 236 * S, 300 * S, this.dpr);
      const R9 = car.R;
      let th = 0;
      for (const a of st.traffic) th += Math.round(a.pos[0] * 2) * 7 + Math.round(a.pos[2] * 2) * 13;
      const key = [Math.round(car.pos[0] * 4), Math.round(car.pos[2] * 4), Math.round(Math.atan2(-R9[6], -R9[8]) * 300), st.traffic.length, th,
        Math.round(Math.max(0, Math.min(1, st.progress)) * 880), Math.round(st.elev)].join(',');
      const g = L.begin(key);
      if (!g) return;
      this._minimap(g, W - 120 * S, 120 * S, 100 * S, st);
      this._profile(g, W - 230 * S, 232 * S, 220 * S, 54 * S, st);
    }

    // ---------------- 訊息 (畫面中上)
    _msgLayer(st) {
      const S = this.scale, W = this.w, H = this.h;
      const L = this.lay.msg;
      L.place(0, H * 0.3 - 34 * S, W, 360 * S, this.dpr);
      const al = (m) => Math.max(0, Math.min(1, m.t / 0.4, (m.dur - m.t) / 0.2 + 0.2));
      const key = this.msgs.map((m) => m.text + m.color + (m.big ? 'B' : '') + Math.round(al(m) * 24)).join('|');
      const g = L.begin(key);
      if (!g) return;
      g.textAlign = 'center';
      let my2 = H * 0.3;
      for (const m of this.msgs) {
        g.globalAlpha = al(m);
        g.font = `800 ${Math.round((m.big ? 44 : 24) * S)}px ${F}`;
        g.lineWidth = 5 * S; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineJoin = 'round'; g.strokeText(m.text, W / 2, my2);
        g.fillStyle = m.color; g.fillText(m.text, W / 2, my2);
        my2 += (m.big ? 56 : 34) * S;
        g.globalAlpha = 1;
      }
    }

    // ---------------- 提示 (畫面下方)
    _hintLayer(st) {
      const S = this.scale, W = this.w, H = this.h;
      const L = this.lay.hint;
      L.place(W / 2 - 320 * S, H - 126 * S, 640 * S, 42 * S, this.dpr);
      const g = L.begin(st.hint || '');
      if (!g || !st.hint) return;
      g.textAlign = 'center';
      g.font = `600 ${Math.round(16 * S)}px ${F}`;
      g.fillStyle = 'rgba(0,0,0,0.55)';
      const tw = g.measureText(st.hint).width + 30 * S;
      this._rr(g, W / 2 - tw / 2, H - 122 * S, tw, 34 * S, 10 * S); g.fill();
      g.fillStyle = '#ffe28a'; g.fillText(st.hint, W / 2, H - 105 * S);
    }

    // ---------------- 側邊按鍵說明
    _keysLayer(st) {
      const S = this.scale;
      const rows = [
        ['↑', '前進'], ['↓', '煞車 / 倒車'], ['←', '左轉'], ['→', '右轉'],
        ['CTRL', '氮氣加速'], ['SHIFT', '甩尾'], ['R', '重回賽道'],
      ];
      const x0 = 18 * S, y0 = 175 * S, lh = 22 * S, w = 180 * S;
      const L = this.lay.keys;
      L.place(x0 - 10 * S, y0 - 10 * S, w + 4 * S, rows.length * lh + 34 * S, this.dpr);
      const g = L.begin(st.showKeys ? 'on' : 'off');
      if (!g || !st.showKeys) return;
      g.fillStyle = 'rgba(8,8,10,0.5)'; this._rr(g, x0 - 8 * S, y0 - 8 * S, w, rows.length * lh + 30 * S, 10 * S); g.fill();
      g.textAlign = 'left';
      g.font = `800 ${Math.round(13 * S)}px ${F}`; g.fillStyle = '#ffd34a';
      g.fillText('操作說明', x0, y0 + 6 * S);
      rows.forEach(([k, v], i) => {
        const y = y0 + 28 * S + i * lh;
        g.font = `700 ${Math.round(12 * S)}px ${F}`;
        const kw = g.measureText(k).width + 10 * S;
        g.fillStyle = 'rgba(255,255,255,0.14)'; this._rr(g, x0, y - 9 * S, kw, 18 * S, 4 * S); g.fill();
        g.fillStyle = '#fff'; g.fillText(k, x0 + 5 * S, y);
        g.font = `500 ${Math.round(13 * S)}px ${F}`; g.fillStyle = '#d8dee4';
        g.fillText(v, x0 + 70 * S, y);
      });
    }

    // ---------------- fps (每 0.5 秒更新一次)
    _fpsLayer(st) {
      const S = this.scale, H = this.h;
      this._fpsT -= st.dt || 0;
      if (this._fpsT <= 0) { this._fpsT = 0.5; this._fpsTxt = st.fps || ''; }
      const L = this.lay.fps;
      L.place(6 * S, H - 26 * S, 300 * S, 24 * S, this.dpr);
      const g = L.begin(this._fpsTxt);
      if (!g || !this._fpsTxt) return;
      g.textAlign = 'left'; g.font = `500 ${Math.round(11 * S)}px ${F}`; g.fillStyle = 'rgba(255,255,255,0.5)';
      g.fillText(this._fpsTxt, 10 * S, H - 12 * S);
    }

    // ---------------- 氮氣 (畫面中下方，跑跑卡丁車式)：左邊兩格氮氣瓶 (大格 = 下一瓶，按 Ctrl 使用)，右邊斜角集氣條
    _nitroGeom() {
      const S = this.scale, W = this.w, H = this.h;
      const { R, cxT } = this._dashGeom();
      const A = 58 * S, B = 44 * S, gap = 8 * S, bw = 400 * S, bh = 20 * S, sk = 12 * S;
      const Gw = A + gap + B + 16 * S + bw;
      const x0 = Math.max(12 * S, Math.min(W / 2 - Gw / 2, cxT - R * 1.25 - 14 * S - Gw));
      return { A, B, gap, bw, bh, sk, Gw, x0, bottom: H - 16 * S };
    }
    _nitroLayer(st) {
      const car = st.car, S = this.scale, H = this.h, dt = st.dt || 0;
      const t = (this._t = (this._t || 0) + dt);
      if (this._lastN === undefined) this._lastN = car.nitro;
      if (car.nitro > this._lastN) this._pop = 1;
      this._lastN = car.nitro;
      this._pop = Math.max(0, (this._pop || 0) - dt / 0.35);
      const N = this._nitroGeom();
      const L = this.lay.nitro;
      const top = N.bottom - N.A - 16 * S;
      L.place(N.x0 - 16 * S, top, N.Gw + 32 * S, H - top, this.dpr);
      if (st.noNitro) { L.begin('off'); return; }   // 看重播：氮氣條沒有意義 (那個位置放播放控制列)
      const fill = Math.max(0, Math.min(1, car.gauge));
      const maxed = car.nitro >= 2 && fill >= 1;
      const anim = car.drifting || car.nitroT > 0 || maxed || this._pop > 0;
      const key = [car.nitro, Math.floor(fill * 800), car.drifting ? Math.round(Math.abs(car.beta) * 57.3) : -1, car.nitroT > 0, anim ? t : 0].join(',');
      const g = L.begin(key);
      if (!g) return;
      this._nitro(g, st, N, t, fill, maxed);
    }
    _nitro(g, st, N, t, fill, maxed) {
      const car = st.car, S = this.scale;
      const { A, B, gap, bw, bh, sk, x0, bottom } = N;
      g.save();
      g.textAlign = 'center'; g.textBaseline = 'middle';
      // 光暈：兩道半透明粗線代替 shadowBlur
      const glow = (col, w) => {
        g.save(); g.strokeStyle = col.replace('A', '0.14'); g.lineWidth = w + 9 * S; g.stroke();
        g.strokeStyle = col.replace('A', '0.28'); g.lineWidth = w + 4 * S; g.stroke(); g.restore();
      };
      // ---- 氮氣瓶格
      const slot = (i, x, y, s) => {
        const full = i < car.nitro;
        g.fillStyle = 'rgba(8,10,14,0.68)'; this._rr(g, x, y, s, s, 9 * S); g.fill();
        g.lineWidth = 2 * S;
        if (full) { glow('rgba(80,190,255,A)', 2 * S); g.strokeStyle = '#7fd8ff'; }
        else g.strokeStyle = 'rgba(255,255,255,0.28)';
        g.stroke();
        if (full) {
          const k = i === car.nitro - 1 ? 1 + 0.3 * Math.sin(this._pop * Math.PI) : 1;
          this._canister(g, x + s / 2, y + s / 2, s * 0.8 * k);
        }
        if (i === 0) {
          g.font = `800 ${Math.round(9 * S)}px ${F}`;
          const tw = g.measureText('Ctrl').width + 8 * S;
          g.fillStyle = 'rgba(0,0,0,0.7)'; this._rr(g, x + s - tw - 3 * S, y + s - 15 * S, tw, 12 * S, 4 * S); g.fill();
          g.fillStyle = full ? '#fff' : 'rgba(255,255,255,0.4)';
          g.fillText('Ctrl', x + s - 3 * S - tw / 2, y + s - 9 * S);
        }
      };
      slot(0, x0, bottom - A, A);
      slot(1, x0 + A + gap, bottom - B, B);
      // ---- 集氣條
      const bx = x0 + A + gap + B + 16 * S, by = bottom - B / 2 - bh / 2;
      const para = (x, y, w, h) => { g.beginPath(); g.moveTo(x + sk, y); g.lineTo(x + w, y); g.lineTo(x + w - sk, y + h); g.lineTo(x, y + h); g.closePath(); };
      g.fillStyle = 'rgba(8,10,14,0.68)'; para(bx - 5 * S, by - 5 * S, bw + 10 * S, bh + 10 * S); g.fill();
      g.save();
      para(bx, by, bw, bh); g.clip();
      g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(bx, by, bw, bh);
      const grd = g.createLinearGradient(bx, 0, bx + bw, 0);
      grd.addColorStop(0, '#1748ff'); grd.addColorStop(0.6, '#25b4ff'); grd.addColorStop(1, '#a6f6ff');
      g.fillStyle = grd; g.fillRect(bx, by, bw * fill, bh);
      g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(bx, by, bw * fill, bh * 0.35);
      if (car.drifting && fill > 0) { // 甩尾集氣中：流動斜紋
        g.fillStyle = 'rgba(255,255,255,0.22)';
        const step = 22 * S, off = (t * 140 * S) % step, xe = bx + bw * fill;
        for (let x = bx - bh + off; x < xe; x += step) {
          g.beginPath(); g.moveTo(x, by + bh); g.lineTo(x + bh * 0.6, by); g.lineTo(x + bh * 0.6 + 8 * S, by); g.lineTo(x + 8 * S, by + bh); g.closePath(); g.fill();
        }
      }
      if (car.nitroT > 0) { // 使用中：剩餘時間 (火焰色)
        const gr2 = g.createLinearGradient(bx, 0, bx + bw, 0);
        gr2.addColorStop(0, '#ff3d00'); gr2.addColorStop(0.5, '#ff9a1f'); gr2.addColorStop(1, '#ffe66b');
        g.globalAlpha = 0.85 + Math.random() * 0.15; g.fillStyle = gr2; g.fillRect(bx, by, bw * Math.min(1, car.nitroT / 3), bh); g.globalAlpha = 1;
      }
      g.fillStyle = 'rgba(0,0,0,0.35)';
      for (const p of [0.25, 0.5, 0.75]) g.fillRect(bx + bw * p - 1, by, 2, bh);
      g.restore();
      g.lineWidth = 2 * S;
      para(bx, by, bw, bh);
      if (car.drifting || maxed || car.nitroT > 0) glow(car.nitroT > 0 ? 'rgba(255,140,40,A)' : 'rgba(80,190,255,A)', 2 * S);
      g.strokeStyle = car.nitroT > 0 ? '#ffb347' : maxed ? `rgba(127,216,255,${0.6 + 0.4 * Math.sin(t * 8)})` : car.drifting ? '#7fd8ff' : 'rgba(255,255,255,0.35)';
      g.stroke();
      // ---- 標籤
      g.textBaseline = 'alphabetic';
      g.font = `italic 900 ${Math.round(15 * S)}px ${F}`;
      g.lineWidth = 3 * S; g.strokeStyle = 'rgba(0,0,0,0.6)';
      const lab = car.nitroT > 0 ? 'BOOST!' : car.drifting ? `甩尾中 ${Math.round(Math.abs(car.beta) * 57.3)}°` : 'N₂O';
      g.textAlign = 'left'; g.fillStyle = car.nitroT > 0 ? '#ffb347' : '#7fd8ff';
      g.strokeText(lab, bx + sk, by - 8 * S); g.fillText(lab, bx + sk, by - 8 * S);
      const pct = maxed ? 'MAX' : `${Math.floor(fill * 100)}%`;
      g.textAlign = 'right'; g.fillStyle = maxed ? '#fff' : '#cfeeff';
      g.strokeText(pct, bx + bw, by - 8 * S); g.fillText(pct, bx + bw, by - 8 * S);
      g.restore();
      g.textBaseline = 'middle'; g.textAlign = 'center';
    }
    // 氮氣瓶圖示
    _canister(g, cx, cy, s) {
      const bw = s * 0.44, bh = s * 0.7, x = cx - bw / 2, y = cy - bh / 2 + s * 0.08;
      g.fillStyle = '#cfd6dc';
      g.fillRect(cx - bw * 0.18, y - s * 0.1, bw * 0.36, s * 0.11);  // 瓶頸
      g.fillRect(cx - bw * 0.05, y - s * 0.16, bw * 0.5, s * 0.05);  // 閥門
      const gr = g.createLinearGradient(x, 0, x + bw, 0);
      gr.addColorStop(0, '#0b3d9e'); gr.addColorStop(0.35, '#3fa9ff'); gr.addColorStop(0.6, '#9ae6ff'); gr.addColorStop(1, '#1f6fe0');
      g.fillStyle = gr; this._rr(g, x, y, bw, bh, bw * 0.35); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.92)'; g.fillRect(x, y + bh * 0.36, bw, bh * 0.28);
      g.fillStyle = '#0b3d9e'; g.font = `900 ${Math.max(7, Math.round(s * 0.17))}px ${F}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('N₂O', cx, y + bh * 0.5);
    }

    _rr(g, x, y, w, h, r) {
      g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
    }
    _shield(g, x, y, s) {
      g.fillStyle = '#fff'; g.strokeStyle = '#111'; g.lineWidth = s * 0.06;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + s, y); g.lineTo(x + s, y + s * 0.55); g.quadraticCurveTo(x + s, y + s * 0.9, x + s / 2, y + s);
      g.quadraticCurveTo(x, y + s * 0.9, x, y + s * 0.55); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#111'; g.font = `800 ${Math.round(s * 0.36)}px ${F}`; g.textAlign = 'center';
      g.fillText('台9', x + s / 2, y + s * 0.45); g.textAlign = 'left';
    }
    _limit(g, x, y, r, v, warn) {
      g.fillStyle = warn ? '#ff2020' : '#c8102e'; g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, r * 0.76, 0, 6.283); g.fill();
      g.fillStyle = '#111'; g.font = `800 ${Math.round(r * 0.85)}px ${F}`; g.textAlign = 'center'; g.fillText(String(v), x, y + 1);
      g.textAlign = 'left';
    }
    _minimap(g, cx, cy, R, st) {
      const road = this.road, car = st.car;
      g.save();
      g.fillStyle = 'rgba(8,10,12,0.55)'; g.beginPath(); g.arc(cx, cy, R, 0, 6.283); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 1.5; g.stroke();
      g.beginPath(); g.arc(cx, cy, R - 1, 0, 6.283); g.clip();
      const scale = R / 420;
      const R9 = car.R;
      const hy = Math.atan2(-R9[6], -R9[8]);
      const c = Math.cos(hy), s = Math.sin(hy);
      // 車頭朝上：螢幕 x = v·right, y = -v·forward
      const T = (dx, dz) => [cx + (-dx * c + dz * s) * scale, cy - (dx * s + dz * c) * scale];
      const i0 = Math.max(0, car.hint.i - 400), i1 = Math.min(road.N - 1, car.hint.i + 400);
      const drawPath = (from, to, col, w) => {
        g.strokeStyle = col; g.lineWidth = w; g.lineJoin = 'round';
        g.beginPath();
        for (let i = from; i <= to; i += 2) {
          const p = T(road.px[i] - car.pos[0], road.pz[i] - car.pos[2]);
          i === from ? g.moveTo(p[0], p[1]) : g.lineTo(p[0], p[1]);
        }
        g.stroke();
      };
      drawPath(i0, i1, 'rgba(255,255,255,0.85)', 4);
      const sa = Math.round(Math.min(st.s0, st.s1) / road.sp), sb = Math.round(Math.max(st.s0, st.s1) / road.sp);
      if (sb > i0 && sa < i1) drawPath(Math.max(i0, sa), Math.min(i1, sb), '#ffb020', 2.5);
      g.fillStyle = '#4ad0ff';
      for (const a of st.traffic) {
        const p = T(a.pos[0] - car.pos[0], a.pos[2] - car.pos[2]);
        g.fillRect(p[0] - 2, p[1] - 2, 4, 4);
      }
      g.restore();
      g.fillStyle = '#ff3b3b';
      g.beginPath(); g.moveTo(cx, cy - 7); g.lineTo(cx + 5, cy + 5); g.lineTo(cx - 5, cy + 5); g.closePath(); g.fill();
      const n = T(0, -(R - 10) / scale);
      g.fillStyle = '#fff'; g.font = `700 ${Math.round(11 * this.scale)}px ${F}`; g.textAlign = 'center';
      g.fillText('N', n[0], n[1]);
      const spiral = road.data.spiral;
      const along = st.s0 + st.progress * (st.s1 - st.s0);
      if (spiral && along >= spiral.start && along <= spiral.end) {
        const easing = (spiral.end - spiral.start - spiral.lapLength * spiral.turns) / 2;
        const lap = Math.min(Math.ceil(spiral.turns), 1 + Math.floor(Math.max(0, along - spiral.start - easing) / spiral.lapLength));
        g.font = `700 ${Math.round(13 * this.scale)}px ${F}`;
        g.fillStyle = '#ffda8c';
        const label = spiral.turns === 1 ? '單圈環匝' : `第 ${lap} 圈 · 共 ${spiral.turns} 圈`;
        g.fillText(label, cx, cy + R * .76);
      }
    }
    _profile(g, x, y, w, h, st) {
      const p = this.profile;
      if (!p) return;
      g.fillStyle = 'rgba(8,10,12,0.5)'; this._rr(g, x - 6, y - 6, w + 12, h + 22, 8); g.fill();
      const span = Math.max(30, p.hi - p.lo);
      g.beginPath();
      for (let k = 0; k < p.pts.length; k++) {
        const kk = p.dir > 0 ? k : p.pts.length - 1 - k;
        const X = x + (w * k) / (p.pts.length - 1), Y = y + h - ((p.pts[kk] - p.lo) / span) * h;
        k ? g.lineTo(X, Y) : g.moveTo(X, Y);
      }
      g.lineTo(x + w, y + h); g.lineTo(x, y + h); g.closePath();
      g.fillStyle = 'rgba(120,170,110,0.45)'; g.fill();
      g.strokeStyle = 'rgba(200,230,190,0.9)'; g.lineWidth = 1.5; g.stroke();
      const t = Math.max(0, Math.min(1, st.progress));
      g.fillStyle = '#ff3b3b'; g.beginPath(); g.arc(x + w * t, y + h - ((st.elev - p.lo) / span) * h, 4, 0, 6.283); g.fill();
      g.fillStyle = '#cfd6dc'; g.font = `500 ${Math.round(10 * this.scale)}px ${F}`; g.textAlign = 'left';
      g.fillText(`${Math.round(p.lo)}–${Math.round(p.hi)} m`, x, y + h + 10);
    }
  }

  RM.HUD = HUD;
  RM.fmtTime = fmtTime;
})();
