# Maze Comprehension Game — Implementation Plan

**Date:** 2026-02-06
**Status:** Proposed

---

## 1. Concept

A speech-based comprehension game that runs **after** the ORF assessment. The student sees a sentence from their passage with one word replaced by three options. They **speak** their chosen word within 10 seconds. ASR recognizes which option they said — that is their final answer, right or wrong. Three rounds total (1/3, 2/3, 3/3).

This is a **spoken maze test** — a hybrid of the traditional CBM-Maze (multiple-choice comprehension) and spoken-response assessment. The student must comprehend the sentence to pick the correct word, then speak it aloud to confirm their choice.

---

## 2. Architecture & File Structure

### New Files

| File | Purpose |
|------|---------|
| `maze.html` | Standalone game page (opens in new window like `playback.html`) |
| `css/maze.css` | Maze game styling |
| `js/maze-generator.js` | Sentence extraction, word selection, distractor generation, difficulty profiles |
| `js/maze-game.js` | Game state machine, ASR listener, countdown timer, UI orchestration |

### Existing Files to Modify

| File | Change |
|------|--------|
| `js/app.js` | Add "Maze Game" button after assessment saves (same pattern as `#playbackAdventureBtn` at line ~59-91) |
| `services/reverb/server.py` | Add `/deepgram-maze` endpoint (short audio + keyterm-boosted recognition) |
| `index.html` | Update version timestamp |

### Audio Assets

| File | Purpose |
|------|---------|
| `audio files/1up.mp3` | Correct-answer sound effect (already exists) |
| _(generated at runtime)_ | Wrong-answer tone via Web Audio API `OscillatorNode` (no file needed) |

### Existing Code to Reuse

| Component | File | What to Reuse |
|-----------|------|---------------|
| NL API annotations | `js/nl-api.js` | `SIGHT_WORDS`, `FUNCTION_POS`, `classifyTier()`, `levenshteinRatio()` |
| Word equivalences | `js/word-equivalences.js` | `getCanonical()` for response verification |
| Student storage | `js/storage.js` | `getAssessment()` to retrieve passage + NL annotations, `saveAssessment()` to persist maze scores |
| Microphone capture | `js/recorder.js` | `getUserMedia()` pattern + `MediaRecorder` pattern for mic access |
| Deepgram proxy | `js/deepgram-api.js` | `blobToBase64()` pattern, backend URL constant |

---

## 3. Entry Point: The "Maze Game" Button

After assessment completes and saves, `app.js` creates a button alongside the existing "Watch Your Reading Adventure!" button:

```javascript
// In app.js, after assessment save (~line 91, after playbackAdventureBtn)
const mazeBtn = document.createElement('button');
mazeBtn.id = 'mazeGameBtn';
mazeBtn.textContent = 'Maze Game';
mazeBtn.style.cssText = 'background:#7b1fa2; color:#fff; margin-left:0.5rem;';
mazeBtn.addEventListener('click', () => {
  const difficulty = document.getElementById('mazeDifficulty').value;
  const params = new URLSearchParams({ student: studentId, assessment: assessmentId, difficulty });
  const url = base + 'maze.html?' + params.toString();
  window.open(url, 'orf_maze', 'width=700,height=500');
});
```

Also add a **difficulty dropdown** next to the button:

```html
<select id="mazeDifficulty">
  <option value="easy">Easy (K-2)</option>
  <option value="standard" selected>Standard (3-5)</option>
  <option value="challenge">Challenge (6-8)</option>
</select>
```

**Data passing uses URL query parameters** (not localStorage) to prevent cross-tab clobbering when multiple students are assessed simultaneously. The maze window reads params on load:

```javascript
const params = new URLSearchParams(window.location.search);
const studentId = params.get('student');
const assessmentId = params.get('assessment');
const difficulty = params.get('difficulty') || 'standard';
```

---

## 4. Maze Generation Algorithm (`maze-generator.js`)

### 4.1 Sentence Extraction — Robust Splitter

ORF passages commonly contain abbreviations ("Dr. Smith"), dialogue ("Stop!" she said.), ellipses ("He waited... then ran."), and decimal numbers ("3.5 miles"). A naive split on `.!?` will break on all of these.

**Strategy:** Protect known non-terminal periods with a placeholder, split on actual sentence boundaries, then restore.

```javascript
function splitIntoSentences(passageText) {
  let text = passageText;

  // 1. Protect abbreviation periods (won't end a sentence)
  const ABBREVIATIONS = [
    'Mr', 'Mrs', 'Ms', 'Dr', 'Jr', 'Sr', 'St', 'Ave', 'Blvd',
    'Prof', 'Gen', 'Gov', 'Sgt', 'Cpl', 'Pvt', 'Lt', 'Capt',
    'Col', 'Maj', 'Rev', 'Vol', 'Dept', 'Est', 'Fig', 'vs'
  ];
  for (const abbr of ABBREVIATIONS) {
    // Match abbreviation followed by period (case-insensitive first char)
    text = text.replace(new RegExp(`\\b${abbr}\\.`, 'g'), `${abbr}\u00A7`);
  }

  // 2. Protect decimal numbers (3.5 → 3§5)
  text = text.replace(/(\d)\.(\d)/g, '$1\u00A7$2');

  // 3. Protect ellipses (... → single character)
  text = text.replace(/\.{3}/g, '\u2026');

  // 4. Split on sentence-ending punctuation followed by whitespace or end-of-string
  //    This handles: "Stop!" she said. "Come back!" → two containing sentences
  //    by requiring [A-Z"] or end-of-string after the split point
  const raw = text.split(/(?<=[.!?])\s+(?=[A-Z"\u201C]|$)/);

  // 5. Restore placeholders and filter
  return raw
    .map(s => s.replace(/\u00A7/g, '.').replace(/\u2026/g, '...').trim())
    .filter(s => s.length > 0 && s.split(/\s+/).length >= 4);
}
```

