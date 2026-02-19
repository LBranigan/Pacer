/**
 * Bramble Engine — "Superstar" (Stickerbush Symphony, DKC2, David Wise)
 *
 * Key: Bb major | Tempo: 95 BPM | Progression: Bbmaj7 → Gm7 → Ebmaj7 → F
 *
 * Synthesis: Filtered sawtooth pads (Juno-style), sub-bass, warm lead.
 * NOT triangle waves — those sound like wind chimes.
 *
 * Layer 1 (Base):  Warm sawtooth pads
 * Layer 2 (+3):    Drums (kick + hat)
 * Layer 3 (+6):    Main melody — dotted-8th + 16th rhythm
 * Layer 4 (+9):    Sub-bass
 * Layer 5 (+12):   Arpeggiated plucks
 */

// ─── Chord voicings (Bb major) ──────────────────────────────────────────────
const CHORDS = [
  { root: 116.54, freqs: [174.61, 233.08, 293.66, 440.00] },  // Bbmaj7: F3 Bb3 D4 A4 (root Bb2)
  { root: 98.00,  freqs: [196.00, 233.08, 293.66, 349.23] },  // Gm7:    G3 Bb3 D4 F4 (root G2)
  { root: 77.78,  freqs: [155.56, 196.00, 233.08, 293.66] },  // Ebmaj7: Eb3 G3 Bb3 D4 (root Eb2)
  { root: 87.31,  freqs: [174.61, 233.08, 261.63, 349.23] },  // F:      F3 Bb3 C4 F4 (root F2)
];

// ─── Layer 2: counter-melody (2 notes per 2-bar chord) ──────────────────────
const COUNTER_MELODY = [
  [587.33, 523.25],  // Over Bbmaj7: D5 → C5
  [466.16, 440.00],  // Over Gm7:    Bb4 → A4
  [392.00, 349.23],  // Over Ebmaj7: G4 → F4
  [440.00, 466.16],  // Over F:      A4 → Bb4
];

// ─── Layer 3: arpeggio patterns (16th-note positions per 2-bar chord) ───────
const ARPEGGIO = [
  // Bbmaj7: Bb4 D5 F5 D5 | Bb4 F4 A4 D5
  { pos: [0,4,8,12, 16,20,24,28], freqs: [466.16,587.33,698.46,587.33, 466.16,349.23,440.00,587.33] },
  // Gm7: G4 Bb4 D5 Bb4 | G4 D4 F4 Bb4
  { pos: [0,4,8,12, 16,20,24,28], freqs: [392.00,466.16,587.33,466.16, 392.00,293.66,349.23,466.16] },
  // Ebmaj7: Eb4 G4 Bb4 G4 | Eb4 Bb3 D4 G4
  { pos: [0,4,8,12, 16,20,24,28], freqs: [311.13,392.00,466.16,392.00, 311.13,233.08,293.66,392.00] },
  // F: F4 A4 C5 A4 | F4 C4 F4 A4
  { pos: [0,4,8,12, 16,20,24,28], freqs: [349.23,440.00,523.25,440.00, 349.23,261.63,349.23,440.00] },
];

// ─── Layer 4: melody ────────────────────────────────────────────────────────
// 16th-note grid: 8 bars × 16 = 128 positions per cycle
// Chords: bars 0-1 Bbmaj7, 2-3 Gm7, 4-5 Ebmaj7, 6-7 F
// [position, frequency, holdIn16ths]

const MELODY_A = [
  // ── Bbmaj7 (bars 0-1) — descending with dotted rhythm ──
  [0,  698.46, 3],    // F5 dotted 8th
  [3,  587.33, 1],    // D5 16th
  [4,  622.25, 3],    // Eb5 dotted 8th
  [7,  523.25, 1],    // C5 16th
  [8,  587.33, 3],    // D5 dotted 8th
  [11, 466.16, 1],    // Bb4 16th
  [12, 523.25, 8],    // C5 held half note
  [22, 466.16, 3],    // Bb4 pickup
  [25, 523.25, 1],    // C5
  [26, 587.33, 6],    // D5 held → Gm7

  // ── Gm7 (bars 2-3) ──
  [32, 587.33, 3],    // D5
  [35, 466.16, 1],    // Bb4
  [36, 523.25, 3],    // C5
  [39, 440.00, 1],    // A4
  [40, 466.16, 8],    // Bb4 held
  [52, 440.00, 3],    // A4
  [55, 392.00, 1],    // G4
  [56, 440.00, 6],    // A4 held

  // ── Ebmaj7 (bars 4-5) ──
  [64, 466.16, 3],    // Bb4
  [67, 392.00, 1],    // G4
  [68, 440.00, 3],    // A4
  [71, 349.23, 1],    // F4
  [72, 392.00, 8],    // G4 held
  [84, 349.23, 3],    // F4
  [87, 311.13, 1],    // Eb4
  [88, 349.23, 6],    // F4 held

  // ── F (bars 6-7) — ascending resolution ──
  [96,  523.25, 3],   // C5
  [99,  440.00, 1],   // A4
  [100, 466.16, 3],   // Bb4
  [103, 392.00, 1],   // G4
  [104, 440.00, 6],   // A4 held
  [112, 466.16, 3],   // Bb4
  [115, 523.25, 1],   // C5
  [116, 587.33, 10],  // D5 long hold
];

