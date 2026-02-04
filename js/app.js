import { initRecorder, setOnComplete as recorderSetOnComplete } from './recorder.js';
import { initFileHandler, setOnComplete as fileHandlerSetOnComplete } from './file-handler.js';
import { sendToSTT, sendToAsyncSTT, sendChunkedSTT, sendEnsembleSTT } from './stt-api.js';
import { mergeEnsembleResults, extractWordsFromSTT, computeEnsembleStats } from './ensemble-merger.js';
import { alignWords } from './alignment.js';
import { getCanonical } from './word-equivalences.js';
import { computeWCPM, computeAccuracy, computeWCPMRange } from './metrics.js';
import { setStatus, displayResults, displayAlignmentResults, showAudioPlayback, renderStudentSelector, renderHistory } from './ui.js';
import { runDiagnostics, computeTierBreakdown } from './diagnostics.js';
import { extractTextFromImage } from './ocr-api.js';
import { trimPassageToAttempted } from './passage-trimmer.js';
import { analyzePassageText, levenshteinRatio } from './nl-api.js';
import { getStudents, addStudent, deleteStudent, saveAssessment, getAssessments } from './storage.js';
import { saveAudioBlob } from './audio-store.js';
import { initDashboard } from './dashboard.js';
import { initDebugLog, addStage, addWarning, addError, finalizeDebugLog, saveDebugLog } from './debug-logger.js';
import { vadProcessor } from './vad-processor.js';
import { flagGhostWords } from './ghost-detector.js';
import { classifyAllWords, filterGhosts, computeClassificationStats } from './confidence-classifier.js';
import { detectDisfluencies } from './disfluency-detector.js';
import { applySafetyChecks } from './safety-checker.js';

// Code version for cache verification
const CODE_VERSION = 'v34-2026-02-03';
console.log('[ORF] Code version:', CODE_VERSION);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(reg => console.log('SW registered:', reg.scope))
    .catch(err => console.warn('SW registration failed:', err));
}

// --- App state ---
const appState = {
  audioBlob: null,
  audioEncoding: null,
  elapsedSeconds: null,
  referenceIsFromOCR: false,
  selectedStudentId: null
};

const analyzeBtn = document.getElementById('analyzeBtn');

function updateAnalyzeBtn() {
  analyzeBtn.disabled = !appState.audioBlob;
}

function showPlaybackButton(studentId, assessmentId) {
  // Remove any existing playback button / theme selector
  const existing = document.getElementById('playbackAdventureBtn');
  if (existing) existing.remove();
  const existingSel = document.getElementById('playbackThemeSelect');
  if (existingSel) existingSel.remove();

  const btn = document.createElement('button');
  btn.id = 'playbackAdventureBtn';
  btn.textContent = 'Watch Your Reading Adventure!';
  btn.style.cssText = 'margin:0.5rem 0;padding:0.6rem 1.2rem;background:#7b1fa2;color:#fff;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer;';
  btn.addEventListener('click', () => {
    localStorage.setItem('orf_playback_student', studentId);
    localStorage.setItem('orf_playback_assessment', assessmentId);
    const base = window.location.href.replace(/[^/]*$/, '');
    const url = base + 'playback.html';
    window.open(url, 'orf_playback', 'width=900,height=700');
  });

  // Theme dropdown
  const sel = document.createElement('select');
  sel.id = 'playbackThemeSelect';
  sel.style.cssText = 'margin:0.5rem 0 0.5rem 0.5rem;padding:0.5rem 0.8rem;border-radius:8px;border:1px solid #666;background:#2a2a2a;color:#fff;font-size:0.9rem;cursor:pointer;';
  const themes = [['cyber', 'Cyber'], ['glitch', 'Glitch']];
  const saved = localStorage.getItem('orf_playback_theme') || 'cyber';
  for (const [val, label] of themes) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = label;
    if (val === saved) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => {
    localStorage.setItem('orf_playback_theme', sel.value);
  });

  // Insert after analyze button
  analyzeBtn.parentNode.insertBefore(btn, analyzeBtn.nextSibling);
  btn.insertAdjacentElement('afterend', sel);
}

function refreshStudentUI() {
  renderStudentSelector(getStudents(), appState.selectedStudentId);
  if (appState.selectedStudentId) {
    renderHistory(getAssessments(appState.selectedStudentId));
  } else {
    renderHistory(null);
  }
}