**Behavior on tricky cases:**

| Input | Result |
|-------|--------|
| `Dr. Smith went to the store.` | 1 sentence (abbreviation protected) |
| `"Stop!" she said. "Come back!"` | 2 sentences: `"Stop!" she said.` + `"Come back!"` |
| `He waited... then ran away.` | 1 sentence (ellipsis protected) |
| `They counted 3.5 miles total.` | 1 sentence (decimal protected) |
| `She ran fast. He ran faster.` | 2 sentences (normal split) |

**Minimum viable passage:** 15 words and 3 sentences. Below this, maze is skipped (button not shown).

### 4.2 Sentence Selection — Spread Algorithm

Divide sentences into 3 zones (early / mid / late). Pick the best-scoring sentence from each zone for passage-wide spread.

```
Given N sentences:
  Zone 1: sentences[0 .. N/3)
  Zone 2: sentences[N/3 .. 2N/3)
  Zone 3: sentences[2N/3 .. N)

Select highest-scoring sentence from each zone.
If a zone is empty, steal second-best from the zone with the most.
```

Sentence scoring criteria:

| Criterion | Score | Rationale |
|-----------|-------|-----------|
| Word count 5-15 | +2 | Enough context, fits on screen |
| Word count 4 | +1 | Marginal but usable |
| Word count < 4 | -10 | Disqualify — not enough context |
| Contains >= 2 content words | +2 | Must have removable target + distractor source |
| Is NOT the first sentence | +1 | Traditional maze leaves sentence 1 intact for context |

### 4.3 Target Word Selection — Two-Path Approach

**Path A: With NL API annotations (preferred)**

The ORF pipeline already calls `analyzePassageText()` which produces per-word POS tags, entity types, and tier classifications. These are saved with the assessment.

Eligible targets:
- POS is `NOUN`, `VERB`, `ADJ`, or `ADV`
- Tier is NOT `'proper'` and NOT `'function'`
- Word length >= 3 characters
- POS is NOT `'NUM'`

**Path B: Heuristic fallback (no NL API)**

When no NL annotations are available, use a built-in function word set:

```javascript
const FUNCTION_WORDS = new Set([
  // Articles
  'a', 'an', 'the',
  // Pronouns (subject, object, possessive, reflexive, demonstrative, relative)
  'i', 'me', 'my', 'mine', 'myself', 'you', 'your', 'yours', 'yourself',
  'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself',
  'it', 'its', 'itself', 'we', 'us', 'our', 'ours', 'ourselves',
  'they', 'them', 'their', 'theirs', 'themselves',
  'this', 'that', 'these', 'those', 'who', 'whom', 'whose', 'which', 'what',
  // Prepositions
  'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'of', 'about',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'under', 'over', 'up', 'down', 'out', 'off', 'near', 'around',
  // Conjunctions
  'and', 'but', 'or', 'nor', 'for', 'yet', 'so', 'because', 'although',
  'while', 'if', 'when', 'since', 'until', 'unless', 'though', 'whereas',
  // Auxiliary/modal verbs
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'has', 'have', 'had', 'do', 'does', 'did',
  'will', 'would', 'shall', 'should', 'may', 'might', 'can', 'could', 'must',
  // Other function words
  'not', 'no', 'very', 'too', 'also', 'just', 'only', 'than', 'then',
  'as', 'so', 'such'
]);
```

A word is a content word candidate if:
- NOT in `FUNCTION_WORDS`
- Length >= 3 characters
- Not mid-sentence capitalized (heuristic for proper nouns)
- Not a pure number (`/^\d+$/`)
- Not a contraction (`/'\w/`)

### 4.4 Candidate Scoring

Each eligible content word in a sentence is scored:

| Factor | Score | Rationale |
|--------|-------|-----------|
| **Inferrability** | | |
| Word appears elsewhere in passage | +3 | Student saw it; pure comprehension test |
| **Position** | | |
| Mid-sentence (not first/last word) | +2 | Maximum surrounding context |
| Last content word in sentence | +1 | Preceding context is sufficient |
| First word of sentence | -2 | No left context |
| **Word properties** | | |
| Length 4-8 characters | +1 | Sweet spot for recognition |
| In SIGHT_WORDS | +1 | Known to student; tests comprehension not vocabulary |
| NOT in SIGHT_WORDS and length > 6 | -1 | May test vocabulary, not comprehension |
| **POS bonus (with NL API)** | | |
| NOUN | +2 | Most inferrable from context |
| VERB | +1 | Good targets |
| ADJ | +1 | Context-dependent |
| ADV | 0 | Often optional |

Highest-scoring candidate wins. Ties broken by proximity to sentence center.

---

## 5. Distractor Generation

