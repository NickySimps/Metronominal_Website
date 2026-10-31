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
import { getVisualBeatSlots, getSlotInfo } from "./beatTiming.js";
import { beginEditTransaction, commitEditTransaction } from "./editHistory.js";
import { emitInteractionMotion } from "./interactionMotion.js";

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
let subdivisionShield = null;
let subdivisionTriggerElement = null;
let subdivisionKeydownHandler = null;
let subdivisionCanCommit = null;
const LONG_PRESS_DURATION = 200; // ms
const TOUCH_LONG_PRESS_DURATION = 350; // Require a deliberate touch hold instead of opening during a swipe
const POINTER_MOVE_THRESHOLD = 45; // pixels

function clearBeatSoundOverride(barData, beatIndex) {
  if (!barData?.beatSounds || typeof barData.beatSounds !== "object") return;
  delete barData.beatSounds[beatIndex];
  if (Object.keys(barData.beatSounds).length === 0) delete barData.beatSounds;
}

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

function applyBarLayout(barDiv, subdivision, totalSubBeats) {
  const subdivisionNumber = Number(subdivision);
  barDiv.classList.toggle("flex-subdivision", ![1, 2, 4].includes(subdivisionNumber));
  const columns = ![1, 2, 4].includes(subdivisionNumber)
    ? Math.max(1, Math.min(8, subdivisionNumber > 1 ? Math.ceil(subdivisionNumber) : Math.ceil(totalSubBeats)))
    : Math.min(4, Math.max(1, Math.ceil(totalSubBeats)));
  barDiv.style.setProperty("--beat-columns", String(columns));
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

function applySliceBadge(beatSquare, barData, slot) {
  const existingBadge = beatSquare.querySelector(".slice-count-badge");
  if (existingBadge) existingBadge.remove();
  beatSquare.removeAttribute("data-slice-count");
  // Shrinking subdivisions keeps the retiring squares until their exit
  // animation finishes; those decorative nodes no longer have logical slots.
  if (!slot && beatSquare.classList.contains("removing-beat-animation")) return;
  const count = Number(barData?.beatSlices?.[slot?.index]);
  if (!Number.isInteger(count) || count < 2) { if (/^\d+ slices$/.test(beatSquare.getAttribute("title") || "")) beatSquare.removeAttribute("title"); if (/^Beat \d+, \d+ slices$/.test(beatSquare.getAttribute("aria-label") || "")) beatSquare.removeAttribute("aria-label"); return; }
  const badge = document.createElement("span");
  badge.className = "slice-count-badge";
  badge.textContent = String(count);
  badge.setAttribute("aria-hidden", "true");
  beatSquare.appendChild(badge);
  beatSquare.dataset.sliceCount = String(count);
  beatSquare.title = `${count} slices`;
  beatSquare.setAttribute("aria-label", `Beat ${Number(slot.index) + 1}, ${count} slices`);
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
    if (beatSquare.closest('[data-range-selection]')) return;
    if (getBeatActionMode() !== 'edit') return;
    event.stopPropagation();
    applyBeatAction(beatSquare);
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

function cycleBeatSlice(trackIndex, barIndex, slotIndex) {
  const track = AppState.getTracks()[trackIndex];
  const bar = track?.barSettings?.[barIndex];
  if (!bar) return;
  const slot = getVisualBeatSlots(bar)[slotIndex];
  const sliceKey = slot?.index ?? slotIndex;
  const counts = [2, 3, 4, 6, 8, 16, 32];
  const current = Number(bar.beatSlices?.[sliceKey]) || 1;
  const next = counts[counts.indexOf(current) + 1] || 1;
  AppState.setBeatSlices(trackIndex, barIndex, sliceKey, next, sliceKey);
  AppState.setSelectedTrackIndex(trackIndex);
  AppState.setSelectedBarIndexInContainer(barIndex);
  BarDisplayController.updateBar(trackIndex, barIndex);
  sendState(AppState.getCurrentStateForPreset(true));
}

// One semantic action path for legacy taps/painting and assisted release.
function getBeatActionMode() {
  if (AppState.isSliceMode?.()) return 'slice';
  if (AppState.isRestMode()) return 'rest';
  if (AppState.isAccentMode()) return 'accent';
  return document.body.classList.contains('beat-edit-mode') ? 'edit' : 'normal';
}
function canActOnBeat() {
  return !AppState.isPlaying() && (!document.querySelector('#share-btn.connected') || window.isHost === true);
}
function applyBeatAction(beat, { mode = getBeatActionMode(), paint = null } = {}) {
  if (!canActOnBeat() || mode !== getBeatActionMode() || !beat?.isConnected || !beat.matches('.beat-square[data-beat-index]:not(.removing-beat-animation)')) return null;
  const visual = beat.closest('.bar-visual');
  if (!visual) return null;
  const trackIndex = Number(visual.dataset.containerIndex), barIndex = Number(visual.dataset.barIndex), beatIndex = Number(beat.dataset.beatIndex);
  const track = AppState.getTracks()[trackIndex], bar = track?.barSettings?.[barIndex];
  if (![trackIndex,barIndex,beatIndex].every(i=>Number.isInteger(i)&&i>=0) || !bar || !getVisualBeatSlots(bar)[beatIndex]) return null;
  if (mode === 'edit') {
    SoundSettingsModal.show(trackIndex, beat.classList.contains('main-beat-marker') ? 'mainBeatSound' : 'subdivisionSound', {barIndex,beatIndex});
    return {mode};
  }
  if (mode === 'slice') { cycleBeatSlice(trackIndex,barIndex,beatIndex); emitInteractionMotion(beat,'slice'); return {mode,action:'SLICE'}; }
  if (mode === 'rest' || mode === 'accent') {
    let rests = [...(bar.rests || [])], velocities = {...(bar.velocities || {})};
    let action, velocity;
    if (mode === 'rest') {
      action = paint?.action || (rests.includes(beatIndex) ? 'UNREST' : 'REST');
      rests = rests.filter(i=>i!==beatIndex);
      if (action === 'REST') rests.push(beatIndex);
      delete velocities[beatIndex];
    } else {
      action = 'ACCENT';
      const current = velocities[beatIndex] ?? (beatIndex === 0 ? 1 : .7);
      velocity = paint?.velocity ?? (current === .7 ? 1 : current === 1 ? .3 : .7);
      velocities[beatIndex] = velocity; rests = rests.filter(i=>i!==beatIndex);
    }
    const next = {...bar,rests,velocities};
    if (mode === 'rest') clearBeatSoundOverride(next,beatIndex);
    const barSettings = [...track.barSettings]; barSettings[barIndex] = next;
    AppState.updateTrack(trackIndex,{barSettings});
    BarDisplayController.updateBar(trackIndex,barIndex);
    sendState(AppState.getCurrentStateForPreset(true));
    emitInteractionMotion(beat,mode==='rest'?'rest':velocity<=.3?'ghost':'accent'); return {mode,action,velocity};
  }
  const selectionChanged = AppState.getSelectedTrackIndex() !== trackIndex || AppState.getSelectedBarIndexInContainer() !== barIndex;
  AppState.setSelectedTrackIndex(trackIndex);AppState.setSelectedBarIndexInContainer(barIndex);
  BarDisplayController.updateSelectionVisuals();BarControlsController.updateBeatControlsDisplay();
  if (selectionChanged && AppState.getSelectedTrackIndex() === trackIndex && AppState.getSelectedBarIndexInContainer() === barIndex) {
    emitInteractionMotion(beat.closest('.bar-visual'), 'select');
  }
  document.dispatchEvent(new CustomEvent('trackselectionchanged',{detail:{shouldScroll:false}}));
  sendState(AppState.getCurrentStateForPreset(true));
  return {mode};
}

function onBarPointerDown(event) {
  if (event.currentTarget.closest('[data-range-selection]')) return;
  if (event.button !== 0) return;

  event.preventDefault();
  longPressedBarElement = event.currentTarget;
  longPressInitialPosition = { x: event.clientX, y: event.clientY };
  lastPaintedBeatSquare = event.target.closest(".beat-square");

  if (!canActOnBeat()) { resetLongPressState(); return; }
  if (lastPaintedBeatSquare && ['rest','accent','slice'].includes(getBeatActionMode())) {
    const result = applyBeatAction(lastPaintedBeatSquare);
    dragPaintAction = result?.action; dragPaintTargetVel = result?.velocity;
  }

  const pressDuration = event.pointerType === "touch"
    ? TOUCH_LONG_PRESS_DURATION
    : LONG_PRESS_DURATION;
  longPressTimer = setTimeout(() => {
    isLongPressActive = true;
    longPressTimer = null;
    if (longPressedBarElement) {
      showSubdivisionSelector(longPressedBarElement);
    } else {
      resetLongPressState();
      cleanupPointerListeners();
    }
  }, pressDuration);

  window.addEventListener("pointermove", onWindowPointerMove);
  window.addEventListener("pointerup", onWindowPointerUp);
  window.addEventListener("pointercancel", onWindowPointerCancel);
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

        if (['rest','accent','slice'].includes(getBeatActionMode())) {
          applyBeatAction(beatSquare,{paint:{action:dragPaintAction,velocity:dragPaintTargetVel}});
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

async function applySubdivisionChange(containerIndex, barIndex, newSubdivision, feedback = null) {
    if (newSubdivision === null || isNaN(containerIndex) || isNaN(barIndex)) {
        return;
    }


    const wasPlaying = AppState.isPlaying();
    if (wasPlaying) {
        await MetronomeEngine.togglePlay();
    }

    const beforeSubdivision = AppState.getTracks()[containerIndex]?.barSettings?.[barIndex]?.subdivision;
    try { feedback?.beforeCommit(); } catch { /* Decoration cannot gate the native edit. */ }
    AppState.setSelectedTrackIndex(containerIndex);
    AppState.setSelectedBarIndexInContainer(barIndex);
    AppState.setSubdivisionForSelectedBar(newSubdivision);
    sendState(AppState.getCurrentStateForPreset(true));

    BarDisplayController.renderBarsAndControls(-1);
    BarControlsController.updateBeatControlsDisplay();

    const acceptedSubdivision = AppState.getTracks()[containerIndex]?.barSettings?.[barIndex]?.subdivision;
    if (acceptedSubdivision !== beforeSubdivision && Number(acceptedSubdivision) === Number(newSubdivision)) {
        try { feedback?.accepted(); } catch { /* Decoration never gates playback. */ }
    }

    if (wasPlaying && AppState.getBarSettings(containerIndex).length > 0) {
        await MetronomeEngine.togglePlay();
    }

    if (ThemeController.is3DSceneActive()) {
        ThemeController.update3DScenePostStateChange();
    }
}

let subdivisionFeedbackEpoch = 0;
document.addEventListener('roomauthoritychange', () => { subdivisionFeedbackEpoch++; });
document.addEventListener('syncrolechange', () => { subdivisionFeedbackEpoch++; });
function subdivisionOutcomeFeedback(option, containerIndex, barIndex) {
  const epoch = subdivisionFeedbackEpoch, canAcknowledge = subdivisionCanCommit;
  let validBeforeCommit = false;
  return {
    beforeCommit() {
      validBeforeCommit = epoch === subdivisionFeedbackEpoch && (!canAcknowledge || canAcknowledge());
    },
    accepted() {
      // The native edit owns its topology replacement. Do not revalidate its
      // pre-edit nodes afterward; authority lifetime must still be current.
      if (!validBeforeCommit || epoch !== subdivisionFeedbackEpoch) return;
      emitInteractionMotion(option?.isConnected ? option : document.querySelector(`.bar-visual[data-container-index="${containerIndex}"][data-bar-index="${barIndex}"]`), 'select');
    },
  };
}

async function selectSubdivisionOption(option) {
  if (subdivisionCanCommit && !subdivisionCanCommit()) { hideSubdivisionSelector(); return; }
  const newSubdivision = option?.dataset.value;
  const barIndex = parseInt(longPressedBarElement?.dataset.barIndex, 10);
  const containerIndex = parseInt(longPressedBarElement?.dataset.containerIndex, 10);
  if (newSubdivision && !isNaN(barIndex) && !isNaN(containerIndex)) {
    const transaction = subdivisionCanCommit ? beginEditTransaction("Subdivision") : null; if (subdivisionCanCommit && !transaction) { hideSubdivisionSelector(); cleanupPointerListeners(); resetLongPressState(); return; } try { await applySubdivisionChange(containerIndex, barIndex, newSubdivision, subdivisionOutcomeFeedback(option, containerIndex, barIndex)); } finally { if (transaction) commitEditTransaction(transaction); }
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
      if (AppState.getSelectedTrackIndex() === clickedContainerIndex && AppState.getSelectedBarIndexInContainer() === clickedBarIndex) {
        emitInteractionMotion(document.querySelector(`.bar-visual[data-container-index="${clickedContainerIndex}"][data-bar-index="${clickedBarIndex}"]`), 'select');
      }
    } else {
      sendState(AppState.getCurrentStateForPreset(true));
    }
  }

  cleanupPointerListeners();
  hideSubdivisionSelector();
  resetLongPressState();
}

function onWindowPointerCancel() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
  }
  cleanupPointerListeners();
  hideSubdivisionSelector();
  resetLongPressState();
}

function cleanupPointerListeners() {
  window.removeEventListener("pointermove", onWindowPointerMove);
  window.removeEventListener("pointerup", onWindowPointerUp);
  window.removeEventListener("pointercancel", onWindowPointerCancel);
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

function showSubdivisionSelector(barElement, { gesture = false, canCommit = null } = {}) {
    longPressedBarElement = barElement;
    const isAlreadyVisible = document.querySelector('.subdivision-options-container.visible');
    const visibleForThisBar = isAlreadyVisible && isAlreadyVisible.dataset.forBar === `${barElement.dataset.containerIndex}-${barElement.dataset.barIndex}`;
    
    hideSubdivisionSelector(); // Clear previous options first
    longPressedBarElement = barElement;
    subdivisionCanCommit = canCommit;
    
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
    barElement.setAttribute('tabindex', '0');
    barElement.setAttribute('aria-haspopup', 'menu');

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

    subdivisionShield?.remove();
    subdivisionShield = document.createElement("div");
    subdivisionShield.className = "subdivision-selector-shield";
    subdivisionShield.setAttribute("aria-hidden", "true");
    subdivisionShield.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      hideSubdivisionSelector();
    });
    subdivisionShield.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      hideSubdivisionSelector();
    });
    document.body.appendChild(subdivisionShield);

    const barRect = barElement.getBoundingClientRect();

    const createContainer = (subdivisions, position) => {
        if (subdivisions.length === 0) {
            return null;
        }
        const container = document.createElement('div');
        container.className = 'subdivision-options-container';
        container.setAttribute('role', 'menu');
        container.setAttribute('aria-label', 'Subdivision options');
        container.dataset.forBar = `${barElement.dataset.containerIndex}-${barElement.dataset.barIndex}`;
        container.classList.add(position === 'lower' ? 'lower-panel' : 'higher-panel');
        container.classList.add(position === 'lower' ? 'above' : 'below');
        
        subdivisions.forEach(optionData => {
            const element = document.createElement('div');
            element.className = 'subdivision-option';
            element.setAttribute('role', 'menuitem');
            element.setAttribute('tabindex', '0');
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
                if (subdivisionCanCommit && !subdivisionCanCommit()) { hideSubdivisionSelector(); return; }
                const option = element, newSubdivision = element.dataset.value;
                if (newSubdivision) {
                    const transaction = subdivisionCanCommit ? beginEditTransaction("Subdivision") : null; if (subdivisionCanCommit && !transaction) { hideSubdivisionSelector(); cleanupPointerListeners(); resetLongPressState(); return; } try { await applySubdivisionChange(containerIndex, barIndex, newSubdivision, subdivisionOutcomeFeedback(option, containerIndex, barIndex)); } finally { if (transaction) commitEditTransaction(transaction); }
                }
                hideSubdivisionSelector();
            });

            element.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    element.click();
                }
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
        container.style.top = `${barRect.top + barRect.height / 2}px`;
        container.style.transform = 'scale(0.9)';

        requestAnimationFrame(() => {
            if (!container.isConnected || subdivisionTriggerElement !== barElement) return; container.classList.add("visible");
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

    createContainer(lowerSubdivisions, 'lower');
    createContainer(higherSubdivisions, 'higher');
    requestAnimationFrame(() => {
        if (subdivisionTriggerElement !== barElement) return; const panels = [...document.querySelectorAll(`.subdivision-options-container[data-for-bar="${barElement.dataset.containerIndex}-${barElement.dataset.barIndex}"]`)].filter((panel) => panel.classList.contains('lower-panel') || panel.classList.contains('higher-panel'));
        const lower = panels.find((panel) => panel.classList.contains('lower-panel'));
        const higher = panels.find((panel) => panel.classList.contains('higher-panel'));
        if (!lower || !higher) return;
        const margin = 8;
        const gap = 8;
        const anchorX = barRect.left + barRect.width / 2;
        const anchorY = barRect.top + barRect.height / 2;
        const lowerRect = lower.getBoundingClientRect();
        const higherRect = higher.getBoundingClientRect();
        const maxTop = Math.max(margin, window.innerHeight - Math.max(lowerRect.height, higherRect.height) - margin);
        const top = Math.min(Math.max(margin, anchorY - Math.max(lowerRect.height, higherRect.height) / 2), maxTop);
        const lowerLeft = Math.min(Math.max(margin, anchorX - gap - lowerRect.width), window.innerWidth - margin - lowerRect.width);
        const higherLeft = Math.min(Math.max(margin, anchorX + gap), window.innerWidth - margin - higherRect.width);
        lower.style.left = `${lowerLeft}px`;
        higher.style.left = `${higherLeft}px`;
        lower.style.top = `${top}px`;
        higher.style.top = `${top}px`;
    });
    subdivisionTriggerElement = barElement;
    subdivisionKeydownHandler = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            hideSubdivisionSelector();
        }
    };
    document.addEventListener('keydown', subdivisionKeydownHandler);
    if (!gesture) requestAnimationFrame(() => { if (subdivisionTriggerElement === barElement) document.querySelector('.subdivision-options-container.visible .subdivision-option')?.focus(); });
}

