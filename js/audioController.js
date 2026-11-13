
import AppState from './appState.js';
import TrackController from './tracksController.js';
import DOM from './domSelectors.js';
import RecordingVisualizer from './recordingVisualizer.js';
import Monitoring from './monitoring.js';
import { VoiceCaptureSession } from './voiceCaptureSession.js';
import { createVoiceNoteDisplay } from './voiceNoteDisplay.js';
import { mapVoiceTake } from './voiceTakeMapping.js';
import { createVoiceTakeEditor } from './voiceTakeEditor.js';
import { validateMelody } from './melodySchema.js';
import { prepareEngineMelodyInstrument } from './melodyScheduler.js';

let voiceReview = null;
let voiceDestinationChange = null;
let recordingAuthorityGeneration = 0;
function discardVoiceReview() {
    if (DOM.voiceTakeDestination) {
        if (voiceDestinationChange) DOM.voiceTakeDestination.removeEventListener('change', voiceDestinationChange);
        DOM.voiceTakeDestination.replaceChildren();
    }
    voiceDestinationChange = null;
    voiceReview?.editor?.destroy();
    voiceReview = null;
    DOM.voiceTakeEditorContainer?.replaceChildren();
    if (DOM.voiceRecordingReview) {
        DOM.voiceRecordingReview.textContent = '';
        DOM.voiceRecordingReview.hidden = true;
    }
    if (DOM.voiceRecordingStatus) DOM.voiceRecordingStatus.textContent = '';
    if (DOM.voiceTakeDestinationControls) DOM.voiceTakeDestinationControls.hidden = true;
    if (DOM.voiceTakeSampleRootControls) DOM.voiceTakeSampleRootControls.hidden = true;
    if (DOM.voiceTakeSampleRoot) DOM.voiceTakeSampleRoot.value = '';
}
function assertVoiceDestination(session) {
    if (session.authorityGeneration !== recordingAuthorityGeneration || session.authority !== window.isHost || window.isHost === false)
        throw new Error('Voice Apply refused: host authority changed. Discard and capture again.');
    if (AppState.isPlaying()) throw new Error('Stop playback before applying voice notes.');
    if (!session.track || !AppState.getTracks().includes(session.track) || JSON.stringify(session.track.barSettings) !== session.barFingerprint)
        throw new Error('Voice Apply refused: the exact source track or its bars changed. Discard and capture again.');
}
const pitchedSynthNames = new Set(['Synth Sine', 'Synth Triangle', 'Synth Square', 'Synth Sawtooth']);
function sameTimingGrid(left, right) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
        && left.every((bar, index) => bar.beats === right[index]?.beats && bar.subdivision === right[index]?.subdivision);
}
function openVoiceEditor(session, result) {
    if (!DOM.voiceTakeEditorContainer) return;
    try {
        assertVoiceDestination(session);
        const mapped = mapVoiceTake(structuredClone(result.notes), {
            recordedBpm: session.recordedBpm, captureOrigin: session.captureOrigin,
            startBar: 0, barSettings: session.barSettings, transportState: 'stopped',
            origin: 'first-note', boundaryPolicy: 'reject', quantization: { mode: 'off' }
        });
        if (!mapped.melody.bars.some(bar => bar.length)) throw new Error('No stable notes to edit. Discard and try again.');
        const destinations = new Map();
        const select = DOM.voiceTakeDestination;
        select.replaceChildren();
        const fresh = document.createElement('option');
        fresh.value = 'new-track'; fresh.textContent = 'New pitched melody track (Synth Sine)'; select.append(fresh);
        AppState.getTracks().forEach((track, index) => {
            const value = `track:${index}`, option = document.createElement('option');
            option.value = value;
            option.textContent = `Track ${index + 1} — ${track.name || track.mainBeatSound?.sound || 'Unnamed instrument'}`;
            select.append(option);
            destinations.set(value, { index, track, bars: JSON.stringify(track.barSettings), sound: JSON.stringify(track.mainBeatSound) });
        });
        DOM.voiceTakeDestinationControls.hidden = false;
        select.value = 'new-track';
        voiceDestinationChange = () => {
            const destination = destinations.get(select.value);
            const name = destination?.track?.mainBeatSound?.sound;
            const sample = Boolean(destination && typeof name === 'string' && !name.startsWith('Synth')
                && AppState.getSoundBuffer(name) instanceof AudioBuffer);
            DOM.voiceTakeSampleRootControls.hidden = !sample;
            const savedRoot = destination?.track?.melody?.sampleRootMidi;
            DOM.voiceTakeSampleRoot.value = sample && Number.isInteger(savedRoot) ? String(savedRoot) : '';
        };
        select.addEventListener('change', voiceDestinationChange);
        voiceDestinationChange();
        const review = voiceReview = { editor: null, destinations };
        review.editor = createVoiceTakeEditor(DOM.voiceTakeEditorContainer, {
            melody: mapped.melody, barSettings: session.barSettings,
            onApply: candidate => {
                if (voiceReview !== review) throw new Error('Voice draft expired. Capture again.');
                assertVoiceDestination(session);
                let melody = validateMelody(candidate, session.barSettings); // Detached and schema-validated before mutation.
                const destination = select.value;
                if (destination === 'new-track') {
                    AppState.addMelodyTrack({ melody, barSettings: session.barSettings });
                } else {
                    const target = destinations.get(destination);
                    const liveTrack = target && AppState.getTracks()[target.index];
                    if (!target || liveTrack !== target.track || JSON.stringify(liveTrack.barSettings) !== target.bars
                        || JSON.stringify(liveTrack.mainBeatSound) !== target.sound)
                        throw new Error('Voice Apply refused: the selected destination changed. Reopen the draft and try again.');
                    if (!sameTimingGrid(session.barSettings, liveTrack.barSettings))
                        throw new Error('Voice Apply refused: destination bars must match the captured bar timing. Choose a compatible track or use a new track.');
                    const sound = liveTrack.mainBeatSound;
                    if (!pitchedSynthNames.has(sound?.sound)) {
                        if (typeof sound?.sound !== 'string' || sound.sound.startsWith('Synth'))
                            throw new TypeError(`Unsupported melody instrument: ${sound?.sound || 'unknown'}. Choose a supported pitched synth or a loaded sample.`);
                        if (!(AppState.getSoundBuffer(sound.sound) instanceof AudioBuffer))
                            throw new TypeError('The selected sample is not loaded as a native audio buffer. Choose another destination.');
                        const rawRoot = DOM.voiceTakeSampleRoot.value.trim();
                        const rootMidi = Number(rawRoot);
                        if (rawRoot === '' || !Number.isInteger(rootMidi) || rootMidi < 0 || rootMidi > 127)
                            throw new TypeError('Enter an explicit sample root MIDI from 0 to 127. Nothing was changed.');
                        melody = validateMelody({ ...melody, sampleRootMidi: rootMidi }, liveTrack.barSettings, { requireSampleRoot: true });
                    } else melody = validateMelody(melody, liveTrack.barSettings);
                    prepareEngineMelodyInstrument({ sound, buffer: AppState.getSoundBuffer(sound.sound), rootMidi: melody.sampleRootMidi });
                    AppState.updateTrack(target.index, { melody });
                    AppState.setSelectedTrackIndex(target.index);
                    AppState.setSelectedBarIndexInContainer(0);
                }
                TrackController.renderTracks();
                DOM.voiceRecordingReview.textContent = '';
                DOM.voiceRecordingReview.hidden = true;
                DOM.voiceTakeDestinationControls.hidden = true;
                DOM.voiceRecordingStatus.textContent = 'Voice melody added as a new pitched track. Undo is available in Edit history.';
                DOM.recordingDisplayModal.style.display = 'none';
            },
            onCancel: () => {
                discardVoiceReview();
                DOM.voiceRecordingReview.textContent = '';
                DOM.voiceRecordingReview.hidden = true;
                DOM.recordingDisplayModal.style.display = 'none';
            }
        });
        DOM.voiceRecordingStatus.textContent += ` Preview uses first detected note at bar 1, captured ${session.recordedBpm} BPM, no quantization. Choose a compatible track or create a new pitched melody track.`;
    } catch (error) {
        DOM.voiceRecordingStatus.textContent += ` ${error.message} Nothing was applied.`;
    }
}
import { emitInteractionMotion } from './interactionMotion.js';

