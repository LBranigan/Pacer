// maze-game.js — Maze comprehension game engine
// State machine, ASR listener, countdown timer, UI orchestration
//
// ASR priority:
//   1. Web Speech API (Chrome built-in, no backend needed)
//   2. Deepgram Nova-3 via backend proxy (fallback)
//   3. Click-only mode (final fallback)

import { getAssessment } from './storage.js';
import { generateMazeItems, verifyMazeResponse, canRunMaze } from './maze-generator.js';

// ── Constants ──

const BACKEND_BASE_URL = 'http://localhost:8765';
const ROUND_DURATION_MS = 20000;

// ── DOM refs ──

const $ = id => document.getElementById(id);
const welcomeScreen = $('welcome');
const roundScreen = $('round');
const resultsScreen = $('results');
const errorScreen = $('error');

// ── Game state ──

let gameState = {
  items: [],
  currentRound: 0,
  results: [],
  asrMode: 'click',  // 'webspeech' | 'deepgram' | 'click'
  difficulty: 'standard',
  studentId: null,
  assessmentId: null,
};


// ── Audio feedback ──

function playCorrectSound() {
  try {
    const snd = new Audio('audio files/1up.mp3');
    snd.volume = 0.5;
    snd.play().catch(() => {});
  } catch { /* ignore */ }
}

function playWrongSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.value = 0.3;
    osc.frequency.setValueAtTime(400, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(300, ctx.currentTime + 0.3);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.35);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.35);
  } catch { /* ignore */ }
}


// ── Screen management ──

function showScreen(screenEl) {
  for (const s of document.querySelectorAll('.screen')) s.classList.remove('active');
  screenEl.classList.add('active');
}

function showError(msg) {
  $('errorMessage').textContent = msg;
  showScreen(errorScreen);
}


// =============================================================================
// ASR Engines
// =============================================================================

// ── Web Speech API ASR (primary — Chrome built-in) ──

class WebSpeechASR {
  constructor(options, onMatch, onTranscript) {
    this.options = options;
    this.onMatch = onMatch;
    this.onTranscript = onTranscript;
    this.stopped = false;
    this.recognition = null;
    this._matched = false;
  }

  async start() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) throw new Error('Web Speech API not supported');

    this.recognition = new SR();
    this.recognition.continuous = false;     // Stop after one utterance
    this.recognition.interimResults = false; // Only final results
    this.recognition.maxAlternatives = 5;    // Multiple hypotheses to match against
    this.recognition.lang = 'en-US';

    // Chrome 139+: on-device processing for better latency + privacy
    this._useLocalProcessing = false;
    if ('processLocally' in this.recognition) {
      this.recognition.processLocally = true;
      this._useLocalProcessing = true;
      console.log('[maze-webspeech] On-device processing enabled');
    }

    // Chrome 139+: contextual biasing to boost target words
    if (typeof SpeechRecognitionPhrase !== 'undefined') {
      try {
        this.recognition.phrases = this.options.map(
          word => new SpeechRecognitionPhrase(word, 8.0)
        );
        console.log('[maze-webspeech] Contextual biasing for:', this.options);
      } catch (e) {
        console.warn('[maze-webspeech] Phrases not supported:', e.message);
      }
    }

    this.recognition.onresult = (event) => {
      if (this.stopped || this._matched) return;
      const alternatives = event.results[0];
      const optNorm = this.options.map(o => o.toLowerCase());

      console.log(`[maze-webspeech] ${alternatives.length} alternative(s):`);

      // Pass 1: exact match against any alternative
      for (let i = 0; i < alternatives.length; i++) {
        const transcript = alternatives[i].transcript.trim().toLowerCase();
        const conf = alternatives[i].confidence;
        console.log(`  [${i}] "${transcript}" (${(conf * 100).toFixed(0)}%)`);

        const idx = optNorm.indexOf(transcript);
        if (idx !== -1) {
          console.log(`[maze-webspeech] Exact match: "${this.options[idx]}"`);
          this._matched = true;
          this.onTranscript(transcript);
          this.onMatch(this.options[idx]);
          this.stop();
          return;
        }
      }

      // Pass 2: fuzzy match on best alternative via verifyMazeResponse
      const bestTranscript = alternatives[0].transcript.trim();
      this.onTranscript(bestTranscript);

      const result = verifyMazeResponse(bestTranscript, this.options, this.options[0]);
      console.log(`[maze-webspeech] Fuzzy match result:`, result);
      if (result.matched) {
        this._matched = true;
        this.onMatch(result.matched);
        this.stop();
        return;
      }

      console.log('[maze-webspeech] No match, will restart on end event...');
    };

    this.recognition.onnomatch = () => {
      console.log('[maze-webspeech] No match event');
    };

    this.recognition.onerror = (event) => {
      if (this.stopped) return;
      if (event.error === 'no-speech') {
        console.log('[maze-webspeech] No speech detected (will restart)');
      } else if (event.error === 'aborted') {
        // Normal when stop() is called
      } else if (event.error === 'language-not-supported' && this._useLocalProcessing) {
        // On-device model not available — disable and retry with server-side
        console.warn('[maze-webspeech] On-device not available, falling back to server-side');
        this._useLocalProcessing = false;
        this.recognition.processLocally = false;
      } else {
        console.warn(`[maze-webspeech] Error: ${event.error}`);
      }
    };

    this.recognition.onend = () => {
      // Auto-restart: Chrome stops after each utterance or ~7s silence.
      // Keep restarting until we get a match or the round timer expires.
      if (!this.stopped && !this._matched) {
        try {
          this.recognition.start();
        } catch (e) {
          console.warn('[maze-webspeech] Restart failed:', e.message);
        }
      }
    };

    this.recognition.start();
    console.log('[maze-webspeech] Listening for:', this.options);
  }

  stop() {
    this.stopped = true;
    if (this.recognition) {
      try { this.recognition.abort(); } catch {}
    }
  }
}


