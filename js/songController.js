import AppState from "./appState.js";
import { sendState, getSyncDiagnostics } from "./webrtc.js";
import MetronomeEngine from "./metronomeEngine.js";

const FORMAT = "metronominal-song";
const MAX_IMPORT_BYTES = 256 * 1024;
const FORBIDDEN_KEYS = new Set([
  "hostCredential", "credential", "room", "peerId", "serializedRecordings",
  "recordings", "selectedTheme", "isPlaying", "isRecording", "nextBeatTime", "analyserNode",
  "__proto__", "prototype", "constructor"
]);

let refreshApplicationUI = () => {};
let canEditSong = true;
let selectedSectionIndex = 0;

const SNAPSHOT_BAR_KEYS = new Set(["beats", "subdivision", "rests", "velocities", "beatSounds", "beatSlices", "beatSliceAnchors"]);

const SNAPSHOT_TRACK_KEYS = new Set([
  "name", "barSettings", "muted", "solo", "volume", "pitchShift", "swing", "mainBeatSound", "subdivisionSound"
]);

function hasOnlyKeys(value, keys) {
  return Object.keys(value).every(key => keys.has(key));
}

function stripUnsafeData(value) {
  if (Array.isArray(value)) return value.map(stripUnsafeData);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !FORBIDDEN_KEYS.has(key))
    .map(([key, nested]) => [key, stripUnsafeData(nested)]));
}

function encodeBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function createPayload() {
  const state = stripUnsafeData(await AppState.getCurrentStateForPreset(true));
  const privateSounds = privateSoundNames();
  state.customSounds = Object.fromEntries(Object.entries(state.customSounds || {})
    .filter(([name]) => !privateSounds.has(name)));
  const sharedTracks = [
    ...(state.Tracks || []),
    ...(state.song?.sections || []).flatMap(section => section.tracks || [])
  ];
  for (const track of state.Tracks || []) {
    track.currentBar = 0;
    track.currentBeat = 0;
  }
  for (const track of sharedTracks) {
    if (privateSounds.has(track.mainBeatSound?.sound)) track.mainBeatSound.sound = "Synth Kick";
    if (privateSounds.has(track.subdivisionSound?.sound)) track.subdivisionSound.sound = "Synth HiHat";
  }
  return { format: FORMAT, version: 1, exportedAt: new Date().toISOString(), state };
}

