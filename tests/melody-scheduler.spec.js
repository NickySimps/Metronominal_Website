const { test, expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

test.use({ channel: 'chrome', serviceWorkers: 'block' });
let server, origin;
const allowed = ['/', '/js/melodyScheduler.js', '/js/melodySchema.js', '/js/melodyVoice.js', '/js/audioPlaybackLifetime.js'];
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname;
    if (!allowed.includes(name)) return res.writeHead(404).end();
    if (name === '/') return res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Melody cursor lab</title>');
    fs.readFile(path.join(__dirname, '..', name), (error, bytes) => res.writeHead(error ? 404 : 200, { 'Content-Type': 'text/javascript' }).end(error ? '' : bytes));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { await new Promise(resolve => server.close(resolve)); });
test.beforeEach(async ({ page }) => {
  page.errors = []; page.requests = [];
  page.on('pageerror', error => page.errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url()); page.requests.push(url.href);
    return url.origin === origin && allowed.includes(url.pathname) ? route.continue() : route.abort();
  });
  await page.goto(origin);
  await page.evaluate(async () => {
    window.scheduler = await import('/js/melodyScheduler.js');
    window.Lifetime = (await import('/js/audioPlaybackLifetime.js')).default;
    window.authority = { generation: 'play-1', tempo: 120, playing: true, practice: 'constant' };
    window.note = (id, startTick, midi = 69, durationTicks = 240) => ({ id, startTick, midi, durationTicks, velocity: 0.2 });
    window.fixture = (notes, overrides = {}) => {
      const context = new OfflineAudioContext(1, 48000, 48000), lifetime = new Lifetime();
      const track = { barSettings: [{ beats: 4 }], melody: { version: 1, bars: [notes] }, mainBeatSound: { sound: 'Synth Sine', settings: {} } };
      const instrument = scheduler.prepareMelodyInstrument({ sound: track.mainBeatSound });
      const cursor = scheduler.createMelodyCursor({ track, instrument, context, destination: context.destination, lifetime, authority,
        originTick: 0, originTime: 0.1, endTick: 960, ...overrides });
      return { context, lifetime, track, cursor };
    };
    window.measure = (data, start, end) => {
      let peak = 0; const crossings = [];
      for (let i = Math.ceil(start * 48000); i < Math.floor(end * 48000); i++) {
        if (!Number.isFinite(data[i])) throw new Error('Invalid native sample');
        peak = Math.max(peak, Math.abs(data[i]));
        if (i && data[i - 1] <= 0 && data[i] > 0) crossings.push(i - data[i] / (data[i] - data[i - 1]));
      }
      return { peak, hz: (crossings.length - 1) * 48000 / (crossings.at(-1) - crossings[0]) };
    };
  });
});
test.afterEach(async ({ page }) => {
  expect(page.errors).toEqual([]);
  expect(page.requests.every(url => url.startsWith(origin + '/') && allowed.includes(new URL(url).pathname))).toBe(true);
});

test('authoritative horizon consumes chronological off-grid notes exactly once and excludes its boundary', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { context, lifetime, cursor } = fixture([note('later', 720), note('first', 120), note('seam', 960), note('middle', 480)]);
    const first = cursor.advance({ horizonTime: 0.35, authority });
    const repeat = cursor.advance({ horizonTime: 0.35, authority });
    const second = cursor.advance({ horizonTime: 0.6, authority });
    const done = cursor.advance({ horizonTime: 0.9, authority });
    const timers = lifetime.timers.size;
    const data = (await context.startRendering()).getChannelData(0);
    return { first, repeat, second, done, timers, before: measure(data, 0, 0.162).peak,
      sound: measure(data, 0.18, 0.25), after: measure(data, 0.601, 1).peak };
  });
  expect(result.first.noteIds).toEqual(['first']);
  expect(result.repeat.noteIds).toEqual([]);
  expect(result.second.noteIds).toEqual(['middle', 'later']);
  expect(result.done.noteIds).toEqual([]);
  expect(result.done.rhythmAllowed).toBe(false);
  expect(result.before).toBe(0); expect(result.after).toBe(0);
  expect(result.sound.peak).toBeCloseTo(0.2, 3); expect(result.sound.hz).toBeCloseTo(440, 2);
  expect(result.timers).toBe(0);
});

