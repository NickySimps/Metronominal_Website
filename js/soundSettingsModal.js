import DOM from "./domSelectors.js";
import { emitInteractionMotion } from "./interactionMotion.js";
import AppState from "./appState.js";
import { sendState } from "./webrtc.js";
import RecordingVisualizer from './recordingVisualizer.js';
import Oscilloscope from "./oscilloscope.js";


import { frequencyToNote, noteToFrequency, noteStrings, generateNoteFrequencies, semitonesToInterval } from "./utils.js";
import { Slider } from './slider.js';
import SoundSynth from './soundSynth.js';
import Monitoring from './monitoring.js';
import { normalizeFilterSettings, normalizeEffectSettings, createSoundFilterInput, getReversedAudioBuffer, renderSynthAudioBuffer } from './audioEffects.js';
// Detached comparison is required: existing parameter setters mutate the live
// override before saveCurrentSoundInfo receives it. This observes, never gates, saves.
function beatSoundFingerprint(info) {
  if (!info?.sound || !info.settings || typeof info.settings !== "object") return null;
  const entries = Object.entries(info.settings).sort(([a], [b]) => a.localeCompare(b));
  if (entries.some(([, value]) => typeof value === "number" && !Number.isFinite(value))) return null;
  return JSON.stringify([info.sound, entries]);
}

