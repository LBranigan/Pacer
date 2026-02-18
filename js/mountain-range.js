/**
 * Mountain Range Waveform Visualization
 *
 * Builds a topographic "mountain range" in real-time as the student reads.
 * Each word becomes a peak whose height reflects duration, colored by correctness.
 *
 * @module mountain-range
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

const REDUCED_MOTION =
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function easeOutCubic(t) { return 1 - (1 - t) * (1 - t) * (1 - t); }

/** Catmull-Rom interpolation between p1 and p2 (p0/p3 are neighbors). */
function catmullRom(p0, p1, p2, p3, t, tension = 0.5) {
  const t2 = t * t, t3 = t2 * t;
  const s = (1 - tension) / 2;
  const b1 = 2 * t3 - 3 * t2 + 1;
  const b2 = t3 - 2 * t2 + t;
  const b3 = -2 * t3 + 3 * t2;
  const b4 = t3 - t2;
  return {
    x: b1 * p1.x + b2 * s * (p2.x - p0.x) + b3 * p2.x + b4 * s * (p3.x - p1.x),
    y: b1 * p1.y + b2 * s * (p2.y - p0.y) + b3 * p2.y + b4 * s * (p3.y - p1.y),
  };
}

// ── Color Palette ────────────────────────────────────────────────────────────

const PEAK_COLORS = {
  correct:      '#a8d8a8',
  substitution: '#e8a87c',
  struggle:     '#d4875c',
  omission:     '#c4b5d4',
};

function peakColor(peak) {
  if (peak.isStruggle) return PEAK_COLORS.struggle;
  if (peak.type === 'omission') return PEAK_COLORS.omission;
  if (peak.type === 'substitution' && !peak.forgiven) return PEAK_COLORS.substitution;
  return PEAK_COLORS.correct;
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function lighten(hex, amount = 0.35) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lr = Math.min(255, r + (255 - r) * amount);
  const lg = Math.min(255, g + (255 - g) * amount);
  const lb = Math.min(255, b + (255 - b) * amount);
  return `rgb(${lr|0},${lg|0},${lb|0})`;
}

// ── Sky Gradient Stops ───────────────────────────────────────────────────────

const SKY_STOPS = [
  [0,    '#0d0b14'],
  [0.30, '#1a1535'],
  [0.55, '#2d1f45'],
  [0.75, '#5c3355'],
  [0.90, '#a85c40'],
  [1.00, '#e8a87c'],
];

// ── Background Layer Configs ─────────────────────────────────────────────────

const LAYERS = [
  { heightScale: 0.40, alpha: 0.25, parallax: -0.15, color: '#2a1f3d' },
  { heightScale: 0.65, alpha: 0.45, parallax: -0.07, color: '#3d2850' },
];

// ── Stars ────────────────────────────────────────────────────────────────────

function generateStars(count, w, h) {
  const stars = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random() * w,
      y: Math.random() * h * 0.6,
      size: 1 + Math.random() * 1.5,
      phase: Math.random() * Math.PI * 2,
      freq: 0.5 + Math.random() * 1.5,
    });
  }
  return stars;
}

// ── Summit Particles ─────────────────────────────────────────────────────────

