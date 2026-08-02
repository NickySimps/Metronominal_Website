let cachedNoiseBuffer = null;
let cachedNoiseSampleRate = 0;

function getSharedNoiseBuffer(audioContext) {
  if (cachedNoiseBuffer && cachedNoiseSampleRate === audioContext.sampleRate) {
    return cachedNoiseBuffer;
  }
  const bufferSize = audioContext.sampleRate * 2;
  const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  cachedNoiseBuffer = buffer;
  cachedNoiseSampleRate = audioContext.sampleRate;
  return buffer;
}

function getPitchMult(pitchShift = 0) {
  return Math.pow(2, (pitchShift || 0) / 12);
}

const SoundSynth = {
  /**
   * Plays a synthesized kick drum sound.
   * A kick is a low-frequency sine wave with a rapid pitch and volume drop.
   * @param {AudioContext} audioContext - The global AudioContext.
   * @param {number} time - The time to schedule the sound to play.
   * @param {object} settings - The settings for the sound.
   * @param {AudioNode} destination - The destination node for the sound.
   */
  playKick: (
    audioContext,
    time,
    {
      volume = 1.0,
      startFrequency = 150,
      endFrequency = 50,
      attack = 0.01,
      decay = 0.1,
      sustain = 0.5,
      release = 0.2,
      pitchEnvelopeTime = 0.1,
      pitchShift = 0,
    } = {},
    destination = null
  ) => {
    const pMult = getPitchMult(pitchShift);
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.connect(gain);
    gain.connect(destination || audioContext.destination);

    // Set master volume
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + attack);
    gain.gain.linearRampToValueAtTime(volume * sustain, time + attack + decay);
    gain.gain.setValueAtTime(volume * sustain, time + attack + decay + release);
    gain.gain.linearRampToValueAtTime(0, time + attack + decay + release + 0.01);

    // Pitch Envelope (from startFrequency down to endFrequency)
    osc.frequency.setValueAtTime(startFrequency * pMult, time);
    osc.frequency.exponentialRampToValueAtTime(
      endFrequency * pMult,
      time + pitchEnvelopeTime
    );

    osc.start(time);
    osc.stop(time + attack + decay + release + 0.1);
  },

  /**
   * Plays a synthesized snare drum sound.
   * A snare is a mix of a tonal "thump" and a burst of filtered noise.
   * @param {AudioContext} audioContext - The global AudioContext.
   * @param {number} time - The time to schedule the sound to play.
   * @param {object} settings - The settings for the sound.
   * @param {AudioNode} destination - The destination node for the sound.
   */
  playSnare: (
    audioContext,
    time,
    {
      volume = 1.0,
      bodyFrequencyStart = 200,
      bodyFrequencyEnd = 100,
      attack = 0.01,
      decay = 0.1,
      sustain = 0.5,
      release = 0.2,
      noiseFilterFrequency = 1500,
      pitchShift = 0,
    } = {},
    destination = null
  ) => {
    const pMult = getPitchMult(pitchShift);
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const noise = audioContext.createBufferSource();
    const noiseFilter = audioContext.createBiquadFilter();
    const noiseGain = audioContext.createGain();

    const finalDestination = destination || audioContext.destination;

    // Configure the tonal part (the "body" of the snare)
    osc.type = "triangle";
    osc.frequency.setValueAtTime(bodyFrequencyStart * pMult, time);
    osc.frequency.exponentialRampToValueAtTime(bodyFrequencyEnd * pMult, time + 0.1);
    
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume * 0.7, time + attack);
    gain.gain.linearRampToValueAtTime(volume * 0.7 * sustain, time + attack + decay);
    gain.gain.setValueAtTime(volume * 0.7 * sustain, time + attack + decay + release);
    gain.gain.linearRampToValueAtTime(0, time + attack + decay + release + 0.01);

    osc.connect(gain);
    gain.connect(finalDestination);

    // Configure the noise part (the "snap" of the snare)
    noise.buffer = getSharedNoiseBuffer(audioContext);

    noiseFilter.type = "highpass";
    noiseFilter.frequency.value = noiseFilterFrequency * pMult;

    noiseGain.gain.setValueAtTime(0, time);
    noiseGain.gain.linearRampToValueAtTime(volume * 0.8, time + attack);
    noiseGain.gain.linearRampToValueAtTime(volume * 0.8 * sustain, time + attack + decay);
    noiseGain.gain.setValueAtTime(volume * 0.8 * sustain, time + attack + decay + release);
    noiseGain.gain.linearRampToValueAtTime(0, time + attack + decay + release + 0.01);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(finalDestination);

    osc.start(time);
    noise.start(time);

    const stopTime = time + attack + decay + release + 0.1;
    osc.stop(stopTime);
    noise.stop(stopTime);
  },

  playHiHat: (
    audioContext,
    time,
    { volume = 1.0, filterFrequency = 7000, attack = 0.01, decay = 0.05, sustain = 0.1, release = 0.05, pitchShift = 0 } = {},
    destination = null
  ) => {
    const pMult = getPitchMult(pitchShift);
    const noise = audioContext.createBufferSource();
    const noiseFilter = audioContext.createBiquadFilter();
    const noiseGain = audioContext.createGain();

    noise.buffer = getSharedNoiseBuffer(audioContext);

    noiseFilter.type = "highpass";
    noiseFilter.frequency.value = filterFrequency * pMult;

    noiseGain.gain.setValueAtTime(0, time);
    noiseGain.gain.linearRampToValueAtTime(volume * 0.4, time + attack);
    noiseGain.gain.linearRampToValueAtTime(volume * 0.4 * sustain, time + attack + decay);
    noiseGain.gain.setValueAtTime(volume * 0.4 * sustain, time + attack + decay + release);
    noiseGain.gain.linearRampToValueAtTime(0, time + attack + decay + release + 0.01);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(destination || audioContext.destination);

    noise.start(time);
    noise.stop(time + attack + decay + release + 0.1);
  },

  playOpenHiHat: (
    audioContext,
    time,
    { volume = 1.0, filterFrequency = 6000, attack = 0.01, decay = 0.2, sustain = 0.1, release = 0.2, pitchShift = 0 } = {},
    destination = null
  ) => {
    const pMult = getPitchMult(pitchShift);
    const noise = audioContext.createBufferSource();
    const noiseFilter = audioContext.createBiquadFilter();
    const noiseGain = audioContext.createGain();

    noise.buffer = getSharedNoiseBuffer(audioContext);

    noiseFilter.type = "highpass";
    noiseFilter.frequency.value = filterFrequency * pMult;

    noiseGain.gain.setValueAtTime(0, time);
    noiseGain.gain.linearRampToValueAtTime(volume * 0.4, time + attack);
    noiseGain.gain.linearRampToValueAtTime(volume * 0.4 * sustain, time + attack + decay);
    noiseGain.gain.setValueAtTime(volume * 0.4 * sustain, time + attack + decay + release);
    noiseGain.gain.linearRampToValueAtTime(0, time + attack + decay + release + 0.01);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(destination || audioContext.destination);

    noise.start(time);
    noise.stop(time + attack + decay + release + 0.1);
  },

  /**
   * Plays a synthesized high tom drum sound.
   * @param {AudioContext} audioContext - The global AudioContext.
   * @param {number} time - The time to schedule the sound to play.
   * @param {object} settings - The settings for the sound.
   * @param {AudioNode} destination - The destination node for the sound.
   */
  playHiTom: (
    audioContext,
    time,
    { volume = 1.0, startFrequency = 300, endFrequency = 150, attack = 0.01, decay = 0.2, sustain = 0.1, release = 0.1, pitchShift = 0 } = {},
    destination = null
  ) => {
    const pMult = getPitchMult(pitchShift);
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.frequency.setValueAtTime(startFrequency * pMult, time);
    osc.frequency.exponentialRampToValueAtTime(endFrequency * pMult, time + 0.2);
    osc.type = "triangle";
    
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + attack);
    gain.gain.linearRampToValueAtTime(volume * sustain, time + attack + decay);
    gain.gain.setValueAtTime(volume * sustain, time + attack + decay + release);
    gain.gain.linearRampToValueAtTime(0, time + attack + decay + release + 0.01);

    osc.connect(gain);
    gain.connect(destination || audioContext.destination);

    osc.start(time);
    osc.stop(time + attack + decay + release + 0.1);
  },

  playMidTom: (
    audioContext,
    time,
    { volume = 1.0, startFrequency = 150, endFrequency = 80, attack = 0.01, decay = 0.3, sustain = 0.1, release = 0.1, pitchShift = 0 } = {},
    destination = null
  ) => {
    const pMult = getPitchMult(pitchShift);
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.frequency.setValueAtTime(startFrequency * pMult, time);
    osc.frequency.exponentialRampToValueAtTime(endFrequency * pMult, time + 0.25);
    osc.type = "triangle";
    
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + attack);
    gain.gain.linearRampToValueAtTime(volume * sustain, time + attack + decay);
    gain.gain.setValueAtTime(volume * sustain, time + attack + decay + release);
    gain.gain.linearRampToValueAtTime(0, time + attack + decay + release + 0.01);

    osc.connect(gain);
    gain.connect(destination || audioContext.destination);

    osc.start(time);
    osc.stop(time + attack + decay + release + 0.1);
  },

  playLowTom: (
    audioContext,
    time,
    { volume = 1.0, startFrequency = 100, endFrequency = 50, attack = 0.01, decay = 0.4, sustain = 0.1, release = 0.1, pitchShift = 0 } = {},
    destination = null
  ) => {
    const pMult = getPitchMult(pitchShift);
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.frequency.setValueAtTime(startFrequency * pMult, time);
    osc.frequency.exponentialRampToValueAtTime(endFrequency * pMult, time + 0.3);
    osc.type = "triangle";
    
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + attack);
    gain.gain.linearRampToValueAtTime(volume * sustain, time + attack + decay);
    gain.gain.setValueAtTime(volume * sustain, time + attack + decay + release);
    gain.gain.linearRampToValueAtTime(0, time + attack + decay + release + 0.01);

    osc.connect(gain);
    gain.connect(destination || audioContext.destination);

    osc.start(time);
    osc.stop(time + attack + decay + release + 0.1);
  },

  playClap: (
    audioContext,
    time,
    { volume = 1.0, filterFrequency = 1200, qValue = 15, attack = 0.01, decay = 0.1, sustain = 0.1, release = 0.1, pitchShift = 0 } = {},
    destination = null
  ) => {
    const pMult = getPitchMult(pitchShift);
    const noise = audioContext.createBufferSource();
    const noiseFilter = audioContext.createBiquadFilter();
    const noiseGain = audioContext.createGain();

    noise.buffer = getSharedNoiseBuffer(audioContext);

    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = filterFrequency * pMult;
    noiseFilter.Q.value = qValue;

    noiseGain.gain.setValueAtTime(0, time);
    noiseGain.gain.linearRampToValueAtTime(volume, time + attack);
    noiseGain.gain.linearRampToValueAtTime(volume * sustain, time + attack + decay);
    noiseGain.gain.setValueAtTime(volume * sustain, time + attack + decay + release);
    noiseGain.gain.linearRampToValueAtTime(0, time + attack + decay + release + 0.01);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(destination || audioContext.destination);

    noise.start(time);
    noise.stop(time + attack + decay + release + 0.1);
  },

  playClaves: (
    audioContext,
    time,
    { volume = 1.0, frequency = 2500, attack = 0.01, decay = 0.05, sustain = 0.1, release = 0.05, pitchShift = 0 } = {},
    destination = null
  ) => {
    const pMult = getPitchMult(pitchShift);
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(frequency * pMult, time);

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + attack);
    gain.gain.linearRampToValueAtTime(volume * sustain, time + attack + decay);
    gain.gain.setValueAtTime(volume * sustain, time + attack + decay + release);
    gain.gain.linearRampToValueAtTime(0, time + attack + decay + release + 0.01);

    osc.connect(gain);
    gain.connect(destination || audioContext.destination);

    osc.start(time);
    osc.stop(time + attack + decay + release + 0.1);
  },

  playShaker: (
    audioContext,
    time,
    { volume = 1.0, filterFrequency = 6000, qValue = 5, attack = 0.01, decay = 0.1, sustain = 0.1, release = 0.1, pitchShift = 0 } = {},
    destination = null
  ) => {
    const pMult = getPitchMult(pitchShift);
    const noise = audioContext.createBufferSource();
    const noiseFilter = audioContext.createBiquadFilter();
    const noiseGain = audioContext.createGain();

    noise.buffer = getSharedNoiseBuffer(audioContext);

    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = filterFrequency * pMult;
    noiseFilter.Q.value = qValue;

    noiseGain.gain.setValueAtTime(0, time);
    noiseGain.gain.linearRampToValueAtTime(volume * 0.5, time + attack);
    noiseGain.gain.linearRampToValueAtTime(volume * 0.5 * sustain, time + attack + decay);
    noiseGain.gain.setValueAtTime(volume * 0.5 * sustain, time + attack + decay + release);
    noiseGain.gain.linearRampToValueAtTime(0, time + attack + decay + release + 0.01);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(destination || audioContext.destination);

    noise.start(time);
    noise.stop(time + attack + decay + release + 0.1);
  },

  /**
   * Plays a synthesized cymbal sound.
   * A cymbal is a complex, sustained burst of filtered noise with a long decay.
   * @param {AudioContext} audioContext - The global AudioContext.
   * @param {number} time - The time to schedule the sound to play.
   * @param {object} settings - The settings for the sound.
   * @param {AudioNode} destination - The destination node for the sound.
   */
  playCymbal: (
    audioContext,
    time,
    { volume = 1.0, filterFrequency = 8000, attack = 0.01, decay = 0.5, sustain = 0.1, release = 0.5, pitchShift = 0 } = {},
    destination = null
  ) => {
    const pMult = getPitchMult(pitchShift);
    const noise = audioContext.createBufferSource();
    const noiseFilter = audioContext.createBiquadFilter();
    const noiseGain = audioContext.createGain();

    noise.buffer = getSharedNoiseBuffer(audioContext);

    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = filterFrequency * pMult;
    noiseFilter.Q.value = 1;

    noiseGain.gain.setValueAtTime(0, time);
    noiseGain.gain.linearRampToValueAtTime(volume, time + attack);
    noiseGain.gain.linearRampToValueAtTime(volume * sustain, time + attack + decay);
    noiseGain.gain.setValueAtTime(volume * sustain, time + attack + decay + release);
    noiseGain.gain.linearRampToValueAtTime(0, time + attack + decay + release + 0.01);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(destination || audioContext.destination);

    noise.start(time);
    noise.stop(time + attack + decay + release + 0.1);
  },

  playCowbell: (
    audioContext,
    time,
    { volume = 1.0, frequency1 = 540, frequency2 = 800, attack = 0.01, decay = 0.1, sustain = 0.1, release = 0.1, pitchShift = 0 } = {},
    destination = null
  ) => {
    const pMult = getPitchMult(pitchShift);
    const osc1 = audioContext.createOscillator();
    const osc2 = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc1.type = "square";
    osc1.frequency.setValueAtTime(frequency1 * pMult, time);

    osc2.type = "square";
    osc2.frequency.setValueAtTime(frequency2 * pMult, time);

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + attack);
    gain.gain.linearRampToValueAtTime(volume * sustain, time + attack + decay);
    gain.gain.setValueAtTime(volume * sustain, time + attack + decay + release);
    gain.gain.linearRampToValueAtTime(0, time + attack + decay + release + 0.01);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(destination || audioContext.destination);

    osc1.start(time);
    osc2.start(time);

    const stopTime = time + attack + decay + release + 0.1;
    osc1.stop(stopTime);
    osc2.stop(stopTime);
  },

  playWoodblock: (
    audioContext,
    time,
    { volume = 1.0, frequency = 1000, attack = 0.01, decay = 0.05, sustain = 0.1, release = 0.05, pitchShift = 0 } = {},
    destination = null
  ) => {
    const pMult = getPitchMult(pitchShift);
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(frequency * pMult, time);

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + attack);
    gain.gain.linearRampToValueAtTime(volume * sustain, time + attack + decay);
    gain.gain.setValueAtTime(volume * sustain, time + attack + decay + release);
    gain.gain.linearRampToValueAtTime(0, time + attack + decay + release + 0.01);

    osc.connect(gain);
    gain.connect(destination || audioContext.destination);

    osc.start(time);
    osc.stop(time + attack + decay + release + 0.1);
  },

  playTriangle: (
    audioContext,
    time,
    { volume = 1.0, frequency = 1200, attack = 0.01, decay = 0.2, sustain = 0.1, release = 0.2, pitchShift = 0 } = {},
    destination = null
  ) => {
    const pMult = getPitchMult(pitchShift);
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(frequency * pMult, time);

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + attack);
    gain.gain.linearRampToValueAtTime(volume * sustain, time + attack + decay);
    gain.gain.setValueAtTime(volume * sustain, time + attack + decay + release);
    gain.gain.linearRampToValueAtTime(0, time + attack + decay + release + 0.01);

    osc.connect(gain);
    gain.connect(destination || audioContext.destination);

    osc.start(time);
    osc.stop(time + attack + decay + release + 0.1);
  },

  playMaraca: (
    audioContext,
    time,
    { volume = 1.0, filterFrequency = 4000, attack = 0.01, decay = 0.05, sustain = 0.1, release = 0.05, pitchShift = 0 } = {},
    destination = null
  ) => {
    const pMult = getPitchMult(pitchShift);
    const noise = audioContext.createBufferSource();
    const noiseFilter = audioContext.createBiquadFilter();
    const noiseGain = audioContext.createGain();

    noise.buffer = getSharedNoiseBuffer(audioContext);

    noiseFilter.type = "highpass";
    noiseFilter.frequency.value = filterFrequency * pMult;

    noiseGain.gain.setValueAtTime(0, time);
    noiseGain.gain.linearRampToValueAtTime(volume, time + attack);
    noiseGain.gain.linearRampToValueAtTime(volume * sustain, time + attack + decay);
    noiseGain.gain.setValueAtTime(volume * sustain, time + attack + decay + release);
    noiseGain.gain.linearRampToValueAtTime(0, time + attack + decay + release + 0.01);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(destination || audioContext.destination);

    noise.start(time);
    noise.stop(time + attack + decay + release + 0.1);
  },

  playSine: (
    audioContext,
    time,
    { volume = 1.0, frequency = 440, attack = 0.01, decay = 0.1, sustain = 0.5, release = 0.2, pitchShift = 0 } = {},
    destination = null
  ) => {
    const pMult = getPitchMult(pitchShift);
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(frequency * pMult, time);

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + attack);
    gain.gain.linearRampToValueAtTime(volume * sustain, time + attack + decay);
    gain.gain.setValueAtTime(volume * sustain, time + attack + decay + release);
    gain.gain.linearRampToValueAtTime(0, time + attack + decay + release + 0.01);

    osc.connect(gain);
    gain.connect(destination || audioContext.destination);

    osc.start(time);
    osc.stop(time + attack + decay + release + 0.1);
  },

  playSquare: (
    audioContext,
    time,
    { volume = 1.0, frequency = 440, attack = 0.01, decay = 0.1, sustain = 0.5, release = 0.2, pitchShift = 0 } = {},
    destination = null
  ) => {
    const pMult = getPitchMult(pitchShift);
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = "square";
    osc.frequency.setValueAtTime(frequency * pMult, time);

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + attack);
    gain.gain.linearRampToValueAtTime(volume * sustain, time + attack + decay);
    gain.gain.setValueAtTime(volume * sustain, time + attack + decay + release);
    gain.gain.linearRampToValueAtTime(0, time + attack + decay + release + 0.01);

    osc.connect(gain);
    gain.connect(destination || audioContext.destination);

    osc.start(time);
    osc.stop(time + attack + decay + release + 0.1);
  },

  playSawtooth: (
    audioContext,
    time,
    { volume = 1.0, frequency = 440, attack = 0.01, decay = 0.1, sustain = 0.5, release = 0.2, pitchShift = 0 } = {},
    destination = null
  ) => {
    const pMult = getPitchMult(pitchShift);
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(frequency * pMult, time);

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + attack);
    gain.gain.linearRampToValueAtTime(volume * sustain, time + attack + decay);
    gain.gain.setValueAtTime(volume * sustain, time + attack + decay + release);
    gain.gain.linearRampToValueAtTime(0, time + attack + decay + release + 0.01);

    osc.connect(gain);
    gain.connect(destination || audioContext.destination);

    osc.start(time);
    osc.stop(time + attack + decay + release + 0.1);
  },

  playUltrasaw: (
    audioContext,
    time,
    { volume = 1.0, frequency = 440, attack = 0.01, decay = 0.2, sustain = 0.5, release = 0.2, detune = 15, pitchShift = 0 } = {},
    destination = null
  ) => {
    const pMult = getPitchMult(pitchShift);
    const gain = audioContext.createGain();
    gain.connect(destination || audioContext.destination);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + attack);
    gain.gain.linearRampToValueAtTime(volume * sustain, time + attack + decay);
    gain.gain.setValueAtTime(volume * sustain, time + attack + decay + release);
    gain.gain.linearRampToValueAtTime(0, time + attack + decay + release + 0.01);

    const osc1 = audioContext.createOscillator();
    osc1.type = "sawtooth";
    osc1.frequency.setValueAtTime(frequency * pMult, time);
    osc1.detune.setValueAtTime(-detune, time);
    osc1.connect(gain);
    osc1.start(time);
    osc1.stop(time + attack + decay + release + 0.1);

    const osc2 = audioContext.createOscillator();
    osc2.type = "sawtooth";
    osc2.frequency.setValueAtTime(frequency * pMult, time);
    osc2.detune.setValueAtTime(detune, time);
    osc2.connect(gain);
    osc2.start(time);
    osc2.stop(time + attack + decay + release + 0.1);
  },

  /**
   * Plays a synthesized noise sound.
   * @param {AudioContext} audioContext - The global AudioContext.
   * @param {number} time - The time to schedule the sound to play.
   * @param {object} settings - The settings for the sound.
   * @param {AudioNode} destination - The destination node for the sound.
   */
  playNoise: (
    audioContext,
    time,
    { volume = 1.0, attack = 0.01, decay = 0.1, sustain = 0.1, release = 0.1 } = {},
    destination = null
  ) => {
    const noise = audioContext.createBufferSource();
    const noiseGain = audioContext.createGain();

    noise.buffer = getSharedNoiseBuffer(audioContext);

    noiseGain.gain.setValueAtTime(0, time);
    noiseGain.gain.linearRampToValueAtTime(volume, time + attack);
    noiseGain.gain.linearRampToValueAtTime(volume * sustain, time + attack + decay);
    noiseGain.gain.setValueAtTime(volume * sustain, time + attack + decay + release);
    noiseGain.gain.linearRampToValueAtTime(0, time + attack + decay + release + 0.01);

    noise.connect(noiseGain);
    noiseGain.connect(destination || audioContext.destination);

    noise.start(time);
    noise.stop(time + attack + decay + release + 0.1);
  },
};

export default SoundSynth;