// ── Deepgram ASR (fallback — requires backend) ──

class DeepgramASR {
  constructor(options, onMatch, onTranscript) {
    this.options = options;
    this.onMatch = onMatch;
    this.onTranscript = onTranscript;
    this.stopped = false;
    this.stream = null;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.audioCtx = null;
    this._sending = false;
    this._lastSendTime = 0;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });

    this.audioCtx = new AudioContext();
    const source = this.audioCtx.createMediaStreamSource(this.stream);
    const analyser = this.audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    this.mediaRecorder = new MediaRecorder(this.stream, { mimeType: 'audio/webm;codecs=opus' });
    this.audioChunks = [];
    this.mediaRecorder.ondataavailable = e => { if (e.data.size > 0) this.audioChunks.push(e.data); };
    this.mediaRecorder.start(500);

    let speaking = false;
    let silenceStart = null;
    let speechStartTime = null;
    let logCount = 0;

    const VAD_THRESHOLD = 12;
    const VAD_SILENCE_MS = 700;
    const VAD_MAX_SPEECH_MS = 2500;
    const VAD_PERIODIC_MS = 3500;

    const poll = () => {
      if (this.stopped) return;
      analyser.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      const now = Date.now();

      if (++logCount % 90 === 0) {
        console.log(`[maze-deepgram-vad] avg=${avg.toFixed(1)} speaking=${speaking} chunks=${this.audioChunks.length}`);
      }

      if (avg > VAD_THRESHOLD) {
        if (!speaking) {
          console.log(`[maze-deepgram-vad] Speech START (avg=${avg.toFixed(1)})`);
          speechStartTime = now;
        }
        speaking = true;
        silenceStart = null;

        if (speechStartTime && now - speechStartTime > VAD_MAX_SPEECH_MS) {
          console.log(`[maze-deepgram-vad] Force-send: speaking >${VAD_MAX_SPEECH_MS}ms`);
          speaking = false;
          speechStartTime = null;
          this._trySend('force');
        }
      } else if (speaking) {
        if (!silenceStart) silenceStart = now;
        if (now - silenceStart > VAD_SILENCE_MS) {
          console.log(`[maze-deepgram-vad] Speech END — silence detected`);
          speaking = false;
          silenceStart = null;
          speechStartTime = null;
          this._trySend('silence');
        }
      }

      // Periodic backup
      if (this.audioChunks.length >= 4 && now - this._lastSendTime > VAD_PERIODIC_MS) {
        console.log(`[maze-deepgram-vad] Periodic send (${this.audioChunks.length} chunks)`);
        speaking = false;
        silenceStart = null;
        speechStartTime = null;
        this._trySend('periodic');
      }

      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
    console.log('[maze-deepgram] Listening with VAD for:', this.options);
  }

  async _trySend(reason) {
    if (this._sending || this.stopped || this.audioChunks.length === 0) return;
    this._sending = true;
    this._lastSendTime = Date.now();

    // Always send ALL chunks — chunk 0 has WebM EBML header
    const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
    console.log(`[maze-deepgram] Sending ${(blob.size / 1024).toFixed(1)}KB (${this.audioChunks.length} chunks, ${reason})`);

    try {
      const base64 = await blobToBase64(blob);
      const resp = await fetch(`${BACKEND_BASE_URL}/deepgram-maze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio_base64: base64, keyterms: this.options }),
        signal: AbortSignal.timeout(8000)
      });

      if (!resp.ok) {
        console.warn(`[maze-deepgram] Error ${resp.status}: ${await resp.text().catch(() => '')}`);
        return;
      }
      const data = await resp.json();
      console.log(`[maze-deepgram] Heard: "${data.transcript}" (conf=${data.confidence})`);

      if (data.transcript && !this.stopped) {
        // Hallucination guard: ignore if ALL words are keyterms
        const words = data.transcript.toLowerCase().trim().split(/\s+/);
        const optSet = new Set(this.options.map(o => o.toLowerCase()));
        if (words.length >= 3 && words.every(w => optSet.has(w))) {
          console.warn(`[maze-deepgram] Ignoring hallucinated transcript`);
          return;
        }

        this.onTranscript(data.transcript);
        const result = verifyMazeResponse(data.transcript, this.options, this.options[0]);
        console.log(`[maze-deepgram] Match:`, result);
        if (result.matched) {
          this.stop();
          this.onMatch(result.matched);
        }
      }
    } catch (e) {
      console.warn('[maze-deepgram] Send failed:', e.message);
    } finally {
      this._sending = false;
    }
  }

  stop() {
    this.stopped = true;
    if (this.mediaRecorder?.state === 'recording') this.mediaRecorder.stop();
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    if (this.audioCtx) this.audioCtx.close().catch(() => {});
  }
}

function blobToBase64(blob) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(blob);
  });
}


// ── ASR mode detection ──

async function detectASRMode() {
  // Primary: Web Speech API (Chrome built-in, no backend needed)
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    console.log('[maze] ASR mode: Web Speech API');
    return 'webspeech';
  }

  // Fallback: Deepgram via backend
  try {
    const resp = await fetch(`${BACKEND_BASE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    const data = await resp.json();
    if (data.deepgram_configured) {
      console.log('[maze] ASR mode: Deepgram (backend)');
      return 'deepgram';
    }
  } catch {}

  console.log('[maze] ASR mode: click-only (no speech engine available)');
  return 'click';
}


// ── Countdown bar & timer ──

let countdownInterval = null;
let countdownTimeout = null;

function startCountdown(durationMs, onTick, onExpire) {
  const startTime = Date.now();
  const bar = $('countdownBar');
  const timerDisplay = $('timerDisplay');

  bar.style.width = '100%';
  bar.className = 'countdown-bar';
  timerDisplay.className = 'timer';

  countdownInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, durationMs - elapsed);
    const pct = (remaining / durationMs) * 100;
    const secs = Math.ceil(remaining / 1000);

    bar.style.width = pct + '%';
    timerDisplay.textContent = secs;

    if (secs <= 3) {
      bar.className = 'countdown-bar critical';
      timerDisplay.className = 'timer critical';
    } else if (secs <= 5) {
      bar.className = 'countdown-bar warning';
      timerDisplay.className = 'timer warning';
    }

    if (onTick) onTick(secs, remaining);
  }, 100);

  countdownTimeout = setTimeout(() => {
    clearInterval(countdownInterval);
    bar.style.width = '0%';
    timerDisplay.textContent = '0';
    onExpire();
  }, durationMs);
}

