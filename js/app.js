import { initRecorder, setOnComplete as recorderSetOnComplete } from './recorder.js';
import { initFileHandler, setOnComplete as fileHandlerSetOnComplete } from './file-handler.js';
import { sendToSTT, sendToAsyncSTT, sendChunkedSTT } from './stt-api.js';
import { alignWords } from './alignment.js';
import { getCanonical } from './word-equivalences.js';
import { computeWCPM, computeAccuracy } from './metrics.js';
import { setStatus, displayResults, displayAlignmentResults, showAudioPlayback, renderStudentSelector, renderHistory } from './ui.js';
import { runDiagnostics, computeTierBreakdown } from './diagnostics.js';
import { extractTextFromImage } from './ocr-api.js';
import { trimPassageToAttempted } from './passage-trimmer.js';
import { analyzePassageText, levenshteinRatio } from './nl-api.js';
import { getStudents, addStudent, deleteStudent, saveAssessment, getAssessments } from './storage.js';
import { saveAudioBlob } from './audio-store.js';
import { initDashboard } from './dashboard.js';

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
    setStatus('Sending audio to STT...');
    data = await sendToSTT(appState.audioBlob, appState.audioEncoding);
  }

  if (!data || !data.results) {
    displayResults(data || {});
    analyzeBtn.disabled = false;
    return;
  }

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
  }

  // Build lookup: normalized hyp word -> queue of STT metadata
  const sttLookup = new Map();
  for (const w of transcriptWords) {
    const norm = getCanonical(w.word.toLowerCase().replace(/^[^\w'-]+|[^\w'-]+$/g, ''));
    if (!sttLookup.has(norm)) sttLookup.set(norm, []);
    sttLookup.get(norm).push(w);
  }

  const alignment = alignWords(referenceText, transcriptWords);

  // Run diagnostics first so we can heal self-corrections
  const diagnostics = runDiagnostics(transcriptWords, alignment, referenceText, sttLookup);

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

    // ASR healing: forgive proper noun substitutions with high similarity
    for (const entry of alignment) {
      if (entry.type === 'substitution' && entry.nl && entry.nl.isProperNoun) {
        const ratio = levenshteinRatio(entry.ref, entry.hyp);
        if (ratio > 0.5) {
          entry.originalHyp = entry.hyp;
          entry.healed = true;
          entry.type = 'correct';
        }
      }
    }
  }

  const wcpm = (appState.elapsedSeconds != null && appState.elapsedSeconds > 0)
    ? computeWCPM(alignment, appState.elapsedSeconds)
    : null;
  const accuracy = computeAccuracy(alignment, { forgivenessEnabled: !!nlAnnotations });
  const tierBreakdown = nlAnnotations ? computeTierBreakdown(alignment) : null;
  displayAlignmentResults(alignment, wcpm, accuracy, sttLookup, diagnostics, transcriptWords, tierBreakdown);

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
      duration: appState.elapsedSeconds,
      passagePreview: referenceText.slice(0, 60),
      errorBreakdown,
      alignment,
      sttWords: transcriptWords,
      audioRef: appState.audioBlob ? assessmentId : null,
      nlAnnotations
    });
    refreshStudentUI();
    setStatus('Done (saved).');

    // Show student playback button if audio exists
    if (appState.audioBlob) {
      showPlaybackButton(appState.selectedStudentId, assessmentId);
    }
  } else {
    setStatus('Done.');
  }

  analyzeBtn.disabled = false;
}

// Auto-fill API key for dev/testing
document.getElementById('apiKey').value = 'AIzaSyCTx4rS7zxwRZqNseWcFJAaAgEH5HA50xA';

initRecorder();
initFileHandler();

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
