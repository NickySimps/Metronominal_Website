import { audioBufferToWav, wavToArrayBuffer } from './audioSerialization.js';
import { getBeatSlots, normalizeSliceCount } from './beatTiming.js';

/**
 * @typedef {Object} BarSetting
 * @property {number} beats - Number of beats in the bar
 * @property {number} subdivision - Subdivision value (1=quarter, 2=eighth, 3=triplet, 4=sixteenth, 6=sextuplet)
 * @property {boolean[]} rests - Array indicating rest state per beat
 */

/**
 * @typedef {Object} SoundConfig
 * @property {string} sound - Instrument sound name or custom sound identifier
 * @property {Object} settings - Instrument synthesis settings
 */

/**
 * @typedef {Object} TrackConfig
 * @property {string} [name] - Track title
 * @property {boolean} muted - Whether track is muted
 * @property {boolean} soloed - Whether track is soloed
 * @property {number} volume - Volume gain (0.0 to 1.0)
 * @property {number} currentBar - Active bar index
 * @property {number} currentBeat - Active beat index
 * @property {BarSetting[]} barSettings - Settings for each bar in track
 * @property {SoundConfig} mainBeatSound - Accent beat sound configuration
 * @property {SoundConfig} subdivisionSound - Subdivision sound configuration
 */

const defaultKick = {
  volume: 1.0,
  startFrequency: 150,
  endFrequency: 50,
  attack: 0.01,
  decay: 0.1,
  sustain: 0.5,
  release: 0.2,
  pitchEnvelopeTime: 0.1,
};

const defaultSnare = {
  volume: 1.0,
  bodyFrequencyStart: 200,
  bodyFrequencyEnd: 100,
  attack: 0.01,
  decay: 0.1,
  sustain: 0.5,
  release: 0.2,
  noiseFilterFrequency: 1500,
};

const defaultHiHat = {
  volume: 1.0,
  filterFrequency: 7000,
  attack: 0.01,
  decay: 0.05,
  sustain: 0.1,
  release: 0.05,
};

const defaultOpenHiHat = {
  volume: 1.0,
  filterFrequency: 6000,
  attack: 0.01,
  decay: 0.2,
  sustain: 0.1,
  release: 0.2,
};

const defaultHiTom = {
  volume: 1.0,
  startFrequency: 300,
  endFrequency: 150,
  attack: 0.01,
  decay: 0.2,
  sustain: 0.1,
  release: 0.1,
};

const defaultMidTom = {
  volume: 1.0,
  startFrequency: 150,
  endFrequency: 80,
  attack: 0.01,
  decay: 0.3,
  sustain: 0.1,
  release: 0.1,
};

const defaultLowTom = {
  volume: 1.0,
  startFrequency: 100,
  endFrequency: 50,
  attack: 0.01,
  decay: 0.4,
  sustain: 0.1,
  release: 0.1,
};

const defaultClap = {
  volume: 1.0,
  filterFrequency: 1200,
  qValue: 15,
  attack: 0.01,
  decay: 0.1,
  sustain: 0.1,
  release: 0.1,
};

const defaultClaves = {
  volume: 1.0,
  frequency: 2500,
  attack: 0.01,
  decay: 0.05,
  sustain: 0.1,
  release: 0.05,
};

const defaultShaker = {
  volume: 1.0,
  filterFrequency: 6000,
  qValue: 5,
  attack: 0.01,
  decay: 0.1,
  sustain: 0.1,
  release: 0.1,
};

const defaultCymbal = {
  volume: 1.0,
  filterFrequency: 8000,
  attack: 0.01,
  decay: 0.5,
  sustain: 0.1,
  release: 0.5,
};

const defaultCowbell = {
  volume: 1.0,
  frequency1: 540,
  frequency2: 800,
  attack: 0.01,
  decay: 0.1,
  sustain: 0.1,
  release: 0.1,
};

const defaultWoodblock = {
  volume: 1.0,
  frequency: 1000,
  attack: 0.01,
  decay: 0.05,
  sustain: 0.1,
  release: 0.05,
};

const defaultTriangle = {
  volume: 1.0,
  frequency: 1200,
  attack: 0.01,
  decay: 0.2,
  sustain: 0.1,
  release: 0.2,
};

const defaultMaraca = {
  volume: 1.0,
  filterFrequency: 4000,
  attack: 0.01,
  decay: 0.05,
  sustain: 0.1,
  release: 0.05,
};

const defaultSine = {
  volume: 1.0,
  frequency: 440,
  attack: 0.01,
  decay: 0.1,
  sustain: 0.5,
  release: 0.2,
};

const defaultSquare = {
  volume: 1.0,
  frequency: 440,
  attack: 0.01,
  decay: 0.1,
  sustain: 0.5,
  release: 0.2,
};

const defaultSawtooth = {
  volume: 1.0,
  frequency: 440,
  attack: 0.01,
  decay: 0.1,
  sustain: 0.5,
  release: 0.2,
};

const defaultUltrasaw = {
  volume: 1.0,
  frequency: 440,
  attack: 0.01,
  decay: 0.2,
  sustain: 0.5,
  release: 0.2,
  detune: 15,
};

const defaultNoise = {
  volume: 1.0,
  attack: 0.01,
  decay: 0.1,
  sustain: 0.1,
  release: 0.1,
};

// Helper functions for ArrayBuffer to Base64 and vice-versa
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

function base64ToArrayBuffer(base64) {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}

const defaultSoundSettings = {
  "Synth Kick": defaultKick,
  "Synth Snare": defaultSnare,
  "Synth HiHat": defaultHiHat,
  "Synth Open HiHat": defaultOpenHiHat,
  "Synth Hi Tom": defaultHiTom,
  "Synth Mid Tom": defaultMidTom,
  "Synth Low Tom": defaultLowTom,
  "Synth Clap": defaultClap,
  "Synth Claves": defaultClaves,
  "Synth Shaker": defaultShaker,
  "Synth Cymbal": defaultCymbal,
  "Synth Cowbell": defaultCowbell,
  "Synth Woodblock": defaultWoodblock,
  "Synth Triangle": defaultTriangle,
  "Synth Maraca": defaultMaraca,
  "Synth Sine": defaultSine,
  "Synth Square": defaultSquare,
  "Synth Sawtooth": defaultSawtooth,
  "Synth Ultrasaw": defaultUltrasaw,
  "Synth Noise": defaultNoise,
};

function normalizeSectionSound(value, fallbackSound, fallbackSettings) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || typeof value.sound !== "string" || !value.sound.trim()
    || /^Recording:/i.test(value.sound)) {
    return { sound: fallbackSound, settings: { ...fallbackSettings } };
  }
  const settings = value.settings && typeof value.settings === "object" && !Array.isArray(value.settings)
    ? JSON.parse(JSON.stringify(value.settings))
    : { ...fallbackSettings };
    settings.allowOverlap = settings.allowOverlap !== false;
    settings.retrigger = settings.retrigger !== false;
    settings.reverse = settings.reverse === true;
    settings.highPassFrequency = Math.max(20, Math.min(20000, Number(settings.highPassFrequency) || 20));
    settings.lowPassFrequency = Math.max(settings.highPassFrequency, Math.min(20000, Number(settings.lowPassFrequency) || 20000));
    const probability = Number(settings.probability);
    settings.probability = Number.isFinite(probability) ? Math.max(0, Math.min(100, probability)) : 100;
  return { sound: value.sound.slice(0, 64), settings };
}

