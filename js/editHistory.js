import AppState from './appState.js';

let active = null;
export function beginEditTransaction(label = 'Edit') { return active?.begin(label) ?? null; }
export function commitEditTransaction(token) { return active?.commit(token) ?? false; }
export function cancelEditTransaction(token) { return active?.cancel(token) ?? false; }

/** Initialize after initial UI refresh, before WebRTC. No networking/UI-controller imports. */
export function initializeHistoryControls(root) {
  if (!root?.append) throw new TypeError('History controls need a DOM root');
  active?.destroy();
  const document = root.ownerDocument;
  const group = document.createElement('div');
  group.className = 'edit-history';
  group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'Edit history');
  const undoButton = document.createElement('button');
  const redoButton = document.createElement('button');
  undoButton.type = redoButton.type = 'button';
  undoButton.textContent = 'Undo'; redoButton.textContent = 'Redo';
  undoButton.setAttribute('aria-keyshortcuts', 'Control+Z Meta+Z');
  redoButton.setAttribute('aria-keyshortcuts', 'Control+Shift+Z Meta+Shift+Z Control+Y');
  const status = document.createElement('span'); status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
  group.append(undoButton, redoButton, status); root.append(group);
  const undoStack = [], redoStack = [];
  let busy = false, generation = 0, transaction = null;
  let baseline = AppState.getMusicalSnapshot();
  let role = { state: 'solo', isHost: true };
  const allowed = () => role.state === 'solo' || role.isHost === true;
  const editable = () => allowed() && !AppState.isPlaying() && !busy;
  function render(message) {
    undoButton.disabled = !editable() || !undoStack.length;
    redoButton.disabled = !editable() || !redoStack.length;
    status.textContent = message || (!allowed() ? 'Only the host can edit' : AppState.isPlaying() ? 'Stop playback to undo' : busy ? 'Applying edit…' : `${undoStack.length} undo · ${redoStack.length} redo`);
  }
  function record(before, after, label, mergeKey = null) {
    if (JSON.stringify(before) === JSON.stringify(after)) return false;
    redoStack.length = 0;
    const last = undoStack.at(-1), now = Date.now();
    if (mergeKey && last?.mergeKey === mergeKey && now - last.time < 650) {
      last.after = after; last.time = now;
    } else undoStack.push({ before, after, label, mergeKey, time: now });
    if (undoStack.length > 50) undoStack.shift();
    render(); return true;
  }
  const unsubscribe = AppState.subscribeMusicalMutations(change => {
    const before = baseline;
    baseline = change.after;
    if (!editable()) {
      if (JSON.stringify(before) !== JSON.stringify(change.after)) clear();
      return;
    }
    if (transaction) return;
    const mergeKey = ['setTempo', 'setVolume', 'updateTrack', 'setBeatSound'].includes(change.label)
      ? `${change.label}:${change.args.slice(0, change.label === 'setBeatSound' ? 4 : change.label === 'updateTrack' ? 1 : 0).join(':')}:${change.label === 'updateTrack' ? Object.keys(change.args[1] || {}).sort().join(',') : ''}` : null;
    record(before, change.after, change.label, mergeKey);
  });
  async function apply(direction) {
    const source = direction === 'undo' ? undoStack : redoStack;
    const target = direction === 'undo' ? redoStack : undoStack;
    if (!editable() || transaction || !source.length) return false;
    const entry = source.at(-1), expected = generation;
    busy = true; render();
    try {
      const guard = () => expected === generation && allowed() && !AppState.isPlaying();
      const result = await AppState.applyMusicalSnapshot(direction === 'undo' ? entry.before : entry.after, guard);
      if (!result || !guard()) return false;
      source.pop(); target.push(entry);
      document.dispatchEvent(new CustomEvent('historyapplied', { detail: { direction, label: entry.label } }));
      return true;
    } finally { busy = false; render(); }
  }
  function clear() { generation++; transaction = null; undoStack.length = redoStack.length = 0; baseline = AppState.getMusicalSnapshot(); render(); }
  const loaded = () => { baseline = AppState.getMusicalSnapshot(); };
  function roleChanged(event) {
    const next = event.detail || {};
    if (next.state !== role.state || next.isHost !== role.isHost) clear();
    role = { state: next.state, isHost: next.isHost === true }; render();
  }
  function keydown(event) {
    if (event.defaultPrevented || event.altKey || !(event.ctrlKey || event.metaKey)
      || event.target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]')) return;
    const key = event.key.toLowerCase();
    const direction = key === 'z' ? event.shiftKey ? 'redo' : 'undo' : key === 'y' ? 'redo' : null;
    if (!direction || !editable() || !(direction === 'undo' ? undoStack : redoStack).length) return;
    event.preventDefault(); void apply(direction);
  }
  const undo = () => apply('undo'), redo = () => apply('redo');
  const playbackChanged = () => { if (AppState.isPlaying()) { generation++; transaction = null; } render(); };
  undoButton.addEventListener('click', undo); redoButton.addEventListener('click', redo);
  document.addEventListener('keydown', keydown);
  document.addEventListener('syncrolechange', roleChanged);
  document.addEventListener('roomauthoritychange', clear);
  document.addEventListener('historyboundary', clear);
  document.addEventListener('appstatechange', loaded);
  document.addEventListener('playbackstatechange', playbackChanged);
  active = {
    undo, redo, clear,
    begin(label) {
      if (!editable() || transaction) return null;
      transaction = { label, generation, before: AppState.getMusicalSnapshot() }; return transaction;
    },
    commit(token) {
      if (!token || token !== transaction) return false;
      transaction = null;
      if (!editable() || token.generation !== generation) return false;
      baseline = AppState.getMusicalSnapshot();
      return record(token.before, baseline, token.label);
    },
    cancel(token) { if (!token || token !== transaction) return false; transaction = null; baseline = AppState.getMusicalSnapshot(); return true; },
    destroy() {
      clear(); unsubscribe(); group.remove();
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('syncrolechange', roleChanged);
      document.removeEventListener('roomauthoritychange', clear);
      document.removeEventListener('historyboundary', clear);
      document.removeEventListener('appstatechange', loaded);
      document.removeEventListener('playbackstatechange', playbackChanged);
      if (active === this) active = null;
    },
  };
  render(); return active;
}
