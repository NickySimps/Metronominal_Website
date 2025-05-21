/**
 * metronomeEngine.js
 * This module contains the core metronome timing, playback control, and audio handling.
 */

import AppState from './appState.js';
import DOM from './domSelectors.js';
import BarDisplayController from './barDisplayController.js';

// Audio elements - private to this module
const clickSound = new Audio('Click1.mp3');
const accentClickSound = new Audio('Click2.mp3');

let timerId = null; // Holds the setTimeout ID for the metronome loop
let lastTickTime = 0; // For fallback timing adjustment (if needed, currently simple delay)

// How far ahead to schedule audio (in seconds) for Web Audio API
const scheduleAheadTime = 0.1;

function playClick(isAccent) {
    const audioContext = AppState.getAudioContext();
    const volume = AppState.getVolume();
    const htmlSoundToPlay = isAccent ? accentClickSound : clickSound;
    htmlSoundToPlay.volume = volume;

    const targetBuffer = isAccent ? AppState.getAccentSoundBuffer() : AppState.getClickSoundBuffer();

    if (audioContext && audioContext.state === 'running' && targetBuffer) {
        const nextBeatTime = AppState.getNextBeatAudioContextTime(); // Time this beat is scheduled for
        const source = audioContext.createBufferSource();
        source.buffer = targetBuffer;

        // Create a GainNode for volume control with Web Audio API
        const gainNode = audioContext.createGain();
        gainNode.gain.setValueAtTime(volume, audioContext.currentTime);

        source.connect(gainNode);
        gainNode.connect(audioContext.destination);

        source.start(nextBeatTime);
    } else {
        htmlSoundToPlay.currentTime = 0;
        htmlSoundToPlay.play().catch(error => console.error("Error playing HTML5 audio:", error));
    }
}

function performCurrentBeatActions() {
    const barSettings = AppState.getBarSettings();
    const currentBar = AppState.getCurrentBar();
    const currentBeat = AppState.getCurrentBeat(); // This is the sub-beat index
    const beatMultiplier = AppState.getBeatMultiplier();

    // Check for invalid state; if so, request a stop via the main togglePlay.
    if (barSettings.length === 0 || currentBar >= barSettings.length || barSettings[currentBar] === undefined) {
        console.warn("Attempting to play beat in invalid bar/beat state.");
        if (AppState.isPlaying()) MetronomeEngine.togglePlay(); // This will stop the engine and update UI
        return; // Exit, togglePlay will have cleared the timer.
    }
    BarDisplayController.updateBeatHighlight(currentBar, currentBeat, true);

    let isAccent = false;
    // Accent the first sub-beat of each main beat.
    // Also, the very first beat of the entire sequence (bar 0, beat 0) is often accented.
    // For simplicity, we'll just accent based on the beatMultiplier.
    // If beatMultiplier is 1, every beat is a "main beat start".
    // If beatMultiplier > 1, only beats at index 0, beatMultiplier, 2*beatMultiplier, etc. are main beat starts.
    if (currentBeat % beatMultiplier === 0) {
        isAccent = true;
    }
    playClick(isAccent);
}

function metronomeTick() {
    if (!AppState.isPlaying() || AppState.getBarSettings().length === 0) {
        if (AppState.isPlaying()) MetronomeEngine.stop(); // Ensure stopped if state implies it
        return;
    }

    const tempo = AppState.getTempo();
    const beatMultiplier = AppState.getBeatMultiplier();
    const secondsPerMainBeat = 60.0 / tempo;
    const secondsPerSubBeat = secondsPerMainBeat / beatMultiplier;

    let delayForSetTimeout;
    const audioContext = AppState.getAudioContext();

    if (audioContext && audioContext.state === 'running' && AppState.getClickSoundBuffer() && AppState.getAccentSoundBuffer()) {
        // Schedule beats that are due within the scheduleAheadTime window
        while (AppState.getNextBeatAudioContextTime() < audioContext.currentTime + scheduleAheadTime) {
            performCurrentBeatActions();
            AppState.advanceBeat();
            AppState.incrementNextBeatAudioContextTime(secondsPerSubBeat);
        }
        // Calculate delay until the next time we need to check for scheduling
        // This aims to wake up shortly before the next beat is due to be scheduled.
        // A common approach is to set timeout for (nextBeatAudioContextTime - currentTime - lookahead)
        // For simplicity, let's use a fraction of scheduleAheadTime or a fixed interval.
        // A more robust scheduler might use a smaller, fixed interval for the setTimeout loop.
        delayForSetTimeout = Math.max(0, (AppState.getNextBeatAudioContextTime() - audioContext.currentTime - (scheduleAheadTime / 2)) * 1000);
        // Fallback to a shorter interval if calculated delay is too long or negative
        if (delayForSetTimeout <= 0 || delayForSetTimeout > 100) {
            delayForSetTimeout = 50; // Check every 50ms
        }

    } else { // Fallback timing
        performCurrentBeatActions();
        AppState.advanceBeat();
        delayForSetTimeout = secondsPerSubBeat * 1000;

        // Adjust for drift in fallback
        const expectedTime = lastTickTime + delayForSetTimeout;
        const currentTime = Date.now();
        delayForSetTimeout = Math.max(0, expectedTime - currentTime);
        lastTickTime = currentTime + delayForSetTimeout; // Predicted next tick time
    }

    timerId = setTimeout(metronomeTick, delayForSetTimeout);
}

const MetronomeEngine = {
    togglePlay: async () => { // Make togglePlay async
        const wasPlaying = AppState.isPlaying();
        // AppState.togglePlay() will return false if trying to start with no bars,
        // or if playback is stopped. This is used below to set button text correctly.
        // AppState.togglePlay() flips the isPlaying state and handles
        // core state resets (currentBar, currentBeat, audioContext resume, nextBeatAudioContextTime).
        const isNowPlaying = await AppState.togglePlay(); // Await the result

        if (isNowPlaying) {
            // Engine-specific actions when playback STARTS
            DOM.startStopBtn.textContent = "STOP";
            DOM.startStopBtn.classList.add('active');

            // Only clear highlights if it *just* started. If it was already playing (which togglePlay handles),
            // highlights are managed by the tick.
            if (!wasPlaying) {
                BarDisplayController.clearAllHighlights();
            }

            // AudioContext is resumed and nextBeatTime set by AppState.togglePlay() if it started.
            // Initialize fallback timer if necessary (if no audioContext)
            if (!AppState.getAudioContext()) {
                lastTickTime = Date.now();
            }
            metronomeTick(); // Start the engine's tick loop
        } else {
            // Engine-specific actions when playback STOPS
            clearTimeout(timerId);
            timerId = null;
            DOM.startStopBtn.textContent = "START";
            DOM.startStopBtn.classList.remove('active');
            BarDisplayController.clearAllHighlights(); // Ensure all highlights are cleared on stop

            // Pause and reset HTML5 audio elements
            clickSound.pause();
            clickSound.currentTime = 0;
            accentClickSound.pause();
            accentClickSound.currentTime = 0;
            // Web Audio API sounds stop themselves once played.
        }
    }
};

export default MetronomeEngine;