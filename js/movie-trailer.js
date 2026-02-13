/**
 * Movie Trailer Generator
 *
 * Generates an epic movie-trailer-style voiceover of the student's reading passage
 * using either ElevenLabs TTS (cloud) or Kokoro.js (local, free, unlimited)
 * layered over synthesized dramatic background music via Web Audio API.
 */

// ── ElevenLabs Config ──
const VOICE_ID = 'pNInz6obpgDQGcFmaJgB'; // "Adam" — deep, cinematic narrator
const ELEVENLABS_MODEL = 'eleven_multilingual_v2';

// ── Kokoro Config ──
const KOKORO_CDN = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.1.0/+esm';
const KOKORO_MODEL = 'onnx-community/Kokoro-82M-ONNX';
const KOKORO_VOICE = 'am_adam'; // American male — deepest available
const KOKORO_DTYPE = 'q8';     // good quality/size balance (~80MB)

let kokoroInstance = null; // cached after first load

/**
 * Build a trailer script from the reference passage.
 * Speaks EVERY word from the passage with minimal dramatic framing.
 */
function buildTrailerScript(referenceText, studentName) {
  const name = studentName || 'a young reader';
  return `This is the story of ${name}.\n\n${referenceText.trim()}`;
}

/**
 * Call ElevenLabs TTS API → returns audio ArrayBuffer (mp3).
 */
async function callElevenLabs(text, apiKey) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: ELEVENLABS_MODEL,
      voice_settings: {
        stability: 0.30,
        similarity_boost: 0.85,
        style: 0.7,
        use_speaker_boost: true,
      },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`ElevenLabs API error (${resp.status}): ${errText}`);
  }

  return await resp.arrayBuffer();
}

/**
 * Load Kokoro TTS (downloads ~80MB model on first use, cached after).
 * Returns the KokoroTTS instance.
 */
async function getKokoroInstance(onProgress) {
  if (kokoroInstance) return kokoroInstance;

  if (onProgress) onProgress('Loading Kokoro model (~80MB first time)...');
  const { KokoroTTS } = await import(KOKORO_CDN);
  kokoroInstance = await KokoroTTS.from_pretrained(KOKORO_MODEL, { dtype: KOKORO_DTYPE });
  return kokoroInstance;
}

/**
 * Split text into chunks that fit Kokoro's ~512 token limit.
 * Splits on sentence boundaries, each chunk ≤ maxChars.
 */
function splitTextForKokoro(text, maxChars = 400) {
  const sentences = text.replace(/([.!?])\s+/g, '$1|').split('|').filter(s => s.trim());
  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && (current.length + sentence.length + 1) > maxChars) {
      chunks.push(current.trim());
      current = '';
    }
    current += (current ? ' ' : '') + sentence;
  }
  if (current.trim()) chunks.push(current.trim());
  // Safety: if a single sentence exceeds maxChars, it's still one chunk (Kokoro will handle it)
  return chunks.length ? chunks : [text];
}

/**
 * Generate voiceover using Kokoro.js (local, free, unlimited).
 * Splits long text into chunks, generates each, concatenates audio.
 * Returns audio ArrayBuffer (wav).
 */
async function callKokoro(text, onProgress) {
  const tts = await getKokoroInstance(onProgress);
  const chunks = splitTextForKokoro(text);
  const allSamples = [];
  let sampleRate = 24000;

  for (let i = 0; i < chunks.length; i++) {
    if (onProgress) onProgress(`Generating voice (${i + 1}/${chunks.length})...`);
    const raw = await tts.generate(chunks[i], { voice: KOKORO_VOICE });
    sampleRate = raw.sampling_rate || 24000;
    allSamples.push(raw.audio);
    // Small silence gap between chunks (0.3s)
    if (i < chunks.length - 1) {
      allSamples.push(new Float32Array(Math.floor(sampleRate * 0.3)));
    }
  }

  // Concatenate all chunks
  const totalLength = allSamples.reduce((sum, a) => sum + a.length, 0);
  const combined = new Float32Array(totalLength);
  let offset = 0;
  for (const arr of allSamples) {
    combined.set(arr, offset);
    offset += arr.length;
  }

  return float32ToWavArrayBuffer(combined, sampleRate);
}

/**
 * Encode a mono Float32Array as a WAV ArrayBuffer.
 */
function float32ToWavArrayBuffer(samples, sampleRate) {
  const numSamples = samples.length;
  const bytesPerSample = 2;
  const dataSize = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);       // PCM
  view.setUint16(22, 1, true);       // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);      // 16-bit
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }

  return buffer;
}

/**
 * Generate dramatic background music using Web Audio API.
 * Returns an AudioBuffer with a cinematic drone + percussion hits.
 */
