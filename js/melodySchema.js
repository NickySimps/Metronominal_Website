/**
 * Standalone track.melody contract; existing track.mainBeatSound/settings remains
 * the voice. No engine, state, persistence, history or network integration here.
 * {version:1, bars:[[{id,midi,startTick,durationTicks,velocity},...],...],
 *  sampleRootMidi?:integer}
 *
 * Bar-relative ticks: 960 per main beat, independent of subdivision. Chords are
 * allowed; crossing bars is not. Unique trackwide IDs: ASCII [A-Za-z0-9_-],
 * length 1..64. Canonical order: startTick, midi, then code-unit ID. Velocity:
 * finite 0..1. MIDI/root: integers 0..127. Negative zero is rejected for stable
 * JSON roundtrips. No coercion, truncation or rounding.
 *
 * APIs return detached canonical plain data or throw TypeError. Supply existing
 * validated barSettings (only own data-property beats, integer 1..32, is read).
 * Sample consumers MUST pass {requireSampleRoot:true}; roots are never inferred.
 * Byte ceiling covers UTF-8 JSON.stringify(canonical result). Callers parsing
 * untrusted JSON must also cap raw bytes before JSON.parse. Only plain/null-
 * prototype records and dense ordinary arrays: no schema accessors, hidden,
 * symbol or unknown keys. Executable Proxies are not a JSON boundary.
 */
export const TICKS_PER_MAIN_BEAT = 960;
export const MELODY_LIMITS = Object.freeze({
  maxBars: 64, maxBeatsPerBar: 32, maxNotesPerBar: 128,
  maxNotesPerTrack: 2048, maxIdLength: 64, maxSerializedBytes: 262144,
});
const NOTE_FIELDS = ['id', 'midi', 'startTick', 'durationTicks', 'velocity'];

function fail(path) { throw new TypeError(`Invalid melody: ${path}`); }
function integer(value, min, max, path) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < min || value > max) fail(path);
}
function plain(value, path) {
  if (!value || typeof value !== 'object') fail(path);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) fail(path);
}
function data(value, key, path) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail(path);
  return descriptor.value;
}
function record(value, allowed, required, path) {
  plain(value, path);
  for (const key of Reflect.ownKeys(value)) {
    if (!allowed.includes(key)) fail(`${path}.unknown key`);
    data(value, key, path);
  }
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`${path}.${key}`);
}
function denseArray(value, max, path) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max) fail(path);
  // Bound before enumeration: a huge sparse array must fail cheaply.
  if (Reflect.ownKeys(value).length !== value.length + 1) fail(`${path}.dense array required`);
  for (let i = 0; i < value.length; i++) data(value, String(i), path);
}
function meters(barSettings) {
  denseArray(barSettings, MELODY_LIMITS.maxBars, 'barSettings');
  if (!barSettings.length) fail('barSettings');
  return barSettings.map(bar => {
    plain(bar, 'barSettings.bar');
    const beats = data(bar, 'beats', 'barSettings.beats');
    integer(beats, 1, MELODY_LIMITS.maxBeatsPerBar, 'barSettings.beats');
    return beats * TICKS_PER_MAIN_BEAT;
  });
}

/** Validate and clone an explicitly present melody; undefined is invalid. */
export function validateMelody(value, barSettings, options = {}) {
  const ticks = meters(barSettings);
  record(options, ['requireSampleRoot'], [], 'options');
  if (Object.hasOwn(options, 'requireSampleRoot') && typeof options.requireSampleRoot !== 'boolean') fail('options.requireSampleRoot');
  record(value, ['version', 'bars', 'sampleRootMidi'], ['version', 'bars'], 'shape');
  if (value.version !== 1) fail('version');
  denseArray(value.bars, MELODY_LIMITS.maxBars, 'bars');
  if (value.bars.length !== ticks.length) fail('bars must match barSettings');
  if (Object.hasOwn(value, 'sampleRootMidi')) integer(value.sampleRootMidi, 0, 127, 'sampleRootMidi');
  else if (options.requireSampleRoot === true) fail('sampleRootMidi required for sample');
  let total = 0;
  for (const bar of value.bars) {
    denseArray(bar, MELODY_LIMITS.maxNotesPerBar, 'bar');
    total += bar.length;
    if (total > MELODY_LIMITS.maxNotesPerTrack) fail('track note limit');
  }
  const ids = new Set();
  const result = { version: 1, bars: value.bars.map((bar, index) => bar.map(n => {
    record(n, NOTE_FIELDS, NOTE_FIELDS, 'note');
    if (typeof n.id !== 'string' || n.id.length < 1 || n.id.length > MELODY_LIMITS.maxIdLength || !/^[A-Za-z0-9_-]+$/.test(n.id) || ids.has(n.id)) fail('note.id');
    ids.add(n.id);
    integer(n.midi, 0, 127, 'note.midi');
    integer(n.startTick, 0, ticks[index] - 1, 'note.startTick');
    integer(n.durationTicks, 1, ticks[index] - n.startTick, 'note.durationTicks');
    if (!Number.isFinite(n.velocity) || Object.is(n.velocity, -0) || n.velocity < 0 || n.velocity > 1) fail('note.velocity');
    return { id: n.id, midi: n.midi, startTick: n.startTick, durationTicks: n.durationTicks, velocity: n.velocity };
  }).sort((a, b) => a.startTick - b.startTick || a.midi - b.midi || (a.id < b.id ? -1 : 1))) };
  if (Object.hasOwn(value, 'sampleRootMidi')) result.sampleRootMidi = value.sampleRootMidi;
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MELODY_LIMITS.maxSerializedBytes) fail('serialized byte limit');
  return result;
}

/** Only legacy absence (undefined) becomes empty bars; malformed data fails. */
export function normalizeMelody(value, barSettings, options = {}) {
  const ticks = meters(barSettings);
  return validateMelody(value === undefined ? { version: 1, bars: ticks.map(() => []) } : value, barSettings, options);
}
