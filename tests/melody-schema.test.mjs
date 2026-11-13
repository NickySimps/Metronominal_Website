// Pure contract checks run in both Node and the existing Playwright runner.
const { test } = await import(process.env.NODE_TEST_CONTEXT ? 'node:test' : '@playwright/test');
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../js/melodySchema.js', import.meta.url), 'utf8');
const schema = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const meter = (...beats) => beats.map(beats => ({ beats, subdivision: 4 }));
const note = (id = 'n', overrides = {}) => ({ id, midi: 60, startTick: 0, durationTicks: 960, velocity: 1, ...overrides });
const melody = (...bars) => ({ version: 1, bars });
const many = count => Array.from({ length: count }, (_, i) => note(`n${i}`, { durationTicks: 1 }));

// This exercises only the standalone data contract, not the live playback UI.
if (!process.env.NODE_TEST_CONTEXT) {
  test('browser ES module keeps notes independent of existing track sound selection', async ({ page }) => {
    const result = await page.evaluate(async source => {
      const api = await import(`data:text/javascript;base64,${btoa(source)}`);
      const track = {
        barSettings: [{ beats: 3, subdivision: 8 }],
        mainBeatSound: { sound: 'Synth Kick', settings: { frequency: 110 } },
        melody: { version: 1, bars: [[{ id: 'one', midi: 72, startTick: 240, durationTicks: 1200, velocity: 0.75 }]] },
      };
      const before = api.validateMelody(track.melody, track.barSettings);
      track.mainBeatSound = { sound: 'Synth HiHat', settings: { frequency: 880 } };
      const after = api.validateMelody(track.melody, track.barSettings);
      const restored = api.normalizeMelody(JSON.parse(JSON.stringify(after)), track.barSettings);
      let refusedSample = false;
      try { api.validateMelody(after, track.barSettings, { requireSampleRoot: true }); }
      catch (e) { refusedSample = e instanceof TypeError; }
      return { before, after, restored, refusedSample, sound: track.mainBeatSound.sound };
    }, source);
    assert.deepEqual(result.before, result.after);
    assert.deepEqual(result.after, result.restored);
    assert.equal(result.before.bars[0][0].midi, 72);
    assert.equal(result.before.bars[0][0].durationTicks, 1200);
    assert.equal(result.sound, 'Synth HiHat');
    assert.equal(result.refusedSample, true);
  });
}

test('canonical sorting is input-order independent and accepts deeply frozen data', () => {
  const notes = [note('z', { startTick: 960 }), note('b', { midi: 64 }), note('a'), note('A')];
  const input = Object.freeze({ version: 1, bars: Object.freeze([Object.freeze(notes.map(Object.freeze))]) });
  const output = schema.validateMelody(input, meter(4));
  assert.deepEqual(output.bars[0].map(n => n.id), ['A', 'a', 'b', 'z']);
  assert.deepEqual(schema.validateMelody(melody([...notes].reverse()), meter(4)), output);
});

test('resource ceilings reject overflow rather than silently truncating', () => {
  assert.deepEqual(schema.MELODY_LIMITS, { maxBars: 64, maxBeatsPerBar: 32, maxNotesPerBar: 128, maxNotesPerTrack: 2048, maxIdLength: 64, maxSerializedBytes: 262144 });
  assert.ok(Object.isFrozen(schema.MELODY_LIMITS));
  assert.equal(schema.validateMelody(melody(many(128)), meter(4)).bars[0].length, 128);
  assert.throws(() => schema.validateMelody(melody(many(129)), meter(4)), TypeError);
  const full = many(2048);
  const bars = Array.from({ length: 16 }, (_, i) => full.slice(i * 128, (i + 1) * 128));
  assert.equal(schema.validateMelody(melody(...bars), meter(...Array(16).fill(4))).bars.flat().length, 2048);
  assert.throws(() => schema.validateMelody(melody(...bars, [note('extra')]), meter(...Array(17).fill(4))), TypeError);
  assert.equal(schema.normalizeMelody(undefined, meter(...Array(64).fill(1))).bars.length, 64);
  assert.throws(() => schema.normalizeMelody(undefined, meter(...Array(65).fill(1))), TypeError);
  assert.throws(() => schema.validateMelody(melody(new Array(100000000)), meter(4)), TypeError);
});

