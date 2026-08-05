
import AppState from './appState.js';
import TrackController from './tracksController.js';
import DOM from './domSelectors.js';
import RecordingVisualizer from './recordingVisualizer.js';
import { createSoundFilterInput, getReversedAudioBuffer } from './audioEffects.js';

function cleanupRecordingSession() {
    AudioController.recordingStream?.getTracks().forEach(track => track.stop());
    AudioController.recordingStream = null;
    AudioController.audioChunks = [];
    AppState.setRecording(false);
    TrackController.renderTracks();
    if (DOM.recordingDisplayModal) DOM.recordingDisplayModal.style.display = 'none';
    RecordingVisualizer.stop();
    if (AudioController.timerIntervalId) clearInterval(AudioController.timerIntervalId);
    AudioController.timerIntervalId = null;
    AudioController.mediaRecorder = null;
}

const AudioController = {
    activeRecordingSources: new Map(),
    mediaRecorder: null,
    audioChunks: [],
    recordingStream: null, // To store the MediaStream
    analyserNode: null, // To store the AnalyserNode for visualization
    timerIntervalId: null,
    startTime: 0,

    initialize: () => {
        if (DOM.recordingStopBtn) {
            DOM.recordingStopBtn.addEventListener('click', () => {
                AudioController.stopRecording();
            });
        }
    },

    toggleRecording: async (trackIndex) => {
        if (AppState.isRecording()) {
            AudioController.stopRecording(trackIndex);
        } else {
            await AudioController.startRecording(trackIndex);
        }
    },

    startRecording: async (trackIndex) => {
        try {
            const audioContext = AppState.getAudioContext();
            if (audioContext && audioContext.state === 'suspended') {
                await audioContext.resume();
                console.log("AudioContext resumed by startRecording.");
            }

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            AudioController.recordingStream = stream; // Store the stream

            AppState.setRecording(true);
            TrackController.renderTracks();

            // Show recording modal
            DOM.recordingDisplayModal.style.display = 'flex';
            DOM.recordingTimer.textContent = '00:00'; // Reset timer display


            const source = audioContext.createMediaStreamSource(stream);
            AudioController.analyserNode = audioContext.createAnalyser();
            source.connect(AudioController.analyserNode);
            // AudioController.analyserNode.connect(audioContext.destination); // Removed to prevent feedback
            RecordingVisualizer.init(AudioController.analyserNode, DOM.recordingWaveformCanvas);
            RecordingVisualizer.start();

            // Start timer
            AudioController.startTime = Date.now();
            AudioController.timerIntervalId = setInterval(() => {
                const elapsedTime = Date.now() - AudioController.startTime;
                const minutes = Math.floor(elapsedTime / 60000);
                const seconds = Math.floor((elapsedTime % 60000) / 1000);
                DOM.recordingTimer.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            }, 1000);

            AudioController.mediaRecorder = new MediaRecorder(stream);
            AudioController.mediaRecorder.ondataavailable = event => {
                AudioController.audioChunks.push(event.data);
            };

            AudioController.mediaRecorder.onstop = async () => {
                try {
                    const audioBlob = new Blob(AudioController.audioChunks, { type: 'audio/wav' });
                    const arrayBuffer = await audioBlob.arrayBuffer();
                    const audioBufferDecoded = await audioContext.decodeAudioData(arrayBuffer);
                    const recordingName = `Recording ${AppState.getRecordings().length + 1}`;
                    AppState.addRecording(recordingName);
                    AppState.setSoundBuffer(recordingName, audioBufferDecoded);

                    if (typeof trackIndex === 'number') {
                        AppState.updateTrack(trackIndex, {
                            mainBeatSound: {
                                sound: recordingName,
                                settings: { trimStart: 0, trimEnd: audioBufferDecoded.duration, pitchShift: 0 }
                            }
                        });
                    }
                } catch (error) {
                    console.error("Could not finalize recording:", error);
                } finally {
                    cleanupRecordingSession();
                }
            };

            AudioController.mediaRecorder.start();
        } catch (err) {
            console.error("Error accessing microphone:", err);
            alert("Could not access microphone. Please ensure a microphone is connected and permissions are granted.");
            cleanupRecordingSession();
        }
    },

    stopRecording: (trackIndex) => {
        if (AudioController.mediaRecorder && AppState.isRecording()) {
            AudioController.mediaRecorder.stop();
            // The rest of the cleanup is handled in mediaRecorder.onstop
        }
    },

    playRecording: (recordingName, soundSettings, trimStart = 0, trimEnd = null, playTime = 0, volume = 1.0, destination = null) => {
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
        gainNode.connect(createSoundFilterInput(audioContext, destination || audioContext.destination, soundSettings));

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
