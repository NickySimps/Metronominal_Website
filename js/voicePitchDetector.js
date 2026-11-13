/** Local, bounded monophonic PCM estimator. No audio is retained between calls.
 * detect(Float32Array, sampleRate) -> { voiced, frequencyHz|null, confidence, rms }.
 * Input: 256..8192 samples, 8..192 kHz. Nominal range 60..1400 Hz; a
 * frame must contain enough periods (use 4096 samples at 44.1/48 kHz).
 * Confidence is periodicity, not a calibrated probability of correct pitch.
 * Harmonics, breath, transients, noise and multiple voices can defeat it.
 * rms is DC-removed (AC) RMS. PCM must be normalized to [-1,1]; malformed,
 * oversized or nonfinite input returns an unvoiced zero result. Quiet/noisy
 * valid input returns unvoiced with its measured RMS. No device access or IO.
 * Fixed frame and lag bounds limit CPU/memory; per-call scratch is discarded.
 * Box decimation is deliberately inexpensive, not a full anti-alias filter;
 * high-frequency interference may alias. No real-voice accuracy is claimed.
 */
export class VoicePitchDetector {
  detect(pcm, sampleRate) {
    const unvoiced = (rms = 0, confidence = 0) => ({ voiced: false, frequencyHz: null, confidence, rms });
    if (!(pcm instanceof Float32Array) || pcm.length < 256 || pcm.length > 8192 ||
        !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) return unvoiced();
    let sum = 0;
    let squares = 0;
    for (const sample of pcm) {
      if (!Number.isFinite(sample) || Math.abs(sample) > 1) return unvoiced();
      sum += sample;
      squares += sample * sample;
    }
    const mean = sum / pcm.length;
    const rms = Math.sqrt(Math.max(0, squares / pcm.length - mean * mean));
    if (rms < 0.008) return unvoiced(rms);
    // Box-average decimation limits work, with a fixed upper bound on input.
    const step = Math.max(1, Math.floor(sampleRate / 12000));
    const rate = sampleRate / step;
    const n = Math.floor(pcm.length / step);
    const samples = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let value = 0;
      for (let j = 0; j < step; j++) value += pcm[i * step + j] - mean;
      samples[i] = value / step;
    }
    const minimum = Math.max(2, Math.floor(rate / 1400));
    const maximum = Math.min(Math.ceil(rate / 60), Math.floor(n / 3));
    if (maximum <= minimum) return unvoiced(rms);
    const difference = new Float64Array(maximum + 2);
    const window = n - maximum - 1;
    let cumulative = 0;
    difference[0] = 1;
    for (let lag = 1; lag <= maximum + 1; lag++) {
      let energy = 0;
      for (let i = 0; i < window; i++) {
        const delta = samples[i] - samples[i + lag];
        energy += delta * delta;
      }
      cumulative += energy;
      difference[lag] = cumulative > 0 ? energy * lag / cumulative : 1;
    }
    for (let lag = minimum; lag <= maximum; lag++) {
      if (difference[lag] >= 0.15) continue;
      while (lag < maximum && difference[lag + 1] < difference[lag]) lag++;
      const left = difference[lag - 1];
      const middle = difference[lag];
      const right = difference[lag + 1];
      const curvature = left - 2 * middle + right;
      const offset = curvature > 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (left - right) / curvature)) : 0;
      const frequencyHz = rate / (lag + offset);
      const confidence = Math.max(0, Math.min(1, 1 - middle));
      if (frequencyHz < 60 || frequencyHz > 1400) return unvoiced(rms, confidence);
      return { voiced: true, frequencyHz, confidence, rms };
    }
    return unvoiced(rms);
  }
}
