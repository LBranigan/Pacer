# Phase 11: Ensemble Core - Research

**Researched:** 2026-02-03
**Domain:** Multi-model ASR ensemble with temporal word association
**Confidence:** HIGH (for core patterns), MEDIUM (for jitter tolerance specifics)

## Summary

This phase implements a two-model ASR ensemble using Google Cloud STT's `latest_long` and `default` models in parallel. The core challenge is not just running parallel API calls, but associating words from both transcripts by their temporal overlap rather than text matching (since stutters and disfluencies break text-based alignment).

The standard approach for ASR ensemble is ROVER (Recognizer Output Voting Error Reduction), but ROVER uses text-based dynamic programming alignment. Our requirements specify temporal word association with a 50ms jitter tolerance, which is simpler and more appropriate for our two-model case with unreliable confidence from `latest_long`.

**Primary recommendation:** Use `Promise.allSettled` for parallel API calls, implement a simple interval overlap algorithm for temporal word association, and structure the merged result to preserve both model outputs in a `_debug` property for transparency.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Native JS `Promise.allSettled` | ES2020+ | Parallel API calls | Returns all results even if one fails; standard browser API |
| Native interval arithmetic | N/A | Temporal word overlap | Simple overlap detection: `max(start1, start2) < min(end1, end2)` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `getDefaultModelConfig` | Phase 10 | Default model STT config | Already exported in `stt-api.js` |
| `buildSTTConfig` | Existing | Latest_long model STT config | Already used in `sendToSTT` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `Promise.allSettled` | `Promise.all` | `Promise.all` fails fast on first rejection; we want both results even if one model fails |
| Temporal overlap | ROVER (DP alignment) | ROVER is text-based and complex; temporal is specified in requirements and handles stutters |
| Custom interval tree | Simple O(n*m) scan | For ~200 words, O(n*m) is fast enough; trees add complexity |

**Installation:**
No additional dependencies needed - all native JavaScript.

## Architecture Patterns

### Recommended Project Structure
```
js/
  stt-api.js           # Add sendEnsembleSTT(), parallel call logic
  ensemble-merger.js   # NEW: Temporal word association + merge logic
  app.js               # Update to use ensemble flow
```

### Pattern 1: Parallel STT Calls with Promise.allSettled
**What:** Fire both API calls simultaneously, wait for both to complete
**When to use:** Every assessment (required by ENS-01)
**Example:**
```javascript
// Source: MDN Promise.allSettled documentation
async function sendEnsembleSTT(blob, encoding) {
  const apiKey = document.getElementById('apiKey').value.trim();
  const passageText = document.getElementById('transcript').value.trim();
  const base64 = await blobToBase64(blob);

  const latestLongConfig = buildSTTConfig(encoding);
  const defaultConfig = getDefaultModelConfig(encoding, passageText);

  const [latestResult, defaultResult] = await Promise.allSettled([
    fetchSTT(base64, latestLongConfig, apiKey),
    fetchSTT(base64, defaultConfig, apiKey)
  ]);

  return {
    latestLong: latestResult.status === 'fulfilled' ? latestResult.value : null,
    default: defaultResult.status === 'fulfilled' ? defaultResult.value : null,
    errors: {
      latestLong: latestResult.status === 'rejected' ? latestResult.reason : null,
      default: defaultResult.status === 'rejected' ? defaultResult.reason : null
    }
  };
}
```

### Pattern 2: Temporal Word Association (Interval Overlap)
**What:** Match words from two transcripts by timestamp overlap, not text content
**When to use:** Merging ensemble results (required by ENS-02)
**Example:**
```javascript
// Source: Standard interval overlap detection
function timeOverlap(word1, word2, jitterMs = 50) {
  // Parse timestamps (Google returns "1.400s" format)
  const parseTime = (t) => (parseFloat(String(t).replace('s', '')) || 0) * 1000; // to ms

  const start1 = parseTime(word1.startTime);
  const end1 = parseTime(word1.endTime);
  const start2 = parseTime(word2.startTime);
  const end2 = parseTime(word2.endTime);

  // Apply asymmetric jitter: expand word2's window by jitterMs
  // (handles CTC vs Conformer drift - latest_long may be ahead)
  const adjustedStart2 = start2 - jitterMs;
  const adjustedEnd2 = end2 + jitterMs;

  // Overlap exists if: max(start1, start2) < min(end1, end2)
  const overlapStart = Math.max(start1, adjustedStart2);
  const overlapEnd = Math.min(end1, adjustedEnd2);

  return overlapStart < overlapEnd;
}
```

