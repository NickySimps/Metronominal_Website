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
import VolumeController from './volumeController.js';
import UserInteraction from './userInteraction.js';
import { enablePlayback } from './webrtc.js';

function isIOS() {
    return [
        'iPad Simulator',
        'iPhone Simulator',
        'iPod Simulator',
        'iPad',
        'iPhone',
        'iPod'
    ].includes(navigator.platform)
    // iPad on iOS 13 detection
    || (navigator.userAgent.includes("Mac") && "ontouchend" in document)
} // For updating volume display on reset

const UIController = {
    // updateVolumeDisplay method removed (handled by VolumeController)
    // updateTempoDisplay method removed (handled by TempoController)

    updateCurrentPresetDisplay: (songName = '') => {
        if (DOM.currentPresetDisplayHeading) {
            if (songName && songName.trim() !== '') {
                // Display the song name. CSS will handle ellipsis if too long.
                DOM.currentPresetDisplayHeading.textContent = songName;
            } else {
                DOM.currentPresetDisplayHeading.textContent = "Metronominal";
            }
        } else {
            // console.warn("currentPresetDisplayHeading element not found in DOM.");
        }
    },


    resetToDefaults: async () => { // Make resetToDefaults async
        // 1. Stop Metronome if playing
        const wasPlaying = AppState.isPlaying();
        const previousTheme = AppState.getCurrentTheme();

        if (AppState.isPlaying()) {
            await MetronomeEngine.togglePlay(); // This will stop the metronome and update its UI
        }

        // 2. Reset core application state
        AppState.resetState();

        // 3. Move controls back to default position BEFORE updating UI
        const measuresContainer = DOM.measuresContainer;
        const metronomeContainer = DOM.metronomeContainer;
        const startStopBtn = DOM.startStopBtn;
        if (measuresContainer && metronomeContainer && startStopBtn && measuresContainer.parentNode !== metronomeContainer) {
             metronomeContainer.insertBefore(measuresContainer, startStopBtn);
        }

        // 4. Update UI elements based on reset state
        TempoController.updateTempoDisplay({ animate: true });
        if (DOM.beatMultiplierSelect) {
            DOM.beatMultiplierSelect.value = AppState.getSubdivisionForSelectedBar().toString();
        }
        VolumeController.updateVolumeDisplay({ animate: true });

        // Re-apply the theme that was active before the reset.
        ThemeController.applyTheme(previousTheme);

        // Reset Bar Structure UI
        if (DOM.barsLengthDisplay) {
            DOM.barsLengthDisplay.textContent = AppState.getBarSettings(AppState.getSelectedTrackIndex()).length.toString();
        }
        BarControlsController.syncBarSettings(); // This handles the rest of the bar/beat UI updates

        // Ensure all highlights are cleared
        BarDisplayController.clearAllHighlights();

        UIController.updateCurrentPresetDisplay();
        console.log("Metronome reset to defaults.");
    },


    
    initializeConnectionModal: () => {
        const connectionModal = document.getElementById("connection-modal");
        const dismissBtn = document.getElementById("dismiss-connection-modal-btn");

        if (dismissBtn) {
            dismissBtn.addEventListener("click", async () => {
                connectionModal.style.display = "none";
                await UserInteraction.handleFirstInteraction();
                enablePlayback();
            });
        }
    },

    initializeUIControls: () => {
        // Tempo controls - REMOVED (handled by TempoController)
        // Start/Stop button - REMOVED (handled by PlaybackController)

        // Reset button
        if (DOM.resetButton) {
            DOM.resetButton.addEventListener('click', UIController.resetToDefaults);
        }

        if (DOM.screenOffToggleBtn) {
            DOM.screenOffToggleBtn.addEventListener('click', () => {
                const isEnabled = !AppState.isWakeLockEnabled();
                AppState.setWakeLockEnabled(isEnabled);
                UIController.updateScreenOffToggleBtn();
            });
        }

        // Volume slider - REMOVED (handled by VolumeController)
    },

    updateScreenOffToggleBtn: () => {
        if (DOM.screenOffToggleBtn) {
            const isEnabled = AppState.isWakeLockEnabled();
            DOM.screenOffToggleBtn.textContent = isEnabled ?  'Screen 🔒' : 'Screen 🔓';
            DOM.screenOffToggleBtn.classList.toggle('active', isEnabled);
        }
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