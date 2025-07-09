// Metronominal_Website/js/webrtc.js

import AppState from "./appState.js";

let peerConnection;
let dataChannel;
let receiveCallback; // Callback to notify the main script of new data

const configuration = {
  iceServers: [
    {
      urls: "stun:stun.l.google.com:19302", // Google's public STUN server
    },
  ],
};

// Function to initialize and set up a new peer connection
function createPeerConnection() {
  peerConnection = new RTCPeerConnection(configuration);

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      // When a new ICE candidate is found, we need to send it to the other peer.
      // In our manual setup, we'll just log it and include it in the offer/answer.
      console.log("New ICE candidate found. It will be included in the offer/answer.");
    }
  };

  peerConnection.ondatachannel = (event) => {
    dataChannel = event.channel;
    setupDataChannelEvents();
  };
}

// Set up event listeners for the data channel
function setupDataChannelEvents() {
  dataChannel.onopen = () => {
    console.log("Data channel is open!");
    // When the channel opens, send the current state to the new peer
    sendState(AppState.getCurrentStateForPreset());
  };

  dataChannel.onclose = () => {
    console.log("Data channel is closed.");
  };

  dataChannel.onmessage = (event) => {
    const data = JSON.parse(event.data);
    // When a message is received, call the callback to update the app state
    if (receiveCallback) {
      receiveCallback(data);
    }
  };
}

// Function to send the metronome state to the other peer
export function sendState(state) {
  if (dataChannel && dataChannel.readyState === "open") {
    dataChannel.send(JSON.stringify(state));
  }
}

// ---- Public API for WebRTC Controller ----

export const WebRTC = {
  // Set the callback function to handle incoming state updates
  onReceiveState(callback) {
    receiveCallback = callback;
  },

  // Called by the initiator to create an offer
  async createOffer() {
    createPeerConnection();
    dataChannel = peerConnection.createDataChannel("metronome-sync");
    setupDataChannelEvents();

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    return new Promise((resolve) => {
      // Wait for ICE gathering to complete
      peerConnection.onicegatheringstatechange = () => {
        if (peerConnection.iceGatheringState === "complete") {
          resolve(peerConnection.localDescription);
        }
      };
    });
  },

  // Called by the receiver to create an answer
  async createAnswer(offer) {
    createPeerConnection();
    await peerConnection.setRemoteDescription(offer);

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    return new Promise((resolve) => {
      peerConnection.onicegatheringstatechange = () => {
        if (peerConnection.iceGatheringState === "complete") {
          resolve(peerConnection.localDescription);
        }
      };
    });
  },

  // Called by the initiator to accept the answer
  async acceptAnswer(answer) {
    await peerConnection.setRemoteDescription(answer);
    console.log("Connection established!");
  },
};

export function initializeShareControls() {
  const shareBtn = document.getElementById("share-btn");
  const shareModal = document.getElementById("share-modal");
  const closeBtn = shareModal.querySelector(".close-button");
  const offerSdpTextarea = document.getElementById("offer-sdp");
  const connectBtn = document.getElementById("connect-btn");
  const answerSdpTextarea = document.getElementById("answer-sdp");

  // Show the modal
  shareBtn.addEventListener("click", async () => {
    shareModal.style.display = "block";
    const offer = await WebRTC.createOffer();
    offerSdpTextarea.value = JSON.stringify(offer);

    // Generate QR Code
    const url = window.location.href;
    const qrcodeContainer = document.getElementById("qrcode");
    qrcodeContainer.innerHTML = ""; // Clear previous QR code
    qrCodeInstance = new QRCode(qrcodeContainer, {
      text: url,
      width: 256,
      height: 256,
      correctLevel: QRCode.CorrectLevel.H,
    });
  });

  // Hide the modal
  closeBtn.addEventListener("click", () => {
    shareModal.style.display = "none";
  });
  window.addEventListener("click", (event) => {
    if (event.target == shareModal) {
      shareModal.style.display = "none";
    }
  });

  // Handle the connection logic
  connectBtn.addEventListener("click", async () => {
    const answer = JSON.parse(answerSdpTextarea.value);
    await WebRTC.acceptAnswer(answer);
  });
}

/**
 * NEW: Initializes the WebRTC module and sets up the receiver logic.
 */
export function initializeWebRTC() {
  WebRTC.onReceiveState((newState) => {
    console.log("Received new state:", newState);
    AppState.loadPresetData(newState);
    // We need to refresh the UI without sending the state back again,
    // to prevent an infinite loop.
    TempoController.updateTempoDisplay({ animate: true });
    VolumeController.updateVolumeDisplay({ animate: true });
    TrackController.renderTracks();
    BarControlsController.updateBarControlsForSelectedTrack();

    // Re-apply theme if needed
    const currentTheme = AppState.getCurrentTheme();
    if(ThemeController.is3DSceneActive() && currentTheme !== '3dRoom') {
         ThemeController.applyTheme(currentTheme);
    }
  });

  // Logic for the peer who scans the QR code and has to create an answer
  const offerSdpTextarea = document.getElementById("offer-sdp");
  const answerSdpTextarea = document.getElementById("answer-sdp");
  const connectBtn = document.getElementById("connect-btn");
  const shareModal = document.getElementById("share-modal");

  // Re-purpose the UI for the second user
  offerSdpTextarea.placeholder = "Paste the offer from your friend here.";
  offerSdpTextarea.readOnly = false;
  connectBtn.textContent = "Create Answer";

  connectBtn.onclick = async () => {
    if (offerSdpTextarea.value) {
      const offer = JSON.parse(offerSdpTextarea.value);
      const answer = await WebRTC.createAnswer(offer);
      answerSdpTextarea.value = JSON.stringify(answer);
      answerSdpTextarea.readOnly = true;
      connectBtn.style.display = "none";
      
      // Update UI text for clarity
      shareModal.querySelector(".connection-box:nth-child(3) h3").textContent = "Your Answer";
      shareModal.querySelector(".connection-box:nth-child(3) p").textContent = "Send this back to your friend.";

    } else {
      alert("Please paste the offer from your friend first.");
    }
  };
}

