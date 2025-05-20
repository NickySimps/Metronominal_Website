/**
 * tempoController.js
 * This module handles UI updates and interactions for tempo control.
 */

import AppState from './appState.js';
import DOM from './domSelectors.js';

let lastTempoDescription = ""; // Private to this module

const TempoController = {
    updateTempoDisplay: () => {
        const tempo = AppState.getTempo();
        DOM.tempoDisplay.textContent = tempo;
        DOM.tempoSlider.value = tempo;

        let currentTempoDescription = "Moderate";
        if (tempo < 40) currentTempoDescription = "Grave";
        else if (tempo < 60) currentTempoDescription = "Largo";
        else if (tempo < 66) currentTempoDescription = "Lento";
        else if (tempo < 76) currentTempoDescription = "Adagio";
        else if (tempo < 108) currentTempoDescription = "Andante";
        else if (tempo < 120) currentTempoDescription = "Moderato";
        else if (tempo < 156) currentTempoDescription = "Allegro";
        else if (tempo < 176) currentTempoDescription = "Vivace";
        else if (tempo < 200) currentTempoDescription = "Presto";
        else currentTempoDescription = "Prestissimo";

        if (DOM.tempoTextElement) {
            if (currentTempoDescription !== lastTempoDescription) {
                if (DOM.tempoTextBox) {
                    DOM.tempoTextBox.classList.add('updating');
                    setTimeout(() => {
                        DOM.tempoTextElement.textContent = currentTempoDescription;
                        lastTempoDescription = currentTempoDescription;
                        DOM.tempoTextBox.classList.remove('updating');
                    }, 250);
                } else {
                    DOM.tempoTextElement.textContent = currentTempoDescription;
                    lastTempoDescription = currentTempoDescription;
                }
            } else if (!DOM.tempoTextElement.textContent) {
                DOM.tempoTextElement.textContent = currentTempoDescription;
                lastTempoDescription = currentTempoDescription;
            }
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
            AppState.setTempo(DOM.tempoSlider.value);
            TempoController.updateTempoDisplay();
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