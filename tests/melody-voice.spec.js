const { test, expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// Native installed Chrome only; this isolated lab never loads the app, remote
// modules, audio devices or the existing instrument synthesizers.
test.use({ channel: 'chrome', serviceWorkers: 'block' });
let server, origin;
test.beforeAll(async () => {
  const root = path.resolve(__dirname, '..');
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Native melody voice lab</title>'); return; }
    if (!['/js/melodyVoice.js', '/js/audioPlaybackLifetime.js'].includes(pathname)) { res.writeHead(404).end(); return; }
    fs.readFile(path.join(root, pathname), (error, bytes) => {
      res.writeHead(error ? 404 : 200, { 'Content-Type': 'text/javascript' });
      res.end(error ? '' : bytes);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { if (server) await new Promise(resolve => server.close(resolve)); });
test.beforeEach(async ({ page }) => {
  const errors = [], requests = [];
  page.__melodyErrors = errors;
  page.__melodyRequests = requests;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    requests.push(url.href);
    return url.origin === origin && ['/', '/js/melodyVoice.js', '/js/audioPlaybackLifetime.js'].includes(url.pathname)
      ? route.continue() : route.abort();
  });
  await page.goto(origin);
  await page.evaluate(async () => {
    window.voiceModule = await import('/js/melodyVoice.js');
    window.Lifetime = (await import('/js/audioPlaybackLifetime.js')).default;
    window.measure = (data, from, to, rate) => {
      const a = Math.ceil(from * rate), b = Math.floor(to * rate);
      let energy = 0, peak = 0;
      const crossings = [];
      for (let i = a; i < b; i++) {
        if (!Number.isFinite(data[i])) throw new Error('Non-finite native output');
        energy += data[i] ** 2;
        peak = Math.max(peak, Math.abs(data[i]));
        if (i > a && data[i - 1] <= 0 && data[i] > 0) crossings.push(i - data[i] / (data[i] - data[i - 1]));
      }
      return { peak, rms: Math.sqrt(energy / (b - a)), hz: (crossings.length - 1) * rate / (crossings.at(-1) - crossings[0]) };
    };
    window.observe = context => {
      const log = { starts: [], stops: [], params: [], sources: [], gains: [] };
      for (const method of ['createOscillator', 'createBufferSource']) {
        const original = context[method].bind(context);
        context[method] = (...args) => {
          const source = original(...args); log.sources.push(source);
          for (const action of ['start', 'stop']) {
            const native = source[action].bind(source);
            source[action] = (...values) => { log[action === 'start' ? 'starts' : 'stops'].push(values); return native(...values); };
          }
          for (const name of ['frequency', 'detune', 'playbackRate']) if (source[name]) {
            const native = source[name].setValueAtTime.bind(source[name]);
            source[name].setValueAtTime = (value, time) => { log.params.push([name, value, time]); return native(value, time); };
          }
          return source;
        };
      }
      const createGain = context.createGain.bind(context);
      context.createGain = () => {
        const node = createGain(); log.gains.push(node);
        for (const method of ['setValueAtTime', 'linearRampToValueAtTime']) {
          const native = node.gain[method].bind(node.gain);
          node.gain[method] = (value, time) => { log.params.push([method, value, time]); return native(value, time); };
        }
        return node;
      };
      return log;
    };
  });
  page.__melodyErrors = errors;
  page.__melodyRequests = requests;
});
test.afterEach(async ({ page }) => {
  expect(page.__melodyErrors).toEqual([]);
  expect(page.__melodyRequests.every(url => url.startsWith(origin + '/'))).toBe(true);
});

for (const midi of [48, 81]) test(`oscillator MIDI ${midi} is absolute, not a relative instrument pitch shift`, async ({ page }) => {
  const result = await page.evaluate(async midi => {
    const context = new OfflineAudioContext(1, 48000, 48000), lifetime = new Lifetime(), log = observe(context);
    voiceModule.scheduleMelodyVoice({ context, destination: context.destination, lifetime, midi, cents: -43,
      time: 0.1, duration: 0.4, release: 0, velocity: 0.2 });
    const data = (await context.startRendering()).getChannelData(0);
    return { params: log.params, sound: measure(data, 0.15, 0.45, 48000), after: measure(data, 0.501, 1, 48000).peak };
  }, midi);
  const expected = 440 * 2 ** ((midi - 69 - 0.43) / 12);
  expect(result.params).toContainEqual(['frequency', expected, 0.1]);
  expect(result.sound.hz).toBeCloseTo(expected, 2); expect(result.sound.peak).toBeCloseTo(0.2, 3); expect(result.after).toBe(0);
});

for (const kind of ['oscillator', 'sample']) test(`zero-velocity ${kind} produces no unexpected output`, async ({ page }) => {
  const result = await page.evaluate(async kind => {
    const context = new OfflineAudioContext(1, 48000, 48000), lifetime = new Lifetime();
    const buffer = context.createBuffer(1, 48000, 48000); buffer.getChannelData(0).fill(1);
    const voice = voiceModule.scheduleMelodyVoice({ context, destination: context.destination, lifetime, kind,
      buffer, rootMidi: 0, midi: 12, time: 0, duration: 0.2, release: 0, velocity: 0 });
    const data = (await context.startRendering()).getChannelData(0);
    await new Promise(resolve => setTimeout(resolve, 0));
    return { peak: measure(data, 0, 1, 48000).peak, sources: lifetime.sources.size, rate: voice.playbackRate };
  }, kind);
  expect(result.peak).toBe(0); expect(result.sources).toBe(0);
  if (kind === 'sample') expect(result.rate).toBe(2); // An explicit MIDI-zero root must not be treated as missing.
});

test('overlapping native voices preserve independently gated pitches and velocities', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const context = new OfflineAudioContext(1, 48000, 48000), lifetime = new Lifetime();
    const notes = [{ midi: 69, time: 0.1, duration: 0.2, release: 0, velocity: 0.2 },
      { midi: 81, time: 0.2, duration: 0.3, release: 0, velocity: 0.1 },
      { midi: 57, time: 0.25, duration: 0.35, release: 0, velocity: 0.3 }];
    const voices = notes.map(note => voiceModule.scheduleMelodyVoice({ context, destination: context.destination, lifetime, ...note }));
    const independent = new Set(voices.map(v => v.source)).size === 3 && new Set(voices.map(v => v.gain)).size === 3;
    const owned = lifetime.sources.size;
    const data = (await context.startRendering()).getChannelData(0);
    // Native oscillator phase at a non-440 onset can depend on its render
    // quantum; compare the real sum to independently rendered native voices,
    // rather than assuming every frequency has mathematical zero phase.
    const isolated = [];
    for (const note of notes) {
      const solo = new OfflineAudioContext(1, 48000, 48000);
      voiceModule.scheduleMelodyVoice({ context: solo, destination: solo.destination, lifetime: new Lifetime(), ...note });
      isolated.push((await solo.startRendering()).getChannelData(0));
    }
    let maxError = 0;
    for (let i = 0; i < data.length; i++) {
      const expected = isolated.reduce((sum, samples) => sum + samples[i], 0);
      maxError = Math.max(maxError, Math.abs(data[i] - expected));
    }
    return { independent, owned, maxError, silent: measure(data, 0.601, 1, 48000).peak };
  });
  expect(result.independent).toBe(true); expect(result.owned).toBe(3);
  expect(result.maxError).toBeLessThan(0.001); expect(result.silent).toBe(0);
});

