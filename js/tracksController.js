import AppState from "./appState.js";
import { beginInteractionHold, emitInteractionMotion } from "./interactionMotion.js";
import BarControlsController from "./barControlsController.js";
import { sendState } from "./webrtc.js";
import BarDisplayController from "./barDisplayController.js";
import SoundSettingsModal from "./soundSettingsModal.js";
import AudioController from "./audioController.js";
import SoundSynth from "./soundSynth.js";
import Monitoring from './monitoring.js';

function trackMotionSignature(index) {
  try {
    const track = AppState.getMusicalSnapshot().Tracks[index];
    return track ? JSON.stringify(track) : null;
  } catch { return null; }
}

function trackMotionChanged(index, before) {
  if (window.isHost === false || before === null) return false;
  const after = trackMotionSignature(index);
  return after !== null && after !== before;
}

function animateRangeValue(input, targetValue, duration = 300) {
  if (!input) return;
  const target = Number(targetValue);
  const start = Number(input.value);
  if (!Number.isFinite(target) || !Number.isFinite(start) || start === target) {
    input.value = String(targetValue);
    return;
  }
  let startTime = null;
  const step = currentTime => {
    if (startTime === null) startTime = currentTime;
    const progress = Math.min((currentTime - startTime) / duration, 1);
    input.value = String(start + (target - start) * progress);
    if (progress < 1) requestAnimationFrame(step);
    else input.value = String(targetValue);
  };
  requestAnimationFrame(step);
}

let activeSoundPicker = null;
let isBeatEditMode = false;

function syncModeControls() {
  const restActive = AppState.isRestMode();
  const accentActive = AppState.isAccentMode();
  const sliceActive = AppState.isSliceMode?.() || false;
  document.body.classList.toggle("slice-mode", sliceActive);
  document.body.classList.toggle("beat-edit-mode", isBeatEditMode);
  document.querySelectorAll(".beat-edit-btn").forEach(button => {
    button.classList.toggle("active", isBeatEditMode);
    button.setAttribute("aria-pressed", String(isBeatEditMode));
  });
  document.querySelectorAll(".slice-btn").forEach(button => {
    button.classList.toggle("active", sliceActive);
    button.setAttribute("aria-pressed", String(sliceActive));
  });
  document.querySelectorAll(".rest-button").forEach(button => button.classList.toggle("active", restActive));
  document.querySelectorAll(".accent-button").forEach(button => button.classList.toggle("active", accentActive));
  document.querySelectorAll(".sub-sound-label").forEach(label => label.classList.toggle("rest-mode-active", restActive));
  document.querySelectorAll(".bar-visual").forEach(bar => {
    bar.classList.toggle("rest-mode-active", restActive);
    bar.classList.toggle("accent-mode-active", accentActive);
    bar.classList.toggle("slice-mode-active", sliceActive);
  });
}

function setExclusiveEditMode(mode) {
  if (mode === "rest") {
    isBeatEditMode = false;
    AppState.setAccentMode(false);
    AppState.setSliceMode?.(false);
  } else if (mode === "accent") {
    isBeatEditMode = false;
    AppState.setRestMode(false);
    AppState.setSliceMode?.(false);
  } else if (mode === "beat") {
    AppState.setRestMode(false);
    AppState.setAccentMode(false);
    AppState.setSliceMode?.(false);
  } else if (mode === "slice") {
    isBeatEditMode = false;
    AppState.setRestMode(false);
    AppState.setAccentMode(false);
  }
  syncModeControls();
}

function getSoundOptions() {
  const synthSounds = [
    "Synth Kick", "Synth Snare", "Synth Clap", "Synth HiHat", "Synth Open HiHat",
    "Synth Shaker", "Synth Claves", "Synth Hi Tom", "Synth Mid Tom", "Synth Low Tom",
    "Synth Cymbal", "Synth Cowbell", "Synth Woodblock", "Synth Triangle", "Synth Maraca",
    "Synth Sine", "Synth Square", "Synth Sawtooth", "Synth Ultrasaw", "Synth Noise",
  ];
  const editedSounds = AppState.getCustomSounds();
  const recordings = AppState.getRecordings();
  const stockSamples = ["Click1.mp3", "Click2.mp3", "Crank1.mp3", "Crank2.mp3"];
  return [
    { id: "synth", label: "Synth Sounds", description: "Built-in synthesized drum and tone voices.", sounds: synthSounds },
    { id: "edited", label: "Edited Sounds", description: "Your saved sound-editor presets.", sounds: editedSounds },
    { id: "recordings", label: "Recordings", description: "Sounds captured with the loop recorder.", sounds: recordings.filter((name) => /^Recording\s/i.test(name)) },
    { id: "uploaded", label: "Uploaded Tracks", description: "Imported audio and bundled sample tracks.", sounds: [...stockSamples, ...recordings.filter((name) => !/^Recording\s/i.test(name))] },
  ].filter((group) => group.sounds.length > 0);
}

function displaySoundName(soundName) {
  return soundName.replace(".mp3", "").replace("Synth ", "");
}

async function previewSound(soundName) {
  const audioContext = AppState.getAudioContext();
  if (!audioContext) return;
  if (audioContext.state === "suspended") await audioContext.resume();
  const customData = AppState.getCustomSoundData(soundName);
  const baseSound = customData?.baseSound || soundName;
  const settings = { ...(AppState.getDefaultSoundSettings(soundName) || customData?.settings || {}), volume: 0.8 };
  const playTime = audioContext.currentTime + 0.01;
  const destination = Monitoring.getTrackOutput(audioContext, activeSoundPicker?.trackIndex);
  if (baseSound.startsWith("Synth")) {
    const synthFunctionName = `play${baseSound.replace("Synth ", "").replace(/ /g, "")}`;
    if (!SoundSynth[synthFunctionName]) return false;
    SoundSynth[synthFunctionName](audioContext, playTime, settings, destination);
    return true;
  } else if (AppState.getSoundBuffer(baseSound)) {
    const voiceKey = settings.voiceKey || baseSound;
    const previousSource = AudioController.activeRecordingSources.get(voiceKey);
    AudioController.playRecording(baseSound, settings, settings.trimStart || 0, settings.trimEnd || null, playTime, 0.8, destination);
    const source = AudioController.activeRecordingSources.get(voiceKey);
    return Boolean(source && source !== previousSource);
  }
  return false;
}

function closeSoundPicker() {
  const pickerModal = document.getElementById("sound-picker-modal");
  if (pickerModal && !pickerModal.hidden && pickerModal.style.display !== "none") {
    emitInteractionMotion(pickerModal.querySelector(".modal-content") || pickerModal, "close");
  }
  const modal = document.getElementById("sound-picker-modal");
  if (!modal) return;
  modal.hidden = true;
  modal.style.display = "none";
  activeSoundPicker = null;
}