Each maze item shows 3 options: **1 correct word + 2 distractors**. The distractors must be plausible enough to require comprehension but clearly wrong in context.

### 5.1 Distractor Strategy

**Distractor A (same POS, wrong context):** A content word from a *different sentence* in the same passage that has the same POS or similar word class.

**Distractor B (different POS or random):** A content word from the passage that is a different word class, OR a word from the built-in distractor pool.

This "passage-internal" approach is preferred because:
- Words are from text the student just read — they're familiar
- No external dictionary or API needed
- Difficulty is controlled by how semantically close the distractors are

### 5.2 Distractor Selection Algorithm

```javascript
function generateDistractors(targetWord, targetSentIdx, sentences, nlAnnotations, passageText) {
  const target = targetWord.toLowerCase();
  const targetPOS = getWordPOS(target, targetSentIdx, nlAnnotations); // NOUN/VERB/ADJ/ADV or null

  // Collect all content words from OTHER sentences
  const pool = [];
  for (let i = 0; i < sentences.length; i++) {
    if (i === targetSentIdx) continue; // Skip the target sentence
    const words = sentences[i].split(/\s+/);
    for (const w of words) {
      const clean = w.replace(/^[^\w'-]+|[^\w'-]+$/g, '').toLowerCase();
      if (clean.length < 3) continue;
      if (FUNCTION_WORDS.has(clean)) continue;
      if (clean === target) continue; // Don't use the target word itself
      pool.push({ word: clean, display: w, sentIdx: i, pos: getWordPOS(clean, i, nlAnnotations) });
    }
  }

  // Distractor A: same POS (or any content word if POS unavailable)
  let distractorA = null;
  if (targetPOS) {
    const samePOS = pool.filter(w => w.pos === targetPOS && w.word !== target);
    distractorA = pickRandom(samePOS) || pickRandom(pool);
  } else {
    distractorA = pickRandom(pool);
  }

  // Distractor B: different POS (or any remaining word)
  const remaining = pool.filter(w => w.word !== distractorA?.word && w.word !== target);
  let distractorB = null;
  if (targetPOS) {
    const diffPOS = remaining.filter(w => w.pos !== targetPOS);
    distractorB = pickRandom(diffPOS) || pickRandom(remaining);
  } else {
    distractorB = pickRandom(remaining);
  }

  // Fallback: if passage is too short for 2 unique distractors, use built-in pool
  if (!distractorA) distractorA = { word: pickFromBuiltinPool(targetPOS, target) };
  if (!distractorB) distractorB = { word: pickFromBuiltinPool(null, target) };

  return [distractorA.word, distractorB.word];
}
```

### 5.3 Built-in Fallback Distractor Pool

For very short passages where not enough content words exist in other sentences:

```javascript
const BUILTIN_DISTRACTORS = {
  NOUN: ['banana', 'mountain', 'pocket', 'blanket', 'garden', 'window', 'basket', 'dragon', 'pillow', 'forest'],
  VERB: ['whispered', 'crawled', 'bounced', 'melted', 'folded', 'twisted', 'scattered', 'wobbled', 'tumbled', 'drifted'],
  ADJ:  ['purple', 'fuzzy', 'enormous', 'tiny', 'wooden', 'golden', 'crooked', 'slippery', 'hollow', 'dusty'],
  ADV:  ['slowly', 'loudly', 'carefully', 'silently', 'gently', 'suddenly', 'bravely', 'eagerly', 'calmly', 'fiercely'],
  DEFAULT: ['banana', 'purple', 'whispered', 'slowly', 'garden', 'enormous', 'crawled', 'carefully']
};
```

### 5.4 Option Shuffling

The 3 options (1 correct + 2 distractors) are shuffled into random order each round. The shuffle is deterministic per assessment (seeded by assessment ID) so replays show the same order.

### 5.5 Distractor Quality Guards

- No distractor may be a homophone of the correct answer
- No distractor may have Levenshtein similarity >= 0.7 to the correct answer (too confusable for ASR)
- No two distractors may be the same word
- Distractors are lowercased and cleaned to match display format

---

## 6. Difficulty Profiles

Difficulty is selected via a **dropdown menu** next to the Maze Game button. It is NOT auto-selected by grade.

```html
<select id="mazeDifficulty">
  <option value="easy">Easy (K-2)</option>
  <option value="standard" selected>Standard (3-5)</option>
  <option value="challenge">Challenge (6-8)</option>
</select>
```

### 6.1 Profile Definitions

```javascript
const DIFFICULTY_PROFILES = {
  easy: {
    preferRepeatedWords: true,    // Word must appear 2+ times in passage
    allowAdverbs: false,          // Only nouns, verbs, adjectives
    minWordLength: 3,
    maxWordLength: 7,
    positionPreference: 'mid',    // Mid-sentence only
    sightWordBonus: 3,            // Strongly prefer known words
    distractorSource: 'different_pos', // Distractors are obviously wrong POS
  },
  standard: {
    preferRepeatedWords: false,
    allowAdverbs: false,
    minWordLength: 3,
    maxWordLength: 10,
    positionPreference: 'any',
    sightWordBonus: 1,
    distractorSource: 'mixed',    // One same POS, one different POS
  },
  challenge: {
    preferRepeatedWords: false,
    allowAdverbs: true,
    minWordLength: 4,
    maxWordLength: 15,
    positionPreference: 'any',
    sightWordBonus: -1,           // Prefer less common words
    distractorSource: 'same_pos', // Both distractors are same POS (harder)
  }
};
```

