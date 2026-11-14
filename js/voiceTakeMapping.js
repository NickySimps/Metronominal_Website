import { validateMelody, TICKS_PER_MAIN_BEAT, MELODY_LIMITS } from './melodySchema.js';

/** Pure fixed-tempo mapping of completed detached VoiceCaptureSession.notes.
 * No audio, state, storage, network or transport access. recordedBpm must be the
 * recording snapshot, NOT current tempo. Explicit stopped transport only; this
 * does NOT align recording to playing transport. startBar is zero-based; beats
 * are main beats (960 ticks), independent of subdivisions/per-bar tempo fields.
 *
 * mapVoiceTake(notes, {recordedBpm,captureOrigin,startBar,barSettings,
 *   transportState:'stopped',origin='capture',latencySeconds=0,velocity=0.8,
 *   quantization={mode:'off'},boundaryPolicy='reject',idFactory?})
 * -> {melody,warnings:[{code,noteIndex,message}],timing:{recordedBpm,
 *     captureOrigin,effectiveOrigin,origin,latencySeconds,stepTicks}}
 *
 * Straight step=960/divisions; triplet step=960/(3*divisions), exact integer >=1.
 * Off still rounds integer ticks. Absolute endpoints round independently nearest,
 * half toward +infinity; collapsed notes expand one step. Bar edges may cut grid
 * steps. Positive latency shifts earlier; first-note origin removes silence and
 * cancels constant latency by anchoring adjusted first note. Range checks BEFORE
 * rounding; opt-in clip reports every clipped/dropped note. No implicit trimming
 * of collisions. Monophonic, ordered, nonoverlapping source only.
 *
 * Split notes retrigger (not tied). Default IDs take_<index>_<segment> are NOT
 * unique across takes. Trusted synchronous idFactory({noteIndex,segmentIndex,
 * barIndex}) can namespace IDs for later merging. Returns NEW complete melody,
 * never merges/checks existing music. No sample-root or confidence inference.
 * Plain data only, accessors rejected. Proxies/factory effects are outside the
 * untrusted JSON boundary. TypeError has .code and optional .noteIndex.
 */
const fail = (code, message, noteIndex) => {
  const error = new TypeError(`${code}: ${message}`);
  error.code = code;
  if (noteIndex !== undefined) error.noteIndex = noteIndex;
  throw error;
};

function record(value, allowed, required, path) {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('INVALID_DATA', path);
  for (const key of Reflect.ownKeys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!allowed.includes(key) || !d.enumerable || !Object.hasOwn(d, 'value')) fail('INVALID_DATA', path);
  }
  for (const key of required) if (!Object.hasOwn(value, key)) fail('INVALID_DATA', `${path}.${key}`);
}
function array(value, limit, code) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > limit) fail(code, 'Array limit/type');
  if (Reflect.ownKeys(value).length !== value.length + 1) fail('INVALID_DATA', 'Dense array required');
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !d.enumerable || !Object.hasOwn(d, 'value')) fail('INVALID_DATA', 'Array data required');
  }
}
const finite = (value, min, max) => Number.isFinite(value) && !Object.is(value, -0) && value >= min && value <= max;

