# Phase 22: Cross-Vendor Validation - Research

**Researched:** 2026-02-05
**Domain:** Deepgram Nova-3 API for cross-vendor ASR validation
**Confidence:** HIGH

## Summary

This phase integrates Deepgram Nova-3 as a cross-validation source to catch Reverb hallucinations. Nova-3 uses a pure Transformer architecture (Acoustic Transformer + Language Transformer) which is architecturally decorrelated from Reverb's CTC/Attention hybrid. Words present in Reverb but absent in Nova-3 can be flagged as "unconfirmed" while words present in both gain higher confidence.

**Critical finding:** Deepgram's REST API does not support CORS for browser-based requests. The API returns `Access-Control-Allow-Origin` errors when called directly from browser JavaScript. This is an intentional design decision by Deepgram to protect API keys.

**Solution:** Leverage the existing Phase 20 backend service pattern. Add a `/deepgram` endpoint to the `services/reverb/server.py` that proxies Deepgram API calls. This keeps the browser integration pattern consistent (browser -> backend -> external API) and reuses established CORS/infrastructure.

**Primary recommendation:** Add a `/deepgram` endpoint to the existing Reverb backend service that accepts base64 audio and returns normalized word-level timestamps from Nova-3.

## Standard Stack

The established libraries/tools for this domain:

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| deepgram-sdk | >=3.0.0 | Python SDK for Deepgram API | Official SDK, handles auth, retries, response parsing |
| httpx | >=0.25.0 | Async HTTP client | Included with deepgram-sdk; async-native |
| Python | 3.10+ | Runtime | Already established in Phase 20 |

### Browser Client

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Native fetch | Browser built-in | HTTP calls to backend | No external dependencies; consistent with project pattern |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pydantic | >=2.0 | Request/response validation | Already in FastAPI service |

### Alternatives Considered

| Recommended | Could Use | Tradeoff |
|-------------|-----------|----------|
| Backend proxy | Direct browser call | Direct call impossible (no CORS support) |
| Backend proxy | Temporary tokens + WebSocket | WebSocket only for live streaming; pre-recorded needs REST |
| Python SDK | Raw REST calls | SDK handles auth, retries, response parsing |
| Add to existing service | Separate Deepgram service | Additional container overhead; one service simpler |

**Installation:**

```bash
# Add to services/reverb/requirements.txt
deepgram-sdk>=3.0.0
```

## Architecture Patterns

### Recommended Integration Point

The existing Reverb service (`services/reverb/server.py`) should be extended with a `/deepgram` endpoint:

```
Browser (js/deepgram-api.js)
    |
    |-- POST /deepgram (base64 audio)
    v
services/reverb/server.py
    |
    |-- Deepgram SDK call
    v
api.deepgram.com/v1/listen
    |
    |-- Response with words[]
    v
Normalize to project format
    |
    v
Return to browser
```

### Pattern 1: Backend Proxy for Deepgram

**What:** Add endpoint to existing backend that proxies Deepgram calls
**When to use:** Any external API that doesn't support CORS
**Example:**
```python
# Source: Deepgram Python SDK documentation
from deepgram import DeepgramClient, PrerecordedOptions
import os

# Initialize once at module level
deepgram_client = None

def get_deepgram_client():
    global deepgram_client
    if deepgram_client is None:
        api_key = os.environ.get("DEEPGRAM_API_KEY")
        if not api_key:
            raise RuntimeError("DEEPGRAM_API_KEY environment variable not set")
        deepgram_client = DeepgramClient(api_key)
    return deepgram_client

@app.post("/deepgram")
async def deepgram_transcribe(req: AudioRequest):
    client = get_deepgram_client()

    audio_bytes = base64.b64decode(req.audio_base64)

    options = PrerecordedOptions(
        model="nova-3",
        language="en-US",
        smart_format=True,  # Better punctuation/capitalization
    )

    response = client.listen.rest.v("1").transcribe_file(
        {"buffer": audio_bytes, "mimetype": "audio/wav"},
        options
    )

    # Normalize to project format
    words = []
    for word_data in response.results.channels[0].alternatives[0].words:
        words.append({
            "word": word_data.punctuated_word or word_data.word,
            "startTime": str(word_data.start) + "s",  # Match Google format
            "endTime": str(word_data.end) + "s",
            "confidence": word_data.confidence
        })

    return {
        "words": words,
        "transcript": response.results.channels[0].alternatives[0].transcript
    }
```

### Pattern 2: Browser Client Module

