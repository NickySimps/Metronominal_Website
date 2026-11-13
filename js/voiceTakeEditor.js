import { validateMelody, TICKS_PER_MAIN_BEAT } from './melodySchema.js';

const PAGE_SIZE = 16;
const HISTORY_LIMIT = 50;
const pitch = midi => `${['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][midi % 12]}${Math.floor(midi / 12) - 1}`;

/** Standalone device-local correction surface; load voice-take-editor.css.
 * createVoiceTakeEditor(container, {melody,barSettings,onApply,onCancel?,requireSampleRoot?})
 * -> {getDraft(), destroy()}. Input must pass the real melodySchema.
 * onApply receives a fresh validated clone only on explicit Apply; a throw or
 * rejected promise leaves the editor open. Cancel/destroy cannot undo callback
 * side effects already started. Caller MUST gate playback/authority in onApply
 * before writing to app state. No audio, capture, storage or network.
 * Every note is reachable by bar/page (16 lanes/page). Repeated pitches have
 * separate lanes so chords/unisons remain operable. Timing strips show actual
 * durations; 44px selection targets do not change musical timing.
 * Snap affects explicit Update only: onset/duration round independently nearest,
 * half upward; duration at least one step. Crossing bars is rejected, never
 * clipped/split/tied. Transposition changes notes, not sample root. Undo/Redo
 * retain 50 accepted edits. Uncommitted fields block Apply/navigation/other edits.
 */
