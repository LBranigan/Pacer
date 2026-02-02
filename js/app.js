import { initRecorder, setOnComplete as recorderSetOnComplete } from './recorder.js';
import { initFileHandler, setOnComplete as fileHandlerSetOnComplete } from './file-handler.js';
import { sendToSTT } from './stt-api.js';
import { alignWords } from './alignment.js';
import { computeWCPM, computeAccuracy } from './metrics.js';
import { setStatus, displayResults, displayAlignmentResults, showAudioPlayback } from './ui.js';
import { runDiagnostics } from './diagnostics.js';
import { extractTextFromImage } from './ocr-api.js';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(reg => console.log('SW registered:', reg.scope))
    .catch(err => console.warn('SW registration failed:', err));
}

async function processAssessment(blob, encoding, elapsedSeconds) {
  showAudioPlayback(blob);
  const data = await sendToSTT(blob, encoding);

  if (!data || !data.results) {
    displayResults(data || {});
    return;
  }

  const referenceText = document.getElementById('transcript').value.trim();

  if (!referenceText) {
    displayResults(data);
    setStatus('Done (no reference passage for alignment).');
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

  // Build lookup: normalized hyp word -> queue of STT metadata
  const sttLookup = new Map();
  for (const w of transcriptWords) {
    const norm = w.word.toLowerCase().replace(/^[^\w'-]+|[^\w'-]+$/g, '');
    if (!sttLookup.has(norm)) sttLookup.set(norm, []);
    sttLookup.get(norm).push(w);
  }

  const alignment = alignWords(referenceText, transcriptWords);
  const wcpm = (elapsedSeconds != null && elapsedSeconds > 0)
    ? computeWCPM(alignment, elapsedSeconds)
    : null;
  const accuracy = computeAccuracy(alignment);

  const diagnostics = runDiagnostics(transcriptWords, alignment, referenceText, sttLookup);
  displayAlignmentResults(alignment, wcpm, accuracy, sttLookup, diagnostics);
  setStatus('Done.');
}

// Auto-fill API key for dev/testing
document.getElementById('apiKey').value = 'AIzaSyCTx4rS7zxwRZqNseWcFJAaAgEH5HA50xA';

initRecorder();
initFileHandler();

recorderSetOnComplete((blob, enc, secs) => processAssessment(blob, enc, secs));
fileHandlerSetOnComplete((blob, enc) => processAssessment(blob, enc, null));

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
    ocrStatus.textContent = 'Reference passage updated.';
  });
}
