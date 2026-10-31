import AppState from "./appState.js";
import { emitInteractionMotion } from './interactionMotion.js';
import { receiveSongChange } from "./practiceTransport.js";
import TempoController from "./tempoController.js";
import VolumeController from "./volumeController.js";
import TrackController from "./tracksController.js";
import BarControlsController from "./barControlsController.js";
import MetronomeEngine from "./metronomeEngine.js";

let socket = null;
let roomId = null;
let hostCredential = null;
let receiveCallback = null;
let qrCodeInstance = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let joinRetryTimer = null;
let joinRetryAttempt = 0;
let heartbeatTimer = null;
let timeSyncBurstTimer = null;
let steadyTimeSyncTimer = null;
let pendingTransport = null;
let countInEndsAt = 0;
let scheduledStopTimer = null;
let stateSendTimer = null;
let pendingStatePromise = null;
let acceptingReplacementReplay = false;
let resumePlaybackOnReconnect = false;
let desiredHostPlaybackState = null;
let connectionGeneration = 0;
let lastStateRevision = -1;
let lastTransportRevision = -1;
let transportGeneration = 0;
let intentionallyDisconnected = false;
let joined = false;
let needsRoomScope = false;
let isReadyToPlay = false;
let hasTimeSync = false;
let timeOffset = 0; // Server clock - this browser's clock.
let timeSyncGeneration = 0;
let connectionState = "disconnected";
let localRole = "offline";
let syncClientCount = 0;
let latestRoundTripTime = null;
let lastTimeSyncAt = 0;
let diagnosticsRefreshTimer = null;
let shareControlsInitialized = false;
let receiveChain = Promise.resolve();
const offsetSamples = [];
const pendingTimeSyncRequests = new Map();
const MAX_SYNC_STATE_BYTES = 256 * 1024;
const MAX_OFFSET_SAMPLES = 20;
const SYNC_SCHEMA_VERSION = 1;
const SYNC_CAPABILITIES = ["logical-beats-v1", "practice-v1", "song-boundary-v1", "state-v1", "song-v1", "song-v2", "slices-v1", "beat-overrides-v1", "effects-v1", "rehearsal-v1"];
let lastAcknowledgedStateRevision = -1;
let lastAcknowledgedStateChecksum = null;
let rejectedStateCount = 0;
let authorityGeneration = 0;
let rehearsalSupported = false;
let negotiatedCapabilities = new Set();
let privateSongCommand = null;
let logicalBeatsBlocked = false;
function requiresLogicalBeats(state) {
  const tracks = [...(Array.isArray(state?.Tracks) ? state.Tracks : []), ...(Array.isArray(state?.song?.sections) ? state.song.sections : []).flatMap(s => Array.isArray(s?.tracks) ? s.tracks : [])];
  return tracks.some(t => Array.isArray(t?.barSettings) && t.barSettings.some(b => b && Object.keys(b.beatSlices || {}).length > 0
    && (b.rests?.length > 0 || Object.keys(b.velocities || {}).length > 0 || Object.keys(b.beatSounds || {}).length > 0)));
}
function acceptLogicalBeats(state) {
  if (!requiresLogicalBeats(state) || supportsRoomCapability('logical-beats-v1')) { logicalBeatsBlocked = false; return true; }
  logicalBeatsBlocked = true; explicitReady = false; clearPrivateSongCommand();
  recoveryMessage = 'This music requires logical-beats-v1. Update the synchronization server before sharing or playing sliced beat overrides.';
  stopRoomPlayback(); reportReadiness(); updateDiagnosticsUI(); emitRehearsalRoomChange();
  return false;
}
function clearPrivateSongCommand() { privateSongCommand = null; }
for (const name of ['roomauthoritychange','syncrolechange']) document.addEventListener(name, clearPrivateSongCommand);
document.addEventListener('playbackstatechange', e => { if (e.detail?.playing === false) clearPrivateSongCommand(); });
export function supportsRoomCapability(capability) { return joined && negotiatedCapabilities.has(capability); }
let rehearsalSnapshot = { participants: [], requests: [], cue: null, hostPeerId: null, hostConnected: false, playing: false };
let ownPeerId = null;
let explicitReady = false;
let localPeerName = sessionStorage.getItem('rehearsal_name') || '';
if (!plainText(localPeerName,40)) localPeerName = '';
let participantCredential = null;
let readinessTimer = null;
let recoveryMessage = '';

export function getRehearsalRoomState() {
  return JSON.parse(JSON.stringify({ ...rehearsalSnapshot, supported: rehearsalSupported,
    joined, isHost: joined && window.isHost === true, ownPeerId,
    connectionState, recoveryMessage,
    canRestoreOwnRoom: Boolean(sessionStorage.getItem('host_room_id') && sessionStorage.getItem('host_credential')),
    localName: localPeerName, explicitReady }));
}

function emitRehearsalRoomChange() {
  document.dispatchEvent(new CustomEvent('rehearsalroomchange', { detail: getRehearsalRoomState() }));
}

function invalidateRoomAuthority(reason) {
  authorityGeneration += 1;
  document.dispatchEvent(new CustomEvent('roomauthoritychange', { detail: { reason, generation: authorityGeneration } }));
  return authorityGeneration;
}

function plainText(value, max) {
  return typeof value === 'string' && value.length <= max && !/[<>\x00-\x1f\x7f]/.test(value);
}

function acceptRehearsalSnapshot(message) {
  if (!joined || !rehearsalSupported || !Array.isArray(message.participants) || message.participants.length > 33
    || !Array.isArray(message.requests) || message.requests.length > 33) return;
  const participants = message.participants.filter(p => p && /^[a-f0-9]{16}$/.test(p.peerId)
    && plainText(p.name, 40)).map(p => ({
      peerId: p.peerId, name: p.name, role: p.role === 'host' ? 'host' : 'client', connected: p.connected === true,
      supported: p.supported === true, ready: p.supported === true && typeof p.ready === 'boolean' ? p.ready : null,
      audioState: ['running','suspended','interrupted','closed','unavailable'].includes(p.audioState) ? p.audioState : 'unknown',
      clockQuality: ['good','fair','poor','syncing','offline'].includes(p.clockQuality) ? p.clockQuality : 'unknown',
      rtt: Number.isFinite(p.rtt) && p.rtt >= 0 && p.rtt <= 60000 ? p.rtt : null,
      reportedAt: Number.isFinite(p.reportedAt) ? p.reportedAt : null
    }));
  const cue = message.cue;

  rehearsalSnapshot = { participants, requests: message.requests.filter(id => participants.some(p=>p.peerId===id)),
    hostPeerId: participants.some(p=>p.peerId===message.hostPeerId) ? message.hostPeerId : null,
    hostConnected: message.hostConnected === true, playing: message.playing === true,
    cue: cue && plainText(cue.text,140) && (cue.bar === null || (Number.isInteger(cue.bar) && cue.bar>=0 && cue.bar<=4095))
      && Number.isSafeInteger(cue.sequence) && cue.sequence>0
      ? { text: cue.text, bar: cue.bar, sequence: cue.sequence, sentAt: Number.isFinite(cue.sentAt) ? cue.sentAt : null } : null };

  emitRehearsalRoomChange();
}

function reportReadiness() {
  if (!joined || !rehearsalSupported) return false;
  const d = getSyncDiagnostics();
  return sendMessage({ type:'readiness', ready:explicitReady, name: localPeerName || `Peer ${(ownPeerId || '').slice(0,6)}`,
    audioState: ['running','suspended','interrupted','closed'].includes(d.audioState) ? d.audioState : 'unavailable',
    clockQuality: d.quality, rtt: Number.isFinite(d.medianRtt) ? Math.min(60000,d.medianRtt) : null });
}

