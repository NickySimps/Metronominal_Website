/**
 * barDisplayController.js
 * This module is responsible for rendering and updating the visual representation
 * of the metronome bars and beats in the DOM.
 * It interacts with AppState to get the current bar structure and playback position.
 * It interacts with domSelectors to access the container element.
 */

import AppState from './appState.js'; // Assuming AppState is a module
import DOM from './domSelectors.js'; // Assuming domSelectors is a module

// State variables related to display highlighting
let previousHighlightedBeatElement = null; // To keep track of the previously highlighted beat
let currentActiveBarElement = null; // To keep track of the bar visual that is currently active

// Helper function to create a beat square element with animation and classes
function createBeatSquareElement(indexInBar, currentBeatMultiplier) {
    const beatSquare = document.createElement('div');
    beatSquare.classList.add('beat-square', 'newly-added-beat-animation');
    updateBeatSquareClasses(beatSquare, indexInBar, currentBeatMultiplier);

    // Optional: remove animation class after it plays to clean up DOM, if not using 'forwards' or for other reasons
    beatSquare.addEventListener('animationend', function handleBeatAppearAnim() {
        this.removeEventListener('animationend', handleBeatAppearAnim);
        this.classList.remove('newly-added-beat-animation');
    }, { once: true });
    return beatSquare;
}

// Helper function to update classes on an existing beat square
function updateBeatSquareClasses(beatSquare, indexInBar, currentBeatMultiplier) {
    beatSquare.classList.remove('main-beat-marker', 'subdivision'); // Clear old type classes
    if (indexInBar % currentBeatMultiplier === 0) {
        beatSquare.classList.add('main-beat-marker');
    } else if (currentBeatMultiplier > 1) {
        beatSquare.classList.add('subdivision');
    }
}

// Handler for clicking on a bar
function handleBarClick(event) {
    const clickedIndex = parseInt(event.currentTarget.dataset.index);
    if (AppState.getSelectedBarIndex() !== clickedIndex) {
        AppState.setSelectedBarIndex(clickedIndex);
        BarDisplayController.renderBarsAndControls(); // Re-render, no "new bar" animation needed here
        // TODO: Notify barControlsController to update its display
    }
}

