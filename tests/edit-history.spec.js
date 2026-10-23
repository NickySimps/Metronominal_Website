const { test, expect } = require('@playwright/test');
const pageErrors = new WeakMap();
test.beforeEach(({ page }) => {
  const errors = []; pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
});
test.afterEach(({ page }) => expect(pageErrors.get(page)).toEqual([]));

async function ready(page) {
  // Isolated component harness: real modules, audio assets and HTTP; no signaling mock.
  await page.goto('/js/beatTiming.js');
  await page.setContent('<base href="/"><main id="history-root"></main><input aria-label="Native text"/><div contenteditable="true">Text</div>');
  await page.evaluate(async () => {
    const { default: app } = await import('/js/appState.js');
    window.app = app;
    app.initializeAudioContext();
    await app.loadAudioBuffers();
    app.resetState();
    app.updateTrack(0, { swing: 0, pitchShift: 0 });
    const history = await import('/js/editHistory.js');
    window.historyControls = history.initializeHistoryControls(document.querySelector('main'));
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/edit-history.css'; document.head.append(css);
    window.applied = 0;
    document.addEventListener('historyapplied', () => window.applied++);
  });
}

test('real tempo edits undo and redo once, invalidating redo on a new edit', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => app.setTempo(171));
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await page.evaluate(() => app.getTempo())).toBe(120);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect(await page.evaluate(() => app.getTempo())).toBe(171);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.evaluate(() => app.setTempo(149));
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => applied)).toBe(3);
});

test('local song imports become one undoable edit instead of clearing musical history', async ({ page }) => {
  // Isolate the import/history seam; room authority is verified by the real multi-peer suite.
  await page.route('**/js/webrtc.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export function getSyncDiagnostics(){return {role:"host"}}; export function sendState(){};' }));
  await page.route('**/js/metronomeEngine.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export default {};' }));
  await ready(page);
  const result = await page.evaluate(async () => {
    const { default: songs } = await import('/js/songController.js');
    window.isHost = true; // Component-only host fixture, not a signaling assertion.
    const payload = await songs.createPayload();
    payload.state.tempo = 173;
    await songs.applyPayload(payload);
    const loaded = app.getTempo();
    const undone = await historyControls.undo();
    const reversed = app.getTempo();
    const redone = await historyControls.redo();
    return { loaded, undone, reversed, redone, final: app.getTempo() };
  });
  expect(result).toEqual({ loaded: 173, undone: true, reversed: 120, redone: true, final: 173 });
});

test('local saved presets are undoable without reverting the device theme', async ({ page }) => {
  await page.route('**/js/themeController.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export default {};' }));
  await page.route('**/js/uiController.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export default {};' }));
  await ready(page);
  const result = await page.evaluate(async () => {
    const { default: presets } = await import('/js/presetController.js');
    window.isHost = true;
    const payload = await app.getCurrentStateForPreset(true);
    payload.tempo = 174; payload.selectedTheme = 'synthwave';
    localStorage.setItem('metronomePreset_0', JSON.stringify(payload));
    await presets.loadPreset(0);
    const loaded = app.getTempo();
    const undone = await historyControls.undo();
    return { loaded, undone, tempo: app.getTempo(), theme: app.getCurrentTheme() };
  });
  expect(result).toEqual({ loaded: 174, undone: true, tempo: 120, theme: 'synthwave' });
});

test('remote or initial preset loads clear history and never become local edits', async ({ page }) => {
  await ready(page);
  await page.evaluate(async () => {
    app.setTempo(180);
    const remote = await app.getCurrentStateForPreset(true);
    remote.tempo = 95;
    await app.loadPresetData(remote);
  });
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => app.getTempo())).toBe(95);
});

test('one transaction reverses bars tracks sounds and song snapshots without cloning audio nodes', async ({ page, browserName }) => {
  await ready(page);
  test.skip(browserName === 'webkit' && process.platform === 'win32' && !(await page.evaluate(() => typeof AudioBuffer === 'function' && typeof AnalyserNode === 'function')), 'This Windows WebKit build lacks native Web Audio. Native buffer/routing proof requires a supported browser or real iOS device.');
  const result = await page.evaluate(async () => {
    const history = await import('/js/editHistory.js');
    const sample = app.getSoundBuffer('Click1.mp3');
    if (!(sample instanceof AudioBuffer)) throw new Error('Actual local sample must decode');
    const before = app.getMusicalSnapshot();
    const token = history.beginEditTransaction('Arrangement');
    app.updateBarArray(3);
    app.toggleBeatRest(0, 0, 1);
    app.setBeatSound(0, 0, 2, 'mainBeatSound', { sound: 'Click1.mp3', settings: { volume: 0.4 } });
    app.addTrack();
    app.setSong({ enabled: true, name: 'Snapshot song', sections: [{ name: 'Verse', startBar: 0, tempo: 120, repeats: 2, tracks: app.getMusicalSnapshot().Tracks }] });
    history.commitEditTransaction(token);
    const after = app.getMusicalSnapshot();
    await historyControls.undo();
    const reversed = app.getMusicalSnapshot();
    await historyControls.redo();
    return { before, after, reversed, redone: app.getMusicalSnapshot(), sameBuffer: sample === app.getSoundBuffer('Click1.mp3'), liveNodes: app.getTracks().every(t => t.analyserNode instanceof AnalyserNode), playing: app.isPlaying() };
  });
  expect(result.reversed).toEqual(result.before);
  expect(result.redone).toEqual(result.after);
  expect(result.sameBuffer).toBe(true);
  expect(result.liveNodes).toBe(true);
  expect(result.playing).toBe(false);
});

