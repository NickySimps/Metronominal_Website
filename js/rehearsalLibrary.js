import AppState from './appState.js';
import SongController from './songController.js';
import * as Room from './webrtc.js';

const KEY = 'metronominal.rehearsal.v1';
const MAX_BYTES = 2 * 1024 * 1024;
const text = (value, max = 80) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const bytes = value => new TextEncoder().encode(value).byteLength;

// Device-local only. No library data is added to AppState or room snapshots.
export function initializeRehearsalLibrary(root) {
  if (!root) return null;
  const shell = document.createElement('section');
  shell.className = 'rehearsal-library';
  shell.setAttribute('aria-label', 'Rehearsal library');
  root.append(shell);
  shell.innerHTML = `<details><summary>Setlists</summary><p>Saved on this device. Loading is explicit and only available while stopped.</p>
    <label>Setlist name <input data-name maxlength="80"></label><button type="button" data-create>Create setlist</button>
    <label>Saved setlist <select data-select aria-label="Saved setlist"></select></label>
    <label>Rename setlist <input data-rename maxlength="80"></label>
    <div data-list-actions></div><button type="button" data-add>Add current song</button>
    <div data-navigation></div>
    <label>Import library (replaces local library) <input data-import type="file" accept="application/json,.json"></label>
    <button type="button" data-export>Export library</button>
    <ol data-entries></ol></details><details><summary>Cues</summary>
    <p>Device-local cues for the current song. Send now is manual; no automatic song changes.</p>
    <label>Cue text <input data-cue-text maxlength="140"></label>
    <label>Target bar <select data-cue-bar></select></label><button type="button" data-cue-add>Add cue</button>
    <label><input type="checkbox" data-auto> Send bar cues automatically</label>
    <p>Automatic cues follow this host's song-position events, including repeats. They are not a background/audio-clock scheduler.</p>
    <ol data-cues></ol></details><p role="status" aria-live="assertive" aria-atomic="true" data-cue-display>No room cue</p><p role="status" aria-live="polite" data-status></p>`;
  const find = selector => shell.querySelector(selector);
  let data = { format: 'metronominal-rehearsal', version: 1, lists: [], cues: [] };
  let selected = 0;
  let loaded = -1;
  let storageHealthy = true;
  let generation = 0;
  let busy = false;
  let disposed = false;
  const status = message => { find('[data-status]').textContent = message; };
  const role = () => Room.getSyncDiagnostics?.().role || 'offline';
  const allowed = () => !disposed && ['host', 'offline'].includes(role()) && !AppState.isPlaying();
  function validate(value) {
    if (!value || value.format !== data.format || value.version !== 1 || !Array.isArray(value.lists) || value.lists.length > 20 || !Array.isArray(value.cues) || value.cues.length > 100) throw new Error('Invalid rehearsal library. Original storage was not changed.');
    const cues = value.cues.map(cue => {
      if (!text(cue.song) || !text(cue.text, 140) || !Number.isInteger(cue.bar) || cue.bar < 0 || cue.bar > 63) throw new Error('Invalid cue.');
      return { song: cue.song, text: cue.text, bar: cue.bar };
    });
    return { format: data.format, version: 1, cues, lists: value.lists.map(list => {
      if (!text(list.name) || !Array.isArray(list.songs) || list.songs.length > 50) throw new Error('Invalid setlist.');
      return { name: list.name, songs: list.songs.map(entry => {
        if (!text(entry.name)) throw new Error('Invalid entry name.');
        return { name: entry.name, payload: SongController.validatePayload(entry.payload) };
      }) };
    }) };
  }
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      if (bytes(raw) > MAX_BYTES) throw new Error('Stored library is too large.');
      data = validate(JSON.parse(raw));
    }
  } catch (error) { storageHealthy = false; status(`Library storage unavailable or damaged: ${error.message} Existing data has not been erased.`); }
  function save(next, shouldRender = true) {
    if (!allowed() || !storageHealthy || busy) return false;
    try {
      next = validate(next);
      const raw = JSON.stringify(next);
      if (bytes(raw) > MAX_BYTES) throw new Error('Library must be 2 MB or smaller.');
      localStorage.setItem(KEY, raw);
      data = next;
      status('Saved on this device.');
      if (shouldRender) render();
      return true;
    } catch (error) { status(`Not saved: ${error.message} Previous saved data was kept.`); return false; }
  }
  async function capture() {
    if (!allowed() || busy || !data.lists[selected] || data.lists[selected].songs.length >= 50) return;
    const token = generation;
    busy = true; render();
    try {
      const payload = SongController.validatePayload(await SongController.createPayload());
      if (token !== generation || !allowed()) return;
      const next = structuredClone(data);
      next.lists[selected].songs.push({ name: payload.state.song.name, payload });
      busy = false;
      save(next);
    } catch (error) { status(`Song not saved: ${error.message}`); }
    finally { busy = false; render(); }
  }
  async function load(index) {
    if (!allowed() || busy) return false;
    const entry = data.lists[selected]?.songs[index];
    if (!entry) return false;
    const token = generation;
    busy = true; render();
    try {
      await SongController.applyPayload(entry.payload, {
        allowBeforeConnection: role() === 'offline',
        shouldApply: () => token === generation && allowed(),
      });
      if (token !== generation || !allowed()) return false;
      loaded = index;
      status(`${entry.name} loaded. Playback remains stopped.`);
      // applyPayload refreshes and publishes the local load. Only actual Undo/Redo
      // emits historyapplied; another event here would publish the same edit twice.
      return true;
    } catch (error) { status(`Not loaded: ${error.message}`); return false; }
    finally { busy = false; render(); }
  }
  function button(label, action, disabled = false) {
    const node = document.createElement('button');
    node.type = 'button'; node.textContent = label; node.disabled = disabled;
    node.addEventListener('click', action);
    return node;
  }
  function editList(action) {
    if (!allowed() || busy || !data.lists[selected]) return;
    const next = structuredClone(data);
    const previousSelection = selected;
    action(next, next.lists[selected]);
    loaded = -1;
    if (!save(next)) { selected = previousSelection; render(); }
  }
  function importText(raw) {
    if (!allowed() || busy || !storageHealthy) return false;
    try {
      if (typeof raw !== 'string' || bytes(raw) > MAX_BYTES) throw new Error('Library must be 2 MB or smaller.');
      const next = validate(JSON.parse(raw));
      if (!save(next)) return false;
      selected = 0; loaded = -1; generation++; render(); return true;
    } catch (error) { status(`Import rejected: ${error.message} Existing data has not been erased.`); return false; }
  }
  function exportText() {
    if (!storageHealthy) throw new Error('Cannot export an unavailable or damaged library. Original storage has not been changed.');
    return JSON.stringify(validate(data));
  }
  function displayRoomCue() {
    const room = Room.getRehearsalRoomState?.();
    const cue = room?.supported === true ? room.cue : null;
    // Read only the protocol's authoritative state, never event.detail or local drafts.
    find('[data-cue-display]').textContent = cue && text(cue.text, 140)
      && (cue.bar === null || (Number.isInteger(cue.bar) && cue.bar >= 0 && cue.bar < 64))
      ? `Room cue${cue.bar === null ? '' : ` · bar ${cue.bar + 1}`}: ${cue.text}` : 'No room cue';
  }
  function sendCue(cue, bar = null) {
    if (disposed || role() === 'client') return false;
    if (role() === 'offline') {
      find('[data-cue-display]').textContent = `Local cue (not room): ${cue.text}`;
      return true;
    }
    if (role() !== 'host' || !Room.getRehearsalRoomState?.()?.supported || !Room.sendRehearsalCue?.({ text: cue.text, bar })) {
      status('Cue not sent: this room does not support rehearsal cues.'); return false;
    }
    status('Cue sent to room.');
    return true;
  }
  function onBar(event) {
    if (disposed || !find('[data-auto]').checked || !AppState.isPlaying() || !['host', 'offline'].includes(role())) return;
    const bar = event.detail?.bar;
    if (!Number.isInteger(bar) || bar < 0 || bar >= (AppState.getTracks()[0]?.barSettings.length || 0)) return;
    // Every event is an occurrence. Never deduplicate by bar: a one-bar section
    // can repeat at the same index. Only the host's engine may emit room cues.
    for (const cue of data.cues) if (cue.song === AppState.getSong().name && cue.bar === bar) sendCue(cue, bar);
  }
  function render() {
    const can = allowed() && !busy && storageHealthy;
    const songName = AppState.getSong().name;
    const barSelect = find('[data-cue-bar]');
    const oldBar = barSelect.value;
    barSelect.replaceChildren(...Array.from({ length: Math.min(64, AppState.getTracks()[0]?.barSettings.length || 1) }, (_, index) => {
      const option = document.createElement('option'); option.value = index; option.textContent = `Bar ${index + 1}`; return option;
    }));
    barSelect.value = oldBar || '0'; if (barSelect.selectedIndex < 0) barSelect.value = '0';
    barSelect.disabled = !can;
    find('[data-cue-text]').disabled = !can;
    find('[data-cue-add]').disabled = !can || data.cues.length >= 100;
    find('[data-auto]').disabled = disposed || role() === 'client';
    const cueList = find('[data-cues]'); cueList.replaceChildren();
    data.cues.forEach((cue, index) => {
      if (cue.song !== songName) return;
      const row = document.createElement('li'); const label = document.createElement('span');
      label.textContent = `${cue.text} · bar ${cue.bar + 1}`;
      row.append(label, button(`Send cue ${index + 1} now`, () => sendCue(cue), disposed || role() === 'client'),
        button(`Remove cue ${index + 1}`, () => { const next = structuredClone(data); next.cues.splice(index, 1); save(next); }, !can),
        button(`Move cue ${index + 1} up`, () => { const next = structuredClone(data); [next.cues[index - 1], next.cues[index]] = [next.cues[index], next.cues[index - 1]]; save(next); }, !can || index === 0),
        button(`Move cue ${index + 1} down`, () => { const next = structuredClone(data); [next.cues[index + 1], next.cues[index]] = [next.cues[index], next.cues[index + 1]]; save(next); }, !can || index === data.cues.length - 1));
      cueList.append(row);
    });
    find('[data-create]').disabled = !can || data.lists.length >= 20;
    find('[data-add]').disabled = !can || !data.lists[selected] || data.lists[selected].songs.length >= 50;
    find('[data-name]').disabled = !can;
    const select = find('[data-select]');
    select.disabled = !can;
    find('[data-import]').disabled = !can;
    find('[data-export]').disabled = !storageHealthy;
    find('[data-rename]').value = data.lists[selected]?.name || '';
    find('[data-rename]').disabled = !can || !data.lists[selected];
    find('[data-list-actions]').replaceChildren(
      button('Remove setlist', () => editList(next => { next.lists.splice(selected, 1); selected = Math.max(0, selected - 1); }), !can || !data.lists[selected]),
      button('Move setlist up', () => editList(next => { [next.lists[selected - 1], next.lists[selected]] = [next.lists[selected], next.lists[selected - 1]]; selected--; }), !can || selected === 0 || !data.lists[selected]),
      button('Move setlist down', () => editList(next => { [next.lists[selected + 1], next.lists[selected]] = [next.lists[selected], next.lists[selected + 1]]; selected++; }), !can || selected >= data.lists.length - 1));
    find('[data-navigation]').replaceChildren(
      button('Previous song', () => load(loaded - 1), !can || loaded <= 0),
      button('Next song', () => load(loaded + 1), !can || loaded < 0 || loaded >= (data.lists[selected]?.songs.length || 0) - 1));
    select.replaceChildren(...data.lists.map((list, index) => {
      const option = document.createElement('option'); option.value = index; option.textContent = list.name; return option;
    }));
    select.value = selected;
    const entries = find('[data-entries]'); entries.replaceChildren();
    for (const [index, entry] of (data.lists[selected]?.songs || []).entries()) {
      const row = document.createElement('li');
      const label = document.createElement('label'); label.textContent = `Entry name ${index + 1}`;
      const input = document.createElement('input'); input.maxLength = 80; input.value = entry.name; input.disabled = !can;
      input.addEventListener('change', () => { const next = structuredClone(data); next.lists[selected].songs[index].name = input.value; if (!save(next, false)) input.value = entry.name; });
      label.append(input); row.append(label, button(`Load entry ${index + 1}`, () => load(index), !can));
      row.append(
        button(`Remove entry ${index + 1}`, () => editList((next, list) => list.songs.splice(index, 1)), !can),
        button(`Move entry ${index + 1} up`, () => editList((next, list) => { [list.songs[index - 1], list.songs[index]] = [list.songs[index], list.songs[index - 1]]; }), !can || index === 0),
        button(`Move entry ${index + 1} down`, () => editList((next, list) => { [list.songs[index + 1], list.songs[index]] = [list.songs[index], list.songs[index + 1]]; }), !can || index === data.lists[selected].songs.length - 1));
      entries.append(row);
    }
  }
  find('[data-create]').addEventListener('click', () => {
    if (!allowed() || !text(find('[data-name]').value) || data.lists.length >= 20) { status('Enter a setlist name (1–80 characters).'); return; }
    const next = structuredClone(data); next.lists.push({ name: find('[data-name]').value.trim(), songs: [] });
    const previousSelection = selected;
    selected = next.lists.length - 1; loaded = -1;
    if (!save(next)) { selected = previousSelection; render(); }
  });
  find('[data-add]').addEventListener('click', capture);
  find('[data-rename]').addEventListener('change', event => {
    if (!data.lists[selected]) return;
    const next = structuredClone(data); next.lists[selected].name = event.target.value;
    if (save(next, false)) find('[data-select]').options[selected].textContent = event.target.value;
    else event.target.value = data.lists[selected].name;
  });
  find('[data-import]').addEventListener('change', async event => {
    const token = generation;
    try {
      const file = event.target.files?.[0];
      if (!file || file.size > MAX_BYTES) throw new Error('Library must be 2 MB or smaller.');
      const raw = await file.text();
      if (token === generation && allowed()) importText(raw);
    } catch (error) { status(`Import rejected: ${error.message}`); }
    finally { event.target.value = ''; }
  });
  find('[data-export]').addEventListener('click', () => {
    try {
      const url = URL.createObjectURL(new Blob([exportText()], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'metronominal-rehearsal.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0); status('Library exported.');
    } catch (error) { status(error.message); }
  });
  find('[data-select]').addEventListener('change', event => { generation++; selected = Number(event.target.value); loaded = -1; render(); });
  find('[data-cue-add]').addEventListener('click', () => {
    if (!allowed() || !text(find('[data-cue-text]').value, 140) || data.cues.length >= 100) { status('Enter cue text (1–140 characters).'); return; }
    const next = structuredClone(data);
    next.cues.push({ song: AppState.getSong().name, text: find('[data-cue-text]').value.trim(), bar: Number(find('[data-cue-bar]').value) });
    if (save(next)) find('[data-cue-text]').value = '';
  });
  const refresh = () => { generation++; render(); };
  const roleRefresh = () => { generation++; find('[data-auto]').checked = false; displayRoomCue(); render(); };
  const listeners = { syncrolechange: roleRefresh, roomauthoritychange: roleRefresh, playbackstatechange: refresh, appstatechange: render, rehearsalroomchange: displayRoomCue, songpositionchange: onBar };
  for (const [event, listener] of Object.entries(listeners)) document.addEventListener(event, listener);
  displayRoomCue(); render();
  return { load, importText, exportText, destroy() { disposed = true; generation++; for (const [event, listener] of Object.entries(listeners)) document.removeEventListener(event, listener); shell.remove(); } };
}
