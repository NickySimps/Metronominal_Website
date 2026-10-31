/**
 * playbackController.js
 * This module is responsible for initializing the main playback controls,
 * primarily the start/stop button.
 */

import MetronomeEngine from './metronomeEngine.js';
import UserInteraction from './userInteraction.js';
import DOM from './domSelectors.js';
import AppState from './appState.js';
import { emitInteractionMotion } from './interactionMotion.js';

let wakeLock = null;
let motionObserver = null;
let wakeFeedbackEpoch = 0;
let wakeFeedbackOwner = null;

const wakeFeedbackWanted = (epoch) => epoch === wakeFeedbackEpoch
    // Native permission can settle before the server applies requested Play.
    // This acknowledges only the native lock, never musical playback. Stop
    // invalidates this epoch independently of its eventual server ACK.
    && AppState.isWakeLockEnabled()
    && document.visibilityState === 'visible';

const acquireWakeLock = async () => {
    const epoch = ++wakeFeedbackEpoch;
    wakeFeedbackOwner = null;
    if ('wakeLock' in navigator) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            const owner = { sentinel: wakeLock };
            wakeLock.addEventListener('release', () => {
                console.log('Wake Lock was released');
                if (wakeFeedbackOwner === owner) {
                    wakeFeedbackOwner = null;
                    if (document.visibilityState === 'visible') emitInteractionMotion(DOM.screenOffToggleBtn, 'cancel');
                }
            });
            console.log('Wake Lock is active!');
            if (wakeFeedbackWanted(epoch) && !owner.sentinel.released) {
                wakeFeedbackOwner = owner;
                emitInteractionMotion(DOM.screenOffToggleBtn, 'ready');
            }
        } catch (err) {
            console.error(`${err.name}, ${err.message}`);

            if (wakeFeedbackWanted(epoch)) emitInteractionMotion(DOM.screenOffToggleBtn, 'refuse');
        }
    } else if (wakeFeedbackWanted(epoch)) {
        emitInteractionMotion(DOM.screenOffToggleBtn, 'refuse');
    }
};

const handleVisibilityChange = () => {
    if (AppState.isPlaying() && AppState.isWakeLockEnabled() && document.visibilityState === 'visible') {
        acquireWakeLock();
    }
};

const releaseWakeLock = async () => {
    const epoch = ++wakeFeedbackEpoch;
    const sentinel = wakeLock;
    const owner = wakeFeedbackOwner;
    if (wakeLock !== null) {
        try { await wakeLock.release(); }
        catch (error) {
            // A deferred refusal belongs to this sentinel and feedback lifetime,
            // never to a newer acquisition that replaced the mutable wakeLock.
            if (wakeFeedbackWanted(epoch) && owner?.sentinel === sentinel && wakeFeedbackOwner === owner) {
                emitInteractionMotion(DOM.screenOffToggleBtn, 'refuse');
            }
            throw error;
        }
        wakeLock = null;
        console.log('Wake Lock is released!');
    }
};

document.addEventListener('visibilitychange', handleVisibilityChange);

const PlaybackController = {
    disposeMotionFeedback: () => {
        ++wakeFeedbackEpoch;
        wakeFeedbackOwner = null;
        if (motionObserver) {
            motionObserver.disconnect();
            motionObserver = null;
        }
    },

    /**
     * Initializes the playback controls.
     * Attaches an event listener to the main start/stop button.
     */
    initializePlaybackControls: () => {
        PlaybackController.disposeMotionFeedback();

        if (DOM.startStopBtn) {
            if (typeof MutationObserver === 'function') {
                let wasActive = DOM.startStopBtn.classList.contains('active');
                motionObserver = new MutationObserver(() => {
                    const isActive = Boolean(DOM.startStopBtn?.classList?.contains('active'));
                    if (isActive === wasActive) {
                        return;
                    }
                    wasActive = isActive;
                    emitInteractionMotion(DOM.startStopBtn, isActive ? 'play' : 'stop');
                });
                motionObserver.observe(DOM.startStopBtn, {
                    attributes: true,
                    attributeFilter: ['class']
                });
            }

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
