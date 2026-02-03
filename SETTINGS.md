# Google Cloud STT Settings — ORF Assessment

All settings applied in `orf_assessment.html` and why each matters for Oral Reading Fluency.

---

## Recognition Config

| Setting | Value | Why It Matters |
|---|---|---|
| `model` | `"latest_long"` | Best general-purpose model for verbatim fidelity. Preserves disfluencies (um, uh), false starts, and repetitions better than other models. |
| `useEnhanced` | `true` | Uses the enhanced version of the model with higher accuracy. Required for `latest_long` to perform optimally. |
| `languageCode` | `"en-US"` | Target language. Change if assessing students who read in another language. |
| `encoding` | `(auto-detected)` | Set per file type: `WEBM_OPUS` for mic recording, `LINEAR16` for WAV, `FLAC`, `MP3`, `OGG_OPUS`. |

## Verbatim / Raw Output Settings

| Setting | Value | Why It Matters |
|---|---|---|
| `enableAutomaticPunctuation` | `false` | **CRITICAL.** Prevents the API from inserting commas, periods, etc. into the transcript. We need the raw word stream with no editorial additions. |
| `enableSpokenPunctuation` | `false` | **CRITICAL.** Prevents the word "period" from being converted to `.` and "comma" to `,`. If a student says "period" aloud, it stays as the word "period". |

## Word-Level Analysis Settings

| Setting | Value | Why It Matters |
|---|---|---|
| `enableWordTimeOffsets` | `true` | **CRITICAL.** Returns `startTime` and `endTime` for every word. Needed for: (1) alignment with reference passage, (2) detecting pauses/hesitations between words, (3) computing words-per-minute pacing. |
| `enableWordConfidence` | `true` | **CRITICAL.** Returns a 0.0–1.0 confidence score per word. Low confidence typically indicates a stutter, mumble, mispronunciation, or unclear speech — exactly what ORF assessment needs to flag. |

## Alternative Hypotheses

| Setting | Value | Why It Matters |
|---|---|---|
| `maxAlternatives` | `2` | Returns the model's second-best transcript for each utterance. Use cases: (1) When a child says "the the cat" and the top result normalizes to "the cat", the alternative may preserve the repetition. (2) Ambiguous mispronunciations — if a child says "dat" for "that", one alternative may show the substitution the other missed. |

## Passage-Aware Boosting

| Setting | Value | Why It Matters |
|---|---|---|
| `speechContexts` | `[{ phrases: [<words from passage>], boost: 5 }]` | **Dynamically built** from the reference passage text field. Extracts unique words and tells the recognizer to favor them. This dramatically improves recognition of passage-specific vocabulary (proper nouns, unusual words) that the model might otherwise mishear. `boost: 5` is moderate — high enough to help, low enough to not mask genuine mispronunciations. Only active when a reference passage is provided. |

---

## Settings NOT Changed (defaults kept intentionally)

| Setting | Default | Why We Keep It |
|---|---|---|
| `enableSeparateRecognitionPerChannel` | `false` | Single-channel audio (one student reading). |
| `diarizationConfig` | off | Single speaker, no need to separate voices. |
| `adaptation` | none | No custom phrase sets beyond `speechContexts`. We want raw recognition, not trained bias. |
| `profanityFilter` | `false` | Must not censor any words — we need verbatim output. (This is the default.) |
| `sampleRateHertz` | auto-detected | Let the API detect from the audio header. |

---

## API Endpoint

```
POST https://speech.googleapis.com/v1/speech:recognize?key=YOUR_KEY
```

- **Synchronous** — supports up to ~1 minute of audio.
- For longer passages, switch to `longrunningrecognize` (not yet implemented).
- If `enableSpokenPunctuation` throws an error on v1, switch to `v1p1beta1`.

---

## Full Config as Sent to API (annotated)

