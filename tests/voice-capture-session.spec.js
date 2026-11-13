const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

test.use({ channel: 'msedge' });
let server, origin;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/') { res.end('<!doctype html><title>Local generated audio fixture</title>'); return; }
    if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (!/^\/js\/voice(CaptureSession|PitchDetector|NoteTracker)\.js$/.test(req.url)) { res.writeHead(404); res.end(); return; }
    fs.readFile(path.join(__dirname, '..', req.url), (error, bytes) => {
      res.writeHead(error ? 404 : 200, { 'Content-Type': 'text/javascript' }); res.end(bytes);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); });
const fixtureErrors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  fixtureErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!request.url().startsWith(origin + '/')) errors.push(`External request: ${request.url()}`); });
});
async function fixture(page, sampleRate = 48000) {
  await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await page.goto(origin);
  await page.evaluate(async sampleRate => {
    window.micRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => { micRequests++; throw new Error('Physical microphone forbidden'); };
    window.Session = (await import('/js/voiceCaptureSession.js')).VoiceCaptureSession;
    window.ctx = new AudioContext({ sampleRate });
    await ctx.resume();
    if (ctx.state !== 'running') throw new Error('Native AudioContext not running');
    window.osc = ctx.createOscillator(); osc.frequency.value = 440;
    window.bus = ctx.createMediaStreamDestination(); osc.connect(bus); osc.start();
    window.source = ctx.createMediaStreamSource(bus.stream);
    window.unowned = ctx.createAnalyser(); source.connect(unowned);
    window.edges = []; window.disconnects = [];
    const connect = AudioNode.prototype.connect, disconnect = AudioNode.prototype.disconnect;
    AudioNode.prototype.connect = function(target, ...args) { edges.push({ from: this, to: target }); return connect.call(this, target, ...args); };
    AudioNode.prototype.disconnect = function(...args) { disconnects.push({ node: this, args }); return disconnect.apply(this, args); };
    window.stable = []; window.completed = [];
  }, sampleRate);
}
test.afterEach(async ({ page }) => {
  await page.evaluate(async () => { window.session?.cancel(); window.osc?.stop(); window.bus?.stream.getTracks().forEach(t => t.stop()); await window.ctx?.close(); });
  expect(await page.evaluate(() => window.micRequests)).toBe(0);
  expect(fixtureErrors.get(page)).toEqual([]);
});

test('foreground boundaries cancel immediately, discard notes, and detach lifecycle listeners', async ({ page }) => {
  await fixture(page);
  const results = await page.evaluate(async () => {
    const results = [];
    for (const boundary of ['hidden', 'pagehide', 'suspended', 'ended']) {
      window.session = new Session({ context: ctx, source }); session.start();
      if (boundary === 'hidden') {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        delete document.visibilityState;
      } else if (boundary === 'pagehide') window.dispatchEvent(new Event('pagehide'));
      else if (boundary === 'suspended') {
        const changed = new Promise(resolve => ctx.addEventListener('statechange', resolve, { once: true }));
        await ctx.suspend(); await changed;
      }
      else bus.stream.getAudioTracks()[0].dispatchEvent(new Event('ended'));
      results.push({ state: session.state, result: session.cancel(), frameReleased: session.frame === null });
      if (ctx.state === 'suspended') await ctx.resume();
    }
    return results;
  });
  for (const result of results) {
    expect(result.state).toBe('cancelled'); expect(result.result.notes).toEqual([]); expect(result.frameReleased).toBe(true);
  }
});

test('cancellation fences queued timers against a new session and completion reentry', async ({ page }) => {
  await fixture(page);
  const result = await page.evaluate(() => {
    const originalInterval = window.setInterval, originalTimeout = window.setTimeout;
    const old = [];
    window.setInterval = callback => { old.push(callback); return 91231; };
    window.setTimeout = callback => { old.push(callback); return 91232; };
    let firstCount = 0;
    const first = new Session({ context: ctx, source, onComplete: () => { firstCount++; first.stop(); } });
    first.start(); first.cancel();
    window.setInterval = originalInterval; window.setTimeout = originalTimeout;
    window.session = new Session({ context: ctx, source }); session.start();
    for (const callback of old) callback();
    const nextState = session.state;
    const stopped = session.stop(); stopped.notes.push({ midi: 1 });
    return { nextState, firstCount, first: first.stop(), second: session.stop(), tracksLive: bus.stream.getTracks().every(t => t.readyState === 'live') };
  });
  expect(result.nextState).toBe('capturing'); expect(result.firstCount).toBe(1);
  expect(result.first.status).toBe('cancelled'); expect(result.first.notes).toEqual([]);
  expect(result.second.notes).toEqual([]); expect(result.tracksLive).toBe(true);
});

