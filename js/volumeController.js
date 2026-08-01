/**
 * volumeController.js
 * This module handles UI updates and interactions for volume control.
 */

import AppState from "./appState.js";
import DOM from "./domSelectors.js";
import { sendState } from "./webrtc.js";

const VolumeController = {
  updateVolumeDisplay: (options = { animate: false }) => {
    const targetVolume = AppState.getVolume();
    const slider = DOM.volumeSlider;

    // Update numerical display immediately to target value
    if (DOM.volumeValueDisplay) {
      DOM.volumeValueDisplay.textContent = `${Math.round(targetVolume * 100)}%`;
    }

    if (
      options.animate &&
      slider &&
      parseFloat(slider.value) !== targetVolume
    ) {
      const startValue = parseFloat(slider.value);
      const duration = 300; // Animation duration in ms
      let startTime = null;

      function animationStep(currentTime) {
        if (startTime === null) startTime = currentTime;
        const elapsedTime = currentTime - startTime;
        const progress = Math.min(elapsedTime / duration, 1);
        const currentValue =
          startValue + (targetVolume - startValue) * progress;

        slider.value = currentValue;

        if (progress < 1) {
          requestAnimationFrame(animationStep);
        } else {
          slider.value = targetVolume; // Ensure final value is precise
          if (DOM.volumeValueDisplay) {
            DOM.volumeValueDisplay.textContent = `${Math.round(
              targetVolume * 100
            )}%`;
          }
        }
      }
      requestAnimationFrame(animationStep);
    } else {
      if (slider) {
        slider.value = targetVolume;
        const pct = Math.round(targetVolume * 100);
        slider.setAttribute("aria-valuenow", String(pct));
        slider.setAttribute("aria-valuemin", "0");
        slider.setAttribute("aria-valuemax", "100");
        slider.setAttribute("aria-valuetext", `${pct}%`);
      }
    }

    if (VolumeController.onVolumeChange) {
      VolumeController.onVolumeChange();
    }
  },

  registerVolumeChangeListener: (callback) => {
    VolumeController.onVolumeChange = callback;
  },

  initializeVolumeControls: () => {
    if (DOM.volumeSlider) {
      DOM.volumeSlider.addEventListener("input", () => {
        AppState.setVolume(DOM.volumeSlider.value); // Update state
        sendState(AppState.getCurrentStateForPreset(true)); // Lightweight sync
        VolumeController.updateVolumeDisplay(); // Update UI
      });
    }
  },
};

export default VolumeController;
