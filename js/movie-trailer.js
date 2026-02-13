/**
 * Movie Trailer Generator
 *
 * Generates an epic movie-trailer-style voiceover of the student's reading passage
 * using ElevenLabs TTS + synthesized dramatic background music via Web Audio API.
 */

// ── ElevenLabs Config ──
const VOICE_ID = 'pNInz6obpgDQGcFmaJgB'; // "Adam" — deep, cinematic narrator
const ELEVENLABS_MODEL = 'eleven_multilingual_v2';

// ── Trailer Script Templates ──
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
        stability: 0.30,       // lower = more dramatic variation
        similarity_boost: 0.85,
        style: 0.7,            // high style for dramatic delivery
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
 * Generate dramatic background music using Web Audio API.
 * Returns an AudioBuffer with a cinematic drone + percussion hits.
 */
function generateTrailerMusic(audioCtx, durationSec) {
  const sampleRate = audioCtx.sampleRate;
  const length = Math.ceil(durationSec * sampleRate);
  const buffer = audioCtx.createBuffer(2, length, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  // Parameters
  const bassFreq = 55;       // A1 — deep sub bass
  const droneFreq = 110;     // A2 — octave above
  const padFreq = 165;       // E3 — fifth
  const buildStart = 0.6;    // fraction of duration where intensity builds
  const climaxStart = 0.85;  // fraction where we hit peak

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const progress = i / length;

    // Envelope — starts quiet, builds, peaks, fades
    let envelope;
    if (progress < 0.05) {
      envelope = progress / 0.05; // fade in
    } else if (progress < buildStart) {
      envelope = 0.3 + 0.1 * Math.sin(progress * Math.PI * 0.5); // gentle swell
    } else if (progress < climaxStart) {
      const buildProgress = (progress - buildStart) / (climaxStart - buildStart);
      envelope = 0.4 + 0.5 * buildProgress; // rising intensity
    } else if (progress < 0.95) {
      envelope = 0.9; // peak
    } else {
      envelope = 0.9 * (1 - (progress - 0.95) / 0.05); // fade out
    }

    // Sub bass drone (sine + slight distortion)
    const bass = Math.sin(2 * Math.PI * bassFreq * t) * 0.25;

    // Octave drone with slow vibrato
    const vibrato = 1 + 0.003 * Math.sin(2 * Math.PI * 0.3 * t);
    const drone = Math.sin(2 * Math.PI * droneFreq * vibrato * t) * 0.15;

    // Pad — fifth interval, gentle
    const pad = Math.sin(2 * Math.PI * padFreq * t) * 0.08 *
      (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.1 * t)); // tremolo

    // Filtered noise for texture (breathiness)
    const noise = (Math.random() * 2 - 1) * 0.02 * envelope;

    // Percussion hits — "boom" at key moments
    let boom = 0;
    const hitTimes = [0.0, 0.25, 0.5, 0.65, 0.75, 0.85, 0.9, 0.95];
    for (const hitFrac of hitTimes) {
      const hitT = hitFrac * durationSec;
      const dt = t - hitT;
      if (dt > 0 && dt < 0.8) {
        // Exponential decay sine burst (deep impact)
        boom += Math.sin(2 * Math.PI * 40 * dt) * Math.exp(-dt * 5) * 0.4;
        // Higher click transient
        if (dt < 0.05) {
          boom += Math.sin(2 * Math.PI * 200 * dt) * Math.exp(-dt * 60) * 0.2;
        }
      }
    }

    // String-like riser in build section
    let riser = 0;
    if (progress > buildStart) {
      const riserProgress = (progress - buildStart) / (1 - buildStart);
      const riserFreq = 200 + 600 * riserProgress; // sweep up
      riser = Math.sin(2 * Math.PI * riserFreq * t) * 0.06 * riserProgress;
    }

    const sample = (bass + drone + pad + noise + boom + riser) * envelope;

    // Slight stereo spread
    left[i] = sample + noise * 0.5;
    right[i] = sample - noise * 0.5;
  }

  return buffer;
}

/**
 * Mix voiceover (ArrayBuffer mp3) with generated music.
 * Returns a Blob (wav) ready for playback/download.
 */
