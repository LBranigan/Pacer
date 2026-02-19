/**
 * Lo-Fi 3 Engine — Double-Time Feel Architecture
 *
 * Core concept: anchor instruments (kick, snare, bass, Rhodes pad) play at the
 * BASE BPM (60-80). Momentum instruments (rapid hi-hats, shaker, synth arp) play
 * at 2× BPM (120-160). The listener feels driving energy at ~140 BPM while the
 * harmonic rhythm stays open at ~70 BPM.
 *
 * Scheduler runs at double-time 16th-note resolution. Each "dt-step" is 1/8 of
 * a base beat. Anchor instruments fire on every 8th dt-step.
 *
 * Chord progression: ii-V-I-vi in C major (Dm9 → G13 → Cmaj9 → Am9)
 *
 * Compatible with iPad Safari (no AudioWorklet dependency).
 */

// ─── Frequency table (Hz) ────────────────────────────────────────────────────
const NOTE = {
  A1: 55, C2: 65.41, D2: 73.42, G2: 98.00, A2: 110.00,
  B2: 123.47, C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61,
  G3: 196.00, A3: 220.00, B3: 246.94, C4: 261.63, D4: 293.66,
  E4: 329.63, F4: 349.23, G4: 392.00, A4: 440.00, B4: 493.88,
  C5: 523.25, D5: 587.33,
};

// ─── Chord progression: ii-V-I-vi in C major with extended voicings ──────────
// 4 chords × 8 base beats each = 32 base beats per loop
const CHORDS = [
  {
    name: 'Dm9',
    notes: [NOTE.D3, NOTE.F3, NOTE.A3, NOTE.C4, NOTE.E4],
    root: NOTE.D2,
    scale: [NOTE.D4, NOTE.E4, NOTE.F4, NOTE.G4, NOTE.A4, NOTE.C5],
  },
  {
    name: 'G13',
    notes: [NOTE.G3, NOTE.B3, NOTE.D4, NOTE.F4, NOTE.E4],
    root: NOTE.G2,
    scale: [NOTE.G4, NOTE.A4, NOTE.B4, NOTE.D5, NOTE.F4, NOTE.E4],
  },
  {
    name: 'Cmaj9',
    notes: [NOTE.C3, NOTE.E3, NOTE.G3, NOTE.B3, NOTE.D4],
    root: NOTE.C2,
    scale: [NOTE.C4, NOTE.D4, NOTE.E4, NOTE.G4, NOTE.A4, NOTE.B4],
  },
  {
    name: 'Am9',
    notes: [NOTE.A2, NOTE.C3, NOTE.E3, NOTE.G3, NOTE.B3],
    root: NOTE.A1,
    scale: [NOTE.A3, NOTE.B3, NOTE.C4, NOTE.D4, NOTE.E4, NOTE.G4],
  },
];

// ─── Double-time hi-hat pattern (16 dt-steps per base beat group, 2 base beats) ─
// Pattern length = 16 dt-steps (= 2 base beats at base-BPM 16th resolution).
// Index 0 = downbeat of base beat 1, index 8 = downbeat of base beat 2.
// All 16 positions fire (rapid 16th notes at 2× BPM).
// The HH_SWING_INDICES mark "upbeat" positions that receive J Dilla swing delay.
const HH_PATTERN_LEN = 16; // repeating pattern length in dt-steps
// Swing applied on the "e" and "ah" of each double-time beat (odd 16ths at 2x speed)
const HH_SWING_INDICES = new Set([1, 3, 5, 7, 9, 11, 13, 15]);
const HH_SWING_RATIO = 0.56; // fraction of dt-step to delay upbeats (J Dilla: ~56%)

// Shaker fires on positions NOT on the main HH downbeats (the "between" 16ths)
const SHAKER_PATTERN = [0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1];

// ─── Synth arp pattern (at double-time, scale degree index, -1 = rest) ──────
// 16 dt-steps repeating; triggers at level >= 1.0
const ARP_PATTERN = [-1,0,-1,2, -1,4,-1,2, -1,1,-1,3, -1,5,-1,3];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Exponentially decaying stereo reverb IR. */
function createReverbIR(ctx, duration, decay) {
  const rate = ctx.sampleRate;
  const len = Math.ceil(rate * duration);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (rate * decay));
    }
    // Two passes of 3-sample moving average (cheap low-pass)
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 2; i < len; i++) d[i] = (d[i] + d[i-1] + d[i-2]) / 3;
    }
  }
  return buf;
}