const MAX_PARTICLES = 40;

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
    this._fixedHeight = 180; // never changes

    // Force container dimensions via inline style (immune to CSS cache)
    const parent = canvas.parentElement;
    if (parent) {
      parent.style.height = this._fixedHeight + 'px';
      parent.style.minHeight = this._fixedHeight + 'px';
      parent.style.flexShrink = '0';
      parent.style.overflow = 'hidden';
      parent.style.position = 'relative';
    }

    // Peak data
    this._peaks = new Array(wordCount);
    for (let i = 0; i < wordCount; i++) {
      this._peaks[i] = {
        duration: 0, type: 'correct', isStruggle: false, forgiven: false,
        revealed: false, revealT: 0,
      };
    }

    this._maxDuration = 0;
    this._stars = [];
    this._particles = [];
    this._starAlpha = 0.15;       // brightens in finale
    this._finaleActive = false;
    this._finaleT = 0;
    this._horizonGlow = 0;
    this._exportBtn = null;
    this._currentIdx = -1;        // parallax tracking
    this._elapsed = 0;

    this._resize();
    this._stars = generateStars(45, this._w, this._h);

    // Draw initial sky + stars scene
    this._draw(0);

    // ResizeObserver — only for width changes
    this._ro = new ResizeObserver(() => {
      const oldW = this._w;
      this._resize();
      if (this._w !== oldW) this._draw(0);
    });
    if (parent) this._ro.observe(parent);
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /** Called when the bouncing ball reaches word `index`. */
  revealPeak(index, word) {
    if (index < 0 || index >= this._wordCount) return;
    const p = this._peaks[index];
    p.revealed = true;
    p.revealT = 0;
    p.type = word.type || 'correct';
    p.isStruggle = !!word.isStruggle;
    p.forgiven = !!word.forgiven;

    if (word.isOmission || word.type === 'omission') {
      p.type = 'omission';
      p.duration = 0;
    } else {
      const dur = (word.endTime > 0 && word.startTime > 0)
        ? Math.max(0, word.endTime - word.startTime) : 0.3;
      p.duration = dur;
      if (dur > this._maxDuration) this._maxDuration = dur;
    }

    this._currentIdx = index;

    // Spawn summit particles
    if (!REDUCED_MOTION) {
      const cx = this._peakX(index);
      const cy = this._h - this._peakHeight(p) * p.revealT; // starts at baseline
      const col = peakColor(p);
      for (let k = 0; k < 4; k++) {
        if (this._particles.length >= MAX_PARTICLES) break;
        this._particles.push({
          x: cx, y: cy,
          vx: (Math.random() - 0.5) * 30,
          vy: -20 - Math.random() * 30,
          life: 0.5 + Math.random() * 0.3,
          maxLife: 0.8,
          size: 1.5 + Math.random() * 1.5,
          color: col,
        });
      }
    }
  }

  /** Called every animation frame. */
  update(dt, beatPhase) {
    this._elapsed += dt;

    // Animate reveal
    for (const p of this._peaks) {
      if (p.revealed && p.revealT < 1) {
        p.revealT = Math.min(1, p.revealT + dt / 0.5);
      }
    }

    // Finale fade
    if (this._finaleActive) {
      this._finaleT = Math.min(1, this._finaleT + dt);
      this._starAlpha = 0.15 + 0.45 * easeOutCubic(this._finaleT);
      this._horizonGlow = easeOutCubic(this._finaleT) * 0.3;
    }

    // Update particles
    for (let i = this._particles.length - 1; i >= 0; i--) {
      const p = this._particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 30 * dt;
      p.life -= dt;
      if (p.life <= 0) this._particles.splice(i, 1);
    }

    this._draw(beatPhase);
  }

  /** Called when audio playback ends. */
  drawFinale() {
    // Reveal any unrevealed peaks (trailing omissions)
    for (const p of this._peaks) {
      if (!p.revealed) {
        p.revealed = true;
        p.revealT = 1;
      }
    }
    this._finaleActive = true;
    this._finaleT = 0;

    // Run a short self-driven animation for the finale effects
    // (the main animation loop has stopped by now)
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

    // Show export button
    this._showExportButton();
  }

  /** Returns PNG data URL of the current canvas. */
  getExportDataURL() {
    // Render at 2x for quality
    const w = this._w * 2;
    const h = this._h * 2;
    const offscreen = document.createElement('canvas');
    offscreen.width = w;
    offscreen.height = h;
    const ctx = offscreen.getContext('2d');
    ctx.scale(2, 2);

    // Draw the full scene once at current state (no animation)
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
    // Width from parent; height is ALWAYS fixed (never read from DOM)
    const w = Math.round(parent.clientWidth) || 680;
    const h = this._fixedHeight;
    if (w === this._w && h === this._h) return;
    this._w = w;
    this._h = h;
    this._canvas.width = w;
    this._canvas.height = h;
    this._canvas.style.width = w + 'px';
    this._canvas.style.height = h + 'px';
    // Regenerate stars for new dimensions
    this._stars = generateStars(45, w, h);
  }

  _peakX(i) {
    return (i + 0.5) / this._wordCount * this._w;
  }

  _peakHeight(peak) {
    if (peak.type === 'omission' || peak.duration <= 0) {
      return this._h * 0.70 * 0.10; // valley
    }
    const maxD = Math.max(this._maxDuration, 0.5);
    const norm = Math.log(1 + peak.duration) / Math.log(1 + maxD);
    const clamped = 0.15 + norm * 0.85; // min 15% of max height
    return clamped * this._h * 0.70;
  }

  _draw(beatPhase) {
    this._drawToCtx(this._ctx, this._w, this._h, beatPhase, false);
  }

  /**
   * Core draw routine — renders to any 2D context at given dimensions.
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

    // ── Horizon glow (finale) ──────────────────────────────────────────
    if (this._horizonGlow > 0) {
      const glow = ctx.createRadialGradient(w / 2, h, 0, w / 2, h, h * 0.6);
      glow.addColorStop(0, `rgba(232, 168, 124, ${this._horizonGlow})`);
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
    }

    // ── Stars ──────────────────────────────────────────────────────────
    const alpha = isExport ? 0.5 : this._starAlpha;
    for (const star of this._stars) {
      const twinkle = REDUCED_MOTION ? 1
        : 0.5 + 0.5 * Math.sin(this._elapsed * star.freq * 2 + star.phase);
      ctx.globalAlpha = alpha * twinkle;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ── Build control points ───────────────────────────────────────────
    const points = this._buildControlPoints(w, h, 1.0, 0, beatPhase, isExport);

    // ── Background / midground layers ──────────────────────────────────
    for (const layer of LAYERS) {
      const lp = this._buildControlPoints(w, h, layer.heightScale, layer.parallax, beatPhase, isExport);
      ctx.globalAlpha = layer.alpha;
      this._drawMountainLayer(ctx, lp, w, h, layer.color, layer.color);
      ctx.globalAlpha = 1;
    }

    // ── Foreground mountains (per-peak coloring) ───────────────────────
    this._drawForegroundMountains(ctx, points, w, h, beatPhase, isExport);

    // ── Particles ──────────────────────────────────────────────────────
    if (!isExport) {
      for (const p of this._particles) {
        ctx.globalAlpha = Math.max(0, p.life / p.maxLife) * 0.7;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  /**
   * Build an array of {x, y} control points for the mountain spline.
   * @param {number} w - canvas width
   * @param {number} h - canvas height
   * @param {number} heightScale - multiplier for peak heights (1.0 for foreground)
   * @param {number} parallaxShift - horizontal parallax offset as fraction
   * @param {number} beatPhase - 0–1 beat phase for breathing
   * @param {boolean} isExport
   */
  _buildControlPoints(w, h, heightScale, parallaxShift, beatPhase, isExport) {
    const baseline = h;
    const progress = this._currentIdx >= 0
      ? this._currentIdx / Math.max(1, this._wordCount - 1) : 0;
    const shiftX = parallaxShift * progress * w;

    // Breathing offset (subtle ±1.5px)
    const breathe = (REDUCED_MOTION || isExport) ? 0
      : Math.sin(beatPhase * Math.PI * 2) * 1.5;

    const pts = [];
    for (let i = 0; i < this._wordCount; i++) {
      const p = this._peaks[i];
      const x = this._peakX(i) + shiftX;
      const rawH = this._peakHeight(p) * heightScale;
      const animH = rawH * (p.revealed ? easeOutCubic(p.revealT) : 0);
      const y = baseline - animH + breathe;
      pts.push({ x, y, peak: p });
    }
    return pts;
  }

  /**
   * Draw a single-color mountain layer using Catmull-Rom.
   */
  _drawMountainLayer(ctx, points, w, h, fillColor, _unused) {
    if (points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(0, h); // bottom-left
    ctx.lineTo(points[0].x, points[0].y);

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];
      const steps = 8;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const pt = catmullRom(p0, p1, p2, p3, t);
        ctx.lineTo(pt.x, pt.y);
      }
    }

    ctx.lineTo(w, h); // bottom-right
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
  }

  /**
   * Draw the foreground mountains with per-peak gradient coloring + snow caps.
   */
  _drawForegroundMountains(ctx, points, w, h, beatPhase, isExport) {
    if (points.length < 2) return;

    // First, draw the full mountain silhouette with a segment-by-segment approach
    // Each peak-to-peak segment is colored by a gradient between the two peaks' colors
    ctx.save();

    // Build the full path for clipping
    const pathPoints = [{ x: 0, y: h }];
    pathPoints.push({ x: points[0].x, y: points[0].y });
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];
      const steps = 8;
      for (let s = 1; s <= steps; s++) {
        const pt = catmullRom(p0, p1, p2, p3, s / steps);
        pathPoints.push(pt);
      }
    }
    pathPoints.push({ x: w, y: h });

    // Draw mountain fill — iterate segments and fill vertical strips
    for (let i = 0; i < points.length; i++) {
      const p = points[i].peak;
      if (!p.revealed) continue;

      const col = peakColor(p);
      const colLight = lighten(col, 0.35);
      const cx = points[i].x;
      const cy = points[i].y;

      // Vertical gradient for this peak's region
      const grad = ctx.createLinearGradient(cx, cy, cx, h);
      grad.addColorStop(0, colLight);
      grad.addColorStop(1, col);

      // Define the horizontal region for this peak
      const halfSpan = (w / this._wordCount) / 2;
      const left = cx - halfSpan - 2;
      const right = cx + halfSpan + 2;

      ctx.save();
      ctx.beginPath();
      ctx.rect(left, 0, right - left, h);
      ctx.clip();

      // Draw the full mountain path within this clip region
      ctx.beginPath();
      ctx.moveTo(pathPoints[0].x, pathPoints[0].y);
      for (let j = 1; j < pathPoints.length; j++) {
        ctx.lineTo(pathPoints[j].x, pathPoints[j].y);
      }
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();
    }

    // ── Summit glow ──────────────────────────────────────────────────
    for (let i = 0; i < points.length; i++) {
      const p = points[i].peak;
      if (!p.revealed || p.revealT < 0.5) continue;
      const col = peakColor(p);
      const cx = points[i].x;
      const cy = points[i].y;
      const glowR = 15 + this._peakHeight(p) * 0.15;
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
      glow.addColorStop(0, hexToRgba(col, 0.2));
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Snow caps on tallest peaks ───────────────────────────────────
    if (this._maxDuration > 0) {
      const snowThreshold = this._h * 0.70 * 0.85;
      for (let i = 0; i < points.length; i++) {
        const p = points[i].peak;
        if (!p.revealed || p.type === 'omission') continue;
        const peakH = this._peakHeight(p) * easeOutCubic(p.revealT);
        if (peakH < snowThreshold) continue;

        // Draw a white highlight along the top of the peak
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 2;
        ctx.beginPath();

        // Sample the spline around this peak's summit (±half a segment)
        const prevI = Math.max(0, i - 1);
        const nextI = Math.min(points.length - 1, i + 1);
        const p0 = points[Math.max(0, prevI - 1)] || points[prevI];
        const p1 = points[prevI];
        const p2 = points[i];
        const p3 = points[nextI];
        const p4 = points[Math.min(points.length - 1, nextI + 1)] || points[nextI];

        // Draw from prevI→i (last 4 steps) and i→nextI (first 4 steps)
        const segs = 4;
        let started = false;
        for (let s = segs; s <= segs * 2; s++) {
          const t = (s - segs) / segs;
          // i-1 to i segment (second half)
          const pt0 = catmullRom(p0, p1, p2, p3, 0.5 + t * 0.5);
          if (!started) { ctx.moveTo(pt0.x, pt0.y); started = true; }
          else ctx.lineTo(pt0.x, pt0.y);
        }
        for (let s = 0; s <= segs; s++) {
          const t = s / segs;
          // i to i+1 segment (first half)
          const pt1 = catmullRom(p1, p2, p3, p4, t * 0.5);
          ctx.lineTo(pt1.x, pt1.y);
        }
        ctx.stroke();
      }
    }

    ctx.restore();
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

    // Fade in
    requestAnimationFrame(() => {
      btn.style.opacity = '1';
    });

    btn.addEventListener('click', () => {
      const dataUrl = this.getExportDataURL();
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'reading-mountain-range.png';
      a.click();
    });

    this._exportBtn = btn;
  }
}
