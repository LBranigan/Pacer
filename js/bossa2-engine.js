/**
 * Bossa2Engine — Bossa Nova + Piano (Clone) with dual-tempo system
 *
 * Cloned from LofiEngine's bossa-piano style, rebuilt as standalone.
 * Dual BPM: "fast tapping" at +6 runs at WCPM, everything else at WCPM/2.
 *
 * Key: Dm (ii-V-I-vi in C)  | Progression: Dm9 → G7 → Cmaj9 → A7
 *
 * Layer 1 (Base):  Warm triangle pad chords
 * Layer 2 (+3):    Bossa drums (surdo kick + clave rim + 8th hats) — slow tempo
 * Layer 3 (+6):    Fast rim tapping (= WCPM) + shaker
 * Layer 4 (+9):    Walking bass + melodic fills — slow tempo
 * Layer 5 (+12):   Piano comping stabs — slow tempo
 */

// ─── Frequencies ────────────────────────────────────────────────────────────
const N = {
  A1:55, C2:65.41, D2:73.42, F2:87.31, G2:98, A2:110, Bb2:116.54,
  C3:130.81, D3:146.83, E3:164.81, F3:174.61, G3:196, A3:220, B3:246.94,
  C4:261.63, Db4:277.18, D4:293.66, E4:329.63, F4:349.23, G4:392, A4:440, B4:493.88,
  C5:523.25, D5:554.37, E5:659.25, F5:698.46, G5:783.99,
};

// ─── Chord progression ──────────────────────────────────────────────────────
const CHORDS = [
  { name:'Dm9',   notes:[N.D3,N.F3,N.A3,N.C4,N.E4], root:N.D2,
    scale:[N.D4,N.E4,N.F4,N.G4,N.A4,N.C5] },
  { name:'G7',    notes:[N.G3,N.B3,N.D4,N.F4],       root:N.G2,
    scale:[N.G4,N.A4,N.B4,N.D5,N.F4,N.E4] },
  { name:'Cmaj9', notes:[N.C3,N.E3,N.G3,N.B3,N.D4],  root:N.C2,
    scale:[N.C4,N.D4,N.E4,N.G4,N.A4,N.B4] },
  { name:'A7',    notes:[N.A2,N.Db4,N.E3,N.G3],       root:N.A1,
    scale:[N.A3,N.B3,N.Db4,N.D4,N.E4,N.G4] },
];

// ─── Bossa drum patterns (32-step, 2 bars) ─────────────────────────────────
// Authentic bossa nova: surdo kick + 3-2 clave rim + steady 8th hats
const KICK_PAT  = [1,0,0,0, 0,1,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0, 0,1,0,0, 1,0,0,0];
const CLAVE_PAT = [1,0,1,0, 0,0,1,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 1,0,0,0, 1,0,0,0, 0,0,0,0];
const HAT_PAT   = [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0];

// ─── Fast tapping pattern (+6) — 32-step at FAST tempo ─────────────────────
// Dense rim clicks filling gaps in the clave
const TAP_PAT = [0,1,0,1, 1,0,0,1, 1,0,1,0, 0,1,1,1, 0,1,1,1, 0,1,0,1, 0,1,1,1, 0,1,1,1];
// Shaker on every other step
const SHAKER_PAT=[1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0];

// ─── Bass pattern (slow tempo, 32-step) ────────────────────────────────────
const BASS_PAT = [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0, 1,0,0,0, 0,0,0,0, 0,0,1,0];
// Walking bass fills at +9 (fill between main bass hits)
const BASS_WALK= [0,0,1,0, 0,0,1,0, 1,0,1,0, 0,0,0,0, 0,0,1,0, 0,0,1,0, 1,0,1,0, 0,0,0,0];

// ─── Melody pattern (+9, slow tempo, 32-step) ──────────────────────────────
const MELODY_PAT=[0,0,0,0, 1,0,1,0, 0,1,0,0, 0,0,1,0, 0,0,0,0, 1,0,1,0, 0,1,0,0, 0,0,1,0];

// ─── Piano comp pattern (+12, slow tempo, 32-step) ─────────────────────────
const COMP_PAT = [0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,1];

// ─── Tuning ─────────────────────────────────────────────────────────────────
const BARS_PER_CHORD = 2;

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeReverb(ctx, dur, decay) {
  const rate = ctx.sampleRate, len = rate * dur | 0;
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (rate * decay));
  }
  return buf;
}

// ─── Engine ─────────────────────────────────────────────────────────────────