export function setRehearsalReadiness(ready, name = localPeerName) {
  if (typeof ready !== 'boolean' || !plainText(name,40)) return false;
  explicitReady = ready && !logicalBeatsBlocked && (!joined || acceptLogicalBeats(AppState.getMusicalSnapshot())); localPeerName = name.trim();
  sessionStorage.setItem('rehearsal_name',localPeerName);
  return reportReadiness();
}
export function requestRehearsalControl() {
  return joined && rehearsalSupported && !window.isHost && sendMessage({type:'control-request'});
}
export function approveRehearsalControl(peerId) {
  return joined && rehearsalSupported && window.isHost && !rehearsalSnapshot.playing
    && rehearsalSnapshot.requests.includes(peerId) && sendMessage({type:'handoff-control',peerId});
}
export function sendRehearsalCue({text,bar = null} = {}) {
  return joined && rehearsalSupported && window.isHost && plainText(text,140) && Boolean(text.trim())
    && (bar === null || (Number.isInteger(bar) && bar>=0 && bar<=4095)) && sendMessage({type:'rehearsal-cue',text,bar});
}
export function resyncRehearsalRoom() {
  if (!joined) return false;
  sendMessage({type:'state-request'}); sendMessage({type:'playback-sync-request'}); requestTimeSync(); return true;
}
export function restoreOwnRehearsalRoom() {
  const storedRoom = sessionStorage.getItem('host_room_id'), credential = sessionStorage.getItem('host_credential');
  if (!storedRoom || !credential) return false;
  disconnect(); roomId = storedRoom; hostCredential = credential; window.isHost = true;
  invalidateRoomAuthority('room-restored');
  participantCredential = sessionStorage.getItem(`rehearsal_session:${roomId}`);
  const nextUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}`;
  window.history.replaceState({path:nextUrl},'',nextUrl);
  intentionallyDisconnected = false; connectToSynchronizationServer(); return true;
}

window.isHost = false;
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

async function checksum(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function synchronizationQuality() {
  if (!joined) return "offline";
  if (!hasTimeSync || !lastTimeSyncAt) return "syncing";
  const medianRtt = median(offsetSamples.map(sample => sample.rtt));
  if (Date.now() - lastTimeSyncAt > 15000 || medianRtt === null) return "poor";
  if (medianRtt <= 100) return "good";
  if (medianRtt <= 250) return "fair";
  return "poor";
}

function diagnosticText(value) {
  return Number.isFinite(value) ? `${Number(value.toFixed(1))} ms` : "—";
}

export function getSyncDiagnostics() {
  const audioContext = AppState.getAudioContext();
  return {
    status: connectionState,
    role: joined ? localRole : "offline",
    quality: synchronizationQuality(),
    peers: syncClientCount,
    latestRtt: latestRoundTripTime,
    medianRtt: median(offsetSamples.map(sample => sample.rtt)),
    bestRtt: offsetSamples.length ? Math.min(...offsetSamples.map(sample => sample.rtt)) : null,
    clockOffset: hasTimeSync ? timeOffset : null,
    sampleAge: lastTimeSyncAt ? Math.max(0, Date.now() - lastTimeSyncAt) : null,
    reconnectAttempt,
    stateRevision: lastStateRevision,
    transportRevision: lastTransportRevision,
    timeSyncReady: hasTimeSync,
    audioState: audioContext?.state || "unavailable",
    schedulerReady: MetronomeEngine.isSchedulerReady(),
    acknowledgedStateRevision: lastAcknowledgedStateRevision,
    acknowledgedStateChecksum: lastAcknowledgedStateChecksum,
    rejectedStateCount
  };
}

function updateDiagnosticsUI() {
  const diagnostics = getSyncDiagnostics();
  const role = document.getElementById("sync-role");
  const quality = document.getElementById("sync-quality");
  if (role) role.textContent = diagnostics.role.toUpperCase();
  if (quality) quality.textContent = diagnostics.quality.toUpperCase();
  document.body.dataset.syncRole = diagnostics.role;
  document.body.dataset.syncQuality = diagnostics.quality;

  const values = {
    role: diagnostics.role[0].toUpperCase() + diagnostics.role.slice(1),
    status: diagnostics.status[0].toUpperCase() + diagnostics.status.slice(1),
    quality: diagnostics.quality[0].toUpperCase() + diagnostics.quality.slice(1),
    rtt: diagnosticText(diagnostics.medianRtt),
    offset: diagnosticText(diagnostics.clockOffset),
    "sample-age": diagnosticText(diagnostics.sampleAge),
    audio: diagnostics.audioState[0].toUpperCase() + diagnostics.audioState.slice(1),
    scheduler: diagnostics.schedulerReady ? "Ready" : "Unavailable",
    peers: String(diagnostics.peers),
    "state-revision": diagnostics.stateRevision >= 0 ? String(diagnostics.stateRevision) : "—",
    "transport-revision": diagnostics.transportRevision >= 0 ? String(diagnostics.transportRevision) : "—"
  };
  for (const [name, value] of Object.entries(values)) {
    const element = document.querySelector(`[data-diagnostic="${name}"]`);
    if (element) element.textContent = value;
  }
}

function revokeLocalHost() {
  window.isHost = false;
  localRole = joined ? 'client' : 'offline';
  invalidateRoomAuthority('host-revoked');
  hostCredential = null;
  resumePlaybackOnReconnect = false;
  acceptingReplacementReplay = false;
  clearDesiredHostPlaybackState();
  clearTimeout(stateSendTimer);
  pendingStatePromise = null;
  if (sessionStorage.getItem('host_room_id') === roomId) {
    sessionStorage.removeItem('host_room_id');
    sessionStorage.removeItem('host_credential');
    sessionStorage.removeItem('is_host');
  }
}

function resetProtocolDiagnostics() {
  clearInterval(readinessTimer);
  readinessTimer = null;
  rehearsalSupported = false;
  negotiatedCapabilities.clear();
  explicitReady = false;
  rehearsalSnapshot = { participants: [], requests: [], cue: null, hostPeerId: null, hostConnected: false, playing: false };
  localRole = "offline";
  lastStateRevision = -1;
  lastTransportRevision = -1;
  lastAcknowledgedStateRevision = -1;
  lastAcknowledgedStateChecksum = null;
  rejectedStateCount = 0;
}

function signalingUrl() {
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return "ws://127.0.0.1:10000";
  }
  return "wss://metronomesignalserver.onrender.com";
}

function logToScreen(message) {
  console.log(message);
  if (new URLSearchParams(window.location.search).get("debug") !== "true") return;

  let box = document.getElementById("debug-log-box");
  if (!box) {
    box = document.createElement("div");
    box.id = "debug-log-box";
    Object.assign(box.style, {
      position: "fixed",
      bottom: "0",
      left: "0",
      width: "100%",
      maxHeight: "150px",
      overflowY: "auto",
      background: "rgba(0,0,0,.85)",
      color: "#0f0",
      fontSize: "10px",
      zIndex: "10000",
      pointerEvents: "none",
      padding: "5px",
      fontFamily: "monospace"
    });
    document.body.appendChild(box);
  }

  const line = document.createElement("div");
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  box.prepend(line);
}

function sendMessage(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify({ ...message, room: message.room || roomId }));
  return true;
}

function sendJoinRequest() {
  return sendMessage({
    type: "join",
    room: roomId,
    requestedRole: window.isHost ? "host" : "client",
    capabilities: SYNC_CAPABILITIES,
    ...(participantCredential ? {participantCredential} : {}),
    ...(window.isHost ? { hostCredential } : {})
  });
}

function scheduleJoinRetry() {
  if (window.isHost || joinRetryTimer || !socket || socket.readyState !== WebSocket.OPEN) return;
  const delay = Math.min(30000, 500 * (2 ** joinRetryAttempt));
  joinRetryAttempt += 1;
  joinRetryTimer = setTimeout(() => {
    joinRetryTimer = null;
    sendJoinRequest();
  }, delay);
}

function updateDisconnectBtnVisibility() {
  const disconnectBtn = document.getElementById("disconnect-btn");
  if (!disconnectBtn) return;

  const hasConnectedPeers = syncClientCount > 0 || (!window.isHost && connectionState === "connected");
  const shouldShow = connectionState === "connected" && hasConnectedPeers;

  disconnectBtn.classList.toggle("visible", shouldShow);
  disconnectBtn.style.display = shouldShow ? "inline-flex" : "none";
  if (shouldShow) {
    disconnectBtn.textContent = "DISCONNECT";
    disconnectBtn.setAttribute(
      "aria-label",
      window.isHost ? "Disconnect all clients" : "Disconnect from this room"
    );
  }
}

function updateConnectionStatusUI(state) {
  connectionState = state;
  emitRehearsalRoomChange();
  const shareBtn = document.getElementById("share-btn");
  const status = document.getElementById("connection-status");
  if (!shareBtn || !status) return;

  shareBtn.classList.remove("connected", "connecting", "failed", "disconnected");
  status.textContent = state === "connected" ? "●" : state === "connecting" ? "…" : "";
  status.setAttribute("aria-label", `Synchronization ${state}`);

  if (state === "connected") {
    shareBtn.classList.add("connected");
  } else if (state === "connecting") {
    shareBtn.classList.add("connecting");
  } else if (state === "failed") {
    shareBtn.classList.add("failed");
  } else {
    shareBtn.classList.add("disconnected");
  }

  updateDisconnectBtnVisibility();

  const countInSelect = document.getElementById("count-in-bars-select");
  if (countInSelect) countInSelect.disabled = state !== "connected" || !window.isHost;
  document.dispatchEvent(new CustomEvent("syncrolechange", {
    detail: { state, isHost: window.isHost === true }
  }));
  updateDiagnosticsUI();
}

function updateClientCount(count = 0) {
  syncClientCount = count;
  const connectionCount = document.getElementById("n-of-connections");
  if (!connectionCount) return;
  const shareBtn = document.getElementById("share-btn");
  connectionCount.textContent = `(${count})`;
  connectionCount.setAttribute(
    "aria-label",
    `${count} connected ${count === 1 ? "peer" : "peers"}`
  );
  if (shareBtn) {
    shareBtn.classList.toggle("has-peers", count > 0);
    shareBtn.setAttribute("aria-label", `Share room; ${count} connected ${count === 1 ? "peer" : "peers"}`);
  }
  updateDisconnectBtnVisibility();
  updateDiagnosticsUI();
}

function privateNetworkSoundNames() {
  const names = new Set(AppState.getRecordings());
  let changed = true;
  while (changed) {
    changed = false;
    for (const name of AppState.getCustomSounds()) {
      const baseSound = AppState.getCustomSoundData(name)?.baseSound;
      if (names.has(baseSound) && !names.has(name)) {
        names.add(name);
        changed = true;
      }
    }
  }
  return names;
}

function sanitizeNetworkSound(sound, privateNames, fallback) {
  if (!sound || typeof sound !== "object") return { sound: fallback, settings: {} };
  return {
    ...sound,
    sound: privateNames.has(sound.sound) ? fallback : String(sound.sound).slice(0, 64),
    settings: sound.settings && typeof sound.settings === "object" ? sound.settings : {},
  };
}

function sanitizeNetworkTrack(track, privateNames) {
  if (!track || typeof track !== "object") return track;
  const sanitizeBar = (bar) => ({
    ...bar,
    beatSounds: Object.fromEntries(Object.entries(bar.beatSounds || {}).map(([index, overrides]) => [index, {
      ...overrides,
      ...(overrides?.mainBeatSound ? { mainBeatSound: sanitizeNetworkSound(overrides.mainBeatSound, privateNames, "Synth Kick") } : {}),
      ...(overrides?.subdivisionSound ? { subdivisionSound: sanitizeNetworkSound(overrides.subdivisionSound, privateNames, "Synth HiHat") } : {}),
    }])),
  });
  return {
    ...track,
    barSettings: Array.isArray(track.barSettings) ? track.barSettings.map(sanitizeBar) : track.barSettings,
    mainBeatSound: sanitizeNetworkSound(track.mainBeatSound, privateNames, "Synth Kick"),
    subdivisionSound: sanitizeNetworkSound(track.subdivisionSound, privateNames, "Synth HiHat"),
  };
}
function clearDesiredHostPlaybackState() {
  desiredHostPlaybackState = null;
  const playButton = document.getElementById("start-stop-btn");
  if (playButton) {
    const isPlaying = AppState.isPlaying();
    playButton.textContent = isPlaying ? "■" : "▶";
    playButton.classList.remove("pending");
    playButton.classList.toggle("active", isPlaying);
  }
}

function refreshUIFromState() {
  TempoController.updateTempoDisplay({ animate: true });
  VolumeController.updateVolumeDisplay({ animate: true });
  const countInSelect = document.getElementById("count-in-bars-select");
  if (countInSelect) countInSelect.value = String(AppState.getCountInBars());
  TrackController.renderTracks();
  BarControlsController.updateBarControlsForSelectedTrack();
}

function updateTimeOffset(newOffset, roundTripTime) {
  offsetSamples.push({ offset: newOffset, rtt: roundTripTime });
  if (offsetSamples.length > MAX_OFFSET_SAMPLES) offsetSamples.shift();
  const best = offsetSamples.reduce((current, sample) => sample.rtt < current.rtt ? sample : current);
  timeOffset = best.offset;
  latestRoundTripTime = roundTripTime;
  lastTimeSyncAt = Date.now();
}

function requestTimeSync() {
  const t0 = Date.now();
  pendingTimeSyncRequests.set(t0, {
    generation: timeSyncGeneration,
    startedAt: performance.now()
  });
  while (pendingTimeSyncRequests.size > MAX_OFFSET_SAMPLES) {
    pendingTimeSyncRequests.delete(pendingTimeSyncRequests.keys().next().value);
  }
  if (!sendMessage({ type: "time-sync", t0 })) pendingTimeSyncRequests.delete(t0);
}

function stopTimeSync() {
  timeSyncGeneration += 1;
  clearInterval(timeSyncBurstTimer);
  clearInterval(steadyTimeSyncTimer);
  timeSyncBurstTimer = null;
  steadyTimeSyncTimer = null;
  pendingTimeSyncRequests.clear();
  offsetSamples.length = 0;
  hasTimeSync = false;
  timeOffset = 0;
  latestRoundTripTime = null;
  lastTimeSyncAt = 0;
  updateDiagnosticsUI();
}

function startTimeSync() {
  stopTimeSync();
  let samplesSent = 0;
  timeSyncBurstTimer = setInterval(() => {
    requestTimeSync();
    samplesSent += 1;
    if (samplesSent >= 10) {
      clearInterval(timeSyncBurstTimer);
      timeSyncBurstTimer = null;
      if (joined) steadyTimeSyncTimer = setInterval(requestTimeSync, 5000);
    }
  }, 100);
  requestTimeSync();
}

function localTimestamp(serverTimestamp) {
  return Number(serverTimestamp) - timeOffset;
}

function stopAt(serverTimestamp, generation) {
  clearTimeout(scheduledStopTimer);
  const delay = Math.max(0, localTimestamp(serverTimestamp) - Date.now());
  scheduledStopTimer = setTimeout(() => {
    if (generation !== transportGeneration) return;
    MetronomeEngine.cancelPlayback();
  }, delay);
}

function invalidatePendingTransport() {
  transportGeneration += 1;
  pendingTransport = null;
  countInEndsAt = 0;
  MetronomeEngine.cancelCountIn();
  clearTimeout(scheduledStopTimer);
  scheduledStopTimer = null;
}

function stopRoomPlayback() {
  invalidatePendingTransport();
  clearTimeout(stateSendTimer);
  stateSendTimer = null;
  pendingStatePromise = null;
  MetronomeEngine.cancelPlayback();
}

function hasValidCountIn(message) {
  if (message.countIn === undefined) return true;
  const countIn = message.countIn;
  if (!message.playing || !countIn || typeof countIn !== "object"
    || !Number.isFinite(Number(countIn.startsAt))
    || !Number.isInteger(countIn.totalBeats) || countIn.totalBeats < 1 || countIn.totalBeats > 512
    || !Number.isFinite(Number(countIn.beatIntervalMs)) || countIn.beatIntervalMs < 150 || countIn.beatIntervalMs > 3000
    || !Number.isInteger(countIn.accentEvery) || countIn.accentEvery < 1 || countIn.accentEvery > 64) return false;
  const expectedEffectiveAt = Number(countIn.startsAt) + countIn.totalBeats * countIn.beatIntervalMs;
  return Math.abs(Number(message.effectiveAt) - expectedEffectiveAt) < 2;
}

function applyTransport(message) {
  if (logicalBeatsBlocked) return;
  if (!joined) return;
  if (!message || typeof message.playing !== "boolean"
    || !Number.isFinite(Number(message.effectiveAt))
    || !Number.isInteger(message.currentBar)
    || !Number.isInteger(message.currentBeat)
    || !Number.isInteger(message.revision)
    || message.currentBar < 0 || message.currentBar > 4095
    || message.currentBeat < 0 || message.currentBeat > 4095
    || !hasValidCountIn(message)) return;
  if (message.revision < lastTransportRevision) return;
  if (window.isHost && desiredHostPlaybackState !== null && !acceptingReplacementReplay) {
    lastTransportRevision = message.revision;
    if (message.playing !== desiredHostPlaybackState) return;
    clearDesiredHostPlaybackState();
  }
  pendingTransport = message;
  if (!isReadyToPlay || !hasTimeSync) return;

  lastTransportRevision = message.revision;
  transportGeneration += 1;
  const generation = transportGeneration;
  countInEndsAt = message.countIn ? Number(message.effectiveAt) : 0;
  MetronomeEngine.cancelCountIn();
  clearTimeout(scheduledStopTimer);

  if (message.playing) {
    if (message.countIn) {
      void MetronomeEngine.scheduleCountIn({
        ...message.countIn,
        startsAt: localTimestamp(message.countIn.startsAt)
      }, () => generation === transportGeneration).catch(error => console.warn("Could not schedule synchronized count-in:", error));
    }
    void MetronomeEngine.scheduleStart(
      localTimestamp(message.effectiveAt),
      message.currentBar || 0,
      message.currentBeat || 0,
      message.repeatIteration || 0,
      () => generation === transportGeneration,
      localTimestamp(Number.isFinite(message.practiceEpochAt) ? message.practiceEpochAt : message.effectiveAt)
    ).catch(error => console.warn("Could not schedule synchronized playback:", error));
  } else {
    stopAt(message.effectiveAt, generation);
  }
  pendingTransport = null;
}

async function handleStateMessage(message, generation) {
  const roleGeneration = authorityGeneration, expectedRoom = roomId, expectedSocket = socket;
  const current = () => generation === connectionGeneration && roleGeneration === authorityGeneration
    && expectedRoom === roomId && expectedSocket === socket && joined;
  if (!current()) return;
  if ((window.isHost && !acceptingReplacementReplay && !message.authoritativeRefresh)
    || !message.payload || !Number.isInteger(message.revision)) return;
  if (message.revision <= lastStateRevision && !message.authoritativeRefresh) return;
  if (message.schemaVersion !== undefined && message.schemaVersion !== SYNC_SCHEMA_VERSION) return;
  if (message.capabilities && !Array.isArray(message.capabilities)) return;
  const { selectedTheme: _ignoredTheme, ...state } = message.payload;
  if (!acceptLogicalBeats(state)) return;
  const serializedState = JSON.stringify(state);
  const payloadBytes = new TextEncoder().encode(serializedState).byteLength;
  const actualChecksum = message.checksum ? await checksum(state) : null;
  if (!current()) return;
  if (payloadBytes > MAX_SYNC_STATE_BYTES || (message.payloadBytes !== undefined && message.payloadBytes !== payloadBytes)
    || (message.checksum && message.checksum !== actualChecksum)
    || !AppState.validateNetworkState(state)) {
    rejectedStateCount += 1;
    sendMessage({ type: "state-recovery-request", reason: "invalid-state-payload", revision: message.revision });
    console.warn("Rejected invalid synchronized state payload");
    updateDiagnosticsUI();
    return;
  }
  const previousState = await AppState.getCurrentStateForPreset(true);
  if (!current()) return;
  try {
    await AppState.loadPresetData({ ...state, isPlaying: false }, { guard: current, source: 'network' });
    if (!current()) return;
  } catch (error) {
    if (!current()) return;
    await AppState.loadPresetData(previousState, { guard: current });
    if (!current()) return;
    console.error("Could not apply synchronized state payload:", error);
    return;
  }
  const acknowledgedChecksum = message.checksum || await checksum(state);
  if (!current()) return;
  lastStateRevision = message.revision;
  lastAcknowledgedStateRevision = message.revision;
  lastAcknowledgedStateChecksum = acknowledgedChecksum;
  sendMessage({ type: "state-ack", revision: message.revision, checksum: lastAcknowledgedStateChecksum });
  if (generation !== connectionGeneration || !joined) return;
  if (receiveCallback) receiveCallback(state);
  else refreshUIFromState();
}

async function handleSocketMessage(event, generation) {
  if (generation !== connectionGeneration) return;
  const roleGeneration = authorityGeneration, expectedRoom = roomId, expectedSocket = socket;
  const current = () => generation === connectionGeneration && roleGeneration === authorityGeneration
    && expectedRoom === roomId && expectedSocket === socket;
  let message;
  try {
    message = JSON.parse(event.data);
  } catch (error) {
    console.error("Invalid synchronization message:", error);
    return;
  }
  if (generation !== connectionGeneration) return;
  if (message.room && message.room !== roomId) return;

  switch (message.type) {
    case "joined":
      joined = true;
      negotiatedCapabilities = new Set(Array.isArray(message.capabilities) ? message.capabilities.filter(c => typeof c === "string").slice(0,32) : []);
      logicalBeatsBlocked = false;
      rehearsalSupported = Array.isArray(message.capabilities) && message.capabilities.includes('rehearsal-v1');
      recoveryMessage = '';
      ownPeerId = message.peerId;
      if (typeof message.participantCredential === 'string' && /^[a-f0-9]{64}$/.test(message.participantCredential)) {
        participantCredential = message.participantCredential;
        sessionStorage.setItem(`rehearsal_session:${roomId}`,participantCredential);
      }
      clearInterval(readinessTimer);
      if (rehearsalSupported) readinessTimer = setInterval(reportReadiness,2000);
      reconnectAttempt = 0;
      joinRetryAttempt = 0;
      clearTimeout(joinRetryTimer);
      joinRetryTimer = null;
      window.isHost = Boolean(message.isHost);
      localRole = window.isHost ? "host" : "client";
      acceptingReplacementReplay = Boolean(message.replacedHost && message.isHost);
      lastStateRevision = -1;
      lastTransportRevision = -1;
      updateClientCount(message.clientCount || 0);
      updateConnectionStatusUI("connected");
      if (window.isHost) {
        const wasPlaying = AppState.isPlaying() || resumePlaybackOnReconnect;
        const queuedPlay = desiredHostPlaybackState === true;
        resumePlaybackOnReconnect = false;
        isReadyToPlay = true;
        sessionStorage.setItem("host_room_id", roomId);
        sessionStorage.setItem("host_credential", hostCredential);
        sessionStorage.setItem("is_host", "true");
        if (acceptingReplacementReplay) {
          if (wasPlaying) await MetronomeEngine.togglePlay(true);
          if (!current() || !joined || !window.isHost) return;
        } else {
          pendingStatePromise = AppState.getCurrentStateForPreset(true);
          clearTimeout(stateSendTimer);
          await flushState();
          if (!current() || !joined || !window.isHost) return;
          if (queuedPlay) publishDesiredHostPlaybackState();
          else if (wasPlaying) broadcastScheduledPlay();
        }
      } else {
        clearDesiredHostPlaybackState();
        // Joining someone else's room must not erase the recoverable own-room
        // session. Explicit handoff/replacement revokes it separately.
        const modal = document.getElementById("connection-modal");
        if (modal) modal.style.display = "block";
      }
      startTimeSync();
      reportReadiness();
      break;

    case 'rehearsal-room':
      acceptRehearsalSnapshot(message);
      break;

    case 'role-changed':
      if (message.isHost !== false) break;
      revokeLocalHost();
      stopRoomPlayback();
      localRole = 'client';
      updateConnectionStatusUI('connected');
      break;

    case 'host-granted':
      if (!joined || !rehearsalSupported || !/^[a-f0-9]{64}$/.test(message.hostCredential)) break;
      invalidateRoomAuthority('host-handoff');
      stopRoomPlayback();
      clearDesiredHostPlaybackState();
      hostCredential = message.hostCredential;
      window.isHost = true;
      localRole = 'host';
      isReadyToPlay = true;
      sessionStorage.setItem('host_room_id',roomId);
      sessionStorage.setItem('host_credential',hostCredential);
      sessionStorage.setItem('is_host','true');
      updateConnectionStatusUI('connected');
      break;

    case "presence":
      updateClientCount(message.clientCount || 0);
      break;

    case "state":
      await handleStateMessage(message, generation);
      break;

    case "state-ack":
      if (window.isHost && Number.isInteger(message.revision) && typeof message.checksum === "string") {
        lastAcknowledgedStateRevision = message.revision;
        lastAcknowledgedStateChecksum = message.checksum;
        updateDiagnosticsUI();
      }
      break;

    case "state-recovery-request":
      if (window.isHost) {
        pendingStatePromise = AppState.getCurrentStateForPreset(true);
        clearTimeout(stateSendTimer);
        await flushState();
      }
      break;

    case 'song-change':
      if (joined && current()) {
        if (!message.cancelled && !acceptLogicalBeats({...AppState.getMusicalSnapshot(),song:message.song})) break;
        const local = privateSongCommand;
        if (message.cancelled) {
          if (!message.commandId || message.commandId === local?.commandId) clearPrivateSongCommand();
          receiveSongChange(message);
        } else {
          const own = window.isHost && local && local.generation === authorityGeneration
            && message.commandId === local.commandId && JSON.stringify({version:message.version,song:message.song,sectionIndex:message.sectionIndex,startBar:message.startBar,effectiveAt:message.effectiveAt,commandId:message.commandId}) === local.identity;
          receiveSongChange(own ? {...message, song:local.song} : message);
          if (own) clearPrivateSongCommand();
        }
      }
      break;
    case "transport":
      applyTransport(message);
      break;

    case "playback-sync-pulse":
      if (!window.isHost && isReadyToPlay && AppState.isPlaying()
        && Number.isInteger(message.revision)
        && message.revision >= lastTransportRevision
        && Number.isInteger(message.currentBar) && message.currentBar >= 0 && message.currentBar <= 4095
        && Number.isInteger(message.currentBeat) && message.currentBeat >= 0 && message.currentBeat <= 4095
        && (message.repeatIteration === undefined
          || (Number.isInteger(message.repeatIteration) && message.repeatIteration >= 0 && message.repeatIteration <= 15))
        && Number.isFinite(Number(message.nextBeatWallTime))) {
        MetronomeEngine.handleSyncPulse(
          localTimestamp(message.nextBeatWallTime),
          message.currentBar,
          message.currentBeat,
          message.repeatIteration || 0
        );
      }
      break;

    case "time-sync-response": {
      const request = pendingTimeSyncRequests.get(message.t0);
      if (!joined || !request || request.generation !== timeSyncGeneration) break;
      pendingTimeSyncRequests.delete(message.t0);
      const rtt = performance.now() - request.startedAt;
      const offset = message.serverTime - (message.t0 + rtt / 2);
      updateTimeOffset(offset, rtt);
      hasTimeSync = true;
      updateDiagnosticsUI();
      if (pendingTransport && isReadyToPlay) applyTransport(pendingTransport);
      break;
    }

    case "pong":
      break;

    case "room-closed":
      joined = false;
      invalidateRoomAuthority('room-closed');
      stopRoomPlayback();
      recoveryMessage = 'This room is closed. Ask the host for a new link; a closed room cannot be restored.';
      if (rehearsalSupported) {
        intentionallyDisconnected = true;
        clearTimeout(joinRetryTimer);
        joinRetryTimer = null;
        if (sessionStorage.getItem('host_room_id') === roomId) revokeLocalHost();
      }
      resetProtocolDiagnostics();
      acceptingReplacementReplay = false;
      clearDesiredHostPlaybackState();
      invalidatePendingTransport();
      stopTimeSync();
      updateClientCount(0);
      updateConnectionStatusUI("disconnected");
      if (AppState.isPlaying()) MetronomeEngine.togglePlay(true);
      if (!window.isHost) logToScreen("The host has disconnected.");
      if (!intentionallyDisconnected) scheduleJoinRetry();
      break;

    case "host-replaced":
      intentionallyDisconnected = true;
      joined = false;
      revokeLocalHost();
      stopRoomPlayback();
      resetProtocolDiagnostics();
      acceptingReplacementReplay = false;
      clearDesiredHostPlaybackState();
      invalidatePendingTransport();
      stopTimeSync();
      window.isHost = false;
      sessionStorage.removeItem("host_room_id");
      sessionStorage.removeItem("host_credential");
      sessionStorage.removeItem("is_host");
      updateClientCount(0);
      updateConnectionStatusUI("disconnected");
      if (AppState.isPlaying()) MetronomeEngine.togglePlay(true);
      break;

    case "replacement-replay-complete": {
      if (!acceptingReplacementReplay) break;
      if (!window.isHost || !joined) {
        acceptingReplacementReplay = false;
        break;
      }

      pendingStatePromise = AppState.getCurrentStateForPreset(true);
      await flushState();
      if (!current() || !window.isHost || !joined) break;

      // Keep outbound settings and transport gated until the retained replay
      // has been consumed and the replacement's authoritative snapshot flushed.
      acceptingReplacementReplay = false;
      const desiredPlayback = desiredHostPlaybackState;
      if (desiredPlayback === false && !AppState.isPlaying()) {
        clearDesiredHostPlaybackState();
      } else if (desiredPlayback !== null) {
        publishDesiredHostPlaybackState();
      } else if (AppState.isPlaying()) {
        broadcastScheduledPlay();
      }
      break;
    }

    case "error":
      console.error(`Synchronization server error (${message.code}): ${message.message}`);
      if (['incompatible-client','invalid-song-change'].includes(message.code)) {
        clearPrivateSongCommand(); explicitReady = false;
        recoveryMessage = message.message || 'Incompatible room semantics.';
        reportReadiness(); updateDiagnosticsUI(); emitRehearsalRoomChange();
      }
      if (['invalid-host-credential','room-closed','room-expired'].includes(message.code)) {
        authorityGeneration += 1;
        joined = false;
        intentionallyDisconnected = true;
        clearTimeout(joinRetryTimer); clearTimeout(reconnectTimer);
        joinRetryTimer = null; reconnectTimer = null;
        revokeLocalHost(); resetProtocolDiagnostics(); invalidatePendingTransport(); stopTimeSync();
        recoveryMessage = message.code === 'invalid-host-credential'
          ? 'Host credential was rejected. This session cannot restore that room. Ask the current host for a link or create a new room.'
          : 'This room is closed or expired. Ask for a new room link; the old room cannot be restored.';
        updateConnectionStatusUI('failed');
      }
      if (message.code === "room-not-found") {
        recoveryMessage = 'The room is unavailable. The rightful host may reconnect; otherwise ask for a new link.';
        updateConnectionStatusUI("failed");
        logToScreen("This room is no longer available. Ask the host for a new link.");
        scheduleJoinRetry();
      }
      break;

    default:
      console.warn("Unknown synchronization message:", message.type);
  }
}

function scheduleReconnect() {
  if (intentionallyDisconnected || reconnectTimer) return;
  const delay = Math.min(15000, 1000 * (2 ** Math.min(reconnectAttempt, 4)));
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectToSynchronizationServer();
  }, delay);
}

function connectToSynchronizationServer() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  updateConnectionStatusUI("connecting");
  logToScreen(`Connecting to ${signalingUrl()} for room ${roomId}`);
  hasTimeSync = false;
  offsetSamples.length = 0;
  const generation = ++connectionGeneration;
  const currentSocket = new WebSocket(signalingUrl());
  socket = currentSocket;

  let helloTimer = null, helloChallenge = null, joinSent = false;
  let pendingReceipts = 0;
  let receivedHostPeerId;
  const finishHello = scope => {
    if (joinSent || generation !== connectionGeneration || socket !== currentSocket) return;
    joinSent = true;
    clearTimeout(helloTimer);
    if (scope && needsRoomScope && window.isHost) {
      roomId = `v2_${scope}_${roomId}`;
      sessionStorage.setItem('host_room_id', roomId);
      const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}`;
      window.history.replaceState({path:url}, '', url);
    }
    needsRoomScope = false;
    // A v2 identity must never be presented to an old server's suffix-only
    // proof validator. New legacy identities still support server-first rollout.
    if (!scope && roomId?.startsWith('v2_')) {
      joined = false;
      intentionallyDisconnected = true;
      recoveryMessage = 'This server cannot safely restore this room. Ask for a new room link.';
      updateConnectionStatusUI('failed');
      currentSocket.close();
      return;
    }
    sendJoinRequest();
  };
  currentSocket.onopen = () => {
    if (generation !== connectionGeneration || socket !== currentSocket) return;
    reconnectAttempt = 0;
    helloChallenge = [...crypto.getRandomValues(new Uint8Array(16))].map(n=>n.toString(16).padStart(2,'0')).join('');
    sendMessage({type:'hello',challenge:helloChallenge});
    helloTimer = setTimeout(()=>finishHello(null),500);
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => sendMessage({ type: "ping", t0: Date.now() }), 25000);
  };

  receiveChain = Promise.resolve();
  currentSocket.onmessage = event => {
    // Revocation must not wait behind a pending preset/checksum operation.
    try {
      const immediate = JSON.parse(event.data);
      if (immediate.type === 'hello') {
        if (generation === connectionGeneration && socket === currentSocket
          && immediate.challenge === helloChallenge && /^[a-f0-9]{32}$/.test(immediate.roomScope)
          && immediate.capabilities?.includes('room-scope-v2')) finishHello(immediate.roomScope);
        return;
      }
      if (!joinSent && immediate.type === 'error' && ['unknown-type','not-joined'].includes(immediate.code)) {
        finishHello(null);
        return;
      }
      if (generation === connectionGeneration && currentSocket === socket
        && (!immediate.room || immediate.room === roomId) && immediate.type === 'rehearsal-room'
        && Array.isArray(immediate.participants) && immediate.participants.length <= 33
        && Array.isArray(immediate.requests) && immediate.requests.length <= 33) {
        const nextHost = immediate.participants.some(p => p && p.peerId === immediate.hostPeerId
          && /^[a-f0-9]{16}$/.test(p.peerId) && plainText(p.name,40)) ? immediate.hostPeerId : null;
        // Initial host discovery must not cancel the joined replay. Later host
        // transitions invalidate at receipt, never midway through queued work.
        if (receivedHostPeerId !== undefined && receivedHostPeerId !== nextHost) invalidateRoomAuthority('room-host-changed');
        receivedHostPeerId = nextHost;
      }
      if (generation === connectionGeneration && currentSocket === socket
        && (!immediate.room || immediate.room === roomId)
        && ['role-changed','host-replaced','room-closed','host-granted'].includes(immediate.type)) {
        // Control transitions have no awaited work: apply their complete effects
        // in wire receipt order, including private grant storage. Never replay
        // them behind an older asynchronous snapshot or bypass its epoch guard.
        void handleSocketMessage(event, generation).catch(error => console.error('Could not apply authority transition:', error));
        // A grant and its following roster describe one authority, not two.
        // Record its identity now so the roster cannot invalidate intervening
        // transport/state packets admitted under that legitimate grant.
        if (immediate.type === 'host-granted' && joined && window.isHost
          && hostCredential === immediate.hostCredential) receivedHostPeerId = ownPeerId;
        return;
      }
    } catch { /* Normal parser below reports malformed messages. */ }
    const receiptAuthority = authorityGeneration;
    if (++pendingReceipts > 128) {
      joined = false;
      invalidateRoomAuthority('receive-overflow');
      stopRoomPlayback();
      currentSocket.close(4008, 'Receive queue limit');
      return;
    }
    receiveChain = receiveChain
      .then(() => {
        if (generation !== connectionGeneration || socket !== currentSocket
          || receiptAuthority !== authorityGeneration) return;
        return handleSocketMessage(event, generation);
      })
      .catch(error => console.error("Could not process synchronized message:", error))
      .finally(() => { pendingReceipts -= 1; });
  };
  currentSocket.onerror = error => {
    if (generation === connectionGeneration && socket === currentSocket) {
      if (reconnectAttempt <= 1) {
        console.warn("Synchronization WebSocket unavailable (standalone mode)");
      }
    }
  };
  currentSocket.onclose = () => {
    if (generation !== connectionGeneration || socket !== currentSocket) return;
    clearTimeout(helloTimer);
    const wasJoined = joined;
    connectionGeneration += 1;
    resumePlaybackOnReconnect = !intentionallyDisconnected && window.isHost && AppState.isPlaying() && wasJoined;
    joined = false;
    invalidateRoomAuthority('connection-lost');
    resetProtocolDiagnostics();
    clearDesiredHostPlaybackState();
    invalidatePendingTransport();
    stopRoomPlayback();
    clearInterval(heartbeatTimer);
    stopTimeSync();
    clearTimeout(joinRetryTimer);
    joinRetryTimer = null;
    updateClientCount(0);
    updateConnectionStatusUI("disconnected");
    scheduleReconnect();
  };
}