for (const edit of ['melody', 'sound', 'pitch', 'meter']) test(`musical ${edit} edit invalidates queued voices rather than continuing a stale snapshot`, async ({ page }) => {
  const result = await page.evaluate(async edit => {
    const { cursor, track, context, lifetime } = fixture([note('queued', 480)]);
    cursor.advance({ horizonTime: 0.5, authority });
    if (edit === 'melody') track.melody.bars[0][0].midi = 81;
    if (edit === 'sound') track.mainBeatSound.sound = 'Synth Square';
    if (edit === 'pitch') track.pitchShift = 12;
    if (edit === 'meter') track.barSettings[0].beats = 3;
    const outcome = cursor.advance({ horizonTime: 0.6, authority });
    const data = (await context.startRendering()).getChannelData(0);
    return { outcome, sources: lifetime.sources.size, peak: measure(data, 0, 1).peak };
  }, edit);
  expect(result.outcome.status).toBe('track-changed');
  expect(result.outcome.rhythmAllowed).toBe(false);
  expect(result.sources).toBe(0); expect(result.peak).toBe(0);
});

for (const field of ['pitchShift', 'volume', 'release']) test(`preparation rejects coerced ${field} before allocating`, async ({ page }) => {
  const error = await page.evaluate(field => {
    try { scheduler.prepareMelodyInstrument({ sound: { sound: 'Synth Sine', settings: { [field]: '1' } } }); return null; }
    catch (error) { return error.message; }
  }, field);
  expect(error).toMatch(/Invalid melody scheduler/);
});

for (const change of [{ tempo: 121 }, { generation: 'seek' }, { playing: false }, { practice: 'gap' }, { practice: 'count-in' }, { practice: 'ladder' }])
  test(`authority ${JSON.stringify(change)} cancels pre-scheduled native audio without rhythm fallback`, async ({ page }) => {
    const result = await page.evaluate(async change => {
      const { cursor, context, lifetime } = fixture([note('future', 480)]);
      cursor.advance({ horizonTime: 0.5, authority });
      const outcome = cursor.advance({ horizonTime: 0.6, authority: { ...authority, ...change } });
      const again = cursor.advance({ horizonTime: 0.9, authority });
      const data = (await context.startRendering()).getChannelData(0);
      return { outcome, again, peak: measure(data, 0, 1).peak, sources: lifetime.sources.size, routes: lifetime.routes.size };
    }, change);
    expect(result.outcome.status).toBe('authority-changed'); expect(result.again.status).toBe('authority-changed');
    expect(result.outcome.rhythmAllowed).toBe(false); expect(result.peak).toBe(0);
    expect(result.sources).toBe(0); expect(result.routes).toBe(0);
  });

for (const mode of ['track-mute', 'solo-gate', 'shared-cancel', 'cursor-cancel', 'backward-horizon', 'invalid-horizon'])
  test(`${mode} silences native queued notes irreversibly`, async ({ page }) => {
    const result = await page.evaluate(async mode => {
      const { cursor, track, context, lifetime } = fixture([note('future', 480)]);
      cursor.advance({ horizonTime: 0.5, authority });
      if (mode === 'track-mute') track.muted = true;
      if (mode === 'shared-cancel') lifetime.cancel();
      if (mode === 'cursor-cancel') { cursor.cancel(); cursor.cancel(); }
      const outcome = cursor.advance({ horizonTime: mode === 'backward-horizon' ? 0.4 : mode === 'invalid-horizon' ? NaN : 0.6,
        authority, audible: mode !== 'solo-gate' });
      track.muted = false;
      const again = cursor.advance({ horizonTime: 0.9, authority });
      const data = (await context.startRendering()).getChannelData(0);
      return { outcome, again, next: cursor.nextEventTime === Infinity, peak: measure(data, 0, 1).peak, sources: lifetime.sources.size };
    }, mode);
    expect(result.outcome.status).not.toBe('active'); expect(result.again.noteIds).toEqual([]);
    expect(result.outcome.rhythmAllowed).toBe(false); expect(result.next).toBe(true);
    expect(result.peak).toBe(0); expect(result.sources).toBe(0);
  });

