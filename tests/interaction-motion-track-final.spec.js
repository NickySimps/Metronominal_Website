'use strict';
const {test, expect} = require('@playwright/test');

async function ready(page) {
  await page.route('**/script.js', route => route.abort());
  await page.goto('./');
  await page.evaluate(async () => {
    window.a = (await import('/js/appState.js')).default;
    window.tracks = (await import('/js/tracksController.js')).default;
    window.audio = (await import('/js/audioController.js')).default;
    (await import('/js/interactionMotion.js')).initializeInteractionMotion(document);
    a.initializeAudioContext();
    if (!a.getTracks().length) a.addTrack();
    tracks.init();
    window.observed = [];
    window.started = [];
    for (const prototype of [OscillatorNode.prototype, AudioBufferSourceNode.prototype]) {
      const nativeStart = prototype.start;
      prototype.start = function (...args) {
        const result = nativeStart.apply(this, args);
        started.push(this);
        return result;
      };
    }
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node.nodeType === 1 && node.dataset.motionKind) {
          observed.push({kind: node.dataset.motionKind, starts: started.length});
        }
      }
    }).observe(document.querySelector('[data-interaction-motion-root]'), {childList: true, subtree: true});
  });
}
async function picker(page) {
  await ready(page);
  await page.locator('.main-beat-sound-select').first().click();
  await expect(page.locator('#sound-picker-modal')).toBeVisible();
  await page.evaluate(() => { observed = []; });
}
test('Escape discards a track-name draft exactly once without rename, save or musical mutation', async ({page}) => {
  await ready(page);
  const before = await page.evaluate(() => a.getMusicalSnapshot());
  const originalName = await page.locator('.track-name').first().textContent();
  await page.locator('.track-name').first().click();
  await page.locator('.track-name-input').fill('Discard this draft');
  await page.evaluate(() => {
    observed = [];
    window.mutations = 0;
    const originalUpdate = a.updateTrack;
    a.updateTrack = (...args) => { mutations++; return originalUpdate(...args); };
    window.oldNameInput = document.querySelector('.track-name-input');
  });
  await page.locator('.track-name-input').press('Escape');
  await expect(page.locator('.track-name-input')).toHaveCount(0);
  await expect(page.locator('.track-name').first()).toHaveText(originalName);
  await expect.poll(() => page.evaluate(() => observed)).toEqual([{kind: 'cancel', starts: 0}]);
  await page.evaluate(() => oldNameInput.dispatchEvent(new FocusEvent('blur')));
  expect(await page.evaluate(() => mutations)).toBe(0);
  expect(await page.evaluate(() => a.getMusicalSnapshot())).toEqual(before);
  expect(await page.evaluate(() => observed)).toEqual([{kind: 'cancel', starts: 0}]);
});

test('unchanged track-name submission stays silent rather than claiming rename or cancellation', async ({page}) => {
  await ready(page);
  await page.evaluate(() => { a.updateTrack(0, {name: 'Existing track'}); tracks.renderTracks(); });
  const before = await page.evaluate(() => a.getMusicalSnapshot());
  await page.locator('.track-name').first().click();
  await page.evaluate(() => { observed = []; });
  await page.locator('.track-name-input').press('Enter');
  await expect(page.locator('.track-name-input')).toHaveCount(0);
  expect(await page.evaluate(() => observed)).toEqual([]);
  expect(await page.evaluate(() => a.getMusicalSnapshot())).toEqual(before);
});

test('missing picker sample refuses without inventing native playback', async ({page}) => {
  await picker(page);
  const before = await page.evaluate(() => a.getMusicalSnapshot());
  expect(await page.evaluate(() => !!a.getSoundBuffer('Click1.mp3'))).toBe(false);
  await preview(page, 'Click1.mp3').click();
  await expect.poll(() => page.evaluate(() => observed)).toEqual([{kind: 'refuse', starts: 0}]);
  expect(await page.evaluate(() => a.getMusicalSnapshot())).toEqual(before);
});