```jsonc
{
  "config": {
    "encoding": "WEBM_OPUS",
    "languageCode": "en-US",

    // MODEL SELECTION
    // "latest_long" is a solid choice for verbatim fidelity. Alternatives worth
    // considering: AssemblyAI with disfluencies=true, or Whisper. But the real
    // clinical power comes from the alignment/diff step (Phase 2), not the STT
    // model alone.
    "model": "latest_long",
    "useEnhanced": true,

    // VERBATIM OUTPUT — these two are the most important settings
    "enableAutomaticPunctuation": false,  // CRITICAL: Stops it from inserting logical commas/periods
    "enableSpokenPunctuation": false,     // CRITICAL: Stops "period" from becoming "."

    // WORD-LEVEL DATA — required for alignment algorithm and pause detection
    "enableWordTimeOffsets": true,        // CRITICAL: Needed for alignment algorithm & pacing analysis
    "enableWordConfidence": true,         // CRITICAL: Low confidence usually = stutter/mumble/mispronunciation

    // ALTERNATIVE HYPOTHESES
    // Returns the model's second-best guess for each utterance. When a child
    // says "the the cat" and the top result comes back as "the cat", the
    // alternative might preserve the repetition. Also useful for ambiguous
    // mispronunciations — if the child says "dat" for "that", one alternative
    // might show the substitution the other missed.
    "maxAlternatives": 2,

    // PASSAGE-AWARE BOOSTING
    // Dynamically built from the reference passage. Extracts unique words and
    // tells the recognizer to favor them. boost: 5 is moderate — high enough
    // to help with passage-specific vocabulary (proper nouns, unusual words),
    // low enough to not mask genuine mispronunciations.
    // NOTE: One thing that was missing from our initial config — this matters
    // because without it, the model has no context about what the student is
    // supposed to be reading and may mishear domain-specific words.
    //
    // ⚠ CAUTION: Since you already know the expected passage, boosting those
    // words helps accuracy — but it's a double-edged sword. It biases the
    // model toward the expected words, which could cause it to "correct" a
    // mispronunciation into the right word. You'd need to test whether the
    // accuracy gain outweighs the verbatim loss. For clinical use, I'd lean
    // toward not boosting or using a very low boost value.
    "speechContexts": [
      {
        "phrases": ["the", "cat", "sat", "on", "mat"],
        "boost": 5
      }
    ]
  },
  "audio": {
    "content": "<base64-encoded audio>"
  }
}
```

*(speechContexts only included when a reference passage is entered)*

---

## Google Cloud Natural Language API Settings

The app also calls the NL API to annotate each reference word with linguistic metadata. Two endpoints are used:

### analyzeSyntax
```
POST https://language.googleapis.com/v1/documents:analyzeSyntax?key=KEY
```
Returns per-token POS tags (NOUN, VERB, ADJ, DET, PRON, etc.), proper noun flag, and lemma. Used for word tier classification and proper noun detection.

### analyzeEntities
```
POST https://language.googleapis.com/v1/documents:analyzeEntities?key=KEY
```
Returns named entities (PERSON, LOCATION, ORGANIZATION, WORK_OF_ART, EVENT) with text offset mentions. Used to identify proper nouns that POS tagging alone might miss.

### Word Tier Classification

Each reference word is classified into one of four tiers based on NL API results:

| Tier | Criteria | Purpose |
|------|----------|---------|
| `proper` | POS proper flag or entity type is PERSON/LOCATION/ORGANIZATION/WORK_OF_ART/EVENT | ASR healing and forgiveness — proper nouns are often mispronounced or misrecognized |
| `sight` | Word is in Dolch/Fry top-220 high-frequency list | Identifies basic sight word errors for RTI targeting |
| `academic` | NOUN/VERB/ADJ/ADV that isn't sight or proper | Content words indicating vocabulary/decoding challenges |
| `function` | DET, PRON, CONJ, ADP, etc. | Function words (determiners, prepositions, etc.) |

### ASR Healing

Proper noun substitutions with >50% Levenshtein similarity are automatically reclassified as correct ("healed"). This reduces false errors caused by STT misrecognizing names like "Hermione" → "herminy".

---

## Design Decisions & Notes

**Why `latest_long` over other models?**
For maximum verbatim fidelity (repetitions, false starts, filler words like "um", "uh"), `latest_long` with no adaptation/boosting gives the rawest output. Other models like `phone_call` or `medical_dictation` are tuned for different domains and may normalize speech in ways that hide the disfluencies we need.

**Why not higher boost values?**
A `boost` of 5 is deliberately moderate. If we boosted too aggressively, the model would force-fit every unclear utterance to a passage word, hiding the very mispronunciations and substitutions we're trying to detect. The goal is to help the model with vocabulary it wouldn't otherwise know, not to override its judgment on what was actually said.

**Why `maxAlternatives: 2` and not more?**
Two alternatives strike the right balance. The first alternative is the model's best guess; the second catches most cases where repetitions or mispronunciations were normalized away. More alternatives add noise without much clinical value — by the third guess, confidence is usually too low to be useful.
