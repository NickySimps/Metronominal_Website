/**
 * volumeController.js
 * This module handles UI updates and interactions for volume control.
 */

import AppState from "./appState.js";
import DOM from "./domSelectors.js";

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
          // Final update of text display (already done at the start for volume)
          if (DOM.volumeValueDisplay) {
            DOM.volumeValueDisplay.textContent = `${Math.round(
              targetVolume * 100
            )}%`;
          }
        }
      }
      requestAnimationFrame(animationStep);
    } else {
      if (slider) slider.value = targetVolume;
      // Text display already updated at the beginning of the function
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
        VolumeController.updateVolumeDisplay(); // Update UI
      });
    }
  },
};

export default VolumeController;
