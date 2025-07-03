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

/**
 * Refreshes all relevant UI components to reflect the current AppState.
 */
function refreshUIFromState() {
    TempoController.updateTempoDisplay({ animate: true });
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

    // 2. Initialize all controllers with their correct function names.
    UIController.initializeUIControls(refreshUIFromState); // Corrected function name
    ThemeController.initializeThemeControls();            // Corrected function name
    TempoController.initializeTempoControls();            // Corrected function name
    PlaybackController.initializePlaybackControls();      // Corrected function name
    BarControlsController.initializeBarControls();        // Corrected function name
    TrackController.init();                               // This one was correct
    PresetController.initializePresetControls(refreshUIFromState); // Corrected function name

    // 3. Set the initial state of the application.
    AppState.resetState(); 
    
    // 4. Perform the first render of the UI.
    refreshUIFromState();

    console.log("Metronominal initialized successfully.");
}

// Start the application once the DOM is ready.
document.addEventListener('DOMContentLoaded', initialize);