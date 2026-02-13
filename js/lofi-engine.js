/**
 * Lo-Fi Beat Synthesizer — Web Audio API
 *
 * Generates warm, chill lo-fi hip-hop beats entirely from Web Audio primitives.
 * No sample files required. Designed for use in a children's reading assessment
 * tool where the student's reading performance drives the musical experience.
 *
 * Compatible with iPad Safari (no AudioWorklet dependency).
 */

// ─── Frequency table (Hz) ───────────────────────────────────────────────────
const NOTE = {
  A1: 55, C2: 65.41, D2: 73.42, G2: 98.00, A2: 110.00,
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.00,
  A3: 220.00, B3: 246.94, C4: 261.63, D4: 293.66, F4: 349.23,
  B2: 123.47, G4: 392.00, E4: 329.63, A4: 440.00
};

// ─── Chord definitions ──────────────────────────────────────────────────────
const CHORD_SETS = {
  lofi: {
    // ii-V-I-vi in C major: Dm7 → G7 → Cmaj7 → Am7
    chords: [
      { name: 'Dm7',   notes: [NOTE.D3, NOTE.F3, NOTE.A3, NOTE.C4], root: NOTE.D2 },
      { name: 'G7',    notes: [NOTE.G3, NOTE.B3, NOTE.D4, NOTE.F4], root: NOTE.G2 },
      { name: 'Cmaj7', notes: [NOTE.C3, NOTE.E3, NOTE.G3, NOTE.B3], root: NOTE.C2 },
      { name: 'Am7',   notes: [NOTE.A2, NOTE.C3, NOTE.E3, NOTE.G3], root: NOTE.A1 },
    ]
  },
  jazzhop: {
    // Add 9ths for richer jazz voicings: Dm9 → G13 → Cmaj9 → Am9
    chords: [
      { name: 'Dm9',   notes: [NOTE.D3, NOTE.F3, NOTE.A3, NOTE.C4, NOTE.E4], root: NOTE.D2 },
      { name: 'G13',   notes: [NOTE.G3, NOTE.B3, NOTE.D4, NOTE.F4, NOTE.E4], root: NOTE.G2 },
      { name: 'Cmaj9', notes: [NOTE.C3, NOTE.E3, NOTE.G3, NOTE.B3, NOTE.D4], root: NOTE.C2 },
      { name: 'Am9',   notes: [NOTE.A2, NOTE.C3, NOTE.E3, NOTE.G3, NOTE.B3], root: NOTE.A1 },
    ]
  },
  ambient: {
    // Same chords but we'll use longer envelopes and no drums
    chords: [
      { name: 'Dm7',   notes: [NOTE.D3, NOTE.F3, NOTE.A3, NOTE.C4], root: NOTE.D2 },
      { name: 'G7',    notes: [NOTE.G3, NOTE.B3, NOTE.D4, NOTE.F4], root: NOTE.G2 },
      { name: 'Cmaj7', notes: [NOTE.C3, NOTE.E3, NOTE.G3, NOTE.B3], root: NOTE.C2 },
      { name: 'Am7',   notes: [NOTE.A2, NOTE.C3, NOTE.E3, NOTE.G3], root: NOTE.A1 },
    ]
  }
};

// ─── Drum patterns (32 beats = 8 bars of 4/4) ──────────────────────────────
// 1 = hit, 0 = rest. Each array index = one beat.

