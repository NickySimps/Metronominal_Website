const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');

// Recording menu contract: track Rec opens an idle menu (no device request),
// explicit Sample/Voice buttons, explicit Start/Stop, safe mode switching.
// Generated PCM only (fake device + generated WAV); no physical microphone,
// no speaker output, no external network. Real style.css is served so hidden
// state is asserted against the production cascade.
const temp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'recording-menu-'));
const wavPath = path.join(temp, 'generated.wav');
const rate = 48000, frames = rate * 4, wav = Buffer.alloc(44 + frames * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40);
for (let i = 0; i < frames; i++) wav.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * 440 * i / rate)), 44 + i * 2);
fs.writeFileSync(wavPath, wav);
test.use({ channel: 'chrome', launchOptions: { args: ['--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wavPath}`] }, permissions: ['microphone'] });

// Real modal bytes; proposed contract controls inserted only until UI merge.
const { recordingModalMarkup } = require('./recordingMenuMarkup.cjs');
const recordingModal = () => recordingModalMarkup().modal;
let server, origin;
test.beforeAll(async () => {
  const root = path.join(__dirname, '..');
  server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<!doctype html><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/voice-note-display.css"><link rel="stylesheet" href="/voice-take-editor.css"><button id="rec">Rec</button>${recordingModal()}`); return;
    }
    if (req.url === '/js/tracksController.js') { res.setHeader('Content-Type', 'text/javascript'); res.end('export default {renderTracks(){}}'); return; }
    if (req.url === '/js/3D/threeDSceneManager.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(''); return; }
    if (req.url === '/js/3D/3dTheme.js') { res.setHeader('Content-Type', 'text/javascript'); res.end('export default {isActive(){return false}};'); return; }
    if (!/^\/(js\/[a-zA-Z]+\.js|style\.css|voice-(note-display|take-editor)\.css)$/.test(req.url)) { res.writeHead(404); res.end(); return; }
    fs.readFile(path.join(root, req.url), (error, bytes) => { res.writeHead(error ? 404 : 200, { 'Content-Type': req.url.endsWith('.css') ? 'text/css' : 'text/javascript' }); res.end(bytes); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(temp, { recursive: true, force: true }); });

async function ready(page) {
  await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await page.goto(origin);
  await page.evaluate(async () => {
    window.a = (await import('/js/appState.js')).default;
    window.audio = (await import('/js/audioController.js')).default;
    window.isHost = true; a.initializeAudioContext(); a.addTrack(); a.setTempo(120);
    a.updateTrack(0, { mainBeatSound: { sound: 'Synth Sine', settings: {} }, barSettings: Array.from({ length: 4 }, () => ({ beats: 4, subdivision: 1, rests: [] })) });
    audio.initialize();
    window.results = []; window.streams = []; window.edges = []; window.mutations = 0;
    a.subscribeMusicalMutations(() => mutations++);
    document.addEventListener('voicenotescaptured', event => results.push(event.detail));
    const connect = AudioNode.prototype.connect, disconnect = AudioNode.prototype.disconnect;
    AudioNode.prototype.connect = function(...args) { const result = connect.apply(this, args); edges.push({ from: this, to: args[0], active: true }); return result; };
    AudioNode.prototype.disconnect = function(...args) { const result = disconnect.apply(this, args); edges.forEach(e => { if (e.from === this && (!args.length || e.to === args[0])) e.active = false; }); return result; };
    const acquire = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.nativeAcquire = acquire;
    navigator.mediaDevices.getUserMedia = async constraints => { const stream = await acquire(constraints); streams.push(stream); return stream; };
    document.querySelector('#rec').onclick = () => { void audio.toggleRecording(0); };
  });
}
const modal = page => page.locator('#recording-display-modal');
async function released(page) {
  await expect.poll(() => page.evaluate(() => streams.every(s => s.getTracks().every(t => t.readyState === 'ended')))).toBe(true);
  expect(await page.evaluate(() => ({ session: audio.recordingSession, timer: audio.timerIntervalId, stream: audio.recordingStream, recorder: audio.mediaRecorder, recording: a.isRecording(), connected: edges.some(e => e.active && e.from instanceof MediaStreamAudioSourceNode) })))
    .toEqual({ session: null, timer: null, stream: null, recorder: null, recording: false, connected: false });
}
async function expectIdle(page, mode, streamCount) {
  await expect(modal(page)).toBeVisible();
  await expect(page.locator('#recording-mode')).toHaveValue(mode);
  await expect(page.locator('#recording-mode-sample-btn')).toHaveAttribute('aria-pressed', String(mode === 'sample'));
  await expect(page.locator('#recording-mode-voice-btn')).toHaveAttribute('aria-pressed', String(mode === 'voice'));
  await expect(page.locator('#recording-start-btn')).toBeVisible();
  await expect(page.locator('#recording-start-btn')).toBeEnabled();
  await expect(page.locator('#recording-stop-btn')).toBeHidden();
  await expect(page.locator('#recording-waveform-canvas')).toBeVisible({ visible: mode === 'sample' });
  await expect(page.locator('#voice-note-container')).toBeVisible({ visible: mode === 'voice' });
  await expect(page.locator('#voice-recording-review')).toBeHidden();
  await expect(page.locator('.voice-take-editor')).toHaveCount(0);
  expect(await page.evaluate(() => ({ streams: streams.length, session: audio.recordingSession, recording: a.isRecording() })))
    .toEqual({ streams: streamCount, session: null, recording: false });
}
async function startVoice(page) {
  await page.locator('#recording-mode-voice-btn').click();
  await page.locator('#recording-start-btn').click();
  await expect.poll(() => page.evaluate(() => audio.recordingSession?.voice?.state)).toBe('capturing');
  await expect(page.locator('.voice-note-display__glyph')).toHaveText('A4');
}

test('voice BPM click schedules native ticks and responds immediately to live toggle and Stop', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const context = a.getAudioContext(), create = context.createOscillator.bind(context);
    window.clickStarts = []; window.clickStops = []; window.clickOscillators = []; window.clickEnded = [];
    context.createOscillator = () => {
      const oscillator = create(), start = oscillator.start.bind(oscillator), stop = oscillator.stop.bind(oscillator);
      clickOscillators.push(oscillator);
      oscillator.addEventListener('ended', () => clickEnded.push(oscillator), { once:true });
      oscillator.start = time => {
        clickStarts.push(time);
        const result = start(time);
        if (window.disarmOnNextClick) {
          window.disarmOnNextClick = false;
          queueMicrotask(() => { const input = document.querySelector('#voice-click-enabled'); input.checked = false; input.dispatchEvent(new Event('change', { bubbles:true })); });
        }
        return result;
      };
      oscillator.stop = time => { clickStops.push({ node:oscillator, at:context.currentTime, requested:time ?? null }); return time === undefined ? stop() : stop(time); };
      return oscillator;
    };
  });
  await page.locator('#rec').click();
  await page.locator('#recording-mode-voice-btn').click();
  const click = page.locator('#voice-click-enabled');
  await expect(click).not.toBeChecked();
  await expect(page.locator('#voice-click-controls')).toContainText('headphones recommended');
  expect(await page.locator('#voice-click-controls').evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await click.check();
  await page.locator('#recording-start-btn').click();
  await expect(page.locator('.voice-note-display__glyph')).toHaveText('A4');
  await expect.poll(() => page.evaluate(() => clickStarts.length)).toBeGreaterThanOrEqual(2);
  const scheduleEvidence = await page.evaluate(() => ({delta: clickStarts[1] - clickStarts[0], streams:streams.length, playing:a.isPlaying()}));
  expect(scheduleEvidence).toMatchObject({streams:1, playing:false});
  expect(scheduleEvidence.delta).toBeCloseTo(0.5, 8);
  expect(await page.evaluate(() => {
    const oscillator = clickOscillators.at(-1), edge = edges.find(e => e.from === oscillator);
    return Boolean(edge && edges.some(e => e.from === edge.to && e.to === a.getAudioContext().destination)
      && !edges.some(e => (e.from === oscillator || e.from === edge.to) && e.to instanceof MediaStreamAudioDestinationNode));
  })).toBe(true);
  await click.uncheck();
  const stopped = await page.evaluate(() => ({ count:clickStarts.length, clickOwned: Boolean(audio.recordingSession?.click), enabled: audio.recordingSession?.clickEnabled }));
  expect(stopped).toMatchObject({ clickOwned:false, enabled:false });
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => clickStarts.length)).toBe(stopped.count);
  await click.check();
  await expect.poll(() => page.evaluate(() => clickStarts.length)).toBeGreaterThan(stopped.count);
  await page.evaluate(() => { window.disarmOnNextClick = true; });
  await expect(click).not.toBeChecked({ timeout:2000 });
  const cancellation = await page.evaluate(() => {
    const node=clickOscillators.at(-1), start=clickStarts.at(-1), stop=clickStops.findLast(s => s.node === node && s.requested === null);
    const gain=edges.find(e => e.from === node)?.to;
    return { headroom:stop ? start-stop.at : null, connected:edges.some(e => e.active && (e.from === node || e.from === gain)) };
  });
  expect(cancellation.headroom).toBeGreaterThan(0);
  expect(cancellation.connected).toBe(false);
  await expect.poll(() => page.evaluate(() => clickEnded.includes(clickOscillators.at(-1)))).toBe(true);
  await click.check();
  await page.locator('#recording-stop-btn').click();
  await released(page);
  const afterStop = await page.evaluate(() => clickStarts.length);
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => clickStarts.length)).toBe(afterStop);
});

