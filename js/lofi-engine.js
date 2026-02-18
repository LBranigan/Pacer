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
  A3: 220.00, Bb3: 233.08, B3: 246.94, C4: 261.63, Db4: 277.18,
  D4: 293.66, Eb4: 311.13, E4: 329.63, F4: 349.23, Gb4: 369.99,
  G4: 392.00, Ab4: 415.30, A4: 440.00, Bb4: 466.16, B4: 493.88,
  B2: 123.47, C5: 523.25, D5: 554.37
};

// ─── Chord definitions ──────────────────────────────────────────────────────
const CHORD_SETS = {
  lofi: {
    // ii-V-I-vi in C major: Dm7 → G7 → Cmaj7 → Am7
    chords: [
      { name: 'Dm7',   notes: [NOTE.D3, NOTE.F3, NOTE.A3, NOTE.C4], root: NOTE.D2,
        scale: [NOTE.D4, NOTE.E4, NOTE.F4, NOTE.G4, NOTE.A4, NOTE.C5] },
      { name: 'G7',    notes: [NOTE.G3, NOTE.B3, NOTE.D4, NOTE.F4], root: NOTE.G2,
        scale: [NOTE.G4, NOTE.A4, NOTE.B4, NOTE.D5, NOTE.F4, NOTE.E4] },
      { name: 'Cmaj7', notes: [NOTE.C3, NOTE.E3, NOTE.G3, NOTE.B3], root: NOTE.C2,
        scale: [NOTE.C4, NOTE.D4, NOTE.E4, NOTE.G4, NOTE.A4, NOTE.B4] },
      { name: 'Am7',   notes: [NOTE.A2, NOTE.C3, NOTE.E3, NOTE.G3], root: NOTE.A1,
        scale: [NOTE.A3, NOTE.B3, NOTE.C4, NOTE.D4, NOTE.E4, NOTE.G4] },
    ]
  },
  jazzhop: {
    // Add 9ths for richer jazz voicings: Dm9 → G13 → Cmaj9 → Am9
    chords: [
      { name: 'Dm9',   notes: [NOTE.D3, NOTE.F3, NOTE.A3, NOTE.C4, NOTE.E4], root: NOTE.D2,
        scale: [NOTE.D4, NOTE.E4, NOTE.F4, NOTE.G4, NOTE.A4, NOTE.C5] },
      { name: 'G13',   notes: [NOTE.G3, NOTE.B3, NOTE.D4, NOTE.F4, NOTE.E4], root: NOTE.G2,
        scale: [NOTE.G4, NOTE.A4, NOTE.B4, NOTE.D5, NOTE.F4, NOTE.E4] },
      { name: 'Cmaj9', notes: [NOTE.C3, NOTE.E3, NOTE.G3, NOTE.B3, NOTE.D4], root: NOTE.C2,
        scale: [NOTE.C4, NOTE.D4, NOTE.E4, NOTE.G4, NOTE.A4, NOTE.B4] },
      { name: 'Am9',   notes: [NOTE.A2, NOTE.C3, NOTE.E3, NOTE.G3, NOTE.B3], root: NOTE.A1,
        scale: [NOTE.A3, NOTE.B3, NOTE.C4, NOTE.D4, NOTE.E4, NOTE.G4] },
    ]
  },
  ambient: {
    // Same chords but we'll use longer envelopes and no drums
    chords: [
      { name: 'Dm7',   notes: [NOTE.D3, NOTE.F3, NOTE.A3, NOTE.C4], root: NOTE.D2,
        scale: [NOTE.D4, NOTE.E4, NOTE.F4, NOTE.G4, NOTE.A4, NOTE.C5] },
      { name: 'G7',    notes: [NOTE.G3, NOTE.B3, NOTE.D4, NOTE.F4], root: NOTE.G2,
        scale: [NOTE.G4, NOTE.A4, NOTE.B4, NOTE.D5, NOTE.F4, NOTE.E4] },
      { name: 'Cmaj7', notes: [NOTE.C3, NOTE.E3, NOTE.G3, NOTE.B3], root: NOTE.C2,
        scale: [NOTE.C4, NOTE.D4, NOTE.E4, NOTE.G4, NOTE.A4, NOTE.B4] },
      { name: 'Am7',   notes: [NOTE.A2, NOTE.C3, NOTE.E3, NOTE.G3], root: NOTE.A1,
        scale: [NOTE.A3, NOTE.B3, NOTE.C4, NOTE.D4, NOTE.E4, NOTE.G4] },
    ]
  },
  bossa: {
    // Bossa Nova: gentle Brazilian jazz — Dm9 → G7 → Cmaj9 → A7
    chords: [
      { name: 'Dm9',   notes: [NOTE.D3, NOTE.F3, NOTE.A3, NOTE.C4, NOTE.E4], root: NOTE.D2,
        scale: [NOTE.D4, NOTE.E4, NOTE.F4, NOTE.G4, NOTE.A4, NOTE.C5] },
      { name: 'G7',    notes: [NOTE.G3, NOTE.B3, NOTE.D4, NOTE.F4], root: NOTE.G2,
        scale: [NOTE.G4, NOTE.A4, NOTE.B4, NOTE.D5, NOTE.F4, NOTE.E4] },
      { name: 'Cmaj9', notes: [NOTE.C3, NOTE.E3, NOTE.G3, NOTE.B3, NOTE.D4], root: NOTE.C2,
        scale: [NOTE.C4, NOTE.D4, NOTE.E4, NOTE.G4, NOTE.A4, NOTE.B4] },
      { name: 'A7',    notes: [NOTE.A2, NOTE.Db4, NOTE.E3, NOTE.G3], root: NOTE.A1,
        scale: [NOTE.A3, NOTE.B3, NOTE.Db4, NOTE.D4, NOTE.E4, NOTE.G4] },
    ]
  },
  chiptune: {
    // 8-bit: simple triads, bright and playful
    chords: [
      { name: 'Dm',    notes: [NOTE.D3, NOTE.F3, NOTE.A3], root: NOTE.D2,
        scale: [NOTE.D4, NOTE.E4, NOTE.F4, NOTE.G4, NOTE.A4, NOTE.C5] },
      { name: 'G',     notes: [NOTE.G3, NOTE.B3, NOTE.D4], root: NOTE.G2,
        scale: [NOTE.G4, NOTE.A4, NOTE.B4, NOTE.C5, NOTE.D5] },
      { name: 'C',     notes: [NOTE.C3, NOTE.E3, NOTE.G3], root: NOTE.C2,
        scale: [NOTE.C4, NOTE.D4, NOTE.E4, NOTE.G4, NOTE.A4, NOTE.B4] },
      { name: 'Am',    notes: [NOTE.A2, NOTE.C3, NOTE.E3], root: NOTE.A1,
        scale: [NOTE.A3, NOTE.B3, NOTE.C4, NOTE.D4, NOTE.E4, NOTE.G4] },
    ]
  },
  classical: {
    // Classical Piano: gentle arpeggiated chords, Satie-inspired
    chords: [
      { name: 'Dm7',   notes: [NOTE.D3, NOTE.F3, NOTE.A3, NOTE.C4], root: NOTE.D2,
        scale: [NOTE.D4, NOTE.E4, NOTE.F4, NOTE.G4, NOTE.A4, NOTE.C5] },
      { name: 'G7',    notes: [NOTE.G3, NOTE.B3, NOTE.D4, NOTE.F4], root: NOTE.G2,
        scale: [NOTE.G4, NOTE.A4, NOTE.B4, NOTE.D5, NOTE.F4, NOTE.E4] },
      { name: 'Cmaj7', notes: [NOTE.C3, NOTE.E3, NOTE.G3, NOTE.B3], root: NOTE.C2,
        scale: [NOTE.C4, NOTE.D4, NOTE.E4, NOTE.G4, NOTE.A4, NOTE.B4] },
      { name: 'Am7',   notes: [NOTE.A2, NOTE.C3, NOTE.E3, NOTE.G3], root: NOTE.A1,
        scale: [NOTE.A3, NOTE.B3, NOTE.C4, NOTE.D4, NOTE.E4, NOTE.G4] },
    ]
  },
  trap: {
    // Trap: heavy 808s, rolling hats — darker voicings
    chords: [
      { name: 'Dm7',   notes: [NOTE.D3, NOTE.F3, NOTE.A3, NOTE.C4], root: NOTE.D2,
        scale: [NOTE.D4, NOTE.E4, NOTE.F4, NOTE.G4, NOTE.A4, NOTE.C5] },
      { name: 'Gm7',   notes: [NOTE.G3, NOTE.Bb3, NOTE.D4, NOTE.F4], root: NOTE.G2,
        scale: [NOTE.G4, NOTE.A4, NOTE.Bb4, NOTE.C5, NOTE.D5, NOTE.F4] },
      { name: 'Cm7',   notes: [NOTE.C3, NOTE.Eb4, NOTE.G3, NOTE.Bb3], root: NOTE.C2,
        scale: [NOTE.C4, NOTE.D4, NOTE.Eb4, NOTE.F4, NOTE.G4, NOTE.Bb4] },
      { name: 'Am7',   notes: [NOTE.A2, NOTE.C3, NOTE.E3, NOTE.G3], root: NOTE.A1,
        scale: [NOTE.A3, NOTE.B3, NOTE.C4, NOTE.D4, NOTE.E4, NOTE.G4] },
    ]
  }
};

