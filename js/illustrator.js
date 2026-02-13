// illustrator.js — Reading Illustrator: nouns become emoji stickers on a canvas scene
// Follows the same standalone-page pattern as maze-game.js

import { getAssessment } from './storage.js';
import NOUN_EMOJI from './noun-emoji-map.js';

// ── DOM refs ──

const $ = id => document.getElementById(id);
const introScreen = $('intro');
const sceneScreen = $('scene');
const resultsScreen = $('results');
const errorScreen = $('error');

// ── State ──

let state = {
  studentId: null,
  assessmentId: null,
  events: [],      // extracted noun events
  positions: [],   // computed layout positions
  engine: null,    // ReplayEngine instance
};


// ── Screen management ──

function showScreen(screenEl) {
  for (const s of document.querySelectorAll('.screen')) s.classList.remove('active');
  screenEl.classList.add('active');
}

function showError(msg) {
  $('errorMessage').textContent = msg;
  showScreen(errorScreen);
}


// ── Noun event extraction ──

function extractNounEvents(assessment) {
  const alignment = assessment.alignment;
  const sttWords = assessment.sttWords;
  if (!Array.isArray(alignment)) return [];

  // Check that NL annotations exist on at least one entry
  const hasNL = alignment.some(e => e.nl?.pos);
  if (!hasNL) return [];

  const events = [];
  for (let i = 0; i < alignment.length; i++) {
    const entry = alignment[i];
    if (entry.type === 'insertion') continue;
    if (!entry.nl || entry.nl.pos !== 'NOUN') continue;
    if (entry.nl.isProperNoun) continue;

    const lemma = (entry.nl.lemma || entry.ref || '').toLowerCase();
    const emoji = NOUN_EMOJI[lemma] || '\u2753';
    const wasOmitted = entry.type === 'omission';

    let timestampSec = null;
    if (!wasOmitted && sttWords && entry.hypIndex != null && sttWords[entry.hypIndex]) {
      timestampSec = sttWords[entry.hypIndex].startTime ?? null;
    }

    events.push({
      noun: entry._displayRef || entry.ref,
      lemma,
      emoji,
      timestampSec,
      wasOmitted,
      refIndex: i,
    });
  }

  return events;
}


// ── Layout computation ──

function computeLayout(events, width, height) {
  const n = events.length;
  if (n === 0) return [];

  const aspect = width / height;
  const cols = Math.ceil(Math.sqrt(n * aspect));
  const rows = Math.ceil(n / cols);
  const cellW = width / cols;
  const cellH = height / rows;
  // Keep stickers away from edges
  const padX = cellW * 0.15;
  const padY = cellH * 0.15;

  const positions = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    // Deterministic jitter seeded by refIndex
    const seed = events[i].refIndex;
    const jx = ((seed * 7 + 13) % 31) / 31 - 0.5; // -0.5 to 0.5
    const jy = ((seed * 11 + 17) % 29) / 29 - 0.5;
    const cx = cellW * (col + 0.5) + jx * (cellW - 2 * padX) * 0.4;
    const cy = cellH * (row + 0.5) + jy * (cellH - 2 * padY) * 0.4;
    // Convert to percentage
    positions.push({
      left: (cx / width) * 100,
      top: (cy / height) * 100,
    });
  }
  return positions;
}


// ── Scene building ──

function buildScene(container, events, positions) {
  container.innerHTML = '';
  const stickers = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const pos = positions[i];
    const div = document.createElement('div');
    div.className = 'sticker';
    div.style.left = pos.left + '%';
    div.style.top = pos.top + '%';
    div.style.transform = 'translate(-50%, -50%) scale(0)';

    const emojiSpan = document.createElement('span');
    emojiSpan.className = 'sticker-emoji' + (ev.emoji === '\u2753' ? ' unknown' : '');
    emojiSpan.textContent = ev.emoji;

    const labelSpan = document.createElement('span');
    labelSpan.className = 'sticker-label';
    labelSpan.textContent = ev.noun;

    div.appendChild(emojiSpan);
    div.appendChild(labelSpan);
    container.appendChild(div);
    stickers.push(div);
  }
  return stickers;
}


// ── Pop sound via Web Audio API ──

