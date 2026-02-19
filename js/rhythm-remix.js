/**
 * Rhythm Remix — bouncing-ball reading playback with lo-fi beats.
 *
 * Orchestrates word synchronization, bouncing ball animation on canvas,
 * audio playback of the student's recording, and lo-fi beat integration.
 *
 * @module rhythm-remix
 */

import { LofiEngine } from './lofi-engine.js?v=20260219a5';
import { LofiV2Engine } from './lofi-v2-engine.js?v=20260219a5';
import { StickerbrushEngine } from './stickerbrush-engine.js?v=20260219a5';
import { StickerbrushV2Engine } from './stickerbrush-v2-engine.js?v=20260219a5';
import { MythicEngine } from './mythic-engine.js?v=20260219a6';
import { MountainRange } from './mountain-range.js?v=20260219a5';
import { getAudioBlob } from './audio-store.js';
import { getAssessment, getStudents } from './storage.js';
import { getPunctuationPositions } from './diagnostics.js';

// ── Constants ────────────────────────────────────────────────────────────────

const DISFLUENCIES = new Set(['um', 'uh', 'uh-huh', 'mm', 'hmm', 'er', 'ah']);

const SPRING_STIFFNESS = 300;
const SPRING_DAMPING = 15;
const MAX_TRAIL_POINTS = 15;
const BALL_BASE_RADIUS = 10;

/** Word-type color palette (lo-fi warm tones). */
const WORD_COLORS = {
  correct:        '#a8d8a8', // soft green
  substitution:   '#e8a87c', // warm amber
  omission:       '#c4b5d4', // muted purple
  struggle:       '#e8a87c', // amber (same family)
  default:        '#e8a87c', // amber fallback
};

const PARTICLE_POOL_MAX = 30;

// ── Timestamp parser ─────────────────────────────────────────────────────────

function parseTime(t) {
  if (typeof t === 'number') return t;
  if (!t) return 0;
  if (typeof t === 'object' && t.seconds !== undefined) {
    return Number(t.seconds || 0) + Number(t.nanos || 0) / 1e9;
  }
  return parseFloat(String(t).replace('s', '')) || 0;
}

// ── Reduced-motion detection ─────────────────────────────────────────────────

const prefersReducedMotion =
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── State ────────────────────────────────────────────────────────────────────

let wordSequence = [];   // { text, type, startTime, endTime, el, isStruggle, isOmission, forgiven }
let wordRects = [];      // cached positions relative to ball-canvas
let currentWordIdx = -1;
let previousWordIdx = -1;

/** Teleprompter: 2-line scrolling window. */
let lineGroups = [];     // array of arrays: lineGroups[lineIdx] = [wordIdx, ...]
let currentLinePair = 0; // which pair of lines is visible (0 = lines 0-1, 1 = lines 2-3, ...)

let audioCtx = null;
let lofi = null;          // active engine
let lofiEngine = null;    // cached LofiEngine instance (handles classical)
let lofi2Engine = null;   // cached LofiV2Engine instance
let stickerbrushEngine = null; // cached StickerbrushEngine
let stickerbrush2Engine = null; // cached StickerbrushV2Engine
let mythicEngine = null; // cached MythicEngine
let audioEl = null;
let audioUrl = null;     // ObjectURL — revoked on cleanup
let sourceNode = null;
let voiceGain = null;
let beatGain = null;
let waveformFrameSkip = 0; // throttle waveform to every 3rd frame

let animFrameId = null;
let isPlaying = false;
let lastFrameTime = 0;

let ballCanvas = null;
let ballCtx = null;

/** Mountain range / waveform visualization. */
let mountainRange = null;

/** Decoded audio data for waveform visualization (survives replay). */
let waveformChannelData = null;
let waveformDuration = 0;

/** Assessment data loaded at init. */
let assessment = null;

/** Pause-reactive beat state. */
let inPause = false;
let savedDensity = 'normal'; // density to restore after pause ends

/** Sentence-aligned chord toggle state. */
let sentenceAlignedEnabled = false;

/** Toggle states for new features (all default OFF). */
let celebrationsEnabled = false;
let melodyEnabled = false;
let adaptiveHarmonyEnabled = false;

let playbackRate = 1;          // from speed selector

/** Overlay streak: correct words in a row → richer beat. */
let correctStreak = 0;

/** Adaptive harmony: rolling fluency window. */
const HARMONY_WINDOW = 12;
let harmonyHistory = []; // recent word results: true = correct, false = error