/** Tanh waveshaper curve for tape saturation. */
function createSaturationCurve(drive, n = 8192) {
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / n) * 2 - 1;
    curve[i] = Math.tanh(x * drive);
  }
  return curve;
}

// ─── Main Engine ─────────────────────────────────────────────────────────────

export class Lofi3Engine {
  /**
   * @param {AudioContext} audioContext
   */
  constructor(audioContext) {
    this._ctx = audioContext;
    this._bpm = 72;              // base BPM (anchor instruments)
    this._overlayLevel = 0;      // 0 … 1.5
    this._density = 'normal';
    this._crackleIntensity = 'light';

    this._playing = false;
    this._paused = false;
    this._disposed = false;

    // Scheduler state
    this._schedulerTimer = null;
    this._scheduleAheadTime = 0.12;  // seconds lookahead
    this._timerInterval = 25;        // ms between ticks

    // dt-step counter (double-time 16th notes)
    this._currentDtStep = 0;
    this._nextDtStepTime = 0;

    // Chord counter in base beats (each chord lasts 8 base beats)
    this._currentBaseBeat = 0;

    // Source tracking for cleanup
    this._activeSources = new Set();
    this._nodes = {};

    // Crackle
    this._crackleBufs = {};
    this._crackleSource = null;

    // Stubs for adaptive/melody/celebration features
    this._celebrationsEnabled = false;
    this._melodyEnabled = false;
    this._adaptiveHarmonyEnabled = false;
    this._harmonyMood = 'bright';
    this._sentenceAligned = false;
    this._chordOverrideIdx = 0;
    this._pendingChordChange = false;

    this._buildGraph();
    this._buildCrackleBuffers();
    this._buildNoiseBuffers();
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /** GainNode to connect to destination. */
  get output() { return this._nodes.masterGain; }

  /** True while producing sound. */
  get isPlaying() { return this._playing && !this._paused; }

  /** Base BPM (anchor instruments). */
  get currentBpm() { return this._bpm; }

  /** Current overlay level 0-1.5. */
  get overlayLevel() { return this._overlayLevel; }

  /** Name of the current chord. */
  get currentChordName() {
    const idx = Math.floor(this._currentBaseBeat / 8) % CHORDS.length;
    return CHORDS[idx].name;
  }

  /** Set base tempo (anchor instruments). Momentum runs at 2× this. */
  setTempo(bpm) {
    this._bpm = Math.max(40, Math.min(120, bpm));
  }

  /**
   * Set overlay level — controls which instrument layers are active.
   * 0 = pad only, 0.35 = + kick/snare, 0.65 = + bass,
   * 1.0 = + double-time hats/shaker (TRANSFORM), 1.5 = + ghost fills / volume boost.
   * @param {number} level - 0.0 to 1.5
   */
  setOverlayLevel(level) {
    this._overlayLevel = Math.max(0, Math.min(1.5, level));
  }

  /** No-op (Lofi3 has only one style). */
  setStyle() {}

  /** @param {'sparse'|'normal'|'full'} d */
  setDensity(d) {
    if (['sparse', 'normal', 'full'].includes(d)) this._density = d;
  }

  /** @param {'light'|'medium'|'heavy'} i */
  setCrackleIntensity(i) {
    if (!['light', 'medium', 'heavy'].includes(i)) return;
    this._crackleIntensity = i;
    if (this._crackleSource) { this._stopCrackle(); this._startCrackle(); }
  }

  /** Play a vinyl-skip stutter effect. */
  playRecordSkip() {
    if (this._disposed || !this._playing) return;
    const ctx = this._ctx;
    const time = ctx.currentTime;

    // Dense crackle burst
    const skipBuf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.15), ctx.sampleRate);
    const data = skipBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      if (Math.random() < 300 / ctx.sampleRate) {
        data[i] = (Math.random() * 2 - 1);
        if (i + 1 < data.length) data[i + 1] = data[i] * -0.7;
        if (i + 2 < data.length) data[i + 2] = data[i] * 0.3;
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = skipBuf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.2, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
    src.connect(g);
    g.connect(this._nodes.crackleFilter);
    src.start(time);
    this._trackSource(src, time + 0.2);

    // Brief master dip
    const master = this._nodes.masterGain;
    master.gain.setValueAtTime(0.85, time);
    master.gain.linearRampToValueAtTime(0.5, time + 0.03);
    master.gain.linearRampToValueAtTime(0.85, time + 0.18);
  }

