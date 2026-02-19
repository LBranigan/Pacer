#!/usr/bin/env python3
"""
Drum one-shot sample generator for PACER Rhythm Remix beat engine.
Generates professional-quality WAV samples for 5 styles using numpy + scipy.

Styles: trap, lofi, jazzhop, bossa, chiptune
Output: mono 44100Hz 16-bit PCM WAV files
"""

import os
import numpy as np
from scipy import signal as sig
from scipy.io import wavfile

# ──────────────────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────────────────
SR = 44100
PEAK_DBFS = -1.0  # Target peak in dBFS
PEAK_AMP = 10 ** (PEAK_DBFS / 20.0)  # ~0.891
SILENCE_THRESHOLD_DB = -60.0
SILENCE_AMP = 10 ** (SILENCE_THRESHOLD_DB / 20.0)

# TR-808 hi-hat oscillator frequencies
HAT_FREQS = [205.3, 304.4, 369.6, 523.3, 800.0, 1096.5]

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "samples")


# ──────────────────────────────────────────────────────────
# Utility functions
# ──────────────────────────────────────────────────────────
def make_time(duration_s):
    """Generate time array for given duration."""
    return np.arange(int(SR * duration_s)) / SR


def saturate(x, drive=1.0):
    """Tanh saturation."""
    return np.tanh(x * drive)


def exp_sweep(t, f_start, f_end, sweep_time):
    """Exponential frequency sweep. Returns instantaneous phase signal (sine)."""
    # Clamp t to sweep_time for the sweep portion
    t_clamped = np.minimum(t, sweep_time)
    ratio = f_end / f_start
    # Instantaneous frequency: f_start * ratio^(t/sweep_time)
    # Phase integral: f_start * sweep_time / ln(ratio) * (ratio^(t/T) - 1)
    if abs(ratio - 1.0) < 1e-6:
        phase = 2 * np.pi * f_start * t_clamped
    else:
        phase = 2 * np.pi * f_start * sweep_time / np.log(ratio) * (
            ratio ** (t_clamped / sweep_time) - 1.0
        )
    return np.sin(phase)


def exp_sweep_freq(t, f_start, f_end, sweep_time):
    """Return instantaneous frequency at each time point."""
    t_clamped = np.minimum(t, sweep_time)
    ratio = f_end / f_start
    if abs(ratio - 1.0) < 1e-6:
        return np.full_like(t, f_start)
    return f_start * ratio ** (t_clamped / sweep_time)


def exp_envelope(t, decay_time):
    """Exponential decay envelope."""
    return np.exp(-t / max(decay_time, 1e-6))


def bandpass(x, low, high, order=4):
    """Butterworth bandpass filter."""
    nyq = SR / 2
    low_n = max(low / nyq, 0.001)
    high_n = min(high / nyq, 0.999)
    if low_n >= high_n:
        return x
    sos = sig.butter(order, [low_n, high_n], btype='band', output='sos')
    return sig.sosfilt(sos, x)


def highpass(x, freq, order=4):
    """Butterworth highpass filter."""
    nyq = SR / 2
    wn = max(freq / nyq, 0.001)
    wn = min(wn, 0.999)
    sos = sig.butter(order, wn, btype='high', output='sos')
    return sig.sosfilt(sos, x)


def lowpass(x, freq, order=4):
    """Butterworth lowpass filter."""
    nyq = SR / 2
    wn = min(freq / nyq, 0.999)
    wn = max(wn, 0.001)
    sos = sig.butter(order, wn, btype='low', output='sos')
    return sig.sosfilt(sos, x)


def bandpass_resonant(x, center, q=1.0):
    """Resonant bandpass using second-order section."""
    nyq = SR / 2
    wn = min(center / nyq, 0.999)
    wn = max(wn, 0.001)
    bw = wn / max(q, 0.1)
    low = max(wn - bw / 2, 0.001)
    high = min(wn + bw / 2, 0.999)
    if low >= high:
        return x
    sos = sig.butter(2, [low, high], btype='band', output='sos')
    return sig.sosfilt(sos, x)


def noise(n_samples):
    """White noise."""
    return np.random.randn(n_samples)