let audioCtx = null;
function playPopSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.08);
    osc.frequency.exponentialRampToValueAtTime(600, audioCtx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.2);
  } catch { /* ignore */ }
}


// ── Replay Engine ──

class ReplayEngine {
  constructor(events, stickers, onProgress, onComplete) {
    this.events = events;
    this.stickers = stickers;
    this.onProgress = onProgress;
    this.onComplete = onComplete;
    this.speed = 1;
    this.playing = false;
    this.currentIndex = 0;
    this.timerId = null;

    // Build schedule: spoken events sorted by timestamp, then omitted events at end
    const spoken = events
      .map((ev, i) => ({ ...ev, idx: i }))
      .filter(ev => !ev.wasOmitted)
      .sort((a, b) => (a.timestampSec ?? 0) - (b.timestampSec ?? 0));
    const omitted = events
      .map((ev, i) => ({ ...ev, idx: i }))
      .filter(ev => ev.wasOmitted);
    this.schedule = [...spoken, ...omitted];

    // Compute delays between reveals
    this.delays = [];
    for (let i = 0; i < this.schedule.length; i++) {
      if (i === 0) {
        this.delays.push(300); // initial delay
        continue;
      }
      const prev = this.schedule[i - 1];
      const curr = this.schedule[i];
      if (curr.wasOmitted) {
        this.delays.push(800);
      } else if (prev.timestampSec != null && curr.timestampSec != null) {
        const gap = (curr.timestampSec - prev.timestampSec) * 1000;
        this.delays.push(Math.max(200, Math.min(3000, gap)));
      } else {
        this.delays.push(800); // fallback slideshow
      }
    }
  }

  play() {
    if (this.currentIndex >= this.schedule.length) return;
    this.playing = true;
    this._scheduleNext();
  }

  pause() {
    this.playing = false;
    clearTimeout(this.timerId);
    this.timerId = null;
  }

  setSpeed(s) {
    this.speed = s;
    if (this.playing) {
      clearTimeout(this.timerId);
      this._scheduleNext();
    }
  }

  _scheduleNext() {
    if (!this.playing || this.currentIndex >= this.schedule.length) {
      if (this.currentIndex >= this.schedule.length) {
        this.playing = false;
        this.onComplete();
      }
      return;
    }

    const delay = this.delays[this.currentIndex] / this.speed;
    this.timerId = setTimeout(() => {
      this._revealCurrent();
      this.currentIndex++;
      this.onProgress(this.currentIndex, this.schedule.length);
      this._scheduleNext();
    }, delay);
  }

  _revealCurrent() {
    const item = this.schedule[this.currentIndex];
    const sticker = this.stickers[item.idx];
    if (!sticker) return;

    if (item.wasOmitted) {
      sticker.classList.add('omitted');
      sticker.querySelector('.sticker-label').classList.add('show');
    } else {
      sticker.classList.add('pop-in');
      playPopSound();
    }
  }

  reset() {
    this.pause();
    this.currentIndex = 0;
    for (const s of this.stickers) {
      s.classList.remove('pop-in', 'omitted', 'visible');
      s.style.transform = 'translate(-50%, -50%) scale(0)';
      s.style.opacity = '0';
      s.querySelector('.sticker-label').classList.remove('show');
    }
  }
}


// ── Results ──

function showResults(events, positions) {
  showScreen(resultsScreen);

  // Build results scene with all stickers visible and labeled
  const container = $('resultsSceneArea');
  const stickers = buildScene(container, events, positions);
  for (let i = 0; i < events.length; i++) {
    const s = stickers[i];
    s.querySelector('.sticker-label').classList.add('show');
    if (events[i].wasOmitted) {
      s.classList.add('omitted');
    } else {
      s.classList.add('visible');
    }
  }

  // Score
  const spoken = events.filter(e => !e.wasOmitted).length;
  const total = events.length;
  $('resultsScore').textContent = `${spoken} / ${total} nouns illustrated`;

  // Missing list
  const missing = events.filter(e => e.wasOmitted);
  if (missing.length > 0) {
    $('missingNouns').textContent = 'Missing: ' + missing.map(e => e.noun).join(', ');
  } else {
    $('missingNouns').textContent = '';
  }
}


// ── Save results ──

