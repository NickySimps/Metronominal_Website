import AppState from "./appState.js";
import TempoController from "./tempoController.js";
import VolumeController from "./volumeController.js";
import TrackController from "./tracksController.js";
import BarControlsController from "./barControlsController.js";
import ThemeController from "./themeController.js";
import MetronomeEngine from "./metronomeEngine.js";

let peerConnection;
let peers = {};
let dataChannel;
let dataChannels = {};
let clientCount = 0;
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
    { urls: "stun:stun2.l.google.com:19302" },
  ],
  iceCandidatePoolSize: 10,
};

function sendMessage(message) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    console.log("Sending message:", message.type);
    socket.send(JSON.stringify(message));
  } else {
    console.warn(
      "Cannot send message, WebSocket not open:",
      socket?.readyState
    );
  }
}

function updateConnectionStatusUI(state) {
  const shareBtn = document.getElementById("share-btn");
  const disconnectBtn = document.getElementById("disconnect-btn");
  const connectionStatus = document.getElementById("connection-status");

  if (!shareBtn || !disconnectBtn || !connectionStatus) return;

  shareBtn.classList.remove("connected", "connecting", "failed");

  if (state === 'connected') {
    //shareBtn.style.display = 'none';
    disconnectBtn.style.display = '';
    //connectionStatus.textContent = 'Connected';
    shareBtn.classList.add('connected');
  } else if (state === 'connecting' || state === 'new' || state === 'checking') {
    shareBtn.style.display = '';
    disconnectBtn.style.display = 'none';
    //connectionStatus.textContent = 'Connecting...';
    shareBtn.classList.add('connecting');
  } else { // disconnected, closed, failed
    shareBtn.style.display = '';
    disconnectBtn.style.display = 'none';
    //connectionStatus.textContent = '';
    // Optionally add 'failed' class for visual feedback on failure
    if (state === "failed") shareBtn.classList.add("failed");
  }
}

function createPeerConnection(peerId) {
  console.log("Creating peer connection for:", peerId);
  const peerConnection = new RTCPeerConnection(configuration);

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      console.log("Sending ICE candidate for peer:", peerId);
      sendMessage({
        type: "candidate",
        candidate: event.candidate,
        room: roomId,
        peerId: peerId,
      });
    }
  };

  peerConnection.ondatachannel = (event) => {
    console.log("Received data channel for peer:", peerId);
    dataChannels[peerId] = event.channel;
    setupDataChannelEvents(peerId);
  };

  peerConnection.onconnectionstatechange = () => {
    console.log(
      "Connection state for",
      peerId,
      ":",
      peerConnection.connectionState
    );

    if (peerConnection.connectionState === "connected") {
      updateClientCount();
      updateConnectionStatusUI("connected");

      if (!window.isHost) {
        const connectionModal = document.getElementById("connection-modal");
        connectionModal.style.display = "block";
      }
    } else if (
      peerConnection.connectionState === "disconnected" ||
      peerConnection.connectionState === "closed" ||
      peerConnection.connectionState === "failed"
    ) {
      console.log("Peer disconnected:", peerId);
      delete peers[peerId];
      delete dataChannels[peerId];
      updateClientCount();
      updateConnectionStatusUI("disconnected");
    }
  };

  peers[peerId] = peerConnection;
  return peerConnection;
}

function updateClientCount() {
  const connectedClients = Object.values(dataChannels).filter(
    (channel) => channel && channel.readyState === "open"
  ).length;

  const connectionCount = document.getElementById("n-of-connections");
  if (connectionCount) {
    connectionCount.textContent =
      connectedClients > 0 ? `(${connectedClients})` : "";
  }
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
  const isEnginePlaying = MetronomeEngine.isPlaying
    ? MetronomeEngine.isPlaying()
    : false;

  console.log("Syncing playback state:", { isPlaying, isEnginePlaying });

  if (isPlaying && !isEnginePlaying) {
    console.log("Starting metronome engine...");
    MetronomeEngine.togglePlay();
  } else if (!isPlaying && isEnginePlaying) {
    console.log("Stopping metronome engine...");
    MetronomeEngine.togglePlay();
  }
}