export function mapVoiceTake(notes, options) {
  record(options, ['recordedBpm', 'captureOrigin', 'startBar', 'barSettings', 'transportState',
    'origin', 'latencySeconds', 'velocity', 'quantization', 'boundaryPolicy', 'idFactory'],
  ['recordedBpm', 'captureOrigin', 'startBar', 'barSettings', 'transportState'], 'options');
  array(notes, MELODY_LIMITS.maxNotesPerTrack, 'INPUT_NOTE_LIMIT');
  const { recordedBpm, captureOrigin, startBar, barSettings,
    origin = 'capture', latencySeconds = 0, velocity = 0.8,
    quantization = { mode: 'off' }, boundaryPolicy = 'reject',
    idFactory = ({ noteIndex, segmentIndex }) => `take_${noteIndex}_${segmentIndex}` } = options;
  array(barSettings, MELODY_LIMITS.maxBars, 'INVALID_METER');
  const bars = barSettings.map(() => []);
  try { validateMelody({ version: 1, bars }, barSettings); }
  catch (error) {
    if (!(error instanceof TypeError)) throw error;
    fail('INVALID_MELODY', error.message);
  }
  if (!finite(recordedBpm, 1, 1000) || !finite(captureOrigin, 0, Number.MAX_SAFE_INTEGER) ||
      !Number.isSafeInteger(startBar) || !finite(startBar, 0, bars.length - 1) ||
      !finite(latencySeconds, -10, 10) || !finite(velocity, 0, 1) ||
      !['capture', 'first-note'].includes(origin) || !['reject', 'clip'].includes(boundaryPolicy) ||
      typeof idFactory !== 'function') fail('INVALID_OPTIONS', 'Invalid mapping options');
  if (options.transportState !== 'stopped') fail('UNSUPPORTED_TRANSPORT', 'Only stopped fixed-tempo mapping supported');
  record(quantization, ['mode', 'divisions'], ['mode'], 'quantization');
  if (!['off', 'straight', 'triplet'].includes(quantization.mode)) fail('INVALID_GRID', 'Unknown quantization');
  if (quantization.mode === 'off' ? Object.hasOwn(quantization, 'divisions') :
    !Number.isSafeInteger(quantization.divisions) || !finite(quantization.divisions, 1, 960)) fail('INVALID_GRID', 'Invalid divisions');
  let sourceEnd = -Infinity;
  for (let noteIndex = 0; noteIndex < notes.length; noteIndex++) {
    const note = notes[noteIndex];
    record(note, ['midi', 'startTime', 'endTime', 'duration'], ['midi', 'startTime', 'endTime', 'duration'], 'note');
    if (!Number.isInteger(note.midi) || !finite(note.midi, 0, 127) ||
        !finite(note.startTime, 0, Number.MAX_SAFE_INTEGER) || !finite(note.endTime, 0, Number.MAX_SAFE_INTEGER) ||
        !finite(note.duration, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER) || note.endTime <= note.startTime ||
        Math.abs(note.duration - (note.endTime - note.startTime)) > 1e-9) fail('INVALID_NOTE', 'Invalid note timestamps/duration/MIDI', noteIndex);
    if (note.startTime < sourceEnd) fail('SOURCE_ORDER', 'Source must be ordered and nonoverlapping', noteIndex);
    if (note.endTime - notes[0].startTime > 300 || note.endTime - captureOrigin > 300) fail('CAPTURE_SPAN', 'Capture exceeds 300 seconds', noteIndex);
    sourceEnd = note.endTime;
  }
  const lengths = barSettings.map(b => b.beats * TICKS_PER_MAIN_BEAT);
  const offsets = [0];
  for (let i = startBar; i < lengths.length; i++) offsets.push(offsets.at(-1) + lengths[i]);
  const available = offsets.at(-1);
  const stepTicks = quantization.mode === 'off' ? 1 : TICKS_PER_MAIN_BEAT /
    (quantization.divisions * (quantization.mode === 'triplet' ? 3 : 1));
  if (!Number.isSafeInteger(stepTicks) || stepTicks < 1) fail('INVALID_GRID', 'Grid step must be an exact integer tick');
  const effectiveOrigin = origin === 'first-note' && notes.length ? notes[0].startTime - latencySeconds : captureOrigin;
  const scale = recordedBpm * TICKS_PER_MAIN_BEAT / 60;
  const round = ticks => Math.round(ticks / stepTicks) * stepTicks || 0;
  const warnings = [];
  const segments = [];
  let previousEnd = 0;
  notes.forEach((note, noteIndex) => {
    let start = (note.startTime - latencySeconds - effectiveOrigin) * scale;
    let end = (note.endTime - latencySeconds - effectiveOrigin) * scale;
    if (start < 0 || end > available || start >= available || end <= 0) {
      if (boundaryPolicy !== 'clip') fail('OUT_OF_RANGE', 'Note exceeds selected bars', noteIndex);
      if (end <= 0 || start >= available) {
        warnings.push({ code: 'DROPPED_NOTE', noteIndex, message: 'Note entirely outside selected bars; explicitly dropped.' });
        return;
      }
      warnings.push({ code: 'CLIPPED_NOTE', noteIndex, message: 'Note clipped to selected bar range.' });
      start = Math.max(0, start);
      end = Math.min(available, end);
    }
    start = round(start);
    end = Math.max(start + stepTicks, round(end));
    if (start >= available || end > available) {
      if (boundaryPolicy !== 'clip') fail('OUT_OF_RANGE', 'Rounded note exceeds selected bars', noteIndex);
      if (start >= available) {
        warnings.push({ code: 'DROPPED_NOTE', noteIndex, message: 'Rounded onset outside selected bars; explicitly dropped.' });
        return;
      }
      end = available;
      warnings.push({ code: 'CLIPPED_NOTE', noteIndex, message: 'Rounded end clipped to selected bar range.' });
    }
    if (start < previousEnd) fail('TIMING_COLLISION', 'Mapped notes overlap; no automatic trimming', noteIndex);
    previousEnd = end;
    let segmentIndex = 0;
    for (let i = 0; i < offsets.length - 1; i++) {
      const lo = Math.max(start, offsets[i]);
      const hi = Math.min(end, offsets[i + 1]);
      if (hi <= lo) continue;
      segments.push({ noteIndex, segmentIndex: segmentIndex++, barIndex: startBar + i,
        midi: note.midi, startTick: lo - offsets[i], durationTicks: hi - lo, velocity });
    }
    if (segmentIndex > 1) warnings.push({ code: 'BAR_SPLIT_RETRIGGERS', noteIndex,
      message: 'Bar-crossing segments retrigger; they are not tied.' });
  });
  const counts = bars.map(() => 0);
  const ids = new Set();
  for (const { barIndex } of segments) counts[barIndex]++;
  if (segments.length > MELODY_LIMITS.maxNotesPerTrack || counts.some(n => n > MELODY_LIMITS.maxNotesPerBar)) fail('OUTPUT_NOTE_LIMIT', 'Split output exceeds melody note caps');
  for (const segment of segments) {
    const { noteIndex, segmentIndex, barIndex, ...note } = segment;
    const id = idFactory({ noteIndex, segmentIndex, barIndex });
    if (typeof id !== 'string' || id.length < 1 || id.length > MELODY_LIMITS.maxIdLength || !/^[A-Za-z0-9_-]+$/.test(id)) fail('INVALID_ID', 'Invalid segment ID', noteIndex);
    if (ids.has(id)) fail('ID_COLLISION', 'Duplicate segment ID', noteIndex);
    ids.add(id);
    bars[barIndex].push({ id, ...note });
  }
  let melody;
  try { melody = validateMelody({ version: 1, bars }, barSettings); }
  catch (error) {
    // Only translate the schema's documented validation failures. In particular,
    // trusted factory/proxy effects and unexpected validator failures stay intact.
    if (!(error instanceof TypeError) || !error.message.startsWith('Invalid melody: ')) throw error;
    fail('INVALID_MELODY', error.message);
  }
  return { melody, warnings,
    timing: { recordedBpm, captureOrigin, effectiveOrigin, origin, latencySeconds, stepTicks } };
}
