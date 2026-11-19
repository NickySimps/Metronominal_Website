const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../js/audioController.js'), 'utf8');

test('a solo voice review survives the false host flag but a joined non-host is refused', () => {
  const guard = source.match(/function assertVoiceDestination\(session\) \{([\s\S]*?)\n\}/);
  assert.ok(guard, 'production Apply authority guard exists');
  const testable = `${guard[0]}; assertVoiceDestination;`;
  const runGuard = (isHost, joined) => {
    const track = { barSettings: [{ beats: 4, subdivision: 1 }] };
    const sandbox = {
      window: { isHost },
      isSynchronizationJoined: () => joined,
      recordingAuthorityGeneration: 4,
      AppState: { isPlaying: () => false, getTracks: () => [track] },
      track
    };
    vm.runInNewContext(testable, sandbox);
    const session = { authority: isHost, authorityGeneration: 4, track: sandbox.track,
      barFingerprint: JSON.stringify(sandbox.track.barSettings) };
    return () => sandbox.assertVoiceDestination(session);
  };

  assert.doesNotThrow(runGuard(false, false));
  assert.throws(runGuard(false, true), /host authority changed/);
  assert.doesNotThrow(runGuard(true, true));
});

test('capture-current guard preserves role and generation fences', () => {
  const match = source.match(/const current = \(\) => ([\s\S]*?);\r?\n/);
  assert.ok(match, 'production capture-current predicate exists');
  const expression = match[1];
  const makeCurrent = (isHost, joined, generation = 4) => {
    const session = { mode: 'voice', cancelled: false, authority: isHost, authorityGeneration: 4, track: null };
    const sandbox = { AudioController: { recordingSession: session }, window: { isHost },
      recordingAuthorityGeneration: generation, isSynchronizationJoined: () => joined,
      AppState: { getTracks: () => [] }, session };
    return vm.runInNewContext(`() => (${expression})`, sandbox)();
  };
  assert.equal(makeCurrent(false, false), true);
  assert.equal(makeCurrent(false, true), true); // Capture remains possible; Apply is separately authority-gated.
  assert.equal(makeCurrent(true, true), true);
  assert.equal(makeCurrent(true, true, 5), false);
});