/** Study Beats FM — DJ intro state. */
const GEMINI_TTS_MODEL = 'gemini-2.5-flash-preview-tts';
const GEMINI_TTS_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent`;
const DJ_VOICE = 'Kore'; // Upbeat, confident, punchy delivery
let djIntroBuffer = null; // decoded AudioBuffer from Gemini TTS
let djIntroLoading = false;
let djIntroPlayed = false;
let djSourceNode = null;
let djGainNode = null;

// ── Ball state ───────────────────────────────────────────────────────────────

const ball = {
  x: 0,
  y: 0,
  targetX: 0,
  targetY: 0,
  radius: BALL_BASE_RADIUS,
  color: WORD_COLORS.default,
  glowColor: WORD_COLORS.default,
  phase: 'idle',       // idle | traveling | landing | dwelling | wobbling
  springY: 0,
  springVel: 0,
  wobbleTime: 0,
  trailPoints: [],
  // Bezier travel state
  travelStartX: 0,
  travelStartY: 0,
  travelEndX: 0,
  travelEndY: 0,
  travelStart: 0,      // audioCtx time
  travelDuration: 0.15,
};

// ── Particles ────────────────────────────────────────────────────────────────

let particles = [];

function spawnParticles(x, y, color, count, opts) {
  const { vx = 0, vy = -60, spread = 40, life = 0.6, size = 3 } = opts || {};
  for (let i = 0; i < count; i++) {
    if (particles.length >= PARTICLE_POOL_MAX) break;
    particles.push({
      x, y,
      vx: vx + (Math.random() - 0.5) * spread,
      vy: vy + (Math.random() - 0.5) * spread * 0.5,
      life,
      maxLife: life,
      size: size * (0.6 + Math.random() * 0.8),
      color,
    });
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 40 * dt; // gentle gravity
    p.life -= dt;
    if (p.life <= 0) {
      particles.splice(i, 1);
    }
  }
}

function drawParticles(ctx) {
  for (const p of particles) {
    const alpha = Math.max(0, p.life / p.maxLife) * 0.8;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ── Bezier arc utility ───────────────────────────────────────────────────────

function bezierArc(p0x, p0y, p1x, p1y, t) {
  const cpx = (p0x + p1x) / 2;
  const dist = Math.abs(p1x - p0x);
  const arcHeight = Math.min(dist * 0.5, 80);
  const cpy = Math.min(p0y, p1y) - arcHeight - 20; // always arc upward

  const mt = 1 - t;
  return {
    x: mt * mt * p0x + 2 * mt * t * cpx + t * t * p1x,
    y: mt * mt * p0y + 2 * mt * t * cpy + t * t * p1y,
  };
}

// ── Rainbow color utility ────────────────────────────────────────────────

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
}

// ── Spring physics ───────────────────────────────────────────────────────────

function updateSpring(dt) {
  const force = -SPRING_STIFFNESS * ball.springY - SPRING_DAMPING * ball.springVel;
  ball.springVel += force * dt;
  ball.springY += ball.springVel * dt;
  if (Math.abs(ball.springY) < 0.1 && Math.abs(ball.springVel) < 0.1) {
    ball.springY = 0;
    ball.springVel = 0;
  }
}

// ── WPM to BPM mapping ──────────────────────────────────────────────────────

// Per-style BPM ranges — each genre has a natural tempo sweet spot.
// WCPM is sqrt-compressed into the style's range so slow readers get the low end
// and fast readers get the high end, but nobody leaves the genre's comfort zone.
const STYLE_BPM_RANGE = {
  classical:     { min: 50, max: 78 },   // Satie-like, contemplative
  lofi2:         { min: 55, max: 84 },    // Lo-Fi V2, warm and chill
  stickerbrush:  { min: 70, max: 100 },   // DKC2 dreamy, original 94 BPM
  stickerbrush2: { min: 70, max: 100 },   // DKC2 A-minor arr., original 95 BPM
  mythic:        { min: 70, max: 105 },   // Aruarian-style, original 90 BPM
};

function wcpmToBpm(wcpm, style) {
  const range = STYLE_BPM_RANGE[style] || STYLE_BPM_RANGE.stickerbrush;
  // sqrt compression: normalize WCPM 20–200 to 0–1, then sqrt to compress top end
  const t = Math.min(1, Math.max(0, Math.sqrt((wcpm - 20) / 180)));
  return Math.round(range.min + t * (range.max - range.min));
}

// ── Engine switching ─────────────────────────────────────────────────────────

function switchEngine(style) {
  const wasPlaying = lofi && lofi.isPlaying;

  // Stop current engine if switching
  if (lofi && wasPlaying) lofi.stop();

  if (style === 'lofi2') {
    if (!lofi2Engine) {
      lofi2Engine = new LofiV2Engine(audioCtx);
      lofi2Engine.output.connect(beatGain);
    }
    lofi2Engine._style = 'lofi2';
    lofi = lofi2Engine;
  } else if (style === 'stickerbrush') {
    if (!stickerbrushEngine) {
      stickerbrushEngine = new StickerbrushEngine(audioCtx);
      stickerbrushEngine.output.connect(beatGain);
    }
    lofi = stickerbrushEngine;
  } else if (style === 'stickerbrush2') {
    if (!stickerbrush2Engine) {
      stickerbrush2Engine = new StickerbrushV2Engine(audioCtx);
      stickerbrush2Engine.output.connect(beatGain);
    }
    lofi = stickerbrush2Engine;
  } else if (style === 'mythic') {
    if (!mythicEngine) {
      mythicEngine = new MythicEngine(audioCtx);
      mythicEngine.output.connect(beatGain);
    }
    lofi = mythicEngine;
  } else {
    lofiEngine.setStyle(style);
    lofi = lofiEngine;
  }

  // Resume playback if it was playing
  if (wasPlaying) lofi.start();
}

// ── Overlay streak — correct words build richer beat ─────────────────────────

/**
 * Update overlay level based on correct-word streak.
 * Level 0: <3 correct   — base beat
 * Level 1: 3+ correct   — overlay 0.35 (extra drums + chord doublings)
 * Level 2: 6+ correct   — overlay 0.65 (thicker chords + shaker)
 * Level 3: 9+ correct   — overlay 1.0  (full: extended chords + dense drums)
 * Level 4: 12+ correct  — overlay 1.5  (double density: maximum musical depth)
 */
function updateOverlayStreak(w) {
  if (!lofi) return;
  const isCorrect = (w.type === 'correct' || w.forgiven) && !w.isOmission;
  if (isCorrect) {
    correctStreak++;
  } else {
    correctStreak = 0;
  }
  let level = 0;
  if (correctStreak >= 12) level = 1.5;
  else if (correctStreak >= 9) level = 1.0;
  else if (correctStreak >= 6) level = 0.65;
  else if (correctStreak >= 3) level = 0.35;
  lofi.setOverlayLevel(level);
}

// ── Study Beats FM — DJ Intro via Gemini TTS ────────────────────────────────

function buildDJPrompt(studentName) {
  const name = studentName || 'our next reader';
  return (
    `You're a laid-back late-night radio DJ. Say this line smooth and chill — ` +
    `relaxed, warm, like you're smiling. Not hyped, not whispered. ` +
    `Quick and easy, under 3 seconds.\n\n` +
    `"Study Beats FM... ${name}."`
  );
}

async function fetchDJIntro(studentName) {
  const apiKey = localStorage.getItem('orf_gemini_key') || '';
  if (!apiKey) {
    console.log('[StudyBeatsFM] No Gemini API key — skipping DJ intro');
    return null;
  }

  const text = buildDJPrompt(studentName);
  console.log('[StudyBeatsFM] Generating DJ intro:', text);

  const body = JSON.stringify({
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: DJ_VOICE }
        }
      }
    }
  });

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resp = await fetch(GEMINI_TTS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body,
      });

      if (!resp.ok) {
        if (resp.status === 429) {
          console.warn('[StudyBeatsFM] Quota exceeded — skipping DJ intro');
          return null;
        }
        if ((resp.status === 500 || resp.status === 503) && attempt < 2) {
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        console.warn('[StudyBeatsFM] TTS error:', resp.status);
        return null;
      }

      const data = await resp.json();
      if (data.promptFeedback?.blockReason) {
        console.warn('[StudyBeatsFM] Prompt blocked:', data.promptFeedback.blockReason);
        return null;
      }

      const audioPart = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
      if (!audioPart) {
        console.warn('[StudyBeatsFM] No audio in response. Keys:', JSON.stringify(Object.keys(data)));
        if (data.candidates?.[0]) console.warn('[StudyBeatsFM] Candidate parts:', JSON.stringify(data.candidates[0].content?.parts?.map(p => Object.keys(p))));
        return null;
      }

      // Decode base64 L16 PCM → WAV ArrayBuffer
      const b64 = audioPart.inlineData.data;
      const binary = atob(b64);
      const pcmBytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) pcmBytes[i] = binary.charCodeAt(i);

      const sampleRate = 24000;
      const dataSize = pcmBytes.length;
      const wavBuf = new ArrayBuffer(44 + dataSize);
      const view = new DataView(wavBuf);
      const wr = (off, s) => { for (let ci = 0; ci < s.length; ci++) view.setUint8(off + ci, s.charCodeAt(ci)); };
      wr(0, 'RIFF');
      view.setUint32(4, 36 + dataSize, true);
      wr(8, 'WAVE');
      wr(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      wr(36, 'data');
      view.setUint32(40, dataSize, true);
      new Uint8Array(wavBuf, 44).set(pcmBytes);

      return wavBuf;
    } catch (err) {
      console.warn('[StudyBeatsFM] fetch error:', err);
      if (attempt < 2) continue;
      return null;
    }
  }
  return null;
}

