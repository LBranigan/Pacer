/**
 * Lo-Fi V2 Engine — FM Rhodes + Sidechain Pumping + Swing
 *
 * Built from first principles for rich, authentic lo-fi hip-hop:
 * - FM synthesis Rhodes/EP (1:1 carrier-modulator with decaying index)
 * - Layered drum synthesis (sine sweep kick, dual-body snare, 6-osc metallic hat)
 * - Gain-based sidechain pumping on pads/bass
 * - 56% swing on hi-hat upbeats
 * - Poisson-distributed vinyl crackle
 * - Tape saturation + warmth filter
 *
 * 4-tier overlay: Drums → +Bass/Snare → +Rhodes → +Full
 * API-compatible with LofiEngine for rhythm-remix.js integration.
 */

// ── Note Frequencies ────────────────────────────────────────────────────────

const NOTE = {
  A1: 55.00, C2: 65.41, D2: 73.42, G2: 98.00,
  A2: 110.00, C3: 130.81, D3: 146.83, E3: 164.81,
  F3: 174.61, G3: 196.00, A3: 220.00, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23,
  G4: 392.00,
};

// ── Chord Progression: ii–V–I–vi in C major ────────────────────────────────

const CHORDS = [
  { name: 'Dm9',   notes: [NOTE.D3, NOTE.F3, NOTE.A3, NOTE.C4, NOTE.E4], root: NOTE.D2 },
  { name: 'G13',   notes: [NOTE.G3, NOTE.B3, NOTE.D4, NOTE.F4],          root: NOTE.G2 },
  { name: 'Cmaj9', notes: [NOTE.C3, NOTE.E3, NOTE.G3, NOTE.B3, NOTE.D4], root: NOTE.C2 },
  { name: 'Am9',   notes: [NOTE.A2, NOTE.C3, NOTE.E3, NOTE.G3, NOTE.B3], root: NOTE.A1 },
];

// ── Drum Patterns (32 steps = 2 bars, 16th-note resolution) ────────────────

const STEPS = 32;
const KICK  = [1,0,0,0, 0,0,0,0, 1,0,1,0, 0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,1,0];
const SNARE = [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1, 0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0];
const HAT   = [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0];
const SHAKER= [0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1];

const SWING = 0.56; // 0.5 = straight, 0.67 = full triplet

// ── Engine ──────────────────────────────────────────────────────────────────

export class LofiV2Engine {
  constructor(ctx) {
    this._ctx = ctx;
    this._playing = false;
    this._paused = false;
    this._bpm = 72;
    this._step = 0;
    this._nextStepTime = 0;
    this._schedId = null;
    this._density = 'normal';
    this._overlayLevel = 0;
    this._chordIdx = 0;
    this._style = 'lofi2';

    // Master output
    this.output = ctx.createGain();
    this.output.gain.value = 0.85;

    // Channel buses
    this._drumBus = ctx.createGain(); this._drumBus.gain.value = 0.8;
    this._padBus  = ctx.createGain(); this._padBus.gain.value = 0.35;
    this._bassBus = ctx.createGain(); this._bassBus.gain.value = 0.55;
    this._crackleBus = ctx.createGain(); this._crackleBus.gain.value = 0.06;

    // Sidechain duckers (between instrument bus and mix)
    this._padDucker  = ctx.createGain();
    this._bassDucker = ctx.createGain();

    // Warmth filter (master LP — rolls off digital sparkle)
    const warmth = ctx.createBiquadFilter();
    warmth.type = 'lowpass'; warmth.frequency.value = 8000; warmth.Q.value = 0.5;

    // Tape saturation (soft clip)
    const sat = ctx.createWaveShaper();
    sat.curve = this._tanhCurve(1.8); sat.oversample = '2x';

    // Bus compressor (glue)
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -15; comp.ratio.value = 3;
    comp.attack.value = 0.006; comp.release.value = 0.15;

    // Signal flow: buses → duckers → warmth → saturation → compressor → output
    this._padBus.connect(this._padDucker);
    this._bassBus.connect(this._bassDucker);
    this._drumBus.connect(warmth);
    this._padDucker.connect(warmth);
    this._bassDucker.connect(warmth);
    warmth.connect(sat);
    this._crackleBus.connect(sat); // crackle bypasses warmth
    sat.connect(comp);
    comp.connect(this.output);

    // Pre-rendered noise buffers
    this._noiseBuf = this._makeNoise(0.5);
    this._shortNoiseBuf = this._makeNoise(0.025);

    // Vinyl crackle
    this._crackleSource = null;
    this._buildCrackle();
  }

