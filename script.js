import { WebRTC, sendState } from "./js/webrtc.js";
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


let qrCodeInstance = null;

/**
 * Refreshes all relevant UI components to reflect the current AppState.
 */
function refreshUIFromState() {
  TempoController.updateTempoDisplay({ animate: true });
  VolumeController.updateVolumeDisplay({ animate: true });

  TrackController.renderTracks();
  BarControlsController.updateBarControlsForSelectedTrack();
  sendState(AppState.getCurrentStateForPreset());

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
  initializeShareControls();
  WebRTC.onReceiveState(onStateReceived);

    // Check the URL for an offer when the page loads.
  const urlParams = new URLSearchParams(window.location.search);
  const offerFromUrl = urlParams.get('s'); // Using a shorter param 's' for 'session'

  if (offerFromUrl) {
    // This user is the JOINER.
    try {
        // 1. Decode from Base64 to get the binary string
        const compressedString = atob(offerFromUrl);
        // 2. Convert the binary string into a Uint8Array
        const compressed = new Uint8Array(compressedString.length);
        for (let i = 0; i < compressedString.length; i++) {
            compressed[i] = compressedString.charCodeAt(i);
        }
        // 3. Decompress the data back to the original JSON string
        const decompressed = pako.inflate(compressed, { to: 'string' });
        const decodedOffer = JSON.parse(decompressed);
        handleJoinerFlow(decodedOffer);
    } catch (e) {
        console.error("Failed to decode or decompress the offer from URL:", e);
        alert("The session link appears to be invalid or corrupted.");
    }
  }
  console.log("Metronominal initialized successfully.");
}
/**
 * Moves the controls container based on whether a track is selected.
 * This version is SYNCHRONOUS to prevent race conditions.
 */
function updateControlsPosition() {
    const selectedTrackIndex = AppState.getSelectedTrackIndex();
    const measuresContainer = DOM.measuresContainer;
    const metronomeContainer = DOM.metronomeContainer;
    const startStopBtn = DOM.startStopBtn;

    if (!measuresContainer || !metronomeContainer || !startStopBtn) return;

    // If a track is selected, move the controls to that track
    if (selectedTrackIndex !== -1 && AppState.getControlsAttachedToTrack()) {
        const selectedTrackElement = DOM.trackWrapper.querySelector(`.track[data-container-index="${selectedTrackIndex}"]`);
        // Move the container synchronously if it's not already in the correct track
        if (selectedTrackElement && measuresContainer.parentNode !== selectedTrackElement) {
            selectedTrackElement.appendChild(measuresContainer);
        }
    }
    // Otherwise, move it back to the main container's default position
    else {
        if (measuresContainer.parentNode !== metronomeContainer) {
            // Insert it before the start/stop button
            metronomeContainer.insertBefore(measuresContainer, startStopBtn);
        }
    }
}

/**
 * Handles all UI updates that need to happen when track selection changes.
 */
function handleTrackSelectionChange() {
    updateControlsPosition();
    BarControlsController.updateBarControlsForSelectedTrack();
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

/**
 * Sets up the UI and logic for the 'Share' button and modal.
 * This function now lives in script.js where it belongs.
 */
function initializeShareControls() {
    const shareBtn = document.getElementById("share-btn");
    const shareModal = document.getElementById("share-modal");
    const connectBtn = document.getElementById('connect-btn');
    const pasteAnswerText = document.getElementById('paste-answer-sdp');

    // HOST: Clicks the "Share" button to start a session.
    shareBtn.addEventListener('click', async () => {
        // Set the modal to "Host" mode
        document.getElementById('modal-title').textContent = 'Share Session (You are the Host)';
        document.getElementById('host-section').style.display = 'block';
        document.getElementById('joiner-section').style.display = 'none';
        pasteAnswerText.value = ''; // Clear previous answer

        // Create the offer and the unique URL
        const offer = await WebRTC.createOffer();
        const offerString = JSON.stringify(offer);
        // 1. Compress the offer string into a Uint8Array
        const compressed = pako.deflate(offerString);
        // 2. Convert the binary data to a Base64 string to use in the URL
        const encodedOffer = btoa(String.fromCharCode.apply(null, compressed));

        const joinUrl = `${window.location.origin}${window.location.pathname}?s=${encodedOffer}`; // Using shorter 's' param
        // Make the modal visible FIRST, so the QR code container has dimensions.
        shareModal.style.display = 'block';

        // Generate the QR code
        const qrcodeContainer = document.getElementById('qrcode');
        qrcodeContainer.innerHTML = ''; // Clear previous QR code or error message
        try {
            // Attempt to generate the QR code
            new QRCode(qrcodeContainer, { text: joinUrl, width: 256, height: 256 });
        } catch (e) {
            // If it fails (likely due to data length), provide a fallback
            console.error("QR Code generation failed, likely due to data length.", e);
            qrcodeContainer.innerHTML = `
                <p style="color: var(--TextPrimary); margin-bottom: 8px;">Could not generate QR Code. The session URL is too long.</p>
                <p style="color: var(--TextPrimary); margin-bottom: 8px;">Please have the joiner copy this URL manually:</p>
            `;
            const urlText = document.createElement('textarea');
            urlText.value = joinUrl;
            urlText.readOnly = true;
            urlText.style.cssText = 'width: 100%; resize: none; height: 120px;';
            qrcodeContainer.appendChild(urlText);
        }
    });

    // HOST: Clicks "Connect" to finalize the session.
    connectBtn.addEventListener('click', async () => {
        try {
            const answer = JSON.parse(pasteAnswerText.value);
            await WebRTC.acceptAnswer(answer);
        } catch (e) {
            alert("The answer format is invalid. Please copy it again.");
        }
    });

    // General modal close logic
    shareModal.querySelector(".close-button").addEventListener("click", () => {
        shareModal.style.display = 'none';
    });
}

/**
 * Handles the logic flow for a user who joins by scanning a QR code.
 * @param {RTCSessionDescriptionInit} offer The decoded offer from the URL.
 */
async function handleJoinerFlow(offer) {
    const shareModal = document.getElementById("share-modal");

    // Set the modal to "Joiner" mode
    document.getElementById('modal-title').textContent = 'Join Session (You are the Joiner)';
    document.getElementById('host-section').style.display = 'none';
    document.getElementById('joiner-section').style.display = 'block';

    // Automatically generate the answer and display it for copying
    const answerSdpText = document.getElementById('answer-sdp');
    const answer = await WebRTC.createAnswer(offer);
    answerSdpText.value = JSON.stringify(answer);

    shareModal.style.display = 'block';
}

/**
 * Callback that runs when a new state is received from the connected peer.
 * @param {object} newState The state object from the other user.
 */
function onStateReceived(newState) {
    console.log("Received new state:", newState);
    AppState.loadPresetData(newState);
    // You must re-render the UI after loading the new state.
    // Calling your existing refresh function is a good way to do this,
    // but without the sendState() call to avoid an infinite loop.
    TempoController.updateTempoDisplay({ animate: true });
    VolumeController.updateVolumeDisplay({ animate: true });
    TrackController.renderTracks();
    BarControlsController.updateBarControlsForSelectedTrack();
}


// --- Keep the rest of your script.js file as is ---
// updateControlsPosition(), handleTrackSelectionChange(), event listeners, etc.

// Start the application.
document.addEventListener("DOMContentLoaded", initialize);