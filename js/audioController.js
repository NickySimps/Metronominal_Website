
import AppState from './appState.js';
import TrackController from './tracksController.js';
import DOM from './domSelectors.js';
import RecordingVisualizer from './recordingVisualizer.js';

const AudioController = {
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
            AudioController.analyserNode.connect(audioContext.destination);
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
                // Stop all tracks in the stream
                AudioController.recordingStream.getTracks().forEach(track => track.stop());

                const audioBlob = new Blob(AudioController.audioChunks, { type: 'audio/wav' });
                const arrayBuffer = await audioBlob.arrayBuffer();
                // audioContext is already defined above
                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

                const recordingName = `Recording ${AppState.getRecordings().length + 1}`;
                AppState.addRecording(recordingName);
                AppState.setSoundBuffer(recordingName, audioBuffer);

                AudioController.audioChunks = [];
                AppState.setRecording(false);
                TrackController.renderTracks();

                // Hide modal and stop visualizer/timer
                DOM.recordingDisplayModal.style.display = 'none';
                RecordingVisualizer.stop();
                clearInterval(AudioController.timerIntervalId);
            };

            AudioController.mediaRecorder.start();
        } catch (err) {
            console.error("Error accessing microphone:", err);
            // Optionally, show a message to the user
            // Hide modal if there was an error starting
            DOM.recordingDisplayModal.style.display = 'none';
            RecordingVisualizer.stop();
            clearInterval(AudioController.timerIntervalId);
        }
    },

    stopRecording: (trackIndex) => {
        if (AudioController.mediaRecorder && AppState.isRecording()) {
            AudioController.mediaRecorder.stop();
            // The rest of the cleanup is handled in mediaRecorder.onstop
        }
    },

    playRecording: (recordingName, trimStart = 0, trimEnd = null) => {
        const audioContext = AppState.getAudioContext();
        const audioBuffer = AppState.getSoundBuffer(recordingName);

        if (!audioContext || !audioBuffer) {
            console.warn(`Cannot play recording: ${recordingName}. AudioContext or buffer not available.`);
            return;
        }

        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);

        const offset = trimStart || 0;
        const duration = (trimEnd || audioBuffer.duration) - offset;

        source.start(0, offset, duration > 0 ? duration : 0);
    }
};

export default AudioController;
