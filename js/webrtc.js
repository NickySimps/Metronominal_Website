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
let qrCodeInstance = null; // To hold the QRCode instance

const configuration = {
    iceServers: [{
        urls: "stun:stun.l.google.com:19302"
    }, ],
};

function sendMessage(message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
    }
}

function createPeerConnection() {
    peerConnection = new RTCPeerConnection(configuration);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            sendMessage({
                type: "candidate",
                candidate: event.candidate,
                room: roomId
            });
        }
    };

    peerConnection.ondatachannel = (event) => {
        dataChannel = event.channel;
        setupDataChannelEvents();
    };
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
        const data = JSON.parse(event.data);
        if (receiveCallback) {
            receiveCallback(data);
        }
    };
}

export function sendState(state) {
    if (dataChannel && dataChannel.readyState === "open") {
        dataChannel.send(JSON.stringify(state));
    }
}

export const WebRTC = {
    onReceiveState(callback) {
        receiveCallback = callback;
    },

    async createOffer() {
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
    },

    async createAnswer(offer) {
        createPeerConnection();
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        sendMessage({
            type: "answer",
            answer: answer,
            room: roomId
        });
    },

    async acceptAnswer(answer) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        console.log("Connection established!");
    },

    async addIceCandidate(candidate) {
        if (peerConnection) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
    },
};

function connectToSignalingServer() {
    // IMPORTANT: Replace with your deployed signaling server's public URL
    // For example: 'wss://your-signaling-server.onrender.com'
    socket = new WebSocket("wss://metronomesignalserver.onrender.com/");

    socket.onopen = () => {
        console.log("Connected to signaling server.");
        sendMessage({
            type: "join",
            room: roomId
        });
    };

    socket.onmessage = async (message) => {
        const data = JSON.parse(message.data);
        switch (data.type) {
            case "offer":
                await WebRTC.createAnswer(data.offer);
                break;
            case "answer":
                await WebRTC.acceptAnswer(data.answer);
                break;
            case "candidate":
                await WebRTC.addIceCandidate(data.candidate);
                break;
            case "peer-joined":
                // The first peer creates the offer when the second peer joins
                await WebRTC.createOffer();
                break;
        }
    };

    socket.onclose = () => {
        console.log("Disconnected from signaling server.");
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
        const shareUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;

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
    WebRTC.onReceiveState((newState) => {
        console.log("Received new state:", newState);
        AppState.loadPresetData(newState);
        TempoController.updateTempoDisplay({
            animate: true
        });
        VolumeController.updateVolumeDisplay({
            animate: true
        });
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
    } else {
        roomId = Math.random().toString(36).substring(2, 9);
        // We need to update the URL without reloading the page to have a shareable link
        const newUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
        window.history.pushState({
            path: newUrl
        }, '', newUrl);
    }

    connectToSignalingServer();
}