/**
 * AI Insight Engine — generates a 3-4 sentence reading summary via Gemini 2.5 Flash.
 *
 * Pass 0: buildInsightPayload() pre-computes patterns in JS.
 * Pass 1: generateInsight() sends a single LLM call.
 * Render:  renderInsightPanel() shows loading → result in the UI.
 */

import { countSyllables } from './syllable-counter.js';

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ─── Pass 0: Pre-compute patterns ──────────────────────────────────────────

/**
 * Filters alignment down to "interesting" words and detects mechanical patterns.
 */
export function buildInsightPayload(alignment, wcpm, accuracy, diagnostics, referenceText) {
  const wordSpeed = diagnostics?.wordSpeed;
  const prosody = diagnostics?.prosody;

  // Build word speed lookup by refIndex
  const speedByRef = new Map();
  if (wordSpeed && !wordSpeed.insufficient) {
    for (const w of wordSpeed.words) {
      speedByRef.set(w.refIndex, w);
    }
  }

  // Collect interesting words (non-insertion entries only)
  const interestingWords = [];
  let refIdx = 0;
  for (const entry of alignment) {
    if (entry.type === 'insertion') continue;

    const speed = speedByRef.get(refIdx);
    const isInteresting =
      entry._isStruggle ||
      (entry.type === 'substitution' && !entry.forgiven) ||
      (entry.type === 'omission' && !entry.forgiven) ||
      entry._isSelfCorrection || entry._selfCorrected ||
      (speed && (speed.tier === 'stalled' || speed.tier === 'struggling')) ||
      (speed && speed.ratio > 2.5) ||
      entry._notAttempted ||
      entry.forgiven;

    if (isInteresting) {
      const word = {
        ref: entry._displayRef || entry.ref,
        heard: entry.hyp || null,
        type: entry.type,
        struggle: !!entry._isStruggle,
        selfCorrected: !!(entry._isSelfCorrection || entry._selfCorrected),
        tier: speed?.tier || null,
        paceRatio: speed?.ratio || null,
        forgiven: !!entry.forgiven,
        forgivenReason: null,
        notAttempted: !!entry._notAttempted
      };
      if (entry._inflectionalVariant) word.forgivenReason = 'inflectional (' + entry._inflectionalSuffix + ')';
      else if (entry._forgivenEvidence) word.forgivenReason = 'proper noun';
      else if (entry._pkTrustOverride) word.forgivenReason = 'Parakeet override';
      if (entry._nearMissEvidence) word.evidence = entry._nearMissEvidence;
      interestingWords.push(word);
    }
    refIdx++;
  }

  // Aggregate pattern data
  const refEntries = alignment.filter(e => e.type !== 'insertion');
  const struggles = refEntries.filter(e => e._isStruggle);
  const selfCorrections = refEntries.filter(e => e._isSelfCorrection || e._selfCorrected);
  const omissions = refEntries.filter(e => e.type === 'omission' && !e.forgiven && !e._notAttempted);
  const notAttempted = refEntries.filter(e => e._notAttempted);

  // Multisyllabic difficulty detection
  const multiRef = refEntries.filter(e => !e._notAttempted && countSyllables(e.ref || '') >= 3);
  const multiStruggled = multiRef.filter(e => e._isStruggle || (e.type === 'substitution' && !e.forgiven) || (e.type === 'omission' && !e.forgiven));
  const multiSucceeded = multiRef.filter(e => e.type === 'correct' && !e._isStruggle);

  // First-syllable-then-abandon detection
  const abandonExamples = [];
  for (const e of refEntries) {
    if (e.type === 'substitution' && !e.forgiven && e.hyp && e.ref) {
      const refLower = e.ref.toLowerCase();
      const hypLower = e.hyp.toLowerCase();
      if (refLower.length >= 5 && hypLower.length >= 2 && hypLower.length < refLower.length * 0.6 && refLower.startsWith(hypLower)) {
        abandonExamples.push({ ref: e._displayRef || e.ref, heard: e.hyp });
      }
    }
  }

  // Reading pattern from prosody
  const readingPattern = prosody?.phrasing?.readingPattern?.classification || null;
  const atPacePercent = wordSpeed?.atPacePercent ?? null;

  // Stalled words
  const stalledWords = [];
  if (wordSpeed && !wordSpeed.insufficient) {
    for (const w of wordSpeed.words) {
      if (w.tier === 'stalled') stalledWords.push(w.refWord);
    }
  }

  return {
    totalWords: accuracy.totalRefWords,
    wordsCorrect: accuracy.correctCount,
    accuracy: accuracy.accuracy,
    wcpm: wcpm?.wcpmMin ?? wcpm?.wcpm ?? null,
    wcpmRange: wcpm?.wcpmMax ? [wcpm.wcpmMin, wcpm.wcpmMax] : null,

    struggles: { count: struggles.length, words: struggles.map(e => e._displayRef || e.ref) },
    selfCorrections: { count: selfCorrections.length, words: selfCorrections.map(e => e._displayRef || e.ref) },
    omissions: { count: omissions.length, words: omissions.map(e => e._displayRef || e.ref) },
    notAttempted: {
      count: notAttempted.length,
      fromWord: notAttempted.length > 0 ? (notAttempted[0]._displayRef || notAttempted[0].ref) : null
    },

    readingPattern,
    atPacePercent,
    stalledWords,

    multisyllabicDifficulty: multiRef.length > 0 ? {
      struggled: multiStruggled.length,
      total: multiRef.length,
      words: multiStruggled.map(e => e._displayRef || e.ref),
      succeeded: multiSucceeded.map(e => e._displayRef || e.ref).slice(0, 5)
    } : null,

    firstSyllableThenAbandon: abandonExamples.length > 0 ? {
      count: abandonExamples.length,
      examples: abandonExamples.slice(0, 4)
    } : null,

    interestingWords
  };
}