const MELODY_B = [
  // Same rhythmic skeleton, lower resolution notes for B cycle
  [0,  698.46, 3],  [3,  587.33, 1],
  [4,  622.25, 3],  [7,  523.25, 1],
  [8,  587.33, 3],  [11, 466.16, 1],
  [12, 523.25, 8],
  [22, 440.00, 3],  [25, 466.16, 1],
  [26, 523.25, 6],

  [32, 523.25, 3],  [35, 440.00, 1],
  [36, 466.16, 3],  [39, 392.00, 1],
  [40, 440.00, 8],
  [52, 392.00, 3],  [55, 349.23, 1],
  [56, 392.00, 6],

  [64, 440.00, 3],  [67, 349.23, 1],
  [68, 392.00, 3],  [71, 311.13, 1],
  [72, 349.23, 8],
  [84, 311.13, 3],  [87, 293.66, 1],
  [88, 311.13, 6],

  [96,  523.25, 3],  [99,  440.00, 1],
  [100, 466.16, 3],  [103, 392.00, 1],
  [104, 440.00, 6],
  [112, 466.16, 3],  [115, 523.25, 1],
  [116, 587.33, 10],
];

// ─── Tuning constants ───────────────────────────────────────────────────────
const BARS_PER_CHORD = 2;
const PAD_VOL = 0.06, PAD_ATTACK = 0.4, PAD_RELEASE = 2.0;
const BASS_VOL = 0.15, BASS_ATTACK = 0.15, BASS_RELEASE = 1.5;
const COUNTER_VOL = 0.04, COUNTER_ATTACK = 0.3, COUNTER_RELEASE = 1.5;
const ARP_VOL = 0.07, ARP_ATTACK = 0.005, ARP_RELEASE = 0.3;
const MELODY_VOL = 0.12, MELODY_ATTACK = 0.02, MELODY_RELEASE = 1.5;

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeReverb(ctx, duration, decay) {
  const rate = ctx.sampleRate, len = rate * duration | 0;
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (rate * decay));
  }
  return buf;
}

// ─── Engine ─────────────────────────────────────────────────────────────────

