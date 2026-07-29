import AppState from "./appState.js";
import { sendState } from "./webrtc.js";

const FORMAT = "metronominal-song";
const MAX_IMPORT_BYTES = 256 * 1024;
const FORBIDDEN_KEYS = new Set([
  "hostCredential", "credential", "room", "peerId", "serializedRecordings",
  "recordings", "selectedTheme", "isPlaying", "isRecording", "nextBeatTime", "analyserNode",
  "__proto__", "prototype", "constructor"
]);

let refreshApplicationUI = () => {};
let canEditSong = false;

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
  const privateSounds = new Set(AppState.getRecordings());
  let foundPrivateAlias = true;
  while (foundPrivateAlias) {
    foundPrivateAlias = false;
    for (const [name, definition] of Object.entries(state.customSounds || {})) {
      if (privateSounds.has(definition?.baseSound) && !privateSounds.has(name)) {
        privateSounds.add(name);
        foundPrivateAlias = true;
      }
    }
  }
  state.customSounds = Object.fromEntries(Object.entries(state.customSounds || {})
    .filter(([name]) => !privateSounds.has(name)));
  for (const track of state.Tracks || []) {
    track.currentBar = 0;
    track.currentBeat = 0;
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
  if (!song || song.version !== 1 || typeof song.enabled !== "boolean" || typeof song.name !== "string" || song.name.length < 1 || song.name.length > 80) return false;
  if (!Array.isArray(song.sections) || song.sections.length < 1 || song.sections.length > 32) return false;
  let previousStart = -1;
  const barCount = state.Tracks[0].barSettings.length;
  for (const section of song.sections) {
    if (!section || typeof section.name !== "string" || section.name.length < 1 || section.name.length > 48) return false;
    if (!Number.isInteger(section.startBar) || section.startBar <= previousStart || section.startBar >= barCount) return false;
    if (!Number.isInteger(section.tempo) || section.tempo < 20 || section.tempo > 300) return false;
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
      version: 1,
      enabled: state.song.enabled,
      name: state.song.name,
      sections: state.song.sections.map(section => ({
        name: section.name,
        startBar: section.startBar,
        tempo: section.tempo
      }))
    },
    Tracks: state.Tracks.map(track => ({
      ...(typeof track.name === "string" ? { name: track.name } : {}),
      barSettings: track.barSettings.map(bar => ({ beats: bar.beats, subdivision: Number(bar.subdivision), rests: [...bar.rests] })),
      muted: track.muted === true,
      solo: track.solo === true,
      volume: isFiniteInRange(track.volume, 0, 1) ? track.volume : 1,
      currentBar: 0,
      currentBeat: 0,
      mainBeatSound: reconstructSound(track.mainBeatSound),
      subdivisionSound: reconstructSound(track.subdivisionSound)
    })),
    selectedTrackIndex: Number.isInteger(state.selectedTrackIndex) ? state.selectedTrackIndex : 0,
    selectedBarIndexInContainer: Number.isInteger(state.selectedBarIndexInContainer) ? state.selectedBarIndexInContainer : 0,
    controlsAttachedToTrack: state.controlsAttachedToTrack !== false,
    isRestMode: state.isRestMode === true,
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
  if (!window.isHost || !canEditSong || AppState.isPlaying()) {
    render();
    return;
  }
  AppState.setSong(nextSong);
  if (shouldRender) render();
  sendState(AppState.getCurrentStateForPreset(true));
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
  const hasUnusedBar = song.sections.length < primaryBarCount;
  add.disabled = !editable || song.sections.length >= 32 || (!hasUnusedBar && primaryBarCount >= 64);
  const importInput = document.getElementById("import-song-input");
  if (importInput) importInput.disabled = !editable;
  list.replaceChildren();

  song.sections.forEach((section, index) => {
    const row = document.createElement("div");
    row.className = "song-section-row";
    row.dataset.sectionIndex = String(index);
    const barOptions = Array.from({ length: primaryBarCount }, (_, barIndex) =>
      `<option value="${barIndex + 1}"${barIndex === section.startBar ? " selected" : ""}>Bar ${barIndex + 1}</option>`
    ).join("");
    row.innerHTML = `
      <span class="song-section-number">${index + 1}</span>
      <label>Name <input data-song-section-name="${index}" maxlength="48" value=""></label>
      <label>Starts at bar <select data-song-section-start="${index}">${barOptions}</select></label>
      <label>BPM <input data-song-section-tempo="${index}" type="number" min="20" max="300" value="${section.tempo}"></label>
      <button type="button" data-go-song-section="${index}" aria-label="Start from ${section.name === "" ? "this section" : "section"}">Go</button>
      <button type="button" data-remove-song-section="${index}" aria-label="Remove song section">Remove</button>`;
    const nameInput = row.querySelector(`[data-song-section-name="${index}"]`);
    nameInput.value = section.name;
    for (const field of row.querySelectorAll("input, select")) field.disabled = !editable;
    row.querySelector(`[data-go-song-section="${index}"]`).disabled = !editable;
    row.querySelector(`[data-remove-song-section="${index}"]`).disabled = !editable || index === 0;
    list.appendChild(row);
  });

  const referenceBar = AppState.getTracks()[0]?.currentBar || 0;
  const active = AppState.getSongSectionForBar(referenceBar);
  const now = document.getElementById("song-now-playing");
  if (now) now.textContent = song.enabled
    ? `${active.name} · bar ${referenceBar + 1} · ${active.tempo} BPM`
    : "Song mode off";
}