for (const sound of ['Synth Sine', 'Synth Triangle', 'Synth Square', 'Synth Sawtooth'])
  test(`${sound} keeps its actual native waveform, absolute pitch and hard lease end`, async ({ page }) => {
    const result = await page.evaluate(async sound => {
      const context = new OfflineAudioContext(1, 48000, 48000), lifetime = new Lifetime();
      const track = { barSettings: [{ beats: 4 }], melody: { version: 1, bars: [[note('long', 0, 69, 1920)]] }, mainBeatSound: { sound, settings: { release: 0.5 } } };
      const cursor = scheduler.createMelodyCursor({ track, instrument: scheduler.prepareMelodyInstrument({ sound: track.mainBeatSound }), context,
        destination: context.destination, lifetime, authority, originTick: 0, originTime: 0.1, endTick: 480 });
      cursor.advance({ horizonTime: 1, authority });
      const type = [...lifetime.sources.keys()][0].type;
      const data = (await context.startRendering()).getChannelData(0);
      return { type, end: cursor.endTime, before: measure(data, 0, 0.099).peak, sound: measure(data, 0.12, 0.32), after: measure(data, 0.351, 1).peak };
    }, sound);
    expect(result.type).toBe(sound.replace('Synth ', '').toLowerCase()); expect(result.end).toBeCloseTo(0.35, 10);
    expect(result.before).toBe(0); expect(result.after).toBe(0); expect(result.sound.peak).toBeGreaterThan(0.15);
    expect(result.sound.hz).toBeCloseTo(440, 0);
  });

test('rooted prepared recording preserves native buffer identity and measures an octave up', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const context = new OfflineAudioContext(1, 48000, 48000), lifetime = new Lifetime();
    const buffer = context.createBuffer(1, 96000, 48000), samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(2 * Math.PI * 220 * i / 48000);
    const track = { barSettings: [{ beats: 4 }], melody: { version: 1, bars: [[note('sample', 0, 69, 960)]], sampleRootMidi: 57 }, mainBeatSound: { sound: 'Local violin', settings: { release: 0.2 } } };
    const instrument = scheduler.prepareMelodyInstrument({ sound: track.mainBeatSound, buffer, rootMidi: 57 });
    const cursor = scheduler.createMelodyCursor({ track, instrument, context, destination: context.destination, lifetime, authority, originTick: 0, originTime: 0.1, endTick: 480 });
    cursor.advance({ horizonTime: 1, authority });
    const source = [...lifetime.sources.keys()][0];
    const identity = source.buffer === buffer && source instanceof AudioBufferSourceNode;
    const data = (await context.startRendering()).getChannelData(0);
    return { identity, sound: measure(data, 0.12, 0.32), after: measure(data, 0.351, 1).peak };
  });
  expect(result.identity).toBe(true); expect(result.sound.hz).toBeCloseTo(440, 1); expect(result.after).toBe(0);
});

test('empty selected melody stays silent and legacy absence alone permits the caller rhythm branch', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { cursor, context, lifetime } = fixture([]);
    const empty = cursor.advance({ horizonTime: 0.5, authority });
    const absent = scheduler.createMelodyCursor({ track: { barSettings: [{ beats: 4 }] } });
    const data = (await context.startRendering()).getChannelData(0);
    return { empty, absent, next: cursor.nextEventTime === Infinity, sources: lifetime.sources.size, routes: lifetime.routes.size, peak: measure(data, 0, 1).peak };
  });
  expect(result.empty).toEqual({ selected: true, rhythmAllowed: false, status: 'active', noteIds: [] });
  expect(result.absent).toBe(null); expect(result.next).toBe(true); expect(result.sources).toBe(0); expect(result.routes).toBe(0); expect(result.peak).toBe(0);
});

test('unsupported instruments, unprepared samples and incompatible settings are refused explicitly', async ({ page }) => {
  const result = await page.evaluate(() => {
    const context = new OfflineAudioContext(1, 48000, 48000), buffer = context.createBuffer(1, 48000, 48000);
    return [
      { sound: { sound: 'Synth Kick' } }, { sound: { sound: 'Synth Piano' }, buffer, rootMidi: 60 },
      { sound: { sound: 'Synth Unknown' } }, { sound: { sound: 'Missing recording' } },
      { sound: { sound: 'Recording' }, buffer }, { sound: { sound: 'Recording' }, buffer: Promise.resolve(buffer), rootMidi: 60 },
      { sound: { sound: 'Synth Sine', settings: { reverse: true } } },
    ].map(options => { try { scheduler.prepareMelodyInstrument(options); return null; } catch (error) { return error.message; } });
  });
  expect(result.every(message => typeof message === 'string' && /Unsupported|Prepare|Explicit/.test(message))).toBe(true);
});

