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
function updateBeatControlsDisplay() {
  const selectedTrackIndex = AppState.getSelectedTrackIndex();
  const selectedBarIndexInContainer = AppState.getSelectedBarIndexInContainer();
  const barSettings = AppState.getBarSettings(selectedTrackIndex); // Get bar settings for the selected container

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

  if (DOM.beatsPerCurrentMeasureDisplay) {
    DOM.beatsPerCurrentMeasureDisplay.textContent = beatsToDisplay;
  }
  if (DOM.beatMultiplierSelect) {
    DOM.beatMultiplierSelect.value = subdivisionToDisplay;
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
    // Event Listeners for changing beats of the selected bar
    DOM.increaseMeasureLengthBtn.addEventListener("click", () => {
      const selectedTrackIndex = AppState.getSelectedTrackIndex();
      const selectedBarIndexInContainer =
        AppState.getSelectedBarIndexInContainer();
      if (selectedBarIndexInContainer !== -1) {
        AppState.increaseBeatsForSelectedBar(); // Update state
        sendState(AppState.getCurrentStateForPreset());

        const updateAction = () => {
          // Instead of full rerender, just update the single bar
          BarDisplayController.updateBar(
            selectedTrackIndex,
            selectedBarIndexInContainer
          );
          updateBeatControlsDisplay(); // Update beats display
          updateTotalBeatsDisplay(); // Update total beats
          // Trigger 3D UI update
          if (ThemeController.is3DSceneActive()) {
            ThemeController.update3DScenePostStateChange();
          }
        };

        animateControlUpdate(DOM.beatsPerCurrentMeasureDisplay, updateAction);
      }
    });

    DOM.decreaseMeasureLengthBtn.addEventListener("click", () => {
      const selectedTrackIndex = AppState.getSelectedTrackIndex();
      const selectedBarIndexInContainer =
        AppState.getSelectedBarIndexInContainer();
      if (
        selectedBarIndexInContainer !== -1 &&
        AppState.getBeatsForSelectedBar() > 1
      ) {
        AppState.decreaseBeatsForSelectedBar(); // Update state
        sendState(AppState.getCurrentStateForPreset());

        const updateAction = () => {
          BarDisplayController.updateBar(
            selectedTrackIndex,
            selectedBarIndexInContainer
          );
          updateBeatControlsDisplay();
          updateTotalBeatsDisplay();
          // Trigger 3D UI update
          if (ThemeController.is3DSceneActive()) {
            ThemeController.update3DScenePostStateChange();
          }
        };

        animateControlUpdate(DOM.beatsPerCurrentMeasureDisplay, updateAction);
      }
    });

    // Event Listeners for changing total number of bars
    DOM.increaseBarLengthBtn.addEventListener("click", () => {
      const selectedTrackIndex = AppState.getSelectedTrackIndex();
      if (selectedTrackIndex === -1) return;

      // --- Protective logic added ---
      const measuresContainer = DOM.measuresContainer;
      const originalParent = measuresContainer.parentNode;
      const controlsWereMoved =
        originalParent && originalParent.classList.contains("track");

      // 1. If controls are in a track, move to safety
      if (controlsWereMoved) {
        document.body.appendChild(measuresContainer);
        measuresContainer.style.display = "none";
      }

      // Get the bar count directly from the AppState
      let currentBars = AppState.getBarSettings(selectedTrackIndex).length;
      const newBarIndex = currentBars;
      currentBars++;

      // Update the AppState first
      AppState.updateBarArray(currentBars);

      const updateAction = () => {
        // Then, update the UI to match the new state
        DOM.barsLengthDisplay.textContent = currentBars;
        // Call the new addBar function
        BarDisplayController.addBar(selectedTrackIndex, newBarIndex);
        updateTotalBeatsDisplay();
        updateBeatControlsDisplay();
        sendState(AppState.getCurrentStateForPreset());

        if (ThemeController.is3DSceneActive()) {
          ThemeController.update3DScenePostStateChange();
        }
      };

      animateControlUpdate(DOM.barsLengthDisplay, updateAction);

      // 2. After animation, move controls back if they were moved
      setTimeout(() => {
        if (controlsWereMoved) {
          // After re-render, the original parent is gone. Find the new one.
          const newTrackElement = DOM.trackWrapper.querySelector(
            `.track[data-container-index="${selectedTrackIndex}"]`
          );
          if (newTrackElement) {
            newTrackElement.appendChild(measuresContainer);
            measuresContainer.style.display = "flex";
          } else {
            // Fallback if track was somehow removed, move to default position
            DOM.metronomeContainer.insertBefore(
              measuresContainer,
              DOM.startStopBtn
            );
            measuresContainer.style.display = "flex";
          }
        }
      }, 250); // Should match animation duration
    });

    DOM.decreaseBarLengthBtn.addEventListener("click", () => {
      const selectedTrackIndex = AppState.getSelectedTrackIndex();
      if (selectedTrackIndex === -1) return;

      // --- Protective logic added ---
      const measuresContainer = DOM.measuresContainer;
      const originalParent = measuresContainer.parentNode;
      const controlsWereMoved =
        originalParent && originalParent.classList.contains("track");

      // 1. If controls are in a track, move to safety
      if (controlsWereMoved) {
        document.body.appendChild(measuresContainer);
        measuresContainer.style.display = "none";
      }

      let currentBars = AppState.getBarSettings(selectedTrackIndex).length;
      if (currentBars > 0) {
        const barIndexToRemove = currentBars - 1;

        if (AppState.getSelectedBarIndexInContainer() === barIndexToRemove) {
          AppState.setSelectedBarIndexInContainer(barIndexToRemove - 1);
        }

        AppState.updateBarArray(currentBars - 1);

        const updateAction = () => {
          DOM.barsLengthDisplay.textContent = currentBars - 1;
          BarDisplayController.removeBar(selectedTrackIndex, barIndexToRemove);
          updateTotalBeatsDisplay();
          updateBeatControlsDisplay();
          sendState(AppState.getCurrentStateForPreset());

          if (ThemeController.is3DSceneActive()) {
            ThemeController.update3DScenePostStateChange();
          }
        };

        animateControlUpdate(DOM.barsLengthDisplay, updateAction);

        // 2. After animation, move controls back if they were moved
        setTimeout(() => {
          if (controlsWereMoved) {
            // After re-render, the original parent is gone. Find the new one.
            const newTrackElement = DOM.trackWrapper.querySelector(
              `.track[data-container-index="${selectedTrackIndex}"]`
            );
            if (newTrackElement) {
              // If the track still exists, append controls to it.
              newTrackElement.appendChild(measuresContainer);
              measuresContainer.style.display = "flex";
            } else {
              // If the track was removed (e.g., last bar deleted),
              // move the controls back to their default position.
              DOM.metronomeContainer.insertBefore(
                measuresContainer,
                DOM.startStopBtn
              );
              measuresContainer.style.display = "flex";
            }
          }
        }, 250); // Should match animation duration
      } else {
        // If no bars to remove, put controls back if they were moved
        if (controlsWereMoved) {
          originalParent.appendChild(measuresContainer);
        }
      }
    });

    // Event listener for beat multiplier change
    document.addEventListener("barSelected", () => {
      updateBeatControlsDisplay();
    });

    DOM.beatMultiplierSelect.addEventListener("change", async () => {
      // Make event handler async
      const selectedTrackIndex = AppState.getSelectedTrackIndex();
      const selectedBarIndexInContainer =
        AppState.getSelectedBarIndexInContainer();

      AppState.setSubdivisionForSelectedBar(DOM.beatMultiplierSelect.value); // Update state
      sendState(AppState.getCurrentStateForPreset());

      // Re-render visuals based on new multiplier
      BarDisplayController.updateBar(
        selectedTrackIndex,
        selectedBarIndexInContainer
      );
      // Trigger 3D UI update
      if (ThemeController.is3DSceneActive()) {
        ThemeController.update3DScenePostStateChange();
      }
    });

    // Initial display updates
    updateBeatControlsDisplay();
    updateTotalBeatsDisplay();
    // Note: Initial rendering of bars is handled by the main script's initialize function
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
      // Handle case where no track is selected (e.g., all tracks deleted)
      DOM.barsLengthDisplay.textContent = "0";
      DOM.beatsPerCurrentMeasureDisplay.textContent = "-";
      DOM.beatMultiplierSelect.value = "1";
      return;
    }

    const selectedTrack = AppState.getTracks()[selectedTrackIndex];

    // Update the "Bars" count display
    DOM.barsLengthDisplay.textContent = selectedTrack.barSettings.length;

    // Update the "Beats per Measure" and "Subdivision" displays
    updateBeatControlsDisplay();
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
