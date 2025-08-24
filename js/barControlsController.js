/**
 * barControlsController.js
 * This module manages the controls for modifying the number of bars and beats per bar.
 * It updates the AppState and triggers updates in the BarDisplayController.
 * It interacts with MetronomeEngine for playback control that affects UI.
 * It interacts with domSelectors to access control elements.
 */
import ThemeController from "./themeController.js"; // Added for 3D UI updates
import AppState from "./appState.js"; // Assuming AppState is a module
import DOM from "./domSelectors.js"; // Assuming domSelectors is a module
import BarDisplayController from "./barDisplayController.js"; // Assuming BarDisplayController is a module
import MetronomeEngine from "./metronomeEngine.js"; // For toggling play with UI updates
import TrackController from "./tracksController.js";
import { sendState } from "./webrtc.js";

// Helper for animated text updates (similar to tempo description)
function animateControlUpdate(
  controlElement,
  updateFunction,
  animationDuration = 500
) {
  if (controlElement) {
    controlElement.classList.add("updating");
    setTimeout(() => {
      updateFunction(); // Execute the actual update
      controlElement.classList.remove("updating");
    }, animationDuration / 2); // Update text at midpoint of animation
  }
}

// Function to update the "beats-per-current-measure" display
function updateBeatControlsDisplay(trackElement) {
  if (!trackElement) return;

  const selectedBarIndexInContainer = AppState.getSelectedBarIndexInContainer();
  const containerIndex = parseInt(trackElement.dataset.containerIndex, 10);
  const barSettings = AppState.getBarSettings(containerIndex);

  let beatsToDisplay = "-";
  let subdivisionToDisplay = "1";

  if (barSettings.length > 0) {
    const targetBarIndex =
      selectedBarIndexInContainer !== -1 &&
      barSettings[selectedBarIndexInContainer] !== undefined
        ? selectedBarIndexInContainer
        : 0;
    beatsToDisplay = barSettings[targetBarIndex].beats;
    subdivisionToDisplay = barSettings[targetBarIndex].subdivision.toString();
  }

  const beatsDisplay = trackElement.querySelector('.beats-per-current-measure');
  if (beatsDisplay) {
    beatsDisplay.textContent = beatsToDisplay;
  }

  const subdivisionSelect = trackElement.querySelector('#beat-multiplier-select');
  if (subdivisionSelect) {
    subdivisionSelect.value = subdivisionToDisplay;
  }
}

// Function to update the total beats display
function updateTotalBeatsDisplay() {
  const totalBeats = AppState.getTotalBeats();
  if (DOM.totalBeatsDisplayElement) {
    DOM.totalBeatsDisplayElement.textContent = totalBeats;
  }
}

// Function to synchronize AppState barSettings with the number displayed in barsLengthDisplay
// and trigger necessary UI updates.
async function syncBarSettings() {
  const selectedTrackIndex = AppState.getSelectedTrackIndex();
  const barSettings = AppState.getBarSettings(selectedTrackIndex);
  const barCount = barSettings ? barSettings.length : 0;

  if (DOM.barsLengthDisplay) {
    DOM.barsLengthDisplay.textContent = barCount;
  }

  // This function is now just for rendering the UI after the state has changed.
  TrackController.renderTracks(); // Re-render tracks to handle potential removal
  updateTotalBeatsDisplay();
  updateBeatControlsDisplay();

  if (ThemeController.is3DSceneActive()) {
    ThemeController.update3DScenePostStateChange();
  }
}

