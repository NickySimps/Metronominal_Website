/**
 * Independent accessible presentation; load voice-note-display.css once.
 *
 * const view = createVoiceNoteDisplay(container, { stabilityMs: 120 });
 * view.update({ id: 60, label: 'C4', interval: null });
 * view.update({ id: 64, label: 'E4', interval: 4 });
 * view.update(null); // clear immediately on silence/reset
 * view.destroy();    // remove only this instance; safe to repeat
 *
 * id: nonempty string or finite number, including octave (e.g. MIDI 60).
 * label: nonblank string rendered literally, never as HTML.
 * interval: optional signed safe integer, supplied by the caller, not derived.
 * Positive/negative/zero render ↑/↓/= with absolute magnitude; use the same
 * numbering convention throughout (e.g. signed semitone distance).
 * stabilityMs: 0..60000, default 120; first note is immediate. A candidate
 * identity must remain the latest for this duration. Repeated candidates do
 * not restart the timer; returning to the committed identity cancels it.
 * Same committed id is a no-op even if metadata changes. Supply a new id to
 * represent a new identity. Inputs are copied; later mutations have no effect.
 * Invalid updates/options throw TypeError before changing state.
 *
 * A fixed current-note anchor contains the subtly wiggling glyph. At most one
 * previous note departs left for 300ms. Reduced motion disables both effects,
 * including when the preference changes while mounted. Polite, atomic live
 * announcements coalesce to the latest committed note in fixed 300ms windows,
 * so continuous melodies cannot postpone them indefinitely. Jitter and repeated
 * samples are silent. Silence clears visuals/candidates immediately but retains
 * the last status and lets its pending announcement finish. Destroy cancels all
 * work and releases timers/listeners. Calls after destroy are inert.
 *
 * Uses --Background, --ReadableOnBackground (fallback --TextPrimary),
 * --BorderRadius and --font-family. Theme owners must provide a readable
 * foreground/background pair. Long visible labels ellipsize; the live status
 * retains their full text. This does not mount itself or infer silence: caller
 * owns audio, stable note identities, interval calculation and update(null).
 * No app state, dependencies, or DOM globals at module import time.
 */
export function createVoiceNoteDisplay(container, { stabilityMs = 120 } = {}) {
  if (typeof stabilityMs !== 'number' || !Number.isFinite(stabilityMs) || stabilityMs < 0 || stabilityMs > 60_000) {
    throw new TypeError('stabilityMs must be a finite number from 0 to 60000');
  }
  const document = container.ownerDocument;
  const window = document.defaultView;
  let committed = null, candidate = null, departing = null;
  let stableTimer = null, departureTimer = null, announceTimer = null;
  let pendingAnnouncement = null;
  let destroyed = false;
  const root = document.createElement('section');
  root.className = 'voice-note-display';
  root.setAttribute('aria-label', 'Detected note');
  const visual = document.createElement('div');
  visual.className = 'voice-note-display__visual';
  visual.setAttribute('aria-hidden', 'true');
  const interval = document.createElement('div');
  interval.className = 'voice-note-display__interval';
  const current = document.createElement('div');
  current.className = 'voice-note-display__current';
  const glyph = document.createElement('span');
  glyph.className = 'voice-note-display__glyph';
  glyph.textContent = '—';
  current.append(glyph);
  const status = document.createElement('div');
  status.className = 'voice-note-display__status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  visual.append(interval, current);
  root.append(visual, status);
  container.append(root);

  function removeDeparture() {
    window.clearTimeout(departureTimer);
    departureTimer = null;
    departing?.remove();
    departing = null;
  }
  function cancelCandidate() {
    window.clearTimeout(stableTimer);
    stableTimer = null;
    candidate = null;
  }
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function onMotionChange() { if (motion.matches) removeDeparture(); }
  motion.addEventListener('change', onMotionChange);
  function commit(note) {
    cancelCandidate();
    removeDeparture();
    if (committed && !motion.matches) {
      departing = document.createElement('div');
      departing.className = 'voice-note-display__departing';
      departing.textContent = committed.label;
      visual.append(departing);
      departureTimer = window.setTimeout(removeDeparture, 300);
    }
    committed = note;
    glyph.textContent = note.label;
    root.classList.add('voice-note-display--held');
    const distance = note.interval;
    const hasInterval = distance != null;
    interval.textContent = hasInterval ? `${distance > 0 ? '↑' : distance < 0 ? '↓' : '='} ${Math.abs(distance)}` : '';
    pendingAnnouncement = `Note ${note.label}${hasInterval ? `, ${distance > 0 ? 'up' : distance < 0 ? 'down' : 'same'} ${Math.abs(distance)}` : ''}`;
    if (announceTimer === null) {
      announceTimer = window.setTimeout(() => {
        announceTimer = null;
        if (!destroyed && status.textContent !== pendingAnnouncement) status.textContent = pendingAnnouncement;
        pendingAnnouncement = null;
      }, 300);
    }
  }
  return {
    update(note) {
      if (destroyed) return;
      if (note == null) {
        cancelCandidate();
        removeDeparture();
        committed = null;
        glyph.textContent = '—';
        interval.textContent = '';
        root.classList.remove('voice-note-display--held');
        return;
      }
      const validId = (typeof note.id === 'string' && note.id.length > 0) ||
        (typeof note.id === 'number' && Number.isFinite(note.id));
      if (!validId || typeof note.label !== 'string' || !note.label.trim() ||
          (note.interval != null && !Number.isSafeInteger(note.interval))) {
        throw new TypeError('Expected a note id, nonempty text label, and optional signed integer interval');
      }
      const next = { id: note.id, label: note.label, interval: note.interval ?? null };
      if (committed?.id === next.id) { cancelCandidate(); return; }
      if (candidate?.id === next.id) return;
      cancelCandidate();
      if (!committed) { commit(next); return; }
      candidate = next;
      stableTimer = window.setTimeout(() => commit(next), stabilityMs);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelCandidate();
      removeDeparture();
      window.clearTimeout(announceTimer);
      announceTimer = null;
      pendingAnnouncement = null;
      motion.removeEventListener('change', onMotionChange);
      root.remove();
    },
  };
}