function stopCountdown() {
  if (countdownInterval) clearInterval(countdownInterval);
  if (countdownTimeout) clearTimeout(countdownTimeout);
  countdownInterval = null;
  countdownTimeout = null;
}


// ── Round rendering ──

function renderSentence(blankSentence, contextBefore, contextAfter) {
  const display = $('sentenceDisplay');
  const blankHtml = blankSentence.replace('________', '<span class="blank">________</span>');

  let html = '';
  if (contextBefore) html += '<span class="context-dim">' + contextBefore + ' </span>';
  html += blankHtml;
  if (contextAfter) html += '<span class="context-dim"> ' + contextAfter + '</span>';

  display.innerHTML = html;
}

function renderOptions(options, clickable, onClick) {
  const row = $('optionsRow');
  row.innerHTML = '';
  for (const word of options) {
    const card = document.createElement('div');
    card.className = 'maze-option' + (clickable ? ' clickable' : '');
    card.textContent = word;
    card.dataset.word = word;
    if (clickable && onClick) {
      card.addEventListener('click', () => onClick(word));
    }
    row.appendChild(card);
  }
}

function highlightOption(word, className) {
  for (const card of document.querySelectorAll('.maze-option')) {
    card.classList.add('locked');
    if (card.dataset.word === word) card.classList.add(className);
  }
}

