// js/oscilloscope.js

import AppState from "./appState.js";

const Oscilloscope = {
  canvas: null,
  canvasCtx: null,
  isDrawing: false,
  mode: "waveform", // "waveform", "spectrum", "lissajous", "radial"

  init() {
    this.canvas = document.getElementById("background-oscilloscope");
    if (!this.canvas) {
      console.error("Background oscilloscope canvas not found!");
      return;
    }
    this.canvasCtx = this.canvas.getContext("2d");
    this.canvas.style.cursor = "pointer";
    this.canvas.title = "Click to cycle visualizer mode (Waveform -> Spectrum -> Lissajous -> Radial Pulse)";

    const btn = document.getElementById("visualizer-mode-btn");
    if (btn) {
      btn.addEventListener("click", () => this.cycleMode());
    }

    this.canvas.addEventListener("click", () => {
      this.cycleMode();
    });
  },

  cycleMode() {
    const modes = ["waveform", "spectrum", "lissajous", "radial"];
    const labels = {
      waveform: "🌊 Waveform Scope",
      spectrum: "📊 Frequency RTA",
      lissajous: "🔮 Lissajous Matrix",
      radial: "💫 Radial Pulse",
    };
    const idx = modes.indexOf(this.mode);
    this.mode = modes[(idx + 1) % modes.length];

    const btn = document.getElementById("visualizer-mode-btn");
    if (btn) {
      btn.textContent = labels[this.mode] || "🌊 Visualizer";
    }
    console.log("Oscilloscope mode set to:", this.mode);
  },

  start() {
    if (this.isDrawing) return;
    this.isDrawing = true;
    this.draw();
  },

  stop() {
    this.isDrawing = false;
  },

  drawWaveform(canvasCtx, analyserNode, strokeStyle) {
    if (!analyserNode) return;
    const canvas = canvasCtx.canvas;
    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserNode.getByteTimeDomainData(dataArray);

    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = strokeStyle;
    canvasCtx.beginPath();

    const sliceWidth = (canvas.width * 1.0) / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0 - 1.0;
      const y = (v * canvas.height) / 2 + canvas.height / 2;

      if (i === 0) canvasCtx.moveTo(x, y);
      else canvasCtx.lineTo(x, y);

      x += sliceWidth;
    }

    canvasCtx.lineTo(canvas.width, canvas.height / 2);
    canvasCtx.stroke();
  },

  drawSpectrum(canvasCtx, analyserNode, fillStyle) {
    if (!analyserNode) return;
    const canvas = canvasCtx.canvas;
    const bufferLength = analyserNode.frequencyBinCount / 2;
    const dataArray = new Uint8Array(bufferLength);
    analyserNode.getByteFrequencyData(dataArray);

    const barWidth = (canvas.width / bufferLength) * 2.5;
    let x = 0;

    canvasCtx.fillStyle = fillStyle;
    for (let i = 0; i < bufferLength; i++) {
      const barHeight = (dataArray[i] / 255) * canvas.height * 0.7;
      canvasCtx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);
      x += barWidth;
    }
  },

  drawLissajous(canvasCtx, analyserNode, strokeStyle) {
    if (!analyserNode) return;
    const canvas = canvasCtx.canvas;
    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserNode.getByteTimeDomainData(dataArray);

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = Math.min(centerX, centerY) * 0.6;

    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = strokeStyle;
    canvasCtx.beginPath();

    for (let i = 0; i < bufferLength; i++) {
      const v1 = dataArray[i] / 128.0 - 1.0;
      const v2 = dataArray[(i + Math.floor(bufferLength / 4)) % bufferLength] / 128.0 - 1.0;

      const x = centerX + v1 * radius;
      const y = centerY + v2 * radius;

      if (i === 0) canvasCtx.moveTo(x, y);
      else canvasCtx.lineTo(x, y);
    }
    canvasCtx.closePath();
    canvasCtx.stroke();
  },

  drawRadial(canvasCtx, analyserNode, strokeStyle) {
    if (!analyserNode) return;
    const canvas = canvasCtx.canvas;
    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserNode.getByteFrequencyData(dataArray);

    let sum = 0;
    for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
    const avg = sum / bufferLength;

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const pulseRadius = (avg / 255) * Math.min(centerX, centerY) * 0.8 + 20;

    canvasCtx.lineWidth = 3;
    canvasCtx.strokeStyle = strokeStyle;
    canvasCtx.beginPath();
    canvasCtx.arc(centerX, centerY, pulseRadius, 0, 2 * Math.PI);
    canvasCtx.stroke();
  },

  draw() {
    if (!this.isDrawing) return;
    requestAnimationFrame(() => this.draw());

    const analyserNodes = AppState.getAnalyserNodes();

    const { width, height } = this.canvas.getBoundingClientRect();
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    this.canvasCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (analyserNodes.length === 0) return;

    const expandHex = (hex) => {
      if (/^#([0-9a-f]{3})$/i.test(hex)) {
        return "#" + hex.slice(1).split("").map((c) => c + c).join("");
      }
      return hex;
    };

    const getColor = (propName, fallback) => {
      const color = getComputedStyle(document.documentElement).getPropertyValue(propName).trim();
      return color || fallback;
    };

    const baseColors = [
      expandHex(getColor('--Main', '#00b430')),
      expandHex(getColor('--Accent', '#ffe0b2')),
      expandHex(getColor('--Highlight', '#a0faa0')),
    ];

    const adjustLightness = (color, percent) => {
      if (!/^#([0-9a-f]{6})$/i.test(color)) return color;
      let f = parseInt(color.slice(1), 16),
        t = percent < 0 ? 0 : 255,
        p = percent < 0 ? percent * -1 : percent,
        R = f >> 16,
        G = (f >> 8) & 0x00ff,
        B = f & 0x0000ff;
      return (
        "#" +
        (
          0x1000000 +
          (Math.round((t - R) * p) + R) * 0x10000 +
          (Math.round((t - G) * p) + G) * 0x100 +
          (Math.round((t - B) * p) + B)
        )
          .toString(16)
          .slice(1)
      );
    };

    const colors = analyserNodes.map((_, index) => {
      const baseColor = baseColors[index % baseColors.length];
      const lightnessAdjustment = (index % 2 === 0 ? 0.05 : -0.05) * Math.floor(index / baseColors.length);
      return adjustLightness(baseColor, lightnessAdjustment);
    });

    this.canvasCtx.globalCompositeOperation = "lighter";

    analyserNodes.forEach((analyser, index) => {
      if (analyser) {
        const color = colors[index];
        if (this.mode === "spectrum") {
          this.drawSpectrum(this.canvasCtx, analyser, color);
        } else if (this.mode === "lissajous") {
          this.drawLissajous(this.canvasCtx, analyser, color);
        } else if (this.mode === "radial") {
          this.drawRadial(this.canvasCtx, analyser, color);
        } else {
          this.drawWaveform(this.canvasCtx, analyser, color);
        }
      }
    });
  },
};

export default Oscilloscope;
