/**
 * Canvas effect engine for playback — supports multiple visual themes.
 * @module effect-engine
 */

const THEMES = {
  cyber: {
    accent: '#00f0ff',
    correct: '#00ff88',
    error: '#ff0055',
    particle: '#9d00ff',
    scanlineAlpha: 0.04,
  },
  glitch: {
    accent: '#ffffff',
    correct: '#00ff00',
    error: '#ff0000',
    particle: '#00ffff',
    secondary: '#ff00ff',
    scanlineAlpha: 0,
  }
};

export class EffectEngine {
  constructor(ctx, options = {}) {
    this.ctx = ctx;
    this.particles = [];
    this.neonTrail = [];
    this.scanlineOffset = 0;
    this.time = 0;
    this.setTheme(options.theme || 'cyber');
  }

  setTheme(name) {
    this.theme = THEMES[name] || THEMES.cyber;
    this.themeName = name;
  }

  resize() {
    this.particles = [];
    this.neonTrail = [];
  }

  /* ── Background scanlines ── */
  drawBackgroundScanlines() {
    const { ctx, theme } = this;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    this.scanlineOffset = (this.scanlineOffset + 0.3) % 4;

    ctx.save();
    ctx.globalAlpha = theme.scanlineAlpha;
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 1;
    for (let y = this.scanlineOffset; y < h; y += 4) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();

    // Glitch theme: random static noise blocks
    if (this.themeName === 'glitch' && Math.random() < 0.06) {
      ctx.save();
      const blockCount = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < blockCount; i++) {
        ctx.globalAlpha = 0.03 + Math.random() * 0.05;
        ctx.fillStyle = Math.random() > 0.5 ? '#0ff' : '#f0f';
        const bx = Math.random() * w;
        const by = Math.random() * h;
        ctx.fillRect(bx, by, 10 + Math.random() * 60, 1 + Math.random() * 3);
      }
      ctx.restore();
    }

  }

  /* ── Scan line sweeping across active word ── */
  drawScanLine(wordRect, progress, isError = false) {
    const { ctx, theme } = this;
    const x = wordRect.x + wordRect.w * progress;
    const color = isError ? theme.error : theme.accent;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(x, wordRect.y - 4);
    ctx.lineTo(x, wordRect.y + wordRect.h + 4);
    ctx.stroke();

    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 8;
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.moveTo(x, wordRect.y - 4);
    ctx.lineTo(x, wordRect.y + wordRect.h + 4);
    ctx.stroke();
    ctx.restore();

    if (Math.random() < 0.4) {
      this.addParticle(x, wordRect.y + Math.random() * wordRect.h, color);
    }
  }

  /* ── Grid sweep: concentric circles from word center ── */
  drawGridSweep(wordRect, progress) {
    const { ctx, theme } = this;
    const cx = wordRect.x + wordRect.w / 2;
    const cy = wordRect.y + wordRect.h / 2;
    const maxR = Math.max(wordRect.w, wordRect.h) * 1.2;

    ctx.save();
    ctx.globalAlpha = 0.15 * (1 - progress);
    ctx.strokeStyle = theme.particle;
    ctx.lineWidth = 1;
    ctx.shadowColor = theme.particle;
    ctx.shadowBlur = 8;

    const rings = 3;
    for (let i = 1; i <= rings; i++) {
      const r = maxR * progress * (i / rings);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    const spokes = 8;
    for (let i = 0; i < spokes; i++) {
      const angle = (i / spokes) * Math.PI * 2;
      const r = maxR * progress;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ── Error glitch ── */
  drawErrorGlitch(wordRect, battlePhase) {
    const { ctx, theme } = this;
    const sliceCount = 4 + Math.floor(Math.random() * 4);
    const intensity = Math.sin(battlePhase * Math.PI) * 0.6;

    ctx.save();
    for (let i = 0; i < sliceCount; i++) {
      const sliceY = wordRect.y + (wordRect.h / sliceCount) * i;
      const sliceH = wordRect.h / sliceCount;
      const offsetX = (Math.random() - 0.5) * 12 * intensity;

      ctx.globalAlpha = 0.15 * intensity;
      ctx.fillStyle = theme.error;
      ctx.fillRect(wordRect.x + offsetX - 2, sliceY, wordRect.w + 4, sliceH);

      ctx.fillStyle = theme.accent;
      ctx.fillRect(wordRect.x - offsetX - 2, sliceY, wordRect.w + 4, sliceH);
    }

    ctx.globalAlpha = 0.3 * intensity;
    ctx.strokeStyle = theme.error;
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const cutX = wordRect.x + Math.random() * wordRect.w;
      ctx.beginPath();
      ctx.moveTo(cutX, wordRect.y - 6);
      ctx.lineTo(cutX, wordRect.y + wordRect.h + 6);
      ctx.stroke();
    }

    ctx.globalAlpha = 0.08 * intensity;
    ctx.fillStyle = theme.error;
    ctx.fillRect(wordRect.x - 4, wordRect.y - 4, wordRect.w + 8, wordRect.h + 8);
    ctx.restore();
  }

  /* ── Particle system ── */
  addParticle(x, y, color) {
    this.particles.push({
      x, y, color,
      vx: (Math.random() - 0.5) * 2,
      vy: (Math.random() - 0.5) * 2 - 1,
      life: 1,
      size: 2 + Math.random() * 3
    });
    if (this.particles.length > 80) this.particles.shift();
  }

  updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.97;
      p.vy *= 0.97;
      p.life -= dt * 1.8;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  renderParticles() {
    const { ctx } = this;
    ctx.save();
    for (const p of this.particles) {
      ctx.globalAlpha = p.life * 0.7;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 6;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.restore();
  }

  /* ── Neon trail ── */
  updateNeonTrail(wordRect) {
    if (!wordRect) return;
    this.neonTrail.push({
      x: wordRect.x + wordRect.w / 2,
      y: wordRect.y + wordRect.h / 2,
      alpha: 1
    });
    if (this.neonTrail.length > 20) this.neonTrail.shift();
    for (const pt of this.neonTrail) {
      pt.alpha *= 0.92;
    }
  }

  renderNeonTrail() {
    const { ctx, theme } = this;
    if (this.neonTrail.length < 2) return;
    ctx.save();
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2;
    ctx.shadowColor = theme.accent;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(this.neonTrail[0].x, this.neonTrail[0].y);
    for (let i = 1; i < this.neonTrail.length; i++) {
      ctx.globalAlpha = this.neonTrail[i].alpha * 0.4;
      ctx.lineTo(this.neonTrail[i].x, this.neonTrail[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /* ── Main update / render ── */
  update(dt) {
    this.time += dt;
    this.updateParticles(dt);
  }

  render() {
    this.renderNeonTrail();
    this.renderParticles();
  }
}
