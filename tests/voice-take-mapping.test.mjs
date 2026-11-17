// Standalone pure mapping checks, runnable by Node and existing Playwright.
const { test } = await import(process.env.NODE_TEST_CONTEXT ? 'node:test' : '@playwright/test');
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const schemaSource = await readFile(new URL('../js/melodySchema.js', import.meta.url), 'utf8');
const schemaUrl = `data:text/javascript;base64,${Buffer.from(schemaSource).toString('base64')}`;
const source = await readFile(new URL('../js/voiceTakeMapping.js', import.meta.url), 'utf8');
const moduleSource = source.replace("'./melodySchema.js'", JSON.stringify(schemaUrl));
const { mapVoiceTake, fitVoiceTakeToBars } = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);
const { validateMelody } = await import(schemaUrl);
const meter = (...beats) => beats.map(beats => ({ beats, subdivision: 7 }));
const note = (startTime = 10.5, endTime = 11, midi = 60) => ({ midi, startTime, endTime, duration: endTime - startTime });
const options = (extra = {}) => ({ recordedBpm: 120, captureOrigin: 10, startBar: 0,
  barSettings: meter(4, 3), transportState: 'stopped', idFactory: ({ noteIndex, segmentIndex }) => `n${noteIndex}_${segmentIndex}`, ...extra });
const map = (notes = [note()], extra = {}) => mapVoiceTake(notes, options(extra));

test('automatic fit extends a detached final-meter grid without changing the captured tempo or source', () => {
  const original = [{ beats: 3, subdivision: 1, rests: [0] }, { beats: 4, subdivision: 2, rests: [] }];
  const before = structuredClone(original);
  const result = fitVoiceTakeToBars([note(1, 4.6)], options({ recordedBpm: 300, captureOrigin: 0, origin: 'first-note', barSettings: original }));
  assert.deepEqual(original, before);
  assert.equal(result.timing.recordedBpm, 300);
  assert.deepEqual(result.barSettings.slice(0, 2), before);
  assert.equal(result.barSettings.length, 5);
  assert.deepEqual(result.barSettings.slice(2), Array.from({ length: 3 }, () => ({ beats: 4, subdivision: 2, rests: [] })));
  assert.equal(result.melody.bars.flat().reduce((sum, item) => sum + item.durationTicks, 0), 18 * 960);
  assert.ok(result.warnings.some(w => w.code === 'BAR_SPLIT_RETRIGGERS'));
});

test('automatic fit keeps an exact final boundary without adding a bar', () => {
  const result = fitVoiceTakeToBars([note(0, .8)], options({ recordedBpm: 300, captureOrigin: 0, origin: 'first-note', barSettings: meter(4) }));
  assert.equal(result.barSettings.length, 1);
  assert.equal(result.melody.bars[0][0].durationTicks, 3840);
});

test('automatic fit refuses over-limit takes without clipping or mutating bars', () => {
  const original = meter(4), before = structuredClone(original);
  assert.throws(() => fitVoiceTakeToBars([note(0, 52)], options({ recordedBpm: 300, captureOrigin: 0, origin: 'first-note', barSettings: original })), e => e.code === 'TAKE_TOO_LONG');
  assert.deepEqual(original, before);
});

test('fractional BPM and long silence never accumulate beat-by-beat drift', () => {
  const recordedBpm = 123.45;
  const notes = Array.from({ length: 100 }, (_, i) => note(100 + i * 2.9, 100 + i * 2.9 + 0.1, i % 128));
  const barSettings = meter(...Array(64).fill(32));
  const result = map(notes, { captureOrigin: 100, recordedBpm, barSettings });
  const out = result.melody.bars.flat();
  assert.equal(out.length, notes.length);
  out.forEach((n, i) => {
    const absolute = result.melody.bars.findIndex(b => b.includes(n)) * 30720 + n.startTick;
    assert.equal(absolute, Math.round((notes[i].startTime - 100) * recordedBpm * 16));
  });
  assert.deepEqual(validateMelody(result.melody, barSettings), result.melody);
});

test('exact half-step rounds up, empty takes are fresh and default IDs deterministic', () => {
  const extra = { captureOrigin: 0, quantization: { mode: 'straight', divisions: 4 }, idFactory: undefined };
  const result = map([note(0.0625, 0.1875)], extra);
  assert.equal(result.melody.bars[0][0].startTick, 240);
  assert.equal(result.melody.bars[0][0].durationTicks, 240);
  assert.equal(result.melody.bars[0][0].id, 'take_0_0');
  assert.deepEqual(map([note(0.0625, 0.1875)], extra), result);
  const empty = map([]);
  empty.melody.bars[0].push({});
  assert.deepEqual(map([]).melody.bars, [[], []]);
});