function saveIllustratorResults(assessmentId, events) {
  try {
    const STORAGE_KEY = 'orf_data';
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    const assessment = data.assessments.find(a => a.id === assessmentId);
    if (!assessment) return;

    const spoken = events.filter(e => !e.wasOmitted);
    assessment.illustratorResults = {
      score: spoken.length,
      total: events.length,
      spokenNouns: spoken.map(e => e.noun),
      omittedNouns: events.filter(e => e.wasOmitted).map(e => e.noun),
      timestamp: new Date().toISOString(),
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    console.log('[illustrator] Results saved to assessment', assessmentId);
  } catch (e) {
    console.warn('[illustrator] Failed to save results:', e.message);
  }
}


// ── Initialization ──

function init() {
  const params = new URLSearchParams(window.location.search);
  state.studentId = params.get('student');
  state.assessmentId = params.get('assessment');

  if (!state.studentId || !state.assessmentId) {
    showError('Missing student or assessment ID. Please launch from the main page.');
    return;
  }

  const assessment = getAssessment(state.assessmentId);
  if (!assessment) {
    showError('Assessment not found. It may have been deleted.');
    return;
  }

  state.events = extractNounEvents(assessment);
  if (state.events.length < 2) {
    showError('Not enough nouns found in this passage for the illustrator (need at least 2).');
    return;
  }

  // Compute layout based on a reference 4:3 area
  state.positions = computeLayout(state.events, 400, 300);

  // Wire up intro button
  $('buildBtn').addEventListener('click', () => startReplay());

  // Wire up close/replay buttons
  $('closeBtn').addEventListener('click', () => window.close());
  $('errorCloseBtn').addEventListener('click', () => window.close());
  $('replayBtn').addEventListener('click', () => startReplay());

  // Wire up speed buttons
  for (const btn of document.querySelectorAll('.speed-btn')) {
    btn.addEventListener('click', () => {
      for (const b of document.querySelectorAll('.speed-btn')) b.classList.remove('active');
      btn.classList.add('active');
      const speed = parseFloat(btn.dataset.speed);
      if (state.engine) state.engine.setSpeed(speed);
    });
  }

  showScreen(introScreen);
}


// ── Start / restart replay ──

function startReplay() {
  showScreen(sceneScreen);

  const container = $('sceneArea');
  const stickers = buildScene(container, state.events, state.positions);
  $('progressLabel').textContent = `0 / ${state.events.length} nouns`;
  $('timelineBar').style.width = '0%';

  // Reset play/pause UI
  $('playIcon').style.display = '';
  $('pauseIcon').style.display = 'none';

  // Get current speed selection
  const activeSpeedBtn = document.querySelector('.speed-btn.active');
  const speed = activeSpeedBtn ? parseFloat(activeSpeedBtn.dataset.speed) : 1;

  state.engine = new ReplayEngine(
    state.events,
    stickers,
    (current, total) => {
      $('progressLabel').textContent = `${current} / ${total} nouns`;
      $('timelineBar').style.width = (current / total * 100) + '%';
    },
    () => {
      // On complete
      $('playIcon').style.display = '';
      $('pauseIcon').style.display = 'none';
      saveIllustratorResults(state.assessmentId, state.events);
      // Brief pause then show results
      setTimeout(() => showResults(state.events, state.positions), 1200);
    }
  );
  state.engine.setSpeed(speed);

  // Wire play/pause
  const ppBtn = $('playPauseBtn');
  const newBtn = ppBtn.cloneNode(true);
  ppBtn.parentNode.replaceChild(newBtn, ppBtn);
  newBtn.addEventListener('click', () => {
    if (state.engine.playing) {
      state.engine.pause();
      newBtn.querySelector('.play-icon').style.display = '';
      newBtn.querySelector('.pause-icon').style.display = 'none';
    } else {
      state.engine.play();
      newBtn.querySelector('.play-icon').style.display = 'none';
      newBtn.querySelector('.pause-icon').style.display = '';
    }
  });

  // Auto-start after short delay
  setTimeout(() => {
    state.engine.play();
    newBtn.querySelector('.play-icon').style.display = 'none';
    newBtn.querySelector('.pause-icon').style.display = '';
  }, 500);
}


// ── Boot ──
init();