let currentHideOnClickOutside = null;

function hideSubdivisionSelector({ restoreFocus = true, immediate = false } = {}) {
    const trigger = subdivisionTriggerElement;
    subdivisionCanCommit = null;
    subdivisionTriggerElement = null;
    if (subdivisionKeydownHandler) {
        document.removeEventListener('keydown', subdivisionKeydownHandler);
        subdivisionKeydownHandler = null;
    }
    if (currentHideOnClickOutside) {
        window.removeEventListener('click', currentHideOnClickOutside);
        currentHideOnClickOutside = null;
    }
    subdivisionShield?.remove();
    subdivisionShield = null;
    const containers = document.querySelectorAll('.subdivision-options-container');
    containers.forEach(container => {
        if (immediate || !container.classList.contains('visible')) { container.remove(); return; }
        container.classList.remove('visible');
        container.addEventListener('transitionend', () => {
            if (container.parentElement) {
                container.remove();
            }
        }, { once: true });
    });
    if (restoreFocus && trigger && trigger.isConnected) trigger.focus({ preventScroll: true });
}

// The precision owner calls semantic picker actions, never legacy pointer handlers.
function moveSubdivisionGesture(x, y) {
    let hit = null;
    for (const option of document.querySelectorAll('.subdivision-options-container .subdivision-option')) {
        const r = option.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) hit = option;
        option.classList.remove('hovered');
    }
    hoveredSubdivisionOption = hit;
    hit?.classList.add('hovered');
    // Panel padding and gaps still belong to the picker, even over the grid.
    return hit || [...document.querySelectorAll('.subdivision-options-container.visible')].find(panel => {
        const r = panel.getBoundingClientRect();
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }) || null;
}

