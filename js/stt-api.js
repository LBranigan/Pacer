// =============================================================================
// GOOGLE CLOUD STT — COMMENTED OUT (2026-02-06)
// =============================================================================
// This module is no longer used. The Kitchen Sink pipeline (Reverb + Deepgram)
// has fully replaced Google Cloud Speech-to-Text for all transcription.
// Keeping the code for historical reference only.
// =============================================================================

/*
import { setStatus } from './ui.js';

function buildSpeechContexts(passageText, options = {}) {
  const { properNounBoost = 5, uncommonBoost = 3 } = options;
  if (!passageText) return [];

  const originalWords = passageText.split(/\s+/);
  const normalized = passageText.toLowerCase().replace(/[^a-z'\s-]/g, '').split(/\s+/).filter(Boolean);

  const properNouns = [];
  const uncommonWords = [];

  for (let i = 0; i < originalWords.length; i++) {
    const orig = originalWords[i];
    const norm = normalized[i];
    if (!norm) continue;

    const prevWord = i > 0 ? originalWords[i - 1] : '';
    const afterSentenceEnd = /[.!?]$/.test(prevWord);

    if (/^[A-Z]/.test(orig) && i > 0 && !afterSentenceEnd) {
      properNouns.push(norm);
    } else if (norm.length >= 8) {
      uncommonWords.push(norm);
    }
  }

  const contexts = [];
  if (properNouns.length > 0) {
    contexts.push({ phrases: [...new Set(properNouns)], boost: properNounBoost });
  }
  if (uncommonWords.length > 0) {
    contexts.push({ phrases: [...new Set(uncommonWords)], boost: uncommonBoost });
  }
  return contexts;
}

function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(blob);
  });
}

async function fetchSTTRaw(base64, config, apiKey) {
  const resp = await fetch(
    'https://speech.googleapis.com/v1/speech:recognize?key=' + encodeURIComponent(apiKey),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, audio: { content: base64 } })
    }
  );
  const data = await resp.json();
  if (data.error) {
    throw new Error(data.error.message || 'STT API error');
  }
  return data;
}

function buildSTTConfig(encoding, sampleRateHertz = null) {
  const passageText = document.getElementById('transcript').value.trim();
  const config = {
    encoding: encoding,
    languageCode: 'en-US',
    model: 'latest_long',
    useEnhanced: true,
    enableAutomaticPunctuation: false,
    enableSpokenPunctuation: false,
    enableWordTimeOffsets: true,
    enableWordConfidence: true,
    maxAlternatives: 1,
    speechContexts: buildSpeechContexts(passageText, { properNounBoost: 5, uncommonBoost: 3 })
  };
  if (encoding === 'LINEAR16' && sampleRateHertz) {
    config.sampleRateHertz = sampleRateHertz;
  }
  return config;
}

export async function sendToSTT(blob, encoding) {
  const apiKey = document.getElementById('apiKey').value.trim();
  if (!apiKey) { setStatus('Please enter your API key.'); return null; }
  setStatus('Sending to Google Cloud STT...');
  const base64 = await blobToBase64(blob);
  const body = { config: buildSTTConfig(encoding), audio: { content: base64 } };
  try {
    const resp = await fetch(
      'https://speech.googleapis.com/v1/speech:recognize?key=' + encodeURIComponent(apiKey),
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    const data = await resp.json();
    if (data.error) { setStatus('API Error: ' + data.error.message); return null; }
    return data;
  } catch (e) {
    setStatus('Request failed: ' + e.message);
    return null;
  }
}

async function pollOperation(operationName, apiKey, onProgress) {
  const POLL_INTERVAL = 3000;
  const MAX_POLLS = 100;
  for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
    const resp = await fetch(
      `https://speech.googleapis.com/v1/operations/${operationName}?key=${encodeURIComponent(apiKey)}`
    );
    const op = await resp.json();
    if (onProgress) { onProgress(op.metadata?.progressPercent || 0); }
    if (op.done) {
      if (op.error) { throw new Error(op.error.message || 'Async STT operation failed'); }
      return op.response;
    }
  }
  throw new Error('Async STT timed out after 5 minutes');
}

export async function sendToAsyncSTT(blob, encoding, onProgress) {
  const apiKey = document.getElementById('apiKey').value.trim();
  if (!apiKey) { setStatus('Please enter your API key.'); return null; }
  const base64 = await blobToBase64(blob);
  const body = { config: buildSTTConfig(encoding), audio: { content: base64 } };
  const resp = await fetch(
    'https://speech.googleapis.com/v1/speech:longrunningrecognize?key=' + encodeURIComponent(apiKey),
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  const data = await resp.json();
  if (data.error) {
    const msg = data.error.message || '';
    if (msg.includes('Inline audio') || msg.includes('GCS URI')) {
      const err = new Error(msg);
      err.code = 'INLINE_REJECTED';
      throw err;
    }
    throw new Error(msg);
  }
  if (!data.name) { throw new Error('No operation name returned from longrunningrecognize'); }
  return await pollOperation(data.name, apiKey, onProgress);
}

export async function sendChunkedSTT(blob, encoding) {
  const apiKey = document.getElementById('apiKey').value.trim();
  if (!apiKey) { setStatus('Please enter your API key.'); return null; }
  const CHUNK_SIZE = 200 * 1024;
  const chunks = [];
  for (let offset = 0; offset < blob.size; offset += CHUNK_SIZE) {
    chunks.push(blob.slice(offset, offset + CHUNK_SIZE, blob.type));
  }
  const mergedResults = [];
  const config = buildSTTConfig(encoding);
  for (let i = 0; i < chunks.length; i++) {
    setStatus(`Processing chunk ${i + 1} of ${chunks.length}...`);
    const base64 = await blobToBase64(chunks[i]);
    const body = { config, audio: { content: base64 } };
    const resp = await fetch(
      'https://speech.googleapis.com/v1/speech:recognize?key=' + encodeURIComponent(apiKey),
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    const data = await resp.json();
    if (data.error) { console.warn(`Chunk ${i + 1} error:`, data.error.message); continue; }
    if (data.results) { mergedResults.push(...data.results); }
  }
  return { results: mergedResults };
}

export function getDefaultModelConfig(encoding, passageText, sampleRateHertz = null) {
  const config = {
    encoding: encoding,
    languageCode: 'en-US',
    model: 'default',
    useEnhanced: true,
    enableAutomaticPunctuation: false,
    enableSpokenPunctuation: false,
    enableWordTimeOffsets: true,
    enableWordConfidence: true,
    maxAlternatives: 1,
    speechContexts: buildSpeechContexts(passageText, { properNounBoost: 3, uncommonBoost: 2 })
  };
  if (encoding === 'LINEAR16' && sampleRateHertz) {
    config.sampleRateHertz = sampleRateHertz;
  }
  return config;
}

export async function sendEnsembleSTT(blob, encoding, sampleRateHertz = null) {
  const apiKey = document.getElementById('apiKey').value.trim();
  if (!apiKey) {
    return { latestLong: null, default: null, errors: { api: 'No API key' } };
  }
  const passageText = document.getElementById('transcript').value.trim();
  const base64 = await blobToBase64(blob);
  const latestConfig = buildSTTConfig(encoding, sampleRateHertz);
  const defaultConfig = getDefaultModelConfig(encoding, passageText, sampleRateHertz);
  const [latestResult, defaultResult] = await Promise.allSettled([
    fetchSTTRaw(base64, latestConfig, apiKey),
    fetchSTTRaw(base64, defaultConfig, apiKey)
  ]);
  return {
    latestLong: latestResult.status === 'fulfilled' ? latestResult.value : null,
    default: defaultResult.status === 'fulfilled' ? defaultResult.value : null,
    errors: {
      latestLong: latestResult.status === 'rejected' ? latestResult.reason?.message : null,
      default: defaultResult.status === 'rejected' ? defaultResult.reason?.message : null
    }
  };
}
*/
