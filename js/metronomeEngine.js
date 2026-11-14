/**
 * metronomeEngine.js
 * This module contains the core metronome timing, playback control, and audio handling.
 * This corrected version manages independent scheduling for each track.
 */

import AppState from './appState.js';
import { beginPractice, getPracticeScheduling, getPracticeGateEvents, noteScheduledBeat, getLocalOutputOffsetSeconds, getCorrectionSchedulingLead, reportMissedOutputCorrection, cancelCalibration, applyPendingSongAtBoundary } from './practiceTransport.js';
import DOM from './domSelectors.js';
import ThemeController from './themeController.js';
import BarDisplayController from './barDisplayController.js';
import SoundSynth from './soundSynth.js';
import AudioPlaybackLifetime from './audioPlaybackLifetime.js';
import { prepareEngineMelodyInstrument, createMelodyCursor } from './melodyScheduler.js';
import { TICKS_PER_MAIN_BEAT } from './melodySchema.js';
import { sendState, broadcastScheduledPlay, broadcastStop, requestPlaybackSync, broadcastSyncPulse, getDesiredHostPlaybackState, isSynchronizationJoined } from './webrtc.js';
import AudioController from './audioController.js';
import MidiController from './midiController.js';
import Monitoring from './monitoring.js';
import { createSoundFilterInput, getReversedAudioBuffer, renderSynthAudioBuffer } from './audioEffects.js';
import { getBeatSlots, getSlotInfo, getTotalSlots, getSlotDurationSeconds } from './beatTiming.js';

let metronomeWorker = new Worker('js/metronomeWorker.js');
let metronomeWorkerReady = false;
let drawFrameId = null; // Holds the requestAnimationFrame ID for the visual loop
let isPageVisible = true;
let visualQueue = []; // Queue for visual events
const countInSources = new Set();
let playbackLifetime = null;
let practiceStopScheduled = false;
let countInGeneration = 0;
function ensurePlaybackLifetime() {
    if (!playbackLifetime?.active) playbackLifetime = new AudioPlaybackLifetime();
    return playbackLifetime;
}
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

function terminateMetronomeWorker(event) {
    if (event?.persisted || !metronomeWorker) return;
    try {
        metronomeWorker?.postMessage("stop");
        metronomeWorker.terminate();
    } finally {
        metronomeWorker = null;
        metronomeWorkerReady = false;
    }
}

window.addEventListener("pagehide", terminateMetronomeWorker);
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

export function isRestedSlot(bar, slotIndex, slotInfo = getSlotInfo(bar, slotIndex)) {
    // Stored metadata keys identify the visible logical beat, not a playback
    // child whose index shifts when an earlier beat is sliced.
    const logicalIndex = slotInfo?.baseIndex ?? slotIndex;
    return Array.isArray(bar?.rests) && bar.rests.includes(logicalIndex);
}

const activeSynthVoices = new Map();

