import { initRecorder, setOnComplete as recorderSetOnComplete } from './recorder.js';
import { initFileHandler, setOnComplete as fileHandlerSetOnComplete } from './file-handler.js';
import { sendToSTT, sendToAsyncSTT, sendChunkedSTT } from './stt-api.js';
import { alignWords } from './alignment.js';
import { computeWCPM, computeAccuracy } from './metrics.js';
import { setStatus, displayResults, displayAlignmentResults, showAudioPlayback, renderStudentSelector, renderHistory } from './ui.js';
import { runDiagnostics } from './diagnostics.js';
import { extractTextFromImage } from './ocr-api.js';
import { trimPassageToAttempted } from './passage-trimmer.js';
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

  // Build lookup: normalized hyp word -> queue of STT metadata
  const sttLookup = new Map();
  for (const w of transcriptWords) {
    const norm = w.word.toLowerCase().replace(/^[^\w'-]+|[^\w'-]+$/g, '');
    if (!sttLookup.has(norm)) sttLookup.set(norm, []);
    sttLookup.get(norm).push(w);
  }

  const alignment = alignWords(referenceText, transcriptWords);
  const wcpm = (appState.elapsedSeconds != null && appState.elapsedSeconds > 0)
    ? computeWCPM(alignment, appState.elapsedSeconds)
    : null;
  const accuracy = computeAccuracy(alignment);

  const diagnostics = runDiagnostics(transcriptWords, alignment, referenceText, sttLookup);
  displayAlignmentResults(alignment, wcpm, accuracy, sttLookup, diagnostics, transcriptWords);

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
      audioRef: appState.audioBlob ? assessmentId : null
    });
    refreshStudentUI();
    setStatus('Done (saved).');
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
  const name = input.value.trim();
  if (name) {
    const student = addStudent(name);
    input.value = '';
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
