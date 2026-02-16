import { initRecorder, setOnComplete as recorderSetOnComplete } from './recorder.js';
import { initFileHandler, setOnComplete as fileHandlerSetOnComplete } from './file-handler.js';
// Google Cloud STT — commented out, no longer used (Kitchen Sink pipeline replaces it)
// import { sendToSTT, sendToAsyncSTT, sendChunkedSTT, sendEnsembleSTT } from './stt-api.js';
import { alignWords, consolidateSpilloverFragments } from './alignment.js';
import { getCanonical } from './word-equivalences.js';
import { computeWCPM, computeAccuracy, computeWCPMRange } from './metrics.js';
import { setStatus, displayResults, displayAlignmentResults, showAudioPlayback, renderStudentSelector, renderHistory } from './ui.js';
import { runDiagnostics, computeTierBreakdown, resolveNearMissClusters, absorbMispronunciationFragments, computePhrasingQuality, computePauseAtPunctuation, computePaceConsistency, computeWordDurationOutliers, computeWordSpeedTiers, isNearMiss, annotatePauseContext, computeFunctionWordCompression, computeSyntacticAlignment } from './diagnostics.js';
import { extractTextFromImage, extractTextHybrid } from './ocr-api.js';
import { trimPassageToAttempted } from './passage-trimmer.js';
import { analyzePassageText, levenshteinRatio } from './nl-api.js';
import { getStudents, addStudent, deleteStudent, saveAssessment, getAssessments } from './storage.js';
import { saveAudioBlob } from './audio-store.js';
import { initDashboard } from './dashboard.js';
import { initDebugLog, addStage, addWarning, addError, finalizeDebugLog, saveDebugLog } from './debug-logger.js';
import { vadProcessor } from './vad-processor.js';
import { runKitchenSinkPipeline, isKitchenSinkEnabled, computeKitchenSinkStats } from './kitchen-sink-merger.js';
import { getCrossValidatorEngine, setCrossValidatorEngine, getCrossValidatorName } from './cross-validator.js';
import { padAudioWithSilence } from './audio-padding.js';
import { enrichDiagnosticsWithVAD, computeVADGapSummary, adjustGapsWithVADOverhang } from './vad-gap-analyzer.js';
import { canRunMaze } from './maze-generator.js';
import { loadPhonemeData, getPhonemeCount, getPhonemeCountWithFallback } from './phoneme-counter.js';
import { generateMovieTrailer } from './movie-trailer.js';
import { syllabifyWord, analyzeSyllableCoverage, analyzeFragmentsCoverage } from './syllable-analysis.js';

// Code version for cache verification
const CODE_VERSION = 'v39-2026-02-07';
console.log('[ORF] Code version:', CODE_VERSION);

// Pre-load CMUdict phoneme data (used by word speed normalization)
loadPhonemeData();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
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

function showRhythmRemixButton(studentId, assessmentId) {
  // Remove existing button if present
  const existing = document.getElementById('rhythmRemixBtn');
  if (existing) existing.remove();

  const btn = document.createElement('button');
  btn.id = 'rhythmRemixBtn';
  btn.textContent = 'Rhythm Remix';
  btn.style.cssText = 'margin:0.5rem 0 0.5rem 0.5rem;padding:0.6rem 1.2rem;background:linear-gradient(135deg, #e8a87c, #d4a5c7);color:#1a1520;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer;';
  btn.addEventListener('click', () => {
    localStorage.setItem('orf_playback_student', studentId);
    localStorage.setItem('orf_playback_assessment', assessmentId);
    const base = window.location.href.replace(/[^/]*$/, '');
    window.open(base + 'rhythm-remix.html', 'orf_remix', 'width=800,height=700');
  });

  // Insert after the maze button, or after playback button, or after analyze button
  const anchor = document.getElementById('mazeGameBtn')
    || document.getElementById('mazeDifficulty')
    || document.getElementById('playbackAdventureBtn')
    || analyzeBtn;
  anchor.insertAdjacentElement('afterend', btn);
}

function showIllustratorButton(studentId, assessmentId) {
  const existing = document.getElementById('illustratorBtn');
  if (existing) existing.remove();

  const btn = document.createElement('button');
  btn.id = 'illustratorBtn';
  btn.textContent = 'Reading Illustrator';
  btn.style.cssText = 'margin:0.5rem 0 0.5rem 0.5rem;padding:0.6rem 1.2rem;background:#2e7d32;color:#fff;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer;';
  btn.addEventListener('click', () => {
    localStorage.setItem('orf_playback_student', studentId);
    localStorage.setItem('orf_playback_assessment', assessmentId);
    const base = window.location.href.replace(/[^/]*$/, '');
    window.open(base + 'illustrator.html?student=' + encodeURIComponent(studentId) + '&assessment=' + encodeURIComponent(assessmentId), 'orf_illustrator', 'width=800,height=700');
  });

  const anchor = document.getElementById('rhythmRemixBtn')
    || document.getElementById('mazeGameBtn')
    || document.getElementById('mazeDifficulty')
    || document.getElementById('playbackAdventureBtn')
    || analyzeBtn;
  anchor.insertAdjacentElement('afterend', btn);
}

function showMovieTrailerButton(referenceText, studentName) {
  const existing = document.getElementById('movieTrailerBtn');
  if (existing) existing.remove();

  if (!referenceText || referenceText.trim().length < 20) return;

  const btn = document.createElement('button');
  btn.id = 'movieTrailerBtn';
  btn.textContent = 'Movie Trailer';
  btn.style.cssText = 'margin:0.5rem 0 0.5rem 0.5rem;padding:0.6rem 1.2rem;background:linear-gradient(135deg,#e94560,#0f3460);color:#fff;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer;';
  btn.addEventListener('click', () => {
    generateMovieTrailer(referenceText, studentName);
  });

  const anchor = document.getElementById('rhythmRemixBtn')
    || document.getElementById('mazeGameBtn')
    || document.getElementById('playbackAdventureBtn')
    || analyzeBtn;
  anchor.insertAdjacentElement('afterend', btn);
}

