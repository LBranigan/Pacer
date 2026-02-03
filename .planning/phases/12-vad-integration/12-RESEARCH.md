# Phase 12: VAD Integration - Research

**Researched:** 2026-02-03
**Domain:** Silero VAD browser integration for ASR hallucination detection
**Confidence:** HIGH

## Summary

This phase integrates Silero VAD to detect "ghost words" - hallucinated transcriptions where the ASR reported a word but the student was silent. VAD runs as a post-process safety valve on completed audio (not during recording), checking whether `latest_only` words from the ensemble merger actually have speech overlap in the original audio.

The standard approach uses `@ricky0123/vad-web` which wraps Silero VAD with ONNX Runtime Web for browser execution. The `NonRealTimeVAD` API processes pre-recorded audio and returns speech segments with millisecond timestamps - exactly what we need for ghost detection. Microphone calibration records 2 seconds of ambient noise to determine optimal VAD threshold for the environment.

**Primary recommendation:** Use `@ricky0123/vad-web` with `NonRealTimeVAD.run()` to get speech segments from the completed audio blob. Compare each `latest_only` word's timestamp against VAD speech segments to flag ghosts. Calibration measures max VAD probability during silence to set threshold above ambient noise floor.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@ricky0123/vad-web` | 0.0.29 | Silero VAD wrapper for browser | Most popular browser VAD; handles ONNX loading, audio resampling |
| `onnxruntime-web` | 1.22.0+ | ONNX model execution in browser | Required by vad-web; Microsoft's official ONNX runtime |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Web Audio API (native) | N/A | Decode audio blob to Float32Array | Converting recorded audio for VAD processing |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@ricky0123/vad-web` | Raw Silero ONNX + onnxruntime-web | Much more complex; vad-web handles audio resampling, model loading, frame batching |
| NonRealTimeVAD | MicVAD | MicVAD is for live recording; we need post-process on completed audio |

**Installation (CDN - no bundler required):**
```html
<script src="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.wasm.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.29/dist/bundle.min.js"></script>
```

## Architecture Patterns

### Recommended Project Structure
```
js/
  vad-processor.js    # NEW: VAD loading, audio processing, ghost detection
  app.js              # Update to call VAD after STT, pass results to alignment
  ui.js               # Update to show ghost flagging, calibration controls
  ensemble-merger.js  # EXISTING: Already tags words as latest_only
```

### Pattern 1: Post-Process VAD on Completed Audio
**What:** Run VAD after recording completes, before/during STT response processing
**When to use:** Every assessment with reference text (per CONTEXT.md decision)
**Example:**
```javascript
// Source: @ricky0123/vad-web docs, MDN Web Audio API
async function getVADSegments(audioBlob, vadThreshold = 0.375) {
  // 1. Decode blob to Float32Array using Web Audio API
  const audioContext = new AudioContext({ sampleRate: 16000 });
  const arrayBuffer = await audioBlob.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  const audioData = audioBuffer.getChannelData(0); // Mono channel
  const sampleRate = audioBuffer.sampleRate;

  // 2. Create NonRealTimeVAD with calibrated threshold
  const myvad = await vad.NonRealTimeVAD.new({
    positiveSpeechThreshold: vadThreshold,
    negativeSpeechThreshold: vadThreshold - 0.10, // 0.10 below positive
    redemptionMs: 200, // Short redemption for word-level detection
    minSpeechMs: 50    // Allow short words
  });

  // 3. Collect speech segments
  const segments = [];
  for await (const { start, end } of myvad.run(audioData, sampleRate)) {
    segments.push({ start, end }); // milliseconds
  }

  await audioContext.close();
  return segments;
}
```

