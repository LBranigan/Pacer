/**
 * Stickerbrush V2 Engine — Alan Chang piano arrangement
 *
 * Key: A minor (natural) | Default tempo: 95 BPM
 * Progression: Am → G → Fmaj7 → Em → Dm → C → Bdim → Am (8-bar descending bass)
 *
 * Same synthesis as V1 (triangle pads, sine+harmonic arp bells, sine+sub bass,
 * sine+triangle lead) but entirely different musical content from the Alan Chang arr.
 *
 * Layer order:
 *   Layer 1 (Base):  Pads
 *   Layer 2 (+3):    Drums (kick + snare + hats)
 *   Layer 3 (+6):    Lead melody
 *   Layer 4 (+9):    Bass (pedal + octave ornaments)
 *   Layer 5 (+12):   Arpeggio + shimmer delay
 */

function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

// ─── Chord Progression — A minor, 8-bar descending bass ─────────────────────
// MIDI: A2=45 G2=43 F2=41 E2=40 D2=38 C3=48 B2=47
//       C4=60 D4=62 E4=64 F4=65 G4=67 A4=69 B4=71
//       C5=72 D5=74 E5=76 F5=77 G5=79 A5=81 B5=83

const CHORDS = [
  { name:'Am',    bass:45, pad:[69,72,76],    arp:[69,72,76,81] },  // A4 C5 E5 | +A5
  { name:'G',     bass:43, pad:[67,71,74],    arp:[67,71,74,79] },  // G4 B4 D5 | +G5
  { name:'Fmaj7', bass:41, pad:[65,69,72,76], arp:[65,69,72,77] },  // F4 A4 C5 E5 | +F5
  { name:'Em',    bass:40, pad:[64,67,71],    arp:[64,67,71,76] },  // E4 G4 B4 | +E5
  { name:'Dm',    bass:38, pad:[62,65,69],    arp:[62,65,69,74] },  // D4 F4 A4 | +D5
  { name:'C',     bass:48, pad:[60,64,67],    arp:[60,64,67,72] },  // C4 E4 G4 | +C5
  { name:'Bdim',  bass:47, pad:[71,74,77],    arp:[71,74,77,83] },  // B4 D5 F5 | +B5
  { name:'Am*',   bass:45, pad:[69,72,76],    arp:[69,72,76,81] },  // A4 C5 E5 | +A5
];

// Generate 16-note arpeggio patterns per chord
CHORDS.forEach(c => {
  const n = c.arp;
  if (n.length >= 4) {
    c.arpPat = [
      n[0],n[2],n[1],n[3], n[2],n[0],n[3],n[1],
      n[0],n[3],n[2],n[1], n[3],n[1],n[0],n[2]
    ];
  } else {
    const hi = n[0] + 12;
    c.arpPat = [
      n[0],n[1],n[2],n[1], n[2],n[1],n[0],n[1],
      n[2], hi, n[2],n[1], n[0],n[1],n[2],n[1]
    ];
  }
});