  /** Play a needle-drop thump when resuming from pause. */
  playNeedleDrop() {
    if (this._disposed || !this._playing) return;
    const ctx = this._ctx;
    const time = ctx.currentTime;

    // Deep sine sweep thump
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(100, time);
    osc.frequency.exponentialRampToValueAtTime(35, time + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.45, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.25);
    osc.connect(g);
    g.connect(this._nodes.drumBus);
    osc.start(time);
    osc.stop(time + 0.3);
    this._trackSource(osc, time + 0.35);

    // Crackle burst
    const burstBuf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.4), ctx.sampleRate);
    const bd = burstBuf.getChannelData(0);
    for (let i = 0; i < bd.length; i++) {
      if (Math.random() < 80 / ctx.sampleRate) {
        bd[i] = (Math.random() * 2 - 1) * 0.6;
        if (i + 1 < bd.length) bd[i + 1] = bd[i] * -0.5;
      }
    }
    const bsrc = ctx.createBufferSource();
    bsrc.buffer = burstBuf;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.3, time + 0.05);
    bg.gain.exponentialRampToValueAtTime(0.001, time + 0.45);
    bsrc.connect(bg);
    bg.connect(this._nodes.crackleFilter);
    bsrc.start(time + 0.05);
    this._trackSource(bsrc, time + 0.5);
  }

  /**
   * Position within the current base beat (0-1).
   * @returns {number}
   */
  getBeatPhase() {
    if (!this._playing) return 0;
    const baseBeatDur = 60 / this._bpm;
    const dtStepDur = baseBeatDur / 8; // 8 dt-steps per base beat
    // How far into the current dt-step cycle are we?
    const dtStep = this._currentDtStep % 8;
    const elapsed = (this._ctx.currentTime - (this._nextDtStepTime - dtStepDur));
    const beatElapsed = dtStep * dtStepDur + Math.max(0, elapsed);
    return Math.max(0, Math.min(1, beatElapsed / baseBeatDur));
  }

  start() {
    if (this._disposed) return;
    if (this._playing) this.stop();
    this._playing = true;
    this._paused = false;
    this._currentDtStep = 0;
    this._currentBaseBeat = 0;
    this._nextDtStepTime = this._ctx.currentTime + 0.05;
    this._startCrackle();
    this._startScheduler();
  }

  stop() {
    this._playing = false;
    this._paused = false;
    this._stopScheduler();
    this._stopCrackle();
    this._currentDtStep = 0;
    this._currentBaseBeat = 0;
    for (const src of this._activeSources) {
      try { src.stop(0); } catch (_) {}
    }
    this._activeSources.clear();
  }

  pause() {
    if (!this._playing || this._paused) return;
    this._paused = true;
    this._stopScheduler();
    this._stopCrackle();
  }

  resume() {
    if (!this._playing || !this._paused) return;
    this._paused = false;
    this._nextDtStepTime = this._ctx.currentTime + 0.05;
    this._startCrackle();
    this._startScheduler();
  }

  dispose() {
    this.stop();
    this._disposed = true;
    for (const key of Object.keys(this._nodes)) {
      try { this._nodes[key].disconnect(); } catch (_) {}
    }
    this._nodes = {};
  }

  // ─── Stubs (API compatibility) ──────────────────────────────────────────────

  setCelebrations(enabled) { this._celebrationsEnabled = !!enabled; }
  notifyWordEvent() {}
  setMelody(enabled) { this._melodyEnabled = !!enabled; }
  playMelodicPing() {}
  setAdaptiveHarmony(enabled) { this._adaptiveHarmonyEnabled = !!enabled; }
  setHarmonyMood() {}
  setSentenceAligned(enabled) { this._sentenceAligned = !!enabled; }
  advanceChord() {
    this._chordOverrideIdx = ((this._chordOverrideIdx || 0) + 1) % CHORDS.length;
    this._pendingChordChange = true;
  }

  // ─── Audio Graph ────────────────────────────────────────────────────────────

  _buildGraph() {
    const ctx = this._ctx;
    const n = this._nodes;

    // Master output
    n.masterGain = ctx.createGain();
    n.masterGain.gain.value = 0.85;

    // Bus compressor (-15dB threshold, 3:1)
    n.busComp = ctx.createDynamicsCompressor();
    n.busComp.threshold.value = -15;
    n.busComp.knee.value = 6;
    n.busComp.ratio.value = 3;
    n.busComp.attack.value = 0.005;
    n.busComp.release.value = 0.2;
    n.busComp.connect(n.masterGain);

    // Tape saturation (tanh drive 1.8, 2× oversample) → compressor
    n.saturation = ctx.createWaveShaper();
    n.saturation.curve = createSaturationCurve(1.8, 8192);
    n.saturation.oversample = '2x';
    n.saturation.connect(n.busComp);

    // Warmth low-pass (8kHz, Q 0.5) → saturation
    n.warmthFilter = ctx.createBiquadFilter();
    n.warmthFilter.type = 'lowpass';
    n.warmthFilter.frequency.value = 8000;
    n.warmthFilter.Q.value = 0.5;
    n.warmthFilter.connect(n.saturation);

    // Reverb (room 2s)
    n.reverb = ctx.createConvolver();
    n.reverb.buffer = createReverbIR(ctx, 2.0, 0.5);
    n.reverbGain = ctx.createGain();
    n.reverbGain.gain.value = 0.28;
    n.reverb.connect(n.reverbGain);
    n.reverbGain.connect(n.warmthFilter);

    // Dry path
    n.dryGain = ctx.createGain();
    n.dryGain.gain.value = 0.8;
    n.dryGain.connect(n.warmthFilter);

    // Reverb send (splits dry + wet)
    n.reverbSend = ctx.createGain();
    n.reverbSend.gain.value = 1.0;
    n.reverbSend.connect(n.reverb);
    n.reverbSend.connect(n.dryGain);

    // Tape wobble (subtle pitch flutter)
    n.tapeDelay = ctx.createDelay(0.05);
    n.tapeDelay.delayTime.value = 0.004;
    n.tapeLFO = ctx.createOscillator();
    n.tapeLFO.type = 'sine';
    n.tapeLFO.frequency.value = 0.6;
    n.tapeLFOGain = ctx.createGain();
    n.tapeLFOGain.gain.value = 0.002;
    n.tapeLFO.connect(n.tapeLFOGain);
    n.tapeLFOGain.connect(n.tapeDelay.delayTime);
    n.tapeLFO.start(0);
    n.tapeDelay.connect(n.reverbSend);

    // Mix bus (all instrument buses → tape delay)
    n.mixBus = ctx.createGain();
    n.mixBus.gain.value = 1.0;
    n.mixBus.connect(n.tapeDelay);

    // Drum bus (0.8) → mix bus
    n.drumBus = ctx.createGain();
    n.drumBus.gain.value = 0.8;
    n.drumBus.connect(n.mixBus);

    // Pad bus → pad ducker (sidechain) → mix bus
    n.padBus = ctx.createGain();
    n.padBus.gain.value = 0.38;
    n.padDucker = ctx.createGain();
    n.padDucker.gain.value = 1.0;
    n.padBus.connect(n.padDucker);
    n.padDucker.connect(n.mixBus);

    // Pad filter (LP sweep for movement)
    n.padFilter = ctx.createBiquadFilter();
    n.padFilter.type = 'lowpass';
    n.padFilter.frequency.value = 2400;
    n.padFilter.Q.value = 0.8;
    n.padFilter.connect(n.padBus);

    n.padFilterLFO = ctx.createOscillator();
    n.padFilterLFO.type = 'sine';
    n.padFilterLFO.frequency.value = 0.25;
    n.padFilterLFOGain = ctx.createGain();
    n.padFilterLFOGain.gain.value = 250;
    n.padFilterLFO.connect(n.padFilterLFOGain);
    n.padFilterLFOGain.connect(n.padFilter.frequency);
    n.padFilterLFO.start(0);

    // Bass bus → bass ducker (sidechain) → mix bus
    n.bassBus = ctx.createGain();
    n.bassBus.gain.value = 0.55;
    n.bassDucker = ctx.createGain();
    n.bassDucker.gain.value = 1.0;
    n.bassBus.connect(n.bassDucker);
    n.bassDucker.connect(n.mixBus);

    // Hi-hat bus (momentum instruments — separate gain for clean activation)
    n.hatBus = ctx.createGain();
    n.hatBus.gain.value = 0.0; // activated at level >= 1.0
    n.hatBus.connect(n.drumBus);

    // Vinyl crackle path (bypasses warmth filter, feeds saturation directly)
    n.crackleBus = ctx.createGain();
    n.crackleBus.gain.value = 0.06;
    n.crackleFilter = ctx.createBiquadFilter();
    n.crackleFilter.type = 'highpass';
    n.crackleFilter.frequency.value = 1200;
    n.crackleBus.connect(n.crackleFilter);
    n.crackleFilter.connect(n.saturation);
  }

  // ─── Pre-rendered noise buffers ─────────────────────────────────────────────

  _buildNoiseBuffers() {
    const ctx = this._ctx;
    const n = this._nodes;

    // Short shaker burst (tight noise, 30ms)
    const shakerLen = Math.ceil(ctx.sampleRate * 0.03);
    n.shakerBuf = ctx.createBuffer(1, shakerLen, ctx.sampleRate);
    const sd = n.shakerBuf.getChannelData(0);
    for (let i = 0; i < shakerLen; i++) {
      sd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (shakerLen * 0.25));
    }

    // Snare noise (80ms bandpass-ready)
    const snareLen = Math.ceil(ctx.sampleRate * 0.08);
    n.snareBuf = ctx.createBuffer(1, snareLen, ctx.sampleRate);
    const snd = n.snareBuf.getChannelData(0);
    for (let i = 0; i < snareLen; i++) {
      snd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (snareLen * 0.3));
    }
  }

  // ─── Vinyl crackle (Poisson-distributed, looped 4s buffer) ─────────────────

  _buildCrackleBuffers() {
    const ctx = this._ctx;
    const dur = 4;
    const rate = ctx.sampleRate;
    // Approximate Poisson: probability per sample = rate_per_sec / sampleRate
    for (const [intensity, clicksPerSec] of [['light', 20], ['medium', 60], ['heavy', 150]]) {
      const buf = ctx.createBuffer(1, rate * dur, rate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        if (Math.random() < clicksPerSec / rate) {
          const amp = intensity === 'heavy' ? (0.5 + Math.random() * 0.5) : (0.25 + Math.random() * 0.75);
          data[i] = (Math.random() * 2 - 1) * amp;
          if (i + 1 < data.length) data[i + 1] = data[i] * -0.5;
          if (i + 2 < data.length) data[i + 2] = data[i] * 0.2;
        }
      }
      this._crackleBufs[intensity] = buf;
    }
  }

  _startCrackle() {
    if (this._crackleSource) return;
    const buf = this._crackleBufs[this._crackleIntensity];
    if (!buf) return;
    const src = this._ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this._nodes.crackleBus);
    src.start(0);
    this._crackleSource = src;
  }

  _stopCrackle() {
    if (this._crackleSource) {
      try { this._crackleSource.stop(0); } catch (_) {}
      this._crackleSource = null;
    }
  }

  // ─── Scheduler ──────────────────────────────────────────────────────────────

  _startScheduler() {
    this._stopScheduler();
    this._schedulerTimer = setInterval(() => this._scheduleTick(), this._timerInterval);
  }

  _stopScheduler() {
    if (this._schedulerTimer !== null) {
      clearInterval(this._schedulerTimer);
      this._schedulerTimer = null;
    }
  }

  _scheduleTick() {
    const now = this._ctx.currentTime;
    // Each dt-step is 1/8 of a base beat (= one 16th note at 2× BPM)
    const baseBeatDur = 60 / this._bpm;
    const dtStepDur = baseBeatDur / 8;

    while (this._nextDtStepTime < now + this._scheduleAheadTime) {
      this._scheduleDtStep(this._nextDtStepTime, this._currentDtStep);
      this._nextDtStepTime += dtStepDur;
      this._currentDtStep++;
      // 32 base beats × 8 dt-steps = 256 dt-steps per loop
      if (this._currentDtStep >= 256) this._currentDtStep = 0;
      // Track base beat counter (each base beat = 8 dt-steps)
      this._currentBaseBeat = Math.floor(this._currentDtStep / 8);
    }
  }

  /**
   * Schedule all instruments for one double-time step.
   * dt-step within the whole loop: 0-255 (256 total = 32 base beats × 8 dt-steps).
   * @param {number} time - AudioContext time for this dt-step
   * @param {number} dtStep - 0-255
   */
  _scheduleDtStep(time, dtStep) {
    const level = this._overlayLevel;
    const baseBeatDur = 60 / this._bpm;
    const dtStepDur = baseBeatDur / 8;

    // Determine current chord (one chord per 8 base beats = 64 dt-steps)
    const chordIdx = Math.floor(dtStep / 64) % CHORDS.length;
    const chord = CHORDS[chordIdx];

    // ── Is this the start of a base beat? (dt-step % 8 === 0) ──
    const isBaseBeatStart = (dtStep % 8 === 0);
    // Base beat index within the 32-beat loop (0-31)
    const baseBeat = Math.floor(dtStep / 8) % 32;

    // ── ANCHOR INSTRUMENTS (play at base BPM rate) ──

    if (isBaseBeatStart) {
      // Chord pad: trigger every 8 base beats (chord change) — level >= 0
      if (baseBeat % 8 === 0) {
        const duration = baseBeatDur * 7.5; // hold almost until next chord
        this._playRhodesPad(time, chord.notes, duration);
      }

      // Kick: beats 0, 4, 8, 12, 16, 20, 24, 28 (every other base beat = quarter notes)
      if (level >= 0.35 && baseBeat % 4 === 0) {
        this._playKick(time);
        this._duckSidechain(time);
      }

      // Snare: beats 4, 12, 20, 28 (backbeat — every 8 base beats starting at 4)
      if (level >= 0.35 && baseBeat % 8 === 4) {
        this._playSnare(time);
      }

      // Bass: every kick position (same as kick pattern), level >= 0.65
      if (level >= 0.65 && baseBeat % 4 === 0) {
        this._playBass(time, chord.root, baseBeatDur * 3.5);
      }
    }

    // ── MOMENTUM INSTRUMENTS (double-time, level >= 1.0) ──

    if (level >= 1.0) {
      // Activate hat bus on first dt-step if not already at full gain
      const hatBus = this._nodes.hatBus;
      if (hatBus.gain.value < 0.9) {
        hatBus.gain.setTargetAtTime(1.0, time, 0.1);
      }

      const dtPos = dtStep % HH_PATTERN_LEN;

      // Hi-hat 16ths with J Dilla swing on upbeats
      const swingDelay = HH_SWING_INDICES.has(dtPos) ? dtStepDur * (HH_SWING_RATIO - 0.5) : 0;
      const hhTime = time + swingDelay;

      // At level 1.5: ghost fills — all 16 positions, varying volume
      // At level 1.0: straight 16ths (every dt-step)
      const hhVol = (level >= 1.5)
        ? (dtPos % 4 === 0 ? 0.35 : 0.2) // accent downbeats at peak
        : (dtPos % 4 === 0 ? 0.28 : 0.18);
      this._playHiHat(hhTime, 0.045, hhVol);

      // Shaker on off-beats (between hi-hats)
      if (SHAKER_PATTERN[dtPos] === 1) {
        this._playShaker(time + dtStepDur * 0.3); // offset slightly for texture
      }

      // Synth arpeggio (fast pulsing counter-melody at 2× speed)
      const arpDeg = ARP_PATTERN[dtPos];
      if (arpDeg >= 0 && chord.scale && chord.scale.length > arpDeg) {
        const arpFreq = chord.scale[arpDeg] * 2; // octave up
        this._playArpNote(time, arpFreq, dtStepDur * 0.7);
      }
    } else {
      // Deactivate hat bus smoothly when dropping below level 1.0
      const hatBus = this._nodes.hatBus;
      if (hatBus.gain.value > 0.05 && isBaseBeatStart) {
        hatBus.gain.setTargetAtTime(0.0, time, 0.08);
      }
    }
  }

  // ─── Sidechain Pumping ───────────────────────────────────────────────────────

  /**
   * Duck padDucker (→ 0.4) and bassDucker (→ 0.5) on kick.
   * 20ms attack, 250ms release.
   */
  _duckSidechain(kickTime) {
    const ctx = this._ctx;
    const t = kickTime;

    // Pad ducker
    const pd = this._nodes.padDucker.gain;
    pd.cancelScheduledValues(t);
    pd.setValueAtTime(1.0, t);
    pd.linearRampToValueAtTime(0.4, t + 0.02);   // 20ms attack (duck down)
    pd.setTargetAtTime(1.0, t + 0.02, 0.08);     // 250ms release (τ ≈ 80ms)

    // Bass ducker
    const bd = this._nodes.bassDucker.gain;
    bd.cancelScheduledValues(t);
    bd.setValueAtTime(1.0, t);
    bd.linearRampToValueAtTime(0.5, t + 0.02);
    bd.setTargetAtTime(1.0, t + 0.02, 0.08);
  }

  // ─── FM Rhodes Pad Synthesis ────────────────────────────────────────────────

  /**
   * Play FM Rhodes chord.
   * Each note gets two FM pairs:
   *   Pair A: carrier (detune -5¢) + modulator at 1:1, mod index freq×3.0→freq×0.15 over 500ms
   *   Pair B: carrier (detune +5¢) + modulator at 14:1, mod gain freq×1.5→0.001 over 80ms (bell transient)
   * Envelope: 5ms attack, sustain 70%, exponential release.
   */
  _playRhodesPad(time, noteFreqs, duration) {
    const ctx = this._ctx;
    const endTime = time + duration;
    const releaseStart = time + duration * 0.70;
    const vol = 0.16 / noteFreqs.length; // normalize per note count

    for (const freq of noteFreqs) {
      // ── Pair A: warm body (1:1 ratio) ──
      const modA = ctx.createOscillator();
      modA.type = 'sine';
      modA.frequency.value = freq; // 1:1 ratio

      const modAGain = ctx.createGain();
      // Mod index decays from freq×3 → freq×0.15 over 500ms (electric piano character)
      modAGain.gain.setValueAtTime(freq * 3.0, time);
      modAGain.gain.exponentialRampToValueAtTime(freq * 0.15, time + 0.5);
      modAGain.gain.setValueAtTime(freq * 0.15, releaseStart);
      modAGain.gain.exponentialRampToValueAtTime(0.001, endTime);

      const carrA = ctx.createOscillator();
      carrA.type = 'sine';
      carrA.frequency.value = freq;
      carrA.detune.value = -5;

      modA.connect(modAGain);
      modAGain.connect(carrA.frequency);

      const envA = ctx.createGain();
      envA.gain.setValueAtTime(0.0001, time);
      envA.gain.linearRampToValueAtTime(vol, time + 0.005);       // 5ms attack
      envA.gain.setValueAtTime(vol, releaseStart);
      envA.gain.exponentialRampToValueAtTime(0.0001, endTime);

      carrA.connect(envA);
      envA.connect(this._nodes.padFilter);

      modA.start(time); modA.stop(endTime + 0.05);
      carrA.start(time); carrA.stop(endTime + 0.05);
      this._trackSource(modA, endTime + 0.1);
      this._trackSource(carrA, endTime + 0.1);

      // ── Pair B: bell transient (14:1 ratio) ──
      const modB = ctx.createOscillator();
      modB.type = 'sine';
      modB.frequency.value = freq * 14; // 14:1 — inharmonic bell partial

      const modBGain = ctx.createGain();
      // Bell transient: freq×1.5 → 0.001 over 80ms
      modBGain.gain.setValueAtTime(freq * 1.5, time);
      modBGain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);

      const carrB = ctx.createOscillator();
      carrB.type = 'sine';
      carrB.frequency.value = freq;
      carrB.detune.value = +5;

      modB.connect(modBGain);
      modBGain.connect(carrB.frequency);

      const envB = ctx.createGain();
      envB.gain.setValueAtTime(vol * 0.7, time);
      envB.gain.exponentialRampToValueAtTime(0.0001, time + 0.12); // quick bell decay

      carrB.connect(envB);
      envB.connect(this._nodes.padFilter);

      modB.start(time); modB.stop(time + 0.15);
      carrB.start(time); carrB.stop(time + 0.15);
      this._trackSource(modB, time + 0.2);
      this._trackSource(carrB, time + 0.2);
    }
  }

  // ─── Bass Synthesis ─────────────────────────────────────────────────────────

  /**
   * Warm sine sub-bass with 40ms soft attack, LPF at 380Hz.
   */
  _playBass(time, freq, duration) {
    const ctx = this._ctx;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;

    // Octave-up triangle for presence
    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = freq * 2;

    const g2 = ctx.createGain();
    g2.gain.value = 0.15;
    osc2.connect(g2);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(0.55, time + 0.04); // 40ms soft attack
    env.gain.setValueAtTime(0.55, time + duration * 0.65);
    env.gain.exponentialRampToValueAtTime(0.001, time + duration);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    lp.Q.value = 0.5;

    g2.connect(env);
    osc.connect(env);
    env.connect(lp);
    lp.connect(this._nodes.bassBus);

    osc.start(time); osc.stop(time + duration + 0.05);
    osc2.start(time); osc2.stop(time + duration + 0.05);
    this._trackSource(osc, time + duration + 0.1);
    this._trackSource(osc2, time + duration + 0.1);
  }

  // ─── Kick Synthesis ─────────────────────────────────────────────────────────

  /**
   * Warm lo-fi kick: sine sweep 160→45Hz + triangle click transient.
   */
  _playKick(time) {
    const ctx = this._ctx;

    // Sine body sweep
    const body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(160, time);
    body.frequency.exponentialRampToValueAtTime(45, time + 0.08);

    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.9, time);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, time + 0.22);

    body.connect(bodyGain);
    bodyGain.connect(this._nodes.drumBus);

    // Triangle click transient (initial attack thump)
    const click = ctx.createOscillator();
    click.type = 'triangle';
    click.frequency.setValueAtTime(300, time);
    click.frequency.exponentialRampToValueAtTime(80, time + 0.02);

    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(0.5, time);
    clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.025);

    click.connect(clickGain);
    clickGain.connect(this._nodes.drumBus);

    body.start(time); body.stop(time + 0.25);
    click.start(time); click.stop(time + 0.03);
    this._trackSource(body, time + 0.3);
    this._trackSource(click, time + 0.05);
  }

  // ─── Snare Synthesis ────────────────────────────────────────────────────────

  /**
   * Lo-fi snare: dual triangle body (185Hz + 330Hz) + bandpass noise rattle.
   */
  _playSnare(time) {
    const ctx = this._ctx;
    const n = this._nodes;

    // Triangle body 1
    const t1 = ctx.createOscillator();
    t1.type = 'triangle';
    t1.frequency.value = 185;
    const g1 = ctx.createGain();
    g1.gain.setValueAtTime(0.4, time);
    g1.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
    t1.connect(g1); g1.connect(n.drumBus);

    // Triangle body 2
    const t2 = ctx.createOscillator();
    t2.type = 'triangle';
    t2.frequency.value = 330;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.25, time);
    g2.gain.exponentialRampToValueAtTime(0.001, time + 0.09);
    t2.connect(g2); g2.connect(n.drumBus);

    // Noise rattle through bandpass
    const noise = ctx.createBufferSource();
    noise.buffer = n.snareBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2800;
    bp.Q.value = 1.2;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.55, time);
    ng.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
    noise.connect(bp); bp.connect(ng); ng.connect(n.drumBus);

    t1.start(time); t1.stop(time + 0.15);
    t2.start(time); t2.stop(time + 0.12);
    noise.start(time);
    this._trackSource(t1, time + 0.2);
    this._trackSource(t2, time + 0.15);
    this._trackSource(noise, time + 0.1);
  }

  // ─── Hi-Hat Synthesis ───────────────────────────────────────────────────────

  /**
   * Metallic hi-hat: 6 square oscillators at inharmonic ratios, HP at 7kHz.
   * Routes to hatBus (which is controlled by level gating).
   */
  _playHiHat(time, decayTime, volume) {
    const ctx = this._ctx;
    const fundamental = 40;
    const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21];

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;

    const env = ctx.createGain();
    env.gain.setValueAtTime(volume, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + decayTime);

    hp.connect(env);
    env.connect(this._nodes.hatBus);

    for (const ratio of ratios) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = fundamental * ratio;
      // Subtle random detune for humanization
      osc.detune.value = (Math.random() - 0.5) * 8;
      osc.connect(hp);
      osc.start(time);
      osc.stop(time + decayTime + 0.01);
      this._trackSource(osc, time + decayTime + 0.03);
    }
  }

  // ─── Shaker Synthesis ───────────────────────────────────────────────────────

  /**
   * Tight noise burst for shaker 16ths (routes to hatBus).
   */
  _playShaker(time) {
    const ctx = this._ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._nodes.shakerBuf;
    src.playbackRate.value = 0.9 + Math.random() * 0.2; // slight pitch humanization

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5000;

    const g = ctx.createGain();
    g.gain.value = 0.12;

    src.connect(hp);
    hp.connect(g);
    g.connect(this._nodes.hatBus);

    src.start(time);
    this._trackSource(src, time + 0.04);
  }

  // ─── Synth Arpeggio ─────────────────────────────────────────────────────────

  /**
   * Fast pulsing synth arp note at double-time speed.
   * Thin triangle wave with a quick pluck envelope.
   */
  _playArpNote(time, freq, duration) {
    const ctx = this._ctx;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    lp.Q.value = 1.5;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(0.10, time + 0.006);
    env.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc.connect(lp);
    lp.connect(env);
    env.connect(this._nodes.mixBus); // dry — arp sits in the mid of the mix

    osc.start(time);
    osc.stop(time + duration + 0.01);
    this._trackSource(osc, time + duration + 0.02);
  }

  // ─── Source Tracking ────────────────────────────────────────────────────────

  _trackSource(source, expiresAt) {
    this._activeSources.add(source);
    source.onended = () => this._activeSources.delete(source);
    // Safety timeout fallback
    const ms = Math.max(50, (expiresAt - this._ctx.currentTime) * 1000 + 300);
    setTimeout(() => this._activeSources.delete(source), ms);
  }
}
