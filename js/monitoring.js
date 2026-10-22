// Device-local preferences. Never import this state into a room snapshot or preset.
const STORAGE_KEY = 'metronominal.monitoring';
let volume = 1;
let muted = false;
const outputs = new Map();
const trackOutputs = new Map();
let tracks = [];

function level(value, fallback) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback;
}
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  if (saved?.version === 1) {
    volume = level(saved.volume, 1);
    muted = saved.muted === true;
  }
} catch (_) { /* Storage can be unavailable; listening controls still work. */ }

function changed() {
  for (const [context, output] of outputs) {
    output.gain.setTargetAtTime(muted ? 0 : volume, context.currentTime, 0.005);
    for (const [index, node] of trackOutputs.get(context)) {
      if (!tracks[index]) {
        node.disconnect();
        trackOutputs.get(context).delete(index);
      } else {
        node.gain.setTargetAtTime(tracks[index].muted ? 0 : tracks[index].volume, context.currentTime, 0.005);
      }
    }
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, volume, muted })); }
  catch (_) { /* Keep the in-memory mix when storage is blocked. */ }
  document.dispatchEvent(new CustomEvent('monitoringchange'));
}

const Monitoring = {
  getState: () => ({ volume, muted, tracks: tracks.map(track => ({ ...track })) }),
  syncTracks(nextTracks) {
    const labels = nextTracks.map((track, index) => {
      const position = `Track ${index + 1}`;
      return track.name && track.name !== position ? `${position} · ${track.name}` : position;
    });
    if (JSON.stringify(labels) === JSON.stringify(tracks.map(track => track.label))) return;
    // Tracks have no durable IDs: never transfer a muted slot to a different layout.
    tracks = labels.map(label => ({ label, volume: 1, muted: false }));
    changed();
  },
  resetTracks() {
    tracks = tracks.map(track => ({ ...track, volume: 1, muted: false }));
    changed();
  },
  setTrackVolume(index, value) {
    if (!Number.isInteger(index) || !tracks[index]) return;
    tracks[index].volume = level(value, tracks[index].volume);
    changed();
  },
  setTrackMuted(index, value) {
    if (!Number.isInteger(index) || !tracks[index]) return;
    tracks[index].muted = value === true;
    changed();
  },
  getOutput(context) {
    if (!outputs.has(context)) {
      const output = context.createGain();
      output.gain.value = muted ? 0 : volume;
      output.connect(context.destination);
      outputs.set(context, output);
      trackOutputs.set(context, new Map());
      context.addEventListener('statechange', () => {
        if (context.state === 'closed') {
          output.disconnect();
          for (const node of trackOutputs.get(context).values()) node.disconnect();
          trackOutputs.delete(context);
          outputs.delete(context);
        }
      });
    }
    return outputs.get(context);
  },
  getTrackOutput(context, index) {
    const output = Monitoring.getOutput(context);
    if (!Number.isInteger(index) || !tracks[index]) return output;
    const nodes = trackOutputs.get(context);
    if (!nodes.has(index)) {
      const node = context.createGain();
      node.gain.value = tracks[index].muted ? 0 : tracks[index].volume;
      node.connect(output);
      nodes.set(index, node);
    }
    return nodes.get(index);
  },
  setVolume(value) {
    volume = level(value, volume);
    changed();
  },
  setMuted(value) {
    muted = value === true;
    changed();
  },
  reset() {
    volume = 1;
    muted = false;
    tracks = tracks.map(track => ({ ...track, volume: 1, muted: false }));
    changed();
  },
};
export default Monitoring;
