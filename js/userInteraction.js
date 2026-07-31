
/**
 * userInteraction.js
 * This module is responsible for handling the first user interaction to ensure
 * the AudioContext is properly initialized and resumed, especially on iOS.
 */

import AppState from './appState.js';
import Oscilloscope from './oscilloscope.js';

function configureAudioSession() {
    // iOS 16.4+: without this, Web Audio is silenced by the hardware
    // ring/silent switch even after a successful resume().
    try {
        if (navigator.audioSession && navigator.audioSession.type !== 'playback') {
            navigator.audioSession.type = 'playback';
        }
    } catch (e) {
        console.warn('Could not configure audio session:', e);
    }
}

function playSilentUnlockBuffer(audioContext) {
    // iOS fully unlocks audio output only after a source node actually plays
    // inside a user gesture. A one-sample silent buffer is inaudible.
    try {
        const buffer = audioContext.createBuffer(1, 1, audioContext.sampleRate);
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);
        source.start(0);
    } catch (e) {
        console.warn('Silent unlock buffer failed:', e);
    }
}

const UserInteraction = {
    /**
     * A flag to ensure the audio context is initialized only once.
     * Only set once the context has actually reached the 'running' state.
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

        configureAudioSession();

        let audioContext = AppState.getAudioContext();
        if (!audioContext) {
            audioContext = AppState.initializeAudioContext();
        }
        if (!audioContext) return;

        // iOS uses 'interrupted' (calls, Siri, backgrounding) in addition to
        // 'suspended'; both need an explicit resume from a user gesture.
        if (audioContext.state !== 'running') {
            try {
                await audioContext.resume();
                console.log(`AudioContext resume attempted, state: ${audioContext.state}`);
            } catch (e) {
                console.error('Error resuming AudioContext:', e);
            }
        }

        playSilentUnlockBuffer(audioContext);

        if (audioContext.state === 'running') {
            UserInteraction.audioContextInitialized = true;
            Oscilloscope.start();
            UserInteraction.watchForInterruptions(audioContext);
        }
        // If still not running, keep the flag false so the next tap retries.
    },

    /**
     * iOS suspends/interrupts the context on phone calls, Siri, or switching
     * apps. Recover automatically on the next opportunity.
     */
    interruptionWatcherAttached: false,
    watchForInterruptions: (audioContext) => {
        if (UserInteraction.interruptionWatcherAttached) return;
        UserInteraction.interruptionWatcherAttached = true;

        const tryRecover = () => {
            const context = AppState.getAudioContext();
            if (context && context.state !== 'running' && !document.hidden) {
                context.resume().catch(() => {});
            }
        };
        audioContext.addEventListener?.('statechange', tryRecover);
        document.addEventListener('visibilitychange', tryRecover);
        // A resume outside a gesture can be rejected; also retry on touches.
        document.addEventListener('touchend', tryRecover, { passive: true });
        document.addEventListener('click', tryRecover);
    }
};

export default UserInteraction;