const COLORS = [
  "Red", "Orange", "Yellow", "Green", "Blue", "Indigo", "Violet", "Pink", "Crimson", "Scarlet",
  "Coral", "Gold", "Amber", "Lime", "Emerald", "Teal", "Cyan", "Azure", "Cobalt", "Navy",
  "Lavender", "Plum", "Magenta", "Maroon", "Silver", "Jade", "Ruby", "Onyx", "Pearl", "Ivory"
];
const ANIMALS = [
  "Lion", "Tiger", "Bear", "Wolf", "Fox", "Eagle", "Hawk", "Owl", "Shark", "Whale",
  "Dolphin", "Panda", "Koala", "Otter", "Seal", "Falcon", "Raven", "Swan", "Crane", "Heron",
  "Parrot", "Macaw", "Gecko", "Iguana", "Turtle", "Rabbit", "Deer", "Moose", "Bison", "Horse"
];

async function generateHostIdentity() {
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const number = Math.floor(Math.random() * 90) + 10;
  const secretBytes = crypto.getRandomValues(new Uint8Array(32));
  const credential = Array.from(secretBytes, byte => byte.toString(16).padStart(2, "0")).join("");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credential));
  const roomProof = Array.from(new Uint8Array(digest).slice(0, 16), byte => byte.toString(16).padStart(2, "0")).join("");
  return { room: `${color}_${animal}_${number}_${roomProof}`, credential };
}

