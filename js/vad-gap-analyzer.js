/**
 * VAD Gap Analyzer - Acoustic analysis of pause/gap indicators
 *
 * Analyzes time ranges during diagnosed pauses and hesitations to determine
 * what portion contained VAD-detected speech. Enriches diagnostics with
 * _vadAnalysis properties containing speechPercent and acoustic label.
 */

// Acoustic label thresholds per requirements
// VAD-02: Speech percentages map to acoustic labels
export const ACOUSTIC_LABELS = {
  SILENCE_CONFIRMED: { max: 10, label: 'silence confirmed' },
  MOSTLY_SILENT: { max: 29, label: 'mostly silent' },
  MIXED_SIGNAL: { max: 49, label: 'mixed signal' },
  SPEECH_DETECTED: { max: 79, label: 'speech detected' },
  CONTINUOUS_SPEECH: { max: 100, label: 'continuous speech' }
};

/**
 * Calculate speech overlap percentage for a time range.
 * VAD-01: System calculates VAD speech overlap percentage for any time range
 *
 * @param {number} startMs - Range start in milliseconds
 * @param {number} endMs - Range end in milliseconds
 * @param {Array<{start: number, end: number}>} vadSegments - VAD speech segments (ms)
 * @returns {number} Speech percentage 0-100, one decimal place
 */
export function calculateSpeechPercent(startMs, endMs, vadSegments) {
  const rangeDuration = endMs - startMs;
  if (rangeDuration <= 0) return 0;
  if (!vadSegments || vadSegments.length === 0) return 0;

  let totalSpeechMs = 0;
  for (const seg of vadSegments) {
    const overlapStart = Math.max(startMs, seg.start);
    const overlapEnd = Math.min(endMs, seg.end);
    if (overlapStart < overlapEnd) {
      totalSpeechMs += (overlapEnd - overlapStart);
    }
  }

  // Round to one decimal place
  return Math.round((totalSpeechMs / rangeDuration) * 1000) / 10;
}

/**
 * Get acoustic label for speech percentage.
 * VAD-02: System classifies speech percentage into acoustic labels
 *
 * @param {number} speechPercent - Speech percentage 0-100
 * @returns {{label: string, max: number}} Acoustic label object
 */
export function getAcousticLabel(speechPercent) {
  if (speechPercent < 10) return ACOUSTIC_LABELS.SILENCE_CONFIRMED;
  if (speechPercent < 30) return ACOUSTIC_LABELS.MOSTLY_SILENT;
  if (speechPercent < 50) return ACOUSTIC_LABELS.MIXED_SIGNAL;
  if (speechPercent < 80) return ACOUSTIC_LABELS.SPEECH_DETECTED;
  return ACOUSTIC_LABELS.CONTINUOUS_SPEECH;
}

/**
 * Parse STT timestamp to milliseconds.
 * @param {string|number} t - Timestamp like "1.400s" or number (seconds)
 * @returns {number} Milliseconds
 */
function parseTimeMs(t) {
  if (typeof t === 'number') return t * 1000;
  return (parseFloat(String(t).replace('s', '')) || 0) * 1000;
}

/**
 * Enrich diagnostics with VAD gap analysis.
 * VAD-03: System enriches diagnostics.longPauses with _vadAnalysis property
 * VAD-04: System enriches diagnostics.onsetDelays with _vadAnalysis property
 *
 * Mutates diagnostics in place (existing codebase pattern).
 *
 * @param {Object} diagnostics - From runDiagnostics()
 * @param {Array} transcriptWords - STT words with startTime/endTime
 * @param {Array<{start: number, end: number}>} vadSegments - VAD speech segments (ms)
 */
export function enrichDiagnosticsWithVAD(diagnostics, transcriptWords, vadSegments) {
  if (!vadSegments || vadSegments.length === 0) {
    console.log('[VAD Gap] No VAD segments available, skipping enrichment');
    return;
  }

  // Enrich longPauses (VAD-03)
  // longPauses have: afterWordIndex (the word BEFORE the pause)
  if (diagnostics.longPauses) {
    for (const pause of diagnostics.longPauses) {
      const afterWord = transcriptWords[pause.afterWordIndex];
      const nextWord = transcriptWords[pause.afterWordIndex + 1];

      if (afterWord && nextWord) {
        const startMs = parseTimeMs(afterWord.endTime);
        const endMs = parseTimeMs(nextWord.startTime);
        const speechPercent = calculateSpeechPercent(startMs, endMs, vadSegments);

        pause._vadAnalysis = {
          speechPercent,
          label: getAcousticLabel(speechPercent).label
        };
      }
    }
  }

  // Enrich onsetDelays (VAD-04)
  // onsetDelays have: wordIndex (the word AFTER the hesitation)
  if (diagnostics.onsetDelays) {
    for (const delay of diagnostics.onsetDelays) {
      const word = transcriptWords[delay.wordIndex];
      const prevWord = delay.wordIndex > 0 ? transcriptWords[delay.wordIndex - 1] : null;

      if (word && prevWord) {
        const startMs = parseTimeMs(prevWord.endTime);
        const endMs = parseTimeMs(word.startTime);
        const speechPercent = calculateSpeechPercent(startMs, endMs, vadSegments);

        delay._vadAnalysis = {
          speechPercent,
          label: getAcousticLabel(speechPercent).label
        };
      }
    }
  }

  console.log('[VAD Gap] Enriched diagnostics with VAD analysis');
}

/**
 * Compute summary counts by acoustic label for debug logging.
 * DBG-01: Debug log includes VAD gap analysis stage with counts by acoustic label
 *
 * @param {Object} diagnostics - Diagnostics with _vadAnalysis enrichment
 * @returns {Object} Summary counts
 */
export function computeVADGapSummary(diagnostics) {
  const counts = {
    longPausesAnalyzed: 0,
    hesitationsAnalyzed: 0,
    silenceConfirmed: 0,
    mostlySilent: 0,
    mixedSignal: 0,
    speechDetected: 0,
    continuousSpeech: 0
  };

  const countLabel = (label) => {
    switch (label) {
      case 'silence confirmed': counts.silenceConfirmed++; break;
      case 'mostly silent': counts.mostlySilent++; break;
      case 'mixed signal': counts.mixedSignal++; break;
      case 'speech detected': counts.speechDetected++; break;
      case 'continuous speech': counts.continuousSpeech++; break;
    }
  };

  if (diagnostics.longPauses) {
    for (const p of diagnostics.longPauses) {
      if (p._vadAnalysis) {
        counts.longPausesAnalyzed++;
        countLabel(p._vadAnalysis.label);
      }
    }
  }

  if (diagnostics.onsetDelays) {
    for (const d of diagnostics.onsetDelays) {
      if (d._vadAnalysis) {
        counts.hesitationsAnalyzed++;
        countLabel(d._vadAnalysis.label);
      }
    }
  }

  return counts;
}