test('canonical serialized UTF-8 byte ceiling accepts exactly the limit and rejects one byte over', () => {
  const notes = many(2048);
  const value = melody(...Array.from({ length: 16 }, (_, i) => notes.slice(i * 128, (i + 1) * 128)));
  let remaining = 262144 - Buffer.byteLength(JSON.stringify(value));
  for (const n of notes) {
    const add = Math.min(64 - n.id.length, remaining);
    n.id += 'x'.repeat(add);
    remaining -= add;
  }
  assert.equal(remaining, 0);
  assert.equal(Buffer.byteLength(JSON.stringify(value)), 262144);
  const settings = meter(...Array(16).fill(4));
  assert.equal(Buffer.byteLength(JSON.stringify(schema.validateMelody(value, settings))), 262144);
  notes.find(n => n.id.length < 64).id += 'x';
  assert.throws(() => schema.validateMelody(value, settings), TypeError);
});

test('plain data only: no prototype contamination, hidden keys, sparse arrays or accessor execution', () => {
  let reads = 0;
  const getter = { ...note() };
  Object.defineProperty(getter, 'midi', { enumerable: true, get() { reads++; return 60; } });
  const hidden = { ...note() };
  Object.defineProperty(hidden, 'stale', { value: 1 });
  const symbol = { ...note(), [Symbol('stale')]: true };
  const inherited = Object.assign(Object.create({ polluted: true }), note());
  for (const n of [getter, hidden, symbol, inherited, JSON.parse('{"id":"n","midi":60,"startTick":0,"durationTicks":1,"velocity":1,"__proto__":{"polluted":true}}')]) {
    assert.throws(() => schema.validateMelody(melody([n]), meter(4)), TypeError);
  }
  assert.equal(reads, 0);
  for (const value of [melody(new Array(1)), { version: 1, bars: new Array(1) }, Object.assign(melody([]), { constructor: {} })]) assert.throws(() => schema.validateMelody(value, meter(4)), TypeError);
  for (const key of ['stale', Symbol('stale')]) {
    const bar = [];
    Object.defineProperty(bar, key, { value: true });
    assert.throws(() => schema.validateMelody(melody(bar), meter(4)), TypeError);
  }
  assert.throws(() => schema.normalizeMelody(undefined, new Array(1)), TypeError);
  const bar = {};
  Object.defineProperty(bar, 'beats', { get() { reads++; return 4; } });
  assert.throws(() => schema.normalizeMelody(undefined, [bar]), TypeError);
  assert.equal(reads, 0);
  const nullRecord = Object.assign(Object.create(null), note('__proto__'));
  assert.deepEqual(schema.validateMelody(melody([nullRecord]), meter(4)), melody([note('__proto__')]));
  assert.equal({}.polluted, undefined);
});

test('sample consumer options cannot silently disable validation through malformed values', () => {
  for (const options of [null, [], { requireSampleRoot: 'true' }, { stale: true }, Object.create({ requireSampleRoot: true })]) assert.throws(() => schema.validateMelody(melody([]), meter(4), options), TypeError);
});

test('legacy absence becomes fresh empty bars without guessing a sample root', () => {
  const a = schema.normalizeMelody(undefined, meter(4, 3));
  const b = schema.normalizeMelody(undefined, meter(4, 3));
  assert.deepEqual(a, melody([], []));
  a.bars[0].push(note());
  assert.deepEqual(b, melody([], []));
  assert.equal(Object.hasOwn(b, 'sampleRootMidi'), false);
});

