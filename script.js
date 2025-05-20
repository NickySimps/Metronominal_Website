document.addEventListener('DOMContentLoaded', () => {
    // Tempo controls
    const tempoDisplay = document.querySelector('.tempo');
    const tempoSlider = document.querySelector('.slider');
    const increaseTempoBtn = document.querySelector('.increase-tempo');
    const tempoTextBox = document.querySelector('.tempo-text-box'); // For animation
    const decreaseTempoBtn = document.querySelector('.decrease-tempo');
    const tapTempoBtn = document.querySelector('.tap-tempo-btn'); // Added for Tap Tempo
    const startStopBtn = document.querySelector('.start-stop-btn');
    const resetButton = document.querySelector('.reset-btn'); // New Reset Button
    let tempo = 120; // Initial tempo

    // Bar and Beat specific controls
    const barDisplayContainer = document.querySelector('.bar-display-container');
    const beatsPerCurrentMeasureDisplay = document.querySelector('.beats-per-current-measure');
    const increaseMeasureLengthBtn = document.querySelector('.increase-measure-length');
    const decreaseMeasureLengthBtn = document.querySelector('.decrease-measure-length');

    const barsLengthDisplay = document.querySelector('.bars-length');
    const increaseBarLengthBtn = document.querySelector('.increase-bar-length');
    const decreaseBarLengthBtn = document.querySelector('.decrease-bar-length');
    const totalBeatsDisplayElement = document.querySelector('.total-beats-display'); // Added for total beats
    const tempoTextElement = document.querySelector('.tempo-text'); // To update descriptive tempo text
    const beatMultiplierSelect = document.getElementById('beat-multiplier-select');

    // Volume Control
    const volumeSlider = document.querySelector('.volume-slider'); // Added for Volume
    const volumeValueDisplay = document.querySelector('.volume-value'); // Added for Volume display
    let currentVolume = 0.8; // Default volume (0.0 to 1.0)
    let beatMultiplier = 1; // Default multiplier (e.g., 1/4 notes as main beat)


    let barSettings = []; // Stores the number of beats for each bar, e.g., [4, 3, 5]
    let selectedBarIndex = 0; // Index of the currently selected bar

    let isPlaying = false;
    let currentBar = 0;
    let currentBeat = 0;
    let previousHighlightedBeatElement = null; // To keep track of the previously highlighted beat
let currentActiveBarElement = null; // To keep track of the bar visual that is currently active

    // Audio elements for metronome clicks - create once
    const clickSound = new Audio('Click1.mp3');
    const accentClickSound = new Audio('Click2.mp3');
    let audioContext; // For more precise timing
let clickSoundBuffer = null; // Buffer for AudioContext
let accentClickSoundBuffer = null; // Buffer for AudioContext

    // Tap Tempo variables
    let tapTempoTimestamps = [];
    const MAX_TAPS_FOR_AVERAGE = 4; // Number of taps to average for tempo
    const MAX_TAP_INTERVAL_MS = 3000; // Max interval between taps to be considered consecutive

    // Preset variables
    const NUM_PRESET_SLOTS = 16;
    const PRESET_STORAGE_KEY_PREFIX = 'metronomePreset_';
    let selectedPresetSlot = 0; // Default to slot 0 (UI would typically set this)

    // Theme switcher logic
    const themes = {
      default: {
          '--Main': '#c000a0',          // Darker Magenta for better contrast on light Accent
          '--Background': '#f0f0f0',
          '--Accent': '#ffe0b2',          // Light Orange/Peach for good contrast with TextPrimary & new Main
          '--Highlight': '#a0faa0',        // Lighter Green for better contrast with TextPrimary
          '--Alt1': '#4682b4',
          '--Alt2': '#dc143c',
          '--TextOnMain': '#ffffff',
          '--TextPrimary': '#333333',
          '--TextSecondary': '#555555',
          '--SubdivisionBeatColor': '#ffa07a',
          '--ActiveBarBackground': 'var(--Alt1)', // Kept as is, Steel Blue
          '--BorderColor': '#dddddd'
      },
      dark: { // Batman Theme
          '--Main': '#1c1c22',          // Dark Grey/Blue (like Batman's suit)
          '--Background': '#0c0c0e',      // Very Dark Charcoal/Almost Black (Gotham night)
          '--Accent': '#fde047',          // Bright Batman Yellow (Bat-Signal, utility belt)
          '--Highlight': '#303038',        // Medium-Dark Grey (for highlighted elements)
          '--Alt1': '#00529b',            // Dark Bat-Blue (classic accent)
          '--Alt2': '#4a4a5a',            // Slate Grey (secondary elements)
          '--TextOnMain': '#f5f5f5',      // Off-White (text on dark main elements)
          '--TextPrimary': '#e0e0e0',      // Light Grey/Off-White (primary text on dark background)
          '--TextSecondary': '#a0a0a8',    // Medium Grey (secondary text)
          '--SubdivisionBeatColor': 'var(--Accent)', // Yellow (for subdivision beats)
          '--ActiveBarBackground': 'var(--Accent)', // Yellow (active bar stands out)
          '--BorderColor': '#282830'       // Dark Grey (borders)
      },
      synthwave: {
          '--Main': '#ff00ff',          // Magenta
          '--Background': '#0d0221',      // Very Dark Purple/Blue
          '--Accent': '#7b00ff',          // Electric Purple (good contrast with white TextPrimary)
          '--Highlight': '#008090',        // Dark Teal (good contrast with white TextPrimary)
          '--Alt1': '#ff69b4',            // Hot Pink (text for select on new Highlight)
          '--Alt2': '#7b00ff',            // Electric Purple
          '--TextOnMain': '#ffffff',      // White text on Magenta
          '--TextPrimary': '#000000',      // White
          '--TextSecondary': '#222222',    // Lighter Grey (brighter for better readability)
          '--SubdivisionBeatColor': '#00f0ff', // Bright Cyan for subdivisions
          '--ActiveBarBackground': 'var(--Alt1)', // Using Alt1 (Hot Pink)
          '--BorderColor': '#301934'       // Dark Purple
      },
      gundam: { // RX-78-2 Inspired
          '--Main': '#0050a0',          // Gundam Blue (Chest, Feet)
          '--Background': '#e8e8e8',      // Light Grey/Off-White (Main Body)
          '--Accent': '#cc0000',          // Gundam Red (Shield, Torso details)
          '--Highlight': '#ffd700',        // Gundam Yellow (V-fin, Vents)
          '--Alt1': '#4a4a4a',            // Dark Grey (Inner frame, weapons)
          '--Alt2': '#d04000',            // Darker Orange for good contrast with white TextOnMain
          '--TextOnMain': '#ffffff',      // White text on Blue
          '--TextPrimary': '#222222',      // Very Dark Grey for primary text
          '--TextSecondary': '#555555',    // Medium Grey for secondary text
          '--SubdivisionBeatColor': '#87cefa', // Light Sky Blue (Subtle subdivision)
          '--ActiveBarBackground': 'var(--Main)', // Gundam Blue for active bar
          '--BorderColor': '#aaaaaa'       // Medium Grey for borders
      }
  };

    function applyTheme(themeName) {
        const theme = themes[themeName];
        if (!theme) {
            console.warn(`Theme "${themeName}" not found.`);
            return;
        }

        for (const [variable, value] of Object.entries(theme)) {
            document.documentElement.style.setProperty(variable, value);
        }
        localStorage.setItem('selectedTheme', themeName);
    }

    function updateVolumeDisplay() {
        if (volumeValueDisplay) {
            volumeValueDisplay.textContent = `${Math.round(currentVolume * 100)}%`;
        }
    }

    // Function to update the total beats display
    function updateTotalBeatsDisplay() {
        if (totalBeatsDisplayElement) {
            const totalBeats = barSettings.reduce((sum, beats) => sum + beats, 0);
            totalBeatsDisplayElement.textContent = totalBeats;
        }
    }


    // Function to initialize or update barSettings based on total number of bars
    function syncBarSettings() {
        // Before changing barSettings, if playing, briefly stop to avoid errors with highlight
        let wasPlaying = isPlaying;
        if (wasPlaying) {
            clearInterval(timer);
            isPlaying = false; // Metronome is now stopped. startStop() will handle UI if restarted.
        }

        const currentNumberOfBars = parseInt(barsLengthDisplay.textContent);
        const previousNumberOfBars = barSettings.length;

        if (currentNumberOfBars > previousNumberOfBars) {
            for (let i = previousNumberOfBars; i < currentNumberOfBars; i++) {
                // New bars get the beat count of the previously last bar, or 4 if it's the first bar ever.
                const defaultBeats = (barSettings.length > 0) ? barSettings[barSettings.length - 1] : 4;
                barSettings.push(defaultBeats);
            }
        } else if (currentNumberOfBars < previousNumberOfBars) {
            barSettings.length = currentNumberOfBars; // Truncate
        }

        // Ensure selectedBarIndex is valid
        if (barSettings.length === 0) {
            selectedBarIndex = -1;
        } else {
            if (selectedBarIndex >= barSettings.length || selectedBarIndex < 0) {
                selectedBarIndex = Math.max(0, barSettings.length - 1); // Select the new last bar or first if empty
            }
        }
        // renderBarsAndControls call is now conditional based on add/remove logic below
        updateTotalBeatsDisplay(); // Update total beats when bar structure changes

        // Adjust currentBar and currentBeat if they became invalid
        if (barSettings.length === 0) {
            currentBar = 0;
            currentBeat = 0;
        } else {
            if (currentBar >= barSettings.length) {
                currentBar = 0;
                currentBeat = 0;
            } else if (currentBeat >= barSettings[currentBar] * beatMultiplier) { // Check against total sub-beats
                currentBeat = 0; // Reset beat if current bar's length changed
            }
        }

        // --- DOM Update Logic ---
        const barVisualsInDom = Array.from(barDisplayContainer.querySelectorAll('.bar-visual:not(.removing-bar-animation)'));
        const currentDomBarCount = barVisualsInDom.length;

        if (currentNumberOfBars > previousNumberOfBars) { // Adding bars
            // barSettings is already updated. selectedBarIndex is updated.
            // renderBarsAndControls will use the new barSettings and selectedBarIndex.
            // Pass previousNumberOfBars (which was the DOM count before adding if DOM was in sync)
            // to animate only the newly added bars.
            renderBarsAndControls(previousNumberOfBars);
            if (wasPlaying && barSettings.length > 0) startStop();

        } else if (currentNumberOfBars < previousNumberOfBars) { // Removing bars
            const barsToAnimateOutCount = previousNumberOfBars - currentNumberOfBars;
            let domBarsAnimatedOut = 0;

            // Animate out bars from the end of the current DOM list
            for (let i = 0; i < barsToAnimateOutCount; i++) {
                const barToRemove = barDisplayContainer.querySelector(`.bar-visual[data-index="${previousNumberOfBars - 1 - i}"]`);
                // Fallback if data-index is not reliable or bar already gone:
                // const barToRemove = barVisualsInDom[currentDomBarCount - 1 - i];

                if (barToRemove && !barToRemove.classList.contains('removing-bar-animation')) {
                    barToRemove.classList.add('removing-bar-animation');
                    barToRemove.addEventListener('animationend', function handleAnimationEnd(event) {
                        event.target.removeEventListener('animationend', handleAnimationEnd);
                        event.target.remove();
                        domBarsAnimatedOut++;

                        if (domBarsAnimatedOut === barsToAnimateOutCount) {
                            // All animations for this removal batch are done.
                            // Re-index remaining DOM bars and update selection.
                            const remainingBarVisuals = barDisplayContainer.querySelectorAll('.bar-visual');
                            remainingBarVisuals.forEach((bar, index) => {
                                bar.dataset.index = index; // Re-assign data-index
                                if (index === selectedBarIndex) bar.classList.add('selected');
                                else bar.classList.remove('selected');
                            });
                            
                            updateBeatControlsDisplay(); // Update based on new selectedBarIndex
                            // updateTotalBeatsDisplay(); // Already called after barSettings update

                            if (wasPlaying) {
                                if (barSettings.length > 0) startStop();
                                else { // All bars removed
                                    startStopBtn.textContent = "START";
                                    startStopBtn.classList.remove('active');
                                    clearAllHighlights();
                                }
                            }
                        }
                    });
                } else if (!barToRemove) { // If somehow the bar is already gone, count it as "animated"
                    domBarsAnimatedOut++; 
                }
            }
             if (domBarsAnimatedOut === barsToAnimateOutCount && wasPlaying && barSettings.length === 0) {
                // This case handles if all bars are removed and none needed animation (e.g., 1 bar to 0)
                startStopBtn.textContent = "START";
                startStopBtn.classList.remove('active');
                clearAllHighlights();
            }

        } else { // Number of bars is the same
            // Ensure selection is visually correct if selectedBarIndex changed (e.g. from -1 to 0)
            renderBarsAndControls(); // Re-render to apply selection, no "new bar" animation
            if (wasPlaying && barSettings.length > 0) startStop();
        }
         if (barSettings.length === 0) { // General cleanup if no bars
            startStopBtn.textContent = "START"; // Ensure button reflects stopped state
            clearAllHighlights();
        }
    }

    function clearAllHighlights() {
        if (previousHighlightedBeatElement) {
            previousHighlightedBeatElement.classList.remove('highlighted');
            previousHighlightedBeatElement = null;
        }
        // Fallback to ensure all are cleared if previousHighlightedBeatElement was missed
        const allBeatSquares = barDisplayContainer.querySelectorAll('.beat-square.highlighted');
        allBeatSquares.forEach(sq => sq.classList.remove('highlighted'));

        // Also clear the active bar styling
        if (currentActiveBarElement) {
            currentActiveBarElement.classList.remove('active-bar');
            currentActiveBarElement = null;
        }
        const allActiveBars = barDisplayContainer.querySelectorAll('.bar-visual.active-bar');
        allActiveBars.forEach(bar => bar.classList.remove('active-bar'));
    }
    // Function to render the bars and update control displays
    // Refactored to intelligently update DOM for beat animations
    function renderBarsAndControls(previousBarCountForAnimation = -1) {
        // Get all current bar DOM elements to compare against barSettings
        const existingBarVisualsMap = new Map();
        barDisplayContainer.querySelectorAll('.bar-visual').forEach(barEl => {
            if (barEl.dataset.index) { // Only consider bars that are part of the managed set
                existingBarVisualsMap.set(barEl.dataset.index, barEl);
            }
        });
    
        if (barSettings.length === 0) {
            beatsPerCurrentMeasureDisplay.textContent = '-';
            increaseMeasureLengthBtn.disabled = true;
            decreaseMeasureLengthBtn.disabled = true;
            clearAllHighlights();
            updateTotalBeatsDisplay(); // Update total beats (will be 0)
            // Animate out any remaining bars if syncBarSettings didn't catch them (shouldn't happen often)
            existingBarVisualsMap.forEach(barEl => {
                if (!barEl.classList.contains('removing-bar-animation')) {
                    barEl.classList.add('removing-bar-animation');
                    barEl.addEventListener('animationend', () => barEl.remove(), { once: true });
                }
            });
            return;
        }
    
        increaseMeasureLengthBtn.disabled = false;
        decreaseMeasureLengthBtn.disabled = false;
    
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
            barDisplayContainer.appendChild(newBarsFragment);
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
            updateBeatHighlight(currentBar, currentBeat, true);
        }
        updateBeatControlsDisplay(); // Update display after rendering
    }

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

    // Function to update the "beats-per-current-measure" display
    function updateBeatControlsDisplay() {
        if (selectedBarIndex !== -1 && barSettings[selectedBarIndex] !== undefined) {
            beatsPerCurrentMeasureDisplay.textContent = barSettings[selectedBarIndex];
        } else {
            beatsPerCurrentMeasureDisplay.textContent = '-';
        }
    }

    // Handler for clicking on a bar
    function handleBarClick(event) {
        const clickedIndex = parseInt(event.currentTarget.dataset.index);
        if (selectedBarIndex !== clickedIndex) {
            selectedBarIndex = clickedIndex;
            renderBarsAndControls(); // Re-render, no "new bar" animation needed here
        }
    }

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

    // Event Listeners for changing beats of the selected bar
    increaseMeasureLengthBtn.addEventListener('click', () => {
        if (selectedBarIndex !== -1 && barSettings[selectedBarIndex] !== undefined) {
            // You might want to add an upper limit, e.g., max 16 beats
            barSettings[selectedBarIndex]++; // Update data model first

            const updateAction = () => {
                renderBarsAndControls(); // Re-render to show updated beat count and controls
                updateTotalBeatsDisplay(); // Update total beats
            };

            if (beatsPerCurrentMeasureDisplay) {
                animateControlUpdate(beatsPerCurrentMeasureDisplay, updateAction);
            } else {
                updateAction(); // Fallback if no display element for animation
            }
        }
    });

    decreaseMeasureLengthBtn.addEventListener('click', () => {
        if (selectedBarIndex !== -1 && barSettings[selectedBarIndex] !== undefined) {
            if (barSettings[selectedBarIndex] > 1) { // Minimum 1 beat per measure
                barSettings[selectedBarIndex]--; // Update data model first

                const updateAction = () => {
                    renderBarsAndControls();
                    updateTotalBeatsDisplay();
                };
                
                if (beatsPerCurrentMeasureDisplay) {
                    animateControlUpdate(beatsPerCurrentMeasureDisplay, updateAction);
                } else {
                    updateAction();
                }
            }
        }
    });

    // Event Listeners for changing total number of bars
    // CSS Note: To make these controls (label, display, buttons) the same size as beat controls,
    // you'd typically wrap them in a div (e.g., <div class="control-group bar-length-control">)
    // and apply consistent styling to .control-group and its children.
    // Elements involved: 'Number of Bars' (label), barsLengthDisplay, increaseBarLengthBtn, decreaseBarLengthBtn
    increaseBarLengthBtn.addEventListener('click', () => {
        let currentBars = parseInt(barsLengthDisplay.textContent);
        // You might want to add an upper limit, e.g., max 16 or 32 bars
        currentBars++;
        const finalBars = currentBars; // Store for use in timeout

        const updateAction = () => {
            barsLengthDisplay.textContent = finalBars;
            syncBarSettings();
        };

        if (barsLengthDisplay) {
            animateControlUpdate(barsLengthDisplay, updateAction);
        } else {
            updateAction();
        }
    });

    decreaseBarLengthBtn.addEventListener('click', () => {
        let currentBars = parseInt(barsLengthDisplay.textContent);
        if (currentBars > 0) { // Can go down to 0 bars
            currentBars--;
            const finalBars = currentBars; // Store for use in timeout

            const updateAction = () => {
                barsLengthDisplay.textContent = finalBars;
                syncBarSettings();
            };

            if (barsLengthDisplay) {
                animateControlUpdate(barsLengthDisplay, updateAction);
            } else {
                updateAction();
            }
        }
    });

    // Initial setup
    function initialize() {
        const initialNumberOfBars = parseInt(barsLengthDisplay.textContent);
        const initialBeatsPerMeasure = parseInt(beatsPerCurrentMeasureDisplay.textContent) || 4;
        // Initialize beatMultiplier from the dropdown's current value
        beatMultiplier = parseInt(beatMultiplierSelect.value) || 1;

        // Initialize Volume
        if (volumeSlider) {
            volumeSlider.value = currentVolume;
        }
        updateVolumeDisplay();

        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            if (audioContext) {
                loadAudioBuffers(); // Load buffers if context is successfully created
            }
        } catch (e) {
            console.warn("Web Audio API not supported. Metronome timing might be less accurate.", e);
            audioContext = null; // Ensure it's null if failed
        }

        barSettings = Array(initialNumberOfBars).fill(initialBeatsPerMeasure);

        if (initialNumberOfBars > 0) {
            selectedBarIndex = 0; // Select the first bar by default
        } else {
            selectedBarIndex = -1; // No bars, nothing selected
        }

        // Load and apply saved theme or default
        const savedTheme = localStorage.getItem('selectedTheme');
        if (savedTheme && themes[savedTheme]) {
            applyTheme(savedTheme);
        } else {
            applyTheme('default'); // Apply default theme if none saved or invalid
        }


        renderBarsAndControls(0); // Initial render, animate all bars appearing
        updateTotalBeatsDisplay(); // Initial calculation of total beats
        // loadPreset(selectedPresetSlot, true); // Optionally load a default preset on init
    }

    function resetToDefaults() {
        // 1. Stop Metronome if playing
        if (isPlaying) {
            startStop(); // This also calls clearAllHighlights()
        }

        // 2. Reset Tempo
        tempo = 120;
        updateTempoDisplay(); // Updates display, slider, and text

        // 3. Reset Beat Multiplier
        beatMultiplier = 1;
        beatMultiplierSelect.value = '1';

        // 4. Reset Volume
        currentVolume = 0.8;
        if (volumeSlider) {
            volumeSlider.value = currentVolume;
        }
        updateVolumeDisplay();

        // 5. Reset Theme
        applyTheme('default');

        // 6. Reset Metronome Playback State (even if not playing, for next start)
        currentBar = 0;
        currentBeat = 0;

        // 7. Reset Bar Structure to a single bar of 4 beats
        barsLengthDisplay.textContent = '1'; // Set the target number of bars for display
        barSettings = [4];                   // Set the actual data structure for bars
        selectedBarIndex = 0;                // Select the first (and only) bar

        // 8. Synchronize and re-render bar display
        // syncBarSettings will use the new barSettings, selectedBarIndex,
        // and barsLengthDisplay to update the DOM, including calling renderBarsAndControls.
        syncBarSettings();

        // 9. Ensure all highlights are cleared (belt-and-suspenders, startStop and syncBarSettings might do this)
        clearAllHighlights();
        updateTotalBeatsDisplay(); // syncBarSettings calls this, but good to ensure.
    }

    // Tempo control functions
    let lastTempoDescription = "";
    function updateTempoDisplay() {
        tempoDisplay.textContent = tempo;
        tempoSlider.value = tempo;

        let currentTempoDescription = "Moderate";
        if (tempo < 40) currentTempoDescription = "Grave";
        else if (tempo < 60) currentTempoDescription = "Largo";
        else if (tempo < 66) currentTempoDescription = "Lento";
        else if (tempo < 76) currentTempoDescription = "Adagio";
        else if (tempo < 108) currentTempoDescription = "Andante";
        else if (tempo < 120) currentTempoDescription = "Moderato";
        else if (tempo < 156) currentTempoDescription = "Allegro";
        else if (tempo < 176) currentTempoDescription = "Vivace";
        else if (tempo < 200) currentTempoDescription = "Presto";
        else currentTempoDescription = "Prestissimo";

        if (tempoTextElement) {
            if (currentTempoDescription !== lastTempoDescription) {
                if (tempoTextBox) {
                    tempoTextBox.classList.add('updating');
                    // Update text after a short delay to allow fade-out part of animation
                    setTimeout(() => {
                        tempoTextElement.textContent = currentTempoDescription;
                        lastTempoDescription = currentTempoDescription;
                        tempoTextBox.classList.remove('updating');
                    }, 250); // Half of the animation duration in CSS
                } else { // Fallback if tempoTextBox is not found
                    tempoTextElement.textContent = currentTempoDescription;
                    lastTempoDescription = currentTempoDescription;
                }
            } else if (!tempoTextElement.textContent) { // Initial set if empty
                tempoTextElement.textContent = currentTempoDescription;
                lastTempoDescription = currentTempoDescription;
            }
        }
    }

    function increaseTempo() {
        tempo = Math.min(tempo + 1, 240); // Example upper limit
        updateTempoDisplay();
    }

    function decreaseTempo() {
        tempo = Math.max(tempo - 1, 40); // Example lower limit
        updateTempoDisplay();
    }

    function handleSliderChange() {
        tempo = parseInt(tempoSlider.value);
        updateTempoDisplay();
    }

    // Tap Tempo Function
    function handleTapTempo() {
        const now = Date.now();
        if (tapTempoTimestamps.length > 0 && (now - tapTempoTimestamps[tapTempoTimestamps.length - 1] > MAX_TAP_INTERVAL_MS)) {
            tapTempoTimestamps = []; // Reset if tap interval is too long
        }

        tapTempoTimestamps.push(now);
        if (tapTempoTimestamps.length > MAX_TAPS_FOR_AVERAGE) {
            tapTempoTimestamps.shift(); // Keep only the last few taps
        }

        if (tapTempoTimestamps.length >= 2) {
            let totalInterval = 0;
            for (let i = 1; i < tapTempoTimestamps.length; i++) {
                totalInterval += tapTempoTimestamps[i] - tapTempoTimestamps[i - 1];
            }
            const averageInterval = totalInterval / (tapTempoTimestamps.length - 1);
            if (averageInterval > 0) {
                const newTempo = Math.round(60000 / averageInterval);
                tempo = Math.max(40, Math.min(newTempo, 240)); // Clamp tempo
                updateTempoDisplay();
                // If playing, the metronome will adjust at the next tick due to changed 'tempo'
            }
        }
        // Visual feedback for tap (e.g., button flash) can be added here via CSS class toggle
        if (tapTempoBtn) tapTempoBtn.classList.add('tapped');
        setTimeout(() => { if (tapTempoBtn) tapTempoBtn.classList.remove('tapped'); }, 100);
    }
    // Metronome logic
    let timer; // Holds the setTimeout ID
    let nextBeatAudioContextTime = 0; // Absolute time in audioContext seconds for the next beat


    function startStop() {
        if (isPlaying) {
            clearInterval(timer);
            isPlaying = false;
            startStopBtn.textContent = "START";
            startStopBtn.classList.remove('active');
            clearAllHighlights(); // Clear highlights when stopping

            // Explicitly pause audio elements when stopping
            clickSound.pause();
            clickSound.currentTime = 0;
            accentClickSound.pause();
            accentClickSound.currentTime = 0;
        } else {
            if (barSettings.length === 0) return; // Nothing to play
            isPlaying = true;
            startStopBtn.textContent = "STOP";
            currentBar = 0;
            startStopBtn.classList.add('active');
            currentBeat = 0;
            clearAllHighlights(); // Clear any previous highlights before starting

            if (audioContext) {
                // Attempt to resume context if it was suspended (e.g., by browser auto-play policy)
                // This is often needed after a user gesture, which startStop() usually is.
                if (audioContext.state === 'suspended') {
                    audioContext.resume();
                }
                // Initialize nextBeatAudioContextTime for the very first beat,
                // but only if buffers are loaded for the AudioContext path.
                // Otherwise, rely on the fallback Audio elements.
                // if (clickSoundBuffer && accentClickSoundBuffer) { // Check if buffers are ready
                // Add a small delay to allow setup and avoid immediate execution issues.
                nextBeatAudioContextTime = audioContext.currentTime + 0.05; // Start 50ms in the future
            }
            metronomeTick(); // Start the metronome loop
        }
    }

    function performCurrentBeatActions() {
        // Actions for barSettings[currentBar] and currentBeat (sub-beat index)
        if (barSettings.length === 0 || currentBar >= barSettings.length) return;

        updateBeatHighlight(currentBar, currentBeat, true);

        let isAccent = false;
        if (beatMultiplier > 1) {
            // If there are subdivisions, accent the first sub-beat of each main beat.
            isAccent = (currentBeat % beatMultiplier === 0);
        } else {
            // If no subdivisions (beatMultiplier is 1), only accent the first beat of the bar.
            // Here, currentBeat is the main beat index (0, 1, 2...).
            isAccent = (currentBeat === 0);
        }
        playClick(isAccent);
    }

    function metronomeTick() {
        if (!isPlaying || barSettings.length === 0) {
            if (isPlaying) { // If it was playing but no bars, stop it.
                startStop(); 
            }
            return;
        }

        const secondsPerMainBeat = 60 / tempo;
        const secondsPerSubBeat = secondsPerMainBeat / beatMultiplier;
        let delayForSetTimeout;

        // Use precise timing if audioContext is available and running
        if (audioContext && audioContext.state === 'running') {
            // This loop ensures that we process all beats that should have occurred by now or very soon.
            // The 0.010 (10ms) is a small lookahead: schedule beats that are due within the next 10ms.
            while (nextBeatAudioContextTime < audioContext.currentTime + 0.010) {
                performCurrentBeatActions(); // Perform actions for currentBar/currentBeat

                // Advance to the next beat state for the *next* iteration or next scheduled beat
                currentBeat++;
                const totalSubBeatsInCurrentBar = barSettings[currentBar] * beatMultiplier;
                if (currentBeat >= totalSubBeatsInCurrentBar) {
                    currentBeat = 0;
                    currentBar++;
                    if (currentBar >= barSettings.length) {
                        currentBar = 0; // Loop
                        if (barSettings.length === 0) { // Should be caught by initial check, but defensive
                            startStop(); return;
                        }
                    }
                }
                // Update the time for the *next* beat that will be scheduled
                nextBeatAudioContextTime += secondsPerSubBeat;
            }
            delayForSetTimeout = (nextBeatAudioContextTime - audioContext.currentTime) * 1000;
        } else {
            // Fallback to old less-accurate behavior if no AudioContext or it's not running
            performCurrentBeatActions();
            delayForSetTimeout = secondsPerSubBeat * 1000;

            // Advance beat/bar logic (only for fallback path, audioContext path advances inside while loop)
            currentBeat++;
            const totalSubBeatsInCurrentBar = barSettings.length > 0 ? barSettings[currentBar] * beatMultiplier : 0;
            if (currentBeat >= totalSubBeatsInCurrentBar) {
                currentBeat = 0;
                currentBar++;
                if (currentBar >= barSettings.length) {
                    currentBar = 0; // Loop back to the beginning
                }
            }
        }
        timer = setTimeout(metronomeTick, Math.max(0, delayForSetTimeout)); // Ensure non-negative delay
    }
    function updateBeatHighlight(barIndex, beatIndex, shouldHighlight) {
        const bars = barDisplayContainer.querySelectorAll('.bar-visual');
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
                if (currentActiveBarElement && barDisplayContainer.contains(currentActiveBarElement)) {
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
    }

    function playClick(isAccent) {
        const htmlSoundToPlay = isAccent ? accentClickSound : clickSound;
        htmlSoundToPlay.volume = currentVolume; // Apply current volume to HTML5 audio element

        const targetBuffer = isAccent ? accentClickSoundBuffer : clickSoundBuffer;

        // Use audioContext for more precise scheduling if available and buffers are loaded
        if (audioContext && audioContext.state === 'running' && targetBuffer) {
            const bufferSource = audioContext.createBufferSource(); // Create a new source node each time
            bufferSource.buffer = targetBuffer;
            // You might want to connect a GainNode here to control volume with Web Audio API
            // For now, Web Audio API sounds will play at their default decoded volume.
            bufferSource.connect(audioContext.destination);
            bufferSource.start(nextBeatAudioContextTime); // Schedule to play at the precise time
        } else {
            htmlSoundToPlay.currentTime = 0; // Reset playback to start for rapid clicks
            htmlSoundToPlay.play().catch(error => console.error("Error playing sound:", error));
        }
    }

    // Function to load audio files into AudioBuffers for AudioContext
    async function loadAudioBuffers() {
        if (!audioContext) return;

        const loadSound = async (url) => {
            try {
                const response = await fetch(url);
                const arrayBuffer = await response.arrayBuffer();
                return await audioContext.decodeAudioData(arrayBuffer);
            } catch (e) {
                console.error(`Error loading or decoding audio file ${url}:`, e);
                return null;
            }
        };

        // Load both sounds concurrently
        const [clickBuffer, accentBuffer] = await Promise.all([
            loadSound('Click1.mp3'),
            loadSound('Click2.mp3')
        ]);

        clickSoundBuffer = clickBuffer;
        accentClickSoundBuffer = accentBuffer;
    }
    // Event listeners for tempo controls
    increaseTempoBtn.addEventListener('click', increaseTempo);
    decreaseTempoBtn.addEventListener('click', decreaseTempo);
    tempoSlider.addEventListener('input', handleSliderChange);
    startStopBtn.addEventListener('click', startStop);
    if (tapTempoBtn) {
        tapTempoBtn.addEventListener('click', handleTapTempo);
    }

    if (resetButton) {
        resetButton.addEventListener('click', resetToDefaults);
    }


        // Event listener for beat multiplier change
        beatMultiplierSelect.addEventListener('change', () => {
          const wasPlaying = isPlaying;
          if (wasPlaying) {
              startStop(); // Stop the metronome (clears timer, sets isPlaying=false, updates UI)
          }
  
          beatMultiplier = parseInt(beatMultiplierSelect.value) || 1;
          // currentBar and currentBeat will be reset by startStop() if it restarts.
          
          renderBarsAndControls(-1); // Re-render visuals. No specific "new bar" animation here.
  
          if (wasPlaying && barSettings.length > 0) {
              startStop(); // Restart the metronome (sets isPlaying=true, resets bar/beat, starts schedule)
          }
          // If it wasn't playing, or if no bars, it remains stopped.
      });

    // Event listeners for theme buttons
    const themeButtons = document.querySelectorAll('.theme-controls button');
    themeButtons.forEach(button => {
        button.addEventListener('click', () => {
            applyTheme(button.dataset.theme);
        });
    });

    // Event listener for volume slider
    if (volumeSlider) {
        volumeSlider.addEventListener('input', () => {
            currentVolume = parseFloat(volumeSlider.value);
            updateVolumeDisplay();
            // No need to update audio elements here if playClick always sets volume
        });
    }

    // --- Preset Functions ---
    function saveCurrentPreset(slotIndex) {
        if (slotIndex < 0 || slotIndex >= NUM_PRESET_SLOTS) {
            console.error("Invalid preset slot index for saving:", slotIndex);
            return;
        }
        const presetData = {
            tempo: tempo,
            barSettings: JSON.parse(JSON.stringify(barSettings)), // Deep copy
            beatMultiplier: beatMultiplier,
            selectedTheme: localStorage.getItem('selectedTheme') || 'default', // Get current theme
            volume: currentVolume
        };
        try {
            localStorage.setItem(PRESET_STORAGE_KEY_PREFIX + slotIndex, JSON.stringify(presetData));
            console.log(`Preset saved to slot ${slotIndex + 1}`);
            // Add visual feedback for successful save
        } catch (e) {
            console.error("Error saving preset:", e);
            // Handle storage full or other errors
        }
    }

    function loadPreset(slotIndex, isInitializing = false) {
        if (slotIndex < 0 || slotIndex >= NUM_PRESET_SLOTS) {
            console.error("Invalid preset slot index for loading:", slotIndex);
            return;
        }
        const presetString = localStorage.getItem(PRESET_STORAGE_KEY_PREFIX + slotIndex);
        if (presetString) {
            try {
                const presetData = JSON.parse(presetString);

                // Stop metronome before applying settings if it's running
                let wasPlaying = isPlaying;
                if (isPlaying) {
                    startStop(); // This stops and clears highlights
                }

                tempo = presetData.tempo || 120;
                barSettings = Array.isArray(presetData.barSettings) ? presetData.barSettings : [4];
                beatMultiplier = presetData.beatMultiplier || 1;
                currentVolume = (typeof presetData.volume === 'number') ? presetData.volume : 0.8;

                // Apply settings
                updateTempoDisplay(); // Updates tempo display and slider

                // Update barsLengthDisplay based on loaded barSettings
                if (barsLengthDisplay) {
                    barsLengthDisplay.textContent = barSettings.length;
                }
                // syncBarSettings will handle DOM updates for bars and beats
                // It also updates selectedBarIndex and calls renderBarsAndControls
                syncBarSettings(); // This will call renderBarsAndControls internally

                beatMultiplierSelect.value = beatMultiplier;

                if (volumeSlider) volumeSlider.value = currentVolume;
                updateVolumeDisplay();

                if (presetData.selectedTheme) {
                    applyTheme(presetData.selectedTheme);
                }

                console.log(`Preset loaded from slot ${slotIndex + 1}`);

                // If it was playing before loading, and not initializing, user can restart.
                // Or, optionally, restart it automatically:
                // if (wasPlaying && !isInitializing && barSettings.length > 0) {
                //     startStop();
                // }

            } catch (e) {
                console.error("Error parsing or applying preset:", e);
            }
        } else {
            if (!isInitializing) console.log(`No preset found in slot ${slotIndex + 1}`);
        }
    }

    // Example: Hook up save/load to specific buttons (you'll need to create these in HTML)
    // document.getElementById('save-slot-0-btn')?.addEventListener('click', () => saveCurrentPreset(0));
    // document.getElementById('load-slot-0-btn')?.addEventListener('click', () => loadPreset(0));
    // You would typically have a UI to select the 'selectedPresetSlot'
    // and then generic save/load buttons:
    // document.querySelector('.save-preset-btn')?.addEventListener('click', () => saveCurrentPreset(selectedPresetSlot));
    // document.querySelector('.load-preset-btn')?.addEventListener('click', () => loadPreset(selectedPresetSlot));

    // Initialize tempo display
    updateTempoDisplay();

    initialize();

});