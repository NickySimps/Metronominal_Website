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


    // Add this line to set the bar count display correctly on refresh
    const selectedTrack = AppState.getTracks()[AppState.getSelectedTrackIndex()];
    if (selectedTrack && DOM.barsLengthDisplay) {
        DOM.barsLengthDisplay.textContent = selectedTrack.barSettings.length;
    }

    TrackController.renderTracks();
    UIController.updateCurrentPresetDisplay();
    BarControlsController.updateTotalBeatsDisplay();

    // If 3D theme is active, refresh its state as well
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

    // 2. Load state from local storage
    AppState.loadStateFromLocalStorage();

    // 3. Initialize all controllers with their correct function names.
    UIController.initializeUIControls(refreshUIFromState); // Corrected function name
    ThemeController.initializeThemeControls();            // Corrected function name
    TempoController.initializeTempoControls();            // Corrected function name
    PlaybackController.initializePlaybackControls();      // Corrected function name
    BarControlsController.initializeBarControls();        // Corrected function name
    TrackController.init();                               // This one was correct
    PresetController.initializePresetControls(refreshUIFromState); // Corrected function name
    VolumeController.initializeVolumeControls();


    // 4. Set the initial state of the application.
    // AppState.resetState(); // This is removed to keep the loaded state
    
    // 5. Perform the first render of the UI.
    refreshUIFromState();

    console.log("Metronominal initialized successfully.");
}

// Start the application once the DOM is ready.
document.addEventListener('DOMContentLoaded', initialize);