for (const boundary of ['discard', 'escape', 'mode', 'pagehide', 'roomauthoritychange', 'syncrolechange', 'source-ended', 'interrupt']) {
  test(`voice BPM click stops with ${boundary}`, async ({ page }) => {
    await ready(page);
    await page.evaluate(() => {
      const context = a.getAudioContext(), create = context.createOscillator.bind(context);
      window.clickStarts = [];
      context.createOscillator = () => { const osc=create(), start=osc.start.bind(osc); osc.start=time=>{clickStarts.push(time);return start(time)}; return osc; };
    });
    await page.locator('#rec').click();
    await page.locator('#recording-mode-voice-btn').click();
    await page.locator('#voice-click-enabled').check();
    await page.locator('#recording-start-btn').click();
    await expect.poll(() => page.evaluate(() => audio.recordingSession?.voice?.state)).toBe('capturing');
    await expect.poll(() => page.evaluate(() => clickStarts.length)).toBeGreaterThan(0);
    const result = await page.evaluate(async boundary => {
      const owned = audio.recordingSession;
      if (boundary === 'discard') document.querySelector('#recording-cancel-btn').click();
      else if (boundary === 'escape') document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
      else if (boundary === 'mode') document.querySelector('#recording-mode-sample-btn').click();
      else if (boundary === 'pagehide') window.dispatchEvent(new Event('pagehide'));
      else if (boundary === 'source-ended') owned.stream.getAudioTracks()[0].dispatchEvent(new Event('ended'));
      else if (boundary === 'interrupt') {
        const context = a.getAudioContext();
        const changed = new Promise(resolve => context.addEventListener('statechange', resolve, { once:true }));
        await context.suspend(); await changed;
      }
      else document.dispatchEvent(new Event(boundary));
      return { session:audio.recordingSession, ended:owned.stream.getTracks().every(t => t.readyState === 'ended'), state:owned.voice.state, count:clickStarts.length };
    }, boundary);
    expect(result).toMatchObject({ session:null, ended:true, state:'cancelled' });
    await page.waitForTimeout(700);
    expect(await page.evaluate(() => clickStarts.length)).toBe(result.count);
    await released(page);
  });
}

