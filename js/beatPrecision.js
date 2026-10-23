import AppState from './appState.js';
import SoundSettingsModal from './soundSettingsModal.js';

const mounts = new WeakMap();
/** Device-local targeting only. Call destroy() before removing the mount. */
export function initializeBeatPrecision(controlsRoot, interactionRoot = document.getElementById('all-tracks-wrapper')) {
  if (!controlsRoot?.append || !interactionRoot?.addEventListener) return null;
  if (mounts.has(controlsRoot)) return mounts.get(controlsRoot);
  const doc = controlsRoot.ownerDocument;
  const group = doc.createElement('section'); group.className = 'beat-precision'; group.setAttribute('aria-label', 'Precision beat selection');
  function button(text) { const b = doc.createElement('button'); b.type = 'button'; b.textContent = text; group.append(b); return b; }
  const toggle = button('Precision'); toggle.setAttribute('aria-label', 'Precision beat selection'); toggle.setAttribute('aria-pressed', 'false');
  const previous = button('Previous beat'), next = button('Next beat'), edit = button('Edit selected beat');
  const status = doc.createElement('span'); status.setAttribute('role', 'status'); group.append(status); controlsRoot.append(group);
  let enabled = false, selected = null;
  let role = { state: doc.querySelector('#share-btn.connected') ? 'connected' : 'solo', isHost: window.isHost === true };
  const listeners = [];
  function on(target, name, handler, options) { target.addEventListener(name, handler, options); listeners.push(() => target.removeEventListener(name, handler, options)); }
  const valid = beat => beat?.isConnected && interactionRoot.contains(beat);
  const allowed = () => (role.state === 'solo' || role.isHost) && !AppState.isPlaying();
  function render() {
    toggle.setAttribute('aria-pressed', String(enabled));
    interactionRoot.classList.toggle('beat-precision-enabled', enabled);
    previous.disabled = next.disabled = !enabled;
    edit.disabled = !enabled || !valid(selected) || !allowed();
    const bar = selected?.closest('.bar-visual');
    status.textContent = selected && bar ? `Track ${Number(bar.dataset.containerIndex) + 1} · Bar ${Number(bar.dataset.barIndex) + 1} · Beat ${Number(selected.dataset.beatIndex) + 1}` : enabled ? 'Tap a beat to select. Hold and slide to magnify. Selection never edits.' : 'Off · ordinary beat gestures';
  }
  function select(beat) { selected?.classList.remove('beat-precision-selected'); selected = valid(beat) ? beat : null; selected?.classList.add('beat-precision-selected'); render(); }
  let pending = null, preview = null;
  const lensTargets = new WeakMap();
  const lensHit = event => {
    const cell = doc.elementFromPoint(event.clientX, event.clientY)?.closest('.beat-precision-cell');
    return cell && preview?.contains(cell) ? lensTargets.get(cell) : null;
  };
  const label = beat => { const bar = beat.closest('.bar-visual'); return `Track ${Number(bar.dataset.containerIndex) + 1} · Bar ${Number(bar.dataset.barIndex) + 1} · Beat ${Number(beat.dataset.beatIndex) + 1}`; };
  function cancel(clear = false, focus = false) {
    if (pending) { clearTimeout(pending.hold); clearTimeout(pending.dwell); }
    pending = null; preview?.remove(); preview = null;
    if (clear) select(null);
    if (focus) toggle.focus({ preventScroll: true });
  }
  function nearest(bar, x, y, current = null) {
    let best = current, distance = Infinity;
    const measure = beat => { const r = beat.getBoundingClientRect(); return Math.hypot(x - r.x - r.width / 2, y - r.y - r.height / 2); };
    for (const beat of bar.querySelectorAll('.beat-square[data-beat-index]')) { const d = measure(beat); if (d < distance) { best = beat; distance = d; } }
    return current && best !== current && measure(current) - distance < 4 ? current : best;
  }
  function drawPreview() {
    if (!pending || !valid(pending.beat)) return cancel(true);
    const p = pending, rect = p.bar.getBoundingClientRect();
    if (!preview) { preview = doc.createElement('aside'); preview.className = 'beat-precision-preview'; preview.dataset.beatPrecisionLens = ''; preview.setAttribute('aria-label', 'Magnified nearby beats'); doc.body.append(preview); }
    preview.dataset.scale = p.fine ? 'fine' : 'coarse'; preview.replaceChildren();
    const heading = doc.createElement('div'); heading.textContent = label(p.beat); preview.append(heading);
    const row = doc.createElement('div'); row.className = 'beat-precision-cells'; preview.append(row);
    const beats = [...p.bar.querySelectorAll('.beat-square')], index = beats.indexOf(p.beat);
    const count = Math.max(1, Math.min(5, Math.floor((window.innerWidth - 40) / (p.fine ? 64 : 48))));
    const start = Math.max(0, Math.min(index - Math.floor(count / 2), beats.length - count));
    for (const beat of beats.slice(start, start + count)) {
      const cell = doc.createElement('button'); cell.type = 'button'; cell.className = 'beat-precision-cell'; cell.textContent = String(Number(beat.dataset.beatIndex) + 1);
      cell.setAttribute('aria-label', `Select beat ${Number(beat.dataset.beatIndex) + 1}`); lensTargets.set(cell, beat);
      cell.addEventListener('click', () => { cancel(); select(beat); toggle.focus({ preventScroll: true }); });
      cell.dataset.current = String(beat === p.beat); row.append(cell);
    }
    const h = preview.getBoundingClientRect().height;
    const y = rect.top >= h + 16 ? rect.top - h - 12 : rect.bottom + h + 16 <= window.innerHeight ? rect.bottom + 12 : null;
    if (y === null) { preview.remove(); preview = null; status.textContent = 'Not enough preview space. Use Previous / Next beat.'; return; }
    preview.style.top = `${y}px`; preview.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - preview.getBoundingClientRect().width - 8))}px`;
  }
  function dwell() {
    if (!pending) return;
    clearTimeout(pending.dwell);
    pending.dwell = setTimeout(() => { if (pending?.active) { pending.fine = true; drawPreview(); } }, 280);
  }
  on(toggle, 'click', () => { cancel(true); enabled = !enabled; render(); });
  on(doc, 'pointerdown', event => { if (pending && (event.pointerId !== pending.id || event.isPrimary === false)) cancel(true); }, true);
  on(interactionRoot, 'pointerdown', event => {
    if (!enabled || event.button > 0) return;
    const bar = event.target.closest?.('.bar-visual'); if (!bar || !interactionRoot.contains(bar)) return;
    event.stopImmediatePropagation(); cancel();
    if (event.isPrimary === false) return;
    const beat = event.target.closest('.beat-square') || nearest(bar, event.clientX, event.clientY);
    if (!beat) return;
    pending = { id: event.pointerId, bar, beat, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, vx: event.clientX, vy: event.clientY, time: event.timeStamp, active: false, fine: false };
    pending.hold = setTimeout(() => { if (pending) { pending.active = true; drawPreview(); dwell(); } }, 380);
  }, true);
  on(doc, 'pointermove', event => {
    const p = pending; if (!p || event.pointerId !== p.id) return;
    event.stopImmediatePropagation();
    const dx = event.clientX - p.x, dy = event.clientY - p.y;
    if (!p.active) {
      if (Math.hypot(event.clientX - p.startX, event.clientY - p.startY) > 10) cancel(true);
      return;
    }
    const hit = lensHit(event);
    if (hit) {
      p.beat = hit; preview.firstElementChild.textContent = label(hit);
      for (const cell of preview.querySelectorAll('.beat-precision-cell')) cell.dataset.current = String(lensTargets.get(cell) === hit);
      return;
    }
    // Vertical motion remains a page-pan escape, even after magnification.
    if (Math.abs(event.clientY - p.startY) > 24 && Math.abs(event.clientY - p.startY) > Math.abs(event.clientX - p.startX) * 1.2) return cancel(true);
    const elapsed = Math.max(1, event.timeStamp - p.time);
    const speed = Math.hypot(dx, dy) / elapsed;
    p.slow = speed <= .18 ? (p.slow || 0) + Math.min(80, elapsed) : 0;
    if (p.slow >= 220) p.fine = true;
    if (speed > .6) p.fine = false;
    p.vx += dx / (p.fine ? 4 : 1); p.vy += dy / (p.fine ? 4 : 1);
    p.beat = nearest(p.bar, p.vx, p.vy, p.beat);
    p.x = event.clientX; p.y = event.clientY; p.time = event.timeStamp;
    drawPreview(); dwell();
  }, true);
  on(doc, 'pointerup', event => {
    const p = pending; if (!p || event.pointerId !== p.id) return;
    event.stopImmediatePropagation();
    const r = p.bar.getBoundingClientRect();
    const inside = event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
    const beat = lensHit(event) || (inside && valid(p.beat) ? p.beat : null); cancel(); select(beat);
  }, true);
  for (const name of ['contextmenu', 'dragstart']) on(interactionRoot, name, event => { if (enabled && event.target.closest?.('.bar-visual')) event.preventDefault(); }, true);
  on(interactionRoot, 'click', event => { if (enabled && event.target.closest?.('.bar-visual')) { event.stopImmediatePropagation(); event.preventDefault(); } }, true);
  on(edit, 'click', () => {
    if (!enabled || !valid(selected) || !allowed()) return;
    const bar = selected.closest('.bar-visual');
    SoundSettingsModal.show(Number(bar.dataset.containerIndex), selected.classList.contains('main-beat-marker') ? 'mainBeatSound' : 'subdivisionSound', { barIndex: Number(bar.dataset.barIndex), beatIndex: Number(selected.dataset.beatIndex) });
  });
  function step(direction) {
    if (!enabled) return;
    cancel();
    const beats = [...interactionRoot.querySelectorAll('.bar-visual .beat-square[data-beat-index]')];
    if (!beats.length) return select(null);
    const index = beats.indexOf(selected);
    select(beats[index < 0 ? direction > 0 ? 0 : beats.length - 1 : Math.max(0, Math.min(beats.length - 1, index + direction))]);
  }
  on(previous, 'click', () => step(-1)); on(next, 'click', () => step(1));
  on(group, 'keydown', event => {
    if (enabled && ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key)) { event.preventDefault(); step(['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1); }
  });
  on(doc, 'keydown', event => {
    if (!enabled || event.key !== 'Escape' || event.defaultPrevented) return;
    if (!pending && !preview && !group.contains(doc.activeElement)) return;
    event.preventDefault(); cancel(true, true);
  });
  on(doc, 'pointercancel', () => cancel(true), true);
  // Scrolling cancels a gesture/lens, not an already committed local target:
  // the user may need to scroll back to its explicit Edit action.
  on(doc, 'scroll', () => cancel(), true);
  on(window, 'resize', () => cancel(true));
  on(window, 'blur', () => cancel(true));
  on(doc, 'visibilitychange', () => cancel(true));
  on(doc, 'syncrolechange', event => { role = { state: event.detail?.state, isHost: event.detail?.isHost === true }; cancel(true); render(); });
  for (const name of ['roomauthoritychange', 'historyboundary', 'appstatechange', 'historyapplied', 'playbackstatechange']) on(doc, name, () => { cancel(true); render(); });
  const observer = new MutationObserver(records => {
    const targetBar = selected?.closest('.bar-visual') || pending?.bar;
    const changedTarget = targetBar && records.some(record => record.target === targetBar || targetBar.contains(record.target));
    if (changedTarget || !controlsRoot.isConnected || !interactionRoot.isConnected || selected && !valid(selected) || pending && !valid(pending.beat)) cancel(true);
  });
  observer.observe(interactionRoot, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-container-index', 'data-bar-index', 'data-beat-index'] });
  if (interactionRoot.parentNode) observer.observe(interactionRoot.parentNode, { childList: true });
  render();
  let destroyed = false;
  const controller = { destroy() { if (destroyed) return; destroyed = true; observer.disconnect(); listeners.forEach(remove => remove()); enabled = false; cancel(true); group.remove(); mounts.delete(controlsRoot); } };
  mounts.set(controlsRoot, controller); return controller;
}
