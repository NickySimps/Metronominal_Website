import AppState from './js/appState.js';
import DOM from './js/domSelectors.js';
import MetronomeEngine from './js/metronomeEngine.js';
import BarDisplayController from './js/barDisplayController.js';
import BarControlsController from './js/barControlsController.js';
import UIController from './js/uiController.js'; // For reset and other general UI
import ThemeController from './js/themeController.js';
import TempoController from './js/tempoController.js'; // Import for initialization
import VolumeController from './js/volumeController.js'; // Import for initialization
import PlaybackController from './js/playbackController.js'; // Import for initialization

document.addEventListener('DOMContentLoaded', async () => {
    // Initial setup
    async function initialize() {
        // Initialize AppState with initial values from DOM/defaults
        const initialNumberOfBars = parseInt(DOM.barsLengthDisplay.textContent, 10);
        const initialBeatsPerMeasure = parseInt(DOM.beatsPerCurrentMeasureDisplay.textContent, 10) || 4;
        // Initialize beatMultiplier from the dropdown's current value
        const initialBeatMultiplier = parseInt(DOM.beatMultiplierSelect.value, 10) || 1;

        // Initialize Volume
        const initialVolume = parseFloat(DOM.volumeSlider.value);

        AppState.initializeState(initialNumberOfBars, initialBeatsPerMeasure, initialBeatMultiplier, initialVolume);

        // Initialize AudioContext and load buffers
        const audioContext = AppState.initializeAudioContext();
        if (audioContext) {
            await AppState.loadAudioBuffers(); // Wait for buffers to load
        }

        // Initialize Controllers that manage their own event listeners and initial state
        ThemeController.initializeThemeControls();
        TempoController.initializeTempoControls(); // Added
        VolumeController.initializeVolumeControls(); // Added
        PlaybackController.initializePlaybackControls(); // Added
        BarControlsController.initializeBarControls();
        UIController.initializeUIControls(); // Will be slimmed down to handle reset button, etc.

        // Initial render of dynamic content not handled by controller initializers
        // Ensure initial descriptive text (like "Moderate" for tempo) is set
        TempoController.updateTempoDisplay();
        VolumeController.updateVolumeDisplay();
        BarDisplayController.renderBarsAndControls(0); // Initial render, animate all bars appearing
        BarControlsController.updateTotalBeatsDisplay(); // Initial calculation of total beats

        console.log("Metronome initialized.");
    }

    // Initialize the application
    initialize();

});