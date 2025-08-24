
/**
 * userInteraction.js
 * This module is responsible for handling the first user interaction to ensure
 * the AudioContext is properly initialized and resumed, especially on iOS.
 */

import AppState from './appState.js';

const UserInteraction = {
    /**
     * A flag to ensure the audio context is initialized only once.
     */
    audioContextInitialized: false,

    /**
     * Initializes the AudioContext after the first user gesture.
     * This is crucial for browser compatibility, especially on iOS.
     */
    handleFirstInteraction: async () => {
        if (UserInteraction.audioContextInitialized) {
            return;
        }

        let audioContext = AppState.getAudioContext();
        if (!audioContext) {
            audioContext = AppState.initializeAudioContext();
        }

        if (audioContext && audioContext.state === 'suspended') {
            try {
                await audioContext.resume();
                console.log("AudioContext resumed successfully.");
            } catch (e) {
                console.error("Error resuming AudioContext:", e);
            }
        }

        UserInteraction.audioContextInitialized = true;
    }
};

export default UserInteraction;
