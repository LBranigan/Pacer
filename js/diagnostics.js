// diagnostics.js — Fluency diagnostic analyzers, near-miss resolution, plus orchestrator

import { levenshteinRatio } from './nl-api.js';
import { countSyllables } from './syllable-counter.js';
import { getPhonemeCountWithFallback, PHONEMES_PER_SYLLABLE_RATIO } from './phoneme-counter.js';

// ── Helpers ──────────────────────────────────────────────────────────

/** Parse STT time string "1.200s" to float seconds. */
export function parseTime(t) {
  return parseFloat(String(t).replace('s', '')) || 0;
}

/**
 * Compute the longest contiguous silence between two timestamps,
 * subtracting Reverb-timestamped speech from skipped (unconfirmed) words.
 * Unconfirmed words lack cross-validator timestamps but still have valid
 * Reverb timestamps showing the student was actively speaking.
 */
function longestSilenceInGap(gapStart, gapEnd, skippedWords) {
  if (!skippedWords || skippedWords.length === 0) return gapEnd - gapStart;

  // Collect speech intervals clamped to gap boundaries
  const intervals = [];
  for (const sw of skippedWords) {
    const sStart = parseTime(sw._reverbStartTime || sw.startTime);
    const sEnd = parseTime(sw._reverbEndTime || sw.endTime);
    if (sEnd > sStart && sStart < gapEnd && sEnd > gapStart) {
      intervals.push([Math.max(sStart, gapStart), Math.min(sEnd, gapEnd)]);
    }
  }

  if (intervals.length === 0) return gapEnd - gapStart;

  // Merge overlapping intervals
  intervals.sort((a, b) => a[0] - b[0]);
  const merged = [intervals[0].slice()];
  for (let m = 1; m < intervals.length; m++) {
    const last = merged[merged.length - 1];
    if (intervals[m][0] <= last[1]) {
      last[1] = Math.max(last[1], intervals[m][1]);
    } else {
      merged.push(intervals[m].slice());
    }
  }

  // Find longest silence: before first speech, between speech blocks, after last speech
  let maxSilence = merged[0][0] - gapStart;
  for (let m = 1; m < merged.length; m++) {
    maxSilence = Math.max(maxSilence, merged[m][0] - merged[m - 1][1]);
  }
  maxSilence = Math.max(maxSilence, gapEnd - merged[merged.length - 1][1]);

  return maxSilence;
}

/**
 * Scan referenceText for trailing punctuation on each word.
 * Returns Map<refWordIndex, 'period'|'comma'>.
 */
