// ============================================================
// Audio procedural con WebAudio — sin ficheros externos:
//  · Motor: 2 osciladores (base + armónico) + ruido filtrado,
//    tono ligado a las RPM reales de la marcha actual.
//  · Cambio de marcha: "clac" de golpe de compresión.
//  · Semáforo: beep por luz + tono grave al apagarse.
//  · Colisión: golpe grave + chirrido metálico.
//  · Vuelta rápida: arpegio corto.
// ============================================================

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engine = null;
    this.volume = 0.7;   // 0..1 (ajustable en pausa)
    this.enabled = true;
    this.started = false;
  }

  // Debe llamarse desde un gesto del usuario (clic en el menú)
  start() {
    if (this.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume * 0.5;
    this.master.connect(this.ctx.destination);
    this.started = true;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v * 0.5;
  }

  // ---- Motor ----
  startEngine() {
    if (!this.started || this.engine) return;
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.0;
    out.connect(this.master);

    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 1400;
    filt.Q.value = 2;
    const noise = ctx.createBufferSource();
    const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noise.buffer = nb;
    noise.loop = true;
    const nGain = ctx.createGain();
    nGain.gain.value = 0.05;
    const nFilt = ctx.createBiquadFilter();
    nFilt.type = 'bandpass';
    nFilt.frequency.value = 900;
    nFilt.Q.value = 0.8;
    osc1.connect(filt); osc2.connect(g2); g2.connect(filt);
    noise.connect(nFilt); nFilt.connect(nGain); nGain.connect(out);
    filt.connect(out);
    osc1.start(); osc2.start(); noise.start();
    this.engine = { out, osc1, osc2, filt, nGain };
  }

  stopEngine() {
    if (!this.engine) return;
    const t = this.ctx.currentTime;
    this.engine.out.gain.linearRampToValueAtTime(0, t + 0.15);
    const e = this.engine;
    setTimeout(() => { try { e.osc1.stop(); e.osc2.stop(); } catch (_) {} }, 300);
    this.engine = null;
  }

  // revs 0..1 (fracción de la marcha actual), load 0..1 (gas), vols separados
  updateEngine(revs, load, on) {
    if (!this.engine || !this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 38 + revs * 300;                 // 38 Hz parado → 338 Hz al corte
    const e = this.engine;
    e.osc1.frequency.setTargetAtTime(f, t, 0.03);
    e.osc2.frequency.setTargetAtTime(f * 1.5, t, 0.03);
    e.filt.frequency.setTargetAtTime(500 + revs * 2600 + load * 700, t, 0.05);
    e.nGain.gain.setTargetAtTime(0.02 + load * 0.06 + revs * 0.03, t, 0.08);
    const vol = on ? (0.10 + load * 0.16 + revs * 0.10) : 0.0;
    e.out.gain.setTargetAtTime(vol, t, 0.06);
  }

  // ---- Efectos ----
  _blip(freq, dur, type = 'square', gain = 0.3, when = 0) {
    if (!this.started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  lightBeep() { this._blip(880, 0.18, 'square', 0.35); }
  lightsGo() {
    this._blip(660, 0.4, 'sawtooth', 0.4);
    this._blip(440, 0.6, 'sawtooth', 0.3, 0.05);
  }

  shiftGear() {
    if (!this.started) return;
    // Golpe seco: ruido corto + caída de tono
    this._blip(140, 0.06, 'square', 0.22);
    this._blip(90, 0.09, 'triangle', 0.18, 0.015);
  }

  crash(intensity = 1) {
    if (!this.started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.7, 0.25 * intensity), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    const src = ctx.createBufferSource();
    const b = ctx.createBuffer(1, ctx.sampleRate * 0.35, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    src.buffer = b;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(150, t + 0.3);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
    // chirrido metálico
    this._blip(2200 + Math.random() * 800, 0.12, 'sawtooth', 0.06 * intensity);
  }

  fastLap() {
    [523, 659, 784, 1047].forEach((f, i) => this._blip(f, 0.14, 'triangle', 0.22, i * 0.09));
  }

  sectorFestival(best) {
    this._blip(best ? 784 : 523, 0.1, 'triangle', 0.2);
    this._blip(best ? 1047 : 659, 0.12, 'triangle', 0.2, 0.08);
  }

  countdown() { this._blip(440, 0.1, 'square', 0.15); }
}
