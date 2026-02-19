/**
 * Zelda II: Adventure of Link — Palace Theme Style NES Beat Engine
 *
 * Dark, driving D minor composition inspired by the Palace Theme.
 * NES 2A03 faithful: 2 pulse (50%/25% duty), 1 triangle, 1 noise.
 * Harmonic minor with raised 7th (C#), walking bass, aggressive drums.
 *
 * API-compatible with LofiEngine.
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

const midiHz = n => 440 * Math.pow(2, (n - 69) / 12);

function createPulseWave(ctx, duty) {
  const N = 64, real = new Float32Array(N), imag = new Float32Array(N);
  for (let i = 1; i < N; i++) imag[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * duty);
  return ctx.createPeriodicWave(real, imag);
}

// ─── Composition Data — 16 bars, D minor, 160 BPM ──────────────────────────

const STEPS_PER_BAR = 16;
const TOTAL_STEPS = 256;
const ECHO_DELAY = 2;
const ECHO_DETUNE = -5; // cents — slightly tighter than MM2

// Chord per bar: i-i-bVI-V | i-i-iv-V | iv-iv-i-i | bVI-bVII-i-i
const CHORDS = ['Dm','Dm','Bb','A', 'Dm','Dm','Gm','A', 'Gm','Gm','Dm','Dm', 'Bb','C','Dm','Dm'];

const CHORD_ARP = {
  Dm: [62, 65, 69], // D4 F4 A4
  Bb: [70, 74, 77], // Bb4 D5 F5
  Gm: [67, 70, 74], // G4 Bb4 D5
  A:  [69, 73, 76], // A4 C#5 E5 (harmonic minor V)
  C:  [72, 76, 79], // C5 E5 G5
};

// Melody (Pulse 1) — D minor with raised 7th (C#=73)
const MELODY = [
  // Section A — bars 1-8 (Dm Dm Bb A Dm Dm Gm A)
  // Bar 1 (Dm) — dark opening motif
  0, 0, 74,-1,  77,-1, 76, 74,  69,-1,-1,-1,  -1,-1, 72, 74,
  // Bar 2 (Dm) — chromatic response (C# = raised 7th)
  76, 74, 73, 74,  77,-1,-1,-1,  76, 74, 72,-1,  69,-1,-1,-1,
  // Bar 3 (Bb) — bVI color, oscillating
  74,-1, 70,-1,  74,-1, 77,-1,  74,-1, 70,-1,  69,-1,-1,-1,
  // Bar 4 (A) — dominant tension
  73,-1,-1,-1,  76,-1, 74, 73,  74,-1,-1,-1,  -1,-1, 73, 74,
  // Bar 5 (Dm) — building intensity
  77,-1, 76, 74,  76, 77,-1,-1,  74,-1, 69,-1,  74,-1,-1,-1,
  // Bar 6 (Dm) — scalar run up to A5
  77, 76, 74, 72,  74,-1,-1, 74,  77,-1, 81,-1,  79, 77, 76, 74,
  // Bar 7 (Gm) — iv chord, darker
  70,-1, 74,-1,  79,-1,-1,-1,  77,-1, 74,-1,  70,-1,-1,-1,
  // Bar 8 (A) — dominant climax + resolution
  73,-1, 76,-1,  81,-1,-1,-1,  79, 76, 73,-1,  74,-1,-1,-1,

  // Section B — bars 9-16 (Gm Gm Dm Dm Bb C Dm Dm)
  // Bar 9 (Gm) — new theme, ascending from G4
  67, 69, 70, 74,  -1,-1,-1,-1,  74, 72, 70, 69,  70,-1,-1,-1,
  // Bar 10 (Gm) — continuation
  67,-1, 70,-1,  74,-1,-1,-1,  72, 70, 69,-1,  67,-1,-1,-1,
  // Bar 11 (Dm) — return to main motif
  74,-1,-1, 74,  77,-1, 76, 74,  69,-1, 72,-1,  74,-1,-1,-1,
  // Bar 12 (Dm) — ascending run
  77, 76, 74, 76,  77,-1, 81,-1,  79,-1, 77,-1,  76, 74, 72,-1,
  // Bar 13 (Bb) — bVI again
  70,-1, 74,-1,  77,-1,-1,-1,  74,-1, 70,-1,  77,-1,-1,-1,
  // Bar 14 (C) — bVII brightness
  72,-1, 76,-1,  79,-1,-1,-1,  76, 72,-1,-1,  79,-1,-1,-1,
  // Bar 15 (Dm) — climactic 16th-note run with C#
  81,-1,-1, 79,  77, 76, 74, 76,  77, 76, 74, 73,  74,-1,-1,-1,
  // Bar 16 (Dm) — resolution + breath
  74,-1, 77,-1,  81,-1,-1,-1,  -1,-1,-1,-1,  0, 0, 0, 0,
];

// Bass (Triangle) — walking 8th-note patterns, more melodic than MM2
const bDm  = [38,0,45,0, 38,0,45,0, 38,0,45,0, 50,0,45,0]; // D2-A2 root-5th
const bDm2 = [38,0,45,0, 50,0,45,0, 38,0,43,0, 41,0,38,0]; // walking: D-A-D3-A-D-G-F-D
const bDm3 = [38,0,50,0, 45,0,38,0, 45,0,50,0, 45,0,38,0]; // active bounce
const bDmE = [38,0,45,0, 50,0,45,0, 38,0,0,0,  38,0,0,0];  // ending
const bBb  = [46,0,53,0, 46,0,53,0, 46,0,53,0, 50,0,46,0]; // Bb2-F3
const bBb2 = [46,0,53,0, 50,0,53,0, 46,0,53,0, 46,0,53,0];
const bA   = [45,0,52,0, 45,0,52,0, 49,0,45,0, 43,0,45,0]; // A2-E3 with C#3 walk
const bA2  = [45,0,52,0, 49,0,52,0, 45,0,52,0, 45,0,0,0];
const bGm  = [43,0,50,0, 43,0,50,0, 46,0,50,0, 43,0,50,0]; // G2-D3 with Bb2
const bGm2 = [43,0,50,0, 43,0,50,0, 43,0,46,0, 43,0,41,0]; // walking down
const bC   = [48,0,55,0, 48,0,55,0, 48,0,55,0, 52,0,48,0]; // C3-G3
const BASS = [].concat(bDm,bDm2,bBb,bA, bDm,bDm3,bGm,bA2, bGm,bGm2,bDm,bDm2, bBb2,bC,bDm3,bDmE);

// Drum patterns — driving palace beat, more aggressive fills
const K0 = [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0]; // standard
const K1 = [1,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,0,0]; // driving
const K2 = [1,0,0,0, 0,0,1,0, 1,0,0,0, 1,0,1,0]; // fill
const K3 = [1,0,0,0, 1,0,0,0, 1,0,0,0, 0,0,0,0]; // gallop
const S0 = [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0]; // standard
const S1 = [0,0,0,0, 1,0,0,0, 0,0,1,0, 1,0,1,1]; // fill
const S2 = [0,0,0,0, 1,0,0,0, 1,0,1,0, 1,0,1,0]; // roll
const S3 = [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1]; // snare + ghost
const H0 = [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0]; // standard 8ths
const H1 = [1,0,1,1, 1,0,1,0, 1,0,1,1, 1,0,1,0]; // dense 16ths
const H2 = [1,1,1,0, 1,0,1,0, 1,1,1,0, 1,0,1,0]; // gallop hats
const KICK  = [].concat(K0,K0,K0,K1, K3,K0,K1,K2, K0,K0,K3,K1, K0,K1,K3,K2);
const SNARE = [].concat(S0,S0,S0,S3, S0,S0,S0,S1, S0,S0,S0,S3, S0,S0,S2,S1);
const HIHAT = [].concat(H0,H0,H0,H0, H2,H0,H0,H1, H0,H0,H2,H0, H0,H0,H1,H1);

// ─── Engine Class ───────────────────────────────────────────────────────────

export class ZeldaIIEngine {
  constructor(ctx) {
    this._ctx = ctx;
    this._playing = false;
    this._bpm = 160;
    this._curStep = 0;
    this._nextBeatTime = 0;
    this._schedId = null;

    this.output = ctx.createGain();
    this.output.gain.value = 0.35;

    // 50% duty for lead (fuller, darker), 25% for echo
    this._pulse50 = createPulseWave(ctx, 0.50);
    this._pulse25 = createPulseWave(ctx, 0.25);

    this._noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate);
    const nd = this._noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.ratio.value = 4;
    comp.attack.value = 0.003; comp.release.value = 0.1;
    comp.connect(this.output);

    this._p1Bus = ctx.createGain(); this._p1Bus.connect(comp);
    this._p2Bus = ctx.createGain(); this._p2Bus.connect(comp);
    this._triBus = ctx.createGain(); this._triBus.connect(comp);
    this._noiseBus = ctx.createGain(); this._noiseBus.connect(comp);

    this.setOverlayLevel(1.5);
  }

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
  setStyle() {}

  setOverlayLevel(level) {
    this._noiseBus.gain.value = 1.0;
    this._triBus.gain.value   = level >= 0.35 ? 1.0 : 0;
    this._p2Bus.gain.value    = level >= 0.65 ? 1.0 : 0;
    this._p1Bus.gain.value    = level >= 1.0  ? 1.0 : 0;
    if (level >= 1.5) {
      this._noiseBus.gain.value = 1.2;
      this._triBus.gain.value   = 1.2;
      this._p2Bus.gain.value    = 1.2;
      this._p1Bus.gain.value    = 1.2;
    }
  }

  _tick() {
    const stepDur = 60 / this._bpm / 4;
    const now = this._ctx.currentTime;
    // Catch-up guard: skip ahead if we fell far behind (tab lost focus, GC pause)
    if (this._nextBeatTime < now - 0.3) {
      const skipped = Math.floor((now - this._nextBeatTime) / stepDur);
      this._nextBeatTime += skipped * stepDur;
      this._curStep = (this._curStep + skipped) % TOTAL_STEPS;
    }
    while (this._nextBeatTime < now + 0.12) {
      this._scheduleStep(this._nextBeatTime, this._curStep, stepDur);
      this._nextBeatTime += stepDur;
      this._curStep = (this._curStep + 1) % TOTAL_STEPS;
    }
  }

  _scheduleStep(time, step, stepDur) {
    const bar = Math.floor(step / STEPS_PER_BAR);
    const chord = CHORDS[bar];

    // Pulse 1 — melody (50% duty, fuller/darker)
    const note = MELODY[step];
    if (note > 0) {
      let dur = 1;
      for (let i = step + 1; i < TOTAL_STEPS && MELODY[i] === -1; i++) dur++;
      const freq = midiHz(note);
      const totalDur = dur * stepDur * 0.95;
      if (dur >= 3) {
        this._playPulseVibrato(this._p1Bus, this._pulse50, freq, time, totalDur, 0.22);
      } else {
        this._playPulse(this._p1Bus, this._pulse50, freq, time, totalDur, 0.22);
      }
    }

    // Pulse 2 — echo (25% duty, thinner) + arpeggio fill
    const echoIdx = (step - ECHO_DELAY + TOTAL_STEPS) % TOTAL_STEPS;
    const echoVal = MELODY[echoIdx];
    if (echoVal > 0) {
      let dur = 1;
      for (let i = echoIdx + 1; i < TOTAL_STEPS && MELODY[i] === -1; i++) dur++;
      const freq = midiHz(echoVal) * Math.pow(2, ECHO_DETUNE / 1200);
      this._playPulse(this._p2Bus, this._pulse25, freq, time, dur * stepDur * 0.95, 0.12);
    } else if (echoVal === 0 && MELODY[step] === 0) {
      const arp = CHORD_ARP[chord];
      if (arp) this._playArpeggio(time, arp, stepDur);
    }

    // Triangle — walking bass
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
    vib.frequency.value = 5.5; // slightly slower vibrato than MM2
    vg.gain.value = freq * 0.004;
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
    osc.frequency.setValueAtTime(180, time);
    osc.frequency.exponentialRampToValueAtTime(35, time + 0.05);
    g.gain.setValueAtTime(0.30, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.10);
    osc.connect(g).connect(this._noiseBus);
    osc.start(time);
    osc.stop(time + 0.11);
  }

  _playSnare(time) {
    const ctx = this._ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 4000; bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
    src.connect(bp).connect(g).connect(this._noiseBus);
    src.start(time); src.stop(time + 0.06);
  }

  _playHihat(time) {
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    osc.type = 'square'; osc.frequency.value = 13000;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 9000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.10, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.025);
    osc.connect(hp).connect(g).connect(this._noiseBus);
    osc.start(time); osc.stop(time + 0.035);
  }

  _playArpeggio(time, notes, dur) {
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.setPeriodicWave(this._pulse25);
    const nd = dur / 3;
    for (let i = 0; i < 3; i++) {
      osc.frequency.setValueAtTime(midiHz(notes[i % notes.length]), time + i * nd);
    }
    g.gain.setValueAtTime(0.10, time);
    g.gain.setValueAtTime(0, time + dur - 0.002);
    osc.connect(g).connect(this._p2Bus);
    osc.start(time); osc.stop(time + dur + 0.01);
  }
}
