import AppState from "./appState.js";
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
let receiveChain = Promise.resolve();
const offsetSamples = [];
const pendingTimeSyncRequests = new Map();
const MAX_OFFSET_SAMPLES = 20;

window.isHost = false;

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
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
    schedulerReady: MetronomeEngine.isSchedulerReady()
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

function resetProtocolDiagnostics() {
  localRole = "offline";
  lastStateRevision = -1;
  lastTransportRevision = -1;
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

function updateConnectionStatusUI(state) {
  connectionState = state;
  const shareBtn = document.getElementById("share-btn");
  const disconnectBtn = document.getElementById("disconnect-btn");
  const status = document.getElementById("connection-status");
  if (!shareBtn || !disconnectBtn || !status) return;

  shareBtn.classList.remove("connected", "connecting", "failed", "disconnected");
  status.textContent = state === "connected" ? "●" : state === "connecting" ? "…" : "";
  status.setAttribute("aria-label", `Synchronization ${state}`);

  if (state === "connected") {
    shareBtn.classList.add("connected");
    disconnectBtn.style.display = "";
    disconnectBtn.textContent = "DISCONNECT";
    disconnectBtn.setAttribute(
      "aria-label",
      window.isHost ? "Disconnect all clients" : "Disconnect from this room"
    );
  } else if (state === "connecting") {
    shareBtn.classList.add("connecting");
    disconnectBtn.style.display = "none";
  } else if (state === "failed") {
    shareBtn.classList.add("failed");
    disconnectBtn.style.display = "none";
  } else {
    shareBtn.classList.add("disconnected");
    disconnectBtn.style.display = "none";
  }
  const countInSelect = document.getElementById("count-in-bars-select");
  if (countInSelect) countInSelect.disabled = state !== "connected" || !window.isHost;
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
  updateDiagnosticsUI();
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
    if (AppState.isPlaying()) MetronomeEngine.togglePlay(true);
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
      MetronomeEngine.scheduleCountIn({
        ...message.countIn,
        startsAt: localTimestamp(message.countIn.startsAt)
      }, () => generation === transportGeneration);
    }
    MetronomeEngine.scheduleStart(
      localTimestamp(message.effectiveAt),
      message.currentBar || 0,
      message.currentBeat || 0,
      () => generation === transportGeneration
    );
  } else {
    stopAt(message.effectiveAt, generation);
  }
  pendingTransport = null;
}

async function handleStateMessage(message, generation) {
  if ((window.isHost && !acceptingReplacementReplay) || !message.payload || !Number.isInteger(message.revision)) return;
  if (message.revision <= lastStateRevision && !message.authoritativeRefresh) return;
  lastStateRevision = message.revision;
  const { selectedTheme: _ignoredTheme, ...state } = message.payload;
  await AppState.loadPresetData({ ...state, isPlaying: false });
  if (generation !== connectionGeneration || !joined) return;
  if (receiveCallback) receiveCallback(state);
  else refreshUIFromState();
}

