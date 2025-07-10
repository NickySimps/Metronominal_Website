/**
 * barDisplayController.js
 * This module is responsible for rendering and updating the visual representation
 * of the metronome bars and beats in the DOM.
 * It interacts with AppState to get the current bar structure and playback position.
 * It interacts with domSelectors to access the container element.
 */

import AppState from "./appState.js"; // Assuming AppState is a module
import DOM from "./domSelectors.js"; // Assuming domSelectors is a module
import BarControlsController from "./barControlsController.js";
import MetronomeEngine from "./metronomeEngine.js";
import { sendState } from "./webrtc.js";
import ThemeController from "./themeController.js";

// State variables related to display highlighting
let previousHighlightedBeatElements = []; // To keep track of the previously highlighted beat
let currentActiveBarElements = []; // To keep track of the bar visual that is currently active

// State variables for long-press interaction
let longPressTimer = null;
let isLongPressActive = false;
let longPressedBarElement = null;
let longPressInitialPosition = { x: 0, y: 0 };
let hoveredSubdivisionOption = null;
const LONG_PRESS_DURATION = 150; // ms
const POINTER_MOVE_THRESHOLD = 15; // pixels (Increased for more forgiving long-press)

// Helper function to calculate total sub-beats needed based on subdivision
function calculateTotalSubBeats(mainBeatsInBar, subdivision) {
  const subdivisionFloat = parseFloat(subdivision);
  if (subdivisionFloat < 1) {
    // For fractional subdivisions (whole notes, half notes), we show fewer beats
    return Math.max(1, mainBeatsInBar * subdivisionFloat);
  } else {
    // For subdivisions >= 1, we show more beats
    return mainBeatsInBar * subdivisionFloat;
  }
}

// Helper function to determine if a beat should be marked as main beat
function isMainBeat(indexInBar, subdivision, mainBeatsInBar) {
  const subdivisionFloat = parseFloat(subdivision);

  if (subdivisionFloat < 1) {
    // For whole/half notes, every beat shown is a main beat
    return true;
  } else {
    // For subdivisions >= 1, check if it aligns with main beats
    return indexInBar % subdivisionFloat === 0;
  }
}

// Helper function to create a beat square element with animation and classes
function createBeatSquareElement(
  indexInBar,
  currentBeatMultiplier,
  mainBeatsInBar
) {
  const beatSquare = document.createElement("div");
  beatSquare.classList.add("beat-square", "newly-added-beat-animation");
  updateBeatSquareClasses(
    beatSquare,
    indexInBar,
    currentBeatMultiplier,
    mainBeatsInBar
  );

  // Optional: remove animation class after it plays to clean up DOM, if not using 'forwards' or for other reasons
  beatSquare.addEventListener(
    "animationend",
    function handleBeatAppearAnim() {
      this.removeEventListener("animationend", handleBeatAppearAnim);
      this.classList.remove("newly-added-beat-animation");
    },
    { once: true }
  );
  return beatSquare;
}

// Helper function to update classes on an existing beat square
function updateBeatSquareClasses(
  beatSquare,
  indexInBar,
  currentBeatMultiplier,
  mainBeatsInBar
) {
  beatSquare.classList.remove("main-beat-marker", "subdivision", "group-end-2", "group-end-3", "group-end-4", "group-end-5", "group-end-6", "group-end-7", "group-end-8"); // Clear old type classes

  if (isMainBeat(indexInBar, currentBeatMultiplier, mainBeatsInBar)) {
    beatSquare.classList.add("main-beat-marker");
  } else {
    beatSquare.classList.add("subdivision");

    const subdivisionFloat = parseFloat(currentBeatMultiplier);
    if (subdivisionFloat > 1) { // Only apply grouping if there are actual subdivisions
      const positionWithinMainBeat = indexInBar % subdivisionFloat;

      // If this is the last sub-beat within a main beat grouping, add the class.
      if (positionWithinMainBeat === subdivisionFloat - 1) {
        beatSquare.classList.add(`group-end-${subdivisionFloat}`);
      }
    }
  }
}

