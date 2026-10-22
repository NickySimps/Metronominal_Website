const DEFAULT_HIGH_PASS = 20;
const DEFAULT_LOW_PASS = 20000;
const reversedBufferCache = new WeakMap();
const renderedSynthCache = new WeakMap();
const synthFunctionIds = new WeakMap();
let nextSynthFunctionId = 0;
// Entry limits are shared across all synth identities/settings in each context.
const MAX_RENDERED_SYNTHS = 32;
const MAX_REVERSED_BUFFERS = 32;
const distortionCurveCache = new Map();
const impulseResponseCache = new WeakMap();
const MAX_DISTORTION_CURVES = 32;
const MAX_IMPULSES = 8;

function getCachedResource(cache, key) {
  if (!cache.has(key)) return undefined;
  const resource = cache.get(key);
  cache.delete(key);
  cache.set(key, resource);
  return resource;
}

function cacheResource(cache, key, resource, limit) {
  cache.set(key, resource);
  if (cache.size > limit) cache.delete(cache.keys().next().value);
  return resource;
}

export function getReversedAudioBuffer(audioContext, audioBuffer) {
  if (!audioContext || !audioBuffer) return audioBuffer;
  let contextCache = reversedBufferCache.get(audioContext);
  if (!contextCache) {
    contextCache = new Map();
    reversedBufferCache.set(audioContext, contextCache);
  }
  const cached = getCachedResource(contextCache, audioBuffer);
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
  return cacheResource(contextCache, audioBuffer, reversed, MAX_REVERSED_BUFFERS);
}

export async function renderSynthAudioBuffer(audioContext, synthFunction, settings = {}) {
  if (!audioContext || typeof synthFunction !== 'function' || typeof OfflineAudioContext === 'undefined') return null;
  let contextCache = renderedSynthCache.get(audioContext);
  if (!contextCache) {
    contextCache = new Map();
    renderedSynthCache.set(audioContext, contextCache);
  }
  if (!synthFunctionIds.has(synthFunction)) {
    synthFunctionIds.set(synthFunction, ++nextSynthFunctionId);
  }
  const cacheKey = JSON.stringify([synthFunctionIds.get(synthFunction), audioContext.sampleRate, settings]);
  const cached = getCachedResource(contextCache, cacheKey);
  if (cached) return cached;

  const attack = Number(settings.attack) || 0.01;
  const decay = Number(settings.decay) || 0.1;
  const release = Number(settings.release) || 0.1;
  const duration = Math.max(0.2, attack + decay + release + 0.1);
  const offline = new OfflineAudioContext(1, Math.ceil(duration * audioContext.sampleRate), audioContext.sampleRate);
  synthFunction(offline, 0, { ...settings, reverse: false }, offline.destination);
  const rendering = offline.startRendering().catch((error) => {
    // An evicted in-flight render must not remove a newer request for this key.
    if (contextCache.get(cacheKey) === rendering) contextCache.delete(cacheKey);
    throw error;
  });
  return cacheResource(contextCache, cacheKey, rendering, MAX_RENDERED_SYNTHS);
}

function clampFrequency(value, fallback, sampleRate) {
  const nyquist = Math.max(DEFAULT_HIGH_PASS, (sampleRate || 48000) / 2);
  const numeric = Number(value);
  return Math.min(nyquist, Math.max(DEFAULT_HIGH_PASS, Number.isFinite(numeric) ? numeric : fallback));
}

export function createSoundFilterInput(audioContext, destination, settings = {}) {
  if (settings.fxBypass === true) {
    const bypass = audioContext.createGain();
    bypass.connect(destination || audioContext.destination);
    return bypass;
  }
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
  lowPass.connect(createEffectRackInput(audioContext, destination || audioContext.destination, settings));
  return highPass;
}

function makeDistortionCurve(amount = 0) {
  const drive = Math.max(0, Math.min(1, Number(amount) || 0));
  const cached = getCachedResource(distortionCurveCache, drive);
  if (cached) return cached;
  const samples = 44100;
  const curve = new Float32Array(samples);
  const k = drive * 400;
  for (let index = 0; index < samples; index += 1) {
    const x = (index * 2) / samples - 1;
    curve[index] = k === 0 ? x : ((3 + k) * x * 20 * Math.PI / 180) / (Math.PI + k * Math.abs(x));
  }
  return cacheResource(distortionCurveCache, drive, curve, MAX_DISTORTION_CURVES);
}

