(() => {
  'use strict';

  // ---------- Configuration ----------

  const LIVES = 5;
  const REGEN_EVERY = 3; // consecutive zero-miss levels that earn back one life (capped at LIVES)
  const BANNER_MS = 750;
  const DEATH_PAUSE_MS = 650; // let the final miss register visually before the end screen
  const HIT_SLOP_PX = 8; // forgiveness around the target edge for fingers
  const MIN_JUMP = 0.28; // min normalized distance between consecutive targets
  const STORAGE_KEY = 'reflex-run:best:v3';
  const SOUND_KEY = 'reflex-run:sound:v1';

  // Logarithmic ramp: value = max(FLOOR, BASE - K * ln(1 + (level - 1))), so level 1 is exactly BASE.
  // Tuned (Monte Carlo of a skilled player) so floors land around 9-10 minutes in and a good run
  // lasts ~10 minutes: delays floor near level 176-179, lifetime near 189, size near 209.
  const BASE = { delayMin: 250, delayMax: 450, lifetime: 900, size: 70 };
  const K = { delayMin: 31, delayMax: 56, lifetime: 107, size: 6 };
  const FLOOR = { delayMin: 90, delayMax: 160, lifetime: 340, size: 38 };
  const BASE_CYCLE = BASE.lifetime + (BASE.delayMin + BASE.delayMax) / 2;

  const rand = (min, max) => min + Math.random() * (max - min);
  const randInt = (min, max) => Math.floor(rand(min, max + 1));

  /** Difficulty for a 1-based level: slow logarithmic ramp toward humane-but-brutal floors. */
  function levelParams(level) {
    const n = level - 1;
    const ramp = Math.log(1 + n);
    const at = (key) => Math.max(FLOOR[key], BASE[key] - K[key] * ramp);
    const delayMin = at('delayMin');
    const delayMax = at('delayMax');
    const lifetime = at('lifetime');
    const size = at('size');
    return {
      delayMin,
      delayMax,
      lifetime,
      size,
      // Keeps growing after the floors, so late levels are always worth more.
      multiplier: 1 + n * 0.05,
      // How much faster one appear→expire cycle is compared with level 1.
      speed: BASE_CYCLE / (lifetime + (delayMin + delayMax) / 2),
    };
  }

  /** Builds a fresh random batch of targets for one level; `prev` keeps jumps big across levels. */
  function generateLevel(level, prev) {
    const p = levelParams(level);
    const count = randInt(4, 6);
    const targets = [];
    for (let i = 0; i < count; i++) {
      let pos;
      let tries = 0;
      do {
        pos = { x: Math.random(), y: Math.random() };
        tries++;
      } while (prev && Math.hypot(pos.x - prev.x, pos.y - prev.y) < MIN_JUMP && tries < 50);
      prev = pos;
      targets.push({
        level,
        index: i,
        count,
        x: pos.x,
        y: pos.y,
        delay: Math.round(rand(p.delayMin, p.delayMax)),
        lifetime: Math.round(Math.max(FLOOR.lifetime, p.lifetime * rand(0.92, 1.08))),
        size: Math.round(Math.max(FLOOR.size, p.size * rand(0.92, 1.08))),
        multiplier: p.multiplier,
      });
    }
    return targets;
  }

  function hitPoints(rt, multiplier) {
    return Math.round(Math.max(50, 1000 - rt) * multiplier);
  }

  function speedClass(ms) {
    if (ms < 250) return 'great';
    if (ms < 400) return 'good';
    if (ms < 600) return 'ok';
    return 'slow';
  }

  /** Rated by survival time — a good run is designed to last about 10 minutes. */
  function ratingFor(ms, hits) {
    if (!hits) return 'No hits — give it another go';
    const min = ms / 60000;
    if (min >= 12) return 'Legendary 👑';
    if (min >= 10) return 'Inhuman 🔥';
    if (min >= 8) return 'Lightning reflexes ⚡';
    if (min >= 5) return 'Razor sharp';
    if (min >= 3) return 'Quick hands';
    if (min >= 1) return 'Solid';
    return 'Warming up';
  }

  const fmtMs = (ms) => `${Math.round(ms)} ms`;
  /** m:ss.t — run clock and survival times. */
  const fmtClock = (ms) => {
    const tenths = Math.floor(Math.max(0, ms) / 100);
    const m = Math.floor(tenths / 600);
    const s = Math.floor(tenths / 10) % 60;
    return `${m}:${String(s).padStart(2, '0')}.${tenths % 10}`;
  };
  const fmtInt = (n) => Math.round(n).toLocaleString();

  // ---------- Storage ----------

  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage unavailable (private mode / disabled) — play on without persistence */
    }
  }

  function storageRemove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  function loadBest() {
    try {
      const data = JSON.parse(storageGet(STORAGE_KEY) || 'null');
      if (data && typeof data === 'object') {
        return {
          time: Number.isFinite(data.time) ? data.time : null,
          level: Number.isFinite(data.level) ? data.level : null,
          score: Number.isFinite(data.score) ? data.score : null,
          runs: Number.isFinite(data.runs) ? data.runs : 0,
        };
      }
    } catch {
      /* corrupted entry — fall through to defaults */
    }
    return { time: null, level: null, score: null, runs: 0 };
  }

  function saveBest(best) {
    storageSet(STORAGE_KEY, JSON.stringify(best));
  }

  // ---------- Audio ----------

  let soundOn = storageGet(SOUND_KEY) !== '0';
  let audioCtx = null;

  function ensureAudio() {
    if (!soundOn) return;
    try {
      if (!audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        audioCtx = new Ctx();
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch {
      audioCtx = null;
    }
  }

  function beep(freq, duration = 0.08, type = 'sine', volume = 0.12) {
    if (!soundOn || !audioCtx) return;
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  const sfx = {
    tick: () => beep(520, 0.09, 'square', 0.06),
    go: () => beep(880, 0.16, 'square', 0.07),
    hit: (cls) => beep(cls === 'great' ? 1320 : cls === 'good' ? 1100 : 900, 0.07, 'triangle', 0.14),
    miss: () => beep(160, 0.14, 'sawtooth', 0.08),
    life: () => {
      beep(990, 0.08, 'sine', 0.1);
      setTimeout(() => beep(1480, 0.14, 'sine', 0.1), 80);
    },
    stage: () => {
      beep(660, 0.08, 'triangle', 0.1);
      setTimeout(() => beep(990, 0.12, 'triangle', 0.1), 90);
    },
    finish: () => {
      [660, 830, 990, 1320].forEach((f, i) => setTimeout(() => beep(f, 0.12, 'triangle', 0.1), i * 90));
    },
    over: () => {
      [440, 330, 220].forEach((f, i) => setTimeout(() => beep(f, 0.16, 'sawtooth', 0.07), i * 120));
    },
  };

  function vibrate(ms) {
    if (navigator.vibrate) {
      try {
        navigator.vibrate(ms);
      } catch {
        /* ignore */
      }
    }
  }

  // ---------- DOM ----------

  const $ = (id) => document.getElementById(id);

  const screens = {
    start: $('screen-start'),
    game: $('screen-game'),
    end: $('screen-end'),
  };

  const el = {
    bestTime: $('best-time'),
    bestLevel: $('best-level'),
    bestScore: $('best-score'),
    btnPlay: $('btn-play'),
    btnSound: $('btn-sound'),
    btnReset: $('btn-reset'),
    btnQuit: $('btn-quit'),
    btnAgain: $('btn-again'),
    btnMenu: $('btn-menu'),
    hudLevel: $('hud-level'),
    hudSpeed: $('hud-speed'),
    hudLast: $('hud-last'),
    hudLives: $('hud-lives'),
    hudLivesWrap: $('hud-lives-wrap'),
    hudTime: $('hud-time'),
    hudScore: $('hud-score'),
    progress: $('progress-bar'),
    arena: $('arena'),
    target: $('target'),
    fx: $('fx-layer'),
    flash: $('flash'),
    countdown: $('overlay-countdown'),
    countdownNum: $('countdown-num'),
    stageOverlay: $('overlay-stage'),
    stageTitle: $('stage-title'),
    stageSub: $('stage-sub'),
    newBest: $('new-best'),
    endTitle: $('end-title'),
    endTime: $('end-time'),
    endTimeWrap: $('end-time-wrap'),
    endLevel: $('end-level'),
    endLevelWrap: $('end-level-wrap'),
    endScore: $('end-score'),
    endScoreWrap: $('end-score-wrap'),
    endRating: $('end-rating'),
    endTotal: $('end-total'),
    endAvg: $('end-avg'),
    endFastest: $('end-fastest'),
    endHits: $('end-hits'),
    endMisses: $('end-misses'),
    endMissBreakdown: $('end-miss-breakdown'),
    endAccuracy: $('end-accuracy'),
    endStages: $('end-stages'),
    endTaps: $('end-taps'),
  };

  function showScreen(name) {
    Object.entries(screens).forEach(([key, node]) => node.classList.toggle('active', key === name));
  }

  /** Restart a CSS animation class on an element. */
  function retrigger(node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
  }

  // ---------- Game state ----------

  // 'menu' | 'countdown' | 'banner' | 'waiting' | 'target' | 'dying' | 'over'
  let state = 'menu';
  let level = 1;
  let levelTargets = []; // the current level's random batch
  let cursor = 0; // index into levelTargets
  let lives = LIVES;
  let cleanStreak = 0; // consecutive levels cleared with zero misses
  let current = null; // { cx, cy, r, def }
  let appearAt = 0;
  let runStart = 0;
  let runEnd = 0;
  let stepTimer = 0;
  let lifeTimer = 0;
  let rafId = 0;
  let stats = null;

  const isPlaying = () => ['countdown', 'banner', 'waiting', 'target'].includes(state);

  function newStats() {
    return {
      taps: [], // { rt, level } for hits, { miss: kind, level } for misses
      reactions: [],
      missEmpty: 0,
      missEarly: 0,
      missTimeout: 0,
      score: 0,
      regained: 0,
      perLevel: [], // index level-1 → { reactions: [], misses: 0 }
    };
  }

  const totalMisses = () => stats.missEmpty + stats.missEarly + stats.missTimeout;

  function levelStats(lv) {
    while (stats.perLevel.length < lv) stats.perLevel.push({ reactions: [], misses: 0 });
    return stats.perLevel[lv - 1];
  }

  function clearTimers() {
    clearTimeout(stepTimer);
    clearTimeout(lifeTimer);
    cancelAnimationFrame(rafId);
    stepTimer = 0;
    lifeTimer = 0;
    rafId = 0;
  }

  function resetArena() {
    el.target.classList.remove('show');
    el.fx.replaceChildren();
    el.flash.className = '';
    el.countdown.hidden = true;
    el.stageOverlay.hidden = true;
  }

  // ---------- Flow ----------

  function startGame() {
    clearTimers();
    ensureAudio();
    level = 1;
    levelTargets = generateLevel(level, null);
    cursor = 0;
    lives = LIVES;
    cleanStreak = 0;
    current = null;
    stats = newStats();
    levelStats(level);
    runStart = 0;
    runEnd = 0;
    resetArena();
    el.hudLast.textContent = '—';
    el.hudLast.className = 'hud-value';
    updateHud();
    el.hudTime.textContent = fmtClock(0);
    showScreen('game');
    runCountdown();
  }

  function runCountdown() {
    state = 'countdown';
    el.countdown.hidden = false;
    const steps = ['3', '2', '1', 'GO'];
    let i = 0;
    const step = () => {
      if (state !== 'countdown') return;
      if (i >= steps.length) {
        el.countdown.hidden = true;
        runStart = performance.now();
        startClock();
        scheduleNext();
        return;
      }
      el.countdownNum.textContent = steps[i];
      retrigger(el.countdownNum, 'pop');
      if (steps[i] === 'GO') sfx.go();
      else sfx.tick();
      stepTimer = setTimeout(step, steps[i] === 'GO' ? 300 : 480);
      i++;
    };
    step();
  }

  function startClock() {
    const tick = () => {
      if (!isPlaying()) return;
      el.hudTime.textContent = fmtClock(performance.now() - runStart);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  function showLevelBanner(regained) {
    state = 'banner';
    const p = levelParams(level);
    el.stageTitle.textContent = `Level ${level}`;
    el.stageSub.textContent =
      `${p.speed.toFixed(1)}× speed · ${levelTargets.length} targets` + (regained ? ' · +1 ♥' : '');
    el.stageOverlay.hidden = false;
    retrigger(el.stageTitle, 'pop');
    if (regained) sfx.life();
    else sfx.stage();
    stepTimer = setTimeout(() => {
      el.stageOverlay.hidden = true;
      scheduleNext();
    }, BANNER_MS);
  }

  function scheduleNext() {
    state = 'waiting';
    updateHud();
    stepTimer = setTimeout(showTarget, levelTargets[cursor].delay);
  }

  function showTarget() {
    const def = levelTargets[cursor];
    const w = el.arena.clientWidth;
    const h = el.arena.clientHeight;
    const size = Math.min(def.size, Math.min(w, h) / 3.5);
    const r = size / 2;
    const margin = r + 12;
    const cx = margin + def.x * Math.max(0, w - 2 * margin);
    const cy = margin + def.y * Math.max(0, h - 2 * margin);

    current = { cx, cy, r, def };
    const t = el.target;
    t.style.setProperty('--size', `${size}px`);
    t.style.setProperty('--life', `${def.lifetime}ms`);
    t.style.left = `${cx - r}px`;
    t.style.top = `${cy - r}px`;
    retrigger(t, 'show');

    state = 'target';
    appearAt = performance.now();
    lifeTimer = setTimeout(onTimeout, def.lifetime);
  }

  function hideTarget() {
    el.target.classList.remove('show');
    clearTimeout(lifeTimer);
    lifeTimer = 0;
  }

  function onPointerDown(e) {
    if (!isPlaying()) return;
    e.preventDefault();
    const rect = el.arena.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (state === 'target') {
      const dist = Math.hypot(x - current.cx, y - current.cy);
      if (dist <= current.r + HIT_SLOP_PX) onHit();
      else onMiss('missEmpty', x, y, 'MISS');
    } else if (state === 'waiting') {
      onMiss('missEarly', x, y, 'TOO EARLY');
    }
    // countdown / banner: taps are ignored
  }

  function onHit() {
    const rt = performance.now() - appearAt;
    const { cx, cy, r, def } = current;
    hideTarget();

    const cls = speedClass(rt);
    stats.reactions.push(rt);
    stats.taps.push({ rt, level: def.level });
    levelStats(def.level).reactions.push(rt);
    stats.score += hitPoints(rt, def.multiplier);

    spawnFx('fx-ripple', cx, cy, { size: r * 2 });
    spawnFx(`fx-label ${cls}`, cx, cy - r * 0.2, { text: fmtMs(rt) });
    retrigger(el.flash, 'hit');
    el.flash.classList.remove('miss');
    sfx.hit(cls);

    el.hudLast.textContent = fmtMs(rt);
    el.hudLast.className = `hud-value ${cls}`;

    advance();
  }

  /** Records a miss and takes a life. Returns true if that was the last life. */
  function registerMiss(kind) {
    stats[kind]++;
    stats.taps.push({ miss: kind, level });
    levelStats(level).misses++;
    lives = Math.max(0, lives - 1);
    flashMiss();
    updateHud();
    if (lives === 0) {
      die();
      return true;
    }
    return false;
  }

  function onMiss(kind, x, y, label) {
    spawnFx('fx-cross', x, y);
    spawnFx('fx-label miss', x, y - 24, { text: label });
    // An off-target tap leaves the target up, so it can still be hit with the lives left.
    registerMiss(kind);
  }

  function onTimeout() {
    if (state !== 'target') return;
    const { cx, cy, r } = current;
    hideTarget();
    spawnFx('fx-expire', cx, cy, { size: r * 2 });
    spawnFx('fx-label miss', cx, cy, { text: 'TOO SLOW' });
    if (!registerMiss('missTimeout')) advance();
  }

  function flashMiss() {
    retrigger(el.flash, 'miss');
    el.flash.classList.remove('hit');
    retrigger(el.hudLivesWrap, 'bump');
    sfx.miss();
    vibrate(35);
  }

  function die() {
    runEnd = performance.now();
    clearTimers();
    hideTarget();
    current = null;
    state = 'dying';
    el.hudTime.textContent = fmtClock(runEnd - runStart);
    stepTimer = setTimeout(finish, DEATH_PAUSE_MS);
  }

  function advance() {
    current = null;
    cursor++;
    if (cursor >= levelTargets.length) {
      const regained = completeLevel();
      const last = levelTargets[levelTargets.length - 1];
      level++;
      levelTargets = generateLevel(level, last);
      cursor = 0;
      levelStats(level);
      updateHud();
      if (regained) retrigger(el.hudLivesWrap, 'gain');
      showLevelBanner(regained);
    } else {
      scheduleNext();
    }
  }

  /** Tracks clean levels; every REGEN_EVERY in a row earns a life back. Returns true if one was regained. */
  function completeLevel() {
    cleanStreak = levelStats(level).misses ? 0 : cleanStreak + 1;
    if (cleanStreak < REGEN_EVERY) return false;
    cleanStreak = 0;
    if (lives >= LIVES) return false;
    lives++;
    stats.regained++;
    return true;
  }

  function spawnFx(className, x, y, opts = {}) {
    const node = document.createElement('div');
    node.className = `fx ${className}`;
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    if (opts.size) node.style.setProperty('--size', `${opts.size}px`);
    if (opts.text) node.textContent = opts.text;
    const remove = () => node.remove();
    node.addEventListener('animationend', remove, { once: true });
    setTimeout(remove, 1200); // safety net if animations are disabled
    el.fx.appendChild(node);
  }

  function updateHud() {
    if (!stats || !levelTargets.length) return;
    el.hudLevel.textContent = String(level);
    el.hudSpeed.textContent = `${levelParams(level).speed.toFixed(1)}×`;
    el.hudLives.replaceChildren(
      ...Array.from({ length: LIVES }, (_, i) => {
        const heart = document.createElement('span');
        heart.className = i < lives ? 'heart' : 'heart lost';
        heart.textContent = '♥';
        return heart;
      })
    );
    el.hudLives.setAttribute('aria-label', `${lives} of ${LIVES} lives left`);
    el.hudScore.textContent = fmtInt(stats.score);
    el.progress.style.width = `${(cursor / levelTargets.length) * 100}%`;
  }

  function finish() {
    state = 'over';
    clearTimers();
    resetArena();

    const hits = stats.reactions.length;
    const misses = totalMisses();
    const attempts = hits + misses;
    const accuracy = attempts ? (hits / attempts) * 100 : 0;
    const avg = hits ? stats.reactions.reduce((a, b) => a + b, 0) / hits : NaN;
    const fastest = hits ? Math.min(...stats.reactions) : NaN;
    const total = runEnd - runStart;
    const score = stats.score;

    const best = loadBest();
    const isBestTime = hits > 0 && (best.time === null || total > best.time);
    const isBestLevel = hits > 0 && (best.level === null || level > best.level);
    const isBestScore = hits > 0 && (best.score === null || score > best.score);
    const updated = {
      time: isBestTime ? total : best.time,
      level: isBestLevel ? level : best.level,
      score: isBestScore ? score : best.score,
      runs: best.runs + 1,
    };
    saveBest(updated);
    renderBest(updated);

    const records = [isBestTime && 'time', isBestLevel && 'level', isBestScore && 'score'].filter(Boolean);
    const minutes = total / 60000;
    if (records.length || minutes >= 5) sfx.finish();
    else sfx.over();

    el.endTitle.textContent = minutes >= 10 ? 'Unstoppable!' : minutes >= 5 ? 'Huge run!' : 'Game over';
    el.endTime.textContent = fmtClock(total);
    el.endLevel.textContent = String(level);
    el.endScore.textContent = fmtInt(score);
    el.endTimeWrap.classList.toggle('is-best', isBestTime);
    el.endLevelWrap.classList.toggle('is-best', isBestLevel);
    el.endScoreWrap.classList.toggle('is-best', isBestScore);
    el.endRating.textContent = `${ratingFor(total, hits)} · ${levelParams(level).speed.toFixed(1)}× speed`;
    el.newBest.hidden = !records.length;
    el.newBest.textContent =
      records.length === 3
        ? 'New best time, level & score!'
        : `New best ${records.join(' & ')}!`;

    el.endTotal.textContent = fmtClock(total);
    el.endAvg.textContent = hits ? fmtMs(avg) : '—';
    el.endFastest.textContent = hits ? fmtMs(fastest) : '—';
    el.endHits.textContent = String(hits);
    el.endMisses.textContent = String(misses);
    el.endMissBreakdown.textContent =
      `${stats.missEmpty} off-target · ${stats.missEarly} early · ${stats.missTimeout} slow` +
      (stats.regained ? ` · ${stats.regained} ♥ regained` : '');
    el.endAccuracy.textContent = `${accuracy.toFixed(1)}%`;

    el.endStages.replaceChildren(
      ...stats.perLevel.map((s, i) => {
        const cell = document.createElement('div');
        cell.className = 'stage-cell';
        const sAvg = s.reactions.length ? s.reactions.reduce((a, b) => a + b, 0) / s.reactions.length : NaN;
        cell.innerHTML = `
          <span class="s-name">L${i + 1}</span>
          <span class="s-avg">${isFinite(sAvg) ? Math.round(sAvg) : '—'}</span>
          <span class="s-miss${s.misses ? ' has' : ''}">${s.misses} miss${s.misses === 1 ? '' : 'es'}</span>`;
        return cell;
      })
    );

    el.endTaps.replaceChildren(
      ...stats.taps.map((tap) => {
        const chip = document.createElement('span');
        if (tap.miss) {
          chip.className = 'chip miss';
          chip.textContent = tap.miss === 'missTimeout' ? 'slow ✕' : tap.miss === 'missEarly' ? 'early ✕' : 'miss ✕';
        } else {
          chip.className = `chip ${speedClass(tap.rt)}`;
          chip.textContent = Math.round(tap.rt);
        }
        chip.title = `Level ${tap.level}`;
        return chip;
      })
    );

    showScreen('end');
    screens.end.scrollTop = 0;
    el.btnAgain.focus({ preventScroll: true });
  }

  function quitToMenu() {
    clearTimers();
    state = 'menu';
    resetArena();
    renderBest(loadBest());
    showScreen('start');
    el.btnPlay.focus({ preventScroll: true });
  }

  // ---------- Menu ----------

  function renderBest(best) {
    el.bestTime.textContent = best.time === null ? '—' : fmtClock(best.time);
    el.bestLevel.textContent = best.level === null ? '—' : String(best.level);
    el.bestScore.textContent = best.score === null ? '—' : fmtInt(best.score);
  }

  function renderSound() {
    el.btnSound.textContent = `Sound: ${soundOn ? 'On' : 'Off'}`;
    el.btnSound.setAttribute('aria-pressed', String(soundOn));
  }

  // ---------- Wiring ----------

  el.arena.addEventListener('pointerdown', onPointerDown);
  el.arena.addEventListener('contextmenu', (e) => e.preventDefault());

  el.btnPlay.addEventListener('click', startGame);
  el.btnAgain.addEventListener('click', startGame);
  el.btnMenu.addEventListener('click', quitToMenu);
  el.btnQuit.addEventListener('click', quitToMenu);

  el.btnSound.addEventListener('click', () => {
    soundOn = !soundOn;
    storageSet(SOUND_KEY, soundOn ? '1' : '0');
    renderSound();
    if (soundOn) {
      ensureAudio();
      beep(880, 0.08, 'triangle', 0.1);
    }
  });

  el.btnReset.addEventListener('click', () => {
    if (window.confirm('Reset your best time, level and score?')) {
      storageRemove(STORAGE_KEY);
      renderBest(loadBest());
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isPlaying()) {
      quitToMenu();
      return;
    }
    // Enter / Space start a run from menu or end screen (unless a button has focus, which handles it natively).
    const onButton = e.target instanceof HTMLButtonElement;
    if (!onButton && (e.key === 'Enter' || e.key === ' ') && (state === 'menu' || state === 'over')) {
      e.preventDefault();
      startGame();
    }
  });

  // Leaving the tab mid-run would make timing meaningless — abandon the run.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && isPlaying()) quitToMenu();
  });

  renderBest(loadBest());
  renderSound();
})();
