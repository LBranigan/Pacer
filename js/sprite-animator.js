/**
 * Canvas sprite animator -- pure drawing utility, no DOM manipulation or imports.
 * Renders animated character states on a Canvas 2D context.
 */

export class SpriteAnimator {
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} [options]
   * @param {number} [options.size=32]
   * @param {string} [options.color='#4CAF50']
   * @param {string} [options.battleColor='#F44336']
   */
  constructor(ctx, options = {}) {
    this.ctx = ctx;
    this.size = options.size || 32;
    this.color = options.color || '#4CAF50';
    this.battleColor = options.battleColor || '#F44336';
  }

  /**
   * Draw idle character -- colored circle with simple face.
   */
  drawIdle(x, y) {
    const { ctx, size, color } = this;
    const r = size / 2;

    // Body circle
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Eyes
    const eyeY = y - r * 0.15;
    const eyeSpacing = r * 0.3;
    const eyeR = r * 0.1;
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(x - eyeSpacing, eyeY, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + eyeSpacing, eyeY, eyeR, 0, Math.PI * 2);
    ctx.fill();

    // Smile arc
    ctx.beginPath();
    ctx.arc(x, y + r * 0.05, r * 0.3, 0.1 * Math.PI, 0.9 * Math.PI);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  /**
   * Draw hopping character with parabolic y-offset.
   * @param {number} hopPhase - 0 to 1 (one hop cycle)
   */
  drawHop(x, y, hopPhase) {
    const { size } = this;
    const yOffset = -Math.sin(hopPhase * Math.PI) * size * 0.8;

    // Squash at landing (phase near 0 or 1)
    const squash = 1 - 0.2 * (1 - Math.sin(hopPhase * Math.PI));
    const { ctx } = this;

    ctx.save();
    ctx.translate(x, y + yOffset);
    ctx.scale(1 / squash, squash);
    this.drawIdle(0, 0);
    ctx.restore();
  }

  /**
   * Draw battling character -- shakes, color transitions, enemy shrinks.
   * @param {number} battlePhase - 0 to 1 (battle progress)
   */
  drawBattle(x, y, battlePhase) {
    const { ctx, size, color, battleColor } = this;
    const r = size / 2;

    // Shake offset
    const shakeX = (Math.random() - 0.5) * 4 * (1 - battlePhase);

    // Lerp color toward battleColor
    const lerp = (a, b, t) => Math.round(a + (b - a) * t);
    const parseHex = (hex) => [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16)
    ];
    const c1 = parseHex(color);
    const c2 = parseHex(battleColor);
    const t = Math.min(battlePhase, 1);
    const mixed = `rgb(${lerp(c1[0], c2[0], t)},${lerp(c1[1], c2[1], t)},${lerp(c1[2], c2[2], t)})`;

    // Character body
    ctx.beginPath();
    ctx.arc(x + shakeX, y, r, 0, Math.PI * 2);
    ctx.fillStyle = mixed;
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Eyes (determined look)
    const eyeY = y - r * 0.15;
    const eyeSpacing = r * 0.3;
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(x + shakeX - eyeSpacing, eyeY, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + shakeX + eyeSpacing, eyeY, r * 0.12, 0, Math.PI * 2);
    ctx.fill();

    // Enemy obstacle (shrinks as battlePhase increases)
    const enemyScale = 1 - battlePhase;
    if (enemyScale > 0.01) {
      this.drawEnemy(x + size * 2, y, enemyScale);
    }
  }

  /**
   * Draw enemy -- red spiky circle with 8 points.
   * @param {number} scale - 0 to 1 controls size
   */
  drawEnemy(x, y, scale) {
    if (scale <= 0) return;
    const { ctx, size } = this;
    const r = (size / 2) * scale;
    const spikes = 8;
    const outerR = r * 1.4;
    const innerR = r * 0.8;

    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const angle = (i * Math.PI) / spikes - Math.PI / 2;
      const radius = i % 2 === 0 ? outerR : innerR;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
    ctx.fillStyle = '#F44336';
    ctx.fill();
    ctx.strokeStyle = '#B71C1C';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Enemy eyes
    const eyeSpacing = r * 0.25;
    const eyeR = r * 0.12;
    ctx.fillStyle = '#FFF';
    ctx.beginPath();
    ctx.arc(x - eyeSpacing, y - r * 0.1, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + eyeSpacing, y - r * 0.1, eyeR, 0, Math.PI * 2);
    ctx.fill();
  }
}
