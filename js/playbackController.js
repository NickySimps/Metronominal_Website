/**
 * playbackController.js
 * This module is responsible for initializing the main playback controls,
 * primarily the start/stop button.
 */

import MetronomeEngine from './metronomeEngine.js';
import UserInteraction from './userInteraction.js';
import DOM from './domSelectors.js';

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
                MetronomeEngine.togglePlay();
            });
        } else {
            console.error("Start/Stop button not found in DOM.");
        }
    }
};

export default PlaybackController;