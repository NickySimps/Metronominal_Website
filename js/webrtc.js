// Metronominal_Website/js/webrtc.js

import AppState from "./appState.js";
import TempoController from "./tempoController.js";
import VolumeController from "./volumeController.js";
import TrackController from "./tracksController.js";
import BarControlsController from "./barControlsController.js";
import ThemeController from "./themeController.js";

let peerConnection;
let dataChannel;
let receiveCallback;
let socket;
let roomId;
let qrCodeInstance = null;
let connectionAttempts = 0;
let maxConnectionAttempts = 3;
let reconnectTimeout = null;

window.isHost = false; // Default to being a client

const configuration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" }
  ],
  iceCandidatePoolSize: 10
};

function sendMessage(message) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    console.log('Sending message:', message.type);
    socket.send(JSON.stringify(message));
  } else {
    console.warn('Cannot send message, WebSocket not open:', socket?.readyState);
  }
}
function updateConnectionStatusUI(state) {
  const shareBtn = document.getElementById("share-btn");
  if (shareBtn) {
    shareBtn.classList.remove('connected', 'connecting', 'failed');
    if (state === 'connected') {
      shareBtn.classList.add('connected');
    } else if (state === 'connecting' || state === 'new' || state === 'checking') {
      shareBtn.classList.add('connecting');
    } else {
      shareBtn.classList.add('failed');
    }
  }
}
function createPeerConnection() {
  console.log('Creating peer connection...');
  peerConnection = new RTCPeerConnection(configuration);

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      console.log('Sending ICE candidate');
      sendMessage({
        type: "candidate",
        candidate: event.candidate,
        room: roomId
      });
    }
  };

  peerConnection.ondatachannel = (event) => {
    console.log('Received data channel');
    dataChannel = event.channel;
    setupDataChannelEvents();
  };

  peerConnection.onconnectionstatechange = () => {
    console.log('Connection state:', peerConnection.connectionState);
    updateConnectionStatusUI(peerConnection.connectionState);
    if (peerConnection.connectionState === 'failed') {
      console.log('Connection failed, attempting to reconnect...');
      setTimeout(() => {
        connectToSignalingServer();
      }, 2000);
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log('ICE connection state:', peerConnection.iceConnectionState);
  };
}

function refreshUIFromState() {
  TempoController.updateTempoDisplay({ animate: true });
  VolumeController.updateVolumeDisplay({ animate: true });

  TrackController.renderTracks();
  BarControlsController.updateBarControlsForSelectedTrack();
  // Only the host should send state updates
  if (window.isHost) {
    sendState(AppState.getCurrentStateForPreset());
  }

  if (
    AppState.getCurrentTheme() === "3dRoom" &&
    ThemeController.is3DSceneActive()
  ) {
    ThemeController.update3DScenePostStateChange();
  }
}

function syncPlaybackState() {
  const isPlaying = AppState.get("isPlaying"); // Assumes AppState holds playback status
  if (isPlaying && !Metronome.isPlaying()) {
    Metronome.start();
  } else if (!isPlaying && Metronome.isPlaying()) {
    Metronome.stop();
  }
}


function setupDataChannelEvents() {
  dataChannel.onopen = () => {
    console.log("Data channel is open!");
    sendState(AppState.getCurrentStateForPreset());
  };

  dataChannel.onclose = () => {
    console.log("Data channel is closed.");
  };

  dataChannel.onmessage = (event) => {
    console.log('Received data channel message');
    const data = JSON.parse(event.data);
    AppState.loadPresetData(data);
    refreshUIFromState();
    syncPlaybackState();
  };

  dataChannel.onerror = (error) => {
    console.error('Data channel error:', error);
  };
}

export function sendState(state) {
  if (dataChannel && dataChannel.readyState === "open") {
    console.log('Sending state via data channel');
    dataChannel.send(JSON.stringify(state));
  } else {
    console.warn('Data channel not open, cannot send state');
  }
}

// Export WebRTC functions
export async function createOffer() {
  try {
    console.log('Creating offer...');
    createPeerConnection();
    dataChannel = peerConnection.createDataChannel("metronome-sync");
    setupDataChannelEvents();
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    sendMessage({
      type: "offer",
      offer: offer,
      room: roomId
    });
  } catch (error) {
    console.error('Error creating offer:', error);
  }
}