export class Bossa2Engine {
  constructor(ctx) {
    this._ctx = ctx;
    this._bpm = 75;          // slow tempo (pads/drums/bass/melody/piano) = WCPM/2
    this._tapBpm = 150;      // fast tempo (tapping at +6) = WCPM
    this._playing = false;
    this._overlayLevel = 0;
    this._chordIdx = 0;
    this._tickId = null;
    this._lastChordTime = 0;
    this._padVoices = [];
    this._currentPad = null;

    // Slow-grid state (32 steps per 2 bars)
    this._slowPos = 0;
    this._nextSlowTime = 0;

    // Fast-grid state (32 steps per 2 bars at WCPM tempo)
    this._fastPos = 0;
    this._nextFastTime = 0;

    const reverbIR = makeReverb(ctx, 2.5, 1.4);

    // ── Master ──────────────────────────────────────────────────────────
    this._comp = ctx.createDynamicsCompressor();
    this._comp.threshold.value = -16; this._comp.ratio.value = 3;
    this._comp.knee.value = 10; this._comp.attack.value = 0.005; this._comp.release.value = 0.2;
    this.output = ctx.createGain(); this.output.gain.value = 1.0;
    this._comp.connect(this.output);

    // ── Pad bus: triangle → LP 3kHz → reverb 25% ───────────────────────
    this._padBus = ctx.createGain(); this._padBus.gain.value = 1.0;
    this._padLP = ctx.createBiquadFilter();
    this._padLP.type = 'lowpass'; this._padLP.frequency.value = 3000; this._padLP.Q.value = 0.8;
    this._padReverb = ctx.createConvolver(); this._padReverb.buffer = reverbIR;
    this._padWet = ctx.createGain(); this._padWet.gain.value = 0.25;
    this._padDry = ctx.createGain(); this._padDry.gain.value = 0.75;
    this._padBus.connect(this._padLP);
    this._padLP.connect(this._padReverb); this._padReverb.connect(this._padWet); this._padWet.connect(this._comp);
    this._padLP.connect(this._padDry); this._padDry.connect(this._comp);

    // ── Bass bus: sine → LP 450Hz ───────────────────────────────────────
    this._bassBus = ctx.createGain(); this._bassBus.gain.value = 1.0;
    this._bassLP = ctx.createBiquadFilter();
    this._bassLP.type = 'lowpass'; this._bassLP.frequency.value = 450; this._bassLP.Q.value = 0.7;
    this._bassBus.connect(this._bassLP); this._bassLP.connect(this._comp);

    // ── Drum bus ─────────────────────────────────────────────────────────
    this._drumBus = ctx.createGain(); this._drumBus.gain.value = 0.6;
    this._drumBus.connect(this._comp);

    // ── Tap bus (fast tapping) → reverb 15% ─────────────────────────────
    this._tapBus = ctx.createGain(); this._tapBus.gain.value = 0.5;
    this._tapReverb = ctx.createConvolver(); this._tapReverb.buffer = reverbIR;
    this._tapWet = ctx.createGain(); this._tapWet.gain.value = 0.15;
    this._tapDry = ctx.createGain(); this._tapDry.gain.value = 0.85;
    this._tapBus.connect(this._tapReverb); this._tapReverb.connect(this._tapWet); this._tapWet.connect(this._comp);
    this._tapBus.connect(this._tapDry); this._tapDry.connect(this._comp);

    // ── Melody bus: sine → LP 5kHz → reverb 20% ────────────────────────
    this._melBus = ctx.createGain(); this._melBus.gain.value = 0.8;
    this._melLP = ctx.createBiquadFilter();
    this._melLP.type = 'lowpass'; this._melLP.frequency.value = 5000; this._melLP.Q.value = 0.7;
    this._melReverb = ctx.createConvolver(); this._melReverb.buffer = reverbIR;
    this._melWet = ctx.createGain(); this._melWet.gain.value = 0.2;
    this._melDry = ctx.createGain(); this._melDry.gain.value = 0.8;
    this._melBus.connect(this._melLP);
    this._melLP.connect(this._melReverb); this._melReverb.connect(this._melWet); this._melWet.connect(this._comp);
    this._melLP.connect(this._melDry); this._melDry.connect(this._comp);

    // ── Piano bus: triangle → LP 4kHz → reverb 30% ─────────────────────
    this._pianoBus = ctx.createGain(); this._pianoBus.gain.value = 0.7;
    this._pianoLP = ctx.createBiquadFilter();
    this._pianoLP.type = 'lowpass'; this._pianoLP.frequency.value = 4000; this._pianoLP.Q.value = 0.8;
    this._pianoReverb = ctx.createConvolver(); this._pianoReverb.buffer = reverbIR;
    this._pianoWet = ctx.createGain(); this._pianoWet.gain.value = 0.3;
    this._pianoDry = ctx.createGain(); this._pianoDry.gain.value = 0.7;
    this._pianoBus.connect(this._pianoLP);
    this._pianoLP.connect(this._pianoReverb); this._pianoReverb.connect(this._pianoWet); this._pianoWet.connect(this._comp);
    this._pianoLP.connect(this._pianoDry); this._pianoDry.connect(this._comp);
  }

