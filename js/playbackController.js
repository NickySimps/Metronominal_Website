/**
 * playbackController.js
 * This module is responsible for initializing the main playback controls,
 * primarily the start/stop button.
 */

import MetronomeEngine from './metronomeEngine.js';
import DOM from './domSelectors.js';
import { syncPlaybackState } from './webrtc.js';

const PlaybackController = {
    /**
     * Initializes the playback controls.
     * Attaches an event listener to the main start/stop button.
     */
    initializePlaybackControls: () => {
        if (DOM.startStopBtn) {
            DOM.startStopBtn.addEventListener('click', () => {
                // When the button is clicked, call the togglePlay function from the engine
                MetronomeEngine.togglePlay();
                if (window.isHost) {
                    syncPlaybackState();
                }
            });
        } else {
            console.error("Start/Stop button not found in DOM.");
        }
    }
};

export default PlaybackController;