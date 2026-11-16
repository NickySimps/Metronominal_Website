const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { recordingModalMarkup } = require('./recordingMenuMarkup.cjs');

// Isolated real state/capture/editor composition; generated input only.
const temp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'voice-apply-'));
const wavPath = path.join(temp, 'generated.wav');
const rate = 48000, frames = rate * 4, wav = Buffer.alloc(44 + frames * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40);
for (let i = 0; i < frames; i++) wav.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * 440 * i / rate)), 44 + i * 2);
fs.writeFileSync(wavPath, wav);
test.use({ channel: 'chrome', launchOptions: { args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wavPath}`] }, permissions: ['microphone'] });
let server, origin;
test.beforeAll(async () => {
  const root = path.join(__dirname, '..');
  server = http.createServer((req, res) => {
    if (req.url === '/') {
      // Real modal bytes; mode controls live INSIDE the modal per the menu contract.
      const { modal } = recordingModalMarkup(root);
      res.setHeader('Content-Type', 'text/html');
      res.end(`<!doctype html><link rel="stylesheet" href="/voice-note-display.css"><link rel="stylesheet" href="/voice-take-editor.css"><style>body{margin:0}.modal{display:none;position:fixed;inset:0;padding:8px;background:#111}.modal-content{width:100%;max-width:900px;margin:auto;box-sizing:border-box}button{min-height:44px}</style><button id="rec">Rec</button><div id="history"></div>${modal}`); return;
    }
    if (req.url === '/js/tracksController.js') { res.setHeader('Content-Type', 'text/javascript'); res.end('export default {renderTracks(){}}'); return; }
    if (req.url === '/js/3D/threeDSceneManager.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(''); return; }
    if (req.url === '/js/3D/3dTheme.js') { res.setHeader('Content-Type', 'text/javascript'); res.end('export default {isActive(){return false}};'); return; }
    if (!/^\/(js\/[a-zA-Z]+\.js|voice-(note-display|take-editor)\.css)$/.test(req.url)) { res.writeHead(404); res.end(); return; }
    fs.readFile(path.join(root, req.url), (error, bytes) => { res.writeHead(error ? 404 : 200, { 'Content-Type': req.url.endsWith('.css') ? 'text/css' : 'text/javascript' }); res.end(bytes); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(temp, { force: true, recursive: true }); });

for (const boundary of ['authority-generation', 'host-drift', 'replace-identical-track', 'changed-bars']) {
  test(`${boundary} refuses the exact stale destination before any musical write`, async ({ page }) => {
    await ready(page); await preview(page);
    await page.evaluate(async boundary => {
      if (boundary === 'authority-generation') {
        document.dispatchEvent(new Event('roomauthoritychange'));
        document.dispatchEvent(new Event('roomauthoritychange'));
      } else if (boundary === 'host-drift') window.isHost = false;
      else if (boundary === 'replace-identical-track') {
        const old = a.getTracks()[0];
        if (!await a.applyMusicalSnapshot(a.getMusicalSnapshot()) || old === a.getTracks()[0]) throw new Error('Expected real track identity replacement');
      } else a.updateTrack(0, { barSettings: [{ beats: 3, subdivision: 1, rests: [] }] });
      window.boundarySnapshot = a.getMusicalSnapshot(); window.mutations = 0;
    }, boundary);
    await page.getByRole('button', { name: 'Apply draft', exact: true }).click();
    await expect(page.locator('.voice-take-editor [role="status"]')).toContainText(boundary.includes('authority') || boundary === 'host-drift' ? 'host authority changed' : 'exact source track or its bars changed');
    expect(await page.evaluate(() => ({ same: JSON.stringify(a.getMusicalSnapshot()) === JSON.stringify(boundarySnapshot), changes: mutations }))).toEqual({ same: true, changes: 0 });
  });
}

test('Apply atomically creates one editable pitched track with one undoable persist', async ({ page }) => {
  await ready(page); await preview(page);
  const baselineCount = await page.evaluate(() => before.Tracks.length);
  await page.evaluate(() => {
    window.sourceTrack = a.getTracks()[0]; window.storageWrites = 0;
    window.persistedBefore = JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])));
  });
  await page.getByRole('button', { name: 'Apply draft', exact: true }).click();
  await expect(page.locator('.voice-take-editor')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => ({
    count: a.getTracks().length, retainedSource: a.getTracks()[0] === sourceTrack,
    selected: a.getSelectedTrackIndex(), sound: a.getTracks().at(-1)?.mainBeatSound?.sound,
    hasNotes: a.getTracks().at(-1)?.melody?.bars?.some(bar => bar.length > 0), mutations,
    writes: storageWrites,
  }))).toEqual({ count: baselineCount + 1, retainedSource: true, selected: baselineCount, sound: 'Synth Sine', hasNotes: true, mutations: 1, writes: 1 });
  await expect(page.locator('#history button').filter({ hasText: 'Undo' })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => page.evaluate(() => a.getTracks().length)).toBe(baselineCount);
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(() => page.evaluate(() => a.getTracks().length)).toBe(baselineCount + 1);
  expect(await page.evaluate(() => a.getTracks().at(-1).melody.bars.some(bar => bar.length > 0))).toBe(true);
  await page.evaluate(async () => {
    const context = a.getAudioContext(); await context.resume();
    window.nativeMelodyEvents = [];
    const create = context.createOscillator.bind(context);
    context.createOscillator = () => {
      const source = create(), start = source.start.bind(source), set = source.frequency.setValueAtTime.bind(source.frequency);
      const event = { frequency: null, time: null };
      source.frequency.setValueAtTime = (frequency, time) => { event.frequency = frequency; return set(frequency, time); };
      source.start = time => { event.time = time; nativeMelodyEvents.push(event); return start(time); };
      return source;
    };
    window.engine = (await import('/js/metronomeEngine.js')).default;
  });
  await expect.poll(() => page.evaluate(() => engine.isSchedulerReady())).toBe(true);
  await page.evaluate(() => engine.scheduleStart(Date.now() + 350));
  await expect.poll(() => page.evaluate(() => nativeMelodyEvents.some(event => event.frequency === 440 && Number.isFinite(event.time)))).toBe(true);
  expect(await page.evaluate(() => nativeMelodyEvents.find(event => event.frequency === 440))).toEqual(expect.objectContaining({ frequency: 440 }));
  await page.evaluate(() => engine.cancelPlayback());
});

