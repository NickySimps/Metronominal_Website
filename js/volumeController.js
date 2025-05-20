/**
 * volumeController.js
 * This module handles UI updates and interactions for volume control.
 */

import AppState from './appState.js';
import DOM from './domSelectors.js';

const VolumeController = {
    updateVolumeDisplay: () => {
        if (DOM.volumeValueDisplay) {
            DOM.volumeValueDisplay.textContent = `${Math.round(AppState.getVolume() * 100)}%`;
        }
    },

    initializeVolumeControls: () => {
        if (DOM.volumeSlider) {
            DOM.volumeSlider.addEventListener('input', () => {
                AppState.setVolume(DOM.volumeSlider.value);
                VolumeController.updateVolumeDisplay();
            });
        }
    }
};

export default VolumeController;