function showFeedback(chosen, correctWord, isCorrect, responseTimeMs, timedOut) {
  const msg = $('feedbackMessage');
  const nextBtn = $('nextBtn');

  // Highlight cards
  highlightOption(correctWord, 'correct');
  if (chosen && chosen !== correctWord) highlightOption(chosen, 'wrong');

  // Feedback text
  if (timedOut) {
    msg.textContent = `Time's up! The answer was "${correctWord}"`;
    msg.className = 'feedback-message timeout';
  } else if (isCorrect) {
    msg.textContent = `Correct! "${correctWord}" is right!`;
    msg.className = 'feedback-message correct';
  } else {
    msg.textContent = `Not quite! The answer was "${correctWord}"`;
    msg.className = 'feedback-message wrong';
  }

  nextBtn.style.display = 'inline-block';
  nextBtn.textContent = gameState.currentRound >= gameState.items.length - 1 ? 'See Results' : 'Next';

  // Record result
  const item = gameState.items[gameState.currentRound];
  gameState.results.push({
    sentence: item.sentence,
    blankSentence: item.blankSentence,
    targetWord: item.targetWord,
    targetIndex: item.targetIndex,
    options: item.shuffledOptions,
    correctIndex: item.correctShuffledIndex,
    chosen: chosen,
    chosenIndex: chosen ? item.shuffledOptions.indexOf(chosen) : -1,
    correct: isCorrect,
    matchType: isCorrect ? 'exact' : (chosen ? 'wrong' : 'timeout'),
    transcript: chosen || '',
    responseTimeMs,
    timedOut: !!timedOut
  });
}


// ── Round logic ──

function startRound() {
  const item = gameState.items[gameState.currentRound];
  showScreen(roundScreen);

  $('roundLabel').textContent = `Round ${gameState.currentRound + 1} of ${gameState.items.length}`;
  $('feedbackMessage').textContent = '';
  $('feedbackMessage').className = 'feedback-message';
  $('nextBtn').style.display = 'none';
  $('transcriptPreview').textContent = '';

  renderSentence(item.blankSentence, item.contextBefore || '', item.contextAfter || '');

  let answered = false;
  const startTime = Date.now();

  const lockAnswer = (chosen, timedOut) => {
    if (answered) return;
    answered = true;
    stopCountdown();
    if (activeASR) { activeASR.stop(); activeASR = null; }

    const isCorrect = chosen && chosen.toLowerCase() === item.targetWord.toLowerCase();
    if (isCorrect) playCorrectSound(); else playWrongSound();
    showFeedback(chosen, item.targetWord, isCorrect, Date.now() - startTime, timedOut);
  };

  let activeASR = null;

  if (gameState.asrMode !== 'click') {
    // Speech mode — show mic indicator + clickable options as backup
    $('statusArea').innerHTML = '<span class="mic-indicator"></span> Say or click your answer...';
    renderOptions(item.shuffledOptions, true, (word) => lockAnswer(word, false));

    const ASRClass = gameState.asrMode === 'webspeech' ? WebSpeechASR : DeepgramASR;
    activeASR = new ASRClass(
      item.shuffledOptions,
      (matched) => lockAnswer(matched, false),
      (text) => { $('transcriptPreview').textContent = 'Heard: "' + text + '"'; }
    );
    activeASR.start().catch(err => {
      console.warn('[maze] ASR start failed:', err.message);
      $('statusArea').textContent = 'Click your answer:';
    });

    startCountdown(ROUND_DURATION_MS, null, () => lockAnswer(null, true));
  } else {
    // Click-only mode
    $('statusArea').textContent = 'Click your answer:';
    renderOptions(item.shuffledOptions, true, (word) => lockAnswer(word, false));

    startCountdown(ROUND_DURATION_MS, null, () => lockAnswer(null, true));
  }
}