test('Preparation failure rolls back staged monitor routing without changing app state', async ({ page }) => {
  await ready(page); await preview(page); await page.waitForTimeout(350);
  await page.evaluate(async () => {
    const monitor = (await import('/js/monitoring.js')).default;
    const context = a.getAudioContext(), createGain = context.createGain.bind(context);
    window.monitor = monitor; window.monitorBefore = monitor.getState();
    window.trackBefore = JSON.stringify(a.getMusicalSnapshot()); window.selectedBefore = a.getSelectedTrackIndex();
    window.storageWrites = 0; window.mutations = 0; window.monitorEvents = 0; window.stagedRoutes = [];
    document.addEventListener('monitoringchange', () => monitorEvents++);
    context.createGain = () => {
      const node = createGain(), connect = node.connect.bind(node), disconnect = node.disconnect.bind(node);
      node.connect = (destination, ...args) => {
        const result = connect(destination, ...args);
        stagedRoutes.push({ node, connected: true }); return result;
      };
      node.disconnect = (...args) => {
        const result = disconnect(...args);
        const route = stagedRoutes.findLast(item => item.node === node);
        if (route) route.connected = false;
        return result;
      };
      return node;
    };
    context.createAnalyser = () => { throw new Error('fixture analyser preparation failure'); };
  });
  await page.getByRole('button', { name: 'Apply draft', exact: true }).click();
  await expect(page.locator('.voice-take-editor [role="status"]')).toContainText('fixture analyser preparation failure');
  expect(await page.evaluate(() => ({
    sameMusic: JSON.stringify(a.getMusicalSnapshot()) === trackBefore,
    selected: a.getSelectedTrackIndex() === selectedBefore,
    monitorSame: JSON.stringify(monitor.getState()) === JSON.stringify(monitorBefore),
    writes: storageWrites, mutations, monitorEvents,
    stagedConnected: stagedRoutes.some(route => route.connected), stagedCount: stagedRoutes.length,
  }))).toEqual({ sameMusic: true, selected: true, monitorSame: true, writes: 0, mutations: 0, monitorEvents: 0, stagedConnected: false, stagedCount: 1 });
  await expect(page.getByLabel('Edit history').getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

test('Persistence scheduling failure rolls back a committed monitor append and selection', async ({ page }) => {
  await ready(page); await preview(page);
  await page.evaluate(async () => {
    const monitor = (await import('/js/monitoring.js')).default, context = a.getAudioContext();
    window.monitor = monitor; window.monitorBefore = monitor.getState();
    window.outputBefore = monitor.getTrackOutput(context, a.getTracks().length);
    window.trackBefore = JSON.stringify(a.getMusicalSnapshot()); window.selectedBefore = a.getSelectedTrackIndex();
    window.storageWrites = 0; window.mutations = 0; window.monitorEvents = 0;
    document.addEventListener('monitoringchange', () => monitorEvents++);
    const nativeTimeout = window.setTimeout.bind(window);
    window.failPersistenceSchedule = true;
    window.setTimeout = (...args) => {
      if (window.failPersistenceSchedule) { window.failPersistenceSchedule = false; throw new Error('fixture persistence scheduling failure'); }
      return nativeTimeout(...args);
    };
  });
  await page.getByRole('button', { name: 'Apply draft', exact: true }).click();
  await expect(page.locator('.voice-take-editor [role="status"]')).toContainText('fixture persistence scheduling failure');
  expect(await page.evaluate(() => ({
    sameMusic: JSON.stringify(a.getMusicalSnapshot()) === trackBefore,
    selected: a.getSelectedTrackIndex() === selectedBefore,
    monitorSame: JSON.stringify(monitor.getState()) === JSON.stringify(monitorBefore),
    outputRestored: monitor.getTrackOutput(a.getAudioContext(), a.getTracks().length) === outputBefore,
    writes: storageWrites, mutations, monitorEvents,
  }))).toEqual({ sameMusic: true, selected: true, monitorSame: true, outputRestored: true, writes: 0, mutations: 0, monitorEvents: 2 });
});

test('Unsupported percussion destinations fail closed without creating a sample-root control', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    a.updateTrack(0, { mainBeatSound: { sound: 'Synth Kick', settings: {} } });
    window.unsupportedBefore = JSON.stringify(a.getMusicalSnapshot());
    window.mutations = 0; window.storageWrites = 0;
  });
  await preview(page);
  await page.getByLabel('Destination', { exact: true }).selectOption('track:0');
  await expect(page.getByLabel('Sample root MIDI', { exact: true })).toBeHidden();
  // Drain the setup setter's real 300ms debounced persistence before measuring
  // the refused Apply. Otherwise its pending write is misattributed to Apply.
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('metronominalState'))?.Tracks?.[0]?.mainBeatSound?.sound)).toBe('Synth Kick');
  await page.evaluate(() => { window.mutations = 0; window.storageWrites = 0; });
  await page.getByRole('button', { name: 'Apply draft', exact: true }).click();
  await expect(page.locator('.voice-take-editor [role="status"]')).toContainText('Unsupported melody instrument: Synth Kick');
  expect(await page.evaluate(() => ({ same: JSON.stringify(a.getMusicalSnapshot()) === unsupportedBefore, mutations, storageWrites })))
    .toEqual({ same: true, mutations: 0, storageWrites: 0 });
});

