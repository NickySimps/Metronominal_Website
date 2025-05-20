/**
 * presetController.js
 * This module handles saving and loading metronome presets using localStorage.
 * It interacts with the AppState module to get/set the application state.
 */

import AppState from './appState.js'; // Assuming AppState is also a module

// --- Constants ---
const NUM_PRESET_SLOTS = 16; // Define constants here or import if shared
const PRESET_STORAGE_KEY_PREFIX = 'metronomePreset_';

// --- Public API ---
const PresetController = {
    /**
     * Saves the current application state to a specific preset slot.
     * @param {number} slotIndex - The index of the preset slot (0 to NUM_PRESET_SLOTS-1).
     */
    saveCurrentPreset: (slotIndex) => {
        if (slotIndex < 0 || slotIndex >= NUM_PRESET_SLOTS) {
            console.error("Invalid preset slot index for saving:", slotIndex);
            return;
        }
        const presetData = AppState.getCurrentStateForPreset();
        // Add theme to the preset data - theme state is currently managed outside AppState
        // We need a way to get the current theme name. For now, let's read from localStorage directly.
        // A better approach might be a ThemeController or adding theme state to AppState.
        presetData.selectedTheme = localStorage.getItem('selectedTheme') || 'default';

        try {
            localStorage.setItem(PRESET_STORAGE_KEY_PREFIX + slotIndex, JSON.stringify(presetData));
            console.log(`Preset saved to slot ${slotIndex + 1}`);
            // TODO: Add visual feedback for successful save via UI module
        } catch (e) {
            console.error("Error saving preset:", e);
            // TODO: Handle storage full or other errors via UI module
        }
    },

    /**
     * Loads a preset from a specific slot and applies it to the application state.
     * @param {number} slotIndex - The index of the preset slot (0 to NUM_PRESET_SLOTS-1).
     * @returns {string|null} The theme name loaded from the preset, or null if no preset/error.
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

            // Apply state from presetData using AppState setters
            // AppState.loadPresetData handles setting most state values internally
            const loadedTheme = AppState.loadPresetData(slotIndex); // AppState updates its internal state

            console.log(`Preset loaded from slot ${slotIndex + 1}`);

            // Return the loaded theme name so the main script can apply it via ThemeController (or similar)
            return loadedTheme;

        } catch (e) {
            console.error("Error parsing or applying preset:", e);
            // TODO: Handle errors via UI module
            return null;
        }
    },

    // You might add functions here to check if a slot has data, list presets, etc.
};

export default PresetController;