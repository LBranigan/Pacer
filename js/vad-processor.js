/**
 * VADProcessor - Voice Activity Detection for ghost word detection
 * Phase 12: VAD Integration
 *
 * Uses Silero VAD via @ricky0123/vad-web to detect speech segments
 * in recorded audio. Used to flag hallucinated words (ghosts) where
 * ASR reported speech but VAD detected silence.
 */

// Threshold constants - per CONTEXT.md: slider range 0.15-0.60, default middle
export const VAD_THRESHOLD_DEFAULT = 0.375;
export const VAD_THRESHOLD_MIN = 0.15;
export const VAD_THRESHOLD_MAX = 0.60;

// Presets for common environments - per RESEARCH.md
export const VAD_PRESETS = {
  quietRoom: 0.20,   // Low threshold - detects quiet speech, some false positives in noisy env
  normal: 0.375,     // Default middle - balanced detection
  noisy: 0.50        // High threshold - reduces false positives in noisy environments
};

/**
 * VADProcessor class - processes audio blobs and returns speech segments
 */
class VADProcessor {
  constructor() {
    this.isLoaded = false;
    this.loadError = null;
    this.threshold = VAD_THRESHOLD_DEFAULT;
  }

  /**
   * Initialize VAD by verifying ONNX loads successfully
   * Call once on app startup to pre-verify VAD availability
   */
  async init() {
    try {
      // Check if vad global is available (from CDN script)
      if (typeof vad === 'undefined' || !vad.NonRealTimeVAD) {
        throw new Error('vad-web library not loaded. Check CDN script tags.');
      }

      // Try to create a test NonRealTimeVAD instance to verify ONNX loads
      // This will download the ONNX model and initialize WASM
      const testInstance = await vad.NonRealTimeVAD.new({
        positiveSpeechThreshold: this.threshold,
        negativeSpeechThreshold: this.threshold - 0.10
      });

      this.isLoaded = true;
      console.log('[VAD] Initialized successfully');
    } catch (err) {
      this.loadError = err.message;
      console.warn('[VAD] Failed to load:', err.message);
    }
  }

  /**
   * Process an audio blob and return speech segments with timestamps
   * @param {Blob} audioBlob - The recorded/uploaded audio blob
   * @returns {Promise<{segments: Array<{start: number, end: number}>, durationMs: number, error: string|null}>}
   */
  async processAudio(audioBlob) {
    if (!this.isLoaded) {
      return {
        segments: [],
        durationMs: 0,
        error: this.loadError || 'VAD not loaded'
      };
    }

    let audioContext = null;

    try {
      // Create AudioContext with 16kHz sample rate (Silero's expected rate)
      audioContext = new AudioContext({ sampleRate: 16000 });

      // Decode blob to AudioBuffer
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      // Get mono channel data
      const audioData = audioBuffer.getChannelData(0);
      const sampleRate = audioBuffer.sampleRate;

      // Calculate duration in milliseconds
      const durationMs = (audioData.length / sampleRate) * 1000;

      // Create NonRealTimeVAD instance with current threshold settings
      const vadInstance = await vad.NonRealTimeVAD.new({
        positiveSpeechThreshold: this.threshold,
        negativeSpeechThreshold: this.threshold - 0.10,
        redemptionMs: 200,      // Short for word-level detection
        minSpeechMs: 50,        // Allow short words
        preSpeechPadMs: 30
      });

      // Collect speech segments
      const segments = [];
      for await (const { start, end } of vadInstance.run(audioData, sampleRate)) {
        segments.push({ start, end }); // Already in milliseconds
      }

      console.log(`[VAD] Processed ${Math.round(durationMs)}ms audio, found ${segments.length} speech segments`);

      return {
        segments,
        durationMs,
        error: null
      };
    } catch (err) {
      console.warn('[VAD] Processing error:', err.message);
      return {
        segments: [],
        durationMs: 0,
        error: err.message
      };
    } finally {
      // Clean up AudioContext
      if (audioContext) {
        try {
          await audioContext.close();
        } catch (e) {
          // Ignore close errors
        }
      }
    }
  }

  /**
   * Set the VAD speech detection threshold
   * @param {number} value - Threshold value (will be clamped to MIN/MAX range)
   */
  setThreshold(value) {
    this.threshold = Math.min(VAD_THRESHOLD_MAX, Math.max(VAD_THRESHOLD_MIN, value));
    console.log(`[VAD] Threshold set to ${this.threshold.toFixed(3)}`);
  }

  /**
   * Get the current VAD threshold
   * @returns {number} Current threshold value
   */
  getThreshold() {
    return this.threshold;
  }
}

// Export singleton instance
export const vadProcessor = new VADProcessor();
