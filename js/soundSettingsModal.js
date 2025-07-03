// js/soundSettingsModal.js
import DOM from './domSelectors.js';
import AppState from './appState.js';

const SoundSettingsModal = {
    init() {
        DOM.soundSettingsModal.querySelector('.close-button').addEventListener('click', () => this.hide());
        // Close modal if user clicks outside the modal content
        DOM.soundSettingsModal.addEventListener('click', (e) => {
            if (e.target === DOM.soundSettingsModal) {
                this.hide();
            }
        });
    },
    updateSoundSetting(param, value) {
    const track = AppState.getTracks()[this.currentTrackIndex];
    const soundInfo = track[this.currentSoundType];
    
    soundInfo.settings[param] = value;

    AppState.updateTrack(this.currentTrackIndex, { [this.currentSoundType]: soundInfo });
},

    show(trackIndex, soundType) {
      this.currentTrackIndex = trackIndex;
        this.currentSoundType = soundType;

        const track = AppState.getTracks()[trackIndex];
        const soundInfo = track[soundType]; // Correctly get the sound object
        const soundSettings = soundInfo.settings;

        // Update modal title
        const modalTitle = DOM.soundSettingsModal.querySelector('h2');
        if (modalTitle) {
            // Extracts the sound name like "Kick" from "Synth Kick"
            const soundName = soundInfo.sound.replace('Synth ', '');
            modalTitle.textContent = `Editing: ${soundName}`;
        }
        
        if (!soundSettings) {
            console.log("No settings to adjust for this sound.");
            return;
        }

        const slidersContainer = DOM.soundSettingsModal.querySelector('#sound-sliders-container');
        slidersContainer.innerHTML = ''; // Clear previous sliders

        for (const param in soundSettings) {
            if (typeof soundSettings[param] === 'number') {
                const sliderContainer = document.createElement('div');
                sliderContainer.className = 'slider-container';

                const label = document.createElement('label');
                label.textContent = param;
                sliderContainer.appendChild(label);

                const slider = document.createElement('input');
                slider.type = 'range';
                slider.min = 0;
                slider.max = 1;
                if (param.toLowerCase().includes('frequency')) {
                    slider.min = 20;
                    slider.max = 8000;
                }
                slider.step = 0.01;
                if (param.toLowerCase().includes('frequency')) {
                    slider.step = 1;
                }
                slider.value = soundSettings[param];
                slider.dataset.param = param;
                slider.addEventListener('input', (e) => {
                const newValue = parseFloat(e.target.value);
                this.updateSoundSetting(e.target.dataset.param, newValue);
            });
                sliderContainer.appendChild(slider);
                

                slidersContainer.appendChild(sliderContainer);
            }
        }

        DOM.soundSettingsModal.style.display = 'block';
    },

    hide() {
        DOM.soundSettingsModal.style.display = 'none';
    },


};

export default SoundSettingsModal;