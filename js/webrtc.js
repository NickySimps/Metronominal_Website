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

let candidateQueues = {}; // Queue for ICE candidates arriving before remote description

const configuration = {
  iceServers: [
    // Prioritize OpenRelay (TURN) for reliable mobile/NAT traversal
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    // Fallback to Google/Mozilla STUN
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
    { urls: "stun:stun.services.mozilla.com" },
    { urls: "stun:global.stun.twilio.com:3478" }
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

  shareBtn.classList.remove("connected", "connecting", "failed", "disconnected");

  if (state === 'connected') {
    disconnectBtn.style.display = '';
    shareBtn.classList.add('connected');
  } else if (state === 'connecting' || state === 'new' || state === 'checking') {
    shareBtn.style.display = '';
    disconnectBtn.style.display = 'none';
    shareBtn.classList.add('connecting');
  } else if (state === 'disconnected') {
      // Keep UI active but show warning state if needed, or just stay "connected" visually 
      // if we want to hide brief blips. For now, let's show it's problematic.
      shareBtn.style.display = '';
      disconnectBtn.style.display = ''; // Allow disconnect even if technically disconnected
      shareBtn.classList.add('connecting'); // Re-use connecting yellow for disconnected/reconnecting
  } else { // closed, failed
    shareBtn.style.display = '';
    disconnectBtn.style.display = 'none';
    if (state === "failed") shareBtn.classList.add("failed");
  }
}

function createPeerConnection(peerId) {
  console.log("Creating peer connection for:", peerId);
  logToScreen(`Creating RTCPeerConnection for ${peerId}`);
  
  let peerConnection;
  try {
      peerConnection = new RTCPeerConnection(configuration);
  } catch (e) {
      logToScreen(`CRITICAL: Failed to create RTCPeerConnection: ${e.message}`);
      return null;
  }

  // Initialize queue for this peer
  candidateQueues[peerId] = [];

  peerConnection.onicecandidate = (event) => {
      // Send candidate or null (end of candidates)
      const type = event.candidate ? event.candidate.type : 'End of candidates';
      const protocol = event.candidate ? event.candidate.protocol : '';
      console.log(`Sending ICE candidate for peer ${peerId}: ${type} ${protocol}`);
      
      sendMessage({
        type: "candidate",
        candidate: event.candidate,
        room: roomId,
        peerId: peerId,
      });
  };

  peerConnection.ondatachannel = (event) => {
    console.log("Received data channel for peer:", peerId);
    dataChannels[peerId] = event.channel;
    setupDataChannelEvents(peerId);
  };

  peerConnection.onicecandidateerror = (event) => {
      console.warn("ICE Candidate Error for peer (non-fatal):", peerId, event);
  };

  peerConnection.onconnectionstatechange = () => {
    logToScreen(`Connection state for ${peerId}: ${peerConnection.connectionState}`);
    console.log(
      "Connection state for",
      peerId,
      ":",
      peerConnection.connectionState
    );
    
    // Debug log for modal logic
    if (peerConnection.connectionState === "connected") {
        console.log("Connection established. isHost:", window.isHost);
    }

    if (peerConnection.connectionState === "connected") {
      updateClientCount();
      updateConnectionStatusUI("connected");

      if (!window.isHost) {
        const connectionModal = document.getElementById("connection-modal");
        if (connectionModal) {
            connectionModal.style.display = "block";
        }
      }
    } else if (peerConnection.connectionState === "disconnected") {
       // Temporary disconnect (e.g. switching wifi). Do NOT close immediately.
       console.warn(`Peer ${peerId} disconnected temporarily. Waiting for recovery...`);
       updateConnectionStatusUI("disconnected");
       // We can optionally set a timeout here to force close if it stays disconnected too long
    } else if (
      peerConnection.connectionState === "closed" ||
      peerConnection.connectionState === "failed"
    ) {
      console.log("Peer connection failed/closed:", peerId);
      delete peers[peerId];
      delete dataChannels[peerId];
      delete candidateQueues[peerId]; // Clean up queue
      updateClientCount();
      updateConnectionStatusUI("failed");
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
const offsetSamples = [];
const MAX_OFFSET_SAMPLES = 20;

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

function updateTimeOffset(newOffset, rtt) {
    offsetSamples.push({ offset: newOffset, rtt: rtt });
    if (offsetSamples.length > MAX_OFFSET_SAMPLES) {
        offsetSamples.shift();
    }
    
    // "Cristian's Algorithm" Optimization:
    // The sample with the lowest RTT is the most accurate because it experienced 
    // the least network buffering/jitter. We prioritize this sample.
    
    // Find sample with minimum RTT
    let bestSample = offsetSamples[0];
    for (let i = 1; i < offsetSamples.length; i++) {
        if (offsetSamples[i].rtt < bestSample.rtt) {
            bestSample = offsetSamples[i];
        }
    }
    
    timeOffset = bestSample.offset;
    // console.log(`Updated time offset: ${timeOffset}ms (Best RTT: ${bestSample.rtt}ms)`);
}

export function requestPlaybackSync() {
    if (window.isHost) return false;
    
    // Find host peer ID (assuming single host for now or broadcast to all)
    // Actually we iterate channels. Only one should be 'open' if we are a client connected to host.
    // Or we can just broadcast to all connected peers (which is just the Host)
    let sent = false;
    Object.values(dataChannels).forEach(channel => {
        if (channel.readyState === 'open') {
            channel.send(JSON.stringify({ type: 'playback-sync-request' }));
            sent = true;
        }
    });
    return sent;
}

export function broadcastSyncPulse(nextBeatWallTime, currentBar, currentBeat) {
    if (window.isHost) {
         Object.values(dataChannels).forEach(channel => {
            if (channel.readyState === 'open') {
                channel.send(JSON.stringify({
                    type: 'playback-sync-pulse',
                    nextBeatWallTime: nextBeatWallTime,
                    currentBar: currentBar,
                    currentBeat: currentBeat
                }));
            }
        });
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
        // Start time sync with a rapid burst to quickly converge on an accurate offset
        console.log("Starting burst sync...");
        let burstCount = 0;
        const burstLimit = 10;
        
        // Initial ping
        syncTimeWithHost(peerId);
        
        const burstInterval = setInterval(() => {
            burstCount++;
            if (burstCount >= burstLimit) {
                clearInterval(burstInterval);
                console.log("Burst sync complete. Switching to steady-state sync.");
                
                // Switch to steady-state sync (every 2 seconds)
                if(syncInterval) clearInterval(syncInterval);
                syncInterval = setInterval(() => syncTimeWithHost(peerId), 2000);
            } else {
                syncTimeWithHost(peerId);
            }
        }, 200); // Ping every 200ms during burst
        
        // Request playback sync immediately upon connection
        requestPlaybackSync();
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
            // NTP offset calculation
            const newOffset = t1 - (t0 + rtt / 2);
            console.log(`Time sync: RTT=${rtt}ms, Offset=${newOffset}ms`);
            updateTimeOffset(newOffset, rtt);
        }
        return;
    }

    if (data.type === 'playback-sync-request') {
        if (window.isHost) {
            const isPlaying = AppState.isPlaying();
            if (isPlaying) {
                const audioContext = AppState.getAudioContext();
                const tracks = AppState.getTracks();
                // Use the first track as reference
                if (tracks.length > 0 && audioContext) {
                    const track = tracks[0];
                    const timeToNextBeat = track.nextBeatTime - audioContext.currentTime;
                    // Calculate expected wall clock time for next beat
                    const nextBeatWallTime = Date.now() + (timeToNextBeat * 1000);
                    
                    dataChannel.send(JSON.stringify({
                        type: 'playback-sync-response',
                        isPlaying: true,
                        nextBeatWallTime: nextBeatWallTime,
                        currentBar: track.currentBar,
                        currentBeat: track.currentBeat
                    }));
                }
            } else {
                dataChannel.send(JSON.stringify({
                    type: 'playback-sync-response',
                    isPlaying: false
                }));
            }
        }
        return;
    }

    if (data.type === 'playback-sync-response') {
        if (!window.isHost) {
            if (data.isPlaying) {
                const clientTargetTime = data.nextBeatWallTime - timeOffset;
                console.log("Syncing playback to host. Target:", clientTargetTime);
                MetronomeEngine.scheduleStart(clientTargetTime, data.currentBar, data.currentBeat);
            } else {
                // Host is stopped. Ensure we are stopped.
                if (AppState.isPlaying()) {
                    MetronomeEngine.togglePlay(true);
                }
            }
        }
        return;
    }

    if (data.type === 'playback-sync-pulse') {
        if (!window.isHost && AppState.isPlaying()) {
             const hostNextBeatTime = data.nextBeatWallTime;
             const clientNow = Date.now();
             const expectedClientTime = hostNextBeatTime - timeOffset;
             
             // We need to compare this expectedClientTime with the ENGINE'S internal nextBeatTime.
             // But we don't have direct access to that variable here without exposing it or calling a method.
             // We'll pass the *target* time to the engine, and let it decide if it needs to nudge.
             MetronomeEngine.handleSyncPulse(expectedClientTime, data.currentBar, data.currentBeat);
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
    console.log("Received state update. Host playing:", shouldBePlaying);

    // Load the state, but temporarily set isPlaying to false in AppState
    // to prevent MetronomeEngine from immediately starting/stopping based on the loaded state.
    // We will handle playback synchronization explicitly below.
    AppState.loadPresetData({ ...data, isPlaying: false });

    if (receiveCallback) {
        receiveCallback(data);
    } else {
        refreshUIFromState();
    }

    // Explicitly synchronize playback state without resetting the metronome's timing.
    // If the host is playing and the client was not, start the client.
    // If the host is not playing and the client was, stop the client.
    if (shouldBePlaying && !wasPlayingOnClient) {
      console.log("Client should be playing but is not. Requesting sync.");
      requestPlaybackSync();
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


// Helper to process queued candidates
async function processCandidateQueue(peerId) {
    const queue = candidateQueues[peerId];
    if (queue && queue.length > 0) {
        console.log(`Processing ${queue.length} buffered ICE candidates for peer: ${peerId}`);
        for (const candidate of queue) {
            try {
                const peerConnection = peers[peerId];
                if(peerConnection) {
                    if (candidate) {
                        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                    } else {
                        try {
                             await peerConnection.addIceCandidate(null);
                        } catch (e) {}
                    }
                }
            } catch (e) {
                console.error("Error processing buffered candidate:", e);
            }
        }
        candidateQueues[peerId] = []; // Clear queue
    }
}

export async function sendState(statePromise) {
  const state = await statePromise;
  state.isPlaying = AppState.isPlaying(); // Ensure playback state is included
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
    
    // Process any candidates that arrived before the offer was set
    await processCandidateQueue(peerId);

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
      // Process any candidates that arrived before the answer was set
      await processCandidateQueue(peerId);
      
      console.log("Signaling complete (SDP set) for peer:", peerId);
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
        if (peerConnection.remoteDescription) {
            if (candidate) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                console.log(`Added ICE candidate for peer ${peerId}: ${candidate.type}`);
            } else {
                try {
                    await peerConnection.addIceCandidate(null);
                    console.log(`Added End-of-Candidates signal for peer: ${peerId}`);
                } catch (e) {
                    console.log("Browser ignored End-of-Candidates signal (safe to ignore).");
                }
            }
        } else {
             console.log(`Buffering ICE candidate for peer ${peerId} (remote description not set)`);
             if (!candidateQueues[peerId]) candidateQueues[peerId] = [];
             candidateQueues[peerId].push(candidate);
        }
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

let heartbeatInterval;

function logToScreen(msg) {
    console.log(msg);
    // Only show on-screen log if ?debug=true or if we are a client (likely mobile/troubleshooting)
    // For now, enabled for all clients to help diagnose the "won't connect" issue.
    if (window.isHost) return; 

    if (!document.getElementById('debug-log-box')) {
        const d = document.createElement('div');
        d.id = 'debug-log-box';
        Object.assign(d.style, {
            position: 'fixed', bottom: '0', left: '0', width: '100%', height: '150px',
            overflowY: 'scroll', background: 'rgba(0,0,0,0.8)', color: '#0f0',
            fontSize: '10px', zIndex: '10000', pointerEvents: 'none', padding: '5px',
            fontFamily: 'monospace'
        });
        document.body.appendChild(d);
    }
    const l = document.createElement('div');
    l.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    document.getElementById('debug-log-box').prepend(l);
}

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
    logToScreen("Connected to Signaling Server.");
    connectionAttempts = 0; // Reset attempts on successful connection
    sendMessage({
      type: "join",
      room: roomId,
    });
    
    // Start heartbeat
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'ping' }));
        }
    }, 30000); // 30 second heartbeat
  };

  socket.onmessage = async (message) => {
    try {
      const data = JSON.parse(message.data);
      if (data.type === 'pong') return; // Ignore heartbeat responses
      
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
            delete candidateQueues[peerId];
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
    logToScreen(`Disconnected from Signaling: ${event.code} ${event.reason}`);
    
    if (heartbeatInterval) clearInterval(heartbeatInterval);

    updateConnectionStatusUI("disconnected");

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
      alert("Unable to connect to the signaling server. Real-time features may be unavailable. Please try refreshing the page.");
    }
  };


  socket.onerror = (error) => {
    console.error("WebSocket error:", error);
    logToScreen("WebSocket Error.");
    // Don't alert here immediately, let onclose handle the persistent failure
  };
}