function isFiniteInRange(value, minimum, maximum) {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function containsForbiddenKey(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  return Object.entries(value).some(([key, child]) => FORBIDDEN_KEYS.has(key) || containsForbiddenKey(child));
}

function isSafeSettings(value, depth = 0) {
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length <= 256;
  if (depth >= 6 || !value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.length <= 64 && value.every(item => isSafeSettings(item, depth + 1));
  const entries = Object.entries(value);
  return entries.length <= 64 && entries.every(([key, child]) => key.length <= 64 && !FORBIDDEN_KEYS.has(key) && isSafeSettings(child, depth + 1));
}

function isSafeSound(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && typeof value.sound === "string" && value.sound.length >= 1 && value.sound.length <= 64
    && isSafeSettings(value.settings);
}

function isSafeSliceMetadata(value) {
  return value === undefined || (value && typeof value === "object" && !Array.isArray(value)
    && Object.entries(value).length <= 512
    && Object.entries(value).every(([index, count]) => Number.isInteger(Number(index)) && Number(index) >= 0 && Number(index) <= 511
      && [2, 3, 4, 6, 8, 16, 32].includes(Number(count))));
}

function isSafeAnchorMetadata(value) {
  return value === undefined || (value && typeof value === "object" && !Array.isArray(value)
    && Object.entries(value).length <= 512
    && Object.entries(value).every(([index, anchor]) => Number.isInteger(Number(index)) && Number(index) >= 0 && Number(index) <= 511
      && Number.isInteger(Number(anchor)) && Number(anchor) >= 0 && Number(anchor) <= 511));
}

function isSafeBeatSounds(value) {
  return value === undefined || (value && typeof value === "object" && !Array.isArray(value)
    && Object.entries(value).length <= 512
    && Object.entries(value).every(([index, overrides]) => Number.isInteger(Number(index)) && Number(index) >= 0 && Number(index) <= 511
      && overrides && typeof overrides === "object" && !Array.isArray(overrides)
      && hasOnlyKeys(overrides, new Set(["mainBeatSound", "subdivisionSound"]))
      && (overrides.mainBeatSound === undefined || isSafeSound(overrides.mainBeatSound))
      && (overrides.subdivisionSound === undefined || isSafeSound(overrides.subdivisionSound))));
}

function isSafeSnapshotTrack(track) {
  if (!track || typeof track !== "object" || Array.isArray(track) || !hasOnlyKeys(track, SNAPSHOT_TRACK_KEYS)) return false;
  if (track.name !== undefined && (typeof track.name !== "string" || track.name.length < 1 || track.name.length > 64)) return false;
  if (!Array.isArray(track.barSettings) || track.barSettings.length < 1 || track.barSettings.length > 64) return false;
  if (typeof track.muted !== "boolean" || typeof track.solo !== "boolean" || !isFiniteInRange(track.volume, 0, 1)) return false;
  if (!isSafeSound(track.mainBeatSound) || !isSafeSound(track.subdivisionSound)
    || /^Recording:/i.test(track.mainBeatSound.sound) || /^Recording:/i.test(track.subdivisionSound.sound)) return false;
  return track.barSettings.every(bar => bar && typeof bar === "object" && !Array.isArray(bar)
    && hasOnlyKeys(bar, SNAPSHOT_BAR_KEYS)
    && Number.isInteger(bar.beats) && bar.beats >= 1 && bar.beats <= 32
    && isFiniteInRange(Number(bar.subdivision), 0.25, 16)
    && Array.isArray(bar.rests) && bar.rests.length <= 256
    && bar.rests.every(rest => Number.isInteger(rest) && rest >= 0 && rest <= 511)
    && isSafeBeatSounds(bar.beatSounds)
    && isSafeSliceMetadata(bar.beatSlices)
    && isSafeAnchorMetadata(bar.beatSliceAnchors)
    && (bar.velocities === undefined || (bar.velocities && typeof bar.velocities === "object" && !Array.isArray(bar.velocities)
      && Object.entries(bar.velocities).every(([index, velocity]) => Number.isInteger(Number(index)) && Number(index) >= 0 && Number(index) <= 511
        && isFiniteInRange(Number(velocity), 0, 1)))));
}

function privateSoundNames() {
  const names = new Set(AppState.getRecordings());
  let changed = true;
  while (changed) {
    changed = false;
    for (const name of AppState.getCustomSounds()) {
      if (names.has(AppState.getCustomSoundData(name)?.baseSound) && !names.has(name)) {
        names.add(name);
        changed = true;
      }
    }
  }
  return names;
}

function snapshotCurrentTracks() {
  const privateSounds = privateSoundNames();
  return AppState.getTracks().slice(0, 16).map((track, index) => ({
    name: String(track.name || `Track ${index + 1}`).trim().slice(0, 64) || `Track ${index + 1}`,
    barSettings: track.barSettings.slice(0, 64).map(bar => ({
      beats: bar.beats,
      subdivision: Number(bar.subdivision),
      rests: [...(bar.rests || [])].slice(0, 256),
      velocities: { ...(bar.velocities || {}) },
      beatSounds: JSON.parse(JSON.stringify(bar.beatSounds || {})),
      beatSlices: { ...(bar.beatSlices || {}) },
      beatSliceAnchors: { ...(bar.beatSliceAnchors || {}) },
    })),
    muted: track.muted === true,
    solo: track.solo === true,
    volume: isFiniteInRange(track.volume, 0, 1) ? track.volume : 1,
    pitchShift: Number.isInteger(track.pitchShift) ? track.pitchShift : 0,
    swing: Number.isFinite(track.swing) ? track.swing : 0,
    mainBeatSound: {
      sound: privateSounds.has(track.mainBeatSound?.sound) ? "Synth Kick" : track.mainBeatSound.sound,
      settings: JSON.parse(JSON.stringify(track.mainBeatSound?.settings || {})),
    },
    subdivisionSound: {
      sound: privateSounds.has(track.subdivisionSound?.sound) ? "Synth HiHat" : track.subdivisionSound.sound,
      settings: JSON.parse(JSON.stringify(track.subdivisionSound?.settings || {})),
    },
  }));
}

function runtimeTracksFromSnapshot(tracks) {
  return tracks.map(track => ({
    ...JSON.parse(JSON.stringify(track)),
    currentBar: 0,
    currentBeat: 0,
    songRepeatIteration: 0,
    nextBeatTime: 0,
  }));
}

function expandSnapshotBars(tracks, requiredBars) {
  return tracks.map(track => {
    const bars = track.barSettings.map(bar => ({
      ...bar,
      rests: [...(bar.rests || [])],
      velocities: { ...(bar.velocities || {}) },
    }));
    const lastBar = bars[bars.length - 1];
    while (bars.length < requiredBars) bars.push(JSON.parse(JSON.stringify(lastBar)));
    return { ...track, barSettings: bars };
  });
}

function validateImportedState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return false;
  if (!Number.isInteger(state.tempo) || !isFiniteInRange(state.tempo, 20, 400) || !isFiniteInRange(state.volume, 0, 1)) return false;
  if (state.countInBars !== undefined && (!Number.isInteger(state.countInBars) || state.countInBars < 0 || state.countInBars > 8)) return false;
  if (!Array.isArray(state.Tracks) || state.Tracks.length < 1 || state.Tracks.length > 16) return false;
  for (const track of state.Tracks) {
    if (!track || typeof track !== "object" || Array.isArray(track)) return false;
    if (track.name !== undefined && (typeof track.name !== "string" || track.name.length < 1 || track.name.length > 64)) return false;
    if (!Array.isArray(track.barSettings) || track.barSettings.length < 1 || track.barSettings.length > 64) return false;
    if (track.volume !== undefined && !isFiniteInRange(track.volume, 0, 1)) return false;
    if (!isSafeSound(track.mainBeatSound) || !isSafeSound(track.subdivisionSound)) return false;
    for (const bar of track.barSettings) {
      if (!bar || typeof bar !== "object" || !Number.isInteger(bar.beats) || bar.beats < 1 || bar.beats > 32) return false;
      if (!isFiniteInRange(Number(bar.subdivision), 0.25, 16)) return false;
      if (!Array.isArray(bar.rests) || bar.rests.length > 512 || bar.rests.some(rest => !Number.isInteger(rest) || rest < 0 || rest > 511)) return false;
      if (!isSafeBeatSounds(bar.beatSounds) || !isSafeSliceMetadata(bar.beatSlices) || !isSafeAnchorMetadata(bar.beatSliceAnchors)) return false;
      if (bar.velocities !== undefined && (!bar.velocities || typeof bar.velocities !== "object" || Array.isArray(bar.velocities)
        || Object.entries(bar.velocities).length > 512
        || Object.entries(bar.velocities).some(([index, velocity]) => !Number.isInteger(Number(index)) || Number(index) < 0 || Number(index) > 511 || !isFiniteInRange(Number(velocity), 0, 1)))) return false;
    }
  }
  if (state.customSounds !== undefined) {
    if (!state.customSounds || typeof state.customSounds !== "object" || Array.isArray(state.customSounds)
      || Object.keys(state.customSounds).length > 64) return false;
    for (const [name, definition] of Object.entries(state.customSounds)) {
      if (name.length < 1 || name.length > 64 || !definition || typeof definition !== "object" || Array.isArray(definition)
        || typeof definition.baseSound !== "string" || definition.baseSound.length < 1 || definition.baseSound.length > 64
        || !isSafeSettings(definition.settings)) return false;
    }
  }
  const song = state.song;
  if (!song || ![1, 2].includes(song.version) || typeof song.enabled !== "boolean" || typeof song.name !== "string" || song.name.length < 1 || song.name.length > 80) return false;
  if (!Array.isArray(song.sections) || song.sections.length < 1 || song.sections.length > 32) return false;
  let previousStart = -1;
  const barCount = state.Tracks[0].barSettings.length;
  for (const section of song.sections) {
    if (!section || typeof section.name !== "string" || section.name.length < 1 || section.name.length > 48) return false;
    if (!Number.isInteger(section.startBar) || section.startBar < previousStart || section.startBar >= barCount) return false;
    if (!Number.isInteger(section.tempo) || section.tempo < 20 || section.tempo > 300) return false;
    if (song.version === 2) {
      if (!Number.isInteger(section.repeats) || section.repeats < 1 || section.repeats > 16) return false;
      if (section.tracks !== undefined
        && (!Array.isArray(section.tracks) || section.tracks.length < 1 || section.tracks.length > 16
          || !section.tracks.every(isSafeSnapshotTrack))) return false;
    }
    previousStart = section.startBar;
  }
  return song.sections[0].startBar === 0;
}

function reconstructImportedState(state) {
  const reconstructSound = sound => ({
    sound: sound.sound,
    settings: JSON.parse(JSON.stringify(sound.settings))
  });
  const customSounds = {};
  for (const [name, definition] of Object.entries(state.customSounds || {})) {
    customSounds[name] = {
      baseSound: definition.baseSound,
      settings: JSON.parse(JSON.stringify(definition.settings))
    };
  }
  return {
    tempo: state.tempo,
    volume: state.volume,
    countInBars: state.countInBars || 0,
    song: {
      version: 2,
      enabled: state.song.enabled,
      name: state.song.name,
      sections: state.song.sections.map(section => ({
        name: section.name,
        startBar: section.startBar,
        tempo: section.tempo,
        repeats: state.song.version === 2 ? section.repeats : 1,
        ...(state.song.version === 2 && Array.isArray(section.tracks)
          ? { tracks: section.tracks.map(track => ({
            ...(typeof track.name === "string" ? { name: track.name } : {}),
            barSettings: track.barSettings.map(bar => ({
              beats: bar.beats, subdivision: Number(bar.subdivision), rests: [...bar.rests], velocities: { ...(bar.velocities || {}) }, beatSounds: JSON.parse(JSON.stringify(bar.beatSounds || {})), beatSlices: { ...(bar.beatSlices || {}) }, beatSliceAnchors: { ...(bar.beatSliceAnchors || {}) }
            })),
            muted: track.muted,
            solo: track.solo,
            volume: track.volume,
            pitchShift: track.pitchShift,
            swing: track.swing,
            mainBeatSound: reconstructSound(track.mainBeatSound),
            subdivisionSound: reconstructSound(track.subdivisionSound)
          })) }
          : {})
      }))
    },
    Tracks: state.Tracks.map(track => ({
      ...(typeof track.name === "string" ? { name: track.name } : {}),
      barSettings: track.barSettings.map(bar => ({ beats: bar.beats, subdivision: Number(bar.subdivision), rests: [...bar.rests], velocities: { ...(bar.velocities || {}) }, beatSounds: JSON.parse(JSON.stringify(bar.beatSounds || {})), beatSlices: { ...(bar.beatSlices || {}) }, beatSliceAnchors: { ...(bar.beatSliceAnchors || {}) } })),
      muted: track.muted === true,
      solo: track.solo === true,
      volume: isFiniteInRange(track.volume, 0, 1) ? track.volume : 1,
      pitchShift: track.pitchShift,
      swing: track.swing,
      currentBar: 0,
      currentBeat: 0,
      mainBeatSound: reconstructSound(track.mainBeatSound),
      subdivisionSound: reconstructSound(track.subdivisionSound)
    })),
    selectedTrackIndex: Number.isInteger(state.selectedTrackIndex) ? state.selectedTrackIndex : 0,
    selectedBarIndexInContainer: Number.isInteger(state.selectedBarIndexInContainer) ? state.selectedBarIndexInContainer : 0,
    controlsAttachedToTrack: state.controlsAttachedToTrack !== false,
    isRestMode: state.isRestMode === true,
    isAccentMode: state.isAccentMode === true && state.isSliceMode !== true,
    isSliceMode: state.isSliceMode === true,
    customSounds
  };
}

function validatePayload(payload) {
  if (!payload || payload.format !== FORMAT || payload.version !== 1 || !payload.state) {
    throw new Error("This is not a supported Metronominal song file.");
  }
  const serialized = JSON.stringify(payload);
  if (new TextEncoder().encode(serialized).byteLength > MAX_IMPORT_BYTES) {
    throw new Error("Song files must be 256 KB or smaller.");
  }
  if (containsForbiddenKey(payload) || !validateImportedState(payload.state)) {
    throw new Error("Song contains invalid or unsafe data.");
  }
  return { ...payload, state: reconstructImportedState(payload.state) };
}

async function applyPayload(payload, { allowBeforeConnection = false } = {}) {
  if (!allowBeforeConnection && (!canEditSong || !window.isHost || AppState.isPlaying())) {
    throw new Error("Only a connected host can import a song while playback is stopped.");
  }
  const validated = validatePayload(payload);
  if (!allowBeforeConnection && (!canEditSong || !window.isHost || AppState.isPlaying())) {
    throw new Error("Song import was cancelled because room authority or playback changed.");
  }
  await AppState.loadPresetData(validated.state);
  refreshApplicationUI();
  if (window.isHost) sendState(AppState.getCurrentStateForPreset(true));
}

async function songUrl() {
  const payload = await createPayload();
  const url = new URL(window.location.pathname, window.location.origin);
  url.hash = `song=${encodeBase64Url(JSON.stringify(payload))}`;
  if (url.href.length > 100000) throw new Error("This song is too large for a link. Export the song file instead.");
  return url.href;
}

function announce(message, isError = false) {
  const status = document.getElementById("song-share-status");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("error", isError);
}

async function publishSongChange(nextSong, shouldRender = true) {
  const syncRole = getSyncDiagnostics().role;
  const connectedClient = syncRole === "client";
  if (connectedClient || !canEditSong || AppState.isPlaying()) {
    render();
    return;
  }
  AppState.setSong(nextSong);
  if (shouldRender) render();
  sendState(AppState.getCurrentStateForPreset(true));
}

async function goToSection(index) {
  if (!Number.isInteger(index) || !canEditSong) return false;
  const section = AppState.getSong().sections[index];
  if (!section) return false;
  if (AppState.isPlaying()) await MetronomeEngine.togglePlay(true);
  AppState.setSelectedTrackIndex(0);
  for (const track of AppState.getTracks()) {
    track.currentBar = 0;
    track.currentBeat = 0;
    track.songRepeatIteration = 0;
  }
  selectedSectionIndex = index;
  AppState.setTempo(section.tempo);
  sendState(AppState.getCurrentStateForPreset(true));
  refreshApplicationUI();
  return true;
}

function markSelectedSection(index) {
  selectedSectionIndex = index;
  document.querySelectorAll(".song-section-row").forEach(row => {
    const rowIndex = Number.parseInt(row.dataset.sectionIndex, 10);
    row.classList.toggle("is-selected", rowIndex === index);
    const updateButton = row.querySelector('[data-song-section-action="update"]');
    if (updateButton) updateButton.disabled = !canEditSong || rowIndex !== index;
  });
}

function selectSection(index) {
  if (!Number.isInteger(index) || index < 0 || selectedSectionIndex === index) return;
  selectedSectionIndex = index;
  render();
}

function renderSavedSectionDetails(section, tracks) {
  const trackCards = tracks.map((track, index) => {
    const bars = track.barSettings || [];
    const restCount = bars.reduce((total, bar) => total + (bar.rests?.length || 0), 0);
    const velocityCount = bars.reduce((total, bar) => total + Object.keys(bar.velocities || {}).length, 0);
    const state = track.muted ? "Muted" : (track.solo ? "Solo" : "Active");
    return `<li class="song-saved-track-card">
      <strong>${escapeHtml(track.name || `Track ${index + 1}`)}</strong>
      <span>${bars.length} bar${bars.length === 1 ? "" : "s"} · ${escapeHtml(track.mainBeatSound?.sound || "No main sound")} / ${escapeHtml(track.subdivisionSound?.sound || "No subdivision sound")}</span>
      <span>${state} · Vol ${Math.round((track.volume ?? 1) * 100)}% · Pitch ${(track.pitchShift ?? 0) > 0 ? "+" : ""}${track.pitchShift ?? 0}st · Swing ${track.swing ?? 0}%</span>
      <span>${restCount} rest${restCount === 1 ? "" : "s"} · ${velocityCount} velocity setting${velocityCount === 1 ? "" : "s"}</span>
    </li>`;
  }).join("");
  return `<div class="song-section-saved-details">
    <div class="song-saved-summary">
      <span><b>Tempo</b> ${section.tempo} BPM</span>
      <span><b>Starts</b> bar ${section.startBar + 1}</span>
      <span><b>Repeats</b> ${section.repeats}×</span>
      <span><b>Tracks</b> ${tracks.length}</span>
    </div>
    <ul class="song-saved-track-list">${trackCards}</ul>
  </div>`;
}

function updateNowPlaying() {
  const song = AppState.getSong();
  const referenceBar = AppState.getTracks()[0]?.currentBar || 0;
  const active = !AppState.isPlaying() && song.sections[selectedSectionIndex]
    ? song.sections[selectedSectionIndex]
    : AppState.getSongSectionForBar(referenceBar);
  const displayBar = !AppState.isPlaying() && song.sections[selectedSectionIndex]
    ? 0
    : referenceBar;
  const now = document.getElementById("song-now-playing");
  if (now) now.textContent = song.enabled
    ? `${active.name} · bar ${displayBar + 1} · ${active.tempo} BPM`
    : "Song mode off";
}

function render() {
  const song = AppState.getSong();
  const editable = canEditSong && !AppState.isPlaying();
  const panel = document.getElementById("song-mode-panel");
  const enabled = document.getElementById("song-mode-enabled");
  const name = document.getElementById("song-name-input");
  const list = document.getElementById("song-sections-list");
  const add = document.getElementById("add-song-section-btn");
  if (!panel || !enabled || !name || !list || !add) return;

  enabled.setAttribute("aria-pressed", String(song.enabled));
  enabled.setAttribute("aria-label", song.enabled ? "Disable song mode" : "Enable song mode");
  enabled.disabled = !editable;
  panel.hidden = !song.enabled;
  name.value = song.name;
  name.disabled = !editable;
  const primaryBarCount = AppState.getTracks()[0]?.barSettings?.length || 1;
  add.disabled = !editable || song.sections.length >= 32;
  const importInput = document.getElementById("import-song-input");
  if (importInput) importInput.disabled = !editable;
  selectedSectionIndex = Math.max(0, Math.min(selectedSectionIndex, song.sections.length - 1));
  list.replaceChildren();

  song.sections.forEach((section, index) => {
    const row = document.createElement("div");
    row.className = `song-section-row${index === selectedSectionIndex ? " is-selected" : ""}`;
    row.dataset.sectionIndex = String(index);
    const barOptions = Array.from({ length: primaryBarCount }, (_, barIndex) =>
      `<option value="${barIndex + 1}"${barIndex === section.startBar ? " selected" : ""}>Bar ${barIndex + 1}</option>`
    ).join("");
    const repeatOptions = Array.from({ length: 16 }, (_, repeatIndex) => {
      const repeats = repeatIndex + 1;
      return `<option value="${repeats}"${repeats === section.repeats ? " selected" : ""}>${repeats}×</option>`;
    }).join("");
    const savedTracks = section.tracks || [];
    const savedInfo = index === selectedSectionIndex && savedTracks.length
      ? `<div class="song-section-track-preview" aria-live="polite">
          <strong>${savedTracks.length} track${savedTracks.length === 1 ? "" : "s"} saved in ${escapeHtml(section.name)}</strong>
          ${renderSavedSectionDetails(section, savedTracks)}
        </div>`
      : "";
    row.innerHTML = `
      <span class="song-section-number">${index + 1}</span>
      <label>Name <input data-song-section-name="${index}" maxlength="48" value=""></label>
      <label>Starts at bar <select data-song-section-start="${index}">${barOptions}</select></label>
      <label>BPM <input data-song-section-tempo="${index}" type="number" min="20" max="300" value="${section.tempo}"></label>
      <label>Repeats <select data-song-section-repeats="${index}">${repeatOptions}</select></label>
      <span class="song-section-track-count">${section.tracks?.length || 0} tracks</span>
      <span class="song-section-actions" aria-label="${section.name || `Section ${index + 1}`} actions">
        <button type="button" data-song-section-action="go" aria-label="Go to ${section.name || "section"}" title="Go to section">▶ <span>Go</span></button>
        <button type="button" data-song-section-action="apply" aria-label="Apply ${section.name || "section"} tracks" title="Apply section tracks"${!section.tracks?.length ? " disabled" : ""}>⇩ <span>Apply</span></button>
        <button type="button" data-song-section-action="update" aria-label="Update ${section.name || "section"} from current tracks" title="Update section from current tracks"${!editable || index !== selectedSectionIndex ? " disabled" : ""}>⇧ <span>Update</span></button>
        <button type="button" data-song-section-action="copy" aria-label="Copy ${section.name || "section"}" title="Copy section">⧉ <span>Copy</span></button>
        <button type="button" data-song-section-action="remove" aria-label="Remove ${section.name || "section"}" title="Remove section"${!editable || song.sections.length === 1 ? " disabled" : ""}>× <span>Remove</span></button>
      </span>
      <span class="song-section-reorder-actions" aria-label="Reorder ${section.name || `section ${index + 1}`}"${song.sections.length === 1 ? " hidden" : ""}>
        <button type="button" data-song-section-action="move-up" aria-label="Move ${section.name || "section"} up" title="Move section up"${!editable || index === 0 ? " disabled" : ""}>↑</button>
        <button type="button" data-song-section-action="move-down" aria-label="Move ${section.name || "section"} down" title="Move section down"${!editable || index === song.sections.length - 1 ? " disabled" : ""}>↓</button>
      </span>
      ${savedInfo}`;
    const nameInput = row.querySelector(`[data-song-section-name="${index}"]`);
    nameInput.value = section.name;
    for (const field of row.querySelectorAll("input, select")) field.disabled = !editable;
    list.appendChild(row);
  });

  updateNowPlaying();
}

function updatedSongFromFields() {
  const song = AppState.getSong();
  song.enabled = document.getElementById("song-mode-enabled").getAttribute("aria-pressed") === "true";
  song.name = document.getElementById("song-name-input").value;
  song.sections = song.sections.map((section, index) => ({
    ...section,
    name: document.querySelector(`[data-song-section-name="${index}"]`)?.value || section.name,
    startBar: (Number.parseInt(document.querySelector(`[data-song-section-start="${index}"]`)?.value, 10) || 1) - 1,
    tempo: Number.parseInt(document.querySelector(`[data-song-section-tempo="${index}"]`)?.value, 10) || section.tempo,
    repeats: Number.parseInt(document.querySelector(`[data-song-section-repeats="${index}"]`)?.value, 10) || section.repeats,
  }));
  return song;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function updateSection(index) {
  if (!canEditSong || AppState.isPlaying()) return;
  const song = updatedSongFromFields();
  const section = song.sections[index];
  if (!section) return;
  section.tempo = AppState.getTempo();
  section.tracks = snapshotCurrentTracks();
  selectedSectionIndex = index;
  await publishSongChange(song);
  announce(`${section.tracks.length} track${section.tracks.length === 1 ? "" : "s"} saved to ${section.name}.`);
}

async function applySection(index) {
  if (!canEditSong || AppState.isPlaying()) return;
  const song = updatedSongFromFields();
  const section = song.sections[index];
  if (!section?.tracks?.length) return;
  selectedSectionIndex = index;
  const requiredBars = Math.max(
    1,
    ...AppState.getTracks().map(track => track.barSettings?.length || 1),
    ...song.sections.map(item => item.startBar + 1)
  );
  const state = await AppState.getCurrentStateForPreset(true);
  state.tempo = section.tempo;
  state.Tracks = runtimeTracksFromSnapshot(expandSnapshotBars(section.tracks, requiredBars));
  state.song = song;
  await AppState.loadPresetData(state);
  refreshApplicationUI({ animate: false });
  sendState(AppState.getCurrentStateForPreset(true));
  announce(`${section.name} tracks applied.`);
}

function copySection(index) {
  if (!canEditSong || AppState.isPlaying()) return;
  const song = updatedSongFromFields();
  const source = song.sections[index];
  if (!source || song.sections.length >= 32) return;
  song.sections.push({
    ...JSON.parse(JSON.stringify(source)),
    name: `${source.name || `Section ${index + 1}`} Copy`,
    startBar: 0,
    tracks: source.tracks ? JSON.parse(JSON.stringify(source.tracks)) : [],
  });
  selectedSectionIndex = song.sections.length - 1;
  publishSongChange(song);
  announce(`${source.name || `Section ${index + 1}`} copied.`);
}

function moveSection(index, direction) {
  if (!canEditSong || AppState.isPlaying()) return;
  const song = updatedSongFromFields();
  const targetIndex = index + direction;
  if (!song.sections[index] || !song.sections[targetIndex]) return;
  if (song.sections[index].startBar === song.sections[targetIndex].startBar) {
    [song.sections[index], song.sections[targetIndex]] = [song.sections[targetIndex], song.sections[index]];
  } else {
    const startBar = song.sections[index].startBar;
    song.sections[index].startBar = song.sections[targetIndex].startBar;
    song.sections[targetIndex].startBar = startBar;
  }
  selectedSectionIndex = targetIndex;
  publishSongChange(song);
  announce(`${song.sections[targetIndex].name} moved ${direction < 0 ? "up" : "down"}.`);
}

async function initialize(callback) {
  refreshApplicationUI = callback || refreshApplicationUI;
  const panel = document.getElementById("song-mode-panel");
  if (!panel) return;

  document.getElementById("song-mode-enabled")?.addEventListener("click", () => {
    const song = AppState.getSong();
    song.enabled = !song.enabled;
    publishSongChange(song);
  });
  panel.addEventListener("change", event => {
    if (event.target.matches("#song-name-input, [data-song-section-name], [data-song-section-start], [data-song-section-tempo], [data-song-section-repeats]")) {
      const shouldRender = !event.target.matches("#song-name-input, [data-song-section-name]");
      publishSongChange(updatedSongFromFields(), shouldRender);
    }
  });


  document.getElementById("add-song-section-btn")?.addEventListener("click", async () => {
    const song = updatedSongFromFields();
    if (song.sections.length >= 32) return;
    song.sections.push({
      name: `Section ${song.sections.length + 1}`,
      startBar: 0,
      tempo: AppState.getTempo(),
      repeats: 1,
    });
    selectedSectionIndex = song.sections.length - 1;
    await publishSongChange(song);
    refreshApplicationUI();
  });
  const sectionList = document.getElementById("song-sections-list");
  sectionList?.addEventListener("focusin", event => {
    const row = event.target.closest(".song-section-row");
    if (!row || !event.target.matches("input, select")) return;
    markSelectedSection(Number.parseInt(row.dataset.sectionIndex, 10));
  });
  sectionList?.addEventListener("click", async event => {
    const row = event.target.closest(".song-section-row");
    if (!row) return;
    const button = event.target.closest("button[data-song-section-action]");
    const index = Number.parseInt(row?.dataset.sectionIndex, 10);
    if (!Number.isInteger(index)) return;
    if (!button) {
      if (!event.target.closest("input, select, summary")) selectSection(index);
      return;
    }
    const action = button.dataset.songSectionAction;
    if (action === "go") {
      goToSection(index);
    } else if (action === "apply") {
      await applySection(index);
    } else if (action === "update") {
      await updateSection(index);
    } else if (action === "copy") {
      copySection(index);
    } else if (action === "move-up") {
      moveSection(index, -1);
    } else if (action === "move-down") {
      moveSection(index, 1);
    } else if (action === "remove" && index >= 0 && AppState.getSong().sections.length > 1 && canEditSong && !AppState.isPlaying()) {
      const song = updatedSongFromFields();
      song.sections.splice(index, 1);
      if (index === 0 && song.sections[0]) song.sections[0].startBar = 0;
      selectedSectionIndex = Math.min(selectedSectionIndex, song.sections.length - 1);
      publishSongChange(song);
    }
  });
  document.getElementById("copy-song-link-btn")?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(await songUrl()); announce("Song link copied."); }
    catch (error) { announce(error.message, true); }
  });
  document.getElementById("share-song-btn")?.addEventListener("click", async () => {
    try {
      const url = await songUrl();
      if (navigator.share) await navigator.share({ title: AppState.getSong().name, text: "Open this Metronominal song", url });
      else await navigator.clipboard.writeText(url);
      announce(navigator.share ? "Song shared." : "Song link copied.");
    } catch (error) { if (error.name !== "AbortError") announce(error.message, true); }
  });
  document.getElementById("export-song-btn")?.addEventListener("click", async () => {
    try {
      const payload = await createPayload();
      const blobUrl = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `${AppState.getSong().name.replace(/[^a-z0-9_-]+/gi, "-") || "metronominal-song"}.metronominal.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
      announce("Song exported.");
    } catch (error) { announce(error.message, true); }
  });
  document.getElementById("import-song-input")?.addEventListener("change", async event => {
    try {
      const file = event.target.files?.[0];
      if (!file || file.size > MAX_IMPORT_BYTES) throw new Error("Song files must be 256 KB or smaller.");
      await applyPayload(JSON.parse(await file.text()));
      announce("Song imported.");
    } catch (error) { announce(error.message, true); }
    event.target.value = "";
  });
  document.addEventListener("appstatechange", render);
  document.addEventListener("songpositionchange", updateNowPlaying);
  document.addEventListener("playbackstatechange", render);
  document.addEventListener("syncrolechange", event => {
    canEditSong = !event.detail || event.detail.state !== "connected" || event.detail.isHost === true;
    render();
  });

  const hashValue = new URL(window.location.href).hash;
  if (hashValue.startsWith("#song=")) {
    try {
      const encoded = hashValue.slice(6);
      if (encoded.length > 140000) throw new Error("Song link is too large.");
      await applyPayload(JSON.parse(decodeBase64Url(encoded)), { allowBeforeConnection: true });
      announce("Shared song loaded.");
    } catch (error) { announce(error.message, true); }
  }
  render();
}

const SongController = { initialize, render, createPayload, applyPayload, songUrl };
export default SongController;
