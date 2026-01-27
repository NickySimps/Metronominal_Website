import AppState from "./appState.js";
import BarControlsController from "./barControlsController.js";
import { sendState } from "./webrtc.js";
import BarDisplayController from "./barDisplayController.js";
import SoundSettingsModal from "./soundSettingsModal.js";
import AudioController from "./audioController.js";


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
    document.addEventListener("soundSaved", () => {
        TrackController.renderTracks();
    });
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
            track.muted ? "▶" : "⍉"
          }</button>
          <button class="track-solo-btn">${
            track.solo ? "Unsolo" : "Solo"
          }</button>
          <button class="track-remove-btn">✖</button>
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
            <span class="sound-label main-sound-label">Main:✎</span>
          </div>
          <button class="rest-button ${AppState.isRestMode() ? 'active' : ''}">𝄽</button>
          <div class="sound-selection">
            <span class="sound-label sub-sound-label">Sub:✎</span>
          </div>
          <button class="record-btn ${AppState.isRecording() ? 'active' : ''}">●</button>
        </div>
        <div class="bar-display-container" data-container-index="${index}"></div>
        <div class="measures-container hidden">
            <div class="measure-settings-container">
                <div class="beat-settings">
                    <button class="adjust-measure-length decrease-measure-length"
                        aria-label="Decrease beats per measure">
                        -
                    </button>
                    <span class="beats-per-current-measure">4</span>
                    <button class="adjust-measure-length increase-measure-length"
                        aria-label="Increase beats per measure">
                        +
                    </button>
                </div>
                <span class="measures-text">BEATS</span>
            </div>
            <div class="bar-settings-container">
                <div class="bar-settings">
                    <button class="adjust-bar-length decrease-bar-length" aria-label="Decrease bars">
                        -
                    </button>
                    <span class="bars-length">3</span>
                    <button class="adjust-bar-length increase-bar-length" aria-label="Increase bars">
                        +
                    </button>
                </div>
                <span class="bars-text">BARS</span>
            </div>
        </div>
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

      // Check for modified sounds and apply outline if necessary
      const mainSoundModified = AppState.isSoundModified(index, 'mainBeatSound');
      const subSoundModified = AppState.isSoundModified(index, 'subdivisionSound');

      const mainSoundLabel = trackElement.querySelector('.main-sound-label');
      const subSoundLabel = trackElement.querySelector('.sub-sound-label');

      if (mainSoundLabel) {
        mainSoundLabel.classList.toggle('modified-sound', mainSoundModified);
      }
      if (subSoundLabel) {
        subSoundLabel.classList.toggle('modified-sound', subSoundModified);
      }
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

    if (target.matches(".track-mute-btn")) {
      const track = AppState.getTracks()[containerIndex];
      AppState.updateTrack(containerIndex, { muted: !track.muted });
      sendState(AppState.getCurrentStateForPreset());
      TrackController.renderTracks();
    } else if (target.matches(".track-solo-btn")) {
      AppState.toggleSolo(containerIndex);
      sendState(AppState.getCurrentStateForPreset());
      TrackController.renderTracks();
    } else if (target.matches(".track-remove-btn")) {
      AppState.removeTrack(containerIndex);
      sendState(AppState.getCurrentStateForPreset());
      TrackController.renderTracks();
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent("trackselectionchanged"));
      }, 0);
    } else if (target.matches(".rest-button")) {
        const newRestModeState = !AppState.isRestMode();
        AppState.setRestMode(newRestModeState);
        document.querySelectorAll(".rest-button").forEach(button => {
            button.classList.toggle("active", newRestModeState);
        });
        document.querySelectorAll(".sub-sound-label").forEach(label => {
            label.classList.toggle("rest-mode-active", newRestModeState);
        });
        document.querySelectorAll(".bar-visual").forEach(bar => {
            bar.classList.toggle("rest-mode-active", newRestModeState);
        });
    } else if (target.matches(".record-btn")) {
        AudioController.toggleRecording(containerIndex);
    } else {
        if (AppState.getSelectedTrackIndex() !== containerIndex) {
            AppState.setSelectedTrackIndex(containerIndex);
        }

        const barVisual = target.closest(".bar-visual");
        if (barVisual) {
            const barIndex = parseInt(barVisual.dataset.barIndex, 10);
            AppState.setSelectedBarIndexInContainer(barIndex);
        }

        if (target.matches(".beat-square") && AppState.isRestMode()) {
            const barIndex = parseInt(target.closest(".bar-visual").dataset.barIndex, 10);
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
        } else {
            const previouslySelectedTrack = document.querySelector('.track.selected');
            if (previouslySelectedTrack && previouslySelectedTrack !== trackElement) {
                previouslySelectedTrack.classList.remove('selected');
                const prevMeasuresContainer = previouslySelectedTrack.querySelector('.measures-container');
                if (prevMeasuresContainer) {
                    prevMeasuresContainer.classList.add('hiding');
                    prevMeasuresContainer.addEventListener('animationend', () => {
                        prevMeasuresContainer.classList.remove('hiding');
                        prevMeasuresContainer.classList.add('hidden');
                    }, { once: true });
                }
            }

            if (!trackElement.classList.contains('selected')) {
                trackElement.classList.add('selected');
                const measuresContainer = trackElement.querySelector('.measures-container');
                if (measuresContainer) {
                    measuresContainer.classList.remove('hidden');
                    measuresContainer.classList.add('showing');
                    measuresContainer.addEventListener('animationend', () => {
                        measuresContainer.classList.remove('showing');
                    }, { once: true });
                }
            }

            sendState(AppState.getCurrentStateForPreset());

            setTimeout(() => {
                document.dispatchEvent(new CustomEvent("trackselectionchanged"));
            }, 0);
        }
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
    AppState.addTrack();
    TrackController.renderTracks();
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
    "Synth Sine",
    "Synth Square",
    "Synth Sawtooth",
    "Synth Ultrasaw",
    "Synth Noise",
    ...AppState.getCustomSounds(),
    "Click1.mp3",
    "Click2.mp3",
    "Crank1.mp3",
    "Crank2.mp3",
    ...AppState.getRecordings(),
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