**What:** JavaScript module that calls backend, not Deepgram directly
**When to use:** Browser-based application needing Deepgram
**Example:**
```javascript
// js/deepgram-api.js
// Source: Project pattern from stt-api.js

const DEEPGRAM_BACKEND_URL = 'http://localhost:8765/deepgram';

/**
 * Send audio to Deepgram Nova-3 via backend proxy.
 * @param {Blob} blob - Audio blob
 * @returns {Promise<object>} Response with words array
 */
export async function sendToDeepgram(blob) {
    const base64 = await blobToBase64(blob);

    try {
        const resp = await fetch(DEEPGRAM_BACKEND_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audio_base64: base64 })
        });

        if (!resp.ok) {
            throw new Error(`Deepgram backend error: ${resp.status}`);
        }

        return await resp.json();
    } catch (e) {
        console.warn('[deepgram-api] Service unavailable:', e.message);
        return null;  // Graceful degradation
    }
}
```

### Pattern 3: Cross-Validation Merger

**What:** Compare Reverb and Deepgram outputs, flag disagreements
**When to use:** Implementing XVAL-02 (disagreement flagging)
**Example:**
```javascript
// Source: Project ensemble-merger.js pattern

/**
 * Cross-validate Reverb transcript against Deepgram.
 * @param {Array} reverbWords - Words from Reverb ensemble
 * @param {Array} deepgramWords - Words from Deepgram Nova-3
 * @returns {Array} Reverb words annotated with crossValidation flag
 */
export function crossValidateWithDeepgram(reverbWords, deepgramWords) {
    // Build Deepgram word set for O(1) lookup
    const dgWordSet = new Set(
        deepgramWords.map(w => normalizeWord(w.word))
    );

    return reverbWords.map(word => {
        const normalized = normalizeWord(word.word);
        const inDeepgram = dgWordSet.has(normalized);

        return {
            ...word,
            crossValidation: inDeepgram ? 'confirmed' : 'unconfirmed'
        };
    });
}
```

### Anti-Patterns to Avoid

- **Calling Deepgram REST API directly from browser:** Will fail with CORS error. Always use backend proxy.
- **Exposing Deepgram API key in browser code:** Security violation. Key must stay server-side.
- **Using WebSocket for pre-recorded audio:** WebSocket is for live streaming only; use REST for pre-recorded.
- **Blocking on Deepgram when Reverb succeeds:** Deepgram is cross-validation, not primary. If it fails, proceed with Reverb-only results.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Deepgram API calls | Raw HTTP requests | deepgram-sdk | Handles auth, retries, response parsing |
| Backend proxy | New service | Existing Reverb service | Reuse infrastructure, CORS already configured |
| Word normalization | New function | Existing normalizeWord() | Consistent with ensemble-merger.js |
| Fallback logic | Per-call handling | Service availability pattern | Established in project |

**Key insight:** This phase adds one endpoint to existing backend + one client module. No new infrastructure needed.

## Common Pitfalls

### Pitfall 1: CORS Blocking Direct Browser Calls (CRITICAL)

**What goes wrong:** Developer attempts to call Deepgram REST API directly from browser JavaScript, gets CORS policy error.

**Why it happens:**
- Deepgram intentionally does not support CORS on REST endpoints
- This is a security measure to protect API keys
- Temporary tokens only work with WebSocket (live streaming), not REST (pre-recorded)

**How to avoid:**
1. Use backend proxy pattern (add to existing Reverb service)
2. Store Deepgram API key as environment variable in Docker
3. Browser calls backend, backend calls Deepgram

**Warning signs:**
- `Access-Control-Allow-Origin` errors in browser console
- Code works in Node.js but fails in browser
- Deepgram SDK works but fetch doesn't

### Pitfall 2: API Key Exposure (CRITICAL)

**What goes wrong:** Deepgram API key ends up in browser-accessible code (JS file, localStorage, DOM).

**Why it happens:**
- Following patterns from Google Cloud API (which uses URL params)
- Not understanding backend proxy requirement
- Developer convenience during testing

**How to avoid:**
1. Store key ONLY in backend environment variable
2. Add `DEEPGRAM_API_KEY` to docker-compose environment section
3. Never pass key to browser; browser calls backend without key

**Warning signs:**
- API key visible in browser Network tab
- Key in git-tracked files
- Key in localStorage or sessionStorage

### Pitfall 3: Treating Deepgram as Primary Source (MODERATE)

**What goes wrong:** Code blocks or fails when Deepgram is unavailable, even though Reverb succeeded.

**Why it happens:**
- Not implementing graceful fallback
- Awaiting Deepgram synchronously in critical path
- Over-relying on cross-validation

**How to avoid:**
1. Call Deepgram in parallel with Reverb, don't block on it
2. If Deepgram fails, proceed with Reverb-only results
3. Log warning but don't throw error
4. Flag all words as `crossValidation: 'unavailable'` if service down

