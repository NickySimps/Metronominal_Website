const { test, expect } = require('@playwright/test');

const errors = new WeakMap();
test.beforeEach(({ page }) => { const list = []; errors.set(page, list); page.on('pageerror', error => list.push(error.message)); });
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));
async function ready(page, url = '/') {
  // Windows WebKit rejects this CDN's certificate chain; API fetch retains TLS
  // verification and fulfills the genuine module (never a stub or insecure mode).
  if (process.platform === 'win32' && page.context().browser().browserType().name() === 'webkit') {
    await page.route('https://cdn.jsdelivr.net/npm/three/**', async route => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.fulfill({ response });
    });
  }
  await page.addInitScript(signalURL => {
    const Native = window.WebSocket;
    window.WebSocket = class extends Native { constructor(url, protocols) { super(String(url).replace(/(?:wss?:\/\/)[^/]+/, signalURL), protocols); } };
  }, process.env.RANGE_SIGNAL_URL || 'ws://127.0.0.1:10000');
  await page.goto(url);
  await expect(page.locator('#share-btn')).toHaveClass(/connected/);
  await expect(page.locator('#rehearsal-range-root .range-editor')).toHaveCount(1);
  const dismiss = page.locator('#dismiss-connection-modal-btn'); if (await dismiss.isVisible()) await dismiss.click();
  await page.locator('#rehearsal-tools-panel > summary').click();
  await page.evaluate(async () => {
    window.app = (await import('/js/appState.js')).default;
    const root = document.getElementById('rehearsal-range-root') || document.createElement('section');
    if (!root.isConnected) { root.id = 'range-test-root'; document.body.append(root); }
    const { initializeRangeEditor } = await import('/js/rangeEditor.js');
    const display = (await import('/js/barDisplayController.js')).default;
    window.range = initializeRangeEditor(root, { refreshUI: () => display.renderBarsAndControls(-1) });
    window.historyControls = (await import('/js/editHistory.js')).initializeHistoryControls(root);
  });
}

async function twoTracks(page) {
  // Acquire a strong module handle before rendering. Chromium can collect the
  // protocol's async evaluation result during render allocations even after the
  // function completed; keep mutation/render synchronous, not a retry.
  const controller = await page.evaluateHandle(() => import('/js/tracksController.js').then(module => module.default));
  try {
  await page.evaluate(controller => {
    app.addTrack();
    const source = { beats: 3, subdivision: 1, rests: [1], velocities: { 0: .2, 1: .6, 2: 1 }, beatSlices: { 1: 2 }, beatSliceAnchors: { 1: 1 }, beatSounds: { 1: { mainBeatSound: { sound: 'Synth Kick', settings: { volume: .4, privateRecording: 'NEVER', localAudioBuffer: {} } } } } };
    app.updateTrack(0, { barSettings: [source, { beats: 2, subdivision: 1, rests: [1] }] });
    app.updateTrack(1, { name: 'Destination', swing: 21, barSettings: [{ beats: 4, subdivision: 1, rests: [3], velocities: { 3: .25 } }, { beats: 5, subdivision: 1, rests: [4] }] });
    controller.renderTracks();
    historyControls.clear();
  }, controller);
  } finally { await controller.dispose(); }
}