async function runAnalysis() {
  // Initialize debug logging for this assessment
  initDebugLog();
  addStage('start', { codeVersion: CODE_VERSION, timestamp: new Date().toISOString() });

  if (!appState.audioBlob) {
    setStatus('No audio recorded or uploaded.');
    return;
  }

  analyzeBtn.disabled = true;

  let data;
  if (appState.elapsedSeconds != null && appState.elapsedSeconds > 55) {
    setStatus('Processing long recording via async STT...');
    try {
      data = await sendToAsyncSTT(appState.audioBlob, appState.audioEncoding, (pct) => {
        setStatus(`Processing long recording... ${pct}%`);
      });
    } catch (err) {
      if (err.code === 'INLINE_REJECTED') {
        setStatus('Async STT unavailable for inline audio. Using chunked processing...');
        data = await sendChunkedSTT(appState.audioBlob, appState.audioEncoding);
      } else {
        setStatus('Async STT error: ' + err.message);
        analyzeBtn.disabled = false;
        return;
      }
    }
  } else {
    setStatus('Running ensemble STT analysis...');
    const ensembleResult = await sendEnsembleSTT(appState.audioBlob, appState.audioEncoding);

    // Log ensemble result for debugging
    addStage('ensemble_raw', {
      hasLatestLong: !!ensembleResult.latestLong,
      hasDefault: !!ensembleResult.default,
      errors: ensembleResult.errors
    });

    // Check for complete failure
    if (!ensembleResult.latestLong && !ensembleResult.default) {
      setStatus('Both STT models failed. Check API key.');
      analyzeBtn.disabled = false;
      finalizeDebugLog({ error: 'Both STT models failed', details: ensembleResult.errors });
      return;
    }

    // Merge results using temporal word association
    const mergedWords = mergeEnsembleResults(ensembleResult);
    const ensembleStats = computeEnsembleStats(mergedWords);

    addStage('ensemble_merged', {
      totalWords: ensembleStats.totalWords,
      both: ensembleStats.both,
      latestOnly: ensembleStats.latestOnly,
      defaultOnly: ensembleStats.defaultOnly,
      agreementRate: ensembleStats.agreementRate
    });

    // VAD processing for ghost detection (Phase 12)
    let vadResult = { segments: [], durationMs: 0, error: 'VAD not initialized' };
    let ghostResult = { ghostCount: 0, hasGhostSequence: false, vadError: null, ghostIndices: [] };

    if (vadProcessor.isLoaded) {
      setStatus('Running ghost detection...');
      vadResult = await vadProcessor.processAudio(appState.audioBlob);

      addStage('vad_processing', {
        segmentCount: vadResult.segments.length,
        durationMs: vadResult.durationMs,
        error: vadResult.error
      });

      // Run ghost detection on merged words
      const referenceText = document.getElementById('transcript').value.trim();
      ghostResult = flagGhostWords(mergedWords, vadResult, referenceText, vadResult.durationMs);

      addStage('ghost_detection', {
        ghostCount: ghostResult.ghostCount,
        hasGhostSequence: ghostResult.hasGhostSequence,
        vadError: ghostResult.vadError,
        ghostIndices: ghostResult.ghostIndices
      });

      if (ghostResult.ghostCount > 0) {
        console.log(`[ORF] Ghost detection: ${ghostResult.ghostCount} potential hallucinations flagged`);
      }
    } else {
      addWarning('VAD not loaded', { error: vadProcessor.loadError });
      console.warn('[ORF] VAD not loaded, skipping ghost detection:', vadProcessor.loadError);
    }

    // Confidence classification (Phase 13)
    // Pipeline: Classify -> Filter ghosts -> Align
    setStatus('Classifying word confidence...');
    const referenceText = document.getElementById('transcript').value.trim();
    const classifiedWords = classifyAllWords(mergedWords, referenceText);
    const classificationStats = computeClassificationStats(classifiedWords);

    addStage('confidence_classification', {
      total: classificationStats.total,
      high: classificationStats.high,
      medium: classificationStats.medium,
      low: classificationStats.low,
      ghost: classificationStats.ghost,
      possibleInsertions: classificationStats.possibleInsertions
    });

    // Filter ghost words BEFORE alignment (confidence === 0.0)
    const wordsForAlignment = filterGhosts(classifiedWords);

    if (classificationStats.ghost > 0) {
      console.log(`[ORF] Filtered ${classificationStats.ghost} ghost words before alignment`);
    }
    if (classificationStats.possibleInsertions > 0) {
      console.log(`[ORF] ${classificationStats.possibleInsertions} possible insertions flagged (not filtered)`);
    }

    // Disfluency detection (Phase 14)
    // Pipeline: Classify -> Filter ghosts -> Detect disfluencies -> Safety checks -> Align
    setStatus('Detecting disfluencies...');
    const disfluencyResult = detectDisfluencies(wordsForAlignment);
    const wordsWithDisfluency = disfluencyResult.words;

    addStage('disfluency_detection', {
      wordsProcessed: wordsForAlignment.length,
      wordsAfter: wordsWithDisfluency.length,
      fragmentsRemoved: disfluencyResult.fragmentsRemoved,
      summary: disfluencyResult.summary
    });

    if (disfluencyResult.fragmentsRemoved > 0) {
      console.log(`[ORF] Disfluency: ${disfluencyResult.fragmentsRemoved} fragments merged`);
    }
    if (disfluencyResult.summary.totalWordsWithDisfluency > 0) {
      console.log(`[ORF] Disfluency: ${disfluencyResult.summary.totalWordsWithDisfluency} words with stutter events`);
    }

    // Safety checks (Phase 15)
    // Pipeline: Classify -> Filter ghosts -> Detect disfluencies -> Safety checks -> Align
    setStatus('Running safety checks...');
    // Get audio duration: prefer VAD result, fallback to last word's endTime
    const parseTime = (t) => parseFloat(String(t).replace('s', '')) || 0;
    const audioDurationMs = vadResult.durationMs > 0
      ? vadResult.durationMs
      : parseTime(wordsWithDisfluency[wordsWithDisfluency.length - 1]?.endTime) * 1000 || 0;
    const safetyResult = applySafetyChecks(wordsWithDisfluency, referenceText, audioDurationMs);
    const wordsWithSafety = safetyResult.words;

    addStage('safety_checks', {
      rateAnomalies: safetyResult._safety.rateAnomalies,
      uncorroboratedSequences: safetyResult._safety.uncorroboratedSequences,
      collapse: safetyResult._safety.collapse
    });

    if (safetyResult._safety.collapse.collapsed) {
      console.warn('[ORF] Confidence collapse detected:', safetyResult._safety.collapse.percent.toFixed(1) + '% flagged');
    }

    // Convert merged words to STT response format for compatibility
    // (existing code expects data.results structure)
    // NOTE: Use wordsWithSafety (ghosts removed, fragments merged, safety checked) for alignment
    // but preserve all words in _classification for debugging
    data = {
      results: [{
        alternatives: [{
          words: wordsWithSafety,  // Words with safety flags (fragments removed, safety checked)
          transcript: wordsWithSafety.map(w => w.word).join(' ')
        }]
      }],
      _ensemble: {
        raw: ensembleResult,
        stats: ensembleStats
      },
      _vad: {
        segments: vadResult.segments,
        durationMs: vadResult.durationMs,
        ghostCount: ghostResult.ghostCount,
        hasGhostSequence: ghostResult.hasGhostSequence,
        error: vadResult.error || ghostResult.vadError
      },
      _classification: {
        stats: classificationStats,
        allWords: classifiedWords,  // Keep ALL words (including ghosts) for debugging
        filteredCount: classifiedWords.length - wordsForAlignment.length
      },
      _disfluency: {
        summary: disfluencyResult.summary,
        fragmentsRemoved: disfluencyResult.fragmentsRemoved
      },
      _safety: safetyResult._safety  // Preserves safety check data
    };
  }

  if (!data || !data.results) {
    addError('STT returned no results', { data });
    displayResults(data || {});
    analyzeBtn.disabled = false;
    finalizeDebugLog({ error: 'No STT results' });
    return;
  }

  addStage('stt_response', {
    resultsCount: data.results.length,
    totalWords: data.results.reduce((sum, r) => sum + (r.alternatives?.[0]?.words?.length || 0), 0)
  });

  let referenceText = document.getElementById('transcript').value.trim();

  if (!referenceText) {
    displayResults(data);
    setStatus('Done (no reference passage for alignment).');
    analyzeBtn.disabled = false;
    return;
  }

  // Flatten all transcript words from STT results
  const transcriptWords = [];
  for (const result of data.results) {
    const alt = result.alternatives && result.alternatives[0];
    if (alt && alt.words) {
      for (const w of alt.words) {
        transcriptWords.push(w);
      }
    }
  }

  // Log STT words with timestamps for debugging pause detection
  // NOTE: After Phase 13, transcriptWords excludes ghost words (filtered before alignment)
  addStage('stt_words', {
    count: transcriptWords.length,
    words: transcriptWords.map((w, idx) => ({
      idx,
      word: w.word,
      start: w.startTime,
      end: w.endTime,
      confidence: w.confidence,
      trustLevel: w.trustLevel,  // Phase 13: trust classification
      _flags: w._flags  // Phase 13: possible_insertion, etc.
    })),
    gaps: transcriptWords.slice(1).map((w, idx) => {
      const prev = transcriptWords[idx];
      const prevEnd = parseFloat(prev.endTime?.replace('s', '') || '0');
      const currStart = parseFloat(w.startTime?.replace('s', '') || '0');
      return {
        afterWord: prev.word,
        beforeWord: w.word,
        gap: Math.round((currStart - prevEnd) * 1000) / 1000,
        sttIndex: idx + 1
      };
    }).filter(g => g.gap >= 0.5)
  });

  addStage('reference_text', {
    text: referenceText,
    wordCount: referenceText.split(/\s+/).length,
    isFromOCR: appState.referenceIsFromOCR
  });

  // Trim OCR passage to attempted range
  if (appState.referenceIsFromOCR && transcriptWords.length > 0) {
    const trimmed = trimPassageToAttempted(referenceText, transcriptWords);
    const origCount = referenceText.split(/\s+/).length;
    const trimCount = trimmed.split(/\s+/).length;
    if (trimCount < origCount) {
      setStatus(`Trimmed passage from ${origCount} to ${trimCount} words.`);
    }
    referenceText = trimmed;
  }

  // Analyze passage text with NL API
  let nlAnnotations = null;
  const apiKey = document.getElementById('apiKey').value.trim();
  if (apiKey) {
    setStatus('Analyzing passage text...');
    nlAnnotations = await analyzePassageText(referenceText, apiKey);
    addStage('nl_annotations', {
      hasAnnotations: !!nlAnnotations,
      count: nlAnnotations?.length || 0,
      properNouns: nlAnnotations?.filter(a => a?.isProperNoun).map(a => a.word) || []
    });
  }

  // Build lookup: normalized hyp word -> queue of STT metadata
  const sttLookup = new Map();
  for (const w of transcriptWords) {
    const norm = getCanonical(w.word.toLowerCase().replace(/^[^\w'-]+|[^\w'-]+$/g, ''));
    if (!sttLookup.has(norm)) sttLookup.set(norm, []);
    sttLookup.get(norm).push(w);
  }

  const alignment = alignWords(referenceText, transcriptWords);

  addStage('alignment', {
    totalEntries: alignment.length,
    correct: alignment.filter(a => a.type === 'correct').length,
    substitutions: alignment.filter(a => a.type === 'substitution').length,
    omissions: alignment.filter(a => a.type === 'omission').length,
    insertions: alignment.filter(a => a.type === 'insertion').length
  });

  // Run diagnostics first so we can heal self-corrections
  const diagnostics = runDiagnostics(transcriptWords, alignment, referenceText, sttLookup);

  addStage('diagnostics', {
    longPauses: diagnostics.longPauses?.length || 0,
    longPauseDetails: diagnostics.longPauses?.map(p => ({
      afterWordIndex: p.afterWordIndex,
      afterWord: transcriptWords[p.afterWordIndex]?.word || '?',
      beforeWord: transcriptWords[p.afterWordIndex + 1]?.word || '?',
      gap: p.gap
    })) || [],
    hesitations: diagnostics.onsetDelays?.length || 0,
    hesitationDetails: diagnostics.onsetDelays?.map(d => ({
      wordIndex: d.wordIndex,
      word: d.word,
      gap: d.gap,
      threshold: d.threshold
    })) || [],
    selfCorrections: diagnostics.selfCorrections?.length || 0
  });

  // Reclassify alignment entries that are part of self-corrections
  // (e.g. repeated "ran" should not count as an insertion)
  if (diagnostics.selfCorrections && diagnostics.selfCorrections.length > 0) {
    // Collect all STT hyp indices that are repeat extras
    const scHypIndices = new Set();
    for (const sc of diagnostics.selfCorrections) {
      // startIndex is the first occurrence in STT; repeats are startIndex+1..startIndex+count-1
      // For word-repeat of count 2: index startIndex+1 is the extra
      // For phrase-repeat of count 2: indices startIndex+2, startIndex+3 are extras
      if (sc.type === 'word-repeat') {
        for (let k = sc.startIndex + 1; k < sc.startIndex + sc.count; k++) {
          scHypIndices.add(k);
        }
      } else if (sc.type === 'phrase-repeat') {
        // phrase has 2 words repeated, extras start at startIndex + 2
        scHypIndices.add(sc.startIndex + 2);
        scHypIndices.add(sc.startIndex + 3);
      }
    }

    // Walk alignment to map each entry to its hyp index, reclassify matches
    let hypIdx = 0;
    for (const entry of alignment) {
      if (entry.type === 'insertion') {
        if (scHypIndices.has(hypIdx)) {
          entry.type = 'self-correction';
        }
        hypIdx++;
      } else if (entry.type === 'omission') {
        // no hyp word consumed
      } else {
        hypIdx++;
      }
    }
  }

  // Map NL annotations onto alignment entries
  if (nlAnnotations) {
    let refWordIndex = 0;
    for (const entry of alignment) {
      if (entry.type === 'insertion') continue;
      if (refWordIndex < nlAnnotations.length) {
        entry.nl = nlAnnotations[refWordIndex];
      }
      refWordIndex++;
    }

    // Build capitalization map from original reference text as fallback for proper noun detection
    // (NL API may miss proper nouns without sufficient context)
    const refWordsOriginal = referenceText.trim().split(/\s+/);
    const isCapitalized = (word, index) => {
      if (!word || word.length === 0) return false;
      const firstChar = word.charAt(0);
      if (firstChar !== firstChar.toUpperCase()) return false;
      // Check if it's at sentence start (after . ! ? or first word)
      if (index === 0) return false;
      const prevWord = refWordsOriginal[index - 1];
      if (prevWord && /[.!?]$/.test(prevWord)) return false;
      return true;
    };

    // Mark proper noun errors as forgiven if phonetically close
    // (student decoded correctly but doesn't know accepted pronunciation - vocabulary gap, not decoding failure)
    // Also handles split pronunciations like "her-my-own" for "Hermione"
    const forgivenessLog = [];
    let refIdx = 0;
    for (let i = 0; i < alignment.length; i++) {
      const entry = alignment[i];
      if (entry.type === 'insertion') continue;

      if (entry.type === 'substitution') {
        // Check if proper noun via NL API OR via capitalization heuristic
        const isProperViaNL = entry.nl && entry.nl.isProperNoun;
        const isProperViaCaps = isCapitalized(refWordsOriginal[refIdx], refIdx);

        const logEntry = {
          refWord: entry.ref,
          hypWord: entry.hyp,
          refIdx,
          isProperViaNL,
          isProperViaCaps,
          nlData: entry.nl
        };

        if (isProperViaNL || isProperViaCaps) {
          // Try combining with following insertions to find best phonetic match
          // (handles "her" + "my" + "own" = "hermyown" for "Hermione")
          let bestRatio = levenshteinRatio(entry.ref, entry.hyp);
          let bestCombined = entry.hyp;
          let bestInsertionsUsed = 0;

          // Check all possible combinations with following insertions
          let combined = entry.hyp;
          const combinationAttempts = [{ combined: entry.hyp, ratio: bestRatio, insertions: 0 }];
          for (let j = i + 1; j < alignment.length && alignment[j].type === 'insertion'; j++) {
            combined += alignment[j].hyp;
            const insertionCount = j - i;
            const newRatio = levenshteinRatio(entry.ref, combined);
            combinationAttempts.push({ combined, ratio: newRatio, insertions: insertionCount });
            if (newRatio > bestRatio) {
              bestRatio = newRatio;
              bestCombined = combined;
              bestInsertionsUsed = insertionCount;
            }
          }

          logEntry.combinationAttempts = combinationAttempts;
          logEntry.bestRatio = bestRatio;
          logEntry.bestCombined = bestCombined;
          logEntry.bestInsertionsUsed = bestInsertionsUsed;
          logEntry.threshold = 0.4;
          logEntry.meetsThreshold = bestRatio >= 0.4;

          if (bestRatio >= 0.4) {
            entry.forgiven = true;
            entry.phoneticRatio = Math.round(bestRatio * 100);
            entry.properNounSource = isProperViaNL ? 'NL API' : 'capitalization';
            logEntry.forgiven = true;
            if (bestInsertionsUsed > 0) {
              entry.combinedPronunciation = bestCombined;
              // Also mark the insertions as part of the forgiven pronunciation
              for (let j = 1; j <= bestInsertionsUsed; j++) {
                if (alignment[i + j]) {
                  alignment[i + j].partOfForgiven = true;
                }
              }
            }
          }
        }
        forgivenessLog.push(logEntry);
      }
      refIdx++;
      // Omissions of proper nouns are NOT forgiven - student didn't attempt the word
    }

    addStage('proper_noun_forgiveness', {
      totalSubstitutions: forgivenessLog.length,
      properNounsFound: forgivenessLog.filter(l => l.isProperViaNL || l.isProperViaCaps).length,
      forgiven: forgivenessLog.filter(l => l.forgiven).length,
      details: forgivenessLog
    });
  }

  // Calculate effective reading time: first word start = t=0
  // This gives the student a full 60 seconds from when they start speaking
  let effectiveElapsedSeconds = appState.elapsedSeconds;
  if (transcriptWords.length > 0) {
    const parseTime = (t) => parseFloat(String(t).replace('s', '')) || 0;
    const firstWordStart = parseTime(transcriptWords[0].startTime);
    const lastWordEnd = parseTime(transcriptWords[transcriptWords.length - 1].endTime);
    const readingDuration = lastWordEnd - firstWordStart;

    // Use the actual reading duration (first word to last word)
    // Cap at 60 seconds for standard ORF assessment
    effectiveElapsedSeconds = Math.min(readingDuration, 60);

    addStage('timing_adjustment', {
      recordingElapsed: appState.elapsedSeconds,
      firstWordStart,
      lastWordEnd,
      readingDuration: Math.round(readingDuration * 100) / 100,
      effectiveElapsed: Math.round(effectiveElapsedSeconds * 100) / 100
    });
  }

  const wcpm = (effectiveElapsedSeconds != null && effectiveElapsedSeconds > 0)
    ? computeWCPMRange(alignment, effectiveElapsedSeconds)
    : null;
  const accuracy = computeAccuracy(alignment, { forgivenessEnabled: !!nlAnnotations });
  const tierBreakdown = nlAnnotations ? computeTierBreakdown(alignment) : null;

  addStage('metrics_computed', {
    wcpm: wcpm?.wcpm || null,
    accuracy: accuracy.accuracy,
    totalRefWords: accuracy.totalRefWords,
    substitutions: accuracy.substitutions,
    omissions: accuracy.omissions,
    insertions: accuracy.insertions,
    forgiven: accuracy.forgiven,
    forgivenessEnabled: accuracy.forgivenessEnabled,
    alignmentSummary: alignment.map(a => ({
      ref: a.ref,
      hyp: a.hyp,
      type: a.type,
      forgiven: a.forgiven,
      partOfForgiven: a.partOfForgiven
    }))
  });

  displayAlignmentResults(
    alignment,
    wcpm,
    accuracy,
    sttLookup,
    diagnostics,
    transcriptWords,
    tierBreakdown,
    disfluencyResult?.summary || null,   // Disfluency counts by severity
    safetyResult?._safety || null         // Collapse state and safety flags
  );

  if (appState.selectedStudentId) {
    const errorBreakdown = {
      substitutions: accuracy.substitutions,
      omissions: accuracy.omissions,
      insertions: accuracy.insertions,
      details: alignment.filter(w => w.type !== 'correct')
    };
    const assessmentId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    if (appState.audioBlob) {
      await saveAudioBlob(assessmentId, appState.audioBlob);
    }
    saveAssessment(appState.selectedStudentId, {
      _id: assessmentId,
      wcpm: wcpm ? wcpm.wcpm : null,
      accuracy: accuracy.accuracy,
      totalWords: accuracy.totalRefWords,
      errors: accuracy.substitutions + accuracy.omissions,
      duration: effectiveElapsedSeconds,
      passagePreview: referenceText.slice(0, 60),
      errorBreakdown,
      alignment,
      sttWords: transcriptWords,
      audioRef: appState.audioBlob ? assessmentId : null,
      nlAnnotations,
      _ensemble: data._ensemble || null,  // Preserves ensemble debug data
      _vad: data._vad || null,  // Preserves VAD ghost detection data
      _classification: data._classification || null,  // Preserves confidence classification data
      _disfluency: data._disfluency || null,  // Preserves disfluency detection data
      _safety: data._safety || null  // Preserves safety check data
    });
    refreshStudentUI();
    setStatus('Done (saved).');

    // Show student playback button if audio exists
    if (appState.audioBlob) {
      showPlaybackButton(appState.selectedStudentId, assessmentId);
    }

    // Finalize and auto-save debug log
    finalizeDebugLog({
      studentId: appState.selectedStudentId,
      assessmentId,
      wcpm: wcpm?.wcpm || null,
      accuracy: accuracy.accuracy,
      totalWords: accuracy.totalRefWords,
      errors: accuracy.substitutions + accuracy.omissions,
      forgiven: accuracy.forgiven,
      ghostCount: data._vad?.ghostCount || 0
    });
  } else {
    setStatus('Done.');
    // Finalize debug log without assessment save
    finalizeDebugLog({
      noStudent: true,
      wcpm: wcpm?.wcpm || null,
      accuracy: accuracy.accuracy
    });
  }

  analyzeBtn.disabled = false;
}

