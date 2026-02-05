# Reverb ASR Integration Proposal

**Date:** 2026-02-04
**Status:** Research Complete - Ready for Implementation
**Objective:** Replace Google STT ensemble with Rev.ai Reverb ASR using dual verbatimicity passes

---

## Executive Summary

This proposal details how to integrate Reverb ASR alongside your existing Google STT ensemble, enabling side-by-side comparison before making a permanent switch.

**Key insight:** Reverb's verbatimicity parameter (0.0-1.0) provides genuine complementary outputs from a single model - verbatim captures repetitions/stutters while clean removes them. This is cleaner than your current two-model Google ensemble.

---

## Architecture Overview

### Current Architecture (Google Ensemble)
```
Browser Audio → Base64 → Google Cloud API
                              ↓
                    ┌─────────────────────┐
                    │  Promise.allSettled │
                    └─────────────────────┘
                         ↙         ↘
              latest_long          default
              (vocabulary)      (timestamps/conf)
                         ↘         ↙
                    ┌─────────────────────┐
                    │  ensemble-merger.js │
                    │  (two-pass align)   │
                    └─────────────────────┘
                              ↓
                       Merged words
```

### Proposed Architecture (Reverb Ensemble)
```
Browser Audio → Base64 → Local Reverb Service (Python)
                              ↓
                    ┌─────────────────────┐
                    │  Two sequential     │
                    │  transcriptions     │
                    └─────────────────────┘
                         ↙         ↘
            verbatimicity=1.0    verbatimicity=0.0
              (repetitions,        (clean, no
               stutters, ums)      disfluencies)
                         ↘         ↙
                    ┌─────────────────────┐
                    │  reverb-merger.js   │
                    │  (diff-based align) │
                    └─────────────────────┘
                              ↓
                       Merged words
```

---

## Component Design

### Component 1: Reverb ASR Backend Service

**Purpose:** Run Reverb model and expose HTTP API for browser consumption

**Technology:** Python + FastAPI + Reverb ASR

**File:** `services/reverb-server.py`

```python
"""
Reverb ASR REST API Server
Provides /transcribe endpoint for browser-based ORF assessment
"""
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import wenet
import tempfile
import os
import base64
from typing import Optional

app = FastAPI(title="Reverb ASR Service")

# Allow browser CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict in production
    allow_methods=["POST"],
    allow_headers=["*"],
)

# Load model once at startup
print("Loading Reverb ASR model...")
reverb = wenet.load_model("reverb_asr_v1")
print("Model loaded!")

class TranscriptionRequest(BaseModel):
    audio_base64: str
    verbatimicity: float = 1.0  # 0.0 = clean, 1.0 = verbatim

class WordResult(BaseModel):
    word: str
    start_time: float  # seconds
    end_time: float    # seconds
    confidence: float

class TranscriptionResponse(BaseModel):
    words: list[WordResult]
    transcript: str
    verbatimicity: float

@app.post("/transcribe", response_model=TranscriptionResponse)
async def transcribe(request: TranscriptionRequest):
    """
    Transcribe audio with specified verbatimicity level.

    verbatimicity=1.0: Full verbatim (repetitions, stutters, ums)
    verbatimicity=0.0: Clean transcript (disfluencies removed)
    """
    # Decode base64 audio
    audio_bytes = base64.b64decode(request.audio_base64)

    # Write to temp file (Reverb requires file path)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(audio_bytes)
        temp_path = f.name

    try:
        # Transcribe with CTM format for word-level timestamps
        output = reverb.transcribe(
            temp_path,
            verbatimicity=request.verbatimicity,
            format="ctm"
        )

        # Parse CTM output to word list
        # CTM format: <word> <channel> <start> <duration> <confidence>
        words = []
        for line in output.strip().split('\n'):
            if not line.strip():
                continue
            parts = line.split()
            if len(parts) >= 5:
                word = parts[0]
                start = float(parts[2])
                duration = float(parts[3])
                confidence = float(parts[4]) if len(parts) > 4 else 0.9
                words.append(WordResult(
                    word=word,
                    start_time=start,
                    end_time=start + duration,
                    confidence=confidence
                ))

        # Build transcript
        transcript = " ".join(w.word for w in words)

        return TranscriptionResponse(
            words=words,
            transcript=transcript,
            verbatimicity=request.verbatimicity
        )
    finally:
        os.unlink(temp_path)

@app.post("/ensemble")
async def ensemble_transcribe(request: TranscriptionRequest):
    """
    Run both verbatim and clean transcriptions in sequence.
    Returns both results for merger comparison.
    """
    # Decode audio once
    audio_bytes = base64.b64decode(request.audio_base64)

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(audio_bytes)
        temp_path = f.name

    try:
        # Pass 1: Full verbatim
        verbatim_output = reverb.transcribe(
            temp_path,
            verbatimicity=1.0,
            format="ctm"
        )

        # Pass 2: Clean (no disfluencies)
        clean_output = reverb.transcribe(
            temp_path,
            verbatimicity=0.0,
            format="ctm"
        )

        def parse_ctm(output):
            words = []
            for line in output.strip().split('\n'):
                if not line.strip():
                    continue
                parts = line.split()
                if len(parts) >= 4:
                    words.append({
                        "word": parts[0],
                        "start_time": float(parts[2]),
                        "end_time": float(parts[2]) + float(parts[3]),
                        "confidence": float(parts[4]) if len(parts) > 4 else 0.9
                    })
            return words

        return {
            "verbatim": {
                "words": parse_ctm(verbatim_output),
                "transcript": " ".join(w["word"] for w in parse_ctm(verbatim_output)),
                "verbatimicity": 1.0
            },
            "clean": {
                "words": parse_ctm(clean_output),
                "transcript": " ".join(w["word"] for w in parse_ctm(clean_output)),
                "verbatimicity": 0.0
            }
        }
    finally:
        os.unlink(temp_path)

@app.get("/health")
async def health():
    return {"status": "ok", "model": "reverb_asr_v1"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)
```

