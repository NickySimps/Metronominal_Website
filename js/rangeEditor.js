import AppState from './appState.js';
import { beginEditTransaction, commitEditTransaction, cancelEditTransaction } from './editHistory.js';
import { getVisualBeatSlots, getBeatSlots } from './beatTiming.js';
import { normalizeFilterSettings, normalizeEffectSettings } from './audioEffects.js';
import { emitInteractionMotion } from './interactionMotion.js';
import { sendState } from './webrtc.js';

const SOUND_NUMBERS = new Set('volume startFrequency endFrequency attack decay sustain release pitchEnvelopeTime pitchShift bodyFrequencyStart bodyFrequencyEnd noiseFilterFrequency filterFrequency frequency frequency1 frequency2 qValue detune trimStart trimEnd highPassFrequency lowPassFrequency distortion delayMix delayTime delayFeedback reverbMix reverbFeedback probability'.split(' '));
const SOUND_FLAGS = new Set(['reverse', 'allowOverlap', 'retrigger', 'fxBypass']);
function safeOverrides(overrides) {
  const result = {};
  const privateNames = new Set(AppState.getRecordings());
  for (let pass = 0; pass < AppState.getCustomSounds().length + 1; pass++) for (const name of AppState.getCustomSounds()) if (privateNames.has(AppState.getCustomSoundData(name)?.baseSound)) privateNames.add(name);
  for (const role of ['mainBeatSound', 'subdivisionSound']) {
    const sound = overrides?.[role];
    if (!sound || typeof sound.sound !== 'string') continue;
    const settings = {};
    for (const [key, value] of Object.entries(sound.settings || {})) {
      if (SOUND_NUMBERS.has(key) && typeof value === 'number' && Number.isFinite(value)) settings[key] = Math.max(-100000, Math.min(100000, value));
      if (SOUND_FLAGS.has(key) && typeof value === 'boolean') settings[key] = value;
      if (key === 'type' && ['sine', 'square', 'sawtooth', 'triangle'].includes(value)) settings[key] = value;
    }
    normalizeFilterSettings(settings); normalizeEffectSettings(settings);
    if ('volume' in settings) settings.volume = Math.max(0, Math.min(1, settings.volume));
    if ('probability' in settings) settings.probability = Math.max(0, Math.min(100, settings.probability));
    result[role] = { sound: privateNames.has(sound.sound) ? role === 'mainBeatSound' ? 'Synth Kick' : 'Synth HiHat' : sound.sound.slice(0, 64), settings };
  }
  return result;
}
function readCells(bar, sanitize = false) {
  // The persisted override maps and ordinary beat actions are keyed by visible
  // logical beat, not expanded playback index. The schema has no child map.
  const rests = new Set(bar.rests || []);
  return getVisualBeatSlots(bar).map(base => ({
    count: Number(bar.beatSlices?.[base.index]) || 1,
    anchor: Number.isInteger(bar.beatSliceAnchors?.[base.index]) ? bar.beatSliceAnchors[base.index] - base.index : null,
    rest: rests.has(base.index), velocity: bar.velocities?.[base.index],
    sound: sanitize ? safeOverrides(bar.beatSounds?.[base.index]) : bar.beatSounds?.[base.index],
  }));
}
function writeCells(bar, cells) {
  if (cells.reduce((total, cell) => total + cell.count, 0) > 512) throw new Error('A bar may contain at most 512 playback slots; reduce the slice count or selection');
  const result = { ...bar, rests: [], velocities: {}, beatSounds: {}, beatSlices: {}, beatSliceAnchors: {} };
  cells.forEach((cell, base) => {
    if (cell.count > 1) {
      result.beatSlices[base] = cell.count;
      if (cell.anchor !== null) result.beatSliceAnchors[base] = integer(base + cell.anchor, 0, cells.length - 1, 'Slice anchor');
    }
    if (cell.rest) result.rests.push(base);
    if (cell.velocity !== undefined) result.velocities[base] = cell.velocity;
    if (cell.sound && Object.keys(cell.sound).length) result.beatSounds[base] = cell.sound;
  });
  for (const key of ['beatSlices', 'beatSliceAnchors']) if (!Object.keys(result[key]).length) delete result[key];
  return result;
}
function copySelection(tracks, range) {
  const bars = tracks[range.track].barSettings;
  return { mode: range.mode, cells: range.cells.map(cell => readCells(bars[cell.bar], true)[cell.beat]),
    bars: range.mode === 'bars' ? bars.slice(range.startBar, range.endBar + 1).map(bar => writeCells({ beats: bar.beats, subdivision: bar.subdivision }, readCells(bar, true))) : null };
}
function pasteSelection(tracks, clipboard, destination) {
  if (!clipboard) throw new Error('Copy a range first');
  const track = integer(destination.track, 0, tracks.length - 1, 'Destination track');
  const bars = [...tracks[track].barSettings];
  const startBar = integer(destination.bar, 0, bars.length - 1, 'Destination bar');
  if (clipboard.mode === 'bars') {
    if (startBar + clipboard.bars.length > bars.length) throw new Error('Destination has too few bars; nothing was truncated');
    clipboard.bars.forEach((bar, index) => { bars[startBar + index] = structuredClone(bar); });
  } else {
    const startBeat = integer(destination.beat, 0, getVisualBeatSlots(bars[startBar]).length - 1, 'Destination beat');
    let offset = 0;
    for (let b = startBar; b < bars.length && offset < clipboard.cells.length; b++) {
      const cells = readCells(bars[b]);
      for (let i = b === startBar ? startBeat : 0; i < cells.length && offset < clipboard.cells.length; i++) cells[i] = structuredClone(clipboard.cells[offset++]);
      bars[b] = writeCells(bars[b], cells);
    }
    if (offset !== clipboard.cells.length) throw new Error('Destination has too few beats; nothing was truncated');
  }
  return { track, bars, count: clipboard.cells.length };
}