### 6.2 How Difficulty Affects Distractors

| Difficulty | Distractor A | Distractor B | Effect |
|------------|-------------|-------------|--------|
| Easy | Different POS | Different POS | Obviously wrong — only correct answer "fits" grammatically |
| Standard | Same POS | Different POS | One plausible, one obviously wrong |
| Challenge | Same POS | Same POS | Both distractors are grammatically plausible — must comprehend to choose |

---

## 7. Speech Recognition — Deepgram Nova-3 via Existing Proxy

### 7.1 ASR Engine: Deepgram Nova-3 with Keyterm Boosting

The ORF tool already has Deepgram Nova-3 integrated as a cross-validator, proxied through the Reverb backend at `localhost:8765/deepgram`. For the maze game, we add a lightweight `/deepgram-maze` endpoint that is optimized for single-word recognition with **keyterm prompting**.

**Why Deepgram instead of Web Speech API:**

| | Web Speech API | Deepgram Nova-3 |
|---|---|---|
| Accuracy | Consumer-grade | Production-grade |
| Keyword boosting | None | `keyterms` built into Nova-3 model |
| Browser support | Chrome-only | Any browser with `getUserMedia` |
| Reliability | Flaky `continuous` mode, auto-stops | Deterministic batch request |
| Infrastructure | None needed | Already running (Reverb proxy) |
| Cost | Free | ~$0.002 per 10s clip (Nova-3 pay-as-you-go) |
| Latency for 2s clip | ~200ms (streaming) | ~500-1000ms (batch) |

**Trade-off:** Deepgram batch has ~1-2s round-trip latency vs Web Speech API's near-instant interim results. But for a 10-second game round, 1-2 seconds is acceptable — and the accuracy gain is worth it.

### 7.2 New Backend Endpoint: `/deepgram-maze`

Added to `services/reverb/server.py`:

```python
class MazeRequest(BaseModel):
    """Request model for /deepgram-maze endpoint."""
    audio_base64: str
    keyterms: list[str]  # The 3 option words to boost

@app.post("/deepgram-maze")
async def deepgram_maze(req: MazeRequest):
    """
    Short-audio transcription optimized for maze game.
    Uses Nova-3 keyterm prompting to boost recognition of the 3 option words.
    Expects 1-3 second audio clips (single spoken word).
    """
    client = get_deepgram_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Deepgram not configured")

    try:
        audio_bytes = base64.b64decode(req.audio_base64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid base64: {e}")

    try:
        response = client.listen.v1.media.transcribe_file(
            request=audio_bytes,
            model="nova-3",
            language="en-US",
            smart_format=False,        # No need for punctuation/formatting
            keyterms=req.keyterms,     # Boost the 3 maze options
        )

        transcript = response.results.channels[0].alternatives[0].transcript
        confidence = response.results.channels[0].alternatives[0].confidence

        return {
            "transcript": transcript,
            "confidence": confidence,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Deepgram error: {e}")
```

**Key feature: `keyterms`** — Nova-3's keyterm prompting tells the model "listen for these specific words", dramatically improving accuracy when the student says one of the 3 options. This is purpose-built for constrained-vocabulary recognition.

### 7.3 Client-Side: Voice Activity Detection + Batch Send

Instead of the Web Speech API's event-driven model, we use a simple **record-detect-send** loop:

1. Start recording with `MediaRecorder` when round begins
2. Monitor mic volume with `AnalyserNode` (voice activity detection)
3. When speech is detected and then stops (600ms silence), extract the audio segment
4. Send to `/deepgram-maze` with the 3 options as keyterms
5. Match transcript against options
6. If match → lock answer. If no match → resume listening for next utterance

```javascript
class MazeASR {
  constructor(options, onMatch, onTranscript) {
    this.options = options;           // ['street', 'banana', 'quickly']
    this.onMatch = onMatch;           // callback(matchedWord)
    this.onTranscript = onTranscript; // callback(text) for live display
    this.stopped = false;
    this.stream = null;
    this.mediaRecorder = null;
    this.audioChunks = [];
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });

    // Voice activity detection via AnalyserNode
    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(this.stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    // Start recording immediately
    this.mediaRecorder = new MediaRecorder(this.stream, { mimeType: 'audio/webm;codecs=opus' });
    this.audioChunks = [];
    this.mediaRecorder.ondataavailable = e => { if (e.data.size > 0) this.audioChunks.push(e.data); };
    this.mediaRecorder.start(500); // collect chunks every 500ms

    // VAD loop
    let speaking = false;
    let silenceStart = null;
    const THRESHOLD = 30;
    const SILENCE_MS = 600;

    const poll = () => {
      if (this.stopped) return;
      analyser.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;

      if (avg > THRESHOLD) {
        speaking = true;
        silenceStart = null;
      } else if (speaking) {
        if (!silenceStart) silenceStart = Date.now();
        if (Date.now() - silenceStart > SILENCE_MS) {
          // Speech ended — send what we have
          speaking = false;
          silenceStart = null;
          this._sendCurrentAudio();
        }
      }
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  }

  async _sendCurrentAudio() {
    if (this.stopped || this.audioChunks.length === 0) return;

    const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
    this.audioChunks = []; // Reset for next utterance

    try {
      const base64 = await blobToBase64(blob);
      const resp = await fetch('http://localhost:8765/deepgram-maze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio_base64: base64, keyterms: this.options }),
        signal: AbortSignal.timeout(5000)
      });

      if (!resp.ok) return;
      const data = await resp.json();

      if (data.transcript) {
        this.onTranscript(data.transcript);
        const matched = matchSpokenWordToOptions(data.transcript, this.options);
        if (matched) {
          this.stop();
          this.onMatch(matched);
        }
      }
    } catch (e) {
      console.warn('[maze-asr] Recognition attempt failed:', e.message);
      // Keep listening — next utterance will try again
    }
  }

  stop() {
    this.stopped = true;
    if (this.mediaRecorder?.state === 'recording') this.mediaRecorder.stop();
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
  }
}
```