### Pattern 3: Merged Word Structure with Debug Data
**What:** Output structure that preserves both model results
**When to use:** Final merged transcript (required by ENS-03, ENS-04)
**Example:**
```javascript
// Source: Project requirement ENS-04
function createMergedWord(latestWord, defaultWord) {
  // Determine source tag
  let source;
  if (latestWord && defaultWord) {
    source = 'both';
  } else if (latestWord) {
    source = 'latest_only';
  } else {
    source = 'default_only';
  }

  // Primary word comes from latest_long when available (better for rare words)
  const primary = latestWord || defaultWord;

  return {
    word: primary.word,
    startTime: primary.startTime,
    endTime: primary.endTime,
    confidence: primary.confidence,
    source: source,
    _debug: {
      latestLong: latestWord ? {
        word: latestWord.word,
        startTime: latestWord.startTime,
        endTime: latestWord.endTime,
        confidence: latestWord.confidence
      } : null,
      default: defaultWord ? {
        word: defaultWord.word,
        startTime: defaultWord.startTime,
        endTime: defaultWord.endTime,
        confidence: defaultWord.confidence
      } : null
    }
  };
}
```

### Anti-Patterns to Avoid
- **Text-based alignment for ensemble merging:** Stutters produce "th-th-the" which won't match "the" from another model. Use temporal overlap.
- **Promise.all for parallel calls:** If one model fails (rate limit, timeout), both results are lost. Use `Promise.allSettled`.
- **Trusting latest_long confidence scores:** Google docs explicitly say these are "not truly confidence scores." Use default model's confidence when available.
- **Single jitter value applied symmetrically:** CTC (default) and Conformer (latest_long) have different timestamp characteristics. Apply asymmetric tolerance.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parallel async calls | Manual callback tracking | `Promise.allSettled` | Handles failures gracefully, standard API |
| STT config for default model | Copy-paste buildSTTConfig | `getDefaultModelConfig` | Already exported in Phase 10, has correct boost values |
| Timestamp parsing | Custom regex | `parseFloat(str.replace('s',''))` | Google's format is consistent: "1.400s" |

**Key insight:** The temporal word association is simple enough to implement directly. ROVER is overkill for two transcripts when we have timestamps, and it doesn't handle our stutter problem.

## Common Pitfalls

### Pitfall 1: API Latency Doubling
**What goes wrong:** Two sequential API calls take 2x time
**Why it happens:** Developer uses `await sendToSTT(...)` then `await sendToDefault(...)`
**How to avoid:** Always fire both calls in parallel with `Promise.allSettled`
**Warning signs:** Assessment time doubles compared to single-model

### Pitfall 2: Confidence Score Misuse from latest_long
**What goes wrong:** Using `latest_long` confidence to filter/weight words
**Why it happens:** The API returns a confidence value, so it's tempting to use it
**How to avoid:** Google docs state these are "not truly confidence scores." Only trust `default` model's confidence.
**Warning signs:** Unexpected word filtering behavior

### Pitfall 3: Timestamp Format Inconsistency
**What goes wrong:** Comparison fails due to "1.4s" vs 1400 (ms) mismatch
**Why it happens:** Mixing string timestamps with numeric milliseconds
**How to avoid:** Normalize all timestamps to milliseconds at parse time
**Warning signs:** No words matching despite obvious overlap

### Pitfall 4: Symmetric Jitter Application
**What goes wrong:** Words that should match don't, or false matches occur
**Why it happens:** Applying same tolerance to both directions when models have systematic drift
**How to avoid:** Apply jitter asymmetrically - expand the `default` model window since `latest_long` (Conformer) tends to report earlier timestamps
**Warning signs:** Systematic missed matches at word boundaries

### Pitfall 5: Losing Single-Model Results
**What goes wrong:** If one model returns no words (silence, very short audio), entire ensemble fails
**Why it happens:** Code assumes both models always return words
**How to avoid:** Handle null/empty results gracefully; fall back to whichever model has data
**Warning signs:** Empty results for short recordings

## Code Examples

Verified patterns from official sources and project requirements:

### Parallel STT Call Pattern
```javascript
// Source: MDN Promise.allSettled, project stt-api.js pattern
async function sendEnsembleSTT(blob, encoding) {
  const apiKey = document.getElementById('apiKey').value.trim();
  if (!apiKey) return { error: 'No API key' };

  const passageText = document.getElementById('transcript').value.trim();
  const base64 = await blobToBase64(blob);

  // Build configs for both models (Phase 10 prepared getDefaultModelConfig)
  const latestConfig = buildSTTConfig(encoding);
  const defaultConfig = getDefaultModelConfig(encoding, passageText);

  // Fire both in parallel
  const [latestResult, defaultResult] = await Promise.allSettled([
    fetch('https://speech.googleapis.com/v1/speech:recognize?key=' + encodeURIComponent(apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: latestConfig, audio: { content: base64 } })
    }).then(r => r.json()),
    fetch('https://speech.googleapis.com/v1/speech:recognize?key=' + encodeURIComponent(apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: defaultConfig, audio: { content: base64 } })
    }).then(r => r.json())
  ]);

  return {
    latestLong: latestResult.status === 'fulfilled' ? latestResult.value : null,
    default: defaultResult.status === 'fulfilled' ? defaultResult.value : null
  };
}
```