function updatedSongFromFields() {
  const song = AppState.getSong();
  song.enabled = document.getElementById("song-mode-enabled").getAttribute("aria-pressed") === "true";
  song.name = document.getElementById("song-name-input").value;
  song.sections = song.sections.map((section, index) => ({
    name: document.querySelector(`[data-song-section-name="${index}"]`)?.value || section.name,
    startBar: (Number.parseInt(document.querySelector(`[data-song-section-start="${index}"]`)?.value, 10) || 1) - 1,
    tempo: Number.parseInt(document.querySelector(`[data-song-section-tempo="${index}"]`)?.value, 10) || section.tempo,
  }));
  return song;
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
    if (event.target.matches("input, select")) publishSongChange(updatedSongFromFields(), false);
  });
  document.getElementById("add-song-section-btn")?.addEventListener("click", () => {
    const song = updatedSongFromFields();
    const tracks = AppState.getTracks();
    let barCount = tracks[0]?.barSettings?.length || 1;
    const used = new Set(song.sections.map(section => section.startBar));
    let nextStart = 0;
    while (used.has(nextStart)) nextStart += 1;
    if (nextStart >= barCount && barCount < 64) {
      for (const track of tracks) {
        if (!track.barSettings?.length || track.barSettings.length >= 64) continue;
        const lastBar = track.barSettings[track.barSettings.length - 1];
        track.barSettings.push(JSON.parse(JSON.stringify(lastBar)));
      }
      barCount = tracks[0]?.barSettings?.length || barCount;
    }
    if (nextStart >= barCount) return;
    song.sections.push({ name: `Section ${song.sections.length + 1}`, startBar: nextStart, tempo: AppState.getTempo() });
    publishSongChange(song);
    refreshApplicationUI();
  });
  document.getElementById("song-sections-list")?.addEventListener("click", event => {
    const goIndex = Number.parseInt(event.target.dataset.goSongSection, 10);
    if (Number.isInteger(goIndex) && canEditSong && !AppState.isPlaying()) {
      const section = AppState.getSong().sections[goIndex];
      if (!section) return;
      for (const track of AppState.getTracks()) {
        track.currentBar = section.startBar % track.barSettings.length;
        track.currentBeat = 0;
      }
      render();
      return;
    }
    const index = Number.parseInt(event.target.dataset.removeSongSection, 10);
    if (!Number.isInteger(index) || index <= 0) return;
    const song = updatedSongFromFields();
    song.sections.splice(index, 1);
    publishSongChange(song);
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
  document.addEventListener("songpositionchange", render);
  document.addEventListener("playbackstatechange", render);
  document.addEventListener("syncrolechange", event => {
    canEditSong = event.detail?.state === "connected" && event.detail?.isHost === true;
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
