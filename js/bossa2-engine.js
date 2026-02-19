/**
 * Bossa2Engine — Bossa Nova + Piano with Double-Time Feel
 *
 * Architecture: anchor instruments at base BPM, momentum instruments at 2x BPM.
 * This creates the illusion of high energy while keeping harmonic rhythm spacious.
 *
 * Chord progression: Dm9 → G7(b13) → Cmaj9 → A7(b9)  (ii–V–I–VI7 in C)
 * FM synthesis Rhodes-like piano (1:1 body + 14:1 bell transient)
 * Walking bossa bass (root–fifth–octave motion)
 * Bossa drums: soft kick on 1+3, rim click on 2+4
 * Double-time shaker: classic bossa 16th pattern at 2x BPM
 *
 * Overlay levels (maps to student reading fluency):
 *   0.00 — Warm pad only (ambient, pressure-free)
 *   0.35 — + Kick + rim click at base BPM
 *   0.65 — + Walking bass + piano chord stabs
 *   1.00 — + Double-time shaker + syncopated hi-hat
 *   1.50 — + Volume boost + extra percussion fills
 *
 * API-compatible with LofiV2Engine / rhythm-remix.js integration.
 */

// ── Note Frequencies (Hz) ───────────────────────────────────────────────────
// Octave 1–4 covering bass, harmony, and upper chord voicings

const NOTE = {
  // Octave 1 — deep bass roots
  D1: 36.71,  G1: 49.00,  A1: 55.00,  C2: 65.41,
  // Octave 2 — mid bass / lower harmony
  D2: 73.42,  E2: 82.41,  F2: 87.31,  G2: 98.00,
  A2: 110.00, Bb2: 116.54, C3: 130.81,
  // Octave 3 — core chord tones
  D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.00,
  A3: 220.00, Bb3: 233.08, B3: 246.94,
  // Octave 4 — upper extensions
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23,
  G4: 392.00, Ab4: 415.30, A4: 440.00, Bb4: 466.16,
  B4: 493.88, C5: 523.25,
};

// ── Chord Progression: ii7–V7–Imaj7–VI7alt in C major ───────────────────────
//
// Dm9      = D F A C E   (ii minor 9th — gentle, introspective)
// G7(b13)  = G B D F Eb  (V7 altered — tension, bossa sophistication)
// Cmaj9    = C E G B D   (I major 9th — resolution, warmth)
// A7(b9)   = A C# E G Bb (VI7 altered — surprise, chromatic color)
//
// Bass walking: root → fifth → octave (one note per 8th note at base BPM)

const CHORDS = [
  {
    name: 'Dm9',
    notes: [NOTE.D3, NOTE.F3, NOTE.A3, NOTE.C4, NOTE.E4],
    bassWalk: [NOTE.D2, NOTE.A2, NOTE.D2, NOTE.A2],   // root–fifth loop
  },
  {
    name: 'G7(b13)',
    notes: [NOTE.G3, NOTE.B3, NOTE.D4, NOTE.F4, NOTE.Eb4], // Eb4 = b13
    bassWalk: [NOTE.G2, NOTE.D3, NOTE.G2, NOTE.D3],
  },
  {
    name: 'Cmaj9',
    notes: [NOTE.C3, NOTE.E3, NOTE.G3, NOTE.B3, NOTE.D4],
    bassWalk: [NOTE.C2, NOTE.G2, NOTE.C3, NOTE.G2],
  },
  {
    name: 'A7(b9)',
    notes: [NOTE.A2, NOTE.C3, NOTE.E3, NOTE.G3, NOTE.Bb3], // Bb3 = b9 of A
    bassWalk: [NOTE.A1, NOTE.E2, NOTE.A2, NOTE.E2],
  },
];

// ── Step Resolution ──────────────────────────────────────────────────────────
// All patterns are expressed at the DOUBLE-TIME resolution (2x BPM 16ths).
// One bar of base BPM = 32 double-time 16th steps.
// Anchor instruments fire at double-time steps that coincide with base-BPM beats.

