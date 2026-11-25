'use strict';
// 起跑程序 (個人計時賽與多人房共用)：倒數 3、2、1、START，倒數結束前車子鎖在起跑格。
//
// 彈射起步 (參考跑跑卡丁車的起步加速)：「1」快數完、START 出現的那一瞬間按下油門 (↑ / W / 搖桿 RT)，
// 起跑時車子會短噴火衝出去 (Vehicle.startBoost)。判定看的是「按下去的那一下」：
//   - 落在 WINDOW 範圍內 = 成功
//   - 「1」出現之後、範圍之前就按 = 太早，這一次起步就沒有了 (所以連打沒用)
//   - 從更早就一直按著不放 = 沒有按下去的那一下，也沒有；範圍過了才按就是一般起步
(function () {
  const RM = window.RM;
  const $ = (id) => document.getElementById(id);
  const SOLO_MS = 3500;            // 個人賽：載入完成到 START 的毫秒數 (前 0.5 秒顯示「預備」)
  const WINDOW = [-0.25, 0.15];    // 彈射起步的判定範圍：相對於 START 的秒數 (負的 = START 之前)
  const EARLY = -1;                // 從這裡 (「1」出現) 到判定範圍之前按油門 = 太早
  const SHOW = 1300;               // START! 留在畫面上的毫秒數
  const TIP = '「1」數完的瞬間按 ↑　彈射起步';

  // 搖桿油門 (RT) 有沒有踩下去
  function padDown() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected && p.buttons[7] && p.buttons[7].value > 0.4) return true;
    return false;
  }

  const Start = {
    live: false,      // 起跑程序還在跑 (從載入完成到 START! 消失)
    on: false,        // 車子鎖住中 (還沒 START)
    mp: false,        // 多人房的比賽：START 的時刻全房同步，由伺服器決定
    at: 0,            // START 的時刻 (performance.now)；0 = 還沒開始倒數 (多人：等其他玩家載入)
    goAt: 0,          // 已經起跑的時刻；0 = 還沒
    judge: '',        // 這次起步的判定：'' 還沒按 / 'early' 太早 / 'perfect' 按準了
    boosted: false,   // 彈射已經發動
    wait: '',         // 還沒開始倒數時畫面中央的文字 (多人：等待其他玩家載入，由 online.js 填)
    _key: 0, _pad: false, _seen: 0, _shown: '', _held: null,

    // startRace 結束、可以開車的那一刻呼叫：鎖住車子。個人賽直接開始倒數，多人賽等伺服器 (beginAt)
    arm(g, mp) {
      const now = performance.now();
      this.live = true; this.on = true; this.mp = !!mp;
      this.at = mp ? 0 : now + SOLO_MS; this.goAt = 0;
      this.judge = ''; this.boosted = false; this.wait = '';
      this._key = 0; this._pad = padDown(); this._seen = now;
      // 倒數時畫面中央只留數字：賽道名稱等訊息先收起來，START 之後再顯示
      this._held = g.hud.msgs.splice(0);
    },
    // 多人：伺服器宣布的 START 時刻
    beginAt(t) { if (this.on) this.at = t; },
    // 回車庫 / 重新載入：收掉倒數
    cancel() {
      this.live = false; this.on = false; this.at = 0; this.goAt = 0; this._key = 0; this._held = null;
      this._draw('', '', '', '');
    },
    // 倒數時畫面下方的提示
    tip() { return this.at ? TIP : null; },

    // 每幀 (main.js frame，在車輛物理之前)：倒數、鎖車 / 放行、彈射判定、畫面中央的數字
    step(g, inp) {
      if (!this.live) return;
      const now = performance.now();
      // 個人賽暫停或切到別的分頁：倒數從停下來的地方接著數 (多人的 START 時刻是同步的，不能動)
      if (this.on && this.at && !this.mp && now - this._seen > 300) { this.at += now - this._seen; this._key = 0; }
      this._seen = now;
      // 油門「按下去的那一下」：鍵盤由 keydown 事件記時間 (比每幀檢查準)，搖桿每幀檢查
      const pad = padDown();
      if (pad && !this._pad && !this._key) this._key = now;
      this._pad = pad;
      if (this._key) { this._press(this._key); this._key = 0; }
      if (this.on) {
        if (this.at && now >= this.at) { this.on = false; this.goAt = this.at; }
        else { inp.throttle = 0; inp.brake = 1; inp.hand = true; inp.drift = false; }
      }
      if (!this.on && this.judge === 'perfect' && !this.boosted) {
        this.boosted = true;
        g.car.startBoost();
        g.audio.whoosh(0.55, 1.1);
      }
      this._ui(now);
      if (!this.on && now - this.goAt >= SHOW) {
        this.live = false;
        if (this._held) { for (const m of this._held) g.hud.msgs.push(m); this._held = null; }
      }
    },

    // 判定一次按油門 (t = 按下的時刻)
    _press(t) {
      if (!this.at || this.judge) return;
      const d = (t - this.at) / 1000;
      if (d < EARLY || d > WINDOW[1]) return;
      this.judge = d < WINDOW[0] ? 'early' : 'perfect';
    },

    _ui(now) {
      let cls = '', html = '', noteCls = '', note = '';
      if (this.on) {
        if (this.at) {
          const left = (this.at - now) / 1000;
          if (left > 3) { cls = 'wait'; html = '預備…'; } else { cls = 'num'; html = String(Math.max(1, Math.ceil(left))); }
        } else if (this.wait) { cls = 'wait'; html = this.wait; }
      } else if (now - this.goAt < SHOW) { cls = 'go'; html = 'START!'; }
      if (cls === 'num' || cls === 'go') {
        if (this.boosted) { noteCls = 'hit'; note = '彈射起步！'; }
        else if (this.judge === 'early') { noteCls = 'miss'; note = '按太早了'; }
      }
      this._draw(cls, html, noteCls, note);
    },
    _draw(cls, html, noteCls, note) {
      const key = cls + '|' + html, c = $('startCenter'), n = $('startNote');
      if (c && key !== this._shown) {
        this._shown = key;
        c.className = 'start-center'; void c.offsetWidth;   // 重新觸發放大動畫
        c.className = 'start-center ' + cls; c.innerHTML = html;
        if (cls === 'num') this._beep(660, 0.16, 0.1);
        else if (cls === 'go') this._beep(1320, 0.55, 0.12);
      }
      if (n && n.textContent !== note) { n.className = 'start-note ' + noteCls; n.textContent = note; }
    },
    _beep(freq, dur, gain) {
      const a = RM.Game && RM.Game.audio;
      if (!a || !a.ctx || !a.on || !a.master) return;
      const ctx = a.ctx, t = ctx.currentTime, o = ctx.createOscillator(), gn = ctx.createGain();
      o.type = 'square'; o.frequency.value = freq;
      gn.gain.setValueAtTime(gain, t); gn.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      o.connect(gn); gn.connect(a.master); o.start(t); o.stop(t + dur + 0.05);
    },
  };

  window.addEventListener('keydown', (e) => {
    if (e.repeat || (e.code !== 'ArrowUp' && e.code !== 'KeyW')) return;
    if (Start.live && RM.Game && RM.Game.state === 'drive') Start._key = e.timeStamp || performance.now();
  });

  RM.Start = Start;
})();
