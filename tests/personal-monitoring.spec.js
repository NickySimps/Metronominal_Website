const { test, expect } = require('@playwright/test');
const pageErrors = new WeakMap();

test.beforeEach(async ({ page }) => {
  const errors = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
});
test.afterEach(async ({ page }) => expect(pageErrors.get(page)).toEqual([]));

async function ready(page) {
  await page.goto('./');
  await expect(page.locator('#share-btn')).toHaveClass(/connected/);
  await expect(page.locator('#personal-monitoring summary')).toBeVisible();
}
async function setLevel(locator, value) {
  await locator.evaluate((input, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
async function sharedState(page) {
  return page.evaluate(async () => {
    const { default: app } = await import(new URL('js/appState.js', document.baseURI));
    return JSON.stringify(await app.getCurrentStateForPreset(true));
  });
}

test('device listening level and mute stay local and persist across reload', async ({ page }) => {
  await ready(page);
  const before = await sharedState(page);
  await page.locator('#personal-monitoring summary').click();
  await setLevel(page.getByLabel('Device listening level', { exact: true }), 0.35);
  await page.getByRole('button', { name: 'Mute my sound', exact: true }).click();
  await expect(page.locator('#monitor-summary')).toHaveText('Muted');
  expect(await sharedState(page)).toBe(before);
  await page.reload();
  await expect(page.locator('#share-btn')).toHaveClass(/connected/);
  await expect(page.locator('#monitor-summary')).toHaveText('Muted');
  await page.locator('#personal-monitoring summary').click();
  await expect(page.getByLabel('Device listening level', { exact: true })).toHaveValue('0.35');
  await page.getByRole('button', { name: 'Unmute my sound', exact: true }).click();
  await expect(page.locator('#monitor-summary')).toHaveText('35%');
  expect(await sharedState(page)).toBe(before);
});

async function instrumentOutputs(page) {
  await page.addInitScript(() => {
    window.monitorOutputTaps = [];
    if (typeof AudioNode !== 'function') return;
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(destination, ...args) {
      const result = connect.call(this, destination, ...args);
      if (destination === this.context.destination && !window.monitorOutputTaps.some(tap => tap.source === this)) {
        const analyser = this.context.createAnalyser();
        analyser.fftSize = 2048;
        connect.call(this, analyser);
        window.monitorOutputTaps.push({ source: this, analyser });
      }
      return result;
    };
    window.monitorPeak = () => Math.max(0, ...window.monitorOutputTaps.map(({ analyser }) => {
      const samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      return samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0);
    }));
  });
}
async function nativeAudio(page) {
  test.skip(!await page.evaluate(() => typeof AudioBuffer === 'function' && typeof AudioNode === 'function'),
    'This browser build cannot verify native monitoring output.');
}
async function startSample(page, trackIndex = null) {
  await page.evaluate(async index => {
    const [{ default: app }, { default: audio }] = await Promise.all([
      import(new URL('js/appState.js', document.baseURI)),
      import(new URL('js/audioController.js', document.baseURI)),
    ]);
    const context = app.getAudioContext();
    await context.resume();
    // Explicit ten-second constant fixture, filled before assignment for Firefox.
    const sample = context.createBuffer(1, context.sampleRate * 10, context.sampleRate);
    sample.getChannelData(0).fill(0.2);
    app.setSoundBuffer('MonitorFixture', sample);
    audio.playRecording('MonitorFixture', { fxBypass: true }, 0, 10, context.currentTime, 0.5,
      index === null ? null : app.getTracks()[index].analyserNode);
  }, trackIndex);
}
async function expectPeak(page, expected) {
  await expect.poll(() => page.evaluate(() => window.monitorPeak()), { timeout: 5000 })
    .toBeCloseTo(expected, 3);
}

test('personal device level changes already-playing native output without changing transport', async ({ page }) => {
  await instrumentOutputs(page);
  await ready(page);
  await nativeAudio(page);
  await page.locator('#personal-monitoring summary').click();
  await startSample(page);
  await expectPeak(page, 0.1);
  await setLevel(page.getByLabel('Device listening level', { exact: true }), 0.25);
  await expectPeak(page, 0.025);
  await page.getByRole('button', { name: 'Mute my sound', exact: true }).click();
  await expectPeak(page, 0);
  await page.getByRole('button', { name: 'Unmute my sound', exact: true }).click();
  await expectPeak(page, 0.025);
  await page.getByRole('button', { name: 'Reset listening mix', exact: true }).click();
  await expectPeak(page, 0.1);
  expect(await page.evaluate(async () => (await import(new URL('js/appState.js', document.baseURI))).default.isPlaying())).toBe(false);
});

test('per-track listening levels independently attenuate native output without editing the arrangement', async ({ page }) => {
  await instrumentOutputs(page);
  await ready(page);
  await nativeAudio(page);
  await page.locator('#add-track-btn').click();
  await page.locator('#personal-monitoring summary').click();
  const first = page.getByLabel('Track 1 listening level', { exact: true });
  const second = page.getByLabel('Track 2 listening level', { exact: true });
  await expect(second).toBeVisible();
  const before = await sharedState(page);
  await startSample(page, 0);
  await expectPeak(page, 0.1);
  await setLevel(first, 0.4);
  await expectPeak(page, 0.04);
  await page.getByRole('button', { name: 'Mute Track 1 for me', exact: true }).click();
  await expectPeak(page, 0);
  await startSample(page, 1);
  await expectPeak(page, 0.1);
  await setLevel(second, 0.2);
  await expectPeak(page, 0.02);
  await page.getByRole('button', { name: 'Unmute Track 1 for me', exact: true }).click();
  await expectPeak(page, 0.06);
  expect(await sharedState(page)).toBe(before);
});

test('room rotation clears slot-specific listening choices without losing the device level', async ({ page }) => {
  await ready(page);
  await page.locator('#personal-monitoring summary').click();
  await setLevel(page.getByLabel('Device listening level', { exact: true }), 0.35);
  await setLevel(page.getByLabel('Track 1 listening level', { exact: true }), 0.2);
  await page.getByRole('button', { name: 'Mute Track 1 for me', exact: true }).click();
  const previous = page.url();
  await page.evaluate(async () => (await import(new URL('js/webrtc.js', document.baseURI))).disconnectAllPeers());
  await expect(page).not.toHaveURL(previous);
  await expect(page.locator('#share-btn')).toHaveClass(/connected/);
  await expect(page.getByLabel('Track 1 listening level', { exact: true })).toHaveValue('1');
  await expect(page.getByRole('button', { name: 'Mute Track 1 for me', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByLabel('Device listening level', { exact: true })).toHaveValue('0.35');
});

test('track listening mute also silences editor auditions at the AudioContext output', async ({ page }) => {
  await instrumentOutputs(page);
  await ready(page);
  await nativeAudio(page);
  await page.locator('#personal-monitoring summary').click();
  await page.getByRole('button', { name: 'Mute Track 1 for me', exact: true }).click();
  await page.evaluate(async () => {
    const [{ default: app }, { default: editor }] = await Promise.all([
      import(new URL('js/appState.js', document.baseURI)),
      import(new URL('js/soundSettingsModal.js', document.baseURI)),
    ]);
    const context = app.getAudioContext();
    await context.resume();
    const sample = context.createBuffer(1, context.sampleRate * 10, context.sampleRate);
    sample.getChannelData(0).fill(0.2);
    app.setSoundBuffer('Click1.mp3', sample);
    app.updateTrack(0, { mainBeatSound: { sound: 'Click1.mp3', settings: { trimStart: 0, trimEnd: 10, volume: 1, fxBypass: true } } });
    editor.show(0, 'mainBeatSound');
    await editor.togglePreview();
    window.monitorEditor = editor;
  });
  await expect.poll(() => page.evaluate(() => Boolean(window.monitorEditor.previewSource))).toBe(true);
  await page.waitForTimeout(150);
  await expectPeak(page, 0);
  const peak = await page.evaluate(() => {
    const analyser = window.monitorEditor.previewAnalyserNode;
    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    return samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0);
  });
  expect(peak).toBeGreaterThan(0.01);
  await page.evaluate(() => window.monitorEditor.hide());
});

test('same-layout replay preserves local mix and reuses output nodes; removing a track resets slots safely', async ({ page }) => {
  await ready(page);
  await page.locator('#add-track-btn').click();
  await page.locator('#personal-monitoring summary').click();
  await setLevel(page.getByLabel('Track 2 listening level', { exact: true }), 0.4);
  const result = await page.evaluate(async () => {
    const [{ default: app }, { default: monitoring }] = await Promise.all([
      import(new URL('js/appState.js', document.baseURI)), import(new URL('js/monitoring.js', document.baseURI)),
    ]);
    const context = app.getAudioContext();
    const output = context && monitoring.getOutput(context);
    const trackOutput = context && monitoring.getTrackOutput(context, 1);
    const snapshot = await app.getCurrentStateForPreset(true);
    for (let index = 0; index < 20; index++) await app.loadPresetData(structuredClone(snapshot));
    return { level: monitoring.getState().tracks[1].volume,
      sameOutput: !context || monitoring.getOutput(context) === output,
      sameTrackOutput: !context || monitoring.getTrackOutput(context, 1) === trackOutput };
  });
  expect(result).toEqual({ level: 0.4, sameOutput: true, sameTrackOutput: true });
  await page.evaluate(async () => (await import(new URL('js/appState.js', document.baseURI))).default.removeTrack(0));
  await expect(page.locator('#monitor-tracks input')).toHaveCount(1);
  await expect(page.getByLabel('Track 1 listening level', { exact: true })).toHaveValue('1');
});

test('a joined client can mute its monitor while the host and synchronized transport remain authoritative', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext({ serviceWorkers: 'block' }), browser.newContext({ serviceWorkers: 'block' })]);
  try {
    const [host, client] = await Promise.all(contexts.map(context => context.newPage()));
    const errors = [];
    for (const page of [host, client]) page.on('pageerror', error => errors.push(error.message));
    await ready(host);
    await client.goto(host.url());
    await expect(client.locator('#share-btn')).toHaveClass(/connected/);
    await client.locator('#dismiss-connection-modal-btn').click();
    await client.locator('#personal-monitoring summary').click();
    const before = await sharedState(host);
    await client.evaluate(() => {
      window.monitorSharedWrites = [];
      const send = WebSocket.prototype.send;
      WebSocket.prototype.send = function(data) {
        const type = JSON.parse(data).type;
        if (['state', 'state-request', 'transport-command'].includes(type)) window.monitorSharedWrites.push(type);
        return send.call(this, data);
      };
    });
    await setLevel(client.getByLabel('Device listening level', { exact: true }), 0.25);
    await setLevel(client.getByLabel('Track 1 listening level', { exact: true }), 0.4);
    await client.getByRole('button', { name: 'Mute my sound', exact: true }).click();
    expect(await client.evaluate(() => window.monitorSharedWrites)).toEqual([]);
    expect(await sharedState(host)).toBe(before);
    await expect(host.locator('#monitor-summary')).toHaveText('100%');
    expect(await host.evaluate(() => localStorage.getItem('metronominal.monitoring'))).not.toContain('0.25');
    // The local control is not a second transport: host changes still arrive.
    await host.locator('.tempo-container .slider').fill('173');
    await host.locator('.tempo-container .slider').dispatchEvent('input');
    await expect.poll(() => client.evaluate(async () => (await import(new URL('js/appState.js', document.baseURI))).default.getTempo())).toBe(173);
    await expect(client.locator('#monitor-summary')).toHaveText('Muted');
    await expect(client.getByLabel('Track 1 listening level', { exact: true })).toHaveValue('0.4');
    await host.locator('.start-stop-btn').click();
    for (const page of [host, client]) {
      await expect.poll(() => page.evaluate(async () => (await import(new URL('js/appState.js', document.baseURI))).default.isPlaying())).toBe(true);
    }
    await client.getByRole('button', { name: 'Unmute my sound', exact: true }).click();
    expect(await host.evaluate(async () => (await import(new URL('js/appState.js', document.baseURI))).default.isPlaying())).toBe(true);
    await host.locator('.start-stop-btn').click();
    for (const page of [host, client]) {
      await expect.poll(() => page.evaluate(async () => (await import(new URL('js/appState.js', document.baseURI))).default.isPlaying())).toBe(false);
    }
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});

for (const width of [320, 390]) {
  test(`personal monitoring stays readable and keyboard-operable in Synthwave at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 700 });
    await ready(page);
    await page.evaluate(async () => {
      (await import(new URL('js/themeController.js', document.baseURI))).default.applyTheme('synthwave');
      await document.fonts.ready;
    });
    const summary = page.locator('#personal-monitoring summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Device listening level', { exact: true })).toBeVisible();
    for (const selector of ['#monitor-volume', '#monitor-mute', '#monitor-track-0', '[data-monitor-mute="0"]', '#monitor-reset']) {
      const control = page.locator(selector);
      await control.scrollIntoViewIfNeeded();
      const geometry = await control.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return { left: rect.left, right: rect.right, viewport: innerWidth,
          clipped: element.scrollWidth > element.clientWidth + 1, hit: hit === element || element.contains(hit) };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
      expect(geometry.clipped).toBe(false);
      expect(geometry.hit).toBe(true);
    }
    for (const output of await page.locator('#personal-monitoring output').all()) {
      const geometry = await output.evaluate(element => ({ height: element.getBoundingClientRect().height,
        fontSize: parseFloat(getComputedStyle(element).fontSize), clipped: element.scrollWidth > element.clientWidth + 1 }));
      expect(geometry.height).toBeLessThanOrEqual(geometry.fontSize * 1.6);
      expect(geometry.clipped).toBe(false);
    }
    const mute = page.locator('#monitor-mute');
    await mute.focus();
    await page.keyboard.press('Space');
    await expect(mute).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#personal-monitoring').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`personal-monitoring-${width}.png`) });
  });
}

test('device mute silences already-scheduled native count-in clicks', async ({ page }) => {
  await instrumentOutputs(page);
  await ready(page);
  await nativeAudio(page);
  await page.locator('#personal-monitoring summary').click();
  await page.evaluate(async () => {
    const { default: engine } = await import(new URL('js/metronomeEngine.js', document.baseURI));
    await engine.scheduleCountIn({ startsAt: Date.now() + 120, totalBeats: 20, beatIntervalMs: 100, accentEvery: 4 });
  });
  await expect.poll(() => page.evaluate(() => window.monitorPeak()), { intervals: [10], timeout: 2000 }).toBeGreaterThan(0.005);
  await page.getByRole('button', { name: 'Mute my sound', exact: true }).click();
  await page.waitForTimeout(100); // Let the output ramp and analyser history settle.
  const peak = await page.evaluate(async () => {
    let peak = 0;
    for (let index = 0; index < 20; index++) {
      peak = Math.max(peak, window.monitorPeak());
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    (await import(new URL('js/metronomeEngine.js', document.baseURI))).default.cancelCountIn();
    return peak;
  });
  expect(peak).toBeLessThan(0.0005);
});

test('malformed preferences and invalid API levels cannot produce unsafe listening gains', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('metronominal.monitoring', '{"version":1,"volume":"bad","muted":"yes"}'));
  await ready(page);
  await expect(page.locator('#monitor-summary')).toHaveText('100%');
  const result = await page.evaluate(async () => {
    const { default: monitor } = await import(new URL('js/monitoring.js', document.baseURI));
    monitor.setVolume(0.4);
    for (const value of [{}, true, null, NaN, Infinity, '', 'bad']) monitor.setVolume(value);
    const validPreserved = monitor.getState().volume;
    monitor.setVolume(999);
    const upper = monitor.getState().volume;
    monitor.setVolume(-10);
    const lower = monitor.getState().volume;
    monitor.setTrackVolume(0, 999);
    monitor.setTrackVolume(-1, 0);
    monitor.setTrackMuted(NaN, true);
    const copy = monitor.getState();
    copy.tracks[0].volume = 999;
    const trackUpper = monitor.getState().tracks[0].volume;
    monitor.setTrackVolume(0, -10);
    const trackLower = monitor.getState().tracks[0].volume;
    monitor.reset();
    return { validPreserved, upper, lower, trackUpper, trackLower, reset: monitor.getState().volume };
  });
  expect(result).toEqual({ validPreserved: 0.4, upper: 1, lower: 0, trackUpper: 1, trackLower: 0, reset: 1 });
});

test('monitoring remains usable when its preference storage is blocked', async ({ page }) => {
  await page.addInitScript(() => {
    for (const method of ['getItem', 'setItem']) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function(key, ...args) {
        if (key === 'metronominal.monitoring') throw new DOMException('Blocked test preference store', 'SecurityError');
        return original.call(this, key, ...args);
      };
    }
  });
  await ready(page);
  await page.locator('#personal-monitoring summary').click();
  await setLevel(page.getByLabel('Device listening level', { exact: true }), 0.3);
  await page.getByRole('button', { name: 'Mute my sound', exact: true }).click();
  await expect(page.locator('#monitor-summary')).toHaveText('Muted');
  await page.getByRole('button', { name: 'Unmute my sound', exact: true }).click();
  await expect(page.locator('#monitor-summary')).toHaveText('30%');
});

test('monitor labels and mute states contrast with every selectable theme', async ({ page }) => {
  await ready(page);
  await page.locator('#personal-monitoring summary').click();
  const results = await page.evaluate(async () => {
    const { default: theme } = await import(new URL('js/themeController.js', document.baseURI));
    const { default: monitor } = await import(new URL('js/monitoring.js', document.baseURI));
    const names = [...document.querySelectorAll('#theme-menu [data-theme]')].map(button => button.dataset.theme);
    const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const contrast = (foreground, background) => {
      const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
      return (values[1] + 0.05) / (values[0] + 0.05);
    };
    const results = [];
    for (const name of names) {
      theme.applyTheme(name);
      await new Promise(resolve => setTimeout(resolve, 350));
      const panel = getComputedStyle(document.querySelector('#personal-monitoring'));
      const label = getComputedStyle(document.querySelector('label[for="monitor-volume"]'));
      const ratios = [contrast(label.color, panel.backgroundColor)];
      for (const muted of [false, true]) {
        monitor.setMuted(muted);
        await new Promise(resolve => setTimeout(resolve, 350));
        const button = getComputedStyle(document.querySelector('#monitor-mute'));
        ratios.push(contrast(button.color, button.backgroundColor));
      }
      results.push({ name, minimum: Math.min(...ratios) });
    }
    return results;
  });
  expect(results.length).toBeGreaterThan(10);
  for (const result of results) expect(result.minimum, result.name).toBeGreaterThanOrEqual(4.5);
});
