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
  } else if (item.type === 'omission') {
    lines.push('Omitted (not read)');
  } else if (item.type === 'self-correction') {
    lines.push(`"${item.hyp}" (self-correction)`);
  } else {
    lines.push(item.ref || '');
  }

  // Timestamps with duration (per CONTEXT.md: "offset range AND duration")
  if (sttWord) {
    const start = parseSttTime(sttWord.startTime);
    const end = parseSttTime(sttWord.endTime);
    const durationMs = Math.round((end - start) * 1000);
    lines.push(`Time: ${start.toFixed(2)}s - ${end.toFixed(2)}s (${durationMs}ms)`);

    // Dual model info from _debug
    if (sttWord._debug) {
      if (sttWord._debug.latest) {
        const l = sttWord._debug.latest;
        const lStart = parseSttTime(l.startTime);
        const lEnd = parseSttTime(l.endTime);
        const conf = l.confidence != null ? (l.confidence * 100).toFixed(1) + '%' : '—';
        lines.push(`latest_long: "${l.word}" (${conf}) ${lStart.toFixed(2)}s-${lEnd.toFixed(2)}s`);
      }
      if (sttWord._debug.default) {
        const d = sttWord._debug.default;
        const dStart = parseSttTime(d.startTime);
        const dEnd = parseSttTime(d.endTime);
        const conf = d.confidence != null ? (d.confidence * 100).toFixed(1) + '%' : '—';
        lines.push(`default: "${d.word}" (${conf}) ${dStart.toFixed(2)}s-${dEnd.toFixed(2)}s`);
      }
    }
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
        span.className = 'word ' + (w.confidence >= 0.9 ? 'high' : w.confidence >= 0.7 ? 'mid' : 'low');
        const start = parseSttTime(w.startTime);
        const end = parseSttTime(w.endTime);
        span.title = `Confidence: ${(w.confidence * 100).toFixed(1)}%  |  ${start.toFixed(2)}s – ${end.toFixed(2)}s`;
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

export function displayAlignmentResults(alignment, wcpm, accuracy, sttLookup, diagnostics, transcriptWords, tierBreakdown) {
  const wordsDiv = document.getElementById('resultWords');
  const plainDiv = document.getElementById('resultPlain');
  const jsonDiv = document.getElementById('resultJson');
  wordsDiv.innerHTML = ''; plainDiv.textContent = ''; jsonDiv.textContent = '';

  // Metrics summary bar
  const metricsBar = document.createElement('div');
  metricsBar.className = 'metrics-bar';

  const wcpmBox = document.createElement('div');
  wcpmBox.className = 'metric-box';
  wcpmBox.innerHTML = '<span class="metric-value">' + (wcpm ? wcpm.wcpm : 'N/A') + '</span><span class="metric-label">WCPM</span>';
  metricsBar.appendChild(wcpmBox);

  const accBox = document.createElement('div');
  accBox.className = 'metric-box';
  const forgivenNote = accuracy.forgiven > 0 ? ' (' + accuracy.forgiven + ' proper noun' + (accuracy.forgiven > 1 ? 's' : '') + ' forgiven)' : '';
  accBox.innerHTML = '<span class="metric-value">' + accuracy.accuracy + '%</span><span class="metric-label">Accuracy' + forgivenNote + '</span>';
  metricsBar.appendChild(accBox);

  const errBox = document.createElement('div');
  errBox.className = 'metric-box metric-box-errors';
  errBox.innerHTML = '<span class="metric-label">' +
    accuracy.substitutions + ' substitutions, ' +
    accuracy.omissions + ' omissions, ' +
    accuracy.insertions + ' insertions</span>';
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
      sttIdx++;
      renderHypIdx++;
    }
  }

  // Build diagnostic lookup structures
  const onsetDelayMap = new Map(); // hypIndex -> {gap, threshold, punctuationType}
  const longPauseMap = new Map(); // afterHypIndex -> {gap}
  const morphErrorSet = new Set(); // "ref|hyp" lowercase pairs
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
        morphErrorSet.add((m.ref || '').toLowerCase() + '|' + (m.hyp || '').toLowerCase());
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

    // Build tooltip with STT metadata
    const hypKey = item.hyp;
    let sttWord = null;
    let sttInfo = '';
    if (hypKey && sttLookup) {
      const queue = sttLookup.get(hypKey);
      if (queue && queue.length > 0) {
        sttWord = queue.shift();
        const conf = sttWord.confidence != null ? (sttWord.confidence * 100).toFixed(1) + '%' : '—';
        const start = parseSttTime(sttWord.startTime);
        const end = parseSttTime(sttWord.endTime);
        sttInfo = `\nConfidence: ${conf}  |  ${start.toFixed(2)}s – ${end.toFixed(2)}s`;
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

    // Build tooltip with enhanced debug info
    span.title = buildEnhancedTooltip(item, sttWord);

    // Additional context for specific types
    if (item.type === 'substitution') {
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
        if (morphErrorSet.has(morphKey)) {
          span.classList.add('word-morphological');
          span.title += '\n(Morphological error)';
        }
      }
    }

    // Append NL tooltip info
    if (item.nl) {
      span.title += '\n' + buildNLTooltip(item.nl);
    }

    // Append healed word indicator
    if (item.healed) {
      span.title += '\n(Healed: STT said "' + item.originalHyp + '")';
    }

    // Hesitation overlay (for items that have a hyp word)
    const currentHypIndex = (item.type !== 'omission') ? hypIndex : null;
    if (currentHypIndex !== null && onsetDelayMap.has(currentHypIndex)) {
      const delay = onsetDelayMap.get(currentHypIndex);
      span.classList.add('word-hesitation');
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
      span.title += hesitationNote;
    }

    // Insert pause indicator before this word if previous hyp word had a long pause
    if (currentHypIndex !== null && currentHypIndex > 0) {
      const hasPause = longPauseMap.has(currentHypIndex - 1);
      console.log('[UI Debug] Checking pause before word:', item.ref, 'currentHypIndex:', currentHypIndex, 'checking key:', currentHypIndex - 1, 'found:', hasPause);
      if (hasPause) {
        const pause = longPauseMap.get(currentHypIndex - 1);
        const pauseSpan = document.createElement('span');
        pauseSpan.className = 'pause-indicator';
        const pauseMs = Math.round(pause.gap * 1000);
        pauseSpan.title = 'Long pause: ' + pauseMs + 'ms (error: >= 3000ms)';
        pauseSpan.textContent = '[' + pause.gap + 's]';
        wordsDiv.appendChild(pauseSpan);
        wordsDiv.appendChild(document.createTextNode(' '));
        console.log('[UI Debug] ✓ Inserted pause indicator:', pause.gap, 's before', item.ref);
      }
    }

    wordsDiv.appendChild(span);
    wordsDiv.appendChild(document.createTextNode(' '));

    // Advance hypIndex for non-omission items
    if (item.type !== 'omission') {
      hypIndex++;
    }
  }

  // Insertions section (excluding those that are part of forgiven proper noun pronunciations)
  const regularInsertions = insertions.filter(ins => !ins.partOfForgiven);
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
          const conf = meta.confidence != null ? (meta.confidence * 100).toFixed(1) + '%' : '—';
          const start = parseFloat(meta.startTime?.replace('s', '')) || 0;
          const end = parseFloat(meta.endTime?.replace('s', '')) || 0;
          span.title = ins.hyp + `\nConfidence: ${conf}  |  ${start.toFixed(2)}s – ${end.toFixed(2)}s`;
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
  const audio = document.createElement('audio');
  audio.controls = true;
  audio.src = URL.createObjectURL(blob);
  container.appendChild(audio);
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
