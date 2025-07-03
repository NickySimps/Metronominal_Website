/**
 * presetController.js
 * This module handles saving and loading metronome presets using localStorage.
 */

import AppState from './appState.js';
import DOM from './domSelectors.js'; // Assuming AppState and DOM selectors are correctly imported

// --- Constants ---
const NUM_PRESET_SLOTS = 16;
const PRESET_STORAGE_KEY_PREFIX = 'metronomePreset_';

// --- Public API ---
const PresetController = {
    /**
     * Initializes the preset control elements and their event listeners.
     * @param {function} refreshUIFromState - Callback to refresh the entire UI.
     */
    initializePresetControls: (refreshUIFromState) => {
        // CORRECTED: Using the exact names from domSelectors.js
        if (!DOM.presetSlotSelect || !DOM.savePresetButton || !DOM.loadPresetButton || !DOM.presetNameInput) {
            console.error("One or more preset control elements are missing from the DOM.");
            return;
        }

        // Populate the preset dropdown list
        const presets = PresetController.getAllPresetDisplayData();
        DOM.presetSlotSelect.innerHTML = ''; // Clear existing options
        presets.forEach(preset => {
            const option = document.createElement('option');
            option.value = preset.slotIndex;
            option.textContent = preset.displaySongName;
            DOM.presetSlotSelect.appendChild(option);
        });

        // Add event listener for the "Save" button
        DOM.savePresetButton.addEventListener('click', () => {
            const selectedSlot = parseInt(DOM.presetSlotSelect.value, 10);
            const songName = DOM.presetNameInput.value;
            const result = PresetController.saveCurrentPreset(selectedSlot, songName);
            if (result.success) {
                console.log(`Saved preset: "${result.savedSongName}" to slot ${result.slotIndex + 1}`);
                refreshUIFromState(); // Refresh UI to show new preset name
            }
        });

        // Add event listener for the "Load" button
        DOM.loadPresetButton.addEventListener('click', () => {
            const selectedSlot = parseInt(DOM.presetSlotSelect.value, 10);
            const loadedData = PresetController.loadPreset(selectedSlot);
            if (loadedData) {
                console.log(`Loaded preset. Theme: ${loadedData.theme}, Song: "${loadedData.songName}"`);
                refreshUIFromState(); // Refresh UI with loaded state
            }
        });
    },

    /**
     * Saves the current application state to a specific preset slot.
     */
    saveCurrentPreset: (slotIndex, songName) => {
        if (slotIndex < 0 || slotIndex >= NUM_PRESET_SLOTS) {
            console.error("Invalid preset slot index for saving:", slotIndex);
            return { success: false, error: new Error("Invalid slot index") };
        }
        const presetData = AppState.getCurrentStateForPreset();
        presetData.songName = (typeof songName === 'string' && songName.trim() !== '') ? songName.trim() : `Slot ${slotIndex + 1}`;
        presetData.selectedTheme = AppState.getCurrentTheme();

        try {
            localStorage.setItem(PRESET_STORAGE_KEY_PREFIX + slotIndex, JSON.stringify(presetData));
            return {
                success: true,
                slotIndex: slotIndex,
                savedSongName: presetData.songName
            };
        } catch (e) {
            console.error("Error saving preset:", e);
            return { success: false, error: e };
        }
    },

    /**
     * Loads a preset from a specific slot.
     */
    loadPreset: (slotIndex) => {
        if (slotIndex < 0 || slotIndex >= NUM_PRESET_SLOTS) {
            console.error("Invalid preset slot index for loading:", slotIndex);
            return null;
        }
        const presetString = localStorage.getItem(PRESET_STORAGE_KEY_PREFIX + slotIndex);
        if (!presetString) {
            console.log(`No preset found in slot ${slotIndex + 1}`);
            return null;
        }

        try {
            const presetData = JSON.parse(presetString);
            AppState.loadPresetData(presetData);
            return {
                theme: presetData.selectedTheme || 'default',
                songName: presetData.songName || ''
            };
        } catch (e) {
            console.error("Error parsing or applying preset:", e);
            return null;
        }
    },

    /**
     * Retrieves display data for all preset slots.
     */
    getAllPresetDisplayData: () => {
        const allDisplayData = [];
        for (let i = 0; i < NUM_PRESET_SLOTS; i++) {
            let displaySongName = `Slot ${i + 1}`;
            const presetString = localStorage.getItem(PRESET_STORAGE_KEY_PREFIX + i);
            if (presetString) {
                try {
                    const presetData = JSON.parse(presetString);
                    if (presetData.songName && typeof presetData.songName === 'string' && presetData.songName.trim() !== '') {
                        displaySongName = presetData.songName.trim();
                    }
                } catch (e) {
                    console.warn(`Could not parse preset in slot ${i + 1}:`, e);
                }
            }
            allDisplayData.push({ slotIndex: i, displaySongName });
        }
        return allDisplayData;
    }
};

export default PresetController;