const STEPS = 32; // 2 bars of base BPM at double-time resolution

// Anchor (base BPM) — fires at double-time steps 0, 8, 16, 24 (quarter notes)
//   Kick: beats 1 and 3  (steps 0, 16)
//   Rim:  beats 2 and 4  (steps 8, 24)
const KICK = [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0];
const RIM  = [0,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0];

// Double-time shaker: classic bossa nova 3–2 clave feel in 16ths at 2x BPM
// Pattern: x . x . . x . x  x . x . . x . x  (per 16-step bar, repeated)
const SHAKER = [1,0,1,0, 0,1,0,1, 1,0,1,0, 0,1,0,1,
                1,0,1,0, 0,1,0,1, 1,0,1,0, 0,1,0,1];

// Syncopated hi-hat at double-time: 8th-note pulse with upbeat accents
const HIHAT  = [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0,
                1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0];

// Bass walking: one note per double-time half-bar (every 8 steps = 8th-note at base)
// bassWalk array index = Math.floor(s / 8) % 4
// Piano chords fire at step 0 of each 32-step pattern (start of 2-bar phrase)

// ── Engine ───────────────────────────────────────────────────────────────────

export class Bossa2Engine {
  constructor(ctx) {
    this._ctx = ctx;
    this._playing = false;
    this._paused  = false;
    this._bpm     = 70;    // base BPM (anchor tempo; momentum plays at 2x)
    this._step    = 0;
    this._nextStepTime = 0;
    this._schedId = null;
    this._density = 'normal';
    this._overlayLevel = 0;
    this._chordIdx = 0;
    this._style   = 'bossa2';

    // ── Master output ──
    this.output = ctx.createGain();
    this.output.gain.value = 0.82;

    // ── Channel buses ──
    this._drumBus   = ctx.createGain(); this._drumBus.gain.value   = 0.75;
    this._padBus    = ctx.createGain(); this._padBus.gain.value    = 0.30;
    this._bassBus   = ctx.createGain(); this._bassBus.gain.value   = 0.60;
    this._crackleBus= ctx.createGain(); this._crackleBus.gain.value= 0.05;

    // Sidechain duckers (pad and bass duck when kick hits)
    this._padDucker  = ctx.createGain(); this._padDucker.gain.value  = 1.0;
    this._bassDucker = ctx.createGain(); this._bassDucker.gain.value = 1.0;

    // ── Warmth LP filter — rolls off digital edge, preserves bossa warmth ──
    this._warmth = ctx.createBiquadFilter();
    this._warmth.type = 'lowpass';
    this._warmth.frequency.value = 8000;
    this._warmth.Q.value = 0.5;

    // ── Tape saturation (tanh soft-clip, drive 1.8) ──
    this._sat = ctx.createWaveShaper();
    this._sat.curve = this._tanhCurve(1.8);
    this._sat.oversample = '2x';

    // ── Bus compressor (glue) ──
    this._comp = ctx.createDynamicsCompressor();
    this._comp.threshold.value = -16;
    this._comp.ratio.value     = 3.5;
    this._comp.knee.value      = 6;
    this._comp.attack.value    = 0.008;
    this._comp.release.value   = 0.18;

    // ── Signal chain ──
    // drumBus → warmth → sat → comp → output
    // padBus  → padDucker → warmth
    // bassBus → bassDucker → warmth
    // crackleBus → sat  (bypasses warmth for vintage texture)
    this._padBus.connect(this._padDucker);
    this._bassBus.connect(this._bassDucker);
    this._drumBus.connect(this._warmth);
    this._padDucker.connect(this._warmth);
    this._bassDucker.connect(this._warmth);
    this._warmth.connect(this._sat);
    this._crackleBus.connect(this._sat);
    this._sat.connect(this._comp);
    this._comp.connect(this.output);

    // ── Pre-rendered noise buffers ──
    this._noiseBuf      = this._makeNoise(0.5);   // for snare body
    this._shortNoiseBuf = this._makeNoise(0.04);  // for shaker / rim / hats

    // ── Warm pad (always-on ambient layer at Level 0) ──
    this._padSource = null;
    this._buildWarmPad();

    // ── Vinyl crackle ──
    this._crackleSource = null;
    this._buildCrackle();
  }

