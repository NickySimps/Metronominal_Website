// js/appState.js

const defaultKick = {
  volume: 1.0,
  startFrequency: 150,
  endFrequency: 50,
  decay: 0.4,
  pitchEnvelopeTime: 0.1,
};

const defaultSnare = {
  volume: 1.0,
  bodyFrequencyStart: 200,
  bodyFrequencyEnd: 100,
  bodyDecay: 0.2,
  noiseFilterFrequency: 1500,
  noiseDecay: 0.2,
};

const defaultHiHat = {
  volume: 1.0,
  filterFrequency: 7000,
  decay: 0.05,
};

const defaultOpenHiHat = {
  volume: 1.0,
  filterFrequency: 6000,
  decay: 0.4,
};

const defaultHiTom = {
  volume: 1.0,
  startFrequency: 300,
  endFrequency: 150,
  decay: 0.3,
};

const defaultMidTom = {
  volume: 1.0,
  startFrequency: 150,
  endFrequency: 80,
  decay: 0.4,
};

const defaultLowTom = {
  volume: 1.0,
  startFrequency: 100,
  endFrequency: 50,
  decay: 0.5,
};

const defaultClap = {
  volume: 1.0,
  filterFrequency: 1200,
  qValue: 15,
  decay: 0.15,
};

const defaultClaves = {
  volume: 1.0,
  frequency: 2500,
  decay: 0.08,
};

const defaultShaker = {
  volume: 1.0,
  filterFrequency: 6000,
  qValue: 5,
  decay: 0.2,
};

const defaultSoundSettings = {
  "Synth Kick": defaultKick,
  "Synth Snare": defaultSnare,
  "Synth HiHat": defaultHiHat,
  "Synth Open HiHat": defaultOpenHiHat,
  "Synth Hi Tom": defaultHiTom,
  "Synth Mid Tom": defaultMidTom,
  "Synth Low Tom": defaultLowTom,
  "Synth Clap": defaultClap,
  "Synth Claves": defaultClaves,
  "Synth Shaker": defaultShaker,
};

