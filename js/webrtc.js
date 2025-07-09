// Metronominal_Website/js/webrtc.js

let peerConnection;
let dataChannel;
let receiveCallback;

const configuration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

function setupDataChannelEvents() {
  dataChannel.onopen = () => {
    document.getElementById('connection-status').textContent = '✅ Synced!';
  };
  dataChannel.onclose = () => {
    document.getElementById('connection-status').textContent = 'Disconnected.';
  };
  dataChannel.onmessage = (event) => {
    if (receiveCallback) receiveCallback(JSON.parse(event.data));
  };
}

export function sendState(state) {
  if (dataChannel?.readyState === 'open') {
    dataChannel.send(JSON.stringify(state));
  }
}

// Export the main WebRTC object
export const WebRTC = {
  onReceiveState(callback) {
    receiveCallback = callback;
  },

  async createOffer() {
    peerConnection = new RTCPeerConnection(configuration);
    dataChannel = peerConnection.createDataChannel("sync-channel");
    setupDataChannelEvents();
    
    return new Promise(resolve => {
        peerConnection.onicecandidate = event => {
            if (!event.candidate) {
                resolve(peerConnection.localDescription);
            }
        };
        peerConnection.createOffer().then(offer => peerConnection.setLocalDescription(offer));
    });
  },

  async createAnswer(offerSdp) {
    peerConnection = new RTCPeerConnection(configuration);
    peerConnection.ondatachannel = event => {
        dataChannel = event.channel;
        setupDataChannelEvents();
    };
    await peerConnection.setRemoteDescription(offerSdp);

    return new Promise(resolve => {
        peerConnection.onicecandidate = event => {
            if (!event.candidate) {
                resolve(peerConnection.localDescription);
            }
        };
        peerConnection.createAnswer().then(answer => peerConnection.setLocalDescription(answer));
    });
  },
  
  async acceptAnswer(answerSdp) {
    await peerConnection.setRemoteDescription(answerSdp);
  }
};