test('setup API failure releases partial resources and reports failure exactly once', async ({ page }) => {
  await fixture(page);
  const result = await page.evaluate(async () => {
    const nativeInterval = window.setInterval;
    window.setInterval = () => { throw new Error('timer blocked'); };
    window.session = new Session({ context: ctx, source, onComplete: result => completed.push(result) });
    let thrown;
    try { session.start(); } catch (error) { thrown = error.message; }
    window.setInterval = nativeInterval;
    window.dispatchEvent(new Event('pagehide'));
    return { thrown, result: await session.done, count: completed.length, listeners: session.listeners.length,
      precise: disconnects.some(e => e.node === source && e.args.length === 1), frame: session.frame,
      live: bus.stream.getTracks().every(t => t.readyState === 'live') };
  });
  expect(result.thrown).toBe('timer blocked'); expect(result.result.status).toBe('failed');
  expect(result.result.error).toBe('timer blocked'); expect(result.count).toBe(1);
  expect(result.listeners).toBe(0); expect(result.precise).toBe(true); expect(result.frame).toBe(null); expect(result.live).toBe(true);
});

test('rejects sample rates outside the detector domain explicitly', async ({ page }) => {
  await fixture(page);
  const result = await page.evaluate(() => {
    Object.defineProperty(ctx, 'sampleRate', { value: 384000, configurable: true });
    window.session = new Session({ context: ctx, source });
    let message;
    try { session.start(); } catch (error) { message = error.message; }
    delete ctx.sampleRate;
    return { message, state: session.state };
  });
  expect(result.state).toBe('failed'); expect(result.message).toMatch(/sample rate/i);
});

test('sampling refuses a suspended clock before its delayed statechange event', async ({ page }) => {
  await fixture(page);
  const result = await page.evaluate(() => {
    window.session = new Session({ context: ctx, source }); session.start();
    Object.defineProperty(ctx, 'state', { configurable: true, value: 'suspended' });
    session.sample();
    delete ctx.state;
    return { state: session.state, result: session.cancel() };
  });
  expect(result.state).toBe('cancelled'); expect(result.result.reason).toBe('audio-interrupted');
});

test('completion callback exceptions are exposed after cleanup without leaving done unresolved', async ({ page }) => {
  await fixture(page);
  const result = await page.evaluate(async () => {
    window.session = new Session({ context: ctx, source, onComplete: () => { throw new Error('consumer failed'); } });
    session.start();
    let thrown = null;
    try { session.stop(); } catch (error) { thrown = error.message; }
    return { thrown, result: await session.done, frame: session.frame, listeners: session.listeners.length };
  });
  expect(result.thrown).toBe(null); expect(result.result.status).toBe('failed');
  expect(result.result.reason).toBe('callback-error'); expect(result.result.error).toBe('consumer failed');
  expect(result.frame).toBe(null); expect(result.listeners).toBe(0);
});

test('tracker observation cap closes the branch even without animation frames', async ({ page }) => {
  await fixture(page);
  const result = await page.evaluate(async () => {
    window.requestAnimationFrame = () => { throw new Error('RAF capture is forbidden'); };
    window.session = new Session({ context: ctx, source, maxObservations: 1 });
    session.start();
    const result = await session.done;
    return { result, live: bus.stream.getAudioTracks()[0].readyState, frame: session.frame, listeners: session.listeners.length };
  });
  expect(result.result.reason).toBe('tracker-limit'); expect(result.result.notes).toEqual([]);
  expect(result.live).toBe('live'); expect(result.frame).toBe(null); expect(result.listeners).toBe(0);
});

test('manual stop flushes the active note while cancelling a later capture discards it', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    window.session = new Session({ context: ctx, source, onStableNote: note => stable.push(note) }); session.start();
  });
  await expect.poll(() => page.evaluate(() => stable.some(note => note?.midi === 69))).toBe(true);
  const stopped = await page.evaluate(() => session.stop());
  expect(stopped.notes.map(note => note.midi)).toEqual([69]); expect(stopped.reason).toBe('manual');
  await page.evaluate(() => {
    stable.length = 0;
    window.session = new Session({ context: ctx, source, onStableNote: note => stable.push(note) }); session.start();
  });
  await expect.poll(() => page.evaluate(() => stable.some(note => note?.midi === 69))).toBe(true);
  const cancelled = await page.evaluate(() => session.cancel());
  expect(cancelled.status).toBe('cancelled'); expect(cancelled.notes).toEqual([]);
});