export function initializeShareControls() {
  const shareBtn = document.getElementById("share-btn");
  const shareModal = document.getElementById("share-modal");
  const closeBtn = shareModal?.querySelector(".close-button");
  const qrContainer = document.getElementById("qrcode");
  const mobileShareBtn = document.getElementById("mobile-share-btn");
  const diagnosticsBtn = document.getElementById("sync-diagnostics-btn");
  const diagnosticsPanel = document.getElementById("sync-diagnostics-panel");
  const shareContent = shareModal?.querySelector(".share-modal-content");

  if (!shareBtn || !shareModal || !closeBtn || !qrContainer) return;
  if (shareControlsInitialized) return;
  shareControlsInitialized = true;
  if (navigator.share && mobileShareBtn) mobileShareBtn.style.display = "flex";
  clearInterval(diagnosticsRefreshTimer);
  diagnosticsRefreshTimer = setInterval(updateDiagnosticsUI, 1000);

  let shareFeedbackEpoch = 0, shareFeedbackAction = 0, copyResetTimer = null;
  let copyFeedbackOwner = null, copyFeedbackLabel = '', copyFeedbackRevision = 0;
  const invalidateShareFeedback = () => {
    ++shareFeedbackEpoch; ++shareFeedbackAction; ++copyFeedbackRevision;
    clearTimeout(copyResetTimer); copyResetTimer = null;
    if (copyFeedbackOwner?.isConnected) copyFeedbackOwner.textContent = copyFeedbackLabel;
    const copyButton = document.getElementById("copy-link-btn");
    if (copyButton) copyButton.onclick = null;
    if (mobileShareBtn) mobileShareBtn.onclick = null;
    qrContainer.replaceChildren();
    qrContainer.removeAttribute('title');
    qrCodeInstance = null;
  };

  const closeDiagnostics = (focusButton = false, acknowledge = true) => {
    if (!diagnosticsPanel || diagnosticsPanel.hidden) return;
    diagnosticsPanel.hidden = true;
    shareContent?.classList.remove("diagnostics-expanded");
    diagnosticsBtn?.setAttribute("aria-expanded", "false");
    if (focusButton) diagnosticsBtn?.focus();
    if (acknowledge && shareModal.style.display === 'block') emitInteractionMotion(diagnosticsBtn, 'close');
  };

  shareBtn.addEventListener("click", () => {
    if (!roomId) { emitInteractionMotion(shareBtn, 'refuse'); return; }
    const wasOpen = shareModal.style.display === 'block';
    invalidateShareFeedback();
    const presentation = shareFeedbackEpoch, roomAtOpen = roomId, authorityAtOpen = authorityGeneration;
    const isCurrent = () => presentation === shareFeedbackEpoch && roomAtOpen === roomId
      && authorityAtOpen === authorityGeneration && shareModal.isConnected && shareModal.style.display === 'block';
    const isActionCurrent = action => action !== null && isCurrent() && action === shareFeedbackAction;
    const shareUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}`;
    qrContainer.innerHTML = "";
    try {
      qrCodeInstance = new QRCode(qrContainer, {
        text: shareUrl,
        width: 256,
        height: 256,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
      });
    } catch (error) {
      emitInteractionMotion(shareBtn, 'refuse');
      throw error;
    }

    const copyButton = document.getElementById("copy-link-btn");
    if (copyButton) {
      copyFeedbackOwner = copyButton; copyFeedbackLabel = copyButton.textContent;
      const originalText = copyFeedbackLabel;
      copyButton.onclick = async () => {
        if (!isCurrent()) return;
        const action = ++shareFeedbackAction;
        try {
          await navigator.clipboard.writeText(shareUrl);
          if (!isActionCurrent(action) || !copyButton.isConnected) return;
          copyButton.textContent = "Copied!";
          emitInteractionMotion(copyButton, 'copy');
          clearTimeout(copyResetTimer);
          const labelRevision = ++copyFeedbackRevision;
          copyResetTimer = setTimeout(() => {
            copyResetTimer = null;
            // Label cleanup belongs to the displayed success, not the latest action.
            if (isCurrent() && labelRevision === copyFeedbackRevision && copyButton.isConnected) copyButton.textContent = originalText;
          }, 2000);
        } catch {
          if (isActionCurrent(action)) emitInteractionMotion(copyButton, 'refuse');
        }
      };
    }

    if (mobileShareBtn) {
      mobileShareBtn.onclick = () => {
        if (!isCurrent()) return;
        const action = ++shareFeedbackAction;
        return navigator.share({
          title: "Sync Metronominal",
          text: "Join my Metronominal session!",
          url: shareUrl
        }).then(() => {
          if (isActionCurrent(action)) emitInteractionMotion(mobileShareBtn, 'handoff');
        }, error => {
          if (isActionCurrent(action)) emitInteractionMotion(mobileShareBtn, error.name === 'AbortError' ? 'cancel' : 'refuse');
          if (error.name !== "AbortError") console.error("Could not share:", error);
        });
      };
    }
    closeDiagnostics(false, false);
    shareModal.style.display = "block";
    if (!wasOpen) emitInteractionMotion(shareContent || shareModal, 'open');
    if (qrContainer.childElementCount) emitInteractionMotion(qrContainer, 'ready');
  });

  const closeShare = () => {
    const wasOpen = shareModal.style.display === 'block';
    invalidateShareFeedback();
    closeDiagnostics(false, false);
    shareModal.style.display = "none";
    if (wasOpen) emitInteractionMotion(shareBtn, 'close');
  };
  document.addEventListener('roomauthoritychange', closeShare);
  document.addEventListener('syncrolechange', closeShare);
  closeBtn.addEventListener("click", closeShare);
  diagnosticsBtn?.addEventListener("click", () => {
    const willOpen = diagnosticsPanel?.hidden !== false;
    if (willOpen) updateDiagnosticsUI();
    if (diagnosticsPanel) diagnosticsPanel.hidden = !willOpen;
    shareContent?.classList.toggle("diagnostics-expanded", willOpen);
    diagnosticsBtn.setAttribute("aria-expanded", String(willOpen));
    if (diagnosticsPanel && diagnosticsPanel.hidden === !willOpen) emitInteractionMotion(diagnosticsBtn, willOpen ? 'open' : 'close');
  });
  window.addEventListener("keydown", event => {
    if (event.key === "Escape" && diagnosticsPanel && !diagnosticsPanel.hidden) closeDiagnostics(true);
  });
  window.addEventListener("click", event => {
    if (event.target === shareModal) {
      closeShare();
    }
  });
}

export async function initializeWebRTC() {
  const initializeGeneration = ++authorityGeneration;
  updateClientCount(0);
  onReceiveState(() => refreshUIFromState());

  const params = new URLSearchParams(window.location.search);
  const requestedRoom = params.get("room");
  const storedRoom = sessionStorage.getItem("host_room_id");
  const storedHost = sessionStorage.getItem("is_host") === "true";
  const storedCredential = sessionStorage.getItem("host_credential");

  if (requestedRoom) {
    roomId = requestedRoom;
    window.isHost = storedHost && storedRoom === roomId && Boolean(storedCredential);
    hostCredential = window.isHost ? storedCredential : null;
  } else {
    const identity = await generateHostIdentity();
    if (initializeGeneration !== authorityGeneration) return;
    needsRoomScope = true;
    roomId = identity.room;
    hostCredential = identity.credential;
    window.isHost = true;
    sessionStorage.setItem("host_room_id", roomId);
    sessionStorage.setItem("host_credential", hostCredential);
    sessionStorage.setItem("is_host", "true");
    const nextUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}`;
    window.history.replaceState({ path: nextUrl }, "", nextUrl);
  }

  participantCredential = sessionStorage.getItem(`rehearsal_session:${roomId}`);
  invalidateRoomAuthority('room-selected');
  intentionallyDisconnected = false;
  connectToSynchronizationServer();
}