/**
 * Play the DJ intro over the lo-fi beat, then start the student audio.
 */
function playDJIntroThenReading() {
  if (!djIntroBuffer || !audioCtx || djIntroPlayed) {
    // No DJ intro available or already played — start reading immediately
    startReadingPlayback();
    return;
  }

  djIntroPlayed = true;

  // Decode the WAV buffer
  audioCtx.decodeAudioData(djIntroBuffer.slice(0)).then(decoded => {
    // Play DJ voice through a dedicated gain node
    djSourceNode = audioCtx.createBufferSource();
    djSourceNode.buffer = decoded;
    djGainNode = audioCtx.createGain();
    djGainNode.gain.value = 0.35; // DJ voice well behind the beat
    djSourceNode.connect(djGainNode);
    djGainNode.connect(audioCtx.destination);

    // Duck the beat volume during DJ intro
    if (beatGain) {
      beatGain.gain.setValueAtTime(0.25, audioCtx.currentTime);
      beatGain.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + decoded.duration + 0.3);
    }

    // Update status
    const status = document.getElementById('remix-status');
    if (status) status.textContent = 'Study Beats FM';

    djSourceNode.start(audioCtx.currentTime);

    // Run chord badge during DJ intro
    let djVizId = null;
    function djVizLoop() {
      updateChordBadge();
      djVizId = requestAnimationFrame(djVizLoop);
    }
    djVizId = requestAnimationFrame(djVizLoop);

    // When DJ intro ends, start the student reading
    djSourceNode.onended = () => {
      djSourceNode = null;
      if (djVizId) cancelAnimationFrame(djVizId);
      if (status) status.textContent = '';
      // Small pause after DJ intro
      setTimeout(() => {
        startReadingPlayback();
      }, 400);
    };
  }).catch(err => {
    console.warn('[StudyBeatsFM] Failed to decode DJ audio:', err);
    startReadingPlayback();
  });
}

/**
 * Start the actual student reading playback (audio + animation loop).
 */
function startReadingPlayback() {
  if (!audioEl) return;
  correctStreak = 0;    // reset overlay streak
  currentLinePair = 0;  // reset teleprompter scroll
  const wa = document.getElementById('word-area');
  if (wa) wa.scrollTop = 0;
  audioEl.play().then(() => {
    isPlaying = true;
    setVinylPlaying(true);
    const playIcon = document.getElementById('playIcon');
    const pauseIcon = document.getElementById('pauseIcon');
    if (playIcon) playIcon.style.display = 'none';
    if (pauseIcon) pauseIcon.style.display = '';

    cacheWordRects();
    lastFrameTime = 0;
    if (!animFrameId) animFrameId = requestAnimationFrame(animationLoop);
  }).catch(err => {
    console.warn('Playback failed:', err);
  });
}

// ── Word rect caching ────────────────────────────────────────────────────────

function cacheWordRects() {
  if (!ballCanvas) return;
  const canvasRect = ballCanvas.getBoundingClientRect();
  wordRects = wordSequence.map(w => {
    if (!w.el) return null;
    const r = w.el.getBoundingClientRect();
    return {
      cx: r.left - canvasRect.left + r.width / 2,
      top: r.top - canvasRect.top,
      cy: r.top - canvasRect.top - 15,
      w: r.width,
      h: r.height,
    };
  });
}

// ── Teleprompter: line detection & scrolling ─────────────────────────────────

/**
 * Scan word element positions and group into visual lines.
 * Words sharing the same Y position (±4px) belong to the same line.
 */
function detectLines() {
  lineGroups = [];
  if (wordSequence.length === 0) return;

  let currentLineTop = -Infinity;
  for (let i = 0; i < wordSequence.length; i++) {
    const el = wordSequence[i].el;
    if (!el) continue;
    const top = el.offsetTop;
    if (Math.abs(top - currentLineTop) > 4) {
      lineGroups.push([i]);
      currentLineTop = top;
    } else {
      lineGroups[lineGroups.length - 1].push(i);
    }
  }
}

/**
 * Get the line index for a given word index.
 */
function getLineForWord(wordIdx) {
  for (let l = 0; l < lineGroups.length; l++) {
    const group = lineGroups[l];
    if (wordIdx >= group[0] && wordIdx <= group[group.length - 1]) return l;
  }
  return -1;
}

/**
 * Set word area height to show exactly 2 lines with overflow hidden.
 */
function setupTeleprompterHeight() {
  const wordArea = document.getElementById('word-area');
  if (!wordArea || lineGroups.length === 0) return;

  const firstEl = wordSequence[0] && wordSequence[0].el;
  if (!firstEl) return;
  const style = getComputedStyle(wordArea);
  const padTop = parseFloat(style.paddingTop) || 0;
  const padBottom = parseFloat(style.paddingBottom) || 0;

  // Measure height of 2 lines: from top of line 0 to bottom of line 1
  const line0Top = firstEl.offsetTop;
  let line1Bottom;
  if (lineGroups.length >= 2) {
    const lastIdx = lineGroups[1][lineGroups[1].length - 1];
    const el1 = wordSequence[lastIdx] && wordSequence[lastIdx].el;
    line1Bottom = el1 ? (el1.offsetTop + el1.offsetHeight) : (line0Top + 80);
  } else {
    const lastIdx = lineGroups[0][lineGroups[0].length - 1];
    const el0 = wordSequence[lastIdx] && wordSequence[lastIdx].el;
    line1Bottom = el0 ? (el0.offsetTop + el0.offsetHeight) : (line0Top + 40);
  }

  const twoLineHeight = (line1Bottom - line0Top) + padTop + padBottom;
  wordArea.style.height = twoLineHeight + 'px';
  wordArea.style.minHeight = twoLineHeight + 'px';
  wordArea.style.overflow = 'hidden';

  currentLinePair = 0;
  wordArea.scrollTop = 0;
}

/**
 * Scroll to the correct line pair when the ball enters a new 2-line group.
 */
function teleprompterScroll(wordIdx) {
  if (lineGroups.length <= 2) return;
  const wordArea = document.getElementById('word-area');
  if (!wordArea) return;

  const lineIdx = getLineForWord(wordIdx);
  if (lineIdx < 0) return;

  const pairForLine = Math.floor(lineIdx / 2);
  if (pairForLine === currentLinePair) return;

  currentLinePair = pairForLine;
  const targetLineIdx = pairForLine * 2;
  if (targetLineIdx >= lineGroups.length) return;

  const firstWordIdx = lineGroups[targetLineIdx][0];
  const firstEl = wordSequence[firstWordIdx] && wordSequence[firstWordIdx].el;
  if (!firstEl) return;

  const padTop = parseFloat(getComputedStyle(wordArea).paddingTop) || 0;
  const targetScroll = firstEl.offsetTop - padTop;

  // Instant scroll + immediate re-cache so ball targets are correct
  wordArea.scrollTop = targetScroll;
  cacheWordRects();
  sizeCanvas();
}

// ── Canvas sizing ────────────────────────────────────────────────────────────

