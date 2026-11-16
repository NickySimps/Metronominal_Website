const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { recordingModalMarkup } = require('./recordingMenuMarkup.cjs');

// Generated PCM only: no physical input, no external server/CDN, no captured fixture.
const fixtureDir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'voice-lifecycle-'));
const wavPath = path.join(fixtureDir, 'tone.wav');
const rate = 48000, frames = rate * 4, wav = Buffer.alloc(44 + frames * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40);
for (let i = 0; i < frames; i++) wav.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * 440 * i / rate)), 44 + 2 * i);
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
      res.end(`<!doctype html><link rel="stylesheet" href="/voice-note-display.css"><style>.modal{display:none;padding:20px}</style><button id="rec">Rec</button>${modal}`); return;
    }
    // Presentation refresh is the only replaced module: retain actual app-state,
    // capture, analysis, display, native microphone, graph and sample recording.
    if (req.url === '/js/tracksController.js') { res.setHeader('Content-Type', 'text/javascript'); res.end('export default {renderTracks(){}}'); return; }
    if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (!/^\/(js\/[a-zA-Z]+\.js|voice-note-display\.css)$/.test(req.url)) { res.writeHead(404); res.end(); return; }
    fs.readFile(path.join(root, req.url), (error, bytes) => { res.writeHead(error ? 404 : 200, { 'Content-Type': req.url.endsWith('.css') ? 'text/css' : 'text/javascript' }); res.end(bytes); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(fixtureDir, { recursive: true, force: true }); });
