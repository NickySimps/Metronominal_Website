import AppState from './appState.js';
import BarDisplayController from './barDisplayController.js';
import { beginEditTransaction, commitEditTransaction, interruptEditTransaction } from './editHistory.js';
import { beginInteractionHold, beginInteractionDrag, emitInteractionMotion } from './interactionMotion.js';

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
  const BEAT = '.beat-square[data-beat-index]:not(.removing-beat-animation)';
  const retired = record => record.type === 'childList' && !record.addedNodes.length && record.removedNodes.length > 0 && [...record.removedNodes].every(n => n.nodeType === 1 && n.matches('.beat-square.removing-beat-animation'));
  const valid = beat => beat?.isConnected && !beat.classList?.contains('removing-beat-animation') && interactionRoot.contains(beat);
  const allowed = () => (role.state === 'solo' || role.isHost) && !AppState.isPlaying();
  const mode = () => AppState.isSliceMode?.() ? 'slice' : AppState.isRestMode() ? 'rest' : AppState.isAccentMode() ? 'accent' : doc.body.classList.contains('beat-edit-mode') ? 'edit' : 'normal';
  const editing = () => !doc.body.classList.contains('3dRoom-theme')
    && controlsRoot.isConnected && interactionRoot.isConnected && interactionRoot.getClientRects().length > 0;
  const rangePicking = () => interactionRoot.hasAttribute('data-range-selection');
  const enabled = () => editing() && allowed() && assist && !rangePicking();
  function restoreBeat(beat, attrs) {
    for (const [name,original] of Object.entries(attrs)) {
      let value=original;
      if(name==='aria-label') {
        // Musical state can change while assistance owns the accessible name.
        // Restore current slice information, not the pre-edit cached label.
        if(beat.dataset.sliceCount) value=`Beat ${Number(beat.dataset.beatIndex)+1}, ${beat.dataset.sliceCount} slices`;
        else if(/^Beat \d+, \d+ slices$/.test(value||'')) value=null;
      }
      value===null?beat.removeAttribute(name):beat.setAttribute(name,value);
    }
  }
  function render() {
    if (destroyed) return;
    const shown = editing() && mode() !== 'normal' && allowed(), tracks = new Set([...interactionRoot.querySelectorAll('.track')].filter(track=>track.querySelector('.beat-edit-btn')));
    for (const [track,ui] of groups) if (!tracks.has(track)) { ui.group.remove(); groups.delete(track); }
    for (const track of tracks) {
      let ui = groups.get(track);
      if (!ui) {
        const group = doc.createElement('div'); group.className = 'beat-precision'; group.setAttribute('aria-label','Beat targeting assistance');
        const toggle = doc.createElement('button'); toggle.type = 'button'; toggle.textContent = 'Precision'; toggle.dataset.beatPrecisionToggle = ''; toggle.setAttribute('aria-label','Precision beat selection');
        const status = doc.createElement('span'); status.className = 'beat-precision-hint'; status.setAttribute('role','status'); group.append(toggle,status);
        const anchor = track.querySelector('.track-sound-controls') || track.querySelector('.mode-buttons-col');
        if (anchor) anchor.after(group); else track.prepend(group);
        toggle.addEventListener('click',()=>{ cancel(true); assist = !assist; render(); emitInteractionMotion(toggle, 'toggle'); });
        ui = {group,toggle,status}; groups.set(track,ui);
      }
      ui.group.hidden = !shown; ui.toggle.setAttribute('aria-pressed',String(assist));
      const hint = assist ? 'Tap to '+(mode()==='edit'?'edit':mode())+' · hold for subdivisions · slow slide to zoom · '+(mode()==='edit'?'fast slide to choose':'fast slide to paint') : 'Standard beat targeting';
      if (ui.status.textContent !== hint) ui.status.textContent = hint;
      const beats = [...track.querySelectorAll(`.bar-visual ${BEAT}`)], focusTarget = beats.includes(selected) ? selected : beats[0];
      for (const beat of beats) {
        if (editing() && allowed()) {
          if (!managed.has(beat)) managed.set(beat,Object.fromEntries(['tabindex','role','aria-label'].map(name=>[name,beat.getAttribute(name)])));
          beat.setAttribute('role','button'); beat.setAttribute('aria-label',`${mode() === 'normal' ? 'Select' : mode() === 'edit' ? 'Edit' : mode()} ${label(beat)}${beat.dataset.sliceCount ? `, ${beat.dataset.sliceCount} slices` : ''}`); beat.tabIndex = beat === focusTarget ? 0 : -1;
        } else if (managed.has(beat)) { restoreBeat(beat,managed.get(beat)); managed.delete(beat); }
      }
    }
    for (const [beat,attrs] of managed) if (!valid(beat)) { restoreBeat(beat,attrs); managed.delete(beat); }
    interactionRoot.classList.toggle('beat-precision-enabled',enabled());
    interactionRoot.classList.toggle('beat-precision-editing',enabled() && mode() !== 'normal');
  }
  function select(beat) { selected?.classList.remove('beat-precision-selected'); selected = valid(beat) ? beat : null; selected?.classList.add('beat-precision-selected'); render(); }
  let pending = null, preview = null, picker = null;
  const lensTargets = new WeakMap();
  const lensHit = event => {
    const cell = doc.elementFromPoint(event.clientX, event.clientY)?.closest('.beat-precision-cell');
    return cell && preview?.contains(cell) ? lensTargets.get(cell) : null;
  };
  const label = beat => { const bar = beat.closest('.bar-visual'); return `Track ${Number(bar.dataset.containerIndex) + 1} · Bar ${Number(bar.dataset.barIndex) + 1} · Beat ${Number(beat.dataset.beatIndex) + 1}`; };
  function cancel(clear = false, focus = false) {
    const track = selected?.closest('.track') || pending?.bar.closest('.track') || doc.activeElement?.closest?.('.track'), painting = pending?.phase === 'paint';
    if (pending) { clearTimeout(pending.hold); clearTimeout(pending.dwell); pending.holdMotion?.cancel?.(); pending.holdMotion = null; pending.paintMotion?.cancel(); pending.paintMotion = null; if (pending.transaction) commitEditTransaction(pending.transaction); }
    if (picker) { BarDisplayController.cancelSubdivisionGesture(); picker = null; }
    pending = null;
    if (preview) { emitInteractionMotion(preview, clear ? 'cancel' : 'close'); preview.remove(); preview = null; }
    if (clear) select(null); else if (painting) render();
    const ui = focus ? groups.get(track) : null;
    if (ui && !ui.group.hidden) ui.toggle.focus({ preventScroll: true });
  }
  function nearest(bar, x, y, current = null) {
    let best = current, distance = Infinity;
    const measure = beat => { const r = beat.getBoundingClientRect(); return Math.hypot(x - r.x - r.width / 2, y - r.y - r.height / 2); };
    for (const beat of bar.querySelectorAll(BEAT)) { const d = measure(beat); if (d < distance) { best = beat; distance = d; } }
    return current && best !== current && measure(current) - distance < 4 ? current : best;
  }
  const captureScene=()=>[...interactionRoot.querySelectorAll('.bar-visual')].map(bar=>({bar,parent:bar.parentElement,track:bar.dataset.containerIndex,index:bar.dataset.barIndex,beats:[...bar.querySelectorAll(BEAT)].map(b=>[b,b.dataset.beatIndex])}));
  function sameTarget(p) {
    const scene=captureScene();
    if(p.scene && (scene.length!==p.scene.length || p.scene.some((saved,i)=>{
      const now=scene[i];return saved.bar!==now.bar||saved.parent!==now.parent||saved.track!==now.track||saved.index!==now.index||saved.beats.length!==now.beats.length||saved.beats.some(([b,id],j)=>b!==now.beats[j][0]||id!==now.beats[j][1]);
    }))) return false;
    const beats = [...p.bar.querySelectorAll(BEAT)];
    return valid(p.bar) && valid(p.beat) && p.bar.dataset.containerIndex === p.trackId && p.bar.dataset.barIndex === p.barId && beats.length === p.topology.length
      && p.topology.every(([b,id],i)=>b === beats[i] && valid(b) && b.dataset.beatIndex === id);
  }
  function drawPreview() {
    if (pending?.phase !== 'precision') return;
    if (!pending || !enabled() || mode() !== pending.mode || !valid(pending.beat) || !sameTarget(pending)) return cancel(true);
    const p = pending, rect = p.beat.getBoundingClientRect(), opened = !preview;
    const nextScale = p.fine ? 'fine' : 'coarse', scaleChanged = !opened && preview.dataset.scale !== nextScale;
    if (!preview) { preview = doc.createElement('aside'); preview.className = 'beat-precision-preview'; preview.dataset.beatPrecisionLens = ''; preview.setAttribute('aria-label', 'Magnified nearby beats'); doc.body.append(preview); }
    preview.dataset.scale = nextScale; preview.replaceChildren();
    const heading = doc.createElement('div'); heading.textContent = label(p.beat); preview.append(heading);
    const row = doc.createElement('div'); row.className = 'beat-precision-cells'; preview.append(row);
    const beats = [...p.bar.querySelectorAll(BEAT)], index = beats.indexOf(p.beat);
    const count = Math.max(1, Math.min(5, Math.floor((window.innerWidth - 40) / (p.fine ? 64 : 48))));
    const start = Math.max(0, Math.min(index - Math.floor(count / 2), beats.length - count));
    for (const beat of beats.slice(start, start + count)) {
      const cell = doc.createElement('button'); cell.type = 'button'; cell.className = 'beat-precision-cell'; cell.textContent = String(Number(beat.dataset.beatIndex) + 1);
      cell.setAttribute('aria-label', `${mode()==='edit'?'Edit':mode()==='normal'?'Select':mode()} beat ${Number(beat.dataset.beatIndex) + 1}`);
      const indicators = [beat.classList.contains('rested') ? 'Rest' : beat.classList.contains('accent-note') ? 'Accent' : beat.classList.contains('ghost-note') ? 'Ghost' : beat.classList.contains('main-beat-marker') ? 'Main' : 'Beat', beat.dataset.sliceCount ? `${beat.dataset.sliceCount} slices` : '', beat.classList.contains('beat-edited') ? 'Edited' : ''].filter(Boolean).join(' · ');
      const detail = doc.createElement('small');
      detail.textContent = [beat.classList.contains('rested') ? 'Rest' : beat.classList.contains('accent-note') ? '▲' : beat.classList.contains('ghost-note') ? '◦' : beat.classList.contains('main-beat-marker') ? '●' : '•', beat.dataset.sliceCount ? `×${beat.dataset.sliceCount}` : '', beat.classList.contains('beat-edited') ? '✦' : ''].filter(Boolean).join(' ');
      cell.setAttribute('aria-description',indicators); cell.append(detail); cell.title = indicators; lensTargets.set(cell, beat);
      cell.addEventListener('click', () => { cancel(); openBeat(beat); });
      cell.dataset.current = String(beat === p.beat); row.append(cell);
    }
    // Position around the finger/actual cell, never around the entire tall bar.
    // A lens may cover distant source rows; it must not disappear on phones.
    const bounds = window.visualViewport;
    const left = bounds?.offsetLeft || 0, top = bounds?.offsetTop || 0;
    const width = bounds?.width || window.innerWidth, height = bounds?.height || window.innerHeight;
    preview.style.maxWidth = `${Math.max(44,width-16)}px`;
    const box = preview.getBoundingClientRect(), w = box.width, h = box.height;
    const clamp = (v,min,max) => Math.max(min,Math.min(v,Math.max(min,max)));
    const minX = left+8, minY=top+8, maxX=left+width-w-8, maxY=top+height-h-8;
    const fx=p.x, fy=p.y;
    const avoid={left:Math.min(rect.left,fx-24),right:Math.max(rect.right,fx+24),top:Math.min(rect.top,fy-28),bottom:Math.max(rect.bottom,fy+28)};
    const centered=clamp(fx-w/2,minX,maxX);
    const candidates=[
      [centered,avoid.top-h-12],[centered,avoid.bottom+12],
      [avoid.left-w-12,clamp(fy-h/2,minY,maxY)],[avoid.right+12,clamp(fy-h/2,minY,maxY)],
      [minX,minY],[maxX,minY],[minX,maxY],[maxX,maxY]
    ];
    const overlap = (x,y,r) => Math.max(0,Math.min(x+w,r.right)-Math.max(x,r.left))*Math.max(0,Math.min(y+h,r.bottom)-Math.max(y,r.top));
    const ranked=candidates.map(([x,y],i)=>{x=clamp(x,minX,maxX);y=clamp(y,minY,maxY);return {x,y,score:overlap(x,y,avoid)*100+i};}).sort((a,b)=>a.score-b.score);
    preview.style.top=`${ranked[0].y}px`;preview.style.left=`${ranked[0].x}px`;
    if (opened) emitInteractionMotion(preview, 'open');
    else if (scaleChanged) emitInteractionMotion(preview, 'adjust');
  }
  // Intersect each delivered segment with actual CSS cell rectangles. This
  // covers skipped pointer samples without drawing a bounding-box rectangle
  // across other rows. Entry ordering preserves the source stroke intent.
  function crossed(from, to) {
    const dx=to.x-from.x, dy=to.y-from.y, hits=[];
    for(const beat of interactionRoot.querySelectorAll(`.bar-visual ${BEAT}`)) {
      const r=beat.getBoundingClientRect(); let lo=0,hi=1;
      for(const [origin,delta,min,max] of [[from.x,dx,r.left,r.right],[from.y,dy,r.top,r.bottom]]) {
        if(delta===0){if(origin<min||origin>max){hi=-1;break;}}
        else {const a=(min-origin)/delta,b=(max-origin)/delta;lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));}
      }
      if(lo<=hi) hits.push({beat,t:lo});
    }
    return hits.sort((a,b)=>a.t-b.t).map(hit=>hit.beat);
  }
  function paintPath(p, path) {
    if(!['rest','accent','slice'].includes(p.mode)) {
      const point=path.at(-1), beat=nearest(interactionRoot,point.x,point.y,p.beat), bar=beat?.closest('.bar-visual');
      if(beat&&bar){p.beat=beat;p.bar=bar;p.trackId=bar.dataset.containerIndex;p.barId=bar.dataset.barIndex;p.topology=[...bar.querySelectorAll(BEAT)].map(b=>[b,b.dataset.beatIndex]);}
      return;
    }
    if(!p.transaction) { p.transaction=beginEditTransaction(`Paint ${p.mode}`); if(!p.transaction) return cancel(true); }
    p.visited ||= new Set();
    for(let i=1;i<path.length;i++) for(const beat of crossed(path[i-1],path[i])) {
      const bar=beat.closest('.bar-visual');
      if(pending!==p||!bar||!enabled()||mode()!==p.mode||!sameTarget(p)) return cancel(true);
      const key=`${bar.dataset.containerIndex}:${bar.dataset.barIndex}:${beat.dataset.beatIndex}`;
      if(p.visited.has(key)) continue;
      // Never drain a pre-existing external mutation as if this action owned it.
      if(observer.takeRecords().some(record=>!retired(record)&&interactionRoot.contains(record.target))) return cancel(true);
      p.expectedMutation={label:p.mode==='slice'?'setBeatSlices':'updateTrack',track:Number(bar.dataset.containerIndex),bar:Number(bar.dataset.barIndex),beat:Number(beat.dataset.beatIndex)};
      const result=BarDisplayController.applyBeatAction(beat,{mode:p.mode,paint:p.intent});
      p.expectedMutation=null;
      const ownRecords=observer.takeRecords();
      // updateBar only owns indicator text and slice badge children. Rebase
      // exactly these writes, not arbitrary topology or application events.
      const owned=record=>retired(record) || record.type==='childList' && (
        record.target===bar.querySelector('.bar-beat-indicator') && [...record.addedNodes,...record.removedNodes].every(n=>n.nodeType===3)
        || record.target.matches?.(BEAT) && record.target.closest('.bar-visual')===bar && [...record.addedNodes,...record.removedNodes].every(n=>n.nodeType===1&&n.matches('.slice-count-badge')));
      if(pending!==p||!result||!sameTarget(p)||ownRecords.some(record=>!owned(record))) return cancel(true);
      p.intent ||= {action:result.action,velocity:result.velocity}; p.visited.add(key); p.beat=beat; p.bar=bar;
      p.trackId=bar.dataset.containerIndex; p.barId=bar.dataset.barIndex;
      p.topology=[...bar.querySelectorAll(BEAT)].map(b=>[b,b.dataset.beatIndex]);
    }
  }
  function updatePaintMotion(p, x, y) {
    if (pending !== p || p.phase !== 'paint' || !sameTarget(p)) return;
    // Per-cell confirmations can evict an older decoration at the shared cap.
    // Recreate only this contact's inert cursor; never retain a stale owner.
    if (p.paintMotion?.move(x, y)) return;
    p.paintMotion = beginInteractionDrag(p.beat, { x, y });
  }
  function dwell() {
    if (!pending) return;
    clearTimeout(pending.dwell);
    pending.dwell = setTimeout(() => { if (pending?.active) { pending.fine = true; drawPreview(); } }, 280);
  }
  on(doc, 'pointerdown', event => { if (pending && (event.pointerId !== pending.id || event.isPrimary === false || !interactionRoot.contains(event.target) && !preview?.contains(event.target))) cancel(true); }, true);
  on(interactionRoot, 'pointerdown', event => {
    if (rangePicking()) { cancel(true); return; }
    if (!editing() || event.button > 0) return;
    const beat = event.target.closest?.(BEAT);
    const bar = event.target.closest?.('.bar-visual'); if (!bar || !interactionRoot.contains(bar)) return;
    if (!allowed()) { event.stopImmediatePropagation(); cancel(true); return; }
    if (!enabled() || !beat && mode() === 'normal') return;
    event.stopImmediatePropagation(); cancel();
    if (event.isPrimary === false) return;
    if (!beat) return;
    pending = { id: event.pointerId, mode:mode(), scene:captureScene(), bar, beat, trackId: bar.dataset.containerIndex, barId: bar.dataset.barIndex, topology: [...bar.querySelectorAll(BEAT)].map(b=>[b,b.dataset.beatIndex]), x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, vx: event.clientX, vy: event.clientY, time: event.timeStamp, startTime: event.timeStamp, samples: 0, distance: 0, path: [{x:event.clientX,y:event.clientY,time:event.timeStamp}], active: false, fine: false, holdMotion: beginInteractionHold(beat, { duration: 380, x: event.clientX, y: event.clientY }) };
    pending.hold = setTimeout(() => {
      const p = pending;
      if (!p || !enabled() || mode() !== p.mode || !sameTarget(p)) return cancel(true);
      p.holdMotion?.finish?.(); p.holdMotion = null;
      p.active = true; p.phase = 'picker'; picker = p;
      BarDisplayController.beginSubdivisionGesture(p.bar, () => enabled() && mode() === p.mode && sameTarget(p));
    }, 380);
  }, true);
  function movePointer(event) {
    const p = pending; if (!p || event.pointerId !== p.id) return;
    const dx = event.clientX - p.x, dy = event.clientY - p.y;
    if (!enabled() || mode() !== p.mode || !sameTarget(p)) return cancel(true);
    if (!p.active) {
      const distance = Math.hypot(dx,dy), elapsed = event.timeStamp-p.startTime, segment = event.timeStamp-p.time;
      if (distance > 0 && segment > 0) { p.samples++; p.distance += distance; }
      const speed = Math.max(elapsed > 0 ? p.distance / elapsed : 0, distance > 0 && segment > 0 ? distance / segment : 0);
      p.path.push({x:event.clientX,y:event.clientY,time:event.timeStamp});
      p.x=event.clientX; p.y=event.clientY; p.time=event.timeStamp;
      if (Math.hypot(p.x-p.startX,p.y-p.startY) <= 10) return;
      p.moved = true;
      // Normal-mode vertical movement belongs to native scrolling, not an
      // editing lane. Explicit edit modes retain direct grid manipulation.
      if (p.mode === 'normal' && Math.abs(p.y-p.startY) > Math.abs(p.x-p.startX)) { cancel(); return; }
      clearTimeout(p.hold); p.holdMotion?.cancel?.(); p.holdMotion = null;
      if (p.samples >= 1 && elapsed >= 16 && p.distance >= 24 && speed >= .6) {
        p.active=true; p.phase='paint'; paintPath(p,p.path);p.path=null;updatePaintMotion(p,event.clientX,event.clientY);return;
      }
      if (p.samples < 2 || elapsed < 40 || speed > .6) return;
      // Precision is an explicit phase lock: later fast movement only navigates
      // its preview, never starts a surprise multi-beat paint stroke.
      p.active=true; p.phase='precision';
      p.vx=p.x; p.vy=p.y; p.beat=nearest(p.bar,p.vx,p.vy,p.beat);
      drawPreview(); dwell(); return;
    }
    if (p.phase === 'picker') {
      const option = BarDisplayController.moveSubdivisionGesture(event.clientX, event.clientY);
      if (option) p.pickerVisited = true;
      // A stationary hold owns this entire contact, including source/padding
      // crossed en route to an option. Only release/cancel can leave the picker.
      return;
    }
    if (p.phase === 'paint') {
      paintPath(p,[{x:p.x,y:p.y},{x:event.clientX,y:event.clientY}]);
      updatePaintMotion(p,event.clientX,event.clientY);
      p.x=event.clientX;p.y=event.clientY;p.time=event.timeStamp;return;
    }
    const hit = lensHit(event);
    if (hit) {
      p.beat = hit;
      const r=hit.getBoundingClientRect();p.vx=r.x+r.width/2;p.vy=r.y+r.height/2;
      p.x=event.clientX;p.y=event.clientY;p.time=event.timeStamp;
      preview.firstElementChild.textContent = label(hit);
      for (const cell of preview.querySelectorAll('.beat-precision-cell')) cell.dataset.current = String(lensTargets.get(cell) === hit);
      return;
    }
    // After deliberate activation the lens owns fine movement on both axes.
    // Before activation native pan/pinch remains untouched.
    const elapsed = Math.max(1, event.timeStamp - p.time);
    const speed = Math.hypot(dx, dy) / elapsed;
    p.slow = speed <= .18 ? (p.slow || 0) + Math.min(80, elapsed) : 0;
    if (p.slow >= 220) p.fine = true;
    if (speed > .6) p.fine = false;
    p.vx += dx / (p.fine ? 4 : 1); p.vy += dy / (p.fine ? 4 : 1);
    p.beat = nearest(p.bar, p.vx, p.vy, p.beat);
    p.x = event.clientX; p.y = event.clientY; p.time = event.timeStamp;
    drawPreview(); dwell();
  }
  on(doc, 'pointermove', event => {
    if (!pending || event.pointerId !== pending.id) return;
    event.stopImmediatePropagation();
    const samples = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    for (const sample of samples) {
      if (!pending) break;
      movePointer(sample);
    }
    const last = samples.at(-1);
    if (!last || last.clientX !== event.clientX || last.clientY !== event.clientY || last.timeStamp !== event.timeStamp) movePointer(event);
  }, true);
  on(doc, 'pointerup', event => {
    const p = pending; if (!p || event.pointerId !== p.id) return;
    event.stopImmediatePropagation();
    if (p.phase === 'picker') {
      clearTimeout(p.hold); p.holdMotion?.cancel?.(); p.holdMotion = null; pending = null;
      if (!enabled() || mode() !== p.mode || !sameTarget(p)) cancel(true);
      else if (p.pickerVisited) { if (BarDisplayController.moveSubdivisionGesture(event.clientX,event.clientY)) void BarDisplayController.commitSubdivisionGesture(); else cancel(true); }
      return;
    }
    if (p.phase === 'paint' && ['rest','accent','slice'].includes(p.mode)) {
      if (enabled() && mode()===p.mode && sameTarget(p)) paintPath(p,[{x:p.x,y:p.y},{x:event.clientX,y:event.clientY}]);
      cancel();return;
    }
    if (p.phase === 'paint' && p.mode === 'edit') {
      const hit = enabled() && mode() === p.mode && sameTarget(p) ? doc.elementFromPoint(event.clientX, event.clientY)?.closest(BEAT) : null;
      const beat = valid(hit) ? hit : null;
      cancel(); if (beat) openBeat(beat); return;
    }
    if (!p.active && (p.moved || Math.hypot(event.clientX-p.startX,event.clientY-p.startY) > 10)) { cancel(); return; }
    const r = p.bar.getBoundingClientRect();
    const inside = event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
    const unchanged = sameTarget(p);
    const beat = unchanged && enabled() && mode() === p.mode ? lensHit(event) || (inside && valid(p.beat) ? p.beat : null) : null; cancel(); if (beat) openBeat(beat);
  }, true);
  for (const name of ['contextmenu', 'dragstart']) on(interactionRoot, name, event => { if (enabled() && event.target.closest?.('.bar-visual')) event.preventDefault(); }, true);
  on(interactionRoot, 'click', event => { const beat = event.target.closest?.(BEAT); if (!rangePicking() && editing() && beat && (!allowed() || assist)) { event.stopImmediatePropagation(); event.preventDefault(); if (allowed() && event.detail === 0) openBeat(beat); } }, true);
  function openBeat(beat) {
    if (!editing() || !valid(beat) || !allowed()) return;
    const currentMode = mode(), musical = ['rest', 'accent', 'slice'].includes(currentMode);
    const transaction = musical ? beginEditTransaction(`Beat ${currentMode}`) : null;
    if (musical && !transaction) return;
    let result = null;
    try {
      // Clear gesture ownership before the shared action notifies application state.
      result = BarDisplayController.applyBeatAction(beat);
    } finally {
      if (transaction) commitEditTransaction(transaction);
    }
    if (result && valid(beat)) select(beat);
  }
  function step(direction, target) {
    if (!editing() || !allowed()) return;
    cancel();
    const track = target?.closest('.track') || selected?.closest('.track');
    if (!track) return;
    const beats = [...track.querySelectorAll(`.bar-visual ${BEAT}`)];
    if (!beats.length) return select(null);
    const previous = target?.matches?.(BEAT) ? target : selected;
    const index = beats.indexOf(previous);
    select(beats[index < 0 ? direction > 0 ? 0 : beats.length - 1 : Math.max(0, Math.min(beats.length - 1, index + direction))]);
    selected?.focus();
    if (selected && selected !== previous) emitInteractionMotion(selected, 'select');
  }
  on(interactionRoot, 'keydown', event => {
    if (event.defaultPrevented || rangePicking() || !editing() || !allowed()) return;
    const beat = event.target.closest?.(BEAT), group = event.target.closest?.('.beat-precision'); if (!beat && !group) return;
    if (beat && ['Enter',' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); openBeat(beat); }
    else if (['ArrowLeft','ArrowUp','ArrowRight','ArrowDown'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); step(['ArrowLeft','ArrowUp'].includes(event.key) ? -1 : 1, beat || group); }
  }, true);
  on(doc, 'keydown', event => {
    if (!editing() || event.key !== 'Escape' || event.defaultPrevented) return;
    if (!pending && !preview && ![...groups.values()].some(ui=>ui.group.contains(doc.activeElement)) && !doc.activeElement?.matches?.(BEAT)) return;
    // An open lens already owns its cancellation cue. Keyboard-only targets
    // have no lens, so acknowledge their release without changing edit ownership.
    const released = !preview && (pending?.beat || selected);
    if (valid(released)) emitInteractionMotion(released, 'cancel');
    event.preventDefault(); cancel(true, true);
  });
  on(interactionRoot, 'touchmove', event => {
    if (event.touches.length !== 1) { cancel(true); return; }
    if (pending && (pending.active || pending.mode !== 'normal') && enabled() && mode() === pending.mode && event.cancelable) event.preventDefault();
  }, {capture:true,passive:false});
  on(interactionRoot, 'touchstart', event => { if (event.touches.length > 1) cancel(true); }, {capture:true,passive:true});
  on(doc, 'pointercancel', () => cancel(true), true);
  // Scrolling cancels a gesture/lens, not an already committed local target:
  // the user may need to scroll back to its explicit Edit action.
  on(doc, 'scroll', () => cancel(), true);
  on(window, 'resize', () => cancel(true));
  if (window.visualViewport) {
    on(window.visualViewport, 'resize', () => cancel(true));
    on(window.visualViewport, 'scroll', () => cancel());
  }
  on(window, 'blur', () => cancel(true));
  on(doc, 'visibilitychange', () => cancel(true));
  on(doc, 'syncrolechange', event => { role = { state: event.detail?.state, isHost: event.detail?.isHost === true }; cancel(true); render(); });
  for (const name of ['roomauthoritychange', 'historyboundary', 'appstatechange', 'historyapplied', 'playbackstatechange']) on(doc, name, () => { cancel(true); render(); });
  const observer = new MutationObserver(records => {
    const targetBar = selected?.closest('.bar-visual') || pending?.bar || picker?.bar;
    const changedTarget = targetBar && records.some(record => !retired(record) && (record.target === targetBar || targetBar.contains(record.target)));
    if (!controlsRoot.isConnected || !interactionRoot.isConnected) return controller.destroy();
    if (rangePicking() || changedTarget || selected && !valid(selected) || pending && !sameTarget(pending) || picker && !sameTarget(picker)) cancel(true);
    render();
  });
  observer.observe(interactionRoot, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-container-index', 'data-bar-index', 'data-beat-index', 'data-range-selection'] });
  if (interactionRoot.parentNode) observer.observe(interactionRoot.parentNode, { childList: true });
  const unsubscribeMutations=AppState.subscribeMusicalMutations(change=>{
    if(!pending) { if(picker) cancel(true); return; }
    const expected=pending.expectedMutation;
    if(expected && change.label===expected.label && change.args[0]===expected.track
      && (expected.label==='setBeatSlices' ? change.args[1]===expected.bar&&change.args[2]===expected.beat : Object.keys(change.args[1]||{}).join(',')==='barSettings')) {
      pending.expectedMutation=null;return;
    }
    if(pending.transaction) { interruptEditTransaction(pending.transaction,change); pending.transaction=null; }
    cancel(true);
  });
  let wasEditing = `${editing()}:${mode()}`;
  const themeObserver = new MutationObserver(()=>{ const now = `${editing()}:${mode()}`; if (now !== wasEditing) { wasEditing = now; cancel(true); } render(); if (pending?.active) drawPreview(); });
  themeObserver.observe(doc.body,{attributes:true,attributeFilter:['class']}); themeObserver.observe(doc.documentElement,{attributes:true,attributeFilter:['style','class']});
  if (doc.fonts?.addEventListener) on(doc.fonts,'loadingdone',()=>{ if (pending?.active) drawPreview(); });
  const controller = { destroy() { if (destroyed) return; destroyed = true; unsubscribeMutations(); observer.disconnect(); themeObserver.disconnect(); listeners.forEach(remove => remove()); cancel(true); for (const [b,a] of managed) restoreBeat(b,a); managed.clear(); for (const ui of groups.values()) ui.group.remove(); groups.clear(); interactionRoot.classList.remove('beat-precision-enabled','beat-precision-editing'); mounts.delete(controlsRoot); } };
  render(); mounts.set(controlsRoot, controller); return controller;
}
