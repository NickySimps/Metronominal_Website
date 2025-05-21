/**
 * uiController.js
 * This module handles general UI updates and interactions not covered by
 * more specific controllers (like BarDisplayController or BarControlsController).
 * This includes tempo display, volume display, and the main reset functionality.
 */

import AppState from './appState.js';
import DOM from './domSelectors.js';
import BarDisplayController from './barDisplayController.js';
import BarControlsController from './barControlsController.js';
import ThemeController from './themeController.js'; // For applying theme on reset
import MetronomeEngine from './metronomeEngine.js'; // For stopping engine on reset
import TempoController from './tempoController.js'; // For updating tempo display on reset
import VolumeController from './volumeController.js'; // For updating volume display on reset

const UIController = {
    // updateVolumeDisplay method removed (handled by VolumeController)
    // updateTempoDisplay method removed (handled by TempoController)

    updateCurrentPresetDisplay: (songName = '') => {
        if (DOM.currentPresetDisplayHeading) {
            if (songName && songName.trim() !== '') {
                // Display the song name. CSS will handle ellipsis if too long.
                DOM.currentPresetDisplayHeading.textContent = songName;
            } else {
                DOM.currentPresetDisplayHeading.textContent = "PRESETS";
            }
        } else {
            // console.warn("currentPresetDisplayHeading element not found in DOM.");
        }
    },


    resetToDefaults: () => {
        // 1. Stop Metronome if playing
        if (AppState.isPlaying()) {
            MetronomeEngine.togglePlay(); // This will stop the metronome and update its UI
        }

        // 2. Reset core application state
        AppState.resetState();

        // 3. Update UI elements based on reset state
        TempoController.updateTempoDisplay({ animate: true }); // Use TempoController with animation
        DOM.beatMultiplierSelect.value = AppState.getBeatMultiplier().toString(); // Ensure string for select value
        // DOM.volumeSlider.value = AppState.getVolume(); // This is handled by updateVolumeDisplay
        VolumeController.updateVolumeDisplay({ animate: true }); // Corrected: Use VolumeController with animation
        ThemeController.applyTheme('default'); // Assuming ThemeController is imported and initialized

        // Reset Bar Structure UI (AppState handles data, BarControlsController handles UI sync)
        DOM.barsLengthDisplay.textContent = AppState.getBarSettings().length.toString();
        // syncBarSettings will update beatsPerCurrentMeasureDisplay and totalBeatsDisplay
        // and re-render bars via BarDisplayController
        BarControlsController.syncBarSettings();

        // Ensure all highlights are cleared (belt-and-suspenders)
        BarDisplayController.clearAllHighlights();
        // BarControlsController.updateTotalBeatsDisplay(); // syncBarSettings handles this

        UIController.updateCurrentPresetDisplay(); // Reset heading to "PRESETS"
        console.log("Metronome reset to defaults.");
    },

    initializeUIControls: () => {
        // Tempo controls - REMOVED (handled by TempoController)
        // Start/Stop button - REMOVED (handled by PlaybackController)

        // Reset button
        if (DOM.resetButton) {
            DOM.resetButton.addEventListener('click', UIController.resetToDefaults);
        }

        // Volume slider - REMOVED (handled by VolumeController)
    },

    // Placeholder for user feedback messages
    showTemporaryMessage: (message, type = 'info') => {
        // A more robust implementation would create a styled element on the page
        // and remove it after a timeout. For now, we'll just log.
        console.log(`UI Message (${type}): ${message}`);
        // Example: alert(`(${type.toUpperCase()}) ${message}`);

        // Initial UI updates for tempo/volume are now handled in script.js after controller initializations
    }
};

export default UIController;