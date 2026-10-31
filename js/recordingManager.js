import AppState from './appState.js';
import { emitInteractionMotion } from './interactionMotion.js';
import TrackController from './tracksController.js';
import AudioController from './audioController.js';
import MetronomeEngine from './metronomeEngine.js';
import Monitoring from './monitoring.js';
import { sendState } from './webrtc.js';
import { audioBufferToWav } from './audioSerialization.js';

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes.toString().padStart(2, "0")}:${remainingSeconds
    .toString()
    .padStart(2, "0")}`;
}

const savedPlaybackFeedback = new WeakMap();
const sampleFeedbackCurrent = (modal, generation) => modal?.isConnected
  && modal.style.display === 'flex' && generation === RecordingManager.modalGeneration;
const recordedNameTarget = (modal, name) => [...modal.querySelectorAll('.recording-name-display')]
  .find(node => node.textContent === name);
function closeSamplesModal(modal) {
  const wasOpen = modal.style.display === 'flex';
  RecordingManager.modalGeneration += 1;
  modal.style.display = 'none';
  RecordingManager.loopSamplerSession?.cancel();
  if (wasOpen) emitInteractionMotion(document.getElementById('manage-recordings-btn'), 'close');
}

const RecordingManager = {
  uploadGeneration: 0,
  modalGeneration: 0,
  loopSamplerTimeoutId: null,
  loopSamplerRecorder: null,
  loopSamplerDestination: null,
  loopSamplerSession: null,
  init: () => {
    if (!RecordingManager.authorityBoundaryHandler) {
      RecordingManager.authorityBoundaryHandler = () => {
        RecordingManager.uploadGeneration += 1;
        RecordingManager.modalGeneration += 1;
        RecordingManager.loopSamplerSession?.cancel();
      };
      document.addEventListener('roomauthoritychange', RecordingManager.authorityBoundaryHandler);
      document.addEventListener('syncrolechange', RecordingManager.authorityBoundaryHandler);
    }
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
        closeSamplesModal(modal);
      });
    }

    // Sample File Upload Listener
    if (uploadBtn && uploadInput) {
      uploadBtn.addEventListener("click", () => uploadInput.click());
      uploadInput.addEventListener("change", async (e) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;
        // Own the selection immediately; an older completion must not clear a newer one.
        uploadInput.value = "";
        const generation = ++RecordingManager.uploadGeneration;
        const modalGeneration = RecordingManager.modalGeneration;
        const authority = window.isHost;
        const feedbackCurrent = () => generation === RecordingManager.uploadGeneration
          && modalGeneration === RecordingManager.modalGeneration && authority === window.isHost
          && modal?.style.display !== "none";

        const audioContext = AppState.getAudioContext() || AppState.initializeAudioContext();
        if (audioContext && audioContext.state === 'suspended') {
          await audioContext.resume();
        }

        for (const file of files) {
          let accepted = false;
          try {
            const arrayBuffer = await file.arrayBuffer();
            if (!feedbackCurrent()) return;
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            if (!feedbackCurrent()) return;
            const cleanName = file.name.replace(/\.[^/.]+$/, "").trim() || "Custom Sample";
            AppState.addRecording(cleanName);
            AppState.setSoundBuffer(cleanName, audioBuffer);
            accepted = AppState.getRecordings().includes(cleanName) && AppState.getSoundBuffer(cleanName) === audioBuffer;
          } catch (err) {
            if (!feedbackCurrent()) return;
            emitInteractionMotion(uploadBtn, "refuse");
            console.error(`Failed to decode sample file ${file.name}:`, err);
            alert(`Could not decode file "${file.name}". Please ensure it is a valid audio file.`);
          }
          // A committed file owns its completion before any next asynchronous
          // file read. Cancelling the remainder must not strand earlier commits.
          if (accepted) {
            RecordingManager.populateModal();
            TrackController.renderTracks();
            if (feedbackCurrent()) {
              if (window.isHost) sendState(AppState.getCurrentStateForPreset(true));
              emitInteractionMotion(uploadBtn, "upload");
            }
          }
        }
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
          closeSamplesModal(modal);
        }
        if (event.target.classList.contains("delete-recording-btn")) {
          const recordingName = event.target.dataset.recordingName;
          const existed = AppState.getRecordings().includes(recordingName);
          AppState.deleteRecording(recordingName);
          const accepted = existed && !AppState.getRecordings().includes(recordingName) && !AppState.getSoundBuffer(recordingName);
          emitInteractionMotion(event.target, accepted ? 'remove' : 'refuse');
          if (window.isHost) {
            sendState(AppState.getCurrentStateForPreset(true));
          }
          RecordingManager.populateModal();
          TrackController.renderTracks();
        } else if (event.target.classList.contains("play-recording-btn")) {
          const recordingName = event.target.dataset.recordingName;
          const button = event.target, generation = RecordingManager.modalGeneration;
          const before = AudioController.activeRecordingSources.get(recordingName);
          const buffer = AppState.getSoundBuffer(recordingName);
          try { AudioController.playRecording(recordingName, {}); }
          catch (error) { emitInteractionMotion(button, 'refuse'); throw error; }
          const source = AudioController.activeRecordingSources.get(recordingName);
          // Native playback publishes this identity only after source.start.
          if (source && source !== before) {
            const token = {};
            savedPlaybackFeedback.set(button, token);
            emitInteractionMotion(button, AppState.getAudioContext()?.state === 'running' ? 'audition' : 'pending');
            source.addEventListener('ended', () => {
              const owns = savedPlaybackFeedback.get(button) === token;
              if (owns) savedPlaybackFeedback.delete(button);
              if (owns && sampleFeedbackCurrent(modal, generation) && button.isConnected
                && button.dataset.recordingName === recordingName && AppState.getSoundBuffer(recordingName) === buffer) emitInteractionMotion(button, 'stop');
            }, { once: true });
          } else emitInteractionMotion(button, 'refuse');
        } else if (event.target.classList.contains("download-recording-btn")) {
          const recordingName = event.target.dataset.recordingName;
          const buffer = AppState.getSoundBuffer(recordingName);
          if (buffer) {
            const generation = RecordingManager.modalGeneration, button = event.target;
            try {
              const wavBuffer = await audioBufferToWav(buffer);
              const blob = new Blob([wavBuffer], { type: "audio/wav" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${recordingName.replace(/[^a-z0-9_-]/gi, '_')}.wav`;
              a.click();
              URL.revokeObjectURL(url);
              // Browser download initiation, not a durable-storage promise.
              if (sampleFeedbackCurrent(modal, generation) && AppState.getSoundBuffer(recordingName) === buffer) emitInteractionMotion(button, 'download');
            } catch (err) {
              console.error("Failed to download WAV:", err);
              if (sampleFeedbackCurrent(modal, generation)) emitInteractionMotion(button, 'refuse');
            }
          } else emitInteractionMotion(event.target, 'refuse');
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

            const generation = RecordingManager.modalGeneration;
            let cancelled = false;
            const handleRename = () => {
              const newName = input.value.trim();
              const current = sampleFeedbackCurrent(modal, generation) && input.isConnected;
              if (newName && newName !== oldName) {
                const before = AppState.getSoundBuffer(oldName), existed = AppState.getRecordings().includes(oldName);
                AppState.renameRecording(oldName, newName);
                if (window.isHost) {
                  sendState(AppState.getCurrentStateForPreset(true));
                }
                RecordingManager.populateModal();
                TrackController.renderTracks();
                const accepted = existed && !AppState.getRecordings().includes(oldName)
                  && AppState.getRecordings().includes(newName) && AppState.getSoundBuffer(newName) === before;
                if (current && sampleFeedbackCurrent(modal, generation)) emitInteractionMotion(recordedNameTarget(modal, accepted ? newName : oldName), accepted ? 'rename' : 'refuse');
              } else {
                input.replaceWith(nameSpan);
                if (current && (cancelled || !newName)) emitInteractionMotion(nameSpan, 'cancel');
              }
              input.removeEventListener("blur", handleRename);
              input.removeEventListener("keydown", handleKeydown);
            };

            const handleKeydown = (e) => {
              if (e.key === "Enter") {
                input.blur();
              } else if (e.key === "Escape") {
                cancelled = true;
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
      const wasOpen = modal.style.display === 'flex';
      RecordingManager.modalGeneration += 1;
      RecordingManager.populateModal();
      modal.style.display = "flex";
      if (!wasOpen) emitInteractionMotion(modal.querySelector('.modal-content') || modal, 'open');
    }
  },

  startLoopSampler: async () => {
    // Own setup and finalization too, not just MediaRecorder's recording state.
    if (RecordingManager.loopSamplerSession) return;
    const button = document.getElementById('record-loop-btn');
    const modal = document.getElementById('manage-recordings-modal');
    const generation = RecordingManager.modalGeneration;
    const authority = window.isHost;
    const session = {};
    RecordingManager.loopSamplerSession = session;
    const current = () => RecordingManager.loopSamplerSession === session
      && sampleFeedbackCurrent(modal, generation) && window.isHost === authority;
    const feedback = kind => { if (current()) emitInteractionMotion(button, kind); };
    const originalText = button?.textContent;
    if (button) button.disabled = true;
    feedback('pending');
    let context, destination, output, recorder, failed = false, released = false;
    let cancelPlaybackWait = () => {};
    const releaseBranch = () => {
      cancelPlaybackWait();
      if (released) return;
      released = true;
      clearTimeout(RecordingManager.loopSamplerTimeoutId);
      RecordingManager.loopSamplerTimeoutId = null;
      // Never disconnect the monitoring output's existing speaker/track routes.
      if (output && destination) {
        try { output.disconnect(destination); } catch (_) { /* Already detached. */ }
      }
      if (destination) {
        destination.disconnect();
        destination.stream.getTracks().forEach(track => track.stop());
      }
      RecordingManager.loopSamplerDestination = null;
    };
    const finish = () => {
      releaseBranch();
      if (RecordingManager.loopSamplerSession !== session) return;
      RecordingManager.loopSamplerRecorder = null;
      RecordingManager.loopSamplerSession = null;
      if (button) { button.textContent = originalText; button.disabled = false; }
    };
    // Keep boundary cancellation owned for setup, recording and async finalization;
    // playback-wait listeners alone disappear as soon as playback starts.
    session.cancel = () => {
      failed = true; // Queued native stop/error events must not finalize this sample.
      try {
        if (recorder && recorder.state !== 'inactive') recorder.stop();
      } finally { finish(); }
    };
    const refuse = error => {
      failed = true;
      feedback('refuse');
      console.error('Loop sampler failed:', error);
      if (recorder && recorder.state !== 'inactive') {
        try { recorder.stop(); } catch (_) { /* Native error already stopped it. */ }
      }
      finish();
    };
    try {
      const numBars = parseInt(document.getElementById('loop-bars-select')?.value || '4', 10) || 4;
      const bpm = AppState.getTempo();
      const beatsPerBar = AppState.getTracks()[0]?.barSettings?.[0]?.beats || 4;
      context = AppState.getAudioContext() || AppState.initializeAudioContext();
      if (!context) throw new Error('AudioContext is unavailable');
      if (context.state === 'suspended') await context.resume();
      if (!current()) { finish(); return; }
      if (context.state !== 'running') throw new Error('AudioContext is not running');
      destination = context.createMediaStreamDestination();
      RecordingManager.loopSamplerDestination = destination;
      output = Monitoring.getOutput(context);
      // Fan out the existing post-monitor mix; do not add another speaker path.
      output.connect(destination);
      recorder = new MediaRecorder(destination.stream);
      RecordingManager.loopSamplerRecorder = recorder;
      const chunks = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstart = () => {
        if (failed) return;
        if (button) button.textContent = `⏺ Sampling (${numBars} Bars)...`;
        feedback('record-start');
      };
      recorder.onerror = event => refuse(event.error || new Error('Native recording failed'));
      recorder.onstop = async () => {
        if (failed) return;
        feedback('record-stop');
        releaseBranch();
        try {
          if (!current()) return;
          const type = recorder.mimeType || chunks[0]?.type || '';
          const bytes = await new Blob(chunks, { type }).arrayBuffer();
          const decodedBuffer = await context.decodeAudioData(bytes);
          if (!current()) return;
          const loopName = `Loop ${numBars}B @ ${bpm}BPM (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
          AppState.addRecording(loopName);
          AppState.setSoundBuffer(loopName, decodedBuffer);
          RecordingManager.populateModal();
          TrackController.renderTracks();
          if (window.isHost) sendState(AppState.getCurrentStateForPreset(true));
          if (AppState.getRecordings().includes(loopName) && AppState.getSoundBuffer(loopName) === decodedBuffer) feedback('sample');
          else feedback('refuse');
        } catch (error) {
          feedback('refuse');
          console.error('Could not finalize loop sample:', error);
        } finally { finish(); }
      };
      if (!AppState.isPlaying()) {
        // A joined host's toggle acknowledges command submission, not playback.
        // Subscribe before sending so even a synchronous local start cannot race us.
        const playbackStarted = new Promise(resolve => {
          let settled = false;
          const settle = started => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            observer.disconnect();
            document.removeEventListener('playbackstatechange', check);
            document.removeEventListener('roomauthoritychange', cancel);
            document.removeEventListener('syncrolechange', cancel);
            cancelPlaybackWait = () => {};
            resolve(started);
          };
          const check = () => {
            if (!current()) settle(false);
            else if (AppState.isPlaying()) settle(true);
          };
          const cancel = () => settle(false);
          const observer = new MutationObserver(check);
          const timeout = setTimeout(cancel, 10000);
          cancelPlaybackWait = cancel;
          observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
          document.addEventListener('playbackstatechange', check);
          document.addEventListener('roomauthoritychange', cancel);
          document.addEventListener('syncrolechange', cancel);
        });
        await MetronomeEngine.togglePlay();
        const started = await playbackStarted;
        if (!current()) { finish(); return; }
        if (!started) throw new Error('Playback did not start within 10 seconds');
      }
      if (!current()) { finish(); return; }
      if (!AppState.isPlaying()) throw new Error('Playback did not start');
      recorder.start();
      RecordingManager.loopSamplerTimeoutId = setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, Math.round((60 / bpm) * beatsPerBar * numBars * 1000));
    } catch (error) { refuse(error); }
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