async function flushState() {
  stateSendTimer = null;
  const statePromise = pendingStatePromise;
  pendingStatePromise = null;
  if (!joined || !window.isHost || !statePromise) return false;
  const generation = connectionGeneration, roleGeneration = authorityGeneration, expectedRoom = roomId, expectedSocket = socket;
  const current = () => joined && window.isHost && generation === connectionGeneration && roleGeneration === authorityGeneration
    && expectedRoom === roomId && expectedSocket === socket;
  try {
    const state = await statePromise;
    if (!current()) return false;
    if (!acceptLogicalBeats(state)) return false;
    if(state.practice?.enabled && !supportsRoomCapability('practice-v1')) {
      state.practice={...state.practice,enabled:false};
      AppState.setPracticeConfig(state.practice);
      recoveryMessage='Shared practice was disabled because this server lacks practice-v1. Update the server first.';
      updateDiagnosticsUI();
    }
    const privateNames = privateNetworkSoundNames();
    state.Tracks = state.Tracks.map(track => sanitizeNetworkTrack(track, privateNames));
    if (state.song?.sections) {
      state.song.sections = state.song.sections.map(section => ({
        ...section,
        ...(Array.isArray(section.tracks) ? { tracks: section.tracks.map(track => sanitizeNetworkTrack(track, privateNames)) } : {}),
      }));
    }
    state.customSounds = Object.fromEntries(Object.entries(state.customSounds || {})
      .filter(([name]) => !privateNames.has(name)));
    delete state.selectedTheme;
    delete state.recordings;
    delete state.serializedRecordings;
    state.isPlaying = AppState.isPlaying();
    const payloadBytes = new TextEncoder().encode(JSON.stringify(state)).byteLength;
    if (payloadBytes > MAX_SYNC_STATE_BYTES || !AppState.validateNetworkState(state)) {
      rejectedStateCount += 1;
      updateDiagnosticsUI();
      return false;
    }
    const stateChecksum = await checksum(state);
    if (!current()) return false;
    return sendMessage({ type: "state", schemaVersion: SYNC_SCHEMA_VERSION, capabilities: SYNC_CAPABILITIES,
      checksum: stateChecksum, payloadBytes, payload: state });
  } catch (error) {
    console.error("Could not send synchronized state:", error);
    return false;
  }
}