export async function createAnswer(offer) {
  try {
    console.log('Creating answer...');
    createPeerConnection();
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    sendMessage({
      type: "answer",
      answer: answer,
      room: roomId
    });
  } catch (error) {
    console.error('Error creating answer:', error);
  }
}

export async function acceptAnswer(answer) {
  try {
    console.log('Accepting answer...');
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    console.log("Connection established!");
  } catch (error) {
    console.error('Error accepting answer:', error);
  }
}

export async function addIceCandidate(candidate) {
  try {
    if (peerConnection) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      console.log('Added ICE candidate');
    }
  } catch (error) {
    console.error('Error adding ICE candidate:', error);
  }
}

export function onReceiveState(callback) {
  receiveCallback = callback;
}

// Create WebRTC object for backward compatibility
export const WebRTC = {
  onReceiveState,
  createOffer,
  createAnswer,
  acceptAnswer,
  addIceCandidate
};

function connectToSignalingServer() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    console.log('Already connected to signaling server');
    return;
  }

  connectionAttempts++;
  console.log(`Connecting to signaling server (attempt ${connectionAttempts}/${maxConnectionAttempts})`);

  // Clear any existing reconnect timeout
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  // Try the deployed server first, then fallback to localhost for development
  const serverUrl = "wss://metronomesignalserver.onrender.com";
  console.log('Connecting to:', serverUrl);

  socket = new WebSocket(serverUrl);

  socket.onopen = () => {
    console.log("Connected to signaling server.");
    connectionAttempts = 0; // Reset attempts on successful connection
    sendMessage({
      type: "join",
      room: roomId
    });
  };

  socket.onmessage = async (message) => {
    try {
      const data = JSON.parse(message.data);
      console.log('Received message:', data.type);

      switch (data.type) {
        case "offer":
          await createAnswer(data.offer);
          break;
        case "answer":
          await acceptAnswer(data.answer);
          break;
        case "candidate":
          await addIceCandidate(data.candidate);
          break;
        case "peer-joined":
          console.log('Peer joined, creating offer...');
          await createOffer();
          break;
        default:
          console.log('Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  };

  socket.onclose = (event) => {
    console.log("Disconnected from signaling server.", event.code, event.reason);

    // Only attempt to reconnect if we haven't exceeded max attempts
    if (connectionAttempts < maxConnectionAttempts) {
      console.log(`Attempting to reconnect in 2 seconds...`);
      reconnectTimeout = setTimeout(() => {
        connectToSignalingServer();
      }, 2000);
    } else {
      console.error('Max connection attempts reached. Please refresh the page.');
    }
  };

  socket.onerror = (error) => {
    console.error("WebSocket error:", error);
  };
}

export function initializeShareControls() {
  const shareBtn = document.getElementById("share-btn");
  const shareModal = document.getElementById("share-modal");
  const closeBtn = shareModal.querySelector(".close-button");
  const qrcodeContainer = document.getElementById("qrcode");

  shareBtn.addEventListener("click", () => {
    window.isHost = true;
    const shareUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    console.log('Sharing URL:', shareUrl);

    // Clear previous QR code
    qrcodeContainer.innerHTML = "";

    // Generate new QR code
    qrCodeInstance = new QRCode(qrcodeContainer, {
      text: shareUrl,
      width: 256,
      height: 256,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H
    });

    shareModal.style.display = "block";
  });

  closeBtn.addEventListener("click", () => {
    shareModal.style.display = "none";
  });

  window.addEventListener("click", (event) => {
    if (event.target == shareModal) {
      shareModal.style.display = "none";
    }
  });
}

export function initializeWebRTC() {
  onReceiveState((newState) => {
    console.log("Received new state:", newState);
    AppState.loadPresetData(newState);
    TempoController.updateTempoDisplay({ animate: true });
    VolumeController.updateVolumeDisplay({ animate: true });
    TrackController.renderTracks();
    BarControlsController.updateBarControlsForSelectedTrack();
    const currentTheme = AppState.getCurrentTheme();
    if (ThemeController.is3DSceneActive() && currentTheme !== '3dRoom') {
      ThemeController.applyTheme(currentTheme);
    }
  });

  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get("room");

  if (roomParam) {
    roomId = roomParam;
    console.log('Joining existing room:', roomId);
  } else {
    roomId = Math.random().toString(36).substring(2, 9);
    console.log('Creating new room:', roomId);
    // Update the URL without reloading the page to have a shareable link
    const newUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    window.history.pushState({ path: newUrl }, '', newUrl);
  }

  connectToSignalingServer();
}