test('320 native voices keep two track routes and their supplied context stable without musical timers', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const context = new OfflineAudioContext(1, 48000, 48000), lifetime = new Lifetime();
    const tracks = [context.createGain(), context.createGain()];
    for (const track of tracks) { track.gain.value = 0.7; track.connect(context.destination); }
    const log = observe(context), voices = [];
    const originalTimeout = window.setTimeout, AC = window.AudioContext, OAC = window.OfflineAudioContext;
    window.setTimeout = () => { throw new Error('No musical timers'); };
    window.AudioContext = window.OfflineAudioContext = function () { throw new Error('Do not replace track context'); };
    try {
      for (let i = 0; i < 320; i++) voices.push(voiceModule.scheduleMelodyVoice({ context, destination: tracks[i % 2], lifetime,
        midi: 48 + i % 36, waveform: ['sine', 'triangle', 'square', 'sawtooth'][i % 4],
        time: 0.02 + i / 1000, duration: 0.05, release: i % 2 ? 0.02 : 0, velocity: i === 0 ? 0 : 0.001 }));
    } finally { window.setTimeout = originalTimeout; window.AudioContext = AC; window.OfflineAudioContext = OAC; }
    const before = { sources: lifetime.sources.size, routes: lifetime.routes.size, timers: lifetime.timers.size,
      stable: voices.every(v => v.source.context === context && v.gain.context === context) && tracks.every(t => t.context === context && t.gain.value === Math.fround(0.7)) };
    const data = (await context.startRendering()).getChannelData(0);
    await new Promise(resolve => setTimeout(resolve, 0));
    const after = { sources: lifetime.sources.size, routes: lifetime.routes.size, timers: lifetime.timers.size };
    lifetime.cancel();
    return { before, after, starts: log.starts.length, stops: log.stops.length,
      sound: measure(data, 0.03, 0.4, 48000).peak, silent: measure(data, 0.42, 1, 48000).peak,
      cancelledRoutes: lifetime.routes.size };
  });
  expect(result.before).toEqual({ sources: 320, routes: 2, timers: 0, stable: true });
  expect(result.after).toEqual({ sources: 0, routes: 2, timers: 0 });
  expect(result.starts).toBe(320); expect(result.stops).toBe(320);
  expect(result.sound).toBeGreaterThan(0.001); expect(result.sound).toBeLessThan(0.32);
  expect(result.silent).toBe(0); expect(result.cancelledRoutes).toBe(0);
});

