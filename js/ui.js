export function setStatus(msg) {
  document.getElementById('status').textContent = msg;
}

// Friendly labels for POS tags
const POS_LABELS = {
  NOUN: 'Noun',
  VERB: 'Verb',
  ADJ: 'Adjective',
  ADV: 'Adverb',
  PRON: 'Pronoun',
  DET: 'Determiner',
  ADP: 'Preposition',
  CONJ: 'Conjunction',
  NUM: 'Number',
  PRT: 'Particle',
  PUNCT: 'Punctuation',
  X: 'Other',
  AFFIX: 'Affix',
  UNKNOWN: 'Unknown'
};

// Friendly labels for entity types
const ENTITY_LABELS = {
  PERSON: 'Person',
  LOCATION: 'Place',
  ORGANIZATION: 'Organization',
  EVENT: 'Event',
  WORK_OF_ART: 'Work of Art',
  CONSUMER_GOOD: 'Product',
  OTHER: 'Named Entity',
  UNKNOWN: 'Entity'
};

// Friendly labels for word tiers
const TIER_LABELS = {
  proper: 'Proper Name',
  academic: 'Academic Word',
  sight: 'Sight Word',
  function: 'Function Word'
};

/**
 * Build a user-friendly NL annotation string for tooltip display.
 */
function buildNLTooltip(nl) {
  if (!nl) return null;
  const lines = [];

  // Word type (POS)
  const posLabel = POS_LABELS[nl.pos] || nl.pos;
  lines.push(posLabel);

  // Entity type if present
  if (nl.entityType && nl.entityType !== 'OTHER') {
    const entityLabel = ENTITY_LABELS[nl.entityType] || nl.entityType;
    lines.push('📍 ' + entityLabel);
  }

  // Tier
  const tierLabel = TIER_LABELS[nl.tier] || nl.tier;
  lines.push('📚 ' + tierLabel);

  return lines.join('\n');
}

/**
 * Build tooltip portion for VAD gap analysis.
 * Per CONTEXT.md: "VAD: X% (acoustic label) - factual hint"
 * Shows acoustic label in parentheses followed by interpretive hint.
 * @param {Object|null} vadAnalysis - _vadAnalysis from diagnostics
 * @returns {string} Tooltip portion or empty string if no VAD data
 */
function buildVADTooltipInfo(vadAnalysis) {
  if (!vadAnalysis) return '';

  const factualHints = {
    'silence confirmed': 'no speech detected',
    'mostly silent': 'minimal speech detected',
    'mixed signal': 'partial speech during gap',
    'speech detected': 'speech detected during gap',
    'continuous speech': 'continuous speech during gap'
  };

  const hint = factualHints[vadAnalysis.label] || vadAnalysis.label;
  return `\nVAD: ${vadAnalysis.speechPercent}% (${vadAnalysis.label}) - ${hint}`;
}

/**
 * Build disfluency badge tooltip showing attempt trace.
 * Per CONTEXT.md: "Tooltip on disfluency badge should reveal the 'trace' (fragments)"
 */
function buildDisfluencyTooltip(word) {
  if (!word._disfluency) {
    return `${word.attempts || 1} attempt${word.attempts !== 1 ? 's' : ''}`;
  }

  const frags = word._disfluency.fragments || [];
  if (frags.length === 0) {
    return `${word.attempts} attempts`;
  }

  // Show trace: "Attempts: b, ba, ball"
  const trace = frags.map(f => f.word).join(', ');
  return `Attempts: ${trace}, ${word.word}`;
}

/**
 * Create disfluency badge element based on severity.
 * Per CONTEXT.md: minor=dot, moderate=double-dot, significant=warning
 */
function createDisfluencyBadge(word) {
  const severity = word.severity || 'none';
  if (severity === 'none') return null;

  const badge = document.createElement('span');
  badge.className = `disfluency-badge ${severity}`;

  // Badge content per CONTEXT.md
  const badges = {
    minor: '\u2022',           // • single dot
    moderate: '\u2022\u2022',  // •• double dot
    significant: '\u26A0\uFE0F' // ⚠️ warning icon
  };
  badge.textContent = badges[severity] || '';
  badge.title = buildDisfluencyTooltip(word);

  return badge;
}

/**
 * Build enhanced tooltip with ensemble debug info.
 * Per CONTEXT.md: Full debug info visible to ALL teachers (not dev mode gated).
 * @param {Object} item - Alignment item with type, ref, hyp
 * @param {Object|null} sttWord - STT word metadata with timestamps and _debug
 * @returns {string} Tooltip text
 */