function openSoundPicker(trackIndex, soundType) {
  const modal = document.getElementById("sound-picker-modal");
  const optionsRoot = document.getElementById("sound-picker-options");
  if (!modal || !optionsRoot) return;
  activeSoundPicker = { trackIndex, soundType };
  const selected = AppState.getTracks()[trackIndex]?.[soundType]?.sound;
  document.getElementById("sound-picker-context").textContent = `Track ${trackIndex + 1} · ${soundType === "mainBeatSound" ? "Main beat" : "Subdivision"}`;
  optionsRoot.innerHTML = "";
  getSoundOptions().forEach((group) => {
    const section = document.createElement("section");
    section.className = `sound-picker-group sound-picker-group-${group.id}`;
    section.innerHTML = `<h3>${group.label}</h3><p>${group.description}</p>`;
    const grid = document.createElement("div");
    grid.className = "sound-picker-grid";
    group.sounds.forEach((soundName) => {
      const card = document.createElement("div");
      card.className = `sound-picker-card${soundName === selected ? " selected" : ""}`;
      card.dataset.sound = soundName;
      card.innerHTML = `<button type="button" class="sound-picker-select" aria-pressed="${soundName === selected}">${displaySoundName(soundName)}</button><button type="button" class="sound-picker-preview" aria-label="Preview ${displaySoundName(soundName)}">▶</button>`;
      grid.appendChild(card);
    });
    section.appendChild(grid);
    optionsRoot.appendChild(section);
  });
  modal.hidden = false;
  modal.style.display = "flex";
  document.querySelector(".sound-picker-select[aria-pressed=\"true\"]")?.focus();
  emitInteractionMotion(modal.querySelector(".modal-content") || modal, "open");
}


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
      <span class="track-name">${track.name || `Track ${index + 1}`}</span>
      <button class="record-btn track-record-btn ${AppState.isRecording() ? 'active' : ''}" aria-label="Toggle recording" title="Toggle Recording"><span class="control-icon" aria-hidden="true">●</span><span class="record-label">Rec</span></button>
      <button class="track-mute-btn" title="${track.muted ? "Unmute track" : "Mute track"}"
        aria-label="${track.muted ? "Unmute track" : "Mute track"}" aria-pressed="${track.muted}">⍉</button>
      <button class="track-solo-btn" title="${track.solo ? "Unsolo track" : "Solo track"}"
        aria-pressed="${track.solo}">${track.solo ? "Unsolo" : "Solo"}</button>
      <button class="track-remove-btn" title="Remove track" aria-label="Remove track">✖</button>
      <div class="track-volume-controls">
        <span class="track-volume-label"><span class="volume-label-text">Vol:</span><svg class="volume-icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M4 9v6h4l5 4V5L8 9H4Zm12.5 3a4.5 4.5 0 0 0-2.5-4.03v8.06A4.5 4.5 0 0 0 16.5 12Zm0-8.5v2.1A7 7 0 0 1 20 12a7 7 0 0 1-3.5 6.4v2.1A9 9 0 0 0 22 12a9 9 0 0 0-5.5-8.5Z"/></svg></span>
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
      <button class="rest-button"><span class="control-icon" aria-hidden="true">○</span> <span class="mode-label">Rest</span></button>
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

  // Update solo/muted state classes and button affordances (glyphs are static;
  // state reads through .muted/.soloed styling and ARIA).
  trackElement.classList.toggle("soloed", track.solo);
  trackElement.classList.toggle("muted", track.muted);
  const muteBtn = trackElement.querySelector(".track-mute-btn");
  muteBtn.title = muteBtn.ariaLabel = track.muted ? "Unmute track" : "Mute track";
  muteBtn.setAttribute("aria-pressed", String(track.muted));
  const soloBtn = trackElement.querySelector(".track-solo-btn");
  soloBtn.textContent = track.solo ? "Unsolo" : "Solo";
  soloBtn.title = track.solo ? "Unsolo track" : "Solo track";
  soloBtn.setAttribute("aria-pressed", String(track.solo));

  // Update track name
  trackElement.querySelector(".track-name").textContent = track.name || `Track ${index + 1}`;

  // Update volume slider and display
  trackElement.querySelector(".track-volume-slider").value = track.volume;
  trackElement.querySelector(".track-volume-value").textContent = `${(
    track.volume * 100
  ).toFixed(0)}%`;

  // Update sound selectors
  const mainSoundButton = trackElement.querySelector(".main-beat-sound-select");
  const subSoundButton = trackElement.querySelector(".subdivision-sound-select");
  mainSoundButton.dataset.sound = track.mainBeatSound.sound;
  mainSoundButton.textContent = displaySoundName(track.mainBeatSound.sound);
  subSoundButton.dataset.sound = track.subdivisionSound.sound;
  subSoundButton.textContent = displaySoundName(track.subdivisionSound.sound);

  // Update rest button active state
  trackElement.querySelector(".rest-button").classList.toggle("active", AppState.isRestMode());

  // The bar-display-container's data-container-index also needs updating
  const barDisplayContainer = trackElement.querySelector(
    ".bar-display-container"
  );
  if (barDisplayContainer) barDisplayContainer.dataset.containerIndex = index;
}

let songWhipTimer = null;
let songMobileSwoopTimer = null;
let actionHoldDecoration = null;