function onBarPointerDown(event) {
  // Don't initiate on right-click
  if (event.button !== 0) return;

  event.preventDefault();
  longPressedBarElement = event.currentTarget;
  longPressInitialPosition = { x: event.clientX, y: event.clientY };

  longPressTimer = setTimeout(() => {
    isLongPressActive = true;
    longPressTimer = null; // Timer has fired
    if (longPressedBarElement) {
      // Ensure longPressedBarElement is still valid
      showSubdivisionSelector(longPressedBarElement);
    } else {
      // If for some reason it's null, clean up
      resetLongPressState();
      cleanupPointerListeners();
    }
  }, LONG_PRESS_DURATION);

  window.addEventListener("pointermove", onWindowPointerMove);
  window.addEventListener("pointerup", onWindowPointerUp);
}

function onWindowPointerMove(event) {
    if (longPressTimer) {
        const moveDistance = Math.sqrt(
            Math.pow(event.clientX - longPressInitialPosition.x, 2) +
            Math.pow(event.clientY - longPressInitialPosition.y, 2)
        );
        if (moveDistance > POINTER_MOVE_THRESHOLD) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
            isLongPressActive = false;
            longPressedBarElement = null;
        }
    }

    if (isLongPressActive) {
        let newHoveredOption = null;
        const containers = document.querySelectorAll('.subdivision-options-container');
        containers.forEach(container => {
            const options = container.querySelectorAll('.subdivision-option');
            options.forEach(option => {
                const rect = option.getBoundingClientRect();
                if (
                    event.clientX >= rect.left &&
                    event.clientX <= rect.right &&
                    event.clientY >= rect.top &&
                    event.clientY <= rect.bottom
                ) {
                    newHoveredOption = option;
                }
            });
        });

        if (newHoveredOption !== hoveredSubdivisionOption) {
            if (hoveredSubdivisionOption) {
                hoveredSubdivisionOption.classList.remove("hovered");
            }
            if (newHoveredOption) {
                newHoveredOption.classList.add("hovered");
            }
            hoveredSubdivisionOption = newHoveredOption;
        }
    }
}


async function onWindowPointerUp(event) {
  if (isLongPressActive) {
    if (hoveredSubdivisionOption) {
      const newSubdivision = hoveredSubdivisionOption.dataset.value;
      const barIndex = parseInt(longPressedBarElement.dataset.barIndex, 10);
      const containerIndex = parseInt(longPressedBarElement.dataset.containerIndex, 10);

      if (newSubdivision && !isNaN(barIndex) && !isNaN(containerIndex)) {
        const wasPlaying = AppState.isPlaying();
        if (wasPlaying) {
          await MetronomeEngine.togglePlay();
        }

        AppState.setSelectedTrackIndex(containerIndex);
        AppState.setSelectedBarIndexInContainer(barIndex);
        AppState.setSubdivisionForSelectedBar(newSubdivision);
        sendState(AppState.getCurrentStateForPreset());
        
        BarDisplayController.renderBarsAndControls(-1);
        BarControlsController.updateBeatControlsDisplay();

        if (wasPlaying && AppState.getBarSettings(containerIndex).length > 0) {
          await MetronomeEngine.togglePlay();
        }

        if (ThemeController.is3DSceneActive()) {
          ThemeController.update3DScenePostStateChange();
        }
      }
    }
  } else if (longPressTimer) {
    // This was a short click
    event.preventDefault();
    clearTimeout(longPressTimer);
    const clickedBarIndex = parseInt(longPressedBarElement.dataset.barIndex, 10);
    const clickedContainerIndex = parseInt(longPressedBarElement.dataset.containerIndex, 10);

    if (AppState.getSelectedTrackIndex() !== clickedContainerIndex || AppState.getSelectedBarIndexInContainer() !== clickedBarIndex) {
        AppState.setSelectedTrackIndex(clickedContainerIndex);
        AppState.setSelectedBarIndexInContainer(clickedBarIndex);
        sendState(AppState.getCurrentStateForPreset());
        BarDisplayController.renderBarsAndControls();
        BarControlsController.updateBeatControlsDisplay();
    }
  }

  cleanupPointerListeners();
  hideSubdivisionSelector();
  resetLongPressState();
}

function cleanupPointerListeners() {
  window.removeEventListener("pointermove", onWindowPointerMove);
  window.removeEventListener("pointerup", onWindowPointerUp);
}

function resetLongPressState() {
  isLongPressActive = false;
  longPressTimer = null;
  longPressedBarElement = null;
  hoveredSubdivisionOption = null;
}