// Auto-fill API key for dev/testing
document.getElementById('apiKey').value = 'AIzaSyCTx4rS7zxwRZqNseWcFJAaAgEH5HA50xA';

initRecorder();
initFileHandler();

// Initialize VAD for ghost detection (Phase 12)
vadProcessor.init().then(() => {
  if (vadProcessor.isLoaded) {
    console.log('[ORF] VAD initialized for ghost detection');
  } else {
    console.warn('[ORF] VAD failed to load:', vadProcessor.loadError);
  }
});

// Store audio on record/upload, don't process yet
recorderSetOnComplete((blob, enc, secs) => {
  appState.audioBlob = blob;
  appState.audioEncoding = enc;
  appState.elapsedSeconds = secs;
  showAudioPlayback(blob);
  setStatus('Audio ready. Click Analyze to process.');
  updateAnalyzeBtn();
});

fileHandlerSetOnComplete((blob, enc) => {
  appState.audioBlob = blob;
  appState.audioEncoding = enc;
  appState.elapsedSeconds = null;
  showAudioPlayback(blob);
  setStatus('File loaded. Click Analyze to process.');
  updateAnalyzeBtn();
});

// Analyze button
analyzeBtn.addEventListener('click', runAnalysis);

// Track reference text origin
document.getElementById('transcript').addEventListener('input', () => {
  appState.referenceIsFromOCR = false;
});