// ─── Adaptive harmony chord quality sets ────────────────────────────────────
// Used when adaptive harmony is enabled: chord quality shifts with reading fluency.
// Each set has the same progression shape (ii-V-I-vi) but in different qualities.
const HARMONY_MOODS = {
  bright: {
    // Major 7ths — smooth, confident reading
    chords: [
      { name: 'Dm7',   notes: [NOTE.D3, NOTE.F3, NOTE.A3, NOTE.C4], root: NOTE.D2,
        scale: [NOTE.D4, NOTE.E4, NOTE.F4, NOTE.G4, NOTE.A4, NOTE.C5] },
      { name: 'G7',    notes: [NOTE.G3, NOTE.B3, NOTE.D4, NOTE.F4], root: NOTE.G2,
        scale: [NOTE.G4, NOTE.A4, NOTE.B4, NOTE.D5, NOTE.F4, NOTE.E4] },
      { name: 'Cmaj7', notes: [NOTE.C3, NOTE.E3, NOTE.G3, NOTE.B3], root: NOTE.C2,
        scale: [NOTE.C4, NOTE.D4, NOTE.E4, NOTE.G4, NOTE.A4, NOTE.B4] },
      { name: 'Am7',   notes: [NOTE.A2, NOTE.C3, NOTE.E3, NOTE.G3], root: NOTE.A1,
        scale: [NOTE.A3, NOTE.B3, NOTE.C4, NOTE.D4, NOTE.E4, NOTE.G4] },
    ]
  },
  warm: {
    // Minor 7ths — moderate difficulty, empathetic
    chords: [
      { name: 'Dm7',   notes: [NOTE.D3, NOTE.F3, NOTE.A3, NOTE.C4], root: NOTE.D2,
        scale: [NOTE.D4, NOTE.E4, NOTE.F4, NOTE.G4, NOTE.A4, NOTE.C5] },
      { name: 'Gm7',   notes: [NOTE.G3, NOTE.Bb3, NOTE.D4, NOTE.F4], root: NOTE.G2,
        scale: [NOTE.G4, NOTE.A4, NOTE.Bb4, NOTE.C5, NOTE.D5, NOTE.F4] },
      { name: 'Cm7',   notes: [NOTE.C3, NOTE.Eb4, NOTE.G3, NOTE.Bb3], root: NOTE.C2,
        scale: [NOTE.C4, NOTE.D4, NOTE.Eb4, NOTE.F4, NOTE.G4, NOTE.Bb4] },
      { name: 'Am7',   notes: [NOTE.A2, NOTE.C3, NOTE.E3, NOTE.G3], root: NOTE.A1,
        scale: [NOTE.A3, NOTE.B3, NOTE.C4, NOTE.D4, NOTE.E4, NOTE.G4] },
    ]
  },
  tender: {
    // Suspended / half-dim — struggling, but gentle (never harsh)
    chords: [
      { name: 'Dsus4', notes: [NOTE.D3, NOTE.G3, NOTE.A3, NOTE.C4], root: NOTE.D2,
        scale: [NOTE.D4, NOTE.F4, NOTE.G4, NOTE.A4, NOTE.C5] },
      { name: 'Gsus4', notes: [NOTE.G3, NOTE.C4, NOTE.D4, NOTE.F4], root: NOTE.G2,
        scale: [NOTE.G4, NOTE.Bb4, NOTE.C5, NOTE.D5, NOTE.F4] },
      { name: 'Csus2', notes: [NOTE.C3, NOTE.D3, NOTE.G3, NOTE.Bb3], root: NOTE.C2,
        scale: [NOTE.C4, NOTE.D4, NOTE.F4, NOTE.G4, NOTE.Bb4] },
      { name: 'Asus4', notes: [NOTE.A2, NOTE.D3, NOTE.E3, NOTE.G3], root: NOTE.A1,
        scale: [NOTE.A3, NOTE.C4, NOTE.D4, NOTE.E4, NOTE.G4] },
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
  },
  bossa: {
    // Bossa nova pattern: syncopated kick, rim clicks (via snare), gentle hats
    kick:    [1,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0],
    snare:   [0,0,1,0, 0,1,0,0, 0,0,1,0, 0,1,0,0, 0,0,1,0, 0,1,0,0, 0,0,1,0, 0,1,0,0],
    hatC:    [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
    hatO:    new Array(32).fill(0),
  },
  chiptune: {
    // 8-bit: punchy, simple, upbeat
    kick:    [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
    snare:   [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,1, 0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,1],
    hatC:    [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
    hatO:    [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,1],
  },
  classical: {
    // No drums — pure piano
    kick:    new Array(32).fill(0),
    snare:   new Array(32).fill(0),
    hatC:    new Array(32).fill(0),
    hatO:    new Array(32).fill(0),
  },
  trap: {
    // Trap: double kicks, hard claps, rolling hi-hats with open hat accents
    kick:    [1,0,0,1, 0,0,0,1, 1,0,1,0, 0,0,0,1, 1,0,0,1, 0,0,0,1, 1,0,1,0, 0,0,0,1],
    snare:   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1, 0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1],
    hatC:    [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
    hatO:    [0,0,1,0, 0,0,1,1, 0,0,1,0, 0,1,0,0, 0,0,1,0, 0,0,1,1, 0,0,1,0, 0,1,0,0],
  }
};

// Bass patterns (beat index → play root note). Per-style.
const BASS_PATTERNS = {
  lofi:      [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
  jazzhop:   [1,0,0,1, 1,0,0,1, 1,0,0,1, 1,0,0,1, 1,0,0,1, 1,0,0,1, 1,0,0,1, 1,0,0,1],
  ambient:   [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
  bossa:     [1,0,0,0, 0,0,1,0, 0,0,1,0, 0,0,0,0, 1,0,0,0, 0,0,1,0, 0,0,1,0, 0,0,0,0],
  chiptune:  [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
  classical: [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
  trap:      [1,0,0,0, 0,0,0,1, 1,0,0,0, 0,0,0,1, 1,0,0,0, 0,0,0,1, 1,0,0,0, 0,0,0,1],
};


// ─── Per-style synthesis config ─────────────────────────────────────────────
// Controls timbre, signal chain, and drum routing for each style.
const STYLE_CONFIG = {
  lofi: {
    padType: 'sine',        padFilterCutoff: 2000,   padAttack: 0.2,  padRelease: 0.5,
    bassType: 'sine',       bassFilterCutoff: 400,
    reverbWet: 0.3,         warmthCutoff: 6000,
    tapeWobbleDepth: 0.003, crusherBits: 12,
    kickStyle: 'standard',  snareStyle: 'standard',  hatStyle: 'standard',
  },
  jazzhop: {
    padType: 'triangle',    padFilterCutoff: 2800,   padAttack: 0.15, padRelease: 0.8,
    bassType: 'sine',       bassFilterCutoff: 500,
    reverbWet: 0.35,        warmthCutoff: 7000,
    tapeWobbleDepth: 0.002, crusherBits: 14,
    kickStyle: 'standard',  snareStyle: 'brush',     hatStyle: 'standard',
  },
  ambient: {
    padType: 'sine',        padFilterCutoff: 1200,   padAttack: 1.5,  padRelease: 2.0,
    bassType: 'sine',       bassFilterCutoff: 300,
    reverbWet: 0.6,         warmthCutoff: 4000,
    tapeWobbleDepth: 0.005, crusherBits: 16,
    kickStyle: 'none',      snareStyle: 'none',      hatStyle: 'none',
  },
  bossa: {
    padType: 'triangle',    padFilterCutoff: 3000,   padAttack: 0.1,  padRelease: 0.4,
    bassType: 'sine',       bassFilterCutoff: 450,
    reverbWet: 0.25,        warmthCutoff: 8000,
    tapeWobbleDepth: 0.001, crusherBits: 14,
    kickStyle: 'soft',      snareStyle: 'rim',       hatStyle: 'soft',
  },
  chiptune: {
    padType: 'square',      padFilterCutoff: 4000,   padAttack: 0.01, padRelease: 0.1,
    bassType: 'square',     bassFilterCutoff: 600,
    reverbWet: 0.1,         warmthCutoff: 10000,
    tapeWobbleDepth: 0.0,   crusherBits: 8,
    kickStyle: 'chip',      snareStyle: 'chip',      hatStyle: 'chip',
  },
  classical: {
    padType: 'sine',        padFilterCutoff: 3500,   padAttack: 0.6,  padRelease: 1.5,
    bassType: 'sine',       bassFilterCutoff: 350,
    reverbWet: 0.45,        warmthCutoff: 9000,
    tapeWobbleDepth: 0.0,   crusherBits: 16,
    kickStyle: 'none',      snareStyle: 'none',      hatStyle: 'none',
  },
  trap: {
    padType: 'sawtooth',    padFilterCutoff: 900,    padAttack: 0.02, padRelease: 0.15,
    bassType: 'sine',       bassFilterCutoff: 180,
    reverbWet: 0.08,        warmthCutoff: 3500,
    tapeWobbleDepth: 0.0,   crusherBits: 10,
    kickStyle: '808',       snareStyle: 'clap',      hatStyle: 'trap',
  },
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

    // Reactive crackle state
    this._crackleIntensity = 'light'; // light | medium | heavy
    this._crackleBufs = {};           // pre-rendered buffers per intensity

    // Micro-celebration state
    this._celebrationsEnabled = false;
    this._correctStreak = 0;

    // Melodic contour state
    this._melodyEnabled = false;

    // Adaptive harmony state
    this._adaptiveHarmonyEnabled = false;
    this._harmonyMood = 'bright'; // bright | warm | tender

    this._buildGraph();
    this._buildCrackleBuffers();
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
   * Position within the current beat (0–1).
   * @returns {number}
   */
  getBeatPhase() {
    if (!this._ctx || !this._playing) return 0;
    const beatDur = 60 / this._bpm;
    return (this._ctx.currentTime % beatDur) / beatDur;
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
   * @param {'lofi'|'jazzhop'|'ambient'|'bossa'|'chiptune'|'classical'|'trap'} name
   */
  setStyle(name) {
    if (!CHORD_SETS[name]) return;
    this._style = name;
    this._applyStyleConfig();
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

  // ─── Reactive Crackle ──────────────────────────────────────────────────

  /**
   * Set crackle intensity based on reading performance.
   * @param {'light'|'medium'|'heavy'} intensity
   */
  setCrackleIntensity(intensity) {
    if (!['light', 'medium', 'heavy'].includes(intensity)) return;
    if (intensity === this._crackleIntensity) return;
    this._crackleIntensity = intensity;
    // Scale crackle volume with intensity so heavy is unmistakable
    if (this._nodes.crackleBus) {
      const vol = intensity === 'heavy' ? 0.18 : intensity === 'medium' ? 0.12 : 0.06;
      this._nodes.crackleBus.gain.setTargetAtTime(vol, this._ctx.currentTime, 0.05);
    }
    // Hot-swap the crackle buffer if currently playing
    if (this._crackleSource && this._crackleBufs[intensity]) {
      this._stopCrackle();
      this._startCrackle();
    }
  }

  /**
   * Play a record-skip stutter (for struggle words).
   * Audible scratch + brief master volume dip to simulate vinyl skip.
   */
  playRecordSkip() {
    if (this._disposed || !this._playing) return;
    const ctx = this._ctx;
    const time = ctx.currentTime;

    // Dense crackle burst (longer, louder)
    const skipBuf = ctx.createBuffer(1, ctx.sampleRate * 0.15, ctx.sampleRate);
    const data = skipBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      if (Math.random() < 300 / ctx.sampleRate) {
        data[i] = (Math.random() * 2 - 1) * 1.0;
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

    // Brief master volume dip — "the record skipped"
    const master = this._nodes.masterGain;
    if (master) {
      master.gain.setValueAtTime(0.85, time);
      master.gain.linearRampToValueAtTime(0.5, time + 0.03);
      master.gain.linearRampToValueAtTime(0.85, time + 0.18);
    }
  }

  /**
   * Play a needle-drop thump (for recovery after pause).
   * Deep thump through the drum bus + crackle burst — unmistakable "we're back".
   */
  playNeedleDrop() {
    if (this._disposed || !this._playing) return;
    const ctx = this._ctx;
    const time = ctx.currentTime;

    // Deep thump through drum bus (not crackle bus) so it's properly audible
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

    // Crackle burst alongside
    const skipBuf = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate);
    const data = skipBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      if (Math.random() < 100 / ctx.sampleRate) {
        data[i] = (Math.random() * 2 - 1) * 0.6;
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = skipBuf;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.15, time);
    g2.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
    src.connect(g2);
    g2.connect(this._nodes.crackleFilter);
    src.start(time);
    this._trackSource(src, time + 0.15);
  }

  // ─── Micro-Celebrations ────────────────────────────────────────────────

  /**
   * Enable/disable micro-celebration sounds.
   * @param {boolean} enabled
   */
  setCelebrations(enabled) {
    this._celebrationsEnabled = !!enabled;
    if (!enabled) this._correctStreak = 0;
  }

  /**
   * Notify the engine of a word event (for streak tracking & celebrations).
   * @param {'correct'|'error'|'omission'|'self-correction'|'sentence-end'} event
   */
  notifyWordEvent(event) {
    if (this._disposed || !this._playing) return;
    const ctx = this._ctx;
    const time = ctx.currentTime;
    const chord = this._getCurrentChord();

    // Self-correction always plays (not gated by celebrations toggle)
    if (event === 'self-correction') {
      this._playResolutionPing(time, chord);
      return;
    }

    if (!this._celebrationsEnabled) return;

    if (event === 'correct') {
      this._correctStreak++;
      if (this._correctStreak === 5) {
        this._playStreakChime(time, chord);
      } else if (this._correctStreak > 5 && this._correctStreak % 3 === 0) {
        // Additional chimes every 3 words after initial streak
        this._playStreakChime(time, chord);
      }
    } else if (event === 'error' || event === 'omission') {
      this._correctStreak = 0;
    } else if (event === 'sentence-end') {
      this._playSentenceSwell(time);
    }
  }

  // ─── Melodic Contour ──────────────────────────────────────────────────

  /**
   * Enable/disable melodic contour (word-to-pitch mapping).
   * @param {boolean} enabled
   */
  setMelody(enabled) {
    this._melodyEnabled = !!enabled;
  }

  /**
   * Play a melodic ping for a word based on its speed tier.
   * @param {'quick'|'steady'|'slow'|'struggling'|'stalled'} tier - word speed tier
   * @param {boolean} isError - whether the word is an error
   */
  playMelodicPing(tier, isError) {
    if (!this._melodyEnabled || this._disposed || !this._playing) return;
    const ctx = this._ctx;
    const chord = this._getCurrentChord();
    if (!chord.scale || !chord.scale.length) return;

    const time = ctx.currentTime;
    const scale = chord.scale;

    // Map tier to scale degree (high = fast, low = slow)
    let noteIdx;
    if (tier === 'quick') noteIdx = scale.length - 1;       // highest
    else if (tier === 'steady') noteIdx = Math.floor(scale.length * 0.6);
    else if (tier === 'slow') noteIdx = Math.floor(scale.length * 0.3);
    else if (tier === 'struggling') noteIdx = 1;
    else noteIdx = 0;                                         // stalled = lowest

    let freq = scale[Math.min(noteIdx, scale.length - 1)];

    // Errors get a chromatic neighbor (half-step up) for dissonance
    if (isError) {
      freq = freq * Math.pow(2, 1 / 12); // semitone up
    }

    this._playMelodyNote(time, freq, isError ? 0.25 : 0.4, isError ? 0.15 : 0.22);
  }

  // ─── Adaptive Harmony ─────────────────────────────────────────────────

  /**
   * Enable/disable adaptive harmony (chord quality shifts with fluency).
   * @param {boolean} enabled
   */
  setAdaptiveHarmony(enabled) {
    this._adaptiveHarmonyEnabled = !!enabled;
    if (!enabled) this._harmonyMood = 'bright';
  }

  /**
   * Update the harmony mood based on rolling fluency score.
   * @param {number} fluencyScore - 0.0 (all errors) to 1.0 (all correct)
   */
  setHarmonyMood(fluencyScore) {
    if (!this._adaptiveHarmonyEnabled) return;
    let mood;
    if (fluencyScore >= 0.7) mood = 'bright';
    else if (fluencyScore >= 0.4) mood = 'warm';
    else mood = 'tender';
    this._harmonyMood = mood;
  }

  /**
   * The name of the current chord (e.g. 'Dm7').
   * @returns {string}
   */
  get currentChordName() {
    const chordSet = CHORD_SETS[this._style];
    const idx = this._sentenceAligned
      ? ((this._chordOverrideIdx || 0) % chordSet.chords.length)
      : (Math.floor(this._currentBeat / 8) % chordSet.chords.length);
    return chordSet.chords[idx].name;
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
    this._applyStyleConfig();
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
    this._applyStyleConfig();
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
    n.crackleBus.gain.value = 0.10; // audible crackle
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
   * Get the currently active chord (respects adaptive harmony).
   */
  _getCurrentChord() {
    const activeSet = this._getActiveChordSet();
    let chordIndex;
    if (this._sentenceAligned) {
      chordIndex = (this._chordOverrideIdx || 0) % activeSet.chords.length;
    } else {
      chordIndex = Math.floor(this._currentBeat / 8) % activeSet.chords.length;
    }
    return activeSet.chords[chordIndex];
  }

  /**
   * Get the active chord set (adaptive harmony overrides base style chords).
   */
  _getActiveChordSet() {
    if (this._adaptiveHarmonyEnabled && HARMONY_MOODS[this._harmonyMood]) {
      return HARMONY_MOODS[this._harmonyMood];
    }
    return CHORD_SETS[this._style];
  }

  /**
   * Schedule all instruments for a single beat at the given audio time.
   */
  _scheduleBeatsAt(time, beat) {
    const style = this._style;
    const density = this._density;
    const drumPat = DRUM_PATTERNS[style] || DRUM_PATTERNS.lofi;
    const bassPat = BASS_PATTERNS[style] || BASS_PATTERNS.lofi;
    const chordSet = this._getActiveChordSet();
    const secondsPerBeat = 60.0 / this._bpm;

    // Determine which chord we're on
    let chordIndex;
    if (this._sentenceAligned) {
      chordIndex = (this._chordOverrideIdx || 0) % chordSet.chords.length;
    } else {
      chordIndex = Math.floor(beat / 8) % chordSet.chords.length;
    }
    const chord = chordSet.chords[chordIndex];

    // Swing offset for jazzhop/bossa hi-hats: delay every odd beat by 30%
    const swingOffset = ((style === 'jazzhop' || style === 'bossa') && beat % 2 === 1)
      ? secondsPerBeat * 0.3 : 0;

    // ── Drums (whisper = no drums at all) ──
    const drumCfg = STYLE_CONFIG[style] || STYLE_CONFIG.lofi;
    if (drumCfg.kickStyle !== 'none' && density !== 'whisper') {
      // Kick
      if (drumPat.kick[beat]) {
        if (drumCfg.kickStyle === '808') this._playTrapKick(time);
        else if (drumCfg.kickStyle === 'soft') this._playKickSoft(time);
        else if (drumCfg.kickStyle === 'chip') this._playChipKick(time);
        else this._playKick(time);
      }

      // Snare: not in sparse
      if (density !== 'sparse' && drumPat.snare[beat]) {
        if (drumCfg.snareStyle === 'clap') this._playClap(time);
        else if (drumCfg.snareStyle === 'rim') this._playRimClick(time);
        else if (drumCfg.snareStyle === 'chip') this._playChipSnare(time);
        else this._playSnare(time, style);
      }

      // Closed hi-hat: not in sparse
      if (density !== 'sparse' && drumPat.hatC[beat]) {
        if (drumCfg.hatStyle === 'trap') this._playTrapHat(time + swingOffset, 0.04, 0.25);
        else if (drumCfg.hatStyle === 'chip') this._playChipHat(time + swingOffset);
        else if (drumCfg.hatStyle === 'soft') this._playHiHatSoft(time + swingOffset, 0.05, 0.2);
        else this._playHiHatClosed(time + swingOffset);
      }

      // Open hi-hat: only in full
      if (density === 'full' && drumPat.hatO[beat]) {
        if (drumCfg.hatStyle === 'trap') this._playTrapHat(time + swingOffset, 0.25, 0.35);
        else if (drumCfg.hatStyle === 'chip') this._playChipHat(time + swingOffset);
        else if (drumCfg.hatStyle === 'soft') this._playHiHatSoft(time + swingOffset, 0.3, 0.35);
        else this._playHiHatOpen(time + swingOffset);
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
      const cfg = STYLE_CONFIG[style] || STYLE_CONFIG.lofi;
      const attackTime = cfg.padAttack;
      const releaseTime = cfg.padRelease;

      if (style === 'chiptune') {
        this._playChipPad(time, chord.notes, padDuration, padVol);
      } else if (style === 'classical') {
        this._playArpeggio(time, chord.notes, padDuration, padVol, secondsPerBeat);
      } else {
        this._playChordPad(time, chord.notes, padDuration, padVol, attackTime, releaseTime);
      }
    }

    // ── Bass (skip in whisper) ──
    if (density !== 'whisper' && bassPat[beat]) {
      const bassVol = style === 'classical' ? 0.55
        : style === 'ambient' ? 0.3
        : style === 'trap' ? 1.0
        : style === 'bossa' ? 0.45
        : (density === 'full' ? 0.9 : 0.65);
      const bassDur = (style === 'ambient' || style === 'classical') ? secondsPerBeat * 3.5
        : style === 'trap' ? secondsPerBeat * 1.5
        : secondsPerBeat * 0.8;
      if (style === 'chiptune') {
        this._playChipBass(time, chord.root, secondsPerBeat * 0.6);
      } else {
        this._playBass(time, chord.root, bassDur, bassVol);
      }
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
    const cfg = STYLE_CONFIG[this._style] || STYLE_CONFIG.lofi;
    const oscType = cfg.padType;

    for (const freq of noteFreqs) {
      // Two oscillators per note with ±2 cent detuning for warmth
      for (const detune of [-2, 2]) {
        const osc = ctx.createOscillator();
        osc.type = oscType;
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
    const cfg = STYLE_CONFIG[this._style] || STYLE_CONFIG.lofi;

    // Fundamental oscillator (type from config)
    const osc1 = ctx.createOscillator();
    osc1.type = cfg.bassType || 'sine';
    osc1.frequency.value = freq;

    // Harmonic layer (one octave up, much quieter)
    const osc2 = ctx.createOscillator();
    osc2.type = cfg.bassType === 'sawtooth' ? 'sawtooth' : 'triangle';
    osc2.frequency.value = freq * 2;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(volumeScale * 0.5, time + 0.02);
    gain.gain.setValueAtTime(volumeScale * 0.5, time + duration * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    const gain2 = ctx.createGain();
    gain2.gain.value = 0.2;

    osc1.connect(gain);
    osc2.connect(gain2);
    gain2.connect(gain);

    // Low-pass filter (cutoff from config)
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cfg.bassFilterCutoff || 400;
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

  // ─── Style-Specific Synthesis ───────────────────────────────────────────

  /**
   * Heavy 808 trap kick — longer sustain, deeper sub.
   */
  _playTrapKick(time) {
    const ctx = this._ctx;

    // Main 808 body — starts high, sweeps deep
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, time);
    osc.frequency.exponentialRampToValueAtTime(28, time + 0.2);

    // Sub layer for extra weight
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(80, time);
    sub.frequency.exponentialRampToValueAtTime(30, time + 0.3);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(1.2, time);
    gain.gain.setValueAtTime(0.8, time + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.7);

    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.6, time);
    subGain.gain.exponentialRampToValueAtTime(0.001, time + 0.6);

    // Heavy distortion for punch
    const dist = ctx.createWaveShaper();
    dist.curve = createSaturationCurve(4.0, 1024);

    osc.connect(dist);
    sub.connect(subGain);
    subGain.connect(gain);
    dist.connect(gain);
    gain.connect(this._nodes.drumBus);

    osc.start(time);
    sub.start(time);
    osc.stop(time + 0.75);
    sub.stop(time + 0.65);
    this._trackSource(osc, time + 0.8);
    this._trackSource(sub, time + 0.7);
  }

  /**
   * Soft kick for bossa — lighter, higher, faster decay.
   */
  _playKickSoft(time) {
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(120, time);
    osc.frequency.exponentialRampToValueAtTime(60, time + 0.05);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.5, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);

    osc.connect(gain);
    gain.connect(this._nodes.drumBus);
    osc.start(time);
    osc.stop(time + 0.2);
    this._trackSource(osc, time + 0.25);
  }

  /**
   * Trap clap — layered noise bursts (classic 808 clap).
   */
  _playClap(time) {
    const ctx = this._ctx;
    const burstCount = 4;
    const burstGap = 0.012;

    for (let b = 0; b < burstCount; b++) {
      const t = time + b * burstGap;
      const dur = 0.04;
      const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1800;
      bp.Q.value = 0.5;

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.85, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

      src.connect(bp);
      bp.connect(g);
      g.connect(this._nodes.drumBus);
      src.start(t);
      this._trackSource(src, t + 0.12);
    }

    // Heavier tail with reverb-like decay
    const tailDur = 0.18;
    const tailBuf = ctx.createBuffer(1, ctx.sampleRate * tailDur, ctx.sampleRate);
    const tailData = tailBuf.getChannelData(0);
    for (let i = 0; i < tailData.length; i++) tailData[i] = Math.random() * 2 - 1;
    const tailSrc = ctx.createBufferSource();
    tailSrc.buffer = tailBuf;

    const tailBP = ctx.createBiquadFilter();
    tailBP.type = 'bandpass';
    tailBP.frequency.value = 1400;
    tailBP.Q.value = 0.4;

    const tailG = ctx.createGain();
    tailG.gain.setValueAtTime(0.6, time + burstCount * burstGap);
    tailG.gain.exponentialRampToValueAtTime(0.001, time + 0.3);

    tailSrc.connect(tailBP);
    tailBP.connect(tailG);
    tailG.connect(this._nodes.drumBus);
    tailSrc.start(time + burstCount * burstGap);
    this._trackSource(tailSrc, time + 0.35);
  }

  /**
   * Bossa rim click — short triangle ping, wooden stick sound.
   */
  _playRimClick(time) {
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 800;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.45, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);

    osc.connect(gain);
    gain.connect(this._nodes.drumBus);
    osc.start(time);
    osc.stop(time + 0.06);
    this._trackSource(osc, time + 0.08);
  }

  /**
   * Chiptune kick — square wave pitch drop.
   */
  _playChipKick(time) {
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(200, time);
    osc.frequency.exponentialRampToValueAtTime(40, time + 0.06);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.6, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);

    osc.connect(gain);
    gain.connect(this._nodes.drumBus);
    osc.start(time);
    osc.stop(time + 0.15);
    this._trackSource(osc, time + 0.18);
  }

  /**
   * Chiptune snare — short noise burst, harsh.
   */
  _playChipSnare(time) {
    const ctx = this._ctx;
    const dur = 0.06;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.5, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    src.connect(gain);
    gain.connect(this._nodes.drumBus);
    src.start(time);
    this._trackSource(src, time + dur + 0.05);
  }

  /**
   * Chiptune hi-hat — very short high-pitched square.
   */
  _playChipHat(time) {
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 12000;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.03);

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 8000;

    osc.connect(hp);
    hp.connect(gain);
    gain.connect(this._nodes.drumBus);
    osc.start(time);
    osc.stop(time + 0.05);
    this._trackSource(osc, time + 0.06);
  }

  /**
   * Trap hi-hat — higher pitched, sharper.
   */
  _playTrapHat(time, decayTime, volume) {
    const ctx = this._ctx;
    const fundamental = 80;
    const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21, 10.5];

    const hatGain = ctx.createGain();
    hatGain.gain.setValueAtTime(volume * 1.4, time);
    hatGain.gain.exponentialRampToValueAtTime(0.001, time + decayTime);

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 10000;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 13000;
    bp.Q.value = 2.0;

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

  /**
   * Soft hi-hat for bossa — gentler, lower volume.
   */
  _playHiHatSoft(time, decayTime, volume) {
    this._playHiHat(time, decayTime, volume * 0.5);
  }

  /**
   * Brush snare for jazzhop — already handled in _playSnare via style check,
   * but this provides a dedicated quieter path.
   */

  /**
   * Chiptune pad — square wave chords, 8-bit feel.
   */
  _playChipPad(time, noteFreqs, duration, volumeScale) {
    const ctx = this._ctx;
    const endTime = time + duration;

    for (const freq of noteFreqs) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = freq;

      // Pulse width via two detuned squares (pseudo-PWM)
      const osc2 = ctx.createOscillator();
      osc2.type = 'square';
      osc2.frequency.value = freq;
      osc2.detune.value = 7; // slight detune for width

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(volumeScale * 0.06 / noteFreqs.length, time + 0.01);
      gain.gain.setValueAtTime(volumeScale * 0.06 / noteFreqs.length, endTime - 0.1);
      gain.gain.linearRampToValueAtTime(0.0001, endTime);

      osc.connect(gain);
      osc2.connect(gain);
      gain.connect(this._nodes.padFilter);

      osc.start(time);
      osc2.start(time);
      osc.stop(endTime + 0.02);
      osc2.stop(endTime + 0.02);
      this._trackSource(osc, endTime + 0.05);
      this._trackSource(osc2, endTime + 0.05);
    }
  }

  /**
   * Chiptune bass — square wave, short and punchy.
   */
  _playChipBass(time, freq, duration) {
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.3, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;

    osc.connect(lp);
    lp.connect(gain);
    gain.connect(this._nodes.bassBus);

    osc.start(time);
    osc.stop(time + duration + 0.02);
    this._trackSource(osc, time + duration + 0.05);
  }

  /**
   * Classical arpeggio — notes played in sequence, Satie-style.
   */
  _playArpeggio(time, noteFreqs, duration, volumeScale, secondsPerBeat) {
    const ctx = this._ctx;
    const noteSpacing = secondsPerBeat * 0.5; // half-beat between arpeggio notes
    const noteDur = secondsPerBeat * 2; // each note rings for 2 beats

    for (let i = 0; i < noteFreqs.length; i++) {
      const noteTime = time + i * noteSpacing;
      const noteEnd = noteTime + noteDur;
      if (noteTime > time + duration) break;

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = noteFreqs[i];

      // Add a gentle triangle overtone
      const osc2 = ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.value = noteFreqs[i] * 2;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, noteTime);
      gain.gain.linearRampToValueAtTime(volumeScale * 0.45, noteTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, noteEnd);

      const gain2 = ctx.createGain();
      gain2.gain.value = 0.2;

      osc.connect(gain);
      osc2.connect(gain2);
      gain2.connect(gain);
      gain.connect(this._nodes.padFilter);

      osc.start(noteTime);
      osc2.start(noteTime);
      osc.stop(noteEnd + 0.05);
      osc2.stop(noteEnd + 0.05);
      this._trackSource(osc, noteEnd + 0.1);
      this._trackSource(osc2, noteEnd + 0.1);
    }
  }

  // ─── Celebration Synthesis ────────────────────────────────────────────

  /**
   * Rising pentatonic arpeggio for correct word streaks.
   */
  _playStreakChime(time, chord) {
    const ctx = this._ctx;
    const scale = chord.scale || [NOTE.C4, NOTE.D4, NOTE.E4, NOTE.G4, NOTE.A4];
    // Play 3 ascending notes from the chord scale
    for (let i = 0; i < 3; i++) {
      const noteTime = time + i * 0.08;
      const freq = scale[Math.min(i + 2, scale.length - 1)]; // start from 3rd scale degree

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, noteTime);
      gain.gain.linearRampToValueAtTime(0.22, noteTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.5);

      osc.connect(gain);
      gain.connect(this._nodes.padBus);
      osc.start(noteTime);
      osc.stop(noteTime + 0.55);
      this._trackSource(osc, noteTime + 0.6);
    }
  }

  /**
   * Bright rising 3-note sparkle arpeggio for self-corrections — "nice catch!"
   */
  _playResolutionPing(time, chord) {
    const ctx = this._ctx;
    const scale = chord.scale || [NOTE.C4, NOTE.D4, NOTE.E4, NOTE.G4, NOTE.A4];
    // Rising 3-note arpeggio: 1st → 3rd → 5th (bright, triumphant)
    const notes = [scale[0], scale[2], scale[4]];

    for (let i = 0; i < notes.length; i++) {
      const t = time + i * 0.09;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = notes[i];

      const osc2 = ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.value = notes[i] * 2; // octave shimmer

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.35, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);

      const g2 = ctx.createGain();
      g2.gain.value = 0.2;

      osc.connect(g);
      osc2.connect(g2);
      g2.connect(g);
      g.connect(this._nodes.padBus);

      osc.start(t);
      osc2.start(t);
      osc.stop(t + 0.75);
      osc2.stop(t + 0.75);
      this._trackSource(osc, t + 0.8);
      this._trackSource(osc2, t + 0.8);
    }
  }

  /**
   * Soft cymbal swell for sentence completion.
   */
  _playSentenceSwell(time) {
    const ctx = this._ctx;
    const dur = 0.6;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buf.getChannelData(0);

    // Filtered noise swell (cymbal-like)
    for (let i = 0; i < data.length; i++) {
      const env = Math.sin((i / data.length) * Math.PI); // bell curve
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6000;

    const gain = ctx.createGain();
    gain.gain.value = 0.14;

    src.connect(hp);
    hp.connect(gain);
    gain.connect(this._nodes.drumBus);

    src.start(time);
    this._trackSource(src, time + dur + 0.1);
  }

  // ─── Melody Note Synthesis ────────────────────────────────────────────

  /**
   * Play a single melodic ping (sine + quiet overtone).
   */
  _playMelodyNote(time, freq, duration, volume) {
    const ctx = this._ctx;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;

    // Quiet triangle overtone for warmth
    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = freq * 2;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(volume, time + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    const gain2 = ctx.createGain();
    gain2.gain.value = 0.15;

    osc.connect(gain);
    osc2.connect(gain2);
    gain2.connect(gain);
    gain.connect(this._nodes.padBus);

    osc.start(time);
    osc2.start(time);
    osc.stop(time + duration + 0.02);
    osc2.stop(time + duration + 0.02);
    this._trackSource(osc, time + duration + 0.05);
    this._trackSource(osc2, time + duration + 0.05);
  }

  // ─── Vinyl Crackle ──────────────────────────────────────────────────────

  /**
   * Pre-render crackle buffers at three intensity levels.
   */
  _buildCrackleBuffers() {
    const ctx = this._ctx;
    const dur = 4;
    const rate = ctx.sampleRate;

    for (const [intensity, impulseRate] of [['light', 20], ['medium', 60], ['heavy', 150]]) {
      const buf = ctx.createBuffer(1, rate * dur, rate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        if (Math.random() < impulseRate / rate) {
          const amp = intensity === 'heavy' ? (0.5 + Math.random() * 0.5) : (0.3 + Math.random() * 0.7);
          data[i] = (Math.random() * 2 - 1) * amp;
          if (i + 1 < data.length) data[i + 1] = data[i] * -0.5;
          if (i + 2 < data.length) data[i + 2] = data[i] * 0.2;
        }
      }
      this._crackleBufs[intensity] = buf;
    }
  }

  /**
   * Apply the current style's config to the live audio graph.
   */
  _applyStyleConfig() {
    const cfg = STYLE_CONFIG[this._style];
    if (!cfg || !this._nodes.warmthFilter) return;
    const n = this._nodes;
    n.warmthFilter.frequency.value = cfg.warmthCutoff;
    n.padFilter.frequency.value = cfg.padFilterCutoff;
    n.tapeLFOGain.gain.value = cfg.tapeWobbleDepth;
    n.reverbGain.gain.value = cfg.reverbWet;
    n.bitcrusher.curve = createBitcrusherCurve(cfg.crusherBits);
  }

  _startCrackle() {
    if (this._crackleSource) return;
    const ctx = this._ctx;

    // Use pre-rendered intensity-based buffer
    const buf = this._crackleBufs[this._crackleIntensity];
    if (!buf) return;

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