test('theme monitoring latency and transport positions neither enter nor replay in history', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const { default: monitoring } = await import('/js/monitoring.js');
    monitoring.setVolume(0.27); monitoring.setMuted(true);
    app.setCurrentTheme('synthwave'); app.setLatencyOffset(123);
    app.updateTrack(0, { currentBar: 0, currentBeat: 3, nextBeatTime: 900 });
    const empty = document.querySelector('.edit-history button').disabled;
    app.setTempo(170);
    app.updateTrack(0, { currentBeat: 2, nextBeatTime: 888 });
    await historyControls.undo();
    return { empty, theme: app.getCurrentTheme(), latency: app.getLatencyOffset(), monitor: monitoring.getState(), position: [app.getTracks()[0].currentBeat, app.getTracks()[0].nextBeatTime], snapshot: JSON.stringify(app.getMusicalSnapshot()) };
  });
  expect(result.empty).toBe(true);
  expect(result.theme).toBe('synthwave'); expect(result.latency).toBe(123);
  expect(result.monitor).toMatchObject({ volume: 0.27, muted: true });
  expect(result.position).toEqual([0, 0]);
  expect(result.snapshot).not.toMatch(/analyserNode|AudioContext|nextBeatTime|currentBeat|selectedTheme|serializedRecordings/);
});

test('local arrangement load is undoable while asynchronous remote replacement invalidates an open transaction', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const history = await import('/js/editHistory.js');
    const data = await app.getCurrentStateForPreset(true);
    data.tempo = 181;
    await app.loadPresetData(data, { history: 'local' });
    await historyControls.undo();
    const tempo = app.getTempo();
    const transaction = history.beginEditTransaction('Pending edit');
    app.setTempo(199);
    await app.loadPresetData({ ...data, tempo: 91 });
    return { tempo, committed: history.commitEditTransaction(transaction), undone: await historyControls.undo(), remoteTempo: app.getTempo() };
  });
  expect(result).toEqual({ tempo: 120, committed: false, undone: false, remoteTempo: 91 });
});

test('keyboard shortcuts preserve native text undo and work on non-text controls', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => app.setTempo(165));
  await page.getByLabel('Native text').fill('Test');
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => app.getTempo())).toBe(165);
  await page.getByRole('button', { name: 'Undo', exact: true }).focus();
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => app.getTempo())).toBe(120);
  await page.keyboard.press('Control+Shift+z');
  expect(await page.evaluate(() => app.getTempo())).toBe(165);
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+y');
  expect(await page.evaluate(() => app.getTempo())).toBe(165);
});

test('in-place legacy controller edits notify history even with a shallow updateTrack payload', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const track = app.getTracks()[0];
    const before = app.getMusicalSnapshot();
    const bars = [...track.barSettings];
    bars[0].rests = [2]; bars[0].velocities = { 1: 0.3 };
    app.updateTrack(0, { barSettings: bars });
    const captured = !document.querySelector('.edit-history button').disabled;
    await historyControls.undo();
    return { captured, before, afterUndo: app.getMusicalSnapshot() };
  });
  expect(result.captured).toBe(true);
  expect(result.afterUndo).toEqual(result.before);
});

test('slider repeats batch but different track properties remain separate undo steps', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    app.setTempo(121); app.setTempo(122); app.setTempo(123);
    await historyControls.undo();
    const tempo = app.getTempo();
    app.updateTrack(0, { volume: 0.4 });
    app.updateTrack(0, { swing: 32 });
    await historyControls.undo();
    return { tempo, volume: app.getTracks()[0].volume, swing: app.getTracks()[0].swing };
  });
  expect(result).toEqual({ tempo: 120, volume: 0.4, swing: 0 });
});