const noteLabel = midi => `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][midi % 12]}${Math.floor(midi / 12) - 1}`;

function prepareRecordingUI(session) {
    discardVoiceReview();
    const voice = session.mode === 'voice';
    DOM.voiceRecordingStatus.hidden = !voice;
    DOM.voiceRecordingStatus.textContent = voice ? 'Listening locally. Stop to review; notes are not saved or aligned to the song.' : '';
    DOM.voiceNoteContainer.hidden = !voice;
    DOM.voiceRecordingReview.hidden = true;
    DOM.voiceRecordingReview.textContent = '';
    DOM.recordingWaveformCanvas.hidden = voice;
    DOM.recordingStopBtn.hidden = false;
    DOM.recordingDisplayModal.style.display = 'flex';
    DOM.recordingTimer.textContent = '00:00';
}

function startRecordingTimer() {
    AudioController.startTime = Date.now();
    AudioController.timerIntervalId = setInterval(() => {
        const elapsed = Math.floor((Date.now() - AudioController.startTime) / 1000);
        DOM.recordingTimer.textContent = `${Math.floor(elapsed / 60).toString().padStart(2, '0')}:${(elapsed % 60).toString().padStart(2, '0')}`;
    }, 1000);
}

/** Internal, device-local integration contract (not a persistence command):
 * document 'voicenotescaptured' CustomEvent.detail is a detached capture result
 * {status, reason, startTime, endTime, notes:[{midi,startTime,endTime,...}],
 * error, cleanupErrors}. Times are absolute shared AudioContext seconds, NOT
 * song positions. Subtract result.startTime for capture-relative review.
 * Emitted once only for a valid stopped voice session, after native cleanup.
 * Contains no track/source/stream/PCM; consumers must never publish it as room
 * state. Editable preview is private and Apply fails closed without an atomic
 * insert API. Discard destroys its owned editor, not copies retained by consumers.
 */
