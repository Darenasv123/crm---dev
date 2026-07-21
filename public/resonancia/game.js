import { LEVELS } from "./levels.js";
import { AudioEngine } from "./audio.js";

const TILE = 48;
const COLORS = {
  bg: "#0a0a12",
  grid: "#12121f",
  wall: "#1a1a2e",
  wallEdge: "#2d2d5a",
  player: "#00f5ff",
  playerGlow: "rgba(0,245,255,0.4)",
  echo: "#ff2d95",
  echoGlow: "rgba(255,45,149,0.35)",
  goal: "#ffe566",
  goalGlow: "rgba(255,229,102,0.5)",
  switch: "#7b68ee",
  switchOn: "#a78bfa",
  door: "#4a4a6a",
  doorOpen: "rgba(74,74,106,0.2)",
  laser: "#ff3355",
  laserGlow: "rgba(255,51,85,0.6)",
  spike: "#ff6b35",
  text: "#e8e8f0",
  textDim: "#8888aa",
  accent: "#00f5ff",
};

const DIR = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

class Particle {
  constructor(x, y, color, vx, vy, life) {
    this.x = x;
    this.y = y;
    this.color = color;
    this.vx = vx;
    this.vy = vy;
    this.life = life;
    this.maxLife = life;
    this.size = 2 + Math.random() * 3;
  }
  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    this.vy += 20 * dt;
  }
  draw(ctx) {
    const a = Math.max(0, this.life / this.maxLife);
    ctx.globalAlpha = a;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size * a, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

class ResonanciaGame {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.audio = new AudioEngine();
    this.state = "menu";
    this.levelIndex = 0;
    this.moveCount = 0;
    this.totalMoves = 0;
    this.particles = [];
    this.shake = 0;
    this.flash = 0;
    this.time = 0;
    this.menuPulse = 0;
    this.transition = 0;
    this.transitionTarget = null;
    this.keys = new Set();
    this.lastInput = 0;
    this.inputCooldown = 0;
    this.completedLevels = JSON.parse(localStorage.getItem("resonancia-progress") || "[]");

    this.resize();
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("keydown", (e) => this.onKey(e, true));
    window.addEventListener("keyup", (e) => this.onKey(e, false));
    this.setupTouch();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.min(window.innerWidth, 960);
    const h = Math.min(window.innerHeight, 640);
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.displayW = w;
    this.displayH = h;
  }

  setupTouch() {
    const pad = document.getElementById("touch-pad");
    if (!pad) return;
    pad.querySelectorAll("[data-dir]").forEach((btn) => {
      const dir = btn.dataset.dir;
      const press = (e) => {
        e.preventDefault();
        this.handleMove(dir);
      };
      btn.addEventListener("touchstart", press, { passive: false });
      btn.addEventListener("mousedown", press);
    });
    document.getElementById("btn-restart")?.addEventListener("click", () => this.restartLevel());
    document.getElementById("btn-wait")?.addEventListener("click", () => this.handleMove("wait"));
  }

  onKey(e, down) {
    if (down) {
      this.audio.resume();
      const key = e.key.toLowerCase();
      this.keys.add(key);
      if (
        ["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d", " "].includes(key)
      ) {
        e.preventDefault();
      }
      if (this.state === "menu" && (e.key === "Enter" || e.key === " ")) {
        this.startGame();
        return;
      }
      if (this.state === "level_complete" && e.key === "Enter") {
        this.nextLevel();
        return;
      }
      if (this.state === "victory" && e.key === "Enter") {
        this.state = "menu";
        return;
      }
      if (key === "r") {
        this.restartLevel();
        return;
      }
      const moveMap = {
        arrowup: "up",
        w: "up",
        arrowdown: "down",
        s: "down",
        arrowleft: "left",
        a: "left",
        arrowright: "right",
        d: "right",
      };
      if (moveMap[key]) {
        this.handleMove(moveMap[key]);
      }
    } else {
      this.keys.delete(e.key.toLowerCase());
    }
  }

  startGame() {
    this.audio.init();
    this.audio.resume();
    this.levelIndex = 0;
    this.totalMoves = 0;
    this.loadLevel(0);
    this.state = "playing";
  }

  loadLevel(idx) {
    const def = LEVELS[idx];
    this.levelDef = def;
    this.moveCount = 0;
    this.recording = [];
    this.echoes = [];
    this.player = { ...def.start };
    this.parseLevel(def);
    this.state = "playing";
  }

  parseLevel(def) {
    this.walls = new Set();
    this.switches = (def.switches || []).map((s) => ({ ...s, active: false }));
    this.doors = (def.doors || []).map((d) => ({ ...d, open: false, tiles: [] }));
    this.lasers = def.lasers || [];
    this.spikes = new Set((def.spikes || []).map((s) => `${s.x},${s.y}`));
    this.goal = def.goal || this.findGoal(def);

    for (let y = 0; y < def.height; y++) {
      for (let x = 0; x < def.width; x++) {
        const ch = def.map[y][x];
        if (ch === "#") this.walls.add(`${x},${y}`);
      }
    }

    for (const door of this.doors) {
      for (let i = 0; i < door.length; i++) {
        const dx = door.orient === "h" ? door.x + i : door.x;
        const dy = door.orient === "v" ? door.y + i : door.y;
        door.tiles.push({ x: dx, y: dy });
      }
    }
  }

  findGoal(def) {
    for (let y = 0; y < def.height; y++) {
      for (let x = 0; x < def.width; x++) {
        if (def.map[y][x] === "G") return { x, y };
      }
    }
    return { x: def.width - 2, y: Math.floor(def.height / 2) };
  }

  restartLevel() {
    if (this.state === "menu") return;
    this.loadLevel(this.levelIndex);
    this.spawnParticles(
      this.player.x * TILE + TILE / 2,
      this.player.y * TILE + TILE / 2,
      COLORS.accent,
      8,
    );
  }

  nextLevel() {
    if (!this.completedLevels.includes(this.levelIndex)) {
      this.completedLevels.push(this.levelIndex);
      localStorage.setItem("resonancia-progress", JSON.stringify(this.completedLevels));
    }
    if (this.levelIndex < LEVELS.length - 1) {
      this.transition = 1;
      this.transitionTarget = this.levelIndex + 1;
    } else {
      this.state = "victory";
      this.audio.win();
    }
  }

  isWall(x, y) {
    if (x < 0 || y < 0 || x >= this.levelDef.width || y >= this.levelDef.height) return true;
    if (this.walls.has(`${x},${y}`)) return true;
    for (const door of this.doors) {
      if (!door.open && door.tiles.some((t) => t.x === x && t.y === y)) return true;
    }
    return false;
  }

  getEntitiesAt(x, y) {
    const entities = [];
    if (this.player.x === x && this.player.y === y) entities.push("player");
    for (const echo of this.echoes) {
      const pos = echo.path[echo.index];
      if (pos && pos.x === x && pos.y === y) entities.push("echo");
    }
    return entities;
  }

  updateSwitches() {
    for (const sw of this.switches) {
      const ents = this.getEntitiesAt(sw.x, sw.y);
      const was = sw.active;
      sw.active = ents.length > 0;
      if (!was && sw.active) this.audio.switchOn();
    }
    for (const door of this.doors) {
      const sw = this.switches.find((s) => s.id === door.id);
      door.open = sw?.active ?? false;
    }
  }

  handleMove(direction) {
    if (this.state !== "playing" || this.inputCooldown > 0) return;
    this.audio.init();
    this.audio.resume();

    if (direction === "wait") {
      this.advanceTurn(this.player.x, this.player.y);
      return;
    }

    const d = DIR[direction];
    if (!d) return;
    const nx = this.player.x + d.x;
    const ny = this.player.y + d.y;
    if (this.isWall(nx, ny)) {
      this.shake = 0.15;
      return;
    }
    this.player.x = nx;
    this.player.y = ny;
    this.audio.move();
    this.spawnParticles(nx * TILE + TILE / 2, ny * TILE + TILE / 2, COLORS.player, 4);
    this.advanceTurn(nx, ny);
  }

  advanceTurn(px, py) {
    this.moveCount++;
    this.totalMoves++;
    this.inputCooldown = 0.12;

    if (this.levelDef.echoLength > 0) {
      this.recording.push({ x: px, y: py });
      if (this.recording.length >= this.levelDef.echoLength) {
        const path = this.recording.splice(0, this.levelDef.echoLength);
        this.echoes.push({ path, index: 0 });
        this.audio.echoSpawn();
        this.spawnParticles(px * TILE + TILE / 2, py * TILE + TILE / 2, COLORS.echo, 16);
      }
    }

    for (const echo of this.echoes) {
      echo.index = (echo.index + 1) % echo.path.length;
    }

    this.updateSwitches();
    this.checkHazards();
    this.checkWin();
  }

  checkHazards() {
    const px = this.player.x;
    const py = this.player.y;

    if (this.spikes.has(`${px},${py}`)) {
      this.die();
      return;
    }

    for (const laser of this.lasers) {
      const tiles = this.getLaserTiles(laser);
      if (!tiles.some((t) => t.x === px && t.y === py)) continue;
      const blocked = this.echoes.some((echo) => {
        const pos = echo.path[echo.index];
        return pos && tiles.some((t) => t.x === pos.x && t.y === pos.y);
      });
      if (!blocked) this.die();
    }
  }

  getLaserTiles(laser) {
    const tiles = [];
    for (let i = 0; i < laser.length; i++) {
      tiles.push({
        x: laser.dir === "h" ? laser.x + i : laser.x,
        y: laser.dir === "v" ? laser.y + i : laser.y,
      });
    }
    return tiles;
  }

  die() {
    this.state = "dead";
    this.shake = 0.4;
    this.flash = 0.3;
    this.audio.death();
    this.spawnParticles(
      this.player.x * TILE + TILE / 2,
      this.player.y * TILE + TILE / 2,
      COLORS.laser,
      24,
    );
    setTimeout(() => {
      if (this.state === "dead") this.restartLevel();
    }, 900);
  }

  checkWin() {
    if (this.player.x === this.goal.x && this.player.y === this.goal.y) {
      this.state = "level_complete";
      this.audio.levelComplete();
      this.spawnParticles(
        this.goal.x * TILE + TILE / 2,
        this.goal.y * TILE + TILE / 2,
        COLORS.goal,
        32,
      );
    }
  }

  spawnParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 120;
      this.particles.push(
        new Particle(
          x,
          y,
          color,
          Math.cos(angle) * speed,
          Math.sin(angle) * speed,
          0.4 + Math.random() * 0.4,
        ),
      );
    }
  }

  processInput(dt) {
    this.inputCooldown = Math.max(0, this.inputCooldown - dt);
  }

  loop(ts) {
    const dt = Math.min((ts - (this.lastTs || ts)) / 1000, 0.05);
    this.lastTs = ts;
    this.time += dt;
    this.menuPulse += dt;

    if (this.transition > 0) {
      this.transition -= dt * 1.5;
      if (this.transition <= 0 && this.transitionTarget !== null) {
        this.loadLevel(this.transitionTarget);
        this.transitionTarget = null;
      }
    }

    this.processInput(dt);
    this.particles = this.particles.filter((p) => p.life > 0);
    this.particles.forEach((p) => p.update(dt));
    if (this.shake > 0) this.shake -= dt;
    if (this.flash > 0) this.flash -= dt;

    this.draw();
    requestAnimationFrame(this.loop);
  }

  draw() {
    const { ctx, displayW: W, displayH: H } = this;
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);

    if (this.state === "menu") {
      this.drawMenu();
      return;
    }

    let ox = 0,
      oy = 0;
    if (this.shake > 0) {
      ox = (Math.random() - 0.5) * this.shake * 20;
      oy = (Math.random() - 0.5) * this.shake * 20;
    }

    if (this.transition > 0) {
      ctx.fillStyle = `rgba(0,0,0,${this.transition})`;
      ctx.fillRect(0, 0, W, H);
    }

    ctx.save();
    ctx.translate(ox, oy);

    const def = this.levelDef;
    const mapW = def.width * TILE;
    const mapH = def.height * TILE;
    const offsetX = (W - mapW) / 2;
    const offsetY = (H - mapH) / 2 + 20;

    ctx.translate(offsetX, offsetY);
    this.drawLevel(mapW, mapH);
    ctx.restore();

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,50,80,${this.flash})`;
      ctx.fillRect(0, 0, W, H);
    }

    this.particles.forEach((p) => p.draw(ctx));
    this.drawHUD();

    if (this.state === "level_complete")
      this.drawOverlay("NIVEL COMPLETADO", "Enter para continuar", COLORS.goal);
    if (this.state === "victory") this.drawVictory();
    if (this.state === "dead") this.drawOverlay("RESONANCIA ROTA", "Reiniciando...", COLORS.laser);
  }

  drawLevel(mapW, mapH) {
    const { ctx, levelDef: def } = this;

    for (let y = 0; y < def.height; y++) {
      for (let x = 0; x < def.width; x++) {
        const px = x * TILE;
        const py = y * TILE;
        ctx.fillStyle = (x + y) % 2 === 0 ? COLORS.grid : COLORS.bg;
        ctx.fillRect(px, py, TILE, TILE);
      }
    }

    for (const key of this.walls) {
      const [x, y] = key.split(",").map(Number);
      this.drawWall(x, y);
    }

    for (const door of this.doors) {
      if (!door.open) {
        for (const t of door.tiles) this.drawWall(t.x, t.y, true);
      }
    }

    for (const sw of this.switches) this.drawSwitch(sw);
    for (const laser of this.lasers) this.drawLaser(laser);
    for (const key of this.spikes) {
      const [x, y] = key.split(",").map(Number);
      this.drawSpike(x, y);
    }

    this.drawGoal();
    for (const echo of this.echoes) this.drawEcho(echo);
    this.drawPlayer();
  }

  drawWall(x, y, isDoor = false) {
    const { ctx } = this;
    const px = x * TILE;
    const py = y * TILE;
    ctx.fillStyle = isDoor ? COLORS.door : COLORS.wall;
    ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
    ctx.strokeStyle = isDoor ? "#6a6a8a" : COLORS.wallEdge;
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 2, py + 2, TILE - 4, TILE - 4);
  }

  drawSwitch(sw) {
    const { ctx } = this;
    const cx = sw.x * TILE + TILE / 2;
    const cy = sw.y * TILE + TILE / 2;
    const r = sw.active ? 14 : 10;
    ctx.shadowColor = sw.active ? COLORS.switchOn : COLORS.switch;
    ctx.shadowBlur = sw.active ? 20 : 8;
    ctx.fillStyle = sw.active ? COLORS.switchOn : COLORS.switch;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    if (sw.active) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 4 + Math.sin(this.time * 4) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawLaser(laser) {
    const { ctx } = this;
    const tiles = this.getLaserTiles(laser);
    const pulse = 0.6 + Math.sin(this.time * 8) * 0.4;
    ctx.shadowColor = COLORS.laserGlow;
    ctx.shadowBlur = 15;
    for (const t of tiles) {
      const px = t.x * TILE + 6;
      const py = t.y * TILE + TILE / 2 - 3;
      ctx.fillStyle = `rgba(255,51,85,${pulse})`;
      if (laser.dir === "h") {
        ctx.fillRect(px, py, TILE - 12, 6);
      } else {
        ctx.fillRect(t.x * TILE + TILE / 2 - 3, t.y * TILE + 6, 6, TILE - 12);
      }
    }
    ctx.shadowBlur = 0;
  }

  drawSpike(x, y) {
    const { ctx } = this;
    const cx = x * TILE + TILE / 2;
    const cy = y * TILE + TILE / 2;
    ctx.fillStyle = COLORS.spike;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 === 0 ? 14 : 6;
      const px = cx + Math.cos(angle) * r;
      const py = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  drawGoal() {
    const { ctx, goal } = this;
    const cx = goal.x * TILE + TILE / 2;
    const cy = goal.y * TILE + TILE / 2;
    const pulse = 16 + Math.sin(this.time * 3) * 4;
    ctx.shadowColor = COLORS.goalGlow;
    ctx.shadowBlur = 25;
    ctx.fillStyle = COLORS.goal;
    ctx.beginPath();
    ctx.arc(cx, cy, pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(255,229,102,${0.4 + Math.sin(this.time * 5) * 0.3})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, pulse + 8, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawPlayer() {
    const { ctx, player } = this;
    const cx = player.x * TILE + TILE / 2;
    const cy = player.y * TILE + TILE / 2;
    ctx.shadowColor = COLORS.playerGlow;
    ctx.shadowBlur = 20;
    ctx.fillStyle = COLORS.player;
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  drawEcho(echo) {
    const { ctx } = this;
    const pos = echo.path[echo.index];
    if (!pos) return;
    const cx = pos.x * TILE + TILE / 2;
    const cy = pos.y * TILE + TILE / 2;
    const trail = 0.3 + Math.sin(this.time * 6 + echo.index) * 0.15;
    ctx.globalAlpha = trail;
    ctx.shadowColor = COLORS.echoGlow;
    ctx.shadowBlur = 18;
    ctx.fillStyle = COLORS.echo;
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    ctx.strokeStyle = COLORS.echo;
    ctx.globalAlpha = 0.15;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < echo.path.length; i++) {
      const p = echo.path[(echo.index + i) % echo.path.length];
      const px = p.x * TILE + TILE / 2;
      const py = p.y * TILE + TILE / 2;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  drawHUD() {
    const { ctx, displayW: W } = this;
    const def = this.levelDef;

    ctx.fillStyle = COLORS.text;
    ctx.font = "bold 16px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`◈ ${def.name}`, 16, 28);

    ctx.fillStyle = COLORS.textDim;
    ctx.font = "13px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(`Movimientos: ${this.moveCount}`, 16, 48);

    if (def.echoLength > 0) {
      const progress = this.recording.length / def.echoLength;
      const barW = 120;
      const barX = 16;
      const barY = 56;
      ctx.fillStyle = "#222";
      ctx.fillRect(barX, barY, barW, 6);
      ctx.fillStyle = COLORS.echo;
      ctx.fillRect(barX, barY, barW * progress, 6);
      ctx.fillStyle = COLORS.textDim;
      ctx.font = "11px 'Segoe UI', system-ui, sans-serif";
      ctx.fillText(`Eco ${this.recording.length}/${def.echoLength}`, barX, 72);
    }

    ctx.textAlign = "right";
    ctx.fillStyle = COLORS.textDim;
    ctx.font = "12px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(`Nivel ${this.levelIndex + 1}/${LEVELS.length}  ·  R reiniciar`, W - 16, 28);

    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.textDim;
    ctx.font = "italic 12px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(def.hint, W / 2, this.displayH - 12);
  }

  drawOverlay(title, subtitle, color) {
    const { ctx, displayW: W, displayH: H } = this;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.fillStyle = color;
    ctx.font = "bold 32px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(title, W / 2, H / 2 - 10);
    ctx.fillStyle = COLORS.textDim;
    ctx.font = "16px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(subtitle, W / 2, H / 2 + 24);
  }

  drawVictory() {
    const { ctx, displayW: W, displayH: H, totalMoves } = this;
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(0, 0, W, H);

    const grad = ctx.createLinearGradient(0, H / 2 - 60, 0, H / 2 + 60);
    grad.addColorStop(0, COLORS.player);
    grad.addColorStop(0.5, COLORS.goal);
    grad.addColorStop(1, COLORS.echo);
    ctx.fillStyle = grad;
    ctx.font = "bold 36px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("RESONANCIA COMPLETA", W / 2, H / 2 - 30);

    ctx.fillStyle = COLORS.text;
    ctx.font = "18px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(`Completaste todos los niveles en ${totalMoves} movimientos`, W / 2, H / 2 + 10);

    ctx.fillStyle = COLORS.textDim;
    ctx.font = "14px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText("Enter para volver al menú", W / 2, H / 2 + 44);
  }

  drawMenu() {
    const { ctx, displayW: W, displayH: H, menuPulse: t, completedLevels } = this;

    for (let i = 0; i < 40; i++) {
      const x = (Math.sin(t * 0.3 + i * 1.7) * 0.5 + 0.5) * W;
      const y = (Math.cos(t * 0.2 + i * 2.3) * 0.5 + 0.5) * H;
      const r = 2 + Math.sin(t + i) * 1.5;
      ctx.globalAlpha = 0.15 + Math.sin(t * 2 + i) * 0.1;
      ctx.fillStyle = i % 2 === 0 ? COLORS.player : COLORS.echo;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.textAlign = "center";
    const titleGrad = ctx.createLinearGradient(W / 2 - 150, 0, W / 2 + 150, 0);
    titleGrad.addColorStop(0, COLORS.player);
    titleGrad.addColorStop(0.5, "#fff");
    titleGrad.addColorStop(1, COLORS.echo);
    ctx.fillStyle = titleGrad;
    ctx.font = "bold 56px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText("RESONANCIA", W / 2, H / 2 - 80);

    ctx.fillStyle = COLORS.textDim;
    ctx.font = "16px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText("Un puzzle donde tus movimientos pasados cobran vida", W / 2, H / 2 - 40);

    const pulse = 0.7 + Math.sin(t * 3) * 0.3;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = COLORS.accent;
    ctx.font = "bold 20px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText("▶  ENTER para jugar", W / 2, H / 2 + 20);
    ctx.globalAlpha = 1;

    ctx.fillStyle = COLORS.textDim;
    ctx.font = "13px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText("WASD / Flechas mover  ·  R reiniciar  ·  6 niveles", W / 2, H / 2 + 60);

    if (completedLevels.length > 0) {
      ctx.fillStyle = COLORS.goal;
      ctx.fillText(
        `Progreso: ${completedLevels.length}/${LEVELS.length} niveles`,
        W / 2,
        H / 2 + 90,
      );
    }

    ctx.fillStyle = "#444";
    ctx.font = "11px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText("— el mejor juego de la historia, según nosotros —", W / 2, H - 24);
  }
}

const canvas = document.getElementById("game");
new ResonanciaGame(canvas);
