/**
 * Lofi4Engine — "Night Coffee"
 *
 * Inspired by 'Night Coffee' by S N U G and Mondo Loops.
 * 76 BPM, key of C major / A minor. Warm, jazzy, late-night coffee shop.
 *
 * Chord progression: ii-V-I-vi  (Dm9 → G13 → Cmaj9 → Am7)
 *
 * Instruments:
 *   - Rain texture (bandpass noise, continuous, gentle LFO variation)
 *   - Vinyl crackle (Poisson ~8 clicks/sec, looped 4s)
 *   - Soft thump kick (triangle sweep 100→50Hz) on 1 and "and" of 2
 *   - LP snare (bandpass noise 2kHz + LP 4kHz) on 2 and 4
 *   - Hi-hats with "drunk" swing (55% ratio + micro-jitter)
 *   - Rhodes MKII (sine + chorus detune + bell + wow/flutter LFO + tremolo)
 *   - Sub sine bass (root note, heavy sidechain pump to kick)
 *   - Muted jazz guitar (square wave, bandpass 1kHz, quick decay stabs)
 *   - Muted trumpet (sine, bandpass 1200Hz Harmon mute, vibrato, spring reverb)
 *   - Foley clicks (short filtered bursts, ~15% chance per step)
 *   - Ghost hi-hats (very soft, between main hat hits)
 *
 * Overlay levels:
 *   0.00 — Rain + vinyl crackle (establishing the room)
 *   0.35 — + Drums (kick, snare, hats with drunk swing)
 *   0.65 — + Rhodes chords + Sub bass (heavy sidechain pump)
 *   1.00 — + Jazz guitar stabs + Muted trumpet melody (lazy, reverbed)
 *   1.50 — + Ghost hats + foley clicks + radio filter breakdown
 *
 * Step resolution: 32 steps per cycle, each step = 60/BPM seconds.
 * API-compatible with LofiEngine / rhythm-remix.js integration.
 */

// -- Note Frequencies (Hz) ----------------------------------------------------

const NOTE = {
  A1: 55.00, C2: 65.41, D2: 73.42, G2: 98.00, A2: 110.00,
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.00,
  A3: 220.00, B3: 246.94, C4: 261.63, D4: 293.66, E4: 329.63,
  F4: 349.23, G4: 392.00, A4: 440.00, B4: 493.88, C5: 523.25,
  D5: 587.33,
};

// -- Chord Progression: ii-V-I-vi in C major ----------------------------------
// Close voicings (tightly packed), jazzy extended chords

const CHORDS = [
  {
    name: 'Dm9',
    notes: [NOTE.D3, NOTE.F3, NOTE.A3, NOTE.C4, NOTE.E4],
    root: NOTE.D2,
    // Melody: 5th (A) and 7th (C) first, then passing tones
    melody: [NOTE.A4, NOTE.C5, NOTE.D4, NOTE.E4, NOTE.F4],
    guitar: [NOTE.D4, NOTE.F4, NOTE.A4],
  },
  {
    name: 'G13',
    notes: [NOTE.G3, NOTE.B3, NOTE.D4, NOTE.E4, NOTE.F4],
    root: NOTE.G2,
    melody: [NOTE.D5, NOTE.F4, NOTE.G4, NOTE.A4, NOTE.B4],
    guitar: [NOTE.G4, NOTE.B4, NOTE.D5],
  },
  {
    name: 'Cmaj9',
    notes: [NOTE.C3, NOTE.E3, NOTE.G3, NOTE.B3, NOTE.D4],
    root: NOTE.C2,
    melody: [NOTE.G4, NOTE.B4, NOTE.C5, NOTE.D5, NOTE.E4],
    guitar: [NOTE.C4, NOTE.E4, NOTE.G4],
  },
  {
    name: 'Am7',
    notes: [NOTE.A2, NOTE.C3, NOTE.E3, NOTE.G3],
    root: NOTE.A1,
    melody: [NOTE.E4, NOTE.G4, NOTE.A4, NOTE.C5, NOTE.D5],
    guitar: [NOTE.A3, NOTE.C4, NOTE.E4],
  },
];

// -- Patterns (32 steps per cycle) --------------------------------------------
// 8 steps per bar, 4 bars total. Chord changes every 8 steps.