// ─── Melody — A minor, 16-bar cycle (64 beats) ──────────────────────────────
// Phase 1 (bars 0-7): B-C-G5 hook motif and descending development
// Phase 2 (bars 8-15): Higher register with dotted rhythms
const MELODY = [
  // ── Phase 1: establishing theme ──
  // Bar 0 (Am) — pickup: B-C-G hook
  { note:71,  beat:1,    dur:0.5  },  // B4 pickup
  { note:72,  beat:1.5,  dur:0.5  },  // C5
  { note:79,  beat:2,    dur:1    },  // G5
  { note:76,  beat:3,    dur:1    },  // E5
  // Bar 1 (G)
  { note:74,  beat:4,    dur:1.5  },  // D5 dotted-quarter
  { note:72,  beat:5.5,  dur:0.5  },  // C5
  { note:71,  beat:6,    dur:1    },  // B4
  { note:72,  beat:7,    dur:1    },  // C5
  // Bar 2 (Fmaj7)
  { note:76,  beat:8,    dur:2    },  // E5
  { note:74,  beat:10,   dur:1    },  // D5
  { note:72,  beat:11,   dur:1    },  // C5
  // Bar 3 (Em)
  { note:71,  beat:12,   dur:3    },  // B4 held
  { note:69,  beat:15,   dur:1    },  // A4 pickup
  // Bar 4 (Dm)
  { note:72,  beat:16,   dur:1.5  },  // C5
  { note:69,  beat:17.5, dur:0.5  },  // A4
  { note:72,  beat:18,   dur:2    },  // C5
  // Bar 5 (C)
  { note:71,  beat:20,   dur:2    },  // B4
  { note:67,  beat:22,   dur:1    },  // G4
  { note:69,  beat:23,   dur:1    },  // A4
  // Bar 6 (Bdim)
  { note:65,  beat:24,   dur:1.5  },  // F4
  { note:67,  beat:25.5, dur:0.5  },  // G4
  { note:69,  beat:26,   dur:2    },  // A4
  // Bar 7 (Am)
  { note:67,  beat:28,   dur:3    },  // G4 resolves

  // ── Phase 2: higher register, dotted rhythms ──
  // Bar 8 (Am)
  { note:76,  beat:32,    dur:1    },  // E5
  { note:77,  beat:33,    dur:0.75 },  // F5 dotted-eighth
  { note:76,  beat:33.75, dur:0.25 },  // E5 sixteenth
  { note:79,  beat:34,    dur:1    },  // G5
  { note:76,  beat:35,    dur:1    },  // E5
  // Bar 9 (G)
  { note:74,  beat:36,    dur:1.5  },  // D5
  { note:72,  beat:37.5,  dur:0.5  },  // C5
  { note:71,  beat:38,    dur:1    },  // B4
  { note:74,  beat:39,    dur:1    },  // D5
  // Bar 10 (Fmaj7)
  { note:76,  beat:40,    dur:1    },  // E5
  { note:77,  beat:41,    dur:0.75 },  // F5 dotted-eighth
  { note:76,  beat:41.75, dur:0.25 },  // E5 sixteenth
  { note:72,  beat:42,    dur:1    },  // C5
  { note:76,  beat:43,    dur:1    },  // E5
  // Bar 11 (Em)
  { note:74,  beat:44,    dur:2    },  // D5
  { note:72,  beat:46,    dur:2    },  // C5
  // Bar 12 (Dm)
  { note:69,  beat:48,    dur:1    },  // A4
  { note:72,  beat:49,    dur:0.75 },  // C5 dotted-eighth
  { note:71,  beat:49.75, dur:0.25 },  // B4 sixteenth
  { note:72,  beat:50,    dur:1    },  // C5
  { note:74,  beat:51,    dur:1    },  // D5
  // Bar 13 (C)
  { note:76,  beat:52,    dur:3    },  // E5 held
  { note:74,  beat:55,    dur:1    },  // D5
  // Bar 14 (Bdim)
  { note:72,  beat:56,    dur:1    },  // C5
  { note:69,  beat:57,    dur:1.5  },  // A4
  { note:71,  beat:58.5,  dur:0.5  },  // B4
  { note:72,  beat:59,    dur:1    },  // C5
  // Bar 15 (Am)
  { note:71,  beat:60,    dur:2    },  // B4
  { note:67,  beat:62,    dur:2    },  // G4 resolve
];

// ─── Engine ──────────────────────────────────────────────────────────────────

