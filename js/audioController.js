
import AppState from './appState.js';
import TrackController from './tracksController.js';
import DOM from './domSelectors.js';
import RecordingVisualizer from './recordingVisualizer.js';
import Monitoring from './monitoring.js';
import { emitInteractionMotion } from './interactionMotion.js';
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
        const cancel = () => AudioController.recordingSession?.cancel();
        document.addEventListener('roomauthoritychange', cancel);
        document.addEventListener('syncrolechange', cancel);
        const cancelMissingTrack = () => {
            const session = AudioController.recordingSession;
            if (session?.track && !AppState.getTracks().includes(session.track)) session.cancel();
        };
        AppState.subscribeMusicalMutations(cancelMissingTrack);
        // Snapshot replay reconstructs track identities without a musical mutation.
        document.addEventListener('appstatechange', cancelMissingTrack);
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
        const session = { track: AppState.getTracks()[trackIndex], authority: window.isHost, chunks: [], cancelled: false, stopping: false };
        const current = () => AudioController.recordingSession === session && !session.cancelled
            && session.authority === window.isHost && (!session.track || AppState.getTracks().includes(session.track));
        session.cancel = () => {
            session.cancelled = true;
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
            }
        };
        AudioController.recordingSession = session;
        try {
            const audioContext = AppState.getAudioContext() || AppState.initializeAudioContext();
            if (audioContext.state === 'suspended') await audioContext.resume();
            if (!current()) { session.cancel(); return; }
            session.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (!current()) { session.cancel(); return; }
            AudioController.recordingStream = session.stream;
            session.source = audioContext.createMediaStreamSource(session.stream);
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
                DOM.recordingDisplayModal.style.display = 'flex';
                DOM.recordingTimer.textContent = '00:00';
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
        if (!session.recorder) { session.cancel(); return; }
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
