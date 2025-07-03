
/**
 * A collection of functions to synthesize drum sounds using the Web Audio API.
 */
const SoundSynth = {
  /**
   * Plays a synthesized kick drum sound.
   * A kick is a low-frequency sine wave with a rapid pitch and volume drop.
   * @param {AudioContext} audioContext - The global AudioContext.
   * @param {number} time - The time to schedule the sound to play.
   * @param {number} volume - The master volume level (0.0 to 1.0).
   */
  playKick: (audioContext, time, volume = 1.0) => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.connect(gain);
    gain.connect(audioContext.destination);

    // Set master volume
    gain.gain.setValueAtTime(volume, time);

    // Pitch Envelope (from 150Hz down to 50Hz)
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(50, time + 0.1);

    // Volume Envelope (a sharp decay)
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.4);

    osc.start(time);
    osc.stop(time + 0.4);
  },

  /**
   * Plays a synthesized snare drum sound.
   * A snare is a mix of a tonal "thump" and a burst of filtered noise.
   * @param {AudioContext} audioContext - The global AudioContext.
   * @param {number} time - The time to schedule the sound to play.
   * @param {number} volume - The master volume level (0.0 to 1.0).
   */
  playSnare: (audioContext, time, volume = 1.0) => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const noise = audioContext.createBufferSource();
    const noiseFilter = audioContext.createBiquadFilter();
    const noiseGain = audioContext.createGain();

    // Configure the tonal part (the "body" of the snare)
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(200, time);
    osc.frequency.exponentialRampToValueAtTime(100, time + 0.1);
    gain.gain.setValueAtTime(0.7 * volume, time);
    gain.gain.exponentialRampToValueAtTime(0.01 * volume, time + 0.2);
    
    osc.connect(gain);
    gain.connect(audioContext.destination);

    // Configure the noise part (the "snap" of the snare)
    const bufferSize = audioContext.sampleRate * 0.2; // 0.2 seconds of noise
    const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    noise.buffer = buffer;

    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 1500;
    
    noiseGain.gain.setValueAtTime(0.8 * volume, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(audioContext.destination);

    osc.start(time);
    noise.start(time);

    osc.stop(time + 0.3);
    noise.stop(time + 0.3);
  },

  /**
   * Plays a synthesized closed hi-hat sound.
   * A hi-hat is a very short burst of high-frequency filtered noise.
   * @param {AudioContext} audioContext - The global AudioContext.
   * @param {number} time - The time to schedule the sound to play.
   * @param {number} volume - The master volume level (0.0 to 1.0).
   */
  playHiHat: (audioContext, time, volume = 1.0) => {
    const noise = audioContext.createBufferSource();
    const noiseFilter = audioContext.createBiquadFilter();
    const noiseGain = audioContext.createGain();

    // Use the same noise generation as the snare
    const bufferSize = audioContext.sampleRate * 0.1; 
    const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    noise.buffer = buffer;

    // Filter the noise to be high-frequency (the "tsss" sound)
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 7000;

    // Very short volume envelope for a "ticking" sound
    noiseGain.gain.setValueAtTime(0.4 * volume, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(audioContext.destination);
    
    noise.start(time);
    noise.stop(time + 0.1);
  },

    /**
   * Plays a synthesized open hi-hat sound.
   * Similar to a closed hi-hat but with a longer, sustained decay.
   * @param {AudioContext} audioContext - The global AudioContext.
   * @param {number} time - The time to schedule the sound to play.
   * @param {number} volume - The master volume level (0.0 to 1.0).
   */
  playOpenHiHat: (audioContext, time, volume = 1.0) => {
    const noise = audioContext.createBufferSource();
    const noiseFilter = audioContext.createBiquadFilter();
    const noiseGain = audioContext.createGain();

    const bufferSize = audioContext.sampleRate * 0.5; 
    const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    noise.buffer = buffer;

    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 6000;

    // Longer decay for the "open" sound
    noiseGain.gain.setValueAtTime(0.4 * volume, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.4);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(audioContext.destination);
    
    noise.start(time);
    noise.stop(time + 0.5);
  },

  /**
   * Plays a synthesized high tom drum sound.
   * @param {AudioContext} audioContext - The global AudioContext.
   * @param {number} time - The time to schedule the sound to play.
   * @param {number} volume - The master volume level (0.0 to 1.0).
   */
  playHiTom: (audioContext, time, volume = 1.0) => {
    const osc = audioContext.createOscillator(); // Tonal part
    const gain = audioContext.createGain(); // Gain for tonal part

    // Tonal part (pitched sine wave)
    osc.frequency.setValueAtTime(300, time); // Higher start frequency
    osc.frequency.exponentialRampToValueAtTime(150, time + 0.2); 
    osc.type = 'triangle';
    gain.gain.setValueAtTime(1.0 * volume, time); // Full volume
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3); // Decay quickly
    
    osc.connect(gain);
    gain.connect(audioContext.destination);

    osc.start(time);
    osc.stop(time + 0.3); // Stop after the decay
  },

  /**
   * Plays a synthesized mid tom drum sound.
   * @param {AudioContext} audioContext - The global AudioContext.
   * @param {number} time - The time to schedule the sound to play.
   * @param {number} volume - The master volume level (0.0 to 1.0).
   */
  playMidTom: (audioContext, time, volume = 1.0) => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.frequency.setValueAtTime(150, time); 
    osc.frequency.exponentialRampToValueAtTime(80, time + 0.25);
    osc.type = 'triangle';
    gain.gain.setValueAtTime(1.0 * volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.4);
    
    osc.connect(gain);
    gain.connect(audioContext.destination);

    osc.start(time);
    osc.stop(time + 0.4);
  },

  /**
   * Plays a synthesized low tom drum sound.
   * @param {AudioContext} audioContext - The global AudioContext.
   * @param {number} time - The time to schedule the sound to play.
   * @param {number} volume - The master volume level (0.0 to 1.0).
   */
  playLowTom: (audioContext, time, volume = 1.0) => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.frequency.setValueAtTime(100, time); // Lower start frequency
    osc.frequency.exponentialRampToValueAtTime(50, time + 0.3);
    osc.type = 'triangle';
    gain.gain.setValueAtTime(1.0 * volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.5);
    
    osc.connect(gain);
    gain.connect(audioContext.destination);

    osc.start(time);
    osc.stop(time + 0.5);
  },

  /**
   * Plays a synthesized clap sound.
   * A clap is a short, sharp burst of filtered noise.
   * @param {AudioContext} audioContext - The global AudioContext.
   * @param {number} time - The time to schedule the sound to play.
   * @param {number} volume - The master volume level (0.0 to 1.0).
   */
  playClap: (audioContext, time, volume = 1.0) => {
    const noise = audioContext.createBufferSource();
    const noiseFilter = audioContext.createBiquadFilter();
    const noiseGain = audioContext.createGain();

    const bufferSize = audioContext.sampleRate * 0.2;
    const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    noise.buffer = buffer;

    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 1200;
    noiseFilter.Q.value = 15;

    noiseGain.gain.setValueAtTime(0, time);
    noiseGain.gain.linearRampToValueAtTime(volume, time + 0.01);
    noiseGain.gain.exponentialRampToValueAtTime(0.3 * volume, time + 0.03);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(audioContext.destination);

    noise.start(time);
    noise.stop(time + 0.2);
  },

  /**
   * Plays a synthesized claves sound.
   * Claves are a very short, high-pitched, tonal "tick".
   * @param {AudioContext} audioContext - The global AudioContext.
   * @param {number} time - The time to schedule the sound to play.
   * @param {number} volume - The master volume level (0.0 to 1.0).
   */
  playClaves: (audioContext, time, volume = 1.0) => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(2500, time);
    
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);

    osc.connect(gain);
    gain.connect(audioContext.destination);

    osc.start(time);
    osc.stop(time + 0.1);
  },

  /**
   * Plays a synthesized shaker sound.
   * A shaker is a sustained burst of high-frequency noise.
   * @param {AudioContext} audioContext - The global AudioContext.
   * @param {number} time - The time to schedule the sound to play.
   * @param {number} volume - The master volume level (0.0 to 1.0).
   */
  playShaker: (audioContext, time, volume = 1.0) => {
    const noise = audioContext.createBufferSource();
    const noiseFilter = audioContext.createBiquadFilter();
    const noiseGain = audioContext.createGain();

    const bufferSize = audioContext.sampleRate * 0.3;
    const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    noise.buffer = buffer;

    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 6000;
    noiseFilter.Q.value = 5;

    noiseGain.gain.setValueAtTime(0, time);
    noiseGain.gain.linearRampToValueAtTime(0.5 * volume, time + 0.02);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(audioContext.destination);

    noise.start(time);
    noise.stop(time + 0.3);
  }
};

export default SoundSynth;