function sendFullState() {
  if (dataChannel && dataChannel.readyState === "open") {
    const state = AppState.getCurrentStateForPreset();
    console.log("Sending full state:", state);
    dataChannel.send(JSON.stringify(state));
  }
}

let timeOffset = 0; // HostTime - ClientTime
let syncInterval = null;

function syncTimeWithHost(peerId) {
    if (window.isHost) return;
    
    const t0 = Date.now();
    const dataChannel = dataChannels[peerId];
    if (dataChannel && dataChannel.readyState === 'open') {
        dataChannel.send(JSON.stringify({
            type: 'time-sync',
            t0: t0
        }));
    }
}

function setupDataChannelEvents(peerId) {
  const dataChannel = dataChannels[peerId];
  if (!dataChannel) return;

  dataChannel.onopen = () => {
    console.log("Data channel is open for peer:", peerId);
    updateClientCount();
    if (window.isHost) {
      sendState(AppState.getCurrentStateForPreset());
    } else {
        // Start time sync
        syncTimeWithHost(peerId);
        // Periodically re-sync to account for drift
        if(syncInterval) clearInterval(syncInterval);
        syncInterval = setInterval(() => syncTimeWithHost(peerId), 5000);
    }
  };

  dataChannel.onclose = () => {
    console.log("Data channel closed for peer:", peerId);
    delete dataChannels[peerId];
    updateClientCount();
    if (syncInterval) clearInterval(syncInterval);
  };

  dataChannel.onmessage = (event) => {
    // console.log("Received data from peer:", peerId);
    const data = JSON.parse(event.data);

    // Handle host disconnect message
    if (data.type === "host-disconnect") {
      console.log("Host disconnected:", data.message);
      // Clean up connections
      Object.values(peers).forEach((peerConnection) => {
        if (peerConnection) peerConnection.close();
      });
      peers = {};
      dataChannels = {};
      updateClientCount();
      updateConnectionStatusUI("disconnected");

      // Optionally show a message to the user
      alert(data.message || "The host has disconnected.");
      return;
    }

    if (data.type === 'time-sync') {
        // Host responds to ping
        if (window.isHost) {
            dataChannel.send(JSON.stringify({
                type: 'time-sync-response',
                t0: data.t0,
                t1: Date.now()
            }));
        }
        return;
    }

    if (data.type === 'time-sync-response') {
        // Client receives pong
        if (!window.isHost) {
            const t3 = Date.now();
            const t0 = data.t0;
            const t1 = data.t1;
            const rtt = t3 - t0;
            // NTP offset calculation: offset = ((t1 - t0) + (t1 - t3)) / 2  ... simplified to t1 - t0 - rtt/2 isn't quite right for one-way. 
            // Standard NTP: offset = ((receiveTime - origTime) + (transmitTime - destTime)) / 2
            // Here: HostTime ~= ClientTime + offset
            // t1 is Host Receive Time (approx Transmit Time). 
            // offset = t1 - (t0 + rtt / 2);
            const newOffset = t1 - (t0 + rtt / 2);
            // Simple smoothing could be added here
            timeOffset = newOffset;
            // console.log(`Time sync: RTT=${rtt}ms, Offset=${timeOffset}ms`);
        }
        return;
    }

    if (data.type === 'play-scheduled') {
        // Handle scheduled start
        if (!window.isHost) {
            const hostScheduledTime = data.scheduledStartTime;
            const now = Date.now();
            const clientTargetTime = hostScheduledTime - timeOffset;
            const delay = clientTargetTime - now;

            console.log(`Scheduled Start: Host=${hostScheduledTime}, ClientTarget=${clientTargetTime}, Delay=${delay}ms`);

            MetronomeEngine.scheduleStart(clientTargetTime);
        }
        return;
    }
    
    if (data.type === 'stop-sync') {
        if (!window.isHost) {
             MetronomeEngine.togglePlay(true); // Force stop
        }
        return;
    }

    // Handle normal state updates
    const wasPlayingOnClient = AppState.isPlaying();
    const shouldBePlaying = data.isPlaying || false;

    // Load the state, but temporarily set isPlaying to false in AppState
    // to prevent MetronomeEngine from immediately starting/stopping based on the loaded state.
    // We will handle playback synchronization explicitly below.
    AppState.loadPresetData({ ...data, isPlaying: false });

    refreshUIFromState();

    // Explicitly synchronize playback state without resetting the metronome's timing.
    // If the host is playing and the client was not, start the client.
    // If the host is not playing and the client was, stop the client.
    if (shouldBePlaying && !wasPlayingOnClient) {
      // MetronomeEngine.togglePlay(); // Replaced by play-scheduled usually, but keep as fallback?
    } else if (!shouldBePlaying && wasPlayingOnClient) {
      MetronomeEngine.togglePlay(); // This will stop the metronome
    }
  };
}