function ensureTrackActionModal() {
  let modal = document.getElementById("track-action-modal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "track-action-modal";
  modal.className = "modal track-action-modal";
  modal.hidden = true;
  modal.innerHTML = `<div class="modal-content track-action-modal-content" role="dialog" aria-modal="true" aria-labelledby="track-action-modal-title">
    <div class="modal-header"><h2 id="track-action-modal-title"></h2><button type="button" class="modal-close" data-track-action-close aria-label="Close">×</button></div>
    <p class="track-action-modal-description"></p><div class="track-action-options" role="group" aria-label="Track parameters"></div>
    <div class="modal-actions"><button type="button" data-track-action-cancel>Cancel</button><button type="button" class="primary" data-track-action-apply>Apply</button></div>
  </div>`;
  document.body.appendChild(modal);
  const close = () => {
    if (!modal.hidden) {
      emitInteractionMotion(modal.querySelector(".modal-content") || modal, "close");
    }
    modal.hidden = true;
    modal.classList.remove("is-open");
  };
  modal.querySelector("[data-track-action-close]").addEventListener("click", close);
  modal.querySelector("[data-track-action-cancel]").addEventListener("click", close);
  modal.addEventListener("click", event => { if (event.target === modal) close(); });
  modal.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
  return modal;
}

const TRACK_ACTION_OPTIONS = [
  ["track", "Track controls", "Mute, solo, volume, pitch, and swing", [["muted", "Mute"], ["solo", "Solo"], ["volume", "Volume"], ["pitchShift", "Pitch"], ["swing", "Swing"]]],
  ["mainSound", "Main sound", "Main sound selection and editor parameters", [["sound", "Sound"], ["settings", "Sound settings"]]],
  ["subSound", "Subdivision sound", "Subdivision sound selection and editor parameters", [["sound", "Sound"], ["settings", "Sound settings"]]],
  ["structure", "Bar structure", "Number of beats, bar count, and base subdivision", [["beats", "Beats"], ["bars", "Bars"], ["subdivision", "Subdivision"]]],
  ["pattern", "Beat pattern", "Rests, accents, ghost notes, dynamics, and slices", [["rests", "Rests"], ["accents", "Accents"], ["velocities", "Dynamics"], ["slices", "Slices"]]],
  ["beatSounds", "Beat-specific overrides", "Per-beat edited sounds and settings", [["sounds", "Edited sounds"], ["settings", "Override settings"]]],
];

function optionEnabled(options, group, item) {
  return options?.[group] === true || options?.[group]?.[item] === true;
}

function randomizeTrack(trackIndex, options) {
  const track = AppState.getTracks()[trackIndex];
  if (!track) return;
  if (optionEnabled(options, "track", "volume") || optionEnabled(options, "track", "pitchShift") || optionEnabled(options, "track", "swing")) {
    AppState.updateTrack(trackIndex, {
      ...(optionEnabled(options, "track", "volume") ? { volume: Math.random() } : {}),
      ...(optionEnabled(options, "track", "pitchShift") ? { pitchShift: Math.round(Math.random() * 24) - 12 } : {}),
      ...(optionEnabled(options, "track", "swing") ? { swing: Math.round(Math.random() * 100) } : {}),
    });
  }
  if (optionEnabled(options, "structure", "beats") || optionEnabled(options, "structure", "subdivision")) track.barSettings.forEach(bar => {
    if (optionEnabled(options, "structure", "beats")) bar.beats = 2 + Math.floor(Math.random() * 7);
    if (optionEnabled(options, "structure", "subdivision")) bar.subdivision = [1, 2, 3, 4][Math.floor(Math.random() * 4)];
  });
  track.barSettings.forEach(bar => {
    const total = Math.max(1, Math.round((bar.beats || 4) * (bar.subdivision || 1)));
    if (optionEnabled(options, "pattern", "rests") || optionEnabled(options, "pattern", "velocities")) {
      if (optionEnabled(options, "pattern", "rests")) bar.rests = [];
      if (optionEnabled(options, "pattern", "velocities")) bar.velocities = {};
      for (let i = 0; i < total; i += 1) { const roll = Math.random(); if (optionEnabled(options, "pattern", "rests") && roll < .18) bar.rests.push(i); else if (optionEnabled(options, "pattern", "velocities")) bar.velocities[i] = roll < .42 ? 1 : roll < .6 ? .3 : undefined; }
      bar.velocities = Object.fromEntries(Object.entries(bar.velocities || {}).filter(([, value]) => value !== undefined));
    }
    if (optionEnabled(options, "beatSounds", "sounds") || optionEnabled(options, "beatSounds", "settings")) bar.beatSounds = {};
    const randomizeSlices = optionEnabled(options, "pattern", "slices");
    if (randomizeSlices) {
      const sliceCounts = [2, 3, 4, 6, 8, 16, 32];
      bar.beatSlices = {};
      bar.beatSliceAnchors = {};
      for (let i = 0; i < total; i += 1) {
        if (Math.random() < 0.24) {
          const count = sliceCounts[Math.floor(Math.random() * sliceCounts.length)];
          bar.beatSlices[i] = count;
          bar.beatSliceAnchors[i] = i;
        }
      }
      if (Object.keys(bar.beatSlices).length === 0) delete bar.beatSlices;
      if (Object.keys(bar.beatSliceAnchors).length === 0) delete bar.beatSliceAnchors;
    }
  });
  for (const [key, group] of [["mainBeatSound", "mainSound"], ["subdivisionSound", "subSound"]]) {
    if (!optionEnabled(options, group, "settings")) continue;
    const settings = track[key]?.settings || {};
    if (typeof settings.volume === "number") settings.volume = Math.random();
    if (typeof settings.pitchShift === "number") settings.pitchShift = Math.round(Math.random() * 24) - 12;
    if (typeof settings.highPassFrequency === "number") settings.highPassFrequency = Math.round(20 + Math.random() * 1980);
    if (typeof settings.lowPassFrequency === "number") settings.lowPassFrequency = Math.round(4000 + Math.random() * 16000);
  }
}

function openTrackActionModal(type, trackIndex) {
  const modal = ensureTrackActionModal();
  const isReset = type === "reset";
  modal.dataset.actionType = type;
  modal.dataset.trackIndex = String(trackIndex);
  modal.querySelector("#track-action-modal-title").textContent = isReset ? "Reset track" : "Randomize track";
  modal.querySelector(".track-action-modal-description").textContent = isReset ? "Choose which track parameters should return to their defaults." : "Choose which track parameters are allowed to change randomly.";
  modal.querySelector(".track-action-options").innerHTML = TRACK_ACTION_OPTIONS.map(([id, label, description, children]) => `<details class="track-action-group" open><summary class="track-action-option track-action-group-summary"><input type="checkbox" data-track-option="${id}" checked><span><strong>${label}</strong><small>${description}</small></span></summary><div class="track-action-suboptions">${children.map(([childId, childLabel]) => `<label class="track-action-suboption"><input type="checkbox" data-track-option="${id}.${childId}" data-track-parent="${id}" checked><span>${childLabel}</span></label>`).join("")}</div></details>`).join("");
  modal.querySelectorAll("[data-track-option]").forEach(input => input.addEventListener("change", event => {
    const target = event.currentTarget;
    if (target.dataset.trackParent) {
      const parent = modal.querySelector(`[data-track-option="${target.dataset.trackParent}"]`);
      const children = modal.querySelectorAll(`[data-track-parent="${target.dataset.trackParent}"]`);
      parent.checked = [...children].every(child => child.checked);
      emitInteractionMotion(target, "toggle");
    } else {
      modal.querySelectorAll(`[data-track-parent="${target.dataset.trackOption}"]`).forEach(child => { child.checked = target.checked; });
      emitInteractionMotion(target, "toggle");
    }
  }));
  modal.hidden = false;
  modal.classList.add("is-open");
  modal.querySelector("[data-track-action-apply]").onclick = () => {
    const selected = {};
    modal.querySelectorAll("[data-track-option]").forEach(input => {
      if (input.dataset.trackParent) {
        selected[input.dataset.trackParent] = selected[input.dataset.trackParent] && typeof selected[input.dataset.trackParent] === "object"
          ? selected[input.dataset.trackParent]
          : {};
        selected[input.dataset.trackParent][input.dataset.trackOption.split(".").slice(1).join(".")] = input.checked;
      } else {
        selected[input.dataset.trackOption] = input.checked;
      }
    });
    const before = trackMotionSignature(trackIndex);
    if (isReset) AppState.resetTrack(trackIndex, {
      track: selected.track,
      sounds: { main: selected.mainSound, sub: selected.subSound },
      structure: selected.structure,
      pattern: selected.pattern,
      beatSounds: selected.beatSounds,
    });
    else randomizeTrack(trackIndex, selected);
    if (trackMotionChanged(trackIndex, before)) {
      emitInteractionMotion(
        modal.querySelector("[data-track-action-apply]"),
        isReset ? "reset" : "randomize"
      );
    }
    sendState(AppState.getCurrentStateForPreset(true));
    TrackController.renderTracks();
    emitInteractionMotion(modal.querySelector("[data-track-action-apply]"), "close");
    modal.hidden = true;
    modal.classList.remove("is-open");
  };
  modal.querySelector("[data-track-action-close]").focus();
  emitInteractionMotion(modal.querySelector(".modal-content") || modal, "open");
}

function setSongTransitionDuration(wrapper, tempo) {
  const safeTempo = Math.max(20, Number(tempo) || 120);
  const duration = Math.min(250, 60000 / safeTempo / 4);
  wrapper.style.setProperty("--song-transition-duration", `${duration}ms`);
  wrapper.style.setProperty("--song-whip-out-duration", `${duration * 0.5}ms`);
  wrapper.style.setProperty("--song-whip-in-duration", `${duration * 0.5}ms`);
  return duration;
}

function animateSongTrackWhip(event) {
  const wrapper = document.getElementById("all-tracks-wrapper");
  if (!wrapper || !window.matchMedia("(min-width: 769px) and (pointer: fine)").matches) return;
  const nextCount = Number(event.detail?.trackCount);
  if (!Number.isFinite(nextCount)) return;

  if (songWhipTimer) window.clearTimeout(songWhipTimer);
  wrapper.classList.remove("song-whip-in", "song-whip-out", "song-whip-wrap");
  const duration = setSongTransitionDuration(wrapper, event.detail?.tempo || AppState.getTempo?.());
  const outDuration = duration * 0.3;
  const inDuration = duration - outDuration;
  wrapper.classList.add(event.detail?.sectionIndex === 0 ? "song-whip-wrap" : "song-whip-out");
  songWhipTimer = window.setTimeout(() => {
    TrackController.renderTracks();
    wrapper.classList.remove("song-whip-out", "song-whip-wrap");
    wrapper.classList.add("song-whip-in");
    songWhipTimer = window.setTimeout(() => {
      wrapper.classList.remove("song-whip-in");
      songWhipTimer = null;
    }, inDuration);
  }, outDuration);
}
const TrackController = {
  longPressTimer: null,
  actionLongPressTimer: null,
  actionLongPressTriggered: false,

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
      trackWrapper.addEventListener("pointerdown", TrackController.handleActionPointerDown);
      trackWrapper.addEventListener("pointerup", TrackController.handleActionPointerUp);
      trackWrapper.addEventListener("pointercancel", TrackController.handleActionPointerUp);
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
    document.addEventListener("songtracksectionchange", (event) => {
      const isDesktopFinePointer = window.matchMedia("(min-width: 769px) and (pointer: fine)").matches;
      const nextCount = Number(event.detail?.trackCount);
      const wrapper = document.getElementById("all-tracks-wrapper");
      if (isDesktopFinePointer) {
        animateSongTrackWhip(event);
        return;
      }
      if (songMobileSwoopTimer) window.clearTimeout(songMobileSwoopTimer);
      if (!wrapper) return;
      const duration = setSongTransitionDuration(wrapper, event.detail?.tempo || AppState.getTempo?.());
      wrapper.classList.remove("song-mobile-swoop");
      void wrapper.offsetWidth;
      wrapper.classList.add("song-mobile-swoop");
      TrackController.renderTracks();
      songMobileSwoopTimer = window.setTimeout(() => {
        wrapper.classList.remove("song-mobile-swoop");
        songMobileSwoopTimer = null;
      }, duration);
    });
    document.addEventListener("soundSaved", () => {
        TrackController.renderTracks();
    });
    document.getElementById("sound-picker-close")?.addEventListener("click", closeSoundPicker);
    document.getElementById("sound-picker-bottom-close")?.addEventListener("click", closeSoundPicker);
    document.getElementById("sound-picker-options")?.addEventListener("click", async (event) => {
      const card = event.target.closest(".sound-picker-card");
      if (!card) return;
      event.stopPropagation();
      if (event.target.closest(".sound-picker-preview")) {
        let accepted = false;
        try { accepted = await previewSound(card.dataset.sound); }
        catch { /* Native resume/source failures are meaningful audition refusals. */ }
        emitInteractionMotion(event.target.closest(".sound-picker-preview"), accepted ? "audition" : "refuse");
        return;
      }
      if (!event.target.closest(".sound-picker-select") || !activeSoundPicker) return;
      const { trackIndex, soundType } = activeSoundPicker;
      const newSound = card.dataset.sound;
      const before = trackMotionSignature(trackIndex);
      const defaultSettings = AppState.getDefaultSoundSettings(newSound);
      AppState.updateTrack(trackIndex, {
        [soundType]: { sound: newSound, settings: defaultSettings ? { ...defaultSettings } : {} },
      });
      sendState(AppState.getCurrentStateForPreset(true));
      if (trackMotionChanged(trackIndex, before) && AppState.getTracks()[trackIndex]?.[soundType]?.sound === newSound) {
        emitInteractionMotion(event.target.closest(".sound-picker-select"), "select");
      }
      closeSoundPicker();
      TrackController.renderTracks();
    });
    document.getElementById("sound-picker-modal")?.addEventListener("click", (event) => {
      if (event.target.id === "sound-picker-modal") closeSoundPicker();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && activeSoundPicker) closeSoundPicker();
    });
    TrackController.renderTracks();
  },

  /**
   * Renders all tracks from the application state into the DOM.
   */
  renderTracks: () => {
    const tracks = AppState.getTracks();
    Monitoring.syncTracks(tracks);
    const trackWrapper = document.getElementById("all-tracks-wrapper");
    if (!trackWrapper) return;

    const previousSliderValues = new Map(
      [...trackWrapper.querySelectorAll("input[type=range]")].map(input => [input.id, input.value])
    );
    trackWrapper.innerHTML = ""; // Clear existing track elements

    const sliceActive = AppState.isSliceMode?.() || false;
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

      const isSelected = index === AppState.getSelectedTrackIndex();
      if (isSelected) {
        trackElement.classList.add("selected");
      }

      trackElement.innerHTML = `
        <div class="track-controls">
          <span class="track-name">${track.name || `Track ${index + 1}`}</span>
          <button class="record-btn track-record-btn ${AppState.isRecording() ? 'active' : ''}" aria-label="Toggle recording" title="Toggle Recording"><span class="control-icon" aria-hidden="true">●</span><span class="record-label">Rec</span></button>
          <button class="track-mute-btn"
            title="${track.muted ? "Unmute track" : "Mute track"}"
            aria-label="${track.muted ? "Unmute track" : "Mute track"}"
            aria-pressed="${track.muted}">⍉</button>
          <button class="track-solo-btn"
            title="${track.solo ? "Unsolo track" : "Solo track"}"
            aria-pressed="${track.solo}">${track.solo ? "Unsolo" : "Solo"}</button>
          <button class="track-remove-btn" title="Remove track" aria-label="Remove track">✖</button>
        </div>
        <div class="track-action-row" aria-label="Track actions">
          <button class="duplicate-track-btn" type="button" title="Duplicate track"><span class="control-icon" aria-hidden="true">⧉</span> Track</button>
          <button class="duplicate-bar-btn" type="button" title="Duplicate selected bar"><span class="control-icon" aria-hidden="true">⧉</span> Bar</button>
          <button class="track-reset-btn" type="button" title="Reset track settings">↺ Reset</button>
          <button class="random-btn" type="button" aria-label="Randomize pattern" title="Randomize track"><span class="control-icon" aria-hidden="true">↻</span> Rand</button>
        </div>
        <div class="track-volume-controls">
          <span class="track-volume-label"><span class="volume-label-text">Vol:</span><svg class="volume-icon" aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M4 9v6h4l5 4V5L8 9H4Zm12.5 3a4.5 4.5 0 0 0-2.5-4.03v8.06A4.5 4.5 0 0 0 16.5 12Zm0-8.5v2.1A7 7 0 0 1 20 12a7 7 0 0 1-3.5 6.4v2.1A9 9 0 0 0 22 12a9 9 0 0 0-5.5-8.5Z"/></svg></span>
          <input type="range" id="track-volume-${index}" class="track-volume-slider" min="0" max="1" step="0.01" value="${track.volume ?? 1.0}" title="Track Volume">
          <span class="track-slider-value track-volume-value">${((track.volume ?? 1) * 100).toFixed(0)}%</span>
        </div>
        <div class="track-sound-controls">
          <div class="edit-buttons-col">
            <span class="sound-label main-sound-label">✎ Main</span>
            <span class="sound-label sub-sound-label">✎ Sub</span>
          </div>
          <div class="sound-selectors-col">
            <div class="sound-selection main-sound-selection"></div>
            <div class="sound-selection sub-sound-selection"></div>
          </div>
          <div class="mode-buttons-col">
            <button class="rest-button ${AppState.isRestMode() ? 'active' : ''}" aria-label="Toggle rest mode" title="Toggle Rest Mode"><span class="control-icon" aria-hidden="true">○</span> <span class="mode-label">Rest</span></button>
                      <button class="accent-button ${AppState.isAccentMode() ? 'active' : ''}" aria-label="Toggle accent mode" title="Toggle Accent & Ghost Note Mode"><span class="control-icon" aria-hidden="true">▲</span> <span class="mode-label">Accent</span></button>
                      <button class="beat-edit-btn ${isBeatEditMode ? 'active' : ''}" aria-label="Toggle Beat Edit mode" aria-pressed="${isBeatEditMode}" title="Click a beat to edit its sound"><span class="control-icon" aria-hidden="true">✎</span> <span class="mode-label">Beat</span></button>
                      <button class="slice-btn ${sliceActive ? 'active' : ''}" aria-label="Toggle Slice mode" aria-pressed="${sliceActive}" title="Slice a beat into glitch stutters"><span class="control-icon" aria-hidden="true">⫽</span> <span class="mode-label">Slice</span></button>
          </div>
        </div>
        <div class="track-bottom-sliders-row">
          <div class="track-slider-row track-pitch-group">
            <span class="track-slider-label">Pitch:</span>
            <input type="range" id="track-pitch-${index}" class="track-pitch-slider" min="-12" max="12" step="1" value="${track.pitchShift ?? 0}" title="Track Pitch (Semitones)">
            <span class="track-slider-value track-pitch-value">${(track.pitchShift ?? 0) > 0 ? '+' : ''}${track.pitchShift ?? 0}st</span>
          </div>
          <div class="track-slider-row track-swing-group">
            <span class="track-slider-label">Swing:</span>
            <input type="range" id="track-swing-${index}" class="track-swing-slider" min="0" max="100" step="1" value="${track.swing ?? 0}" title="Track Swing / Humanize">
            <span class="track-slider-value track-swing-value">${track.swing ?? 0}%</span>
          </div>
        </div>
        <div class="bar-display-container" data-container-index="${index}"></div>
        <div class="measures-container ${isSelected ? 'showing' : 'hidden'}">
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
        ".main-sound-selection"
      );
      const subSoundSelectorContainer = trackElement.querySelector(
        ".sub-sound-selection"
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
      for (const slider of trackElement.querySelectorAll("input[type=range]")) {
        const previousValue = previousSliderValues.get(slider.id);
        if (previousValue !== undefined && previousValue !== slider.value) {
          const targetValue = slider.value;
          slider.value = previousValue;
          animateRangeValue(slider, targetValue);
        }
      }

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
    // Buttons contain inner icon spans, so resolve the intended control from
    // the nearest matching ancestor instead of relying on event.target alone.
    const target = event.target.closest(
      ".track-mute-btn, .track-solo-btn, .track-remove-btn, .rest-button, .record-btn, .beat-edit-btn, .slice-btn, .duplicate-track-btn, .duplicate-bar-btn, .track-reset-btn, .random-btn"
    ) || event.target;
    const trackElement = target.closest(".track");

    if (!trackElement) return;

    const containerIndex = parseInt(trackElement.dataset.containerIndex, 10);

    const updateSelectionUI = (shouldScroll = true) => {
        const allSelectedTracks = document.querySelectorAll('.track.selected');
        allSelectedTracks.forEach(prevTrack => {
            if (prevTrack !== trackElement) {
                prevTrack.classList.remove('selected');
                const prevMeasuresContainer = prevTrack.querySelector('.measures-container');
                if (prevMeasuresContainer) {
                    prevMeasuresContainer.classList.remove('showing');
                    prevMeasuresContainer.classList.add('hiding');
                    prevMeasuresContainer.addEventListener('transitionend', () => {
                        prevMeasuresContainer.classList.remove('hiding');
                        prevMeasuresContainer.classList.add('hidden');
                    }, { once: true });
                }
            }
        });

        if (!trackElement.classList.contains('selected')) {
            trackElement.classList.add('selected');
            const measuresContainer = trackElement.querySelector('.measures-container');
            if (measuresContainer) {
                measuresContainer.classList.remove('hidden');
                measuresContainer.classList.add('showing');
            }
        }

        sendState(AppState.getCurrentStateForPreset(true));

        setTimeout(() => {
            document.dispatchEvent(new CustomEvent("trackselectionchanged", { detail: { shouldScroll } }));
        }, 0);
    };

    if (target.matches(".track-name")) {
      event.stopPropagation();
      updateSelectionUI(false);
      const track = AppState.getTracks()[containerIndex];
      const input = document.createElement("input");
      input.type = "text";
      input.className = "track-name-input";
      input.value = track?.name || `Track ${containerIndex + 1}`;
      input.maxLength = 64;
      input.setAttribute("aria-label", "Track name");
      target.replaceWith(input);
      input.focus();
      input.select();

      let finished = false;
      const finishEdit = (save) => {
        if (finished) return;
        finished = true;
        const name = input.value.trim();
        if (save && name) {
          const previousName = AppState.getTracks()[containerIndex]?.name || `Track ${containerIndex + 1}`;
          AppState.updateTrack(containerIndex, { name });
          if (name !== previousName && AppState.getTracks()[containerIndex]?.name === name) {
            emitInteractionMotion(input, "rename");
          }
          sendState(AppState.getCurrentStateForPreset(true));
        } else if (!save) {
          emitInteractionMotion(input, "cancel");
        }
        TrackController.renderTracks();
      };
      input.addEventListener("keydown", (keyEvent) => {
        if (keyEvent.key === "Enter") {
          keyEvent.preventDefault();
          finishEdit(true);
        } else if (keyEvent.key === "Escape") {
          keyEvent.preventDefault();
          finishEdit(false);
        }
      });
      input.addEventListener("blur", () => finishEdit(true), { once: true });
      return;
    }

    if (target.matches(".track-mute-btn")) {
      const track = AppState.getTracks()[containerIndex];
      const previousMuted = Boolean(track?.muted);
      AppState.updateTrack(containerIndex, { muted: !track.muted });
      if (Boolean(AppState.getTracks()[containerIndex]?.muted) !== previousMuted) {
        emitInteractionMotion(target, "toggle");
      }
      sendState(AppState.getCurrentStateForPreset(true));
      TrackController.renderTracks();
    } else if (target.matches(".track-solo-btn")) {
      const previousSolo = Boolean(AppState.getTracks()[containerIndex]?.solo);
      AppState.toggleSolo(containerIndex);
      if (Boolean(AppState.getTracks()[containerIndex]?.solo) !== previousSolo) {
        emitInteractionMotion(target, "toggle");
      }
      sendState(AppState.getCurrentStateForPreset(true));
      TrackController.renderTracks();
    } else if (target.matches(".track-remove-btn")) {
      const previousCount = AppState.getTracks().length;
      AppState.removeTrack(containerIndex);
      if (AppState.getTracks().length < previousCount) {
        emitInteractionMotion(target, "remove");
      }
      sendState(AppState.getCurrentStateForPreset(true));
      TrackController.renderTracks();
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent("trackselectionchanged", { detail: { shouldScroll: false } }));
      }, 0);
    } else if (target.matches(".rest-button") || target.closest(".rest-button")) {
        const newRestModeState = !AppState.isRestMode();
        AppState.setRestMode(newRestModeState);
        if (newRestModeState) setExclusiveEditMode("rest");
        else syncModeControls();

        const restActive = AppState.isRestMode();
        const accentActive = AppState.isAccentMode();
        const sliceActive = AppState.isSliceMode?.() || false;

        document.querySelectorAll(".rest-button").forEach(button => {
            button.classList.toggle("active", restActive);
        });
        document.querySelectorAll(".accent-button").forEach(button => {
            button.classList.toggle("active", accentActive);
        });
        document.querySelectorAll(".sub-sound-label").forEach(label => {
            label.classList.toggle("rest-mode-active", restActive);
        });
        document.querySelectorAll(".bar-visual").forEach(bar => {
            bar.classList.toggle("rest-mode-active", restActive);
            bar.classList.toggle("accent-mode-active", accentActive);
            bar.classList.toggle("slice-mode-active", sliceActive);
        });

        const currentSelectedTrackIndex = AppState.getSelectedTrackIndex();
        if (currentSelectedTrackIndex !== containerIndex) {
            AppState.setSelectedTrackIndex(containerIndex);
            const track = AppState.getTracks()[containerIndex];
            if (track && track.barSettings && track.barSettings.length > 0) {
                AppState.setSelectedBarIndexInContainer(0);
            } else {
                AppState.setSelectedBarIndexInContainer(-1);
            }
        }
        BarDisplayController.renderBarsAndControls();
        updateSelectionUI();
        if (restActive === newRestModeState) {
            emitInteractionMotion(target.closest(".rest-button") || target, "toggle");
        }
    } else if (target.matches(".accent-button") || target.closest(".accent-button")) {
        const newAccentModeState = !AppState.isAccentMode();
        AppState.setAccentMode(newAccentModeState);
        if (newAccentModeState) setExclusiveEditMode("accent");
        else syncModeControls();

        const restActive = AppState.isRestMode();
        const accentActive = AppState.isAccentMode();
        const sliceActive = AppState.isSliceMode?.() || false;

        document.querySelectorAll(".accent-button").forEach(button => {
            button.classList.toggle("active", accentActive);
        });
        document.querySelectorAll(".rest-button").forEach(button => {
            button.classList.toggle("active", restActive);
        });
        document.querySelectorAll(".sub-sound-label").forEach(label => {
            label.classList.toggle("rest-mode-active", restActive);
        });
        document.querySelectorAll(".bar-visual").forEach(bar => {
            bar.classList.toggle("accent-mode-active", accentActive);
            bar.classList.toggle("rest-mode-active", restActive);
        });

        const currentSelectedTrackIndex = AppState.getSelectedTrackIndex();
        if (currentSelectedTrackIndex !== containerIndex) {
            AppState.setSelectedTrackIndex(containerIndex);
            const track = AppState.getTracks()[containerIndex];
            if (track && track.barSettings && track.barSettings.length > 0) {
                AppState.setSelectedBarIndexInContainer(0);
            } else {
                AppState.setSelectedBarIndexInContainer(-1);
            }
        }
        BarDisplayController.renderBarsAndControls();
        updateSelectionUI();
        if (accentActive === newAccentModeState) {
            emitInteractionMotion(target.closest(".accent-button") || target, "toggle");
        }
    } else if (target.matches(".record-btn") || target.closest(".record-btn")) {
        AudioController.toggleRecording(containerIndex);
    } else if (target.matches(".beat-edit-btn") || target.closest(".beat-edit-btn")) {
        isBeatEditMode = !isBeatEditMode;
        if (isBeatEditMode) setExclusiveEditMode("beat");
        else syncModeControls();
        document.body.classList.toggle("beat-edit-mode", isBeatEditMode);
        document.querySelectorAll(".beat-edit-btn").forEach(button => {
          button.classList.toggle("active", isBeatEditMode);
          button.setAttribute("aria-pressed", String(isBeatEditMode));
        });
        BarDisplayController.renderBarsAndControls();
        emitInteractionMotion(target.closest(".beat-edit-btn") || target, "toggle");
    } else if (target.matches(".slice-btn") || target.closest(".slice-btn")) {
        const active = !AppState.isSliceMode?.();
        if (active) setExclusiveEditMode("slice");
        AppState.setSliceMode?.(active);
        syncModeControls();
        BarDisplayController.renderBarsAndControls();
        if (Boolean(AppState.isSliceMode?.()) === active) {
            emitInteractionMotion(target.closest(".slice-btn") || target, "toggle");
        }
    } else if (target.matches(".duplicate-track-btn") || target.closest(".duplicate-track-btn")) {
        const previousCount = AppState.getTracks().length;
        AppState.duplicateTrack(containerIndex);
        if (AppState.getTracks().length > previousCount) {
          emitInteractionMotion(target.closest(".duplicate-track-btn") || target, "copy");
        }
        sendState(AppState.getCurrentStateForPreset(true));
        TrackController.renderTracks();
    } else if (target.matches(".duplicate-bar-btn") || target.closest(".duplicate-bar-btn")) {
        const previousBarCount = AppState.getTracks()[containerIndex]?.barSettings?.length ?? 0;
        AppState.duplicateBar(containerIndex, AppState.getSelectedBarIndexInContainer());
        if ((AppState.getTracks()[containerIndex]?.barSettings?.length ?? 0) > previousBarCount) {
          emitInteractionMotion(target.closest(".duplicate-bar-btn") || target, "copy");
        }
        sendState(AppState.getCurrentStateForPreset(true));
        TrackController.renderTracks();
    } else if (target.matches(".track-reset-btn") || target.closest(".track-reset-btn")) {
        if (TrackController.actionLongPressTriggered) {
            TrackController.actionLongPressTriggered = false;
            return;
        }
        const before = trackMotionSignature(containerIndex);
        AppState.resetTrack(containerIndex, { track: true, sounds: true, structure: true, pattern: true });
        if (trackMotionChanged(containerIndex, before)) {
            emitInteractionMotion(target.closest(".track-reset-btn") || target, "reset");
        }
        sendState(AppState.getCurrentStateForPreset(true));
        TrackController.renderTracks();
    } else if (target.matches(".random-btn") || target.closest(".random-btn")) {
        if (TrackController.actionLongPressTriggered) {
            TrackController.actionLongPressTriggered = false;
            return;
        }
        const before = trackMotionSignature(containerIndex);
        const track = AppState.getTracks()[containerIndex];
        if (track && track.barSettings) {
            track.barSettings.forEach(bar => {
                const subBeats = Math.round((bar.beats || 4) * (bar.subdivision || 1));
                bar.rests = [];
                bar.velocities = {};
                for (let i = 0; i < subBeats; i++) {
                    const rand = Math.random();
                    if (rand < 0.18) {
                        bar.rests.push(i);
                    } else if (rand < 0.42) {
                        bar.velocities[i] = 1.0; // Accent
                    } else if (rand < 0.60) {
                        bar.velocities[i] = 0.3; // Ghost note
                    } else {
                        bar.velocities[i] = 0.7; // Normal
                    }
                }
                const sliceCounts = [2, 3, 4, 6, 8, 16, 32];
                bar.beatSlices = {};
                bar.beatSliceAnchors = {};
                for (let i = 0; i < subBeats; i++) {
                    if (Math.random() < 0.24) {
                        const count = sliceCounts[Math.floor(Math.random() * sliceCounts.length)];
                        bar.beatSlices[i] = count;
                        bar.beatSliceAnchors[i] = i;
                    }
                }
                if (Object.keys(bar.beatSlices).length === 0) delete bar.beatSlices;
                if (Object.keys(bar.beatSliceAnchors).length === 0) delete bar.beatSliceAnchors;
            });
            sendState(AppState.getCurrentStateForPreset(true));
            if (trackMotionChanged(containerIndex, before)) emitInteractionMotion(target.closest(".random-btn") || target, "randomize");
            BarDisplayController.renderBarsAndControls();
        }
    } else if (target.closest(".sound-picker-preview")) {
        event.stopPropagation();
        previewSound(target.closest(".sound-picker-card").dataset.sound);
    } else if (target.closest(".sound-picker-select")) {
        event.stopPropagation();
        const card = target.closest(".sound-picker-card");
        if (!activeSoundPicker || !card) return;
        const { trackIndex, soundType } = activeSoundPicker;
        const newSound = card.dataset.sound;
        const before = trackMotionSignature(trackIndex);
        const defaultSettings = AppState.getDefaultSoundSettings(newSound);
        AppState.updateTrack(trackIndex, {
          [soundType]: { sound: newSound, settings: defaultSettings ? { ...defaultSettings } : {} },
        });
        sendState(AppState.getCurrentStateForPreset(true));
        if (trackMotionChanged(trackIndex, before) && AppState.getTracks()[trackIndex]?.[soundType]?.sound === newSound) {
        emitInteractionMotion(event.target.closest(".sound-picker-select"), "select");
      }
      closeSoundPicker();
        TrackController.renderTracks();
    } else if (target.matches(".sound-selector-trigger") || target.closest(".sound-selector-trigger")) {
        event.stopPropagation();
        const trigger = target.closest(".sound-selector-trigger");
        const trackElement = trigger.closest(".track");
        const soundType = trigger.classList.contains("main-beat-sound-select") ? "mainBeatSound" : "subdivisionSound";
        openSoundPicker(parseInt(trackElement.dataset.containerIndex, 10), soundType);
    } else if (target.matches(".sound-label") || target.closest(".sound-label")) {
        const soundLabel = target.closest(".sound-label");
        const isMain = soundLabel.classList.contains("main-sound-label");
        const soundType = isMain ? "mainBeatSound" : "subdivisionSound";
        SoundSettingsModal.show(containerIndex, soundType);
    } else {
        let selectionChanged = false;
        if (AppState.getSelectedTrackIndex() !== containerIndex) {
            AppState.setSelectedTrackIndex(containerIndex);
            
            const track = AppState.getTracks()[containerIndex];
            if (track && track.barSettings) {
                const currentBarIndex = AppState.getSelectedBarIndexInContainer();
                const maxIndex = track.barSettings.length - 1;
                if (currentBarIndex > maxIndex) {
                    AppState.setSelectedBarIndexInContainer(maxIndex);
                }
            }
            
            selectionChanged = true;
        }

        const barVisual = target.closest(".bar-visual");
        if (barVisual) {
            const barIndex = parseInt(barVisual.dataset.barIndex, 10);
            if (AppState.getSelectedBarIndexInContainer() !== barIndex) {
                AppState.setSelectedBarIndexInContainer(barIndex);
                selectionChanged = true;
            }
        }

        if (selectionChanged) {
             BarDisplayController.updateSelectionVisuals();
             if (barVisual && AppState.getSelectedTrackIndex() === containerIndex
               && AppState.getSelectedBarIndexInContainer() === Number.parseInt(barVisual.dataset.barIndex, 10)) {
               emitInteractionMotion(barVisual, 'select');
             }
        }

        updateSelectionUI();
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
        sendState(AppState.getCurrentStateForPreset(true)); // Lightweight sync
      }
    }
  },

  /**
   * Handles input events from track sliders (volume, pitch, swing).
   * @param {Event} event - The input event.
   */
  handleTrackSliderInput: (event) => {
    const target = event.target;
    const trackElement = target.closest(".track");
    if (!trackElement) return;

    const containerIndex = parseInt(trackElement.dataset.containerIndex, 10);

    if (target.matches(".track-volume-slider")) {
      const newVolume = parseFloat(target.value);
      const previousVolume = AppState.getTracks()[containerIndex]?.volume ?? 1.0;
      AppState.updateTrack(containerIndex, { volume: newVolume });
      if ((AppState.getTracks()[containerIndex]?.volume ?? 1.0) !== previousVolume) {
        emitInteractionMotion(target, "volume");
      }
      sendState(AppState.getCurrentStateForPreset(true));
      const valDisplay = trackElement.querySelector(".track-volume-value");
      if (valDisplay) valDisplay.textContent = `${(newVolume * 100).toFixed(0)}%`;
    } else if (target.matches(".track-pitch-slider")) {
      const pitchVal = parseInt(target.value, 10) || 0;
      const previousPitch = AppState.getTracks()[containerIndex]?.pitchShift ?? 0;
      AppState.updateTrack(containerIndex, { pitchShift: pitchVal });
      if ((AppState.getTracks()[containerIndex]?.pitchShift ?? 0) !== previousPitch) {
        emitInteractionMotion(target, "adjust");
      }
      sendState(AppState.getCurrentStateForPreset(true));
      const pitchDisplay = trackElement.querySelector(".track-pitch-value");
      if (pitchDisplay) pitchDisplay.textContent = `${pitchVal > 0 ? '+' : ''}${pitchVal}st`;
    } else if (target.matches(".track-swing-slider")) {
      const swingVal = parseInt(target.value, 10) || 0;
      const previousSwing = AppState.getTracks()[containerIndex]?.swing ?? 0;
      AppState.updateTrack(containerIndex, { swing: swingVal });
      if ((AppState.getTracks()[containerIndex]?.swing ?? 0) !== previousSwing) {
        emitInteractionMotion(target, "adjust");
      }
      sendState(AppState.getCurrentStateForPreset(true));
      const swingDisplay = trackElement.querySelector(".track-swing-value");
      if (swingDisplay) swingDisplay.textContent = `${swingVal}%`;
    }
  },

  handleActionPointerDown: (event) => {
    const target = event.target.closest?.(".track-reset-btn, .random-btn");
    if (!target) return;
    const track = target.closest(".track");
    if (!track) return;
    const trackIndex = Number(track.dataset.containerIndex);
    TrackController.actionLongPressTriggered = false;
    clearTimeout(TrackController.actionLongPressTimer);
    actionHoldDecoration?.cancel();
    actionHoldDecoration = beginInteractionHold(target, { duration: 350 });
    TrackController.actionLongPressTimer = setTimeout(() => {
      actionHoldDecoration?.cancel();
      actionHoldDecoration = null;
      TrackController.actionLongPressTriggered = true;
      openTrackActionModal(target.matches(".track-reset-btn") ? "reset" : "random", trackIndex);
    }, 350);
  },

  handleActionPointerUp: () => {
    actionHoldDecoration?.cancel();
    actionHoldDecoration = null;
    clearTimeout(TrackController.actionLongPressTimer);
  },

  /**
   * Handles mousedown events, specifically for opening the sound settings modal.

   */
  handleMouseDown: (event) => {
    // Resolve from the nearest label so clicks landing on padding still count.
    const target = event.target.closest?.(".sound-label");
    if (target) {
      const trackElement = target.closest(".track");
      if (trackElement) {
        const containerIndex = parseInt(
          trackElement.dataset.containerIndex,
          10
        );
        const isMainSound = target.classList.contains("main-sound-label");
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
    const previousCount = AppState.getTracks().length;
    AppState.addTrack();
    if (AppState.getTracks().length > previousCount) {
      emitInteractionMotion(document.getElementById("add-track-btn"), "open");
    }
    sendState(AppState.getCurrentStateForPreset(true)); // Lightweight sync
    TrackController.renderTracks();
    setTimeout(() => {
      document.dispatchEvent(
        new CustomEvent("trackselectionchanged", { detail: { shouldScroll: true } })
      );
    }, 0);
  },

  /**
   * Scrolls the selected track's controls into view.
   */
  scrollToSelectedTrack: () => {
    const selectedTrackIndex = AppState.getSelectedTrackIndex();
    if (selectedTrackIndex !== -1) {
      const trackElement = document.querySelector(
        `.track[data-container-index="${selectedTrackIndex}"]`
      );
      if (trackElement) {
        const trackControls = trackElement.querySelector(".track-controls");
        if (trackControls) {
          trackControls.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } else {
          trackElement.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }
    }
  },
};

/**
 * Creates and configures a modal-opening sound selector button.
 * @param {object} selectedSound - The currently selected sound object.
 * @param {string} typeClass - The CSS class to assign to the selector.
 * @returns {HTMLButtonElement} The configured selector button.
 */
function createSoundSelector(selectedSound, typeClass) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `sound-selector-trigger ${typeClass}`;
  button.dataset.sound = selectedSound.sound;
  button.textContent = displaySoundName(selectedSound.sound);
  button.setAttribute("aria-haspopup", "dialog");
  button.title = "Choose sound";
  return button;
}

export default TrackController;

