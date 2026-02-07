import { initRecorder, setOnComplete as recorderSetOnComplete } from './recorder.js';
import { initFileHandler, setOnComplete as fileHandlerSetOnComplete } from './file-handler.js';
// Google Cloud STT — commented out, no longer used (Kitchen Sink pipeline replaces it)
// import { sendToSTT, sendToAsyncSTT, sendChunkedSTT, sendEnsembleSTT } from './stt-api.js';
import { alignWords } from './alignment.js';
import { getCanonical } from './word-equivalences.js';
import { computeWCPM, computeAccuracy, computeWCPMRange } from './metrics.js';
import { setStatus, displayResults, displayAlignmentResults, showAudioPlayback, renderStudentSelector, renderHistory } from './ui.js';
import { runDiagnostics, computeTierBreakdown, resolveNearMissClusters, computePhrasingQuality, computePauseAtPunctuation, computePaceConsistency, computeWordDurationOutliers, computeWordSpeedTiers } from './diagnostics.js';
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
import { runKitchenSinkPipeline, isKitchenSinkEnabled, computeKitchenSinkStats } from './kitchen-sink-merger.js';
import { getCrossValidatorEngine, setCrossValidatorEngine, getCrossValidatorName } from './cross-validator.js';
import { checkTerminalLeniency } from './phonetic-utils.js';
import { padAudioWithSilence } from './audio-padding.js';
import { enrichDiagnosticsWithVAD, computeVADGapSummary, adjustGapsWithVADOverhang } from './vad-gap-analyzer.js';
import { canRunMaze } from './maze-generator.js';

// Code version for cache verification
const CODE_VERSION = 'v37-2026-02-06';
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

// ── Post-Assessment Launchers (Playback & Maze Game) ──

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

