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

// ── DIAG-01: Onset Delays ───────────────────────────────────────────

/**
 * Detect inter-word gaps indicating onset delays.
 * Returns array of { wordIndex, word, gap, severity }.
 */
export function detectOnsetDelays(transcriptWords) {
  const results = [];
  for (let i = 0; i < transcriptWords.length; i++) {
    const w = transcriptWords[i];
    const start = parseTime(w.startTime);
    let gap;
    if (i === 0) {
      gap = start;
      // First word: only flag if >= 3s to avoid recording lead-in
      if (gap < 3) continue;
    } else {
      const prevEnd = parseTime(transcriptWords[i - 1].endTime);
      gap = start - prevEnd;
    }

    let severity = null;
    if (gap >= 5) severity = 'frustration';
    else if (gap >= 3) severity = 'flag';
    else if (gap >= 1.5) severity = 'developing';

    if (severity) {
      results.push({
        wordIndex: i,
        word: w.word,
        gap: Math.round(gap * 10) / 10,
        severity
      });
    }
  }
  return results;
}

// ── DIAG-02: Long Pauses ────────────────────────────────────────────

/**
 * Detect pauses >= 3s (with punctuation allowance) between words.
 * Returns array of { afterWordIndex, gap, threshold, punctuationType }.
 */
export function detectLongPauses(transcriptWords, referenceText, alignment) {
  const punctMap = getPunctuationPositions(referenceText);
  const hypToRef = buildHypToRefMap(alignment);
  const results = [];

  for (let i = 0; i < transcriptWords.length - 1; i++) {
    const end = parseTime(transcriptWords[i].endTime);
    const nextStart = parseTime(transcriptWords[i + 1].startTime);
    const gap = nextStart - end;

    let threshold = 3;
    let punctuationType = null;
    const refIdx = hypToRef.get(i);
    if (refIdx !== undefined && punctMap.has(refIdx)) {
      punctuationType = punctMap.get(refIdx);
      threshold += punctuationType === 'comma' ? 0.6 : 1.2;
    }

    if (gap > threshold) {
      results.push({
        afterWordIndex: i,
        gap: Math.round(gap * 10) / 10,
        threshold,
        punctuationType
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
 * and STT confidence < 0.8.
 * Returns array of { ref, hyp, sharedPrefix, confidence }.
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
          // Look up confidence from sttLookup
          const sttWord = sttLookup instanceof Map
            ? sttLookup.get(hypIndex)
            : (sttLookup && sttLookup[hypIndex]);
          const confidence = sttWord ? (sttWord.confidence ?? 1) : 1;

          if (confidence < 0.8) {
            results.push({
              ref: op.ref || op.reference,
              hyp: op.hyp || op.hypothesis,
              sharedPrefix: ref.slice(0, shared),
              confidence: Math.round(confidence * 1000) / 1000
            });
          }
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

// ── Orchestrator ────────────────────────────────────────────────────

/**
 * Run all five diagnostics and return unified result object.
 */
export function runDiagnostics(transcriptWords, alignment, referenceText, sttLookup) {
  return {
    onsetDelays: detectOnsetDelays(transcriptWords),
    longPauses: detectLongPauses(transcriptWords, referenceText, alignment),
    selfCorrections: detectSelfCorrections(transcriptWords, alignment),
    morphologicalErrors: detectMorphologicalErrors(alignment, sttLookup),
    prosodyProxy: computeProsodyProxy(transcriptWords, referenceText, alignment)
  };
}
