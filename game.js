(() => {
  'use strict';

  // ---------- Configuration ----------

  const STAGES = 5;
  const BANNER_MS = 1100;
  const HIT_SLOP_PX = 8; // forgiveness around the target edge for fingers
  const MIN_JUMP = 0.28; // min normalized distance between consecutive targets
  const STORAGE_KEY = 'reflex-run:best:v1';
  const SOUND_KEY = 'reflex-run:sound:v1';

  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (min, max) => min + Math.random() * (max - min);

  /** Difficulty curve: every stage has more targets, shorter gaps, shorter lifetimes, smaller targets. */
  function stageParams(stage) {
    const t = stage / (STAGES - 1);
    return {
      count: 5 + stage,
      delayMin: lerp(600, 180, t),
      delayMax: lerp(1300, 450, t),
      lifetime: lerp(1500, 700, t),
      size: lerp(88, 54, t),
      multiplier: 1 + stage * 0.25,
    };
  }

  /** Builds a brand-new random course: positions, gaps and lifetimes all differ every run. */
  function generateCourse() {
    const course = [];
    let prev = null;
    for (let stage = 0; stage < STAGES; stage++) {
      const p = stageParams(stage);
      for (let i = 0; i < p.count; i++) {
        let pos;
        let tries = 0;
        do {
          pos = { x: Math.random(), y: Math.random() };
          tries++;
        } while (prev && Math.hypot(pos.x - prev.x, pos.y - prev.y) < MIN_JUMP && tries < 50);
        prev = pos;
        course.push({
          stage,
          index: i,
          count: p.count,
          x: pos.x,
          y: pos.y,
          delay: Math.round(rand(p.delayMin, p.delayMax)),
          lifetime: Math.round(p.lifetime * rand(0.9, 1.1)),
          size: Math.round(p.size * rand(0.92, 1.08)),
          multiplier: p.multiplier,
        });
      }
    }
    return course;
  }

  function hitPoints(rt, multiplier) {
    return Math.round(Math.max(50, 1000 - rt) * multiplier);
  }

  function missPenalty(multiplier) {
    return Math.round(200 * multiplier);
  }

  function speedClass(ms) {
    if (ms < 250) return 'great';
    if (ms < 400) return 'good';
    if (ms < 600) return 'ok';
    return 'slow';
  }

  function ratingFor(avg, accuracy) {
    if (!isFinite(avg)) return 'No hits — give it another go';
    let label;
    if (avg < 250) label = 'Lightning reflexes ⚡';
    else if (avg < 320) label = 'Razor sharp';
    else if (avg < 400) label = 'Quick hands';
    else if (avg < 520) label = 'Solid';
    else label = 'Warming up';
    if (accuracy < 70) label += ' · watch the misses';
    return label;
  }

  const fmtMs = (ms) => `${Math.round(ms)} ms`;
  const fmtSec = (ms) => `${(ms / 1000).toFixed(2)}s`;
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
          score: Number.isFinite(data.score) ? data.score : null,
          avg: Number.isFinite(data.avg) ? data.avg : null,
          runs: Number.isFinite(data.runs) ? data.runs : 0,
        };
      }
    } catch {
      /* corrupted entry — fall through to defaults */
    }
    return { score: null, avg: null, runs: 0 };
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
    stage: () => {
      beep(660, 0.08, 'triangle', 0.1);
      setTimeout(() => beep(990, 0.12, 'triangle', 0.1), 90);
    },
    finish: () => {
      [660, 830, 990, 1320].forEach((f, i) => setTimeout(() => beep(f, 0.12, 'triangle', 0.1), i * 90));
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
    bestScore: $('best-score'),
    bestAvg: $('best-avg'),
    btnPlay: $('btn-play'),
    btnSound: $('btn-sound'),
    btnReset: $('btn-reset'),
    btnQuit: $('btn-quit'),
    btnAgain: $('btn-again'),
    btnMenu: $('btn-menu'),
    hudStage: $('hud-stage'),
    hudTarget: $('hud-target'),
    hudLast: $('hud-last'),
    hudMisses: $('hud-misses'),
    hudMissesWrap: $('hud-misses-wrap'),
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
    endScore: $('end-score'),
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

  // 'menu' | 'countdown' | 'banner' | 'waiting' | 'target' | 'over'
  let state = 'menu';
  let course = [];
  let cursor = 0;
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
      taps: [], // { rt, stage } for hits, { miss: kind, stage } for misses
      reactions: [],
      missEmpty: 0,
      missEarly: 0,
      missTimeout: 0,
      score: 0,
      perStage: Array.from({ length: STAGES }, () => ({ reactions: [], misses: 0 })),
    };
  }

  const totalMisses = () => stats.missEmpty + stats.missEarly + stats.missTimeout;

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
    course = generateCourse();
    cursor = 0;
    current = null;
    stats = newStats();
    runStart = 0;
    runEnd = 0;
    resetArena();
    el.hudLast.textContent = '—';
    el.hudLast.className = 'hud-value';
    updateHud();
    el.hudTime.textContent = '0.00';
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
      stepTimer = setTimeout(step, steps[i] === 'GO' ? 380 : 620);
      i++;
    };
    step();
  }

  function startClock() {
    const tick = () => {
      if (!isPlaying()) return;
      el.hudTime.textContent = ((performance.now() - runStart) / 1000).toFixed(2);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  function showStageBanner(stage) {
    state = 'banner';
    const p = stageParams(stage);
    el.stageTitle.textContent = `Stage ${stage + 1}`;
    el.stageSub.textContent = stage === STAGES - 1 ? `Final stage · ${p.count} targets` : `Faster · ${p.count} targets`;
    el.stageOverlay.hidden = false;
    retrigger(el.stageTitle, 'pop');
    sfx.stage();
    stepTimer = setTimeout(() => {
      el.stageOverlay.hidden = true;
      scheduleNext();
    }, BANNER_MS);
  }

  function scheduleNext() {
    state = 'waiting';
    updateHud();
    stepTimer = setTimeout(showTarget, course[cursor].delay);
  }

  function showTarget() {
    const def = course[cursor];
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
    stats.taps.push({ rt, stage: def.stage });
    stats.perStage[def.stage].reactions.push(rt);
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

  function onMiss(kind, x, y, label) {
    const stage = course[cursor].stage;
    stats[kind]++;
    stats.taps.push({ miss: kind, stage });
    stats.perStage[stage].misses++;
    stats.score = Math.max(0, stats.score - missPenalty(course[cursor].multiplier));

    spawnFx('fx-cross', x, y);
    spawnFx('fx-label miss', x, y - 24, { text: label });
    flashMiss();
    updateHud();
  }

  function onTimeout() {
    if (state !== 'target') return;
    const { cx, cy, r, def } = current;
    hideTarget();
    stats.missTimeout++;
    stats.taps.push({ miss: 'missTimeout', stage: def.stage });
    stats.perStage[def.stage].misses++;
    stats.score = Math.max(0, stats.score - missPenalty(def.multiplier));

    spawnFx('fx-expire', cx, cy, { size: r * 2 });
    spawnFx('fx-label miss', cx, cy, { text: 'TOO SLOW' });
    flashMiss();
    advance();
  }

  function flashMiss() {
    retrigger(el.flash, 'miss');
    el.flash.classList.remove('hit');
    retrigger(el.hudMissesWrap, 'bump');
    sfx.miss();
    vibrate(35);
  }

  function advance() {
    current = null;
    cursor++;
    updateHud();
    if (cursor >= course.length) {
      finish();
    } else if (course[cursor].stage !== course[cursor - 1].stage) {
      showStageBanner(course[cursor].stage);
    } else {
      scheduleNext();
    }
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
    if (!stats || !course.length) return;
    const def = course[Math.min(cursor, course.length - 1)];
    const done = cursor >= course.length;
    el.hudStage.textContent = `${def.stage + 1}/${STAGES}`;
    el.hudTarget.textContent = `${done ? def.count : def.index + 1}/${def.count}`;
    el.hudMisses.textContent = String(totalMisses());
    el.hudScore.textContent = fmtInt(stats.score);
    el.progress.style.width = `${(cursor / course.length) * 100}%`;
  }

  function finish() {
    runEnd = performance.now();
    state = 'over';
    clearTimers();
    resetArena();
    sfx.finish();

    const hits = stats.reactions.length;
    const misses = totalMisses();
    const attempts = hits + misses;
    const accuracy = attempts ? (hits / attempts) * 100 : 0;
    const avg = hits ? stats.reactions.reduce((a, b) => a + b, 0) / hits : NaN;
    const fastest = hits ? Math.min(...stats.reactions) : NaN;
    const total = runEnd - runStart;
    const score = stats.score;

    const best = loadBest();
    const isBestScore = hits > 0 && (best.score === null || score > best.score);
    const isBestAvg = hits > 0 && (best.avg === null || avg < best.avg);
    const updated = {
      score: isBestScore ? score : best.score,
      avg: isBestAvg ? Math.round(avg) : best.avg,
      runs: best.runs + 1,
    };
    saveBest(updated);
    renderBest(updated);

    el.endTitle.textContent = accuracy >= 90 && hits > 0 ? 'Clean run!' : 'Course complete';
    el.endScore.textContent = fmtInt(score);
    el.endRating.textContent = ratingFor(avg, accuracy);
    el.newBest.hidden = !(isBestScore || isBestAvg);
    el.newBest.textContent = isBestScore && isBestAvg ? 'New best score & avg!' : isBestScore ? 'New best score!' : 'New best avg!';

    el.endTotal.textContent = fmtSec(total);
    el.endAvg.textContent = hits ? fmtMs(avg) : '—';
    el.endFastest.textContent = hits ? fmtMs(fastest) : '—';
    el.endHits.textContent = String(hits);
    el.endMisses.textContent = String(misses);
    el.endMissBreakdown.textContent = misses
      ? `${stats.missEmpty} off-target · ${stats.missEarly} early · ${stats.missTimeout} slow`
      : 'Flawless';
    el.endAccuracy.textContent = `${accuracy.toFixed(1)}%`;

    el.endStages.replaceChildren(
      ...stats.perStage.map((s, i) => {
        const cell = document.createElement('div');
        cell.className = 'stage-cell';
        const sAvg = s.reactions.length ? s.reactions.reduce((a, b) => a + b, 0) / s.reactions.length : NaN;
        cell.innerHTML = `
          <span class="s-name">S${i + 1}</span>
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
        chip.title = `Stage ${tap.stage + 1}`;
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
    el.bestScore.textContent = best.score === null ? '—' : fmtInt(best.score);
    el.bestAvg.textContent = best.avg === null ? '—' : fmtMs(best.avg);
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
    if (window.confirm('Reset your best score and best average?')) {
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