  // ── Pad (Layer 1) ───────────────────────────────────────────────────────

  _playPadChord(idx, time) {
    const chord = CHORDS[idx % CHORDS.length];
    const voices = [];
    for (const freq of chord.notes) {
      const ctx = this._ctx, g = ctx.createGain();
      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(0.06, time + 0.1);
      g.connect(this._padBus);
      const osc = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = freq;
      osc.connect(g); osc.start(time);
      voices.push({ osc, gain: g });
    }
    this._padVoices.push(...voices);
    return voices;
  }

  _fadeOutPad(voices, time) {
    for (const v of voices) {
      v.gain.gain.cancelScheduledValues(time);
      v.gain.gain.setValueAtTime(v.gain.gain.value, time);
      v.gain.gain.linearRampToValueAtTime(0, time + 0.4);
      try { v.osc.stop(time + 0.5); } catch (_) {}
      setTimeout(() => { try { v.osc.disconnect(); v.gain.disconnect(); } catch (_) {} }, 1000);
    }
    this._padVoices = this._padVoices.filter(v => !voices.includes(v));
  }

  // ── Drums (Layer 2) ─────────────────────────────────────────────────────

  _playSoftKick(time) {
    const ctx = this._ctx, osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(100, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.1);
    g.gain.setValueAtTime(0.15, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.25);
    osc.connect(g); g.connect(this._drumBus); osc.start(time); osc.stop(time + 0.3);
  }

