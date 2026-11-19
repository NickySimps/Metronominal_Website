const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { recordingModalMarkup } = require('./recordingMenuMarkup.cjs');

// Generated fake microphone and real capture/state/editor modules; track rendering
// and 3D modules are replaced by minimal fixture stubs.
let server, origin;
const wavPath = path.join(process.env.TMPDIR || require('node:os').tmpdir(), `voice-solo-${process.pid}.wav`);
const rate = 48000, frames = rate * 5, wav = Buffer.alloc(44 + frames * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40);
for (let i = 0; i < frames; i++) wav.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * 440 * i / rate)), 44 + i * 2);
fs.writeFileSync(wavPath, wav);
test.use({ channel: 'chrome', launchOptions: { args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wavPath}`] }, permissions: ['microphone'] });
test.beforeAll(async () => {
  const root = path.join(__dirname, '..');
  server = http.createServer((req, res) => {
    if (req.url === '/') {
      const { modal } = recordingModalMarkup(root);
      res.setHeader('Content-Type', 'text/html');
      res.end(`<!doctype html><link rel="stylesheet" href="/voice-note-display.css"><link rel="stylesheet" href="/voice-take-editor.css"><style>body{margin:0}.modal{display:none;position:fixed;inset:0;padding:8px;background:#111}.modal-content{width:100%;max-width:900px;margin:auto;box-sizing:border-box}</style><button id="rec">Rec</button><div id="history"></div>${modal}`); return;
    }
    if (req.url === '/js/tracksController.js') { res.setHeader('Content-Type', 'text/javascript'); res.end('export default {renderTracks(){}}'); return; }
    if (req.url === '/js/3D/threeDSceneManager.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(''); return; }
    if (req.url === '/js/3D/3dTheme.js') { res.setHeader('Content-Type', 'text/javascript'); res.end('export default {isActive(){return false}};'); return; }
    if (!/^\/(js\/[a-zA-Z]+\.js|voice-(note-display|take-editor)\.css)$/.test(req.url)) { res.writeHead(404); res.end(); return; }
    fs.readFile(path.join(root, req.url), (error, bytes) => { res.writeHead(error ? 404 : 200, { 'Content-Type': req.url.endsWith('.css') ? 'text/css' : 'text/javascript' }); res.end(bytes); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(wavPath, { force: true }); });

test('solo false-host generated microphone capture reviews, exposes Apply, and commits a real track', async ({ page }) => {
  await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await page.goto(origin);
  await page.evaluate(async () => {
    window.a = (await import('/js/appState.js')).default;
    window.audio = (await import('/js/audioController.js')).default;
    window.isHost = false; // actual solo-state representation under regression
    a.initializeAudioContext(); a.addTrack(); a.setTempo(120);
    a.updateTrack(0, { barSettings: Array.from({length: 4}, () => ({beats:4, subdivision:1, rests:[]})) });
    (await import('/js/editHistory.js')).initializeHistoryControls(document.querySelector('#history'));
    audio.initialize(); window.before = a.getMusicalSnapshot(); window.changes = 0;
    a.subscribeMusicalMutations(() => changes++);
    document.querySelector('#rec').onclick = () => { audio.setRecordingMode('voice'); void audio.startRecording(0); };
  });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('metronominalState'))?.Tracks?.[0]?.barSettings?.length)).toBe(4);
  await page.locator('#rec').click();
  await expect(page.locator('#recording-stop-btn')).toBeVisible();
  await page.waitForTimeout(1800);
  await page.locator('#recording-stop-btn').click();
  await expect(page.getByRole('region', { name: 'Note timeline, scroll horizontally for beats' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply draft', exact: true })).toBeVisible();
  expect(await page.evaluate(async () => ({ soloHost: window.isHost, joined: (await import('/js/webrtc.js')).isSynchronizationJoined(),
    captureEnded: audio.recordingSession === null, unchanged: JSON.stringify(a.getMusicalSnapshot()) === JSON.stringify(before),
    trackCount: a.getTracks().length, baselineCount: before.Tracks.length,
    noteCount: document.querySelectorAll('.voice-take-editor input[min="0"][max="127"]').length })))
    .toEqual(await page.evaluate(() => ({ soloHost: false, joined: false, captureEnded: true, unchanged: true, trackCount: before.Tracks.length, baselineCount: before.Tracks.length, noteCount: 1 })));
  await page.getByRole('button', { name: 'Apply draft', exact: true }).click();
  await expect(page.locator('.voice-take-editor')).toHaveCount(0);
  expect(await page.evaluate(() => ({ hostStillFalse: window.isHost === false, count: a.getTracks().length,
    baselineCount: before.Tracks.length, actualTrack: a.getTracks().at(-1), changes }))).toMatchObject({ hostStillFalse: true, changes: 1,
      actualTrack: { mainBeatSound: { sound: 'Synth Sine' } } });
  expect(await page.evaluate(() => a.getTracks().length)).toBe(await page.evaluate(() => before.Tracks.length + 1));
  expect(await page.evaluate(() => a.getTracks().at(-1).melody.bars.flat().length)).toBeGreaterThan(0);
});