// --- Student selector wiring ---
document.getElementById('studentSelect').addEventListener('change', (e) => {
  const value = e.target.value;
  appState.selectedStudentId = value ? value : null;
  refreshStudentUI();
});

document.getElementById('addStudentBtn').addEventListener('click', () => {
  const input = document.getElementById('newStudentName');
  const gradeSelect = document.getElementById('newStudentGrade');
  const name = input.value.trim();
  if (name) {
    const gradeVal = gradeSelect.value ? parseInt(gradeSelect.value, 10) : null;
    const student = addStudent(name, gradeVal);
    input.value = '';
    gradeSelect.value = '';
    appState.selectedStudentId = student.id;
    refreshStudentUI();
  }
});

document.getElementById('deleteStudentBtn').addEventListener('click', async () => {
  if (appState.selectedStudentId) {
    if (confirm('Delete this student and all their assessments?')) {
      await deleteStudent(appState.selectedStudentId);
      appState.selectedStudentId = null;
      refreshStudentUI();
    }
  }
});

// --- OCR wiring ---
const imageInput = document.getElementById('imageInput');
const ocrPreview = document.getElementById('ocrPreview');
const ocrImage = document.getElementById('ocrImage');
const ocrText = document.getElementById('ocrText');
const ocrStatus = document.getElementById('ocrStatus');
const useOcrBtn = document.getElementById('useOcrBtn');