### 7.4 Word Matching — Best-Score Wins (No Option-Order Bias)

The previous design iterated options in display order, creating a bias toward the first option when fuzzy matching was involved. The fix: score all options and pick the highest-confidence match.

```javascript
function matchSpokenWordToOptions(transcript, options) {
  // transcript = what Deepgram heard (may be multiple words)
  // options = ['street', 'banana', 'quickly'] — the 3 displayed choices

  const words = transcript.toLowerCase().trim().split(/\s+/);
  let bestMatch = null;
  let bestScore = 0;

  for (const option of options) {
    const optNorm = option.toLowerCase();

    for (const word of words) {
      let score = 0;

      // Exact match — highest confidence
      if (word === optNorm) { score = 1.0; }
      // Canonical equivalence (word-equivalences.js)
      else if (getCanonical(word) === getCanonical(optNorm)) { score = 0.95; }
      // Homophone match
      else if (areHomophones(word, optNorm)) { score = 0.90; }
      // Fuzzy match (Levenshtein ratio)
      else {
        const ratio = levenshteinRatio(word, optNorm);
        if (ratio >= 0.75 && word.length >= 3) { score = ratio * 0.85; }
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = option;
      }
    }
  }

  // Require minimum confidence to accept
  return bestScore >= 0.60 ? bestMatch : null;
}
```

**Key improvement:** If Deepgram hears "stree" (garbled), and fuzzy matching gives `street` a score of 0.72 and `quickly` a score of 0.34, the old code would return whichever appeared first in the array. The new code correctly returns `street`.

### 7.5 Timing & Lifecycle

```
Round starts → MediaRecorder begins → VAD monitoring starts → 10s countdown starts
  ├── VAD detects speech end → send audio to /deepgram-maze
  │     ├── Deepgram returns transcript → matchSpokenWordToOptions()
  │     │     ├── Match found (score >= 0.60) → LOCK answer → stop recording → feedback → next round
  │     │     └── No match → resume listening (student said something off-list)
  │     └── Deepgram error → keep listening (next utterance will retry)
  ├── Timer reaches 0 → stop recording → mark as "timed out" → show correct answer → next round
  └── No speech detected in 10s → same as timeout
```

**Expected latency per recognition attempt:**
| Step | Time |
|------|------|
| Student speaks (1-2 words) | ~500ms |
| VAD silence detection | 600ms |
| base64 encode + HTTP round-trip | ~50ms |
| Deepgram Nova-3 transcription (2s clip) | ~500-1000ms |
| Match logic | <1ms |
| **Total from speech end to answer lock** | **~1.2-1.7s** |

This gives the student 2-3 attempts within the 10-second window if the first utterance doesn't match.

### 7.6 Fallback: Click Buttons (Backend Unavailable)

If the Reverb backend is not running or Deepgram is not configured, the game automatically falls back to clickable buttons (same as before). Detected at startup:

```javascript
async function checkASRAvailable() {
  try {
    const resp = await fetch('http://localhost:8765/health', { signal: AbortSignal.timeout(3000) });
    const data = await resp.json();
    return data.deepgram_configured === true;
  } catch {
    return false;
  }
}
```

### 7.7 Microphone Permissions

- The maze game opens in a new window on the **same origin** as the ORF tool
- If the user already granted mic permission for ORF recording, it carries over
- `getUserMedia` is the standard API — works on all modern browsers (Chrome, Firefox, Edge, Safari)
- No dependency on Chrome-only `webkitSpeechRecognition`

---

## 8. Game Flow & UI

### 8.1 Entry Point

After ORF assessment saves, the main page shows:

```
[ Watch Your Reading Adventure! ]  Difficulty: [Standard (3-5) ▾]  [ Maze Game ]
```

Clicking "Maze Game" passes data via URL query parameters (not localStorage — safe for multi-tab use):

```javascript
const difficulty = document.getElementById('mazeDifficulty').value;
const params = new URLSearchParams({ student: studentId, assessment: assessmentId, difficulty });
window.open('maze.html?' + params.toString(), 'orf_maze', 'width=700,height=500');
```

### 8.2 Screen 1 — Welcome

```
┌──────────────────────────────────────────────────┐
│                                                  │
│              Secret Password Game                │
│                                                  │
│    Read the sentence carefully.                  │
│    One word is missing — replaced by 3 options.  │
│    Speak the correct word to unlock the door!    │
│                                                  │
│    You have 10 seconds per round.                │
│    Choose wisely — your first answer is final!   │
│                                                  │
│                 [ Begin ]                        │
│                                                  │
└──────────────────────────────────────────────────┘
```

