// diagnostics.js — Five fluency diagnostic analyzers plus orchestrator

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
      // correct or substitution — both advance
      map.set(hypIndex, refIndex);
      refIndex++;
      hypIndex++;
    }
  }
  return map;
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

    const prevEnd = parseTime(transcriptWords[i - 1].endTime);
    gap = start - prevEnd;

    // Determine threshold based on punctuation after previous word
    let threshold = 0.5; // 500ms default
    let punctuationType = null;
    const prevRefIdx = hypToRef.get(i - 1);
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
    const end = parseTime(transcriptWords[i].endTime);
    const nextStart = parseTime(transcriptWords[i + 1].startTime);
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
 * Flag substitutions where ref and hyp share a 3+ char prefix
 * and cross-validation indicates uncertainty (not confirmed by both engines).
 * Returns array of { ref, hyp, sharedPrefix, confidence, crossValidation }.
 */
export function detectMorphologicalErrors(alignment, sttLookup) {
  const results = [];
  let hypIndex = 0;

  for (const op of alignment) {
    const type = op.type || op.operation;

    if (type === 'omission' || type === 'deletion') {
      // no hyp word
      continue;
    }

    if (type === 'substitution') {
      const ref = (op.ref || op.reference || '').toLowerCase();
      const hyp = (op.hyp || op.hypothesis || '').toLowerCase();

      if (ref !== hyp) {
        // Compute shared prefix length
        let shared = 0;
        const minLen = Math.min(ref.length, hyp.length);
        while (shared < minLen && ref[shared] === hyp[shared]) {
          shared++;
        }

        if (shared >= 3) {
          // Look up cross-validation status from sttLookup
          let confidence = 1;
          let xval = 'unavailable';
          if (sttLookup instanceof Map) {
            const queue = sttLookup.get(hyp);
            if (queue && queue.length > 0) {
              confidence = queue[0].confidence ?? 1;
              xval = queue[0].crossValidation || 'unavailable';
            }
          }

          // If both engines agree on the spoken word, it's a reliable substitution
          // (not a morphological uncertainty). Only flag when uncertain.
          if (xval === 'confirmed') continue;

          results.push({
            ref: op.ref || op.reference,
            hyp: op.hyp || op.hypothesis,
            sharedPrefix: ref.slice(0, shared),
            confidence: Math.round(confidence * 1000) / 1000,
            crossValidation: xval
          });
        }
      }
    }

    // Advance hypIndex for non-omission types
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
    } else if (entry.type === 'substitution' || entry.type === 'omission') {
      tiers[tier].errors++;
    }
  }
  return tiers;
}

// ── DIAG-07: Struggle Words ─────────────────────────────────────────

/**
 * Detect "struggle" words — words the student had difficulty decoding.
 *
 * A word is flagged as a struggle when ALL three conditions are met:
 * 1. Pause or hesitation before the word (gap >= threshold OR gap >= 3s)
 * 2. Cross-validation indicates uncertainty (not 'confirmed' by both engines)
 *    - 'confirmed' = both engines agree → not a struggle
 *    - 'disagreed' = engines heard different words → likely mispronunciation
 *    - 'unconfirmed' = only Reverb heard something → Deepgram found nothing
 *    - 'unavailable' = Deepgram was down → can't confirm either way
 * 3. Not a sight word (word length > 3 characters)
 *
 * Struggle words are diagnostic indicators that highlight decoding difficulty.
 * They do NOT count as errors — they help teachers identify words that need practice.
 *
 * Returns array of { wordIndex, word, gap, confidence, crossValidation }.
 */
export function detectStruggleWords(transcriptWords, referenceText, alignment) {
  const results = [];

  // Get onset delays (hesitations) for cross-reference
  const onsetDelays = detectOnsetDelays(transcriptWords, referenceText, alignment);
  const delayIndices = new Set(onsetDelays.map(d => d.wordIndex));

  // Get long pauses for cross-reference (pause AFTER word index means struggle on NEXT word)
  const longPauses = detectLongPauses(transcriptWords);
  const pauseBeforeIndices = new Set(longPauses.map(p => p.afterWordIndex + 1));

  for (let i = 0; i < transcriptWords.length; i++) {
    const w = transcriptWords[i];
    const word = (w.word || '').toLowerCase();

    // Condition 1: Pause or hesitation before this word
    const hasPauseOrHesitation = delayIndices.has(i) || pauseBeforeIndices.has(i);
    if (!hasPauseOrHesitation) continue;

    // Condition 2: Cross-validation indicates uncertainty
    // If both engines agree on the word, it's not a struggle regardless of confidence
    const xval = w.crossValidation;
    if (xval === 'confirmed') continue;

    // Condition 3: Not a sight word (word length > 3 characters)
    if (word.length <= 3) continue;

    // All conditions met — this is a struggle word
    // Find the gap value from whichever source detected it
    let gap = 0;
    const delayEntry = onsetDelays.find(d => d.wordIndex === i);
    if (delayEntry) {
      gap = delayEntry.gap;
    } else {
      const pauseEntry = longPauses.find(p => p.afterWordIndex + 1 === i);
      if (pauseEntry) gap = pauseEntry.gap;
    }

    results.push({
      wordIndex: i,
      word: w.word,
      gap: Math.round(gap * 1000) / 1000,
      confidence: Math.round((w.confidence ?? 0) * 1000) / 1000,
      crossValidation: xval || 'unavailable'
    });
  }

  return results;
}

// ── Orchestrator ────────────────────────────────────────────────────

/**
 * Run all diagnostics and return unified result object.
 */
export function runDiagnostics(transcriptWords, alignment, referenceText, sttLookup) {
  return {
    onsetDelays: detectOnsetDelays(transcriptWords, referenceText, alignment),
    longPauses: detectLongPauses(transcriptWords),
    selfCorrections: detectSelfCorrections(transcriptWords, alignment),
    morphologicalErrors: detectMorphologicalErrors(alignment, sttLookup),
    prosodyProxy: computeProsodyProxy(transcriptWords, referenceText, alignment),
    struggleWords: detectStruggleWords(transcriptWords, referenceText, alignment)
  };
}