async function ready(page) {
  await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await page.goto(origin);
  await page.evaluate(async () => {
    window.a = (await import('/js/appState.js')).default;
    window.audio = (await import('/js/audioController.js')).default;
    window.isHost = true; a.initializeAudioContext(); a.addTrack(); audio.initialize();
    window.results = []; window.streams = []; window.edges = [];
    document.addEventListener('voicenotescaptured', event => results.push(event.detail));
    const connect = AudioNode.prototype.connect, disconnect = AudioNode.prototype.disconnect;
    AudioNode.prototype.connect = function(...args) { const result = connect.apply(this, args); edges.push({ from: this, to: args[0], active: true }); return result; };
    AudioNode.prototype.disconnect = function(...args) { const result = disconnect.apply(this, args); edges.forEach(e => { if (e.from === this && (!args.length || e.to === args[0])) e.active = false; }); return result; };
    const acquire = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => { const stream = await acquire(constraints); streams.push(stream); return stream; };
    document.querySelector('#rec').onclick = () => { void audio.startRecording(0); };
  });
}
async function startVoice(page) {
  await page.evaluate(() => audio.setRecordingMode('voice'));
  await page.locator('#rec').click();
  await expect.poll(() => page.evaluate(() => audio.recordingSession?.voice?.state)).toBe('capturing');
}
async function released(page) {
  expect(await page.evaluate(() => ({ session: audio.recordingSession, timer: audio.timerIntervalId, stream: audio.recordingStream, recording: a.isRecording(), live: streams.some(s => s.getTracks().some(t => t.readyState === 'live')), connected: edges.some(e => e.active && e.from instanceof MediaStreamAudioSourceNode) }))).toEqual({ session: null, timer: null, stream: null, recording: false, live: false, connected: false });
}
async function boundary(page, name) {
  return page.evaluate(async name => {
    window.oldSession = audio.recordingSession;
    if (name === 'discard') document.querySelector('#recording-cancel-btn').click();
    else if (name === 'escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else if (name === 'backdrop') document.querySelector('#recording-display-modal').click();
    else if (name === 'hide-modal') { document.querySelector('#recording-display-modal').style.display = 'none'; await Promise.resolve(); }
    else if (name === 'hidden-attribute') { document.querySelector('#recording-display-modal').hidden = true; await Promise.resolve(); }
    else if (name === 'visibility-hidden') { document.querySelector('#recording-display-modal').style.visibility = 'hidden'; await Promise.resolve(); }
    else if (name === 'class-hidden') {
      const style = document.createElement('style'); style.textContent = '.capture-hidden { visibility: hidden; }'; document.head.append(style);
      document.querySelector('#recording-display-modal').classList.add('capture-hidden'); await Promise.resolve();
    }
    else if (name === 'pagehide') window.dispatchEvent(new Event('pagehide'));
    else if (name === 'replace-track') {
      const old = a.getTracks()[0];
      if (!await a.applyMusicalSnapshot(a.getMusicalSnapshot()) || old === a.getTracks()[0]) throw new Error('Real replacement failed');
    } else if (name === 'playback') await a.togglePlay();
    else if (name === 'source-ended') streams.at(-1).getAudioTracks()[0].dispatchEvent(new Event('ended'));
    else if (name === 'interrupt') {
      const context = a.getAudioContext();
      const changed = new Promise(resolve => context.addEventListener('statechange', resolve, { once: true }));
      await context.suspend(); await changed;
    } else document.dispatchEvent(new Event(name));
    return { session: audio.recordingSession === null, timer: audio.timerIntervalId, ended: oldSession.stream ? oldSession.stream.getTracks().every(t => t.readyState === 'ended') : null, state: oldSession.voice?.state ?? 'pending', display: document.querySelectorAll('.voice-note-display').length, results: results.length };
  }, name);
}
for (const name of ['discard', 'escape', 'backdrop', 'hide-modal', 'hidden-attribute', 'visibility-hidden', 'class-hidden', 'pagehide', 'roomauthoritychange', 'syncrolechange', 'replace-track', 'playback', 'source-ended', 'interrupt']) {
  test(`${name} cancels active voice immediately without a completed draft`, async ({ page }) => {
    await ready(page); await startVoice(page);
    expect(await boundary(page, name)).toEqual({ session: true, timer: null, ended: true, state: 'cancelled', display: 0, results: 0 });
    await released(page);
  });
}
for (const name of ['discard', 'pagehide', 'roomauthoritychange', 'replace-track', 'hidden-attribute', 'visibility-hidden', 'class-hidden']) {
  test(`${name} cancels pending acquisition; late old stream cannot disturb a new voice session`, async ({ page }) => {
    await ready(page);
    await page.evaluate(() => audio.setRecordingMode('voice'));
    await page.evaluate(() => {
      const acquire = navigator.mediaDevices.getUserMedia;
      window.restoreAcquire = () => { navigator.mediaDevices.getUserMedia = acquire; };
      navigator.mediaDevices.getUserMedia = async constraints => {
        const stream = await acquire(constraints);
        await new Promise(resolve => { window.releaseAcquire = resolve; }); return stream;
      };
      void audio.startRecording(0);
    });
    await expect.poll(() => page.evaluate(() => typeof releaseAcquire)).toBe('function');
    await expect(page.locator('#recording-display-modal')).toBeVisible();
    expect((await boundary(page, name)).session).toBe(true);
    // The unresolved getUserMedia promise still owns this live generated stream;
    // cancellation cannot stop a stream the application has not received yet.
    expect(await page.evaluate(() => streams[0].getTracks()[0].readyState)).toBe('live');
    await page.evaluate(() => {
      const modal = document.querySelector('#recording-display-modal');
      modal.hidden = false; modal.style.visibility = ''; modal.classList.remove('capture-hidden');
      restoreAcquire(); void audio.startRecording(0);
    });
    await expect.poll(() => page.evaluate(() => audio.recordingSession?.voice?.state)).toBe('capturing');
    await page.evaluate(() => { releaseAcquire(); });
    await expect.poll(() => page.evaluate(() => streams[0].getTracks()[0].readyState)).toBe('ended');
    expect(await page.evaluate(() => ({ live: audio.recordingStream === streams[1], capture: audio.recordingSession.voice.state, results: results.length }))).toEqual({ live: true, capture: 'capturing', results: 0 });
    await boundary(page, 'discard'); await released(page);
  });
}
for (const name of ['escape', 'backdrop']) {
  test(`${name} closes and clears completed voice review after native cleanup`, async ({ page }) => {
    await ready(page); await startVoice(page);
    await expect(page.locator('.voice-note-display__glyph')).toHaveText('A4');
    await page.locator('#recording-stop-btn').click();
    await released(page);
    await expect(page.locator('#voice-recording-review')).toContainText('A4');
    await expect(page.locator('#recording-cancel-btn')).toBeFocused();
    if (name === 'escape') await page.keyboard.press('Escape');
    else await page.locator('#recording-display-modal').click({ position: { x: 1, y: 1 } });
    await expect(page.locator('#recording-display-modal')).toBeHidden();
    await expect(page.locator('#voice-recording-review')).toHaveText('');
    expect(await page.evaluate(() => results.length)).toBe(1);
    await released(page);
  });
}

for (const finish of ['stop', 'discard']) {
  test(`voice ${finish} then sample restores waveform and Stop with native decode`, async ({ page }) => {
    await ready(page); await startVoice(page);
    if (finish === 'stop') {
      await page.locator('#recording-stop-btn').click();
      await expect(page.locator('#voice-recording-review')).toBeVisible();
    } else await boundary(page, 'discard');
    await page.evaluate(() => audio.setRecordingMode('sample'));
    await page.locator('#rec').click();
    await expect.poll(() => page.evaluate(() => a.isRecording() && audio.mediaRecorder?.state === 'recording')).toBe(true);
    await expect(page.locator('#recording-waveform-canvas')).toBeVisible();
    await expect(page.locator('#recording-stop-btn')).toBeVisible();
    await expect(page.locator('#voice-recording-status')).toBeHidden();
    await expect(page.locator('#voice-note-container')).toBeHidden();
    await expect(page.locator('#voice-recording-review')).toBeHidden();
    await expect(page.locator('#voice-recording-review')).toHaveText('');
    await page.waitForTimeout(350); // Provide real native encoded frames, not a fake recorder result.
    await page.locator('#recording-stop-btn').click();
    await expect.poll(() => page.evaluate(() => a.getRecordings().length)).toBe(1);
    expect(await page.evaluate(() => {
      const buffer = a.getSoundBuffer(a.getRecordings()[0]);
      return buffer instanceof AudioBuffer && buffer.duration > 0 && buffer.getChannelData(0).some(v => Math.abs(v) > 0.01);
    })).toBe(true);
    await released(page);
  });
}

test('permission denied produces visible refusal and permits a clean retry', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => audio.setRecordingMode('voice'));
  await page.evaluate(() => { const acquire = navigator.mediaDevices.getUserMedia; window.restoreAcquire = () => { navigator.mediaDevices.getUserMedia = acquire; }; navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError')); });
  await page.locator('#rec').click();
  await expect(page.locator('#voice-recording-status')).toContainText('Microphone capture failed');
  await released(page);
  await page.evaluate(() => restoreAcquire()); await startVoice(page);
  await boundary(page, 'discard'); await released(page);
});

test('voice refuses playing transport before device permission with truthful local status', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => audio.setRecordingMode('voice'));
  await page.evaluate(async () => { await a.getAudioContext().resume(); await a.togglePlay(); });
  await page.locator('#rec').click();
  await expect(page.locator('#voice-recording-status')).toContainText('Stop playback');
  expect(await page.evaluate(() => streams.length)).toBe(0);
  await released(page);
});