test('real lifetime refusal during source registration cannot start an unowned voice', async ({ page }) => {
  const result = await page.evaluate(() => {
    const context = new OfflineAudioContext(1, 48000, 48000), lifetime = new Lifetime(), log = observe(context);
    const ownSource = lifetime.ownSource.bind(lifetime);
    lifetime.ownSource = (...args) => { lifetime.cancel(); return ownSource(...args); };
    const voice = voiceModule.scheduleMelodyVoice({ context, destination: context.destination, lifetime, time: 0.5, midi: 69, duration: 0.2 });
    return { refused: voice === null, starts: log.starts, sources: lifetime.sources.size, routes: lifetime.routes.size };
  });
  expect(result).toEqual({ refused: true, starts: [], sources: 0, routes: 0 });
});

test('invalid parameters fail atomically without native allocation, decoding, or guessed roots', async ({ page }) => {
  const result = await page.evaluate(() => {
    const context = new OfflineAudioContext(1, 48000, 48000), other = new OfflineAudioContext(1, 10, 48000);
    const lifetime = new Lifetime(), log = observe(context), buffer = context.createBuffer(1, 48000, 48000);
    const base = { context, destination: context.destination, lifetime, midi: 69, time: 0.1, duration: 0.2 };
    const cases = [
      { midi: NaN }, { midi: Infinity }, { midi: -1 }, { midi: 128 }, { midi: '69' }, { midi: 69.5 },
      { cents: NaN }, { cents: 1201 }, { cents: -1201 }, { velocity: -0.01 }, { velocity: 1.01 }, { velocity: Infinity },
      { time: -1 }, { time: NaN }, { time: 3601 }, { duration: 0 }, { duration: -1 }, { duration: 601 },
      { release: -0.1 }, { release: 61 }, { release: Infinity }, { waveform: 'custom' }, { kind: 'Synth Piano' },
      { lifetime: { active: true } }, { lifetime: null }, { context: {} }, { destination: other.destination }, { destination: null },
      { kind: 'sample', buffer }, { kind: 'sample', buffer, rootMidi: NaN }, { kind: 'sample', buffer, rootMidi: '60' },
      { kind: 'sample', buffer, rootMidi: 60.5 }, { kind: 'sample', rootMidi: 60 },
      { kind: 'sample', buffer: {}, rootMidi: 60 }, { kind: 'sample', buffer: Promise.resolve(buffer), rootMidi: 60 },
      { kind: 'sample', buffer, rootMidi: 127, midi: 0 }, { kind: 'sample', buffer, rootMidi: 0, midi: 127 },
      { midi: 127, cents: 1200 }
    ];
    const accepted = [], unexpected = [];
    cases.forEach((change, index) => {
      try { voiceModule.scheduleMelodyVoice({ ...base, ...change }); accepted.push(index); }
      catch (error) { if (!(error instanceof TypeError || error instanceof RangeError)) unexpected.push([index, error.name]); }
    });
    return { accepted, unexpected, allocations: log.sources.length + log.gains.length, starts: log.starts,
      sources: lifetime.sources.size, routes: lifetime.routes.size, timers: lifetime.timers.size };
  });
  expect(result).toEqual({ accepted: [], unexpected: [], allocations: 0, starts: [], sources: 0, routes: 0, timers: 0 });
});