const SoundSettingsModal = {
  isNoteSnapping: false,
  isQuantizing: false,
  isGridSnapping: false,
  sliders: [],
  currentAudioBuffer: null,
  currentTrackIndex: null,
  currentSoundType: null,
  currentBarIndex: null,
  currentBeatIndex: null,
  skipBeatOverrideSave: false,
  currentSoundSettings: null,
  originalSoundName: "", // The name of the sound when modal opened (e.g., "Synth Kick", "My Preset")
  displaySoundName: "", // The name currently displayed/edited
  scopeMode: "waveform",
  liveAnalyserNode: null,
  previewAnalyserNode: null,
  previewSource: null,
  previewOutputNode: null,
  previewPending: false,
  previewGeneration: 0,
  previewVersion: "edited",
  originalPreviewSound: null,
  originalPreviewBuffer: null,
  previewTarget: null,
  advancedControls: true,
  waveformZoom: 1,
  waveformPan: 0,
  previewTimer: null,
  previouslyFocusedElement: null,
  effectsPreviouslyFocusedElement: null,
  init() {
    if (!this.authorityBoundaryHandler) {
      this.authorityBoundaryHandler = () => {
        // Role equality is not an authority lifetime: host -> guest -> host and
        // room changes must never revive pending editor work.
        this.editorGeneration = (this.editorGeneration || 0) + 1;
        this.closeSoundConfirmation?.();
        if (this.previewSource || this.previewPending) this.stopPreview();
      };
      document.addEventListener('roomauthoritychange', this.authorityBoundaryHandler);
      document.addEventListener('syncrolechange', this.authorityBoundaryHandler);
    }
    this.advancedControls = true;
    try {
      // An older cached shell has no disclosure button: keep every parameter reachable.
      this.advancedControls = !DOM.soundSettingsModal.querySelector("#sound-advanced-toggle")
        || localStorage.getItem("metronominal.soundEditorDetail") !== "basic";
    } catch (_) { /* Keep the existing all-controls view if storage is unavailable. */ }
    DOM.soundSettingsModal.querySelector("#sound-advanced-toggle")?.addEventListener("click", () => {
      this.advancedControls = !this.advancedControls;
      this.updateDetailControls();
      try {
        localStorage.setItem("metronominal.soundEditorDetail", this.advancedControls ? "advanced" : "basic");
      } catch (_) { /* The view remains usable without persistence. */ }
      emitInteractionMotion(
        DOM.soundSettingsModal.querySelector("#sound-advanced-toggle"),
        this.advancedControls ? "open" : "close"
      );
    });
    const closeButton = DOM.soundSettingsModal.querySelector(".close-button");
    const bottomCloseButton = DOM.soundSettingsModal.querySelector("#sound-settings-bottom-close");
    closeButton.addEventListener("click", () => this.hide());
    bottomCloseButton?.addEventListener("click", () => this.hide());
    closeButton.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.hide();
      }
    });
    DOM.soundSettingsModal.addEventListener("click", (e) => {
      if (e.target === DOM.soundSettingsModal) {
        this.hide();
      }
    });
    DOM.soundSettingsModal.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        const effects = document.getElementById("sound-effects-modal");
        if (effects && !effects.hidden && effects.style.display !== "none") this.hideEffectsModal();
        else this.hide();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...DOM.soundSettingsModal.querySelectorAll("button, select, input, [tabindex]:not([tabindex='-1'])")]
        .filter((element) => !element.disabled && element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    const effectsModal = document.getElementById("sound-effects-modal");
    const effectsButton = DOM.soundSettingsModal.querySelector("#sound-effects-btn");
    const effectsCloseButton = effectsModal?.querySelector("#sound-effects-close");
    const effectsBottomCloseButton = effectsModal?.querySelector("#sound-effects-bottom-close");
    const effectsResetButton = effectsModal?.querySelector("#effects-reset-btn");
    this.effectsActionSlot = effectsModal?.querySelector("#sound-effects-actions-slot") || null;
    effectsButton?.addEventListener("click", () => this.showEffectsModal());
    effectsCloseButton?.addEventListener("click", () => this.hideEffectsModal());
    effectsBottomCloseButton?.addEventListener("click", () => this.hideEffectsModal());
    effectsResetButton?.addEventListener("click", () => this.resetEffectsSettings());
    effectsModal?.addEventListener("click", (event) => {
      if (event.target === effectsModal) this.hideEffectsModal();
    });
    effectsModal?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.hideEffectsModal();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...effectsModal.querySelectorAll("button, select, input, [tabindex]:not([tabindex='-1'])")]
        .filter((element) => !element.disabled && element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
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
        emitInteractionMotion(e.currentTarget, "toggle");
    });

    const quantizeButton = DOM.soundSettingsModal.querySelector("#quantize-btn");
    quantizeButton?.addEventListener("click", (event) => {
      this.isQuantizing = !this.isQuantizing;
      event.currentTarget.classList.toggle("active", this.isQuantizing);
      emitInteractionMotion(event.currentTarget, "toggle");
    });
    const gridSnapButton = DOM.soundSettingsModal.querySelector("#grid-snap-btn");
    gridSnapButton?.addEventListener("click", (event) => {
      this.isGridSnapping = !this.isGridSnapping;
      event.currentTarget.classList.toggle("active", this.isGridSnapping);
      emitInteractionMotion(event.currentTarget, "toggle");
      if (this.currentAudioBuffer && this.drawWaveformAndTrimLines) this.drawWaveformAndTrimLines(this.currentAudioBuffer);
    });

    DOM.soundSettingsModal.querySelector("#sound-preview-btn").addEventListener("click", () => this.togglePreview());
    DOM.soundSettingsModal.querySelector("#sound-preview-original")?.addEventListener("click", () => this.selectPreviewVersion("original"));
    DOM.soundSettingsModal.querySelector("#sound-preview-edited")?.addEventListener("click", () => this.selectPreviewVersion("edited"));
    DOM.soundSettingsModal.querySelector("#sound-scope-mode-select").addEventListener("change", (e) => {
        const nextMode = e.target.value;
        if (nextMode === this.scopeMode) return;
        this.scopeMode = nextMode;
        emitInteractionMotion(e.currentTarget, "select");
    });
    DOM.soundSettingsModal.querySelector("#sample-probability").addEventListener("input", (event) => {
      if (!this.currentSoundSettings) return;
      const previous = this.getCurrentSoundInfo()?.settings?.probability;
      const probability = Math.max(0, Math.min(100, Number(event.target.value) || 0));
      this.currentSoundSettings.probability = probability;
      const output = DOM.soundSettingsModal.querySelector("#sample-probability-value");
      output.value = `${probability}%`;
      output.textContent = `${probability}%`;
      const soundInfo = this.getCurrentSoundInfo();
      if (soundInfo) this.saveCurrentSoundInfo({ ...soundInfo, settings: this.currentSoundSettings });
      sendState(AppState.getCurrentStateForPreset(true));
      if (previous !== probability && this.getCurrentSoundInfo()?.settings?.probability === probability) emitInteractionMotion(event.currentTarget, "adjust");
    });
    [
      ["#sample-overlap-toggle", "allowOverlap"],
      ["#sample-retrigger-toggle", "retrigger"],
      ["#sample-reverse-toggle", "reverse"],
      ["#sample-fx-toggle", "fxBypass"],
    ].forEach(([selector, setting]) => {
      DOM.soundSettingsModal.querySelector(selector).addEventListener("change", (event) => {
        if (!this.currentSoundSettings) return;
        const nextChecked = event.target.checked;
        const prevSaved = this.getCurrentSoundInfo()?.settings?.[setting];
        this.currentSoundSettings[setting] = nextChecked;
        const soundInfo = this.getCurrentSoundInfo();
        if (soundInfo) this.saveCurrentSoundInfo({ ...soundInfo, settings: this.currentSoundSettings });
        sendState(AppState.getCurrentStateForPreset(true));
        if (setting === "reverse" || (setting === "fxBypass" && prevSaved !== nextChecked && this.getCurrentSoundInfo()?.settings?.[setting] === nextChecked)) {
          emitInteractionMotion(event.currentTarget, "toggle");
        }
        if (setting === "reverse" && this.currentAudioBuffer && this.drawWaveformAndTrimLines) {
          this.drawWaveformAndTrimLines(this.currentAudioBuffer);
        } else if (setting === "reverse" && this.drawSynthWaveform) {
          this.drawSynthWaveform(this.currentSynthWaveformBuffer);
        }
      });
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

            const generation = this.editorGeneration;
            const authority = window.isHost;
            let committed = false;
            const commitChange = () => {
                if (committed || generation !== this.editorGeneration || authority !== window.isHost || DOM.soundSettingsModal.style.display === "none") return;
                committed = true;
                const previous = this.displaySoundName;
                if (input.value.trim() !== "") {
                    this.displaySoundName = input.value.trim();
                    modalTitle.textContent = `Editing: ${this.displaySoundName}`;
                    if (previous !== this.displaySoundName) emitInteractionMotion(renameBtn, "rename");
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
                        if (!AppState.getCustomSoundData(soundName)) this.acknowledgeCustomSoundPersistence(soundName, "remove", DOM.soundSettingsModal.querySelector(".modal-content"));
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

      this.closeSoundConfirmation?.();
      const generation = this.editorGeneration;
      const authority = window.isHost;
      const previousFocus = document.activeElement;
      const previousZIndex = modal.style.zIndex;
      const parentZIndex = Number.parseInt(getComputedStyle(DOM.soundSettingsModal).zIndex, 10) || 0;
      modal.style.zIndex = String(parentZIndex + 1);
      titleEl.textContent = title;
      messageEl.textContent = message;

      const closeModal = () => {
          modal.style.display = "none";
          modal.style.zIndex = previousZIndex;
          if (this.closeSoundConfirmation === closeModal) this.closeSoundConfirmation = null;
          if (previousFocus?.isConnected && DOM.soundSettingsModal.style.display !== "none") previousFocus.focus({ preventScroll: true });
          // Remove event listeners to prevent duplicates/memory leaks
          confirmBtn.removeEventListener("click", handleConfirm);
          cancelBtn.removeEventListener("click", handleCancel);
          window.removeEventListener("click", handleOutsideClick);
      };

      const handleConfirm = () => {
          if (generation === this.editorGeneration && authority === window.isHost && DOM.soundSettingsModal.style.display !== "none") onConfirm();
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

      this.closeSoundConfirmation = closeModal;
      modal.style.display = "block";
      confirmBtn.focus({ preventScroll: true });
  },

  async acknowledgeCustomSoundPersistence(name, kind, target) {
      // AppState persistence is debounced and catches storage failures itself.
      // Read back the actual durable result; never decorate the queued write as success.
      const generation = this.editorGeneration;
      const operation = this.customFeedbackGeneration = (this.customFeedbackGeneration || 0) + 1;
      const authority = window.isHost;
      const expected = JSON.stringify(AppState.getCustomSoundData(name) ?? null);
      for (let attempt = 0; attempt < 20; attempt += 1) {
          if (generation !== this.editorGeneration || operation !== this.customFeedbackGeneration
              || authority !== window.isHost || DOM.soundSettingsModal.style.display === "none"
              || JSON.stringify(AppState.getCustomSoundData(name) ?? null) !== expected) return;
          try {
              const stored = JSON.parse(localStorage.getItem("metronominalState"));
              if (stored && JSON.stringify(stored.customSounds?.[name] ?? null) === expected) {
                  emitInteractionMotion(target, kind);
                  return;
              }
          } catch (_) { /* No durable acknowledgement is available. */ }
          await new Promise(resolve => setTimeout(resolve, 75));
      }
      if (generation === this.editorGeneration && operation === this.customFeedbackGeneration
          && authority === window.isHost && DOM.soundSettingsModal.style.display !== "none") emitInteractionMotion(target, "refuse");
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

        this.acknowledgeCustomSoundPersistence(nameToSave, "save", DOM.soundSettingsModal.querySelector("#save-sound-btn"));

      } catch (e) {
          console.error("Error saving sound:", e);
          alert("Failed to save sound.");
      }
  },

  sliderValueForSettings(param, value) {
    if (["attack", "decay", "sustain", "release", "pitchEnvelopeTime", "trimStart", "trimEnd", "delayTime"].includes(param)) return Number(value || 0) * 1000;
    if (["volume", "distortion", "delayMix", "delayFeedback", "reverbMix", "reverbFeedback"].includes(param)) return Number(value || 0) * 100;
    return Number(value || 0);
  },

  formatAnimatedSliderValue(param, value, slider) {
    if (param.toLowerCase().includes("frequency")) return `${Number(value).toFixed(2)} Hz`;
    if (["attack", "decay", "sustain", "release", "pitchEnvelopeTime", "trimStart", "trimEnd"].includes(param)) return `${Number(value).toFixed(0)} ms`;
    if (param === "delayTime") return this.formatDelayTimeDisplay(value, Number(slider.max));
    if (["distortion", "delayMix", "delayFeedback", "reverbMix", "reverbFeedback", "volume", "probability"].includes(param)) return `${Number(value).toFixed(0)}%`;
    return String(Number(value).toFixed(2));
  },

  getResetSoundSettings(soundInfo) {
    const recordedBuffer = this.currentAudioBuffer;
    const defaults = AppState.getDefaultSoundSettings(soundInfo.sound) || {};
    const settings = recordedBuffer
      ? {
          volume: 1,
          trimStart: 0,
          trimEnd: recordedBuffer.duration,
          pitchShift: 0,
          highPassFrequency: 20,
          lowPassFrequency: 20000,
          probability: 100,
          allowOverlap: true,
          retrigger: true,
          reverse: false,
          fxBypass: false,
        }
      : JSON.parse(JSON.stringify(defaults));

    const numericDefaults = [
      ["highPassFrequency", 20],
      ["lowPassFrequency", 20000],
      ["distortion", 0],
      ["delayMix", 0],
      ["delayTime", 0],
      ["delayFeedback", 0.25],
      ["reverbMix", 0],
      ["reverbFeedback", 0.25],
    ];
    numericDefaults.forEach(([param, fallback]) => {
      settings[param] = Number.isFinite(Number(defaults[param])) ? Number(defaults[param]) : fallback;
    });
    return settings;
  },

  getAnimatedSliderValues() {
    const values = Object.fromEntries(
      [...DOM.soundSettingsModal.querySelectorAll("[data-param]")].map((slider) => [slider.dataset.param, Number(slider.value)])
    );
    const probability = DOM.soundSettingsModal.querySelector("#sample-probability");
    if (probability) values.probability = Number(probability.value);
    return values;
  },

  animateSliderValues(fromValues, toValues, root = DOM.soundSettingsModal) {
    const start = performance.now();
    const duration = 250;
    const frame = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - ((1 - progress) ** 3);
      Object.entries(toValues).forEach(([param, target]) => {
        const slider = param === "probability"
          ? root.querySelector("#sample-probability")
          : root.querySelector(`[data-param="${param}"]`);
        if (!slider) return;
        const from = Number.isFinite(Number(fromValues[param])) ? Number(fromValues[param]) : Number(target);
        const value = from + (Number(target) - from) * eased;
        slider.value = String(value);
        slider.setAttribute("aria-valuenow", String(value));
        const output = param === "probability"
          ? root.querySelector("#sample-probability-value")
          : slider.closest(".slider-container")?.querySelector(":scope > span");
        if (output) output.textContent = this.formatAnimatedSliderValue(param, value, slider);
      });
      if (progress < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  },

  resetEffectsSettings() {
    const effectsModal = document.getElementById("sound-effects-modal");
    const resetButton = effectsModal?.querySelector("#effects-reset-btn");
    if (resetButton) {
      resetButton.classList.remove("resetting");
      void resetButton.offsetWidth;
      resetButton.classList.add("resetting");
      window.setTimeout(() => resetButton.classList.remove("resetting"), 320);
    }
    const soundInfo = this.getCurrentSoundInfo();
    if (!soundInfo) return;
    const effectParams = [...(effectsModal?.querySelectorAll("[data-param]") || [])]
      .map((slider) => slider.dataset.param);
    const fromValues = Object.fromEntries(effectParams.map((param) => [
      param,
      Number(effectsModal.querySelector(`[data-param="${param}"]`)?.value),
    ]));
    const resetSettings = this.getResetSoundSettings(soundInfo);
    effectParams.forEach((param) => {
      const slider = effectsModal.querySelector(`[data-param="${param}"]`);
      soundInfo.settings[param] = resetSettings[param];
      if (slider && !Number.isFinite(Number(soundInfo.settings[param]))) {
        soundInfo.settings[param] = this.sliderValueForSettings(param, Number(slider.value));
      }
    });
    this.saveCurrentSoundInfo(soundInfo);
    this.currentSoundSettings = soundInfo.settings;
    const effectValues = Object.fromEntries(effectParams.map((param) => [
      param,
      this.sliderValueForSettings(param, soundInfo.settings[param]),
    ]));
    this.animateSliderValues(fromValues, effectValues, effectsModal);
    this.updateFilterFeedback();
    sendState(AppState.getCurrentStateForPreset(true));
  },

  resetSoundSettings() {
    const resetButton = DOM.soundSettingsModal.querySelector("#reset-sound-btn");
    if (resetButton) {
      resetButton.classList.remove("resetting");
      void resetButton.offsetWidth;
      resetButton.classList.add("resetting");
      window.setTimeout(() => resetButton.classList.remove("resetting"), 320);
    }
    const soundInfo = this.getCurrentSoundInfo();
    if (!soundInfo) return;
    const fromSliderValues = this.getAnimatedSliderValues();
    const animateReset = () => {
      this.animateSliderValues(fromSliderValues, this.getAnimatedSliderValues());
    };

    const beatContext = this.getCurrentBeatContext();
    if (beatContext) {
      AppState.clearBeatSound(
        this.currentTrackIndex,
        beatContext.barIndex,
        beatContext.beatIndex,
        this.currentSoundType,
      );
      sendState(AppState.getCurrentStateForPreset(true));
      document.dispatchEvent(new CustomEvent("soundSaved"));
      this.skipBeatOverrideSave = true;
      this.show(this.currentTrackIndex, this.currentSoundType, beatContext);
      animateReset();
      return;
    }

    const newSettings = this.getResetSoundSettings(soundInfo);

    soundInfo.settings = newSettings;

    this.saveCurrentSoundInfo(soundInfo);
    sendState(AppState.getCurrentStateForPreset(true));

    this.show(this.currentTrackIndex, this.currentSoundType, this.getCurrentBeatContext());
    animateReset();

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
    } else if (param === "delayTime") {
        valueToSave = value / 1000;
    } else if (["distortion", "delayMix", "delayFeedback", "reverbMix", "reverbFeedback"].includes(param)) {
        valueToSave = value / 100;
    }

    const soundInfo = this.getCurrentSoundInfo();
    if (!soundInfo) return;

    if (["trimStart", "trimEnd"].includes(param)) {
        const otherParam = param === "trimStart" ? "trimEnd" : "trimStart";
        const currentOther = Number(soundInfo.settings[otherParam]);
        if (Number.isFinite(currentOther)) {
            if (param === "trimStart" && valueToSave > currentOther) {
                valueToSave = currentOther;
            } else if (param === "trimEnd" && valueToSave < currentOther) {
                valueToSave = currentOther;
            }
        }
    }
    if (this.isNoteSnapping && param.toLowerCase().includes("frequency")) {
        const note = frequencyToNote(valueToSave);
        valueToSave = noteToFrequency(note);
    }

    soundInfo.settings[param] = valueToSave;
    this.currentSoundSettings = soundInfo.settings;

    this.saveCurrentSoundInfo(soundInfo);
    sendState(AppState.getCurrentStateForPreset(true));
    if (param === "highPassFrequency" || param === "lowPassFrequency") this.updateFilterFeedback();
    if (this.drawSynthWaveform && !["pitchShift", "distortion", "delayMix", "delayTime", "delayFeedback", "reverbMix", "reverbFeedback"].includes(param)) this.refreshSynthWaveform();

    if (["trimStart", "trimEnd"].includes(param)) {
        if (this.drawWaveformAndTrimLines && this.currentAudioBuffer) {
            this.drawWaveformAndTrimLines(this.currentAudioBuffer);
        }
        if (this.drawSynthWaveform && this.currentSynthWaveformBuffer) {
            this.drawSynthWaveform(this.currentSynthWaveformBuffer);
        }
    }

    const slider = document.querySelector(`[data-param="${param}"]`);
    if (slider) {
        let displayValue = value;
        if (["trimStart", "trimEnd"].includes(param)) {
            displayValue = valueToSave * 1000;
        }
        if (this.isNoteSnapping && param.toLowerCase().includes("frequency")) {
            displayValue = valueToSave;
        }
        slider.value = displayValue;
        slider.setAttribute("aria-valuenow", String(displayValue));
        const valueDisplay = slider.closest(".slider-container")?.querySelector(":scope > span");
        if (valueDisplay) {
            if (param.toLowerCase().includes("frequency")) {
                valueDisplay.textContent = `${parseFloat(displayValue).toFixed(2)} Hz (${frequencyToNote(displayValue)})`;
            } else if (["attack", "decay", "sustain", "release", "pitchEnvelopeTime", "trimStart", "trimEnd"].includes(param)) {
                valueDisplay.textContent = `${Number(displayValue).toFixed(0)} ms`;
            } else if (param === "delayTime") {
                valueDisplay.textContent = this.formatDelayTimeDisplay(displayValue, Number(slider.max));
            } else if (["distortion", "delayMix", "delayFeedback", "reverbMix", "reverbFeedback"].includes(param)) {
                valueDisplay.textContent = `${Number(displayValue).toFixed(0)}%`;
            } else if (param.toLowerCase() === "volume") {
                valueDisplay.textContent = `${displayValue}%`;
            } else {
                const nextText = `${displayValue} semitones (${semitonesToInterval(displayValue)})`;
                if (valueDisplay.textContent !== nextText) valueDisplay.textContent = nextText;
            }
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

  formatDelayTimeDisplay(value, maxMs = 1000) {
      if (!this.delayQuantizeEnabled) return `${Number(value).toFixed(0)} ms`;
      const options = this.getDelaySubdivisionOptions(maxMs);
      if (!options.length) return `${Number(value).toFixed(0)} ms`;
      return options.reduce((best, option) => Math.abs(option.ms - value) < Math.abs(best.ms - value) ? option : best, options[0]).label;
  },

  getDelaySubdivisionOptions(maxMs = 1000) {
      const bpm = Number(AppState.getTempo());
      if (!Number.isFinite(bpm) || bpm <= 0) return [];
      const beatMs = 60000 / bpm;
      return [
          [1, '1/1 note', false],
          [1, '1/1 dotted note', true],
          [2, '1/2 note', false],
          [2, '1/2 dotted note', true],
          [4, '1/4 note', false],
          [4, '1/4 dotted note', true],
          [8, '1/8 note', false],
          [8, '1/8 dotted note', true],
          [16, '1/16 note', false],
          [16, '1/16 dotted note', true],
          [32, '1/32 note', false],
          [32, '1/32 dotted note', true],
          [64, '1/64 note', false],
          [64, '1/64 dotted note', true],
          [128, '1/128 note', false],
          [128, '1/128 dotted note', true],
      ].map(([denominator, label, dotted]) => ({
          ms: Math.round(beatMs * 4 / denominator * (dotted ? 1.5 : 1)),
          label,
      }))
          .filter(({ ms }) => ms > 0 && ms <= maxMs)
          .filter((option, index, options) => index === options.findIndex((candidate) => candidate.ms === option.ms))
          .sort((a, b) => a.ms - b.ms);
  },

  getDelaySubdivisionValues(maxMs = 1000) {
      return this.getDelaySubdivisionOptions(maxMs).map(({ ms }) => ms);
  },

  createSlider(slidersContainer, param, min, max, step, value) {
    const effectParams = new Set(["pitchShift", "distortion", "delayMix", "delayTime", "delayFeedback", "reverbMix", "reverbFeedback"]);
    const behaviorContainer = document.querySelector(".sound-behavior-category");
    if (param === "volume" && behaviorContainer) {
      behaviorContainer.querySelectorAll('[data-param="volume"]').forEach((existingSlider) => {
        existingSlider.closest('.slider-container')?.remove();
      });
    }
    const targetContainer = param === "volume" && behaviorContainer
      ? behaviorContainer
      : effectParams.has(param)
        ? (document.getElementById("sound-effects-sliders-container") || slidersContainer)
        : slidersContainer;
    const categoryByParam = {
      trimStart: "playback", trimEnd: "playback", pitchShift: "effects",
      attack: "envelope", decay: "envelope", sustain: "envelope", release: "envelope",
      startFrequency: "synth", endFrequency: "synth", pitchEnvelopeTime: "synth",
      highPassFrequency: "filters", lowPassFrequency: "filters",
      distortion: "effects", delayMix: "effects", delayTime: "effects", delayFeedback: "effects", reverbMix: "effects", reverbFeedback: "effects",
      probability: "behavior", allowOverlap: "behavior", retrigger: "behavior",
    };
    const categoryLabels = {
      playback: "Playback & pitch",
      envelope: "ADSR",
      synth: "Synth envelope",
      filters: "Filters",
      effects: "Effects rack",
      behavior: "Behavior",
    };
    const categoryKey = categoryByParam[param] || "sound";
    let controlGroup = param === "volume" && behaviorContainer
      ? behaviorContainer
      : targetContainer.querySelector(`[data-control-category="${categoryKey}"]`);
    if (!controlGroup) {
      controlGroup = document.createElement("section");
      controlGroup.className = `sound-control-category${categoryKey === "envelope" ? " adsr-control-group" : ""}`;
      controlGroup.dataset.controlCategory = categoryKey;
      if (["synth", "sound", "playback"].includes(categoryKey)) {
        controlGroup.dataset.editorAdvanced = "";
        controlGroup.hidden = !this.advancedControls;
      }
      if (categoryKey === "envelope") {
        controlGroup.setAttribute("role", "group");
        controlGroup.setAttribute("aria-label", "ADSR envelope controls");
      } else {
        const heading = document.createElement("h3");
        heading.className = "sound-control-category-title";
        heading.textContent = categoryLabels[categoryKey] || "Sound controls";
        controlGroup.appendChild(heading);
      }
      targetContainer.appendChild(controlGroup);
    }
    const sliderContainer = document.createElement("div");
    sliderContainer.className = "slider-container";
    if (param === "pitchShift") sliderContainer.classList.add("pitch-shift-slider-container");

    const label = document.createElement("label");
    const displayLabels = {
      attack: "Attack",
      decay: "Decay",
      sustain: "Sustain",
      release: "Release",
      highPassFrequency: "High-pass",
      lowPassFrequency: "Low-pass",
      filterFrequency: "Filter frequency",
      volume: "Volume",
      startFrequency: "Start frequency",
      endFrequency: "End frequency",
      pitchEnvelopeTime: "Pitch envelope",
      pitchShift: "Pitch shift",
      distortion: "Distortion",
      delayMix: "Delay mix",
      delayTime: "Delay time",
      delayFeedback: "Delay feedback",
      reverbMix: "Reverb mix",
      reverbFeedback: "Reverb length",
      trimStart: "Trim start",
      trimEnd: "Trim end",
    };
    label.textContent = displayLabels[param] || param;
    label.title = param;
    sliderContainer.appendChild(label);

    const sliderWrapper = document.createElement("div");
    sliderWrapper.className = "slider-wrapper";

    const decrementButton = document.createElement("button");
    decrementButton.type = "button";
    decrementButton.setAttribute("aria-label", `Decrease ${label.textContent}`);
    decrementButton.className = "slider-button-decrement";
    decrementButton.textContent = "-";
    sliderWrapper.appendChild(decrementButton);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.id = `sound-param-${param}`;
    label.htmlFor = slider.id;
    slider.min = min;
    slider.max = max;
    slider.step = step;
    slider.value = value;
    slider.dataset.param = param;
    sliderWrapper.appendChild(slider);

    const incrementButton = document.createElement("button");
    incrementButton.type = "button";
    incrementButton.setAttribute("aria-label", `Increase ${label.textContent}`);
    incrementButton.className = "slider-button-increment";
    incrementButton.textContent = "+";
    sliderWrapper.appendChild(incrementButton);

    sliderContainer.appendChild(sliderWrapper);

    let delayQuantizeButton = null;
    let delayDatalist = null;
    if (param === "delayTime") {
      const datalist = document.createElement("datalist");
      delayDatalist = datalist;
      datalist.id = `delay-time-subdivisions-${this.currentTrackIndex ?? "sound"}`;
      const subdivisionOptions = this.getDelaySubdivisionOptions(max);
      subdivisionOptions.forEach(({ ms, label }) => {
        const option = document.createElement("option");
        option.value = String(ms);
        option.label = label;
        datalist.appendChild(option);
      });
      slider.setAttribute("list", datalist.id);
      sliderContainer.appendChild(datalist);
      delayQuantizeButton = document.getElementById("delay-quantize-btn");
    }

    const valueDisplay = document.createElement("span");
    if (param === "highPassFrequency" || param === "lowPassFrequency") {
        valueDisplay.textContent = `${Math.round(value)} Hz`;
    } else if (param.toLowerCase().includes("frequency")) {
        valueDisplay.textContent = `${value.toFixed(2)} Hz (${frequencyToNote(value)})`;
    } else if (["attack", "decay", "sustain", "release", "pitchEnvelopeTime", "trimStart", "trimEnd"].includes(param)) {
        valueDisplay.textContent = `${value.toFixed(0)} ms`;
    } else if (param === "delayTime") {
        valueDisplay.textContent = this.formatDelayTimeDisplay(value, max);
    } else if (["distortion", "delayMix", "delayFeedback", "reverbMix", "reverbFeedback"].includes(param)) {
        valueDisplay.textContent = `${value.toFixed(0)}%`;
    } else if (param.toLowerCase() === "volume") {
        valueDisplay.textContent = `${value}%`;
    } else if (param === "pitchShift") {
        valueDisplay.textContent = `${value} semitones (${semitonesToInterval(value)})`;
    } else {
        valueDisplay.textContent = value;
    }
    sliderContainer.appendChild(valueDisplay);
    const isAdsrParam = ["attack", "decay", "sustain", "release"].includes(param);
    const sliderTarget = isAdsrParam
      ? (controlGroup.querySelector(".adsr-control-group") || controlGroup)
      : controlGroup;
    sliderTarget.appendChild(sliderContainer);

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
    {
      let preGestureHasSound = Boolean(this.getCurrentSoundInfo()?.settings);
      let preGestureSaved = this.getCurrentSoundInfo()?.settings?.[param];
      const capturePreGestureSaved = () => {
        const info = this.getCurrentSoundInfo();
        preGestureHasSound = Boolean(info?.settings);
        preGestureSaved = info?.settings?.[param];
      };
      const isIntersectingViewport = (el) => {
        if (!el || !el.isConnected || el.hidden || el.closest?.("[hidden]")) return false;
        const rect = el.getBoundingClientRect?.();
        if (!rect || rect.width <= 0 || rect.height <= 0) return false;
        const vw = el.ownerDocument?.defaultView?.innerWidth || window.innerWidth;
        const vh = el.ownerDocument?.defaultView?.innerHeight || window.innerHeight;
        return rect.left + rect.width > 0 && rect.top + rect.height > 0 && rect.left < vw && rect.top < vh;
      };
      const resolveVisibleMotionTarget = (target) => {
        const candidates = [
          target,
          slider,
          sliderWrapper,
          sliderContainer,
          controlGroup,
          targetContainer,
          target?.closest?.(".modal-content"),
          target?.closest?.(".modal"),
          DOM.soundSettingsModal?.querySelector?.(".modal-content"),
          DOM.soundSettingsModal,
        ];
        return candidates.find(isIntersectingViewport) || target;
      };
      const emitIfSavedChanged = (target) => {
        if (!target || target.disabled || target.getAttribute?.("aria-disabled") === "true") {
          const info = this.getCurrentSoundInfo();
          preGestureHasSound = Boolean(info?.settings);
          preGestureSaved = info?.settings?.[param];
          return;
        }
        const info = this.getCurrentSoundInfo();
        const postHasSound = Boolean(info?.settings);
        const postSaved = info?.settings?.[param];
        if (preGestureHasSound && postHasSound && !Object.is(postSaved, preGestureSaved)) {
          preGestureHasSound = postHasSound;
          preGestureSaved = postSaved;
          emitInteractionMotion(resolveVisibleMotionTarget(target), ["trimStart", "trimEnd"].includes(param) ? "trim" : "adjust");
        } else {
          preGestureHasSound = postHasSound;
          preGestureSaved = postSaved;
        }
      };
      slider.addEventListener("input", capturePreGestureSaved, true);
      slider.addEventListener("input", () => emitIfSavedChanged(slider));
      [decrementButton, incrementButton].forEach((button) => {
        button.addEventListener("click", capturePreGestureSaved, true);
        button.addEventListener("click", () => emitIfSavedChanged(button));
      });
    }
    if (delayQuantizeButton) {
      delayQuantizeButton.addEventListener("click", () => {
        const enabled = delayQuantizeButton.getAttribute("aria-pressed") !== "true";
        this.delayQuantizeEnabled = enabled;
        const points = enabled ? this.getDelaySubdivisionValues(max) : null;
        delayQuantizeButton.setAttribute("aria-pressed", String(enabled));
        delayQuantizeButton.classList.toggle("active", enabled);
        delayQuantizeButton.textContent = enabled ? "Quantized delay" : "Quantize delay";
        sliderInstance.updateSnapPoints(points);
        if (enabled && points?.length) {
          const nearest = points.reduce((best, point) => Math.abs(point - sliderInstance.value) < Math.abs(best - sliderInstance.value) ? point : best, points[0]);
          sliderInstance.setValue(nearest);
        } else {
          const display = sliderContainer.querySelector(":scope > span");
          if (display) display.textContent = this.formatDelayTimeDisplay(sliderInstance.value, max);
        }
        emitInteractionMotion(delayQuantizeButton, "toggle");
      });
      const refreshDelayQuantization = () => {
        const options = this.getDelaySubdivisionOptions(max);
        if (delayDatalist) {
          delayDatalist.replaceChildren(...options.map(({ ms, label }) => {
            const option = document.createElement("option");
            option.value = String(ms);
            option.label = label;
            return option;
          }));
        }
        if (delayQuantizeButton?.getAttribute("aria-pressed") === "true") sliderInstance.updateSnapPoints(options.map(({ ms }) => ms));
      };
      document.addEventListener("tempochange", refreshDelayQuantization);
      (this.delayQuantizeRefreshers ||= []).push(refreshDelayQuantization);
    }
    this.sliders.push(sliderInstance);
  },

  getCurrentBeatContext() {
    return Number.isInteger(this.currentBarIndex) && Number.isInteger(this.currentBeatIndex)
      ? { barIndex: this.currentBarIndex, beatIndex: this.currentBeatIndex }
      : null;
  },

  getCurrentSoundInfo() {
    const track = AppState.getTracks()[this.currentTrackIndex];
    if (!track) return null;
    return this.getCurrentBeatContext()
      ? AppState.getBeatSound(this.currentTrackIndex, this.currentBarIndex, this.currentBeatIndex, this.currentSoundType)
      : track[this.currentSoundType];
  },

  saveCurrentSoundInfo(soundInfo) {
    if (!soundInfo?.sound) return;
    if (this.getCurrentBeatContext()) {
      const feedback = this.beatEditFeedback;
      const accepted = AppState.setBeatSound(this.currentTrackIndex, this.currentBarIndex, this.currentBeatIndex, this.currentSoundType, soundInfo);
      const saved = AppState.getBeatSound(this.currentTrackIndex, this.currentBarIndex, this.currentBeatIndex, this.currentSoundType);
      const fingerprint = beatSoundFingerprint(saved);
      if (feedback && accepted === true) {
        const changed = fingerprint !== null && fingerprint !== feedback.fingerprint && fingerprint !== feedback.sourceFingerprint;
        feedback.fingerprint = fingerprint;
        feedback.sourceFingerprint = fingerprint;
        const selector = `.bar-visual[data-container-index="${this.currentTrackIndex}"][data-bar-index="${this.currentBarIndex}"] .beat-square[data-beat-index="${this.currentBeatIndex}"]:not(.removing-beat-animation)`;
        if (changed && fingerprint === beatSoundFingerprint(soundInfo)
          && feedback.generation === this.editorGeneration && feedback.authority === window.isHost
          && (!document.querySelector('#share-btn.connected') || window.isHost === true)
          && !AppState.isPlaying() && DOM.soundSettingsModal.style.display !== "none"
          && feedback.track === AppState.getTracks()[this.currentTrackIndex]
          && feedback.bar === feedback.track.barSettings[this.currentBarIndex]
          && feedback.target === document.querySelector(selector)) {
          emitInteractionMotion(feedback.target, "adjust");
        }
      }
    } else {
      AppState.updateTrack(this.currentTrackIndex, { [this.currentSoundType]: soundInfo });
    }
  },

  updateFilterFeedback() {
    this.updateFilterOverlay();
  },

  updateFilterOverlay() {
    const overlays = DOM.soundSettingsModal.querySelectorAll(".filter-visualization-overlay");
    if (!overlays.length || !this.currentSoundSettings) return;
    const minFrequency = 20;
    const maxFrequency = 20000;
    const toPosition = (frequency) => {
      const ratio = (Math.log10(Math.max(minFrequency, Math.min(maxFrequency, Number(frequency)))) - Math.log10(minFrequency))
        / (Math.log10(maxFrequency) - Math.log10(minFrequency));
      return `${Math.round(ratio * 1000) / 10}%`;
    };
    const highPassActive = Number(this.currentSoundSettings.highPassFrequency) > minFrequency;
    const lowPassActive = Number(this.currentSoundSettings.lowPassFrequency) < maxFrequency;
    const highPassPosition = highPassActive ? toPosition(this.currentSoundSettings.highPassFrequency) : "0%";
    const lowPassPosition = lowPassActive ? toPosition(this.currentSoundSettings.lowPassFrequency) : "100%";
    overlays.forEach((overlay) => {
      overlay.style.setProperty("--filter-high-pass-position", highPassPosition);
      overlay.style.setProperty("--filter-low-pass-position", lowPassPosition);
      overlay.classList.toggle("high-pass-active", highPassActive);
      overlay.classList.toggle("low-pass-active", lowPassActive);
      overlay.querySelector(".filter-overlay-high-pass-label")?.replaceChildren(document.createTextNode(`HP ${Math.round(this.currentSoundSettings.highPassFrequency)} Hz`));
      overlay.querySelector(".filter-overlay-low-pass-label")?.replaceChildren(document.createTextNode(`LP ${Math.round(this.currentSoundSettings.lowPassFrequency)} Hz`));
    });
  },

  showEffectsModal() {
    const modal = document.getElementById("sound-effects-modal");
    const trigger = DOM.soundSettingsModal.querySelector("#sound-effects-btn");
    if (!modal || !this.currentSoundSettings) return;
    this.effectsPreviouslyFocusedElement = DOM.soundSettingsModal.contains(document.activeElement)
      ? document.activeElement : trigger;
    const delayQuantizeButton = this.effectsActionSlot?.querySelector("#delay-quantize-btn");
    if (delayQuantizeButton) delayQuantizeButton.style.display = "inline-block";
    modal.hidden = false;
    modal.style.display = "flex";
    requestAnimationFrame(() => { if (!modal.hidden) modal.classList.add("is-open"); });
    trigger?.setAttribute("aria-expanded", "true");
    modal.querySelector("button, input")?.focus({ preventScroll: true });
  },

  hideEffectsModal() {
    const modal = document.getElementById("sound-effects-modal");
    const trigger = DOM.soundSettingsModal.querySelector("#sound-effects-btn");
    if (!modal) return;
    const wasOpen = !modal.hidden && modal.style.display !== 'none';
    modal.classList.remove("is-open");
    modal.style.display = "none";
    modal.hidden = true;
    const delayQuantizeButton = this.effectsActionSlot?.querySelector("#delay-quantize-btn");
    if (delayQuantizeButton) delayQuantizeButton.style.display = "none";
    trigger?.setAttribute("aria-expanded", "false");
    const restoreTarget = this.effectsPreviouslyFocusedElement;
    this.effectsPreviouslyFocusedElement = null;
    if (restoreTarget?.isConnected && typeof restoreTarget.focus === "function") restoreTarget.focus({ preventScroll: true });
    if (wasOpen && modal.hidden && modal.style.display === 'none') emitInteractionMotion(trigger, 'close');
  },

  updateDetailControls() {
    const button = DOM.soundSettingsModal.querySelector("#sound-advanced-toggle");
    button?.setAttribute("aria-expanded", String(this.advancedControls));
    if (button) button.title = this.advancedControls ? "Hide additional parameters for a simpler editor" : "Show all sound parameters";
    DOM.soundSettingsModal.querySelectorAll("[data-editor-advanced]").forEach(element => {
      element.hidden = !this.advancedControls;
    });
  },

  reorderMainSoundCategories() {
    if (!this.mainSlidersContainer) return;
    const container = this.mainSlidersContainer;
    const children = [...container.children];
    const filters = container.querySelector('[data-control-category="filters"]');
    const playback = container.querySelector('[data-control-category="playback"]');
    const waveform = children.find((child) => child.classList.contains('waveform-container') || child.classList.contains('filter-visualization-stage'));
    const waveformTools = children.find((child) => child.classList.contains('waveform-tools'));
    const ordered = [filters, waveform, waveformTools, playback].filter(Boolean);
    const remaining = children.filter((child) => !ordered.includes(child));
    [...ordered, ...remaining].forEach((child) => container.appendChild(child));
  },

  async refreshSynthWaveform() {
    if (!this.currentSynthWaveformCanvas || !this.currentSoundSettings) return;
    const soundInfo = this.getCurrentSoundInfo();
    const baseSound = AppState.getCustomSoundData(soundInfo?.sound)?.baseSound || soundInfo?.sound;
    const functionName = `play${baseSound?.replace("Synth ", "").replace(/ /g, "")}`;
    if (!baseSound?.startsWith("Synth") || !SoundSynth[functionName]) return;
    const rendered = await renderSynthAudioBuffer(AppState.getAudioContext(), SoundSynth[functionName], { ...this.currentSoundSettings, volume: 1 });
    if (!rendered || !this.drawSynthWaveform) return;
    this.currentSynthWaveformBuffer = rendered;
    const durationMs = rendered.duration * 1000;
    const durationSeconds = rendered.duration;
    const trimStartSlider = this.mainSlidersContainer.querySelector('[data-param="trimStart"]');
    const trimEndSlider = this.mainSlidersContainer.querySelector('[data-param="trimEnd"]');
    const trimStartSeconds = Math.max(0, Math.min(durationSeconds, Number(this.currentSoundSettings.trimStart) || 0));
    const trimEndSeconds = Math.max(trimStartSeconds, Math.min(durationSeconds, Number(this.currentSoundSettings.trimEnd) || durationSeconds));
    const feedback = this.beatEditFeedback;
    const unchangedFeedback = feedback?.fingerprint === beatSoundFingerprint({ sound: soundInfo?.sound, settings: this.currentSoundSettings });
    this.currentSoundSettings.trimStart = trimStartSeconds;
    this.currentSoundSettings.trimEnd = trimEndSeconds;
    // Initial waveform duration clamps are presentation setup, not accepted edits.
    if (feedback && unchangedFeedback) feedback.fingerprint = beatSoundFingerprint({ sound: soundInfo?.sound, settings: this.currentSoundSettings });
    if (!trimStartSlider || !trimEndSlider) {
      this.createSlider(this.mainSlidersContainer, "trimStart", 0, durationMs, 1, trimStartSeconds * 1000);
      this.createSlider(this.mainSlidersContainer, "trimEnd", 0, durationMs, 1, trimEndSeconds * 1000);
    } else {
      [trimStartSlider, trimEndSlider].forEach((slider) => { slider.max = String(durationMs); });
      trimStartSlider.value = String(trimStartSeconds * 1000);
      trimEndSlider.value = String(trimEndSeconds * 1000);
    }
    this.reorderMainSoundCategories();
    this.drawSynthWaveform(rendered);
  },

  show(trackIndex, soundType, beatContext = null) {
    this.closeSoundConfirmation?.();
    this.editorGeneration = (this.editorGeneration || 0) + 1;
    this.hideEffectsModal();
    this.stopPreview();
    this.previouslyFocusedElement = document.activeElement;
    this.currentTrackIndex = trackIndex;
    this.currentSoundType = soundType;
    this.currentBarIndex = Number.isInteger(beatContext?.barIndex) ? beatContext.barIndex : null;
    this.currentBeatIndex = Number.isInteger(beatContext?.beatIndex) ? beatContext.beatIndex : null;

    const track = AppState.getTracks()[trackIndex];
    const sourceSoundInfo = this.getCurrentSoundInfo();
    if (!track || !sourceSoundInfo) return;
    const soundInfo = {
      sound: sourceSoundInfo.sound,
      settings: JSON.parse(JSON.stringify(sourceSoundInfo.settings || {})),
    };
    if (this.skipBeatOverrideSave) {
      this.skipBeatOverrideSave = false;
    }

    // Auto-repair if sound data is corrupted/missing
    if (!soundInfo.sound) {
        console.warn(`Track ${trackIndex} ${soundType} missing sound name. Repairing...`);
        soundInfo.sound = (soundType === 'mainBeatSound') ? "Synth Kick" : "Synth HiHat";
        if (!soundInfo.settings) {
            soundInfo.settings = AppState.getDefaultSoundSettings(soundInfo.sound);
        }
    }

    let soundSettings = soundInfo.settings;

    const oscilloscopeCanvas = DOM.soundSettingsModal.querySelector(".oscilloscope-canvas");

    this.currentAudioBuffer = null;
    // Check if it's a recorded sound (or custom sound based on one) and retrieve its audioBuffer
    let soundNameForBuffer = soundInfo.sound;
    const customSoundData = AppState.getCustomSoundData(soundInfo.sound);
    if (customSoundData) {
        soundNameForBuffer = customSoundData.baseSound;
    }

    const recordedAudioBuffer = AppState.getSoundBuffer(soundNameForBuffer);
    if (typeof AudioBuffer !== 'undefined' && recordedAudioBuffer instanceof AudioBuffer) {
        soundInfo.audioBuffer = recordedAudioBuffer; // Temporarily attach audioBuffer for modal's use
        this.currentAudioBuffer = recordedAudioBuffer;
    }

    const modalTitle = DOM.soundSettingsModal.querySelector(".modal-header h2");
    const modalContext = DOM.soundSettingsModal.querySelector(".sound-modal-context");
    const noteSnapBtn = DOM.soundSettingsModal.querySelector("#note-snap-btn");
    const quantizeBtn = DOM.soundSettingsModal.querySelector("#quantize-btn");
    const gridSnapBtn = DOM.soundSettingsModal.querySelector("#grid-snap-btn");
    const delayQuantizeBtn = DOM.soundSettingsModal.querySelector("#delay-quantize-btn");
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
    if (modalContext) {
      const beatText = this.getCurrentBeatContext()
        ? ` · Bar ${this.currentBarIndex + 1}, Beat ${this.currentBeatIndex + 1}`
        : "";
      modalContext.textContent = `Track ${trackIndex + 1} · ${soundType === "mainBeatSound" ? "Main Beat Sound" : "Subdivision Sound"}${beatText}`;
    }

    if (!soundSettings) {
      soundInfo.settings = {}; // Initialize if null/undefined
      soundSettings = soundInfo.settings;
    }
    soundSettings.allowOverlap = soundSettings.allowOverlap !== false;
    soundSettings.retrigger = soundSettings.retrigger !== false;
    soundSettings.reverse = soundSettings.reverse === true;
    normalizeFilterSettings(soundSettings);
    normalizeEffectSettings(soundSettings);
    const numericProbability = Number(soundSettings.probability);
    soundSettings.probability = Number.isFinite(numericProbability) ? Math.max(0, Math.min(100, numericProbability)) : 100;
    this.currentSoundSettings = soundSettings;
    this.beatEditFeedback = this.getCurrentBeatContext()
      && [trackIndex, this.currentBarIndex, this.currentBeatIndex].every(index => Number.isInteger(index) && index >= 0)
      && ["mainBeatSound", "subdivisionSound"].includes(soundType)
      ? {
        generation: this.editorGeneration,
        authority: window.isHost,
        track,
        bar: track.barSettings[this.currentBarIndex],
        target: document.querySelector(`.bar-visual[data-container-index="${trackIndex}"][data-bar-index="${this.currentBarIndex}"] .beat-square[data-beat-index="${this.currentBeatIndex}"]:not(.removing-beat-animation)`),
        fingerprint: beatSoundFingerprint({ sound: soundInfo.sound, settings: soundSettings }),
        sourceFingerprint: beatSoundFingerprint(sourceSoundInfo),
      } : null;
    this.currentSynthWaveformBuffer = null;
    const previewTarget = [trackIndex, soundType, this.currentBarIndex, this.currentBeatIndex].join(":");
    if (this.previewTarget !== previewTarget || !this.originalPreviewSound) {
      this.originalPreviewSound = { sound: soundNameForBuffer, settings: JSON.parse(JSON.stringify(soundSettings)) };
      this.originalPreviewBuffer = this.currentAudioBuffer;
      this.previewTarget = previewTarget;
    }
    this.previewVersion = "edited";
    this.updatePreviewControls();
    this.currentSynthWaveformCanvas = null;
    this.drawSynthWaveform = null;
    DOM.soundSettingsModal.querySelector("#sample-overlap-toggle").checked = soundSettings.allowOverlap;
    DOM.soundSettingsModal.querySelector("#sample-retrigger-toggle").checked = soundSettings.retrigger;
    DOM.soundSettingsModal.querySelector("#sample-reverse-toggle").checked = soundSettings.reverse;
    const fxToggle = DOM.soundSettingsModal.querySelector("#sample-fx-toggle");
    if (fxToggle) {
      fxToggle.checked = soundSettings.fxBypass === true;
      fxToggle.title = "Bypass all filters and effects";
    }
    const probabilityInput = DOM.soundSettingsModal.querySelector("#sample-probability");
    probabilityInput.value = soundSettings.probability;
    DOM.soundSettingsModal.querySelector("#sample-probability-value").textContent = `${soundSettings.probability}%`;

    const slidersContainer = DOM.soundSettingsModal.querySelector("#sound-sliders-container");
    const effectsSlidersContainer = document.getElementById("sound-effects-sliders-container");
    this.mainSlidersContainer = slidersContainer;
    (this.delayQuantizeRefreshers || []).forEach((refresh) => document.removeEventListener("tempochange", refresh));
    this.delayQuantizeRefreshers = [];
    if (delayQuantizeBtn) {
      delayQuantizeBtn.style.display = 'none';
      delayQuantizeBtn.setAttribute('aria-pressed', 'false');
      delayQuantizeBtn.classList.remove('active');
    }
    this.delayQuantizeEnabled = false;
    this.isQuantizing = false;
    this.isGridSnapping = false;
    slidersContainer.innerHTML = "";
    if (effectsSlidersContainer) effectsSlidersContainer.innerHTML = "";
    this.sliders = [];

    const waveformFeedbackEpoch = this.editorGeneration;
    const acknowledgeWaveform = (target, kind) => {
      if (waveformFeedbackEpoch === this.editorGeneration) emitInteractionMotion(target, kind);
    };
    const savedTrim = () => {
      try {
        const settings = this.getCurrentSoundInfo()?.settings;
        return settings ? JSON.stringify([settings.trimStart, settings.trimEnd]) : null;
      } catch { return null; }
    };

    if (typeof AudioBuffer !== 'undefined' && soundInfo.audioBuffer instanceof AudioBuffer) {
        // Recorded sound
        noteSnapBtn.style.display = 'none';
        quantizeBtn.style.display = 'inline-block';
        gridSnapBtn.style.display = 'inline-block';
        this.isNoteSnapping = false;
        this.isQuantizing = false;
        this.isGridSnapping = false;

        const waveformContainer = document.createElement("div");
        waveformContainer.className = "waveform-container";
        const waveformCanvas = document.createElement("canvas");
        waveformCanvas.className = "waveform-canvas";
        waveformContainer.appendChild(waveformCanvas);
        slidersContainer.appendChild(waveformContainer);
        const waveformTools = document.createElement("div");
        waveformTools.className = "waveform-tools";
        waveformTools.innerHTML = `<label>Zoom <input class="waveform-zoom" type="range" min="1" max="8" step="0.25" value="1" /><output class="waveform-zoom-value">1×</output></label><label>Pan <input class="waveform-pan" type="range" min="0" max="1" step="0.01" value="0" /><output class="waveform-pan-value">0%</output></label>`;
        slidersContainer.appendChild(waveformTools);
        const zoomInput = waveformTools.querySelector(".waveform-zoom");
        const panInput = waveformTools.querySelector(".waveform-pan");
        const redrawZoomedWaveform = (event) => {
            const beforeZoom = this.waveformZoom, beforePan = this.waveformPan;
            this.waveformZoom = Number(zoomInput.value);
            this.waveformPan = Number(panInput.value);
            waveformTools.querySelector('.waveform-zoom-value').textContent = `${this.waveformZoom}×`;
            waveformTools.querySelector('.waveform-pan-value').textContent = `${Math.round(this.waveformPan * 100)}%`;
            if (this.drawWaveformAndTrimLines) this.drawWaveformAndTrimLines(this.currentAudioBuffer);
            if (beforeZoom !== this.waveformZoom || beforePan !== this.waveformPan) acknowledgeWaveform(event.currentTarget, 'adjust');
        };
        zoomInput.addEventListener("input", redrawZoomedWaveform);
        panInput.addEventListener("input", redrawZoomedWaveform);
        const mainColor = getComputedStyle(document.documentElement).getPropertyValue("--Main").trim();

        this.drawWaveformAndTrimLines = (buffer) => {
            const visibleSpan = 1 / this.waveformZoom;
            const visibleStart = this.waveformPan * (1 - visibleSpan);
            RecordingVisualizer.drawWaveform(buffer, waveformCanvas, mainColor, visibleStart, visibleStart + visibleSpan, this.currentSoundSettings.reverse === true);
            const ctx = waveformCanvas.getContext('2d');

            if (this.isGridSnapping) {
                const bpm = AppState.getTempo();
                if (bpm > 0) {
                    const beatDuration = 60000 / bpm;
                    const gridInterval = beatDuration / 4; // 16th notes
                    const durationMs = buffer.duration * 1000;
                    const width = waveformCanvas.width;
                    const gridVisibleSpan = 1 / this.waveformZoom;
                    const gridVisibleStart = this.waveformPan * (1 - gridVisibleSpan);
                    const gridVisibleEnd = gridVisibleStart + gridVisibleSpan;
                    const visibleStartMs = gridVisibleStart * durationMs;
                    const visibleEndMs = gridVisibleEnd * durationMs;
                    
                    ctx.beginPath();
                    // Use a color that contrasts but isn't too distracting. 
                    // Since background is likely dark (from RecordingVisualizer), a light grey with opacity.
                    ctx.strokeStyle = 'rgba(200, 200, 200, 0.3)'; 
                    ctx.lineWidth = 1;

                    // Optimize loop: compute x directly
                    const pixelsPerMs = width / durationMs;
                    const gridPixels = gridInterval * pixelsPerMs;

                    const firstGrid = Math.ceil(visibleStartMs / gridInterval) * gridInterval;
                    for (let timeMs = firstGrid; timeMs <= visibleEndMs; timeMs += gridInterval) {
                        const x = ((timeMs - visibleStartMs) / (visibleEndMs - visibleStartMs)) * width;
                        ctx.moveTo(x, 0);
                        ctx.lineTo(x, waveformCanvas.height);
                    }
                    ctx.stroke();
                }
            }

            const trimStart = (this.currentSoundSettings.trimStart || 0);
            const trimEnd = (this.currentSoundSettings.trimEnd || buffer.duration);
            const trimVisibleSpan = 1 / this.waveformZoom;
            const trimVisibleStart = this.waveformPan * (1 - trimVisibleSpan);
            const trimVisibleEnd = trimVisibleStart + trimVisibleSpan;
            const toCanvasX = (time) => ((time / buffer.duration - trimVisibleStart) / trimVisibleSpan) * waveformCanvas.width;
            const startX = this.currentSoundSettings.reverse ? toCanvasX(buffer.duration - trimEnd) : toCanvasX(trimStart);
            const endX = this.currentSoundSettings.reverse ? toCanvasX(buffer.duration - trimStart) : toCanvasX(trimEnd);

            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            if (startX > 0) ctx.fillRect(0, 0, Math.min(waveformCanvas.width, startX), waveformCanvas.height);
            if (endX < waveformCanvas.width) ctx.fillRect(Math.max(0, endX), 0, waveformCanvas.width - Math.max(0, endX), waveformCanvas.height);
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            [startX, endX].forEach((x) => {
                if (x >= 0 && x <= waveformCanvas.width) {
                    ctx.beginPath();
                    ctx.moveTo(x, 0);
                    ctx.lineTo(x, waveformCanvas.height);
                    ctx.stroke();
                }
            });
        };
        let activeTrimHandle = null;
        const updateTrimFromPointer = (event) => {
            if (!activeTrimHandle) return;
            const before = savedTrim();
            const rect = waveformCanvas.getBoundingClientRect();
            const visibleSpan = 1 / this.waveformZoom;
            const visibleStart = this.waveformPan * (1 - visibleSpan);
            const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
            const normalizedTime = visibleStart + ratio * visibleSpan;
            const time = (this.currentSoundSettings.reverse ? 1 - normalizedTime : normalizedTime) * soundInfo.audioBuffer.duration;
            const startSlider = this.sliders.find((slider) => slider.sliderElement.dataset.param === "trimStart");
            const endSlider = this.sliders.find((slider) => slider.sliderElement.dataset.param === "trimEnd");
            if (activeTrimHandle === "start" && startSlider) startSlider.setValue(Math.min(time, endSlider?.value ?? time));
            if (activeTrimHandle === "end" && endSlider) endSlider.setValue(Math.max(time, startSlider?.value ?? time));
            this.drawWaveformAndTrimLines(this.currentAudioBuffer);
            const after = savedTrim();
            if (before !== null && after !== null && before !== after) acknowledgeWaveform(waveformCanvas, 'trim');
        };
        waveformCanvas.addEventListener("pointerdown", (event) => {
            const rect = waveformCanvas.getBoundingClientRect();
            const visibleSpan = 1 / this.waveformZoom;
            const visibleStart = this.waveformPan * (1 - visibleSpan);
            const ratio = (event.clientX - rect.left) / rect.width;
            const pointerTime = (visibleStart + ratio * visibleSpan) * soundInfo.audioBuffer.duration;
            const start = this.currentSoundSettings.trimStart || 0;
            const end = this.currentSoundSettings.trimEnd || soundInfo.audioBuffer.duration;
            activeTrimHandle = Math.abs(pointerTime - start) <= Math.abs(pointerTime - end) ? "start" : "end";
            waveformCanvas.setPointerCapture?.(event.pointerId);
            updateTrimFromPointer(event);
        });
        waveformCanvas.addEventListener("pointermove", updateTrimFromPointer);
        waveformCanvas.addEventListener("pointerup", (event) => {
            activeTrimHandle = null;
            waveformCanvas.releasePointerCapture?.(event.pointerId);
        });

        this.drawWaveformAndTrimLines(soundInfo.audioBuffer);

        const trimStart = soundSettings.trimStart ? soundSettings.trimStart * 1000 : 0;
        const trimEnd = soundSettings.trimEnd ? soundSettings.trimEnd * 1000 : soundInfo.audioBuffer.duration * 1000;

        this.createSlider(slidersContainer, "trimStart", 0, soundInfo.audioBuffer.duration * 1000, 1, trimStart);
        this.createSlider(slidersContainer, "trimEnd", 0, soundInfo.audioBuffer.duration * 1000, 1, trimEnd);
    } else {
        // Synth sound
        const synthWaveformCanvas = document.createElement("canvas");
        synthWaveformCanvas.className = "waveform-canvas synth-waveform-canvas";
        synthWaveformCanvas.setAttribute("aria-label", "Synthesized sound waveform");
        const synthWaveformStage = document.createElement("div");
        synthWaveformStage.className = "filter-visualization-stage";
        synthWaveformStage.appendChild(synthWaveformCanvas);
        slidersContainer.appendChild(synthWaveformStage);
        this.currentSynthWaveformCanvas = synthWaveformCanvas;
        const waveformColor = getComputedStyle(document.documentElement).getPropertyValue("--Main").trim();
        this.drawSynthWaveform = (buffer) => {
            if (!buffer) return;
            const visibleSpan = 1 / this.waveformZoom;
            const visibleStart = this.waveformPan * (1 - visibleSpan);
            RecordingVisualizer.drawWaveform(buffer, synthWaveformCanvas, waveformColor, visibleStart, visibleStart + visibleSpan, this.currentSoundSettings.reverse === true);
            const context = synthWaveformCanvas.getContext("2d");
            const duration = Math.max(buffer.duration, 0.001);
            const trimStart = Math.max(0, Math.min(duration, Number(this.currentSoundSettings.trimStart) || 0));
            const trimEnd = Math.max(trimStart, Math.min(duration, Number(this.currentSoundSettings.trimEnd) || duration));
            const toCanvasX = (time) => ((time / duration - visibleStart) / visibleSpan) * synthWaveformCanvas.width;
            const startX = this.currentSoundSettings.reverse ? toCanvasX(duration - trimEnd) : toCanvasX(trimStart);
            const endX = this.currentSoundSettings.reverse ? toCanvasX(duration - trimStart) : toCanvasX(trimEnd);
            context.fillStyle = "rgba(0, 0, 0, 0.5)";
            if (startX > 0) context.fillRect(0, 0, Math.min(synthWaveformCanvas.width, startX), synthWaveformCanvas.height);
            if (endX < synthWaveformCanvas.width) context.fillRect(Math.max(0, endX), 0, synthWaveformCanvas.width - Math.max(0, endX), synthWaveformCanvas.height);
            context.strokeStyle = "#fff";
            context.lineWidth = 2;
            [startX, endX].forEach((x) => {
                if (x >= 0 && x <= synthWaveformCanvas.width) {
                    context.beginPath();
                    context.moveTo(x, 0);
                    context.lineTo(x, synthWaveformCanvas.height);
                    context.stroke();
                }
            });
        };
        const synthWaveformTools = document.createElement("div");
        synthWaveformTools.className = "waveform-tools";
        synthWaveformTools.innerHTML = '<label>Zoom <input class="waveform-zoom" type="range" min="1" max="8" step="0.25" value="1" /><output class="waveform-zoom-value">1×</output></label><label>Pan <input class="waveform-pan" type="range" min="0" max="1" step="0.01" value="0" /><output class="waveform-pan-value">0%</output></label>';
        slidersContainer.appendChild(synthWaveformTools);
        const synthZoom = synthWaveformTools.querySelector('.waveform-zoom');
        const synthPan = synthWaveformTools.querySelector('.waveform-pan');
        const updateSynthWaveformToolLabels = () => {
            synthWaveformTools.querySelector('.waveform-zoom-value').textContent = `${Number(synthZoom.value).toFixed(2).replace(/\.00$/, '')}×`;
            synthWaveformTools.querySelector('.waveform-pan-value').textContent = `${Math.round(Number(synthPan.value) * 100)}%`;
        };
        synthWaveformTools.querySelector('.waveform-zoom').addEventListener('input', (event) => {
            const before = this.waveformZoom;
            this.waveformZoom = Number(event.target.value); updateSynthWaveformToolLabels(); this.drawSynthWaveform(this.currentSynthWaveformBuffer);
            if (before !== this.waveformZoom && this.currentSynthWaveformBuffer) acknowledgeWaveform(event.currentTarget, 'adjust');
        });
        synthWaveformTools.querySelector('.waveform-pan').addEventListener('input', (event) => {
            const before = this.waveformPan;
            this.waveformPan = Number(event.target.value); updateSynthWaveformToolLabels(); this.drawSynthWaveform(this.currentSynthWaveformBuffer);
            if (before !== this.waveformPan && this.currentSynthWaveformBuffer) acknowledgeWaveform(event.currentTarget, 'adjust');
        });
        // Synths are rendered offline so the displayed shape matches Reverse playback.
        this.refreshSynthWaveform();

        noteSnapBtn.style.display = 'inline-block';
        quantizeBtn.style.display = 'none';
        gridSnapBtn.style.display = 'none';
        this.isQuantizing = false;
        this.isGridSnapping = false;
        this.isNoteSnapping = noteSnapBtn.classList.contains('active');

        oscilloscopeCanvas.style.display = 'block';
        this.createSlider(slidersContainer, "attack", 1, 2000, 1, (soundSettings.attack || 0.01) * 1000);
        this.createSlider(slidersContainer, "decay", 1, 2000, 1, (soundSettings.decay || 0.1) * 1000);
        this.createSlider(slidersContainer, "sustain", 1, 2000, 1, (soundSettings.sustain || 0.5) * 1000);
        this.createSlider(slidersContainer, "release", 1, 2000, 1, (soundSettings.release || 0.2) * 1000);
    }

    this.createSlider(slidersContainer, "highPassFrequency", 20, 8000, 1, Math.min(soundSettings.highPassFrequency, 8000));
    this.createSlider(slidersContainer, "lowPassFrequency", 20, 20000, 1, soundSettings.lowPassFrequency);
    this.createSlider(slidersContainer, "pitchShift", -24, 24, 1, Math.max(-24, Math.min(24, soundSettings.pitchShift || 0)));
    this.updateFilterOverlay();
    this.createSlider(slidersContainer, "distortion", 0, 100, 1, soundSettings.distortion * 100);
    this.createSlider(slidersContainer, "delayMix", 0, 100, 1, soundSettings.delayMix * 100);
    this.createSlider(slidersContainer, "delayTime", 0, 1000, 1, soundSettings.delayTime * 1000);
    this.createSlider(slidersContainer, "delayFeedback", 0, 85, 1, soundSettings.delayFeedback * 100);
    this.createSlider(slidersContainer, "reverbMix", 0, 100, 1, soundSettings.reverbMix * 100);
    this.createSlider(slidersContainer, "reverbFeedback", 0, 100, 1, soundSettings.reverbFeedback * 100);

    for (const param in soundSettings) {
      if (typeof soundSettings[param] === "number" && !["attack", "decay", "sustain", "release", "trimStart", "trimEnd", "pitchShift", "probability", "highPassFrequency", "lowPassFrequency", "distortion", "delayMix", "delayTime", "delayFeedback", "reverbMix", "reverbFeedback"].includes(param)) {
        const isTimeBased = param === 'pitchEnvelopeTime';
        const isVolume = param.toLowerCase() === 'volume';
        const min = param.toLowerCase().includes("frequency") ? 20 : (isTimeBased ? 1 : (isVolume ? 0 : 0.01));
        const max = param.toLowerCase().includes("frequency") ? 8000 : (isTimeBased ? 2000 : (isVolume ? 100 : 1));
        const step = param.toLowerCase().includes("frequency") ? 1 : (isTimeBased ? 1 : (isVolume ? 1 : 0.01));
        const value = isTimeBased ? soundSettings[param] * 1000 : (isVolume ? soundSettings[param] * 100 : soundSettings[param]);
        this.createSlider(slidersContainer, param, min, max, step, value);
      }
    }

    this.reorderMainSoundCategories();
    DOM.soundSettingsModal.style.display = "block";
    emitInteractionMotion(DOM.soundSettingsModal, "open");
    this.updateDetailControls();
    if (AppState.createTrackAnalysers) AppState.createTrackAnalysers();
    const modalAnalyser = soundType === "mainBeatSound"
      ? track.mainAnalyserNode
      : track.subdivisionAnalyserNode;
    if (!modalAnalyser) {
      console.warn("Sound modal opened without a dedicated scope analyser", { trackIndex, soundType });
      return;
    }
    this.liveAnalyserNode = modalAnalyser;
    const previewButton = DOM.soundSettingsModal.querySelector("#sound-preview-btn");
    if (previewButton) {
      previewButton.textContent = "▶ Preview";
      previewButton.setAttribute("aria-pressed", "false");
    }
    this.startDrawing(modalAnalyser);
    requestAnimationFrame(() => {
      const firstFocusable = DOM.soundSettingsModal.querySelector("button, select, input, [tabindex]:not([tabindex='-1'])");
      firstFocusable?.focus();
    });
  },

  hide() {
    this.closeSoundConfirmation?.();
    this.editorGeneration = (this.editorGeneration || 0) + 1;
    this.hideEffectsModal();
    this.stopPreview();
    emitInteractionMotion(DOM.soundSettingsModal, "close");
    DOM.soundSettingsModal.style.display = "none";
    this.stopDrawing();
    this.originalPreviewSound = null;
    this.originalPreviewBuffer = null;
    this.previewTarget = null;
    const restoreTarget = this.previouslyFocusedElement;
    this.previouslyFocusedElement = null;
    if (restoreTarget && typeof restoreTarget.focus === "function") {
      requestAnimationFrame(() => restoreTarget.focus());
    }
  },

  getPreviewSoundInfo() {
    const info = this.previewVersion === "original" ? this.originalPreviewSound : this.getCurrentSoundInfo();
    if (!info) return null;
    return {
      sound: AppState.getCustomSoundData(info.sound)?.baseSound || info.sound,
      settings: { ...(this.previewVersion === "original" ? info.settings : this.currentSoundSettings || info.settings || {}) },
    };
  },

  updatePreviewControls() {
    const active = Boolean(this.previewSource || this.previewPending);
    const button = DOM.soundSettingsModal.querySelector("#sound-preview-btn");
    button.textContent = active ? "Stop" : "▶ Preview";
    button.setAttribute("aria-pressed", String(active));
    for (const version of ["original", "edited"]) {
      DOM.soundSettingsModal.querySelector(`#sound-preview-${version}`)?.setAttribute("aria-pressed", String(this.previewVersion === version));
    }
  },

  async selectPreviewVersion(version) {
    if (!["original", "edited"].includes(version) || version === this.previewVersion) return;
    const wasActive = Boolean(this.previewSource || this.previewPending);
    this.stopPreview();
    this.previewVersion = version;
    this.updatePreviewControls();
    emitInteractionMotion(
      DOM.soundSettingsModal.querySelector(`#sound-preview-${version}`),
      "compare"
    );
    if (wasActive) await this.togglePreview();
  },

  async togglePreview() {
    if (this.previewSource || this.previewPending) {
      const kind = this.previewSource ? "stop" : "cancel";
      this.stopPreview();
      emitInteractionMotion(DOM.soundSettingsModal.querySelector("#sound-preview-btn"), kind);
      return false;
    }
    const audioContext = AppState.getAudioContext();
    const track = AppState.getTracks()[this.currentTrackIndex];
    const soundInfo = this.getPreviewSoundInfo();
    const button = DOM.soundSettingsModal.querySelector("#sound-preview-btn");
    if (DOM.soundSettingsModal.style.display === "none") return false;
    if (!audioContext || !track || !soundInfo) {
      emitInteractionMotion(button, "refuse");
      return false;
    }
    const generation = ++this.previewGeneration;
    const target = this.previewTarget;
    const authority = window.isHost;
    const isCurrent = () => generation === this.previewGeneration
      && target === this.previewTarget && track === AppState.getTracks()[this.currentTrackIndex]
      && authority === window.isHost && DOM.soundSettingsModal.style.display !== "none";
    this.previewPending = true;
    this.updatePreviewControls();
    try {
      if (audioContext.state === "suspended") await audioContext.resume();
      if (!isCurrent()) { if (generation === this.previewGeneration) this.stopPreview(); return false; }
      const settings = soundInfo.settings;
      const isSynth = soundInfo.sound?.startsWith("Synth");
      let buffer;
      if (isSynth) {
        const functionName = `play${soundInfo.sound.replace("Synth ", "").replace(/ /g, "")}`;
        emitInteractionMotion(button, "pending");
        buffer = await renderSynthAudioBuffer(audioContext, SoundSynth[functionName], settings);
      } else {
        buffer = this.previewVersion === "original" && this.originalPreviewBuffer
          ? this.originalPreviewBuffer : AppState.getSoundBuffer(soundInfo.sound);
      }
      // A close, Stop, target change, or A/B switch cancels in-flight renders.
      if (!isCurrent()) { if (generation === this.previewGeneration) this.stopPreview(); return false; }
      if (!buffer) {
        this.stopPreview();
        emitInteractionMotion(button, "refuse");
        return false;
      }
      const start = Math.max(0, Math.min(buffer.duration, Number(settings.trimStart) || 0));
      const end = Math.max(start, Math.min(buffer.duration, Number.isFinite(Number(settings.trimEnd)) ? Number(settings.trimEnd) : buffer.duration));
      if (end <= start) {
        this.stopPreview();
        emitInteractionMotion(button, "refuse");
        return false;
      }
      const analyser = audioContext.createAnalyser();
      const output = audioContext.createGain();
      const trackVolume = Number.isFinite(track.volume) ? Math.max(0, Math.min(1, track.volume)) : 1;
      output.gain.value = AppState.getVolume() * trackVolume;
      analyser.connect(output);
      output.connect(Monitoring.getTrackOutput(audioContext, this.currentTrackIndex));
      this.previewAnalyserNode = analyser;
      this.previewOutputNode = output;
      const source = audioContext.createBufferSource();
      const reverse = settings.reverse === true;
      source.buffer = reverse ? getReversedAudioBuffer(audioContext, buffer) : buffer;
      const input = createSoundFilterInput(audioContext, analyser, settings);
      if (isSynth) {
        source.connect(input);
      } else {
        const gain = audioContext.createGain();
        gain.gain.value = settings.volume ?? 1;
        source.playbackRate.value = Math.pow(2, (settings.pitchShift || 0) / 12);
        source.connect(gain);
        gain.connect(input);
      }
      this.previewSource = source;
      source.onended = () => {
        if (generation === this.previewGeneration && this.previewSource === source) {
          const acknowledge = isCurrent();
          this.stopPreview();
          if (acknowledge) emitInteractionMotion(button, "stop");
        }
      };
      source.start(0, reverse ? buffer.duration - end : start, end - start);
      emitInteractionMotion(button, "audition");
      this.previewPending = false;
      this.updatePreviewControls();
      this.startDrawing(analyser);
      return true;
    } catch (error) {
      if (isCurrent()) {
        this.stopPreview();
        emitInteractionMotion(button, "refuse");
      } else if (generation === this.previewGeneration) this.stopPreview();
      console.warn("Sound preview could not start:", error.message);
      return false;
    }
  },

  stopPreview() {
    this.previewGeneration += 1;
    this.previewPending = false;
    if (this.previewTimer) {
      clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
    if (this.previewSource && !this.previewSource.isSynth) {
      try { this.previewSource.stop(); } catch (_) { /* already ended */ }
      this.previewSource.disconnect();
    }
    this.previewSource = null;
    if (this.previewAnalyserNode) {
      try { this.previewAnalyserNode.disconnect(); } catch (_) { /* already disconnected */ }
    }
    this.previewAnalyserNode = null;
    this.previewOutputNode?.disconnect();
    this.previewOutputNode = null;
    this.updatePreviewControls();
    if (this.liveAnalyserNode) this.startDrawing(this.liveAnalyserNode);
  },

  startDrawing(analyserNode) {
    this.stopDrawing();
    const canvas = DOM.soundSettingsModal.querySelector(".oscilloscope-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const signalStatus = DOM.soundSettingsModal.querySelector(".scope-signal-status");
    if (signalStatus) signalStatus.textContent = analyserNode ? "Live processed signal" : "Waiting for audio";
    this.isDrawing = true;

    const draw = () => {
      if (!this.isDrawing) return;

      this.animationFrameId = requestAnimationFrame(draw);

      const rect = canvas.getBoundingClientRect();
      const cssWidth = Math.floor(rect.width || canvas.clientWidth || 300);
      const cssHeight = Math.floor(rect.height || canvas.clientHeight || 120);

      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const targetWidth = Math.max(10, Math.floor(cssWidth * dpr));
      const targetHeight = Math.max(10, Math.floor(cssHeight * dpr));

      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (analyserNode) {
        const bufferLength = analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        const frequencyArray = new Uint8Array(bufferLength);
        const displayMode = this.scopeMode;
        if (displayMode === "spectrum" || displayMode === "spectrogram") {
          analyserNode.getByteFrequencyData(frequencyArray);
        } else {
          analyserNode.getByteTimeDomainData(dataArray);
        }

        // Get computed colors with safe fallbacks for iOS Safari Canvas2D
        const rootStyle = getComputedStyle(document.documentElement);
        const mainColor = rootStyle.getPropertyValue("--Main").trim() || "#4caf50";
        const accentColor = rootStyle.getPropertyValue("--Accent").trim() || "#81c784";
        const highlightColor = rootStyle.getPropertyValue("--Highlight").trim() || "#a5d6a7";

        try {
          const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
          gradient.addColorStop(0, mainColor);
          gradient.addColorStop(0.5, accentColor);
          gradient.addColorStop(1, highlightColor);
          ctx.strokeStyle = gradient;
        } catch (e) {
          ctx.strokeStyle = mainColor;
        }

        if (displayMode === "spectrogram") {
          const barWidth = canvas.width / bufferLength;
          for (let i = 0; i < bufferLength; i += 1) {
            ctx.globalAlpha = frequencyArray[i] / 255;
            ctx.fillStyle = accentColor;
            ctx.fillRect(i * barWidth, canvas.height - frequencyArray[i] / 255 * canvas.height, Math.max(1, barWidth), frequencyArray[i] / 255 * canvas.height);
          }
          ctx.globalAlpha = 1;
        } else if (displayMode === "spectrum") {
          ctx.fillStyle = accentColor;
          for (let i = 0; i < bufferLength; i += 2) {
            const barHeight = frequencyArray[i] / 255 * canvas.height;
            ctx.fillRect(i / bufferLength * canvas.width, canvas.height - barHeight, Math.max(1, canvas.width / bufferLength * 2), barHeight);
          }
        } else {
          ctx.lineWidth = Math.max(2, Math.floor(2 * dpr));
          ctx.beginPath();

          const sliceWidth = (canvas.width * 1.0) / bufferLength;
          let x = 0;
          for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 128.0;
            const y = (v * canvas.height) / 2;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            x += sliceWidth;
          }
          ctx.lineTo(canvas.width, canvas.height / 2);
          ctx.stroke();
        }
      }
      ctx.restore();
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