const DRUM_PATTERNS = {
  lofi: {
    // Boom-bap: kick on 1,3 of each bar; snare on 2,4; hats on every beat
    //           bar1          bar2          bar3          bar4          bar5          bar6          bar7          bar8
    kick:    [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
    snare:   [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
    hatC:    [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
    hatO:    [0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,1],
  },
  jazzhop: {
    // More syncopated pattern
    kick:    [1,0,0,0, 1,0,0,1, 1,0,0,0, 1,0,0,1, 1,0,0,0, 1,0,0,1, 1,0,0,0, 1,0,0,1],
    snare:   [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,1,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0, 0,1,1,0],
    hatC:    [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
    hatO:    [0,0,0,0, 0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,1, 0,0,0,0],
  },
  ambient: {
    // No drums at all
    kick:    new Array(32).fill(0),
    snare:   new Array(32).fill(0),
    hatC:    new Array(32).fill(0),
    hatO:    new Array(32).fill(0),
  }
};

// Bass patterns (beat index → play root note). Per-style.
const BASS_PATTERNS = {
  lofi:    [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
  jazzhop: [1,0,0,1, 1,0,0,1, 1,0,0,1, 1,0,0,1, 1,0,0,1, 1,0,0,1, 1,0,0,1, 1,0,0,1],
  ambient: [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
};


// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Generate a synthetic impulse response (exponentially decaying filtered noise).
 * Returns an AudioBuffer suitable for ConvolverNode.
 */
function createReverbIR(ctx, duration, decay, filterFreq) {
  const rate = ctx.sampleRate;
  const len = rate * duration;
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      // Exponentially decaying random noise
      const env = Math.exp(-i / (rate * decay));
      data[i] = (Math.random() * 2 - 1) * env;
    }
    // Simple low-pass: running average (3-sample window) applied twice
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 2; i < len; i++) {
        data[i] = (data[i] + data[i - 1] + data[i - 2]) / 3;
      }
    }
  }
  return buf;
}

/**
 * Build a staircase WaveShaperNode curve for bit-crushing (quantizes to N levels).
 */
function createBitcrusherCurve(bits) {
  const levels = Math.pow(2, bits);
  const n = 65536;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / n) * 2 - 1; // -1 to +1
    curve[i] = Math.round(x * levels) / levels;
  }
  return curve;
}

/**
 * Soft-clip saturation curve: tanh(x * drive).
 */
function createSaturationCurve(drive, samples) {
  const n = samples || 8192;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / n) * 2 - 1;
    curve[i] = Math.tanh(x * drive);
  }
  return curve;
}


// ─── Main Engine ────────────────────────────────────────────────────────────

export class LofiEngine {
  /**
   * Create a new LofiEngine.
   * @param {AudioContext} audioContext - An existing Web Audio API AudioContext.
   */
  constructor(audioContext) {
    this._ctx = audioContext;
    this._bpm = 75;
    this._style = 'lofi';
    this._density = 'normal';
    this._playing = false;
    this._paused = false;
    this._schedulerTimer = null;
    this._currentBeat = 0;
    this._nextBeatTime = 0;
    this._disposed = false;

    // Lookahead scheduling constants
    this._scheduleAheadTime = 0.12; // seconds to look ahead
    this._timerInterval = 25;       // ms between scheduler calls

    // Nodes created during _buildGraph
    this._nodes = {};
    this._activeSources = new Set(); // track oscillators/noise for cleanup

    this._buildGraph();
  }

  // ─── Public API ─────────────────────────────────────────────────────────

  /**
   * The output GainNode. Connect this to `audioContext.destination` or other nodes.
   * @returns {GainNode}
   */
  get output() {
    return this._nodes.masterGain;
  }

  /**
   * Whether the engine is currently producing sound.
   * @returns {boolean}
   */
  get isPlaying() {
    return this._playing && !this._paused;
  }

  /**
   * The current tempo in beats per minute.
   * @returns {number}
   */
  get currentBpm() {
    return this._bpm;
  }

  /**
   * Set the beat tempo.
   * @param {number} bpm - Beats per minute (typically 60-90 for lo-fi).
   */
  setTempo(bpm) {
    this._bpm = Math.max(40, Math.min(200, bpm));
  }

  /**
   * Set the musical style.
   * @param {'lofi'|'jazzhop'|'ambient'} name
   */
  setStyle(name) {
    if (!CHORD_SETS[name]) return;
    this._style = name;
  }

  /**
   * Set the density (how many musical elements play).
   * @param {'sparse'|'normal'|'full'} level
   */
  setDensity(level) {
    if (!['whisper', 'sparse', 'normal', 'full'].includes(level)) return;
    this._density = level;
  }

  /**
   * Enable/disable sentence-aligned chord changes.
   * When enabled, chords only advance when advanceChord() is called.
   * @param {boolean} enabled
   */
  setSentenceAligned(enabled) {
    this._sentenceAligned = !!enabled;
    if (!enabled) {
      // Reset so fixed cycle takes over cleanly
      this._chordOverrideIdx = 0;
      this._pendingChordChange = false;
    }
  }

  /**
   * Advance to the next chord (used with sentence-aligned mode).
   */
  advanceChord() {
    if (!this._sentenceAligned) return;
    const chordSet = CHORD_SETS[this._style];
    this._chordOverrideIdx = ((this._chordOverrideIdx || 0) + 1) % chordSet.chords.length;
    this._pendingChordChange = true;
  }

