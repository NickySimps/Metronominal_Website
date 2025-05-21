/**
 * barControlsController.js
 * This module manages the controls for modifying the number of bars and beats per bar.
 * It updates the AppState and triggers updates in the BarDisplayController.
 * It interacts with MetronomeEngine for playback control that affects UI.
 * It interacts with domSelectors to access control elements.
 */

import AppState from './appState.js'; // Assuming AppState is a module
import DOM from './domSelectors.js'; // Assuming domSelectors is a module
import BarDisplayController from './barDisplayController.js'; // Assuming BarDisplayController is a module
import MetronomeEngine from './metronomeEngine.js'; // For toggling play with UI updates

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
    const selectedBarIndex = AppState.getSelectedBarIndex();
    const barSettings = AppState.getBarSettings();
    if (selectedBarIndex !== -1 && barSettings[selectedBarIndex] !== undefined) {
        DOM.beatsPerCurrentMeasureDisplay.textContent = barSettings[selectedBarIndex];
    } else {
        DOM.beatsPerCurrentMeasureDisplay.textContent = '-';
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
async function syncBarSettings() { // Make syncBarSettings async
    // Before changing barSettings, if playing, briefly stop to avoid errors with highlight
    let wasPlaying = AppState.isPlaying();
    if (wasPlaying) {
        await MetronomeEngine.togglePlay(); // Stop playback; this updates button UI
    }

    const currentNumberOfBars = parseInt(DOM.barsLengthDisplay.textContent, 10);
    const previousNumberOfBars = AppState.getBarSettings().length;

    // Update the AppState's bar array based on the new count
    AppState.updateBarArray(currentNumberOfBars);

    // --- DOM Update Logic ---
    // This part orchestrates the DOM updates and animations based on the change.
    // It relies on BarDisplayController to handle the actual rendering and beat animations.

    if (currentNumberOfBars > previousNumberOfBars) { // Adding bars
        // AppState.barSettings is already updated. AppState.selectedBarIndex is updated.
        // renderBarsAndControls will use the new barSettings and selectedBarIndex.
        // Pass previousNumberOfBars (which was the DOM count before adding if DOM was in sync)
        // to animate only the newly added bars.
        BarDisplayController.renderBarsAndControls(previousNumberOfBars);
        if (wasPlaying && AppState.getBarSettings().length > 0) await MetronomeEngine.togglePlay(); // Restart if needed; this updates button UI

    } else if (currentNumberOfBars < previousNumberOfBars) { // Removing bars
        const barsToAnimateOutCount = previousNumberOfBars - currentNumberOfBars;
        let domBarsAnimatedOut = 0;

        // Animate out bars from the end of the current DOM list
        // We need to select bars based on their *original* index before truncation
        const barVisualsInDom = Array.from(DOM.barDisplayContainer.querySelectorAll('.bar-visual:not(.removing-bar-animation)'));

        for (let i = 0; i < barsToAnimateOutCount; i++) {
             // Select the bar element that corresponds to the bar being removed from the end
            const barToRemove = barVisualsInDom[previousNumberOfBars - 1 - i];

            if (barToRemove && !barToRemove.classList.contains('removing-bar-animation')) {
                barToRemove.classList.add('removing-bar-animation');
                barToRemove.addEventListener('animationend', function handleAnimationEnd(event) {
                    event.target.removeEventListener('animationend', handleAnimationEnd);
                    event.target.remove();
                    domBarsAnimatedOut++;

                    if (domBarsAnimatedOut === barsToAnimateOutCount) {
                        // All animations for this removal batch are done.
                        // Re-index remaining DOM bars and update selection.
                        const remainingBarVisuals = DOM.barDisplayContainer.querySelectorAll('.bar-visual');
                        remainingBarVisuals.forEach((bar, index) => {
                            bar.dataset.index = index; // Re-assign data-index
                            if (index === AppState.getSelectedBarIndex()) bar.classList.add('selected');
                            else bar.classList.remove('selected');
                        });

                        updateBeatControlsDisplay(); // Update based on new selectedBarIndex
                        updateTotalBeatsDisplay(); // Update total beats

                        if (wasPlaying) {
                            if (AppState.getBarSettings().length > 0) MetronomeEngine.togglePlay(); // Restart if needed
                            else { // All bars removed - MetronomeEngine.togglePlay would have been called to stop
                                // MetronomeEngine.togglePlay would have set button to START
                            }
                        }
                    }
                });
            } else if (!barToRemove) { // If somehow the bar is already gone, count it as "animated"
                domBarsAnimatedOut++;
            }
        }
         // Handle case where no bars needed animation (e.g., 1 bar to 0)
        if (domBarsAnimatedOut === barsToAnimateOutCount && wasPlaying && AppState.getBarSettings().length === 0) {
            // If wasPlaying and now 0 bars, MetronomeEngine.togglePlay (called at the start of this 'if wasPlaying' block)
            // would have stopped it and set the button to START.
        }

    } else { // Number of bars is the same
        // Ensure selection is visually correct if selectedBarIndex changed (e.g. from -1 to 0)
        BarDisplayController.renderBarsAndControls(); // Re-render to apply selection, no "new bar" animation
        if (wasPlaying && AppState.getBarSettings().length > 0) await MetronomeEngine.togglePlay(); // Restart if needed
    }

    if (AppState.getBarSettings().length === 0 && wasPlaying) { // General cleanup if no bars and it was playing
        // MetronomeEngine.togglePlay (called at the start of 'if wasPlaying' block) handles UI update.
    }

    updateTotalBeatsDisplay(); // Ensure total beats is updated after any change
}

const BarControlsController = {
    /**
     * Initializes the bar and beat control elements and their event listeners.
     */
    initializeBarControls: () => {
        // Event Listeners for changing beats of the selected bar
        DOM.increaseMeasureLengthBtn.addEventListener('click', () => {
            if (AppState.getSelectedBarIndex() !== -1) {
                AppState.increaseBeatsForSelectedBar(); // Update state

                const updateAction = () => {
                    BarDisplayController.renderBarsAndControls(); // Re-render visuals
                    updateBeatControlsDisplay(); // Update beats display
                    updateTotalBeatsDisplay(); // Update total beats
                };

                animateControlUpdate(DOM.beatsPerCurrentMeasureDisplay, updateAction);
            }
        });

        DOM.decreaseMeasureLengthBtn.addEventListener('click', () => {
            if (AppState.getSelectedBarIndex() !== -1 && AppState.getBeatsForSelectedBar() > 1) {
                AppState.decreaseBeatsForSelectedBar(); // Update state

                const updateAction = () => {
                    BarDisplayController.renderBarsAndControls();
                    updateBeatControlsDisplay();
                    updateTotalBeatsDisplay();
                };

                animateControlUpdate(DOM.beatsPerCurrentMeasureDisplay, updateAction);
            }
        });

        // Event Listeners for changing total number of bars
        DOM.increaseBarLengthBtn.addEventListener('click', () => {
            let currentBars = parseInt(DOM.barsLengthDisplay.textContent, 10);
            // You might want to add an upper limit, e.g., max 16 or 32 bars
            currentBars++;
            const finalBars = currentBars; // Store for use in timeout

            const updateAction = () => {
                DOM.barsLengthDisplay.textContent = finalBars;
                syncBarSettings(); // Sync state and trigger render
            };

            animateControlUpdate(DOM.barsLengthDisplay, updateAction);
        });

        DOM.decreaseBarLengthBtn.addEventListener('click', () => {
            let currentBars = parseInt(DOM.barsLengthDisplay.textContent, 10);
            if (currentBars > 0) { // Can go down to 0 bars
                currentBars--;
                const finalBars = currentBars; // Store for use in timeout

                const updateAction = () => {
                    DOM.barsLengthDisplay.textContent = finalBars;
                    syncBarSettings(); // Sync state and trigger render
                };

                animateControlUpdate(DOM.barsLengthDisplay, updateAction);
            }
        });

        // Event listener for beat multiplier change
        DOM.beatMultiplierSelect.addEventListener('change', async () => { // Make event handler async
            const wasPlaying = AppState.isPlaying();
            if (wasPlaying) {
                await MetronomeEngine.togglePlay(); // Stop playback; this updates button UI
            }

            AppState.setBeatMultiplier(DOM.beatMultiplierSelect.value); // Update state

            // Re-render visuals based on new multiplier
            BarDisplayController.renderBarsAndControls(-1);
            if (wasPlaying && AppState.getBarSettings().length > 0) {
                await MetronomeEngine.togglePlay(); // Restart playback; this updates button UI
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
};

export default BarControlsController;