function showMazeButton(studentId, assessmentId, referenceText) {
  // Remove existing maze controls
  const existingBtn = document.getElementById('mazeGameBtn');
  if (existingBtn) existingBtn.remove();
  const existingSel = document.getElementById('mazeDifficulty');
  if (existingSel) existingSel.remove();

  // Only show if passage is long enough
  if (!canRunMaze(referenceText)) return;

  // Difficulty dropdown
  const sel = document.createElement('select');
  sel.id = 'mazeDifficulty';
  sel.style.cssText = 'margin:0.5rem 0 0.5rem 0.5rem;padding:0.5rem 0.8rem;border-radius:8px;border:1px solid #666;background:#2a2a2a;color:#fff;font-size:0.9rem;cursor:pointer;';
  const difficulties = [['easy', 'Easy (K-2)'], ['standard', 'Standard (3-5)'], ['challenge', 'Challenge (6-8)']];
  for (const [val, label] of difficulties) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = label;
    if (val === 'standard') opt.selected = true;
    sel.appendChild(opt);
  }

  // Maze Game button
  const btn = document.createElement('button');
  btn.id = 'mazeGameBtn';
  btn.textContent = 'Maze Game';
  btn.style.cssText = 'margin:0.5rem 0 0.5rem 0.5rem;padding:0.6rem 1.2rem;background:#7b1fa2;color:#fff;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer;';
  btn.addEventListener('click', () => {
    const difficulty = sel.value;
    const base = window.location.href.replace(/[^/]*$/, '');
    const params = new URLSearchParams({ student: studentId, assessment: assessmentId, difficulty });
    window.open(base + 'maze.html?' + params.toString(), 'orf_maze', 'width=700,height=500');
  });

  // Insert after the playback theme selector (or playback button, or analyze button)
  const anchor = document.getElementById('playbackThemeSelect')
    || document.getElementById('playbackAdventureBtn')
    || analyzeBtn;
  anchor.insertAdjacentElement('afterend', sel);
  sel.insertAdjacentElement('afterend', btn);
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

  // Pad audio with 500ms silence to help ASR resolve final word
  // (Models use lookahead window; if audio ends abruptly, last word suffers)
  setStatus('Preparing audio...');
  let paddedAudioBlob;
  let effectiveEncoding = appState.audioEncoding;
  let sampleRateHertz = null;
  try {
    const padResult = await padAudioWithSilence(appState.audioBlob);
    paddedAudioBlob = padResult.blob;
    sampleRateHertz = padResult.sampleRate;
    // Padded audio is re-encoded as WAV (LINEAR16)
    effectiveEncoding = 'LINEAR16';
    addStage('audio_padding', { applied: true, paddingMs: 500, encoding: 'LINEAR16', sampleRate: sampleRateHertz });
  } catch (err) {
    console.warn('[ORF] Audio padding failed:', err.message);
    paddedAudioBlob = appState.audioBlob;
    addStage('audio_padding', { applied: false, error: err.message });
  }

  let data;
  // Declare vadResult at outer scope — populated in Kitchen Sink path,
  // consumed by VAD Gap Analysis (Phase 18) after the if/else block
  let vadResult = { segments: [], durationMs: 0, error: 'VAD not initialized' };

  // Google STT async path for >55s recordings — commented out, Kitchen Sink handles all lengths now
  // if (appState.elapsedSeconds != null && appState.elapsedSeconds > 55) {
  //   setStatus('Processing long recording via async STT...');
  //   try {
  //     data = await sendToAsyncSTT(paddedAudioBlob, effectiveEncoding, (pct) => {
  //       setStatus(`Processing long recording... ${pct}%`);
  //     });
  //   } catch (err) {
  //     if (err.code === 'INLINE_REJECTED') {
  //       setStatus('Async STT unavailable for inline audio. Using chunked processing...');
  //       data = await sendChunkedSTT(paddedAudioBlob, effectiveEncoding);
  //     } else {
  //       setStatus('Async STT error: ' + err.message);
  //       analyzeBtn.disabled = false;
  //       return;
  //     }
  //   }
  // } else {

  {
    // Run Kitchen Sink pipeline (Reverb + Deepgram + disfluency detection)
    // Falls back to Deepgram-only automatically when Reverb unavailable
    setStatus('Running Kitchen Sink ensemble analysis...');
    const kitchenSinkResult = await runKitchenSinkPipeline(paddedAudioBlob, effectiveEncoding, sampleRateHertz);

    // Log result for debugging
    console.log('[Pipeline] Kitchen Sink result:', {
      source: kitchenSinkResult.source,
      wordCount: kitchenSinkResult.words?.length || 0,
      disfluencies: kitchenSinkResult.disfluencyStats?.total || 0,
      _debug: kitchenSinkResult._debug
    });

    // Handle empty result
    if (!kitchenSinkResult.words || kitchenSinkResult.words.length === 0) {
      setStatus('No speech detected. Please try again.');
      analyzeBtn.disabled = false;
      finalizeDebugLog({ error: 'No speech detected', source: kitchenSinkResult.source });
      return;
    }

    // Extract words for downstream processing
    const mergedWords = kitchenSinkResult.words;

    // Compute stats (works for both kitchen_sink and deepgram_fallback sources)
    const ensembleStats = computeKitchenSinkStats(kitchenSinkResult);

    // Log to debug stages
    addStage('kitchen_sink_result', {
      source: kitchenSinkResult.source,
      totalWords: mergedWords.length,
      disfluencies: kitchenSinkResult.disfluencyStats?.total || 0,
      disfluencyBreakdown: kitchenSinkResult.disfluencyStats?.byType || null,
      crossValidated: kitchenSinkResult._debug?.xvalAvailable || false,
      stats: ensembleStats
    });

    // Debug: verify _debug is created at merge time
    console.log('[Pipeline Debug] First 3 merged words:', mergedWords.slice(0, 3).map(w => ({
      word: w.word,
      source: w.source,
      has_debug: !!w._debug,
      _debug: w._debug
    })));

    addStage('ensemble_merged', {
      totalWords: ensembleStats.totalWords,
      both: ensembleStats.both,
      latestOnly: ensembleStats.latestOnly,
      defaultOnly: ensembleStats.defaultOnly,
      referenceVetoCount: ensembleStats.referenceVetoCount,
      agreementRate: ensembleStats.agreementRate
    });

    // Raw cross-validator words (before cross-validation filtering)
    if (kitchenSinkResult.xvalRaw?.words) {
      addStage('xval_raw', {
        totalWords: kitchenSinkResult.xvalRaw.words.length,
        words: kitchenSinkResult.xvalRaw.words.map((w, i) => ({
          idx: i,
          word: w.word,
          start: w.startTime,
          end: w.endTime,
          confidence: w.confidence
        }))
      });
    }

    // Unconsumed cross-validator words (heard by xval but not Reverb — dropped during cross-validation)
    if (kitchenSinkResult.unconsumedXval?.length > 0) {
      addStage('xval_unconsumed', {
        count: kitchenSinkResult.unconsumedXval.length,
        words: kitchenSinkResult.unconsumedXval.map(w => ({
          word: w.word,
          start: w.startTime,
          end: w.endTime,
          confidence: w.confidence
        }))
      });
    }

    // Per-word timestamp comparison: all three sources
    const _parseTs = t => parseFloat(String(t).replace('s', '')) || 0;
    addStage('timestamp_sources', {
      description: 'All timestamp sources per word (cross-validator=primary, Reverb v1.0=verbatim, Reverb v0.0=clean)',
      words: mergedWords.map(w => {
        const entry = { word: w.word, crossValidation: w.crossValidation };
        // Primary (cross-validator for confirmed/disagreed, Reverb for unconfirmed)
        entry.primary = { start: w.startTime, end: w.endTime };
        // Cross-validator
        if (w._xvalStartTime != null) {
          const ds = _parseTs(w._xvalStartTime);
          const de = _parseTs(w._xvalEndTime);
          entry.xval = { start: w._xvalStartTime, end: w._xvalEndTime, durMs: Math.round((de - ds) * 1000) };
        } else {
          entry.xval = null;
        }
        // Reverb v=1.0 (verbatim)
        if (w._reverbStartTime != null) {
          const rs = _parseTs(w._reverbStartTime);
          const re = _parseTs(w._reverbEndTime);
          entry.reverbV1 = { start: w._reverbStartTime, end: w._reverbEndTime, durMs: Math.round((re - rs) * 1000) };
        }
        // Reverb v=0.0 (clean)
        if (w._reverbCleanStartTime != null) {
          const cs = _parseTs(w._reverbCleanStartTime);
          const ce = _parseTs(w._reverbCleanEndTime);
          entry.reverbV0 = { start: w._reverbCleanStartTime, end: w._reverbCleanEndTime, durMs: Math.round((ce - cs) * 1000) };
        } else {
          entry.reverbV0 = null;
        }
        return entry;
      })
    });

    // =========================================================================
    // LEGACY v1.1 PIPELINE — COMMENTED OUT (2026-02-05)
    // =========================================================================
    // The following stages were designed for the old Google STT two-model
    // ensemble and are REDUNDANT with the Kitchen Sink architecture:
    //
    // - Ghost Detection (Phase 12): Caught hallucinated words from Google STT.
    //   Kitchen Sink uses Deepgram cross-validation instead (crossValidation
    //   property on each word: "confirmed"/"unconfirmed"/"unavailable").
    //
    // - Confidence Classification (Phase 13): Classified words as high/medium/
    //   low/ghost based on Google ensemble agreement. Kitchen Sink words already
    //   have per-word confidence from Reverb/Deepgram.
    //
    // - Phase 14 Disfluency Detection: Detected disfluencies via timing gaps
    //   between words (severity-based: minor/moderate/significant). Kitchen Sink
    //   uses Reverb verbatim-vs-clean diff for model-level disfluency detection
    //   (type-based: filler/repetition/false_start) — far more accurate.
    //
    // - Safety Checks (Phase 15): Caught confidence collapse and rate anomalies
    //   in the Google ensemble. Not applicable to Kitchen Sink pipeline.
    //
    // These stages also had a bug: they referenced `referenceText` before it
    // was declared (line 363), causing a ReferenceError crash.
    //
    // The Kitchen Sink pipeline (kitchen-sink-merger.js) handles all of this:
    //   - Hallucination filtering via Deepgram cross-validation
    //   - Disfluency detection via Reverb verbatim/clean alignment
    //   - Word-level confidence from source ASR models
    // =========================================================================

    // // VAD processing for ghost detection (Phase 12)
    // let vadResult = { segments: [], durationMs: 0, error: 'VAD not initialized' };
    // let ghostResult = { ghostCount: 0, hasGhostSequence: false, vadError: null, ghostIndices: [] };
    //
    // if (vadProcessor.isLoaded) {
    //   setStatus('Running ghost detection...');
    //   vadResult = await vadProcessor.processAudio(appState.audioBlob);
    //
    //   addStage('vad_processing', {
    //     segmentCount: vadResult.segments.length,
    //     durationMs: vadResult.durationMs,
    //     error: vadResult.error
    //   });
    //
    //   // Run ghost detection on merged words (referenceText already fetched above)
    //   ghostResult = flagGhostWords(mergedWords, vadResult, referenceText, vadResult.durationMs);
    //
    //   addStage('ghost_detection', {
    //     ghostCount: ghostResult.ghostCount,
    //     hasGhostSequence: ghostResult.hasGhostSequence,
    //     vadError: ghostResult.vadError,
    //     ghostIndices: ghostResult.ghostIndices
    //   });
    //
    //   if (ghostResult.ghostCount > 0) {
    //     console.log(`[ORF] Ghost detection: ${ghostResult.ghostCount} potential hallucinations flagged`);
    //   }
    // } else {
    //   addWarning('VAD not loaded', { error: vadProcessor.loadError });
    //   console.warn('[ORF] VAD not loaded, skipping ghost detection:', vadProcessor.loadError);
    // }

    // // Confidence classification (Phase 13)
    // // Pipeline: Classify -> Filter ghosts -> Align
    // setStatus('Classifying word confidence...');
    // // referenceText already fetched above (before ensemble merge)
    // const classifiedWords = classifyAllWords(mergedWords, referenceText);
    // const classificationStats = computeClassificationStats(classifiedWords);
    //
    // addStage('confidence_classification', {
    //   total: classificationStats.total,
    //   high: classificationStats.high,
    //   medium: classificationStats.medium,
    //   low: classificationStats.low,
    //   ghost: classificationStats.ghost,
    //   possibleInsertions: classificationStats.possibleInsertions
    // });
    //
    // // Filter ghost words BEFORE alignment (confidence === 0.0)
    // const wordsForAlignment = filterGhosts(classifiedWords);
    //
    // if (classificationStats.ghost > 0) {
    //   console.log(`[ORF] Filtered ${classificationStats.ghost} ghost words before alignment`);
    // }
    // if (classificationStats.possibleInsertions > 0) {
    //   console.log(`[ORF] ${classificationStats.possibleInsertions} possible insertions flagged (not filtered)`);
    // }

    // // Disfluency detection (Phase 14) - Hierarchy of Truth architecture
    // // Pipeline: Classify -> Filter ghosts -> Detect disfluencies -> Safety checks -> Align
    // setStatus('Detecting disfluencies...');
    // const disfluencyResult = detectDisfluencies(wordsForAlignment, referenceText);
    // const wordsWithDisfluency = disfluencyResult.words;
    //
    // addStage('disfluency_detection', {
    //   wordsProcessed: wordsForAlignment.length,
    //   wordsAfter: wordsWithDisfluency.length,
    //   fragmentsRemoved: disfluencyResult.fragmentsRemoved,
    //   summary: disfluencyResult.summary
    // });
    //
    // if (disfluencyResult.fragmentsRemoved > 0) {
    //   console.log(`[ORF] Disfluency: ${disfluencyResult.fragmentsRemoved} fragments merged`);
    // }
    // if (disfluencyResult.summary.totalWordsWithDisfluency > 0) {
    //   console.log(`[ORF] Disfluency: ${disfluencyResult.summary.totalWordsWithDisfluency} words with stutter events`);
    // }

    // // Safety checks (Phase 15)
    // // Pipeline: Classify -> Filter ghosts -> Detect disfluencies -> Safety checks -> Align
    // setStatus('Running safety checks...');
    // // Get audio duration: prefer VAD result, fallback to last word's endTime
    // const parseTime = (t) => parseFloat(String(t).replace('s', '')) || 0;
    // const audioDurationMs = vadResult.durationMs > 0
    //   ? vadResult.durationMs
    //   : parseTime(wordsWithDisfluency[wordsWithDisfluency.length - 1]?.endTime) * 1000 || 0;
    // const safetyResult = applySafetyChecks(wordsWithDisfluency, referenceText, audioDurationMs);
    // const wordsWithSafety = safetyResult.words;
    //
    // // Debug: verify _debug is preserved through pipeline
    // console.log('[Pipeline Debug] First 3 words after safety checks:', wordsWithSafety.slice(0, 3).map(w => ({
    //   word: w.word,
    //   has_debug: !!w._debug,
    //   _debug: w._debug
    // })));
    //
    // addStage('safety_checks', {
    //   rateAnomalies: safetyResult._safety.rateAnomalies,
    //   uncorroboratedSequences: safetyResult._safety.uncorroboratedSequences,
    //   collapse: safetyResult._safety.collapse
    // });
    //
    // if (safetyResult._safety.collapse.collapsed) {
    //   console.warn('[ORF] Confidence collapse detected:', safetyResult._safety.collapse.percent.toFixed(1) + '% flagged');
    // }

    // =========================================================================
    // Kitchen Sink direct pass-through
    // =========================================================================
    // Kitchen Sink words go directly to alignment — no legacy filtering needed.
    // Disfluency data (isDisfluency, disfluencyType) is already on each word.
    // Cross-validation data (crossValidation) is already on each word.
    const wordsForAlignment = mergedWords;

    // VAD processing — still needed for Phase 18 gap analysis (not ghost detection)
    // VAD tells teachers about speech activity in pauses/hesitations
    if (vadProcessor.isLoaded) {
      setStatus('Analyzing speech segments...');
      vadResult = await vadProcessor.processAudio(appState.audioBlob);
      addStage('vad_processing', {
        segmentCount: vadResult.segments.length,
        durationMs: vadResult.durationMs,
        error: vadResult.error,
        segments: vadResult.segments.map(s => ({
          start: s.start,
          end: s.end,
          duration: s.end - s.start
        }))
      });
    }

    // Convert merged words to STT response format for compatibility
    // (existing code expects data.results structure)
    data = {
      results: [{
        alternatives: [{
          words: wordsForAlignment,
          transcript: wordsForAlignment.map(w => w.word).join(' ')
        }]
      }],
      _ensemble: {
        stats: ensembleStats
      },
      _vad: null,             // Legacy ghost detection disabled
      _classification: null,  // Legacy confidence classification disabled
      _kitchenSink: {
        disfluencyStats: kitchenSinkResult.disfluencyStats || null,
        unconsumedXval: kitchenSinkResult.unconsumedXval || []
      },
      _disfluency: null,      // Legacy Phase 14 disfluency detection disabled
      _safety: null            // Legacy safety checks disabled
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

  // Log STT words with full details for maximum transparency
  // NOTE: After Phase 13, transcriptWords excludes ghost words (filtered before alignment)
  const parseT = (t) => parseFloat(String(t).replace('s', '')) || 0;

  // Build complete timeline with words and ALL gaps
  const wordTimeline = [];
  for (let i = 0; i < transcriptWords.length; i++) {
    const w = transcriptWords[i];
    const startSec = parseT(w.startTime);
    const endSec = parseT(w.endTime);

    // Leading silence before first word
    if (i === 0 && startSec > 0) {
      wordTimeline.push({
        type: 'silence',
        duration: startSec.toFixed(3) + 's',
        range: '0.000s - ' + startSec.toFixed(3) + 's'
      });
    }

    // The word itself
    wordTimeline.push({
      type: 'word',
      idx: i,
      word: w.word,
      range: startSec.toFixed(3) + 's - ' + endSec.toFixed(3) + 's',
      duration: (endSec - startSec).toFixed(3) + 's',
      confidence: w.confidence,
      _reverbConfidence: w._reverbConfidence,
      _xvalConfidence: w._xvalConfidence,
      crossValidation: w.crossValidation,
      source: w.source,
      isDisfluency: w.isDisfluency || false,
      disfluencyType: w.disfluencyType || null
    });

    // Gap after this word
    if (i < transcriptWords.length - 1) {
      const nextStart = parseT(transcriptWords[i + 1].startTime);
      const gap = nextStart - endSec;
      if (gap > 0.01) { // Log gaps > 10ms
        wordTimeline.push({
          type: 'gap',
          duration: gap.toFixed(3) + 's',
          range: endSec.toFixed(3) + 's - ' + nextStart.toFixed(3) + 's',
          afterWord: w.word,
          beforeWord: transcriptWords[i + 1].word
        });
      }
    }
  }

  addStage('stt_words', {
    count: transcriptWords.length,
    timeline: wordTimeline,
    // Also keep simple word list for quick scanning
    words: transcriptWords.map((w, idx) => ({
      idx,
      word: w.word,
      start: w.startTime,
      end: w.endTime,
      confidence: w.confidence,
      _reverbConfidence: w._reverbConfidence,
      _xvalConfidence: w._xvalConfidence,
      crossValidation: w.crossValidation,
      source: w.source,
      isDisfluency: w.isDisfluency || false,
      disfluencyType: w.disfluencyType || null
    }))
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

    // Filter proper nouns: reference capitalization is ground truth
    // If reference has "brown" (lowercase), it's NOT a proper noun regardless of NL API
    const refWords = referenceText.trim().split(/\s+/);
    const refLowercaseSet = new Set(
      refWords
        .filter((w, i) => {
          if (!w || w.length === 0) return false;
          // Skip sentence-start words (they're capitalized by grammar, not meaning)
          if (i === 0) return false;
          if (i > 0 && /[.!?]$/.test(refWords[i - 1])) return false;
          // Check if lowercase
          return w.charAt(0) === w.charAt(0).toLowerCase();
        })
        .map(w => w.toLowerCase().replace(/[^a-z'-]/g, ''))
    );

    const nlProperNouns = nlAnnotations?.filter(a => a?.isProperNoun).map(a => a.word) || [];
    const filteredProperNouns = nlProperNouns.filter(w => !refLowercaseSet.has(w.toLowerCase()));

    addStage('nl_annotations', {
      hasAnnotations: !!nlAnnotations,
      count: nlAnnotations?.length || 0,
      properNouns: filteredProperNouns,
      properNounsRaw: nlProperNouns,
      overriddenByRef: nlProperNouns.filter(w => refLowercaseSet.has(w.toLowerCase()))
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

  // Propagate severity from STT words to alignment items for WCPM range calculation
  alignment.forEach(item => {
    if (item.hyp) {
      const sttWord = transcriptWords.find(w =>
        w.word?.toLowerCase() === item.hyp?.toLowerCase()
      );
      if (sttWord?.severity) {
        item.severity = sttWord.severity;
      }
    }
  });

  const compoundWords = alignment.filter(a => a.compound);
  addStage('alignment', {
    totalEntries: alignment.length,
    correct: alignment.filter(a => a.type === 'correct').length,
    substitutions: alignment.filter(a => a.type === 'substitution').length,
    omissions: alignment.filter(a => a.type === 'omission').length,
    insertions: alignment.filter(a => a.type === 'insertion').length,
    compoundWords: compoundWords.length,
    compoundDetails: compoundWords.map(a => ({
      ref: a.ref,
      parts: a.parts
    }))
  });

  // Create synthetic sttLookup entries for compound words
  // Compound merger creates items like { hyp: "everyone", parts: ["every", "one"] }
  // but sttLookup only has entries for canonical("every") and canonical("one")="1".
  // Without this fix, tooltip for compound words shows no STT metadata.
  for (const item of alignment) {
    if (item.compound && item.parts) {
      const partWords = [];
      for (const part of item.parts) {
        const partKey = getCanonical(part.toLowerCase().replace(/^[^\w'-]+|[^\w'-]+$/g, ''));
        const queue = sttLookup.get(partKey);
        if (queue && queue.length > 0) {
          partWords.push(queue.shift());
        }
      }
      if (partWords.length > 0) {
        const first = partWords[0];
        const last = partWords[partWords.length - 1];
        // Store under the raw hyp key (ui.js looks up by item.hyp, not canonical)
        if (!sttLookup.has(item.hyp)) {
          sttLookup.set(item.hyp, []);
        }
        sttLookup.get(item.hyp).push({
          ...first,
          word: item.hyp,
          // Span from first part start to last part end (all timestamp sources)
          endTime: last.endTime,
          _xvalEndTime: last._xvalEndTime || last.endTime,
          _reverbEndTime: last._reverbEndTime || last.endTime,
          _reverbCleanEndTime: last._reverbCleanEndTime || null,
          // Show what cross-validator heard (individual parts)
          _xvalWord: partWords.map(w => w._xvalWord || w.word).join(' + '),
          _compoundParts: partWords
        });
      }
    }
  }

  // Recover omissions from unconsumed cross-validator words.
  // If the cross-validator heard a word that matches an omitted reference word,
  // the student DID say it — Reverb just missed it. Insert the word
  // into transcriptWords with cross-validator timestamps so gap calculations
  // also heal (no false hesitations around recovered words).
  const unconsumedXv = data._kitchenSink?.unconsumedXval || [];
  if (unconsumedXv.length > 0) {
    const _norm = (w) => w.toLowerCase().replace(/[^a-z'-]/g, '');
    // Build consumable pool
    const xvPool = unconsumedXv.map(w => ({ ...w, _norm: _norm(w.word) }));

    const recovered = [];
    for (const entry of alignment) {
      if (entry.type !== 'omission') continue;
      const refNorm = _norm(entry.ref);
      const matchIdx = xvPool.findIndex(xv => xv._norm === refNorm);
      if (matchIdx === -1) continue;

      const xvWord = xvPool.splice(matchIdx, 1)[0];

      // Build recovered word with cross-validator timestamps
      const recoveredWord = {
        word: xvWord.word,
        startTime: xvWord.startTime,
        endTime: xvWord.endTime,
        confidence: xvWord.confidence,
        crossValidation: 'recovered',
        _xvalStartTime: xvWord.startTime,
        _xvalEndTime: xvWord.endTime,
        _xvalConfidence: xvWord.confidence,
        _xvalWord: xvWord.word,
        _xvalEngine: getCrossValidatorEngine(),
        _reverbStartTime: null,
        _reverbEndTime: null,
        _reverbConfidence: null,
        _recovered: true,
        isDisfluency: false,
        disfluencyType: null
      };

      // Insert into transcriptWords at correct timestamp position
      const xvStart = parseT(xvWord.startTime);
      let insertIdx = transcriptWords.length;
      for (let i = 0; i < transcriptWords.length; i++) {
        if (parseT(transcriptWords[i].startTime) > xvStart) {
          insertIdx = i;
          break;
        }
      }
      transcriptWords.splice(insertIdx, 0, recoveredWord);

      // Heal alignment: omission → correct
      entry.type = 'correct';
      entry.hyp = xvWord.word;
      entry._recovered = true;

      // Add to sttLookup so tooltip works
      const lookupKey = getCanonical(xvWord.word.toLowerCase().replace(/^[^\w'-]+|[^\w'-]+$/g, ''));
      if (!sttLookup.has(lookupKey)) sttLookup.set(lookupKey, []);
      sttLookup.get(lookupKey).push(recoveredWord);

      recovered.push({
        word: xvWord.word,
        start: xvWord.startTime,
        end: xvWord.endTime,
        confidence: xvWord.confidence,
        insertedAt: insertIdx
      });
    }

    if (recovered.length > 0) {
      addStage('omission_recovery', {
        recoveredCount: recovered.length,
        recovered,
        remainingUnconsumed: xvPool.length
      });
      console.log(`[omission-recovery] Recovered ${recovered.length} omissions from unconsumed cross-validator words:`,
        recovered.map(r => r.word));
    }
  }

  // Resolve near-miss clusters — Path 2: decoding struggle (single pass)
  // Runs AFTER omission recovery so recovered 'correct' words can serve as
  // self-correction anchors (e.g., ins(epi-) → recovered correct(epiphany))
  resolveNearMissClusters(alignment);

  const nearMissStruggles = alignment.filter(a => a.type === 'struggle' && a._strugglePath === 'decoding');
  const nearMissSelfCorrections = alignment.filter(a => a._isSelfCorrection);
  if (nearMissStruggles.length > 0 || nearMissSelfCorrections.length > 0) {
    addStage('near_miss_resolution', {
      struggles: nearMissStruggles.map(a => ({
        ref: a.ref,
        hyp: a.hyp,
        evidence: a._nearMissEvidence
      })),
      selfCorrections: nearMissSelfCorrections.map(a => ({
        hyp: a.hyp,
        target: a._nearMissTarget
      }))
    });
  }

  // Run diagnostics (includes Path 1: pause struggle via modified detectStruggleWords)
  const diagnostics = runDiagnostics(transcriptWords, alignment, referenceText);

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

  // VAD Gap Analysis - enrich diagnostics with acoustic context (Phase 18)
  if (vadResult.segments && vadResult.segments.length > 0) {
    enrichDiagnosticsWithVAD(diagnostics, transcriptWords, vadResult.segments);

    // VAD speech overlap per hesitation (BEFORE overhang adjustment)
    const vadGapSummary = computeVADGapSummary(diagnostics);
    const preAdjustmentVAD = diagnostics.onsetDelays?.filter(d => d._vadAnalysis).map(d => ({
      wordIndex: d.wordIndex,
      word: d.word,
      gap: d.gap,
      speechPercent: d._vadAnalysis.speechPercent,
      label: d._vadAnalysis.label
    })) || [];

    // VAD Overhang Adjustment: correct gap values where STT under-timed word endpoints.
    // If a VAD speech segment overlaps with the previous word AND extends past its STT end,
    // the extension is speech overhang (e.g. "soak-ed" where "-ed" continues past STT endpoint).
    // We use the VAD segment end as the "real" word end for gap calculation.
    // Hesitations whose corrected gap falls below threshold are removed.
    const overhangResult = adjustGapsWithVADOverhang(diagnostics, transcriptWords, vadResult.segments);

    addStage('vad_gap_analysis', {
      longPausesAnalyzed: vadGapSummary.longPausesAnalyzed,
      hesitationsAnalyzed: vadGapSummary.hesitationsAnalyzed,
      byLabel: {
        silenceConfirmed: vadGapSummary.silenceConfirmed,
        mostlySilent: vadGapSummary.mostlySilent,
        mixedSignal: vadGapSummary.mixedSignal,
        speechDetected: vadGapSummary.speechDetected,
        continuousSpeech: vadGapSummary.continuousSpeech
      },
      hesitationVAD_beforeAdjustment: preAdjustmentVAD,
      vadOverhangAdjustments: overhangResult.adjustments.length > 0 ? overhangResult.adjustments : 'none',
      hesitationsRemovedByOverhang: overhangResult.removedCount,
      hesitationsAfterAdjustment: diagnostics.onsetDelays?.map(d => ({
        wordIndex: d.wordIndex,
        word: d.word,
        gap: d.gap,
        threshold: d.threshold,
        vadOverhang: d._vadOverhang ? `${d._vadOverhang.overhangMs}ms (${d._vadOverhang.originalGapMs}ms → ${d._vadOverhang.adjustedGapMs}ms)` : null
      })) || [],
      longPauseVAD: diagnostics.longPauses?.filter(p => p._vadAnalysis).map(p => ({
        afterWordIndex: p.afterWordIndex,
        afterWord: transcriptWords[p.afterWordIndex]?.word || '?',
        gap: p.gap,
        speechPercent: p._vadAnalysis.speechPercent,
        label: p._vadAnalysis.label
      })) || []
    });
  }

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
        if (!entry._isSelfCorrection && !entry._partOfStruggle && scHypIndices.has(hypIdx)) {
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
    const refWordsForNL = referenceText.trim().split(/\s+/);

    for (const entry of alignment) {
      if (entry.type === 'insertion') continue;
      if (refWordIndex < nlAnnotations.length) {
        entry.nl = { ...nlAnnotations[refWordIndex] }; // Clone to avoid mutating original

        // Reference capitalization override: if reference is lowercase, it's NOT a proper noun
        // This fixes STT/NL incorrectly marking "brown" as proper noun "Brown"
        const refWord = refWordsForNL[refWordIndex] || '';
        const isAtSentenceStart = refWordIndex === 0 ||
          (refWordIndex > 0 && /[.!?]$/.test(refWordsForNL[refWordIndex - 1]));

        if (!isAtSentenceStart && refWord.length > 0) {
          const refIsLowercase = refWord.charAt(0) === refWord.charAt(0).toLowerCase();
          if (refIsLowercase && entry.nl.isProperNoun) {
            // Override: reference says it's lowercase, so NOT a proper noun
            entry.nl.isProperNoun = false;
            entry.nl.tierOverridden = entry.nl.tier; // Save original for debugging
            entry.nl.tier = 'academic'; // Default to academic tier instead of proper
          }
        }
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
        // BUT: Reference text is ground truth - if it's lowercase there, it's NOT a proper noun
        // (STT often capitalizes common words like "brown" → "Brown" thinking it's a surname)
        const refWordOriginal = refWordsOriginal[refIdx] || '';
        const refIsLowercase = refWordOriginal.length > 0 &&
          refWordOriginal.charAt(0) === refWordOriginal.charAt(0).toLowerCase();

        // NL API detection, but overridden if reference is lowercase
        let isProperViaNL = entry.nl && entry.nl.isProperNoun;
        if (isProperViaNL && refIsLowercase) {
          // Reference has lowercase - author intended it as common word, not proper noun
          isProperViaNL = false;
        }

        const isProperViaCaps = isCapitalized(refWordsOriginal[refIdx], refIdx);

        const logEntry = {
          refWord: entry.ref,
          hypWord: entry.hyp,
          refIdx,
          isProperViaNL,
          isProperViaCaps,
          refIsLowercase,
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

  // Terminal Leniency: Apply phonetic matching to final word if it's a low-confidence substitution
  // This handles the "hen"/"hand"/"and" problem where ASR struggles with trailing words.
  // A human teacher would give credit for phonetically close attempts at the end of a passage.
  const terminalLeniencyLog = { applied: false, details: null };

  if (alignment.length > 0) {
    // Find the last non-insertion entry (the actual last reference word)
    let lastRefIdx = alignment.length - 1;
    while (lastRefIdx >= 0 && alignment[lastRefIdx].type === 'insertion') {
      lastRefIdx--;
    }

    if (lastRefIdx >= 0) {
      const lastEntry = alignment[lastRefIdx];

      // Only apply to substitutions that weren't already forgiven
      if (lastEntry.type === 'substitution' && !lastEntry.forgiven) {
        // Find the confidence for this word from transcript
        // The last STT word should correspond to this alignment entry
        const lastSttWord = transcriptWords[transcriptWords.length - 1];
        const confidence = lastSttWord?.confidence || 0;

        // Check the primary merged word first
        let leniencyResult = checkTerminalLeniency(
          lastEntry.ref,
          lastEntry.hyp,
          confidence
        );

        // If primary doesn't match, check alternative model transcription
        // (e.g., if merged word is "and" but default model heard "hand")
        let alternativeWord = null;
        if (!leniencyResult.isMatch && lastSttWord?._debug) {
          // Extract the other model's word
          const debug = lastSttWord._debug;
          if (debug.default && debug.latestLong) {
            // Find which one differs from the merged word
            const defaultWord = typeof debug.default === 'string'
              ? debug.default.split(' ')[0]
              : debug.default?.word;
            const latestWord = typeof debug.latestLong === 'string'
              ? debug.latestLong.split(' ')[0]
              : debug.latestLong?.word;

            const mergedLower = lastEntry.hyp.toLowerCase();
            if (defaultWord && defaultWord.toLowerCase() !== mergedLower) {
              alternativeWord = defaultWord;
            } else if (latestWord && latestWord.toLowerCase() !== mergedLower) {
              alternativeWord = latestWord;
            }
          }

          if (alternativeWord) {
            const altResult = checkTerminalLeniency(lastEntry.ref, alternativeWord, confidence);
            if (altResult.isMatch) {
              leniencyResult = altResult;
              leniencyResult.viaAlternative = alternativeWord;
            }
          }
        }

        terminalLeniencyLog.details = {
          refWord: lastEntry.ref,
          hypWord: lastEntry.hyp,
          alternativeWord: alternativeWord,
          confidence: Math.round(confidence * 100) / 100,
          refPhonetic: leniencyResult.refCode,
          hypPhonetic: leniencyResult.asrCode,
          reason: leniencyResult.reason,
          viaAlternative: leniencyResult.viaAlternative || null,
          granted: leniencyResult.isMatch
        };

        if (leniencyResult.isMatch && leniencyResult.reason !== 'exact') {
          // Grant terminal leniency - mark as correct via "healed"
          lastEntry.originalHyp = lastEntry.hyp; // Save original for tooltip
          lastEntry.type = 'correct';
          lastEntry.healed = true;
          lastEntry.healReason = 'terminal_leniency';
          lastEntry.originalType = 'substitution';
          lastEntry.phoneticMatch = {
            ref: leniencyResult.refCode,
            hyp: leniencyResult.asrCode,
            reason: leniencyResult.reason,
            viaAlternative: leniencyResult.viaAlternative || null
          };
          terminalLeniencyLog.applied = true;
          const matchedWord = leniencyResult.viaAlternative || lastEntry.originalHyp;
          console.log(`[ORF] Terminal leniency: "${matchedWord}" accepted as "${lastEntry.ref}" (phonetic: ${leniencyResult.refCode} ~ ${leniencyResult.asrCode})${leniencyResult.viaAlternative ? ' [via alternative model]' : ''}`);
        }
      }
    }
  }

  addStage('terminal_leniency', terminalLeniencyLog);

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
    struggles: accuracy.struggles,
    insertions: accuracy.insertions,
    forgiven: accuracy.forgiven,
    forgivenessEnabled: accuracy.forgivenessEnabled,
    alignmentSummary: alignment.map(a => ({
      ref: a.ref,
      hyp: a.hyp,
      type: a.type,
      forgiven: a.forgiven,
      partOfForgiven: a.partOfForgiven,
      _strugglePath: a._strugglePath || null,
      _nearMissEvidence: a._nearMissEvidence || null,
      _abandonedAttempt: a._abandonedAttempt || false,
      _isSelfCorrection: a._isSelfCorrection || false,
      _partOfStruggle: a._partOfStruggle || false
    }))
  });

  // ── Prosody metrics — computed AFTER VAD enrichment + gap adjustment ──
  // READ-ONLY: these functions consume finalized diagnostics but never modify them
  const phrasing = computePhrasingQuality(diagnostics, transcriptWords, referenceText, alignment);
  const pauseAtPunctuation = phrasing.insufficient
    ? { coverage: { ratio: null, label: 'Insufficient data' }, precision: { ratio: null, label: 'Insufficient data' }, passagePunctuationDensity: 0 }
    : computePauseAtPunctuation(transcriptWords, referenceText, alignment, phrasing.breakClassification, phrasing._breakSet);
  const paceConsistency = phrasing.insufficient
    ? { insufficient: true, reason: 'Phrasing insufficient' }
    : computePaceConsistency(phrasing.overallPhrasing, transcriptWords);
  const wordOutliers = computeWordDurationOutliers(transcriptWords, alignment);
  const wordSpeedTiers = computeWordSpeedTiers(wordOutliers, alignment);

  diagnostics.prosody = { phrasing, pauseAtPunctuation, paceConsistency, wordOutliers };
  diagnostics.wordSpeed = wordSpeedTiers;

  addStage('prosody', {
    insufficient: phrasing.insufficient || false,
    phrasing: phrasing.insufficient ? null : {
      readingPattern: phrasing.readingPattern.classification,
      medianGap: phrasing.readingPattern.medianGap,
      fluencyMedian: phrasing.fluencyPhrasing.median,
      fluencyMean: phrasing.fluencyPhrasing.mean,
      overallMedian: phrasing.overallPhrasing.median,
      unexpectedBreaks: phrasing.breakClassification.unexpected,
      atPunctuationBreaks: phrasing.breakClassification.atPunctuation
    },
    pauseAtPunctuation: {
      covered: pauseAtPunctuation.coverage?.coveredCount ?? null,
      encountered: pauseAtPunctuation.coverage?.encounteredPunctuationMarks ?? null,
      total: pauseAtPunctuation.coverage?.totalPunctuationMarks ?? null,
      ratio: pauseAtPunctuation.coverage?.ratio ?? null,
      punctPauseThresholdMs: pauseAtPunctuation.coverage?.punctPauseThresholdMs ?? null,
      uncoveredMarks: pauseAtPunctuation.coverage?.uncoveredMarks?.map(m => ({
        punctType: m.punctType,
        afterWord: m.refWord,
        gapMs: m.gap
      })) || [],
      precisionRatio: pauseAtPunctuation.precision?.ratio ?? null,
      precisionDetail: pauseAtPunctuation.precision?.ratio != null
        ? `${pauseAtPunctuation.precision.atPunctuationCount} of ${pauseAtPunctuation.precision.totalPauses} pauses at punctuation`
        : null
    },
    paceConsistency: paceConsistency.insufficient ? null : {
      classification: paceConsistency.classification,
      cv: paceConsistency.cv,
      meanLocalRate: paceConsistency.meanLocalRate,
      phraseCount: paceConsistency.phraseCount
    },
    wordOutliers: wordOutliers.insufficient ? null : {
      outlierCount: wordOutliers.outlierCount,
      baseline: {
        medianMsPerSyl: wordOutliers.baseline.medianDurationPerSyllable,
        upperFence: wordOutliers.baseline.upperFence
      },
      outliers: wordOutliers.outliers.slice(0, 5).map(o => ({
        word: o.refWord || o.word,
        syllables: o.syllables,
        msPerSyl: o.normalizedDurationMs,
        aboveFenceBy: o.aboveFenceBy
      }))
    }
  });

  displayAlignmentResults(
    alignment,
    wcpm,
    accuracy,
    sttLookup,
    diagnostics,
    transcriptWords,
    tierBreakdown,
    // Prefer Kitchen Sink disfluencyStats (Phase 24) over Phase 14 severity summary
    data._kitchenSink?.disfluencyStats || null,
    data._safety || null,                  // Collapse state and safety flags
    referenceText                          // Raw reference text for cosmetic punctuation
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
    // Assemble prosody snapshot for storage
    const prosodySnapshot = (() => {
      const p = diagnostics.prosody;
      if (!p || p.phrasing.insufficient) return null;
      return {
        phrasing: {
          fluencyMean: p.phrasing.fluencyPhrasing.mean,
          fluencyMedian: p.phrasing.fluencyPhrasing.median,
          overallMean: p.phrasing.overallPhrasing.mean,
          overallMedian: p.phrasing.overallPhrasing.median,
          totalPhrasesOverall: p.phrasing.overallPhrasing.totalPhrases,
          unexpectedBreaks: p.phrasing.breakClassification.unexpected,
          atPunctuationBreaks: p.phrasing.breakClassification.atPunctuation,
          readingPattern: p.phrasing.readingPattern.classification,
          medianGap: p.phrasing.readingPattern.medianGap,
          gapFence: p.phrasing.gapDistribution.gapFence
        },
        pauseAtPunctuation: {
          coverageRatio: p.pauseAtPunctuation.coverage.ratio,
          coveredCount: p.pauseAtPunctuation.coverage.coveredCount,
          encounteredPunctuationMarks: p.pauseAtPunctuation.coverage.encounteredPunctuationMarks,
          totalPunctuationMarks: p.pauseAtPunctuation.coverage.totalPunctuationMarks,
          precisionRatio: p.pauseAtPunctuation.precision.ratio,
          notAtPunctuationCount: p.pauseAtPunctuation.precision.notAtPunctuationCount,
          passagePunctuationDensity: p.pauseAtPunctuation.passagePunctuationDensity
        },
        paceConsistency: p.paceConsistency.insufficient ? null : {
          cv: p.paceConsistency.cv,
          classification: p.paceConsistency.classification,
          meanLocalRate: p.paceConsistency.meanLocalRate,
          sdLocalRate: p.paceConsistency.sdLocalRate,
          phraseCount: p.paceConsistency.phraseCount
        },
        wordOutliers: p.wordOutliers.insufficient ? null : {
          medianDurationPerSyllable: p.wordOutliers.baseline.medianDurationPerSyllable,
          upperFence: p.wordOutliers.baseline.upperFence,
          effectiveIQR: p.wordOutliers.baseline.effectiveIQR,
          outlierCount: p.wordOutliers.outlierCount,
          outliers: p.wordOutliers.outliers.map(o => ({
            word: o.refWord || o.word,
            refIndex: o.refIndex,
            normalizedMs: o.normalizedDurationMs,
            aboveFenceBy: o.aboveFenceBy,
            syllables: o.syllables
          }))
        },
        passageSnippet: referenceText.substring(0, 50),
        assessedAt: new Date().toISOString()
      };
    })();

    saveAssessment(appState.selectedStudentId, {
      _id: assessmentId,
      wcpm: wcpm ? wcpm.wcpm : null,
      accuracy: accuracy.accuracy,
      totalWords: accuracy.totalRefWords,
      errors: accuracy.substitutions + accuracy.omissions,
      duration: effectiveElapsedSeconds,
      passagePreview: referenceText.slice(0, 60),
      passageText: referenceText,
      errorBreakdown,
      alignment,
      sttWords: transcriptWords,
      audioRef: appState.audioBlob ? assessmentId : null,
      nlAnnotations,
      prosody: prosodySnapshot,
      _ensemble: data._ensemble || null,  // Preserves ensemble debug data
      _vad: data._vad || null,  // Preserves VAD ghost detection data
      _classification: data._classification || null,  // Preserves confidence classification data
      _disfluency: data._disfluency || null,  // Preserves disfluency detection data
      _safety: data._safety || null  // Preserves safety check data
    });
    refreshStudentUI();
    setStatus('Done (saved).');

    // ── Post-assessment launchers ──
    if (appState.audioBlob) {
      showPlaybackButton(appState.selectedStudentId, assessmentId);
    }
    showMazeButton(appState.selectedStudentId, assessmentId, referenceText);

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
console.log('[VAD UI] Setting up VAD UI elements...');
const vadCalibrateBtn = document.getElementById('vadCalibrateBtn');
const vadCalibrationStatus = document.getElementById('vadCalibrationStatus');
const vadThresholdSlider = document.getElementById('vadThresholdSlider');
const vadThresholdValue = document.getElementById('vadThresholdValue');
const vadNoiseInfo = document.getElementById('vadNoiseInfo');
const vadPresetBtns = document.querySelectorAll('.vad-preset');
console.log('[VAD UI] Elements found:', {
  calibrateBtn: !!vadCalibrateBtn,
  status: !!vadCalibrationStatus,
  presetBtns: vadPresetBtns.length
});

// Calibrate button
if (vadCalibrateBtn) {
  console.log('[VAD UI] Calibrate button found, attaching listener');
  vadCalibrateBtn.addEventListener('click', async () => {
    console.log('[VAD UI] Calibrate button clicked');
    vadCalibrateBtn.disabled = true;
    // Show spinner per CONTEXT.md: "simple spinner with 'Calibrating...' text"
    vadCalibrationStatus.innerHTML = '<span class="vad-spinner"></span>Calibrating...';

    console.log('[VAD UI] Calling vadProcessor.calibrateMicrophone()...');
    const result = await vadProcessor.calibrateMicrophone();
    console.log('[VAD UI] Calibration result:', result);

    if (result.error) {
      vadCalibrationStatus.textContent = `Error: ${result.error}`;
    } else {
      vadCalibrationStatus.textContent = 'Calibrated';

      // Update slider (for dev mode users)
      if (vadThresholdSlider) {
        vadThresholdSlider.value = result.threshold;
        vadThresholdValue.textContent = result.threshold.toFixed(2);
      }

      // Show noise info with precise values
      vadNoiseInfo.style.display = 'block';
      vadNoiseInfo.innerHTML = `Noise: ${result.noiseRatio.toFixed(2)} (${result.noiseLevel}) → Threshold: ${result.threshold.toFixed(2)}`;
      vadNoiseInfo.className = 'vad-info' + (result.noiseLevel === 'High' ? ' high-noise' : '');

      // Subtle note for high noise
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
  // Dev mode on by default; only disable if explicitly set to 'false'
  if (localStorage.getItem('orf_dev_mode') !== 'false') {
    document.body.classList.add('dev-mode');
  }

  devModeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dev-mode');
    const isDevMode = document.body.classList.contains('dev-mode');
    localStorage.setItem('orf_dev_mode', isDevMode);
  });
}

// --- Cross-validator engine toggle (Phase C) ---
function updateSubtitle() {
  const subtitle = document.querySelector('.subtitle');
  if (subtitle) {
    subtitle.innerHTML = `Reverb + ${getCrossValidatorName()} &mdash; Kitchen Sink Pipeline`;
  }
}

const xvalRadios = document.querySelectorAll('input[name="xvalEngine"]');
if (xvalRadios.length > 0) {
  // Restore saved selection
  const savedEngine = getCrossValidatorEngine();
  xvalRadios.forEach(radio => {
    if (radio.value === savedEngine) radio.checked = true;
    radio.addEventListener('change', () => {
      setCrossValidatorEngine(radio.value);
      updateSubtitle();
    });
  });
  // Set initial subtitle to reflect saved engine
  updateSubtitle();
}
