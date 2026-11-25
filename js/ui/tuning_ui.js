'use strict';
// 改裝工廠 (車庫右側的面板)：選部位 → 點零件就先「試裝」在展示車上 → 購買 / 裝上 / 換顏色；上方是籌碼與兌換
// 零件資料與性能見 js/game/tuning.js，外觀見 js/car/tuning_vis.js，購買由伺服器扣籌碼 (server/functions.js buyMod)
(function () {
  const RM = window.RM, $ = (id) => document.getElementById(id);
  const T = RM.Tuning, P = RM.Platform;
  const G = () => RM.Game;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => Math.round(n || 0).toLocaleString('en-US');
  const CAR_NAMES = { k8: 'Civic K8', gr86: 'GR86', ae86: 'AE86', r34: 'Skyline GT-R R34', r35: 'GT-R R35', p911: '911 Carrera RS 2.7' };
  // 各部位的展示角度：[水平角, 俯仰, 距離倍率]
  const VIEW = { wheel: [-1.3, 0.05, 0.3], tire: [-1.12, 0.04, 0.3], brake: [-1.38, 0.03, 0.26], susp: [-1.57, 0.02, 0.85], exhaust: [-2.55, 0.1, 0.32], ecu: [-0.94, 0.23, 1], livery: [-1.08, 0.3, 0.9] };
  const LIVERY_VIEWS = { front: [-1.08, .3], left: [-Math.PI / 2, .12], right: [Math.PI / 2, .12], top: [-.45, 1.05] };
  const FIN_SLOT = { wheel: true, brake: true, susp: true };

  const U = {
    open: false, slot: 'wheel', sel: null, color: 0, busy: false,

    init() {
      $('tuneBtn').addEventListener('click', () => this.show());
      $('tuneClose').addEventListener('click', () => this.hide());
      $('tuneSlots').addEventListener('click', (e) => { const b = e.target.closest('button[data-slot]'); if (b) this.pickSlot(b.dataset.slot); });
      $('tuneList').addEventListener('click', (e) => { const b = e.target.closest('[data-part]'); if (b) this.pick(b.dataset.part); });
      $('tuneDetail').addEventListener('click', (e) => {
        const view = e.target.closest('button[data-livery-view]');
        if (view) {
          const m = G().menu, v = LIVERY_VIEWS[view.dataset.liveryView];
          m.angle = v[0]; m.pitch = v[1]; m.pauseAutoRotate(); m.dirty = true;
          return;
        }
        const f = e.target.closest('button[data-fin]');
        if (f) { this.color = +f.dataset.fin; this.preview(); this.renderDetail(); return; }
        // 寫電腦的調校方向 (this.color 在寫電腦部位代表調校方向 fit.ecuC)
        const mp = e.target.closest('button[data-map]');
        if (mp) { this.color = +mp.dataset.map; this.preview(); this.renderDetail(); return; }
        const a = e.target.closest('button[data-act]');
        if (a && !a.disabled) this.act(a.dataset.act);
      });
      $('tuneExchange').addEventListener('click', () => this.openExchange());
      $('exchangeDialog').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-dia]');
        if (b) { $('exchangeAmount').value = b.dataset.dia; this.renderExchange(); }
        if (e.target.closest('#exchangeGo')) this.doExchange();
      });
      $('exchangeAmount').addEventListener('input', () => this.renderExchange());
      // 零件說明 (畫面左上角，見 setDetail)；螢幕寬度跨過手機版門檻時重畫 (說明要搬回面板裡 / 搬出來)
      const info = document.createElement('section');
      info.id = 'tuneInfo'; info.className = 'tune-info'; info.setAttribute('aria-live', 'polite'); info.setAttribute('aria-label', '零件說明');
      $('tunePanel').after(info);
      matchMedia('(max-width: 760px)').addEventListener('change', () => { if (this.open) this.renderDetail(); });
      for (const s of T.SLOTS) {
        const b = document.createElement('button');
        b.type = 'button'; b.dataset.slot = s.id; b.innerHTML = `<i aria-hidden="true">${s.icon}</i><span>${s.name}</span>`;
        $('tuneSlots').append(b);
      }
      // 車色 (車庫的塗裝面板在改裝時收起來了)：點了就按車庫塗裝面板上同一個顏色 → 存設定、展示車換色都照原本的流程
      for (const [i, c] of RM.CivicModel.COLORS.entries()) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'tune-sw'; b.dataset.tcolor = i; b.title = c[0]; b.setAttribute('aria-label', c[0]); b.style.backgroundColor = c[1];
        $('tunePaint').append(b);
      }
      $('tunePaint').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-tcolor]');
        if (!b) return;
        const src = $('paintList').querySelector(`[data-val="${b.dataset.tcolor}"]`);
        if (src) src.click();
        this.renderPaint();
      });
      P.on((type) => {
        if (type === 'chips') this.renderWallet();
        if ((type === 'mods' || type === 'profile') && this.open) { this.renderList(); this.renderDetail(); }
        if (type === 'mods' || type === 'profile') { const m = G() && G().menu; if (m) { m.dirty = true; m.ratedKey = null; m.syncPerformance && m.syncPerformance(); } }
      });
    },
    // 面板開著時換車 (menu.js changed)
    onCar() { this.pickSlot(this.slot); },
    // 車色列：目前的顏色打勾、顯示名稱
    renderPaint() {
      const c = G().opts.color, COL = RM.CivicModel.COLORS;
      $('tunePaint').querySelectorAll('button[data-tcolor]').forEach((b) => { const on = +b.dataset.tcolor === c; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      $('tunePaintName').textContent = COL[c] ? COL[c][0] : '';
    },

    car() { return G().opts.car; },
    fit() { return T.fitOf(this.car(), P.mods); },
    owned(id) {
      if (!id || id === 'stock') return true;
      const m = P.mods || T.empty();
      if (/^ecu\d$/.test(id)) return ((m.ecu && m.ecu[this.car()]) | 0) >= +id.slice(3);
      return !!(m.own && m.own[id]);
    },

    show() {
      const g = G();
      if (!g || g.state !== 'menu') return;
      if (RM.Net && RM.Net.inRoom) { RM.Online.toast('在多人房間裡不能改裝，請先離開房間'); return; }
      this.open = true;
      $('tunePanel').classList.remove('hidden');
      $('menu').classList.add('in-tune');
      g.resize(); // Mobile preview gets its own space above the parts panel.
      this.pickSlot(this.slot);
      this.renderWallet();
      this.renderPaint();
      if (P.canScore) P.refresh();
    },
    hide() {
      if (!this.open) return;
      this.open = false;
      $('tunePanel').classList.add('hidden');
      $('tuneInfo').innerHTML = '';
      $('menu').classList.remove('in-tune');
      const m = G().menu;
      m.tryFit = null; m.viewShift = 0; m.zoom = 1; m.focus = null; m.angle = -0.94; m.pitch = 0.23; m.dirty = true; m.ratedKey = null; m.syncPerformance();
      G().resize();
    },

    pickSlot(slot) {
      this.slot = slot; this.sel = null;
      const m = G().menu, v = VIEW[slot] || VIEW.ecu;
      // 注視點：輪子類看左前輪、排氣管看車尾 (車款模型的前後軸位置 mapU.C = [半寬, 前軸 z, 後軸 z])
      const mdl = m.preview && m.preview.carModel, C = mdl && mdl.mapU && mdl.mapU.C ? mdl.mapU.C : [0.88, -1.3, 1.3];
      m.focus = slot === 'wheel' || slot === 'tire' || slot === 'brake' ? [-C[0] * 0.95, 0.3, C[1]] : slot === 'exhaust' ? [-0.35, 0.32, C[2] + 0.95] : null;
      m.pauseAutoRotate(); m.angle = v[0]; m.pitch = v[1]; m.zoom = v[2]; m.viewShift = m.focus ? 0.12 : 0.7; m.dirty = true;
      const f = this.fit();
      // 預設選目前裝的那個 (寫電腦：下一階)
      if (slot === 'ecu') this.sel = f.ecu < 3 ? 'ecu' + (f.ecu + 1) : 'ecu3';
      else this.sel = f[slot] || 'stock';
      this.color = slot === 'ecu' ? f.ecuC || 0 : f[slot + 'C'] || 0;
      this.renderAll();
      this.preview();
    },
    pick(id) {
      this.sel = id;
      const f = this.fit();
      // 寫電腦換階數時保留目前選的調校方向
      if (this.slot !== 'ecu') this.color = f[this.slot] === id ? f[this.slot + 'C'] || 0 : 0;
      this.renderList(); this.renderDetail(); this.preview();
      // A longer description can shrink the list. Keep the chosen design visible.
      const list = $('tuneList'), row = list.querySelector('.sel');
      if (row) {
        const a = row.getBoundingClientRect(), b = list.getBoundingClientRect();
        if (a.bottom > b.bottom) list.scrollTop += a.bottom - b.bottom;
        else if (a.top < b.top) list.scrollTop -= b.top - a.top;
      }
    },
    // 試裝：展示車換成選到的零件 (還沒買也可以看)
    tryFit() {
      const f = Object.assign({}, this.fit()), s = this.slot;
      if (s === 'ecu') { f.ecu = this.sel ? +this.sel.slice(3) : f.ecu; f.ecuC = this.color; }
      else { f[s] = this.sel && this.sel !== 'stock' ? this.sel : null; f[s + 'C'] = this.color; }
      return f;
    },
    preview() {
      const m = G().menu;
      m.tryFit = { car: this.car(), fit: this.tryFit() };
      m.dirty = true; m.ratedKey = null; m.syncPerformance();
    },

    renderAll() {
      $('tuneCar').textContent = CAR_NAMES[this.car()] || this.car();
      $('tuneSlots').querySelectorAll('button[data-slot]').forEach((b) => b.classList.toggle('on', b.dataset.slot === this.slot));
      const s = T.SLOTS.find((x) => x.id === this.slot);
      $('tuneSlotNote').textContent = this.slot === 'ecu' ? '寫電腦每台車各自購買，一階 → 二階 → 三階依序升級；調校方向買了之後免費切換。' : this.slot === 'livery' ? '彩繪純粹是外觀，不影響性能；買一次每台車都能用。' : `${s.name}買一次，每台車都能裝。每款加的性能都不一樣，不是越貴越強，搭配裝還有加成。`;
      this.renderList(); this.renderDetail();
    },
    renderList() {
      const f = this.fit(), ids = T.partsOf(this.slot), rows = [];
      if (this.slot !== 'ecu') rows.push({ id: 'stock', name: '原廠', sub: this.slot === 'livery' ? '無彩繪' : '原廠零件', price: 0, tier: 0 });
      for (const id of ids) { const p = T.part(id); rows.push({ id, name: p.name, sub: p.sub, price: p.price, tier: p.tier }); }
      $('tuneList').innerHTML = rows.map((r) => {
        const eq = this.slot === 'ecu' ? f.ecu >= +r.id.slice(3) : (f[this.slot] || 'stock') === r.id;
        const own = this.owned(r.id);
        const st = eq ? '<em class="eq">使用中</em>' : own ? '<em class="own">已擁有</em>' : `<em class="price">${num(r.price)}</em>`;
        const lv = this.slot === 'livery' && T.part(r.id)?.livery;
        const sample = lv ? `<span class="livery-thumb" aria-hidden="true">${RM.LiveryData.stickers[lv.preview].svg.replace('viewBox="0 0 1600 320"', 'viewBox="330 35 1060 280"')}</span>` : `<span class="tier t${r.tier}">${r.tier ? '★'.repeat(r.tier) : '—'}</span>`;
        return `<button type="button" class="tune-item${lv ? ' livery-item' : ''}${r.id === this.sel ? ' sel' : ''}${eq ? ' equipped' : ''}" data-part="${esc(r.id)}" aria-pressed="${r.id === this.sel}">`
          + `${sample}<span class="nm"><b>${esc(r.name)}</b><small>${esc(lv ? lv.style : r.sub)}</small></span>${st}</button>`;
      }).join('');
    },
    // 零件說明 (名稱、介紹、效果標籤、搭配加成) 放在畫面左上角 (#tuneInfo)，右側面板只留顏色 / 調校方向與購買按鈕，清單可以多顯示幾個零件；
    // 手機版 (窄螢幕) 左上角是展示車，說明照舊放在面板裡
    narrow() { return matchMedia('(max-width: 760px)').matches; },
    setDetail(info, ctrl) {
      const box = $('tuneDetail'), side = $('tuneInfo');
      if (this.narrow() || !side) { box.innerHTML = info + ctrl; if (side) side.innerHTML = ''; }
      else { side.innerHTML = info; box.innerHTML = ctrl; }
    },
    renderDetail() {
      const id = this.sel;
      if (!id) { this.setDetail('', ''); return; }
      const f = this.fit(), slot = this.slot;
      if (id === 'stock') {
        const using = !f[slot];
        this.setDetail(`<h3>原廠</h3><p>${slot === 'livery' ? '不貼彩繪，只有車身塗裝。' : '換回出廠時的零件 (已買的零件不會消失，隨時可以再裝回來)。'}</p>`,
          `<button type="button" class="btn tune-act" data-act="stock"${using ? ' disabled' : ''}>${using ? '使用中' : '換回原廠'}</button>`);
        return;
      }
      const p = T.part(id), own = this.owned(id);
      const tags = T.fxTags(id, slot === 'ecu' ? this.color : undefined).map(([k, v, bad]) => `<span class="${bad ? 'bad' : ''}">${esc(k)} <b>${esc(v)}</b></span>`).join('');
      let fins = '';
      const fk = p.fin;
      if (fk && FIN_SLOT[slot]) fins = `<div class="tune-fins"><span>顏色</span>${T.FIN[fk].map((c, i) => `<button type="button" data-fin="${i}" class="${i === this.color ? 'on' : ''}" title="${esc(c.name)}" style="--c:${c.hex}"></button>`).join('')}<small>${esc(T.FIN[fk][this.color] ? T.FIN[fk][this.color].name : '')}</small></div>`;
      // 寫電腦：調校方向 (買了任一階之後免費切換)
      if (slot === 'ecu') fins = `<div class="tune-maps" role="group" aria-label="調校方向">${T.ECU_MAPS.map((m, i) => `<button type="button" data-map="${i}" class="${i === this.color ? 'on' : ''}" aria-pressed="${i === this.color}"><b>${esc(m.name)}</b><small>${esc(m.note)}</small></button>`).join('')}</div>`;
      let btn;
      if (slot === 'ecu') {
        const lv = +id.slice(3), cur = f.ecu, mapName = T.ECU_MAPS[this.color].name;
        btn = lv <= cur ? ((f.ecuC || 0) !== this.color ? `<button type="button" class="btn tune-act" data-act="map">改成「${esc(mapName)}」調校 (免費)</button>` : '<button type="button" class="btn tune-act" disabled>已完成</button>')
          : lv === cur + 1 ? `<button type="button" class="btn tune-act" data-act="buy">升級 · ${num(p.price)} 籌碼</button>`
            : `<button type="button" class="btn tune-act" disabled>要先完成 ${cur + 1} 階</button>`;
      } else if (!own) btn = `<button type="button" class="btn tune-act" data-act="buy">購買並裝上 · ${num(p.price)} 籌碼</button>`;
      else if (f[slot] !== id) btn = '<button type="button" class="btn tune-act" data-act="fit">裝上</button>';
      else if ((f[slot + 'C'] || 0) !== this.color) btn = '<button type="button" class="btn tune-act" data-act="color">套用這個顏色</button>';
      else btn = '<button type="button" class="btn tune-act" disabled>使用中</button>';
      const dia = Math.ceil(p.price / P.PER_DIAMOND);
      const liveryPalette = p.livery ? `<div class="livery-palette" aria-label="彩繪配色">${p.livery.palette.map(c => `<i style="--ink:${c}" aria-hidden="true"></i>`).join('')}<span>${esc(p.livery.style)}</span></div>` : '';
      const liveryViews = p.livery ? `<div class="livery-views" role="group" aria-label="彩繪檢視角度"><button type="button" data-livery-view="front">立體</button><button type="button" data-livery-view="left">左側</button><button type="button" data-livery-view="right">右側</button><button type="button" data-livery-view="top">俯視</button></div>` : '';
      this.setDetail(`<h3>${esc(p.name)}<small>${esc(p.sub)}</small></h3><p>${esc(p.desc)}</p>${liveryPalette}<div class="tune-tags">${tags}</div>${this.combosHtml(slot === 'ecu' ? 'ecu:' + this.color : id)}`,
        `${liveryViews}${fins}<div class="tune-buy">${btn}${own || slot === 'ecu' && +id.slice(3) <= f.ecu ? '' : `<small>約 ${num(dia)} 紅鑽</small>`}</div>`);
    },
    // 搭配加成：這個零件 (寫電腦是 'ecu:調校方向') 參與的組合，用試裝中的狀態標出哪些已經裝了
    combosHtml(tok) {
      const list = T.COMBOS.filter((c) => c.need.some((g) => g.includes(tok)));
      if (!list.length) return '';
      const fit = this.tryFit();
      return `<div class="tune-combos"><span class="tune-combos-h">搭配加成</span>${list.map((c) => {
        const done = c.need.map((g) => g.some((t) => T.has(fit, t))), on = done.every(Boolean);
        const parts = c.need.map((g, i) => `<i class="${done[i] ? 'ok' : ''}">${done[i] ? '✓' : '＋'} ${esc(g.map(T.tokName).join(' 或 '))}</i>`).join('');
        const fx = T.comboTags(c).map(([k, v, bad]) => `<span class="${bad ? 'bad' : ''}">${esc(k)} <b>${esc(v)}</b></span>`).join('');
        return `<div class="tune-combo${on ? ' on' : ''}" title="${esc(c.desc)}"><div><b>${esc(c.name)}</b>${on ? '<em>已成立</em>' : ''}<span class="fx">${fx}</span></div><div class="parts">${parts}</div></div>`;
      }).join('')}</div>`;
    },
    renderWallet() {
      $('tuneChips').textContent = num(P.chips);
      $('tuneDiamonds').textContent = P.diamonds !== null && P.diamonds !== undefined ? `紅鑽 ${num(P.diamonds)}` : P.mode === 'local' ? '本機測試' : '';
    },

    async act(kind) {
      if (this.busy) return;
      const car = this.car(), slot = this.slot, id = this.sel;
      if (!P.canScore) { RM.Online.toast(P.mode === 'guest' ? '請先登入金碟遊樂場帳號才能改裝' : '目前無法改裝'); return; }
      this.busy = true;
      try {
        let r;
        if (kind === 'buy') {
          r = await P.buyMod(id, car);
          if (r && !r.ok && r.error === 'chips') {
            // 籌碼不夠：平台上交給平台補 (顯示差多少、用紅鑽補)，補完自動再買一次；本機就打開兌換
            if (P.mode === 'platform') {
              const t = await P.topUp(r.need);
              if (t.ok) r = await P.buyMod(id, car);
            } else { this.openExchange(Math.ceil(r.need / P.PER_DIAMOND)); this.busy = false; return; }
          }
          if (r && r.ok) {
            if (FIN_SLOT[slot] && this.color) await P.fitMod(car, slot, id, this.color);
            if (slot === 'ecu' && this.color !== (this.fit().ecuC || 0)) await P.fitMod(car, 'ecu', '', this.color);   // 買寫電腦順便套用選的調校方向
            RM.Online.toast(`已購買：${T.part(id).name}`);
          }
        } else if (kind === 'map') {
          r = await P.fitMod(car, 'ecu', '', this.color);
          if (r && r.ok) RM.Online.toast(`寫電腦改成「${T.ECU_MAPS[this.color].name}」調校`);
        } else if (kind === 'fit' || kind === 'color') r = await P.fitMod(car, slot, id, this.color);
        else if (kind === 'stock') r = await P.fitMod(car, slot, '', 0);
        if (r && !r.ok && r.error !== 'chips') RM.Online.toast(r.error === 'guest' ? '請先登入金碟遊樂場帳號才能改裝' : '沒有成功，請再試一次');
        else if (r && !r.ok) RM.Online.toast('籌碼不足');
      } finally { this.busy = false; }
      this.renderList(); this.renderDetail(); this.renderWallet(); this.preview();
    },

    // ---- 兌換籌碼 (1 紅鑽 = 100 籌碼)
    openExchange(need) {
      $('exchangeAmount').value = need || 50;
      $('exchangeNote').textContent = P.mode === 'platform' ? '按下兌換後，平台會請你確認。沒花完的籌碼在離開遊戲時會自動換回紅鑽。'
        : P.mode === 'local' ? '本機測試模式：直接加籌碼，不會用到紅鑽。' : '登入金碟遊樂場帳號後才能兌換。';
      this.renderExchange();
      if (!$('exchangeDialog').open) $('exchangeDialog').showModal();
    },
    renderExchange() {
      const d = Math.max(0, Math.floor(+$('exchangeAmount').value || 0));
      $('exchangeResult').textContent = `= ${num(d * P.PER_DIAMOND)} 籌碼`;
      $('exchangeWallet').textContent = P.diamonds !== null && P.diamonds !== undefined ? `目前紅鑽 ${num(P.diamonds)} · 籌碼 ${num(P.chips)}` : `目前籌碼 ${num(P.chips)}`;
      $('exchangeGo').disabled = !(d >= 1) || (P.mode !== 'platform' && P.mode !== 'local');
    },
    async doExchange() {
      const d = Math.max(0, Math.floor(+$('exchangeAmount').value || 0));
      if (!(d >= 1) || this.busy) return;
      this.busy = true;
      const r = await P.exchange(d);
      this.busy = false;
      if (r.ok) { $('exchangeDialog').close(); RM.Online.toast(`已兌換 ${num(d * P.PER_DIAMOND)} 籌碼`); }
      else if (r.error === 'guest') RM.Online.toast('請先登入金碟遊樂場帳號');
      this.renderWallet(); this.renderExchange();
    },
  };

  RM.TuningUI = U;
  window.addEventListener('load', () => U.init());
})();
