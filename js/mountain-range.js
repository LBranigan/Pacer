/**
 * Waveform Visualization
 *
 * Renders a student's recorded audio as a color-coded bar waveform.
 * Each word's segment is colored by reading correctness — green for correct,
 * amber for struggled, purple for omitted.
 *
 * Keeps the same public API as the earlier mountain-range visualization
 * for compatibility with rhythm-remix.js.
 *
 * @module mountain-range
 */

// ── Constants ────────────────────────────────────────────────────────────────

const REDUCED_MOTION =
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const BAR_WIDTH = 3;
const BAR_GAP = 1;
const BAR_STRIDE = BAR_WIDTH + BAR_GAP;    // 4px per bar
const WAVEFORM_CENTER = 0.58;
const MAX_AMP_FRAC = 0.34;
const MIRROR_SCALE = 0.50;
const HI_RES_PEAKS = 2000;

// ── Colors ───────────────────────────────────────────────────────────────────

const COLORS = {
  correct:      '#a8d8a8',
  substitution: '#e8a87c',
  struggle:     '#d4875c',
  omission:     '#c4b5d4',
  unrevealed:   '#1E1B2E',
};

function wordColor(w) {
  if (w.isStruggle) return COLORS.struggle;
  if (w.type === 'omission') return COLORS.omission;
  if (w.type === 'substitution' && !w.forgiven) return COLORS.substitution;
  return COLORS.correct;
}

// ── Sky Gradient ─────────────────────────────────────────────────────────────

const SKY_STOPS = [
  [0,    '#08060F'],
  [0.30, '#0F0D1A'],
  [0.60, '#161225'],
  [0.85, '#1F1830'],
  [1.00, '#16131F'],
];

// ── Stars ────────────────────────────────────────────────────────────────────

function generateStars(count, w, h) {
  const stars = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random() * w,
      y: Math.random() * h,
      size: 0.7 + Math.random() * 1.3,
      baseAlpha: 0.25 + Math.random() * 0.35,
      phase: Math.random() * Math.PI * 2,
      freq: 0.4 + Math.random() * 1.2,
    });
  }
  return stars;
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Main Class ───────────────────────────────────────────────────────────────

export class MountainRange {

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {number} wordCount
   */
  constructor(canvas, wordCount) {
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');
    this._wordCount = wordCount;
    this._fixedHeight = 180;

    // Force container dimensions
    const parent = canvas.parentElement;
    if (parent) {
      parent.style.height = this._fixedHeight + 'px';
      parent.style.minHeight = this._fixedHeight + 'px';
      parent.style.flexShrink = '0';
      parent.style.overflow = 'hidden';
      parent.style.position = 'relative';
    }

    // Word data
    this._words = new Array(wordCount);
    for (let i = 0; i < wordCount; i++) {
      this._words[i] = {
        revealed: false, type: 'correct', isStruggle: false,
        forgiven: false, startTime: -1, endTime: -1, isOmission: false,
      };
    }

    // Audio data
    this._hiResPeaks = null;
    this._audioPeaks = null;
    this._totalDuration = 0;

    // Bar state
    this._barCount = 0;
    this._barData = [];
    this._offsetX = 0;

    // Playhead
    this._playheadTime = 0;

    // Visual state
    this._stars = [];
    this._elapsed = 0;
    this._finaleActive = false;
    this._finaleT = 0;
    this._finaleFrameId = null;
    this._exportBtn = null;

    this._resize();
    this._stars = generateStars(40, this._w, this._h);
    this._draw(0);

    // ResizeObserver
    this._ro = new ResizeObserver(() => {
      const oldW = this._w;
      this._resize();
      if (this._w !== oldW) {
        this._rebuildBars();
        this._draw(0);
      }
    });
    if (parent) this._ro.observe(parent);
  }

  // ── Public API ───────────────────────────────────────────────────────────

  setAudioData(channelData, duration) {
    this._totalDuration = duration;

    const samplesPerBucket = Math.max(1, Math.floor(channelData.length / HI_RES_PEAKS));
    this._hiResPeaks = new Float32Array(HI_RES_PEAKS);
    for (let i = 0; i < HI_RES_PEAKS; i++) {
      let max = 0;
      const start = i * samplesPerBucket;
      const end = Math.min(start + samplesPerBucket, channelData.length);
      for (let j = start; j < end; j++) {
        const abs = Math.abs(channelData[j]);
        if (abs > max) max = abs;
      }
      this._hiResPeaks[i] = max;
    }

    // Normalize to 0–1
    let globalMax = 0;
    for (let i = 0; i < HI_RES_PEAKS; i++) {
      if (this._hiResPeaks[i] > globalMax) globalMax = this._hiResPeaks[i];
    }
    if (globalMax > 0) {
      for (let i = 0; i < HI_RES_PEAKS; i++) this._hiResPeaks[i] /= globalMax;
    }

    this._rebuildBars();
    this._draw(0);
  }

