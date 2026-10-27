import AppState from './appState.js';
import * as Room from './webrtc.js';
import { beginEditTransaction, commitEditTransaction, cancelEditTransaction } from './editHistory.js';
import { queueSongChange, getPendingSongChange, cancelPendingSongChange } from './practiceTransport.js';
import { getBeatSlots } from './beatTiming.js';

const mounted = new WeakMap();
const clone = value => JSON.parse(JSON.stringify(value));

/** Arrangement metadata and snapshots stay in AppState; this controller owns only gestures. */
export function initializeArrangementTimeline(root, options = {}) {
  if (!root) return null;
  if (mounted.has(root)) return mounted.get(root);
  const document = root.ownerDocument;
  root.classList.add('arrangement-timeline');
  const make = (tag, text, parent = root) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    parent.append(node); return node;
  };
  make('h3', 'Section arrangement');
  const position = make('p'); position.dataset.position = '';
  const viewport = make('div'); viewport.className = 'arrangement-scroll';
  viewport.tabIndex = 0; viewport.setAttribute('role', 'region'); viewport.setAttribute('aria-label', 'Section timeline, scroll horizontally');
  const list = make('ol', undefined, viewport); list.className = 'arrangement-sections';
  const ruler = make('div', undefined, viewport); ruler.className = 'arrangement-ruler';
  ruler.setAttribute('role','group'); ruler.setAttribute('aria-label','Choose loop A then B (inclusive bars)');
  const loopStatus = make('p'); loopStatus.dataset.loopStatus = '';
  let loopAnchor = null, gesture = null;
  const status = make('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const button = (text, parent, action) => {
    const node = make('button', text, parent); node.type = 'button';
    if (action) node.addEventListener('click', action); return node;
  };
  const liveLabel = make('label', 'Queue live arrangement edits');
  const live = make('input', undefined, liveLabel); live.type = 'checkbox';
  const pendingLabel = make('p'); pendingLabel.dataset.pending = '';
  const cancel = button('Cancel queued arrangement', root, () => {
    if (!allowed()) return;
    if (cancelPendingSongChange() === false) { announce('Cancellation was not accepted; draft retained.'); return; }
    generation++; busy = false; awaitingAuthority = false;
    render();
  });
  live.addEventListener('change', render);
  make('p', 'Drag handles or use Earlier/Later and length inputs. Growth inserts copies of the final section bar and shifts all following musical content. Shrinking and unequal track lengths are rejected to prevent data loss. Maximum: 64 bars / 32 sections.');
  let disposed = false, generation = 0, busy = false, rejectedDraft = null, awaitingAuthority = false;
  const allowed = () => !disposed && ['offline', 'host'].includes(Room.getSyncDiagnostics().role);
  const editable = () => allowed() && !busy && !awaitingAuthority && (!AppState.isPlaying() || live.checked);
  const stopped = () => allowed() && !busy && !AppState.isPlaying();
  const draftSong = () => clone(rejectedDraft || getPendingSongChange()?.song || AppState.getSong());
  const discard = button('Discard rejected draft', root, ()=>{rejectedDraft=null;render();});
  const announce = message => { status.textContent = message; };
  status.dataset.arrangementStatus = '';
  const barCount = () => AppState.getTracks()[0]?.barSettings?.length || 1;
  function validate(song, count = barCount()) {
    if (count < 1 || count > 64 || !song.sections?.length || song.sections.length > 32) throw new Error('Arrangement must have 1–64 bars and 1–32 sections.');
    song.sections.forEach((section, index) => {
      if (!section.name?.trim() || section.name.length > 48 || !Number.isInteger(section.tempo) || section.tempo < 20 || section.tempo > 300
        || !Number.isInteger(section.repeats) || section.repeats < 1 || section.repeats > 16
        || !Number.isInteger(section.startBar) || section.startBar < 0 || section.startBar >= count
        || (index === 0 ? section.startBar !== 0 : section.startBar <= song.sections[index - 1].startBar)) {
        throw new Error('Invalid arrangement: BPM must be 20–300, repeats 1–16, and section boundaries distinct within 64 bars.');
      }
    });
  }
  async function enqueue(song, intent = {}) {
    if (!allowed() || busy) return false;
    const expected = generation;
    try {
      const fallback = AppState.getMusicalSnapshot().Tracks;
      song = {...song,sections:song.sections.map(section=>section.tracks?.length ? section : {...section,tracks:clone(fallback)})};
      const intendedCount = Math.max(barCount(), ...song.sections.flatMap(section=>(section.tracks || []).map(track=>track.barSettings.length)));
      validate(song, intendedCount); busy = true; render();
      const result = await queueSongChange(song, intent);
      if (expected !== generation || !allowed() || disposed) return false;
      if (result?.status === 'awaiting-authority' && !getPendingSongChange()) {
        awaitingAuthority = true; rejectedDraft = clone(song);
        announce('Awaiting server authority. No scheduled change has been confirmed.'); return true;
      }
      if (result === false || !getPendingSongChange()) throw new Error('Core transport did not accept a queued change.');
      rejectedDraft = null;
      announce('Arrangement queued for the next genuinely scheduled musical boundary.'); return true;
    } catch (error) { if (expected === generation) { rejectedDraft=clone(song); announce(error.message); } return false; }
    finally { if (expected === generation) { busy = false; render(); } }
  }
  function selectSection(index) {
    if (!allowed() || busy) return;
    const song = draftSong(), section = song.sections[index];
    if (!section) return;
    song.enabled = true;
    if (AppState.isPlaying()) { void enqueue(song, {sectionIndex:index}); return; }
    try {
      validate(song);
      // Legacy metadata-only sections retain the live tracks, including private
      // native assets; applying an empty snapshot would erase the ensemble.
      const hasSnapshot = section.tracks?.length > 0;
      const token = beginEditTransaction('Select section');
      if (!token) throw new Error('Edit history is unavailable or busy. No changes applied; draft retained.');
      try {
        AppState.setSong(song);
        if (hasSnapshot) AppState.applySongSectionForBar(section.startBar, index);
        else AppState.setTempo(section.tempo, {reschedule:false});
        AppState.getTracks().forEach((track, trackIndex) => AppState.updateTrack(trackIndex,{currentBar:section.startBar,currentBeat:0,songRepeatIteration:0}));
        commitEditTransaction(token);
      } catch (error) { cancelEditTransaction(token); throw error; }
      Room.sendState(AppState.getCurrentStateForPreset(true)); options.refreshUI?.({animate:false});
      render(); announce(`${section.name} selected.`);
    } catch(error) { announce(error.message); }
  }
  function commit(song, label, reorderedBars = null) {
    if (!editable()) return false;
    try { validate(song, reorderedBars?.[0]?.length || Math.max(barCount(),...song.sections.flatMap(section=>(section.tracks || []).map(track=>track.barSettings.length)))); }
    catch(error) { announce(error.message); return false; }
    if (AppState.isPlaying()) {
      // The core owns scheduled application. Materialize fallback sections because the
      // queue intentionally carries a complete song, never detached live track objects.
      if (reorderedBars) {
        const current = AppState.getMusicalSnapshot().Tracks;
        song.sections = song.sections.map(section=>section.tracks?.length ? section : {...section,tracks:current.map((track,index)=>({...clone(track),barSettings:clone(reorderedBars[index])}))});
      }
      void enqueue(song); return true;
    }
    try {
      validate(song, reorderedBars?.[0]?.length || barCount());
      const token = beginEditTransaction(label);
      if (!token) throw new Error('Edit history is unavailable or busy. No changes applied; draft retained.');
      try {
        if (reorderedBars) reorderedBars.forEach((bars, index) => AppState.updateTrack(index, { barSettings: bars }));
        AppState.setSong(song);
        commitEditTransaction(token);
      } catch (error) { cancelEditTransaction(token); throw error; }
      Room.sendState(AppState.getCurrentStateForPreset(true));
      options.refreshUI?.({ animate: false });
      render(); announce(label); return true;
    } catch (error) { announce(error.message); return false; }
  }
  function reordered(song, from, to) {
    validate(song);
    if (!song.sections[from] || !song.sections[to]) throw new Error('Invalid section destination.');
    const count = barCount();
    const segments = song.sections.map((section, index) => ({ section, indices: Array.from({length:(song.sections[index+1]?.startBar ?? count)-section.startBar}, (_,i)=>section.startBar+i) }));
    segments.splice(to, 0, segments.splice(from, 1)[0]);
    const order = segments.flatMap(segment => segment.indices);
    const remap = bars => {
      if (bars?.length !== count) throw new Error('Cannot reorder unequal track/snapshot lengths safely. Draft preserved; align lengths first.');
      return order.map(index => clone(bars[index]));
    };
    const tracks = AppState.getTracks();
    if (tracks.some(track=>track.barSettings.length !== count)) throw new Error('Cannot reorder unequal track lengths without changing their musical cycles. Align track lengths first.');
    let startBar = 0;
    song.sections = segments.map(segment => {
      const section = {...segment.section, startBar}; startBar += segment.indices.length;
      if (section.tracks) section.tracks = section.tracks.map(track=>({...track,barSettings:remap(track.barSettings)}));
      return section;
    });
    return {song, bars: tracks.map(track=>remap(track.barSettings))};
  }
  function move(from, to) {
    if (!editable()) return;
    if (getPendingSongChange()) { announce('Cancel or apply the pending arrangement before another structural edit. Draft preserved.'); return; }
    try { const next = reordered(draftSong(), from, to); commit(next.song, 'Sections reordered', next.bars); }
    catch (error) { announce(error.message); }
  }
  function resize(index, length) {
    if (!editable()) return;
    if (getPendingSongChange()) { announce('Cancel or apply the pending arrangement before another structural edit. Draft preserved.'); return; }
    const song = draftSong(), count = barCount();
    const end = song.sections[index+1]?.startBar ?? count, old = end-song.sections[index].startBar;
    if (!Number.isInteger(length) || length < 1 || length > 64 || count+length-old>64) {
      announce('Length must be a positive whole number and the whole arrangement cannot exceed 64 bars. Draft preserved.'); return;
    }
    if (length < old) { announce('Cannot shrink: this would remove musical bars. Draft preserved; use the range editor for explicit deletion.'); return; }
    if (length === old) return;
    try {
      validate(song);
      const expand = bars => {
        if (bars.length !== count) throw new Error('Cannot resize unequal track/snapshot lengths safely. Draft preserved; align lengths first.');
        const copy=clone(bars);
        copy.splice(end,0,...Array.from({length:length-old},()=>clone(bars[end-1])));
        return copy;
      };
      const bars=AppState.getTracks().map(track=>expand(track.barSettings));
      song.sections = song.sections.map((section,next)=>({...section,startBar:section.startBar+(next>index?length-old:0),
        ...(section.tracks ? {tracks:section.tracks.map(track=>({...track,barSettings:expand(track.barSettings)}))} : {})}));
      commit(song, 'Section expanded with copies of its final bar; following musical content moved intact.', bars);
    } catch (error) { announce(error.message); }
  }
  function selectLoop(bar) {
    if (!stopped()) return;
    if (loopAnchor === null) { loopAnchor = bar; announce(`Loop A: bar ${bar+1}. Select a bar for B; Escape cancels.`); render(); return; }
    const startBar = Math.min(loopAnchor,bar), endBar = Math.max(loopAnchor,bar);
    if (endBar >= AppState.getAbLoopBarCount()) { announce('Loop range must fit the selected track.'); return; }
    AppState.setAbLoop({enabled:true,startBar,endBar}); loopAnchor = null;
    options.refreshUI?.({animate:false}); render(); announce(`Loop set to bars ${startBar+1}–${endBar+1}, inclusive.`);
  }
  const clearLoop = button('Disable timeline loop', root, () => {
    if (!stopped()) return;
    loopAnchor = null; AppState.setAbLoop({enabled:false}); options.refreshUI?.({animate:false}); render();
  });
  function cancelGesture() {
    if (!gesture) return;
    const active = gesture; gesture = null;
    active.handle.classList.remove('is-dragging');
    if (active.handle.hasPointerCapture(active.pointerId)) active.handle.releasePointerCapture(active.pointerId);
    announce('Gesture cancelled. No changes applied.');
  }
  function startGesture(event, index, kind, handle) {
    if (!editable() || event.button !== 0 || gesture) return;
    event.preventDefault();
    const song = draftSong();
    gesture = {index, kind, handle, pointerId:event.pointerId, x:event.clientX, y:event.clientY,
      generation, song:JSON.stringify(song), musical:JSON.stringify(AppState.getMusicalSnapshot()),
      target:index, length:(song.sections[index+1]?.startBar ?? barCount())-song.sections[index].startBar};
    handle.setPointerCapture(event.pointerId); handle.classList.add('is-dragging');
  }
  function gestureMove(event) {
    const g = gesture;
    if (!g || event.pointerId !== g.pointerId) return;
    if (g.kind === 'resize') {
      g.previewLength = g.length + Math.round((event.clientX-g.x)/48);
      announce(`Preview: ${g.previewLength} bars. Release to apply; Escape cancels.`);
    } else {
      const cards = [...list.children];
      const centers = cards.map(card => {const rect=card.getBoundingClientRect();return rect.left+rect.width/2;});
      g.target = centers.reduce((best, center, index) => Math.abs(center-event.clientX)<Math.abs(centers[best]-event.clientX)?index:best, 0);
      cards.forEach((card,index)=>card.classList.toggle('is-drop-target',index===g.target));
      announce(`Preview: move to position ${g.target+1}. Release to apply; Escape cancels.`);
    }
  }
  function gestureEnd(event) {
    const g = gesture;
    if (!g || event.pointerId !== g.pointerId) return;
    const valid = editable() && g.generation === generation && g.song === JSON.stringify(draftSong()) && g.musical === JSON.stringify(AppState.getMusicalSnapshot());
    const moved = Math.hypot(event.clientX-g.x,event.clientY-g.y) >= 6;
    gesture = null;
    if (g.handle.hasPointerCapture(g.pointerId)) g.handle.releasePointerCapture(g.pointerId);
    if (valid && moved) { if (g.kind === 'resize') resize(g.index,g.previewLength ?? g.length); else if (g.target!==g.index) move(g.index,g.target); }
    render();
  }
  function escape(event) {
    if (event.key !== 'Escape' || (!gesture && loopAnchor === null)) return;
    event.preventDefault(); cancelGesture(); loopAnchor = null; render();
  }
  function updatePosition() {
    if (disposed) return;
    const song = AppState.getSong(), track = AppState.getTracks()[0];
    const bar = track?.currentBar || 0, current = AppState.getSongSectionForBar(bar);
    const next = song.sections[(current.index+1)%song.sections.length];
    const end = song.sections[current.index+1]?.startBar ?? barCount();
    const length = end-current.startBar, iteration = track?.songRepeatIteration || 0;
    const remaining = Math.max(0,end-bar) + Math.max(0,current.repeats-iteration-1)*length;
    position.textContent = `${song.name} · ${song.enabled ? `Current: ${current.name} · bar ${bar+1} · ${current.tempo} BPM · repeat ${iteration+1}/${current.repeats} · Next: ${next?.name || '—'} · transition after ${remaining} bars` : 'Song mode off'}`;
    for (const card of list.children) card.classList.toggle('is-current',song.enabled && Number(card.dataset.section)===current.index);
  }
  function render() {
    if (disposed || gesture) return;
    const focusedLabel = root.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : null;
    const song = draftSong(), tracks = AppState.getTracks();
    const pending = getPendingSongChange();
    live.disabled = !allowed() || busy;
    discard.hidden = !rejectedDraft || awaitingAuthority;
    discard.disabled = !allowed() || busy;
    cancel.disabled = !allowed() || (!pending && !awaitingAuthority) || busy;
    pendingLabel.textContent = awaitingAuthority ? 'Awaiting server authority · not scheduled yet' : pending ? 'Queued arrangement · awaiting a genuinely scheduled musical boundary' : rejectedDraft ? 'Rejected draft retained · not queued' : 'No queued arrangement';
    const count = tracks[0]?.barSettings?.length || 1;
    const current = AppState.getSongSectionForBar(tracks[0]?.currentBar || 0);
    updatePosition();
    const loop = AppState.getAbLoop();
    loopStatus.textContent = loop.enabled ? `Loop A: ${loop.startBar+1} · B: ${loop.endBar+1} (inclusive)` : 'Loop off · choose A then B on the bar ruler';
    clearLoop.disabled = !stopped() || !loop.enabled;
    ruler.replaceChildren();
    for(let bar=0;bar<count;bar++) {
      const pick = button(String(bar+1), ruler, ()=>selectLoop(bar));
      pick.setAttribute('aria-label', `Select timeline bar ${bar+1}`);
      pick.setAttribute('aria-pressed',String(loopAnchor === bar || (loop.enabled && bar>=loop.startBar && bar<=loop.endBar)));
      pick.disabled = !stopped() || bar >= AppState.getAbLoopBarCount();
    }
    list.replaceChildren();
    song.sections.forEach((section, index) => {
      const length = (song.sections[index + 1]?.startBar ?? count) - section.startBar;
      const card = make('li', undefined, list); card.dataset.section = index;
      card.className = 'arrangement-section'; card.classList.toggle('is-current', song.enabled && current.index === index);
      make('strong', section.name, card);
      make('span', `${section.tempo} BPM · ${section.repeats}× · ${length} bars · starts ${section.startBar + 1}`, card);
      const handles = make('div', undefined, card); handles.className = 'arrangement-handles';
      for (const kind of ['reorder','resize']) {
        const handle = button(kind==='reorder' ? '⠿ Move' : '↔ Length', handles);
        handle.className = 'arrangement-handle';
        handle.setAttribute('aria-label',kind==='reorder' ? `Drag ${section.name} to reorder` : `Drag ${section.name} length`);
        handle.disabled = !editable();
        handle.addEventListener('pointerdown', event=>startGesture(event,index,kind,handle));
        handle.addEventListener('lostpointercapture', ()=>{ if (gesture?.handle===handle) {cancelGesture();render();} });
        handle.addEventListener('keydown',event=>{
          if (!['ArrowLeft','ArrowRight'].includes(event.key)) return;
          event.preventDefault(); const delta=event.key==='ArrowLeft'?-1:1;
          if(kind==='resize') resize(index,length+delta); else move(index,index+delta);
        });
      }
      const fields = make('div', undefined, card); fields.className = 'arrangement-fields';
      for (const [field, label, min, max, value] of [['tempo','BPM',20,300,section.tempo],['repeats','repeats',1,16,section.repeats],['length','length in bars',1,64,length]]) {
        const wrapper = make('label', label, fields), input = make('input', undefined, wrapper);
        input.type = 'number'; input.min = min; input.max = max; input.step = 1; input.value = value;
        input.setAttribute('aria-label', `${section.name} ${label}`); input.disabled = !editable();
        input.addEventListener('change', () => {
          const value = Number(input.value);
          if (field === 'length') resize(index, input.value === '' ? NaN : value);
          else { const next = draftSong(); next.sections[index][field] = input.value === '' ? NaN : value; commit(next, 'Section updated'); }
        });
      }
      const actions = make('div', undefined, card); actions.className = 'arrangement-actions';
      for (const [delta, name] of [[-1,'earlier'],[1,'later']]) {
        const control = button(delta < 0 ? '← Earlier' : 'Later →', actions, ()=>move(index,index+delta));
        control.setAttribute('aria-label', `Move ${section.name} ${name}`);
        control.disabled = !editable() || !song.sections[index+delta];
      }
      const go = button('Go', actions, ()=>selectSection(index));
      go.setAttribute('aria-label', `Go to ${section.name}`); go.disabled = !allowed() || busy;
      const preview = make('div', undefined, card); preview.className = 'arrangement-preview';
      for (const [trackIndex, track] of (section.tracks?.length ? section.tracks : tracks).entries()) {
        const row = make('div', undefined, preview); row.dataset.previewTrack = trackIndex;
        make('span', track.name || `Track ${trackIndex + 1}`, row);
        const bars = make('div', undefined, row); bars.className = 'arrangement-preview-bars';
        for (let barIndex = section.startBar; barIndex < section.startBar + length; barIndex++) {
          const bar = track.barSettings[barIndex] || track.barSettings.at(-1);
          if (!bar) continue;
          const glyph = make('span', undefined, bars); glyph.dataset.previewBar = barIndex;
          glyph.setAttribute('role', 'img');
          const slots = getBeatSlots(bar);
          const accents = Object.keys(bar.velocities || {}).length;
          const slices = Object.values(bar.beatSlices || {}).reduce((total,count)=>total+Number(count),0);
          glyph.setAttribute('aria-label', `Bar ${barIndex + 1}: ${bar.beats} beats, subdivision ${bar.subdivision}, ${(bar.rests || []).length} rests, ${accents} accents, ${slices} slices`);
          for (const slot of slots) {
            const rests = bar.rests || [];
            const logicalIndex = slot.baseIndex;
            const rest = rests.includes(logicalIndex);
            const velocity = bar.velocities?.[logicalIndex] ?? (slot.mainBeat ? 1 : .7);
            const soundOverride = Boolean(bar.beatSounds?.[logicalIndex]?.[slot.mainBeat ? 'mainBeatSound' : 'subdivisionSound']);
            const note = make('i', rest ? '·' : velocity < .6 ? '▯' : '▮', glyph);
            note.dataset.previewSlot = slot.index; note.dataset.rest = String(rest);
            note.dataset.velocity = velocity; note.dataset.slices = slot.sliceCount || 1;
            note.dataset.soundOverride = String(soundOverride);
            note.className = slot.mainBeat ? 'is-main-beat' : 'is-subdivision';
            note.title = `Slot ${slot.index+1}${rest ? ', rest' : `, velocity ${velocity}`}${slot.sliceCount ? `, slice ${slot.slice+1}/${slot.sliceCount}` : ''}${soundOverride ? ', sound override' : ''}`;
          }
        }
      }
    });
    if (focusedLabel) {
      const replacement = [...root.querySelectorAll('[aria-label]')].find(node=>node.getAttribute('aria-label')===focusedLabel && !node.disabled);
      replacement?.focus({preventScroll:true});
    }
  }
  const invalidate = () => { generation++; busy = false; live.checked = false; loopAnchor = null; rejectedDraft = null; awaitingAuthority = false; cancelGesture(); render(); };
  const schemaChanged = () => { generation++; cancelGesture(); loopAnchor = null; render(); };
  const pendingChanged = () => { awaitingAuthority = false; rejectedDraft = null; cancelGesture(); render(); };
  const pointerCancelled = () => { cancelGesture(); render(); };
  const nextSection = () => {
    if (!allowed()) return;
    const current = AppState.getSongSectionForBar(AppState.getTracks()[0]?.currentBar || 0);
    selectSection((current.index + 1) % AppState.getSong().sections.length);
  };
  const listeners = [['appstatechange', schemaChanged], ['songpositionchange', updatePosition], ['pendingSongChange',pendingChanged],
    ['pointermove',gestureMove],['pointerup',gestureEnd],['pointercancel',pointerCancelled],['keydown',escape],
    ['metronominal:section-next',nextSection], ...['roomauthoritychange','syncrolechange','historyboundary','playbackstatechange'].map(name=>[name,invalidate])];
  for (const [name, fn] of listeners) document.addEventListener(name, fn);
  const controller = { render, destroy() {
    disposed = true; generation++;
    for (const [name, fn] of listeners) document.removeEventListener(name, fn);
    mounted.delete(root); root.replaceChildren();
  }};
  mounted.set(root, controller); render(); return controller;
}