**Docker setup:** `services/Dockerfile.reverb`
```dockerfile
FROM python:3.10-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    git \
    git-lfs \
    && rm -rf /var/lib/apt/lists/*

# Install git-lfs
RUN git lfs install

WORKDIR /app

# Clone reverb and install
RUN git clone https://github.com/revdotcom/reverb.git
WORKDIR /app/reverb
RUN pip install .

# Install FastAPI dependencies
RUN pip install fastapi uvicorn python-multipart

# Download model at build time (requires HF token)
ARG HUGGINGFACE_TOKEN
RUN python -c "import wenet; wenet.load_model('reverb_asr_v1')"

WORKDIR /app
COPY reverb-server.py .

EXPOSE 8765
CMD ["python", "reverb-server.py"]
```

---

### Component 2: JavaScript API Client

**File:** `js/reverb-api.js`

```javascript
/**
 * Reverb ASR API client for browser-based ORF assessment.
 * Mirrors the interface of stt-api.js for easy swapping.
 */

import { setStatus } from './ui.js';

// Default to localhost for development
const REVERB_API_URL = window.REVERB_API_URL || 'http://localhost:8765';

/**
 * Convert blob to base64 string.
 */
function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(blob);
  });
}

/**
 * Transform Reverb word format to match Google STT format.
 * This allows reuse of existing merger/alignment code.
 *
 * Reverb: { word, start_time (float), end_time (float), confidence }
 * Google: { word, startTime ("1.5s"), endTime ("2.0s"), confidence }
 */
function normalizeReverbWord(w) {
  return {
    word: w.word,
    startTime: `${w.start_time}s`,
    endTime: `${w.end_time}s`,
    confidence: w.confidence
  };
}

/**
 * Single transcription with specified verbatimicity.
 * @param {Blob} blob - Audio blob (WAV/LINEAR16 recommended)
 * @param {number} verbatimicity - 0.0 (clean) to 1.0 (verbatim)
 * @returns {object} Normalized result matching Google STT format
 */
export async function sendToReverbSTT(blob, verbatimicity = 1.0) {
  setStatus(`Sending to Reverb ASR (verbatimicity=${verbatimicity})...`);

  const base64 = await blobToBase64(blob);

  try {
    const resp = await fetch(`${REVERB_API_URL}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio_base64: base64,
        verbatimicity: verbatimicity
      })
    });

    if (!resp.ok) {
      const error = await resp.text();
      throw new Error(`Reverb API error: ${error}`);
    }

    const data = await resp.json();

    // Normalize to Google STT format for compatibility
    return {
      results: [{
        alternatives: [{
          transcript: data.transcript,
          confidence: 0.95,  // Reverb doesn't return utterance-level confidence
          words: data.words.map(normalizeReverbWord)
        }]
      }]
    };
  } catch (e) {
    setStatus('Reverb request failed: ' + e.message);
    return null;
  }
}