function buildEnhancedTooltip(item, sttWord) {
  const lines = [];

  // Existing type info
  if (item.type === 'substitution') {
    lines.push(`Expected: ${item.ref}, Said: ${item.hyp}`);
  } else if (item.type === 'struggle') {
    lines.push(`Expected: ${item.ref}, Said: ${item.hyp}`);
    if (item._strugglePath === 'decoding' && item._nearMissEvidence) {
      const attempts = [item.hyp, ...item._nearMissEvidence];
      lines.push(`Struggle (decoding error): ${attempts.length} attempts (${attempts.join(', ')})`);
    } else if (item._strugglePath === 'hesitation') {
      const gapMs = Math.round((item._hesitationGap || 0) * 1000);
      lines.push(`Struggle (hesitation): ${gapMs}ms pause before failed word`);
    }
    if (item._hasHesitation && item._hesitationGap) {
      const gapMs = Math.round(item._hesitationGap * 1000);
      lines.push(`${gapMs}ms pause before word`);
    }
  } else if (item.type === 'omission') {
    lines.push('Omitted (not read)');
  } else if (item.type === 'self-correction') {
    lines.push(`"${item.hyp}" (self-correction)`);
  } else {
    lines.push(item.ref || '');
  }

  // Timestamps with duration
  if (sttWord) {
    const start = parseSttTime(sttWord.startTime);
    const end = parseSttTime(sttWord.endTime);
    const durationMs = Math.round((end - start) * 1000);
    lines.push(`Time: ${start.toFixed(2)}s - ${end.toFixed(2)}s (${durationMs}ms)`);

    // All three timestamp sources for clinical comparison
    const dgStart = sttWord._deepgramStartTime != null ? parseSttTime(sttWord._deepgramStartTime) : null;
    const dgEnd = sttWord._deepgramEndTime != null ? parseSttTime(sttWord._deepgramEndTime) : null;
    const rvStart = sttWord._reverbStartTime != null ? parseSttTime(sttWord._reverbStartTime) : null;
    const rvEnd = sttWord._reverbEndTime != null ? parseSttTime(sttWord._reverbEndTime) : null;
    const rcStart = sttWord._reverbCleanStartTime != null ? parseSttTime(sttWord._reverbCleanStartTime) : null;
    const rcEnd = sttWord._reverbCleanEndTime != null ? parseSttTime(sttWord._reverbCleanEndTime) : null;

    const fmtTs = (s, e) => {
      if (s == null || e == null) return 'N/A';
      const dur = Math.round((e - s) * 1000);
      return `${s.toFixed(2)}s-${e.toFixed(2)}s (${dur}ms)`;
    };
    lines.push(`  Deepgram:    ${fmtTs(dgStart, dgEnd)}`);
    lines.push(`  Reverb v1.0: ${fmtTs(rvStart, rvEnd)}`);
    lines.push(`  Reverb v0.0: ${fmtTs(rcStart, rcEnd)}`);

    // What each model heard (word text, not confidence %)
    const reverbWord = sttWord._alignment?.verbatim || sttWord.word;
    const deepgramWord = sttWord._deepgramWord;
    if (deepgramWord) {
      lines.push(`Deepgram heard: "${deepgramWord}"`);
      lines.push(`Reverb heard: "${reverbWord}"`);
    } else if (deepgramWord === null) {
      lines.push(`Deepgram heard: [null]`);
      lines.push(`Reverb heard: "${reverbWord}"`);
    } else {
      lines.push(`Reverb heard: "${reverbWord}"`);
    }

    // Cross-validation status
    const xval = sttWord.crossValidation;
    if (xval) {
      const xvalLabels = {
        confirmed: ' (both agree)',
        disagreed: ' (models heard different words)',
        unconfirmed: ' (Reverb only — Deepgram heard nothing)',
        unavailable: ' (Deepgram offline)'
      };
      lines.push(`Cross-validation: ${xval}${xvalLabels[xval] || ''}`);
    }

    // Disfluency info
    if (sttWord.isDisfluency) {
      const typeLabels = { filler: 'Filler (um, uh)', repetition: 'Repetition', false_start: 'False start', unknown: 'Disfluency' };
      lines.push(`Disfluency: ${typeLabels[sttWord.disfluencyType] || 'Yes'} (not an error)`);
    }

    // Reverb internal diff (v=1.0 verbatim vs v=0.0 clean)
    if (sttWord._alignment) {
      const a = sttWord._alignment;
      if (a.verbatim && a.clean) {
        lines.push(`Reverb v=1.0: "${a.verbatim}" | v=0.0: "${a.clean}"`);
      } else if (a.verbatim && !a.clean) {
        lines.push(`Reverb v=1.0 only: "${a.verbatim}" (removed in v=0.0 clean pass)`);
      }
    }
  }

  // Google NL API annotations (POS, entity type, vocabulary tier)
  if (item.nl) {
    const nlTip = buildNLTooltip(item.nl);
    if (nlTip) lines.push(nlTip);
  }

  // Healed word
  if (item.healed) {
    lines.push(`Healed: STT said "${item.originalHyp}"`);
  }

  // Flags as text list (per CONTEXT.md: "no icons in tooltip")
  if (sttWord?._flags && sttWord._flags.length > 0) {
    lines.push(`Flags: ${sttWord._flags.join(', ')}`);
  }

  return lines.join('\n');
}

