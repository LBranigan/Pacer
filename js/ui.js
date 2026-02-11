import { recomputeWordSpeedWithPauses } from './diagnostics.js';

export function setStatus(msg) {
  document.getElementById('status').textContent = msg;
}

// ── Custom tooltip manager (mobile-friendly, replaces native title) ──────────
let _tooltipEl = null;
let _tooltipOwner = null;

function showWordTooltip(span, playFn) {
  hideWordTooltip();
  const text = span.dataset.tooltip;
  if (!text) return;

  _tooltipOwner = span;
  span.classList.add('word-active-tooltip');

  const tip = document.createElement('div');
  tip.className = 'word-tooltip';
  tip.textContent = text;

  if (playFn) {
    const btn = document.createElement('button');
    btn.className = 'tooltip-play';
    btn.textContent = '\u25B6 Play';
    btn.addEventListener('click', (e) => { e.stopPropagation(); playFn(); });
    tip.appendChild(btn);
  }

  document.body.appendChild(tip);
  _tooltipEl = tip;

  // Position near the word
  const rect = span.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  let left = rect.left + window.scrollX + (rect.width / 2) - (tipRect.width / 2);
  let top = rect.bottom + window.scrollY + 6;
  // Keep on screen
  if (left < 4) left = 4;
  if (left + tipRect.width > window.innerWidth - 4) left = window.innerWidth - tipRect.width - 4;
  if (top + tipRect.height > window.innerHeight + window.scrollY - 4) {
    top = rect.top + window.scrollY - tipRect.height - 6; // flip above
  }
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}

// ── Insertion/SC highlight overlay (coupled to tooltip lifecycle) ─────────────
let _highlightedSpans = [];

function clearHighlightOverlay() {
  for (const s of _highlightedSpans) {
    s.classList.remove('word-highlight-insertion', 'word-highlight-self-correction');
  }
  _highlightedSpans = [];
}

// Selector: only main alignment spans (excludes insertion/SC sections below)
const MAIN_SPAN_SEL = '.word-main[data-start-time]';

function findBracketingSpans(wordsDiv, startTime, endTime) {
  if (startTime === 0 && endTime === 0) return { prevSpan: null, nextSpan: null };
  const allSpans = [...wordsDiv.querySelectorAll(MAIN_SPAN_SEL)];
  const insMid = (startTime + endTime) / 2;
  let prevSpan = null;
  let nextSpan = null;
  for (const span of allSpans) {
    const spanStart = parseFloat(span.dataset.startTime) || 0;
    const spanEnd = parseFloat(span.dataset.endTime) || 0;
    const spanMid = (spanStart + spanEnd) / 2;
    if (spanMid <= insMid) {
      prevSpan = span;
    } else if (!nextSpan) {
      nextSpan = span;
    }
  }
  return { prevSpan, nextSpan };
}

function highlightSpanRange(wordsDiv, prevSpan, nextSpan, highlightClass) {
  const allSpans = [...wordsDiv.querySelectorAll(MAIN_SPAN_SEL)];
  const startIdx = prevSpan ? allSpans.indexOf(prevSpan) : 0;
  const endIdx = nextSpan ? allSpans.indexOf(nextSpan) : allSpans.length - 1;
  for (let i = startIdx; i <= endIdx; i++) {
    allSpans[i].classList.add(highlightClass);
    _highlightedSpans.push(allSpans[i]);
  }
  return { firstSpan: allSpans[startIdx], lastSpan: allSpans[endIdx] };
}

function applyHighlightOverlay(span, highlightClass) {
  const start = parseFloat(span.dataset.startTime) || 0;
  const end = parseFloat(span.dataset.endTime) || 0;
  if (start > 0 || end > 0) {
    const wordsDiv = document.getElementById('resultWords');
    if (!wordsDiv) return;
    const { prevSpan, nextSpan } = findBracketingSpans(wordsDiv, start, end);
    if (prevSpan || nextSpan) {
      highlightSpanRange(wordsDiv, prevSpan, nextSpan, highlightClass);
    }
  }
}

function hideWordTooltip() {
  if (_tooltipEl) { _tooltipEl.remove(); _tooltipEl = null; }
  if (_tooltipOwner) { _tooltipOwner.classList.remove('word-active-tooltip'); _tooltipOwner = null; }
  clearHighlightOverlay();
}

// Dismiss on click-away
document.addEventListener('click', (e) => {
  if (_tooltipEl && !_tooltipEl.contains(e.target) && e.target !== _tooltipOwner) {
    hideWordTooltip();
  }
});

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
 * Check if a word is a special ASR token (e.g., <unknown>, <unk>, <blank>).
 * These are CTC decoder failures or special vocabulary items, not real words.
 * @param {string} word - Raw word text from STT
 * @returns {boolean}
 */