function playBeatSound(track, beatTime, trackIndex = 0) {
    const lifetime = playbackLifetime;
    if (!lifetime?.active) return;
    const audioContext = AppState.getAudioContext();
    const isAnySoloed = AppState.isAnyTrackSoloed();
    const canPlay = !isAnySoloed ? !track.muted : track.solo;

    if (!audioContext || audioContext.state !== 'running' || !track || !canPlay) {
        return;
    }

    const currentBarData = track.barSettings[track.currentBar];
    if (!currentBarData) return;

    const beatIndex = track.currentBeat;
    const slotInfo = getSlotInfo(currentBarData, beatIndex) || { mainBeat: beatIndex === 0, sourceBeat: beatIndex };
    if (isRestedSlot(currentBarData, beatIndex, slotInfo)) {
      return; // It's a rest, including every internal slice of a rested visual note
    }

    const beatMultiplier = parseFloat(currentBarData.subdivision || 1);
    const isAccent = slotInfo.mainBeat;

    const soundType = isAccent ? 'mainBeatSound' : 'subdivisionSound';
    const soundLookupBeatIndex = slotInfo.baseIndex ?? beatIndex;
    const soundObject = AppState.getBeatSound
        ? AppState.getBeatSound(trackIndex, track.currentBar, soundLookupBeatIndex, soundType)
        : track[soundType];
    if (!soundObject || !soundObject.sound) return;

    const probability = Number(soundObject.settings?.probability);
    if (!MetronomeEngine.shouldPlayProbability(probability, Math.random())) return;

    const soundToPlay = soundObject.sound;
    const defaultVel = isAccent ? 1.0 : 0.7;
    const velocities = currentBarData.velocities || {};
    const beatVelocity = velocities[soundLookupBeatIndex] !== undefined ? velocities[soundLookupBeatIndex] : defaultVel;

    const trackVolume = track.volume !== undefined ? track.volume : 1.0;
    const soundVolume = soundObject.settings && soundObject.settings.volume !== undefined ? soundObject.settings.volume : 1.0;
    const finalVolume = AppState.getVolume() * trackVolume * soundVolume * beatVelocity;

    const trackDestination = isAccent
        ? (track.mainAnalyserNode || track.analyserNode || Monitoring.getTrackOutput(audioContext, trackIndex))
        : (track.subdivisionAnalyserNode || track.analyserNode || Monitoring.getTrackOutput(audioContext, trackIndex));

    const destination = lifetime.output(audioContext, trackDestination);

    let baseSoundName = soundToPlay;
    const customSoundData = AppState.getCustomSoundData(soundToPlay);
    if (customSoundData) {
        baseSoundName = customSoundData.baseSound;
    }

    if (!baseSoundName) return;

    const trackPitchShift = track.pitchShift || 0;
    const soundSettings = soundObject.settings || {};
    const effectivePitchShift = (soundSettings.pitchShift || 0) + trackPitchShift;

    const correctedTime=beatTime+getLocalOutputOffsetSeconds();
    if(correctedTime<audioContext.currentTime)reportMissedOutputCorrection();
    const actualBeatTime = Math.max(audioContext.currentTime + 0.01, correctedTime);

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
            const hasExplicitTrim = Number.isFinite(Number(soundSettings.trimStart)) || Number.isFinite(Number(soundSettings.trimEnd));
            if (soundSettings.reverse !== true && !hasExplicitTrim) {
                SoundSynth[synthFunctionName](audioContext, actualBeatTime, mergedSettings, synthVoiceGain, lifetime);
            } else {
                renderSynthAudioBuffer(audioContext, SoundSynth[synthFunctionName], mergedSettings).then((rendered) => {
                    if (!rendered || !lifetime.active) return;
                    const source = audioContext.createBufferSource();
                    if (!lifetime.ownSource(source)) return;
                    source.buffer = soundSettings.reverse === true ? getReversedAudioBuffer(audioContext, rendered) : rendered;
                    source.connect(synthVoiceGain);
                    const trimStart = Math.max(0, Math.min(rendered.duration, Number(soundSettings.trimStart) || 0));
                    const trimEnd = Math.max(trimStart, Math.min(rendered.duration, Number(soundSettings.trimEnd) || rendered.duration));
                    const startOffset = soundSettings.reverse === true ? rendered.duration - trimEnd : trimStart;
                    if(actualBeatTime<audioContext.currentTime+0.01)reportMissedOutputCorrection();
                    source.start(Math.max(actualBeatTime, audioContext.currentTime+0.01), startOffset, Math.max(0, trimEnd - trimStart));
                }).catch(error => {
                    console.warn("Could not render synthesized audio:", error);
                    synthVoiceGain.disconnect();
                });
            }
            const voice = {
                endTime: actualBeatTime + voiceDuration,
                gain: synthVoiceGain,
            };
            activeSynthVoices.set(synthVoiceKey, voice);
            lifetime.timeout(() => {
                if (activeSynthVoices.get(synthVoiceKey) === voice) activeSynthVoices.delete(synthVoiceKey);
            }, Math.max(0, voiceDuration * 1000) + 100);
        } else {
            console.warn(`Synth function ${synthFunctionName} not found in SoundSynth.`);
        }
    } else {
        const { trimStart, trimEnd } = soundSettings;
        AudioController.playRecording(baseSoundName, mergedSettings, trimStart, trimEnd, actualBeatTime, finalVolume, destination, lifetime);
    }

    if (trackIndex === 0) {
        MidiController.sendMidiClock();
    }
}