function showFutureYouButton(studentId, assessmentId) {
  const existing = document.getElementById('futureYouBtn');
  if (existing) existing.remove();

  const btn = document.createElement('button');
  btn.id = 'futureYouBtn';
  btn.textContent = 'Future You';
  btn.style.cssText = 'margin:0.5rem 0 0.5rem 0.5rem;padding:0.6rem 1.2rem;background:linear-gradient(135deg,#7ec8e3,#3a7bd5);color:#fff;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer;';
  btn.addEventListener('click', () => {
    localStorage.setItem('orf_playback_student', studentId);
    localStorage.setItem('orf_playback_assessment', assessmentId);
    const base = window.location.href.replace(/[^/]*$/, '');
    window.open(base + 'future-you.html', 'orf_future_you', 'width=800,height=600');
  });

  const anchor = document.getElementById('movieTrailerBtn')
    || document.getElementById('illustratorBtn')
    || document.getElementById('rhythmRemixBtn')
    || document.getElementById('playbackAdventureBtn')
    || analyzeBtn;
  anchor.insertAdjacentElement('afterend', btn);
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
  // Ensure backend config is loaded (fetches from backend-config.json if needed)
  const { backendReady } = await import('./backend-config.js');
  await backendReady;

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
    addStage('audio_padding', { applied: true, paddingMs: 1000, encoding: 'LINEAR16', sampleRate: sampleRateHertz });
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
          end: w.endTime
        }))
      });
    }

    // Raw Reverb word lists (before alignment/cross-validation)
    if (kitchenSinkResult.reverb) {
      const rev = kitchenSinkResult.reverb;
      const mapReverb = (w, i) => ({
        idx: i, word: w.word,
        start: w.startTime, end: w.endTime
      });
      addStage('reverb_raw', {
        description: 'Raw Reverb word lists before alignment/cross-validation (v1.0=verbatim, v0.0=clean)',
        verbatim: {
          wordCount: rev.verbatim?.words?.length || 0,
          transcript: rev.verbatim?.transcript || '',
          words: (rev.verbatim?.words || []).map(mapReverb)
        },
        clean: {
          wordCount: rev.clean?.words?.length || 0,
          transcript: rev.clean?.transcript || '',
          words: (rev.clean?.words || []).map(mapReverb)
        }
      });
    }

    // Per-word timestamp comparison: all three sources
    const _parseTs = t => parseFloat(String(t).replace('s', '')) || 0;
    addStage('timestamp_sources', {
      description: 'All timestamp sources per word (cross-validator=primary, Reverb v1.0=verbatim, Reverb v0.0=clean)',
      words: mergedWords.map(w => {
        const entry = { word: w.word, crossValidation: w.crossValidation };
        // Phoneme count (for duration normalization)
        const ph = getPhonemeCountWithFallback(w.word);
        entry.phonemes = ph.count;
        entry.phonemeSource = ph.source;
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
    // =========================================================================
    // Kitchen Sink direct pass-through
    // =========================================================================
    // Raw V1 words go directly to alignment — 3-way comparison happens after.
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
      _kitchenSink: {
        xvalRawWords: kitchenSinkResult.xvalRaw?.words || [],
        reverbVerbatimWords: kitchenSinkResult.reverb?.verbatim?.words || [],
        reverbCleanWords: kitchenSinkResult.reverb?.clean?.words || []
      }
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

  const parseT = (t) => parseFloat(String(t).replace('s', '')) || 0;

  // ── Reference-aware fragment pre-merge ───────────────────────────
  // Reverb BPE sometimes splits a single spoken word into fragments
  // (e.g., "platforms" → "pla" + "forms"). Detect adjacent short words
  // whose concatenation matches a reference word, and merge them into a
  // single token before NW alignment. This prevents NW from scattering
  // fragments to wrong reference slots.
  //
  // Uses normalized reference words as authority — no crossValidation dependency.
  {
    const { normalizeText } = await import('./text-normalize.js');
    const refNormSet = new Set(normalizeText(referenceText).map(w => w.toLowerCase().replace(/[^a-z'-]/g, '')));
    const MAX_FRAG_LEN = 4;
    const MAX_GAP_S = 0.3;
    const merged = [];
    let i = 0;

    while (i < transcriptWords.length) {
      const w = transcriptWords[i];
      const wStripped = w.word.replace(/[^a-zA-Z']/g, '');

      if (wStripped.length <= MAX_FRAG_LEN) {
        const group = [i];
        for (let j = i + 1; j < transcriptWords.length; j++) {
          const next = transcriptWords[j];
          const nextStripped = next.word.replace(/[^a-zA-Z']/g, '');
          if (nextStripped.length > MAX_FRAG_LEN) break;
          const prevEnd = parseT(transcriptWords[j - 1].endTime);
          const nextStart = parseT(next.startTime);
          if (nextStart - prevEnd > MAX_GAP_S) break;
          group.push(j);
        }

        if (group.length >= 2) {
          let matched = false;
          let concat = '';
          for (let k = 0; k < group.length; k++) {
            concat += transcriptWords[group[k]].word;
            const concatNorm = concat.toLowerCase().replace(/[^a-z'-]/g, '').replace(/['\u2018\u2019\u201B`]/g, '');
            if (k > 0 && refNormSet.has(concatNorm)) {
              const parts = group.slice(0, k + 1).map(idx => transcriptWords[idx].word);
              const first = transcriptWords[group[0]];
              const last = transcriptWords[group[k]];
              merged.push({
                ...first,
                word: concat,
                endTime: last.endTime,
                _reverbEndTime: last._reverbEndTime || last.endTime,
                _mergedFragments: parts,
                _mergedFrom: 'pre-alignment-fragment-merge'
              });
              console.log(`[Fragment Merge] Merged ${parts.length} Reverb fragments: "${parts.join('" + "')}" → "${concat}" (ref match)`);
              i = group[k] + 1;
              matched = true;
              break;
            }
          }
          if (matched) continue;
        }
      }

      merged.push(w);
      i++;
    }
    transcriptWords.length = 0;
    transcriptWords.push(...merged);
  }

  // Log STT words with full details for maximum transparency
  // NOTE: After Phase 13, transcriptWords excludes ghost words (filtered before alignment)

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
  // Key by raw normalized word (NOT canonical) — alignment output uses raw
  // normalizeText() forms, not getCanonical(). Using canonical here caused
  // misses: "volume"→"vol", "and"→"&", etc.
  const sttLookup = new Map();
  for (const w of transcriptWords) {
    const norm = w.word.toLowerCase().replace(/^[^\w'-]+|[^\w'-]+$/g, '').replace(/\./g, '').replace(/['\u2018\u2019\u201B`]/g, '').replace(/-+$/, '');
    if (!sttLookup.has(norm)) sttLookup.set(norm, []);
    sttLookup.get(norm).push(w);
  }

  // ── Three independent reference alignments (Plan 6) ──────────────
  // V1 (Reverb verbatim), V0 (Reverb clean), and Parakeet are each
  // independently NW-aligned to the reference text. Per-ref-word comparison
  // determines final verdicts without the fragile V0→V1→V2→V3 chain.

  // 4a. V1 alignment (primary — drives display, tooltips, audio)
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

  // 4b. V0 alignment (Reverb clean)
  const v0Words = data._kitchenSink?.reverbCleanWords || [];
  const v0Alignment = v0Words.length > 0 ? alignWords(referenceText, v0Words) : null;

  // 4c. Parakeet alignment
  // Pre-split hyphenated Parakeet words so each part gets its own index and
  // proportional timestamps.  Mirrors the hyphen-splitting in normalizeText():
  //   "in-person" → [{word:"in",…}, {word:"person",…}]
  // Single-letter parts (e-mail, x-ray) are kept joined, matching normalizeText.
  const rawPkWords = data._kitchenSink?.xvalRawWords || [];
  const parakeetWords = [];
  for (const w of rawPkWords) {
    const raw = w.word || '';
    if (!raw.includes('-')) { parakeetWords.push(w); continue; }
    const core = raw.toLowerCase().replace(/^[^\w'-]+|[^\w'-]+$/g, '').replace(/\./g, '');
    const parts = core.split('-').filter(p => p.length > 0);
    if (parts.length <= 1 || (parts.length >= 2 && parts[0].length === 1)) {
      parakeetWords.push(w); continue;
    }
    const startS = parseFloat(w.startTime) || 0;
    const endS = parseFloat(w.endTime) || 0;
    const dur = endS - startS;
    const totalChars = parts.reduce((s, p) => s + p.length, 0);
    let cursor = startS;
    for (let i = 0; i < parts.length; i++) {
      const frac = parts[i].length / totalChars;
      const partEnd = (i === parts.length - 1) ? endS : cursor + dur * frac;
      parakeetWords.push({
        word: parts[i],
        startTime: cursor.toFixed(3) + 's',
        endTime: partEnd.toFixed(3) + 's'
      });
      cursor = partEnd;
    }
  }
  const parakeetAlignment = parakeetWords.length > 0
    ? alignWords(referenceText, parakeetWords)
    : null;

  // 4d. Spillover fragment consolidation (each engine independently)
  // Fixes NW greedily assigning struggle fragments to wrong ref slots.
  const v1Spillover = consolidateSpilloverFragments(alignment, isNearMiss);
  const v0Spillover = v0Alignment ? consolidateSpilloverFragments(v0Alignment, isNearMiss) : [];
  const pkSpillover = parakeetAlignment ? consolidateSpilloverFragments(parakeetAlignment, isNearMiss) : [];
  if (v1Spillover.length || v0Spillover.length || pkSpillover.length) {
    addStage('spillover_consolidation', { v1: v1Spillover, v0: v0Spillover, pk: pkSpillover });
  }

  addStage('v1_alignment', {
    totalEntries: alignment.length,
    correct: alignment.filter(a => a.type === 'correct').length,
    substitutions: alignment.filter(a => a.type === 'substitution').length,
    omissions: alignment.filter(a => a.type === 'omission').length,
    insertions: alignment.filter(a => a.type === 'insertion').length,
    compoundWords: alignment.filter(a => a.compound).length,
    compoundDetails: alignment.filter(a => a.compound).map(a => ({ ref: a.ref, parts: a.parts }))
  });
  if (v0Alignment) {
    addStage('v0_alignment', {
      totalEntries: v0Alignment.length,
      correct: v0Alignment.filter(a => a.type === 'correct').length,
      substitutions: v0Alignment.filter(a => a.type === 'substitution').length,
      omissions: v0Alignment.filter(a => a.type === 'omission').length,
      insertions: v0Alignment.filter(a => a.type === 'insertion').length
    });
  }

  // ── Compound struggle reclassification (BEFORE 3-way) ──────────────
  // V1 compound merges = student produced fragments, not a fluent read.
  // Reclassify before 3-way so the verdict sees V1 as non-correct.
  // Exception: abbreviation expansions (e.g., "et cetera" for "etc.") are correct reads,
  // not struggles — the student read the full form of an abbreviated reference word.
  {
    const compoundStruggles = [];
    for (const entry of alignment) {
      if (entry.type === 'correct' && entry.compound && entry.parts && entry.parts.length >= 2
          && !entry._abbreviationExpansion && !entry._numberExpansion) {
        entry.type = 'struggle';
        entry._nearMissEvidence = entry.parts;
        compoundStruggles.push({ ref: entry.ref, hyp: entry.hyp, parts: entry.parts });
      }
    }
    if (compoundStruggles.length > 0) {
      addStage('compound_struggle', {
        count: compoundStruggles.length,
        entries: compoundStruggles
      });
      console.log(`[Struggle] Reclassified ${compoundStruggles.length} compound merge(s) as struggle:`,
        compoundStruggles.map(s => `"${s.ref}" ← [${s.parts.join(', ')}]`));
    }
  }

  // Create synthetic sttLookup entries for compound words
  for (const item of alignment) {
    if (item.compound && item.parts) {
      const partWords = [];
      for (const part of item.parts) {
        const partKey = part.toLowerCase().replace(/^[^\w'-]+|[^\w'-]+$/g, '').replace(/\./g, '');
        const queue = sttLookup.get(partKey);
        if (queue && queue.length > 0) {
          partWords.push(queue.shift());
        }
      }
      if (partWords.length > 0) {
        const first = partWords[0];
        const last = partWords[partWords.length - 1];
        if (!sttLookup.has(item.hyp)) {
          sttLookup.set(item.hyp, []);
        }
        sttLookup.get(item.hyp).push({
          ...first,
          word: item.hyp,
          endTime: last.endTime,
          _xvalEndTime: last._xvalEndTime || last.endTime,
          _reverbEndTime: last._reverbEndTime || last.endTime,
          _xvalWord: partWords.map(w => w._xvalWord || w.word).join(' + '),
          _compoundParts: partWords
        });
      }
    }
  }

  // ── 3-way per-ref-word comparison ──────────────────────────────────
  // Helper: get timestamps via hypIndex from an engine's word array
  function _getEngineTimestamp(entry, words) {
    if (!entry || entry.type === 'omission') return null;
    if (entry.hypIndex == null || entry.hypIndex < 0) return null;
    const w = words[entry.hypIndex];
    if (!w) return null;
    return { word: w.word, startTime: w.startTime, endTime: w.endTime };
  }

  // Helper: set crossValidation status + timestamps on alignment entry and its transcriptWord
  function _setCrossValidation(entry, tWords, status, parakeetTs) {
    entry.crossValidation = status;
    if (parakeetTs) {
      entry._xvalStartTime = parakeetTs.startTime;
      entry._xvalEndTime = parakeetTs.endTime;
    }
    if (entry.hypIndex != null && entry.hypIndex >= 0) {
      const tw = tWords[entry.hypIndex];
      if (tw) {
        tw.crossValidation = status;
        if (parakeetTs) {
          tw.startTime = parakeetTs.startTime;
          tw.endTime = parakeetTs.endTime;
          tw._xvalStartTime = parakeetTs.startTime;
          tw._xvalEndTime = parakeetTs.endTime;
        }
      }
    }
  }

  // Group insertions per ref-word slot for all three engines
  // groups[i] = insertions before the i-th ref entry; groups[N] = trailing insertions
  const _groupInsertions = (fullAlign) => {
    const groups = [];
    let current = [];
    for (const entry of fullAlign) {
      if (entry.type === 'insertion') current.push(entry);
      else { groups.push(current); current = []; }
    }
    groups.push(current);
    return groups;
  };
  const v1InsGroups = _groupInsertions(alignment);
  const v0InsGroups = v0Alignment ? _groupInsertions(v0Alignment) : [];
  const pkInsGroups = parakeetAlignment ? _groupInsertions(parakeetAlignment) : [];

  // Filter insertions to get ref-entry arrays (same length = ref word count)
  const v1Ref = alignment.filter(e => e.type !== 'insertion');
  const v0Ref = v0Alignment ? v0Alignment.filter(e => e.type !== 'insertion') : [];
  const pkRef = parakeetAlignment ? parakeetAlignment.filter(e => e.type !== 'insertion') : [];

  // Validate ref-entry count invariant
  const hasV0 = v0Ref.length === v1Ref.length;
  const hasPk = pkRef.length === v1Ref.length;
  if (v0Alignment && !hasV0) {
    console.warn(`[3-way] V0 ref count mismatch: V1=${v1Ref.length}, V0=${v0Ref.length}. Ignoring V0.`);
  }
  if (parakeetAlignment && !hasPk) {
    console.warn(`[3-way] Parakeet ref count mismatch: V1=${v1Ref.length}, Pk=${pkRef.length}. Ignoring Parakeet.`);
  }

  const xvalRecoveredOmissions = [];
  const threeWayTable = [];

  for (let ri = 0; ri < v1Ref.length; ri++) {
    const v1Entry = v1Ref[ri];
    const v0Entry = hasV0 ? v0Ref[ri] : null;
    const pkEntry = hasPk ? pkRef[ri] : null;

    // Track what each engine produced for this ref word
    const v0Type = v0Entry?.type || null;
    const pkType = pkEntry?.type || null;

    const parakeetTs = hasPk ? _getEngineTimestamp(pkEntry, parakeetWords) : null;
    const v0Ts = hasV0 ? _getEngineTimestamp(v0Entry, v0Words) : null;

    // Store V0 and Parakeet info on the V1 alignment entry
    if (v0Entry) {
      v1Entry._v0Word = v0Entry.hyp;
      v1Entry._v0Type = v0Type;
      if (v0Ts) {
        v1Entry._v0StartTime = v0Ts.startTime;
        v1Entry._v0EndTime = v0Ts.endTime;
      }
    }
    if (pkEntry) {
      if (pkEntry.hyp) v1Entry._xvalWord = pkEntry.hyp;
      v1Entry._pkType = pkType;
    }

    // Store per-engine raw attempt arrays (insertions before this ref word + the ref-matched hyp)
    // Captures the FULL attempt each engine heard, before any downstream mutations.
    // For compound-merged entries, include the parts (compound merge already ran inside alignWords).
    {
      const v1Ins = v1InsGroups[ri] || [];
      const v1Parts = [...v1Ins.map(e => e.hyp)];
      if (v1Entry.compound && v1Entry.parts) v1Parts.push(...v1Entry.parts);
      else if (v1Entry.hyp) v1Parts.push(v1Entry.hyp);
      if (v1Parts.length > 1) v1Entry._v1RawAttempt = v1Parts;
    }
    if (hasV0 && v0Entry) {
      const v0Ins = v0InsGroups[ri] || [];
      const v0Parts = [...v0Ins.map(e => e.hyp)];
      if (v0Entry.compound && v0Entry.parts) v0Parts.push(...v0Entry.parts);
      else if (v0Entry.hyp) v0Parts.push(v0Entry.hyp);
      if (v0Parts.length > 1) v1Entry._v0Attempt = v0Parts;
    }
    if (hasPk && pkEntry) {
      const pkIns = pkInsGroups[ri] || [];
      const pkParts = [...pkIns.map(e => e.hyp)];
      if (pkEntry.compound && pkEntry.parts) pkParts.push(...pkEntry.parts);
      else if (pkEntry.hyp) pkParts.push(pkEntry.hyp);
      if (pkParts.length > 1) v1Entry._xvalAttempt = pkParts;
    }

    // Count how many engines got this word correct
    // V1 compound = student fragmented the word — don't count as clean correct
    const v1Compound = v1Entry.type === 'struggle' && v1Entry.compound;
    const v1Correct = v1Entry.type === 'correct' && !v1Entry.compound;
    const v0Correct = v0Type === 'correct';
    const pkCorrect = pkType === 'correct';
    const correctCount = (v1Correct ? 1 : 0) + (v0Correct ? 1 : 0) + (pkCorrect ? 1 : 0);

    const v1Omitted = v1Entry.type === 'omission';
    const v0Omitted = v0Type === 'omission';
    const pkOmitted = pkType === 'omission';
    const omitCount = (v1Omitted ? 1 : 0) + (v0Omitted ? 1 : 0) + (pkOmitted ? 1 : 0);

    let status;

    if (v1Omitted && pkOmitted && (!hasV0 || v0Omitted)) {
      // All engines omitted — confirmed omission, skip
      threeWayTable.push({ ref: v1Entry.ref, v1: '—', v0: v0Entry ? '—' : 'n/a', pk: pkEntry ? '—' : 'n/a', status: 'confirmed_omission' });
      continue;
    } else if (v1Omitted && (pkCorrect || (!hasPk && v0Correct))) {
      // V1 omitted but another engine heard it → recovery
      status = 'recovered';
      const recoveryTs = parakeetTs || v0Ts;
      xvalRecoveredOmissions.push({ refIndex: ri, entry: v1Entry, timestamps: recoveryTs });
    } else if (correctCount >= 2) {
      // Majority correct → confirmed
      status = 'confirmed';
    } else if (v1Compound && (v0Correct || pkCorrect)) {
      // V1 fragmented but matched + another engine confirms → confirmed (struggle preserved on entry)
      status = 'confirmed';
    } else if (v1Compound) {
      // V1 fragmented match but no other engine confirms
      status = hasPk || hasV0 ? 'unconfirmed' : 'unavailable';
    } else if (v1Correct && !v0Correct && !pkCorrect) {
      // Only V1 heard it correctly
      status = hasPk || hasV0 ? 'unconfirmed' : 'unavailable';
    } else if (!v1Correct && pkCorrect) {
      // V1 wrong but Parakeet correct → disagreed (Pk is strong)
      status = 'disagreed';
    } else if (!v1Correct && !pkCorrect && v0Correct) {
      // V1 wrong, Pk wrong, V0 correct → disagreed (V0 tiebreak)
      status = 'disagreed';
    } else if (omitCount >= 2) {
      // Majority omitted
      status = 'confirmed';
    } else if (v1Entry.type === 'substitution') {
      // V1 has substitution — check if others agree on the wrong word
      const v1Hyp = (v1Entry.hyp || '').toLowerCase().replace(/[^a-z'-]/g, '');
      const pkHyp = (pkEntry?.hyp || '').toLowerCase().replace(/[^a-z'-]/g, '');
      const v0Hyp = (v0Entry?.hyp || '').toLowerCase().replace(/[^a-z'-]/g, '');
      if ((hasPk && v1Hyp === pkHyp) || (hasV0 && v1Hyp === v0Hyp)) {
        status = 'confirmed';
      } else {
        status = 'disagreed';
      }
    } else {
      status = hasPk || hasV0 ? 'unconfirmed' : 'unavailable';
    }

    _setCrossValidation(v1Entry, transcriptWords, status, parakeetTs);

    // Propagate _xvalWord to transcriptWord
    if (pkEntry?.hyp && v1Entry.hypIndex != null && v1Entry.hypIndex >= 0) {
      const tw = transcriptWords[v1Entry.hypIndex];
      if (tw) tw._xvalWord = pkEntry.hyp;
    }

    threeWayTable.push({
      ref: v1Entry.ref,
      v1: v1Compound ? `⚠(${v1Entry.parts.join('+')})` : v1Entry.type === 'correct' ? '✓' : v1Entry.type === 'omission' ? '—' : `✗(${v1Entry.hyp})`,
      v0: v0Entry ? (v0Type === 'correct' ? '✓' : v0Type === 'omission' ? '—' : `✗(${v0Entry.hyp})`) : 'n/a',
      pk: pkEntry ? (pkType === 'correct' ? '✓' : pkType === 'omission' ? '—' : `✗(${pkEntry.hyp})`) : 'n/a',
      status
    });
  }

  // Store alignments on data for UI rendering
  data._threeWay = { v1Ref, v0Ref: hasV0 ? v0Ref : null, pkRef: hasPk ? pkRef : null, table: threeWayTable };

  console.table(threeWayTable);
  const agreed3 = threeWayTable.filter(t => t.v1 === t.pk || t.v1 === t.v0).length;
  console.log(`[3-way] Agreement: ${agreed3}/${threeWayTable.length}`);
  addStage('three_way_verdict', {
    refWords: v1Ref.length,
    confirmed: threeWayTable.filter(t => t.status === 'confirmed').length,
    disagreed: threeWayTable.filter(t => t.status === 'disagreed').length,
    recovered: threeWayTable.filter(t => t.status === 'recovered').length,
    unconfirmed: threeWayTable.filter(t => t.status === 'unconfirmed').length,
    confirmedOmissions: threeWayTable.filter(t => t.status === 'confirmed_omission').length,
    hasV0, hasPk
  });

  // ── Filler classification ────────────────────────────────────────────
  // Tag known filler words (um, uh, etc.) on transcriptWords so they're
  // excluded from insertion counts and rendered with disfluency styling.
  // Two paths: (1) V1 alignment insertions, (2) pre-filtered words that
  // were stripped before NW alignment and re-injected after.
  const FILLER_WORDS = new Set(['um', 'uh', 'uh-huh', 'mm', 'hmm', 'er', 'ah']);
  {
    for (const ins of alignment.filter(e => e.type === 'insertion')) {
      if (!ins.hyp) continue;
      const norm = ins.hyp.toLowerCase().replace(/[^a-z'-]/g, '');
      if (FILLER_WORDS.has(norm)) {
        const tw = ins.hypIndex >= 0 ? transcriptWords[ins.hypIndex] : null;
        if (tw) { tw.isDisfluency = true; tw.disfluencyType = 'filler'; }
      }
    }
    // Safety net: tag any transcriptWords fillers missed above (e.g., pre-filtered
    // words that alignment.js re-injected but didn't become V1 insertions)
    for (let ti = 0; ti < transcriptWords.length; ti++) {
      const tw = transcriptWords[ti];
      if (tw.isDisfluency) continue;
      const norm = (tw.word || '').toLowerCase().replace(/[^a-z'-]/g, '');
      if (FILLER_WORDS.has(norm)) {
        tw.isDisfluency = true;
        tw.disfluencyType = 'filler';
      }
    }
  }

  // ── Cross-validate insertions (3-way) ─────────────────────────────
  // Check each V1 insertion against V0 and Parakeet at the same ref-word boundary.
  // When all available engines agree, flag as _confirmedInsertion (counts as error).
  {
    const _insNorm = s => (s || '').toLowerCase().replace(/[^a-z'-]/g, '');

    // Build per-position norm lists for V0 and Pk insertions
    const _buildInsNormGroups = (groups) =>
      groups.map(g => g.map(e => _insNorm(e.hyp)));

    const v0InsNormGroups = _buildInsNormGroups(v0InsGroups);
    const pkInsNormGroups = _buildInsNormGroups(pkInsGroups);

    // Also build a flat Parakeet insertion map for the existing confirmed/unconfirmed tagging
    const pInsNorms = new Map();
    if (parakeetAlignment) {
      for (const ins of parakeetAlignment.filter(e => e.type === 'insertion')) {
        const n = _insNorm(ins.hyp);
        if (!pInsNorms.has(n)) pInsNorms.set(n, []);
        pInsNorms.get(n).push(ins);
      }
    }

    // Walk through V1 insertions grouped by ref-word boundary
    for (let pos = 0; pos < v1InsGroups.length; pos++) {
      const v1Ins = v1InsGroups[pos];
      const v0Norms = v0InsNormGroups[pos] || [];
      const pkNorms = pkInsNormGroups[pos] || [];

      for (const entry of v1Ins) {
        if (entry.crossValidation && entry.crossValidation !== 'pending') continue;
        const norm = _insNorm(entry.hyp);

        // Check Parakeet (same as before — sets crossValidation confirmed/unconfirmed)
        const pkMatches = pInsNorms.get(norm);
        const pkHeard = pkMatches && pkMatches.length > 0;
        if (pkHeard) {
          const match = pkMatches.shift();
          const ts = _getEngineTimestamp(match, parakeetWords);
          _setCrossValidation(entry, transcriptWords, 'confirmed', ts);
          if (ts) {
            entry._xvalWord = ts.word;
            if (entry.hypIndex != null && entry.hypIndex >= 0) {
              const tw = transcriptWords[entry.hypIndex];
              if (tw) tw._xvalWord = ts.word;
            }
          }
        }

        // Check V0 at same ref-word position
        const v0Idx = v0Norms.indexOf(norm);
        const v0Heard = v0Idx >= 0;
        if (v0Heard) v0Norms[v0Idx] = ''; // consume to avoid double-match

        // Check Pk at same ref-word position (stricter positional check)
        const pkPosIdx = pkNorms.indexOf(norm);
        const pkPosHeard = pkPosIdx >= 0;
        if (pkPosHeard) pkNorms[pkPosIdx] = ''; // consume

        // 3-way confirmed insertion: all available engines heard it at this position
        // Require at least V1 + one other engine; if both available, both must agree
        const enginesAvailable = 1 + (hasV0 ? 1 : 0) + (hasPk ? 1 : 0);
        const enginesHeard = 1 + (v0Heard ? 1 : 0) + (pkPosHeard ? 1 : 0);
        if (enginesAvailable >= 2 && enginesHeard === enginesAvailable) {
          entry._confirmedInsertion = true;
          entry._insertionEngines = enginesHeard;
        }
      }
    }

    // Sweep remaining pending entries as unconfirmed
    for (const entry of alignment) {
      if (entry.type !== 'insertion') continue;
      if (!entry.crossValidation || entry.crossValidation === 'pending') {
        entry.crossValidation = 'unconfirmed';
        if (entry.hypIndex != null && entry.hypIndex >= 0) {
          const tw = transcriptWords[entry.hypIndex];
          if (tw) tw.crossValidation = 'unconfirmed';
        }
      }
    }
    for (const w of transcriptWords) {
      if (w.crossValidation === 'pending') {
        w.crossValidation = 'unconfirmed';
      }
    }
  }

  // ── Flag CTC artifact <unknown> tokens ────────────────────────────
  for (let i = 0; i < transcriptWords.length; i++) {
    const w = transcriptWords[i];
    if (!(typeof w.word === 'string' && w.word.startsWith('<') && w.word.endsWith('>'))) continue;
    const wStart = parseT(w.startTime);
    const wEnd = parseT(w.endTime);
    if (wEnd - wStart > 0.12) continue;
    for (let j = 0; j < transcriptWords.length; j++) {
      if (j === i) continue;
      const o = transcriptWords[j];
      if (o.crossValidation !== 'confirmed') continue;
      const oStart = parseT(o.startTime);
      const oEnd = parseT(o.endTime);
      if (wStart < oEnd + 0.2 && oStart < wEnd + 0.2) {
        w._ctcArtifact = true;
        break;
      }
    }
  }

  // ── Flag pre-word artifacts: special tokens before first real word ──
  {
    // Find the start time of the first non-special word
    let firstRealStart = Infinity;
    for (const w of transcriptWords) {
      if (typeof w.word === 'string' && w.word.startsWith('<') && w.word.endsWith('>')) continue;
      const s = parseT(w.startTime);
      if (s != null) { firstRealStart = s; break; }
    }
    for (const w of transcriptWords) {
      if (!(typeof w.word === 'string' && w.word.startsWith('<') && w.word.endsWith('>'))) continue;
      const wEnd = parseT(w.endTime);
      if (wEnd != null && wEnd <= firstRealStart) {
        w._preWordArtifact = true;
      }
    }
  }

  // ── Flag post-word artifacts: special tokens after last real word ──
  {
    let lastRealEnd = -Infinity;
    for (let i = transcriptWords.length - 1; i >= 0; i--) {
      const w = transcriptWords[i];
      if (typeof w.word === 'string' && w.word.startsWith('<') && w.word.endsWith('>')) continue;
      const e = parseT(w.endTime);
      if (e != null) { lastRealEnd = e; break; }
    }
    for (const w of transcriptWords) {
      if (!(typeof w.word === 'string' && w.word.startsWith('<') && w.word.endsWith('>'))) continue;
      const wStart = parseT(w.startTime);
      if (wStart != null && wStart >= lastRealEnd) {
        w._postWordArtifact = true;
      }
    }
  }

  // ── Omission recovery ─────────────────────────────────────────────
  const splicePositions = [];
  for (const recovery of xvalRecoveredOmissions) {
    const entry = recovery.entry;
    const ts = recovery.timestamps;
    if (!ts) continue;

    const recoveredWord = {
      word: ts.word,
      startTime: ts.startTime,
      endTime: ts.endTime,
      crossValidation: 'recovered',
      _xvalStartTime: ts.startTime,
      _xvalEndTime: ts.endTime,
      _xvalWord: ts.word,
      _reverbStartTime: null,
      _reverbEndTime: null,
      _recovered: true
    };

    const xvStart = parseT(ts.startTime);
    let insertIdx = transcriptWords.length;
    for (let k = 0; k < transcriptWords.length; k++) {
      if (parseT(transcriptWords[k].startTime) > xvStart) {
        insertIdx = k;
        break;
      }
    }
    transcriptWords.splice(insertIdx, 0, recoveredWord);

    entry.type = 'correct';
    entry.hyp = ts.word;
    entry.hypIndex = insertIdx;
    entry._recovered = true;

    const lookupKey = ts.word.toLowerCase().replace(/[^a-z'-]/g, '').replace(/\./g, '').replace(/['\u2018\u2019\u201B`]/g, '');
    if (!sttLookup.has(lookupKey)) sttLookup.set(lookupKey, []);
    sttLookup.get(lookupKey).push(recoveredWord);

    splicePositions.push(insertIdx);
  }

  if (xvalRecoveredOmissions.length > 0) {
    const lastRefIdx = alignment.reduce((acc, e, i) => e.ref != null ? i : acc, -1);
    if (lastRefIdx >= 0 && alignment[lastRefIdx]._recovered) {
      alignment[lastRefIdx]._isLastRefWord = true;
      const recKey = alignment[lastRefIdx].hyp?.toLowerCase().replace(/[^a-z'-]/g, '').replace(/\./g, '');
      const recQueue = sttLookup.get(recKey);
      if (recQueue) recQueue.forEach(w => { w._isLastRefWord = true; });
    }

    if (splicePositions.length > 0) {
      splicePositions.sort((a, b) => a - b);
      for (const entry of alignment) {
        if (entry.hypIndex == null || entry.hypIndex < 0) continue;
        if (entry._recovered) continue;
        let displacement = 0;
        for (const pos of splicePositions) {
          if (pos <= entry.hypIndex + displacement) displacement++;
          else break;
        }
        entry.hypIndex += displacement;
      }
    }

    const recoveredList = xvalRecoveredOmissions.filter(r => r.timestamps).map(r => ({
      word: r.timestamps.word,
      start: r.timestamps.startTime,
      end: r.timestamps.endTime
    }));
    addStage('omission_recovery', {
      recoveredCount: recoveredList.length,
      recovered: recoveredList
    });
    console.log(`[omission-recovery] Recovered ${recoveredList.length} omissions via 3-way cross-validation:`,
      recoveredList.map(r => r.word));
  }

  // Cross-validator abbreviation confirmation
  const xvalRawWords = data._kitchenSink?.xvalRawWords || [];
  if (xvalRawWords.length > 0) {
    const xvalConfirmedSet = new Set();
    for (const xw of xvalRawWords) {
      if (xw.word) {
        const stripped = xw.word.toLowerCase().replace(/\./g, '').replace(/[^a-z'-]/g, '').replace(/['\u2018\u2019\u201B`]/g, '');
        if (stripped) xvalConfirmedSet.add(stripped);
      }
    }

    const abbrConfirmed = [];
    for (const entry of alignment) {
      if (entry.type !== 'substitution' || !entry.ref) continue;
      const refNorm = entry.ref.toLowerCase();
      const hypNorm = (entry.hyp || '').toLowerCase();
      if (refNorm.length > 5 || hypNorm.length > 2) continue;
      if (xvalConfirmedSet.has(refNorm)) {
        entry.type = 'correct';
        entry._xvalAbbrConfirmed = true;
        abbrConfirmed.push({ ref: entry.ref, hyp: entry.hyp });
      }
    }

    if (abbrConfirmed.length > 0) {
      addStage('xval_abbreviation_confirmation', {
        count: abbrConfirmed.length,
        confirmed: abbrConfirmed
      });
    }
  }

  // Resolve near-miss clusters — Path 2: decoding struggle (single pass)
  // Runs AFTER omission recovery so recovered 'correct' words can serve as anchors.
  resolveNearMissClusters(alignment);

  const nearMissStruggles = alignment.filter(a => a.type === 'struggle' && a._nearMissEvidence?.length > 0);
  if (nearMissStruggles.length > 0) {
    addStage('near_miss_resolution', {
      struggles: nearMissStruggles.map(a => ({
        ref: a.ref,
        hyp: a.hyp,
        evidence: a._nearMissEvidence
      }))
    });
  }

  // Absorb BPE fragments of mispronounced words into their parent struggle/substitution.
  // Uses temporal containment: substitutions already carry Parakeet timestamps from
  // reference-anchored cross-validation (no separate xvalRawWords needed).
  absorbMispronunciationFragments(alignment, transcriptWords);
  const absorbedCount = alignment.filter(e => e._partOfStruggle && e.type === 'insertion').length;
  if (absorbedCount > 0) {
    addStage('fragment_absorption', { count: absorbedCount });
  }

  // Run diagnostics (includes Path 1: pause struggle via modified detectStruggleWords)
  const diagnostics = runDiagnostics(transcriptWords, alignment, referenceText, xvalRawWords);

  // ── Syllable Coverage Annotation ─────────────────────────────────
  // Annotate substitutions, struggles, and confirmed insertions with
  // syllable-level coverage data. Targets the orange (attempted-struggled),
  // red (definite-struggle), blue (confirmed-substitution), and purple
  // (confirmed-insertion) UI buckets. Skips correct, forgiven, and omissions.
  for (let i = 0; i < alignment.length; i++) {
    const entry = alignment[i];
    // Confirmed insertions: no ref word, just syllabify the inserted word itself
    if (entry.type === 'insertion' && entry._confirmedInsertion) {
      const hyp = (entry.hyp || '').toLowerCase().replace(/[^a-z]/g, '');
      if (hyp.length >= 4) {
        const sylls = syllabifyWord(hyp);
        entry._syllableCoverage = { fragment: hyp, refWord: null, refSyllables: sylls,
          totalSyllables: sylls.length, syllablesCovered: sylls.length,
          coverageRatio: 1, position: 'insertion', coveredSyllables: sylls, partialNext: false };
      }
      continue;
    }
    // Substitutions and (legacy) struggles — words where the student said something wrong
    if (entry.type !== 'substitution' && entry.type !== 'struggle') continue;
    if (entry.forgiven || entry._oovRecoveredViaUnknown) continue;
    const ref = (entry.ref || '').toLowerCase().replace(/[^a-z]/g, '');
    if (ref.length < 4) continue;

    // Build full attempt: walk backward/forward from this entry to collect all
    // adjacent _partOfStruggle insertions, then include the main hyp.
    // For "barracuda": ins("bar",_partOfStruggle) + ins("a",_partOfStruggle) + sub("coda")
    // → fullAttempt = ["bar","a","coda"] → "baracoda" → 75%+ syllable coverage
    const attemptParts = [];
    const _clean = s => (s || '').toLowerCase().replace(/[^a-z]/g, '');
    for (let j = i - 1; j >= 0; j--) {
      if (alignment[j].type === 'insertion' && alignment[j]._partOfStruggle) {
        attemptParts.unshift(_clean(alignment[j].hyp));
      } else break;
    }
    const mainHyp = _clean(entry.hyp);
    if (mainHyp) attemptParts.push(mainHyp);
    for (let j = i + 1; j < alignment.length; j++) {
      if (alignment[j].type === 'insertion' && alignment[j]._partOfStruggle) {
        attemptParts.push(_clean(alignment[j].hyp));
      } else break;
    }

    const fullAttempt = attemptParts.join('');
    if (attemptParts.length > 1) {
      entry._fullAttempt = attemptParts;
      entry._fullAttemptJoined = fullAttempt;
      entry._fullAttemptRatio = levenshteinRatio(fullAttempt, ref);
      entry._syllableCoverage = analyzeSyllableCoverage(fullAttempt, ref);
    } else if (entry._nearMissEvidence && entry._nearMissEvidence.length > 0) {
      entry._syllableCoverage = analyzeFragmentsCoverage(entry._nearMissEvidence, ref);
    } else {
      entry._syllableCoverage = analyzeSyllableCoverage(entry.hyp || '', ref);
    }
  }

  // ── Possible Struggle Flag ─────────────────────────────────────────
  // Blanket boolean for any word showing signs of struggle. Covers olive
  // (struggle-correct), orange (attempted-struggled), and red (definite-struggle)
  // buckets. Excludes: correct (dark green), forgiven (light green), omissions,
  // confirmed insertions, and confirmed substitutions (all engines agree on
  // same wrong word with no near-miss). Backend-only — no scoring impact.
  const _norm = s => (s || '').toLowerCase().replace(/[^a-z]/g, '');
  for (const entry of alignment) {
    entry._possibleStruggle = false;
    if (entry.type === 'insertion' || entry.type === 'omission') continue;
    if (entry.forgiven || entry._oovRecoveredViaUnknown) continue;

    // Substitutions and (legacy) struggles: always possible struggle
    // UNLESS it's a confirmed substitution (all engines agree, not near-miss)
    if (entry.type === 'substitution' || entry.type === 'struggle') {
      if (entry.type === 'substitution') {
        const refN = _norm(entry.ref);
        const hypN = _norm(entry.hyp);
        const v0N = entry._v0Word ? _norm(entry._v0Word) : null;
        const pkN = entry._xvalWord ? _norm(entry._xvalWord) : null;
        const anyCorrect = v0N === refN || pkN === refN;
        const enginesAgree = (!v0N || v0N === hypN) && (!pkN || pkN === hypN);
        if (!anyCorrect && enginesAgree && !isNearMiss(entry.hyp, entry.ref)) {
          continue; // Confirmed substitution — clean error, not a struggle
        }
      }
      entry._possibleStruggle = true;
      continue;
    }

    // Correct words with difficulty signals
    if (entry.type === 'correct') {
      if (entry._postStruggleLeniency || entry._recovered ||
          (entry.compound && entry.parts?.length >= 2) ||
          entry._v0Type === 'substitution' || entry._pkType === 'omission') {
        entry._possibleStruggle = true;
      }
    }
  }

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
    })) || []
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

    // VAD Overhang Adjustment: DISABLED — overhang logic has no cap, so large VAD segments
    // (e.g. 3.7s continuous speech) can produce 1000ms+ overhang that eliminates real hesitations.
    // A 1.28s gap between "need" and "all" was reduced to 144ms and dismissed.
    // TODO: Re-enable with a cap (e.g. 300-500ms max overhang) once tuned.
    // const overhangResult = adjustGapsWithVADOverhang(diagnostics, transcriptWords, vadResult.segments);
    const overhangResult = { adjustments: [], removedCount: 0 };

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

  // Map NL annotations onto alignment entries
  if (nlAnnotations) {
    // Build position-annotated reference word array aligned with normalizeText output.
    // normalizeText merges trailing-hyphen tokens (OCR line-break artifacts like "spread-" + "sheet"
    // → "spreadsheet") and filters empty tokens. This mirrors that logic but preserves original
    // casing and character positions for offset-based NL annotation matching.
    const refPositions = (() => {
      const rawTokens = [];
      const regex = /\S+/g;
      let m;
      while ((m = regex.exec(referenceText)) !== null) {
        const stripped = m[0].replace(/^[^\w'-]+|[^\w'-]+$/g, '');
        if (stripped.length > 0) {
          rawTokens.push({ original: m[0], stripped, start: m.index, end: m.index + m[0].length });
        }
      }
      const merged = [];
      for (let t = 0; t < rawTokens.length; t++) {
        if (rawTokens[t].stripped.endsWith('-') && t + 1 < rawTokens.length) {
          merged.push({
            word: rawTokens[t].stripped.slice(0, -1) + rawTokens[t + 1].stripped,
            start: rawTokens[t].start,
            end: rawTokens[t + 1].end
          });
          t++;
        } else {
          merged.push({ word: rawTokens[t].original, start: rawTokens[t].start, end: rawTokens[t].end });
        }
      }
      // Split internal-hyphen tokens to mirror normalizeText's hyphen split.
      // e.g., "smooth-on-skin" → [{word:"smooth",...}, {word:"on",...}, {word:"skin",...}]
      // Exception: single-letter prefix joins instead (e-mail → email).
      // Without this, refPositions has fewer entries than alignment and _displayRef/NL drift.
      const positions = [];
      for (const pos of merged) {
        const stripped = pos.word.replace(/^[^\w'-]+|[^\w'-]+$/g, '');
        if (stripped.includes('-')) {
          const parts = stripped.split('-').filter(p => p.length > 0);
          if (parts.length >= 2 && parts[0].length === 1) {
            // Single-letter part (e-mail, e-book) → keep as one token
            const joinedWord = parts.join('');
            const trailingPunct = pos.word.match(/[^\w'-]*$/)[0];
            positions.push({ word: joinedWord + trailingPunct, start: pos.start, end: pos.end });
          } else {
            const leadingLen = pos.word.match(/^[^\w'-]*/)[0].length;
            const trailingPunct = pos.word.match(/[^\w'-]*$/)[0];
            let cursor = pos.start + leadingLen;
            for (let j = 0; j < parts.length; j++) {
              if (j === parts.length - 1) {
                // Last part keeps trailing punctuation for sentence-end detection
                positions.push({ word: parts[j] + trailingPunct, start: cursor, end: pos.end });
              } else {
                positions.push({ word: parts[j], start: cursor, end: cursor + parts[j].length });
              }
              cursor += parts[j].length + 1; // +1 for the hyphen
            }
          }
        } else {
          positions.push(pos);
        }
      }
      return positions;
    })();

    // Build set of words that appear lowercase (non-sentence-start) in the reference text.
    // Uses raw split (not merged) so "sheet" from "spread- sheet" is captured, preventing
    // false proper-noun forgiveness for "Sheet" in "Google Sheet".
    const rawRefWords = referenceText.trim().split(/\s+/);
    const refLowercaseSet = new Set(
      rawRefWords
        .filter((w, i) => {
          if (!w || w.length === 0) return false;
          if (i === 0) return false;
          if (i > 0 && /[.!?]$/.test(rawRefWords[i - 1])) return false;
          return w.charAt(0) === w.charAt(0).toLowerCase();
        })
        .map(w => w.toLowerCase().replace(/[^a-z'-]/g, ''))
    );

    // Match NL annotations to alignment entries by character offset rather than sequential index.
    // The NL API tokenizes differently from split(/\s+/) — it splits contractions ("it's" → "it" + "'s"),
    // normalizeText merges trailing hyphens ("spread-" + "sheet" → "spreadsheet"), and splits internal
    // hyphens ("smooth-on-skin" → ["smooth","on","skin"]). Offset-based matching handles all these.
    let ri = 0;
    for (const entry of alignment) {
      if (!entry.ref) continue; // skip insertions — no ref word
      if (ri < refPositions.length) {
        const range = refPositions[ri];
        const matching = nlAnnotations.filter(a => a.offset >= range.start && a.offset < range.end);
        if (matching.length > 0) {
          entry.nl = { ...(matching.find(a => a.isProperNoun) || matching[0]) };
        }

        // Cosmetic: preserve original casing for UI display (e.g., "Shanna Mallon")
        // Logic uses lowercase entry.ref; display uses _displayRef
        const refWord = range.word.replace(/^[^\w'-]+|[^\w'-]+$/g, '');
        entry._displayRef = refWord;
        const isAtSentenceStart = ri === 0 ||
          (ri > 0 && /[.!?]$/.test(refPositions[ri - 1].word));

        if (entry.nl && !isAtSentenceStart && refWord.length > 0) {
          const refIsLowercase = refWord.charAt(0) === refWord.charAt(0).toLowerCase();
          if (refIsLowercase && entry.nl.isProperNoun) {
            entry.nl.isProperNoun = false;
            entry.nl.tierOverridden = entry.nl.tier;
            entry.nl.tier = 'academic';
          }
        }
        // Also override if the word appears lowercase elsewhere in reference text
        // (e.g., "Visuals" at sentence start when "visuals" also appears lowercase)
        if (entry.nl && entry.nl.isProperNoun && refLowercaseSet.has(entry.ref.toLowerCase())) {
          entry.nl.isProperNoun = false;
          entry.nl.tierOverridden = entry.nl.tier;
          entry.nl.tier = 'academic';
        }
      }
      ri++;
    }

    // Dictionary-based common word detection: checks Free Dictionary API
    // to distinguish exotic names (Mallon, Shanna) from common words (Straight, North).
    // Common words get 200 → skip forgiveness; exotic names get 404 → allow forgiveness.
    // Results cached in sessionStorage to avoid re-fetching across runs.
    async function isCommonDictionaryWord(word) {
      const key = `dict_${word.toLowerCase()}`;
      const cached = sessionStorage.getItem(key);
      if (cached !== null) return cached === 'true';
      try {
        const resp = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`);
        const isCommon = resp.status === 200;
        sessionStorage.setItem(key, String(isCommon));
        return isCommon;
      } catch {
        // Network error — assume NOT common (fail open: allow forgiveness)
        return false;
      }
    }

    // Mark proper noun errors as forgiven if phonetically close
    // (student decoded correctly but doesn't know accepted pronunciation - vocabulary gap, not decoding failure)
    // Also handles split pronunciations like "her-my-own" for "Hermione"
    const forgivenessLog = [];
    let refIdx = 0;
    for (let i = 0; i < alignment.length; i++) {
      const entry = alignment[i];
      if (!entry.ref) continue; // skip insertions — no ref word

      if (entry.type === 'substitution') {
        const refWordOriginal = refIdx < refPositions.length
          ? refPositions[refIdx].word.replace(/^[^\w'-]+|[^\w'-]+$/g, '')
          : '';
        const refIsLowercase = refWordOriginal.length > 0 &&
          refWordOriginal.charAt(0) === refWordOriginal.charAt(0).toLowerCase();

        let isProperViaNL = entry.nl && entry.nl.isProperNoun;
        if (isProperViaNL && refIsLowercase) {
          isProperViaNL = false;
        }
        // Override if this word appears lowercase elsewhere in the reference text
        // (e.g., "Sheet" in "Google Sheet" when "sheet" also appears in "spreadsheet")
        if (isProperViaNL && refLowercaseSet.has(entry.ref.toLowerCase())) {
          isProperViaNL = false;
        }

        // Dictionary guard: common English words (north, straight) should NOT be forgiven
        // even if NL API tags them as proper nouns (e.g., "Straight North" company name)
        let isDictionaryCommon = false;
        if (isProperViaNL) {
          isDictionaryCommon = await isCommonDictionaryWord(entry.ref);
          if (isDictionaryCommon) {
            isProperViaNL = false;
          }
        }

        const logEntry = {
          refWord: entry.ref,
          hypWord: entry.hyp,
          refIdx,
          isProperViaNL,
          isDictionaryCommon,
          refIsLowercase,
          nlData: entry.nl
        };

        if (isProperViaNL) {
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
            entry.properNounSource = 'NL API';
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

      // Omission of a proper noun: forgive if Parakeet (or preceding fragments) captured the attempt.
      // Before _xvalWord existed we had no evidence of attempt — now we do.
      if (entry.type === 'omission') {
        const refWordOriginal = refIdx < refPositions.length
          ? refPositions[refIdx].word.replace(/^[^\w'-]+|[^\w'-]+$/g, '')
          : '';
        const refIsLowercase = refWordOriginal.length > 0 &&
          refWordOriginal.charAt(0) === refWordOriginal.charAt(0).toLowerCase();

        let isProperViaNL = entry.nl && entry.nl.isProperNoun;
        if (isProperViaNL && refIsLowercase) isProperViaNL = false;
        if (isProperViaNL && refLowercaseSet.has(entry.ref.toLowerCase())) isProperViaNL = false;

        let isDictionaryCommon = false;
        if (isProperViaNL) {
          isDictionaryCommon = await isCommonDictionaryWord(entry.ref);
          if (isDictionaryCommon) isProperViaNL = false;
        }

        const logEntry = {
          refWord: entry.ref,
          hypWord: null,
          refIdx,
          isOmission: true,
          isProperViaNL,
          isDictionaryCommon,
          refIsLowercase,
          nlData: entry.nl
        };

        if (isProperViaNL) {
          let bestRatio = 0;
          let bestEvidence = null;
          let evidenceSource = null;

          // Primary: Parakeet heard something for this ref slot
          if (entry._xvalWord) {
            const xvalNorm = entry._xvalWord.toLowerCase().replace(/[^a-z]/g, '');
            const ratio = levenshteinRatio(entry.ref, xvalNorm);
            if (ratio > bestRatio) {
              bestRatio = ratio;
              bestEvidence = xvalNorm;
              evidenceSource = 'parakeet';
            }
          }

          // Secondary: preceding insertions may be Reverb fragments of the attempt
          const precedingIns = [];
          for (let j = i - 1; j >= 0 && alignment[j].type === 'insertion'; j--) {
            if (alignment[j].partOfForgiven) break; // claimed by previous proper noun
            precedingIns.unshift(alignment[j]);
          }
          if (precedingIns.length > 0) {
            let combined = '';
            const fragmentAttempts = [];
            for (let j = precedingIns.length - 1; j >= 0; j--) {
              combined = precedingIns[j].hyp + combined;
              const ratio = levenshteinRatio(entry.ref, combined);
              fragmentAttempts.push({ combined, ratio, fragments: precedingIns.length - j });
              if (ratio > bestRatio) {
                bestRatio = ratio;
                bestEvidence = combined;
                evidenceSource = 'fragments';
              }
            }
            logEntry.fragmentAttempts = fragmentAttempts;
          }

          logEntry.bestRatio = bestRatio;
          logEntry.bestEvidence = bestEvidence;
          logEntry.evidenceSource = evidenceSource;
          logEntry.threshold = 0.4;
          logEntry.meetsThreshold = bestRatio >= 0.4;

          if (bestRatio >= 0.4) {
            entry.forgiven = true;
            entry.phoneticRatio = Math.round(bestRatio * 100);
            entry.properNounSource = 'NL API';
            entry._forgivenEvidence = bestEvidence;
            entry._forgivenEvidenceSource = evidenceSource;
            logEntry.forgiven = true;
          }
        }
        forgivenessLog.push(logEntry);
      }

      refIdx++;
    }

    addStage('proper_noun_forgiveness', {
      totalCandidates: forgivenessLog.length,
      properNounsFound: forgivenessLog.filter(l => l.isProperViaNL).length,
      dictionaryBlocked: forgivenessLog.filter(l => l.isDictionaryCommon).length,
      forgiven: forgivenessLog.filter(l => l.forgiven).length,
      forgivenOmissions: forgivenessLog.filter(l => l.forgiven && l.isOmission).length,
      details: forgivenessLog
    });
  }

  // ── OOV Detection ─────────────────────────────────────────────────────
  // Flag reference words absent from CMUdict (125K English words).
  // If a word isn't in CMUdict, English ASR models almost certainly can't recognize it.
  await loadPhonemeData();
  for (const entry of alignment) {
    if (entry.type === 'insertion' || !entry.ref) continue;
    const refNorm = entry.ref.toLowerCase().replace(/[^a-z'-]/g, '');
    if (refNorm.length < 3) continue;           // too short for reliable phonetic comparison
    if (/\d/.test(entry.ref)) continue;          // handled by number expansion
    if (entry.forgiven) continue;                // already forgiven (proper noun)
    if (getPhonemeCount(refNorm) === null) {
      entry._isOOV = true;
    }
  }

  // Phonetic normalization: collapse common phonetic equivalences before Levenshtein
  function phoneticNormalize(word) {
    return word.toLowerCase()
      .replace(/[^a-z]/g, '')
      .replace(/ck/g, 'k')
      .replace(/ph/g, 'f')
      .replace(/c/g, 'k');
  }

  // ── OOV Phonetic Forgiveness ──────────────────────────────────────────
  // Foreign/rare words absent from ASR vocabulary get phonetic comparison.
  // If the student's combined engine output is phonetically close, forgive.
  {
    const oovLog = [];
    for (let i = 0; i < alignment.length; i++) {
      const entry = alignment[i];
      if (!entry._isOOV) continue;
      if (entry.type !== 'substitution' && entry.type !== 'struggle') continue;
      if (entry.forgiven) continue; // already forgiven by proper noun

      // Collect all engine hearings for this ref word
      const hearings = [];
      if (entry._v1RawAttempt) hearings.push(entry._v1RawAttempt.join(''));
      else if (entry.hyp) hearings.push(entry.hyp);
      if (entry._v0Attempt) hearings.push(entry._v0Attempt.join(''));
      else if (entry._v0Word) hearings.push(entry._v0Word);
      if (entry._xvalAttempt) hearings.push(entry._xvalAttempt.join(''));
      else if (entry._xvalWord) hearings.push(entry._xvalWord);

      const refPhonetic = phoneticNormalize(entry.ref);
      let bestRatio = 0;
      let bestHearing = '';
      for (const h of hearings) {
        if (!h) continue;
        const ratio = levenshteinRatio(refPhonetic, phoneticNormalize(h));
        if (ratio > bestRatio) {
          bestRatio = ratio;
          bestHearing = h;
        }
      }

      // Also try combining hyp + following insertions (ASR may fragment OOV words)
      let combined = entry.hyp || '';
      for (let j = i + 1; j < alignment.length && alignment[j].type === 'insertion'; j++) {
        combined += alignment[j].hyp || '';
        const ratio = levenshteinRatio(refPhonetic, phoneticNormalize(combined));
        if (ratio > bestRatio) {
          bestRatio = ratio;
          bestHearing = combined;
        }
      }

      const logEntry = { ref: entry.ref, bestHearing, bestRatio: Math.round(bestRatio * 100) };

      if (bestRatio >= 0.6) {
        entry.forgiven = true;
        entry._oovForgiven = true;
        entry._oovRatio = Math.round(bestRatio * 100);
        entry.phoneticRatio = Math.round(bestRatio * 100);
        logEntry.forgiven = true;

        // Clean up fragments: adjacent insertions that were part of ASR's split
        // Scan both forward AND backward — ASR may place fragments on either side
        // (e.g., V1 "jay"+"bar" for ref "jaiberos" → "jay" is insertion BEFORE)
        for (let j = i + 1; j < alignment.length && alignment[j].type === 'insertion'; j++) {
          const ins = alignment[j];
          if (ins._confirmedInsertion) delete ins._confirmedInsertion;
          ins._partOfOOVForgiven = true;
          if (ins._partOfStruggle) delete ins._partOfStruggle;
        }
        for (let j = i - 1; j >= 0 && alignment[j].type === 'insertion'; j--) {
          const ins = alignment[j];
          if (ins._confirmedInsertion) delete ins._confirmedInsertion;
          ins._partOfOOVForgiven = true;
          if (ins._partOfStruggle) delete ins._partOfStruggle;
        }
      }
      oovLog.push(logEntry);
    }

    // ── OOV <unknown> reassignment (Part 1) ────────────────────────────
    // After NW alignment, <unknown> tokens may be assigned to wrong ref
    // words (e.g., ref="a" gets hyp="unknown" instead of ref="cayuco").
    // Multiple <unknown> tokens near an OOV word are fragments of the
    // SAME vocalization attempt — they all belong to the OOV word.
    // Steal ALL <unknown> donors within ±3, not just the closest.
    // MUST run before existing OOV omission recovery so that donors are
    // cleaned up before path 2 forgives the OOV entry.
    for (let i = 0; i < alignment.length; i++) {
      const entry = alignment[i];
      if (!entry._isOOV || entry.type !== 'omission' || entry.forgiven) continue;

      // Find ALL <unknown> donors within ±3 ref positions
      const SCAN_RADIUS = 3;
      const donors = [];

      for (let d = -SCAN_RADIUS; d <= SCAN_RADIUS; d++) {
        if (d === 0) continue;
        const j = i + d;
        if (j < 0 || j >= alignment.length) continue;
        const candidate = alignment[j];
        if (candidate.type === 'insertion') continue;
        if (candidate.type === 'correct') continue; // already resolved as correct — don't undo
        // If another engine heard this word correctly, the <unknown> is V1's CTC confusion,
        // not the OOV word's vocalization. The 3-way verdict sets crossValidation='disagreed'
        // but does NOT change V1's type — so we must check engine types directly.
        if (candidate._pkType === 'correct' || candidate._v0Type === 'correct') continue;
        if (candidate._isOOV) continue;             // don't steal from another OOV word
        if (candidate.forgiven) continue;            // don't steal from already-resolved entries
        if (candidate.hyp !== 'unknown') continue;

        // Verify the hyp actually came from a <unknown> CTC token, not the English word "unknown"
        if (candidate.hypIndex < 0) continue;
        const tw = transcriptWords[candidate.hypIndex];
        if (!(typeof tw?.word === 'string' && tw.word.startsWith('<') && tw.word.endsWith('>'))) continue;
        if (tw._ctcArtifact) continue; // CTC artifacts are false onsets, not student speech

        donors.push({ candidate, dist: Math.abs(d) });
      }

      if (donors.length === 0) continue;

      // Sort by distance — assign closest donor's hypIndex to the OOV entry
      donors.sort((a, b) => a.dist - b.dist);
      const closest = donors[0].candidate;

      // OOV entry gets one <unknown> hyp (enough to trigger Part 2 exclusion)
      entry.hyp = 'unknown';
      entry.type = 'substitution';
      entry.hypIndex = closest.hypIndex;

      // ALL donors lose their hyp — become omissions.
      // Multiple <unknown> tokens near an OOV word are fragments of the
      // same vocalization attempt, not independent hearings of different words.
      for (const { candidate } of donors) {
        candidate.hyp = null;
        candidate.type = 'omission';
        candidate.hypIndex = -1;
        // Clear cross-validation metadata that no longer applies
        delete candidate._v0Word;
        delete candidate._v0Type;
        delete candidate._xvalWord;
        delete candidate._pkType;
        delete candidate.crossValidation;
        candidate._oovCollateralOmission = true;
      }

      oovLog.push({ ref: entry.ref, type: 'unknown_reassigned', donorCount: donors.length });
    }

    // OOV omission recovery: if an OOV word is omitted but <unknown> tokens
    // exist in its temporal window AND Parakeet heard speech there, forgive it —
    // student vocalized but ASR couldn't decode (word not in vocabulary).
    // Guard: if Parakeet also has no speech in the window, student genuinely skipped.
    for (let i = 0; i < alignment.length; i++) {
      const entry = alignment[i];
      if (!entry._isOOV || entry.type !== 'omission' || entry.forgiven) continue;

      // Find temporal window from adjacent non-insertion entries
      let prevEnd = null, nextStart = null;
      for (let j = i - 1; j >= 0; j--) {
        if (alignment[j].type === 'insertion') continue;
        if (alignment[j].hypIndex >= 0) {
          prevEnd = parseT(transcriptWords[alignment[j].hypIndex].endTime);
        }
        break;
      }
      for (let j = i + 1; j < alignment.length; j++) {
        if (alignment[j].type === 'insertion') continue;
        if (alignment[j].hypIndex >= 0) {
          nextStart = parseT(transcriptWords[alignment[j].hypIndex].startTime);
        }
        break;
      }

      // Need at least one boundary to define a window
      if (prevEnd === null && nextStart === null) continue;
      const winStart = (prevEnd !== null ? prevEnd : nextStart) - 0.5;
      const winEnd = (nextStart !== null ? nextStart : prevEnd) + 0.5;

      // Guard: Parakeet must have speech in the core gap (not just overlapping edges).
      // Check for a Parakeet word starting within prevEnd..nextStart.
      // If Parakeet also has silence there, student genuinely skipped the word.
      const gapStart = prevEnd !== null ? prevEnd : winStart;
      const gapEnd = nextStart !== null ? nextStart : winEnd;
      let parakeetHasWord = false;
      for (const xw of xvalRawWords) {
        const xStart = parseFloat(String(xw.start || '0').replace('s', '')) || 0;
        if (xStart > gapStart && xStart < gapEnd) { parakeetHasWord = true; break; }
      }
      if (!parakeetHasWord) continue;

      // Scan transcriptWords for <unknown> tokens in window
      let unknownCount = 0;
      for (const tw of transcriptWords) {
        if (!(typeof tw.word === 'string' && tw.word.startsWith('<') && tw.word.endsWith('>'))) continue;
        if (tw._ctcArtifact) continue;
        const tStart = parseT(tw.startTime);
        const tEnd = parseT(tw.endTime);
        if (tEnd >= winStart && tStart <= winEnd) unknownCount++;
      }

      if (unknownCount > 0) {
        entry.forgiven = true;
        entry._oovExcluded = true;       // exclude from assessment, not count as correct
        entry._oovForgiven = true;
        entry._oovRecoveredViaUnknown = true;
        entry._unknownTokenCount = unknownCount;
        oovLog.push({ ref: entry.ref, type: 'omission_recovered', unknownTokens: unknownCount, forgiven: true });
      }
    }

    addStage('oov_forgiveness', {
      totalOOV: alignment.filter(e => e._isOOV).length,
      forgiven: oovLog.filter(l => l.forgiven).length,
      notForgiven: oovLog.filter(l => !l.forgiven).length,
      details: oovLog
    });
  }

  // ── OOV exclusion (Part 2) ───────────────────────────────────────────
  // Catch OOV substitutions created by Part 1 (reassignment).
  // Existing path 2 only handles omissions — this handles subs.
  // ASR couldn't decode → can't credit or penalize. Exclude entirely.
  for (const entry of alignment) {
    if (!entry._isOOV) continue;
    if (entry.type !== 'substitution') continue;
    if (entry.forgiven) continue;
    if (entry.hyp !== 'unknown') continue;

    // Verify hyp is from <unknown> token (same guard as Part 1)
    if (entry.hypIndex >= 0) {
      const tw = transcriptWords[entry.hypIndex];
      if (!(typeof tw?.word === 'string' && tw.word.startsWith('<') && tw.word.endsWith('>'))) continue;
    }

    entry._oovExcluded = true;
    entry.forgiven = true;
    entry._oovForgiven = true;
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

  // ── OOV time credit (Part 2b) ────────────────────────────────────────
  // For OOV-excluded words, credit back the time the student spent
  // struggling with a word the ASR couldn't decode.
  let oovTimeCreditSeconds = 0;
  {
    let i = 0;
    while (i < alignment.length) {
      const entry = alignment[i];
      if (!entry._oovExcluded) { i++; continue; }

      // Find the OOV cluster: contiguous _oovExcluded entries
      let clusterEnd = i;
      while (clusterEnd + 1 < alignment.length && alignment[clusterEnd + 1]._oovExcluded) {
        clusterEnd++;
      }

      // Find temporal boundaries: last confirmed word before cluster,
      // first confirmed word after cluster
      let gapStart = null, gapEnd = null;

      for (let j = i - 1; j >= 0; j--) {
        if (alignment[j].type === 'insertion') continue;
        if (alignment[j].hypIndex >= 0 && !alignment[j]._oovExcluded) {
          gapStart = parseT(transcriptWords[alignment[j].hypIndex].endTime);
          break;
        }
      }
      for (let j = clusterEnd + 1; j < alignment.length; j++) {
        if (alignment[j].type === 'insertion') continue;
        if (alignment[j].hypIndex >= 0 && !alignment[j]._oovExcluded) {
          gapEnd = parseT(transcriptWords[alignment[j].hypIndex].startTime);
          break;
        }
      }

      if (gapStart !== null && gapEnd !== null && gapEnd > gapStart) {
        oovTimeCreditSeconds += (gapEnd - gapStart);
      }

      // Skip past the entire cluster to avoid double-counting
      i = clusterEnd + 1;
    }
  }
  if (oovTimeCreditSeconds > 0) {
    effectiveElapsedSeconds -= oovTimeCreditSeconds;
    addStage('oov_time_credit', {
      creditSeconds: Math.round(oovTimeCreditSeconds * 100) / 100,
      adjustedElapsed: Math.round(effectiveElapsedSeconds * 100) / 100
    });
  }

  // Clear _confirmedInsertion on excluded insertions (fillers, struggle fragments, etc.)
  // These are already classified — they shouldn't count as confirmed insertion errors.
  for (const entry of alignment) {
    if (entry.type !== 'insertion' || !entry._confirmedInsertion) continue;
    if (entry._partOfStruggle) {
      delete entry._confirmedInsertion;
      continue;
    }
    if (entry.hypIndex >= 0) {
      const tw = transcriptWords[entry.hypIndex];
      if (tw?.isDisfluency || tw?._ctcArtifact || tw?._preWordArtifact || tw?._postWordArtifact) {
        delete entry._confirmedInsertion;
      }
    }
  }

  // ── Single-letter function word forgiveness (Part 4) ─────────────────
  // "a" and "I" are too short for ASR to capture when student is
  // struggling with an adjacent word. Forgive if ALL engines missed it.
  {
    const FUNCTION_LETTERS = new Set(['a', 'i']);
    const pkRefEntries = data._threeWay?.pkRef;
    const v0RefEntries = data._threeWay?.v0Ref;

    let refIdx = 0;
    for (let i = 0; i < alignment.length; i++) {
      const entry = alignment[i];
      if (!entry.ref) continue; // skip insertions — no ref word
      // Track refIdx for _threeWay lookup (same pattern as post-struggle leniency)
      const currentRefIdx = refIdx;
      refIdx++;

      if (entry.type !== 'omission') continue;
      if (entry.forgiven) continue;
      if (!FUNCTION_LETTERS.has(entry.ref.toLowerCase())) continue;

      // Must be adjacent to a struggle, OOV, or error (in ref-word space, skip insertions)
      let prev = null;
      for (let j = i - 1; j >= 0; j--) {
        if (alignment[j].type !== 'insertion') { prev = alignment[j]; break; }
      }
      let next = null;
      for (let j = i + 1; j < alignment.length; j++) {
        if (alignment[j].type !== 'insertion') { next = alignment[j]; break; }
      }
      const adjacentStruggle =
        (prev && (prev._isOOV || prev.type === 'struggle' ||
                  prev.type === 'substitution' || prev._oovExcluded)) ||
        (next && (next._isOOV || next.type === 'struggle' ||
                  next.type === 'substitution' || next._oovExcluded));

      if (!adjacentStruggle) continue;

      // Verify ALL engines missed it (no engine heard this word at this position)
      const v0Entry = v0RefEntries?.[currentRefIdx];
      const pkEntry = pkRefEntries?.[currentRefIdx];
      const v1Omission = entry.type === 'omission';
      const v0Omission = !v0Entry || v0Entry.type === 'omission';
      const pkOmission = !pkEntry || pkEntry.type === 'omission';

      if (v1Omission && v0Omission && pkOmission) {
        entry.forgiven = true;
        entry._functionWordCollateral = true;
      }
    }
  }

  // ── Post-struggle Parakeet leniency ─────────────────────────────────
  // After a confirmed error, Reverb's CTC decoder often can't recover
  // for the next word. If Parakeet independently heard it correctly,
  // trust Parakeet and give credit (one word of leniency only).
  {
    const pkRefEntries = data._threeWay?.pkRef;
    if (pkRefEntries) {
      let prevRefWasError = false;
      let refIdx = 0;
      const promoted = [];
      for (const entry of alignment) {
        if (entry.type === 'insertion') {
          if (entry._confirmedInsertion) prevRefWasError = true;
          continue;
        }
        // ref-anchored entry
        const pkEntry = pkRefEntries[refIdx];
        if (prevRefWasError
            && entry.type === 'substitution'
            && entry.crossValidation === 'disagreed'
            && pkEntry?.type === 'correct') {
          entry._originalType = entry.type;  // preserve V1 evidence
          entry.type = 'correct';
          entry._postStruggleLeniency = true;
          promoted.push({ ref: entry.ref, v1Hyp: entry.hyp, pkWord: pkEntry.hyp });
        }
        // Update trigger for next word
        // Collateral damage entries (function word / OOV collateral) are transparent —
        // they were caught in the blast radius and shouldn't consume the leniency window.
        if (!entry._functionWordCollateral && !entry._oovCollateralOmission) {
          prevRefWasError = (entry.type === 'substitution' || entry.type === 'struggle'
                             || entry.type === 'omission') && !entry.forgiven;
          // OOV-excluded words also trigger leniency — Reverb was off-track during OOV struggle
          if (entry._oovExcluded) prevRefWasError = true;
        }
        refIdx++;
      }
      if (promoted.length > 0) {
        addStage('post_struggle_leniency', { promoted });
      }
    }
  }

  const wcpm = (effectiveElapsedSeconds != null && effectiveElapsedSeconds > 0)
    ? computeWCPMRange(alignment, effectiveElapsedSeconds)
    : null;
  if (wcpm && oovTimeCreditSeconds > 0) {
    wcpm.oovTimeCreditSeconds = Math.round(oovTimeCreditSeconds * 100) / 100;
  }
  const longPauseCount = diagnostics.longPauses?.length || 0;
  const accuracy = computeAccuracy(alignment, { forgivenessEnabled: !!nlAnnotations, longPauseCount });
  const tierBreakdown = nlAnnotations ? computeTierBreakdown(alignment) : null;

  addStage('metrics_computed', {
    wcpm: wcpm?.wcpmMin ?? null,
    accuracy: accuracy.accuracy,
    totalRefWords: accuracy.totalRefWords,
    totalErrors: accuracy.totalErrors,
    wordErrors: accuracy.wordErrors,
    omissions: accuracy.omissions,
    longPauseErrors: accuracy.longPauseErrors,
    insertionErrors: accuracy.insertionErrors,
    forgiven: accuracy.forgiven,
    alignmentSummary: alignment.map(a => ({
      ref: a.ref,
      hyp: a.hyp,
      type: a.type,
      hypIndex: a.hypIndex,
      crossValidation: a.crossValidation || null,
      _xvalWord: a._xvalWord || null,
      forgiven: a.forgiven,
      partOfForgiven: a.partOfForgiven,
      _possibleStruggle: a._possibleStruggle || false,
      _v0Word: a._v0Word || null,
      _v0Type: a._v0Type || null,
      _nearMissEvidence: a._nearMissEvidence || null,
      _abandonedAttempt: a._abandonedAttempt || false,
      _partOfStruggle: a._partOfStruggle || false,
      _confirmedInsertion: a._confirmedInsertion || false,
      _isOOV: a._isOOV || false,
      _oovForgiven: a._oovForgiven || false,
      _oovExcluded: a._oovExcluded || false,
      _oovRecoveredViaUnknown: a._oovRecoveredViaUnknown || false,
      _oovCollateralOmission: a._oovCollateralOmission || false,
      _functionWordCollateral: a._functionWordCollateral || false,
      _partOfOOVForgiven: a._partOfOOVForgiven || false,
      _syllableCoverage: a._syllableCoverage || null
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
  await loadPhonemeData(); // Ensure CMUdict phoneme counts are loaded before normalization
  const wordOutliers = computeWordDurationOutliers(transcriptWords, alignment);
  const wordSpeedTiers = computeWordSpeedTiers(wordOutliers, alignment, xvalRawWords, transcriptWords, referenceText);

  // Prosody enrichments (research-aligned)
  const pauseContext = annotatePauseContext(phrasing, alignment);
  const ungrammaticalPauseRate = (() => {
    if (phrasing.insufficient) return null;
    const count = phrasing.breakClassification.unexpected;
    const total = accuracy.totalRefWords;
    if (total === 0) return null;
    const per100 = Math.round((count / total) * 1000) / 10;
    let label;
    if (per100 <= 2) label = 'Minimal';
    else if (per100 <= 5) label = 'Occasional';
    else if (per100 <= 10) label = 'Frequent';
    else label = 'Pervasive';
    return { count, totalRefWords: total, per100Words: per100, label };
  })();
  const functionWordCompression = computeFunctionWordCompression(wordSpeedTiers, alignment);
  const syntacticAlignment = computeSyntacticAlignment(phrasing, alignment);

  diagnostics.prosody = { phrasing, pauseAtPunctuation, paceConsistency, wordOutliers,
    ungrammaticalPauseRate, pauseContext, functionWordCompression, syntacticAlignment };
  diagnostics.wordSpeed = wordSpeedTiers;
  console.log('[WordSpeed Debug]', { phInsufficient: phrasing.insufficient, woInsufficient: wordOutliers.insufficient, woCount: wordOutliers.allWords?.length, woBaseline: wordOutliers.baseline ? { xval: wordOutliers.baseline.xvalTimestamps, primary: wordOutliers.baseline.primaryTimestamps, skipped: wordOutliers.baseline.wordsSkippedNoTimestamps } : null, wsInsufficient: wordSpeedTiers.insufficient, wsReason: wordSpeedTiers.reason });

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
        gapMs: m.gapMs,
        thresholdMs: m.thresholdMs
      })) || [],
      periodMinPauseMs: pauseAtPunctuation.coverage?.periodMinPauseMs ?? null,
      commaMinPauseMs: pauseAtPunctuation.coverage?.commaMinPauseMs ?? null,
      precisionRatio: pauseAtPunctuation.precision?.ratio ?? null,
      precisionDetail: pauseAtPunctuation.precision?.ratio != null
        ? `${pauseAtPunctuation.precision.atPunctuationCount} of ${pauseAtPunctuation.precision.totalPauses} pauses at punctuation`
        : null,
      pauseDifferentiation: pauseAtPunctuation.pauseDifferentiation ?? null
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
    },
    ungrammaticalPauseRate: ungrammaticalPauseRate,
    functionWordCompression: functionWordCompression ? { ratio: functionWordCompression.ratio, label: functionWordCompression.label } : null,
    syntacticAlignment: syntacticAlignment ? { score: syntacticAlignment.score, label: syntacticAlignment.label } : null
  });

  // ── Word Speed Tiers (comprehensive per-word data) ──
  if (wordSpeedTiers && !wordSpeedTiers.insufficient) {
    addStage('word_speed_tiers', {
      baseline: wordSpeedTiers.baseline,
      distribution: wordSpeedTiers.distribution,
      atPacePercent: wordSpeedTiers.atPacePercent,
      words: wordSpeedTiers.words.map(w => ({
        refIndex: w.refIndex,
        refWord: w.refWord,
        hyp: w.word,
        tier: w.tier,
        alignmentType: w.alignmentType,
        durationMs: w.durationMs,
        phonemes: w.phonemes,
        phonemeSource: w.phonemeSource || null,
        normalizedMs: w.normalizedMs,
        ratio: w.ratio,
        isOutlier: w.isOutlier || false,
        sentenceFinal: w.sentenceFinal || false,
        tsSource: w._tsSource || null
      }))
    });
  }

  // Mark transcriptWords as "healed" when alignment resolved them as correct
  // despite having disagreed/unconfirmed cross-validation (e.g., compound merge
  // for "i"+"e"→"ie", Tier 1 near-match override for "format"→"formats").
  // The STT disagreement display uses this to suppress resolved disagreements.
  {
    let hypIdx = 0;
    for (const entry of alignment) {
      if (entry.type === 'omission') continue; // no hyp word consumed
      if (entry.type === 'correct' || entry.forgiven || (entry.type === 'struggle' && entry.compound)) {
        // Walk transcriptWords to find the matching entry by word text
        // The sttLookup queue approach consumed entries in order, so we
        // advance hypIdx through transcriptWords matching hyp values
        while (hypIdx < transcriptWords.length) {
          const tw = transcriptWords[hypIdx];
          const twNorm = tw.word.toLowerCase().replace(/^[^\w'-]+|[^\w'-]+$/g, '').replace(/\./g, '');
          const hypNorm = entry.hyp ? entry.hyp.toLowerCase().replace(/^[^\w'-]+|[^\w'-]+$/g, '').replace(/\./g, '') : '';
          hypIdx++;
          if (twNorm === hypNorm || (entry.compound && entry.parts)) {
            // Found the match — mark healed if cross-validation wasn't confirmed
            if (tw.crossValidation && tw.crossValidation !== 'confirmed') {
              tw._healed = true;
            }
            // For compound words, also heal subsequent parts
            if (entry.compound && entry.parts && entry.parts.length > 1) {
              for (let p = 1; p < entry.parts.length && hypIdx < transcriptWords.length; p++) {
                const partTw = transcriptWords[hypIdx];
                if (partTw.crossValidation && partTw.crossValidation !== 'confirmed') {
                  partTw._healed = true;
                }
                hypIdx++;
              }
            }
            break;
          }
        }
      } else {
        // substitution, insertion, struggle — still advance hypIdx
        hypIdx++;
      }
    }
  }

  displayAlignmentResults(
    alignment,
    wcpm,
    accuracy,
    sttLookup,
    diagnostics,
    transcriptWords,
    tierBreakdown,
    referenceText,                         // Raw reference text for cosmetic punctuation
    appState.audioBlob || null,            // Audio blob for click-to-play word audio
    {                                       // Raw STT word lists + 3-way alignment data
      reverbVerbatim: data._kitchenSink?.reverbVerbatimWords || [],
      reverbClean: data._kitchenSink?.reverbCleanWords || [],
      xvalRaw: data._kitchenSink?.xvalRawWords || [],
      parakeetAlignment: parakeetAlignment || [],
      v0Alignment: v0Alignment || [],
      threeWayTable: threeWayTable || []
    }
  );

  // Log UI bucket classification (runs after displayAlignmentResults stamps _uiBucket)
  addStage('ui_buckets', {
    words: alignment.filter(e => e.type !== 'insertion').map(a => ({
      ref: a.ref, hyp: a.hyp, type: a.type, bucket: a._uiBucket || null,
      compound: a.compound || false, _recovered: a._recovered || false,
      _possibleStruggle: a._possibleStruggle || false, _concatAttempt: a._concatAttempt || null,
      crossValidation: a.crossValidation || null
    }))
  });

  if (appState.selectedStudentId) {
    const errorBreakdown = {
      wordErrors: accuracy.wordErrors,
      omissions: accuracy.omissions,
      longPauseErrors: accuracy.longPauseErrors,
      insertionErrors: accuracy.insertionErrors,
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
        ungrammaticalPauseRate: p.ungrammaticalPauseRate,
        pauseContext: p.pauseContext,
        functionWordCompression: p.functionWordCompression,
        syntacticAlignment: p.syntacticAlignment,
        passageSnippet: referenceText.substring(0, 50),
        assessedAt: new Date().toISOString()
      };
    })();

    saveAssessment(appState.selectedStudentId, {
      _id: assessmentId,
      wcpm: wcpm ? wcpm.wcpmMin : null,
      accuracy: accuracy.accuracy,
      totalWords: accuracy.totalRefWords,
      errors: accuracy.totalErrors,
      duration: effectiveElapsedSeconds,
      passagePreview: referenceText.slice(0, 60),
      passageText: referenceText,
      errorBreakdown,
      alignment,
      sttWords: transcriptWords,
      audioRef: appState.audioBlob ? assessmentId : null,
      nlAnnotations,
      prosody: prosodySnapshot,
      _ensemble: data._ensemble || null
    });
    refreshStudentUI();
    setStatus('Done (saved).');

    // ── Post-assessment launchers ──
    if (appState.audioBlob) {
      showPlaybackButton(appState.selectedStudentId, assessmentId);
    }
    showMazeButton(appState.selectedStudentId, assessmentId, referenceText);
    if (appState.audioBlob) {
      showRhythmRemixButton(appState.selectedStudentId, assessmentId);
    }
    if (nlAnnotations) {
      showIllustratorButton(appState.selectedStudentId, assessmentId);
    }
    // Movie Trailer button — needs reference text + student name
    const selectedStudent = getStudents().find(s => s.id === appState.selectedStudentId);
    showMovieTrailerButton(referenceText, selectedStudent?.name);

    // Future You button — needs audio for stitching
    if (appState.audioBlob) {
      showFutureYouButton(appState.selectedStudentId, assessmentId);
    }

    // Finalize and auto-save debug log
    finalizeDebugLog({
      studentId: appState.selectedStudentId,
      assessmentId,
      wcpm: wcpm?.wcpmMin ?? null,
      accuracy: accuracy.accuracy,
      totalWords: accuracy.totalRefWords,
      errors: accuracy.totalErrors,
      forgiven: accuracy.forgiven,
      ghostCount: data._vad?.ghostCount || 0
    });
  } else {
    setStatus('Done.');
    // Finalize debug log without assessment save
    finalizeDebugLog({
      noStudent: true,
      wcpm: wcpm?.wcpmMin ?? null,
      accuracy: accuracy.accuracy
    });
  }

  analyzeBtn.disabled = false;
}

// API key defaults (encoded to avoid GitHub secret scanning)
const _dk = (s) => atob(s);
const _defaultStt = _dk('QUl6YVN5RGxPQ1BnbzloeW9qOXdCWjg2N0txNkZmUzVucVo4X0JV');
const _defaultGemini = _dk('QUl6YVN5QVdpVTc1cTJtY2pNMHhIdmZySXhYRDFoUUZiNTVETXZz');
const _envKeys = window.ENV_API_KEYS || {};

// Auto-fill API keys: localStorage > env.js > encoded defaults
document.getElementById('apiKey').value = localStorage.getItem('orf_api_key') || _envKeys.stt || _defaultStt;
document.getElementById('apiKey').addEventListener('input', (e) => {
  localStorage.setItem('orf_api_key', e.target.value.trim());
});

// Gemini API key
// Clear any old revoked keys stuck in localStorage
const _revokedKeys = ['AIzaSyCygt7nB45xje5j8-VA_kiXToxmA3xe5LM', 'AIzaSyCTx4rS7zxwRZqNseWcFJAaAgEH5HA50xA'];
if (_revokedKeys.includes(localStorage.getItem('orf_gemini_key'))) localStorage.removeItem('orf_gemini_key');
if (_revokedKeys.includes(localStorage.getItem('orf_api_key'))) localStorage.removeItem('orf_api_key');
const geminiKeyInput = document.getElementById('geminiKey');
geminiKeyInput.value = localStorage.getItem('orf_gemini_key') || _envKeys.gemini || _defaultGemini;
geminiKeyInput.addEventListener('input', () => {
  localStorage.setItem('orf_gemini_key', geminiKeyInput.value.trim());
});

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
const viewOcrBtn = document.getElementById('viewOcrBtn');

// OCR diagnostic data (stored for View OCR feature)
let ocrDiagnosticData = null;

// OCR engine toggle (Cloud Vision vs Gemini)
const ocrEngineToggle = document.getElementById('ocrEngineToggle');
const ocrToggleTrack = document.getElementById('ocrToggleTrack');
const ocrToggleThumb = document.getElementById('ocrToggleThumb');
const ocrEngineLabel = document.getElementById('ocrEngineLabel');

// Persist toggle state (default: hybrid on)
const savedOcrEngine = localStorage.getItem('orf_ocr_engine') || 'hybrid';
if (ocrEngineToggle) {
  ocrEngineToggle.checked = savedOcrEngine === 'hybrid';
  updateOcrToggleUI();
  ocrEngineToggle.addEventListener('change', () => {
    localStorage.setItem('orf_ocr_engine', ocrEngineToggle.checked ? 'hybrid' : 'vision');
    updateOcrToggleUI();
  });
}

function updateOcrToggleUI() {
  if (!ocrEngineToggle) return;
  const isHybrid = ocrEngineToggle.checked;
  ocrToggleTrack.style.background = isHybrid ? '#4285f4' : '#ccc';
  ocrToggleThumb.style.left = isHybrid ? '20px' : '2px';
  ocrEngineLabel.textContent = isHybrid ? 'Vision + Gemini' : 'Cloud Vision';
  ocrEngineLabel.style.color = isHybrid ? '#4285f4' : '#666';
}

if (imageInput) {
  imageInput.addEventListener('change', async () => {
    const file = imageInput.files[0];
    if (!file) return;

    ocrPreview.style.display = 'block';
    ocrImage.src = URL.createObjectURL(file);
    ocrText.value = '';

    const useHybrid = ocrEngineToggle && ocrEngineToggle.checked;

    try {
      let text, engineInfo, lowConfWords = [];
      if (useHybrid) {
        const visionKey = document.getElementById('apiKey').value.trim();
        const geminiKey = localStorage.getItem('orf_gemini_key') || '';
        if (!visionKey) {
          ocrStatus.textContent = 'Error: Please enter a Google Cloud API key first.';
          return;
        }
        if (!geminiKey) {
          ocrStatus.textContent = 'Error: Please enter a Gemini API key first.';
          return;
        }
        ocrStatus.textContent = 'Extracting text (Cloud Vision + Gemini assembly + cleanup)...';
        const result = await extractTextHybrid(file, visionKey, geminiKey);
        console.log('[OCR Diag] allWords:', (result.allWords || []).length, 'flatText:', (result.flatText || '').length, 'assembled:', (result.assembled || '').length);
        text = result.text;
        engineInfo = result.engine;
        lowConfWords = result.lowConfidenceWords || [];
        ocrDiagnosticData = {
          imageBase64: result.imageBase64,
          imageMimeType: result.imageMimeType,
          lowConfidenceWords: lowConfWords,
          allWords: result.allWords || [],
          flatText: result.flatText || '',
          assembled: result.assembled || '',
          pageWidth: result.pageWidth,
          pageHeight: result.pageHeight,
          finalText: text
        };
      } else {
        const apiKey = document.getElementById('apiKey').value.trim();
        if (!apiKey) {
          ocrStatus.textContent = 'Error: Please enter a Google Cloud API key first.';
          return;
        }
        ocrStatus.textContent = 'Extracting text (Cloud Vision)...';
        text = await extractTextFromImage(file, apiKey);
        engineInfo = 'vision';
        ocrDiagnosticData = null; // No bounding box data in plain Vision mode
      }
      ocrText.value = text;
      if (viewOcrBtn) viewOcrBtn.style.display = ocrDiagnosticData ? '' : 'none';
      let statusMsg = text
        ? `Text extracted [${engineInfo}] — review and edit, then click 'Use as Reference Passage'.`
        : 'No text detected in image.';
      if (lowConfWords.length > 0) {
        const wordList = lowConfWords.slice(0, 8).map(w => `${w.word} (${w.confidence}%)`).join(', ');
        statusMsg += ` | Check: ${wordList}`;
      }
      ocrStatus.textContent = statusMsg;
    } catch (err) {
      ocrStatus.textContent = `OCR error: ${err.message}`;
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

if (viewOcrBtn) {
  viewOcrBtn.addEventListener('click', () => {
    if (ocrDiagnosticData) openOcrDiagnosticView(ocrDiagnosticData);
  });
}

function openOcrDiagnosticView(diag) {
  const w = window.open('', '_blank');
  if (!w) return;

  const allWords = diag.allWords || [];
  const lowConfWords = diag.lowConfidenceWords || [];
  const flatText = diag.flatText || '';
  const assembled = diag.assembled || '';
  const finalText = diag.finalText || '';
  const dataUri = `data:${diag.imageMimeType || 'image/jpeg'};base64,${diag.imageBase64}`;

  // Word counts for pipeline summary
  const flatWC = (flatText.match(/\S+/g) || []).length;
  const asmWC = (assembled.match(/\S+/g) || []).length;
  const finalWC = (finalText.match(/\S+/g) || []).length;
  const asmSame = assembled === flatText;
  const corrSame = finalText === assembled;

  // Pre-compute fate for all Vision words
  const finalWordsArr = (finalText).toLowerCase().replace(/[^\w\s'-]/g, ' ').split(/\s+/).filter(Boolean);
  const assembledWordsArr = (assembled).toLowerCase().replace(/[^\w\s'-]/g, ' ').split(/\s+/).filter(Boolean);
  const finalWordSet = new Set(finalWordsArr);
  const assembledWordSet = new Set(assembledWordsArr);

  // Serialize data for the diagnostic page script
  const allWordsJson = JSON.stringify(allWords.map(item => ({
    word: item.word,
    confidence: item.confidence,
    vertices: item.boundingBox?.vertices || item.boundingBox?.normalizedVertices || []
  })));

  // HTML-escape helper
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  w.document.write(`<!DOCTYPE html>
<html><head><title>OCR Diagnostic View</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 1rem; background: #f5f5f5; color: #333; }
  h2 { margin: 0 0 0.5rem; font-size: 1.3rem; }
  h3 { margin: 1.2rem 0 0.5rem; font-size: 1.1rem; border-bottom: 1px solid #ddd; padding-bottom: 4px; }

  /* Section A: Pipeline summary */
  .pipeline-summary {
    background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 10px 16px;
    margin-bottom: 1rem; font-size: 0.9rem; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  }
  .pipeline-stage { background: #e8eaf6; border-radius: 4px; padding: 3px 10px; font-weight: 500; }
  .pipeline-arrow { color: #999; font-size: 1.1rem; }
  .pipeline-detail { color: #666; font-size: 0.82rem; }

  /* Section B: Three-stage text panels */
  .text-panels { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 1rem; }
  .text-panel { background: #fff; border: 1px solid #ddd; border-radius: 6px; overflow: hidden; }
  .text-panel-header { background: #eee; padding: 6px 12px; font-weight: 600; font-size: 0.85rem; border-bottom: 1px solid #ddd; }
  .text-panel-body { padding: 10px 12px; font-size: 0.82rem; line-height: 1.5; max-height: 250px; overflow-y: auto; white-space: pre-wrap; font-family: 'Menlo', 'Consolas', monospace; }

  /* Section C: Diff */
  .diff-container { background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 12px 16px; margin-bottom: 1rem; font-size: 0.85rem; line-height: 1.7; }
  .diff-del { background: #ffcdd2; color: #b71c1c; text-decoration: line-through; padding: 1px 3px; border-radius: 2px; }
  .diff-add { background: #c8e6c9; color: #1b5e20; font-weight: 600; padding: 1px 3px; border-radius: 2px; }

  /* Section D: Word table + image */
  .table-image-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 1rem; }
  @media (max-width: 900px) { .table-image-row { grid-template-columns: 1fr; } .text-panels { grid-template-columns: 1fr; } }
  .word-table-wrap { max-height: 500px; overflow-y: auto; background: #fff; border: 1px solid #ddd; border-radius: 6px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: 5px 10px; border-bottom: 1px solid #eee; text-align: left; font-size: 0.82rem; }
  th { background: #f5f5f5; font-weight: 600; position: sticky; top: 0; z-index: 1; }
  tr:hover { background: #e3f2fd; }
  tr.row-hidden { display: none; }
  .conf-bar { width: 50px; height: 12px; background: #eee; border-radius: 3px; overflow: hidden; display: inline-block; vertical-align: middle; margin-right: 4px; }
  .conf-fill { height: 100%; border-radius: 3px; }
  .fate-kept { background: #c8e6c9; color: #2e7d32; }
  .fate-changed { background: #fff3e0; color: #e65100; }
  .fate-dropped { background: #ffcdd2; color: #c62828; text-decoration: line-through; }
  .fate-badge { padding: 2px 8px; border-radius: 3px; font-size: 0.78rem; white-space: nowrap; }
  .filter-bar { display: flex; gap: 6px; margin-bottom: 8px; }
  .filter-btn { padding: 4px 12px; border: 1px solid #ccc; border-radius: 4px; background: #fff; cursor: pointer; font-size: 0.8rem; }
  .filter-btn.active { background: #1976d2; color: #fff; border-color: #1976d2; }

  /* Image overlay */
  .img-container { position: relative; display: inline-block; }
  .img-container img { display: block; max-width: 100%; border-radius: 6px; }
  .img-container canvas { position: absolute; top: 0; left: 0; pointer-events: none; }

  /* Section E: Interactive editor */
  .editor-section { background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 16px; margin-bottom: 1rem; }
  .editor-words { line-height: 2; font-size: 1rem; }
  .editor-word { cursor: pointer; padding: 2px 4px; border-radius: 3px; transition: all 0.15s; }
  .editor-word:hover { background: #e3f2fd; }
  .editor-word.excluded { text-decoration: line-through; opacity: 0.35; background: #ffcdd2; }
  .editor-word.suspicious { border-bottom: 2px dotted #ff8f00; }
  .editor-word.highly-suspicious { background: #fff3e0; border: 2px solid #e65100; border-radius: 3px; }
  .editor-word.newline-after { margin-right: 0; }
  .editor-newline { display: block; height: 0.6em; }
  .editor-buttons { margin-top: 12px; display: flex; gap: 8px; }
  .editor-buttons button { padding: 6px 16px; border-radius: 4px; border: 1px solid #ccc; cursor: pointer; font-size: 0.85rem; }
  .btn-apply { background: #1976d2; color: #fff; border-color: #1976d2; }
  .btn-apply:hover { background: #1565c0; }
  .btn-reset { background: #fff; }
  .btn-reset:hover { background: #f5f5f5; }
  .editor-status { font-size: 0.82rem; color: #666; margin-top: 8px; }
</style>
</head><body>

<h2>OCR Full Diagnostic</h2>

<!-- Section A: Pipeline Summary -->
<div class="pipeline-summary">
  <span class="pipeline-stage">Cloud Vision</span>
  <span class="pipeline-detail">(${flatWC} words)</span>
  <span class="pipeline-arrow">&rarr;</span>
  <span class="pipeline-stage">Assembly</span>
  <span class="pipeline-detail">(${asmSame ? 'skipped' : asmWC + ' words, ' + (flatWC - asmWC) + ' dropped'})</span>
  <span class="pipeline-arrow">&rarr;</span>
  <span class="pipeline-stage">Correction</span>
  <span class="pipeline-detail">(${corrSame ? 'no changes' : 'applied'})</span>
  <span class="pipeline-arrow">&rarr;</span>
  <span class="pipeline-stage">Final: ${finalWC} words</span>
</div>

<!-- Section B: Three-Stage Text Panels -->
<h3>Pipeline Stages</h3>
<div class="text-panels">
  <div class="text-panel">
    <div class="text-panel-header">Cloud Vision Raw (${flatWC} words)</div>
    <div class="text-panel-body">${esc(flatText) || '<em>empty</em>'}</div>
  </div>
  <div class="text-panel">
    <div class="text-panel-header">Gemini Assembled (${asmSame ? 'same as raw' : asmWC + ' words'})</div>
    <div class="text-panel-body">${asmSame ? '<em>(same as raw)</em>' : esc(assembled)}</div>
  </div>
  <div class="text-panel">
    <div class="text-panel-header">Final Corrected (${corrSame ? 'no corrections' : finalWC + ' words'})</div>
    <div class="text-panel-body">${corrSame ? '<em>(no corrections)</em>' : esc(finalText)}</div>
  </div>
</div>

<!-- Section C: Correction Diff -->
<h3>Correction Diff (Assembled &rarr; Final)</h3>
<div class="diff-container" id="diffContainer"></div>

<!-- Section D: Word Table + Image -->
<h3>All Vision Words (${allWords.length})</h3>
<div class="filter-bar">
  <button class="filter-btn active" data-filter="interesting" onclick="applyFilter('interesting')">Interesting</button>
  <button class="filter-btn" data-filter="all" onclick="applyFilter('all')">All</button>
  <button class="filter-btn" data-filter="dropped" onclick="applyFilter('dropped')">Dropped</button>
  <button class="filter-btn" data-filter="changed" onclick="applyFilter('changed')">Changed</button>
</div>
<div class="table-image-row">
  <div class="word-table-wrap">
    <table>
      <thead><tr><th>#</th><th>Word</th><th>Confidence</th><th>Fate</th><th>Stage</th></tr></thead>
      <tbody id="wordTableBody"></tbody>
    </table>
  </div>
  <div>
    <div class="img-container" id="imgContainer">
      <img id="ocrImg" src="${dataUri}" onload="drawBoxes()">
      <canvas id="overlay"></canvas>
    </div>
  </div>
</div>

<!-- Section E: Interactive Final Text Editor -->
<h3>Interactive Editor</h3>
<p style="font-size:0.82rem;color:#666;margin-top:0;">Click words to exclude them. <span class="editor-word highly-suspicious" style="font-size:0.82rem;display:inline-block;">Orange box</span> = likely line number. <span class="editor-word suspicious" style="font-size:0.82rem;display:inline-block;">Dotted underline</span> = low-confidence or corrected.</p>
<div class="editor-section">
  <div class="editor-words" id="editorWords"></div>
  <div class="editor-buttons">
    <button class="btn-apply" onclick="applyEdits()">Apply to Reference</button>
    <button class="btn-reset" onclick="resetEditor()">Reset</button>
  </div>
  <div class="editor-status" id="editorStatus"></div>
</div>

<script>
// ─── Data ───
const allWordsData = ${allWordsJson};
const pageW = ${diag.pageWidth || 0};
const pageH = ${diag.pageHeight || 0};
const assembledText = ${JSON.stringify(assembled)};
const finalTextStr = ${JSON.stringify(finalText)};
const assembledSame = ${asmSame};
const correctionSame = ${corrSame};

// ─── Helpers ───
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function levenshteinSimilarity(a, b) {
  if (a === b) return 1;
  const la = a.length, lb = b.length;
  if (!la || !lb) return 0;
  const d = Array.from({length: la + 1}, (_, i) => { const r = new Array(lb + 1); r[0] = i; return r; });
  for (let j = 1; j <= lb; j++) d[0][j] = j;
  for (let i = 1; i <= la; i++)
    for (let j = 1; j <= lb; j++)
      d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + (a[i-1] !== b[j-1] ? 1 : 0));
  return 1 - d[la][lb] / Math.max(la, lb);
}

// ─── Word-level diff via LCS ───
function wordDiff(oldText, newText) {
  const a = oldText.split(/\s+/).filter(Boolean);
  const b = newText.split(/\s+/).filter(Boolean);
  const m = a.length, n = b.length;
  // LCS table
  const dp = Array.from({length: m + 1}, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
  // Backtrack
  const result = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i-1] === b[j-1]) {
      result.push({ type: 'equal', word: a[i-1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      result.push({ type: 'add', word: b[j-1] });
      j--;
    } else {
      result.push({ type: 'del', word: a[i-1] });
      i--;
    }
  }
  return result.reverse();
}

// ─── Section C: Render correction diff ───
(function renderDiff() {
  const container = document.getElementById('diffContainer');
  if (correctionSame) {
    container.innerHTML = '<em style="color:#999;">No corrections were made.</em>';
    return;
  }
  const diff = wordDiff(assembledText, finalTextStr);
  container.innerHTML = diff.map(d => {
    if (d.type === 'equal') return esc(d.word);
    if (d.type === 'del') return '<span class="diff-del">' + esc(d.word) + '</span>';
    return '<span class="diff-add">' + esc(d.word) + '</span>';
  }).join(' ');
})();

// ─── Section D: Word table ───
// Split hyphens so "twenty-four" → ["twenty", "four"] both appear in word sets
function splitWords(text) {
  return text.toLowerCase().replace(/[^\\w\\s'-]/g, ' ').replace(/-/g, ' ').split(/\\s+/).filter(Boolean);
}
const finalWordsLower = splitWords(finalTextStr);
const assembledWordsLower = splitWords(assembledText);
const finalWordSet = new Set(finalWordsLower);
const assembledWordSet = new Set(assembledWordsLower);

function determineFate(word) {
  const norm = word.toLowerCase().replace(/[^\\w'-]/g, '');
  if (!norm) return { fate: 'Dropped', stage: 'assembly' };
  // Check final text (exact or hyphen-split match)
  if (finalWordSet.has(norm)) return { fate: 'Kept', stage: '' };
  // Fuzzy check final (threshold 0.8 to avoid false matches like twenty→plenty)
  for (const fw of finalWordsLower) {
    if (levenshteinSimilarity(norm, fw) >= 0.8) return { fate: 'Changed', to: fw, stage: assembledWordSet.has(fw) ? 'correction' : 'assembly' };
  }
  // In assembled but not final?
  if (assembledWordSet.has(norm)) return { fate: 'Dropped', stage: 'correction' };
  // Fuzzy check assembled
  for (const aw of assembledWordsLower) {
    if (levenshteinSimilarity(norm, aw) >= 0.8) return { fate: 'Changed', to: aw, stage: 'assembly' };
  }
  return { fate: 'Dropped', stage: 'assembly' };
}

const fates = allWordsData.map(item => determineFate(item.word));

function buildTable() {
  const tbody = document.getElementById('wordTableBody');
  let html = '';
  for (let i = 0; i < allWordsData.length; i++) {
    const item = allWordsData[i];
    const f = fates[i];
    const pct = item.confidence !== null ? item.confidence : '?';
    const hue = pct !== '?' ? Math.round((pct / 100) * 120) : 0;
    const confBar = pct !== '?'
      ? '<div class="conf-bar"><div class="conf-fill" style="width:' + pct + '%;background:hsl(' + hue + ',70%,50%);"></div></div>' + pct + '%'
      : '?';
    let fateBadge;
    if (f.fate === 'Kept') fateBadge = '<span class="fate-badge fate-kept">Kept</span>';
    else if (f.fate === 'Changed') fateBadge = '<span class="fate-badge fate-changed">Changed &rarr; ' + esc(f.to) + '</span>';
    else fateBadge = '<span class="fate-badge fate-dropped">Dropped</span>';
    const stageText = f.stage || '';
    const isInteresting = (pct !== '?' && pct < 85) || f.fate !== 'Kept';
    html += '<tr data-idx="' + i + '" data-fate="' + f.fate.toLowerCase() + '" data-interesting="' + (isInteresting ? '1' : '0') + '" style="cursor:pointer;" onclick="flashBox(' + i + ')">'
      + '<td>' + (i + 1) + '</td>'
      + '<td>' + esc(item.word) + '</td>'
      + '<td>' + confBar + '</td>'
      + '<td>' + fateBadge + '</td>'
      + '<td style="font-size:0.78rem;color:#999;">' + stageText + '</td>'
      + '</tr>';
  }
  tbody.innerHTML = html;
}
buildTable();

let currentFilter = 'interesting';
function applyFilter(filter) {
  currentFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
  const rows = document.querySelectorAll('#wordTableBody tr');
  rows.forEach(row => {
    if (filter === 'all') { row.classList.remove('row-hidden'); return; }
    if (filter === 'interesting') { row.classList.toggle('row-hidden', row.dataset.interesting !== '1'); return; }
    if (filter === 'dropped') { row.classList.toggle('row-hidden', row.dataset.fate !== 'dropped'); return; }
    if (filter === 'changed') { row.classList.toggle('row-hidden', row.dataset.fate !== 'changed'); return; }
  });
}
applyFilter('interesting');

// ─── Section D: Image overlay ───
function drawBoxes() {
  const img = document.getElementById('ocrImg');
  const canvas = document.getElementById('overlay');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.style.width = img.clientWidth + 'px';
  canvas.style.height = img.clientHeight + 'px';
  const ctx = canvas.getContext('2d');
  const scaleX = pageW ? img.naturalWidth / pageW : 1;
  const scaleY = pageH ? img.naturalHeight / pageH : 1;

  // Draw boxes only for visible (non-hidden) table rows or all interesting by default
  const visibleIdxs = new Set();
  document.querySelectorAll('#wordTableBody tr:not(.row-hidden)').forEach(row => {
    visibleIdxs.add(parseInt(row.dataset.idx));
  });

  for (let i = 0; i < allWordsData.length; i++) {
    if (!visibleIdxs.has(i)) continue;
    const v = allWordsData[i].vertices;
    if (!v || v.length < 4) continue;
    const pct = allWordsData[i].confidence || 0;
    const hue = Math.round((pct / 100) * 120);
    ctx.strokeStyle = 'hsl(' + hue + ',70%,50%)';
    ctx.lineWidth = 2;
    ctx.fillStyle = 'hsla(' + hue + ',70%,50%,0.12)';
    const x0 = (v[0].x || 0) * scaleX, y0 = (v[0].y || 0) * scaleY;
    const x1 = (v[1].x || 0) * scaleX, y1 = (v[1].y || 0) * scaleY;
    const x2 = (v[2].x || 0) * scaleX, y2 = (v[2].y || 0) * scaleY;
    const x3 = (v[3].x || 0) * scaleX, y3 = (v[3].y || 0) * scaleY;
    ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function flashBox(idx) {
  const canvas = document.getElementById('overlay');
  const img = document.getElementById('ocrImg');
  const v = allWordsData[idx]?.vertices;
  if (!v || v.length < 4) return;
  const scaleX = pageW ? img.naturalWidth / pageW : 1;
  const scaleY = pageH ? img.naturalHeight / pageH : 1;

  const container = document.getElementById('imgContainer');
  container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const ctx = canvas.getContext('2d');
  const x0 = (v[0].x || 0) * scaleX, y0 = (v[0].y || 0) * scaleY;
  const x2 = (v[2].x || 0) * scaleX, y2 = (v[2].y || 0) * scaleY;
  const bw = x2 - x0, bh = y2 - y0;

  let count = 0;
  const interval = setInterval(() => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBoxes();
    if (count % 2 === 0) {
      ctx.strokeStyle = '#ff1744';
      ctx.lineWidth = 3;
      ctx.strokeRect(x0 - 2, y0 - 2, bw + 4, bh + 4);
    }
    count++;
    if (count >= 6) clearInterval(interval);
  }, 250);
}

// Redraw boxes when filter changes
const origApplyFilter = applyFilter;
applyFilter = function(filter) {
  origApplyFilter(filter);
  const img = document.getElementById('ocrImg');
  if (img.complete) drawBoxes();
};
applyFilter('interesting');

window.addEventListener('resize', () => {
  const img = document.getElementById('ocrImg');
  const canvas = document.getElementById('overlay');
  if (img && canvas) {
    canvas.style.width = img.clientWidth + 'px';
    canvas.style.height = img.clientHeight + 'px';
  }
});

// ─── Section E: Interactive editor ───
// Build per-word suspicious set
const assembledNorms = new Set(assembledWordsLower);
const correctionDiff = correctionSame ? new Set() : (function() {
  const d = wordDiff(assembledText, finalTextStr);
  const changed = new Set();
  d.forEach(item => { if (item.type === 'add') changed.add(item.word.toLowerCase()); });
  return changed;
})();

// Confidence lookup for final words (by norm match to allWordsData)
const confByNorm = new Map();
allWordsData.forEach(item => {
  const norm = item.word.toLowerCase().replace(/[^\\w'-]/g, '');
  if (norm && item.confidence !== null && (!confByNorm.has(norm) || confByNorm.get(norm) > item.confidence)) {
    confByNorm.set(norm, item.confidence);
  }
});

// Parse final text into words preserving paragraph breaks
const editorTokens = []; // {text, isNewline, idx}
let editorIdx = 0;
const finalLines = finalTextStr.split('\\n');
for (let li = 0; li < finalLines.length; li++) {
  const lineWords = finalLines[li].split(/\\s+/).filter(Boolean);
  for (const tw of lineWords) {
    editorTokens.push({ text: tw, isNewline: false, idx: editorIdx++ });
  }
  if (li < finalLines.length - 1) {
    editorTokens.push({ text: '', isNewline: true, idx: -1 });
  }
}

const excluded = new Set();

// Returns false, 'suspicious', or 'highly-suspicious'
function getSuspicionLevel(word) {
  const norm = word.toLowerCase().replace(/[^\\w'-]/g, '');
  // Standalone numbers are highly suspicious (likely line numbers Gemini kept)
  if (/^\\d+$/.test(norm)) return 'highly-suspicious';
  // Low-confidence words Gemini kept
  const conf = confByNorm.get(norm);
  if (conf !== undefined && conf < 70) return 'suspicious';
  // Words that correction changed
  if (correctionDiff.has(norm)) return 'suspicious';
  return false;
}

function renderEditor() {
  const container = document.getElementById('editorWords');
  let html = '';
  for (const tok of editorTokens) {
    if (tok.isNewline) {
      html += '<span class="editor-newline"></span>';
      continue;
    }
    const cls = ['editor-word'];
    if (excluded.has(tok.idx)) cls.push('excluded');
    const suspicion = getSuspicionLevel(tok.text);
    if (suspicion) cls.push(suspicion);
    html += '<span class="' + cls.join(' ') + '" data-idx="' + tok.idx + '" onclick="toggleWord(' + tok.idx + ')">' + esc(tok.text) + '</span> ';
  }
  container.innerHTML = html;
  updateEditorStatus();
}

function toggleWord(idx) {
  if (excluded.has(idx)) excluded.delete(idx);
  else excluded.add(idx);
  // Toggle class directly for speed
  const span = document.querySelector('.editor-word[data-idx="' + idx + '"]');
  if (span) span.classList.toggle('excluded');
  updateEditorStatus();
}

function updateEditorStatus() {
  const total = editorTokens.filter(t => !t.isNewline).length;
  const excl = excluded.size;
  const status = document.getElementById('editorStatus');
  status.textContent = excl > 0 ? excl + ' of ' + total + ' words excluded' : total + ' words';
}

function resetEditor() {
  excluded.clear();
  renderEditor();
}

function applyEdits() {
  // Rebuild text preserving paragraph structure, minus excluded words
  const lines = finalTextStr.split('\\n');
  let globalIdx = 0;
  const newLines = [];
  for (const line of lines) {
    const words = line.split(/\\s+/).filter(Boolean);
    const kept = [];
    for (const w of words) {
      if (!excluded.has(globalIdx)) kept.push(w);
      globalIdx++;
    }
    newLines.push(kept.join(' '));
  }
  const editedText = newLines.join('\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
  // Send back to parent
  if (window.opener) {
    try {
      const textarea = window.opener.document.getElementById('ocrText');
      if (textarea) {
        textarea.value = editedText;
        document.getElementById('editorStatus').textContent = 'Applied! ' + (editorTokens.filter(t => !t.isNewline).length - excluded.size) + ' words sent to parent.';
        document.getElementById('editorStatus').style.color = '#2e7d32';
      } else {
        document.getElementById('editorStatus').textContent = 'Error: Could not find OCR textarea in parent window.';
        document.getElementById('editorStatus').style.color = '#c62828';
      }
    } catch (e) {
      document.getElementById('editorStatus').textContent = 'Error: ' + e.message;
      document.getElementById('editorStatus').style.color = '#c62828';
    }
  } else {
    document.getElementById('editorStatus').textContent = 'No parent window found.';
    document.getElementById('editorStatus').style.color = '#c62828';
  }
}

renderEditor();
<\/script>
</body></html>`);
  w.document.close();
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

// --- Backend connection settings ---
const backendUrlInput = document.getElementById('backendUrl');
const backendTokenInput = document.getElementById('backendToken');
const backendTestBtn = document.getElementById('backendTestBtn');
const backendStatusText = document.getElementById('backendStatusText');
const backendReloadNotice = document.getElementById('backendReloadNotice');

if (backendUrlInput) {
  // Check URL parameters first (used by external login redirects)
  const urlParams = new URLSearchParams(window.location.search);
  const paramUrl = urlParams.get('backendUrl');
  const paramToken = urlParams.get('backendToken');
  if (paramUrl) {
    localStorage.setItem('orf_backend_url', paramUrl);
    backendUrlInput.value = paramUrl;
  }
  if (paramToken) {
    localStorage.setItem('orf_backend_token', paramToken);
    backendTokenInput.value = paramToken;
  }
  // Strip credentials from URL bar without reloading
  if (paramUrl || paramToken) {
    const cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, '', cleanUrl);
  }

  // Pre-fill from localStorage (if not already set by URL params)
  const savedUrl = localStorage.getItem('orf_backend_url') || '';
  const savedToken = localStorage.getItem('orf_backend_token') || '';
  if (!backendUrlInput.value && savedUrl) backendUrlInput.value = savedUrl;
  if (!backendTokenInput.value && savedToken) backendTokenInput.value = savedToken;

  // Auto-fetch backend config from GitHub Pages — always check for tunnel URL updates
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) {
    fetch('backend-config.json?t=' + Date.now()).then(r => r.json()).then(cfg => {
      if (cfg.backendUrl) {
        backendUrlInput.value = cfg.backendUrl;
        localStorage.setItem('orf_backend_url', cfg.backendUrl);
      }
      if (cfg.backendToken) {
        backendTokenInput.value = cfg.backendToken;
        localStorage.setItem('orf_backend_token', cfg.backendToken);
      }
    }).catch(() => {}); // Silent fail — user can configure manually
  }

  // Track whether values have changed since page load
  const initialUrl = savedUrl;
  const initialToken = savedToken;

  function onBackendSettingsChange() {
    const newUrl = backendUrlInput.value.trim();
    const newToken = backendTokenInput.value.trim();

    // Persist to localStorage
    if (newUrl) {
      localStorage.setItem('orf_backend_url', newUrl);
    } else {
      localStorage.removeItem('orf_backend_url');
    }
    if (newToken) {
      localStorage.setItem('orf_backend_token', newToken);
    } else {
      localStorage.removeItem('orf_backend_token');
    }

    // Show reload notice if changed after initial load
    const changed = newUrl !== initialUrl || newToken !== initialToken;
    backendReloadNotice.style.display = changed ? 'block' : 'none';
  }

  backendUrlInput.addEventListener('change', onBackendSettingsChange);
  backendTokenInput.addEventListener('change', onBackendSettingsChange);

  // Reload button
  const backendReloadBtn = document.getElementById('backendReloadBtn');
  if (backendReloadBtn) {
    backendReloadBtn.addEventListener('click', () => location.reload());
  }

  // Test connection button
  if (backendTestBtn) {
    backendTestBtn.addEventListener('click', async () => {
      const url = backendUrlInput.value.trim()
        || (['localhost','127.0.0.1'].includes(location.hostname) ? 'http://localhost:8765' : '');
      backendStatusText.className = '';
      if (!url) {
        backendStatusText.textContent = 'Not configured — enter your backend URL above';
        backendStatusText.className = 'err';
        return;
      }
      // Mixed-content warning: HTTPS page cannot call HTTP backend
      if (location.protocol === 'https:' && url.startsWith('http://') && !url.includes('localhost')) {
        backendStatusText.textContent = 'Warning: HTTPS page cannot call HTTP backend. Use an HTTPS URL.';
        backendStatusText.className = 'err';
        return;
      }
      backendStatusText.textContent = 'Testing...';
      try {
        const resp = await fetch(`${url}/health`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000)
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const services = [];
        if (data.status === 'ok' || data.status === 'ready') services.push('Reverb');
        if (data.parakeet_configured) services.push('Parakeet');
        if (data.deepgram_configured) services.push('Deepgram');
        backendStatusText.textContent = services.length
          ? `Connected: ${services.join(', ')}`
          : 'Connected (no services detected)';
        backendStatusText.className = 'ok';
      } catch (e) {
        backendStatusText.textContent = `Failed: ${e.message}`;
        backendStatusText.className = 'err';
      }
    });
  }

  // Auto-test on page load (silent)
  (async () => {
    const url = backendUrlInput.value.trim()
      || (['localhost','127.0.0.1'].includes(location.hostname) ? 'http://localhost:8765' : '');
    if (!url) {
      backendStatusText.textContent = 'Not configured — enter your backend URL above';
      backendStatusText.className = 'err';
      return;
    }
    try {
      const resp = await fetch(`${url}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000)
      });
      if (resp.ok) {
        const data = await resp.json();
        const services = [];
        if (data.status === 'ok' || data.status === 'ready') services.push('Reverb');
        if (data.parakeet_configured) services.push('Parakeet');
        if (data.deepgram_configured) services.push('Deepgram');
        backendStatusText.textContent = services.length
          ? `Connected: ${services.join(', ')}`
          : 'Connected';
        backendStatusText.className = 'ok';
      }
    } catch {
      // Silent failure on auto-test — user can click Test Connection
    }
  })();
}

// --- Dev mode toggle (Phase 16) ---
const devModeToggle = document.getElementById('devModeToggle');
if (devModeToggle) {
  // Dev mode off by default; only enable if explicitly set to 'true'
  if (localStorage.getItem('orf_dev_mode') === 'true') {
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
