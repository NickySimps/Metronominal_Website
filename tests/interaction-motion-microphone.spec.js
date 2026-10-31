'use strict';
const { test, expect } = require('@playwright/test');

// Chromium supplies generated media only; never open a physical microphone.
// Installed Chrome supports native generated capture on this Windows host;
// bundled headless Chromium rejects getUserMedia with NotSupportedError.
test.use({ channel: 'chrome', launchOptions: { args: ['--use-fake-device-for-media-stream'] }, permissions: ['microphone'] });

async function ready(page) {
  // The production import map is unversioned; pin genuine CDN responses in
  // this fixture to avoid mixed-version module/core cache responses.
  await page.route('https://cdn.jsdelivr.net/npm/three/**', async route => {
    const response = await route.fetch({ url: route.request().url().replace('/npm/three/', '/npm/three@0.187.0/') });
    await route.fulfill({ response });
  });
  await page.route('**/script.js', route => route.abort());
  await page.goto('./');
  await page.evaluate(async () => {
    window.routes = [];
    const connect = AudioNode.prototype.connect, disconnect = AudioNode.prototype.disconnect;
    AudioNode.prototype.connect = function(...args) { const result = connect.apply(this, args); routes.push({ from: this, to: args[0], active: true }); return result; };
    AudioNode.prototype.disconnect = function(...args) { const result = disconnect.apply(this, args); for (const route of routes) if (route.from === this && (!args.length || route.to === args[0])) route.active = false; return result; };
    window.nativeEvents = [];
    const NativeRecorder = MediaRecorder;
    window.MediaRecorder = class extends NativeRecorder {
      constructor(...args) {
        super(...args);
        this.addEventListener('start', () => nativeEvents.push('start'));
        this.addEventListener('stop', () => nativeEvents.push('stop'));
      }
    };
    window.a = (await import('/js/appState.js')).default;
    window.audio = (await import('/js/audioController.js')).default;
    const tracks = (await import('/js/tracksController.js')).default;
    (await import('/js/interactionMotion.js')).initializeInteractionMotion(document);
    window.isHost = true;
    a.initializeAudioContext();
    if (!a.getTracks().length) a.addTrack();
    tracks.init(); tracks.renderTracks(); audio.initialize();
    window.observed = [];
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes)
        if (node.nodeType === 1 && node.dataset.motionKind) observed.push(node.dataset.motionKind);
    }).observe(document.querySelector('[data-interaction-motion-root]'), { childList: true, subtree: true });
    const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.generatedStreams = [];
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await nativeGetUserMedia(constraints);
      generatedStreams.push(stream);
      return stream;
    };
  });
}
const recordButton = page => page.locator('.track-record-btn').first();
async function assertReleased(page) {
  await expect.poll(() => page.evaluate(() => generatedStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true);
  expect(await page.evaluate(() => ({ recording: a.isRecording(), stream: audio.recordingStream, recorder: audio.mediaRecorder, timer: audio.timerIntervalId, analyser: audio.analyserNode }))).toEqual({ recording: false, stream: null, recorder: null, timer: null, analyser: null });
}

test('generated microphone start and stop are truthful; saved feedback waits for native decode and model acceptance', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const context = a.getAudioContext(), decode = context.decodeAudioData.bind(context);
    window.nativeDecoded = null;
    context.decodeAudioData = async bytes => {
      nativeDecoded = await decode(bytes);
      await new Promise(resolve => { window.releaseDecode = resolve; });
      return nativeDecoded;
    };
  });
  await recordButton(page).click();
  await expect.poll(() => page.evaluate(() => observed.includes('record-start'))).toBe(true);
  expect(await page.evaluate(() => audio.mediaRecorder.state)).toBe('recording');
  expect(await page.evaluate(() => {
    const session = audio.recordingSession;
    return routes.filter(route => route.active && route.from === session.source).every(route => route.to === session.analyser)
      && routes.some(route => route.active && route.from === session.source && route.to === session.analyser)
      && !routes.some(route => route.active && route.from === session.analyser);
  })).toBe(true);
  await expect(page.locator('#recording-timer')).toHaveText('00:01');
  await page.evaluate(() => { observed = []; });
  await page.locator('#recording-stop-btn').click();
  await expect.poll(() => page.evaluate(() => typeof releaseDecode === 'function')).toBe(true);
  await expect.poll(() => page.evaluate(() => observed.includes('record-stop'))).toBe(true);
  expect(await page.evaluate(() => observed.includes('save'))).toBe(false);
  expect(await page.evaluate(() => a.getRecordings().length)).toBe(0);
  await assertReleased(page);
  await page.evaluate(() => releaseDecode());
  await expect.poll(() => page.evaluate(() => observed.includes('save'))).toBe(true);
  expect(await page.evaluate(() => {
    const name = a.getRecordings()[0];
    return nativeDecoded instanceof AudioBuffer && nativeDecoded.duration > 0 && nativeDecoded.getChannelData(0).some(value => Math.abs(value) > .001) && a.getSoundBuffer(name) === nativeDecoded && a.getTracks()[0].mainBeatSound.sound === name;
  })).toBe(true);
  expect(await page.evaluate(() => nativeEvents)).toEqual(['start', 'stop']);
});