export async function sendState(statePromise) {
  if (!joined) return false;
  if (!window.isHost) return sendMessage({ type: "state-request" });
  pendingStatePromise = statePromise;
  clearTimeout(stateSendTimer);
  stateSendTimer = setTimeout(flushState, 100);
  return true;
}

export function sendSongChangeCommand(change) {
  if(!joined || !window.isHost || !hasTimeSync || !supportsRoomCapability('song-boundary-v1'))return false;
  if (change && !acceptLogicalBeats({...AppState.getMusicalSnapshot(),song:change.song})) return false;
  clearPrivateSongCommand();
  let wireChange = null;
  if (change !== null) {
    wireChange = JSON.parse(JSON.stringify(change));
    const privateNames = privateNetworkSoundNames();
    wireChange.song.sections = wireChange.song.sections.map(section => ({...section,
      ...(Array.isArray(section.tracks) ? {tracks:section.tracks.map(track => sanitizeNetworkTrack(track, privateNames))} : {})}));
    wireChange.commandId = Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2,'0')).join('');
    privateSongCommand = {commandId:wireChange.commandId, generation:authorityGeneration,
      identity:JSON.stringify(wireChange), song:JSON.parse(JSON.stringify(change.song))};
  }
  const intent = privateSongCommand;
  const generation=connectionGeneration, roleGeneration=authorityGeneration, expectedSocket=socket, expectedRoom=roomId;
  const publish=()=>joined && window.isHost && privateSongCommand===intent && generation===connectionGeneration && roleGeneration===authorityGeneration && expectedSocket===socket && expectedRoom===roomId && sendMessage({type:'song-change-command',change:wireChange});
  if(pendingStatePromise){clearTimeout(stateSendTimer);void flushState().then(publish);}else publish();
  return true;
}

