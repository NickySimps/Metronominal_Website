/**
 * stickyControls.js
 * Manages the collapsed playback controls that appear when the main transport is out of view.
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
      sendState(AppState.getCurrentStateForPreset(true));
      TempoController.updateTempoDisplay(); // Updates main UI
    });

    els.tempoIncrease.addEventListener("click", () => {
      AppState.increaseTempo();
      sendState(AppState.getCurrentStateForPreset(true));
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
        sendState(AppState.getCurrentStateForPreset(true));
      }
    });

    els.volumeIncrease.addEventListener("click", () => {
      let currentVol = AppState.getVolume();
      let newVol = Math.min(1, currentVol + 0.05); // 5% step
      AppState.setVolume(newVol);
      VolumeController.updateVolumeDisplay();
      if (window.isHost) {
        sendState(AppState.getCurrentStateForPreset(true));
      }
    });
  },

  setupScrollListener: () => {
    const updateFloatingState = () => {
      const startStopBtn = DOM.startStopBtn;
      if (!startStopBtn) return;

      const rect = startStopBtn.getBoundingClientRect();
      const mainTransportIsVisible = rect.bottom > 0
        && rect.top < window.innerHeight
        && rect.right > 0
        && rect.left < window.innerWidth;
      const floatingControlsAreActive = !mainTransportIsVisible;
      StickyControls.elements.container.classList.toggle("sticky-active", floatingControlsAreActive);
      StickyControls.elements.container.toggleAttribute("inert", !floatingControlsAreActive);
      StickyControls.elements.container.setAttribute("aria-hidden", String(!floatingControlsAreActive));
    };

    window.addEventListener("scroll", updateFloatingState, { passive: true });
    window.addEventListener("resize", updateFloatingState);
    if ("IntersectionObserver" in window) {
      StickyControls.visibilityObserver = new IntersectionObserver(updateFloatingState, { threshold: 0 });
      StickyControls.visibilityObserver.observe(DOM.startStopBtn);
    }
    if ("MutationObserver" in window) {
      StickyControls.layoutObserver = new MutationObserver(updateFloatingState);
      const mainContainer = document.querySelector(".main-container");
      if (mainContainer) {
        StickyControls.layoutObserver.observe(mainContainer, { childList: true, subtree: true });
      }
      StickyControls.layoutObserver.observe(DOM.startStopBtn, { attributes: true, attributeFilter: ["class", "style"] });
    }
    updateFloatingState();
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