// ─── Pass 1: LLM call ──────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are summarizing a 60-second oral reading fluency assessment for a teacher.
Write 3-4 sentences describing how the student read. Be specific — cite actual words.

Rules:
- ONLY describe patterns that appear in the data below. Do NOT invent or infer anything not explicitly listed.
- If the data does not mention the student stopped reading early, do NOT claim they did.
- Every claim must reference specific words from the data.
- Quantify: "4 of 6 multisyllabic words" not "many words."
- Note strengths (self-corrections, steady pace on some words) alongside difficulties.
- Do NOT write generic advice like "the student needs more practice."
- Do NOT restate numbers the teacher can already see (WCPM, accuracy %).
- Focus on PATTERNS: what types of words caused trouble? What did the student do when stuck?
- Write like a reading specialist's brief note — direct, warm, specific.
- Use the student's name naturally if provided.`;

function buildUserPrompt(payload, studentName, passageSnippet, readabilityInfo) {
  const lines = [];

  lines.push(`Student: ${studentName || 'This student'}`);
  if (passageSnippet) {
    let passageDesc = `Passage: "${passageSnippet}..."`;
    if (readabilityInfo) passageDesc += ` (${readabilityInfo})`;
    lines.push(passageDesc);
  }
  lines.push(`WCPM: ${payload.wcpm ?? '?'} | Accuracy: ${payload.accuracy}% | Self-corrections: ${payload.selfCorrections.count}`);
  lines.push('');

  // Patterns
  lines.push('Patterns detected:');
  if (payload.struggles.count > 0) {
    lines.push(`- Struggled on ${payload.struggles.count} words: ${payload.struggles.words.join(', ')}`);
  }
  if (payload.selfCorrections.count > 0) {
    lines.push(`- Self-corrected ${payload.selfCorrections.count} words: ${payload.selfCorrections.words.join(', ')}`);
  }
  if (payload.omissions.count > 0) {
    lines.push(`- Omitted ${payload.omissions.count} words: ${payload.omissions.words.join(', ')}`);
  }
  if (payload.notAttempted.count > 0) {
    lines.push(`- Stopped reading after "${payload.notAttempted.fromWord}" with ${payload.notAttempted.count} words remaining`);
  }
  if (payload.multisyllabicDifficulty) {
    const m = payload.multisyllabicDifficulty;
    lines.push(`- Multisyllabic: struggled on ${m.struggled} of ${m.total} (${m.words.join(', ')})`);
    if (m.succeeded.length > 0) lines.push(`  Succeeded on: ${m.succeeded.join(', ')}`);
  }
  if (payload.firstSyllableThenAbandon) {
    const f = payload.firstSyllableThenAbandon;
    lines.push(`- First-syllable-then-stop pattern (${f.count}x): ${f.examples.map(e => `"${e.ref}" → "${e.heard}"`).join(', ')}`);
  }
  if (payload.readingPattern) {
    lines.push(`- Reading pattern: ${payload.readingPattern}`);
  }
  if (payload.atPacePercent != null) {
    lines.push(`- ${payload.atPacePercent}% of words read at steady pace`);
  }
  if (payload.stalledWords.length > 0) {
    lines.push(`- Stalled on: ${payload.stalledWords.join(', ')}`);
  }

  // Interesting words table
  const tableWords = payload.interestingWords.filter(w => !w.notAttempted);
  if (tableWords.length > 0) {
    lines.push('');
    lines.push('Words of interest:');
    lines.push('ref | heard | type | pace | notes');
    lines.push('--- | ----- | ---- | ---- | -----');
    for (const w of tableWords.slice(0, 25)) {
      const notes = [];
      if (w.struggle) notes.push('struggle');
      if (w.selfCorrected) notes.push('self-corrected');
      if (w.forgiven) notes.push('forgiven: ' + (w.forgivenReason || 'yes'));
      if (w.evidence) notes.push('attempts: ' + w.evidence.join('+'));
      lines.push(`${w.ref} | ${w.heard || '—'} | ${w.type} | ${w.tier || '—'} | ${notes.join('; ') || '—'}`);
    }
  }

  return lines.join('\n');
}