export function createVoiceTakeEditor(container, options) {
  if (!container || container.nodeType !== 1) throw new TypeError('Editor container required');
  if (typeof options?.onApply !== 'function' || (options.onCancel !== undefined && typeof options.onCancel !== 'function')) throw new TypeError('Editor callbacks required');
  const schemaOptions = { requireSampleRoot: options.requireSampleRoot ?? false };
  let draft = validateMelody(options.melody, options.barSettings, schemaOptions);
  const original = validateMelody(draft, options.barSettings, schemaOptions);
  const meters = options.barSettings.map(bar => ({ beats: bar.beats }));
  const { onApply, onCancel } = options;
  const doc = container.ownerDocument, previousFocus = doc.activeElement;
  let closed = false, busy = false, dirty = false, barIndex = 0, pageIndex = 0;
  let selectedId = draft.bars[0][0]?.id;
  const past = [], future = [];
  const root = doc.createElement('section');
  root.className = 'voice-take-editor'; root.setAttribute('aria-label', 'Detached melody draft editor');
  const make = (tag, text, parent = root, className) => {
    const node = doc.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    parent.append(node); return node;
  };
  const button = (text, action, parent = root) => {
    const node = make('button', text, parent); node.type = 'button';
    node.addEventListener('click', () => { if (!closed && !busy) action(); }); return node;
  };
  const heading = make('h2', 'Correct your melody'); heading.tabIndex = -1;
  make('p', 'Device-local draft. No automatic saving. Apply delivers this draft to the caller; Cancel discards it.');
  make('p', '960 ticks = one main beat. Notes cannot cross bar boundaries. Snap rounds onset and duration on Update only. Each pitch lane holds one note; repeated pitches use separate lanes.');
  const navigation = make('div', undefined, root, 'voice-take-editor__tools');
  const select = (label, parent) => { const wrapper = make('label', label, parent), control = make('select', undefined, wrapper); control.setAttribute('aria-label', label); return control; };
  const bars = select('Bar', navigation);
  meters.forEach((bar, i) => { const option = make('option', `Bar ${i + 1} · ${bar.beats} beats`, bars); option.value = String(i); });
  const pages = select('Note page', navigation), snap = select('Snap ticks', navigation);
  [1, 120, 240, 480, 960].forEach(step => { const option = make('option', step === 1 ? 'Off (1 tick)' : String(step), snap); option.value = String(step); });
  const summary = make('p', '');
  const viewport = make('div', undefined, root, 'voice-take-editor__viewport');
  viewport.tabIndex = 0; viewport.setAttribute('role', 'region'); viewport.setAttribute('aria-label', 'Note timeline, scroll horizontally for beats');
  const grid = make('div', undefined, viewport, 'voice-take-editor__grid');
  const edit = make('fieldset'); make('legend', 'Selected note', edit);
  const fieldLayout = make('div', undefined, edit, 'voice-take-editor__fields'), fields = {};
  for (const [key, label, min, max] of [['midi', 'MIDI pitch', 0, 127], ['startTick', 'Onset ticks', 0, 30719], ['durationTicks', 'Duration ticks', 1, 30720], ['velocity', 'Velocity', 0, 1]]) {
    const wrapper = make('label', label, fieldLayout), input = make('input', undefined, wrapper);
    input.type = 'number'; input.min = String(min); input.max = String(max); input.step = key === 'velocity' ? 'any' : '1';
    input.addEventListener('input', () => { dirty = true; status.textContent = 'Field changes pending. Update note or discard field changes before Apply.'; sync(); });
    fields[key] = input;
  }
  const editActions = make('div', undefined, edit, 'voice-take-editor__tools');
  button('Update note', () => {
    try {
      const next = clone(), note = next.bars[barIndex].find(n => n.id === selectedId);
      for (const [key, input] of Object.entries(fields)) {
        if (input.value.trim() === '' || !input.validity.valid) throw new TypeError(`Invalid melody: ${key}`);
        // Chrome's valueAsNumber can normalize textual -0 to +0. Preserve it
        // for the schema's deliberate negative-zero refusal.
        note[key] = Number(input.value);
        if (Object.is(note[key], -0)) throw new TypeError(`Invalid melody: ${key}`);
      }
      const step = Number(snap.value);
      note.startTick = Math.round(note.startTick / step) * step || 0;
      note.durationTicks = Math.max(step, Math.round(note.durationTicks / step) * step);
      commit(next, 'Note updated in draft.');
    } catch (error) { report(error); }
  }, editActions);
  button('Discard field changes', () => { dirty = false; render(); status.textContent = 'Field changes discarded.'; }, editActions);
  const deleteButton = button('Delete note', () => guard(() => {
    const order = sorted(), index = order.findIndex(n => n.id === selectedId), next = clone();
    next.bars[barIndex] = next.bars[barIndex].filter(n => n.id !== selectedId);
    selectedId = (order[index + 1] ?? order[index - 1])?.id;
    commit(next, 'Note deleted from draft.'); (edit.disabled ? undo : deleteButton).focus();
  }), editActions);
  const tools = make('div', undefined, root, 'voice-take-editor__tools');
  const undo = button('Undo', () => guard(() => restore(past, future, 'Undone.')), tools);
  const redo = button('Redo', () => guard(() => restore(future, past, 'Redone.')), tools);
  for (const [label, amount] of [['Transpose all down', -1], ['Transpose all up', 1]]) {
    button(label, () => guard(() => {
      const next = clone(); next.bars.forEach(bar => bar.forEach(note => { note.midi += amount; }));
      commit(next, `All notes transposed ${amount > 0 ? 'up' : 'down'} one semitone. Sample root unchanged.`);
    }), tools);
  }
  const status = make('p', 'Draft ready.'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
  const actions = make('div', undefined, root, 'voice-take-editor__tools');
  const apply = button('Apply draft', async () => {
    if (dirty) return;
    const hadFocus = root.contains(doc.activeElement);
    try {
      const candidate = clone(); busy = true; sync(); status.textContent = 'Applying draft through caller…';
      await onApply(candidate); if (!closed) close(false, hadFocus);
    } catch (error) {
      if (!closed) {
        busy = false; report(error); sync();
        if (hadFocus && (!doc.activeElement || doc.activeElement === doc.body || doc.activeElement === doc.documentElement || root.contains(doc.activeElement))) apply.focus();
      }
    }
  }, actions);
  const cancel = make('button', 'Cancel', actions); cancel.type = 'button';
  cancel.addEventListener('click', () => { if (!closed) { close(true); onCancel?.(); } });
  function clone() { return validateMelody(draft, meters, schemaOptions); }
  function report(error) { status.textContent = error instanceof Error ? error.message : 'Draft operation failed.'; }
  function guard(action) {
    if (dirty) { status.textContent = 'Update note or discard field changes first.'; return; }
    try { action(); } catch (error) { report(error); }
  }
  function commit(value, message) {
    const valid = validateMelody(value, meters, schemaOptions);
    if (JSON.stringify(valid) !== JSON.stringify(draft)) {
      past.push(clone()); if (past.length > HISTORY_LIMIT) past.shift(); future.length = 0; draft = valid;
    }
    dirty = false; render(); status.textContent = message;
  }
  function restore(from, to, message) {
    if (!from.length) return;
    to.push(clone()); if (to.length > HISTORY_LIMIT) to.shift();
    draft = validateMelody(from.pop(), meters, schemaOptions); render(); status.textContent = message;
  }
  function sync() {
    root.querySelectorAll('button,input,select').forEach(node => { if (node !== cancel) node.disabled = busy; });
    edit.disabled = busy || !draft.bars[barIndex].some(n => n.id === selectedId);
    apply.disabled = busy || dirty; undo.disabled = busy || dirty || !past.length; redo.disabled = busy || dirty || !future.length;
  }
  const sorted = () => [...draft.bars[barIndex]].sort((a, b) => b.midi - a.midi || a.startTick - b.startTick || a.id.localeCompare(b.id));
  function render() {
    const notes = sorted();
    if (!notes.some(n => n.id === selectedId)) selectedId = notes[0]?.id;
    const selected = notes.find(n => n.id === selectedId);
    pageIndex = selected ? Math.floor(notes.indexOf(selected) / PAGE_SIZE) : 0;
    const count = Math.max(1, Math.ceil(notes.length / PAGE_SIZE)); pages.replaceChildren();
    for (let i = 0; i < count; i++) { const option = make('option', `Notes ${notes.length ? i * PAGE_SIZE + 1 : 0}–${Math.min(notes.length, (i + 1) * PAGE_SIZE)} of ${notes.length}`, pages); option.value = String(i); }
    pages.value = String(pageIndex); bars.value = String(barIndex);
    summary.textContent = `Bar ${barIndex + 1}, ${notes.length} notes. Page ${pageIndex + 1} of ${count}. ${draft.bars.reduce((sum, bar) => sum + bar.length, 0)} notes in draft. ${selected ? `Selected ${selected.id}, ${pitch(selected.midi)}.` : 'Empty bar.'}`;
    grid.replaceChildren();
    const beats = meters[barIndex].beats, length = beats * TICKS_PER_MAIN_BEAT;
    grid.style.width = `${Math.max(480, beats * 64) + 80}px`;
    const ruler = make('div', undefined, grid, 'voice-take-editor__row'); make('span', 'Pitch', ruler);
    const beatGrid = make('div', undefined, ruler, 'voice-take-editor__ruler'); beatGrid.style.gridTemplateColumns = `repeat(${beats},1fr)`;
    for (let i = 0; i < beats; i++) make('span', String(i + 1), beatGrid);
    for (const note of notes.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE)) {
      const row = make('div', undefined, grid, 'voice-take-editor__row'); make('span', `${pitch(note.midi)} (${note.midi})`, row);
      const lane = make('div', undefined, row, 'voice-take-editor__lane'); lane.style.backgroundSize = `${100 / beats}% 100%`;
      const strip = make('span', undefined, lane, 'voice-take-editor__duration');
      strip.style.left = `${note.startTick / length * 100}%`; strip.style.width = `${note.durationTicks / length * 100}%`; strip.setAttribute('aria-hidden', 'true');
      const target = button(note.id, () => guard(() => {
        selectedId = note.id; render(); root.querySelectorAll('[data-note-id]').forEach(node => { if (node.dataset.noteId === note.id) node.focus(); });
      }), lane);
      target.className = 'voice-take-editor__note'; target.dataset.noteId = note.id;
      target.style.left = `min(${note.startTick / length * 100}%, calc(100% - 44px))`;
      target.setAttribute('aria-label', `Select note ${note.id}, ${pitch(note.midi)}, MIDI ${note.midi}, onset ${note.startTick}, duration ${note.durationTicks}, velocity ${note.velocity}`);
      target.setAttribute('aria-pressed', String(note.id === selectedId));
    }
    if (!notes.length) make('p', 'No notes in this bar.', grid);
    for (const [key, input] of Object.entries(fields)) input.value = selected ? String(selected[key]) : '';
    fields.startTick.max = String(length - 1); fields.durationTicks.max = String(length); sync();
  }
  function navigate(which, value) {
    if (busy || closed) return;
    if (dirty) { status.textContent = 'Update note or discard field changes before navigating.'; bars.value = String(barIndex); pages.value = String(pageIndex); return; }
    if (which === 'bar') { barIndex = value; selectedId = undefined; }
    else selectedId = sorted()[value * PAGE_SIZE]?.id;
    render();
  }
  bars.addEventListener('change', () => navigate('bar', Number(bars.value)));
  pages.addEventListener('change', () => navigate('page', Number(pages.value)));
  function close(discard = false, restoreFocus = false) {
    if (closed) return;
    if (discard) draft = validateMelody(original, meters, schemaOptions);
    past.length = 0; future.length = 0;
    closed = true;
    const ownedFocus = root.contains(doc.activeElement) || (restoreFocus && (!doc.activeElement || doc.activeElement === doc.body || doc.activeElement === doc.documentElement));
    root.remove();
    if (ownedFocus && previousFocus?.isConnected) previousFocus.focus();
  }
  container.append(root); render(); heading.focus();
  return Object.freeze({ getDraft: clone, destroy: () => close(true) });
}