  setPlayhead(currentTime) {
    this._playheadTime = currentTime;
  }

  revealPeak(index, word) {
    if (index < 0 || index >= this._wordCount) return;
    const w = this._words[index];
    w.revealed = true;
    w.type = word.type || 'correct';
    w.isStruggle = !!word.isStruggle;
    w.forgiven = !!word.forgiven;
    w.isOmission = word.isOmission || word.type === 'omission';
    w.startTime = (word.startTime > 0) ? word.startTime : -1;
    w.endTime = (word.endTime > 0) ? word.endTime : -1;

    // Map word time range to bar indices and color them
    if (w.startTime > 0 && w.endTime > 0 && this._totalDuration > 0 && this._barCount > 0) {
      const startBar = Math.floor(w.startTime / this._totalDuration * this._barCount);
      let endBar = Math.ceil(w.endTime / this._totalDuration * this._barCount);
      if (endBar <= startBar) endBar = startBar + 1;
      endBar = Math.min(endBar, this._barCount);
      const col = wordColor(w);
      for (let b = startBar; b < endBar; b++) {
        this._barData[b].colorMain = col;
        this._barData[b].revealed = true;
      }
    }

    // Omission marker: dashed lines in the gap
    if (w.isOmission && this._barCount > 0 && this._totalDuration > 0) {
      let prevEnd = -1, nextStart = -1;
      for (let i = index - 1; i >= 0; i--) {
        if (this._words[i].endTime > 0) { prevEnd = this._words[i].endTime; break; }
      }
      for (let i = index + 1; i < this._wordCount; i++) {
        if (this._words[i].startTime > 0) { nextStart = this._words[i].startTime; break; }
      }
      if (prevEnd > 0 && nextStart > 0) {
        const gapMid = (prevEnd + nextStart) / 2;
        const midBar = Math.floor(gapMid / this._totalDuration * this._barCount);
        for (let b = Math.max(0, midBar - 1); b <= Math.min(this._barCount - 1, midBar + 1); b++) {
          this._barData[b].omissionMarker = true;
        }
      }
    }
  }

  update(dt, beatPhase) {
    this._elapsed += dt;

    if (this._finaleActive) {
      this._finaleT = Math.min(1, this._finaleT + dt);
    }

    this._draw(beatPhase);
  }

  drawFinale() {
    this._playheadTime = this._totalDuration;
    for (const bar of this._barData) {
      if (!bar.revealed) {
        bar.revealed = true;
      }
    }
    this._finaleActive = true;
    this._finaleT = 0;

    let last = performance.now();
    const finaleLoop = (ts) => {
      const dt = Math.min((ts - last) / 1000, 0.05);
      last = ts;
      this.update(dt, 0);
      if (this._finaleT < 1) {
        this._finaleFrameId = requestAnimationFrame(finaleLoop);
      }
    };
    this._finaleFrameId = requestAnimationFrame(finaleLoop);
    this._showExportButton();
  }

  getExportDataURL() {
    const w = this._w * 2;
    const h = this._h * 2;
    const offscreen = document.createElement('canvas');
    offscreen.width = w;
    offscreen.height = h;
    const ctx = offscreen.getContext('2d');
    ctx.scale(2, 2);
    this._drawToCtx(ctx, this._w, this._h, 0, true);
    return offscreen.toDataURL('image/png');
  }

