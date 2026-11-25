'use strict';
// Garage UI reuses the game's models/context. Maps use real route coordinates and DEM contours.
(function () {
  const RM = window.RM, $ = id => document.getElementById(id);
  const MAPS = { sprint: ['彎道衝刺', '石碇 · 坪林'], drift: [RM.DriftTrack.section.name, '夏威夷 · 夕陽海灘'], nine: ['九彎十八拐', '石牌 · 頭城'], pl_tc: ['坪林・頭城', '茶山 · 海岸'], xd_pl: ['新店・坪林', '城市 · 山林'], full: ['北宜全線', '新店 · 頭城'] };
  const CARS = { k8: ['HONDA', 'CIVIC <em>K8</em>', '1.6 L <span>125 PS</span> FF'], gr86: ['TOYOTA', 'GR<em>86</em>', '2.4 L <span>235 PS</span> FR'],
    ae86: ['TOYOTA', 'TRUENO <em>AE86</em>', '1.6 L <span>130 PS</span> FR'], r34: ['NISSAN', 'SKYLINE GT-R <em>R34</em>', '2.6 L TT <span>280 PS</span> AWD'],
    r35: ['NISSAN', 'GT-R <em>R35</em>', '3.8 L TT <span>570 PS</span> AWD'],
    p911: ['PORSCHE', '911 CARRERA <em>RS 2.7</em>', '2.7 L <span>210 PS</span> RR'] };
  // Relative game ratings, not real-world manufacturer specifications. Keep in sync with
  // vehicle.js / each model's SPEC_OVER: speed, launch, drift retention, steering / grip.
  // 2026-11-25 車款平衡後重新評 (Node 物理模擬)：極速 AE86 242 / K8 250 / GR86 254 / 911 255 / R34 261 / R35 267 km/h (只差 25)，
  //   0～100 911 4.4 / R35 4.5 / R34 4.8 / GR86 5.2 / K8 5.9 / AE86 6.0 秒，彎道衝刺單圈 (甩尾跑法) AE86 最快、其他差 1 秒內
  const PERFORMANCE = {
    k8:   { scores: [4, 4, 4, 5], character: '輕鬆上手 · 靈活前驅' },
    gr86: { scores: [5, 5, 5, 5], character: '均衡後驅 · 彎道好手' },
    ae86: { scores: [4, 4, 7, 4], character: '輕量車身 · 飄移專家' },
    r34:  { scores: [5, 6, 3, 5], character: '四驅抓地 · 強勁加速' },
    r35:  { scores: [6, 6, 2, 5], character: '極速猛獸 · 四驅穩定' },
    p911: { scores: [5, 7, 4, 3], character: '後置後驅 · 起步最快' },
  };
  const METRICS = ['速度', '加速度', '飄移', '操控性'];
  const STAT_MAX = 10;   // 性能評級的滿分 (2026-11-25 由 6 改成 10，原廠分數不變)
  const CAR_LABELS = { k8: 'K8', gr86: 'GR86', ae86: 'AE86', r34: 'R34', r35: 'R35', p911: '911' };
  const WEATHER = { sunny: '晴天', fog: '山霧', dusk: '黃昏', night: '夜晚', rain: '雨天' };
  const KEY = 'rm_preferences';
  const PREFS_V = 2;   // 存檔格式版本 (見 restore)
  const BACKGROUNDS = { sprint: 'images/backgrounds/sprint-racing.webp', drift: 'images/backgrounds/hawaii-racing.webp' };
  const AUTO_ROTATE_SPEED = Math.PI / 30; // Six degrees per second: one horizontal turn per minute.
  const AUTO_ROTATE_DELAY = 1200;
  class MenuUI {
    static restore(opts, sections) {
      try {
        const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
        const allowed = { section: Object.keys(sections), car: RM.CarModels.PLAYER_CARS.map(c => c.id), dir: [1, -1], env: Object.keys(WEATHER), color: RM.CivicModel.COLORS.map((_, i) => i), traffic: [true, false], abs: [true, false], quality: ['low', 'medium', 'high', 'ultra'] };
        // 存檔版本 2 起路上車流 / ABS 預設關閉。舊版存檔裡的這兩項只是當時的預設值 (改任何設定都會整包存起來)，不採用
        const legacy = !(saved.v >= PREFS_V);
        for (const key in allowed) {
          if (legacy && (key === 'traffic' || key === 'abs')) continue;
          if (allowed[key].includes(saved[key])) opts[key] = saved[key];
        }
        if (Number.isFinite(saved.volume)) $('volume').value = RM.clamp(saved.volume, 0, 1.2);
      } catch (_) { /* Invalid or unavailable storage uses defaults. */ }
    }
    constructor(game, sections) {
      this.game = game; this.sections = sections; this.angle = -.94; this.pitch = .23; this.dirty = true; this.maps = {}; this.backdrops = {};
      this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
      this.pauseAutoRotate();
      this.route = new Float32Array(RM.b64ToBytes(window.RM_DATA.route.xyz).buffer);
      this.buildControls(); this.bind(); this.sync();
    }
    buildControls() {
      for (const car of RM.CarModels.PLAYER_CARS) {
        const b = document.createElement('button');
        b.type = 'button'; b.dataset.car = car.id; b.textContent = CAR_LABELS[car.id] || car.name;
        b.setAttribute('aria-label', `選擇 ${car.name}`); b.title = car.name;
        b.addEventListener('click', () => this.selectCar(car.id));
        $('carPosition').append(b);
      }
      this.statRows = METRICS.map((label, index) => {
        const row = document.createElement('div'); row.className = 'performance-stat';
        // 滿分 10 (原廠分數不變，留空間給改裝加成)
        row.innerHTML = `<span class="stat-label">${label}</span><span class="stat-score" aria-hidden="true"><b></b><small>/ ${STAT_MAX}</small></span><span class="stat-bars" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="${STAT_MAX}">${Array.from({ length: STAT_MAX }, (_, i) => `<i style="--light-delay:${index * 45 + i * 28}ms" aria-hidden="true"></i>`).join('')}</span>`;
        $('performanceStats').append(row);
        return row;
      });
      for (const [i, color] of RM.CivicModel.COLORS.entries()) {
        const b = document.createElement('button');
        b.className = 'sw'; b.dataset.opt = 'color'; b.dataset.val = i;
        b.title = color[0]; b.setAttribute('aria-label', color[0]); b.style.backgroundColor = color[1];
        const rgb = color[1].slice(1).match(/../g).map(v => parseInt(v, 16));
        b.style.setProperty('--check-color', rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 > 145 ? '#122019' : '#ffffff');
        $('paintList').append(b);
      }
      for (const id of Object.keys(this.sections)) {
        const b = document.createElement('button');
        b.className = 'map-card'; b.dataset.opt = 'section'; b.dataset.val = id;
        const featured = id === 'sprint' || id === RM.DriftTrack.id;
        b.setAttribute('aria-label', `${MAPS[id][0]}，${this.distance(id)} 公里${featured ? '，熱門，計時賽' : ''}`);
        const canvas = document.createElement('canvas');
        canvas.width = 640; canvas.height = 360; canvas.setAttribute('aria-hidden', 'true');
        this.maps[id] = canvas; b.append(canvas);
        if (featured) {
          const tags = document.createElement('span'); tags.className = 'map-tags';
          tags.setAttribute('aria-hidden', 'true');
          tags.innerHTML = '<span class="map-tag popular">熱門</span><span class="map-tag time-trial">計時賽</span>';
          b.append(tags);
        }
        const label = document.createElement('span'); label.className = 'map-card-label';
        label.innerHTML = `<span><strong>${MAPS[id][0]}</strong><small class="map-card-location">${MAPS[id][1]}</small></span><b class="map-card-distance">${this.distance(id)} <small>km</small></b>`;
        b.append(label); $('mapList').append(b);
      }
      this.drawMaps();
    }
    bind() {
      document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => { const d = $(b.dataset.open); if (!d.open) d.showModal(); }));
      document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
      document.querySelectorAll('dialog').forEach(d => {
        d.addEventListener('click', e => { const r = d.getBoundingClientRect(); if (e.target === d && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) d.close(); });
        d.addEventListener('close', () => { this.game.input.takeEdges(); this.game.input.keys.clear(); });
      });
      const step = dir => {
        if (this.transition) return;
        const cars = RM.CarModels.PLAYER_CARS, i = cars.findIndex(c => c.id === this.game.opts.car);
        this.selectCar(cars[(i + dir + cars.length) % cars.length].id, dir);
      };
      $('prevCar').addEventListener('click', () => step(-1)); $('nextCar').addEventListener('click', () => step(1));
      $('resetCarView').addEventListener('click', () => {
        if (this.transition) return;
        this.angle = -.94; this.pitch = .23; this.pauseAutoRotate(); this.dirty = true;
      });
      const stage = $('showroom');
      stage.addEventListener('pointerdown', e => {
        if (e.button !== 0 || this.transition || this.pointer || e.target.closest('button')) return;
        this.pauseAutoRotate();
        this.pointer = { id: e.pointerId, x: e.clientX, y: e.clientY }; stage.setPointerCapture(e.pointerId);
      });
      stage.addEventListener('pointermove', e => {
        if (this.transition || !this.pointer || this.pointer.id !== e.pointerId) return;
        this.angle += (e.clientX - this.pointer.x) * .008;
        this.pitch = RM.clamp(this.pitch + (e.clientY - this.pointer.y) * .003, .08, .55);
        this.pointer.x = e.clientX; this.pointer.y = e.clientY; this.dirty = true;
      });
      for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) stage.addEventListener(event, e => {
        if (!this.pointer || this.pointer.id !== e.pointerId) return;
        this.pointer = null; this.pauseAutoRotate();
      });
      stage.addEventListener('keydown', e => { if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { e.preventDefault(); this.pauseAutoRotate(); this.angle += e.code === 'ArrowLeft' ? -.2 : .2; this.dirty = true; } });
      for (const id of ['musicVol', 'volume']) $(id).addEventListener('input', () => { this.syncVolume(); this.save(); });
      document.addEventListener('visibilitychange', () => { this.pointer = null; this.pauseAutoRotate(); this.dirty = true; });
      window.addEventListener('blur', () => { this.pointer = null; this.pauseAutoRotate(); });
    }
    pauseAutoRotate() { this.autoRotateAfter = performance.now() + AUTO_ROTATE_DELAY; this.autoRotateSpeed = 0; }
    selectCar(id, direction) {
      if (this.transition || id === this.game.opts.car) return;
      const cars = RM.CarModels.PLAYER_CARS;
      this.stepDirection = direction || Math.sign(cars.findIndex(c => c.id === id) - cars.findIndex(c => c.id === this.game.opts.car));
      document.querySelector(`#carList [data-val="${id}"]`).click();
    }
    update(dt, now) {
      if (!this.available || this.game.state !== 'menu' || document.hidden || this.pointer || this.transition || this.reducedMotion.matches || document.querySelector('dialog[open]') || now < this.autoRotateAfter || (RM.TuningUI && RM.TuningUI.open)) {
        this.autoRotateSpeed = 0;
        return;
      }
      // Ease back into motion after inspection. Frame time is capped by the game loop;
      // only yaw changes, so the height / pitch chosen by dragging stays intact.
      this.autoRotateSpeed += (AUTO_ROTATE_SPEED - this.autoRotateSpeed) * (1 - Math.exp(-dt * 3));
      this.angle = (this.angle + this.autoRotateSpeed * dt) % (Math.PI * 2);
      this.dirty = true;
    }
    distance(id) { const s = this.sections[id]; return ((s.s1 - s.s0) / 1000).toFixed(1); }
    save() { try { localStorage.setItem(KEY, JSON.stringify({ ...this.game.opts, volume: +$('volume').value, v: PREFS_V })); } catch (_) { /* Storage is optional. */ } }
    syncVolume() { for (const id of ['musicVol', 'volume']) $(id + 'Value').value = Math.round(+$(id).value / +$(id).max * 100) + '%'; }
    sync() {
      const o = this.game.opts, c = CARS[o.car] || CARS.k8;
      this.syncBackdrop();
      const isTest = o.section === RM.DriftTrack.id;
      $('carMake').textContent = c[0]; $('carName').innerHTML = c[1]; $('carSpecs').innerHTML = c[2];
      this.syncPerformance();
      const index = RM.CarModels.PLAYER_CARS.findIndex(car => car.id === o.car);
      $('carPosition').setAttribute('aria-label', `第 ${index + 1} 台，共 ${RM.CarModels.PLAYER_CARS.length} 台`);
      [...$('carPosition').children].forEach((button, i) => { button.classList.toggle('on', i === index); button.setAttribute('aria-pressed', String(i === index)); });
      $('carCount').textContent = `${index + 1} / ${RM.CarModels.PLAYER_CARS.length}`;
      $('paintName').textContent = RM.CivicModel.COLORS[o.color][0];
      document.querySelectorAll('[data-opt]').forEach(b => { const on = String(o[b.dataset.opt]) === b.dataset.val; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      $('selectedMapName').textContent = MAPS[o.section][0]; $('selectedMapLocation').textContent = MAPS[o.section][1];
      $('selectedMapDistance').innerHTML = this.distance(o.section) + ' <small>km</small>';
      $('mapBtn').setAttribute('aria-label', `選擇地圖：${MAPS[o.section][0]}，${this.distance(o.section)} 公里`);
      $('conditionText').textContent = isTest ? '夏威夷夕陽 · 單向下坡' : WEATHER[o.env] + ' · ' + (o.dir > 0 ? '往宜蘭' : '往台北');
      $('conditionsBtn').setAttribute('aria-label', isTest ? '選擇地圖' : '調整天氣與行駛方向');
      $('mapBtn').querySelector('.map-badge').textContent = isTest ? '夏威夷' : '台 9 線';
      $('mapDialog').querySelector('.route-options').classList.toggle('hidden', isTest);
      $('mapDialog').querySelector('.dialog-footer small').textContent = isTest ? '個人計時 · 乾地封路 · 紀錄列入賽道前 15 名' : '路線依北宜公路實際道路繪製';
      $('recordsBtn').classList.remove('hidden');   // 熱浪夏威夷也有線上紀錄 (以前只存本機時會藏起來)
      this.syncVolume(); this.drawSelectedMap(); this.dirty = true;
    }
    syncBackdrop() {
      const id = this.game.opts.section, src = BACKGROUNDS[id];
      const inMenu = this.game.state === 'boot' || this.game.state === 'menu';
      if (src && inMenu && !this.backdrops[id]) {
        const entry = this.backdrops[id] = { image: new Image(), ready: false };
        entry.image.decoding = 'async';
        entry.image.onload = () => {
          entry.ready = true;
          document.querySelector(`.route-backdrop[data-route="${id}"]`).style.backgroundImage = `url("${src}")`;
          this.syncBackdrop(); // Re-check the current route if the selection changed while loading.
        };
        entry.image.onerror = () => { entry.ready = false; this.syncBackdrop(); };
        entry.image.src = src;
      }
      const active = inMenu && !!(src && this.backdrops[id] && this.backdrops[id].ready);
      document.body.classList.toggle('has-route-backdrop', active);
      document.querySelectorAll('.route-backdrop').forEach(layer => layer.classList.toggle('is-current', active && layer.dataset.route === id));
    }
    syncPerformance() {
      const id = this.game.opts.car;
      // 改裝 (js/game/tuning.js)：加成另外用亮藍色的格子表示，分數旁邊標 +n
      const fit = this.fitNow ? this.fitNow() : null, key = id + '|' + JSON.stringify(fit);
      if (this.ratedKey === key) return;
      this.ratedKey = key; this.ratedCar = id;
      const profile = PERFORMANCE[id] || PERFORMANCE.k8;
      const bonus = fit && RM.Tuning ? RM.Tuning.ratingBonus(fit) : [0, 0, 0, 0];
      this.statRows.forEach((row, index) => {
        const score = RM.clamp(profile.scores[index], 0, STAT_MAX);
        // 改裝有加也有減 (例如三片式深唇圈甩尾強但加速慢一點)：減掉的部分用紅色的格子表示
        const plus = RM.clamp(bonus[index], -score, STAT_MAX - score), total = score + plus;
        const tag = plus >= 0.05 ? `<i class="stat-plus">+${plus.toFixed(1)}</i>` : plus <= -0.05 ? `<i class="stat-minus">−${(-plus).toFixed(1)}</i>` : '';
        row.querySelector('b').innerHTML = score + tag;
        const meter = row.querySelector('.stat-bars');
        meter.setAttribute('aria-valuenow', total.toFixed(1));
        meter.setAttribute('aria-valuetext', `${score} / ${STAT_MAX}` + (tag ? `，改裝 ${plus > 0 ? '+' : '−'}${Math.abs(plus).toFixed(1)}` : ''));
        // 每一格：實心的部分 (--b) 與改裝加成 / 減少 (到 --t) 各填多少 (0～100%)，小數就是填一部分
        const lo = Math.min(score, total), hi = Math.max(score, total);
        [...meter.children].forEach((light, i) => {
          const b = RM.clamp(lo - i, 0, 1), t = RM.clamp(hi - i, 0, 1);
          light.classList.toggle('is-lit', b >= 1);
          light.classList.toggle('is-tuned', t > b && plus > 0);
          light.classList.toggle('is-cut', t > b && plus < 0);
          light.style.setProperty('--b', (b * 100).toFixed(0) + '%');
          light.style.setProperty('--t', (t * 100).toFixed(0) + '%');
        });
      });
      $('carCharacter').textContent = profile.character;
      // 成立的搭配加成 (性能欄下方一行)
      let note = $('comboNote');
      if (!note) { note = document.createElement('p'); note.id = 'comboNote'; note.className = 'combo-note'; $('performanceStats').after(note); }
      const combos = fit && RM.Tuning ? RM.Tuning.combosOf(fit) : [];
      note.hidden = !combos.length;
      note.textContent = combos.length ? '搭配加成：' + combos.map((c) => c.name).join(' · ') : '';
    }
    changed(key) {
      if (key === 'car') {
        this.pauseAutoRotate();
        this.angle = -.94; this.pitch = .23;
        if (!this.transition) { $('previewStatus').textContent = '準備車輛…'; $('previewStatus').classList.remove('hidden'); }
        $('startBtn').disabled = true;
      }
      if (key === 'dir') this.drawMaps();
      if (key === 'quality') this.game.resize();
      this.sync(); this.save();
      if (key === 'car' && RM.TuningUI && RM.TuningUI.open) RM.TuningUI.onCar();   // 改裝面板開著：換成這台車的零件
      if (key === 'car' && this.transition) this.animateCarChange();
    }

    beforeChange(key, next) {
      if (key !== 'car') return true;
      if (this.transition || next === this.game.opts.car) return false;
      if (!this.available || !this.preview || this.reducedMotion.matches) { this.stepDirection = 0; return true; }
      // Capture while the WebGL drawing buffer is valid, before the preview cache can evict a model.
      // The compositor can move this snapshot while JavaScript builds the next model.
      this.dirty = true; this.render();
      const canvas = this.game.canvas, rect = canvas.getBoundingClientRect();
      const snapshot = document.createElement('canvas');
      snapshot.className = 'car-transition'; snapshot.setAttribute('aria-hidden', 'true');
      snapshot.width = canvas.width; snapshot.height = canvas.height;
      snapshot.getContext('2d').drawImage(canvas, 0, 0);
      Object.assign(snapshot.style, { left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' });
      document.body.append(snapshot);
      const direction = this.stepDirection || 1;
      this.stepDirection = 0;
      this.transition = { snapshot, direction, travel: Math.min(130, rect.width * .18), animations: [] };
      $('menu').classList.add('is-switching-car');
      $('carPerformance').classList.add('is-charging');
      canvas.style.opacity = '0';
      document.querySelector('.car-heading').style.opacity = '0';
      $('prevCar').disabled = $('nextCar').disabled = true;
      $('carPosition').setAttribute('aria-busy', 'true');
      $('showroom').setAttribute('aria-busy', 'true');
      this.pointer = null;
      return true;
    }

    async animateCarChange() {
      const t = this.transition, canvas = this.game.canvas;
      const heading = document.querySelector('.car-heading');
      const timing = { duration: 220, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'both' };
      try {
        // Commit the snapshot before rebuilding GPU resources; keep the outgoing frame in motion.
        await new Promise(resolve => requestAnimationFrame(resolve));
        if (this.transition !== t) return;
        const outgoing = t.snapshot.animate([
          { transform: 'translateX(0)', opacity: 1 },
          { transform: `translateX(${-t.direction * t.travel}px)`, opacity: 0 },
        ], timing);
        t.animations.push(outgoing);
        // Build while the compositor slides the old car away; no sequential exit / entry wait.
        await new Promise(resolve => requestAnimationFrame(resolve));
        if (this.transition !== t) return;
        this.prepareCar(); this.dirty = true; this.render(true);
        const incoming = canvas.animate([
          { transform: `translateX(${t.direction * t.travel}px)`, opacity: 0 },
          { transform: 'translateX(0)', opacity: 1 },
        ], timing);
        $('carPerformance').classList.remove('is-charging');
        const title = heading.animate([
          { transform: `translateX(${t.direction * 12}px)`, opacity: 0 },
          { transform: 'translateX(0)', opacity: 1 },
        ], { ...timing, duration: 180 });
        t.animations.push(incoming, title);
        await Promise.all(t.animations.map(a => a.finished.catch(() => {})));
      } catch (error) {
        console.error('車輛切換失敗', error);
        $('previewStatus').textContent = '車輛載入失敗，請重新整理';
        $('previewStatus').classList.remove('hidden');
      } finally {
        if (this.transition === t) this.cancelTransition();
      }
    }

    cancelTransition() {
      const t = this.transition;
      if (!t) return;
      this.transition = null;
      this.pauseAutoRotate();
      t.animations.forEach(a => a.cancel()); t.snapshot.remove();
      this.game.canvas.style.removeProperty('opacity');
      document.querySelector('.car-heading').style.removeProperty('opacity');
      $('menu').classList.remove('is-switching-car');
      $('carPerformance').classList.remove('is-charging');
      $('prevCar').disabled = $('nextCar').disabled = false;
      $('carPosition').removeAttribute('aria-busy');
      $('showroom').removeAttribute('aria-busy');
      this.dirty = true;
    }
    // North-up, undistorted route outline. Hillshade and 50 m contours stay secondary to the route.
    drawMap(canvas, id, compact = false) {
      const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
      const isTest = id === RM.DriftTrack.id;
      const data = isTest ? RM.DriftTrack.data : window.RM_DATA.route;
      const route = isTest ? data.points : this.route;
      const sec = this.sections[id], sp = data.spacing;
      const a = Math.floor(sec.s0 / sp), b = Math.min(route.length / 3 - 1, Math.ceil(sec.s1 / sp));
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = a; i <= b; i++) { const x = route[i * 3], z = route[i * 3 + 2]; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
      const padY = compact ? 72 : 48, scale = Math.min((w - 176) / Math.max(1, maxX - minX), (h - padY * 2) / Math.max(1, maxZ - minZ));
      const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, oy = compact ? h * .44 : h * .5;
      const project = i => [(route[i * 3] - cx) * scale + w / 2, (route[i * 3 + 2] - cz) * scale + oy];
      ctx.fillStyle = '#1a2526'; ctx.fillRect(0, 0, w, h);
      const hm = isTest ? null : this.game.hm;
      if (hm) {
        const step = 8, nx = Math.ceil(w / step) + 1, ny = Math.ceil(h / step) + 1, heights = [];
        for (let y = 0; y < ny; y++) {
          heights[y] = [];
          for (let x = 0; x < nx; x++) {
            const wx = cx + (x * step - w / 2) / scale, wz = cz + (y * step - oy) / scale;
            const ht = hm.sample(wx, wz); heights[y][x] = ht;
            const light = RM.clamp((hm.sample(wx - 60, wz - 60) - hm.sample(wx + 60, wz + 60)) * .06, -9, 9), tint = Math.min(ht / 130, 7) + light;
            ctx.fillStyle = `rgb(${Math.round(23 + tint)},${Math.round(34 + tint)},${Math.round(34 + tint)})`; ctx.fillRect(x * step, y * step, step, step);
          }
        }
        ctx.lineWidth = .7; ctx.strokeStyle = '#9cb6a51c'; ctx.beginPath();
        for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
          const v = [heights[y][x], heights[y][x + 1], heights[y + 1][x + 1], heights[y + 1][x]];
          const corners = [[x * step, y * step], [(x + 1) * step, y * step], [(x + 1) * step, (y + 1) * step], [x * step, (y + 1) * step]];
          for (let level = Math.ceil(Math.min(...v) / 50) * 50; level < Math.max(...v); level += 50) {
            const hits = [];
            for (let e = 0; e < 4; e++) { const n = (e + 1) % 4; if ((v[e] < level) === (v[n] < level)) continue; const t = (level - v[e]) / (v[n] - v[e]); hits.push([corners[e][0] + (corners[n][0] - corners[e][0]) * t, corners[e][1] + (corners[n][1] - corners[e][1]) * t]); }
            for (let i = 0; i + 1 < hits.length; i += 2) { ctx.moveTo(...hits[i]); ctx.lineTo(...hits[i + 1]); }
          }
        }
        ctx.stroke();
      }
      ctx.strokeStyle = '#c4d6cf07'; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = 0; x < w; x += 64) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = 0; y < h; y += 64) { ctx.moveTo(0, y); ctx.lineTo(w, y); } ctx.stroke();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
      for (let i = a; i <= b; i++) { const p = project(i); i === a ? ctx.moveTo(...p) : ctx.lineTo(...p); }
      ctx.strokeStyle = '#080f0ee0'; ctx.lineWidth = 12; ctx.stroke();
      ctx.shadowColor = '#cefa8b66'; ctx.shadowBlur = 14; ctx.strokeStyle = '#d8f98a'; ctx.lineWidth = 4.5; ctx.stroke(); ctx.shadowBlur = 0;
      const reverse = !isTest && this.game.opts.dir < 0;
      for (const [i, start] of [[a, !reverse], [b, reverse]]) {
        const [x, y] = project(i); ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fillStyle = start ? '#d8f98a' : '#f1f5e9'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#172321'; ctx.stroke();
        ctx.fillStyle = start ? '#d8f98a' : '#f1f5e9'; ctx.font = '15px Segoe UI, sans-serif'; ctx.fillText(start ? 'START' : 'FINISH', x + 13, y + 5);
      }
      ctx.fillStyle = '#9eb0a275'; ctx.font = '13px Segoe UI, sans-serif'; ctx.fillText('N', 24, 30);
      ctx.strokeStyle = '#9eb0a260'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(29, 39); ctx.lineTo(29, 57); ctx.stroke();
    }
    drawMaps() { for (const id in this.maps) this.drawMap(this.maps[id], id); this.drawSelectedMap(); }
    drawSelectedMap() { this.drawMap($('selectedMap'), this.game.opts.section, true); }
    ready() {
      this.available = true;
      const mb = new RM.MeshBuilder();
      // A transparent ground plane: the shader draws only contact shadow and pit-lane lights.
      mb.quad([-2.1, -.025, 3.3], [2.1, -.025, 3.3], [2.1, -.025, -3.3], [-2.1, -.025, -3.3], RM.mat('#ffffff'));
      this.studioGround = mb.build();
      this.env = { ...RM.ENV.sunny, az: 310, el: 48, sun: [1, .98, .91], sunI: 2.6, sky: [.47, .56, .62], skyI: 1.15, ground: [.15, .17, .16], fog: [.03, .04, .04], dens: 0, exp: 1.15, shadow: 0 };
      this.drawMaps(); this.game.resize(); this.dirty = true;
      if (!this.game.loopStarted) { this.game.loopStarted = true; requestAnimationFrame(t => this.game.frame(t)); }
    }
    // 車庫展示的改裝：改裝面板試裝中 (tryFit) 就用試裝的，否則用這台車實際裝的 (js/game/tuning.js)
    fitNow() {
      const T = RM.Tuning, car = this.game.opts.car;
      if (!T) return null;
      return this.tryFit && this.tryFit.car === car ? this.tryFit.fit : T.fitOf(car, RM.Platform && RM.Platform.mods);
    }
    prepareCar() {
      const g = this.game, model = RM.ProcCar.getPreview(g.opts.car, g.atlas), spec = model.spec(), fit = this.fitNow();
      if (fit) RM.Tuning.applySpec(spec, fit);
      const car = new RM.Vehicle(g.road, spec);
      car.pos = [0, spec.cgH, spec.cgZ]; car.wheels.forEach(w => { if (w.front) w.steer = -.12; });
      const tuneVis = fit && RM.TuningVis ? RM.TuningVis.get(model, spec, fit, () => { this.dirty = true; }, RM.CivicModel.COLORS[g.opts.color][1]) : null;
      this.preview = { car, carModel: model, opts: g.opts, paint: RM.srgb(RM.CivicModel.COLORS[g.opts.color][1]), headOn: false, blink: {}, cam: { name: 'showroom' }, tuneVis, fitKey: JSON.stringify([fit, g.opts.color]) };
      g.carModel = model; $('previewStatus').classList.add('hidden');
      if (g.state === 'menu' && !this.transition) $('startBtn').disabled = false;
    }
    render(force = false) {
      if (!this.available || document.hidden || !this.dirty || (this.transition && !force)) return;
      const g = this.game, r = g.renderer, gl = g.gl;
      if (!this.preview || this.preview.carModel.id !== g.opts.car || this.preview.fitKey !== JSON.stringify([this.fitNow(), g.opts.color])) this.prepareCar();
      this.preview.paint = RM.srgb(RM.CivicModel.COLORS[g.opts.color][1]);
      const rect = $('showroom').getBoundingClientRect(), aspect = Math.max(.25, rect.width / Math.max(1, rect.height)), distance = Math.max(6.7, 10 / aspect) * (this.zoom || 1);
      // focus：改裝面板看特定部位 (輪子、尾管) 時的注視點；viewShift：面板開著時把車往左移 (相機往右平移)
      const tg = this.focus || [0, .62, 0];
      const cam = { eye: [tg[0] + Math.sin(this.angle) * distance * Math.cos(this.pitch), tg[1] + .08 + Math.sin(this.pitch) * distance, tg[2] - Math.cos(this.angle) * distance * Math.cos(this.pitch)], target: tg.slice(), up: [0, 1, 0], fov: rect.width < 641 && rect.height < 180 ? 25 : 29 };
      const viewShift = innerWidth <= 760 && RM.TuningUI && RM.TuningUI.open ? 0 : this.viewShift;
      if (viewShift) {
        const fx = cam.target[0] - cam.eye[0], fz = cam.target[2] - cam.eye[2], l = Math.hypot(fx, fz) || 1, s = viewShift * (this.zoom || 1);
        for (const p of [cam.eye, cam.target]) { p[0] += (-fz / l) * s; p[2] += (fx / l) * s; }
      }
      const f = { terrain: [], road: [], props: [], decals: [], inst: [], dynamic: [], glass: [], shadowProps: [], shadowInst: [], shadowDynamic: [], background: [0, 0, 0], studio: true, studioGround: this.studioGround };
      g._carDraw.call(this.preview, f.dynamic, f.glass, f.shadowDynamic); f.car = this.preview._carShell;
      f.car.dirt = 0; f.dynamic.forEach(d => { d.dirt = 0; });
      const previous = r.env; r.env = this.env;
      r.begin(cam, gl.drawingBufferWidth, gl.drawingBufferHeight, 0, [0, 0, 0], null, { carP: [0, 0, 0], carF: [0, -1], carHalf: [.82, 2.05], studio: true });
      r.draw(f); r.env = previous; this.dirty = false;
      $('previewStatus').classList.add('hidden');
      if (g.state === 'menu' && !this.transition) $('startBtn').disabled = false;
    }
    show() { this.pauseAutoRotate(); this.preview = null; this.dirty = true; $('hud').classList.add('hidden'); $('flash').style.opacity = 0; this.game.resize(); this.sync(); }
    hide() { if (RM.TuningUI) RM.TuningUI.hide(); this.pauseAutoRotate(); this.cancelTransition(); this.preview = null; RM.ProcCar.clearPreviews(); document.querySelectorAll('dialog[open]').forEach(d => d.close()); document.body.classList.remove('has-route-backdrop'); this.pointer = null; $('hud').classList.remove('hidden'); }
  }
  RM.MenuUI = MenuUI;
})();
