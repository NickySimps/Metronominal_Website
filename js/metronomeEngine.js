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
import { sendState, broadcastScheduledPlay, broadcastStop, requestPlaybackSync, broadcastSyncPulse, getDesiredHostPlaybackState } from './webrtc.js';
import AudioController from './audioController.js';
import MidiController from './midiController.js';
import { createSoundFilterInput } from './audioEffects.js';

let metronomeWorker = new Worker('js/metronomeWorker.js');
let metronomeWorkerReady = false;
let drawFrameId = null; // Holds the requestAnimationFrame ID for the visual loop
let isPageVisible = true;
let visualQueue = []; // Queue for visual events
const countInSources = new Set();
let lastSyncPulseTime = 0;
const SYNC_PULSE_INTERVAL = 2000; // Broadcast sync pulse every 2 seconds

metronomeWorker.onmessage = function(e) {
    if (e.data === "ready") {
        metronomeWorkerReady = true;
        return;
    }
    if (e.data === "tick") {
        scheduler();
    }
};
metronomeWorker.onerror = () => { metronomeWorkerReady = false; };

document.addEventListener('visibilitychange', () => {
    isPageVisible = document.visibilityState === 'visible';
    if (AppState.isPlaying()) {
        if (isPageVisible) {
            visualQueue = []; // Clear stale background events
            if (!drawFrameId) {
                draw();
            }
        } else {
            if (!AppState.isWakeLockEnabled()) {
                MetronomeEngine.togglePlay();
            } else {
                if (drawFrameId) {
                    cancelAnimationFrame(drawFrameId);
                    drawFrameId = null;
                }
            }
        }
    }
});

function getTrackSwingOffsetSec(track) {
  if (!track || !track.swing || track.swing <= 0) return 0;
  const currentBarData = track.barSettings[track.currentBar];
  if (!currentBarData) return 0;

  const tempo = AppState.getPlaybackTempo ? AppState.getPlaybackTempo(track.currentBar) : AppState.getTempo();
  const secondsPerMainBeat = 60.0 / tempo;
  const sub = parseFloat(currentBarData.subdivision || 1);
  const secondsPerBeatUnit = sub >= 1
    ? secondsPerMainBeat / sub
    : secondsPerMainBeat * (1 / sub);

  let isOffBeat = false;
  if (sub >= 3 && Math.round(sub) % 3 === 0) {
    // Triplet / Compound subdivision: 2nd note in each triplet group
    isOffBeat = (track.currentBeat % 3 === 1);
  } else {
    // Standard beats (sub = 1) or even subdivisions (2, 4, 8, 16): odd indices (1, 3, 5, 7...)
    isOffBeat = (track.currentBeat % 2 === 1);
  }

  if (!isOffBeat) return 0;
  // Swing range: 0% to 100% -> delay up to 50% of the beat unit duration
  return (track.swing / 100.0) * (secondsPerBeatUnit * 0.5);
}

const activeSynthVoices = new Map();

