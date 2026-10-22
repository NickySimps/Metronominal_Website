const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('./js/audioEffects.js');
  test.skip(!await page.evaluate(() => typeof OfflineAudioContext === 'function'),
    'Native OfflineAudioContext is unavailable in this browser build; not an audio pass.');
});

test('all 20 real synthesizers render finite, non-silent audio', async ({ page }) => {
  const output = await page.evaluate(async () => {
    const { default: synths } = await import(new URL('soundSynth.js', document.baseURI));
    const results = [];
    for (const [name, synth] of Object.entries(synths)) {
      const context = new OfflineAudioContext(1, 44100, 44100);
      synth(context, 0, { volume: 0.3 }, context.destination);
      const data = (await context.startRendering()).getChannelData(0);
      let peak = 0;
      let finite = true;
      for (const value of data) {
        finite = finite && Number.isFinite(value);
        peak = Math.max(peak, Math.abs(value));
      }
      results.push({ name, finite, peak });
    }
    return results;
  });
  expect(output).toHaveLength(20);
  for (const result of output) {
    expect(result.finite, result.name).toBe(true);
    expect(result.peak, result.name).toBeGreaterThan(0.00001);
    expect(result.peak, result.name).toBeLessThan(3);
  }
});

test('real Kick and Snare remain distinct through cached reverse rendering', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const [{ default: synths }, effects] = await Promise.all([
      import(new URL('soundSynth.js', document.baseURI)), import(new URL('audioEffects.js', document.baseURI)),
    ]);
    const context = new OfflineAudioContext(1, 44100, 44100);
    const settings = { volume: 0.3, attack: 0.01, decay: 0.1, release: 0.2 };
    const kick = await effects.renderSynthAudioBuffer(context, synths.playKick, settings);
    const snare = await effects.renderSynthAudioBuffer(context, synths.playSnare, settings);
    const reversed = effects.getReversedAudioBuffer(context, snare);
    const source = snare.getChannelData(0);
    const reverseData = reversed.getChannelData(0);
    return { distinct: kick !== snare, reversesAllSamples: source.every((value, index) => value === reverseData[source.length - 1 - index]) };
  });
  expect(result).toEqual({ distinct: true, reversesAllSamples: true });
});

test('filter, distortion, delay, reverb and bypass produce real finite audio with effect tails', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { createSoundFilterInput } = await import(new URL('audioEffects.js', document.baseURI));
    async function render(settings) {
      const context = new OfflineAudioContext(1, 88200, 44100);
      const source = context.createBufferSource();
      const sample = context.createBuffer(1, 441, 44100);
      sample.getChannelData(0)[0] = 0.5;
      source.buffer = sample;
      source.connect(createSoundFilterInput(context, context.destination, { ...settings }));
      source.start(0.01);
      return (await context.startRendering()).getChannelData(0);
    }
    const configs = { dry: {}, filter: { highPassFrequency: 2000, lowPassFrequency: 3000 },
      distortion: { distortion: 0.8 }, delay: { delayMix: 1, delayTime: 0.08, delayFeedback: 0.3 },
      reverb: { reverbMix: 1, reverbFeedback: 0.2 },
      bypass: { fxBypass: true, distortion: 1, delayMix: 1, reverbMix: 1 } };
    const buffers = {};
    for (const [name, settings] of Object.entries(configs)) buffers[name] = await render(settings);
    return Object.entries(buffers).map(([name, data]) => {
      let peak = 0, tailEnergy = 0, difference = 0, finite = true;
      for (let index = 0; index < data.length; index++) {
        finite = finite && Number.isFinite(data[index]);
        peak = Math.max(peak, Math.abs(data[index]));
        if (index > 2205) tailEnergy += data[index] * data[index];
        difference += Math.abs(data[index] - buffers.dry[index]);
      }
      return { name, finite, peak, tailEnergy, difference };
    });
  });
  for (const row of result) {
    expect(row.finite, row.name).toBe(true);
    expect(row.peak, row.name).toBeGreaterThan(0.00001);
    if (row.name !== 'dry') expect(row.difference, row.name).toBeGreaterThan(0.00001);
    if (['delay', 'reverb'].includes(row.name)) expect(row.tailEnergy, row.name).toBeGreaterThan(0.000001);
    if (row.name === 'bypass') expect(row.tailEnergy).toBe(0);
  }
});