export function initializeShareControls() {
  const shareBtn = document.getElementById("share-btn");
  const shareModal = document.getElementById("share-modal");
  const disconnectBtn = document.getElementById("disconnect-btn");
  const closeBtn = shareModal.querySelector(".close-button");
  const qrcodeContainer = document.getElementById("qrcode");
  const copyLinkBtn = document.getElementById("copy-link-btn");
  const mobileShareBtn = document.getElementById("mobile-share-btn");

  // Check if Web Share API is supported
  if (navigator.share && mobileShareBtn) {
    mobileShareBtn.style.display = "flex";
  }

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

    // Re-query buttons to ensure we have the current DOM elements
    const currentCopyLinkBtn = document.getElementById("copy-link-btn");
    const currentMobileShareBtn = document.getElementById("mobile-share-btn");

    // Setup Copy Link button
    if (currentCopyLinkBtn) {
        // Remove old listeners to prevent duplicates if function called multiple times
        const newCopyBtn = currentCopyLinkBtn.cloneNode(true);
        currentCopyLinkBtn.parentNode.replaceChild(newCopyBtn, currentCopyLinkBtn);
        
        newCopyBtn.addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(shareUrl);
                const originalText = newCopyBtn.textContent;
                newCopyBtn.textContent = "Copied!";
                setTimeout(() => {
                    newCopyBtn.textContent = originalText;
                }, 2000);
            } catch (err) {
                console.error('Failed to copy: ', err);
                alert("Failed to copy link. Please copy it manually from the address bar.");
            }
        });
    }

    // Setup Mobile Share button
    if (currentMobileShareBtn) {
        // Remove old listeners
        const newShareBtn = currentMobileShareBtn.cloneNode(true);
        currentMobileShareBtn.parentNode.replaceChild(newShareBtn, currentMobileShareBtn);

        newShareBtn.addEventListener("click", async () => {
            try {
                await navigator.share({
                    title: 'Sync Metronominal',
                    text: 'Join my Metronominal session!',
                    url: shareUrl
                });
            } catch (err) {
                console.error('Error sharing:', err);
            }
        });
    }

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
  sessionStorage.removeItem('host_room_id');
  sessionStorage.removeItem('is_host');
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