test('voice BPM click enabled during pending permission uses the BPM captured at Start', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const context = a.getAudioContext(), create = context.createOscillator.bind(context);
    window.clickStarts = [];
    context.createOscillator = () => { const osc=create(), start=osc.start.bind(osc); osc.start=time=>{clickStarts.push(time);return start(time)}; return osc; };
    const acquire = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await acquire(constraints);
      await new Promise(resolve => { window.releaseClickAcquire = resolve; });
      return stream;
    };
  });
  await page.locator('#rec').click();
  await page.locator('#recording-mode-voice-btn').click();
  await page.locator('#recording-start-btn').click();
  await expect.poll(() => page.evaluate(() => typeof window.releaseClickAcquire)).toBe('function');
  await page.locator('#voice-click-enabled').check();
  await page.evaluate(() => { a.setTempo(180); releaseClickAcquire(); });
  await expect(page.locator('.voice-note-display__glyph')).toHaveText('A4');
  await expect.poll(() => page.evaluate(() => clickStarts.length)).toBeGreaterThanOrEqual(2);
  const evidence = await page.evaluate(() => ({ captured:audio.recordingSession.recordedBpm, actual:a.getTempo(), delta:clickStarts[1]-clickStarts[0], streams:streams.length, playing:a.isPlaying() }));
  expect(evidence).toMatchObject({ captured:120, actual:180, streams:1, playing:false });
  expect(evidence.delta).toBeCloseTo(.5, 8);
  await page.locator('#recording-stop-btn').click();
  await released(page);
});