function handleBeatSquareClick(event) {
  const beatSquare = event.currentTarget;
  const barDiv = beatSquare.closest(".bar-visual");

  if (!barDiv) {
    console.error("Could not find parent bar-visual for clicked beat square.");
    return;
  }

  const trackIndex = parseInt(barDiv.dataset.containerIndex, 10);
  const barIndex = parseInt(barDiv.dataset.barIndex, 10);
  const beatIndex = parseInt(beatSquare.dataset.beatIndex, 10);

  if (isNaN(trackIndex) || isNaN(barIndex) || isNaN(beatIndex)) {
    console.error("Invalid indices for beat square click:", { trackIndex, barIndex, beatIndex });
    return;
  }

  AppState.toggleBeatRest(trackIndex, barIndex, beatIndex);
  BarDisplayController.updateBar(trackIndex, barIndex); // Re-render the bar to update visuals
  sendState(AppState.getCurrentStateForPreset(true)); // Sync state via WebRTC
}

const BarDisplayController = {
    beginSubdivisionGesture: (bar, canCommit) => showSubdivisionSelector(bar, {gesture:true,canCommit}),
    moveSubdivisionGesture,
    commitSubdivisionGesture: () => hoveredSubdivisionOption ? selectSubdivisionOption(hoveredSubdivisionOption) : null,
    cancelSubdivisionGesture: () => { hideSubdivisionSelector({restoreFocus:false,immediate:true}); hoveredSubdivisionOption = null; },
    applyBeatAction,
    getBeatActionMode,
    canActOnBeat,
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

        updateBeatIndicator(barDiv, mainBeatsInBar, subdivision);

        const beatSlots = getVisualBeatSlots(barData);
        const totalSubBeatsNeeded = beatSlots.length;
        applyBarLayout(barDiv, subdivision, totalSubBeatsNeeded);
        const rests = barData.rests || [];

        for (let i = 0; i < totalSubBeatsNeeded; i++) {
            const slot = beatSlots[i];
            const isRested = rests.includes(i);
            const velocity = barData.velocities?.[i];
            const isIndividuallyEdited = hasBeatSoundOverride(barData.beatSounds?.[i]);
            const beatSquare = createBeatSquareElement(i, subdivision, mainBeatsInBar, isRested, velocity, isIndividuallyEdited);
            beatSquare.classList.toggle("main-beat-marker", Boolean(slot?.mainBeat));
            beatSquare.classList.toggle("subdivision", !slot?.mainBeat);
            beatSquare.dataset.sourceBeat = String(slot?.sourceBeat ?? i);
            applySliceBadge(beatSquare, barData, slot);
            barDiv.appendChild(beatSquare);
        }

        const allBeatSquares = barDiv.querySelectorAll(".beat-square:not(.removing-beat-animation)");
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

        updateBeatIndicator(barDiv, mainBeatsInBar, subdivision);

        const beatSlots = getVisualBeatSlots(barData);
        const totalSubBeatsNeeded = beatSlots.length;
        applyBarLayout(barDiv, subdivision, totalSubBeatsNeeded);
        const rests = barData.rests || [];

        const existingBeatSquares = Array.from(
            barDiv.querySelectorAll(".beat-square:not(.removing-beat-animation)")
        );
        const currentSubBeatCountInDom = existingBeatSquares.length;

        if (totalSubBeatsNeeded > currentSubBeatCountInDom) {
            for (let i = currentSubBeatCountInDom; i < totalSubBeatsNeeded; i++) {
                const slot = beatSlots[i];
                const isRested = rests.includes(i);
                const beatSquare = createBeatSquareElement(
                    i,
                    subdivision,
                    mainBeatsInBar,
                    isRested,
                    barData.velocities?.[i],
                    hasBeatSoundOverride(barData.beatSounds?.[i])
                );
                beatSquare.classList.toggle("main-beat-marker", Boolean(slot?.mainBeat));
                beatSquare.classList.toggle("subdivision", !slot?.mainBeat);
                beatSquare.dataset.sourceBeat = String(slot?.sourceBeat ?? i);
            applySliceBadge(beatSquare, barData, slot);
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
        const allBeatSquares = barDiv.querySelectorAll(".beat-square:not(.removing-beat-animation)");
        allBeatSquares.forEach((sq, beatIdx) => {
            updateBeatSquareClasses(sq, beatIdx, subdivision, mainBeatsInBar);
            applyBeatStateClasses(
              sq,
              beatIdx,
              rests.includes(beatIdx),
              barData.velocities?.[beatIdx],
              hasBeatSoundOverride(barData.beatSounds?.[beatIdx])
            );
            applySliceBadge(sq, barData, beatSlots[beatIdx]);
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
        const beatSlots = getVisualBeatSlots(barData);
        const totalSubBeatsNeeded = beatSlots.length;
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
        applyBarLayout(barDiv, subdivision, totalSubBeatsNeeded);
        
        updateBeatIndicator(barDiv, mainBeatsInBar, subdivision);

        barDiv.addEventListener("pointerdown", onBarPointerDown);

        if (isNewBarInstance) {
          for (let i = 0; i < totalSubBeatsNeeded; i++) {
            const slot = beatSlots[i];
            const isRested = rests.includes(i);
            const beatSquare = createBeatSquareElement(
                i,
                subdivision,
                mainBeatsInBar,
                isRested,
                barData.velocities?.[i],
                hasBeatSoundOverride(barData.beatSounds?.[i])
            );
            beatSquare.classList.toggle("main-beat-marker", Boolean(slot?.mainBeat));
            beatSquare.classList.toggle("subdivision", !slot?.mainBeat);
            beatSquare.dataset.sourceBeat = String(slot?.sourceBeat ?? i);
            applySliceBadge(beatSquare, barData, slot);
            barDiv.appendChild(beatSquare);
          }
        } else {
          const existingBeatSquares = Array.from(
            barDiv.querySelectorAll(".beat-square:not(.removing-beat-animation)")
          );
          const currentSubBeatCountInDom = existingBeatSquares.length;

          if (totalSubBeatsNeeded > currentSubBeatCountInDom) {
            for (let i = currentSubBeatCountInDom; i < totalSubBeatsNeeded; i++) {
              const slot = beatSlots[i];
              const isRested = rests.includes(i);
              const beatSquare = createBeatSquareElement(
                  i,
                  subdivision,
                  mainBeatsInBar,
                  isRested,
                  barData.velocities?.[i],
                  hasBeatSoundOverride(barData.beatSounds?.[i])
              );
              beatSquare.classList.toggle("main-beat-marker", Boolean(slot?.mainBeat));
              beatSquare.classList.toggle("subdivision", !slot?.mainBeat);
              beatSquare.dataset.sourceBeat = String(slot?.sourceBeat ?? i);
            applySliceBadge(beatSquare, barData, slot);
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
          const allBeatSquares = barDiv.querySelectorAll(".beat-square:not(.removing-beat-animation)");
          allBeatSquares.forEach((sq, beatIdx) => {
            updateBeatSquareClasses(sq, beatIdx, subdivision, mainBeatsInBar);
            applyBeatStateClasses(
              sq,
              beatIdx,
              rests.includes(beatIdx),
              barData.velocities?.[beatIdx],
              hasBeatSoundOverride(barData.beatSounds?.[beatIdx])
            );
            applySliceBadge(sq, barData, beatSlots[beatIdx]);
          });
        }

        const allBeatSquares = barDiv.querySelectorAll(".beat-square:not(.removing-beat-animation)");
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
      const barData = AppState.getTracks()[containerIndex]?.barSettings?.[barIndex];
      const playbackSlot = barData ? getSlotInfo(barData, beatIndex) : null;
      const visualIndex = playbackSlot?.baseIndex ?? beatIndex;
      const beatToHighlight = targetBarElement.querySelector(`.beat-square[data-beat-index="${visualIndex}"]`);
      if (beatToHighlight) {
        const wasAlreadyHighlighted = beatToHighlight.classList.contains("highlighted") || beatToHighlight.classList.contains("highlighted-sub");
        beatToHighlight.classList.remove("highlighted", "highlighted-sub");
        if (wasAlreadyHighlighted) void beatToHighlight.offsetWidth;
        beatToHighlight.classList.add("highlighted");
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