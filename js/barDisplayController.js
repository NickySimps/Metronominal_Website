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
import SoundSettingsModal from "./soundSettingsModal.js";

// State variables related to display highlighting
let previousHighlightedBeatElements = []; // To keep track of the previously highlighted beat
let currentActiveBarElements = []; // To keep track of the bar visual that is currently active

// State variables for long-press interaction
let longPressTimer = null;
let isLongPressActive = false;
let longPressedBarElement = null;
let longPressInitialPosition = { x: 0, y: 0 };
let hoveredSubdivisionOption = null;
let subdivisionSelectionInProgress = false;
let lastPaintedBeatSquare = null;
let dragPaintAction = null;
let dragPaintTargetVel = 0.7;
const LONG_PRESS_DURATION = 200; // ms
const POINTER_MOVE_THRESHOLD = 35; // pixels (Forgiving for touch & mouse hold)

function openSubdivisionSelectorForSelectedBar() {
  const trackIndex = AppState.getSelectedTrackIndex();
  const barIndex = AppState.getSelectedBarIndexInContainer();
  const selectedBar = document.querySelector(
    `.bar-visual[data-container-index="${trackIndex}"][data-bar-index="${barIndex}"]`
  );
  if (selectedBar) showSubdivisionSelector(selectedBar);
}

document.addEventListener("visualizerlongpress", openSubdivisionSelectorForSelectedBar);

// Helper function to calculate total sub-beats needed based on subdivision
function calculateTotalSubBeats(mainBeatsInBar, subdivision) {
  const subdivisionFloat = parseFloat(subdivision);
  let totalSubBeatsNeeded;
  if (subdivisionFloat < 1) {
    // For fractional subdivisions (whole notes, half notes), we show fewer beats
    totalSubBeatsNeeded = Math.max(1, mainBeatsInBar * subdivisionFloat);
  } else {
    // For subdivisions >= 1, we show more beats
    totalSubBeatsNeeded = mainBeatsInBar * subdivisionFloat;
  }
  return totalSubBeatsNeeded;
}

// Helper function to determine if a beat should be marked as main beat
function isMainBeat(indexInBar, subdivision, mainBeatsInBar) {
  const subdivisionFloat = parseFloat(subdivision);
  let result;

  if (subdivisionFloat < 1) {
    result = indexInBar === 0;
  } else {
    // Playback treats only the first beat as the main sound when the bar is
    // quarter-note resolution; higher subdivision values add aligned accents.
    result = indexInBar === 0 || (subdivisionFloat > 1 && indexInBar % subdivisionFloat === 0);
  }
  return result;
}

