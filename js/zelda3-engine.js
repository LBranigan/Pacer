/**
 * Zelda3Engine — NES-inspired Adventure Beat Engine
 *
 * Double-time feel architecture:
 *   Anchor instruments (triangle bass, kick, chord pad) play at BASE BPM.
 *   Momentum instruments (pulse arpeggio, fast hi-hats, fairy-fountain) at 2× BPM.
 *
 * Key: F major. Progression: F → Dm → Bb → C (I–vi–IV–V).
 * NES 2A03 synthesis via createPeriodicWave (pulse 25% and 12.5% duty cycles).
 *
 * API-compatible with LofiEngine (same public surface).
 */

// ─── Frequency helpers ───────────────────────────────────────────────────────

/** Convert MIDI note number to Hz. */
function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Build a PeriodicWave for a pulse wave with the given duty cycle.
 * imag[k] = (2 / (k * π)) * sin(k * π * duty)
 */
function buildPulseWave(ctx, duty, harmonics = 64) {
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let k = 1; k <= harmonics; k++) {
    imag[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

// ─── Chord table in F major ───────────────────────────────────────────────────
// Each chord: root MIDI (bass octave), arpNotes (MIDI for arpeggio), name.
// F3=53, G3=55, A3=57, Bb3=58, C4=60, D4=62, E4=64, F4=65
// F2=41, A2=45, Bb2=46, C3=48, D3=50, E3=52

const CHORDS = [
  {
    name: 'F',
    bassMidi:  41,           // F2
    fifthMidi: 48,           // C3
    arpNotes:  [65, 69, 72, 69], // F4 A4 C5 A4
    padMidi:   [65, 69, 72], // F4 A4 C5
  },
  {
    name: 'Dm',
    bassMidi:  50,           // D3
    fifthMidi: 57,           // A3
    arpNotes:  [62, 65, 69, 65], // D4 F4 A4 F4
    padMidi:   [62, 65, 69], // D4 F4 A4
  },
  {
    name: 'Bb',
    bassMidi:  46,           // Bb2
    fifthMidi: 53,           // F3
    arpNotes:  [58, 62, 65, 62], // Bb3 D4 F4 D4
    padMidi:   [58, 62, 65], // Bb3 D4 F4
  },
  {
    name: 'C',
    bassMidi:  48,           // C3
    fifthMidi: 55,           // G3
    arpNotes:  [60, 64, 67, 64], // C4 E4 G4 E4
    padMidi:   [60, 64, 67], // C4 E4 G4
  },
];

// ─── Composed 16-bar melody (256 steps, 16 steps/bar) ────────────────────────
// 0 = rest, -1 = sustain/tie, positive = MIDI note number.
// F4=65 G4=67 A4=69 Bb4=70 C5=72 D5=74 E5=76 F5=77
//
// Bars 1-4:  Opening — stepwise, establishes F major
// Bars 5-8:  Development — rises to upper register
// Bars 9-12: Contrast — moves toward Dm / Bb colour
// Bars 13-16: Return — resolves back to F

const MELODY = [
  // Bar 1: F major opening motif (stepwise ascent)
  65,-1, 0, 0,  67,-1, 0, 0,  69,-1, 0, 0,  70,-1, 0, 0,
  // Bar 2: Leap up, settle
  72,-1,-1, 0,  70, 0, 69, 0,  67,-1, 0, 0,  65,-1,-1,-1,
  // Bar 3: Same motif, slight variation
  65,-1, 0, 0,  67,-1, 0, 0,  69,-1, 67, 0,  65,-1, 0, 0,
  // Bar 4: Cadential phrase, land on C
  69,-1, 0, 0,  70,-1, 0, 0,  72,-1, 0, 0,   0, 0, 0, 0,
  // Bar 5: Development — rise with 4th leaps
  67,-1, 0, 0,  72,-1, 0, 0,  74,-1, 0, 0,  72,-1, 0, 0,
  // Bar 6: Continue upward
  74,-1, 0, 0,  76,-1, 0, 0,  77,-1,-1, 0,  76,-1, 0, 0,
  // Bar 7: Ornament and fall
  74,-1, 0,72,  70,-1, 0, 0,  69,-1, 0, 0,  67,-1, 0, 0,
  // Bar 8: Reach peak then descend, breathe
  72,-1, 0, 0,  74,-1, 0, 0,  76,-1,-1,-1,   0, 0, 0, 0,
  // Bar 9: Contrast — Dm colour (D E F D)
  62,-1, 0, 0,  64,-1, 0, 0,  65,-1, 0, 0,  62,-1, 0, 0,
  // Bar 10: Bb area (Bb C D Bb)
  58,-1, 0, 0,  60,-1, 0, 0,  62,-1, 0, 0,  60,-1, 0, 0,
  // Bar 11: Return toward F, pentatonic phrase
  65,-1, 0, 0,  67,-1, 0, 0,  65,-1, 0, 0,  62,-1, 0, 0,
  // Bar 12: Suspense — holds, then steps
  69,-1,-1,-1,  69, 0, 0, 0,  70,-1, 0, 0,  72,-1,-1,-1,
  // Bar 13: Return — opening motif again
  65,-1, 0, 0,  67,-1, 0, 0,  69,-1, 0, 0,  70,-1, 0, 0,
  // Bar 14: Similar to bar 2 but more ornate
  72,-1,-1, 0,  74,-1,72, 0,  70,-1, 0, 0,  69,-1, 0, 0,
  // Bar 15: Resolution phrase descending
  67,-1, 0, 0,  69,-1, 0, 0,  67,-1, 0, 0,  65,-1, 0, 0,
  // Bar 16: Final cadence, long F
  65,-1,-1,-1,  65,-1,-1,-1,  65,-1,-1,-1,  65,-1,-1,-1,
];

// ─── Bass pattern (256 steps, per bar: root beat1, fifth beat3, passing tones) ─
// Uses MIDI note numbers interpreted per-chord; 0 = rest.
// Pattern encodes which "slot" to use: 1=root, 2=fifth, 3=octave-up root, 0=rest.

const BASS_PATTERN = [
  // Bar 1 (F chord)
  1,0,0,0, 0,0,2,0, 1,0,0,0, 0,0,2,0,
  // Bar 2 (Dm chord)
  1,0,0,0, 0,0,2,0, 1,0,0,0, 0,0,2,0,
  // Bar 3 (Bb chord)
  1,0,0,0, 0,0,2,0, 1,0,0,0, 0,0,2,0,
  // Bar 4 (C chord)
  1,0,0,0, 0,0,2,0, 1,0,0,0, 0,0,2,0,
  // Bars 5-8 same pattern (slightly busier walk)
  1,0,0,2, 0,0,1,0, 2,0,0,0, 0,0,1,0,
  1,0,0,2, 0,0,1,0, 2,0,0,0, 0,0,1,0,
  1,0,0,2, 0,0,1,0, 2,0,0,0, 0,0,1,0,
  1,0,0,2, 0,0,1,0, 2,0,0,0, 0,0,1,0,
  // Bars 9-12 (Dm, Bb, F, C)
  1,0,0,0, 0,0,2,0, 1,0,0,0, 0,0,2,0,
  1,0,0,0, 0,0,2,0, 1,0,0,0, 0,0,2,0,
  1,0,0,0, 0,0,2,0, 1,0,0,0, 0,0,2,0,
  1,0,0,0, 0,0,2,0, 1,0,0,0, 0,0,2,0,
  // Bars 13-16 return
  1,0,0,0, 0,0,2,0, 1,0,0,0, 0,0,2,0,
  1,0,0,0, 0,0,2,0, 1,0,0,0, 0,0,2,0,
  1,0,0,0, 0,0,2,0, 1,0,0,0, 0,0,2,0,
  1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0,
];

// Chord index per bar (16 bars, 4 chords cycling as I–vi–IV–V)
const BAR_CHORD = [0,1,2,3, 0,1,2,3, 1,2,0,3, 0,1,2,0];

// ─── Drum patterns (32 steps = 2 bars of 4/4) ────────────────────────────────
// All at BASE BPM rate. Each step = one 16th note.

const KICK_PATTERN = [
  1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0,
  1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0,
];

const SNARE_PATTERN = [
  0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0,
  0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0,
];

// 8th-note hi-hat (base rate)
const HAT_PATTERN_BASE = [
  1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0,
  1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0,
];

// 16th-note hi-hat (double-time, used at overlay >= 1.0)
const HAT_PATTERN_DOUBLE = [
  1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1,
  1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1,
];

// ─── Reverb IR ────────────────────────────────────────────────────────────────

function createReverbIR(ctx, duration, decay) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * duration);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (rate * decay));
    }
    // Simple 3-sample low-pass smoothing
    for (let i = 2; i < len; i++) {
      data[i] = (data[i] + data[i - 1] + data[i - 2]) / 3;
    }
  }
  return buf;
}