function generateRoomId() {
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const number = Math.floor(Math.random() * 90) + 10; // 10-99
  return `${color}_${animal}_${number}`;
}

export function initializeWebRTC() {
  onReceiveState((newState) => {
    console.log("Received new state:", newState);
    // AppState.loadPresetData is handled in onmessage
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

  // Check for Secure Context / MediaDevices support (Critical for Mobile)
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (!isLocal && window.location.protocol !== 'https:') {
           const warning = "Mobile devices require a secure HTTPS connection for WebRTC. Your current connection (HTTP) blocks the metronome from connecting. Please use a secure tunnel (like ngrok) or use localhost.";
           console.warn(warning);
           setTimeout(() => alert(warning), 1000);
      }
  }

  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get("room");

  const storedHostRoomId = sessionStorage.getItem('host_room_id');
  const storedIsHost = sessionStorage.getItem('is_host') === 'true';

  if (roomParam) {
    roomId = roomParam;
    
    // Check if we were the host of this room (persisted session)
    if (storedHostRoomId === roomId && storedIsHost) {
        window.isHost = true;
        console.log("Re-joining room as Host (persisted session):", roomId);
    } else {
        window.isHost = false; // Joining an existing room, so not the host
        console.log("Joining existing room:", roomId);
    }
  } else {
    roomId = generateRoomId();
    window.isHost = true; // Creating a new room, so this is the host
    console.log("Creating new room:", roomId);
    
    // Persist host status
    sessionStorage.setItem('host_room_id', roomId);
    sessionStorage.setItem('is_host', 'true');

    // Update the URL without reloading the page to have a shareable link
    const newUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    window.history.pushState({ path: newUrl }, "", newUrl);
  }

  connectToSignalingServer();
}