**Warning signs:**
- Errors when Deepgram rate-limited or down
- Slow processing waiting for Deepgram timeout
- Users can't complete assessment during Deepgram outages

### Pitfall 4: Word Matching False Positives/Negatives (MODERATE)

**What goes wrong:** Cross-validation flags correct words as "unconfirmed" or misses hallucinations.

**Why it happens:**
- Different punctuation between models ("don't" vs "dont")
- Different capitalization
- Timestamp misalignment causing word order issues
- Contractions handled differently

**How to avoid:**
1. Normalize words before comparison (lowercase, strip punctuation)
2. Use existing `normalizeWord()` function from ensemble-merger.js
3. Consider fuzzy matching for near-matches
4. Weight by timestamp proximity, not just text match

**Warning signs:**
- Common words flagged as "unconfirmed"
- Obvious hallucinations not caught
- Many false positives on contractions

## Code Examples

Verified patterns from official documentation:

### Backend Endpoint (Add to server.py)

```python
# Source: Deepgram Python SDK documentation + project patterns
from deepgram import DeepgramClient, PrerecordedOptions
import os

# Add to existing server.py

deepgram_client = None

def get_deepgram_client():
    """Lazy-initialize Deepgram client."""
    global deepgram_client
    if deepgram_client is None:
        api_key = os.environ.get("DEEPGRAM_API_KEY")
        if not api_key:
            # Return None instead of raising - allows graceful degradation
            return None
        deepgram_client = DeepgramClient(api_key)
    return deepgram_client

class DeepgramRequest(BaseModel):
    audio_base64: str

@app.post("/deepgram")
async def deepgram_transcribe(req: DeepgramRequest):
    """
    Transcribe audio using Deepgram Nova-3.
    Returns normalized word-level timestamps matching project format.
    """
    client = get_deepgram_client()
    if client is None:
        raise HTTPException(
            status_code=503,
            detail="Deepgram service not configured (missing API key)"
        )

    try:
        audio_bytes = base64.b64decode(req.audio_base64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid base64: {e}")

    try:
        options = PrerecordedOptions(
            model="nova-3",
            language="en-US",
            smart_format=True,
        )

        response = client.listen.rest.v("1").transcribe_file(
            {"buffer": audio_bytes, "mimetype": "audio/wav"},
            options
        )

        # Normalize to project format (matching Google STT structure)
        words = []
        for word_data in response.results.channels[0].alternatives[0].words:
            words.append({
                "word": word_data.punctuated_word or word_data.word,
                "startTime": f"{word_data.start}s",
                "endTime": f"{word_data.end}s",
                "confidence": word_data.confidence
            })

        return {
            "words": words,
            "transcript": response.results.channels[0].alternatives[0].transcript,
            "model": "nova-3"
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Deepgram error: {e}")
```

### Browser Client Module

```javascript
// js/deepgram-api.js
// Source: Project pattern established in stt-api.js

/**
 * Deepgram Nova-3 API client via backend proxy.
 *
 * IMPORTANT: Does NOT call Deepgram directly (no CORS support).
 * Calls backend service which proxies to Deepgram.
 */

const DEEPGRAM_BACKEND_URL = 'http://localhost:8765/deepgram';

/**
 * Convert blob to base64.
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
function blobToBase64(blob) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(blob);
    });
}

/**
 * Check if Deepgram service is available.
 * @returns {Promise<boolean>}
 */
export async function isDeepgramAvailable() {
    try {
        const resp = await fetch('http://localhost:8765/health', {
            method: 'GET',
            signal: AbortSignal.timeout(2000)
        });
        const data = await resp.json();
        return data.deepgram_configured === true;
    } catch {
        return false;
    }
}

/**
 * Send audio to Deepgram Nova-3 via backend proxy.
 * Returns null on failure (graceful degradation).
 *
 * @param {Blob} blob - Audio blob (WAV, WebM, etc.)
 * @returns {Promise<object|null>} Response with words array, or null if unavailable
 */
export async function sendToDeepgram(blob) {
    try {
        const base64 = await blobToBase64(blob);

        const resp = await fetch(DEEPGRAM_BACKEND_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audio_base64: base64 }),
            signal: AbortSignal.timeout(30000)  // 30s timeout
        });

        if (!resp.ok) {
            console.warn(`[deepgram-api] Backend returned ${resp.status}`);
            return null;
        }

        return await resp.json();
    } catch (e) {
        console.warn('[deepgram-api] Service unavailable:', e.message);
        return null;  // Graceful fallback - cross-validation optional
    }
}

/**
 * Extract words array from Deepgram response in normalized format.
 * @param {object} deepgramResponse
 * @returns {Array} Words matching ensemble-merger format
 */
export function extractWordsFromDeepgram(deepgramResponse) {
    if (!deepgramResponse || !deepgramResponse.words) return [];
    return deepgramResponse.words;
}
```