const DRUM = {
  // Kick on beat 1 and "and" of 2 per bar: steps 0, 3
  kick:  [1,0,0,1, 0,0,0,0, 1,0,0,1, 0,0,0,0, 1,0,0,1, 0,0,0,0, 1,0,0,1, 0,0,0,0],
  // Snare on beats 2 and 4: steps 2, 6
  snare: [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
  // Hi-hat on 8th notes (every other step)
  hat:   [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
};

// Bass follows kick for pumping sidechain feel
const BASS = [1,0,0,1, 0,0,0,0, 1,0,0,1, 0,0,0,0, 1,0,0,1, 0,0,0,0, 1,0,0,1, 0,0,0,0];

// Rhodes: syncopated off-beat comping stabs
const COMP = {
  a: [0,0,0,1, 0,1,0,0, 0,0,0,1, 0,1,0,0, 0,0,0,1, 0,1,0,0, 0,0,0,1, 0,1,0,0],
  b: [0,0,0,1, 0,1,0,1, 0,0,0,1, 0,1,0,1, 0,0,0,1, 0,1,0,1, 0,0,0,1, 0,1,0,1],
};

// Guitar: sparse muted stabs in the rhythmic gaps
const GUITAR = {
  a: [0,0,0,0, 0,0,1,0, 0,0,0,0, 1,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0, 1,0,0,0],
  b: [0,0,0,0, 1,0,1,0, 0,0,0,0, 1,0,0,1, 0,0,0,0, 1,0,1,0, 0,0,0,0, 1,0,0,1],
};

// Melody: sparse, lazy — focused on 5ths and 7ths of each chord
const MELODY = {
  a: [0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,0],
  b: [0,0,0,0, 0,0,0,1, 0,0,1,0, 0,0,0,0, 0,0,0,0, 0,0,0,1, 0,0,0,0, 0,1,0,0],
};

// Ghost hats: fill between main hat hits (level 1.5)
const GHOST_HAT = [0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1];

const STEPS = 32;

// -- Deterministic PRNG -------------------------------------------------------

function stepRand(step, salt) {
  let h = (step * 2654435761 + salt * 340573321) >>> 0;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = (h >> 16) ^ h;
  return (h >>> 0) / 0x100000000;
}

// -- Engine -------------------------------------------------------------------

export class Lofi4Engine {
  constructor(ctx) {
    this._ctx = ctx;
    this._playing = false;
    this._paused  = false;
    this._bpm     = 76;
    this._step    = 0;
    this._nextStepTime = 0;
    this._schedId = null;
    this._density = 'normal';
    this._overlayLevel = 0;
    this._chordIdx = 0;
    this._style   = 'lofi4';
    this._activeSources = new Set();
    this._cycleCount = 0;

    // -- Master output --
    this.output = ctx.createGain();
    this.output.gain.value = 0.70;

    // -- Channel buses --
    this._drumBus    = ctx.createGain(); this._drumBus.gain.value    = 0.45;
    this._padBus     = ctx.createGain(); this._padBus.gain.value     = 0.28;
    this._bassBus    = ctx.createGain(); this._bassBus.gain.value    = 0.40;
    this._melodyBus  = ctx.createGain(); this._melodyBus.gain.value  = 0.30;
    this._rainBus    = ctx.createGain(); this._rainBus.gain.value    = 0.06;
    this._crackleBus = ctx.createGain(); this._crackleBus.gain.value = 0.015;

    // -- Pad LP filter (2000Hz) --
    this._padFilter = ctx.createBiquadFilter();
    this._padFilter.type = 'lowpass';
    this._padFilter.frequency.value = 2000;
    this._padFilter.Q.value = 0.5;

    // -- Bass LP filter (350Hz — round, sub-heavy) --
    this._bassFilter = ctx.createBiquadFilter();
    this._bassFilter.type = 'lowpass';
    this._bassFilter.frequency.value = 350;
    this._bassFilter.Q.value = 0.5;

    // -- Melody radio filter (HP + LP, normally bypassed) --
    this._melodyHP = ctx.createBiquadFilter();
    this._melodyHP.type = 'highpass';
    this._melodyHP.frequency.value = 20;
    this._melodyHP.Q.value = 0.5;
    this._melodyLP = ctx.createBiquadFilter();
    this._melodyLP.type = 'lowpass';
    this._melodyLP.frequency.value = 20000;
    this._melodyLP.Q.value = 0.5;

    // -- Spring reverb (convolver for muted trumpet) --
    this._springConvolver = ctx.createConvolver();
    this._springConvolver.buffer = this._buildSpringReverbIR();
    this._reverbSend   = ctx.createGain(); this._reverbSend.gain.value   = 0.35;
    this._reverbReturn = ctx.createGain(); this._reverbReturn.gain.value = 0.30;

    // -- Warmth LP (7000Hz) --
    this._warmth = ctx.createBiquadFilter();
    this._warmth.type = 'lowpass';
    this._warmth.frequency.value = 7000;
    this._warmth.Q.value = 0.5;

    // -- Tape saturation (tanh, drive 1.6) --
    this._sat = ctx.createWaveShaper();
    this._sat.curve = this._tanhCurve(1.6);
    this._sat.oversample = '2x';

    // -- Bus compressor --
    this._comp = ctx.createDynamicsCompressor();
    this._comp.threshold.value = -18;
    this._comp.ratio.value     = 3;
    this._comp.knee.value      = 6;
    this._comp.attack.value    = 0.008;
    this._comp.release.value   = 0.20;

    // -- Signal chain --
    this._padBus.connect(this._padFilter);
    this._padFilter.connect(this._warmth);
    this._bassBus.connect(this._bassFilter);
    this._bassFilter.connect(this._warmth);
    this._drumBus.connect(this._warmth);
    this._melodyBus.connect(this._melodyHP);
    this._melodyHP.connect(this._melodyLP);
    this._melodyLP.connect(this._warmth);
    this._reverbSend.connect(this._springConvolver);
    this._springConvolver.connect(this._reverbReturn);
    this._reverbReturn.connect(this._warmth);
    this._rainBus.connect(this._warmth);
    this._crackleBus.connect(this._sat);
    this._warmth.connect(this._sat);
    this._sat.connect(this._comp);
    this._comp.connect(this.output);

    // -- Noise buffers --
    this._shortNoiseBuf = this._makeNoise(0.1);
    this._rainNoiseBuf  = this._makeNoise(4.0);

    // -- Persistent sources --
    this._padSource     = null;
    this._crackleSource = null;
    this._rainSource    = null;
    this._crackleBuf    = null;
    this._buildCrackle();
  }

  // -- Getters ----------------------------------------------------------------

  get isPlaying()        { return this._playing && !this._paused; }
  get currentBpm()       { return this._bpm; }
  get overlayLevel()     { return this._overlayLevel; }
  get currentChordName() { return CHORDS[this._chordIdx % 4].name; }

  // -- Playback Control -------------------------------------------------------

  start() {
    if (this._playing) this.stop();
    if (this._ctx.state === 'suspended') this._ctx.resume();
    this._playing = true;
    this._paused  = false;
    this._step    = 0;
    this._chordIdx = 0;
    this._cycleCount = 0;
    this._nextStepTime = this._ctx.currentTime + 0.05;
    this._startPad();
    this._startCrackle();
    this._startRain();
    this._schedId = setInterval(() => this._tick(), 25);
  }

  stop() {
    this._playing = false;
    this._paused  = false;
    if (this._schedId !== null) { clearInterval(this._schedId); this._schedId = null; }
    this._releaseAllSources();
    this._stopPad();
    this._stopCrackle();
    this._stopRain();
    this._melodyHP.frequency.value = 20;
    this._melodyLP.frequency.value = 20000;
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
  setStyle()    {}

  setOverlayLevel(level) {
    this._overlayLevel = level;
    const masterGain = level >= 1.5 ? 0.80 : 0.70;
    this.output.gain.setTargetAtTime(masterGain, this._ctx.currentTime, 0.1);
    if (this._padSource) {
      const padVol = level >= 0.65 ? 0.06 : 0.12;
      this._padSource._gainNode.gain.setTargetAtTime(padVol, this._ctx.currentTime, 0.3);
    }
  }

  setDensity(d) { this._density = d; }

  setCrackleIntensity(intensity) {
    const gains = { light: 0.025, medium: 0.05, heavy: 0.10 };
    this._crackleBus.gain.setTargetAtTime(
      gains[intensity] ?? 0.025, this._ctx.currentTime, 0.05
    );
  }

  playRecordSkip() {
    const t = this._ctx.currentTime;
    const buf = this._makeClickBurst(0.15, 300);
    const src = this._ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this._crackleBus);
    src.start(t);
    this.output.gain.setValueAtTime(0.70, t);
    this.output.gain.linearRampToValueAtTime(0.35, t + 0.03);
    this.output.gain.linearRampToValueAtTime(0.70, t + 0.22);
  }

  playNeedleDrop() {
    const t = this._ctx.currentTime;
    const osc = this._ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(32, t + 0.18);
    const g = this._ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    osc.connect(g).connect(this._drumBus);
    osc.start(t); osc.stop(t + 0.32);
  }

  // -- Stubs ------------------------------------------------------------------

  setCelebrations()    {}
  notifyWordEvent()    {}
  setMelody()          {}
  playMelodicPing()    {}
  setAdaptiveHarmony() {}
  setHarmonyMood()     {}
  setSentenceAligned() {}
  advanceChord()       {}

  getBeatPhase() {
    if (!this._playing) return 0;
    const stepDur = 60 / this._bpm;
    const elapsed = this._ctx.currentTime - (this._nextStepTime - stepDur);
    return Math.max(0, Math.min(1, (elapsed / stepDur) % 1));
  }

  // -- Scheduler --------------------------------------------------------------

  _tick() {
    const stepDur = 60 / this._bpm;
    const lookahead = 0.12;
    const now = this._ctx.currentTime;

    if (this._nextStepTime < now - 0.3) {
      const skipped = Math.floor((now - this._nextStepTime) / stepDur);
      this._nextStepTime += skipped * stepDur;
      this._step = (this._step + skipped) % STEPS;
      this._chordIdx = Math.floor(this._step / 8) % 4;
    }

    while (this._nextStepTime < now + lookahead) {
      this._scheduleStep(this._nextStepTime, this._step % STEPS, stepDur);
      this._nextStepTime += stepDur;
      this._step++;
      if (this._step % 8 === 0) {
        this._chordIdx = (this._chordIdx + 1) % 4;
      }
      if (this._step % STEPS === 0) {
        this._cycleCount++;
        this._updateRadioFilter();
      }
    }
  }

  _scheduleStep(time, s, stepDur) {
    const ol = this._overlayLevel;
    const d  = this._density;
    if (d === 'whisper') return;

    const sparse = d === 'sparse';
    const chord  = CHORDS[this._chordIdx % 4];

    // "Drunk" swing: 55% ratio = 10% delay on upbeats + micro-jitter for human feel
    const swingBase = (s % 2 === 1) ? stepDur * 0.10 : 0;
    const jitter = stepRand(s, this._cycleCount) * stepDur * 0.03;
    const t = time + swingBase + jitter;

    // -- Level 0.35+: Drums ---------------------------------------------------
    if (ol >= 0.35) {
      if (DRUM.kick[s]) {
        this._playKick(time);  // kick stays on grid
        if (ol >= 0.65) {
          this._duck(this._bassBus, time, 0.20, 0.01, 0.30);
          this._duck(this._padBus, time, 0.55, 0.02, 0.25);
        }
      }
      if (DRUM.snare[s]) this._playSnare(t);
      if (DRUM.hat[s])   this._playHat(t, 0.06);
    }

    // -- Level 0.65+: Rhodes + Sub bass ---------------------------------------
    if (ol >= 0.65) {
      if (BASS[s]) {
        this._playBass(time, chord.root, stepDur * 3.0, sparse ? 0.30 : 0.45);
      }
      if (!sparse) {
        const compPat = ol >= 1.0 ? COMP.b : COMP.a;
        if (compPat[s]) {
          this._playRhodes(t, chord.notes, stepDur * 1.8, sparse ? 0.10 : 0.16);
        }
      }
    }

    // -- Level 1.0+: Guitar stabs + Trumpet melody ----------------------------
    if (ol >= 1.0 && !sparse) {
      const guitarPat = ol >= 1.5 ? GUITAR.b : GUITAR.a;
      if (guitarPat[s]) {
        const gIdx = Math.floor(stepRand(s, this._cycleCount + 7) * chord.guitar.length);
        this._playGuitarStab(t, chord.guitar[gIdx], stepDur * 0.4);
      }

      const melPat = ol >= 1.5 ? MELODY.b : MELODY.a;
      if (melPat[s]) {
        // "Lazy" melody: 8% behind the beat
        const lazy = stepDur * 0.08;
        const mIdx = Math.floor(stepRand(s, this._cycleCount + 13) * Math.min(3, chord.melody.length));
        this._playTrumpet(t + lazy, chord.melody[mIdx], stepDur * 2.0);
      }
    }

    // -- Level 1.5+: Ghost hats + foley ---------------------------------------
    if (ol >= 1.5 && !sparse) {
      if (GHOST_HAT[s]) this._playHat(t, 0.025);
      if (stepRand(s, this._cycleCount + 31) < 0.15) {
        this._playFoleyClick(t);
      }
    }
  }

  // -- Radio Filter (2 bars every 16 bars) ------------------------------------

  _updateRadioFilter() {
    if (this._overlayLevel < 1.5) return;
    const now = this._ctx.currentTime;
    if (this._cycleCount > 0 && this._cycleCount % 8 === 0) {
      this._melodyHP.frequency.setTargetAtTime(1000, now, 0.05);
      this._melodyLP.frequency.setTargetAtTime(3000, now, 0.05);
    } else if (this._cycleCount > 0 && this._cycleCount % 8 === 1) {
      this._melodyHP.frequency.setTargetAtTime(20, now, 0.05);
      this._melodyLP.frequency.setTargetAtTime(20000, now, 0.05);
    }
  }

  // -- Rain Texture (always-on base layer) ------------------------------------

  _startRain() {
    if (this._rainSource) return;
    const ctx = this._ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._rainNoiseBuf;
    src.loop = true;

    // Low-mid rumble layer: the body of rain hitting a window
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1200;
    lp.Q.value = 0.4;

    // Gentle high-shelf cut to remove any remaining hiss
    const hs = ctx.createBiquadFilter();
    hs.type = 'highshelf';
    hs.frequency.value = 2000;
    hs.gain.value = -12;  // dB — strongly attenuate highs

    // Gentle LFO on LP cutoff for natural variation (wind gusts)
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.12;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 300;  // ±300Hz wobble around 1200Hz
    lfo.connect(lfoGain);
    lfoGain.connect(lp.frequency);
    lfo.start();

    src.connect(lp).connect(hs).connect(this._rainBus);
    src.start();
    this._rainSource = { src, lfo };
  }

  _stopRain() {
    if (!this._rainSource) return;
    try { this._rainSource.src.stop(); } catch (_) {}
    try { this._rainSource.lfo.stop(); } catch (_) {}
    this._rainSource = null;
  }

  // -- Warm Pad (always-on drone on D3 + A3) ----------------------------------

  _startPad() {
    if (this._padSource) return;
    const ctx = this._ctx;
    const chord = CHORDS[0];
    const gainNode = ctx.createGain();
    gainNode.gain.value = this._overlayLevel >= 0.65 ? 0.06 : 0.12;

    const padLP = ctx.createBiquadFilter();
    padLP.type = 'lowpass';
    padLP.frequency.value = 800;
    padLP.Q.value = 0.5;

    const oscs = [];
    for (const freq of [chord.notes[0], chord.notes[2]]) {
      for (const det of [-2, 2]) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        osc.detune.value = det;
        const g = ctx.createGain(); g.gain.value = 0.10;
        osc.connect(g).connect(gainNode);
        osc.start();
        oscs.push(osc);
      }
    }

    gainNode.connect(padLP);
    padLP.connect(this._padBus);
    this._padSource = { oscs, _gainNode: gainNode };
  }

  _stopPad() {
    if (!this._padSource) return;
    for (const osc of this._padSource.oscs) {
      try { osc.stop(); } catch (_) {}
    }
    this._padSource = null;
  }

  // -- Rhodes MKII (sine + chorus + bell + wow/flutter + tremolo) -------------

  _playRhodes(time, freqs, duration, volume) {
    const ctx = this._ctx;
    const vol = volume / freqs.length;
    const end = time + duration + 0.05;

    // Shared wow LFO: 0.3Hz ±6 cents (tape aging character)
    const wowLfo = ctx.createOscillator();
    wowLfo.type = 'sine';
    wowLfo.frequency.value = 0.3;
    const wowGain = ctx.createGain();
    wowGain.gain.value = 6;
    wowLfo.connect(wowGain);
    wowLfo.start(time); wowLfo.stop(end);
    this._trackSource(wowLfo, end);

    for (const freq of freqs) {
      const osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.value = freq;
      wowGain.connect(osc1.detune);

      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = freq * 1.005;  // +8 cent chorus
      wowGain.connect(osc2.detune);

      const osc3 = ctx.createOscillator();
      osc3.type = 'sine';
      osc3.frequency.value = freq * 2;
      const bell = ctx.createGain();
      bell.gain.setValueAtTime(0.08, time);
      bell.gain.exponentialRampToValueAtTime(0.001, time + 0.3);

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, time);
      env.gain.linearRampToValueAtTime(vol, time + 0.008);
      env.gain.setTargetAtTime(vol * 0.30, time + 0.008, 0.18);
      env.gain.setTargetAtTime(0.001, time + duration * 0.7, duration * 0.2);

      const trem = ctx.createOscillator();
      trem.type = 'sine';
      trem.frequency.value = 4.5;
      const tremGain = ctx.createGain();
      tremGain.gain.value = vol * 0.10;

      const mix = ctx.createGain();
      mix.gain.value = 1.0;
      osc1.connect(mix);
      osc2.connect(mix);
      osc3.connect(bell); bell.connect(mix);
      mix.connect(env);
      trem.connect(tremGain);
      tremGain.connect(env.gain);
      env.connect(this._padBus);

      osc1.start(time); osc1.stop(end);
      osc2.start(time); osc2.stop(end);
      osc3.start(time); osc3.stop(end);
      trem.start(time); trem.stop(end);
      this._trackSource(osc1, end);
      this._trackSource(osc2, end);
      this._trackSource(osc3, end);
      this._trackSource(trem, end);
    }
  }

  // -- Sub Bass (sine + triangle harmonic, sidechained to kick) ---------------

  _playBass(time, freq, duration, volume) {
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;

    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = freq * 2;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(volume, time + 0.015);
    g.gain.setTargetAtTime(volume * 0.6, time + 0.015, 0.12);
    g.gain.setTargetAtTime(0.001, time + duration * 0.6, duration * 0.3);

    const h = ctx.createGain(); h.gain.value = 0.12;
    osc.connect(g);
    osc2.connect(h); h.connect(g);
    g.connect(this._bassBus);

    const end = time + duration + 0.05;
    osc.start(time);  osc.stop(end);
    osc2.start(time); osc2.stop(end);
    this._trackSource(osc, end);
    this._trackSource(osc2, end);
  }

  // -- Soft Kick (triangle sweep 100→50Hz) ------------------------------------

  _playKick(time) {
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(100, time);
    osc.frequency.exponentialRampToValueAtTime(50, time + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.32, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
    osc.connect(g).connect(this._drumBus);
    osc.start(time); osc.stop(time + 0.2);
    this._trackSource(osc, time + 0.25);
  }

  // -- LP Snare (bandpass 2kHz + LP 4kHz for muted character) -----------------

  _playSnare(time) {
    const ctx = this._ctx;
    const dur = 0.09;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2000; bp.Q.value = 1.0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 4000; lp.Q.value = 0.5;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    src.connect(bp).connect(lp).connect(g).connect(this._drumBus);
    src.start(time); src.stop(time + dur + 0.01);
    this._trackSource(src, time + dur + 0.02);
  }

  // -- Hi-Hat (HP noise burst) ------------------------------------------------

  _playHat(time, vol) {
    const ctx = this._ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._shortNoiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 8000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol || 0.06, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
    src.connect(hp).connect(g).connect(this._drumBus);
    src.start(time); src.stop(time + 0.04);
    this._trackSource(src, time + 0.06);
  }

  // -- Muted Jazz Guitar (square wave, bandpass, quick decay stab) ------------

  _playGuitarStab(time, freq, duration) {
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1000;
    bp.Q.value = 2.0;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(0.08, time + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc.connect(bp).connect(g).connect(this._melodyBus);
    const end = time + duration + 0.02;
    osc.start(time); osc.stop(end);
    this._trackSource(osc, end);
  }

  // -- Muted Trumpet (sine + Harmon mute bandpass + vibrato + spring reverb) --

  _playTrumpet(time, freq, duration) {
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;

    const vib = ctx.createOscillator();
    vib.type = 'sine';
    vib.frequency.value = 2.5;
    const vibGain = ctx.createGain();
    vibGain.gain.value = 4;
    vib.connect(vibGain);
    vibGain.connect(osc.detune);

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1200;
    bp.Q.value = 3.0;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(0.14, time + 0.04);
    env.gain.setTargetAtTime(0.10, time + 0.04, 0.2);
    env.gain.setTargetAtTime(0.001, time + duration * 0.6, duration * 0.25);

    osc.connect(bp).connect(env);
    env.connect(this._melodyBus);    // dry
    env.connect(this._reverbSend);   // wet → spring reverb

    const end = time + duration + 0.1;
    osc.start(time);  osc.stop(end);
    vib.start(time);  vib.stop(end);
    this._trackSource(osc, end);
    this._trackSource(vib, end);
  }

  // -- Foley Click (ceramic/paper character) ----------------------------------

  _playFoleyClick(time) {
    const ctx = this._ctx;
    const dur = 0.025;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      if (Math.random() < 0.08) data[i] = (Math.random() - 0.5) * 0.4;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3000;
    bp.Q.value = 1.5;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.06, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);

    src.connect(bp).connect(g).connect(this._drumBus);
    src.start(time); src.stop(time + dur + 0.01);
    this._trackSource(src, time + dur + 0.02);
  }

  // -- Sidechain Duck ---------------------------------------------------------

  _duck(node, time, depth, attack, release) {
    node.gain.cancelScheduledValues(time);
    node.gain.setValueAtTime(1.0, time);
    node.gain.linearRampToValueAtTime(depth, time + attack);
    node.gain.exponentialRampToValueAtTime(1.0, time + attack + release);
  }

  // -- Vinyl Crackle (~8 clicks/sec, 4s loop) ---------------------------------

  _buildCrackle() {
    const sr  = this._ctx.sampleRate;
    const len = sr * 4;
    const buf = this._ctx.createBuffer(1, len, sr);
    const d   = buf.getChannelData(0);
    let pos = 0;
    while (pos < len) {
      pos += Math.floor(-Math.log(Math.random()) / 8 * sr);
      if (pos >= len) break;
      const amp = 0.18 + Math.random() * 0.45;
      d[pos] = amp;
      if (pos + 1 < len) d[pos + 1] = amp * -0.35;
      if (pos + 2 < len) d[pos + 2] = amp * 0.12;
    }
    this._crackleBuf = buf;
  }

  _startCrackle() {
    if (this._crackleSource) return;
    this._crackleSource = this._ctx.createBufferSource();
    this._crackleSource.buffer = this._crackleBuf;
    this._crackleSource.loop = true;
    const hp = this._ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 800;
    this._crackleSource.connect(hp).connect(this._crackleBus);
    this._crackleSource.start();
  }

  _stopCrackle() {
    if (this._crackleSource) {
      try { this._crackleSource.stop(); } catch (_) {}
      this._crackleSource = null;
    }
  }

  // -- Spring Reverb IR (1.2s, metallic decay) --------------------------------

  _buildSpringReverbIR() {
    const sr = this._ctx.sampleRate;
    const dur = 1.2;
    const len = Math.ceil(sr * dur);
    const buf = this._ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const env = Math.exp(-i / (sr * 0.3));
        const res = Math.sin(i * 0.018) * 0.25 + Math.sin(i * 0.031) * 0.15;
        d[i] = (Math.random() * 2 - 1 + res) * env;
      }
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 2; i < len; i++) d[i] = (d[i] + d[i - 1] + d[i - 2]) / 3;
      }
    }
    return buf;
  }

  // -- Source Tracking --------------------------------------------------------

  _trackSource(source, expiresAt) {
    this._activeSources.add(source);
    const cleanup = () => this._activeSources.delete(source);
    source.onended = cleanup;
    const ms = Math.max(50, (expiresAt - this._ctx.currentTime) * 1000 + 300);
    setTimeout(cleanup, ms);
  }

  _releaseAllSources() {
    for (const src of this._activeSources) {
      try { src.stop(0); } catch (_) {}
    }
    this._activeSources.clear();
  }

  // -- Utility ----------------------------------------------------------------

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
    const n = 8192;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / n) * 2 - 1;
      curve[i] = Math.tanh(x * drive);
    }
    return curve;
  }
}