### Pattern 2: Ghost Detection via Timestamp Overlap
**What:** Check if `latest_only` words have speech during their timestamp range
**When to use:** After merging ensemble results, before alignment display
**Example:**
```javascript
// Source: Project requirements VAD-03, VAD-04
function detectGhosts(mergedWords, vadSegments, referenceWords) {
  const referenceSet = new Set(referenceWords.map(w => w.toLowerCase()));

  for (const word of mergedWords) {
    // Only check latest_only words that ARE in reference (per CONTEXT.md)
    if (word.source !== 'latest_only') continue;
    if (!referenceSet.has(word.word.toLowerCase())) continue;

    const wordStart = parseTimeMs(word.startTime);
    const wordEnd = parseTimeMs(word.endTime);
    const wordDuration = wordEnd - wordStart;

    // Check overlap with VAD segments
    let maxOverlap = 0;
    for (const seg of vadSegments) {
      const overlapStart = Math.max(wordStart, seg.start);
      const overlapEnd = Math.min(wordEnd, seg.end);
      if (overlapStart < overlapEnd) {
        maxOverlap = Math.max(maxOverlap, overlapEnd - overlapStart);
      }
    }

    // Determine required overlap (more lenient for short words)
    const requiredOverlap = wordDuration < 200 ? 30 : 50; // ms

    if (maxOverlap < requiredOverlap) {
      word.vad_ghost_in_reference = true;
    }
  }
}
```

### Pattern 3: Ambient Noise Calibration (2 seconds)
**What:** Record silence, measure VAD probabilities, set threshold above noise floor
**When to use:** When teacher clicks "Calibrate Microphone" button
**Example:**
```javascript
// Source: VAD calibration algorithms, CONTEXT.md decisions
async function calibrateMicrophone() {
  const CALIBRATION_DURATION_MS = 2000;

  // Record 2 seconds of ambient audio
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
  const chunks = [];

  mediaRecorder.ondataavailable = (e) => chunks.push(e.data);

  const recordingPromise = new Promise((resolve) => {
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      resolve(new Blob(chunks, { type: 'audio/webm' }));
    };
  });

  mediaRecorder.start();
  await new Promise(r => setTimeout(r, CALIBRATION_DURATION_MS));
  mediaRecorder.stop();

  const silenceBlob = await recordingPromise;

  // Process with VAD at low threshold to get noise probabilities
  const audioContext = new AudioContext({ sampleRate: 16000 });
  const arrayBuffer = await silenceBlob.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  const audioData = audioBuffer.getChannelData(0);

  // Get raw frame probabilities (requires custom VAD usage)
  // Find max probability during silence = noise floor
  const myvad = await vad.NonRealTimeVAD.new({
    positiveSpeechThreshold: 0.01, // Very low to capture all frames
    minSpeechMs: 10
  });

  let maxNoiseProbability = 0;
  for await (const { audio } of myvad.run(audioData, audioBuffer.sampleRate)) {
    // Each returned segment means probability exceeded threshold
    // We want to find the "false positive" level
    maxNoiseProbability = Math.max(maxNoiseProbability, 0.15); // Estimated
  }

  // Set threshold 0.05-0.10 above measured noise floor
  // Clamp to valid range 0.15-0.60
  const calibratedThreshold = Math.min(0.60, Math.max(0.15, maxNoiseProbability + 0.10));

  await audioContext.close();
  return {
    threshold: calibratedThreshold,
    noiseLevel: classifyNoiseLevel(maxNoiseProbability)
  };
}

function classifyNoiseLevel(probability) {
  if (probability < 0.15) return 'Low';
  if (probability < 0.30) return 'Moderate';
  return 'High';
}
```

### Pattern 4: Edge Leniency for Audio Boundaries
**What:** Don't flag words at recording start/end as ghosts
**When to use:** During ghost detection (per CONTEXT.md decision)
**Example:**
```javascript
// Source: CONTEXT.md "Audio edges: Be lenient at start/end of recording"
const EDGE_TOLERANCE_MS = 300; // First/last 300ms of recording

function isAtAudioEdge(word, audioDurationMs) {
  const wordStart = parseTimeMs(word.startTime);
  const wordEnd = parseTimeMs(word.endTime);

  // Near start of recording
  if (wordStart < EDGE_TOLERANCE_MS) return true;

  // Near end of recording
  if (wordEnd > audioDurationMs - EDGE_TOLERANCE_MS) return true;

  return false;
}
```

