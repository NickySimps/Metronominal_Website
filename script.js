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