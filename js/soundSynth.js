/**
 * A collection of functions to synthesize drum sounds using the Web Audio API.
 */
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
      decay = 0.4,
      pitchEnvelopeTime = 0.1,
    } = {},
    destination = null
  ) => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.connect(gain);
    gain.connect(destination || audioContext.destination);

    // Set master volume
    gain.gain.setValueAtTime(volume, time);

    // Pitch Envelope (from startFrequency down to endFrequency)
    osc.frequency.setValueAtTime(startFrequency, time);
    osc.frequency.exponentialRampToValueAtTime(
      endFrequency,
      time + pitchEnvelopeTime
    );

    // Volume Envelope (a sharp decay)
    gain.gain.exponentialRampToValueAtTime(0.001, time + decay);

    osc.start(time);
    osc.stop(time + decay);
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
      bodyDecay = 0.2,
      noiseFilterFrequency = 1500,
      noiseDecay = 0.2,
    } = {},
    destination = null
  ) => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const noise = audioContext.createBufferSource();
    const noiseFilter = audioContext.createBiquadFilter();
    const noiseGain = audioContext.createGain();

    const finalDestination = destination || audioContext.destination;

    // Configure the tonal part (the "body" of the snare)
    osc.type = "triangle";
    osc.frequency.setValueAtTime(bodyFrequencyStart, time);
    osc.frequency.exponentialRampToValueAtTime(bodyFrequencyEnd, time + 0.1);
    gain.gain.setValueAtTime(0.7 * volume, time);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.01 * volume), time + bodyDecay);

    osc.connect(gain);
    gain.connect(finalDestination);

    // Configure the noise part (the "snap" of the snare)
    const bufferSize = audioContext.sampleRate * 0.2; // 0.2 seconds of noise
    const buffer = audioContext.createBuffer(
      1,
      bufferSize,
      audioContext.sampleRate
    );
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    noise.buffer = buffer;

    noiseFilter.type = "highpass";
    noiseFilter.frequency.value = noiseFilterFrequency;

    noiseGain.gain.setValueAtTime(0.8 * volume, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + noiseDecay);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(finalDestination);

    osc.start(time);
    noise.start(time);

    const stopTime = time + Math.max(bodyDecay, noiseDecay) + 0.1;
    osc.stop(stopTime);
    noise.stop(stopTime);
  },

  /**
   * Plays a synthesized closed hi-hat sound.
   * A hi-hat is a very short burst of high-frequency filtered noise.
   * @param {AudioContext} audioContext - The global AudioContext.
   * @param {number} time - The time to schedule the sound to play.
   * @param {object} settings - The settings for the sound.
   * @param {AudioNode} destination - The destination node for the sound.
   */
  playHiHat: (
    audioContext,
    time,
    { volume = 1.0, filterFrequency = 7000, decay = 0.05 } = {},
    destination = null
  ) => {
    const noise = audioContext.createBufferSource();
    const noiseFilter = audioContext.createBiquadFilter();
    const noiseGain = audioContext.createGain();

    // Use the same noise generation as the snare
    const bufferSize = audioContext.sampleRate * 0.1;
    const buffer = audioContext.createBuffer(
      1,
      bufferSize,
      audioContext.sampleRate
    );
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    noise.buffer = buffer;

    // Filter the noise to be high-frequency (the "tsss" sound)
    noiseFilter.type = "highpass";
    noiseFilter.frequency.value = filterFrequency;

    // Very short volume envelope for a "ticking" sound
    noiseGain.gain.setValueAtTime(0.4 * volume, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + decay);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(destination || audioContext.destination);

    noise.start(time);
    noise.stop(time + decay + 0.05);
  },

  /**
   * Plays a synthesized open hi-hat sound.
   * Similar to a closed hi-hat but with a longer, sustained decay.
   * @param {AudioContext} audioContext - The global AudioContext.
   * @param {number} time - The time to schedule the sound to play.
   * @param {object} settings - The settings for the sound.
   * @param {AudioNode} destination - The destination node for the sound.
   */
  playOpenHiHat: (
    audioContext,
    time,
    { volume = 1.0, filterFrequency = 6000, decay = 0.4 } = {},
    destination = null
  ) => {
    const noise = audioContext.createBufferSource();
    const noiseFilter = audioContext.createBiquadFilter();
    const noiseGain = audioContext.createGain();

    const bufferSize = audioContext.sampleRate * 0.5;
    const buffer = audioContext.createBuffer(
      1,
      bufferSize,
      audioContext.sampleRate
    );
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    noise.buffer = buffer;

    noiseFilter.type = "highpass";
    noiseFilter.frequency.value = filterFrequency;

    // Longer decay for the "open" sound
    noiseGain.gain.setValueAtTime(0.4 * volume, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + decay);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(destination || audioContext.destination);

    noise.start(time);
    noise.stop(time + decay + 0.1);
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
    { volume = 1.0, startFrequency = 300, endFrequency = 150, decay = 0.3 } = {},
    destination = null
  ) => {
    const osc = audioContext.createOscillator(); // Tonal part
    const gain = audioContext.createGain(); // Gain for tonal part

    // Tonal part (pitched sine wave)
    osc.frequency.setValueAtTime(startFrequency, time); // Higher start frequency
    osc.frequency.exponentialRampToValueAtTime(endFrequency, time + 0.2);
    osc.type = "triangle";
    gain.gain.setValueAtTime(1.0 * volume, time); // Full volume
    gain.gain.exponentialRampToValueAtTime(0.001, time + decay); // Decay quickly

    osc.connect(gain);
    gain.connect(destination || audioContext.destination);

    osc.start(time);
    osc.stop(time + decay); // Stop after the decay
  },

  /**
   * Plays a synthesized mid tom drum sound.
   * @param {AudioContext} audioContext - The global AudioContext.
   * @param {number} time - The time to schedule the sound to play.
   * @param {object} settings - The settings for the sound.
   * @param {AudioNode} destination - The destination node for the sound.
   */
  playMidTom: (
    audioContext,
    time,
    { volume = 1.0, startFrequency = 150, endFrequency = 80, decay = 0.4 } = {},
    destination = null
  ) => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.frequency.setValueAtTime(startFrequency, time);
    osc.frequency.exponentialRampToValueAtTime(endFrequency, time + 0.25);
    osc.type = "triangle";
    gain.gain.setValueAtTime(1.0 * volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + decay);

    osc.connect(gain);
    gain.connect(destination || audioContext.destination);

    osc.start(time);
    osc.stop(time + decay);
  },

  /**
   * Plays a synthesized low tom drum sound.
   * @param {AudioContext} audioContext - The global AudioContext.
   * @param {number} time - The time to schedule the sound to play.
   * @param {object} settings - The settings for the sound.
   * @param {AudioNode} destination - The destination node for the sound.
   */
  playLowTom: (
    audioContext,
    time,
    { volume = 1.0, startFrequency = 100, endFrequency = 50, decay = 0.5 } = {},
    destination = null
  ) => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.frequency.setValueAtTime(startFrequency, time); // Lower start frequency
    osc.frequency.exponentialRampToValueAtTime(endFrequency, time + 0.3);
    osc.type = "triangle";
    gain.gain.setValueAtTime(1.0 * volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + decay);

    osc.connect(gain);
    gain.connect(destination || audioContext.destination);

    osc.start(time);
    osc.stop(time + decay);
  },

  /**
   * Plays a synthesized clap sound.
   * A clap is a short, sharp burst of filtered noise.
   * @param {AudioContext} audioContext - The global AudioContext.
   * @param {number} time - The time to schedule the sound to play.
   * @param {object} settings - The settings for the sound.
   * @param {AudioNode} destination - The destination node for the sound.
   */
  playClap: (
    audioContext,
    time,
    { volume = 1.0, filterFrequency = 1200, qValue = 15, decay = 0.15 } = {},
    destination = null
  ) => {
    const noise = audioContext.createBufferSource();
    const noiseFilter = audioContext.createBiquadFilter();
    const noiseGain = audioContext.createGain();

    const bufferSize = audioContext.sampleRate * 0.2;
    const buffer = audioContext.createBuffer(
      1,
      bufferSize,
      audioContext.sampleRate
    );
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    noise.buffer = buffer;

    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = filterFrequency;
    noiseFilter.Q.value = qValue;

    noiseGain.gain.setValueAtTime(0, time);
    noiseGain.gain.linearRampToValueAtTime(volume, time + 0.01);
    noiseGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.3 * volume), time + 0.03);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + decay);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(destination || audioContext.destination);

    noise.start(time);
    noise.stop(time + decay + 0.05);
  },

  /**
   * Plays a synthesized claves sound.
   * Claves are a very short, high-pitched, tonal "tick".
   * @param {AudioContext} audioContext - The global AudioContext.
   * @param {number} time - The time to schedule the sound to play.
   * @param {object} settings - The settings for the sound.
   * @param {AudioNode} destination - The destination node for the sound.
   */
  playClaves: (
    audioContext,
    time,
    { volume = 1.0, frequency = 2500, decay = 0.08 } = {},
    destination = null
  ) => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(frequency, time);

    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + decay);

    osc.connect(gain);
    gain.connect(destination || audioContext.destination);

    osc.start(time);
    osc.stop(time + decay + 0.02);
  },

  /**
   * Plays a synthesized shaker sound.
   * A shaker is a sustained burst of high-frequency noise.
   * @param {AudioContext} audioContext - The global AudioContext.
   * @param {number} time - The time to schedule the sound to play.
   * @param {object} settings - The settings for the sound.
   * @param {AudioNode} destination - The destination node for the sound.
   */
  playShaker: (
    audioContext,
    time,
    { volume = 1.0, filterFrequency = 6000, qValue = 5, decay = 0.2 } = {},
    destination = null
  ) => {
    const noise = audioContext.createBufferSource();
    const noiseFilter = audioContext.createBiquadFilter();
    const noiseGain = audioContext.createGain();

    const bufferSize = audioContext.sampleRate * 0.3;
    const buffer = audioContext.createBuffer(
      1,
      bufferSize,
      audioContext.sampleRate
    );
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    noise.buffer = buffer;

    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = filterFrequency;
    noiseFilter.Q.value = qValue;

    noiseGain.gain.setValueAtTime(0, time);
    noiseGain.gain.linearRampToValueAtTime(0.5 * volume, time + 0.02);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + decay);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(destination || audioContext.destination);

    noise.start(time);
    noise.stop(time + decay + 0.1);
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
    { volume = 1.0, filterFrequency = 8000, decay = 1.5 } = {},
    destination = null
  ) => {
    const noise = audioContext.createBufferSource();
    const noiseFilter = audioContext.createBiquadFilter();
    const noiseGain = audioContext.createGain();

    const bufferSize = audioContext.sampleRate * 2; // Longer noise buffer
    const buffer = audioContext.createBuffer(
      1,
      bufferSize,
      audioContext.sampleRate
    );
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    noise.buffer = buffer;

    noiseFilter.type = "bandpass"; // Or highpass, experiment for desired sound
    noiseFilter.frequency.value = filterFrequency;
    noiseFilter.Q.value = 1; // Lower Q for a broader sound

    noiseGain.gain.setValueAtTime(volume, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + decay);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(destination || audioContext.destination);

    noise.start(time);
    noise.stop(time + decay + 0.1);
  },

  /**
   * Plays a synthesized cowbell sound.
   * A cowbell can be approximated with two slightly detuned square waves.
   * @param {AudioContext} audioContext - The global AudioContext.
   * @param {number} time - The time to schedule the sound to play.
   * @param {object} settings - The settings for the sound.
   * @param {AudioNode} destination - The destination node for the sound.
   */
  playCowbell: (
    audioContext,
    time,
    { volume = 1.0, frequency1 = 540, frequency2 = 800, decay = 0.2 } = {},
    destination = null
  ) => {
    const osc1 = audioContext.createOscillator();
    const osc2 = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc1.type = "square";
    osc1.frequency.setValueAtTime(frequency1, time);

    osc2.type = "square";
    osc2.frequency.setValueAtTime(frequency2, time);

    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + decay);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(destination || audioContext.destination);

    osc1.start(time);
    osc2.start(time);

    osc1.stop(time + decay);
    osc2.stop(time + decay);
  },

  /**
   * Plays a synthesized woodblock sound.
   * A woodblock is a short, sharp, high-pitched sound, often with a quick decay.
   * @param {AudioContext} audioContext - The global AudioContext.
   * @param {number} time - The time to schedule the sound to play.
   * @param {object} settings - The settings for the sound.
   * @param {AudioNode} destination - The destination node for the sound.
   */
  playWoodblock: (
    audioContext,
    time,
    { volume = 1.0, frequency = 1000, decay = 0.1 } = {},
    destination = null
  ) => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = "sine"; // Or 'triangle' for a slightly different timbre
    osc.frequency.setValueAtTime(frequency, time);

    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + decay);

    osc.connect(gain);
    gain.connect(destination || audioContext.destination);

    osc.start(time);
    osc.stop(time + decay + 0.02);
  },

  /**
   * Plays a synthesized triangle sound.
   * A triangle is a simple, sustained sine wave with a ringing decay.
   * @param {AudioContext} audioContext - The global AudioContext.
   * @param {number} time - The time to schedule the sound to play.
   * @param {object} settings - The settings for the sound.
   * @param {AudioNode} destination - The destination node for the sound.
   */
  playTriangle: (
    audioContext,
    time,
    { volume = 1.0, frequency = 1200, decay = 0.8 } = {},
    destination = null
  ) => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(frequency, time);

    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + decay);

    osc.connect(gain);
    gain.connect(destination || audioContext.destination);

    osc.start(time);
    osc.stop(time + decay + 0.05);
  },

  /**
   * Plays a synthesized maraca sound.
   * A maraca is a short, sharp burst of high-frequency noise with a quick, modulated decay.
   * @param {AudioContext} audioContext - The global AudioContext.
   * @param {number} time - The time to schedule the sound to play.
   * @param {object} settings - The settings for the sound.
   * @param {AudioNode} destination - The destination node for the sound.
   */
  playMaraca: (
    audioContext,
    time,
    { volume = 1.0, filterFrequency = 4000, decay = 0.1 } = {},
    destination = null
  ) => {
    const noise = audioContext.createBufferSource();
    const noiseFilter = audioContext.createBiquadFilter();
    const noiseGain = audioContext.createGain();

    const bufferSize = audioContext.sampleRate * 0.1; // Short noise buffer
    const buffer = audioContext.createBuffer(
      1,
      bufferSize,
      audioContext.sampleRate
    );
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    noise.buffer = buffer;

    noiseFilter.type = "highpass";
    noiseFilter.frequency.value = filterFrequency;

    noiseGain.gain.setValueAtTime(0, time);
    noiseGain.gain.linearRampToValueAtTime(volume, time + 0.01);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + decay);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(destination || audioContext.destination);

    noise.start(time);
    noise.stop(time + decay + 0.02);
  },
};

export default SoundSynth;