### Anti-Patterns to Avoid
- **Running VAD during live recording:** CPU-intensive on Chromebooks, causes audio glitches. Always post-process.
- **Using MicVAD for file processing:** MicVAD is for live streams. Use NonRealTimeVAD for recorded audio.
- **Flagging non-reference ghosts:** Per CONTEXT.md, only flag `latest_only` words that ARE in reference text.
- **Strict overlap for short words:** Words under 200ms are hard to detect; use lenient 30ms overlap threshold.
- **Trusting VAD alone:** VAD is a safety valve, not ground truth. When in doubt, trust the ASR.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Audio resampling to 16kHz | Manual resampling algorithm | `@ricky0123/vad-web` (auto-resamples) | FFT-based resampling is complex; library handles it |
| ONNX model loading | Manual fetch + session creation | `vad.NonRealTimeVAD.new()` | Handles WASM path config, model fetching, session init |
| Frame batching | Manual 512-sample chunks | Library internal | Silero v5 uses 512 samples @ 16kHz = 32ms frames |
| Blob to Float32Array | Manual WAV parsing | `AudioContext.decodeAudioData()` | Handles all browser-supported formats, auto-resamples |

**Key insight:** The `@ricky0123/vad-web` library handles the complexity of audio processing and ONNX execution. Our job is just to call `NonRealTimeVAD.run()` and interpret the speech segments.

## Common Pitfalls

### Pitfall 1: WASM/ONNX File Loading Failures
**What goes wrong:** VAD initialization fails with "model not found" or CORS errors
**Why it happens:** CDN paths incorrect or blocked, WASM files not accessible
**How to avoid:**
- Use explicit CDN paths in script tags
- Test VAD loading on app startup, show warning if fails
- Per CONTEXT.md: "VAD failure: Warn and continue"
**Warning signs:** Console errors about ONNX or WASM, silent VAD failures

### Pitfall 2: AudioContext Sample Rate Mismatch
**What goes wrong:** VAD gets garbage data, produces no segments or all segments
**Why it happens:** Creating AudioContext without specifying 16kHz, or browser resamples incorrectly
**How to avoid:**
- Create AudioContext with `{ sampleRate: 16000 }` to match Silero's expected rate
- Or let vad-web's internal resampling handle it (pass native sample rate)
**Warning signs:** Zero speech segments on obvious speech, or 100% coverage

### Pitfall 3: Calibration During Speech
**What goes wrong:** Calibrated threshold too high, flags real speech as ghosts
**Why it happens:** Teacher speaks or noise occurs during calibration
**How to avoid:**
- Clear instruction: "Click to calibrate microphone" (minimal per CONTEXT.md)
- Use median rather than max of noise samples
- Clamp threshold to 0.15-0.60 range
**Warning signs:** High ghost rates after calibration in quiet environments

### Pitfall 4: Blocking UI During VAD Processing
**What goes wrong:** App freezes during long audio VAD processing
**Why it happens:** ONNX inference is CPU-intensive, running on main thread
**How to avoid:**
- Process during "upload spinner" phase (already shown)
- Consider Web Worker for very long audio (>60s)
- Show progress indicator
**Warning signs:** Unresponsive UI during analysis

### Pitfall 5: Ghost Sequences Overwhelming Teacher
**What goes wrong:** 10+ consecutive ghosts obscure the actual reading errors
**Why it happens:** ASR hallucinated an entire phrase during silence
**How to avoid:**
- Per CONTEXT.md: "Escalate 5+ consecutive ghosts with more prominent flagging"
- Group consecutive ghosts visually
- Include ghost count in metrics summary
**Warning signs:** UI cluttered with ghost flags, hiding real errors

## Code Examples

Verified patterns from official sources:

