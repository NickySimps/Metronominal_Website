import AppState from './appState.js';
import { getSlotInfo, getVisualBeatSlots } from './beatTiming.js';
import * as Room from './webrtc.js';
import { createMidiInputController } from './midiController.js';

const mounts = new WeakMap();

/** A read-only stage display. All transport actions use the existing main button. */
export function initializePerformanceView(root, options = {}) {
  if (!root?.append) return null;
  if (mounts.has(root)) return mounts.get(root);
  const doc = root.ownerDocument;
  const externalLauncher = options.launcher?.addEventListener ? options.launcher : null;
  const trigger = externalLauncher || doc.createElement('button');
  const triggerBefore = {disabled:trigger.disabled,expanded:trigger.getAttribute('aria-expanded')};
  if (!externalLauncher) { trigger.type = 'button'; trigger.textContent = 'Performance view'; root.append(trigger); }
  trigger.setAttribute('aria-expanded', 'false');
  const launchHint = externalLauncher ? doc.createElement('p') : null;
  if (launchHint) { launchHint.setAttribute('role','status');launchHint.textContent='Use Performance view in the main toolbar for the full-screen stage display. MIDI input is optional and connected only on request.';root.append(launchHint); }
  const shell = doc.createElement('section');
  shell.className = 'performance-view'; shell.hidden = true;
  shell.setAttribute('role', 'region'); shell.setAttribute('aria-label', 'Performance');
  shell.innerHTML = `<header><h2>Performance</h2><button type="button" data-performance-exit>Exit performance view</button></header>
    <p data-performance-status role="status"></p>
    <div class="performance-readout"><div class="performance-tempo"><strong data-performance-tempo></strong><span>BPM</span></div>
    <div class="performance-position" data-performance-position></div></div>
    <div class="performance-sections"><p>Current section <strong data-performance-section></strong></p><p>Next section <strong data-performance-next></strong></p><p data-performance-repeats></p></div>
    <p class="performance-cue" data-performance-cue aria-live="polite">No room cue</p>
    <div class="performance-actions"><button type="button" data-performance-play>Play</button><button type="button" data-performance-section-next>Next section</button></div>
    <label class="performance-overview-toggle"><input type="checkbox" data-performance-keep-overview> Keep track overview</label><ul data-performance-overview hidden></ul>
    <details class="performance-midi"><summary>MIDI footswitch settings</summary>
      <p>Optional Web MIDI depends on this browser and device. No universal iPhone MIDI support. Touch and keyboard always work. A footswitch cannot always unlock audio: press Play on this device first.</p>
      <button type="button" data-performance-midi-connect>Connect MIDI</button>
      <label>MIDI input device <select aria-label="MIDI input device" data-performance-midi-device><option value="">Select a device</option></select></label>
      <label class="performance-check"><input type="checkbox" data-performance-midi-enabled> Enable MIDI input</label>
      <label>Footswitch action <select aria-label="Footswitch action" data-performance-midi-action><option value="toggle">Play/Stop toggle</option><option value="start">Start</option><option value="stop">Stop</option><option value="nextSection">Next section</option></select></label>
      <p data-performance-midi-mapping>Not mapped</p>
      <div class="performance-midi-config"><label>Message <select data-performance-midi-type><option value="note">Note</option><option value="cc">CC (threshold 64)</option></select></label><label>Channel <input data-performance-midi-channel type="number" min="1" max="16" value="1"></label><label>Note / CC number <input data-performance-midi-number type="number" min="0" max="127" value="60"></label></div>
      <div class="performance-midi-buttons"><button type="button" data-performance-midi-save>Save mapping</button><button type="button" data-performance-midi-learn>Learn footswitch</button><button type="button" data-performance-midi-cancel>Cancel learn</button><button type="button" data-performance-midi-clear>Clear mapping</button></div>
      <p data-performance-midi-status role="status" aria-live="polite"></p>
    </details>
    <p>Space: Play/Stop · N: Next section · Escape: Exit. Touch controls always available.</p>`;
  doc.body.append(shell);
  const find = selector => shell.querySelector(selector);
  const listeners = [];
  let active = false, destroyed = false, generation = 0, nativeFullscreen = false, focusBefore = null;
  const inertBefore = new Map();
  const cueAvailable = () => typeof options.onCue === 'function' && typeof options.canCue === 'function' && options.canCue() === true;
  if (typeof options.onCue === 'function') {
    const option=doc.createElement('option');option.value='cue';option.textContent='Send configured cue';find('[data-performance-midi-action]').append(option);
  }
  function midiAllowed(action) {
    if (!active || !authority() || modalOpen()) return false;
    if (action === 'nextSection') return nextAllowed();
    if (action === 'cue') return cueAvailable();
    return transportAllowed();
  }
  function midiTransport(action) {
    if (!midiAllowed(action)) return;
    const playing = Room.getDesiredHostPlaybackState?.() ?? AppState.isPlaying();
    if ((action === 'start' && playing) || (action === 'stop' && !playing)) return;
    if (!playing && AppState.getAudioContext()?.state !== 'running') {
      find('[data-performance-midi-status]').textContent = 'Audio needs a user gesture: press Play on this device before starting with a footswitch.';
      return;
    }
    play();
  }
  const midi = createMidiInputController({document:doc,canControl:midiAllowed,
    actions:{start:()=>midiTransport('start'),stop:()=>midiTransport('stop'),toggle:()=>midiTransport('toggle'),nextSection:next,
      ...(typeof options.onCue === 'function' ? {cue:()=>{if(midiAllowed('cue'))return options.onCue();}} : {})},
    onStatus:message=>{if(!destroyed)find('[data-performance-midi-status]').textContent=message;},
    onChange:()=>{if(!destroyed)renderMidi();}
  });
  function renderMidi() {
    const state = midi.getState();
    const device = find('[data-performance-midi-device]');
    const current = [...device.options].slice(1).map(option=>[option.value,option.textContent]);
    const nextInputs = state.inputs.map(input=>[input.id,input.name]);
    if (JSON.stringify(current) !== JSON.stringify(nextInputs)) {
      const placeholder=doc.createElement('option');placeholder.value='';placeholder.textContent='Select a device';
      device.replaceChildren(placeholder,...state.inputs.map(input=>{const option=doc.createElement('option');option.value=input.id;option.textContent=input.name;return option;}));
    }
    device.value=state.selectedId;
    const enable=find('[data-performance-midi-enabled]');enable.checked=state.enabled;
    enable.disabled=!active || !authority() || !state.inputs.some(input=>input.id===state.selectedId);
    const action=find('[data-performance-midi-action]').value;
    for(const option of find('[data-performance-midi-action]').options) option.disabled=!midiAllowed(option.value);
    const mapping=state.mappings[action];
    find('[data-performance-midi-mapping]').textContent=mapping?`${mapping.type === 'cc'?'CC':'Note'} ${mapping.number} · channel ${mapping.channel}`:'Not mapped';
    find('[data-performance-midi-learn]').disabled=!state.enabled||!midiAllowed(action);
    find('[data-performance-midi-cancel]').disabled=!state.learning;
    find('[data-performance-midi-save]').disabled=!state.selectedId||!midiAllowed(action);
    find('[data-performance-midi-clear]').disabled=!mapping||!midiAllowed(action);
  }
  function on(target, name, handler, settings) {
    target.addEventListener(name, handler, settings);
    listeners.push(() => target.removeEventListener(name, handler, settings));
  }
  function authority() {
    const diagnostics = Room.getSyncDiagnostics();
    // A connecting/recovering room is not a solo session.
    return diagnostics.role === 'offline'
      ? !Room.isSynchronizationJoined() && diagnostics.status === 'disconnected'
      : diagnostics.role === 'host' && diagnostics.status === 'connected' && window.isHost === true;
  }
  const mainButton = () => doc.getElementById('start-stop-btn');
  const transportAllowed = () => !destroyed && authority() && Boolean(mainButton()) && !mainButton().disabled;
  const nextAllowed = () => !destroyed && authority() && AppState.getSong().enabled && AppState.getSong().sections.length > 1;
  function play() { if (transportAllowed()) mainButton().click(); }
  function next() { if (nextAllowed()) doc.dispatchEvent(new CustomEvent('metronominal:section-next')); }
  function modalOpen() {
    return [...doc.querySelectorAll('[aria-modal="true"],dialog[open],.modal')].some(element => !element.hidden && getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden' && element.getClientRects().length);
  }
  function refresh() {
    if (destroyed) return;
    const track = AppState.getTracks()[0];
    const highlight = doc.querySelector('#all-tracks-wrapper .bar-visual[data-container-index="0"] .beat-square.highlighted, #all-tracks-wrapper .bar-visual[data-container-index="0"] .beat-square.highlighted-sub');
    const bar = highlight ? Number(highlight.closest('.bar-visual').dataset.barIndex) : track?.currentBar || 0;
    const slot = highlight ? Number(highlight.dataset.beatIndex) : track?.currentBeat || 0;
    const barSetting = track?.barSettings[bar];
    const beat = (highlight ? getVisualBeatSlots(barSetting)[slot]?.sourceBeat : getSlotInfo(barSetting, slot)?.sourceBeat) ?? 0;
    const song = AppState.getSong();
    const section = AppState.getSongSectionForBar(bar);
    find('[data-performance-tempo]').textContent = AppState.getPlaybackTempo(bar);
    find('[data-performance-position]').textContent = `Bar ${bar + 1} · Beat ${beat + 1}`;
    find('[data-performance-section]').textContent = song.enabled ? section.name : 'Song mode off';
    find('[data-performance-next]').textContent = song.enabled ? song.sections[section.index + 1]?.name || song.sections[0]?.name || '—' : '—';
    find('[data-performance-repeats]').textContent = song.enabled ? `${Math.max(0, section.repeats - (track?.songRepeatIteration || 0) - 1)} repeats remaining after this pass` : 'Continuous playback';
    const room = Room.getRehearsalRoomState();
    find('[data-performance-cue]').textContent = room.supported && room.cue?.text ? room.cue.text : 'No room cue';
    find('[data-performance-play]').textContent = AppState.isPlaying() ? 'Stop' : 'Play';
    find('[data-performance-play]').disabled = !transportAllowed();
    find('[data-performance-section-next]').disabled = !nextAllowed();
    const overview = find('[data-performance-overview]');
    overview.hidden = !find('[data-performance-keep-overview]').checked;
    if (!overview.hidden) {
      const names = AppState.getTracks().map((item, index) => `${item.name || `Track ${index + 1}`} · ${item.barSettings.length} bars${item.muted ? ' · muted' : ''}`);
      if (overview.textContent !== names.join('')) overview.replaceChildren(...names.map(name => {const li=doc.createElement('li');li.textContent=name;return li;}));
    }
    // Prefer a theme surface, but always derive the readable black/white foreground.
    const rgb = getComputedStyle(shell).backgroundColor.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [17,24,39];
    const linear = rgb.map(value => { const v=value/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4; });
    const luminance = .2126*linear[0]+.7152*linear[1]+.0722*linear[2];
    // Keep the paired theme token live across palette changes while the stage
    // is open; standalone mounts without app tokens retain derived contrast.
    const themeInk = getComputedStyle(shell).getPropertyValue('--ReadableOnBackground').trim();
    shell.style.setProperty('--stage-fg', themeInk ? 'var(--ReadableOnBackground)' : luminance > .179 ? '#000' : '#fff');
    renderMidi();
  }
  async function enter() {
    if (destroyed || active) return;
    active = true; const token = ++generation; focusBefore = doc.activeElement;
    shell.hidden = false; doc.body.classList.add('performance-active'); trigger.setAttribute('aria-expanded', 'true');
    for (const element of doc.querySelectorAll('.main-container')) { inertBefore.set(element, element.inert); element.inert = true; }
    refresh(); find('[data-performance-exit]').focus();
    if (!doc.documentElement.requestFullscreen) { find('[data-performance-status]').textContent = 'Fullscreen unavailable. Expanded performance view is active.'; return; }
    try {
      await doc.documentElement.requestFullscreen();
      if (!active || destroyed || token !== generation) { if (doc.fullscreenElement === doc.documentElement) await doc.exitFullscreen(); return; }
      nativeFullscreen = doc.fullscreenElement === doc.documentElement;
      find('[data-performance-status]').textContent = nativeFullscreen ? 'Fullscreen performance view.' : 'Fullscreen unavailable. Expanded performance view is active.';
    } catch {
      if (active && token === generation) find('[data-performance-status]').textContent = 'Fullscreen was denied. Expanded performance view is active; Exit or Escape returns to editing.';
    }
  }
  function exit() {
    if (!active) return;
    active = false; generation++; midi.setEnabled(false); shell.hidden = true; doc.body.classList.remove('performance-active'); trigger.setAttribute('aria-expanded', 'false');
    for (const [element, previous] of inertBefore) element.inert = previous;
    inertBefore.clear();
    if (nativeFullscreen && doc.fullscreenElement === doc.documentElement) doc.exitFullscreen().catch(() => {});
    nativeFullscreen = false;
    const returnTarget = focusBefore?.isConnected && focusBefore !== doc.body && focusBefore !== doc.documentElement ? focusBefore : trigger;
    if (returnTarget?.isConnected) returnTarget.focus();
  }
  on(find('[data-performance-midi-connect]'), 'click', () => { void midi.connect(); });
  on(find('[data-performance-midi-device]'), 'change', event => midi.selectInput(event.target.value));
  on(find('[data-performance-midi-enabled]'), 'change', event => midi.setEnabled(event.target.checked));
  on(find('[data-performance-midi-action]'), 'change', renderMidi);
  on(find('[data-performance-midi-learn]'), 'click', () => midi.learn(find('[data-performance-midi-action]').value));
  on(find('[data-performance-midi-cancel]'), 'click', () => midi.cancelLearn());
  on(find('[data-performance-midi-clear]'), 'click', () => midi.setMapping(find('[data-performance-midi-action]').value, null));
  on(find('[data-performance-midi-save]'), 'click', () => {
    const action=find('[data-performance-midi-action]').value;
    if (!midiAllowed(action)) return;
    if (!midi.setMapping(action,{type:find('[data-performance-midi-type]').value,channel:Number(find('[data-performance-midi-channel]').value),number:Number(find('[data-performance-midi-number]').value)})) find('[data-performance-midi-status]').textContent='Choose channel 1–16 and note / CC number 0–127.';
  });
  on(trigger, 'click', enter); on(find('[data-performance-exit]'), 'click', exit);
  on(find('[data-performance-play]'), 'click', play);
  on(find('[data-performance-section-next]'), 'click', next);
  on(find('[data-performance-keep-overview]'), 'change', refresh);
  on(doc, 'fullscreenchange', () => { if (nativeFullscreen && !doc.fullscreenElement) exit(); });
  on(doc, 'keydown', event => {
    if (!active || event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || modalOpen() || event.target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
    if (event.key === 'Escape') { event.preventDefault(); exit(); }
    else if (event.key.toLowerCase() === 'n') { event.preventDefault(); next(); }
    else if (['r','t','l','s','d','=','+','-','_','[',']',"'",';'].includes(event.key.toLowerCase())) event.preventDefault();
    else if (event.key === ' ' && !transportAllowed()) event.preventDefault();
    // Authorized Space belongs to the global shortcut or native focused button.
  }, true);
  const observedTracks = doc.getElementById('all-tracks-wrapper');
  const observer = new MutationObserver(() => { if (active) refresh(); });
  if (observedTracks) observer.observe(observedTracks, {attributes:true,attributeFilter:['class'],childList:true,subtree:true});
  const controller = { enter, exit, refresh, midi, destroy() {
    if (destroyed) return;
    exit(); destroyed = true; midi.destroy(); observer.disconnect(); listeners.forEach(remove => remove());
    if (externalLauncher) { trigger.disabled=triggerBefore.disabled; if(triggerBefore.expanded===null)trigger.removeAttribute('aria-expanded');else trigger.setAttribute('aria-expanded',triggerBefore.expanded); }
    else trigger.remove();
    launchHint?.remove(); shell.remove(); mounts.delete(root);
  } };
  for (const name of ['appstatechange', 'playbackstatechange', 'songpositionchange', 'songtracksectionchange', 'rehearsalroomchange', 'syncrolechange', 'roomauthoritychange']) on(doc, name, refresh);
  find('[data-performance-midi-status]').textContent = navigator.requestMIDIAccess ? 'MIDI not connected. Connect MIDI only if you want a footswitch.' : 'Web MIDI unavailable in this browser. Use touch or keyboard controls.';
  refresh(); trigger.disabled=false; mounts.set(root, controller); return controller;
}
