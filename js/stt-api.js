import { setStatus } from './ui.js';

/**
 * Build tiered speech contexts for phrase boosting.
 * @param {string} passageText - The reference passage
 * @param {object} options - { properNounBoost, uncommonBoost } explicit boost values
 * @returns {Array} speechContexts array for STT config
 */
function buildSpeechContexts(passageText, options = {}) {
  // Explicit boost values per model (no formula derivation)
  // latest_long: { properNounBoost: 5, uncommonBoost: 3 }
  // default:     { properNounBoost: 3, uncommonBoost: 2 }
  const { properNounBoost = 5, uncommonBoost = 3 } = options;
  if (!passageText) return [];

  const originalWords = passageText.split(/\s+/);
  const normalized = passageText.toLowerCase().replace(/[^a-z'\s-]/g, '').split(/\s+/).filter(Boolean);

  const properNouns = [];
  const uncommonWords = [];
  // Common words get NO boost - ASR already knows them

  for (let i = 0; i < originalWords.length; i++) {
    const orig = originalWords[i];
    const norm = normalized[i];
    if (!norm) continue;

    // Proper nouns: capitalized and not at sentence start
    // Check if previous word ended with sentence-ending punctuation
    const prevWord = i > 0 ? originalWords[i - 1] : '';
    const afterSentenceEnd = /[.!?]$/.test(prevWord);

    if (/^[A-Z]/.test(orig) && i > 0 && !afterSentenceEnd) {
      properNouns.push(norm);
    } else if (norm.length >= 8) {
      // Long words are likely domain-specific
      uncommonWords.push(norm);
    }
    // Common words: skip boosting entirely
  }

  const contexts = [];

  // Proper nouns: highest boost
  if (properNouns.length > 0) {
    contexts.push({ phrases: [...new Set(properNouns)], boost: properNounBoost });
  }

  // Uncommon words: medium boost
  if (uncommonWords.length > 0) {
    contexts.push({ phrases: [...new Set(uncommonWords)], boost: uncommonBoost });
  }

  // Common words: no boost (omitted entirely)

  return contexts;
}

function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(blob);
  });
}

/**
 * Build STT config object shared by sync and async paths.
 */
function buildSTTConfig(encoding) {
  const passageText = document.getElementById('transcript').value.trim();
  const speechContexts = [];
  if (passageText) {
    const words = [...new Set(passageText.toLowerCase().replace(/[^a-z'\s-]/g, '').split(/\s+/).filter(Boolean))];
    if (words.length > 0) {
      speechContexts.push({ phrases: words, boost: 5 });
    }
  }

  return {
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
  };
}

export async function sendToSTT(blob, encoding) {
  const apiKey = document.getElementById('apiKey').value.trim();
  if (!apiKey) { setStatus('Please enter your API key.'); return null; }

  setStatus('Sending to Google Cloud STT...');
  const base64 = await blobToBase64(blob);

  const body = {
    config: buildSTTConfig(encoding),
    audio: { content: base64 }
  };

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

/**
 * Poll a long-running operation until done.
 * @param {string} operationName
 * @param {string} apiKey
 * @param {function} onProgress  Called with progress percent (0-100)
 * @returns {object} The operation response
 */
async function pollOperation(operationName, apiKey, onProgress) {
  const POLL_INTERVAL = 3000;
  const MAX_POLLS = 100; // 5 min timeout

  for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL));

    const resp = await fetch(
      `https://speech.googleapis.com/v1/operations/${operationName}?key=${encodeURIComponent(apiKey)}`
    );
    const op = await resp.json();

    if (onProgress) {
      onProgress(op.metadata?.progressPercent || 0);
    }

    if (op.done) {
      if (op.error) {
        throw new Error(op.error.message || 'Async STT operation failed');
      }
      return op.response;
    }
  }

  throw new Error('Async STT timed out after 5 minutes');
}

/**
 * Send audio to the async longrunningrecognize endpoint.
 * @param {Blob} blob
 * @param {string} encoding
 * @param {function} onProgress
 * @returns {object} STT response (same shape as sync)
 */
export async function sendToAsyncSTT(blob, encoding, onProgress) {
  const apiKey = document.getElementById('apiKey').value.trim();
  if (!apiKey) { setStatus('Please enter your API key.'); return null; }

  const base64 = await blobToBase64(blob);

  const body = {
    config: buildSTTConfig(encoding),
    audio: { content: base64 }
  };

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

  // data should contain { name: "operationId" }
  if (!data.name) {
    throw new Error('No operation name returned from longrunningrecognize');
  }

  return await pollOperation(data.name, apiKey, onProgress);
}

/**
 * Chunked sync fallback — splits blob into ~200KB chunks and sends each
 * to the sync endpoint. Best-effort fallback when longrunningrecognize
 * rejects inline audio.
 * @param {Blob} blob
 * @param {string} encoding
 * @returns {object} Merged STT response
 */
export async function sendChunkedSTT(blob, encoding) {
  const apiKey = document.getElementById('apiKey').value.trim();
  if (!apiKey) { setStatus('Please enter your API key.'); return null; }

  const CHUNK_SIZE = 200 * 1024; // ~200KB per chunk (~50s of WebM/Opus)
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

    if (data.error) {
      console.warn(`Chunk ${i + 1} error:`, data.error.message);
      continue;
    }

    if (data.results) {
      mergedResults.push(...data.results);
    }
  }

  return { results: mergedResults };
}