### docker-compose.yml Update

```yaml
# Source: Project Phase 20 pattern
# Add to services/reverb/docker-compose.yml environment section

services:
  reverb:
    # ... existing config ...
    environment:
      - PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
      - DEEPGRAM_API_KEY=${DEEPGRAM_API_KEY}  # From host environment or .env
```

### Key File Pattern

```
# keys/deepgram-api-key.txt
# Store Deepgram API key here (gitignored)
# Load via: export DEEPGRAM_API_KEY=$(cat keys/deepgram-api-key.txt)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Direct browser REST calls | Backend proxy required | Always (by design) | Deepgram intentionally blocks CORS |
| Nova-2 model | Nova-3 model | 2025 | Better accuracy, word timestamps |
| deepgram-sdk v2 | deepgram-sdk v3 | 2024 | New API structure, async support |

**Deprecated/outdated:**
- Nova-1: Use Nova-3 for best accuracy
- deepgram-sdk v2: Use v3 for current API compatibility

## Deepgram Nova-3 Technical Details

### Architecture

Nova-3 uses a Transformer-based architecture with:
- **Embedding Encoder:** Compresses raw waveforms into latent space
- **Acoustic Transformer:** Encodes input audio into embeddings
- **Language Transformer (Transformer-XL style):** Decodes embeddings to text with long-range context

This is architecturally different from Reverb's CTC/Attention hybrid, providing decorrelated errors for cross-validation.

### Response Format

```json
{
  "results": {
    "channels": [{
      "alternatives": [{
        "transcript": "the quick brown fox",
        "words": [
          {
            "word": "the",
            "start": 0.08,
            "end": 0.24,
            "confidence": 0.9975,
            "punctuated_word": "The"
          },
          // ...
        ]
      }]
    }]
  }
}
```

Word-level data includes:
- `word`: Raw word text
- `start`/`end`: Timestamps in seconds (float)
- `confidence`: 0.0-1.0 reliability score
- `punctuated_word`: Word with smart formatting applied

### API Limits

- Maximum file size: 2 GB
- Concurrent requests: 100 (free tier), 15 (paid), 5 (PAYG)
- Rate limit exceeded returns 429 error

## Open Questions

Things that couldn't be fully resolved:

1. **Nova-3 accuracy on children's speech**
   - What we know: Trained on general speech, not child-specific
   - What's unclear: Performance gap vs adult speech
   - Recommendation: Same A/B testing phase as Reverb (Phase 20)

2. **Optimal cross-validation threshold**
   - What we know: Words can be "confirmed" or "unconfirmed"
   - What's unclear: Should near-matches (phonetic similarity) count?
   - Recommendation: Start with exact match; add fuzzy matching if needed

3. **Timestamp alignment between Reverb and Deepgram**
   - What we know: Both provide word-level timestamps
   - What's unclear: How aligned are they for same audio?
   - Recommendation: Use word text for validation, not timestamps

## Sources

### Primary (HIGH confidence)

- [Deepgram Pre-Recorded Documentation](https://developers.deepgram.com/docs/getting-started-with-pre-recorded-audio) - API usage, response format
- [Deepgram Word Timestamps Article](https://deepgram.com/learn/working-with-timestamps-utterances-and-speaker-diarization-in-deepgram) - JSON structure verified
- [Deepgram Token-Based Auth](https://developers.deepgram.com/guides/fundamentals/token-based-authentication) - Token limitations confirmed
- [Deepgram JavaScript SDK GitHub](https://github.com/deepgram/deepgram-js-sdk) - CORS proxy requirement documented
- [Deepgram API Key Security](https://deepgram.com/learn/protecting-api-key) - Best practices verified

### Secondary (MEDIUM confidence)

- [Nova-3 Introduction](https://deepgram.com/learn/introducing-nova-3-speech-to-text-api) - Architecture overview
- [Deepgram GitHub Discussions #686](https://github.com/orgs/deepgram/discussions/686) - CORS error details
- [Deepgram SDK v3 Article](https://deepgram.com/learn/upgraded-the-deepgram-javascript-sdk-v3) - Proxy configuration

### Tertiary (LOW confidence)

- Nova-3 performance on children's speech - No published benchmarks found
- Deepgram/Reverb timestamp alignment - Requires empirical testing

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Official SDK documented, patterns verified
- Architecture: HIGH - CORS limitation confirmed by multiple sources
- Pitfalls: HIGH - CORS issue is definitive; security patterns well-documented

**Research date:** 2026-02-05
**Valid until:** ~60 days (API stable, no breaking changes expected)
