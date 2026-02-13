/**
 * Movie Trailer Generator
 *
 * Generates an epic movie-trailer-style voiceover of the student's reading passage
 * using Gemini 2.5 Flash TTS (free tier: 1,500 requests/day) layered over
 * synthesized dramatic background music via Web Audio API.
 */

const GEMINI_TTS_MODEL = 'gemini-2.5-flash-preview-tts';
const GEMINI_TTS_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent`;
const GEMINI_VOICE = 'Charon'; // "Informative" — deep and authoritative

/**
 * Build a dramatic trailer prompt + passage for Gemini TTS.
 * Gemini supports natural language style instructions inline with the text.
 */
function buildTrailerPrompt(referenceText, studentName) {
  const name = studentName || 'a young reader';
  return (
    `Say the following in a dramatic, deep narrator voice with slow pacing:\n\n` +
    `This is the story of ${name}.\n\n${referenceText.trim()}`
  );
}

/**
 * Call Gemini 2.5 Flash TTS → returns audio ArrayBuffer (wav).
 */
async function callGeminiTTS(text, apiKey, maxRetries = 3) {
  const body = JSON.stringify({
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: GEMINI_VOICE }
        }
      }
    }
  });

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const resp = await fetch(GEMINI_TTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body,
    });

    if (resp.ok) {
      const data = await resp.json();
      console.log('[MovieTrailer] Gemini response keys:', Object.keys(data),
        'finishReason:', data.candidates?.[0]?.finishReason,
        'parts:', data.candidates?.[0]?.content?.parts?.length);
      return parseGeminiAudio(data);
    }

    // Retry on transient errors (preview model has known 500 instability)
    if ((resp.status === 429 || resp.status === 500 || resp.status === 503) && attempt < maxRetries) {
      const errBody = await resp.text().catch(() => '');
      // Parse Google's suggested retry delay if present
      let waitSec = 3 * attempt; // default backoff
      const retryMatch = errBody.match(/retry\s*in\s*([\d.]+)s/i);
      if (retryMatch) waitSec = Math.ceil(parseFloat(retryMatch[1])) + 1;
      console.warn(`[MovieTrailer] Gemini ${resp.status} (attempt ${attempt}/${maxRetries}), waiting ${waitSec}s: ${errBody.slice(0, 200)}`);
      await new Promise(r => setTimeout(r, waitSec * 1000));
      continue;
    }

    const errText = await resp.text();
    throw new Error(`Gemini TTS error (${resp.status}): ${errText}`);
  }

}

/**
 * Parse Gemini TTS JSON response → WAV ArrayBuffer.
 */
function parseGeminiAudio(data) {
  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked: ${data.promptFeedback.blockReason}`);
  }

  const candidate = data.candidates?.[0];
  if (!candidate) {
    throw new Error('No candidates in Gemini response: ' + JSON.stringify(data).slice(0, 300));
  }

  const parts = candidate.content?.parts;
  console.log('[MovieTrailer] Response parts:', JSON.stringify(parts?.map(p => ({
    hasInlineData: !!p.inlineData,
    mimeType: p.inlineData?.mimeType,
    textPreview: p.text?.slice(0, 100),
    keys: Object.keys(p),
  }))));
  const audioPart = parts?.find(p => p.inlineData);
  if (!audioPart) {
    throw new Error('No audio in response (finishReason: ' + candidate.finishReason + '). Parts: ' + JSON.stringify(parts).slice(0, 300));
  }

  const { data: b64Audio } = audioPart.inlineData;
  const binary = atob(b64Audio);
  const pcmBytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) pcmBytes[i] = binary.charCodeAt(i);

  // Wrap raw L16 PCM (24kHz) in WAV header
  const sampleRate = 24000;
  const dataSize = pcmBytes.length;
  const wavBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wavBuffer);
  const w = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  w(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  w(36, 'data');
  view.setUint32(40, dataSize, true);
  new Uint8Array(wavBuffer, 44).set(pcmBytes);

  return wavBuffer;
}

// ── Background Music ──

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

// ── Mixer ──

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

function audioBufferToWavBlob(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const numSamples = buffer.length;
  const dataSize = numSamples * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const w = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  w(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  w(36, 'data');
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
 * Main entry point — called from the Movie Trailer button.
 */
export async function generateMovieTrailer(referenceText, studentName) {
  const apiKey = localStorage.getItem('orf_gemini_key') || '';
  if (!apiKey) {
    alert('Please enter your Gemini API key in the settings above (free from aistudio.google.com).');
    document.getElementById('geminiKey')?.focus();
    return;
  }

  if (!referenceText || referenceText.trim().length < 20) {
    alert('Need a reference passage to generate a trailer.');
    return;
  }

  const btn = document.getElementById('movieTrailerBtn');
  const originalText = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Generating voiceover (~20s)...';
  }

  try {
    const prompt = buildTrailerPrompt(referenceText, studentName);
    console.log('[MovieTrailer] Sending to Gemini:', prompt.slice(0, 200) + '...');
    // Animated countdown on button while waiting
    let elapsed = 0;
    const timer = setInterval(() => {
      elapsed++;
      if (btn) btn.textContent = `Generating voiceover (${elapsed}s)...`;
    }, 1000);

    let voiceoverData;
    try {
      voiceoverData = await callGeminiTTS(prompt, apiKey);
    } finally {
      clearInterval(timer);
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