  // ── Getters ─────────────────────────────────────────────────────────────────

  get isPlaying()      { return this._playing && !this._paused; }
  get currentBpm()     { return this._bpm; }
  get overlayLevel()   { return this._overlayLevel; }
  get currentChordName() { return CHORDS[this._chordIdx % 4].name; }

  // ── Playback Control ─────────────────────────────────────────────────────────

  start() {
    if (this._playing) return;
    if (this._ctx.state === 'suspended') this._ctx.resume();
    this._playing = true;
    this._paused  = false;
    this._step    = 0;
    this._chordIdx = 0;
    this._nextStepTime = this._ctx.currentTime + 0.05;
    this._startPad();
    this._startCrackle();
    this._schedId = setInterval(() => this._tick(), 25);
  }

  stop() {
    this._playing = false;
    this._paused  = false;
    if (this._schedId !== null) { clearInterval(this._schedId); this._schedId = null; }
    this._stopPad();
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
  setStyle()    {}  // single style — no-op

  setOverlayLevel(level) {
    this._overlayLevel = level;
    // Boost master output slightly at peak levels
    const masterGain = level >= 1.5 ? 0.95 : 0.82;
    this.output.gain.setTargetAtTime(masterGain, this._ctx.currentTime, 0.1);
    // Pad fades out gently once rhythm takes over
    if (this._padSource) {
      const padVol = level >= 0.65 ? 0.10 : 0.22;
      this._padSource._gainNode.gain.setTargetAtTime(padVol, this._ctx.currentTime, 0.3);
    }
  }

  setDensity(d) { this._density = d; }

  setCrackleIntensity(intensity) {
    const gains = { light: 0.05, medium: 0.10, heavy: 0.16 };
    this._crackleBus.gain.setTargetAtTime(
      gains[intensity] ?? 0.05, this._ctx.currentTime, 0.05
    );
  }

  playRecordSkip() {
    const t = this._ctx.currentTime;
    const buf = this._makeClickBurst(0.15, 300);
    const src = this._ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this._crackleBus);
    src.start(t);
    this.output.gain.setValueAtTime(0.82, t);
    this.output.gain.linearRampToValueAtTime(0.45, t + 0.03);
    this.output.gain.linearRampToValueAtTime(0.82, t + 0.22);
  }