export function isSynchronizationJoined() {
  return joined;
}

export function getDesiredHostPlaybackState() {
  return desiredHostPlaybackState ?? AppState.isPlaying();
}

function broadcastTransportCommand(playing, forcePublication = false) {
  if (!window.isHost || !joined) return false;
  if (playing && (logicalBeatsBlocked || !acceptLogicalBeats(AppState.getMusicalSnapshot()))) return false;
  if (desiredHostPlaybackState === playing && !forcePublication) return true;

  desiredHostPlaybackState = playing;
  const playButton = document.getElementById("start-stop-btn");
  if (playButton) {
    playButton.textContent = "…";
    playButton.classList.add("pending");
  }

  if (acceptingReplacementReplay) return true;

  const referenceTrack = AppState.getTracks()[0];
  const generation = connectionGeneration, roleGeneration = authorityGeneration, expectedRoom = roomId, expectedSocket = socket;
  const publish = () => joined && window.isHost && generation === connectionGeneration && roleGeneration === authorityGeneration
    && expectedRoom === roomId && expectedSocket === socket && sendMessage({
    type: "transport-command",
    playing,
    currentBar: referenceTrack?.currentBar || 0,
    currentBeat: referenceTrack?.currentBeat || 0,
  });
  if (pendingStatePromise) {
    clearTimeout(stateSendTimer);
    flushState().then(publish);
  } else {
    publish();
  }
  return true;
}