test('cancelled lifetime refuses new scheduling before allocating native nodes', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const context = new OfflineAudioContext(1, 48000, 48000), lifetime = new Lifetime(), log = observe(context);
    lifetime.cancel();
    const refused = voiceModule.scheduleMelodyVoice({ context, destination: context.destination, lifetime,
      midi: 69, time: 0.5, duration: 0.2 });
    return { refused: refused === null, allocations: log.sources.length + log.gains.length,
      starts: log.starts, sources: lifetime.sources.size, routes: lifetime.routes.size, timers: lifetime.timers.size };
  });
  expect(result).toEqual({ refused: true, allocations: 0, starts: [], sources: 0, routes: 0, timers: 0 });
});

for (const kind of ['oscillator', 'sample']) for (const boundary of ['before-onset', 'during-release']) test(`native ${kind} lifetime cancellation is silent ${boundary}`, async ({ page }) => {
  const result = await page.evaluate(async ({ boundary, kind }) => {
    const context = new OfflineAudioContext(1, 48000, 48000), lifetime = new Lifetime(), log = observe(context);
    const time = boundary === 'before-onset' ? 0.5 : 0.05;
    const buffer = context.createBuffer(1, 96000, 48000);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(2 * Math.PI * 440 * i / 48000);
    const voice = voiceModule.scheduleMelodyVoice({ context, destination: context.destination, lifetime,
      kind, buffer, rootMidi: 69, midi: 69, time, duration: 0.15, release: 0.6, velocity: 0.3 });
    const gate = lifetime.routes.get(context.destination), delay = context.createDelay(1);
    delay.delayTime.value = 0.1;
    // Put a native delayed FX branch before the real lifetime's post-FX gate.
    voice.gain.connect(delay); delay.connect(gate);
    const disconnected = { source: 0, envelope: 0, route: 0 };
    for (const [key, node] of [['source', voice.source], ['envelope', voice.gain], ['route', gate]]) {
      const native = node.disconnect.bind(node);
      node.disconnect = (...args) => { disconnected[key]++; return native(...args); };
    }
    const suspension = context.suspend(0.3), rendering = context.startRendering();
    await suspension;
    const boundaryTime = context.currentTime;
    lifetime.cancel(); lifetime.cancel();
    const immediate = { sources: lifetime.sources.size, routes: lifetime.routes.size, timers: lifetime.timers.size, disconnected: { ...disconnected } };
    await context.resume();
    const data = (await rendering).getChannelData(0);
    delay.disconnect();
    return { immediate, stops: log.stops, boundaryTime, contextClosed: context.state === 'closed',
      before: measure(data, 0.06, 0.19, 48000).peak, after: measure(data, boundaryTime + 0.004, 1, 48000).peak };
  }, { boundary, kind });
  expect(result.immediate).toEqual({ sources: 0, routes: 0, timers: 0, disconnected: { source: 1, envelope: 1, route: 1 } });
  expect(result.stops).toHaveLength(2); expect(result.stops[1]).toEqual([]);
  expect(result.after).toBe(0);
  if (boundary === 'before-onset') expect(result.before).toBe(0);
  else expect(result.before).toBeGreaterThan(0.2);
});