function generateTrailerMusic(audioCtx, durationSec) {
  const sampleRate = audioCtx.sampleRate;
  const length = Math.ceil(durationSec * sampleRate);
  const buffer = audioCtx.createBuffer(2, length, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  const bassFreq = 55;
  const droneFreq = 110;
  const padFreq = 165;
  const buildStart = 0.6;
  const climaxStart = 0.85;

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const progress = i / length;

    let envelope;
    if (progress < 0.05) {
      envelope = progress / 0.05;
    } else if (progress < buildStart) {
      envelope = 0.3 + 0.1 * Math.sin(progress * Math.PI * 0.5);
    } else if (progress < climaxStart) {
      const buildProgress = (progress - buildStart) / (climaxStart - buildStart);
      envelope = 0.4 + 0.5 * buildProgress;
    } else if (progress < 0.95) {
      envelope = 0.9;
    } else {
      envelope = 0.9 * (1 - (progress - 0.95) / 0.05);
    }

    const bass = Math.sin(2 * Math.PI * bassFreq * t) * 0.25;
    const vibrato = 1 + 0.003 * Math.sin(2 * Math.PI * 0.3 * t);
    const drone = Math.sin(2 * Math.PI * droneFreq * vibrato * t) * 0.15;
    const pad = Math.sin(2 * Math.PI * padFreq * t) * 0.08 *
      (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.1 * t));
    const noise = (Math.random() * 2 - 1) * 0.02 * envelope;

    let boom = 0;
    const hitTimes = [0.0, 0.25, 0.5, 0.65, 0.75, 0.85, 0.9, 0.95];
    for (const hitFrac of hitTimes) {
      const hitT = hitFrac * durationSec;
      const dt = t - hitT;
      if (dt > 0 && dt < 0.8) {
        boom += Math.sin(2 * Math.PI * 40 * dt) * Math.exp(-dt * 5) * 0.4;
        if (dt < 0.05) {
          boom += Math.sin(2 * Math.PI * 200 * dt) * Math.exp(-dt * 60) * 0.2;
        }
      }
    }

    let riser = 0;
    if (progress > buildStart) {
      const riserProgress = (progress - buildStart) / (1 - buildStart);
      const riserFreq = 200 + 600 * riserProgress;
      riser = Math.sin(2 * Math.PI * riserFreq * t) * 0.06 * riserProgress;
    }

    const sample = (bass + drone + pad + noise + boom + riser) * envelope;
    left[i] = sample + noise * 0.5;
    right[i] = sample - noise * 0.5;
  }

  return buffer;
}

/**
 * Mix voiceover (ArrayBuffer) with generated music.
 * Returns a Blob (wav) ready for playback/download.
 */
async function mixTrailer(voiceoverArrayBuffer) {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  const voiceBuffer = await audioCtx.decodeAudioData(voiceoverArrayBuffer.slice(0));
  const musicDuration = voiceBuffer.duration + 2;
  const musicBuffer = generateTrailerMusic(audioCtx, musicDuration);

  const sampleRate = audioCtx.sampleRate;
  const totalLength = Math.ceil(musicDuration * sampleRate);
  const offline = new OfflineAudioContext(2, totalLength, sampleRate);

  const musicSource = offline.createBufferSource();
  musicSource.buffer = musicBuffer;
  const musicGain = offline.createGain();
  musicGain.gain.value = 0.35;
  musicSource.connect(musicGain);
  musicGain.connect(offline.destination);
  musicSource.start(0);

  const voiceSource = offline.createBufferSource();
  voiceSource.buffer = voiceBuffer;
  const voiceGain = offline.createGain();
  voiceGain.gain.value = 1.0;

  const bassBoost = offline.createBiquadFilter();
  bassBoost.type = 'lowshelf';
  bassBoost.frequency.value = 200;
  bassBoost.gain.value = 6;

  const presenceCut = offline.createBiquadFilter();
  presenceCut.type = 'peaking';
  presenceCut.frequency.value = 3000;
  presenceCut.gain.value = 3;

  voiceSource.connect(bassBoost);
  bassBoost.connect(presenceCut);
  presenceCut.connect(voiceGain);
  voiceGain.connect(offline.destination);
  voiceSource.start(1.0);

  const voiceStart = 1.0;
  const voiceEnd = voiceStart + voiceBuffer.duration;
  musicGain.gain.setValueAtTime(0.35, 0);
  musicGain.gain.linearRampToValueAtTime(0.12, voiceStart + 0.5);
  musicGain.gain.setValueAtTime(0.12, voiceEnd - 0.5);
  musicGain.gain.linearRampToValueAtTime(0.5, voiceEnd + 0.5);

  const renderedBuffer = await offline.startRendering();
  audioCtx.close();

  return audioBufferToWavBlob(renderedBuffer);
}