export function displayResults(data) {
  const wordsDiv = document.getElementById('resultWords');
  const plainDiv = document.getElementById('resultPlain');
  const jsonDiv = document.getElementById('resultJson');
  wordsDiv.innerHTML = ''; plainDiv.textContent = ''; jsonDiv.textContent = '';

  if (!data.results || data.results.length === 0) {
    wordsDiv.textContent = 'No speech detected.';
    return;
  }

  const allWords = [];
  const plainParts = [];

  data.results.forEach(result => {
    const alt = result.alternatives[0];
    if (!alt) return;
    plainParts.push(alt.transcript);
    if (alt.words) {
      alt.words.forEach(w => {
        allWords.push(w);
        const span = document.createElement('span');
        span.className = 'word ' + (w.crossValidation === 'confirmed' ? 'high' : (w.crossValidation === 'unconfirmed' || w.crossValidation === 'disagreed') ? 'mid' : 'low');
        const start = parseSttTime(w.startTime);
        const end = parseSttTime(w.endTime);
        span.title = `${w.word}  |  ${start.toFixed(2)}s – ${end.toFixed(2)}s  |  ${w.crossValidation || 'N/A'}`;
        span.textContent = w.word;
        wordsDiv.appendChild(span);
        wordsDiv.appendChild(document.createTextNode(' '));
      });
    }
  });

  plainDiv.textContent = plainParts.join(' ');

  // Collect alternatives for display
  const altTranscripts = [];
  data.results.forEach(result => {
    if (result.alternatives && result.alternatives.length > 1) {
      for (let i = 1; i < result.alternatives.length; i++) {
        altTranscripts.push(result.alternatives[i].transcript);
      }
    }
  });

  const jsonOutput = { words: allWords };
  if (altTranscripts.length > 0) jsonOutput.alternativeTranscripts = altTranscripts;
  jsonDiv.textContent = JSON.stringify(jsonOutput, null, 2);
}

/**
 * Display color-coded alignment results with metrics.
 * @param {Array<{ref: string|null, hyp: string|null, type: string}>} alignment
 * @param {{wcpm: number, correctCount: number, elapsedSeconds: number}|null} wcpm
 * @param {{accuracy: number, correctCount: number, totalRefWords: number, substitutions: number, omissions: number, insertions: number}} accuracy
 */
function parseSttTime(t) {
  if (typeof t === 'number') return t;
  if (!t) return 0;
  if (typeof t === 'object' && t.seconds !== undefined) {
    return Number(t.seconds || 0) + (Number(t.nanos || 0) / 1e9);
  }
  return parseFloat(String(t).replace('s', '')) || 0;
}

