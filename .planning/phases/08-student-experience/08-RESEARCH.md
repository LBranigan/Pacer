# Phase 8: Student Experience - Research

**Researched:** 2026-02-02
**Domain:** Canvas animation, gamification UI, audio-synced playback
**Confidence:** HIGH

## Summary

This phase adds a student-facing animated playback view where a character hops across words in sync with audio, battles enemies at error words, and displays gamified feedback (points, streaks, progress rings). The codebase is vanilla JS with no framework and already has Canvas rendering (celeration chart) and word-synced audio playback via requestAnimationFrame.

The standard approach is to use Canvas 2D for character/enemy animation (consistent with existing celeration chart pattern), extend the existing `createSyncedPlayback` architecture for the word-hopping sync loop, and build gamification scoring as a pure computation module with DOM-based UI for feedback display.

**Primary recommendation:** Build all animation on Canvas 2D using sprite sheets, reuse the existing `requestAnimationFrame` sync loop pattern from `audio-playback.js`, and keep scoring logic in a separate pure module.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Canvas 2D API | native | Character animation, sprite rendering | Already used in celeration-chart.js, zero dependencies |
| Web Animations API | native | CSS-driven effects (progress rings, streak popups) | No library needed for simple transitions |
| requestAnimationFrame | native | Sync animation to audio currentTime | Already proven in audio-playback.js syncLoop |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None | - | - | No external libraries needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Canvas 2D sprites | CSS animations on DOM elements | DOM approach simpler for few elements but Canvas scales better for particle effects, consistent with codebase |
| SVG animation | SMIL/CSS | More complex, less control over frame-by-frame sync |
| Lottie/rive | Web animation libraries | Adds dependency, overkill for simple character animation in a no-bundler vanilla JS project |

## Architecture Patterns

### Recommended Project Structure
```
js/
├── student-playback.js    # Main orchestrator: canvas + audio sync + UI
├── sprite-animator.js     # Canvas sprite sheet renderer (character, enemies)
├── gamification.js        # Pure scoring logic: points, streaks, levels
└── (existing files unchanged)
```

### Pattern 1: Audio-Synced Canvas Animation
**What:** Extend the existing syncLoop pattern from audio-playback.js. On each rAF tick, read `audioEl.currentTime`, determine current word index from `wordTimings`, position character sprite at that word's DOM/canvas position, and trigger battle animation if word is an error.
**When to use:** Always - this is the core mechanism.
**Example:**
```javascript
// Reuse wordTimings from audio-playback.js pattern
function animationLoop() {
  if (audioEl.paused) return;
  const ct = audioEl.currentTime;
  const currentWordIdx = wordTimings.findIndex(
    (t, i) => t && ct >= t.start && ct < t.end
  );

  // Position character at current word
  if (currentWordIdx >= 0) {
    const wordEl = wordEls[currentWordIdx];
    const rect = wordEl.getBoundingClientRect();
    drawCharacter(ctx, rect.left - canvasRect.left, rect.top - canvasRect.top - 40);

    // Check if this word is an error
    const entry = alignment[currentWordIdx];
    if (entry.type !== 'correct') {
      drawBattle(ctx, rect.left - canvasRect.left, rect.top - canvasRect.top);
    }
  }
  requestAnimationFrame(animationLoop);
}
```

### Pattern 2: Overlay Canvas on Word Area
**What:** Position a transparent canvas absolutely over the word display area. Words remain as DOM `<span>` elements (reusing playback-words pattern). Character sprite is drawn on the overlay canvas at the position of the current highlighted word.
**When to use:** Best approach - keeps word highlighting in DOM (simple CSS), puts animation in Canvas (performant).
**Example:**
```javascript
const overlay = document.createElement('canvas');
overlay.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
// Size to match word area
overlay.width = wordArea.offsetWidth * dpr;
overlay.height = wordArea.offsetHeight * dpr;
wordArea.style.position = 'relative';
wordArea.appendChild(overlay);
```

