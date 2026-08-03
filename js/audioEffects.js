const DEFAULT_HIGH_PASS = 20;
const DEFAULT_LOW_PASS = 20000;
const reversedBufferCache = new WeakMap();

export function getReversedAudioBuffer(audioContext, audioBuffer) {
  if (!audioContext || !audioBuffer) return audioBuffer;
  const cached = reversedBufferCache.get(audioBuffer);
  if (cached) return cached;

  const reversed = audioContext.createBuffer(
    audioBuffer.numberOfChannels,
    audioBuffer.length,
    audioBuffer.sampleRate,
  );
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const source = audioBuffer.getChannelData(channel);
    const target = reversed.getChannelData(channel);
    for (let index = 0; index < source.length; index += 1) {
      target[index] = source[source.length - 1 - index];
    }
  }
  reversedBufferCache.set(audioBuffer, reversed);
  return reversed;
}

function getReversedSynthSettings(settings = {}) {
  if (settings.reverse !== true) return settings;
  const reversed = { ...settings };
  [["attack", "release"], ["startFrequency", "endFrequency"], ["bodyFrequencyStart", "bodyFrequencyEnd"]].forEach(([first, second]) => {
    if (settings[first] !== undefined || settings[second] !== undefined) {
      reversed[first] = settings[second];
      reversed[second] = settings[first];
    }
  });
  return reversed;
}

export { getReversedSynthSettings };

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
