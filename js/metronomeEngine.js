/**
 * metronomeEngine.js
 * This module contains the core metronome timing, playback control, and audio handling.
 * This corrected version manages independent scheduling for each track.
 */

import AppState from './appState.js';
import DOM from './domSelectors.js';
import ThemeController from './themeController.js';
import BarDisplayController from './barDisplayController.js';
import SoundSynth from './soundSynth.js';
import { sendState } from './webrtc.js';
import AudioController from './audioController.js';

let metronomeWorker = new Worker('js/metronomeWorker.js');
let drawFrameId = null; // Holds the requestAnimationFrame ID for the visual loop
let isPageVisible = true;
let visualQueue = []; // Queue for visual events

metronomeWorker.onmessage = function(e) {
    if (e.data === "tick") {
        scheduler();
    }
};

document.addEventListener('visibilitychange', () => {
    isPageVisible = document.visibilityState === 'visible';
    if (AppState.isPlaying()) {
        if (isPageVisible) {
            // Page became visible: Start drawing loop
            if (!drawFrameId) {
                draw();
            }
        } else {
            // Page is not visible
            if (!AppState.isWakeLockEnabled()) {
                // If wake lock is not enabled, stop the metronome completely
                MetronomeEngine.togglePlay();
            } else {
                // If wake lock IS enabled, we do nothing.
                // The worker keeps ticking, scheduler keeps running (on main thread), audio keeps playing.
                // We just stop the visual loop (handled below by draw() checking isPageVisible, 
                // or we can explicitly cancel it here to be cleaner).
                if (drawFrameId) {
                    cancelAnimationFrame(drawFrameId);
                    drawFrameId = null;
                }
            }
        }
    }
});

function playBeatSound(track, beatTime) {
    const audioContext = AppState.getAudioContext();
    const isAnySoloed = AppState.isAnyTrackSoloed();
    const canPlay = !isAnySoloed ? !track.muted : track.solo;

    if (!audioContext || audioContext.state !== 'running' || !track || !canPlay) {
        return;
    }

    const currentBarData = track.barSettings[track.currentBar];

    // Check for rests
    if (currentBarData.rests && currentBarData.rests.includes(track.currentBeat)) {
        return; // Skip playing the sound for rested beats
    }

    const beatMultiplier = parseFloat(currentBarData.subdivision);
    const isAccent = (track.currentBeat === 0) || (beatMultiplier > 1 && track.currentBeat % beatMultiplier === 0);

    const soundObject = isAccent ? track.mainBeatSound : track.subdivisionSound;
    const soundToPlay = soundObject.sound; // Extract the sound name string

    // Calculate final volume by combining global, track, and individual sound volumes
    const trackVolume = track.volume !== undefined ? track.volume : 1.0;
    const soundVolume = soundObject.settings && soundObject.settings.volume !== undefined ? soundObject.settings.volume : 1.0;
    const finalVolume = AppState.getVolume() * trackVolume * soundVolume;

    const destination = track.analyserNode || audioContext.destination;

    // Check if the sound is a synth sound
    if (soundToPlay && soundToPlay.startsWith('Synth')) {
        const synthFunctionName = `play${soundToPlay.replace('Synth ', '').replace(/ /g, '')}`;
        
        // Dynamically call the synth function if it exists
        if (SoundSynth[synthFunctionName]) {
            // The individual sound's volume has been factored in. Now, set the final combined volume for the synth function.
            const settingsWithVolume = { ...soundObject.settings, volume: finalVolume };
            // Pass the entire settings object to the synth function
            SoundSynth[synthFunctionName](audioContext, beatTime, settingsWithVolume, destination);
        } else {
            console.warn(`Synth function ${synthFunctionName} not found in SoundSynth.`);
        }
    } else {
        // Play file-based or recorded sounds using AudioController
        const { trimStart, trimEnd, pitchShift } = soundObject.settings || {};
        AudioController.playRecording(soundToPlay, soundObject.settings, trimStart, trimEnd, beatTime, finalVolume, destination);
    }
}

