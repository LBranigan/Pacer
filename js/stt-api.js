import { setStatus, displayResults } from './ui.js';

function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(blob);
  });
}

export async function sendToSTT(blob, encoding) {
  const apiKey = document.getElementById('apiKey').value.trim();
  if (!apiKey) { setStatus('Please enter your API key.'); return; }

  setStatus('Sending to Google Cloud STT...');
  const base64 = await blobToBase64(blob);

  // Build speech contexts from reference passage to boost recognition of expected words
  const passageText = document.getElementById('transcript').value.trim();
  const speechContexts = [];
  if (passageText) {
    const words = [...new Set(passageText.toLowerCase().replace(/[^a-z'\s-]/g, '').split(/\s+/).filter(Boolean))];
    if (words.length > 0) {
      speechContexts.push({ phrases: words, boost: 5 });
    }
  }

  const body = {
    config: {
      encoding: encoding,
      languageCode: 'en-US',
      model: 'latest_long',
      useEnhanced: true,
      enableAutomaticPunctuation: false,
      enableSpokenPunctuation: false,
      enableWordTimeOffsets: true,
      enableWordConfidence: true,
      maxAlternatives: 2,
      speechContexts: speechContexts
    },
    audio: { content: base64 }
  };

  try {
    const resp = await fetch(
      'https://speech.googleapis.com/v1/speech:recognize?key=' + encodeURIComponent(apiKey),
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    const data = await resp.json();
    if (data.error) { setStatus('API Error: ' + data.error.message); return; }
    displayResults(data);
    setStatus('Done.');
  } catch (e) {
    setStatus('Request failed: ' + e.message);
  }
}