function showSubdivisionSelector(barElement) {
    hideSubdivisionSelector(); // Clear previous options first

    const barIndex = parseInt(barElement.dataset.barIndex, 10);
    const containerIndex = parseInt(barElement.dataset.containerIndex, 10);
    if (isNaN(barIndex) || isNaN(containerIndex)) {
        console.error("Could not get bar index or container index.");
        return;
    }

    const optionsFromDOM = DOM.beatMultiplierSelect ? Array.from(DOM.beatMultiplierSelect.options) : [];
    if (optionsFromDOM.length === 0) {
        console.error("The beatMultiplierSelect dropdown has no options.");
        return;
    }

    // --- KEY CHANGE: Switched from .filter() to .slice() for reliability ---

    // 1. Map the options and sort them numerically to ensure correct order
    const subdivisionOptions = optionsFromDOM.map(opt => ({
        value: parseFloat(opt.value),
        text: opt.text
    })).sort((a, b) => a.value - b.value);

    // 2. Find the index of the current bar's subdivision
    const currentSubdivision = AppState.getSubdivisionForBar(containerIndex, barIndex);
    const currentIndex = subdivisionOptions.findIndex(opt => opt.value === currentSubdivision);

    let lowerSubdivisions = [];
    let higherSubdivisions = [];

    // 3. Slice the array based on the current index
    if (currentIndex !== -1) {
        // Get all items *before* the current index
        lowerSubdivisions = subdivisionOptions.slice(0, currentIndex); // .reverse() to show closest option next to the bar
        // Get all items *after* the current index
        higherSubdivisions = subdivisionOptions.slice(currentIndex + 1);
    } else {
        // Fallback logic in case the current value isn't found
        console.warn(`Current subdivision value ${currentSubdivision} not in options list. Falling back to filter.`);
        lowerSubdivisions = subdivisionOptions.filter(opt => opt.value < currentSubdivision);
        higherSubdivisions = subdivisionOptions.filter(opt => opt.value > currentSubdivision);
    }

    const barRect = barElement.getBoundingClientRect();

    const createContainer = (subdivisions, position) => {
        if (subdivisions.length === 0) {
            return null;
        }
        const container = document.createElement('div');
        container.className = 'subdivision-options-container';
        if (position === 'below') {
            container.classList.add('below');
        }
        
        subdivisions.forEach(optionData => {
            const element = document.createElement('div');
            element.className = 'subdivision-option';
            element.dataset.value = optionData.value;
            element.textContent = optionData.text;
            container.appendChild(element);
        });

        document.body.appendChild(container);
        container.style.left = `${barRect.left + barRect.width / 2}px`;
        if (position === 'above') {
            container.style.top = `${barRect.top - 10}px`;
            container.style.transform = 'translate(-50%, -100%)';
        } else { // 'below'
            container.style.top = `${barRect.bottom + 10}px`;
            container.style.transform = 'translateX(-50%)';
        }

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                container.classList.add("visible");
            });
        });
        
        return container;
    };

    createContainer(lowerSubdivisions, 'above');
    createContainer(higherSubdivisions, 'below');
}

function hideSubdivisionSelector() {
    const containers = document.querySelectorAll('.subdivision-options-container.visible');
    containers.forEach(container => {
        container.classList.remove('visible');
        container.addEventListener('transitionend', () => {
            if (container.parentElement) {
                container.remove();
            }
        }, { once: true });
    });
}

