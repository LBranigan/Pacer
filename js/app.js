import { initRecorder, setOnComplete as recorderSetOnComplete } from './recorder.js';
import { initFileHandler, setOnComplete as fileHandlerSetOnComplete } from './file-handler.js';
import { sendToSTT } from './stt-api.js';
import { alignWords } from './alignment.js';
import { computeWCPM, computeAccuracy } from './metrics.js';
import { setStatus, displayResults, displayAlignmentResults } from './ui.js';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(reg => console.log('SW registered:', reg.scope))
    .catch(err => console.warn('SW registration failed:', err));
}

async function processAssessment(blob, encoding, elapsedSeconds) {
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

  const alignment = alignWords(referenceText, transcriptWords);
  const wcpm = (elapsedSeconds != null && elapsedSeconds > 0)
    ? computeWCPM(alignment, elapsedSeconds)
    : null;
  const accuracy = computeAccuracy(alignment);

  displayAlignmentResults(alignment, wcpm, accuracy);
  setStatus('Done.');
}

initRecorder();
initFileHandler();

recorderSetOnComplete((blob, enc, secs) => processAssessment(blob, enc, secs));
fileHandlerSetOnComplete((blob, enc) => processAssessment(blob, enc, null));