  dispose() {
    if (this._finaleFrameId) cancelAnimationFrame(this._finaleFrameId);
    if (this._ro) this._ro.disconnect();
    if (this._exportBtn && this._exportBtn.parentNode) {
      this._exportBtn.parentNode.removeChild(this._exportBtn);
    }
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  _resize() {
    const parent = this._canvas.parentElement;
    if (!parent) return;
    const w = Math.round(parent.clientWidth) || 680;
    const h = this._fixedHeight;
    if (w === this._w && h === this._h) return;
    this._w = w;
    this._h = h;
    this._canvas.width = w;
    this._canvas.height = h;
    this._canvas.style.width = w + 'px';
    this._canvas.style.height = h + 'px';
    this._stars = generateStars(40, w, h);
  }

  _rebuildBars() {
    this._barCount = Math.floor(this._w / BAR_STRIDE);
    this._offsetX = Math.max(0, (this._w - this._barCount * BAR_STRIDE) / 2);

    this._barData = new Array(this._barCount);
    for (let i = 0; i < this._barCount; i++) {
      this._barData[i] = {
        colorMain: COLORS.unrevealed,
        revealed: false,
        omissionMarker: false,
      };
    }

    // Downsample hiResPeaks → audioPeaks
    if (this._hiResPeaks) {
      const ratio = HI_RES_PEAKS / this._barCount;
      this._audioPeaks = new Float32Array(this._barCount);
      for (let i = 0; i < this._barCount; i++) {
        const start = Math.floor(i * ratio);
        const end = Math.min(Math.ceil((i + 1) * ratio), HI_RES_PEAKS);
        let max = 0;
        for (let j = start; j < end; j++) {
          if (this._hiResPeaks[j] > max) max = this._hiResPeaks[j];
        }
        this._audioPeaks[i] = max;
      }
    } else {
      this._audioPeaks = new Float32Array(this._barCount).fill(0.3);
    }

    // Re-apply already-revealed words
    if (this._totalDuration > 0) {
      for (let idx = 0; idx < this._wordCount; idx++) {
        const w = this._words[idx];
        if (!w.revealed || w.startTime <= 0 || w.endTime <= 0) continue;
        const startBar = Math.floor(w.startTime / this._totalDuration * this._barCount);
        let endBar = Math.ceil(w.endTime / this._totalDuration * this._barCount);
        if (endBar <= startBar) endBar = startBar + 1;
        endBar = Math.min(endBar, this._barCount);
        const col = wordColor(w);
        for (let b = startBar; b < endBar; b++) {
          this._barData[b].colorMain = col;
          this._barData[b].revealed = true;
        }
      }
    }
  }

  _draw(beatPhase) {
    this._drawToCtx(this._ctx, this._w, this._h, beatPhase, false);
  }

  _drawToCtx(ctx, w, h, beatPhase, isExport) {
    ctx.clearRect(0, 0, w, h);

    // ── Sky gradient ────────────────────────────────────────────────────
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    for (const [stop, color] of SKY_STOPS) sky.addColorStop(stop, color);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // ── Stars (gentle twinkle) ──────────────────────────────────────────
    ctx.fillStyle = '#fff';
    const t = this._elapsed;
    for (const star of this._stars) {
      const twinkle = REDUCED_MOTION ? 1.0
        : 0.5 + 0.5 * Math.sin(t * star.freq + star.phase);
      ctx.globalAlpha = star.baseAlpha * twinkle;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (this._barCount === 0 || !this._audioPeaks) return;

    const centerY = h * WAVEFORM_CENTER;
    const maxAmp = h * MAX_AMP_FRAC;

    // Playhead X position
    const playheadX = this._totalDuration > 0
      ? (this._playheadTime / this._totalDuration) * this._barCount * BAR_STRIDE + this._offsetX
      : -1;

    // Beat breathing (subtle)
    const breathe = (REDUCED_MOTION || isExport) ? 0
      : Math.sin(beatPhase * Math.PI * 2) * 1.0;

    // ── Bars (single pass) ──────────────────────────────────────────────
    for (let i = 0; i < this._barCount; i++) {
      const bar = this._barData[i];
      const peak = this._audioPeaks[i];
      const x = this._offsetX + i * BAR_STRIDE;

      // Amplitude
      let amp = bar.revealed ? peak * maxAmp + breathe : maxAmp * 0.04;
      amp = Math.max(amp, 0.5);

      // Played/unplayed dimming
      const barCenterX = x + BAR_WIDTH / 2;
      const dimmed = playheadX >= 0 && barCenterX > playheadX;

      // Top bar
      ctx.fillStyle = bar.colorMain;
      ctx.globalAlpha = dimmed ? 0.20 : 0.90;
      ctx.fillRect(x, centerY - amp, BAR_WIDTH, amp);

      // Mirror bar
      const mirrorAmp = amp * MIRROR_SCALE;
      ctx.globalAlpha = dimmed ? 0.06 : 0.22;
      ctx.fillRect(x, centerY + 1, BAR_WIDTH, mirrorAmp);
    }
    ctx.globalAlpha = 1;

    // ── Playhead line ───────────────────────────────────────────────────
    if (playheadX > 0 && playheadX < w && !isExport) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.fillRect(Math.round(playheadX), centerY - maxAmp - 4, 1, (maxAmp + 4) * 2);
    }

    // ── Omission markers ────────────────────────────────────────────────
    for (let i = 0; i < this._barCount; i++) {
      if (!this._barData[i].omissionMarker) continue;
      const x = this._offsetX + i * BAR_STRIDE + BAR_WIDTH / 2;
      ctx.strokeStyle = hexToRgba(COLORS.omission, 0.55);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, centerY - maxAmp * 0.45);
      ctx.lineTo(x, centerY + maxAmp * 0.45 * MIRROR_SCALE);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  _showExportButton() {
    if (this._exportBtn) return;
    const container = this._canvas.parentElement;
    if (!container) return;

    const btn = document.createElement('button');
    btn.className = 'mountain-export-btn';
    btn.textContent = 'Save as Image';
    btn.style.opacity = '0';
    container.appendChild(btn);

    requestAnimationFrame(() => { btn.style.opacity = '1'; });

    btn.addEventListener('click', () => {
      const dataUrl = this.getExportDataURL();
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'reading-waveform.png';
      a.click();
    });

    this._exportBtn = btn;
  }
}
