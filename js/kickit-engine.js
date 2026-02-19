/**
 * Kick It Engine — Can I Kick It? inspired boom-bap for Rhythm Remix.
 *
 * Key: G minor | Default tempo: 96 BPM
 * Progression: Gm7 -> Cm7 (2-bar loop, i -> iv)
 *
 * Synthesis: Rhodes EP stabs, boom-bap drums, deep bass, muted horn stabs,
 * harmonic bed (Perfect Day sample feel), dub delay, vinyl pops, reverse swell, tape wobble.
 *
 * Layer order:
 *   Layer 1 (Base):  Rhodes EP + vinyl crackle
 *   Layer 2 (+3):    Drums (kick, snare, swung hats)
 *   Layer 3 (+6):    Bass (root + sub + passing tones)
 *   Layer 4 (+9):    Horn stabs (muted jazz trumpet)
 *   Layer 5 (+12):   Texture (harmonic bed, dub delay, vinyl pops, reverse swell)
 */

function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

const CHORDS = [
  { name: 'Gm7', notes: [55, 58, 62, 65], bass: 43, passing: 46 },
  { name: 'Cm7', notes: [60, 63, 67, 70], bass: 48, passing: null },
];

const HORN_PATTERN = [
  [0,  2.5,  74,  1.0],
  [1,  3.5,  70,  0.8],
  [4,  3.75, 77,  0.7],
];

const SWING = 0.6;
const BASS_LEAN = 0.020;

// Perfect Day — transposed from Ab major (F→Bbm→Bbm→Eb) up 2 semitones
// to fit G minor: G→Cm→Cm→F. Guitar voicings, 4-bar super-cycle.
const BED_CHORDS = [
  [43, 47, 55, 59, 62, 67],  // G major  (G2 B2 G3 B3 D4 G4)
  [48, 55, 60, 63, 67],      // Cm       (C3 G3 C4 Eb4 G4)
  [48, 55, 60, 63, 67],      // Cm       (C3 G3 C4 Eb4 G4)
  [41, 48, 53, 57, 60, 65],  // F major  (F2 C3 F3 A3 C4 F4)
];

