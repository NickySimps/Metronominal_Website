// js/oscilloscope.js

import AppState from "./appState.js";

const Oscilloscope = {
  canvas: null,
  canvasCtx: null,
  isDrawing: false,

  /**
   * Initializes the oscilloscope by getting the canvas.
   */
  init() {
    this.canvas = document.getElementById("background-oscilloscope");
    if (!this.canvas) {
      console.error("Background oscilloscope canvas not found!");
      return;
    }
    this.canvasCtx = this.canvas.getContext("2d");
  },

  /**
   * Starts the drawing loop.
   */
  start() {
    if (this.isDrawing) return;
    this.isDrawing = true;
    this.draw();
  },

  /**
   * Stops the drawing loop.
   */
  stop() {
    this.isDrawing = false;
  },

  /**
   * Reusable drawing function for a single oscilloscope waveform.
   */
  drawOscilloscope(canvasCtx, analyserNode, strokeStyle) {
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
      const v = dataArray[i] / 128.0 - 1.0; // Normalize to [-1.0, 1.0]
      const y = (v * canvas.height) / 2 + canvas.height / 2; // Map to canvas coordinates

      if (i === 0) {
        canvasCtx.moveTo(x, y);
      } else {
        canvasCtx.lineTo(x, y);
      }

      x += sliceWidth;
    }

    canvasCtx.lineTo(canvas.width, canvas.height / 2);
    canvasCtx.stroke();
  },

  /**
   * The main drawing loop.
   */
  draw() {
    if (!this.isDrawing) return;

    requestAnimationFrame(() => this.draw());

    // Fetch the analyser nodes on each frame to stay in sync
    const analyserNodes = AppState.getAnalyserNodes();

    const { width, height } = this.canvas.getBoundingClientRect();
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    this.canvasCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (analyserNodes.length === 0) {
      return; // Nothing to draw
    }

    // Get the main color from the CSS variable
    let mainColor = getComputedStyle(document.documentElement)
      .getPropertyValue("--Main")
      .trim();

    // Expand shorthand hex like #abc to #aabbcc
    const expandHex = (hex) => {
      if (/^#([0-9a-f]{3})$/i.test(hex)) {
        return (
          "#" +
          hex
            .slice(1)
            .split("")
            .map((c) => c + c)
            .join("")
        );
      }
      return hex;
    };

    // Validate hex format
    const isValidHex = /^#([0-9a-f]{6})$/i.test(expandHex(mainColor));
    if (!isValidHex) {
      console.warn("Invalid CSS --Main color. Falling back to #00FFFF");
      mainColor = "#00FFFF";
    } else {
      mainColor = expandHex(mainColor);
    }

    // Function to adjust lightness of a hex color
    const adjustLightness = (hex, percent) => {
      let f = parseInt(hex.slice(1), 16),
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
      const lightnessAdjustment =
        (index % 2 === 0 ? 0.1 : -0.1) * Math.ceil((index + 1) / 2); // Alternate lighter/darker
      return adjustLightness(mainColor, lightnessAdjustment);
    });
    this.canvasCtx.globalCompositeOperation = "lighter"; // Additive blending for nice color mixing (optional, but looks good)

    analyserNodes.forEach((analyser, index) => {
      if (analyser) {
        const color = colors[index % colors.length];
        this.drawOscilloscope(this.canvasCtx, analyser, color);
      }
    });
  },
};

export default Oscilloscope;