/**
 * Encode an AudioBuffer as a WAV Blob.
 */
function audioBufferToWavBlob(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const numSamples = buffer.length;
  const dataSize = numSamples * blockAlign;
  const headerSize = 44;
  const arrayBuffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(arrayBuffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels = [];
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

// ── UI ──

function showTrailerPlayer(trailerBlob, studentName) {
  const existing = document.getElementById('trailerPlayerSection');
  if (existing) existing.remove();

  const section = document.createElement('div');
  section.id = 'trailerPlayerSection';
  section.style.cssText = `
    margin: 1rem 0; padding: 1.2rem; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
    border: 1px solid #e94560; border-radius: 12px; text-align: center;
  `;

  const title = document.createElement('div');
  title.style.cssText = 'font-size:1.3rem;font-weight:700;color:#e94560;margin-bottom:0.3rem;letter-spacing:2px;text-transform:uppercase;';
  title.textContent = 'Movie Trailer';

  const subtitle = document.createElement('div');
  subtitle.style.cssText = 'font-size:0.9rem;color:#a8a8b8;margin-bottom:1rem;font-style:italic;';
  subtitle.textContent = studentName ? `Starring ${studentName}` : 'An Epic Reading Experience';

  const audioUrl = URL.createObjectURL(trailerBlob);

  const audio = document.createElement('audio');
  audio.controls = true;
  audio.src = audioUrl;
  audio.style.cssText = 'width:100%;margin-bottom:0.8rem;';

  const downloadBtn = document.createElement('a');
  downloadBtn.href = audioUrl;
  downloadBtn.download = `movie-trailer${studentName ? '-' + studentName.replace(/\s+/g, '-') : ''}.wav`;
  downloadBtn.textContent = 'Download Trailer';
  downloadBtn.style.cssText = `
    display:inline-block;padding:0.5rem 1.2rem;background:#e94560;color:#fff;
    border-radius:6px;text-decoration:none;font-weight:600;font-size:0.9rem;cursor:pointer;
  `;

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.style.cssText = 'margin-left:0.8rem;padding:0.5rem 1rem;background:transparent;color:#a8a8b8;border:1px solid #a8a8b8;border-radius:6px;cursor:pointer;font-size:0.9rem;';
  closeBtn.addEventListener('click', () => {
    audio.pause();
    URL.revokeObjectURL(audioUrl);
    section.remove();
  });

  section.appendChild(title);
  section.appendChild(subtitle);
  section.appendChild(audio);
  section.appendChild(downloadBtn);
  section.appendChild(closeBtn);

  const resultsSection = document.getElementById('newAnalyzedWords');
  if (resultsSection && resultsSection.parentNode) {
    resultsSection.parentNode.insertBefore(section, resultsSection);
  } else {
    document.querySelector('.section')?.appendChild(section);
  }

  audio.play().catch(() => {});
}

/**
 * Get selected voice engine from the trailer dropdown.
 */
function getSelectedEngine() {
  const sel = document.getElementById('trailerVoiceEngine');
  return sel?.value || 'kokoro';
}

/**
 * Main entry point — called from the Movie Trailer button.
 */
export async function generateMovieTrailer(referenceText, studentName) {
  const engine = getSelectedEngine();

  if (engine === 'elevenlabs') {
    const apiKey = localStorage.getItem('orf_elevenlabs_key') || '';
    if (!apiKey) {
      alert('Please enter your ElevenLabs API key in the settings above.');
      document.getElementById('elevenLabsKey')?.focus();
      return;
    }
  }

  if (!referenceText || referenceText.trim().length < 20) {
    alert('Need a reference passage to generate a trailer.');
    return;
  }

  const btn = document.getElementById('movieTrailerBtn');
  const originalText = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Generating...';
  }

  try {
    const script = buildTrailerScript(referenceText, studentName);
    let voiceoverData;

    if (engine === 'elevenlabs') {
      if (btn) btn.textContent = 'Calling ElevenLabs...';
      const apiKey = localStorage.getItem('orf_elevenlabs_key');
      voiceoverData = await callElevenLabs(script, apiKey);
    } else {
      voiceoverData = await callKokoro(script, (msg) => {
        if (btn) btn.textContent = msg;
      });
    }

    if (btn) btn.textContent = 'Mixing trailer...';
    const trailerBlob = await mixTrailer(voiceoverData);
    showTrailerPlayer(trailerBlob, studentName);
  } catch (err) {
    console.error('[MovieTrailer] Error:', err);
    alert('Trailer generation failed: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
}
