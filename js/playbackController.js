/**
 * playbackController.js
 * This module is responsible for initializing the main playback controls,
 * primarily the start/stop button.
 */

import MetronomeEngine from './metronomeEngine.js';
import UserInteraction from './userInteraction.js';
import DOM from './domSelectors.js';
import AppState from './appState.js';

let wakeLock = null;

const acquireWakeLock = async () => {
    if ('wakeLock' in navigator) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => {
                console.log('Wake Lock was released');
            });
            console.log('Wake Lock is active!');
        } catch (err) {
            console.error(`${err.name}, ${err.message}`);
        }
    }
};

const handleVisibilityChange = () => {
    if (AppState.isPlaying() && AppState.isWakeLockEnabled() && document.visibilityState === 'visible') {
        acquireWakeLock();
    }
};

const releaseWakeLock = async () => {
    if (wakeLock !== null) {
        await wakeLock.release();
        wakeLock = null;
        console.log('Wake Lock is released!');
    }
};

document.addEventListener('visibilitychange', handleVisibilityChange);

const PlaybackController = {
    /**
     * Initializes the playback controls.
     * Attaches an event listener to the main start/stop button.
     */
    initializePlaybackControls: () => {
        if (DOM.startStopBtn) {
            DOM.startStopBtn.addEventListener('click', async () => {
                // Ensure the audio context is running before toggling play
                await UserInteraction.handleFirstInteraction();

                // When the button is clicked, call the togglePlay function from the engine
                const isPlaying = await MetronomeEngine.togglePlay();

                if (isPlaying && AppState.isWakeLockEnabled()) {
                    acquireWakeLock();
                } else {
                    releaseWakeLock();
                }
            });
        } else {
            console.error("Start/Stop button not found in DOM.");
        }
    }
};

export default PlaybackController;