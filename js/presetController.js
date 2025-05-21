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
     * @param {string} songName - The name of the song/preset.
     * @returns {{success: boolean, slotIndex?: number, savedSongName?: string, error?: Error}} Operation result.
     */
    saveCurrentPreset: (slotIndex, songName) => {
        if (slotIndex < 0 || slotIndex >= NUM_PRESET_SLOTS) {
            console.error("Invalid preset slot index for saving:", slotIndex);
            return;
        }
        const presetData = AppState.getCurrentStateForPreset();
        presetData.songName = (typeof songName === 'string' && songName.trim() !== '') ? songName.trim() : ''; // Store trimmed song name or empty
        // Add theme to the preset data - theme state is currently managed outside AppState
        // We need a way to get the current theme name. For now, let's read from localStorage directly.
        // A better approach might be a ThemeController or adding theme state to AppState.
        presetData.selectedTheme = localStorage.getItem('selectedTheme') || 'default'; // Ensure theme is part of the preset

        try {
            localStorage.setItem(PRESET_STORAGE_KEY_PREFIX + slotIndex, JSON.stringify(presetData));
            console.log(`Preset saved to slot ${slotIndex + 1}`);
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
     * Loads a preset from a specific slot and applies it to the application state.
     * @param {number} slotIndex - The index of the preset slot (0 to NUM_PRESET_SLOTS-1).
     * @returns {{theme: string, songName: string}|null} An object containing the theme and song name, or null.
     */
    loadPreset: (slotIndex) => {
        if (slotIndex < 0 || slotIndex >= NUM_PRESET_SLOTS) {
            console.error("Invalid preset slot index for loading:", slotIndex);
            return null;
        }
        const presetString = localStorage.getItem(PRESET_STORAGE_KEY_PREFIX + slotIndex);
        if (!presetString) {
            console.log(`No preset found in slot ${slotIndex + 1}`);
            // Optionally, clear the song name input field in the UI here via a callback or event
            return null;
        }

        try {
            const presetData = JSON.parse(presetString);

            // AppState.loadPresetData should now accept the full presetData object
            // and handle applying all its properties (including theme if it manages it).
            AppState.loadPresetData(presetData); // AppState updates its internal state based on the loaded data

            console.log(`Preset loaded from slot ${slotIndex + 1}`);

            // Return the loaded theme and song name so the main script can update the UI
            return {
                theme: presetData.selectedTheme || 'default',
                songName: presetData.songName || ''
            };
        } catch (e) {
            console.error("Error parsing or applying preset:", e);
            // TODO: Handle errors via UI module
            return null;
        }
    },

    /**
     * Retrieves display data (song name or default slot name) for all preset slots.
     * @returns {Array<{slotIndex: number, displaySongName: string}>} An array of objects.
     */
    getAllPresetDisplayData: () => {
        const allDisplayData = [];
        for (let i = 0; i < NUM_PRESET_SLOTS; i++) {
            let displaySongName = `Slot ${i + 1}`; // Default display name
            const presetString = localStorage.getItem(PRESET_STORAGE_KEY_PREFIX + i);
            if (presetString) {
                try {
                    const presetData = JSON.parse(presetString);
                    if (presetData.songName && typeof presetData.songName === 'string' && presetData.songName.trim() !== '') {
                        displaySongName = presetData.songName.trim();
                    }
                } catch (e) {
                    console.warn(`Could not parse preset in slot ${i + 1} for display name:`, e);
                }
            }
            allDisplayData.push({ slotIndex: i, displaySongName });
        }
        return allDisplayData;
    }

    // You might add other functions here like clearPreset(slotIndex), etc.
};

export default PresetController;