function isSpecialASTToken(word) {
  return typeof word === 'string' && word.startsWith('<') && word.endsWith('>') && word.length > 2;
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

  // Show ? for special ASR tokens instead of literal text
  const isUnknown = sttWord && isSpecialASTToken(sttWord.word);
  const saidText = isUnknown ? '?' : item.hyp;

  // Existing type info
  if (item.type === 'substitution') {
    lines.push(`Expected: ${item.ref}, Said: ${saidText}`);
    if (isUnknown) lines.push('Speech detected but not recognized as a word');
    if (isUnknown && sttWord?._xvalWord) {
      const xvalLabel = sttWord._xvalEngine
        ? sttWord._xvalEngine.charAt(0).toUpperCase() + sttWord._xvalEngine.slice(1)
        : 'Cross-val';
      lines.push(`${xvalLabel} heard: "${sttWord._xvalWord}"`);
      lines.push('Reverb could not decode this word (CTC failure)');
      lines.push(`Only ${xvalLabel} provides evidence — single source, verify`);
    }
  } else if (item.type === 'struggle') {
    lines.push(`Expected: ${item.ref}, Said: ${saidText}`);
    if (isUnknown) lines.push('Speech detected but not recognized as a word');
    lines.push('');
    lines.push('Struggle pathways:');

    // Path 1: Hesitation — long pause before the word
    const hasHesitationPath = item._strugglePath === 'hesitation' || item._hasHesitation;
    if (hasHesitationPath && item._hesitationGap) {
      const gapMs = Math.round(item._hesitationGap * 1000);
      lines.push(`  Hesitation: ${gapMs}ms pause before failed word`);
    }

    // Path 2: Decoding — near-miss insertions around the word
    const hasDecodingPath = item._strugglePath === 'decoding' || (item._nearMissEvidence && item._nearMissEvidence.length > 0);
    if (hasDecodingPath && item._nearMissEvidence) {
      const attempts = [item.hyp, ...item._nearMissEvidence];
      lines.push(`  Decoding: ${attempts.length} failed attempts (${attempts.join(', ')})`);
    }

    // Path 3: Abandoned Attempt — only verbatim STT detected, cross-validator N/A
    if (item._abandonedAttempt) {
      lines.push(`  Abandoned attempt: partial "${item.hyp}" (cross-validator N/A, verbatim-only)`);
    }
  } else if (item.type === 'omission') {
    lines.push('Omitted (not read)');
  } else if (item.type === 'self-correction') {
    lines.push(`"${item.hyp}" (self-correction)`);
  } else if (item._recovered) {
    lines.push(`"${item.ref}" — recovered from omission`);
    if (item._isLastRefWord) {
      lines.push('Reverb missed the final word (known CTC end-of-utterance limitation)');
      lines.push('Parakeet confirmed this word — expected for final position');
    } else {
      lines.push('Originally marked as omission (not read)');
      lines.push('Parakeet heard this word; Reverb heard nothing');
      lines.push('Evidence is weak — single biased source, may need verification');
    }
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
    const xvStart = sttWord._xvalStartTime != null ? parseSttTime(sttWord._xvalStartTime) : null;
    const xvEnd = sttWord._xvalEndTime != null ? parseSttTime(sttWord._xvalEndTime) : null;
    const rvStart = sttWord._reverbStartTime != null ? parseSttTime(sttWord._reverbStartTime) : null;
    const rvEnd = sttWord._reverbEndTime != null ? parseSttTime(sttWord._reverbEndTime) : null;
    const rcStart = sttWord._reverbCleanStartTime != null ? parseSttTime(sttWord._reverbCleanStartTime) : null;
    const rcEnd = sttWord._reverbCleanEndTime != null ? parseSttTime(sttWord._reverbCleanEndTime) : null;

    const fmtTs = (s, e) => {
      if (s == null || e == null) return 'N/A';
      const dur = Math.round((e - s) * 1000);
      return `${s.toFixed(2)}s-${e.toFixed(2)}s (${dur}ms)`;
    };
    const xvalLabel = sttWord._xvalEngine ? sttWord._xvalEngine.charAt(0).toUpperCase() + sttWord._xvalEngine.slice(1) : 'Cross-val';
    lines.push(`  ${xvalLabel}:    ${fmtTs(xvStart, xvEnd)}`);
    lines.push(`  Reverb v1.0: ${fmtTs(rvStart, rvEnd)}`);
    lines.push(`  Reverb v0.0: ${fmtTs(rcStart, rcEnd)}`);

    // What each model heard (word text)
    const reverbWord = sttWord._alignment?.verbatim || (sttWord._recovered ? null : sttWord.word);
    const xvalWord = sttWord._xvalWord;
    // Show full divergence block story when available (e.g., "apo- a pe-peal" instead of just "pe-peal")
    const reverbFull = sttWord._divergence && sttWord._divergence.verbatimWords.length > 1
      ? sttWord._divergence.verbatimWords.join(' ')
      : reverbWord;
    if (sttWord._recovered) {
      lines.push(`${xvalLabel} heard: "${xvalWord || sttWord.word}"`);
      lines.push('Reverb heard: [nothing]');
    } else if (xvalWord) {
      lines.push(`${xvalLabel} heard: "${xvalWord}"`);
      lines.push(`Reverb heard: "${reverbFull}"`);
    } else if (xvalWord === null) {
      lines.push(`${xvalLabel} heard: [null]`);
      lines.push(`Reverb heard: "${reverbFull}"`);
    } else {
      lines.push(`Reverb heard: "${reverbFull}"`);
    }

    // Cross-validation status
    const xval = sttWord.crossValidation;
    if (xval) {
      const recoveredLabel = sttWord._isLastRefWord
        ? ` (${xvalLabel} only — final word, Reverb CTC truncation)`
        : ` (${xvalLabel} only — Reverb heard nothing, weak evidence)`;
      const xvalLabels = {
        confirmed: ' (both agree)',
        disagreed: ' (models heard different words)',
        unconfirmed: ` (Reverb only — ${xvalLabel} heard nothing)`,
        unavailable: ` (${xvalLabel} offline)`,
        recovered: recoveredLabel
      };
      lines.push(`Cross-validation: ${xval}${xvalLabels[xval] || ''}`);
    }

    // Disfluency info (divergence block from v1/v0 diff)
    if (sttWord.isDisfluency) {
      if (sttWord._divergence) {
        const d = sttWord._divergence;
        const target = d.cleanTarget || '?';
        const fragments = d.verbatimWords.map(w => `"${w}"`).join(', ');
        lines.push(`Struggle with "${target}" — attempts: ${fragments}`);
        if (d.role === 'merged') {
          lines.push('Divergence block (V2 collapsed)');
        } else {
          lines.push(`Role: ${d.role === 'final' ? 'final attempt' : 'fragment'} (not an error)`);
        }
      } else {
        lines.push('Disfluency (not an error)');
      }
    }

    // Recovery warning (Parakeet-only omission recovery)
    if (sttWord._recovered && !sttWord._isLastRefWord) {
      lines.push('Recovered from Parakeet only — Reverb heard nothing. Evidence is weak.');
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
        span.dataset.tooltip = `${w.word}  |  ${start.toFixed(2)}s – ${end.toFixed(2)}s  |  ${w.crossValidation || 'N/A'}`;
        span.addEventListener('click', (e) => { e.stopPropagation(); showWordTooltip(span, null); });
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

export function displayAlignmentResults(alignment, wcpm, accuracy, sttLookup, diagnostics, transcriptWords, tierBreakdown, disfluencySummary, referenceText, audioBlob, rawSttSources) {
  const wordsDiv = document.getElementById('resultWords');
  const plainDiv = document.getElementById('resultPlain');
  const jsonDiv = document.getElementById('resultJson');
  const prosodyContainer = document.getElementById('prosodyContainer');
  wordsDiv.innerHTML = ''; plainDiv.textContent = ''; jsonDiv.textContent = '';
  if (prosodyContainer) { prosodyContainer.innerHTML = ''; prosodyContainer.style.display = 'none'; }

  // Click-to-play word audio setup
  if (window._wordAudioEl) { window._wordAudioEl.pause(); URL.revokeObjectURL(window._wordAudioEl.src); }
  let wordAudioEl = null;
  let wordAudioUrl = null;
  if (audioBlob) {
    wordAudioEl = new Audio();
    wordAudioEl.preload = 'auto';
    wordAudioUrl = URL.createObjectURL(audioBlob);
    wordAudioEl.src = wordAudioUrl;
    wordAudioEl.load(); // Required for iOS Safari to buffer audio for seeking
    window._wordAudioEl = wordAudioEl;
  }

  // Build map: refIndex → trailing punctuation string (cosmetic only, not scored)
  // Must mirror normalizeText's trailing-hyphen merge so indices align with alignment entries.
  // Without merging, OCR artifacts like "spread- sheet" create an index offset that shifts
  // all subsequent punctuation to the wrong word (e.g., period after "process" lands on "shanna").
  const punctSuffixMap = new Map();
  if (referenceText) {
    const rawTokens = referenceText.trim().split(/\s+/);
    const mergedForPunct = [];
    for (let i = 0; i < rawTokens.length; i++) {
      const stripped = rawTokens[i].replace(/^[^\w'-]+|[^\w'-]+$/g, '');
      if (stripped.length === 0) continue; // skip empty tokens (bullet points etc.)
      if (stripped.endsWith('-') && i + 1 < rawTokens.length) {
        mergedForPunct.push(rawTokens[i + 1]); // second part may carry trailing punct
        i++;
      } else {
        mergedForPunct.push(rawTokens[i]);
      }
    }
    // Split internal-hyphen tokens to mirror normalizeText's hyphen split.
    // e.g., "soft-on-skin." → ["soft", "on", "soft-on-skin."] so only the last
    // part (original token) feeds the punct regex and gets the trailing period.
    const splitForPunct = [];
    for (const token of mergedForPunct) {
      const stripped = token.replace(/^[^\w'-]+|[^\w'-]+$/g, '');
      if (stripped.includes('-')) {
        const parts = stripped.split('-').filter(p => p.length > 0);
        for (let j = 0; j < parts.length - 1; j++) splitForPunct.push(parts[j]);
        splitForPunct.push(token); // last part: use original token so punct regex works
      } else {
        splitForPunct.push(token);
      }
    }
    for (let i = 0; i < splitForPunct.length; i++) {
      const w = splitForPunct[i];
      const match = w.match(/([.!?,;:\u2014\u2013\u2012\u2015]+["'\u201C\u201D\u2018\u2019)}\]]*|["'\u201C\u201D\u2018\u2019)}\]]+)$/);
      if (match) punctSuffixMap.set(i, match[0]);
    }
  }

  // Metrics summary bar
  const metricsBar = document.createElement('div');
  metricsBar.className = 'metrics-bar';

  // WCPM box with range display
  const wcpmBox = document.createElement('div');
  wcpmBox.className = 'metric-box';

  if (wcpm) {
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

  // ── Collapsible Prosody Section ──
  if (diagnostics && diagnostics.prosody && !diagnostics.prosody.phrasing.insufficient) {
    const pros = diagnostics.prosody;
    const section = document.createElement('div');
    section.className = 'prosody-section';

    // Header — matches Confidence View / Disfluencies pattern
    const header = document.createElement('div');
    header.className = 'prosody-header';
    header.innerHTML = '<h4>Prosody</h4><span class="prosody-toggle">&#9660;</span>';

    header.addEventListener('click', () => {
      section.classList.toggle('expanded');
    });
    section.appendChild(header);

    // Body (expanded detail)
    const body = document.createElement('div');
    body.className = 'prosody-body';

    const phrasingPart = pros.phrasing.readingPattern.classification;
    const isWordByWordOrChoppy = phrasingPart === 'word-by-word' || phrasingPart === 'choppy';

    // Warning for word-by-word / choppy
    if (isWordByWordOrChoppy) {
      const warning = document.createElement('div');
      warning.className = 'prosody-warning';
      const gapMs = pros.phrasing.readingPattern.medianGap != null
        ? Math.round(pros.phrasing.readingPattern.medianGap * 1000) + 'ms'
        : '?';
      warning.textContent = (phrasingPart === 'word-by-word' ? 'Word-by-word' : 'Choppy') +
        ' reading pattern (median gap: ' + gapMs + ')';
      body.appendChild(warning);
    }

    // Four metric boxes
    const metricsRow = document.createElement('div');
    metricsRow.className = 'prosody-metrics';

    // Box 1: Phrasing
    const phrasingBox = document.createElement('div');
    phrasingBox.className = 'metric-box';
    if (isWordByWordOrChoppy) {
      const gapMs = pros.phrasing.readingPattern.medianGap != null
        ? Math.round(pros.phrasing.readingPattern.medianGap * 1000) + 'ms'
        : '?';
      phrasingBox.innerHTML = '<span class="metric-value">' +
        (phrasingPart === 'word-by-word' ? 'Word-by-word' : 'Choppy') +
        '</span><span class="metric-label">reading (gap: ' + gapMs + ')</span>';
    } else {
      phrasingBox.innerHTML = '<span class="metric-value">' +
        (pros.phrasing.fluencyPhrasing.median != null ? pros.phrasing.fluencyPhrasing.median : 'N/A') +
        '</span><span class="metric-label">words/phrase (fluency)</span>';
    }
    // Phrasing tooltip
    const phTip = [];
    phTip.push('How fluently this student reads between sentence boundaries.');
    if (pros.phrasing.fluencyPhrasing.median != null) {
      phTip.push('Fluency: median ' + pros.phrasing.fluencyPhrasing.median + ' words/phrase (mean ' + pros.phrasing.fluencyPhrasing.mean + ')');
    }
    if (pros.phrasing.overallPhrasing.median != null) {
      phTip.push('Overall: median ' + pros.phrasing.overallPhrasing.median + ' words/phrase (mean ' + pros.phrasing.overallPhrasing.mean + ')');
    }
    phTip.push(pros.phrasing.breakClassification.unexpected + ' unexpected pauses, ' + pros.phrasing.breakClassification.atPunctuation + ' at punctuation');
    const gd = pros.phrasing.gapDistribution;
    phTip.push('Gap analysis: Q3=' + gd.Q3 + 's, IQR=' + gd.IQR + 's, Fence=' + gd.gapFence + 's (IQR-based)');
    const bs = pros.phrasing.breakSources;
    phTip.push('Breaks: ' + bs.fromHesitations + ' hesitations, ' + bs.fromLongPauses + ' long pauses, ' + bs.fromMediumPauses + ' medium pauses');
    if (bs.vadFiltered > 0) phTip.push('(' + bs.vadFiltered + ' hesitations filtered by VAD)');
    phrasingBox.title = phTip.join('\n');
    metricsRow.appendChild(phrasingBox);

    // Box 2: Punctuation Coverage
    const punctBox = document.createElement('div');
    punctBox.className = 'metric-box';
    const cov = pros.pauseAtPunctuation.coverage;
    if (cov.ratio !== null) {
      punctBox.innerHTML = '<span class="metric-value">' + cov.coveredCount + ' of ' + cov.encounteredPunctuationMarks +
        '</span><span class="metric-label">Punctuation Coverage</span>';
    } else {
      punctBox.innerHTML = '<span class="metric-value">N/A</span><span class="metric-label">Punctuation Coverage</span>';
    }
    const ptTip = [];
    if (cov.ratio !== null) {
      ptTip.push('Of ' + cov.encounteredPunctuationMarks + ' punctuation marks encountered, the student paused at ' + cov.coveredCount + '.');
      ptTip.push('(' + cov.totalPunctuationMarks + ' total in passage, ' + cov.encounteredPunctuationMarks + ' encountered by student, last word excluded)');
      ptTip.push('Pause threshold: ' + (cov.punctPauseThresholdMs || '?') + 'ms (1.5x median gap, floor 100ms)');
      if (cov.uncoveredMarks.length > 0) {
        ptTip.push('Missed: ' + cov.uncoveredMarks.map(m => m.punctType + ' after "' + m.refWord + '"' + (m.gap != null ? ' (' + m.gap + 'ms gap)' : '')).join(', '));
      }
    } else {
      ptTip.push(cov.label);
    }
    const prec = pros.pauseAtPunctuation.precision;
    if (prec.ratio !== null) {
      ptTip.push('Also: ' + Math.round(prec.ratio * 100) + '% of all pauses landed at punctuation (' + prec.atPunctuationCount + ' of ' + prec.totalPauses + ')');
    }
    punctBox.title = ptTip.join('\n');
    metricsRow.appendChild(punctBox);

    // Box 3: Duration Outliers
    const outBox = document.createElement('div');
    outBox.className = 'metric-box';
    if (!pros.wordOutliers.insufficient) {
      outBox.innerHTML = '<span class="metric-value">' + pros.wordOutliers.outlierCount +
        ' word' + (pros.wordOutliers.outlierCount !== 1 ? 's' : '') +
        '</span><span class="metric-label">Duration Outliers</span>';
      const oTip = [];
      oTip.push('Words above this student\'s statistical outlier fence');
      oTip.push('(IQR method: Q3 + 1.5*IQR = ' + pros.wordOutliers.baseline.upperFence + 'ms/phoneme).');
      oTip.push('Student baseline: median ' + pros.wordOutliers.baseline.medianDurationPerPhoneme + 'ms/ph, Q1=' + pros.wordOutliers.baseline.Q1 + ', Q3=' + pros.wordOutliers.baseline.Q3);
      for (const o of pros.wordOutliers.outliers.slice(0, 5)) {
        oTip.push(o.word + ' (' + (o.phonemes || o.syllables) + ' ph): ' + o.normalizedDurationMs + 'ms/ph — ' + o.aboveFenceBy + 'ms above fence');
      }
      if (pros.wordOutliers.outlierCount > 5) oTip.push('... and ' + (pros.wordOutliers.outlierCount - 5) + ' more');
      oTip.push('Timestamps: cross-validator (' + pros.wordOutliers.baseline.totalWordsAnalyzed + ' words analyzed, ' + pros.wordOutliers.baseline.wordsSkippedNoTimestamps + ' skipped)');
      outBox.title = oTip.join('\n');
    } else {
      outBox.innerHTML = '<span class="metric-value">N/A</span><span class="metric-label">Duration Outliers</span>';
      outBox.title = pros.wordOutliers.reason || 'Insufficient data';
    }
    metricsRow.appendChild(outBox);

    // Box 4: Pace Consistency
    const paceBox = document.createElement('div');
    paceBox.className = 'metric-box';
    if (!pros.paceConsistency.insufficient) {
      const paceLabel = pros.paceConsistency.classification.replace(/-/g, ' ');
      paceBox.innerHTML = '<span class="metric-value">' + paceLabel.charAt(0).toUpperCase() + paceLabel.slice(1) +
        '</span><span class="metric-label">Pace</span>';
      const pcTip = [];
      pcTip.push('How consistently the student reads across the passage.');
      pcTip.push('CV = ' + pros.paceConsistency.cv + ' (' + pros.paceConsistency.label + ')');
      pcTip.push('Mean local rate: ' + pros.paceConsistency.meanLocalRate + ' WPM across ' + pros.paceConsistency.phraseCount + ' phrases');
      if (pros.paceConsistency.localRates && pros.paceConsistency.localRates.length > 0) {
        const rates = pros.paceConsistency.localRates;
        const fastest = rates.reduce((a, b) => a.wordsPerMinute > b.wordsPerMinute ? a : b);
        const slowest = rates.reduce((a, b) => a.wordsPerMinute < b.wordsPerMinute ? a : b);
        pcTip.push('Fastest phrase: ' + fastest.wordsPerMinute + ' WPM (phrase ' + (fastest.phraseIndex + 1) + ', ' + fastest.wordCount + ' words)');
        pcTip.push('Slowest phrase: ' + slowest.wordsPerMinute + ' WPM (phrase ' + (slowest.phraseIndex + 1) + ', ' + slowest.wordCount + ' words)');
      }
      pcTip.push('Note: Pace is measured within phrases, not word-by-word.');
      paceBox.title = pcTip.join('\n');
    } else {
      paceBox.innerHTML = '<span class="metric-value">N/A</span><span class="metric-label">Pace</span>';
      paceBox.title = pros.paceConsistency.reason || 'Insufficient data';
    }
    metricsRow.appendChild(paceBox);

    body.appendChild(metricsRow);

    // ── Word Speed Map (inline within prosody) ──
    if (diagnostics.wordSpeed && !diagnostics.wordSpeed.insufficient) {
      renderWordSpeedInto(body, diagnostics.wordSpeed, wordAudioEl, transcriptWords, referenceText);
    }

    // Scope transparency note
    const scopeNote = document.createElement('div');
    scopeNote.className = 'prosody-scope-note';
    scopeNote.textContent = 'Measures phrasing, timing, and pace from word timestamps. Does not measure expression, intonation, or stress (requires audio pitch analysis).';
    body.appendChild(scopeNote);

    section.appendChild(body);
    if (prosodyContainer) {
      prosodyContainer.appendChild(section);
      prosodyContainer.style.display = '';
    }
  }

  // Build mapping from raw transcriptWords index → alignment render hypIndex.
  // Diagnostics (onset delays, long pauses) return indices into the full
  // transcriptWords array (which includes disfluency fillers like "uh").
  // But alignWords() calls filterDisfluencies() before diffing, so the
  // alignment's internal word positions are offset from transcriptWords.
  // We bridge the gap by first identifying which transcriptWords entries
  // survived filtering, then walking alignment to pair them up.
  const DISFLUENCY_WORDS = new Set(['um', 'uh', 'uh-huh', 'mm', 'hmm', 'er', 'ah']); // must match text-normalize.js
  const sttToHypIndex = new Map();

  // Step 1: Collect raw indices of non-disfluent words (matches filterDisfluencies output)
  const nonDisfluencyIndices = [];
  if (transcriptWords) {
    for (let i = 0; i < transcriptWords.length; i++) {
      const wordNorm = (transcriptWords[i].word || '').toLowerCase().replace(/^[^\w'-]+|[^\w'-]+$/g, '');
      if (!DISFLUENCY_WORDS.has(wordNorm)) {
        nonDisfluencyIndices.push(i);
      }
    }
  }

  // Step 2: Walk alignment consuming filtered indices for non-omission entries
  let filteredIdx = 0;   // index into nonDisfluencyIndices
  let renderHypIdx = 0;
  for (const item of alignment) {
    if (item.type === 'omission') {
      // Ref word with no STT word — don't consume any index
      continue;
    }
    if (item.type === 'insertion') {
      // STT word not in reference — consume filtered index, no render position
      filteredIdx++;
      continue;
    }
    // correct, substitution, struggle, self-correction — map raw STT index to render position
    if (filteredIdx < nonDisfluencyIndices.length) {
      const rawSttIdx = nonDisfluencyIndices[filteredIdx];
      sttToHypIndex.set(rawSttIdx, renderHypIdx);
      // Compound words consume multiple STT words
      const partsCount = item.compound && item.parts ? item.parts.length : 1;
      filteredIdx += partsCount;
    }
    renderHypIdx++;
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
  let refIndex = 0;
  let lastRefWord = null;  // Track previous reference word for insertion context
  for (const item of alignment) {
    if (item.type === 'insertion') {
      item._prevRef = lastRefWord;  // Which ref word this insertion appeared after
      insertions.push(item);
      continue;
    }
    const span = document.createElement('span');
    // Forgiven words (proper nouns) render as correct — they don't count as errors
    const displayType = item.forgiven ? 'correct' : item.type;
    span.className = 'word word-main word-' + displayType;
    span.textContent = item._displayRef || item.ref || '';

    // Look up STT word metadata for tooltip
    const hypKey = item.hyp;
    let sttWord = null;
    let sttInfo = '';
    if (hypKey && sttLookup) {
      const queue = sttLookup.get(hypKey);
      if (queue && queue.length > 0) {
        sttWord = queue.shift();
      } else {
        console.warn(`[sttLookup MISS] ref="${item.ref}" hyp="${hypKey}" type=${item.type} — key ${queue ? 'exhausted (queue empty)' : 'not found in map'}`);
      }
    }

    // Store timestamps for highlight overlay targeting
    if (sttWord) {
      span.dataset.startTime = parseSttTime(sttWord.startTime).toFixed(3);
      span.dataset.endTime = parseSttTime(sttWord.endTime).toFixed(3);
    }

    // NL tier class and tooltip info
    if (item.nl) {
      span.classList.add('word-tier-' + item.nl.tier);
      sttInfo += '\n' + buildNLTooltip(item.nl);
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
    span.dataset.tooltip = buildEnhancedTooltip(item, sttWord);

    // Click-to-play word audio (Deepgram/Parakeet timestamps)
    if (wordAudioEl && sttWord) {
      span.classList.add('word-clickable');
      const start = parseSttTime(sttWord.startTime);
      const end = parseSttTime(sttWord.endTime);
      const playFn = () => {
        wordAudioEl.pause();
        wordAudioEl.currentTime = start;
        const onTime = () => {
          if (wordAudioEl.currentTime >= end) {
            wordAudioEl.pause();
            wordAudioEl.removeEventListener('timeupdate', onTime);
          }
        };
        wordAudioEl.addEventListener('timeupdate', onTime);
        wordAudioEl.play().catch(() => {});
      };
      span.addEventListener('click', (e) => { e.stopPropagation(); showWordTooltip(span, playFn); });
    } else {
      span.addEventListener('click', (e) => { e.stopPropagation(); showWordTooltip(span, null); });
    }

    // Additional context for specific types
    if (item.type === 'substitution' || item.type === 'struggle') {
      // Proper noun forgiveness indicator (phonetic proximity check passed)
      // Check this FIRST - forgiven words should NOT be marked as morphological errors
      if (item.forgiven) {
        span.classList.add('word-forgiven');
        const ratioText = item.phoneticRatio ? ' (' + item.phoneticRatio + '% similar)' : '';
        const combinedText = item.combinedPronunciation ? '\nStudent said: "' + item.combinedPronunciation + '"' : '';
        span.dataset.tooltip += '\n✓ Forgiven: proper name' + ratioText + combinedText + ' — vocabulary gap, not decoding error';
      } else {
        // Morphological error overlay (only for non-forgiven substitutions)
        const morphKey = (item.ref || '').toLowerCase() + '|' + (item.hyp || '').toLowerCase();
        const morphData = morphErrorMap.get(morphKey);
        if (morphData) {
          span.classList.add('word-morphological');
          span.dataset.tooltip += `\n(Morphological: shared ${morphData.matchType} "${morphData.sharedPart}")`;
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
      span.dataset.tooltip += hesitationNote;
    }

    // Kitchen Sink disfluency dot marker (Phase 24)
    // sttWord has isDisfluency and _divergence from kitchen-sink-merger.js
    if (sttWord?.isDisfluency) {
      span.classList.add('word-disfluency');
      if (sttWord._divergence) {
        const target = sttWord._divergence.cleanTarget || '?';
        span.dataset.tooltip += `\nStruggle with "${target}" — not an error`;
      } else {
        span.dataset.tooltip += '\nDisfluency — not an error';
      }
    }

    // Compound word indicator (e.g. "every"+"one" → "everyone")
    // Shows when STT split a word at a morpheme boundary and compound merger healed it
    if (item.compound && item.parts) {
      span.dataset.tooltip += '\nCompound: student said "' + item.parts.join('" + "') + '"';
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
        pauseSpan.dataset.tooltip = pauseTooltip;
        pauseSpan.textContent = '[' + pause.gap + 's]';
        pauseSpan.style.cursor = 'pointer';
        pauseSpan.addEventListener('click', (e) => { e.stopPropagation(); showWordTooltip(pauseSpan, null); });
        wordsDiv.appendChild(pauseSpan);
        wordsDiv.appendChild(document.createTextNode(' '));
        console.log('[UI Debug] ✓ Inserted pause indicator:', pause.gap, 's before', item.ref);
      }
    }

    // Cosmetic punctuation (not scored) — append inside span so it shares word styling
    const punct = punctSuffixMap.get(refIndex);
    if (punct) {
      span.textContent += punct;
    }

    // Recovery warning badge (!) — weak-evidence words (Parakeet-only recovery or Reverb CTC failure)
    // Skip badge for last-ref-word recoveries: CTC final-word truncation is a known limitation,
    // not weak evidence. Parakeet (transducer) is structurally better at utterance boundaries.
    const isReverbGarbage = sttWord && isSpecialASTToken(sttWord.word) && sttWord._xvalWord;
    const isLastWordRecovery = item._isLastRefWord && item._recovered;
    if (!isLastWordRecovery && (item._recovered || sttWord?._recovered || isReverbGarbage)) {
      span.classList.add('word-recovered-badge');
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

    // Advance indices
    if (item.type !== 'omission') {
      hypIndex++;
    }
    lastRefWord = item._displayRef || item.ref;
    refIndex++;
  }

  // Insertions section (excluding forgiven proper noun parts AND disfluent words)
  // Disfluent words are expected speech patterns, not unexpected insertions
  const regularInsertions = insertions.filter(ins => {
    if (ins.partOfForgiven) return false;
    if (ins._isSelfCorrection) return false;
    if (ins._partOfStruggle) return false;
    // Check if the corresponding STT word is a disfluency or CTC artifact
    if (ins.hyp && sttLookup) {
      const queue = sttLookup.get(ins.hyp);
      // Peek at first item without consuming it
      if (queue && queue.length > 0) {
        if (queue[0]?.isDisfluency) return false;
        if (queue[0]?._ctcArtifact) return false;
      }
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

      // Look up STT metadata for this insertion
      let meta = null;
      if (ins.hyp && sttLookup) {
        const queue = sttLookup.get(ins.hyp);
        if (queue && queue.length > 0) {
          meta = queue.shift();
        }
      }

      // Store timestamps for highlight overlay targeting
      if (meta) {
        span.dataset.startTime = parseSttTime(meta.startTime).toFixed(3);
        span.dataset.endTime = parseSttTime(meta.endTime).toFixed(3);
      }

      // Special ASR token (e.g., <unknown> from Reverb CTC decoder)
      if (meta && isSpecialASTToken(meta.word)) {
        span.textContent = '?';
        const start = parseFloat(meta.startTime?.replace('s', '')) || 0;
        const end = parseFloat(meta.endTime?.replace('s', '')) || 0;
        const durationMs = Math.round((end - start) * 1000);
        const tipLines = [
          '? — speech detected but not recognized as a word',
          `${start.toFixed(2)}s – ${end.toFixed(2)}s (${durationMs}ms)`
        ];
        if (meta._xvalWord) {
          const xvalLabel = meta._xvalEngine ? meta._xvalEngine.charAt(0).toUpperCase() + meta._xvalEngine.slice(1) : 'Cross-validator';
          tipLines.push(`${xvalLabel} heard: "${meta._xvalWord}"`);
        } else if (rawSttSources?.xvalRaw?.length > 0) {
          // Fallback: find closest xval word by timestamp overlap
          let bestOverlap = 0, bestWord = null;
          for (const xw of rawSttSources.xvalRaw) {
            const xwStart = parseFloat((xw.startTime || xw.start || '').toString().replace('s', '')) || 0;
            const xwEnd = parseFloat((xw.endTime || xw.end || '').toString().replace('s', '')) || 0;
            const overlapStart = Math.max(start, xwStart);
            const overlapEnd = Math.min(end, xwEnd);
            const overlap = overlapEnd - overlapStart;
            if (overlap > bestOverlap) {
              bestOverlap = overlap;
              bestWord = xw.word;
            }
          }
          if (bestWord) {
            tipLines.push(`Cross-validator heard nearby: "${bestWord}"`);
          }
        }
        if (ins._prevRef) {
          tipLines.push(`Located after: "${ins._prevRef}"`);
        }
        span.dataset.tooltip = tipLines.join('\n');
      } else {
        span.textContent = ins.hyp;
        if (meta) {
          const start = parseFloat(meta.startTime?.replace('s', '')) || 0;
          const end = parseFloat(meta.endTime?.replace('s', '')) || 0;
          const durationMs = Math.round((end - start) * 1000);
          const tipLines = [
            `Inserted word: "${ins.hyp}"`,
            `${start.toFixed(2)}s – ${end.toFixed(2)}s (${durationMs}ms)`,
            `Cross-validation: ${meta.crossValidation || 'N/A'}`
          ];
          if (ins._prevRef) {
            tipLines.push(`Located after: "${ins._prevRef}"`);
          }
          span.dataset.tooltip = tipLines.join('\n');
        }
      }

      // Click-to-play audio + highlight overlay for insertion words
      if (wordAudioEl && meta) {
        const start = parseSttTime(meta.startTime);
        const end = parseSttTime(meta.endTime);
        if (start > 0 || end > 0) {
          span.classList.add('word-clickable');
          const playFn = () => {
            wordAudioEl.pause();
            wordAudioEl.currentTime = start;
            const onTime = () => {
              if (wordAudioEl.currentTime >= end) {
                wordAudioEl.pause();
                wordAudioEl.removeEventListener('timeupdate', onTime);
              }
            };
            wordAudioEl.addEventListener('timeupdate', onTime);
            wordAudioEl.play().catch(() => {});
          };
          span.addEventListener('click', (e) => {
            e.stopPropagation();
            showWordTooltip(span, playFn);
            applyHighlightOverlay(span, 'word-highlight-insertion');
          });
        } else {
          span.addEventListener('click', (e) => {
            e.stopPropagation();
            showWordTooltip(span, null);
            applyHighlightOverlay(span, 'word-highlight-insertion');
          });
        }
      } else {
        span.addEventListener('click', (e) => {
          e.stopPropagation();
          showWordTooltip(span, null);
          applyHighlightOverlay(span, 'word-highlight-insertion');
        });
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

      // Map startIndex through transcriptWords to get timestamps
      const scWord = transcriptWords?.[sc.startIndex];
      if (scWord) {
        span.dataset.startTime = parseSttTime(scWord.startTime).toFixed(3);
        span.dataset.endTime = parseSttTime(scWord.endTime).toFixed(3);
      }

      const scStart = scWord ? parseSttTime(scWord.startTime) : 0;
      const scEnd = scWord ? parseSttTime(scWord.endTime) : 0;
      const tipLines = [
        `Self-correction: "${sc.words}" (${sc.type})`,
        scStart > 0 ? `${scStart.toFixed(2)}s – ${scEnd.toFixed(2)}s (${Math.round((scEnd - scStart) * 1000)}ms)` : `Position ${sc.startIndex}`,
        repeats > 1 ? `Repeated ${repeats}x` : 'Repeated once'
      ];
      span.dataset.tooltip = tipLines.join('\n');

      // Click handler: tooltip + highlight overlay
      if (wordAudioEl && scWord && (scStart > 0 || scEnd > 0)) {
        span.classList.add('word-clickable');
        const playFn = () => {
          wordAudioEl.pause();
          wordAudioEl.currentTime = scStart;
          const onTime = () => {
            if (wordAudioEl.currentTime >= scEnd) {
              wordAudioEl.pause();
              wordAudioEl.removeEventListener('timeupdate', onTime);
            }
          };
          wordAudioEl.addEventListener('timeupdate', onTime);
          wordAudioEl.play().catch(() => {});
        };
        span.addEventListener('click', (e) => {
          e.stopPropagation();
          showWordTooltip(span, playFn);
          applyHighlightOverlay(span, 'word-highlight-self-correction');
        });
      } else {
        span.addEventListener('click', (e) => {
          e.stopPropagation();
          showWordTooltip(span, null);
          applyHighlightOverlay(span, 'word-highlight-self-correction');
        });
      }

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

      // Look up STT metadata (entries never consumed by regularInsertions — filtered at line 1128)
      let scMeta = null;
      if (sc.hyp && sttLookup) {
        const queue = sttLookup.get(sc.hyp);
        if (queue && queue.length > 0) {
          scMeta = queue.shift();
        }
      }
      if (scMeta) {
        span.dataset.startTime = parseSttTime(scMeta.startTime).toFixed(3);
        span.dataset.endTime = parseSttTime(scMeta.endTime).toFixed(3);
      }

      const nmStart = scMeta ? parseSttTime(scMeta.startTime) : 0;
      const nmEnd = scMeta ? parseSttTime(scMeta.endTime) : 0;
      const tipLines = [
        `Near-miss self-correction: "${sc.hyp}" \u2192 "${sc._nearMissTarget}"`,
        nmStart > 0 ? `${nmStart.toFixed(2)}s – ${nmEnd.toFixed(2)}s (${Math.round((nmEnd - nmStart) * 1000)}ms)` : null,
        `Student said "${sc.hyp}", then correctly said "${sc._nearMissTarget}"`
      ].filter(Boolean);
      span.dataset.tooltip = tipLines.join('\n');

      // Click handler: tooltip + play + highlight
      if (wordAudioEl && scMeta && (nmStart > 0 || nmEnd > 0)) {
        span.classList.add('word-clickable');
        const playFn = () => {
          wordAudioEl.pause();
          wordAudioEl.currentTime = nmStart;
          const onTime = () => {
            if (wordAudioEl.currentTime >= nmEnd) {
              wordAudioEl.pause();
              wordAudioEl.removeEventListener('timeupdate', onTime);
            }
          };
          wordAudioEl.addEventListener('timeupdate', onTime);
          wordAudioEl.play().catch(() => {});
        };
        span.addEventListener('click', (e) => {
          e.stopPropagation();
          showWordTooltip(span, playFn);
          applyHighlightOverlay(span, 'word-highlight-self-correction');
        });
      } else {
        span.addEventListener('click', (e) => {
          e.stopPropagation();
          showWordTooltip(span, null);
          applyHighlightOverlay(span, 'word-highlight-self-correction');
        });
      }

      nmscSection.appendChild(span);
      nmscSection.appendChild(document.createTextNode(' '));
    }
    wordsDiv.appendChild(nmscSection);
  }


  // ─────────────────────────────────────────────────────────────────────────
  // STT Transcript View — Pipeline Trace (step-by-step processing)
  // ─────────────────────────────────────────────────────────────────────────
  const confWordsDiv = document.getElementById('sttTranscriptWords');
  if (confWordsDiv) {
    confWordsDiv.innerHTML = '';

    const pAlignment = rawSttSources?.parakeetAlignment || [];
    const reverbVerbatim = rawSttSources?.reverbVerbatim || [];
    const reverbClean = rawSttSources?.reverbClean || [];
    const xvalRaw = rawSttSources?.xvalRaw || [];
    const reverbRef = alignment.filter(e => e.type !== 'insertion');
    const parakeetRef = pAlignment.filter(e => e.type !== 'insertion');
    const reverbIns = alignment.filter(e => e.type === 'insertion');
    const parakeetIns = pAlignment.filter(e => e.type === 'insertion');

    // Helper: create a pipeline step container
    const makeStep = (num, title, description) => {
      const step = document.createElement('div');
      step.className = 'pipeline-step';
      const header = document.createElement('div');
      header.className = 'pipeline-step-header';
      const numSpan = document.createElement('span');
      numSpan.className = 'pipeline-step-num';
      numSpan.textContent = num;
      header.appendChild(numSpan);
      header.appendChild(document.createTextNode(' '));
      const b = document.createElement('strong');
      b.textContent = title;
      header.appendChild(b);
      if (description) {
        const desc = document.createElement('span');
        desc.className = 'pipeline-step-desc';
        desc.textContent = ' \u2014 ' + description;
        header.appendChild(desc);
      }
      step.appendChild(header);
      const body = document.createElement('div');
      body.className = 'pipeline-step-body';
      step.appendChild(body);
      return { step, body };
    };

    // Helper: create a word span with optional click-to-play
    const makeWordSpan = (text, cls, tooltip, sttWordsArr, hypIdx) => {
      const span = document.createElement('span');
      span.className = 'pipeline-word' + (cls ? ' ' + cls : '');
      span.textContent = text;
      if (tooltip) span.dataset.tooltip = tooltip;
      if (wordAudioEl && sttWordsArr && hypIdx != null && hypIdx >= 0) {
        const w = sttWordsArr[hypIdx];
        if (w) {
          const start = parseSttTime(w.startTime);
          const end = parseSttTime(w.endTime);
          if (start > 0) {
            span.classList.add('word-clickable');
            const playFn = () => {
              wordAudioEl.pause();
              wordAudioEl.currentTime = start;
              const onTime = () => {
                if (wordAudioEl.currentTime >= end) {
                  wordAudioEl.pause();
                  wordAudioEl.removeEventListener('timeupdate', onTime);
                }
              };
              wordAudioEl.addEventListener('timeupdate', onTime);
              wordAudioEl.play().catch(() => {});
            };
            span.addEventListener('click', (e) => { e.stopPropagation(); showWordTooltip(span, playFn); });
            return span;
          }
        }
      }
      if (tooltip) {
        span.addEventListener('click', (e) => { e.stopPropagation(); showWordTooltip(span, null); });
      }
      return span;
    };

    // ── STEP 1: Reverb V0 ↔ V1 ↔ V2 Comparison ──
    {
      const { step, body } = makeStep(1, 'Reverb V0 \u2194 V1 \u2194 V2',
        'how clean and verbatim transcripts align, and the combined result');

      // Group transcriptWords into aligned blocks
      // Three block kinds:
      //   'anchor' — all versions agree
      //   'v2div'  — V0/V1 divergence (V2 collapsed from V1 fragments using V0 target)
      //   'v3div'  — V2/Ref divergence (V3 collapsed from V2 fragments using ref target)
      const blocks = [];
      if (transcriptWords && transcriptWords.length > 0) {
        let currentBlock = null;
        for (const w of transcriptWords) {
          const isDivWord = (w.isDisfluency && w._divergence) || w._v2Merged;
          const divId = w._divergence?.id;
          if (isDivWord && divId != null) {
            if (!currentBlock || currentBlock.id !== divId) {
              if (currentBlock) blocks.push(currentBlock);
              currentBlock = {
                kind: 'v2div',
                id: divId,
                cleanTarget: w._divergence.cleanTarget,
                cleanWords: w._divergence.cleanWords || [],
                verbatimWords: w._divergence.verbatimWords || [],
                words: [w]
              };
            } else {
              currentBlock.words.push(w);
            }
          } else if (w._v3Merged && w._v3OriginalFragments) {
            // V3 block — V2/Reference divergence
            if (currentBlock) { blocks.push(currentBlock); currentBlock = null; }
            blocks.push({
              kind: 'v3div',
              words: [w],
              refTarget: w._v3RefTarget || w.word,
              v2Fragments: w._v3OriginalFragments.map(f => f.word)
            });
          } else {
            if (currentBlock) { blocks.push(currentBlock); currentBlock = null; }
            blocks.push({ kind: 'anchor', words: [w] });
          }
        }
        if (currentBlock) blocks.push(currentBlock);
      }

      if (blocks.length === 0 && reverbVerbatim.length === 0) {
        const msg = document.createElement('div');
        msg.className = 'pipeline-step-summary';
        msg.textContent = 'No Reverb data available';
        body.appendChild(msg);
      } else {
        // Build four-row comparison: Reference, V0 clean, V1 verbatim, Result
        const table = document.createElement('div');
        table.className = 'pipeline-v012-table';

        const labels = ['Reference', 'V0 clean', 'V1 verbatim', 'Result'];
        const labelClasses = ['pipeline-v012-lbl-ref', 'pipeline-v012-lbl-v0', 'pipeline-v012-lbl-v1', 'pipeline-v012-lbl-v2'];

        const rows = labels.map((lbl, ri) => {
          const row = document.createElement('div');
          row.className = 'pipeline-v012-row';
          const labelEl = document.createElement('span');
          labelEl.className = 'pipeline-v012-label ' + labelClasses[ri];
          labelEl.textContent = lbl;
          row.appendChild(labelEl);
          return row;
        });

        let v2DivCount = 0, v3DivCount = 0;
        for (const b of blocks) {
          if (b.kind === 'anchor') {
            const word = b.words[0].word;
            for (let ri = 0; ri < 4; ri++) {
              const cell = document.createElement('span');
              cell.className = 'pipeline-v012-cell pipeline-v012-anchor';
              cell.textContent = word;
              rows[ri].appendChild(cell);
            }
          } else if (b.kind === 'v2div') {
            // V0/V1 divergence — V0 and V1 differ, but V0 matches reference
            v2DivCount++;
            const v0Text = b.cleanTarget || '?';
            const firstW = b.words[0];
            let v1Fragments;
            if (firstW._v2Merged && firstW._v2OriginalFragments) {
              v1Fragments = firstW._v2OriginalFragments.map(f => f.word);
            } else {
              v1Fragments = b.verbatimWords.length > 0 ? b.verbatimWords : b.words.map(w => w.word);
            }
            const resultWord = b.words.map(w => w.word).join(' ');

            const tip = 'V0/V1 Divergence #' + b.id
              + '\nV0 clean: "' + v0Text + '"'
              + '\nV1 verbatim: ' + v1Fragments.map(f => '"' + f + '"').join(' ')
              + '\nResult: "' + resultWord + '"'
              + '\nV0 recovered the word; V1 shows the struggle';

            // Reference row — same as V0 (clean matched reference)
            const cellRef = document.createElement('span');
            cellRef.className = 'pipeline-v012-cell pipeline-v012-div pipeline-v012-div-ref';
            cellRef.textContent = v0Text;
            cellRef.dataset.tooltip = tip;
            cellRef.addEventListener('click', (e) => { e.stopPropagation(); showWordTooltip(cellRef, null); });
            rows[0].appendChild(cellRef);

            // V0 cell — correct (green)
            const cellV0 = document.createElement('span');
            cellV0.className = 'pipeline-v012-cell pipeline-v012-div pipeline-v012-div-v0';
            cellV0.textContent = v0Text;
            cellV0.dataset.tooltip = tip;
            cellV0.addEventListener('click', (e) => { e.stopPropagation(); showWordTooltip(cellV0, null); });
            rows[1].appendChild(cellV0);

            // V1 cell — fragments (red)
            const cellV1 = document.createElement('span');
            cellV1.className = 'pipeline-v012-cell pipeline-v012-div pipeline-v012-div-v1';
            cellV1.dataset.tooltip = tip;
            cellV1.addEventListener('click', (e) => { e.stopPropagation(); showWordTooltip(cellV1, null); });
            for (let fi = 0; fi < v1Fragments.length; fi++) {
              if (fi > 0) {
                const sep = document.createElement('span');
                sep.className = 'pipeline-v012-frag-sep';
                sep.textContent = '\u00b7';
                cellV1.appendChild(sep);
              }
              const frag = document.createElement('span');
              frag.className = 'pipeline-v012-frag';
              frag.textContent = v1Fragments[fi];
              cellV1.appendChild(frag);
            }
            rows[2].appendChild(cellV1);

            // Result cell — collapsed (purple)
            const cellRes = document.createElement('span');
            cellRes.className = 'pipeline-v012-cell pipeline-v012-div pipeline-v012-div-v2';
            cellRes.textContent = resultWord;
            cellRes.dataset.tooltip = tip;
            cellRes.addEventListener('click', (e) => { e.stopPropagation(); showWordTooltip(cellRes, null); });
            rows[3].appendChild(cellRes);

          } else if (b.kind === 'v3div') {
            // V2/Reference divergence — V0 and V1 agree but don't match reference
            v3DivCount++;
            const refTarget = b.refTarget;
            const v2Frags = b.v2Fragments;
            const resultWord = b.words.map(w => w.word).join(' ');

            const tip = 'V2/Reference Divergence'
              + '\nReference: "' + refTarget + '"'
              + '\nV0 & V1 heard: ' + v2Frags.map(f => '"' + f + '"').join(' ')
              + '\nResult: "' + resultWord + '"'
              + '\nBoth Reverb passes agree on fragments; student split the word';

            // Reference row — the target word
            const cellRef = document.createElement('span');
            cellRef.className = 'pipeline-v012-cell pipeline-v012-div pipeline-v012-div-ref';
            cellRef.textContent = refTarget;
            cellRef.dataset.tooltip = tip;
            cellRef.addEventListener('click', (e) => { e.stopPropagation(); showWordTooltip(cellRef, null); });
            rows[0].appendChild(cellRef);

            // V0 cell — shows fragments (both V0 and V1 agree)
            const cellV0 = document.createElement('span');
            cellV0.className = 'pipeline-v012-cell pipeline-v012-div pipeline-v012-div-v3';
            cellV0.dataset.tooltip = tip;
            cellV0.addEventListener('click', (e) => { e.stopPropagation(); showWordTooltip(cellV0, null); });
            for (let fi = 0; fi < v2Frags.length; fi++) {
              if (fi > 0) {
                const sep = document.createElement('span');
                sep.className = 'pipeline-v012-frag-sep';
                sep.textContent = '\u00b7';
                cellV0.appendChild(sep);
              }
              const frag = document.createElement('span');
              frag.className = 'pipeline-v012-frag';
              frag.textContent = v2Frags[fi];
              cellV0.appendChild(frag);
            }
            rows[1].appendChild(cellV0);

            // V1 cell — same fragments
            const cellV1 = cellV0.cloneNode(true);
            cellV1.dataset.tooltip = tip;
            cellV1.addEventListener('click', (e) => { e.stopPropagation(); showWordTooltip(cellV1, null); });
            rows[2].appendChild(cellV1);

            // Result cell — collapsed to reference
            const cellRes = document.createElement('span');
            cellRes.className = 'pipeline-v012-cell pipeline-v012-div pipeline-v012-div-v2';
            cellRes.textContent = resultWord;
            cellRes.dataset.tooltip = tip;
            cellRes.addEventListener('click', (e) => { e.stopPropagation(); showWordTooltip(cellRes, null); });
            rows[3].appendChild(cellRes);
          }
        }

        for (const row of rows) table.appendChild(row);
        body.appendChild(table);

        const anchors = blocks.filter(b => b.kind === 'anchor').length;
        const parts = [anchors + ' anchors'];
        if (v2DivCount > 0) parts.push(v2DivCount + ' V0\u2260V1 (Reverb divergence)');
        if (v3DivCount > 0) parts.push(v3DivCount + ' V2\u2260Ref (reference divergence)');
        const summary = document.createElement('div');
        summary.className = 'pipeline-step-summary';
        summary.textContent = parts.join(', ');
        body.appendChild(summary);
      }

      confWordsDiv.appendChild(step);
    }

    // ── STEP 2: Reference Alignment ──
    {
      const { step, body } = makeStep(2, 'Reference Alignment',
        'NW alignment of each engine\'s transcript to the reference passage');

      // Helper: build a 3-column alignment table (engine vs reference)
      const buildAlignTable = (label, entries, ins, engineKey) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'pipeline-engine-section';

        const heading = document.createElement('div');
        heading.className = 'pipeline-engine-heading';
        heading.textContent = label;
        wrapper.appendChild(heading);

        const table = document.createElement('table');
        table.className = 'pipeline-table';

        const thead = document.createElement('thead');
        const hrow = document.createElement('tr');
        for (const h of ['#', 'Reference', label + ' heard', 'Type']) {
          const th = document.createElement('th');
          th.textContent = h;
          hrow.appendChild(th);
        }
        thead.appendChild(hrow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i];
          const tr = document.createElement('tr');

          const tdIdx = document.createElement('td');
          tdIdx.className = 'pipeline-td-idx';
          tdIdx.textContent = i + 1;
          tr.appendChild(tdIdx);

          const tdRef = document.createElement('td');
          tdRef.className = 'pipeline-td-ref';
          tdRef.textContent = e.ref || '?';
          tr.appendChild(tdRef);

          const tdHyp = document.createElement('td');
          if (e.type === 'omission') {
            tdHyp.textContent = '\u2014';
            tdHyp.className = 'pipeline-td-omission';
          } else if (e.type === 'correct') {
            tdHyp.textContent = e.hyp;
            tdHyp.className = 'pipeline-td-correct';
          } else {
            tdHyp.textContent = e.hyp || '?';
            tdHyp.className = 'pipeline-td-sub';
          }
          // Show original fragments when V2/V3 collapsing was used (Reverb only)
          if (engineKey === 'reverb' && e.hypIndex != null && e.hypIndex >= 0) {
            const tw = transcriptWords[e.hypIndex];
            if (tw) {
              const frags = tw._v2Merged ? tw._v2OriginalFragments
                          : tw._v3Merged ? tw._v3OriginalFragments
                          : null;
              if (frags) {
                const fragText = frags.map(f => f.word).join(' ');
                if (fragText !== e.hyp) {
                  const fragSpan = document.createElement('div');
                  fragSpan.className = 'pipeline-v2-fragments';
                  fragSpan.textContent = '\u2190 ' + fragText;
                  tdHyp.appendChild(fragSpan);
                }
              }
            }
          }
          tr.appendChild(tdHyp);

          const tdType = document.createElement('td');
          tdType.className = 'pipeline-td-type pipeline-td-type-' + e.type;
          tdType.textContent = e.type;
          tr.appendChild(tdType);

          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        wrapper.appendChild(table);

        // Insertions
        if (ins.length > 0) {
          const insDiv = document.createElement('div');
          insDiv.className = 'pipeline-insertions';
          const insLabel = document.createElement('strong');
          insLabel.textContent = 'Insertions (' + ins.length + '): ';
          insDiv.appendChild(insLabel);
          insDiv.appendChild(document.createTextNode(ins.map(e => e.hyp).join(', ')));
          wrapper.appendChild(insDiv);
        }

        return wrapper;
      };

      if (reverbRef.length > 0) {
        // Reverb V2 vs Reference (primary — shown first)
        body.appendChild(buildAlignTable('Reverb', reverbRef, reverbIns, 'reverb'));

        // Parakeet vs Reference (secondary — shown below)
        if (parakeetRef.length > 0 && parakeetRef.length === reverbRef.length) {
          body.appendChild(buildAlignTable('Parakeet', parakeetRef, parakeetIns, 'parakeet'));
        } else if (parakeetRef.length > 0) {
          const msg = document.createElement('div');
          msg.className = 'pipeline-step-summary';
          msg.textContent = 'Length mismatch: Reverb ' + reverbRef.length + ' vs Parakeet ' + parakeetRef.length;
          body.appendChild(msg);
        } else {
          const msg = document.createElement('div');
          msg.className = 'pipeline-step-summary';
          msg.textContent = 'No Parakeet alignment data available';
          body.appendChild(msg);
        }
      } else {
        const msg = document.createElement('div');
        msg.className = 'pipeline-step-summary';
        msg.textContent = 'No alignment data available';
        body.appendChild(msg);
      }

      confWordsDiv.appendChild(step);
    }

    // ── STEP 3: Cross-Validation Verdicts ──
    {
      const { step, body } = makeStep(3, 'Cross-Validation Verdicts',
        'per-reference-word comparison of Reverb vs Parakeet (decision matrix)');

      if (parakeetRef.length > 0 && parakeetRef.length === reverbRef.length) {
        const table = document.createElement('table');
        table.className = 'pipeline-table';

        const thead = document.createElement('thead');
        const hrow = document.createElement('tr');
        for (const h of ['#', 'Reference', 'Reverb', 'Parakeet', 'Verdict', 'Reason']) {
          const th = document.createElement('th');
          th.textContent = h;
          hrow.appendChild(th);
        }
        thead.appendChild(hrow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        let confirmedN = 0, disagreedN = 0, recoveredN = 0, unconfirmedN = 0;
        for (let i = 0; i < reverbRef.length; i++) {
          const r = reverbRef[i];
          const p = parakeetRef[i];
          const xval = r.crossValidation || 'pending';

          if (xval === 'confirmed') confirmedN++;
          else if (xval === 'disagreed') disagreedN++;
          else if (xval === 'recovered') recoveredN++;
          else if (xval === 'unconfirmed') unconfirmedN++;

          const tr = document.createElement('tr');
          tr.className = 'pipeline-xval-' + xval;

          const tdIdx = document.createElement('td');
          tdIdx.className = 'pipeline-td-idx';
          tdIdx.textContent = i + 1;
          tr.appendChild(tdIdx);

          const tdRef = document.createElement('td');
          tdRef.className = 'pipeline-td-ref';
          tdRef.textContent = r.ref || '?';
          tr.appendChild(tdRef);

          const tdR = document.createElement('td');
          tdR.className = 'pipeline-td-type-' + r.type;
          tdR.textContent = r.type === 'omission' ? '\u2014 omitted' : '"' + r.hyp + '" (' + r.type + ')';
          tr.appendChild(tdR);

          const tdP = document.createElement('td');
          tdP.className = 'pipeline-td-type-' + p.type;
          tdP.textContent = p.type === 'omission' ? '\u2014 omitted' : '"' + p.hyp + '" (' + p.type + ')';
          tr.appendChild(tdP);

          const tdV = document.createElement('td');
          tdV.className = 'pipeline-verdict pipeline-verdict-' + xval;
          const verdictSymbols = { confirmed: '\u2713', disagreed: '\u2717', recovered: '\u21bb', unconfirmed: '?' };
          tdV.textContent = (verdictSymbols[xval] || '\u00b7') + ' ' + xval;
          tr.appendChild(tdV);

          const tdReason = document.createElement('td');
          tdReason.className = 'pipeline-td-reason';
          const rT = r.type, pT = p.type;
          if (xval === 'confirmed' && rT === 'correct' && pT === 'correct') {
            tdReason.textContent = 'both correct';
          } else if (xval === 'confirmed' && rT === 'correct') {
            tdReason.textContent = 'Reverb correct (sufficient)';
          } else if (xval === 'confirmed' && rT === 'substitution' && pT === 'substitution') {
            const rNorm = (r.hyp || '').toLowerCase();
            const pNorm = (p.hyp || '').toLowerCase();
            tdReason.textContent = rNorm === pNorm ? 'both said "' + r.hyp + '"' : 'Reverb: "' + r.hyp + '", Parakeet: "' + p.hyp + '"';
          } else if (xval === 'disagreed') {
            tdReason.textContent = 'R: ' + r.type + '="' + (r.hyp || '\u2014') + '", P: ' + p.type + '="' + (p.hyp || '\u2014') + '"';
          } else if (xval === 'recovered') {
            tdReason.textContent = 'Reverb omitted, Parakeet heard it';
          } else if (xval === 'unconfirmed') {
            tdReason.textContent = 'Parakeet omitted, Reverb-only evidence';
          } else {
            tdReason.textContent = 'R: ' + rT + ', P: ' + pT;
          }
          tr.appendChild(tdReason);

          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        body.appendChild(table);

        const summary = document.createElement('div');
        summary.className = 'pipeline-step-summary';
        summary.textContent = 'Confirmed: ' + confirmedN + ' | Disagreed: ' + disagreedN + ' | Recovered: ' + recoveredN + ' | Unconfirmed: ' + unconfirmedN;
        const agreePct = (100 * confirmedN / reverbRef.length).toFixed(0);
        summary.textContent += ' | Agreement: ' + agreePct + '%';
        body.appendChild(summary);
      } else {
        const msg = document.createElement('div');
        msg.className = 'pipeline-step-summary';
        msg.textContent = 'Cross-validation unavailable (no paired alignment data)';
        body.appendChild(msg);
      }

      confWordsDiv.appendChild(step);
    }

    // ── STEP 4: Post-Processing ──
    {
      const { step, body } = makeStep(4, 'Post-Processing',
        'omission recovery, compound merges, self-corrections, near-miss clusters, CTC artifacts');

      const lists = [];

      const recoveries = alignment.filter(e => e._recovered);
      if (recoveries.length > 0) {
        lists.push({
          label: 'Omission Recoveries (' + recoveries.length + ')',
          cls: 'pipeline-pp-recovered',
          items: recoveries.map(e => '"' + e.ref + '" \u2014 Reverb omitted, Parakeet heard "' + (e._xvalWord || e.hyp) + '"' + (e._isLastRefWord ? ' (final word, CTC truncation)' : ''))
        });
      }

      const compounds = alignment.filter(e => e.compound);
      if (compounds.length > 0) {
        lists.push({
          label: 'Compound Merges (' + compounds.length + ')',
          cls: 'pipeline-pp-compound',
          items: compounds.map(e => '"' + e.parts.join('" + "') + '" \u2192 "' + e.hyp + '" (ref: "' + e.ref + '")')
        });
      }

      const selfCorrs = alignment.filter(e => e.type === 'self-correction' || e._isSelfCorrection);
      if (selfCorrs.length > 0) {
        lists.push({
          label: 'Self-Corrections (' + selfCorrs.length + ')',
          cls: 'pipeline-pp-selfcorr',
          items: selfCorrs.map(e => '"' + e.hyp + '" (near "' + (e.ref || e._selfCorrectionTarget || '?') + '")')
        });
      }

      const struggles = alignment.filter(e => e.type === 'struggle');
      if (struggles.length > 0) {
        lists.push({
          label: 'Struggle Words (' + struggles.length + ')',
          cls: 'pipeline-pp-struggle',
          items: struggles.map(e => {
            const paths = [];
            if (e._hasHesitation) paths.push('hesitation');
            if (e._nearMissEvidence && e._nearMissEvidence.length > 0) paths.push('decoding');
            if (e._abandonedAttempt) paths.push('abandoned');
            return '"' + e.ref + '" \u2014 said "' + e.hyp + '" [' + (paths.join(', ') || 'base struggle') + ']';
          })
        });
      }

      const absorbed = alignment.filter(e => e._partOfStruggle);
      if (absorbed.length > 0) {
        lists.push({
          label: 'Absorbed Near-Miss Fragments (' + absorbed.length + ')',
          cls: 'pipeline-pp-absorbed',
          items: absorbed.map(e => '"' + e.hyp + '" absorbed into struggle for "' + (e._struggleRef || '?') + '"')
        });
      }

      const artifacts = (transcriptWords || []).filter(w => w._ctcArtifact);
      if (artifacts.length > 0) {
        lists.push({
          label: 'CTC Artifacts Filtered (' + artifacts.length + ')',
          cls: 'pipeline-pp-artifact',
          items: artifacts.map(w => '"' + w.word + '" (' + Math.round((parseSttTime(w.endTime) - parseSttTime(w.startTime)) * 1000) + 'ms, overlaps confirmed word)')
        });
      }

      const forgiven = alignment.filter(e => e.forgiven);
      if (forgiven.length > 0) {
        lists.push({
          label: 'Forgiven Proper Nouns (' + forgiven.length + ')',
          cls: 'pipeline-pp-forgiven',
          items: forgiven.map(e => '"' + e.ref + '" \u2014 said "' + e.hyp + '" (' + (e.phoneticRatio || '?') + '% similar)')
        });
      }

      if (lists.length === 0) {
        const msg = document.createElement('div');
        msg.className = 'pipeline-step-summary';
        msg.textContent = 'No post-processing modifications applied';
        body.appendChild(msg);
      } else {
        for (const list of lists) {
          const section = document.createElement('div');
          section.className = 'pipeline-pp-section ' + list.cls;
          const label = document.createElement('div');
          label.className = 'pipeline-pp-label';
          label.textContent = list.label;
          section.appendChild(label);
          const ul = document.createElement('ul');
          ul.className = 'pipeline-pp-list';
          for (const item of list.items) {
            const li = document.createElement('li');
            li.textContent = item;
            ul.appendChild(li);
          }
          section.appendChild(ul);
          body.appendChild(section);
        }
      }

      confWordsDiv.appendChild(step);
    }

    // ── STEP 5: Final Scored Alignment ──
    {
      const { step, body } = makeStep(5, 'Final Scored Alignment',
        'the result used for WCPM and accuracy scoring');

      const table = document.createElement('table');
      table.className = 'pipeline-table';

      const thead = document.createElement('thead');
      const hrow = document.createElement('tr');
      for (const h of ['#', 'Reference', 'Hypothesis', 'Type', 'Cross-Val', 'Notes']) {
        const th = document.createElement('th');
        th.textContent = h;
        hrow.appendChild(th);
      }
      thead.appendChild(hrow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      let rowNum = 0;
      for (const item of alignment) {
        rowNum++;
        const tr = document.createElement('tr');
        tr.className = 'pipeline-final-' + item.type;

        const tdIdx = document.createElement('td');
        tdIdx.className = 'pipeline-td-idx';
        tdIdx.textContent = rowNum;
        tr.appendChild(tdIdx);

        const tdRef = document.createElement('td');
        tdRef.className = 'pipeline-td-ref';
        tdRef.textContent = item.type === 'insertion' ? '\u2014' : (item.ref || '?');
        tr.appendChild(tdRef);

        const tdHyp = document.createElement('td');
        if (item.type === 'omission') {
          tdHyp.textContent = '\u2014';
          tdHyp.className = 'pipeline-td-omission';
        } else {
          tdHyp.textContent = item.hyp || '?';
          tdHyp.className = item.type === 'correct' ? 'pipeline-td-correct' : 'pipeline-td-sub';
        }
        tr.appendChild(tdHyp);

        const tdType = document.createElement('td');
        tdType.className = 'pipeline-td-type pipeline-td-type-' + item.type;
        tdType.textContent = item.type + (item.forgiven ? ' (forgiven)' : '') + (item.compound ? ' (compound)' : '');
        tr.appendChild(tdType);

        const tdXval = document.createElement('td');
        const xv = item.crossValidation || '';
        tdXval.className = 'pipeline-verdict pipeline-verdict-' + xv;
        tdXval.textContent = xv || '\u2014';
        tr.appendChild(tdXval);

        const tdNotes = document.createElement('td');
        tdNotes.className = 'pipeline-td-reason';
        const notes = [];
        if (item._recovered) notes.push('recovered');
        if (item._isSelfCorrection) notes.push('self-correction');
        if (item._partOfStruggle) notes.push('part of struggle');
        if (item._nearMissEvidence && item._nearMissEvidence.length > 0) notes.push('near-miss: ' + item._nearMissEvidence.join(', '));
        if (item._hasHesitation) notes.push('hesitation');
        if (item._abandonedAttempt) notes.push('abandoned attempt');
        if (item._healed) notes.push('healed');
        if (item.compound) notes.push('parts: ' + item.parts.join('+'));
        tdNotes.textContent = notes.join('; ') || '';
        tr.appendChild(tdNotes);

        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      body.appendChild(table);

      confWordsDiv.appendChild(step);
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
      endTime: end
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
      enrichIdx++;
    }
    return entry;
  });

  // Disfluency diagnostics section (Phase 24)
  // disfluencySummary carries Kitchen Sink disfluencyStats when available
  if (disfluencySummary && disfluencySummary.total !== undefined) {
    renderDisfluencySection(disfluencySummary, transcriptWords, enrichedAlignment, wordAudioEl);
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
 * Shows each disfluent word with context, classification, and play button.
 *
 * @param {object|null} disfluencyStats - Aggregate stats from Kitchen Sink:
 *   { total, contentWords, rate, byType: { filler, repetition, false_start, unknown } }
 * @param {Array|null} transcriptWords - Full transcript word list with isDisfluency flags
 * @param {Array|null} alignment - Ref-vs-STT alignment entries for context enrichment
 * @param {HTMLAudioElement|null} audioEl - Shared audio element for click-to-play
 */
function renderDisfluencySection(disfluencyStats, transcriptWords, alignment, audioEl) {
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

  // ── Build word-level disfluency list from transcriptWords ──
  const CONTEXT_RADIUS = 4;
  const disfluencies = [];
  if (transcriptWords && transcriptWords.length > 0) {
    for (let i = 0; i < transcriptWords.length; i++) {
      const w = transcriptWords[i];
      if (!w.isDisfluency) continue;

      // Gather expanded context: up to CONTEXT_RADIUS words before and after
      // Also capture timestamps of outermost context words for audio clip
      const prevWords = [];
      let clipStart = parseSttTime(w.startTime);
      for (let j = i - 1; j >= 0 && prevWords.length < CONTEXT_RADIUS; j--) {
        prevWords.unshift(transcriptWords[j].word);
        const t = parseSttTime(transcriptWords[j].startTime);
        if (t > 0) clipStart = t;
      }
      const nextWords = [];
      let clipEnd = parseSttTime(w.endTime);
      for (let j = i + 1; j < transcriptWords.length && nextWords.length < CONTEXT_RADIUS; j++) {
        nextWords.push(transcriptWords[j].word);
        const t = parseSttTime(transcriptWords[j].endTime);
        if (t > 0) clipEnd = t;
      }

      disfluencies.push({
        word: w.word,
        type: w.disfluencyType || 'unknown',
        divergence: w._divergence || null,
        crossValidation: w.crossValidation,
        transcriptIndex: i,
        startTime: parseSttTime(w.startTime),
        endTime: parseSttTime(w.endTime),
        clipStart,  // startTime of first context word
        clipEnd,    // endTime of last context word
        prevWords,
        nextWords,
        nextWord: nextWords[0] || null  // kept for enrichment strategy 3
      });
    }
  }

  // ── Enrich with divergence block context ──
  // Divergence blocks already carry cleanTarget (the v0 word the student was trying to say)
  for (const d of disfluencies) {
    // Primary: divergence block cleanTarget from v1/v0 alignment
    if (d.divergence && d.divergence.cleanTarget) {
      d.refTarget = d.divergence.cleanTarget;
    }

    // Self-correction: check if alignment insertion is flagged
    if (!d.selfCorrection && alignment && alignment.length > 0) {
      const dNorm = d.word.toLowerCase().replace(/[^a-z']/g, '');
      for (const entry of alignment) {
        if (entry.type !== 'insertion') continue;
        if (!entry._isSelfCorrection) continue;
        const hypNorm = (entry.hyp || '').toLowerCase().replace(/[^a-z']/g, '');
        if (hypNorm === dNorm) {
          d.selfCorrection = true;
          break;
        }
      }
    }
  }

  // ── Collapsed summary line ──
  const typeLabels = {
    struggle: 'struggle',
    mismatch: 'mismatch',
    extra: 'extra word'
  };

  // Count by resolved type for summary
  const typeCounts = {};
  for (const d of disfluencies) {
    let label;
    if (d.selfCorrection) label = 'self-correction';
    else if (d.divergence) label = d.divergence.cleanTarget ? 'struggle' : 'extra word';
    else label = typeLabels[d.type] || 'extra word';
    typeCounts[label] = (typeCounts[label] || 0) + 1;
  }

  const summaryParts = [];
  for (const [label, count] of Object.entries(typeCounts)) {
    summaryParts.push(`${count} ${label}${count > 1 ? 's' : ''}`);
  }
  summaryEl.textContent = `Disfluencies: ${disfluencyStats.total}` +
    (summaryParts.length > 0 ? ` (${summaryParts.join(', ')})` : '');

  // ── Expanded detail: word-level rows ──
  detailsEl.innerHTML = '';

  if (disfluencies.length === 0) {
    // Fallback: no transcriptWords available, show old-style aggregate
    detailsEl.textContent = `${disfluencyStats.total} disfluencies detected`;
    return;
  }

  for (const d of disfluencies) {
    const row = document.createElement('div');
    row.className = 'disfluency-word-row';

    // Layout: play | ...context with highlighted word... | type · note

    // Play button — plays audio covering all visible context words
    const playBtn = document.createElement('button');
    playBtn.className = 'disfluency-play-btn';
    playBtn.textContent = '\u25B6';
    playBtn.title = 'Play audio';
    if (audioEl && d.clipStart > 0) {
      const clipStart = Math.max(0, d.clipStart - 0.15);
      const clipEnd = d.clipEnd + 0.15;
      playBtn.addEventListener('click', () => {
        audioEl.pause();
        if (audioEl._disfluencyOnTime) {
          audioEl.removeEventListener('timeupdate', audioEl._disfluencyOnTime);
        }
        // Clear any previous playing highlight
        detailsEl.querySelectorAll('.disfluency-word-row.playing').forEach(r => r.classList.remove('playing'));
        row.classList.add('playing');
        audioEl.currentTime = clipStart;
        const onTime = () => {
          if (audioEl.currentTime >= clipEnd) {
            audioEl.pause();
            audioEl.removeEventListener('timeupdate', onTime);
            audioEl._disfluencyOnTime = null;
            row.classList.remove('playing');
          }
        };
        audioEl._disfluencyOnTime = onTime;
        audioEl.addEventListener('timeupdate', onTime);
        audioEl.play().catch(() => {});
      });
    } else {
      playBtn.disabled = true;
      playBtn.style.opacity = '0.3';
    }
    row.appendChild(playBtn);

    // Context snippet: ...grey words RED_WORD grey words...
    const ctx = document.createElement('span');
    ctx.className = 'disfluency-word-context';

    if (d.prevWords.length > 0 && d.transcriptIndex > d.prevWords.length) {
      ctx.appendChild(document.createTextNode('\u2026 '));
    }
    for (const pw of d.prevWords) {
      ctx.appendChild(document.createTextNode(pw + ' '));
    }
    const hl = document.createElement('span');
    hl.className = 'disfluency-ctx-highlight';
    hl.textContent = d.word;
    ctx.appendChild(hl);
    for (const nw of d.nextWords) {
      ctx.appendChild(document.createTextNode(' ' + nw));
    }
    if (d.nextWords.length > 0 &&
        d.transcriptIndex + d.nextWords.length < transcriptWords.length - 1) {
      ctx.appendChild(document.createTextNode(' \u2026'));
    }
    row.appendChild(ctx);

    // Metadata: type · note  (right-aligned, single span)
    const meta = document.createElement('span');
    meta.className = 'disfluency-word-meta';

    const typeSpan = document.createElement('span');
    typeSpan.className = 'disfluency-meta-type';
    if (d.selfCorrection) {
      typeSpan.textContent = 'self-correction';
      typeSpan.classList.add('disfluency-meta-selfcorrection');
    } else if (d.divergence) {
      const label = d.divergence.cleanTarget ? 'struggle' : 'extra word';
      typeSpan.textContent = label;
      typeSpan.classList.add(d.divergence.cleanTarget ? 'disfluency-meta-struggle' : 'disfluency-meta-extra');
    } else {
      const label = typeLabels[d.type] || 'extra word';
      typeSpan.textContent = label;
      typeSpan.classList.add(`disfluency-meta-${d.type}`);
    }
    meta.appendChild(typeSpan);

    // Enrichment note — show clean target from divergence block
    let noteText = '';
    if (!d.selfCorrection) {
      if (d.divergence && d.divergence.cleanTarget) {
        const fragments = d.divergence.verbatimWords.map(w => `"${w}"`).join(', ');
        noteText = `target "${d.divergence.cleanTarget}" \u2190 ${fragments}`;
      } else if (d.refTarget) {
        noteText = `\u2192 ${d.refTarget}`;
      }
    }
    if (noteText) {
      meta.appendChild(document.createTextNode(' \u00B7 '));
      const noteSpan = document.createElement('span');
      noteSpan.textContent = noteText;
      meta.appendChild(noteSpan);
    }
    row.appendChild(meta);

    detailsEl.appendChild(row);
  }

  // Rate line at bottom
  if (disfluencyStats.rate) {
    const rateLine = document.createElement('div');
    rateLine.className = 'disfluency-rate-line';
    rateLine.textContent = `Rate: ${disfluencyStats.rate} of words`;
    detailsEl.appendChild(rateLine);
  }
}

// ── Word Speed Map rendering ────────────────────────────────────────

/**
 * Render Word Speed Map inline within a parent element (prosody body).
 * Creates legend, passage words (colored by tier), and summary bar.
 *
 * @param {HTMLElement} parent - Element to append word speed content into
 * @param {object} wordSpeedData - Output from computeWordSpeedTiers()
 */
function renderWordSpeedInto(parent, wordSpeedData, wordAudioEl, transcriptWords, referenceText) {
  if (!wordSpeedData || wordSpeedData.insufficient) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'word-speed-inline';

  // Header row: label + toggle
  const headerRow = document.createElement('div');
  headerRow.className = 'word-speed-header';

  const label = document.createElement('h5');
  label.className = 'word-speed-label';
  label.textContent = 'Word Speed Map';
  headerRow.appendChild(label);

  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'ws-pause-toggle';
  const toggleCb = document.createElement('input');
  toggleCb.type = 'checkbox';
  toggleLabel.appendChild(toggleCb);
  toggleLabel.appendChild(document.createTextNode(' Include preceding pauses'));
  headerRow.appendChild(toggleLabel);

  wrapper.appendChild(headerRow);

  // ── Legend ──
  const legendEl = document.createElement('div');
  legendEl.className = 'word-speed-legend';
  const tiers = [
    { cls: 'ws-quick', label: 'Quick' },
    { cls: 'ws-steady', label: 'Steady' },
    { cls: 'ws-slow', label: 'Slow' },
    { cls: 'ws-struggling', label: 'Struggling' },
    { cls: 'ws-stalled', label: 'Stalled' },
    { cls: 'ws-short-word', label: '1-syl word' },
    { cls: 'ws-omitted', label: 'Omitted' },
    { cls: 'ws-no-data', label: 'No data' }
  ];
  for (const t of tiers) {
    const span = document.createElement('span');
    span.className = t.cls;
    span.textContent = t.label;
    legendEl.appendChild(span);
  }
  wrapper.appendChild(legendEl);

  // ── Passage words (re-rendered on toggle) ──
  const wordsEl = document.createElement('div');
  wordsEl.className = 'word-speed-words';
  wrapper.appendChild(wordsEl);

  // ── Summary bar (re-rendered on toggle) ──
  const summaryEl = document.createElement('div');
  summaryEl.className = 'word-speed-summary';
  wrapper.appendChild(summaryEl);

  /** Populate words grid + summary from a wordSpeedData object */
  function renderContent(data) {
    wordsEl.innerHTML = '';
    hideWordTooltip();
    for (const w of data.words) {
      const span = document.createElement('span');
      span.className = `word ws-${w.tier}`;
      span.textContent = w.refWord || '???';
      span.dataset.tooltip = buildWordSpeedTooltip(w);

      // Click-to-play word audio
      if (wordAudioEl && w.hypIndex != null && transcriptWords && transcriptWords[w.hypIndex]) {
        const tw = transcriptWords[w.hypIndex];
        const start = parseSttTime(tw.startTime);
        const end = parseSttTime(tw.endTime);
        if (start > 0) {
          span.classList.add('word-clickable');
          const playFn = () => {
            wordAudioEl.pause();
            wordAudioEl.currentTime = start;
            const onTime = () => {
              if (wordAudioEl.currentTime >= end) {
                wordAudioEl.pause();
                wordAudioEl.removeEventListener('timeupdate', onTime);
              }
            };
            wordAudioEl.addEventListener('timeupdate', onTime);
            wordAudioEl.play().catch(() => {});
          };
          span.addEventListener('click', (e) => { e.stopPropagation(); showWordTooltip(span, playFn); });
        } else {
          span.addEventListener('click', (e) => { e.stopPropagation(); showWordTooltip(span, null); });
        }
      } else {
        span.addEventListener('click', (e) => { e.stopPropagation(); showWordTooltip(span, null); });
      }

      wordsEl.appendChild(span);
      wordsEl.appendChild(document.createTextNode(' '));
    }
    renderWordSpeedSummary(summaryEl, data);
  }

  // Initial render with original data
  renderContent(wordSpeedData);

  // Toggle handler: recompute with pauses or revert to original
  toggleCb.addEventListener('change', () => {
    if (toggleCb.checked) {
      const adjusted = recomputeWordSpeedWithPauses(wordSpeedData, transcriptWords, referenceText);
      renderContent(adjusted);
    } else {
      renderContent(wordSpeedData);
    }
  });

  parent.appendChild(wrapper);
}

/**
 * Build a debug-rich tooltip for a word in the Word Speed Map.
 * Shows all available data — this is the debug surface.
 *
 * @param {object} w - Word entry from computeWordSpeedTiers().words[]
 * @returns {string} Tooltip text
 */
function buildWordSpeedTooltip(w) {
  const lines = [];

  if (w.tier === 'omitted') {
    lines.push(`"${w.refWord}"`);
    lines.push('Omitted — student did not read this word');
    return lines.join('\n');
  }

  // Ref → heard
  if (w.word && w.word.toLowerCase() !== (w.refWord || '').toLowerCase()) {
    lines.push(`"${w.refWord}" (ref) → "${w.word}" (heard)`);
  } else {
    lines.push(`"${w.refWord}"`);
  }

  lines.push(`Type: ${w.alignmentType}`);

  if (w.tier === 'no-data') {
    lines.push('No timing data — word not classified');
    return lines.join('\n');
  }

  // Duration line with phoneme + syllable counts
  if (w.durationMs != null) {
    const phonemeStr = w.phonemes != null ? `${w.phonemes} ph` : '';
    const sylStr = w.syllables != null ? `${w.syllables} syl` : '';
    const countsStr = [phonemeStr, sylStr].filter(Boolean).join(', ');
    const sourceTag = w.phonemeSource === 'fallback' ? ' (est.)' : '';
    if (w._gapBeforeMs != null && w._gapBeforeMs > 0) {
      lines.push(`Duration: ${w.durationMs}ms (word) + ${w._gapBeforeMs}ms (pause) = ${w._effectiveDurationMs}ms | ${countsStr}${sourceTag} | ${w.normalizedMs} ms/ph`);
    } else {
      lines.push(`Duration: ${w.durationMs}ms | ${countsStr}${sourceTag} | ${w.normalizedMs} ms/ph`);
    }
    if (w._tsSource === 'primary' || w._tsSource === 'metric4') {
      lines.push('Timestamps: Reverb (cross-validator unavailable)');
    }
  }

  if (w.tier === 'short-word') {
    lines.push('Tier: short-word — few phonemes, timing not classified');
    if (w._medianMs) lines.push(`Student median: ${w._medianMs} ms/ph`);
    if (w.sentenceFinal) lines.push('(sentence-final — duration may be inflated)');
    return lines.join('\n');
  }

  // Ratio + tier with range
  const tierRanges = {
    quick: '< 0.75x',
    steady: '0.75x – 1.25x',
    slow: '1.25x – 1.75x',
    struggling: '1.75x – 2.50x',
    stalled: '>= 2.50x'
  };
  if (w.ratio != null && w._medianMs) {
    lines.push(`Ratio: ${w.ratio}x student median (${w._medianMs} ms/ph)`);
  }
  lines.push(`Tier: ${w.tier} (${tierRanges[w.tier] || '?'} range)`);

  // IQR outlier status
  if (w._upperFence) {
    lines.push(`IQR outlier: ${w.isOutlier ? 'yes' : 'no'} (fence: ${w._upperFence} ms/ph)`);
  }

  // Sentence-final flag
  if (w.sentenceFinal) {
    lines.push('(sentence-final — duration may be inflated)');
  }

  return lines.join('\n');
}

/**
 * Render the summary bar below the word speed passage.
 * Stacked distribution bar + text stats.
 *
 * @param {HTMLElement} container - The summary container element
 * @param {object} data - Output from computeWordSpeedTiers()
 */
function renderWordSpeedSummary(container, data) {
  container.innerHTML = '';
  const d = data.distribution;

  // Text summary line
  const textLine = document.createElement('div');
  const parts = [];
  parts.push(`${data.atPacePercent}% at pace`);
  if (d.slow > 0) parts.push(`${d.slow} slow`);
  if (d.struggling > 0) parts.push(`${d.struggling} struggling`);
  if (d.stalled > 0) parts.push(`${d.stalled} stalled`);
  textLine.textContent = parts.join(' | ');
  container.appendChild(textLine);

  // Stacked distribution bar (only classifiable tiers)
  const classifiable = d.quick + d.steady + d.slow + d.struggling + d.stalled;
  if (classifiable > 0) {
    const bar = document.createElement('div');
    bar.className = 'ws-dist-bar';
    const segs = [
      { cls: 'seg-quick', count: d.quick },
      { cls: 'seg-steady', count: d.steady },
      { cls: 'seg-slow', count: d.slow },
      { cls: 'seg-struggling', count: d.struggling },
      { cls: 'seg-stalled', count: d.stalled }
    ];
    for (const s of segs) {
      if (s.count <= 0) continue;
      const seg = document.createElement('div');
      seg.className = s.cls;
      seg.style.width = ((s.count / classifiable) * 100) + '%';
      bar.appendChild(seg);
    }
    container.appendChild(bar);
  }

  // Counts line
  const countsLine = document.createElement('div');
  countsLine.style.color = '#888';
  countsLine.style.fontSize = '0.8em';
  countsLine.style.marginTop = '4px';
  const countParts = [`${classifiable} classifiable words`];
  if (d['short-word'] > 0) countParts.push(`${d['short-word']} single-syl`);
  if (d.omitted > 0) countParts.push(`${d.omitted} omitted`);
  if (d['no-data'] > 0) countParts.push(`${d['no-data']} no data`);
  countsLine.textContent = countParts.join(' | ');
  container.appendChild(countsLine);

  // Baseline line
  if (data.baseline && data.baseline.medianMs) {
    const baseLine = document.createElement('div');
    baseLine.style.color = '#888';
    baseLine.style.fontSize = '0.8em';
    baseLine.textContent = `Student baseline: ${data.baseline.medianMs} ms/phoneme`;
    container.appendChild(baseLine);
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
