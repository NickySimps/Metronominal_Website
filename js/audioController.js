
import AppState from './appState.js';
import TrackController from './tracksController.js';

const AudioController = {
    mediaRecorder: null,
    audioChunks: [],

    toggleRecording: async (trackIndex) => {
        if (AppState.isRecording()) {
            AudioController.stopRecording(trackIndex);
        } else {
            await AudioController.startRecording(trackIndex);
        }
    },

    startRecording: async (trackIndex) => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            AppState.setRecording(true);
            TrackController.renderTracks();

            AudioController.mediaRecorder = new MediaRecorder(stream);
            AudioController.mediaRecorder.ondataavailable = event => {
                AudioController.audioChunks.push(event.data);
            };

            AudioController.mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(AudioController.audioChunks, { type: 'audio/wav' });
                const arrayBuffer = await audioBlob.arrayBuffer();
                const audioContext = AppState.getAudioContext();
                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

                const recordingName = `Recording ${AppState.getRecordings().length + 1}`;
                AppState.addRecording(recordingName);
                AppState.setSoundBuffer(recordingName, audioBuffer);

                AudioController.audioChunks = [];
                AppState.setRecording(false);
                TrackController.renderTracks();
            };

            AudioController.mediaRecorder.start();
        } catch (err) {
            console.error("Error accessing microphone:", err);
            // Optionally, show a message to the user
        }
    },

    stopRecording: (trackIndex) => {
        if (AudioController.mediaRecorder && AppState.isRecording()) {
            AudioController.mediaRecorder.stop();
        }
    },

    playRecording: (recordingName) => {
        const audioContext = AppState.getAudioContext();
        const audioBuffer = AppState.getSoundBuffer(recordingName);

        if (!audioContext || !audioBuffer) {
            console.warn(`Cannot play recording: ${recordingName}. AudioContext or buffer not available.`);
            return;
        }

        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);
        source.start(0);
    }
};

export default AudioController;