for (const brokenNode of ['oscillator', 'gain']) {
  test(`voice BPM click ${brokenNode} disconnect failure cannot strand the microphone`, async ({ page }) => {
    const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
    await ready(page);
    await page.evaluate(brokenNode => {
      const context = a.getAudioContext(), createOsc = context.createOscillator.bind(context), createGain = context.createGain.bind(context);
      context.createOscillator = () => {
        const osc=createOsc(), start=osc.start.bind(osc);
        if (brokenNode === 'oscillator') osc.disconnect = () => { throw new Error('injected oscillator disconnect failure'); };
        osc.start=time=>{ const result=start(time); queueMicrotask(()=>document.querySelector('#recording-cancel-btn').click()); return result; };
        return osc;
      };
      if (brokenNode === 'gain') context.createGain = () => {
        const gain=createGain(); gain.disconnect = () => { throw new Error('injected gain disconnect failure'); }; return gain;
      };
    }, brokenNode);
    await page.locator('#rec').click();
    await page.locator('#recording-mode-voice-btn').click();
    await page.locator('#voice-click-enabled').check();
    await page.locator('#recording-start-btn').click();
    await expect.poll(() => page.evaluate(() => streams.length)).toBe(1);
    await released(page);
    expect(pageErrors).toEqual([]);
  });
}

test('voice BPM click does not start when microphone permission is denied', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const context = a.getAudioContext(), create = context.createOscillator.bind(context);
    window.clickStarts = [];
    context.createOscillator = () => { const osc=create(), start=osc.start.bind(osc); osc.start=time=>{clickStarts.push(time);return start(time)}; return osc; };
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('denied', 'NotAllowedError'); };
  });
  await page.locator('#rec').click();
  await page.locator('#recording-mode-voice-btn').click();
  await page.locator('#voice-click-enabled').check();
  await page.locator('#recording-start-btn').click();
  await expect(page.locator('#voice-recording-status')).toContainText('permission was denied');
  expect(await page.evaluate(() => ({ starts:clickStarts.length, session:audio.recordingSession, playing:a.isPlaying() }))).toEqual({ starts:0, session:null, playing:false });
});

test('voice BPM click startup failure cancels capture and releases microphone', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const context = a.getAudioContext();
    context.createOscillator = () => { throw new Error('synthetic click failure'); };
  });
  await page.locator('#rec').click();
  await page.locator('#recording-mode-voice-btn').click();
  await page.locator('#voice-click-enabled').check();
  await page.locator('#recording-start-btn').click();
  await expect(page.locator('#voice-recording-status')).toContainText('BPM click could not play');
  await released(page);
  expect(await page.evaluate(() => ({ streams:streams.length, ended:streams.every(s => s.getTracks().every(t => t.readyState === 'ended')) }))).toEqual({ streams:1, ended:true });
});

test('track Rec opens an idle sample menu without requesting the microphone; Escape closes', async ({ page }) => {
  await ready(page);
  await page.locator('#rec').click();
  await expectIdle(page, 'sample', 0);
  await expect(page.locator('#recording-start-btn')).toBeFocused();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => streams.length)).toBe(0);
  await page.keyboard.press('Escape');
  await expect(modal(page)).toBeHidden();
  await released(page);
});