function sizeCanvas() {
  if (!ballCanvas) return;
  const wrapper = ballCanvas.parentElement;
  const rect = wrapper.getBoundingClientRect();
  ballCanvas.width = rect.width;
  ballCanvas.height = rect.height;
}

// ── Audio setup (lazy, first interaction) ────────────────────────────────────

function setupAudio() {
  if (audioCtx) return; // already initialized

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  audioCtx.resume();

  // Voice chain: audioElement -> mediaElementSource -> voiceGain -> destination
  voiceGain = audioCtx.createGain();
  voiceGain.gain.value = 0.65;
  voiceGain.connect(audioCtx.destination);

  // Beat chain: lofiEngine.output -> beatGain -> destination
  beatGain = audioCtx.createGain();
  beatGain.gain.value = 0.60;
  beatGain.connect(audioCtx.destination);

  // Lo-fi engine (handles classical style)
  lofiEngine = new LofiEngine(audioCtx);
  lofiEngine.output.connect(beatGain);

  // Apply default-on toggle states
  lofiEngine.setCelebrations(celebrationsEnabled);
  lofiEngine.setMelody(melodyEnabled);
  lofiEngine.setAdaptiveHarmony(adaptiveHarmonyEnabled);

  // Set style from localStorage preference
  const validStyles = ['stickerbrush', 'stickerbrush2', 'lofi2', 'classical', 'mythic'];
  const savedStyle = localStorage.getItem('orf_remix_style');
  const initialStyle = (savedStyle && validStyles.includes(savedStyle)) ? savedStyle : 'stickerbrush';

  // Activate the correct engine
  switchEngine(initialStyle);

  const sel = document.getElementById('styleSelect');
  if (sel && savedStyle && validStyles.includes(savedStyle)) sel.value = savedStyle;

  // Set tempo from assessment WCPM, mapped to the style's natural BPM range
  const activeStyle = lofi._style || initialStyle;
  if (assessment && assessment.wcpm) {
    lofi.setTempo(wcpmToBpm(assessment.wcpm, activeStyle));
  } else {
    lofi.setTempo(72);
  }

  // Connect audio element through Web Audio
  sourceNode = audioCtx.createMediaElementSource(audioEl);
  sourceNode.connect(voiceGain);
}

// ── Find current word by audio timestamp ─────────────────────────────────────

function findCurrentWord(ct) {
  // Exact hit: startTime <= ct < endTime
  for (let i = 0; i < wordSequence.length; i++) {
    const w = wordSequence[i];
    if (w.startTime < 0) continue; // omission
    if (ct >= w.startTime && ct < w.endTime) return i;
  }
  // Between words: find the most recent spoken word we passed
  for (let i = wordSequence.length - 1; i >= 0; i--) {
    const w = wordSequence[i];
    if (w.startTime < 0) continue;
    if (ct >= w.endTime) return i;
  }
  // Before any word: check if we're approaching the first spoken word
  for (let i = 0; i < wordSequence.length; i++) {
    const w = wordSequence[i];
    if (w.startTime < 0) continue;
    if (ct < w.startTime) return -1; // not yet
    break;
  }
  return -1;
}

// ── Word change handler ──────────────────────────────────────────────────────

function onWordChange(fromIdx, toIdx) {
  if (toIdx < 0 || toIdx >= wordSequence.length) return;

  previousWordIdx = fromIdx;
  const w = wordSequence[toIdx];

  // Sentence-aligned chord: advance when leaving a sentence-final word
  if (sentenceAlignedEnabled && lofi && fromIdx >= 0) {
    const prev = wordSequence[fromIdx];
    if (prev && prev.sentenceFinal) {
      lofi.advanceChord();
      // Celebration: sentence end
      if (lofi) lofi.notifyWordEvent('sentence-end');
    }
  }

  // ── Reactive crackle: always on ──
  if (lofi) {
    const isError = w.isOmission || w.isStruggle || (w.type === 'substitution' && !w.forgiven);
    if (w.isStruggle) {
      lofi.setCrackleIntensity('heavy');
      lofi.playRecordSkip();
    } else if (isError) {
      lofi.setCrackleIntensity('medium');
    } else {
      lofi.setCrackleIntensity('light');
    }
  }

  // ── Micro-celebrations ──
  if (lofi) {
    const isCorrect = (w.type === 'correct' || w.forgiven) && !w.isOmission;
    if (w.isOmission) {
      lofi.notifyWordEvent('omission');
    } else if (w.isStruggle || (w.type === 'substitution' && !w.forgiven)) {
      lofi.notifyWordEvent('error');
    } else if (isCorrect) {
      lofi.notifyWordEvent('correct');
    }
  }

  // ── Melodic contour: map word to pitch ──
  if (lofi && melodyEnabled) {
    const isError = w.isOmission || w.isStruggle || (w.type === 'substitution' && !w.forgiven);
    // Estimate speed tier from gap and duration
    let tier = 'steady';
    if (!w.isOmission && w.startTime > 0 && w.endTime > 0) {
      const dur = w.endTime - w.startTime;
      if (dur < 0.2) tier = 'quick';
      else if (dur < 0.4) tier = 'steady';
      else if (dur < 0.8) tier = 'slow';
      else if (dur < 1.5) tier = 'very-slow';
      else tier = 'slowest';
    }
    if (!w.isOmission) {
      lofi.playMelodicPing(tier, isError);
    }
  }

  // ── Adaptive harmony: update fluency window ──
  if (lofi && adaptiveHarmonyEnabled) {
    const isCorrect = (w.type === 'correct' || w.forgiven) && !w.isOmission;
    harmonyHistory.push(isCorrect);
    if (harmonyHistory.length > HARMONY_WINDOW) harmonyHistory.shift();
    const fluency = harmonyHistory.filter(Boolean).length / harmonyHistory.length;
    lofi.setHarmonyMood(fluency);
  }

  // ── Overlay streak: correct words build richer beat ──
  updateOverlayStreak(w);

  // ── Teleprompter scroll (may re-cache wordRects) ──
  teleprompterScroll(toIdx);

  // ── Mountain range: reveal peak ──
  if (mountainRange) {
    mountainRange.revealPeak(toIdx, w);
  }
}

// ── Ball physics update ──────────────────────────────────────────────────────

