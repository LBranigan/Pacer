# Rhythm Remix — Enhancement Research & Ideas

## Current Implementation Summary

The Rhythm Remix is an interactive playback experience that synchronizes a student's recorded reading with procedurally-generated lo-fi hip-hop beats. All music is synthesized in real-time via Web Audio API — zero samples.

### Architecture
- **Entry**: `app.js` button → opens `rhythm-remix.html` in new window
- **Orchestrator**: `js/rhythm-remix.js` — word sync, animation loop, density control
- **Beat engine**: `js/lofi-engine.js` — drums, chords, bass, effects (all Web Audio oscillators/noise)
- **CSS**: `css/rhythm-remix.css` — dark lo-fi vinyl-cafe aesthetic

### Audio Signal Chain
```
[Student Voice] → mediaElementSource → voiceGain ──┐
                                                    ├→ analyser → FFT visualizer
[LofiEngine]    → lofi.output → beatGain ───────────┘
                                    │
                      drumBus / padBus / bassBus
                              ↓
                           mixBus
                              ↓
                        bitcrusher (12-bit)
                              ↓
                      warmthFilter (LP 6kHz)
                              ↓
                      tapeDelay + LFO wobble
                              ↓
                     reverb (30% wet) + dry
                              ↓
                       saturation (tanh)
                              ↓
                        masterGain → output
```

### Current Features
- **3 styles**: Lo-Fi Chill (boom-bap, ii-V-I-vi), Jazz Hop (syncopated, 9th chords), Ambient (no drums, long pads)
- **4 density levels**: whisper → sparse → normal → full (driven by 3-word error-rate window)
- **Pause-reactive beats**: gaps >0.8s → sparse, >1.5s → whisper
- **Bouncing ball**: Bezier arcs, spring physics, color-coded by word type, trail + particles
- **Sentence-aligned chord changes** (optional toggle)
- **Vinyl crackle**: 4-second looping sparse impulse buffer at ~30 impulses/sec
- **Effects chain**: tape wobble, bitcrusher, reverb, saturation
- **Spinning vinyl record** UI with tonearm
- **FFT visualizer** with frequency bars
- **Voice/beat volume** sliders, speed control (0.75x/1x/1.25x)
- **Reduced motion** support (prefers-reduced-motion)

### Musical Styles Detail

| Style | Chords | Drums | Bass | Pad Attack/Release |
|-------|--------|-------|------|--------------------|
| Lo-Fi Chill | Dm7→G7→Cmaj7→Am7 | Boom-bap (K:1,3 S:2,4 HH:all) | Half-note | 0.2s / 0.5s |
| Jazz Hop | Dm9→G13→Cmaj9→Am9 | Syncopated, swing hats | Syncopated | 0.2s / 0.5s |
| Ambient | Same as lofi | None | Very sparse | 0.6s / 1.5s |

---

## Enhancement Ideas

### Tier 1 — Low Effort / High Impact

#### 1. Micro-Celebration Sounds
Small, satisfying audio events quantized to the beat:
- **Streak chime**: 5+ correct words → rising pentatonic arpeggio
- **Self-correction ping**: dissonant interval resolving to consonance
- **Sentence complete**: soft cymbal swell
- **Fluency bonus**: 3+ steady/quick pace words → hi-hat fill

#### 2. Reactive Vinyl Crackle (Always On)
Make crackle responsive to reading performance:
- Smooth reading → warm minimal crackle
- Struggles → increased density + record skip stutters
- Long pauses → needle lifting silence
- Recovery → needle drop thump

#### 3. Download Your Remix
Export combined voice + beat as audio file via `MediaRecorder` API.

#### 4. Personal Sound Identity
Hash student's reading profile into synth parameters (oscillator type, filter cutoff, detune).

#### 5. Spatial Audio
`StereoPannerNode` — correct=center, substitution=left, self-correction sweeps left→center.

### Tier 2 — Medium Effort / High Impact

#### 6. Melodic Reading Contour
Map word speed tiers to pitches in current chord. Fast words → high notes, slow → low, struggles → chromatic passing tones. Each word landing triggers a melodic "ping."

#### 7. Adaptive Harmonic Weather
Rolling 10-15 word window of reading quality shifts chord quality:
- Smooth (>80% correct) → major 7th
- Moderate (50-80%) → minor 7th
- Struggling (<50%) → half-diminished / suspended
Recovery resolves back to major.

#### 8. Generative Melody Fills
During pauses >0.8s, play short melodic fills. After correct streaks: ascending arpeggios. After errors: descending chromatic. Quantized to beat subdivisions.

#### 9. Voice Effects Mode
Fun post-playback effects: Auto-Tune, Chipmunk, Deep Voice, Echo Canyon, Robot.

#### 10. More Styles
Bossa Nova, Chiptune/8-bit, Classical Piano, Trap.

#### 11. Syllable-Level Bouncing Ball
Mini-bounces within multi-syllabic words using existing phoneme count data.

### Tier 3 — High Effort / Very High Impact

#### 12. Rhythm Game Mode
Active mode: words scroll toward hit zone in time with beat. Student reads aloud, system scores accuracy + timing.

#### 13. Performance Comparison ("Then vs. Now")
Dual-playback of same passage at different times over same beat. Growth visualization.

#### 14. Lo-Fi Radio Station Wrapper
Continuous ambient beats between assessments, radio DJ framing.

### Tier 4 — Nice to Have

#### 15. Waveform Mountain Range
Topographic reading landscape visualization. Exportable as image.

#### 16. Granular Voice Texturing
Deconstruct struggle word audio into rhythmic grain texture.

---

## Implementation Status

| Feature | Status | Notes |
|---------|--------|-------|
| Reactive vinyl crackle | Implemented | Always on, no toggle |
| Micro-celebrations | Implemented | Toggle in window |
| Melodic reading contour | Implemented | Toggle in window |
| Adaptive harmony | Implemented | Toggle in window |
| New musical styles | Implemented | Bossa Nova, Chiptune 8-Bit, Classical Piano, Trap |
| Study Beats FM (DJ intro) | Implemented | Gemini TTS (Sulafat voice), auto-plays before reading |
| All others | Not started | Future work |

---

## Key Technical Notes
- All synthesis uses Web Audio API only (no Tone.js dependency) for iPad Safari compatibility
- No AudioWorklet — uses mainstream nodes + setInterval scheduling
- Lo-fi engine has lookahead scheduling (120ms ahead, 25ms timer interval)
- Beat patterns are 32-beat arrays (8 bars of 4/4)
- Chord pads use dual detuned sine oscillators per note (±2 cents) + quiet sawtooth layer
