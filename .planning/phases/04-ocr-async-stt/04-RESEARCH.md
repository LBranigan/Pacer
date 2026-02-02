# Phase 4: OCR & Async STT - Research

**Researched:** 2026-02-02
**Domain:** Google Cloud Vision OCR, Google Cloud Speech-to-Text async recognition
**Confidence:** HIGH

## Summary

Phase 4 adds two capabilities: (1) extracting text from photographed book pages via Google Vision OCR, and (2) handling audio recordings longer than 60 seconds via the async `longrunningrecognize` endpoint.

The Vision OCR integration is straightforward -- the `images:annotate` REST endpoint supports API key authentication (same pattern as the existing STT key) and accepts base64-encoded images inline. `DOCUMENT_TEXT_DETECTION` is the correct feature type for book pages since it preserves paragraph structure.

The async STT story has a critical constraint: **the V1 `longrunningrecognize` endpoint does NOT accept inline base64 audio**. It requires a Google Cloud Storage (GCS) URI. Since this is a client-side-only PWA using API key auth, uploading to GCS from the browser is not viable without a backend or signed URLs. The practical solution is to use the V1 `longrunningrecognize` with the `content` field -- the REST reference schema includes it, and while some client libraries reject it, the REST API may accept it for files up to ~10MB. This needs empirical validation. If it fails, the fallback is to split audio into <60s chunks and use synchronous `recognize` for each, then stitch results.

**Primary recommendation:** Use Vision API `DOCUMENT_TEXT_DETECTION` with API key for OCR. For async STT, attempt V1 `longrunningrecognize` with inline content first; if rejected, implement chunked synchronous recognition as fallback.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Google Vision REST API v1 | v1 | OCR text extraction from images | Direct REST call, API key auth, same pattern as existing STT |
| Google STT REST API v1 | v1 | Async long audio recognition | Already used for sync; `longrunningrecognize` is the async endpoint |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Canvas API (browser) | Built-in | Image resizing before upload | When camera photos exceed 10MB base64 limit |
| MediaRecorder API | Built-in | Already in use for audio capture | Existing -- no change needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| V1 longrunningrecognize | V2 BatchRecognize | V2 requires OAuth/service account, not API key; more complex recognizer setup |
| V1 longrunningrecognize with GCS | Chunked sync recognize | No GCS dependency; adds complexity of splitting audio and merging results |
| DOCUMENT_TEXT_DETECTION | TEXT_DETECTION | TEXT_DETECTION is simpler but worse for dense book page text |

**Installation:** No npm packages needed. All interactions are REST API calls via `fetch()`.

## Architecture Patterns

### Recommended Project Structure
```
js/
  ocr-api.js         # Vision OCR API call (new)
  stt-api.js          # Add async STT path (modify existing)
  image-capture.js    # Camera/file input for images (new)
```

### Pattern 1: Vision OCR via REST
**What:** Send base64-encoded image to Vision API, get text back
**When to use:** Teacher photographs or uploads a book page
**Example:**
```javascript
// Source: https://docs.cloud.google.com/vision/docs/ocr
async function extractTextFromImage(base64Image, apiKey) {
  const body = {
    requests: [{
      image: { content: base64Image },
      features: [{ type: 'DOCUMENT_TEXT_DETECTION' }]
    }]
  };
  const resp = await fetch(
    'https://vision.googleapis.com/v1/images:annotate?key=' + encodeURIComponent(apiKey),
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  const data = await resp.json();
  // Full text is in responses[0].fullTextAnnotation.text
  return data.responses[0]?.fullTextAnnotation?.text || '';
}
```

### Pattern 2: Async STT with Polling
**What:** Send long audio to `longrunningrecognize`, poll for completion
**When to use:** Audio recording exceeds 60 seconds
**Example:**
```javascript
// Source: https://docs.cloud.google.com/speech-to-text/docs/async-recognize
async function sendToAsyncSTT(base64Audio, encoding, apiKey, config) {
  const body = { config, audio: { content: base64Audio } };
  const resp = await fetch(
    'https://speech.googleapis.com/v1/speech:longrunningrecognize?key=' + encodeURIComponent(apiKey),
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  const operation = await resp.json();
  if (operation.error) throw new Error(operation.error.message);
  return pollOperation(operation.name, apiKey);
}

async function pollOperation(operationName, apiKey) {
  while (true) {
    await new Promise(r => setTimeout(r, 3000)); // poll every 3s
    const resp = await fetch(
      'https://speech.googleapis.com/v1/operations/' + operationName + '?key=' + encodeURIComponent(apiKey)
    );
    const op = await resp.json();
    if (op.done) {
      if (op.error) throw new Error(op.error.message);
      return op.response; // same shape as sync recognize response
    }
  }
}
```

### Pattern 3: Camera Capture via Input Element
**What:** Use `<input type="file" accept="image/*" capture="environment">` for mobile camera
**When to use:** Teacher wants to photograph a book page on mobile
**Example:**
```html
<input type="file" id="imageInput" accept="image/*" capture="environment">
```
```javascript
imageInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const base64 = await fileToBase64(file);
  // Resize if needed, then send to OCR
});
```