test('voice: idle note UI, Start, stable generated notes, Stop, editable draft, apply to existing synth and native scheduling', async ({ page }) => {
  await ready(page);
  await page.locator('#rec').click();
  await page.locator('#recording-mode-voice-btn').click();
  await expectIdle(page, 'voice', 0);
  await page.locator('#recording-start-btn').click();
  await expect(page.locator('.voice-note-display__glyph')).toHaveText('A4');
  await expect(page.locator('#recording-start-btn')).toBeHidden();
  await expect(page.locator('#recording-stop-btn')).toBeVisible();
  await expect(page.locator('#recording-waveform-canvas')).toBeHidden();
  await page.waitForTimeout(250);
  await page.locator('#recording-stop-btn').click();
  await released(page);
  await expect(page.locator('.voice-take-editor')).toBeVisible();
  await expect(page.locator('#voice-recording-review')).toContainText('A4');
  await expect(page.locator('#recording-start-btn')).toBeHidden();
  await page.getByLabel('Destination', { exact: true }).selectOption('track:0');
  await page.evaluate(() => { window.sourceSound = JSON.stringify(a.getTracks()[0].mainBeatSound); window.trackCount = a.getTracks().length; window.mutations = 0; });
  await page.getByRole('button', { name: 'Apply draft', exact: true }).click();
  await expect(page.locator('.voice-take-editor')).toHaveCount(0);
  expect(await page.evaluate(() => ({ sound: JSON.stringify(a.getTracks()[0].mainBeatSound) === sourceSound, midi: a.getTracks()[0].melody?.bars?.flat()?.[0]?.midi, count: a.getTracks().length === trackCount, mutations })))
    .toEqual({ sound: true, midi: 69, count: true, mutations: 1 });
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
  await page.evaluate(() => engine.cancelPlayback());
});

test('switching mode during active voice capture discards the take, releases the device and stays idle', async ({ page }) => {
  await ready(page);
  await page.locator('#rec').click();
  await startVoice(page);
  await page.evaluate(() => { window.owned = audio.recordingSession; });
  await page.locator('#recording-mode-sample-btn').click();
  expect(await page.evaluate(() => ({ voice: owned.voice.state, ended: owned.stream.getTracks().every(t => t.readyState === 'ended'), results: results.length, displays: document.querySelectorAll('.voice-note-display').length })))
    .toEqual({ voice: 'cancelled', ended: true, results: 0, displays: 0 });
  await released(page);
  await expectIdle(page, 'sample', 1);
  await page.locator('#recording-mode-voice-btn').click();
  await expectIdle(page, 'voice', 1);
  await page.locator('#recording-mode-sample-btn').click();
  // Roundtrip: real native sample capture and decode in the same menu.
  await page.locator('#recording-start-btn').click();
  await expect.poll(() => page.evaluate(() => a.isRecording() && audio.mediaRecorder?.state === 'recording')).toBe(true);
  await expect(page.locator('#recording-waveform-canvas')).toBeVisible();
  await expect(page.locator('#recording-start-btn')).toBeHidden();
  await page.waitForTimeout(350);
  await page.locator('#recording-stop-btn').click();
  await expect.poll(() => page.evaluate(() => a.getRecordings().length)).toBe(1);
  expect(await page.evaluate(() => { const b = a.getSoundBuffer(a.getRecordings()[0]); return b instanceof AudioBuffer && b.getChannelData(0).some(v => Math.abs(v) > 0.01); })).toBe(true);
  await released(page);
});

test('switching mode during voice review destroys the private draft without a new capture', async ({ page }) => {
  await ready(page);
  await page.locator('#rec').click();
  await startVoice(page);
  await page.locator('#recording-stop-btn').click();
  await expect(page.locator('.voice-take-editor')).toBeVisible();
  await page.locator('#recording-mode-sample-btn').click();
  await expectIdle(page, 'sample', 1);
  await expect(page.locator('#voice-recording-review')).toHaveText('');
  await expect(page.locator('#voice-take-destination option')).toHaveCount(0);
  await expect(page.locator('#voice-take-destination-controls')).toBeHidden();
  await page.locator('#recording-mode-voice-btn').click();
  await expectIdle(page, 'voice', 1);
  await expect(page.locator('#voice-recording-review')).toHaveText('');
  expect(await page.evaluate(() => ({ results: results.length, mutations }))).toEqual({ results: 1, mutations: 0 });
});