const BarDisplayController = {
    /**
     * Renders or updates the bar and beat visuals in the DOM.
     * @param {number} [previousBarCountForAnimation=-1] - Optional. If provided,
     *   animates bars with index >= this count as newly added.
     */
    renderBarsAndControls: (previousBarCountForAnimation = -1) => {
        const barSettings = AppState.getBarSettings();
        const selectedBarIndex = AppState.getSelectedBarIndex();
        const beatMultiplier = AppState.getBeatMultiplier();
        const isPlaying = AppState.isPlaying();
        const currentBar = AppState.getCurrentBar();
        const currentBeat = AppState.getCurrentBeat();

        // Get all current bar DOM elements to compare against barSettings
        const existingBarVisualsMap = new Map();
        DOM.barDisplayContainer.querySelectorAll('.bar-visual').forEach(barEl => {
            if (barEl.dataset.index) { // Only consider bars that are part of the managed set
                existingBarVisualsMap.set(barEl.dataset.index, barEl);
            }
        });

        if (barSettings.length === 0) {
            BarDisplayController.clearAllHighlights();
            // Animate out any remaining bars if syncBarSettings didn't catch them (shouldn't happen often)
            existingBarVisualsMap.forEach(barEl => {
                if (!barEl.classList.contains('removing-bar-animation')) {
                    barEl.classList.add('removing-bar-animation');
                    barEl.addEventListener('animationend', () => barEl.remove(), { once: true });
                }
            });
            DOM.barDisplayContainer.innerHTML = ''; // Ensure container is empty
            return;
        }

        const newBarsFragment = document.createDocumentFragment(); // For bars that are entirely new

        barSettings.forEach((mainBeatsInBar, index) => {
            let barDiv = existingBarVisualsMap.get(String(index));
            const totalSubBeatsNeeded = mainBeatsInBar * beatMultiplier;
            let isNewBarInstance = false; // Flag to know if we are creating a new DOM element for the bar

            if (barDiv) { // Bar already exists in DOM
                existingBarVisualsMap.delete(String(index)); // Mark as processed
            } else { // Bar does not exist in DOM, create it
                isNewBarInstance = true;
                barDiv = document.createElement('div');
                barDiv.classList.add('bar-visual');
                barDiv.dataset.index = index;

                // Animate new bar appearing (if previousBarCountForAnimation indicates it's new)
                if (previousBarCountForAnimation !== -1 && index >= previousBarCountForAnimation) {
                    barDiv.classList.add('newly-added-bar-animation');
                }
                barDiv.addEventListener('click', handleBarClick);
            }

            // ---- START: Add density class logic ----
            // This applies to both existing and newly created barDivs
            barDiv.classList.remove('medium-dense-beats', 'high-dense-beats'); // Clear existing density classes
            const HIGH_DENSITY_THRESHOLD = 20; // e.g., > 5 beats of 16ths, or > 2.5 beats of 32nds
            const MEDIUM_DENSITY_THRESHOLD = 10; // e.g., > 2.5 beats of 16ths, or > 1.25 beats of 32nds

            if (totalSubBeatsNeeded > HIGH_DENSITY_THRESHOLD) {
                barDiv.classList.add('high-dense-beats');
            } else if (totalSubBeatsNeeded > MEDIUM_DENSITY_THRESHOLD) {
                barDiv.classList.add('medium-dense-beats');
            }
            // ---- END: Add density class logic ----

            // Now, handle beat squares (add/remove/update)
            if (isNewBarInstance) { // If it's a brand new bar DOM element, just add all beats
                for (let i = 0; i < totalSubBeatsNeeded; i++) {
                    const beatSquare = createBeatSquareElement(i, beatMultiplier);
                    barDiv.appendChild(beatSquare);
                }
            } else { // Bar DOM element existed, update its beats intelligently
                const existingBeatSquares = Array.from(barDiv.querySelectorAll('.beat-square:not(.removing-beat-animation)'));
                const currentSubBeatCountInDom = existingBeatSquares.length;

                if (totalSubBeatsNeeded > currentSubBeatCountInDom) { // Add beats
                    for (let i = currentSubBeatCountInDom; i < totalSubBeatsNeeded; i++) {
                        const beatSquare = createBeatSquareElement(i, beatMultiplier);
                        barDiv.appendChild(beatSquare);
                    }
                } else if (totalSubBeatsNeeded < currentSubBeatCountInDom) { // Remove beats
                    const beatsToAnimateOutCount = currentSubBeatCountInDom - totalSubBeatsNeeded;
                    for (let i = 0; i < beatsToAnimateOutCount; i++) {
                        const beatToRemove = existingBeatSquares[currentSubBeatCountInDom - 1 - i];
                        if (beatToRemove) {
                            beatToRemove.classList.add('removing-beat-animation');
                            beatToRemove.addEventListener('animationend', function handleBeatRemoveAnim() {
                                this.removeEventListener('animationend', handleBeatRemoveAnim);
                                this.remove();
                                if (previousHighlightedBeatElement === this) {
                                    previousHighlightedBeatElement = null;
                                }
                            }, { once: true });
                        }
                    }
                } else { // Same number of sub-beats, ensure classes are correct (e.g. if multiplier changed type)
                    existingBeatSquares.forEach((sq, beatIdx) => {
                        updateBeatSquareClasses(sq, beatIdx, beatMultiplier);
                    });
                }
            }

            // Update selection class for the bar (whether existing or new)
            if (index === selectedBarIndex) {
                barDiv.classList.add('selected');
            } else {
                barDiv.classList.remove('selected');
            }

            if (isNewBarInstance) { // Only append to fragment if it was truly a new bar element
                newBarsFragment.appendChild(barDiv);
            }
        });

        // Append any entirely new bars to the container
        if (newBarsFragment.childNodes.length > 0) {
            DOM.barDisplayContainer.appendChild(newBarsFragment);
        }

        // Any bars remaining in existingBarVisualsMap were not in barSettings and should be removed.
        // This is a fallback; syncBarSettings should primarily handle bar removal animations.
        existingBarVisualsMap.forEach(barEl => {
            if (!barEl.classList.contains('removing-bar-animation')) {
                barEl.classList.add('removing-bar-animation');
                barEl.addEventListener('animationend', () => barEl.remove(), { once: true });
            }
        });

        // If metronome is playing, re-apply highlight to the current beat
        if (isPlaying) {
            BarDisplayController.updateBeatHighlight(currentBar, currentBeat, true);
        }
        // Note: updateBeatControlsDisplay and updateTotalBeatsDisplay are now in BarControlsController
    },

    /**
     * Clears all beat and bar highlights from the display.
     */
    clearAllHighlights: () => {
        if (previousHighlightedBeatElement) {
            previousHighlightedBeatElement.classList.remove('highlighted');
            previousHighlightedBeatElement = null;
        }
        // Fallback to ensure all are cleared if previousHighlightedBeatElement was missed
        const allBeatSquares = DOM.barDisplayContainer.querySelectorAll('.beat-square.highlighted');
        allBeatSquares.forEach(sq => sq.classList.remove('highlighted'));

        // Also clear the active bar styling
        if (currentActiveBarElement) {
            currentActiveBarElement.classList.remove('active-bar');
            currentActiveBarElement = null;
        }
        const allActiveBars = DOM.barDisplayContainer.querySelectorAll('.bar-visual.active-bar');
        allActiveBars.forEach(bar => bar.classList.remove('active-bar'));
    },

    /**
     * Updates the visual highlight for the current beat and bar.
     * @param {number} barIndex - The index of the current bar.
     * @param {number} beatIndex - The index of the current sub-beat within the bar.
     * @param {boolean} shouldHighlight - Whether to apply or remove the highlight.
     */
    updateBeatHighlight: (barIndex, beatIndex, shouldHighlight) => {
        const bars = DOM.barDisplayContainer.querySelectorAll('.bar-visual');
        if (barIndex < 0 || barIndex >= bars.length) return;

        const targetBarElement = bars[barIndex]; // The bar that should be active

        // 1. Clear previous beat's highlight style
        if (previousHighlightedBeatElement) {
            previousHighlightedBeatElement.classList.remove('highlighted');
        }

        // 2. Clear 'active-bar' from the previously active bar IF it's different from the new target
        if (currentActiveBarElement && currentActiveBarElement !== targetBarElement) {
            currentActiveBarElement.classList.remove('active-bar');
        }

        // 3. Apply new highlights and active bar state
        if (shouldHighlight) { // This is always true when called from metronomeTick
            const beatSquares = targetBarElement.querySelectorAll('.beat-square');
            if (beatIndex >= 0 && beatIndex < beatSquares.length) {
                const beatToHighlight = beatSquares[beatIndex];
                beatToHighlight.classList.add('highlighted');
                previousHighlightedBeatElement = beatToHighlight;

                targetBarElement.classList.add('active-bar');
                currentActiveBarElement = targetBarElement;

                // Auto-scroll to the active bar
                if (currentActiveBarElement && DOM.barDisplayContainer.contains(currentActiveBarElement)) {
                    currentActiveBarElement.scrollIntoView({
                        behavior: 'smooth',
                        block: 'nearest',
                        inline: 'center'
                    });
                }

            } else {
                // Beat index is out of bounds, ensure no beat is marked as highlighted
                // and no bar is marked as active from this path.
                previousHighlightedBeatElement = null;
                if (currentActiveBarElement) { // If for some reason a bar was active, clear it.
                    currentActiveBarElement.classList.remove('active-bar');
                    currentActiveBarElement = null;
                }
            }
        } else {
            // This 'else' (shouldHighlight = false) is not typically hit by metronomeTick.
            // clearAllHighlights handles full cleanup when stopping.
            previousHighlightedBeatElement = null;
            if (currentActiveBarElement) {
                currentActiveBarElement.classList.remove('active-bar');
                currentActiveBarElement = null;
            }
        }
    },

    // Add any other display-related functions here
};

export default BarDisplayController;