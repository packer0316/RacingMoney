'use strict';
// 北宜公路 · 喜美 K8 — 主程式
(function () {
  const RM = window.RM;
  const { m4, quat, v3, clamp } = RM;

  const SECTIONS = {
    // 約 2 分鐘的短程衝刺：台9線 30.6K～32.7K 一帶 (2.08 km)。路形已為遊戲重新設計 (見 road.js 的 EDITS)：
    // 起跑直線 → ①高速右掃 → ②大左 U → ③～⑥連續 S → ⑦髮夾 → 山頂直線 → ⑧假動作接⑨髮夾 → ⑩⑪左右連彎 → 長直線 → ⑬ → 終點
    // 兩端都在直線上，雙向起跑都順。cps = 本路段額外的分段計時點
    sprint: {
      name: '北宜彎道衝刺（30.6K → 32.7K）', s0: 18940, s1: 21020,
      cps: [{ name: '大U彎', s: 19420 }, { name: '雙髮夾彎', s: 20320 }],
    },
    [RM.DriftTrack.id]: RM.DriftTrack.section,
    nine: { name: '九彎十八拐（石牌 → 頭城）', s0: 44930, s1: 58200 },
    pl_tc: { name: '坪林 → 頭城', s0: 26570, s1: 58200 },
    xd_pl: { name: '新店 → 坪林', s0: 80, s1: 26570 },
    full: { name: '全程 新店 → 頭城', s0: 80, s1: 58200 },
  };
  const INTERVAL = { a: 21565, b: 25465, limit: 40 };
  const CAMERAS = [[31000, 1], [42000, 1], [50000, 1], [52000, -1]];
  const QUALITY = {
    // 算圖解析度 = min(螢幕 DPR, cap) x mul x 動態解析度；msaa：4 = 4 倍多重取樣 (內顯負擔很重)、0 = 改用 FXAA
    // lod：植生由完整模型換成簡化模型的距離區間 (公尺，區間內交叉淡入)
    // terrain：地形高解析度網格鋪設距離的倍率 (terrain.js setDetail)
    // sh：[陰影貼圖大小, 涵蓋半徑 (m), 中心往鏡頭前方偏移 (m)]；每格大小 = 2 x 半徑 / 貼圖大小 (約 7 ~ 10 cm)
    // aniso：各向異性過濾上限 [柏油路面, 地面 (草/岩/土/樹冠), 樹葉]；斜看的貼圖越清晰，但每個像素要多讀好幾次貼圖
    ultra: { cap: 1.5, mul: 1, msaa: 4, shadow: true, tree: 800, build: 1700, props: 1200, lod: [90, 130], terrain: 1.3, sh: [2048, 68, 46], aniso: [16, 8, 4] },
    high: { cap: 1.25, mul: 1, msaa: 0, shadow: true, tree: 800, build: 1700, props: 1200, lod: [90, 130], terrain: 1, sh: [1536, 56, 38], aniso: [8, 4, 2] },
    medium: { cap: 1, mul: 0.85, msaa: 0, shadow: true, tree: 560, build: 1400, props: 900, lod: [65, 95], terrain: 0.85, sh: [1024, 48, 32], aniso: [4, 2, 2] },
    low: { cap: 1, mul: 0.7, msaa: 0, shadow: false, tree: 380, build: 1300, props: 700, lod: [45, 70], terrain: 0.7, sh: [1024, 48, 32], aniso: [2, 1, 1] },
  };
  const $ = (id) => document.getElementById(id);

  const G = {
    // 路上車流、ABS 預設關閉 (想要的人到設定裡打開)
    state: 'boot', opts: { section: 'sprint', dir: 1, env: 'sunny', color: 0, traffic: false, abs: false, quality: 'high', car: 'k8' },
    async boot() {
      RM.MenuUI.restore(this.opts, SECTIONS);
      const canvas = $('gl');
      this.canvas = canvas;
      this.gl = RM.GLU.init(canvas);
      this.hud = null;
      this.input = new RM.Input();
      this.audio = new RM.CarAudio();
      this.music = new RM.Music();
      this.music.onChange = () => this._syncMusic();
      this.music.onTrack = (t) => {
        this._syncMusic();
        if (this.state === 'drive' && this.hud) this.hud.message('♪ ' + RM.Music.label(t), 2.5, '#9fe8ff');
      };
      this._buildCarList();
      this.menu = new RM.MenuUI(this, SECTIONS);
      this._bindMenu();
      this.menu.sync();
      this.audio.setVolume(+$('volume').value);
      $('hud').classList.add('hidden');
      window.addEventListener('resize', () => this.resize());
      try {
        await this.loadWorld((p, t) => this._progress(p, t));
        this.state = 'menu';
        this.menu.dirty = true;
        this.menu.render();
        $('startBtn').disabled = false;
        $('startLabel').textContent = '個人計時賽';
        this._loadCarModels();
        $('loadbar').parentElement.style.display = 'none';
        $('loadtext').textContent = '世界載入完成';
        $('loadStatus').classList.add('hidden');
      } catch (e) {
        console.error(e);
        $('loadtext').textContent = '載入失敗：' + e.message;
        $('previewStatus').textContent = '載入失敗，請重新整理';
        $('previewStatus').classList.remove('hidden');
      }
    },

    _buildCarList() {
      const box = $('carList');
      box.innerHTML = '';
      for (const c of RM.CarModels.PLAYER_CARS) {
        const b = document.createElement('button');
        b.dataset.opt = 'car'; b.dataset.val = c.id;
        b.className = 'carbtn' + (c.id === this.opts.car ? ' on' : '');
        b.innerHTML = `<b>${c.name}</b><small>${c.sub}</small>`;
        b.title = c.credit;
        if (c.model) b.disabled = true;
        box.appendChild(b);
      }
    },
    async _loadCarModels() {
      $('carStatus').textContent = '以 three.js 載入車輛模型中…';
      const ok = await RM.CarModels.init((p) => { $('carStatus').textContent = `以 three.js 載入車輛模型中… ${Math.round(p * 100)}%`; });
      if (ok) {
        document.querySelectorAll('#carList .carbtn').forEach((b) => { b.disabled = false; });
        $('carStatus').textContent = '玩家車款為程序化模型；路上車流以 three.js 載入 Kenney Car Kit (CC0)';
        this.traffic.setModels(RM.CarModels);
      } else {
        $('carStatus').textContent = '無法連線載入 three.js：路上車流改用簡易模型（玩家車款不受影響）';
      }
    },

    _progress(p, t) {
      $('loadbar').style.width = Math.round(p * 100) + '%';
      if (t) $('loadtext').textContent = t;
    },
    _tick() { return new Promise((r) => setTimeout(r, 0)); },

    async loadWorld(prog) {
      const D = window.RM_DATA;
      prog(0.02, '解碼地形高程 (SRTM)…'); await this._tick();
      this.hm = await RM.Heightmap.load(D.terrain);
      prog(0.12, '建立台9線道路幾何…'); await this._tick();
      this.road = new RM.Road(D.route, this.hm);
      this.baseRoad = this.road;
      prog(0.2, '繪製柏油、草地、樹冠材質…'); await this._tick();
      const T = RM.Tex, G2 = RM.GLU;
      const tex = {};
      tex.asphalt = G2.texture(T.asphalt(), { aniso: 16 });
      tex.cracks = G2.texture(T.cracks(), { linear: true, aniso: 16 });
      await this._tick();
      tex.grass = G2.texture(T.grass());
      tex.canopy = G2.texture(T.canopy());
      await this._tick();
      tex.rock = G2.texture(T.rock());
      tex.dirt = G2.texture(T.dirt());
      tex.concrete = G2.texture(T.concrete());
      tex.noise = G2.texture(T.noise(), { linear: true });
      tex.surface = G2.surfaceTexture(T.surfaces(), 256);
      prog(0.32, '繪製樹葉、招牌、交通標誌…'); await this._tick();
      tex.foliage = G2.texture(T.foliage(), { aniso: 4 });
      const kmFrom = Math.ceil(this.road.kmOffset), kmTo = Math.floor(this.road.length / 1000 + this.road.kmOffset);
      this.atlas = T.buildAtlas(kmFrom, kmTo);
      tex.atlas = G2.texture(this.atlas.c, { aniso: 8 });
      this.tex = tex;
      prog(0.42, '編譯著色器…'); await this._tick();
      this.renderer = new RM.Renderer(this.gl, tex);
      this.renderer.makeWater(this.hm);
      this.skid = new RM.SkidMarks(8192);   // 胎痕
      prog(0.48, '建立植物模型 (樟樹、柳杉、筆筒樹、檳榔、竹)…'); await this._tick();
      this.trees = RM.Trees.build();
      prog(0.52, '建立喜美 K8 模型…'); await this._tick();
      // 程序化車款 (車殼 + 貼圖 + 零件)；先建立目前選的那台，換車時在 startRace 重建
      this.carModel = RM.ProcCar.getPreview(this.opts.car, this.atlas);
      this.menu.ready();
      this.traffic = new RM.Traffic(this.road);
      prog(0.56, '建立遠景地形 (雪山山脈、蘭陽平原、龜山島)…'); await this._tick();
      this.terrain = new RM.Terrain(this.hm, this.road);
      this.terrain.buildSupers();
      prog(0.66, '規劃沿線景物…'); await this._tick();
      this.scenery = new RM.Scenery(this.road, this.atlas, this.trees, this.hm, D.route.origin);
      this.scenery.buildFar();
      this.car = new RM.Vehicle(this.road);
      this.cam = new RM.CameraRig(this.road);
      this.hud = new RM.HUD($('hud'), this.road);
      this.resize();
      // 預載起點
      const sec = SECTIONS[this.opts.section];
      if (sec !== RM.DriftTrack.section) {
        const s = this.opts.dir > 0 ? sec.s0 : sec.s1;
        await this._preload(s, (p) => prog(0.7 + p * 0.3, '產生起點附近地形與景物…'));
      }
      prog(1, '完成');
    },

    async _preload(s, prog) {
      if (this.testCourse) { prog(1); return; }
      const f = this.road.frameAt(s, {});
      let n = 0;
      // 地形
      for (let k = 0; k < 400; k++) {
        this.terrain.update(f.x, f.z, 30, false);
        if (!this.terrain.pending()) break;
        if (++n % 3 === 0) { prog(Math.min(0.6, k / 40)); await this._tick(); }
      }
      // 景物 chunk：整個可視範圍 (畫質的建置距離) 一次建好，不留到起步後逐幀建置 (每建一塊就卡一幀)
      const q = QUALITY[this.opts.quality];
      const want = this.scenery.chunks.filter((c) => Math.hypot(c.cx - f.x, c.cz - f.z) - c.r < q.build + 100)
        .sort((a, b) => Math.hypot(a.cx - f.x, a.cz - f.z) - Math.hypot(b.cx - f.x, b.cz - f.z));
      for (let i = 0; i < want.length; i++) {
        if (!want[i].built) this.scenery.buildChunk(want[i]);
        if (i % 2 === 0) { prog(0.6 + (0.4 * i) / want.length); await this._tick(); }
      }
    },

    _bindMenu() {
      const opts = this.opts;
      document.querySelectorAll('[data-opt]').forEach((el) => {
        el.addEventListener('click', () => {
          const k = el.dataset.opt, v = el.dataset.val;
          if (!this.menu.beforeChange(k, v)) return;
          opts[k] = k === 'dir' || k === 'color' ? +v : v === 'true' ? true : v === 'false' ? false : v;
          document.querySelectorAll(`[data-opt="${k}"]`).forEach((e) => e.classList.toggle('on', e === el));
          this.menu.changed(k);
        });
      });
      $('startBtn').addEventListener('click', () => this.startRace());
      $('resumeBtn').addEventListener('click', () => this.pause(false));
      $('restartBtn').addEventListener('click', () => { this.pause(false); this.startRace(); });
      $('menuBtn').addEventListener('click', () => this.toMenu());
      $('againBtn').addEventListener('click', () => { $('results').classList.add('hidden'); this.startRace(); });
      $('resMenuBtn').addEventListener('click', () => { $('results').classList.add('hidden'); this.toMenu(); });
      $('volume').addEventListener('input', (e) => this.audio.setVolume(+e.target.value));
      this._bindMusic();
    },

    _bindMusic() {
      const music = this.music, box = $('musicOpts');
      const choices = [['off', '關閉音樂'], ...RM.Music.TRACKS.map((t) => [t.id, RM.Music.label(t)]), ['shuffle', '隨機輪播']];
      for (const [id, label] of choices) {
        const b = document.createElement('button');
        b.dataset.music = id; b.textContent = label;
        if (id === 'shuffle') b.title = '再按一次切到下一首';
        b.classList.toggle('on', id === music.choice);
        b.setAttribute('aria-pressed', String(id === music.choice));
        b.addEventListener('click', () => music.select(id));
        box.appendChild(b);
      }
      document.querySelectorAll('[data-music-step]').forEach(b => b.addEventListener('click', () => music.step(+b.dataset.musicStep)));
      this._syncMusic();
      const vol = $('musicVol');
      vol.value = music.vol;
      vol.addEventListener('input', () => music.setVolume(+vol.value));
      // 瀏覽器要求有使用者互動才能播放聲音：主選單上第一次點擊或按鍵時開始播放
      const kick = (e) => {
        document.removeEventListener('pointerdown', kick, true);
        document.removeEventListener('keydown', kick, true);
        if (e.target && e.target.closest && e.target.closest('[data-music], [data-music-step]')) return; // 交給按鈕自己處理
        if (this.state === 'boot' || this.state === 'menu') music.play();
      };
      document.addEventListener('pointerdown', kick, true);
      document.addEventListener('keydown', kick, true);
    },

    _syncMusic() {
      const music = this.music, off = music.choice === 'off';
      const track = RM.Music.TRACKS.find(t => t.id === music.choice) || music.cur;
      const title = off ? '音樂已關閉' : track ? RM.Music.label(track) : '隨機輪播';
      if ($('musicTitle').textContent !== title) {
        $('musicTitle').textContent = $('musicTitleCopy').textContent = title;
        document.querySelector('.music-marquee').getAnimations().forEach(a => { a.currentTime = 0; });
      }
      $('musicTrack').title = title;
      $('musicPlayer').classList.toggle('is-off', off);
      $('nowPlaying').textContent = !off && track ? '♪ ' + RM.Music.label(track) : '';
      document.querySelectorAll('#musicOpts [data-music]').forEach(b => {
        const on = b.dataset.music === music.choice;
        b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
      });
    },

    resize() {
      if (this.menu) this.menu.cancelTransition();
      this._applyRes();
      if (this.menu) this.menu.dirty = true;
      if (this.hud) this.hud.resize(window.innerWidth, window.innerHeight, Math.min(window.devicePixelRatio || 1, 2));
      this._redraw = true;
    },
    // 畫布 = 畫質的算圖解析度 (由瀏覽器放大到視窗大小)；HUD 另一張畫布維持螢幕解析度，文字仍清晰
    // 動態解析度不改畫布大小 (改畫布會卡一下)，只改 Renderer 畫在離屏目標的區域比例
    _applyRes() {
      const q = QUALITY[this.opts.quality];
      const showroom = this.menu && (this.state === 'boot' || this.state === 'menu');
      const rect = showroom ? $('showroom').getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight, left: 0, top: 0 };
      const w = Math.max(16, rect.width), h = Math.max(16, rect.height);
      const s = Math.min(window.devicePixelRatio || 1, q.cap) * q.mul;
      const cw = Math.max(16, Math.round(w * s)), ch = Math.max(16, Math.round(h * s));
      if (this.canvas.width !== cw || this.canvas.height !== ch) { this.canvas.width = cw; this.canvas.height = ch; }
      this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
      this.canvas.style.left = rect.left + 'px'; this.canvas.style.top = rect.top + 'px';
      if (this.renderer) {
        this.renderer.setTarget(cw, ch, q.msaa); this.renderer.dyn = this.dynRes || 1;
        this.renderer.surfaceRange = { low: 75, medium: 120, high: 180, ultra: 220 }[this.opts.quality];
      }
      if (this.terrain) this.terrain.setDetail(q.terrain || 1);
      if (this.renderer && q.sh) this.renderer.setShadow(q.sh[0], q.sh[1]);
      this._applyAniso(q.aniso);
    },
    // 依畫質設定貼圖的各向異性過濾 (雜訊圖本身很平滑，固定不用)
    _applyAniso(a) {
      const G2 = RM.GLU, gl = this.gl, ext = G2.aniso, T = this.tex;
      if (!ext || !T || !a || this._aniso === a) return;
      this._aniso = a;
      const set = (t, v) => { if (!t) return; gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.max(1, Math.min(v, G2.maxAniso))); };
      set(T.asphalt, a[0]); set(T.cracks, a[0]);
      for (const k of ['grass', 'canopy', 'rock', 'dirt', 'concrete']) set(T[k], a[1]);
      set(T.foliage, a[2]); set(T.atlas, Math.max(a[1], 4));
      set(T.noise, 1);
      if (T.surface) {
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, T.surface);
        gl.texParameterf(gl.TEXTURE_2D_ARRAY, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(a[1], 2, G2.maxAniso));
      }
    },
    // 動態解析度：顯示卡跟不上 (持續掉幀且 GPU 時間偏高) 時降低算圖解析度；GPU 有餘裕時再調回
    // 有 GPU 計時就以實測 GPU 時間判斷 (CPU 偶發卡頓不會誤降解析度)，否則以幀間隔判斷
    _dynResStep(raw) {
      if (!(raw > 0 && raw < 0.25)) return;
      const D = this._dr || (this._dr = { ema: 16.7, t: 0, down: 2, up: 4, ceil: 1, best: 16.7 });
      D.ema += (raw * 1000 - D.ema) * 0.08;
      D.t += raw; D.down -= raw; D.up -= raw;
      if (D.t < 0.5) return;
      D.t = 0;
      // 螢幕更新率低於 60 Hz 時 (best 偏高) 以實際可達的幀時間為基準
      D.best = Math.min(D.best + 0.02, D.ema);
      const budget = Math.max(16.7, D.best) * 0.78; // GPU 預算：留給 HUD 與瀏覽器合成
      const slow = Math.max(19.5, D.best * 1.15), ok = Math.max(17.3, D.best * 1.04);
      const gpu = this.renderer.gpuMs;
      const cur = this.dynRes || 1;
      let next = cur;
      if (D.ema > slow && cur > 0.6 && D.down <= 0 && (gpu === undefined || gpu > budget * 0.85)) {
        next = Math.max(0.6, cur - 0.1); D.ceil = cur - 0.05; D.down = 1.5; D.up = gpu === undefined ? 8 : 3;
      } else if (D.ema < ok && D.up <= 0 && cur < 1) {
        const n2 = Math.min(1, cur + 0.05);
        // 有 GPU 計時：預估調高後 (像素數 ∝ 比例²) 仍在預算內才調；沒有就用上限慢慢放寬
        if (gpu !== undefined ? gpu * (n2 / cur) ** 2 < budget : n2 <= D.ceil) { next = n2; D.up = gpu === undefined ? 5 : 2; }
      }
      D.ceil = Math.min(1, D.ceil + 0.002);
      if (next !== cur) { this.dynRes = Math.round(next * 100) / 100; this.renderer.dyn = this.dynRes; D.ema = 16.7; }
    },

    toMenu() {
      this.state = 'menu';
      if (RM.Start) RM.Start.cancel();
      if (this.ghost) { this.ghost.close(); this.ghost = null; }   // 回車庫就結束挑戰
      $('pause').classList.add('hidden');
      $('menu').classList.remove('hidden');
      this.menu.show();
      this.audio.suspend();
      this.music.play();
    },

    pause(on) {
      if (on && this.state === 'drive') { this.state = 'paused'; $('pause').classList.remove('hidden'); this.audio.suspend(); this.music.pause(); }
      else if (!on && this.state === 'paused') { this.state = 'drive'; $('pause').classList.add('hidden'); this.audio.resume(); this.music.play(); this.last = performance.now(); }
    },

    async startRace() {
      if (!this.renderer || this.menu.transition || ['loading', 'warmup', 'boot'].includes(this.state)) return;
      this.state = 'loading';
      if (RM.Start) RM.Start.cancel();   // 上一場的倒數 (按「重新開始」時還在數)
      if (this.ghost) this.ghost.close();   // 挑戰「再跑一次」：幽靈車等這一場載入完 (RM.Replay.start) 再出現
      this.menu.hide();
      const o = this.opts;
      const sec = SECTIONS[o.section];
      const isTest = sec === RM.DriftTrack.section;
      if (isTest && !this.driftWorld) {
        // 第一次進熱浪夏威夷要建整座島 (約 1 秒)：先讓載入畫面畫出來再建，畫面才不會停在空白
        $('loading2').classList.remove('hidden');
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
        this.driftWorld = RM.DriftTrack.build();
      }
      this.testCourse = isTest ? this.driftWorld : null;
      this.road = isTest ? this.driftWorld.road : this.baseRoad;
      this.cam.road = this.traffic.road = this.hud.road = this.road;
      this.cam.hint.i = 0;
      // 換畫質時動態解析度從頭來；剛開始的載入卡頓不列入
      if (this._resQ !== o.quality) { this.dynRes = 1; this._resQ = o.quality; this._dr = null; }
      if (this._dr) { this._dr.down = 2; this._dr.ema = 16.7; }
      this.resize();
      $('menu').classList.add('hidden');
      this.audio.start();
      this.audio.resume();
      this.music.play();
      const envKey = isTest ? (RM.DriftTrack.env || 'sunny') : o.env;   // 熱浪夏威夷固定用自己的天空 (夏威夷夕陽)
      this.renderer.setEnv(envKey);
      const env = RM.ENV[envKey];
      this.headOn = !!env.head;
      let carDef = RM.CarModels.PLAYER_CARS.find((c) => c.id === o.car) || RM.CarModels.PLAYER_CARS[0];
      if (carDef.model && !(RM.CarModels.ready && RM.CarModels.assets['player:' + carDef.id])) carDef = RM.CarModels.PLAYER_CARS[0];
      this.carDef = carDef;
      this.carAsset = carDef.model ? RM.CarModels.assets['player:' + carDef.id] : null;
      if (!this.carAsset) this.carModel = RM.ProcCar.get(carDef.id, this.atlas);
      const spec = this.carAsset ? RM.makeSpec(carDef.spec, this.carAsset.dims) : this.carModel.spec();
      // 改裝 (js/game/tuning.js)：性能套進規格、外觀交給 _carDraw。看重播時用那筆重播記的改裝 (rp.m，伺服器存的改裝代碼)：
      // 輪圈 / 卡鉗 / 排氣管 / 彩繪 / 車高照那位玩家的畫，引擎聲與換檔點也跟著他的規格；沒記 (舊重播、全原廠) 就是原廠
      const fit = !RM.Tuning ? null : this.replay ? RM.Tuning.fromCode(this.replay.rp.m) : RM.Tuning.fitOf(carDef.id, RM.Platform && RM.Platform.mods);
      if (fit) RM.Tuning.applySpec(spec, fit);
      this.tuneVis = fit && RM.TuningVis && !this.carAsset ? RM.TuningVis.get(this.carModel, spec, fit, null, RM.CivicModel.COLORS[o.color][1]) : null;
      this.car = new RM.Vehicle(this.road, spec);
      this.car.abs = o.abs;
      this.car.wet = env.wet;
      const mp = !!(RM.Net && RM.Net.racing);   // 多人房間的比賽 (封路、同步起跑)
      this.traffic.enabled = o.traffic && !mp && !isTest && !this.replay;   // 看重播：畫面上只有那位玩家的車
      this.traffic.clear();
      // 撞斷的電線桿 / 路燈恢復原狀
      if (!isTest) this.scenery.resetBreaks();
      for (const d of this.debris || []) RM.GLU.deleteMesh(d.mesh);
      this.debris = [];
      this.paint = RM.srgb(RM.CivicModel.COLORS[o.color][1]);
      const dir = isTest ? 1 : o.dir;
      this.race = {
        sec, dir, startS: dir > 0 ? sec.s0 : sec.s1, finishS: dir > 0 ? sec.s1 : sec.s0,
        started: false, finished: false, t: 0, top: 0, hits: 0, tickets: [], fuel0: this.car.fuel,
        checkpoints: this.road.landmarks.map((l) => ({ name: l.name, s: l.i * this.road.sp }))
          .concat((sec.cps || []).map((c) => ({ name: c.name, s: c.s })))
          .filter((c) => c.s > Math.min(sec.s0, sec.s1) + 200 && c.s < Math.max(sec.s0, sec.s1) - 200)
          .sort((a, b) => (a.s - b.s) * dir).map((c) => Object.assign(c, { done: false })),
        interval: null, yellowT: 0, yellowCool: 0, camDone: {}, lastS: 0,
      };
      try { this.best = +(localStorage.getItem(this._bestKey()) || NaN); } catch (e) { this.best = NaN; }
      if (isTest) {
        try {
          const saved = JSON.parse(localStorage.getItem(this._bestKey() + '_splits'));
          if (saved && saved.time === this.best && Array.isArray(saved.times)) this.race.bestSplits = saved.times;
        } catch (_) { /* 分段記錄可選。 */ }
      }
      // 線上的個人最佳 (別台電腦跑的) 比本機好就用線上的；熱浪夏威夷的分段時間只存在本機，對不上就不顯示分段差距
      if (RM.Platform) {
        const pb = RM.Platform.best(o.section, dir);
        if (pb > 0 && !(this.best <= pb)) { this.best = pb; if (this.race.bestSplits) this.race.bestSplits = null; }
      }
      const sStart = clamp(this.race.startS - dir * 14, 5, this.road.length - 5);
      // 預載 (載入中不跑物理：新車還沒 reset 到路上，從暫停/結算「重新開始」時 frame 迴圈仍在跑)
      this.state = 'loading';
      $('loading2').classList.remove('hidden');
      await this._preload(sStart, (p) => { $('loadbar2').style.width = Math.round(p * 75) + '%'; });
      this.car.reset(sStart, dir);
      this.car.sel = 3; this.car.gear = 1;
      if (mp && RM.Net.racing) RM.Net.onRaceLoad(this, sStart, dir);   // 移到自己的起跑格、建立其他玩家的車
      this.race.lastS = sStart;
      this.cam.snap();
      this._buildBanners();
      this.hud.setSection(sec.s0, sec.s1, dir);
      this.hud.msgs.length = 0;
      this.blink = { l: false, r: false, t: 0, on: false };
      this.parts = new Float32Array(400 * 12); this.partList = [];
      this.skid.clear();
      this.glowBuf = new Float32Array(2000 * 12);
      this.flash = 0;
      // 暖機 (車子同時在原地踩住煞車讓懸吊沉穩)
      await this._warmup((p) => { $('loadbar2').style.width = Math.round(75 + p * 25) + '%'; });
      $('loading2').classList.add('hidden');
      this.car.fuel = 38; this.car.trip = 0;
      this.race.fuel0 = this.car.fuel;
      this.cam.snap();
      this.hud.msgs.length = 0;
      this.hud.message(sec.name, 3.5, '#ffd34a', true);
      if (this.replay) this.hud.message(`重播 · ${this.replay.info.name || '玩家'}`, 3.5, '#fff');
      else this.hud.message(isTest ? '鬆開 ↑ 調整速度 · SHIFT 甩尾' : env.name + '　' + (dir > 0 ? '往宜蘭' : '往台北'), 3.5, '#fff');
      if (this.music.choice !== 'off' && this.music.cur) this.hud.message('♪ ' + this.music.cur.name, 3.5, '#9fe8ff');
      this.input.takeEdges(); // 載入期間按的鍵不算
      if (this._dr) { this._dr.down = 2; this._dr.ema = 16.7; }
      this.state = 'drive';
      this.last = performance.now();
      // 重播：開始播放；一般比賽：有重播的賽道開始錄這一趟 (js/game/replay.js)
      if (RM.Replay) RM.Replay.start(this);
      // 起跑程序：車子鎖在起跑格，倒數 3、2、1、START 才放行 (js/game/start.js)。個人賽馬上開始數
      if (RM.Start && !this.replay) RM.Start.arm(this, mp);
      // 多人：回報載入完成，等伺服器宣布倒數 (載入途中離開房間 / 斷線就回車庫)
      if (mp) { if (RM.Net.racing) RM.Net.onRaceReady(); else this.toMenu(); }
      if (RM.Online) RM.Online.onRaceStart(mp);
    },

    _bestKey() {
      const key = `rm_best_${this.opts.section}_${this.race.dir}`;
      const version = this.race.sec.recordVersion;
      // _r2：2026-11-25 改成 START 就開始計時，之前 (過起點線才算) 的本機最佳不再沿用
      return (version ? `${key}_v${version}` : key) + '_r2';
    },

    _buildBanners() {
      if (this.banners) { RM.GLU.deleteMesh(this.banners); this.banners = null; }
      if (this.testCourse) return;
      const mb = new RM.MeshBuilder(), road = this.road;
      const mk = (s, name, dir) => {
        const f = road.frameAt(s, {});
        const W = f.W + 1.0;
        const nx = -dir * f.tx, nz = -dir * f.tz; // 面向來車
        const rx = nz, rz = -nx;
        const y0 = f.y;
        const pole = RM.mat('#d8d8d8', 0.4, 0.7);
        for (const sg of [-1, 1]) mb.cyl([f.x + f.rx * sg * W, y0 - 0.5, f.z + f.rz * sg * W], [f.x + f.rx * sg * W, y0 + 6.2, f.z + f.rz * sg * W], 0.12, 0.12, 8, pole, true);
        const uv = this.atlas.uv(name);
        const P = (sx, y) => [f.x + rx * sx * W, y0 + y, f.z + rz * sx * W];
        mb.quad(P(-1, 4.9), P(1, 4.9), P(1, 6.0), P(-1, 6.0), RM.mat('#ffffff', 0.6, 0, 1), uv);
        mb.quad(P(1, 4.9), P(-1, 4.9), P(-1, 6.0), P(1, 6.0), RM.mat('#ffffff', 0.6, 0, 1), [uv[2], uv[1], uv[0], uv[3]]);
      };
      mk(this.race.startS, 'banStart', this.race.dir);
      mk(this.race.finishS, 'banFinish', this.race.dir);
      this.banners = mb.build();
    },

    limitAt(s) {
      if (this.testCourse) return null;
      if (s > 44930) return 40;
      if (s > INTERVAL.a && s < INTERVAL.b) return 40;
      if (this.road.zone[Math.floor(s / this.road.sp)]) return 40;
      return 50;
    },

    _ticket(reason, fine) {
      this.race.tickets.push({ reason, fine });
      this.hud.message(`📸 ${reason}　罰鍰 NT$${fine.toLocaleString()}`, 4, '#ff6060');
    },

    // ------------------------------------------------------------------ 主迴圈
    frame(now) {
      requestAnimationFrame((t) => this.frame(t));
      const raw = (now - this.last) / 1000;
      const dt = isFinite(raw) ? Math.min(0.05, Math.max(0.001, raw)) : 0.016;
      this.last = now;
      this._fps = this._fps ? this._fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05 : 60;
      if (this.state === 'warmup') { this._warmFrame(); return; }
      if (this.state !== 'drive' && this.state !== 'finished') {
        // 暫停：畫面靜止，畫布會保留最後一幀，不必每幀重畫 3D 場景 (省 GPU、不發熱)，只在視窗大小改變後補畫一次
        // 車庫閒置時緩慢水平旋轉；手動操作、對話框與減少動態效果會暫停自轉。
        if (this.state === 'menu' || this.state === 'boot') { this.menu.update(dt, now); this.menu.render(); }
        if (this.state === 'paused' && this._redraw) { this._redraw = false; this._render(0); }
        return;
      }
      this._dynResStep(raw);
      this.time = (this.time || 0) + dt;
      const car = this.car, race = this.race, road = this.road;
      // 看重播：不跑物理，車子照紀錄的軌跡走 (js/game/replay.js)
      if (this.replay) { this.replay.frame(this, dt); return; }
      // 事件鍵
      for (const k of this.input.takeEdges()) {
        if (k === 'Escape') {
          if (RM.Net && RM.Net.racing) { if (RM.Online) RM.Online.raceMenu(); continue; }
          this.pause(true); return;
        }
        if (this.state !== 'drive') continue;
        if (k === 'KeyK') this.showKeys = !this.showKeys;
        if (k === 'ControlLeft' || k === 'ControlRight') car.useNitro();
        if (k === 'KeyC') { this.cam.next(); this.hud.message(this.cam.label, 1.2); }
        if (k === 'KeyL') { this.headOn = !this.headOn; this.hud.message(this.headOn ? '大燈 開' : '大燈 關', 1.2); }
        if (k === 'KeyZ') { this.blink.l = !this.blink.l; this.blink.r = false; }
        if (k === 'KeyX') { this.blink.r = !this.blink.r; this.blink.l = false; }
        if (k === 'KeyV') { const h = !(this.blink.l && this.blink.r); this.blink.l = this.blink.r = h; }
        if ((k === 'KeyR' || k === 'Backspace') && !(RM.Start && RM.Start.on)) { this._resetCar(); }
        if (k === 'KeyT') { car.abs = !car.abs; this.hud.message('ABS ' + (car.abs ? '開' : '關'), 1.2); }
        if (k === 'KeyM') {
          const mute = !this.music.muted;
          this.music.setMuted(mute);
          this.audio.setVolume(mute ? 0 : +document.getElementById('volume').value);
          this.hud.message(mute ? '靜音' : '取消靜音', 1.2);
        }
      }
      this.cam.lookBack = this.input.down('KeyB');
      const inp = this._pedals(this.input.poll(dt), car);
      if (this.state === 'finished') { inp.throttle = 0; inp.brake = 0.6; }
      if (RM.Start) RM.Start.step(this, inp);   // 起跑倒數：START 之前鎖住車子；按得準就彈射起步
      car.obstacles = this._obstacles;
      car.update(dt, inp);
      if (car.msg) { this.hud.message(car.msg, 2.2, '#ffd34a'); car.msg = null; }
      for (const e of car.events) {
        if (e === 'upshift' || e === 'downshift' || e === 'selector') this.audio.shift();
        else if (e === 'nitro') { this.audio.whoosh(0.5, 1.4); this.hud.message('氮氣加速！', 1.2, '#7fd8ff', true); }
        else if (e === 'miniBoost') { this.audio.whoosh(0.25, 0.6); this.hud.message('甩尾加速！', 0.9, '#ffd34a'); }
        else if (e === 'nitroGet') this.hud.message(`獲得氮氣 ×${car.nitro}　按 Ctrl 使用`, 1.6, '#7fd8ff');
        else if (e && e.type === 'break') this._breakProp(e);
        else if (e && e.type) {
          this.audio.impact(e.v, e.type);
          this.cam.shake = Math.min(0.15, e.v * 0.01);
          const MSG = { rail: '撞上護欄！', car: '和汽車發生碰撞！', wall: '撞上山壁！', bike: '機車被撞飛了！', bus: '撞上大車，對方紋風不動！' };
          if (e.v > 3 && MSG[e.type]) {
            race.hits++;
            if (e.v > 6 || e.type === 'bike' || e.type === 'bus') this.hud.message(MSG[e.type], 1.8, '#ff8080');
          }
        }
      }
      car.events.length = 0;
      // 進度
      const projection = road.project(car.pos[0], car.pos[2], car.hint.i, {}, car.pos[1]);
      let s = projection.fi * road.sp, lat = projection.d;
      if (road.data.spiral && Math.abs(s - race.lastS) > 30) {
        // 落到另一層時送回原本的匝道，不能直接跳過分段。
        s = race.lastS;
        this._resetCar(s);
        lat = road.laneOut;
      }
      // 斷崖 (road.gaps)：沒飛過去、掉到橋面下方 5 m，就從對岸的落地區重新出發 (車速歸零就是代價)
      for (const gap of road.gaps) {
        if (s > gap.s0 - 6 && s < gap.s1 + 100 && car.pos[1] < projection.cy - 5) {
          s = gap.s1 + 14;
          this._resetCar(s, '掉下斷崖！從對岸重新出發');
          lat = road.laneOut;
          break;
        }
      }
      const dir = race.dir;
      const kmh = car.speed * 3.6;
      // 錄重播 (有重播的賽道)：要在計時與終點判定之前記下這一幀，抵達終點時才拿得到最後一段
      if (RM.Replay) RM.Replay.rec.frame(this, dt, s);
      // 車流需要的玩家資訊
      const f = road.frameAt(s, {});
      car.lat = lat; car.vAlong = car.vel[0] * f.tx + car.vel[2] * f.tz;
      this.traffic.update(dt, car, dir, s);
      if (RM.Net) RM.Net.update(dt, car, s);   // 多人：送出自己的狀態、更新其他玩家的車、碰撞
      if (this.state === 'drive') {
        // 計時從倒數 START 那一刻開始 (2026-11-25 起；以前是過起點線才算)。沒有起跑程序時才退回過線起算
        if (!race.started && (RM.Start ? RM.Start.goAt > 0 && !RM.Start.on : (s - race.startS) * dir > 0)) race.started = true;
        if (race.started && !race.finished) {
          race.t += dt;
          race.top = Math.max(race.top, kmh);
          for (const [i, cp] of race.checkpoints.entries()) {
            if (cp.done || (s - cp.s) * dir <= 0) continue;
            cp.done = true;
            cp.time = race.t;
            const previous = race.bestSplits && race.bestSplits[i];
            const diff = Number.isFinite(previous) ? cp.time - previous : null;
            const delta = diff === null ? '' : `　${diff > 0 ? '+' : ''}${diff.toFixed(2)} 秒`;
            this.hud.message(`${cp.name}　${RM.fmtTime(cp.time)}${delta}`, 2.5, diff < 0 ? '#7dffa0' : '#ffd34a');
          }
          // 區間測速
          const inI = s > INTERVAL.a && s < INTERVAL.b;
          if (inI && !race.interval) { race.interval = { t0: race.t, s0: s }; this.hud.message('進入區間測速路段（限速 40）', 2.5, '#9fd0ff'); }
          if (race.interval) {
            const dist = Math.abs(s - race.interval.s0), tt = race.t - race.interval.t0;
            race.interval.avg = tt > 1 ? (dist / tt) * 3.6 : kmh;
            race.interval.over = race.interval.avg > INTERVAL.limit;
            race.interval.limit = INTERVAL.limit;
            if (!inI) {
              const avg = race.interval.avg;
              if (avg > INTERVAL.limit + 1) {
                const over = avg - INTERVAL.limit;
                this._ticket(`區間測速 平均 ${avg.toFixed(0)} km/h`, over <= 20 ? 1600 : over <= 40 ? 2000 : over <= 60 ? 2800 : 6000);
              } else this.hud.message(`區間測速 平均 ${avg.toFixed(0)} km/h　未超速`, 2.5, '#7dffa0');
              race.interval = null;
            }
          }
          // 固定式測速照相
          for (const [cs, cd] of CAMERAS) {
            const camS = cs + cd * 150;
            const key = cs;
            if (cd === dir && !race.camDone[key] && (s - camS) * dir > 0 && (race.lastS - camS) * dir <= 0) {
              race.camDone[key] = true;
              const lim = this.limitAt(camS);
              if (kmh > lim + 10) { this.flash = 1; this._ticket(`測速照相 ${kmh.toFixed(0)} km/h（限速 ${lim}）`, kmh - lim <= 20 ? 1600 : kmh - lim <= 40 ? 2000 : 2800); }
            }
          }
          // 跨越雙黃線
          race.yellowCool = Math.max(0, race.yellowCool - dt);
          if (!this.testCourse && lat * dir < -0.35 && kmh > 15 && !(RM.Net && RM.Net.racing)) race.yellowT += dt; else race.yellowT = Math.max(0, race.yellowT - dt * 2);
          if (race.yellowT > 2.5 && race.yellowCool <= 0) { race.yellowCool = 12; race.yellowT = 0; this._ticket('跨越雙黃線', 600); }
          // 終點
          if ((s - race.finishS) * dir > 0) this._finish();
        }
      }
      race.lastS = s;
      if (this.ghost) this.ghost.frame(this, dt);   // 挑戰：幽靈車跟著碼錶走 (js/game/replay.js Ghost)
      // 方向燈
      const b = this.blink;
      if (b.l || b.r) {
        b.t += dt;
        const on = b.t % 0.75 < 0.4;
        if (on !== b.on) { b.on = on; this.audio.tick(on); }
      } else { b.on = false; b.t = 0; }
      // 相機、音效
      this.cam.update(dt, car);
      this.audio.update(car, dt, { inside: this.cam.inside, horn: inp.horn, wet: this.renderer.env.wet });
      this.skid.update(car, dt, this.renderer.env.wet);
      this._particles(dt);
      this._updateDebris(dt);
      this._stream();
      this._render(dt);
      this._drawHud(dt, s, f, kmh);
      if (RM.Online) RM.Online.frame(dt, s);
      if (this.ghost) this.ghost.ui(this, s);
      if (this.flash > 0) { this.flash -= dt * 3; $('flash').style.opacity = Math.max(0, this.flash).toFixed(2); }
    },

    _drawHud(dt, s, f, kmh) {
      const car = this.car, race = this.race, road = this.road, dir = race.dir, b = this.blink;
      const nm = road.nameAt(s);
      const elev = road.py[Math.min(road.N - 1, Math.round(s / road.sp))];
      const span = race.finishS - race.startS;
      this.hud.draw({
        car, dt, kmh, roadName: nm[1] === '北宜公路' ? '北宜公路' : nm[1], district: nm[2], km: road.kmAt(s), elev,
        grade: f.grade * dir, limit: this.limitAt(s), weather: this.renderer.env.name, camLabel: this.replay ? this.replay.camLabel() : this.cam.label,
        time: race.started ? race.t : 0, best: this.best, section: race.sec.name,
        progress: (s - race.startS) / span,
        checkpoints: race.checkpoints.map((c) => ({ p: (c.s - race.startS) / span, done: c.done })),
        interval: race.interval && race.interval.avg !== undefined ? race.interval : null,
        traffic: RM.Net && RM.Net.racing ? RM.Net.dots : this.traffic.list, s0: race.sec.s0, s1: race.sec.s1,
        blinkL: b.l, blinkR: b.r, blinkOn: b.on, headOn: this.headOn,
        hint: this.replay ? null : this._hint(car, race), fps: `${Math.round(this._fps)} fps` + ((this.dynRes || 1) < 1 ? ` · 解析度 ${Math.round(this.dynRes * 100)}%` : ''), showKeys: this.showKeys !== false && !this.replay, noNitro: !!this.replay && !this.replay.G,   // 舊格式的重播沒有記集氣條，就不畫
      });
    },

    // 起步前暖機 (在載入畫面後面跑)：完整繪製幾十幀，前段相機繞車一圈，讓四周景物、車流、HUD 都先畫過一次。
    // 著色器編譯、網格/貼圖上傳、字型點陣化、剩餘景物建置都在這時完成，起步就不會卡頓
    _warmup(prog) {
      return new Promise((resolve) => {
        this._warm = { n: 0, total: 50, prog, done: resolve };
        this.state = 'warmup';
        this.last = performance.now();
        if (!this.loopStarted) { this.loopStarted = true; requestAnimationFrame((t) => this.frame(t)); }
      });
    },
    _warmFrame() {
      const W = this._warm, car = this.car, road = this.road, dt = 1 / 60;
      W.n++;
      car.update(dt, { throttle: 0, brake: 1, steer: 0, analog: true, hand: true, horn: false, drift: false });
      car.events.length = 0; car.msg = null;
      const pr = road.project(car.pos[0], car.pos[2], car.hint.i, {}, car.pos[1]);
      const s = pr.fi * road.sp, f = road.frameAt(s, {});
      car.lat = pr.d; car.vAlong = 0;
      this.traffic.update(dt, car, this.race.dir, s);
      this.cam.update(dt, car);
      const orbit = Math.floor(W.total * 0.6);
      if (W.n <= orbit) {
        const a = (W.n / orbit) * Math.PI * 2, P = car.pos;
        this.cam.eye = [P[0] + Math.sin(a) * 9, P[1] + 3, P[2] + Math.cos(a) * 9];
        this.cam.target = [P[0], P[1] + 0.8, P[2]];
        this.cam.up = [0, 1, 0];
      } else if (W.n === orbit + 1) this.cam.snap();
      this._stream();
      this._render(dt);
      this._drawHud(dt, s, f, 0);
      W.prog(Math.min(1, W.n / W.total));
      const q = QUALITY[this.opts.quality];
      const pending = !this.testCourse && (this.terrain.pending() || this.scenery.chunks.some((c) => !c.built && c.dist < q.build));
      if (W.n >= W.total && (!pending || W.n > W.total + 600)) { this._warm = null; W.done(); }
    },

    // 簡易操作：↑ 前進、↓ 煞車 / 倒車；自排 D/R 自動切換
    _pedals(r, car) {
      if (r.throttle !== undefined) return r; // 已是油門/煞車格式 (測試用)
      const o = { throttle: 0, brake: r.brakeKey, steer: r.steer, analog: r.analog, hand: false, horn: r.horn, drift: r.drift };
      const v = car.vLong;
      if (r.fwd > 0.01 && r.fwd >= r.back) {
        if (car.sel === 1 && v < -0.6) o.brake = Math.max(o.brake, r.fwd);
        else { if (car.sel !== 3) car.setDrive('D'); o.throttle = r.fwd; }
      } else if (r.back > 0.01) {
        if (car.sel !== 1 && v > 0.6) o.brake = Math.max(o.brake, r.back);
        else { if (car.sel !== 1) car.setDrive('R'); o.throttle = r.back * 0.55; }
      }
      if (o.brake > 0.05) o.throttle = 0;
      return o;
    },

    _hint(car, race) {
      if (RM.Start && RM.Start.on) return RM.Start.tip();
      if (car.sel === 1 && car.vLong < -0.3) return '倒車中 — 按 ↑ 前進';
      if (car.speed < 1 && (!race.started || race.t < 4)) return '按 ↑ 出發';
      return null;
    },

    _resetCar(s, msg) {
      const road = this.road, car = this.car;
      if (!Number.isFinite(s)) {
        s = road.project(car.pos[0], car.pos[2], car.hint.i, {}, car.pos[1]).fi * road.sp;
        if (road.data.spiral && Math.abs(s - this.race.lastS) > 30) s = this.race.lastS;
      }
      car.reset(clamp(s, 5, road.length - 5), this.race.dir);
      car.sel = 3; car.gear = 1;
      this.cam.snap();
      if (RM.Replay) RM.Replay.rec.cut();   // 重播：瞬移不要內插過去
      this.hud.message(msg || '車輛已重置到路上', msg ? 2.4 : 1.5, msg ? '#ff8080' : '#fff');
    },

    // ---- 重播 (紀錄視窗點 ▶，js/ui/online.js watch)：換成那筆紀錄的賽道 / 方向 / 車款 / 車色 / 天氣載入，
    // 車子照重播的軌跡走 (js/game/replay.js)；離開後還原玩家自己的選項
    async startReplay(rp, info) {
      if (this.state !== 'menu' || this.replay || !RM.Replay || !SECTIONS[info.track]) return false;
      let player;
      try { player = new RM.Replay.Player(rp, info); } catch (e) { console.warn('重播無法解讀', e); return false; }
      const o = this.opts, COL = RM.CivicModel.COLORS;
      this._replaySaved = { section: o.section, dir: o.dir, env: o.env, car: o.car, color: o.color };
      o.section = info.track; o.dir = info.dir < 0 ? -1 : 1;
      if (RM.CarModels.PLAYER_CARS.some((c) => c.id === info.car)) o.car = info.car;
      o.color = clamp(rp.c | 0, 0, COL.length - 1);
      if (RM.ENV[rp.env]) o.env = rp.env;
      this.replay = player;
      await this.startRace();
      if (this.replay === player && this.state !== 'drive') { this.stopReplay(false); return false; }
      return true;
    },
    // ---- 挑戰 (紀錄視窗點「挑戰」，js/ui/online.js challenge)：換到那筆紀錄的賽道 / 方向，用自己的車、車色、天氣跑；
    // 那筆紀錄的重播變成半透明的幽靈車 (js/game/replay.js Ghost，不碰撞)，自己的成績照常送出。「再跑一次」繼續挑戰，回車庫就結束
    async startChallenge(rp, info) {
      if (this.state !== 'menu' || this.replay || !RM.Replay || !RM.Replay.Ghost || !SECTIONS[info.track]) return false;
      let ghost;
      try { ghost = new RM.Replay.Ghost(rp, info); } catch (e) { console.warn('重播無法解讀', e); return false; }
      const o = this.opts;
      o.section = info.track; o.dir = info.dir < 0 ? -1 : 1;
      if (this.menu.sync) this.menu.sync();
      this.ghost = ghost;
      await this.startRace();
      if (this.ghost === ghost && this.state !== 'drive') { ghost.close(); this.ghost = null; if (this.state === 'menu') this.toMenu(); return false; }
      return true;
    },
    stopReplay(reopen) {
      const R = this.replay;
      if (!R) return;
      this.replay = null;
      R.close();
      if (this._replaySaved) { Object.assign(this.opts, this._replaySaved); this._replaySaved = null; }
      this.toMenu();
      if (reopen && RM.Online) RM.Online.openBoard('rec', R.info.track, R.info.dir);
    },

    _finish() {
      const r = this.race;
      r.finished = true;
      this.state = 'finished';
      const dist = Math.abs(r.finishS - r.startS);
      const avg = (dist / r.t) * 3.6;
      const fuel = r.fuel0 - this.car.fuel;
      const fines = r.tickets.reduce((a, t) => a + t.fine, 0);
      let rec = false;
      if (!(this.best <= r.t)) { this.best = r.t; rec = true; try { localStorage.setItem(this._bestKey(), String(r.t)); } catch (e) { /* ignore */ } }
      if (rec && this.testCourse) {
        try { localStorage.setItem(this._bestKey() + '_splits', JSON.stringify({ time: r.t, times: r.checkpoints.map(cp => cp.time) })); } catch (_) { /* 分段記錄可選。 */ }
      }
      $('resTitle').textContent = r.sec.name + (this.testCourse ? '（單向下坡）' : r.dir > 0 ? '（往宜蘭）' : '（往台北）');
      // 挑戰：和那筆紀錄比勝負
      const gi = this.ghost && this.ghost.on ? this.ghost.info : null;
      let ghRow = '';
      if (gi && gi.t > 0) {
        const d = r.t - gi.t / 1000, who = String(gi.name || '玩家').replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
        ghRow = `<tr><td>挑戰</td><td>${who}（${RM.fmtTime(gi.t / 1000)}）　<b class="gh-res ${d < 0 ? 'ahead' : 'behind'}">${Math.abs(d) < 0.005 ? '平手' : (d < 0 ? '勝 ' : '敗 ') + Math.abs(d).toFixed(2) + ' 秒'}</b></td></tr>`;
      }
      $('resBody').innerHTML = `
        <div class="big">${RM.fmtTime(r.t)}${rec ? ' <span class="rec">新紀錄！</span>' : ''}</div>
        <table>
          ${ghRow}
          <tr><td>距離</td><td>${(dist / 1000).toFixed(2)} km</td></tr>
          <tr><td>平均時速</td><td>${avg.toFixed(1)} km/h</td></tr>
          <tr><td>最高時速</td><td>${r.top.toFixed(0)} km/h</td></tr>
          <tr><td>油耗</td><td>${fuel.toFixed(2)} L（${(dist / 1000 / Math.max(fuel, 0.01)).toFixed(1)} km/L）</td></tr>
          <tr><td>碰撞</td><td>${r.hits} 次</td></tr>
          ${this.testCourse ? r.checkpoints.map(cp => `<tr><td>${cp.name}</td><td>${RM.fmtTime(cp.time)}</td></tr>`).join('') : `<tr><td>罰單</td><td>${r.tickets.length ? r.tickets.map(t => `${t.reason}：NT$${t.fine.toLocaleString()}`).join('<br>') : '無，模範駕駛！'}</td></tr>`}
          ${fines ? `<tr><td>罰鍰合計</td><td class="fine">NT$${fines.toLocaleString()}</td></tr>` : ''}
        </table>`;
      setTimeout(() => $('results').classList.remove('hidden'), 1200);
      if (RM.Online) RM.Online.onFinish(r, rec);   // 送出成績：賽道前 15 名與積分 (熱浪夏威夷也一樣)
    },

    _particles(dt) {
      const car = this.car, env = this.renderer.env;
      const L = this.partList;
      const R = car.R;
      const up = [R[3], R[4], R[5]];
      for (const w of car.wheels) {
        if (!w.contact) continue;
        const cp = [w.wpos[0] - up[0] * 0.28, w.wpos[1] - up[1] * 0.28, w.wpos[2] - up[2] * 0.28];
        let rate = 0, type = 0;
        if (w.surf <= 1 && w.slipVel > 4.5 && w.Fz > 500) rate = (w.slipVel - 4.5) * 7;
        if (w.surf >= 2 && car.speed > 4) { rate = car.speed * 0.8; type = 1; }
        if (env.wet > 0.4 && car.speed > 12 && w.surf <= 1) { rate += car.speed * 0.25 * env.wet; }
        w._acc = (w._acc || 0) + rate * dt;
        while (w._acc > 1 && L.length < 400) {
          w._acc -= 1;
          L.push({ p: [cp[0] + (Math.random() - 0.5) * 0.3, cp[1] + 0.1, cp[2] + (Math.random() - 0.5) * 0.3], v: [car.vel[0] * 0.25 + (Math.random() - 0.5) * 1.5, 0.6 + Math.random(), car.vel[2] * 0.25 + (Math.random() - 0.5) * 1.5], age: 0, life: type ? 1.6 : 2.6, size: 0.4, type, rot: Math.random() * 6 });
        }
        if (w._acc > 1) w._acc = 1;
      }
      for (let i = L.length - 1; i >= 0; i--) {
        const p = L[i];
        p.age += dt;
        if (p.age > p.life) { L.splice(i, 1); continue; }
        const dmp = Math.exp(-dt * 1.5);
        for (let k = 0; k < 3; k++) { p.v[k] *= dmp; p.p[k] += p.v[k] * dt; }
        p.size += dt * (p.type ? 1.2 : 1.8);
      }
    },

    _stream() {
      if (this.testCourse) { this._obstacles = []; return; }
      const cam = this.cam, q = QUALITY[this.opts.quality];
      const cx = cam.eye[0], cz = cam.eye[2];
      this.terrain.update(cx, cz, 5, false);
      // 景物 chunk
      let best = null, bd = Infinity;
      for (const c of this.scenery.chunks) {
        const d = Math.hypot(c.cx - cx, c.cz - cz) - c.r;
        c.dist = d;
        if (!c.built && d < q.build && d < bd) { bd = d; best = c; }
        if (c.built && d > q.build + 1200) this.scenery.disposeChunk(c);
      }
      if (best) this.scenery.buildChunk(best);
      // 可撞斷的電線桿 / 路燈
      const ob = [], broken = this.scenery.broken;
      for (const c of this.scenery.chunks) if (c.built && Math.hypot(c.cx - this.car.pos[0], c.cz - this.car.pos[2]) - c.r < 60) for (const b of c.breakables || []) if (!broken.has(b.id)) ob.push(b);
      this._obstacles = ob;
    },

    // 撞斷電線桿 / 路燈：從場景移除，換成一根以底部為支點、往車子行進方向倒下的殘骸
    _breakProp(e) {
      const o = e.obj, car = this.car;
      if (this.scenery.broken.has(o.id)) return;
      this.scenery.breakItem(o.id);
      let dx = e.dir[0], dz = e.dir[1], l = Math.hypot(dx, dz);
      if (l < 1) { dx = o.x - car.pos[0]; dz = o.z - car.pos[2]; l = Math.hypot(dx, dz); }
      dx /= l || 1; dz /= l || 1;
      const v = e.v;
      // 倒地角度：桿頂落在地面 (路面或邊坡) 為止
      const L = o.H * 0.95;
      const g = this.road.ground(o.x + dx * L, o.z + dz * L, { i: car.hint.i });
      const maxAng = Math.acos(clamp((g.y + 0.15 - o.y) / L, -0.6, 0.95));
      const mesh = this.scenery.debrisMesh(o);
      if (mesh) {
        this.debris.push({ mesh, model: m4.c(), base: [o.x, o.y, o.z], pivot: [o.x, o.y, o.z], axis: [dz, 0, -dx], L: o.H,
          ang: 0.02, w: clamp(0.3 + v * 0.09, 0.4, 3.2), maxAng, slide: [dx * v * 0.3, dz * v * 0.3], done: false });
        while (this.debris.length > 30) RM.GLU.deleteMesh(this.debris.shift().mesh);
      }
      // 碎屑
      for (let i = 0; i < 16 && this.partList.length < 400; i++) {
        this.partList.push({ p: [o.x + (Math.random() - 0.5) * 0.5, o.y + 0.2 + Math.random() * 0.9, o.z + (Math.random() - 0.5) * 0.5],
          v: [dx * v * 0.35 + (Math.random() - 0.5) * 3, 0.8 + Math.random() * 2.5, dz * v * 0.35 + (Math.random() - 0.5) * 3], age: 0, life: 1.4, size: 0.35, type: 1, rot: Math.random() * 6 });
      }
      this.audio.impact(Math.min(14, 2 + v * 0.6), o.kind === 'lamp' ? 'lamp' : 'pole');
      this.cam.shake = Math.min(0.1, 0.02 + v * 0.003);
      this.race.hits++;
      this.hud.message(o.kind === 'lamp' ? '撞斷路燈！' : '撞斷電線桿！', 1.4, '#ffb070');
    },

    _updateDebris(dt) {
      const q = (this._dq = this._dq || [0, 0, 0, 1]), t = (this._dt3 = this._dt3 || [0, 0, 0]);
      for (let i = this.debris.length - 1; i >= 0; i--) {
        const d = this.debris[i];
        if (Math.hypot(d.pivot[0] - this.car.pos[0], d.pivot[2] - this.car.pos[2]) > 1500) { RM.GLU.deleteMesh(d.mesh); this.debris.splice(i, 1); continue; }
        if (!d.done) {
          // 細長桿繞底部倒下：α = 1.5 g / L · sinθ
          d.w += (14.7 / d.L) * Math.sin(Math.max(d.ang, 0.05)) * dt;
          d.ang += d.w * dt;
          if (d.ang >= d.maxAng) {
            d.ang = d.maxAng;
            if (d.w > 0.9) d.w = -d.w * 0.22; // 落地小彈一下
            else d.w = 0;
          }
          const k = Math.exp(-dt * 2.5);
          d.pivot[0] += d.slide[0] * dt; d.pivot[2] += d.slide[1] * dt;
          d.slide[0] *= k; d.slide[1] *= k;
          if (d.w === 0 && Math.hypot(d.slide[0], d.slide[1]) < 0.05) d.done = true;
        }
        // model = T(pivot) · R · T(-base)
        quat.axisAngle(q, d.axis, d.ang);
        quat.rot(t, q, d.base);
        m4.fromQP(d.model, q, [d.pivot[0] - t[0], d.pivot[1] - t[1], d.pivot[2] - t[2]]);
      }
    },

    _carDraw(list, glass, shadowDyn) {
      const car = this.car, cm = this.carModel;
      const M = (this._cm = this._cm || m4.c());
      m4.fromQP(M, car.q, car.pos);
      const off = (this._off = this._off || m4.c());
      // S.lower：改裝避震把車身 (連同重心) 降低的量。車身相對重心不動，所以要用原本的重心高度往下畫
      m4.ident(off); off[13] = -car.S.cgH - (car.S.lower || 0); off[14] = -car.S.cgZ;
      const body = (this._bodyM = this._bodyM || m4.c());
      m4.mul(body, M, off);
      const brake = car.brake > 0.05 ? 1 : 0;
      const rev = car.selName === 'R' ? 1 : 0;
      const head = this.headOn ? 1 : 0;
      const b = this.blink;
      const lights = [head, brake, b.l && b.on ? 1 : 0, b.r && b.on ? 1 : 0];
      const lights2 = [rev, head, 0, 0];
      this._carShell = null;
      const A = this.carAsset;
      if (A) {
        // three.js 載入的模型
        const inside = (this.cam.name === 'cockpit' || this.cam.name === 'hood') && !A.cfg.interior;
        if (!inside) {
          for (const pt of A.parts) { list.push({ mesh: pt.mesh, tex: pt.tex, model: body, paint: this.paint, lights, lights2, shadowBias: 0.12 }); shadowDyn.push({ mesh: pt.mesh, model: body }); }
          for (const pt of A.glass) glass.push({ mesh: pt.mesh, tex: pt.tex, model: body, lights, lights2 });
        }
        this._wm = this._wm || [m4.c(), m4.c(), m4.c(), m4.c()];
        const rot = (this._rm = this._rm || m4.c());
        for (let k = 0; k < 4; k++) {
          const w = car.wheels[k], aw = A.wheels[k];
          if (!aw) continue;
          const qy = quat.axisAngle([0, 0, 0, 1], [0, 1, 0], -w.steer), qx = quat.axisAngle([0, 0, 0, 1], [1, 0, 0], -w.angle);
          m4.fromQP(rot, quat.mul([0, 0, 0, 1], qy, qx), [w.anchor[0], w.anchor[1] - w.len, w.anchor[2]]);
          m4.mul(this._wm[k], M, rot);
          for (const pt of aw.parts) { list.push({ mesh: pt.mesh, tex: pt.tex, model: this._wm[k], paint: this.paint, shadowBias: 0.08 }); shadowDyn.push({ mesh: pt.mesh, model: this._wm[k] }); }
        }
        return;
      }
      // 程序化 K8：車身相對輪子降低 (低趴)；車殼走專屬著色器 (貼圖投影 + 烤漆)，其餘零件走一般流程
      off[13] -= cm.DROP;
      m4.mul(body, M, off);
      const pm = RM.CivicModel.COLORS[this.opts.color][2];   // 車色的金屬感 (車殼與車色零件共用)
      list.push({ mesh: cm.body, model: body, paint: this.paint, paintMetal: pm, lights, lights2, dirt: 0.2, shadowBias: 0.12 });
      list.push({ mesh: cm.decal, tex: cm.decalTex, model: body, paint: this.paint, paintMetal: pm, lights, lights2, shadowBias: 0.12, depthBias: 220 });
      if (cm.glass) glass.push({ mesh: cm.glass, model: body, lights, lights2, depthBias: 260 });
      // 陰影用低模、車窗用只含玻璃三角形的網格 (proc_car.js shellExtras)
      shadowDyn.push({ mesh: cm.shellShadow || cm.shell, model: body });
      // 改裝的外觀 (js/car/tuning_vis.js)：輪子 / 卡鉗換成新的網格、多一組排氣尾管、彩繪貼圖、外傾角
      const V = this.tuneVis && this.tuneVis.model === cm ? this.tuneVis : null;
      this._carShell = { mesh: cm.shell, glassMesh: cm.shellGlass || cm.shell, tex: cm.tex, map: cm.mapU, model: body, paint: this.paint, paintMetal: pm, lights, lights2, dirt: 0.2, livery: V && V.livery ? V.livery.tex : null };
      if (V && V.exhaust) list.push({ mesh: V.exhaust, model: M, shadowBias: 0.12 });
      // 輪子
      this._wm = this._wm || [m4.c(), m4.c(), m4.c(), m4.c()];
      const rot = (this._rm = this._rm || m4.c());
      const camber = ((car.S.camber || 0) * Math.PI) / 180, qc = quat.axisAngle([0, 0, 0, 1], [0, 0, 1], camber);   // 上緣往內倒 (左輪的 yaw 多轉半圈，同一個角度兩邊都往內)
      const wheelMesh = (V && V.wheel) || cm.wheel, calMesh = (V && V.caliper) || cm.caliper;
      const wtex = RM.WheelBuilder ? RM.WheelBuilder.texture() : null;   // 胎壁字樣、中心蓋徽章、卡鉗字樣 (js/car/wheel_builder.js)
      for (let k = 0; k < 4; k++) {
        const w = car.wheels[k];
        const yaw = -w.steer + (w.left ? Math.PI : 0);
        const spin = w.left ? w.angle : -w.angle;
        const qy = quat.axisAngle([0, 0, 0, 1], [0, 1, 0], yaw), qx = quat.axisAngle([0, 0, 0, 1], [1, 0, 0], spin);
        const qyc = camber ? quat.mul([0, 0, 0, 1], qy, qc) : qy;
        const qq = quat.mul([0, 0, 0, 1], qyc, qx);
        m4.fromQP(rot, qq, [w.anchor[0], w.anchor[1] - w.len, w.anchor[2]]);
        m4.mul(this._wm[k], M, rot);
        list.push({ mesh: wheelMesh, tex: wtex, model: this._wm[k], paint: this.paint, shadowBias: 0.08 });
        shadowDyn.push({ mesh: cm.wheelShadow || cm.wheel, model: this._wm[k] });
        if (calMesh) {
          // 卡鉗只跟著轉向、不跟著輪子轉：前輪夾在碟盤後側、後輪夾在前側
          this._km = this._km || [m4.c(), m4.c(), m4.c(), m4.c()];
          const qk = quat.axisAngle([0, 0, 0, 1], [1, 0, 0], (w.left ? -1.2 : 1.2) * (w.front ? 1 : -1));
          m4.fromQP(rot, quat.mul([0, 0, 0, 1], qyc, qk), [w.anchor[0], w.anchor[1] - w.len, w.anchor[2]]);
          m4.mul(this._km[k], M, rot);
          list.push({ mesh: calMesh, tex: wtex, model: this._km[k], shadowBias: 0.08 });
        }
      }
      // 方向盤
      const sm = (this._sm = this._sm || m4.c());
      const qa = quat.axisAngle([0, 0, 0, 1], [1, 0, 0], -0.42), qb = quat.axisAngle([0, 0, 0, 1], [0, 0, 1], -car.steer * 15.7);
      const sp = cm.steerPos;
      m4.fromQP(rot, quat.mul([0, 0, 0, 1], qa, qb), [sp[0], sp[1] - cm.DROP - car.S.cgH, sp[2] - car.S.cgZ]);
      m4.mul(sm, M, rot);
      list.push({ mesh: cm.steer, model: sm, shadowBias: 0.12 });
    },

    _render(dt) {
      if (!this.renderer || !this.car) return;
      const r = this.renderer, gl = this.gl, q = QUALITY[this.opts.quality];
      const car = this.car, cam = this.cam;
      const R = car.R;
      const fwd = [-R[6], -R[7], -R[8]], up = [R[3], R[4], R[5]], right = [R[0], R[1], R[2]];
      const LF = car.S.lampF;
      const lamp = (x) => [car.pos[0] + right[0] * x + up[0] * LF[1] - fwd[0] * LF[2], car.pos[1] + right[1] * x + up[1] * LF[1] - fwd[1] * LF[2], car.pos[2] + right[2] * x + up[2] * LF[1] - fwd[2] * LF[2]];
      const hd = [fwd[0], fwd[1] - 0.045, fwd[2]];
      v3.norm(hd, hd);
      const head = { on: this.headOn, l: lamp(-LF[0]), r: lamp(LF[0]), dir: hd, int: 1400 };
      r.shadowOn = q.shadow;
      // 尾燈/煞車燈照在路面與車身上的紅光、車底接觸陰影
      const LRx = car.S.lampR, bk = [R[6], R[7], R[8]], fl = Math.hypot(fwd[0], fwd[2]) || 1;
      const tailP = (x) => [car.pos[0] + right[0] * x + up[0] * LRx[1] + bk[0] * (LRx[2] + 0.04), car.pos[1] + right[1] * x + up[1] * LRx[1] + bk[1] * (LRx[2] + 0.04), car.pos[2] + right[2] * x + up[2] * LRx[1] + bk[2] * (LRx[2] + 0.04)];
      const cz = -(car.S.cgZ || 0);
      const extra = {
        tailL: tailP(-LRx[0]), tailR: tailP(LRx[0]),
        tailInt: (car.brake > 0.05 ? 0.16 : this.headOn ? 0.03 : 0) * (0.3 + 0.7 * r.env.night),
        carP: [car.pos[0] + bk[0] * cz, car.pos[1] - car.S.cgH, car.pos[2] + bk[2] * cz], carF: [fwd[0] / fl, fwd[2] / fl],
        carHalf: car.S.box ? [car.S.box.hw - 0.08, (car.S.box.front + car.S.box.rear) / 2 - 0.1] : null,
        shadowShift: q.sh ? q.sh[2] : 0,
      };
      r.begin(cam, gl.drawingBufferWidth, gl.drawingBufferHeight, this.time || 0, car.pos, head, extra);
      if (!q.shadow) r.shadowOn = false;
      const f = this._frame || (this._frame = { terrain: [], road: [], props: [], decals: [], inst: [], dynamic: [], glass: [], shadowProps: [], shadowInst: [] });
      f.road.length = f.props.length = f.decals.length = f.inst.length = f.dynamic.length = f.glass.length = f.shadowProps.length = f.shadowInst.length = 0;
      f.water = this.testCourse ? this.testCourse.water || null : null;   // 虛構賽道有自己的海 (drift_theme.js)
      f.noWater = !!this.testCourse && !f.water;
      if (this.testCourse) {
        f.terrain.length = 0;
        f.road.push(this.testCourse.roadMesh);
        // 景物分成 256 m 的方格：只畫視野內的塊，陰影貼圖也只畫會投影進陰影範圍的塊
        for (const m of this.testCourse.tiles || [this.testCourse.stage]) {
          const b = m.bounds;
          if (RM.aabbVisible(r.planes, b[0], b[1], b[2], b[3], b[4], b[5])) f.props.push(m);
          if (r.shadowOn && r.shadowSees(b)) f.shadowProps.push(m);
        }
      } else this.terrain.collect(r.planes, f.terrain);
      const ex = cam.eye[0], ey = cam.eye[1], ez = cam.eye[2];
      const pl = r.planes;
      // 近景樹：每幀從附近 chunk 挑出相機 lod[1] 公尺內的樹，放進動態 instance buffer，只有這幾百棵跑完整模型。
      // (chunk 很大，若整塊用完整模型畫，數千棵遠處的樹也得跑完整模型的頂點著色器，不受解析度影響、很吃內顯)
      const near = (this._nearSet = this._nearSet || {});
      for (const k in near) near[k].n = 0;
      const L1 = q.lod[1], L1sq = L1 * L1;
      // 同時記下每棵樹的距離分段 (bk)，上傳前依距離由近到遠排好：近的樹先畫，後面被擋住的樹在像素著色器前就被深度測試剔除
      const NB = 24;
      const shOn = r.shadowOn, carX = car.pos[0], carZ = car.pos[2];
      const shNear = (this._shNear = this._shNear || {});
      for (const k in shNear) shNear[k].n = 0;
      const gatherNear = (c) => {
        for (const v of c.inst) {
          if (!v.lod || !v.data) continue;
          const A = v.data;
          let ns = near[v.vkey];
          for (let o = 0; o < A.length; o += 12) {
            const dx = A[o] - ex, dy = A[o + 1] - ey, dz = A[o + 2] - ez;
            const dd = dx * dx + dy * dy + dz * dz;
            if (dd >= L1sq) continue;
            if (!ns) ns = near[v.vkey] = { n: 0, buf: new Float32Array(12 * 512), bk: new Uint8Array(512), out: new Float32Array(12 * 512), view: null, kind: v.kind };
            if ((ns.n + 1) * 12 > ns.buf.length) {
              const nb = new Float32Array(ns.buf.length * 2); nb.set(ns.buf); ns.buf = nb;
              const nk = new Uint8Array(ns.bk.length * 2); nk.set(ns.bk); ns.bk = nk;
              ns.out = new Float32Array(nb.length);
            }
            const q0 = ns.n * 12;
            for (let k = 0; k < 12; k++) ns.buf[q0 + k] = A[o + k];
            ns.bk[ns.n] = Math.min(NB - 1, (Math.sqrt(dd) * NB / L1) | 0);
            ns.n++;
            // 離車 35 m 內：以完整模型投影到陰影貼圖 (另外收一份，陰影那道就不必處理全部的近景樹)
            if (shOn) {
              const cx2 = A[o] - carX, cz2 = A[o + 2] - carZ;
              if (cx2 * cx2 + cz2 * cz2 < 36 * 36) {
                let sn = shNear[v.vkey];
                if (!sn) sn = shNear[v.vkey] = { n: 0, buf: new Float32Array(12 * 64), view: null, kind: v.kind };
                if ((sn.n + 1) * 12 > sn.buf.length) { const nb = new Float32Array(sn.buf.length * 2); nb.set(sn.buf); sn.buf = nb; }
                const q1 = sn.n * 12;
                for (let k = 0; k < 12; k++) sn.buf[q1 + k] = A[o + k];
                sn.n++;
              }
            }
          }
        }
      };
      // 投影到陰影貼圖的樹：只挑落在陰影範圍 (光源空間的方框，外加樹高/樹冠的餘裕) 內的，
      // 不必把附近幾個 chunk 的上千棵樹全部送進陰影貼圖
      const shSet = (this._shSet = this._shSet || {});
      for (const k in shSet) shSet[k].n = 0;
      const SR = r.shR, SU = r.shU, SC = r.shC, SM = (r.shRad || 70) + 14;
      const gatherShadow = (c) => {
        for (const v of c.inst) {
          if (v.kind === 'grass' || v.kind === 'paper') continue;
          if (!v.lod || !v.data || !SR) { v.shMode = 0; f.shadowInst.push(v); continue; }
          const A = v.data;
          let ss = shSet[v.vkey];
          for (let o = 0; o < A.length; o += 12) {
            const dx = A[o] - SC[0], dy = A[o + 1] - SC[1], dz = A[o + 2] - SC[2];
            const a = dx * SR[0] + dy * SR[1] + dz * SR[2];
            if (a > SM || a < -SM) continue;
            const b = dx * SU[0] + dy * SU[1] + dz * SU[2];
            if (b > SM || b < -SM) continue;
            if (!ss) ss = shSet[v.vkey] = { n: 0, buf: new Float32Array(12 * 256), view: null, kind: v.kind };
            if ((ss.n + 1) * 12 > ss.buf.length) { const nb = new Float32Array(ss.buf.length * 2); nb.set(ss.buf); ss.buf = nb; }
            const q0 = ss.n * 12;
            for (let k = 0; k < 12; k++) ss.buf[q0 + k] = A[o + k];
            ss.n++;
          }
        }
      };
      const farViews = (this._farViews = this._farViews || []);
      farViews.length = 0;
      const chunks = this.testCourse ? [] : this.scenery.chunks;
      for (const c of chunks) {
        if (!c.built) continue;
        const d = Math.hypot(c.cx - ex, c.cz - ez) - c.r;
        if (d > 2600) continue;
        const vis = RM.sphereVisible(pl, c.cx, c.cy, c.cz, c.r + 60);
        // 畫面外的近景樹也收 (要投影到畫面內)
        if (d <= L1) gatherNear(c);
        if (shOn && Math.hypot(c.cx - SC[0], c.cz - SC[2]) - c.r < SM * 1.42) {
          if (c.props) f.shadowProps.push(c.props);
          if (c.breakMesh) f.shadowProps.push(c.breakMesh);
          // 樹影：離車 35 m 內由近景樹 (完整模型) 投影，以外用簡化模型 (著色器依每棵樹與車的距離切換)
          if (r.shadowOn) gatherShadow(c);
        }
        if (!vis) continue;
        if (c.roadMesh) f.road.push(c.roadMesh);
        if (c.props && d < q.props) f.props.push(c.props);
        if (c.breakMesh && d < q.props) f.props.push(c.breakMesh);
        if (c.decals && d < 350) f.decals.push(c.decals);
        // 植生：遠景簡化模型 (相機 lod[1] 內的樹由上面的近景樹畫完整模型，交界區兩者依距離交叉淡入)
        for (const v of c.inst) {
          const lim = v.kind === 'grass' ? 160 : v.kind === 'paper' ? 120 : v.kind === 'tea' ? 450 : q.tree;
          if (d >= lim) continue;
          if (!v.lod) { v.lodMode = 0; v._d = d; farViews.push(v); }
          else { v.lod.lodMode = d > L1 ? 3 : 2; v.lod._d = d; farViews.push(v.lod); }
        }
      }
      // 近景樹上傳 + 先畫 (離相機近、遮擋多，先畫可讓後面被擋住的像素提早剔除)
      for (const k in near) {
        const ns = near[k];
        if (!ns.n) continue;
        if (!ns.view) {
          const [kind, vi] = k.split(':');
          let geom = this.trees[kind];
          if (Array.isArray(geom)) geom = geom[+vi || 0];
          ns.view = RM.GLU.instancedView(geom, ns.buf.subarray(0, 12), 1);
          ns.view.kind = ns.kind;
        }
        // 依距離分段做計數排序 (由近到遠)
        const cnt = (this._bkCnt = this._bkCnt || new Int32Array(NB + 1));
        cnt.fill(0);
        for (let i = 0; i < ns.n; i++) cnt[ns.bk[i] + 1]++;
        for (let b = 0; b < NB; b++) cnt[b + 1] += cnt[b];
        for (let i = 0; i < ns.n; i++) {
          const dst = cnt[ns.bk[i]]++ * 12, src = i * 12;
          for (let k2 = 0; k2 < 12; k2++) ns.out[dst + k2] = ns.buf[src + k2];
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, ns.view.instBuf);
        gl.bufferData(gl.ARRAY_BUFFER, ns.out.subarray(0, ns.n * 12), gl.DYNAMIC_DRAW);
        ns.view.instCount = ns.n; ns.view.lodMode = 1; ns.view.shMode = 1;
        f.inst.push(ns.view);
      }
      // 陰影用的近景樹 (完整模型，離車 35 m 內)
      for (const k in shNear) {
        const sn = shNear[k];
        if (!sn.n) continue;
        if (!sn.view) {
          const [kind, vi] = k.split(':');
          let geom = this.trees[kind];
          if (Array.isArray(geom)) geom = geom[+vi || 0];
          sn.view = RM.GLU.instancedView(geom, sn.buf.subarray(0, 12), 1);
          sn.view.kind = sn.kind;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, sn.view.instBuf);
        gl.bufferData(gl.ARRAY_BUFFER, sn.buf.subarray(0, sn.n * 12), gl.DYNAMIC_DRAW);
        sn.view.instCount = sn.n; sn.view.shMode = 1;
        f.shadowInst.push(sn.view);
      }
      // 遠景植生：依 chunk 距離由近到遠
      farViews.sort((a, b) => a._d - b._d);
      for (const v of farViews) f.inst.push(v);
      // 陰影用的樹 (簡化模型；離車 35 m 內的由上面的近景完整模型投影)
      for (const k in shSet) {
        const ss = shSet[k];
        if (!ss.n) continue;
        if (!ss.view) {
          const [kind, vi] = k.split(':');
          let geom = this.trees.lod && this.trees.lod[kind];
          if (Array.isArray(geom)) geom = geom[+vi || 0];
          if (!geom) continue;
          ss.view = RM.GLU.instancedView(geom, ss.buf.subarray(0, 12), 1);
          ss.view.kind = ss.kind;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, ss.view.instBuf);
        gl.bufferData(gl.ARRAY_BUFFER, ss.buf.subarray(0, ss.n * 12), gl.DYNAMIC_DRAW);
        ss.view.instCount = ss.n; ss.view.shMode = 2;
        f.shadowInst.push(ss.view);
      }
      if (this.banners) f.props.push(this.banners);
      f.far = this.testCourse ? null : this.scenery.far;
      const shadowDyn = (this._sd = this._sd || []);
      shadowDyn.length = 0;
      this._carDraw(f.dynamic, f.glass, shadowDyn);
      f.car = this._carShell;
      f.cars = RM.Net ? RM.Net.draw(this, f, shadowDyn) : null;   // 多人：其他玩家的車
      f.ghost = this.ghost ? this.ghost.draw(this) : null;         // 挑戰：半透明的幽靈車 (沒有影子、不碰撞)
      f.skid = this.skid.mesh;
      // 車流
      this._trafM = this._trafM || [];
      let ti = 0;
      for (const a of this.traffic.list) {
        const dd = Math.hypot(a.pos[0] - ex, a.pos[2] - ez);
        if (dd > 1500) continue;
        if (!RM.sphereVisible(pl, a.pos[0], a.pos[1] + 1, a.pos[2], a.T.len)) continue;
        const M = this._trafM[ti] || (this._trafM[ti] = m4.c()); ti++;
        const mdl = this.traffic.models[a.type];
        const pushCar = (Lt, L2t) => {
          if (mdl && mdl.parts) {
            for (const pt of mdl.parts) { f.dynamic.push({ mesh: pt.mesh, tex: pt.tex, model: M, paint: a.color, lights: Lt, lights2: L2t }); if (dd < 90) shadowDyn.push({ mesh: pt.mesh, model: M }); }
            for (const pt of mdl.glass) f.glass.push({ mesh: pt.mesh, tex: pt.tex, model: M, lights: Lt, lights2: L2t });
          } else {
            f.dynamic.push({ mesh: mdl, model: M, paint: a.color, lights: Lt, lights2: L2t });
            if (dd < 90) shadowDyn.push({ mesh: mdl, model: M });
          }
        };
        if (a.free) {
          m4.fromQP(M, a.q, a.pos);
          pushCar([0, 1, 0, 0], [0, 1, 0, 0]);
          continue;
        }
        const qy = quat.axisAngle([0, 0, 0, 1], [0, 1, 0], a.yaw);
        const qp = quat.axisAngle([0, 0, 0, 1], [1, 0, 0], a.pitch);
        const qr = quat.axisAngle([0, 0, 0, 1], [0, 0, 1], -(a.lean || 0) + a.roll * 0);
        m4.fromQP(M, quat.mul([0, 0, 0, 1], quat.mul([0, 0, 0, 1], qy, qp), qr), a.pos);
        const L = [this.renderer.env.night > 0.2 || this.renderer.env.head ? 1 : 0, a.brake, 0, 0];
        pushCar(L, [0, L[0], 0, 0]);
      }
      // 撞斷倒下的電線桿 / 路燈
      for (const d of this.debris || []) {
        const dd = Math.hypot(d.pivot[0] - ex, d.pivot[2] - ez);
        if (dd > 1200 || !RM.sphereVisible(pl, d.pivot[0], d.pivot[1] + 3, d.pivot[2], 11)) continue;
        f.dynamic.push({ mesh: d.mesh, model: d.model });
        if (dd < 90) shadowDyn.push({ mesh: d.mesh, model: d.model });
      }
      f.shadowDynamic = shadowDyn;
      // 光暈
      const night = this.renderer.env.night;
      const gb = this.glowBuf;
      let gc = 0;
      const pushG = (x, y, z, s, cr, cg, cb, it) => {
        if (gc >= 2000) return;
        const o = gc * 12;
        gb[o] = x; gb[o + 1] = y; gb[o + 2] = z; gb[o + 3] = s; gb[o + 4] = cr; gb[o + 5] = cg; gb[o + 6] = cb; gb[o + 7] = it; gb[o + 8] = gb[o + 9] = gb[o + 10] = gb[o + 11] = 0;
        gc++;
      };
      if (night > 0.05) {
        for (const c of chunks) {
          if (!c.built || !c.glows || c.dist > 1500) continue;
          for (const G of [c.glows, c.breakGlows || []]) {
            for (let k = 0; k < G.length; k += 8) pushG(G[k], G[k + 1], G[k + 2], G[k + 3], G[k + 4], G[k + 5], G[k + 6], G[k + 7] * night);
          }
        }
        const tg = [];
        this.traffic.glows(tg, night);
        for (let k = 0; k < tg.length; k += 8) pushG(tg[k], tg[k + 1], tg[k + 2], tg[k + 3], tg[k + 4], tg[k + 5], tg[k + 6], tg[k + 7]);
        if (RM.Net) RM.Net.glows(pushG, night);
      }
      // 玩家車燈光暈
      const back = [R[6], R[7], R[8]];
      const P = (x, y, z) => [car.pos[0] + right[0] * x + up[0] * y + back[0] * z, car.pos[1] + right[1] * x + up[1] * y + back[1] * z, car.pos[2] + right[2] * x + up[2] * y + back[2] * z];
      if (this.cam.name !== 'cockpit' && this.cam.name !== 'hood' && this.cam.name !== 'bumper') {
        const LR = car.S.lampR;
        if (this.headOn && night > 0.2) for (const x of [-LF[0], LF[0]]) { const p = P(x, LF[1], LF[2] - 0.04); pushG(p[0], p[1], p[2], 0.55, 1, 0.92, 0.75, 0.7 * night); }
        // 只在夜間/黃昏加光暈 (白天由車燈本身的自發光呈現，避免與車身交錯閃爍)
        const brk = car.brake > 0.05;
        if (night > 0.2) {
          if (this.headOn || brk) for (const x of [-LR[0], LR[0]]) {
            const p = P(x, LR[1], LR[2] + 0.06), sg = Math.sign(x) * 0.45;
            // 只有看得到燈面時才有光暈 (避免另一側的光暈從車身後方露出來)
            const tc = v3.norm([0, 0, 0], [cam.eye[0] - p[0], cam.eye[1] - p[1], cam.eye[2] - p[2]]);
            const ln = v3.norm([0, 0, 0], [back[0] + right[0] * sg, back[1] + right[1] * sg, back[2] + right[2] * sg]);
            const face = RM.smoothstep(0.05, 0.55, v3.dot(tc, ln));
            pushG(p[0], p[1], p[2], brk ? 0.4 : 0.25, 1, 0.05, 0.02, (brk ? 0.62 : 0.15) * night * face);
          }
          const b = this.blink;
          if (b.on) for (const [x, on] of [[-LR[0] * 1.15, b.l], [LR[0] * 1.15, b.r]]) if (on) { const p = P(x, LR[1] - 0.07, LR[2] + 0.06); pushG(p[0], p[1], p[2], 0.5, 1, 0.5, 0.05, 1.2 * night); }
        }
      }
      // 氮氣火焰：每一支排氣尾管都噴 (S.exhausts = 多支尾管的車款；單出的只有 S.exhaust)，多人連線其他玩家的車也畫
      const flames = (S, Pt) => {
        const list = S.exhausts || [S.exhaust];
        for (const EX of list) {
          // 尾管靠得很近 (R35 一側兩支) 時火焰小一點，光暈疊起來才不會變成一大團
          let near = 0;
          for (const o of list) if (Math.abs(o[0] - EX[0]) < 0.35) near++;
          const k = near > 1 ? 0.72 : 1, fl = 0.6 + Math.random() * 0.4;
          const p = Pt(EX[0], EX[1], EX[2]);
          pushG(p[0], p[1], p[2], (0.55 * fl + 0.25) * k, 0.3, 0.6, 1.0, 2.2 * fl * k);
          const p2 = Pt(EX[0], EX[1], EX[2] + 0.28);
          pushG(p2[0], p2[1], p2[2], 0.4 * fl * k, 0.5, 0.75, 1.0, 1.2 * fl * k);
        }
      };
      if (car.nitroT > 0 && this.cam.name !== 'cockpit') flames(car.S, P);
      if (RM.Net && RM.Net.racing) for (const c of RM.Net.cars) {
        const v = c.veh, M = v && v.R;
        if (c.gone || !c.visible || !M || !(v.nitroT > 0) || !v.S) continue;
        flames(v.S, (x, y, z) => [v.pos[0] + M[0] * x + M[3] * y + M[6] * z, v.pos[1] + M[1] * x + M[4] * y + M[7] * z, v.pos[2] + M[2] * x + M[5] * y + M[8] * z]);
      }
      if (this.ghost && this.ghost.flaming()) {
        const v = this.ghost.veh, M = v.R;
        flames(v.S, (x, y, z) => [v.pos[0] + M[0] * x + M[3] * y + M[6] * z, v.pos[1] + M[1] * x + M[4] * y + M[7] * z, v.pos[2] + M[2] * x + M[5] * y + M[8] * z]);
      }
      f.glowData = gb; f.glowCount = gc;
      // 粒子
      const pd = this.parts;
      let pc = 0;
      if (this.partList) for (const p of this.partList) {
        const o = pc * 12;
        const a = (1 - p.age / p.life) * (p.type ? 0.35 : 0.28);
        pd[o] = p.p[0]; pd[o + 1] = p.p[1]; pd[o + 2] = p.p[2]; pd[o + 3] = p.size;
        pd[o + 4] = a; pd[o + 5] = 0.9; pd[o + 6] = p.rot; pd[o + 7] = p.type;
        pd[o + 8] = pd[o + 9] = pd[o + 10] = pd[o + 11] = 0;
        pc++;
      }
      f.partData = pd; f.partCount = pc;
      f.wind = this.renderer.envKey === 'rain' ? 2.2 : 1;
      f.lodRange = q.lod;
      f.shLod = [car.pos[0], car.pos[1], car.pos[2], 35];
      r.draw(f);
    },
  };

  window.RM.Game = G;
  window.addEventListener('load', () => G.boot().catch(e => {
    console.error(e);
    $('loadtext').textContent = e.message;
    $('previewStatus').textContent = '無法啟動 3D，請確認瀏覽器支援 WebGL2';
  }));
})();