  // ── Getters ──

  get isPlaying() { return this._playing && !this._paused; }
  get currentBpm() { return this._bpm; }
  get overlayLevel() { return this._overlayLevel; }
  get currentChordName() { return CHORDS[this._chordIdx % 4].name; }

  // ── Playback Control ──

  start() {
    if (this._playing) return;
    if (this._ctx.state === 'suspended') this._ctx.resume();
    this._playing = true;
    this._paused = false;
    this._step = 0;
    this._chordIdx = 0;
    this._nextStepTime = this._ctx.currentTime + 0.05;
    this._startCrackle();
    this._schedId = setInterval(() => this._tick(), 25);
  }

  stop() {
    this._playing = false;
    this._paused = false;
    if (this._schedId !== null) { clearInterval(this._schedId); this._schedId = null; }
    this._stopCrackle();
  }

  pause() {
    if (!this._playing) return;
    this._paused = true;
    if (this._schedId !== null) { clearInterval(this._schedId); this._schedId = null; }
  }

  resume() {
    if (!this._playing || !this._paused) return;
    this._paused = false;
    this._nextStepTime = this._ctx.currentTime + 0.05;
    this._schedId = setInterval(() => this._tick(), 25);
  }

  dispose() { this.stop(); }

  setTempo(bpm) { this._bpm = Math.max(40, Math.min(200, bpm)); }
  setStyle() {} // single style

  setOverlayLevel(level) { this._overlayLevel = level; }
  setDensity(d) { this._density = d; }

  setCrackleIntensity(intensity) {
    const gains = { light: 0.06, medium: 0.12, heavy: 0.18 };
    this._crackleBus.gain.setTargetAtTime(
      gains[intensity] || 0.06, this._ctx.currentTime, 0.05
    );
  }

