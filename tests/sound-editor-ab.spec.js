const { test, expect } = require('@playwright/test');
const pageErrors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
});

async function openEditor(page, { synth = false, beat = false, native = true } = {}) {
  await page.goto('./');
  await expect(page.locator('#share-btn')).toHaveClass(/connected/);
  test.skip(native && !await page.evaluate(() => typeof OfflineAudioContext === 'function' && typeof AudioBuffer === 'function'),
    'This browser build cannot verify native audio previews.');
  await page.evaluate(async ({ synth, beat }) => {
    const [{ default: app }, { default: editor }] = await Promise.all([
      import(new URL('js/appState.js', document.baseURI)),
      import(new URL('js/soundSettingsModal.js', document.baseURI)),
    ]);
    window.abApp = app;
    window.abEditor = editor;
    const context = app.getAudioContext();
    if (context) {
      // Explicit two-second sample fixture makes native preview lifetime observable.
      const sample = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      const data = sample.getChannelData(0);
      for (let index = 0; index < data.length; index++) data[index] = 0.2 * Math.sin(index * 2 * Math.PI * 220 / context.sampleRate);
      app.setSoundBuffer('Click1.mp3', sample);
    }
    app.setVolume(0.2);
    const sound = synth ? 'Synth Kick' : 'Click1.mp3';
    const settings = { ...app.getDefaultSoundSettings(sound), pitchShift: 0, volume: 0.5,
      ...(synth ? { release: 1.5 } : { trimStart: 0, trimEnd: 2 }) };
    if (beat) {
      app.setBeatSound(0, 0, 0, 'mainBeatSound', { sound, settings });
      editor.show(0, 'mainBeatSound', { barIndex: 0, beatIndex: 0 });
    } else {
      app.updateTrack(0, { volume: 0.5, mainBeatSound: { sound, settings } });
      editor.show(0, 'mainBeatSound');
    }
  }, { synth, beat });
  await expect(page.locator('#sound-settings-modal')).toBeVisible();
}

test('A/B auditions original and edited sample pitch without reverting the musical state', async ({ page }) => {
  await openEditor(page);
  await expect(page.locator('#sound-preview-original')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#sound-preview-edited')).toHaveAttribute('aria-pressed', 'true');
  const result = await page.evaluate(async () => {
    const editor = window.abEditor;
    editor.updateSoundSetting('pitchShift', 12);
    const before = JSON.stringify(await window.abApp.getCurrentStateForPreset(true));
    document.querySelector('#sound-preview-original').click();
    await editor.togglePreview();
    const originalRate = editor.previewSource?.playbackRate.value;
    const outputGain = editor.previewOutputNode?.gain.value;
    await new Promise(resolve => setTimeout(resolve, 80));
    const signal = new Float32Array(editor.previewAnalyserNode.fftSize);
    editor.previewAnalyserNode.getFloatTimeDomainData(signal);
    const signalPeak = signal.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0);
    const oldSource = editor.previewSource;
    const oldEnded = oldSource?.onended;
    await editor.selectPreviewVersion('edited');
    const editedSource = editor.previewSource;
    const editedRate = editedSource?.playbackRate.value;
    oldEnded?.();
    const staleEndIgnored = editor.previewSource === editedSource;
    const after = JSON.stringify(await window.abApp.getCurrentStateForPreset(true));
    editor.stopPreview();
    return { originalRate, editedRate, outputGain, signalPeak, staleEndIgnored, unchanged: before === after,
      cleared: !editor.previewSource && !editor.previewAnalyserNode && !editor.previewOutputNode };
  });
  expect(result.originalRate).toBe(1);
  expect(result.editedRate).toBe(2);
  expect(result.outputGain).toBeCloseTo(0.1, 5);
  expect(result.signalPeak).toBeGreaterThan(0.001);
  expect(result.unchanged).toBe(true);
  expect(result.staleEndIgnored).toBe(true);
  expect(result.cleared).toBe(true);
});

test('beat-specific A/B previews use the beat sound rather than the track sound', async ({ page }) => {
  await openEditor(page, { beat: true });
  const result = await page.evaluate(async () => {
    const main = JSON.stringify(window.abApp.getTracks()[0].mainBeatSound);
    window.abEditor.updateSoundSetting('pitchShift', 12);
    await window.abEditor.togglePreview();
    const source = window.abEditor.previewSource;
    const editedRate = source?.playbackRate.value;
    const usesSample = source?.buffer === window.abApp.getSoundBuffer('Click1.mp3');
    await window.abEditor.selectPreviewVersion('original');
    const originalRate = window.abEditor.previewSource?.playbackRate.value;
    window.abEditor.stopPreview();
    return { editedRate, originalRate, usesSample, mainUnchanged: JSON.stringify(window.abApp.getTracks()[0].mainBeatSound) === main };
  });
  expect(result).toEqual({ editedRate: 2, originalRate: 1, usesSample: true, mainUnchanged: true });
});

