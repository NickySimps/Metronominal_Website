document.addEventListener('DOMContentLoaded', () => {
    // Tempo controls
    const tempoDisplay = document.querySelector('.tempo');
    const tempoSlider = document.querySelector('.slider');
    const increaseTempoBtn = document.querySelector('.increase-tempo');
    const tempoTextBox = document.querySelector('.tempo-text-box'); // For animation
    const decreaseTempoBtn = document.querySelector('.decrease-tempo');
    const startStopBtn = document.querySelector('.start-stop-btn');
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
        renderBarsAndControls();
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

        if (wasPlaying && barSettings.length > 0) {
            // Metronome was playing, and there are still bars. Restart it.
            // startStop() will set isPlaying to true and update button text.
            startStop(); 
        } else if (wasPlaying && barSettings.length === 0) {
            // If all bars were removed while playing, truly stop.
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
    function renderBarsAndControls() {
        barDisplayContainer.innerHTML = ''; // Clear previous bars

        if (barSettings.length === 0) {
            beatsPerCurrentMeasureDisplay.textContent = '-';
            increaseMeasureLengthBtn.disabled = true;
            decreaseMeasureLengthBtn.disabled = true;
            clearAllHighlights();
            updateTotalBeatsDisplay(); // Update total beats (will be 0)
            return;
        }

        increaseMeasureLengthBtn.disabled = false;
        decreaseMeasureLengthBtn.disabled = false;

        barSettings.forEach((beats, index) => {
            const barDiv = document.createElement('div');
            barDiv.classList.add('bar-visual');
            barDiv.dataset.index = index;

            // Create beat squares based on main beats for this bar and the beatMultiplier
            const totalSubBeats = beats * beatMultiplier; // 'beats' is main beats in current bar
            for (let i = 0; i < totalSubBeats; i++) {
                const beatSquare = document.createElement('div');
                beatSquare.classList.add('beat-square');

                // If this sub-beat is NOT the first sub-beat of a main beat (i.e., it's a true subdivision)
                // and we actually have subdivisions (beatMultiplier > 1), then mark it.
                if (i % beatMultiplier === 0) {
                    beatSquare.classList.add('main-beat-marker');
                } else if (beatMultiplier > 1) { // Only add 'subdivision' if it's not the main beat marker AND there are subdivisions
                    beatSquare.classList.add('subdivision');
                }
                // Add beat square to bar
                barDiv.appendChild(beatSquare);
            }
            // Removed redundant outer loop: for (let i = 0; i < beats; i++)

            if (index === selectedBarIndex && barSettings.length > 0) {
                barDiv.classList.add('selected');
            }
            barDiv.addEventListener('click', handleBarClick);
            barDisplayContainer.appendChild(barDiv);
        });
        // If metronome is playing, re-apply highlight to the current beat
        if (isPlaying) {
            updateBeatHighlight(currentBar, currentBeat, true);
        }
        updateBeatControlsDisplay(); // Update display after rendering
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
            renderBarsAndControls(); // Re-render to update selection and controls
        }
    }

    // Event Listeners for changing beats of the selected bar
    increaseMeasureLengthBtn.addEventListener('click', () => {
        if (selectedBarIndex !== -1 && barSettings[selectedBarIndex] !== undefined) {
            // You might want to add an upper limit, e.g., max 16 beats
            barSettings[selectedBarIndex]++;
            renderBarsAndControls(); // Re-render to show updated beat count and controls
            updateTotalBeatsDisplay(); // Update total beats when a bar's beats change
        }
    });

    decreaseMeasureLengthBtn.addEventListener('click', () => {
        if (selectedBarIndex !== -1 && barSettings[selectedBarIndex] !== undefined) {
            if (barSettings[selectedBarIndex] > 1) { // Minimum 1 beat per measure
                barSettings[selectedBarIndex]--;
                renderBarsAndControls();
                updateTotalBeatsDisplay(); // Update total beats when a bar's beats change
            }
        }
    });

    // Event Listeners for changing total number of bars
    increaseBarLengthBtn.addEventListener('click', () => {
        let currentBars = parseInt(barsLengthDisplay.textContent);
        // You might want to add an upper limit, e.g., max 16 or 32 bars
        currentBars++;
        barsLengthDisplay.textContent = currentBars;
        syncBarSettings();
    });

    decreaseBarLengthBtn.addEventListener('click', () => {
        let currentBars = parseInt(barsLengthDisplay.textContent);
        if (currentBars > 0) { // Can go down to 0 bars
            currentBars--;
            barsLengthDisplay.textContent = currentBars;
            syncBarSettings();
        }
    });

    // Initial setup
    function initialize() {
        const initialNumberOfBars = parseInt(barsLengthDisplay.textContent);
        const initialBeatsPerMeasure = parseInt(beatsPerCurrentMeasureDisplay.textContent) || 4;
        // Initialize beatMultiplier from the dropdown's current value
        beatMultiplier = parseInt(beatMultiplierSelect.value) || 1;

        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
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
        renderBarsAndControls(); // Initial render
        updateTotalBeatsDisplay(); // Initial calculation of total beats
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
                // Initialize nextBeatAudioContextTime for the very first beat.
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
        const soundToPlay = isAccent ? accentClickSound : clickSound;
        soundToPlay.currentTime = 0; // Reset playback to start for rapid clicks
        soundToPlay.play().catch(error => {
            // Optional: Catch playback errors (e.g., browser restrictions)
            console.error("Error playing sound:", error);
        });
    }

    // Event listeners for tempo controls
    increaseTempoBtn.addEventListener('click', increaseTempo);
    decreaseTempoBtn.addEventListener('click', decreaseTempo);
    tempoSlider.addEventListener('input', handleSliderChange);
    startStopBtn.addEventListener('click', startStop);

        // Event listener for beat multiplier change
        beatMultiplierSelect.addEventListener('change', () => {
          const wasPlaying = isPlaying;
          if (wasPlaying) {
              startStop(); // Stop the metronome (clears timer, sets isPlaying=false, updates UI)
          }
  
          beatMultiplier = parseInt(beatMultiplierSelect.value) || 1;
          // currentBar and currentBeat will be reset by startStop() if it restarts.
          
          renderBarsAndControls(); // Re-render visuals. isPlaying is false, so no auto-highlight from here.
  
          if (wasPlaying && barSettings.length > 0) {
              startStop(); // Restart the metronome (sets isPlaying=true, resets bar/beat, starts schedule)
          }
          // If it wasn't playing, or if no bars, it remains stopped.
      });

    // Initialize tempo display
    updateTempoDisplay();

    initialize();
});