function normalizeSectionTrack(value, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const bars = Array.isArray(value.barSettings) ? value.barSettings.slice(0, 64).map(bar => ({
    beats: Math.max(1, Math.min(Number.parseInt(bar?.beats, 10) || 4, 32)),
    subdivision: Math.max(0.25, Math.min(Number(bar?.subdivision) || 1, 16)),
    rests: Array.isArray(bar?.rests)
      ? bar.rests.filter(rest => Number.isInteger(rest) && rest >= 0 && rest <= 511).slice(0, 256)
      : [],
    velocities: bar?.velocities && typeof bar.velocities === "object"
      ? bar.velocities
      : {},
    beatSounds: bar?.beatSounds && typeof bar.beatSounds === "object" && !Array.isArray(bar.beatSounds)
      ? JSON.parse(JSON.stringify(bar.beatSounds))
      : {},
    beatSlices: bar?.beatSlices && typeof bar.beatSlices === "object" && !Array.isArray(bar.beatSlices)
      ? Object.fromEntries(Object.entries(bar.beatSlices).filter(([key, value]) => Number.isInteger(Number(key)) && normalizeSliceCount(value) > 1).map(([key, value]) => [key, normalizeSliceCount(value)]))
      : {},
    beatSliceAnchors: bar?.beatSliceAnchors && typeof bar.beatSliceAnchors === "object" && !Array.isArray(bar.beatSliceAnchors)
      ? Object.fromEntries(Object.entries(bar.beatSliceAnchors).filter(([key, value]) => Number.isInteger(Number(key)) && Number.isInteger(Number(value)) && Number(value) >= 0).map(([key, value]) => [key, Number(value)]))
      : {},
  })) : [];
  if (!bars.length) return null;
  return {
    ...(typeof value.name === "string" && value.name.trim()
      ? { name: value.name.trim().slice(0, 64) }
      : { name: `Track ${index + 1}` }),
    barSettings: bars,
    muted: value.muted === true,
    solo: value.solo === true,
    volume: Number.isFinite(Number(value.volume)) ? Math.max(0, Math.min(Number(value.volume), 1)) : 1,
    pitchShift: Number.isInteger(Number(value.pitchShift)) ? Math.max(-12, Math.min(Number(value.pitchShift), 12)) : 0,
    swing: Number.isFinite(Number(value.swing)) ? Math.max(0, Math.min(Number(value.swing), 100)) : 0,
    mainBeatSound: normalizeSectionSound(value.mainBeatSound, "Synth Kick", defaultKick),
    subdivisionSound: normalizeSectionSound(value.subdivisionSound, "Synth HiHat", defaultHiHat),
  };
}

const defaultSong = (tempo = 120) => ({
  version: 2,
  enabled: false,
  name: "Untitled Song",
  sections: [{ name: "Section 1", startBar: 0, tempo, repeats: 1 }],
});

function normalizeSong(value, barCount, fallbackTempo = 120) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : defaultSong(fallbackTempo);
  const safeBarCount = Math.max(1, Math.min(Number.parseInt(barCount, 10) || 1, 64));
  const sections = Array.isArray(source.sections) ? source.sections : [];
  const normalizedSections = sections
    .slice(0, 32)
    .map((section, index) => {
      const snapshotTracks = Array.isArray(section?.tracks)
        ? section.tracks.slice(0, 16).map(normalizeSectionTrack).filter(Boolean)
        : [];
      const rawStartBar = Number.parseInt(section?.startBar, 10);
      return {
        name: String(section?.name || `Section ${index + 1}`).trim().slice(0, 48) || `Section ${index + 1}`,
        startBar: Math.max(0, Math.min(Number.parseInt(section?.startBar, 10) || 0, safeBarCount - 1)),
        tempo: Math.max(20, Math.min(Number.parseInt(section?.tempo, 10) || fallbackTempo, 300)),
        repeats: Math.max(1, Math.min(Number.parseInt(section?.repeats, 10) || 1, 16)),
        __clampedStart: Number.isInteger(rawStartBar) && rawStartBar >= safeBarCount,
        ...(Array.isArray(section?.tracks) ? { tracks: snapshotTracks } : {}),
      };
    })
    .sort((a, b) => a.startBar - b.startBar)
    .filter((section, index, all) => !section.__clampedStart || index === 0 || section.startBar !== all[index - 1].startBar)
    .map(({ __clampedStart, ...section }) => section);
  if (!normalizedSections.length || normalizedSections[0].startBar !== 0) {
    normalizedSections.unshift({ name: "Section 1", startBar: 0, tempo: fallbackTempo, repeats: 1 });
  }
  return {
    version: 2,
    enabled: source.enabled === true,
    name: String(source.name || "Untitled Song").trim().slice(0, 80) || "Untitled Song",
    sections: normalizedSections,
  };
}