test('invalid construction is atomic and never schedules partial notes', async ({ page }) => {
  const result = await page.evaluate(() => {
    const context = new OfflineAudioContext(1, 48000, 48000), lifetime = new Lifetime();
    const sound = { sound: 'Synth Sine', settings: { pitchShift: 12 } }, instrument = scheduler.prepareMelodyInstrument({ sound });
    const track = { barSettings: [{ beats: 4 }], melody: { version: 1, bars: [[note('first', 0), note('invalid', 240, 127)]] }, mainBeatSound: sound };
    const base = { track, instrument, context, lifetime, destination: context.destination, authority, originTick: 0, originTime: 0.1, endTick: 960 };
    const errors = [ {}, { track: { ...track, melody: undefined } }, { instrument: { kind: 'oscillator' } },
      { authority: { ...authority, practice: 'gap' } }, { endTick: 0 }, { originTime: -1 }, { destination: null },
      { track: { ...track, swing: 20 } }, { track: { ...track, melody: { version: 1, bars: [[note('bad', -1)]] } } },
    ].map(change => { try { scheduler.createMelodyCursor({ ...base, ...change }); return false; } catch { return true; } });
    return { errors, sources: lifetime.sources.size, routes: lifetime.routes.size };
  });
  expect(result.errors.every(Boolean)).toBe(true); expect(result.sources).toBe(0); expect(result.routes).toBe(0);
});

test('mock authority clock seam drives native offline suspension without future note or tail leakage', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { context, cursor, lifetime } = fixture([note('sustain', 0, 69, 960), note('at-seam', 384, 81, 480)]);
    let schedulerClock = 0.3; // Controlled authoritative lookahead, not a musical timer.
    const first = cursor.advance({ horizonTime: schedulerClock, authority });
    const suspension = context.suspend(0.3), rendering = context.startRendering();
    await suspension;
    const seam = context.currentTime;
    schedulerClock = seam + 0.1;
    const changed = cursor.advance({ horizonTime: schedulerClock, authority: { ...authority, generation: 'replacement' } });
    const immediate = { sources: lifetime.sources.size, routes: lifetime.routes.size };
    await context.resume();
    const data = (await rendering).getChannelData(0);
    return { first, changed, immediate, seam, before: measure(data, 0.12, 0.28).peak, after: measure(data, seam + 0.004, 1).peak };
  });
  expect(result.first.noteIds).toEqual(['sustain']); expect(result.changed.noteIds).toEqual([]);
  expect(result.immediate).toEqual({ sources: 0, routes: 0 }); expect(result.before).toBeGreaterThan(0.19); expect(result.after).toBe(0);
});

test('cursor cancellation preserves sibling voices, shared lifetime and original track destination', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { cursor, context, lifetime } = fixture([note('melody', 480)]);
    const sibling = context.createOscillator(), gain = context.createGain();
    gain.gain.value = 0.1; sibling.frequency.value = 220; sibling.connect(gain); gain.connect(lifetime.output(context, context.destination));
    lifetime.ownSource(sibling, () => gain.disconnect()); sibling.start(0.1); sibling.stop(0.8);
    cursor.advance({ horizonTime: 0.5, authority }); cursor.cancel();
    const immediate = { active: lifetime.active, sources: lifetime.sources.size, routes: lifetime.routes.size };
    const data = (await context.startRendering()).getChannelData(0);
    return { immediate, sound: measure(data, 0.4, 0.7), after: measure(data, 0.801, 1).peak };
  });
  expect(result.immediate).toEqual({ active: true, sources: 1, routes: 1 });
  expect(result.sound.hz).toBeCloseTo(220, 2); expect(result.sound.peak).toBeCloseTo(0.1, 3); expect(result.after).toBe(0);
});

test('missed native onset is dropped, never shifted into an audible catch-up burst', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { cursor, context } = fixture([note('missed', 0), note('future', 720)]);
    const suspended = context.suspend(0.3), rendering = context.startRendering(); await suspended;
    const outcome = cursor.advance({ horizonTime: 0.6, authority });
    await context.resume(); const data = (await rendering).getChannelData(0);
    return { outcome, before: measure(data, 0, 0.474).peak, sound: measure(data, 0.49, 0.58).peak, after: measure(data, 0.601, 1).peak };
  });
  expect(result.outcome.noteIds).toEqual(['future']); expect(result.before).toBe(0);
  expect(result.sound).toBeGreaterThan(0.19); expect(result.after).toBe(0);
});

test('accessor and inherited melody selection fail closed without executing the accessor', async ({ page }) => {
  const result = await page.evaluate(() => {
    const { track, context, lifetime } = fixture([]);
    const instrument = scheduler.prepareMelodyInstrument({ sound: track.mainBeatSound });
    let reads = 0;
    const inherited = Object.assign(Object.create({ melody: track.melody }), { barSettings: track.barSettings, mainBeatSound: track.mainBeatSound });
    const accessor = { ...track }; Object.defineProperty(accessor, 'melody', { enumerable: true, get() { reads++; return track.melody; } });
    const errors = [inherited, accessor].map(track => {
      try { scheduler.createMelodyCursor({ track, instrument, context, destination: context.destination, lifetime, authority, originTick: 0, originTime: 0.1, endTick: 960 }); return false; }
      catch { return true; }
    });
    return { errors, reads };
  });
  expect(result).toEqual({ errors: [true, true], reads: 0 });
});

