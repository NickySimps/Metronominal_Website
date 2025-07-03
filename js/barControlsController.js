/**
 * barControlsController.js
 * This module manages the controls for modifying the number of bars and beats per bar.
 * It updates the AppState and triggers updates in the BarDisplayController.
 * It interacts with MetronomeEngine for playback control that affects UI.
 * It interacts with domSelectors to access control elements.
 */
import ThemeController from './themeController.js'; // Added for 3D UI updates

import AppState from './appState.js'; // Assuming AppState is a module
import DOM from './domSelectors.js'; // Assuming domSelectors is a module
import BarDisplayController from './barDisplayController.js'; // Assuming BarDisplayController is a module
import MetronomeEngine from './metronomeEngine.js'; // For toggling play with UI updates
import TrackController from './tracksController.js';


// Helper for animated text updates (similar to tempo description)
function animateControlUpdate(controlElement, updateFunction, animationDuration = 500) {
    if (controlElement) {
        controlElement.classList.add('updating');
        setTimeout(() => {
            updateFunction(); // Execute the actual update
            controlElement.classList.remove('updating');
        }, animationDuration / 2); // Update text at midpoint of animation
    }
}

// Function to update the "beats-per-current-measure" display
function updateBeatControlsDisplay() {
    const selectedTrackIndex = AppState.getSelectedTrackIndex();
    const selectedBarIndexInContainer = AppState.getSelectedBarIndexInContainer();
    const barSettings = AppState.getBarSettings(selectedTrackIndex); // Get bar settings for the selected container

    let beatsToDisplay = '-';
    let subdivisionToDisplay = '1'; // Default subdivision

    if (barSettings.length > 0) {
        const targetBarIndex = (selectedBarIndexInContainer !== -1 && barSettings[selectedBarIndexInContainer] !== undefined)
                               ? selectedBarIndexInContainer
                               : 0; // Default to first bar if no bar is explicitly selected
        beatsToDisplay = barSettings[targetBarIndex].beats;
        subdivisionToDisplay = barSettings[targetBarIndex].subdivision.toString();
        DOM.beatsPerCurrentMeasureDisplay.textContent = beatsToDisplay;
        DOM.beatMultiplierSelect.value = subdivisionToDisplay;
    } else {
        // No bars exist in the selected container, display default or empty state
        DOM.beatsPerCurrentMeasureDisplay.textContent = beatsToDisplay; // Will be '-'
        DOM.beatMultiplierSelect.value = subdivisionToDisplay; // Will be '1'
    }
}

// Function to update the total beats display
function updateTotalBeatsDisplay() {
    const totalBeats = AppState.getTotalBeats();
    if (DOM.totalBeatsDisplayElement) {
        DOM.totalBeatsDisplayElement.textContent = totalBeats;
    }
}

// Function to synchronize AppState barSettings with the number displayed in barsLengthDisplay
// and trigger necessary UI updates.
async function syncBarSettings() {
    const selectedTrackIndex = AppState.getSelectedTrackIndex();
    const barSettings = AppState.getBarSettings(selectedTrackIndex);
    const barCount = barSettings ? barSettings.length : 0;

    if (DOM.barsLengthDisplay) {
        DOM.barsLengthDisplay.textContent = barCount;
    }

    // This function is now just for rendering the UI after the state has changed.
    TrackController.renderTracks(); // Re-render tracks to handle potential removal
    updateTotalBeatsDisplay();
    updateBeatControlsDisplay();

    if (ThemeController.is3DSceneActive()) {
        ThemeController.update3DScenePostStateChange();
    }
}


