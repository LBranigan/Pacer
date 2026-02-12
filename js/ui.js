import { recomputeWordSpeedWithPauses, isNearMiss } from './diagnostics.js';

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

  // Footer row: play button + NL info on same line
  const nlData = span.dataset.nl;
  if (playFn || nlData) {
    const footer = document.createElement('div');
    footer.className = 'tooltip-footer';

    if (playFn) {
      const btn = document.createElement('button');
      btn.className = 'tooltip-play';
      btn.textContent = '\u25B6 Play';
      btn.addEventListener('click', (e) => { e.stopPropagation(); playFn(); });
      footer.appendChild(btn);
    }

    if (nlData) {
      const nlSpan = document.createElement('span');
      nlSpan.className = 'tooltip-nl';
      nlSpan.innerHTML = nlData;
      footer.appendChild(nlSpan);
    }

    tip.appendChild(footer);
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
 * Build consolidated word tooltip with clean 8-section layout.
 * Sections: Expected | V1 | V0 | Parakeet | Miscue type | Explanation | VAD | NL
 * @param {Object} item - Alignment item with type, ref, hyp
 * @param {Object|null} sttWord - STT word metadata with timestamps
 * @param {Object} extras - { hesitationDelay, morphData }
 * @returns {string} Tooltip text
 */
function buildEnhancedTooltip(item, sttWord, extras) {
  const lines = [];
  extras = extras || {};
  const isUnknown = sttWord && isSpecialASTToken(sttWord.word);

  // Helper: format timestamp range concisely
  const fmtTs = (startRaw, endRaw) => {
    if (startRaw == null || endRaw == null) return '';
    const s = parseSttTime(startRaw);
    const e = parseSttTime(endRaw);
    return ` (${s.toFixed(2)}s\u2013${e.toFixed(2)}s)`;
  };

  // -- 1. Expected --
  lines.push(`Expected: ${item.ref || '\u2014'}`);

  // -- 2-4. Engine lines --
  if (sttWord) {
    // V1 (Reverb verbatim)
    let v1Text;
    if (item._recovered || item.type === 'omission') {
      v1Text = '\u2014';
    } else if (isUnknown) {
      v1Text = '[unknown]';
    } else if (item.compound && item.parts) {
      v1Text = item.parts.map(p => `"${p}"`).join(' + ');
    } else {
      v1Text = `"${item.hyp}"`;
    }
    lines.push(`V1: ${v1Text}${fmtTs(sttWord._reverbStartTime, sttWord._reverbEndTime)}`);

    // V0 (Reverb clean) — from 3-way alignment
    let v0Text;
    if (item._recovered || item.type === 'omission') {
      v0Text = '\u2014';
    } else if (item._v0Word) {
      v0Text = `"${item._v0Word}"`;
    } else if (item._v0Type === 'omission') {
      v0Text = '\u2014 (suppressed)';
    } else {
      v0Text = '\u2014';
    }
    lines.push(`V0: ${v0Text}${fmtTs(item._v0StartTime, item._v0EndTime)}`);

    // Parakeet / Cross-validator
    const xvalLabel = sttWord._xvalEngine
      ? sttWord._xvalEngine.charAt(0).toUpperCase() + sttWord._xvalEngine.slice(1)
      : 'Parakeet';
    let pkText;
    if (sttWord._recovered) {
      pkText = `"${sttWord._xvalWord || sttWord.word}"`;
    } else if (sttWord._xvalWord) {
      pkText = `"${sttWord._xvalWord}"`;
    } else {
      pkText = '\u2014';
    }
    lines.push(`${xvalLabel}: ${pkText}${fmtTs(sttWord._xvalStartTime, sttWord._xvalEndTime)}`);
  }

  // -- 5 & 6. Miscue type + short explanation --
  if (item.type === 'substitution') {
    if (item.forgiven) {
      const ratioText = item.phoneticRatio ? ` (${item.phoneticRatio}% similar)` : '';
      lines.push(`Forgiven substitution${ratioText}`);
    } else {
      lines.push('Substitution');
      if (extras.morphData) {
        lines.push(`Morphological: shared ${extras.morphData.matchType} "${extras.morphData.sharedPart}"`);
      }
    }
  } else if (item.type === 'struggle') {
    const paths = [];
    if (item._strugglePath === 'hesitation' || item._hasHesitation) paths.push('hesitation');
    if (item._strugglePath === 'decoding' || (item._nearMissEvidence?.length > 0)) paths.push('decoding');
    if (item._abandonedAttempt) paths.push('abandoned');
    if (item._strugglePath === 'compound_fragments') paths.push('compound fragments');
    const pathStr = paths.length > 0 ? ` (${paths.join(', ')})` : '';
    lines.push(`Struggle${pathStr}`);
    if (item._nearMissEvidence?.length > 0) {
      const attempts = [item.hyp, ...item._nearMissEvidence];
      lines.push(`Attempts: ${attempts.join(', ')}`);
    }
  } else if (item.type === 'omission') {
    lines.push('Omission');
  } else if (item._recovered) {
    lines.push(item._isLastRefWord ? 'Recovered (final word)' : 'Recovered');
  } else if (item.type === 'self-correction') {
    lines.push('Self-correction');
  }

  if (sttWord?.isDisfluency && item.type !== 'struggle') {
    lines.push('Disfluency \u2014 not an error');
  }

  // Cross-validation verdict
  if (item.crossValidation) {
    const xvLabels = {
      confirmed: 'Confirmed (engines agree)',
      disagreed: 'Disagreed (engines differ)',
      recovered: 'Recovered (another engine heard it)',
      unconfirmed: 'Unconfirmed (V1 only)',
      unavailable: 'Unavailable'
    };
    lines.push(`Verdict: ${xvLabels[item.crossValidation] || item.crossValidation}`);
  }

  // -- 7. VAD overhang --
  if (extras.hesitationDelay?._vadOverhang) {
    const vh = extras.hesitationDelay._vadOverhang;
    lines.push(`VAD overhang: ${vh.overhangMs}ms (adjusted gap ${vh.adjustedGapMs}ms)`);
  }

  // -- 8. NL classifier --
  if (item.nl) {
    const posLabel = POS_LABELS[item.nl.pos] || item.nl.pos;
    const parts = [posLabel];
    if (item.nl.entityType && item.nl.entityType !== 'OTHER') {
      parts.push('\ud83d\udccd ' + (ENTITY_LABELS[item.nl.entityType] || item.nl.entityType));
    }
    const tierLabel = TIER_LABELS[item.nl.tier];
    if (tierLabel) parts.push('\ud83d\udcda ' + tierLabel);
    lines.push(parts.join(' \u00b7 '));
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

/**
 * Render new analyzed words section with bucketed classification.
 *
 * Buckets (in display order):
 *   correct              — green:  all engines agree
 *   struggle-correct     — light green:  student got it but showed difficulty (false start, compound fragments)
 *   omitted              — gray:   no engine heard the word
 *   attempted-struggled  — orange: at least one engine heard the correct word, but V1 failed
 *   definite-struggle    — red:    no engine produced the correct word, V1 hyp is near-miss
 *   confirmed-substitution — blue: all engines agree on same unrelated wrong word
 */
function renderNewAnalyzedWords(container, alignment, sttLookup, diagnostics, transcriptWords, referenceText, wordAudioEl, rawSttSources, audioBlob) {
  container.innerHTML = '';
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z]/g, '');

  // ── 1. Group ref entries with their V1 insertions ──────────────────────
  const groups = [];
  let pendingInsertions = [];
  for (const entry of alignment) {
    if (entry.type === 'insertion') {
      pendingInsertions.push(entry);
    } else {
      groups.push({ entry, insertionsBefore: pendingInsertions, insertionsAfter: [] });
      pendingInsertions = [];
    }
  }
  if (groups.length > 0 && pendingInsertions.length > 0) {
    groups[groups.length - 1].insertionsAfter = pendingInsertions;
  }

  // Reassign trailing insertions to their semantic parent via _prevRef.
  // Rule: if an insertion is a prefix of the NEXT ref word, keep it (false start).
  //        Otherwise if _prevRef matches the PREVIOUS ref, move it (trailing fragment).
  for (let i = 1; i < groups.length; i++) {
    const prevRefN = norm(groups[i - 1].entry.ref);
    const thisRefN = norm(groups[i].entry.ref);
    const keep = [];
    for (const ins of groups[i].insertionsBefore) {
      const insN = norm(ins.hyp);
      const prevN = norm(ins._prevRef);
      if (insN.length >= 2 && thisRefN.startsWith(insN)) {
        keep.push(ins);                                  // false start for this word
      } else if (prevN === prevRefN) {
        groups[i - 1].insertionsAfter.push(ins);         // trailing fragment of prev word
      } else {
        keep.push(ins);
      }
    }
    groups[i].insertionsBefore = keep;
  }

  // ── 2. Diagnostic maps ─────────────────────────────────────────────────
  const onsetMap = new Map();
  if (diagnostics?.onsetDelays) {
    for (const d of diagnostics.onsetDelays) onsetMap.set(d.wordIndex, d);
  }
  const pauseBeforeMap = new Map();
  if (diagnostics?.longPauses) {
    for (const p of diagnostics.longPauses) {
      for (const g of groups) {
        if (g.entry.hypIndex > p.afterWordIndex && g.entry.type !== 'omission') {
          pauseBeforeMap.set(g.entry.hypIndex, p);
          break;
        }
      }
    }
  }

  // Cosmetic punctuation map (mirrors normalizeText's trailing-hyphen merge + hyphen split)
  const punctMap = new Map();
  if (referenceText) {
    const rawTokens = referenceText.trim().split(/\s+/);
    const merged = [];
    for (let i = 0; i < rawTokens.length; i++) {
      const s = rawTokens[i].replace(/^[^\w'-]+|[^\w'-]+$/g, '');
      if (!s.length) continue;
      if (s.endsWith('-') && i + 1 < rawTokens.length) { merged.push(rawTokens[i + 1]); i++; }
      else merged.push(rawTokens[i]);
    }
    const split = [];
    for (const token of merged) {
      const s = token.replace(/^[^\w'-]+|[^\w'-]+$/g, '');
      if (s.includes('-')) {
        const parts = s.split('-').filter(p => p.length > 0);
        for (let j = 0; j < parts.length - 1; j++) split.push(parts[j]);
        split.push(token);
      } else split.push(token);
    }
    for (let i = 0; i < split.length; i++) {
      const m = split[i].match(/([.!?,;:\u2014\u2013\u2012\u2015]+["'\u201C\u201D\u2018\u2019)}\]]*|["'\u201C\u201D\u2018\u2019)}\]]+)$/);
      if (m) punctMap.set(i, m[0]);
    }
  }

  // ── 3. Classification ──────────────────────────────────────────────────
  function classifyWord(entry, group, nextGroup) {
    if (entry.forgiven) return 'correct';
    if (entry.type === 'omission') return 'omitted';

    // Correct or compound-struggle (which resolved to correct word)
    if (entry.type === 'correct' || (entry.type === 'struggle' && entry.compound)) {
      // Recovered = only cross-validator heard it (V1/V0 both missed) — not confidently correct
      if (entry._recovered) return 'struggle-correct';
      // Compound fragments (e.g., "own"+"ed" for "owned") = clear mid-word pause → orange
      if (entry.type === 'struggle' && entry.compound && entry.parts?.length >= 2) return 'attempted-struggled';
      const refN = norm(entry.ref);
      const hasRelatedIns = group.insertionsBefore.some(ins => {
        const h = norm(ins.hyp);
        return (h.length >= 2 && refN.startsWith(h)) || isNearMiss(ins.hyp, entry.ref);
      });
      if (hasRelatedIns) return 'struggle-correct';
      // V0 (clean model) disagreed — pronunciation was messy enough to confuse one engine
      if (entry._v0Type === 'substitution') return 'struggle-correct';
      return 'correct';
    }

    // Non-compound struggle (decoding near-miss, hesitation, abandoned attempt)
    // These were substitutions upgraded by resolveNearMissClusters or detectStruggleWords
    if (entry.type === 'struggle' && !entry.compound) {
      const refN = norm(entry.ref);
      // Did any engine hear the correct word?
      if (norm(entry._xvalWord) === refN || norm(entry._v0Word) === refN) return 'attempted-struggled';
      return 'definite-struggle';
    }

    // Substitution
    if (entry.type === 'substitution') {
      // <unknown> CTC token = ASR detected speech but couldn't decode → definite struggle
      if (entry.hyp === 'unknown' && norm(entry.ref) !== 'unknown') return 'definite-struggle';
      const refN = norm(entry.ref);
      // Did any engine hear the correct word?
      if (norm(entry._xvalWord) === refN || norm(entry._v0Word) === refN) return 'attempted-struggled';
      // Is V1 hyp a near-miss (morphological/phonetic)?
      if (entry.hyp && entry.ref && isNearMiss(entry.hyp, entry.ref)) return 'definite-struggle';
      // Check trailing insertions (e.g., "oreo" after "editorial")
      if (group.insertionsAfter.some(ins => ins.hyp && isNearMiss(ins.hyp, entry.ref))) return 'definite-struggle';
      const postIns = nextGroup ? nextGroup.insertionsBefore : [];
      if (postIns.some(ins => norm(ins._prevRef) === refN && ins.hyp && isNearMiss(ins.hyp, entry.ref))) return 'definite-struggle';
      return 'confirmed-substitution';
    }

    return 'correct';
  }

  const BUCKET = {
    'correct':                 { label: 'Correct',                   color: '#2e7d32' },
    'struggle-correct':        { label: 'Struggle but Correct',      color: '#558b2f' },
    'omitted':                 { label: 'Omitted',                   color: '#757575' },
    'attempted-struggled':     { label: 'Attempted but Struggled',   color: '#e65100' },
    'definite-struggle':       { label: 'Definite Struggle',         color: '#c62828' },
    'confirmed-substitution':  { label: 'Confirmed Substitution',    color: '#1565c0' }
  };

  const classified = groups.map((g, i) => {
    const bucket = classifyWord(g.entry, g, i < groups.length - 1 ? groups[i + 1] : null);
    g.entry._uiBucket = bucket; // Stamp for debug log visibility
    return { ...g, bucket };
  });

  // ── 4. Audio player + download WAV ──────────────────────────────────
  if (audioBlob) {
    const playerWrap = document.createElement('div');
    playerWrap.className = 'new-analyzed-player';
    playerWrap.style.display = 'flex';
    playerWrap.style.alignItems = 'center';
    playerWrap.style.gap = '0.5rem';
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = URL.createObjectURL(audioBlob);
    playerWrap.appendChild(audio);

    const dlBtn = document.createElement('button');
    dlBtn.textContent = '\u2B07 WAV';
    dlBtn.title = 'Download as WAV file';
    dlBtn.style.padding = '0.4rem 0.8rem';
    dlBtn.style.cursor = 'pointer';
    dlBtn.addEventListener('click', async () => {
      dlBtn.disabled = true;
      dlBtn.textContent = '...';
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const arrayBuf = await audioBlob.arrayBuffer();
        const audioBuf = await audioCtx.decodeAudioData(arrayBuf);
        const wavBlob = audioBufferToWav(audioBuf);
        const url = URL.createObjectURL(wavBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'recording-' + new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-') + '.wav';
        a.click();
        URL.revokeObjectURL(url);
        audioCtx.close();
      } catch (err) {
        console.error('WAV conversion failed:', err);
        alert('Failed to convert to WAV: ' + err.message);
      } finally {
        dlBtn.disabled = false;
        dlBtn.textContent = '\u2B07 WAV';
      }
    });
    playerWrap.appendChild(dlBtn);
    container.appendChild(playerWrap);
  }

  // ── 5. Legend ─────────────────────────────────────────────────────────
  const legend = document.createElement('div');
  legend.className = 'new-analyzed-legend';
  legend.innerHTML =
    '<div class="legend-row">' +
      '<span class="legend-label">Scoring</span>' +
      Object.entries(BUCKET).map(([k, { label }]) => `<span class="word word-bucket-${k}">${label}</span>`).join('') +
      '<span class="pause-indicator">[pause]</span>' +
    '</div>' +
    '<div class="legend-row">' +
      '<span class="legend-label">Indicators</span>' +
      '<span class="word word-morph-root" style="background:#ffe0b2;color:#e65100;">Morph. Root</span>' +
      '<span class="word word-hesitation">Hesit.</span>' +
      '<span class="word-fragment">fragment</span>' +
    '</div>';
  container.appendChild(legend);

  // ── 6. Word flow ─────────────────────────────────────────────────────
  const wordsDiv = document.createElement('div');
  wordsDiv.className = 'new-analyzed-flow';

  // Helper: create click-to-play function for a transcriptWords index
  function makePlayFn(hypIdx) {
    if (!wordAudioEl || hypIdx < 0 || !transcriptWords?.[hypIdx]) return null;
    const tw = transcriptWords[hypIdx];
    const start = parseSttTime(tw.startTime);
    const end = parseSttTime(tw.endTime);
    return () => {
      wordAudioEl.pause();
      wordAudioEl.currentTime = start;
      const onTime = () => {
        if (wordAudioEl.currentTime >= end) { wordAudioEl.pause(); wordAudioEl.removeEventListener('timeupdate', onTime); }
      };
      wordAudioEl.addEventListener('timeupdate', onTime);
      wordAudioEl.play().catch(() => {});
    };
  }

  // Helper: format timestamp as "1.23s" or "1.23–1.87s"
  function fmtTs(startTime, endTime) {
    const s = parseSttTime(startTime);
    const e = parseSttTime(endTime);
    if (s <= 0 && e <= 0) return '';
    if (e <= 0) return s.toFixed(2) + 's';
    return s.toFixed(2) + '\u2013' + e.toFixed(2) + 's';
  }

  // Helper: get timestamp string for a transcriptWords index
  function getWordTs(hypIdx) {
    if (hypIdx < 0 || !transcriptWords?.[hypIdx]) return '';
    const tw = transcriptWords[hypIdx];
    return fmtTs(tw.startTime, tw.endTime);
  }

  // Helper: render a small insertion fragment span
  function renderFragment(parent, ins, extraClass) {
    const frag = document.createElement('span');
    frag.className = 'word-fragment' + (extraClass ? ' ' + extraClass : '');
    frag.textContent = ins.hyp;
    const fragTs = getWordTs(ins.hypIndex);
    frag.dataset.tooltip = `Insertion: "${ins.hyp}"` +
      (ins._partOfStruggle ? ' (part of struggle)' : '') +
      (ins._isSelfCorrection ? ' (self-correction)' : '') +
      (fragTs ? '\n' + fragTs : '');
    frag.style.cursor = 'pointer';
    const playFn = makePlayFn(ins.hypIndex);
    if (playFn) frag.classList.add('word-clickable');
    frag.addEventListener('click', (e) => { e.stopPropagation(); showWordTooltip(frag, playFn); });
    parent.appendChild(frag);
  }

  let refIdx = 0;
  for (const { entry, bucket, insertionsBefore, insertionsAfter } of classified) {
    // ── Long pause indicator ──
    if (pauseBeforeMap.has(entry.hypIndex)) {
      const pause = pauseBeforeMap.get(entry.hypIndex);
      const ps = document.createElement('span');
      ps.className = 'pause-indicator';
      if (pause._vadAnalysis?.speechPercent >= 30) ps.classList.add('pause-indicator-vad');
      ps.textContent = '[' + pause.gap.toFixed(1) + 's]';
      ps.dataset.tooltip = 'Long pause: ' + Math.round(pause.gap * 1000) + 'ms (error: \u2265 3000ms)';
      ps.style.cursor = 'pointer';
      ps.addEventListener('click', (e) => { e.stopPropagation(); showWordTooltip(ps, null); });
      wordsDiv.appendChild(ps);
      wordsDiv.appendChild(document.createTextNode(' '));
    }

    // ── Insertion fragments before (false starts) ──
    // Filter to visible fragments first
    const visibleInsBefore = insertionsBefore.filter(ins => {
      if (ins.hypIndex >= 0 && transcriptWords?.[ins.hypIndex]?._preWordArtifact) return false;
      if (ins.hypIndex >= 0 && transcriptWords?.[ins.hypIndex]?._postWordArtifact) return false;
      return true;
    });
    if (visibleInsBefore.length > 0) {
      // Add extra gap before fragments to separate from previous word
      wordsDiv.appendChild(document.createTextNode('\u2004'));  // three-per-em space
      for (const ins of visibleInsBefore) renderFragment(wordsDiv, ins);
      // No space between last fragment and main word — they belong together
    }

    // ── Main word span ──
    const span = document.createElement('span');
    span.className = `word word-bucket-${bucket}`;
    const displayText = entry._displayRef || entry.ref || '';
    span.textContent = displayText;

    // Cosmetic punctuation
    const punct = punctMap.get(refIdx);
    if (punct) span.textContent += punct;

    // Hesitation left border (same as legacy)
    const hesitation = (entry.hypIndex >= 0) ? onsetMap.get(entry.hypIndex) : null;
    if (hesitation) {
      span.classList.add('word-hesitation');
      if (hesitation._vadAnalysis?.speechPercent >= 30) span.classList.add('word-hesitation-vad');
    }

    // Morphological root squiggle: word is not correct + V1 or V0 produced a proper prefix of the ref
    if (bucket !== 'correct' && bucket !== 'struggle-correct' && bucket !== 'omitted') {
      const refN = norm(entry.ref);
      const hypN = norm(entry.hyp);
      const v0N = norm(entry._v0Word);
      const hasRoot = (w) => w.length >= 3 && w !== refN && refN.startsWith(w);
      if (hasRoot(hypN) || hasRoot(v0N)) span.classList.add('word-morph-root');
    }
    // Build per-engine evidence strings from raw attempt snapshots
    // _v1RawAttempt/_v0Attempt/_xvalAttempt capture full attempt (insertions + hyp)
    // before any downstream mutations. Fall back to single-word fields when no fragments.
    const v1Ev = entry._recovered ? '(omitted)'
      : entry._v1RawAttempt?.length > 0 ? entry._v1RawAttempt.join(' + ')
      : (entry.hyp || '\u2014');
    const v0Ev = entry._v0Attempt?.length > 0
      ? entry._v0Attempt.join(' + ')
      : (entry._v0Word || (entry._v0Type === 'omission' ? '(omitted)' : '\u2014'));
    const pkEv = entry._xvalAttempt?.length > 0
      ? entry._xvalAttempt.join(' + ')
      : (entry._xvalWord || '\u2014');

    // Tooltip
    const tip = [];
    tip.push(`"${displayText}" \u2014 ${BUCKET[bucket]?.label || bucket}`);
    tip.push(`V1: ${v1Ev} | V0: ${v0Ev} | Pk: ${pkEv}`);
    if (bucket === 'struggle-correct' && entry.compound) {
      tip.push(`V1 produced fragments: [${entry.parts?.join(', ')}]`);
    }
    if (bucket === 'struggle-correct' && insertionsBefore.length > 0) {
      tip.push(`False start: ${insertionsBefore.map(i => '"' + i.hyp + '"').join(', ')}`);
    }
    if (bucket === 'attempted-struggled') {
      if (entry.compound && entry.parts) {
        tip.push(`V1 produced fragments: [${entry.parts.join(', ')}] — scored as error`);
      } else {
        tip.push('Root detected, but full word not produced');
      }
    }
    if (bucket === 'definite-struggle') {
      tip.push('No engine produced the correct word');
    }
    if (bucket === 'confirmed-substitution') {
      tip.push(`Student said "${entry.hyp}" \u2014 all engines agree`);
    }
    if (hesitation) {
      tip.push(`Hesitation: ${Math.round(hesitation.gap * 1000)}ms before this word`);
      if (hesitation._vadOverhang) {
        const vh = hesitation._vadOverhang;
        tip.push(`VAD overhang: ${vh.overhangMs}ms (adjusted gap ${vh.adjustedGapMs}ms)`);
      }
      if (hesitation._vadAnalysis) {
        const va = hesitation._vadAnalysis;
        tip.push(`VAD: ${va.speechPercent}% speech (${va.label})`);
      }
    }
    if (pauseBeforeMap.has(entry.hypIndex)) {
      const p = pauseBeforeMap.get(entry.hypIndex);
      if (p._vadAnalysis) {
        tip.push(`VAD during pause: ${p._vadAnalysis.speechPercent}% speech (${p._vadAnalysis.label})`);
      }
    }
    // Timestamps in tooltip — use preserved per-engine fields, NOT tw.startTime (overwritten by Parakeet)
    const tw = (entry.hypIndex >= 0 && transcriptWords?.[entry.hypIndex]) ? transcriptWords[entry.hypIndex] : null;
    const v1Ts = tw ? fmtTs(tw._reverbStartTime, tw._reverbEndTime) : '';
    const xvalTs = tw ? fmtTs(tw._xvalStartTime, tw._xvalEndTime) : '';
    if (v1Ts) tip.push(`V1 time: ${v1Ts}`);
    if (xvalTs) tip.push(`Pk time: ${xvalTs}`);

    span.dataset.tooltip = tip.join('\n');
    span.style.cursor = 'pointer';

    // NL data for tooltip footer
    if (entry.nl) {
      const nlParts = [];
      const posLabel = POS_LABELS[entry.nl.pos] || entry.nl.pos;
      nlParts.push(posLabel);
      if (entry.nl.entityType && entry.nl.entityType !== 'OTHER') {
        nlParts.push('\ud83d\udccd ' + (ENTITY_LABELS[entry.nl.entityType] || entry.nl.entityType));
      }
      const tierLabel = TIER_LABELS[entry.nl.tier];
      if (tierLabel) nlParts.push('\ud83d\udcda ' + tierLabel);
      span.dataset.nl = '\ud83c\udf10 ' + nlParts.join(' \u00b7 ');
    }

    const playFn = makePlayFn(entry.hypIndex);
    if (playFn) span.classList.add('word-clickable');
    span.addEventListener('click', (e) => { e.stopPropagation(); showWordTooltip(span, playFn); });

    wordsDiv.appendChild(span);

    // ── Insertion fragments after (trailing fragments) ──
    const visibleInsAfter = insertionsAfter.filter(ins => {
      if (ins.hypIndex >= 0 && transcriptWords?.[ins.hypIndex]?._postWordArtifact) return false;
      return true;
    });
    for (const ins of visibleInsAfter) renderFragment(wordsDiv, ins, 'word-fragment-after');
    // Add extra gap after trailing fragments to separate from next word
    if (visibleInsAfter.length > 0) {
      wordsDiv.appendChild(document.createTextNode('\u2004'));  // three-per-em space
    }

    wordsDiv.appendChild(document.createTextNode(' '));
    refIdx++;
  }

  container.appendChild(wordsDiv);
}

export function displayAlignmentResults(alignment, wcpm, accuracy, sttLookup, diagnostics, transcriptWords, tierBreakdown, disfluencySummary, referenceText, audioBlob, rawSttSources) {
  const wordsDiv = document.getElementById('resultWords');
  const newWordsDiv = document.getElementById('newAnalyzedWords');
  const legacySection = document.getElementById('legacyAnalyzedSection');
  const plainDiv = document.getElementById('resultPlain');
  const jsonDiv = document.getElementById('resultJson');
  const prosodyContainer = document.getElementById('prosodyContainer');
  wordsDiv.innerHTML = ''; plainDiv.textContent = ''; jsonDiv.textContent = '';
  if (newWordsDiv) newWordsDiv.innerHTML = '';
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
    // Exception: single-letter parts join instead (e-mail → email).
    const splitForPunct = [];
    for (const token of mergedForPunct) {
      const stripped = token.replace(/^[^\w'-]+|[^\w'-]+$/g, '');
      if (stripped.includes('-')) {
        const parts = stripped.split('-').filter(p => p.length > 0);
        if (parts.some(p => p.length === 1)) {
          // Single-letter part (e-mail) → keep as one token (use original for punct)
          splitForPunct.push(token);
        } else {
          for (let j = 0; j < parts.length - 1; j++) splitForPunct.push(parts[j]);
          splitForPunct.push(token); // last part: use original token so punct regex works
        }
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
  const errParts = [];
  if (accuracy.wordErrors > 0) {
    errParts.push(accuracy.wordErrors + ' word error' + (accuracy.wordErrors !== 1 ? 's' : ''));
  }
  if (accuracy.omissions > 0) {
    errParts.push(accuracy.omissions + ' omission' + (accuracy.omissions !== 1 ? 's' : ''));
  }
  if (accuracy.longPauseErrors > 0) {
    errParts.push(accuracy.longPauseErrors + ' long pause' + (accuracy.longPauseErrors !== 1 ? 's' : ''));
  }
  if (accuracy.insertionErrors > 0) {
    errParts.push(accuracy.insertionErrors + ' insertion' + (accuracy.insertionErrors !== 1 ? 's' : ''));
  }
  errBox.innerHTML = '<span class="metric-label">' + (errParts.length > 0 ? errParts.join(', ') : 'No errors') + '</span>';
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

    // NL tier class
    if (item.nl) {
      span.classList.add('word-tier-' + item.nl.tier);
    }

    // Rate anomaly visual indicator (Phase 16)
    if (sttWord?._flags?.includes('rate_anomaly')) {
      span.classList.add('word-rate-anomaly');
    }

    // Morphological prefix break indicator
    if (sttWord?._debug?.morphologicalBreak) {
      span.classList.add('word-morphological');
      span.dataset.morphPrefix = sttWord._debug.morphologicalBreak.prefix;
    }

    // Compute extras for consolidated tooltip
    const currentHypIndex = (item.type !== 'omission') ? hypIndex : null;
    const hesitationDelay = (currentHypIndex !== null && onsetDelayMap.has(currentHypIndex))
      ? onsetDelayMap.get(currentHypIndex) : null;
    const morphKey = (item.ref || '').toLowerCase() + '|' + (item.hyp || '').toLowerCase();
    const morphData = (item.type === 'substitution' || item.type === 'struggle') && !item.forgiven
      ? morphErrorMap.get(morphKey) : null;

    // Build consolidated tooltip
    span.dataset.tooltip = buildEnhancedTooltip(item, sttWord, { hesitationDelay, morphData });

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

    // CSS class overlays (tooltip content handled by buildEnhancedTooltip)
    if (item.type === 'substitution' || item.type === 'struggle') {
      if (item.forgiven) {
        span.classList.add('word-forgiven');
      } else if (morphData) {
        span.classList.add('word-morphological');
      }
    }

    if (hesitationDelay) {
      span.classList.add('word-hesitation');
      if (hesitationDelay._vadAnalysis && hesitationDelay._vadAnalysis.speechPercent >= 30) {
        span.classList.add('word-hesitation-vad');
      }
    }

    if (sttWord?.isDisfluency) {
      span.classList.add('word-disfluency');
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
        if (queue[0]?._preWordArtifact) return false;
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
  // New Analyzed Words (experimental bucketing)
  // ─────────────────────────────────────────────────────────────────────────
  if (newWordsDiv) {
    renderNewAnalyzedWords(newWordsDiv, alignment, sttLookup, diagnostics, transcriptWords, referenceText, wordAudioEl, rawSttSources, audioBlob);
    newWordsDiv.style.display = '';
  }

  // Show legacy section (collapsed by default)
  if (legacySection) {
    legacySection.style.display = '';
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

    // ── STEP 0: Raw Engine Output (before any alignment) ──
    {
      const v1Raw = reverbVerbatim;
      const v0Raw = reverbClean;
      const pkRaw = xvalRaw;

      const { step, body } = makeStep(0, 'Raw Engine Output',
        'unprocessed word lists from each ASR engine \u2014 anchor words aligned across columns');

      if (v1Raw.length === 0 && v0Raw.length === 0 && pkRaw.length === 0) {
        const msg = document.createElement('div');
        msg.className = 'pipeline-step-summary';
        msg.textContent = 'No raw engine data available';
        body.appendChild(msg);
      } else {
        // Normalize word for anchor matching only (display stays raw)
        const normW = w => (w.word || '').toLowerCase().replace(/[^a-z]/g, '');

        // Standard LCS with position tracking (DP)
        const lcsPos = (a, b) => {
          const m = a.length, n = b.length;
          const dp = [];
          for (let i = 0; i <= m; i++) { dp[i] = new Uint16Array(n + 1); }
          for (let i = 1; i <= m; i++)
            for (let j = 1; j <= n; j++)
              dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
          const result = [];
          let i = m, j = n;
          while (i > 0 && j > 0) {
            if (a[i - 1] === b[j - 1]) { result.unshift({ word: a[i - 1], posA: i - 1, posB: j - 1 }); i--; j--; }
            else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
            else j--;
          }
          return result;
        };

        // Find 3-way anchors via pairwise LCS: LCS(V1,Pk) → LCS(result,V0)
        const v1n = v1Raw.map(normW), v0n = v0Raw.map(normW), pkn = pkRaw.map(normW);
        let anchors = [];
        if (v1n.length > 0 && pkn.length > 0 && v0n.length > 0) {
          const lcs_v1pk = lcsPos(v1n, pkn);
          const lcs_all = lcsPos(lcs_v1pk.map(a => a.word), v0n);
          anchors = lcs_all.map(a => ({
            v1: lcs_v1pk[a.posA].posA, v0: a.posB, pk: lcs_v1pk[a.posA].posB
          }));
        } else if (v1n.length > 0 && pkn.length > 0) {
          anchors = lcsPos(v1n, pkn).map(a => ({ v1: a.posA, v0: -1, pk: a.posB }));
        } else if (v1n.length > 0 && v0n.length > 0) {
          anchors = lcsPos(v1n, v0n).map(a => ({ v1: a.posA, v0: a.posB, pk: -1 }));
        }

        // Build table
        const table = document.createElement('table');
        table.className = 'pipeline-table pipeline-raw-table';
        const thead = document.createElement('thead');
        const hRow = document.createElement('tr');
        for (const h of ['#', 'V1 (Verbatim)', 'V0 (Clean)', 'Parakeet']) {
          const th = document.createElement('th'); th.textContent = h; hRow.appendChild(th);
        }
        thead.appendChild(hRow);
        table.appendChild(thead);
        const tbody = document.createElement('tbody');

        // Format timestamp from raw word object (3 decimal places)
        const fmtTs = w => {
          const s = parseSttTime(w.start || w.startTime);
          const e = parseSttTime(w.end || w.endTime);
          if (s <= 0 && e <= 0) return '';
          return s.toFixed(3) + '\u2013' + e.toFixed(3) + 's';
        };

        // Create cell for a raw word with optional click-to-play
        const rawCell = (w, isAnchor) => {
          const td = document.createElement('td');
          if (!w) { td.className = 'pipeline-raw-empty'; return td; }
          td.className = isAnchor ? 'pipeline-raw-anchor' : 'pipeline-raw-nonanchor';
          const wordEl = document.createElement('span');
          wordEl.className = 'pipeline-raw-word';
          wordEl.textContent = w.word;
          td.appendChild(wordEl);
          const tsEl = document.createElement('span');
          tsEl.className = 'pipeline-raw-ts';
          tsEl.textContent = fmtTs(w);
          td.appendChild(tsEl);
          if (wordAudioEl) {
            const start = parseSttTime(w.start || w.startTime);
            const end = parseSttTime(w.end || w.endTime);
            if (start > 0) {
              td.classList.add('word-clickable');
              td.addEventListener('click', (ev) => {
                ev.stopPropagation();
                wordAudioEl.pause();
                wordAudioEl.currentTime = start;
                const onTime = () => { if (wordAudioEl.currentTime >= end) { wordAudioEl.pause(); wordAudioEl.removeEventListener('timeupdate', onTime); } };
                wordAudioEl.addEventListener('timeupdate', onTime);
                wordAudioEl.play().catch(() => {});
              });
            }
          }
          return td;
        };

        let prevV1 = -1, prevV0 = -1, prevPk = -1, anchorNum = 0;

        // Render gap rows (non-anchor words between two anchors)
        const addGapRows = (v1End, v0End, pkEnd) => {
          const v1Gap = v1End > prevV1 + 1 ? v1Raw.slice(prevV1 + 1, v1End) : [];
          const v0Gap = v0End > prevV0 + 1 ? v0Raw.slice(prevV0 + 1, v0End) : [];
          const pkGap = pkEnd > prevPk + 1 ? pkRaw.slice(prevPk + 1, pkEnd) : [];
          const maxGap = Math.max(v1Gap.length, v0Gap.length, pkGap.length);
          for (let g = 0; g < maxGap; g++) {
            const tr = document.createElement('tr');
            tr.className = 'pipeline-raw-gap-row';
            const tdIdx = document.createElement('td');
            tdIdx.className = 'pipeline-td-idx';
            tr.appendChild(tdIdx);
            tr.appendChild(rawCell(v1Gap[g] || null, false));
            tr.appendChild(rawCell(v0Gap[g] || null, false));
            tr.appendChild(rawCell(pkGap[g] || null, false));
            tbody.appendChild(tr);
          }
        };

        for (const anchor of anchors) {
          const v0End = anchor.v0 >= 0 ? anchor.v0 : prevV0 + 1;
          const pkEnd = anchor.pk >= 0 ? anchor.pk : prevPk + 1;
          addGapRows(anchor.v1, v0End, pkEnd);
          anchorNum++;
          const tr = document.createElement('tr');
          tr.className = 'pipeline-raw-anchor-row';
          const tdIdx = document.createElement('td');
          tdIdx.className = 'pipeline-td-idx';
          tdIdx.textContent = anchorNum;
          tr.appendChild(tdIdx);
          tr.appendChild(rawCell(v1Raw[anchor.v1], true));
          tr.appendChild(rawCell(anchor.v0 >= 0 ? v0Raw[anchor.v0] : null, true));
          tr.appendChild(rawCell(anchor.pk >= 0 ? pkRaw[anchor.pk] : null, true));
          tbody.appendChild(tr);
          prevV1 = anchor.v1;
          if (anchor.v0 >= 0) prevV0 = anchor.v0;
          if (anchor.pk >= 0) prevPk = anchor.pk;
        }

        // Trailing words after last anchor
        addGapRows(v1Raw.length, v0Raw.length, pkRaw.length);

        table.appendChild(tbody);
        body.appendChild(table);

        const summary = document.createElement('div');
        summary.className = 'pipeline-step-summary';
        summary.textContent = 'V1: ' + v1Raw.length + ' words | V0: ' + v0Raw.length + ' words | Pk: ' + pkRaw.length + ' words | Anchors: ' + anchors.length;
        body.appendChild(summary);
      }

      confWordsDiv.appendChild(step);
    }

    // ── STEP 1: Three-Engine Consensus (with insertion context) ──
    {
      const v0Align = rawSttSources?.v0Alignment || [];
      const pkAlign = rawSttSources?.parakeetAlignment || [];
      const twTable = rawSttSources?.threeWayTable || [];
      const v0Ref = v0Align.filter(e => e.type !== 'insertion');
      const fullV1 = alignment; // includes insertions in NW position

      // Group insertions by ref-word boundary for each engine
      // groups[i] = insertions that appear before ref word i in the NW alignment
      // groups[N] = trailing insertions after the last ref word
      const groupInsertions = (fullAlign) => {
        const groups = [];
        let current = [];
        for (const entry of fullAlign) {
          if (entry.type === 'insertion') {
            current.push(entry);
          } else {
            groups.push(current);
            current = [];
          }
        }
        groups.push(current); // trailing
        return groups;
      };

      const v1InsGroups = groupInsertions(fullV1);
      const v0InsGroups = groupInsertions(v0Align);
      const pkInsGroups = groupInsertions(pkAlign);

      const { step, body } = makeStep(1, 'Three-Engine Consensus',
        'per-reference-word comparison of V1 (verbatim), V0 (clean), and Parakeet — with insertion fragments');

      if (twTable.length === 0) {
        const msg = document.createElement('div');
        msg.className = 'pipeline-step-summary';
        msg.textContent = 'No three-way alignment data available';
        body.appendChild(msg);
      } else {
        const table = document.createElement('table');
        table.className = 'pipeline-table';

        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        for (const hdr of ['#', 'Reference', 'V1 (Verbatim)', 'V0 (Clean)', 'Parakeet', 'Verdict']) {
          const th = document.createElement('th');
          th.textContent = hdr;
          headRow.appendChild(th);
        }
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        let confirmedN = 0, disagreedN = 0, recoveredN = 0, unconfirmedN = 0, omittedN = 0;

        // Engine cell helper for ref-word rows
        const makeEngineCell = (entry, twSymbol) => {
          const td = document.createElement('td');
          if (!entry || twSymbol === 'n/a') {
            td.className = 'engine-unavailable';
            td.textContent = 'n/a';
          } else if (entry._recovered) {
            // Recovery overwrites V1 alignment entry with Parakeet's word —
            // show that V1 actually heard nothing (only Parakeet recovered it)
            td.className = 'engine-omit';
            td.textContent = '\u2014 (recovered)';
          } else if (entry.type === 'omission') {
            td.className = 'engine-omit';
            td.textContent = '\u2014';
          } else if (entry.compound && entry.parts) {
            td.className = 'engine-compound';
            td.textContent = entry.parts.join(' + ');
          } else if (entry.type === 'correct' || entry.type === 'struggle') {
            td.className = 'engine-correct';
            td.textContent = entry.hyp;
          } else {
            td.className = 'engine-sub';
            td.textContent = entry.hyp || '?';
          }
          return td;
        };

        // Render insertion sub-rows for a given ref-word position
        const renderInsertionRows = (refIdx) => {
          const v1Ins = v1InsGroups[refIdx] || [];
          if (v1Ins.length === 0) return;

          const v0Ins = v0InsGroups[refIdx] || [];
          const pkIns = pkInsGroups[refIdx] || [];

          // Build sets of V0/Pk insertion words at this position for cross-reference
          const v0InsNorms = v0Ins.map(e => (e.hyp || '').toLowerCase().replace(/[^a-z'-]/g, ''));
          const pkInsNorms = pkIns.map(e => (e.hyp || '').toLowerCase().replace(/[^a-z'-]/g, ''));

          for (const ins of v1Ins) {
            const tr = document.createElement('tr');
            tr.className = 'pipeline-insertion-row';

            // # column — arrow to show it's a sub-row
            const tdIdx = document.createElement('td');
            tdIdx.className = 'pipeline-td-idx pipeline-ins-idx';
            tdIdx.textContent = '\u21b3'; // ↳
            tr.appendChild(tdIdx);

            // Reference column — no ref word
            const tdRef = document.createElement('td');
            tdRef.className = 'pipeline-td-ref pipeline-ins-ref';
            tdRef.textContent = '\u2014';
            tr.appendChild(tdRef);

            // V1 column — the insertion word
            const tdV1 = document.createElement('td');
            tdV1.className = 'engine-ins';
            tdV1.textContent = ins.hyp || '?';
            tr.appendChild(tdV1);

            // V0 column — check if V0 also heard this word at this position
            const insNorm = (ins.hyp || '').toLowerCase().replace(/[^a-z'-]/g, '');
            const tdV0 = document.createElement('td');
            const v0Match = v0InsNorms.findIndex(n => n === insNorm);
            if (v0Match >= 0) {
              tdV0.className = 'engine-ins';
              tdV0.textContent = v0Ins[v0Match].hyp;
              v0InsNorms[v0Match] = ''; // consume to avoid double-match
            } else if (v0Ins.length > 0) {
              // V0 has insertions here but different words
              tdV0.className = 'engine-ins-different';
              tdV0.textContent = v0Ins.map(e => e.hyp).join(', ');
            } else {
              tdV0.className = 'engine-ins-suppressed';
              tdV0.textContent = 'suppressed';
            }
            tr.appendChild(tdV0);

            // Pk column — check if Parakeet also heard this word
            const tdPk = document.createElement('td');
            const pkMatch = pkInsNorms.findIndex(n => n === insNorm);
            if (pkMatch >= 0) {
              tdPk.className = 'engine-ins';
              tdPk.textContent = pkIns[pkMatch].hyp;
              pkInsNorms[pkMatch] = ''; // consume
            } else if (pkIns.length > 0) {
              tdPk.className = 'engine-ins-different';
              tdPk.textContent = pkIns.map(e => e.hyp).join(', ');
            } else {
              tdPk.className = 'engine-ins-suppressed';
              tdPk.textContent = '\u2014';
            }
            tr.appendChild(tdPk);

            // Verdict column — insertion classification
            const tdV = document.createElement('td');
            tdV.className = 'pipeline-verdict pipeline-verdict-insertion';
            const tw = ins.hypIndex >= 0 ? transcriptWords[ins.hypIndex] : null;
            let label = 'insertion';
            if (ins._partOfStruggle) label = 'struggle fragment';
            else if (ins._isSelfCorrection) label = 'self-correction';
            else if (tw?.isDisfluency) label = tw.disfluencyType || 'disfluency';
            else if (v0Match < 0 && v0Align.length > 0) label = 'insertion (V0 suppressed)';
            tdV.textContent = label;
            tr.appendChild(tdV);

            tbody.appendChild(tr);
          }
        };

        for (let i = 0; i < twTable.length; i++) {
          const tw = twTable[i];
          const v1E = reverbRef[i];
          const v0E = v0Ref[i];
          const pkE = parakeetRef[i];

          if (tw.status === 'confirmed') confirmedN++;
          else if (tw.status === 'disagreed') disagreedN++;
          else if (tw.status === 'recovered') recoveredN++;
          else if (tw.status === 'unconfirmed') unconfirmedN++;
          else if (tw.status === 'confirmed_omission') omittedN++;

          // Render V1 insertions that appear before this ref word
          renderInsertionRows(i);

          // Render the ref-word row
          const tr = document.createElement('tr');
          tr.className = 'pipeline-xval-' + (tw.status === 'confirmed_omission' ? 'confirmed' : tw.status);

          const tdIdx = document.createElement('td');
          tdIdx.className = 'pipeline-td-idx';
          tdIdx.textContent = i + 1;
          tr.appendChild(tdIdx);

          const tdRef = document.createElement('td');
          tdRef.className = 'pipeline-td-ref';
          tdRef.textContent = tw.ref || '?';
          tr.appendChild(tdRef);

          tr.appendChild(makeEngineCell(v1E, tw.v1));
          tr.appendChild(makeEngineCell(v0E, tw.v0));
          tr.appendChild(makeEngineCell(pkE, tw.pk));

          const tdV = document.createElement('td');
          const verdictSymbols = {
            confirmed: '\u2713', disagreed: '\u2717', recovered: '\u21bb',
            unconfirmed: '?', confirmed_omission: '\u2014'
          };
          const verdictLabels = {
            confirmed: 'confirmed', disagreed: 'disagreed', recovered: 'recovered',
            unconfirmed: 'unconfirmed', confirmed_omission: 'omitted'
          };
          const verdictCls = tw.status === 'confirmed_omission' ? 'pipeline-verdict-omission' : 'pipeline-verdict-' + tw.status;
          tdV.className = 'pipeline-verdict ' + verdictCls;
          tdV.textContent = (verdictSymbols[tw.status] || '\u00b7') + ' ' + (verdictLabels[tw.status] || tw.status);
          tr.appendChild(tdV);

          tbody.appendChild(tr);
        }

        // Trailing insertions after last ref word
        renderInsertionRows(twTable.length);

        table.appendChild(tbody);
        body.appendChild(table);

        const insertionCount = v1InsGroups.reduce((sum, g) => sum + g.length, 0);
        const summary = document.createElement('div');
        summary.className = 'pipeline-step-summary';
        summary.textContent = 'Confirmed: ' + confirmedN + ' | Disagreed: ' + disagreedN
          + ' | Recovered: ' + recoveredN + ' | Unconfirmed: ' + unconfirmedN
          + ' | Omitted: ' + omittedN
          + ' | Insertions: ' + insertionCount;
        const agreePct = twTable.length > 0 ? (100 * confirmedN / twTable.length).toFixed(0) : '0';
        summary.textContent += ' | Agreement: ' + agreePct + '%';
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
          } else if (e.type === 'correct' || (e.type === 'struggle' && e.compound)) {
            tdHyp.textContent = e.hyp;
            tdHyp.className = 'pipeline-td-correct';
          } else {
            tdHyp.textContent = e.hyp || '?';
            tdHyp.className = 'pipeline-td-sub';
          }
          // Show compound merge fragments
          if (e.compound && e.parts && e.parts.length > 1) {
            const fragSpan = document.createElement('div');
            fragSpan.className = 'pipeline-v2-fragments';
            fragSpan.textContent = '\u2190 ' + e.parts.join(' + ');
            tdHyp.appendChild(fragSpan);
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

      const v0AlignFull = rawSttSources?.v0Alignment || [];
      const v0RefStep2 = v0AlignFull.filter(e => e.type !== 'insertion');
      const v0InsStep2 = v0AlignFull.filter(e => e.type === 'insertion');

      if (reverbRef.length > 0) {
        // Reverb V1 (verbatim) vs Reference (primary — shown first)
        body.appendChild(buildAlignTable('Reverb V1 (verbatim)', reverbRef, reverbIns, 'reverb'));

        // Reverb V0 (clean) vs Reference
        if (v0RefStep2.length > 0) {
          body.appendChild(buildAlignTable('Reverb V0 (clean)', v0RefStep2, v0InsStep2, 'v0'));
        } else {
          const msg = document.createElement('div');
          msg.className = 'pipeline-step-summary';
          msg.textContent = 'No V0 (clean) alignment data available';
          body.appendChild(msg);
        }

        // Parakeet vs Reference
        if (parakeetRef.length > 0) {
          body.appendChild(buildAlignTable('Parakeet', parakeetRef, parakeetIns, 'parakeet'));
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

    // ── STEP 3: Post-Processing ──
    {
      const { step, body } = makeStep(3, 'Post-Processing',
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

      const preWordArtifacts = (transcriptWords || []).filter(w => w._preWordArtifact);
      if (preWordArtifacts.length > 0) {
        lists.push({
          label: 'Pre-Word Artifacts (' + preWordArtifacts.length + ')',
          cls: 'pipeline-pp-artifact',
          items: preWordArtifacts.map(w => '"' + w.word + '" (' + Math.round((parseSttTime(w.endTime) - parseSttTime(w.startTime)) * 1000) + 'ms, before first word)')
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

    // ── STEP 4: Final Scored Alignment ──
    {
      const { step, body } = makeStep(4, 'Final Scored Alignment',
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

  // ── Enrich disfluencies with alignment context ──
  for (const d of disfluencies) {
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
    } else {
      const label = typeLabels[d.type] || 'extra word';
      typeSpan.textContent = label;
      typeSpan.classList.add(`disfluency-meta-${d.type}`);
    }
    meta.appendChild(typeSpan);

    // Enrichment note
    let noteText = '';
    if (!d.selfCorrection && d.refTarget) {
      noteText = `\u2192 ${d.refTarget}`;
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

  // Duration line with phoneme count
  if (w.durationMs != null) {
    const countsStr = w.phonemes != null ? `${w.phonemes} ph` : '';
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
