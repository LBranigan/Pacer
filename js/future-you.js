/**
 * Future You — Audio stitching + karaoke playback.
 * Stitches correctly-read segments into a seamless clip,
 * plays back over word-by-word highlighting.
 * @module future-you
 */

import { getAssessment } from './storage.js';
import { getAudioBlob } from './audio-store.js';

const GAP_DURATION = 0.3;   // seconds of silence for omitted words
const CROSSFADE_MS = 30;    // crossfade between segments
const MIN_SEGMENT_MS = 50;  // ignore segments shorter than this

/** Parse STT timestamp to seconds. Handles string "1.200s", number, protobuf Duration. */
function parseTime(t) {
  if (typeof t === 'number') return t;
  if (!t) return 0;
  if (typeof t === 'object' && t.seconds !== undefined) {
    return Number(t.seconds || 0) + (Number(t.nanos || 0) / 1e9);
  }
  return parseFloat(String(t).replace('s', '')) || 0;
}

/** Encode AudioBuffer to WAV blob (copied from audio-padding.js). */
function encodeWAV(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bitDepth = 16;

  let interleaved;
  if (numChannels === 2) {
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    interleaved = new Float32Array(left.length + right.length);
    for (let i = 0, j = 0; i < left.length; i++, j += 2) {
      interleaved[j] = left[i];
      interleaved[j + 1] = right[i];
    }
  } else {
    interleaved = buffer.getChannelData(0);
  }

  const dataLength = interleaved.length * (bitDepth / 8);
  const wavBuffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(wavBuffer);

  function writeStr(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
  view.setUint16(32, numChannels * (bitDepth / 8), true);
  view.setUint16(34, bitDepth, true);
  writeStr(36, 'data');
  view.setUint32(40, dataLength, true);

  const offset = 44;
  for (let i = 0; i < interleaved.length; i++) {
    const sample = Math.max(-1, Math.min(1, interleaved[i]));
    view.setInt16(offset + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
  }

  return new Blob([wavBuffer], { type: 'audio/wav' });
}

/**
 * Determine if an alignment entry should be included as spoken audio.
 * Returns true for correct words, forgiven proper nouns, and compound struggles.
 */
function isSpokenCorrect(entry) {
  const t = entry.type;
  if (t === 'correct') return true;
  if (entry.forgiven) return true;
  // Compound struggles where the child got the word right (split into parts)
  if (t === 'struggle' && entry.compound) return true;
  return false;
}

/**
 * Get timestamps for an alignment entry.
 * Prefers xval (Parakeet) timestamps, falls back to sttWords via hypIndex.
 */
function getTimestamps(entry, sttWords) {
  // Prefer cross-validation timestamps (Parakeet — more accurate)
  if (entry._xvalStartTime != null && entry._xvalEndTime != null) {
    const s = parseTime(entry._xvalStartTime);
    const e = parseTime(entry._xvalEndTime);
    if (e > s) return { start: s, end: e };
  }
  // Fall back to sttWords via hypIndex
  if (entry.hypIndex != null && entry.hypIndex >= 0 && sttWords[entry.hypIndex]) {
    const w = sttWords[entry.hypIndex];
    const s = parseTime(w.startTime);
    const e = parseTime(w.endTime);
    if (e > s) return { start: s, end: e };
  }
  return null;
}

/**
 * Build the stitched audio buffer from alignment + source audio.
 * Returns { buffer: AudioBuffer, segmentMap: [{refIndex, startInStitched, duration, isGap}] }
 */
async function buildStitchedAudio(alignment, sttWords, audioBlob) {
  const audioCtx = new AudioContext();
  const arrayBuf = await audioBlob.arrayBuffer();
  const srcBuffer = await audioCtx.decodeAudioData(arrayBuf);
  const sampleRate = srcBuffer.sampleRate;
  const srcData = srcBuffer.getChannelData(0); // mono

  const crossfadeSamples = Math.floor((CROSSFADE_MS / 1000) * sampleRate);
  const gapSamples = Math.floor(GAP_DURATION * sampleRate);

  // Build segment list
  const segments = []; // { refIndex, samples: Float32Array | null, isGap, duration }

  for (let i = 0; i < alignment.length; i++) {
    const entry = alignment[i];
    if (entry.type === 'insertion') continue; // skip insertions

    if (isSpokenCorrect(entry)) {
      const ts = getTimestamps(entry, sttWords);
      if (ts && (ts.end - ts.start) * 1000 >= MIN_SEGMENT_MS) {
        const startSample = Math.max(0, Math.floor(ts.start * sampleRate));
        const endSample = Math.min(srcData.length, Math.ceil(ts.end * sampleRate));
        const len = endSample - startSample;
        if (len > 0) {
          const samples = new Float32Array(len);
          samples.set(srcData.subarray(startSample, endSample));
          segments.push({ refIndex: i, samples, isGap: false, duration: len / sampleRate });
          continue;
        }
      }
      // Has spoken word but no usable timestamp — treat as gap
      segments.push({ refIndex: i, samples: null, isGap: true, duration: GAP_DURATION });
    } else {
      // Omission, substitution (not forgiven), etc. — silence gap
      segments.push({ refIndex: i, samples: null, isGap: true, duration: GAP_DURATION });
    }
  }

  // Calculate total output length
  let totalSamples = 0;
  for (const seg of segments) {
    if (seg.samples) {
      totalSamples += seg.samples.length;
    } else {
      totalSamples += gapSamples;
    }
  }

  // Create output buffer
  const outBuffer = audioCtx.createBuffer(1, totalSamples, sampleRate);
  const outData = outBuffer.getChannelData(0);
  const segmentMap = [];
  let writePos = 0;

  for (const seg of segments) {
    const startInStitched = writePos / sampleRate;

    if (seg.samples) {
      // Apply crossfade-in at start
      for (let j = 0; j < Math.min(crossfadeSamples, seg.samples.length); j++) {
        seg.samples[j] *= j / crossfadeSamples;
      }
      // Apply crossfade-out at end
      for (let j = 0; j < Math.min(crossfadeSamples, seg.samples.length); j++) {
        const idx = seg.samples.length - 1 - j;
        seg.samples[idx] *= j / crossfadeSamples;
      }

      outData.set(seg.samples, writePos);
      writePos += seg.samples.length;
    } else {
      // Silence gap (already zeros)
      writePos += gapSamples;
    }

    segmentMap.push({
      refIndex: seg.refIndex,
      startInStitched,
      duration: seg.isGap ? GAP_DURATION : seg.samples.length / sampleRate,
      isGap: seg.isGap
    });
  }

  await audioCtx.close();
  return { buffer: outBuffer, segmentMap };
}

/**
 * Initialize the Future You page.
 */
async function init() {
  const wordArea = document.getElementById('word-area');
  const playBtn = document.getElementById('playBtn');
  const statsEl = document.getElementById('stats');
  const progressEl = document.getElementById('progress');

  const studentId = localStorage.getItem('orf_playback_student');
  const assessmentId = localStorage.getItem('orf_playback_assessment');

  if (!studentId || !assessmentId) {
    wordArea.innerHTML = '<p class="playback-message">Missing student or assessment data.</p>';
    return;
  }

  const assessment = getAssessment(assessmentId);
  if (!assessment || assessment.studentId !== studentId) {
    wordArea.innerHTML = '<p class="playback-message">Assessment not found.</p>';
    return;
  }

  const alignment = assessment.alignment || [];
  const sttWords = assessment.sttWords || [];

  if (!alignment.length) {
    wordArea.innerHTML = '<p class="playback-message">No alignment data available.</p>';
    return;
  }

  if (!assessment.audioRef) {
    wordArea.innerHTML = '<p class="playback-message">Audio not available for this assessment.</p>';
    return;
  }

  // Count stats
  const refEntries = alignment.filter(e => e.type !== 'insertion');
  const correctCount = refEntries.filter(e => isSpokenCorrect(e)).length;

  statsEl.textContent = `You read ${correctCount} out of ${refEntries.length} words correctly!`;

  // Render word spans
  wordArea.innerHTML = '';
  const wordSpans = [];
  for (let i = 0; i < alignment.length; i++) {
    const entry = alignment[i];
    if (entry.type === 'insertion') continue;

    const span = document.createElement('span');
    span.className = 'word';
    span.textContent = entry._displayRef || entry.ref || '???';

    if (!isSpokenCorrect(entry)) {
      span.classList.add('gap');
    }
    if (entry.type === 'struggle' && entry.compound) {
      span.classList.add('struggle');
    }

    wordArea.appendChild(span);
    wordSpans.push({ refIndex: i, el: span });
  }

  // Load audio and build stitched buffer
  wordArea.insertAdjacentHTML('beforeend', '<p class="playback-message" id="loadMsg">Preparing your fluent reading...</p>');

  const audioBlob = await getAudioBlob(assessment.audioRef);
  if (!audioBlob) {
    document.getElementById('loadMsg').textContent = 'Audio not found in storage.';
    return;
  }

  let stitchResult;
  try {
    stitchResult = await buildStitchedAudio(alignment, sttWords, audioBlob);
  } catch (err) {
    console.error('[FutureYou] Stitch failed:', err);
    document.getElementById('loadMsg').textContent = 'Could not process audio.';
    return;
  }

  const { buffer, segmentMap } = stitchResult;

  // Encode to WAV for playback
  const wavBlob = encodeWAV(buffer);
  const audioEl = new Audio();
  audioEl.src = URL.createObjectURL(wavBlob);

  // Remove loading message, enable play
  const loadMsg = document.getElementById('loadMsg');
  if (loadMsg) loadMsg.remove();
  playBtn.disabled = false;

  const totalDuration = buffer.length / buffer.sampleRate;
  progressEl.textContent = formatTime(0) + ' / ' + formatTime(totalDuration);

  // Build lookup: refIndex → span element
  const spanByRef = new Map();
  for (const ws of wordSpans) spanByRef.set(ws.refIndex, ws.el);

  // Playback state
  let isPlaying = false;
  let animFrameId = null;

  function updateHighlights() {
    if (!audioEl || audioEl.paused) {
      animFrameId = null;
      return;
    }

    const ct = audioEl.currentTime;
    progressEl.textContent = formatTime(ct) + ' / ' + formatTime(totalDuration);

    // Find active segment
    let activeRefIndex = -1;
    for (const seg of segmentMap) {
      if (ct >= seg.startInStitched && ct < seg.startInStitched + seg.duration) {
        activeRefIndex = seg.refIndex;
        break;
      }
    }

    // Update span classes
    for (const seg of segmentMap) {
      const span = spanByRef.get(seg.refIndex);
      if (!span) continue;

      if (seg.refIndex === activeRefIndex) {
        span.classList.add('active');
        span.classList.remove('played');
      } else if (ct >= seg.startInStitched + seg.duration) {
        span.classList.remove('active');
        span.classList.add('played');
      } else {
        span.classList.remove('active', 'played');
      }
    }

    animFrameId = requestAnimationFrame(updateHighlights);
  }

  audioEl.addEventListener('ended', () => {
    isPlaying = false;
    playBtn.textContent = '\u25B6';
    if (animFrameId) cancelAnimationFrame(animFrameId);
    animFrameId = null;

    // Mark all as played
    for (const ws of wordSpans) {
      ws.el.classList.remove('active');
      ws.el.classList.add('played');
    }
    progressEl.textContent = formatTime(totalDuration) + ' / ' + formatTime(totalDuration);
  });

  playBtn.addEventListener('click', () => {
    if (isPlaying) {
      audioEl.pause();
      isPlaying = false;
      playBtn.textContent = '\u25B6';
      if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
    } else {
      // Reset if ended
      if (audioEl.ended) {
        audioEl.currentTime = 0;
        for (const ws of wordSpans) ws.el.classList.remove('active', 'played');
      }
      audioEl.play().then(() => {
        isPlaying = true;
        playBtn.textContent = '\u23F8';
        if (!animFrameId) animFrameId = requestAnimationFrame(updateHighlights);
      }).catch(() => {});
    }
  });
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ':' + String(sec).padStart(2, '0');
}

document.addEventListener('DOMContentLoaded', init);
