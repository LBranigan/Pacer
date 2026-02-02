/**
 * Student playback page -- audio-synced character animation.
 * Character hops across words in sync with audio, battles at error words.
 * @module student-playback
 */

import { SpriteAnimator } from './sprite-animator.js';
import { getAudioBlob } from './audio-store.js';
import { getAssessment } from './storage.js';

const DISFLUENCIES = new Set(['um', 'uh', 'uh-huh', 'mm', 'hmm', 'er', 'ah']);

/**
 * Parse STT timestamp to seconds.
 * Handles string "1.200s", number, and protobuf Duration objects.
 */
function parseTime(t) {
  if (typeof t === 'number') return t;
  if (!t) return 0;
  if (typeof t === 'object' && t.seconds !== undefined) {
    return Number(t.seconds || 0) + (Number(t.nanos || 0) / 1e9);
  }
  return parseFloat(String(t).replace('s', '')) || 0;
}

/**
 * Initialize the student playback page.
 */
function initStudentPlayback() {
  const params = new URLSearchParams(window.location.search);
  const studentId = params.get('student');
  const assessmentId = params.get('assessment');

  const wordArea = document.getElementById('word-area');
  const canvas = document.getElementById('character-canvas');
  const playBtn = document.getElementById('playBtn');
  const progressEl = document.getElementById('progressIndicator');

  if (!studentId || !assessmentId) {
    wordArea.innerHTML = '<p class="playback-message">Missing student or assessment parameter.</p>';
    playBtn.disabled = true;
    return;
  }

  const assessment = getAssessment(assessmentId);
  if (!assessment || assessment.studentId !== studentId) {
    wordArea.innerHTML = '<p class="playback-message">Assessment not found.</p>';
    playBtn.disabled = true;
    return;
  }

  const alignment = assessment.alignment || [];
  const sttWords = assessment.sttWords || [];

  if (!alignment.length) {
    wordArea.innerHTML = '<p class="playback-message">No alignment data available.</p>';
    playBtn.disabled = true;
    return;
  }

  // Build word sequence from alignment (ref words only, skip insertions for display)
  // Map STT timings: skip omissions (no spoken timing), advance sttIdx for correct/substitution
  const filteredStt = sttWords.filter(w => {
    const norm = (w.word || '').toLowerCase().replace(/^[^\w'-]+|[^\w'-]+$/g, '');
    return norm.length > 0 && !DISFLUENCIES.has(norm);
  });

  let sttIdx = 0;
  const wordSequence = [];

  for (const entry of alignment) {
    const type = entry.type || 'correct';

    // Skip insertions for word display (they are not in the passage)
    if (type === 'insertion') {
      // But consume the STT timing slot
      if (sttIdx < filteredStt.length) sttIdx++;
      continue;
    }

    const word = {
      text: entry.ref || '',
      type: type,
      startTime: 0,
      endTime: 0,
      el: null
    };

    // Omissions have no spoken word -- no STT timing
    if (type === 'omission') {
      word.startTime = -1;
      word.endTime = -1;
    } else {
      if (sttIdx < filteredStt.length) {
        const w = filteredStt[sttIdx];
        word.startTime = parseTime(w.startTime);
        word.endTime = parseTime(w.endTime);
        sttIdx++;
      }
    }

    wordSequence.push(word);
  }

  // Render word spans
  wordArea.innerHTML = '';
  for (const word of wordSequence) {
    const span = document.createElement('span');
    span.className = 'word-span';
    span.textContent = word.text;
    wordArea.appendChild(span);
    word.el = span;
  }

  progressEl.textContent = '0 / ' + wordSequence.length;

  // Set up canvas
  const ctx = canvas.getContext('2d');
  let animator = new SpriteAnimator(ctx, { size: 36 });

  function sizeCanvas() {
    const rect = wordArea.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
  }
  sizeCanvas();

  const ro = new ResizeObserver(sizeCanvas);
  ro.observe(wordArea);

  // Load audio
  let audioEl = null;
  let animFrameId = null;
  let isPlaying = false;
  let currentWordIdx = -1;

  async function loadAudio() {
    if (!assessment.audioRef) {
      wordArea.insertAdjacentHTML('afterbegin', '<p class="playback-message">Audio not available for this assessment.</p>');
      playBtn.disabled = true;
      return;
    }

    const blob = await getAudioBlob(assessment.audioRef);
    if (!blob) {
      wordArea.insertAdjacentHTML('afterbegin', '<p class="playback-message">Audio not found in storage.</p>');
      playBtn.disabled = true;
      return;
    }

    audioEl = new Audio();
    audioEl.src = URL.createObjectURL(blob);

    audioEl.addEventListener('ended', () => {
      isPlaying = false;
      playBtn.textContent = '\u25B6';
      cancelAnimationFrame(animFrameId);
      animFrameId = null;

      // Show final state: all words colored
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const w of wordSequence) {
        w.el.classList.remove('active');
        if (w.type === 'correct') {
          w.el.classList.add('correct-done');
        } else if (w.type !== 'correct' && w.startTime >= 0) {
          w.el.classList.add('error-done');
        } else if (w.type === 'omission') {
          w.el.classList.add('error-done');
        }
      }
      progressEl.textContent = wordSequence.length + ' / ' + wordSequence.length;
      document.dispatchEvent(new CustomEvent('playback-complete'));
    });
  }

  loadAudio();

  // Animation loop
  function animationLoop() {
    if (!audioEl || audioEl.paused || audioEl.ended) {
      animFrameId = null;
      return;
    }

    const ct = audioEl.currentTime;
    sizeCanvas();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Find current word: whose startTime <= ct < endTime
    let newIdx = -1;
    for (let i = 0; i < wordSequence.length; i++) {
      const w = wordSequence[i];
      if (w.startTime < 0) continue; // omission
      if (ct >= w.startTime && ct < w.endTime) {
        newIdx = i;
        break;
      }
    }

    // If between words, check for gap battles or stay on last word
    if (newIdx === -1) {
      // Find the word we just passed
      for (let i = wordSequence.length - 1; i >= 0; i--) {
        const w = wordSequence[i];
        if (w.startTime < 0) continue;
        if (ct >= w.endTime) {
          // Check if there's a next spoken word with a gap > 1.5s
          const nextSpoken = wordSequence.slice(i + 1).find(nw => nw.startTime > 0);
          if (nextSpoken && (nextSpoken.startTime - w.endTime) > 1.5) {
            newIdx = i; // Stay on this word (battle during gap)
          } else {
            newIdx = i;
          }
          break;
        }
      }
    }

    if (newIdx >= 0) {
      currentWordIdx = newIdx;
    }

    // Update word span classes and draw character
    if (currentWordIdx >= 0 && currentWordIdx < wordSequence.length) {
      const cw = wordSequence[currentWordIdx];

      for (let i = 0; i < wordSequence.length; i++) {
        const w = wordSequence[i];
        w.el.classList.remove('active');
        if (i < currentWordIdx) {
          if (w.type === 'correct') {
            w.el.classList.add('correct-done');
          } else {
            w.el.classList.add('error-done');
          }
        } else if (i === currentWordIdx) {
          w.el.classList.add('active');
        }
      }

      progressEl.textContent = (currentWordIdx + 1) + ' / ' + wordSequence.length;

      // Position character above current word
      const wordRect = cw.el.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const charX = wordRect.left - canvasRect.left + wordRect.width / 2;
      const charY = wordRect.top - canvasRect.top - 10;

      // Determine animation state
      const isError = cw.type !== 'correct';
      const wordDuration = cw.endTime - cw.startTime;

      // Check for gap battle
      const nextSpoken = wordSequence.slice(currentWordIdx + 1).find(nw => nw.startTime > 0);
      const inGap = nextSpoken && ct >= cw.endTime && (nextSpoken.startTime - cw.endTime) > 1.5;

      if (isError || inGap) {
        // Battle animation
        let battlePhase;
        if (inGap) {
          const gapStart = cw.endTime;
          const gapEnd = nextSpoken.startTime;
          battlePhase = Math.min((ct - gapStart) / (gapEnd - gapStart), 1);
        } else {
          battlePhase = wordDuration > 0 ? Math.min((ct - cw.startTime) / (wordDuration * 1.5), 1) : 0.5;
        }
        animator.drawBattle(charX, charY, battlePhase);
      } else if (wordDuration > 0) {
        // Hop animation
        const hopPhase = wordDuration > 0 ? ((ct - cw.startTime) / wordDuration) % 1 : 0;
        animator.drawHop(charX, charY, hopPhase);
      } else {
        animator.drawIdle(charX, charY);
      }
    }

    animFrameId = requestAnimationFrame(animationLoop);
  }

  // Play/Pause controls
  playBtn.addEventListener('click', () => {
    if (!audioEl) return;

    if (isPlaying) {
      audioEl.pause();
      isPlaying = false;
      playBtn.textContent = '\u25B6';
      if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
      }
    } else {
      audioEl.play().then(() => {
        isPlaying = true;
        playBtn.textContent = '\u23F8';
        if (!animFrameId) animFrameId = requestAnimationFrame(animationLoop);
      }).catch(() => {});
    }
  });
}

document.addEventListener('DOMContentLoaded', initStudentPlayback);