  playNeedleDrop() {
    const t = this._ctx.currentTime;
    const osc = this._ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(32, t + 0.18);
    const g = this._ctx.createGain();
    g.gain.setValueAtTime(0.40, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    osc.connect(g).connect(this._drumBus);
    osc.start(t); osc.stop(t + 0.32);
  }

  // ── Stubs ────────────────────────────────────────────────────────────────────

  setCelebrations()   {}
  notifyWordEvent()   {}
  setMelody()         {}
  playMelodicPing()   {}
  setAdaptiveHarmony(){}
  setHarmonyMood()    {}
  setSentenceAligned(){}
  advanceChord()      {}

  getBeatPhase() {
    if (!this._playing) return 0;
    const beatDur = 60 / this._bpm;
    const stepDur = beatDur / 4;
    const elapsed = this._ctx.currentTime - (this._nextStepTime - stepDur);
    return Math.max(0, Math.min(1, (elapsed / beatDur) % 1));
  }

  // ── Scheduler ────────────────────────────────────────────────────────────────

  _tick() {
    // Double-time step duration: 16ths at 2x BPM = 32nds at base BPM
    const stepDur = 60 / (this._bpm * 2) / 4;
    const lookahead = 0.12; // 120ms lookahead window

    while (this._nextStepTime < this._ctx.currentTime + lookahead) {
      this._scheduleStep(this._nextStepTime, this._step, stepDur);
      this._nextStepTime += stepDur;
      this._step++;

      // Chord advances every 32 double-time steps (one 2-bar phrase)
      if (this._step % STEPS === 0) {
        this._chordIdx = (this._chordIdx + 1) % 4;
      }
    }
  }

  _scheduleStep(time, step, stepDur) {
    const s  = step % STEPS;
    const ol = this._overlayLevel;
    const d  = this._density;

    if (d === 'whisper') {
      // Whisper: only scheduled pad; real-time pad gain already set in setOverlayLevel
      return;
    }

    const sparse = d === 'sparse';
    const full   = d === 'full';

    // ── Level 0.35+: Anchor drums (kick on 1+3, rim on 2+4) ──────────────────
    // These fire at double-time steps 0, 8, 16, 24 (quarter-note positions)
    if (ol >= 0.35) {
      if (KICK[s]) {
        this._playKick(time);
        // Sidechain: duck pad (depth 0.45) and bass (0.5) on each kick
        this._duck(this._padDucker,  time, 0.45, 0.02, 0.25);
        this._duck(this._bassDucker, time, 0.50, 0.02, 0.20);
      }
      if (RIM[s]) this._playRim(time);
    }

    // ── Level 0.65+: Walking bass + piano chords ──────────────────────────────
    if (ol >= 0.65) {
      // Bass: one note per 8 double-time steps (8th note at base BPM)
      if (s % 8 === 0) {
        const walkIdx = Math.floor(s / 8) % 4;
        const chord   = CHORDS[this._chordIdx % 4];
        const bassFreq = chord.bassWalk[walkIdx];
        // Duration: 8 steps minus a small gap for articulation
        const bassDur  = stepDur * 7.2;
        const bassVol  = sparse ? 0.45 : (full ? 0.95 : 0.70);
        this._playBass(time, bassDur, bassFreq, bassVol);
      }

      // Piano chords: fire once per 32-step phrase (every 2 bars at base BPM)
      if (s === 0) {
        const chordDur = stepDur * STEPS;  // full 2-bar sustain
        const pianoVol = sparse ? 0.45 : (full ? 0.90 : 0.70);
        this._playPiano(time, chordDur, pianoVol);
      }
    }

    // ── Level 1.0+: Double-time momentum instruments ──────────────────────────
    // Shaker and hi-hat now running at 2x BPM — the energy leap
    if (ol >= 1.0) {
      if (SHAKER[s] && !sparse) this._playShaker(time);
      if (HIHAT[s]  && !sparse) this._playHiHat(time);
    }

    // ── Level 1.5+: Extra fills ───────────────────────────────────────────────
    if (ol >= 1.5) {
      // Rim ghost on off-beats (double-time upbeats) for Afro-Cuban flavor
      if (s % 4 === 2 && !KICK[s] && !RIM[s]) this._playGhostRim(time);
      // Ghost hi-hat on every 16th for maximum momentum
      if (HIHAT[s] === 0) this._playGhostHiHat(time);
    }
  }

  // ── Warm Ambient Pad (Level 0 base layer) ────────────────────────────────────
  // Two detuned triangle oscillators through reverb-like LP cascade
  // Always plays; volume modulated by setOverlayLevel

  _buildWarmPad() {
    // Not pre-built; started with start() using a continuous oscillator pair
  }

  _startPad() {
    if (this._padSource) return;
    const ctx   = this._ctx;
    const chord = CHORDS[0]; // Dm9 — the softest, most ambient of the four
    const gainNode = ctx.createGain();
    gainNode.gain.value = this._overlayLevel >= 0.65 ? 0.10 : 0.22;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.7;

    // Two detuned sines at root and fifth for organic warmth
    const oscs = [];
    for (const freq of [chord.notes[0], chord.notes[2]]) {
      for (const det of [-8, +8]) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        osc.detune.value    = det;
        const og = ctx.createGain(); og.gain.value = 0.18;
        osc.connect(og).connect(gainNode);
        osc.start();
        oscs.push(osc);
      }
    }

    gainNode.connect(lp).connect(this._padBus);
    // Store reference for cleanup and volume control
    this._padSource = { oscs, _gainNode: gainNode };
  }

