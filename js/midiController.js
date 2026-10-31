// js/midiController.js

// Optional input never owns transport state or audio unlocking.
const subscribers = new Set();
const notify = () => subscribers.forEach(listener => listener());
let accessPromise = null;
let accessStatus = 'MIDI not connected. Use touch or keyboard controls.';

let midiAccess = null;
let selectedMidiOutput = null;


const MidiController = {
  init: async () => {
    if (midiAccess) return midiAccess;
    if (accessPromise) return accessPromise;
    if (!navigator.requestMIDIAccess) {
      accessStatus = 'Web MIDI unavailable in this browser. Use touch or keyboard controls.';
      notify(); return null;
    }
    accessStatus = 'Waiting for MIDI permission…'; notify();
    accessPromise = (async () => {
      try {
        midiAccess = await navigator.requestMIDIAccess({ sysex: false });
        MidiController.updateOutputList();
        midiAccess.addEventListener('statechange', () => { MidiController.updateOutputList(); notify(); });
        accessStatus = 'MIDI available. Select an input device and enable its mappings.';
        notify(); return midiAccess;
      } catch (error) {
        accessStatus = error?.name === 'NotAllowedError'
          ? 'MIDI permission denied. Use touch or keyboard controls; retry after allowing MIDI.'
          : 'MIDI could not be opened. Use touch or keyboard controls.';
        console.warn('Web MIDI access denied or unavailable:', error);
        notify(); return null;
      } finally { accessPromise = null; }
    })();
    return accessPromise;
  },

  updateOutputList: () => {
    if (!midiAccess) return;
    const outputs = Array.from(midiAccess.outputs.values()).filter(port => port.state !== 'disconnected');
    if (!outputs.includes(selectedMidiOutput)) selectedMidiOutput = outputs[0] || null;
  },

  getInputs: () => midiAccess ? [...midiAccess.inputs.values()].filter(port => port.state !== 'disconnected') : [],
  getStatus: () => accessStatus,
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

const ACTIONS = new Set(['start', 'stop', 'toggle', 'nextSection', 'cue']);
function validMapping(mapping) {
  return mapping && ['note', 'cc'].includes(mapping.type)
    && Number.isInteger(mapping.channel) && mapping.channel >= 1 && mapping.channel <= 16
    && Number.isInteger(mapping.number) && mapping.number >= 0 && mapping.number <= 127;
}

/** Device-local input: caller supplies real actions and a live capability check. */
export function createMidiInputController(options = {}) {
  const actions = options.actions || {};
  const canControl = action => !destroyed && typeof options.canControl === 'function' && options.canControl(action) === true;
  const doc = options.document || document;
  let selectedId = '', selected = null, enabled = false, learning = null, destroyed = false, generation = 0;
  let mappings = {}, status = MidiController.getStatus();
  let observedInputs = midiAccess ? new Set(MidiController.getInputs().map(port => port.id)) : null;
  const latched = new Set();
  const key = () => `metronominal.midi.input.v1:${encodeURIComponent(selectedId)}`;
  const availableAction = action => ACTIONS.has(action) && typeof actions[action] === 'function';
  function feedback(kind) {
    // Decoration is optional and must never change MIDI semantics or expose device data.
    if (!destroyed) { try { options.onFeedback?.(kind); } catch {} }
  }
  function update(message = status) {
    status = message; options.onStatus?.(status); options.onChange?.(getState());
  }
  function getState() {
    return { enabled, selectedId, learning, status, mappings: structuredClone(mappings), inputs: MidiController.getInputs().map(port => ({id:port.id,name:port.name || 'Unnamed MIDI input'})) };
  }
  function detach() {
    selected?.removeEventListener('midimessage', message);
    selected = null; latched.clear(); learning = null;
  }
  function loadMappings() {
    mappings = {};
    if (!selectedId) return;
    try {
      const saved = JSON.parse(localStorage.getItem(key()) || '{}');
      for (const [action, mapping] of Object.entries(saved)) if (availableAction(action) && validMapping(mapping)) mappings[action] = {type:mapping.type,channel:mapping.channel,number:mapping.number};
    } catch { update('MIDI mappings could not be read. Configure this device again.'); }
  }
  function setMapping(action, mapping, learned = false) {
    if (destroyed || !selectedId || !availableAction(action) || (mapping !== null && !validMapping(mapping))) { feedback('refuse'); return false; }
    const fingerprint = () => JSON.stringify(Object.entries(mappings).sort(([a], [b]) => a.localeCompare(b)));
    const before = fingerprint();
    // One physical control has one action: never toggle twice from one press.
    if (mapping) {
      for (const [other, existing] of Object.entries(mappings)) if (existing.type === mapping.type && existing.channel === mapping.channel && existing.number === mapping.number) delete mappings[other];
      mappings[action] = {type:mapping.type,channel:mapping.channel,number:mapping.number};
    } else delete mappings[action];
    latched.clear();
    try { localStorage.setItem(key(), JSON.stringify(mappings)); }
    catch {
      update('MIDI mapping works for this session only: device storage unavailable.');
      if (before !== fingerprint()) feedback(learned ? 'learn' : 'adjust');
      return true;
    }
    update('Mapping saved on this device only.');
    if (before !== fingerprint()) feedback(learned ? 'learn' : mapping ? 'save' : 'remove');
    return true;
  }
  function message(event) {
    if (!enabled || destroyed || event.currentTarget !== selected || selected?.state === 'disconnected') return;
    const data = event.data;
    if (!data || data.length !== 3 || !Number.isInteger(data[0]) || data[0] < 0x80 || data[0] >= 0xf0 || data[1] > 127 || data[2] > 127) return;
    const kind = data[0] & 0xf0, channel = (data[0] & 15) + 1;
    const type = kind === 0x90 || kind === 0x80 ? 'note' : kind === 0xb0 ? 'cc' : null;
    if (!type) return;
    const number = data[1], down = type === 'note' ? kind === 0x90 && data[2] > 0 : data[2] >= 64;
    const control = `${type}:${channel}:${number}`;
    if (!down) { latched.delete(control); return; } // note-off / velocity zero never act
    if (latched.has(control)) return;
    latched.add(control);
    if (learning) {
      const action = learning;
      if (!canControl(action)) { update('MIDI action unavailable for the current role.'); feedback('refuse'); return; }
      learning = null; setMapping(action, {type,channel,number}, true); latched.add(control); return;
    }
    for (const [action, mapping] of Object.entries(mappings)) {
      if (mapping.type !== type || mapping.channel !== channel || mapping.number !== number) continue;
      if (!availableAction(action) || !canControl(action)) { update('MIDI action unavailable for the current role or capability. Use the on-screen controls.'); feedback('refuse'); return; }
      try {
        const result = actions[action]();
        if (result?.catch) result.catch(() => { if (!destroyed) update('MIDI action failed. Use the on-screen controls.'); });
      } catch { update('MIDI action failed. Use the on-screen controls.'); }
      return;
    }
  }
  function setEnabled(value) {
    if (destroyed) return false;
    const wasEnabled = enabled;
    detach(); enabled = false;
    if (!value) { update('MIDI input disabled. Touch and keyboard controls remain available.'); if (wasEnabled) feedback('toggle'); return false; }
    const port = MidiController.getInputs().find(input => input.id === selectedId);
    if (!port || !Object.keys(actions).some(action => availableAction(action) && canControl(action))) {
      update('Select an available MIDI device with control authority before enabling input.'); feedback('refuse'); return false;
    }
    selected = port; enabled = true;
    selected.addEventListener('midimessage', message);
    update('MIDI input enabled. Hold/release edges only; touch or keyboard Play may be needed to unlock audio.'); if (!wasEnabled) feedback('toggle'); return true;
  }
  function accessChanged() {
    if (destroyed) return;
    const nextInputs = midiAccess ? new Set(MidiController.getInputs().map(port => port.id)) : null;
    const previousInputs = observedInputs;
    observedInputs = nextInputs;
    if (selected && !MidiController.getInputs().includes(selected)) {
      detach(); enabled = false; update('MIDI device disconnected. Input disabled; select a device and enable it again.');
    } else update(midiAccess ? status : MidiController.getStatus());
    if (previousInputs && nextInputs) {
      if ([...previousInputs].some(id => !nextInputs.has(id))) feedback('disconnect');
      if ([...nextInputs].some(id => !previousInputs.has(id))) feedback('connect');
    }
  }
  function cancelAuthority() {
    if (destroyed) return;
    generation++; detach(); enabled = false;
    update('Control authority changed. MIDI input disabled; enable it again when authorized.');
  }
  subscribers.add(accessChanged);
  doc.addEventListener('roomauthoritychange', cancelAuthority);
  doc.addEventListener('syncrolechange', cancelAuthority);
  doc.addEventListener('historyboundary', cancelAuthority);
  return {
    async connect() {
      if (destroyed) return false;
      const token = ++generation; const access = await MidiController.init();
      if (destroyed || token !== generation) return false;
      update(MidiController.getStatus()); feedback(access ? 'connect' : 'refuse'); return Boolean(access);
    },
    selectInput(id) {
      if (destroyed) return false;
      const before = selectedId;
      detach(); enabled = false; selectedId = String(id || ''); loadMappings();
      update(selectedId ? 'Input selected. Configure mappings, then enable MIDI input.' : 'Input cleared. MIDI input disabled.');
      const accepted = MidiController.getInputs().some(port => port.id === selectedId);
      if (!accepted && selectedId) feedback('refuse');
      else if (before !== selectedId) feedback('select');
      return accepted;
    },
    setEnabled, setMapping, getState,
    learn(action) {
      if (!enabled || !availableAction(action) || !canControl(action)) { feedback('refuse'); return false; }
      const changed = learning !== action;
      learning = action; latched.clear(); update('Learning: press one note or CC footswitch (CC threshold 64).'); if (changed) feedback('pending'); return true;
    },
    cancelLearn() { if (!destroyed) { const changed = learning !== null; learning = null; update('MIDI learning cancelled.'); if (changed) feedback('cancel'); } },
    destroy() {
      if (destroyed) return;
      destroyed = true; generation++; detach(); enabled = false;
      subscribers.delete(accessChanged);
      doc.removeEventListener('roomauthoritychange', cancelAuthority);
      doc.removeEventListener('syncrolechange', cancelAuthority);
      doc.removeEventListener('historyboundary', cancelAuthority);
    }
  };
}

export default MidiController;
