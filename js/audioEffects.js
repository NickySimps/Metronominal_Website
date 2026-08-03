const DEFAULT_HIGH_PASS = 20;
const DEFAULT_LOW_PASS = 20000;

function clampFrequency(value, fallback, sampleRate) {
  const nyquist = Math.max(DEFAULT_HIGH_PASS, (sampleRate || 48000) / 2);
  const numeric = Number(value);
  return Math.min(nyquist, Math.max(DEFAULT_HIGH_PASS, Number.isFinite(numeric) ? numeric : fallback));
}

export function createSoundFilterInput(audioContext, destination, settings = {}) {
  const highPass = audioContext.createBiquadFilter();
  const lowPass = audioContext.createBiquadFilter();
  highPass.type = 'highpass';
  lowPass.type = 'lowpass';
  highPass.frequency.value = clampFrequency(settings.highPassFrequency, DEFAULT_HIGH_PASS, audioContext.sampleRate);
  lowPass.frequency.value = Math.max(
    highPass.frequency.value,
    clampFrequency(settings.lowPassFrequency, DEFAULT_LOW_PASS, audioContext.sampleRate),
  );
  highPass.connect(lowPass);
  lowPass.connect(destination || audioContext.destination);
  return highPass;
}

export function normalizeFilterSettings(settings = {}) {
  settings.highPassFrequency = clampFrequency(settings.highPassFrequency, DEFAULT_HIGH_PASS);
  settings.lowPassFrequency = Math.max(
    settings.highPassFrequency,
    clampFrequency(settings.lowPassFrequency, DEFAULT_LOW_PASS),
  );
  return settings;
}
