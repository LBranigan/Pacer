/**
 * Word-synced audio playback engine.
 * @module audio-playback
 * @exports {Function} createSyncedPlayback
 */

import { getAudioBlob } from './audio-store.js';

const DISFLUENCIES = new Set(['um', 'uh', 'uh-huh', 'mm', 'hmm', 'er', 'ah']);

/**
 * Parse STT timestamp string like "1.200s" to seconds number.
 * @param {string} t
 * @returns {number}
 */
function parseTime(t) {
  if (typeof t === 'number') return t;
  if (!t) return 0;
  // Handle protobuf Duration object {seconds: "1", nanos: 200000000}
  if (typeof t === 'object' && t.seconds !== undefined) {
    return Number(t.seconds || 0) + (Number(t.nanos || 0) / 1e9);
  }
  // Handle string like "1.200s"
  return parseFloat(String(t).replace('s', '')) || 0;
}

/**
 * Create a synced playback controller bound to a container element.
 * @param {HTMLElement} containerEl
 * @returns {{ load, play, pause, destroy }}
 */
export function createSyncedPlayback(containerEl) {
  let audioEl = new Audio();
  let objectUrl = null;
  let wordEls = [];
  let wordTimings = []; // { start, end } per wordEl index
  let animFrameId = null;
  let isPlaying = false;

  // UI elements
  let controlsDiv = null;
  let wordArea = null;
  let playBtn = null;
  let progressBar = null;
  let timeDisplay = null;
  let downloadBtn = null;
  let currentBlob = null;

  function buildUI() {
    containerEl.innerHTML = '';

    controlsDiv = document.createElement('div');
    controlsDiv.className = 'playback-controls';

    playBtn = document.createElement('button');
    playBtn.className = 'playback-play-btn';
    playBtn.textContent = 'Play';
    playBtn.addEventListener('click', () => {
      if (isPlaying) pause(); else play();
    });

    progressBar = document.createElement('input');
    progressBar.type = 'range';
    progressBar.className = 'playback-progress';
    progressBar.min = '0';
    progressBar.max = '100';
    progressBar.value = '0';
    progressBar.step = '0.1';
    progressBar.addEventListener('input', () => {
      if (audioEl.duration) {
        audioEl.currentTime = (progressBar.value / 100) * audioEl.duration;
      }
    });

    timeDisplay = document.createElement('span');
    timeDisplay.className = 'playback-time';
    timeDisplay.textContent = '0:00 / 0:00';

    downloadBtn = document.createElement('button');
    downloadBtn.className = 'playback-download-btn';
    downloadBtn.textContent = '⬇ WAV';
    downloadBtn.title = 'Download as WAV file';
    downloadBtn.style.marginLeft = '0.5rem';
    downloadBtn.addEventListener('click', downloadAsWav);

    controlsDiv.appendChild(playBtn);
    controlsDiv.appendChild(progressBar);
    controlsDiv.appendChild(timeDisplay);
    controlsDiv.appendChild(downloadBtn);

    wordArea = document.createElement('div');
    wordArea.className = 'playback-words';

    containerEl.appendChild(controlsDiv);
    containerEl.appendChild(wordArea);

    audioEl.addEventListener('timeupdate', onTimeUpdate);
    audioEl.addEventListener('ended', onEnded);
  }

  function formatTime(s) {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ':' + String(sec).padStart(2, '0');
  }

  function onTimeUpdate() {
    if (audioEl.duration) {
      progressBar.value = (audioEl.currentTime / audioEl.duration) * 100;
      timeDisplay.textContent = formatTime(audioEl.currentTime) + ' / ' + formatTime(audioEl.duration);
    }
  }

  function onEnded() {
    isPlaying = false;
    playBtn.textContent = 'Play';
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }

  /**
   * Convert AudioBuffer to WAV blob.
   */
  function audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;

    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;

    // Interleave channels
    const length = buffer.length;
    const dataLength = length * numChannels * bytesPerSample;
    const headerLength = 44;
    const totalLength = headerLength + dataLength;

    const arrayBuffer = new ArrayBuffer(totalLength);
    const view = new DataView(arrayBuffer);

    // WAV header
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, totalLength - 8, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, dataLength, true);

    // Write audio data
    const channels = [];
    for (let i = 0; i < numChannels; i++) {
      channels.push(buffer.getChannelData(i));
    }

    let offset = 44;
    for (let i = 0; i < length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, channels[ch][i]));
        const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset, intSample, true);
        offset += 2;
      }
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  /**
   * Download current audio as WAV file.
   */
  async function downloadAsWav() {
    if (!currentBlob) {
      alert('No audio loaded');
      return;
    }

    downloadBtn.disabled = true;
    downloadBtn.textContent = '...';

    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const arrayBuffer = await currentBlob.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      const wavBlob = audioBufferToWav(audioBuffer);
      const url = URL.createObjectURL(wavBlob);

      const a = document.createElement('a');
      a.href = url;
      a.download = 'recording-' + new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-') + '.wav';
      a.click();

      URL.revokeObjectURL(url);
      audioContext.close();
    } catch (err) {
      console.error('WAV conversion failed:', err);
      alert('Failed to convert to WAV: ' + err.message);
    } finally {
      downloadBtn.disabled = false;
      downloadBtn.textContent = '⬇ WAV';
    }
  }

  function syncLoop() {
    if (!audioEl || audioEl.paused || audioEl.ended) {
      animFrameId = null;
      return;
    }
    const ct = audioEl.currentTime;

    // Find the single best word to highlight: among all words whose time range
    // contains the playhead, pick the one with the latest start time.
    // This handles overlapping timestamps from mixed Reverb/cross-validator sources —
    // when an unconfirmed word overlaps with a confirmed word's extended
    // cross-validator timestamps, the most recently started word wins.
    let activeIdx = -1;
    let latestStart = -1;
    for (let i = 0; i < wordEls.length; i++) {
      const t = wordTimings[i];
      if (t && ct >= t.start && ct < t.end && t.start > latestStart) {
        activeIdx = i;
        latestStart = t.start;
      }
    }

    for (let i = 0; i < wordEls.length; i++) {
      if (i === activeIdx) {
        wordEls[i].classList.add('speaking');
      } else {
        wordEls[i].classList.remove('speaking');
      }
    }
    animFrameId = requestAnimationFrame(syncLoop);
  }

  /**
   * Load audio and render words.
   * @param {string} assessmentId
   * @param {Array} sttWords - STT word results with startTime/endTime
   * @param {Array} alignment - alignment entries [{type, ref, hyp}, ...]
   */
  async function load(assessmentId, sttWords, alignment) {
    buildUI();

    const blob = await getAudioBlob(assessmentId);
    if (!blob) {
      wordArea.innerHTML = '<p class="playback-no-audio">Audio not available</p>';
      playBtn.disabled = true;
      downloadBtn.disabled = true;
      return;
    }

    currentBlob = blob;
    objectUrl = URL.createObjectURL(blob);
    audioEl.src = objectUrl;

    // Render alignment words and map timings
    wordEls = [];
    wordTimings = [];
    wordArea.innerHTML = '';

    if (!alignment || alignment.length === 0) {
      wordArea.innerHTML = '<p class="playback-no-audio">No alignment data available</p>';
      return;
    }

    // Filter disfluencies to match what alignWords uses
    let sttIdx = 0;
    const stt = (sttWords || []).filter(w => {
      const norm = (w.word || '').toLowerCase().replace(/^[^\w'-]+|[^\w'-]+$/g, '');
      return norm.length > 0 && !DISFLUENCIES.has(norm);
    });

    for (const entry of alignment) {
      const span = document.createElement('span');
      const type = entry.type || 'correct';
      span.className = 'playback-word ' + type;

      if (type === 'substitution') {
        span.textContent = (entry.ref || '') + '(' + (entry.hyp || '') + ')';
      } else if (type === 'omission') {
        span.textContent = entry.ref || '';
      } else if (type === 'insertion') {
        span.textContent = entry.hyp || '';
      } else {
        // correct or other
        span.textContent = entry.ref || entry.hyp || '';
      }

      wordArea.appendChild(span);
      wordEls.push(span);

      // Omissions have no spoken word, so no STT timestamp
      if (type === 'omission') {
        wordTimings.push(null);
      } else {
        if (sttIdx < stt.length) {
          const w = stt[sttIdx];
          wordTimings.push({
            start: parseTime(w.startTime),
            end: parseTime(w.endTime)
          });
          sttIdx++;
        } else {
          wordTimings.push(null);
        }
      }
    }
  }

  function play() {
    if (!audioEl.src) return;
    audioEl.play().then(() => {
      if (!animFrameId) animFrameId = requestAnimationFrame(syncLoop);
    }).catch(() => {});
    isPlaying = true;
    playBtn.textContent = 'Pause';
  }

  function pause() {
    audioEl.pause();
    isPlaying = false;
    playBtn.textContent = 'Play';
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  function destroy() {
    pause();
    audioEl.removeEventListener('timeupdate', onTimeUpdate);
    audioEl.removeEventListener('ended', onEnded);
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    containerEl.innerHTML = '';
    wordEls = [];
    wordTimings = [];
    audioEl = null;
  }

  return { load, play, pause, destroy };
}