test('Original survives Reset within an editor session and refreshes after close', async ({ page }) => {
  await openEditor(page);
  const result = await page.evaluate(async () => {
    const editor = window.abEditor;
    editor.hide();
    window.abApp.getTracks()[0].mainBeatSound.settings.pitchShift = 3;
    editor.show(0, 'mainBeatSound');
    editor.updateSoundSetting('pitchShift', 12);
    editor.resetSoundSettings();
    await editor.selectPreviewVersion('original');
    await editor.togglePreview();
    const openingRate = editor.previewSource?.playbackRate.value;
    editor.hide();
    const releasedSnapshot = editor.originalPreviewSound === null && editor.originalPreviewBuffer === null;
    editor.show(0, 'mainBeatSound');
    await editor.selectPreviewVersion('original');
    await editor.togglePreview();
    const reopenedRate = editor.previewSource?.playbackRate.value;
    editor.stopPreview();
    return { openingRate, reopenedRate, releasedSnapshot };
  });
  expect(result.openingRate).toBeCloseTo(Math.pow(2, 3 / 12));
  expect(result.reopenedRate).toBe(1);
  expect(result.releasedSnapshot).toBe(true);
});

test('closing during an offline render cannot start audio afterward', async ({ page }) => {
  await openEditor(page, { synth: true });
  await page.locator('#sound-preview-original').click();
  const result = await page.evaluate(async () => {
    await window.abApp.getAudioContext().resume();
    const originalRender = OfflineAudioContext.prototype.startRendering;
    const originalStart = AudioBufferSourceNode.prototype.start;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let started = 0;
    OfflineAudioContext.prototype.startRendering = function () {
      return originalRender.call(this).then(async buffer => { await gate; return buffer; });
    };
    AudioBufferSourceNode.prototype.start = function (...args) { started++; return originalStart.apply(this, args); };
    try {
      const pending = window.abEditor.togglePreview();
      const wasPending = window.abEditor.previewPending;
      window.abEditor.hide();
      release();
      await pending;
      return { wasPending, started, cleared: !window.abEditor.previewSource && !window.abEditor.previewPending && !window.abEditor.previewOutputNode };
    } finally {
      release();
      OfflineAudioContext.prototype.startRendering = originalRender;
      AudioBufferSourceNode.prototype.start = originalStart;
    }
  });
  expect(result).toEqual({ wasPending: true, started: 0, cleared: true });
});

test('switching A/B during a render ignores the stale edited result', async ({ page }) => {
  await openEditor(page, { synth: true });
  await page.locator('#sound-preview-edited').click();
  const result = await page.evaluate(async () => {
    const editor = window.abEditor;
    editor.updateSoundSetting('pitchShift', 12);
    await window.abApp.getAudioContext().resume();
    const original = OfflineAudioContext.prototype.startRendering;
    let release;
    let renderCount = 0;
    const gate = new Promise(resolve => { release = resolve; });
    OfflineAudioContext.prototype.startRendering = function () {
      const rendered = original.call(this);
      return ++renderCount === 1 ? rendered.then(async buffer => { await gate; return buffer; }) : rendered;
    };
    try {
      const edited = editor.togglePreview();
      await editor.selectPreviewVersion('original');
      const originalSource = editor.previewSource;
      release();
      await edited;
      return { hasOriginal: Boolean(originalSource), current: editor.previewSource === originalSource, version: editor.previewVersion };
    } finally {
      release();
      OfflineAudioContext.prototype.startRendering = original;
      editor.stopPreview();
    }
  });
  expect(result).toEqual({ hasOriginal: true, current: true, version: 'original' });
});