function advanceTrackBeat(track) {
    if (!track || track.barSettings.length === 0) {
        return;
    }
    const currentBarData = track.barSettings[track.currentBar];
    const totalSubBeatsInBar = currentBarData.beats * currentBarData.subdivision;

    track.currentBeat++;
    if (track.currentBeat >= totalSubBeatsInBar) {
        track.currentBeat = 0;
        track.currentBar++;
        if (track.currentBar >= track.barSettings.length) {
            track.currentBar = 0; // Loop back
        }
    }
}

function scheduler() {
    // If we managed to get a tick while stopped (race condition), ignore it.
    if (!AppState.isPlaying()) {
        return;
    }

    // Double check visibility/wakelock in case the visibility event fired 
    // but a tick was already queued.
    if (!isPageVisible && !AppState.isWakeLockEnabled()) {
        MetronomeEngine.togglePlay();
        return;
    }

    const audioContext = AppState.getAudioContext();
    const allTracks = AppState.getTracks();

    if (audioContext && audioContext.state === 'running') {
        allTracks.forEach((track, trackIndex) => {
            if (track.barSettings.length === 0) return;

            const tempo = AppState.getTempo();
            const secondsPerMainBeat = 60.0 / tempo;
            const currentBarData = track.barSettings[track.currentBar];
            const beatMultiplier = parseFloat(currentBarData ? currentBarData.subdivision : 1);
            
            let secondsPerSubBeat = secondsPerMainBeat;
            if (beatMultiplier >= 1) {
                secondsPerSubBeat = secondsPerMainBeat / beatMultiplier;
            } else {
                secondsPerSubBeat = secondsPerMainBeat * (1 / beatMultiplier);
            }

            while (track.nextBeatTime < audioContext.currentTime + AppState.SCHEDULE_AHEAD_TIME) {
                playBeatSound(track, track.nextBeatTime);
                
                // Push visual event to queue
                visualQueue.push({
                    time: track.nextBeatTime,
                    trackIndex,
                    bar: track.currentBar,
                    beat: track.currentBeat
                });
                
                advanceTrackBeat(track);
                track.nextBeatTime += secondsPerSubBeat;
            }
        });
    }
}

function draw() {
    if (!AppState.isPlaying() || !isPageVisible) {
        drawFrameId = null;
        return;
    }

    const audioContext = AppState.getAudioContext();
    const currentTime = audioContext.currentTime;

    while (visualQueue.length && visualQueue[0].time <= currentTime) {
        const event = visualQueue.shift();
        
        // Skip events that are too old (e.g., > 100ms lag) to prevent strobe effect on resume
        if (currentTime - event.time < 0.1) {
             BarDisplayController.updateBeatHighlight(event.trackIndex, event.bar, event.beat, true);
        }
    }

    drawFrameId = requestAnimationFrame(draw);
}

function performEngineStopActions() {
    metronomeWorker.postMessage("stop");
    
    if (drawFrameId) {
        cancelAnimationFrame(drawFrameId);
        drawFrameId = null;
    }
    visualQueue = []; // Clear the visual queue

    if (DOM.startStopBtn) {
        DOM.startStopBtn.textContent = "▶";
        DOM.startStopBtn.classList.remove('active');
    }
    BarDisplayController.clearAllHighlights();

    if (ThemeController.is3DSceneActive()) {
        ThemeController.clearAll3DVisualHighlights();
    }
}

const MetronomeEngine = {
    togglePlay: async () => {
        const wasPlayingBeforeToggle = AppState.isPlaying();
        const isNowPlaying = await AppState.togglePlay();

        sendState(AppState.getCurrentStateForPreset());

        if (isNowPlaying) {
            if (DOM.startStopBtn) {
                DOM.startStopBtn.textContent = "■";
                DOM.startStopBtn.classList.add('active');
            }

            if (!wasPlayingBeforeToggle) {
                BarDisplayController.clearAllHighlights();
            }

            metronomeWorker.postMessage("start");
            
            if (isPageVisible) {
                if (!drawFrameId) {
                    draw();
                }
            }
        } else {
            performEngineStopActions();
        }
        return isNowPlaying;
    },

    isPlaying: () => {
        return AppState.isPlaying();
    }
};

export default MetronomeEngine;