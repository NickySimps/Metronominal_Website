import AppState from "./appState.js";
import TempoController from "./tempoController.js";
import VolumeController from "./volumeController.js";
import TrackController from "./tracksController.js";
import BarControlsController from "./barControlsController.js";
import ThemeController from "./themeController.js";
import MetronomeEngine from "./metronomeEngine.js";

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
  const shareBtn = document.getElementById('share-btn');
  const disconnectBtn = document.getElementById('disconnect-btn');
  const connectionStatus = document.getElementById('connection-status');

  if (!shareBtn || !disconnectBtn || !connectionStatus) return;

  shareBtn.classList.remove('connected', 'connecting', 'failed');

  if (state === 'connected') {
    shareBtn.style.display = 'none';
    disconnectBtn.style.display = '';
    connectionStatus.textContent = 'Connected';
  } else if (state === 'connecting' || state === 'new' || state === 'checking') {
    shareBtn.style.display = '';
    disconnectBtn.style.display = 'none';
    connectionStatus.textContent = 'Connecting...';
    shareBtn.classList.add('connecting');
  } else { // disconnected, closed, failed
    shareBtn.style.display = '';
    disconnectBtn.style.display = 'none';
    connectionStatus.textContent = '';
    // Optionally add 'failed' class for visual feedback on failure
    if (state === 'failed') shareBtn.classList.add('failed');
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
    const state = peerConnection.connectionState;
    if (state === 'failed') {
      console.log('Connection failed, attempting to reconnect...');
      setTimeout(() => {
        connectToSignalingServer();
      }, 2000);
    } else if (state === 'disconnected' || state === 'closed') {
      console.log('Peer has disconnected.');
      resetConnectionState();
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
  const isPlaying = AppState.isPlaying();
  const isEnginePlaying = MetronomeEngine.isPlaying ? MetronomeEngine.isPlaying() : false;

  console.log('Syncing playback state:', { isPlaying, isEnginePlaying });

  if (isPlaying && !isEnginePlaying) {
    console.log('Starting metronome engine...');
    MetronomeEngine.togglePlay();
  } else if (!isPlaying && isEnginePlaying) {
    console.log('Stopping metronome engine...');
    MetronomeEngine.togglePlay();
  }
}

function sendFullState() {
  if (dataChannel && dataChannel.readyState === 'open') {
    const state = AppState.getCurrentStateForPreset();
    console.log('Sending full state:', state);
    dataChannel.send(JSON.stringify(state));
  }
}

function setupDataChannelEvents() {
  dataChannel.onopen = () => {
    console.log("Data channel is open!");
    if (window.isHost) {
      sendState(AppState.getCurrentStateForPreset());
    }
  };

  dataChannel.onclose = () => {
    console.log("Data channel is closed.");
    resetConnectionState();
  };

dataChannel.onmessage = (event) => {
    console.log('Received data channel message');
    const data = JSON.parse(event.data);
    console.log('Received state data:', data);
    
    // Store the correct 'isPlaying' state from the host.
    const shouldBePlaying = data.isPlaying || false;

    // Load the new state, but temporarily force isPlaying to be false.
    // This ensures the engine starts from a known 'off' state.
    AppState.loadPresetData({ ...data, isPlaying: false });
    
    // Refresh the UI with all the new settings (tempo, bars, etc.).
    refreshUIFromState();
    
    // If the host was playing, we now toggle the client's engine on.
    // Since AppState thinks it's 'off', this single toggle will correctly
    // turn it 'on' and start the scheduler loop without the double-toggle issue.
    if (shouldBePlaying) {
        // This will now correctly start the engine and set AppState.isPlaying to true.
        MetronomeEngine.togglePlay();
    }
};

  dataChannel.onerror = (error) => {
    console.error('Data channel error:', error);
  };
}

export function sendState(state) {
  if (dataChannel && dataChannel.readyState === "open") {
    console.log('Sending state via data channel:', state);
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
  const disconnectBtn = document.getElementById('disconnect-btn');
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

  disconnectBtn.addEventListener('click', () => {
    disconnect();
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

/**
 * Resets connection variables and UI to the disconnected state.
 * This is called when a connection is closed or fails.
 */
function resetConnectionState() {
  // Guard against multiple calls
  if (!peerConnection && !dataChannel) return;

  console.log('Cleaning up connection state.');
  peerConnection = null;
  dataChannel = null;
  updateConnectionStatusUI('disconnected');
}

/**
 * Initiates a disconnection from the current peer.
 */
export function disconnect() {
  console.log('User initiated disconnect.');
  if (peerConnection) peerConnection.close();
  resetConnectionState(); // Also reset state immediately for snappy UI response
}

/**
 * Disconnects all connected peers. This can only be initiated by the host.
 * It sends a 'disconnect' message to clients before closing the connections.
 */
export function disconnectAllPeers() {
    if (!window.isHost) {
        console.warn("Only the host can disconnect all peers.");
        return;
    }

    console.log("Host is disconnecting all peers.");
    
    // Create a disconnect message payload for clients
    const payload = {
        type: 'host-disconnect',
        message: 'The host has closed the session.'
    };

    // Iterate over all data channels and send the disconnect message
    Object.values(WebRTC.dataChannels).forEach(channel => {
        if (channel && channel.readyState === 'open') {
            channel.send(JSON.stringify(payload));
        }
    });

    // A short delay to allow the message to be sent before closing connections
    setTimeout(() => {
        // Close all peer connections
        Object.values(WebRTC.peers).forEach(peerConnection => {
            if (peerConnection) {
                peerConnection.close();
            }
        });

        // Clear the peer and data channel objects
        WebRTC.peers = {};
        WebRTC.dataChannels = {};

        console.log("All peer connections closed.");

        // You could also update the UI here to show that no one is connected.
    }, 250); // 250ms delay
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
    
    // Sync playback state
    syncPlaybackState();
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