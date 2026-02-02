/**
 * Student playback page -- audio-synced character animation.
 * Character hops across words in sync with audio, battles at error words.
 * @module student-playback
 */

import { SpriteAnimator } from './sprite-animator.js';
import { getAudioBlob } from './audio-store.js';
import { getAssessment, getAssessments, saveGamification } from './storage.js';
import { computeScore } from './gamification.js';

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

  // Gamification feedback on playback complete
  document.addEventListener('playback-complete', () => {
    const pastAssessments = getAssessments(studentId).filter(a => a.id !== assessmentId && a.gamification);
    const pastScores = pastAssessments.map(a => a.gamification.totalPoints);
    const score = computeScore(alignment, pastScores);
    saveGamification(assessmentId, score);
    showFeedback(score);
  });

  function showFeedback(score) {
    const feedbackArea = document.getElementById('feedback-area');
    const progressVal = score.progress !== null ? Math.round(score.progress * 50) : 0;
    const progressPct = score.progress !== null ? Math.min(Math.round(score.progress * 100), 200) : 0;

    // SVG progress ring
    const radius = 40;
    const circ = 2 * Math.PI * radius;
    const offset = circ - (progressPct / 200) * circ;

    feedbackArea.innerHTML = `
      <div class="feedback-panel">
        <h2 class="feedback-title">Great Job!</h2>
        <div class="feedback-stats">
          <div class="score-display">
            <span class="score-label">Score</span>
            <span class="score-value" id="scoreCounter">0</span>
          </div>
          <div class="streak-badge">
            <span class="streak-icon">&#x1F525;</span>
            <span class="streak-value">${score.bestStreak}</span>
            <span class="streak-label">Best Streak</span>
          </div>
          <div class="level-display">
            <span class="level-label">Level</span>
            <span class="level-value">${score.level}</span>
          </div>
        </div>
        <div class="progress-ring-wrapper">
          <svg class="progress-ring" width="100" height="100" viewBox="0 0 100 100">
            <circle class="progress-ring-bg" cx="50" cy="50" r="${radius}" />
            <circle class="progress-ring-fill" cx="50" cy="50" r="${radius}"
              stroke-dasharray="${circ}" stroke-dashoffset="${circ}"
              data-target-offset="${offset}" />
          </svg>
          <span class="progress-ring-text">${score.progress !== null ? (progressPct >= 100 ? 'Improving!' : 'Keep going!') : 'First try!'}</span>
        </div>
        <div class="feedback-detail">
          ${score.wordsCorrect} / ${score.wordsTotal} words correct
          ${score.bonus > 0 ? ` &middot; +${score.bonus} streak bonus` : ''}
        </div>
        <div class="feedback-actions">
          <button class="feedback-btn play-again-btn" id="playAgainBtn">Play Again</button>
          <a href="index.html" class="feedback-btn back-home-btn">Back</a>
        </div>
      </div>
    `;

    // Animate score count-up
    const counter = document.getElementById('scoreCounter');
    animateCount(counter, 0, score.totalPoints, 1200);

    // Animate progress ring
    const fillCircle = feedbackArea.querySelector('.progress-ring-fill');
    requestAnimationFrame(() => {
      fillCircle.style.strokeDashoffset = offset;
    });

    // Play Again button
    document.getElementById('playAgainBtn').addEventListener('click', () => {
      feedbackArea.innerHTML = '';
      if (audioEl) {
        audioEl.currentTime = 0;
        // Reset word styles
        for (const w of wordSequence) {
          w.el.classList.remove('active', 'correct-done', 'error-done');
        }
        currentWordIdx = -1;
        progressEl.textContent = '0 / ' + wordSequence.length;
        playBtn.click();
      }
    });
  }

  function animateCount(el, from, to, duration) {
    const start = performance.now();
    function step(now) {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      el.textContent = Math.round(from + (to - from) * t);
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

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
