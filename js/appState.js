// js/appState.js

const AppState = (function () {
  // --- Private State ---
  let tempo = 120;
  let volume = 1.0;
  let Tracks = [];
  let selectedTrackIndex = 0;
  let selectedBarIndexInContainer = 0;
  let isPlaying = false;
  let tapTempoTimestamps = [];
  let audioContext = null;
  let soundBuffers = {};
  let currentTheme = "default";
  let audioContextPrimed = false;
  let cameraPosition3D = null;
  let cameraLookAtPoint3D = null;

  // --- Constants ---
  const MAX_TAPS_FOR_AVERAGE = 4;
  const MAX_TAP_INTERVAL_MS = 3000;
  const SCHEDULE_AHEAD_TIME_INTERNAL = 0.1;
  const POST_RESUME_DELAY_MS = 50;

  // --- Public API ---
  const publicAPI = {
    // Tempo
    getTempo: () => tempo,
    setTempo: (newTempo) => {
      tempo = Math.max(20, Math.min(parseInt(newTempo, 10) || 120, 300));
    },
    increaseTempo: () => publicAPI.setTempo(tempo + 1),
    decreaseTempo: () => publicAPI.setTempo(tempo - 1),
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
        publicAPI.setTempo(newTempo);
        return tempo;
      }
      return null;
    },

    // Volume
    getVolume: () => volume,
    setVolume: (newVolume) => {
      volume = Math.max(0, Math.min(parseFloat(newVolume), 1));
    },

    // Playback State
    isPlaying: () => isPlaying,
    togglePlay: async () => {
      if (
        !isPlaying &&
        Tracks.every((container) => container.barSettings.length === 0)
      ) {
        console.log("Cannot start: No bars configured in any container.");
        return false;
      }

      isPlaying = !isPlaying;

      if (isPlaying) {
        if (audioContext) {
          const contextWasSuspended = audioContext.state === "suspended";
          if (contextWasSuspended) {
            try {
              await audioContext.resume();
              await new Promise((resolve) =>
                setTimeout(resolve, POST_RESUME_DELAY_MS)
              );
            } catch (e) {
              console.error("Error resuming AudioContext:", e);
              isPlaying = false;
              return false;
            }
          }

          if (audioContext.state === "running" && !audioContextPrimed) {
            const primeBuffer = audioContext.createBuffer(
              1,
              1,
              audioContext.sampleRate
            );
            const primeSource = audioContext.createBufferSource();
            primeSource.buffer = primeBuffer;
            primeSource.connect(audioContext.destination);
            primeSource.start(audioContext.currentTime);
            audioContextPrimed = true;
          }

          const currentTime = audioContext.currentTime;
          Tracks.forEach((track) => {
            track.currentBar = 0;
            track.currentBeat = 0;
            track.nextBeatTime = currentTime + publicAPI.SCHEDULE_AHEAD_TIME;
          });
        }
      }
      return isPlaying;
    },

    getTracks: () => Tracks,
    addTrack: () => {
      Tracks.push({
        barSettings: [{ beats: 4, subdivision: 1 }],
        muted: false,
        currentBar: 0,
        currentBeat: 0,
        mainBeatSound: "Click1.mp3",
        subdivisionSound: "Click2.mp3",
        nextBeatTime: 0,
      });
      publicAPI.setSelectedTrackIndex(Tracks.length - 1);
      publicAPI.setSelectedBarIndexInContainer(0);
    },
    removeTrack: (containerIndex) => {
      if (Tracks.length > 1) {
        Tracks.splice(containerIndex, 1);
        if (selectedTrackIndex >= Tracks.length) {
          publicAPI.setSelectedTrackIndex(Tracks.length - 1);
        }
      } else if (Tracks.length === 1) {
        Tracks[0] = {
          barSettings: [],
          muted: false,
          currentBar: 0,
          currentBeat: 0,
        };
        publicAPI.setSelectedTrackIndex(0);
        publicAPI.setSelectedBarIndexInContainer(-1);
      }
    },
    updateTrack: (containerIndex, updatedProperties) => {
      if (Tracks[containerIndex]) {
        Object.assign(Tracks[containerIndex], updatedProperties);
      }
    },
    resetPlaybackState: () => {
      Tracks.forEach((container) => {
        container.currentBar = 0;
        container.currentBeat = 0;
      });
      isPlaying = false;
    },

    // Bar Settings
    getBarSettings: (trackIndex) => {
      const targetTrackIndex =
        trackIndex !== undefined && trackIndex !== -1
          ? trackIndex
          : selectedTrackIndex;
      if (targetTrackIndex !== -1 && Tracks[targetTrackIndex]) {
        return Tracks[targetTrackIndex].barSettings;
      }
      return [];
    },
    getSelectedTrackIndex: () => selectedTrackIndex,
    setSelectedTrackIndex: (index) => {
      if (Tracks.length === 0 || index === -1) {
        selectedTrackIndex = -1;
        selectedBarIndexInContainer = -1;
      } else if (index >= 0 && index < Tracks.length) {
        selectedTrackIndex = index;
        const currentContainerBarSettings =
          Tracks[selectedTrackIndex].barSettings;
        if (selectedBarIndexInContainer >= currentContainerBarSettings.length) {
          selectedBarIndexInContainer = Math.max(
            0,
            currentContainerBarSettings.length - 1
          );
        }
      }
    },
    getSelectedBarIndexInContainer: () => selectedBarIndexInContainer,
    setSelectedBarIndexInContainer: (index) => {
      const currentContainer = Tracks[selectedTrackIndex];
      if (
        !currentContainer ||
        currentContainer.barSettings.length === 0 ||
        index === -1
      ) {
        selectedBarIndexInContainer = -1;
      } else if (index >= 0 && index < currentContainer.barSettings.length) {
        selectedBarIndexInContainer = index;
      }
    },
    updateBarArray: (
      newTotalBars,
      defaultBeatsPerNewBar = 4,
      defaultSubdivisionPerNewBar = 1
    ) => {
      const currentContainer = Tracks[selectedTrackIndex];
      if (!currentContainer) return;

      const previousNumberOfBars = currentContainer.barSettings.length;
      newTotalBars = parseInt(newTotalBars, 10);

      if (newTotalBars > previousNumberOfBars) {
        for (let i = previousNumberOfBars; i < newTotalBars; i++) {
          const beats =
            currentContainer.barSettings.length > 0
              ? currentContainer.barSettings[
                  currentContainer.barSettings.length - 1
                ].beats
              : defaultBeatsPerNewBar;
          const subdivision =
            currentContainer.barSettings.length > 0
              ? currentContainer.barSettings[
                  currentContainer.barSettings.length - 1
                ].subdivision
              : defaultSubdivisionPerNewBar;
          currentContainer.barSettings.push({
            beats: beats,
            subdivision: subdivision,
          });
        }
      } else if (newTotalBars < previousNumberOfBars) {
        currentContainer.barSettings.length = newTotalBars;
      }
    },

    getTotalBeats: () => {
      const selectedTrack = Tracks[selectedTrackIndex];
      if (!selectedTrack || !selectedTrack.barSettings) {
        return 0;
      }
      // Sum the 'beats' from each bar in the selected track
      return selectedTrack.barSettings.reduce(
        (total, bar) => total + parseInt(bar.beats, 10),
        0
      );
    },
    getBeatsForSelectedBar: () => {
      const currentContainer = Tracks[selectedTrackIndex];
      if (
        currentContainer &&
        selectedBarIndexInContainer !== -1 &&
        currentContainer.barSettings[selectedBarIndexInContainer]
      ) {
        return currentContainer.barSettings[selectedBarIndexInContainer].beats;
      }
      return null;
    },
    increaseBeatsForSelectedBar: () => {
      const currentContainer = Tracks[selectedTrackIndex];
      if (
        currentContainer &&
        selectedBarIndexInContainer !== -1 &&
        currentContainer.barSettings[selectedBarIndexInContainer]
      ) {
        currentContainer.barSettings[selectedBarIndexInContainer].beats++;
      }
    },
    decreaseBeatsForSelectedBar: () => {
      const currentContainer = Tracks[selectedTrackIndex];
      if (
        currentContainer &&
        selectedBarIndexInContainer !== -1 &&
        currentContainer.barSettings[selectedBarIndexInContainer]
      ) {
        if (
          currentContainer.barSettings[selectedBarIndexInContainer].beats > 1
        ) {
          currentContainer.barSettings[selectedBarIndexInContainer].beats--;
        }
      }
    },
    getSubdivisionForSelectedBar: () => {
      const currentContainer = Tracks[selectedTrackIndex];
      if (
        currentContainer &&
        selectedBarIndexInContainer !== -1 &&
        currentContainer.barSettings[selectedBarIndexInContainer]
      ) {
        return currentContainer.barSettings[selectedBarIndexInContainer]
          .subdivision;
      }
      return 1;
    },

    /**
     * ADD THIS FUNCTION
     * Gets the subdivision for a specific bar in a specific track.
     * @param {number} trackIndex - The index of the track.
     * @param {number} barIndex - The index of the bar within the track.
     * @returns {number} The subdivision value, or 1 as a default.
     */
    getSubdivisionForBar: (trackIndex, barIndex) => {
        const track = Tracks[trackIndex];
        if (track && track.barSettings && track.barSettings[barIndex]) {
            return track.barSettings[barIndex].subdivision;
        }
        return 1; // Return a default value if not found
    },
    
    setSubdivisionForSelectedBar: (multiplier) => {
      const currentContainer = Tracks[selectedTrackIndex];
      if (currentContainer && selectedBarIndexInContainer !== -1) {
        currentContainer.barSettings[selectedBarIndexInContainer].subdivision =
          parseFloat(multiplier) || 1;
      }
    },

    // AudioContext and Buffers
    initializeAudioContext: () => {
      try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        return audioContext;
      } catch (e) {
        console.warn("Web Audio API not supported.", e);
        return null;
      }
    },
    getAudioContext: () => audioContext,
    loadAudioBuffers: async () => {
      if (!audioContext) return false;
      const sounds = ["Click1.mp3", "Click2.mp3", "Crank1.mp3", "Crank2.mp3"];
      for (const sound of sounds) {
        try {
          const response = await fetch(sound);
          const arrayBuffer = await response.arrayBuffer();
          soundBuffers[sound] = await audioContext.decodeAudioData(arrayBuffer);
        } catch (e) {
          console.error(`Error loading or decoding audio file ${sound}:`, e);
        }
      }
      return Object.keys(soundBuffers).length > 0;
    },
    getSoundBuffer: (sound) => soundBuffers[sound],

    // Presets
    getCurrentStateForPreset: () => ({
      tempo: tempo,
      Tracks: JSON.parse(JSON.stringify(Tracks)),
      selectedTheme: currentTheme,
    }),
    loadPresetData: (presetData) => {
      if (!presetData) return;

      tempo = presetData.tempo || 120;
      if (Array.isArray(presetData.Tracks)) {
        Tracks = presetData.Tracks.map((container) => {
          const newContainer = {
            barSettings: [],
            muted: container.muted || false,
            currentBar: 0,
            currentBeat: 0,
            nextBeatTime: 0,
          };
          if (Array.isArray(container.barSettings)) {
            newContainer.barSettings = container.barSettings.map((bar) => ({
              beats: bar.beats || 4,
              subdivision: bar.subdivision || 1,
            }));
          }
          return newContainer;
        });
      }
      publicAPI.setSelectedTrackIndex(0);
      publicAPI.setSelectedBarIndexInContainer(0);
      isPlaying = false;
      publicAPI.setCurrentTheme(presetData.selectedTheme || "default");
    },

    // Reset & Initialization
    resetState: () => {
      tempo = 120;
      volume = 1.0;
      Tracks = [
        {
          barSettings: [{ beats: 4, subdivision: 1 }],
          muted: false,
          currentBar: 0,
          currentBeat: 0,
          mainBeatSound: "Click1.mp3",
          subdivisionSound: "Click2.mp3",
          nextBeatTime: 0,
        },
      ];
      selectedTrackIndex = 0;
      selectedBarIndexInContainer = 0;
      isPlaying = false;
      currentTheme = "default";
    },

    // Theme
    getCurrentTheme: () => currentTheme,
    setCurrentTheme: (themeName) => {
      currentTheme = themeName;
    },

    // Constants
    SCHEDULE_AHEAD_TIME: SCHEDULE_AHEAD_TIME_INTERNAL,
  };
  return publicAPI;
})();
export default AppState;