const AppState = (function() {
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

    // --- Constants ---
    const MAX_TAPS_FOR_AVERAGE = 4;
    const MAX_TAP_INTERVAL_MS = 3000;
    const NUM_PRESET_SLOTS = 16;
    const PRESET_STORAGE_KEY_PREFIX = 'metronomePreset_';

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
            if (tapTempoTimestamps.length > 0 && (timestamp - tapTempoTimestamps[tapTempoTimestamps.length - 1] > MAX_TAP_INTERVAL_MS)) {
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
        togglePlay: () => {
            // If trying to start but no bars are configured, prevent starting.
            if (!isPlaying && barSettings.length === 0) {
                console.log("Cannot start: No bars configured.");
                return false; // Indicate play was not started / state not changed
            }

            isPlaying = !isPlaying;
            if (isPlaying) { // Just transitioned to playing
                currentBar = 0;
                currentBeat = 0;
                if (audioContext) {
                    if (audioContext.state === 'suspended') {
                        audioContext.resume().catch(e => console.error("Error resuming AudioContext:", e));
                    }
                    nextBeatAudioContextTime = audioContext.currentTime + 0.05; // Schedule first beat 50ms in the future
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
            const totalSubBeatsInCurrentBar = barSettings[currentBar] * beatMultiplier;
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
            if (index >= 0 && index < barSettings.length) {
                selectedBarIndex = index;
            } else if (barSettings.length === 0) {
                selectedBarIndex = -1;
            } else {
                selectedBarIndex = Math.max(0, barSettings.length - 1);
            }
        },
        updateBarArray: (newTotalBars, defaultBeatsPerNewBar = 4) => {
            const previousNumberOfBars = barSettings.length;
            newTotalBars = parseInt(newTotalBars, 10);

            if (newTotalBars > previousNumberOfBars) {
                for (let i = previousNumberOfBars; i < newTotalBars; i++) {
                    const beats = (barSettings.length > 0) ? barSettings[barSettings.length - 1] : defaultBeatsPerNewBar;
                    barSettings.push(beats);
                }
            } else if (newTotalBars < previousNumberOfBars) {
                barSettings.length = newTotalBars;
            }

            publicAPI.setSelectedBarIndex(selectedBarIndex); // Re-validate selectedBarIndex
            
            if (barSettings.length === 0) {
                currentBar = 0; currentBeat = 0;
                if (isPlaying) isPlaying = false; 
            } else {
                if (currentBar >= barSettings.length) {
                    currentBar = 0; currentBeat = 0;
                } else if (currentBeat >= barSettings[currentBar] * beatMultiplier) {
                    currentBeat = 0;
                }
            }
        },
        getBeatsForSelectedBar: () => {
            if (selectedBarIndex !== -1 && barSettings[selectedBarIndex] !== undefined) {
                return barSettings[selectedBarIndex];
            }
            return null;
        },
        increaseBeatsForSelectedBar: () => {
            if (selectedBarIndex !== -1 && barSettings[selectedBarIndex] !== undefined) {
                barSettings[selectedBarIndex]++;
            }
        },
        decreaseBeatsForSelectedBar: () => {
            if (selectedBarIndex !== -1 && barSettings[selectedBarIndex] !== undefined) {
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
            if (barSettings.length > 0 && currentBar < barSettings.length && barSettings[currentBar] !== undefined) {
                const totalSubBeatsInCurrentBar = barSettings[currentBar] * beatMultiplier;
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
                } catch (e) { console.error(`Error loading or decoding audio file ${url}:`, e); return null; }
            };
            [clickSoundBuffer, accentClickSoundBuffer] = await Promise.all([loadSound('Click1.mp3'), loadSound('Click2.mp3')]);
            return !!(clickSoundBuffer && accentClickSoundBuffer);
    }, // Corrected name
    getClickSoundBuffer: () => clickSoundBuffer, // Corrected name
    getAccentSoundBuffer: () => accentClickSoundBuffer, // Corrected name
        getNextBeatAudioContextTime: () => nextBeatAudioContextTime,
        setNextBeatAudioContextTime: (time) => { nextBeatAudioContextTime = time; },
        incrementNextBeatAudioContextTime: (secondsPerSubBeat) => { nextBeatAudioContextTime += secondsPerSubBeat; },

        // Presets
        getCurrentStateForPreset: () => ({
            tempo: tempo,
            barSettings: JSON.parse(JSON.stringify(barSettings)),
            beatMultiplier: beatMultiplier,
            volume: currentVolume,
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
                barSettings = Array.isArray(presetData.barSettings) ? presetData.barSettings : [4];
                beatMultiplier = presetData.beatMultiplier || 1;
                currentVolume = (typeof presetData.volume === 'number') ? presetData.volume : 0.8;

                publicAPI.setSelectedBarIndex(0); // Reset selection
                if (barSettings.length === 0) { currentBar = 0; currentBeat = 0; isPlaying = false; }
                else if (currentBar >= barSettings.length) { currentBar = 0; currentBeat = 0; }
                return presetData.selectedTheme || 'default'; // Return theme for UI update
            } catch (e) { console.error("Error parsing preset:", e); return null; }
        },

        // Reset & Initialization
        resetState: () => {
            tempo = 120; beatMultiplier = 1; currentVolume = 0.8; barSettings = [4];
            selectedBarIndex = 0; currentBar = 0; currentBeat = 0; isPlaying = false;
            tapTempoTimestamps = [];
        },
        initializeState: (initialNumberOfBars, initialBeatsPerMeasure, initialBeatMultiplier, initialVolume) => {
            barSettings = Array(initialNumberOfBars).fill(initialBeatsPerMeasure);
            selectedBarIndex = initialNumberOfBars > 0 ? 0 : -1;
            beatMultiplier = initialBeatMultiplier;
            currentVolume = initialVolume;
            // tempo is already at its default 120
        }
    };
    return publicAPI;
})(); // End of IIFE
export default AppState; // Export the AppState object as the default export