def make_reverb_ir(duration_s, decay_time, low=200, high=8000):
    """Synthetic reverb impulse response: filtered decaying noise."""
    t = make_time(duration_s)
    ir = noise(len(t)) * exp_envelope(t, decay_time)
    ir = bandpass(ir, low, high, order=2)
    # Normalize IR
    peak = np.max(np.abs(ir))
    if peak > 0:
        ir /= peak
    return ir


def convolve_reverb(x, ir, wet=0.3):
    """Apply convolution reverb. Returns signal extended by IR length."""
    wet_signal = np.convolve(x, ir, mode='full')[:len(x) + len(ir) - 1]
    # Pad dry signal to match
    dry_padded = np.zeros(len(wet_signal))
    dry_padded[:len(x)] = x
    return dry_padded * (1 - wet) + wet_signal * wet


def compress(x, threshold_db=-12, ratio=4.0, attack_ms=5, release_ms=50):
    """Simple compressor."""
    threshold = 10 ** (threshold_db / 20.0)
    attack_samples = int(SR * attack_ms / 1000)
    release_samples = int(SR * release_ms / 1000)

    envelope = np.abs(x)
    # Smooth envelope
    smoothed = np.zeros_like(envelope)
    for i in range(len(envelope)):
        if i == 0:
            smoothed[i] = envelope[i]
        else:
            if envelope[i] > smoothed[i - 1]:
                coeff = 1.0 - np.exp(-1.0 / max(attack_samples, 1))
            else:
                coeff = 1.0 - np.exp(-1.0 / max(release_samples, 1))
            smoothed[i] = smoothed[i - 1] + coeff * (envelope[i] - smoothed[i - 1])

    # Compute gain reduction
    gain = np.ones_like(smoothed)
    above = smoothed > threshold
    if np.any(above):
        # dB domain compression
        db = 20 * np.log10(smoothed[above] + 1e-10)
        threshold_db_val = 20 * np.log10(threshold)
        compressed_db = threshold_db_val + (db - threshold_db_val) / ratio
        gain[above] = 10 ** ((compressed_db - db) / 20.0)

    return x * gain


def bitcrush(x, levels=256):
    """Bitcrushing: quantize to given number of levels."""
    half = levels / 2
    return np.round(x * half) / half


def normalize(x, target=PEAK_AMP):
    """Normalize to target peak amplitude."""
    peak = np.max(np.abs(x))
    if peak < 1e-10:
        return x
    return x * (target / peak)