/**
 * Ensemble transcription: verbatim + clean passes.
 * Returns structure compatible with existing merger.
 *
 * @param {Blob} blob - Audio blob
 * @returns {object} { verbatim, clean, errors } structure
 */
export async function sendReverbEnsembleSTT(blob) {
  setStatus('Running Reverb ensemble STT (verbatim + clean)...');

  const base64 = await blobToBase64(blob);

  try {
    const resp = await fetch(`${REVERB_API_URL}/ensemble`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio_base64: base64 })
    });

    if (!resp.ok) {
      const error = await resp.text();
      throw new Error(`Reverb API error: ${error}`);
    }

    const data = await resp.json();

    // Normalize to match Google ensemble format
    // verbatim → analogous to latest_long (captures everything)
    // clean → analogous to default (cleaner, more reliable)
    return {
      verbatim: {
        results: [{
          alternatives: [{
            transcript: data.verbatim.transcript,
            confidence: 0.95,
            words: data.verbatim.words.map(normalizeReverbWord)
          }]
        }]
      },
      clean: {
        results: [{
          alternatives: [{
            transcript: data.clean.transcript,
            confidence: 0.95,
            words: data.clean.words.map(normalizeReverbWord)
          }]
        }]
      },
      errors: { verbatim: null, clean: null }
    };
  } catch (e) {
    setStatus('Reverb ensemble failed: ' + e.message);
    return {
      verbatim: null,
      clean: null,
      errors: { verbatim: e.message, clean: e.message }
    };
  }
}

/**
 * Check if Reverb service is available.
 */
export async function checkReverbHealth() {
  try {
    const resp = await fetch(`${REVERB_API_URL}/health`);
    return resp.ok;
  } catch {
    return false;
  }
}
```

---

### Component 3: Reverb Ensemble Merger

**File:** `js/reverb-merger.js`

```javascript
/**
 * Reverb-specific ensemble merger.
 *
 * Unlike Google ensemble (two different models), Reverb ensemble uses
 * the SAME model with different verbatimicity settings:
 *
 * - verbatim (v=1.0): Captures repetitions, stutters, filler words
 * - clean (v=0.0): Removes disfluencies for readability
 *
 * MERGER STRATEGY:
 * The key insight is that words present in verbatim but ABSENT in clean
 * are the disfluencies (repetitions, ums, stutters, false starts).
 *
 * Trust Hierarchy:
 * - Word text: verbatim (it heard everything)
 * - Timestamps: verbatim (includes timing of disfluencies)
 * - Confidence: verbatim (both use same model, equally reliable)
 * - Disfluency flag: diff(verbatim, clean) identifies disfluencies
 */

const JITTER_MS = 50;
const SEMANTIC_WINDOW_MS = 500;

function parseTimeMs(t) {
  if (typeof t === 'number') return t * 1000;
  return (parseFloat(String(t).replace('s', '')) || 0) * 1000;
}