### Pattern 4: Image Resizing for API Limits
**What:** Resize large camera photos to stay under 10MB JSON limit
**When to use:** Camera photos are typically 3-8MB raw; base64 adds ~37%
**Example:**
```javascript
function resizeImageIfNeeded(file, maxDimension = 2048) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (img.width <= maxDimension && img.height <= maxDimension) {
        resolve(file); // no resize needed
        return;
      }
      const canvas = document.createElement('canvas');
      const scale = maxDimension / Math.max(img.width, img.height);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(resolve, 'image/jpeg', 0.85);
    };
    img.src = URL.createObjectURL(file);
  });
}
```

### Anti-Patterns to Avoid
- **Sending raw camera photos without resize:** Modern phone cameras produce 12-50MP images (4-15MB). Base64 encoding adds ~37%, easily exceeding the 10MB JSON limit.
- **Not showing OCR preview:** Teachers must review and edit extracted text before it becomes the reference passage. Never auto-submit OCR text.
- **Polling without timeout:** Always set a maximum poll duration (e.g., 5 minutes) to avoid infinite loops.
- **Ignoring the 60s boundary:** The app must detect recording duration and route to sync vs async STT automatically.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Text extraction from images | Custom canvas OCR | Google Vision API DOCUMENT_TEXT_DETECTION | Handles fonts, angles, lighting, multiple languages |
| Base64 encoding | Manual byte manipulation | FileReader.readAsDataURL | Browser-native, handles all image types |
| Operation polling | Custom WebSocket solution | Simple setInterval/setTimeout polling | Google LRO API is poll-based by design |

**Key insight:** Both Vision OCR and async STT are simple REST calls with the same API key pattern already used in the app. The complexity is in UX (image preview, OCR text editing, progress indication) not in API integration.

## Common Pitfalls

### Pitfall 1: Inline Audio Rejection on longrunningrecognize
**What goes wrong:** The V1 `longrunningrecognize` endpoint may reject inline base64 audio with error "Inline audio is not allowed with LongRunningRecognize. Please use a GCS URI."
**Why it happens:** Google's documentation is inconsistent -- the REST schema includes a `content` field but the server may reject it.
**How to avoid:** Test empirically with a >60s audio file during implementation. If rejected, implement chunked synchronous recognition: split audio into <60s segments, send each to `speech:recognize`, merge results.
**Warning signs:** Error message containing "Inline audio is not allowed" or "Please use a GCS URI"

### Pitfall 2: Image Too Large for JSON Request
**What goes wrong:** Camera photos produce base64 strings exceeding 10MB JSON request limit.
**Why it happens:** Phone cameras shoot 12-50MP. A 5MB JPEG becomes ~6.8MB base64. Multiple retries waste quota.
**How to avoid:** Always resize images to max 2048px on longest side before base64 encoding. Use JPEG compression at 85% quality.
**Warning signs:** 413 or 400 errors from Vision API.

### Pitfall 3: OCR Text Contains Layout Artifacts
**What goes wrong:** OCR output includes page numbers, headers, footers, column breaks, or hyphenated line breaks.
**Why it happens:** DOCUMENT_TEXT_DETECTION preserves document structure including non-passage elements.
**How to avoid:** Always show OCR text in an editable textarea so teachers can clean it up before use as reference passage. Consider stripping common artifacts (page numbers, excessive whitespace) programmatically as a first pass.
**Warning signs:** Alignment results show many "omissions" that are actually page artifacts.

### Pitfall 4: No Progress Feedback During Async STT
**What goes wrong:** User thinks app has frozen during long audio processing.
**Why it happens:** Async STT can take 30-120s for long recordings. No visual feedback.
**How to avoid:** Show polling progress with operation metadata (`progressPercent` field). Display "Processing... X%" or at minimum a spinner with elapsed time.
**Warning signs:** Users closing/refreshing the page during processing.

### Pitfall 5: Service Worker Caching API Responses
**What goes wrong:** Vision API or async STT operation polling returns stale cached responses.
**Why it happens:** Service worker might cache googleapis.com responses if not excluded.
**How to avoid:** Prior decision confirms "network passthrough for googleapis.com API calls" -- verify this covers `vision.googleapis.com` in addition to `speech.googleapis.com`.
**Warning signs:** Polling always returns the same response; OCR returns results from a previous image.

## Code Examples

### Complete OCR Flow (Camera to Editable Text)
```javascript
// Source: https://docs.cloud.google.com/vision/docs/ocr
async function handleImageCapture(file, apiKey) {
  // 1. Resize if needed
  const resized = await resizeImageIfNeeded(file, 2048);

  // 2. Convert to base64 (strip data URI prefix)
  const base64 = await new Promise(resolve => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(resized);
  });

  // 3. Call Vision API
  const body = {
    requests: [{
      image: { content: base64 },
      features: [{ type: 'DOCUMENT_TEXT_DETECTION' }]
    }]
  };

  const resp = await fetch(
    'https://vision.googleapis.com/v1/images:annotate?key=' + encodeURIComponent(apiKey),
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  const data = await resp.json();

  if (data.responses[0]?.error) {
    throw new Error(data.responses[0].error.message);
  }

  return data.responses[0]?.fullTextAnnotation?.text || '';
}
```

