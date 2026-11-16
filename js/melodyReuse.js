import AppState from './appState.js';
import { validateMelody } from './melodySchema.js';
import { prepareEngineMelodyInstrument } from './melodyScheduler.js';
import { beginEditTransaction, commitEditTransaction, cancelEditTransaction } from './editHistory.js';

const synths = new Set(['Synth Sine', 'Synth Triangle', 'Synth Square', 'Synth Sawtooth']);
let active = null;
let unsubscribe = null;
let authorityGeneration = 0;
const fingerprint = track => JSON.stringify({ bars: track.barSettings, melody: track.melody, sound: track.mainBeatSound });
const sameGrid = (a, b) => a.length === b.length && a.every((bar, i) => bar.beats === b[i]?.beats && bar.subdivision === b[i]?.subdivision);
function instrument(track) {
  const name = track.mainBeatSound?.sound;
  if (synths.has(name)) return 'synth';
  if (typeof name === 'string' && !name.startsWith('Synth') && AppState.getSoundBuffer(name) instanceof AudioBuffer) return 'sample';
  return null;
}
function editable() {
  if (window.isHost === false) throw new Error('Only the host can apply notes.');
  if (AppState.isPlaying()) throw new Error('Stop playback before applying notes.');
}
function close() {
  const view = active;
  if (!view) return;
  active = null;
  view.modal.remove();
  if (view.opener?.isConnected) view.opener.focus();
  else document.querySelectorAll('.track')[view.sourceIndex]?.querySelector('.track-reuse-notes-btn')?.focus();
}
function element(tag, props = {}, text) {
  const el = document.createElement(tag);
  Object.assign(el, props);
  if (text !== undefined) el.textContent = text;
  return el;
}
/** Device-local chooser; only the explicit Apply action mutates musical state. */
export function openMelodyReuse(sourceIndex, { onApplied = () => {} } = {}) {
  close();
  const tracks = AppState.getTracks();
  const source = tracks[sourceIndex];
  if (!source?.melody) return false;
  let melody;
  try { editable(); melody = validateMelody(source.melody, source.barSettings); }
  catch { return false; }
  if (!melody.bars.some(bar => bar.length)) return false;
  const opener = document.activeElement;
  const sourceFingerprint = fingerprint(source);
  const generation = authorityGeneration;
  const targets = new Map();
  const modal = element('div', { id: 'melody-reuse-modal', className: 'modal melody-reuse-modal', tabIndex: -1 });
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'melody-reuse-title');
  const content = element('div', { className: 'modal-content melody-reuse-content' });
  content.append(element('h2', { id: 'melody-reuse-title' }, 'Use notes on another track'));
  content.append(element('p', {}, 'Copy this phrase’s notes to another instrument. The source stays unchanged; the destination keeps its sound and rhythm settings. Existing destination notes will be replaced.'));
  const targetLabel = element('label', { htmlFor: 'melody-reuse-target' }, 'Destination track');
  const select = element('select', { id: 'melody-reuse-target' });
  select.append(element('option', { value: '' }, 'Choose a track'));
  tracks.forEach((track, index) => {
    if (track === source) return;
    const type = instrument(track);
    const compatible = type && sameGrid(source.barSettings, track.barSettings);
    const reason = !type ? ' — choose a pitched synth or load a sample first' : !compatible ? ' — bar timing differs' : '';
    select.append(element('option', { value: String(index), disabled: !compatible }, `Track ${index + 1}: ${track.name || 'Untitled'} · ${track.mainBeatSound?.sound || 'No sound'}${reason}`));
    if (compatible) targets.set(String(index), { index, track, fingerprint: fingerprint(track), type });
  });
  content.append(targetLabel, select);
  const rootLabel = element('label', { htmlFor: 'melody-reuse-root', hidden: true }, 'Original pitch of the destination sample');
  const root = element('select', { id: 'melody-reuse-root', hidden: true });
  root.append(element('option', { value: '' }, 'Choose the sample’s root note'));
  const pitches = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  for (let midi = 0; midi <= 127; midi++) root.append(element('option', { value: String(midi) }, `${pitches[midi % 12]}${Math.floor(midi / 12) - 1} (MIDI ${midi})`));
  const status = element('p', { id: 'melody-reuse-status' }, targets.size ? 'Choose a destination, then apply. Undo is available in Edit history.' : 'Add a compatible track first, with matching bar timing and a pitched synth or loaded sample.');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const apply = element('button', { id: 'melody-reuse-apply', type: 'button', disabled: true }, 'Apply / replace destination notes');
  const dismiss = element('button', { id: 'melody-reuse-close', type: 'button' }, 'Cancel');
  const actions = element('div', { className: 'melody-reuse-actions' }); actions.append(apply, dismiss);
  content.append(rootLabel, root, status, actions); modal.append(content); document.body.append(modal);
  const view = active = { modal, opener, sourceIndex };
  select.addEventListener('change', () => {
    const target = targets.get(select.value);
    root.hidden = rootLabel.hidden = target?.type !== 'sample';
    root.value = target?.type === 'sample' && Number.isInteger(target.track.melody?.sampleRootMidi) ? String(target.track.melody.sampleRootMidi) : '';
    apply.disabled = !target;
  });
  apply.addEventListener('click', () => {
    let transaction = null;
    try {
      editable();
      if (active !== view || generation !== authorityGeneration || AppState.getTracks()[sourceIndex] !== source || fingerprint(source) !== sourceFingerprint)
        throw new Error('The source changed. Close this menu and try again.');
      const target = targets.get(select.value);
      if (!target || AppState.getTracks()[target.index] !== target.track || fingerprint(target.track) !== target.fingerprint)
        throw new Error('The destination changed. Close this menu and choose it again.');
      let candidate = structuredClone(melody);
      // A sample root is the destination instrument’s property, not the source’s.
      delete candidate.sampleRootMidi;
      if (target.type === 'sample') {
        if (root.value === '') throw new Error('Choose the original root note of the destination sample.');
        candidate.sampleRootMidi = Number(root.value);
      }
      candidate = validateMelody(candidate, target.track.barSettings, { requireSampleRoot: target.type === 'sample' });
      prepareEngineMelodyInstrument({ sound: target.track.mainBeatSound, buffer: AppState.getSoundBuffer(target.track.mainBeatSound.sound), rootMidi: candidate.sampleRootMidi });
      transaction = beginEditTransaction('Apply recorded notes to another track');
      if (!transaction) throw new Error('Edit history is busy or not ready. Nothing was changed.');
      AppState.updateTrack(target.index, { melody: candidate });
      commitEditTransaction(transaction); transaction = null;
      close();
      // Musical mutation has committed. A presentation callback must not relabel it as a refusal.
      try { onApplied({ sourceIndex, targetIndex: target.index }); }
      catch (error) { console.warn('Notes applied; track presentation refresh failed.', error); }
    } catch (error) {
      if (transaction) cancelEditTransaction(transaction);
      status.textContent = error.message || 'Notes could not be applied.';
    }
  });
  dismiss.addEventListener('click', close);
  modal.addEventListener('click', event => { if (event.target === modal) close(); });
  modal.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === 'Tab') {
      const controls = [...modal.querySelectorAll('button,select')].filter(el => !el.hidden && !el.disabled);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  select.focus();
  return true;
}
export function initializeMelodyReuse({ onApplied = () => {} } = {}) {
  unsubscribe?.(); close();
  const launch = event => { const index = event.detail?.trackIndex; if (Number.isInteger(index)) openMelodyReuse(index, { onApplied }); };
  const invalidate = () => { authorityGeneration++; close(); };
  const events = ['roomauthoritychange', 'syncrolechange', 'appstatechange', 'playbackstatechange', 'historyboundary'];
  document.addEventListener('melodyreuse', launch);
  for (const name of events) document.addEventListener(name, invalidate);
  window.addEventListener('pagehide', invalidate);
  unsubscribe = () => {
    document.removeEventListener('melodyreuse', launch);
    for (const name of events) document.removeEventListener(name, invalidate);
    window.removeEventListener('pagehide', invalidate);
    close(); unsubscribe = null;
  };
  return { destroy: unsubscribe };
}