function advanceTrackBeat(track) {
    if (!track || track.barSettings.length === 0) {
        return;
    }
    const currentBarData = track.barSettings[track.currentBar];
    const totalSubBeatsInBar = getTotalSlots(currentBarData);

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
            const conductorTrack = AppState.getTracks().reduce((longest, candidate) => (
                (candidate.barSettings?.length || 0) > (longest?.barSettings?.length || 0) ? candidate : longest
            ), AppState.getTracks()[0]);
            const nextPosition = AppState.getNextSongPosition(
                track.currentBar,
                track.songRepeatIteration || 0,
                track.barSettings.length,
                { useLongestTrack: track === conductorTrack || track.barSettings.length === conductorTrack.barSettings.length }
            );
            const previousSection = AppState.getSongSectionForBar(track.currentBar).index;
            track.currentBar = nextPosition.bar;
            track.songRepeatIteration = nextPosition.repeatIteration;
            const nextSection = AppState.getSongSectionForBar(track.currentBar).index;
            const melodySectionBoundary = AppState.getTracks().some(candidate => 'melody' in candidate) && nextSection !== previousSection;
            if (track === conductorTrack && (nextPosition.sectionTransition || melodySectionBoundary)) {
                AppState.applySongSectionForBar(track.currentBar, nextPosition.sectionTransition ? nextPosition.sectionIndex : nextSection);
            }
        }
    }
}