test('each menu opening defaults to sample; toggle during capture stops instead of reopening', async ({ page }) => {
  await ready(page);
  await page.locator('#rec').click();
  await startVoice(page);
  // Track Rec while capturing = Stop (the menu overlay covers the track row,
  // so this is the same controller entry point the track button calls).
  await page.evaluate(() => audio.toggleRecording(0));
  await released(page);
  await expect(page.locator('.voice-take-editor')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal(page)).toBeHidden();
  await expect(page.locator('.voice-take-editor')).toHaveCount(0);
  await page.locator('#rec').click();
  await expectIdle(page, 'sample', 1);
});

for (const mode of ['voice', 'sample']) {
  test(`${mode} denied microphone shows helpful message, stays idle, and retries cleanly`, async ({ page }) => {
    await ready(page);
    await page.evaluate(() => { const acquire = navigator.mediaDevices.getUserMedia; window.restoreAcquire = () => { navigator.mediaDevices.getUserMedia = acquire; }; navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError')); });
    await page.locator('#rec').click();
    await page.locator(`#recording-mode-${mode}-btn`).click();
    await page.locator('#recording-start-btn').click();
    await expect(page.locator('#voice-recording-status')).toBeVisible();
    await expect(page.locator('#voice-recording-status')).toContainText('Microphone capture failed');
    await expect(page.locator('#voice-recording-status')).toContainText('permission');
    await expect(page.locator('#recording-start-btn')).toBeVisible();
    await expect(page.locator('#recording-mode')).toHaveValue(mode);
    await released(page);
    await page.evaluate(() => restoreAcquire());
    await page.locator('#recording-start-btn').click();
    await expect.poll(() => page.evaluate(() => Boolean(audio.recordingSession?.voice?.state === 'capturing' || audio.mediaRecorder?.state === 'recording'))).toBe(true);
    await expect(page.locator('#voice-recording-status')).not.toContainText('failed');
    await page.locator('#recording-cancel-btn').click();
    await expect(modal(page)).toBeHidden();
    await released(page);
  });
}

for (const mode of ['voice', 'sample']) {
  test(`${mode}: mode switch during held acquisition ends the late stream; no hidden capture`, async ({ page }) => {
    await ready(page);
    await page.evaluate(() => {
      const acquire = navigator.mediaDevices.getUserMedia;
      navigator.mediaDevices.getUserMedia = async constraints => { const stream = await acquire(constraints); await new Promise(r => { window.releaseAcquire = r; }); return stream; };
    });
    await page.locator('#rec').click();
    await page.locator(`#recording-mode-${mode}-btn`).click();
    await page.locator('#recording-start-btn').click();
    await expect.poll(() => page.evaluate(() => typeof releaseAcquire)).toBe('function');
    await expect(page.locator('#recording-start-btn')).toBeHidden();
    await page.locator(`#recording-mode-${mode === 'voice' ? 'sample' : 'voice'}-btn`).click();
    await expectIdle(page, mode === 'voice' ? 'sample' : 'voice', 1);
    await page.evaluate(() => releaseAcquire());
    await released(page);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => ({ session: audio.recordingSession, recording: a.isRecording(), results: results.length, recordings: a.getRecordings().length })))
      .toEqual({ session: null, recording: false, results: 0, recordings: 0 });
    await expect(page.locator('#recording-start-btn')).toBeVisible();
  });
}

test('sample Escape during capture and late decode cancel without saving or hidden capture', async ({ page }) => {
  await ready(page);
  await page.locator('#rec').click();
  await page.locator('#recording-start-btn').click();
  await expect.poll(() => page.evaluate(() => audio.mediaRecorder?.state)).toBe('recording');
  await page.keyboard.press('Escape');
  await expect(modal(page)).toBeHidden();
  await released(page);
  await page.evaluate(() => {
    const context = a.getAudioContext(), decode = context.decodeAudioData.bind(context);
    context.decodeAudioData = async bytes => { const buffer = await decode(bytes); await new Promise(r => { window.releaseDecode = r; }); return buffer; };
  });
  await page.locator('#rec').click();
  await page.locator('#recording-start-btn').click();
  await expect.poll(() => page.evaluate(() => audio.mediaRecorder?.state)).toBe('recording');
  await page.waitForTimeout(350);
  await page.locator('#recording-stop-btn').click();
  await expect.poll(() => page.evaluate(() => typeof releaseDecode)).toBe('function');
  await page.evaluate(() => audio.toggleRecording(0)); // Reentry while decoding opens nothing and acquires nothing.
  await expect(modal(page)).toBeHidden();
  await page.evaluate(() => { document.dispatchEvent(new Event('roomauthoritychange')); releaseDecode(); });
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => ({ recordings: a.getRecordings().length, streams: streams.length }))).toEqual({ recordings: 0, streams: 2 });
  await released(page);
});

