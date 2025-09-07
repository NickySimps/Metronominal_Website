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
      attack = 0.01,
      decay = 0.1,
      sustain = 0.5,
      release = 0.2,
      pitchEnvelopeTime = 0.1,
    } = {},
    destination = null
  ) => {
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
    osc.frequency.setValueAtTime(startFrequency, time);
    osc.frequency.exponentialRampToValueAtTime(
      endFrequency,
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
    
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume * 0.7, time + attack);
    gain.gain.linearRampToValueAtTime(volume * 0.7 * sustain, time + attack + decay);
    gain.gain.setValueAtTime(volume * 0.7 * sustain, time + attack + decay + release);
    gain.gain.linearRampToValueAtTime(0, time + attack + decay + release + 0.01);

    osc.connect(gain);
    gain.connect(finalDestination);

    // Configure the noise part (the "snap" of the snare)
    const bufferSize = audioContext.sampleRate * 0.5; // 0.5 seconds of noise
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
    { volume = 1.0, filterFrequency = 7000, attack = 0.01, decay = 0.05, sustain = 0.1, release = 0.05 } = {},
    destination = null
  ) => {
    const noise = audioContext.createBufferSource();
    const noiseFilter = audioContext.createBiquadFilter();
    const noiseGain = audioContext.createGain();

    // Use the same noise generation as the snare
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

    // Filter the noise to be high-frequency (the "tsss" sound)
    noiseFilter.type = "highpass";
    noiseFilter.frequency.value = filterFrequency;

    // Very short volume envelope for a "ticking" sound
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
    { volume = 1.0, filterFrequency = 6000, attack = 0.01, decay = 0.2, sustain = 0.1, release = 0.2 } = {},
    destination = null
  ) => {
    const noise = audioContext.createBufferSource();
    const noiseFilter = audioContext.createBiquadFilter();
    const noiseGain = audioContext.createGain();

    const bufferSize = audioContext.sampleRate * 1;
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
    { volume = 1.0, startFrequency = 300, endFrequency = 150, attack = 0.01, decay = 0.2, sustain = 0.1, release = 0.1 } = {},
    destination = null
  ) => {
    const osc = audioContext.createOscillator(); // Tonal part
    const gain = audioContext.createGain(); // Gain for tonal part

    // Tonal part (pitched sine wave)
    osc.frequency.setValueAtTime(startFrequency, time); // Higher start frequency
    osc.frequency.exponentialRampToValueAtTime(endFrequency, time + 0.2);
    osc.type = "triangle";
    
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + attack);
    gain.gain.linearRampToValueAtTime(volume * sustain, time + attack + decay);
    gain.gain.setValueAtTime(volume * sustain, time + attack + decay + release);
    gain.gain.linearRampToValueAtTime(0, time + attack + decay + release + 0.01);

    osc.connect(gain);
    gain.connect(destination || audioContext.destination);

    osc.start(time);
    osc.stop(time + attack + decay + release + 0.1); // Stop after the decay
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
    { volume = 1.0, startFrequency = 150, endFrequency = 80, attack = 0.01, decay = 0.3, sustain = 0.1, release = 0.1 } = {},
    destination = null
  ) => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.frequency.setValueAtTime(startFrequency, time);
    osc.frequency.exponentialRampToValueAtTime(endFrequency, time + 0.25);
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
    { volume = 1.0, startFrequency = 100, endFrequency = 50, attack = 0.01, decay = 0.4, sustain = 0.1, release = 0.1 } = {},
    destination = null
  ) => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.frequency.setValueAtTime(startFrequency, time); // Lower start frequency
    osc.frequency.exponentialRampToValueAtTime(endFrequency, time + 0.3);
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
    { volume = 1.0, filterFrequency = 1200, qValue = 15, attack = 0.01, decay = 0.1, sustain = 0.1, release = 0.1 } = {},
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

    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = filterFrequency;
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
    { volume = 1.0, frequency = 2500, attack = 0.01, decay = 0.05, sustain = 0.1, release = 0.05 } = {},
    destination = null
  ) => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(frequency, time);

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
    { volume = 1.0, filterFrequency = 6000, qValue = 5, attack = 0.01, decay = 0.1, sustain = 0.1, release = 0.1 } = {},
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

    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = filterFrequency;
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
    { volume = 1.0, filterFrequency = 8000, attack = 0.01, decay = 0.5, sustain = 0.1, release = 0.5 } = {},
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
    { volume = 1.0, frequency1 = 540, frequency2 = 800, attack = 0.01, decay = 0.1, sustain = 0.1, release = 0.1 } = {},
    destination = null
  ) => {
    const osc1 = audioContext.createOscillator();
    const osc2 = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc1.type = "square";
    osc1.frequency.setValueAtTime(frequency1, time);

    osc2.type = "square";
    osc2.frequency.setValueAtTime(frequency2, time);

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
    { volume = 1.0, frequency = 1000, attack = 0.01, decay = 0.05, sustain = 0.1, release = 0.05 } = {},
    destination = null
  ) => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = "sine"; // Or 'triangle' for a slightly different timbre
    osc.frequency.setValueAtTime(frequency, time);

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
    { volume = 1.0, frequency = 1200, attack = 0.01, decay = 0.2, sustain = 0.1, release = 0.2 } = {},
    destination = null
  ) => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(frequency, time);

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
    { volume = 1.0, filterFrequency = 4000, attack = 0.01, decay = 0.05, sustain = 0.1, release = 0.05 } = {},
    destination = null
  ) => {
    const noise = audioContext.createBufferSource();
    const noiseFilter = audioContext.createBiquadFilter();
    const noiseGain = audioContext.createGain();

    const bufferSize = audioContext.sampleRate * 0.5; // Short noise buffer
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

  /**
   * Plays a synthesized sine wave sound.
   * @param {AudioContext} audioContext - The global AudioContext.
   * @param {number} time - The time to schedule the sound to play.
   * @param {object} settings - The settings for the sound.
   * @param {AudioNode} destination - The destination node for the sound.
   */
  playSine: (
    audioContext,
    time,
    { volume = 1.0, frequency = 440, attack = 0.01, decay = 0.1, sustain = 0.5, release = 0.2 } = {},
    destination = null
  ) => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(frequency, time);

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

  /**
   * Plays a synthesized square wave sound.
   * @param {AudioContext} audioContext - The global AudioContext.
   * @param {number} time - The time to schedule the sound to play.
   * @param {object} settings - The settings for the sound.
   * @param {AudioNode} destination - The destination node for the sound.
   */
  playSquare: (
    audioContext,
    time,
    { volume = 1.0, frequency = 440, attack = 0.01, decay = 0.1, sustain = 0.5, release = 0.2 } = {},
    destination = null
  ) => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = "square";
    osc.frequency.setValueAtTime(frequency, time);

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

  /**
   * Plays a synthesized sawtooth wave sound.
   * @param {AudioContext} audioContext - The global AudioContext.
   * @param {number} time - The time to schedule the sound to play.
   * @param {object} settings - The settings for the sound.
   * @param {AudioNode} destination - The destination node for the sound.
   */
  playSawtooth: (
    audioContext,
    time,
    { volume = 1.0, frequency = 440, attack = 0.01, decay = 0.1, sustain = 0.5, release = 0.2 } = {},
    destination = null
  ) => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(frequency, time);

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

  /**
   * Plays a synthesized sawtooth wave sound.
   * @param {AudioContext} audioContext - The global AudioContext.
   * @param {number} time - The time to schedule the sound to play.
   * @param {object} settings - The settings for the sound.
   * @param {AudioNode} destination - The destination node for the sound.
   */
  playSawtooth: (
    audioContext,
    time,
    { volume = 1.0, frequency = 440, attack = 0.01, decay = 0.1, sustain = 0.5, release = 0.2 } = {},
    destination = null
  ) => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(frequency, time);

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

  /**
   * Plays a synthesized ultrasaw wave sound.
   * @param {AudioContext} audioContext - The global AudioContext.
   * @param {number} time - The time to schedule the sound to play.
   * @param {object} settings - The settings for the sound.
   * @param {AudioNode} destination - The destination node for the sound.
   */
  playUltrasaw: (
    audioContext,
    time,
    { volume = 1.0, frequency = 440, attack = 0.01, decay = 0.2, sustain = 0.5, release = 0.2, detune = 15 } = {},
    destination = null
  ) => {
    const gain = audioContext.createGain();
    gain.connect(destination || audioContext.destination);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + attack);
    gain.gain.linearRampToValueAtTime(volume * sustain, time + attack + decay);
    gain.gain.setValueAtTime(volume * sustain, time + attack + decay + release);
    gain.gain.linearRampToValueAtTime(0, time + attack + decay + release + 0.01);

    const osc1 = audioContext.createOscillator();
    osc1.type = "sawtooth";
    osc1.frequency.setValueAtTime(frequency, time);
    osc1.detune.setValueAtTime(-detune, time);
    osc1.connect(gain);
    osc1.start(time);
    osc1.stop(time + attack + decay + release + 0.1);

    const osc2 = audioContext.createOscillator();
    osc2.type = "sawtooth";
    osc2.frequency.setValueAtTime(frequency, time);
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

    const bufferSize = audioContext.sampleRate * 1;
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