function createImpulseResponse(audioContext, seconds = 1.2) {
  let contextCache = impulseResponseCache.get(audioContext);
  if (!contextCache) {
    contextCache = new Map();
    impulseResponseCache.set(audioContext, contextCache);
  }
  const length = Math.ceil(audioContext.sampleRate * seconds);
  const cacheKey = `${audioContext.sampleRate}:${length}`;
  const cached = getCachedResource(contextCache, cacheKey);
  if (cached) return cached;
  const impulse = audioContext.createBuffer(2, length, audioContext.sampleRate);
  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * Math.pow(1 - index / length, 2.5);
    }
  }
  return cacheResource(contextCache, cacheKey, impulse, MAX_IMPULSES);
}

export function normalizeEffectSettings(settings = {}) {
  settings.fxBypass = settings.fxBypass === true;
  settings.distortion = Math.max(0, Math.min(1, Number(settings.distortion) || 0));
  settings.delayMix = Math.max(0, Math.min(1, Number(settings.delayMix) || 0));
  settings.delayTime = Math.max(0, Math.min(1, Number(settings.delayTime) || 0));
  settings.delayFeedback = Math.max(0, Math.min(0.85, Number.isFinite(Number(settings.delayFeedback)) ? Number(settings.delayFeedback) : 0.25));
  settings.reverbMix = Math.max(0, Math.min(1, Number(settings.reverbMix) || 0));
  settings.reverbFeedback = Math.max(0, Math.min(1, Number.isFinite(Number(settings.reverbFeedback)) ? Number(settings.reverbFeedback) : 0.25));
  return settings;
}

export function createEffectRackInput(audioContext, destination, settings = {}) {
  normalizeEffectSettings(settings);
  const input = audioContext.createGain();
  const dry = audioContext.createGain();
  const output = audioContext.createGain();
  input.connect(dry);
  dry.connect(output);
  const wetGainScale = 0.35;
  const wetMixTotal = settings.distortion + settings.delayMix + settings.reverbMix;
  const gainBudget = 1 + wetGainScale * wetMixTotal;
  const dryGain = 1 / gainBudget;
  const wetGain = (mix) => (mix * wetGainScale) / gainBudget;
  dry.gain.value = dryGain;

  if (settings.distortion > 0) {
    const shaper = audioContext.createWaveShaper();
    const wet = audioContext.createGain();
    shaper.curve = makeDistortionCurve(settings.distortion);
    shaper.oversample = "4x";
    wet.gain.value = wetGain(settings.distortion);
    input.connect(shaper);
    shaper.connect(wet);
    wet.connect(output);
  }

  if (settings.delayMix > 0) {
    const delay = audioContext.createDelay(1);
    const wet = audioContext.createGain();
    const feedback = audioContext.createGain();
    delay.delayTime.value = settings.delayTime;
    feedback.gain.value = settings.delayFeedback;
    wet.gain.value = wetGain(settings.delayMix);
    input.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    wet.connect(output);
  }

  if (settings.reverbMix > 0) {
    const convolver = audioContext.createConvolver();
    const wet = audioContext.createGain();
    convolver.buffer = createImpulseResponse(audioContext, 0.2 + settings.reverbFeedback * 4.8);
    wet.gain.value = wetGain(settings.reverbMix);
    input.connect(convolver);
    convolver.connect(wet);
    wet.connect(output);
  }

  output.connect(destination || audioContext.destination);
  return input;
}

export function normalizeFilterSettings(settings = {}) {
  settings.highPassFrequency = clampFrequency(settings.highPassFrequency, DEFAULT_HIGH_PASS);
  settings.lowPassFrequency = Math.max(
    settings.highPassFrequency,
    clampFrequency(settings.lowPassFrequency, DEFAULT_LOW_PASS),
  );
  return settings;
}