const BarDisplayController = {
    addBar: (trackIndex, barIndex) => {
        const track = AppState.getTracks()[trackIndex];
        if (!track) return;
        const barData = track.barSettings[barIndex];
        if (!barData) return;

        const targetBarDisplayContainer = DOM.trackWrapper.querySelector(
            `.bar-display-container[data-container-index="${trackIndex}"]`
        );
        if (!targetBarDisplayContainer) return;

        const barDiv = document.createElement("div");
        barDiv.classList.add("bar-visual", "newly-added-bar-animation");
        barDiv.dataset.containerIndex = trackIndex;
        barDiv.dataset.barIndex = barIndex;

        barDiv.addEventListener("pointerdown", onBarPointerDown);

        const mainBeatsInBar = barData.beats;
        const subdivision = barData.subdivision;
        const totalSubBeatsNeeded = calculateTotalSubBeats(mainBeatsInBar, subdivision);

        for (let i = 0; i < totalSubBeatsNeeded; i++) {
            const beatSquare = createBeatSquareElement(i, subdivision, mainBeatsInBar);
            barDiv.appendChild(beatSquare);
        }

        const allBeatSquares = barDiv.querySelectorAll(".beat-square");
        const flexBasis = 100 / totalSubBeatsNeeded * 0.9;
        allBeatSquares.forEach(sq => {
          sq.style.flexBasis = `${flexBasis}%`;
        });

        targetBarDisplayContainer.appendChild(barDiv);
        BarDisplayController.updateSelectionVisuals();
    },

    removeBar: (trackIndex, barIndex) => {
        const targetBarDisplayContainer = DOM.trackWrapper.querySelector(
            `.bar-display-container[data-container-index="${trackIndex}"]`
        );
        if (!targetBarDisplayContainer) return;

        const barToRemove = targetBarDisplayContainer.querySelector(`.bar-visual[data-bar-index="${barIndex}"]`);
        if (barToRemove) {
            barToRemove.classList.add("removing-bar-animation");
            barToRemove.addEventListener("animationend", () => barToRemove.remove(), { once: true });
        }
        BarDisplayController.updateSelectionVisuals();
    },

    updateBar: (trackIndex, barIndex) => {
        const track = AppState.getTracks()[trackIndex];
        if (!track) return;
        const barData = track.barSettings[barIndex];
        if (!barData) return;

        const targetBarDisplayContainer = DOM.trackWrapper.querySelector(
            `.bar-display-container[data-container-index="${trackIndex}"]`
        );
        if (!targetBarDisplayContainer) return;

        const barDiv = targetBarDisplayContainer.querySelector(`.bar-visual[data-bar-index="${barIndex}"]`);
        if (!barDiv) return;

        const mainBeatsInBar = barData.beats;
        const subdivision = barData.subdivision;
        const totalSubBeatsNeeded = calculateTotalSubBeats(mainBeatsInBar, subdivision);

        const existingBeatSquares = Array.from(
            barDiv.querySelectorAll(".beat-square:not(.removing-beat-animation)")
        );
        const currentSubBeatCountInDom = existingBeatSquares.length;

        if (totalSubBeatsNeeded > currentSubBeatCountInDom) {
            for (let i = currentSubBeatCountInDom; i < totalSubBeatsNeeded; i++) {
                const beatSquare = createBeatSquareElement(
                    i,
                    subdivision,
                    mainBeatsInBar
                );
                barDiv.appendChild(beatSquare);
            }
        } else if (totalSubBeatsNeeded < currentSubBeatCountInDom) {
            const beatsToAnimateOutCount =
              currentSubBeatCountInDom - totalSubBeatsNeeded;
            for (let i = 0; i < beatsToAnimateOutCount; i++) {
              const beatToRemove =
                existingBeatSquares[currentSubBeatCountInDom - 1 - i];
              if (beatToRemove) {
                beatToRemove.classList.add("removing-beat-animation");
                beatToRemove.addEventListener(
                  "animationend",
                  function handleBeatRemoveAnim() {
                    this.remove();
                  },
                  { once: true }
                );
              }
            }
        }
        const allBeatSquares = barDiv.querySelectorAll(".beat-square");
        allBeatSquares.forEach((sq, beatIdx) => {
            updateBeatSquareClasses(sq, beatIdx, subdivision, mainBeatsInBar);
        });

        const flexBasis = 100 / totalSubBeatsNeeded * 0.9;
        allBeatSquares.forEach(sq => {
          sq.style.flexBasis = `${flexBasis}%`;
        });
    },

    updateSelectionVisuals: () => {
        const selectedTrackIndex = AppState.getSelectedTrackIndex();
        const selectedBarIndexInContainer = AppState.getSelectedBarIndexInContainer();

        document.querySelectorAll('.bar-visual.selected').forEach(bar => {
            bar.classList.remove('selected');
        });

        if (selectedTrackIndex !== -1 && selectedBarIndexInContainer !== -1) {
            const selectedBar = document.querySelector(
                `.bar-visual[data-container-index="${selectedTrackIndex}"][data-bar-index="${selectedBarIndexInContainer}"]`
            );
            if (selectedBar) {
                selectedBar.classList.add("selected");
            }
        }
    },
  /**
   * Renders or updates the bar and beat visuals in the DOM for all tracks.
   * @param {number} [previousBarCountForAnimation=-1] - Optional. If provided,
   * animates bars with index >= this count as newly added.
   */
  renderBarsAndControls: (previousBarCountForAnimation = -1) => {
    BarDisplayController.clearAllHighlights(); // Ensure a clean slate before any re-render

    const allTracks = AppState.getTracks();
    const selectedTrackIndex = AppState.getSelectedTrackIndex();
    const selectedBarIndexInContainer = AppState.getSelectedBarIndexInContainer();
    const isPlaying = AppState.isPlaying();

    allTracks.forEach((track, containerIndex) => {
      const barSettings = track.barSettings;
      const targetBarDisplayContainer = DOM.trackWrapper.querySelector(
        `.bar-display-container[data-container-index="${containerIndex}"]`
      );

      if (!targetBarDisplayContainer) {
        console.warn(`Bar display container not found for index ${containerIndex}`);
        return;
      }

      // Get all current bar DOM elements within this container to compare against barSettings
      const existingBarVisualsMap = new Map();
      targetBarDisplayContainer.querySelectorAll(".bar-visual").forEach((barEl) => {
        if (barEl.dataset.barIndex) {
          existingBarVisualsMap.set(barEl.dataset.barIndex, barEl);
        }
      });

      if (barSettings.length === 0) {
        // Animate out any remaining bars if syncBarSettings didn't catch them
        existingBarVisualsMap.forEach((barEl) => {
          if (!barEl.classList.contains("removing-bar-animation")) {
            barEl.classList.add("removing-bar-animation");
            barEl.addEventListener("animationend", () => barEl.remove(), {
              once: true,
            });
          }
        });
        // This was changed from innerHTML = "" to ensure controls are not deleted
        targetBarDisplayContainer.querySelectorAll(".bar-visual").forEach(bar => bar.remove());
        return;
      }

      const newBarsFragment = document.createDocumentFragment(); // For bars that are entirely new

      barSettings.forEach((barData, barIndex) => {
        let barDiv = existingBarVisualsMap.get(String(barIndex));
        const mainBeatsInBar = barData.beats;
        const subdivision = barData.subdivision;
        const totalSubBeatsNeeded = calculateTotalSubBeats(
          mainBeatsInBar,
          subdivision
        );
        let isNewBarInstance = false;

        if (barDiv) {
          existingBarVisualsMap.delete(String(barIndex));
        } else {
          isNewBarInstance = true;
          barDiv = document.createElement("div");
          barDiv.classList.add("bar-visual");
          barDiv.dataset.containerIndex = containerIndex; // Add container index
          barDiv.dataset.barIndex = barIndex; // Use barIndex for individual bar
          
          if (
            previousBarCountForAnimation !== -1 &&
            barIndex >= previousBarCountForAnimation
          ) {
            barDiv.classList.add("newly-added-bar-animation");
          }
        }

        barDiv.addEventListener("pointerdown", onBarPointerDown);

        if (isNewBarInstance) {
          for (let i = 0; i < totalSubBeatsNeeded; i++) {
            const beatSquare = createBeatSquareElement(
              i,
              subdivision,
              mainBeatsInBar
            );
            barDiv.appendChild(beatSquare);
          }
        } else {
          const existingBeatSquares = Array.from(
            barDiv.querySelectorAll(".beat-square:not(.removing-beat-animation)")
          );
          const currentSubBeatCountInDom = existingBeatSquares.length;

          if (totalSubBeatsNeeded > currentSubBeatCountInDom) {
            for (let i = currentSubBeatCountInDom; i < totalSubBeatsNeeded; i++) {
              const beatSquare = createBeatSquareElement(
                i,
                subdivision,
                mainBeatsInBar
              );
              barDiv.appendChild(beatSquare);
            }
          } else if (totalSubBeatsNeeded < currentSubBeatCountInDom) {
            const beatsToAnimateOutCount =
              currentSubBeatCountInDom - totalSubBeatsNeeded;
            for (let i = 0; i < beatsToAnimateOutCount; i++) {
              const beatToRemove =
                existingBeatSquares[currentSubBeatCountInDom - 1 - i];
              if (beatToRemove) {
                beatToRemove.classList.add("removing-beat-animation");
                beatToRemove.addEventListener(
                  "animationend",
                  function handleBeatRemoveAnim() {
                    this.removeEventListener(
                      "animationend",
                      handleBeatRemoveAnim
                    );
                    this.remove();
                    if (previousHighlightedBeatElements.includes(this)) {
                        previousHighlightedBeatElements = previousHighlightedBeatElements.filter(el => el !== this);
                    }
                  },
                  { once: true }
                );
              }
            }
          }
          const allBeatSquares = barDiv.querySelectorAll(".beat-square");
          allBeatSquares.forEach((sq, beatIdx) => {
            updateBeatSquareClasses(sq, beatIdx, subdivision, mainBeatsInBar);
          });
        }

        const allBeatSquares = barDiv.querySelectorAll(".beat-square");
        const flexBasis = 100 / totalSubBeatsNeeded * 0.9;
        allBeatSquares.forEach(sq => {
          sq.style.flexBasis = `${flexBasis}%`;
        });

        if (containerIndex === selectedTrackIndex && barIndex === selectedBarIndexInContainer) {
          barDiv.classList.add("selected");
        } else {
          barDiv.classList.remove("selected");
        }

        if (isNewBarInstance) {
          newBarsFragment.appendChild(barDiv);
        }
      });

      if (newBarsFragment.childNodes.length > 0) {
        targetBarDisplayContainer.appendChild(newBarsFragment);
      }

      existingBarVisualsMap.forEach((barEl) => {
        if (!barEl.classList.contains("removing-bar-animation")) {
          barEl.classList.add("removing-bar-animation");
          barEl.addEventListener("animationend", () => barEl.remove(), {
            once: true,
          });
        }
      });
    });

    BarDisplayController.validateAllBeatClasses();

    if (isPlaying) {
      allTracks.forEach((track, containerIndex) => {
        BarDisplayController.updateBeatHighlight(containerIndex, track.currentBar, track.currentBeat, true);
      });
    }
  },

  /**
   * Clears all beat and bar highlights from the display across all tracks.
   */
  clearAllHighlights: () => {
    document.querySelectorAll('.beat-square.highlighted, .beat-square.highlighted-sub')
      .forEach(sq => sq.classList.remove('highlighted', 'highlighted-sub'));
    document.querySelectorAll('.bar-visual.active-bar')
      .forEach(bar => bar.classList.remove('active-bar'));

    previousHighlightedBeatElements = [];
    currentActiveBarElements = [];
  },

  updateBeatHighlight: (containerIndex, barIndex, beatIndex, shouldHighlight) => {
    const targetBarDisplayContainer = DOM.trackWrapper.querySelector(
      `.bar-display-container[data-container-index="${containerIndex}"]`
    );
    if (!targetBarDisplayContainer) return;

    // Clear previous highlight for THIS container
    if (previousHighlightedBeatElements[containerIndex]) {
      previousHighlightedBeatElements[containerIndex].classList.remove("highlighted", "highlighted-sub");
    }
    if (currentActiveBarElements[containerIndex]) {
        currentActiveBarElements[containerIndex].classList.remove("active-bar");
    }

    const bars = targetBarDisplayContainer.querySelectorAll(".bar-visual");
    if (barIndex < 0 || barIndex >= bars.length) return;

    const targetBarElement = bars[barIndex];

    if (shouldHighlight) {
      const beatSquares = targetBarElement.querySelectorAll(".beat-square");
      if (beatIndex >= 0 && beatIndex < beatSquares.length) {
        const beatToHighlight = beatSquares[beatIndex];
        
        if (beatToHighlight.classList.contains('main-beat-marker')) {
          beatToHighlight.classList.add("highlighted");
        } else {
          beatToHighlight.classList.add("highlighted-sub");
        }
        
        previousHighlightedBeatElements[containerIndex] = beatToHighlight;

        targetBarElement.classList.add("active-bar");
        currentActiveBarElements[containerIndex] = targetBarElement;
      }
    }
  },

  /**
   * Validates and updates all beat square classes across all bars in all tracks.
   * Call this after any subdivision or beat count changes.
   */
  validateAllBeatClasses: () => {
    const allTracks = AppState.getTracks();
    allTracks.forEach((track, containerIndex) => {
      const barSettings = track.barSettings;
      const targetBarDisplayContainer = DOM.trackWrapper.querySelector(
        `.bar-display-container[data-container-index="${containerIndex}"]`
      );
      if (!targetBarDisplayContainer) return;

      const barElements = targetBarDisplayContainer.querySelectorAll(".bar-visual");

      barElements.forEach((barElement, barIndex) => {
        if (barIndex >= barSettings.length) return;

        const barData = barSettings[barIndex];
        const mainBeatsInBar = barData.beats;
        const subdivision = barData.subdivision;
        const beatSquares = barElement.querySelectorAll(
          ".beat-square:not(.removing-beat-animation)"
        );

        beatSquares.forEach((beatSquare, beatIndex) => {
          updateBeatSquareClasses(
            beatSquare,
            beatIndex,
            subdivision,
            mainBeatsInBar
          );
        });
      });
    });
  },
};

export default BarDisplayController;