/**
 * BeatPlayer — Unified facade over LofiEngine, MegaManEngine, ZeldaIIEngine.
 * Single import, single constructor, consistent API for any PWA.
 *
 * Usage:
 *   import { BeatPlayer } from './js/beat-player.js';
 *   const player = new BeatPlayer(audioContext);
 *   player.output.connect(audioContext.destination);
 *   player.setStyle('lofi');
 *   player.setTempo(80);
 *   player.setVolume(0.7);
 *   player.start();
 */

import { LofiEngine } from './lofi-engine.js';
import { MegaManEngine } from './megaman-engine.js';
import { ZeldaIIEngine } from './zelda2-engine.js';
import { Lofi4Engine } from './lofi4-engine.js';
import { BrambleEngine } from './bramble-engine.js';
import { Bossa2Engine } from './bossa2-engine.js';

const STANDALONE = {
  megaman: MegaManEngine,
  zelda2: ZeldaIIEngine,
  lofi4: Lofi4Engine,
  bramble: BrambleEngine,
  bossa2: Bossa2Engine,
};

export class BeatPlayer {
  constructor(ctx) {
    this._ctx = ctx;
    this._engines = {};   // lazy-created, keyed by engine class name
    this._active = null;
    this._style = null;

    // Unified output — connect this to destination or another node
    this.output = ctx.createGain();
    this.output.gain.value = 1.0;
  }

  /** All available style names. */
  static get STYLES() {
    return [
      'lofi', 'lofi4', 'bramble', 'jazzhop', 'ambient', 'bossa', 'lounge',
      'chiptune', 'classical', 'trap', 'zelda',
      'megaman', 'zelda2',
      'bossa2',
      'bossa-piano', 'jazzhop-piano', 'chiptune-piano', 'lounge-piano',
    ];
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _getEngine(style) {
    const Ctor = STANDALONE[style];
    const key = Ctor ? style : 'lofi';
    if (!this._engines[key]) {
      const e = Ctor ? new Ctor(this._ctx) : new LofiEngine(this._ctx);
      e.output.connect(this.output);
      this._engines[key] = e;
    }
    return this._engines[key];
  }

  // ── Public API ────────────────────────────────────────────────────────────

  setStyle(style) {
    const engine = this._getEngine(style);
    if (this._active && this._active !== engine && this._active.isPlaying) {
      this._active.stop();
    }
    this._active = engine;
    this._style = style;
    if (!STANDALONE[style]) engine.setStyle(style);
  }

  start() { this._active && this._active.start(); }
  stop()  { this._active && this._active.stop(); }
  pause() { this._active && this._active.pause(); }
  resume(){ this._active && this._active.resume(); }

  dispose() {
    Object.values(this._engines).forEach(e => e.dispose());
    this._engines = {};
    this._active = null;
  }

  setTempo(bpm)           { this._active && this._active.setTempo(bpm); }
  setVolume(v)            { this.output.gain.value = v; }
  setOverlayLevel(level)  { this._active && this._active.setOverlayLevel(level); }
  setDensity(d)           { this._active && this._active.setDensity(d); }
  setSentenceAligned(on)  { this._active && this._active.setSentenceAligned(on); }
  advanceChord()          { this._active && this._active.advanceChord(); }

  get isPlaying()  { return this._active ? this._active.isPlaying : false; }
  get currentBpm() { return this._active ? this._active.currentBpm : 0; }
  get style()      { return this._style; }

  getBeatPhase() { return this._active ? this._active.getBeatPhase() : 0; }
}