### Pattern 3: Pure Scoring Module
**What:** Gamification logic as pure functions with no DOM dependency. Takes alignment array + diagnostics, returns scores object.
**When to use:** Always - enables testing and separation of concerns.
**Example:**
```javascript
// gamification.js
export function calculateScore(alignment, diagnostics) {
  let points = 0;
  let streak = 0;
  let maxStreak = 0;
  const wordScores = [];

  for (const entry of alignment) {
    if (entry.type === 'correct') {
      streak++;
      points += 10 + Math.min(streak, 10) * 2; // streak bonus
      maxStreak = Math.max(maxStreak, streak);
    } else {
      streak = 0;
      if (entry.type === 'substitution') points += 3; // partial credit
    }
    wordScores.push({ type: entry.type, points, streak });
  }

  return { totalPoints: points, maxStreak, wordScores, accuracy: /*...*/ };
}
```

### Anti-Patterns to Avoid
- **Heavy animation library for simple sprites:** Do not add Lottie, PixiJS, or similar. The character is a simple sprite sheet; Canvas 2D is sufficient and matches the codebase.
- **Rendering words on Canvas instead of DOM:** Keep words as `<span>` elements. DOM handles text layout, line wrapping, and accessibility. Canvas overlay handles only the character/enemy animation.
- **Coupling scoring to rendering:** Keep gamification.js pure. The renderer reads the score data; it does not compute it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Progress ring / circular progress | Custom arc math from scratch | SVG `<circle>` with `stroke-dasharray` + `stroke-dashoffset` | 5 lines of SVG, animatable with CSS transitions, resolution-independent |
| Sprite sheet animation | Manual frame tracking | Simple sprite class with frameWidth, frameCount, fps, elapsed tracking | Standard pattern, but keep it simple (~30 lines) |
| Easing functions | Custom bezier math | CSS transitions for DOM elements; for Canvas, use standard `ease-out: t * (2 - t)` | Well-known formula |

## Common Pitfalls

### Pitfall 1: Canvas Sizing on Resize
**What goes wrong:** Canvas overlay gets out of sync with word area after window resize or word reflow.
**Why it happens:** Canvas dimensions are set once but word area can reflow.
**How to avoid:** Use ResizeObserver (already used in celeration-chart.js) to resize overlay canvas when word area dimensions change.
**Warning signs:** Character appears offset from words.

### Pitfall 2: Audio-Animation Desync
**What goes wrong:** Character position lags behind or jumps ahead of audio.
**Why it happens:** Using setInterval instead of rAF, or not reading currentTime each frame.
**How to avoid:** Always read `audioEl.currentTime` in the rAF callback. Never cache or predict time.
**Warning signs:** Character and highlighted word diverge.

### Pitfall 3: Omission Words Have No Timing
**What goes wrong:** Trying to animate character at omitted words (which have null timing).
**Why it happens:** Omissions exist in alignment but have no STT timestamp.
**How to avoid:** Skip omission entries in the hop sequence, or show them as "skipped" with a quick visual indicator (character jumps over them).
**Warning signs:** Character freezes or errors at omission positions.

### Pitfall 4: Performance on Low-End Devices
**What goes wrong:** Animation stutters on Chromebooks (common in schools).
**Why it happens:** Too many draw calls per frame, large canvas, unoptimized sprites.
**How to avoid:** Keep canvas overlay sized to word area only (not full screen). Use simple sprites (single draw per frame). Skip particle effects. Target 30fps minimum.
**Warning signs:** rAF callback takes >16ms.

### Pitfall 5: Accessibility for Target Users
**What goes wrong:** Struggling readers get frustrated by battle animations showing their errors.
**Why it happens:** Gamification can feel punitive if error feedback is too negative.
**How to avoid:** Frame battles as "challenges overcome" not "failures." Character always wins the battle. Use encouraging language. Keep error indication brief. Focus rewards on streaks and improvement.
**Warning signs:** User testing shows anxiety or avoidance.

## Code Examples

