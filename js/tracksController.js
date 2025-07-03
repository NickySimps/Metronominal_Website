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
    DOM.trackWrapper.addEventListener(
        "input",
        TrackController.handleTrackSliderInput
    );
     // Add a 'change' event listener to the wrapper for the new dropdowns
    DOM.trackWrapper.addEventListener('change', TrackController.handleTrackSoundChange);
    TrackController.renderTracks();
  },

  renderTracks: () => {
    const Tracks = AppState.getTracks();
    DOM.trackWrapper.innerHTML = ""; // Clear existing containers

    Tracks.forEach((container, index) => {
      const containerElement = document.createElement("div");
      containerElement.classList.add("track");
      containerElement.dataset.containerIndex = index;

      const colorInversionClass = `track-color-${index % 6}`;
      containerElement.classList.add(colorInversionClass);

      if (container.solo) {
        containerElement.classList.add("soloed");
      }

      // **MODIFIED HTML TO INCLUDE PLACEHOLDERS FOR SOUND SELECTORS**
      containerElement.innerHTML = `
                <div class="track-controls">
                    <span class="track-name">Track ${index + 1}</span>
                    <button class="track-mute-btn">${
                      container.muted ? "Unmute" : "Mute"
                    }</button>
                    <button class="track-solo-btn">${
                      container.solo ? "Unsolo" : "Solo"
                    }</button>
                    <button class="track-remove-btn">-</button>
                    <div class="track-volume-controls">    
                    <span for="track-volume-${index}" class="track-volume-label">Vol:</span>
                    <input type="range" id="track-volume-${index}" class="track-volume-slider" min="0" max="1" step="0.01" value="${container.volume}">
                    <span for="track-volume-${index}" class="track-volume-value">${(container.volume * 100).toFixed(0)}%</span>
                    </div>
                </div>
                <div class="track-sound-controls">
                    <div class="sound-selection">
                      <span class="sound-label" >Main:</span>
                      </div>
                    <div class="sound-selection">
                      <span class="sound-label">Sub:</span>
                      </div>
                </div>
                <div class="bar-display-container" data-container-index="${index}"></div>
            `;
            
      // **NEW: Find the placeholders and append the actual dropdowns**
      const mainSoundSelectorContainer = containerElement.querySelector('.sound-selection:nth-child(1)');
      const subSoundSelectorContainer = containerElement.querySelector('.sound-selection:nth-child(2)');

      if (mainSoundSelectorContainer && subSoundSelectorContainer) {
          mainSoundSelectorContainer.appendChild(createSoundSelector(container.mainBeatSound, 'main-beat-sound-select'));
          subSoundSelectorContainer.appendChild(createSoundSelector(container.subdivisionSound, 'subdivision-sound-select'));
      }
            
      DOM.trackWrapper.appendChild(containerElement);
    });

    BarDisplayController.renderBarsAndControls();
  },
  
  // **NEW FUNCTION to handle changes from the sound dropdowns**
  handleTrackSoundChange: (event) => {
      const target = event.target;
      if (target.matches('.sound-selector')) {
          const trackElement = target.closest(".track");
          if (trackElement) {
              const containerIndex = parseInt(trackElement.dataset.containerIndex, 10);
              const newSound = target.value;
              
              if (target.classList.contains('main-beat-sound-select')) {
                  AppState.updateTrack(containerIndex, { mainBeatSound: newSound });
              } else if (target.classList.contains('subdivision-sound-select')) {
                  AppState.updateTrack(containerIndex, { subdivisionSound: newSound });
              }
          }
      }
  },

  handleTrackSliderInput: (event) => {
    const target = event.target;
    if (target.matches('.track-volume-slider')) {
        const trackElement = target.closest(".track");
        if (trackElement) {
            const containerIndex = parseInt(trackElement.dataset.containerIndex, 10);
            const newVolume = parseFloat(target.value);
            AppState.updateTrack(containerIndex, { volume: newVolume });
            trackElement.querySelector('.track-volume-value').textContent = `${(newVolume * 100).toFixed(0)}%`;
        }
    }
  },

  handleTrackClicks: (event) => {
    const target = event.target;
    const trackElement = target.closest(".track");

    if (!trackElement) return;

    const containerIndex = parseInt(trackElement.dataset.containerIndex, 10);
    const currentlySelectedTrack = AppState.getSelectedTrackIndex();

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
        TrackController.renderTracks(); 
      }
      if (target.matches(".track-remove-btn")) {
        AppState.removeTrack(containerIndex);
        TrackController.renderTracks(); 
        BarControlsController.updateBarControlsForSelectedTrack();
      }
      return; 
    }

    if (currentlySelectedTrack !== containerIndex) {
      AppState.setSelectedTrackIndex(containerIndex);
    }

    const barVisual = target.closest(".bar-visual");
    if (barVisual) {
      const barIndex = parseInt(barVisual.dataset.barIndex, 10);
      AppState.setSelectedBarIndexInContainer(barIndex);
    }
    
    TrackController.updateSelectionVisuals();
    BarControlsController.updateBarControlsForSelectedTrack();
  },

  updateSelectionVisuals: () => {
    const selectedTrackIndex = AppState.getSelectedTrackIndex();
    const selectedBarIndex = AppState.getSelectedBarIndexInContainer();

    DOM.trackWrapper.querySelectorAll(".track").forEach((trackEl, index) => {
      trackEl.classList.toggle("selected", index === selectedTrackIndex);
    });

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

function createSoundSelector(selectedSound, typeClass) {
  const select = document.createElement('select');
  select.className = `sound-selector ${typeClass}`;
  
  const soundOptions = [
    'Synth Kick', 
    'Synth Snare',
    'Synth Clap',
    'Synth Hi-Hat',
    'Synth Open Hi-Hat',
    'Synth Shaker',
    'Synth Claves',
    'Synth Hi Tom',
    'Synth Mid Tom',
    'Synth Low Tom',
    'Click1.mp3', 
    'Click2.mp3',
    'Crank1.mp3',
    'Crank2.mp3'
  ];

  soundOptions.forEach(soundName => {
    const option = document.createElement('option');
    option.value = soundName;
    option.textContent = soundName.replace('.mp3', '').replace('Synth ', '');
    if (soundName === selectedSound) {
      option.selected = true;
    }
    select.appendChild(option);
  });

  return select;
}

export default TrackController;