test('Apply to a recorded sample track requires and preserves an explicit MIDI root', async ({ page }) => {
  await ready(page);
  const baselineCount = await page.evaluate(() => {
    const target = a.getTracks().length - 1, context = a.getAudioContext();
    const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(2 * Math.PI * 220 * i / context.sampleRate) * 0.2;
    a.setSoundBuffer('Local voice target', buffer);
    window.targetBuffer = buffer;
    a.updateTrack(target, { name: 'Local voice target', barSettings: structuredClone(a.getTracks()[0].barSettings), mainBeatSound: { sound: 'Local voice target', settings: { volume: 0.7 } } });
    window.targetTrack = a.getTracks()[target]; window.targetIndex = target;
    return a.getTracks().length;
  });
  await preview(page);
  await page.getByLabel('Destination', { exact: true }).selectOption(`track:${await page.evaluate(() => targetIndex)}`);
  await page.evaluate(() => { window.applyBefore = JSON.stringify(a.getMusicalSnapshot()); window.mutations = 0; window.storageWrites = 0; });
  await page.getByRole('button', { name: 'Apply draft', exact: true }).click();
  await expect(page.locator('.voice-take-editor [role="status"]')).toContainText('Enter an explicit sample root MIDI from 0 to 127');
  expect(await page.evaluate(() => ({ unchanged: JSON.stringify(a.getMusicalSnapshot()) === window.applyBefore, mutations, storageWrites }))).toEqual({ unchanged: true, mutations: 0, storageWrites: 0 });
  await page.getByLabel('Sample root MIDI', { exact: true }).fill('57');
  await page.evaluate(() => { window.storageWrites = 0; window.mutations = 0; });
  await page.getByRole('button', { name: 'Apply draft', exact: true }).click();
  await expect(page.locator('.voice-take-editor')).toHaveCount(0);
  expect(await page.evaluate(() => ({
    count: a.getTracks().length, sameTrack: a.getTracks()[targetIndex] === targetTrack,
    instrument: a.getTracks()[targetIndex].mainBeatSound.sound,
    root: a.getTracks()[targetIndex].melody.sampleRootMidi,
    midi: a.getTracks()[targetIndex].melody.bars.flat()[0].midi,
    mutations,
  }))).toEqual({ count: baselineCount, sameTrack: true, instrument: 'Local voice target', root: 57, midi: 69, mutations: 1 });
  await expect.poll(() => page.evaluate(() => storageWrites)).toBe(1);
  await expect(page.getByLabel('Edit history').getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await page.getByLabel('Edit history').getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await page.evaluate(() => ({ hasMelody: Object.hasOwn(a.getTracks()[targetIndex], 'melody'), instrument: a.getTracks()[targetIndex].mainBeatSound.sound })))
    .toEqual({ hasMelody: false, instrument: 'Local voice target' });
  await page.getByLabel('Edit history').getByRole('button', { name: 'Redo', exact: true }).click();
  expect(await page.evaluate(() => ({ root: a.getTracks()[targetIndex].melody.sampleRootMidi, bufferRetained: a.getSoundBuffer('Local voice target') === targetBuffer })))
    .toEqual({ root: 57, bufferRetained: true });
  await page.evaluate(async () => {
    const context = a.getAudioContext(); await context.resume();
    window.sampleEvents = []; window.targetBuffer = a.getSoundBuffer('Local voice target');
    const create = context.createBufferSource.bind(context);
    context.createBufferSource = () => {
      const source = create(), start = source.start.bind(source), set = source.playbackRate.setValueAtTime.bind(source.playbackRate);
      const event = { buffer: null, rate: null, time: null };
      source.playbackRate.setValueAtTime = (rate, time) => { event.rate = rate; return set(rate, time); };
      source.start = time => { event.buffer = source.buffer; event.time = time; sampleEvents.push(event); return start(time); };
      return source;
    };
    window.engine = (await import('/js/metronomeEngine.js')).default;
  });
  await expect.poll(() => page.evaluate(() => engine.isSchedulerReady())).toBe(true);
  await page.evaluate(() => engine.scheduleStart(Date.now() + 350));
  await expect.poll(() => page.evaluate(() => sampleEvents.some(event => event.buffer === targetBuffer && event.rate === 2 && Number.isFinite(event.time)))).toBe(true);
  await page.evaluate(() => engine.cancelPlayback());
});