  _playRimClick(time) {
    const ctx = this._ctx, len = ctx.sampleRate * 0.015 | 0;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.2));
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 3;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.12, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
    src.connect(bp); bp.connect(g); g.connect(this._drumBus); src.start(time);
  }

  _playSoftHat(time) {
    const ctx = this._ctx, len = ctx.sampleRate * 0.015 | 0;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.3));
    const src = ctx.createBufferSource(); src.buffer = buf;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 8000;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.05, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
    src.connect(hp); hp.connect(g); g.connect(this._drumBus); src.start(time);
  }

  // ── Fast tapping (Layer 3 / +6) ────────────────────────────────────────

  _playTap(time) {
    // Short, bright rim tap
    const ctx = this._ctx, len = ctx.sampleRate * 0.01 | 0;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.15));
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 4;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.09, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
    src.connect(bp); bp.connect(g); g.connect(this._tapBus); src.start(time);
  }

  _playShaker(time) {
    const ctx = this._ctx, len = ctx.sampleRate * 0.02 | 0;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.4));
    const src = ctx.createBufferSource(); src.buffer = buf;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.04, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
    src.connect(hp); hp.connect(g); g.connect(this._tapBus); src.start(time);
  }

  // ── Bass (Layer 4 / +9) ─────────────────────────────────────────────────

  _playBassNote(freq, time, dur) {
    const ctx = this._ctx, osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = freq;
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(0.18, time + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    osc.connect(g); g.connect(this._bassBus);
    osc.start(time); osc.stop(time + dur + 0.05);
  }

  // ── Melody (Layer 4 / +9) ──────────────────────────────────────────────

  _playMelNote(freq, time, dur) {
    const ctx = this._ctx, osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = freq;
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(0.08, time + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    osc.connect(g); g.connect(this._melBus);
    osc.start(time); osc.stop(time + dur + 0.05);
  }

  // ── Piano comping (Layer 5 / +12) ─────────────────────────────────────

  _playPianoStab(notes, time, dur) {
    const ctx = this._ctx;
    for (const freq of notes) {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'triangle'; osc.frequency.value = freq * 2; // octave up for brightness
      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(0.04, time + 0.005);
      g.gain.exponentialRampToValueAtTime(0.001, time + dur);
      osc.connect(g); g.connect(this._pianoBus);
      osc.start(time); osc.stop(time + dur + 0.05);
    }
  }

  // ── Scheduler ─────────────────────────────────────────────────────────────

  _tick() {
    if (!this._playing) return;
    const now = this._ctx.currentTime;
    const slowStep = 60 / this._bpm / 4;      // slow 16th-note duration
    const fastStep = 60 / this._tapBpm / 4;   // fast 16th-note duration (= WCPM grid)
    const barDur = slowStep * 16;              // bar at slow tempo
    const chordDur = barDur * BARS_PER_CHORD;
    const LA = 0.15;

    // ── Chord changes ───────────────────────────────────────────────────
    if (now - this._lastChordTime >= chordDur - 0.01) {
      const t = Math.max(now, this._lastChordTime + chordDur);
      if (this._currentPad) this._fadeOutPad(this._currentPad, t);
      this._chordIdx = (this._chordIdx + 1) % CHORDS.length;
      this._currentPad = this._playPadChord(this._chordIdx, t);
      this._lastChordTime = t;
      this._slowPos = 0; this._nextSlowTime = t;
      this._fastPos = 0; this._nextFastTime = t;
    }

    const chord = CHORDS[this._chordIdx % CHORDS.length];

    // ── SLOW GRID (pads, drums, bass, melody, piano) ────────────────────
    while (this._nextSlowTime < now + LA && this._slowPos < 32) {
      const t = this._nextSlowTime;
      const p = this._slowPos;

      // Layer 2 (+3): Bossa drums at slow tempo
      if (this._overlayLevel >= 0.35) {
        if (KICK_PAT[p])  this._playSoftKick(t);
        if (CLAVE_PAT[p]) this._playRimClick(t);
        if (HAT_PAT[p])   this._playSoftHat(t);
      }

      // Layer 4 (+9): Bass + melody at slow tempo
      if (this._overlayLevel >= 1.0) {
        if (BASS_PAT[p]) {
          this._playBassNote(chord.root, t, slowStep * 3);
        } else if (BASS_WALK[p]) {
          // Walking bass: passing tones
          const passing = [chord.root * 2, chord.notes[1] ? chord.notes[1] / 2 : chord.root * 1.5, chord.root * 1.5];
          this._playBassNote(passing[p % passing.length], t, slowStep * 2);
        }
        if (MELODY_PAT[p] && chord.scale.length >= 3) {
          const scaleIdx = p % chord.scale.length;
          this._playMelNote(chord.scale[scaleIdx], t, slowStep * 2.5);
        }
      }

      // Layer 5 (+12): Piano comping at slow tempo
      if (this._overlayLevel >= 1.5) {
        if (COMP_PAT[p]) {
          this._playPianoStab(chord.notes, t, slowStep * 4);
        }
      }

      this._nextSlowTime += slowStep;
      this._slowPos++;
    }

    // ── FAST GRID (tapping only, at WCPM tempo) ─────────────────────────
    if (this._overlayLevel >= 0.65) {
      while (this._nextFastTime < now + LA && this._fastPos < 32) {
        const t = this._nextFastTime;
        const p = this._fastPos;
        if (TAP_PAT[p])    this._playTap(t);
        if (SHAKER_PAT[p]) this._playShaker(t);
        this._nextFastTime += fastStep;
        this._fastPos++;
      }
    }

    this._tickId = setTimeout(() => this._tick(), 40);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  start() {
    if (this._playing) this.stop();
    this._playing = true;
    if (this._ctx.state === 'suspended') this._ctx.resume();
    const now = this._ctx.currentTime;
    this._chordIdx = 0; this._lastChordTime = now;
    this._currentPad = this._playPadChord(0, now);
    this._slowPos = 0; this._nextSlowTime = now;
    this._fastPos = 0; this._nextFastTime = now;
    this._tickId = setTimeout(() => this._tick(), 40);
  }

  stop() {
    this._playing = false;
    if (this._tickId) { clearTimeout(this._tickId); this._tickId = null; }
    const now = this._ctx.currentTime;
    for (const v of this._padVoices) {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setValueAtTime(v.gain.gain.value, now);
      v.gain.gain.linearRampToValueAtTime(0, now + 0.3);
      try { v.osc.stop(now + 0.4); } catch (_) {}
    }
    this._padVoices = []; this._currentPad = null;
  }

  setTempo(bpm) {
    // bpm input = WCPM. Fast tapping runs at WCPM, everything else at half.
    this._tapBpm = Math.max(40, Math.min(200, bpm));
    this._bpm = Math.max(30, Math.min(120, bpm / 2));
  }
  setStyle() {}
  setOverlayLevel(level) { this._overlayLevel = level; }
  setDensity() {}
  setCrackleIntensity() {}
  setSentenceAligned() {}
  setCelebrations() {}
  setMelody() {}
  setAdaptiveHarmony() {}
  advanceChord() {}
  notifyWordEvent() {}
  playMelodicPing() {}
  playRecordSkip() {}
  playNeedleDrop() {}
  setHarmonyMood() {}
  get isPlaying() { return this._playing; }
  get currentBpm() { return this._bpm; }
  getBeatPhase() { return 0; }
  pause()   { this.stop(); }
  resume()  { this.start(); }
  dispose() { this.stop(); }
}
