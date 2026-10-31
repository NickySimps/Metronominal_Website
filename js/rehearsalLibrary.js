import AppState from './appState.js';
import SongController from './songController.js';
import * as Room from './webrtc.js';
import { emitInteractionMotion } from './interactionMotion.js';

const KEY = 'metronominal.rehearsal.v1';
const BACKUP_KEY = `${KEY}.backup`;
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
    <label>Import library (preview first) <input data-import type="file" accept="application/json,.json"></label>
    <p data-private-warning>Private recordings and custom sounds based on them are excluded from saved songs and exports; safe synthesized fallbacks may be used. Audio files are not bundled or transferred. Keep private audio separately on its original device.</p>
    <section data-preview hidden aria-label="Library import preview" aria-live="polite">
      <p data-preview-summary></p><ul data-preview-names></ul>
      <button type="button" data-merge>Merge library</button><button type="button" data-replace>Replace library</button>
      <button type="button" data-apply-restore>Apply restore</button><button type="button" data-cancel>Cancel preview</button>
    </section>
    <button type="button" data-export>Export library</button>
    <p data-recovery-warning>Recovery exports (backup and original storage) preserve raw bytes and may contain damaged content or private data. Inspect locally before sharing. Keep an exported copy if browser storage is unavailable.</p>
    <button type="button" data-restore>Restore backup</button><button type="button" data-export-backup>Export backup</button>
    <button type="button" data-export-original>Export original storage (raw recovery)</button>
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
  let preview = null;
  let originalRaw = null;
  let backupRaw = null;
  let roomCueInitialized = false;
  let roomCueKey = null;
  // Resolve after rendering: actions may replace their original button node.
  const motion = (kind, target) => {
    if (disposed) return;
    emitInteractionMotion(typeof target === 'string' ? find(target) : target, kind);
  };
  const clearPreview = () => { preview = null; find('[data-preview]').hidden = true; };
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
  try { backupRaw = localStorage.getItem(BACKUP_KEY); } catch { /* Recovery may still export the in-memory original. */ }
  try {
    const raw = localStorage.getItem(KEY);
    originalRaw = raw;
    if (raw) {
      if (bytes(raw) > MAX_BYTES) throw new Error('Stored library is too large.');
      data = validate(JSON.parse(raw));
    }
  } catch (error) { storageHealthy = false; status(`Library storage unavailable or damaged: ${error.message} Existing data has not been erased.`); }
  function save(next, shouldRender = true, replace = false) {
    if (!allowed() || (!storageHealthy && !replace) || busy) return false;
    try {
      next = validate(next);
      const raw = JSON.stringify(next);
      if (bytes(raw) > MAX_BYTES) throw new Error('Library must be 2 MB or smaller.');
      if (replace) {
        // Two keys are not a transaction: never touch the primary until backup succeeds.
        const previous = localStorage.getItem(KEY);
        const recovery = previous === null ? JSON.stringify(data) : previous;
        localStorage.setItem(BACKUP_KEY, recovery);
        backupRaw = recovery;
      }
      localStorage.setItem(KEY, raw);
      originalRaw = raw;
      data = next;
      storageHealthy = true;
      generation++; clearPreview();
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
      if (save(next)) motion('save', '[data-add]');
    } catch (error) { status(`Song not saved: ${error.message}`); }
    finally { busy = false; render(); }
  }
  async function load(index, targetLabel = `Load entry ${index + 1}`) {
    if (!allowed() || busy) return false;
    const entry = data.lists[selected]?.songs[index];
    if (!entry) return false;
    const token = generation;
    let accepted = false;
    busy = true; render();
    try {
      await SongController.applyPayload(entry.payload, {
        allowBeforeConnection: role() === 'offline',
        shouldApply: () => token === generation && allowed(),
      });
      if (token !== generation || !allowed()) return false;
      loaded = index;
      accepted = true;
      status(`${entry.name} loaded. Playback remains stopped.`);
      // applyPayload refreshes and publishes the local load. Only actual Undo/Redo
      // emits historyapplied; another event here would publish the same edit twice.
      return true;
    } catch (error) { status(`Not loaded: ${error.message}`); return false; }
    finally {
      busy = false; render();
      if (accepted) motion('load', [...shell.querySelectorAll('button')].find(node => node.textContent === targetLabel));
    }
  }
  function button(label, action, disabled = false) {
    const node = document.createElement('button');
    node.type = 'button'; node.textContent = label; node.disabled = disabled;
    node.addEventListener('click', () => {
      const before = data;
      const container = node.parentElement?.parentElement;
      action();
      if (data !== before) motion(label.startsWith('Remove') ? 'remove' : 'select', [...shell.querySelectorAll('button')].find(node => node.textContent === label) || container);
    });
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
      if (!save(next, false, true)) return false;
      selected = 0; loaded = -1; render(); return true;
    } catch (error) { status(`Import rejected: ${error.message} Existing data has not been erased.`); return false; }
  }
  // Sort object keys only: ordered musical arrays remain significant.
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  function entryKey(entry) {
    const payload = structuredClone(entry.payload);
    delete payload.exportedAt;
    for (const key of ['selectedTrackIndex', 'selectedBarIndexInContainer', 'controlsAttachedToTrack', 'isRestMode', 'isAccentMode', 'isSliceMode']) delete payload.state[key];
    for (const track of payload.state.Tracks) for (const key of ['currentBar', 'currentBeat', 'songRepeatIteration', 'nextBeatTime']) delete track[key];
    return JSON.stringify(canonical({ name: entry.name, payload }));
  }
  function mergeLibrary(incoming, base) {
    const next = structuredClone(base);
    let duplicates = 0;
    // Limits on both inputs bound canonicalization and comparisons; no title-only song matches.
    for (const list of incoming.lists) {
      let target = next.lists.find(item => item.name === list.name);
      if (!target) { target = {name:list.name, songs:[]}; next.lists.push(target); }
      const keys = new Set(target.songs.map(entryKey));
      for (const entry of list.songs) {
        const key = entryKey(entry);
        if (keys.has(key)) duplicates++;
        else { target.songs.push(structuredClone(entry)); keys.add(key); }
      }
    }
    const cues = new Set(next.cues.map(cue => JSON.stringify(canonical(cue))));
    for (const cue of incoming.cues) {
      const key = JSON.stringify(canonical(cue));
      if (cues.has(key)) duplicates++;
      else { next.cues.push(structuredClone(cue)); cues.add(key); }
    }
    const checked = validate(next);
    if (bytes(JSON.stringify(checked)) > MAX_BYTES) throw new Error('Merged library must be 2 MB or smaller.');
    return { next: checked, duplicates };
  }
  function stageImport(raw, source = 'import') {
    if (!allowed() || busy) return false;
    generation++;
    clearPreview();
    try {
      if (typeof raw !== 'string' || !raw.trim() || bytes(raw) > MAX_BYTES) throw new Error('Library must be nonempty and 2 MB or smaller.');
      const next = validate(JSON.parse(raw));
      const replacement = source === 'restore' ? {next, duplicates:0} : mergeLibrary(next, {format:data.format,version:1,lists:[],cues:[]});
      let merged = null;
      let mergeError = '';
      try { if (storageHealthy) merged = mergeLibrary(next, data); }
      catch (error) { mergeError = error.message; }
      preview = { next: replacement.next, merged: merged?.next, source, token: generation };
      const count = next.lists.reduce((sum, list) => sum + list.songs.length, 0);
      find('[data-preview-summary]').textContent = `${source === 'restore' ? 'Restore' : 'Import'} preview: ${next.lists.length} setlists, ${count} songs, ${next.cues.length} cues. ${merged ? `${merged.duplicates} duplicates skipped on merge; result: ${merged.next.lists.length} setlists, ${merged.next.lists.reduce((sum, list) => sum + list.songs.length, 0)} songs, ${merged.next.cues.length} cues.` : `Merge unavailable: ${mergeError || 'repair damaged storage with Replace or Restore first.'}`} ${replacement.duplicates} duplicates within import skipped on Replace. Same-named setlists combine on merge; different music and song aliases are retained. Replace saves the previous library as a local backup first.`;
      find('[data-preview-names]').replaceChildren(...next.lists.map(list => {
        const node = document.createElement('li'); node.textContent = `${list.name}: ${list.songs.length} songs${list.songs.length ? ' — ' + list.songs.map(entry => entry.name).join(', ') : ''}`; return node;
      }));
      find('[data-preview]').hidden = false;
      find('[data-merge]').hidden = source === 'restore';
      find('[data-replace]').hidden = source === 'restore';
      find('[data-apply-restore]').hidden = source !== 'restore';
      render(); motion('upload', source === 'restore' ? '[data-restore]' : '[data-import]'); return true;
    } catch (error) { status(`Import rejected: ${error.message} Existing data has not been erased.`); return false; }
  }
  function commitImport(mode) {
    if (!preview || preview.token !== generation || !allowed() || busy) return false;
    if (!['merge', 'replace', 'restore'].includes(mode)) return false;
    if ((preview.source === 'restore') !== (mode === 'restore')) return false;
    const next = mode === 'merge' ? preview.merged : preview.next;
    if (!next) return false;
    if (!save(next, false, mode !== 'merge')) { render(); motion('refuse', mode === 'restore' ? '[data-apply-restore]' : `[data-${mode}]`); return false; }
    selected = 0; loaded = -1; render(); motion('save', '[data-import]'); return true;
  }
  function restoreBackup() {
    if (!allowed() || busy) return false;
    try { backupRaw = localStorage.getItem(BACKUP_KEY) || backupRaw; }
    catch (error) { if (!backupRaw) { status(`Backup unavailable: ${error.message}`); return false; } }
    return stageImport(backupRaw, 'restore');
  }
  function download(raw, filename, recovery = false) {
    if (typeof raw !== 'string') throw new Error('No recovery data is available.');
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    status(recovery ? 'Raw recovery exported. It may be damaged or contain private data; inspect locally before sharing.' : 'Library exported. Private audio is not bundled.');
    motion('download', filename.includes('backup') ? '[data-export-backup]' : '[data-export-original]');
  }
  function exportText() {
    if (!storageHealthy) throw new Error('Cannot export an unavailable or damaged library. Original storage has not been changed.');
    return JSON.stringify(validate(data));
  }
  function displayRoomCue() {
    const room = Room.getRehearsalRoomState?.();
    const cue = room?.supported === true ? room.cue : null;
    // Read only the protocol's authoritative state, never event.detail or local drafts.
    const valid = cue && text(cue.text, 140)
      && (cue.bar === null || (Number.isInteger(cue.bar) && cue.bar >= 0 && cue.bar < 64));
    const key = valid && Number.isSafeInteger(cue.sequence) && cue.sequence > 0 ? JSON.stringify([cue.sequence, cue.text, cue.bar]) : null;
    find('[data-cue-display]').textContent = valid
      ? `Room cue${cue.bar === null ? '' : ` · bar ${cue.bar + 1}`}: ${cue.text}` : 'No room cue';
    if (roomCueInitialized && key && key !== roomCueKey) motion('cue', '[data-cue-display]');
    roomCueKey = key;
    roomCueInitialized = true;
  }
  function sendCue(cue, bar = null) {
    if (disposed || role() === 'client') return false;
    if (role() === 'offline') {
      find('[data-cue-display]').textContent = `Local cue (not room): ${cue.text}`;
      motion('cue', '[data-cue-display]');
      return true;
    }
    if (role() !== 'host' || !Room.getRehearsalRoomState?.()?.supported || !Room.sendRehearsalCue?.({ text: cue.text, bar })) {
      status('Cue not sent: this room does not support rehearsal cues.'); return false;
    }
    // sendRehearsalCue only queues a transport write. Delivery is decorated by
    // displayRoomCue after a changed authoritative server snapshot arrives.
    status('Cue queued for room delivery.');
    motion('pending', [...shell.querySelectorAll('button')].find(node => node.textContent === `Send cue ${data.cues.indexOf(cue) + 1} now`));
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
    find('[data-import]').disabled = !allowed() || busy;
    find('[data-restore]').disabled = !allowed() || busy || !backupRaw;
    find('[data-export-backup]').disabled = !backupRaw;
    find('[data-export-original]').disabled = originalRaw === null;
    for (const selector of ['[data-merge]', '[data-replace]', '[data-apply-restore]']) find(selector).disabled = !allowed() || busy || !preview || preview.token !== generation;
    find('[data-merge]').disabled ||= !storageHealthy || !preview?.merged;
    find('[data-export]').disabled = !storageHealthy;
    find('[data-rename]').value = data.lists[selected]?.name || '';
    find('[data-rename]').disabled = !can || !data.lists[selected];
    find('[data-list-actions]').replaceChildren(
      button('Remove setlist', () => editList(next => { next.lists.splice(selected, 1); selected = Math.max(0, selected - 1); }), !can || !data.lists[selected]),
      button('Move setlist up', () => editList(next => { [next.lists[selected - 1], next.lists[selected]] = [next.lists[selected], next.lists[selected - 1]]; selected--; }), !can || selected === 0 || !data.lists[selected]),
      button('Move setlist down', () => editList(next => { [next.lists[selected + 1], next.lists[selected]] = [next.lists[selected], next.lists[selected + 1]]; selected++; }), !can || selected >= data.lists.length - 1));
    find('[data-navigation]').replaceChildren(
      button('Previous song', () => load(loaded - 1, 'Previous song'), !can || loaded <= 0),
      button('Next song', () => load(loaded + 1, 'Next song'), !can || loaded < 0 || loaded >= (data.lists[selected]?.songs.length || 0) - 1));
    select.replaceChildren(...data.lists.map((list, index) => {
      const option = document.createElement('option'); option.value = index; option.textContent = list.name; return option;
    }));
    select.value = selected;
    const entries = find('[data-entries]'); entries.replaceChildren();
    for (const [index, entry] of (data.lists[selected]?.songs || []).entries()) {
      const row = document.createElement('li');
      const label = document.createElement('label'); label.textContent = `Entry name ${index + 1}`;
      const input = document.createElement('input'); input.maxLength = 80; input.value = entry.name; input.disabled = !can;
      input.addEventListener('change', () => { const changed = input.value !== data.lists[selected]?.songs[index]?.name; const next = structuredClone(data); next.lists[selected].songs[index].name = input.value; if (!save(next, false)) input.value = entry.name; else if (changed) motion('rename', input); });
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
    else emitInteractionMotion(find('[data-create]'), 'save');
  });
  find('[data-add]').addEventListener('click', capture);
  find('[data-rename]').addEventListener('change', event => {
    if (!data.lists[selected]) return;
    const changed = data.lists[selected].name !== event.target.value;
    const next = structuredClone(data); next.lists[selected].name = event.target.value;
    if (save(next, false)) { find('[data-select]').options[selected].textContent = event.target.value; if (changed) motion('rename', event.target); }
    else event.target.value = data.lists[selected].name;
  });
  find('[data-import]').addEventListener('change', async event => {
    const token = ++generation;
    clearPreview();
    try {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      if (file.size > MAX_BYTES) throw new Error('Library must be 2 MB or smaller.');
      const raw = await file.text();
      if (token === generation && allowed()) stageImport(raw);
    } catch (error) { if (token === generation && allowed()) status(`Import rejected: ${error.message}`); }
  });
  find('[data-export]').addEventListener('click', () => {
    try {
      const url = URL.createObjectURL(new Blob([exportText()], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'metronominal-rehearsal.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0); status('Library exported.'); motion('download', '[data-export]');
    } catch (error) { status(error.message); }
  });
  find('[data-select]').addEventListener('change', event => { const changed = selected !== Number(event.target.value); generation++; selected = Number(event.target.value); loaded = -1; render(); if (changed) motion('select', '[data-select]'); });
  find('[data-cue-add]').addEventListener('click', () => {
    if (!allowed() || !text(find('[data-cue-text]').value, 140) || data.cues.length >= 100) { status('Enter cue text (1–140 characters).'); return; }
    const next = structuredClone(data);
    next.cues.push({ song: AppState.getSong().name, text: find('[data-cue-text]').value.trim(), bar: Number(find('[data-cue-bar]').value) });
    if (save(next)) { find('[data-cue-text]').value = ''; motion('save', '[data-cue-add]'); }
  });
  find('[data-merge]').addEventListener('click', () => commitImport('merge'));
  find('[data-replace]').addEventListener('click', () => commitImport('replace'));
  find('[data-apply-restore]').addEventListener('click', () => commitImport('restore'));
  find('[data-restore]').addEventListener('click', restoreBackup);
  find('[data-cancel]').addEventListener('click', () => { const hadPreview = Boolean(preview); generation++; clearPreview(); render(); if (hadPreview) motion('cancel', '[data-import]'); });
  for (const [selector, getter, filename] of [
    ['[data-export-backup]', () => backupRaw, 'metronominal-rehearsal-backup.json'],
    ['[data-export-original]', () => originalRaw, 'metronominal-rehearsal-raw-recovery.json'],
  ]) find(selector).addEventListener('click', () => { try { download(getter(), filename, true); } catch (error) { status(error.message); } });
  const refresh = () => { generation++; clearPreview(); render(); };
  const roleRefresh = () => { generation++; clearPreview(); find('[data-auto]').checked = false; displayRoomCue(); render(); };
  const listeners = { syncrolechange: roleRefresh, roomauthoritychange: roleRefresh, playbackstatechange: refresh, historyboundary: refresh, appstatechange: render, rehearsalroomchange: displayRoomCue, songpositionchange: onBar };
  for (const [event, listener] of Object.entries(listeners)) document.addEventListener(event, listener);
  displayRoomCue(); render();
  return { load, importText, exportText, stageImport, commitImport, restoreBackup, destroy() { disposed = true; generation++; for (const [event, listener] of Object.entries(listeners)) document.removeEventListener(event, listener); shell.remove(); } };
}
