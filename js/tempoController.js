/**
 * tempoController.js
 * This module handles UI updates and interactions for tempo control.
 */

import AppState from './appState.js';
import DOM from './domSelectors.js';

let lastTempoDescription = ""; // Private to this module
// Private helper function to get tempo description string
function _getTempoDescription(tempo) {
    if (tempo < 40) return "Grave";
    if (tempo < 60) return "Largo";
    if (tempo < 66) return "Lento";
    if (tempo < 76) return "Adagio";
    if (tempo < 108) return "Andante";
    if (tempo < 120) return "Moderato";
    if (tempo < 156) return "Allegro";
    if (tempo < 176) return "Vivace";
    if (tempo < 200) return "Presto";
    return "Prestissimo";
}

// Private helper function to update the DOM for tempo description
function _updateTempoDescriptionDOM(newDescription) {
    if (DOM.tempoTextElement) {
        // Update if description changed or if text element is currently empty
        if (newDescription !== lastTempoDescription || !DOM.tempoTextElement.textContent) {
            if (DOM.tempoTextBox) {
                DOM.tempoTextBox.classList.add('updating');
                // Short delay for CSS transition on 'updating' class, if any
                setTimeout(() => {
                    DOM.tempoTextElement.textContent = newDescription;
                    lastTempoDescription = newDescription;
                    DOM.tempoTextBox.classList.remove('updating');
                }, 50); // Adjusted delay
            } else {
                DOM.tempoTextElement.textContent = newDescription;
                lastTempoDescription = newDescription;
            }
        }
    }
}

const TempoController = {
    updateTempoDisplay: (options = { animate: false }) => {
        const targetTempo = AppState.getTempo();
        const slider = DOM.tempoSlider;

        // Update numerical display immediately to target value
        DOM.tempoDisplay.textContent = targetTempo;
        const currentTempoDescription = _getTempoDescription(targetTempo);

        if (options.animate && slider && parseFloat(slider.value) !== targetTempo) {
            const startValue = parseFloat(slider.value);
            const duration = 300; // Animation duration in ms
            let startTime = null;

            function animationStep(currentTime) {
                if (startTime === null) startTime = currentTime;
                const elapsedTime = currentTime - startTime;
                const progress = Math.min(elapsedTime / duration, 1);
                const currentValue = startValue + (targetTempo - startValue) * progress;
                slider.value = currentValue;

                if (progress < 1) {
                    requestAnimationFrame(animationStep);
                } else {
                    slider.value = targetTempo; // Ensure final value is precise
                    _updateTempoDescriptionDOM(currentTempoDescription); // Update description text at the end
                }
            }
            requestAnimationFrame(animationStep);
        } else {
            if (slider) slider.value = targetTempo;
            _updateTempoDescriptionDOM(currentTempoDescription);
        }
    },

    initializeTempoControls: () => {
        DOM.increaseTempoBtn.addEventListener('click', () => {
            AppState.increaseTempo();
            TempoController.updateTempoDisplay();
        });
        DOM.decreaseTempoBtn.addEventListener('click', () => {
            AppState.decreaseTempo();
            TempoController.updateTempoDisplay();
        });
        DOM.tempoSlider.addEventListener('input', () => {
            AppState.setTempo(DOM.tempoSlider.value); // Update state
            TempoController.updateTempoDisplay();     // Update UI (slider value already matches, but updates text and description)
        });
        if (DOM.tapTempoBtn) {
            DOM.tapTempoBtn.addEventListener('click', () => {
                AppState.addTapTimestamp(Date.now());
                AppState.calculateTapTempo(); // This updates AppState.tempo
                TempoController.updateTempoDisplay(); // Reflect change
                if (DOM.tapTempoBtn) DOM.tapTempoBtn.classList.add('tapped');
                setTimeout(() => { if (DOM.tapTempoBtn) DOM.tapTempoBtn.classList.remove('tapped'); }, 100);
            });
        }
    }
};

export default TempoController;