// ── Results screen ──

function showResults() {
  showScreen(resultsScreen);

  const correct = gameState.results.filter(r => r.correct).length;
  const total = gameState.results.length;
  $('resultsScore').textContent = `${correct} / ${total}`;

  const list = $('resultsList');
  list.innerHTML = '';
  gameState.results.forEach((r, i) => {
    const li = document.createElement('li');
    if (r.correct) {
      li.innerHTML = `<span class="icon">&#10003;</span> Round ${i + 1}: <span class="correct-word">"${r.targetWord}"</span>` +
        (r.chosen ? ` <span class="spoken">(said "${r.chosen}")</span>` : '');
    } else if (r.timedOut) {
      li.innerHTML = `<span class="icon">&#9201;</span> Round ${i + 1}: <span class="correct-word">"${r.targetWord}"</span> <span class="spoken">(timed out)</span>`;
    } else {
      li.innerHTML = `<span class="icon">&#10007;</span> Round ${i + 1}: <span class="correct-word">"${r.targetWord}"</span>` +
        (r.chosen ? ` <span class="spoken">(said "<span class="wrong-word">${r.chosen}</span>")</span>` : '');
    }
    list.appendChild(li);
  });

  saveMazeResults();
}

function saveMazeResults() {
  try {
    const STORAGE_KEY = 'orf_data';
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    const assessment = data.assessments.find(a => a.id === gameState.assessmentId);
    if (!assessment) return;

    assessment.mazeResults = {
      difficulty: gameState.difficulty,
      score: gameState.results.filter(r => r.correct).length,
      total: gameState.results.length,
      inputMode: gameState.asrMode,
      items: gameState.results,
      timestamp: new Date().toISOString()
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    console.log('[maze] Results saved to assessment', gameState.assessmentId);
  } catch (e) {
    console.warn('[maze] Failed to save results:', e.message);
  }
}


// ── Initialization ──

async function init() {
  const params = new URLSearchParams(window.location.search);
  gameState.studentId = params.get('student');
  gameState.assessmentId = params.get('assessment');
  gameState.difficulty = params.get('difficulty') || 'standard';

  if (!gameState.studentId || !gameState.assessmentId) {
    showError('Missing student or assessment ID. Please launch from the main page.');
    return;
  }

  // Load assessment data
  const assessment = getAssessment(gameState.assessmentId);
  if (!assessment) {
    showError('Assessment not found. It may have been deleted.');
    return;
  }

  // Get passage text from the assessment
  const passageText = getPassageText(assessment);
  if (!passageText || !canRunMaze(passageText)) {
    showError('Passage is too short for the maze game (need at least 15 words and 3 sentences).');
    return;
  }

  // Generate maze items
  const nlAnnotations = assessment.nlAnnotations || null;
  gameState.items = generateMazeItems(passageText, nlAnnotations, gameState.difficulty, gameState.assessmentId);

  if (gameState.items.length === 0) {
    showError('Could not generate maze items from this passage. Try a different difficulty.');
    return;
  }

  // Detect best available ASR engine
  gameState.asrMode = await detectASRMode();

  // Wire up buttons
  $('beginBtn').addEventListener('click', () => startRound());
  $('nextBtn').addEventListener('click', () => {
    gameState.currentRound++;
    if (gameState.currentRound < gameState.items.length) {
      startRound();
    } else {
      showResults();
    }
  });
  $('closeBtn').addEventListener('click', () => window.close());
  $('errorCloseBtn').addEventListener('click', () => window.close());

  showScreen(welcomeScreen);
}

/**
 * Get passage text from assessment data.
 * Primary: stored passageText. Fallback: reconstruct from alignment ref words.
 */
function getPassageText(assessment) {
  // Primary: full passage text stored with assessment
  if (assessment.passageText) return assessment.passageText;

  // Fallback: reconstruct from alignment reference words (loses punctuation)
  if (Array.isArray(assessment.alignment)) {
    const refWords = assessment.alignment
      .filter(item => item.ref && item.type !== 'insertion')
      .map(item => item.ref);
    if (refWords.length >= 15) return refWords.join(' ');
  }

  return null;
}

// Start the game
init();