export class BrambleEngine {
  constructor(ctx) {
    this._ctx = ctx;
    this._style = 'superstar';
    this._bpm = 95;
    this._playing = false;
    this._overlayLevel = 0;
    this._chordIdx = 0;
    this._tickId = null;
    this._lastChordTime = 0;
    this._padVoices = [];
    this._currentPad = null;
    this._bassOsc = null;
    this._bassGain = null;
    this._counterVoice = null;
    this._counterIdx = 0;
    this._counterTime = 0;
    this._drumPos = 0;
    this._nextDrumTime = 0;
    this._arpPos = 0;
    this._nextArpTime = 0;
    this._melodyCycle = 0;
    this._melodyIdx = 0;
    this._melodyCycleStart = 0;

    const reverbIR = makeReverb(ctx, 3.5, 1.8);

    // ── Master bus ────────────────────────────────────────────────────────
    this._comp = ctx.createDynamicsCompressor();
    this._comp.threshold.value = -14; this._comp.ratio.value = 4;
    this._comp.knee.value = 8; this._comp.attack.value = 0.003; this._comp.release.value = 0.25;
    this.output = ctx.createGain(); this.output.gain.value = 1.0;
    this._comp.connect(this.output);

    // ── Pad bus: sawtooth → LP 700Hz → reverb (30% wet) ──────────────────
    this._padBus = ctx.createGain(); this._padBus.gain.value = 1.0;
    this._padLP = ctx.createBiquadFilter();
    this._padLP.type = 'lowpass'; this._padLP.frequency.value = 700; this._padLP.Q.value = 1.0;
    this._padReverb = ctx.createConvolver(); this._padReverb.buffer = reverbIR;
    this._padWet = ctx.createGain(); this._padWet.gain.value = 0.3;
    this._padDry = ctx.createGain(); this._padDry.gain.value = 0.7;
    this._padBus.connect(this._padLP);
    this._padLP.connect(this._padReverb); this._padReverb.connect(this._padWet); this._padWet.connect(this._comp);
    this._padLP.connect(this._padDry); this._padDry.connect(this._comp);

    // ── Bass bus: direct to compressor ───────────────────────────────────
    this._bassBus = ctx.createGain(); this._bassBus.gain.value = 1.0;
    this._bassLP = ctx.createBiquadFilter();
    this._bassLP.type = 'lowpass'; this._bassLP.frequency.value = 250; this._bassLP.Q.value = 0.7;
    this._bassBus.connect(this._bassLP); this._bassLP.connect(this._comp);

    // ── Counter-melody bus: sawtooth → LP 1.2kHz → reverb 25% ───────────
    this._counterBus = ctx.createGain(); this._counterBus.gain.value = 1.0;
    this._counterLP = ctx.createBiquadFilter();
    this._counterLP.type = 'lowpass'; this._counterLP.frequency.value = 1200; this._counterLP.Q.value = 0.8;
    this._counterReverb = ctx.createConvolver(); this._counterReverb.buffer = reverbIR;
    this._counterWet = ctx.createGain(); this._counterWet.gain.value = 0.25;
    this._counterDry = ctx.createGain(); this._counterDry.gain.value = 0.75;
    this._counterBus.connect(this._counterLP);
    this._counterLP.connect(this._counterReverb); this._counterReverb.connect(this._counterWet); this._counterWet.connect(this._comp);
    this._counterLP.connect(this._counterDry); this._counterDry.connect(this._comp);

    // ── Arpeggio bus: sawtooth → LP 2kHz → soft sat ─────────────────────
    this._arpBus = ctx.createGain(); this._arpBus.gain.value = 1.0;
    this._arpLP = ctx.createBiquadFilter();
    this._arpLP.type = 'lowpass'; this._arpLP.frequency.value = 2000; this._arpLP.Q.value = 0.7;
    this._arpBus.connect(this._arpLP); this._arpLP.connect(this._comp);

    // ── Drum bus ─────────────────────────────────────────────────────────
    this._drumBus = ctx.createGain(); this._drumBus.gain.value = 0.5;
    this._drumBus.connect(this._comp);

    // ── Melody bus: sawtooth → LP 1.8kHz → reverb 20% + delay ───────────
    this._melodyBus = ctx.createGain(); this._melodyBus.gain.value = 1.0;
    this._melodyLP = ctx.createBiquadFilter();
    this._melodyLP.type = 'lowpass'; this._melodyLP.frequency.value = 1800; this._melodyLP.Q.value = 0.8;
    this._melodyReverb = ctx.createConvolver(); this._melodyReverb.buffer = reverbIR;
    this._melodyWet = ctx.createGain(); this._melodyWet.gain.value = 0.2;
    this._melodyDry = ctx.createGain(); this._melodyDry.gain.value = 0.8;
    this._melodyDelay = ctx.createDelay(2.0); this._melodyDelay.delayTime.value = 60 / this._bpm;
    this._melodyDelayFb = ctx.createGain(); this._melodyDelayFb.gain.value = 0.15;
    this._melodyBus.connect(this._melodyLP);
    this._melodyLP.connect(this._melodyReverb); this._melodyReverb.connect(this._melodyWet); this._melodyWet.connect(this._comp);
    this._melodyLP.connect(this._melodyDry); this._melodyDry.connect(this._comp);
    this._melodyLP.connect(this._melodyDelay); this._melodyDelay.connect(this._melodyDelayFb); this._melodyDelayFb.connect(this._comp);
  }

  // ── Note generators ───────────────────────────────────────────────────────