test('native start/stop times follow tick anchors, exclusive horizon, gate and clipped release without timers', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { context, lifetime, cursor } = fixture([note('gate', 120, 69, 120), note('tail', 480, 81, 240), note('seam', 960)]);
    const starts = [], stops = [], frequencies = [];
    const nativeCreate = context.createOscillator.bind(context);
    context.createOscillator = () => {
      const source = nativeCreate(), start = source.start.bind(source), stop = source.stop.bind(source), frequency = source.frequency.setValueAtTime.bind(source.frequency);
      source.start = time => { starts.push(time); return start(time); };
      source.stop = time => { stops.push(time); return stop(time); };
      source.frequency.setValueAtTime = (value, time) => { frequencies.push([value, time]); return frequency(value, time); };
      return source;
    };
    const timeout = window.setTimeout, interval = window.setInterval, raf = window.requestAnimationFrame;
    window.setTimeout = window.setInterval = window.requestAnimationFrame = () => { throw new Error('No musical timers'); };
    let atBoundary, afterBoundary;
    try {
      atBoundary = cursor.advance({ horizonTime: 0.1625, authority });
      afterBoundary = cursor.advance({ horizonTime: 0.7, authority });
    } finally { window.setTimeout = timeout; window.setInterval = interval; window.requestAnimationFrame = raf; }
    await context.startRendering();
    return { starts, stops, frequencies, atBoundary, afterBoundary, timers: lifetime.timers.size };
  });
  expect(result.atBoundary.noteIds).toEqual([]); expect(result.afterBoundary.noteIds).toEqual(['gate', 'tail']);
  expect(result.starts).toEqual([0.1625, 0.35]); expect(result.stops).toEqual([0.225, 0.475]);
  expect(result.frequencies).toEqual([[440, 0.1625], [880, 0.35]]); expect(result.timers).toBe(0);
});

test('mixed-meter bars flatten into stable chord order and an explicit nonzero tick anchor', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const context = new OfflineAudioContext(1, 48000, 48000), lifetime = new Lifetime();
    const sound = { sound: 'Synth Sine' };
    const track = { mainBeatSound: sound, barSettings: [{ beats: 1, subdivision: 8 }, { beats: 3, subdivision: 1 }], melody: { version: 1,
      bars: [[note('past', 0)], [note('z', 120, 81), note('b', 120, 69), note('a', 120, 69), note('future', 240)]] } };
    const cursor = scheduler.createMelodyCursor({ track, instrument: scheduler.prepareMelodyInstrument({ sound }), context,
      destination: context.destination, lifetime, authority, originTick: 960, originTime: 0.1, endTick: 1440 });
    const next = cursor.nextEventTime;
    const outcome = cursor.advance({ horizonTime: 0.35, authority });
    const data = (await context.startRendering()).getChannelData(0);
    return { next, outcome, before: measure(data, 0, 0.162).peak, after: measure(data, 0.351, 1).peak };
  });
  expect(result.next).toBe(0.1625); expect(result.outcome.noteIds).toEqual(['a', 'b', 'z', 'future']);
  expect(result.before).toBe(0); expect(result.after).toBe(0);
});

test('explicit sample root mismatch and missing root fail before any native source or route', async ({ page }) => {
  const result = await page.evaluate(() => {
    const context = new OfflineAudioContext(1, 48000, 48000), lifetime = new Lifetime(), buffer = context.createBuffer(1, 48000, 48000);
    const sound = { sound: 'Prepared sample' }, instrument = scheduler.prepareMelodyInstrument({ sound, buffer, rootMidi: 60 });
    const errors = [undefined, 61].map(root => {
      const melody = { version: 1, bars: [[note('one', 0)]] }; if (root !== undefined) melody.sampleRootMidi = root;
      try { scheduler.createMelodyCursor({ track: { mainBeatSound: sound, barSettings: [{ beats: 4 }], melody }, instrument,
        context, destination: context.destination, lifetime, authority, originTick: 0, originTime: 0.1, endTick: 960 }); return null; }
      catch (error) { return error.message; }
    });
    return { errors, sources: lifetime.sources.size, routes: lifetime.routes.size };
  });
  expect(result.errors.every(error => /root|Root/.test(error))).toBe(true); expect(result.sources).toBe(0); expect(result.routes).toBe(0);
});