function completeVoiceRecording(session, result, current) {
    const accepted = current() && result.status === 'stopped';
    session.view?.destroy();
    cleanupRecordingSession(session);
    if (AudioController.recordingSession === session) AudioController.recordingSession = null;
    if (!accepted) return;
    DOM.recordingDisplayModal.style.display = 'flex';
    DOM.recordingStopBtn.hidden = true;
    DOM.voiceRecordingStatus.textContent = `${result.notes.length} local note(s) detected — not saved or applied. Timing is capture-relative, not song-aligned. Discard when finished reviewing.`;
    DOM.voiceRecordingReview.hidden = false;
    DOM.voiceRecordingReview.textContent = result.notes.length ? result.notes.map(note =>
        `${noteLabel(note.midi)}  ${(note.startTime - result.startTime).toFixed(2)}–${(note.endTime - result.startTime).toFixed(2)} s`).join('\n') : 'No stable notes detected.';
    DOM.recordingCancelBtn.focus();
    openVoiceEditor(session, result);
    // Preserve the existing review dismissal focus contract.
    DOM.recordingCancelBtn.focus();
    document.dispatchEvent(new CustomEvent('voicenotescaptured', { detail: structuredClone(result) }));
}
import { createSoundFilterInput, getReversedAudioBuffer } from './audioEffects.js';

function recordingTarget(session) {
    const index = AppState.getTracks().indexOf(session.track);
    return (index >= 0 && document.querySelectorAll('.track-record-btn')[index]) || DOM.recordingStopBtn;
}

function cleanupRecordingSession(session) {
    if (!session) return;
    session.stream?.getTracks().forEach(track => track.stop());
    session.source?.disconnect();
    session.analyser?.disconnect();
    if (AudioController.recordingSession !== session) return;
    AudioController.recordingStream = null;
    AudioController.audioChunks = [];
    AppState.setRecording(false);
    TrackController.renderTracks();
    if (DOM.recordingDisplayModal) DOM.recordingDisplayModal.style.display = 'none';
    RecordingVisualizer.stop();
    if (AudioController.timerIntervalId) clearInterval(AudioController.timerIntervalId);
    AudioController.timerIntervalId = null;
    AudioController.mediaRecorder = null;
    AudioController.analyserNode = null;
}