function playBeatSound(track, beatTime, trackIndex = 0) {
    const audioContext = AppState.getAudioContext();
    const isAnySoloed = AppState.isAnyTrackSoloed();
    const canPlay = !isAnySoloed ? !track.muted : track.solo;

    if (!audioContext || audioContext.state !== 'running' || !track || !canPlay) {
        return;
    }

    const currentBarData = track.barSettings[track.currentBar];
    if (!currentBarData) return;

    const beatIndex = track.currentBeat;
    const rests = currentBarData.rests || [];
    if (rests.includes(beatIndex)) {
        return; // It's a rest
    }

    const beatMultiplier = parseFloat(currentBarData.subdivision || 1);
    const isAccent = (beatIndex === 0) || (beatMultiplier > 1 && beatIndex % beatMultiplier === 0);

    const soundObject = isAccent ? track.mainBeatSound : track.subdivisionSound;
    if (!soundObject || !soundObject.sound) return;

    const probability = Number(soundObject.settings?.probability);
    if (!MetronomeEngine.shouldPlayProbability(probability, Math.random())) return;

    const soundToPlay = soundObject.sound;
    const defaultVel = isAccent ? 1.0 : 0.7;
    const velocities = currentBarData.velocities || {};
    const beatVelocity = velocities[beatIndex] !== undefined ? velocities[beatIndex] : defaultVel;

    const trackVolume = track.volume !== undefined ? track.volume : 1.0;
    const soundVolume = soundObject.settings && soundObject.settings.volume !== undefined ? soundObject.settings.volume : 1.0;
    const finalVolume = AppState.getVolume() * trackVolume * soundVolume * beatVelocity;

    const destination = isAccent
        ? (track.mainAnalyserNode || track.analyserNode || audioContext.destination)
        : (track.subdivisionAnalyserNode || track.analyserNode || audioContext.destination);

    let baseSoundName = soundToPlay;
    const customSoundData = AppState.getCustomSoundData(soundToPlay);
    if (customSoundData) {
        baseSoundName = customSoundData.baseSound;
    }

    if (!baseSoundName) return;

    const trackPitchShift = track.pitchShift || 0;
    const soundSettings = soundObject.settings || {};
    const effectivePitchShift = (soundSettings.pitchShift || 0) + trackPitchShift;

    const latencyOffsetSec = (AppState.getLatencyOffset ? AppState.getLatencyOffset() : 0) / 1000.0;
    const actualBeatTime = Math.max(audioContext.currentTime, beatTime + latencyOffsetSec);

    const mergedSettings = {
        ...soundSettings,
        volume: finalVolume,
        pitchShift: effectivePitchShift,
        voiceKey: `${trackIndex}:${isAccent ? 'main' : 'sub'}:${soundToPlay}`,
    };

    if (baseSoundName && baseSoundName.startsWith('Synth')) {
        const synthFunctionName = `play${baseSoundName.replace('Synth ', '').replace(/ /g, '')}`;
        if (SoundSynth[synthFunctionName]) {
            const synthVoiceKey = mergedSettings.voiceKey;
            const previousVoice = activeSynthVoices.get(synthVoiceKey);
            const attack = Number.isFinite(Number(soundSettings.attack)) ? Number(soundSettings.attack) : 0.01;
            const decay = Number.isFinite(Number(soundSettings.decay)) ? Number(soundSettings.decay) : 0.1;
            const release = Number.isFinite(Number(soundSettings.release)) ? Number(soundSettings.release) : 0.1;
            const voiceDuration = Math.max(0.1, attack + decay + release + 0.1);
            if (previousVoice && actualBeatTime < previousVoice.endTime) {
                if (soundSettings.retrigger === false) return;
                if (soundSettings.allowOverlap === false) {
                    previousVoice.gain.gain.cancelScheduledValues(actualBeatTime);
                    previousVoice.gain.gain.setValueAtTime(0, actualBeatTime);
                }
            }
            const synthVoiceGain = audioContext.createGain();
            synthVoiceGain.gain.setValueAtTime(1, actualBeatTime);
            synthVoiceGain.connect(createSoundFilterInput(audioContext, destination, mergedSettings));
            SoundSynth[synthFunctionName](audioContext, actualBeatTime, mergedSettings, synthVoiceGain);
            activeSynthVoices.set(synthVoiceKey, {
                endTime: actualBeatTime + voiceDuration,
                gain: synthVoiceGain,
            });
        } else {
            console.warn(`Synth function ${synthFunctionName} not found in SoundSynth.`);
        }
    } else {
        const { trimStart, trimEnd } = soundSettings;
        AudioController.playRecording(baseSoundName, mergedSettings, trimStart, trimEnd, actualBeatTime, finalVolume, destination);
    }

    if (trackIndex === 0) {
        MidiController.sendMidiClock();
    }
}

function calculateTotalSubBeats(mainBeatsInBar, subdivision) {
  const subdivisionFloat = parseFloat(subdivision);
  if (subdivisionFloat < 1) {
    return Math.max(1, Math.floor(mainBeatsInBar * subdivisionFloat));
  }
  return Math.round(mainBeatsInBar * subdivisionFloat);
}