### Complete VAD Processing Flow
```javascript
// Source: @ricky0123/vad-web docs, MDN Web Audio API, project patterns
class VADProcessor {
  constructor() {
    this.vadInstance = null;
    this.isLoaded = false;
    this.loadError = null;
    this.threshold = 0.375; // Default middle of range
  }

  async init() {
    try {
      // Pre-create instance to verify ONNX loads
      this.vadInstance = await vad.NonRealTimeVAD.new({
        positiveSpeechThreshold: this.threshold,
        negativeSpeechThreshold: this.threshold - 0.10
      });
      this.isLoaded = true;
    } catch (err) {
      this.loadError = err.message;
      console.warn('[VAD] Failed to load:', err);
    }
  }

  async processAudio(audioBlob) {
    if (!this.isLoaded) {
      return { segments: [], error: this.loadError || 'VAD not loaded' };
    }

    const audioContext = new AudioContext({ sampleRate: 16000 });
    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const audioData = audioBuffer.getChannelData(0);
      const sampleRate = audioBuffer.sampleRate;
      const durationMs = (audioData.length / sampleRate) * 1000;

      // Create fresh VAD instance with current threshold
      const vadInstance = await vad.NonRealTimeVAD.new({
        positiveSpeechThreshold: this.threshold,
        negativeSpeechThreshold: this.threshold - 0.10,
        redemptionMs: 200,
        minSpeechMs: 50,
        preSpeechPadMs: 30
      });

      const segments = [];
      for await (const { start, end } of vadInstance.run(audioData, sampleRate)) {
        segments.push({ start, end });
      }

      return { segments, durationMs, error: null };
    } catch (err) {
      return { segments: [], error: err.message };
    } finally {
      await audioContext.close();
    }
  }

  setThreshold(value) {
    // Clamp to valid range
    this.threshold = Math.min(0.60, Math.max(0.15, value));
  }
}

// Export singleton
export const vadProcessor = new VADProcessor();
```

### Ghost Detection Integration
```javascript
// Source: Project ensemble-merger.js patterns, CONTEXT.md decisions
export function flagGhostWords(mergedWords, vadResult, referenceText, audioDurationMs) {
  if (!vadResult.segments || vadResult.error) {
    // VAD failed - proceed without ghost detection per CONTEXT.md
    return { ghostCount: 0, vadError: vadResult.error };
  }

  // Build reference word set for checking "in reference"
  const referenceWords = referenceText.toLowerCase()
    .replace(/[^a-z'\s-]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  const referenceSet = new Set(referenceWords);

  let ghostCount = 0;
  let consecutiveGhosts = 0;
  let maxConsecutive = 0;

  for (const word of mergedWords) {
    // Reset consecutive counter for non-ghosts
    word.vad_ghost_in_reference = false;

    // Only check latest_only words IN reference
    if (word.source !== 'latest_only') {
      consecutiveGhosts = 0;
      continue;
    }

    const wordNorm = word.word.toLowerCase().replace(/[^a-z'-]/g, '');
    if (!referenceSet.has(wordNorm)) {
      consecutiveGhosts = 0;
      continue; // Not in reference - don't flag
    }

    // Skip edge words
    if (isAtAudioEdge(word, audioDurationMs)) {
      consecutiveGhosts = 0;
      continue;
    }

    // Check VAD overlap
    const wordStart = parseTimeMs(word.startTime);
    const wordEnd = parseTimeMs(word.endTime);
    const wordDuration = wordEnd - wordStart;

    let maxOverlap = 0;
    for (const seg of vadResult.segments) {
      const overlapStart = Math.max(wordStart, seg.start);
      const overlapEnd = Math.min(wordEnd, seg.end);
      if (overlapStart < overlapEnd) {
        maxOverlap = Math.max(maxOverlap, overlapEnd - overlapStart);
      }
    }

    // Lenient threshold for short words (per CONTEXT.md)
    const requiredOverlap = wordDuration < 200 ? 30 : 50;

    if (maxOverlap < requiredOverlap) {
      word.vad_ghost_in_reference = true;
      ghostCount++;
      consecutiveGhosts++;
      maxConsecutive = Math.max(maxConsecutive, consecutiveGhosts);
    } else {
      consecutiveGhosts = 0;
    }
  }

  return {
    ghostCount,
    hasGhostSequence: maxConsecutive >= 5, // Per CONTEXT.md escalation threshold
    vadError: null
  };
}

function parseTimeMs(t) {
  if (typeof t === 'number') return t * 1000;
  return (parseFloat(String(t).replace('s', '')) || 0) * 1000;
}

function isAtAudioEdge(word, audioDurationMs) {
  const EDGE_MS = 300;
  const wordStart = parseTimeMs(word.startTime);
  const wordEnd = parseTimeMs(word.endTime);
  return wordStart < EDGE_MS || wordEnd > audioDurationMs - EDGE_MS;
}
```