for (const sampleRate of [24000, 48000]) test(`prepared explicitly rooted sample uses relative rate at ${sampleRate} Hz`, async ({ page }) => {
  const result = await page.evaluate(async sampleRate => {
    const context = new OfflineAudioContext(1, 48000, 48000), lifetime = new Lifetime(), log = observe(context);
    const buffer = context.createBuffer(1, sampleRate * 2, sampleRate), data = buffer.getChannelData(0);
    const rootHz = 440 * 2 ** ((60 - 69) / 12);
    for (let i = 0; i < data.length; i++) data[i] = Math.sin(2 * Math.PI * rootHz * i / sampleRate);
    const voice = voiceModule.scheduleMelodyVoice({ context, destination: context.destination, lifetime,
      kind: 'sample', buffer, rootMidi: 60, midi: 72, cents: -25, time: 0.1, duration: 0.4, release: 0.1, velocity: 0.25 });
    const identity = voice.source.buffer === buffer && voice.source instanceof AudioBufferSourceNode;
    const rendered = (await context.startRendering()).getChannelData(0);
    await new Promise(resolve => setTimeout(resolve, 0));
    return { identity, params: log.params, starts: log.starts, stops: log.stops, rate: voice.playbackRate,
      sound: measure(rendered, 0.15, 0.45, 48000), after: measure(rendered, 0.601, 1, 48000).peak,
      sources: lifetime.sources.size, timers: lifetime.timers.size };
  }, sampleRate);
  const rate = 2 ** ((12 - 0.25) / 12);
  expect(result.identity).toBe(true); expect(result.rate).toBeCloseTo(rate, 12);
  expect(result.params).toContainEqual(['playbackRate', rate, 0.1]);
  expect(result.starts).toEqual([[0.1]]); expect(result.stops[0][0]).toBeCloseTo(0.6, 12);
  expect(result.sound.hz).toBeCloseTo(440 * 2 ** ((72 - 69 - 0.25) / 12), 1);
  expect(result.sound.peak).toBeCloseTo(0.25, 2); expect(result.after).toBe(0);
  expect(result.sources).toBe(0); expect(result.timers).toBe(0);
});

test('native oscillator schedules absolute MIDI plus cents, velocity, gate and release without a new context', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const context = new OfflineAudioContext(1, 48000, 48000), lifetime = new Lifetime();
    const log = observe(context), before = context.currentTime;
    const voice = voiceModule.scheduleMelodyVoice({ context, destination: context.destination, lifetime,
      time: 0.1, midi: 69, cents: 37, velocity: 0.4, duration: 0.4, release: 0.1 });
    const synchronous = voice && typeof voice.then === 'undefined';
    const stable = before === context.currentTime && voice.source.context === context && voice.gain.context === context;
    const owned = lifetime.sources.has(voice.source) && lifetime.routes.has(context.destination);
    const data = (await context.startRendering()).getChannelData(0);
    await new Promise(resolve => setTimeout(resolve, 0)); // Only await native ended cleanup, never schedule music.
    return { synchronous, stable, owned, starts: log.starts, stops: log.stops, params: log.params,
      pitch: measure(data, 0.15, 0.45, 48000), release: measure(data, 0.54, 0.56, 48000),
      before: measure(data, 0, 0.099, 48000).peak, after: measure(data, 0.601, 1, 48000).peak,
      remaining: lifetime.sources.size, timers: lifetime.timers.size };
  });
  expect(result.synchronous).toBe(true); expect(result.stable).toBe(true); expect(result.owned).toBe(true);
  expect(result.starts).toEqual([[0.1]]); expect(result.stops[0][0]).toBeCloseTo(0.6, 12);
  expect(result.params).toContainEqual(['frequency', 440 * 2 ** (37 / 1200), 0.1]);
  expect(result.params).toContainEqual(['setValueAtTime', 0.4, 0.1]);
  expect(result.params).toContainEqual(['setValueAtTime', 0.4, 0.5]);
  expect(result.params.some(p => p[0] === 'linearRampToValueAtTime' && p[1] === 0 && Math.abs(p[2] - 0.6) < 1e-12)).toBe(true);
  expect(result.pitch.hz).toBeCloseTo(440 * 2 ** (37 / 1200), 2);
  expect(result.pitch.peak).toBeCloseTo(0.4, 3); expect(result.release.peak).toBeGreaterThan(0.15);
  expect(result.release.peak).toBeLessThan(0.25); expect(result.before).toBe(0); expect(result.after).toBe(0);
  expect(result.remaining).toBe(0); expect(result.timers).toBe(0);
});
