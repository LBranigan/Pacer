/**
 * Student playback page -- audio-synced character animation.
 * Character hops across words in sync with audio, battles at error words.
 * @module student-playback
 */

import { EffectEngine } from './effect-engine.js';
import { getAudioBlob } from './audio-store.js';
import { getAssessment, getAssessments, saveGamification } from './storage.js';
import { computeScore } from './gamification.js';

const DISFLUENCIES = new Set(['um', 'uh', 'uh-huh', 'mm', 'hmm', 'er', 'ah']);

function getWordRect(el, canvas) {
  const wr = el.getBoundingClientRect();
  const cr = canvas.getBoundingClientRect();
  return { x: wr.left - cr.left, y: wr.top - cr.top, w: wr.width, h: wr.height };
}

function applyDecryptEffect(el) {
  const text = el.textContent;
  el.innerHTML = '';
  el.classList.add('decrypting');
  for (let i = 0; i < text.length; i++) {
    const span = document.createElement('span');
    span.className = 'char';
    span.textContent = text[i];
    span.style.animationDelay = `${i * 0.05}s`;
    el.appendChild(span);
  }
  setTimeout(() => {
    el.classList.remove('decrypting');
    el.textContent = text;
  }, text.length * 50 + 400);
}

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
  // Apply selected theme
  const theme = localStorage.getItem('orf_playback_theme') || 'cyber';
  document.body.setAttribute('data-theme', theme);

  // Read params from localStorage (same pattern as dashboard)
  const studentId = localStorage.getItem('orf_playback_student');
  const assessmentId = localStorage.getItem('orf_playback_assessment');

  const wordArea = document.getElementById('word-area');
  const canvas = document.getElementById('character-canvas');
  const playBtn = document.getElementById('playBtn');

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
    span.setAttribute('data-text', word.text);
    wordArea.appendChild(span);
    word.el = span;
  }



  // Set up canvas
  const ctx = canvas.getContext('2d');
  let effectEngine = new EffectEngine(ctx, { theme });

  function sizeCanvas() {
    const rect = wordArea.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    effectEngine.resize();
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
    feedbackArea.innerHTML = `
      <div class="feedback-panel">
        <div class="feedback-score">${score.wordsCorrect} / ${score.wordsTotal} correct</div>
        <div class="feedback-actions">
          <button class="feedback-btn play-again-btn" id="playAgainBtn">Play Again</button>
          <button class="feedback-btn back-home-btn" id="backBtn">Back</button>
        </div>
      </div>
    `;

    // Back button — close popup window, fall back to index.html
    document.getElementById('backBtn').addEventListener('click', () => {
      window.close();
      // If window.close() is blocked (not opened via script), navigate instead
      window.location.href = 'index.html';
    });

    // Play Again button
    document.getElementById('playAgainBtn').addEventListener('click', () => {
      feedbackArea.innerHTML = '';
      if (audioEl) {
        audioEl.currentTime = 0;
        // Reset word styles
        for (const w of wordSequence) {
          w.el.classList.remove('active', 'correct-done', 'error-done', 'decrypting');
          w.el.textContent = w.text;
        }
        currentWordIdx = -1;
      
        playBtn.click();
      }
    });
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
    effectEngine.drawBackgroundScanlines();

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
          if (!w.el.classList.contains('active')) {
            w.el.classList.add('active');
            applyDecryptEffect(w.el);
          }
        }
      }


      // Get word rect relative to canvas
      const wr = getWordRect(cw.el, canvas);
      const isError = cw.type !== 'correct';
      const wordDuration = cw.endTime - cw.startTime;
      const wordProgress = wordDuration > 0 ? Math.min((ct - cw.startTime) / wordDuration, 1) : 0.5;

      // Check for gap
      const nextSpoken = wordSequence.slice(currentWordIdx + 1).find(nw => nw.startTime > 0);
      const inGap = nextSpoken && ct >= cw.endTime && (nextSpoken.startTime - cw.endTime) > 1.5;

      if (isError || inGap) {
        let battlePhase;
        if (inGap) {
          battlePhase = Math.min((ct - cw.endTime) / (nextSpoken.startTime - cw.endTime), 1);
        } else {
          battlePhase = wordDuration > 0 ? Math.min((ct - cw.startTime) / (wordDuration * 1.5), 1) : 0.5;
        }
        effectEngine.drawErrorGlitch(wr, battlePhase);
        effectEngine.drawScanLine(wr, wordProgress, true);
      } else {
        if (wordProgress < 0.3) {
          effectEngine.drawGridSweep(wr, wordProgress / 0.3);
        }
        if (wordProgress >= 0.3 && wordProgress <= 0.8) {
          effectEngine.drawScanLine(wr, (wordProgress - 0.3) / 0.5);
        }
      }

      effectEngine.updateNeonTrail(wr);
    }

    effectEngine.update(0.016);
    effectEngine.render();

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