for (const boundary of ['roomauthoritychange', 'syncrolechange', 'remove-track', 'replace-tracks']) {
  for (const phase of ['capturing', 'decoding']) {
    test(`${boundary} during ${phase} releases native resources and suppresses stale completion`, async ({ page }) => {
      await ready(page);
      await page.evaluate(() => {
        a.addTrack();
        const context = a.getAudioContext(), decode = context.decodeAudioData.bind(context);
        context.decodeAudioData = async bytes => {
          const buffer = await decode(bytes);
          await new Promise(resolve => { window.releaseDecode = resolve; });
          return buffer;
        };
      });
      await recordButton(page).click();
      await expect.poll(() => page.evaluate(() => nativeEvents.includes('start'))).toBe(true);
      await page.evaluate(() => { window.ownedRecorder = audio.mediaRecorder; window.ownedSource = audio.recordingSession.source; });
      if (phase === 'decoding') {
        await expect(page.locator('#recording-timer')).toHaveText('00:01');
        await page.locator('#recording-stop-btn').click();
        await expect.poll(() => page.evaluate(() => typeof releaseDecode === 'function')).toBe(true);
        // Reentry while finalizing must not allocate another stream.
        await page.evaluate(() => { void audio.startRecording(0); audio.stopRecording(); });
        expect(await page.evaluate(() => generatedStreams.length)).toBe(1);
      }
      expect(await page.evaluate(async boundary => {
        observed = [];
        if (boundary === 'replace-tracks') {
          const snapshot = a.getMusicalSnapshot(), previous = a.getTracks()[0];
          if (!await a.applyMusicalSnapshot(snapshot)) throw new Error('Real snapshot replacement refused');
          if (a.getTracks()[0] === previous) throw new Error('Snapshot did not replace the recording track');
        } else if (boundary === 'remove-track') a.removeTrack(0);
        else document.dispatchEvent(new Event(boundary));
        return { state: ownedRecorder.state, ended: generatedStreams[0].getTracks().every(track => track.readyState === 'ended'), connected: routes.some(route => route.from === ownedSource && route.active), session: audio.recordingSession, timer: audio.timerIntervalId };
      }, boundary)).toEqual({ state: 'inactive', ended: true, connected: false, session: null, timer: null });
      await assertReleased(page);
      await expect.poll(() => page.evaluate(() => nativeEvents.includes('stop'))).toBe(true);
      if (phase === 'decoding') await page.evaluate(() => releaseDecode());
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));
      expect(await page.evaluate(() => ({ recordings: a.getRecordings().length, feedback: observed }))).toEqual({ recordings: 0, feedback: [] });
      await page.evaluate(() => { void audio.startRecording(0); });
      await expect.poll(() => page.evaluate(() => audio.mediaRecorder?.state)).toBe('recording');
      await page.evaluate(() => document.dispatchEvent(new Event('syncrolechange')));
      await assertReleased(page);
    });
  }
}

