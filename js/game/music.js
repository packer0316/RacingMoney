'use strict';
// 背景音樂：用 HTMLAudioElement 播放 audio/*.mp3
// （直接開 index.html 走 file:// 時，WebAudio 的 MediaElementSource 會因跨來源而靜音，所以不接進 CarAudio）
(function () {
  const RM = window.RM;

  const TRACKS = [
    // Display names and artists are fictional; stable IDs preserve saved selections.
    { id: 'bgm1', name: 'Midnight Run', artist: 'Evan Vale', src: 'audio/bgm1.mp3' },
    { id: 'bgm2', name: 'Chasing Neon', artist: 'Lila Cross', src: 'audio/bgm2.mp3' },
    { id: 'bgm3', name: '三點的風', artist: '林予川', src: 'audio/bgm3.mp3' },
  ];
  const KEY = 'rm_music';

  class Music {
    constructor() {
      this.el = new Audio();
      this.el.preload = 'auto';
      this.choice = 'shuffle'; // 'off' | 曲目 id | 'shuffle' (預設隨機輪播：每次開遊戲聽到的第一首不一樣)
      this.picked = false;     // 玩家是否自己選過 (區分「刻意選第一首」和「舊版的預設值」)
      this.vol = 0.5;
      this.muted = false;
      this.playing = false; // 是否「應該」在播放（遊戲暫停時為 false）
      this.cur = null;      // 目前載入的曲目
      this.onTrack = null;  // 換曲開始播放時通知 (track)
      this.onChange = null; // 曲目選擇 / 隨機換曲時同步播放器與設定
      this._g = 0;          // 淡入淡出增益 0..1
      this._timer = 0;
      this._announce = false;
      try {
        const s = JSON.parse(localStorage.getItem(KEY) || '{}');
        // 舊版預設是 bgm1，調音量時也會把它存起來：沒有 picked 記號的 bgm1 當成舊預設，改用新的預設 (隨機)。
        // 關閉音樂、選第二 / 三首、隨機都是玩家自己選的，照舊
        const valid = s.choice === 'off' || s.choice === 'shuffle' || TRACKS.some((t) => t.id === s.choice);
        if (valid && (s.picked || s.choice !== 'bgm1')) { this.choice = s.choice; this.picked = true; }
        if (typeof s.vol === 'number' && isFinite(s.vol)) this.vol = Math.max(0, Math.min(1, s.vol));
      } catch (e) { /* ignore */ }
      this.el.addEventListener('ended', () => { if (this.choice === 'shuffle' && this.playing) this._load(this._pick()); });
      this.el.addEventListener('playing', () => {
        if (this._announce && this.cur) { this._announce = false; if (this.onTrack) this.onTrack(this.cur); }
      });
    }

    _save() { try { localStorage.setItem(KEY, JSON.stringify({ choice: this.choice, vol: this.vol, picked: this.picked })); } catch (e) { /* ignore */ } }
    _apply() { this.el.volume = this.muted ? 0 : Math.max(0, Math.min(1, this.vol * this._g)); }
    _fade(to, ms, done) {
      clearInterval(this._timer);
      const from = this._g, t0 = performance.now(), dur = Math.max(1, ms);
      this._timer = setInterval(() => {
        const k = Math.min(1, (performance.now() - t0) / dur);
        this._g = from + (to - from) * k;
        this._apply();
        if (k >= 1) { clearInterval(this._timer); this._timer = 0; if (done) done(); }
      }, 30);
    }
    _tryPlay() { const p = this.el.play(); if (p && p.catch) p.catch(() => { /* 尚未有使用者互動，瀏覽器擋自動播放 */ }); }
    _pick() {
      const pool = TRACKS.filter((t) => t !== this.cur);
      return pool[Math.floor(Math.random() * pool.length)];
    }
    _load(track) {
      this.cur = track;
      if (this.onChange) this.onChange();
      this.el.loop = this.choice !== 'shuffle';
      this.el.src = track.src;
      this._g = 0; this._apply();
      this._announce = true;
      this._tryPlay();
      this._fade(1, 600);
    }

    // 主選單點選：立即切換並試聽
    select(choice) {
      const prev = this.choice;
      this.choice = choice;
      this.picked = true;
      this._save();
      if (this.onChange) this.onChange();
      this.playing = true;
      if (choice === 'off') { this._announce = false; this._fade(0, 300, () => this.el.pause()); return; }
      if (choice !== 'shuffle' && this.cur && this.cur.id === choice && !this.el.paused) { this.el.loop = true; this._fade(1, 300); return; }
      if (choice === 'shuffle' && prev !== 'shuffle' && this.cur && !this.el.paused) { this.el.loop = false; this._fade(1, 300); return; }
      // 換曲（隨機輪播時再按一次 = 下一首）
      const next = choice === 'shuffle' ? this._pick() : TRACKS.find((t) => t.id === choice);
      if (this.cur && !this.el.paused) this._fade(0, 250, () => this._load(next));
      else this._load(next);
    }

    // Use the requested choice during crossfades so rapid clicks advance every time.
    step(direction) {
      const track = TRACKS.find(t => t.id === this.choice) || this.cur;
      let index = TRACKS.indexOf(track);
      if (index < 0) index = direction < 0 ? 0 : -1;
      this.select(TRACKS[(index + (direction < 0 ? -1 : 1) + TRACKS.length) % TRACKS.length].id);
    }

    play() {
      this.playing = true;
      if (this.choice === 'off') return;
      if (!this.cur || (this.choice !== 'shuffle' && this.cur.id !== this.choice)) {
        this._load(this.choice === 'shuffle' ? this._pick() : TRACKS.find((t) => t.id === this.choice));
        return;
      }
      if (this.el.paused) this._tryPlay();
      this._fade(1, 400);
    }

    pause() {
      this.playing = false;
      this._fade(0, 250, () => { if (!this.playing) this.el.pause(); });
    }

    setVolume(v) { this.vol = Math.max(0, Math.min(1, v)); this._apply(); this._save(); }
    setMuted(m) { this.muted = m; this._apply(); }
  }

  Music.TRACKS = TRACKS;
  Music.label = track => `${track.name} · ${track.artist}`;
  RM.Music = Music;
})();