const melodyTraversals = new Set();
const melodyTrackCursors = new Map();
let schedulingAuthority = false;
let melodyGeneration = 0;
function cancelMelodies(boundaryTime = null) {
    for (const entry of melodyTraversals) entry.cursor.cancel('transport-boundary', boundaryTime === null ? undefined : boundaryTime + entry.correction);
    melodyTraversals.clear();
    melodyTrackCursors.clear();
    melodyGeneration++;
}
function melodyFailure(error, trackIndex) {
    document.dispatchEvent(new CustomEvent('melodyplaybackerror', { detail: { trackIndex, message: error.message } }));
    console.error('Melody playback refused:', error.message);
    MetronomeEngine.cancelPlayback();
}
function prepareTrackMelody(track, trackIndex, tempo, anchor = null) {
    const previous = melodyTrackCursors.get(trackIndex);
    if (!anchor && previous && previous.track === track && previous.bar === track.currentBar && previous.repeat === track.songRepeatIteration && track.currentBeat !== 0) return;
    const context = AppState.getAudioContext();
    const selection = Object.getOwnPropertyDescriptor(track, 'melody');
    if (!selection || !selection.enumerable || !Object.hasOwn(selection, 'value')) throw new TypeError('Invalid melody selection property');
    const barIndex = anchor?.bar ?? track.currentBar;
    const bar = track.barSettings[barIndex];

    for (const meter of track.barSettings) {
        const ticks = getBeatSlots(meter).map((_, index) => getSlotDurationSeconds(meter, index, 1) * TICKS_PER_MAIN_BEAT);
        if (ticks.some(tick => !Number.isSafeInteger(tick) || tick <= 0) || ticks.reduce((sum, tick) => sum + tick, 0) !== meter.beats * TICKS_PER_MAIN_BEAT) {
            throw new TypeError('Melody timing unsupported: grid must cover each bar in whole ticks');
        }
    }
    const slotTick = anchor?.tick ?? getBeatSlots(bar).slice(0, track.currentBeat)
        .reduce((sum, _, index) => sum + getSlotDurationSeconds(bar, index, 1) * TICKS_PER_MAIN_BEAT, 0);
    const offset = track.barSettings.slice(0, barIndex).reduce((sum, bar) => sum + bar.beats * TICKS_PER_MAIN_BEAT, 0);
    if (!Number.isSafeInteger(slotTick)) throw new TypeError('Melody timing must resolve to whole ticks');
    const snapshot = { ...track, barSettings: structuredClone(track.barSettings), melody: structuredClone(track.melody),
        mainBeatSound: structuredClone(track.mainBeatSound), volume: (track.volume ?? 1) * AppState.getVolume() };
    const instrument = prepareEngineMelodyInstrument({ sound: snapshot.mainBeatSound, buffer: AppState.getSoundBuffer(snapshot.mainBeatSound.sound), rootMidi: snapshot.melody.sampleRootMidi, filterInput: createSoundFilterInput });
    const authority = { generation: melodyGeneration, tempo, playing: true, practice: 'mapped' };
    const correction = getLocalOutputOffsetSeconds();
    const nominalOrigin = anchor?.time ?? track.nextBeatTime;
    const grid = [0];
    for (let i = 0; i < getTotalSlots(bar); i++) grid.push(grid.at(-1) + getSlotDurationSeconds(bar, i, 1) * TICKS_PER_MAIN_BEAT);
    const swingOffsets = grid.map((_, i) => i === grid.length - 1 ? 0 : getTrackSwingOffsetSec({ ...snapshot, currentBar: barIndex, currentBeat: i }));
    const timeAtTick = tick => {
        const local = tick - offset;
        let i = 0;
        while (i < grid.length - 2 && local > grid[i + 1]) i++;
        const fraction = (local - grid[i]) / (grid[i + 1] - grid[i]);
        const swing = swingOffsets[i] + fraction * (swingOffsets[i + 1] - swingOffsets[i]);
        return nominalOrigin + getPracticeScheduling(nominalOrigin, (local - slotTick) / TICKS_PER_MAIN_BEAT, tempo).duration + swing + correction;
    };
    const cursor = createMelodyCursor({ track: snapshot, instrument, context,
        destination: track.mainAnalyserNode || track.analyserNode || Monitoring.getTrackOutput(context, trackIndex), lifetime: playbackLifetime,
        authority, originTick: offset + slotTick, originTime: (anchor?.time ?? track.nextBeatTime) + correction,
        endTick: offset + bar.beats * TICKS_PER_MAIN_BEAT, timeAtTick });
    const entry = { track, trackIndex, bar: barIndex, repeat: track.songRepeatIteration, cursor, authority, correction,
        nextAnchorTick: anchor?.nextAnchorTick ?? slotTick, scheduledSlots: [] };
    melodyTraversals.add(entry);
    melodyTrackCursors.set(trackIndex, entry);
}
function reanchorMelodies() {
    const entries = [...melodyTrackCursors.values()];
    cancelMelodies();
    if (!AppState.isPlaying()) return;
    for (const entry of entries) {
        const track = AppState.getTracks()[entry.trackIndex];
        if (track !== entry.track) continue;
        const tempo = AppState.getPlaybackTempo(entry.bar), secondsPerTick = 60 / tempo / TICKS_PER_MAIN_BEAT;
        const barStart = track.nextBeatTime - entry.nextAnchorTick * secondsPerTick;
        const now = AppState.getAudioContext().currentTime;
        const tick = Math.max(0, Math.ceil((now + .003 - getLocalOutputOffsetSeconds() - barStart) / secondsPerTick));
        if (tick >= track.barSettings[entry.bar].beats * TICKS_PER_MAIN_BEAT) continue;
        try { prepareTrackMelody(track, entry.trackIndex, tempo, { bar: entry.bar, tick, time: barStart + tick * secondsPerTick, nextAnchorTick: entry.nextAnchorTick }); }
        catch (error) { melodyFailure(error, entry.trackIndex); break; }
    }
}
AppState.subscribeMusicalMutations(event => {
    if (schedulingAuthority) return;
    if (event.label === 'setTempo' || event.label === 'updateTrack' || event.label === 'toggleSolo') reanchorMelodies();
    else cancelMelodies();
});
document.addEventListener('songchangecommitted', event => cancelMelodies(event.detail.audioTime));