if (imageInput) {
  imageInput.addEventListener('change', async () => {
    const file = imageInput.files[0];
    if (!file) return;

    ocrPreview.style.display = 'block';
    ocrImage.src = URL.createObjectURL(file);
    ocrStatus.textContent = 'Extracting text...';
    ocrText.value = '';

    const apiKey = document.getElementById('apiKey').value.trim();
    if (!apiKey) {
      ocrStatus.textContent = 'Error: Please enter an API key first.';
      return;
    }

    try {
      const text = await extractTextFromImage(file, apiKey);
      ocrText.value = text;
      ocrStatus.textContent = text
        ? "Text extracted — review and edit, then click 'Use as Reference Passage'."
        : 'No text detected in image.';
    } catch (err) {
      ocrStatus.textContent = 'OCR error: ' + err.message;
    }
  });
}

if (useOcrBtn) {
  useOcrBtn.addEventListener('click', () => {
    document.getElementById('transcript').value = ocrText.value;
    appState.referenceIsFromOCR = true;
    ocrStatus.textContent = 'Reference passage updated.';
  });
}

// Initialize student selector on page load
refreshStudentUI();

// --- Dashboard wiring ---
const dashboard = initDashboard();

document.getElementById('viewDashboardBtn').addEventListener('click', () => {
  if (appState.selectedStudentId) {
    dashboard.show(appState.selectedStudentId);
  }
});

