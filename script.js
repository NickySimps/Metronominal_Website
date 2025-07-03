// js/script.js

import AppState from './js/appState.js';
import DOM from './js/domSelectors.js';
import UIController from './js/uiController.js';
import ThemeController from './js/themeController.js';
import TempoController from './js/tempoController.js';
import PlaybackController from './js/playbackController.js';
import BarControlsController from './js/barControlsController.js';
import TrackController from './js/tracksController.js';
import PresetController from './js/presetController.js';
import VolumeController from './js/volumeController.js';
import MetronomeEngine from './js/metronomeEngine.js';


/**
 * Refreshes all relevant UI components to reflect the current AppState.
 */
function refreshUIFromState() {
    TempoController.updateTempoDisplay({ animate: true });
    VolumeController.updateVolumeDisplay({ animate: true });
 
    TrackController.renderTracks();
    // This single call now handles all bar/beat related display updates for the selected track.
    BarControlsController.updateBarControlsForSelectedTrack();
    // The song name display is now updated directly by the preset controller on load.
 
    if (AppState.getCurrentTheme() === '3dRoom' && ThemeController.is3DSceneActive()) {
        ThemeController.update3DScenePostStateChange();
    }
}

/**
 * Initializes the entire application.
 */
async function initialize() {
    // 1. Initialize the AudioContext first.
    const audioContext = AppState.initializeAudioContext();
    if (audioContext) {
        AppState.loadAudioBuffers();
    }

    // 2. Load state from local storage. If it fails, reset to default.
    const stateLoaded = AppState.loadStateFromLocalStorage();
    if (!stateLoaded) {
        // If no state was loaded, explicitly reset to the default state.
        // This ensures the app starts correctly on the very first visit.
        AppState.resetState();
    }

    // 3. Initialize all controllers.
    UIController.initializeUIControls(refreshUIFromState);
    ThemeController.initializeThemeControls();
    TempoController.initializeTempoControls();
    PlaybackController.initializePlaybackControls();
    BarControlsController.initializeBarControls();
    TrackController.init();
    PresetController.initializePresetControls(refreshUIFromState);
    VolumeController.initializeVolumeControls();
    
    // 4. Perform the first render of the UI with the correct state.
    refreshUIFromState();

    console.log("Metronominal initialized successfully.");
}

// Start the application once the DOM is ready.
document.addEventListener('DOMContentLoaded', initialize);

// Keyboard shortcut handling
document.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement) return;  // Disable shortcuts when typing in input fields
    switch (event.key) {
        case ' ':  // Spacebar: Toggle play/pause
            event.preventDefault();
            MetronomeEngine.togglePlay();
            break;
        case 't':  // 't': Tap tempo
            event.preventDefault();
            TempoController.tapTempo();
            break;
        case 'r':  // 'r': Reset
            event.preventDefault();
            AppState.resetState();
            refreshUIFromState();
            break;
        case '=': // '=' Increase Tempo
        case '+':
            event.preventDefault();
            TempoController.increaseTempo();
            break;
        case '-': // '-' Decrease Tempo
        case '_':
            event.preventDefault();
            TempoController.decreaseTempo();
            break;
        case ']': // ']' Increase Bars
            event.preventDefault();
            BarControlsController.increaseBarLength();
            break;
        case '[': // '[' Decrease Bars
            event.preventDefault();
            BarControlsController.decreaseBarLength();
            break;
        case "'": // ''' Increase Beats (Apostrophe)
            event.preventDefault();
            BarControlsController.increaseBeatsForSelectedBar();
            break;
        case ';': // ';' Decrease Beats (Semicolon)
            event.preventDefault();
            BarControlsController.decreaseBeatsForSelectedBar();
            break;
        case 'ArrowUp':
            event.preventDefault();
            VolumeController.increaseVolume();
            break;
        case 'ArrowDown':
            event.preventDefault();
            VolumeController.decreaseVolume();
            break;
    }
});