if (!process.env.NODE_TEST_CONTEXT) {
  test('real browser ES modules preserve privacy and produce editable validated split notes', async ({ page }) => {
    const result = await page.evaluate(async ({ schemaSource, source }) => {
      const schemaUrl = URL.createObjectURL(new Blob([schemaSource], { type: 'text/javascript' }));
      const mappingUrl = URL.createObjectURL(new Blob([source.replace("'./melodySchema.js'", JSON.stringify(schemaUrl))], { type: 'text/javascript' }));
      try {
        const { mapVoiceTake } = await import(mappingUrl);
        const { validateMelody } = await import(schemaUrl);
        const data = [{ midi: 69, startTime: 42.25, endTime: 43, duration: 0.75 }];
        const before = JSON.stringify(data);
        const barSettings = [{ beats: 1 }, { beats: 3 }];
        const result = mapVoiceTake(data, { recordedBpm: 120, captureOrigin: 42, startBar: 0, barSettings, transportState: 'stopped' });
        result.melody.bars[1][0].midi = 72;
        return { result, validated: validateMelody(result.melody, barSettings), unchanged: before === JSON.stringify(data) };
      } finally { URL.revokeObjectURL(mappingUrl); URL.revokeObjectURL(schemaUrl); }
    }, { schemaSource, source });
    assert.equal(result.unchanged, true);
    assert.deepEqual(result.result.melody, result.validated);
    assert.deepEqual(result.result.melody.bars.map(b => b[0].durationTicks), [480, 960]);
    assert.equal(result.result.warnings[0].code, 'BAR_SPLIT_RETRIGGERS');
  });
}

test('schema failures carry a structured code and rounded endpoint overflow never silently truncates', () => {
  assert.throws(() => map([], { barSettings: meter(0) }), e => e instanceof TypeError && e.code === 'INVALID_MELODY');
  const extra = { barSettings: meter(1), quantization: { mode: 'straight', divisions: 3 } };
  assert.throws(() => map([note(10.499, 10.4999)], extra), /OUT_OF_RANGE/);
  const dropped = map([note(10.499, 10.4999)], { ...extra, boundaryPolicy: 'clip' });
  assert.equal(dropped.warnings[0].code, 'DROPPED_NOTE');
  assert.equal(dropped.melody.bars.flat().length, 0);
});

test('preserves initial silence and emits detached schema-valid bar-local notes', () => {
  const input = Object.freeze([Object.freeze(note())]);
  const result = map(input);
  assert.deepEqual(result.melody, { version: 1, bars: [[{ id: 'n0_0', midi: 60, startTick: 960, durationTicks: 960, velocity: 0.8 }], []] });
  assert.deepEqual(validateMelody(result.melody, meter(4, 3)), result.melody);
  assert.deepEqual(result.warnings, []);
  assert.equal(input[0].startTime, 10.5);
});

test('chosen start bar, first-note origin, latency and constant velocity are explicit', () => {
  const a = map([note()], { startBar: 1, origin: 'first-note', velocity: 0.25 });
  assert.deepEqual(a.melody.bars.map(b => b.length), [0, 1]);
  assert.equal(a.melody.bars[1][0].startTick, 0);
  assert.equal(a.melody.bars[1][0].velocity, 0.25);
  assert.equal(map([note()], { latencySeconds: 0.125 }).melody.bars[0][0].startTick, 720);
});

test('rounds absolute endpoints, not duration; minimum off-grid length is one tick', () => {
  const n = map([note(10 + 0.49 / 1920, 10 + 1.51 / 1920)]).melody.bars[0][0];
  assert.equal(n.startTick, 0);
  assert.equal(n.durationTicks, 2);
  assert.equal(map([note(10.1, 10.100001)]).melody.bars[0][0].durationTicks, 1);
});

test('straight and triplet quantization use exact integer steps with half-up endpoints', () => {
  for (const [mode, divisions, step] of [['straight', 4, 240], ['triplet', 1, 320], ['triplet', 2, 160]]) {
    const result = map([note(10 + step * 0.6 / 1920, 10 + step * 2.6 / 1920)], { quantization: { mode, divisions } });
    const n = result.melody.bars[0][0];
    assert.equal(n.startTick, step);
    assert.equal(n.durationTicks, step * 2);
    assert.equal(result.timing.stepTicks, step);
    assert.equal(map([note(10.001, 10.002)], { quantization: { mode, divisions } }).melody.bars[0][0].durationTicks, step);
  }
});

