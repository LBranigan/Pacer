// ═══════════════════════════════════════════════════════════════
// MythicEngine — Aruarian Dance-inspired layered instrumental
// Key: A minor (natural) | Default BPM: 90
// Progression: Am9 → Fmaj7 → Dm7 → Em7 (2 bars per chord)
//
// Layer thresholds (overlay level):
//   0.00  Pads (harmonic atmosphere)
//   0.35  Drums (kick, snare, hats — loose hip-hop)
//   0.65  Lead (shakuhachi-like melodic motif)
//   1.00  Bass (root + sub-octave, passing tones)
//   1.50  Texture (sparse kalimba plucks)
// ═══════════════════════════════════════════════════════════════

function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

// ── Chord Progression (8-bar cycle, 2 bars per chord) ──
const CHORDS = [
  { name: 'Am9',   bass: 45, passing: 43, pad: [57, 60, 67, 71] },
  { name: 'Fmaj7', bass: 41, passing: 40, pad: [53, 57, 60, 64] },
  { name: 'Dm7',   bass: 38, passing: null, pad: [50, 53, 57, 60] },
  { name: 'Em7',   bass: 40, passing: 43, pad: [52, 55, 59, 62] },
];

// ── Melody (16-bar / 64-beat super-cycle) ──
const MELODY = [
  { note: 76, beat: 2,    dur: 2.5 },
  { note: 74, beat: 5,    dur: 1.5 },
  { note: 72, beat: 8,    dur: 4.0 },
  { note: 69, beat: 13,   dur: 2.5 },
  { note: 71, beat: 25,   dur: 2.0 },
  { note: 72, beat: 28,   dur: 2.5 },
  { note: 76, beat: 34,   dur: 1.5 },
  { note: 77, beat: 36.5, dur: 1.0 },
  { note: 76, beat: 38,   dur: 3.0 },
  { note: 74, beat: 42,   dur: 2.0 },
  { note: 72, beat: 45,   dur: 2.5 },
  { note: 71, beat: 57,   dur: 5.0 },
];

