import DOM from "./domSelectors.js";
import AppState from "./appState.js";
import { sendState } from "./webrtc.js";
import Oscilloscope from "./oscilloscope.js";

const SoundSettingsModal = {
  isDrawing: false,
  animationFrameId: null,

  init() {
    DOM.soundSettingsModal
      .querySelector(".close-button")
      .addEventListener("click", () => this.hide());
    DOM.soundSettingsModal.addEventListener("click", (e) => {
      if (e.target === DOM.soundSettingsModal) {
        this.hide();
      }
    });
  },
  updateSoundSetting(param, value) {
    const track = AppState.getTracks()[this.currentTrackIndex];
    const soundInfo = track[this.currentSoundType];

    soundInfo.settings[param] = value;

    AppState.updateTrack(this.currentTrackIndex, {
      [this.currentSoundType]: soundInfo,
    });
    sendState(AppState.getCurrentStateForPreset());
  },

  show(trackIndex, soundType) {
    this.currentTrackIndex = trackIndex;
    this.currentSoundType = soundType;

    const track = AppState.getTracks()[trackIndex];
    const soundInfo = track[soundType]; // Correctly get the sound object
    const soundSettings = soundInfo.settings;

    // Update modal title
    const modalTitle = DOM.soundSettingsModal.querySelector("h2");
    if (modalTitle) {
      // Extracts the sound name like "Kick" from "Synth Kick"
      const soundName = soundInfo.sound.replace("Synth ", "");
      modalTitle.textContent = `Editing: ${soundName}`;
    }

    if (!soundSettings) {
      console.log("No settings to adjust for this sound.");
      return;
    }

    const slidersContainer = DOM.soundSettingsModal.querySelector(
      "#sound-sliders-container"
    );
    slidersContainer.innerHTML = ""; // Clear previous sliders

    const createSlider = (param, min, max, step, value) => {
        const sliderContainer = document.createElement("div");
        sliderContainer.className = "slider-container";

        const label = document.createElement("label");
        label.textContent = param;
        sliderContainer.appendChild(label);

        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = min;
        slider.max = max;
        slider.step = step;
        slider.value = value;
        slider.dataset.param = param;
        slider.addEventListener("input", (e) => {
          const newValue = parseFloat(e.target.value);
          this.updateSoundSetting(e.target.dataset.param, newValue);
        });
        sliderContainer.appendChild(slider);

        slidersContainer.appendChild(sliderContainer);
    }

    const createADSRSlider = (param, value) => {
        const min = 0.001;
        const max = 2;
        const step = 0.01;
        createSlider(param, min, max, step, value);
    }

    createADSRSlider("attack", soundSettings.attack || 0.01);
    createADSRSlider("decay", soundSettings.decay || 0.1);
    createADSRSlider("sustain", soundSettings.sustain || 0.5);
    createADSRSlider("release", soundSettings.release || 0.2);

    for (const param in soundSettings) {
      if (typeof soundSettings[param] === "number" && !["attack", "decay", "sustain", "release"].includes(param)) {
        const min = param.toLowerCase().includes("frequency") ? 20 : 0.01;
        const max = param.toLowerCase().includes("frequency") ? 8000 : 1;
        const step = param.toLowerCase().includes("frequency") ? 1 : 0.01;
        createSlider(param, min, max, step, soundSettings[param]);
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