test('splits variable-meter crossings with unique IDs and explicit retrigger warning', () => {
  const result = map([note(10.25, 12)], { barSettings: meter(1, 2, 3) });
  assert.deepEqual(result.melody.bars.map(b => b.map(n => [n.id, n.startTick, n.durationTicks])),
    [[['n0_0', 480, 480]], [['n0_1', 0, 1920]], [['n0_2', 0, 960]]]);
  assert.ok(result.warnings.some(w => w.code === 'BAR_SPLIT_RETRIGGERS' && /not tied/i.test(w.message)));
  assert.equal(map([note(10, 10.5)], { barSettings: meter(1, 1) }).warnings.length, 0);
});

test('out-of-range defaults to atomic rejection; clipping is opt-in and reported', () => {
  assert.throws(() => map([note(10, 14)]), /OUT_OF_RANGE/);
  assert.throws(() => map([note(9.9, 10.1)]), /OUT_OF_RANGE/);
  const clipped = map([note(9.9, 10.1), note(13, 14)], { boundaryPolicy: 'clip' });
  assert.equal(clipped.melody.bars[0][0].startTick, 0);
  assert.equal(clipped.melody.bars[1][0].durationTicks, 960);
  assert.equal(clipped.warnings.filter(w => w.code === 'CLIPPED_NOTE').length, 2);
  const dropped = map([note(14, 15)], { boundaryPolicy: 'clip' });
  assert.equal(dropped.melody.bars.flat().length, 0);
  assert.equal(dropped.warnings[0].code, 'DROPPED_NOTE');
});

test('rejects invalid options even for empty takes and refuses playing/unknown transport', () => {
  for (const [key, values] of Object.entries({ recordedBpm: [0, -1, 1001, NaN, Infinity, '120', -0],
    captureOrigin: [-1, NaN, Infinity, '10', -0], startBar: [-1, 2, 0.5, '0', -0],
    transportState: ['playing', undefined, true], origin: ['first', null],
    velocity: [-1, 1.1, NaN, -0], latencySeconds: [NaN, Infinity, 11, -11, '0'],
    boundaryPolicy: ['truncate', null], idFactory: [null, 1] })) {
    for (const value of values) assert.throws(() => map([], { [key]: value }), TypeError, `${key}:${String(value)}`);
  }
  for (const quantization of [null, {}, { mode: 'swing' }, { mode: 'off', divisions: 4 },
    { mode: 'straight', divisions: 7 }, { mode: 'triplet', divisions: 7 },
    { mode: 'straight', divisions: 0 }, { mode: 'straight', divisions: 0.5 }, { mode: 'straight', divisions: '4' }]) {
    assert.throws(() => map([], { quantization }), TypeError);
  }
  for (const barSettings of [[], new Array(2), meter(0), meter(33), meter(1.5), meter(...Array(65).fill(4))]) assert.throws(() => map([], { barSettings }), TypeError);
  assert.throws(() => map([], { unexpected: true }), TypeError);
});

test('validates raw timestamps, duration consistency, source order and source count before clipping', () => {
  for (const key of ['midi', 'startTime', 'endTime', 'duration']) {
    for (const value of [NaN, Infinity, -Infinity, '60', null, -0]) {
      assert.throws(() => map([{ ...note(), [key]: value }], { boundaryPolicy: 'clip' }), TypeError);
    }
  }
  for (const n of [note(10, 10), note(11, 10), note(-1, 0), { ...note(), duration: 4 },
    { ...note(), midi: 128 }, { ...note(), midi: 60.5 }, { ...note(), confidence: 0.99 }]) assert.throws(() => map([n]), TypeError);
  assert.throws(() => map([note(11, 11.5), note(10, 10.5)]), /SOURCE_ORDER/);
  assert.throws(() => map([note(10, 11), note(10.5, 11.5)]), /SOURCE_ORDER/);
  assert.throws(() => map(Array.from({ length: 2049 }, () => note())), /INPUT_NOTE_LIMIT/);
  assert.throws(() => map([note(10, 311)], { boundaryPolicy: 'clip' }), /CAPTURE_SPAN/);
  assert.throws(() => map(new Array(100000000)), /INPUT_NOTE_LIMIT/);
});