function normalizeWord(word) {
  return word.toLowerCase().replace(/[.,!?;:'"()-]/g, '');
}

/**
 * Extract words array from normalized Reverb result.
 */
export function extractWordsFromReverb(result) {
  if (!result?.results?.[0]?.alternatives?.[0]?.words) {
    return [];
  }
  return result.results[0].alternatives[0].words.map(w => ({
    word: w.word,
    startTime: w.startTime,
    endTime: w.endTime,
    confidence: w.confidence || 0.9
  }));
}

/**
 * Find which verbatim words are missing from clean output.
 * These are the disfluencies that were removed.
 */
function findDisfluencies(verbatimWords, cleanWords) {
  const cleanSet = new Set();
  const cleanUsed = new Set();

  // Build lookup for clean words by normalized form + approximate time
  cleanWords.forEach((w, i) => {
    const key = `${normalizeWord(w.word)}:${Math.round(parseTimeMs(w.startTime) / 100)}`;
    cleanSet.set(key, i);
  });

  const disfluencyIndices = new Set();

  for (let i = 0; i < verbatimWords.length; i++) {
    const vw = verbatimWords[i];
    const key = `${normalizeWord(vw.word)}:${Math.round(parseTimeMs(vw.startTime) / 100)}`;

    // Try exact time match first
    if (cleanSet.has(key) && !cleanUsed.has(cleanSet.get(key))) {
      cleanUsed.add(cleanSet.get(key));
      continue; // Found in clean, not a disfluency
    }

    // Try fuzzy time match (within 500ms)
    let foundMatch = false;
    for (let j = 0; j < cleanWords.length; j++) {
      if (cleanUsed.has(j)) continue;

      const cw = cleanWords[j];
      const timeDiff = Math.abs(parseTimeMs(vw.startTime) - parseTimeMs(cw.startTime));

      if (normalizeWord(vw.word) === normalizeWord(cw.word) && timeDiff < SEMANTIC_WINDOW_MS) {
        cleanUsed.add(j);
        foundMatch = true;
        break;
      }
    }

    if (!foundMatch) {
      // Word in verbatim but not in clean = disfluency
      disfluencyIndices.add(i);
    }
  }

  return disfluencyIndices;
}

/**
 * Classify disfluency type based on word and context.
 */
function classifyDisfluency(word, prevWord, nextWord) {
  const w = normalizeWord(word.word);

  // Filler words
  if (['um', 'uh', 'uh', 'er', 'ah', 'mm', 'hmm', 'like', 'you know'].includes(w)) {
    return 'filler';
  }

  // Repetition: same as previous or next word
  if (prevWord && normalizeWord(prevWord.word) === w) {
    return 'repetition';
  }
  if (nextWord && normalizeWord(nextWord.word) === w) {
    return 'repetition';
  }

  // False start: short word followed by different word
  if (w.length <= 2 && nextWord && normalizeWord(nextWord.word) !== w) {
    return 'false_start';
  }

  return 'disfluency';  // Generic
}

/**
 * Merge Reverb ensemble results.
 *
 * @param {object} ensembleResult - { verbatim, clean, errors }
 * @param {string} referenceText - Optional reference passage
 * @returns {Array} Merged words with disfluency flags
 */
export function mergeReverbResults(ensembleResult, referenceText = '') {
  const verbatimWords = extractWordsFromReverb(ensembleResult.verbatim);
  const cleanWords = extractWordsFromReverb(ensembleResult.clean);

  console.log('[reverb-merger] verbatim:', verbatimWords.length, 'clean:', cleanWords.length);

  if (verbatimWords.length === 0) {
    console.log('[reverb-merger] No verbatim words, returning empty');
    return [];
  }

  // Find which verbatim words are disfluencies (missing from clean)
  const disfluencyIndices = findDisfluencies(verbatimWords, cleanWords);
  console.log('[reverb-merger] Disfluencies detected:', disfluencyIndices.size);

  // Build merged result
  const merged = verbatimWords.map((vw, i) => {
    const isDisfluency = disfluencyIndices.has(i);
    const prevWord = i > 0 ? verbatimWords[i - 1] : null;
    const nextWord = i < verbatimWords.length - 1 ? verbatimWords[i + 1] : null;

    return {
      word: vw.word,
      startTime: vw.startTime,
      endTime: vw.endTime,
      confidence: vw.confidence,
      source: isDisfluency ? 'verbatim_only' : 'both',

      // Disfluency metadata
      isDisfluency: isDisfluency,
      disfluencyType: isDisfluency ? classifyDisfluency(vw, prevWord, nextWord) : null,

      _debug: {
        verbatim: vw,
        foundInClean: !isDisfluency,
        disfluencyClassification: isDisfluency ? classifyDisfluency(vw, prevWord, nextWord) : null
      }
    };
  });

  // Log summary
  const disfluencyBreakdown = {};
  merged.filter(w => w.isDisfluency).forEach(w => {
    disfluencyBreakdown[w.disfluencyType] = (disfluencyBreakdown[w.disfluencyType] || 0) + 1;
  });
  console.log('[reverb-merger] Disfluency breakdown:', disfluencyBreakdown);

  return merged;
}

/**
 * Compute stats for Reverb ensemble merge.
 */
export function computeReverbEnsembleStats(mergedWords) {
  const total = mergedWords.length;
  const disfluencies = mergedWords.filter(w => w.isDisfluency).length;
  const byType = {};

  mergedWords.filter(w => w.isDisfluency).forEach(w => {
    byType[w.disfluencyType] = (byType[w.disfluencyType] || 0) + 1;
  });

  return {
    totalWords: total,
    contentWords: total - disfluencies,
    disfluencies: disfluencies,
    disfluencyRate: total > 0 ? (disfluencies / total * 100).toFixed(1) + '%' : '0%',
    byType: byType
  };
}
```

---

### Component 4: A/B Testing Infrastructure

**File:** `js/ensemble-selector.js`

```javascript
/**
 * Ensemble selector for A/B testing Google vs Reverb.
 * Allows running both ensembles on same audio for comparison.
 */

import { sendEnsembleSTT } from './stt-api.js';
import { sendReverbEnsembleSTT, checkReverbHealth } from './reverb-api.js';
import { mergeEnsembleResults, computeEnsembleStats } from './ensemble-merger.js';
import { mergeReverbResults, computeReverbEnsembleStats } from './reverb-merger.js';

// Ensemble types
export const ENSEMBLE_GOOGLE = 'google';
export const ENSEMBLE_REVERB = 'reverb';
export const ENSEMBLE_BOTH = 'both';  // For comparison

/**
 * Get current ensemble preference from localStorage.
 */
export function getEnsemblePreference() {
  return localStorage.getItem('orf_ensemble_type') || ENSEMBLE_GOOGLE;
}

/**
 * Set ensemble preference.
 */
export function setEnsemblePreference(type) {
  localStorage.setItem('orf_ensemble_type', type);
}

/**
 * Run transcription with selected ensemble.
 *
 * @param {Blob} blob - Audio blob
 * @param {string} encoding - Audio encoding
 * @param {number} sampleRate - Sample rate
 * @param {string} referenceText - Reference passage
 * @param {string} ensembleType - 'google', 'reverb', or 'both'
 * @returns {object} { google?, reverb?, selected, words, stats }
 */
export async function runEnsemble(blob, encoding, sampleRate, referenceText, ensembleType = null) {
  const type = ensembleType || getEnsemblePreference();

  const results = {
    google: null,
    reverb: null,
    selected: type,
    words: [],
    stats: {}
  };

  // Run Google ensemble
  if (type === ENSEMBLE_GOOGLE || type === ENSEMBLE_BOTH) {
    const googleRaw = await sendEnsembleSTT(blob, encoding, sampleRate);
    if (googleRaw.latestLong || googleRaw.default) {
      results.google = {
        raw: googleRaw,
        merged: mergeEnsembleResults(googleRaw, referenceText),
        stats: null  // Computed after merge
      };
      results.google.stats = computeEnsembleStats(results.google.merged);
    }
  }

  // Run Reverb ensemble
  if (type === ENSEMBLE_REVERB || type === ENSEMBLE_BOTH) {
    const reverbAvailable = await checkReverbHealth();
    if (reverbAvailable) {
      const reverbRaw = await sendReverbEnsembleSTT(blob);
      if (reverbRaw.verbatim || reverbRaw.clean) {
        results.reverb = {
          raw: reverbRaw,
          merged: mergeReverbResults(reverbRaw, referenceText),
          stats: null
        };
        results.reverb.stats = computeReverbEnsembleStats(results.reverb.merged);
      }
    } else {
      console.warn('[ensemble-selector] Reverb service not available');
    }
  }

  // Select primary result
  if (type === ENSEMBLE_GOOGLE && results.google) {
    results.words = results.google.merged;
    results.stats = results.google.stats;
  } else if (type === ENSEMBLE_REVERB && results.reverb) {
    results.words = results.reverb.merged;
    results.stats = results.reverb.stats;
  } else if (type === ENSEMBLE_BOTH) {
    // Use Google as primary when comparing
    results.words = results.google?.merged || results.reverb?.merged || [];
    results.stats = results.google?.stats || results.reverb?.stats || {};
  }

  return results;
}

/**
 * Compare ensemble results for same audio.
 * Returns detailed comparison metrics.
 */
export function compareEnsembles(googleResult, reverbResult, referenceText) {
  if (!googleResult || !reverbResult) {
    return { error: 'Both ensembles required for comparison' };
  }

  const googleWords = googleResult.merged || [];
  const reverbWords = reverbResult.merged || [];

  // Build transcript strings for comparison
  const googleTranscript = googleWords.map(w => w.word).join(' ');
  const reverbTranscript = reverbWords.map(w => w.word).join(' ');

  // Count disfluencies detected
  const googleDisfluencies = googleWords.filter(w =>
    w.source === 'latest_only' || w._debug?.morphologicalBreak
  ).length;

  const reverbDisfluencies = reverbWords.filter(w => w.isDisfluency).length;

  // Disfluency types (Reverb only has this breakdown)
  const reverbDisfluencyTypes = {};
  reverbWords.filter(w => w.isDisfluency).forEach(w => {
    reverbDisfluencyTypes[w.disfluencyType] = (reverbDisfluencyTypes[w.disfluencyType] || 0) + 1;
  });

  return {
    wordCount: {
      google: googleWords.length,
      reverb: reverbWords.length,
      diff: reverbWords.length - googleWords.length
    },
    disfluencies: {
      google: googleDisfluencies,
      reverb: reverbDisfluencies,
      diff: reverbDisfluencies - googleDisfluencies,
      reverbTypes: reverbDisfluencyTypes
    },
    transcripts: {
      google: googleTranscript,
      reverb: reverbTranscript,
      match: googleTranscript.toLowerCase() === reverbTranscript.toLowerCase()
    },
    confidence: {
      googleAvg: googleWords.length > 0
        ? (googleWords.reduce((s, w) => s + (w.confidence || 0), 0) / googleWords.length).toFixed(3)
        : 'N/A',
      reverbAvg: reverbWords.length > 0
        ? (reverbWords.reduce((s, w) => s + (w.confidence || 0), 0) / reverbWords.length).toFixed(3)
        : 'N/A'
    }
  };
}
```

---

### Component 5: UI Integration

**Additions to `js/ui.js`:**

```javascript
/**
 * Render ensemble selector dropdown.
 */
export function renderEnsembleSelector(currentType) {
  const container = document.getElementById('ensembleSelector') || createEnsembleSelectorContainer();

  container.innerHTML = `
    <label for="ensembleType" style="margin-right:0.5rem;">STT Engine:</label>
    <select id="ensembleType" style="padding:0.4rem;border-radius:4px;">
      <option value="google" ${currentType === 'google' ? 'selected' : ''}>Google (latest_long + default)</option>
      <option value="reverb" ${currentType === 'reverb' ? 'selected' : ''}>Reverb (verbatim + clean)</option>
      <option value="both" ${currentType === 'both' ? 'selected' : ''}>Both (A/B Compare)</option>
    </select>
    <span id="reverbStatus" style="margin-left:0.5rem;font-size:0.8rem;"></span>
  `;

  // Check Reverb availability
  import('./reverb-api.js').then(async ({ checkReverbHealth }) => {
    const status = document.getElementById('reverbStatus');
    const available = await checkReverbHealth();
    status.textContent = available ? '✓ Reverb ready' : '✗ Reverb offline';
    status.style.color = available ? '#4caf50' : '#f44336';
  });

  return container;
}

function createEnsembleSelectorContainer() {
  const container = document.createElement('div');
  container.id = 'ensembleSelector';
  container.style.cssText = 'margin:0.5rem 0;padding:0.5rem;background:#1a1a2e;border-radius:6px;';

  // Insert after API key input
  const apiKeyContainer = document.getElementById('apiKey')?.parentElement;
  if (apiKeyContainer) {
    apiKeyContainer.parentElement.insertBefore(container, apiKeyContainer.nextSibling);
  }

  return container;
}

/**
 * Render A/B comparison results.
 */
export function renderComparisonResults(comparison) {
  const container = document.getElementById('comparisonResults') || createComparisonContainer();

  container.innerHTML = `
    <h4>Ensemble Comparison</h4>
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <th></th>
        <th>Google</th>
        <th>Reverb</th>
        <th>Diff</th>
      </tr>
      <tr>
        <td>Word Count</td>
        <td>${comparison.wordCount.google}</td>
        <td>${comparison.wordCount.reverb}</td>
        <td>${comparison.wordCount.diff > 0 ? '+' : ''}${comparison.wordCount.diff}</td>
      </tr>
      <tr>
        <td>Disfluencies</td>
        <td>${comparison.disfluencies.google}</td>
        <td>${comparison.disfluencies.reverb}</td>
        <td>${comparison.disfluencies.diff > 0 ? '+' : ''}${comparison.disfluencies.diff}</td>
      </tr>
      <tr>
        <td>Avg Confidence</td>
        <td>${comparison.confidence.googleAvg}</td>
        <td>${comparison.confidence.reverbAvg}</td>
        <td>-</td>
      </tr>
    </table>
    ${comparison.disfluencies.reverbTypes ? `
      <p style="margin-top:0.5rem;font-size:0.85rem;">
        <strong>Reverb disfluency breakdown:</strong>
        ${Object.entries(comparison.disfluencies.reverbTypes)
          .map(([type, count]) => `${type}: ${count}`)
          .join(', ')}
      </p>
    ` : ''}
    <details style="margin-top:0.5rem;">
      <summary>Transcripts</summary>
      <p><strong>Google:</strong> ${comparison.transcripts.google}</p>
      <p><strong>Reverb:</strong> ${comparison.transcripts.reverb}</p>
      <p><strong>Match:</strong> ${comparison.transcripts.match ? '✓ Yes' : '✗ No'}</p>
    </details>
  `;

  return container;
}

function createComparisonContainer() {
  const container = document.createElement('div');
  container.id = 'comparisonResults';
  container.style.cssText = 'margin:1rem 0;padding:1rem;background:#1a2a1a;border-radius:8px;border:1px solid #2a4a2a;';

  const resultsSection = document.getElementById('results');
  if (resultsSection) {
    resultsSection.insertBefore(container, resultsSection.firstChild);
  }

  return container;
}
```

---

## Implementation Phases

### Phase 1: Backend Setup (Day 1-2)
1. Create `services/` directory
2. Set up Reverb Docker container
3. Implement FastAPI server with `/transcribe` and `/ensemble` endpoints
4. Test locally with sample audio
5. Document startup procedure

**Deliverables:**
- `services/reverb-server.py`
- `services/Dockerfile.reverb`
- `services/docker-compose.yml`
- `services/README.md`

### Phase 2: JavaScript Integration (Day 3-4)
1. Create `js/reverb-api.js` - API client
2. Create `js/reverb-merger.js` - Ensemble merger
3. Create `js/ensemble-selector.js` - A/B infrastructure
4. Add ensemble selector UI
5. Wire up to existing analysis pipeline

**Deliverables:**
- `js/reverb-api.js`
- `js/reverb-merger.js`
- `js/ensemble-selector.js`
- UI modifications

### Phase 3: Testing Framework (Day 5-6)
1. Create test audio samples (clean, disfluent, challenging)
2. Build comparison harness
3. Run both ensembles on identical audio
4. Generate comparison reports
5. Analyze disfluency detection accuracy

**Deliverables:**
- `test-data/` directory with sample audio
- `test-data/comparison-results.json`
- Analysis report

### Phase 4: Evaluation & Decision (Day 7+)
1. Review comparison metrics
2. Identify strengths/weaknesses of each approach
3. Decide on primary ensemble
4. Optionally remove non-selected ensemble code

---

## Data Format Mapping

### Google STT Response → Internal Format
```javascript
// Google returns:
{
  results: [{
    alternatives: [{
      transcript: "hello world",
      confidence: 0.95,
      words: [
        { word: "hello", startTime: "0.5s", endTime: "1.0s", confidence: 0.98 },
        { word: "world", startTime: "1.0s", endTime: "1.5s", confidence: 0.92 }
      ]
    }]
  }]
}

// Internal merged word:
{
  word: "hello",
  startTime: "0.5s",
  endTime: "1.0s",
  confidence: 0.92,  // From default model
  source: "both",    // "latest_only" | "default_only" | "both"
  _debug: { ... }
}
```

### Reverb Response → Internal Format
```javascript
// Reverb returns (normalized):
{
  words: [
    { word: "hello", start_time: 0.5, end_time: 1.0, confidence: 0.95 },
    { word: "um", start_time: 1.0, end_time: 1.2, confidence: 0.88 },
    { word: "world", start_time: 1.2, end_time: 1.7, confidence: 0.93 }
  ],
  transcript: "hello um world",
  verbatimicity: 1.0
}

// Internal merged word (after reverb-merger):
{
  word: "um",
  startTime: "1.0s",
  endTime: "1.2s",
  confidence: 0.88,
  source: "verbatim_only",
  isDisfluency: true,
  disfluencyType: "filler",
  _debug: { ... }
}
```

---

## Key Differences from Google Ensemble

| Aspect | Google Ensemble | Reverb Ensemble |
|--------|-----------------|-----------------|
| **Models** | 2 different models (latest_long + default) | 1 model, 2 passes (v=1.0 + v=0.0) |
| **Confidence source** | default model only | Both passes (same model) |
| **Timestamp source** | default model preferred | verbatim pass (has all words) |
| **Disfluency detection** | Indirect (latest_only as proxy) | Direct (diff between passes) |
| **Repetitions** | Not detected | ✓ Detected (in verbatim, not in clean) |
| **Stutters** | Not detected | ✓ Detected |
| **Filler words** | Partially (um, uh) | ✓ Full detection |
| **False starts** | Not detected | ✓ Detected |
| **Reference veto** | Yes (hallucination protection) | Not needed (single model, no conflicts) |
| **Ghost detection** | VAD-based for latest_only | Not needed (model is consistent) |

---

## Risk Assessment

### Low Risk
- Reverb is proven technology (200k hours training data)
- API wrapper is straightforward
- Existing UI/alignment code reusable

### Medium Risk
- Local GPU/CPU requirements for Reverb
- Initial Docker setup complexity
- Timestamp format differences

### High Risk (Mitigated)
- **Model accuracy untested on your data** → Phase 3 A/B testing
- **Children's speech performance unknown** → Test with actual student recordings
- **Disfluency detection accuracy unverified** → Compare against manual annotations

---

## Hardware Requirements

### Minimum (CPU inference)
- 8GB RAM
- 4-core CPU
- ~5GB disk for model

### Recommended (GPU inference)
- 16GB RAM
- NVIDIA GPU with 8GB+ VRAM
- CUDA 11.8+
- ~10GB disk

### Inference Speed (Approximate)
- CPU: ~0.3-0.5x realtime (1 min audio → 2-3 min processing)
- GPU: ~3-5x realtime (1 min audio → 12-20 sec processing)

---

## Success Criteria

### Must Have
- [ ] Reverb backend running and accessible from browser
- [ ] A/B comparison functional with same audio
- [ ] Disfluency detection produces meaningful results
- [ ] Word timestamps align with audio

### Should Have
- [ ] Reverb detects repetitions Google misses
- [ ] Comparable or better overall accuracy
- [ ] Acceptable latency (<30s for 1 min audio)

### Nice to Have
- [ ] Disfluency type classification matches human judgment
- [ ] GPU acceleration working
- [ ] Docker deployment script

---

## Appendix: Startup Scripts

### Start Reverb Service (Docker)
```bash
cd services
docker-compose up -d reverb
# Check health
curl http://localhost:8765/health
```

### Start Reverb Service (Local Python)
```bash
cd services
pip install -r requirements.txt
python reverb-server.py
```

### Test Transcription
```bash
# Single transcription (verbatim)
curl -X POST http://localhost:8765/transcribe \
  -H "Content-Type: application/json" \
  -d '{"audio_base64": "'$(base64 -w0 test.wav)'", "verbatimicity": 1.0}'

# Ensemble transcription
curl -X POST http://localhost:8765/ensemble \
  -H "Content-Type: application/json" \
  -d '{"audio_base64": "'$(base64 -w0 test.wav)'"}'
```

---

## Next Steps

1. **Review this proposal** - Confirm approach makes sense
2. **Set up Reverb backend** - Docker or local Python
3. **Implement JS modules** - API client, merger, selector
4. **Run A/B tests** - Compare on real recordings
5. **Make decision** - Switch or keep Google ensemble

