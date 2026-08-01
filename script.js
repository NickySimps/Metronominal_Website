import { WebRTC, sendState, initializeShareControls, initializeWebRTC, disconnect, disconnectAllPeers } from "./js/webrtc.js";
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
import StickyControls from './js/stickyControls.js';
import SongController from './js/songController.js';
import SpeedTrainerController from './js/speedTrainerController.js';
import MidiController from './js/midiController.js';

let qrCodeInstance = null;
let appInitialized = false;
let pendingStartupPlay = false;

// The audio files finish loading asynchronously. Capture a Play request made
// during that window instead of silently losing it before the controllers attach.
function queueStartupPlay() {
  pendingStartupPlay = !pendingStartupPlay;
  if (DOM.startStopBtn) {
    DOM.startStopBtn.textContent = pendingStartupPlay ? '…' : '▶';
    DOM.startStopBtn.classList.toggle('pending', pendingStartupPlay);
  }
  if (pendingStartupPlay) AppState.getAudioContext()?.resume().catch(() => {});
}

for (const playButton of [DOM.startStopBtn, document.getElementById('sticky-play-pause-btn')]) {
  playButton?.addEventListener('click', event => {
    if (appInitialized) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    queueStartupPlay();
  }, true);
}

/**
 * Refreshes all relevant UI components to reflect the current AppState.
 */
function refreshUIFromState() {
  TempoController.updateTempoDisplay({ animate: true });
  VolumeController.updateVolumeDisplay({ animate: true });
  UIController.updateScreenOffToggleBtn();
  if (DOM.countInBarsSelect) DOM.countInBarsSelect.value = String(AppState.getCountInBars());
  if (DOM.audioLatencySlider && DOM.audioLatencyValue) {
    const val = AppState.getLatencyOffset ? AppState.getLatencyOffset() : 0;
    DOM.audioLatencySlider.value = String(val);
    DOM.audioLatencyValue.textContent = `${val > 0 ? '+' : ''}${val} ms`;
  }
  SongController.render();

  TrackController.renderTracks();
  BarControlsController.updateBarControlsForSelectedTrack();
  
  // Only the host should send state updates
  if (window.isHost) {
    console.log('Host sending state update from refreshUIFromState');
    sendState(AppState.getCurrentStateForPreset(true));
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
  const stateLoaded = await AppState.loadStateFromLocalStorage();
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
  DOM.countInBarsSelect?.addEventListener('change', () => {
    if (!window.isHost) return;
    AppState.setCountInBars(DOM.countInBarsSelect.value);
    sendState(AppState.getCurrentStateForPreset(true));
  });
  if (DOM.audioLatencySlider && DOM.audioLatencyValue) {
    DOM.audioLatencySlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10) || 0;
      AppState.setLatencyOffset(val);
      DOM.audioLatencyValue.textContent = `${val > 0 ? '+' : ''}${val} ms`;
    });
  }
  const abStart = document.getElementById("ab-start-bar");
  const abEnd = document.getElementById("ab-end-bar");
  const abBtn = document.getElementById("ab-loop-toggle-btn");
  if (abStart && abEnd && abBtn) {
    const updateAb = () => {
      const s = (parseInt(abStart.value, 10) || 1) - 1;
      const e = (parseInt(abEnd.value, 10) || 1) - 1;
      AppState.setAbLoop({ startBar: Math.min(s, e), endBar: Math.max(s, e) });
    };
    abStart.addEventListener("input", updateAb);
    abEnd.addEventListener("input", updateAb);
    abBtn.addEventListener("click", () => {
      const current = AppState.getAbLoop();
      const nextEnabled = !current.enabled;
      AppState.setAbLoop({ enabled: nextEnabled });
      abBtn.textContent = nextEnabled ? "🔂 Loop ON" : "🔂 Loop Off";
      abBtn.classList.toggle("active", nextEnabled);
    });
  }
  SoundSettingsModal.init();
  RecordingManager.init();
  SpeedTrainerController.init();
  MidiController.init();
  UIController.initializeConnectionModal();
  console.log('DOM.recordingDisplayModal:', DOM.recordingDisplayModal);
  AudioController.initialize();
  StickyControls.init();
  await SongController.initialize(refreshUIFromState);
  
  // Register Sticky Controls listeners
  TempoController.registerTempoChangeListener(() => StickyControls.updateDisplay());
  VolumeController.registerVolumeChangeListener(() => StickyControls.updateDisplay());
  MetronomeEngine.registerPlayStateChangeListener(() => StickyControls.updatePlayButtonState());


  // 5. First UI render and start oscilloscope if audio is already active
  refreshUIFromState();
  if(AppState.getAudioContext()?.state === 'running') {
    Oscilloscope.start();
  }
  
  // Unlock AudioContext on first user interaction (Crucial for Mobile)
  const unlockAudio = async () => {
      await UserInteraction.handleFirstInteraction();
      // Only remove listeners once the context is genuinely running;
      // on iOS the first attempt can fail (interrupted state, mute switch).
      if (UserInteraction.audioContextInitialized) {
          document.removeEventListener('click', unlockAudio);
          document.removeEventListener('keydown', unlockAudio);
          document.removeEventListener('touchend', unlockAudio);
      }
  };
  document.addEventListener('click', unlockAudio);
  document.addEventListener('keydown', unlockAudio);
  // iOS requires the gesture to complete: touchend counts as user activation,
  // touchstart alone may not.
  document.addEventListener('touchend', unlockAudio);

  initializeShareControls();
  await initializeWebRTC();

  appInitialized = true;
  if (pendingStartupPlay) {
    pendingStartupPlay = false;
    if (DOM.startStopBtn) {
      DOM.startStopBtn.textContent = '▶';
      DOM.startStopBtn.classList.remove('pending');
    }
    await MetronomeEngine.togglePlay();
  }

  // Hosts close their room; clients leave it and return to a fresh solo session.
  if (DOM.disconnectBtn) {
    DOM.disconnectBtn.addEventListener('click', () => {
      if (window.isHost) {
        disconnectAllPeers();
      } else {
        disconnect();
        const soloUrl = new URL(window.location.href);
        soloUrl.searchParams.delete('room');
        window.location.replace(soloUrl.href);
      }
    });
  }

  console.log("Metronominal initialized successfully.");
}



