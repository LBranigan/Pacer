/**
 * Mega Man 2 Style NES 2A03 Beat Engine
 *
 * Faithful NES sound: 2 pulse waves (25%/12.5% duty), 1 triangle, 1 noise.
 * 16-bar original composition in A minor at 150 BPM with echo effect,
 * rapid arpeggiation, driving triangle bass, and rock drum patterns.
 *
 * API-compatible with LofiEngine (output, start, stop, setTempo, _playing).
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

const midiHz = n => 440 * Math.pow(2, (n - 69) / 12);

function createPulseWave(ctx, duty) {
  const N = 64, real = new Float32Array(N), imag = new Float32Array(N);
  for (let i = 1; i < N; i++) imag[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * duty);
  return ctx.createPeriodicWave(real, imag);
}

// ─── Composition Data ───────────────────────────────────────────────────────

const STEPS_PER_BAR = 16;
const TOTAL_STEPS = 256; // 16 bars
const ECHO_DELAY = 2;
const ECHO_DETUNE = -7; // cents

const CHORDS = ['Am','Am','F','G', 'Am','Am','Dm','E', 'Am','Am','Dm','Dm', 'F','G','Am','Am'];

const CHORD_ARP = {
  Am: [69, 72, 76], F: [65, 69, 72], G: [67, 71, 74],
  Dm: [62, 65, 69], E: [64, 68, 71],
};

const MELODY = [
  0, 0, 76, 76,  0, 76, 74, 72,  74,-1, 0, 0,  0, 0, 74, 76,
  72,-1, 69,-1,  71, 72, 74,-1,  76,-1,-1, 76,  74, 72, 71, 69,
  72,-1,-1,-1,  77,-1, 76,-1,  74,-1, 72,-1,  69,-1, 72,-1,
  74,-1, 71,-1,  74,-1, 76, 74,  71,-1, 67,-1,  69,-1,-1,-1,
  0, 0, 76,-1,  81,-1, 79,-1,  76,-1, 74,-1,  72, 74, 76,-1,
  81,-1,-1, 79,  76,-1,-1,-1,  72,-1, 74, 76,  79,-1, 81,-1,
  74,-1, 77,-1,  76, 74, 72,-1,  74,-1,-1, 69,  -1,-1, 72, 74,
  76, 74, 72, 71,  69, 71, 72, 74,  76,-1,-1,-1,  -1,-1,-1,-1,
  69, 71, 72, 74,  76,-1,-1,-1,  74, 72, 71, 69,  71,-1,-1,-1,
  69,-1, 72,-1,  76,-1, 81,-1,  79,-1, 76,-1,  74,-1, 72,-1,
  74,-1,-1, 74,  77,-1, 76, 74,  72,-1, 69,-1,  74,-1,-1,-1,
  77, 76, 74, 72,  69,-1, 72, 74,  77,-1,-1,-1,  76, 74, 72,-1,
  72,-1, 77,-1,  81,-1,-1,-1,  79, 77, 76,-1,  72,-1,-1,-1,
  71,-1, 74,-1,  79,-1,-1,-1,  76, 74, 71,-1,  74,-1,-1,-1,
  76,-1, 74, 72,  71, 72, 74, 76,  77, 76, 74, 72,  71, 69, 71, 72,
  74,-1, 76,-1,  81,-1,-1,-1,  -1,-1,-1,-1,  0, 0, 0, 0,
];

const bAm  = [45,0,52,0, 45,0,52,0, 45,0,52,0, 57,0,52,0];
const bAm2 = [45,0,52,0, 57,0,52,0, 45,0,52,0, 45,0,43,0];
const bAm3 = [45,0,52,0, 45,0,52,0, 57,0,52,0, 45,0,52,0];
const bAm4 = [45,0,57,0, 52,0,45,0, 52,0,57,0, 52,0,45,0];
const bAmE = [45,0,52,0, 57,0,52,0, 45,0,0,0,  45,0,0,0];
const bF   = [41,0,48,0, 41,0,48,0, 41,0,48,0, 53,0,48,0];
const bF2  = [41,0,48,0, 53,0,48,0, 41,0,48,0, 41,0,48,0];
const bG   = [43,0,50,0, 43,0,50,0, 43,0,50,0, 55,0,50,0];
const bG2  = [43,0,50,0, 55,0,50,0, 43,0,50,0, 43,0,50,0];
const bDm  = [38,0,45,0, 38,0,45,0, 50,0,45,0, 38,0,45,0];
const bDm2 = [38,0,45,0, 38,0,50,0, 45,0,38,0, 43,0,45,0];
const bE   = [40,0,47,0, 40,0,47,0, 45,0,52,0, 45,0,0,0];
const BASS = [].concat(bAm,bAm2,bF,bG, bAm3,bAm,bDm,bE, bAm4,bAm2,bDm,bDm2, bF2,bG2,bAm3,bAmE);

const K0 = [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0];
const K1 = [1,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,0,0];
const K2 = [1,0,0,0, 0,0,1,0, 1,0,0,0, 1,0,1,0];
const S0 = [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0];
const S1 = [0,0,0,0, 1,0,0,0, 0,0,1,0, 1,0,1,1];
const S2 = [0,0,0,0, 1,0,0,0, 1,0,1,0, 1,0,1,0];
const H0 = [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0];
const H1 = [1,0,1,1, 1,0,1,0, 1,0,1,1, 1,0,1,0];
const KICK  = [].concat(K0,K0,K0,K1, K0,K0,K1,K2, K0,K0,K0,K1, K0,K1,K1,K2);
const SNARE = [].concat(S0,S0,S0,S0, S0,S0,S0,S1, S0,S0,S0,S0, S0,S0,S2,S1);
const HIHAT = [].concat(H0,H0,H0,H0, H0,H0,H0,H1, H0,H0,H0,H0, H0,H0,H1,H1);

// ─── Engine Class ───────────────────────────────────────────────────────────

export class MegaManEngine {
  constructor(ctx) {
    this._ctx = ctx;
    this._playing = false;
    this._bpm = 150;
    this._curStep = 0;
    this._nextBeatTime = 0;
    this._schedId = null;

    // Output gain (same interface as LofiEngine)
    this.output = ctx.createGain();
    this.output.gain.value = 0.35;

    // Pulse waves
    this._pulse25 = createPulseWave(ctx, 0.25);
    this._pulse125 = createPulseWave(ctx, 0.125);

    // Pre-render noise buffer
    this._noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate);
    const nd = this._noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    // Internal graph: buses → compressor → output
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.ratio.value = 4;
    comp.attack.value = 0.003; comp.release.value = 0.1;
    comp.connect(this.output);

    this._p1Bus = ctx.createGain(); this._p1Bus.connect(comp);
    this._p2Bus = ctx.createGain(); this._p2Bus.connect(comp);
    this._triBus = ctx.createGain(); this._triBus.connect(comp);
    this._noiseBus = ctx.createGain(); this._noiseBus.connect(comp);

    // Start at full overlay (all channels on)
    this.setOverlayLevel(1.5);
  }

  // ── Public API (LofiEngine-compatible) ──

  start() {
    if (this._playing) return;
    if (this._ctx.state === 'suspended') this._ctx.resume();
    this._playing = true;
    this._curStep = 0;
    this._nextBeatTime = this._ctx.currentTime + 0.05;
    this._schedId = setInterval(() => this._tick(), 25);
  }

  stop() {
    this._playing = false;
    if (this._schedId !== null) { clearInterval(this._schedId); this._schedId = null; }
  }

  setTempo(bpm) { this._bpm = Math.max(60, Math.min(220, bpm)); }
  setStyle() {}          // single style — no-op

  // Overlay levels progressively add NES channels:
  //   Base (0)   : NOISE Drums only
  //   +3  (0.35) : + TRI Bass
  //   +6  (0.65) : + P2 Echo/Arp
  //   +9  (1.0)  : + P1 Lead (all channels)
  //   +12 (1.5)  : all channels + volume boost
  setOverlayLevel(level) {
    this._overlayLevel = level;
    this._noiseBus.gain.value = 1.0;
    this._triBus.gain.value   = level >= 0.35 ? 1.0 : 0;
    this._p2Bus.gain.value    = level >= 0.65 ? 1.0 : 0;
    this._p1Bus.gain.value    = level >= 1.0  ? 1.0 : 0;
    // +12 gives a slight volume boost across all buses
    if (level >= 1.5) {
      this._noiseBus.gain.value = 1.2;
      this._triBus.gain.value   = 1.2;
      this._p2Bus.gain.value    = 1.2;
      this._p1Bus.gain.value    = 1.2;
    }
  }

  // ── LofiEngine-compatible stubs (so rhythm-remix.js works unchanged) ──

  get isPlaying() { return this._playing; }
  get currentBpm() { return this._bpm; }
  get overlayLevel() { return this._overlayLevel || 1.5; }
  get currentChordName() {
    const bar = Math.floor(this._curStep / STEPS_PER_BAR);
    return CHORDS[bar] || 'Am';
  }

  pause()  { this.stop(); }
  resume() { this.start(); }
  dispose() { this.stop(); }

  setDensity() {}
  setCrackleIntensity() {}
  playRecordSkip() {}
  playNeedleDrop() {}
  setCelebrations() {}
  setMelody() {}
  setAdaptiveHarmony() {}
  notifyWordEvent() {}
  setSentenceAligned() {}
  advanceChord() {}
  setHarmonyMood() {}
  getBeatPhase() { return 0; }

  // ── Scheduler ──

  _tick() {
    const stepDur = 60 / this._bpm / 4;
    while (this._nextBeatTime < this._ctx.currentTime + 0.12) {
      this._scheduleStep(this._nextBeatTime, this._curStep, stepDur);
      this._nextBeatTime += stepDur;
      this._curStep = (this._curStep + 1) % TOTAL_STEPS;
    }
  }

  _scheduleStep(time, step, stepDur) {
    const ctx = this._ctx;
    const bar = Math.floor(step / STEPS_PER_BAR);
    const chord = CHORDS[bar];

    // Pulse 1 — melody
    const note = MELODY[step];
    if (note > 0) {
      let dur = 1;
      for (let i = step + 1; i < TOTAL_STEPS && MELODY[i] === -1; i++) dur++;
      const freq = midiHz(note);
      const totalDur = dur * stepDur * 0.95;
      if (dur >= 3) {
        this._playPulseVibrato(this._p1Bus, this._pulse25, freq, time, totalDur, 0.22);
      } else {
        this._playPulse(this._p1Bus, this._pulse25, freq, time, totalDur, 0.22);
      }
    }

    // Pulse 2 — echo + arpeggio fill
    const echoIdx = (step - ECHO_DELAY + TOTAL_STEPS) % TOTAL_STEPS;
    const echoVal = MELODY[echoIdx];
    if (echoVal > 0) {
      let dur = 1;
      for (let i = echoIdx + 1; i < TOTAL_STEPS && MELODY[i] === -1; i++) dur++;
      const freq = midiHz(echoVal) * Math.pow(2, ECHO_DETUNE / 1200);
      this._playPulse(this._p2Bus, this._pulse125, freq, time, dur * stepDur * 0.95, 0.12);
    } else if (echoVal === 0 && MELODY[step] === 0) {
      const arp = CHORD_ARP[chord];
      if (arp) this._playArpeggio(time, arp, stepDur);
    }

    // Triangle — bass
    const bassNote = BASS[step];
    if (bassNote > 0) {
      this._playTriBass(midiHz(bassNote), time, stepDur * 0.85);
    }

    // Noise — drums
    if (KICK[step])  this._playKick(time);
    if (SNARE[step]) this._playSnare(time);
    if (HIHAT[step]) this._playHihat(time);
  }

  // ── Synthesis ──

  _playPulse(bus, wave, freq, time, dur, vol) {
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.setPeriodicWave(wave);
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.003);
    g.gain.setValueAtTime(vol, time + dur - 0.008);
    g.gain.linearRampToValueAtTime(0, time + dur);
    osc.connect(g).connect(bus);
    osc.start(time);
    osc.stop(time + dur + 0.01);
  }

  _playPulseVibrato(bus, wave, freq, time, dur, vol) {
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.setPeriodicWave(wave);
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.003);
    g.gain.setValueAtTime(vol, time + dur - 0.008);
    g.gain.linearRampToValueAtTime(0, time + dur);
    const vib = ctx.createOscillator();
    const vg = ctx.createGain();
    vib.frequency.value = 6;
    vg.gain.value = freq * 0.005;
    vib.connect(vg).connect(osc.frequency);
    osc.connect(g).connect(bus);
    osc.start(time); vib.start(time);
    osc.stop(time + dur + 0.01); vib.stop(time + dur + 0.01);
  }

  _playTriBass(freq, time, dur) {
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(0.30, time + 0.002);
    g.gain.setValueAtTime(0.30, time + dur * 0.85);
    g.gain.linearRampToValueAtTime(0, time + dur * 0.9);
    osc.connect(g).connect(this._triBus);
    osc.start(time);
    osc.stop(time + dur + 0.01);
  }

  _playKick(time) {
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(200, time);
    osc.frequency.exponentialRampToValueAtTime(40, time + 0.06);
    g.gain.setValueAtTime(0.30, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
    osc.connect(g).connect(this._noiseBus);
    osc.start(time);
    osc.stop(time + 0.13);
  }

  _playSnare(time) {
    const ctx = this._ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 3500; bp.Q.value = 1.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.07);
    src.connect(bp).connect(g).connect(this._noiseBus);
    src.start(time); src.stop(time + 0.07);
  }

  _playHihat(time) {
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    osc.type = 'square'; osc.frequency.value = 12000;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 8000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
    osc.connect(hp).connect(g).connect(this._noiseBus);
    osc.start(time); osc.stop(time + 0.04);
  }

  _playArpeggio(time, notes, dur) {
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.setPeriodicWave(this._pulse125);
    const nd = dur / 3;
    for (let i = 0; i < 3; i++) {
      osc.frequency.setValueAtTime(midiHz(notes[i % notes.length]), time + i * nd);
    }
    g.gain.setValueAtTime(0.12, time);
    g.gain.setValueAtTime(0, time + dur - 0.002);
    osc.connect(g).connect(this._p2Bus);
    osc.start(time); osc.stop(time + dur + 0.01);
  }
}