function transformSelection(tracks, range, operation, sliceCount, rotation) {
  const bars = [...tracks[range.track].barSettings];
  const groups = new Map([...new Set(range.cells.map(cell => cell.bar))].map(b => [b, readCells(bars[b])]));
  const source = range.cells.map(cell => groups.get(cell.bar)[cell.beat]);
  if (operation === 'rotate') {
    const shift = ((integer(rotation, -4096, 4096, 'Rotation') % source.length) + source.length) % source.length;
    range.cells.forEach((cell, index) => { groups.get(cell.bar)[cell.beat] = source[(index - shift + source.length) % source.length]; });
  } else {
    for (const cell of source) {
      if (operation === 'fill-rests' || operation === 'clear-rests') cell.rest = operation === 'fill-rests';
      else if (operation === 'fill-accents' || operation === 'clear-accents') cell.velocity = operation === 'fill-accents' ? 1 : undefined;
      else if (operation === 'fill-slices' || operation === 'clear-slices') {
        const count = operation === 'clear-slices' ? 1 : integer(sliceCount, 2, 32, 'Slice count');
        if (![1, 2, 3, 4, 6, 8, 16, 32].includes(count)) throw new Error('Unsupported slice count');
        cell.count = count; cell.anchor = count > 1 ? 0 : null;
      } else throw new Error('Unknown range operation');
    }
  }
  for (const [b, cells] of groups) bars[b] = writeCells(bars[b], cells);
  return { track: range.track, bars, count: range.cells.length };
}

