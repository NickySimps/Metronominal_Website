import AppState from "./appState.js";
import BarControlsController from "./barControlsController.js";
import { sendState } from "./webrtc.js";
import BarDisplayController from "./barDisplayController.js";
import SoundSettingsModal from "./soundSettingsModal.js";

/**
 * Creates a complete DOM element for a single track.
 * @param {object} track - The track data from AppState.
 * @param {number} index - The index of the track.
 * @returns {HTMLElement} The created track element.
 */
function createTrackElement(track, index) {
  const trackElement = document.createElement("div");
  trackElement.classList.add("track");
  trackElement.dataset.containerIndex = index;

  // Apply a rotating color class for visual distinction
  const colorInversionClass = `track-color-${index % 6}`;
  trackElement.classList.add(colorInversionClass);

  // Add classes for soloed or muted states
  if (track.solo) {
    trackElement.classList.add("soloed");
  }
  if (track.muted) {
    trackElement.classList.add("muted");
  }

  trackElement.innerHTML = `
    <div class="track-controls">
      <span class="track-name">Track ${index + 1}</span>
      <button class="track-mute-btn">${track.muted ? "Unmute" : "Mute"}</button>
      <button class="track-solo-btn">${track.solo ? "Unsolo" : "Solo"}</button>
      <button class="track-remove-btn">-</button>
      <div class="track-volume-controls">
        <span class="track-volume-label">Vol:</span>
        <input type="range" id="track-volume-${index}" class="track-volume-slider" min="0" max="1" step="0.01" value="${
    track.volume
  }">
        <span class="track-volume-value">${(track.volume * 100).toFixed(
          0
        )}%</span>
      </div>
    </div>
    <div class="track-sound-controls">
      <div class="sound-selection">
        <span class="sound-label">Main:</span>
      </div>
      <button class="rest-button">𝄽</button>
      <div class="sound-selection">
        <span class="sound-label">Sub:</span>
      </div>
    </div>
    <div class="bar-display-container" data-container-index="${index}"></div>
  `;

  // Find placeholders and append the actual sound dropdowns
  const mainSoundSelectorContainer = trackElement.querySelector(
    ".sound-selection:nth-child(1)"
  );
  const subSoundSelectorContainer = trackElement.querySelector(
    ".sound-selection:nth-child(3)"
  );

  if (mainSoundSelectorContainer && subSoundSelectorContainer) {
    mainSoundSelectorContainer.appendChild(
      createSoundSelector(track.mainBeatSound, "main-beat-sound-select")
    );
    subSoundSelectorContainer.appendChild(
      createSoundSelector(track.subdivisionSound, "subdivision-sound-select")
    );
  }

  return trackElement;
}

/**
 * Updates an existing track's DOM element with new data from the state.
 * @param {HTMLElement} trackElement - The DOM element of the track to update.
 * @param {object} track - The track data from AppState.
 * @param {number} index - The new index of the track.
 */
function updateTrackElement(trackElement, track, index) {
  // Update data-container-index (important if tracks are reordered/removed)
  trackElement.dataset.containerIndex = index;

  // Update color class
  for (let i = 0; i < 6; i++) {
    trackElement.classList.remove(`track-color-${i}`);
  }
  trackElement.classList.add(`track-color-${index % 6}`);

  // Update solo/muted state classes and button text
  trackElement.classList.toggle("soloed", track.solo);
  trackElement.classList.toggle("muted", track.muted);
  trackElement.querySelector(".track-mute-btn").textContent = track.muted
    ? "Unmute"
    : "Mute";
  trackElement.querySelector(".track-solo-btn").textContent = track.solo
    ? "Unsolo"
    : "Solo";

  // Update track name
  trackElement.querySelector(".track-name").textContent = `Track ${index + 1}`;

  // Update volume slider and display
  trackElement.querySelector(".track-volume-slider").value = track.volume;
  trackElement.querySelector(".track-volume-value").textContent = `${(
    track.volume * 100
  ).toFixed(0)}%`;

  // Update sound selectors
  trackElement.querySelector(".main-beat-sound-select").value =
    track.mainBeatSound.sound;
  trackElement.querySelector(".subdivision-sound-select").value =
    track.subdivisionSound.sound;

  // Update rest button active state
  trackElement.querySelector(".rest-button").classList.toggle("active", AppState.isRestMode());

  // The bar-display-container's data-container-index also needs updating
  const barDisplayContainer = trackElement.querySelector(
    ".bar-display-container"
  );
  if (barDisplayContainer) barDisplayContainer.dataset.containerIndex = index;
}