test('pending native resume has no premature cue and cannot acknowledge a reopened picker', async ({page}) => {
  await picker(page);
  await page.evaluate(async () => {
    const context = a.getAudioContext();
    await context.suspend();
    const nativeResume = context.resume.bind(context);
    const pending = new Promise(resolve => { window.releaseResume = async () => { await nativeResume(); resolve(); }; });
    context.resume = () => pending;
  });
  await preview(page, 'Synth Kick').click();
  expect(await page.evaluate(() => ({pending: typeof releaseResume, starts: started.length, cues: observed}))).toEqual({pending: 'function', starts: 0, cues: []});
  await page.keyboard.press('Escape');
  await expect(page.locator('#sound-picker-modal')).toBeHidden();
  await page.locator('.main-beat-sound-select').first().click();
  await page.evaluate(async () => { observed = []; await releaseResume(); });
  await expect.poll(() => page.evaluate(() => started.length)).toBe(1);
  expect(await page.evaluate(() => observed)).toEqual([]);
});

const preview = (page, sound) => page.locator(`.sound-picker-card[data-sound="${sound}"] .sound-picker-preview`);

for (const boundary of ['resume', 'source start']) test(`picker ${boundary} rejection refuses without audition or unhandled rejection`, async ({page}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await picker(page);
  const before = await page.evaluate(async boundary => {
    if (boundary === 'resume') {
      await a.getAudioContext().suspend();
      a.getAudioContext().resume = () => Promise.reject(new DOMException('Blocked audio', 'NotAllowedError'));
    }
    else OscillatorNode.prototype.start = function () { throw new DOMException('Rejected native start', 'InvalidStateError'); };
    return a.getMusicalSnapshot();
  }, boundary);
  await preview(page, 'Synth Kick').click();
  await expect.poll(() => page.evaluate(() => observed)).toEqual([{kind: 'refuse', starts: 0}]);
  expect(await page.evaluate(() => a.getMusicalSnapshot())).toEqual(before);
  expect(errors).toEqual([]);
});

test('picker synth audition follows native source acceptance without changing music or selection', async ({page}) => {
  await picker(page);
  const before = await page.evaluate(() => a.getMusicalSnapshot());
  await preview(page, 'Synth Kick').click();
  expect(await page.evaluate(() => ({state: a.getAudioContext().state, count: started.length}))).toEqual({state: 'running', count: 1});
  await expect.poll(() => page.evaluate(() => observed)).toEqual([{kind: 'audition', starts: 1}]);
  expect(await page.evaluate(() => a.getMusicalSnapshot())).toEqual(before);
  await expect(page.locator('#sound-picker-modal')).toBeVisible();
});

test('picker sample audition confirms the real buffer source and refuses retrigger-disabled no-op', async ({page}) => {
  await ready(page);
  await page.evaluate(() => {
    const context = a.getAudioContext();
    const buffer = context.createBuffer(1, context.sampleRate * 10, context.sampleRate);
    buffer.getChannelData(0).fill(0.1);
    a.setSoundBuffer('Generated Picker', buffer);
    a.addCustomSound('Generated Picker', 'Generated Picker', {retrigger: false});
    window.originalBuffer = buffer;
  });
  await page.locator('.main-beat-sound-select').first().click();
  const before = await page.evaluate(() => { observed = []; return a.getMusicalSnapshot(); });
  await preview(page, 'Generated Picker').click();
  expect(await page.evaluate(() => started.length === 1 && started[0].buffer === originalBuffer && audio.activeRecordingSources.get('Generated Picker') === started[0])).toBe(true);
  await expect.poll(() => page.evaluate(() => observed)).toEqual([{kind: 'audition', starts: 1}]);
  await page.evaluate(() => { observed = []; });
  await preview(page, 'Generated Picker').click();
  await expect.poll(() => page.evaluate(() => observed)).toEqual([{kind: 'refuse', starts: 1}]);
  expect(await page.evaluate(() => started.length)).toBe(1);
  expect(await page.evaluate(() => a.getMusicalSnapshot())).toEqual(before);
  await page.evaluate(() => started[0].stop());
});