export function displayAlignmentResults(alignment, wcpm, accuracy, sttLookup, diagnostics, transcriptWords, tierBreakdown, disfluencySummary, safetyData) {
  const wordsDiv = document.getElementById('resultWords');
  const plainDiv = document.getElementById('resultPlain');
  const jsonDiv = document.getElementById('resultJson');
  wordsDiv.innerHTML = ''; plainDiv.textContent = ''; jsonDiv.textContent = '';

  // Metrics summary bar
  const metricsBar = document.createElement('div');
  metricsBar.className = 'metrics-bar';

  // WCPM box with range display
  const wcpmBox = document.createElement('div');
  wcpmBox.className = 'metric-box';

  // Check for collapse state
  if (safetyData?.collapse?.collapsed) {
    // Show collapse banner instead of WCPM
    const banner = document.createElement('div');
    banner.className = 'collapse-banner';
    banner.textContent = 'Results may be unreliable due to poor audio quality';
    metricsBar.appendChild(banner);
  } else if (wcpm) {
    // Normal WCPM range display
    const container = document.createElement('div');
    container.className = 'wcpm-container';

    const primary = document.createElement('div');
    primary.className = 'wcpm-primary';
    primary.textContent = wcpm.wcpmMin ?? wcpm.wcpm ?? 'N/A';

    const range = document.createElement('div');
    range.className = 'wcpm-range';
    // Show range only if different
    if (wcpm.wcpmMin !== undefined && wcpm.wcpmMax !== undefined && wcpm.wcpmMin !== wcpm.wcpmMax) {
      range.textContent = `${wcpm.wcpmMin}-${wcpm.wcpmMax} WCPM`;
    } else {
      range.textContent = `${wcpm.wcpm ?? wcpm.wcpmMin} WCPM`;
    }

    container.appendChild(primary);
    container.appendChild(range);

    wcpmBox.appendChild(container);
    metricsBar.appendChild(wcpmBox);

    // Fluency concerns summary - directly below WCPM per CONTEXT.md
    if (disfluencySummary && disfluencySummary.totalWordsWithDisfluency > 0) {
      const summary = document.createElement('div');
      summary.className = 'fluency-summary';

      const parts = [];
      if (disfluencySummary.significant > 0) {
        parts.push(`<span class="significant">${disfluencySummary.significant} significant</span>`);
      }
      if (disfluencySummary.moderate > 0) {
        parts.push(`<span class="moderate">${disfluencySummary.moderate} moderate</span>`);
      }
      if (disfluencySummary.minor > 0) {
        parts.push(`<span class="minor">${disfluencySummary.minor} minor</span>`);
      }

      summary.innerHTML = parts.join(', ');
      wcpmBox.appendChild(summary);
    }
  } else {
    wcpmBox.innerHTML = '<span class="metric-value">N/A</span><span class="metric-label">WCPM</span>';
    metricsBar.appendChild(wcpmBox);
  }

  const accBox = document.createElement('div');
  accBox.className = 'metric-box';
  const forgivenNote = accuracy.forgiven > 0 ? ' (' + accuracy.forgiven + ' proper noun' + (accuracy.forgiven > 1 ? 's' : '') + ' forgiven)' : '';
  accBox.innerHTML = '<span class="metric-value">' + accuracy.accuracy + '%</span><span class="metric-label">Accuracy' + forgivenNote + '</span>';
  metricsBar.appendChild(accBox);

  const errBox = document.createElement('div');
  errBox.className = 'metric-box metric-box-errors';
  const errParts = [
    accuracy.substitutions + ' substitution' + (accuracy.substitutions !== 1 ? 's' : ''),
    accuracy.omissions + ' omission' + (accuracy.omissions !== 1 ? 's' : '')
  ];
  if (accuracy.struggles > 0) {
    errParts.push(accuracy.struggles + ' struggle' + (accuracy.struggles !== 1 ? 's' : ''));
  }
  errParts.push(accuracy.insertions + ' insertion' + (accuracy.insertions !== 1 ? 's' : ''));
  errBox.innerHTML = '<span class="metric-label">' + errParts.join(', ') + '</span>';
  metricsBar.appendChild(errBox);

  if (diagnostics && diagnostics.prosodyProxy) {
    const prosBox = document.createElement('div');
    prosBox.className = 'metric-box';
    prosBox.innerHTML = '<span class="metric-value">' + diagnostics.prosodyProxy.ratio + '</span><span class="metric-label">Prosody</span>';
    metricsBar.appendChild(prosBox);
  }

  // Tier breakdown row
  if (tierBreakdown) {
    const tierRow = document.createElement('div');
    tierRow.className = 'tier-breakdown';
    for (const [tier, data] of Object.entries(tierBreakdown)) {
      const total = data.correct + data.errors;
      if (total === 0) continue;
      const pct = Math.round((data.correct / total) * 100);
      const label = tier.charAt(0).toUpperCase() + tier.slice(1);
      const span = document.createElement('span');
      span.className = 'tier-item';
      if (tier === 'proper' && accuracy.forgiven > 0) {
        span.textContent = label + ': ' + data.correct + '/' + total + ' (forgiven)';
      } else {
        span.textContent = label + ': ' + data.correct + '/' + total + ' (' + pct + '%)';
      }
      tierRow.appendChild(span);
    }
    metricsBar.appendChild(tierRow);
  }

  plainDiv.appendChild(metricsBar);

  // Build mapping from STT word index to alignment hypIndex (for rendering)
  // STT indexes include insertions, but UI hypIndex skips insertions
  const sttToHypIndex = new Map();
  let sttIdx = 0;
  let renderHypIdx = 0;
  for (const item of alignment) {
    if (item.type === 'insertion') {
      sttIdx++;
      continue;
    }
    if (item.type !== 'omission') {
      sttToHypIndex.set(sttIdx, renderHypIdx);
      // Compound words (e.g. "every"+"one" → "everyone") consume multiple STT words
      // but produce a single alignment entry — advance sttIdx by parts count
      const partsCount = item.compound && item.parts ? item.parts.length : 1;
      sttIdx += partsCount;
      renderHypIdx++;
    }
  }

  // Build diagnostic lookup structures
  const onsetDelayMap = new Map(); // hypIndex -> {gap, threshold, punctuationType}
  const longPauseMap = new Map(); // afterHypIndex -> {gap}
  const morphErrorMap = new Map(); // "ref|hyp" lowercase -> morphological result
  if (diagnostics) {
    if (diagnostics.onsetDelays) {
      for (const d of diagnostics.onsetDelays) {
        // Convert STT wordIndex to render hypIndex
        const hypIdx = sttToHypIndex.get(d.wordIndex);
        if (hypIdx !== undefined) {
          onsetDelayMap.set(hypIdx, d);
        }
      }
    }
    if (diagnostics.longPauses) {
      console.log('[UI Debug] Long pauses from diagnostics:', diagnostics.longPauses);
      console.log('[UI Debug] sttToHypIndex map:', [...sttToHypIndex.entries()]);
      for (const p of diagnostics.longPauses) {
        // Convert STT afterWordIndex to render hypIndex
        const hypIdx = sttToHypIndex.get(p.afterWordIndex);
        console.log('[UI Debug] Pause afterWordIndex:', p.afterWordIndex, '-> hypIdx:', hypIdx);
        if (hypIdx !== undefined) {
          longPauseMap.set(hypIdx, p);
        }
      }
      console.log('[UI Debug] longPauseMap:', [...longPauseMap.entries()]);
    }
    if (diagnostics.morphologicalErrors) {
      for (const m of diagnostics.morphologicalErrors) {
        morphErrorMap.set((m.ref || '').toLowerCase() + '|' + (m.hyp || '').toLowerCase(), m);
      }
    }
  }

  // Render reference words color-coded
  const insertions = [];
  let hypIndex = 0;
  for (const item of alignment) {
    if (item.type === 'insertion') {
      insertions.push(item);
      continue;
    }
    const span = document.createElement('span');
    span.className = 'word word-' + item.type;
    span.textContent = item.ref || '';

    // Look up STT word metadata for tooltip
    const hypKey = item.hyp;
    let sttWord = null;
    let sttInfo = '';
    if (hypKey && sttLookup) {
      const queue = sttLookup.get(hypKey);
      if (queue && queue.length > 0) {
        sttWord = queue.shift();
      }
    }

    // NL tier class and tooltip info
    if (item.nl) {
      span.classList.add('word-tier-' + item.nl.tier);
      sttInfo += '\n' + buildNLTooltip(item.nl);
    }

    // Healed word indicator
    if (item.healed) {
      span.classList.add('word-healed');
      sttInfo += '\n(Healed: STT said "' + item.originalHyp + '")';
    }

    // Rate anomaly visual indicator (Phase 16)
    if (sttWord?._flags?.includes('rate_anomaly')) {
      span.classList.add('word-rate-anomaly');
    }

    // Morphological prefix break indicator (ensemble-merger.js)
    // Shows squiggly line when student sounded out a prefix separately (e.g., "un...nerved")
    // This is NOT an error - it indicates the student used phonics skills to decode the word
    if (sttWord?._debug?.morphologicalBreak) {
      span.classList.add('word-morphological');
      const mb = sttWord._debug.morphologicalBreak;
      const breakNote = `Prefix sounded out: "${mb.prefix}" + "${sttWord.word}" (${mb.gapMs}ms gap)`;
      // Add prefix to display (optional - show what student sounded out)
      span.dataset.morphPrefix = mb.prefix;
      sttInfo += '\n' + breakNote;
    }

    // Build tooltip with enhanced debug info
    span.title = buildEnhancedTooltip(item, sttWord);

    // Additional context for specific types
    if (item.type === 'substitution' || item.type === 'struggle') {
      // Proper noun forgiveness indicator (phonetic proximity check passed)
      // Check this FIRST - forgiven words should NOT be marked as morphological errors
      if (item.forgiven) {
        span.classList.add('word-forgiven');
        const ratioText = item.phoneticRatio ? ' (' + item.phoneticRatio + '% similar)' : '';
        const combinedText = item.combinedPronunciation ? '\nStudent said: "' + item.combinedPronunciation + '"' : '';
        span.title += '\n✓ Forgiven: proper name' + ratioText + combinedText + ' — vocabulary gap, not decoding error';
      } else {
        // Morphological error overlay (only for non-forgiven substitutions)
        const morphKey = (item.ref || '').toLowerCase() + '|' + (item.hyp || '').toLowerCase();
        const morphData = morphErrorMap.get(morphKey);
        if (morphData) {
          span.classList.add('word-morphological');
          span.title += `\n(Morphological: shared ${morphData.matchType} "${morphData.sharedPart}")`;
        }
      }
    }

    // NL tooltip and healed indicator are already included by buildEnhancedTooltip()

    // Hesitation overlay (for items that have a hyp word)
    const currentHypIndex = (item.type !== 'omission') ? hypIndex : null;
    if (currentHypIndex !== null && onsetDelayMap.has(currentHypIndex)) {
      const delay = onsetDelayMap.get(currentHypIndex);
      span.classList.add('word-hesitation');

      // VAD visual distinction: orange if speech >= 30%
      if (delay._vadAnalysis && delay._vadAnalysis.speechPercent >= 30) {
        span.classList.add('word-hesitation-vad');
      }

      const gapMs = Math.round(delay.gap * 1000);
      const threshMs = Math.round(delay.threshold * 1000);
      let hesitationNote = '\nHesitation: ' + gapMs + 'ms';
      if (delay.punctuationType === 'period') {
        hesitationNote += ' (threshold ' + threshMs + 'ms after sentence end)';
      } else if (delay.punctuationType === 'comma') {
        hesitationNote += ' (threshold ' + threshMs + 'ms after comma)';
      } else {
        hesitationNote += ' (threshold ' + threshMs + 'ms)';
      }
      // Add VAD info to tooltip
      hesitationNote += buildVADTooltipInfo(delay._vadAnalysis);
      // Show VAD overhang adjustment if gap was corrected
      if (delay._vadOverhang) {
        hesitationNote += '\nVAD overhang: ' + delay._vadOverhang.overhangMs + 'ms'
          + ' (STT gap ' + delay._vadOverhang.originalGapMs + 'ms → adjusted ' + delay._vadOverhang.adjustedGapMs + 'ms)';
      }
      span.title += hesitationNote;
    }

    // Kitchen Sink disfluency dot marker (Phase 24)
    // sttWord has isDisfluency and disfluencyType from kitchen-sink-merger.js
    if (sttWord?.isDisfluency) {
      span.classList.add('word-disfluency');
      const typeLabels = {
        filler: 'Filler (um, uh)',
        repetition: 'Repetition',
        false_start: 'False start',
        unknown: 'Disfluency'
      };
      const label = typeLabels[sttWord.disfluencyType] || 'Disfluency';
      span.title += '\n' + label + ' — not an error';
    }

    // Compound word indicator (e.g. "every"+"one" → "everyone")
    // Shows when STT split a word at a morpheme boundary and compound merger healed it
    if (item.compound && item.parts) {
      span.title += '\nCompound: student said "' + item.parts.join('" + "') + '"';
    }

    // Insert pause indicator before this word if previous hyp word had a long pause
    if (currentHypIndex !== null && currentHypIndex > 0) {
      const hasPause = longPauseMap.has(currentHypIndex - 1);
      console.log('[UI Debug] Checking pause before word:', item.ref, 'currentHypIndex:', currentHypIndex, 'checking key:', currentHypIndex - 1, 'found:', hasPause);
      if (hasPause) {
        const pause = longPauseMap.get(currentHypIndex - 1);
        const pauseSpan = document.createElement('span');
        pauseSpan.className = 'pause-indicator';

        // VAD visual distinction: orange if speech >= 30%
        if (pause._vadAnalysis && pause._vadAnalysis.speechPercent >= 30) {
          pauseSpan.classList.add('pause-indicator-vad');
        }

        const pauseMs = Math.round(pause.gap * 1000);
        let pauseTooltip = 'Long pause: ' + pauseMs + 'ms (error: >= 3000ms)';
        pauseTooltip += buildVADTooltipInfo(pause._vadAnalysis);
        pauseSpan.title = pauseTooltip;
        pauseSpan.textContent = '[' + pause.gap + 's]';
        wordsDiv.appendChild(pauseSpan);
        wordsDiv.appendChild(document.createTextNode(' '));
        console.log('[UI Debug] ✓ Inserted pause indicator:', pause.gap, 's before', item.ref);
      }
    }

    // Check for disfluency badge (Phase 16) -- skip when Kitchen Sink data present
    const hasDisfluency = sttWord?.severity && sttWord.severity !== 'none' && !('isDisfluency' in (sttWord || {}));

    if (hasDisfluency) {
      // Wrap word in container for badge positioning
      const container = document.createElement('span');
      container.className = 'word-with-disfluency';
      container.appendChild(span);

      const badge = createDisfluencyBadge(sttWord);
      if (badge) container.appendChild(badge);

      wordsDiv.appendChild(container);
    } else {
      wordsDiv.appendChild(span);
    }
    wordsDiv.appendChild(document.createTextNode(' '));

    // Advance hypIndex for non-omission items
    if (item.type !== 'omission') {
      hypIndex++;
    }
  }

  // Insertions section (excluding forgiven proper noun parts AND disfluent words)
  // Disfluent words are expected speech patterns, not unexpected insertions
  const regularInsertions = insertions.filter(ins => {
    if (ins.partOfForgiven) return false;
    if (ins._isSelfCorrection) return false;
    if (ins._partOfStruggle) return false;
    // Check if the corresponding STT word is a disfluency
    if (ins.hyp && sttLookup) {
      const queue = sttLookup.get(ins.hyp);
      // Peek at first item without consuming it
      if (queue && queue.length > 0 && queue[0]?.isDisfluency) return false;
    }
    return true;
  });
  if (regularInsertions.length > 0) {
    const insertSection = document.createElement('div');
    insertSection.style.marginTop = '1rem';
    const insertLabel = document.createElement('div');
    insertLabel.style.fontWeight = '600';
    insertLabel.style.marginBottom = '0.25rem';
    insertLabel.textContent = 'Inserted words (not in passage):';
    insertSection.appendChild(insertLabel);
    for (const ins of regularInsertions) {
      const span = document.createElement('span');
      span.className = 'word word-insertion';
      span.textContent = ins.hyp;
      if (ins.hyp && sttLookup) {
        const queue = sttLookup.get(ins.hyp);
        if (queue && queue.length > 0) {
          const meta = queue.shift();
          const start = parseFloat(meta.startTime?.replace('s', '')) || 0;
          const end = parseFloat(meta.endTime?.replace('s', '')) || 0;
          span.title = ins.hyp + `\n${start.toFixed(2)}s – ${end.toFixed(2)}s  |  ${meta.crossValidation || 'N/A'}`;
        }
      }
      insertSection.appendChild(span);
      insertSection.appendChild(document.createTextNode(' '));
    }
    wordsDiv.appendChild(insertSection);
  }

  // Self-corrections section
  if (diagnostics && diagnostics.selfCorrections && diagnostics.selfCorrections.length > 0) {
    const scSection = document.createElement('div');
    scSection.style.marginTop = '1rem';
    const scLabel = document.createElement('div');
    scLabel.style.fontWeight = '600';
    scLabel.style.marginBottom = '0.25rem';
    scLabel.textContent = 'Self-corrections (not counted as errors):';
    scSection.appendChild(scLabel);
    for (const sc of diagnostics.selfCorrections) {
      const span = document.createElement('span');
      span.className = 'word word-self-correction';
      const repeats = sc.type === 'phrase-repeat' ? sc.count / 2 : sc.count - 1;
      span.textContent = sc.words + (repeats > 1 ? ' (repeated ' + repeats + 'x)' : ' (repeated)');
      span.title = sc.type + ' at position ' + sc.startIndex;
      scSection.appendChild(span);
      scSection.appendChild(document.createTextNode(' '));
    }
    wordsDiv.appendChild(scSection);
  }

  // Near-miss self-corrections (e.g., "epi-" → "epiphany")
  const nearMissSC = alignment.filter(a => a._isSelfCorrection);
  if (nearMissSC.length > 0) {
    const nmscSection = document.createElement('div');
    nmscSection.style.marginTop = '1rem';
    const nmscLabel = document.createElement('div');
    nmscLabel.style.fontWeight = '600';
    nmscLabel.style.marginBottom = '0.25rem';
    nmscLabel.textContent = 'Near-miss self-corrections (not counted as errors):';
    nmscSection.appendChild(nmscLabel);
    for (const sc of nearMissSC) {
      const span = document.createElement('span');
      span.className = 'word word-self-correction';
      span.textContent = `"${sc.hyp}" \u2192 "${sc._nearMissTarget}"`;
      span.title = `Near-miss self-correction: student said "${sc.hyp}", then correctly said "${sc._nearMissTarget}"`;
      nmscSection.appendChild(span);
      nmscSection.appendChild(document.createTextNode(' '));
    }
    wordsDiv.appendChild(nmscSection);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Confidence Visualization Section
  // ─────────────────────────────────────────────────────────────────────────
  const confWordsDiv = document.getElementById('confidenceWords');
  if (confWordsDiv && transcriptWords && transcriptWords.length > 0) {
    confWordsDiv.innerHTML = '';

    for (const w of transcriptWords) {
      const span = document.createElement('span');

      // Determine confidence class
      // Priority: disagreed overrides confidence score (models heard different words)
      // Otherwise: confidence score thresholds apply
      let confClass = 'conf-low';
      const conf = w.confidence;

      if (w.crossValidation === 'disagreed') {
        // Models disagree — flag regardless of confidence score
        confClass = 'conf-disagreed';
      } else if (conf != null && conf >= 0.93) {
        confClass = 'conf-high';
      } else if (conf != null && conf >= 0.70) {
        confClass = 'conf-medium';
      } else {
        confClass = 'conf-low';
      }

      span.className = 'conf-word ' + confClass;
      span.textContent = w.word;

      // Build tooltip with model words and cross-validation status
      const start = parseSttTime(w.startTime);
      const end = parseSttTime(w.endTime);
      const xval = w.crossValidation || 'N/A';
      const dgWord = w._deepgramWord ? `Deepgram heard: "${w._deepgramWord}"` : '';
      const rvWord = w._alignment?.verbatim ? `Reverb heard: "${w._alignment.verbatim}"` : '';
      const confPct = conf != null ? `Confidence: ${Math.round(conf * 100)}%` : '';
      span.title = [w.word, dgWord, rvWord, `Cross-validation: ${xval}`, confPct, `${start.toFixed(2)}s – ${end.toFixed(2)}s`].filter(Boolean).join('\n');

      confWordsDiv.appendChild(span);
      confWordsDiv.appendChild(document.createTextNode(' '));
    }
  }

  // JSON details — per-word timestamps from raw STT, all inter-word gaps

  // Build STT words array with parsed times
  const sttWords = (transcriptWords || []).map(w => {
    const start = parseSttTime(w.startTime);
    const end = parseSttTime(w.endTime);
    return {
      word: w.word,
      startTime: start,
      endTime: end,
      confidence: w.confidence != null ? Math.round(w.confidence * 1000) / 1000 : null
    };
  });

  // Compute ALL inter-word gaps (between every consecutive STT word pair)
  const allGaps = [];
  for (let g = 1; g < sttWords.length; g++) {
    const gap = +(sttWords[g].startTime - sttWords[g - 1].endTime).toFixed(3);
    allGaps.push({
      afterWord: sttWords[g - 1].word,
      beforeWord: sttWords[g].word,
      afterIndex: g - 1,
      gap,
      fromTime: +sttWords[g - 1].endTime.toFixed(3),
      toTime: +sttWords[g].startTime.toFixed(3)
    });
  }

  // Enrich alignment with timestamps by walking hyp words through STT in order
  let enrichIdx = 0;
  const enrichedAlignment = alignment.map(item => {
    const entry = { ...item };
    if (item.hyp && enrichIdx < sttWords.length) {
      const sw = sttWords[enrichIdx];
      entry.startTime = sw.startTime;
      entry.endTime = sw.endTime;
      entry.confidence = sw.confidence;
      enrichIdx++;
    }
    return entry;
  });

  // Disfluency diagnostics section (Phase 24)
  // disfluencySummary carries Kitchen Sink disfluencyStats when available
  if (disfluencySummary && disfluencySummary.total !== undefined) {
    renderDisfluencySection(disfluencySummary);
  }

  jsonDiv.textContent = JSON.stringify({
    alignment: enrichedAlignment,
    sttWords,
    allGaps,
    wcpm,
    accuracy,
    diagnostics: diagnostics || null
  }, null, 2);
}

/**
 * Render the disfluency diagnostics section (Phase 24).
 * Populates the collapsible section with count, rate, and type breakdown.
 *
 * @param {object|null} disfluencyStats - Stats from Kitchen Sink pipeline:
 *   { total, contentWords, rate, byType: { filler, repetition, false_start, unknown } }
 */
function renderDisfluencySection(disfluencyStats) {
  const section = document.getElementById('disfluencySection');
  const summaryEl = document.getElementById('disfluencySummaryText');
  const detailsEl = document.getElementById('disfluencyDetails');

  if (!section || !summaryEl || !detailsEl) return;

  // Hide section if no disfluency data at all
  if (!disfluencyStats) {
    section.style.display = 'none';
    return;
  }

  // Show section (even with 0 disfluencies to confirm pipeline is active)
  section.style.display = '';

  // Zero disfluencies — show confirmation message
  if (disfluencyStats.total === 0) {
    summaryEl.textContent = 'No disfluencies detected';
    detailsEl.innerHTML = '';
    return;
  }

  // Determine dominant type for collapsed summary
  const byType = disfluencyStats.byType || {};
  let dominant = '';
  let maxCount = 0;
  for (const [type, count] of Object.entries(byType)) {
    if (count > maxCount) {
      maxCount = count;
      dominant = type;
    }
  }

  const dominantLabels = {
    filler: 'fillers',
    repetition: 'repetitions',
    false_start: 'false starts',
    unknown: 'unclassified'
  };
  const dominantText = dominant && maxCount > 0
    ? ` (mostly ${dominantLabels[dominant] || dominant})`
    : '';

  // Collapsed summary line
  summaryEl.textContent = `Disfluencies: ${disfluencyStats.total}${dominantText}`;

  // Expanded detail breakdown
  detailsEl.innerHTML = '';

  const typeDisplay = [
    { key: 'filler', label: 'Fillers (um, uh)' },
    { key: 'repetition', label: 'Repetitions' },
    { key: 'false_start', label: 'False starts' },
    { key: 'unknown', label: 'Other' }
  ];

  for (const { key, label } of typeDisplay) {
    const count = byType[key] || 0;
    if (count === 0) continue;

    const row = document.createElement('div');
    row.className = 'disfluency-type-row';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'disfluency-type-label';
    labelSpan.textContent = label;

    const countSpan = document.createElement('span');
    countSpan.className = 'disfluency-type-count';
    countSpan.textContent = count;

    row.appendChild(labelSpan);
    row.appendChild(countSpan);
    detailsEl.appendChild(row);
  }

  // Rate line at bottom
  if (disfluencyStats.rate) {
    const rateLine = document.createElement('div');
    rateLine.style.marginTop = '0.5rem';
    rateLine.style.color = '#888';
    rateLine.style.fontSize = '0.8rem';
    rateLine.textContent = `Rate: ${disfluencyStats.rate} of words`;
    detailsEl.appendChild(rateLine);
  }
}

/**
 * Convert AudioBuffer to WAV blob.
 */
function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  const length = buffer.length;
  const dataLength = length * numChannels * bytesPerSample;
  const headerLength = 44;
  const totalLength = headerLength + dataLength;

  const arrayBuffer = new ArrayBuffer(totalLength);
  const view = new DataView(arrayBuffer);

  const writeString = (offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, totalLength - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  const channels = [];
  for (let i = 0; i < numChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/**
 * Show an audio playback control for the recorded/uploaded blob.
 * @param {Blob} blob
 */
export function showAudioPlayback(blob) {
  let container = document.getElementById('audioPlayback');
  if (!container) {
    container = document.createElement('div');
    container.id = 'audioPlayback';
    container.style.marginTop = '1rem';
    document.getElementById('resultWords').parentNode.insertBefore(container, document.getElementById('resultWords'));
  }
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.style.display = 'flex';
  wrapper.style.alignItems = 'center';
  wrapper.style.gap = '0.5rem';

  const audio = document.createElement('audio');
  audio.controls = true;
  audio.src = URL.createObjectURL(blob);

  const downloadBtn = document.createElement('button');
  downloadBtn.textContent = '⬇ WAV';
  downloadBtn.title = 'Download as WAV file';
  downloadBtn.style.padding = '0.4rem 0.8rem';
  downloadBtn.style.cursor = 'pointer';

  downloadBtn.addEventListener('click', async () => {
    downloadBtn.disabled = true;
    downloadBtn.textContent = '...';
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const arrayBuffer = await blob.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const wavBlob = audioBufferToWav(audioBuffer);
      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'recording-' + new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-') + '.wav';
      a.click();
      URL.revokeObjectURL(url);
      audioContext.close();
    } catch (err) {
      console.error('WAV conversion failed:', err);
      alert('Failed to convert to WAV: ' + err.message);
    } finally {
      downloadBtn.disabled = false;
      downloadBtn.textContent = '⬇ WAV';
    }
  });

  wrapper.appendChild(audio);
  wrapper.appendChild(downloadBtn);
  container.appendChild(wrapper);
}

/**
 * Render student selector dropdown.
 * @param {Array<{id: string, name: string}>} students
 * @param {string|null} selectedId
 */
export function renderStudentSelector(students, selectedId) {
  const select = document.getElementById('studentSelect');
  // Clear all options except first default option
  while (select.options.length > 1) {
    select.remove(1);
  }
  // Add student options
  for (const student of students) {
    const option = document.createElement('option');
    option.value = student.id;
    option.textContent = student.name;
    if (student.id === selectedId) {
      option.selected = true;
    }
    select.appendChild(option);
  }
}

/**
 * Render assessment history for selected student.
 * @param {Array<{date: string, wcpm: number|null, accuracy: number|null, passagePreview: string|null}>|null} assessments
 */
export function renderHistory(assessments) {
  const historySection = document.getElementById('historySection');
  const historyList = document.getElementById('historyList');

  if (!assessments) {
    // No student selected
    historySection.style.display = 'none';
    historyList.textContent = 'No student selected.';
    return;
  }

  historySection.style.display = 'block';

  if (assessments.length === 0) {
    historyList.textContent = 'No assessments yet.';
    return;
  }

  // Build table
  let tableHTML = '<table><thead><tr><th>Date</th><th>Passage</th><th>WCPM</th><th>Accuracy</th></tr></thead><tbody>';
  for (const a of assessments) {
    const date = new Date(a.date).toLocaleDateString();
    const passage = a.passagePreview ? a.passagePreview.slice(0, 30) + '...' : 'N/A';
    const wcpm = a.wcpm != null ? a.wcpm : 'N/A';
    const accuracy = a.accuracy != null ? a.accuracy + '%' : 'N/A';
    tableHTML += `<tr><td>${date}</td><td>${passage}</td><td>${wcpm}</td><td>${accuracy}</td></tr>`;
  }
  tableHTML += '</tbody></table>';
  historyList.innerHTML = tableHTML;
}