const BarControlsController = {
  /**
   * Initializes the bar and beat control elements and their event listeners.
   */
  initializeBarControls: () => {
    const trackWrapper = document.getElementById('all-tracks-wrapper');

    trackWrapper.addEventListener('click', (event) => {
      const target = event.target;
      const trackElement = target.closest('.track');
      if (!trackElement) return;

      const containerIndex = parseInt(trackElement.dataset.containerIndex, 10);
      const measuresContainer = trackElement.querySelector('.measures-container');

      if (target.matches('.increase-measure-length')) {
        const selectedBarIndexInContainer = AppState.getSelectedBarIndexInContainer();
        if (selectedBarIndexInContainer !== -1) {
          AppState.increaseBeatsForSelectedBar();
          sendState(AppState.getCurrentStateForPreset());
          BarDisplayController.updateBar(containerIndex, selectedBarIndexInContainer);
          updateBeatControlsDisplay();
          updateTotalBeatsDisplay();
          if (ThemeController.is3DSceneActive()) {
            ThemeController.update3DScenePostStateChange();
          }
        }
      } else if (target.matches('.decrease-measure-length')) {
        const selectedBarIndexInContainer = AppState.getSelectedBarIndexInContainer();
        if (selectedBarIndexInContainer !== -1 && AppState.getBeatsForSelectedBar() > 1) {
          AppState.decreaseBeatsForSelectedBar();
          sendState(AppState.getCurrentStateForPreset());
          BarDisplayController.updateBar(containerIndex, selectedBarIndexInContainer);
          updateBeatControlsDisplay();
          updateTotalBeatsDisplay();
          if (ThemeController.is3DSceneActive()) {
            ThemeController.update3DScenePostStateChange();
          }
        }
      } else if (target.matches('.increase-bar-length')) {
        let currentBars = AppState.getBarSettings(containerIndex).length;
        const newBarIndex = currentBars;
        currentBars++;
        AppState.updateBarArray(currentBars);
        const updateAction = () => {
          measuresContainer.querySelector('.bars-length').textContent = currentBars;
          BarDisplayController.addBar(containerIndex, newBarIndex);
          updateTotalBeatsDisplay();
          updateBeatControlsDisplay();
          sendState(AppState.getCurrentStateForPreset());
          if (ThemeController.is3DSceneActive()) {
            ThemeController.update3DScenePostStateChange();
          }
        };
        animateControlUpdate(measuresContainer.querySelector('.bars-length'), updateAction);
      } else if (target.matches('.decrease-bar-length')) {
        let currentBars = AppState.getBarSettings(containerIndex).length;
        if (currentBars > 0) {
          const barIndexToRemove = currentBars - 1;
          if (AppState.getSelectedBarIndexInContainer() === barIndexToRemove) {
            AppState.setSelectedBarIndexInContainer(barIndexToRemove - 1);
          }
          AppState.updateBarArray(currentBars - 1);
          const updateAction = () => {
            measuresContainer.querySelector('.bars-length').textContent = currentBars - 1;
            BarDisplayController.removeBar(containerIndex, barIndexToRemove);
            updateTotalBeatsDisplay();
            updateBeatControlsDisplay();
            sendState(AppState.getCurrentStateForPreset());
            if (ThemeController.is3DSceneActive()) {
              ThemeController.update3DScenePostStateChange();
            }
          };
          animateControlUpdate(measuresContainer.querySelector('.bars-length'), updateAction);
        }
      }
    });

    document.addEventListener("barSelected", () => {
      updateBeatControlsDisplay();
    });

    DOM.beatMultiplierSelect.addEventListener("change", async () => {
      const selectedTrackIndex = AppState.getSelectedTrackIndex();
      const selectedBarIndexInContainer = AppState.getSelectedBarIndexInContainer();

      AppState.setSubdivisionForSelectedBar(DOM.beatMultiplierSelect.value);
      sendState(AppState.getCurrentStateForPreset());

      BarDisplayController.updateBar(selectedTrackIndex, selectedBarIndexInContainer);
      if (ThemeController.is3DSceneActive()) {
        ThemeController.update3DScenePostStateChange();
      }
    });

    updateBeatControlsDisplay();
    updateTotalBeatsDisplay();
  },

  /**
   * Updates the beat count display for the currently selected bar.
   */
  updateBeatControlsDisplay: updateBeatControlsDisplay,

  /**
   * Updates the total beats display.
   */
  updateTotalBeatsDisplay: updateTotalBeatsDisplay,

  /**
   * Synchronizes the bar settings state with the UI display and triggers rendering.
   */
  syncBarSettings: syncBarSettings,

  updateBarControlsForSelectedTrack: () => {
    const selectedTrackIndex = AppState.getSelectedTrackIndex();
    if (selectedTrackIndex === -1) {
      return;
    }

    const trackElement = document.querySelector(`.track[data-container-index="${selectedTrackIndex}"]`);
    if (!trackElement) return;

    const selectedTrack = AppState.getTracks()[selectedTrackIndex];

    const barsLengthDisplay = trackElement.querySelector('.bars-length');
    if (barsLengthDisplay) {
        barsLengthDisplay.textContent = selectedTrack.barSettings.length;
    }

    updateBeatControlsDisplay(trackElement);
    updateTotalBeatsDisplay();
  },

  increaseBarLength: () => {
    // Add this function
    DOM.increaseBarLengthBtn.click();
  },

  decreaseBarLength: () => {
    // Add this function
    DOM.decreaseBarLengthBtn.click();
  },
};

export default BarControlsController;