// Helper function to create a beat square element with animation and classes
function createBeatSquareElement(
  indexInBar,
  currentBeatMultiplier,
  mainBeatsInBar,
  isRested = false,
  velocity = null,
  isIndividuallyEdited = false
) {
  const beatSquare = document.createElement("div");
  beatSquare.classList.add("beat-square", "newly-added-beat-animation");
  beatSquare.dataset.beatIndex = indexInBar; // Add data-beat-index
  beatSquare.addEventListener("click", (event) => {
    if (!document.body.classList.contains("beat-edit-mode")) return;
    event.stopPropagation();
    const barDiv = beatSquare.closest(".bar-visual");
    if (!barDiv) return;
    const trackIndex = Number.parseInt(barDiv.dataset.containerIndex, 10);
    const barIndex = Number.parseInt(barDiv.dataset.barIndex, 10);
    const beatIndex = Number.parseInt(beatSquare.dataset.beatIndex, 10);
    const soundType = beatSquare.classList.contains("main-beat-marker")
      ? "mainBeatSound"
      : "subdivisionSound";
    SoundSettingsModal.show(trackIndex, soundType, { barIndex, beatIndex });
  });
  if (isRested) {
    beatSquare.classList.add("rested");
  }
  updateBeatSquareClasses(
    beatSquare,
    indexInBar,
    currentBeatMultiplier,
    mainBeatsInBar
  );
  applyBeatStateClasses(beatSquare, indexInBar, isRested, velocity, isIndividuallyEdited);
  // beatSquare.addEventListener("click", handleBeatSquareClick); // Add click listener

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

function hasBeatSoundOverride(beatOverride) {
  const neutralEffectDefaults = {
    distortion: 0,
    delayMix: 0,
    delayTime: 0,
    delayFeedback: 0.25,
    reverbMix: 0,
    reverbFeedback: 0.25,
  };
  return Boolean(beatOverride && typeof beatOverride === "object"
    && Object.values(beatOverride).some((soundInfo) => {
      if (!soundInfo || typeof soundInfo.sound !== "string" || !soundInfo.sound) return false;
      const defaults = AppState.getDefaultSoundSettings(soundInfo.sound) || {};
      const settings = soundInfo.settings || {};
      const keys = new Set([...Object.keys(defaults), ...Object.keys(settings)]);
      return [...keys].some((key) => {
        const actual = settings[key];
        const expected = key in defaults ? defaults[key] : neutralEffectDefaults[key];
        if (actual === undefined && expected === undefined) return false;
        if (typeof actual === "number" || typeof expected === "number") {
          return Math.abs(Number(actual ?? 0) - Number(expected ?? 0)) > 1e-6;
        }
        return actual !== expected;
      });
    }));
}

function applyBeatStateClasses(beatSquare, beatIndex, isRested, velocity, isIndividuallyEdited) {
  const effectiveVelocity = Number.isFinite(Number(velocity))
    ? Number(velocity)
    : (beatIndex === 0 ? 1 : 0.7);
  beatSquare.classList.toggle("rested", isRested);
  beatSquare.classList.toggle("ghost-note", !isRested && effectiveVelocity <= 0.3);
  beatSquare.classList.toggle("accent-note", !isRested && effectiveVelocity >= 1);
  beatSquare.classList.toggle("beat-edited", isIndividuallyEdited);
}

// Helper function to create or update the beat indicator icon
function updateBeatIndicator(barDiv, beats, subdivision) {
  let indicator = barDiv.querySelector(".bar-beat-indicator");
  if (!indicator) {
    indicator = document.createElement("div");
    indicator.classList.add("bar-beat-indicator");
    indicator.title = "Click to change subdivision";
    
    // Stop pointerdown from bubbling to avoid bar selection/longpress logic
    indicator.addEventListener("pointerdown", (e) => e.stopPropagation());
    
    indicator.addEventListener("click", (e) => {
        e.stopPropagation();
        const containerIndex = Number.parseInt(barDiv.dataset.containerIndex, 10);
        const barIndex = Number.parseInt(barDiv.dataset.barIndex, 10);
        if (Number.isInteger(containerIndex) && Number.isInteger(barIndex)) {
            AppState.setSelectedTrackIndex(containerIndex);
            AppState.setSelectedBarIndexInContainer(barIndex);
            BarDisplayController.updateSelectionVisuals();
            BarControlsController.updateBeatControlsDisplay();
            document.dispatchEvent(new CustomEvent("trackselectionchanged", { detail: { shouldScroll: false } }));
            sendState(AppState.getCurrentStateForPreset(true));
        }
        showSubdivisionSelector(barDiv);
    });
    
    barDiv.appendChild(indicator);
  }
  indicator.textContent = `${beats}┃${subdivision}`;
}

function onBarPointerDown(event) {
  if (event.button !== 0) return;

  event.preventDefault();
  longPressedBarElement = event.currentTarget;
  longPressInitialPosition = { x: event.clientX, y: event.clientY };
  lastPaintedBeatSquare = event.target.closest(".beat-square");

  if (lastPaintedBeatSquare) {
    const barVisual = lastPaintedBeatSquare.closest(".bar-visual");
    if (barVisual) {
      const containerIndex = parseInt(barVisual.dataset.containerIndex, 10);
      const barIndex = parseInt(barVisual.dataset.barIndex, 10);
      const beatIndex = parseInt(lastPaintedBeatSquare.dataset.beatIndex, 10);
      const track = AppState.getTracks()[containerIndex];
      if (track && track.barSettings[barIndex]) {
        if (AppState.isRestMode()) {
          const rests = [...(track.barSettings[barIndex].rests || [])];
          if (rests.includes(beatIndex)) {
            dragPaintAction = 'UNREST';
            const idx = rests.indexOf(beatIndex);
            rests.splice(idx, 1);
          } else {
            dragPaintAction = 'REST';
            rests.push(beatIndex);
          }
          const velocities = { ...(track.barSettings[barIndex].velocities || {}) };
          delete velocities[beatIndex];

          const newBarSettings = [...track.barSettings];
          newBarSettings[barIndex].rests = rests;
          newBarSettings[barIndex].velocities = velocities;
          AppState.updateTrack(containerIndex, { barSettings: newBarSettings });
          BarDisplayController.updateBar(containerIndex, barIndex);
        } else if (AppState.isAccentMode()) {
          dragPaintAction = 'ACCENT';
          const velocities = { ...(track.barSettings[barIndex].velocities || {}) };
          const defaultVel = (beatIndex === 0) ? 1.0 : 0.7;
          const curVel = velocities[beatIndex] !== undefined ? velocities[beatIndex] : defaultVel;
          let nextVel = 0.7;
          if (curVel === 0.7) nextVel = 1.0;
          else if (curVel === 1.0) nextVel = 0.3;
          else nextVel = 0.7;

          dragPaintTargetVel = nextVel;
          velocities[beatIndex] = nextVel;
          const rests = [...(track.barSettings[barIndex].rests || [])].filter(r => r !== beatIndex);

          const newBarSettings = [...track.barSettings];
          newBarSettings[barIndex].velocities = velocities;
          newBarSettings[barIndex].rests = rests;
          AppState.updateTrack(containerIndex, { barSettings: newBarSettings });
          BarDisplayController.updateBar(containerIndex, barIndex);
        }
      }
    }
  }

  longPressTimer = setTimeout(() => {
    isLongPressActive = true;
    longPressTimer = null;
    if (longPressedBarElement) {
      showSubdivisionSelector(longPressedBarElement);
    } else {
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
        }
    }

    const elementUnderPointer = document.elementFromPoint(event.clientX, event.clientY);
    const beatSquare = elementUnderPointer ? elementUnderPointer.closest(".beat-square") : null;

    if (beatSquare && beatSquare !== lastPaintedBeatSquare) {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
        isLongPressActive = false;
        lastPaintedBeatSquare = beatSquare;

        const barVisual = beatSquare.closest(".bar-visual");
        if (barVisual) {
          const clickedBarIndex = parseInt(barVisual.dataset.barIndex, 10);
          const clickedContainerIndex = parseInt(barVisual.dataset.containerIndex, 10);
          const beatIndex = parseInt(beatSquare.dataset.beatIndex, 10);
          const track = AppState.getTracks()[clickedContainerIndex];

          if (track && track.barSettings[clickedBarIndex]) {
            if (AppState.isRestMode()) {
              let newRests = [...(track.barSettings[clickedBarIndex].rests || [])];
              if (dragPaintAction === 'UNREST') {
                newRests = newRests.filter(r => r !== beatIndex);
              } else {
                if (!newRests.includes(beatIndex)) {
                  newRests.push(beatIndex);
                }
              }
              const velocities = { ...(track.barSettings[clickedBarIndex].velocities || {}) };
              delete velocities[beatIndex];

              const newBarSettings = [...track.barSettings];
              newBarSettings[clickedBarIndex].rests = newRests;
              newBarSettings[clickedBarIndex].velocities = velocities;
              AppState.updateTrack(clickedContainerIndex, { barSettings: newBarSettings });
              BarDisplayController.updateBar(clickedContainerIndex, clickedBarIndex);
            } else if (AppState.isAccentMode()) {
              const velocities = { ...(track.barSettings[clickedBarIndex].velocities || {}) };
              velocities[beatIndex] = dragPaintTargetVel || 1.0;
              const newRests = [...(track.barSettings[clickedBarIndex].rests || [])].filter(r => r !== beatIndex);

              const newBarSettings = [...track.barSettings];
              newBarSettings[clickedBarIndex].velocities = velocities;
              newBarSettings[clickedBarIndex].rests = newRests;
              AppState.updateTrack(clickedContainerIndex, { barSettings: newBarSettings });
              BarDisplayController.updateBar(clickedContainerIndex, clickedBarIndex);
            }
          }
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

async function applySubdivisionChange(containerIndex, barIndex, newSubdivision) {
    if (newSubdivision === null || isNaN(containerIndex) || isNaN(barIndex)) {
        return;
    }


    const wasPlaying = AppState.isPlaying();
    if (wasPlaying) {
        await MetronomeEngine.togglePlay();
    }

    AppState.setSelectedTrackIndex(containerIndex);
    AppState.setSelectedBarIndexInContainer(barIndex);
    AppState.setSubdivisionForSelectedBar(newSubdivision);
    sendState(AppState.getCurrentStateForPreset(true));

    BarDisplayController.renderBarsAndControls(-1);
    BarControlsController.updateBeatControlsDisplay();

    if (wasPlaying && AppState.getBarSettings(containerIndex).length > 0) {
        await MetronomeEngine.togglePlay();
    }

    if (ThemeController.is3DSceneActive()) {
        ThemeController.update3DScenePostStateChange();
    }
}

async function selectSubdivisionOption(option) {
  const newSubdivision = option?.dataset.value;
  const barIndex = parseInt(longPressedBarElement?.dataset.barIndex, 10);
  const containerIndex = parseInt(longPressedBarElement?.dataset.containerIndex, 10);
  if (newSubdivision && !isNaN(barIndex) && !isNaN(containerIndex)) {
    await applySubdivisionChange(containerIndex, barIndex, newSubdivision);
  } else if (longPressTimer) {
    return;
  }
  hideSubdivisionSelector();
  cleanupPointerListeners();
  resetLongPressState();
}

async function onWindowPointerUp(event) {
  if (isLongPressActive && hoveredSubdivisionOption && !subdivisionSelectionInProgress) {
    await selectSubdivisionOption(hoveredSubdivisionOption);
    return;
  }
  if (!isLongPressActive && longPressTimer) {
    event.preventDefault();
    clearTimeout(longPressTimer);
    const clickedBarIndex = parseInt(longPressedBarElement.dataset.barIndex, 10);
    const clickedContainerIndex = parseInt(longPressedBarElement.dataset.containerIndex, 10);
    if (AppState.getSelectedTrackIndex() !== clickedContainerIndex || AppState.getSelectedBarIndexInContainer() !== clickedBarIndex) {
      AppState.setSelectedTrackIndex(clickedContainerIndex);
      AppState.setSelectedBarIndexInContainer(clickedBarIndex);
      sendState(AppState.getCurrentStateForPreset(true));
      BarDisplayController.renderBarsAndControls();
      BarControlsController.updateBeatControlsDisplay();
    } else {
      sendState(AppState.getCurrentStateForPreset(true));
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
  subdivisionSelectionInProgress = false;
  lastPaintedBeatSquare = null;
  dragPaintAction = null;
}

function showSubdivisionSelector(barElement) {
    longPressedBarElement = barElement;
    const isAlreadyVisible = document.querySelector('.subdivision-options-container.visible');
    const visibleForThisBar = isAlreadyVisible && isAlreadyVisible.dataset.forBar === `${barElement.dataset.containerIndex}-${barElement.dataset.barIndex}`;
    
    hideSubdivisionSelector(); // Clear previous options first
    
    // If it was already visible for THIS bar, we just hide it (toggle off) and return
    if (visibleForThisBar) {
        return;
    }

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
        container.classList.add(position);
        container.dataset.forBar = `${barElement.dataset.containerIndex}-${barElement.dataset.barIndex}`;
        if (position === 'below') {
            container.classList.add('below');
        }
        
        subdivisions.forEach(optionData => {
            const element = document.createElement('div');
            element.className = 'subdivision-option';
            element.dataset.value = optionData.value;
            element.textContent = optionData.text;
            
            element.addEventListener('pointerenter', () => {
                if (!subdivisionSelectionInProgress) {
                    hoveredSubdivisionOption = element;
                    element.classList.add('hovered');
                }
            });

            // Handle click for selection (useful when opened via indicator click)
            element.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (subdivisionSelectionInProgress) return;
                const newSubdivision = element.dataset.value;
                if (newSubdivision) {
                    await applySubdivisionChange(containerIndex, barIndex, newSubdivision);
                }
                hideSubdivisionSelector();
            });

            container.appendChild(element);
        });

        document.body.appendChild(container);
        container.addEventListener('pointerup', () => {
            if (hoveredSubdivisionOption && !subdivisionSelectionInProgress) {
                subdivisionSelectionInProgress = true;
                void selectSubdivisionOption(hoveredSubdivisionOption);
            }
        });
        container.style.left = `${barRect.left + barRect.width / 2}px`;
        if (position === 'above') {
            container.style.top = `${barRect.top - 10}px`;
            container.style.transform = 'translate(-50%, -100%)';
        } else { // 'below'
            container.style.top = `${barRect.bottom + 10}px`;
            container.style.transform = 'translateX(-50%)';
        }

        requestAnimationFrame(() => {
            const margin = 8;
            const rect = container.getBoundingClientRect();
            let left = barRect.left + barRect.width / 2;
            if (rect.left < margin) left += margin - rect.left;
            if (rect.right > window.innerWidth - margin) left -= rect.right - (window.innerWidth - margin);
            container.style.left = `${left}px`;
            if (position === 'above' && (rect.top < margin || rect.bottom > window.innerHeight - margin)) {
                container.style.top = `${margin}px`;
                container.style.transform = 'translate(-50%, 0)';
            } else if (position === 'below' && rect.bottom > window.innerHeight - margin) {
                container.style.top = `${Math.max(margin, window.innerHeight - rect.height - margin)}px`;
                container.style.transform = 'translate(-50%, 0)';
            }
            requestAnimationFrame(() => {
                container.classList.add("visible");
                requestAnimationFrame(() => {
                    const options = [...container.querySelectorAll('.subdivision-option')];
                    const optionRects = options.map((option) => option.getBoundingClientRect());
                    const top = Math.min(...optionRects.map((rect) => rect.top));
                    const bottom = Math.max(...optionRects.map((rect) => rect.bottom));
                    const currentTop = parseFloat(container.style.top);
                    let correction = top < margin ? margin - top : 0;
                    const correctedBottom = bottom + correction;
                    if (correctedBottom > window.innerHeight - margin) {
                        correction += window.innerHeight - margin - correctedBottom;
                    }
                    if (correction) container.style.top = `${currentTop + correction}px`;
                });
            });
        });
        
        // Hide if clicking outside the container
        currentHideOnClickOutside = (e) => {
            if (!container.contains(e.target)) {
                hideSubdivisionSelector();
            }
        };
        // Use a timeout to avoid immediate closure from the same click that opened it
        setTimeout(() => {
            if (currentHideOnClickOutside) {
                window.addEventListener('click', currentHideOnClickOutside);
            }
        }, 10);
        
        return container;
    };

    createContainer(lowerSubdivisions, 'above');
    createContainer(higherSubdivisions, 'below');
    setTimeout(() => {
        const panels = [...document.querySelectorAll(`.subdivision-options-container[data-for-bar="${barElement.dataset.containerIndex}-${barElement.dataset.barIndex}"]`)].filter((panel) => panel.classList.contains('visible'));
        const above = panels.find((panel) => panel.classList.contains('above'));
        const below = panels.find((panel) => panel.classList.contains('below'));
        if (!above || !below) return;
        const aboveRect = above.getBoundingClientRect();
        const belowRect = below.getBoundingClientRect();
        if (aboveRect.bottom <= belowRect.top - 8) return;

        const margin = 8;
        const gap = 8;
        const aboveHeight = aboveRect.height;
        const belowHeight = belowRect.height;
        const totalHeight = aboveHeight + gap + belowHeight;
        above.style.top = `${margin}px`;
        above.style.transform = 'translate(-50%, 0)';
        below.style.top = `${margin + aboveHeight + gap}px`;
        below.style.transform = 'translate(-50%, 0)';
        if (totalHeight > window.innerHeight - margin * 2) {
            below.style.maxHeight = `${Math.max(120, window.innerHeight - margin - (margin + aboveHeight + gap))}px`;
            below.style.overflowY = 'auto';
        }
    }, 75);
}

let currentHideOnClickOutside = null;

function hideSubdivisionSelector() {
    if (currentHideOnClickOutside) {
        window.removeEventListener('click', currentHideOnClickOutside);
        currentHideOnClickOutside = null;
    }
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

function handleBeatSquareClick(event) {
  console.log("handleBeatSquareClick called.");
  const beatSquare = event.currentTarget;
  const barDiv = beatSquare.closest(".bar-visual");

  if (!barDiv) {
    console.error("Could not find parent bar-visual for clicked beat square.");
    return;
  }

  const trackIndex = parseInt(barDiv.dataset.containerIndex, 10);
  const barIndex = parseInt(barDiv.dataset.barIndex, 10);
  const beatIndex = parseInt(beatSquare.dataset.beatIndex, 10);

  console.log("Clicked beat square - Track:", trackIndex, "Bar:", barIndex, "Beat:", beatIndex);

  if (isNaN(trackIndex) || isNaN(barIndex) || isNaN(beatIndex)) {
    console.error("Invalid indices for beat square click:", { trackIndex, barIndex, beatIndex });
    return;
  }

  AppState.toggleBeatRest(trackIndex, barIndex, beatIndex);
  BarDisplayController.updateBar(trackIndex, barIndex); // Re-render the bar to update visuals
  sendState(AppState.getCurrentStateForPreset(true)); // Sync state via WebRTC
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
        barDiv.addEventListener("animationend", () => {
            barDiv.classList.remove("newly-added-bar-animation");
        }, { once: true });

        if (AppState.isRestMode()) {
            barDiv.classList.add("rest-mode-active");
        }
        if (AppState.isAccentMode()) {
            barDiv.classList.add("accent-mode-active");
        }
        barDiv.dataset.containerIndex = trackIndex;
        barDiv.dataset.barIndex = barIndex;

        barDiv.addEventListener("pointerdown", onBarPointerDown);

        const mainBeatsInBar = barData.beats;
        const subdivision = barData.subdivision;
        barDiv.classList.toggle("flex-subdivision", ![1, 2, 4].includes(Number(subdivision)));

        updateBeatIndicator(barDiv, mainBeatsInBar, subdivision);

        const totalSubBeatsNeeded = calculateTotalSubBeats(mainBeatsInBar, subdivision);
        const subdivisionNumber = Number(subdivision);
        const columns = ![1, 2, 4].includes(subdivisionNumber)
          ? Math.max(1, Math.min(8, subdivisionNumber > 1 ? Math.ceil(subdivisionNumber) : Math.ceil(totalSubBeatsNeeded)))
          : Math.min(4, Math.max(1, Math.ceil(totalSubBeatsNeeded)));
        barDiv.style.setProperty("--beat-columns", String(columns));
        const rests = barData.rests || [];

        for (let i = 0; i < totalSubBeatsNeeded; i++) {
            const isRested = rests.includes(i);
            const velocity = barData.velocities?.[i];
            const isIndividuallyEdited = hasBeatSoundOverride(barData.beatSounds?.[i]);
            const beatSquare = createBeatSquareElement(i, subdivision, mainBeatsInBar, isRested, velocity, isIndividuallyEdited);
            barDiv.appendChild(beatSquare);
        }

        const allBeatSquares = barDiv.querySelectorAll(".beat-square");
        const flexBasis = 100 / totalSubBeatsNeeded * 0.9;
        allBeatSquares.forEach(sq => {
          sq.style.flexBasis = barDiv.classList.contains("flex-subdivision") ? "" : `${flexBasis}%`;
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
        barDiv.classList.toggle("flex-subdivision", ![1, 2, 4].includes(Number(subdivision)));

        updateBeatIndicator(barDiv, mainBeatsInBar, subdivision);

        const totalSubBeatsNeeded = calculateTotalSubBeats(mainBeatsInBar, subdivision);
        const subdivisionNumber = Number(subdivision);
        const columns = ![1, 2, 4].includes(subdivisionNumber)
          ? Math.max(1, Math.min(8, subdivisionNumber > 1 ? Math.ceil(subdivisionNumber) : Math.ceil(totalSubBeatsNeeded)))
          : Math.min(4, Math.max(1, Math.ceil(totalSubBeatsNeeded)));
        barDiv.style.setProperty("--beat-columns", String(columns));
        const rests = barData.rests || [];

        const existingBeatSquares = Array.from(
            barDiv.querySelectorAll(".beat-square:not(.removing-beat-animation)")
        );
        const currentSubBeatCountInDom = existingBeatSquares.length;

        if (totalSubBeatsNeeded > currentSubBeatCountInDom) {
            for (let i = currentSubBeatCountInDom; i < totalSubBeatsNeeded; i++) {
                const isRested = rests.includes(i);
                const beatSquare = createBeatSquareElement(
                    i,
                    subdivision,
                    mainBeatsInBar,
                    isRested,
                    barData.velocities?.[i],
                    hasBeatSoundOverride(barData.beatSounds?.[i])
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
            applyBeatStateClasses(
              sq,
              beatIdx,
              rests.includes(beatIdx),
              barData.velocities?.[beatIdx],
              hasBeatSoundOverride(barData.beatSounds?.[beatIdx])
            );
        });

        const flexBasis = 100 / totalSubBeatsNeeded * 0.9;
        allBeatSquares.forEach(sq => {
          sq.style.flexBasis = barDiv.classList.contains("flex-subdivision") ? "" : `${flexBasis}%`;
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
        const rests = barData.rests || [];
        let isNewBarInstance = false;

        if (barDiv) {
          existingBarVisualsMap.delete(String(barIndex));
        } else {
          isNewBarInstance = true;
          barDiv = document.createElement("div");
          barDiv.classList.add("bar-visual");
          if (AppState.isRestMode()) {
            barDiv.classList.add("rest-mode-active");
          }
          barDiv.dataset.containerIndex = containerIndex; // Add container index
          barDiv.dataset.barIndex = barIndex; // Use barIndex for individual bar
          
          if (
            previousBarCountForAnimation !== -1 &&
            barIndex >= previousBarCountForAnimation
          ) {
            barDiv.classList.add("newly-added-bar-animation");
            barDiv.addEventListener("animationend", () => {
                barDiv.classList.remove("newly-added-bar-animation");
            }, { once: true });
          }
        }
        
        updateBeatIndicator(barDiv, mainBeatsInBar, subdivision);

        barDiv.addEventListener("pointerdown", onBarPointerDown);

        if (isNewBarInstance) {
          for (let i = 0; i < totalSubBeatsNeeded; i++) {
            const isRested = rests.includes(i);
            const beatSquare = createBeatSquareElement(
                i,
                subdivision,
                mainBeatsInBar,
                isRested,
                barData.velocities?.[i],
                hasBeatSoundOverride(barData.beatSounds?.[i])
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
              const isRested = rests.includes(i);
              const beatSquare = createBeatSquareElement(
                  i,
                  subdivision,
                  mainBeatsInBar,
                  isRested,
                  barData.velocities?.[i],
                  hasBeatSoundOverride(barData.beatSounds?.[i])
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
            applyBeatStateClasses(
              sq,
              beatIdx,
              rests.includes(beatIdx),
              barData.velocities?.[beatIdx],
              hasBeatSoundOverride(barData.beatSounds?.[beatIdx])
            );
          });
        }

        const allBeatSquares = barDiv.querySelectorAll(".beat-square");
        const flexBasis = 100 / totalSubBeatsNeeded * 0.9;
        allBeatSquares.forEach(sq => {
          sq.style.flexBasis = barDiv.classList.contains("flex-subdivision") ? "" : `${flexBasis}%`;
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
          const rests = barData.rests || [];
          if (rests.includes(beatIndex)) {
            beatSquare.classList.add("rested");
            beatSquare.classList.remove("ghost-note", "accent-note");
          } else {
            beatSquare.classList.remove("rested");
            const velocities = barData.velocities || {};
            const defaultVel = (beatIndex === 0) ? 1.0 : 0.7;
            const vel = velocities[beatIndex] !== undefined ? velocities[beatIndex] : defaultVel;
            beatSquare.classList.toggle("ghost-note", vel === 0.3);
            beatSquare.classList.toggle("accent-note", vel === 1.0);
          }
        });
      });
    });
  },
};

export default BarDisplayController;