test('valid notes are detached, canonically sorted and survive history JSON roundtrips', () => {
  const input = melody([note('z', { midi: 127, startTick: 959, durationTicks: 1, velocity: 0 }),
    note('b', { midi: 0, durationTicks: 1 }), note('a', { midi: 0, durationTicks: 960 })], []);
  input.sampleRootMidi = 0;
  const output = schema.validateMelody(input, meter(1, 32));
  assert.deepEqual(output.bars[0].map(n => n.id), ['a', 'b', 'z']);
  assert.deepEqual(schema.normalizeMelody(JSON.parse(JSON.stringify(output)), meter(1, 32)), output);
  assert.deepEqual(input.bars[0].map(n => n.id), ['z', 'b', 'a']);
  output.bars[0][0].midi = 15;
  assert.equal(input.bars[0][2].midi, 0);
  input.bars[0][0].velocity = 0.5;
  assert.equal(output.bars[0][2].velocity, 0);
  assert.notEqual(input.bars[1], output.bars[1]);
  assert.equal(schema.TICKS_PER_MAIN_BEAT, 960);
});

test('malformed notes, stale nested fields, versions and duplicate IDs fail closed', () => {
  for (const field of ['midi', 'startTick', 'durationTicks', 'velocity']) {
    for (const bad of [NaN, Infinity, -Infinity, -0, '1', null, undefined, {}, -1]) {
      assert.throws(() => schema.validateMelody(melody([note('n', { [field]: bad })]), meter(4)), TypeError, `${field} ${bad}`);
    }
  }
  for (const [field, values] of Object.entries({ midi: [0.5, 128], startTick: [0.5, 3840], durationTicks: [0, 0.5, 3841], velocity: [1.001] })) {
    for (const value of values) assert.throws(() => schema.validateMelody(melody([note('n', { [field]: value })]), meter(4)), TypeError);
  }
  for (const id of ['', 'a b', 'n\n', 'x'.repeat(65), 1, null]) assert.throws(() => schema.validateMelody(melody([note(id)]), meter(4)), TypeError);
  for (const value of [null, undefined, [], {}, { version: 2, bars: [[]] }, { version: 1, bars: [[]], instruments: [] },
    melody([note('x'), note('x')]), melody([note('x')], [note('x')]), melody([ { ...note(), sound: 'Synth Kick' } ]),
    melody([ { ...note(), settings: {} } ]), melody([ {} ])]) {
    assert.throws(() => schema.validateMelody(value, meter(4)), TypeError);
  }
  assert.throws(() => schema.normalizeMelody(null, meter(4)), TypeError);
  assert.throws(() => schema.validateMelody(melody([note('x')], [note('x')]), meter(4, 4)), TypeError);
});

test('meter is explicit, independent of subdivisions, and crossing a bar is never repaired', () => {
  assert.deepEqual(schema.validateMelody(melody([note('a', { durationTicks: 2880 })], [note('b', { startTick: 959, durationTicks: 1 })]), meter(3, 1)).bars.map(b => b.length), [1, 1]);
  assert.throws(() => schema.validateMelody(melody([note('a', { startTick: 2879, durationTicks: 2 })]), meter(3)), TypeError);
  for (const bars of [undefined, null, [], meter(0), meter(33), meter(1.5), meter('4'), meter(NaN), meter(Infinity), [{}]]) {
    assert.throws(() => schema.normalizeMelody(undefined, bars), TypeError);
  }
  assert.throws(() => schema.validateMelody(melody([]), meter(4, 4)), TypeError);
  assert.throws(() => schema.validateMelody(melody([], []), meter(4)), TypeError);
});

test('explicit sample roots remain optional except when a sample consumer requires one', () => {
  const value = melody([note()]);
  assert.equal(Object.hasOwn(schema.validateMelody(value, meter(4)), 'sampleRootMidi'), false);
  assert.throws(() => schema.validateMelody(value, meter(4), { requireSampleRoot: true }), TypeError);
  assert.throws(() => schema.normalizeMelody(undefined, meter(4), { requireSampleRoot: true }), TypeError);
  for (const sampleRootMidi of [0, 127]) assert.equal(schema.validateMelody({ ...value, sampleRootMidi }, meter(4), { requireSampleRoot: true }).sampleRootMidi, sampleRootMidi);
  for (const sampleRootMidi of [-1, 128, 60.5, '60', null, undefined, NaN, Infinity]) assert.throws(() => schema.validateMelody({ ...value, sampleRootMidi }, meter(4)), TypeError);
});