export class StickerbrushV2Engine {
  constructor(ctx) {
    this._ctx = ctx;
    this._style = 'stickerbrush2';
    this._bpm = 95;
    this._playing = false;
    this._overlayLevel = 0;
    this._schedTimer = null;
    this._nextBarTime = 0;
    this._currentBar = 0; // 0-15 (16-bar super-cycle for melody)

    // Pre-allocate noise buffers for drums
    this._snareNoise = ctx.createBuffer(1, ctx.sampleRate * 0.08 | 0, ctx.sampleRate);
    const sd = this._snareNoise.getChannelData(0);
    for (let i = 0; i < sd.length; i++) sd[i] = Math.random() * 2 - 1;
    this._hatNoise = ctx.createBuffer(1, ctx.sampleRate * 0.03 | 0, ctx.sampleRate);
    const hd = this._hatNoise.getChannelData(0);
    for (let i = 0; i < hd.length; i++) hd[i] = Math.random() * 2 - 1;

    // ── Master output ────────────────────────────────────────────────────
    this._master = ctx.createGain();
    this._master.gain.value = 0.5;
    this.output = ctx.createGain();
    this.output.gain.value = 1.0;
    this._master.connect(this.output);

    // ── Reverb — procedural impulse response ─────────────────────────────
    const irLen = ctx.sampleRate * 2;
    const irBuf = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = irBuf.getChannelData(ch);
      for (let i = 0; i < irLen; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 2.2);
      }
    }
    this._reverb = ctx.createConvolver();
    this._reverb.buffer = irBuf;
    this._reverbSend = ctx.createGain();
    this._reverbSend.gain.value = 0.45;
    this._reverb.connect(this._reverbSend);
    this._reverbSend.connect(this.output);

    // ── Stereo delay (dotted-eighth, for arp shimmer) ────────────────────
    this._delay = ctx.createDelay(2);
    this._delay.delayTime.value = (60 / this._bpm) * 0.75;
    this._delayFb = ctx.createGain();
    this._delayFb.gain.value = 0.33;
    this._delaySend = ctx.createGain();
    this._delaySend.gain.value = 0.2;
    this._delay.connect(this._delayFb);
    this._delayFb.connect(this._delay);
    this._delay.connect(this._delaySend);
    this._delaySend.connect(this._master);

    // ── Per-layer gain nodes ─────────────────────────────────────────────
    this._gains = {};
    for (const p of ['pads', 'drums', 'lead', 'bass', 'arp']) {
      this._gains[p] = ctx.createGain();
      this._gains[p].gain.value = 0;
      this._gains[p].connect(this._master);
      this._gains[p].connect(this._reverb);
    }
    // Arp also feeds delay line
    this._gains.arp.connect(this._delay);
  }

  // ── PAD: 3 detuned triangles per note through LPF 900Hz ───────────────────

  _schedulePads(time, chord) {
    const ctx = this._ctx;
    const bar = 60 / this._bpm * 4;
    const dur = bar + 0.15;
    for (const midi of chord.pad) {
      const freq = mtof(midi);
      for (const det of [-7, 0, 7]) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        osc.detune.value = det;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0, time);
        env.gain.linearRampToValueAtTime(0.05, time + 0.35);
        env.gain.setTargetAtTime(0.035, time + 0.5, 0.5);
        env.gain.setTargetAtTime(0, time + dur - 0.3, 0.25);
        const lpf = ctx.createBiquadFilter();
        lpf.type = 'lowpass';
        lpf.frequency.value = 900;
        lpf.Q.value = 0.7;
        osc.connect(lpf);
        lpf.connect(env);
        env.connect(this._gains.pads);
        osc.start(time);
        osc.stop(time + dur + 1.5);
      }
    }
  }

  // ── ARPEGGIO: bell-like plucks (sine + 3rd harmonic) ───────────────────────

  _scheduleArp(time, chord) {
    const ctx = this._ctx;
    const sixteenth = 60 / this._bpm / 4;
    for (let i = 0; i < 16; i++) {
      const t = time + i * sixteenth;
      const freq = mtof(chord.arpPat[i]);
      const osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.value = freq;
      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = freq * 3;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.065, t + 0.004);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      const env2 = ctx.createGain();
      env2.gain.setValueAtTime(0, t);
      env2.gain.linearRampToValueAtTime(0.012, t + 0.004);
      env2.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      osc1.connect(env);
      osc2.connect(env2);
      env.connect(this._gains.arp);
      env2.connect(this._gains.arp);
      osc1.start(t);
      osc1.stop(t + 0.4);
      osc2.start(t);
      osc2.stop(t + 0.2);
    }
  }

  // ── BASS: sine + sub-octave pedal with octave ornaments ────────────────────

  _scheduleBass(time, chord) {
    const ctx = this._ctx;
    const freq = mtof(chord.bass);
    const beat = 60 / this._bpm;
    const bar = beat * 4;
    const dur = bar + 0.1;

    // Root pedal
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = freq / 2;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(0.18, time + 0.06);
    env.gain.setTargetAtTime(0.14, time + 0.1, 0.3);
    env.gain.setTargetAtTime(0, time + dur - 0.2, 0.15);
    const subEnv = ctx.createGain();
    subEnv.gain.setValueAtTime(0, time);
    subEnv.gain.linearRampToValueAtTime(0.07, time + 0.06);
    subEnv.gain.setTargetAtTime(0.05, time + 0.1, 0.3);
    subEnv.gain.setTargetAtTime(0, time + dur - 0.2, 0.15);
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = 260;
    lpf.Q.value = 0.5;
    osc.connect(env);
    sub.connect(subEnv);
    env.connect(lpf);
    subEnv.connect(lpf);
    lpf.connect(this._gains.bass);
    osc.start(time);
    osc.stop(time + dur + 1);
    sub.start(time);
    sub.stop(time + dur + 1);

    // Octave ornament at end of bar (quick 16th-note jump, characteristic of arr.)
    const ornTime = time + beat * 3.5;
    const ornFreq = freq * 2; // octave up
    const ornOsc = ctx.createOscillator();
    ornOsc.type = 'sine';
    ornOsc.frequency.value = ornFreq;
    const ornEnv = ctx.createGain();
    ornEnv.gain.setValueAtTime(0, ornTime);
    ornEnv.gain.linearRampToValueAtTime(0.10, ornTime + 0.02);
    ornEnv.gain.exponentialRampToValueAtTime(0.001, ornTime + beat * 0.4);
    const ornLpf = ctx.createBiquadFilter();
    ornLpf.type = 'lowpass';
    ornLpf.frequency.value = 350;
    ornLpf.Q.value = 0.5;
    ornOsc.connect(ornEnv);
    ornEnv.connect(ornLpf);
    ornLpf.connect(this._gains.bass);
    ornOsc.start(ornTime);
    ornOsc.stop(ornTime + beat + 0.1);
  }

  // ── LEAD: detuned sine+triangle with delayed vibrato ───────────────────────

  _scheduleLead(time, bar16) {
    const beat = 60 / this._bpm;
    const barBeatStart = bar16 * 4;
    const barBeatEnd = barBeatStart + 4;
    for (const m of MELODY) {
      if (m.beat >= barBeatStart && m.beat < barBeatEnd) {
        const noteTime = time + (m.beat - barBeatStart) * beat;
        const dur = m.dur * beat;
        this._playLeadNote(noteTime, m.note, dur);
      }
    }
  }

  _playLeadNote(time, midi, dur) {
    const ctx = this._ctx;
    const freq = mtof(midi);
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = freq;
    osc1.detune.value = -5;
    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = freq;
    osc2.detune.value = 5;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 4.8;
    const lfoG = ctx.createGain();
    lfoG.gain.setValueAtTime(0, time);
    lfoG.gain.setTargetAtTime(8, time + 0.15, 0.35);
    lfo.connect(lfoG);
    lfoG.connect(osc1.detune);
    lfoG.connect(osc2.detune);
    const env1 = ctx.createGain();
    env1.gain.setValueAtTime(0, time);
    env1.gain.linearRampToValueAtTime(0.07, time + 0.04);
    env1.gain.setTargetAtTime(0.055, time + 0.08, 0.25);
    env1.gain.setTargetAtTime(0, time + Math.max(dur - 0.02, 0.03), 0.1);
    const env2 = ctx.createGain();
    env2.gain.setValueAtTime(0, time);
    env2.gain.linearRampToValueAtTime(0.035, time + 0.04);
    env2.gain.setTargetAtTime(0.025, time + 0.08, 0.25);
    env2.gain.setTargetAtTime(0, time + Math.max(dur - 0.02, 0.03), 0.1);
    osc1.connect(env1);
    osc2.connect(env2);
    env1.connect(this._gains.lead);
    env2.connect(this._gains.lead);
    const stopAt = time + dur + 0.4;
    lfo.start(time); osc1.start(time); osc2.start(time);
    lfo.stop(stopAt); osc1.stop(stopAt); osc2.stop(stopAt);
  }

  // ── DRUMS: kick, snare, hi-hat ─────────────────────────────────────────────

  _scheduleDrums(time) {
    const beat = 60 / this._bpm;
    this._playKick(time);
    this._playKick(time + beat * 2);
    this._playSnare(time + beat);
    this._playSnare(time + beat * 3);
    for (let i = 0; i < 8; i++) {
      this._playHat(time + i * beat / 2, i % 2 === 0 ? 0.032 : 0.016);
    }
  }

  _playKick(time) {
    const ctx = this._ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, time);
    osc.frequency.exponentialRampToValueAtTime(38, time + 0.12);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.23, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.25);
    osc.connect(env); env.connect(this._gains.drums);
    osc.start(time); osc.stop(time + 0.3);
  }

  _playSnare(time) {
    const ctx = this._ctx;
    const src = ctx.createBufferSource(); src.buffer = this._snareNoise;
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass'; bpf.frequency.value = 1100; bpf.Q.value = 0.7;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.045, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
    src.connect(bpf); bpf.connect(env); env.connect(this._gains.drums);
    src.start(time); src.stop(time + 0.1);
  }

  _playHat(time, vol) {
    const ctx = this._ctx;
    const src = ctx.createBufferSource(); src.buffer = this._hatNoise;
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass'; hpf.frequency.value = 8500;
    const env = ctx.createGain();
    env.gain.setValueAtTime(vol, time);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);
    src.connect(hpf); hpf.connect(env); env.connect(this._gains.drums);
    src.start(time); src.stop(time + 0.04);
  }

  // ── Bar scheduler ──────────────────────────────────────────────────────────

  _scheduleBar(time, bar16) {
    const ci = bar16 % 8;
    const chord = CHORDS[ci];
    this._schedulePads(time, chord);
    if (this._overlayLevel >= 0.35) this._scheduleDrums(time);
    if (this._overlayLevel >= 0.65) this._scheduleLead(time, bar16);
    if (this._overlayLevel >= 1.0) this._scheduleBass(time, chord);
    if (this._overlayLevel >= 1.5) this._scheduleArp(time, chord);
  }

  _scheduler() {
    const bar = 60 / this._bpm * 4;
    while (this._nextBarTime < this._ctx.currentTime + 0.3) {
      this._scheduleBar(this._nextBarTime, this._currentBar);
      this._nextBarTime += bar;
      this._currentBar = (this._currentBar + 1) % 16;
    }
    if (this._playing) {
      this._schedTimer = setTimeout(() => this._scheduler(), 50);
    }
  }

  // ── Layer gain management ──────────────────────────────────────────────────

  _updateLayerGains() {
    const now = this._ctx.currentTime;
    const layers = [
      { key: 'pads',  threshold: 0 },
      { key: 'drums', threshold: 0.35 },
      { key: 'lead',  threshold: 0.65 },
      { key: 'bass',  threshold: 1.0 },
      { key: 'arp',   threshold: 1.5 },
    ];
    for (const l of layers) {
      const target = this._overlayLevel >= l.threshold ? 1 : 0;
      this._gains[l.key].gain.cancelScheduledValues(now);
      this._gains[l.key].gain.setTargetAtTime(target, now, 0.06);
    }
  }

  // ── Public API (Rhythm Remix engine interface) ─────────────────────────────

  start() {
    if (this._playing) this.stop();
    this._playing = true;
    if (this._ctx.state === 'suspended') this._ctx.resume();
    this._nextBarTime = this._ctx.currentTime + 0.05;
    this._currentBar = 0;
    this._updateLayerGains();
    this._scheduler();
  }

  stop() {
    this._playing = false;
    if (this._schedTimer) {
      clearTimeout(this._schedTimer);
      this._schedTimer = null;
    }
  }

  setTempo(bpm) {
    this._bpm = Math.max(40, Math.min(200, bpm));
    this._delay.delayTime.value = (60 / this._bpm) * 0.75;
  }

  setOverlayLevel(level) {
    this._overlayLevel = level;
    if (this._playing) this._updateLayerGains();
  }

  get overlayLevel() { return this._overlayLevel; }
  get isPlaying() { return this._playing; }
  get currentBpm() { return this._bpm; }
  get currentChordName() {
    return CHORDS[this._currentBar % 8]?.name || '';
  }

  getBeatPhase() {
    if (!this._playing) return 0;
    const beat = 60 / this._bpm;
    return (this._ctx.currentTime % beat) / beat;
  }

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
