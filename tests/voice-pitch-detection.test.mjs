// Works in the repository's Playwright runner and standalone offline Node.
const { test } = await import(process.env.NODE_TEST_CONTEXT ? 'node:test' : '@playwright/test');
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function moduleAt(name) {
  const source = await readFile(new URL(`../js/${name}.js`, import.meta.url), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
function tone(hz, sampleRate = 48000, length = 4096, harmonics = [1]) {
  return Float32Array.from({ length }, (_, i) => harmonics.reduce((s, a, h) => s + a * Math.sin(2 * Math.PI * hz * (h + 1) * i / sampleRate), 0) * 0.3);
}
const cents = (a, b) => 1200 * Math.log2(a / b);

// Generated fixtures are DSP checks, NOT real microphone accuracy evidence.
test('harmonic-rich and missing-fundamental fixtures resolve period, not strongest harmonic', async () => {
  const { VoicePitchDetector } = await moduleAt('voicePitchDetector');
  for (const sr of [44100, 48000]) {
    const detector = new VoicePitchDetector();
    for (const hz of [110, 196, 330]) {
      for (const harmonics of [[0.2, 1, 0.6, 0.3], [0, 0.9, 0.6, 0.3]]) {
        const result = detector.detect(tone(hz, sr, 4096, harmonics), sr);
        assert.ok(result.voiced, JSON.stringify(result));
        assert.ok(Math.abs(cents(result.frequencyHz, hz)) < 20, JSON.stringify(result));
      }
    }
    // Even harmonics alone contain no evidence of the hypothesized lower pitch.
    const ambiguous = detector.detect(tone(110, sr, 4096, [0, 1]), sr);
    assert.ok(Math.abs(cents(ambiguous.frequencyHz, 220)) < 15);
  }
});

test('silence, DC, low level and deterministic broadband noise are unvoiced', async () => {
  const { VoicePitchDetector } = await moduleAt('voicePitchDetector');
  const detector = new VoicePitchDetector();
  let seed = 123456;
  const noise = Float32Array.from({ length: 4096 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 4294967296 - 0.5) * 0.5;
  });
  for (const pcm of [new Float32Array(4096), new Float32Array(4096).fill(0.4), tone(220).map(x => x * 0.001), noise]) {
    const result = detector.detect(pcm, 48000);
    assert.equal(result.voiced, false);
    assert.equal(result.frequencyHz, null);
    assert.ok(Number.isFinite(result.rms) && result.rms >= 0);
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
  }
});

test('malformed and excessive PCM is rejected without retaining or modifying input', async () => {
  const { VoicePitchDetector } = await moduleAt('voicePitchDetector');
  const detector = new VoicePitchDetector();
  for (const pcm of [null, [], new Float64Array(4096), new Float32Array(255), new Float32Array(8193),
    new Float32Array(4096).fill(NaN), new Float32Array(4096).fill(Infinity), new Float32Array(4096).fill(1.1)]) {
    assert.deepEqual(detector.detect(pcm, 48000), { voiced: false, frequencyHz: null, confidence: 0, rms: 0 });
  }
  for (const sr of [0, -1, 7999, 192001, NaN, Infinity, '48000']) assert.equal(detector.detect(tone(220), sr).voiced, false);
  const pcm = tone(220, 48000, 8192);
  const before = pcm.slice();
  assert.equal(detector.detect(pcm, 48000).voiced, true);
  assert.deepEqual(pcm, before);
  assert.deepEqual(Object.keys(detector), []);
});

test('generated PCM vibrato and glides yield monotonic non-overlapping completed notes', async () => {
  const { VoicePitchDetector } = await moduleAt('voicePitchDetector');
  const { VoiceNoteTracker } = await moduleAt('voiceNoteTracker');
  for (const sr of [44100, 48000]) {
    const detector = new VoicePitchDetector();
    const tracker = new VoiceNoteTracker();
    const notes = [];
    for (let frame = 0; frame < 120; frame++) {
      const start = frame * 0.01;
      let phase = 0;
      const pcm = Float32Array.from({ length: 4096 }, (_, i) => {
        const time = start + i / sr;
        const midi = frame < 60 ? 69 + 0.3 * Math.sin(2 * Math.PI * 5 * time) : 69 + Math.min(5, (time - 0.6) * 10);
        phase += 2 * Math.PI * hzFor(midi) / sr;
        return 0.3 * Math.sin(phase);
      });
      notes.push(...tracker.push({ time: start, ...detector.detect(pcm, sr) }));
    }
    notes.push(...tracker.stop(1.2));
    assert.equal(notes[0].midi, 69);
    assert.equal(notes[0].startTime, 0);
    assert.ok(notes[0].endTime >= 0.6);
    assert.ok(notes.length >= 3 && notes.length <= 7);
    assert.ok(notes.at(-1).midi >= 73);
    for (let i = 0; i < notes.length; i++) {
      assert.ok(notes[i].duration >= 0.03 - 1e-9);
      assert.ok(notes[i].midi >= 0 && notes[i].midi <= 127);
      if (i) {
        assert.ok(notes[i].startTime >= notes[i - 1].endTime);
        assert.ok(notes[i].midi > notes[i - 1].midi);
      }
    }
  }
});

test('short blips are discarded, supported short notes survive and brief dropouts bridge', async () => {
  const { VoiceNoteTracker } = await moduleAt('voiceNoteTracker');
  const blip = new VoiceNoteTracker();
  blip.push(obs(0)); blip.push(obs(0.01)); blip.push(obs(0.02, null));
  assert.deepEqual(blip.stop(0.1), []);
  const short = new VoiceNoteTracker();
  short.push(obs(0)); short.push(obs(0.03)); short.push(obs(0.06, null));
  assert.deepEqual(short.stop(0.07).map(n => [n.startTime, n.endTime]), [[0, 0.06]]);
  const bridge = new VoiceNoteTracker();
  const notes = [];
  for (const item of [obs(0), obs(0.04), obs(0.05, null), obs(0.08), obs(0.12)]) notes.push(...bridge.push(item));
  notes.push(...bridge.stop(0.14));
  assert.deepEqual(notes.map(n => [n.startTime, n.endTime]), [[0, 0.14]]);
});

test('invalid times are ignored and invalid voiced observations count as silence', async () => {
  const { VoiceNoteTracker } = await moduleAt('voiceNoteTracker');
  const tracker = new VoiceNoteTracker();
  tracker.push(obs(1)); tracker.push(obs(1.04));
  for (const item of [null, {}, obs(NaN), obs(Infinity), obs(-1), obs(1.04, 72), obs(1, 72)]) assert.deepEqual(tracker.push(item), []);
  for (const time of [NaN, Infinity, -1, 1]) assert.deepEqual(tracker.stop(time), []);
  assert.equal(tracker.stopped, false);
  tracker.push({ ...obs(1.05), frequencyHz: Infinity });
  const notes = tracker.push({ ...obs(1.12), confidence: NaN });
  assert.equal(notes[0].endTime, 1.05);
  for (const patch of [{ frequencyHz: -1 }, { confidence: 2 }, { rms: NaN }, { rms: 2 }, { voiced: 'true' }]) {
    const invalid = new VoiceNoteTracker();
    invalid.push({ ...obs(0), ...patch }); invalid.push({ ...obs(0.1), ...patch });
    assert.deepEqual(invalid.stop(0.2), []);
  }
});
const hzFor = midi => 440 * 2 ** ((midi - 69) / 12);
const obs = (time, midi = 69, confidence = 0.99) => ({ time, voiced: midi !== null, frequencyHz: midi === null ? null : hzFor(midi), confidence, rms: midi === null ? 0 : 0.2 });

test('stable notes use original onset and first silence offset, stop is idempotent', async () => {
  const { VoiceNoteTracker, frequencyToMidi } = await moduleAt('voiceNoteTracker');
  assert.equal(frequencyToMidi(440), 69);
  assert.equal(frequencyToMidi(hzFor(0)), 0);
  assert.equal(frequencyToMidi(hzFor(127)), 127);
  for (const hz of [0, -1, NaN, Infinity, hzFor(-1), hzFor(128)]) assert.equal(frequencyToMidi(hz), null);
  const tracker = new VoiceNoteTracker();
  assert.deepEqual(tracker.push(obs(5)), []);
  assert.deepEqual(tracker.push(obs(5.04)), []);
  assert.deepEqual(tracker.push(obs(5.1)), []);
  assert.deepEqual(tracker.push(obs(5.2, null)), []);
  const notes = tracker.push(obs(5.3, null));
  assert.equal(notes.length, 1);
  assert.equal(notes[0].midi, 69);
  assert.equal(notes[0].startTime, 5);
  assert.equal(notes[0].endTime, 5.2);
  assert.equal(notes[0].duration, notes[0].endTime - notes[0].startTime);
  assert.deepEqual(tracker.stop(5.4), []);
  assert.deepEqual(tracker.stop(5.5), []);
  assert.deepEqual(tracker.push(obs(5.6)), []);
});

test('vibrato and brief outliers remain one note; stable transitions backdate boundaries', async () => {
  const { VoiceNoteTracker } = await moduleAt('voiceNoteTracker');
  const tracker = new VoiceNoteTracker();
  const notes = [];
  for (let i = 0; i < 30; i++) notes.push(...tracker.push(obs(i * 0.01, 69 + 0.55 * Math.sin(i * 0.6))));
  notes.push(...tracker.push(obs(0.30, 81)));
  notes.push(...tracker.push(obs(0.31, 69)));
  for (let i = 32; i <= 45; i++) notes.push(...tracker.push(obs(i * 0.01, 72)));
  notes.push(...tracker.stop(0.46));
  assert.deepEqual(notes.map(n => [n.midi, n.startTime, n.endTime]), [[69, 0, 0.32], [72, 0.32, 0.46]]);
});

test('silence before resumption and missing observations cannot bridge notes', async () => {
  const { VoiceNoteTracker } = await moduleAt('voiceNoteTracker');
  const tracker = new VoiceNoteTracker();
  const notes = [];
  for (const item of [obs(0), obs(0.04), obs(0.1), obs(0.11, null), obs(0.2), obs(0.24), obs(1), obs(1.04)]) notes.push(...tracker.push(item));
  notes.push(...tracker.stop(1.08));
  assert.deepEqual(notes.map(n => [n.midi, n.startTime, n.endTime]), [[69, 0, 0.11], [69, 0.2, 0.24], [69, 1, 1.08]]);
});

test('duration, note and observation caps close capture with bounded state', async () => {
  const { VoiceNoteTracker } = await moduleAt('voiceNoteTracker');
  const duration = new VoiceNoteTracker({ maxDurationSeconds: 0.2 });
  duration.push(obs(10)); duration.push(obs(10.04));
  const ended = duration.push(obs(10.2));
  assert.equal(ended[0].endTime, 10.2);
  assert.equal(duration.stopped, true);
  assert.deepEqual(duration.push(obs(12)), []);
  const count = new VoiceNoteTracker({ maxNotes: 1 });
  count.push(obs(0)); count.push(obs(0.04)); count.push(obs(0.1, 72));
  assert.equal(count.push(obs(0.16, 72)).length, 1);
  assert.equal(count.stopped, true);
  assert.deepEqual(count.stop(0.2), []);
  const observations = new VoiceNoteTracker({ maxObservations: 3 });
  observations.push(obs(0)); observations.push(obs(0.04));
  assert.equal(observations.push(obs(0.08)).length, 1);
  assert.equal(observations.stopped, true);
  assert.equal(observations.active, null);
  assert.equal(observations.pending, null);
  assert.ok(Object.values(observations).every(value => !Array.isArray(value) && !ArrayBuffer.isView(value)));
  for (const options of [{ maxNotes: 0 }, { maxNotes: Infinity }, { maxDurationSeconds: NaN }, { maxObservations: 1.5 }]) assert.throws(() => new VoiceNoteTracker(options), RangeError);
});

test('stop respects capture deadline and stale-data boundary without needing another push', async () => {
  const { VoiceNoteTracker } = await moduleAt('voiceNoteTracker');
  const tracker = new VoiceNoteTracker({ maxDurationSeconds: 0.2 });
  tracker.push(obs(0)); tracker.push(obs(0.04)); tracker.push(obs(0.16));
  assert.equal(tracker.stop(0.3)[0].endTime, 0.2);
  const stale = new VoiceNoteTracker();
  stale.push(obs(0)); stale.push(obs(0.04));
  assert.equal(stale.stop(10)[0].endTime, 0.04);
});

test('default observation cap bounds long captures and MIDI endpoints stay valid', async () => {
  const { VoiceNoteTracker } = await moduleAt('voiceNoteTracker');
  const tracker = new VoiceNoteTracker();
  const outputs = [];
  for (let i = 0; i < 61000; i++) outputs.push(...tracker.push(obs(i / 1000)));
  assert.equal(outputs.length, 1);
  assert.equal(tracker.observationCount, 60000);
  assert.equal(tracker.noteCount, 1);
  assert.equal(tracker.active, null);
  assert.equal(tracker.pending, null);
  assert.equal(tracker.stopped, true);
  for (const midi of [0, 127]) {
    const edge = new VoiceNoteTracker();
    edge.push(obs(0, midi)); edge.push(obs(0.04, midi));
    assert.equal(edge.stop(0.04)[0].midi, midi);
  }
  const empty = new VoiceNoteTracker();
  assert.deepEqual(empty.stop(0), []);
  assert.equal(empty.stopped, true);
});

test('40ms observations retain an 80ms stable change but isolated and alternating outliers do not oscillate', async () => {
  const { VoiceNoteTracker } = await moduleAt('voiceNoteTracker');
  const tracker = new VoiceNoteTracker();
  const notes = [];
  for (const item of [obs(0), obs(0.04), obs(0.08), obs(0.12, 72), obs(0.16, 72), obs(0.20), obs(0.24), obs(0.28)]) notes.push(...tracker.push(item));
  notes.push(...tracker.stop(0.32));
  assert.deepEqual(notes.map(n => [n.midi, n.startTime, n.endTime]), [[69, 0, 0.12], [72, 0.12, 0.20], [69, 0.20, 0.32]]);
  const jitter = new VoiceNoteTracker();
  const stable = [];
  jitter.push(obs(0)); jitter.push(obs(0.04));
  for (let i = 3; i < 80; i++) stable.push(...jitter.push(obs(i * 0.02, i % 2 ? 72 : 69)));
  stable.push(...jitter.stop(1.6));
  assert.deepEqual(stable.map(n => n.midi), [69]);
});

test('audio-clock jitter spanning 29ms can confirm a short change without accepting a 20ms outlier', async () => {
  const { VoiceNoteTracker } = await moduleAt('voiceNoteTracker');
  const tracker = new VoiceNoteTracker();
  const notes = [];
  for (const item of [obs(0), obs(0.04), obs(0.10, 72), obs(0.1186666667, 72), obs(0.1293333333, 72), obs(0.1586666667), obs(0.20)]) notes.push(...tracker.push(item));
  notes.push(...tracker.stop(0.25));
  assert.deepEqual(notes.map(n => n.midi), [69, 72, 69]);
});

test('replayed 80ms C5 phase failure retains two precise anchors followed by a bounded mixed window', async () => {
  const { VoiceNoteTracker } = await moduleAt('voiceNoteTracker');
  const tracker = new VoiceNoteTracker();
  const notes = [];
  for (const item of [obs(1), obs(1.04),
    { ...obs(1.12036), frequencyHz: 523.59 },
    { ...obs(1.14068), frequencyHz: 523.58 },
    { ...obs(1.16100), frequencyHz: 500.19 },
    obs(1.18132), obs(1.22196)]) notes.push(...tracker.push(item));
  notes.push(...tracker.stop(1.26));
  assert.deepEqual(notes.map(n => [n.midi, n.startTime, n.endTime]),
    [[69, 1, 1.12036], [72, 1.12036, 1.18132], [69, 1.18132, 1.26]]);
});

test('mixed-window support cannot seed notes, shorten the hold, bridge silence or admit unanchored drift', async () => {
  const { VoiceNoteTracker } = await moduleAt('voiceNoteTracker');
  const precise = time => ({ ...obs(time), frequencyHz: 523.59 });
  const mixed = (time, midi = 71.21967229340116) => obs(time, midi);
  const cases = [
    [precise(0.1), precise(0.12032)], // Two polls alone remain insufficient.
    [precise(0.1), mixed(0.12032), mixed(0.14064)], // Only one anchor.
    [obs(0.1, 72.3), obs(0.12032, 72.3), mixed(0.14064)], // Imprecise anchors.
    [precise(0.1), precise(0.12032), mixed(0.14064, 71.14)], // Outside uncertainty bound.
    [precise(0.1), precise(0.12032), mixed(0.16)], // Stale anchor.
    [precise(0.1), precise(0.12032), { ...mixed(0.14064), confidence: 0.84 }],
    [precise(0.1), precise(0.12032), obs(0.13, null), mixed(0.14064)],
    [obs(0.1, 70), obs(0.12032, 70), obs(0.14064, 70.78)], // Adjacent-note uncertainty.
  ];
  for (const items of cases) {
    const tracker = new VoiceNoteTracker();
    const notes = [];
    tracker.push(obs(0)); tracker.push(obs(0.04));
    for (const item of [...items, obs(0.18), obs(0.22)]) notes.push(...tracker.push(item));
    notes.push(...tracker.stop(0.25));
    assert.deepEqual(notes.map(n => n.midi), [69], JSON.stringify(items));
  }
  const onset = new VoiceNoteTracker();
  for (const item of [precise(0.1), precise(0.12032), mixed(0.14064)]) onset.push(item);
  assert.deepEqual(onset.stop(0.15), []); // Uncertainty cannot confirm an onset.
});

test('rate-scaled capture windows preserve the low detector range with actual PCM', async () => {
  const { VoicePitchDetector } = await moduleAt('voicePitchDetector');
  const detector = new VoicePitchDetector();
  for (const sr of [8000, 16000, 44100, 48000, 88200, 96000]) {
    const length = 2 ** Math.ceil(Math.log2(sr * 0.075));
    assert.ok(length <= 8192);
    for (const hz of [60, 65.4064, 110, 440, 1300]) {
      const result = detector.detect(tone(hz, sr, length), sr);
      assert.ok(result.voiced, `${sr}Hz/${length} samples, ${hz}Hz: ${JSON.stringify(result)}`);
      assert.ok(Math.abs(cents(result.frequencyHz, hz)) < 25);
    }
  }
  // A fixed 4096-sample 192kHz frame cannot represent the 110Hz period.
  assert.equal(detector.detect(tone(110, 192000), 192000).voiced, false);
});

test('sine PCM yields frequency, bounded confidence and RMS at both sample rates', async () => {
  const { VoicePitchDetector } = await moduleAt('voicePitchDetector');
  const detector = new VoicePitchDetector();
  for (const sr of [44100, 48000]) {
    for (const hz of [82.4069, 110, 220, 440, 880]) {
      const result = detector.detect(tone(hz, sr), sr);
      assert.ok(result.voiced, `${hz}Hz at ${sr}: ${JSON.stringify(result)}`);
      assert.ok(Math.abs(cents(result.frequencyHz, hz)) < 15);
      assert.ok(result.confidence >= 0 && result.confidence <= 1);
      assert.ok(result.rms > 0.1 && result.rms < 0.3);
    }
  }
});
