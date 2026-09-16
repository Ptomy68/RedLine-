/* ==========================================================================
   REDLINE — ONE TOUCH
   Jeu HTML5 Canvas, une seule action, inspiré du principe "flap" mais avec
   une identité graphique moto sportive / racing nocturne.
   Aucune ressource, asset ou code tiers : tout est généré ici.
   ========================================================================== */

(function () {
  "use strict";

  /* ---------------------------------------------------------------------
     0. CANVAS & RESIZE
     --------------------------------------------------------------------- */
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  let dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  let W = 0, H = 0; // logical (CSS) size

  function resize() {
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", () => setTimeout(resize, 60));
  resize();

  /* Empêcher le scroll / zoom / sélection accidentels sur iPad */
  ["touchmove", "touchstart", "gesturestart", "gesturechange"].forEach((evt) => {
    document.addEventListener(evt, (e) => e.preventDefault(), { passive: false });
  });
  document.addEventListener("contextmenu", (e) => e.preventDefault());

  /* ---------------------------------------------------------------------
     1. CONSTANTES DE JEU
     --------------------------------------------------------------------- */
  const BEST_KEY = "redline_best_score";

  const BIKE_X_RATIO = 0.26;   // position horizontale fixe de la moto
  const BIKE_W = 68, BIKE_H = 34;

  const GRAVITY = 1900;         // px/s^2
  const FLAP_VELOCITY = -560;   // impulsion vers le haut (px/s)
  const MAX_FALL_SPEED = 900;
  const MAX_RISE_SPEED = -700;

  const PIPE_W = 84;
  const GAP_START = 250;
  const GAP_MIN = 168;
  const SPEED_START = 260;
  const SPEED_MAX = 480;
  const SPAWN_GAP_START = 1.55;  // secondes entre obstacles
  const SPAWN_GAP_MIN = 1.05;

  const RAMP_SCORE = 26; // score à partir duquel la difficulté max est atteinte

  /* ---------------------------------------------------------------------
     2. ETAT DU JEU
     --------------------------------------------------------------------- */
  let state = "start"; // "start" | "playing" | "gameover"
  let best = parseInt(localStorage.getItem(BEST_KEY) || "0", 10) || 0;

  let bike, obstacles, particles, trail, score, elapsed, spawnTimer, shake;

  function resetGame() {
    bike = {
      y: H / 2,
      vy: 0,
      rot: 0,
    };
    obstacles = [];
    particles = [];
    trail = [];
    score = 0;
    elapsed = 0;
    spawnTimer = 0;
    shake = 0;
  }
  resetGame();

  /* ---------------------------------------------------------------------
     3. DIFFICULTE PROGRESSIVE
     --------------------------------------------------------------------- */
  function difficultyT() {
    return Math.min(1, score / RAMP_SCORE);
  }
  function currentGap() {
    return GAP_START - (GAP_START - GAP_MIN) * difficultyT();
  }
  function currentSpeed() {
    return SPEED_START + (SPEED_MAX - SPEED_START) * difficultyT();
  }
  function currentSpawnGap() {
    return SPAWN_GAP_START - (SPAWN_GAP_START - SPAWN_GAP_MIN) * difficultyT();
  }

  /* ---------------------------------------------------------------------
     4. ENTREES : tactile / souris / clavier — UNE SEULE ACTION
     --------------------------------------------------------------------- */
  function onAction() {
    if (state === "start") {
      startGame();
    } else if (state === "playing") {
      flap();
    } else if (state === "gameover") {
      // redémarrage instantané : un seul toucher relance directement
      startGame();
    }
  }

  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    onAction();
  }, { passive: false });

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      onAction();
    }
  });

  function startGame() {
    resetGame();
    state = "playing";
    flap();
  }

  function flap() {
    bike.vy = FLAP_VELOCITY;
    haptic(10);
    playTone(520, 0.05, "square", 0.05);
    for (let i = 0; i < 6; i++) spawnParticle(true);
  }

  function haptic(ms) {
    if (navigator.vibrate) {
      try { navigator.vibrate(ms); } catch (e) { /* silencieux */ }
    }
  }

  /* ---------------------------------------------------------------------
     5. AUDIO — Web Audio API, léger, jamais obligatoire
     --------------------------------------------------------------------- */
  let actx = null;
  function ensureAudio() {
    if (!actx) {
      try {
        actx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) { actx = null; }
    }
    if (actx && actx.state === "suspended") actx.resume().catch(() => {});
  }
  window.addEventListener("pointerdown", ensureAudio, { once: true });
  window.addEventListener("keydown", ensureAudio, { once: true });

  function playTone(freq, dur, type, vol) {
    if (!actx) return;
    try {
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = type || "sine";
      o.frequency.value = freq;
      g.gain.value = vol != null ? vol : 0.08;
      o.connect(g);
      g.connect(actx.destination);
      const now = actx.currentTime;
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + dur);
      o.start(now);
      o.stop(now + dur);
    } catch (e) { /* silencieux */ }
  }
  function playCrash() {
    playTone(110, 0.35, "sawtooth", 0.12);
    playTone(70, 0.4, "square", 0.1);
  }
  function playScorePoint() {
    playTone(880, 0.08, "square", 0.05);
  }

  /* ---------------------------------------------------------------------
     6. OBSTACLES
     --------------------------------------------------------------------- */
  function spawnObstacle() {
    const gap = currentGap();
    const margin = 60;
    const minCenter = margin + gap / 2;
    const maxCenter = H - margin - gap / 2;
    const center = minCenter + Math.random() * Math.max(1, maxCenter - minCenter);
    obstacles.push({
      x: W + PIPE_W,
      gapCenter: center,
      gapSize: gap,
      passed: false,
    });
  }

  /* ---------------------------------------------------------------------
     7. PARTICULES (traînée + effets)
     --------------------------------------------------------------------- */
  function spawnParticle(burst) {
    const bx = W * BIKE_X_RATIO - BIKE_W * 0.4;
    particles.push({
      x: bx + (Math.random() - 0.5) * 10,
      y: bike.y + (Math.random() - 0.5) * 10,
      vx: -(140 + Math.random() * 140) - (burst ? 80 : 0),
      vy: (Math.random() - 0.5) * 90,
      life: 0.4 + Math.random() * 0.3,
      t: 0,
      r: 1.5 + Math.random() * 2.2,
    });
  }

  /* ---------------------------------------------------------------------
     8. BOUCLE DE JEU PRINCIPALE
     --------------------------------------------------------------------- */
  let lastTime = performance.now();

  function loop(now) {
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    dt = Math.min(dt, 0.033); // évite les gros sauts (retour d'onglet etc.)

    update(dt);
    draw();

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  function update(dt) {
    if (shake > 0) shake = Math.max(0, shake - dt * 3);

    if (state !== "playing") {
      // légère respiration de la moto sur l'écran d'accueil / game over
      bike.y = H / 2 + Math.sin(performance.now() / 500) * 14;
      updateParticles(dt);
      return;
    }

    elapsed += dt;

    // physique
    bike.vy += GRAVITY * dt;
    bike.vy = Math.max(MAX_RISE_SPEED, Math.min(MAX_FALL_SPEED, bike.vy));
    bike.y += bike.vy * dt;

    const targetRot = Math.max(-0.5, Math.min(0.9, bike.vy / 700));
    bike.rot += (targetRot - bike.rot) * Math.min(1, dt * 10);

    // traînée continue
    if (Math.random() < 0.7) spawnParticle(false);

    // sol / plafond
    if (bike.y - BIKE_H / 2 < 0) {
      bike.y = BIKE_H / 2;
      crash();
    } else if (bike.y + BIKE_H / 2 > H) {
      bike.y = H - BIKE_H / 2;
      crash();
    }

    // obstacles
    const speed = currentSpeed();
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnObstacle();
      spawnTimer = currentSpawnGap();
    }

    const bikeX = W * BIKE_X_RATIO;
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i];
      o.x -= speed * dt;

      // collision (AABB simplifiée sur le corps de la moto)
      const bLeft = bikeX - BIKE_W * 0.38;
      const bRight = bikeX + BIKE_W * 0.42;
      const bTop = bike.y - BIKE_H * 0.32;
      const bBottom = bike.y + BIKE_H * 0.32;

      const oLeft = o.x - PIPE_W / 2;
      const oRight = o.x + PIPE_W / 2;

      if (bRight > oLeft && bLeft < oRight) {
        const gapTop = o.gapCenter - o.gapSize / 2;
        const gapBottom = o.gapCenter + o.gapSize / 2;
        if (bTop < gapTop || bBottom > gapBottom) {
          crash();
        }
      }

      if (!o.passed && o.x + PIPE_W / 2 < bikeX - BIKE_W * 0.38) {
        o.passed = true;
        score++;
        flashScore();
        playScorePoint();
      }

      if (o.x < -PIPE_W) obstacles.splice(i, 1);
    }

    updateParticles(dt);
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.t += dt;
      if (p.t >= p.life) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  let scoreFlash = 0;
  function flashScore() { scoreFlash = 1; }

  function crash() {
    if (state !== "playing") return;
    state = "gameover";
    shake = 1;
    haptic([20, 30, 20]);
    playCrash();
    if (score > best) {
      best = score;
      try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* silencieux */ }
    }
  }

  /* ---------------------------------------------------------------------
     9. RENDU
     --------------------------------------------------------------------- */
  function draw() {
    ctx.save();
    if (shake > 0) {
      const s = shake * 8;
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }

    drawBackground();
    drawParticles();
    drawObstacles();
    drawBike();

    ctx.restore();

    drawUI(); // pas affecté par le shake
  }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0d0b0c");
    g.addColorStop(0.55, "#0a0808");
    g.addColorStop(1, "#050404");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // horizon lumineux très subtil
    const hz = ctx.createRadialGradient(W * 0.7, H * 0.35, 0, W * 0.7, H * 0.35, W * 0.6);
    hz.addColorStop(0, "rgba(120,10,14,0.10)");
    hz.addColorStop(1, "rgba(120,10,14,0)");
    ctx.fillStyle = hz;
    ctx.fillRect(0, 0, W, H);

    // lignes de vitesse
    const t = elapsed;
    ctx.strokeStyle = "rgba(255,255,255,0.035)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      const yy = (i / 7) * H + ((t * 40 * (i % 2 === 0 ? 1 : 1.4)) % 40);
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(W, yy - 6);
      ctx.stroke();
    }

    // grille mécanique très discrète au sol/plafond
    ctx.fillStyle = "rgba(200,20,24,0.05)";
    ctx.fillRect(0, 0, W, 3);
    ctx.fillRect(0, H - 3, W, 3);
  }

  function drawParticles() {
    for (const p of particles) {
      const a = 1 - p.t / p.life;
      ctx.beginPath();
      ctx.fillStyle = `rgba(230,30,30,${(a * 0.8).toFixed(3)})`;
      ctx.arc(p.x, p.y, p.r * a + 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawObstacles() {
    for (const o of obstacles) {
      const gapTop = o.gapCenter - o.gapSize / 2;
      const gapBottom = o.gapCenter + o.gapSize / 2;
      drawPipe(o.x - PIPE_W / 2, 0, PIPE_W, gapTop, true);
      drawPipe(o.x - PIPE_W / 2, gapBottom, PIPE_W, H - gapBottom, false);
    }
  }

  function drawPipe(x, y, w, h, facingDown) {
    if (h <= 0) return;
    const grad = ctx.createLinearGradient(x, 0, x + w, 0);
    grad.addColorStop(0, "#1a1414");
    grad.addColorStop(0.5, "#241717");
    grad.addColorStop(1, "#140f0f");
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);

    // bord accent rouge côté ouverture (près du gap)
    const edgeY = facingDown ? y + h - 4 : y;
    ctx.fillStyle = "#c81a1a";
    ctx.fillRect(x, edgeY, w, 4);
    ctx.fillStyle = "rgba(255,60,60,0.35)";
    ctx.fillRect(x, facingDown ? y + h - 10 : y + 4, w, 3);

    // détails mécaniques (rivets / plaques)
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    for (let ry = facingDown ? h - 30 : 30; ry >= 10 && ry <= h - 10; ry += 46) {
      const yy = y + ry;
      ctx.fillRect(x + 6, yy, w - 12, 10);
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.strokeRect(x + 6, yy, w - 12, 10);
    }
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fillRect(x, y, 2, h);
  }

  function drawBike() {
    const x = W * BIKE_X_RATIO;
    const y = bike.y;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(bike.rot * 0.5);

    // lueur / traînée lumineuse derrière la moto
    const trailGrad = ctx.createLinearGradient(-BIKE_W, 0, -6, 0);
    trailGrad.addColorStop(0, "rgba(220,20,20,0)");
    trailGrad.addColorStop(1, "rgba(255,60,60,0.55)");
    ctx.fillStyle = trailGrad;
    ctx.fillRect(-BIKE_W * 1.1, -3, BIKE_W * 0.7, 6);

    // ombre au sol (légère, fixe verticalement par rapport à la moto)
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(2, BIKE_H * 0.55, BIKE_W * 0.42, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // corps principal (silhouette sportive stylisée)
    ctx.fillStyle = "#171313";
    ctx.beginPath();
    ctx.moveTo(-BIKE_W * 0.46, 4);
    ctx.quadraticCurveTo(-BIKE_W * 0.5, -6, -BIKE_W * 0.2, -10);
    ctx.quadraticCurveTo(BIKE_W * 0.05, -14, BIKE_W * 0.3, -8);
    ctx.quadraticCurveTo(BIKE_W * 0.48, -4, BIKE_W * 0.46, 4);
    ctx.quadraticCurveTo(BIKE_W * 0.3, 10, 0, 8);
    ctx.quadraticCurveTo(-BIKE_W * 0.3, 10, -BIKE_W * 0.46, 4);
    ctx.closePath();
    ctx.fill();

    // bande rouge vif — accent racing
    ctx.fillStyle = "#e2131a";
    ctx.beginPath();
    ctx.moveTo(-BIKE_W * 0.18, -9);
    ctx.quadraticCurveTo(BIKE_W * 0.05, -12, BIKE_W * 0.28, -6);
    ctx.lineTo(BIKE_W * 0.24, -1);
    ctx.quadraticCurveTo(BIKE_W * 0.02, -7, -BIKE_W * 0.16, -3);
    ctx.closePath();
    ctx.fill();

    // carénage avant / bulle
    ctx.fillStyle = "#0d0a0a";
    ctx.beginPath();
    ctx.ellipse(BIKE_W * 0.38, -2, 8, 6, -0.3, 0, Math.PI * 2);
    ctx.fill();

    // phare
    ctx.fillStyle = "#ffdede";
    ctx.beginPath();
    ctx.ellipse(BIKE_W * 0.45, -2, 2.6, 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // roues
    ctx.fillStyle = "#050404";
    ctx.beginPath();
    ctx.arc(-BIKE_W * 0.32, BIKE_H * 0.42, 8, 0, Math.PI * 2);
    ctx.arc(BIKE_W * 0.34, BIKE_H * 0.42, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#3a2020";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(-BIKE_W * 0.32, BIKE_H * 0.42, 8, 0, Math.PI * 2);
    ctx.arc(BIKE_W * 0.34, BIKE_H * 0.42, 8, 0, Math.PI * 2);
    ctx.stroke();

    // moyeux
    ctx.fillStyle = "#c81a1a";
    ctx.beginPath();
    ctx.arc(-BIKE_W * 0.32, BIKE_H * 0.42, 2.4, 0, Math.PI * 2);
    ctx.arc(BIKE_W * 0.34, BIKE_H * 0.42, 2.4, 0, Math.PI * 2);
    ctx.fill();

    // silhouette du pilote
    ctx.fillStyle = "#0d0a0a";
    ctx.beginPath();
    ctx.ellipse(-BIKE_W * 0.02, -18, 6, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-BIKE_W * 0.08, -16, 10, 14);

    ctx.restore();
  }

  /* ---------------------------------------------------------------------
     10. INTERFACE (texte, score, écrans)
     --------------------------------------------------------------------- */
  function drawUI() {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    if (state === "playing") {
      if (scoreFlash > 0) {
        ctx.fillStyle = `rgba(255,40,40,${(scoreFlash * 0.15).toFixed(3)})`;
        ctx.fillRect(0, 0, W, H);
        scoreFlash = Math.max(0, scoreFlash - 0.06);
      }
      drawScoreHUD();
    } else if (state === "start") {
      drawStartScreen();
    } else if (state === "gameover") {
      drawScoreHUD();
      drawGameOverScreen();
    }

    ctx.restore();
  }

  function drawScoreHUD() {
    ctx.fillStyle = "#f2e9e9";
    ctx.font = `700 ${Math.round(H * 0.07)}px -apple-system, system-ui, sans-serif`;
    ctx.shadowColor = "rgba(200,20,20,0.5)";
    ctx.shadowBlur = 14;
    ctx.fillText(String(score), W / 2, H * 0.12);
    ctx.shadowBlur = 0;

    ctx.fillStyle = "rgba(240,220,220,0.45)";
    ctx.font = `600 ${Math.round(H * 0.028)}px -apple-system, system-ui, sans-serif`;
    ctx.fillText(`BEST ${best}`, W / 2, H * 0.2);
  }

  function drawStartScreen() {
    ctx.fillStyle = "rgba(5,3,3,0.35)";
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "#f4eaea";
    ctx.font = `800 ${Math.round(H * 0.12)}px -apple-system, system-ui, sans-serif`;
    ctx.shadowColor = "rgba(210,20,20,0.55)";
    ctx.shadowBlur = 20;
    ctx.fillText("REDLINE", W / 2, H * 0.32);
    ctx.shadowBlur = 0;

    ctx.fillStyle = "#e2131a";
    ctx.font = `700 ${Math.round(H * 0.032)}px -apple-system, system-ui, sans-serif`;
    ctx.save();
    ctx.translate(W / 2, H * 0.32 + H * 0.075);
    ctx.scale(1, 1);
    ctx.fillText(spaced("ONE TOUCH"), 0, 0);
    ctx.restore();

    const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 350);
    ctx.fillStyle = `rgba(244,234,234,${pulse.toFixed(3)})`;
    ctx.font = `600 ${Math.round(H * 0.04)}px -apple-system, system-ui, sans-serif`;
    ctx.fillText("TAP TO RIDE", W / 2, H * 0.62);

    if (best > 0) {
      ctx.fillStyle = "rgba(240,220,220,0.4)";
      ctx.font = `500 ${Math.round(H * 0.026)}px -apple-system, system-ui, sans-serif`;
      ctx.fillText(`BEST ${best}`, W / 2, H * 0.7);
    }
  }

  function drawGameOverScreen() {
    ctx.fillStyle = "rgba(5,2,2,0.55)";
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "#f4eaea";
    ctx.font = `800 ${Math.round(H * 0.1)}px -apple-system, system-ui, sans-serif`;
    ctx.shadowColor = "rgba(210,20,20,0.55)";
    ctx.shadowBlur = 18;
    ctx.fillText("CRASH", W / 2, H * 0.36);
    ctx.shadowBlur = 0;

    ctx.fillStyle = "rgba(244,234,234,0.85)";
    ctx.font = `700 ${Math.round(H * 0.036)}px -apple-system, system-ui, sans-serif`;
    ctx.fillText(`SCORE : ${score}`, W / 2, H * 0.48);
    ctx.fillText(`BEST : ${best}`, W / 2, H * 0.55);

    const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 350);
    ctx.fillStyle = `rgba(226,19,26,${pulse.toFixed(3)})`;
    ctx.font = `700 ${Math.round(H * 0.034)}px -apple-system, system-ui, sans-serif`;
    ctx.fillText("TAP TO RESTART", W / 2, H * 0.68);
  }

  function spaced(s) {
    return s.split("").join(String.fromCharCode(8202) + String.fromCharCode(8202));
  }
})();
