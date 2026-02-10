/**
 * Audio padding utility for terminal word clarity.
 *
 * ASR models use a "lookahead window" to resolve final phonemes.
 * If audio ends exactly when the last word ends, the model has zero
 * future context, leading to poor transcription of trailing words.
 *
 * Solution: Append silence to give the ASR model context to resolve
 * the final phonemes properly.
 *
 * Audio quality: All browser processing (AGC, noiseSuppression, echoCancellation)
 * is OFF in recorder.js. Recording at 48kHz/128kbps Opus. Both Reverb and Parakeet
 * handle their own internal normalization during feature extraction, so we pass
 * the raw signal through untouched.
 */

const PADDING_DURATION_MS = 1000; // 1000ms of silence — CTC models need ≥1s trailing context

/**
 * Append silence to an audio blob.
 * Creates a new blob with the original audio + padding silence.
 *
 * @param {Blob} audioBlob - Original audio blob
 * @param {number} paddingMs - Duration of silence to add (default 1000ms)
 * @returns {Promise<{blob: Blob, sampleRate: number}>} New blob with silence and sample rate
 */
export async function padAudioWithSilence(audioBlob, paddingMs = PADDING_DURATION_MS) {
  try {
    // Decode original audio
    const audioContext = new AudioContext();
    const arrayBuffer = await audioBlob.arrayBuffer();
    const originalBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // Calculate padding samples
    const sampleRate = originalBuffer.sampleRate;
    const paddingSamples = Math.floor((paddingMs / 1000) * sampleRate);
    const totalSamples = originalBuffer.length + paddingSamples;

    // Create new buffer with padding
    const paddedBuffer = audioContext.createBuffer(
      originalBuffer.numberOfChannels,
      totalSamples,
      sampleRate
    );

    // Copy original data and add silence (zeros)
    for (let channel = 0; channel < originalBuffer.numberOfChannels; channel++) {
      const originalData = originalBuffer.getChannelData(channel);
      const paddedData = paddedBuffer.getChannelData(channel);

      // Copy original samples
      paddedData.set(originalData);
      // Silence is already zeros (default Float32Array values)
    }

    // Encode back to WAV
    const wavBlob = encodeWAV(paddedBuffer);

    await audioContext.close();

    console.log(`[Audio] Padded audio with ${paddingMs}ms silence (${paddingSamples} samples at ${sampleRate}Hz)`);

    return { blob: wavBlob, sampleRate };
  } catch (err) {
    console.warn('[Audio] Padding failed, using original:', err.message);
    return { blob: audioBlob, sampleRate: null }; // Fall back to original if padding fails
  }
}

/**
 * Encode AudioBuffer to WAV blob.
 * @param {AudioBuffer} buffer - Audio buffer to encode
 * @returns {Blob} WAV blob
 */
function encodeWAV(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  // Interleave channels
  let interleaved;
  if (numChannels === 2) {
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    interleaved = new Float32Array(left.length + right.length);
    for (let i = 0, j = 0; i < left.length; i++, j += 2) {
      interleaved[j] = left[i];
      interleaved[j + 1] = right[i];
    }
  } else {
    interleaved = buffer.getChannelData(0);
  }

  // Create DataView for WAV
  const dataLength = interleaved.length * (bitDepth / 8);
  const wavBuffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(wavBuffer);

  // WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
  view.setUint16(32, numChannels * (bitDepth / 8), true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  // Write audio data
  const offset = 44;
  for (let i = 0; i < interleaved.length; i++) {
    const sample = Math.max(-1, Math.min(1, interleaved[i]));
    const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    view.setInt16(offset + i * 2, int16, true);
  }

  return new Blob([wavBuffer], { type: 'audio/wav' });
}

/**
 * Write string to DataView.
 */
function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