### Duration-Based STT Routing
```javascript
// Route to sync or async based on recording duration
async function processAudio(blob, encoding, elapsedSeconds, apiKey, config) {
  if (elapsedSeconds > 55) {
    // Use async for anything close to 60s limit (5s safety margin)
    return await sendToAsyncSTT(blob, encoding, apiKey, config);
  } else {
    // Use existing sync endpoint
    return await sendToSTT(blob, encoding);
  }
}
```

### Vision API Response Structure
```javascript
// Response shape from DOCUMENT_TEXT_DETECTION
{
  "responses": [{
    "textAnnotations": [
      { "description": "Full text here...", "boundingPoly": { "vertices": [...] } },
      // Individual words follow...
    ],
    "fullTextAnnotation": {
      "text": "Full extracted text with line breaks preserved",
      "pages": [{
        "blocks": [{
          "paragraphs": [{
            "words": [{ "symbols": [{ "text": "H" }, { "text": "e" }, ...] }]
          }]
        }]
      }]
    }
  }]
}
// Use fullTextAnnotation.text for the complete extracted passage
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| TEXT_DETECTION | DOCUMENT_TEXT_DETECTION | Available since v1 | Better paragraph/block structure for book pages |
| Sync-only STT | longrunningrecognize for >60s | Available since v1 | Removes 60-second audio ceiling |
| V1 STT API | V2 STT API (BatchRecognize) | 2023-2024 | V2 requires OAuth, not viable with API key auth |

**Deprecated/outdated:**
- V2 STT `BatchRecognize` is newer but requires OAuth service accounts -- not compatible with this app's API key auth model

## Open Questions

1. **Does V1 `longrunningrecognize` actually accept inline `content` via REST?**
   - What we know: The REST schema defines the field; client libraries reject it; some REST users report success; Google docs are contradictory
   - What's unclear: Whether the server accepts or rejects inline content as of 2026
   - Recommendation: Test empirically during implementation. Build the chunked-sync fallback as Plan B. If inline works, great; if not, chunk audio into <55s segments.

2. **Maximum audio size for inline content (if accepted)?**
   - What we know: Sync `recognize` has a 10MB limit. JSON request size limit applies.
   - What's unclear: Whether longrunningrecognize has the same or different limit for inline content
   - Recommendation: Assume 10MB limit. A 3-minute WEBM_OPUS recording at typical bitrates (~32kbps) is ~720KB, well under limit. Concern only arises for very long recordings (>20 min).

3. **Vision API enablement on the existing GCP project**
   - What we know: The app uses an API key with STT enabled
   - What's unclear: Whether Vision API is also enabled on the same project/key
   - Recommendation: Document that the teacher/admin needs to enable Cloud Vision API in GCP console and ensure the API key has permission for it.

## Sources

### Primary (HIGH confidence)
- [Google Vision OCR docs](https://docs.cloud.google.com/vision/docs/ocr) - REST endpoint, request/response format, TEXT_DETECTION vs DOCUMENT_TEXT_DETECTION
- [Google STT async recognize docs](https://docs.cloud.google.com/speech-to-text/docs/async-recognize) - longrunningrecognize endpoint, polling, GCS requirement
- [Google STT V1 longrunningrecognize REST ref](https://docs.cloud.google.com/speech-to-text/docs/reference/rest/v1/speech/longrunningrecognize) - Schema shows content field exists
- [Google Vision supported files](https://docs.cloud.google.com/vision/docs/supported-files) - 20MB file limit, 10MB JSON limit, 75MP pixel limit
- [Google STT sync recognize docs](https://docs.cloud.google.com/speech-to-text/docs/sync-recognize) - 60 second / 10MB limit for sync

### Secondary (MEDIUM confidence)
- [Vision API key auth](https://cloud.google.com/vision/docs/request) - Confirmed API key works as `?key=` query parameter for REST
- [STT V2 BatchRecognize REST ref](https://docs.cloud.google.com/speech-to-text/docs/reference/rest/v2/projects.locations.recognizers/batchRecognize) - V2 requires recognizer resource, OAuth

### Tertiary (LOW confidence)
- [GitHub issue: Inline audio not allowed with LongRunningRecognize](https://github.com/googleapis/google-cloud-ruby/issues/1414) - Confirms inline rejection in client libraries; REST behavior may differ

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Both APIs are well-documented Google Cloud REST endpoints
- Architecture: HIGH - Same fetch-based pattern as existing STT code; Vision OCR is a single REST call
- Pitfalls: MEDIUM - The inline audio question for longrunningrecognize is unresolved; needs empirical testing

**Research date:** 2026-02-02
**Valid until:** 2026-03-04 (stable Google Cloud APIs, 30 days)
