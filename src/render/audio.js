// Procedural WebAudio SFX — every sound is synthesized, no audio assets.
// Positional: sounds with a world position get stereo pan (by angle to the
// camera) and distance attenuation. unlock() must run inside a user gesture.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.ambientNodes = null;
    this.ambientKind = null;
  }

  unlock() {
    if (this.ctx) { this.ctx.resume(); return; }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.4;
    this.master.connect(this.ctx.destination);

    const len = this.ctx.sampleRate * 0.5;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    if (this.ambientKind) this.setAmbient(this.ambientKind); // deferred start
  }

  setListener(pos, yaw) {
    this.listener = { ...pos, yaw };
  }

  // pan + gain for a world position; null pos = UI/self sound (center, full)
  _spatial(pos, base = 1) {
    if (!this.ctx) return null;
    let pan = 0, gain = base;
    if (pos) {
      const dx = pos.x - this.listener.x;
      const dz = pos.z - this.listener.z;
      const dist = Math.hypot(dx, dz, (pos.y || 0) - this.listener.y);
      const ang = Math.atan2(-dx, -dz) - this.listener.yaw; // relative bearing
      pan = Math.max(-1, Math.min(1, -Math.sin(ang)));
      gain = base / (1 + dist * 0.09);
      if (dist > 45) gain *= 0.3;
    }
    const g = this.ctx.createGain();
    g.gain.value = gain;
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p).connect(this.master);
    return g;
  }

  _noise(out, dur, freq, q, gain, decay, type = 'bandpass') {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    filt.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    src.connect(filt).connect(g).connect(out);
    src.start(t, Math.random() * 0.2);
    src.stop(t + dur);
  }

  _tone(out, type, f0, f1, gain, dur) {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur);
  }

  // ---------- weapons ----------
  _shotInto(out, id, loud = 1) {
    if (id === 'dmr') {
      this._noise(out, 0.3, 900, 0.7, 0.9 * loud, 0.22);
      this._tone(out, 'triangle', 160, 40, 0.8 * loud, 0.18);
    } else if (id === 'smg') {
      this._noise(out, 0.12, 1800, 0.9, 0.5 * loud, 0.07);
      this._tone(out, 'triangle', 220, 70, 0.35 * loud, 0.06);
    } else if (id === 'shotgun') {
      this._noise(out, 0.4, 500, 0.5, 1.1 * loud, 0.3);
      this._noise(out, 0.15, 1500, 0.8, 0.5 * loud, 0.1);
      this._tone(out, 'triangle', 110, 32, 1.0 * loud, 0.26);
    } else if (id === 'sniper') {
      this._noise(out, 0.5, 700, 0.6, 1.0 * loud, 0.4);
      this._noise(out, 0.08, 2600, 1.2, 0.55 * loud, 0.06);
      this._tone(out, 'triangle', 140, 28, 0.9 * loud, 0.35);
    } else {
      this._noise(out, 0.18, 1300, 0.8, 0.65 * loud, 0.11);
      this._tone(out, 'triangle', 180, 55, 0.5 * loud, 0.1);
    }
  }

  shot(id) {
    if (!this.ctx) return;
    this._shotInto(this._spatial(null), id);
  }

  remoteShot(id, pos) {
    if (!this.ctx) return;
    const out = this._spatial(pos, 0.8);
    if (out) this._shotInto(out, id, 0.8);
  }

  // ---------- movement ----------
  footstep(pos = null, self = false) {
    if (!this.ctx) return;
    const out = this._spatial(pos, self ? 0.12 : 0.5);
    if (!out) return;
    this._noise(out, 0.07, 300 + Math.random() * 200, 1.2, 1, 0.05, 'lowpass');
  }

  // ---------- feedback ----------
  hit(headshot) {
    if (!this.ctx) return;
    const out = this._spatial(null, 1);
    this._tone(out, 'square', headshot ? 1500 : 1150, headshot ? 1500 : 1150, 0.16, 0.05);
  }

  kill() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const [i, f] of [[0, 1250], [0.07, 1650]]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.setValueAtTime(0.2, t + i);
      g.gain.exponentialRampToValueAtTime(0.001, t + i + 0.08);
      osc.connect(g).connect(this.master);
      osc.start(t + i);
      osc.stop(t + i + 0.09);
    }
  }

  reload() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const dt of [0, 0.35, 0.9]) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const filt = this.ctx.createBiquadFilter();
      filt.type = 'bandpass';
      filt.frequency.value = 2600;
      filt.Q.value = 4;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.setValueAtTime(0.25, t + dt);
      g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.05);
      src.connect(filt).connect(g).connect(this.master);
      src.start(t + dt);
      src.stop(t + dt + 0.06);
    }
  }

  hurt() {
    if (!this.ctx) return;
    this._tone(this._spatial(null), 'triangle', 120, 45, 0.5, 0.15);
  }

  die() {
    if (!this.ctx) return;
    this._tone(this._spatial(null), 'triangle', 200, 30, 0.7, 0.6);
  }

  respawn() {
    if (!this.ctx) return;
    const out = this._spatial(null, 0.6);
    this._tone(out, 'sine', 300, 640, 0.25, 0.22);
    this._noise(out, 0.2, 1200, 0.5, 0.12, 0.18, 'highpass');
  }

  uiClick() {
    if (!this.ctx) return;
    const out = this._spatial(null, 0.5);
    this._tone(out, 'square', 900, 700, 0.08, 0.045);
  }

  // ---------- stingers ----------
  matchStart() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const [i, f] of [[0, 220], [0.16, 293.7], [0.32, 440]]) {
      const out = this._spatial(null, 0.7);
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.setValueAtTime(0.16, t + i);
      g.gain.exponentialRampToValueAtTime(0.001, t + i + 0.5);
      const filt = this.ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 1400;
      osc.connect(filt).connect(g).connect(out);
      osc.start(t + i);
      osc.stop(t + i + 0.55);
    }
  }

  matchEnd(won) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const notes = won ? [[0, 392], [0.18, 494], [0.36, 587.3]] : [[0, 330], [0.22, 262], [0.44, 196]];
    for (const [i, f] of notes) {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.001, t);
      g.gain.setValueAtTime(0.2, t + i);
      g.gain.exponentialRampToValueAtTime(0.001, t + i + 0.7);
      osc.connect(g).connect(this.master);
      osc.start(t + i);
      osc.stop(t + i + 0.75);
    }
  }

  // ---------- ambient beds (one per map, all synthesized loops) ----------
  setAmbient(kind) {
    this.ambientKind = kind;
    if (!this.ctx) return; // will start on unlock
    if (this.ambientNodes) {
      for (const n of this.ambientNodes) { try { n.stop ? n.stop() : n.disconnect(); } catch { /* done */ } }
      this.ambientNodes = null;
    }
    if (!kind) return;

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filt = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();

    if (kind === 'hum') {          // depot: low machinery hum
      filt.type = 'lowpass'; filt.frequency.value = 130; g.gain.value = 0.10;
      lfo.frequency.value = 0.13; lfoGain.gain.value = 28;
    } else if (kind === 'wind') {  // compound: desert wind
      filt.type = 'bandpass'; filt.frequency.value = 420; filt.Q.value = 0.4; g.gain.value = 0.05;
      lfo.frequency.value = 0.07; lfoGain.gain.value = 190;
    } else {                       // pipeline: distant industry
      filt.type = 'bandpass'; filt.frequency.value = 210; filt.Q.value = 1.2; g.gain.value = 0.07;
      lfo.frequency.value = 0.2; lfoGain.gain.value = 60;
    }
    lfo.connect(lfoGain).connect(filt.frequency);
    src.connect(filt).connect(g).connect(this.master);
    src.start();
    lfo.start();
    this.ambientNodes = [src, lfo, g];
  }
}