/**
 * Calls Gemini 2.5 Flash to generate a reading insight.
 * @returns {Promise<string>} The narrative paragraph.
 */
export async function generateInsight(payload, apiKey, { studentName, passageSnippet, readabilityInfo } = {}) {
  const userPrompt = buildUserPrompt(payload, studentName, passageSnippet, readabilityInfo);
  console.log('[insight] Prompt sent to Gemini:\n' + userPrompt);

  const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2048
      }
    })
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Gemini API error: ${response.status} ${errBody.slice(0, 200)}`);
  }

  const data = await response.json();
  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked: ${data.promptFeedback.blockReason}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response from Gemini');
  return text.trim();
}

// ─── Render ─────────────────────────────────────────────────────────────────

/**
 * Renders the insight panel into the given container.
 * @param {HTMLElement} container
 * @param {string|null} text - The insight text, or null to hide/show loading.
 * @param {boolean} isLoading
 */
export function renderInsightPanel(container, text, isLoading) {
  if (!container) return;

  // Hide on error (text=null, isLoading=false)
  if (!text && !isLoading) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  container.style.display = '';
  container.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'insight-card';

  const header = document.createElement('div');
  header.className = 'insight-header';
  header.innerHTML = '<h4>AI Reading Summary</h4>';

  if (isLoading) {
    const spinner = document.createElement('span');
    spinner.className = 'insight-spinner';
    spinner.textContent = '...';
    header.appendChild(spinner);
  }

  card.appendChild(header);

  if (text) {
    const body = document.createElement('div');
    body.className = 'insight-body';
    body.textContent = text;
    card.appendChild(body);
    // Fade in
    requestAnimationFrame(() => card.classList.add('insight-visible'));
  }

  container.appendChild(card);
}