### 8.3 Screen 2 — Challenge Round (repeats 3x)

```
┌──────────────────────────────────────────────────┐
│  Round 1 of 3                             ⏱ 10   │
│                                                  │
│  "The dog ran ________ across the street         │
│   and jumped over the tall fence."               │
│                                                  │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│   │  street   │ │  banana  │ │ quickly  │        │
│   └──────────┘ └──────────┘ └──────────┘        │
│                                                  │
│          🎤 Say one of the three words...        │
│                                                  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░ (countdown bar)     │
│                                                  │
│  💬 Heard: "..."  (live transcript preview)      │
└──────────────────────────────────────────────────┘
```

**Key UI elements:**
- **The sentence** with a visible `________` blank
- **Three option cards** displayed horizontally, shuffled randomly
- **Countdown bar** animating from full to empty over 10 seconds (turns red at 3s)
- **Live transcript** showing what ASR is hearing (optional, for feedback/debugging)
- **Microphone indicator** showing ASR is active

**When ASR recognizes a choice:**
The matching option card highlights, locks in, and feedback appears:

```
┌──────────────────────────────────────────────────┐
│  Round 1 of 3                              ✓     │
│                                                  │
│  "The dog ran quickly across the street          │
│   and jumped over the tall fence."               │
│                                                  │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│   │  street   │ │  banana  │ │ quickly ✓│        │
│   └──────────┘ └──────────┘ └─ GREEN ───┘        │
│                                                  │
│          ✓ Correct! "quickly" is right!           │
│                                                  │
│                 [ Next → ]                       │
└──────────────────────────────────────────────────┘
```

**If wrong answer chosen:**

```
│   ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│   │ street ✗ │ │  banana  │ │ quickly ✓│        │
│   └── RED ───┘ └──────────┘ └─ GREEN ───┘        │
│                                                  │
│   ✗ Not quite! The answer was "quickly"          │
```

**If time runs out (no speech recognized):**

```
│   ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│   │  street   │ │  banana  │ │ quickly ✓│        │
│   └──────────┘ └──────────┘ └─ GREEN ───┘        │
│                                                  │
│   ⏱ Time's up! The answer was "quickly"          │
```

### 8.4 Screen 3 — Results

```
┌──────────────────────────────────────────────────┐
│                                                  │
│               Results: 2 / 3                     │
│                                                  │
│   Round 1: ✓ "quickly"   (said "quickly")        │
│   Round 2: ✓ "jumped"    (said "jumped")         │
│   Round 3: ✗ "fence"     (said "street")         │
│                                                  │
│                 [ Close ]                        │
│                                                  │
└──────────────────────────────────────────────────┘
```

### 8.5 Fallback Mode (Backend Unavailable)

When the Deepgram backend is unavailable (detected via health check at game load), the 3 option cards become **clickable buttons** instead:

```
│   🖱️ Click your answer:                          │
│                                                  │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│   │  street   │ │  banana  │ │ quickly  │        │
│   └──────────┘ └──────────┘ └──────────┘        │
```

Same rules apply: first click is final, 10-second timer, no retries.

### 8.6 Audio Feedback

Sound effects provide instant emotional feedback, especially important for K-2 students who may not read the text feedback quickly.

**Correct answer:** Play `audio files/1up.mp3` (existing asset — the Mario 1-up sound).

```javascript
const correctSound = new Audio('audio files/1up.mp3');
correctSound.volume = 0.5;

function playCorrectSound() {
  correctSound.currentTime = 0;
  correctSound.play().catch(() => {}); // Ignore autoplay blocks
}
```

**Wrong answer / timeout:** Generate a short descending two-tone "bwah-bwah" via Web Audio API (no audio file needed):

```javascript
function playWrongSound() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.value = 0.3;

  // Descending two-tone: 400Hz → 300Hz over 300ms
  osc.frequency.setValueAtTime(400, ctx.currentTime);
  osc.frequency.linearRampToValueAtTime(300, ctx.currentTime + 0.3);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.35);

  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.35);
}
```

**When sounds play:**

| Event | Sound | Visual |
|-------|-------|--------|
| Correct answer locked | `1up.mp3` | Green highlight on chosen card |
| Wrong answer locked | Descending tone | Red on chosen, green on correct |
| Timer expires (no answer) | Descending tone | Green on correct card |

**Countdown tick (last 3 seconds):** Optional — a soft tick sound at 3, 2, 1 using the same oscillator pattern at 800Hz for 50ms. Adds urgency without being annoying.

---

## 9. Data Model & Storage

Maze results are saved as an extension of the assessment object in IndexedDB:

```javascript
{
  // ... existing assessment fields ...

  mazeResults: {
    difficulty: 'standard',     // 'easy' | 'standard' | 'challenge'
    score: 2,                   // correct count
    total: 3,                   // always 3 (or less if passage too short)
    inputMode: 'deepgram',      // 'deepgram' (speech via proxy) | 'click' (fallback)
    items: [
      {
        sentence: "The dog ran quickly across the street.",
        blankSentence: "The dog ran ________ across the street.",
        targetWord: "quickly",
        targetIndex: 3,           // word position in sentence
        options: ["street", "banana", "quickly"],  // shuffled order shown
        correctIndex: 2,          // index of correct answer in options array
        chosen: "quickly",        // what the student selected
        chosenIndex: 2,           // index they chose in options array
        correct: true,
        matchType: "exact",       // exact | equivalent | homophone | near
        transcript: "quickly",    // raw ASR transcript
        responseTimeMs: 3200,     // time from round start to answer
        timedOut: false
      },
      // ... 2 more items
    ],
    timestamp: "2026-02-06T21:00:00Z"
  }
}
```

