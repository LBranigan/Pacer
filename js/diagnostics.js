// diagnostics.js — Fluency diagnostic analyzers, near-miss resolution, plus orchestrator

import { levenshteinRatio } from './nl-api.js';

// ── Helpers ──────────────────────────────────────────────────────────

/** Parse STT time string "1.200s" to float seconds. */
export function parseTime(t) {
  return parseFloat(String(t).replace('s', '')) || 0;
}

/**
 * Scan referenceText for trailing punctuation on each word.
 * Returns Map<refWordIndex, 'period'|'comma'>.
 */
export function getPunctuationPositions(referenceText) {
  const words = referenceText.trim().split(/\s+/);
  const map = new Map();
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const last = w[w.length - 1];
    if (/[.!?]/.test(last)) {
      map.set(i, 'period');
    } else if (/[,;:]/.test(last)) {
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
    if (nextEntry && nextEntry.type === 'substitution' &&
        clean(nextEntry.ref).length >= 3 &&
        isNearMiss(entry.hyp, nextEntry.ref)) {
      entry._partOfStruggle = true;
      entry._nearMissTarget = nextEntry.ref;
      if (!nextEntry._nearMissEvidence) nextEntry._nearMissEvidence = [];
      nextEntry._nearMissEvidence.push(entry.hyp);
      continue;
    }

    // PRIORITY 3 — Post-struggle (look behind for failure)
    if (prevEntry && prevEntry.type === 'substitution' &&
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
  for (const entry of alignment) {
    if (entry._nearMissEvidence && entry._nearMissEvidence.length > 0) {
      entry._originalType = entry.type;
      entry.type = 'struggle';
      entry._strugglePath = 'decoding';
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
    // Deepgram is the primary timekeeper; unconfirmed words lack Deepgram timestamps.
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
    const gap = nextStart - end;

    if (gap >= 3) {
      results.push({
        afterWordIndex: i,
        gap: Math.round(gap * 10) / 10
      });
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

// ── DIAG-05: Prosody Proxy ──────────────────────────────────────────

/**
 * Compute ratio of average pause at punctuation vs mid-sentence.
 * Returns { ratio, avgPauseAtPunct, avgPauseMid, punctuationPauses, midSentencePauses }.
 */
export function computeProsodyProxy(transcriptWords, referenceText, alignment) {
  const punctMap = getPunctuationPositions(referenceText);
  const hypToRef = buildHypToRefMap(alignment);

  const punctPauses = [];
  const midPauses = [];

  for (let i = 0; i < transcriptWords.length - 1; i++) {
    const end = parseTime(transcriptWords[i].endTime);
    const nextStart = parseTime(transcriptWords[i + 1].startTime);
    const gap = nextStart - end;
    if (gap < 0) continue; // overlapping timestamps, skip

    const refIdx = hypToRef.get(i);
    if (refIdx !== undefined && punctMap.has(refIdx)) {
      punctPauses.push(gap);
    } else {
      midPauses.push(gap);
    }
  }

  const avg = arr => arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
  const avgPauseAtPunct = avg(punctPauses);
  const avgPauseMid = avg(midPauses);
  const ratio = avgPauseMid === 0 ? 0 : Math.round((avgPauseAtPunct / avgPauseMid) * 100) / 100;

  return {
    ratio,
    avgPauseAtPunct: Math.round(avgPauseAtPunct * 1000) / 1000,
    avgPauseMid: Math.round(avgPauseMid * 1000) / 1000,
    punctuationPauses: punctPauses.length,
    midSentencePauses: midPauses.length
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
 * Path 3: substitution where Deepgram had no response (unconfirmed) AND
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

      // ── Path 3: Abandoned Attempt (Deepgram N/A + near-miss) ──
      // The student made a partial/garbled attempt that only verbatim STT detected.
      // Deepgram didn't hear it (crossValidation: unconfirmed) and it's a near-miss
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
    prosodyProxy: computeProsodyProxy(transcriptWords, referenceText, alignment),
    struggleWords: detectStruggleWords(transcriptWords, referenceText, alignment)
  };
}
