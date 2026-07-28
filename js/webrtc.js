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
let scheduledStopTimer = null;
let stateSendTimer = null;
let pendingStatePromise = null;
let acceptingReplacementReplay = false;
let resumePlaybackOnReconnect = false;
let connectionGeneration = 0;
let lastStateRevision = -1;
let lastTransportRevision = -1;
let transportGeneration = 0;
let intentionallyDisconnected = false;
let joined = false;
let isReadyToPlay = false;
let hasTimeSync = false;
let timeOffset = 0; // Server clock - this browser's clock.
let receiveChain = Promise.resolve();
const offsetSamples = [];
const MAX_OFFSET_SAMPLES = 20;

window.isHost = false;

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
  const shareBtn = document.getElementById("share-btn");
  const disconnectBtn = document.getElementById("disconnect-btn");
  const status = document.getElementById("connection-status");
  if (!shareBtn || !disconnectBtn || !status) return;

  shareBtn.classList.remove("connected", "connecting", "failed", "disconnected");
  status.textContent = state === "connected" ? "●" : state === "connecting" ? "…" : "";
  status.setAttribute("aria-label", `Synchronization ${state}`);

  if (state === "connected") {
    shareBtn.classList.add("connected");
    disconnectBtn.style.display = window.isHost ? "" : "none";
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
}

function updateClientCount(count = 0) {
  const connectionCount = document.getElementById("n-of-connections");
  if (!connectionCount) return;
  connectionCount.textContent = `(${count})`;
  connectionCount.setAttribute(
    "aria-label",
    `${count} connected ${count === 1 ? "client" : "clients"}`
  );
}

function refreshUIFromState() {
  TempoController.updateTempoDisplay({ animate: true });
  VolumeController.updateVolumeDisplay({ animate: true });
  TrackController.renderTracks();
  BarControlsController.updateBarControlsForSelectedTrack();
}

function updateTimeOffset(newOffset, roundTripTime) {
  offsetSamples.push({ offset: newOffset, rtt: roundTripTime });
  if (offsetSamples.length > MAX_OFFSET_SAMPLES) offsetSamples.shift();
  const best = offsetSamples.reduce((current, sample) => sample.rtt < current.rtt ? sample : current);
  timeOffset = best.offset;
}

function requestTimeSync() {
  const t0 = Date.now();
  sendMessage({ type: "time-sync", t0 });
}

function stopTimeSync() {
  clearInterval(timeSyncBurstTimer);
  clearInterval(steadyTimeSyncTimer);
  timeSyncBurstTimer = null;
  steadyTimeSyncTimer = null;
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
  clearTimeout(scheduledStopTimer);
  scheduledStopTimer = null;
}

function applyTransport(message) {
  if (!joined) return;
  if (!message || typeof message.playing !== "boolean"
    || !Number.isFinite(Number(message.effectiveAt))
    || !Number.isInteger(message.currentBar)
    || !Number.isInteger(message.currentBeat)
    || !Number.isInteger(message.revision)
    || message.currentBar < 0 || message.currentBar > 4095
    || message.currentBeat < 0 || message.currentBeat > 4095) return;
  if (message.revision < lastTransportRevision) return;
  pendingTransport = message;
  if (!isReadyToPlay || !hasTimeSync) return;

  lastTransportRevision = message.revision;
  transportGeneration += 1;
  const generation = transportGeneration;
  clearTimeout(scheduledStopTimer);

  if (message.playing) {
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
      acceptingReplacementReplay = Boolean(message.replacedHost && message.isHost);
      lastStateRevision = -1;
      lastTransportRevision = -1;
      updateClientCount(message.clientCount || 0);
      updateConnectionStatusUI("connected");
      if (window.isHost) {
        const wasPlaying = AppState.isPlaying() || resumePlaybackOnReconnect;
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
          if (wasPlaying) broadcastScheduledPlay();
        }
      } else {
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
      const now = Date.now();
      const rtt = now - message.t0;
      const offset = message.serverTime - (message.t0 + rtt / 2);
      updateTimeOffset(offset, rtt);
      hasTimeSync = true;
      if (pendingTransport && isReadyToPlay) applyTransport(pendingTransport);
      break;
    }

    case "pong":
      break;

    case "room-closed":
      joined = false;
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

    case "replacement-replay-complete":
      acceptingReplacementReplay = false;
      break;

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

  if (!shareBtn || !shareModal || !closeBtn || !qrContainer) return;
  if (navigator.share && mobileShareBtn) mobileShareBtn.style.display = "flex";

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
  window.addEventListener("click", event => {
    if (event.target === shareModal) shareModal.style.display = "none";
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

export function broadcastScheduledPlay() {
  if (!joined || !window.isHost) return false;
  const referenceTrack = AppState.getTracks()[0];
  const publish = () => sendMessage({
      type: "transport-command",
      playing: true,
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

export function broadcastStop() {
  if (!joined || !window.isHost) return false;
  const referenceTrack = AppState.getTracks()[0];
  const publish = () => sendMessage({
      type: "transport-command",
      playing: false,
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

export function broadcastSyncPulse(nextBeatWallTime, currentBar, currentBeat) {
  if (!window.isHost || !joined) return false;
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
  acceptingReplacementReplay = false;
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