def trim_silence(x, threshold=SILENCE_AMP):
    """Trim trailing silence below threshold."""
    # Find last sample above threshold
    above = np.where(np.abs(x) > threshold)[0]
    if len(above) == 0:
        return x[:SR // 10]  # Return at least 100ms
    last = above[-1]
    # Keep a tiny tail (5ms) after last audible sample
    end = min(last + int(SR * 0.005), len(x))
    return x[:end]


def dither_and_quantize(x):
    """Apply triangular dither and quantize to 16-bit."""
    # Triangular probability density dither (1 LSB amplitude)
    lsb = 1.0 / 32767.0
    dither = (np.random.random(len(x)) - np.random.random(len(x))) * lsb
    x = x + dither
    # Clip to [-1, 1]
    x = np.clip(x, -1.0, 1.0)
    # Quantize to 16-bit
    return (x * 32767).astype(np.int16)


def save_wav(filepath, data_float):
    """Full pipeline: normalize, trim, dither, save."""
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    data = trim_silence(data_float)
    data = dither_and_quantize(data)
    wavfile.write(filepath, SR, data)
    return filepath


def hat_oscillators(t, freqs=HAT_FREQS):
    """Generate mixed square oscillators at given frequencies (808-style)."""
    mix = np.zeros(len(t))
    for f in freqs:
        mix += sig.square(2 * np.pi * f * t)
    return mix / len(freqs)


# ──────────────────────────────────────────────────────────
# TRAP style (Metro Boomin / 808 style)
# ──────────────────────────────────────────────────────────
def trap_kick():
    t = make_time(1.2)

    # Click transient: 15ms noise burst, bandpass 3-5kHz
    click_dur = int(SR * 0.015)
    click = noise(click_dur)
    click = bandpass(click, 3000, 5000, order=2)
    click *= exp_envelope(make_time(0.015), 0.005)
    click_padded = np.zeros(len(t))
    click_padded[:click_dur] = click * 0.7

    # Main body: sine sweep 160->22Hz over 0.3s
    body = exp_sweep(t, 160, 22, 0.3)
    # Sustain envelope: fast attack, long decay
    body_env = np.ones(len(t))
    body_env *= exp_envelope(t, 0.5)  # Long sustain
    body *= body_env

    # Sub harmonic at 0.5x frequency
    sub = exp_sweep(t, 80, 11, 0.3)
    sub_env = exp_envelope(t, 0.6)
    sub *= sub_env * 0.5

    # Combine
    combined = click_padded + body + sub

    # Tanh saturation (drive=5)
    combined = saturate(combined, drive=5)

    # Gentle compression
    combined = compress(combined, threshold_db=-12, ratio=4.0)

    return normalize(combined)


def trap_clap():
    t_total = make_time(0.5)
    result = np.zeros(len(t_total))

    # 4 noise bursts at 12ms intervals
    burst_interval = int(SR * 0.012)
    burst_dur = int(SR * 0.008)
    for i in range(4):
        np.random.seed(42 + i * 7)  # Different seeds
        start = i * burst_interval
        if start + burst_dur > len(result):
            break
        burst = noise(burst_dur)
        burst = bandpass(burst, 1500, 3000, order=2)
        burst *= exp_envelope(make_time(burst_dur / SR), 0.003)
        result[start:start + burst_dur] += burst * (0.8 + 0.2 * np.random.random())

    np.random.seed(None)  # Reset seed

    # Reverb tail: 300ms filtered decaying noise
    tail_dur = int(SR * 0.3)
    tail_t = make_time(0.3)
    tail = noise(tail_dur) * exp_envelope(tail_t, 0.1)
    tail = bandpass(tail, 1000, 2000, order=2)
    tail_padded = np.zeros(len(t_total))
    tail_start = 4 * burst_interval
    end = min(tail_start + tail_dur, len(t_total))
    tail_padded[tail_start:end] = tail[:end - tail_start] * 0.3

    result += tail_padded

    # Convolution reverb with synthetic IR
    ir = make_reverb_ir(0.3, 0.08, 800, 4000)
    result = convolve_reverb(result, ir, wet=0.25)

    return normalize(result)


def trap_hat_closed():
    t = make_time(0.06)  # 60ms total, 40ms audible decay

    # 6 square oscillators at 808 frequencies
    osc = hat_oscillators(t)

    # Highpass 7kHz
    osc = highpass(osc, 7000, order=4)

    # Bandpass 10kHz resonance
    osc = bandpass_resonant(osc, 10000, q=1.5)

    # 40ms decay
    env = exp_envelope(t, 0.012)
    osc *= env

    # Noise layer for air
    air = noise(len(t))
    air = bandpass(air, 9000, 14000, order=2)
    air *= exp_envelope(t, 0.015)

    combined = osc * 0.6 + air * 0.4
    return normalize(combined)


def trap_hat_open():
    t = make_time(0.35)  # 350ms total, 250ms decay

    # Same oscillators
    osc = hat_oscillators(t)
    osc = highpass(osc, 7000, order=4)
    osc = bandpass_resonant(osc, 10000, q=1.5)

    # 250ms decay
    env = exp_envelope(t, 0.08)
    osc *= env

    # Slightly louder noise layer
    air = noise(len(t))
    air = bandpass(air, 9000, 14000, order=2)
    air *= exp_envelope(t, 0.1)

    combined = osc * 0.5 + air * 0.5
    return normalize(combined)


# ──────────────────────────────────────────────────────────
# LO-FI style (boom-bap, J Dilla)
# ──────────────────────────────────────────────────────────
def lofi_kick():
    t = make_time(0.4)

    # Triangle wave sweep 150->50Hz over 80ms
    freq = exp_sweep_freq(t, 150, 50, 0.08)
    phase = np.cumsum(2 * np.pi * freq / SR)
    body = sig.sawtooth(phase, width=0.5)  # Triangle wave

    # Envelope: 300ms sustain
    env = exp_envelope(t, 0.15)
    body *= env

    # Tape saturation
    body = saturate(body, drive=2)

    # Lowpass for warmth
    body = lowpass(body, 5000, order=3)

    return normalize(body)


def lofi_snare():
    t = make_time(0.4)

    # Triangle body at 180Hz, 100ms decay
    body_phase = 2 * np.pi * 180 * t
    body = sig.sawtooth(body_phase, width=0.5)
    body *= exp_envelope(t, 0.04)

    # Filtered noise burst, bandpass 2-4kHz, 150ms decay
    n = noise(len(t))
    n = bandpass(n, 2000, 4000, order=3)
    n *= exp_envelope(t, 0.06)

    combined = body * 0.5 + n * 0.6

    # Subtle room reverb
    ir = make_reverb_ir(0.2, 0.06, 500, 6000)
    combined = convolve_reverb(combined, ir, wet=0.15)

    return normalize(combined)


def lofi_hat_closed():
    t = make_time(0.07)

    osc = hat_oscillators(t)
    osc = highpass(osc, 6000, order=3)
    osc = bandpass_resonant(osc, 8000, q=0.8)

    env = exp_envelope(t, 0.015)
    osc *= env

    # Light tape saturation
    osc = saturate(osc, drive=1.5)

    return normalize(osc, target=PEAK_AMP * 0.8)


def lofi_hat_open():
    t = make_time(0.28)

    osc = hat_oscillators(t)
    osc = highpass(osc, 6000, order=3)
    osc = bandpass_resonant(osc, 8000, q=0.8)

    env = exp_envelope(t, 0.065)
    osc *= env

    osc = saturate(osc, drive=1.5)

    return normalize(osc, target=PEAK_AMP * 0.8)


# ──────────────────────────────────────────────────────────
# JAZZHOP style
# ──────────────────────────────────────────────────────────
def jazzhop_kick():
    t = make_time(0.35)

    # Same as lofi but tighter (250ms) and cleaner
    freq = exp_sweep_freq(t, 150, 50, 0.08)
    phase = np.cumsum(2 * np.pi * freq / SR)
    body = sig.sawtooth(phase, width=0.5)

    # Tighter envelope
    env = exp_envelope(t, 0.12)
    body *= env

    # Less saturation
    body = saturate(body, drive=1.2)
    body = lowpass(body, 5000, order=3)

    return normalize(body)


def jazzhop_snare():
    t = make_time(0.2)

    # Brush snare: ONLY filtered noise
    n = noise(len(t))
    n = bandpass(n, 1500, 3000, order=2)  # Wider Q via lower order

    env = exp_envelope(t, 0.04)
    n *= env

    return normalize(n, target=PEAK_AMP * 0.45)


def jazzhop_hat_closed():
    # Same as lofi
    return lofi_hat_closed()


def jazzhop_hat_open():
    # Same as lofi
    return lofi_hat_open()


# ──────────────────────────────────────────────────────────
# BOSSA style
# ──────────────────────────────────────────────────────────
def bossa_kick():
    t = make_time(0.2)

    # Soft triangle sweep 120->55Hz over 50ms
    freq = exp_sweep_freq(t, 120, 55, 0.05)
    phase = np.cumsum(2 * np.pi * freq / SR)
    body = sig.sawtooth(phase, width=0.5)

    # Short envelope, 150ms total
    env = exp_envelope(t, 0.06)
    body *= env

    # Lowpass 3kHz, no saturation
    body = lowpass(body, 3000, order=3)

    return normalize(body, target=0.5)


def bossa_rim():
    t = make_time(0.06)

    # Rim click: triangle at 800Hz, sharp attack, fast decay
    body = sig.sawtooth(2 * np.pi * 800 * t, width=0.5)
    env = exp_envelope(t, 0.008)
    body *= env

    # Add a tiny click transient
    click_samples = int(SR * 0.002)
    click = np.zeros(len(t))
    click[:click_samples] = noise(click_samples) * 0.3
    click = highpass(click, 2000, order=2)

    combined = body * 0.7 + click
    return normalize(combined)


def bossa_hat_closed():
    t = make_time(0.06)

    osc = hat_oscillators(t)
    osc = highpass(osc, 8000, order=4)

    env = exp_envelope(t, 0.01)
    osc *= env

    return normalize(osc, target=0.15)


def bossa_hat_open():
    t = make_time(0.2)

    osc = hat_oscillators(t)
    osc = highpass(osc, 8000, order=4)

    env = exp_envelope(t, 0.05)
    osc *= env

    return normalize(osc, target=0.2)


# ──────────────────────────────────────────────────────────
# CHIPTUNE style (8-bit)
# ──────────────────────────────────────────────────────────
def chiptune_kick():
    t = make_time(0.15)

    # Square wave sweep 200->40Hz over 60ms
    freq = exp_sweep_freq(t, 200, 40, 0.06)
    phase = np.cumsum(2 * np.pi * freq / SR)
    body = sig.square(phase)

    # 120ms envelope
    env = exp_envelope(t, 0.04)
    body *= env

    # Bitcrush
    body = bitcrush(body, levels=256)

    return normalize(body)


def chiptune_snare():
    t = make_time(0.1)

    # Noise burst, 60ms
    n = noise(len(t))
    noise_env = np.zeros(len(t))
    noise_dur = int(SR * 0.06)
    noise_env[:noise_dur] = exp_envelope(make_time(0.06), 0.02)
    n *= noise_env

    # Square body at 180Hz, 40ms
    body_dur = int(SR * 0.04)
    body_env = np.zeros(len(t))
    body_env[:body_dur] = exp_envelope(make_time(0.04), 0.015)
    body = sig.square(2 * np.pi * 180 * t) * body_env

    combined = n * 0.6 + body * 0.5
    combined = bitcrush(combined, levels=256)

    return normalize(combined)


def chiptune_hat_closed():
    t = make_time(0.05)

    # Very short square at ~12kHz
    # (Nyquist is 22050, so 12kHz is fine)
    osc = sig.square(2 * np.pi * 12000 * t)
    osc = highpass(osc, 8000, order=3)

    env = exp_envelope(t, 0.008)
    osc *= env

    osc = bitcrush(osc, levels=256)

    return normalize(osc)


def chiptune_hat_open():
    t = make_time(0.15)

    osc = sig.square(2 * np.pi * 12000 * t)
    osc = highpass(osc, 8000, order=3)

    env = exp_envelope(t, 0.03)
    osc *= env

    osc = bitcrush(osc, levels=256)

    return normalize(osc)


# ──────────────────────────────────────────────────────────
# Main: generate all samples
# ──────────────────────────────────────────────────────────
def main():
    styles = {
        "trap": {
            "kick.wav": trap_kick,
            "clap.wav": trap_clap,
            "hat-closed.wav": trap_hat_closed,
            "hat-open.wav": trap_hat_open,
        },
        "lofi": {
            "kick.wav": lofi_kick,
            "snare.wav": lofi_snare,
            "hat-closed.wav": lofi_hat_closed,
            "hat-open.wav": lofi_hat_open,
        },
        "jazzhop": {
            "kick.wav": jazzhop_kick,
            "snare.wav": jazzhop_snare,
            "hat-closed.wav": jazzhop_hat_closed,
            "hat-open.wav": jazzhop_hat_open,
        },
        "bossa": {
            "kick.wav": bossa_kick,
            "rim.wav": bossa_rim,
            "hat-closed.wav": bossa_hat_closed,
            "hat-open.wav": bossa_hat_open,
        },
        "chiptune": {
            "kick.wav": chiptune_kick,
            "snare.wav": chiptune_snare,
            "hat-closed.wav": chiptune_hat_closed,
            "hat-open.wav": chiptune_hat_open,
        },
    }

    generated_files = []
    total_size = 0

    for style_name, samples in styles.items():
        print(f"\n--- {style_name.upper()} ---")
        for filename, gen_fn in samples.items():
            filepath = os.path.join(OUTPUT_DIR, style_name, filename)
            try:
                data = gen_fn()
                save_wav(filepath, data)
                size = os.path.getsize(filepath)
                total_size += size
                generated_files.append((filepath, size))
                print(f"  {filename:20s} {size:>8,d} bytes  ({len(data)/SR:.3f}s)")
            except Exception as e:
                print(f"  ERROR generating {filename}: {e}")
                import traceback
                traceback.print_exc()

    print(f"\n{'='*50}")
    print(f"Total: {len(generated_files)} files, {total_size:,d} bytes ({total_size/1024:.1f} KB)")
    print(f"\nAll files:")
    for fp, sz in generated_files:
        rel = os.path.relpath(fp, OUTPUT_DIR)
        print(f"  {rel:35s} {sz:>8,d} bytes")


if __name__ == "__main__":
    main()