test('room replay replacing the menu track refuses Start without acquiring; authority boundary cancels capture', async ({ page }) => {
  await ready(page);
  await page.locator('#rec').click();
  await page.locator('#recording-mode-voice-btn').click();
  await page.evaluate(async () => { const old = a.getTracks()[0]; if (!await a.applyMusicalSnapshot(a.getMusicalSnapshot()) || old === a.getTracks()[0]) throw new Error('Real replacement failed'); });
  await page.locator('#recording-start-btn').click();
  await expect(page.locator('#voice-recording-status')).toContainText('track changed');
  expect(await page.evaluate(() => ({ streams: streams.length, session: audio.recordingSession }))).toEqual({ streams: 0, session: null });
  await page.keyboard.press('Escape');
  await page.locator('#rec').click();
  await startVoice(page);
  await page.evaluate(() => document.dispatchEvent(new Event('syncrolechange')));
  await released(page);
  expect(await page.evaluate(() => ({ results: results.length, displays: document.querySelectorAll('.voice-note-display').length }))).toEqual({ results: 0, displays: 0 });
  await expect(page.locator('#voice-recording-review')).toHaveText('');
});

test('320px menu fits without horizontal overflow in both idle modes', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await ready(page);
  await page.locator('#rec').click();
  for (const mode of ['sample', 'voice']) {
    await page.locator(`#recording-mode-${mode}-btn`).click();
    await expectIdle(page, mode, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (mode === 'voice') {
      const bounds = await page.locator('#voice-click-controls').evaluate(label => {
        const field = label.querySelector('input'), l=label.getBoundingClientRect(), f=field.getBoundingClientRect();
        const range=document.createRange(); range.selectNodeContents(label.lastChild); const text=range.getBoundingClientRect();
        return { width:f.width, labelHeight:l.height, inputRight:f.right, textLeft:text.left, textRight:text.right, viewport:innerWidth };
      });
      expect(bounds.width).toBeLessThanOrEqual(44);
      expect(bounds.labelHeight).toBeGreaterThanOrEqual(44);
      expect(bounds.inputRight).toBeLessThanOrEqual(bounds.textLeft);
      expect(bounds.textRight).toBeLessThanOrEqual(bounds.viewport);
    }
  }
});

test('cached markup without Start: a queued menu-hide from a cancelled pending take never cancels the next direct sample start', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    document.querySelector('#recording-start-btn').remove(); // Cached pre-menu HTML shape.
    const acquire = navigator.mediaDevices.getUserMedia;
    window.restoreAcquire = () => { navigator.mediaDevices.getUserMedia = acquire; };
    navigator.mediaDevices.getUserMedia = async constraints => { const stream = await acquire(constraints); await new Promise(r => { window.releaseAcquire = r; }); return stream; };
    void audio.startRecording(0);
  });
  await expect.poll(() => page.evaluate(() => typeof releaseAcquire)).toBe('function');
  await page.evaluate(() => { audio.stopRecording(); restoreAcquire(); void audio.startRecording(0); });
  await expect.poll(() => page.evaluate(() => audio.mediaRecorder?.state)).toBe('recording');
  await page.evaluate(() => releaseAcquire());
  await expect.poll(() => page.evaluate(() => streams[0].getTracks()[0].readyState)).toBe('ended');
  expect(await page.evaluate(() => ({ newer: audio.recordingStream === streams[1], live: streams[1].getTracks()[0].readyState }))).toEqual({ newer: true, live: 'live' });
  await page.locator('#recording-cancel-btn').click();
  await released(page);
});
