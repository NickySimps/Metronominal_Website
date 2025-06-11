const AppState = (function () {
  // --- Private State ---
  let tempo = 120;
  let barSettings = []; // Stores the number of beats for each bar, e.g., [4, 3, 5]
  let selectedBarIndex = 0; // Index of the currently selected bar
  let isPlaying = false;
  let currentBar = 0;
  let currentBeat = 0; // This will be sub-beat index
  let currentVolume = 0.8;
  let beatMultiplier = 1;
  let tapTempoTimestamps = [];
  let audioContext = null;
  let clickSoundBuffer = null;
  let accentClickSoundBuffer = null;
  let nextBeatAudioContextTime = 0;
  let currentTheme = 'default'; // Added for theme state management
  let audioContextPrimed = false; // Flag to ensure priming happens once
  let cameraPosition3D = null; // Added for 3D theme camera state
  let cameraLookAtPoint3D = null; // Added for 3D theme camera state

  // --- Constants ---
  const MAX_TAPS_FOR_AVERAGE = 4;
  const MAX_TAP_INTERVAL_MS = 3000;
  const SCHEDULE_AHEAD_TIME_INTERNAL = 0.1; // Seconds
  const POST_RESUME_DELAY_MS = 50;  // Milliseconds to wait for AudioContext to stabilize after resume

  // --- Public API ---
  const publicAPI = {
    // Tempo
    getTempo: () => tempo,
    setTempo: (newTempo) => {
      tempo = Math.max(20, Math.min(parseInt(newTempo, 10) || 120, 300)); // Aligned with HTML slider
    },
    increaseTempo: () => {
      publicAPI.setTempo(tempo + 1);
    },
    decreaseTempo: () => {
      publicAPI.setTempo(tempo - 1);
    },
    addTapTimestamp: (timestamp) => {
      if (
        tapTempoTimestamps.length > 0 &&
        timestamp - tapTempoTimestamps[tapTempoTimestamps.length - 1] >
          MAX_TAP_INTERVAL_MS
      ) {
        tapTempoTimestamps = [];
      }
      tapTempoTimestamps.push(timestamp);
      if (tapTempoTimestamps.length > MAX_TAPS_FOR_AVERAGE) {
        tapTempoTimestamps.shift();
      }
    },
    calculateTapTempo: () => {
      if (tapTempoTimestamps.length < 2) return null;
      let totalInterval = 0;
      for (let i = 1; i < tapTempoTimestamps.length; i++) {
        totalInterval += tapTempoTimestamps[i] - tapTempoTimestamps[i - 1];
      }
      const averageInterval = totalInterval / (tapTempoTimestamps.length - 1);
      if (averageInterval > 0) {
        const newTempo = Math.round(60000 / averageInterval);
        publicAPI.setTempo(newTempo); // Automatically sets the tempo
        return tempo; // Return the newly set tempo
      }
      return null;
    },

    // Playback State
    isPlaying: () => isPlaying,
    togglePlay: async () => {
      // Made async
      // If trying to start but no bars are configured, prevent starting.
      if (!isPlaying && barSettings.length === 0) {
        console.log("Cannot start: No bars configured.");
        return false; // Indicate play was not started / state not changed
      }

      isPlaying = !isPlaying;
      if (isPlaying) {
        // Just transitioned to playing
        currentBar = 0;
        currentBeat = 0;
        if (audioContext) {
          const contextWasSuspended = audioContext.state === "suspended";
          if (contextWasSuspended) {
            try {
              await audioContext.resume(); // Wait for resume to complete
              console.log("AudioContext resumed successfully.");
              // Crucial: Wait a bit for audioContext.currentTime to stabilize after resume
              await new Promise(resolve => setTimeout(resolve, POST_RESUME_DELAY_MS));
            } catch (e) {
              console.error("Error resuming AudioContext:", e);
              // If resume fails, prevent playback from starting
              isPlaying = false;
              return false; // Indicate play was not started
            }
          }

          // Prime the AudioContext if it's running and hasn't been primed yet.
          // This helps stabilize the audio pipeline.
          if (audioContext.state === 'running' && !audioContextPrimed) {
            // Create a very short, silent buffer
            const primeBuffer = audioContext.createBuffer(
              1,
              1,
              audioContext.sampleRate
            ); // 1 channel, 1 sample frame
            const primeSource = audioContext.createBufferSource();
            primeSource.buffer = primeBuffer;
            primeSource.connect(audioContext.destination);
            // Start priming based on the now potentially more stable currentTime
            primeSource.start(audioContext.currentTime);
            // No need to explicitly call stop() for a 1-sample buffer, it plays out instantly.
            audioContextPrimed = true;
            console.log("AudioContext primed.");
            // Optional: A tiny additional delay after priming if issues persist, e.g., 5-10ms
            // await new Promise(resolve => setTimeout(resolve, 10));
          }

          // Schedule the first beat. Ensure currentTime is read *after* resume and potential priming.
          nextBeatAudioContextTime = audioContext.currentTime + publicAPI.SCHEDULE_AHEAD_TIME;
          console.log(`Initial nextBeatAudioContextTime set to: ${nextBeatAudioContextTime} (currentTime: ${audioContext.currentTime}, lookahead: ${publicAPI.SCHEDULE_AHEAD_TIME})`);
        }
      }
      // If isPlaying became false, MetronomeEngine will handle its own timer/audio cleanup.
      return isPlaying; // Return the new state
    },
    getCurrentBar: () => currentBar,
    getCurrentBeat: () => currentBeat,
    advanceBeat: () => {
      if (barSettings.length === 0) {
        isPlaying = false;
        return false;
      }
      currentBeat++;
      const totalSubBeatsInCurrentBar =
        barSettings[currentBar] * beatMultiplier;
      if (currentBeat >= totalSubBeatsInCurrentBar) {
        currentBeat = 0;
        currentBar++;
        if (currentBar >= barSettings.length) {
          currentBar = 0;
        }
      }
      return true;
    },
    resetPlaybackState: () => {
      currentBar = 0;
      currentBeat = 0;
      isPlaying = false;
    },

    // Bar Settings
    getBarSettings: () => [...barSettings],
    getSelectedBarIndex: () => selectedBarIndex,
    setSelectedBarIndex: (index) => {
      if (barSettings.length === 0) { // Highest priority: if no bars, always -1
        selectedBarIndex = -1;
      } else if (index === -1) { // Explicitly allow deselecting all if bars exist
        selectedBarIndex = -1;
      } else if (index >= 0 && index < barSettings.length) { // Valid index within bounds
        selectedBarIndex = index;
      } else { // Index is out of bounds (e.g., too high, or negative but not -1) and bars exist, clamp.
        selectedBarIndex = Math.max(0, Math.min(index, barSettings.length - 1));
      }
    },

    updateBarArray: (newTotalBars, defaultBeatsPerNewBar = 4) => {
      const previousNumberOfBars = barSettings.length;
      newTotalBars = parseInt(newTotalBars, 10);

      if (newTotalBars > previousNumberOfBars) {
        for (let i = previousNumberOfBars; i < newTotalBars; i++) {
          const beats =
            barSettings.length > 0
              ? barSettings[barSettings.length - 1]
              : defaultBeatsPerNewBar;
          barSettings.push(beats);
        }
      } else if (newTotalBars < previousNumberOfBars) {
        barSettings.length = newTotalBars;
      }

      publicAPI.setSelectedBarIndex(selectedBarIndex); // Re-validate selectedBarIndex

      if (barSettings.length === 0) {
        currentBar = 0;
        currentBeat = 0;
        if (isPlaying) isPlaying = false;
      } else {
        if (currentBar >= barSettings.length) {
          currentBar = 0;
          currentBeat = 0;
        } else if (currentBeat >= barSettings[currentBar] * beatMultiplier) {
          currentBeat = 0;
        }
      }
    },
    getBeatsForSelectedBar: () => {
      if (
        selectedBarIndex !== -1 &&
        barSettings[selectedBarIndex] !== undefined
      ) {
        return barSettings[selectedBarIndex];
      }
      return null;
    },
    increaseBeatsForSelectedBar: () => {
      if (
        selectedBarIndex !== -1 &&
        barSettings[selectedBarIndex] !== undefined
      ) {
        barSettings[selectedBarIndex]++;
      }
    },
    decreaseBeatsForSelectedBar: () => {
      if (
        selectedBarIndex !== -1 &&
        barSettings[selectedBarIndex] !== undefined
      ) {
        if (barSettings[selectedBarIndex] > 1) {
          barSettings[selectedBarIndex]--;
        }
      }
    },
    getTotalBeats: () => barSettings.reduce((sum, beats) => sum + beats, 0),

    // Beat Multiplier
    getBeatMultiplier: () => beatMultiplier,
    setBeatMultiplier: (multiplier) => {
      beatMultiplier = parseInt(multiplier, 10) || 1;
      if (
        barSettings.length > 0 &&
        currentBar < barSettings.length &&
        barSettings[currentBar] !== undefined
      ) {
        const totalSubBeatsInCurrentBar =
          barSettings[currentBar] * beatMultiplier;
        if (currentBeat >= totalSubBeatsInCurrentBar) {
          currentBeat = 0;
        }
      }
    },

    // Volume
    getVolume: () => currentVolume,
    setVolume: (volume) => {
      currentVolume = parseFloat(volume);
      if (currentVolume < 0) currentVolume = 0;
      if (currentVolume > 1) currentVolume = 1;
    },

    // AudioContext and Buffers
    initializeAudioContext: () => {
      try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        return audioContext;
      } catch (e) {
        console.warn("Web Audio API not supported.", e);
        audioContext = null;
        return null;
      }
    },
    getAudioContext: () => audioContext,
    loadAudioBuffers: async () => {
      if (!audioContext) return false;
      const loadSound = async (url) => {
        try {
          const response = await fetch(url);
          const arrayBuffer = await response.arrayBuffer();
          return await audioContext.decodeAudioData(arrayBuffer);
        } catch (e) {
          console.error(`Error loading or decoding audio file ${url}:`, e);
          return null;
        }
      };
      [clickSoundBuffer, accentClickSoundBuffer] = await Promise.all([
        loadSound("Click1.mp3"),
        loadSound("Click2.mp3"),
      ]);
      return !!(clickSoundBuffer && accentClickSoundBuffer);
    }, // Corrected name
    getClickSoundBuffer: () => clickSoundBuffer, // Corrected name
    getAccentSoundBuffer: () => accentClickSoundBuffer, // Corrected name
    getNextBeatAudioContextTime: () => nextBeatAudioContextTime,
    setNextBeatAudioContextTime: (time) => {
      nextBeatAudioContextTime = time;
    },
    incrementNextBeatAudioContextTime: (secondsPerSubBeat) => {
      nextBeatAudioContextTime += secondsPerSubBeat;
    },

    // Presets
    getCurrentStateForPreset: () => ({
      tempo: tempo,
      barSettings: JSON.parse(JSON.stringify(barSettings)),
      beatMultiplier: beatMultiplier,
      volume: currentVolume,
      selectedTheme: currentTheme, // Include current theme
    }),
    /**
     * Loads preset data into the application state.
     * @param {object} presetData - The preset data object.
     * @returns {string|null} The theme name from the preset, or 'default' if not found.
     */
    loadPresetData: (presetData) => {
      if (!presetData) {
        console.error("No preset data provided to loadPresetData.");
        return null;
      }

      try {
        // Directly use properties from the passed presetData object
        tempo = presetData.tempo || 120;
        barSettings = Array.isArray(presetData.barSettings)
          ? presetData.barSettings
          : [4];
        beatMultiplier = presetData.beatMultiplier || 1;
        currentVolume =
          typeof presetData.volume === "number" ? presetData.volume : 0.8;

        publicAPI.setSelectedBarIndex(0); // Reset selection
        if (barSettings.length === 0) {
          currentBar = 0;
          currentBeat = 0;
          isPlaying = false;
        } else if (currentBar >= barSettings.length) {
          currentBar = 0;
          currentBeat = 0;
        }
        // Set the theme in AppState
        publicAPI.setCurrentTheme(presetData.selectedTheme || 'default');
        // Return theme for script.js to call ThemeController.applyTheme
        return presetData.selectedTheme || "default";
      } catch (e) {
        console.error("Error parsing preset:", e);
        return null;
      }
    },

    // Reset & Initialization
    resetState: () => {
      tempo = 120;
      beatMultiplier = 1;
      currentVolume = 0.8; // Reset volume to default
      barSettings = [4];
      selectedBarIndex = 0;
      currentBar = 0;
      currentBeat = 0;
      isPlaying = false;
      tapTempoTimestamps = [];
      currentTheme = 'default'; // Reset theme to default
      cameraPosition3D = null; // Reset 3D camera state
      cameraLookAtPoint3D = null; // Reset 3D camera state
    },
    initializeState: (
      initialNumberOfBars,
      initialBeatsPerMeasure,
      initialBeatMultiplier,
      initialVolume,
      initialTheme // Added initialTheme
    ) => {
      barSettings = Array(initialNumberOfBars).fill(initialBeatsPerMeasure);
      // Always initialize with no bar selected.
      // User interaction or preset loading will determine selection.
      selectedBarIndex = -1;
      // If initialNumberOfBars is 0, selectedBarIndex remains -1.
      // If initialNumberOfBars > 0, selectedBarIndex is also -1 initially.
      beatMultiplier = initialBeatMultiplier;
      currentVolume = initialVolume;
      currentTheme = initialTheme || 'default'; // Initialize theme
      // tempo is already at its default 120
    },

    // Theme state management
    getCurrentTheme: () => currentTheme,
    setCurrentTheme: (themeName) => {
      currentTheme = themeName;
    },

    // 3D Camera State
    getCameraPosition3D: () => cameraPosition3D,
    setCameraPosition3D: (pos) => { cameraPosition3D = pos ? { x: pos.x, y: pos.y, z: pos.z } : null; },
    getCameraLookAtPoint3D: () => cameraLookAtPoint3D,
    setCameraLookAtPoint3D: (lookAt) => { cameraLookAtPoint3D = lookAt ? { x: lookAt.x, y: lookAt.y, z: lookAt.z } : null; },


    // Constants
    SCHEDULE_AHEAD_TIME: SCHEDULE_AHEAD_TIME_INTERNAL,
  };
  return publicAPI;
})(); // End of IIFE
export default AppState; // Export the AppState object as the default export