function updateBallPhysics(dt) {
  const now = audioCtx ? audioCtx.currentTime : performance.now() / 1000;

  if (ball.phase === 'traveling') {
    const elapsed = now - ball.travelStart;
    const t = Math.min(elapsed / ball.travelDuration, 1);

    // Ease-out curve for smooth deceleration
    const eased = 1 - (1 - t) * (1 - t);

    if (prefersReducedMotion) {
      // Skip animation, jump directly
      ball.x = ball.travelEndX;
      ball.y = ball.travelEndY;
      ball.phase = 'landing';
    } else {
      const pos = bezierArc(
        ball.travelStartX, ball.travelStartY,
        ball.travelEndX, ball.travelEndY,
        eased
      );
      ball.x = pos.x;
      ball.y = pos.y;

      // Record trail
      ball.trailPoints.push({ x: ball.x, y: ball.y });
      if (ball.trailPoints.length > MAX_TRAIL_POINTS) {
        ball.trailPoints.shift();
      }
    }

    if (t >= 1) {
      ball.phase = 'landing';
    }
  }

  if (ball.phase === 'landing') {
    ball.x = ball.travelEndX;
    ball.y = ball.travelEndY;

    const w = currentWordIdx >= 0 ? wordSequence[currentWordIdx] : null;

    // Kick the spring for bounce
    if (w && (w.isStruggle || (w.type === 'substitution' && !w.forgiven))) {
      ball.springY = -20; // harder bounce for errors
    } else {
      ball.springY = -15;
    }
    ball.springVel = 0;

    // Spawn arrival particles
    if (!prefersReducedMotion && w) {
      if (w.selfCorrected) {
        // Rainbow burst — multiple colors radiating outward
        const rainbowHues = [0, 45, 120, 200, 280, 330];
        for (const hue of rainbowHues) {
          spawnParticles(ball.x, ball.y, hslToHex(hue, 85, 60), 1, { vy: -55, spread: 50, life: 0.7, size: 3 });
        }
        spawnParticles(ball.x, ball.y, WORD_COLORS.correct, 3, { vy: -40, spread: 30, life: 0.5, size: 2.5 });
      } else if (w.type === 'correct' || w.forgiven) {
        spawnParticles(ball.x, ball.y, WORD_COLORS.correct, 4, { vy: -50, spread: 30, life: 0.5, size: 2.5 });
      } else if (w.isStruggle || w.type === 'substitution') {
        spawnParticles(ball.x, ball.y, WORD_COLORS.struggle, 2, { vy: -30, spread: 15, life: 0.4, size: 2 });
      }
    }

    // Transition to dwell or wobble
    if (w && (w.isStruggle || (w.type === 'substitution' && !w.forgiven))) {
      ball.phase = 'wobbling';
      ball.wobbleTime = 0;
    } else {
      ball.phase = 'dwelling';
    }
  }

  if (ball.phase === 'dwelling' || ball.phase === 'wobbling') {
    updateSpring(dt);
    ball.y = ball.travelEndY + ball.springY;

    // Self-correction: rainbow color cycling over 0.8s then settle to green
    if (ball.scTransition && ball.phase === 'dwelling') {
      if (!ball.scTransitionStart) ball.scTransitionStart = now;
      const elapsed = now - ball.scTransitionStart;
      if (elapsed < 0.8) {
        const hue = (elapsed / 0.8) * 360;
        ball.color = hslToHex(hue % 360, 85, 60);
        ball.glowColor = hslToHex(hue % 360, 85, 50);
      } else {
        ball.color = WORD_COLORS.correct;
        ball.glowColor = WORD_COLORS.correct;
        ball.scTransition = false;
        ball.scTransitionStart = 0;
      }
    }

    // Horizontal wobble for error/struggle words
    if (ball.phase === 'wobbling' && !prefersReducedMotion) {
      const wobbleDecay = Math.max(0, 1 - ball.wobbleTime * 2); // fades over 0.5s
      ball.x = ball.travelEndX + Math.sin(ball.wobbleTime * 15) * 2 * wobbleDecay;
      ball.wobbleTime += dt;
      // Transition to dwelling once wobble decays
      if (wobbleDecay <= 0.05) {
        ball.phase = 'dwelling';
        ball.x = ball.travelEndX;
      }
    }
  }
}

// ── Beat density from local fluency window ───────────────────────────────────

let lastDensity = 'normal';

function updateBeatDensity(idx) {
  if (!lofi || idx < 0) return;

  const windowSize = 3;
  let errors = 0;
  let total = 0;

  for (let i = Math.max(0, idx - windowSize); i <= Math.min(wordSequence.length - 1, idx + windowSize); i++) {
    total++;
    const w = wordSequence[i];
    if (w.isOmission || w.isStruggle || (w.type === 'substitution' && !w.forgiven)) {
      errors++;
    }
  }

  const errorRate = total > 0 ? errors / total : 0;
  let density;
  if (errorRate > 0.5) density = 'sparse';
  else if (errorRate > 0.2) density = 'normal';
  else density = 'full';

  if (density !== lastDensity) {
    lofi.setDensity(density);
    lastDensity = density;
  }
}

// ── Word CSS class updates ───────────────────────────────────────────────────

function updateWordClasses(idx) {
  for (let i = 0; i < wordSequence.length; i++) {
    const w = wordSequence[i];
    const el = w.el;
    if (!el) continue;

    // Self-corrected rainbow persists — never remove once applied
    if (el.classList.contains('done-self-corrected')) continue;

    el.classList.remove(
      'active', 'done-correct', 'done-error', 'done-struggle',
      'done-omission', 'upcoming'
    );

    if (i < idx) {
      // Past words
      if (w.selfCorrected) el.classList.add('done-self-corrected');
      else if (w.type === 'correct' || w.forgiven) el.classList.add('done-correct');
      else if (w.isOmission) el.classList.add('done-omission');
      else if (w.isStruggle) el.classList.add('done-struggle');
      else el.classList.add('done-error');
    } else if (i === idx) {
      el.classList.add('active');
    } else {
      el.classList.add('upcoming');
    }
  }
}

// ── Canvas drawing: trail ────────────────────────────────────────────────────