const AudioController = {
    activeRecordingSources: new Map(),
    recordingSession: null,
    mediaRecorder: null,
    audioChunks: [],
    recordingStream: null, // To store the MediaStream
    analyserNode: null, // To store the AnalyserNode for visualization
    timerIntervalId: null,
    startTime: 0,

    initialize: () => {
        if (AudioController.initialized) return;
        AudioController.initialized = true;
        const cancel = () => {
            recordingAuthorityGeneration += 1;
            AudioController.recordingSession?.cancel();
        };
        document.addEventListener('roomauthoritychange', cancel);
        document.addEventListener('syncrolechange', cancel);
        const cancelVoice = () => {
            const session = AudioController.recordingSession;
            if (session?.mode === 'voice') session.cancel();
            discardVoiceReview();
        };
        window.addEventListener('pagehide', cancelVoice);
        document.addEventListener('playbackstatechange', () => {
            if (AppState.isPlaying()) cancelVoice();
        });
        const dismissRecording = () => {
            AudioController.recordingSession?.cancel();
            discardVoiceReview();
            DOM.voiceRecordingReview.textContent = '';
            DOM.voiceRecordingReview.hidden = true;
            DOM.recordingDisplayModal.style.display = 'none';
        };
        const dismissVoice = () => {
            const session = AudioController.recordingSession;
            if (!session || session.mode === 'voice') dismissRecording();
        };
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && DOM.recordingDisplayModal?.style.display !== 'none') dismissVoice();
        });
        DOM.recordingDisplayModal?.addEventListener('click', event => {
            if (event.target === DOM.recordingDisplayModal) dismissVoice();
        });
        if (DOM.recordingDisplayModal) {
            const observer = new MutationObserver(() => {
                const modal = DOM.recordingDisplayModal;
                const style = getComputedStyle(modal);
                if (modal.hidden || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') cancelVoice();
            });
            observer.observe(DOM.recordingDisplayModal, { attributes: true, attributeFilter: ['style', 'hidden', 'class'] });
        }
        const cancelMissingTrack = () => {
            const session = AudioController.recordingSession;
            if (session?.track && !AppState.getTracks().includes(session.track)) session.cancel();
        };
        AppState.subscribeMusicalMutations(cancelMissingTrack);
        // Snapshot replay reconstructs track identities without a musical mutation.
        document.addEventListener('appstatechange', cancelMissingTrack);
        DOM.recordingCancelBtn?.addEventListener('click', dismissRecording);
        if (DOM.recordingStopBtn) {
            DOM.recordingStopBtn.addEventListener('click', () => {
                AudioController.stopRecording();
            });
        }
    },

    toggleRecording: async (trackIndex) => {
        if (AudioController.recordingSession) {
            AudioController.stopRecording(trackIndex);
        } else {
            await AudioController.startRecording(trackIndex);
        }
    },

    startRecording: async (trackIndex) => {
        if (AudioController.recordingSession) return;
        discardVoiceReview();
        const session = { mode: DOM.recordingMode?.value === 'voice' ? 'voice' : 'sample', track: AppState.getTracks()[trackIndex], authority: window.isHost, chunks: [], cancelled: false, stopping: false };
        session.authorityGeneration = recordingAuthorityGeneration;
        if (session.mode === 'voice') {
            session.recordedBpm = AppState.getTempo();
            session.barSettings = structuredClone(session.track?.barSettings || []);
            session.barFingerprint = JSON.stringify(session.barSettings);
        }
        const current = () => AudioController.recordingSession === session && !session.cancelled
            && session.authority === window.isHost && session.authorityGeneration === recordingAuthorityGeneration
            && (!session.track || AppState.getTracks().includes(session.track));
        session.cancel = () => {
            session.cancelled = true;
            session.voice?.cancel();
            session.view?.destroy();
            if (session.recorder?.state !== 'inactive' && session.recorder) session.recorder.stop();
            cleanupRecordingSession(session);
            if (AudioController.recordingSession === session) AudioController.recordingSession = null;
        };
        const refuse = error => {
            const owns = current();
            session.cancel();
            if (owns) {
                emitInteractionMotion(recordingTarget(session), 'refuse');
                console.error('Could not record microphone:', error);
                if (session.mode === 'voice') {
                    prepareRecordingUI(session);
                    DOM.recordingStopBtn.hidden = true;
                    DOM.voiceRecordingStatus.textContent = 'Microphone capture failed. Check permission or device availability, then try again. Nothing was recorded or saved.';
                    DOM.recordingCancelBtn.focus();
                }
            }
        };
        AudioController.recordingSession = session;
        if (session.mode === 'voice' && AppState.isPlaying()) {
            session.cancel();
            prepareRecordingUI(session);
            DOM.recordingStopBtn.hidden = true;
            DOM.voiceRecordingStatus.textContent = 'Stop playback before voice capture. Notes use capture-relative timing, not song alignment. Nothing was recorded or saved.';
            DOM.recordingCancelBtn.focus();
            return;
        }
        try {
            const audioContext = AppState.getAudioContext() || AppState.initializeAudioContext();
            session.captureOrigin = audioContext.currentTime;
            if (audioContext.state === 'suspended') await audioContext.resume();
            if (!current()) { session.cancel(); return; }
            if (session.mode === 'voice') {
                prepareRecordingUI(session);
                DOM.voiceRecordingStatus.textContent = 'Waiting for microphone permission. You can discard this request.';
                DOM.recordingStopBtn.hidden = true;
                DOM.recordingCancelBtn.focus();
            }
            session.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (!current()) { session.cancel(); return; }
            AudioController.recordingStream = session.stream;
            session.source = audioContext.createMediaStreamSource(session.stream);
            if (session.mode === 'voice') {
                prepareRecordingUI(session);
                session.view = createVoiceNoteDisplay(DOM.voiceNoteContainer, { stabilityMs: 0 });
                let previousMidi = null;
                session.voice = new VoiceCaptureSession({ context: audioContext, source: session.source,
                    onStableNote: note => {
                        if (!current()) { session.cancel(); return; }
                        session.view.update(note ? { id: `${note.midi}:${note.startTime}`, label: noteLabel(note.midi), interval: previousMidi === null ? null : note.midi - previousMidi } : null);
                        if (note) previousMidi = note.midi;
                    },
                    onComplete: result => completeVoiceRecording(session, result, current)
                });
                session.voice.start();
                AppState.setRecording(true);
                TrackController.renderTracks();
                startRecordingTimer();
                DOM.recordingStopBtn.focus();
                emitInteractionMotion(recordingTarget(session), 'record-start');
                return;
            }
            session.analyser = audioContext.createAnalyser();
            session.source.connect(session.analyser); // Analysis only: never monitor microphone to speakers.
            AudioController.analyserNode = session.analyser;
            const recorder = session.recorder = new MediaRecorder(session.stream);
            AudioController.mediaRecorder = recorder;
            AudioController.audioChunks = session.chunks;
            recorder.ondataavailable = event => { if (!session.cancelled && event.data.size) session.chunks.push(event.data); };
            recorder.onerror = event => refuse(event.error);
            recorder.onstart = () => {
                if (!current()) { session.cancel(); return; }
                if (session.stopping) return;
                AppState.setRecording(true);
                TrackController.renderTracks();
                prepareRecordingUI(session);
                RecordingVisualizer.init(session.analyser, DOM.recordingWaveformCanvas);
                RecordingVisualizer.start();
                AudioController.startTime = Date.now();
                AudioController.timerIntervalId = setInterval(() => {
                    const elapsed = Math.floor((Date.now() - AudioController.startTime) / 1000);
                    DOM.recordingTimer.textContent = `${Math.floor(elapsed / 60).toString().padStart(2, '0')}:${(elapsed % 60).toString().padStart(2, '0')}`;
                }, 1000);
                emitInteractionMotion(recordingTarget(session), 'record-start');
            };
            recorder.onstop = async () => {
                cleanupRecordingSession(session);
                if (!current()) { session.cancel(); return; }
                session.stopping = true;
                emitInteractionMotion(recordingTarget(session), 'record-stop');
                try {
                    const bytes = await new Blob(session.chunks, { type: recorder.mimeType }).arrayBuffer();
                    if (!current()) return;
                    const decoded = await audioContext.decodeAudioData(bytes);
                    if (!current()) return;
                    let number = AppState.getRecordings().length + 1;
                    while (AppState.getRecordings().includes(`Recording ${number}`)) number += 1;
                    const name = `Recording ${number}`;
                    AppState.addRecording(name);
                    AppState.setSoundBuffer(name, decoded);
                    const index = AppState.getTracks().indexOf(session.track);
                    if (index >= 0) AppState.updateTrack(index, {
                        mainBeatSound: { sound: name, settings: { trimStart: 0, trimEnd: decoded.duration, pitchShift: 0 } }
                    });
                    const accepted = AppState.getRecordings().includes(name) && AppState.getSoundBuffer(name) === decoded
                        && (index < 0 || session.track.mainBeatSound.sound === name);
                    TrackController.renderTracks();
                    if (current()) emitInteractionMotion(recordingTarget(session), accepted ? 'save' : 'refuse');
                } catch (error) {
                    if (current()) refuse(error);
                } finally {
                    if (AudioController.recordingSession === session) AudioController.recordingSession = null;
                }
            };
            recorder.start();
        } catch (error) {
            refuse(error);
        }
    },

    stopRecording: () => {
        const session = AudioController.recordingSession;
        if (!session || session.stopping) return;
        if (!session.recorder) {
            if (session.voice) {
                session.stopping = true;
                session.voice.stop(); // Flush synchronously BEFORE releasing owned tracks.
            } else session.cancel();
            return;
        }
        session.stopping = true;
        if (session.recorder.state !== 'inactive') session.recorder.stop();
        cleanupRecordingSession(session);
    },

    playRecording: (recordingName, soundSettings, trimStart = 0, trimEnd = null, playTime = 0, volume = 1.0, destination = null, lifetime = null) => {
        if (lifetime && !lifetime.active) return;
        const audioContext = AppState.getAudioContext();
        const audioBuffer = AppState.getSoundBuffer(recordingName);

        if (!audioContext || !audioBuffer) {
            console.warn(`Cannot play recording: ${recordingName}. AudioContext or buffer not available.`);
            return;
        }

        const voiceKey = soundSettings?.voiceKey || recordingName;
        const activeSource = AudioController.activeRecordingSources.get(voiceKey);
        const allowOverlap = soundSettings?.allowOverlap !== false;
        const retrigger = soundSettings?.retrigger !== false;
        const reverse = soundSettings?.reverse === true;
        if (activeSource) {
            if (!retrigger) return;
            if (!allowOverlap) {
                try { activeSource.stop(); } catch (_) { /* already ended */ }
            }
        }

        const source = audioContext.createBufferSource();
        if (lifetime && !lifetime.ownSource(source, () => {
            if (AudioController.activeRecordingSources.get(voiceKey) === source) {
                AudioController.activeRecordingSources.delete(voiceKey);
            }
        })) return;
        const offset = trimStart || 0;
        const end = trimEnd || audioBuffer.duration;
        const duration = end - offset;
        source.buffer = reverse ? getReversedAudioBuffer(audioContext, audioBuffer) : audioBuffer;

        // Apply pitch shift if available in soundSettings
        if (soundSettings && typeof soundSettings.pitchShift === 'number') {
            source.playbackRate.value = Math.pow(2, soundSettings.pitchShift / 12);
        }
        const playbackRate = source.playbackRate.value;
        source.playbackRate.value = Math.abs(playbackRate);

        const gainNode = audioContext.createGain();
        gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
        source.connect(gainNode);
        gainNode.connect(createSoundFilterInput(audioContext, destination || Monitoring.getOutput(audioContext), soundSettings));

        const startOffset = reverse ? audioBuffer.duration - end : offset;

        source.start(playTime, startOffset, duration > 0 ? duration : 0);
        AudioController.activeRecordingSources.set(voiceKey, source);
        source.addEventListener('ended', () => {
            if (AudioController.activeRecordingSources.get(voiceKey) === source) {
                AudioController.activeRecordingSources.delete(voiceKey);
            }
        });
    }
};

export default AudioController;