export class MythicEngine {
  constructor(ctx) {
    this._ctx = ctx;
    this._bpm = 90;
    this._playing = false;
    this._schedTimer = null;
    this._nextBarTime = 0;
    this._currentBar = 0;
    this._overlayLevel = 0;

    // ── Output + master ──
    this.output = ctx.createGain();
    this.output.gain.value = 1.0;
    this._master = ctx.createGain();
    this._master.gain.value = 0.5;
    this._master.connect(this.output);

    // ── Reverb (3-second tail) ──
    const irLen = ctx.sampleRate * 3;
    const irBuf = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = irBuf.getChannelData(ch);
      for (let i = 0; i < irLen; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 2.5);
      }
    }
    this._convolver = ctx.createConvolver();
    this._convolver.buffer = irBuf;
    this._reverbSend = ctx.createGain();
    this._reverbSend.gain.value = 0.55;
    this._convolver.connect(this._reverbSend);
    this._reverbSend.connect(this.output);

    // ── Noise buffers ──
    const breathLen = Math.ceil(ctx.sampleRate * 0.06);
    this._breathBuf = ctx.createBuffer(1, breathLen, ctx.sampleRate);
    const bd = this._breathBuf.getChannelData(0);
    for (let i = 0; i < breathLen; i++) bd[i] = Math.random() * 2 - 1;

    const snareLen = Math.ceil(ctx.sampleRate * 0.12);
    this._snareBuf = ctx.createBuffer(1, snareLen, ctx.sampleRate);
    const sd = this._snareBuf.getChannelData(0);
    for (let i = 0; i < snareLen; i++) sd[i] = Math.random() * 2 - 1;

    const hatLen = Math.ceil(ctx.sampleRate * 0.035);
    this._hatBuf = ctx.createBuffer(1, hatLen, ctx.sampleRate);
    const hd = this._hatBuf.getChannelData(0);
    for (let i = 0; i < hatLen; i++) hd[i] = Math.random() * 2 - 1;

    // ── Per-layer gain nodes (all start at 0) ──
    this._gains = {};
    for (const key of ['pads', 'drums', 'lead', 'bass', 'texture']) {
      this._gains[key] = ctx.createGain();
      this._gains[key].gain.value = 0;
    }

    // Pads + Lead: full reverb send
    this._gains.pads.connect(this._master);
    this._gains.pads.connect(this._convolver);
    this._gains.lead.connect(this._master);
    this._gains.lead.connect(this._convolver);

    // Drums: dry only
    this._gains.drums.connect(this._master);

    // Bass: mostly dry, 15% reverb
    this._gains.bass.connect(this._master);
    const bassRev = ctx.createGain();
    bassRev.gain.value = 0.15;
    this._gains.bass.connect(bassRev);
    bassRev.connect(this._convolver);

    // Texture: moderate reverb
    this._gains.texture.connect(this._master);
    const texRev = ctx.createGain();
    texRev.gain.value = 0.5;
    this._gains.texture.connect(texRev);
    texRev.connect(this._convolver);

    // Set initial layer gains
    this._updateLayerGains();
  }

  // ═══════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════
  get isPlaying() { return this._playing; }
  get currentBpm() { return this._bpm; }

  start() {
    if (this._playing) this.stop();
    this._playing = true;
    this._currentBar = 0;
    this._nextBarTime = this._ctx.currentTime + 0.05;
    this._scheduler();
  }

  stop() {
    this._playing = false;
    if (this._schedTimer) clearTimeout(this._schedTimer);
    this._schedTimer = null;
  }

  pause() { this.stop(); }
  resume() { this.start(); }
  dispose() { this.stop(); }

  setTempo(bpm) {
    this._bpm = Math.max(40, Math.min(200, bpm));
  }

  setOverlayLevel(level) {
    this._overlayLevel = level;
    this._updateLayerGains();
  }

  get overlayLevel() { return this._overlayLevel; }

  getBeatPhase() {
    if (!this._playing) return 0;
    const beatLen = 60 / this._bpm;
    const elapsed = this._ctx.currentTime - this._nextBarTime + (beatLen * 4);
    return (elapsed % beatLen) / beatLen;
  }

  // ═══════════════════════════════════════════
  // Layer gain gating
  // ═══════════════════════════════════════════
  _updateLayerGains() {
    const layers = [
      { key: 'pads',    threshold: 0 },
      { key: 'drums',   threshold: 0.35 },
      { key: 'lead',    threshold: 0.65 },
      { key: 'bass',    threshold: 1.0 },
      { key: 'texture', threshold: 1.5 },
    ];
    const now = this._ctx.currentTime;
    for (const l of layers) {
      const target = this._overlayLevel >= l.threshold ? 1 : 0;
      this._gains[l.key].gain.cancelScheduledValues(now);
      this._gains[l.key].gain.setTargetAtTime(target, now, 0.06);
    }
  }

  // ═══════════════════════════════════════════
  // LAYER 0 — Pads (Harmonic Atmosphere)
  // ═══════════════════════════════════════════
  _schedulePads(time, chord) {
    const ctx = this._ctx;
    const bar = 60 / this._bpm * 4;
    const dur = bar * 2 + 0.4;

    chord.pad.forEach(note => {
      const freq = mtof(note);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 600;
      filter.Q.value = 0.6;
      filter.connect(this._gains.pads);

      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.type = 'sine';
      lfo.frequency.value = 0.12;
      lfoGain.gain.value = 130;
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);
      lfo.start(time);
      lfo.stop(time + dur + 2);

      [-10, 0, 10].forEach(detune => {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        osc.detune.value = detune;
        env.gain.setValueAtTime(0, time);
        env.gain.linearRampToValueAtTime(0.024, time + 1.0);
        env.gain.setTargetAtTime(0.017, time + 1.5, 0.8);
        env.gain.setTargetAtTime(0, time + dur - 0.5, 0.4);
        osc.connect(env);
        env.connect(filter);
        osc.start(time);
        osc.stop(time + dur + 2.5);
      });
    });
  }

  // ═══════════════════════════════════════════
  // LAYER 1 — Lead (Shakuhachi-like melody)
  // ═══════════════════════════════════════════
  _playLeadNote(time, freq, dur) {
    const ctx = this._ctx;
    const scoopCents = -(25 + Math.random() * 10);

    const tri = ctx.createOscillator();
    const triEnv = ctx.createGain();
    const triFilter = ctx.createBiquadFilter();
    tri.type = 'triangle';
    tri.frequency.value = freq;
    tri.detune.setValueAtTime(scoopCents, time);
    tri.detune.exponentialRampToValueAtTime(0.01, time + 0.15);
    triFilter.type = 'lowpass';
    triFilter.frequency.value = 1100;
    triFilter.Q.value = 0.5;
    triEnv.gain.setValueAtTime(0, time);
    triEnv.gain.linearRampToValueAtTime(0.035, time + 0.12);
    triEnv.gain.setTargetAtTime(0.024, time + 0.3, 0.25);
    triEnv.gain.setTargetAtTime(0, time + dur - 0.05, 0.18);
    tri.connect(triFilter);
    triFilter.connect(triEnv);
    triEnv.connect(this._gains.lead);
    tri.start(time);
    tri.stop(time + dur + 1.0);

    const sin = ctx.createOscillator();
    const sinEnv = ctx.createGain();
    sin.type = 'sine';
    sin.frequency.value = freq;
    sin.detune.setValueAtTime(scoopCents, time);
    sin.detune.exponentialRampToValueAtTime(0.01, time + 0.15);
    sinEnv.gain.setValueAtTime(0, time);
    sinEnv.gain.linearRampToValueAtTime(0.019, time + 0.12);
    sinEnv.gain.setTargetAtTime(0.013, time + 0.3, 0.25);
    sinEnv.gain.setTargetAtTime(0, time + dur - 0.05, 0.18);
    sin.connect(sinEnv);
    sinEnv.connect(this._gains.lead);
    sin.start(time);
    sin.stop(time + dur + 1.0);

    const vib = ctx.createOscillator();
    const vibGain = ctx.createGain();
    vib.type = 'sine';
    vib.frequency.value = 4.5 + Math.random() * 0.6;
    vibGain.gain.setValueAtTime(0, time);
    vibGain.gain.setTargetAtTime(14, time + 0.25, 0.3);
    vib.connect(vibGain);
    vibGain.connect(tri.detune);
    vibGain.connect(sin.detune);
    vib.start(time);
    vib.stop(time + dur + 1.0);

    const noise = ctx.createBufferSource();
    const noiseBP = ctx.createBiquadFilter();
    const noiseEnv = ctx.createGain();
    noise.buffer = this._breathBuf;
    noiseBP.type = 'bandpass';
    noiseBP.frequency.value = 2200;
    noiseBP.Q.value = 1.0;
    noiseEnv.gain.setValueAtTime(0.018, time);
    noiseEnv.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
    noise.connect(noiseBP);
    noiseBP.connect(noiseEnv);
    noiseEnv.connect(this._gains.lead);
    noise.start(time);
  }

  _scheduleLead(time, barInCycle) {
    const beatDur = 60 / this._bpm;
    const barStartBeat = barInCycle * 4;
    const barEndBeat = barStartBeat + 4;
    MELODY.forEach(m => {
      if (m.beat >= barStartBeat && m.beat < barEndBeat) {
        const offset = (m.beat - barStartBeat) * beatDur;
        this._playLeadNote(time + offset, mtof(m.note), m.dur * beatDur);
      }
    });
  }

  // ═══════════════════════════════════════════
  // LAYER 2 — Drums (loose hip-hop)
  // ═══════════════════════════════════════════
  _playKick(time) {
    const ctx = this._ctx;
    const t = time + (Math.random() - 0.5) * 0.04;

    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(95, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.14);
    env.gain.setValueAtTime(0.38, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc.connect(env);
    env.connect(this._gains.drums);
    osc.start(t);
    osc.stop(t + 0.38);

    const click = ctx.createOscillator();
    const clickEnv = ctx.createGain();
    click.type = 'sine';
    click.frequency.setValueAtTime(300, t);
    click.frequency.exponentialRampToValueAtTime(60, t + 0.03);
    clickEnv.gain.setValueAtTime(0.15, t);
    clickEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    click.connect(clickEnv);
    clickEnv.connect(this._gains.drums);
    click.start(t);
    click.stop(t + 0.06);
  }

  _playSnare(time) {
    const ctx = this._ctx;
    const late = 0.035 + Math.random() * 0.01;
    const jitter = (Math.random() - 0.5) * 0.024;
    const t = time + late + jitter;

    const src = ctx.createBufferSource();
    const bp = ctx.createBiquadFilter();
    const env = ctx.createGain();
    src.buffer = this._snareBuf;
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.6;
    env.gain.setValueAtTime(0.12, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    src.connect(bp);
    bp.connect(env);
    env.connect(this._gains.drums);
    src.start(t);

    const body = ctx.createOscillator();
    const bodyEnv = ctx.createGain();
    body.type = 'sine';
    body.frequency.setValueAtTime(180, t);
    body.frequency.exponentialRampToValueAtTime(120, t + 0.06);
    bodyEnv.gain.setValueAtTime(0.14, t);
    bodyEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.10);
    body.connect(bodyEnv);
    bodyEnv.connect(this._gains.drums);
    body.start(t);
    body.stop(t + 0.12);
  }

  _playHat(time) {
    const ctx = this._ctx;
    const t = time + (Math.random() - 0.5) * 0.03;
    const velScale = 0.6 + Math.random() * 0.4;

    const src = ctx.createBufferSource();
    const hp = ctx.createBiquadFilter();
    const env = ctx.createGain();
    src.buffer = this._hatBuf;
    hp.type = 'highpass';
    hp.frequency.value = 7500;
    env.gain.setValueAtTime(0.038 * velScale, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.028);
    src.connect(hp);
    hp.connect(env);
    env.connect(this._gains.drums);
    src.start(t);
  }

  _scheduleDrums(time) {
    const beat = 60 / this._bpm;
    this._playKick(time);
    this._playKick(time + beat * 2);
    this._playSnare(time + beat);
    this._playSnare(time + beat * 3);
    for (let i = 0; i < 4; i++) {
      this._playHat(time + beat * i);
    }
  }

  // ═══════════════════════════════════════════
  // LAYER 3 — Bass (root + sub, passing tones)
  // ═══════════════════════════════════════════
  _playBassNote(time, midiNote, dur, gain) {
    const ctx = this._ctx;
    const freq = mtof(midiNote);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 280;
    filter.Q.value = 0.5;
    filter.connect(this._gains.bass);

    const root = ctx.createOscillator();
    const rootEnv = ctx.createGain();
    root.type = 'sine';
    root.frequency.value = freq;
    rootEnv.gain.setValueAtTime(0, time);
    rootEnv.gain.linearRampToValueAtTime(gain, time + 0.06);
    rootEnv.gain.setTargetAtTime(gain * 0.78, time + 0.15, 0.3);
    rootEnv.gain.setTargetAtTime(0, time + dur - 0.08, 0.18);
    root.connect(rootEnv);
    rootEnv.connect(filter);
    root.start(time);
    root.stop(time + dur + 1.0);

    const sub = ctx.createOscillator();
    const subEnv = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.value = freq / 2;
    const subGain = gain * 0.4;
    subEnv.gain.setValueAtTime(0, time);
    subEnv.gain.linearRampToValueAtTime(subGain, time + 0.08);
    subEnv.gain.setTargetAtTime(subGain * 0.75, time + 0.2, 0.3);
    subEnv.gain.setTargetAtTime(0, time + dur - 0.08, 0.2);
    sub.connect(subEnv);
    subEnv.connect(filter);
    sub.start(time);
    sub.stop(time + dur + 1.0);
  }

  _scheduleBass(time, chord) {
    const beat = 60 / this._bpm;
    if (chord.passing) {
      this._playBassNote(time, chord.bass, beat * 6.8, 0.22);
      this._playBassNote(time + beat * 7.0, chord.passing, beat * 0.9, 0.16);
    } else {
      this._playBassNote(time, chord.bass, beat * 8 + 0.1, 0.22);
    }
  }

  // ═══════════════════════════════════════════
  // LAYER 4 — Texture (sparse kalimba plucks)
  // ═══════════════════════════════════════════
  _playKalimba(time, midiNote) {
    const ctx = this._ctx;
    const freq = mtof(midiNote);
    const t = time + (Math.random() - 0.5) * 0.01;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1800;
    filter.Q.value = 0.4;
    filter.connect(this._gains.texture);

    const osc1 = ctx.createOscillator();
    const env1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.value = freq;
    env1.gain.setValueAtTime(0.055, t);
    env1.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc1.connect(env1);
    env1.connect(filter);
    osc1.start(t);
    osc1.stop(t + 0.4);

    const osc2 = ctx.createOscillator();
    const env2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 3;
    env2.gain.setValueAtTime(0.008, t);
    env2.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc2.connect(env2);
    env2.connect(filter);
    osc2.start(t);
    osc2.stop(t + 0.15);
  }

  _scheduleTexture(time, chord, barInHarmony) {
    const beat = 60 / this._bpm;
    if (barInHarmony === 1) this._playKalimba(time + beat * 2.5, chord.pad[2]);
    if (barInHarmony === 3) this._playKalimba(time + beat * 1.0, chord.pad[1]);
    if (barInHarmony === 5) this._playKalimba(time + beat * 3.0, chord.pad[0]);
    if (barInHarmony === 7) this._playKalimba(time + beat * 2.0, chord.pad[2]);
  }

  // ═══════════════════════════════════════════
  // Scheduling
  // ═══════════════════════════════════════════
  _scheduleBar(time, barIndex) {
    const barInCycle = barIndex % 16;
    const barInHarmony = barIndex % 8;
    const chordIdx = Math.floor(barInHarmony / 2);
    const chord = CHORDS[chordIdx];

    // Pads + Bass: first bar of each 2-bar chord block
    if (barInHarmony % 2 === 0) {
      if (this._overlayLevel >= 0) this._schedulePads(time, chord);
      if (this._overlayLevel >= 1.0) this._scheduleBass(time, chord);
    }

    if (this._overlayLevel >= 0.65) this._scheduleLead(time, barInCycle);
    if (this._overlayLevel >= 0.35) this._scheduleDrums(time);
    if (this._overlayLevel >= 1.5) this._scheduleTexture(time, chord, barInHarmony);
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

  // ═══════════════════════════════════════════
  // Stubs (required by BeatPlayer / Rhythm Remix)
  // ═══════════════════════════════════════════
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
}
