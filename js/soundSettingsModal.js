import DOM from './domSelectors.js';
import AppState from './appState.js';
import Oscilloscope from './oscilloscope.js';

const SoundSettingsModal = {
    isDrawing: false,
    animationFrameId: null,

    init() {
        DOM.soundSettingsModal.querySelector('.close-button').addEventListener('click', () => this.hide());
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
                slider.min = 0.01;
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
        this.startDrawing(track.analyserNode);
    },

    hide() {
        DOM.soundSettingsModal.style.display = 'none';
        this.stopDrawing();
    },

    startDrawing(analyserNode) {
        const canvas = DOM.soundSettingsModal.querySelector('.oscilloscope-canvas');
        const ctx = canvas.getContext('2d');
        this.isDrawing = true;

        const draw = () => {
            if (!this.isDrawing) return;

            requestAnimationFrame(draw);

            const { width, height } = canvas.getBoundingClientRect();
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
            }
            
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            if (analyserNode) {
                const bufferLength = analyserNode.frequencyBinCount;
                const dataArray = new Uint8Array(bufferLength);
                analyserNode.getByteTimeDomainData(dataArray);

                const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
                gradient.addColorStop(0, '#ff00ff');
                gradient.addColorStop(0.5, '#00ffff');
                gradient.addColorStop(1, '#37ff48');

                ctx.lineWidth = 2;
                ctx.strokeStyle = gradient;
                ctx.beginPath();

                const sliceWidth = canvas.width * 1.0 / bufferLength;
                let x = 0;

                for (let i = 0; i < bufferLength; i++) {
                    const v = (dataArray[i] / 128.0);
                    const y = v * (canvas.height / 2);

                    if (i === 0) {
                        ctx.moveTo(x, y);
                    } else {
                        ctx.lineTo(x, y);
                    }

                    x += sliceWidth;
                }

                ctx.lineTo(canvas.width, canvas.height / 2);
                ctx.stroke();
            }
        };

        draw();
    },
    stopDrawing() {
        this.isDrawing = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
    }
};

export default SoundSettingsModal;