const AppState = (function () {
  // --- Private State ---
  let tempo = 120;
  let volume = 1.0;
  let countInBars = 0;
  let song = defaultSong(tempo);
  let activeSongSectionIndex = 0;
  let Tracks = [
    {
      barSettings: [{ beats: 4, subdivision: 1, rests: [] }],
      muted: false,
      solo: false,
      volume: 1.0,
      pitchShift: 0,
      swing: 0,
      currentBar: 0,
      currentBeat: 0,
      mainBeatSound: { sound: "Synth Kick", settings: { ...defaultKick } },
      subdivisionSound: { sound: "Synth HiHat", settings: { ...defaultHiHat } },
      nextBeatTime: 0,
      analyserNode: null,
      mainAnalyserNode: null,
      subdivisionAnalyserNode: null,
    },
  ];
  let selectedTrackIndex = 0;
  let selectedBarIndexInContainer = 0;
  let controlsAttachedToTrack = true; // NEW: Tracks if controls are attached to a track or in default position
  let isPlaying = false;
  let tapTempoTimestamps = [];
  let audioContext = null;
  let soundBuffers = {};
  let currentTheme = "default";
  let isRestMode = false;
  let isAccentMode = false;
  let isSliceMode = false;
  let isRecording = false;
  let recordings = [];
  let customSounds = {}; // Stores custom user presets: { "My Kick": { baseSound: "Synth Kick", settings: {...} } }
  let isWakeLockEnabled = false;
  let audioLatencyOffset = 0; // Latency offset in ms (-200 to +500)
  let abLoop = { enabled: false, startBar: 0, endBar: 1 };

  function getAbLoopBarCount() {
    const selectedTrack = Tracks[selectedTrackIndex] || Tracks[0];
    return Math.max(1, Math.min(selectedTrack?.barSettings?.length || 1, 64));
  }

  function normalizeAbLoop(settings = {}) {
    const maxBar = getAbLoopBarCount() - 1;
    const startBar = Math.max(0, Math.min(Number.parseInt(settings.startBar ?? abLoop.startBar, 10) || 0, maxBar));
    const endBar = Math.max(0, Math.min(Number.parseInt(settings.endBar ?? abLoop.endBar, 10) || 0, maxBar));
    return {
      ...abLoop,
      ...settings,
      startBar: Math.min(startBar, endBar),
      endBar: Math.max(startBar, endBar),
    };
  }

  // --- Constants ---
  const MAX_TAPS_FOR_AVERAGE = 4;
  const MAX_TAP_INTERVAL_MS = 3000;
  const SCHEDULE_AHEAD_TIME_INTERNAL = 0.1;
  const POST_RESUME_DELAY_MS = 50;
  const LOCAL_STORAGE_KEY = "metronominalState";

  // --- Private Functions ---
  let saveStateTimeout = null;

  const saveStateImmediate = async () => {
    try {
      const state = await publicAPI.getCurrentStateForPreset();
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error("Could not save state to localStorage:", e);
    }
  };

  const saveState = () => {
    if (saveStateTimeout) clearTimeout(saveStateTimeout);
    saveStateTimeout = setTimeout(saveStateImmediate, 300);
  };

  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", () => {
      if (saveStateTimeout) {
        clearTimeout(saveStateTimeout);
        saveStateImmediate();
      }
    });
  }

  // --- Public API ---
  const publicAPI = {
    // Persistence
    saveStateToLocalStorage: saveState,
    loadStateFromLocalStorage: async () => {
      try {
        const savedState = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (savedState) {
          const parsedState = JSON.parse(savedState);
          await publicAPI.loadPresetData(parsedState);
          return true; // Indicates success
        }
        return false; // No saved state found
      } catch (e) {
        console.error("Could not load state from localStorage:", e);
        return false; // Error during loading
      }
    },

    // Custom Sounds
    getCustomSounds: () => Object.keys(customSounds),
    getCustomSoundData: (name) => customSounds[name],
    addCustomSound: (name, baseSound, settings) => {
        customSounds[name] = { baseSound, settings: JSON.parse(JSON.stringify(settings)) };
        saveState();
    },
    deleteCustomSound: (name) => {
        if (customSounds[name]) {
            delete customSounds[name];
            // Reset tracks using this sound
            Tracks.forEach(track => {
                // Check if the deleted sound is a default sound name
                const isDefaultSound = !!defaultSoundSettings[name];

                if (track.mainBeatSound.sound === name) {
                    if (isDefaultSound) {
                         // Revert settings but keep name
                         track.mainBeatSound.settings = { ...defaultSoundSettings[name] };
                    } else {
                         // Fallback to default Kick
                        track.mainBeatSound.sound = "Synth Kick";
                        track.mainBeatSound.settings = { ...defaultKick };
                    }
                }
                if (track.subdivisionSound.sound === name) {
                    if (isDefaultSound) {
                        track.subdivisionSound.settings = { ...defaultSoundSettings[name] };
                    } else {
                        track.subdivisionSound.sound = "Synth HiHat";
                        track.subdivisionSound.settings = { ...defaultHiHat };
                    }
                }
            });
            saveState();
        }
    },
    renameCustomSound: (oldName, newName) => {
        if (oldName === newName) return;
        if (customSounds[newName]) {
             console.warn(`Custom sound "${newName}" already exists.`);
             return;
        }
        if (customSounds[oldName]) {
            customSounds[newName] = customSounds[oldName];
            delete customSounds[oldName];
            
            // Update tracks
            Tracks.forEach(track => {
                if (track.mainBeatSound.sound === oldName) track.mainBeatSound.sound = newName;
                if (track.subdivisionSound.sound === oldName) track.subdivisionSound.sound = newName;
            });
            saveState();
        }
    },

    // Tempo
    getTempo: () => tempo,
    setTempo: (newTempo, options = {}) => {
      const oldTempo = tempo;
      const parsedTempo = Math.max(20, Math.min(parseInt(newTempo, 10) || 120, 300));
      tempo = parsedTempo;
      
      if (isPlaying && audioContext && oldTempo !== parsedTempo && options.reschedule !== false) {
          const currentTime = audioContext.currentTime;
          const ratio = oldTempo / parsedTempo;
          
          Tracks.forEach(track => {
             const timeRemaining = track.nextBeatTime - currentTime;
             // Scale the remaining time to match the new tempo
             if (timeRemaining > 0) {
                 track.nextBeatTime = currentTime + (timeRemaining * ratio);
             }
          });
      }
      if (options.persist !== false) saveState();
      if (typeof document !== "undefined" && oldTempo !== parsedTempo) {
        document.dispatchEvent(new CustomEvent("tempochange", { detail: { tempo: parsedTempo } }));
      }
    },
    increaseTempo: () => publicAPI.setTempo(tempo + 1),
    decreaseTempo: () => publicAPI.setTempo(tempo - 1),
    getCountInBars: () => countInBars,
    setCountInBars: (bars) => {
      const parsed = Number.parseInt(bars, 10);
      countInBars = Number.isInteger(parsed) ? Math.max(0, Math.min(parsed, 8)) : 0;
      saveState();
    },
    getSong: () => {
      song = normalizeSong(song, Tracks[0]?.barSettings?.length, tempo);
      return JSON.parse(JSON.stringify(song));
    },
    setSong: (nextSong) => {
      song = normalizeSong(nextSong, Tracks[0]?.barSettings?.length, tempo);
      saveState();
    },
    getPlaybackTempo: (barIndex = 0) => {
      if (!song.enabled) return tempo;
      let activeSection = song.sections[0];
      for (const section of song.sections) {
        if (section.startBar > barIndex) break;
        activeSection = section;
      }
      return activeSection?.tempo || tempo;
    },
    getSongSectionForBar: (barIndex = 0) => {
      let activeIndex = 0;
      for (let index = 0; index < song.sections.length; index += 1) {
        if (song.sections[index].startBar > barIndex) break;
        activeIndex = index;
      }
      return { index: activeIndex, ...song.sections[activeIndex] };
    },
    applySongSectionForBar: (barIndex = 0) => {
      if (!song.enabled) return false;
      const section = publicAPI.getSongSectionForBar(barIndex);
      if (!Array.isArray(section?.tracks)) return false;
      activeSongSectionIndex = section.index;
      section.tracks.forEach((snapshot, index) => {
        const track = Tracks[index] || (Tracks[index] = {
          ...JSON.parse(JSON.stringify(snapshot)),
          currentBar: 0,
          currentBeat: 0,
        });
        if (!snapshot) return;
        const currentBar = track.currentBar;
        track.name = snapshot.name || track.name;
        const existingBars = track.barSettings || [];
        const snapshotBars = Array.isArray(snapshot.barSettings) ? snapshot.barSettings : existingBars;
        const targetBarCount = Math.max(existingBars.length, snapshotBars.length, 1);
        track.barSettings = Array.from({ length: targetBarCount }, (_, barIndex) => JSON.parse(JSON.stringify(
          snapshotBars[barIndex] || existingBars[barIndex] || snapshotBars[snapshotBars.length - 1] || existingBars[existingBars.length - 1]
        )));
        track.muted = snapshot.muted === true;
        track.solo = snapshot.solo === true;
        track.volume = Number.isFinite(snapshot.volume) ? snapshot.volume : track.volume;
        track.pitchShift = Number.isFinite(snapshot.pitchShift) ? snapshot.pitchShift : track.pitchShift;
        track.swing = Number.isFinite(snapshot.swing) ? snapshot.swing : track.swing;
        track.mainBeatSound = JSON.parse(JSON.stringify(snapshot.mainBeatSound || track.mainBeatSound));
        track.subdivisionSound = JSON.parse(JSON.stringify(snapshot.subdivisionSound || track.subdivisionSound));
        track.currentBar = Math.min(currentBar, Math.max(0, track.barSettings.length - 1));
        track.currentBeat = 0;
      });
      Tracks.forEach((track) => {
        if (!Number.isFinite(track.nextBeatTime)) {
          track.nextBeatTime = Number.isFinite(Tracks[0]?.nextBeatTime)
            ? Tracks[0].nextBeatTime
            : audioContext?.currentTime || 0;
        }
        if (!Number.isFinite(track.currentBar)) track.currentBar = 0;
        if (!Number.isFinite(track.currentBeat)) track.currentBeat = 0;
      });
      Tracks.length = section.tracks.length;
      if (typeof document !== "undefined") {
        document.dispatchEvent(new CustomEvent("songtracksectionchange", {
          detail: { sectionIndex: section.index, trackCount: section.tracks.length, tempo: section.tempo || tempo },
        }));
      }
      return true;
    },
    getNextSongPosition: (barIndex = 0, repeatIteration = 0, barCount = Tracks[0]?.barSettings?.length || 1, options = {}) => {
      const useLongestTrack = options.useLongestTrack === true;
      const longestTrackBarCount = Tracks.reduce((longest, track) => Math.max(longest, track.barSettings?.length || 0), 0);
      const requestedBarCount = Number.parseInt(barCount, 10) || 1;
      const safeBarCount = Math.max(1, Math.min(
        useLongestTrack ? Math.max(requestedBarCount, longestTrackBarCount || 1) : requestedBarCount,
        64,
      ));
      const currentBar = Math.max(0, Math.min(Number.parseInt(barIndex, 10) || 0, safeBarCount - 1));
      if (!song.enabled) return { bar: (currentBar + 1) % safeBarCount, repeatIteration: 0, sectionTransition: false };
      let active;
      if (!useLongestTrack) {
        active = publicAPI.getSongSectionForBar(currentBar);
      } else {
        const activeIndex = Math.min(activeSongSectionIndex, Math.max(0, song.sections.length - 1));
        active = { index: activeIndex, ...song.sections[activeIndex] };
      }
      const nextSection = song.sections[active.index + 1];
      const longestSectionEnd = useLongestTrack
        ? Math.max(nextSection?.startBar ?? 0, longestTrackBarCount)
        : (nextSection?.startBar ?? safeBarCount);
      const sectionEnd = Math.min(longestSectionEnd || safeBarCount, safeBarCount);
      const repeatBoundary = nextSection?.startBar ?? sectionEnd;
      if (currentBar + 1 < repeatBoundary) return {
        bar: currentBar + 1,
        repeatIteration: Math.max(0, Math.min(Number.parseInt(repeatIteration, 10) || 0, 15)),
        sectionTransition: false,
      };
      const currentIteration = Math.max(0, Math.min(Number.parseInt(repeatIteration, 10) || 0, 15));
      if (currentIteration + 1 < active.repeats) {
        return { bar: active.startBar, repeatIteration: currentIteration + 1, sectionTransition: false };
      }
      if (currentBar + 1 < sectionEnd) {
        return { bar: currentBar + 1, repeatIteration: 0, sectionTransition: false };
      }
      const transitionBar = nextSection ? nextSection.startBar : 0;
      return { bar: transitionBar >= safeBarCount ? 0 : transitionBar, repeatIteration: 0, sectionTransition: true };
    },
    addTapTimestamp: (timestamp) => {
      if (
        tapTempoTimestamps.length > 0 &&
        timestamp - tapTempoTimestamps[tapTempoTimestamps.length - 1] >
          MAX_TAP_INTERVAL_MS
      ) {
        tapTempoTimestamps = [];
      }
      tapTempoTimestamps.push(timestamp);
      if (tapTempoTimestamps.length > MAX_TAPS_FOR_AVERAGE) {
        tapTempoTimestamps.shift();
      }
    },
    getTapCount: () => tapTempoTimestamps.length,
    calculateTapTempo: () => {
      if (tapTempoTimestamps.length < 2) return null;
      let totalInterval = 0;
      for (let i = 1; i < tapTempoTimestamps.length; i++) {
        totalInterval += tapTempoTimestamps[i] - tapTempoTimestamps[i - 1];
      }
      const averageInterval = totalInterval / (tapTempoTimestamps.length - 1);
      if (averageInterval > 0) {
        const newTempo = Math.round(60000 / averageInterval);
        publicAPI.setTempo(newTempo);
        return tempo;
      }
      return null;
    },

    // Volume
    getVolume: () => volume,
    setVolume: (newVolume) => {
      volume = Math.max(0, Math.min(parseFloat(newVolume), 1));
      saveState();
    },

    // A/B Bar Looper
    getAbLoopBarCount: () => getAbLoopBarCount(),
    getAbLoop: () => ({ ...normalizeAbLoop(abLoop) }),
    setAbLoop: (settings) => {
      abLoop = normalizeAbLoop(settings);
      saveState();
    },

    // Playback State
    getControlsAttachedToTrack: () => controlsAttachedToTrack,
    setControlsAttachedToTrack: (isAttached) => {
        controlsAttachedToTrack = !!isAttached;
        saveState();
    },
    isRestMode: () => isRestMode,
    setRestMode: (mode) => {
      isRestMode = !!mode;
      if (isRestMode) isAccentMode = false;
      saveState();
    },
    isAccentMode: () => isAccentMode,
    setAccentMode: (mode) => {
      isAccentMode = !!mode;
      if (isAccentMode) isRestMode = false;
      saveState();
    },

    isSliceMode: () => isSliceMode,
    setSliceMode: (mode) => {
      isSliceMode = !!mode;
      if (isSliceMode) {
        isRestMode = false;
        isAccentMode = false;
      }
      saveState();
    },

    isRecording: () => isRecording,
    setRecording: (recording) => {
        isRecording = recording;
        saveState();
    },
    getLatencyOffset: () => audioLatencyOffset,
    setLatencyOffset: (offsetMs) => {
        audioLatencyOffset = Math.max(-200, Math.min(500, parseInt(offsetMs, 10) || 0));
        saveState();
    },
    isWakeLockEnabled: () => isWakeLockEnabled,
    setWakeLockEnabled: (enabled) => {
        isWakeLockEnabled = enabled;
        saveState();
    },
    getRecordings: () => recordings,
    addRecording: (recordingName) => {
        recordings.push(recordingName);
        saveState();
    },

    deleteRecording: (recordingName) => {
        const index = recordings.indexOf(recordingName);
        if (index > -1) {
            recordings.splice(index, 1);
        }
        delete soundBuffers[recordingName];

        // Check if any track is using the deleted sound and reset it
        Tracks.forEach(track => {
            if (track.mainBeatSound.sound === recordingName) {
                track.mainBeatSound.sound = "Synth Kick";
                track.mainBeatSound.settings = { ...defaultKick };
            }
            if (track.subdivisionSound.sound === recordingName) {
                track.subdivisionSound.sound = "Synth HiHat";
                track.subdivisionSound.settings = { ...defaultHiHat };
            }
        });
        saveState();
    },

    renameRecording: (oldName, newName) => {
        if (oldName === newName) return; // No change

        // Check if newName already exists
        if (recordings.includes(newName)) {
            console.warn(`Recording with name "${newName}" already exists. Cannot rename.`);
            return;
        }

        const index = recordings.indexOf(oldName);
        if (index > -1) {
            recordings[index] = newName; // Update name in recordings array
        }

        // Update soundBuffers
        if (soundBuffers[oldName]) {
            soundBuffers[newName] = soundBuffers[oldName];
            delete soundBuffers[oldName];
        }

        // Update any tracks using the old name
        Tracks.forEach(track => {
            if (track.mainBeatSound.sound === oldName) {
                track.mainBeatSound.sound = newName;
            }
            if (track.subdivisionSound.sound === oldName) {
                track.subdivisionSound.sound = newName;
            }
        });

        saveState();
    },
    isPlaying: () => isPlaying,
    togglePlay: async () => {
      if (
        !isPlaying &&
        Tracks.every((container) => container.barSettings.length === 0)
      ) {
        console.log("Cannot start: No bars configured in any container.");
        return false;
      }

      isPlaying = !isPlaying;
      document.dispatchEvent(new CustomEvent("playbackstatechange", { detail: { playing: isPlaying } }));

      if (isPlaying) {
        if (audioContext) {
          // Attempt to resume audio context if suspended
          if (audioContext.state === 'suspended') {
            try {
              await audioContext.resume();
              console.log("AudioContext resumed by togglePlay.");
            } catch (e) {
              console.error("Error resuming AudioContext from togglePlay:", e);
            }
          }
          const currentTime = audioContext.currentTime;
          Tracks.forEach((track) => {
            track.currentBar = 0;
            track.currentBeat = 0;
            track.nextBeatTime = currentTime + publicAPI.SCHEDULE_AHEAD_TIME;
          });
        }
      }
      return isPlaying;
    },

    getTracks: () => Tracks,
    addTrack: () => {
      const newTrack = {
        barSettings: [{ beats: 4, subdivision: 1, rests: [] }],
        muted: false,
        solo: false,
        volume: 1.0,
        pitchShift: 0,
        swing: 0,
        currentBar: 0,
        currentBeat: 0,
        mainBeatSound: { sound: "Synth Kick", settings: { ...defaultKick } },
        subdivisionSound: {
          sound: "Synth HiHat",
          settings: { ...defaultHiHat },
        },
        nextBeatTime: 0,
        analyserNode: null,
      mainAnalyserNode: null,
      subdivisionAnalyserNode: null,
      };
      if (audioContext) {
        const analyser = audioContext.createAnalyser();
        analyser.connect(audioContext.destination);
        newTrack.analyserNode = analyser;
        newTrack.mainAnalyserNode = audioContext.createAnalyser();
        newTrack.mainAnalyserNode.connect(analyser);
        newTrack.subdivisionAnalyserNode = audioContext.createAnalyser();
        newTrack.subdivisionAnalyserNode.connect(analyser);
      }
      if (isPlaying && Tracks.length > 0) {
        const referenceTrack = Tracks.find(t => t.barSettings && t.barSettings.length > 0) || Tracks[0];
        const referenceBarSetting = referenceTrack.barSettings[referenceTrack.currentBar];
        
        // Default to alignment with start if something is wrong with reference
        if (!referenceBarSetting) {
             newTrack.nextBeatTime = audioContext.currentTime + publicAPI.SCHEDULE_AHEAD_TIME;
        } else {
            const refSubdivision = referenceBarSetting.subdivision || 1;
            const secondsPerMainBeat = 60.0 / tempo;
            
            // Calculate time per sub-beat for the reference track
            let secondsPerRefSubBeat;
            if (refSubdivision >= 1) {
                secondsPerRefSubBeat = secondsPerMainBeat / refSubdivision;
            } else {
                secondsPerRefSubBeat = secondsPerMainBeat * (1 / refSubdivision);
            }

            // Calculate how many sub-beats are left in the current main beat of the reference track
            const subBeatIndex = referenceTrack.currentBeat % refSubdivision;
            
            if (subBeatIndex === 0) {
                // On Main Beat: Sync directly
                newTrack.nextBeatTime = referenceTrack.nextBeatTime;
                // Align bar index, wrapping if necessary
                newTrack.currentBar = referenceTrack.currentBar % newTrack.barSettings.length;
                const mainBeatIndex = Math.floor(referenceTrack.currentBeat / refSubdivision);
                newTrack.currentBeat = mainBeatIndex;
            } else {
                // Between Main Beats: Schedule for the NEXT main beat
                const subBeatsRemaining = refSubdivision - subBeatIndex;
                const timeToNextMainBeat = subBeatsRemaining * secondsPerRefSubBeat;
                
                newTrack.nextBeatTime = referenceTrack.nextBeatTime + timeToNextMainBeat;
                // Align bar index, wrapping if necessary
                newTrack.currentBar = referenceTrack.currentBar % newTrack.barSettings.length;
                
                // Start at the next main beat
                const currentMainBeatIndex = Math.floor(referenceTrack.currentBeat / refSubdivision);
                newTrack.currentBeat = currentMainBeatIndex + 1;
                
                // Handle bar wrapping logic (if the NEXT beat pushes us to next bar)
                const myBeatsPerBar = newTrack.barSettings[newTrack.currentBar].beats;
                if (newTrack.currentBeat >= myBeatsPerBar) { 
                    newTrack.currentBeat = 0;
                    newTrack.currentBar++; 
                    if (newTrack.currentBar >= newTrack.barSettings.length) {
                        newTrack.currentBar = 0;
                    }
                }
            }
        }
      } else if (isPlaying) {
        newTrack.nextBeatTime = audioContext.currentTime + publicAPI.SCHEDULE_AHEAD_TIME;
      }
      Tracks.push(newTrack);
      publicAPI.setSelectedTrackIndex(Tracks.length - 1);
      publicAPI.setSelectedBarIndexInContainer(0);
      publicAPI.setControlsAttachedToTrack(true);
      saveState();
    },
    removeTrack: (indexToRemove) => {
        if (Tracks.length <= 1) {
            // If it's the last track, just clear its bars instead of removing it.
            Tracks[0].barSettings = [];
            publicAPI.setSelectedBarIndexInContainer(-1); // No bar is selected
            saveState();
            return;
        }

        const wasSelected = selectedTrackIndex === indexToRemove;

        // Remove the track
        Tracks.splice(indexToRemove, 1);

        if (wasSelected) {
            // The selected track was removed. Select the next closest one.
            // If the removed track was at or after the new end of the array, select the new last track.
            const newIndex = Math.min(indexToRemove, Tracks.length - 1);
            publicAPI.setSelectedTrackIndex(newIndex);

            // Select the last measure bar of the new track
            const newTrack = Tracks[newIndex];
            if (newTrack && newTrack.barSettings.length > 0) {
                publicAPI.setSelectedBarIndexInContainer(newTrack.barSettings.length - 1);
            } else {
                publicAPI.setSelectedBarIndexInContainer(-1);
            }
        } else if (selectedTrackIndex > indexToRemove) {
            // The selected track was after the removed one, so its index has shifted.
            publicAPI.setSelectedTrackIndex(selectedTrackIndex - 1);
        }
        
        publicAPI.setControlsAttachedToTrack(true); // Ensure controls re-attach
        saveState();
    },
    duplicateTrack: (index) => {
      const source = Tracks[index];
      if (!source) return -1;
      const copy = JSON.parse(JSON.stringify(source, (key, value) =>
        ["analyserNode", "mainAnalyserNode", "subdivisionAnalyserNode"].includes(key) ? undefined : value
      ));
      copy.name = `${source.name || `Track ${index + 1}`} Copy`;
      copy.currentBar = 0;
      copy.currentBeat = 0;
      copy.nextBeatTime = 0;
      copy.analyserNode = null;
      copy.mainAnalyserNode = null;
      copy.subdivisionAnalyserNode = null;
      Tracks.push(copy);
      selectedTrackIndex = Tracks.length - 1;
      selectedBarIndexInContainer = 0;
      saveState();
      return selectedTrackIndex;
    },
    duplicateBar: (trackIndex, barIndex) => {
      const track = Tracks[trackIndex];
      const bar = track?.barSettings?.[barIndex];
      if (!bar) return false;
      track.barSettings.splice(barIndex + 1, 0, JSON.parse(JSON.stringify(bar)));
      selectedTrackIndex = trackIndex;
      selectedBarIndexInContainer = barIndex + 1;
      saveState();
      return true;
    },
    resetTrack: (trackIndex, options = {}) => {
      const track = Tracks[trackIndex];
      if (!track) return false;
      const trackOptions = options.track === true ? { muted: true, solo: true, volume: true, pitchShift: true, swing: true } : (options.track || {});
      if (options.track) {
        if (trackOptions.muted) track.muted = false;
        if (trackOptions.solo) track.solo = false;
        if (trackOptions.volume) track.volume = 1;
        if (trackOptions.pitchShift) track.pitchShift = 0;
        if (trackOptions.swing) track.swing = 0;
      }
      const soundOptions = options.sounds === true ? { main: { sound: true, settings: true }, sub: { sound: true, settings: true } } : (options.sounds || {});
      if (options.sounds) {
        for (const [key, selected] of [["mainBeatSound", soundOptions.main], ["subdivisionSound", soundOptions.sub]]) {
          if (!selected || (!selected.sound && !selected.settings)) continue;
          const defaultSound = key === "mainBeatSound" ? "Synth Kick" : "Synth HiHat";
          const sound = selected.sound ? defaultSound : (track[key]?.sound || defaultSound);
          const fallback = key === "mainBeatSound" ? defaultKick : defaultHiHat;
          track[key] = { sound, settings: { ...(defaultSoundSettings[sound] || fallback) } };
        }
      }
      const structureOptions = options.structure === true ? { beats: true, bars: true, subdivision: true } : (options.structure || {});
      if (options.structure) {
        if (structureOptions.bars) track.barSettings = [{ beats: 4, subdivision: 1, rests: [], velocities: {}, beatSounds: {} }];
        else track.barSettings = track.barSettings.map(bar => ({
          ...bar,
          ...(structureOptions.beats ? { beats: 4 } : {}),
          ...(structureOptions.subdivision ? { subdivision: 1 } : {}),
        }));
      }
      const patternOptions = options.pattern === true ? { rests: true, velocities: true, beatSounds: true } : (options.pattern || {});
      if (options.pattern || options.beatSounds) {
        const beatSoundReset = options.beatSounds === true || options.beatSounds?.sounds || options.beatSounds?.settings || patternOptions.beatSounds;
        track.barSettings = track.barSettings.map(bar => ({
          ...bar,
          ...(patternOptions.rests ? { rests: [] } : {}),
          ...(patternOptions.velocities ? { velocities: {} } : {}),
          ...(beatSoundReset ? { beatSounds: {} } : {}),
        }));
      }
      saveState();
      return true;
    },
    setBeatSlices: (trackIndex, barIndex, beatIndex, count, anchorIndex = beatIndex) => {
      const bar = Tracks[trackIndex]?.barSettings?.[barIndex];
      if (!bar) return false;
      const oldSlots = getBeatSlots(bar);
      const oldRests = new Set(bar.rests || []);
      const oldVelocities = { ...(bar.velocities || {}) };
      const oldBeatSounds = { ...(bar.beatSounds || {}) };
      const oldSourceState = new Map();
      oldSlots.forEach(slot => {
        if (!oldSourceState.has(slot.sourceBeat)) oldSourceState.set(slot.sourceBeat, {
          rest: oldRests.has(slot.index), velocity: oldVelocities[slot.index], sound: oldBeatSounds[slot.index],
        });
      });
      const normalized = normalizeSliceCount(count);
      bar.beatSlices = { ...(bar.beatSlices || {}) };
      bar.beatSliceAnchors = { ...(bar.beatSliceAnchors || {}) };
      if (normalized > 1) {
        bar.beatSlices[beatIndex] = normalized;
        if (Number.isInteger(Number(anchorIndex)) && Number(anchorIndex) >= 0) bar.beatSliceAnchors[beatIndex] = Number(anchorIndex);
      } else {
        delete bar.beatSlices[beatIndex];
        delete bar.beatSliceAnchors[beatIndex];
      }
      if (Object.keys(bar.beatSlices).length === 0) delete bar.beatSlices;
      if (Object.keys(bar.beatSliceAnchors).length === 0) delete bar.beatSliceAnchors;
      const newSlots = getBeatSlots(bar);
      bar.rests = newSlots.filter(slot => oldSourceState.get(slot.sourceBeat)?.rest).map(slot => slot.index);
      bar.velocities = Object.fromEntries(newSlots.filter(slot => oldSourceState.get(slot.sourceBeat)?.velocity !== undefined).map(slot => [slot.index, oldSourceState.get(slot.sourceBeat).velocity]));
      bar.beatSounds = Object.fromEntries(newSlots.filter(slot => oldSourceState.get(slot.sourceBeat)?.sound !== undefined).map(slot => [slot.index, oldSourceState.get(slot.sourceBeat).sound]));
      saveState();
      return true;
    },
    updateTrack: (containerIndex, updatedProperties) => {
      if (Tracks[containerIndex]) {
        Object.assign(Tracks[containerIndex], updatedProperties);
        saveState();
      }
    },
    isAnyTrackSoloed: () => Tracks.some((track) => track.solo),
    toggleSolo: (trackIndex) => {
      if (Tracks[trackIndex]) {
        Tracks[trackIndex].solo = !Tracks[trackIndex].solo;
        if (Tracks[trackIndex].solo) {
          Tracks[trackIndex].muted = false;
        }
        saveState();
      }
    },
    resetPlaybackState: () => {
      Tracks.forEach((container) => {
        container.currentBar = 0;
        container.currentBeat = 0;
      });
      isPlaying = false;
      document.dispatchEvent(new CustomEvent("playbackstatechange", { detail: { playing: false } }));
    },

    // Bar Settings
    getBarSettings: (trackIndex) => {
      const targetTrackIndex =
        trackIndex !== undefined && trackIndex !== -1
          ? trackIndex
          : selectedTrackIndex;
      if (targetTrackIndex !== -1 && Tracks[targetTrackIndex]) {
        return Tracks[targetTrackIndex].barSettings;
      }
      return [];
    },
    getSelectedTrackIndex: () => selectedTrackIndex,
    setSelectedTrackIndex: (index) => {
        selectedTrackIndex = index;
    },
    getSelectedBarIndexInContainer: () => selectedBarIndexInContainer,
    setSelectedBarIndexInContainer: (index) => {
        selectedBarIndexInContainer = index;
    },
    updateBarArray: (
      newTotalBars,
      defaultBeatsPerNewBar = 4,
      defaultSubdivisionPerNewBar = 1
    ) => {
      const currentContainer = Tracks[selectedTrackIndex];
      if (!currentContainer) return;

      const previousNumberOfBars = currentContainer.barSettings.length;
      newTotalBars = parseInt(newTotalBars, 10);

      if (newTotalBars > previousNumberOfBars) {
        for (let i = previousNumberOfBars; i < newTotalBars; i++) {
          const beats =
            currentContainer.barSettings.length > 0
              ? currentContainer.barSettings[
                  currentContainer.barSettings.length - 1
                ].beats
              : defaultBeatsPerNewBar;
          const subdivision =
            currentContainer.barSettings.length > 0
              ? currentContainer.barSettings[
                  currentContainer.barSettings.length - 1
                ].subdivision
              : defaultSubdivisionPerNewBar;
          currentContainer.barSettings.push({
            beats: beats,
            subdivision: subdivision,
            rests: [],
          });
        }
      } else if (newTotalBars < previousNumberOfBars) {
        currentContainer.barSettings.length = newTotalBars;
        if (isPlaying && currentContainer.currentBar >= newTotalBars) {
            // Align to reference track instead of hard reset
            const referenceTrack = Tracks.find(t => t !== currentContainer && t.barSettings && t.barSettings.length > 0) || Tracks[0];
            
            if (referenceTrack && referenceTrack !== currentContainer && referenceTrack.barSettings.length > 0) {
                 // Sync to reference
                 currentContainer.nextBeatTime = referenceTrack.nextBeatTime;
                 currentContainer.currentBar = 0;
                 currentContainer.currentBeat = 0; 
            } else {
                 // No reference, wrap to start
                 currentContainer.currentBar = 0;
                 currentContainer.currentBeat = 0;
            }
        }
      }

      if (newTotalBars === 0 && selectedBarIndexInContainer !== -1) {
          publicAPI.setSelectedBarIndexInContainer(-1);
      }

      saveState();
    },

    getTotalBeats: () => {
      const selectedTrack = Tracks[selectedTrackIndex];
      if (!selectedTrack || !selectedTrack.barSettings) {
        return 0;
      }
      return selectedTrack.barSettings.reduce(
        (total, bar) => total + parseInt(bar.beats, 10),
        0
      );
    },
    getBeatsForSelectedBar: () => {
      const currentContainer = Tracks[selectedTrackIndex];
      if (
        currentContainer &&
        selectedBarIndexInContainer !== -1 &&
        currentContainer.barSettings[selectedBarIndexInContainer]
      ) {
        return currentContainer.barSettings[selectedBarIndexInContainer].beats;
      }
      return null;
    },
    increaseBeatsForSelectedBar: () => {
      const currentContainer = Tracks[selectedTrackIndex];
      if (
        currentContainer &&
        selectedBarIndexInContainer !== -1 &&
        currentContainer.barSettings[selectedBarIndexInContainer]
      ) {
        currentContainer.barSettings[selectedBarIndexInContainer].beats++;
        saveState();
      }
    },
    decreaseBeatsForSelectedBar: () => {
      const currentContainer = Tracks[selectedTrackIndex];
      if (
        currentContainer &&
        selectedBarIndexInContainer !== -1 &&
        currentContainer.barSettings[selectedBarIndexInContainer]
      ) {
        if (
          currentContainer.barSettings[selectedBarIndexInContainer].beats > 1
        ) {
          currentContainer.barSettings[selectedBarIndexInContainer].beats--;
          
          // Handle case where currentBeat is now out of bounds
          if (isPlaying && currentContainer.currentBar === selectedBarIndexInContainer) {
              const barData = currentContainer.barSettings[selectedBarIndexInContainer];
              const totalSubBeats = barData.beats * barData.subdivision;
              if (currentContainer.currentBeat >= totalSubBeats) {
                  // Wrap to next bar immediately
                  currentContainer.currentBeat = 0;
                  currentContainer.currentBar++;
                  if (currentContainer.currentBar >= currentContainer.barSettings.length) {
                      currentContainer.currentBar = 0;
                  }
              }
          }
          saveState();
        }
      }
    },
    getSubdivisionForSelectedBar: () => {
      const currentContainer = Tracks[selectedTrackIndex];
      if (
        currentContainer &&
        selectedBarIndexInContainer !== -1 &&
        currentContainer.barSettings[selectedBarIndexInContainer]
      ) {
        return currentContainer.barSettings[selectedBarIndexInContainer]
          .subdivision;
      }
      return 1;
    },
    getSubdivisionForBar: (trackIndex, barIndex) => {
      const track = Tracks[trackIndex];
      if (track && track.barSettings && track.barSettings[barIndex]) {
        return track.barSettings[barIndex].subdivision;
      }
      return 1;
    },
    setSubdivisionForSelectedBar: (multiplier) => {
      const currentContainer = Tracks[selectedTrackIndex];
      if (currentContainer && selectedBarIndexInContainer !== -1) {
        
        const oldSubdivision = currentContainer.barSettings[selectedBarIndexInContainer].subdivision;
        const newSubdivision = parseFloat(multiplier) || 1;

        if (isPlaying && currentContainer.currentBar === selectedBarIndexInContainer) {
             const secondsPerMainBeat = 60.0 / tempo;
             const phase = currentContainer.currentBeat / oldSubdivision;
             
             // Calculate the next beat index in the new subdivision that is >= current phase
             const newBeatIndex = Math.ceil(phase * newSubdivision);
             
             // Check for wrap around (end of main beat)
             if (newBeatIndex >= newSubdivision) {
                 const timeDelay = (1.0 - phase) * secondsPerMainBeat;
                 currentContainer.nextBeatTime += timeDelay;
                 currentContainer.currentBeat = 0;
                 
                 currentContainer.currentBar++;
                 if (currentContainer.currentBar >= currentContainer.barSettings.length) {
                     currentContainer.currentBar = 0;
                 }
             } else {
                 const newPhase = newBeatIndex / newSubdivision;
                 const timeDelay = (newPhase - phase) * secondsPerMainBeat;
                 
                 currentContainer.nextBeatTime += timeDelay;
                 currentContainer.currentBeat = newBeatIndex;
             }
        }

        currentContainer.barSettings[selectedBarIndexInContainer].subdivision = newSubdivision;
        saveState();
      }
    },

    // AudioContext and Buffers
    getAnalyserNodes: () => Tracks.map((track) => track.analyserNode), 

    initializeAudioContext: () => {
      try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        publicAPI.createTrackAnalysers();
        return audioContext;
      } catch (e) {
        console.warn("Web Audio API not supported.", e);
        return null;
      }
    },
    createTrackAnalysers: () => {
      if (!audioContext) return;
      Tracks.forEach((track) => {
        if (!track.analyserNode) {
          track.analyserNode = audioContext.createAnalyser();
          track.analyserNode.connect(audioContext.destination);
        }
        if (!track.mainAnalyserNode) {
          track.mainAnalyserNode = audioContext.createAnalyser();
          track.mainAnalyserNode.connect(track.analyserNode);
        }
        if (!track.subdivisionAnalyserNode) {
          track.subdivisionAnalyserNode = audioContext.createAnalyser();
          track.subdivisionAnalyserNode.connect(track.analyserNode);
        }
      });
    },
    getAudioContext: () => audioContext,
    loadAudioBuffers: async () => {
      if (!audioContext) return false;
      const sounds = ["Click1.mp3", "Click2.mp3", "Crank1.mp3", "Crank2.mp3"];
      for (const sound of sounds) {
        try {
          const response = await fetch(sound);
          const arrayBuffer = await response.arrayBuffer();
          soundBuffers[sound] = await audioContext.decodeAudioData(arrayBuffer);
        } catch (e) {
          console.error(`Error loading or decoding audio file ${sound}:`, e);
        }
      }
      return Object.keys(soundBuffers).length > 0;
    },
    getSoundBuffer: (sound) => soundBuffers[sound],
    getSoundBuffers: () => soundBuffers,
    setSoundBuffer: (name, buffer) => {
        soundBuffers[name] = buffer;
        saveState();
    },
    getDefaultSoundSettings: (sound) => {
      if (customSounds[sound]) {
          return customSounds[sound].settings;
      }
      return defaultSoundSettings[sound];
    },
    getBeatSound: (trackIndex, barIndex, beatIndex, soundType) => {
      const track = Tracks[trackIndex];
      const bar = track?.barSettings?.[barIndex];
      return bar?.beatSounds?.[beatIndex]?.[soundType] || track?.[soundType] || null;
    },
    setBeatSound: (trackIndex, barIndex, beatIndex, soundType, soundInfo) => {
      const track = Tracks[trackIndex];
      const bar = track?.barSettings?.[barIndex];
      if (!bar || !soundInfo?.sound) return false;
      if (!bar.beatSounds || typeof bar.beatSounds !== "object" || Array.isArray(bar.beatSounds)) {
        bar.beatSounds = {};
      }
      const beatOverrides = { ...(bar.beatSounds[beatIndex] || {}) };
      beatOverrides[soundType] = JSON.parse(JSON.stringify(soundInfo));
      bar.beatSounds[beatIndex] = beatOverrides;
      saveState();
      return true;
    },

    clearBeatSound: (trackIndex, barIndex, beatIndex, soundType) => {
      const track = Tracks[trackIndex];
      const bar = track?.barSettings?.[barIndex];
      const beatOverrides = bar?.beatSounds?.[beatIndex];
      if (!beatOverrides || typeof beatOverrides !== "object") return false;
      delete beatOverrides[soundType];
      if (Object.keys(beatOverrides).length === 0) delete bar.beatSounds[beatIndex];
      if (Object.keys(bar.beatSounds).length === 0) delete bar.beatSounds;
      saveState();
      return true;
    },

    isSoundModified: (trackIndex, soundType) => {
      const track = Tracks[trackIndex];
      if (!track) return false;

      const soundInfo = track[soundType];
      if (!soundInfo || !soundInfo.sound) return false;

      let defaultSettings = defaultSoundSettings[soundInfo.sound];
      if (customSounds[soundInfo.sound]) {
          defaultSettings = customSounds[soundInfo.sound].settings;
      }

      if (!defaultSettings) {
          // Check if it's a recorded sound
          // We need to resolve base sound for custom recording aliases
          let soundNameForBuffer = soundInfo.sound;
          const customSoundData = customSounds[soundInfo.sound];
          if (customSoundData) {
              soundNameForBuffer = customSoundData.baseSound;
          }

          const buffer = soundBuffers[soundNameForBuffer];
          if (buffer) {
              defaultSettings = {
                  trimStart: 0,
                  trimEnd: buffer.duration,
                  pitchShift: 0
              };
          }
      }

      if (!defaultSettings) return false; // No default settings to compare against

      // Deep comparison of settings
      return JSON.stringify(soundInfo.settings) !== JSON.stringify(defaultSettings);
    },

    // Presets & State
    getCurrentStateForPreset: async (excludeHeavyData = false) => {
      const serializedRecordings = {};
      if (!excludeHeavyData) {
          for (const name of recordings) {
            const buffer = soundBuffers[name];
            if (buffer) {
              try {
                const wavBuffer = await audioBufferToWav(buffer);
                serializedRecordings[name] = arrayBufferToBase64(wavBuffer);
              } catch (e) {
                console.error(`Error serializing recording ${name}:`, e);
              }
            }
          }
      }

      song = normalizeSong(song, Tracks[0]?.barSettings?.length, tempo);
      const state = {
        tempo: tempo,
        volume: volume,
        countInBars: countInBars,
        song: JSON.parse(JSON.stringify(song)),
        Tracks: JSON.parse(
          JSON.stringify(
            Tracks.map((track) => {
              const { analyserNode, mainAnalyserNode, subdivisionAnalyserNode, ...remaningTrack } = track;
              return remaningTrack;
            })
          )
        ),
        selectedTrackIndex: selectedTrackIndex,
        selectedBarIndexInContainer: selectedBarIndexInContainer,
        controlsAttachedToTrack: controlsAttachedToTrack,
        isPlaying: isPlaying,
        isRestMode: isRestMode,
        isRecording: isRecording,
        customSounds: customSounds,
        audioLatencyOffset: audioLatencyOffset,
      };

      if (!excludeHeavyData) {
          state.selectedTheme = currentTheme;
          state.recordings = recordings; // This is the array of names
          state.serializedRecordings = serializedRecordings; // This is the object with Base64 data
      }

      return state;
    },
    loadPresetData: async (data) => {
      if (!data) return;
      
      const oldTempo = tempo;
      if (data.tempo !== undefined) {
        tempo = data.tempo;
      }
      
      if (data.volume !== undefined) {
        volume = data.volume;
      }
      if (data.audioLatencyOffset !== undefined) {
        audioLatencyOffset = Math.max(-200, Math.min(500, parseInt(data.audioLatencyOffset, 10) || 0));
      }
      countInBars = Number.isInteger(data.countInBars)
        ? Math.max(0, Math.min(data.countInBars, 8))
        : 0;

      // Store current playback state if playing
      const wasPlayingBeforeLoad = isPlaying;
      const currentPlaybackState = {};
      const previousBarSettings = {}; // Store previous bar settings to detect changes
      
      if (wasPlayingBeforeLoad) {
        const currentTime = audioContext ? audioContext.currentTime : 0;
        const tempoRatio = oldTempo / tempo;

        Tracks.forEach((track, index) => {
          let adjustedNextBeatTime = track.nextBeatTime;
          
          // Apply tempo scaling to local state before restoring
          if (oldTempo !== tempo) {
              const timeRemaining = track.nextBeatTime - currentTime;
              if (timeRemaining > 0) {
                  adjustedNextBeatTime = currentTime + (timeRemaining * tempoRatio);
              }
          }

          currentPlaybackState[index] = {
            currentBar: track.currentBar,
            currentBeat: track.currentBeat,
            nextBeatTime: adjustedNextBeatTime, // Use scaled time
          };
          // Store the subdivision of the CURRENT bar for change detection
          if (track.barSettings && track.barSettings[track.currentBar]) {
              previousBarSettings[index] = track.barSettings[track.currentBar].subdivision;
          }
        });
      }

      if (Array.isArray(data.Tracks)) {
        // We capture the "Previous" Tracks count before overwriting
        const previousTrackCount = Tracks.length;
        
        Tracks = data.Tracks;
        
        Tracks.forEach((track, index) => {
          if (track.solo === undefined) track.solo = false;
          if (track.volume === undefined) track.volume = 1.0;
          if (track.barSettings) {
            track.barSettings.forEach((bar) => {
              if (bar.rests === undefined) {
                bar.rests = [];
              }
            });
          }
          track.analyserNode = null;

          if (wasPlayingBeforeLoad) {
             // Handle state restoration for existing tracks
             if (index < previousTrackCount && currentPlaybackState[index]) {
                 const oldSubdivision = previousBarSettings[index];
                 const restoredBarIndex = currentPlaybackState[index].currentBar;
                 
                 // Ensure the restored bar index is valid in the new track data
                 const targetBarIndex = (track.barSettings && restoredBarIndex < track.barSettings.length) ? restoredBarIndex : 0;
                 
                 const newSubdivision = (track.barSettings && track.barSettings[targetBarIndex]) ? track.barSettings[targetBarIndex].subdivision : 1;

                 if (oldSubdivision !== undefined && oldSubdivision !== newSubdivision) {
                     // Recalculate phase when subdivision changes to prevent drift
                     const oldState = currentPlaybackState[index];
                     const secondsPerMainBeat = 60.0 / tempo;
                     
                     const phase = oldState.currentBeat / oldSubdivision;
                     const newBeatIndex = Math.ceil(phase * newSubdivision);
                     
                     // Restore basic state first
                     track.currentBar = targetBarIndex;
                     track.nextBeatTime = oldState.nextBeatTime; 

                     // Apply phase correction
                     if (newBeatIndex >= newSubdivision) {
                         const timeDelay = (1.0 - phase) * secondsPerMainBeat;
                         track.nextBeatTime += timeDelay;
                         track.currentBeat = 0;
                         // Handle bar wrap
                         track.currentBar++;
                         if (track.currentBar >= track.barSettings.length) track.currentBar = 0;
                     } else {
                         const newPhase = newBeatIndex / newSubdivision;
                         const timeDelay = (newPhase - phase) * secondsPerMainBeat;
                         track.nextBeatTime += timeDelay;
                         track.currentBeat = newBeatIndex;
                     }
                 } else {
                     // Restore state directly if no structural changes
                     let restoredBar = currentPlaybackState[index].currentBar;
                     if (track.barSettings.length > 0) {
                        if (restoredBar >= track.barSettings.length) {
                            restoredBar = 0; 
                        }
                     } else {
                        restoredBar = 0;
                     }
                    
                    track.currentBar = restoredBar;
                    track.currentBeat = currentPlaybackState[index].currentBeat;
                    track.nextBeatTime = currentPlaybackState[index].nextBeatTime;
                 }
             } 
             // Handle new tracks by aligning them to the reference track
             else {
                 const referenceTrack = Tracks.find((t, i) => i < index && t.barSettings && t.barSettings.length > 0) || Tracks[0];
                 
                 // If reference track is also new/invalid, fallback to audioContext
                 if (!referenceTrack || !referenceTrack.barSettings || referenceTrack.barSettings.length === 0) {
                      track.nextBeatTime = (audioContext ? audioContext.currentTime : 0) + publicAPI.SCHEDULE_AHEAD_TIME;
                      track.currentBar = 0;
                      track.currentBeat = 0;
                 } else {
                     // Align to the reference track's timing
                     const refBarData = referenceTrack.barSettings[referenceTrack.currentBar];
                     const refSubdivision = refBarData ? refBarData.subdivision : 1;
                     const secondsPerMainBeat = 60.0 / tempo;
                     
                     let secondsPerRefSubBeat = (refSubdivision >= 1) ? secondsPerMainBeat / refSubdivision : secondsPerMainBeat * (1 / refSubdivision);
                     
                     const subBeatIndex = referenceTrack.currentBeat % refSubdivision;

                     if (subBeatIndex === 0) {
                        // On Main Beat
                        track.nextBeatTime = referenceTrack.nextBeatTime;
                        track.currentBar = referenceTrack.currentBar % track.barSettings.length;
                        track.currentBeat = Math.floor(referenceTrack.currentBeat / refSubdivision);
                     } else {
                        // Between Main Beats -> Align to NEXT Main Beat
                        const subBeatsRemaining = refSubdivision - subBeatIndex;
                        const timeToNextMainBeat = subBeatsRemaining * secondsPerRefSubBeat;

                        track.nextBeatTime = referenceTrack.nextBeatTime + timeToNextMainBeat;
                        track.currentBar = referenceTrack.currentBar % track.barSettings.length;
                        track.currentBeat = Math.floor(referenceTrack.currentBeat / refSubdivision) + 1;
                     }
                     
                     // Reset wrap for new track
                     // Ensure currentBar is valid before accessing
                     if (track.currentBar >= track.barSettings.length) track.currentBar = 0;

                     const myCurrentBarData = track.barSettings[track.currentBar];
                     const myBeatsPerBar = myCurrentBarData ? myCurrentBarData.beats : 4;
                     
                     if (track.currentBeat >= myBeatsPerBar) {
                         track.currentBeat = 0;
                         track.currentBar++;
                         if (track.currentBar >= track.barSettings.length) track.currentBar = 0;
                     }
                 }
             }
          }

          // Validate Sound Objects
          if (!track.mainBeatSound || !track.mainBeatSound.sound) {
             track.mainBeatSound = { sound: "Synth Kick", settings: { ...defaultKick } };
          }
          if (!track.subdivisionSound || !track.subdivisionSound.sound) {
             track.subdivisionSound = { sound: "Synth HiHat", settings: { ...defaultHiHat } };
          }
        });
        if (audioContext) publicAPI.createTrackAnalysers();
      }
      const loadedSongName = typeof data.song?.name === "string" && data.song.name.trim()
        ? data.song.name
        : (typeof data.songName === "string" ? data.songName : undefined);
      song = normalizeSong(
        { ...(data.song || {}), ...(loadedSongName ? { name: loadedSongName } : {}) },
        Tracks[0]?.barSettings?.length,
        tempo
      );
      
      if (data.selectedTheme !== undefined) {
        publicAPI.setCurrentTheme(data.selectedTheme);
      }
      
      selectedTrackIndex = data.selectedTrackIndex !== undefined ? data.selectedTrackIndex : selectedTrackIndex;
      selectedBarIndexInContainer = data.selectedBarIndexInContainer !== undefined ? data.selectedBarIndexInContainer : selectedBarIndexInContainer;
      controlsAttachedToTrack = data.controlsAttachedToTrack !== undefined ? data.controlsAttachedToTrack : controlsAttachedToTrack;
      isRestMode = data.isRestMode !== undefined ? data.isRestMode : isRestMode;
      
      if (data.customSounds) {
          customSounds = data.customSounds;
      }

      // Deserialize recordings
      if (data.serializedRecordings) {
        recordings = []; // Clear existing recordings
        for (const name in data.serializedRecordings) {
          const base64Wav = data.serializedRecordings[name];
          try {
            const wavBuffer = base64ToArrayBuffer(base64Wav);
            const audioBuffer = await wavToArrayBuffer(wavBuffer, audioContext);
            soundBuffers[name] = audioBuffer;
            recordings.push(name); // Add name back to recordings array
          } catch (e) {
            console.error(`Error deserializing recording ${name}:`, e);
          }
        }
      }

      // isPlaying is handled by webrtc.js explicitly to avoid race conditions
      // isPlaying = data.isPlaying || false;
      saveState();
      document.dispatchEvent(new CustomEvent("appstatechange"));
    },

    // Reset & Initialization
    resetState: () => {
      tempo = 120;
      volume = 1.0;
      countInBars = 0;
      song = defaultSong();
      Tracks = [
        {
          barSettings: [{ beats: 4, subdivision: 1, rests: [] }],
          muted: false,
          solo: false,
          volume: 1.0,
          currentBar: 0,
          currentBeat: 0,
          mainBeatSound: { sound: "Synth Kick", settings: { ...defaultKick } },
          subdivisionSound: {
            sound: "Synth HiHat",
            settings: { ...defaultHiHat },
          },
          nextBeatTime: 0,
          analyserNode: null,
      mainAnalyserNode: null,
      subdivisionAnalyserNode: null,
        },
      ];
      if (audioContext) {
        publicAPI.createTrackAnalysers();
      }
      selectedTrackIndex = 0;
      selectedBarIndexInContainer = 0;
      controlsAttachedToTrack = true;
      isPlaying = false;
      saveState();
    },

    // Theme
    getCurrentTheme: () => currentTheme,
    setCurrentTheme: (themeName) => {
      currentTheme = themeName;
      saveState();
    },

    // Constants
    SCHEDULE_AHEAD_TIME: SCHEDULE_AHEAD_TIME_INTERNAL,

    // Beat Rests
    toggleBeatRest: (trackIndex, barIndex, beatIndex) => {
      const track = Tracks[trackIndex];
      if (!track || !track.barSettings[barIndex]) return;

      const rests = track.barSettings[barIndex].rests;
      const restIndex = rests.indexOf(beatIndex);

      if (restIndex > -1) {
        // Beat is currently rested, so un-rest it
        rests.splice(restIndex, 1);
      } else {
        // Beat is not rested, so rest it
        rests.push(beatIndex);
        rests.sort((a, b) => a - b); // Keep rests array sorted
      }
      saveState();
    },
  };
  return publicAPI;
})();
export default AppState;