function publishDesiredHostPlaybackState() {
  if (desiredHostPlaybackState === null) return false;
  return broadcastTransportCommand(desiredHostPlaybackState, true);
}

export function broadcastScheduledPlay() {
  return broadcastTransportCommand(true);
}

export function broadcastStop() {
  clearPrivateSongCommand();
  return broadcastTransportCommand(false);
}

export function broadcastSyncPulse(nextBeatWallTime, currentBar, currentBeat, repeatIteration = 0) {
  if (!window.isHost || !joined) return false;
  if (countInEndsAt && Date.now() + timeOffset < countInEndsAt) return false;
  countInEndsAt = 0;
  return sendMessage({
    type: "playback-sync-pulse",
    nextBeatWallTime: nextBeatWallTime + timeOffset,
    currentBar,
    currentBeat,
    repeatIteration
  });
}

export function requestPlaybackSync() {
  if (window.isHost || !joined) return false;
  return sendMessage({ type: "playback-sync-request" });
}

export function enablePlayback() {
  isReadyToPlay = true;
  if (pendingTransport) applyTransport(pendingTransport);
  requestPlaybackSync();
}

export function getTimeOffset() {
  return timeOffset;
}

export function reconnectSynchronization() {
  intentionallyDisconnected = false;
  if (!socket || socket.readyState === WebSocket.CLOSED) {
    scheduleReconnect();
    return;
  }
  socket.close(4001, "Reconnect synchronization");
}

export function disconnect() {
  intentionallyDisconnected = true;
  invalidateRoomAuthority('disconnected');
  connectionGeneration += 1;
  const socketToClose = socket;
  socket = null;
  joined = false;
  resetProtocolDiagnostics();
  acceptingReplacementReplay = false;
  clearDesiredHostPlaybackState();
  resumePlaybackOnReconnect = false;
  stopRoomPlayback();
  clearTimeout(reconnectTimer);
  clearTimeout(joinRetryTimer);
  clearInterval(heartbeatTimer);
  stopTimeSync();
  clearTimeout(stateSendTimer);
  clearTimeout(scheduledStopTimer);
  if (socketToClose) socketToClose.close();
  updateClientCount(0);
  updateConnectionStatusUI("disconnected");
}

export async function disconnectAllPeers() {
  if (!window.isHost) return false;
  const roleGeneration = invalidateRoomAuthority('room-rotation'), expectedRoom = roomId, expectedSocket = socket;
  const generation = connectionGeneration;
  const current = () => roleGeneration === authorityGeneration && expectedRoom === roomId
    && expectedSocket === socket && generation === connectionGeneration && window.isHost;
  const sent = sendMessage({ type: "close-room" });
  if (!sent) return false;
  joined = false;
  resetProtocolDiagnostics();
  acceptingReplacementReplay = false;
  clearDesiredHostPlaybackState();
  stopTimeSync();
  resumePlaybackOnReconnect = false;
  stopRoomPlayback();
  if (!current()) return false;

  const identity = await generateHostIdentity();
  if (!current()) return false;
  needsRoomScope = true;
  roomId = identity.room;
  hostCredential = identity.credential;
  participantCredential = null;
  invalidateRoomAuthority('room-rotated');
  joined = false;
  sessionStorage.setItem("host_room_id", roomId);
  sessionStorage.setItem("host_credential", hostCredential);
  sessionStorage.setItem("is_host", "true");
  const nextUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}`;
  window.history.replaceState({ path: nextUrl }, "", nextUrl);
  updateClientCount(0);
  disconnect();
  intentionallyDisconnected = false;
  connectToSynchronizationServer();
  return sent;
}

export function onReceiveState(callback) {
  receiveCallback = callback;
}

// Automatic foreground visibility & touch audio context / connection auto-restoration
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    const audioContext = AppState.getAudioContext();
    if (audioContext && audioContext.state === "suspended") {
      void audioContext.resume().catch(error => console.debug("Audio context resume deferred:", error));
    }

    // Auto-heal background WebSocket timeouts without requiring a manual page reload
    if (!intentionallyDisconnected && roomId) {
      if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
        console.log("Foreground restored: Re-establishing room synchronization...");
        reconnectAttempt = 0;
        reconnectSynchronization();
      }
    }
  }
});

window.addEventListener("pointerdown", () => {
  const audioContext = AppState.getAudioContext();
  if (audioContext && audioContext.state === "suspended") {
    void audioContext.resume().catch(error => console.debug("Audio context resume deferred:", error));
  }
}, { passive: true });

export const WebRTC = { onReceiveState };