export function getPunctuationPositions(referenceText) {
  // Mirror normalizeText's trailing-hyphen merge AND internal-hyphen split so indices
  // align with alignment entries. Without this, OCR artifacts and hyphenated words
  // create index offsets that shift all subsequent punctuation positions.
  const rawTokens = referenceText.trim().split(/\s+/);
  const merged = [];
  for (let i = 0; i < rawTokens.length; i++) {
    const clean = rawTokens[i].replace(/^[^\w'-]+|[^\w'-]+$/g, '');
    if (clean.length === 0) continue;
    if (clean.endsWith('-') && i + 1 < rawTokens.length) {
      merged.push(rawTokens[i + 1]); // second part may carry trailing punct
      i++;
    } else {
      merged.push(rawTokens[i]);
    }
  }
  // Split internal-hyphen tokens: "smooth-on-skin." → ["smooth", "on", "smooth-on-skin."]
  // Last part keeps original token so trailing punctuation is preserved for the regex.
  // Exception: single-letter parts join instead (e-mail → email).
  const words = [];
  for (const token of merged) {
    const stripped = token.replace(/^[^\w'-]+|[^\w'-]+$/g, '');
    if (stripped.includes('-')) {
      const parts = stripped.split('-').filter(p => p.length > 0);
      if (parts.some(p => p.length === 1)) {
        // Single-letter part (e-mail) → keep as one token (use original for punct)
        words.push(token);
      } else {
        for (let j = 0; j < parts.length - 1; j++) words.push(parts[j]);
        words.push(token); // last part: original token preserves trailing punct
      }
    } else {
      words.push(token);
    }
  }
  const map = new Map();
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    // Strip trailing quotes/brackets before checking (dialogue punctuation fix)
    const stripped = w.replace(/["'""\u201C\u201D\u2018\u2019)}\]]+$/, '');
    if (stripped.length === 0) continue;
    const last = stripped[stripped.length - 1];
    if (/[.!?]/.test(last)) {
      map.set(i, 'period');
    } else if (last === ':') {
      map.set(i, 'colon');
    } else if (/[,;]/.test(last)) {
      map.set(i, 'comma');
    }
  }
  return map;
}

/**
 * Build a map from hypothesis word index to reference word index
 * by walking alignment operations.
 */
export function buildHypToRefMap(alignment) {
  const map = new Map();
  let refIndex = 0;
  let hypIndex = 0;
  for (const op of alignment) {
    const type = op.type || op.operation;
    if (type === 'insertion') {
      // hyp word with no ref counterpart
      hypIndex++;
    } else if (type === 'omission' || type === 'deletion') {
      // ref word with no hyp counterpart
      refIndex++;
    } else {
      // correct, substitution, or struggle — all advance both indices
      map.set(hypIndex, refIndex);
      refIndex++;
      hypIndex++;
    }
  }
  return map;
}

// ── Near-Miss Detection ─────────────────────────────────────────────

/**
 * Check if an insertion is a near-miss for a reference word.
 * Near-miss = phonetically/morphologically similar (student was attempting the word).
 *
 * @param {string} insertionText - The inserted word text
 * @param {string} referenceWord - The reference word to compare against
 * @returns {boolean} True if the insertion is a near-miss for the reference word
 */
export function isNearMiss(insertionText, referenceWord) {
  const cleanA = (insertionText || '').toLowerCase().replace(/[^a-z']/g, '');
  const cleanB = (referenceWord || '').toLowerCase().replace(/[^a-z']/g, '');

  // Hard gate: both must be >= 3 chars
  if (cleanA.length < 3 || cleanB.length < 3) return false;

  const minLen = Math.min(cleanA.length, cleanB.length);

  // Check shared prefix >= 3 chars
  let prefixLen = 0;
  while (prefixLen < minLen && cleanA[prefixLen] === cleanB[prefixLen]) {
    prefixLen++;
  }
  if (prefixLen >= 3) return true;

  // Check shared suffix >= 3 chars
  let suffixLen = 0;
  while (suffixLen < minLen && cleanA[cleanA.length - 1 - suffixLen] === cleanB[cleanB.length - 1 - suffixLen]) {
    suffixLen++;
  }
  if (suffixLen >= 3) return true;

  // Check Levenshtein ratio >= 0.4
  if (levenshteinRatio(cleanA, cleanB) >= 0.4) return true;

  return false;
}

/**
 * Single-pass cluster resolution: detect near-miss insertions around substitutions
 * and upgrade substitutions to 'struggle' (Path 2: decoding struggle).
 *
 * Also detects near-miss self-corrections (insertion before a correct word).
 *
 * Must run AFTER omission recovery so recovered words can serve as self-correction anchors.
 *
 * @param {Array} alignment - Alignment entries (mutated in place)
 */
export function resolveNearMissClusters(alignment) {
  const clean = (text) => (text || '').toLowerCase().replace(/[^a-z']/g, '');

  for (let i = 0; i < alignment.length; i++) {
    const entry = alignment[i];
    if (entry.type !== 'insertion') continue;

    const cleanedHyp = clean(entry.hyp);
    if (cleanedHyp.length < 3) continue;

    // Find nearest preceding non-insertion entry
    let prevEntry = null;
    for (let j = i - 1; j >= 0; j--) {
      if (alignment[j].type !== 'insertion') {
        prevEntry = alignment[j];
        break;
      }
    }

    // Find nearest following non-insertion entry
    let nextEntry = null;
    for (let j = i + 1; j < alignment.length; j++) {
      if (alignment[j].type !== 'insertion') {
        nextEntry = alignment[j];
        break;
      }
    }

    // PRIORITY 1 — Self-correction (look ahead for success)
    if (nextEntry && nextEntry.type === 'correct' &&
        clean(nextEntry.ref).length >= 3 &&
        isNearMiss(entry.hyp, nextEntry.ref)) {
      entry._isSelfCorrection = true;
      entry._nearMissTarget = nextEntry.ref;
      continue;
    }

    // PRIORITY 2 — Pre-struggle (look ahead for failure)
    if (nextEntry && (nextEntry.type === 'substitution' || nextEntry.type === 'struggle') &&
        clean(nextEntry.ref).length >= 3 &&
        isNearMiss(entry.hyp, nextEntry.ref)) {
      entry._partOfStruggle = true;
      entry._nearMissTarget = nextEntry.ref;
      if (!nextEntry._nearMissEvidence) nextEntry._nearMissEvidence = [];
      nextEntry._nearMissEvidence.push(entry.hyp);
      continue;
    }

    // PRIORITY 3 — Post-struggle (look behind for failure)
    if (prevEntry && (prevEntry.type === 'substitution' || prevEntry.type === 'struggle') &&
        clean(prevEntry.ref).length >= 3 &&
        isNearMiss(entry.hyp, prevEntry.ref)) {
      entry._partOfStruggle = true;
      entry._nearMissTarget = prevEntry.ref;
      if (!prevEntry._nearMissEvidence) prevEntry._nearMissEvidence = [];
      prevEntry._nearMissEvidence.push(entry.hyp);
      continue;
    }
  }

  // After the pass — upgrade substitutions with near-miss evidence
  // Skip entries already classified as struggle (e.g. Path 4 divergence)
  for (const entry of alignment) {
    if (entry._nearMissEvidence && entry._nearMissEvidence.length > 0 && entry.type !== 'struggle') {
      entry._originalType = entry.type;
      entry.type = 'struggle';
      entry._strugglePath = 'decoding';
    }
  }
}

// ── Fragment Absorption (Temporal Containment) ──────────────────────

/**
 * Absorb BPE fragments of mispronounced words into their parent struggle/substitution.
 * Simplified version: uses temporal containment only. Substitution entries already
 * carry Parakeet timestamps from reference-anchored cross-validation (Plan 5),
 * so no separate cross-engine pairing or xvalRawWords parameter is needed.
 *
 * Must run AFTER resolveNearMissClusters (which handles text-similarity absorption)
 * and AFTER omission recovery (which adjusts hypIndex values).
 *
 * @param {Array} alignment - Alignment entries (mutated in place)
 * @param {Array} transcriptWords - STT words with timestamps
 */
export function absorbMispronunciationFragments(alignment, transcriptWords) {
  const TOLERANCE_S = 0.15;
  const MAX_FRAG_LEN = 4;

  // Collect substitutions/struggles with their timestamp windows.
  // _xvalStartTime/_xvalEndTime on alignment entries (set by crossValidateByReference).
  // _reverbStartTime/_reverbEndTime on transcriptWords (accessed via hypIndex).
  const subs = [];
  for (let i = 0; i < alignment.length; i++) {
    const entry = alignment[i];
    if (entry.type !== 'substitution' && entry.type !== 'struggle') continue;
    const tw = (entry.hypIndex != null && entry.hypIndex >= 0) ? transcriptWords[entry.hypIndex] : null;
    const startS = parseTime(entry._xvalStartTime || tw?._reverbStartTime || tw?.startTime);
    const endS = parseTime(entry._xvalEndTime || tw?._reverbEndTime || tw?.endTime);
    if (startS == null || endS == null || startS >= endS) continue;
    subs.push({ index: i, entry, startS, endS });
  }

  if (subs.length === 0) return;

  // Check each insertion: if it's a short fragment temporally inside a substitution's window, absorb it
  for (const entry of alignment) {
    if (entry.type !== 'insertion') continue;
    if (entry._partOfStruggle || entry._isSelfCorrection) continue;
    const hyp = entry.hyp || '';
    if (hyp.replace(/[^a-zA-Z]/g, '').length > MAX_FRAG_LEN) continue;

    if (entry.hypIndex == null || entry.hypIndex < 0) continue;
    const tw = transcriptWords[entry.hypIndex];
    if (!tw) continue;
    const fragStartS = parseTime(tw._reverbStartTime || tw.startTime);
    if (fragStartS == null) continue;

    for (const sub of subs) {
      if (fragStartS >= sub.startS - TOLERANCE_S && fragStartS <= sub.endS + TOLERANCE_S) {
        entry._partOfStruggle = true;
        break;
      }
    }
  }
}

// ── DIAG-01: Onset Delays (Hesitations) ─────────────────────────────

/**
 * Detect inter-word gaps indicating hesitations.
 * Flags gaps between 500ms-3000ms as hesitations (not errors).
 * Punctuation adjusts the threshold:
 *   - After period/!/?: threshold is 1200ms
 *   - After comma: threshold is 800ms
 *   - Otherwise: threshold is 500ms
 * Returns array of { wordIndex, word, gap, threshold, punctuationType }.
 */
export function detectOnsetDelays(transcriptWords, referenceText, alignment) {
  const results = [];

  // Build punctuation map and hyp->ref map for threshold adjustments
  const punctMap = referenceText ? getPunctuationPositions(referenceText) : new Map();
  const hypToRef = alignment ? buildHypToRefMap(alignment) : new Map();

  for (let i = 0; i < transcriptWords.length; i++) {
    const w = transcriptWords[i];
    const start = parseTime(w.startTime);
    let gap;

    // Skip first word entirely - no hesitation detection
    // (timer will be aligned to first word start, so no "delay" is possible)
    if (i === 0) {
      continue;
    }

    // Skip unconfirmed words — they have unreliable Reverb timestamps (100ms BPE)
    // and shouldn't be used as gap boundaries or flagged as hesitations.
    // Cross-validator is the primary timekeeper; unconfirmed words lack cross-validator timestamps.
    if (w.crossValidation === 'unconfirmed') {
      continue;
    }

    // Find the effective previous word by skipping over unconfirmed words
    // (their timestamps are unreliable for gap calculation)
    let prevIdx = i - 1;
    while (prevIdx >= 0 && transcriptWords[prevIdx].crossValidation === 'unconfirmed') {
      prevIdx--;
    }
    if (prevIdx < 0) continue; // All preceding words were unconfirmed

    const prevEnd = parseTime(transcriptWords[prevIdx].endTime);
    gap = start - prevEnd;

    // Cross-check with Reverb timestamps: Parakeet may have a decoding blackout
    // where its NW alignment shifts timestamps, creating phantom gaps.
    const rEnd = parseTime(transcriptWords[prevIdx]._reverbEndTime);
    const rStart = parseTime(w._reverbStartTime);
    if (rEnd != null && rStart != null && rStart > rEnd) {
      gap = Math.min(gap, rStart - rEnd);
    }

    // If unconfirmed words were skipped, their Reverb-timestamped speech
    // may fill the gap — use the actual longest silence instead
    if (i - prevIdx > 1) {
      const skipped = transcriptWords.slice(prevIdx + 1, i);
      gap = Math.min(gap, longestSilenceInGap(prevEnd, start, skipped));
    }

    // Determine threshold based on punctuation after previous word
    let threshold = 0.5; // 500ms default
    let punctuationType = null;
    const prevRefIdx = hypToRef.get(prevIdx);
    if (prevRefIdx !== undefined && punctMap.has(prevRefIdx)) {
      punctuationType = punctMap.get(prevRefIdx);
      if (punctuationType === 'period') {
        threshold = 1.2; // 1200ms after sentence-ending punctuation
      } else if (punctuationType === 'comma') {
        threshold = 0.8; // 800ms after comma
      }
    }

    // Flag hesitations: gap >= threshold AND gap < 3s (3s+ handled by long pause)
    if (gap >= threshold && gap < 3) {
      results.push({
        wordIndex: i,
        word: w.word,
        gap: Math.round(gap * 1000) / 1000,
        threshold,
        punctuationType
      });
    }
  }
  return results;
}

// ── DIAG-02: Long Pauses ────────────────────────────────────────────

/**
 * Detect pauses >= 3s between words.
 * Any pause of 3 seconds or longer is flagged as an error.
 * Returns array of { afterWordIndex, gap }.
 */
export function detectLongPauses(transcriptWords) {
  const results = [];

  for (let i = 0; i < transcriptWords.length - 1; i++) {
    // Skip unconfirmed words as gap start — unreliable Reverb timestamps
    if (transcriptWords[i].crossValidation === 'unconfirmed') continue;

    // Find next non-unconfirmed word for gap end
    let nextIdx = i + 1;
    while (nextIdx < transcriptWords.length && transcriptWords[nextIdx].crossValidation === 'unconfirmed') {
      nextIdx++;
    }
    if (nextIdx >= transcriptWords.length) continue;

    const end = parseTime(transcriptWords[i].endTime);
    const nextStart = parseTime(transcriptWords[nextIdx].startTime);
    const rawGap = nextStart - end;

    if (rawGap >= 3) {
      let effectiveGap = rawGap;

      // Cross-check with Reverb timestamps: Parakeet may have a decoding blackout
      // where its NW alignment shifts timestamps, creating phantom gaps.
      // If Reverb timestamps show a much shorter gap, use those instead.
      const rEnd = parseTime(transcriptWords[i]._reverbEndTime);
      const rStart = parseTime(transcriptWords[nextIdx]._reverbStartTime);
      if (rEnd != null && rStart != null && rStart > rEnd) {
        effectiveGap = Math.min(effectiveGap, rStart - rEnd);
      }

      // If unconfirmed words were skipped, their Reverb-timestamped speech
      // may fill the gap — use the actual longest silence instead
      if (nextIdx > i + 1) {
        const skipped = transcriptWords.slice(i + 1, nextIdx);
        effectiveGap = Math.min(effectiveGap, longestSilenceInGap(end, nextStart, skipped));
      }

      if (effectiveGap >= 3) {
        results.push({
          afterWordIndex: i,
          gap: Math.round(effectiveGap * 10) / 10
        });
      }
    }
  }
  return results;
}

// ── DIAG-03: Self-Corrections ───────────────────────────────────────

/**
 * Detect repeated consecutive words/phrases that indicate self-corrections.
 * Excludes repetitions that are legitimate per reference text.
 * Returns array of { type, startIndex, words, count }.
 */
export function detectSelfCorrections(transcriptWords, alignment) {
  const results = [];
  const hypToRef = buildHypToRefMap(alignment);
  const words = transcriptWords.map(w => (w.word || '').toLowerCase());

  // Build set of ref indices where ref legitimately repeats
  // We need the alignment ops to get ref words
  const refWords = [];
  for (const op of alignment) {
    const type = op.type || op.operation;
    if (type !== 'insertion') {
      refWords.push((op.ref || op.reference || '').toLowerCase());
    }
  }

  const used = new Set(); // track indices already captured

  // 2-word phrase repeats first (greedy)
  for (let i = 0; i < words.length - 3; i++) {
    if (used.has(i)) continue;
    if (words[i] === words[i + 2] && words[i + 1] === words[i + 3]) {
      // Check if reference legitimately repeats at this position
      const r0 = hypToRef.get(i);
      const r2 = hypToRef.get(i + 2);
      if (r0 !== undefined && r2 !== undefined &&
          refWords[r0] === refWords[r2] &&
          r2 === r0 + 2) {
        // Check the second word too
        const r1 = hypToRef.get(i + 1);
        const r3 = hypToRef.get(i + 3);
        if (r1 !== undefined && r3 !== undefined &&
            refWords[r1] === refWords[r3]) {
          continue; // legitimate repeat in reference
        }
      }
      results.push({
        type: 'phrase-repeat',
        startIndex: i,
        words: `${words[i]} ${words[i + 1]}`,
        count: 2
      });
      used.add(i).add(i + 1).add(i + 2).add(i + 3);
    }
  }

  // Single word repeats
  for (let i = 0; i < words.length - 1; i++) {
    if (used.has(i)) continue;
    if (words[i] === words[i + 1]) {
      // Check if reference legitimately repeats
      const r0 = hypToRef.get(i);
      const r1 = hypToRef.get(i + 1);
      if (r0 !== undefined && r1 !== undefined &&
          refWords[r0] === refWords[r1] &&
          r1 === r0 + 1) {
        continue; // legitimate
      }
      // Count consecutive repeats
      let count = 1;
      let j = i + 1;
      while (j < words.length && words[j] === words[i] && !used.has(j)) {
        count++;
        j++;
      }
      results.push({
        type: 'word-repeat',
        startIndex: i,
        words: words[i],
        count
      });
      for (let k = i; k < j; k++) used.add(k);
    }
  }

  return results;
}

// ── DIAG-04: Morphological Errors ───────────────────────────────────

/**
 * Flag substitutions where ref and hyp share a 3+ char root
 * (detected via shared prefix or shared suffix).
 *
 * This identifies "wrong ending" or "wrong beginning" errors where the student
 * read a morphological variant of the reference word:
 *   - Suffix error: "running" → "runned"  (shared prefix "run")
 *   - Prefix error: "unhappy" → "happy"   (shared suffix "happy")
 *   - Tense error:  "jumped" → "jumping"  (shared prefix "jump")
 *
 * No cross-validation gate — morphological classification is about the pattern
 * of the substitution, not ASR reliability. If both engines confirm the student
 * said "runned" instead of "running", that's a MORE reliable morphological error,
 * not a reason to skip it.
 *
 * Uses positional lookup into transcriptWords (indexed by hypIndex) for metadata.
 *
 * Returns array of { ref, hyp, sharedPart, matchType, crossValidation }.
 */
export function detectMorphologicalErrors(alignment, transcriptWords) {
  const results = [];
  let hypIndex = 0;

  for (const op of alignment) {
    const type = op.type || op.operation;

    if (type === 'omission' || type === 'deletion') {
      // no hyp word — don't advance hypIndex
      continue;
    }

    if (type === 'substitution' || type === 'struggle') {
      const ref = (op.ref || op.reference || '').toLowerCase();
      const hyp = (op.hyp || op.hypothesis || '').toLowerCase();

      if (ref !== hyp) {
        const minLen = Math.min(ref.length, hyp.length);

        // Check shared prefix (catches suffix errors: "running"/"runned")
        let prefixLen = 0;
        while (prefixLen < minLen && ref[prefixLen] === hyp[prefixLen]) {
          prefixLen++;
        }

        // Check shared suffix (catches prefix errors: "unhappy"/"happy")
        let suffixLen = 0;
        while (suffixLen < minLen && ref[ref.length - 1 - suffixLen] === hyp[hyp.length - 1 - suffixLen]) {
          suffixLen++;
        }

        // Use whichever is longer
        const sharedLen = Math.max(prefixLen, suffixLen);

        // Skip 1-character differences (e.g., "formats"/"format", "dog"/"dogs")
        // — too minor to flag as morphological error
        const diffLen = Math.abs(ref.length - hyp.length) + (Math.min(ref.length, hyp.length) - sharedLen);
        if (diffLen <= 1) continue;

        if (sharedLen >= 3) {
          const sttWord = transcriptWords?.[hypIndex];
          const matchType = prefixLen >= suffixLen ? 'prefix' : 'suffix';
          const sharedPart = matchType === 'prefix'
            ? ref.slice(0, prefixLen)
            : ref.slice(ref.length - suffixLen);

          results.push({
            ref: op.ref || op.reference,
            hyp: op.hyp || op.hypothesis,
            sharedPart,
            matchType,
            crossValidation: sttWord?.crossValidation || 'unavailable'
          });
        }
      }
    }

    // Advance hypIndex for non-omission types (correct, substitution, insertion)
    hypIndex++;
  }

  return results;
}

// ── Statistical Helpers ──────────────────────────────────────────────

/** Median of a numeric array. Returns null for empty/null input. Copies before sorting. */
function median(arr) {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Percentile (0-100) of a numeric array using linear interpolation. Returns null for empty input. */
function percentile(arr, p) {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

// ── DIAG-05: Prosody Metrics ────────────────────────────────────────

/**
 * Metric 1: Phrasing Quality
 * Computes phrase breaks from three sources (hesitations, long pauses, IQR-based medium pauses),
 * classifies breaks as at-punctuation or unexpected, and reports words-per-phrase metrics.
 * Also classifies reading pattern (word-by-word, choppy, phrase-level, connected).
 *
 * READ-ONLY: consumes diagnostics.onsetDelays and .longPauses but never modifies them.
 */
export function computePhrasingQuality(diagnostics, transcriptWords, referenceText, alignment) {
  if (!transcriptWords || transcriptWords.length < 2) {
    return { insufficient: true, reason: 'Too few words' };
  }

  // ── Pre-step: Build excludeFromCount set ──
  const excludeFromCount = new Set();
  let hypIdx = 0;
  for (const entry of alignment) {
    if (entry.type === 'omission' || entry.type === 'deletion') continue;
    if (entry.type === 'insertion') {
      if (transcriptWords[hypIdx] && transcriptWords[hypIdx].isDisfluency) excludeFromCount.add(hypIdx);
      if (entry._isSelfCorrection) excludeFromCount.add(hypIdx);
      if (entry._partOfStruggle) excludeFromCount.add(hypIdx);
    }
    if (transcriptWords[hypIdx] && transcriptWords[hypIdx].crossValidation === 'unconfirmed') {
      excludeFromCount.add(hypIdx);
    }
    const partsCount = entry.compound && entry.parts ? entry.parts.length : 1;
    hypIdx += partsCount;
  }

  // ── Pre-step: Build compoundPositions set ──
  const compoundPositions = new Set();
  hypIdx = 0;
  for (const entry of alignment) {
    if (entry.type === 'omission' || entry.type === 'deletion') continue;
    if (entry.compound && entry.parts) {
      for (let p = 0; p < entry.parts.length - 1; p++) {
        compoundPositions.add(hypIdx + p);
      }
      hypIdx += entry.parts.length;
    } else {
      hypIdx++;
    }
  }

  // ── Source A: Hesitations (existing onsetDelays) — READ-ONLY ──
  const breakSet = new Set();
  const sourceABGapPositions = new Set();
  let vadFiltered = 0;
  let sourceACount = 0;

  for (const delay of (diagnostics.onsetDelays || [])) {
    if (delay._vadAnalysis && delay._vadAnalysis.speechPercent >= 80) {
      vadFiltered++;
      continue;
    }
    const breakAfter = delay.wordIndex - 1;
    if (breakAfter >= 0) {
      breakSet.add(breakAfter);
      sourceABGapPositions.add(breakAfter);
      sourceACount++;
    }
  }

  // ── Source B: Long pauses (existing longPauses) — READ-ONLY ──
  let sourceBCount = 0;
  for (const pause of (diagnostics.longPauses || [])) {
    breakSet.add(pause.afterWordIndex);
    sourceABGapPositions.add(pause.afterWordIndex);
    sourceBCount++;
  }

  // ── Source C: Medium pauses (IQR-based) ──
  // First collect baseline gaps (excluding Sources A/B and compounds)
  const allGaps = [];
  const gapPositions = []; // parallel array: position for each gap
  for (let i = 0; i < transcriptWords.length - 1; i++) {
    if (transcriptWords[i].crossValidation === 'unconfirmed') continue;
    // Find next confirmed word
    let nextI = i + 1;
    while (nextI < transcriptWords.length && transcriptWords[nextI].crossValidation === 'unconfirmed') nextI++;
    if (nextI >= transcriptWords.length) continue;

    const gap = parseTime(transcriptWords[nextI].startTime) - parseTime(transcriptWords[i].endTime);
    if (gap < 0) continue;
    if (sourceABGapPositions.has(i)) continue;
    if (compoundPositions.has(i)) continue;
    allGaps.push(gap);
    gapPositions.push(i);
  }

  const medianGap = median(allGaps);
  const Q1_gap = percentile(allGaps, 25);
  const Q3_gap = percentile(allGaps, 75);
  const IQR_gap = (Q1_gap !== null && Q3_gap !== null) ? Q3_gap - Q1_gap : 0;
  const effectiveIQR_gap = Math.max(IQR_gap, 0.050);
  const rawFence = Q3_gap !== null ? Q3_gap + 1.5 * effectiveIQR_gap : 0.200;
  const gapFence = Math.max(rawFence, 0.200);
  const isFenceFloored = rawFence < 0.200;
  const isIQRFloored = IQR_gap < 0.050;

  // Scan ALL inter-word positions for Source C
  let sourceCCount = 0;
  let compoundSkipped = 0;
  for (let i = 0; i < transcriptWords.length - 1; i++) {
    if (transcriptWords[i].crossValidation === 'unconfirmed') continue;
    let nextI = i + 1;
    while (nextI < transcriptWords.length && transcriptWords[nextI].crossValidation === 'unconfirmed') nextI++;
    if (nextI >= transcriptWords.length) continue;

    const gap = parseTime(transcriptWords[nextI].startTime) - parseTime(transcriptWords[i].endTime);
    if (gap < 0) continue;
    if (gap < gapFence) continue;
    if (compoundPositions.has(i)) { compoundSkipped++; continue; }
    if (!breakSet.has(i)) {
      breakSet.add(i);
      sourceCCount++;
    }
  }

  // ── Reading pattern classification ──
  let classification;
  if (medianGap === null) classification = 'connected';
  else if (medianGap > 0.350) classification = 'word-by-word';
  else if (medianGap > 0.250) classification = 'choppy';
  else if (medianGap > 0.150) classification = 'phrase-level';
  else classification = 'connected';

  // ── Break classification ──
  const punctMap = getPunctuationPositions(referenceText);
  const hypToRef = buildHypToRefMap(alignment);
  const breaks = [];
  let atPunctuationCount = 0;
  let unexpectedCount = 0;
  const unexpectedBreaks = new Set();

  for (const pos of breakSet) {
    const refIdx = hypToRef.get(pos);
    const atPunct = refIdx !== undefined && punctMap.has(refIdx);
    const punctType = atPunct ? punctMap.get(refIdx) : null;

    // Determine break source
    let source = 'mediumPause';
    for (const delay of (diagnostics.onsetDelays || [])) {
      if (delay.wordIndex - 1 === pos) { source = 'hesitation'; break; }
    }
    for (const pause of (diagnostics.longPauses || [])) {
      if (pause.afterWordIndex === pos) { source = 'longPause'; break; }
    }

    // Compute gap for this break
    let gapMs = null;
    if (pos < transcriptWords.length - 1) {
      let nextI = pos + 1;
      while (nextI < transcriptWords.length && transcriptWords[nextI].crossValidation === 'unconfirmed') nextI++;
      if (nextI < transcriptWords.length) {
        gapMs = Math.round((parseTime(transcriptWords[nextI].startTime) - parseTime(transcriptWords[pos].endTime)) * 1000);
      }
    }

    if (atPunct) {
      atPunctuationCount++;
    } else {
      unexpectedCount++;
      unexpectedBreaks.add(pos);
    }
    breaks.push({ position: pos, type: atPunct ? 'at-punctuation' : 'unexpected', punctType, source, gapMs });
  }

  // ── Build phrase lists ──
  function buildPhrases(breakPositions) {
    const sortedBreaks = [...breakPositions].sort((a, b) => a - b);
    const phrases = [];
    let start = 0;

    for (const bp of sortedBreaks) {
      if (bp >= start) {
        const phrase = buildSinglePhrase(start, bp);
        if (phrase) phrases.push(phrase);
        start = bp + 1;
      }
    }
    // Final phrase
    if (start < transcriptWords.length) {
      const phrase = buildSinglePhrase(start, transcriptWords.length - 1);
      if (phrase) phrases.push(phrase);
    }
    return phrases;
  }

  function buildSinglePhrase(startIdx, endIdx) {
    let wordCount = 0;
    const words = [];
    for (let i = startIdx; i <= endIdx && i < transcriptWords.length; i++) {
      if (!excludeFromCount.has(i)) {
        wordCount++;
        words.push(transcriptWords[i].word);
      }
    }
    // Compute gap after this phrase (if not the final phrase)
    let gapAfterMs = null;
    if (endIdx < transcriptWords.length - 1) {
      let nextI = endIdx + 1;
      while (nextI < transcriptWords.length && transcriptWords[nextI].crossValidation === 'unconfirmed') nextI++;
      if (nextI < transcriptWords.length) {
        gapAfterMs = Math.round((parseTime(transcriptWords[nextI].startTime) - parseTime(transcriptWords[endIdx].endTime)) * 1000);
      }
    }

    // Find break info for this position
    const breakInfo = breaks.find(b => b.position === endIdx);

    return {
      startHypIndex: startIdx,
      endHypIndex: endIdx,
      wordCount,
      words,
      gapAfterMs,
      breakSource: breakInfo ? breakInfo.source : null,
      breakType: breakInfo ? breakInfo.type : null
    };
  }

  const fluencyPhrases = buildPhrases(unexpectedBreaks);
  const overallPhrases = buildPhrases(breakSet);

  const fluencyLengths = fluencyPhrases.map(p => p.wordCount).filter(c => c > 0);
  const overallLengths = overallPhrases.map(p => p.wordCount).filter(c => c > 0);

  const mean = arr => arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length;

  // ── Exclusion stats ──
  let disfluencyCount = 0, selfCorrCount = 0, strugglePartCount = 0, unconfirmedCount = 0;
  hypIdx = 0;
  for (const entry of alignment) {
    if (entry.type === 'omission' || entry.type === 'deletion') continue;
    if (excludeFromCount.has(hypIdx)) {
      if (entry.type === 'insertion' && transcriptWords[hypIdx] && transcriptWords[hypIdx].isDisfluency) disfluencyCount++;
      else if (entry._isSelfCorrection) selfCorrCount++;
      else if (entry._partOfStruggle) strugglePartCount++;
      else if (transcriptWords[hypIdx] && transcriptWords[hypIdx].crossValidation === 'unconfirmed') unconfirmedCount++;
    }
    const partsCount = entry.compound && entry.parts ? entry.parts.length : 1;
    hypIdx += partsCount;
  }

  return {
    fluencyPhrasing: {
      mean: mean(fluencyLengths) !== null ? Math.round(mean(fluencyLengths) * 10) / 10 : null,
      median: median(fluencyLengths),
      totalPhrases: fluencyPhrases.length,
      phraseLengths: fluencyLengths
    },
    overallPhrasing: {
      mean: mean(overallLengths) !== null ? Math.round(mean(overallLengths) * 10) / 10 : null,
      median: median(overallLengths),
      totalPhrases: overallPhrases.length,
      phraseLengths: overallLengths,
      phrases: overallPhrases
    },
    readingPattern: {
      medianGap: medianGap !== null ? Math.round(medianGap * 1000) / 1000 : null,
      classification
    },
    breakClassification: {
      total: breakSet.size,
      atPunctuation: atPunctuationCount,
      unexpected: unexpectedCount,
      breaks
    },
    gapDistribution: {
      Q1: Q1_gap !== null ? Math.round(Q1_gap * 1000) / 1000 : null,
      Q3: Q3_gap !== null ? Math.round(Q3_gap * 1000) / 1000 : null,
      IQR: Math.round(IQR_gap * 1000) / 1000,
      effectiveIQR: Math.round(effectiveIQR_gap * 1000) / 1000,
      gapFence: Math.round(gapFence * 1000) / 1000,
      isFenceFloored,
      isIQRFloored,
      totalGapsAnalyzed: allGaps.length
    },
    breakSources: {
      fromHesitations: sourceACount,
      fromLongPauses: sourceBCount,
      fromMediumPauses: sourceCCount,
      vadFiltered,
      compoundSkipped,
      totalBreaks: breakSet.size
    },
    excludedFromCount: {
      disfluencies: disfluencyCount,
      selfCorrections: selfCorrCount,
      struggleParts: strugglePartCount,
      unconfirmed: unconfirmedCount,
      totalExcluded: excludeFromCount.size
    },
    _breakSet: breakSet
  };
}

/**
 * Metric 2: Punctuation Awareness
 * Pure consumer of Metric 1's break classification. Computes coverage (punctuation marks
 * with a pause) and precision (pauses at punctuation / total pauses).
 */
export function computePauseAtPunctuation(transcriptWords, referenceText, alignment, breakClassification, breakSet) {
  const punctMap = getPunctuationPositions(referenceText);
  const hypToRef = buildHypToRefMap(alignment);

  // Build reverse map: refIndex -> hypIndex
  const refToHyp = new Map();
  for (const [hIdx, rIdx] of hypToRef) {
    refToHyp.set(rIdx, hIdx);
  }

  // Coverage: of encountered punctuation marks, how many had a pause?
  let encounteredPunctuationCount = 0;
  let coveredCount = 0;
  const uncoveredMarks = [];
  let totalPunctuationMarks = punctMap.size;

  // Build ref words for uncovered mark details (merged + split to match alignment indices)
  const rawRefTokens = referenceText.trim().split(/\s+/);
  const mergedRef = [];
  for (let i = 0; i < rawRefTokens.length; i++) {
    const clean = rawRefTokens[i].replace(/^[^\w'-]+|[^\w'-]+$/g, '');
    if (clean.length === 0) continue;
    if (clean.endsWith('-') && i + 1 < rawRefTokens.length) {
      mergedRef.push(clean.slice(0, -1) + rawRefTokens[i + 1].replace(/^[^\w'-]+|[^\w'-]+$/g, ''));
      i++;
    } else {
      mergedRef.push(rawRefTokens[i]);
    }
  }
  // Split internal hyphens to mirror normalizeText (5th location)
  // Exception: single-letter parts join instead (e-mail → email).
  const refWords = [];
  for (const token of mergedRef) {
    const stripped = token.replace(/^[^\w'-]+|[^\w'-]+$/g, '');
    if (stripped.includes('-')) {
      const parts = stripped.split('-').filter(p => p.length > 0);
      if (parts.some(p => p.length === 1)) {
        // Single-letter part (e-mail) → keep as one token
        refWords.push(token);
      } else {
        for (let j = 0; j < parts.length - 1; j++) refWords.push(parts[j]);
        refWords.push(token); // last part keeps original for display
      }
    } else {
      refWords.push(token);
    }
  }

  // Build hyp-index → gap-after-word map for punctuation-aware gap check.
  // A fluent reader pauses briefly at commas (~100-200ms) — shorter than a
  // phrasing break but still noticeably longer than inter-word gaps (~50ms).
  // Use median gap * 1.5 (floor 100ms) as the punctuation pause threshold.
  const gapAfterHyp = new Map();
  const baselineGaps = [];
  for (let i = 0; i < transcriptWords.length - 1; i++) {
    const gap = parseTime(transcriptWords[i + 1].startTime) - parseTime(transcriptWords[i].endTime);
    if (gap >= 0) {
      gapAfterHyp.set(i, gap);
      baselineGaps.push(gap);
    }
  }
  const medianBaselineGap = median(baselineGaps) || 0.050;
  const punctPauseThreshold = Math.max(medianBaselineGap * 1.5, 0.100);

  // Find the last ref index the student actually read (for last-word exclusion)
  let lastEncounteredRefIdx = -1;
  for (const [refIdx] of punctMap) {
    if (refToHyp.has(refIdx) && refIdx > lastEncounteredRefIdx) {
      lastEncounteredRefIdx = refIdx;
    }
  }

  for (const [refIdx, punctType] of punctMap) {
    const hypIdx = refToHyp.get(refIdx);
    if (hypIdx === undefined) continue; // student didn't read this word
    // Skip the last word the student read — no opportunity to pause after it
    if (refIdx === lastEncounteredRefIdx) continue;
    encounteredPunctuationCount++;
    // Primary: detected as a phrasing break (Sources A/B/C)
    // Fallback (commas/semicolons/colons only): gap exceeds the lower punctuation
    // pause threshold. Periods, ? and ! are sentence boundaries — require a full break.
    const gapAtPosition = gapAfterHyp.get(hypIdx);
    const allowLowerThreshold = punctType === 'comma';
    if (breakSet.has(hypIdx) || (allowLowerThreshold && gapAtPosition !== undefined && gapAtPosition >= punctPauseThreshold)) {
      coveredCount++;
    } else {
      uncoveredMarks.push({ refIndex: refIdx, refWord: refWords[refIdx] || '', punctType, gap: gapAtPosition != null ? Math.round(gapAtPosition * 1000) : null });
    }
  }

  const coverageRatio = encounteredPunctuationCount > 0
    ? Math.round((coveredCount / encounteredPunctuationCount) * 100) / 100
    : null;

  // Coverage label
  let coverageLabel;
  if (coverageRatio === null) coverageLabel = 'No punctuation encountered';
  else if (coverageRatio < 0.30) coverageLabel = 'Rarely pauses at punctuation';
  else if (coverageRatio < 0.60) coverageLabel = 'Pauses at some punctuation';
  else if (coverageRatio < 0.80) coverageLabel = 'Pauses at most punctuation';
  else coverageLabel = 'Consistently pauses at punctuation';

  // Precision
  const totalPauses = breakClassification.total;
  const precisionRatio = totalPauses > 0
    ? Math.round((breakClassification.atPunctuation / totalPauses) * 100) / 100
    : null;

  let precisionLabel;
  if (precisionRatio === null) precisionLabel = 'No pauses detected';
  else if (precisionRatio < 0.30) precisionLabel = 'Pauses rarely align with sentences';
  else if (precisionRatio < 0.60) precisionLabel = 'Some pauses at punctuation, many mid-sentence';
  else if (precisionRatio < 0.80) precisionLabel = 'Most pauses at punctuation';
  else precisionLabel = 'Pauses well-aligned with text structure';

  // Punctuation density
  const totalWords = refWords.length;
  const passagePunctuationDensity = totalWords > 0
    ? Math.round((totalPunctuationMarks / totalWords) * 1000) / 1000
    : 0;

  return {
    coverage: {
      ratio: coverageRatio,
      label: coverageLabel,
      coveredCount,
      encounteredPunctuationMarks: encounteredPunctuationCount,
      totalPunctuationMarks,
      uncoveredMarks,
      punctPauseThresholdMs: Math.round(punctPauseThreshold * 1000)
    },
    precision: {
      ratio: precisionRatio,
      label: precisionLabel,
      atPunctuationCount: breakClassification.atPunctuation,
      notAtPunctuationCount: breakClassification.unexpected,
      totalPauses
    },
    passagePunctuationDensity
  };
}

/**
 * Metric 3: Pace Consistency
 * Coefficient of variation of local reading rates across phrases.
 * Depends on Metric 1's overallPhrasing.phrases[].
 */
export function computePaceConsistency(overallPhrasing, transcriptWords) {
  if (!overallPhrasing || !overallPhrasing.phrases || overallPhrasing.phrases.length < 3) {
    return { insufficient: true, reason: 'Too few phrases' };
  }

  const localRates = [];
  for (let pi = 0; pi < overallPhrasing.phrases.length; pi++) {
    const phrase = overallPhrasing.phrases[pi];
    if (phrase.wordCount <= 0) continue;

    const startTime = parseTime(transcriptWords[phrase.startHypIndex].startTime);
    const endTime = parseTime(transcriptWords[phrase.endHypIndex].endTime);
    const durationSec = endTime - startTime;
    if (durationSec <= 0) continue;

    const wordsPerMinute = (phrase.wordCount / durationSec) * 60;
    localRates.push({ phraseIndex: pi, wordsPerMinute: Math.round(wordsPerMinute), wordCount: phrase.wordCount, durationSec: Math.round(durationSec * 100) / 100 });
  }

  if (localRates.length < 3) {
    return { insufficient: true, reason: 'Too few measurable phrases' };
  }

  const rates = localRates.map(r => r.wordsPerMinute);
  const meanRate = rates.reduce((a, b) => a + b, 0) / rates.length;
  if (meanRate === 0) {
    return { insufficient: true, reason: 'Zero mean rate' };
  }

  const variance = rates.reduce((sum, r) => sum + (r - meanRate) ** 2, 0) / rates.length;
  const sdRate = Math.sqrt(variance);
  const cv = sdRate / meanRate;

  let cvClassification;
  if (cv < 0.15) cvClassification = 'consistent';
  else if (cv < 0.30) cvClassification = 'mostly-steady';
  else if (cv < 0.50) cvClassification = 'variable';
  else cvClassification = 'highly-variable';

  let label;
  if (cv < 0.15) label = 'Consistent pace throughout';
  else if (cv < 0.30) label = 'Mostly steady pace';
  else if (cv < 0.50) label = 'Variable pace — speeds up and slows down';
  else label = 'Highly variable pace — significant speed changes';

  return {
    cv: Math.round(cv * 100) / 100,
    classification: cvClassification,
    label,
    meanLocalRate: Math.round(meanRate),
    sdLocalRate: Math.round(sdRate),
    phraseCount: localRates.length,
    localRates
  };
}

/**
 * Metric 4: Word Duration Outliers (Self-Normed)
 * Prefers cross-validator timestamps (_xvalStartTime/_xvalEndTime) from
 * Deepgram or Parakeet. Falls back to primary timestamps (startTime/endTime)
 * when the cross-validator is unavailable (e.g., server 500 error).
 * Normalizes by phoneme count. IQR-based outlier detection.
 * Only flags words with > 3 phonemes as outliers.
 */
export function computeWordDurationOutliers(transcriptWords, alignment) {
  const allWords = [];
  let wordsSkippedNoTimestamps = 0;
  let xvalCount = 0;
  let primaryCount = 0;
  let hypIndex = 0;

  for (const entry of alignment) {
    if (entry.type === 'omission' || entry.type === 'deletion') continue;

    const partsCount = entry.compound && entry.parts ? entry.parts.length : 1;

    // Skip disfluency insertions, self-corrections, struggle parts
    if (entry.type === 'insertion') {
      if (transcriptWords[hypIndex] && transcriptWords[hypIndex].isDisfluency) { hypIndex += partsCount; continue; }
      if (entry._isSelfCorrection) { hypIndex += partsCount; continue; }
      if (entry._partOfStruggle) { hypIndex += partsCount; continue; }
    }

    const word = transcriptWords[hypIndex];
    if (!word) { hypIndex += partsCount; continue; }

    // Prefer cross-validator timestamps; fall back to primary (Reverb) timestamps
    let startMs, endMs, tsSource;
    if (word._xvalStartTime != null && word._xvalEndTime != null) {
      startMs = parseTime(word._xvalStartTime) * 1000;
      // For compound words, use end time of last part
      if (entry.compound && entry.parts && entry.parts.length > 1) {
        const lastPartIdx = hypIndex + entry.parts.length - 1;
        const lastPart = transcriptWords[lastPartIdx];
        endMs = lastPart && lastPart._xvalEndTime != null
          ? parseTime(lastPart._xvalEndTime) * 1000
          : parseTime(word._xvalEndTime) * 1000;
      } else {
        endMs = parseTime(word._xvalEndTime) * 1000;
      }
      tsSource = 'cross-validator';
      xvalCount++;
    } else if (word.startTime != null && word.endTime != null) {
      // Fallback: primary timestamps (Reverb or whichever engine provided them)
      startMs = parseTime(word.startTime) * 1000;
      if (entry.compound && entry.parts && entry.parts.length > 1) {
        const lastPartIdx = hypIndex + entry.parts.length - 1;
        const lastPart = transcriptWords[lastPartIdx];
        endMs = lastPart && lastPart.endTime != null
          ? parseTime(lastPart.endTime) * 1000
          : parseTime(word.endTime) * 1000;
      } else {
        endMs = parseTime(word.endTime) * 1000;
      }
      tsSource = 'primary';
      primaryCount++;
    } else {
      wordsSkippedNoTimestamps++;
      hypIndex += partsCount;
      continue;
    }

    const durationMs = endMs - startMs;
    if (durationMs <= 0) { hypIndex += partsCount; continue; }

    const wordText = entry.compound ? (entry.hyp || entry.ref || word.word) : word.word;
    const phonemeInfo = getPhonemeCountWithFallback(wordText);
    const phonemes = phonemeInfo.count;
    const syllables = countSyllables(wordText);
    const normalizedDurationMs = durationMs / Math.max(phonemes, 1);

    allWords.push({
      hypIndex,
      word: wordText,
      refWord: entry.ref || entry.reference || wordText,
      refIndex: null, // filled below
      durationMs: Math.round(durationMs),
      phonemes,
      phonemeSource: phonemeInfo.source,
      syllables,
      normalizedDurationMs: Math.round(normalizedDurationMs),
      alignmentType: entry.type,
      isOutlier: false,
      timestampSource: tsSource
    });

    hypIndex += partsCount;
  }

  // Fill refIndex from hypToRef
  const hypToRef = buildHypToRefMap(alignment);
  for (const w of allWords) {
    const ri = hypToRef.get(w.hypIndex);
    w.refIndex = ri !== undefined ? ri : null;
  }

  if (allWords.length < 4) {
    return { insufficient: true, reason: `Too few words with timestamps (xval: ${xvalCount}, primary: ${primaryCount}, skipped: ${wordsSkippedNoTimestamps})`, allWords };
  }

  // Compute baseline
  const durations = allWords.map(w => w.normalizedDurationMs);
  const Q1 = percentile(durations, 25);
  const Q3 = percentile(durations, 75);
  const IQR = Q3 - Q1;
  const effectiveIQR = Math.max(IQR, 50);
  const upperFence = Q3 + 1.5 * effectiveIQR;
  const isFenceFloored = IQR < 50;

  const medianDur = median(durations);
  const meanDur = durations.reduce((a, b) => a + b, 0) / durations.length;
  const variance = durations.reduce((sum, d) => sum + (d - meanDur) ** 2, 0) / durations.length;
  const sdDur = Math.sqrt(variance);

  // Flag outliers
  const outliers = [];
  for (const w of allWords) {
    if (w.normalizedDurationMs > upperFence) {
      w.isOutlier = true;
      outliers.push({
        hypIndex: w.hypIndex,
        word: w.word,
        refWord: w.refWord,
        refIndex: w.refIndex,
        durationMs: w.durationMs,
        phonemes: w.phonemes,
        phonemeSource: w.phonemeSource,
        syllables: w.syllables,
        normalizedDurationMs: w.normalizedDurationMs,
        aboveFenceBy: Math.round(w.normalizedDurationMs - upperFence),
        ratio: medianDur > 0 ? Math.round((w.normalizedDurationMs / medianDur) * 100) / 100 : null,
        alignmentType: w.alignmentType
      });
    }
  }

  // Sort outliers worst first
  outliers.sort((a, b) => b.normalizedDurationMs - a.normalizedDurationMs);

  return {
    baseline: {
      normalizationUnit: 'phoneme',
      medianDurationPerPhoneme: Math.round(medianDur),
      meanDurationPerPhoneme: Math.round(meanDur),
      sdDurationPerPhoneme: Math.round(sdDur),
      // Legacy aliases for backward compatibility
      medianDurationPerSyllable: Math.round(medianDur),
      meanDurationPerSyllable: Math.round(meanDur),
      sdDurationPerSyllable: Math.round(sdDur),
      Q1: Math.round(Q1),
      Q3: Math.round(Q3),
      IQR: Math.round(IQR),
      effectiveIQR: Math.round(effectiveIQR),
      upperFence: Math.round(upperFence),
      isFenceFloored,
      totalWordsAnalyzed: allWords.length,
      wordsSkippedNoTimestamps,
      xvalTimestamps: xvalCount,
      primaryTimestamps: primaryCount
    },
    outliers,
    outlierCount: outliers.length,
    allWords
  };
}

// ── Word Speed Tiers (xval-first timestamps for Word Speed Map) ─────

/**
 * Classify every reference word into a speed tier based on duration relative
 * to the student's own median ms/phoneme.
 *
 * Timestamp source: raw cross-validator words (Parakeet/Deepgram) matched to
 * alignment entries by ordered consumption. The xval engine produces better
 * word-level durations than Reverb (no BPE fragmentation artifacts).
 *
 * Matching algorithm: both Reverb words and xval words are temporal sequences
 * of the same audio. We walk alignment (which tracks Reverb hypIndex) and
 * advance an xval pointer in parallel. For each spoken word, we find the xval
 * word whose time interval contains the Reverb word's start time. Each xval
 * word is consumed at most once, preventing many-to-one assignment.
 *
 * Falls back to Metric 4 data (from computeWordDurationOutliers) when raw
 * xval words are unavailable.
 *
 *
 * @param {object} wordOutliers - Output from computeWordDurationOutliers()
 * @param {Array} alignment - Alignment entries from alignWords()
 * @param {Array} [xvalRawWords] - Raw cross-validator words (pre-NW-alignment).
 *   Each entry: { word, startTime, endTime }. When provided, used as primary
 *   timestamp source for all words.
 * @param {Array} [transcriptWords] - Merged STT words (for Reverb time positions)
 * @param {string} [referenceText] - Reference passage text (for sentence-final detection)
 * @returns {object} { words[], baseline, distribution, atPacePercent } or { insufficient: true }
 */
export function computeWordSpeedTiers(wordOutliers, alignment, xvalRawWords, transcriptWords, referenceText) {
  if (!wordOutliers || wordOutliers.insufficient) {
    return { insufficient: true, reason: wordOutliers?.reason || 'Word duration data insufficient' };
  }

  // Build sentence-final position set from reference text punctuation
  const punctMap = referenceText ? getPunctuationPositions(referenceText) : new Map();
  const sentenceFinalSet = new Set();
  for (const [idx, type] of punctMap) {
    if (type === 'period') sentenceFinalSet.add(idx); // 'period' = . ! ?
  }

  // Build hypIndex → Metric 4 allWords lookup (fallback when no xval match)
  const allWordsMap = new Map();
  for (const w of wordOutliers.allWords) {
    allWordsMap.set(w.hypIndex, w);
  }

  // Build sorted xval timeline for ordered consumption
  const xvalTimeline = (xvalRawWords || []).map(w => ({
    word: (w.word || '').toLowerCase(),
    startS: parseTime(w.startTime),
    endS: parseTime(w.endTime)
  })).filter(w => w.startS < w.endS).sort((a, b) => a.startS - b.startS);

  const hasXval = xvalTimeline.length > 0 && transcriptWords;

  // Pointer into xval timeline — advances forward only (ordered consumption)
  let xvalPtr = 0;

  /**
   * Find the next xval word that covers a given Reverb time position.
   * Advances xvalPtr past consumed/earlier words. Each xval word consumed once.
   * @param {number} reverbStartS - Reverb word's start time in seconds
   * @returns {{ startS, endS, word }|null}
   */
  function consumeXvalAt(reverbStartS) {
    if (!hasXval || reverbStartS <= 0) return null;

    // Advance past xval words that end before our target (with tolerance)
    while (xvalPtr < xvalTimeline.length && xvalTimeline[xvalPtr].endS < reverbStartS - 0.5) {
      xvalPtr++;
    }

    if (xvalPtr >= xvalTimeline.length) return null;

    const candidate = xvalTimeline[xvalPtr];

    // Check if Reverb start falls within xval interval (with 500ms tolerance)
    if (reverbStartS >= candidate.startS - 0.5 && reverbStartS <= candidate.endS + 0.5) {
      xvalPtr++; // consume
      return candidate;
    }

    return null;
  }

  const words = [];
  const xvalDurations = []; // for computing own baseline from xval timestamps
  let hypIndex = 0;
  let refIndex = 0;

  for (const entry of alignment) {
    // Insertions: not in reference passage — advance hypIndex and xval pointer
    if (entry.type === 'insertion') {
      const partsCount = entry.compound && entry.parts ? entry.parts.length : 1;
      // Advance xval pointer past this insertion so it doesn't misalign
      if (hasXval && transcriptWords[hypIndex]) {
        const reverbS = parseTime(transcriptWords[hypIndex].startTime);
        consumeXvalAt(reverbS);
      }
      hypIndex += partsCount;
      continue;
    }

    // Omissions: in reference but not spoken — no hypIndex advance, no xval consumption
    if (entry.type === 'omission' || entry.type === 'deletion') {
      words.push({
        refIndex, refWord: entry.ref,
        hypIndex: null, word: null,
        durationMs: null, syllables: null,
        normalizedMs: null, ratio: null,
        tier: 'omitted', alignmentType: 'omission',
        isOutlier: false,
        sentenceFinal: sentenceFinalSet.has(refIndex)
      });
      refIndex++;
      continue;
    }

    // Correct, substitution, struggle — has a spoken word
    const partsCount = entry.compound && entry.parts ? entry.parts.length : 1;

    // Try xval timestamp first
    let durationMs = null;
    let tsSource = null;
    if (hasXval && transcriptWords[hypIndex]) {
      const reverbS = parseTime(transcriptWords[hypIndex].startTime);
      const xvalMatch = consumeXvalAt(reverbS);
      if (xvalMatch) {
        durationMs = Math.round((xvalMatch.endS - xvalMatch.startS) * 1000);
        tsSource = 'cross-validator';
      }
    }

    // Fallback to Metric 4 data (NW-matched cross-validator timestamps)
    const m4Word = allWordsMap.get(hypIndex);
    if (durationMs == null && m4Word && m4Word.durationMs != null) {
      durationMs = m4Word.durationMs;
      tsSource = 'metric4';
    }

    if (durationMs != null && durationMs > 0) {
      // Use ref word for phoneme/syllable count (what the student was trying to read)
      const refText = entry.ref || entry.hyp || '';
      const phonemeInfo = getPhonemeCountWithFallback(refText);
      const phonemes = phonemeInfo.count;
      const syllables = countSyllables(refText);
      const normalizedMs = Math.round(durationMs / Math.max(phonemes, 1));

      xvalDurations.push({ phonemes, syllables, normalizedMs, durationMs });

      // Tier classification deferred — need baseline first
      words.push({
        refIndex, refWord: entry.ref,
        hypIndex, word: entry.hyp || m4Word?.word || '',
        durationMs, phonemes, phonemeSource: phonemeInfo.source, syllables, normalizedMs,
        ratio: null, // filled after baseline computation
        tier: null,  // filled after baseline computation
        alignmentType: entry.type,
        isOutlier: m4Word?.isOutlier || false,
        sentenceFinal: sentenceFinalSet.has(refIndex),
        _tsSource: tsSource
      });
    } else {
      words.push({
        refIndex, refWord: entry.ref,
        hypIndex, word: entry.hyp,
        durationMs: null, syllables: null,
        normalizedMs: null, ratio: null,
        tier: 'no-data', alignmentType: entry.type,
        isOutlier: false,
        sentenceFinal: sentenceFinalSet.has(refIndex)
      });
    }

    hypIndex += partsCount;
    refIndex++;
  }

  // Compute baseline from xval-derived durations (or fall back to Metric 4 baseline)
  let medianMs;
  if (xvalDurations.length >= 4) {
    const normed = xvalDurations.map(d => d.normalizedMs).sort((a, b) => a - b);
    medianMs = normed.length % 2 === 0
      ? (normed[normed.length / 2 - 1] + normed[normed.length / 2]) / 2
      : normed[Math.floor(normed.length / 2)];
  } else if (wordOutliers.baseline) {
    medianMs = wordOutliers.baseline.medianDurationPerPhoneme;
  } else {
    return { insufficient: true, reason: 'Too few words for baseline' };
  }

  if (!medianMs || medianMs <= 0) {
    return { insufficient: true, reason: 'Zero or missing median' };
  }

  // Now classify tiers using the baseline
  for (const w of words) {
    if (w.tier != null) continue; // already classified (omitted, no-data)

    const ratio = w.normalizedMs / medianMs;
    w.ratio = Math.round(ratio * 100) / 100;
    w._medianMs = Math.round(medianMs);
    w._upperFence = wordOutliers.baseline?.upperFence || null;

    if (ratio < 0.75) {
      w.tier = 'quick';
    } else if (ratio < 1.25) {
      w.tier = 'steady';
    } else if (ratio < 1.75) {
      w.tier = 'slow';
    } else if (ratio < 2.50) {
      w.tier = 'struggling';
    } else {
      w.tier = 'stalled';
    }
  }

  // Count distribution per tier
  const distribution = { quick: 0, steady: 0, slow: 0, struggling: 0, stalled: 0, omitted: 0, 'no-data': 0 };
  for (const w of words) {
    if (distribution[w.tier] !== undefined) distribution[w.tier]++;
  }

  // atPacePercent: only words we could meaningfully classify
  const classifiable = distribution.quick + distribution.steady + distribution.slow + distribution.struggling + distribution.stalled;
  const atPace = distribution.quick + distribution.steady;
  const atPacePercent = classifiable > 0 ? Math.round((atPace / classifiable) * 1000) / 10 : 0;

  return {
    words,
    baseline: {
      normalizationUnit: 'phoneme',
      medianMs: Math.round(medianMs),
      totalWords: words.length,
      upperFence: wordOutliers.baseline?.upperFence || null
    },
    distribution,
    atPacePercent
  };
}

/**
 * Recompute word speed tiers with preceding-pause durations folded in.
 * For each word, the silence gap before it (prev.endTime → this.startTime)
 * is added to the word's raw duration. Gaps after sentence-ending punctuation
 * (. ! ?) are excluded — those are natural prosodic pauses.
 *
 * Returns a new wordSpeedData object (does not mutate the original).
 *
 * @param {object} wordSpeedData - Output from computeWordSpeedTiers()
 * @param {Array} transcriptWords - STT transcript words array with startTime/endTime
 * @param {string} referenceText - Original reference text (for punctuation detection)
 * @returns {object} New { words, baseline, distribution, atPacePercent } with pause-adjusted durations
 */
export function recomputeWordSpeedWithPauses(wordSpeedData, transcriptWords, referenceText) {
  if (!wordSpeedData || wordSpeedData.insufficient) return wordSpeedData;

  const punctMap = referenceText ? getPunctuationPositions(referenceText) : new Map();
  const sentenceFinalSet = new Set();
  for (const [idx, type] of punctMap) {
    if (type === 'period') sentenceFinalSet.add(idx);
  }

  // Deep-clone words so we don't mutate original
  const words = wordSpeedData.words.map(w => ({ ...w }));
  const normDurations = [];

  for (const w of words) {
    // Reset pause fields
    w._gapBeforeMs = null;
    w._effectiveDurationMs = null;

    if (w.durationMs == null || w.hypIndex == null) continue;
    if (w.hypIndex <= 0) {
      // First word — no preceding gap
      normDurations.push(w.normalizedMs);
      continue;
    }

    const tw = transcriptWords[w.hypIndex];
    const prevTw = transcriptWords[w.hypIndex - 1];
    if (!tw || !prevTw) {
      normDurations.push(w.normalizedMs);
      continue;
    }

    const thisStart = parseTime(tw.startTime);
    const prevEnd = parseTime(prevTw.endTime);
    const gapMs = Math.max(0, Math.round((thisStart - prevEnd) * 1000));

    // Skip gap if previous ref word is sentence-final (natural prosodic pause)
    const prevRefIndex = w.refIndex - 1;
    if (prevRefIndex >= 0 && sentenceFinalSet.has(prevRefIndex)) {
      normDurations.push(w.normalizedMs);
      continue;
    }

    w._gapBeforeMs = gapMs;
    const effectiveMs = w.durationMs + gapMs;
    w._effectiveDurationMs = effectiveMs;
    const phonemes = w.phonemes || 1;
    w.normalizedMs = Math.round(effectiveMs / Math.max(phonemes, 1));
    normDurations.push(w.normalizedMs);
  }

  // Recompute median from adjusted normalized durations
  if (normDurations.length < 4) return wordSpeedData; // not enough data
  const sorted = normDurations.slice().sort((a, b) => a - b);
  const medianMs = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];

  if (!medianMs || medianMs <= 0) return wordSpeedData;

  // Re-classify tiers
  const distribution = { quick: 0, steady: 0, slow: 0, struggling: 0, stalled: 0, omitted: 0, 'no-data': 0 };
  for (const w of words) {
    if (w.tier === 'omitted' || w.tier === 'no-data') {
      distribution[w.tier]++;
      continue;
    }
    if (w.normalizedMs == null) {
      w.tier = 'no-data';
      distribution['no-data']++;
      continue;
    }

    const ratio = w.normalizedMs / medianMs;
    w.ratio = Math.round(ratio * 100) / 100;
    w._medianMs = Math.round(medianMs);

    if (ratio < 0.75) {
      w.tier = 'quick';
    } else if (ratio < 1.25) {
      w.tier = 'steady';
    } else if (ratio < 1.75) {
      w.tier = 'slow';
    } else if (ratio < 2.50) {
      w.tier = 'struggling';
    } else {
      w.tier = 'stalled';
    }
    distribution[w.tier]++;
  }

  const classifiable = distribution.quick + distribution.steady + distribution.slow + distribution.struggling + distribution.stalled;
  const atPace = distribution.quick + distribution.steady;
  const atPacePercent = classifiable > 0 ? Math.round((atPace / classifiable) * 1000) / 10 : 0;

  return {
    words,
    baseline: {
      ...wordSpeedData.baseline,
      medianMs: Math.round(medianMs)
    },
    distribution,
    atPacePercent
  };
}

// ── DIAG-06: Tier Breakdown ──────────────────────────────────────────

/**
 * Compute error breakdown by word tier (sight/academic/proper/function).
 * Only counts entries with .nl data, skips insertions.
 */
export function computeTierBreakdown(alignment) {
  const tiers = {
    sight: { correct: 0, errors: 0 },
    academic: { correct: 0, errors: 0 },
    proper: { correct: 0, errors: 0 },
    function: { correct: 0, errors: 0 }
  };
  for (const entry of alignment) {
    if (entry.type === 'insertion' || !entry.nl) continue;
    const tier = entry.nl.tier || 'function';
    if (!tiers[tier]) continue;
    if (entry.type === 'correct') {
      tiers[tier].correct++;
    } else if (entry.type === 'substitution' || entry.type === 'omission' || entry.type === 'struggle') {
      tiers[tier].errors++;
    }
  }
  return tiers;
}

// ── DIAG-07: Struggle Words (Path 1 — Hesitation, Path 3 — Abandoned Attempt) ─

/**
 * Detect "struggle" words via Path 1 (hesitation) and Path 3 (abandoned attempt).
 *
 * Path 1: substitution with a long pause (>= 3s) before the word.
 * Path 3: substitution where cross-validator had no response (unconfirmed) AND
 *          the hyp is a near-miss of the ref — indicating the student made
 *          a partial/garbled attempt that only verbatim STT detected.
 *
 * Operates on alignment entries (not transcriptWords). For entries already
 * upgraded to 'struggle' by Path 2 (resolveNearMissClusters), adds additional
 * evidence instead of re-upgrading.
 *
 * @param {Array} transcriptWords - STT words with timestamps
 * @param {string} referenceText - Reference passage text
 * @param {Array} alignment - Alignment entries (mutated in place)
 * @returns {Array} Results for diagnostics logging
 */
export function detectStruggleWords(transcriptWords, referenceText, alignment) {
  const results = [];

  // Get long pauses (>= 3s) for cross-reference
  const longPauses = detectLongPauses(transcriptWords);

  // Build map: STT word index that follows a pause -> gap value
  // Must skip unconfirmed words to find the actual next word after the pause
  const pauseBeforeIndex = new Map();
  for (const p of longPauses) {
    let nextIdx = p.afterWordIndex + 1;
    while (nextIdx < transcriptWords.length && transcriptWords[nextIdx].crossValidation === 'unconfirmed') {
      nextIdx++;
    }
    if (nextIdx < transcriptWords.length) {
      pauseBeforeIndex.set(nextIdx, p.gap);
    }
  }

  // Walk alignment entries, tracking hypIndex (maps to transcriptWords index)
  let hypIndex = 0;
  for (const entry of alignment) {
    if (entry.type === 'insertion') {
      hypIndex++;
      continue;
    }
    if (entry.type === 'omission') {
      continue;
    }

    // Only process substitutions and existing struggles (from Path 2)
    if (entry.type === 'substitution' || entry.type === 'struggle') {
      const refClean = (entry.ref || '').toLowerCase().replace(/[^a-z'-]/g, '');

      // ── Path 1: Hesitation (pause >= 3s before a substitution) ──
      if (refClean.length > 3 && pauseBeforeIndex.has(hypIndex)) {
        const gap = pauseBeforeIndex.get(hypIndex);

        if (entry.type === 'substitution') {
          // Upgrade substitution to struggle (Path 1)
          entry._originalType = 'substitution';
          entry.type = 'struggle';
          entry._strugglePath = 'hesitation';
          entry._hesitationGap = gap;
        } else {
          // Already struggle from Path 2 — add hesitation evidence
          entry._hasHesitation = true;
          entry._hesitationGap = gap;
        }

        results.push({
          hypIndex,
          word: entry.ref,
          hyp: entry.hyp,
          gap: Math.round(gap * 1000) / 1000,
          path: entry._strugglePath || 'hesitation'
        });
      }

      // ── Path 3: Abandoned Attempt (cross-validator N/A + near-miss) ──
      // The student made a partial/garbled attempt that only verbatim STT detected.
      // Cross-validator didn't hear it (crossValidation: unconfirmed) and it's a near-miss
      // of the reference word (shared prefix/suffix/Levenshtein).
      const sttWord = transcriptWords[hypIndex];
      if (sttWord && sttWord.crossValidation === 'unconfirmed' &&
          isNearMiss(entry.hyp, entry.ref)) {
        if (entry.type === 'substitution') {
          // Upgrade substitution to struggle (Path 3)
          entry._originalType = 'substitution';
          entry.type = 'struggle';
          entry._strugglePath = 'abandoned';
          entry._abandonedAttempt = true;
        } else {
          // Already struggle from Path 1 or 2 — add abandoned evidence
          entry._abandonedAttempt = true;
        }

        results.push({
          hypIndex,
          word: entry.ref,
          hyp: entry.hyp,
          crossValidation: 'unconfirmed',
          path: 'abandoned'
        });
      }
    }

    // Advance hypIndex — compound words consume multiple STT words
    const partsCount = entry.compound && entry.parts ? entry.parts.length : 1;
    hypIndex += partsCount;
  }

  return results;
}

// ── Orchestrator ────────────────────────────────────────────────────

/**
 * Run all diagnostics and return unified result object.
 */
export function runDiagnostics(transcriptWords, alignment, referenceText) {
  return {
    onsetDelays: detectOnsetDelays(transcriptWords, referenceText, alignment),
    longPauses: detectLongPauses(transcriptWords),
    selfCorrections: detectSelfCorrections(transcriptWords, alignment),
    morphologicalErrors: detectMorphologicalErrors(alignment, transcriptWords),
    struggleWords: detectStruggleWords(transcriptWords, referenceText, alignment)
  };
}
