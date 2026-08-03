import AppState from './appState.js';
import TrackController from './tracksController.js';
import AudioController from './audioController.js';
import MetronomeEngine from './metronomeEngine.js';
import { sendState } from './webrtc.js';
import { audioBufferToWav } from './audioSerialization.js';

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes.toString().padStart(2, "0")}:${remainingSeconds
    .toString()
    .padStart(2, "0")}`;
}

const RecordingManager = {
  init: () => {
    const manageRecordingsBtn = document.getElementById("manage-recordings-btn");
    const modal = document.getElementById("manage-recordings-modal");
    const closeButton = modal ? modal.querySelector(".close-button") : null;
    const uploadBtn = document.getElementById("upload-sample-btn");
    const uploadInput = document.getElementById("upload-sample-input");
    const recordLoopBtn = document.getElementById("record-loop-btn");

    if (manageRecordingsBtn) {
      manageRecordingsBtn.addEventListener("click", () => {
        RecordingManager.openModal();
      });
    }

    if (closeButton) {
      closeButton.addEventListener("click", () => {
        modal.style.display = "none";
      });
    }

    // Sample File Upload Listener
    if (uploadBtn && uploadInput) {
      uploadBtn.addEventListener("click", () => uploadInput.click());
      uploadInput.addEventListener("change", async (e) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;

        const audioContext = AppState.getAudioContext() || AppState.initializeAudioContext();
        if (audioContext && audioContext.state === 'suspended') {
          await audioContext.resume();
        }

        for (const file of files) {
          try {
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            const cleanName = file.name.replace(/\.[^/.]+$/, "").trim() || "Custom Sample";
            AppState.addRecording(cleanName);
            AppState.setSoundBuffer(cleanName, audioBuffer);
          } catch (err) {
            console.error(`Failed to decode sample file ${file.name}:`, err);
            alert(`Could not decode file "${file.name}". Please ensure it is a valid audio file.`);
          }
        }

        uploadInput.value = "";
        RecordingManager.populateModal();
        TrackController.renderTracks();
        if (window.isHost) sendState(AppState.getCurrentStateForPreset(true));
      });
    }

    // Multi-Bar Loop Sampler Listener
    if (recordLoopBtn) {
      recordLoopBtn.addEventListener("click", () => {
        RecordingManager.startLoopSampler();
      });
    }

    if (modal) {
      modal.addEventListener("click", async (event) => {
        if (event.target === modal) {
          modal.style.display = "none";
        }
        if (event.target.classList.contains("delete-recording-btn")) {
          const recordingName = event.target.dataset.recordingName;
          AppState.deleteRecording(recordingName);
          if (window.isHost) {
            sendState(AppState.getCurrentStateForPreset(true));
          }
          RecordingManager.populateModal();
          TrackController.renderTracks();
        } else if (event.target.classList.contains("play-recording-btn")) {
          const recordingName = event.target.dataset.recordingName;
          AudioController.playRecording(recordingName, {});
        } else if (event.target.classList.contains("download-recording-btn")) {
          const recordingName = event.target.dataset.recordingName;
          const buffer = AppState.getSoundBuffer(recordingName);
          if (buffer) {
            try {
              const wavBuffer = await audioBufferToWav(buffer);
              const blob = new Blob([wavBuffer], { type: "audio/wav" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${recordingName.replace(/[^a-z0-9_-]/gi, '_')}.wav`;
              a.click();
              URL.revokeObjectURL(url);
            } catch (err) {
              console.error("Failed to download WAV:", err);
            }
          }
        } else if (event.target.classList.contains("rename-recording-btn")) {
          const oldName = event.target.dataset.recordingName;
          const recordingItem = event.target.closest(".recording-item");
          const nameSpan = recordingItem.querySelector(".recording-name-display");

          if (nameSpan) {
            const input = document.createElement("input");
            input.type = "text";
            input.value = oldName;
            input.className = "recording-name-input";
            input.dataset.oldName = oldName;

            nameSpan.replaceWith(input);
            input.focus();

            const handleRename = () => {
              const newName = input.value.trim();
              if (newName && newName !== oldName) {
                AppState.renameRecording(oldName, newName);
                if (window.isHost) {
                  sendState(AppState.getCurrentStateForPreset(true));
                }
                RecordingManager.populateModal();
                TrackController.renderTracks();
              } else {
                input.replaceWith(nameSpan);
              }
              input.removeEventListener("blur", handleRename);
              input.removeEventListener("keydown", handleKeydown);
            };

            const handleKeydown = (e) => {
              if (e.key === "Enter") {
                input.blur();
              } else if (e.key === "Escape") {
                input.value = oldName;
                input.blur();
              }
            };

            input.addEventListener("blur", handleRename);
            input.addEventListener("keydown", handleKeydown);
          }
        }
      });
    }
  },

  openModal: () => {
    const modal = document.getElementById("manage-recordings-modal");
    if (modal) {
      RecordingManager.populateModal();
      modal.style.display = "flex";
    }
  },

  startLoopSampler: async () => {
    const barsSelect = document.getElementById("loop-bars-select");
    const numBars = parseInt(barsSelect ? barsSelect.value : "4", 10) || 4;
    const bpm = AppState.getTempo();
    const primaryTrack = AppState.getTracks()[0];
    const beatsPerBar = primaryTrack && primaryTrack.barSettings.length ? primaryTrack.barSettings[0].beats : 4;

    const audioContext = AppState.getAudioContext() || AppState.initializeAudioContext();
    if (!audioContext) return;
    if (audioContext.state === "suspended") await audioContext.resume();

    // Duration calculation: (60 / BPM) * BeatsPerBar * NumBars
    const loopDurationSec = (60.0 / bpm) * beatsPerBar * numBars;

    // Create stream destination to record master audio
    const destinationNode = audioContext.createMediaStreamDestination
      ? audioContext.createMediaStreamDestination()
      : null;

    if (!destinationNode) {
      alert("MediaStreamDestination is not supported by your browser.");
      return;
    }

    // Record audio using MediaRecorder
    const chunks = [];
    const mediaRecorder = new MediaRecorder(destinationNode.stream);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    const recordLoopBtn = document.getElementById("record-loop-btn");
    const origText = recordLoopBtn ? recordLoopBtn.textContent : "";
    if (recordLoopBtn) {
      recordLoopBtn.textContent = `⏺ Sampling (${numBars} Bars)...`;
      recordLoopBtn.disabled = true;
    }

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(chunks, { type: "audio/wav" });
      const arrayBuffer = await audioBlob.arrayBuffer();
      const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer);

      const loopName = `Loop ${numBars}B @ ${bpm}BPM (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
      AppState.addRecording(loopName);
      AppState.setSoundBuffer(loopName, decodedBuffer);

      if (recordLoopBtn) {
        recordLoopBtn.textContent = origText;
        recordLoopBtn.disabled = false;
      }

      RecordingManager.populateModal();
      TrackController.renderTracks();
      if (window.isHost) sendState(AppState.getCurrentStateForPreset(true));
    };

    // Ensure metronome is playing
    if (!AppState.isPlaying()) {
      await MetronomeEngine.togglePlay();
    }

    mediaRecorder.start();

    setTimeout(() => {
      if (mediaRecorder.state === "recording") {
        mediaRecorder.stop();
      }
    }, Math.round(loopDurationSec * 1000));
  },

  populateModal: () => {
    const recordingsList = document.getElementById("recordings-list");
    if (!recordingsList) return;
    const recordings = AppState.getRecordings();

    recordingsList.innerHTML = "";

    if (recordings.length === 0) {
      recordingsList.innerHTML = "<p>No custom samples or loops saved yet.</p>";
      return;
    }

    recordings.forEach((recordingName) => {
      const recordingItem = document.createElement("div");
      recordingItem.className = "recording-item";

      const nameSpan = document.createElement("span");
      nameSpan.textContent = recordingName;
      nameSpan.className = "recording-name-display";
      recordingItem.appendChild(nameSpan);

      const audioBuffer = AppState.getSoundBuffer(recordingName);
      if (audioBuffer) {
        const durationSpan = document.createElement("span");
        durationSpan.className = "recording-duration";
        durationSpan.textContent = `(${formatDuration(audioBuffer.duration)})`;
        recordingItem.appendChild(durationSpan);
      }

      // Play button
      const playBtn = document.createElement("button");
      playBtn.className = "play-recording-btn preset-btn";
      playBtn.textContent = "▶";
      playBtn.title = "Play Sample";
      playBtn.dataset.recordingName = recordingName;
      recordingItem.appendChild(playBtn);

      // Download WAV button
      const downloadBtn = document.createElement("button");
      downloadBtn.className = "download-recording-btn preset-btn";
      downloadBtn.textContent = "💾 WAV";
      downloadBtn.title = "Download WAV file";
      downloadBtn.dataset.recordingName = recordingName;
      recordingItem.appendChild(downloadBtn);

      // Rename button
      const renameBtn = document.createElement("button");
      renameBtn.className = "rename-recording-btn preset-btn";
      renameBtn.textContent = "✎";
      renameBtn.title = "Rename Sample";
      renameBtn.dataset.recordingName = recordingName;
      recordingItem.appendChild(renameBtn);

      // Delete button
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "delete-recording-btn preset-btn";
      deleteBtn.textContent = "✖";
      deleteBtn.title = "Delete Sample";
      deleteBtn.dataset.recordingName = recordingName;
      recordingItem.appendChild(deleteBtn);

      recordingsList.appendChild(recordingItem);
    });
  },
};

export default RecordingManager;