/**
 * Handles all UI updates that need to happen when track selection changes.
 */
function handleTrackSelectionChange(event) {
  BarControlsController.updateBarControlsForSelectedTrack();
  // Only scroll if shouldScroll is not explicitly false
  if (event.detail && event.detail.shouldScroll === false) {
    return;
  }
  TrackController.scrollToSelectedTrack();
}

// --- EVENT LISTENERS ---

// Listen for the custom event from tracksController.js
document.addEventListener('trackselectionchanged', handleTrackSelectionChange);

// Listen for clicks on the whole page to handle "clicking outside"
document.addEventListener('click', (event) => {
  const trackWrapper = DOM.trackWrapper;
  const measuresContainer = DOM.measuresContainer;
  const addTrackButton = DOM.addTrackButton;

  // If the click is on the "add track" button, do nothing. Its own handler will manage the state.
  if (addTrackButton && addTrackButton.contains(event.target)) {
    return;
  }

  // If the click is on a track or its controls, don't do anything here (handled by TrackController)
  if (event.target.closest('.track') || (measuresContainer && measuresContainer.contains(event.target))) {
    return;
  }
});

// Register Service Worker for offline PWA capabilities
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Service Worker registration failed:', err);
    });
  });
}

// Start the application once the DOM is ready.
document.addEventListener("DOMContentLoaded", initialize);

// Keyboard shortcut handling
document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return; // Disable shortcuts when typing in input fields
  switch (event.key) {
    case " ": // Spacebar: Toggle play/pause
      event.preventDefault();
      if (appInitialized) MetronomeEngine.togglePlay();
      else queueStartupPlay();
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
        sendState(AppState.getCurrentStateForPreset(true));
      }
      break;
    case "ArrowDown":
      event.preventDefault();
      AppState.setVolume(AppState.getVolume() - 0.01);
      VolumeController.updateVolumeDisplay({ animate: true });
      if (window.isHost) {
        sendState(AppState.getCurrentStateForPreset(true));
      }
      break;
  }
});