### Temporal Association Algorithm
```javascript
// Source: Project requirements ENS-02, ENS-03
const JITTER_MS = 50; // Per STATE.md decision

function associateWordsByTime(latestWords, defaultWords) {
  const merged = [];
  const usedDefault = new Set();

  // For each latest_long word, find overlapping default word
  for (const lw of latestWords) {
    let matchedDefault = null;

    for (let i = 0; i < defaultWords.length; i++) {
      if (usedDefault.has(i)) continue;

      if (timeOverlap(lw, defaultWords[i], JITTER_MS)) {
        matchedDefault = defaultWords[i];
        usedDefault.add(i);
        break; // Take first match (words are time-ordered)
      }
    }

    merged.push(createMergedWord(lw, matchedDefault));
  }

  // Add any unmatched default words (default_only)
  for (let i = 0; i < defaultWords.length; i++) {
    if (!usedDefault.has(i)) {
      merged.push(createMergedWord(null, defaultWords[i]));
    }
  }

  // Sort by timestamp
  merged.sort((a, b) => {
    const parseTime = (t) => parseFloat(String(t).replace('s', '')) || 0;
    return parseTime(a.startTime) - parseTime(b.startTime);
  });

  return merged;
}
```

### Extracting Words from STT Response
```javascript
// Source: Existing app.js pattern (lines 149-157)
function extractWords(sttResponse) {
  if (!sttResponse || !sttResponse.results) return [];

  const words = [];
  for (const result of sttResponse.results) {
    const alt = result.alternatives && result.alternatives[0];
    if (alt && alt.words) {
      for (const w of alt.words) {
        words.push(w);
      }
    }
  }
  return words;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single STT model | Multi-model ensemble | 2024-2025 | Better accuracy via model complementarity |
| ROVER text alignment | Temporal word association | Our project | Handles stutters/disfluencies correctly |
| Trust confidence scores | Model-aware confidence | Now | latest_long confidence unreliable per Google docs |

**Deprecated/outdated:**
- Using `Promise.all` for fault-tolerant parallel calls: Use `Promise.allSettled` instead (ES2020+)
- Uniform phrase boosting: Phase 10 implemented tiered boosting

## Open Questions

Things that couldn't be fully resolved:

1. **Optimal jitter tolerance value**
   - What we know: STATE.md specifies 50ms; Google timestamps have 100ms precision
   - What's unclear: Whether 50ms is optimal or needs empirical tuning
   - Recommendation: Start with 50ms, add instrumentation to measure match rates

2. **Asymmetric jitter direction**
   - What we know: CTC (default) and Conformer (latest_long) have different timestamp characteristics
   - What's unclear: Which model tends to report earlier/later timestamps
   - Recommendation: Apply symmetric ±50ms initially, analyze in diagnostics, tune if needed

3. **Handling async/chunked paths**
   - What we know: App has sendToAsyncSTT and sendChunkedSTT for long audio
   - What's unclear: Should ensemble apply to async path? (doubles API calls)
   - Recommendation: Start with sync path only (<60s), extend to async if needed

## Sources

### Primary (HIGH confidence)
- [Google Cloud STT Word Timestamps](https://docs.cloud.google.com/speech-to-text/docs/v1/async-time-offsets) - Timestamp format: "1.400s", 100ms precision
- [Google Cloud Latest Models](https://docs.cloud.google.com/speech-to-text/docs/v1/latest-models) - Confidence scores "not truly confidence scores"
- [MDN Promise.allSettled](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all) - Returns all results even on rejection
- Project `stt-api.js` - Existing STT patterns, `getDefaultModelConfig` export

### Secondary (MEDIUM confidence)
- [ROVER Algorithm (NIST)](https://github.com/usnistgov/SCTK/blob/master/doc/rover/rover.htm) - Standard ASR ensemble approach (text-based, not used)
- [Interval Overlap Algorithm](https://www.slingacademy.com/article/javascript-how-to-check-if-2-date-ranges-overlap/) - `max(start1, start2) < min(end1, end2)`

### Tertiary (LOW confidence)
- [Web Search: CTC vs Conformer timestamps](https://arxiv.org/html/2510.12827v1) - General architecture differences, no specific drift data

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Native JS, no dependencies
- Architecture patterns: HIGH - Follows project conventions, uses Phase 10 exports
- Temporal algorithm: HIGH - Simple interval math, well-understood
- Jitter tolerance: MEDIUM - 50ms per STATE.md, may need empirical validation
- Async path handling: LOW - Not yet determined

**Research date:** 2026-02-03
**Valid until:** 2026-03-03 (30 days - stable domain, no fast-moving dependencies)