test('cross-track beat paste keeps logical overrides with slice timing and unrelated settings in one undo', async ({ page }) => {
  await ready(page); await twoTracks(page);
  const before = await snapshot(page);
  await page.getByLabel('End beat', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Copy range', exact: true }).click();
  await page.getByLabel('Destination track', { exact: true }).fill('2');
  await page.getByLabel('Operation', { exact: true }).selectOption('paste');
  await page.getByRole('button', { name: 'Preview range', exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
  await page.getByRole('button', { name: 'Apply range', exact: true }).click();
  const result = await page.evaluate(() => ({ bar: app.getTracks()[1].barSettings[0], next: app.getTracks()[1].barSettings[1], swing: app.getTracks()[1].swing }));
  expect(result.bar.rests).toEqual([1, 3]);
  expect(result.bar.velocities).toEqual({ 0: .2, 1: .6, 2: 1, 3: .25 });
  expect(result.bar.beatSlices).toEqual({ 1: 2 });
  expect(result.bar.beatSliceAnchors).toEqual({ 1: 1 });
  expect(result.bar.beatSounds[1].mainBeatSound.sound).toBe('Synth Kick');
  await expect(page.locator('.bar-visual[data-container-index="1"][data-bar-index="0"] .beat-square[data-beat-index="3"]')).toHaveClass(/rested/);
  expect(JSON.stringify(result.bar)).not.toMatch(/NEVER|privateRecording|localAudioBuffer/);
  expect(result.next).toEqual(before.Tracks[1].barSettings[1]); expect(result.swing).toBe(21);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

test('rest accent slice fills and clears affect logical groups and rotation preserves their overrides across unequal bars', async ({ page }) => {
  await ready(page); await twoTracks(page);
  await page.getByLabel('End bar', { exact: true }).fill('2');
  await page.getByLabel('End beat', { exact: true }).fill('2');
  const original = await snapshot(page);
  for (const operation of ['fill-rests', 'clear-rests', 'fill-accents', 'clear-accents', 'fill-slices', 'clear-slices', 'rotate']) {
    await page.getByLabel('Operation', { exact: true }).selectOption(operation, { timeout: 3000 });
    await page.getByRole('button', { name: 'Preview range', exact: true }).click();
    expect(await snapshot(page)).toEqual(original);
    await page.getByRole('button', { name: 'Apply range', exact: true }).click();
    const bars = await page.evaluate(() => app.getTracks()[0].barSettings);
    if (operation === 'fill-rests') expect(bars[0].rests).toEqual([0, 1, 2]);
    if (operation === 'clear-rests') expect(bars.every(bar => bar.rests.length === 0)).toBe(true);
    if (operation === 'fill-accents') expect(bars[0].velocities).toEqual({ 0: 1, 1: 1, 2: 1 });
    if (operation === 'clear-accents') expect(bars.every(bar => Object.keys(bar.velocities).length === 0)).toBe(true);
    if (operation === 'fill-slices') expect(bars[0].beatSlices).toEqual({ 0: 2, 1: 2, 2: 2 });
    if (operation === 'clear-slices') expect(bars.every(bar => !Object.keys(bar.beatSlices || {}).length)).toBe(true);
    if (operation === 'rotate') {
      expect(bars[0].beatSlices).toEqual({ 2: 2 }); expect(bars[0].rests).toEqual([0, 2]); expect(bars[1].rests).toEqual([]);
      expect(bars[0].velocities).toEqual({ 1: .2, 2: .6 }); expect(bars[1].velocities).toEqual({ 0: 1 });
      expect(bars[0].beatSounds[2]).toEqual(original.Tracks[0].barSettings[0].beatSounds[1]);
    }
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect(await snapshot(page)).toEqual(original);
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  }
});

test('tap picking captures actual beats before legacy rest paint and invalidates on DOM and authority boundaries', async ({ page }) => {
  await ready(page);
  await page.locator('.rest-button').first().click();
  const before = await snapshot(page);
  await page.getByRole('button', { name: 'Pick range on beats', exact: true }).click({ timeout: 3000 });
  await expect(page.locator('#all-tracks-wrapper')).toHaveAttribute('data-range-selection', 'beats');
  const beat = index => page.locator(`.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square[data-beat-index="${index}"]`);
  await beat(1).click(); await beat(3).click();
  await expect(page.getByLabel('Start beat', { exact: true })).toHaveValue('2');
  await expect(page.getByLabel('End beat', { exact: true })).toHaveValue('4');
  expect(await snapshot(page)).toEqual(before);
  await expect(page.locator('[data-range-source]')).toHaveCount(3);
  await page.getByRole('button', { name: 'Preview range', exact: true }).click();
  await beat(2).evaluate(el => el.replaceWith(el.cloneNode(true)));
  await expect(page.getByRole('button', { name: 'Apply range', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Preview range', exact: true }).click();
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('syncrolechange', { detail: { state: 'connected', isHost: false } })));
  await expect(page.getByRole('button', { name: 'Apply range', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => range.apply())).toBe(false);
  expect(await snapshot(page)).toEqual(before);
});

test('whole-bar copy replaces bounded bars with unequal meter, rejects overflowing paste and stale previews', async ({ page }) => {
  await ready(page); await twoTracks(page);
  await page.getByLabel('Range unit', { exact: true }).selectOption('bars');
  await page.getByLabel('End bar', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Copy range', exact: true }).click();
  await page.getByLabel('Destination track', { exact: true }).fill('2');
  await page.getByLabel('Destination bar', { exact: true }).fill('2');
  await page.getByLabel('Operation', { exact: true }).selectOption('paste');
  const original = await snapshot(page);
  await page.getByRole('button', { name: 'Preview range', exact: true }).click();
  await expect(page.locator('[data-range-status]')).toContainText('too few bars');
  await expect(page.getByRole('button', { name: 'Apply range', exact: true })).toBeDisabled();
  expect(await snapshot(page)).toEqual(original);
  await page.getByLabel('Destination bar', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Preview range', exact: true }).click();
  await page.getByRole('button', { name: 'Apply range', exact: true }).click();
  expect(await page.evaluate(() => app.getTracks()[1].barSettings.map(b => b.beats))).toEqual([3, 2]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await snapshot(page)).toEqual(original);
  for (const event of ['roomauthoritychange', 'historyboundary', 'playbackstatechange']) {
    await page.getByRole('button', { name: 'Preview range', exact: true }).click();
    await page.evaluate(type => document.dispatchEvent(new CustomEvent(type)), event);
    await expect(page.getByRole('button', { name: 'Apply range', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => range.apply())).toBe(false);
  }
});

test('range panel fits 320 portrait and three columns at 844 landscape with 44px targets', async ({ page }, info) => {
  await ready(page);
  for (const viewport of [{width:320,height:700}, {width:844,height:390}]) {
    await page.setViewportSize(viewport);
    const result = await page.locator('.range-editor').evaluate(el => ({
      columns: getComputedStyle(el.querySelector('.range-editor-grid')).gridTemplateColumns.split(' ').length,
      outside: [...el.querySelectorAll('input,select,button')].some(item => { const r=item.getBoundingClientRect(); return r.width < 44 || r.height < 44 || r.left < 0 || r.right > innerWidth; }),
    }));
    expect(result.outside).toBe(false); expect(result.columns).toBe(viewport.width === 320 ? 1 : 3);
    await page.locator('.range-editor').screenshot({ path: info.outputPath(`range-${viewport.width}x${viewport.height}.png`) });
  }
});

test('real room participant cannot edit, host Apply shares once, playback fences the next preview', async ({ page, browser }) => {
  await ready(page);
  const context = await browser.newContext({ serviceWorkers: 'block' }), client = await context.newPage();
  try {
    await ready(client, page.url());
    await expect.poll(() => client.evaluate(() => window.isHost)).toBe(false);
    await expect(client.getByRole('button', { name: 'Preview range', exact: true })).toBeDisabled();
    const before = await snapshot(client);
    expect(await client.evaluate(() => range.apply())).toBe(false);
    expect(await snapshot(client)).toEqual(before);
    await page.getByLabel('End beat', { exact: true }).fill('3');
    await page.getByRole('button', { name: 'Preview range', exact: true }).click();
    await page.getByRole('button', { name: 'Apply range', exact: true }).click();
    await expect.poll(() => client.evaluate(() => app.getTracks()[0].barSettings[0].rests)).toEqual([0, 1, 2]);
    await page.getByLabel('Operation', { exact: true }).selectOption('clear-rests');
    await page.getByRole('button', { name: 'Preview range', exact: true }).click();
    await page.locator('#start-stop-btn').click();
    await expect.poll(() => page.evaluate(() => app.isPlaying())).toBe(true);
    await expect(page.getByRole('button', { name: 'Apply range', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => range.apply())).toBe(false);
    await page.locator('#start-stop-btn').click();
  } finally { await context.close(); }
});

test('numeric endpoints and paste capacity reject invalid input instead of truncating; huge slice fill is bounded', async ({ page }) => {
  await ready(page);
  await page.getByLabel('End beat', { exact: true }).fill('999');
  const original = await snapshot(page);
  await page.getByRole('button', { name: 'Preview range', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply range', exact: true })).toBeDisabled();
  expect(await snapshot(page)).toEqual(original);
  await page.evaluate(async () => {
    app.updateTrack(0, { barSettings: [{ beats: 32, subdivision: 16, rests: [] }] });
    (await import('/js/tracksController.js')).default.renderTracks(); historyControls.clear();
  });
  await page.getByLabel('End beat', { exact: true }).fill('512');
  await page.getByLabel('Operation', { exact: true }).selectOption('fill-slices');
  await page.getByLabel('Slice count', { exact: true }).selectOption('32');
  await page.getByRole('button', { name: 'Preview range', exact: true }).click();
  await expect(page.locator('[data-range-status]')).toContainText('512');
  await expect(page.getByRole('button', { name: 'Apply range', exact: true })).toBeDisabled();
});

test('synchronous beat reindex expires a preview before observer delivery', async ({ page }) => {
  await ready(page);
  const before = await snapshot(page);
  await page.getByRole('button', { name: 'Preview range', exact: true }).click();
  const applied = await page.evaluate(() => {
    document.querySelector('.beat-square[data-beat-index="0"]').dataset.beatIndex = '99';
    return range.apply();
  });
  expect(applied).toBe(false);
  expect(await snapshot(page)).toEqual(before);
});

test('range editor yields Escape already handled by another dialog', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Preview range', exact: true }).click();
  await page.evaluate(() => {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    event.preventDefault(); document.dispatchEvent(event);
  });
  await expect(page.getByRole('button', { name: 'Apply range', exact: true })).toBeEnabled();
});

test('native touch selects a reversed whole-bar range without legacy paint', async ({ browser, browserName, baseURL }) => {
  const context = await browser.newContext({ baseURL, hasTouch: true, isMobile: browserName !== 'firefox', viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
  try {
    await ready(page); await twoTracks(page);
    await page.locator('.rest-button').first().click();
    const before = await snapshot(page);
    await page.getByLabel('Range unit', { exact: true }).selectOption('bars');
    await page.getByRole('button', { name: 'Pick range on beats', exact: true }).tap();
    await expect(page.locator('#all-tracks-wrapper')).toHaveAttribute('data-range-selection', 'bars');
    await page.locator('.bar-visual[data-container-index="0"][data-bar-index="1"] .beat-square[data-beat-index="1"]').tap();
    await page.locator('.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square[data-beat-index="0"]').tap();
    await expect(page.getByLabel('Start bar', { exact: true })).toHaveValue('1');
    await expect(page.getByLabel('End bar', { exact: true })).toHaveValue('2');
    await expect(page.locator('#all-tracks-wrapper')).not.toHaveAttribute('data-range-selection');
    expect(await snapshot(page)).toEqual(before);
    expect(pageErrors).toEqual([]);
  } finally { await context.close(); }
});

test('explicit range picking keeps native touch pan and does not select a drag', async ({ browser, browserName, baseURL }) => {
  test.skip(browserName !== 'chromium', 'CDP native touch scrolling requires Chromium');
  const context = await browser.newContext({ baseURL, hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  try {
    await ready(page);
    await page.locator('.rest-button').first().click();
    await page.getByRole('button', { name: 'Pick range on beats', exact: true }).tap();
    await page.evaluate(() => { document.body.style.minHeight = '6000px'; document.querySelector('.bar-visual').style.minHeight = '350px'; });
    const beat = page.locator('.beat-square[data-beat-index="1"]').first();
    await beat.scrollIntoViewIfNeeded();
    const before = await snapshot(page), startScroll = await page.evaluate(() => scrollY);
    const box = await beat.boundingBox(), client = await context.newCDPSession(page);
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 8; step++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - step * 12 }] });
      await page.waitForTimeout(20);
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(startScroll + 20);
    await expect(page.getByLabel('Start beat', { exact: true })).toHaveValue('1');
    await expect(page.locator('#all-tracks-wrapper')).toHaveAttribute('data-range-selection', 'beats');
    expect(await snapshot(page)).toEqual(before);
  } finally { await context.close(); }
});

test('range controls and keyboard focus follow the application theme tokens', async ({ page }) => {
  await ready(page);
  const button = page.getByRole('button', { name: 'Preview range', exact: true });
  await page.locator('.range-editor').evaluate(el => { el.style.setProperty('--Background', '#102030'); el.style.setProperty('--ReadableOnBackground', '#f0f4f8'); el.style.setProperty('--Accent', '#1375c9'); });
  await page.keyboard.press('Tab');
  await button.focus();
  await expect(button).toHaveCSS('background-color', 'rgb(16, 32, 48)');
  await expect(button).toHaveCSS('color', 'rgb(240, 244, 248)');
  await expect(button).toHaveCSS('outline-color', 'rgb(19, 117, 201)');
});

test('range undo preserves registered native recording buffers and reconstructs live analysers', async ({ page, browserName }) => {
  await ready(page); await twoTracks(page);
  const native = await page.evaluate(() => typeof AudioBuffer === 'function' && typeof AnalyserNode === 'function');
  test.skip(browserName === 'webkit' && process.platform === 'win32' && !native, 'This Windows WebKit build lacks native Web Audio; buffer/analyser evidence requires a supported browser or real iOS device.');
  expect(native).toBe(true);
  await page.evaluate(() => {
    window.nativeBuffer = app.getAudioContext().createBuffer(1, 128, 44100);
    app.addRecording('Range private recording'); app.setSoundBuffer('Range private recording', nativeBuffer);
    window.oldAnalyser = app.getTracks()[1].analyserNode;
  });
  const before = await snapshot(page);
  await page.getByLabel('End beat', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Copy range', exact: true }).click();
  await page.getByLabel('Destination track', { exact: true }).fill('2');
  await page.getByLabel('Operation', { exact: true }).selectOption('paste');
  await page.getByRole('button', { name: 'Preview range', exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
  await page.getByRole('button', { name: 'Apply range', exact: true }).click();
  expect(await page.evaluate(() => app.getSoundBuffer('Range private recording') === nativeBuffer)).toBe(true);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
  expect(await page.evaluate(() => app.getSoundBuffer('Range private recording') === nativeBuffer)).toBe(true);
  expect(await page.evaluate(() => app.getTracks()[1].analyserNode instanceof AnalyserNode && app.getTracks()[1].analyserNode !== oldAnalyser)).toBe(true);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

test('real dark theme range selectors retain readable background foreground pairs', async ({ page }, info) => {
  await ready(page);
  await page.evaluate(async () => (await import('/js/themeController.js')).default.applyTheme('dark'));
  for (const control of await page.locator('.range-editor input,.range-editor select,.range-editor button').all()) {
    if (await control.isDisabled()) continue;
    await expect(control).toHaveCSS('background-color', 'rgb(12, 12, 14)');
    await expect(control).toHaveCSS('color', 'rgb(255, 255, 255)');
  }
  await page.locator('.range-editor').screenshot({ path: info.outputPath('range-dark.png') });
});

test('native range selects contain the themed text line at constrained landscape', async ({ page }) => {
  await ready(page); await page.setViewportSize({ width: 844, height: 390 });
  const clipped = await page.locator('.range-editor select').evaluateAll(elements => elements.flatMap(el => {
    const css = getComputedStyle(el), line = css.lineHeight === 'normal' ? parseFloat(css.fontSize) * 1.2 : parseFloat(css.lineHeight);
    const available = el.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom);
    return available + 1 < line ? [{ name: el.getAttribute('aria-label'), available, line }] : [];
  }));
  expect(clipped).toEqual([]);
});

test('range selects use authored theme surfaces instead of native light chrome', async ({ page }) => {
  await ready(page);
  await page.evaluate(async () => (await import('/js/themeController.js')).default.applyTheme('dark'));
  await expect(page.getByLabel('Range unit', { exact: true })).toHaveCSS('appearance', 'none');
  await expect(page.getByLabel('Range unit', { exact: true }).locator('option').first()).toHaveCSS('background-color', 'rgb(12, 12, 14)');
  await expect(page.getByLabel('Range unit', { exact: true }).locator('option').first()).toHaveCSS('color', 'rgb(255, 255, 255)');
});

test('R1 slicing the first beat preserves later logical rest ghost and sound identities through ordinary action and undo', async ({ page }) => {
  await ready(page);
  await page.evaluate(async () => {
    app.updateTrack(0, { barSettings: [{ beats: 4, subdivision: 1, rests: [1], velocities: { 2: .3 }, beatSounds: { 3: { mainBeatSound: { sound: 'Synth Sine', settings: { frequency: 880 } } } } }] });
    (await import('/js/tracksController.js')).default.renderTracks(); historyControls.clear();
  });
  const before = await snapshot(page);
  const beat = index => page.locator(`.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square[data-beat-index="${index}"]`);
  const bar = () => page.evaluate(() => app.getTracks()[0].barSettings[0]);
  await expect(beat(1)).toHaveClass(/rested/);
  await expect(beat(2)).toHaveClass(/ghost-note/);
  // Entry animation expires independently of the musical/sound identity.
  const semanticClasses = locator => locator.evaluate(element => [...element.classList].filter(name => name !== 'newly-added-beat-animation'));
  const soundClasses = await semanticClasses(beat(3));
  await page.getByLabel('Operation', { exact: true }).selectOption('fill-slices');
  await page.getByRole('button', { name: 'Preview range', exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
  await page.getByRole('button', { name: 'Apply range', exact: true }).click();
  expect(await bar()).toEqual({ ...before.Tracks[0].barSettings[0], beatSlices: { 0: 2 }, beatSliceAnchors: { 0: 0 } });
  await expect(beat(1)).toHaveClass(/rested/);
  await expect(beat(2)).toHaveClass(/ghost-note/);
  await expect(beat(3)).not.toHaveClass(/newly-added-beat-animation/);
  expect(await semanticClasses(beat(3))).toEqual(soundClasses);
  const sliced = await snapshot(page);
  await page.locator('.rest-button').first().click();
  await beat(1).click();
  expect((await bar()).rests).toEqual([]);
  expect((await bar()).velocities).toEqual({ 2: .3 });
  expect((await bar()).beatSounds).toEqual(before.Tracks[0].barSettings[0].beatSounds);
  await expect(beat(1)).not.toHaveClass(/rested/);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await snapshot(page)).toEqual(sliced);
  await expect(beat(1)).toHaveClass(/rested/);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
  await expect(beat(2)).toHaveClass(/ghost-note/);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

test('R1 native scheduled audio keeps logical identities after slicing an earlier beat', async ({ page, browserName }, info) => {
  await ready(page);
  const native = await page.evaluate(() => typeof AudioBuffer === 'function' && typeof AnalyserNode === 'function');
  test.skip(browserName === 'webkit' && process.platform === 'win32' && !native, 'This Windows WebKit build lacks native Web Audio.');
  expect(native).toBe(true);
  await page.evaluate(async () => {
    const sound = frequency => ({ mainBeatSound: { sound: 'Synth Sine', settings: { frequency, volume: 1 } } });
    app.setVolume(1); app.setTempo(180);
    app.updateTrack(0, { volume: 1, mainBeatSound: sound(220).mainBeatSound, barSettings: [{ beats: 4, subdivision: 1, rests: [1], velocities: { 2: .3 }, beatSounds: { 0: sound(330), 1: sound(440), 2: sound(660), 3: sound(880) } }] });
    (await import('/js/tracksController.js')).default.renderTracks(); historyControls.clear();
    window.r1Notes = []; window.r1Ramps = [];
    const ctx = app.getAudioContext(), create = ctx.createOscillator.bind(ctx), createGain = ctx.createGain.bind(ctx);
    ctx.createOscillator = (...args) => {
      const source = create(...args), start = source.start.bind(source), set = source.frequency.setValueAtTime.bind(source.frequency);
      let frequency;
      source.frequency.setValueAtTime = (value, time) => { frequency = value; return set(value, time); };
      source.start = (time, ...rest) => { r1Notes.push({ slot: app.getTracks()[0].currentBeat, frequency, time }); return start(time, ...rest); };
      return source;
    };
    ctx.createGain = (...args) => {
      const node = createGain(...args), ramp = node.gain.linearRampToValueAtTime.bind(node.gain);
      node.gain.linearRampToValueAtTime = (value, time) => { r1Ramps.push({ slot: app.getTracks()[0].currentBeat, value, time }); return ramp(value, time); };
      return node;
    };
  });
  await page.getByLabel('Operation', { exact: true }).selectOption('fill-slices');
  await page.getByRole('button', { name: 'Preview range', exact: true }).click();
  await page.getByRole('button', { name: 'Apply range', exact: true }).click();
  await page.locator('#start-stop-btn').click();
  await expect.poll(() => page.evaluate(() => r1Notes.some(note => note.slot === 4))).toBe(true);
  await page.locator('#start-stop-btn').click();
  const proof = await page.evaluate(() => ({ notes: r1Notes, ramps: r1Ramps, bar: app.getTracks()[0].barSettings[0] }));
  await info.attach('r1-native-scheduled-audio', { body: JSON.stringify(proof, null, 2), contentType: 'application/json' });
  const first = slot => proof.notes.find(note => note.slot === slot);
  expect.soft(first(0)?.frequency).toBe(330);
  expect.soft(first(1)?.frequency).toBe(330);
  expect.soft(first(2)).toBeUndefined();
  expect.soft(first(3)?.frequency).toBe(660);
  expect.soft(first(4)?.frequency).toBe(880);
  expect.soft(proof.ramps.find(ramp => ramp.slot === 3 && ramp.value > 0)?.value).toBeCloseTo(.3);
});

const snapshot = page => page.evaluate(() => app.getMusicalSnapshot());

test('mounted fill previews detached music, cancel is inert and apply is one undo', async ({ page }) => {
  await ready(page);
  const before = await snapshot(page);
  await page.getByLabel('End beat', { exact: true }).fill('3');
  await page.getByLabel('Operation', { exact: true }).selectOption('fill-rests');
  await page.getByRole('button', { name: 'Preview range', exact: true }).click();
  await expect(page.locator('[data-range-preview]')).toContainText('3 beats');
  expect(await snapshot(page)).toEqual(before);
  await page.getByRole('button', { name: 'Cancel preview', exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
  await page.getByRole('button', { name: 'Preview range', exact: true }).click();
  await page.getByRole('button', { name: 'Apply range', exact: true }).click();
  expect(await page.evaluate(() => app.getTracks()[0].barSettings[0].rests)).toEqual([0, 1, 2]);
  await expect(page.locator('.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square.rested')).toHaveCount(3);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
  await expect(page.locator('.bar-visual[data-container-index="0"][data-bar-index="0"] .beat-square.rested')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});