  playRecordSkip() {
    const t = this._ctx.currentTime;
    const buf = this._makeClickBurst(0.15, 300);
    const src = this._ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this._crackleBus);
    src.start(t);
    this.output.gain.setValueAtTime(0.85, t);
    this.output.gain.linearRampToValueAtTime(0.5, t + 0.03);
    this.output.gain.linearRampToValueAtTime(0.85, t + 0.2);
  }

  playNeedleDrop() {
    const t = this._ctx.currentTime;
    const osc = this._ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(100, t);
    osc.frequency.exponentialRampToValueAtTime(35, t + 0.15);
    const g = this._ctx.createGain();
    g.gain.setValueAtTime(0.45, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.connect(g).connect(this._drumBus);
    osc.start(t); osc.stop(t + 0.3);
  }

  // ── Stubs (features not in this engine) ──

  setCelebrations() {}
  notifyWordEvent() {}
  setMelody() {}
  playMelodicPing() {}
  setAdaptiveHarmony() {}
  setHarmonyMood() {}
  setSentenceAligned() {}
  advanceChord() {}

  getBeatPhase() {
    if (!this._playing) return 0;
    const beatDur = 60 / this._bpm;
    const elapsed = this._ctx.currentTime - (this._nextStepTime - (60 / this._bpm / 4));
    return Math.max(0, Math.min(1, (elapsed / beatDur) % 1));
  }

  // ── Scheduler ──

  _tick() {
    const stepDur = 60 / this._bpm / 4; // 16th-note duration
    while (this._nextStepTime < this._ctx.currentTime + 0.12) {
      this._scheduleStep(this._nextStepTime, this._step, stepDur);
      this._nextStepTime += stepDur;
      this._step++;
      if (this._step % STEPS === 0) {
        this._chordIdx = (this._chordIdx + 1) % 4;
      }
    }
  }

  _scheduleStep(time, step, stepDur) {
    const s = step % STEPS;
    const d = this._density;
    const ol = this._overlayLevel;

    // Apply swing to upbeat 8th notes (the "and" positions)
    let t = time;
    if (s % 4 === 2) {
      t += (SWING - 0.5) * stepDur * 4;
    }

    // ── Whisper: pad only (quiet) ──
    if (d === 'whisper') {
      if (s === 0 && ol >= 0.65) this._playRhodes(t, stepDur, 0.25);
      return;
    }

    const sparse = d === 'sparse';
    const full = d === 'full';

    // Kick always (except whisper)
    if (KICK[s]) {
      this._playKick(t);
      this._duck(this._padDucker, t, 0.4, 0.02, 0.25);
      this._duck(this._bassDucker, t, 0.5, 0.02, 0.2);
    }

    // Hat (normal+)
    if (HAT[s] && !sparse) this._playHat(t);

    // Level 0.35+: Snare + Bass
    if (ol >= 0.35) {
      if (SNARE[s] && !sparse) this._playSnare(t);
      if (s === 0 || s === 16) {
        this._playBass(t, stepDur * 14, sparse ? 0.4 : (full ? 0.9 : 0.65));
      }
    }

    // Level 0.65+: FM Rhodes (every 2 bars)
    if (ol >= 0.65 && s === 0) {
      this._playRhodes(t, stepDur, sparse ? 0.5 : (full ? 1.0 : 0.75));
    }

    // Level 1.0+: Shaker
    if (ol >= 1.0 && SHAKER[s] && !sparse) this._playShaker(t);

    // Full density: ghost hats on 16ths
    if (full && s % 2 === 1) this._playGhostHat(t);
  }

  // ── FM Rhodes Chord ──

  _playRhodes(time, stepDur, volumeScale) {
    const chord = CHORDS[this._chordIdx % 4];
    const duration = stepDur * STEPS + 0.1; // slight overlap for crossfade
    const vol = (volumeScale || 0.75) * 0.15 / chord.notes.length;
    for (const freq of chord.notes) {
      this._playRhodesNote(freq, time, duration, vol);
    }
  }

  _playRhodesNote(freq, time, duration, vol) {
    const ctx = this._ctx;

    // FM Pair A: main tine body (1:1 ratio, decaying modulation index)
    const modA = ctx.createOscillator();
    modA.type = 'sine';
    modA.frequency.value = freq;
    const modAGain = ctx.createGain();
    modAGain.gain.setValueAtTime(freq * 3.0, time);
    modAGain.gain.exponentialRampToValueAtTime(freq * 0.15, time + 0.5);
    modA.connect(modAGain);

    const carrA = ctx.createOscillator();
    carrA.type = 'sine';
    carrA.frequency.value = freq;
    carrA.detune.value = -5;
    modAGain.connect(carrA.frequency);

    const envA = ctx.createGain();
    envA.gain.setValueAtTime(0.001, time);
    envA.gain.exponentialRampToValueAtTime(vol, time + 0.005);
    envA.gain.setValueAtTime(vol, time + duration * 0.7);
    envA.gain.exponentialRampToValueAtTime(0.001, time + duration);
    carrA.connect(envA);
    envA.connect(this._padBus);

    // FM Pair B: attack transient / bell click (14:1 ratio, very short)
    const modB = ctx.createOscillator();
    modB.type = 'sine';
    modB.frequency.value = freq * 14;
    const modBGain = ctx.createGain();
    modBGain.gain.setValueAtTime(freq * 1.5, time);
    modBGain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
    modB.connect(modBGain);

    const carrB = ctx.createOscillator();
    carrB.type = 'sine';
    carrB.frequency.value = freq;
    carrB.detune.value = +5;
    modBGain.connect(carrB.frequency);

    const envB = ctx.createGain();
    envB.gain.setValueAtTime(0.001, time);
    envB.gain.exponentialRampToValueAtTime(vol * 0.25, time + 0.005);
    envB.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
    carrB.connect(envB);
    envB.connect(this._padBus);

    const end = time + duration + 0.05;
    carrA.start(time); carrA.stop(end);
    modA.start(time);  modA.stop(end);
    carrB.start(time); carrB.stop(end);
    modB.start(time);  modB.stop(end);
  }

  // ── Drums ──

  _playKick(time) {
    const ctx = this._ctx;
    // Sine body: pitch sweep 160→45Hz
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.35);
    osc.connect(g).connect(this._drumBus);
    osc.start(time); osc.stop(time + 0.4);

    // Triangle click transient
    const click = ctx.createOscillator();
    click.type = 'triangle';
    click.frequency.setValueAtTime(150, time);
    click.frequency.exponentialRampToValueAtTime(55, time + 0.07);
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.4, time);
    cg.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
    click.connect(cg).connect(this._drumBus);
    click.start(time); click.stop(time + 0.2);
  }

  _playSnare(time) {
    const ctx = this._ctx;
    // Body: two detuned triangles at 185Hz + 330Hz
    for (const freq of [185, 330]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.35, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
      osc.connect(g).connect(this._drumBus);
      osc.start(time); osc.stop(time + 0.15);
    }
    // Noise rattle
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 3000; bp.Q.value = 1.2;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.5, time);
    ng.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
    src.connect(bp).connect(ng).connect(this._drumBus);
    src.start(time); src.stop(time + 0.2);
  }

  _playHat(time) {
    // 6 square oscillators at inharmonic ratios (808/909 method)
    const ctx = this._ctx;
    const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21];
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.2, time);
    master.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 7000;
    master.connect(hp).connect(this._drumBus);
    for (const r of ratios) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 40 * r;
      const g = ctx.createGain(); g.gain.value = 0.12;
      osc.connect(g).connect(master);
      osc.start(time); osc.stop(time + 0.08);
    }
  }

  _playGhostHat(time) {
    // Quiet noise-based hat for 16th-note fills
    const ctx = this._ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._shortNoiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 8000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.06, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
    src.connect(hp).connect(g).connect(this._drumBus);
    src.start(time);
  }

  _playShaker(time) {
    const ctx = this._ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._shortNoiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 5000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.08, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.02);
    src.connect(hp).connect(g).connect(this._drumBus);
    src.start(time);
  }

  // ── Bass ──

  _playBass(time, duration, volumeScale) {
    const ctx = this._ctx;
    const chord = CHORDS[this._chordIdx % 4];
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = chord.root;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 280;
    const vol = volumeScale || 0.65;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.04);
    g.gain.setValueAtTime(vol, time + duration * 0.6);
    g.gain.exponentialRampToValueAtTime(0.001, time + duration);
    osc.connect(lp).connect(g).connect(this._bassBus);
    osc.start(time); osc.stop(time + duration + 0.05);
  }

  // ── Sidechain Duck ──

  _duck(node, time, depth, attack, release) {
    node.gain.cancelScheduledValues(time);
    node.gain.setValueAtTime(1.0, time);
    node.gain.linearRampToValueAtTime(depth, time + attack);
    node.gain.exponentialRampToValueAtTime(1.0, time + attack + release);
  }

  // ── Vinyl Crackle ──

  _buildCrackle() {
    const sr = this._ctx.sampleRate;
    const len = sr * 4; // 4 seconds, looped
    const buf = this._ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    // Poisson-distributed clicks (~20/sec) for natural vinyl feel
    let pos = 0;
    while (pos < len) {
      pos += Math.floor(-Math.log(Math.random()) / 20 * sr);
      if (pos >= len) break;
      const amp = 0.3 + Math.random() * 0.7;
      d[pos] = amp;
      if (pos + 1 < len) d[pos + 1] = amp * -0.5;
      if (pos + 2 < len) d[pos + 2] = amp * 0.2;
    }
    this._crackleBuf = buf;
  }

  _startCrackle() {
    if (this._crackleSource) return;
    this._crackleSource = this._ctx.createBufferSource();
    this._crackleSource.buffer = this._crackleBuf;
    this._crackleSource.loop = true;
    const hp = this._ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 1000;
    this._crackleSource.connect(hp).connect(this._crackleBus);
    this._crackleSource.start();
  }

  _stopCrackle() {
    if (this._crackleSource) {
      try { this._crackleSource.stop(); } catch (_) {}
      this._crackleSource = null;
    }
  }

  // ── Utility ──

  _makeNoise(seconds) {
    const buf = this._ctx.createBuffer(1, this._ctx.sampleRate * seconds, this._ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _makeClickBurst(seconds, density) {
    const sr = this._ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = this._ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      if (Math.random() < density / sr) {
        d[i] = (Math.random() * 2 - 1) * (0.5 + Math.random() * 0.5);
      }
    }
    return buf;
  }

  _tanhCurve(drive) {
    const n = 8192;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / n) * 2 - 1;
      curve[i] = Math.tanh(x * drive);
    }
    return curve;
  }
}