test('client audition and detail preferences never publish or replace shared room state', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext({ serviceWorkers: 'block' }), browser.newContext({ serviceWorkers: 'block' })]);
  try {
    const [host, client] = await Promise.all(contexts.map(context => context.newPage()));
    const errors = [];
    for (const page of [host, client]) page.on('pageerror', error => errors.push(error.message));
    await host.goto('./');
    await expect(host.locator('#share-btn')).toHaveClass(/connected/);
    await client.goto(host.url());
    await expect(client.locator('#share-btn')).toHaveClass(/connected/);
    await client.locator('#dismiss-connection-modal-btn').click();
    const before = await host.evaluate(async () => {
      const { default: app } = await import(new URL('js/appState.js', document.baseURI));
      return JSON.stringify(await app.getCurrentStateForPreset(true));
    });
    const result = await client.evaluate(async () => {
      const [{ default: app }, { default: editor }] = await Promise.all([
        import(new URL('js/appState.js', document.baseURI)), import(new URL('js/soundSettingsModal.js', document.baseURI)),
      ]);
      const before = JSON.stringify(await app.getCurrentStateForPreset(true));
      const send = WebSocket.prototype.send;
      const sharedWrites = [];
      WebSocket.prototype.send = function (data) {
        const type = JSON.parse(data).type;
        if (['state', 'state-request', 'transport-command'].includes(type)) sharedWrites.push(type);
        return send.call(this, data);
      };
      try {
        editor.show(0, 'mainBeatSound');
        await editor.selectPreviewVersion('original');
        await editor.togglePreview();
        const started = Boolean(editor.previewSource);
        await editor.selectPreviewVersion('edited');
        document.querySelector('#sound-advanced-toggle').click();
        editor.hide();
        return { isClient: window.isHost === false, unchanged: before === JSON.stringify(await app.getCurrentStateForPreset(true)),
          sharedWrites, started, audioAvailable: Boolean(app.getAudioContext()) };
      } finally {
        WebSocket.prototype.send = send;
      }
    });
    expect(result.isClient).toBe(true);
    expect(result.unchanged).toBe(true);
    expect(result.sharedWrites).toEqual([]);
    expect(result.started).toBe(result.audioAvailable);
    const after = await host.evaluate(async () => {
      const { default: app } = await import(new URL('js/appState.js', document.baseURI));
      return JSON.stringify(await app.getCurrentStateForPreset(true));
    });
    expect(after).toBe(before);
    expect(await host.evaluate(() => localStorage.getItem('metronominal.soundEditorDetail'))).toBeNull();
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});

for (const width of [320, 390]) {
  test(`A/B controls are named, unclipped and reachable in Synthwave at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 700 });
    await openEditor(page, { native: false });
    await page.evaluate(async () => {
      const { default: theme } = await import(new URL('js/themeController.js', document.baseURI));
      theme.applyTheme('synthwave');
      await document.fonts.ready;
    });
    await page.locator('#sound-preview-original').scrollIntoViewIfNeeded();
    for (const id of ['sound-preview-original', 'sound-preview-edited']) {
      const button = page.locator(`#${id}`);
      await expect(button).toBeInViewport();
      const geometry = await button.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return { left: rect.left, right: rect.right, width: innerWidth, clipped: element.scrollWidth > element.clientWidth + 1,
          hit: hit?.closest('button') === element };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(geometry.width);
      expect(geometry.clipped).toBe(false);
      expect(geometry.hit).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath(`sound-editor-ab-${width}.png`) });
    await page.locator('#sound-preview-original').focus();
    await page.keyboard.press('Space');
    await expect(page.locator('#sound-preview-original')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#sound-preview-edited')).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Escape');
    await expect(page.locator('#sound-settings-modal')).toBeHidden();
  });
}

test('a cached older HTML shell remains usable with the newer editor module', async ({ page }) => {
  await page.route('**/script.js', route => route.abort());
  await page.goto('./');
  await page.evaluate(async () => {
    for (const id of ['sound-preview-original', 'sound-preview-edited', 'sound-advanced-toggle']) document.getElementById(id).remove();
    localStorage.setItem('metronominal.soundEditorDetail', 'basic');
    const [{ default: app }, { default: editor }] = await Promise.all([
      import(new URL('js/appState.js', document.baseURI)), import(new URL('js/soundSettingsModal.js', document.baseURI)),
    ]);
    app.initializeAudioContext();
    if (!app.getTracks().length) app.addTrack();
    editor.init();
    editor.show(0, 'mainBeatSound');
  });
  await expect(page.locator('#sound-settings-modal')).toBeVisible();
  await expect(page.locator('#sound-preview-btn')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#sound-settings-modal [data-param="pitchEnvelopeTime"]')).toBeVisible();
});

test('Basic controls hide complexity without discarding settings and persist locally', async ({ page }) => {
  await openEditor(page, { synth: true, native: false });
  const toggle = page.locator('#sound-advanced-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.evaluate(() => window.abEditor.updateSoundSetting('pitchEnvelopeTime', 700));
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#sound-settings-modal [data-param="pitchEnvelopeTime"]')).toBeHidden();
  await expect(page.locator('#sample-probability')).toBeHidden();
  await expect(page.locator('#sound-settings-modal [data-param="highPassFrequency"]')).toBeVisible();
  await expect(page.locator('#sound-settings-modal [data-param="volume"]')).toBeVisible();
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#sound-settings-modal [data-param="pitchEnvelopeTime"]')).toHaveValue('700');
  await toggle.click();
  await page.evaluate(() => window.abEditor.hide());
  await page.reload();
  await expect(page.locator('#share-btn')).toHaveClass(/connected/);
  await page.locator('.main-sound-label').first().click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#sound-settings-modal [data-param="pitchEnvelopeTime"]')).toBeHidden();
});
