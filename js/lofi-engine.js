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
  A1: 55, Eb2: 77.78, C2: 65.41, D2: 73.42, F2: 87.31, G2: 98.00, Ab2: 103.83, A2: 110.00, Bb2: 116.54,
  B2: 123.47, C3: 130.81, D3: 146.83, Eb3: 155.56, E3: 164.81, F3: 174.61, G3: 196.00, Ab3: 207.65,
  A3: 220.00, Bb3: 233.08, B3: 246.94, C4: 261.63, Db4: 277.18,
  D4: 293.66, Eb4: 311.13, E4: 329.63, F4: 349.23, Gb4: 369.99,
  G4: 392.00, Ab4: 415.30, A4: 440.00, Bb4: 466.16, B4: 493.88,
  C5: 523.25, D5: 554.37
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
  zelda: {
    // Heroic I-bVII-IV-V in Bb major
    chords: [
      { name: 'Bb',   notes: [NOTE.Bb3, NOTE.D4, NOTE.F4], root: NOTE.Bb2,
        scale: [NOTE.D4, NOTE.Eb4, NOTE.F4, NOTE.G4, NOTE.A4, NOTE.Bb4] },
      { name: 'Ab',   notes: [NOTE.Ab3, NOTE.C4, NOTE.Eb4], root: NOTE.Ab2,
        scale: [NOTE.Eb4, NOTE.F4, NOTE.G4, NOTE.Ab4, NOTE.Bb4, NOTE.C5] },
      { name: 'Eb',   notes: [NOTE.Eb3, NOTE.G3, NOTE.Bb3], root: NOTE.Eb2,
        scale: [NOTE.Eb4, NOTE.F4, NOTE.G4, NOTE.Ab4, NOTE.Bb4, NOTE.C5] },
      { name: 'F',    notes: [NOTE.F3, NOTE.A3, NOTE.C4], root: NOTE.F2,
        scale: [NOTE.C4, NOTE.D4, NOTE.F4, NOTE.G4, NOTE.A4, NOTE.Bb4] },
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
    // Authentic bossa nova: surdo kick + 3-2 clave cross-stick + steady 8th hats
    // Bar 1 (16 steps): kick on 1, &2, 4 | clave 3-side: 1, &1, &2
    // Bar 2 (16 steps): kick on 2, &3, 4 | clave 2-side: 2, 3
    kick:    [1,0,0,0, 0,1,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0, 0,1,0,0, 1,0,0,0],
    snare:   [1,0,1,0, 0,0,1,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 1,0,0,0, 1,0,0,0, 0,0,0,0],
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
  zelda: {
    // Steady march: kick on 1/3, snare on 2/4, 8th-note hats (every other step)
    kick:    [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
    snare:   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    hatC:    [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
    hatO:    new Array(32).fill(0),
  },
  classical: {
    // No drums — pure piano
    kick:    new Array(32).fill(0),
    snare:   new Array(32).fill(0),
    hatC:    new Array(32).fill(0),
    hatO:    new Array(32).fill(0),
  },
  trap: {
    // Trap (Bad and Boujee style): syncopated 808 kicks, clean backbeat claps, rolling hats
    kick:    [1,0,0,0, 0,0,1,0, 0,0,0,0, 1,0,0,1, 1,0,0,0, 0,0,1,0, 0,0,0,0, 1,0,0,1],
    snare:   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    hatC:    [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
    hatO:    [0,0,1,0, 0,0,1,1, 0,0,1,0, 0,1,0,0, 0,0,1,0, 0,0,1,1, 0,0,1,0, 0,1,0,0],
  }
};

// Trap hi-hat roll pattern: 0 = single hit, 3/4 = triplet/quadruplet roll
const TRAP_HAT_ROLLS = [0,0,0,3, 0,0,0,0, 0,0,3,0, 0,4,0,0, 0,0,0,3, 0,0,0,0, 0,0,3,0, 0,4,0,0];

// ─── Sample manifest ─────────────────────────────────────────────────────
// Maps style → drum slot → filename. Loaded at init, falls back to synthesis.
const SAMPLE_BASE_PATH = 'rhythm%20remix/samples';
const SAMPLE_MANIFEST = {
  trap:     { kick: 'kick.wav', snare: 'clap.wav', hatClosed: 'hat-closed.wav', hatOpen: 'hat-open.wav' },
  lofi:     { kick: 'kick.wav', snare: 'snare.wav', hatClosed: 'hat-closed.wav', hatOpen: 'hat-open.wav' },
  jazzhop:  { kick: 'kick.wav', snare: 'snare.wav', hatClosed: 'hat-closed.wav', hatOpen: 'hat-open.wav' },
  bossa:    { kick: 'kick.wav', snare: 'rim.wav',   hatClosed: 'hat-closed.wav', hatOpen: 'hat-open.wav' },
  chiptune: { kick: 'kick.wav', snare: 'snare.wav', hatClosed: 'hat-closed.wav', hatOpen: 'hat-open.wav' },
  zelda:    { kick: 'kick.wav', snare: 'snare.wav', hatClosed: 'hat-closed.wav', hatOpen: 'hat-open.wav' },
};

// Bass patterns (beat index → play root note). Per-style.
const BASS_PATTERNS = {
  lofi:      [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
  jazzhop:   [1,0,0,1, 1,0,0,1, 1,0,0,1, 1,0,0,1, 1,0,0,1, 1,0,0,1, 1,0,0,1, 1,0,0,1],
  ambient:   [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
  bossa:     [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0, 1,0,0,0, 0,0,0,0, 0,0,1,0],
  chiptune:  [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
  zelda:     [1,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,1,0],
  classical: [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
  trap:      [1,0,0,0, 0,0,0,1, 1,0,0,0, 0,0,0,1, 1,0,0,0, 0,0,0,1, 1,0,0,0, 0,0,0,1],
};


// ─── Overlay drum patterns (complementary — fill gaps in main patterns) ────
// Ghost kicks and snares on beats where the main pattern is silent.
const OVERLAY_DRUM_PATTERNS = {
  lofi: {
    // Ghost kick on "and-of-2"; ghost snares on upbeats around main snare
    kick:  [0,0,0,0, 0,1,0,0, 0,0,0,0, 0,1,0,0, 0,0,0,0, 0,1,0,0, 0,0,0,0, 0,1,0,0],
    snare: [0,1,0,1, 0,0,0,0, 0,1,0,1, 0,0,0,0, 0,1,0,1, 0,0,0,0, 0,1,0,1, 0,0,0,0],
    // L2: denser ghost hits
    kickL2:  [0,0,0,1, 0,1,0,0, 0,0,0,1, 0,1,0,0, 0,0,0,1, 0,1,0,0, 0,0,0,1, 0,1,0,0],
    snareL2: [0,1,0,1, 0,1,0,0, 0,1,0,1, 0,1,0,0, 0,1,0,1, 0,1,0,0, 0,1,0,1, 0,1,0,0],
    // L3: syncopated fill — nearly every gap
    kickL3:  [0,0,0,1, 0,1,0,1, 0,0,0,1, 0,1,0,1, 0,0,0,1, 0,1,0,1, 0,0,0,1, 0,1,0,1],
    snareL3: [0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,0, 0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,0],
    // L4 (+20): maximum density
    kickL4:  [0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1],
    snareL4: [0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1],
  },
  jazzhop: {
    kick:  [0,0,0,1, 0,1,0,0, 0,0,0,1, 0,1,0,0, 0,0,0,1, 0,1,0,0, 0,0,0,1, 0,1,0,0],
    snare: [0,1,0,0, 0,1,0,0, 0,1,0,0, 0,0,0,0, 0,1,0,0, 0,1,0,0, 0,1,0,0, 0,0,0,0],
  },
  ambient: {
    kick:  new Array(32).fill(0),
    snare: new Array(32).fill(0),
  },
  bossa: {
    // Overlay fills gaps in new authentic bossa pattern
    // Main kick: 0,5,12,20,25,28 | Main snare: 0,2,6,20,24
    // L1: ghost kicks between surdo hits, extra rim accents
    kick:  [0,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    snare: [0,0,0,0, 0,0,0,0, 0,0,1,0, 0,1,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0, 0,1,0,0],
    // L2: more ghost kicks + denser rim
    kickL2:  [0,0,1,0, 0,0,0,0, 1,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0, 0,0,0,0],
    snareL2: [0,0,0,1, 0,0,0,0, 0,0,1,0, 0,1,0,1, 0,0,1,0, 0,0,1,0, 0,0,0,1, 0,1,0,0],
    // L3: dense syncopated — nearly every gap filled
    kickL3:  [0,0,1,0, 0,0,0,1, 1,0,1,0, 0,0,0,1, 0,0,1,0, 0,0,0,1, 0,0,1,0, 0,0,0,1],
    snareL3: [0,0,0,1, 0,1,0,1, 0,0,1,0, 0,1,0,1, 0,1,0,1, 0,0,1,0, 0,0,0,1, 0,1,0,1],
    // L4 (+20): maximum density — every available gap
    kickL4:  [0,0,1,1, 0,0,0,1, 1,0,1,1, 0,0,0,1, 0,0,1,1, 0,0,0,1, 0,0,1,1, 0,0,0,1],
    snareL4: [0,0,0,1, 0,1,0,1, 1,0,1,1, 0,1,0,1, 0,1,0,1, 0,0,1,1, 0,0,0,1, 0,1,0,1],
  },
  chiptune: {
    kick:  [0,0,0,1, 0,1,0,0, 0,0,0,1, 0,1,0,0, 0,0,0,1, 0,1,0,0, 0,0,0,1, 0,1,0,0],
    snare: [0,1,0,0, 0,1,0,0, 0,1,0,0, 0,1,0,0, 0,1,0,0, 0,1,0,0, 0,1,0,0, 0,1,0,0],
    // L2: syncopated ghost hits
    kickL2:  [0,0,0,1, 0,1,0,1, 0,0,0,1, 0,1,0,1, 0,0,0,1, 0,1,0,1, 0,0,0,1, 0,1,0,1],
    snareL2: [0,1,0,0, 0,1,0,1, 0,1,0,0, 0,1,0,1, 0,1,0,0, 0,1,0,1, 0,1,0,0, 0,1,0,1],
    // L3: dense 8-bit fills
    kickL3:  [0,0,1,1, 0,1,0,1, 0,0,1,1, 0,1,0,1, 0,0,1,1, 0,1,0,1, 0,0,1,1, 0,1,0,1],
    snareL3: [0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,0, 0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,0],
    // L4: maximum chiptune chaos
    kickL4:  [0,1,1,1, 0,1,0,1, 0,1,1,1, 0,1,0,1, 0,1,1,1, 0,1,0,1, 0,1,1,1, 0,1,0,1],
    snareL4: [0,1,0,1, 0,1,1,1, 0,1,0,1, 0,1,1,0, 0,1,0,1, 0,1,1,1, 0,1,0,1, 0,1,1,0],
  },
  zelda: {
    // Ghost hits filling gaps in march pattern
    kick:  [0,0,0,0, 0,1,0,0, 0,0,0,0, 0,1,0,0, 0,0,0,0, 0,1,0,0, 0,0,0,0, 0,1,0,0],
    snare: [0,0,1,0, 0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0, 0,0,0,0],
    // L2: more syncopation
    kickL2:  [0,0,0,1, 0,1,0,0, 0,0,0,1, 0,1,0,0, 0,0,0,1, 0,1,0,0, 0,0,0,1, 0,1,0,0],
    snareL2: [0,0,1,0, 0,0,0,1, 0,0,1,0, 0,0,0,1, 0,0,1,0, 0,0,0,1, 0,0,1,0, 0,0,0,1],
    // L3: denser march fills
    kickL3:  [0,0,1,1, 0,1,0,0, 0,0,1,1, 0,1,0,0, 0,0,1,1, 0,1,0,0, 0,0,1,1, 0,1,0,0],
    snareL3: [0,0,1,0, 0,0,1,1, 0,0,1,0, 0,0,1,1, 0,0,1,0, 0,0,1,1, 0,0,1,0, 0,0,1,1],
    // L4: full march — never frantic
    kickL4:  [0,0,1,1, 0,1,0,1, 0,0,1,1, 0,1,0,1, 0,0,1,1, 0,1,0,1, 0,0,1,1, 0,1,0,1],
    snareL4: [0,1,1,0, 0,0,1,1, 0,1,1,0, 0,0,1,1, 0,1,1,0, 0,0,1,1, 0,1,1,0, 0,0,1,1],
  },
  classical: {
    kick:  new Array(32).fill(0),
    snare: new Array(32).fill(0),
  },
  trap: {
    // Extra 808 ghost kicks and off-beat clap accents
    kick:  [0,0,1,0, 0,0,0,0, 0,1,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0, 0,1,0,0, 0,0,0,0],
    snare: [0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,0],
  },
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
  zelda: {
    padType: 'square',      padFilterCutoff: 3500,   padAttack: 0.01, padRelease: 0.1,
    bassType: 'square',     bassFilterCutoff: 600,
    reverbWet: 0.30,        warmthCutoff: 7000,
    tapeWobbleDepth: 0.0,   crusherBits: 10,
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
    this._targetBpm = undefined; // set by setTempoSmoothed()
    this._overlayLevel = 0;      // 0-1, complementary second track
    this._style = 'lofi';
    this._pianoOverlay = false;
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

    // Sample playback: style → slot → AudioBuffer (loaded async)
    this._samples = {};

    this._buildGraph();
    this._buildCrackleBuffers();
    this._loadSamples(); // async, non-blocking — synthesis fallback until loaded
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
    const now = this._ctx.currentTime;
    const beatDur = 60 / this._bpm;
    const beatStart = this._nextBeatTime - beatDur;
    const elapsed = now - beatStart;
    return Math.max(0, Math.min(1, elapsed / beatDur));
  }

  /**
   * Set the beat tempo.
   * @param {number} bpm - Beats per minute (typically 60-90 for lo-fi).
   */
  setTempo(bpm) {
    this._bpm = Math.max(40, Math.min(200, bpm));
    this._targetBpm = undefined; // cancel any smoothed target
  }

  /**
   * Set a tempo target that the engine moves toward one beat at a time.
   * Asymmetric smoothing: speeds up faster than it slows down.
   * @param {number} targetBpm
   */
  setTempoSmoothed(targetBpm) {
    this._targetBpm = Math.max(40, Math.min(200, targetBpm));
  }

  /**
   * Set the overlay layer level — controls how rich the existing instruments sound.
   * More notes in chords, more drum hits, denser patterns.
   * @param {number} level - 0.0 to 1.5
   */
  setOverlayLevel(level) {
    this._overlayLevel = Math.max(0, Math.min(1.5, level));
    if (this._nodes.overlayBus && this._ctx) {
      const now = this._ctx.currentTime;
      this._nodes.overlayBus.gain.cancelScheduledValues(now);
      // Minimum 0.6 when active so overlay drums are clearly audible at all levels
      const busGain = this._overlayLevel > 0
        ? Math.min(1.0, 0.6 + this._overlayLevel * 0.3)
        : 0;
      this._nodes.overlayBus.gain.setTargetAtTime(busGain, now, 0.15);
    }
  }

  /** @returns {number} Current overlay level 0-1. */
  get overlayLevel() {
    return this._overlayLevel;
  }

  /**
   * Set the musical style.
   * @param {'lofi'|'jazzhop'|'ambient'|'bossa'|'chiptune'|'classical'|'trap'} name
   */
  setStyle(name) {
    // Compound styles: "bossa-piano", "chiptune-piano", "jazzhop-piano"
    const pianoSuffix = '-piano';
    if (name.endsWith(pianoSuffix)) {
      const base = name.slice(0, -pianoSuffix.length);
      if (!CHORD_SETS[base]) return;
      this._style = base;
      this._pianoOverlay = true;
    } else {
      if (!CHORD_SETS[name]) return;
      this._style = name;
      this._pianoOverlay = false;
    }
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
      const s = this._correctStreak;
      if (s === 3 || (s > 3 && s % 3 === 0)) {
        this._playStreakChime(time, chord, s);
      }
      // Drum fill at streak 10, then every 5 words after 15
      if (s === 10 || (s >= 15 && s % 5 === 0)) {
        this._playStreakFill(time);
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

    // ── Bus compressor (glue before master) ──
    n.busCompressor = ctx.createDynamicsCompressor();
    n.busCompressor.threshold.value = -18;
    n.busCompressor.knee.value = 8;
    n.busCompressor.ratio.value = 3;
    n.busCompressor.attack.value = 0.006;
    n.busCompressor.release.value = 0.15;
    n.busCompressor.connect(n.masterGain);

    // ── Saturation (last in chain before compressor) ──
    n.saturation = ctx.createWaveShaper();
    n.saturation.curve = createSaturationCurve(1.5, 8192);
    n.saturation.oversample = '2x';
    n.saturation.connect(n.busCompressor);

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
    // Sidechain ducker on pad bus (gain dips on kick hits)
    n.padDucker = ctx.createGain();
    n.padDucker.gain.value = 1.0;
    n.padBus.connect(n.padDucker);
    n.padDucker.connect(n.mixBus);

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
    // Sidechain ducker on bass bus (gain dips on kick hits)
    n.bassDucker = ctx.createGain();
    n.bassDucker.gain.value = 1.0;
    n.bassBus.connect(n.bassDucker);
    n.bassDucker.connect(n.mixBus);

    // ── Vinyl crackle (separate path, very low volume) ──
    n.crackleBus = ctx.createGain();
    n.crackleBus.gain.value = 0.10; // audible crackle
    n.crackleFilter = ctx.createBiquadFilter();
    n.crackleFilter.type = 'highpass';
    n.crackleFilter.frequency.value = 1000;
    n.crackleBus.connect(n.crackleFilter);
    n.crackleFilter.connect(n.saturation); // crackle bypasses reverb/bitcrusher

    // ── Overlay layer bus (complementary second track) ──
    n.overlayBus = ctx.createGain();
    n.overlayBus.gain.value = 0;
    n.overlayBus.connect(n.mixBus);

    // Pre-render noise buffers (reused per hit, varied via playbackRate)
    const shakerDur = 0.04;
    const shakerSamples = Math.ceil(ctx.sampleRate * shakerDur);
    n.shakerBuf = ctx.createBuffer(1, shakerSamples, ctx.sampleRate);
    const shakerData = n.shakerBuf.getChannelData(0);
    for (let i = 0; i < shakerSamples; i++) {
      shakerData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (shakerSamples * 0.3));
    }

    const ghostSnareDur = 0.08;
    const ghostSnareSamples = Math.ceil(ctx.sampleRate * ghostSnareDur);
    n.ghostSnareBuf = ctx.createBuffer(1, ghostSnareSamples, ctx.sampleRate);
    const gsData = n.ghostSnareBuf.getChannelData(0);
    for (let i = 0; i < ghostSnareSamples; i++) {
      gsData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ghostSnareSamples * 0.25));
    }
  }

  // ─── Sample Loading ────────────────────────────────────────────────────

  /**
   * Load all drum samples asynchronously. Non-blocking — synthesis fallback
   * works until samples finish loading. Silent failure on missing files.
   */
  async _loadSamples() {
    for (const [style, slots] of Object.entries(SAMPLE_MANIFEST)) {
      this._samples[style] = {};
      for (const [slot, filename] of Object.entries(slots)) {
        const url = `${SAMPLE_BASE_PATH}/${style}/${filename}`;
        try {
          const resp = await fetch(url);
          if (!resp.ok) continue;
          const arrayBuf = await resp.arrayBuffer();
          this._samples[style][slot] = await this._ctx.decodeAudioData(arrayBuf);
        } catch (e) {
          // Silent: synthesis fallback handles it
        }
      }
    }
  }

  /**
   * Play a loaded sample at the given time. Returns true if played, false if
   * no sample loaded (caller should fall back to synthesis).
   * @param {string} slot - 'kick', 'snare', 'hatClosed', 'hatOpen'
   * @param {number} time - AudioContext time
   * @param {number} [volume=1.0] - gain multiplier
   * @param {number} [pitchShift=0] - cents of random pitch humanization
   * @returns {boolean}
   */
  _playSample(slot, time, volume = 1.0, pitchShift = 0) {
    const style = this._style || 'lofi';
    const buf = this._samples[style]?.[slot];
    if (!buf) return false;

    const ctx = this._ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;

    // Subtle pitch humanization (±pitchShift cents)
    if (pitchShift > 0) {
      const cents = (Math.random() * 2 - 1) * pitchShift;
      src.playbackRate.value = Math.pow(2, cents / 1200);
    }

    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain);
    gain.connect(this._nodes.drumBus);

    src.start(time);
    this._activeSources.add(src);
    src.onended = () => this._activeSources.delete(src);
    return true;
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
    // Smoothed tempo: move toward target BPM per beat
    if (this._targetBpm !== undefined && this._targetBpm !== this._bpm) {
      const diff = this._targetBpm - this._bpm;
      if (Math.abs(diff) < 0.5) {
        this._bpm = this._targetBpm;
      } else {
        // Asymmetric: speed up faster (0.35) than slow down (0.20)
        const alpha = diff > 0 ? 0.35 : 0.20;
        this._bpm += diff * alpha;
      }
    }
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
        this._duckSidechain(time);
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
        if (drumCfg.hatStyle === 'trap') {
          // Check for hi-hat roll on this beat
          const rollCount = (density !== 'sparse') ? TRAP_HAT_ROLLS[beat] : 0;
          if (rollCount > 0) {
            this._playHiHatRoll(time + swingOffset, rollCount, secondsPerBeat, 0.25);
          } else {
            this._playTrapHat(time + swingOffset, 0.04, 0.25);
          }
        }
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

      // Lofi ghost hi-hats: subtle off-beat 8th notes at full density
      if (style === 'lofi' && density === 'full' && drumPat.hatC[beat]) {
        this._playHiHat(time + secondsPerBeat * 0.5, 0.04, 0.08);
      }

      // Bossa shaker: continuous "ch-ch-ch-ch" on every beat
      if (style === 'bossa' && density !== 'whisper') {
        this._playShaker(time);
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

      // Extend chord notes based on overlay level — same signal chain, more notes
      let padNotes = chord.notes;
      const ol = this._overlayLevel;
      if (ol > 0) {
        padNotes = [...chord.notes];
        const octUp = chord.notes.map(f => f * 2); // octave-up doublings
        if (ol >= 1.5) {
          // Level 4 (+20): all doublings + 9th + two octaves up root/5th
          padNotes.push(...octUp);
          if (chord.scale && chord.scale.length >= 2) {
            padNotes.push(chord.scale[1] * 2); // 9th, octave up
          }
          padNotes.push(chord.notes[0] * 4); // root two octaves up
          if (chord.notes.length >= 3) padNotes.push(chord.notes[2] * 4); // 5th two octaves up
        } else if (ol >= 1.0) {
          // Level 3 (+15): all octave doublings + 9th extension
          padNotes.push(...octUp);
          if (chord.scale && chord.scale.length >= 2) {
            padNotes.push(chord.scale[1] * 2); // 9th, octave up
          }
        } else if (ol >= 0.65) {
          // Level 2 (+10): all octave-up doublings
          padNotes.push(...octUp);
        } else {
          // Level 1 (+5): root + 5th doubled up an octave
          padNotes.push(octUp[0]);
          if (octUp.length >= 3) padNotes.push(octUp[2]);
        }
      }

      if (style === 'chiptune' || style === 'zelda') {
        this._playChipPad(time, padNotes, padDuration, padVol);
      } else if (style === 'classical') {
        this._playArpeggio(time, padNotes, padDuration, padVol, secondsPerBeat);
      } else {
        this._playChordPad(time, padNotes, padDuration, padVol, attackTime, releaseTime);
      }
    }

    // ── Bass (skip in whisper) ──
    if (density !== 'whisper' && bassPat[beat]) {
      const bassVol = style === 'classical' ? 0.55
        : style === 'ambient' ? 0.3
        : style === 'trap' ? 1.0
        : style === 'bossa' ? 0.55
        : (density === 'full' ? 0.9 : 0.65);
      const bassDur = (style === 'ambient' || style === 'classical') ? secondsPerBeat * 3.5
        : style === 'trap' ? secondsPerBeat * 2.5
        : style === 'bossa' ? secondsPerBeat * 1.2
        : secondsPerBeat * 0.8;
      if (style === 'chiptune' || style === 'zelda') {
        this._playChipBass(time, chord.root, secondsPerBeat * 0.6);
      } else {
        this._playBass(time, chord.root, bassDur, bassVol);
      }
    }

    // ── Overlay layer (complementary octave-up track) ──
    if (this._overlayLevel > 0) {
      this._scheduleOverlay(time, beat, chord, secondsPerBeat);
    }
  }

  // ─── Sidechain Ducking ──────────────────────────────────────────────────

  /**
   * Duck pad and bass buses on kick hits for that professional "pump" effect.
   * Style-aware parameters: trap = short/deep, lofi = medium/pumpy, bossa = subtle.
   */
  _duckSidechain(time) {
    const n = this._nodes;
    if (!n.padDucker || !n.bassDucker) return;

    const style = this._style || 'lofi';
    // Style-specific duck parameters: [duckDepth, attackMs, releaseMs]
    const params = {
      trap:      [0.15, 5, 100],   // Deep, fast — 808 pump
      lofi:      [0.25, 8, 180],   // Medium depth, longer release — vinyl pump
      jazzhop:   [0.30, 8, 160],   // Subtle
      bossa:     [0.50, 10, 120],  // Very subtle
      ambient:   [0.35, 10, 250],  // Gentle, slow release
      classical: [0.45, 8, 150],   // Moderate
      chiptune:  [0.20, 3, 80],    // Tight, retro
      zelda:     [0.25, 5, 100],   // SNES dungeon pump
    };
    const [depth, atkMs, relMs] = params[style] || params.lofi;
    const atk = atkMs / 1000;
    const rel = relMs / 1000;

    // Duck both pad and bass buses
    for (const ducker of [n.padDucker, n.bassDucker]) {
      ducker.gain.cancelScheduledValues(time);
      ducker.gain.setValueAtTime(1.0, time);
      ducker.gain.linearRampToValueAtTime(depth, time + atk);
      ducker.gain.linearRampToValueAtTime(1.0, time + atk + rel);
    }
  }

  // ─── Drum Synthesis ─────────────────────────────────────────────────────

  /**
   * Deep 808-style kick drum.
   */
  _playKick(time) {
    if (this._playSample('kick', time, 0.9, 8)) return;
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
    if (this._playSample('snare', time, 0.85, 12)) return;
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
    if (this._playSample('hatClosed', time, 0.7, 15)) return;
    this._playHiHat(time, 0.05, 0.2);
  }

  /**
   * Open hi-hat — same as closed but longer decay.
   */
  _playHiHatOpen(time) {
    if (this._playSample('hatOpen', time, 0.75, 10)) return;
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

    // Second sawtooth at the 5th for extra warmth
    if (noteFreqs.length >= 3) {
      const sawOsc2 = ctx.createOscillator();
      sawOsc2.type = 'sawtooth';
      sawOsc2.frequency.value = noteFreqs[2]; // 5th of chord (3rd note)
      sawOsc2.detune.value = 7;

      const sawFilter2 = ctx.createBiquadFilter();
      sawFilter2.type = 'lowpass';
      sawFilter2.frequency.value = 600;
      sawFilter2.Q.value = 0.5;

      const sawGain2 = ctx.createGain();
      sawGain2.gain.setValueAtTime(0.0001, time);
      sawGain2.gain.linearRampToValueAtTime(volumeScale * 0.03, time + attackTime);
      sawGain2.gain.setValueAtTime(volumeScale * 0.03, endTime - releaseTime);
      sawGain2.gain.linearRampToValueAtTime(0.0001, endTime);

      sawOsc2.connect(sawFilter2);
      sawFilter2.connect(sawGain2);
      sawGain2.connect(this._nodes.padFilter);

      sawOsc2.start(time);
      sawOsc2.stop(endTime + 0.05);
      this._trackSource(sawOsc2, endTime + 0.1);
    }
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

  // ─── Overlay Layer ────────────────────────────────────────────────────
  // Makes existing instruments play MORE: thicker chords, denser drums,
  // wider arpeggios. Same sounds, more of them.

  /**
   * Schedule overlay content for one beat: extra drum hits + extended chords.
   */
  _scheduleOverlay(time, beat, chord, secondsPerBeat) {
    const level = this._overlayLevel;
    const style = this._style;
    const mainDrums = DRUM_PATTERNS[style] || DRUM_PATTERNS.lofi;
    const overlayEntry = OVERLAY_DRUM_PATTERNS[style] || OVERLAY_DRUM_PATTERNS.lofi;

    // ── Pick level-appropriate overlay pattern ──
    let kickPat, snarePat;
    if (level >= 1.5 && overlayEntry.kickL4) {
      kickPat = overlayEntry.kickL4;
      snarePat = overlayEntry.snareL4;
    } else if (level >= 1.0 && overlayEntry.kickL3) {
      kickPat = overlayEntry.kickL3;
      snarePat = overlayEntry.snareL3;
    } else if (level >= 0.65 && overlayEntry.kickL2) {
      kickPat = overlayEntry.kickL2;
      snarePat = overlayEntry.snareL2;
    } else {
      kickPat = overlayEntry.kick;
      snarePat = overlayEntry.snare;
    }

    // ── Extra drum hits on complementary beats ──
    if (kickPat[beat] && !mainDrums.kick[beat]) {
      this._playOverlayKick(time);
    }
    if (snarePat[beat] && !mainDrums.snare[beat]) {
      this._playOverlaySnare(time);
    }

    // ── Style-specific musical overlays ──
    if (style === 'lofi') {
      this._scheduleLofiOverlay(time, beat, chord, secondsPerBeat, level);
    } else if (style === 'bossa') {
      this._scheduleBossaOverlay(time, beat, chord, secondsPerBeat, level);
    } else if (style === 'classical') {
      this._scheduleClassicalOverlay(time, beat, chord, secondsPerBeat, level);
    } else if (style === 'chiptune') {
      this._scheduleChiptuneOverlay(time, beat, chord, secondsPerBeat, level);
    } else if (style === 'zelda') {
      this._scheduleZeldaOverlay(time, beat, chord, secondsPerBeat, level);
    } else {
      // Generic styles: basic shaker at higher levels
      if (level > 0.4 && beat % 2 === 1) {
        this._playOverlayShaker(time);
      }
    }

    // Piano overlay flag: layer classical piano enhancements on any style
    if (this._pianoOverlay && style !== 'classical') {
      this._scheduleClassicalOverlay(time, beat, chord, secondsPerBeat, level);
    }
  }

  /**
   * Bossa-specific overlay: walking bass, chord comping, melodic scale fills.
   * All routed through existing bassBus/padFilter — same sound, more notes.
   */
  _scheduleBossaOverlay(time, beat, chord, secondsPerBeat, level) {
    const mainBass = BASS_PATTERNS.bossa;
    const root = chord.root;
    const notes = chord.notes;
    const scale = chord.scale || [];
    const cfg = STYLE_CONFIG.bossa;

    // ── Level 1+: Walking bass fills (through bassBus) ──
    // Main bass: positions 0,14,20,30. Fill gaps with chord passing tones.
    const bassWalk1 = [0,0,0,0, 0,0,1,0, 0,0,1,0, 0,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,1,0, 0,0,0,0];
    const bassWalk2 = [0,0,1,0, 0,0,1,0, 1,0,1,0, 0,0,0,0, 0,0,1,0, 0,0,1,0, 1,0,1,0, 0,0,0,0];
    const bassWalk3 = [0,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,0,0, 0,0,1,0, 0,0,1,0, 1,0,1,0, 1,0,0,0];
    const bassWalk4 = [0,1,1,1, 1,0,1,1, 1,1,1,0, 1,0,0,1, 0,1,1,1, 1,0,1,1, 1,1,1,0, 1,0,0,1];

    const bassPat = level >= 1.5 ? bassWalk4 : level >= 1.0 ? bassWalk3 : level >= 0.65 ? bassWalk2 : bassWalk1;
    if (bassPat[beat] && !mainBass[beat]) {
      // Pick a passing tone: cycle through chord's 3rd, 5th, root octave up
      const passingTones = [root * 2, notes[1] ? notes[1] / 2 : root * 1.5, root * 1.5];
      const bassNote = passingTones[beat % passingTones.length];
      this._playBass(time, bassNote, secondsPerBeat * 0.9, 0.45);
    }

    // ── Level 1+: Extra rim clicks (through drumBus — same tap sound) ──
    // Main snare (clave): 0,2,6,20,24. Add more taps in gaps.
    const mainSnare = DRUM_PATTERNS.bossa.snare;
    const rim1 = [0,0,0,0, 1,0,0,0, 0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,0,0, 0,0,1,0, 0,0,1,0];
    const rim2 = [0,0,0,1, 1,0,0,1, 0,0,1,0, 0,1,1,0, 0,0,1,0, 0,0,0,1, 0,0,1,0, 0,1,1,0];
    const rim3 = [0,0,0,1, 1,0,0,1, 1,0,1,0, 0,1,1,1, 0,1,1,0, 0,0,0,1, 0,0,1,1, 0,1,1,0];
    const rim4 = [0,1,0,1, 1,0,1,1, 1,0,1,1, 0,1,1,1, 0,1,1,1, 0,1,0,1, 0,1,1,1, 0,1,1,1];
    const rimPat = level >= 1.5 ? rim4 : level >= 1.0 ? rim3 : level >= 0.65 ? rim2 : rim1;
    if (rimPat[beat] && !mainSnare[beat]) {
      this._playRimClick(time);
    }

    // ── Level 1+: Chord comping stabs (through padFilter — same sound) ──
    // Short rhythmic chord hits on syncopated beats, like a piano player comping
    const comp1 = [0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,1];
    const comp2 = [0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,1];
    const comp3 = [0,0,0,1, 0,0,1,1, 0,0,0,1, 0,0,1,1, 0,0,0,1, 0,0,1,1, 0,0,0,1, 0,0,1,1];
    const comp4 = [0,0,1,1, 0,0,1,1, 0,1,0,1, 0,0,1,1, 0,0,1,1, 0,0,1,1, 0,1,0,1, 0,0,1,1];

    const compPat = level >= 1.5 ? comp4 : level >= 1.0 ? comp3 : level >= 0.65 ? comp2 : comp1;
    if (compPat[beat]) {
      const stabDur = secondsPerBeat * 1.5;
      this._playChordPad(time, notes, stabDur, 0.6, cfg.padAttack * 0.5, 0.2);
    }

    // ── Level 1+: Melodic scale fills (individual notes through padFilter) ──
    if (scale.length >= 3) {
      const melody1 = [0,0,0,0, 1,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0, 1,0,0,0, 0,0,0,0, 0,0,1,0];
      const melody2 = [0,0,0,0, 1,0,1,0, 0,1,0,0, 0,0,1,0, 0,0,0,0, 1,0,1,0, 0,1,0,0, 0,0,1,0];
      const melody3 = [0,1,0,0, 1,0,1,0, 0,1,0,0, 1,0,1,0, 0,1,0,0, 1,0,1,0, 0,1,0,0, 1,0,1,0];
      const melody4 = [0,1,0,1, 1,0,1,0, 1,1,0,1, 1,0,1,0, 0,1,0,1, 1,0,1,0, 1,1,0,1, 1,0,1,0];
      const melPat = level >= 1.5 ? melody4 : level >= 1.0 ? melody3 : level >= 0.65 ? melody2 : melody1;

      if (melPat[beat]) {
        const scaleIdx = beat % scale.length;
        this._playMelodyNote(time, scale[scaleIdx], secondsPerBeat * 0.8, 0.3);
      }
    }

    // ── Level 2+: Extra shaker subdivisions ──
    if (level >= 0.65) {
      this._playShaker(time + secondsPerBeat * 0.25);
      this._playShaker(time + secondsPerBeat * 0.75);
    }
    if (level >= 1.0) {
      this._playShaker(time + secondsPerBeat * 0.5);
    }
  }

  /**
   * Lo-fi-specific overlay: walking bass fills, chord comping, Rhodes keys, melodic fills.
   * All routed through existing bassBus/padFilter — same warm lo-fi sound, more notes.
   */
  _scheduleLofiOverlay(time, beat, chord, secondsPerBeat, level) {
    const mainBass = BASS_PATTERNS.lofi; // [1,0,1,0, 1,0,1,0, ...]
    const root = chord.root;
    const notes = chord.notes;
    const scale = chord.scale || [];
    const cfg = STYLE_CONFIG.lofi;

    // ── Walking bass fills (through bassBus) ──
    // Main bass hits even steps. Fill odd steps with passing tones.
    const bassWalk1 = [0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,1];
    const bassWalk2 = [0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1];
    const bassWalk3 = [0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,1,1, 0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,1,1];
    const bassWalk4 = [0,1,1,1, 0,1,1,1, 0,1,1,1, 0,1,1,1, 0,1,1,1, 0,1,1,1, 0,1,1,1, 0,1,1,1];

    const bassPat = level >= 1.5 ? bassWalk4 : level >= 1.0 ? bassWalk3 : level >= 0.65 ? bassWalk2 : bassWalk1;
    if (bassPat[beat] && !mainBass[beat]) {
      const passingTones = [root * 2, notes[1] ? notes[1] / 2 : root * 1.5, root * 1.5];
      const bassNote = passingTones[beat % passingTones.length];
      this._playBass(time, bassNote, secondsPerBeat * 0.7, 0.4);
    }

    // ── Chord comping stabs (short pad hits for rhythmic texture) ──
    const comp1 = [0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,1];
    const comp2 = [0,0,0,1, 0,0,0,1, 0,0,0,0, 0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,0, 0,0,0,1];
    const comp3 = [0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,1];
    const comp4 = [0,0,0,1, 0,1,0,1, 0,0,0,1, 0,1,0,1, 0,0,0,1, 0,1,0,1, 0,0,0,1, 0,1,0,1];

    const compPat = level >= 1.5 ? comp4 : level >= 1.0 ? comp3 : level >= 0.65 ? comp2 : comp1;
    if (compPat[beat]) {
      this._playChordPad(time, notes, secondsPerBeat * 1.2, 0.45, cfg.padAttack * 0.3, 0.25);
    }

    // ── L1+ Rhodes: simple syncopated chords (warm harmonic bed) ──
    const rh1 = [0,0,0,0, 0,1,0,0, 0,0,0,0, 0,1,0,0, 0,0,0,0, 0,1,0,0, 0,0,0,0, 0,1,0,0];
    const rh2 = [0,0,0,0, 0,1,0,0, 0,0,0,1, 0,1,0,0, 0,0,0,0, 0,1,0,0, 0,0,0,1, 0,1,0,0];
    const rh3 = [0,0,0,1, 0,1,0,0, 0,0,0,1, 0,1,0,0, 0,0,0,1, 0,1,0,0, 0,0,0,1, 0,1,0,0];
    const rh4 = [0,0,0,1, 0,1,0,1, 0,0,0,1, 0,1,0,0, 0,0,0,1, 0,1,0,1, 0,0,0,1, 0,1,0,0];

    const rhPat = level >= 1.5 ? rh4 : level >= 1.0 ? rh3 : level >= 0.65 ? rh2 : rh1;
    if (rhPat[beat]) {
      const rhodesChord = notes.map(f => f * 2);
      this._playRhodes(time, rhodesChord, secondsPerBeat * 1.5, 0.25);
    }

    // ── L2+ Vibraphone: dreamy melodic notes (new instrument at +10) ──
    if (level >= 0.65 && scale.length >= 3) {
      const S = scale.length;
      // Gentle melodic phrases — stepwise, lots of space
      const vibB = [-1,-1,-1,-1,  -1,-1, 0,-1,  -1,-1,-1,-1,  -1,-1, 2,-1,
                    -1,-1,-1,-1,  -1,-1, 4,-1,  -1,-1,-1,-1,  -1,-1, 2,-1];
      const vibC = [-1,-1, 0,-1,  -1, 2,-1,-1,  -1,-1, 4,-1,  -1, 2,-1, 0,
                    -1,-1, 1,-1,  -1, 3,-1,-1,  -1,-1, 2,-1,  -1, 0,-1,-1];
      const vibD = [-1, 0,-1, 2,  -1, 4,-1, 3,  -1, 2,-1, 0,  -1, 1,-1, 2,
                    -1, 4,-1, 3,  -1, 1,-1, 0,  -1, 2,-1, 4,  -1, 3,-1, 0];

      const vibP = level >= 1.5 ? vibD : level >= 1.0 ? vibC : vibB;
      const vibDeg = vibP[beat];
      if (vibDeg >= 0) {
        this._playVibraphone(time, scale[vibDeg % S], secondsPerBeat * 2.0, 0.22);
      }
    }

    // ── L3+ Tape strings: warm swelling pads (new instrument at +15) ──
    if (level >= 1.0) {
      // Slow sustained chord swells — only trigger every 8 beats
      const strTrig = [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0];
      const strTrigD = [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,1,0];
      const sPat = level >= 1.5 ? strTrigD : strTrig;
      if (sPat[beat]) {
        this._playTapeStrings(time, notes, secondsPerBeat * 6, 0.2);
      }
    }

    // ── L4+ Kalimba: percussive melodic plucks (new instrument at +20) ──
    if (level >= 1.5 && scale.length >= 3) {
      const S = scale.length;
      // Rhythmic plucked pattern — syncopated, playful
      const kalP = [-1, 0,-1, 2,  -1,-1, 4,-1,   0,-1, 2,-1,  -1, 4,-1, 2,
                    -1, 0,-1,-1,   2,-1, 0,-1,  -1, 4,-1, 2,   0,-1, 2, 4];
      const kalDeg = kalP[beat];
      if (kalDeg >= 0) {
        this._playKalimba(time, scale[kalDeg % S] * 2, secondsPerBeat * 0.6, 0.25);
      }
    }
  }

  /**
   * Chiptune-specific overlay: chip bass walks, chip arpeggio stabs, chip lead melody,
   * and a triangle-wave NES lead. All square/triangle waves through existing signal chain.
   */
  _scheduleChiptuneOverlay(time, beat, chord, secondsPerBeat, level) {
    const mainBass = BASS_PATTERNS.chiptune; // [1,0,1,0, ...]
    const root = chord.root;
    const notes = chord.notes;
    const scale = chord.scale || [];

    // ── Bass walk (gentle, fills gaps in main bass pattern) ──
    const bassWalk = [0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1];
    if (bassWalk[beat] && !mainBass[beat]) {
      const passingTones = [root * 2, notes[1] ? notes[1] / 2 : root * 1.5, root * 1.5];
      this._playChipBass(time, passingTones[beat % passingTones.length], secondsPerBeat * 0.5);
    }

    if (scale.length < 3) return;
    const S = scale.length;

    // ── L1+ Triangle lead: gentle Zelda overworld melody ──
    // Sparse, singable phrases with stepwise motion and rests to breathe
    const leadA = [-1,-1,-1, 0,  -1,-1,-1, 2,  -1,-1,-1, 4,  -1,-1, 2,-1,
                   -1,-1,-1, 0,  -1,-1, 2,-1,  -1,-1,-1,-1,  -1,-1, 0,-1];
    const leadB = [-1,-1, 0,-1,  -1, 2,-1, 4,  -1,-1, 3,-1,  -1, 1,-1,-1,
                   -1,-1, 2,-1,  -1, 4,-1, 3,  -1,-1, 1,-1,  -1, 0,-1,-1];
    const leadC = [-1, 0,-1, 2,  -1, 3,-1, 4,  -1, 3,-1, 2,  -1, 0,-1,-1,
                   -1, 2,-1, 4,  -1, 3,-1, 1,  -1, 0,-1, 2,  -1, 1,-1,-1];
    const leadD = [-1, 0, 1, 2,  -1, 4,-1, 3,   2,-1, 0,-1,  -1, 2, 3, 4,
                   -1, 3, 2, 1,  -1, 0,-1, 2,   4,-1, 3,-1,  -1, 1, 0,-1];

    const lead = level >= 1.5 ? leadD : level >= 1.0 ? leadC : level >= 0.65 ? leadB : leadA;
    const deg = lead[beat];
    if (deg >= 0) {
      this._playChipLead(time, scale[deg % S], secondsPerBeat * 0.8, 0.18);
    }

    // ── L2+ Harp arpeggios: fairy fountain broken chords ──
    if (level >= 0.65) {
      // Gentle ascending triads, one note at a time — like Zelda fairy fountain
      const harpA = [-1,-1,-1,-1,  -1,-1,-1,-1,   0,-1,-1,-1,  -1,-1, 2,-1,
                     -1,-1,-1,-1,   4,-1,-1,-1,  -1,-1,-1,-1,   2,-1,-1,-1];
      const harpB = [-1,-1, 0,-1,  -1,-1, 2,-1,  -1,-1, 4,-1,  -1,-1, 2,-1,
                     -1,-1, 0,-1,  -1,-1, 4,-1,  -1,-1, 2,-1,  -1,-1, 0,-1];
      const harpC = [-1, 0,-1, 2,  -1, 4,-1, 2,  -1, 0,-1, 4,  -1, 2,-1, 0,
                     -1, 4,-1, 2,  -1, 0,-1, 2,  -1, 4,-1, 0,  -1, 2,-1,-1];

      const harp = level >= 1.5 ? harpC : level >= 1.0 ? harpB : harpA;
      const hDeg = harp[beat];
      if (hDeg >= 0) {
        // High octave, short plucky notes, quiet
        this._playChipLead(time, scale[hDeg % S] * 4, secondsPerBeat * 0.3, 0.10);
      }
    }

    // ── L3+ SNES string pad: sustained chord swells every 8 beats ──
    if (level >= 1.0 && beat % 8 === 0) {
      const padNotes = notes.map(f => f * 2);
      this._playChipPad(time, padNotes, secondsPerBeat * 6, 0.30);
    }

    // ── L4+ Counter-melody: octave-up duet responding in lead's rests ──
    if (level >= 1.5) {
      const ctr = [-1,-1,-1,-1,   4,-1,-1,-1,  -1,-1,-1,-1,   2,-1,-1, 0,
                   -1,-1,-1,-1,  -1,-1, 4,-1,  -1, 3,-1,-1,   0,-1,-1,-1];
      const cDeg = ctr[beat];
      if (cDeg >= 0) {
        this._playChipLead(time, scale[cDeg % S] * 2, secondsPerBeat * 0.6, 0.13);
      }
    }
  }

  /**
   * Zelda-style overlay — heroic melodies with triplets, gallops, and dotted rhythms.
   * Uses chip instruments. Encodes 5 techniques from the Zelda theme analysis:
   * 1. Triplet/16th clash  2. Galloping effect  3. Strong downbeats
   * 4. Rhythmic evolution  5. Dotted rhythm delay
   */
  _scheduleZeldaOverlay(time, beat, chord, secondsPerBeat, level) {
    const mainBass = BASS_PATTERNS.zelda;
    const root = chord.root;
    const notes = chord.notes;
    const scale = chord.scale || [];
    const spb = secondsPerBeat; // shorthand for sub-beat math

    // ── Bass walk (fills gaps in main bass) ──
    const bassWalk = [0,1,0,0, 0,0,0,1, 0,1,0,0, 0,0,0,1, 0,1,0,0, 0,0,0,1, 0,1,0,0, 0,0,0,1];
    if (bassWalk[beat] && !mainBass[beat]) {
      const passingTones = [root * 2, notes[1] ? notes[1] / 2 : root * 1.5, root * 1.5];
      this._playChipBass(time, passingTones[beat % passingTones.length], spb * 0.5);
    }

    if (scale.length < 3) return;
    const S = scale.length;

    // ── Main melody: root/fifth on strong downbeats (Technique 3) ──
    // Always plays; density scales with level
    const melA = [ 0,-1,-1, 2,  -1,-1,-1,-1,   4,-1,-1, 3,  -1,-1,-1,-1,
                   0,-1,-1, 2,  -1,-1, 4,-1,  -1,-1, 3,-1,  -1,-1,-1,-1];
    const melB = [ 0,-1, 1, 2,  -1,-1, 3,-1,   4,-1, 3, 2,  -1,-1, 0,-1,
                   0,-1, 2,-1,  -1, 4,-1, 3,  -1,-1, 1,-1,  -1, 0,-1,-1];
    const melC = [ 0, 1, 2, 3,  -1, 4,-1, 3,   2,-1, 0,-1,   4, 3, 2, 1,
                   0,-1, 2, 4,  -1, 3,-1, 1,   0,-1, 2,-1,  -1, 4, 3,-1];
    const melD = [ 0, 1, 2, 3,   4, 3, 2, 0,   2, 3, 4, 3,   2, 1, 0, 2,
                   0, 2, 4, 3,   1, 0, 2, 4,   3, 2, 1, 0,   2, 4, 3, 1];

    const mel = level >= 1.5 ? melD : level >= 1.0 ? melC : level >= 0.65 ? melB : melA;
    const deg = mel[beat];
    if (deg >= 0) {
      this._playChipLead(time, scale[deg % S], spb * 0.8, 0.20);
    }

    // ── Galloping arpeggios (Techniques 2 & 5: dotted-8th + 16th) ──
    // Always plays; density scales with level
    const galA = [-1,-1,-1,-1,  -1,-1,-1,-1,  -1,-1,-1,-1,  -1,-1,-1,-1,
                  -1,-1,-1,-1,  -1,-1,-1,-1,   2,-1,-1,-1,  -1,-1,-1,-1];
    const galB = [-1,-1,-1,-1,   2,-1,-1,-1,  -1,-1,-1,-1,  -1,-1,-1,-1,
                  -1,-1,-1,-1,   4,-1,-1,-1,   2,-1,-1,-1,  -1,-1,-1,-1];
    const galC = [-1,-1,-1,-1,   2,-1,-1,-1,  -1,-1,-1,-1,   4,-1,-1,-1,
                   0,-1,-1,-1,   3,-1,-1,-1,   2,-1,-1,-1,   5,-1,-1,-1];
    const galD = [ 0,-1,-1,-1,   2,-1,-1,-1,   4,-1,-1,-1,   3,-1,-1,-1,
                   0,-1,-1,-1,   3,-1,-1,-1,   2,-1,-1,-1,   5,-1,-1,-1];

    const gal = level >= 1.5 ? galD : level >= 1.0 ? galC : level >= 0.65 ? galB : galA;
    const gDeg = gal[beat];
    if (gDeg >= 0) {
      this._playChipLead(time, scale[gDeg % S] * 2, spb * 0.6, 0.12);
      const next = (gDeg + 2) % S;
      this._playChipLead(time + spb * 0.75, scale[next] * 2, spb * 0.2, 0.10);
    }

    // ── Triplet ornaments (Techniques 1 & 4: triplet/16th clash) ──
    // Always plays; density scales with level
    const triA = [-1,-1,-1,-1,  -1,-1,-1,-1,  -1,-1,-1,-1,   0,-1,-1,-1,
                  -1,-1,-1,-1,  -1,-1,-1,-1,  -1,-1,-1,-1,   2,-1,-1,-1];
    const triB = [-1,-1,-1,-1,  -1,-1, 0,-1,  -1,-1,-1,-1,   2,-1,-1,-1,
                  -1,-1,-1,-1,  -1,-1, 3,-1,  -1,-1,-1,-1,   0,-1,-1,-1];
    const triC = [-1,-1, 0,-1,  -1,-1, 2,-1,  -1,-1, 4,-1,   3,-1,-1,-1,
                  -1,-1, 1,-1,  -1,-1, 3,-1,  -1,-1, 0,-1,   2,-1,-1,-1];
    const triD = [ 0,-1, 2,-1,  -1,-1, 4,-1,   3,-1, 1,-1,   0,-1, 2,-1,
                   4,-1, 3,-1,  -1,-1, 1,-1,   0,-1, 2,-1,   4,-1, 3,-1];

    const tri = level >= 1.5 ? triD : level >= 1.0 ? triC : level >= 0.65 ? triB : triA;
    const tDeg = tri[beat];
    if (tDeg >= 0) {
      for (let i = 0; i < 3; i++) {
        const note = (tDeg + i) % S;
        this._playChipLead(time + i * spb / 3, scale[note] * 2, spb * 0.25, 0.09);
      }
    }

    // ── +10: Counter-melody + pad swells every 8 beats ──
    if (level >= 0.65) {
      const ctr = [-1,-1,-1,-1,   3,-1,-1,-1,  -1,-1,-1,-1,  -1,-1, 1,-1,
                   -1,-1,-1,-1,  -1,-1,-1, 4,  -1,-1,-1,-1,   0,-1,-1,-1];
      const cDeg = ctr[beat];
      if (cDeg >= 0) {
        this._playChipLead(time, scale[cDeg % S] * 2, spb * 0.6, 0.13);
      }
      if (beat % 8 === 0) {
        const padNotes = notes.map(f => f * 2);
        this._playChipPad(time, padNotes, spb * 6, 0.25);
      }
    }

    // ── +15: Harmonic 3rds doubling melody + resolution arpeggios + pad every 4 ──
    if (level >= 1.0) {
      // Harmony voice: melody doubled a 3rd above for richness
      if (deg >= 0) {
        const harmony = (deg + 2) % S; // a 3rd above in the scale
        this._playChipLead(time, scale[harmony] * 2, spb * 0.7, 0.11);
      }

      // Resolution arpeggios: descending chord tones landing on root (satisfying cadence)
      const resA = [-1,-1,-1,-1,  -1,-1,-1,-1,  -1,-1,-1,-1,  -1,-1,-1, 4,
                    -1,-1,-1,-1,  -1,-1,-1,-1,  -1,-1,-1,-1,  -1,-1,-1, 2];
      const resDeg = resA[beat];
      if (resDeg >= 0) {
        // Descending 4-note arpeggio resolving to root over 1 beat
        for (let i = 0; i < 4; i++) {
          const rd = (resDeg - i + S) % S;
          this._playChipLead(time + i * spb * 0.25, scale[rd], spb * 0.3, 0.14);
        }
      }

      // Pad swells every 4 beats (denser than +10's every 8)
      if (beat % 4 === 0) {
        const padNotes = notes.map(f => f * 2);
        this._playChipPad(time, padNotes, spb * 3, 0.20);
      }

      // Chip noise accents on strong beats for percussive texture
      if (beat % 8 === 0) {
        this._playChipNoise(time, spb * 0.15, 0.06);
      }
    }

    // ── +20: Fanfare unisons + continuous pads + cadential resolution ──
    if (level >= 1.5) {
      // Fanfare: octave-doubled melody for power
      if (deg >= 0) {
        this._playChipLead(time, scale[deg % S] * 0.5, spb * 0.8, 0.15); // octave below
        this._playChipLead(time, scale[deg % S] * 2, spb * 0.8, 0.10);   // octave above
      }

      // Continuous pad chord changes every 2 beats — full harmonic bed
      if (beat % 2 === 0) {
        const fullPad = [...notes, ...notes.map(f => f * 2)]; // doubled voicing
        this._playChipPad(time, fullPad, spb * 1.8, 0.15);
      }

      // Cadential bass resolution: fifth → root on phrase endings
      const cadBass = [-1,-1,-1,-1,  -1,-1,-1,-1,  -1,-1,-1,-1,  -1,-1, 1,-1,
                       -1,-1,-1,-1,  -1,-1,-1,-1,  -1,-1,-1,-1,  -1,-1, 1,-1];
      if (cadBass[beat] === 1) {
        // Fifth of chord (approximated as root * 1.5), resolving to root next beat
        this._playChipBass(time, root * 3, spb * 0.4);
        this._playChipBass(time + spb * 0.5, root * 2, spb * 0.6);
      }

      // Sweep arpeggio: full ascending scale run every 16 beats
      if (beat % 16 === 14) {
        for (let i = 0; i < S; i++) {
          this._playChipLead(time + i * spb * 0.15, scale[i] * 2, spb * 0.2, 0.08);
        }
      }
    }
  }

  /**
   * Chip lead — triangle wave, classic NES channel 3.
   * Pure triangle with fast attack/decay for melodic lines.
   */
  _playChipLead(time, freq, duration, volume) {
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;

    // Vibrato LFO (subtle pitch wobble — classic NES feel)
    const vib = ctx.createOscillator();
    vib.type = 'sine';
    vib.frequency.value = 6;
    const vibGain = ctx.createGain();
    vibGain.gain.value = 3; // ±3 Hz
    vib.connect(vibGain);
    vibGain.connect(osc.frequency);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(volume, time + 0.005);
    gain.gain.setValueAtTime(volume, time + duration * 0.6);
    gain.gain.linearRampToValueAtTime(0.0001, time + duration);

    osc.connect(gain);
    gain.connect(this._nodes.padFilter);

    osc.start(time);
    vib.start(time);
    const stopTime = time + duration + 0.02;
    osc.stop(stopTime);
    vib.stop(stopTime);
    this._trackSource(osc, stopTime + 0.05);
    this._trackSource(vib, stopTime + 0.05);
  }

  /**
   * Chip noise burst — short filtered noise for percussive texture.
   * Like NES noise channel used for hats/effects.
   */
  _playChipNoise(time, duration, volume) {
    const ctx = this._ctx;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buf.getChannelData(0);
    // 1-bit style noise (quantized)
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() > 0.5 ? 1 : -1;
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 4000;
    bp.Q.value = 2;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    src.connect(bp);
    bp.connect(gain);
    gain.connect(this._nodes.drumBus);

    src.start(time);
    this._activeSources.add(src);
    src.onended = () => this._activeSources.delete(src);
  }

  /**
   * Classical-specific overlay: walking bass, counter-arpeggios, melodic scale runs.
   * All routed through existing bassBus/padBus — same piano sound, more notes.
   */
  _scheduleClassicalOverlay(time, beat, chord, secondsPerBeat, level) {
    const mainBass = BASS_PATTERNS.classical; // [1,0,0,0, 1,0,0,0, ...]
    const root = chord.root;
    const notes = chord.notes;
    const scale = chord.scale || [];

    // ── Level 1+: Walking bass (through bassBus) ──
    // Main bass: every 4 beats. Fill with chord tones + passing notes.
    const bassWalk1 = [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0];
    const bassWalk2 = [0,1,1,0, 0,1,1,0, 0,1,1,0, 0,1,1,0, 0,1,1,0, 0,1,1,0, 0,1,1,0, 0,1,1,0];
    const bassWalk3 = [0,1,1,1, 0,1,1,1, 0,1,1,1, 0,1,1,1, 0,1,1,1, 0,1,1,1, 0,1,1,1, 0,1,1,1];
    const bassWalk4 = [0,1,1,1, 1,1,1,1, 0,1,1,1, 1,1,1,1, 0,1,1,1, 1,1,1,1, 0,1,1,1, 1,1,1,1];

    const bassPat = level >= 1.5 ? bassWalk4 : level >= 1.0 ? bassWalk3 : level >= 0.65 ? bassWalk2 : bassWalk1;
    if (bassPat[beat] && !mainBass[beat]) {
      const passingTones = [root * 2, notes[1] ? notes[1] / 2 : root * 1.5, root * 1.5];
      const bassNote = passingTones[beat % passingTones.length];
      this._playBass(time, bassNote, secondsPerBeat * 1.5, 0.45);
    }

    // ── Level 1+: Counter-arpeggio stabs (short arpeggios on off-beats) ──
    // Re-trigger the arpeggio as short rhythmic figures between the main 8-beat arp
    const arp1 = [0,0,0,0, 1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0, 0,0,0,0];
    const arp2 = [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0];
    const arp3 = [0,0,0,0, 1,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,1,0, 1,0,0,0];
    const arp4 = [0,0,1,0, 1,0,0,0, 0,0,1,0, 1,0,1,0, 0,0,1,0, 1,0,0,0, 0,0,1,0, 1,0,1,0];

    const arpPat = level >= 1.5 ? arp4 : level >= 1.0 ? arp3 : level >= 0.65 ? arp2 : arp1;
    if (arpPat[beat]) {
      // Short 2-beat arpeggio with octave-up notes for contrast
      const upNotes = notes.map(f => f * 2);
      this._playArpeggio(time, upNotes, secondsPerBeat * 2, 0.4, secondsPerBeat);
    }

    // ── Level 1+: Melodic scale fills (individual piano notes) ──
    const melody1 = [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0];
    const melody2 = [0,0,0,1, 0,0,1,0, 0,0,0,1, 0,0,1,0, 0,0,0,1, 0,0,1,0, 0,0,0,1, 0,0,1,0];
    const melody3 = [0,1,0,1, 0,0,1,0, 0,1,0,1, 0,0,1,0, 0,1,0,1, 0,0,1,0, 0,1,0,1, 0,0,1,0];
    const melody4 = [1,1,0,1, 0,1,1,1, 1,1,0,1, 0,1,1,1, 1,1,0,1, 0,1,1,1, 1,1,0,1, 0,1,1,1];

    const melPat = level >= 1.5 ? melody4 : level >= 1.0 ? melody3 : level >= 0.65 ? melody2 : melody1;
    if (melPat[beat] && scale.length >= 3) {
      const scaleIdx = beat % scale.length;
      this._playMelodyNote(time, scale[scaleIdx], secondsPerBeat * 1.2, 0.22);
    }

    // ── Level 2+: Chord comping (short sustained chord hits) ──
    if (level >= 0.65) {
      const comp2 = [0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,1];
      const comp3 = [0,0,0,1, 0,0,0,1, 0,0,0,0, 0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,0, 0,0,0,1];
      const comp4 = [0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,1];
      const compPat = level >= 1.5 ? comp4 : level >= 1.0 ? comp3 : comp2;
      if (compPat[beat]) {
        const cfg = STYLE_CONFIG.classical;
        this._playChordPad(time, notes, secondsPerBeat * 1.5, 0.5, cfg.padAttack * 0.3, 0.3);
      }
    }

    // ── Level 3+: Descending counter-melody (scale runs down) ──
    if (level >= 1.0 && scale.length >= 4) {
      const desc3 = [0,0,0,0, 0,1,0,0, 0,0,0,0, 0,1,0,0, 0,0,0,0, 0,1,0,0, 0,0,0,0, 0,1,0,0];
      const desc4 = [0,0,0,0, 0,1,0,0, 0,0,0,1, 0,1,0,0, 0,0,0,0, 0,1,0,0, 0,0,0,1, 0,1,0,0];
      const descPat = level >= 1.5 ? desc4 : desc3;
      if (descPat[beat]) {
        // Play a quick 3-note descending run
        for (let i = 0; i < 3; i++) {
          const idx = (scale.length - 1 - i) % scale.length;
          const t = time + i * secondsPerBeat * 0.25;
          this._playMelodyNote(t, scale[idx], secondsPerBeat * 0.6, 0.18);
        }
      }
    }
  }

  /**
   * Full-strength overlay kick — matches main kick quality.
   */
  _playOverlayKick(time) {
    const ctx = this._ctx;
    const osc1 = ctx.createOscillator();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(150, time);
    osc1.frequency.exponentialRampToValueAtTime(55, time + 0.07);

    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(120, time);
    osc2.frequency.exponentialRampToValueAtTime(40, time + 0.1);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.7, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.25);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this._nodes.overlayBus);

    osc1.start(time);
    osc2.start(time);
    osc1.stop(time + 0.3);
    osc2.stop(time + 0.3);
    this._trackSource(osc1, time + 0.35);
    this._trackSource(osc2, time + 0.35);
  }

  /**
   * Full-strength overlay snare — noise body + tonal sine body.
   */
  _playOverlaySnare(time) {
    const ctx = this._ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._nodes.ghostSnareBuf;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2500;
    bp.Q.value = 0.8;

    // Tonal body
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 200;
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.15, time);
    oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
    osc.connect(oscGain);

    const gain = ctx.createGain();
    gain.gain.value = 0.35;

    src.connect(bp);
    bp.connect(gain);
    oscGain.connect(gain);
    gain.connect(this._nodes.overlayBus);

    src.start(time);
    osc.start(time);
    osc.stop(time + 0.1);
    this._activeSources.add(src);
    src.onended = () => this._activeSources.delete(src);
    this._trackSource(osc, time + 0.12);
  }

  /**
   * Shaker noise burst for rhythmic texture.
   */
  _playOverlayShaker(time) {
    const ctx = this._ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._nodes.shakerBuf;
    src.playbackRate.value = 0.95 + Math.random() * 0.1;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 8000;
    bp.Q.value = 1.5;

    const gain = ctx.createGain();
    gain.gain.value = 0.06;

    src.connect(bp);
    bp.connect(gain);
    gain.connect(this._nodes.overlayBus);

    src.start(time);
    this._activeSources.add(src);
    src.onended = () => this._activeSources.delete(src);
  }

  // ─── Style-Specific Synthesis ───────────────────────────────────────────

  /**
   * Heavy 808 trap kick — longer sustain, deeper sub.
   */
  _playTrapKick(time) {
    if (this._playSample('kick', time, 1.0, 5)) return;
    const ctx = this._ctx;

    // Main 808 body — deep sweep for that Metro Boomin thump
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, time);
    osc.frequency.exponentialRampToValueAtTime(25, time + 0.25);

    // Sub layer — goes even deeper
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(70, time);
    sub.frequency.exponentialRampToValueAtTime(22, time + 0.4);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(1.4, time);
    gain.gain.setValueAtTime(0.9, time + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 1.0);

    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.8, time);
    subGain.gain.exponentialRampToValueAtTime(0.001, time + 0.9);

    // Heavy distortion for grit
    const dist = ctx.createWaveShaper();
    dist.curve = createSaturationCurve(5.0, 1024);

    osc.connect(dist);
    sub.connect(subGain);
    subGain.connect(gain);
    dist.connect(gain);
    gain.connect(this._nodes.drumBus);

    osc.start(time);
    sub.start(time);
    osc.stop(time + 1.05);
    sub.stop(time + 0.95);
    this._trackSource(osc, time + 1.1);
    this._trackSource(sub, time + 1.0);
  }

  /**
   * Soft kick for bossa — lighter, higher, faster decay.
   */
  _playKickSoft(time) {
    if (this._playSample('kick', time, 0.6, 10)) return;
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
    if (this._playSample('snare', time, 0.9, 8)) return;
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

      // Second bandpass layer for more body
      const bp2 = ctx.createBiquadFilter();
      bp2.type = 'bandpass';
      bp2.frequency.value = 2500;
      bp2.Q.value = 0.6;

      const g = ctx.createGain();
      g.gain.setValueAtTime(1.0, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

      src.connect(bp);
      src.connect(bp2);
      bp.connect(g);
      bp2.connect(g);
      g.connect(this._nodes.drumBus);
      src.start(t);
      this._trackSource(src, t + 0.12);
    }

    // Heavier tail with reverb-like decay
    const tailDur = 0.22;
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
    tailG.gain.setValueAtTime(0.8, time + burstCount * burstGap);
    tailG.gain.exponentialRampToValueAtTime(0.001, time + 0.35);

    tailSrc.connect(tailBP);
    tailBP.connect(tailG);
    tailG.connect(this._nodes.drumBus);
    tailSrc.start(time + burstCount * burstGap);
    this._trackSource(tailSrc, time + 0.4);
  }

  /**
   * Bossa rim click — short triangle ping, wooden stick sound.
   */
  _playRimClick(time) {
    if (this._playSample('snare', time, 0.7, 6)) return;
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
    if (this._playSample('kick', time, 0.85, 3)) return;
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
    if (this._playSample('snare', time, 0.8, 5)) return;
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
    if (this._playSample('hatClosed', time, 0.7, 5)) return;
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
    const isOpen = decayTime >= 0.15;
    if (this._playSample(isOpen ? 'hatOpen' : 'hatClosed', time, (volume || 0.25) * 2.8, 10)) return;
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
   * Rapid-fire triplet hi-hat roll (Metro Boomin signature).
   */
  _playHiHatRoll(time, count, totalDur, volume) {
    const spacing = totalDur / count;
    for (let i = 0; i < count; i++) {
      const t = time + i * spacing;
      const vol = volume * (0.8 + Math.random() * 0.2); // 80-100% randomized
      this._playTrapHat(t, 0.02, vol);
    }
  }

  /**
   * Soft hi-hat for bossa — gentler, lower volume.
   */
  _playHiHatSoft(time, decayTime, volume) {
    const isOpen = decayTime >= 0.15;
    if (this._playSample(isOpen ? 'hatOpen' : 'hatClosed', time, (volume || 0.2) * 2, 15)) return;
    this._playHiHat(time, decayTime, volume * 0.5);
  }

  /**
   * Bossa shaker — tiny highpassed noise burst, "ch" sound.
   */
  _playShaker(time) {
    const ctx = this._ctx;
    const dur = 0.015;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 8000;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.08, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);

    src.connect(hp);
    hp.connect(g);
    g.connect(this._nodes.drumBus);
    src.start(time);
    this._trackSource(src, time + dur + 0.02);
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
  _playStreakChime(time, chord, streak) {
    const ctx = this._ctx;
    const scale = chord.scale || [NOTE.C4, NOTE.D4, NOTE.E4, NOTE.G4, NOTE.A4];

    // Escalate based on streak count
    let noteCount, vol;
    if (streak >= 10) {
      noteCount = 5; vol = 0.32;
    } else if (streak >= 6) {
      noteCount = 4; vol = 0.28;
    } else {
      noteCount = 3; vol = 0.22;
    }

    for (let i = 0; i < noteCount; i++) {
      const noteTime = time + i * 0.08;
      // Spread across the full scale for bigger streaks
      const scaleIdx = Math.min(Math.floor(i * scale.length / noteCount), scale.length - 1);
      const freq = scale[scaleIdx];

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, noteTime);
      gain.gain.linearRampToValueAtTime(vol, noteTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.5);

      osc.connect(gain);
      gain.connect(this._nodes.padBus);
      osc.start(noteTime);
      osc.stop(noteTime + 0.55);
      this._trackSource(osc, noteTime + 0.6);

      // Add triangle shimmer for streak 10+
      if (streak >= 10) {
        const shimmer = ctx.createOscillator();
        shimmer.type = 'triangle';
        shimmer.frequency.value = freq * 2;
        const sg = ctx.createGain();
        sg.gain.setValueAtTime(0.0001, noteTime);
        sg.gain.linearRampToValueAtTime(vol * 0.3, noteTime + 0.02);
        sg.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.4);
        shimmer.connect(sg);
        sg.connect(this._nodes.padBus);
        shimmer.start(noteTime);
        shimmer.stop(noteTime + 0.45);
        this._trackSource(shimmer, noteTime + 0.5);
      }
    }
  }

  /**
   * Style-aware drum fill for big streak milestones.
   */
  _playStreakFill(time) {
    const ctx = this._ctx;
    const style = this._style;

    if (style === 'trap') {
      // 4 rapid 808 kicks ascending in pitch
      const pitches = [25, 40, 55, 70];
      for (let i = 0; i < 4; i++) {
        const t = time + i * 0.1;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(pitches[i] * 2, t);
        osc.frequency.exponentialRampToValueAtTime(pitches[i], t + 0.08);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.9, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        const dist = ctx.createWaveShaper();
        dist.curve = createSaturationCurve(4.0, 512);
        osc.connect(dist);
        dist.connect(g);
        g.connect(this._nodes.drumBus);
        osc.start(t);
        osc.stop(t + 0.2);
        this._trackSource(osc, t + 0.25);
      }
    } else if (style === 'bossa') {
      // 3 rapid rim clicks (flam)
      for (let i = 0; i < 3; i++) {
        const t = time + i * 0.07;
        this._playRimClick(t);
      }
    } else {
      // Lofi and others: snare roll (4 snares at decreasing intervals)
      const gaps = [0, 0.12, 0.2, 0.26];
      for (let i = 0; i < 4; i++) {
        this._playSnare(time + gaps[i], this._style);
      }
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

  /**
   * Rhodes electric piano — warm bell-like tone with subtle tremolo.
   * Sine fundamental + detuned sine for warmth + amplitude tremolo LFO.
   * Routed through padFilter for consistent lo-fi warmth.
   */
  _playRhodes(time, freqs, duration, volume) {
    const ctx = this._ctx;
    const vol = volume / freqs.length; // scale per-note volume

    for (const freq of freqs) {
      // Fundamental sine
      const osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.value = freq;

      // Slightly detuned sine for chorus/warmth
      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = freq * 1.003; // ~5 cent detune

      // Second harmonic (bell overtone)
      const osc3 = ctx.createOscillator();
      osc3.type = 'sine';
      osc3.frequency.value = freq * 2;
      const harm = ctx.createGain();
      harm.gain.value = 0.12; // subtle bell

      // Amplitude envelope: fast attack, medium decay, low sustain
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, time);
      env.gain.linearRampToValueAtTime(vol, time + 0.008);
      env.gain.setTargetAtTime(vol * 0.4, time + 0.008, 0.15); // decay to 40%
      env.gain.setTargetAtTime(0.001, time + duration * 0.7, duration * 0.2);

      // Tremolo LFO (~4.5Hz, subtle)
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 4.5;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = vol * 0.15; // 15% depth

      // Routing
      const mix = ctx.createGain();
      mix.gain.value = 1.0;

      osc1.connect(mix);
      osc2.connect(mix);
      osc3.connect(harm);
      harm.connect(mix);
      mix.connect(env);
      lfo.connect(lfoGain);
      lfoGain.connect(env.gain); // modulate amplitude
      env.connect(this._nodes.padFilter || this._nodes.padBus);

      osc1.start(time);
      osc2.start(time);
      osc3.start(time);
      lfo.start(time);
      const stopTime = time + duration + 0.05;
      osc1.stop(stopTime);
      osc2.stop(stopTime);
      osc3.stop(stopTime);
      lfo.stop(stopTime);
      this._trackSource(osc1, stopTime + 0.05);
      this._trackSource(osc2, stopTime + 0.05);
      this._trackSource(osc3, stopTime + 0.05);
      this._trackSource(lfo, stopTime + 0.05);
    }
  }

  /**
   * Vibraphone — sine wave with slow tremolo and long sustain.
   * Dreamy, bell-like mallet sound. Routed through padFilter for lo-fi warmth.
   */
  _playVibraphone(time, freq, duration, volume) {
    const ctx = this._ctx;

    // Pure sine fundamental
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;

    // Soft 3rd harmonic (bell overtone)
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 3;
    const harmGain = ctx.createGain();
    harmGain.gain.value = 0.06;
    osc2.connect(harmGain);

    // Envelope: soft attack, long sustain, gentle release
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(volume, time + 0.04);
    env.gain.setTargetAtTime(volume * 0.6, time + 0.04, 0.3);
    env.gain.setTargetAtTime(0.001, time + duration * 0.7, duration * 0.25);

    // Slow tremolo (~3Hz — classic vibraphone motor speed)
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 3;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = volume * 0.25;
    lfo.connect(lfoGain);
    lfoGain.connect(env.gain);

    osc.connect(env);
    harmGain.connect(env);
    env.connect(this._nodes.padFilter || this._nodes.padBus);

    osc.start(time);
    osc2.start(time);
    lfo.start(time);
    const stopTime = time + duration + 0.05;
    osc.stop(stopTime);
    osc2.stop(stopTime);
    lfo.stop(stopTime);
    this._trackSource(osc, stopTime + 0.05);
    this._trackSource(osc2, stopTime + 0.05);
    this._trackSource(lfo, stopTime + 0.05);
  }

  /**
   * Tape strings — warm filtered sawtooth with slow attack.
   * Emulates lo-fi string section recorded to tape. Routed through padFilter.
   */
  _playTapeStrings(time, noteFreqs, duration, volume) {
    const ctx = this._ctx;
    const vol = volume / noteFreqs.length;

    for (const freq of noteFreqs) {
      // Sawtooth for rich harmonic content
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;

      // Detuned second voice for ensemble width
      const osc2 = ctx.createOscillator();
      osc2.type = 'sawtooth';
      osc2.frequency.value = freq * 1.005;

      // Heavy lowpass — makes it warm and tape-like
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1200;
      lp.Q.value = 0.5;

      // Slow swell envelope
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, time);
      env.gain.linearRampToValueAtTime(vol, time + duration * 0.35);
      env.gain.setValueAtTime(vol, time + duration * 0.6);
      env.gain.linearRampToValueAtTime(0.0001, time + duration);

      osc.connect(lp);
      osc2.connect(lp);
      lp.connect(env);
      env.connect(this._nodes.padFilter || this._nodes.padBus);

      osc.start(time);
      osc2.start(time);
      osc.stop(time + duration + 0.05);
      osc2.stop(time + duration + 0.05);
      this._trackSource(osc, time + duration + 0.1);
      this._trackSource(osc2, time + duration + 0.1);
    }
  }

  /**
   * Kalimba — metallic plucked thumb piano.
   * Sine with sharp attack, quick decay, and a subtle metallic overtone.
   */
  _playKalimba(time, freq, duration, volume) {
    const ctx = this._ctx;

    // Sine fundamental
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;

    // Metallic overtone (slightly inharmonic — freq * 5.4 for that kalimba ring)
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 5.4;
    const metalGain = ctx.createGain();
    metalGain.gain.setValueAtTime(0.08, time);
    metalGain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
    osc2.connect(metalGain);

    // Pluck envelope: instant attack, fast decay to low sustain
    const env = ctx.createGain();
    env.gain.setValueAtTime(volume, time);
    env.gain.setTargetAtTime(volume * 0.15, time + 0.005, 0.08);
    env.gain.setTargetAtTime(0.001, time + duration * 0.5, duration * 0.3);

    osc.connect(env);
    metalGain.connect(env);
    env.connect(this._nodes.padFilter || this._nodes.padBus);

    osc.start(time);
    osc2.start(time);
    const stopTime = time + duration + 0.05;
    osc.stop(stopTime);
    osc2.stop(stopTime);
    this._trackSource(osc, stopTime + 0.05);
    this._trackSource(osc2, stopTime + 0.05);
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