  _stopPad() {
    if (!this._padSource) return;
    for (const osc of this._padSource.oscs) {
      try { osc.stop(); } catch (_) {}
    }
    this._padSource = null;
  }

  // ── FM Piano (Rhodes-style chord stabs) ──────────────────────────────────────
  // Per-note: Pair A (1:1, slow mod decay = body) + Pair B (14:1, fast = click)

  _playPiano(time, duration, volumeScale) {
    const chord = CHORDS[this._chordIdx % 4];
    const vol   = (volumeScale || 0.70) * 0.14 / chord.notes.length;
    for (const freq of chord.notes) {
      this._playPianoNote(freq, time, duration, vol);
    }
  }

  _playPianoNote(freq, time, duration, vol) {
    const ctx = this._ctx;

    // ── FM Pair A: sustained tine body (1:1 carrier-modulator) ──
    // Mod index decays: freq*3.0 → freq*0.15 over 500ms (rich attack → mellow sustain)
    const modA     = ctx.createOscillator();
    modA.type      = 'sine';
    modA.frequency.value = freq;

    const modAGain = ctx.createGain();
    modAGain.gain.setValueAtTime(freq * 3.0, time);
    modAGain.gain.exponentialRampToValueAtTime(freq * 0.15, time + 0.5);
    modA.connect(modAGain);

    const carrA = ctx.createOscillator();
    carrA.type  = 'sine';
    carrA.frequency.value = freq;
    carrA.detune.value    = -5;  // slight detune for stereo width
    modAGain.connect(carrA.frequency);

    const envA = ctx.createGain();
    envA.gain.setValueAtTime(0.001, time);
    envA.gain.exponentialRampToValueAtTime(vol, time + 0.008);
    envA.gain.setValueAtTime(vol, time + duration * 0.65);
    envA.gain.exponentialRampToValueAtTime(0.001, time + duration);
    carrA.connect(envA).connect(this._padBus);

    // ── FM Pair B: attack bell click (14:1 ratio, 80ms burst) ──
    // Brief inharmonic brightness gives the Rhodes its characteristic "ping"
    const modB     = ctx.createOscillator();
    modB.type      = 'sine';
    modB.frequency.value = freq * 14;

    const modBGain = ctx.createGain();
    modBGain.gain.setValueAtTime(freq * 1.5, time);
    modBGain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
    modB.connect(modBGain);

    const carrB = ctx.createOscillator();
    carrB.type  = 'sine';
    carrB.frequency.value = freq;
    carrB.detune.value    = +5;
    modBGain.connect(carrB.frequency);

    const envB = ctx.createGain();
    envB.gain.setValueAtTime(0.001, time);
    envB.gain.exponentialRampToValueAtTime(vol * 0.30, time + 0.005);
    envB.gain.exponentialRampToValueAtTime(0.001, time + 0.28);
    carrB.connect(envB).connect(this._padBus);

    // Start and schedule stops (all 4 oscillators)
    const end = time + duration + 0.06;
    carrA.start(time); carrA.stop(end);
    modA.start(time);  modA.stop(end);
    carrB.start(time); carrB.stop(time + 0.32);
    modB.start(time);  modB.stop(time + 0.32);
  }

  // ── Walking Bass ─────────────────────────────────────────────────────────────
  // Sine wave with pluck envelope and subtle LP for upright bass character

  _playBass(time, duration, freq, volumeScale) {
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    osc.type  = 'sine';
    osc.frequency.value = freq;

    // Subtle second harmonic adds body (triangle-like)
    const osc2 = ctx.createOscillator();
    osc2.type  = 'triangle';
    osc2.frequency.value = freq * 2;

    // LP to cut harsh upper partials — upright bass lives below 400Hz
    const lp = ctx.createBiquadFilter();
    lp.type  = 'lowpass';
    lp.frequency.value = 380;
    lp.Q.value = 0.6;

    const vol = volumeScale || 0.70;
    const g   = ctx.createGain();
    // Pluck shape: quick ramp up, hold, then tail off
    g.gain.setValueAtTime(0.001, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.015);
    g.gain.setValueAtTime(vol * 0.75, time + duration * 0.4);
    g.gain.exponentialRampToValueAtTime(0.001, time + duration);

    const g2 = ctx.createGain(); g2.gain.value = 0.12; // soft harmonic
    osc.connect(lp);
    osc2.connect(g2).connect(lp);
    lp.connect(g).connect(this._bassBus);

    osc.start(time);  osc.stop(time + duration + 0.05);
    osc2.start(time); osc2.stop(time + duration + 0.05);
  }

