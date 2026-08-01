import AppState from "./appState.js";
import TempoController from "./tempoController.js";
import MetronomeEngine from "./metronomeEngine.js";
import { sendState } from "./webrtc.js";

let speedTrainerState = {
  enabled: false,
  startBpm: 100,
  bpmStep: 5,
  stepBars: 2,
  maxBpm: 180,
  onMaxAction: "hold", // "hold", "stop", "reset"
  completedBars: 0,
};

const SpeedTrainerController = {
  init: () => {
    const btn = document.getElementById("speed-trainer-btn");
    const modal = document.getElementById("speed-trainer-modal");
    const closeBtn = modal ? modal.querySelector(".close-button") : null;

    if (btn && modal) {
      btn.addEventListener("click", () => {
        SpeedTrainerController.syncUIFromState();
        modal.style.display = "block";
      });
    }

    if (closeBtn && modal) {
      closeBtn.addEventListener("click", () => {
        modal.style.display = "none";
      });
    }

    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) modal.style.display = "none";
      });
    }

    // Bind UI inputs
    const enableToggle = document.getElementById("st-enable-toggle");
    const startBpmInput = document.getElementById("st-start-bpm");
    const bpmStepInput = document.getElementById("st-bpm-step");
    const stepBarsInput = document.getElementById("st-step-bars");
    const maxBpmInput = document.getElementById("st-max-bpm");
    const maxActionSelect = document.getElementById("st-max-action");

    if (enableToggle) {
      enableToggle.addEventListener("change", () => {
        speedTrainerState.enabled = enableToggle.checked;
        if (speedTrainerState.enabled) {
          speedTrainerState.completedBars = 0;
          // Set starting BPM if user enabled Speed Trainer
          AppState.setTempo(speedTrainerState.startBpm);
          TempoController.updateTempoDisplay({ animate: true });
        }
        SpeedTrainerController.updateStatus();
      });
    }

    const updateConfig = () => {
      if (startBpmInput) speedTrainerState.startBpm = parseInt(startBpmInput.value, 10) || 100;
      if (bpmStepInput) speedTrainerState.bpmStep = parseInt(bpmStepInput.value, 10) || 5;
      if (stepBarsInput) speedTrainerState.stepBars = parseInt(stepBarsInput.value, 10) || 2;
      if (maxBpmInput) speedTrainerState.maxBpm = parseInt(maxBpmInput.value, 10) || 180;
      if (maxActionSelect) speedTrainerState.onMaxAction = maxActionSelect.value || "hold";
      SpeedTrainerController.updateStatus();
    };

    [startBpmInput, bpmStepInput, stepBarsInput, maxBpmInput, maxActionSelect].forEach((input) => {
      if (input) input.addEventListener("input", updateConfig);
    });

    // Listen to bar position changes dispatched during metronome playback
    document.addEventListener("songpositionchange", () => {
      if (!speedTrainerState.enabled || !AppState.isPlaying()) return;

      speedTrainerState.completedBars++;
      SpeedTrainerController.onBarCompleted();
    });
  },

  onBarCompleted: () => {
    if (!speedTrainerState.enabled || !AppState.isPlaying()) return;

    if (speedTrainerState.completedBars % speedTrainerState.stepBars === 0) {
      const currentTempo = AppState.getTempo();

      if (currentTempo >= speedTrainerState.maxBpm) {
        if (speedTrainerState.onMaxAction === "stop") {
          MetronomeEngine.togglePlay(true);
        } else if (speedTrainerState.onMaxAction === "reset") {
          AppState.setTempo(speedTrainerState.startBpm);
          TempoController.updateTempoDisplay({ animate: true });
          speedTrainerState.completedBars = 0;
        }
        // If "hold", stay at maxBpm
      } else {
        const nextTempo = Math.min(speedTrainerState.maxBpm, currentTempo + speedTrainerState.bpmStep);
        AppState.setTempo(nextTempo);
        TempoController.updateTempoDisplay({ animate: true });
        if (window.isHost) sendState(AppState.getCurrentStateForPreset(true));
      }
    }
    SpeedTrainerController.updateStatus();
  },

  syncUIFromState: () => {
    const enableToggle = document.getElementById("st-enable-toggle");
    const startBpmInput = document.getElementById("st-start-bpm");
    const bpmStepInput = document.getElementById("st-bpm-step");
    const stepBarsInput = document.getElementById("st-step-bars");
    const maxBpmInput = document.getElementById("st-max-bpm");
    const maxActionSelect = document.getElementById("st-max-action");

    if (enableToggle) enableToggle.checked = speedTrainerState.enabled;
    if (startBpmInput) startBpmInput.value = speedTrainerState.startBpm;
    if (bpmStepInput) bpmStepInput.value = speedTrainerState.bpmStep;
    if (stepBarsInput) stepBarsInput.value = speedTrainerState.stepBars;
    if (maxBpmInput) maxBpmInput.value = speedTrainerState.maxBpm;
    if (maxActionSelect) maxActionSelect.value = speedTrainerState.onMaxAction;

    SpeedTrainerController.updateStatus();
  },

  updateStatus: () => {
    const statusText = document.getElementById("st-status-text");
    const btn = document.getElementById("speed-trainer-btn");

    if (btn) {
      btn.classList.toggle("active", speedTrainerState.enabled);
    }

    if (!statusText) return;

    if (!speedTrainerState.enabled) {
      statusText.textContent = "Speed Trainer is inactive.";
      return;
    }

    const currentBpm = AppState.getTempo();
    const barsUntilNext = speedTrainerState.stepBars - (speedTrainerState.completedBars % speedTrainerState.stepBars);

    if (currentBpm >= speedTrainerState.maxBpm) {
      statusText.textContent = `Target Max BPM (${speedTrainerState.maxBpm}) reached. Action: ${speedTrainerState.onMaxAction}.`;
    } else {
      statusText.textContent = `Active: ${currentBpm} BPM. Accelerating by +${speedTrainerState.bpmStep} BPM in ${barsUntilNext} bar(s).`;
    }
  },

  getState: () => ({ ...speedTrainerState }),
};

export default SpeedTrainerController;
