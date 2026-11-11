// Fully synthesised audio (Web Audio API): engine, tyres, wind, impacts, UI and biome ambience.
// Nothing is sampled, so there are no third-party audio licences to track.
import { clamp } from '../core/noise';
import { CarPhysics } from '../vehicle/physics';
import { CarSpec } from '../vehicle/specs';

export class GameAudio {
  ctx: AudioContext | null = null;
  private master!: GainNode; private sfx!: GainNode; private amb!: GainNode; private ui!: GainNode;
  private noiseBuf!: AudioBuffer;
  private osc: OscillatorNode[] = []; private oscGain: GainNode[] = []; private engFilter!: BiquadFilterNode; private engGain!: GainNode; private shaper!: WaveShaperNode;
  private intakeGain!: GainNode; private intakeFilter!: BiquadFilterNode;
  private squealGain!: GainNode; private squealF!: BiquadFilterNode; private rumbleGain!: GainNode;
  private windGain!: GainNode; private windF!: BiquadFilterNode; private rollGain!: GainNode; private scrapeGain!: GainNode; private boostGain!: GainNode; private boostF!: BiquadFilterNode;
  private rainGain!: GainNode; private ambWindGain!: GainNode; private cricketGain!: GainNode;
  private spec: CarSpec | null = null; private birdT = 2; private popT = 0; private lastThrottle = 0;
  vol = { master: 0.8, engine: 0.8, ambience: 0.6 };

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as any).webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5; comp.connect(ctx.destination);
    this.master = ctx.createGain(); this.master.connect(comp);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master); this.amb = ctx.createGain(); this.amb.connect(this.master); this.ui = ctx.createGain(); this.ui.connect(this.master);
    const len = ctx.sampleRate * 2; this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // engine: four oscillators -> waveshaper -> lowpass
    this.shaper = ctx.createWaveShaper(); const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 2.6); } this.shaper.curve = curve;
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.Q.value = 1.2;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.shaper.connect(this.engFilter); this.engFilter.connect(this.engGain); this.engGain.connect(this.sfx);
    const types: OscillatorType[] = ['sawtooth', 'sawtooth', 'square', 'sawtooth'];
    for (let i = 0; i < 4; i++) { const o = ctx.createOscillator(); o.type = types[i]; const g = ctx.createGain(); g.gain.value = 0.2; o.connect(g); g.connect(this.shaper); o.start(); this.osc.push(o); this.oscGain.push(g); }
    const loop = (filterType: BiquadFilterType, freq: number, q: number, dest: AudioNode): [GainNode, BiquadFilterNode] => {
      const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; s.playbackRate.value = 0.8 + Math.random() * 0.4;
      const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q; const g = ctx.createGain(); g.gain.value = 0;
      s.connect(f); f.connect(g); g.connect(dest); s.start(); return [g, f];
    };
    [this.intakeGain, this.intakeFilter] = loop('bandpass', 900, 0.8, this.sfx);
    [this.squealGain, this.squealF] = loop('bandpass', 1250, 7, this.sfx);
    [this.rumbleGain] = loop('lowpass', 320, 0.7, this.sfx);
    [this.windGain, this.windF] = loop('lowpass', 700, 0.4, this.sfx);
    [this.rollGain] = loop('lowpass', 150, 0.6, this.sfx);
    [this.scrapeGain] = loop('highpass', 2600, 1.5, this.sfx);
    [this.boostGain, this.boostF] = loop('bandpass', 1800, 3, this.sfx);
    [this.rainGain] = loop('highpass', 3200, 0.5, this.amb);
    [this.ambWindGain] = loop('lowpass', 420, 0.5, this.amb);
    [this.cricketGain] = loop('bandpass', 4300, 30, this.amb);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 17; const lg = ctx.createGain(); lg.gain.value = 0; lfo.connect(lg); lg.connect(this.cricketGain.gain); lfo.start();
    (this as any).cricketLfo = lg;
    this.applyVolumes();
  }
  applyVolumes() { if (!this.ctx) return; this.master.gain.value = this.vol.master; this.sfx.gain.value = this.vol.engine; this.amb.gain.value = this.vol.ambience; this.ui.gain.value = 0.7; }
  setCar(spec: CarSpec) { this.spec = spec; }
  suspend(on: boolean) { if (!this.ctx) return; this.sfx.gain.setTargetAtTime(on ? 0 : this.vol.engine, this.ctx.currentTime, 0.08); this.amb.gain.setTargetAtTime(on ? this.vol.ambience * 0.4 : this.vol.ambience, this.ctx.currentTime, 0.2); }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, dest: AudioNode, slideTo = 0, delay = 0) {
    const ctx = this.ctx!; const t = ctx.currentTime + delay; const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.02);
  }
  private burst(dur: number, vol: number, freq: number, type: BiquadFilterType = 'lowpass', q = 0.7, dest: AudioNode = this.sfx) {
    const ctx = this.ctx!; const t = ctx.currentTime; const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }
  uiHover() { if (this.ctx) this.tone(1320, 0.05, 'sine', 0.06, this.ui); }
  uiSelect() { if (this.ctx) { this.tone(660, 0.09, 'triangle', 0.16, this.ui); this.tone(990, 0.14, 'sine', 0.12, this.ui, 0, 0.05); } }
  uiBack() { if (this.ctx) this.tone(520, 0.12, 'triangle', 0.14, this.ui, 330); }
  uiDeny() { if (this.ctx) this.tone(180, 0.2, 'square', 0.1, this.ui, 120); }
  beep(final: boolean) { if (this.ctx) this.tone(final ? 1320 : 660, final ? 0.55 : 0.16, 'square', 0.14, this.ui); }
  checkpoint() { if (this.ctx) { this.tone(1175, 0.12, 'sine', 0.18, this.ui); this.tone(1760, 0.2, 'sine', 0.16, this.ui, 0, 0.08); } }
  fanfare(stars: number) { if (!this.ctx) return; const n = [523, 659, 784, 1047, 1319]; for (let i = 0; i < 2 + stars; i++) this.tone(n[i], 0.38, 'triangle', 0.17, this.ui, 0, i * 0.11); }
  reward() { if (this.ctx) { this.tone(880, 0.1, 'sine', 0.14, this.ui); this.tone(1320, 0.25, 'sine', 0.14, this.ui, 0, 0.09); } }
  impact(strength: number) { if (!this.ctx) return; const v = clamp(strength / 9, 0.08, 1); this.burst(0.3 + v * 0.3, v * 0.9, 500 + v * 900); this.tone(70, 0.3, 'sine', v * 0.8, this.sfx, 38); if (v > 0.4) this.burst(0.5, v * 0.3, 3000, 'highpass'); }
  shift(up: boolean) { if (!this.ctx) return; this.burst(0.05, 0.22, 1900, 'bandpass', 2); if (!up) this.burst(0.12, 0.18, 300); }
  land(v: number) { if (this.ctx) { this.burst(0.25, 0.5 * v, 260); this.tone(55, 0.25, 'sine', 0.6 * v, this.sfx, 35); } }

  update(dt: number, car: CarPhysics | null, env: { rain: number; daylight: number; biome: [number, number, number]; tunnel: number }) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime, set = (p: AudioParam, v: number, tc = 0.04) => p.setTargetAtTime(v, t, tc);
    set(this.rainGain.gain, env.rain * 0.22 * (1 - env.tunnel), 0.5);
    set(this.ambWindGain.gain, (0.05 + env.biome[0] * 0.09 + env.biome[1] * 0.13) * (1 - env.tunnel * 0.7) + Math.sin(t * 0.23) * 0.02, 0.6);
    const night = 1 - env.daylight;
    set(this.cricketGain.gain, 0.0, 0.3); ((this as any).cricketLfo as GainNode).gain.setTargetAtTime(night * 0.5 * (1 - env.rain) * (env.biome[2] * 0.8 + env.biome[0] * 0.5), t, 0.5);
    // birdsong in the forest by day
    this.birdT -= dt;
    if (this.birdT <= 0) {
      this.birdT = 0.7 + Math.random() * 4;
      const p = env.biome[2] * env.daylight * (1 - env.rain) * (1 - env.tunnel) * (car ? clamp(1.2 - car.kmh / 140, 0.15, 1) : 1);
      if (Math.random() < p) { const f = 2400 + Math.random() * 2600, n = 2 + Math.floor(Math.random() * 4); for (let i = 0; i < n; i++) this.tone(f * (1 + Math.random() * 0.12), 0.07 + Math.random() * 0.06, 'sine', 0.03 + Math.random() * 0.03, this.amb, f * (0.8 + Math.random() * 0.5), i * 0.11); }
    }
    if (!car || !this.spec) { set(this.engGain.gain, 0, 0.1); for (const g of [this.squealGain, this.rumbleGain, this.windGain, this.rollGain, this.scrapeGain, this.boostGain, this.intakeGain]) set(g.gain, 0, 0.1); return; }
    const s = this.spec.audio, rpm = car.rpm, thr = car.throttle, x = rpm / this.spec.redline;
    const f = rpm / 60 * s.cylinders / 2 * 0.5 * s.pitch; // firing fundamental (lowered an octave for body)
    set(this.osc[0].frequency, f * 0.5, 0.025); set(this.osc[1].frequency, f * 1.003, 0.025); set(this.osc[2].frequency, f * 1.5, 0.025); set(this.osc[3].frequency, f * 2.01, 0.025);
    set(this.oscGain[0].gain, 0.3 * s.bass + 0.1); set(this.oscGain[1].gain, 0.3); set(this.oscGain[2].gain, 0.05 + 0.14 * s.rasp * (0.4 + thr)); set(this.oscGain[3].gain, 0.08 + 0.2 * x * s.rasp);
    set(this.engFilter.frequency, (300 + x * 2600 + thr * 2400 * (0.5 + x)) * (1 - env.tunnel * 0.15), 0.05);
    set(this.engGain.gain, (0.11 + 0.2 * thr + 0.12 * x) * (1 + env.tunnel * 0.5), 0.05);
    set(this.intakeGain.gain, thr * x * 0.11); set(this.intakeFilter.frequency, 500 + x * 1700);
    // overrun pops when lifting at high rpm
    if (this.lastThrottle > 0.6 && thr < 0.3 && x > 0.55) this.popT = 0.5 + s.rasp * 0.7;
    this.lastThrottle = thr;
    if (this.popT > 0) { this.popT -= dt; if (Math.random() < dt * 14 * s.rasp) this.burst(0.05, 0.16 + Math.random() * 0.18, 700 + Math.random() * 900, 'bandpass', 1.5); }
    let slide = 0, dirtSlide = 0;
    for (const w of car.wheels) { if (w.surface === 0) slide = Math.max(slide, w.slide); else dirtSlide = Math.max(dirtSlide, w.slide); }
    const spd = car.vel.length();
    set(this.squealGain.gain, clamp((slide - 3) / 12, 0, 1) * 0.22 * (1 - car.wet * 0.7), 0.06); set(this.squealF.frequency, 950 + clamp(spd, 0, 60) * 9 + Math.sin(t * 31) * 40, 0.05);
    const off = car.grounded > 0 && car.surface > 0 ? 1 : 0;
    set(this.rumbleGain.gain, off * clamp(spd / 30, 0, 1) * 0.3 + clamp(dirtSlide / 10, 0, 1) * 0.25, 0.08);
    set(this.windGain.gain, clamp(spd / 85, 0, 1) ** 2 * 0.3 * (1 + env.tunnel * 0.6), 0.1); set(this.windF.frequency, 400 + spd * 14, 0.1);
    set(this.rollGain.gain, (car.grounded ? 1 : 0) * clamp(spd / 50, 0, 1) * 0.3, 0.08);
    set(this.scrapeGain.gain, car.scrape * 0.22, 0.03);
    set(this.boostGain.gain, car.boosting ? 0.24 : 0, 0.08); set(this.boostF.frequency, 1200 + x * 2400, 0.1);
  }
}