test('rejects unavailable analyser APIs and invalid limits without acquiring resources', async ({ page }) => {
  await fixture(page);
  const result = await page.evaluate(async () => {
    const limits = [];
    for (const options of [{ maxDurationSeconds: 301 }, { maxNotes: 2049 }, { maxObservations: 60001 }]) {
      try { new Session({ context: ctx, source, ...options }); } catch (error) { limits.push(error.name); }
    }
    const create = ctx.createAnalyser.bind(ctx);
    ctx.createAnalyser = () => {
      const analyser = create(); analyser.getFloatTimeDomainData = undefined; return analyser;
    };
    window.session = new Session({ context: ctx, source });
    let message;
    try { session.start(); } catch (error) { message = error.message; }
    return { limits, message, result: await session.done, listeners: session.listeners.length };
  });
  expect(result.limits).toEqual(['RangeError', 'RangeError', 'RangeError']);
  expect(result.message).toMatch(/unavailable/); expect(result.result.status).toBe('failed'); expect(result.listeners).toBe(0);
});

test('outer source disconnection cannot strand cancellation or prevent scratch cleanup', async ({ page }) => {
  await fixture(page);
  const result = await page.evaluate(async () => {
    window.session = new Session({ context: ctx, source }); session.start();
    source.disconnect(); // The source owner is allowed to remove its own graph.
    let thrown = null;
    try { session.cancel(); } catch (error) { thrown = error.message; }
    return { thrown, settled: !!session.result, state: session.state, frame: session.frame, listeners: session.listeners.length };
  });
  expect(result.thrown).toBe(null); expect(result.settled).toBe(true); expect(result.state).toBe('cancelled');
  expect(result.frame).toBe(null); expect(result.listeners).toBe(0);
});

test('96kHz capture preserves low notes with a detector-supported window', async ({ page }) => {
  await fixture(page, 96000);
  const result = await page.evaluate(async () => {
    osc.frequency.value = 110;
    window.session = new Session({ context: ctx, source, maxDurationSeconds: 1.9 });
    session.start();
    const frameSize = session.frame.length;
    osc.frequency.setValueAtTime(65.4064, ctx.currentTime + 0.6);
    osc.frequency.setValueAtTime(440, ctx.currentTime + 1);
    osc.frequency.setValueAtTime(110, ctx.currentTime + 1.4);
    return { frameSize, rate: ctx.sampleRate, result: await session.done };
  });
  expect(result.rate).toBe(96000);
  expect(result.frameSize).toBe(8192);
  expect(result.result.notes.map(n => n.midi)).toEqual([45, 36, 69, 45]);
  expect(result.result.notes.every((n, i, all) => !i || n.startTime >= all[i - 1].endTime)).toBe(true);
});

test('192kHz fails explicitly rather than silently losing the low detector range', async ({ page }) => {
  await fixture(page, 192000);
  const result = await page.evaluate(async () => {
    window.session = new Session({ context: ctx, source });
    let message;
    try { session.start(); } catch (error) { message = error.message; }
    const state = session.state;
    session.cancel();
    return { message, state, frame: session.frame, edges: edges.filter(e => e.from === source).length };
  });
  expect(result.state).toBe('failed');
  expect(result.message).toMatch(/sample rate/i);
  expect(result.edges).toBe(0);
});

