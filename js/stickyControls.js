/**
 * stickyControls.js
 * Manages the sticky mobile header controls that appear on scroll.
 */

import AppState from "./appState.js";
import MetronomeEngine from "./metronomeEngine.js";
import TempoController from "./tempoController.js";
import VolumeController from "./volumeController.js";
import DOM from "./domSelectors.js";
import { sendState } from "./webrtc.js";

const StickyControls = {
  elements: {},

  init: () => {
    StickyControls.elements = {
      container: document.getElementById("sticky-mobile-controls"),
      tempoDecrease: document.getElementById("sticky-tempo-decrease"),
      tempoIncrease: document.getElementById("sticky-tempo-increase"),
      bpmDisplay: document.getElementById("sticky-bpm-display"),
      playPauseBtn: document.getElementById("sticky-play-pause-btn"),
      volumeDecrease: document.getElementById("sticky-volume-decrease"),
      volumeIncrease: document.getElementById("sticky-volume-increase"),
      volumeValue: document.getElementById("sticky-volume-value"),
    };

    if (!StickyControls.elements.container) return;

    StickyControls.setupEventListeners();
    StickyControls.setupScrollListener();
    
    // Initial sync
    StickyControls.updateDisplay();
    
    // Hook into global updates (optional, but good for robust sync)
    // For now, we rely on the fact that AppState updates usually trigger UI updates.
    // We can add a listener or poll if needed, but manual calls in event handlers work for local actions.
    // For remote/state updates, we might need to hook into `refreshUIFromState` in script.js.
  },

  setupEventListeners: () => {
    const els = StickyControls.elements;

    // Tempo
    els.tempoDecrease.addEventListener("click", () => {
      AppState.decreaseTempo();
      sendState(AppState.getCurrentStateForPreset());
      TempoController.updateTempoDisplay(); // Updates main UI
    });

    els.tempoIncrease.addEventListener("click", () => {
      AppState.increaseTempo();
      sendState(AppState.getCurrentStateForPreset());
      TempoController.updateTempoDisplay();
    });

    // Play/Pause
    els.playPauseBtn.addEventListener("click", async () => {
      await MetronomeEngine.togglePlay();
    });

    // Volume
    els.volumeDecrease.addEventListener("click", () => {
      let currentVol = AppState.getVolume();
      let newVol = Math.max(0, currentVol - 0.05); // 5% step
      AppState.setVolume(newVol);
      VolumeController.updateVolumeDisplay();
      if (window.isHost) {
        sendState(AppState.getCurrentStateForPreset());
      }
    });

    els.volumeIncrease.addEventListener("click", () => {
      let currentVol = AppState.getVolume();
      let newVol = Math.min(1, currentVol + 0.05); // 5% step
      AppState.setVolume(newVol);
      VolumeController.updateVolumeDisplay();
      if (window.isHost) {
        sendState(AppState.getCurrentStateForPreset());
      }
    });
  },

  setupScrollListener: () => {
    window.addEventListener("scroll", () => {
      // Logic to show sticky header only after scrolling past the main play button
      const startStopBtn = DOM.startStopBtn;
      if (!startStopBtn) return;

      const rect = startStopBtn.getBoundingClientRect();

      // Show sticky controls when the main play button is scrolled out of view (above viewport)
      if (rect.bottom < 0) {
        StickyControls.elements.container.classList.add("sticky-active");
      } else {
        StickyControls.elements.container.classList.remove("sticky-active");
      }
    });
  },

  updateDisplay: () => {
    const els = StickyControls.elements;
    if (els.bpmDisplay) {
      els.bpmDisplay.textContent = AppState.getTempo();
    }
    if (els.volumeValue) {
      els.volumeValue.textContent = Math.round(AppState.getVolume() * 100) + "%";
    }
    StickyControls.updatePlayButtonState();
  },

  updatePlayButtonState: () => {
    const els = StickyControls.elements;
    const isPlaying = AppState.isPlaying();
    if (els.playPauseBtn) {
      els.playPauseBtn.textContent = isPlaying ? "❚❚" : "▶";
      els.playPauseBtn.classList.toggle("active", isPlaying);
    }
  }
};

export default StickyControls;
