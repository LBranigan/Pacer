/**
 * Word-synced audio playback engine.
 * @module audio-playback
 * @exports {Function} createSyncedPlayback
 */

import { getAudioBlob } from './audio-store.js';

/**
 * Parse STT timestamp string like "1.200s" to seconds number.
 * @param {string} t
 * @returns {number}
 */
function parseTime(t) {
  if (typeof t === 'number') return t;
  if (!t) return 0;
  return parseFloat(String(t).replace('s', ''));
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

    controlsDiv.appendChild(playBtn);
    controlsDiv.appendChild(progressBar);
    controlsDiv.appendChild(timeDisplay);

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

  function syncLoop() {
    if (!audioEl || audioEl.paused || audioEl.ended) {
      animFrameId = null;
      return;
    }
    const ct = audioEl.currentTime;
    for (let i = 0; i < wordEls.length; i++) {
      const t = wordTimings[i];
      if (t && ct >= t.start && ct < t.end) {
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
      return;
    }

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

    // STT words index (only spoken words have timestamps)
    let sttIdx = 0;
    const stt = sttWords || [];

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
    audioEl.play();
    isPlaying = true;
    playBtn.textContent = 'Pause';
    if (!animFrameId) animFrameId = requestAnimationFrame(syncLoop);
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