const TrackController = {
  longPressTimer: null,

  /**
   * Initializes the TrackController by setting up event listeners for track-related UI elements.
   */
  init: () => {
    // The 'Add Track' button is static, so we can query it once.
    const addTrackButton = document.getElementById("add-track-btn");
    if (addTrackButton) {
      addTrackButton.addEventListener("click", TrackController.addTrack);
    }

    // The trackWrapper is the container for all tracks and is also static.
    // We use event delegation on this wrapper to handle events for dynamically added tracks.
    const trackWrapper = document.getElementById("all-tracks-wrapper");
    if (trackWrapper) {
      trackWrapper.addEventListener("click", TrackController.handleTrackClicks);
      trackWrapper.addEventListener(
        "input",
        TrackController.handleTrackSliderInput
      );
      trackWrapper.addEventListener(
        "change",
        TrackController.handleTrackSoundChange
      );
      trackWrapper.addEventListener(
        "mousedown",
        TrackController.handleMouseDown
      );
      trackWrapper.addEventListener("mouseup", TrackController.handleMouseUp);
    }
    TrackController.renderTracks();
  },

  /**
   * Renders all tracks from the application state into the DOM.
   */
  renderTracks: () => {
    const tracks = AppState.getTracks();
    const trackWrapper = document.getElementById("all-tracks-wrapper");
    if (!trackWrapper) return;

    trackWrapper.innerHTML = ""; // Clear existing track elements

    tracks.forEach((track, index) => {
      const trackElement = document.createElement("div");
      trackElement.classList.add("track");
      trackElement.dataset.containerIndex = index;

      // Apply a rotating color class for visual distinction
      const colorInversionClass = `track-color-${index % 6}`;
      trackElement.classList.add(colorInversionClass);

      // Add classes for soloed or muted states
      if (track.solo) {
        trackElement.classList.add("soloed");
      }
      if (track.muted) {
        trackElement.classList.add("muted");
      }

      trackElement.innerHTML = `
        <div class="track-controls">
          <span class="track-name">Track ${index + 1}</span>
          <button class="track-mute-btn">${
            track.muted ? "Unmute" : "Mute"
          }</button>
          <button class="track-solo-btn">${
            track.solo ? "Unsolo" : "Solo"
          }</button>
          <button class="track-remove-btn">-</button>
          <div class="track-volume-controls">
            <span class="track-volume-label">Vol:</span>
            <input type="range" id="track-volume-${index}" class="track-volume-slider" min="0" max="1" step="0.01" value="${
        track.volume
      }">
            <span class="track-volume-value">${(track.volume * 100).toFixed(
              0
            )}%</span>
          </div>
        </div>
        <div class="track-sound-controls">
          <div class="sound-selection">
            <span class="sound-label">Main:</span>
          </div>
          <button class="rest-button ${AppState.isRestMode() ? 'active' : ''}">𝄽</button>
          <div class="sound-selection">
            <span class="sound-label">Sub:</span>
          </div>
        </div>
        <div class="bar-display-container" data-container-index="${index}"></div>
      `;

      // Find placeholders and append the actual sound dropdowns
      const mainSoundSelectorContainer = trackElement.querySelector(
        ".sound-selection:nth-child(1)"
      );
      const subSoundSelectorContainer = trackElement.querySelector(
        ".sound-selection:nth-child(3)"
      );

      if (mainSoundSelectorContainer && subSoundSelectorContainer) {
        mainSoundSelectorContainer.appendChild(
          createSoundSelector(track.mainBeatSound, "main-beat-sound-select")
        );
        subSoundSelectorContainer.appendChild(
          createSoundSelector(
            track.subdivisionSound,
            "subdivision-sound-select"
          )
        );
      }

      trackWrapper.appendChild(trackElement);
    });

    // Re-render the bar display for all tracks
    BarDisplayController.renderBarsAndControls();
  },

  /**
   * Handles click events within the entire track wrapper.
   * @param {Event} event - The click event.
   */
  handleTrackClicks: (event) => {
    const target = event.target;
    const trackElement = target.closest(".track");

    if (!trackElement) return;

    const containerIndex = parseInt(trackElement.dataset.containerIndex, 10);

    // Get the measures container once, as it's needed in multiple branches.
    const measuresContainer = document.querySelector(".measures-container");

    if (target.matches(".track-mute-btn")) {
      // --- Protective logic to prevent controls from being deleted during re-render ---
      const originalParent = measuresContainer
        ? measuresContainer.parentNode
        : null;
      const controlsWereMoved =
        originalParent && originalParent.classList.contains("track");
      if (controlsWereMoved) {
        document.body.appendChild(measuresContainer);
      }

      const track = AppState.getTracks()[containerIndex];
      AppState.updateTrack(containerIndex, { muted: !track.muted });
      sendState(AppState.getCurrentStateForPreset());
      TrackController.renderTracks(); // This is destructive

      // --- Move controls back to the selected track ---
      // Muting doesn't change selection, so we manually move the controls back
      // to the currently selected track's element.
      if (controlsWereMoved) {
        const selectedTrackIndex = AppState.getSelectedTrackIndex();
        const newTrackElement = document.querySelector(
          `.track[data-container-index="${selectedTrackIndex}"]`
        );
        if (newTrackElement) {
          newTrackElement.appendChild(measuresContainer);
        }
      }
    } else if (target.matches(".track-solo-btn")) {
      // --- Protective logic ---
      const originalParent = measuresContainer
        ? measuresContainer.parentNode
        : null;
      const controlsWereMoved =
        originalParent && originalParent.classList.contains("track");
      if (controlsWereMoved) {
        document.body.appendChild(measuresContainer);
      }

      AppState.toggleSolo(containerIndex);
      sendState(AppState.getCurrentStateForPreset());
      TrackController.renderTracks(); // This is destructive

      // --- Move controls back ---
      if (controlsWereMoved) {
        const selectedTrackIndex = AppState.getSelectedTrackIndex();
        const newTrackElement = document.querySelector(
          `.track[data-container-index="${selectedTrackIndex}"]`
        );
        if (newTrackElement) {
          newTrackElement.appendChild(measuresContainer);
        }
      }
    } else if (target.matches(".track-remove-btn")) {
      const wasSelected = AppState.getSelectedTrackIndex() === containerIndex;
      const selectedTrackIndex = AppState.getSelectedTrackIndex();
      let controlsWereMoved = false;

      if (selectedTrackIndex !== -1 && measuresContainer) {
        const trackWrapper = event.currentTarget;
        const selectedTrackElement = trackWrapper.querySelector(
          `.track[data-container-index="${selectedTrackIndex}"]`
        );
        if (
          selectedTrackElement &&
          measuresContainer.parentNode === selectedTrackElement
        ) {
          document.body.appendChild(measuresContainer);
          controlsWereMoved = true;
        }
      }

      AppState.removeTrack(containerIndex);
      sendState(AppState.getCurrentStateForPreset());

      // Re-render the tracks first to ensure the DOM is stable.
      TrackController.renderTracks();

      // Now, if the selection changed, dispatch the event.
      // The event handler will now find the correct, existing elements.
      if (wasSelected || controlsWereMoved) {
        setTimeout(() => {
          document.dispatchEvent(new CustomEvent("trackselectionchanged"));
        }, 0);
      }
    } else if (target.matches(".rest-button")) {
        const newRestModeState = !AppState.isRestMode(); // Determine the new state
        AppState.setRestMode(newRestModeState); // Update the global state

        // Update all rest buttons to reflect the new global state
        document.querySelectorAll(".rest-button").forEach(button => {
            button.classList.toggle("active", newRestModeState);
        });
    } else if (target.matches(".beat-square")) {
        if (AppState.isRestMode()) {
            const barVisual = target.closest(".bar-visual");
            if (!barVisual) return;

            const barIndex = parseInt(barVisual.dataset.barIndex, 10);
            const beatIndex = parseInt(target.dataset.beatIndex, 10);
            const track = AppState.getTracks()[containerIndex];
            const newRests = [...(track.barSettings[barIndex].rests || [])];

            if (newRests.includes(beatIndex)) {
                const indexToRemove = newRests.indexOf(beatIndex);
                newRests.splice(indexToRemove, 1);
                target.classList.remove("rested");
            } else {
                newRests.push(beatIndex);
                target.classList.add("rested");
            }
            const newBarSettings = [...track.barSettings];
            newBarSettings[barIndex].rests = newRests;
            AppState.updateTrack(containerIndex, { barSettings: newBarSettings });
            BarDisplayController.updateBar(containerIndex, barIndex);
            sendState(AppState.getCurrentStateForPreset());
        }
    } else {
      if (AppState.getSelectedTrackIndex() !== containerIndex) {
        AppState.setSelectedTrackIndex(containerIndex);
      }

      const barVisual = target.closest(".bar-visual");
      if (barVisual) {
        const barIndex = parseInt(barVisual.dataset.barIndex, 10);
        AppState.setSelectedBarIndexInContainer(barIndex);
      }

      sendState(AppState.getCurrentStateForPreset());

      setTimeout(() => {
        document.dispatchEvent(new CustomEvent("trackselectionchanged"));
      }, 0);
    }
  },

  /**
   * Handles changes to the sound selection dropdowns.
   * @param {Event} event - The change event.
   */
  handleTrackSoundChange: (event) => {
    const target = event.target;
    if (target.matches(".sound-selector")) {
      const trackElement = target.closest(".track");
      if (trackElement) {
        const containerIndex = parseInt(
          trackElement.dataset.containerIndex,
          10
        );
        const newSound = target.value;
        const defaultSettings = AppState.getDefaultSoundSettings(newSound);
        const soundType = target.classList.contains("main-beat-sound-select")
          ? "mainBeatSound"
          : "subdivisionSound";

        AppState.updateTrack(containerIndex, {
          [soundType]: {
            sound: newSound,
            settings: defaultSettings ? { ...defaultSettings } : {},
          },
        });
      }
    }
  },

  /**
   * Handles input events from the volume slider.
   * @param {Event} event - The input event.
   */
  handleTrackSliderInput: (event) => {
    const target = event.target;
    if (target.matches(".track-volume-slider")) {
      const trackElement = target.closest(".track");
      if (trackElement) {
        const containerIndex = parseInt(
          trackElement.dataset.containerIndex,
          10
        );
        const newVolume = parseFloat(target.value);
        AppState.updateTrack(containerIndex, { volume: newVolume });
        trackElement.querySelector(".track-volume-value").textContent = `${(
          newVolume * 100
        ).toFixed(0)}%`;
      }
    }
  },

  /**
   * Handles mousedown events, specifically for opening the sound settings modal.
   * @param {Event} event - The mousedown event.
   */
  handleMouseDown: (event) => {
    const target = event.target;
    if (target.matches(".sound-label")) {
      const trackElement = target.closest(".track");
      if (trackElement) {
        const containerIndex = parseInt(
          trackElement.dataset.containerIndex,
          10
        );
        const soundSelectionDiv = target.closest(".sound-selection");
        const isMainSound = soundSelectionDiv.querySelector(".main-beat-sound-select");
        const soundType = isMainSound ? "mainBeatSound" : "subdivisionSound";
        SoundSettingsModal.show(containerIndex, soundType);
      }
    }
  },

  /**
   * Handles mouseup events to clear any long-press timers.
   */
  handleMouseUp: () => {
    clearTimeout(TrackController.longPressTimer);
  },

  /**
   * Adds a new track and then re-renders the UI.
   */
  addTrack: () => {
    // --- Protective logic to prevent controls from being deleted ---
    const selectedTrackIndex = AppState.getSelectedTrackIndex();
    const measuresContainer = document.querySelector(".measures-container");

    // If a track is selected, the controls might be inside it. Move them to safety before re-rendering.
    if (selectedTrackIndex !== -1 && measuresContainer) {
      const trackWrapper = document.getElementById("all-tracks-wrapper");
      if (trackWrapper) {
        const selectedTrackElement = trackWrapper.querySelector(
          `.track[data-container-index="${selectedTrackIndex}"]`
        );
        if (
          selectedTrackElement &&
          measuresContainer.parentNode === selectedTrackElement
        ) {
          document.body.appendChild(measuresContainer);
        }
      }
    }
    AppState.addTrack(); // This also implicitly selects the new track in the state.
    TrackController.renderTracks();

    // Announce that the selection has changed. This will trigger UI updates,
    // including moving the protected controls to the newly selected track.
    setTimeout(() => {
      document.dispatchEvent(new CustomEvent("trackselectionchanged"));
    }, 0);
  },
};

