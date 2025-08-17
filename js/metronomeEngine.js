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

let animationFrameId = null; // Holds the requestAnimationFrame ID for the scheduler loop

function playBeatSound(track, beatTime) {
    const audioContext = AppState.getAudioContext();
    const isAnySoloed = AppState.isAnyTrackSoloed();
    const canPlay = !isAnySoloed ? !track.muted : track.solo;

    if (!audioContext || audioContext.state !== 'running' || !track || !canPlay) {
        return;
    }

    const currentBarData = track.barSettings[track.currentBar];
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
        // Fallback to the original file-based sound logic
        const soundBuffer = AppState.getSoundBuffer(soundToPlay);
        if (soundBuffer) {
            const source = audioContext.createBufferSource();
            source.buffer = soundBuffer;
            const gainNode = audioContext.createGain();
            gainNode.gain.setValueAtTime(finalVolume, audioContext.currentTime);
            source.connect(gainNode);
            gainNode.connect(destination);
            source.start(beatTime);
        }
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
    if (!AppState.isPlaying()) {
        performEngineStopActions();
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
                const scheduledBeatInfo = {
                    trackIndex,
                    bar: track.currentBar,
                    beat: track.currentBeat
                };
                setTimeout(() => {
                    if(AppState.isPlaying()){
                        BarDisplayController.updateBeatHighlight(scheduledBeatInfo.trackIndex, scheduledBeatInfo.bar, scheduledBeatInfo.beat, true);
                    }
                }, (track.nextBeatTime - audioContext.currentTime) * 1000);
                
                advanceTrackBeat(track);
                track.nextBeatTime += secondsPerSubBeat;
            }
        });
    }

    animationFrameId = requestAnimationFrame(scheduler);
}

function performEngineStopActions() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    if (DOM.startStopBtn) {
        DOM.startStopBtn.textContent = "START";
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
                DOM.startStopBtn.textContent = "STOP";
                DOM.startStopBtn.classList.add('active');
            }

            if (!wasPlayingBeforeToggle) {
                BarDisplayController.clearAllHighlights();
            }

            if (!animationFrameId) {
                scheduler();
            }
        } else {
            performEngineStopActions();
        }
    },

    isPlaying: () => {
        return animationFrameId !== null;
    }
};

export default MetronomeEngine;