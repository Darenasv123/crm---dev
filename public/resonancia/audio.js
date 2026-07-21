/**
 * RESONANCIA — Audio engine (procedural Web Audio)
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
  }

  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
  }

  resume() {
    if (this.ctx?.state === "suspended") this.ctx.resume();
  }

  tone(freq, dur, type = "sine", vol = 0.3, slide = 0) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  move() {
    this.tone(440 + Math.random() * 80, 0.08, "sine", 0.15);
  }

  echoSpawn() {
    this.tone(220, 0.3, "triangle", 0.25, 880);
    setTimeout(() => this.tone(660, 0.2, "sine", 0.2), 100);
  }

  switchOn() {
    this.tone(523, 0.15, "square", 0.12);
  }

  death() {
    this.tone(180, 0.5, "sawtooth", 0.3, 60);
  }

  win() {
    [523, 659, 784, 1047].forEach((f, i) =>
      setTimeout(() => this.tone(f, 0.25, "sine", 0.25), i * 120),
    );
  }

  levelComplete() {
    [440, 554, 659].forEach((f, i) =>
      setTimeout(() => this.tone(f, 0.2, "triangle", 0.2), i * 100),
    );
  }

  menuHover() {
    this.tone(330, 0.05, "sine", 0.08);
  }
}