### Sprite Sheet Renderer
```javascript
// sprite-animator.js
export class SpriteAnimator {
  constructor(imageSrc, frameWidth, frameHeight, frameCount, fps = 12) {
    this.img = new Image();
    this.img.src = imageSrc;
    this.frameWidth = frameWidth;
    this.frameHeight = frameHeight;
    this.frameCount = frameCount;
    this.frameDuration = 1000 / fps;
    this.currentFrame = 0;
    this.elapsed = 0;
    this.ready = false;
    this.img.onload = () => { this.ready = true; };
  }

  update(dt) {
    this.elapsed += dt;
    if (this.elapsed >= this.frameDuration) {
      this.currentFrame = (this.currentFrame + 1) % this.frameCount;
      this.elapsed = 0;
    }
  }

  draw(ctx, x, y, scale = 1) {
    if (!this.ready) return;
    ctx.drawImage(
      this.img,
      this.currentFrame * this.frameWidth, 0,
      this.frameWidth, this.frameHeight,
      x, y,
      this.frameWidth * scale, this.frameHeight * scale
    );
  }
}
```

### SVG Progress Ring
```html
<svg class="progress-ring" width="80" height="80">
  <circle cx="40" cy="40" r="34" stroke="#e0e0e0" stroke-width="6" fill="none"/>
  <circle class="progress-ring__circle" cx="40" cy="40" r="34"
    stroke="#4caf50" stroke-width="6" fill="none"
    stroke-dasharray="213.6" stroke-dashoffset="213.6"
    style="transition: stroke-dashoffset 0.5s ease-out;
           transform: rotate(-90deg); transform-origin: 50% 50%;"/>
</svg>
```
```javascript
function setProgress(circle, percent) {
  const circumference = 2 * Math.PI * 34; // r=34
  circle.style.strokeDashoffset = circumference * (1 - percent / 100);
}
```

### Determining Struggle Words from Existing Data
```javascript
// Combine alignment errors + diagnostic onset delays + long pauses
function getStruggleWords(alignment, diagnostics) {
  const struggles = new Set();

  // Alignment errors
  alignment.forEach((entry, i) => {
    if (entry.type !== 'correct') struggles.add(i);
  });

  // Onset delays (long hesitation before word)
  (diagnostics.onsetDelays || []).forEach(d => {
    struggles.add(d.wordIndex);
  });

  return struggles;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| GIF animations | Sprite sheets on Canvas | Long established | Smaller files, more control |
| jQuery animations | Web Animations API / CSS transitions | ~2020 | No dependency needed |
| Manual DPI handling | `devicePixelRatio` + ResizeObserver | Standard | Already used in celeration-chart.js |

## Open Questions

1. **Character Art Assets**
   - What we know: Need a sprite sheet for hop/idle/battle states
   - What's unclear: Are art assets provided, or must we use placeholder/generated art?
   - Recommendation: Start with simple geometric placeholder (colored circle with face) that can be swapped for real art later. Define a clear sprite interface.

2. **Enemy Art at Struggle Words**
   - What we know: Character should "battle" at error words
   - What's unclear: What does the enemy look like? Is it the same enemy or different per error type?
   - Recommendation: Single enemy type initially. Simple obstacle (spiky shape). Can differentiate later.

3. **Points/Levels Persistence**
   - What we know: localStorage already stores assessments
   - What's unclear: Should cumulative points/levels persist across sessions?
   - Recommendation: Add a `gamification` field to the student record in storage.js. Store totalPoints, level, bestStreak.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `js/audio-playback.js` - existing word-sync pattern with rAF
- Codebase analysis: `js/celeration-chart.js` - existing Canvas 2D rendering pattern
- Codebase analysis: `js/diagnostics.js` - existing struggle detection (onset delays, long pauses, self-corrections)
- Codebase analysis: `js/storage.js` - localStorage data model

### Secondary (MEDIUM confidence)
- Canvas 2D sprite sheet rendering is a well-established pattern (training data, widely documented)
- SVG progress ring with stroke-dashoffset is standard technique

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no external libraries, all native APIs already used in codebase
- Architecture: HIGH - extends existing patterns (audio-playback syncLoop, canvas overlay, pure modules)
- Pitfalls: HIGH - derived from direct codebase analysis (null timings for omissions, resize handling)

**Research date:** 2026-02-02
**Valid until:** 2026-03-04 (stable domain, no fast-moving dependencies)