// --- VAD Settings UI wiring (Phase 12) ---
const vadCalibrateBtn = document.getElementById('vadCalibrateBtn');
const vadCalibrationStatus = document.getElementById('vadCalibrationStatus');
const vadThresholdSlider = document.getElementById('vadThresholdSlider');
const vadThresholdValue = document.getElementById('vadThresholdValue');
const vadNoiseInfo = document.getElementById('vadNoiseInfo');
const vadPresetBtns = document.querySelectorAll('.vad-preset');

// Calibrate button
if (vadCalibrateBtn) {
  vadCalibrateBtn.addEventListener('click', async () => {
    vadCalibrateBtn.disabled = true;
    // Show spinner per CONTEXT.md: "simple spinner with 'Calibrating...' text"
    vadCalibrationStatus.innerHTML = '<span class="vad-spinner"></span>Calibrating...';

    const result = await vadProcessor.calibrateMicrophone();

    if (result.error) {
      vadCalibrationStatus.textContent = `Error: ${result.error}`;
    } else {
      vadCalibrationStatus.textContent = 'Calibrated';

      // Update slider (for dev mode users)
      if (vadThresholdSlider) {
        vadThresholdSlider.value = result.threshold;
        vadThresholdValue.textContent = result.threshold.toFixed(2);
      }

      // Show noise info per CONTEXT.md: "Noise Level: Low (0.20)"
      vadNoiseInfo.style.display = 'block';
      vadNoiseInfo.textContent = `Noise Level: ${result.noiseLevel} (${result.threshold.toFixed(2)})`;
      vadNoiseInfo.className = 'vad-info' + (result.noiseLevel === 'High' ? ' high-noise' : '');

      // Per CONTEXT.md: subtle note for high noise
      if (result.noiseLevel === 'High') {
        vadNoiseInfo.innerHTML += '<br><small>Higher background noise detected</small>';
      }
    }

    vadCalibrateBtn.disabled = false;
  });
}