test('authority event seam rejects client shortcuts and clears a host history on room change', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    app.setTempo(160);
    document.dispatchEvent(new CustomEvent('syncrolechange', { detail: { state: 'connected', isHost: false } }));
    const clientUndo = await historyControls.undo();
    app.setTempo(161);
    const clientCaptured = !document.querySelector('.edit-history button').disabled;
    document.dispatchEvent(new CustomEvent('syncrolechange', { detail: { state: 'connected', isHost: true } }));
    app.setTempo(180);
    await historyControls.undo();
    const hostTempo = app.getTempo();
    app.setTempo(190);
    document.dispatchEvent(new CustomEvent('roomauthoritychange'));
    return { clientUndo, clientCaptured, hostTempo, roomUndo: await historyControls.undo(), tempo: app.getTempo() };
  });
  expect(result).toEqual({ clientUndo: false, clientCaptured: false, hostTempo: 161, roomUndo: false, tempo: 190 });
});

test('held asynchronous reconstruction cannot replay an old room or publish a history event', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    app.setTempo(166);
    const original = app.loadPresetData;
    let release;
    const held = new Promise(resolve => { release = resolve; });
    app.loadPresetData = async (...args) => { await held; return original(...args); };
    const undo = historyControls.undo();
    document.dispatchEvent(new CustomEvent('syncrolechange', { detail: { state: 'connected', isHost: false } }));
    release();
    const result = await undo;
    app.loadPresetData = original;
    return { result, tempo: app.getTempo(), applied };
  });
  expect(result).toEqual({ result: false, tempo: 166, applied: 0 });
});

test('nested musical snapshots exclude transport credentials and runtime-only bar or sound metadata', async ({ page }) => {
  await ready(page);
  const snapshot = await page.evaluate(() => {
    const track = app.getTracks()[0];
    track.barSettings[0].currentBeat = 88;
    track.barSettings[0].password = 'secret-sentinel';
    track.mainBeatSound.audioData = 'private-audio-sentinel';
    track.mainBeatSound.settings.clockOffset = 10;
    return JSON.stringify(app.getMusicalSnapshot());
  });
  expect(snapshot).not.toMatch(/currentBeat|password|secret-sentinel|private-audio-sentinel|clockOffset/);
});

test('sound preset definitions undo without copying a private AudioBuffer', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const sample = app.getSoundBuffer('Click1.mp3');
    app.setSoundBuffer('Private take', sample); app.addRecording('Private take');
    app.addCustomSound('Quiet kick', 'Synth Kick', { volume: 0.2 });
    const canUndo = await historyControls.undo();
    const removed = !app.getCustomSoundData('Quiet kick');
    await historyControls.redo();
    return { canUndo, removed, restored: app.getCustomSoundData('Quiet kick'), bufferSafe: app.getSoundBuffer('Private take') === sample, snapshot: JSON.stringify(app.getMusicalSnapshot()) };
  });
  expect(result.canUndo).toBe(true); expect(result.removed).toBe(true);
  expect(result.restored).toEqual({ baseSound: 'Synth Kick', settings: { volume: 0.2 } });
  expect(result.bufferSafe).toBe(true);
  expect(result.snapshot).not.toMatch(/Private take|serializedRecordings|AudioBuffer/);
});

test('explicit raw-object transaction establishes the next undo baseline', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const history = await import('/js/editHistory.js');
    const token = history.beginEditTransaction('Rename track');
    app.getTracks()[0].name = 'Percussion';
    history.commitEditTransaction(token);
    app.setTempo(150);
    await historyControls.undo();
    return { name: app.getTracks()[0].name, tempo: app.getTempo() };
  });
  expect(result).toEqual({ name: 'Percussion', tempo: 120 });
});

test('musical edits made during playback invalidate older stopped-only history', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    app.setTempo(140);
    await app.togglePlay();
    app.toggleBeatRest(0, 0, 1);
    app.resetPlaybackState();
    return { undo: await historyControls.undo(), rests: app.getTracks()[0].barSettings[0].rests };
  });
  expect(result).toEqual({ undo: false, rests: [1] });
});

test('transport blocks replay and the entry limit is fifty meaningful edits', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    app.setTempo(160);
    await app.togglePlay();
    const playingUndo = await historyControls.undo();
    app.resetPlaybackState(); historyControls.clear();
    for (let i = 0; i < 55; i++) app.toggleBeatRest(0, 0, 0);
    let count = 0; while (await historyControls.undo()) count++;
    return { playingUndo, count, playing: app.isPlaying() };
  });
  expect(result).toEqual({ playingUndo: false, count: 50, playing: false });
});

test('mobile history buttons have usable targets and stay within a 320px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await ready(page);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  const rectangles = await page.locator('.edit-history button, .edit-history [role="status"]').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { x:r.x, right:r.right, height:r.height }; }));
  for (const r of rectangles) { expect(r.x).toBeGreaterThanOrEqual(0); expect(r.right).toBeLessThanOrEqual(320); }
  for (const r of rectangles.slice(0, 2)) expect(r.height).toBeGreaterThanOrEqual(44);
});