async function handleSocketMessage(event, generation) {
  if (generation !== connectionGeneration) return;
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
        } else {
          pendingStatePromise = AppState.getCurrentStateForPreset(true);
          clearTimeout(stateSendTimer);
          await flushState();
          if (queuedPlay) publishDesiredHostPlaybackState();
          else if (wasPlaying) broadcastScheduledPlay();
        }
      } else {
        clearDesiredHostPlaybackState();
        sessionStorage.removeItem("host_room_id");
        sessionStorage.removeItem("host_credential");
        sessionStorage.removeItem("is_host");
        const modal = document.getElementById("connection-modal");
        if (modal) modal.style.display = "block";
      }
      startTimeSync();
      break;

    case "presence":
      updateClientCount(message.clientCount || 0);
      break;

    case "state":
      await handleStateMessage(message, generation);
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
        && Number.isFinite(Number(message.nextBeatWallTime))) {
        MetronomeEngine.handleSyncPulse(
          localTimestamp(message.nextBeatWallTime),
          message.currentBar,
          message.currentBeat
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
      resetProtocolDiagnostics();
      acceptingReplacementReplay = false;
      clearDesiredHostPlaybackState();
      invalidatePendingTransport();
      stopTimeSync();
      updateClientCount(0);
      updateConnectionStatusUI("disconnected");
      if (AppState.isPlaying()) MetronomeEngine.togglePlay(true);
      if (!window.isHost) logToScreen("The host has disconnected.");
      scheduleJoinRetry();
      break;

    case "host-replaced":
      intentionallyDisconnected = true;
      joined = false;
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
      if (!window.isHost || !joined) break;

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
      if (message.code === "room-not-found") {
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
  const delay = Math.min(30000, 1000 * (2 ** reconnectAttempt));
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

  currentSocket.onopen = () => {
    if (generation !== connectionGeneration || socket !== currentSocket) return;
    sendJoinRequest();
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => sendMessage({ type: "ping", t0: Date.now() }), 25000);
  };

  receiveChain = Promise.resolve();
  currentSocket.onmessage = event => {
    receiveChain = receiveChain
      .then(() => {
        if (generation !== connectionGeneration || socket !== currentSocket) return;
        return handleSocketMessage(event, generation);
      })
      .catch(error => console.error("Could not process synchronized message:", error));
  };
  currentSocket.onerror = error => {
    if (generation === connectionGeneration && socket === currentSocket) {
      console.error("Synchronization WebSocket error:", error);
    }
  };
  currentSocket.onclose = () => {
    if (generation !== connectionGeneration || socket !== currentSocket) return;
    connectionGeneration += 1;
    resumePlaybackOnReconnect = !intentionallyDisconnected && window.isHost && AppState.isPlaying();
    joined = false;
    resetProtocolDiagnostics();
    clearDesiredHostPlaybackState();
    invalidatePendingTransport();
    if (AppState.isPlaying()) MetronomeEngine.togglePlay(true);
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
  const diagnosticsModal = document.getElementById("sync-diagnostics-modal");
  const diagnosticsCloseBtn = diagnosticsModal?.querySelector(".close-button");

  if (!shareBtn || !shareModal || !closeBtn || !qrContainer) return;
  if (navigator.share && mobileShareBtn) mobileShareBtn.style.display = "flex";
  clearInterval(diagnosticsRefreshTimer);
  diagnosticsRefreshTimer = setInterval(updateDiagnosticsUI, 1000);

  const closeDiagnostics = () => {
    if (!diagnosticsModal || diagnosticsModal.style.display === "none") return;
    diagnosticsModal.style.display = "none";
    diagnosticsBtn?.setAttribute("aria-expanded", "false");
    diagnosticsBtn?.focus();
  };

  shareBtn.addEventListener("click", () => {
    if (!roomId) return;
    const shareUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}`;
    qrContainer.innerHTML = "";
    qrCodeInstance = new QRCode(qrContainer, {
      text: shareUrl,
      width: 256,
      height: 256,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H
    });

    const copyButton = document.getElementById("copy-link-btn");
    if (copyButton) {
      copyButton.onclick = async () => {
        await navigator.clipboard.writeText(shareUrl);
        const oldText = copyButton.textContent;
        copyButton.textContent = "Copied!";
        setTimeout(() => { copyButton.textContent = oldText; }, 2000);
      };
    }

    if (mobileShareBtn) {
      mobileShareBtn.onclick = () => navigator.share({
        title: "Sync Metronominal",
        text: "Join my Metronominal session!",
        url: shareUrl
      }).catch(error => {
        if (error.name !== "AbortError") console.error("Could not share:", error);
      });
    }
    shareModal.style.display = "block";
  });

  closeBtn.addEventListener("click", () => { shareModal.style.display = "none"; });
  diagnosticsBtn?.addEventListener("click", () => {
    updateDiagnosticsUI();
    diagnosticsModal.style.display = "block";
    diagnosticsBtn.setAttribute("aria-expanded", "true");
    diagnosticsCloseBtn?.focus();
  });
  diagnosticsCloseBtn?.addEventListener("click", closeDiagnostics);
  window.addEventListener("keydown", event => {
    if (event.key === "Escape" && diagnosticsModal?.style.display === "block") closeDiagnostics();
  });
  window.addEventListener("click", event => {
    if (event.target === shareModal) shareModal.style.display = "none";
    if (event.target === diagnosticsModal) closeDiagnostics();
  });
}

export async function initializeWebRTC() {
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
    roomId = identity.room;
    hostCredential = identity.credential;
    window.isHost = true;
    sessionStorage.setItem("host_room_id", roomId);
    sessionStorage.setItem("host_credential", hostCredential);
    sessionStorage.setItem("is_host", "true");
    const nextUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}`;
    window.history.replaceState({ path: nextUrl }, "", nextUrl);
  }

  intentionallyDisconnected = false;
  connectToSynchronizationServer();
}

async function flushState() {
  stateSendTimer = null;
  const statePromise = pendingStatePromise;
  pendingStatePromise = null;
  if (!joined || !window.isHost || !statePromise) return false;
  try {
    const state = await statePromise;
    delete state.selectedTheme;
    delete state.recordings;
    delete state.serializedRecordings;
    state.isPlaying = AppState.isPlaying();
    return sendMessage({ type: "state", payload: state });
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

export function getDesiredHostPlaybackState() {
  return desiredHostPlaybackState ?? AppState.isPlaying();
}

function broadcastTransportCommand(playing, forcePublication = false) {
  if (!window.isHost) return false;
  if (desiredHostPlaybackState === playing && !forcePublication) return true;

  desiredHostPlaybackState = playing;
  const playButton = document.getElementById("start-stop-btn");
  if (playButton) {
    playButton.textContent = "…";
    playButton.classList.add("pending");
  }

  if (!joined || acceptingReplacementReplay) return true;

  const referenceTrack = AppState.getTracks()[0];
  const publish = () => sendMessage({
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
  return broadcastTransportCommand(false);
}

export function broadcastSyncPulse(nextBeatWallTime, currentBar, currentBeat) {
  if (!window.isHost || !joined) return false;
  if (countInEndsAt && Date.now() + timeOffset < countInEndsAt) return false;
  countInEndsAt = 0;
  return sendMessage({
    type: "playback-sync-pulse",
    nextBeatWallTime: nextBeatWallTime + timeOffset,
    currentBar,
    currentBeat
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
  connectionGeneration += 1;
  const socketToClose = socket;
  socket = null;
  joined = false;
  resetProtocolDiagnostics();
  acceptingReplacementReplay = false;
  clearDesiredHostPlaybackState();
  resumePlaybackOnReconnect = false;
  invalidatePendingTransport();
  if (AppState.isPlaying()) MetronomeEngine.togglePlay(true);
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
  const sent = sendMessage({ type: "close-room" });
  if (!sent) return false;
  joined = false;
  resetProtocolDiagnostics();
  acceptingReplacementReplay = false;
  clearDesiredHostPlaybackState();
  stopTimeSync();
  resumePlaybackOnReconnect = false;
  invalidatePendingTransport();
  if (AppState.isPlaying()) await MetronomeEngine.togglePlay(true);

  const identity = await generateHostIdentity();
  roomId = identity.room;
  hostCredential = identity.credential;
  joined = false;
  sessionStorage.setItem("host_room_id", roomId);
  sessionStorage.setItem("host_credential", hostCredential);
  sessionStorage.setItem("is_host", "true");
  const nextUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}`;
  window.history.replaceState({ path: nextUrl }, "", nextUrl);
  updateClientCount(0);
  sendJoinRequest();
  return sent;
}

export function onReceiveState(callback) {
  receiveCallback = callback;
}

export const WebRTC = { onReceiveState };