test('deterministic PCM replay covers polling and carrier phases of varied 80ms changes and 20ms spikes at 44.1/48/96kHz', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await fixture(page);
  const replay = await page.evaluate(() => {
    const failures = [];
    let cases = 0;
    // Only delivery/clock are controlled. Native context/analyser allocation,
    // generated PCM, production window selection, detector and tracker are real.
    // The independent scheduled-stream tests below exercise native timer delivery.
    for (const rate of [44100, 48000, 96000]) {
      for (const targetMidi of [57, 60, 64, 67, 70, 72, 76, 81]) for (let phase = 0; phase < 20; phase++) for (const carrierPhase of [0, 0.125, 0.25, 0.375]) for (const duplicatePoll of [false, true]) for (const duration of [0.08, 0.02]) {
        const targetHz = 440 * 2 ** ((targetMidi - 69) / 12);
        Object.defineProperty(ctx, 'sampleRate', { configurable: true, value: rate });
        Object.defineProperty(ctx, 'currentTime', { configurable: true, value: 0 });
        window.session = new Session({ context: ctx, source, maxDurationSeconds: 1 });
        session.start();
        clearInterval(session.interval); clearTimeout(session.timeout);
        const observations = [];
        let detectorCalls = 0;
        const detect = session.detector.detect.bind(session.detector);
        session.detector.detect = (...args) => { detectorCalls++; return detect(...args); };
        const push = session.tracker.push.bind(session.tracker);
        session.tracker.push = value => { observations.push(value); return push(value); };
        let end = 0;
        session.analyser.getFloatTimeDomainData = frame => {
          for (let i = 0; i < frame.length; i++) {
            const time = end - (frame.length - i) / rate;
            const cycles = time < 0.3 ? time * 440 : time < 0.3 + duration
              ? 0.3 * 440 + (time - 0.3) * targetHz
              : 0.3 * 440 + duration * targetHz + (time - 0.3 - duration) * 440;
            frame[i] = 0.3 * Math.sin(2 * Math.PI * (cycles + carrierPhase));
          }
        };
        for (let poll = 0.1 + phase / 1000; poll < 0.65; poll += 0.02) {
          // Replay a native-observed duplicate poll followed by a 40ms gap.
          const represented = duplicatePoll && poll >= 0.36 && poll < 0.38 ? poll - 0.02 : poll;
          end = Math.floor(represented * rate / 128) * 128 / rate;
          Object.defineProperty(ctx, 'currentTime', { configurable: true, value: end });
          session.sample();
        }
        const result = session.stop();
        cases++;
        const expected = JSON.stringify(duration === 0.08 ? [69, targetMidi, 69] : [69]);
        const observationCount = session.tracker.observationCount;
        if (JSON.stringify(result.notes.map(n => n.midi)) !== expected || detectorCalls > 2 * observationCount) {
          failures.push({ rate, targetMidi, phase, carrierPhase, duplicatePoll, duration, detectorCalls, observationCount, result, observations });
        }
        delete ctx.sampleRate; delete ctx.currentTime;
      }
    }
    return { cases, failures };
  });
  fs.writeFileSync(testInfo.outputPath('pcm-replay.json'), JSON.stringify(replay));
  if (replay.failures.length) await testInfo.attach('PCM replay observations', { body: JSON.stringify(replay), contentType: 'application/json' });
  expect(replay.cases).toBe(7680);
  expect(replay.failures.length, JSON.stringify(replay.failures.slice(0, 2).map(({ observations, ...summary }) => summary))).toBe(0);
});

for (const sampleRate of [44100, 48000, 96000]) test(`native phase-continuous BufferSource matrix retains 80ms notes and rejects 20ms spikes at ${sampleRate}Hz`, async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await fixture(page, sampleRate);
  const matrix = await page.evaluate(async () => {
    osc.disconnect(bus);
    const cases = [];
    const targets = [57, 64, 67, 72, 76, 81];
    for (const carrierPhase of [0, 0.125, 0.25, 0.375]) {
      const events = targets.flatMap((midi, index) => [0.08, 0.02].map((duration, kind) => ({
        midi, duration, start: 0.3 + (index * 2 + kind) * 0.26 + (index % 3) * 0.007,
      })));
      const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 3.65), ctx.sampleRate);
      const pcm = buffer.getChannelData(0);
      let cycles = carrierPhase;
      for (let i = 0; i < pcm.length; i++) {
        const time = i / ctx.sampleRate;
        const event = events.find(e => time >= e.start && time < e.start + e.duration);
        pcm[i] = 0.3 * Math.sin(2 * Math.PI * cycles);
        cycles += (event ? 440 * 2 ** ((event.midi - 69) / 12) : 440) / ctx.sampleRate;
      }
      const generator = ctx.createBufferSource(); generator.buffer = buffer; generator.connect(bus);
      const observations = [];
      window.session = new Session({ context: ctx, source, maxDurationSeconds: 3.9 });
      let detectorCalls = 0;
      const detect = session.detector.detect.bind(session.detector);
      session.detector.detect = (...args) => { detectorCalls++; return detect(...args); };
      const push = session.tracker.push.bind(session.tracker);
      session.tracker.push = value => { observations.push(value); return push(value); };
      session.start(); generator.start(ctx.currentTime + 0.06);
      const result = await session.done;
      generator.stop(); generator.disconnect();
      cases.push({ carrierPhase, rate: ctx.sampleRate, events, result, detectorCalls,
        count: session.tracker.observationCount, observations,
        scratchReleased: session.frame === null, listeners: session.listeners.length });
    }
    return { cases, speakers: edges.some(e => e.to === ctx.destination) };
  });
  fs.writeFileSync(testInfo.outputPath('native-pcm-matrix.json'), JSON.stringify(matrix));
  const expected = [69, ...[57, 64, 67, 72, 76, 81].flatMap(midi => [midi, 69])];
  expect(matrix.cases).toHaveLength(4);
  for (const entry of matrix.cases) {
    expect(entry.rate).toBe(sampleRate);
    expect(entry.result.notes.map(n => n.midi), JSON.stringify(entry)).toEqual(expected);
    expect(entry.result.status).toBe('stopped');
    expect(entry.result.cleanupErrors).toEqual([]);
    expect(entry.detectorCalls).toBeLessThanOrEqual(2 * entry.count);
    expect(entry.count).toBeLessThanOrEqual(196);
    expect(entry.scratchReleased).toBe(true); expect(entry.listeners).toBe(0);
    expect(entry.result.notes.every((n, i, all) => n.duration >= 0.03 - 1e-9 && (!i || n.startTime >= all[i - 1].endTime))).toBe(true);
  }
  expect(matrix.speakers).toBe(false);
});

