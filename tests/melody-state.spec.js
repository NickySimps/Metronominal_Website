const { test, expect } = require('@playwright/test');
async function ready(page) {
  await page.goto('/js/beatTiming.js');
  await page.setContent('<base href="/"><main></main>');
  await page.evaluate(async () => {
    window.app = (await import('/js/appState.js')).default;
    app.resetState();
    window.notes = { version: 1, bars: [[{ id: 'n', midi: 60, startTick: 2880, durationTicks: 960, velocity: .75 }]] };
  });
}

test('melody is detached in setters, snapshots, presets and local reload; legacy stays absent', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const legacy = Object.hasOwn(app.getMusicalSnapshot().Tracks[0], 'melody');
    app.updateTrack(0, { melody: notes });
    notes.bars[0][0].midi = 80;
    const snapshot = app.getMusicalSnapshot();
    const preset = await app.getCurrentStateForPreset();
    snapshot.Tracks[0].melody.bars[0][0].midi = 90;
    localStorage.setItem('metronominalState', JSON.stringify(preset));
    await app.loadStateFromLocalStorage();
    preset.Tracks[0].melody.bars[0][0].midi = 100;
    return { legacy, live: app.getTracks()[0].melody, snapshot: app.getMusicalSnapshot().Tracks[0].melody };
  });
  expect(result.legacy).toBe(false);
  expect(result.live.bars[0][0].midi).toBe(60);
  expect(result.snapshot).toEqual(result.live);
});

test('local history undo/redo and section snapshots preserve notes without rewriting rhythm', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const history = (await import('/js/editHistory.js')).initializeHistoryControls(document.querySelector('main'));
    app.updateTrack(0, { melody: notes });
    const after = app.getMusicalSnapshot();
    const undone = await history.undo();
    const absent = !Object.hasOwn(app.getTracks()[0], 'melody');
    const redone = await history.redo();
    app.setSong({ enabled: true, sections: [{ startBar: 0, tempo: 120, repeats: 1, tracks: app.getMusicalSnapshot().Tracks }] });
    const section = app.getSong().sections[0].tracks[0].melody;
    app.updateTrack(0, { melody: { version: 1, bars: [[]] } });
    app.applySongSectionForBar(0);
    return { undone, absent, redone, after, section, final: app.getMusicalSnapshot().Tracks[0] };
  });
  expect(result.undone && result.absent && result.redone).toBe(true);
  expect(result.section).toEqual(result.after.Tracks[0].melody);
  expect(result.final.melody).toEqual(result.section);
  expect(result.final.barSettings[0].rests).toEqual([]);
});

test('invalid melody is rejected atomically at setter, preset, song and history boundaries', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    app.updateTrack(0, { melody: notes });
    const before = app.getMusicalSnapshot();
    let notifications = 0, boundaries = 0;
    app.subscribeMusicalMutations(() => notifications++);
    document.addEventListener('historyboundary', () => boundaries++);
    const refused = [];
    for (const bad of [undefined, null, {version: 2, bars:[[]]}, {...notes, privateAudio: 'PRIVATE_MARKER'}, {...notes, bars:[[{...notes.bars[0][0], token:'PRIVATE_MARKER'}]]}]) {
      for (const action of [
        () => app.updateTrack(0, { volume: .2, melody: bad }),
        async () => { const p = await app.getCurrentStateForPreset(true); p.tempo = 200; p.Tracks[0].melody = bad; await app.loadPresetData(p); },
        () => app.setSong({ enabled: true, sections:[{startBar:0, tracks:[{...before.Tracks[0], melody:bad}]}] }),
        () => app.applyMusicalSnapshot({...before, Tracks:[{...before.Tracks[0], melody:bad}]})
      ]) { try { await action(); refused.push(false); } catch { refused.push(true); } }
    }
    return { refused, notifications, boundaries, before, after: app.getMusicalSnapshot() };
  });
  expect(result.refused, JSON.stringify(result.refused)).toEqual(Array(20).fill(true));
  expect(result.notifications).toBe(0);
  expect(result.boundaries).toBe(0);
  expect(result.after).toEqual(result.before);
});

test('unsafe structural mutations refuse before changing any state; ordinary rhythm edits still work', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(() => {
    app.updateTrack(0, { melody: notes });
    const before = app.getMusicalSnapshot();
    const refused = [];
    for (const action of [() => app.decreaseBeatsForSelectedBar(), () => app.updateBarArray(2), () => app.duplicateBar(0,0), () => app.removeTrack(0), () => app.updateTrack(0,{barSettings:[{beats:3,subdivision:1,rests:[]}],volume:.1})]) {
      try { action(); refused.push(false); } catch { refused.push(true); }
    }
    const unchanged = JSON.stringify(before) === JSON.stringify(app.getMusicalSnapshot());
    app.toggleBeatRest(0,0,1); app.setSubdivisionForSelectedBar(4); app.setBeatSlices(0,0,0,2);
    const copyIndex = app.duplicateTrack(0);
    const copy = app.getTracks()[copyIndex].melody;
    copy.bars[0][0].midi = 70;
    return {refused, unchanged, original:app.getTracks()[0].melody, rhythm:app.getTracks()[0].barSettings[0]};
  });
  expect(result.refused.every(Boolean)).toBe(true);
  expect(result.unchanged).toBe(true);
  expect(result.original.bars[0][0].midi).toBe(60);
  expect(result.rhythm.beatSlices[0]).toBe(2);
  expect(result.rhythm.subdivision).toBe(4);
});
