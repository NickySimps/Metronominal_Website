const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  // Load only the module under test, not the application's audio graph.
  await page.goto('./js/audioEffects.js');
  const offlineAudioAvailable = await page.evaluate(() => typeof OfflineAudioContext === 'function');
  test.skip(!offlineAudioAvailable, 'This browser build exposes no OfflineAudioContext; native audio rendering cannot be verified.');
});

test('render cache distinguishes different synth functions with identical names and settings', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { renderSynthAudioBuffer } = await import(new URL('audioEffects.js', document.baseURI));
    const context = new OfflineAudioContext(1, 1600, 8000);
    const makeSynth = (value) => function synth(offline, time, settings, destination) {
      const source = offline.createConstantSource();
      source.offset.value = value;
      source.connect(destination);
      source.start(time);
    };
    const firstSynth = makeSynth(0.25);
    const secondSynth = makeSynth(-0.5);
    const settings = { attack: 0.01, decay: 0.01, release: 0.01 };
    const [first, repeated, second] = await Promise.all([
      renderSynthAudioBuffer(context, firstSynth, settings),
      renderSynthAudioBuffer(context, firstSynth, settings),
      renderSynthAudioBuffer(context, secondSynth, settings),
    ]);
    return {
      reused: first === repeated,
      collided: first === second,
      samples: [first.getChannelData(0)[100], second.getChannelData(0)[100]],
    };
  });
  expect(result.reused).toBe(true);
  expect(result.collided).toBe(false);
  expect(result.samples).toEqual([0.25, -0.5]);
});

test('render cache includes the requested sample rate and context identity', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { renderSynthAudioBuffer } = await import(new URL('audioEffects.js', document.baseURI));
    // A mutable facade makes sample-rate keying observable; real contexts have a fixed rate.
    const context = { sampleRate: 8000 };
    const synth = () => {};
    const first = await renderSynthAudioBuffer(context, synth);
    context.sampleRate = 16000;
    const changedRate = await renderSynthAudioBuffer(context, synth);
    const otherContext = await renderSynthAudioBuffer({ sampleRate: 16000 }, synth);
    return {
      rates: [first.sampleRate, changedRate.sampleRate, otherContext.sampleRate],
      differentContexts: changedRate !== otherContext,
    };
  });
  expect(result.rates).toEqual([8000, 16000, 16000]);
  expect(result.differentContexts).toBe(true);
});

test('render cache evicts least-recently-used entries across synth functions at 32 entries per context', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { renderSynthAudioBuffer } = await import(new URL('audioEffects.js', document.baseURI));
    const context = new OfflineAudioContext(1, 1600, 8000);
    const synths = Array.from({ length: 33 }, () => () => {});
    const buffers = [];
    for (let index = 0; index < 32; index += 1) {
      buffers.push(await renderSynthAudioBuffer(context, synths[index]));
    }
    // Refresh the oldest entry before overflowing the shared per-context budget.
    await renderSynthAudioBuffer(context, synths[0]);
    await renderSynthAudioBuffer(context, synths[32]);
    return {
      hotRetained: await renderSynthAudioBuffer(context, synths[0]) === buffers[0],
      coldEvicted: await renderSynthAudioBuffer(context, synths[1]) !== buffers[1],
    };
  });
  expect(result.hotRetained).toBe(true);
  expect(result.coldEvicted).toBe(true);
});

test('failed offline renders can be retried instead of poisoning the cache', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { renderSynthAudioBuffer } = await import(new URL('audioEffects.js', document.baseURI));
    const context = new OfflineAudioContext(1, 1600, 8000);
    const synth = () => {};
    const original = OfflineAudioContext.prototype.startRendering;
    let attempts = 0;
    OfflineAudioContext.prototype.startRendering = function () {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new Error('transient render failure'));
      return original.call(this);
    };
    try {
      const firstError = await renderSynthAudioBuffer(context, synth).catch((error) => error.message);
      const retry = await renderSynthAudioBuffer(context, synth).catch(() => null);
      return { firstError, retried: retry instanceof AudioBuffer, attempts };
    } finally {
      OfflineAudioContext.prototype.startRendering = original;
    }
  });
  expect(result).toEqual({ firstError: 'transient render failure', retried: true, attempts: 2 });
});

test('effect hits reuse DSP data but never live audio nodes', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { createEffectRackInput } = await import(new URL('audioEffects.js', document.baseURI));
    const context = new OfflineAudioContext(1, 1600, 8000);
    const convolvers = [];
    const originalConvolver = context.createConvolver.bind(context);
    context.createConvolver = () => {
      const node = originalConvolver();
      convolvers.push(node);
      return node;
    };
    const OriginalArray = window.Float32Array;
    let curves = 0;
    window.Float32Array = new Proxy(OriginalArray, {
      construct(target, args) {
        if (args[0] === 44100) curves++;
        return Reflect.construct(target, args);
      },
    });
    try {
      const settings = { distortion: 0.314159, reverbMix: 0.3, reverbFeedback: 0.4 };
      const first = createEffectRackInput(context, context.destination, { ...settings });
      const second = createEffectRackInput(context, context.destination, { ...settings });
      return { freshNodes: first !== second && convolvers[0] !== convolvers[1],
        sharedImpulse: convolvers[0].buffer === convolvers[1].buffer, curves };
    } finally {
      window.Float32Array = OriginalArray;
    }
  });
  expect(result).toEqual({ freshNodes: true, sharedImpulse: true, curves: 1 });
});

test('reverb DSP cache evicts LRU after eight impulses per context', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { createEffectRackInput } = await import(new URL('audioEffects.js', document.baseURI));
    const context = new OfflineAudioContext(1, 1600, 8000);
    const convolvers = [];
    const original = context.createConvolver.bind(context);
    context.createConvolver = () => {
      const node = original();
      convolvers.push(node);
      return node;
    };
    const rack = index => {
      createEffectRackInput(context, context.destination, { reverbMix: 0.5, reverbFeedback: index / 10 });
      return convolvers.at(-1).buffer;
    };
    const impulses = Array.from({ length: 8 }, (_, index) => rack(index));
    rack(0);
    rack(8);
    return { hotRetained: rack(0) === impulses[0], coldEvicted: rack(1) !== impulses[1] };
  });
  expect(result).toEqual({ hotRetained: true, coldEvicted: true });
});

test('reversed buffer cache bounds retain count and evicts LRU', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { getReversedAudioBuffer } = await import(new URL('audioEffects.js', document.baseURI));
    const context = new OfflineAudioContext(1, 100, 8000);
    const makeBuffer = (val) => {
      const b = context.createBuffer(1, 10, 8000);
      b.getChannelData(0)[0] = val;
      return b;
    };
    const buffers = Array.from({ length: 33 }, (_, i) => makeBuffer(i));
    const reversed = [];
    for (let i = 0; i < 32; i += 1) {
      reversed.push(getReversedAudioBuffer(context, buffers[i]));
    }
    // Access buffer 0 again to make it MRU
    getReversedAudioBuffer(context, buffers[0]);
    // Now add buffer 32 to trigger eviction of LRU (which should be buffers[1])
    getReversedAudioBuffer(context, buffers[32]);

    const hotReversed = getReversedAudioBuffer(context, buffers[0]);
    const coldReversed = getReversedAudioBuffer(context, buffers[1]);
    return {
      hotRetained: hotReversed === reversed[0],
      coldEvicted: coldReversed !== reversed[1],
    };
  });
  expect(result.hotRetained).toBe(true);
  expect(result.coldEvicted).toBe(true);
});
