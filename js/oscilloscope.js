// js/oscilloscope.js

import AppState from "./appState.js";

const VISUALIZER_LABELS = {
  waveform: "🌊 Waveform Scope", spectrum: "📊 Frequency RTA", lissajous: "🔮 Lissajous Matrix",
  radial: "💫 Radial Pulse", spiral: "🌀 Spiral Bloom", orbit: "🪐 Orbit Bands", grid: "▦ Grid Pulse",
  mirror: "🪞 Mirror Spectrum", stars: "✨ Starfield", ringbar: "🎡 Ring Bars", pulse: "🔆 Pulse Field",
  ripple: "💧 Water Ripples", shore: "🏖️ Shorebreak", prism: "🌈 Pastel Prism", aurora: "🌌 Aurora Flow", reactor: "⚛️ Reactor Core",
};

const Oscilloscope = {
  canvas: null,
  canvasCtx: null,
  isDrawing: false,
  mode: "waveform",
  bandEnergy: { low: 0, mid: 0, high: 0 },
  longPressTimer: null,
  longPressStart: null,
  longPressActive: false,
  suppressNextClick: false,
  modes: ["waveform", "spectrum", "lissajous", "radial", "spiral", "orbit", "grid", "mirror", "stars", "ringbar", "pulse", "ripple", "shore", "prism", "aurora", "reactor"],
  themeModes: {
    default: "waveform",
    dark: "spectrum",
    hiVis: "grid",
    synthwave: "radial",
    gundam: "orbit",
    helloKitty: "ringbar",
    beach: "shore",
    iceCream: "spiral",
    tuxedo: "mirror",
    pastel: "prism",
    colorblind: "stars",
  },

  init() {
    this.canvas = document.getElementById("background-oscilloscope");
    if (!this.canvas) {
      console.error("Background oscilloscope canvas not found!");
      return;
    }
    this.canvasCtx = this.canvas.getContext("2d");
    this.canvas.style.cursor = "default";
    this.canvas.removeAttribute("title");

    const btn = document.getElementById("visualizer-mode-btn");
    let modeMenu = document.getElementById("visualizer-mode-menu");
    if (btn && !modeMenu) {
      modeMenu = document.createElement("div");
      modeMenu.id = "visualizer-mode-menu";
      modeMenu.className = "visualizer-mode-menu";
      modeMenu.setAttribute("role", "menu");
      modeMenu.setAttribute("aria-label", "Visualizer modes");
      modeMenu.hidden = true;
      document.body.appendChild(modeMenu);
    }
    if (btn && modeMenu) {
      let modePressTimer = null;
      let modePressStart = null;
      let longPressOpened = false;
      let suppressModeClick = false;
      let modeDragOption = null;

      const setModeDragOption = (option) => {
        if (option && !modeMenu.contains(option)) option = null;
        modeDragOption = option;
        modeMenu.querySelectorAll("[data-mode]").forEach((item) => item.removeAttribute("data-drag-hover"));
        option?.setAttribute("data-drag-hover", "true");
      };

      this.modes.forEach((mode) => {
        const option = document.createElement("button");
        option.type = "button";
        option.dataset.mode = mode;
        option.setAttribute("role", "menuitem");
        option.textContent = VISUALIZER_LABELS[mode];
        option.addEventListener("pointerenter", () => {
          setModeDragOption(option);
        });
        option.addEventListener("click", () => {
          if (modeMenu.hidden) return;
          this.setMode(mode);
          modeMenu.hidden = true;
          modeDragOption = null;
          btn.setAttribute("aria-expanded", "false");
          btn.focus();
        });
        modeMenu.appendChild(option);
      });


      const updateMenuSelection = () => modeMenu.querySelectorAll("[data-mode]").forEach((option) => {
        option.setAttribute("aria-current", option.dataset.mode === this.mode ? "true" : "false");
      });
      const openModeMenu = () => {
        longPressOpened = true;
        suppressModeClick = true;
        this.suppressNextClick = true;
        updateMenuSelection();
        modeMenu.hidden = false;
        modeMenu.style.position = "fixed";
        modeMenu.style.left = "0px";
        modeMenu.style.right = "auto";
        modeMenu.style.top = "0px";
        btn.setAttribute("aria-expanded", "true");
        requestAnimationFrame(() => {
          const buttonRect = btn.getBoundingClientRect();
          const menuRect = modeMenu.getBoundingClientRect();
          const margin = 8;
          const left = Math.min(Math.max(margin, buttonRect.right - menuRect.width), innerWidth - menuRect.width - margin);
          const belowTop = buttonRect.bottom + 6;
          const top = belowTop + menuRect.height <= innerHeight - margin
            ? belowTop
            : Math.max(margin, buttonRect.top - menuRect.height - 6);
          modeMenu.style.left = `${left}px`;
          modeMenu.style.top = `${top}px`;
        });
        modeMenu.querySelector(`[data-mode="${this.mode}"]`)?.focus();
      };
      const clearModePress = () => {
        clearTimeout(modePressTimer);
        modePressTimer = null;
        modePressStart = null;
      };

      btn.addEventListener("click", () => {
        if (suppressModeClick || longPressOpened) {
          suppressModeClick = false;
          longPressOpened = false;
          return;
        }
        this.cycleMode();
      });
      btn.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        if (event.pointerType === "touch") event.preventDefault();
        modePressStart = { x: event.clientX, y: event.clientY };
        clearModePress();
        modePressStart = { x: event.clientX, y: event.clientY };
        modePressTimer = setTimeout(openModeMenu, 500);
      });
      btn.addEventListener("pointermove", (event) => {
        if (!modePressStart) return;
        if (Math.hypot(event.clientX - modePressStart.x, event.clientY - modePressStart.y) > 18) clearModePress();
      });
      btn.addEventListener("pointerup", clearModePress);
      btn.addEventListener("pointercancel", clearModePress);
      btn.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        openModeMenu();
      });
      document.addEventListener("pointerup", (event) => {
        if (modeMenu.hidden) return;
        const releaseOption = modeDragOption;
        if (!releaseOption) return;
        event.preventDefault();
        this.setMode(releaseOption.dataset.mode);
        modeMenu.hidden = true;
        modeDragOption = null;
        btn.setAttribute("aria-expanded", "false");
        btn.focus();
      });
      document.addEventListener("pointermove", (event) => {
        if (modeMenu.hidden) return;
        if (event.pointerType === "touch") event.preventDefault();
        let hoveredOption = null;
        modeMenu.querySelectorAll("[data-mode]").forEach((option) => {
          const rect = option.getBoundingClientRect();
          if (event.clientX >= rect.left && event.clientX <= rect.right
            && event.clientY >= rect.top && event.clientY <= rect.bottom) {
            hoveredOption = option;
          }
        });
        setModeDragOption(hoveredOption);
      });
      document.addEventListener("pointerdown", (event) => {
        if (!modeMenu.hidden && !modeMenu.contains(event.target) && event.target !== btn) {
          modeMenu.hidden = true;
          btn.setAttribute("aria-expanded", "false");
        }
      });
    } else if (btn) {
      btn.addEventListener("click", () => this.cycleMode());
    }

    const isBackgroundTarget = (target) => {
      if (target === this.canvas || target === document.body || target === document.documentElement) return true;
      return !target.closest("button, a, input, select, textarea, [role=button], .bar-visual, .beat-square, .theme-controls, .modal");
    };
    this.canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      this.longPressStart = { x: event.clientX, y: event.clientY };
      this.longPressActive = false;
      this.canvas.setPointerCapture?.(event.pointerId);
      clearTimeout(this.longPressTimer);
      this.longPressTimer = setTimeout(() => {
        this.longPressActive = true;
        this.suppressNextClick = true;
        document.dispatchEvent(new CustomEvent("visualizerlongpress"));
      }, 500);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.longPressStart || this.longPressActive) return;
      const distance = Math.hypot(event.clientX - this.longPressStart.x, event.clientY - this.longPressStart.y);
      if (distance > 18) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
      }
    });
    const finishLongPress = (event) => {
      if (this.longPressActive) event.preventDefault();
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
      this.longPressStart = null;
      this.longPressActive = false;
    };
    this.canvas.addEventListener("pointerup", finishLongPress);
    this.canvas.addEventListener("pointercancel", finishLongPress);
    this.canvas.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      document.dispatchEvent(new CustomEvent("visualizerlongpress"));
    });
    document.addEventListener("pointerdown", (event) => {
      if (!isBackgroundTarget(event.target) || event.target === this.canvas) return;
      if (event.button !== 0) return;
      this.longPressStart = { x: event.clientX, y: event.clientY };
      this.longPressActive = false;
      clearTimeout(this.longPressTimer);
      this.longPressTimer = setTimeout(() => {
        this.longPressActive = true;
        this.suppressNextClick = true;
        document.dispatchEvent(new CustomEvent("visualizerlongpress"));
      }, 500);
    }, true);
    document.addEventListener("pointermove", (event) => {
      if (!this.longPressStart || this.longPressActive) return;
      const distance = Math.hypot(event.clientX - this.longPressStart.x, event.clientY - this.longPressStart.y);
      if (distance > 18) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
      }
    }, true);
    document.addEventListener("pointerup", (event) => {
      if (!this.longPressStart) return;
      if (this.longPressActive) event.preventDefault();
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
      this.longPressStart = null;
      this.longPressActive = false;
    }, true);
    document.addEventListener("pointercancel", () => {
      if (!this.longPressStart) return;
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
      this.longPressStart = null;
      this.longPressActive = false;
    }, true);
    document.addEventListener("contextmenu", (event) => {
      if (!isBackgroundTarget(event.target)) return;
      event.preventDefault();
      document.dispatchEvent(new CustomEvent("visualizerlongpress"));
    });
    document.addEventListener("themeapplied", (event) => {
      this.setModeForTheme(event.detail?.themeName);
    });

  },

  setMode(mode) {
    if (!this.modes.includes(mode)) return;
    this.mode = mode;
    const labels = VISUALIZER_LABELS;
    const btn = document.getElementById("visualizer-mode-btn");
    if (btn) btn.textContent = labels[this.mode];
    if (this.canvas) this.canvas.title = `Visualizer: ${labels[this.mode]}. Click to cycle.`;
    document.querySelectorAll("#visualizer-mode-menu [data-mode]").forEach((option) => {
      option.setAttribute("aria-current", option.dataset.mode === this.mode ? "true" : "false");
      option.removeAttribute("data-drag-hover");
    });
  },

  setModeForTheme(themeName) {
    const mode = this.themeModes[themeName];
    if (mode) this.setMode(mode);
    else if (themeName === "random") this.setMode(this.modes[Math.floor(Math.random() * this.modes.length)]);
  },

  cycleMode() {
    const idx = this.modes.indexOf(this.mode);
    this.setMode(this.modes[(idx + 1) % this.modes.length]);
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

  drawSpiral(canvasCtx, analyserNode, strokeStyle) {
    const data = new Uint8Array(analyserNode.frequencyBinCount);
    analyserNode.getByteTimeDomainData(data);
    const { width, height } = canvasCtx.canvas;
    const cx = width / 2, cy = height / 2, maxRadius = Math.min(cx, cy) * .9;
    canvasCtx.strokeStyle = strokeStyle; canvasCtx.lineWidth = 2; canvasCtx.beginPath();
    for (let i = 0; i < data.length; i += 2) {
      const angle = (i / data.length) * Math.PI * 10;
      const radius = (i / data.length) * maxRadius * (0.35 + data[i] / 255 * .65);
      const x = cx + Math.cos(angle) * radius, y = cy + Math.sin(angle) * radius;
      i === 0 ? canvasCtx.moveTo(x, y) : canvasCtx.lineTo(x, y);
    }
    canvasCtx.stroke();
  },

  drawOrbit(canvasCtx, analyserNode, strokeStyle) {
    const data = new Uint8Array(analyserNode.frequencyBinCount);
    analyserNode.getByteFrequencyData(data);
    const { width, height } = canvasCtx.canvas, cx = width / 2, cy = height / 2;
    const radius = Math.min(cx, cy) * .45;
    canvasCtx.strokeStyle = strokeStyle; canvasCtx.lineWidth = 2;
    for (let i = 0; i < data.length; i += 8) {
      const angle = (i / data.length) * Math.PI * 2;
      const length = (data[i] / 255) * radius;
      canvasCtx.beginPath();
      canvasCtx.moveTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
      canvasCtx.lineTo(cx + Math.cos(angle) * (radius + length), cy + Math.sin(angle) * (radius + length));
      canvasCtx.stroke();
    }
    canvasCtx.beginPath(); canvasCtx.arc(cx, cy, radius, 0, Math.PI * 2); canvasCtx.stroke();
  },

  drawGrid(canvasCtx, analyserNode, strokeStyle) {
    const data = new Uint8Array(analyserNode.frequencyBinCount);
    analyserNode.getByteFrequencyData(data);
    const { width, height } = canvasCtx.canvas;
    const columns = Math.min(64, data.length), cellWidth = width / columns;
    canvasCtx.fillStyle = strokeStyle;
    for (let i = 0; i < columns; i += 1) {
      const rows = Math.floor((data[i] / 255) * 12);
      for (let row = 0; row < rows; row += 1) canvasCtx.fillRect(i * cellWidth, height - (row + 1) * 8, cellWidth - 1, 6);
    }
  },

  drawMirror(canvasCtx, analyserNode, strokeStyle) {
    const data = new Uint8Array(analyserNode.frequencyBinCount);
    analyserNode.getByteFrequencyData(data);
    const { width, height } = canvasCtx.canvas, half = width / 2;
    canvasCtx.fillStyle = strokeStyle;
    for (let i = 0; i < data.length; i += 2) {
      const x = (i / data.length) * half, bar = (data[i] / 255) * height * .45;
      canvasCtx.fillRect(half - x, height / 2 - bar, 2, bar);
      canvasCtx.fillRect(half + x, height / 2, 2, bar);
    }
  },

  drawStars(canvasCtx, analyserNode, strokeStyle) {
    const data = new Uint8Array(analyserNode.frequencyBinCount);
    analyserNode.getByteFrequencyData(data);
    const { width, height } = canvasCtx.canvas;
    canvasCtx.fillStyle = strokeStyle;
    for (let i = 0; i < data.length; i += 4) {
      const brightness = data[i] / 255, x = ((i * 47) % width), y = ((i * 83) % height);
      canvasCtx.globalAlpha = .25 + brightness * .75;
      canvasCtx.fillRect(x, y, 1 + brightness * 3, 1 + brightness * 3);
    }
    canvasCtx.globalAlpha = 1;
  },

  drawRingBars(canvasCtx, analyserNode, strokeStyle) {
    const data = new Uint8Array(analyserNode.frequencyBinCount);
    analyserNode.getByteFrequencyData(data);
    const { width, height } = canvasCtx.canvas, cx = width / 2, cy = height / 2, radius = Math.min(cx, cy) * .35;
    canvasCtx.strokeStyle = strokeStyle; canvasCtx.lineWidth = 3;
    for (let i = 0; i < data.length; i += 6) {
      const angle = i / data.length * Math.PI * 2, outer = radius + data[i] / 255 * radius;
      canvasCtx.beginPath();
      canvasCtx.moveTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
      canvasCtx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
      canvasCtx.stroke();
    }
  },

  drawPulse(canvasCtx, analyserNode, strokeStyle) {
    const data = new Uint8Array(analyserNode.frequencyBinCount);
    analyserNode.getByteFrequencyData(data);
    const average = data.reduce((sum, value) => sum + value, 0) / data.length;
    const { width, height } = canvasCtx.canvas, cx = width / 2, cy = height / 2;
    canvasCtx.strokeStyle = strokeStyle; canvasCtx.lineWidth = 3;
    for (let ring = 1; ring <= 5; ring += 1) {
      canvasCtx.globalAlpha = 1 - ring / 6;
      canvasCtx.beginPath();
      canvasCtx.arc(cx, cy, Math.min(cx, cy) * (ring / 6) * (.7 + average / 255 * .4), 0, Math.PI * 2);
      canvasCtx.stroke();
    }
    canvasCtx.globalAlpha = 1;
  },

  drawRipple(canvasCtx, analyserNode, strokeStyle) {
    const data = new Uint8Array(analyserNode.frequencyBinCount);
    analyserNode.getByteFrequencyData(data);
    const average = data.reduce((sum, value) => sum + value, 0) / data.length;
    const { width, height } = canvasCtx.canvas;
    const cx = width / 2, cy = height / 2;
    const maxRadius = Math.min(cx, cy) * .95;
    const now = performance.now() / 1000;
    canvasCtx.strokeStyle = strokeStyle;
    canvasCtx.lineWidth = Math.max(1, Math.min(3, width / 300));
    for (let ring = 0; ring < 8; ring += 1) {
      const phase = (now * (.35 + average / 510) + ring / 8) % 1;
      const radius = phase * maxRadius;
      const alpha = (1 - phase) * (.25 + average / 255 * .75);
      canvasCtx.globalAlpha = alpha;
      canvasCtx.beginPath();
      canvasCtx.arc(cx, cy, radius, 0, Math.PI * 2);
      canvasCtx.stroke();
    }
    canvasCtx.globalAlpha = 1;
  },

  drawShore(canvasCtx, analyserNode, strokeStyle) {
    const data = new Uint8Array(analyserNode.frequencyBinCount);
    analyserNode.getByteFrequencyData(data);
    const average = data.reduce((sum, value) => sum + value, 0) / data.length;
    const { width, height } = canvasCtx.canvas;
    const now = performance.now() / 1000;
    const shoreY = height * .72;
    const energy = .35 + this.bandEnergy.low * .9;
    const foamEnergy = .3 + this.bandEnergy.high * 1.2;
    const rootStyle = getComputedStyle(document.documentElement);
    const themeMain = rootStyle.getPropertyValue("--Main").trim() || strokeStyle;
    const themeAccent = rootStyle.getPropertyValue("--Accent").trim() || "#ffe0b2";
    const themeHighlight = rootStyle.getPropertyValue("--Highlight").trim() || "#a0faa0";
    const withAlpha = (color, alpha) => {
      const hex = color.match(/^#([0-9a-f]{6})$/i);
      if (hex) {
        const value = Number.parseInt(hex[1], 16);
        return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
      }
      const rgb = color.match(/^rgba?\(([^)]+)\)$/i);
      if (rgb) return `rgba(${rgb[1].split(",").slice(0, 3).join(",")}, ${alpha})`;
      return color;
    };

    canvasCtx.globalCompositeOperation = "source-over";
    const sand = canvasCtx.createLinearGradient(0, shoreY, 0, height);
    sand.addColorStop(0, withAlpha(themeAccent, .9));
    sand.addColorStop(1, withAlpha(themeMain, .95));
    canvasCtx.fillStyle = sand;
    canvasCtx.fillRect(0, shoreY, width, height - shoreY);

    for (let layer = 0; layer < 4; layer += 1) {
      const baseline = shoreY - layer * height * .13;
      canvasCtx.beginPath();
      for (let x = 0; x <= width; x += 4) {
        const wave = Math.sin(x / (42 + layer * 16) - now * (1.5 + energy) + layer) * height * .025 * energy;
        const swell = Math.sin(x / 150 + now * .7) * height * .018 * energy;
        const y = baseline + wave + swell;
        if (x === 0) canvasCtx.moveTo(x, y); else canvasCtx.lineTo(x, y);
      }
      canvasCtx.lineTo(width, height * (.85 + layer * .02));
      canvasCtx.lineTo(0, height * (.85 + layer * .02));
      canvasCtx.closePath();
      canvasCtx.fillStyle = layer === 0
        ? withAlpha(themeMain, .9)
        : withAlpha(layer % 2 ? themeHighlight : themeAccent, .24 + (1 - layer / 3) * .22);
      canvasCtx.fill();
    }

    canvasCtx.strokeStyle = withAlpha(themeAccent, .95);
    canvasCtx.lineWidth = Math.max(1.5, width / 240);
    for (let foam = 0; foam < 3; foam += 1) {
      const baseline = shoreY + foam * height * .035;
      canvasCtx.globalAlpha = .7 - foam * .16;
      canvasCtx.beginPath();
      for (let x = 0; x <= width; x += 5) {
        const y = baseline + Math.sin(x / 28 - now * (2.2 + this.bandEnergy.mid)) * height * .012 * foamEnergy;
        if (x === 0) canvasCtx.moveTo(x, y); else canvasCtx.lineTo(x, y);
      }
      canvasCtx.stroke();
    }
    canvasCtx.globalAlpha = 1;
    canvasCtx.globalCompositeOperation = "lighter";
  },

  drawPrism(canvasCtx, analyserNode, strokeStyle) {
    const data = new Uint8Array(analyserNode.frequencyBinCount);
    analyserNode.getByteFrequencyData(data);
    const average = data.reduce((sum, value) => sum + value, 0) / data.length;
    const { width, height } = canvasCtx.canvas;
    const cx = width / 2, cy = height / 2;
    const now = performance.now() / 1000;
    const colors = ["#ff8fc7", "#ffd166", "#8de7ff", "#b99cff", "#a6f58d"];
    canvasCtx.globalCompositeOperation = "lighter";
    canvasCtx.lineWidth = Math.max(2, width / 220);
    for (let ribbon = 0; ribbon < colors.length; ribbon += 1) {
      const angle = now * (.35 + ribbon * .04) + ribbon * Math.PI * 2 / colors.length;
      const radius = Math.min(cx, cy) * (.28 + this.bandEnergy.low * .42);
      const ribbonEnergy = .5 + this.bandEnergy.high;
      canvasCtx.strokeStyle = colors[ribbon];
      canvasCtx.globalAlpha = .5 + average / 510;
      canvasCtx.beginPath();
      for (let point = 0; point <= 80; point += 1) {
        const t = point / 80 * Math.PI * 2;
        const orbit = radius + Math.sin(t * 3 + now * 2 + ribbon) * height * .08 * (0.5 + average / 255);
        const x = cx + Math.cos(t + angle) * orbit;
        const y = cy + Math.sin(t + angle) * orbit * .58;
        if (point === 0) canvasCtx.moveTo(x, y); else canvasCtx.lineTo(x, y);
      }
      canvasCtx.stroke();
    }
    canvasCtx.globalAlpha = 1;
  },

  drawAurora(canvasCtx, analyserNode, color) {
    const data = new Uint8Array(analyserNode.frequencyBinCount);
    analyserNode.getByteFrequencyData(data);
    const { width, height } = canvasCtx.canvas;
    const energy = this.bandEnergy.low + this.bandEnergy.mid + this.bandEnergy.high;
    canvasCtx.beginPath();
    canvasCtx.moveTo(0, height);
    for (let i = 0; i < data.length; i += Math.max(1, Math.floor(data.length / 96))) {
      const x = (i / data.length) * width;
      const wave = Math.sin(i * 0.12 + performance.now() * 0.001) * height * 0.08;
      const y = height * 0.62 - (data[i] / 255) * height * (0.35 + energy * 0.08) + wave;
      canvasCtx.lineTo(x, y);
    }
    canvasCtx.lineTo(width, height);
    canvasCtx.closePath();
    const gradient = canvasCtx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    canvasCtx.fillStyle = gradient;
    canvasCtx.fill();
  },

  drawReactor(canvasCtx, analyserNode, color) {
    const data = new Uint8Array(analyserNode.frequencyBinCount);
    analyserNode.getByteFrequencyData(data);
    const { width, height } = canvasCtx.canvas;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * (0.18 + this.bandEnergy.low * 0.25);
    canvasCtx.beginPath();
    for (let i = 0; i < 48; i += 1) {
      const value = data[(i * 5) % data.length] / 255;
      const angle = (i / 48) * Math.PI * 2;
      const r = radius + value * Math.min(width, height) * 0.32;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (i === 0) canvasCtx.moveTo(x, y); else canvasCtx.lineTo(x, y);
    }
    canvasCtx.closePath();
    canvasCtx.strokeStyle = color;
    canvasCtx.lineWidth = 2 + this.bandEnergy.high * 3;
    canvasCtx.stroke();
    canvasCtx.fillStyle = `${color}33`;
    canvasCtx.fill();
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
        const frequencyData = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(frequencyData);
        const third = Math.max(1, Math.floor(frequencyData.length / 3));
        const averageBand = (start, end) => {
          let total = 0;
          for (let i = start; i < end; i += 1) total += frequencyData[i];
          return total / Math.max(1, end - start) / 255;
        };
        this.bandEnergy = {
          low: averageBand(0, third),
          mid: averageBand(third, third * 2),
          high: averageBand(third * 2, frequencyData.length),
        };
        const color = colors[index];
        if (this.mode === "spectrum") {
          this.drawSpectrum(this.canvasCtx, analyser, color);
        } else if (this.mode === "lissajous") {
          this.drawLissajous(this.canvasCtx, analyser, color);
        } else if (this.mode === "radial") {
          this.drawRadial(this.canvasCtx, analyser, color);
        } else if (this.mode === "spiral") {
          this.drawSpiral(this.canvasCtx, analyser, color);
        } else if (this.mode === "orbit") {
          this.drawOrbit(this.canvasCtx, analyser, color);
        } else if (this.mode === "grid") {
          this.drawGrid(this.canvasCtx, analyser, color);
        } else if (this.mode === "mirror") {
          this.drawMirror(this.canvasCtx, analyser, color);
        } else if (this.mode === "stars") {
          this.drawStars(this.canvasCtx, analyser, color);
        } else if (this.mode === "ringbar") {
          this.drawRingBars(this.canvasCtx, analyser, color);
        } else if (this.mode === "pulse") {
          this.drawPulse(this.canvasCtx, analyser, color);
        } else if (this.mode === "ripple") {
          this.drawRipple(this.canvasCtx, analyser, color);
        } else if (this.mode === "shore") {
          this.drawShore(this.canvasCtx, analyser, color);
        } else if (this.mode === "prism") {
          this.drawPrism(this.canvasCtx, analyser, color);
        } else if (this.mode === "aurora") {
          this.drawAurora(this.canvasCtx, analyser, color);
        } else if (this.mode === "reactor") {
          this.drawReactor(this.canvasCtx, analyser, color);
        } else {
          this.drawWaveform(this.canvasCtx, analyser, color);
        }
      }
    });
  },
};

export default Oscilloscope;
