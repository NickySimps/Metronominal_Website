import AppState from './appState.js';
import SoundSettingsModal from './soundSettingsModal.js';

const mounts = new WeakMap();
/** Device-local targeting only. Call destroy() before removing the mount. */
export function initializeBeatPrecision(controlsRoot, interactionRoot = document.getElementById('all-tracks-wrapper')) {
  if (!controlsRoot?.append || !interactionRoot?.addEventListener) return null;
  if (mounts.has(controlsRoot)) return mounts.get(controlsRoot);
  const doc = controlsRoot.ownerDocument;
  controlsRoot.replaceChildren(); controlsRoot.hidden = true;
  const groups = new Map(), managed = new Map();
  let assist = true, selected = null, destroyed = false;
  let role = { state: doc.querySelector('#share-btn.connected') ? 'connected' : 'solo', isHost: window.isHost === true };
  const listeners = [];
  function on(target, name, handler, options) { target.addEventListener(name, handler, options); listeners.push(() => target.removeEventListener(name, handler, options)); }
  const valid = beat => beat?.isConnected && interactionRoot.contains(beat);
  const allowed = () => (role.state === 'solo' || role.isHost) && !AppState.isPlaying();
  const editing = () => doc.body.classList.contains('beat-edit-mode') && !doc.body.classList.contains('3dRoom-theme')
    && controlsRoot.isConnected && interactionRoot.isConnected && interactionRoot.getClientRects().length > 0;
  const enabled = () => editing() && allowed() && assist;
  function restoreBeat(beat, attrs) { for (const [name,value] of Object.entries(attrs)) value === null ? beat.removeAttribute(name) : beat.setAttribute(name,value); }
  function render() {
    if (destroyed) return;
    const shown = editing() && allowed(), tracks = new Set([...interactionRoot.querySelectorAll('.track')].filter(track=>track.querySelector('.beat-edit-btn')));
    for (const [track,ui] of groups) if (!tracks.has(track)) { ui.group.remove(); groups.delete(track); }
    for (const track of tracks) {
      let ui = groups.get(track);
      if (!ui) {
        const group = doc.createElement('div'); group.className = 'beat-precision'; group.setAttribute('aria-label','Beat targeting assistance');
        const toggle = doc.createElement('button'); toggle.type = 'button'; toggle.textContent = 'Precision'; toggle.dataset.beatPrecisionToggle = ''; toggle.setAttribute('aria-label','Precision beat selection');
        const status = doc.createElement('span'); status.className = 'beat-precision-hint'; status.setAttribute('role','status'); group.append(toggle,status);
        const anchor = track.querySelector('.track-sound-controls') || track.querySelector('.mode-buttons-col');
        if (anchor) anchor.after(group); else track.prepend(group);
        toggle.addEventListener('click',()=>{ cancel(true); assist = !assist; render(); });
        ui = {group,toggle,status}; groups.set(track,ui);
      }
      ui.group.hidden = !shown; ui.toggle.setAttribute('aria-pressed',String(assist));
      const hint = assist ? pending?.noSpace && pending.bar.closest('.track') === track ? 'Use arrow keys to target; Enter to edit' : 'Tap to edit · hold + slide to zoom' : 'Standard beat targeting';
      if (ui.status.textContent !== hint) ui.status.textContent = hint;
      const beats = [...track.querySelectorAll('.bar-visual .beat-square[data-beat-index]')], focusTarget = beats.includes(selected) ? selected : beats[0];
      for (const beat of beats) {
        if (shown) {
          if (!managed.has(beat)) managed.set(beat,Object.fromEntries(['tabindex','role','aria-label'].map(name=>[name,beat.getAttribute(name)])));
          beat.setAttribute('role','button'); beat.setAttribute('aria-label',`Edit ${label(beat)}`); beat.tabIndex = beat === focusTarget ? 0 : -1;
        } else if (managed.has(beat)) { restoreBeat(beat,managed.get(beat)); managed.delete(beat); }
      }
    }
    for (const [beat,attrs] of managed) if (!valid(beat)) { restoreBeat(beat,attrs); managed.delete(beat); }
    interactionRoot.classList.toggle('beat-precision-enabled',enabled());
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
    const track = selected?.closest('.track') || pending?.bar.closest('.track');
    if (pending) { clearTimeout(pending.hold); clearTimeout(pending.dwell); }
    pending = null; preview?.remove(); preview = null;
    if (clear) select(null);
    if (focus) groups.get(track)?.toggle.focus({ preventScroll: true });
  }
  function nearest(bar, x, y, current = null) {
    let best = current, distance = Infinity;
    const measure = beat => { const r = beat.getBoundingClientRect(); return Math.hypot(x - r.x - r.width / 2, y - r.y - r.height / 2); };
    for (const beat of bar.querySelectorAll('.beat-square[data-beat-index]')) { const d = measure(beat); if (d < distance) { best = beat; distance = d; } }
    return current && best !== current && measure(current) - distance < 4 ? current : best;
  }
  function drawPreview() {
    if (!pending || !enabled() || !valid(pending.beat)) return cancel(true);
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
      cell.setAttribute('aria-label', `Edit beat ${Number(beat.dataset.beatIndex) + 1}`); lensTargets.set(cell, beat);
      cell.addEventListener('click', () => { cancel(); openBeat(beat); });
      cell.dataset.current = String(beat === p.beat); row.append(cell);
    }
    const h = preview.getBoundingClientRect().height;
    const y = rect.top >= h + 16 ? rect.top - h - 12 : rect.bottom + h + 16 <= window.innerHeight ? rect.bottom + 12 : null;
    if (y === null) { p.noSpace = true; preview.remove(); preview = null; const ui = groups.get(p.bar.closest('.track')); if (ui && ui.status.textContent !== 'Use arrow keys to target; Enter to edit') ui.status.textContent = 'Use arrow keys to target; Enter to edit'; return; }
    p.noSpace = false;
    const ui = groups.get(p.bar.closest('.track'));
    if (ui && ui.status.textContent !== 'Tap to edit · hold + slide to zoom') ui.status.textContent = 'Tap to edit · hold + slide to zoom';
    preview.style.top = `${y}px`; preview.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - preview.getBoundingClientRect().width - 8))}px`;
  }
  function dwell() {
    if (!pending) return;
    clearTimeout(pending.dwell);
    pending.dwell = setTimeout(() => { if (pending?.active) { pending.fine = true; drawPreview(); } }, 280);
  }
  on(doc, 'pointerdown', event => { if (pending && (event.pointerId !== pending.id || event.isPrimary === false || !interactionRoot.contains(event.target) && !preview?.contains(event.target))) cancel(true); }, true);
  on(interactionRoot, 'pointerdown', event => {
    if (!editing() || event.button > 0) return;
    const bar = event.target.closest?.('.bar-visual'); if (!bar || !interactionRoot.contains(bar)) return;
    if (!allowed()) { event.stopImmediatePropagation(); cancel(true); return; }
    if (!enabled()) return;
    event.stopImmediatePropagation(); cancel();
    if (event.isPrimary === false) return;
    const beat = event.target.closest('.beat-square') || nearest(bar, event.clientX, event.clientY);
    if (!beat) return;
    pending = { id: event.pointerId, bar, beat, trackId: bar.dataset.containerIndex, barId: bar.dataset.barIndex, topology: [...bar.querySelectorAll('.beat-square')].map(b=>[b,b.dataset.beatIndex]), x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, vx: event.clientX, vy: event.clientY, time: event.timeStamp, active: false, fine: false };
    pending.hold = setTimeout(() => { if (pending) { pending.active = true; drawPreview(); dwell(); } }, 380);
  }, true);
  on(doc, 'pointermove', event => {
    const p = pending; if (!p || event.pointerId !== p.id) return;
    event.stopImmediatePropagation();
    const dx = event.clientX - p.x, dy = event.clientY - p.y;
    if (!enabled()) return cancel(true);
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
    const unchanged = p.bar.dataset.containerIndex === p.trackId && p.bar.dataset.barIndex === p.barId && p.topology.every(([b,id])=>b.isConnected && b.closest('.bar-visual') === p.bar && b.dataset.beatIndex === id);
    const beat = unchanged && enabled() ? lensHit(event) || (inside && valid(p.beat) ? p.beat : null) : null; cancel(); if (beat) openBeat(beat);
  }, true);
  for (const name of ['contextmenu', 'dragstart']) on(interactionRoot, name, event => { if (enabled() && event.target.closest?.('.bar-visual')) event.preventDefault(); }, true);
  on(interactionRoot, 'click', event => { if (editing() && event.target.closest?.('.bar-visual') && (!allowed() || assist)) { event.stopImmediatePropagation(); event.preventDefault(); if (allowed() && event.detail === 0) openBeat(event.target.closest('.beat-square')); } }, true);
  function openBeat(beat) {
    if (!editing() || !valid(beat) || !allowed()) return;
    select(beat);
    const bar = selected.closest('.bar-visual');
    SoundSettingsModal.show(Number(bar.dataset.containerIndex), selected.classList.contains('main-beat-marker') ? 'mainBeatSound' : 'subdivisionSound', { barIndex: Number(bar.dataset.barIndex), beatIndex: Number(selected.dataset.beatIndex) });
  }
  function step(direction, target) {
    if (!editing() || !allowed()) return;
    cancel();
    const track = target?.closest('.track') || selected?.closest('.track');
    if (!track) return;
    const beats = [...track.querySelectorAll('.bar-visual .beat-square[data-beat-index]')];
    if (!beats.length) return select(null);
    const index = beats.indexOf(target?.classList.contains('beat-square') ? target : selected);
    select(beats[index < 0 ? direction > 0 ? 0 : beats.length - 1 : Math.max(0, Math.min(beats.length - 1, index + direction))]);
    selected?.focus();
  }
  on(interactionRoot, 'keydown', event => {
    if (event.defaultPrevented || !editing() || !allowed()) return;
    const beat = event.target.closest?.('.beat-square'), group = event.target.closest?.('.beat-precision'); if (!beat && !group) return;
    if (beat && ['Enter',' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); openBeat(beat); }
    else if (['ArrowLeft','ArrowUp','ArrowRight','ArrowDown'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); step(['ArrowLeft','ArrowUp'].includes(event.key) ? -1 : 1, beat || group); }
  }, true);
  on(doc, 'keydown', event => {
    if (!editing() || event.key !== 'Escape' || event.defaultPrevented) return;
    if (!pending && !preview && ![...groups.values()].some(ui=>ui.group.contains(doc.activeElement)) && !doc.activeElement?.classList.contains('beat-square')) return;
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
    if (!controlsRoot.isConnected || !interactionRoot.isConnected) return controller.destroy();
    if (changedTarget || selected && !valid(selected) || pending && !valid(pending.beat)) cancel(true);
    render();
  });
  observer.observe(interactionRoot, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-container-index', 'data-bar-index', 'data-beat-index'] });
  if (interactionRoot.parentNode) observer.observe(interactionRoot.parentNode, { childList: true });
  let wasEditing = editing();
  const themeObserver = new MutationObserver(()=>{ const now = editing(); if (now !== wasEditing) { wasEditing = now; cancel(true); } render(); if (pending?.active) drawPreview(); });
  themeObserver.observe(doc.body,{attributes:true,attributeFilter:['class']}); themeObserver.observe(doc.documentElement,{attributes:true,attributeFilter:['style','class']});
  if (doc.fonts?.addEventListener) on(doc.fonts,'loadingdone',()=>{ if (pending?.active) drawPreview(); });
  const controller = { destroy() { if (destroyed) return; destroyed = true; observer.disconnect(); themeObserver.disconnect(); listeners.forEach(remove => remove()); cancel(true); for (const [b,a] of managed) restoreBeat(b,a); managed.clear(); for (const ui of groups.values()) ui.group.remove(); groups.clear(); interactionRoot.classList.remove('beat-precision-enabled'); mounts.delete(controlsRoot); } };
  render(); mounts.set(controlsRoot, controller); return controller;
}
