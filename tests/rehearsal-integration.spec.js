const { test, expect } = require('@playwright/test');

for (const width of [320, 390, 1440]) {
  test(`all rehearsal features mount without startup errors or overflow at ${width}px`, async ({ page }) => {
    const errors = [], failedAssets = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', response => {
      if (response.status() >= 400 && /rehearsal|edit-history|adaptive-visualization|editHistory/.test(response.url())) failedAssets.push(response.url());
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto('./');
    await expect(page.locator('#share-btn')).toHaveClass(/(?:^|\s)connected(?:\s|$)/);
    await expect(page.locator('#rehearsal-tools-status')).not.toContainText('Preparing');
    await expect(page.locator('#rehearsal-tools-status')).not.toContainText('Unavailable:');
    await page.locator('#rehearsal-tools-panel > summary').click();
    for (const feature of ['room', 'history', 'library', 'visual']) {
      const mount = page.locator(`#rehearsal-${feature}-root`);
      await expect(mount).toBeVisible();
      expect(await mount.locator('button,input,select,details,[role="status"]').count()).toBeGreaterThan(0);
    }
    const geometry = await page.evaluate(() => ({
      viewport: window.innerWidth,
      scroll: document.documentElement.scrollWidth,
      escaped: [...document.querySelectorAll('#rehearsal-tools button,#rehearsal-tools input,#rehearsal-tools select')]
        .filter(el => el.getClientRects().length)
        .map(el => el.getBoundingClientRect())
        .filter(rect => rect.left < -1 || rect.right > window.innerWidth + 1).length
    }));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.escaped).toBe(0);
    expect(failedAssets).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('opening rehearsal tools never alters a playing arrangement or device listening mix', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  await expect(page.locator('#share-btn')).toHaveClass(/(?:^|\s)connected(?:\s|$)/);
  await page.locator('#start-stop-btn').click();
  await expect.poll(() => page.evaluate(async () => (await import(new URL('js/appState.js', document.baseURI))).default.isPlaying())).toBe(true);
  const before = await page.evaluate(async () => {
    const { default: state } = await import(new URL('js/appState.js', document.baseURI));
    const { default: monitoring } = await import(new URL('js/monitoring.js', document.baseURI));
    const snapshot = await state.getCurrentStateForPreset(true);
    // Compare musical data, not counters that must advance while playback runs.
    snapshot.Tracks = snapshot.Tracks.map(({ currentBar, currentBeat, nextBeatTime, songRepeatIteration, ...music }) => music);
    return { snapshot, mix: monitoring.getState(), audio: state.getAudioContext()?.state };
  });
  await page.locator('#rehearsal-tools-panel > summary').click();
  const after = await page.evaluate(async () => {
    const { default: state } = await import(new URL('js/appState.js', document.baseURI));
    const { default: monitoring } = await import(new URL('js/monitoring.js', document.baseURI));
    const snapshot = await state.getCurrentStateForPreset(true);
    snapshot.Tracks = snapshot.Tracks.map(({ currentBar, currentBeat, nextBeatTime, songRepeatIteration, ...music }) => music);
    return { snapshot, mix: monitoring.getState(), audio: state.getAudioContext()?.state, playing: state.isPlaying() };
  });
  expect(after).toEqual({ ...before, playing: true });
  await page.locator('#start-stop-btn').click();
  expect(errors).toEqual([]);
});

test('opening rehearsal tools keeps native audio running', async ({ page, browserName }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  test.skip(browserName === 'webkit' && process.platform === 'win32' && !(await page.evaluate(() => typeof AudioContext === 'function')), 'This Windows WebKit build lacks native Web Audio. Actual running-audio proof requires a supported browser or real iOS device.');
  await expect(page.locator('#share-btn')).toHaveClass(/(?:^|\s)connected(?:\s|$)/);
  await page.locator('#start-stop-btn').click();
  const audioState = () => page.evaluate(async () => (await import(new URL('js/appState.js', document.baseURI))).default.getAudioContext()?.state);
  await expect.poll(audioState).toBe('running');
  await page.locator('#rehearsal-tools-panel > summary').click();
  await expect.poll(audioState).toBe('running');
  await page.locator('#start-stop-btn').click();
  expect(errors).toEqual([]);
});