const BarControlsController = {
    /**
     * Initializes the bar and beat control elements and their event listeners.
     */
    initializeBarControls: () => {
        // Event Listeners for changing beats of the selected bar
        DOM.increaseMeasureLengthBtn.addEventListener('click', () => {
            if (AppState.getSelectedBarIndexInContainer() !== -1) {
                AppState.increaseBeatsForSelectedBar(); // Update state

                const updateAction = () => {
                    BarDisplayController.renderBarsAndControls(); // Re-render visuals
                    updateBeatControlsDisplay(); // Update beats display
                    updateTotalBeatsDisplay(); // Update total beats
                    // Trigger 3D UI update
                    if (ThemeController.is3DSceneActive()) {
                        ThemeController.update3DScenePostStateChange();
                    }
                };

                animateControlUpdate(DOM.beatsPerCurrentMeasureDisplay, updateAction);
            }
        });

        DOM.decreaseMeasureLengthBtn.addEventListener('click', () => {
            if (AppState.getSelectedBarIndexInContainer() !== -1 && AppState.getBeatsForSelectedBar() > 1) {
                AppState.decreaseBeatsForSelectedBar(); // Update state

                const updateAction = () => {
                    BarDisplayController.renderBarsAndControls();
                    updateBeatControlsDisplay();
                    updateTotalBeatsDisplay();
                    // Trigger 3D UI update
                    if (ThemeController.is3DSceneActive()) {
                        ThemeController.update3DScenePostStateChange();
                    }
                };

                animateControlUpdate(DOM.beatsPerCurrentMeasureDisplay, updateAction);
            }
        });

        // Event Listeners for changing total number of bars
        DOM.increaseBarLengthBtn.addEventListener('click', () => {
            const selectedTrackIndex = AppState.getSelectedTrackIndex();
            if (selectedTrackIndex === -1) return;

            // Get the bar count directly from the AppState
            let currentBars = AppState.getBarSettings(selectedTrackIndex).length;
            currentBars++;
            
            // Update the AppState first
            AppState.updateBarArray(currentBars);

            const updateAction = () => {
                // Then, update the UI to match the new state
                DOM.barsLengthDisplay.textContent = currentBars;
                syncBarSettings(); // Re-render the UI
            };

            animateControlUpdate(DOM.barsLengthDisplay, updateAction);
        });

        DOM.decreaseBarLengthBtn.addEventListener('click', () => {
            const selectedTrackIndex = AppState.getSelectedTrackIndex();
            if (selectedTrackIndex === -1) return;

            let currentBars = AppState.getBarSettings(selectedTrackIndex).length;
            if (currentBars > 0) {
                currentBars--;
                AppState.updateBarArray(currentBars);

                const updateAction = () => {
                    if (AppState.getTracks()[selectedTrackIndex] && AppState.getTracks()[selectedTrackIndex].barSettings.length > 0) {
                        DOM.barsLengthDisplay.textContent = currentBars;
                    }
                    syncBarSettings();
                };

                animateControlUpdate(DOM.barsLengthDisplay, updateAction);
            }
        });


        // Event listener for beat multiplier change
        document.addEventListener('barSelected', () => {
            updateBeatControlsDisplay();
        });

        DOM.beatMultiplierSelect.addEventListener('change', async () => { // Make event handler async
            AppState.setSubdivisionForSelectedBar(DOM.beatMultiplierSelect.value); // Update state

            // Re-render visuals based on new multiplier
            BarDisplayController.renderBarsAndControls();
            // Trigger 3D UI update
            if (ThemeController.is3DSceneActive()) {
                ThemeController.update3DScenePostStateChange();
            }
        });

        // Initial display updates
        updateBeatControlsDisplay();
        updateTotalBeatsDisplay();
        // Note: Initial rendering of bars is handled by the main script's initialize function
    },

    /**
     * Updates the beat count display for the currently selected bar.
     * Should be called when selectedBarIndex changes or the beat count of the selected bar changes.
     */
    updateBeatControlsDisplay: updateBeatControlsDisplay,

    /**
     * Updates the total beats display.
     * Should be called when the bar structure changes.
     */
    updateTotalBeatsDisplay: updateTotalBeatsDisplay,

    /**
     * Synchronizes the bar settings state with the UI display and triggers rendering.
     * Used when the total number of bars changes.
     */
    syncBarSettings: syncBarSettings,

    // Add other control-related functions here if needed
        updateBarControlsForSelectedTrack: () => {
        const selectedTrackIndex = AppState.getSelectedTrackIndex();
        if (selectedTrackIndex === -1) {
            // Handle case where no track is selected (e.g., all tracks deleted)
            DOM.barsLengthDisplay.textContent = '0';
            DOM.beatsPerCurrentMeasureDisplay.textContent = '-';
            DOM.beatMultiplierSelect.value = '1';
            return;
        }

        const selectedTrack = AppState.getTracks()[selectedTrackIndex];
        
        // Update the "Bars" count display
        DOM.barsLengthDisplay.textContent = selectedTrack.barSettings.length;

        // Update the "Beats per Measure" and "Subdivision" displays
        updateBeatControlsDisplay();
        updateTotalBeatsDisplay();
    },
};

export default BarControlsController;