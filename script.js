
import AppState from "./js/appState.js";
import DOM from "./js/domSelectors.js";
import UIController from "./js/uiController.js";
import ThemeController from "./js/themeController.js";
import TempoController from "./js/tempoController.js";
import PlaybackController from "./js/playbackController.js";
import BarControlsController from "./js/barControlsController.js";
import TrackController from "./js/tracksController.js";
import PresetController from "./js/presetController.js";
import VolumeController from "./js/volumeController.js";
import MetronomeEngine from "./js/metronomeEngine.js";
import SoundSettingsModal from "./js/soundSettingsModal.js";
import Oscilloscope from "./js/oscilloscope.js"; // 1. IMPORT a new module

/**
 * Refreshes all relevant UI components to reflect the current AppState.
 */
function refreshUIFromState() {
  TempoController.updateTempoDisplay({ animate: true });
  VolumeController.updateVolumeDisplay({ animate: true });

  TrackController.renderTracks();
  BarControlsController.updateBarControlsForSelectedTrack();

  if (
    AppState.getCurrentTheme() === "3dRoom" &&
    ThemeController.is3DSceneActive()
  ) {
    ThemeController.update3DScenePostStateChange();
  }
}

/**
 * Initializes the entire application.
 */
async function initialize() {
    // 1. Initialize AudioContext and handle its state.
  const audioContext = AppState.initializeAudioContext();

  if (!audioContext) {
    console.warn("AudioContext could not be initialized. Sound will be unavailable.");
  } else if (audioContext.state === 'running') {
    // Audio is already active, load buffers.
    await AppState.loadAudioBuffers();
  } else if (audioContext.state === 'suspended') {
    // Audio is suspended. Needs a user gesture to start.
    console.log("AudioContext is suspended. Waiting for user interaction to start audio.");
    const resumeAudio = async () => {
      try {
        await audioContext.resume();
        console.log("AudioContext resumed successfully.");
        await AppState.loadAudioBuffers();
        Oscilloscope.start(); // Start visuals only after context is running
      } catch (e) {
        console.error("Error resuming AudioContext:", e);
      }
    };
        document.addEventListener('click', resumeAudio, { once: true });
    document.addEventListener('keydown', resumeAudio, { once: true });
  }


  // 3. Load state from local storage or reset.
  const stateLoaded = AppState.loadStateFromLocalStorage();
  if (!stateLoaded) {
    AppState.resetState();
  }

  // 4. Initialize all controllers.
  Oscilloscope.init(); // INITIALIZE the oscilloscope
  UIController.initializeUIControls(refreshUIFromState);
  ThemeController.initializeThemeControls();
  TempoController.initializeTempoControls();
  PlaybackController.initializePlaybackControls();
  BarControlsController.initializeBarControls();
  TrackController.init();
  PresetController.initializePresetControls(refreshUIFromState);
  VolumeController.initializeVolumeControls();
  SoundSettingsModal.init();

  // 5. First UI render and start oscilloscope if audio is already active
  refreshUIFromState();
   if(AppState.getAudioContext()?.state === 'running') {
    Oscilloscope.start();
   }

  console.log("Metronominal initialized successfully.");
}

// Start the application once the DOM is ready.
document.addEventListener("DOMContentLoaded", initialize);

// Keyboard shortcut handling
document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return; // Disable shortcuts when typing in input fields
  switch (event.key) {
    case " ": // Spacebar: Toggle play/pause
      event.preventDefault();
      MetronomeEngine.togglePlay();
      break;
    case "t": // 't': Tap tempo
      event.preventDefault();
      DOM.tapTempoBtn.click(); // Simulate click on the tap tempo button
      break;
    case "r": // 'r': Reset
      event.preventDefault();
      AppState.resetState();
      refreshUIFromState();
      break;
    case "=": // '=' Increase Tempo
    case "+":
      event.preventDefault();
      DOM.increaseTempoBtn.click();
      break;
    case "-": // '-' Decrease Tempo
    case "_":
      event.preventDefault();
      DOM.decreaseTempoBtn.click();
      break;
    case "]": // ']' Increase Bars
      event.preventDefault();
      BarControlsController.increaseBarLength();
      break;
    case "[": // '[' Decrease Bars
      event.preventDefault();
      BarControlsController.decreaseBarLength();
      break;
    case "'": // ''' Increase Beats (Apostrophe)
      event.preventDefault();
      DOM.increaseMeasureLengthBtn.click();
      break;
    case ";": // ';' Decrease Beats (Semicolon)
      event.preventDefault();
      DOM.decreaseMeasureLengthBtn.click();
      break;
    case "ArrowUp":
      event.preventDefault();
      AppState.setVolume(AppState.getVolume() + 0.01);
      VolumeController.updateVolumeDisplay({ animate: true });
      break;
    case "ArrowDown":
      event.preventDefault();
      AppState.setVolume(AppState.getVolume() - 0.01);
      VolumeController.updateVolumeDisplay({ animate: true });
      break;
  }
});