export function getTimeOffset() {
    return timeOffset;
}

export function broadcastScheduledPlay(scheduledStartTime) {
    if (window.isHost) {
        Object.values(dataChannels).forEach(channel => {
            if (channel.readyState === 'open') {
                channel.send(JSON.stringify({
                    type: 'play-scheduled',
                    scheduledStartTime: scheduledStartTime
                }));
            }
        });
    }
}

export function broadcastStop() {
    if (window.isHost) {
        Object.values(dataChannels).forEach(channel => {
            if (channel.readyState === 'open') {
                channel.send(JSON.stringify({
                    type: 'stop-sync'
                }));
            }
        });
    }
}


export function sendState(state) {
  if (window.isHost) {
    Object.entries(dataChannels).forEach(([peerId, channel]) => {
      if (channel && channel.readyState === "open") {
        console.log("Sending state to peer:", peerId);
        channel.send(JSON.stringify(state));
      }
    });
  }
}

// Export WebRTC functions
export async function createOffer(peerId = "default") {
  try {
    console.log("Creating offer for peer:", peerId);
    const peerConnection = createPeerConnection(peerId);
    const dataChannel = peerConnection.createDataChannel("metronome-sync");
    dataChannels[peerId] = dataChannel;
    setupDataChannelEvents(peerId);

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    sendMessage({
      type: "offer",
      offer: offer,
      room: roomId,
      peerId: peerId,
    });
  } catch (error) {
    console.error("Error creating offer:", error);
  }
}

export async function createAnswer(offer, peerId = "default") {
  try {
    console.log("Creating answer for peer:", peerId);
    const peerConnection = createPeerConnection(peerId);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    sendMessage({
      type: "answer",
      answer: answer,
      room: roomId,
      peerId: peerId,
    });
  } catch (error) {
    console.error("Error creating answer:", error);
  }
}

export async function acceptAnswer(answer, peerId = "default") {
  try {
    console.log("Accepting answer from peer:", peerId);
    const peerConnection = peers[peerId];
    if (peerConnection) {
      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(answer)
      );
      console.log("Connection established with peer:", peerId);
    } else {
      console.warn("No peer connection found for peer:", peerId);
    }
  } catch (error) {
    console.error("Error accepting answer:", error);
  }
}

export async function addIceCandidate(candidate, peerId = "default") {
  try {
    const peerConnection = peers[peerId];
    if (peerConnection) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      console.log("Added ICE candidate for peer:", peerId);
    } else {
      console.warn("No peer connection found for peer:", peerId);
    }
  } catch (error) {
    console.error("Error adding ICE candidate:", error);
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
  addIceCandidate,
};