for (const failure of ['resume', 'permission', 'constructor', 'start', 'decode', 'native-error']) {
  test(`${failure} failure refuses without saved feedback or resource leaks`, async ({ page }) => {
    await ready(page);
    await page.evaluate(async failure => {
      const fail = () => { throw new Error(`Injected ${failure} boundary`); };
      if (failure === 'resume') {
        await a.getAudioContext().suspend();
        a.getAudioContext().resume = fail;
      }
      if (failure === 'permission') navigator.mediaDevices.getUserMedia = fail;
      if (failure === 'constructor') window.MediaRecorder = class { constructor() { fail(); } };
      if (failure === 'start') MediaRecorder.prototype.start = fail;
      if (failure === 'decode') a.getAudioContext().decodeAudioData = fail;
    }, failure);
    await recordButton(page).click();
    if (failure === 'decode' || failure === 'native-error') {
      await expect.poll(() => page.evaluate(() => observed.includes('record-start'))).toBe(true);
      if (failure === 'decode') {
        await expect(page.locator('#recording-timer')).toHaveText('00:01');
        await page.locator('#recording-stop-btn').click();
      } else await page.evaluate(() => audio.mediaRecorder.dispatchEvent(new Event('error')));
    }
    await expect.poll(() => page.evaluate(() => observed.includes('refuse'))).toBe(true);
    await assertReleased(page);
    expect(await page.evaluate(() => ({ count: a.getRecordings().length, saved: observed.includes('save'), session: audio.recordingSession, connected: routes.some(route => route.from instanceof MediaStreamAudioSourceNode && route.active) }))).toEqual({ count: 0, saved: false, session: null, connected: false });
  });
}

test('authority drift before the native start event cancels capture instead of leaking a hidden stream', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const start = MediaRecorder.prototype.start;
    MediaRecorder.prototype.start = function(...args) {
      const result = start.apply(this, args);
      window.isHost = false;
      return result;
    };
  });
  await recordButton(page).click();
  await expect.poll(() => page.evaluate(() => nativeEvents.includes('start'))).toBe(true);
  await assertReleased(page);
  expect(await page.evaluate(() => ({ session: audio.recordingSession, feedback: observed, count: a.getRecordings().length }))).toEqual({ session: null, feedback: [], count: 0 });
});

test('native stop after unannounced authority drift releases session ownership for reentry', async ({ page }) => {
  await ready(page);
  await recordButton(page).click();
  await expect.poll(() => page.evaluate(() => nativeEvents.includes('start'))).toBe(true);
  await page.evaluate(() => {
    observed = [];
    window.isHost = false;
    audio.mediaRecorder.stop();
  });
  await expect.poll(() => page.evaluate(() => nativeEvents.includes('stop'))).toBe(true);
  await assertReleased(page);
  expect(await page.evaluate(() => ({ session: audio.recordingSession, count: a.getRecordings().length, feedback: observed }))).toEqual({ session: null, count: 0, feedback: [] });
  await page.evaluate(() => { void audio.startRecording(0); });
  await expect.poll(() => page.evaluate(() => audio.mediaRecorder?.state)).toBe('recording');
  await page.evaluate(() => document.dispatchEvent(new Event('syncrolechange')));
  await assertReleased(page);
});

test('cancelled acquisition releases its late generated stream without disturbing the newer native recording', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    const acquire = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await acquire(constraints);
      await new Promise(resolve => { window.releaseAcquisition = resolve; });
      return stream;
    };
    window.restoreAcquire = () => { navigator.mediaDevices.getUserMedia = acquire; };
    void audio.startRecording(0);
  });
  await expect.poll(() => page.evaluate(() => typeof releaseAcquisition === 'function')).toBe(true);
  await page.evaluate(() => { audio.stopRecording(); restoreAcquire(); void audio.startRecording(0); });
  await expect.poll(() => page.evaluate(() => observed.includes('record-start'))).toBe(true);
  await page.evaluate(() => { observed = []; releaseAcquisition(); });
  await expect.poll(() => page.evaluate(() => generatedStreams[0].getTracks()[0].readyState)).toBe('ended');
  expect(await page.evaluate(() => ({ newer: audio.recordingStream === generatedStreams[1], state: audio.mediaRecorder.state, live: generatedStreams[1].getTracks()[0].readyState, feedback: observed }))).toEqual({ newer: true, state: 'recording', live: 'live', feedback: [] });
  await page.evaluate(() => document.dispatchEvent(new Event('syncrolechange')));
  await assertReleased(page);
});