test('delayed deadline and repeated audio timestamps cannot read PCM or consume extra detector work', async ({ page }) => {
  await fixture(page);
  const result = await page.evaluate(() => {
    Object.defineProperty(ctx, 'currentTime', { configurable: true, value: 0 });
    window.session = new Session({ context: ctx, source, maxDurationSeconds: 1 }); session.start();
    clearInterval(session.interval); clearTimeout(session.timeout);
    let reads = 0, calls = 0;
    session.analyser.getFloatTimeDomainData = frame => {
      reads++;
      for (let i = 0; i < frame.length; i++) frame[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / ctx.sampleRate);
    };
    const detect = session.detector.detect.bind(session.detector);
    session.detector.detect = (...args) => { calls++; return detect(...args); };
    Object.defineProperty(ctx, 'currentTime', { configurable: true, value: 0.2 });
    session.sample(); session.sample(); session.sample();
    const before = { reads, calls, count: session.tracker.observationCount };
    Object.defineProperty(ctx, 'currentTime', { configurable: true, value: 1.1 });
    session.sample(); session.sample();
    const stopped = session.stop(); const again = session.stop();
    delete ctx.currentTime;
    return { before, reads, calls, stopped, again, frame: session.frame, listeners: session.listeners.length };
  });
  expect(result.before).toEqual({ reads: 1, calls: 2, count: 1 });
  expect(result.reads).toBe(1); expect(result.calls).toBe(2);
  expect(result.stopped.reason).toBe('duration-limit'); expect(result.stopped.endTime).toBe(1);
  expect(result.again).toEqual(result.stopped); expect(result.frame).toBe(null); expect(result.listeners).toBe(0);
});

for (const sampleRate of [44100, 48000, 96000]) test(`native scheduled 80ms C5 changes survive the capture timer across onset phases at ${sampleRate}Hz`, async ({ page }) => {
  await fixture(page, sampleRate);
  const result = await page.evaluate(async () => {
    // Real native graph, detector and session timer; no direct sample() calls,
    // fabricated detector results or physical input. Schedule in audio seconds.
    const observations = [];
    window.session = new Session({ context: ctx, source, maxDurationSeconds: 3 });
    const detect = session.detector.detect.bind(session.detector);
    session.detector.detect = (...args) => {
      const value = detect(...args);
      observations.push({ time: ctx.currentTime, hz: value.frequencyHz });
      return value;
    };
    session.start();
    const base = ctx.currentTime + 0.3;
    for (const offset of [0, 0.367, 0.734, 1.101, 1.468, 1.835]) {
      osc.frequency.setValueAtTime(523.251, base + offset);
      osc.frequency.setValueAtTime(440, base + offset + 0.08);
    }
    const result = await session.done;
    return { result, observations, count: session.tracker.observationCount };
  });

  expect(result.result.status).toBe('stopped');
  expect(result.result.notes.map(n => n.midi), JSON.stringify(result)).toEqual([69, 72, 69, 72, 69, 72, 69, 72, 69, 72, 69, 72, 69]);
  expect(result.count).toBeLessThanOrEqual(151); // <=50Hz, not an RAF/busy loop
  expect(result.observations.length).toBeLessThanOrEqual(2 * result.count); // bounded fallback work
  expect(result.result.notes.every((n, i, all) => n.startTime >= result.result.startTime && n.duration >= 0.03 - 1e-9 && (!i || n.startTime >= all[i - 1].endTime))).toBe(true);
});