  _sawPad(freq, time, bus, vol, attack) {
    const ctx = this._ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol, time + attack);
    g.connect(bus);
    // Two detuned sawtooths = Juno-style unison
    const oscL = ctx.createOscillator(); oscL.type = 'sawtooth'; oscL.frequency.value = freq; oscL.detune.value = -8;
    const panL = ctx.createStereoPanner(); panL.pan.value = -0.3;
    oscL.connect(panL); panL.connect(g); oscL.start(time);
    const oscR = ctx.createOscillator(); oscR.type = 'sawtooth'; oscR.frequency.value = freq; oscR.detune.value = 8;
    const panR = ctx.createStereoPanner(); panR.pan.value = 0.3;
    oscR.connect(panR); panR.connect(g); oscR.start(time);
    return { oscL, oscR, panL, panR, gain: g };
  }

  _fadeVoice(v, time, release) {
    v.gain.gain.cancelScheduledValues(time);
    v.gain.gain.setValueAtTime(v.gain.gain.value, time);
    v.gain.gain.linearRampToValueAtTime(0, time + release);
    const stop = time + release + 0.1;
    try { v.oscL.stop(stop); } catch (_) {}
    try { v.oscR.stop(stop); } catch (_) {}
    setTimeout(() => {
      try { v.oscL.disconnect(); v.oscR.disconnect(); v.panL.disconnect(); v.panR.disconnect(); v.gain.disconnect(); } catch (_) {}
    }, (release + 0.5) * 1000);
  }

  // ── Layer 1: Pad + Bass ─────────────────────────────────────────────────

  _playPadChord(idx, time) {
    const chord = CHORDS[idx % CHORDS.length];
    const voices = chord.freqs.map(f => this._sawPad(f, time, this._padBus, PAD_VOL, PAD_ATTACK));
    this._padVoices.push(...voices);
    return voices;
  }

  _fadeOutPad(voices, time) {
    for (const v of voices) this._fadeVoice(v, time, PAD_RELEASE);
    this._padVoices = this._padVoices.filter(v => !voices.includes(v));
  }

  _playBass(freq, time) {
    this._stopBass(time);
    const ctx = this._ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(BASS_VOL, time + BASS_ATTACK);
    g.connect(this._bassBus);
    const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = freq;
    osc.connect(g); osc.start(time);
    this._bassOsc = osc; this._bassGain = g;
  }

  _stopBass(time) {
    if (!this._bassOsc) return;
    const g = this._bassGain, osc = this._bassOsc;
    g.gain.cancelScheduledValues(time);
    g.gain.setValueAtTime(g.gain.value, time);
    g.gain.linearRampToValueAtTime(0, time + BASS_RELEASE);
    try { osc.stop(time + BASS_RELEASE + 0.1); } catch (_) {}
    setTimeout(() => { try { osc.disconnect(); g.disconnect(); } catch (_) {} }, (BASS_RELEASE + 0.5) * 1000);
    this._bassOsc = null; this._bassGain = null;
  }

  // ── Layer 2: Counter-melody ─────────────────────────────────────────────

  _playCounterNote(freq, time) {
    if (this._counterVoice) this._fadeVoice(this._counterVoice, time, COUNTER_RELEASE);
    this._counterVoice = this._sawPad(freq, time, this._counterBus, COUNTER_VOL, COUNTER_ATTACK);
  }

  // ── Layer 3: Arpeggios + Drums ──────────────────────────────────────────

  _playArpNote(freq, time) {
    const ctx = this._ctx;
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(ARP_VOL, time + ARP_ATTACK);
    g.gain.exponentialRampToValueAtTime(0.001, time + ARP_RELEASE);
    osc.connect(g); g.connect(this._arpBus);
    osc.start(time); osc.stop(time + ARP_RELEASE + 0.05);
  }

  _playKick(time) {
    const ctx = this._ctx, osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    g.gain.setValueAtTime(0.19, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
    osc.connect(g); g.connect(this._drumBus); osc.start(time); osc.stop(time + 0.35);
  }

  _playHat(time) {
    const ctx = this._ctx, len = ctx.sampleRate * 0.02 | 0;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.3));
    const src = ctx.createBufferSource(); src.buffer = buf;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.075, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    src.connect(hp); hp.connect(g); g.connect(this._drumBus); src.start(time);
  }

  // ── Layer 4: Melody ─────────────────────────────────────────────────────

  _playMelodyNote(freq, time, duration) {
    const ctx = this._ctx;
    const endSustain = time + duration;
    const endNote = endSustain + MELODY_RELEASE;
    // Filtered sawtooth lead
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = freq;
    // Gentle vibrato (delayed onset)
    const vib = ctx.createOscillator(); vib.type = 'sine'; vib.frequency.value = 5;
    const vibG = ctx.createGain(); vibG.gain.setValueAtTime(0, time);
    vibG.gain.linearRampToValueAtTime(4, time + 0.3); // vibrato fades in
    vib.connect(vibG); vibG.connect(osc.detune);
    // Envelope
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(MELODY_VOL, time + MELODY_ATTACK);
    g.gain.setValueAtTime(MELODY_VOL, endSustain);
    g.gain.linearRampToValueAtTime(0, endNote);
    osc.connect(g); g.connect(this._melodyBus);
    osc.start(time); vib.start(time);
    osc.stop(endNote + 0.1); vib.stop(endNote + 0.1);
    setTimeout(() => {
      try { osc.disconnect(); vib.disconnect(); vibG.disconnect(); g.disconnect(); } catch (_) {}
    }, (duration + MELODY_RELEASE + 0.5) * 1000);
  }

  // ── Scheduler ─────────────────────────────────────────────────────────────

  _tick() {
    if (!this._playing) return;
    const now = this._ctx.currentTime;
    const beatDur = 60 / this._bpm;
    const barDur = beatDur * 4;
    const chordDur = barDur * BARS_PER_CHORD;
    const sixteenthDur = beatDur / 4;
    const arpSixteenth = sixteenthDur;
    const LA = 0.15; // look-ahead

    // ── Layer 1 (base): Pad chord changes ───────────────────────────────
    if (now - this._lastChordTime >= chordDur - 0.01) {
      const t = Math.max(now, this._lastChordTime + chordDur);
      if (this._currentPad) this._fadeOutPad(this._currentPad, t);
      this._chordIdx = (this._chordIdx + 1) % CHORDS.length;
      this._currentPad = this._playPadChord(this._chordIdx, t);
      this._lastChordTime = t;
      // Reset grid positions at chord boundaries
      this._drumPos = 0; this._nextDrumTime = t;
      this._arpPos = 0;  this._nextArpTime = t;
      // Start bass with chord if layer active
      if (this._overlayLevel >= 1.0) {
        this._playBass(CHORDS[this._chordIdx].root, t);
      }
    }

    // ── Layer 2 (+3 streak): Drums ───────────────────────────────────────
    if (this._overlayLevel >= 0.35) {
      while (this._nextDrumTime < now + LA && this._drumPos < 32) {
        const t = this._nextDrumTime;
        if (this._drumPos === 0 || this._drumPos === 16) this._playKick(t);
        if (this._drumPos === 8 || this._drumPos === 24) this._playHat(t);
        this._nextDrumTime += sixteenthDur;
        this._drumPos++;
      }
    }

    // ── Layer 3 (+6 streak): Lead melody ─────────────────────────────────
    if (this._overlayLevel >= 0.65) {
      const phrase = (this._melodyCycle % 2 === 0) ? MELODY_A : MELODY_B;
      while (this._melodyIdx < phrase.length) {
        const [pos, freq, hold] = phrase[this._melodyIdx];
        const noteTime = this._melodyCycleStart + pos * sixteenthDur;
        if (noteTime > now + LA) break;
        if (noteTime >= now - sixteenthDur) {
          this._playMelodyNote(freq, noteTime, hold * sixteenthDur);
        }
        this._melodyIdx++;
      }
      const cycleDur = 128 * sixteenthDur;
      if (now >= this._melodyCycleStart + cycleDur - LA && this._melodyIdx >= phrase.length) {
        this._melodyCycleStart += cycleDur;
        this._melodyIdx = 0;
        this._melodyCycle++;
      }
    }

    // ── Layer 4 (+9 streak): Bass (started at chord changes above) ──────

    // ── Layer 5 (+12 streak): Arpeggio ──────────────────────────────────
    if (this._overlayLevel >= 1.5) {
      const arp = ARPEGGIO[this._chordIdx % ARPEGGIO.length];
      while (this._nextArpTime < now + LA && this._arpPos < 32) {
        const t = this._nextArpTime;
        const pi = arp.pos.indexOf(this._arpPos);
        if (pi !== -1) this._playArpNote(arp.freqs[pi], t);
        this._nextArpTime += arpSixteenth;
        this._arpPos++;
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
    // Bass only starts when overlay >= 1.0
    if (this._overlayLevel >= 1.0) this._playBass(CHORDS[0].root, now);
    this._drumPos = 0; this._nextDrumTime = now;
    this._arpPos = 0; this._nextArpTime = now;
    this._melodyCycle = 0; this._melodyIdx = 0; this._melodyCycleStart = now;
    this._tickId = setTimeout(() => this._tick(), 40);
  }

  stop() {
    this._playing = false;
    if (this._tickId) { clearTimeout(this._tickId); this._tickId = null; }
    const now = this._ctx.currentTime;
    for (const v of this._padVoices) this._fadeVoice(v, now, 0.5);
    this._padVoices = []; this._currentPad = null;
    this._stopBass(now);
    if (this._counterVoice) { this._fadeVoice(this._counterVoice, now, 0.5); this._counterVoice = null; }
  }

  setTempo(bpm) {
    this._bpm = Math.max(40, Math.min(200, bpm));
    if (this._melodyDelay) this._melodyDelay.delayTime.value = 60 / this._bpm;
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