// ─── Pre-rendered noise buffer ────────────────────────────────────────────────

function createNoiseBuffer(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

// ─── Main Engine ─────────────────────────────────────────────────────────────

export class Zelda3Engine {
  /**
   * @param {AudioContext} audioContext
   */
  constructor(audioContext) {
    this._ctx = audioContext;
    this._bpm = 70;           // base BPM (anchor instruments)
    this._overlayLevel = 0;   // 0 → 1.5
    this._density = 'normal';
    this._playing = false;
    this._paused = false;
    this._disposed = false;

    // Scheduler state
    this._schedulerTimer = null;
    this._scheduleAheadTime = 0.12; // 120 ms lookahead
    this._timerInterval = 25;       // ms between scheduler ticks

    // Sequencer state: position in 16th-note grid
    this._step = 0;           // 0..255 (16 bars × 16 steps)
    this._nextStepTime = 0;   // AudioContext time of next scheduled step
    this._bar = 0;            // current bar (0..15)
    this._drumStep = 0;       // 0..31 in drum pattern loop

    // Double-time: arp and hi-hat run at 2× base BPM.
    // We schedule them as sub-steps within each base 16th-note slot.
    this._arpPhase = 0;       // 0..3 within each base step (32nd-note positions)

    // Echo/harmony delay state
    this._p2EchoQueue = [];   // {midi, time, duration} queued for pulse2 echo

    // Waveforms (built in _buildGraph)
    this._pulse25 = null;
    this._pulse12 = null;

    // Nodes
    this._nodes = {};
    this._activeSources = new Set();

    // Level 1.5 melody currently-sounding note tracking
    this._currentMelodyOsc = null;
    this._currentMelodyGain = null;
    this._lastMelodyMidi = 0;

    this._buildGraph();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /** GainNode to connect to audioContext.destination. */
  get output() { return this._nodes.masterGain; }

  get isPlaying() { return this._playing && !this._paused; }

  get currentBpm() { return this._bpm; }

  get overlayLevel() { return this._overlayLevel; }

  get currentChordName() {
    const chord = CHORDS[BAR_CHORD[this._bar % 16]];
    return chord ? chord.name : 'F';
  }

  /** Set base tempo. Momentum layer automatically runs at 2×. */
  setTempo(bpm) {
    this._bpm = Math.max(40, Math.min(160, bpm));
  }

  /** No-op — style is fixed as Zelda3. */
  setStyle() {}

  /** Set overlay level 0–1.5. Controls how many layers play. */
  setOverlayLevel(level) {
    const prev = this._overlayLevel;
    this._overlayLevel = Math.max(0, Math.min(1.5, level));
    this._applyOverlayGains(prev);
  }

  setDensity(d) {
    if (['whisper','sparse','normal','full'].includes(d)) this._density = d;
  }

  /** No-op stubs for LofiEngine API compatibility. */
  setCrackleIntensity() {}
  playRecordSkip() {}
  playNeedleDrop() {}
  setTempoSmoothed(bpm) { this.setTempo(bpm); }
  setSentenceAligned() {}
  advanceChord() {}
  setCelebrations() {}
  notifyWordEvent() {}
  setMelody() {}
  setHarmony() {}
  setAdaptiveHarmony() {}
  getBeatPhase() { return 0; }

  /** Start playback. */
  start() {
    if (this._disposed) return;
    if (this._playing) this.stop();
    this._playing = true;
    this._paused = false;
    this._step = 0;
    this._drumStep = 0;
    this._arpPhase = 0;
    this._bar = 0;
    this._p2EchoQueue = [];
    this._nextStepTime = this._ctx.currentTime + 0.05;
    this._startScheduler();
  }

  /** Stop all sound. */
  stop() {
    if (!this._playing) return;
    this._playing = false;
    this._paused = false;
    this._stopScheduler();
    this._releaseAllSources();
    this._silenceBuses();
  }

  /** Pause without losing position. */
  pause() {
    if (!this._playing || this._paused) return;
    this._paused = true;
    this._stopScheduler();
    this._releaseAllSources();
  }

  /** Resume from paused state. */
  resume() {
    if (!this._playing || !this._paused) return;
    this._paused = false;
    this._nextStepTime = this._ctx.currentTime + 0.05;
    this._startScheduler();
  }

  /** Clean up all nodes and timers. */
  dispose() {
    this.stop();
    this._disposed = true;
    for (const key of Object.keys(this._nodes)) {
      try { this._nodes[key].disconnect(); } catch (_) {}
    }
    this._nodes = {};
  }

  // ─── Audio graph ─────────────────────────────────────────────────────────

  _buildGraph() {
    const ctx = this._ctx;
    const n = this._nodes;

    // Pre-built waveforms
    this._pulse25 = buildPulseWave(ctx, 0.25);
    this._pulse12 = buildPulseWave(ctx, 0.125);

    // Pre-render noise buffer
    this._noiseBuf = createNoiseBuffer(ctx, 2.0);

    // Master gain → destination
    n.masterGain = ctx.createGain();
    n.masterGain.gain.value = 0.82;

    // Bus compressor (glue)
    n.comp = ctx.createDynamicsCompressor();
    n.comp.threshold.value = -16;
    n.comp.knee.value = 6;
    n.comp.ratio.value = 4;
    n.comp.attack.value = 0.005;
    n.comp.release.value = 0.12;
    n.comp.connect(n.masterGain);

    // Reverb (small room — dungeon/castle feel)
    n.reverb = ctx.createConvolver();
    n.reverb.buffer = createReverbIR(ctx, 1.2, 0.35);
    n.reverbGain = ctx.createGain();
    n.reverbGain.gain.value = 0.22;
    n.reverb.connect(n.reverbGain);
    n.reverbGain.connect(n.comp);

    // Dry path
    n.dryGain = ctx.createGain();
    n.dryGain.gain.value = 0.82;
    n.dryGain.connect(n.comp);

    // Common send → reverb + dry
    n.reverbSend = ctx.createGain();
    n.reverbSend.gain.value = 1.0;
    n.reverbSend.connect(n.reverb);
    n.reverbSend.connect(n.dryGain);

    // High-shelf air (8-bit brightness)
    n.airFilter = ctx.createBiquadFilter();
    n.airFilter.type = 'highshelf';
    n.airFilter.frequency.value = 5000;
    n.airFilter.gain.value = 2.0;
    n.airFilter.connect(n.reverbSend);

    // ── Instrument buses ──

    // Pulse 1 (lead melody, 25% duty)
    n.p1Bus = ctx.createGain();
    n.p1Bus.gain.value = 0;   // starts silent, raised by overlay
    n.p1Bus.connect(n.airFilter);

    // Pulse 2 (echo/harmony, 12.5% duty, detune)
    n.p2Bus = ctx.createGain();
    n.p2Bus.gain.value = 0;
    n.p2Bus.connect(n.airFilter);

    // Triangle (bass + drone)
    n.triBus = ctx.createGain();
    n.triBus.gain.value = 0.45;
    n.triBus.connect(n.airFilter);

    // Noise (percussion)
    n.noiseBus = ctx.createGain();
    n.noiseBus.gain.value = 0;
    n.noiseBus.connect(n.airFilter);

    // Arpeggio bus (12.5% duty, double-time fairy fountain)
    n.arpBus = ctx.createGain();
    n.arpBus.gain.value = 0;
    n.arpBus.connect(n.airFilter);

    // Level 0 drone (triangle sine pad, always on when playing)
    this._startDrone();
  }

  // ─── Drone (Level 0) ────────────────────────────────────────────────────

  _startDrone() {
    const ctx = this._ctx;
    const n = this._nodes;

    // Sustained triangle chord drone: F2 + C3 (root + fifth) very soft
    const droneFreqs = [midiToHz(41), midiToHz(48), midiToHz(65)]; // F2 C3 F4
    n.droneOscs = droneFreqs.map((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      // Lightest at F4 (harmonic), fuller at bass
      g.gain.value = i === 0 ? 0.18 : i === 1 ? 0.12 : 0.06;
      osc.connect(g);
      g.connect(n.triBus);
      osc.start(0);
      return { osc, gain: g };
    });
  }

  // ─── Overlay gain control ────────────────────────────────────────────────

  _applyOverlayGains(prevLevel) {
    if (!this._ctx) return;
    const ctx = this._ctx;
    const n = this._nodes;
    const now = ctx.currentTime;
    const lv = this._overlayLevel;

    // Noise bus: kicks in at level 0.35+
    const noiseGain = lv >= 0.35 ? Math.min(0.55, 0.3 + (lv - 0.35) * 0.5) : 0;
    n.noiseBus.gain.setTargetAtTime(noiseGain, now, 0.12);

    // Pulse 1 (melody): level 0.65+
    const p1Gain = lv >= 0.65 ? Math.min(0.55, 0.25 + (lv - 0.65) * 0.5) : 0;
    n.p1Bus.gain.setTargetAtTime(p1Gain, now, 0.12);

    // Pulse 2 (echo): level 0.65+, slightly quieter
    const p2Gain = lv >= 0.65 ? Math.min(0.35, 0.15 + (lv - 0.65) * 0.35) : 0;
    n.p2Bus.gain.setTargetAtTime(p2Gain, now, 0.12);

    // Arpeggio bus (fairy fountain): level 1.0+
    const arpGain = lv >= 1.0 ? Math.min(0.45, 0.2 + (lv - 1.0) * 0.35) : 0;
    n.arpBus.gain.setTargetAtTime(arpGain, now, 0.12);

    // Triangle bus — always on but swells with level
    const triGain = 0.38 + lv * 0.12;
    n.triBus.gain.setTargetAtTime(Math.min(0.6, triGain), now, 0.15);
  }

  // ─── Scheduler ───────────────────────────────────────────────────────────

  _startScheduler() {
    this._stopScheduler();
    this._schedulerTimer = setInterval(() => this._schedulerTick(), this._timerInterval);
  }

  _stopScheduler() {
    if (this._schedulerTimer !== null) {
      clearInterval(this._schedulerTimer);
      this._schedulerTimer = null;
    }
  }

  _schedulerTick() {
    if (!this._playing || this._paused || this._disposed) return;
    const ctx = this._ctx;
    const lookAheadEnd = ctx.currentTime + this._scheduleAheadTime;

    while (this._nextStepTime < lookAheadEnd) {
      this._scheduleStep(this._step, this._nextStepTime);
      this._advanceStep();
    }
  }

  _advanceStep() {
    // One base 16th-note duration at BASE BPM
    const stepDur = (60 / this._bpm) / 4;
    this._nextStepTime += stepDur;
    this._step = (this._step + 1) % 256;
    this._drumStep = (this._drumStep + 1) % 32;
    this._bar = Math.floor(this._step / 16) % 16;
  }

  // ─── Per-step scheduling ─────────────────────────────────────────────────

  _scheduleStep(step, time) {
    const lv = this._overlayLevel;
    const stepDur = (60 / this._bpm) / 4;       // base 16th-note duration
    const halfStep = stepDur / 2;                // 32nd-note (double-time unit)
    const bar = Math.floor(step / 16) % 16;
    const chord = CHORDS[BAR_CHORD[bar]];

    // ── Level 0: drone always running (started in _startDrone) ──

    // ── Level 0.35+: percussion + triangle bass ──
    if (lv >= 0.35) {
      // Noise kick
      if (KICK_PATTERN[this._drumStep]) {
        this._scheduleKick(time);
      }
      // Noise snare
      if (SNARE_PATTERN[this._drumStep]) {
        this._scheduleSnare(time);
      }
      // Hi-hat (base rate 8th-note)
      if (HAT_PATTERN_BASE[this._drumStep]) {
        this._scheduleHat(time, false);
      }
      // Triangle bass walking pattern
      this._scheduleTriBass(step, chord, time, stepDur);
    }

    // ── Level 0.65+: melody on pulse 1, echo on pulse 2 ──
    if (lv >= 0.65) {
      this._scheduleMelody(step, chord, time, stepDur, lv);
    }

    // ── Level 1.0+: double-time arpeggio + hi-hat doubling ──
    if (lv >= 1.0) {
      // Schedule TWO arp hits per base step (32nd-note grid)
      this._scheduleArp(chord, time, halfStep, 0);
      this._scheduleArp(chord, time + halfStep, halfStep, 1);

      // Extra hi-hat ticks (the doubling ones between the base hats)
      if (!HAT_PATTERN_BASE[this._drumStep]) {
        // Base step has no hat — add one (or both) double-time hats
        this._scheduleHat(time, true);
      } else {
        // Base step already has hat — add the in-between tick
        this._scheduleHat(time + halfStep, true);
      }

      // Faster triangle bass walk (add sub-step notes on 32nd-note)
      this._scheduleTriBassDouble(step, chord, time + halfStep, stepDur);
    }

    // ── Level 1.5: full melody with harmony 3rds ──
    // (melody already scheduled above; harmony boost handled in _scheduleMelody)
  }

  // ─── Instrument schedulers ──────────────────────────────────────────────

  _scheduleKick(time) {
    const ctx = this._ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = false;

    // Low-pass filter for kick thump
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(200, time);
    filter.frequency.exponentialRampToValueAtTime(40, time + 0.1);

    const env = ctx.createGain();
    env.gain.setValueAtTime(1.0, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.15);

    // Also pitch sweep via a sine burst (NES-style kick)
    const kickOsc = ctx.createOscillator();
    kickOsc.type = 'sine';
    kickOsc.frequency.setValueAtTime(180, time);
    kickOsc.frequency.exponentialRampToValueAtTime(35, time + 0.12);
    const kickEnv = ctx.createGain();
    kickEnv.gain.setValueAtTime(0.7, time);
    kickEnv.gain.exponentialRampToValueAtTime(0.001, time + 0.14);
    kickOsc.connect(kickEnv);
    kickEnv.connect(this._nodes.noiseBus);
    kickOsc.start(time);
    kickOsc.stop(time + 0.18);
    this._trackSource(kickOsc, time + 0.2);

    src.connect(filter);
    filter.connect(env);
    env.connect(this._nodes.noiseBus);
    src.start(time);
    src.stop(time + 0.18);
    this._trackSource(src, time + 0.2);
  }

  _scheduleSnare(time) {
    const ctx = this._ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = false;

    // High-pass for snare crack
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 2000;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.5, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.08);

    src.connect(filter);
    filter.connect(env);
    env.connect(this._nodes.noiseBus);
    src.start(time);
    src.stop(time + 0.1);
    this._trackSource(src, time + 0.12);
  }

  _scheduleHat(time, quiet) {
    const ctx = this._ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = false;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 8000;

    const env = ctx.createGain();
    const vol = quiet ? 0.12 : 0.22;
    env.gain.setValueAtTime(vol, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.03);

    src.connect(filter);
    filter.connect(env);
    env.connect(this._nodes.noiseBus);
    src.start(time);
    src.stop(time + 0.04);
    this._trackSource(src, time + 0.05);
  }

  _scheduleTriBass(step, chord, time, stepDur) {
    const slot = BASS_PATTERN[step % 256];
    if (!slot) return;

    let midi;
    if (slot === 1) midi = chord.bassMidi;
    else if (slot === 2) midi = chord.fifthMidi;
    else if (slot === 3) midi = chord.bassMidi + 12;
    else return;

    const freq = midiToHz(midi);
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;

    const env = ctx.createGain();
    const noteDur = stepDur * 1.8;
    env.gain.setValueAtTime(0.0, time);
    env.gain.linearRampToValueAtTime(0.7, time + 0.01);
    env.gain.setValueAtTime(0.65, time + noteDur * 0.6);
    env.gain.linearRampToValueAtTime(0.0, time + noteDur);

    osc.connect(env);
    env.connect(this._nodes.triBus);
    osc.start(time);
    osc.stop(time + noteDur + 0.02);
    this._trackSource(osc, time + noteDur + 0.05);
  }

  /** Extra bass notes on 32nd-note grid for double-time feel. */
  _scheduleTriBassDouble(step, chord, time, stepDur) {
    // Add a softer passing-tone note between main bass hits
    // Only if main bass pattern has no note on this half-step
    const nextSlot = BASS_PATTERN[(step + 1) % 256];
    if (nextSlot) return; // next step already has a note; don't crowd
    // Play a soft octave-down root as a passing tone
    const midi = chord.bassMidi;
    const freq = midiToHz(midi);
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;

    const env = ctx.createGain();
    const dur = stepDur * 0.9;
    env.gain.setValueAtTime(0.0, time);
    env.gain.linearRampToValueAtTime(0.3, time + 0.008);
    env.gain.linearRampToValueAtTime(0.0, time + dur);

    osc.connect(env);
    env.connect(this._nodes.triBus);
    osc.start(time);
    osc.stop(time + dur + 0.01);
    this._trackSource(osc, time + dur + 0.02);
  }

  /**
   * Schedule melody note on Pulse 1, with echo on Pulse 2.
   * At level 1.5 adds a harmony 3rd above.
   */
  _scheduleMelody(step, chord, time, stepDur, lv) {
    const melMidi = MELODY[step % 256];

    if (melMidi === 0) {
      // Rest: let previous note release naturally.
      return;
    }
    if (melMidi === -1) {
      // Sustain: extend previous note (no new oscillator).
      return;
    }

    // Count how many steps this note is held (ties)
    let holdSteps = 1;
    for (let s = step + 1; s < step + 16 && s < 256; s++) {
      if (MELODY[s] === -1) holdSteps++;
      else break;
    }
    const noteDur = stepDur * holdSteps * 0.92;

    // Vibrato on long notes (>=3 steps)
    const useVibrato = holdSteps >= 3;

    // Pulse 1 — lead melody
    this._playPulse1Note(melMidi, time, noteDur, useVibrato, this._nodes.p1Bus);

    // Pulse 2 — echo (2 steps later, 12.5% duty, -7 cents)
    const echoDelay = stepDur * 2;
    const echoMidi = melMidi - 0.07 / 1.2; // fractional for detuning (handled in freq)
    const echoFreq = midiToHz(melMidi) * Math.pow(2, -7 / 1200); // -7 cents
    this._scheduleEchoNote(echoFreq, time + echoDelay, Math.max(noteDur - echoDelay, stepDur * 0.8));

    // Level 1.5: harmony a 3rd above
    if (lv >= 1.5) {
      const harmonyMidi = melMidi + 4; // major 3rd above
      this._playPulse1Note(harmonyMidi, time, noteDur, useVibrato, this._nodes.p2Bus);
    }
  }

  _playPulse1Note(midi, time, dur, vibrato, bus) {
    const ctx = this._ctx;
    const freq = midiToHz(midi);

    const osc = ctx.createOscillator();
    osc.setPeriodicWave(this._pulse25);
    osc.frequency.value = freq;

    if (vibrato) {
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 6;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = freq * 0.005; // 0.5% depth
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      lfo.start(time + 0.12); // vibrato kicks in after small delay
      lfo.stop(time + dur + 0.02);
      this._trackSource(lfo, time + dur + 0.05);
    }

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0, time);
    env.gain.linearRampToValueAtTime(0.72, time + 0.012);
    env.gain.setValueAtTime(0.65, time + dur * 0.7);
    env.gain.linearRampToValueAtTime(0.0, time + dur);

    osc.connect(env);
    env.connect(bus);
    osc.start(time);
    osc.stop(time + dur + 0.02);
    this._trackSource(osc, time + dur + 0.05);
  }

  _scheduleEchoNote(freq, time, dur) {
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(this._pulse12);
    osc.frequency.value = freq;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0, time);
    env.gain.linearRampToValueAtTime(0.45, time + 0.01);
    env.gain.linearRampToValueAtTime(0.0, time + dur);

    osc.connect(env);
    env.connect(this._nodes.p2Bus);
    osc.start(time);
    osc.stop(time + dur + 0.02);
    this._trackSource(osc, time + dur + 0.05);
  }

  /**
   * Fairy-fountain arpeggio — 12.5% pulse, rapid chord-tone cycling.
   * subStep 0 or 1 selects which 32nd-note within the current base step.
   */
  _scheduleArp(chord, time, dur, subStep) {
    const ctx = this._ctx;
    const lv = this._overlayLevel;

    // Cycle through 4 arp notes continuously
    const arpIdx = (this._arpPhase + subStep) % chord.arpNotes.length;
    if (subStep === 1) this._arpPhase = (this._arpPhase + 2) % chord.arpNotes.length;

    const midi = chord.arpNotes[arpIdx];
    // Fairy-fountain sits one octave above the melody
    const freq = midiToHz(midi + 12);

    const osc = ctx.createOscillator();
    osc.setPeriodicWave(this._pulse12);
    osc.frequency.value = freq;

    const env = ctx.createGain();
    const vol = lv >= 1.5 ? 0.48 : 0.32;
    env.gain.setValueAtTime(0.0, time);
    env.gain.linearRampToValueAtTime(vol, time + 0.005);
    env.gain.exponentialRampToValueAtTime(0.001, time + dur * 0.85);

    osc.connect(env);
    env.connect(this._nodes.arpBus);
    osc.start(time);
    osc.stop(time + dur);
    this._trackSource(osc, time + dur + 0.02);
  }

  // ─── Source tracking ─────────────────────────────────────────────────────

  _trackSource(src, stopTime) {
    this._activeSources.add(src);
    // Auto-remove after stop to prevent memory leak
    const removeAt = (stopTime - this._ctx.currentTime) * 1000 + 200;
    setTimeout(() => this._activeSources.delete(src), Math.max(50, removeAt));
  }

  _releaseAllSources() {
    const now = this._ctx.currentTime;
    for (const src of this._activeSources) {
      try {
        if (typeof src.stop === 'function') src.stop(now + 0.02);
      } catch (_) {}
    }
    this._activeSources.clear();
  }

  _silenceBuses() {
    const n = this._nodes;
    const now = this._ctx ? this._ctx.currentTime : 0;
    const buses = ['p1Bus','p2Bus','noiseBus','arpBus'];
    for (const key of buses) {
      if (n[key]) {
        n[key].gain.setTargetAtTime(0, now, 0.05);
      }
    }
  }
}
