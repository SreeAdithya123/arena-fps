// Procedural WebAudio SFX — no audio assets, everything synthesized.
// unlock() must be called from a user gesture before anything will play.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
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
  }

  _noiseBurst(dur, filterFreq, filterQ, gain, decay) {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = filterFreq;
    filt.Q.value = filterQ;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur);
  }

  _thump(freq, endFreq, gain, dur) {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur);
  }

  shot(id) {
    if (!this.ctx) return;
    if (id === 'dmr') {
      this._noiseBurst(0.3, 900, 0.7, 0.9, 0.22);
      this._thump(160, 40, 0.8, 0.18);
    } else if (id === 'smg') {
      this._noiseBurst(0.12, 1800, 0.9, 0.5, 0.07);
      this._thump(220, 70, 0.35, 0.06);
    } else {
      this._noiseBurst(0.18, 1300, 0.8, 0.65, 0.11);
      this._thump(180, 55, 0.5, 0.1);
    }
  }

  botShot(dist) {
    if (!this.ctx) return;
    const vol = Math.max(0.05, 0.35 - dist * 0.005);
    this._noiseBurst(0.15, 1000, 1, vol, 0.12);
  }

  hit(headshot) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = headshot ? 1500 : 1150;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.05);
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
    this._thump(120, 45, 0.5, 0.15);
  }

  die() {
    if (!this.ctx) return;
    this._thump(200, 30, 0.7, 0.6);
  }
}
