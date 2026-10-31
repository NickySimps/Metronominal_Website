import AppState from './appState.js';
import { emitInteractionMotion } from './interactionMotion.js';

let active = null;
export function beginEditTransaction(label = 'Edit') { return active?.begin(label) ?? null; }
export function commitEditTransaction(token) { return active?.commit(token) ?? false; }
export function cancelEditTransaction(token) { return active?.cancel(token) ?? false; }
export function interruptEditTransaction(token, change) { return active?.interrupt(token, change) ?? false; }

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
  let busy = false, generation = 0, transaction = null, lastNotifiedBefore = null, lastNotifiedAfter = null, interruptedAfter = null;
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
    cancelPending();
    if (interruptedAfter && interruptedAfter === change.after) { interruptedAfter = null; return; }
    const before = baseline;
    baseline = change.after;
    if (!editable()) {
      lastNotifiedBefore = lastNotifiedAfter = interruptedAfter = null;
      if (JSON.stringify(before) !== JSON.stringify(change.after)) clear();
      return;
    }
    if (transaction) {
      lastNotifiedBefore = before;
      lastNotifiedAfter = change.after;
      return;
    }
    const mergeKey = ['setTempo', 'setVolume', 'updateTrack', 'setBeatSound'].includes(change.label)
      ? `${change.label}:${change.args.slice(0, change.label === 'setBeatSound' ? 4 : change.label === 'updateTrack' ? 1 : 0).join(':')}:${change.label === 'updateTrack' ? Object.keys(change.args[1] || {}).sort().join(',') : ''}` : null;
    record(before, change.after, change.label, mergeKey);
  });
  const view = document.defaultView || window;
  let pendingTicket = null;
  function cancelPending(t = pendingTicket) {
    if (!t) return;
    if (pendingTicket === t) pendingTicket = null;
    t.cancelled = true;
    t.slots = t.expectedJson = t.guard = null;
    if (t.frame !== null) { (view.cancelAnimationFrame || cancelAnimationFrame)(t.frame); t.frame = null; }
    if (t.timer !== null) { (view.clearTimeout || clearTimeout)(t.timer); t.timer = null; }
  }
  function inViewport(el) {
    if (!el?.isConnected || el.hidden || el.closest?.('[hidden]')) return false;
    const r = el.getBoundingClientRect?.();
    return Boolean(r && r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < view.innerWidth && r.top < view.innerHeight);
  }
  function diffBeats(before, after) {
    const out = [], bTracks = Array.isArray(before?.Tracks) ? before.Tracks : [], aTracks = Array.isArray(after?.Tracks) ? after.Tracks : [];
    for (let t = 0, tMax = Math.max(bTracks.length, aTracks.length); t < tMax; t++) {
      if (!Number.isInteger(t) || t < 0) continue;
      const bBars = Array.isArray(bTracks[t]?.barSettings) ? bTracks[t].barSettings : [], aBars = Array.isArray(aTracks[t]?.barSettings) ? aTracks[t].barSettings : [];
      for (let b = 0, bMax = Math.max(bBars.length, aBars.length); b < bMax; b++) {
        if (!Number.isInteger(b) || b < 0) continue;
        const bBar = bBars[b], aBar = aBars[b], slots = new Set();
        for (const bar of [bBar, aBar]) {
          if (!bar || typeof bar !== 'object') continue;
          if (Array.isArray(bar.rests)) for (const v of bar.rests) { const n = Number(v); if (Number.isInteger(n) && n >= 0) slots.add(n); }
          for (const k of ['velocities', 'beatSlices', 'beatSliceAnchors', 'beatSounds']) {
            const map = bar[k];
            if (map && typeof map === 'object') for (const key of Object.keys(map)) { const n = Number(key); if (Number.isInteger(n) && n >= 0) slots.add(n); }
          }
        }
        for (const n of [...slots].sort((x, y) => x - y)) {
          if (Boolean(bBar?.rests?.includes?.(n)) !== Boolean(aBar?.rests?.includes?.(n))
            || bBar?.velocities?.[n] !== aBar?.velocities?.[n]
            || bBar?.beatSlices?.[n] !== aBar?.beatSlices?.[n]
            || bBar?.beatSliceAnchors?.[n] !== aBar?.beatSliceAnchors?.[n]
            || JSON.stringify(bBar?.beatSounds?.[n]) !== JSON.stringify(aBar?.beatSounds?.[n])) out.push([t, b, n]);
        }
      }
    }
    return out;
  }
  function queryBeat([t, b, n]) {
    return document.querySelector(`.bar-visual[data-container-index="${t}"][data-bar-index="${b}"] .beat-square[data-beat-index="${n}"]:not(.removing-beat-animation)`);
  }
  function emitBeats(beats, direction) {
    let count = 0;
    for (const slot of beats) {
      const el = queryBeat(slot);
      if (!inViewport(el) || !emitInteractionMotion(el, direction)) continue;
      if (++count >= 8) break;
    }
    return count;
  }
  function emitFallback(direction) {
    const button = direction === 'undo' ? undoButton : redoButton;
    const focused = document.activeElement?.matches?.('button,[role="button"]') ? document.activeElement : null;
    const motionTarget = inViewport(focused) ? focused : inViewport(button) ? button : null;
    if (motionTarget) emitInteractionMotion(motionTarget, direction);
  }
  async function apply(direction) {
    const source = direction === 'undo' ? undoStack : redoStack;
    const target = direction === 'undo' ? redoStack : undoStack;
    if (!editable() || transaction || !source.length) {
      emitInteractionMotion(group, 'refuse');
      return false;
    }
    cancelPending();
    const entry = source.at(-1), expected = generation, restored = direction === 'undo' ? entry.before : entry.after;
    busy = true; render();
    try {
      const guard = () => expected === generation && allowed() && !AppState.isPlaying();
      const result = await AppState.applyMusicalSnapshot(restored, guard);
      if (!result || !guard()) {
        if (expected === generation) emitInteractionMotion(group, 'refuse');
        return false;
      }
      source.pop(); target.push(entry);
      document.dispatchEvent(new CustomEvent('historyapplied', { detail: { direction, label: entry.label } }));
      cancelPending();
      const beats = diffBeats(entry.before, entry.after);
      if (!beats.length) emitFallback(direction);
      else if (!emitBeats(beats, direction)) {
        const slots = [], readyList = [];
        for (const slot of beats) {
          const el = queryBeat(slot);
          if (!inViewport(el)) continue;
          slots.push(slot);
          for (const anim of el.getAnimations?.() || []) {
            try {
              const r = anim?.ready;
              if (r && typeof r.then === 'function') readyList.push(r.catch(() => {}));
            } catch {}
          }
          if (slots.length >= 8) break;
        }
        if (slots.length) {
          const ticket = pendingTicket = {
            cancelled: false, frame: null, timer: null, slots,
            expectedJson: JSON.stringify(AppState.getMusicalSnapshot()), guard,
          };
          const validTicket = () => !ticket.cancelled && pendingTicket === ticket && group.isConnected
            && ticket.guard?.() && JSON.stringify(AppState.getMusicalSnapshot()) === ticket.expectedJson;
          const raf = view.requestAnimationFrame || requestAnimationFrame, setTimer = view.setTimeout || setTimeout;
          let attempts = 0;
          const step = () => {
            ticket.frame = null;
            if (!validTicket()) return cancelPending(ticket);
            if (emitBeats(ticket.slots, direction)) return cancelPending(ticket);
            if (++attempts < 2 && ticket.slots.some(slot => inViewport(queryBeat(slot)))) ticket.frame = raf(step);
            else { cancelPending(ticket); emitFallback(direction); }
          };
          const scheduleTry = () => {
            if (!validTicket()) return cancelPending(ticket);
            if (ticket.timer !== null) { (view.clearTimeout || clearTimeout)(ticket.timer); ticket.timer = null; }
            if (ticket.frame === null) ticket.frame = raf(step);
          };
          ticket.timer = setTimer(() => {
            ticket.timer = null;
            if (!validTicket()) return cancelPending(ticket);
            if (ticket.frame !== null) { (view.cancelAnimationFrame || cancelAnimationFrame)(ticket.frame); ticket.frame = null; }
            if (!emitBeats(ticket.slots, direction)) emitFallback(direction);
            cancelPending(ticket);
          }, 240);
          if (readyList.length) Promise.all(readyList).then(scheduleTry, scheduleTry);
          else scheduleTry();
        } else emitFallback(direction);
      }
      return true;
    } finally { busy = false; render(); }
  }
  function clear() {
    const hadHistory = undoStack.length || redoStack.length || transaction || pendingTicket;
    cancelPending(); generation++; transaction = null;
    lastNotifiedBefore = lastNotifiedAfter = interruptedAfter = null;
    undoStack.length = redoStack.length = 0;
    baseline = AppState.getMusicalSnapshot(); render();
    if (hadHistory) emitInteractionMotion(group, 'cancel');
  }
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
    if (!direction) return;
    if (!editable() || !(direction === 'undo' ? undoStack : redoStack).length) {
      emitInteractionMotion(group, 'refuse');
      return;
    }
    event.preventDefault(); void apply(direction);
  }
  const undo = () => apply('undo'), redo = () => apply('redo');
  const playbackChanged = () => { if (AppState.isPlaying()) { cancelPending(); generation++; transaction = null; lastNotifiedBefore = lastNotifiedAfter = interruptedAfter = null; } render(); };
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
      cancelPending();
      lastNotifiedBefore = lastNotifiedAfter = interruptedAfter = null;
      transaction = { label, generation, before: AppState.getMusicalSnapshot() }; return transaction;
    },
    commit(token) {
      if (!token || token !== transaction) return false;
      transaction = null; lastNotifiedBefore = lastNotifiedAfter = interruptedAfter = null;
      if (!editable() || token.generation !== generation) return false;
      baseline = AppState.getMusicalSnapshot();
      return record(token.before, baseline, token.label);
    },
    interrupt(token, change) {
      if (!token || token !== transaction || !change?.after) return false;
      const matched = lastNotifiedAfter === change.after;
      const preForeign = matched ? lastNotifiedBefore : baseline;
      transaction = null; lastNotifiedBefore = lastNotifiedAfter = null;
      if (!editable() || token.generation !== generation) { interruptedAfter = null; return false; }
      interruptedAfter = matched ? null : change.after;
      baseline = change.after;
      const stroke = record(token.before, preForeign, token.label, null);
      const foreign = record(preForeign, change.after, change.label || 'Edit', null);
      return stroke || foreign;
    },
    cancel(token) { if (!token || token !== transaction) return false; transaction = null; lastNotifiedBefore = lastNotifiedAfter = interruptedAfter = null; baseline = AppState.getMusicalSnapshot(); return true; },
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