---

## 10. Homophone & Edge Case Handling

### 10.1 Homophones

Since the student is choosing between 3 options and speaking aloud, homophones create a special challenge: if two options sound the same, ASR can't tell which the student meant.

**Guard:** During distractor generation, ensure no distractor is a homophone of the correct answer. Built-in homophone lookup:

```javascript
const HOMOPHONE_GROUPS = [
  ['their', 'there', "they're"],
  ['to', 'too', 'two'],
  ['your', "you're"],
  ['its', "it's"],
  ['hear', 'here'],
  ['write', 'right'],
  ['no', 'know'],
  ['new', 'knew'],
  ['one', 'won'],
  ['see', 'sea'],
  ['would', 'wood'],
  ['flower', 'flour'],
  ['bear', 'bare'],
  ['peace', 'piece'],
  ['wear', 'where'],
  ['son', 'sun'],
  ['rode', 'road'],
  ['tale', 'tail'],
  ['meet', 'meat'],
  ['break', 'brake']
];
```

If a candidate distractor is a homophone of the correct word, reject it and pick another.

### 10.2 Proper Nouns

Excluded as targets. ASR can't reliably distinguish names, and testing recall of character names tests memory, not comprehension.

### 10.3 Numbers

Excluded as targets. "2" vs "two" vs "to" creates ASR ambiguity.

### 10.4 Very Short Passages

- Passage < 15 words → maze button not shown at all
- Passage < 3 sentences → attempt comma/semicolon splitting for clause-level items
- Still < 3 viable items → show 1-2 rounds with "limited check" message

### 10.5 Compound Words

If the ORF alignment identified a compound word (e.g., "everyone" = "every" + "one"), it's still a valid maze target. For ASR verification, accept both the compound form and split forms.

---

## 11. Maze Item Data Structure

The `generateMazeItems()` function returns:

```javascript
[
  {
    sentence: "The dog ran quickly across the street.",
    blankSentence: "The dog ran ________ across the street.",
    targetWord: "quickly",
    targetIndex: 3,
    sentenceIndex: 0,
    score: 7,
    options: ["quickly", "banana", "street"],    // unshuffled
    shuffledOptions: ["street", "banana", "quickly"],  // shuffled for display
    correctShuffledIndex: 2
  },
  // ... 2 more
]
```

### 11.1 Deterministic Generation

The algorithm is deterministic given the same passage + NL annotations + difficulty. Same inputs always produce the same maze items. Option shuffling uses a seeded PRNG (assessment ID as seed) so replays show consistent order.

---

## 12. Complete `maze-generator.js` API

### Exports

```javascript
export function generateMazeItems(passageText, nlAnnotations, difficulty)
// → Array of maze items (up to 3)

export function verifyMazeResponse(spokenTranscript, options, correctWord)
// → { matched: string|null, correct: boolean, matchType: string }

export function canRunMaze(passageText)
// → boolean (true if passage is long enough)
```

### Internal Functions

```javascript
splitIntoSentences(passageText)
scoreSentence(sentence, sentIdx, totalSentences)
selectWithSpread(scoredSentences, targetCount)
isEligibleTarget(word, wordIdx, sentenceLength, nlAnnotations, sentIdx, profile)
scoreCandidate(word, wordIdx, sentenceLength, passageText, nlAnnotations, sentIdx, profile)
generateDistractors(targetWord, targetSentIdx, sentences, nlAnnotations, profile)
areHomophones(wordA, wordB)
pickFromBuiltinPool(pos, excludeWord)
seededShuffle(array, seed)
```

---

## 13. Complete `maze-game.js` State Machine

```
States:
  LOADING    → Read assessment from IndexedDB, generate maze items
  WELCOME    → Show instructions + "Begin" button
  ROUND_ACTIVE → Show sentence + 3 options + countdown + ASR listening
  FEEDBACK   → Show right/wrong feedback + "Next" button
  RESULTS    → Show final score + "Close" button

Transitions:
  LOADING → WELCOME (items generated successfully)
  LOADING → ERROR   (assessment not found or passage too short)
  WELCOME → ROUND_ACTIVE (user clicks "Begin")
  ROUND_ACTIVE → FEEDBACK (ASR matched an option OR timer expired)
  FEEDBACK → ROUND_ACTIVE (user clicks "Next", if more rounds remain)
  FEEDBACK → RESULTS (user clicks "Next" after final round)
  RESULTS → (window closes)
```

### ASR Lifecycle Per Round (Deepgram Mode)