test('tempo and origin are captured before held native acquisition; later BPM does not remap preview', async ({ page }) => {
  await ready(page, true); await page.evaluate(() => audio.setRecordingMode('voice'));
  await page.evaluate(() => {
    const acquire = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await acquire(constraints); await new Promise(resolve => { window.releaseAcquire = resolve; }); return stream;
    };
    void audio.startRecording(0);
  });
  await expect.poll(() => page.evaluate(() => typeof window.releaseAcquire)).toBe('function');
  expect(await page.evaluate(() => ({ bpm: audio.recordingSession.recordedBpm, origin: Number.isFinite(audio.recordingSession.captureOrigin), beforeNow: audio.recordingSession.captureOrigin <= a.getAudioContext().currentTime }))).toEqual({ bpm: 120, origin: true, beforeNow: true });
  await page.evaluate(() => { a.setTempo(200); releaseAcquire(); });
  await expect(page.locator('.voice-note-display__glyph')).toHaveText('A4');
  await page.waitForTimeout(250);
  await page.locator('#recording-stop-btn').click();
  await expect(page.locator('.voice-take-editor')).toBeVisible();
  await expect(page.locator('#voice-recording-status')).toContainText('captured 120 BPM');
  const timing = await page.evaluate(() => ({ onset: Number(document.querySelector('.voice-take-editor input[min="0"][max="3839"]').value), duration: Number(document.querySelectorAll('.voice-take-editor input')[2].value), seconds: results[0].notes[0].duration }));
  expect(timing.onset).toBe(0); expect(timing.duration).toBe(Math.round(timing.seconds * 120 * 960 / 60));
});
async function ready(page, source = false) {
  await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await page.goto(origin);
  await page.evaluate(async source => {
    window.a = (await import('/js/appState.js')).default;
    window.audio = (await import('/js/audioController.js')).default;
    window.isHost = true; a.initializeAudioContext(); a.addTrack(); a.setTempo(120);
    // More than one bar permits capture-relative leading silence without clipping.
    a.updateTrack(0, { barSettings: Array.from({ length: 4 }, () => ({ beats: 4, subdivision: 1, rests: [] })) });
    (await import('/js/editHistory.js')).initializeHistoryControls(document.querySelector('#history'));
    audio.initialize(); window.before = a.getMusicalSnapshot(); window.mutations = 0; a.subscribeMusicalMutations(() => mutations++);
    window.results = []; document.addEventListener('voicenotescaptured', e => results.push(e.detail));
    if (source) navigator.mediaDevices.getUserMedia = async () => {
      const ctx = a.getAudioContext(), destination = ctx.createMediaStreamDestination(), tone = ctx.createOscillator();
      tone.frequency.value = 440; tone.connect(destination); tone.start(); window.generatedTone = tone; return destination.stream;
    };
    window.streams = []; window.sources = []; window.storageWrites = 0;
    window.persistedBefore = JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])));
    const acquire = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => { const stream = await acquire(constraints); streams.push(stream); return stream; };
    const context = a.getAudioContext(), createSource = context.createMediaStreamSource.bind(context);
    context.createMediaStreamSource = stream => {
      const source = createSource(stream), disconnect = source.disconnect.bind(source), owned = { source, disconnected: false };
      source.disconnect = (...args) => { const value = disconnect(...args); owned.disconnected = true; return value; };
      sources.push(owned); return source;
    };
    const store = Storage.prototype.setItem;
    Storage.prototype.setItem = function(...args) { storageWrites++; return store.apply(this, args); };
    document.querySelector('#rec').onclick = () => { void audio.startRecording(0); };
  }, source);
  // Await the real setup persistence, including its async serialization, before
  // counting any writes caused by capture or Apply. A fixed sleep can race it.
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('metronominalState'))?.Tracks?.[0]?.barSettings?.length)).toBe(4);
  await page.evaluate(() => {
    window.storageWrites = 0;
    window.persistedBefore = JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])));
  });
}
async function preview(page) {
  await page.evaluate(() => audio.setRecordingMode('voice')); await page.locator('#rec').click();
  await expect(page.locator('.voice-note-display__glyph')).toHaveText('A4');
  // The legacy recording flag also persists. Drain both native lifecycle writes
  // before measuring the later Apply; waiting only for setup persistence misses
  // a queued saveStateImmediate from Stop while the draft is being edited.
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('metronominalState'))?.isRecording)).toBe(true);
  await page.locator('#recording-stop-btn').click();
  await expect(page.getByRole('region', { name: 'Note timeline, scroll horizontally for beats' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('metronominalState'))?.isRecording)).toBe(false);
}
for (const width of [320, 390, 1280]) for (const source of [false, true]) {
  test(`${width}px ${source ? 'native generated source' : 'generated microphone'} edits detached preview and applies a pitched track`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); await ready(page, source); await preview(page);
    const baselineCount = await page.evaluate(() => before.Tracks.length);
    await expect(page.getByLabel('Destination', { exact: true })).toHaveValue('new-track');
    expect(await page.evaluate(() => ({ same: JSON.stringify(a.getMusicalSnapshot()) === JSON.stringify(before), changes: mutations, recording: a.isRecording(), session: audio.recordingSession, notes: results.length }))).toEqual({ same: true, changes: 0, recording: false, session: null, notes: 1 });
    await page.getByRole('button', { name: 'Transpose all up', exact: true }).click();
    await expect(page.getByLabel('MIDI pitch', { exact: true })).toHaveValue('70');
    await page.evaluate(() => {
      window.sourceTrack = a.getTracks()[0]; window.storageWrites = 0;
      window.persistedBefore = JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])));
    });
    await page.getByRole('button', { name: 'Apply draft', exact: true }).click();
    await expect(page.locator('.voice-take-editor')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => ({
      count: a.getTracks().length, retainedSource: a.getTracks()[0] === sourceTrack,
      sound: a.getTracks().at(-1)?.mainBeatSound?.sound,
      midi: a.getTracks().at(-1)?.melody?.bars?.flat()?.[0]?.midi, changes: mutations,
    }))).toEqual({ count: baselineCount + 1, retainedSource: true, sound: 'Synth Sine', midi: 70, changes: 1 });
    await page.waitForTimeout(350);
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => ({
      streams: streams.length, ended: streams.every(s => s.getTracks().every(t => t.readyState === 'ended')),
      sources: sources.length, disconnected: sources.every(s => s.disconnected), timer: audio.timerIntervalId,
      storageWrites, storageUnchanged: persistedBefore === JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])))
    }))).toEqual({ streams: 1, ended: true, sources: 1, disconnected: true, timer: null, storageWrites: 1, storageUnchanged: false });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

for (const event of ['pagehide', 'hide-modal', 'escape', 'backdrop']) {
  test(`${event} destroys the completed private editor`, async ({ page }) => {
    await ready(page); await preview(page);
    if (event === 'escape') await page.keyboard.press('Escape');
    else if (event === 'backdrop') await page.locator('#recording-display-modal').click({ position: { x: 2, y: 2 } });
    else await page.evaluate(event => {
      if (event === 'pagehide') window.dispatchEvent(new Event('pagehide'));
      else document.querySelector('#recording-display-modal').style.display = 'none';
    }, event);
    await expect(page.locator('.voice-take-editor')).toHaveCount(0);
    await expect(page.locator('#voice-recording-review')).toHaveText('');
    await expect(page.locator('#voice-recording-status')).toHaveText('');
    await expect(page.locator('#voice-take-destination-controls')).toBeHidden();
    await expect(page.locator('#voice-take-destination option')).toHaveCount(0);
    expect(await page.evaluate(() => mutations)).toBe(0);
  });
}