for (const sampleRate of [44100, 48000, 96000]) test(`native broadband noise and 20ms pitch spikes do not create false notes at ${sampleRate}Hz`, async ({ page }) => {
  await fixture(page, sampleRate);
  const result = await page.evaluate(async () => {
    osc.disconnect(bus);
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    let seed = 123456;
    const pcm = noise.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      pcm[i] = (seed / 4294967296 - 0.5) * 0.5;
    }
    const generator = ctx.createBufferSource();
    generator.buffer = noise; generator.loop = true; generator.connect(bus); generator.start();
    window.session = new Session({ context: ctx, source, maxDurationSeconds: 0.7 });
    session.start();
    const noisy = await session.done;
    generator.stop(); generator.disconnect();
    osc.connect(bus);
    window.session = new Session({ context: ctx, source, maxDurationSeconds: 2 });
    session.start();
    const base = ctx.currentTime + 0.3;
    for (const offset of [0, 0.267, 0.534, 0.801, 1.068]) {
      osc.frequency.setValueAtTime(523.251, base + offset);
      osc.frequency.setValueAtTime(440, base + offset + 0.02);
    }
    return { noisy, spiky: await session.done };
  });
  expect(result.noisy.status).toBe('stopped'); expect(result.noisy.notes).toEqual([]);
  expect(result.spiky.status).toBe('stopped'); expect(result.spiky.notes.map(n => n.midi)).toEqual([69]);
  expect(result.noisy.cleanupErrors).toEqual([]); expect(result.spiky.cleanupErrors).toEqual([]);
});

test('native vibrato and isolated 10ms pitch spikes do not create jitter notes', async ({ page }) => {
  await fixture(page);
  const result = await page.evaluate(async () => {
    window.session = new Session({ context: ctx, source, maxDurationSeconds: 1.8 });
    session.start();
    const base = ctx.currentTime + 0.2;
    for (let i = 0; i < 100; i++) {
      const hz = 440 * 2 ** ((0.55 * Math.sin(i * 0.01 * 2 * Math.PI * 5)) / 12);
      osc.frequency.setValueAtTime(hz, base + i * 0.01);
    }
    osc.frequency.setValueAtTime(440, base + 1);
    for (const offset of [1.1, 1.3]) {
      osc.frequency.setValueAtTime(523.251, base + offset);
      osc.frequency.setValueAtTime(440, base + offset + 0.01);
    }
    return await session.done;
  });
  expect(result.notes.map(n => n.midi)).toEqual([69]);
});

test('real generated stream yields stable A4 then B4 and bounded local notes without speaker or owner leakage', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    window.session = new Session({ context: ctx, source, maxDurationSeconds: 1.6,
      onStableNote: note => stable.push(note), onComplete: result => completed.push(result) });
    session.start();
  });
  await expect.poll(() => page.evaluate(() => stable.some(n => n?.midi === 69))).toBe(true);
  await page.evaluate(() => { osc.frequency.value = 493.883; });
  await expect.poll(() => page.evaluate(() => stable.some(n => n?.midi === 71))).toBe(true);
  const result = await page.evaluate(async () => {
    const result = await session.done;
    return { result, stable, count: completed.length, state: session.state, running: ctx.state,
      alive: bus.stream.getTracks().every(t => t.readyState === 'live'),
      speakers: edges.some(e => e.to === ctx.destination),
      sourceEdges: edges.filter(e => e.from === source).length,
      preciseDisconnect: disconnects.filter(e => e.node === source).every(e => e.args.length === 1 && e.args[0] !== unowned),
      ownerDisconnected: disconnects.some(e => e.node === unowned) };
  });
  expect(result.result.status).toBe('stopped');
  expect(result.result.reason).toBe('duration-limit');
  expect(result.result.notes.map(n => n.midi)).toEqual([69, 71]);
  expect(result.result.notes.every(n => n.startTime >= result.result.startTime && n.endTime <= result.result.endTime && n.duration > 0)).toBe(true);
  expect(result.count).toBe(1); expect(result.running).toBe('running'); expect(result.alive).toBe(true);
  expect(result.speakers).toBe(false); expect(result.sourceEdges).toBe(1); expect(result.preciseDisconnect).toBe(true); expect(result.ownerDisconnected).toBe(false);
});
