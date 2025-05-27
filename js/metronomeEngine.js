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

function performEngineStopActions() {
    clearTimeout(timerId);
    timerId = null;
    if (DOM.startStopBtn) {
        DOM.startStopBtn.textContent = "START";
        DOM.startStopBtn.classList.remove('active');
    }
    BarDisplayController.clearAllHighlights();
    clickSound.pause(); clickSound.currentTime = 0;
    accentClickSound.pause(); accentClickSound.currentTime = 0;
    // console.log("Metronome engine stopped internally.");
}

function metronomeTick() {
    if (!AppState.isPlaying()) { // AppState is the source of truth for playback state
        performEngineStopActions(); // Clean up engine if AppState says we're stopped
        return;
    }

    const tempo = AppState.getTempo();
    const beatMultiplier = AppState.getBeatMultiplier();
    const secondsPerMainBeat = 60.0 / tempo;
    const secondsPerSubBeat = secondsPerMainBeat / beatMultiplier;

    let delayForSetTimeout;
    const audioContext = AppState.getAudioContext();

    if (audioContext && audioContext.state === 'running' && AppState.getClickSoundBuffer() && AppState.getAccentSoundBuffer()) {
        // Check for invalid state before scheduling.
        // If AppState.advanceBeat() returns false (e.g. no bars), it also sets isPlaying = false.
        // The next tick will then call performEngineStopActions().
        if (AppState.getBarSettings().length === 0 || AppState.getCurrentBar() >= AppState.getBarSettings().length) {
            console.warn("Metronome tick in invalid bar state. Stopping.");
            AppState.resetPlaybackState(); // Synchronously set isPlaying to false
            performEngineStopActions(); // Stop immediately
            return;
        }

        // Schedule beats that are due within the scheduleAheadTime window
        while (AppState.getNextBeatAudioContextTime() < audioContext.currentTime + AppState.SCHEDULE_AHEAD_TIME) {
            performCurrentBeatActions();
            if (!AppState.advanceBeat()) break; // Stop scheduling if advanceBeat fails (e.g., no bars left)
            AppState.incrementNextBeatAudioContextTime(secondsPerSubBeat);
        }
        // Calculate delay until the next time we need to check for scheduling
        delayForSetTimeout = Math.max(0, (AppState.getNextBeatAudioContextTime() - audioContext.currentTime - (AppState.SCHEDULE_AHEAD_TIME / 2)) * 1000);
        // Fallback to a shorter interval if calculated delay is too long or negative
        if (delayForSetTimeout <= 0 || delayForSetTimeout > (AppState.SCHEDULE_AHEAD_TIME * 1000)) { // Compare with scheduleAheadTime itself
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
        const wasPlayingBeforeToggle = AppState.isPlaying();

        // AppState.togglePlay() is the authority for changing play state and handling
        // AudioContext resume, priming, and initial nextBeatAudioContextTime.
        const isNowPlaying = await AppState.togglePlay(); // Await the result

        if (isNowPlaying) {
            // Engine-specific actions when playback STARTS
            if (DOM.startStopBtn) {
                DOM.startStopBtn.textContent = "STOP";
                DOM.startStopBtn.classList.add('active');
            }

            if (!wasPlayingBeforeToggle) { // Only clear highlights if it *just* started.
                BarDisplayController.clearAllHighlights();
            }

            // Initialize fallback timer if necessary (if no audioContext or not running)
            const audioContext = AppState.getAudioContext();
            if (!audioContext || audioContext.state !== 'running') {
                lastTickTime = Date.now();
            }
            metronomeTick(); // Start the engine's tick loop
        } else {
            // Engine-specific actions when playback STOPS (or failed to start)
            performEngineStopActions(); // AppState.togglePlay already set isPlaying to false
        }
    }
};

export default MetronomeEngine;