const AppState = (function () {
  // --- Private State ---
  let tempo = 120;
  let volume = 1.0;
  let Tracks = [
    {
      barSettings: [{ beats: 4, subdivision: 1 }],
      muted: false,
      solo: false,
      volume: 1.0,
      currentBar: 0,
      currentBeat: 0,
      mainBeatSound: { sound: "Synth Kick", settings: { ...defaultKick } },
      subdivisionSound: { sound: "Synth HiHat", settings: { ...defaultHiHat } },
      nextBeatTime: 0,
      analyserNode: null,
    },
  ];
  let selectedTrackIndex = 0;
  let selectedBarIndexInContainer = 0;
  let controlsAttachedToTrack = true; // NEW: Tracks if controls are attached to a track or in default position
  let isPlaying = false;
  let tapTempoTimestamps = [];
  let audioContext = null;
  let soundBuffers = {};
  let currentTheme = "default";
  let audioContextPrimed = false;


  // --- Constants ---
  const MAX_TAPS_FOR_AVERAGE = 2;
  const MAX_TAP_INTERVAL_MS = 3000;
  const SCHEDULE_AHEAD_TIME_INTERNAL = 0.1;
  const POST_RESUME_DELAY_MS = 50;
  const LOCAL_STORAGE_KEY = "metronominalState";

  // --- Private Functions ---
  const saveState = () => {
    try {
      const state = publicAPI.getCurrentStateForPreset();
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error("Could not save state to localStorage:", e);
    }
  };

  // --- Public API ---
  const publicAPI = {
    // Persistence
    saveStateToLocalStorage: saveState,
    loadStateFromLocalStorage: () => {
      try {
        const savedState = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (savedState) {
          const parsedState = JSON.parse(savedState);
          publicAPI.loadPresetData(parsedState);
          return true; // Indicates success
        }
        return false; // No saved state found
      } catch (e) {
        console.error("Could not load state from localStorage:", e);
        return false; // Error during loading
      }
    },

    // Tempo
    getTempo: () => tempo,
    setTempo: (newTempo) => {
      tempo = Math.max(20, Math.min(parseInt(newTempo, 10) || 120, 300));
      saveState();
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
      saveState();
    },

    // Playback State
    getControlsAttachedToTrack: () => controlsAttachedToTrack,
    setControlsAttachedToTrack: (isAttached) => {
        controlsAttachedToTrack = !!isAttached;
        saveState();
    },
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
      const newTrack = {
        barSettings: [{ beats: 4, subdivision: 1 }],
        muted: false,
        solo: false,
        volume: 1.0,
        currentBar: 0,
        currentBeat: 0,
        mainBeatSound: { sound: "Synth Kick", settings: { ...defaultKick } },
        subdivisionSound: {
          sound: "Synth HiHat",
          settings: { ...defaultHiHat },
        },
        nextBeatTime: 0,
        analyserNode: null,
      };
      if (audioContext) {
        const analyser = audioContext.createAnalyser();
        analyser.connect(audioContext.destination);
        newTrack.analyserNode = analyser;
      }
      Tracks.push(newTrack);
      publicAPI.setSelectedTrackIndex(Tracks.length - 1);
      publicAPI.setSelectedBarIndexInContainer(0);
      publicAPI.setControlsAttachedToTrack(true);
      saveState();
    },
    removeTrack: (indexToRemove) => {
        if (Tracks.length <= 1) {
            // If it's the last track, just clear its bars instead of removing it.
            Tracks[0].barSettings = [];
            publicAPI.setSelectedBarIndexInContainer(-1); // No bar is selected
            saveState();
            return;
        }

        const wasSelected = selectedTrackIndex === indexToRemove;

        // Remove the track
        Tracks.splice(indexToRemove, 1);

        if (wasSelected) {
            // The selected track was removed. Select the next closest one.
            // If the removed track was at or after the new end of the array, select the new last track.
            const newIndex = Math.min(indexToRemove, Tracks.length - 1);
            publicAPI.setSelectedTrackIndex(newIndex);

            // Select the last measure bar of the new track
            const newTrack = Tracks[newIndex];
            if (newTrack && newTrack.barSettings.length > 0) {
                publicAPI.setSelectedBarIndexInContainer(newTrack.barSettings.length - 1);
            } else {
                publicAPI.setSelectedBarIndexInContainer(-1);
            }
        } else if (selectedTrackIndex > indexToRemove) {
            // The selected track was after the removed one, so its index has shifted.
            publicAPI.setSelectedTrackIndex(selectedTrackIndex - 1);
        }
        
        publicAPI.setControlsAttachedToTrack(true); // Ensure controls re-attach
        saveState();
    },
    updateTrack: (containerIndex, updatedProperties) => {
      if (Tracks[containerIndex]) {
        Object.assign(Tracks[containerIndex], updatedProperties);
        saveState();
      }
    },
    isAnyTrackSoloed: () => Tracks.some((track) => track.solo),
    toggleSolo: (trackIndex) => {
      if (Tracks[trackIndex]) {
        Tracks[trackIndex].solo = !Tracks[trackIndex].solo;
        if (Tracks[trackIndex].solo) {
          Tracks[trackIndex].muted = false;
        }
        saveState();
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
        selectedTrackIndex = index;
    },
    getSelectedBarIndexInContainer: () => selectedBarIndexInContainer,
    setSelectedBarIndexInContainer: (index) => {
        selectedBarIndexInContainer = index;
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
        if (isPlaying && currentContainer.currentBar >= newTotalBars) {
            currentContainer.currentBar = 0;
            currentContainer.currentBeat = 0;
            if (audioContext) {
                currentContainer.nextBeatTime = audioContext.currentTime;
            }
        }
      }

      if (newTotalBars === 0 && selectedBarIndexInContainer !== -1) {
          publicAPI.setSelectedBarIndexInContainer(-1);
      }

      saveState();
    },

    getTotalBeats: () => {
      const selectedTrack = Tracks[selectedTrackIndex];
      if (!selectedTrack || !selectedTrack.barSettings) {
        return 0;
      }
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
        saveState();
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
          saveState();
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
    getSubdivisionForBar: (trackIndex, barIndex) => {
      const track = Tracks[trackIndex];
      if (track && track.barSettings && track.barSettings[barIndex]) {
        return track.barSettings[barIndex].subdivision;
      }
      return 1;
    },
    setSubdivisionForSelectedBar: (multiplier) => {
      const currentContainer = Tracks[selectedTrackIndex];
      if (currentContainer && selectedBarIndexInContainer !== -1) {
        currentContainer.barSettings[selectedBarIndexInContainer].subdivision =
          parseFloat(multiplier) || 1;
        saveState();
      }
    },

    // AudioContext and Buffers
    getAnalyserNodes: () => Tracks.map((track) => track.analyserNode), 

    initializeAudioContext: () => {
      try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        publicAPI.createTrackAnalysers();
        return audioContext;
      } catch (e) {
        console.warn("Web Audio API not supported.", e);
        return null;
      }
    },
    createTrackAnalysers: () => {
      if (!audioContext) return;
      Tracks.forEach((track) => {
        if (!track.analyserNode) {
          track.analyserNode = audioContext.createAnalyser();
          track.analyserNode.connect(audioContext.destination);
        }
      });
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
    getDefaultSoundSettings: (sound) => {
      return defaultSoundSettings[sound];
    },

    // Presets & State
    getCurrentStateForPreset: () => ({
      tempo: tempo,
      volume: volume,
      Tracks: JSON.parse(
        JSON.stringify(
          Tracks.map((track) => {
            const { analyserNode, ...remaningTrack } = track;
            return remaningTrack;
          })
        )
      ),
      selectedTheme: currentTheme,
      selectedTrackIndex: selectedTrackIndex,
      selectedBarIndexInContainer: selectedBarIndexInContainer,
      controlsAttachedToTrack: controlsAttachedToTrack,
      isPlaying: isPlaying,
    }),
    loadPresetData: (data) => {
      if (!data) return;
      tempo = data.tempo || 120;
      volume = data.volume || 1.0;
      if (Array.isArray(data.Tracks)) {
        Tracks = data.Tracks;
        Tracks.forEach((track) => {
          if (track.solo === undefined) track.solo = false;
          if (track.volume === undefined) track.volume = 1.0;
          track.analyserNode = null;
        });
        if (audioContext) publicAPI.createTrackAnalysers();
      }
      publicAPI.setCurrentTheme(data.selectedTheme || "default");
      
      selectedTrackIndex = data.selectedTrackIndex !== undefined ? data.selectedTrackIndex : 0;
      selectedBarIndexInContainer = data.selectedBarIndexInContainer !== undefined ? data.selectedBarIndexInContainer : 0;
      controlsAttachedToTrack = data.controlsAttachedToTrack !== undefined ? data.controlsAttachedToTrack : true;

      isPlaying = data.isPlaying || false;
    },

    // Reset & Initialization
    resetState: () => {
      tempo = 120;
      volume = 1.0;
      Tracks = [
        {
          barSettings: [{ beats: 4, subdivision: 1 }],
          muted: false,
          solo: false,
          volume: 1.0,
          currentBar: 0,
          currentBeat: 0,
          mainBeatSound: { sound: "Synth Kick", settings: { ...defaultKick } },
          subdivisionSound: {
            sound: "Synth HiHat",
            settings: { ...defaultHiHat },
          },
          nextBeatTime: 0,
          analyserNode: null,
        },
      ];
      if (audioContext) {
        publicAPI.createTrackAnalysers();
      }
      selectedTrackIndex = 0;
      selectedBarIndexInContainer = 0;
      controlsAttachedToTrack = true;
      isPlaying = false;
      currentTheme = "default";
      saveState();
    },

    // Theme
    getCurrentTheme: () => currentTheme,
    setCurrentTheme: (themeName) => {
      currentTheme = themeName;
      saveState();
    },

    // Constants
    SCHEDULE_AHEAD_TIME: SCHEDULE_AHEAD_TIME_INTERNAL,
  };
  return publicAPI;
})();
export default AppState;