const mounts = new WeakMap();
const integer = (value, min, max, label) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} must be ${min}–${max}`);
  return n;
};

/** Inclusive, zero-based endpoints; beats mean visible logical slots, not slice children. */
export function resolveRange(tracks, selection) {
  const track = integer(selection.track, 0, tracks.length - 1, 'Track');
  const bars = tracks[track].barSettings;
  const startBar = integer(selection.startBar, 0, bars.length - 1, 'Start bar');
  const endBar = integer(selection.endBar, startBar, bars.length - 1, 'End bar');
  const mode = selection.mode === 'bars' ? 'bars' : 'beats';
  const startBeat = mode === 'bars' ? 0 : integer(selection.startBeat, 0, getVisualBeatSlots(bars[startBar]).length - 1, 'Start beat');
  const endBeat = mode === 'bars' ? getVisualBeatSlots(bars[endBar]).length - 1 : integer(selection.endBeat, 0, getVisualBeatSlots(bars[endBar]).length - 1, 'End beat');
  if (startBar === endBar && endBeat < startBeat) throw new Error('End must follow start');
  const cells = [];
  for (let b = startBar; b <= endBar; b++) {
    const size = getVisualBeatSlots(bars[b]).length;
    for (let i = b === startBar ? startBeat : 0; i <= (b === endBar ? endBeat : size - 1); i++) cells.push({ bar: b, beat: i });
  }
  return { track, startBar, endBar, startBeat, endBeat, mode, cells };
}

export function initializeRangeEditor(root, options = {}) {
  if (!root?.append) throw new TypeError('Range editor needs a DOM root');
  if (mounts.has(root)) return mounts.get(root);
  const doc = root.ownerDocument, interactionRoot = doc.getElementById('all-tracks-wrapper');
  const panel = doc.createElement('section'); panel.className = 'range-editor'; panel.setAttribute('aria-label', 'Range beat and bar editor');
  panel.innerHTML = `<h3>Range editor</h3><p>Device-local selection · Preview first, then Apply. Beats include all their slices.</p>
  <div class="range-editor-grid">
    <fieldset><legend>Source range</legend><label>Range unit<select data-field="mode" aria-label="Range unit"><option value="beats">Beats</option><option value="bars">Bars</option></select></label>
      <label>Source track<input data-field="track" aria-label="Source track" type="number" min="1" value="1"></label>
      <label>Start bar<input data-field="startBar" aria-label="Start bar" type="number" min="1" value="1"></label>
      <label>Start beat<input data-field="startBeat" aria-label="Start beat" type="number" min="1" value="1"></label>
      <label>End bar<input data-field="endBar" aria-label="End bar" type="number" min="1" value="1"></label>
      <label>End beat<input data-field="endBeat" aria-label="End beat" type="number" min="1" value="1"></label>
      <button type="button" data-action="pick" aria-pressed="false">Pick range on beats</button><button type="button" data-action="stop-pick">Stop picking</button>
    </fieldset>
    <fieldset><legend>Operation</legend><label>Operation<select data-field="operation" aria-label="Operation"><option value="fill-rests">Fill rests</option><option value="clear-rests">Clear rests</option><option value="fill-accents">Fill accents</option><option value="clear-accents">Clear accents</option><option value="fill-slices">Fill slices</option><option value="clear-slices">Clear slices</option><option value="rotate">Rotate cyclically</option><option value="paste">Paste copied range</option></select></label><label>Slice count<select data-field="sliceCount" aria-label="Slice count"><option>2</option><option>3</option><option>4</option><option>6</option><option>8</option><option>16</option><option>32</option></select></label><label>Rotation steps<input data-field="rotation" aria-label="Rotation steps" type="number" min="-4096" max="4096" value="1"></label><button type="button" data-action="copy">Copy range</button><label>Destination track<input data-field="destinationTrack" aria-label="Destination track" type="number" min="1" value="1"></label><label>Destination bar<input data-field="destinationBar" aria-label="Destination bar" type="number" min="1" value="1"></label><label>Destination beat<input data-field="destinationBeat" aria-label="Destination beat" type="number" min="1" value="1"></label></fieldset>
    <fieldset><legend>Preview and apply</legend><button type="button" data-action="preview">Preview range</button><button type="button" data-action="apply" disabled>Apply range</button><button type="button" data-action="cancel">Cancel preview</button><output data-range-preview hidden></output></fieldset>
  </div><p role="status" aria-live="polite" data-range-status></p>`;
  root.append(panel);
  const field = name => panel.querySelector(`[data-field="${name}"]`);
  const button = name => panel.querySelector(`[data-action="${name}"]`);
  const status = panel.querySelector('[data-range-status]'), output = panel.querySelector('[data-range-preview]');
  let generation = 0, pending = null, clipboard = null, picking = null, applying = false, destroyed = false;
  let suppressClick = null, touchPick = null;
  let role = { state: doc.querySelector('#share-btn.connected') ? 'connected' : 'solo', isHost: window.isHost === true };
  const allowed = () => !destroyed && root.isConnected && !AppState.isPlaying() && (role.state === 'solo' || role.isHost) && (!doc.querySelector('#share-btn.connected') || window.isHost === true);
  const listeners = [];
  function on(target, type, handler, opts) { target?.addEventListener(type, handler, opts); listeners.push(() => target?.removeEventListener(type, handler, opts)); }
  function message(text) { status.textContent = text; }
  function invalidate(text = '') { generation++; pending = null; output.hidden = true; button('apply').disabled = true; if (text) message(text); }
  function stopPicking() { picking = null; touchPick = null; if (interactionRoot) delete interactionRoot.dataset.rangeSelection; button('pick').setAttribute('aria-pressed', 'false'); }
  function highlight() {
    interactionRoot?.querySelectorAll('[data-range-source]').forEach(el => el.removeAttribute('data-range-source'));
    if (!allowed()) return;
    try {
      const range = resolveRange(AppState.getTracks(), readSelection());
      for (const cell of range.cells) interactionRoot?.querySelector(`.bar-visual[data-container-index="${range.track}"][data-bar-index="${cell.bar}"] .beat-square[data-beat-index="${cell.beat}"]`)?.setAttribute('data-range-source', '');
    } catch { /* Incomplete endpoint input has no visible selection. */ }
  }
  function bounds() {
    const tracks = AppState.getTracks();
    field('track').max = tracks.length;
    const bars = tracks[Number(field('track').value) - 1]?.barSettings || [];
    field('startBar').max = field('endBar').max = bars.length;
    for (const side of ['start', 'end']) {
      const bar = bars[Number(field(`${side}Bar`).value) - 1];
      field(`${side}Beat`).max = bar ? getVisualBeatSlots(bar).length : 1;
      field(`${side}Beat`).disabled = field('mode').value === 'bars';
    }
    field('destinationTrack').max = tracks.length;
    const destinationBars = tracks[Number(field('destinationTrack').value) - 1]?.barSettings || [];
    field('destinationBar').max = destinationBars.length;
    field('destinationBeat').max = getVisualBeatSlots(destinationBars[Number(field('destinationBar').value) - 1] || { beats: 1 }).length;
    for (const name of ['preview', 'copy', 'pick']) button(name).disabled = !allowed();
    if (!allowed()) { stopPicking(); button('apply').disabled = true; message(AppState.isPlaying() ? 'Stop playback to edit ranges' : 'Only the host can edit ranges'); }
    highlight();
  }
  const renderedTopology = () => [...(interactionRoot?.querySelectorAll('.bar-visual,.beat-square') || [])].map(node => ({ node, indices: ['data-container-index', 'data-bar-index', 'data-beat-index'].map(key => node.getAttribute(key)).join(':') }));
  function readSelection() { return { mode: field('mode').value, ...Object.fromEntries(['track', 'startBar', 'endBar', 'startBeat', 'endBeat'].map(key => [key, Number(field(key).value) - 1])) }; }
  function rangeFeedback(target, kind, phase, from = null, span = null) {
    // Reuse the runtime's inert overlay, eight-effect cap and 200ms cleanup;
    // only that decorative node receives geometry/keyframes, never a hitbox.
    try {
      if (!target?.isConnected) return false;
      const rect = span || target.getBoundingClientRect();
      const width = doc.documentElement.clientWidth, height = doc.documentElement.clientHeight;
      const left = Math.max(0, rect.left), top = Math.max(0, rect.top);
      const right = Math.min(width, rect.right), bottom = Math.min(height, rect.bottom);
      if (right <= left || bottom <= top || !emitInteractionMotion(target, kind)) return false;
      const effect = doc.querySelector('[data-interaction-motion-root]')?.lastElementChild;
      if (!effect || effect.dataset.motionKind !== kind) return true;
      effect.dataset.rangeMotion = phase;
      Object.assign(effect.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px`, animation: 'none' });
      if (!doc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        let frames;
        if (phase === 'selection') frames = [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }];
        else {
          const x = from ? (from.left + from.right - left - right) / 2 : 0;
          const y = from ? (from.top + from.bottom - top - bottom) / 2 : -24;
          const scale = Math.min(1, 48 / (Math.hypot(x, y) || 1));
          const dx = Math.max(-left, Math.min(width - right, x * scale));
          const dy = Math.max(-top, Math.min(height - bottom, y * scale));
          frames = [{ transform: `translate(${dx}px, ${dy}px)`, opacity: .35 }, { transform: 'translate(0px, 0px)', opacity: 1 }];
        }
        effect.animate(frames, { duration: 180, easing: 'ease-out', fill: 'both' });
      }
      return true;
    } catch { return false; }
  }
  function selectionSweep(fallback) {
    try {
      const entries = [...(interactionRoot?.querySelectorAll('[data-range-source]') || [])].map(node => ({ node, rect: node.getBoundingClientRect() })).filter(({ rect: r }) => r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < doc.documentElement.clientWidth && r.top < doc.documentElement.clientHeight);
      if (!entries.length) return emitInteractionMotion(fallback, 'range');
      const rects = entries.map(entry => entry.rect);
      return rangeFeedback(entries[0].node, 'range', 'selection', null, { left: Math.min(...rects.map(r => r.left)), top: Math.min(...rects.map(r => r.top)), right: Math.max(...rects.map(r => r.right)), bottom: Math.max(...rects.map(r => r.bottom)) });
    } catch { return false; }
  }
  function preview() {
    if (destroyed || !root.isConnected) return false;
    invalidate();
    try {
      if (!allowed()) throw new Error('Only the stopped host or solo device can edit');
      const before = JSON.stringify(AppState.getMusicalSnapshot());
      let edit;
      if (field('operation').value === 'paste') {
        edit = pasteSelection(AppState.getTracks(), clipboard, { track: Number(field('destinationTrack').value) - 1, bar: Number(field('destinationBar').value) - 1, beat: Number(field('destinationBeat').value) - 1 });
      } else {
        const range = resolveRange(AppState.getTracks(), readSelection());
        edit = transformSelection(AppState.getTracks(), range, field('operation').value, Number(field('sliceCount').value), Number(field('rotation').value));
      }
      pending = { generation, before, ...edit, dom: renderedTopology() };
      output.textContent = `${edit.count} beats · ${field('operation').selectedOptions[0].textContent} · Track ${edit.track + 1} · Preview only\n${edit.bars.map((bar, index) => `Bar ${index + 1}: ${getVisualBeatSlots(bar).length} beats / ${getBeatSlots(bar).length} slots · rests ${(bar.rests || []).map(i => i + 1).join(', ') || 'none'} · accents ${Object.values(bar.velocities || {}).filter(v => v >= 1).length} · slices ${Object.entries(bar.beatSlices || {}).map(([i, n]) => `${Number(i) + 1}×${n}`).join(', ') || 'none'}`).join('\n')}${field('operation').value === 'clear-slices' ? '\nClear slices preserves each logical beat’s rest, velocity and sound override.' : field('operation').value === 'fill-slices' ? '\nSlice count changes timing only; rest, velocity and sound overrides belong to the logical beat, not individual children.' : ''}`;
      output.hidden = false; button('apply').disabled = false; message('Review the preview, then Apply or Cancel');
      [output, button('preview'), panel].some(el => rangeFeedback(el, 'open', 'preview', button('copy').getBoundingClientRect()));
      return true;
    } catch (error) {
      message(error.message);
      [button('preview'), button('apply'), panel].some(el => emitInteractionMotion(el, 'refuse'));
      return false;
    }
  }
  function apply() {
    if (destroyed || !root.isConnected) return false;
    const edit = pending;
    const dom = renderedTopology();
    if (!edit || !allowed() || interactionRoot && !interactionRoot.isConnected || edit.generation !== generation || edit.before !== JSON.stringify(AppState.getMusicalSnapshot()) || edit.dom.length !== dom.length || edit.dom.some((entry, i) => entry.node !== dom[i].node || entry.indices !== dom[i].indices)) {
      invalidate('Preview expired; preview again');
      [button('apply'), button('preview'), panel].some(el => emitInteractionMotion(el, 'refuse'));
      return false;
    }
    const previewRect = output.getBoundingClientRect();
    const resultBar = Number(field(field('operation').value === 'paste' ? 'destinationBar' : 'startBar').value) - 1;
    const resultBeat = Number(field(field('operation').value === 'paste' ? 'destinationBeat' : 'startBeat').value) - 1;
    const token = beginEditTransaction('Range edit');
    if (!token) {
      invalidate('History unavailable or busy; retry after stopping');
      [button('apply'), button('preview'), panel].some(el => emitInteractionMotion(el, 'refuse'));
      return false;
    }
    applying = true;
    let recorded = false, completed = false;
    try {
      AppState.updateTrack(edit.track, { barSettings: edit.bars });
      recorded = commitEditTransaction(token);
      invalidate(recorded ? 'Range applied · Undo reverses the whole edit' : 'No musical change');
      options.refreshUI?.();
      if (recorded && window.isHost === true) void sendState(AppState.getCurrentStateForPreset(true));
      completed = recorded;
      return recorded;
    } catch (error) { cancelEditTransaction(token); invalidate(recorded ? `Range committed; follow-up failed: ${error.message}` : error.message); return false; }
    finally {
      applying = false; bounds();
      if (completed) {
        const result = interactionRoot?.querySelector(`.bar-visual[data-container-index="${edit.track}"][data-bar-index="${resultBar}"] .beat-square[data-beat-index="${resultBeat}"]`);
        [result, button('apply'), button('preview'), panel].some(el => rangeFeedback(el, 'confirm', 'result', previewRect));
      } else [button('apply'), button('preview'), panel].some(el => emitInteractionMotion(el, recorded ? 'adjust' : 'refuse'));
    }
  }
  on(button('pick'), 'click', () => {
    if (!allowed() || !interactionRoot?.isConnected) return;
    invalidate(); picking = { start: null }; interactionRoot.dataset.rangeSelection = field('mode').value;
    button('pick').setAttribute('aria-pressed', 'true'); message('Tap the first beat, then the last beat on the same track');
    emitInteractionMotion(button('pick'), 'open');
  });
  on(button('stop-pick'), 'click', () => {
    const wasPicking = Boolean(picking);
    stopPicking(); message('Range picking stopped');
    if (wasPicking) emitInteractionMotion(button('stop-pick'), 'cancel');
  });
  function capturePick(event) {
    if (event.type === 'pointercancel') { touchPick = null; return; }
    if (event.type === 'pointermove' && touchPick && Math.hypot(event.clientX - touchPick.x, event.clientY - touchPick.y) > 10) touchPick.moved = true;
    const beat = event.target.closest?.('.beat-square[data-beat-index]');
    if (!beat || !interactionRoot?.contains(beat)) return;
    const suppressed = suppressClick && suppressClick.beat === beat && Date.now() < suppressClick.until;
    if (!picking && !suppressed) return;
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
    // Isolate legacy painting, but leave native pre-tap pan/pinch uncancelled.
    event.stopImmediatePropagation();
    if (event.type === 'click' || event.type === 'keydown') event.preventDefault();
    if (suppressed && event.type === 'click') return;
    let touchTap = false;
    if (event.pointerType === 'touch') {
      if (event.type === 'pointerdown') {
        if (!event.isPrimary) { if (touchPick) touchPick.moved = true; return; }
        touchPick = { id: event.pointerId, beat, x: event.clientX, y: event.clientY, moved: false };
      }
      if (event.type === 'pointerup') {
        touchTap = !!touchPick && touchPick.id === event.pointerId && touchPick.beat === beat && !touchPick.moved;
        touchPick = null;
        suppressClick = { beat, until: Date.now() + 500 };
      }
    }
    if (!picking || !touchTap && !['click', 'keydown'].includes(event.type)) return;
    if (!allowed()) { stopPicking(); return; }
    const bar = beat.closest('.bar-visual');
    if (!bar) return;
    const point = { track: Number(bar.dataset.containerIndex), bar: Number(bar.dataset.barIndex), beat: Number(beat.dataset.beatIndex) };
    const tracks = AppState.getTracks();
    const targetBar = tracks[point.track]?.barSettings?.[point.bar];
    if (!targetBar || !Number.isInteger(point.beat) || point.beat < 0 || point.beat >= getVisualBeatSlots(targetBar).length) { emitInteractionMotion(beat, 'refuse'); return; }
    const first = picking.start;
    if (first && first.track !== point.track) { message('Choose the end on the source track; use destination controls for cross-track paste'); emitInteractionMotion(beat, 'refuse'); return; }
    invalidate();
    if (!first) {
      picking.start = point;
      field('track').value = point.track + 1;
      field('startBar').value = field('endBar').value = point.bar + 1;
      field('startBeat').value = field('endBeat').value = point.beat + 1;
      message('Start chosen; tap the last beat');
    } else {
      const [start, end] = [first, point].sort((a, b) => a.bar - b.bar || a.beat - b.beat);
      field('startBar').value = start.bar + 1; field('startBeat').value = start.beat + 1;
      field('endBar').value = end.bar + 1; field('endBeat').value = end.beat + 1;
      suppressClick = { beat, until: Date.now() + 500 }; stopPicking(); message('Range selected locally; choose an operation and Preview');
    }
    bounds();
    selectionSweep(beat);
  }
  // Document capture precedes the legacy target-level painting listeners.
  for (const type of ['pointerdown', 'pointerup', 'pointermove', 'pointercancel', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click', 'dblclick', 'contextmenu', 'keydown']) on(doc, type, capturePick, { capture: true, passive: false });
  on(doc, 'keydown', event => {
    if (event.key === 'Escape' && !event.defaultPrevented && (picking || pending)) {
      const wasPicking = Boolean(picking);
      stopPicking(); invalidate('Preview cancelled; music unchanged');
      [...(wasPicking ? [button('stop-pick'), button('pick')] : []), button('cancel'), button('preview'), ...panel.querySelectorAll('button, input, select'), panel].some(el => emitInteractionMotion(el, 'cancel'));
    }
  });
  on(button('copy'), 'click', () => {
    if (destroyed || !root.isConnected) return;
    invalidate();
    try {
      if (!allowed()) throw new Error('Only the stopped host or solo device can copy');
      clipboard = copySelection(AppState.getTracks(), resolveRange(AppState.getTracks(), readSelection()));
      message(`${clipboard.cells.length} beats copied locally; choose destination and Preview paste`);
      const sourceRect = interactionRoot?.querySelector('[data-range-source]')?.getBoundingClientRect();
      [button('copy'), panel].some(el => rangeFeedback(el, 'copy', 'clipboard', sourceRect));
    } catch (error) {
      clipboard = null; message(error.message);
      [button('copy'), panel].some(el => emitInteractionMotion(el, 'refuse'));
    }
  });
  function cancel() {
    if (destroyed || !root.isConnected) return;
    const hadActive = Boolean(picking || pending);
    stopPicking(); invalidate('Preview cancelled; music unchanged');
    if (hadActive) [button('cancel'), button('stop-pick'), button('preview'), ...panel.querySelectorAll('button, input, select'), panel].some(el => emitInteractionMotion(el, 'cancel'));
  }
  on(button('preview'), 'click', preview); on(button('apply'), 'click', apply);
  on(button('cancel'), 'click', cancel);
  let lastInput = null;
  function handleFieldChange(event) {
    stopPicking(); invalidate(); bounds();
    const target = event?.target?.closest?.('[data-field]');
    if (!target || !panel.contains(target) || !allowed()) return;
    if (event.type === 'change' && lastInput && lastInput.target === target && lastInput.value === target.value) { lastInput = null; return; }
    lastInput = event.type === 'input' ? { target, value: target.value } : null;
    try {
      if (String(target.value ?? '').trim() === '') throw new Error('Empty field');
      const name = target.dataset.field, tracks = AppState.getTracks();
      if (['destinationTrack', 'destinationBar', 'destinationBeat'].includes(name)) {
        const destTrack = integer(Number(field('destinationTrack').value) - 1, 0, tracks.length - 1, 'Destination track');
        const destBars = tracks[destTrack].barSettings;
        const destBar = integer(Number(field('destinationBar').value) - 1, 0, destBars.length - 1, 'Destination bar');
        integer(Number(field('destinationBeat').value) - 1, 0, getVisualBeatSlots(destBars[destBar]).length - 1, 'Destination beat');
      } else if (['operation', 'sliceCount', 'rotation'].includes(name)) {
        const op = field('operation').value;
        if (!['fill-rests', 'clear-rests', 'fill-accents', 'clear-accents', 'fill-slices', 'clear-slices', 'rotate', 'paste'].includes(op)) throw new Error('Unknown range operation');
        const sliceCount = integer(Number(field('sliceCount').value), 2, 32, 'Slice count');
        if (![2, 3, 4, 6, 8, 16, 32].includes(sliceCount)) throw new Error('Unsupported slice count');
        integer(Number(field('rotation').value), -4096, 4096, 'Rotation');
        if (op !== 'paste') resolveRange(tracks, readSelection());
      } else {
        if (!['beats', 'bars'].includes(field('mode').value)) throw new Error('Invalid mode');
        resolveRange(tracks, readSelection());
      }
      emitInteractionMotion(target, 'range');
    } catch { emitInteractionMotion(target, 'refuse'); }
  }
  on(panel, 'input', handleFieldChange);
  on(panel, 'change', handleFieldChange);
  function boundary(text) { stopPicking(); invalidate(text); bounds(); }
  on(doc, 'syncrolechange', event => { role = { state: event.detail?.state, isHost: event.detail?.isHost === true }; clipboard = null; boundary('Authority changed; preview again'); });
  for (const type of ['roomauthoritychange', 'historyboundary', 'historyapplied', 'playbackstatechange', 'appstatechange', 'barstructurechanged']) on(doc, type, () => { if (type === 'roomauthoritychange') clipboard = null; boundary('State changed; preview again'); });
  const unsubscribe = AppState.subscribeMusicalMutations(() => { if (!applying) boundary('Music changed; preview again'); });
  const observer = new MutationObserver(records => {
    const changed = !root.isConnected || (interactionRoot && !interactionRoot.isConnected) || records.some(record => {
      if (record.type === 'attributes') return interactionRoot?.contains(record.target);
      return interactionRoot?.contains(record.target) || [...record.removedNodes].some(node => node === interactionRoot || node.contains?.(interactionRoot));
    });
    if (changed) { if (pending || picking) boundary('Track display changed; preview again'); else bounds(); }
  });
  observer.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-container-index', 'data-bar-index', 'data-beat-index'] });
  const api = { preview, apply, cancel, destroy() { destroyed = true; stopPicking(); invalidate(); observer.disconnect(); unsubscribe(); listeners.forEach(off => off()); interactionRoot?.querySelectorAll('[data-range-source]').forEach(el => el.removeAttribute('data-range-source')); panel.remove(); mounts.delete(root); } };
  mounts.set(root, api); bounds(); return api;
}