  // ── Bossa Kick (soft — must not overpower the bossa lightness) ───────────────
  // Lower pitch sweep than hip-hop (120→38Hz), softer click

  _playKick(time) {
    const ctx = this._ctx;

    // Sine body: short pitch sweep for bossa-appropriate softness
    const osc = ctx.createOscillator();
    osc.type  = 'sine';
    osc.frequency.setValueAtTime(120, time);
    osc.frequency.exponentialRampToValueAtTime(38, time + 0.07);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.72, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.28);
    osc.connect(g).connect(this._drumBus);
    osc.start(time); osc.stop(time + 0.32);

    // Triangle click — short transient, quieter than hip-hop
    const click = ctx.createOscillator();
    click.type  = 'triangle';
    click.frequency.setValueAtTime(110, time);
    click.frequency.exponentialRampToValueAtTime(42, time + 0.05);
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.28, time);
    cg.gain.exponentialRampToValueAtTime(0.001, time + 0.10);
    click.connect(cg).connect(this._drumBus);
    click.start(time); click.stop(time + 0.14);
  }

  // ── Bossa Rim Click (replaces snare — dry, crisp wood tone) ──────────────────
  // Classic bossa nova sound: a quiet, dry rimshot on 2 and 4

  _playRim(time) {
    const ctx = this._ctx;

    // Pitched body: two short sine bursts at woodblock frequencies
    for (const [freq, amp] of [[800, 0.55], [1600, 0.28]]) {
      const osc = ctx.createOscillator();
      osc.type  = 'sine';
      osc.frequency.value = freq;
      const g   = ctx.createGain();
      g.gain.setValueAtTime(amp, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.055);
      osc.connect(g).connect(this._drumBus);
      osc.start(time); osc.stop(time + 0.07);
    }

    // Short noise burst for the "stick on rim" texture
    const src = ctx.createBufferSource();
    src.buffer = this._shortNoiseBuf;
    const bp   = ctx.createBiquadFilter();
    bp.type    = 'bandpass'; bp.frequency.value = 4200; bp.Q.value = 2.5;
    const ng   = ctx.createGain();
    ng.gain.setValueAtTime(0.32, time);
    ng.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
    src.connect(bp).connect(ng).connect(this._drumBus);
    src.start(time); src.stop(time + 0.05);
  }

  _playGhostRim(time) {
    // Quiet, brief rim click for Level 1.5 fills
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    osc.type  = 'sine';
    osc.frequency.value = 900;
    const g   = ctx.createGain();
    g.gain.setValueAtTime(0.18, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
    osc.connect(g).connect(this._drumBus);
    osc.start(time); osc.stop(time + 0.04);
  }

  // ── Double-Time Shaker ────────────────────────────────────────────────────────
  // The momentum instrument — runs at 2x BPM, creates illusion of speed
  // Short noise burst HP-filtered for a sibilant, airy shaker tone

  _playShaker(time) {
    const ctx = this._ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._shortNoiseBuf;

    const hp = ctx.createBiquadFilter();
    hp.type  = 'highpass'; hp.frequency.value = 6500;

    // Slight resonant peak for shaker body character
    const peak = ctx.createBiquadFilter();
    peak.type  = 'peaking'; peak.frequency.value = 9000; peak.gain.value = 3; peak.Q.value = 1.5;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.022);

    src.connect(hp).connect(peak).connect(g).connect(this._drumBus);
    src.start(time); src.stop(time + 0.03);
  }

  // ── Double-Time Hi-Hat ────────────────────────────────────────────────────────
  // 6 inharmonic square oscillators (808 method) — lighter than hip-hop hat

  _playHiHat(time) {
    const ctx    = this._ctx;
    const ratios = [2.0, 3.0, 4.16, 5.43, 6.79, 8.21];
    const baseHz = 40;

    const master = ctx.createGain();
    master.gain.setValueAtTime(0.14, time);
    master.gain.exponentialRampToValueAtTime(0.001, time + 0.045);

    const hp = ctx.createBiquadFilter();
    hp.type  = 'highpass'; hp.frequency.value = 8500;
    master.connect(hp).connect(this._drumBus);

    for (const r of ratios) {
      const osc = ctx.createOscillator();
      osc.type  = 'square';
      osc.frequency.value = baseHz * r;
      const g   = ctx.createGain(); g.gain.value = 0.10;
      osc.connect(g).connect(master);
      osc.start(time); osc.stop(time + 0.06);
    }
  }

  _playGhostHiHat(time) {
    // Level 1.5 fill: very quiet hat on off-positions
    const ctx = this._ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._shortNoiseBuf;
    const hp  = ctx.createBiquadFilter();
    hp.type   = 'highpass'; hp.frequency.value = 9000;
    const g   = ctx.createGain();
    g.gain.setValueAtTime(0.04, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.018);
    src.connect(hp).connect(g).connect(this._drumBus);
    src.start(time);
  }

  // ── Sidechain Duck ────────────────────────────────────────────────────────────

  _duck(node, time, depth, attack, release) {
    node.gain.cancelScheduledValues(time);
    node.gain.setValueAtTime(1.0, time);
    node.gain.linearRampToValueAtTime(depth, time + attack);
    node.gain.exponentialRampToValueAtTime(1.0, time + attack + release);
  }

  // ── Vinyl Crackle ─────────────────────────────────────────────────────────────
  // 4-second buffer, Poisson-distributed clicks (~15/sec), looped

  _buildCrackle() {
    const sr  = this._ctx.sampleRate;
    const len = sr * 4;
    const buf = this._ctx.createBuffer(1, len, sr);
    const d   = buf.getChannelData(0);
    // Rate parameter 15 clicks/sec — slightly sparser than hip-hop crackle
    let pos = 0;
    while (pos < len) {
      pos += Math.floor(-Math.log(Math.random()) / 15 * sr);
      if (pos >= len) break;
      const amp = 0.25 + Math.random() * 0.65;
      d[pos] = amp;
      if (pos + 1 < len) d[pos + 1] = amp * -0.4;
      if (pos + 2 < len) d[pos + 2] = amp * 0.15;
    }
    this._crackleBuf = buf;
  }

  _startCrackle() {
    if (this._crackleSource) return;
    this._crackleSource = this._ctx.createBufferSource();
    this._crackleSource.buffer = this._crackleBuf;
    this._crackleSource.loop   = true;
    const hp = this._ctx.createBiquadFilter();
    hp.type  = 'highpass'; hp.frequency.value = 800;
    this._crackleSource.connect(hp).connect(this._crackleBus);
    this._crackleSource.start();
  }

  _stopCrackle() {
    if (this._crackleSource) {
      try { this._crackleSource.stop(); } catch (_) {}
      this._crackleSource = null;
    }
  }

  // ── Utility ───────────────────────────────────────────────────────────────────

  _makeNoise(seconds) {
    const sr  = this._ctx.sampleRate;
    const buf = this._ctx.createBuffer(1, Math.floor(sr * seconds), sr);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _makeClickBurst(seconds, density) {
    const sr  = this._ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = this._ctx.createBuffer(1, len, sr);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      if (Math.random() < density / sr) {
        d[i] = (Math.random() * 2 - 1) * (0.5 + Math.random() * 0.5);
      }
    }
    return buf;
  }

  _tanhCurve(drive) {
    const n     = 8192;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x  = (i / n) * 2 - 1;
      curve[i] = Math.tanh(x * drive);
    }
    return curve;
  }
}