function connectToSignalingServer() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    console.log("Already connected to signaling server");
    return;
  }

  connectionAttempts++;
  console.log(
    `Connecting to signaling server (attempt ${connectionAttempts}/${maxConnectionAttempts})`
  );
  updateConnectionStatusUI("connecting");

  // Clear any existing reconnect timeout
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  // Try the deployed server first, then fallback to localhost for development
  const serverUrl = "wss://metronomesignalserver.onrender.com";
  console.log("Connecting to:", serverUrl);

  socket = new WebSocket(serverUrl);

  socket.onopen = () => {
    console.log("Connected to signaling server.");
    connectionAttempts = 0; // Reset attempts on successful connection
    sendMessage({
      type: "join",
      room: roomId,
    });
  };

  socket.onmessage = async (message) => {
    try {
      const data = JSON.parse(message.data);
      console.log("Received message:", data.type, "from peer:", data.peerId);

      const peerId = data.peerId || "default";

      switch (data.type) {
        case "offer":
          await createAnswer(data.offer, peerId);
          break;
        case "answer":
          await acceptAnswer(data.answer, peerId);
          break;
        case "candidate":
          await addIceCandidate(data.candidate, peerId);
          break;
        case "peer-joined":
          console.log("Peer joined:", peerId);
          if (window.isHost) {
            await createOffer(peerId);
          }
          break;
        case "peer-left":
          console.log("Peer left:", peerId);
          if (peers[peerId]) {
            peers[peerId].close();
            delete peers[peerId];
            delete dataChannels[peerId];
            updateClientCount();
          }
          break;
        case "host-changed":
          console.log("Host changed to:", data.newHostId);
          // Handle host migration if needed
          break;
      }
    } catch (error) {
      console.error("Error handling message:", error);
    }
  };

  socket.onclose = (event) => {
    console.log(
      "Disconnected from signaling server.",
      event.code,
      event.reason
    );

    // Only attempt to reconnect if we haven't exceeded max attempts
    if (connectionAttempts < maxConnectionAttempts) {
      console.log(`Attempting to reconnect in 2 seconds...`);
      reconnectTimeout = setTimeout(() => {
        connectToSignalingServer();
      }, 2000);
    } else {
      console.error(
        "Max connection attempts reached. Please refresh the page."
      );
    }
  };

  socket.onerror = (error) => {
    console.error("WebSocket error:", error);
  };
}

export function initializeShareControls() {
  const shareBtn = document.getElementById("share-btn");
  const shareModal = document.getElementById("share-modal");
  const disconnectBtn = document.getElementById("disconnect-btn");
  const closeBtn = shareModal.querySelector(".close-button");
  const qrcodeContainer = document.getElementById("qrcode");

  shareBtn.addEventListener("click", () => {
    window.isHost = true;
    const shareUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    console.log("Sharing URL:", shareUrl);

    // Clear previous QR code
    qrcodeContainer.innerHTML = "";

    // Generate new QR code
    qrCodeInstance = new QRCode(qrcodeContainer, {
      text: shareUrl,
      width: 256,
      height: 256,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H,
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

export function disconnect() {
  console.log("User initiated disconnect.");
  Object.values(peers).forEach((peerConnection) => {
    if (peerConnection) peerConnection.close();
  });
  peers = {};
  dataChannels = {};
  updateClientCount();
  updateConnectionStatusUI("disconnected");
}

export function disconnectAllPeers() {
  if (!window.isHost) {
    console.warn("Only the host can disconnect all peers.");
    return;
  }

  console.log("Host is disconnecting all peers.");

  const payload = {
    type: "host-disconnect",
    message: "The host has closed the session.",
  };

  Object.values(dataChannels).forEach((channel) => {
    if (channel && channel.readyState === "open") {
      channel.send(JSON.stringify(payload));
    }
  });

  setTimeout(() => {
    Object.values(peers).forEach((peerConnection) => {
      if (peerConnection) peerConnection.close();
    });
    peers = {};
    dataChannels = {};
    updateClientCount();
    updateConnectionStatusUI("disconnected");
  }, 250);
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
    if (ThemeController.is3DSceneActive() && currentTheme !== "3dRoom") {
      ThemeController.applyTheme(currentTheme);
    }

    // Sync playback state
    syncPlaybackState();
  });

  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get("room");

  if (roomParam) {
    roomId = roomParam;
    window.isHost = false; // Joining an existing room, so not the host
    console.log("Joining existing room:", roomId);
  } else {
    roomId = Math.random().toString(36).substring(2, 9);
    window.isHost = true; // Creating a new room, so this is the host
    console.log("Creating new room:", roomId);
    // Update the URL without reloading the page to have a shareable link
    const newUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    window.history.pushState({ path: newUrl }, "", newUrl);
  }

  connectToSignalingServer();
}