// Threshold slider
if (vadThresholdSlider) {
  vadThresholdSlider.addEventListener('input', () => {
    const value = parseFloat(vadThresholdSlider.value);
    vadThresholdValue.textContent = value.toFixed(2);
    vadProcessor.setThreshold(value);
    // Per CONTEXT.md: "Calibration overrides manual" - mark as not calibrated when manually changed
    vadCalibrationStatus.textContent = `Manual: ${value.toFixed(2)}`;
    vadProcessor.isCalibrated = false;
  });
}

// Preset buttons
if (vadPresetBtns) {
  vadPresetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const threshold = parseFloat(btn.dataset.threshold);
      vadThresholdSlider.value = threshold;
      vadThresholdValue.textContent = threshold.toFixed(2);
      vadProcessor.setThreshold(threshold);
      vadCalibrationStatus.textContent = `Preset: ${btn.textContent}`;
      vadProcessor.isCalibrated = false;
    });
  });
}

// Note: Per CONTEXT.md "Persistence: Reset each session - threshold resets to default on page reload"
// No persistence needed - the default behavior handles this naturally

// --- Dev mode toggle (Phase 16) ---
const devModeToggle = document.getElementById('devModeToggle');
if (devModeToggle) {
  // Check localStorage for saved dev mode state
  if (localStorage.getItem('orf_dev_mode') === 'true') {
    document.body.classList.add('dev-mode');
  }

  devModeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dev-mode');
    const isDevMode = document.body.classList.contains('dev-mode');
    localStorage.setItem('orf_dev_mode', isDevMode);
  });
}