```javascript
function startRound(item) {
  state = 'ROUND_ACTIVE';
  renderSentence(item.blankSentence);
  renderOptions(item.shuffledOptions);

  let answered = false;
  const startTime = Date.now();

  // Start Deepgram-based ASR with keyterm boosting
  const asr = new MazeASR(
    item.shuffledOptions,
    // onMatch — answer locked in
    (matched) => {
      if (answered) return;
      answered = true;
      clearTimeout(timer);

      const correct = matched.toLowerCase() === item.targetWord.toLowerCase();
      if (correct) playCorrectSound(); else playWrongSound();
      showFeedback(matched, item.targetWord, correct, Date.now() - startTime);
    },
    // onTranscript — live display of what Deepgram heard
    (text) => updateLiveTranscript(text)
  );
  asr.start();

  // 10-second timer
  const timer = setTimeout(() => {
    if (!answered) {
      answered = true;
      asr.stop();
      playWrongSound();
      showFeedback(null, item.targetWord, false, 10000, true); // timed out
    }
  }, 10000);

  // Visual + audio countdown
  startCountdownBar(10);
}
```

### ASR Lifecycle Per Round (Click Fallback Mode)

When Deepgram is unavailable, option cards become clickable buttons:

```javascript
function startRoundClickMode(item) {
  state = 'ROUND_ACTIVE';
  renderSentence(item.blankSentence);
  renderOptions(item.shuffledOptions, { clickable: true });

  let answered = false;
  const startTime = Date.now();

  for (const btn of document.querySelectorAll('.maze-option')) {
    btn.addEventListener('click', () => {
      if (answered) return;
      answered = true;
      clearTimeout(timer);

      const chosen = btn.dataset.word;
      const correct = chosen.toLowerCase() === item.targetWord.toLowerCase();
      if (correct) playCorrectSound(); else playWrongSound();
      showFeedback(chosen, item.targetWord, correct, Date.now() - startTime);
    });
  }

  const timer = setTimeout(() => {
    if (!answered) {
      answered = true;
      playWrongSound();
      showFeedback(null, item.targetWord, false, 10000, true);
    }
  }, 10000);

  startCountdownBar(10);
}
```

---

## 14. CSS Design (`maze.css`)

Key visual elements:

- **Option cards**: Rounded rectangles with subtle shadow, hover effect, ~120px wide
- **Blank in sentence**: Highlighted with dashed underline or background color
- **Countdown bar**: Full-width bar at bottom, animated width transition, turns red at 3s
- **Correct feedback**: Green border/background on the correct option card
- **Wrong feedback**: Red border on chosen card, green border on correct card
- **Microphone indicator**: Pulsing red dot when ASR is active
- **Live transcript**: Small gray text below options showing what ASR is hearing

Color palette (consistent with existing app):
- Correct: `#4caf50` (green)
- Wrong: `#f44336` (red)
- Active/listening: `#7b1fa2` (purple — matches the Maze Game button)
- Countdown warning: `#ff9800` → `#f44336` (orange → red)

---

## 15. Implementation Order

1. **`services/reverb/server.py`** — Add `/deepgram-maze` endpoint with keyterm prompting. Test with curl to verify latency and accuracy on short audio clips.

2. **`js/maze-generator.js`** — Pure logic: robust sentence extraction, word selection, distractor generation, verification. No UI. Can be unit-tested with sample passages.

3. **`maze.html` + `css/maze.css`** — Game shell: welcome screen, round layout, results screen, audio feedback. Static structure.

4. **`js/maze-game.js`** — Game engine: state machine, `MazeASR` class (Deepgram + VAD), click fallback, countdown timer, audio feedback, results display. Imports from `maze-generator.js` and `storage.js`.

5. **`js/app.js` modifications** — Add difficulty dropdown + "Maze Game" button after assessment save. Add `canRunMaze()` check to conditionally show the button. Use URL query params for data passing.

6. **`index.html`** — Update version timestamp.

---

## 16. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Reverb backend not running | Health check at maze load → auto-fallback to click mode |
| Deepgram API unavailable / key expired | Same health check → click fallback. Error message shown. |
| Deepgram mishears the chosen word | Keyterm boosting dramatically reduces errors; multi-layered matching (exact → canonical → homophone → fuzzy with best-score wins) as safety net |
| ~1-2s latency per recognition attempt | Acceptable within 10s window; student gets 2-3 attempts. VAD minimizes wasted time on silence. |
| ASR recognizes a word not in the 3 options | Ignored — keep listening until one of the 3 is matched |
| Two distractors sound the same as correct answer | Homophone guard during distractor generation |
| Passage too short for 3 items | Graceful degradation to 1-2 items, or button hidden entirely |
| Student speaks before understanding the sentence | That's their choice — first match is final, testing comprehension |
| Abbreviations / dialogue / decimals in passage | Robust sentence splitter with abbreviation/decimal protection and dialogue-aware boundaries |
| Multiple tabs with different students | URL query params (not localStorage) prevent cross-tab data clobbering |
| Deepgram cost for many students | ~$0.002 per clip × 3 rounds × 3 attempts max ≈ $0.02 per game session. Negligible. |

---

## 17. Gap Analysis: ORF + Maze

Once both assessments are complete, the teacher can compare:

| Pattern | ORF Score | Maze Score | Interpretation |
|---------|-----------|------------|----------------|
| Strong reader | High WCPM | 3/3 | Fluent and comprehending |
| Word caller | High WCPM | 0-1/3 | Reads fast but doesn't understand |
| Struggling but comprehending | Low WCPM | 2-3/3 | Decoding issues, comprehension intact |
| Struggling all around | Low WCPM | 0-1/3 | Foundational intervention needed |

This diagnostic information is displayed on the results screen and saved with the assessment for teacher review.