function advanceTrackBeat(track) {
    if (!track || track.barSettings.length === 0) {
        return;
    }
    const currentBarData = track.barSettings[track.currentBar];
    const totalSubBeatsInBar = calculateTotalSubBeats(currentBarData.beats, currentBarData.subdivision);

    track.currentBeat++;
    if (track.currentBeat >= totalSubBeatsInBar) {
        track.currentBeat = 0;
        const abLoop = AppState.getAbLoop ? AppState.getAbLoop() : null;
        if (abLoop && abLoop.enabled && track.barSettings.length > 1) {
            const start = Math.max(0, Math.min(abLoop.startBar, track.barSettings.length - 1));
            const end = Math.max(start, Math.min(abLoop.endBar, track.barSettings.length - 1));
            let nextBar = track.currentBar + 1;
            if (nextBar > end || nextBar < start) {
                nextBar = start;
            }
            track.currentBar = nextBar;
        } else {
            const nextPosition = AppState.getNextSongPosition(
                track.currentBar,
                track.songRepeatIteration || 0,
                track.barSettings.length
            );
            track.currentBar = nextPosition.bar;
            track.songRepeatIteration = nextPosition.repeatIteration;
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
        const primaryTrack = allTracks[0];
        const tempoSegments = [{ time: Number.NEGATIVE_INFINITY, tempo: AppState.getPlaybackTempo(primaryTrack?.currentBar || 0) }];
        allTracks.forEach((track, trackIndex) => {
            if (track.barSettings.length === 0) return;

            while (track.nextBeatTime < audioContext.currentTime + AppState.SCHEDULE_AHEAD_TIME) {
                let tempo;
                if (trackIndex === 0) {
                    tempo = AppState.getPlaybackTempo(track.currentBar);
                    if (tempoSegments[tempoSegments.length - 1].tempo !== tempo) {
                        tempoSegments.push({ time: track.nextBeatTime, tempo });
                    }
                } else {
                    tempo = tempoSegments[0].tempo;
                    for (const segment of tempoSegments) {
                        if (segment.time > track.nextBeatTime) break;
                        tempo = segment.tempo;
                    }
                }
                const secondsPerMainBeat = 60.0 / tempo;
                const currentBarData = track.barSettings[track.currentBar];
                const beatMultiplier = parseFloat(currentBarData ? currentBarData.subdivision : 1);
                const secondsPerSubBeat = beatMultiplier >= 1
                    ? secondsPerMainBeat / beatMultiplier
                    : secondsPerMainBeat * (1 / beatMultiplier);
                // Only play sound and schedule visuals if the beat is within a reasonable window (not >250ms in the past)
                // This prevents "machine gun" bursts when syncing catches up from a late start or large drift.
                if (track.nextBeatTime > audioContext.currentTime - 0.25) {
                    const swingOffset = getTrackSwingOffsetSec(track);
                    const swungBeatTime = track.nextBeatTime + swingOffset;

                    playBeatSound(track, swungBeatTime, trackIndex);
                    
                    // Push visual event to queue only if page is visible
                    if (isPageVisible) {
                        visualQueue.push({
                            time: swungBeatTime,
                            trackIndex,
                            bar: track.currentBar,
                            beat: track.currentBeat
                        });
                    }
                }
                
                // Host Sync Pulse: Broadcast expected wall time for this beat
                if (window.isHost && trackIndex === 0 && (Date.now() - lastSyncPulseTime > SYNC_PULSE_INTERVAL)) {
                    // We calculate what wall time corresponds to track.nextBeatTime
                    // Relation: WallTime = Date.now() + (AudioTime - AudioCtx.currentTime)*1000
                    const timeToBeat = track.nextBeatTime - audioContext.currentTime;
                    const wallTime = Date.now() + (timeToBeat * 1000);
                    broadcastSyncPulse(wallTime, track.currentBar, track.currentBeat, track.songRepeatIteration || 0);
                    lastSyncPulseTime = Date.now();
                }
                
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
        
        // Skip events that are too old (e.g., > 250ms lag) to prevent strobe effect on resume
        if (currentTime - event.time < 0.25) {
             BarDisplayController.updateBeatHighlight(event.trackIndex, event.bar, event.beat, true);
             if (event.trackIndex === 0 && event.beat === 0) {
                 document.dispatchEvent(new CustomEvent('songpositionchange', { detail: { bar: event.bar } }));
             }
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
        DOM.startStopBtn.classList.remove('active', 'pending');
    }
    BarDisplayController.clearAllHighlights();

    if (ThemeController.is3DSceneActive()) {
        ThemeController.clearAll3DVisualHighlights();
    }
    
    if (MetronomeEngine.onPlayStateChange) {
        MetronomeEngine.onPlayStateChange(false);
    }
    MidiController.sendMidiStop();
}

const MetronomeEngine = {
    shouldPlayProbability: (probability, roll) => {
        if (!Number.isFinite(probability)) return true;
        if (probability <= 0) return false;
        if (probability >= 100) return true;
        return roll * 100 < probability;
    },
    cancelCountIn: () => {
        for (const source of countInSources) {
            try { source.stop(); } catch (_error) { /* The source may already have ended. */ }
        }
        countInSources.clear();
    },

    scheduleCountIn: async (countIn, shouldSchedule = () => true) => {
        const audioContext = AppState.getAudioContext();
        if (!audioContext || !countIn || !shouldSchedule()) return;
        if (audioContext.state === 'suspended') await audioContext.resume();
        if (audioContext.state !== 'running' || !shouldSchedule()) return;

        const firstClickAudioTime = audioContext.currentTime + ((countIn.startsAt - Date.now()) / 1000);
        for (let beat = 0; beat < countIn.totalBeats; beat += 1) {
            const clickTime = firstClickAudioTime + ((beat * countIn.beatIntervalMs) / 1000);
            if (clickTime < audioContext.currentTime + 0.005) continue;
            const source = audioContext.createOscillator();
            const gain = audioContext.createGain();
            const isAccent = beat % countIn.accentEvery === 0;
            source.frequency.setValueAtTime(isAccent ? 1760 : 1320, clickTime);
            gain.gain.setValueAtTime(0.0001, clickTime);
            gain.gain.exponentialRampToValueAtTime(Math.max(0.01, AppState.getVolume() * (isAccent ? 0.35 : 0.22)), clickTime + 0.002);
            gain.gain.exponentialRampToValueAtTime(0.0001, clickTime + 0.04);
            source.connect(gain);
            gain.connect(audioContext.destination);
            countInSources.add(source);
            source.onended = () => countInSources.delete(source);
            source.start(clickTime);
            source.stop(clickTime + 0.045);
        }
    },

    onPlayStateChange: null,

    registerPlayStateChangeListener: (callback) => {
        MetronomeEngine.onPlayStateChange = callback;
    },

    /**
     * Toggles playback.
     * @param {boolean} forceStop - If true, ensures playback stops regardless of current state.
     */
    togglePlay: async (forceStop = false) => {
        const wasPlayingBeforeToggle = AppState.isPlaying();
        
        // The synchronization server assigns one timestamp and echoes it to every peer,
        // including the host. Do not start or stop locally before that authoritative message.
        if (window.isHost && !forceStop) {
            const desiredPlaybackState = !getDesiredHostPlaybackState();
            if (desiredPlaybackState) {
                const commandSent = broadcastScheduledPlay();
                if (commandSent) {
                    sendState(AppState.getCurrentStateForPreset(true));
                    return true;
                }
            } else if (broadcastStop()) {
                return false;
            }
        } else if (!window.isHost && !forceStop) {
            // Joined clients follow the host and cannot create a divergent local transport state.
            requestPlaybackSync();
            return wasPlayingBeforeToggle;
        }

        // Standard Toggle Logic (offline host fallback or an authoritative forced stop).
        const isNowPlaying = await AppState.togglePlay();

        // If forceStop is true and we are still playing, toggle again to stop
        if (forceStop && isNowPlaying) {
             await AppState.togglePlay();
             performEngineStopActions();
             return false;
        }

        sendState(AppState.getCurrentStateForPreset(true));

        if (isNowPlaying) {
            if (DOM.startStopBtn) {
                DOM.startStopBtn.textContent = "■";
                DOM.startStopBtn.classList.remove('pending');
                DOM.startStopBtn.classList.add('active');
            }

            if (!wasPlayingBeforeToggle) {
                BarDisplayController.clearAllHighlights();
            }

            metronomeWorker.postMessage("start");
            MidiController.sendMidiStart();
            
            if (isPageVisible) {
                if (!drawFrameId) {
                    draw();
                }
            }
            if (MetronomeEngine.onPlayStateChange) {
                MetronomeEngine.onPlayStateChange(true);
            }
        } else {
            performEngineStopActions();
        }
        return isNowPlaying;
    },

    scheduleStart: async (targetTimestamp, startBar = 0, startBeat = 0, repeatIteration = 0, shouldStart = () => true) => {
        const audioContext = AppState.getAudioContext();
        if (audioContext && audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        if (!shouldStart()) return;

        // Manually start AppState logic without toggling (since we are setting specific times)
        // Or we can use togglePlay logic but override the nextBeatTime.
        // Let's manually set it to be precise.
        
        // 1. Set playing state
        // We can use a trick: call AppState.togglePlay(), then immediately overwrite nextBeatTime
        if (!AppState.isPlaying()) {
            const isPlaying = await AppState.togglePlay();
            if (!shouldStart()) return;
            if (!isPlaying) return; // Exit if AppState refused to play (e.g. no tracks)
        }

        if (!shouldStart()) return;

        // 2. Calculate delay until target time
        const now = Date.now();
        const delaySeconds = (targetTimestamp - now) / 1000;
        // Allow startAudioTime to be in the past (negative delay) to preserve grid alignment
        const startAudioTime = audioContext.currentTime + delaySeconds;

        // 3. Overwrite nextBeatTime for all tracks
        const allTracks = AppState.getTracks();
        allTracks.forEach(track => {
            if (!track.barSettings.length) return;
            track.currentBar = startBar % track.barSettings.length;
            track.songRepeatIteration = Math.max(0, Math.min(Number.parseInt(repeatIteration, 10) || 0, 15));
            const startBarData = track.barSettings[track.currentBar];
            const beatsInBar = Math.max(1, Math.ceil(startBarData.beats * startBarData.subdivision));
            track.currentBeat = startBeat % beatsInBar;
            
            // Fast-forward if we are late
            let trackStartTime = startAudioTime;
            
            // Safety break counter to prevent infinite loops if something goes wrong
            let loops = 0;
            while (trackStartTime < audioContext.currentTime + 0.05 && loops < 1000) {
                if (track.barSettings.length === 0) break;
                
                const currentBarData = track.barSettings[track.currentBar];
                const beatMultiplier = parseFloat(currentBarData ? currentBarData.subdivision : 1);
                const secondsPerMainBeat = 60.0 / AppState.getPlaybackTempo(track.currentBar);
                
                let secondsPerSubBeat = secondsPerMainBeat;
                if (beatMultiplier >= 1) {
                    secondsPerSubBeat = secondsPerMainBeat / beatMultiplier;
                } else {
                    secondsPerSubBeat = secondsPerMainBeat * (1 / beatMultiplier);
                }
                
                trackStartTime += secondsPerSubBeat;
                advanceTrackBeat(track);
                loops++;
            }

            track.nextBeatTime = trackStartTime;
        });

        // 4. Update UI
        if (DOM.startStopBtn) {
            DOM.startStopBtn.textContent = "■";
            DOM.startStopBtn.classList.remove('pending');
            DOM.startStopBtn.classList.add('active');
        }
        BarDisplayController.clearAllHighlights();

        // 5. Start Engine
        metronomeWorker.postMessage("start");
        if (isPageVisible && !drawFrameId) {
            draw();
        }
        if (MetronomeEngine.onPlayStateChange) {
            MetronomeEngine.onPlayStateChange(true);
        }
    },

    handleSyncPulse: (targetWallTime, bar, beat, repeatIteration = 0) => {
        const audioContext = AppState.getAudioContext();
        if (!AppState.isPlaying() || !audioContext) return;

        // Calculate when the NEXT beat should happen in AudioContext time
        const now = Date.now();
        const timeToTarget = (targetWallTime - now) / 1000;
        const targetAudioTime = audioContext.currentTime + timeToTarget;

        const tracks = AppState.getTracks();
        // Use first track as reference
        if (tracks.length > 0) {
            const track = tracks[0];
            
            // Structural Check: Are we on the same beat?
            // Note: 'bar' and 'beat' from Host are the indices of the NEXT beat (targetAudioTime).
            // 'track.currentBar' and 'track.currentBeat' are the indices of OUR next beat.
            
            if (track.currentBar !== bar || track.currentBeat !== beat
                || (track.songRepeatIteration || 0) !== repeatIteration) {
                console.warn(`Sync Mismatch! Client: ${track.currentBar}:${track.currentBeat}, Host: ${bar}:${beat}. Snapping structure...`);
                
                // Hard snap indices
                track.currentBar = bar;
                track.currentBeat = beat;
                track.songRepeatIteration = repeatIteration;
                
                // Hard snap time (force alignment to host's target time)
                const correction = targetAudioTime - track.nextBeatTime;
                
                // Apply to all tracks to keep them aligned relative to Track 0
                tracks.forEach(t => {
                   // For other tracks, we can't easily snap indices (might have different meters),
                   // but we MUST apply the time correction so they don't drift relative to Track 0.
                   t.nextBeatTime += correction;
                   t.songRepeatIteration = repeatIteration;
                   
                   if (t === track) {
                       t.nextBeatTime = targetAudioTime; // Ensure exact match for reference
                   }
                });
                return;
            }

            const currentAudioNextBeat = track.nextBeatTime;
            const drift = targetAudioTime - currentAudioNextBeat;
            
            // If drift is significant (> 5ms) but not massive (< 1000ms), nudge.
            if (Math.abs(drift) > 0.005 && Math.abs(drift) < 1.0) {
                console.log(`Sync Drift detected: ${Math.round(drift * 1000)}ms. Nudging...`);
                
                // Nudge all tracks
                tracks.forEach(t => {
                    t.nextBeatTime += drift;
                });
            } else if (Math.abs(drift) >= 1.0) {
                console.warn(`Massive drift detected: ${Math.round(drift * 1000)}ms. Ignoring nudge to prevent jumpiness.`);
            }
        }
    },

    isPlaying: () => {
        return AppState.isPlaying();
    },

    isSchedulerReady: () => metronomeWorkerReady
};
export default MetronomeEngine;