/**
 * Creates and configures a <select> element for sound options.
 * @param {object} selectedSound - The currently selected sound object.
 * @param {string} typeClass - The CSS class to assign to the selector.
 * @returns {HTMLSelectElement} The configured select element.
 */
function createSoundSelector(selectedSound, typeClass) {
  const select = document.createElement("select");
  select.className = `sound-selector ${typeClass}`;

  const soundOptions = [
    "Synth Kick",
    "Synth Snare",
    "Synth Clap",
    "Synth HiHat",
    "Synth Open HiHat",
    "Synth Shaker",
    "Synth Claves",
    "Synth Hi Tom",
    "Synth Mid Tom",
    "Synth Low Tom",
    "Synth Cymbal",
    "Synth Cowbell",
    "Synth Woodblock",
    "Synth Triangle",
    "Synth Maraca",
    "Click1.mp3",
    "Click2.mp3",
    "Crank1.mp3",
    "Crank2.mp3",
  ];

  soundOptions.forEach((soundName) => {
    const option = document.createElement("option");
    option.value = soundName;
    option.textContent = soundName.replace(".mp3", "").replace("Synth ", "");
    if (soundName === selectedSound.sound) {
      option.selected = true;
    }
    select.appendChild(option);
  });

  return select;
}

export default TrackController;

