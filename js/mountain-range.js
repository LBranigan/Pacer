/**
 * Waveform Visualization
 *
 * Renders a student's recorded audio as a color-coded bar waveform.
 * Each word's segment is colored by reading correctness — green for correct,
 * amber for struggled, purple for omitted. A playhead with glow tracks
 * the current position. Stars twinkle behind on a dark gradient sky.
 *
 * Keeps the same public API as the earlier mountain-range visualization
 * for compatibility with rhythm-remix.js.
 *
 * @module mountain-range
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

const REDUCED_MOTION =
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Constants ────────────────────────────────────────────────────────────────

const BAR_WIDTH = 2;
const BAR_GAP = 1;
const BAR_STRIDE = BAR_WIDTH + BAR_GAP; // 3px per bar
const WAVEFORM_CENTER = 0.50;           // center line at 50% of canvas height
const MAX_AMP_FRAC = 0.38;             // max bar height as fraction of canvas height
const MIRROR_SCALE = 0.55;             // mirror bars are 55% of top bars
const REVEAL_DURATION = 0.30;          // seconds for bar scale-up
const REVEAL_STAGGER = 0.012;          // seconds delay between bars in a word
const FLASH_DURATION = 0.18;           // seconds for brightness flash on reveal
const TRANS_ZONE = BAR_STRIDE * 3;     // played/unplayed fade zone width (px)
const HI_RES_PEAKS = 2000;             // peak resolution for resize-safe storage
const MAX_PARTICLES = 25;

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
      size: 0.8 + Math.random() * 1.2,
      phase: Math.random() * Math.PI * 2,
      freq: 0.5 + Math.random() * 1.5,
    });
  }
  return stars;
}

// ── Rounded-bar helper ───────────────────────────────────────────────────────

function drawRoundedBar(ctx, x, y, w, h) {
  if (h < 1) { ctx.fillRect(x, y, w, Math.max(h, 0.5)); return; }
  const r = Math.min(w / 2, h / 2);
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
  } else {
    ctx.fillRect(x, y, w, h);
  }
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

    // Force container dimensions (immune to CSS cache)
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
    this._hiResPeaks = null;        // Float32Array[HI_RES_PEAKS]
    this._audioPeaks = null;        // Float32Array[barCount] — downsampled
    this._totalDuration = 0;

    // Bar state
    this._barCount = 0;
    this._barData = [];             // { colorMain, revealed, revealStart, omissionMarker }
    this._offsetX = 0;              // horizontal offset to center waveform

    // Playhead
    this._playheadTime = 0;

    // Visual state
    this._stars = [];
    this._particles = [];
    this._starAlpha = 0.20;
    this._elapsed = 0;
    this._finaleActive = false;
    this._finaleT = 0;
    this._finaleFrameId = null;
    this._exportBtn = null;

    this._resize();
    this._stars = generateStars(50, this._w, this._h);
    this._draw(0);

    // ResizeObserver — only for width changes
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

  /**
   * Provide raw audio data for waveform peak rendering.
   * Call once after decoding the audio blob.
   * @param {Float32Array} channelData — mono PCM samples
   * @param {number} duration — total audio duration in seconds
   */
  setAudioData(channelData, duration) {
    this._totalDuration = duration;

    // Pre-compute high-resolution peaks (downsample to HI_RES_PEAKS buckets)
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

  /** Update playhead position each animation frame. */
  setPlayhead(currentTime) {
    this._playheadTime = currentTime;
  }

  /** Called when the bouncing ball reaches word `index`. */
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

    // Map word time range to bar indices
    if (w.startTime > 0 && w.endTime > 0 && this._totalDuration > 0 && this._barCount > 0) {
      const startBar = Math.floor(w.startTime / this._totalDuration * this._barCount);
      let endBar = Math.ceil(w.endTime / this._totalDuration * this._barCount);
      if (endBar <= startBar) endBar = startBar + 1;
      endBar = Math.min(endBar, this._barCount);
      const col = wordColor(w);
      for (let b = startBar; b < endBar; b++) {
        this._barData[b].colorMain = col;
        this._barData[b].revealed = true;
        this._barData[b].revealStart = this._elapsed + (b - startBar) * REVEAL_STAGGER;
      }

      // Spawn particles at the word center
      if (!REDUCED_MOTION) {
        const cx = this._offsetX + ((startBar + endBar) / 2) * BAR_STRIDE;
        const cy = this._h * WAVEFORM_CENTER;
        for (let k = 0; k < 3; k++) {
          if (this._particles.length >= MAX_PARTICLES) break;
          this._particles.push({
            x: cx, y: cy,
            vx: (Math.random() - 0.5) * 20,
            vy: -15 - Math.random() * 25,
            life: 0.5 + Math.random() * 0.3,
            maxLife: 0.8,
            size: 1 + Math.random() * 1.5,
            color: col,
          });
        }
      }
    }

    // Omission indicator: mark bars in the gap where the word should have been
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

  /** Called every animation frame. */
  update(dt, beatPhase) {
    this._elapsed += dt;

    // Finale fade
    if (this._finaleActive) {
      this._finaleT = Math.min(1, this._finaleT + dt);
      this._starAlpha = 0.20 + 0.45 * easeOutQuad(this._finaleT);
    }

    // Update particles
    for (let i = this._particles.length - 1; i >= 0; i--) {
      const p = this._particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 25 * dt;
      p.life -= dt;
      if (p.life <= 0) this._particles.splice(i, 1);
    }

    this._draw(beatPhase);
  }

  /** Called when audio playback ends. */
  drawFinale() {
    this._playheadTime = this._totalDuration;
    for (const bar of this._barData) {
      if (!bar.revealed) {
        bar.revealed = true;
        bar.revealStart = this._elapsed;
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

  /** Returns PNG data URL at 2x resolution. */
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

  /** Cleanup resources. */
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
    this._stars = generateStars(50, w, h);
  }

  /** Recompute bar count, downsample peaks, and re-apply word colors. */
  _rebuildBars() {
    this._barCount = Math.floor(this._w / BAR_STRIDE);
    this._offsetX = Math.max(0, (this._w - this._barCount * BAR_STRIDE) / 2);

    // Reset bar data
    this._barData = new Array(this._barCount);
    for (let i = 0; i < this._barCount; i++) {
      this._barData[i] = {
        colorMain: COLORS.unrevealed,
        revealed: false,
        revealStart: 0,
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
      // No audio data: flat bars
      this._audioPeaks = new Float32Array(this._barCount).fill(0.3);
    }

    // Re-apply already-revealed words to new bar positions
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
          this._barData[b].revealStart = 0; // instant on resize
        }
      }
    }
  }

  _draw(beatPhase) {
    this._drawToCtx(this._ctx, this._w, this._h, beatPhase, false);
  }

  /**
   * Core draw routine.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} w  - logical width
   * @param {number} h  - logical height
   * @param {number} beatPhase - 0–1 within beat cycle
   * @param {boolean} isExport - if true, skip animation artifacts
   */
  _drawToCtx(ctx, w, h, beatPhase, isExport) {
    ctx.clearRect(0, 0, w, h);

    // ── Sky gradient ───────────────────────────────────────────────────
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    for (const [stop, color] of SKY_STOPS) sky.addColorStop(stop, color);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // ── Stars ──────────────────────────────────────────────────────────
    const sAlpha = isExport ? 0.5 : this._starAlpha;
    for (const star of this._stars) {
      const twinkle = REDUCED_MOTION ? 1
        : 0.5 + 0.5 * Math.sin(this._elapsed * star.freq * 2 + star.phase);
      ctx.globalAlpha = sAlpha * twinkle;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (this._barCount === 0 || !this._audioPeaks) return;

    const centerY = h * WAVEFORM_CENTER;
    const maxAmp = h * MAX_AMP_FRAC;

    // ── Subtle center line ─────────────────────────────────────────────
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(w, centerY);
    ctx.stroke();

    // Playhead X position in pixels
    const playheadX = this._totalDuration > 0
      ? (this._playheadTime / this._totalDuration) * this._barCount * BAR_STRIDE + this._offsetX
      : -1;

    // Beat breathing
    const breathe = (REDUCED_MOTION || isExport) ? 0
      : Math.sin(beatPhase * Math.PI * 2) * 1.5;

    // ── Pass 1: Glow layer (blurred behind bars) ───────────────────────
    if (!isExport) {
      ctx.save();
      ctx.filter = 'blur(5px)';
      ctx.globalAlpha = 0.30;
      this._drawBarsPass(ctx, centerY, maxAmp, playheadX, breathe, true);
      ctx.restore();
      ctx.filter = 'none';
      ctx.globalAlpha = 1;
    }

    // ── Subtle highlight behind played region ──────────────────────────
    if (playheadX > 0 && !isExport) {
      const hl = ctx.createLinearGradient(this._offsetX, 0, playheadX, 0);
      hl.addColorStop(0, 'rgba(255, 255, 255, 0.01)');
      hl.addColorStop(0.9, 'rgba(255, 255, 255, 0.03)');
      hl.addColorStop(1, 'rgba(255, 255, 255, 0.01)');
      ctx.fillStyle = hl;
      ctx.fillRect(this._offsetX, centerY - maxAmp, playheadX - this._offsetX, maxAmp * 2);
    }

    // ── Pass 2: Sharp bars ─────────────────────────────────────────────
    this._drawBarsPass(ctx, centerY, maxAmp, playheadX, breathe, false);

    // ── Playhead ───────────────────────────────────────────────────────
    if (playheadX > 0 && playheadX < w && !isExport) {
      // Radial glow
      const glowR = 28;
      const glow = ctx.createRadialGradient(playheadX, centerY, 0, playheadX, centerY, glowR);
      glow.addColorStop(0, 'rgba(255, 255, 255, 0.20)');
      glow.addColorStop(0.5, 'rgba(255, 255, 255, 0.06)');
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.fillRect(playheadX - glowR, centerY - glowR, glowR * 2, glowR * 2);

      // Bright line
      ctx.save();
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = 4;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fillRect(playheadX - 0.5, centerY - maxAmp - 5, 1.5, (maxAmp + 5) * 2);
      ctx.restore();
    }

    // ── Omission markers ───────────────────────────────────────────────
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

    // ── Particles ──────────────────────────────────────────────────────
    if (!isExport) {
      for (const p of this._particles) {
        ctx.globalAlpha = Math.max(0, p.life / p.maxLife) * 0.6;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  /**
   * Draw all bars in a single pass.
   * Called twice: once with blur (glow), once sharp.
   */
  _drawBarsPass(ctx, centerY, maxAmp, playheadX, breathe, isGlow) {
    for (let i = 0; i < this._barCount; i++) {
      const bar = this._barData[i];
      const peak = this._audioPeaks[i];
      const x = this._offsetX + i * BAR_STRIDE;

      // ── Amplitude ──
      let amp;
      if (bar.revealed) {
        const since = this._elapsed - bar.revealStart;
        if (since < REVEAL_DURATION && since >= 0) {
          const frac = easeOutQuad(since / REVEAL_DURATION);
          amp = (maxAmp * 0.04) + (peak * maxAmp - maxAmp * 0.04) * frac;
        } else {
          amp = peak * maxAmp;
        }
        amp += breathe;
      } else {
        amp = maxAmp * 0.04; // tiny unrevealed stub
      }
      amp = Math.max(amp, 0.5);

      // ── Played/unplayed opacity ──
      const barCenterX = x + BAR_WIDTH / 2;
      let playedFrac;
      if (playheadX < 0) {
        playedFrac = 1; // no playhead active
      } else if (barCenterX <= playheadX - TRANS_ZONE / 2) {
        playedFrac = 1;
      } else if (barCenterX >= playheadX + TRANS_ZONE / 2) {
        playedFrac = 0;
      } else {
        playedFrac = 1 - (barCenterX - (playheadX - TRANS_ZONE / 2)) / TRANS_ZONE;
      }

      // ── Reveal flash ──
      let flash = 0;
      if (bar.revealed && !isGlow) {
        const since = this._elapsed - bar.revealStart;
        if (since > 0 && since < FLASH_DURATION) {
          flash = 0.25 * (1 - since / FLASH_DURATION);
        }
      }

      ctx.fillStyle = bar.colorMain;

      // ── Top half ──
      const topAlpha = isGlow
        ? (0.08 + playedFrac * 0.22)
        : Math.min(1, 0.25 + playedFrac * 0.75 + flash);
      ctx.globalAlpha = topAlpha;
      drawRoundedBar(ctx, x, centerY - amp, BAR_WIDTH, amp);

      // ── Bottom half (mirror/reflection) ──
      const mirrorAmp = amp * MIRROR_SCALE;
      const botAlpha = isGlow
        ? (0.04 + playedFrac * 0.10)
        : Math.min(1, 0.06 + playedFrac * 0.19 + flash * 0.5);
      ctx.globalAlpha = botAlpha;
      drawRoundedBar(ctx, x, centerY + 1, BAR_WIDTH, mirrorAmp);
    }
    ctx.globalAlpha = 1;
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