function scheduler() {
    // If we managed to get a tick while stopped (race condition), ignore it.
    if (!AppState.isPlaying() || !playbackLifetime?.active) {
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
        schedulingAuthority = true;
        try {
        // A traversal owns at most one bar; retire finished leases on the same
        // worker tick rather than accumulating cursors during long rehearsals.
        for (const entry of melodyTraversals) {
            if (entry.cursor.endTime <= audioContext.currentTime) {
                entry.cursor.cancel('lease-ended');
                melodyTraversals.delete(entry);
            }
        }
        const primaryTrack = allTracks[0];
        const tempoSegments = [{ time: Number.NEGATIVE_INFINITY, tempo: AppState.getPlaybackTempo(primaryTrack?.currentBar || 0) }];
        let scheduled=0;
        while (scheduled++ < 4096) {
            const candidates=AppState.getTracks().map((track,index)=>({track,index})).filter(({track})=>track.barSettings.length);
            candidates.sort((a,b)=>a.track.nextBeatTime-b.track.nextBeatTime || a.index-b.index);
            const next=candidates[0];
            if(!next) break;
            const horizon=audioContext.currentTime + AppState.SCHEDULE_AHEAD_TIME + getCorrectionSchedulingLead();
            const melodyNext = [...melodyTraversals].sort((a,b) => (a.cursor.nextEventTime-a.correction)-(b.cursor.nextEventTime-b.correction))[0];
            const melodyTime = melodyNext ? melodyNext.cursor.nextEventTime - melodyNext.correction : Infinity;
            const nextTime = Math.min(next.track.nextBeatTime, melodyTime);
            // A queued authoritative seam is itself a scheduling event. An old
            // peer grid can precede it by more than the seam tolerance, leaving
            // the following old slot outside lookahead until AFTER the seam.
            // Check the seam at the horizon before waiting for that old slot,
            // while still submitting every earlier track slot chronologically.
            if(applyPendingSongAtBoundary(Math.min(nextTime,horizon))) continue;
            if(nextTime >= horizon) break;
            if (melodyTime < next.track.nextBeatTime) {
                try {
                    const live = AppState.getTracks()[melodyNext.trackIndex];
                    const notePractice = getPracticeScheduling(melodyTime, 0, melodyNext.authority.tempo);
                    melodyNext.cursor.advance({ horizonTime: melodyNext.cursor.nextEventTime + 1e-9, authority: melodyNext.authority,
                        audible: !notePractice.stop && notePractice.audible && !live?.muted && (!AppState.isAnyTrackSoloed() || live.solo) });
                } catch (error) { melodyFailure(error, melodyNext.trackIndex); return; }
                continue;
            }
            const {track,index:trackIndex}=next;
            {
                let tempo;
                if (trackIndex === 0) {
                    tempo = AppState.getPlaybackTempo(track.currentBar);
                    if (trackIndex === 0 && tempo !== AppState.getTempo()) {
                        AppState.setTempo(tempo, { reschedule: false, persist: false });
                    }
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
                const slotBeats = getSlotDurationSeconds(currentBarData, track.currentBeat, 1);
                const practice = getPracticeScheduling(track.nextBeatTime, slotBeats, tempo);
                if(practice.stop) {
                    if(!practiceStopScheduled) {
                        practiceStopScheduled=true;
                        const lifetime=playbackLifetime;
                        lifetime.timeout(()=>{
                            if(window.isHost && isSynchronizationJoined())broadcastStop();
                            MetronomeEngine.cancelPlayback();
                        },Math.max(0,(track.nextBeatTime+getLocalOutputOffsetSeconds()-audioContext.currentTime)*1000));
                    }
                    return;
                }
                const secondsPerSubBeat = practice.duration;
                if(trackIndex===0) noteScheduledBeat(track.nextBeatTime, getSlotInfo(currentBarData,track.currentBeat)?.mainBeat);
                // Only play sound and schedule visuals if the beat is within a reasonable window (not >250ms in the past)
                // This prevents "machine gun" bursts when syncing catches up from a late start or large drift.
                if (track.nextBeatTime > audioContext.currentTime - 0.25) {
                    const swingOffset = getTrackSwingOffsetSec(track);
                    const swungBeatTime = track.nextBeatTime + swingOffset;

                    if ('melody' in track) {
                        try { prepareTrackMelody(track, trackIndex, tempo); }
                        catch (error) { melodyFailure(error, trackIndex); return; }
                    } else if(practice.audible) playBeatSound(track, swungBeatTime, trackIndex);
                    // Gate the generation's post-FX routes, never the shared context or
                    // Monitoring output: sustained voices/tails must also respect gaps.
                    for(const event of getPracticeGateEvents(track.nextBeatTime,track.nextBeatTime+secondsPerSubBeat)) {
                        const gateTime=Math.max(audioContext.currentTime,event.audioTime+getLocalOutputOffsetSeconds());
                        for(const gate of playbackLifetime.routes.values())gate.gain.setValueAtTime(event.audible?1:0,gateTime);
                    }
                    
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
                
                const melodyEntry = melodyTrackCursors.get(trackIndex);
                if ('melody' in track && melodyEntry) {
                    melodyEntry.scheduledSlots.push({ bar: track.currentBar, beat: track.currentBeat,
                        repeat: track.songRepeatIteration || 0, time: track.nextBeatTime });
                    melodyEntry.nextAnchorTick += slotBeats * TICKS_PER_MAIN_BEAT;
                }
                advanceTrackBeat(track);
                track.nextBeatTime += secondsPerSubBeat;
            }
        }
        } finally { schedulingAuthority = false; }
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
    metronomeWorker?.postMessage("stop");
    
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
    // Protocol support is distinct from worker/audio readiness. This certifies
    // note selection, mapped timing and boundary cancellation, not every sound:
    // four pitched waveforms or an explicitly rooted native sample are accepted;
    // unsupported instruments/settings fail visibly, never fall back to rhythm.
    supportsMelodyProtocol: capability => capability === 'melody-v1',
    shouldPlayProbability: (probability, roll) => {
        if (!Number.isFinite(probability)) return true;
        if (probability <= 0) return false;
        if (probability >= 100) return true;
        return roll * 100 < probability;
    },
    cancelPlayback: () => {
        cancelCalibration();
        practiceStopScheduled=false;
        cancelMelodies();
        playbackLifetime?.cancel();
        playbackLifetime = null;
        activeSynthVoices.clear();
        MetronomeEngine.cancelCountIn();
        // AppState flips synchronously before its first await. Never toggle an idle state.
        if (AppState.isPlaying()) void AppState.togglePlay();
        performEngineStopActions();
        return false;
    },

    cancelCountIn: () => {
        countInGeneration += 1;
        for (const source of countInSources) {
            try { source.stop(); } catch (_error) { /* The source may already have ended. */ }
        }
        countInSources.clear();
    },

    scheduleCountIn: async (countIn, shouldSchedule = () => true) => {
        const generation = countInGeneration;
        const audioContext = AppState.getAudioContext();
        if (!audioContext || !countIn || !shouldSchedule()) return;
        if (audioContext.state === 'suspended') await audioContext.resume();
        if (audioContext.state !== 'running' || generation !== countInGeneration || !shouldSchedule()) return;

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
            gain.connect(Monitoring.getOutput(audioContext));
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
        if (forceStop) return MetronomeEngine.cancelPlayback();
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
        } else if (!window.isHost && !forceStop && isSynchronizationJoined()) {
            // Joined clients follow the host and cannot create a divergent local transport state.
            requestPlaybackSync();
            return wasPlayingBeforeToggle;
        }

        // Stop owns its generation synchronously, before another Play can enter.
        if (wasPlayingBeforeToggle) {
            MetronomeEngine.cancelPlayback();
            sendState(AppState.getCurrentStateForPreset(true));
            return false;
        }
        AppState.applySongSectionForBar(0);
        const lifetime = ensurePlaybackLifetime();
        const isNowPlaying = await AppState.togglePlay();
        if (!lifetime.active || lifetime !== playbackLifetime) return false;
        if (!isNowPlaying) {
            lifetime.cancel();
            playbackLifetime = null;
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

            const minimum=AppState.getAudioContext().currentTime+AppState.SCHEDULE_AHEAD_TIME+getCorrectionSchedulingLead();
            for(const t of AppState.getTracks())t.nextBeatTime=Math.max(t.nextBeatTime,minimum);
            beginPractice(AppState.getTracks()[0]?.nextBeatTime || AppState.getAudioContext().currentTime);
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

    scheduleStart: async (targetTimestamp, startBar = 0, startBeat = 0, repeatIteration = 0, shouldStart = () => true, practiceEpochTimestamp = targetTimestamp) => {
        cancelMelodies();
        const lifetime = ensurePlaybackLifetime();
        const current = () => lifetime.active && lifetime === playbackLifetime && shouldStart();
        const audioContext = AppState.getAudioContext();
        if (audioContext && audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        if (!current()) return;

        // Manually start AppState logic without toggling (since we are setting specific times)
        // Or we can use togglePlay logic but override the nextBeatTime.
        // Let's manually set it to be precise.
        
        // 1. Set playing state
        // We can use a trick: call AppState.togglePlay(), then immediately overwrite nextBeatTime
        if (!AppState.isPlaying()) {
            const isPlaying = await AppState.togglePlay();
            if (!current()) return;
            if (!isPlaying) return; // Exit if AppState refused to play (e.g. no tracks)
        }

        if (!current()) return;

        // 2. Calculate delay until target time
        const now = Date.now();
        const delaySeconds = (targetTimestamp - now) / 1000;
        // Allow startAudioTime to be in the past (negative delay) to preserve grid alignment
        const startAudioTime = audioContext.currentTime + delaySeconds;

        beginPractice(audioContext.currentTime + (practiceEpochTimestamp - Date.now()) / 1000);

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
            while (trackStartTime < audioContext.currentTime + 0.05 + getCorrectionSchedulingLead() && loops < 1000) {
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
                
                secondsPerSubBeat = getPracticeScheduling(trackStartTime, getSlotDurationSeconds(currentBarData,track.currentBeat,1), AppState.getPlaybackTempo(track.currentBar)).duration;
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

            // A host pulse describes its submitted slot, not necessarily our
            // next unscheduled slot: independent workers can have different
            // lookahead progress. Do not rewind an already aligned melody slot
            // and cancel/recreate its native voices. Real mismatches still snap.
            if ([...melodyTraversals].some(entry => entry.track === track && entry.scheduledSlots.some(slot =>
                slot.bar === bar && slot.beat === beat && slot.repeat === repeatIteration &&
                Math.abs(slot.time - targetAudioTime) <= .005))) return;
            
            // Structural Check: Are we on the same beat?
            // Note: 'bar' and 'beat' from Host are the indices of the NEXT beat (targetAudioTime).
            // 'track.currentBar' and 'track.currentBeat' are the indices of OUR next beat.
            
            if (track.currentBar !== bar || track.currentBeat !== beat
                || (track.songRepeatIteration || 0) !== repeatIteration) {
                console.warn(`Sync Mismatch! Client: ${track.currentBar}:${track.currentBeat}, Host: ${bar}:${beat}. Snapping structure...`);
                
                // Hard snap indices
                cancelMelodies();
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
                reanchorMelodies();
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
// Preset/reset callers can clear AppState directly. Their stopped event is also
// an audio boundary; checking isPlaying later would miss pending native renders.
document.addEventListener('playbackstatechange', event => {
    if (event.detail?.playing === false && playbackLifetime?.active) {
        MetronomeEngine.cancelPlayback();
    }
});
export default MetronomeEngine;