test('explicit mode precedes permission; native voice stop flushes local review without MediaRecorder or musical writes', async ({ page }) => {
  await ready(page);
  await expect(page.locator('#recording-mode')).toHaveValue('sample');
  await expect(page.locator('#recording-mode-help')).toContainText('Stop playback');
  expect(await page.evaluate(() => streams.length)).toBe(0);
  await page.evaluate(() => { window.before = a.getMusicalSnapshot(); window.MediaRecorder = undefined; });
  await startVoice(page);
  await expect(page.locator('.voice-note-display__glyph')).toHaveText('A4');
  await expect(page.locator('.voice-note-display__status')).toContainText('A4');
  await page.evaluate(() => { window.owned = audio.recordingSession; window.flushWasLive = false; const stop = owned.voice.stop.bind(owned.voice); owned.voice.stop = () => { flushWasLive = owned.stream.getTracks().every(t => t.readyState === 'live'); return stop(); }; });
  await page.locator('#recording-stop-btn').click();
  await released(page);
  expect(await page.evaluate(() => ({ flushWasLive, recordings: a.getRecordings().length, musical: a.getMusicalSnapshot(), count: results.length, status: results[0]?.status, midi: results[0]?.notes[0]?.midi, detached: results[0] !== owned.voice.result }))).toEqual({ flushWasLive: true, recordings: 0, musical: await page.evaluate(() => before), count: 1, status: 'stopped', midi: 69, detached: true });
  await expect(page.locator('#voice-recording-status')).toContainText('not saved');
  await expect(page.locator('#voice-recording-review')).toContainText('A4');
  await page.locator('#recording-cancel-btn').click();
  await expect(page.locator('#recording-display-modal')).toBeHidden();
});