test('no getter execution, inherited records, hidden fields, extra array keys or sparse arrays', () => {
  let reads = 0;
  const n = { ...note() };
  Object.defineProperty(n, 'midi', { enumerable: true, get() { reads++; return 60; } });
  const opt = options();
  Object.defineProperty(opt, 'recordedBpm', { enumerable: true, get() { reads++; return 120; } });
  assert.throws(() => map([n]), TypeError);
  assert.throws(() => mapVoiceTake([], opt), TypeError);
  assert.throws(() => map([Object.assign(Object.create({}), note())]), TypeError);
  assert.throws(() => map(new Array(1)), TypeError);
  assert.throws(() => map(Object.assign([], { extra: true })), TypeError);
  const hidden = { ...note() };
  Object.defineProperty(hidden, 'hidden', { value: 1 });
  assert.throws(() => map([hidden]), TypeError);
  assert.equal(reads, 0);
});

test('ID collisions and invalid factory values fail; timing collisions never trim', () => {
  assert.throws(() => map([note(10, 10.1), note(10.2, 10.3)], { idFactory: () => 'same' }), /ID_COLLISION/);
  for (const id of ['', 'bad id', 'x'.repeat(65), null, Promise.resolve('x')]) assert.throws(() => map([note()], { idFactory: () => id }), /INVALID_ID/);
  assert.throws(() => map([note(10.001, 10.002), note(10.003, 10.004, 62)], { quantization: { mode: 'straight', divisions: 4 } }), /TIMING_COLLISION/);
});

test('caps output after splitting, including per-bar, track and bytes, without factory work on timing failures', () => {
  let calls = 0;
  const idFactory = () => { calls++; return `n${calls}`; };
  const crowded = Array.from({ length: 129 }, (_, i) => note(10 + i / 1000, 10 + (i + 0.5) / 1000));
  assert.throws(() => map(crowded, { idFactory }), /OUTPUT_NOTE_LIMIT/);
  assert.equal(calls, 0);
  const full = Array.from({ length: 2048 }, (_, i) => note(10 + i / 128, 10 + (i + 0.5) / 128));
  assert.equal(map(full, { barSettings: meter(...Array(64).fill(1)), quantization: { mode: 'off' } }).melody.bars.flat().length, 2048);
  const crossing = Array.from({ length: 2048 }, (_, i) => note(10 + i / 100, 10 + (i + 0.9) / 100));
  assert.throws(() => map(crossing, { recordedBpm: 121, barSettings: meter(...Array(64).fill(1)) }), /OUTPUT_NOTE_LIMIT/);
  assert.throws(() => map(full, { barSettings: meter(...Array(64).fill(1)), idFactory: ({ noteIndex }) => `id${noteIndex}`.padEnd(64, 'x') }), e => e instanceof TypeError && e.code === 'INVALID_MELODY' && /serialized byte limit/.test(e.message));
});

test('serialized output accepts the exact byte ceiling and rejects the next byte with a structured code', () => {
  const full = Array.from({ length: 2048 }, (_, i) => note(10 + i / 128, 10 + (i + 0.5) / 128));
  const extra = { barSettings: meter(...Array(64).fill(1)), idFactory: ({ noteIndex }) => `n${noteIndex}` };
  const base = map(full, extra).melody;
  const lengths = base.bars.flat().map(n => n.id.length);
  let remaining = 262144 - Buffer.byteLength(JSON.stringify(base));
  assert.ok(remaining > 0);
  for (let i = 0; i < lengths.length && remaining; i++) {
    const add = Math.min(64 - lengths[i], remaining);
    lengths[i] += add; remaining -= add;
  }
  assert.equal(remaining, 0);
  const idFactory = ({ noteIndex }) => `n${noteIndex}`.padEnd(lengths[noteIndex], 'x');
  assert.equal(Buffer.byteLength(JSON.stringify(map(full, { ...extra, idFactory }).melody)), 262144);
  const available = lengths.findIndex(length => length < 64);
  assert.ok(available >= 0);
  lengths[available]++;
  assert.throws(() => map(full, { ...extra, idFactory }), e => e instanceof TypeError && e.code === 'INVALID_MELODY' && /serialized byte limit/.test(e.message));
});

test('output schema errors are structured without masking unexpected factory or validator errors', () => {
  for (const error of [new TypeError('unexpected factory failure'), new Error('unexpected factory failure')]) {
    assert.throws(() => map([note()], { idFactory: () => { throw error; } }), e => e === error);
    const barSettings = meter(4, 3);
    assert.throws(() => map([note()], { barSettings, idFactory: () => {
      barSettings[0] = new Proxy({ beats: 4 }, { getPrototypeOf() { throw error; } });
      return 'valid_id';
    } }), e => e === error);
  }
});