  /**
   * Start playing the beat from the beginning.
   */
  start() {
    if (this._disposed) return;
    if (this._playing) this.stop();
    this._playing = true;
    this._paused = false;
    this._currentBeat = 0;
    this._nextBeatTime = this._ctx.currentTime + 0.05;
    this._startCrackle();
    this._startScheduler();
  }

  /**
   * Stop all sound and reset position.
   */
  stop() {
    this._playing = false;
    this._paused = false;
    this._stopScheduler();
    this._stopCrackle();
    this._currentBeat = 0;
    // Kill any ringing sources
    for (const src of this._activeSources) {
      try { src.stop(0); } catch (_) { /* already stopped */ }
    }
    this._activeSources.clear();
  }

  /**
   * Pause playback (keep position).
   */
  pause() {
    if (!this._playing || this._paused) return;
    this._paused = true;
    this._stopScheduler();
    this._stopCrackle();
  }

  /**
   * Resume from paused position.
   */
  resume() {
    if (!this._playing || !this._paused) return;
    this._paused = false;
    this._nextBeatTime = this._ctx.currentTime + 0.05;
    this._startCrackle();
    this._startScheduler();
  }

  /**
   * Clean up all audio nodes and timers.
   */
  dispose() {
    this.stop();
    this._disposed = true;
    // Disconnect all nodes
    const nodes = this._nodes;
    for (const key of Object.keys(nodes)) {
      try { nodes[key].disconnect(); } catch (_) { /* ok */ }
    }
    this._nodes = {};
  }

  // ─── Audio Graph Construction ───────────────────────────────────────────

  _buildGraph() {
    const ctx = this._ctx;
    const n = this._nodes;

    // ── Master output ──
    n.masterGain = ctx.createGain();
    n.masterGain.gain.value = 0.85;

    // ── Saturation (last in chain before master) ──
    n.saturation = ctx.createWaveShaper();
    n.saturation.curve = createSaturationCurve(1.5, 8192);
    n.saturation.oversample = '2x';
    n.saturation.connect(n.masterGain);

    // ── Reverb ──
    n.reverb = ctx.createConvolver();
    n.reverb.buffer = createReverbIR(ctx, 2.0, 0.6, 3000);
    n.reverbGain = ctx.createGain();
    n.reverbGain.gain.value = 0.3;
    n.reverb.connect(n.reverbGain);
    n.reverbGain.connect(n.saturation);

    // Dry path also feeds saturation
    n.dryGain = ctx.createGain();
    n.dryGain.gain.value = 0.75;
    n.dryGain.connect(n.saturation);

    // Reverb send point: splits into dry + wet
    n.reverbSend = ctx.createGain();
    n.reverbSend.gain.value = 1.0;
    n.reverbSend.connect(n.reverb);
    n.reverbSend.connect(n.dryGain);

    // ── Low-pass warmth filter ──
    n.warmthFilter = ctx.createBiquadFilter();
    n.warmthFilter.type = 'lowpass';
    n.warmthFilter.frequency.value = 6000;
    n.warmthFilter.Q.value = 0.7;
    n.warmthFilter.connect(n.reverbSend);

    // ── Tape wobble (LFO-modulated delay) ──
    n.tapeDelay = ctx.createDelay(0.05);
    n.tapeDelay.delayTime.value = 0.005; // 5ms base
    n.tapeLFO = ctx.createOscillator();
    n.tapeLFO.type = 'sine';
    n.tapeLFO.frequency.value = 0.7;
    n.tapeLFOGain = ctx.createGain();
    n.tapeLFOGain.gain.value = 0.003; // ±3ms depth
    n.tapeLFO.connect(n.tapeLFOGain);
    n.tapeLFOGain.connect(n.tapeDelay.delayTime);
    n.tapeLFO.start(0);
    n.tapeDelay.connect(n.warmthFilter);

    // ── Bitcrusher (staircase waveshaper — 12-bit equivalent) ──
    n.bitcrusher = ctx.createWaveShaper();
    n.bitcrusher.curve = createBitcrusherCurve(12);
    n.bitcrusher.oversample = 'none';
    n.bitcrusher.connect(n.tapeDelay);

    // ── Mix bus (all instruments feed here) ──
    n.mixBus = ctx.createGain();
    n.mixBus.gain.value = 1.0;
    n.mixBus.connect(n.bitcrusher);

    // ── Individual instrument buses ──
    n.drumBus = ctx.createGain();
    n.drumBus.gain.value = 0.8;
    n.drumBus.connect(n.mixBus);

    n.padBus = ctx.createGain();
    n.padBus.gain.value = 0.35;
    n.padBus.connect(n.mixBus);

    // LFO on pad filter for movement
    n.padFilter = ctx.createBiquadFilter();
    n.padFilter.type = 'lowpass';
    n.padFilter.frequency.value = 2000;
    n.padFilter.Q.value = 1.0;
    n.padFilter.connect(n.padBus);

    n.padFilterLFO = ctx.createOscillator();
    n.padFilterLFO.type = 'sine';
    n.padFilterLFO.frequency.value = 0.3;
    n.padFilterLFOGain = ctx.createGain();
    n.padFilterLFOGain.gain.value = 200; // ±200Hz
    n.padFilterLFO.connect(n.padFilterLFOGain);
    n.padFilterLFOGain.connect(n.padFilter.frequency);
    n.padFilterLFO.start(0);

    n.bassBus = ctx.createGain();
    n.bassBus.gain.value = 0.55;
    n.bassBus.connect(n.mixBus);

    // ── Vinyl crackle (separate path, very low volume) ──
    n.crackleBus = ctx.createGain();
    n.crackleBus.gain.value = 0.03; // ~-30dB
    n.crackleFilter = ctx.createBiquadFilter();
    n.crackleFilter.type = 'highpass';
    n.crackleFilter.frequency.value = 1000;
    n.crackleBus.connect(n.crackleFilter);
    n.crackleFilter.connect(n.saturation); // crackle bypasses reverb/bitcrusher
  }

