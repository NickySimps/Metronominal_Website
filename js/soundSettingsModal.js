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
  isGridSnapping: false,
  sliders: [],
  currentAudioBuffer: null,
  currentTrackIndex: null,
  currentSoundType: null,
  originalSoundName: "", // The name of the sound when modal opened (e.g., "Synth Kick", "My Preset")
  displaySoundName: "", // The name currently displayed/edited

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
    DOM.soundSettingsModal.querySelector("#grid-snap-btn").addEventListener("click", (e) => {
        this.isGridSnapping = !this.isGridSnapping;
        e.target.classList.toggle("active", this.isGridSnapping);
        if (this.currentAudioBuffer && this.drawWaveformAndTrimLines) {
            this.drawWaveformAndTrimLines(this.currentAudioBuffer);
        }
    });

    // Rename Button Logic
    const renameBtn = DOM.soundSettingsModal.querySelector("#rename-sound-btn");
    const modalTitle = DOM.soundSettingsModal.querySelector(".modal-header h2");
    
    if (renameBtn && modalTitle) {
        renameBtn.addEventListener("click", () => {
            const currentText = modalTitle.textContent.replace("Editing: ", "").replace(" (Custom)", "").replace(" (Modified)", "");
            const input = document.createElement("input");
            input.type = "text";
            input.value = currentText;
            input.className = "compact-input";
            input.style.fontSize = "1.5rem";
            input.style.width = "auto";
            
            modalTitle.textContent = "";
            modalTitle.appendChild(input);
            input.focus();

            const commitChange = () => {
                if (input.value.trim() !== "") {
                    this.displaySoundName = input.value.trim();
                    modalTitle.textContent = `Editing: ${this.displaySoundName}`;
                } else {
                    modalTitle.textContent = `Editing: ${currentText}`; // Revert if empty
                }
            };

            input.addEventListener("blur", commitChange);
            input.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    commitChange();
                }
            });
        });
    }

    // Save Button Logic
    const saveBtn = DOM.soundSettingsModal.querySelector("#save-sound-btn");
    if (saveBtn) {
        saveBtn.addEventListener("click", () => {
            this.saveCustomSound();
        });
    }

    // Delete Button Logic
    const deleteBtn = DOM.soundSettingsModal.querySelector("#delete-sound-btn");
    if (deleteBtn) {
        deleteBtn.addEventListener("click", () => {
            const soundName = this.originalSoundName;
            if (AppState.getCustomSoundData(soundName)) {
                this.showConfirmationModal(
                    "Delete Sound",
                    `Are you sure you want to delete "${soundName}"?`,
                    () => {
                        AppState.deleteCustomSound(soundName);
                        document.dispatchEvent(new CustomEvent("soundSaved"));
                        // Refresh modal to show updated state (defaults or fallback sound)
                        this.show(this.currentTrackIndex, this.currentSoundType);
                    }
                );
            }
        });
    }
  },

  showConfirmationModal(title, message, onConfirm) {
      const modal = document.getElementById("confirmation-modal");
      const titleEl = document.getElementById("confirmation-modal-title");
      const messageEl = document.getElementById("confirmation-modal-message");
      const confirmBtn = document.getElementById("confirmation-modal-confirm-btn");
      const cancelBtn = document.getElementById("confirmation-modal-cancel-btn");

      if (!modal || !titleEl || !messageEl || !confirmBtn || !cancelBtn) return;

      titleEl.textContent = title;
      messageEl.textContent = message;

      const closeModal = () => {
          modal.style.display = "none";
          // Remove event listeners to prevent duplicates/memory leaks
          confirmBtn.removeEventListener("click", handleConfirm);
          cancelBtn.removeEventListener("click", handleCancel);
          window.removeEventListener("click", handleOutsideClick);
      };

      const handleConfirm = () => {
          onConfirm();
          closeModal();
      };

      const handleCancel = () => {
          closeModal();
      };

      const handleOutsideClick = (event) => {
          if (event.target === modal) {
              closeModal();
          }
      };

      confirmBtn.addEventListener("click", handleConfirm);
      cancelBtn.addEventListener("click", handleCancel);
      window.addEventListener("click", handleOutsideClick);

      modal.style.display = "block";
  },

  saveCustomSound() {
      // 1. Determine the name to save as
      let nameToSave = this.displaySoundName;
      
      // Remove status suffixes if present (unless user typed them explicitly, but let's assume not)
      nameToSave = nameToSave.replace(" (Custom)", "").replace(" (Modified)", "");

      if (!nameToSave) {
          alert("Please provide a name for the custom sound.");
          return;
      }

      // 2. Determine base sound
      // If the *original* sound was a custom sound, get its base. 
      // If it was a default sound, IT is the base.
      let baseSound = this.originalSoundName;
      if (AppState.getCustomSoundData(this.originalSoundName)) {
          baseSound = AppState.getCustomSoundData(this.originalSoundName).baseSound;
      } else if (AppState.getRecordings().includes(this.originalSoundName)) {
           // It's a recording, treat as base sound? 
           // Currently recordings are handled differently (buffers), not param settings.
           // You can't really "save as preset" a recording easily unless we support custom recording presets.
           // For now, let's assume this feature is primarily for SYNTH sounds as per prompt context about parameters.
           // But if it IS a recording, we might just be saving trim/pitch settings.
           // AppState.addCustomSound supports { baseSound, settings }.
           baseSound = this.originalSoundName; 
      }

      // 3. Get current settings
      const track = AppState.getTracks()[this.currentTrackIndex];
      const soundInfo = track[this.currentSoundType];
      const settings = soundInfo.settings;

      // 4. Save to AppState
      try {
        AppState.addCustomSound(nameToSave, baseSound, settings);
        
        // 5. Update the track to use this new sound
        AppState.updateTrack(this.currentTrackIndex, {
            [this.currentSoundType]: {
                sound: nameToSave,
                settings: settings // Keep current settings
            }
        });

        // 6. Refresh UI
        document.dispatchEvent(new CustomEvent("soundSaved"));
        
        // 7. Update Modal State
        this.originalSoundName = nameToSave;
        this.displaySoundName = nameToSave;
        const modalTitle = DOM.soundSettingsModal.querySelector(".modal-header h2");
        if (modalTitle) modalTitle.textContent = `Editing: ${nameToSave}`;

        const deleteBtn = DOM.soundSettingsModal.querySelector("#delete-sound-btn");
        if (deleteBtn) {
            deleteBtn.style.display = "inline-block";
        }

        console.log(`Saved custom sound: ${nameToSave}`);

      } catch (e) {
          console.error("Error saving sound:", e);
          alert("Failed to save sound.");
      }
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
        // If it's a custom sound, reset to ITS saved state, not the global default for the base sound.
        // Wait, "Reset" usually means reset to factory defaults. 
        // If I'm editing "My Kick", "Reset" should probably go back to "My Kick" original state.
        
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
            valueDisplay.textContent = `${parseFloat(displayValue).toFixed(2)} Hz (${frequencyToNote(displayValue)})`;
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

    // Update title to show modified status
    const modalTitle = DOM.soundSettingsModal.querySelector(".modal-header h2");
    if (modalTitle && isModified) {
        if (!this.displaySoundName.includes(" (Custom)") && !this.displaySoundName.includes(" (Modified)")) {
            const suffix = AppState.getCustomSoundData(this.originalSoundName) ? " (Modified)" : " (Custom)";
            this.displaySoundName = this.originalSoundName + suffix;
            modalTitle.textContent = `Editing: ${this.displaySoundName}`;
        }
    }
  },

  findNearestZeroCrossing(valueMs) {
      if (!this.currentAudioBuffer) return valueMs;

      const buffer = this.currentAudioBuffer;
      // Safety check for channels
      if (buffer.numberOfChannels === 0) return valueMs;

      const data = buffer.getChannelData(0); 
      const sampleRate = buffer.sampleRate;
      const index = Math.floor((valueMs / 1000) * sampleRate);
      
      // Search range: +/- 20ms
      const range = Math.floor(sampleRate * 0.02); 
      const start = Math.max(0, index - range);
      const end = Math.min(data.length - 1, index + range);

      let bestIndex = index;
      let minDiff = Infinity;

      for (let i = start; i < end; i++) {
          if (i === 0) continue;
          
          const val = data[i];
          const prev = data[i-1];
          
          // Zero crossing: sign change or exactly zero
          if ((val >= 0 && prev < 0) || (val < 0 && prev >= 0) || val === 0) {
             const diff = Math.abs(i - index);
             if (diff < minDiff) {
                 minDiff = diff;
                 bestIndex = i;
             }
          }
      }
      
      return (bestIndex / sampleRate) * 1000;
  },

  getGridSnap(valueMs) {
      const bpm = AppState.getTempo();
      if (!bpm) return valueMs;
      
      // 1 beat in ms
      const beatDuration = 60000 / bpm;
      // 16th note = 1/4 of a beat
      const gridInterval = beatDuration / 4;
      
      return Math.round(valueMs / gridInterval) * gridInterval;
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

    let snapFn = null;
    if (param === 'trimStart' || param === 'trimEnd') {
        snapFn = (val) => {
            let snappedVal = val;
            if (this.isGridSnapping) {
                 snappedVal = this.getGridSnap(snappedVal);
                 // If both active, snap zero crossing relative to the grid point?
                 // Or just strictly follow grid?
                 // Let's make Zero Crossing refine the Grid selection if both are active.
                 // i.e., find zero crossing NEAREST to the grid point.
                 if (this.isQuantizing) {
                     snappedVal = this.findNearestZeroCrossing(snappedVal);
                 }
            } else if (this.isQuantizing) {
                 snappedVal = this.findNearestZeroCrossing(snappedVal);
            }
            return snappedVal;
        };
    }

    const sliderInstance = new Slider(slider, decrementButton, incrementButton, {
        initialValue: value,
        snapPoints: snapPoints,
        snapFn: snapFn,
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
    
    // Auto-repair if sound data is corrupted/missing
    if (!soundInfo.sound) {
        console.warn(`Track ${trackIndex} ${soundType} missing sound name. Repairing...`);
        soundInfo.sound = (soundType === 'mainBeatSound') ? "Synth Kick" : "Synth HiHat";
        if (!soundInfo.settings) {
            soundInfo.settings = AppState.getDefaultSoundSettings(soundInfo.sound);
        }
    }

    const soundSettings = soundInfo.settings;

    const oscilloscopeCanvas = DOM.soundSettingsModal.querySelector(".oscilloscope-canvas");

    this.currentAudioBuffer = null;
    // Check if it's a recorded sound (or custom sound based on one) and retrieve its audioBuffer
    let soundNameForBuffer = soundInfo.sound;
    const customSoundData = AppState.getCustomSoundData(soundInfo.sound);
    if (customSoundData) {
        soundNameForBuffer = customSoundData.baseSound;
    }

    const recordedAudioBuffer = AppState.getSoundBuffer(soundNameForBuffer);
    if (recordedAudioBuffer instanceof AudioBuffer) {
        soundInfo.audioBuffer = recordedAudioBuffer; // Temporarily attach audioBuffer for modal's use
        this.currentAudioBuffer = recordedAudioBuffer;
    }

    const modalTitle = DOM.soundSettingsModal.querySelector(".modal-header h2");
    const noteSnapBtn = DOM.soundSettingsModal.querySelector("#note-snap-btn");
    const quantizeBtn = DOM.soundSettingsModal.querySelector("#quantize-btn");
    const gridSnapBtn = DOM.soundSettingsModal.querySelector("#grid-snap-btn");
    const deleteBtn = DOM.soundSettingsModal.querySelector("#delete-sound-btn");

    // Clean name for display/state
    const soundName = soundInfo.sound; // E.g. "Synth Kick" or "My Kick"
    this.originalSoundName = soundName;
    this.displaySoundName = soundName;

    // Toggle Delete Button Visibility
    if (deleteBtn) {
        if (AppState.getCustomSoundData(soundName)) {
            deleteBtn.style.display = "inline-block";
        } else {
            deleteBtn.style.display = "none";
        }
    }

    // Check if currently modified compared to what it SHOULD be
    const isModified = AppState.isSoundModified(trackIndex, soundType);
    if (isModified) {
         const suffix = AppState.getCustomSoundData(soundName) ? " (Modified)" : " (Custom)";
         this.displaySoundName += suffix;
    }

    if (modalTitle) {
      modalTitle.textContent = `Editing: ${this.displaySoundName}`;
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
        
        gridSnapBtn.style.display = 'inline-block';
        this.isGridSnapping = gridSnapBtn.classList.contains('active');

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

            if (this.isGridSnapping) {
                const bpm = AppState.getTempo();
                if (bpm > 0) {
                    const beatDuration = 60000 / bpm;
                    const gridInterval = beatDuration / 4; // 16th notes
                    const durationMs = buffer.duration * 1000;
                    const width = waveformCanvas.width;
                    
                    ctx.beginPath();
                    // Use a color that contrasts but isn't too distracting. 
                    // Since background is likely dark (from RecordingVisualizer), a light grey with opacity.
                    ctx.strokeStyle = 'rgba(200, 200, 200, 0.3)'; 
                    ctx.lineWidth = 1;

                    // Optimize loop: compute x directly
                    const pixelsPerMs = width / durationMs;
                    const gridPixels = gridInterval * pixelsPerMs;

                    for (let x = 0; x < width; x += gridPixels) {
                        ctx.moveTo(x, 0);
                        ctx.lineTo(x, waveformCanvas.height);
                    }
                    ctx.stroke();
                }
            }

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
        gridSnapBtn.style.display = 'none';
        
        this.isNoteSnapping = noteSnapBtn.classList.contains('active');
        this.isQuantizing = false; 
        this.isGridSnapping = false;

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