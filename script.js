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
import PresetController from './js/presetController.js'; // Import PresetController

// --- Helper Functions for Presets ---

/**
 * Updates the display names in the preset slot dropdown.
 * Reads song names from presets and updates the option texts.
 */
function updatePresetDropdownDisplayNames() {
    const presetSlotSelect = DOM.presetSlotSelect; // Assuming DOM.presetSlotSelect is '#preset-slot-select'
    if (!presetSlotSelect) {
        console.error("Preset slot select dropdown not found in DOM.");
        return;
    }
    const allDisplayData = PresetController.getAllPresetDisplayData();

    allDisplayData.forEach(data => {
        if (presetSlotSelect.options[data.slotIndex]) {
            presetSlotSelect.options[data.slotIndex].textContent = data.displaySongName;
        }
    });
}

/**
 * Refreshes all relevant UI components to reflect the current AppState.
 * Call this after loading a preset or any other state change that needs a full UI update.
 */
function refreshUIFromState() {
    TempoController.updateTempoDisplay();
    VolumeController.updateVolumeDisplay();
    // Ensure beatsPerCurrentMeasureDisplay is updated based on the (potentially) new selectedBarIndex or first bar
    const currentBarSettings = AppState.getBarSettings();
    const selectedBarIndex = AppState.getSelectedBarIndex();
    const beatsForCurrentBar = currentBarSettings[selectedBarIndex] || currentBarSettings[0] || 4;
    if (DOM.beatsPerCurrentMeasureDisplay) { // Check if element exists
        DOM.beatsPerCurrentMeasureDisplay.textContent = beatsForCurrentBar;
    }
    if (DOM.barsLengthDisplay) { // Check if element exists
        DOM.barsLengthDisplay.textContent = currentBarSettings.length;
    }
    BarDisplayController.renderBarsAndControls(selectedBarIndex);
    BarControlsController.updateTotalBeatsDisplay();
}

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
        initializePresetControls(); // Initialize preset controls

        // Initial render of dynamic content not handled by controller initializers
        // Ensure initial descriptive text (like "Moderate" for tempo) is set
        refreshUIFromState(); // Initial UI refresh based on state

        console.log("Metronome initialized.");
    }

    function initializePresetControls() {
        if (!DOM.savePresetButton || !DOM.loadPresetButton || !DOM.presetSlotSelect || !DOM.presetNameInput) {
            console.error("One or more preset control DOM elements are missing. Presets will not function.");
            return;
        }

        updatePresetDropdownDisplayNames(); // Populate dropdown on init
        UIController.updateCurrentPresetDisplay(); // Set initial preset display heading

        DOM.savePresetButton.addEventListener('click', () => {
            const selectedSlotIndex = parseInt(DOM.presetSlotSelect.value, 10);
            const songName = DOM.presetNameInput.value.trim();

            const result = PresetController.saveCurrentPreset(selectedSlotIndex, songName);

            if (result && result.success) {
                console.log(`Preset saved successfully to slot ${result.slotIndex + 1} with name "${result.savedSongName}".`);
                // Update the specific option in the dropdown
                const optionToUpdate = DOM.presetSlotSelect.options[result.slotIndex];
                if (optionToUpdate) {
                    optionToUpdate.textContent = result.savedSongName && result.savedSongName.trim() !== '' ? result.savedSongName : `Slot ${result.slotIndex + 1}`;
                }
                // Add user feedback (e.g., a temporary message on the UI)
                UIController.showTemporaryMessage("Preset Saved!", "success");
            } else {
                console.error("Failed to save preset.", result ? result.error : 'Unknown error');
                UIController.showTemporaryMessage("Error Saving Preset", "error");
            }
        });

        DOM.loadPresetButton.addEventListener('click', () => {
            const selectedSlotIndex = parseInt(DOM.presetSlotSelect.value, 10);
            const loadedData = PresetController.loadPreset(selectedSlotIndex);

            if (loadedData) {
                console.log(`Preset loaded from slot ${selectedSlotIndex + 1}. Song: "${loadedData.songName}", Theme: "${loadedData.theme}"`);
                DOM.presetNameInput.value = loadedData.songName || '';
                ThemeController.applyTheme(loadedData.theme);
                UIController.updateCurrentPresetDisplay(loadedData.songName);

                // AppState is now updated by PresetController.loadPreset -> AppState.loadPresetData
                // Now, refresh the entire UI to reflect the new AppState
                refreshUIFromState();
                
                // Add user feedback
                UIController.showTemporaryMessage("Preset Loaded!", "success");
            } else {
                console.log(`No preset data found in slot ${selectedSlotIndex + 1} or error loading.`);
                DOM.presetNameInput.value = ''; // Clear name input if load fails or slot is empty
                UIController.updateCurrentPresetDisplay(); // Reset to "PRESETS"
                UIController.showTemporaryMessage("Preset Slot Empty or Error", "info");
            }
        });
    }

    // Initialize the application
    initialize();

});