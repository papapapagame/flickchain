(() => {
  "use strict";

  const GAME_DURATION = 60;
  const LAUNCH_ZONE_RATIO = 0.18;
  // Visual zone stays the same; touch start accepts a much larger area above it.
  const LAUNCH_HIT_EXTRA_RATIO = 0.14;
  const LAUNCH_HIT_EXTRA_MIN = 90;
  const MAX_SHOT_SPEED = 920;
  const MIN_SHOT_SPEED = 280;
  const BULLET_RADIUS = 9;
  const FRICTION = 0.992;
  const WALL_BOUNCE = 0.72;
  const ENEMY_BOUNCE = 0.88;
  const HIT_STOP_MAX = 0.08;
  const FEVER_MAX = 100;
  const FEVER_DURATION = 5.2;
  const FEVER_PER_KILL = 7;
  const BOMB_FUSE = 7;
  const CORE_BLAST_R = 155;
  const RUSH_TIME = 10;
  const RUSH_SCORE_MUL = 1.5;
  const WALL_BONUS = 50;
  const FX_COLORS = ["#9fe7ff", "#ffd36a", "#ff8fd8", "#7CFFB2", "#ff9a6b", "#c5b7ff", "#ffffff"];

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const hud = document.getElementById("hud");
  const title = document.getElementById("title");
  const result = document.getElementById("result");
  const chainFx = document.getElementById("chain-fx");
  const chainFxMain = document.getElementById("chain-fx-main");
  const chainFxSub = document.getElementById("chain-fx-sub");
  const modeBanner = document.getElementById("mode-banner");
  const elTime = document.getElementById("time");
  const elScore = document.getElementById("score");
  const elMaxChain = document.getElementById("max-chain");
  const elFeverFill = document.getElementById("fever-fill");
  const elResultScore = document.getElementById("result-score");
  const elResultChain = document.getElementById("result-chain");
  const elResultKills = document.getElementById("result-kills");
  const elResultDiff = document.getElementById("result-diff");
  const elResultNew = document.getElementById("result-new");
  const elHsNormal = document.getElementById("hs-normal");
  const elHsExtra = document.getElementById("hs-extra");

  const HS_KEY = "flickchain_highscores_v1";

  const state = {
    mode: "title", // title | play | result
    difficulty: "normal", // normal | extra
    w: 0,
    h: 0,
    dpr: 1,
    score: 0,
    timeLeft: GAME_DURATION,
    maxChain: 0,
    kills: 0,
    enemies: [],
    bullets: [],
    particles: [],
    rings: [],
    floatTexts: [],
    shake: 0,
    hitStop: 0,
    flash: 0,
    flashColor: "255,230,160",
    aim: null,
    lastTs: 0,
    spawnAcc: 0,
    specialAcc: 0,
    chainWindow: 0,
    currentChain: 0,
    comboMul: 1,
    lastMilestone: 0,
    fever: 0,
    feverTime: 0,
    rushActive: false,
    rushAnnounced: false,
  };

  const audio = {
    ctx: null,
    ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    },
    beep(freq, dur, type = "square", gain = 0.04) {
      if (!this.ctx) return;
      const t0 = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(g);
      g.connect(this.ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur);
    },
    hit(chain) {
      const f = 220 + Math.min(chain, 12) * 40;
      this.beep(f, 0.07, "square", 0.045);
    },
    launch() {
      this.beep(160, 0.05, "sawtooth", 0.03);
    },
    chain(n) {
      this.beep(320 + n * 55, 0.12, "triangle", 0.05);
      if (n >= 5) this.beep(480 + n * 30, 0.18, "sine", 0.035);
      if (n >= 8) this.beep(180, 0.22, "sawtooth", 0.025);
    },
    firework() {
      this.beep(520, 0.08, "triangle", 0.04);
      this.beep(780, 0.14, "sine", 0.03);
    },
    fever() {
      this.beep(360, 0.1, "sawtooth", 0.04);
      this.beep(540, 0.16, "triangle", 0.045);
      this.beep(720, 0.22, "sine", 0.03);
    },
    bombWarn() {
      this.beep(140, 0.08, "square", 0.035);
    },
    bombBoom() {
      this.beep(90, 0.25, "sawtooth", 0.05);
      this.beep(60, 0.3, "triangle", 0.04);
    },
    core() {
      this.beep(260, 0.1, "triangle", 0.04);
      this.beep(520, 0.18, "sine", 0.04);
    },
    rush() {
      this.beep(200, 0.08, "square", 0.04);
      this.beep(400, 0.14, "sawtooth", 0.035);
    },
  };

  function resize() {
    const app = document.getElementById("app");
    const rect = app.getBoundingClientRect();
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.w = rect.width;
    state.h = rect.height;
    canvas.width = Math.floor(state.w * state.dpr);
    canvas.height = Math.floor(state.h * state.dpr);
    canvas.style.width = `${state.w}px`;
    canvas.style.height = `${state.h}px`;
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  }

  function launchY() {
    return state.h * (1 - LAUNCH_ZONE_RATIO * 0.35);
  }

  function fieldTop() {
    return 70;
  }

  function fieldBottom() {
    return state.h * (1 - LAUNCH_ZONE_RATIO);
  }

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function pickTargetCount() {
    const t = GAME_DURATION - state.timeLeft;
    let n = 5;
    if (t < 15) n = 5;
    else if (t < 35) n = 8;
    else if (t < 50) n = 11;
    else n = 13;
    if (state.timeLeft <= RUSH_TIME) n += 4;
    if (state.feverTime > 0) n += 1;
    return n;
  }

  function canSpawnHeavy() {
    return GAME_DURATION - state.timeLeft >= 15;
  }

  function hasKind(kind) {
    return state.enemies.some((e) => e.active && e.kind === kind);
  }

  function elapsed() {
    return GAME_DURATION - state.timeLeft;
  }

  function createEnemy(forceKind = null) {
    let kind = forceKind;
    if (!kind) {
      const t = elapsed();
      if (t >= 18 && !hasKind("bomb") && Math.random() < 0.14) kind = "bomb";
      else if (t >= 22 && !hasKind("core") && Math.random() < 0.11) kind = "core";
      else if (canSpawnHeavy() && Math.random() < 0.22) kind = "heavy";
      else kind = "normal";
    }

    const heavy = kind === "heavy";
    const bomb = kind === "bomb";
    const core = kind === "core";
    let r = rand(14, 19);
    let mass = 1;
    if (heavy) {
      r = rand(22, 28);
      mass = 2.4;
    } else if (bomb) {
      r = rand(17, 20);
      mass = 1.15;
    } else if (core) {
      r = rand(24, 30);
      mass = 2.8;
    }

    const margin = r + 8;
    const yMin = fieldTop() + margin;
    const yMax = fieldBottom() - margin - 20;
    return {
      x: rand(margin, state.w - margin),
      y: rand(yMin, yMax),
      vx: 0,
      vy: 0,
      r,
      mass,
      kind,
      heavy,
      bomb,
      core,
      fuse: bomb ? BOMB_FUSE : 0,
      fuseMax: bomb ? BOMB_FUSE : 0,
      hp: 1,
      hit: false,
      life: 1,
      bounceLeft: 2,
      wallKicks: 0,
      active: true,
      chainTagged: false,
      id: Math.random().toString(36).slice(2),
    };
  }

  function trySpawnSpecial(kind) {
    if (hasKind(kind)) return false;
    let tries = 0;
    let enemy;
    do {
      enemy = createEnemy(kind);
      tries += 1;
    } while (tries < 14 && overlapsAny(enemy));
    state.enemies.push(enemy);
    return true;
  }

  function ensureEnemyCount() {
    const target = pickTargetCount();
    while (state.enemies.filter((e) => e.active).length < target) {
      let tries = 0;
      let enemy;
      do {
        enemy = createEnemy();
        tries += 1;
      } while (tries < 12 && overlapsAny(enemy));
      state.enemies.push(enemy);
    }
  }

  function overlapsAny(enemy) {
    for (const e of state.enemies) {
      if (!e.active) continue;
      const dx = e.x - enemy.x;
      const dy = e.y - enemy.y;
      const min = e.r + enemy.r + 6;
      if (dx * dx + dy * dy < min * min) return true;
    }
    return false;
  }

  function loadHighScores() {
    try {
      const raw = localStorage.getItem(HS_KEY);
      if (!raw) return { normal: 0, extra: 0 };
      const data = JSON.parse(raw);
      return {
        normal: Math.max(0, Number(data.normal) || 0),
        extra: Math.max(0, Number(data.extra) || 0),
      };
    } catch (_) {
      return { normal: 0, extra: 0 };
    }
  }

  function saveHighScores(scores) {
    try {
      localStorage.setItem(HS_KEY, JSON.stringify(scores));
    } catch (_) {
      /* ignore */
    }
  }

  function updateTitleHighScores() {
    const hs = loadHighScores();
    elHsNormal.textContent = String(hs.normal);
    elHsExtra.textContent = String(hs.extra);
  }

  function recordHighScore() {
    const hs = loadHighScores();
    const key = state.difficulty === "extra" ? "extra" : "normal";
    let isNew = false;
    if (state.score > hs[key]) {
      hs[key] = state.score;
      saveHighScores(hs);
      isNew = true;
    }
    updateTitleHighScores();
    return isNew;
  }

  function resetGame(difficulty) {
    if (difficulty) state.difficulty = difficulty;
    state.mode = "play";
    state.score = 0;
    state.timeLeft = GAME_DURATION;
    state.maxChain = 0;
    state.kills = 0;
    state.enemies = [];
    state.bullets = [];
    state.particles = [];
    state.rings = [];
    state.floatTexts = [];
    state.shake = 0;
    state.hitStop = 0;
    state.flash = 0;
    state.aim = null;
    state.spawnAcc = 0;
    state.specialAcc = 0;
    state.chainWindow = 0;
    state.currentChain = 0;
    state.comboMul = 1;
    state.lastMilestone = 0;
    state.fever = 0;
    state.feverTime = 0;
    state.rushActive = false;
    state.rushAnnounced = false;
    ensureEnemyCount();
    updateHud();
    title.classList.add("hidden");
    result.classList.add("hidden");
    modeBanner.className = "hidden";
    hud.classList.remove("hidden");
    hud.classList.remove("fever-active", "rush");
  }

  function goToTitle() {
    state.mode = "title";
    state.bullets = [];
    state.aim = null;
    state.feverTime = 0;
    state.enemies = [];
    state.particles = [];
    state.rings = [];
    state.floatTexts = [];
    hud.classList.add("hidden");
    hud.classList.remove("fever-active", "rush");
    modeBanner.className = "hidden";
    result.classList.add("hidden");
    updateTitleHighScores();
    title.classList.remove("hidden");
  }

  function maxBullets() {
    if (state.difficulty === "extra") return Infinity;
    if (state.timeLeft <= RUSH_TIME) return 4;
    if (state.feverTime > 0) return 3;
    return 2;
  }

  function canShoot() {
    return state.bullets.length < maxBullets();
  }

  function endGame() {
    state.mode = "result";
    state.bullets = [];
    state.aim = null;
    state.feverTime = 0;
    hud.classList.add("hidden");
    hud.classList.remove("fever-active", "rush");
    modeBanner.className = "hidden";
    elResultDiff.textContent = state.difficulty === "extra" ? "EXTRA" : "NORMAL";
    elResultScore.textContent = String(state.score);
    elResultChain.textContent = String(state.maxChain);
    elResultKills.textContent = String(state.kills);
    const isNew = recordHighScore();
    elResultNew.classList.toggle("hidden", !isNew);
    result.classList.remove("hidden");
  }

  function scoreMultiplier() {
    let m = state.comboMul;
    if (state.feverTime > 0) m *= 2;
    if (state.timeLeft <= RUSH_TIME) m *= RUSH_SCORE_MUL;
    return m;
  }

  function updateHud() {
    elTime.textContent = String(Math.ceil(Math.max(0, state.timeLeft)));
    elTime.classList.toggle("warn", state.timeLeft <= RUSH_TIME);
    elScore.textContent = String(state.score);
    elMaxChain.textContent = String(state.maxChain);
    const feverPct =
      state.feverTime > 0
        ? (state.feverTime / FEVER_DURATION) * 100
        : (state.fever / FEVER_MAX) * 100;
    elFeverFill.style.width = `${Math.max(0, Math.min(100, feverPct))}%`;
    hud.classList.toggle("fever-active", state.feverTime > 0);
    hud.classList.toggle("rush", state.timeLeft <= RUSH_TIME && state.mode === "play");
  }

  function showModeBanner(text, kind) {
    modeBanner.className = kind;
    modeBanner.textContent = text;
    void modeBanner.offsetWidth;
    modeBanner.classList.add("show");
  }

  function addScore(amount, x, y, label) {
    const gained = Math.round(amount * scoreMultiplier());
    state.score += gained;
    const big = gained >= 500;
    state.floatTexts.push({
      x,
      y,
      text: label || `+${gained}`,
      life: big ? 1.05 : 0.75,
      maxLife: big ? 1.05 : 0.75,
      vy: big ? -55 : -42,
      size: big ? 26 : gained >= 100 ? 18 : 15,
      color: big ? "#ffd36a" : state.feverTime > 0 ? "#ffe08a" : "#9fe7ff",
    });
    updateHud();
  }

  function addPenalty(amount, x, y, label) {
    state.score = Math.max(0, state.score - amount);
    state.floatTexts.push({
      x,
      y,
      text: label || `-${amount}`,
      life: 1,
      maxLife: 1,
      vy: -36,
      size: 20,
      color: "#ff6b6b",
    });
    updateHud();
  }

  function addFever(amount) {
    if (state.feverTime > 0) return;
    state.fever = Math.min(FEVER_MAX, state.fever + amount);
    if (state.fever >= FEVER_MAX) activateFever();
    updateHud();
  }

  function activateFever() {
    state.fever = 0;
    state.feverTime = FEVER_DURATION;

    // +2s unless already in rush
    if (state.timeLeft > RUSH_TIME) {
      state.timeLeft += 2;
      state.floatTexts.push({
        x: state.w * 0.5,
        y: fieldTop() + 36,
        text: "+2s",
        life: 1,
        maxLife: 1,
        vy: -30,
        size: 22,
        color: "#ffe08a",
      });
    }

    showModeBanner("FEVER!", "fever");
    triggerFlash(0.45, "255,200,100");
    spawnFireworkShow(4);
    state.shake = Math.min(16, state.shake + 7);
    audio.fever();
    vibrate([25, 30, 25, 30, 40]);
    updateHud();
  }

  function vibrate(pattern) {
    if (navigator.vibrate) {
      try {
        navigator.vibrate(pattern);
      } catch (_) {
        /* ignore */
      }
    }
  }

  function pickColor() {
    return FX_COLORS[(Math.random() * FX_COLORS.length) | 0];
  }

  function showChain(n) {
    if (n < 2) return;

    let tier = "";
    let sub = "";
    if (n >= 12) {
      tier = "tier-12";
      sub = "LEGENDARY";
    } else if (n >= 8) {
      tier = "tier-8";
      sub = "AMAZING";
    } else if (n >= 5) {
      tier = "tier-5";
      sub = "GREAT";
    } else if (n >= 3) {
      sub = "NICE";
    }

    chainFx.className = tier;
    chainFxMain.textContent = `${n} CHAIN!`;
    chainFxSub.textContent = sub;
    void chainFx.offsetWidth;
    chainFx.classList.add("show");
    if (tier) chainFx.classList.add(tier);
    audio.chain(n);
  }

  function spawnBurst(x, y, color, count = 10, speed = 260) {
    for (let i = 0; i < count; i += 1) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(speed * 0.25, speed);
      state.particles.push({
        type: "spark",
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rand(0.28, 0.65),
        maxLife: 0.65,
        r: rand(2, 5),
        color,
        drag: 0.97,
        gravity: 0,
      });
    }
  }

  function spawnStreaks(x, y, color, count = 8) {
    for (let i = 0; i < count; i += 1) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(180, 520);
      state.particles.push({
        type: "streak",
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rand(0.18, 0.38),
        maxLife: 0.38,
        r: rand(8, 18),
        color,
        drag: 0.94,
        gravity: 0,
      });
    }
  }

  function spawnStars(x, y, count = 6) {
    for (let i = 0; i < count; i += 1) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(40, 180);
      state.particles.push({
        type: "star",
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - rand(20, 80),
        life: rand(0.45, 0.9),
        maxLife: 0.9,
        r: rand(3, 6),
        color: pickColor(),
        drag: 0.98,
        gravity: 40,
        spin: rand(-8, 8),
        angle: rand(0, Math.PI * 2),
      });
    }
  }

  function spawnRing(x, y, color, maxR = 70, width = 4) {
    state.rings.push({
      x,
      y,
      r: 8,
      maxR,
      life: 1,
      width,
      color,
    });
  }

  function spawnFirework(x, y, color) {
    const c = color || pickColor();
    const petals = 18 + ((Math.random() * 10) | 0);
    for (let i = 0; i < petals; i += 1) {
      const a = (Math.PI * 2 * i) / petals + rand(-0.08, 0.08);
      const sp = rand(160, 420);
      state.particles.push({
        type: "ember",
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rand(0.55, 1.05),
        maxLife: 1.05,
        r: rand(2.5, 5),
        color: c,
        drag: 0.985,
        gravity: 280,
      });
    }
    // secondary glitter
    for (let i = 0; i < 14; i += 1) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(40, 220);
      state.particles.push({
        type: "glitter",
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rand(0.4, 0.9),
        maxLife: 0.9,
        r: rand(1.5, 3.2),
        color: "#ffffff",
        drag: 0.98,
        gravity: 120,
      });
    }
    spawnRing(x, y, c, rand(60, 110), 3);
    audio.firework();
  }

  function spawnFireworkShow(intensity) {
    const n = intensity;
    for (let i = 0; i < n; i += 1) {
      const x = rand(state.w * 0.12, state.w * 0.88);
      const y = rand(state.h * 0.18, state.h * 0.55);
      // stagger via delayed life offset using negative spawn delay on a pseudo particle
      state.particles.push({
        type: "fuse",
        x,
        y,
        vx: 0,
        vy: 0,
        life: 0.05 + i * 0.06,
        maxLife: 0.05 + i * 0.06,
        r: 0,
        color: pickColor(),
        drag: 1,
        gravity: 0,
        fuseColor: pickColor(),
      });
    }
  }

  function triggerFlash(amount, color = "255,230,160") {
    state.flash = Math.min(0.85, Math.max(state.flash, amount));
    state.flashColor = color;
  }

  function onChainMilestone(n, x, y) {
    if (n === 3) {
      spawnRing(x, y, "#ffe08a", 100, 5);
      spawnStreaks(x, y, "#ffe08a", 12);
      vibrate(12);
    }

    if (n >= 5 && state.lastMilestone < 5) {
      spawnFirework(x, y, "#ffd36a");
      spawnFirework(state.w * 0.5, state.h * 0.35, "#9fe7ff");
      spawnStars(x, y, 12);
      triggerFlash(0.38, "255,210,120");
      state.shake = Math.min(16, state.shake + 6);
      vibrate([20, 30, 20]);
      state.lastMilestone = 5;
    }

    if (n >= 8 && state.lastMilestone < 8) {
      spawnFireworkShow(5);
      spawnRing(state.w * 0.5, state.h * 0.4, "#ff9de4", 170, 7);
      triggerFlash(0.58, "255,150,230");
      state.shake = Math.min(18, state.shake + 9);
      state.hitStop = Math.max(state.hitStop, 0.06);
      vibrate([30, 40, 30, 40, 50]);
      state.lastMilestone = 8;
    }

    if (n >= 12 && state.lastMilestone < 12) {
      spawnFireworkShow(10);
      spawnRing(state.w * 0.5, state.h * 0.38, "#ffffff", 230, 10);
      triggerFlash(0.78, "255,255,255");
      state.shake = 18;
      state.hitStop = Math.max(state.hitStop, 0.08);
      vibrate([40, 40, 40, 40, 80]);
      state.lastMilestone = 12;
    }

    // Extra fireworks every 5 after unlocking
    if (n > 5 && n % 5 === 0) {
      spawnFirework(x, y, pickColor());
      spawnFirework(rand(40, state.w - 40), rand(state.h * 0.2, state.h * 0.5), pickColor());
      triggerFlash(0.28, "255,220,160");
    }
  }

  function coreBlast(core) {
    spawnRing(core.x, core.y, "#d4a6ff", CORE_BLAST_R, 8);
    spawnBurst(core.x, core.y, "#e7c6ff", 28, 420);
    spawnStreaks(core.x, core.y, "#c084fc", 16);
    triggerFlash(0.4, "210,160,255");
    audio.core();
    for (const e of state.enemies) {
      if (!e.active || e === core) continue;
      const dx = e.x - core.x;
      const dy = e.y - core.y;
      const dist = Math.hypot(dx, dy) || 1;
      if (dist > CORE_BLAST_R + e.r) continue;
      const power = (1 - dist / (CORE_BLAST_R + e.r)) * 680;
      e.vx += (dx / dist) * power / e.mass;
      e.vy += (dy / dist) * power / e.mass;
      e.hit = true;
      e.chainTagged = true;
      e.bounceLeft = 2;
    }
  }

  function explodeBomb(bomb) {
    if (!bomb.active) return;
    bomb.active = false;
    addPenalty(200, bomb.x, bomb.y - bomb.r, "-200");
    spawnBurst(bomb.x, bomb.y, "#ff5a4a", 32, 480);
    spawnStreaks(bomb.x, bomb.y, "#ff8b6a", 18);
    spawnRing(bomb.x, bomb.y, "#ff4d3a", 140, 8);
    triggerFlash(0.55, "255,70,50");
    state.shake = Math.min(18, state.shake + 10);
    audio.bombBoom();
    vibrate([40, 30, 50]);

    for (const e of state.enemies) {
      if (!e.active || e === bomb) continue;
      const dx = e.x - bomb.x;
      const dy = e.y - bomb.y;
      const dist = Math.hypot(dx, dy) || 1;
      if (dist > 170 + e.r) continue;
      const power = (1 - dist / (170 + e.r)) * 820;
      e.vx += (dx / dist) * power / e.mass;
      e.vy += (dy / dist) * power / e.mass;
      e.hit = true;
      e.chainTagged = true;
      e.bounceLeft = 2;
      e.wallKicks = 0;
    }
  }

  function killEnemy(enemy, fromChain) {
    if (!enemy.active) return;
    enemy.active = false;
    state.kills += 1;
    state.currentChain += 1;
    const n = state.currentChain;
    state.maxChain = Math.max(state.maxChain, n);
    state.chainWindow = 1.5;

    if (enemy.wallKicks > 0) {
      const wallPts = WALL_BONUS + Math.min(3, enemy.wallKicks) * 25;
      addScore(wallPts, enemy.x, enemy.y - enemy.r - 18, "WALL!");
    }

    let base = fromChain ? 30 : 20;
    if (enemy.heavy) base += 15;
    if (enemy.bomb) {
      base += 100;
      addScore(base, enemy.x, enemy.y - enemy.r, "DISARM!");
    } else if (enemy.core) {
      base += 80;
      addScore(base, enemy.x, enemy.y - enemy.r, "CORE!");
      coreBlast(enemy);
    } else {
      addScore(base, enemy.x, enemy.y - enemy.r);
    }

    addFever(FEVER_PER_KILL + Math.min(10, Math.floor(n * 1.2)));

    let col = "#7ad0ff";
    if (enemy.heavy) col = "#ffb36a";
    if (enemy.bomb) col = "#ff7a6a";
    if (enemy.core) col = "#d4a6ff";
    const burstCount = (enemy.heavy || enemy.core ? 18 : 12) + Math.min(20, n * 2);
    spawnBurst(enemy.x, enemy.y, col, burstCount, 220 + n * 18);
    spawnStreaks(enemy.x, enemy.y, col, 4 + Math.min(10, n));
    spawnRing(enemy.x, enemy.y, col, 36 + n * 4, 3);

    if (n >= 3) spawnStars(enemy.x, enemy.y, 3 + Math.min(8, n));

    state.shake = Math.min(16, state.shake + 1.4 + n * 0.22);
    state.hitStop = Math.min(HIT_STOP_MAX, 0.02 + n * 0.003);
    audio.hit(n);

    if (n >= 2) showChain(n);
    onChainMilestone(n, enemy.x, enemy.y);
  }

  function finalizeChainBurst() {
    const n = state.currentChain;
    if (n <= 0) return;
    if (n >= 2) {
      const bonus = n * n * 50;
      addScore(bonus, state.w * 0.5, state.h * 0.32, `${n}×${n}×50`);
      if (n >= 5) {
        state.comboMul = Math.min(2, state.comboMul + 0.2);
        spawnFirework(state.w * 0.5, state.h * 0.35, "#ffd36a");
      }
      if (n >= 8) spawnFireworkShow(3);
    }
    state.currentChain = 0;
    state.lastMilestone = 0;
  }

  function pointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    const src = e.touches && e.touches[0] ? e.touches[0] : e;
    return {
      x: ((src.clientX - rect.left) / rect.width) * state.w,
      y: ((src.clientY - rect.top) / rect.height) * state.h,
    };
  }

  function launchHitTop() {
    const extra = Math.max(LAUNCH_HIT_EXTRA_MIN, state.h * LAUNCH_HIT_EXTRA_RATIO);
    return fieldBottom() - extra;
  }

  function inLaunchZone(y) {
    return y >= launchHitTop();
  }

  function onPointerDown(e) {
    if (state.mode !== "play") return;
    e.preventDefault();
    audio.ensure();
    const p = pointerPos(e);
    if (!inLaunchZone(p.y)) return;
    if (!canShoot()) return;
    state.aim = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    if (canvas.setPointerCapture && e.pointerId != null) {
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (_) {
        /* ignore */
      }
    }
  }

  function onPointerMove(e) {
    if (!state.aim || state.mode !== "play") return;
    e.preventDefault();
    const p = pointerPos(e);
    state.aim.x1 = p.x;
    state.aim.y1 = p.y;
  }

  function onPointerUp(e) {
    if (!state.aim || state.mode !== "play") return;
    e.preventDefault();
    const aim = state.aim;
    state.aim = null;

    const dx = aim.x1 - aim.x0;
    const dy = aim.y1 - aim.y0;
    const dist = Math.hypot(dx, dy);
    if (dist < 18) return;
    if (!canShoot()) return;

    // Prefer upward flicks; reverse if user dragged downward
    let vx = dx;
    let vy = dy;
    if (vy > 0) {
      vx = -vx;
      vy = -vy;
    }

    const len = Math.hypot(vx, vy) || 1;
    const power = Math.min(1, dist / 140);
    const speed = MIN_SHOT_SPEED + (MAX_SHOT_SPEED - MIN_SHOT_SPEED) * power;
    const piercing = state.feverTime > 0;
    state.bullets.push({
      x: state.w * 0.5,
      y: launchY(),
      vx: (vx / len) * speed,
      vy: (vy / len) * speed,
      r: BULLET_RADIUS + (piercing ? 2 : 0),
      life: piercing ? 2.1 : 1.6,
      bounceLeft: piercing ? 3 : 2,
      trail: [],
      pierceLeft: piercing ? 4 : 0,
      hitIds: new Set(),
      fever: piercing,
      alive: true,
    });
    spawnBurst(state.w * 0.5, launchY(), piercing ? "#ffd36a" : "#9fe7ff", 8, 140);
    audio.launch();
  }

  function resolveEnemyCollision(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 1;
    const minDist = a.r + b.r;
    if (dist >= minDist) return false;

    const nx = dx / dist;
    const ny = dy / dist;
    const overlap = minDist - dist;
    const totalMass = a.mass + b.mass;
    a.x -= (nx * overlap * b.mass) / totalMass;
    a.y -= (ny * overlap * b.mass) / totalMass;
    b.x += (nx * overlap * a.mass) / totalMass;
    b.y += (ny * overlap * a.mass) / totalMass;

    const avn = a.vx * nx + a.vy * ny;
    const bvn = b.vx * nx + b.vy * ny;
    const aNew = ((avn * (a.mass - b.mass) + 2 * b.mass * bvn) / totalMass) * ENEMY_BOUNCE;
    const bNew = ((bvn * (b.mass - a.mass) + 2 * a.mass * avn) / totalMass) * ENEMY_BOUNCE;
    a.vx += (aNew - avn) * nx;
    a.vy += (aNew - avn) * ny;
    b.vx += (bNew - bvn) * nx;
    b.vy += (bNew - bvn) * ny;

    // Transfer "hit" state so chain continues
    if (a.hit || b.hit) {
      a.hit = true;
      b.hit = true;
      a.chainTagged = true;
      b.chainTagged = true;
    }
    return true;
  }

  function bounceWall(obj, isEnemy) {
    // Hit enemies escape after bounces for satisfying wipeouts
    if (isEnemy && obj.hit && obj.bounceLeft < 0) return false;

    const minY = isEnemy ? fieldTop() + obj.r : obj.r;
    const maxY = isEnemy ? fieldBottom() - obj.r : state.h - obj.r;
    let bounced = false;

    if (obj.x < obj.r) {
      obj.x = obj.r;
      obj.vx = Math.abs(obj.vx) * WALL_BOUNCE;
      bounced = true;
    } else if (obj.x > state.w - obj.r) {
      obj.x = state.w - obj.r;
      obj.vx = -Math.abs(obj.vx) * WALL_BOUNCE;
      bounced = true;
    }

    if (obj.y < minY) {
      obj.y = minY;
      obj.vy = Math.abs(obj.vy) * WALL_BOUNCE;
      bounced = true;
    } else if (obj.y > maxY) {
      obj.y = maxY;
      obj.vy = -Math.abs(obj.vy) * WALL_BOUNCE;
      bounced = true;
    }

    if (bounced && obj.bounceLeft != null) {
      obj.bounceLeft -= 1;
    }
    if (bounced && isEnemy && obj.hit) {
      obj.wallKicks = (obj.wallKicks || 0) + 1;
    }
    return bounced;
  }

  function updateFx(dt) {
    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 18);
    if (state.flash > 0) state.flash = Math.max(0, state.flash - dt * 1.8);

    const nextParticles = [];
    for (const p of state.particles) {
      if (p.type === "fuse") {
        p.life -= dt;
        if (p.life <= 0) {
          spawnFirework(p.x, p.y, p.fuseColor || p.color);
        } else {
          nextParticles.push(p);
        }
        continue;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= p.drag || 0.98;
      p.vy *= p.drag || 0.98;
      p.vy += (p.gravity || 0) * dt;
      if (p.spin) p.angle = (p.angle || 0) + p.spin * dt;
      p.life -= dt;
      if (p.life > 0) nextParticles.push(p);
    }
    // Cap for mobile performance
    state.particles = nextParticles.length > 450 ? nextParticles.slice(-450) : nextParticles;

    for (const ring of state.rings) {
      const t = 1 - ring.life;
      ring.r = 8 + (ring.maxR - 8) * (1 - Math.pow(1 - Math.min(1, t), 1.6));
      ring.life -= dt * 1.7;
    }
    state.rings = state.rings.filter((r) => r.life > 0);

    for (const f of state.floatTexts) {
      f.y += f.vy * dt;
      f.life -= dt;
    }
    state.floatTexts = state.floatTexts.filter((f) => f.life > 0);
  }

  function update(dt) {
    if (state.mode !== "play") return;

    if (state.hitStop > 0) {
      state.hitStop -= dt;
      updateFx(dt);
      return;
    }

    state.timeLeft -= dt;
    if (state.timeLeft <= 0) {
      state.timeLeft = 0;
      updateHud();
      endGame();
      return;
    }

    // Fever countdown
    if (state.feverTime > 0) {
      state.feverTime -= dt;
      if (state.feverTime <= 0) {
        state.feverTime = 0;
        updateHud();
      }
    }

    // Last 10s rush
    if (state.timeLeft <= RUSH_TIME && !state.rushAnnounced) {
      state.rushAnnounced = true;
      state.rushActive = true;
      showModeBanner("RUSH!", "rush");
      triggerFlash(0.35, "255,100,70");
      audio.rush();
      vibrate([20, 20, 35]);
      ensureEnemyCount();
    }

    if (state.chainWindow > 0) {
      state.chainWindow -= dt;
      if (state.chainWindow <= 0 && state.currentChain > 0) {
        finalizeChainBurst();
        state.comboMul = 1;
      }
    }

    // bullets
    for (const b of state.bullets) {
      if (!b.alive) continue;
      b.trail.push({ x: b.x, y: b.y, life: 0.22 });
      if (b.trail.length > 14) b.trail.shift();
      for (const t of b.trail) t.life -= dt;

      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      bounceWall(b, false);

      if (Math.random() < (b.fever ? 0.85 : 0.55)) {
        state.particles.push({
          type: "spark",
          x: b.x + rand(-3, 3),
          y: b.y + rand(-3, 3),
          vx: -b.vx * 0.05 + rand(-30, 30),
          vy: -b.vy * 0.05 + rand(-30, 30),
          life: rand(0.1, 0.22),
          maxLife: 0.22,
          r: rand(1.5, 3),
          color: b.fever ? "#ffe08a" : "#dff6ff",
          drag: 0.9,
          gravity: 0,
        });
      }

      for (const e of state.enemies) {
        if (!e.active || !b.alive) continue;
        if (b.hitIds.has(e.id)) continue;
        const dx = e.x - b.x;
        const dy = e.y - b.y;
        const rr = e.r + b.r;
        if (dx * dx + dy * dy <= rr * rr) {
          const dist = Math.hypot(dx, dy) || 1;
          const nx = dx / dist;
          const ny = dy / dist;
          const transfer = b.fever ? 1.2 : 1.05;
          e.vx += (b.vx * transfer) / e.mass;
          e.vy += (b.vy * transfer) / e.mass;
          e.vx += (nx * (b.fever ? 280 : 220)) / e.mass;
          e.vy += (ny * (b.fever ? 280 : 220)) / e.mass;
          e.hit = true;
          e.chainTagged = true;
          e.bounceLeft = 2;
          b.hitIds.add(e.id);
          addScore(10, e.x, e.y - e.r - 8, "+10");
          spawnBurst(b.x, b.y, b.fever ? "#ffd36a" : "#ffffff", 16, 340);
          spawnStreaks(b.x, b.y, b.fever ? "#ffb347" : "#9fe7ff", 10);
          spawnRing(b.x, b.y, "#ffffff", 55, 4);
          triggerFlash(0.18, b.fever ? "255,210,120" : "200,240,255");
          state.shake = Math.min(14, state.shake + 2.5);
          state.hitStop = 0.035;
          audio.hit(1);

          if (b.pierceLeft > 0) {
            b.pierceLeft -= 1;
            b.vx *= 0.98;
            b.vy *= 0.98;
          } else {
            b.alive = false;
            break;
          }
        }
      }

      if (b.alive && (b.life <= 0 || b.bounceLeft < 0 || b.y < -40 || b.y > state.h + 40)) {
        b.alive = false;
      }
    }
    state.bullets = state.bullets.filter((b) => b.alive);

    // enemies
    const active = state.enemies.filter((e) => e.active);
    for (const e of active) {
      e.vx *= FRICTION;
      e.vy *= FRICTION;
      e.x += e.vx * dt;
      e.y += e.vy * dt;

      const speed = Math.hypot(e.vx, e.vy);
      if (e.hit && speed < 35) {
        e.vx *= 0.9;
        e.vy *= 0.9;
      }

      bounceWall(e, true);

      if (e.bomb && e.active) {
        e.fuse -= dt;
        if (e.fuse <= 1.6 && Math.floor(e.fuse * 6) !== Math.floor((e.fuse + dt) * 6)) {
          audio.bombWarn();
        }
        if (e.fuse <= 0) explodeBomb(e);
      }

      // off-screen kill
      if (
        e.active &&
        (e.x < -e.r - 12 ||
          e.x > state.w + e.r + 12 ||
          e.y < -e.r - 12 ||
          e.y > state.h + e.r + 12)
      ) {
        killEnemy(e, e.chainTagged);
      }
    }

    for (let i = 0; i < active.length; i += 1) {
      for (let j = i + 1; j < active.length; j += 1) {
        const a = active[i];
        const b = active[j];
        if (!a.active || !b.active) continue;
        if (resolveEnemyCollision(a, b)) {
          const impact = Math.hypot(a.vx - b.vx, a.vy - b.vy);
          if (impact > 180 && (a.hit || b.hit)) {
            state.shake = Math.min(14, state.shake + 0.9);
            spawnBurst((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, "#ffffff", 6, 180);
            if (impact > 420) {
              spawnRing((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, "#9fe7ff", 48, 3);
              if (a.hit && Math.random() < 0.45) killEnemy(a, true);
              if (b.hit && Math.random() < 0.45) killEnemy(b, true);
            }
          }
        }
      }
    }

    // Hit enemies that nearly stop still count as wiped
    for (const e of state.enemies) {
      if (!e.active || !e.hit) continue;
      const speed = Math.hypot(e.vx, e.vy);
      if (speed < 40) {
        e.life -= dt;
        if (e.life <= 0) killEnemy(e, true);
      } else {
        e.life = 1;
      }
    }

    state.enemies = state.enemies.filter((e) => e.active);

    state.spawnAcc += dt;
    if (state.spawnAcc > 0.35) {
      state.spawnAcc = 0;
      ensureEnemyCount();
    }

    // Guaranteed special spawns
    state.specialAcc += dt;
    if (state.specialAcc > 7.5) {
      state.specialAcc = 0;
      const t = elapsed();
      if (t >= 18 && !hasKind("bomb") && Math.random() < 0.7) trySpawnSpecial("bomb");
      else if (t >= 22 && !hasKind("core") && Math.random() < 0.65) trySpawnSpecial("core");
    }

    updateFx(dt);
    updateHud();
  }

  function drawLaunchZone() {
    const y = fieldBottom();
    const grad = ctx.createLinearGradient(0, y, 0, state.h);
    grad.addColorStop(0, "rgba(70, 140, 220, 0.05)");
    grad.addColorStop(1, "rgba(70, 160, 255, 0.18)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, y, state.w, state.h - y);

    ctx.strokeStyle = "rgba(130, 190, 255, 0.35)";
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(16, y);
    ctx.lineTo(state.w - 16, y);
    ctx.stroke();
    ctx.setLineDash([]);

    // launcher
    const lx = state.w * 0.5;
    const ly = launchY();
    ctx.beginPath();
    ctx.arc(lx, ly, 16, 0, Math.PI * 2);
    ctx.fillStyle = "#9fe7ff";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.stroke();
  }

  function drawAim() {
    if (!state.aim || !canShoot()) return;
    const ax = state.w * 0.5;
    const ay = launchY();
    let dx = state.aim.x1 - state.aim.x0;
    let dy = state.aim.y1 - state.aim.y0;
    if (dy > 0) {
      dx = -dx;
      dy = -dy;
    }
    const dist = Math.hypot(dx, dy);
    if (dist < 8) return;
    const len = Math.min(160, dist);
    const nx = dx / (Math.hypot(dx, dy) || 1);
    const ny = dy / (Math.hypot(dx, dy) || 1);

    ctx.strokeStyle = "rgba(159, 231, 255, 0.75)";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + nx * len, ay + ny * len);
    ctx.stroke();

    for (let i = 1; i <= 4; i += 1) {
      const t = i / 4;
      ctx.beginPath();
      ctx.arc(ax + nx * len * t, ay + ny * len * t, 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${0.2 + t * 0.4})`;
      ctx.fill();
    }
  }

  function drawStar(x, y, r, angle) {
    ctx.beginPath();
    for (let i = 0; i < 5; i += 1) {
      const a = angle + (i * Math.PI * 2) / 5 - Math.PI / 2;
      const b = a + Math.PI / 5;
      const ox = Math.cos(a) * r;
      const oy = Math.sin(a) * r;
      const ix = Math.cos(b) * r * 0.45;
      const iy = Math.sin(b) * r * 0.45;
      if (i === 0) ctx.moveTo(x + ox, y + oy);
      else ctx.lineTo(x + ox, y + oy);
      ctx.lineTo(x + ix, y + iy);
    }
    ctx.closePath();
  }

  function drawParticles() {
    for (const p of state.particles) {
      if (p.type === "fuse") continue;
      const alpha = Math.max(0, p.life / (p.maxLife || 0.6));
      ctx.globalAlpha = Math.min(1, alpha * 1.4);

      if (p.type === "streak") {
        const ang = Math.atan2(p.vy, p.vx);
        const len = p.r;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2.2;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - Math.cos(ang) * len, p.y - Math.sin(ang) * len);
        ctx.stroke();
      } else if (p.type === "star") {
        drawStar(p.x, p.y, p.r, p.angle || 0);
        ctx.fillStyle = p.color;
        ctx.fill();
      } else if (p.type === "ember" || p.type === "glitter") {
        ctx.shadowColor = p.color;
        ctx.shadowBlur = p.type === "glitter" ? 8 : 12;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (0.6 + alpha * 0.6), 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.shadowBlur = 0;
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawRings() {
    for (const ring of state.rings) {
      ctx.globalAlpha = Math.max(0, ring.life);
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = ring.width * ring.life;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function draw() {
    ctx.clearRect(0, 0, state.w, state.h);

    ctx.save();
    if (state.shake > 0) {
      const mag = state.shake;
      ctx.translate((Math.random() - 0.5) * mag, (Math.random() - 0.5) * mag);
    }

    // field tint - brighter during high chains / fever / rush
    const heat = Math.min(1, state.currentChain / 12);
    ctx.fillStyle = `rgba(12, 28, 48, ${0.35 + heat * 0.08})`;
    ctx.fillRect(0, fieldTop(), state.w, fieldBottom() - fieldTop());
    if (heat > 0.2 || state.feverTime > 0 || state.timeLeft <= RUSH_TIME) {
      const hg = ctx.createRadialGradient(
        state.w * 0.5,
        state.h * 0.4,
        20,
        state.w * 0.5,
        state.h * 0.4,
        state.w * 0.7
      );
      if (state.feverTime > 0) {
        hg.addColorStop(0, "rgba(255, 190, 80, 0.16)");
      } else if (state.timeLeft <= RUSH_TIME) {
        hg.addColorStop(0, "rgba(255, 70, 50, 0.12)");
      } else {
        hg.addColorStop(0, `rgba(255, 180, 80, ${0.04 + heat * 0.1})`);
      }
      hg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = hg;
      ctx.fillRect(0, 0, state.w, state.h);
    }

    if (state.timeLeft <= RUSH_TIME && state.mode === "play") {
      ctx.strokeStyle = `rgba(255, 90, 60, ${0.25 + Math.sin(performance.now() / 120) * 0.15})`;
      ctx.lineWidth = 4;
      ctx.strokeRect(6, fieldTop() + 4, state.w - 12, fieldBottom() - fieldTop() - 8);
    }

    drawLaunchZone();
    drawRings();

    for (const e of state.enemies) {
      if (!e.active) continue;
      const pulse = e.hit ? 1 + Math.sin(performance.now() / 40) * 0.05 : 1;
      let glow = e.heavy ? "rgba(255,140,80,0.22)" : "rgba(80,180,255,0.2)";
      if (e.bomb) {
        const danger = 1 - e.fuse / Math.max(0.01, e.fuseMax);
        const blink = e.fuse < 2 ? 0.5 + Math.sin(performance.now() / 50) * 0.5 : 1;
        glow = `rgba(255,60,50,${0.18 + danger * 0.25 * blink})`;
      } else if (e.core) {
        glow = "rgba(180,120,255,0.28)";
      }

      ctx.beginPath();
      ctx.arc(e.x, e.y, (e.r + (e.hit ? 5 : 2)) * pulse, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();

      const g = ctx.createRadialGradient(
        e.x - e.r * 0.35,
        e.y - e.r * 0.35,
        2,
        e.x,
        e.y,
        e.r
      );
      if (e.core) {
        g.addColorStop(0, "#f0e4ff");
        g.addColorStop(1, "#9b5cff");
      } else if (e.bomb) {
        g.addColorStop(0, "#ffd0c8");
        g.addColorStop(1, "#e23a2e");
      } else if (e.heavy) {
        g.addColorStop(0, "#ffe0bf");
        g.addColorStop(1, "#e67a3a");
      } else {
        g.addColorStop(0, "#e7f8ff");
        g.addColorStop(1, "#3a9dff");
      }
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();

      if (e.core) {
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(performance.now() / 700);
        ctx.strokeStyle = "rgba(255,255,255,0.75)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 6; i += 1) {
          const a = (i * Math.PI * 2) / 6;
          const px = Math.cos(a) * e.r * 0.55;
          const py = Math.sin(a) * e.r * 0.55;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }

      if (e.bomb) {
        const ratio = Math.max(0, e.fuse / Math.max(0.01, e.fuseMax));
        ctx.strokeStyle = "rgba(255,220,180,0.85)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
        ctx.stroke();
      }

      if (e.hit) {
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.75)";
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.shadowColor = e.core
          ? "#d4a6ff"
          : e.bomb
            ? "#ff7a6a"
            : e.heavy
              ? "#ffb36a"
              : "#7ad0ff";
        ctx.shadowBlur = 16;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }

    for (const b of state.bullets) {
      const trailColor = b.fever ? "#ffd36a" : "#9fe7ff";
      for (let i = 0; i < b.trail.length; i += 1) {
        const t = b.trail[i];
        if (t.life <= 0) continue;
        const a = t.life / 0.22;
        ctx.globalAlpha = a * 0.7;
        ctx.beginPath();
        ctx.arc(t.x, t.y, b.r * (0.4 + a * 0.6), 0, Math.PI * 2);
        ctx.fillStyle = trailColor;
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      ctx.shadowColor = trailColor;
      ctx.shadowBlur = b.fever ? 24 : 18;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 7, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.22)";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = b.fever ? "#ffe9a8" : "#ffffff";
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    drawAim();
    drawParticles();

    for (const f of state.floatTexts) {
      const a = Math.max(0, f.life / (f.maxLife || 0.7));
      ctx.globalAlpha = Math.min(1, a * 1.5);
      ctx.fillStyle = f.color;
      ctx.font = `800 ${f.size}px Orbitron, sans-serif`;
      ctx.textAlign = "center";
      ctx.shadowColor = f.color;
      ctx.shadowBlur = 10;
      ctx.fillText(f.text, f.x, f.y);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    if (state.flash > 0) {
      ctx.fillStyle = `rgba(${state.flashColor}, ${state.flash})`;
      ctx.fillRect(0, 0, state.w, state.h);
    }
  }

  function loop(ts) {
    if (!state.lastTs) state.lastTs = ts;
    let dt = (ts - state.lastTs) / 1000;
    state.lastTs = ts;
    dt = Math.min(0.033, dt);

    if (state.mode === "play") update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  // Input
  canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
  canvas.addEventListener("pointermove", onPointerMove, { passive: false });
  window.addEventListener("pointerup", onPointerUp, { passive: false });
  window.addEventListener("pointercancel", () => {
    state.aim = null;
  });

  document.getElementById("btn-normal").addEventListener("click", () => {
    audio.ensure();
    resetGame("normal");
  });
  document.getElementById("btn-extra").addEventListener("click", () => {
    audio.ensure();
    resetGame("extra");
  });
  document.getElementById("btn-retry").addEventListener("click", () => {
    audio.ensure();
    resetGame(state.difficulty);
  });
  document.getElementById("btn-title").addEventListener("click", () => {
    audio.ensure();
    goToTitle();
  });

  window.addEventListener("resize", resize);
  updateTitleHighScores();
  resize();
  requestAnimationFrame(loop);
})();