  // ─── Scheduler ──────────────────────────────────────────────────────────

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
    while (this._nextBeatTime < now + this._scheduleAheadTime) {
      this._scheduleBeatsAt(this._nextBeatTime, this._currentBeat);
      this._advanceBeat();
    }
  }

  _advanceBeat() {
    const secondsPerBeat = 60.0 / this._bpm;
    this._nextBeatTime += secondsPerBeat;
    this._currentBeat = (this._currentBeat + 1) % 32;
  }

  /**
   * Schedule all instruments for a single beat at the given audio time.
   */
  _scheduleBeatsAt(time, beat) {
    const style = this._style;
    const density = this._density;
    const drumPat = DRUM_PATTERNS[style];
    const bassPat = BASS_PATTERNS[style];
    const chordSet = CHORD_SETS[style];
    const secondsPerBeat = 60.0 / this._bpm;

    // Determine which chord we're on
    let chordIndex;
    if (this._sentenceAligned) {
      chordIndex = (this._chordOverrideIdx || 0) % chordSet.chords.length;
    } else {
      chordIndex = Math.floor(beat / 8) % chordSet.chords.length;
    }
    const chord = chordSet.chords[chordIndex];

    // Swing offset for jazzhop hi-hats: delay every odd beat by 30%
    const swingOffset = (style === 'jazzhop' && beat % 2 === 1) ? secondsPerBeat * 0.3 : 0;

    // ── Drums (whisper = no drums at all) ──
    if (style !== 'ambient' && density !== 'whisper') {
      // Kick: always plays in normal/full; plays in sparse too
      if (drumPat.kick[beat]) {
        this._playKick(time);
      }

      // Snare: not in sparse
      if (density !== 'sparse' && drumPat.snare[beat]) {
        this._playSnare(time, style);
      }

      // Closed hi-hat: not in sparse
      if (density !== 'sparse' && drumPat.hatC[beat]) {
        this._playHiHatClosed(time + swingOffset);
      }

      // Open hi-hat: only in full
      if (density === 'full' && drumPat.hatO[beat]) {
        this._playHiHatOpen(time + swingOffset);
      }
    }

    // ── Chord pads ──
    let triggerPad = false;
    if (this._sentenceAligned) {
      // In sentence-aligned mode: trigger on pending chord change at nearest even beat
      if (this._pendingChordChange && beat % 2 === 0) {
        triggerPad = true;
        this._pendingChordChange = false;
      }
    } else {
      // Fixed 8-beat cycle
      triggerPad = (beat % 8 === 0);
    }

    if (triggerPad) {
      const padDuration = 8 * secondsPerBeat; // lasts 2 bars
      const padVol = density === 'whisper' ? 0.25 : density === 'sparse' ? 0.5 : density === 'normal' ? 0.75 : 1.0;
      const attackTime = style === 'ambient' ? 0.6 : 0.2;
      const releaseTime = style === 'ambient' ? 1.5 : 0.5;
      this._playChordPad(time, chord.notes, padDuration, padVol, attackTime, releaseTime);
    }

    // ── Bass (skip in whisper) ──
    if (density !== 'whisper' && bassPat[beat]) {
      const bassVol = style === 'ambient' ? 0.3 : (density === 'full' ? 0.9 : 0.65);
      const bassDur = style === 'ambient' ? secondsPerBeat * 3.5 : secondsPerBeat * 0.8;
      this._playBass(time, chord.root, bassDur, bassVol);
    }
  }

  // ─── Drum Synthesis ─────────────────────────────────────────────────────

  /**
   * Deep 808-style kick drum.
   */
  _playKick(time) {
    const ctx = this._ctx;

    // Triangle oscillator for the body (starts at 150Hz, sweeps to 55Hz)
    const osc1 = ctx.createOscillator();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(150, time);
    osc1.frequency.exponentialRampToValueAtTime(55, time + 0.07);

    // Sine oscillator for the sub (starts at 120Hz, sweeps to 40Hz)
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(120, time);
    osc2.frequency.exponentialRampToValueAtTime(40, time + 0.1);

    // Gain envelope
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.9, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.25);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this._nodes.drumBus);

    osc1.start(time);
    osc2.start(time);
    osc1.stop(time + 0.3);
    osc2.stop(time + 0.3);

    this._trackSource(osc1, time + 0.35);
    this._trackSource(osc2, time + 0.35);
  }

  /**
   * Snare drum — filtered noise burst + triangle body.
   * @param {number} time
   * @param {string} style - 'jazzhop' gets a brush-like lower filter
   */
  _playSnare(time, style) {
    const ctx = this._ctx;
    const noiseLen = 0.15;

    // Noise burst
    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * noiseLen, ctx.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseData.length; i++) {
      noiseData[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    // Bandpass filter on noise
    const noiseBP = ctx.createBiquadFilter();
    noiseBP.type = 'bandpass';
    noiseBP.frequency.value = style === 'jazzhop' ? 1800 : 3000;
    noiseBP.Q.value = 1.0;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(style === 'jazzhop' ? 0.4 : 0.6, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + noiseLen);

    noise.connect(noiseBP);
    noiseBP.connect(noiseGain);
    noiseGain.connect(this._nodes.drumBus);

    // Triangle body oscillator
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 180;

    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.35, time);
    oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);

    osc.connect(oscGain);
    oscGain.connect(this._nodes.drumBus);

    noise.start(time);
    osc.start(time);
    osc.stop(time + 0.15);

    this._trackSource(noise, time + 0.2);
    this._trackSource(osc, time + 0.2);
  }

  /**
   * Closed hi-hat — 6 detuned square oscillators at metallic frequency ratios.
   */
  _playHiHatClosed(time) {
    this._playHiHat(time, 0.05, 0.2);
  }

  /**
   * Open hi-hat — same as closed but longer decay.
   */
  _playHiHatOpen(time) {
    this._playHiHat(time, 0.3, 0.35);
  }

  _playHiHat(time, decayTime, volume) {
    const ctx = this._ctx;
    const fundamental = 40;
    const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21];

    const hatGain = ctx.createGain();
    hatGain.gain.setValueAtTime(volume, time);
    hatGain.gain.exponentialRampToValueAtTime(0.001, time + decayTime);

    // Highpass to keep only the metallic shimmer
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;

    // Bandpass for the body
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 10000;
    bp.Q.value = 1.0;

    hp.connect(bp);
    bp.connect(hatGain);
    hatGain.connect(this._nodes.drumBus);

    for (const ratio of ratios) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = fundamental * ratio;
      osc.connect(hp);
      osc.start(time);
      osc.stop(time + decayTime + 0.02);
      this._trackSource(osc, time + decayTime + 0.05);
    }
  }

  // ─── Chord Pad Synthesis ────────────────────────────────────────────────

  /**
   * Play a chord pad — multiple sine oscillators with subtle detuning, through
   * a low-pass filter with LFO modulation.
   */
  _playChordPad(time, noteFreqs, duration, volumeScale, attackTime, releaseTime) {
    const ctx = this._ctx;
    const endTime = time + duration;

    for (const freq of noteFreqs) {
      // Two oscillators per note with ±2 cent detuning for warmth
      for (const detune of [-2, 2]) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.detune.value = detune;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, time);
        // Attack
        gain.gain.linearRampToValueAtTime(volumeScale * 0.18 / noteFreqs.length, time + attackTime);
        // Sustain
        gain.gain.setValueAtTime(volumeScale * 0.18 / noteFreqs.length, endTime - releaseTime);
        // Release
        gain.gain.linearRampToValueAtTime(0.0001, endTime);

        osc.connect(gain);
        gain.connect(this._nodes.padFilter);

        osc.start(time);
        osc.stop(endTime + 0.05);
        this._trackSource(osc, endTime + 0.1);
      }
    }

    // Add a quiet sawtooth layer for harmonic richness (barely audible)
    const sawOsc = ctx.createOscillator();
    sawOsc.type = 'sawtooth';
    sawOsc.frequency.value = noteFreqs[0]; // root
    sawOsc.detune.value = -5;

    const sawFilter = ctx.createBiquadFilter();
    sawFilter.type = 'lowpass';
    sawFilter.frequency.value = 800; // very muffled
    sawFilter.Q.value = 0.5;

    const sawGain = ctx.createGain();
    sawGain.gain.setValueAtTime(0.0001, time);
    sawGain.gain.linearRampToValueAtTime(volumeScale * 0.04, time + attackTime);
    sawGain.gain.setValueAtTime(volumeScale * 0.04, endTime - releaseTime);
    sawGain.gain.linearRampToValueAtTime(0.0001, endTime);

    sawOsc.connect(sawFilter);
    sawFilter.connect(sawGain);
    sawGain.connect(this._nodes.padFilter);

    sawOsc.start(time);
    sawOsc.stop(endTime + 0.05);
    this._trackSource(sawOsc, endTime + 0.1);
  }

  // ─── Bass Synthesis ─────────────────────────────────────────────────────

  /**
   * Bass note — sine + quiet triangle harmonic layer.
   */
  _playBass(time, freq, duration, volumeScale) {
    const ctx = this._ctx;

    // Sine fundamental
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = freq;

    // Triangle harmonic (one octave up, much quieter)
    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = freq * 2;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(volumeScale * 0.5, time + 0.02); // quick attack
    gain.gain.setValueAtTime(volumeScale * 0.5, time + duration * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    const gain2 = ctx.createGain();
    gain2.gain.value = 0.2; // triangle layer at 20%

    osc1.connect(gain);
    osc2.connect(gain2);
    gain2.connect(gain);

    // Low-pass the bass to keep it smooth
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    lp.Q.value = 0.5;

    gain.connect(lp);
    lp.connect(this._nodes.bassBus);

    osc1.start(time);
    osc2.start(time);
    osc1.stop(time + duration + 0.05);
    osc2.stop(time + duration + 0.05);

    this._trackSource(osc1, time + duration + 0.1);
    this._trackSource(osc2, time + duration + 0.1);
  }

  // ─── Vinyl Crackle ──────────────────────────────────────────────────────

  _startCrackle() {
    if (this._crackleSource) return;
    const ctx = this._ctx;

    // Generate a long buffer of sparse random impulses
    const dur = 4; // 4 seconds, will loop
    const rate = ctx.sampleRate;
    const buf = ctx.createBuffer(1, rate * dur, rate);
    const data = buf.getChannelData(0);

    // Sparse crackle: about 30 impulses per second on average
    for (let i = 0; i < data.length; i++) {
      if (Math.random() < 30 / rate) {
        // Random impulse with variable amplitude
        data[i] = (Math.random() * 2 - 1) * (0.3 + Math.random() * 0.7);
        // Make it a tiny burst (2-3 samples)
        if (i + 1 < data.length) data[i + 1] = data[i] * -0.5;
        if (i + 2 < data.length) data[i + 2] = data[i] * 0.2;
      }
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this._nodes.crackleBus);
    src.start(0);
    this._crackleSource = src;
  }

  _stopCrackle() {
    if (this._crackleSource) {
      try { this._crackleSource.stop(0); } catch (_) { /* ok */ }
      this._crackleSource = null;
    }
  }

  // ─── Source Tracking (for cleanup) ──────────────────────────────────────

  _trackSource(source, expiresAt) {
    this._activeSources.add(source);
    // Self-cleanup after the note is done
    const cleanup = () => {
      this._activeSources.delete(source);
    };
    // Use the onended event
    source.onended = cleanup;
    // Safety fallback: remove after timeout
    const ms = Math.max(0, (expiresAt - this._ctx.currentTime) * 1000 + 500);
    setTimeout(cleanup, ms);
  }
}