async function mixTrailer(voiceoverArrayBuffer) {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  // Decode voiceover
  const voiceBuffer = await audioCtx.decodeAudioData(voiceoverArrayBuffer.slice(0));

  // Generate music slightly longer than voice (1s padding each side)
  const musicDuration = voiceBuffer.duration + 2;
  const musicBuffer = generateTrailerMusic(audioCtx, musicDuration);

  // Offline context for mixing
  const sampleRate = audioCtx.sampleRate;
  const totalLength = Math.ceil(musicDuration * sampleRate);
  const offline = new OfflineAudioContext(2, totalLength, sampleRate);

  // Music track — full duration, moderate volume
  const musicSource = offline.createBufferSource();
  musicSource.buffer = musicBuffer;
  const musicGain = offline.createGain();
  musicGain.gain.value = 0.35; // music sits behind voice
  musicSource.connect(musicGain);
  musicGain.connect(offline.destination);
  musicSource.start(0);

  // Voice track — starts 1s in, with reverb-like effect
  const voiceSource = offline.createBufferSource();
  voiceSource.buffer = voiceBuffer;
  const voiceGain = offline.createGain();
  voiceGain.gain.value = 1.0;

  // Bass boost on voice for that deep trailer feel
  const bassBoost = offline.createBiquadFilter();
  bassBoost.type = 'lowshelf';
  bassBoost.frequency.value = 200;
  bassBoost.gain.value = 6; // +6dB bass

  // Slight compression feel via high-shelf cut
  const presenceCut = offline.createBiquadFilter();
  presenceCut.type = 'peaking';
  presenceCut.frequency.value = 3000;
  presenceCut.gain.value = 3; // presence boost

  voiceSource.connect(bassBoost);
  bassBoost.connect(presenceCut);
  presenceCut.connect(voiceGain);
  voiceGain.connect(offline.destination);
  voiceSource.start(1.0); // 1s after music starts

  // Duck music during voice
  const voiceStart = 1.0;
  const voiceEnd = voiceStart + voiceBuffer.duration;
  musicGain.gain.setValueAtTime(0.35, 0);
  musicGain.gain.linearRampToValueAtTime(0.12, voiceStart + 0.5); // duck when voice starts
  musicGain.gain.setValueAtTime(0.12, voiceEnd - 0.5);
  musicGain.gain.linearRampToValueAtTime(0.5, voiceEnd + 0.5); // swell after voice ends

  // Render
  const renderedBuffer = await offline.startRendering();
  audioCtx.close();

  // Convert to WAV blob
  return audioBufferToWavBlob(renderedBuffer);
}

/**
 * Encode an AudioBuffer as a WAV Blob.
 */
function audioBufferToWavBlob(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const numSamples = buffer.length;
  const dataSize = numSamples * blockAlign;
  const headerSize = 44;
  const arrayBuffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(arrayBuffer);

  // WAV header
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

  // Interleave channels
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

/**
 * Show the trailer player modal/section.
 */
function showTrailerPlayer(trailerBlob, studentName) {
  // Remove existing player
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

  // Insert after the alignment results section
  const resultsSection = document.getElementById('newAnalyzedWords');
  if (resultsSection && resultsSection.parentNode) {
    resultsSection.parentNode.insertBefore(section, resultsSection);
  } else {
    document.querySelector('.section')?.appendChild(section);
  }

  // Auto-play
  audio.play().catch(() => {}); // may be blocked by autoplay policy
}

/**
 * Main entry point — called from the Movie Trailer button.
 */
export async function generateMovieTrailer(referenceText, studentName) {
  const apiKey = localStorage.getItem('orf_elevenlabs_key') || '';
  if (!apiKey) {
    alert('Please enter your ElevenLabs API key in the settings above.');
    document.getElementById('elevenLabsKey')?.focus();
    return;
  }

  if (!referenceText || referenceText.trim().length < 20) {
    alert('Need a reference passage to generate a trailer.');
    return;
  }

  // Show progress
  const btn = document.getElementById('movieTrailerBtn');
  const originalText = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Generating...';
  }

  try {
    // 1. Build dramatic script
    const script = buildTrailerScript(referenceText, studentName);
    if (btn) btn.textContent = 'Calling ElevenLabs...';

    // 2. Get voiceover from ElevenLabs
    const voiceoverData = await callElevenLabs(script, apiKey);
    if (btn) btn.textContent = 'Mixing trailer...';

    // 3. Mix with background music
    const trailerBlob = await mixTrailer(voiceoverData);

    // 4. Show player
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
