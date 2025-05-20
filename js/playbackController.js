/**
 * playbackController.js
 * This module handles UI interactions for playback control (e.g., start/stop).
 */

import DOM from './domSelectors.js';
import MetronomeEngine from './metronomeEngine.js';

const PlaybackController = {
    initializePlaybackControls: () => {
        DOM.startStopBtn.addEventListener('click', () => MetronomeEngine.togglePlay());
    }
};

export default PlaybackController;