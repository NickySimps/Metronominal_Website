import DOM from "./domSelectors.js";
import AppState from "./appState.js";
import BarDisplayController from "./barDisplayController.js";
import BarControlsController from "./barControlsController.js";


const TrackController = {
  init: () => {
    DOM.addTrackButton.addEventListener("click", TrackController.addTrack);
    DOM.trackWrapper.addEventListener(
      "click",
      TrackController.handleTrackClicks
    );
    TrackController.renderTracks();
  },

  renderTracks: () => {
    const Tracks = AppState.getTracks();
    DOM.trackWrapper.innerHTML = ""; // Clear existing containers

    Tracks.forEach((container, index) => {
      const containerElement = document.createElement("div");
      containerElement.classList.add("track");
      containerElement.dataset.containerIndex = index;

      // Determine color inversion based on index
      const colorInversionClass = `track-color-${index % 5}`; // Cycle through 4 inversions
      containerElement.classList.add(colorInversionClass);

      if (container.solo) {
        containerElement.classList.add("soloed");
      }

      containerElement.innerHTML = `
                <div class="track-controls">
                    <button class="track-mute-btn">${
                      container.muted ? "Unmute" : "Mute"
                    }</button>
                    <button class="track-solo-btn">${
                      container.solo ? "Unsolo" : "Solo"
                    }</button>
                    <button class="track-remove-btn">-</button>
                </div>
                <div class="bar-display-container" data-container-index="${index}"></div>
            `;
      DOM.trackWrapper.appendChild(containerElement);
    });

    // Render the actual beat displays inside the containers
    BarDisplayController.renderBarsAndControls();

    // No longer need to attach listeners here, it's handled by event delegation in init()
  },

  handleTrackClicks: (event) => {
    const target = event.target;
    const trackElement = target.closest(".track");

    // If the click is outside any track, do nothing
    if (!trackElement) return;

    const containerIndex = parseInt(trackElement.dataset.containerIndex, 10);
    const currentlySelectedTrack = AppState.getSelectedTrackIndex();

    // Handle button clicks (Mute, Solo, Remove)
    if (target.matches(".track-mute-btn, .track-solo-btn, .track-remove-btn")) {
      if (target.matches(".track-mute-btn")) {
        const track = AppState.getTracks()[containerIndex];
        AppState.updateTrack(containerIndex, { muted: !track.muted });
        target.textContent = AppState.getTracks()[containerIndex].muted
          ? "Unmute"
          : "Mute";
      }
      if (target.matches(".track-solo-btn")) {
        AppState.toggleSolo(containerIndex);
        TrackController.renderTracks(); // Re-render all tracks to update their visual state
      }
      if (target.matches(".track-remove-btn")) {
        AppState.removeTrack(containerIndex);
        TrackController.renderTracks(); // Re-render is needed after removal
        // After removing, force an update of the controls to reflect the new state
        BarControlsController.updateBarControlsForSelectedTrack();
      }
      return; // Stop further processing for button clicks
    }

    // If a new track is selected, update the state
    if (currentlySelectedTrack !== containerIndex) {
      AppState.setSelectedTrackIndex(containerIndex);
    }

    // Handle bar selection within the now-active track
    const barVisual = target.closest(".bar-visual");
    if (barVisual) {
      const barIndex = parseInt(barVisual.dataset.barIndex, 10);
      AppState.setSelectedBarIndexInContainer(barIndex);
    }

    // After any selection change, update all relevant UI
    // 1. Update the visual selection for tracks and bars
    TrackController.updateSelectionVisuals();
    // 2. Update the main controls (Bars and Beats displays)
    BarControlsController.updateBarControlsForSelectedTrack();
  },

  /**
   * NEW FUNCTION: Adds 'selected' classes to the correct track and bar
   */
  updateSelectionVisuals: () => {
    const selectedTrackIndex = AppState.getSelectedTrackIndex();
    const selectedBarIndex = AppState.getSelectedBarIndexInContainer();

    // Update track selection class
    DOM.trackWrapper.querySelectorAll(".track").forEach((trackEl, index) => {
      trackEl.classList.toggle("selected", index === selectedTrackIndex);
    });

    // Update bar selection class
    DOM.trackWrapper.querySelectorAll(".bar-visual").forEach((barEl) => {
      const isSelected =
        parseInt(barEl.dataset.containerIndex, 10) === selectedTrackIndex &&
        parseInt(barEl.dataset.barIndex, 10) === selectedBarIndex;
      barEl.classList.toggle("selected", isSelected);
    });
  },

  addTrack: () => {
    AppState.addTrack();
    TrackController.renderTracks();
  },
};

export default TrackController;