function drawTrail(ctx) {
  if (prefersReducedMotion) return;
  const pts = ball.trailPoints;
  for (let i = 0; i < pts.length; i++) {
    const pt = pts[i];
    const alpha = (i / pts.length) * 0.3;
    const r = ball.radius * (i / pts.length) * 0.6;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = ball.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, Math.max(r, 0.5), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ── Canvas drawing: ball glow ────────────────────────────────────────────────

function drawBallGlow(ctx) {
  if (prefersReducedMotion) return;
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = ball.glowColor;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.radius * 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

// ── Canvas drawing: main ball ────────────────────────────────────────────────

function drawBall(ctx) {
  // Subtle size pulse synced to beat
  let pulseRadius = ball.radius;
  if (audioCtx && lofi && lofi.isPlaying && !prefersReducedMotion) {
    const beatPhase = audioCtx.currentTime * lofi.currentBpm / 60 * Math.PI * 2;
    pulseRadius = BALL_BASE_RADIUS + Math.sin(beatPhase) * 1.5;
  }
  ball.radius = pulseRadius;

  ctx.fillStyle = ball.color;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, pulseRadius, 0, Math.PI * 2);
  ctx.fill();
}

// ── Canvas drawing: word-specific effects ────────────────────────────────────

function drawWordEffects(ctx) {
  if (prefersReducedMotion) return;
  if (currentWordIdx < 0) return;

  const w = wordSequence[currentWordIdx];
  const rect = wordRects[currentWordIdx];
  if (!w || !rect) return;

  // Omission: subtle tilde over word
  if (w.isOmission) {
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = WORD_COLORS.omission;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const waveW = rect.w * 0.6;
    const startX = rect.cx - waveW / 2;
    const baseY = rect.top - 5;
    for (let px = 0; px <= waveW; px += 2) {
      const py = baseY + Math.sin((px / waveW) * Math.PI * 3) * 3;
      if (px === 0) ctx.moveTo(startX + px, py);
      else ctx.lineTo(startX + px, py);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Struggle / substitution error: wobble lines around word rect
  if ((w.isStruggle || (w.type === 'substitution' && !w.forgiven)) && ball.phase === 'wobbling') {
    ctx.globalAlpha = 0.3 * Math.max(0, 1 - ball.wobbleTime * 2);
    ctx.strokeStyle = WORD_COLORS.struggle;
    ctx.lineWidth = 1;
    // Horizontal zigzag lines flanking the word
    for (const side of [-1, 1]) {
      ctx.beginPath();
      const sx = rect.cx + side * (rect.w / 2 + 8);
      for (let j = 0; j < 10; j++) {
        const y = rect.top - 5 + j * 3;
        const x = sx + (j % 2 === 0 ? 3 : -3);
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Self-correction: small checkmark particle floats up on arrival
  // (handled via spawnParticles in onWordChange -> landing phase)
}

// ── Canvas drawing: full frame ───────────────────────────────────────────────

function drawFrame(dt) {
  if (!ballCtx) return;
  ballCtx.clearRect(0, 0, ballCanvas.width, ballCanvas.height);

  if (ball.phase === 'idle') return;

  drawTrail(ballCtx);
  drawBallGlow(ballCtx);
  drawBall(ballCtx);
  drawWordEffects(ballCtx);
  updateParticles(dt);
  drawParticles(ballCtx);
}

// ── Chord badge ──────────────────────────────────────────────────────────────

let lastChordName = '';

function updateChordBadge() {
  const badge = document.getElementById('chordBadge');
  if (!badge || !lofi) return;
  const name = lofi.currentChordName;
  if (name !== lastChordName) {
    badge.textContent = name;
    lastChordName = name;
  }
  badge.classList.toggle('visible', sentenceAlignedEnabled);
}

// ── Main animation loop ─────────────────────────────────────────────────────

function animationLoop(timestamp) {
  if (!audioEl || audioEl.paused) return;

  const dt = lastFrameTime ? Math.min((timestamp - lastFrameTime) / 1000, 0.05) : 0.016;
  lastFrameTime = timestamp;

  const ct = audioEl.currentTime;

  // 1. Find current word
  const newIdx = findCurrentWord(ct);

  // 2. If word changed, trigger transition
  if (newIdx !== currentWordIdx && newIdx >= 0) {
    // Leaving a pause — restore density + needle drop
    if (inPause) {
      inPause = false;
      if (lofi) {
        lofi.setDensity(savedDensity);
        lofi.playNeedleDrop();
        lofi.setCrackleIntensity('light');
      }
    }
    onWordChange(currentWordIdx, newIdx);
    currentWordIdx = newIdx;
  }

  // 2b. Pause-reactive beat: check if we're in a gap between words
  if (lofi && newIdx >= 0 && newIdx < wordSequence.length) {
    const cw = wordSequence[newIdx];
    const nextIdx = newIdx + 1;
    const nw = nextIdx < wordSequence.length ? wordSequence[nextIdx] : null;
    if (cw.endTime > 0 && ct > cw.endTime && nw && nw.startTime > 0) {
      const gapRemaining = nw.startTime - ct;
      const gapTotal = cw.gapAfter;
      if (gapRemaining > 0.3 && gapTotal > 0.8) {
        if (!inPause) {
          // Save current error-rate density before overriding
          savedDensity = lastDensity;
          inPause = true;
          // Needle-lift effect: reduce crackle during pause
          if (lofi) lofi.setCrackleIntensity(gapTotal > 1.5 ? 'light' : 'medium');
        }
        lofi.setDensity(gapTotal > 1.5 ? 'whisper' : 'sparse');
      }
    }
  }

  // 3. Update beat density (only when not in a pause)
  if (!inPause) updateBeatDensity(newIdx);

  // 4. Update word CSS
  updateWordClasses(currentWordIdx);

  // 5. Update waveform visualization (throttled to every 3rd frame)
  if (mountainRange) {
    mountainRange.setPlayhead(ct);
    waveformFrameSkip++;
    if (waveformFrameSkip >= 3) {
      waveformFrameSkip = 0;
      const beatPhase = (lofi && typeof lofi.getBeatPhase === 'function') ? lofi.getBeatPhase() : 0;
      mountainRange.update(dt * 3, beatPhase);
    }
  }

  // 9. Update BPM display (throttled with waveform)
  if (lofi && waveformFrameSkip === 0) {
    const bpmEl = document.getElementById('bpmDisplay');
    if (bpmEl) {
      const bpm = Math.round(lofi.currentBpm);
      const ol = lofi.overlayLevel;
      let bonus = '';
      if (ol >= 1.5) bonus = '+12';
      else if (ol >= 1.0) bonus = '+9';
      else if (ol >= 0.65) bonus = '+6';
      else if (ol >= 0.35) bonus = '+3';
      bpmEl.innerHTML = bpm + ' bpm' + (bonus
        ? ' <span style="color:#a8d8a8;margin-left:0.3em;">' + bonus + '</span>'
        : '');
    }
  }

  // 10. Update chord badge
  updateChordBadge();

  animFrameId = requestAnimationFrame(animationLoop);
}

// ── Vinyl record helpers ─────────────────────────────────────────────────────

function setVinylPlaying(playing) {
  const record = document.getElementById('vinylRecord');
  const arm = document.getElementById('vinylArm');
  if (record) record.classList.toggle('spinning', playing);
  if (arm) arm.classList.toggle('playing', playing);
}

// ── Play/Pause toggle ────────────────────────────────────────────────────────

function togglePlayPause() {
  if (!audioEl) return;

  const playIcon = document.getElementById('playIcon');
  const pauseIcon = document.getElementById('pauseIcon');

  if (isPlaying || djSourceNode) {
    // Pause
    audioEl.pause();
    if (lofi) lofi.pause();
    // Stop DJ intro if playing
    if (djSourceNode) {
      try { djSourceNode.stop(0); } catch (_) { /* ok */ }
      djSourceNode = null;
    }
    isPlaying = false;
    setVinylPlaying(false);
    if (playIcon) playIcon.style.display = '';
    if (pauseIcon) pauseIcon.style.display = 'none';
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  } else {
    // Play — lazy audio setup on first interaction
    setupAudio();
    audioCtx.resume();

    // Start the lo-fi beat
    if (lofi) {
      if (lofi.isPlaying) lofi.resume();
      else lofi.start();
    }
    setVinylPlaying(true);

    // First play: DJ intro then reading. Subsequent: just play reading.
    if (!djIntroPlayed && djIntroBuffer) {
      // Hide play icon during DJ intro
      if (playIcon) playIcon.style.display = 'none';
      if (pauseIcon) pauseIcon.style.display = '';
      playDJIntroThenReading();
    } else {
      startReadingPlayback();
    }
  }
}

// ── Audio ended ──────────────────────────────────────────────────────────────

function onAudioEnded() {
  isPlaying = false;
  if (lofi) lofi.stop();
  setVinylPlaying(false);

  const playIcon = document.getElementById('playIcon');
  const pauseIcon = document.getElementById('pauseIcon');
  if (playIcon) playIcon.style.display = '';
  if (pauseIcon) pauseIcon.style.display = 'none';

  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }

  // Show all words in final state
  for (let i = 0; i < wordSequence.length; i++) {
    const w = wordSequence[i];
    if (!w.el) continue;
    w.el.classList.remove('active', 'upcoming');
    if (w.selfCorrected) w.el.classList.add('done-self-corrected');
    else if (w.type === 'correct' || w.forgiven) w.el.classList.add('done-correct');
    else if (w.isOmission) w.el.classList.add('done-omission');
    else if (w.isStruggle) w.el.classList.add('done-struggle');
    else w.el.classList.add('done-error');
  }

  // Reset ball
  ball.phase = 'idle';
  ball.trailPoints = [];
  particles = [];
  if (ballCtx) ballCtx.clearRect(0, 0, ballCanvas.width, ballCanvas.height);

  // Mountain range finale
  if (mountainRange) mountainRange.drawFinale();

  // Show replay message
  const status = document.getElementById('remix-status');
  if (status) {
    status.innerHTML = '<button class="replay-btn" id="replayBtn">Replay</button>';
    const replayBtn = document.getElementById('replayBtn');
    if (replayBtn) {
      replayBtn.addEventListener('click', () => {
        status.innerHTML = '';
        audioEl.currentTime = 0;
        currentWordIdx = -1;
        previousWordIdx = -1;
        // Reset waveform visualization
        if (mountainRange) {
          mountainRange.dispose();
          const mtCanvas = document.getElementById('mountain-canvas');
          if (mtCanvas) {
            mountainRange = new MountainRange(mtCanvas, wordSequence.length);
            if (waveformChannelData) {
              mountainRange.setAudioData(waveformChannelData, waveformDuration);
            }
          }
        }
        // Reset word classes
        for (const w of wordSequence) {
          if (w.el) {
            w.el.classList.remove(
              'active', 'done-correct', 'done-error', 'done-struggle',
              'done-omission'
            );
            w.el.classList.add('upcoming');
          }
        }
        togglePlayPause();
      });
    }
  }
}

// ── Wire up controls ─────────────────────────────────────────────────────────

function wireControls() {
  // Play button
  const playBtn = document.getElementById('playBtn');
  if (playBtn) playBtn.addEventListener('click', togglePlayPause);

  // Voice volume
  const voiceSlider = document.getElementById('voiceVolume');
  if (voiceSlider) {
    voiceSlider.addEventListener('input', () => {
      if (voiceGain) voiceGain.gain.value = parseInt(voiceSlider.value, 10) / 100;
    });
  }

  // Beat volume
  const beatSlider = document.getElementById('beatVolume');
  if (beatSlider) {
    beatSlider.addEventListener('input', () => {
      if (beatGain) beatGain.gain.value = parseInt(beatSlider.value, 10) / 100;
    });
  }

  // Style select
  const styleSelect = document.getElementById('styleSelect');
  if (styleSelect) {
    styleSelect.addEventListener('change', () => {
      const val = styleSelect.value;
      if (audioCtx) {
        switchEngine(val);
        // Re-set tempo for the new style's natural BPM range
        const wcpm = (assessment && assessment.wcpm) || 80;
        lofi.setTempo(wcpmToBpm(wcpm, val) * playbackRate);
      }
      localStorage.setItem('orf_remix_style', val);
    });
  }

  // Speed select
  const speedSelect = document.getElementById('speedSelect');
  if (speedSelect) {
    speedSelect.addEventListener('change', () => {
      const rate = parseFloat(speedSelect.value) || 1;
      playbackRate = rate;
      if (audioEl) audioEl.playbackRate = rate;
      if (lofi && assessment) {
        lofi.setTempo(wcpmToBpm(assessment.wcpm || 80, lofi._style) * rate);
      }
    });
  }

  // Sentence-aligned chords toggle
  const sentenceToggle = document.getElementById('sentenceToggle');
  if (sentenceToggle) {
    sentenceToggle.addEventListener('change', () => {
      sentenceAlignedEnabled = sentenceToggle.checked;
      if (lofi) lofi.setSentenceAligned(sentenceAlignedEnabled);
    });
  }

  // Micro-celebrations toggle
  const celebToggle = document.getElementById('celebrationsToggle');
  if (celebToggle) {
    celebToggle.addEventListener('change', () => {
      celebrationsEnabled = celebToggle.checked;
      if (lofi) lofi.setCelebrations(celebrationsEnabled);
    });
  }

  // Melodic contour toggle
  const melodyToggle = document.getElementById('melodyToggle');
  if (melodyToggle) {
    melodyToggle.addEventListener('change', () => {
      melodyEnabled = melodyToggle.checked;
      if (lofi) lofi.setMelody(melodyEnabled);
    });
  }

  // Adaptive harmony toggle
  const harmonyToggle = document.getElementById('harmonyToggle');
  if (harmonyToggle) {
    harmonyToggle.addEventListener('change', () => {
      adaptiveHarmonyEnabled = harmonyToggle.checked;
      if (lofi) lofi.setAdaptiveHarmony(adaptiveHarmonyEnabled);
      if (!adaptiveHarmonyEnabled) harmonyHistory = [];
    });
  }
}

// ── Load audio blob ──────────────────────────────────────────────────────────

async function loadAudio() {
  if (!assessment || !assessment.audioRef) {
    setStatus('Audio not available for this assessment.');
    disablePlayBtn();
    return;
  }

  const blob = await getAudioBlob(assessment.audioRef);
  if (!blob) {
    setStatus('Audio not found in storage.');
    disablePlayBtn();
    return;
  }

  audioEl = new Audio();
  audioEl.crossOrigin = 'anonymous';
  audioUrl = URL.createObjectURL(blob);
  audioEl.src = audioUrl;
  audioEl.addEventListener('ended', onAudioEnded);

  // Decode audio for waveform visualization (separate from playback)
  try {
    const tmpCtx = new (window.AudioContext || window.webkitAudioContext)();
    const arrBuf = await blob.arrayBuffer();
    const decoded = await tmpCtx.decodeAudioData(arrBuf);
    waveformChannelData = new Float32Array(decoded.getChannelData(0));
    waveformDuration = decoded.duration;
    tmpCtx.close();
    if (mountainRange) {
      mountainRange.setAudioData(waveformChannelData, waveformDuration);
    }
  } catch (e) {
    console.warn('[Waveform] Audio decode for visualization failed:', e);
  }
}

function setStatus(msg) {
  const el = document.getElementById('remix-status');
  if (el) el.textContent = msg;
}

function disablePlayBtn() {
  const btn = document.getElementById('playBtn');
  if (btn) btn.disabled = true;
}

// ── Build word sequence from alignment ───────────────────────────────────────

function buildWordSequence(alignment, sttWords) {
  const seq = [];
  const wordArea = document.getElementById('word-area');
  if (!wordArea) return seq;
  wordArea.innerHTML = '';

  // Pre-compute sentence boundaries from reference text
  const punctMap = (assessment && assessment.passageText)
    ? getPunctuationPositions(assessment.passageText) : new Map();

  let refIdx = 0; // tracks position within non-insertion entries (matches punctMap keys)

  for (const entry of alignment) {
    const type = entry.type || 'correct';

    // Skip insertions — not part of the passage text
    if (type === 'insertion') continue;

    let startTime = -1;
    let endTime = -1;

    if (type !== 'omission') {
      // Prefer cross-validation timestamps from alignment entry
      const sttWord = (entry.hypIndex != null && sttWords[entry.hypIndex]) || null;
      startTime = parseTime(entry._xvalStartTime || (sttWord && sttWord.startTime));
      endTime = parseTime(entry._xvalEndTime || (sttWord && sttWord.endTime));
    }

    const span = document.createElement('span');
    span.className = 'word-span upcoming';
    span.textContent = entry.ref || '';
    wordArea.appendChild(span);

    const isSentenceFinal = punctMap.get(refIdx) === 'period';

    seq.push({
      text: entry.ref || '',
      type,
      startTime,
      endTime,
      el: span,
      isStruggle: !!entry._isStruggle,
      isOmission: type === 'omission',
      forgiven: !!entry.forgiven,
      selfCorrected: !!entry._selfCorrected,
      sentenceFinal: isSentenceFinal,
      gapAfter: 0, // filled below
    });

    refIdx++;
  }

  // Pre-compute gaps between spoken words
  for (let i = 0; i < seq.length - 1; i++) {
    if (seq[i].endTime > 0 && seq[i + 1].startTime > 0) {
      seq[i].gapAfter = seq[i + 1].startTime - seq[i].endTime;
    }
  }

  return seq;
}

// ── Cleanup on unload ────────────────────────────────────────────────────────

function cleanup() {
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  if (djSourceNode) {
    try { djSourceNode.stop(0); } catch (_) { /* ok */ }
    djSourceNode = null;
  }
  if (mountainRange) {
    mountainRange.dispose();
    mountainRange = null;
  }
  if (lofiEngine) {
    lofiEngine.dispose();
    lofiEngine = null;
  }
  if (lofi2Engine) {
    lofi2Engine.dispose();
    lofi2Engine = null;
  }
  if (stickerbrushEngine) {
    stickerbrushEngine.dispose();
    stickerbrushEngine = null;
  }
  if (stickerbrush2Engine) {
    stickerbrush2Engine.dispose();
    stickerbrush2Engine = null;
  }
  lofi = null;
  if (audioUrl) {
    URL.revokeObjectURL(audioUrl);
    audioUrl = null;
  }
  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }
}

// ── Initialization ───────────────────────────────────────────────────────────

function initRhythmRemix() {
  // Read student/assessment from localStorage
  const studentId = localStorage.getItem('orf_playback_student');
  const assessmentId = localStorage.getItem('orf_playback_assessment');

  const wordArea = document.getElementById('word-area');
  ballCanvas = document.getElementById('ball-canvas');

  if (!studentId || !assessmentId) {
    if (wordArea) wordArea.innerHTML = '<p class="remix-message">Missing student or assessment data.</p>';
    disablePlayBtn();
    return;
  }

  assessment = getAssessment(assessmentId);
  if (!assessment || assessment.studentId !== studentId) {
    if (wordArea) wordArea.innerHTML = '<p class="remix-message">Assessment not found.</p>';
    disablePlayBtn();
    return;
  }

  const alignment = assessment.alignment || [];
  const sttWords = assessment.sttWords || [];

  if (!alignment.length) {
    if (wordArea) wordArea.innerHTML = '<p class="remix-message">No alignment data available.</p>';
    disablePlayBtn();
    return;
  }

  // Look up student name
  const students = getStudents();
  const student = students.find(s => s.id === studentId);
  const studentName = student ? student.name : null;

  // Populate vinyl subtitle with passage preview
  const subtitle = document.getElementById('vinylSubtitle');
  if (subtitle && assessment.passagePreview) {
    subtitle.textContent = assessment.passagePreview.slice(0, 30) + '...';
  }

  // Update vinyl title to show "Study Beats FM"
  const vinylTitle = document.getElementById('vinylTitle');
  if (vinylTitle) vinylTitle.textContent = 'Study Beats FM';

  // Fetch DJ intro — disable play until ready
  const passagePreview = assessment.passagePreview || '';
  const apiKey = localStorage.getItem('orf_gemini_key') || '';
  if (apiKey) {
    disablePlayBtn();
    setStatus('Tuning in to Study Beats FM...');
    djIntroLoading = true;
    fetchDJIntro(studentName).then(wavBuf => {
      djIntroBuffer = wavBuf;
      djIntroLoading = false;
      const btn = document.getElementById('playBtn');
      if (btn) btn.disabled = false;
      setStatus(wavBuf ? 'Study Beats FM ready' : '');
      if (wavBuf) console.log('[StudyBeatsFM] DJ intro ready (' + wavBuf.byteLength + ' bytes)');
      else console.warn('[StudyBeatsFM] DJ intro returned null — no audio generated');
    }).catch(err => {
      console.warn('[StudyBeatsFM] DJ intro fetch failed:', err);
      djIntroLoading = false;
      const btn = document.getElementById('playBtn');
      if (btn) btn.disabled = false;
      setStatus('');
    });
  }

  // Build word sequence
  wordSequence = buildWordSequence(alignment, sttWords);

  // Mountain range visualization
  const mtCanvas = document.getElementById('mountain-canvas');
  if (mtCanvas && wordSequence.length > 0) {
    mountainRange = new MountainRange(mtCanvas, wordSequence.length);
  }

  // Setup canvas
  if (ballCanvas) ballCtx = ballCanvas.getContext('2d');
  // Teleprompter: detect lines and set 2-line height before caching rects
  detectLines();
  setupTeleprompterHeight();
  sizeCanvas();
  cacheWordRects();

  // ResizeObserver — re-detect lines on resize (guarded to prevent loop)
  let lastObservedWidth = wordArea ? wordArea.offsetWidth : 0;
  const ro = new ResizeObserver(() => {
    if (!wordArea) return;
    const w = wordArea.offsetWidth;
    // Only re-layout on width changes (height changes come from our own setup)
    if (w === lastObservedWidth) {
      sizeCanvas();
      cacheWordRects();
      return;
    }
    lastObservedWidth = w;
    detectLines();
    setupTeleprompterHeight();
    sizeCanvas();
    cacheWordRects();
  });
  if (wordArea) ro.observe(wordArea);

  // Load audio (async, non-blocking)
  loadAudio();

  // Wire up controls
  wireControls();

  // Restore style preference
  const savedStyleInit = localStorage.getItem('orf_remix_style');
  const styleSelectInit = document.getElementById('styleSelect');
  if (savedStyleInit && styleSelectInit) {
    styleSelectInit.value = savedStyleInit;
  }

  // Cleanup on unload
  window.addEventListener('beforeunload', cleanup);
  window.addEventListener('pagehide', cleanup);
}

document.addEventListener('DOMContentLoaded', initRhythmRemix);