export class KickItEngine {
  constructor(ctx) {
    this._ctx = ctx;
    this._style = 'kickit';
    this._bpm = 96;
    this._playing = false;
    this._overlayLevel = 0;
    this._schedTimer = null;
    this._nextBarTime = 0;
    this._currentBar = 0;

    // Pre-allocate noise buffers
    const snareLen = Math.ceil(ctx.sampleRate * 0.15);
    this._snareBuf = ctx.createBuffer(1, snareLen, ctx.sampleRate);
    const sd = this._snareBuf.getChannelData(0);
    for (let i = 0; i < snareLen; i++) sd[i] = Math.random() * 2 - 1;

    const hatLen = Math.ceil(ctx.sampleRate * 0.05);
    this._hatBuf = ctx.createBuffer(1, hatLen, ctx.sampleRate);
    const hd = this._hatBuf.getChannelData(0);
    for (let i = 0; i < hatLen; i++) hd[i] = Math.random() * 2 - 1;

    const swellLen = Math.ceil(ctx.sampleRate * 1.0);
    this._swellBuf = ctx.createBuffer(1, swellLen, ctx.sampleRate);
    const sw = this._swellBuf.getChannelData(0);
    for (let i = 0; i < swellLen; i++) sw[i] = Math.random() * 2 - 1;

    const crackleLen = ctx.sampleRate * 2;
    this._crackleBuf = ctx.createBuffer(1, crackleLen, ctx.sampleRate);
    const cd = this._crackleBuf.getChannelData(0);
    for (let i = 0; i < crackleLen; i++) {
      cd[i] = Math.random() < 0.015
        ? (Math.random() * 2 - 1) * 0.35
        : (Math.random() * 2 - 1) * 0.008;
    }

    // ── Signal chain: everything -> preBus -> wobbleDelay -> output ──
    this._preBus = ctx.createGain();
    this._preBus.gain.value = 1.0;

    const wobbleDelay = ctx.createDelay(0.05);
    wobbleDelay.delayTime.value = 0.010;

    this._wobbleLFO = ctx.createOscillator();
    this._wobbleDepth = ctx.createGain();
    this._wobbleLFO.type = 'sine';
    this._wobbleLFO.frequency.value = 0.18;
    this._wobbleDepth.gain.value = 0; // enabled at texture threshold
    this._wobbleLFO.connect(this._wobbleDepth);
    this._wobbleDepth.connect(wobbleDelay.delayTime);
    this._wobbleLFO.start();

    this._preBus.connect(wobbleDelay);

    this.output = ctx.createGain();
    this.output.gain.value = 1.0;
    wobbleDelay.connect(this.output);

    // Master gain
    this._master = ctx.createGain();
    this._master.gain.value = 0.5;
    this._master.connect(this._preBus);

    // Short room reverb (0.8s)
    const irLen = Math.ceil(ctx.sampleRate * 0.8);
    const irBuf = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = irBuf.getChannelData(ch);
      for (let i = 0; i < irLen; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3.0);
      }
    }
    this._convolver = ctx.createConvolver();
    this._convolver.buffer = irBuf;
    this._reverbSend = ctx.createGain();
    this._reverbSend.gain.value = 0.25;
    this._convolver.connect(this._reverbSend);
    this._reverbSend.connect(this._preBus);

    // ── Per-layer gain nodes ──
    this._gains = {};

    // Rhodes -> master + convolver
    this._gains.rhodes = ctx.createGain();
    this._gains.rhodes.gain.value = 0;
    this._gains.rhodes.connect(this._master);
    this._gains.rhodes.connect(this._convolver);

    // Drums -> master + 8% room
    this._gains.drums = ctx.createGain();
    this._gains.drums.gain.value = 0;
    this._gains.drums.connect(this._master);
    const drumReverb = ctx.createGain();
    drumReverb.gain.value = 0.08;
    this._gains.drums.connect(drumReverb);
    drumReverb.connect(this._convolver);

    // Bass -> master + 6% room
    this._gains.bass = ctx.createGain();
    this._gains.bass.gain.value = 0;
    this._gains.bass.connect(this._master);
    const bassReverb = ctx.createGain();
    bassReverb.gain.value = 0.06;
    this._gains.bass.connect(bassReverb);
    bassReverb.connect(this._convolver);

    // Horns -> master + 18% room
    this._gains.horns = ctx.createGain();
    this._gains.horns.gain.value = 0;
    this._gains.horns.connect(this._master);
    const hornReverb = ctx.createGain();
    hornReverb.gain.value = 0.18;
    this._gains.horns.connect(hornReverb);
    hornReverb.connect(this._convolver);

    // Texture -> master
    this._gains.texture = ctx.createGain();
    this._gains.texture.gain.value = 0;
    this._gains.texture.connect(this._master);

    // ── Vinyl crackle ──
    this._crackleGain = ctx.createGain();
    this._crackleGain.gain.value = 0.09;
    this._crackleBPF = ctx.createBiquadFilter();
    this._crackleBPF.type = 'bandpass';
    this._crackleBPF.frequency.value = 4000;
    this._crackleBPF.Q.value = 0.7;
    this._crackleBPF.connect(this._crackleGain);
    this._crackleGain.connect(this._master);
    this._crackleSource = null;

    // ── Harmonic bed filter — warm guitar, tame the top ──
    this._bedFilter = ctx.createBiquadFilter();
    this._bedFilter.type = 'lowpass';
    this._bedFilter.frequency.value = 2800;
    this._bedFilter.Q.value = 0.5;
    this._bedFilter.connect(this._gains.texture);
    // Send bed through reverb for space
    const bedReverb = ctx.createGain();
    bedReverb.gain.value = 0.30;
    this._bedFilter.connect(bedReverb);
    bedReverb.connect(this._convolver);

    // ── Dub delay slapback ──
    this._dubDelay = ctx.createDelay(2);
    this._dubDelay.delayTime.value = (60 / this._bpm) * 0.75;
    const dubFb = ctx.createGain();
    dubFb.gain.value = 0.28;
    this._dubDelaySend = ctx.createGain();
    this._dubDelaySend.gain.value = 0; // enabled at texture threshold
    const dubLP = ctx.createBiquadFilter();
    dubLP.type = 'lowpass';
    dubLP.frequency.value = 1800;
    dubLP.Q.value = 0.5;
    this._dubDelay.connect(dubLP);
    dubLP.connect(dubFb);
    dubFb.connect(this._dubDelay);
    dubLP.connect(this._dubDelaySend);
    this._dubDelaySend.connect(this._gains.texture);
    // Horns and drums feed the dub delay
    this._gains.horns.connect(this._dubDelay);
    const drumDubSend = ctx.createGain();
    drumDubSend.gain.value = 0.12;
    this._gains.drums.connect(drumDubSend);
    drumDubSend.connect(this._dubDelay);
  }

  // ── RHODES EP ────────────────────────────────────────────────────────────────

  _scheduleRhodes(time, barIndex) {
    const chordIdx = barIndex % 2;
    const chord = CHORDS[chordIdx];
    const beat = 60 / this._bpm;

    if (chordIdx === 0) {
      this._playRhodesStab(time, chord, 1.0, beat * 1.0);
      this._playRhodesStab(time + beat * 1.6, chord, 0.45, beat * 0.4);
      this._playRhodesStab(time + beat * 3.0, chord, 0.65, beat * 0.7);
    } else {
      this._playRhodesStab(time, chord, 1.0, beat * 1.0);
      this._playRhodesStab(time + beat * 2.6, chord, 0.45, beat * 0.4);
    }
  }

  _playRhodesStab(time, chord, velocity, duration) {
    const ctx = this._ctx;
    chord.notes.forEach(note => {
      const freq = mtof(note);
      const gain = velocity * 0.05;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1700 + Math.random() * 300;
      filter.Q.value = 0.5;
      filter.connect(this._gains.rhodes);

      const wobble = ctx.createOscillator();
      const wobbleAmt = ctx.createGain();
      wobble.type = 'sine';
      wobble.frequency.value = 0.22 + Math.random() * 0.12;
      wobbleAmt.gain.value = 3;
      wobble.connect(wobbleAmt);
      wobble.start(time);
      wobble.stop(time + duration + 1.2);

      const osc1 = ctx.createOscillator();
      const env1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.value = freq;
      wobbleAmt.connect(osc1.detune);
      env1.gain.setValueAtTime(0, time);
      env1.gain.linearRampToValueAtTime(gain, time + 0.004);
      env1.gain.setTargetAtTime(gain * 0.4, time + 0.015, 0.07);
      env1.gain.setTargetAtTime(gain * 0.18, time + 0.1, 0.15);
      env1.gain.setTargetAtTime(0, time + duration, 0.1);
      osc1.connect(env1);
      env1.connect(filter);
      osc1.start(time);
      osc1.stop(time + duration + 0.8);

      const osc2 = ctx.createOscillator();
      const env2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.value = freq * 2;
      wobbleAmt.connect(osc2.detune);
      const bellGain = gain * 0.22;
      env2.gain.setValueAtTime(0, time);
      env2.gain.linearRampToValueAtTime(bellGain, time + 0.003);
      env2.gain.setTargetAtTime(bellGain * 0.12, time + 0.01, 0.04);
      env2.gain.setTargetAtTime(0, time + duration * 0.6, 0.06);
      osc2.connect(env2);
      env2.connect(filter);
      osc2.start(time);
      osc2.stop(time + duration + 0.5);

      const trem = ctx.createOscillator();
      const tremAmt = ctx.createGain();
      trem.type = 'sine';
      trem.frequency.value = 4.5;
      tremAmt.gain.value = gain * 0.1;
      trem.connect(tremAmt);
      tremAmt.connect(env1.gain);
      trem.start(time);
      trem.stop(time + duration + 0.8);
    });
  }

  // ── DRUMS ────────────────────────────────────────────────────────────────────

  _scheduleDrums(time, barIndex) {
    const beat = 60 / this._bpm;
    const chordIdx = barIndex % 2;

    if (chordIdx === 0) {
      this._playKick(time, 1.0);
      this._playKick(time + beat * (1 + SWING), 0.7);
    } else {
      this._playKick(time, 1.0);
      this._playKick(time + beat * 2, 0.75);
    }

    this._playSnare(time + beat * 1);
    this._playSnare(time + beat * 3);

    for (let i = 0; i < 4; i++) {
      this._playHat(time + beat * i, true);
      this._playHat(time + beat * (i + SWING), false);
    }
  }

  _playKick(time, vel) {
    const ctx = this._ctx;
    const t = time + (Math.random() - 0.5) * 0.03;
    const v = vel || 1.0;

    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(75, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    env.gain.setValueAtTime(0.45 * v, t);
    env.gain.setTargetAtTime(0.001, t + 0.05, 0.12);
    osc.connect(env); env.connect(this._gains.drums);
    osc.start(t); osc.stop(t + 0.5);

    const sub = ctx.createOscillator();
    const subEnv = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(40, t);
    sub.frequency.exponentialRampToValueAtTime(28, t + 0.15);
    subEnv.gain.setValueAtTime(0.25 * v, t);
    subEnv.gain.setTargetAtTime(0.001, t + 0.06, 0.14);
    sub.connect(subEnv); subEnv.connect(this._gains.drums);
    sub.start(t); sub.stop(t + 0.55);

    const click = ctx.createOscillator();
    const clickEnv = ctx.createGain();
    click.type = 'sine';
    click.frequency.setValueAtTime(180, t);
    click.frequency.exponentialRampToValueAtTime(60, t + 0.02);
    clickEnv.gain.setValueAtTime(0.12 * v, t);
    clickEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    click.connect(clickEnv); clickEnv.connect(this._gains.drums);
    click.start(t); click.stop(t + 0.05);
  }

  _playSnare(time) {
    const ctx = this._ctx;
    const late = 0.030 + Math.random() * 0.010;
    const jitter = (Math.random() - 0.5) * 0.024;
    const t = time + late + jitter;

    const src = ctx.createBufferSource();
    const bp = ctx.createBiquadFilter();
    const env = ctx.createGain();
    src.buffer = this._snareBuf;
    bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 0.7;
    env.gain.setValueAtTime(0.18, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    src.connect(bp); bp.connect(env); env.connect(this._gains.drums);
    src.start(t);

    const body = ctx.createOscillator();
    const bodyEnv = ctx.createGain();
    body.type = 'sine';
    body.frequency.setValueAtTime(190, t);
    body.frequency.exponentialRampToValueAtTime(130, t + 0.05);
    bodyEnv.gain.setValueAtTime(0.16, t);
    bodyEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    body.connect(bodyEnv); bodyEnv.connect(this._gains.drums);
    body.start(t); body.stop(t + 0.12);
  }

  _playHat(time, accent) {
    const ctx = this._ctx;
    const t = time + (Math.random() - 0.5) * 0.02;
    const vel = accent ? 0.7 + Math.random() * 0.3 : 0.25 + Math.random() * 0.3;
    const baseGain = 0.045;

    const src = ctx.createBufferSource();
    const hp = ctx.createBiquadFilter();
    const env = ctx.createGain();
    src.buffer = this._hatBuf;
    hp.type = 'highpass'; hp.frequency.value = 8000;
    env.gain.setValueAtTime(baseGain * vel, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    src.connect(hp); hp.connect(env); env.connect(this._gains.drums);
    src.start(t);
  }

  // ── BASS ─────────────────────────────────────────────────────────────────────

  _scheduleBass(time, barIndex) {
    const beat = 60 / this._bpm;
    const chordIdx = barIndex % 2;
    const chord = CHORDS[chordIdx];

    if (chordIdx === 0) {
      this._playBassNote(time, chord.bass, beat * 3.2, 1.0);
      this._playBassNote(time + beat * 3.5, chord.passing, beat * 0.5, 0.65);
    } else {
      this._playBassNote(time, chord.bass, beat * 3.8, 1.0);
    }
  }

  _playBassNote(time, midiNote, duration, vel) {
    const ctx = this._ctx;
    const t = time + BASS_LEAN;
    const freq = mtof(midiNote);
    const v = vel || 1.0;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 300; filter.Q.value = 0.4;
    filter.connect(this._gains.bass);

    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.detune.setValueAtTime(-20, t);
    osc.detune.exponentialRampToValueAtTime(0.01, t + 0.08);
    const gain = 0.28 * v;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.010);
    env.gain.setTargetAtTime(gain * 0.85, t + 0.03, 0.08);
    env.gain.setTargetAtTime(gain * 0.7, t + 0.15, 0.3);
    env.gain.setTargetAtTime(0, t + duration, 0.08);
    osc.connect(env); env.connect(filter);
    osc.start(t); osc.stop(t + duration + 0.6);

    const sub = ctx.createOscillator();
    const subEnv = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.value = freq / 2;
    sub.detune.setValueAtTime(-20, t);
    sub.detune.exponentialRampToValueAtTime(0.01, t + 0.08);
    const subGain = gain * 0.35;
    subEnv.gain.setValueAtTime(0, t);
    subEnv.gain.linearRampToValueAtTime(subGain, t + 0.015);
    subEnv.gain.setTargetAtTime(subGain * 0.8, t + 0.05, 0.1);
    subEnv.gain.setTargetAtTime(0, t + duration, 0.1);
    sub.connect(subEnv); subEnv.connect(filter);
    sub.start(t); sub.stop(t + duration + 0.6);

    const tri = ctx.createOscillator();
    const triEnv = ctx.createGain();
    tri.type = 'triangle';
    tri.frequency.value = freq;
    tri.detune.setValueAtTime(-20, t);
    tri.detune.exponentialRampToValueAtTime(0.01, t + 0.08);
    const triGain = gain * 0.12;
    triEnv.gain.setValueAtTime(0, t);
    triEnv.gain.linearRampToValueAtTime(triGain, t + 0.008);
    triEnv.gain.setTargetAtTime(triGain * 0.3, t + 0.02, 0.04);
    triEnv.gain.setTargetAtTime(0, t + duration * 0.5, 0.06);
    tri.connect(triEnv); triEnv.connect(filter);
    tri.start(t); tri.stop(t + duration + 0.4);
  }

  // ── HORNS ────────────────────────────────────────────────────────────────────

  _scheduleHorns(time, barIndex) {
    const beat = 60 / this._bpm;
    const barInCycle = barIndex % 8;

    for (const [bar, beatOffset, note, vel] of HORN_PATTERN) {
      if (barInCycle === bar) {
        this._playHornStab(time + beat * beatOffset, note, vel);
      }
    }
  }

  _playHornStab(time, midiNote, vel) {
    const ctx = this._ctx;
    const freq = mtof(midiNote);
    const t = time + (Math.random() - 0.5) * 0.015;
    const v = vel || 1.0;
    const dur = 0.18 + Math.random() * 0.06;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 2400; filter.Q.value = 0.5;
    filter.connect(this._gains.horns);

    const osc1 = ctx.createOscillator();
    const env1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.value = freq;
    osc1.detune.setValueAtTime(40, t);
    osc1.detune.exponentialRampToValueAtTime(0.01, t + 0.025);
    const gain = 0.055 * v;
    env1.gain.setValueAtTime(0, t);
    env1.gain.linearRampToValueAtTime(gain, t + 0.004);
    env1.gain.setTargetAtTime(gain * 0.55, t + 0.012, 0.025);
    env1.gain.setTargetAtTime(0, t + dur, 0.035);
    osc1.connect(env1); env1.connect(filter);
    osc1.start(t); osc1.stop(t + dur + 0.25);

    const osc2 = ctx.createOscillator();
    const env2 = ctx.createGain();
    const bp = ctx.createBiquadFilter();
    osc2.type = 'square';
    osc2.frequency.value = freq;
    osc2.detune.setValueAtTime(40, t);
    osc2.detune.exponentialRampToValueAtTime(0.01, t + 0.025);
    bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.8;
    const buzzGain = gain * 0.18;
    env2.gain.setValueAtTime(0, t);
    env2.gain.linearRampToValueAtTime(buzzGain, t + 0.005);
    env2.gain.setTargetAtTime(buzzGain * 0.4, t + 0.01, 0.02);
    env2.gain.setTargetAtTime(0, t + dur, 0.025);
    osc2.connect(bp); bp.connect(env2); env2.connect(filter);
    osc2.start(t); osc2.stop(t + dur + 0.2);

    const osc3 = ctx.createOscillator();
    const env3 = ctx.createGain();
    osc3.type = 'sine';
    osc3.frequency.value = freq * 2;
    osc3.detune.setValueAtTime(40, t);
    osc3.detune.exponentialRampToValueAtTime(0.01, t + 0.025);
    const octGain = gain * 0.10;
    env3.gain.setValueAtTime(0, t);
    env3.gain.linearRampToValueAtTime(octGain, t + 0.004);
    env3.gain.setTargetAtTime(0, t + dur * 0.4, 0.02);
    osc3.connect(env3); env3.connect(filter);
    osc3.start(t); osc3.stop(t + dur + 0.15);
  }

  // ── TEXTURE — Harmonic bed (Perfect Day feel), reverse swell, vinyl pops ────

  // Karplus-Strong plucked string buffer (offline computation)
  _createPluckBuffer(freq, duration) {
    const ctx = this._ctx;
    const sr = ctx.sampleRate;
    const len = Math.ceil(sr * duration);
    const buf = ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    const period = Math.round(sr / freq);

    // Seed with noise — the "pluck" excitation
    for (let i = 0; i < period; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    // KS averaging loop
    const decay = 0.996;
    for (let i = period; i < len; i++) {
      data[i] = decay * 0.5 * (data[i - period] + data[i - period + 1]);
    }
    return buf;
  }

  // Perfect Day guitar bed — strummed Karplus-Strong chords (G→Cm→Cm→F)
  // Pitch bends up into each chord so transitions feel like one note morphing.
  _scheduleHarmonicBed(time, barIndex) {
    const ctx = this._ctx;
    const chord = BED_CHORDS[barIndex % 4];
    const beat = 60 / this._bpm;
    const bar = beat * 4;
    const strumGap = 0.015; // 15ms between strings — down-strum feel

    for (let i = 0; i < chord.length; i++) {
      const freq = mtof(chord[i]);
      const t = time + i * strumGap;
      const dur = bar + 0.8 - (i * strumGap); // longer ring — overlap into next chord

      const buf = this._createPluckBuffer(freq, dur + 1);
      const src = ctx.createBufferSource();
      src.buffer = buf;

      // Soft attack + long release — crossfades naturally between chords
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.065, t + 0.08);
      env.gain.setTargetAtTime(0, t + dur - 0.4, 0.35);

      src.connect(env);
      env.connect(this._bedFilter);
      src.start(t);
      src.stop(t + dur + 1);
    }
  }

  _scheduleReverseSwell(time, barIndex) {
    const barInCycle = barIndex % 8;
    if (barInCycle !== 7) return;

    const ctx = this._ctx;
    const beat = 60 / this._bpm;
    const swellDur = beat * 3;
    const t = time + beat * 1.0;

    const src = ctx.createBufferSource();
    src.buffer = this._swellBuf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 2000; bp.Q.value = 0.4;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.setValueAtTime(0.005, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.16, t + swellDur - 0.01);
    env.gain.setValueAtTime(0, t + swellDur);

    src.connect(bp); bp.connect(env);
    env.connect(this._gains.texture);
    const swellReverb = ctx.createGain();
    swellReverb.gain.value = 0.5;
    env.connect(swellReverb);
    swellReverb.connect(this._convolver);
    src.start(t);
  }

  _scheduleVinylPops(time) {
    const ctx = this._ctx;
    const beat = 60 / this._bpm;
    const barDur = beat * 4;
    const numPops = 1 + Math.floor(Math.random() * 3);

    for (let i = 0; i < numPops; i++) {
      const t = time + Math.random() * barDur;
      const loud = Math.random() < 0.15;
      const vol = loud ? 0.12 + Math.random() * 0.08 : 0.03 + Math.random() * 0.04;

      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800 + Math.random() * 1200, t);
      osc.frequency.exponentialRampToValueAtTime(100, t + 0.008);
      env.gain.setValueAtTime(vol, t);
      env.gain.exponentialRampToValueAtTime(0.0001, t + (loud ? 0.015 : 0.006));
      osc.connect(env); env.connect(this._gains.texture);
      osc.start(t); osc.stop(t + 0.02);
    }
  }

  // ── Bar scheduler ────────────────────────────────────────────────────────────

  _scheduleBar(time, barIndex) {
    this._scheduleRhodes(time, barIndex);
    if (this._overlayLevel >= 0.35) this._scheduleDrums(time, barIndex);
    if (this._overlayLevel >= 0.65) this._scheduleBass(time, barIndex);
    if (this._overlayLevel >= 1.0) this._scheduleHorns(time, barIndex);
    if (this._overlayLevel >= 1.5) {
      this._scheduleHarmonicBed(time, barIndex);
      this._scheduleReverseSwell(time, barIndex);
      this._scheduleVinylPops(time);
    }
  }

  _scheduler() {
    const bar = 60 / this._bpm * 4;
    while (this._nextBarTime < this._ctx.currentTime + 0.3) {
      this._scheduleBar(this._nextBarTime, this._currentBar);
      this._nextBarTime += bar;
      this._currentBar++;
    }
    if (this._playing) {
      this._schedTimer = setTimeout(() => this._scheduler(), 50);
    }
  }

  // ── Layer gain management ────────────────────────────────────────────────────

  _updateLayerGains() {
    const now = this._ctx.currentTime;
    const layers = [
      { key: 'rhodes',  threshold: 0 },
      { key: 'drums',   threshold: 0.35 },
      { key: 'bass',    threshold: 0.65 },
      { key: 'horns',   threshold: 1.0 },
      { key: 'texture', threshold: 1.5 },
    ];
    for (const l of layers) {
      const target = this._overlayLevel >= l.threshold ? 1 : 0;
      this._gains[l.key].gain.cancelScheduledValues(now);
      this._gains[l.key].gain.setTargetAtTime(target, now, 0.06);
    }
    // Tape wobble + dub delay gate with texture
    const textureOn = this._overlayLevel >= 1.5;
    this._wobbleDepth.gain.setTargetAtTime(textureOn ? 0.004 : 0, now, 0.1);
    this._dubDelaySend.gain.setTargetAtTime(textureOn ? 0.22 : 0, now, 0.1);
  }

  // ── Crackle ──────────────────────────────────────────────────────────────────

  _startCrackle() {
    if (this._crackleSource) return;
    const src = this._ctx.createBufferSource();
    src.buffer = this._crackleBuf;
    src.loop = true;
    src.connect(this._crackleBPF);
    src.start(0);
    this._crackleSource = src;
  }

  _stopCrackle() {
    if (this._crackleSource) {
      try { this._crackleSource.stop(); } catch(e) {}
      this._crackleSource = null;
    }
  }

  // ── Public API (Rhythm Remix engine interface) ──────────────────────────────

  start() {
    if (this._playing) this.stop();
    this._playing = true;
    if (this._ctx.state === 'suspended') this._ctx.resume();
    this._nextBarTime = this._ctx.currentTime + 0.05;
    this._currentBar = 0;
    this._updateLayerGains();
    this._startCrackle();
    this._scheduler();
  }

  stop() {
    this._playing = false;
    if (this._schedTimer) {
      clearTimeout(this._schedTimer);
      this._schedTimer = null;
    }
    this._stopCrackle();
  }

  setTempo(bpm) {
    this._bpm = Math.max(40, Math.min(200, bpm));
    this._dubDelay.delayTime.value = (60 / this._bpm) * 0.75;
  }

  setOverlayLevel(level) {
    this._overlayLevel = level;
    if (this._playing) this._updateLayerGains();
  }

  get overlayLevel() { return this._overlayLevel; }
  get isPlaying() { return this._playing; }
  get currentBpm() { return this._bpm; }
  get currentChordName() {
    return CHORDS[this._currentBar % 2]?.name || '';
  }

  getBeatPhase() {
    if (!this._playing) return 0;
    const beat = 60 / this._bpm;
    return (this._ctx.currentTime % beat) / beat;
  }

  // Stub methods for full Rhythm Remix interface compatibility
  setStyle() {}
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
  pause()   { this.stop(); }
  resume()  { this.start(); }
  dispose() { this.stop(); }
}
