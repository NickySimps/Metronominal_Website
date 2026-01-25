import DOM from "./domSelectors.js";
import AppState from "./appState.js";
import { sendState } from "./webrtc.js";
import RecordingVisualizer from './recordingVisualizer.js';
import Oscilloscope from "./oscilloscope.js";


import { frequencyToNote, noteToFrequency, noteStrings, generateNoteFrequencies, semitonesToInterval } from "./utils.js";
import { Slider } from './slider.js';

const SoundSettingsModal = {
  isNoteSnapping: false,
  isQuantizing: false,
  sliders: [],

  init() {
    DOM.soundSettingsModal
      .querySelector(".close-button")
      .addEventListener("click", () => this.hide());
    DOM.soundSettingsModal.addEventListener("click", (e) => {
      if (e.target === DOM.soundSettingsModal) {
        this.hide();
      }
    });
    DOM.soundSettingsModal.querySelector("#reset-sound-btn").addEventListener("click", () => this.resetSoundSettings());
    DOM.soundSettingsModal.querySelector("#note-snap-btn").addEventListener("click", (e) => {
        this.isNoteSnapping = !this.isNoteSnapping;
        e.target.classList.toggle("active", this.isNoteSnapping);

        this.sliders.forEach(slider => {
            const param = slider.sliderElement.dataset.param;
            if (param.toLowerCase().includes("frequency")) {
                const min = slider.sliderElement.min;
                const max = slider.sliderElement.max;
                const snapPoints = this.isNoteSnapping ? generateNoteFrequencies(min, max) : null;
                slider.updateSnapPoints(snapPoints);
            }
        });
    });
    DOM.soundSettingsModal.querySelector("#quantize-btn").addEventListener("click", (e) => {
        this.isQuantizing = !this.isQuantizing;
        e.target.classList.toggle("active", this.isQuantizing);
    });
  },

  resetSoundSettings() {
    const track = AppState.getTracks()[this.currentTrackIndex];
    const soundInfo = track[this.currentSoundType];

    let newSettings = {};

    // Check if it's a recorded sound (has audioBuffer attached for modal display)
    if (soundInfo.audioBuffer) {
        newSettings = {
            trimStart: 0,
            trimEnd: soundInfo.audioBuffer.duration,
            pitchShift: 0,
        };
    } else {
        // For synth sounds, get default settings from AppState
        const defaultSettings = AppState.getDefaultSoundSettings(soundInfo.sound);
        newSettings = JSON.parse(JSON.stringify(defaultSettings));
    }

    soundInfo.settings = newSettings;

    AppState.updateTrack(this.currentTrackIndex, {
      [this.currentSoundType]: soundInfo,
    });
    sendState(AppState.getCurrentStateForPreset());

    this.show(this.currentTrackIndex, this.currentSoundType);

    const trackElement = document.querySelector(`.track[data-container-index="${this.currentTrackIndex}"]`);
    if (trackElement) {
        const soundLabel = trackElement.querySelector(this.currentSoundType === 'mainBeatSound' ? '.main-sound-label' : '.sub-sound-label');
        if (soundLabel) {
            soundLabel.classList.remove('modified-sound');
        }
    }
  },

  updateSoundSetting(param, value) {
    let valueToSave = value;
    if (["attack", "decay", "sustain", "release", "pitchEnvelopeTime", "trimStart", "trimEnd"].includes(param)) {
        valueToSave = value / 1000;
    } else if (param.toLowerCase() === "volume") {
        valueToSave = value / 100;
    } else if (param === "pitchShift") {
        valueToSave = value;
    }

    const track = AppState.getTracks()[this.currentTrackIndex];
    const soundInfo = track[this.currentSoundType];

    if (this.isNoteSnapping && param.toLowerCase().includes("frequency")) {
        const note = frequencyToNote(valueToSave);
        valueToSave = noteToFrequency(note);
    }

    soundInfo.settings[param] = valueToSave;

    AppState.updateTrack(this.currentTrackIndex, {
      [this.currentSoundType]: soundInfo,
    });
    sendState(AppState.getCurrentStateForPreset());

    if (["trimStart", "trimEnd"].includes(param)) {
        if (this.drawWaveformAndTrimLines) {
            this.drawWaveformAndTrimLines(soundInfo.audioBuffer);
        }
    }

    const slider = DOM.soundSettingsModal.querySelector(`[data-param="${param}"]`);
    if (slider) {
        let displayValue = value;
        if (this.isNoteSnapping && param.toLowerCase().includes("frequency")) {
            displayValue = valueToSave;
        }
        slider.value = displayValue;

        const valueDisplay = slider.parentElement.nextElementSibling;
        if (param.toLowerCase().includes("frequency")) {
            valueDisplay.textContent = `${parseFloat(slider.value).toFixed(2)} Hz (${frequencyToNote(slider.value)})`;
        } else if (["attack", "decay", "sustain", "release", "pitchEnvelopeTime", "trimStart", "trimEnd"].includes(param)) {
            valueDisplay.textContent = `${slider.value} ms`;
        } else if (param.toLowerCase() === "volume") {
            valueDisplay.textContent = `${slider.value}%`;
        } else {
            valueDisplay.textContent = `${slider.value} semitones (${semitonesToInterval(slider.value)})`;
        }
    }

    const isModified = AppState.isSoundModified(this.currentTrackIndex, this.currentSoundType);
    const trackElement = document.querySelector(`.track[data-container-index="${this.currentTrackIndex}"]`);
    if (trackElement) {
        const soundLabel = trackElement.querySelector(this.currentSoundType === 'mainBeatSound' ? '.main-sound-label' : '.sub-sound-label');
        if (soundLabel) {
            soundLabel.classList.toggle('modified-sound', isModified);
        }
    }
  },

  createSlider(slidersContainer, param, min, max, step, value) {
    const sliderContainer = document.createElement("div");
    sliderContainer.className = "slider-container";

    const label = document.createElement("label");
    label.textContent = param;
    sliderContainer.appendChild(label);

    const sliderWrapper = document.createElement("div");
    sliderWrapper.className = "slider-wrapper";

    const decrementButton = document.createElement("span");
    decrementButton.className = "slider-button-decrement";
    decrementButton.textContent = "-";
    sliderWrapper.appendChild(decrementButton);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = min;
    slider.max = max;
    slider.step = step;
    slider.value = value;
    slider.dataset.param = param;
    sliderWrapper.appendChild(slider);

    const incrementButton = document.createElement("span");
    incrementButton.className = "slider-button-increment";
    incrementButton.textContent = "+";
    sliderWrapper.appendChild(incrementButton);

    sliderContainer.appendChild(sliderWrapper);

    const valueDisplay = document.createElement("span");
    if (param.toLowerCase().includes("frequency")) {
        valueDisplay.textContent = `${value.toFixed(2)} Hz (${frequencyToNote(value)})`;
    } else if (["attack", "decay", "sustain", "release", "pitchEnvelopeTime", "trimStart", "trimEnd"].includes(param)) {
        valueDisplay.textContent = `${value.toFixed(0)} ms`;
    } else if (param.toLowerCase() === "volume") {
        valueDisplay.textContent = `${value}%`;
    } else if (param === "pitchShift") {
        valueDisplay.textContent = `${value} semitones (${semitonesToInterval(value)})`;
    } else {
        valueDisplay.textContent = value;
    }    sliderContainer.appendChild(valueDisplay);

    slidersContainer.appendChild(sliderContainer);

    const snapPoints = this.isNoteSnapping && param.toLowerCase().includes("frequency")
        ? generateNoteFrequencies(min, max)
        : null;

    const sliderInstance = new Slider(slider, decrementButton, incrementButton, {
        initialValue: value,
        snapPoints: snapPoints,
        onValueChange: (newValue) => {
            this.updateSoundSetting(param, newValue);
        },
        onIncrement: (currentValue) => {
            if (this.isQuantizing && param === "pitchShift") {
                const quantizeSteps = [-48, -43, -36, -31, -24, -19, -12, -7, 0, 7, 12, 19, 24, 31, 36, 43, 48];
                let nextValue = currentValue;
                let found = false;
                for (const step of quantizeSteps) {
                    if (step > currentValue) {
                        nextValue = step;
                        found = true;
                        break;
                    }
                }
                if (!found) { // If currentValue is already at or past the max quantized step
                    nextValue = 48; // Cap at max
                }
                return nextValue;
            } else {
                return currentValue + step;
            }
        },
        onDecrement: (currentValue) => {
            if (this.isQuantizing && param === "pitchShift") {
                const quantizeSteps = [-48, -43, -36, -31, -24, -19, -12, -7, 0, 7, 12, 19, 24, 31, 36, 43, 48];
                let nextValue = currentValue;
                let found = false;
                for (let i = quantizeSteps.length - 1; i >= 0; i--) {
                    const step = quantizeSteps[i];
                    if (step < currentValue) {
                        nextValue = step;
                        found = true;
                        break;
                    }
                }
                if (!found) { // If currentValue is already at or before the min quantized step
                    nextValue = -48; // Cap at min
                }
                return nextValue;
            } else {
                return currentValue - step;
            }
        }
    });
    this.sliders.push(sliderInstance);
  },

  show(trackIndex, soundType) {
    this.currentTrackIndex = trackIndex;
    this.currentSoundType = soundType;

    const track = AppState.getTracks()[trackIndex];
    const soundInfo = track[soundType];
    const soundSettings = soundInfo.settings;

    const oscilloscopeCanvas = DOM.soundSettingsModal.querySelector(".oscilloscope-canvas");

    // Check if it's a recorded sound and retrieve its audioBuffer
    if (!soundInfo.sound.startsWith("Synth ")) { // Assuming recorded sounds don't start with "Synth "
        const recordedAudioBuffer = AppState.getSoundBuffer(soundInfo.sound);
        if (recordedAudioBuffer instanceof AudioBuffer) {
            soundInfo.audioBuffer = recordedAudioBuffer; // Temporarily attach audioBuffer for modal's use
        }
    }

    const modalTitle = DOM.soundSettingsModal.querySelector(".modal-header h2");
    const noteSnapBtn = DOM.soundSettingsModal.querySelector("#note-snap-btn");
    const quantizeBtn = DOM.soundSettingsModal.querySelector("#quantize-btn");

    if (modalTitle) {
      const soundName = soundInfo.sound.replace("Synth ", "");
      modalTitle.textContent = `Editing: ${soundName}`;
    }

    if (!soundSettings) {
      soundInfo.settings = {}; // Initialize if null/undefined
      soundSettings = soundInfo.settings;
    }

    const slidersContainer = DOM.soundSettingsModal.querySelector("#sound-sliders-container");
    slidersContainer.innerHTML = "";
    this.sliders = [];

    if (soundInfo.audioBuffer instanceof AudioBuffer) {
        // Recorded sound
        noteSnapBtn.style.display = 'none';
        quantizeBtn.style.display = 'inline-block';
        this.isQuantizing = quantizeBtn.classList.contains('active');
        this.isNoteSnapping = false; // Ensure note snapping is off for recorded sounds

        const waveformContainer = document.createElement("div");
        waveformContainer.className = "waveform-container";
        const waveformCanvas = document.createElement("canvas");
        waveformCanvas.className = "waveform-canvas";
        waveformContainer.appendChild(waveformCanvas);
        slidersContainer.appendChild(waveformCanvas);

        const mainColor = getComputedStyle(document.documentElement).getPropertyValue("--Main").trim();

        this.drawWaveformAndTrimLines = (buffer) => {
            RecordingVisualizer.drawWaveform(buffer, waveformCanvas, mainColor);
            const ctx = waveformCanvas.getContext('2d');
            const trimStart = (soundSettings.trimStart || 0);
            const trimEnd = (soundSettings.trimEnd || buffer.duration);
            const startX = (trimStart / buffer.duration) * waveformCanvas.width;
            const endX = (trimEnd / buffer.duration) * waveformCanvas.width;

            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.fillRect(0, 0, startX, waveformCanvas.height);
            ctx.fillRect(endX, 0, waveformCanvas.width - endX, waveformCanvas.height);
        };

        this.drawWaveformAndTrimLines(soundInfo.audioBuffer);

        const trimStart = soundSettings.trimStart ? soundSettings.trimStart * 1000 : 0;
        const trimEnd = soundSettings.trimEnd ? soundSettings.trimEnd * 1000 : soundInfo.audioBuffer.duration * 1000;

        this.createSlider(slidersContainer, "trimStart", 0, soundInfo.audioBuffer.duration * 1000, 1, trimStart);
        this.createSlider(slidersContainer, "trimEnd", 0, soundInfo.audioBuffer.duration * 1000, 1, trimEnd);
        this.createSlider(slidersContainer, "pitchShift", -48, 48, 1, (soundSettings.pitchShift || 0));
    } else {
        // Synth sound
        noteSnapBtn.style.display = 'inline-block';
        quantizeBtn.style.display = 'none';
        this.isNoteSnapping = noteSnapBtn.classList.contains('active');
        this.isQuantizing = false; // Ensure quantization is off for synth sounds

        oscilloscopeCanvas.style.display = 'block';
        this.createSlider(slidersContainer, "attack", 1, 2000, 1, (soundSettings.attack || 0.01) * 1000);
        this.createSlider(slidersContainer, "decay", 1, 2000, 1, (soundSettings.decay || 0.1) * 1000);
        this.createSlider(slidersContainer, "sustain", 1, 2000, 1, (soundSettings.sustain || 0.5) * 1000);
        this.createSlider(slidersContainer, "release", 1, 2000, 1, (soundSettings.release || 0.2) * 1000);
    }

    for (const param in soundSettings) {
      if (typeof soundSettings[param] === "number" && !["attack", "decay", "sustain", "release", "trimStart", "trimEnd", "pitchShift"].includes(param)) {
        const isTimeBased = param === 'pitchEnvelopeTime';
        const isVolume = param.toLowerCase() === 'volume';
        const min = param.toLowerCase().includes("frequency") ? 20 : (isTimeBased ? 1 : (isVolume ? 0 : 0.01));
        const max = param.toLowerCase().includes("frequency") ? 8000 : (isTimeBased ? 2000 : (isVolume ? 100 : 1));
        const step = param.toLowerCase().includes("frequency") ? 1 : (isTimeBased ? 1 : (isVolume ? 1 : 0.01));
        const value = isTimeBased ? soundSettings[param] * 1000 : (isVolume ? soundSettings[param] * 100 : soundSettings[param]);
        this.createSlider(slidersContainer, param, min, max, step, value);
      }
    }

    DOM.soundSettingsModal.style.display = "block";
    this.startDrawing(track.analyserNode);
  },

  hide() {
    DOM.soundSettingsModal.style.display = "none";
    this.stopDrawing();
  },

  startDrawing(analyserNode) {
    const canvas = DOM.soundSettingsModal.querySelector(".oscilloscope-canvas");
    const ctx = canvas.getContext("2d");
    this.isDrawing = true;

    const draw = () => {
      if (!this.isDrawing) return;

      requestAnimationFrame(draw);

      const { width, height } = canvas.getBoundingClientRect();
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (analyserNode) {
        const bufferLength = analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyserNode.getByteTimeDomainData(dataArray);

        // Get color variables from the stylesheet
        const mainColor = getComputedStyle(document.documentElement)
          .getPropertyValue("--Main")
          .trim();
        const accentColor = getComputedStyle(document.documentElement)
          .getPropertyValue("--Accent")
          .trim();
        const highlightColor = getComputedStyle(document.documentElement)
          .getPropertyValue("--Highlight")
          .trim();

        const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
        gradient.addColorStop(0, mainColor);
        gradient.addColorStop(0.5, accentColor);
        gradient.addColorStop(1, highlightColor);

        ctx.lineWidth = 2;
        ctx.strokeStyle = gradient;
        ctx.beginPath();

        const sliceWidth = (canvas.width * 1.0) / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const v = dataArray[i] / 128.0;
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
  },
};

export default SoundSettingsModal;