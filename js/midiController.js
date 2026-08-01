// js/midiController.js

import AppState from "./appState.js";

let midiAccess = null;
let selectedMidiOutput = null;
let clockTimer = null;

const MidiController = {
  init: async () => {
    if (navigator.requestMIDIAccess) {
      try {
        midiAccess = await navigator.requestMIDIAccess({ sysex: false });
        MidiController.updateOutputList();
        midiAccess.onstatechange = () => MidiController.updateOutputList();
      } catch (err) {
        console.warn("Web MIDI access denied or unavailable:", err);
      }
    } else {
      console.log("Web MIDI API is not supported in this browser.");
    }
  },

  updateOutputList: () => {
    if (!midiAccess) return;
    const outputs = Array.from(midiAccess.outputs.values());
    if (outputs.length > 0 && !selectedMidiOutput) {
      selectedMidiOutput = outputs[0];
    }
  },

  getOutputs: () => {
    if (!midiAccess) return [];
    return Array.from(midiAccess.outputs.values());
  },

  selectOutput: (id) => {
    if (!midiAccess) return;
    const outputs = Array.from(midiAccess.outputs.values());
    selectedMidiOutput = outputs.find(out => out.id === id) || null;
  },

  sendMidiStart: () => {
    if (selectedMidiOutput) {
      try {
        selectedMidiOutput.send([0xFA]); // MIDI Start
      } catch (e) {
        console.warn("Failed to send MIDI Start:", e);
      }
    }
  },

  sendMidiStop: () => {
    if (selectedMidiOutput) {
      try {
        selectedMidiOutput.send([0xFC]); // MIDI Stop
      } catch (e) {
        console.warn("Failed to send MIDI Stop:", e);
      }
    }
  },

  sendMidiClock: () => {
    if (selectedMidiOutput) {
      try {
        selectedMidiOutput.send([0xF8]); // MIDI Clock Tick
      } catch (e) {
        console.warn("Failed to send MIDI Clock:", e);
      }
    }
  }
};

export default MidiController;
