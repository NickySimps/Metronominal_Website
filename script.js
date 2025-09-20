import { WebRTC, sendState, initializeShareControls, initializeWebRTC, disconnectAllPeers } from "./js/webrtc.js"; 
import AppState from "./js/appState.js";
import DOM from "./js/domSelectors.js";
import UIController from "./js/uiController.js";
import ThemeController from "./js/themeController.js";
import TempoController from "./js/tempoController.js";
import PlaybackController from "./js/playbackController.js";
import BarControlsController from "./js/barControlsController.js";
import BarDisplayController from './js/barDisplayController.js'
import TrackController from "./js/tracksController.js";
import PresetController from "./js/presetController.js";
import VolumeController from "./js/volumeController.js";
import MetronomeEngine from "./js/metronomeEngine.js";
import SoundSettingsModal from "./js/soundSettingsModal.js";
import Oscilloscope from "./js/oscilloscope.js"; // 1. IMPORT a new module
import UserInteraction from './js/userInteraction.js';
import AudioController from './js/audioController.js';
import RecordingManager from './js/recordingManager.js';

let qrCodeInstance = null;

/**
 * Refreshes all relevant UI components to reflect the current AppState.
 */
function refreshUIFromState() {
  TempoController.updateTempoDisplay({ animate: true });
  VolumeController.updateVolumeDisplay({ animate: true });
  UIController.updateScreenOffToggleBtn();

  TrackController.renderTracks();
  BarControlsController.updateBarControlsForSelectedTrack();
  
  // Only the host should send state updates
  if (window.isHost) {
    console.log('Host sending state update from refreshUIFromState');
    sendState(AppState.getCurrentStateForPreset());
  }

  if (
    AppState.getCurrentTheme() === "3dRoom" &&
    ThemeController.is3DSceneActive()
  ) {
    ThemeController.update3DScenePostStateChange();
  }
}

function syncPlaybackState() {
  const isPlaying = AppState.isPlaying(); 
  if (isPlaying && !MetronomeEngine.isPlaying()) {
    MetronomeEngine.start();
  } else if (!isPlaying && MetronomeEngine.isPlaying()) {
    MetronomeEngine.stop();
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
  } else {
    await AppState.loadAudioBuffers();
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
  RecordingManager.init();
  UIController.initializeConnectionModal();
  console.log('DOM.recordingDisplayModal:', DOM.recordingDisplayModal);
  AudioController.initialize();


  // 5. First UI render and start oscilloscope if audio is already active
  refreshUIFromState();
  if(AppState.getAudioContext()?.state === 'running') {
    Oscilloscope.start();
  }
  initializeShareControls();
  initializeWebRTC();

  // Make the disconnect button functional for the host.
  if (DOM.disconnectBtn) {
    DOM.disconnectBtn.addEventListener('click', () => {
      // Only the host can disconnect all peers.
      if (window.isHost) {
        disconnectAllPeers();
      }
    });
  }

  console.log("Metronominal initialized successfully.");
}



/**
 * Handles all UI updates that need to happen when track selection changes.
 */
function handleTrackSelectionChange() {
  BarControlsController.updateBarControlsForSelectedTrack();
}

// --- EVENT LISTENERS ---

// Listen for the custom event from tracksController.js
document.addEventListener('trackselectionchanged', handleTrackSelectionChange);

document.addEventListener('primeAudio', () => {
    UserInteraction.handleFirstInteraction();
});

// Listen for clicks on the whole page to handle "clicking outside"
document.addEventListener('click', (event) => {
  const trackWrapper = DOM.trackWrapper;
  const measuresContainer = DOM.measuresContainer;
  const addTrackButton = DOM.addTrackButton;

  // If the click is on the "add track" button, do nothing. Its own handler will manage the state.
  if (addTrackButton && addTrackButton.contains(event.target)) {
    return;
  }

  // If the click is outside the track wrapper AND outside the bar controls, deselect the current track.
  if (trackWrapper && !trackWrapper.contains(event.target) &&
      measuresContainer && !measuresContainer.contains(event.target)) {
    if (AppState.getSelectedTrackIndex() !== -1) {
      AppState.setControlsAttachedToTrack(false);
      document.dispatchEvent(new CustomEvent('trackselectionchanged')); // Announce change
      BarDisplayController.renderBarsAndControls(); // Re-render to keep selection visuals
    }
  }
});

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
    case "d": // 'd': Disconnect all peers (host only)
      event.preventDefault();
      if (window.isHost) {
        disconnectAllPeers();
      }
      break;
    case "ArrowUp":
      event.preventDefault();
      AppState.setVolume(AppState.getVolume() + 0.01);
      VolumeController.updateVolumeDisplay({ animate: true });
      if (window.isHost) {
        sendState(AppState.getCurrentStateForPreset());
      }
      break;
    case "ArrowDown":
      event.preventDefault();
      AppState.setVolume(AppState.getVolume() - 0.01);
      VolumeController.updateVolumeDisplay({ animate: true });
      if (window.isHost) {
        sendState(AppState.getCurrentStateForPreset());
      }
      break;
  }
});