### Threshold Presets (Claude's Discretion)
```javascript
// Source: Silero VAD documentation, @ricky0123/vad defaults, CONTEXT.md
// Preset values based on typical noise environments
export const VAD_PRESETS = {
  quietRoom: 0.20,   // Low threshold - detects quiet speech, some false positives in noisy env
  normal: 0.375,     // Default middle - balanced detection
  noisy: 0.50        // High threshold - reduces false positives in noisy environments
};

// Slider range per CONTEXT.md: 0.15 to 0.60
export const VAD_THRESHOLD_MIN = 0.15;
export const VAD_THRESHOLD_MAX = 0.60;
export const VAD_THRESHOLD_DEFAULT = 0.375; // Middle of range
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Server-side VAD | Browser ONNX Runtime | 2023-2024 | Enables client-side processing |
| Silero v4 | Silero v5/v6 | 2025 | 3x faster, 6000+ language support |
| WebGL for ML | WebAssembly/WebGPU | 2024-2025 | More reliable, better performance |
| Fixed VAD threshold | Calibration-based threshold | Current best practice | Adapts to environment noise |

**Deprecated/outdated:**
- Silero v3/v4: Use v5 or later (bundled in @ricky0123/vad-web)
- WebRTC VAD: Lower accuracy than Silero (Silero has 4x fewer errors at same FPR)
- Server-side VAD processing: Adds latency, requires API calls

## Open Questions

Things that couldn't be fully resolved:

1. **Optimal overlap threshold values**
   - What we know: 50ms is standard; short words need leniency
   - What's unclear: Exact values for different word durations
   - Recommendation: Start with 50ms (default) / 30ms (short), tune based on testing

2. **Calibration noise measurement accuracy**
   - What we know: Record silence, find max VAD probability
   - What's unclear: How to get per-frame probabilities from NonRealTimeVAD (it returns segments, not raw probs)
   - Recommendation: Use a very low threshold (0.01) during calibration and count detected segments. If many segments detected during "silence", noise is high.

3. **Non-reference ghost handling (Claude's Discretion)**
   - What we know: CONTEXT.md asks Claude to decide
   - Options: (a) Ignore entirely, (b) Flag but less prominently, (c) Include in count
   - Recommendation: Ignore non-reference ghosts for now - they don't affect alignment accuracy. Focus on `latest_only + IN_REFERENCE` as specified.

4. **Distinguishing "inserted hallucination" from "ghost" (Claude's Discretion)**
   - What we know: Both are ASR errors, but conceptually different
   - What's unclear: Whether distinction matters for teachers
   - Recommendation: Treat both as "vad_ghost_in_reference" - the flag indicates "ASR reported speech but VAD found silence"

## Sources

### Primary (HIGH confidence)
- [@ricky0123/vad-web documentation](https://docs.vad.ricky0123.com/user-guide/api/) - NonRealTimeVAD API, threshold parameters
- [MDN Web Audio API - decodeAudioData](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData) - Audio blob to Float32Array
- [MDN AudioBuffer.getChannelData](https://developer.mozilla.org/en-US/docs/Web/API/AudioBuffer/getChannelData) - Extracting PCM data
- [jsDelivr CDN for onnxruntime-web](https://www.jsdelivr.com/package/npm/onnxruntime-web) - CDN script tags

### Secondary (MEDIUM confidence)
- [Silero VAD GitHub Wiki](https://github.com/snakers4/silero-vad/wiki/Quality-Metrics) - Threshold effects on FPR/TPR
- [@ricky0123/vad algorithm docs](https://docs.vad.ricky0123.com/user-guide/algorithm/) - Frame processing details
- [Silero VAD version history](https://github.com/snakers4/silero-vad/wiki/Version-history-and-Available-Models) - v5/v6 updates

### Tertiary (LOW confidence)
- [VAD threshold calibration patterns](https://community.openai.com/t/how-to-calibrate-activation-threshold-for-server-vad/1266098) - Community approaches
- [Voice Activity Detection best practices](https://picovoice.ai/blog/best-voice-activity-detection-vad-2025/) - Comparison benchmarks

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - @ricky0123/vad-web is well-documented, widely used
- Architecture patterns: HIGH - Follows project conventions, uses documented APIs
- Ghost detection algorithm: MEDIUM - Logic is sound but thresholds need validation
- Calibration approach: MEDIUM - Algorithm clear but per-frame probability access unclear
- Threshold presets: MEDIUM - Based on documentation but environment-dependent

**Research date:** 2026-02-03
**Valid until:** 2026-03-03 (30 days - Silero VAD ecosystem is stable)
